-- SIGMA 1 — strict real-time work tracking.
--
-- Every minute between check-in and check-out is exactly one of:
--   task      a task timer (one at a time)                       → effective, productive
--   meeting   started by the person (team brief, client call…)   → effective
--   break     the attendance break (break_events)                → not effective; beyond the daily allowance = away
--   buffer    the first minutes after check-in (default 15)      → neutral
--   away      anything else: paused, missed progress check, offline, break over-run
-- Nothing can be edited afterwards: manual time logging is switched off.
--
-- Additive: new tables/functions/triggers; task_timer_* keep their signatures and delegate here.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- settings
create table if not exists public.work_settings (
  id boolean primary key default true check (id),
  daily_break_minutes integer not null default 60 check (daily_break_minutes between 0 and 240),
  checkin_buffer_minutes integer not null default 15 check (checkin_buffer_minutes between 0 and 60),
  check_min_minutes integer not null default 45 check (check_min_minutes between 10 and 240),
  check_max_minutes integer not null default 75 check (check_max_minutes between 10 and 240),
  check_answer_minutes integer not null default 5 check (check_answer_minutes between 1 and 30),
  offline_minutes integer not null default 10 check (offline_minutes between 3 and 60),
  meeting_cap_minutes integer not null default 90 check (meeting_cap_minutes between 0 and 600),
  min_effective_pct integer not null default 90 check (min_effective_pct between 0 and 100),
  required_minutes integer not null default 480 check (required_minutes between 60 and 900),
  weight_time integer not null default 40 check (weight_time between 0 and 100),
  weight_deadlines integer not null default 30 check (weight_deadlines between 0 and 100),
  weight_quality integer not null default 30 check (weight_quality between 0 and 100),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (check_max_minutes >= check_min_minutes),
  check (weight_time + weight_deadlines + weight_quality = 100)
);
insert into public.work_settings(id) values (true) on conflict (id) do nothing;
alter table public.work_settings enable row level security;

-- ---------------------------------------------------------------- sessions, presence, checks
create table if not exists public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null check (kind in ('task','meeting')),
  task_id uuid references public.tasks(id) on delete set null,
  meeting_type text check (meeting_type is null or meeting_type in ('team_brief','client_call','internal','training','other')),
  note text check (note is null or length(note) <= 300),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason is null or end_reason in ('switch','pause','break','meeting','checkout','logout','offline','missed_check','submitted','status','auto')),
  check (kind <> 'task' or task_id is not null),
  check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists work_sessions_one_open on public.work_sessions(employee_id) where ended_at is null;
create index if not exists work_sessions_emp_day on public.work_sessions(employee_id, started_at);
create index if not exists work_sessions_task on public.work_sessions(task_id) where task_id is not null;
alter table public.work_sessions enable row level security;

create table if not exists public.work_presence (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  next_check_at timestamptz
);
alter table public.work_presence enable row level security;

create table if not exists public.progress_checks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  asked_by uuid references public.profiles(id) on delete set null,   -- null = automatic progress check
  question text not null check (length(question) between 2 and 300),
  is_presence boolean not null default true,                        -- automatic checks decide away time; manager questions don't
  asked_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'pending' check (status in ('pending','answered','missed','cancelled')),
  answered_at timestamptz,
  mood text check (mood is null or mood in ('on_track','almost_done','stuck')),
  progress_pct smallint check (progress_pct is null or progress_pct between 0 and 100),
  answer text check (answer is null or length(answer) <= 500)
);
create index if not exists progress_checks_emp on public.progress_checks(employee_id, asked_at desc);
create index if not exists progress_checks_task on public.progress_checks(task_id, asked_at desc) where task_id is not null;
create index if not exists progress_checks_pending on public.progress_checks(employee_id) where status = 'pending';
alter table public.progress_checks enable row level security;

-- ---------------------------------------------------------------- helpers
create or replace function private.work_cfg()
returns public.work_settings language sql stable security definer set search_path = '' as $$
  select * from public.work_settings where id
$$;

create or replace function private.can_see_work(p_emp uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_emp = private.current_employee_id() or private.is_manager_of(p_emp) or private.can_manage_performance()
$$;

create or replace function private.work_next_check(p_emp uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.work_settings := private.work_cfg();
begin
  insert into public.work_presence(employee_id, last_seen_at, next_check_at)
  values (p_emp, now(), now() + make_interval(mins => c.check_min_minutes + floor(random() * (c.check_max_minutes - c.check_min_minutes + 1))::int))
  on conflict (employee_id) do update set next_check_at = excluded.next_check_at;
end $$;

-- Close the person's open session at p_at, credit task minutes to the task.
create or replace function private.work_close(p_emp uuid, p_at timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.work_sessions; v_min int; v_prev text := coalesce(current_setting('sigma.task_rpc', true), '');
begin
  update public.work_sessions set ended_at = greatest(started_at, least(coalesce(p_at, now()), now())), end_reason = p_reason
  where employee_id = p_emp and ended_at is null
  returning * into s;
  if not found then return; end if;
  if s.kind = 'task' then
    v_min := round(extract(epoch from (s.ended_at - s.started_at)) / 60.0)::int;
    if v_min >= 1 then
      insert into public.task_time_logs(task_id, employee_id, work_date, minutes, note)
      values (s.task_id, p_emp, (s.started_at at time zone 'Asia/Kolkata')::date, least(v_min, 960), 'Timer');
      perform set_config('sigma.task_rpc', 'on', true);
      update public.tasks set time_spent_minutes = (select coalesce(sum(minutes), 0) from public.task_time_logs where task_id = s.task_id)
      where id = s.task_id;
      perform set_config('sigma.task_rpc', v_prev, true);
    end if;
  end if;
  update public.work_presence set next_check_at = null where employee_id = p_emp;
end $$;

create or replace function private.work_attendance_today(p_emp uuid)
returns public.attendance language sql stable security definer set search_path = '' as $$
  select * from public.attendance where employee_id = p_emp and date = private.today_ist()
$$;

-- Missed checks, offline timeouts and due progress checks for one person. Runs from the heartbeat and every minute.
create or replace function private.work_sweep_employee(p_emp uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.work_settings := private.work_cfg(); p public.work_presence; s public.work_sessions; k public.progress_checks; v_title text; v_id uuid;
begin
  select * into p from public.work_presence where employee_id = p_emp;
  select * into s from public.work_sessions where employee_id = p_emp and ended_at is null;

  -- 1. expired automatic checks → missed; time from the question onward becomes away
  for k in select * from public.progress_checks where employee_id = p_emp and status = 'pending' and is_presence and expires_at < now() loop
    update public.progress_checks set status = 'missed' where id = k.id;
    if s.id is not null and s.kind = 'task' and s.started_at <= k.asked_at then
      perform private.work_close(p_emp, k.asked_at, 'missed_check');
      s := null;
    end if;
  end loop;

  -- 2. app closed / laptop asleep → close at the last signal
  if s.id is not null and p.employee_id is not null and p.last_seen_at < now() - make_interval(mins => c.offline_minutes) then
    perform private.work_close(p_emp, greatest(s.started_at, p.last_seen_at), 'offline');
    update public.progress_checks set status = 'cancelled' where employee_id = p_emp and status = 'pending' and is_presence;
    return;
  end if;

  -- 3. a progress check is due
  if s.id is not null and s.kind = 'task' and p.next_check_at is not null and p.next_check_at <= now()
     and not exists (select 1 from public.progress_checks where employee_id = p_emp and status = 'pending' and is_presence) then
    select title into v_title from public.tasks where id = s.task_id;
    insert into public.progress_checks(employee_id, task_id, question, is_presence, expires_at)
    values (p_emp, s.task_id, 'How’s “' || left(coalesce(v_title, 'your task'), 120) || '” going?', true, now() + make_interval(mins => c.check_answer_minutes))
    returning id into v_id;
    update public.work_presence set next_check_at = null where employee_id = p_emp;
    -- notify directly: notify_employee skips the caller, and the heartbeat runs as the employee
    perform private.notify((select profile_id from public.employees where id = p_emp), 'task', 'How’s “' || left(coalesce(v_title, 'your task'), 80) || '” going?',
      'Answer within ' || c.check_answer_minutes || ' minutes to keep your time counted.', '/emp-tasks', 'check_' || v_id);
  end if;
end $$;

create or replace function private.work_sweep_all()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select distinct employee_id from (
      select employee_id from public.work_sessions where ended_at is null
      union select employee_id from public.progress_checks where status = 'pending' and is_presence) x loop
    perform private.work_sweep_employee(r.employee_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- live state for the app
create or replace function private.work_state(p_emp uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.work_settings := private.work_cfg(); a public.attendance := private.work_attendance_today(p_emp);
  s public.work_sessions; v_cur jsonb; v_last jsonb; v_idle timestamptz; v_first boolean; v_break numeric; v_pending jsonb; v_title text;
begin
  select * into s from public.work_sessions where employee_id = p_emp and ended_at is null;
  if s.id is not null then
    select title into v_title from public.tasks where id = s.task_id;
    v_cur := jsonb_build_object('kind', s.kind, 'task_id', s.task_id, 'title', coalesce(v_title, s.note), 'meeting_type', s.meeting_type,
                                'note', s.note, 'started_at', s.started_at);
  end if;
  select jsonb_build_object('id', w.task_id, 'title', t.title, 'ended_at', w.ended_at, 'reason', w.end_reason) into v_last
  from public.work_sessions w join public.tasks t on t.id = w.task_id
  where w.employee_id = p_emp and w.kind = 'task' and w.ended_at is not null and a.id is not null and w.started_at >= a.check_in_at
    and t.status in ('in_progress','revision_required','accepted','assigned') and t.archived_at is null
  order by w.ended_at desc limit 1;
  v_first := a.id is not null and not exists (select 1 from public.work_sessions where employee_id = p_emp and started_at >= a.check_in_at);
  select coalesce(sum(extract(epoch from (coalesce(b.break_end, now()) - b.break_start))), 0) / 60 into v_break
  from public.break_events b where b.attendance_id = a.id;
  if s.id is null and a.id is not null and a.check_out_at is null then
    select greatest(a.check_in_at, coalesce(max(w.ended_at), a.check_in_at),
                    coalesce((select max(b.break_end) from public.break_events b where b.attendance_id = a.id), a.check_in_at))
      into v_idle from public.work_sessions w where w.employee_id = p_emp and w.started_at >= a.check_in_at;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'question', k.question, 'task_id', k.task_id, 'task_title', t.title,
           'asked_at', k.asked_at, 'expires_at', k.expires_at, 'from_manager', k.asked_by is not null,
           'asked_by_name', (select e.name from public.employees e where e.profile_id = k.asked_by limit 1)) order by k.asked_at), '[]'::jsonb)
    into v_pending
  from public.progress_checks k left join public.tasks t on t.id = k.task_id
  where k.employee_id = p_emp and k.status = 'pending';
  return jsonb_build_object(
    'now', now(),
    'checked_in', a.id is not null, 'checked_out', a.check_out_at is not null,
    'attendance_state', a.current_state, 'check_in_at', a.check_in_at,
    'current', v_cur, 'last_task', v_last, 'idle_since', v_idle, 'first_of_day', v_first,
    'buffer_minutes', c.checkin_buffer_minutes,
    'break_used_minutes', round(v_break), 'break_allow_minutes', c.daily_break_minutes,
    'pending', v_pending);
end $$;

create or replace function public.work_heartbeat()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := private.current_employee_id();
begin
  perform private.require(v_emp is not null, 'Only employees track work');
  perform private.work_sweep_employee(v_emp);            -- uses the previous signal time first
  insert into public.work_presence(employee_id, last_seen_at) values (v_emp, now())
  on conflict (employee_id) do update set last_seen_at = now();
  return private.work_state(v_emp);
end $$;

-- ---------------------------------------------------------------- actions
create or replace function private.work_require_working(p_emp uuid)
returns public.attendance language plpgsql stable security definer set search_path = '' as $$
declare a public.attendance := private.work_attendance_today(p_emp);
begin
  perform private.require(a.id is not null, 'Check in first to start work');
  perform private.require(a.check_out_at is null, 'You have checked out for today');
  perform private.require(a.current_state = 'working', 'End your break first');
  return a;
end $$;

create or replace function public.work_start_task(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := private.current_employee_id(); t public.tasks; s public.work_sessions;
begin
  perform private.require(v_emp is not null, 'Only employees track work');
  select * into t from public.tasks where id = p_task_id and archived_at is null;
  perform private.require(found and t.assigned_to = v_emp, 'Only the assignee can work on this task');
  perform private.require(t.status not in ('completed','cancelled','awaiting_review'), 'This task isn’t open for work');
  perform private.work_require_working(v_emp);
  select * into s from public.work_sessions where employee_id = v_emp and ended_at is null;
  if s.id is not null and s.kind = 'task' and s.task_id = t.id then
    return private.work_state(v_emp);
  end if;
  if t.status in ('assigned','accepted','blocked','revision_required') then
    perform public.task_transition(t.id, 'in_progress');
  end if;
  perform private.work_close(v_emp, now(), 'switch');
  insert into public.work_sessions(employee_id, kind, task_id) values (v_emp, 'task', t.id);
  insert into public.work_presence(employee_id, last_seen_at) values (v_emp, now())
  on conflict (employee_id) do update set last_seen_at = now();
  perform private.work_next_check(v_emp);
  return private.work_state(v_emp);
end $$;

create or replace function public.work_start_meeting(p_type text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := private.current_employee_id();
begin
  perform private.require(v_emp is not null, 'Only employees track work');
  perform private.require(p_type in ('team_brief','client_call','internal','training','other'), 'Choose the meeting type');
  perform private.require(p_type <> 'other' or length(btrim(coalesce(p_note, ''))) >= 3, 'Say what the meeting is about');
  perform private.work_require_working(v_emp);
  perform private.work_close(v_emp, now(), 'meeting');
  insert into public.work_sessions(employee_id, kind, meeting_type, note)
  values (v_emp, 'meeting', p_type, nullif(btrim(coalesce(p_note, '')), ''));
  insert into public.work_presence(employee_id, last_seen_at) values (v_emp, now())
  on conflict (employee_id) do update set last_seen_at = now();
  update public.progress_checks set status = 'cancelled' where employee_id = v_emp and status = 'pending' and is_presence;
  return private.work_state(v_emp);
end $$;

create or replace function public.work_pause(p_reason text default 'pause')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := private.current_employee_id();
begin
  perform private.require(v_emp is not null, 'Only employees track work');
  perform private.work_close(v_emp, now(), case when p_reason = 'logout' then 'logout' else 'pause' end);
  update public.progress_checks set status = 'cancelled' where employee_id = v_emp and status = 'pending' and is_presence;
  return private.work_state(v_emp);
end $$;

create or replace function public.work_answer_check(p_check_id uuid, p_mood text, p_progress integer default null, p_answer text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := private.current_employee_id(); k public.progress_checks; t public.tasks; v_answer text := nullif(btrim(coalesce(p_answer, '')), '');
begin
  select * into k from public.progress_checks where id = p_check_id for update;
  perform private.require(found and k.employee_id = v_emp, 'Check not found');
  if k.status = 'pending' and k.is_presence and k.expires_at < now() then
    raise exception 'This check expired at %. The time since then counts as away.', to_char(k.expires_at at time zone 'Asia/Kolkata', 'HH24:MI') using errcode = 'P0001';
  end if;
  perform private.require(k.status = 'pending', 'This check was already answered');
  perform private.require(p_mood in ('on_track','almost_done','stuck'), 'Choose how it’s going');
  perform private.require(p_mood <> 'stuck' or v_answer is not null, 'Say what you’re stuck on');
  perform private.require(p_progress is null or p_progress between 0 and 99, 'Progress must be 0–99%');
  update public.progress_checks set status = 'answered', answered_at = now(), mood = p_mood, progress_pct = p_progress, answer = v_answer
  where id = k.id;
  if k.task_id is not null then
    select * into t from public.tasks where id = k.task_id;
    perform set_config('sigma.task_rpc', 'on', true);
    if p_progress is not null and t.status in ('accepted','in_progress','blocked','revision_required') then
      update public.tasks set progress_pct = p_progress where id = t.id;
    end if;
    insert into public.task_events(task_id, event_type, actor_employee_id, metadata)
    values (t.id, 'progress', v_emp, jsonb_build_object('mood', p_mood, 'progress', p_progress, 'note', v_answer, 'question', k.question, 'from_manager', k.asked_by is not null));
    perform set_config('sigma.task_rpc', '', true);
    if k.asked_by is not null then
      insert into public.task_comments(task_id, author_id, body)
      values (t.id, auth.uid(), left('↳ ' || k.question || E'\n' ||
        case p_mood when 'on_track' then 'On track' when 'almost_done' then 'Almost done' else 'Stuck' end ||
        coalesce(' · ' || p_progress || '%', '') || coalesce(' — ' || v_answer, ''), 4000));
    end if;
    if p_mood = 'stuck' then
      perform private.notify_task_reviewers(t, 'Stuck on a task', '"' || t.title || '": ' || coalesce(v_answer, ''), 'stuck_' || k.id);
    end if;
  end if;
  if k.is_presence and exists (select 1 from public.work_sessions where employee_id = v_emp and ended_at is null and kind = 'task') then
    perform private.work_next_check(v_emp);
  end if;
  return private.work_state(v_emp);
end $$;

-- Manager or admin asks the assignee about a task (shows as a popup; never counts against their time).
create or replace function public.work_ask(p_task_id uuid, p_question text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.tasks; v_id uuid; v_q text := btrim(coalesce(p_question, ''));
begin
  select * into t from public.tasks where id = p_task_id and archived_at is null;
  perform private.require(found and private.task_is_reviewer(t), 'Only the manager or an admin can ask about this task');
  perform private.require(length(v_q) between 3 and 300, 'Write a short question');
  insert into public.progress_checks(employee_id, task_id, asked_by, question, is_presence)
  values (t.assigned_to, t.id, auth.uid(), v_q, false) returning id into v_id;
  insert into public.task_comments(task_id, author_id, body) values (t.id, auth.uid(), left('❓ ' || v_q, 4000));
  perform private.notify_employee(t.assigned_to, 'task', 'Question about “' || left(t.title, 80) || '”', v_q, '/emp-tasks', 'ask_' || v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------- automatic closing
create or replace function private.work_on_break_start()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.work_close(NEW.employee_id, NEW.break_start, 'break');
  update public.progress_checks set status = 'cancelled' where employee_id = NEW.employee_id and status = 'pending' and is_presence;
  return NEW;
end $$;
create or replace trigger trg_work_break_start after insert on public.break_events
  for each row execute function private.work_on_break_start();

create or replace function private.work_on_checkout()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.check_out_at is not null and OLD.check_out_at is null then
    perform private.work_close(NEW.employee_id, NEW.check_out_at, 'checkout');
    update public.progress_checks set status = 'cancelled' where employee_id = NEW.employee_id and status = 'pending' and is_presence;
  end if;
  return NEW;
end $$;
create or replace trigger trg_work_checkout after update on public.attendance
  for each row execute function private.work_on_checkout();

create or replace function private.work_on_task_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.status is distinct from OLD.status and NEW.status in ('awaiting_review','completed','cancelled','blocked') then
    if exists (select 1 from public.work_sessions where employee_id = NEW.assigned_to and ended_at is null and task_id = NEW.id) then
      perform private.work_close(NEW.assigned_to, now(), case when NEW.status = 'awaiting_review' then 'submitted' else 'status' end);
    end if;
  end if;
  return NEW;
end $$;
create or replace trigger trg_work_task_status after update on public.tasks
  for each row execute function private.work_on_task_status();

-- Older timer calls now go through the session model.
create or replace function public.task_timer_start(p_task_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
begin
  perform public.work_start_task(p_task_id);
  return now();
end $$;
create or replace function public.task_timer_stop()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := private.current_employee_id(); s public.work_sessions;
begin
  select * into s from public.work_sessions where employee_id = v_emp and ended_at is null;
  perform public.work_pause('pause');
  return case when s.id is null then 0 else round(extract(epoch from (now() - s.started_at)) / 60.0)::int end;
end $$;

-- Real time only: no manual time entries.
revoke execute on function public.task_log_time(uuid, integer, date, text) from authenticated;

-- ---------------------------------------------------------------- day timeline
create or replace function private.work_segments(p_emp uuid, p_date date)
returns table (seg_start timestamptz, seg_end timestamptz, kind text, label text, task_id uuid, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare a public.attendance; c public.work_settings := private.work_cfg(); v_end timestamptz; cur timestamptz; v_first boolean := true;
  used numeric := 0; rem numeric; r record; s timestamptz; e timestamptz; prev_reason text; gap_label text;
begin
  select * into a from public.attendance x where x.employee_id = p_emp and x.date = p_date;
  if not found or a.check_in_at is null then return; end if;
  v_end := coalesce(a.check_out_at, least(now(), ((p_date + 1)::timestamp at time zone 'Asia/Kolkata')));
  cur := a.check_in_at;
  for r in
    select w.started_at as rs, coalesce(w.ended_at, v_end) as re, w.kind as rk,
           coalesce(t.title, case w.meeting_type when 'team_brief' then 'Team brief' when 'client_call' then 'Client call'
             when 'internal' then 'Internal discussion' when 'training' then 'Training' else coalesce(w.note, 'Meeting') end) as rl,
           w.task_id as rt, w.end_reason as rr
    from public.work_sessions w left join public.tasks t on t.id = w.task_id
    where w.employee_id = p_emp and w.started_at < v_end and coalesce(w.ended_at, v_end) > a.check_in_at
    union all
    select b.break_start, coalesce(b.break_end, v_end), 'break', 'Break', null::uuid, null::text
    from public.break_events b where b.attendance_id = a.id
    order by 1
  loop
    s := greatest(r.rs, cur); e := least(r.re, v_end);
    continue when e <= s;
    if s > cur then
      if v_first then
        if s > cur + make_interval(mins => c.checkin_buffer_minutes) then
          seg_start := cur; seg_end := cur + make_interval(mins => c.checkin_buffer_minutes); kind := 'buffer'; label := 'Getting started'; task_id := null; reason := null; return next;
          seg_start := seg_end; seg_end := s; kind := 'away'; label := 'Not started'; reason := 'late_start'; return next;
        else
          seg_start := cur; seg_end := s; kind := 'buffer'; label := 'Getting started'; task_id := null; reason := null; return next;
        end if;
      else
        gap_label := case prev_reason when 'missed_check' then 'Missed progress check' when 'offline' then 'Offline (no signal)'
                       when 'logout' then 'Logged out' when 'submitted' then 'Choosing the next task' else 'No task running' end;
        seg_start := cur; seg_end := s; kind := 'away'; label := gap_label; task_id := null; reason := prev_reason; return next;
      end if;
    end if;
    v_first := false;
    if r.rk = 'break' then
      rem := greatest(0, c.daily_break_minutes * 60 - used);
      if extract(epoch from (e - s)) <= rem then
        seg_start := s; seg_end := e; kind := 'break'; label := 'Break'; task_id := null; reason := null; return next;
      else
        if rem > 0 then
          seg_start := s; seg_end := s + make_interval(secs => rem); kind := 'break'; label := 'Break'; task_id := null; reason := null; return next;
        end if;
        seg_start := s + make_interval(secs => rem); seg_end := e; kind := 'away'; label := 'Break over-run'; task_id := null; reason := 'break_overrun'; return next;
      end if;
      used := used + extract(epoch from (e - s));
      prev_reason := 'break';
    else
      seg_start := s; seg_end := e; kind := r.rk; label := r.rl; task_id := r.rt; reason := r.rr; return next;
      prev_reason := r.rr;
    end if;
    cur := e;
  end loop;
  if v_end > cur then
    if v_first then
      seg_start := cur; seg_end := least(v_end, cur + make_interval(mins => c.checkin_buffer_minutes)); kind := 'buffer'; label := 'Getting started'; task_id := null; reason := null; return next;
      if v_end > seg_end then seg_start := seg_end; seg_end := v_end; kind := 'away'; label := 'Not started'; reason := 'late_start'; return next; end if;
    else
      seg_start := cur; seg_end := v_end; kind := 'away';
      label := case prev_reason when 'missed_check' then 'Missed progress check' when 'offline' then 'Offline (no signal)'
                 when 'logout' then 'Logged out' when 'submitted' then 'Choosing the next task' else 'No task running' end;
      task_id := null; reason := prev_reason; return next;
    end if;
  end if;
end $$;

create or replace function private.work_day_json(p_emp uuid, p_date date, p_with_segments boolean default true)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.attendance; e public.employees; c public.work_settings := private.work_cfg(); v jsonb; v_req int;
begin
  select * into a from public.attendance x where x.employee_id = p_emp and x.date = p_date;
  if not found or a.check_in_at is null then return null; end if;
  select * into e from public.employees where id = p_emp;
  v_req := case when a.status = 'half_day' then c.required_minutes / 2 else c.required_minutes end;
  with s as (
    select g.*, extract(epoch from (g.seg_end - g.seg_start)) / 60.0 as m from private.work_segments(p_emp, p_date) g
  ), sm as (
    select coalesce(sum(m) filter (where kind = 'task'), 0) as task_m,
           coalesce(sum(m) filter (where kind = 'meeting'), 0) as meet_m,
           coalesce(sum(m) filter (where kind = 'break'), 0) as break_m,
           coalesce(sum(m) filter (where kind = 'away'), 0) as away_m,
           coalesce(sum(m) filter (where kind = 'buffer'), 0) as buffer_m,
           coalesce(sum(m) filter (where reason = 'break_overrun'), 0) as overrun_m,
           count(*) filter (where kind = 'away') as away_n,
           coalesce(sum(m), 0) as gross_m
    from s
  )
  select jsonb_build_object(
    'date', p_date,
    'check_in', a.check_in_at, 'check_out', a.check_out_at, 'open', a.check_out_at is null,
    'shift_start', to_char(coalesce(e.shift_start, time '09:00'), 'HH24:MI'), 'shift_end', to_char(coalesce(e.shift_end, time '18:00'), 'HH24:MI'),
    'late', (a.check_in_at at time zone 'Asia/Kolkata')::time > coalesce(e.shift_start, time '09:00'),
    'left_early', a.check_out_at is not null and (a.check_out_at at time zone 'Asia/Kolkata')::time < coalesce(e.shift_end, time '18:00')
                  and (a.check_out_at at time zone 'Asia/Kolkata')::time > (a.check_in_at at time zone 'Asia/Kolkata')::time,
    'gross_min', round(sm.gross_m), 'task_min', round(sm.task_m), 'meeting_min', round(sm.meet_m), 'break_min', round(sm.break_m),
    'away_min', round(sm.away_m), 'buffer_min', round(sm.buffer_m), 'overrun_min', round(sm.overrun_m), 'away_count', sm.away_n,
    'effective_min', round(sm.task_m + sm.meet_m), 'required_min', v_req,
    'effective_pct', round(100.0 * (sm.task_m + sm.meet_m) / nullif(v_req, 0), 1),
    'productivity_pct', round(100.0 * sm.task_m / nullif(sm.gross_m - sm.break_m, 0), 1),
    'meeting_over_cap', sm.meet_m > c.meeting_cap_minutes,
    'below_min', a.check_out_at is not null and 100.0 * (sm.task_m + sm.meet_m) / nullif(v_req, 0) < c.min_effective_pct,
    'checks_answered', (select count(*) from public.progress_checks k where k.employee_id = p_emp and k.is_presence and k.status = 'answered'
                         and (k.asked_at at time zone 'Asia/Kolkata')::date = p_date),
    'checks_missed', (select count(*) from public.progress_checks k where k.employee_id = p_emp and k.is_presence and k.status = 'missed'
                       and (k.asked_at at time zone 'Asia/Kolkata')::date = p_date),
    'drafts', (select count(*) from public.task_drafts d join public.tasks t on t.id = d.task_id
               where t.assigned_to = p_emp and (d.submitted_at at time zone 'Asia/Kolkata')::date = p_date),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('task_id', x.task_id, 'title', x.label, 'minutes', round(x.m)) order by x.m desc), '[]'::jsonb)
              from (select task_id, max(label) as label, sum(m) as m from s where kind = 'task' group by task_id) x),
    'segments', case when p_with_segments then (select coalesce(jsonb_agg(jsonb_build_object('start', seg_start, 'end', seg_end, 'kind', kind,
                  'label', label, 'task_id', task_id, 'reason', reason, 'minutes', round(m)) order by seg_start), '[]'::jsonb) from s) else null end
  ) into v from sm;
  return v;
end $$;

create or replace function public.work_day(p_employee_id uuid default null, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := coalesce(p_employee_id, private.current_employee_id());
begin
  perform private.require(v_emp is not null and private.can_see_work(v_emp), 'Not allowed');
  return private.work_day_json(v_emp, coalesce(p_date, private.today_ist()), true);
end $$;

-- ---------------------------------------------------------------- month and score
create or replace function private.work_month_json(p_emp uuid, p_month date, p_with_days boolean default true)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.work_settings := private.work_cfg(); v_from date := date_trunc('month', p_month)::date;
  v_to date := least((date_trunc('month', p_month) + interval '1 month - 1 day')::date, private.today_ist());
  d date; dj jsonb; days jsonb := '[]'::jsonb; v_kind text;
  n_work int := 0; n_present int := 0; n_leave int := 0; n_absent int := 0; n_late int := 0; n_below int := 0; n_overrun int := 0;
  t_eff numeric := 0; t_task numeric := 0; t_meet numeric := 0; t_break numeric := 0; t_away numeric := 0; t_gross numeric := 0; t_req numeric := 0;
  t_ans int := 0; t_miss int := 0; v_in_sum numeric := 0;
  s_time numeric; s_dead numeric; s_qual numeric; w numeric; score numeric;
  k_due int; k_ontime int; q_first int; q_ok int;
begin
  if v_to < v_from then v_to := v_from - 1; end if;
  d := v_from;
  while d <= v_to loop
    dj := private.work_day_json(p_emp, d, false);
    if dj is not null then
      v_kind := 'present'; n_present := n_present + 1; n_work := n_work + 1;
      t_eff := t_eff + (dj->>'effective_min')::numeric; t_task := t_task + (dj->>'task_min')::numeric; t_meet := t_meet + (dj->>'meeting_min')::numeric;
      t_break := t_break + (dj->>'break_min')::numeric; t_away := t_away + (dj->>'away_min')::numeric; t_gross := t_gross + (dj->>'gross_min')::numeric;
      t_req := t_req + (dj->>'required_min')::numeric;
      t_ans := t_ans + (dj->>'checks_answered')::int; t_miss := t_miss + (dj->>'checks_missed')::int;
      if (dj->>'late')::boolean then n_late := n_late + 1; end if;
      if (dj->>'below_min')::boolean then n_below := n_below + 1; end if;
      if (dj->>'overrun_min')::numeric > 0 then n_overrun := n_overrun + 1; end if;
      v_in_sum := v_in_sum + extract(epoch from (((dj->>'check_in')::timestamptz at time zone 'Asia/Kolkata')::time));
    elsif exists (select 1 from public.leave_requests l where l.employee_id = p_emp and l.status = 'approved' and d between l.start_date and l.end_date) then
      v_kind := 'leave'; n_leave := n_leave + 1; n_work := n_work + 1;
    elsif extract(isodow from d) = 7 or exists (select 1 from public.holidays h where h.date = d) then
      v_kind := 'off';
    elsif d < private.today_ist() then
      v_kind := 'absent'; n_absent := n_absent + 1; n_work := n_work + 1;
    else
      v_kind := 'today';
    end if;
    if p_with_days then
      days := days || jsonb_build_array(coalesce(dj, '{}'::jsonb) || jsonb_build_object('date', d, 'kind', v_kind));
    end if;
    d := d + 1;
  end loop;

  -- deadlines: tasks due this month finished by the due date
  select count(*) filter (where on_time or late or overdue), count(*) filter (where on_time) into k_due, k_ontime
  from (select (k.status = 'completed' and (k.completed_at at time zone 'Asia/Kolkata')::date <= k.due_date) as on_time,
               (k.status = 'completed' and (k.completed_at at time zone 'Asia/Kolkata')::date > k.due_date) as late,
               (k.status not in ('completed','awaiting_review') and k.due_date < private.today_ist()) as overdue
        from public.tasks k where k.assigned_to = p_emp and k.archived_at is null and k.status <> 'cancelled'
          and k.due_date between v_from and v_to) z;
  -- quality: first drafts decided this month that were approved
  select count(*), count(*) filter (where f.decision in ('approved','auto_approved')) into q_first, q_ok
  from (select distinct on (dr.task_id) dr.task_id, dr.decision, dr.decided_at
        from public.task_drafts dr join public.tasks k on k.id = dr.task_id
        where k.assigned_to = p_emp order by dr.task_id, dr.draft_no) f
  where f.decision <> 'pending' and (f.decided_at at time zone 'Asia/Kolkata')::date between v_from and v_to;

  s_time := case when t_req > 0 then least(100, round(100.0 * t_eff / t_req, 1)) end;
  s_dead := case when k_due > 0 then round(100.0 * k_ontime / k_due, 1) end;
  s_qual := case when q_first > 0 then round(100.0 * q_ok / q_first, 1) end;
  w := (case when s_time is not null then c.weight_time else 0 end) + (case when s_dead is not null then c.weight_deadlines else 0 end)
     + (case when s_qual is not null then c.weight_quality else 0 end);
  score := case when w > 0 then round((coalesce(s_time, 0) * c.weight_time * (s_time is not null)::int
                                   + coalesce(s_dead, 0) * c.weight_deadlines * (s_dead is not null)::int
                                   + coalesce(s_qual, 0) * c.weight_quality * (s_qual is not null)::int) / w) end;

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'working_days', n_work, 'present', n_present, 'leave', n_leave, 'absent', n_absent,
    'late_days', n_late, 'below_min_days', n_below, 'overrun_days', n_overrun,
    'avg_check_in', case when n_present > 0 then to_char(time '00:00' + make_interval(secs => v_in_sum / n_present), 'HH24:MI') end,
    'effective_min', round(t_eff), 'task_min', round(t_task), 'meeting_min', round(t_meet), 'break_min', round(t_break),
    'away_min', round(t_away), 'gross_min', round(t_gross), 'required_min', round(t_req),
    'avg_effective_min', case when n_present > 0 then round(t_eff / n_present) end,
    'effectiveness_pct', s_time,
    'productivity_pct', round(100.0 * t_task / nullif(t_gross - t_break, 0), 1),
    'tasks_due', k_due, 'tasks_on_time', k_ontime, 'deadline_pct', s_dead,
    'first_drafts', q_first, 'first_draft_ok', q_ok, 'quality_pct', s_qual,
    'checks_answered', t_ans, 'checks_missed', t_miss,
    'score', score, 'weights', jsonb_build_object('time', c.weight_time, 'deadlines', c.weight_deadlines, 'quality', c.weight_quality),
    'days', case when p_with_days then days else null end);
end $$;

create or replace function public.work_month(p_employee_id uuid default null, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := coalesce(p_employee_id, private.current_employee_id());
begin
  perform private.require(v_emp is not null and private.can_see_work(v_emp), 'Not allowed');
  return private.work_month_json(v_emp, coalesce(p_month, private.today_ist()), true);
end $$;

create or replace function public.work_team_month(p_month date default null)
returns table (employee_id uuid, name text, designation text, summary jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  select e.id, e.name, d.name, private.work_month_json(e.id, coalesce(p_month, private.today_ist()), false)
  from public.employees e left join public.designations d on d.id = e.designation_id
  where e.status = 'active' and e.id is distinct from private.current_employee_id()
    and (private.can_manage_performance() or e.manager_id = private.current_employee_id())
  order by e.name;
end $$;

create or replace function public.work_team_live()
returns table (employee_id uuid, name text, designation text, state jsonb, last_seen_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  select e.id, e.name, d.name, private.work_state(e.id), p.last_seen_at
  from public.employees e left join public.designations d on d.id = e.designation_id
  left join public.work_presence p on p.employee_id = e.id
  where e.status = 'active' and e.id is distinct from private.current_employee_id()
    and (private.can_manage_performance() or e.manager_id = private.current_employee_id())
  order by e.name;
end $$;

-- ---------------------------------------------------------------- RLS, grants, schedule
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_settings' and policyname = 'work_settings_select') then
    create policy work_settings_select on public.work_settings for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_settings' and policyname = 'work_settings_admin_update') then
    create policy work_settings_admin_update on public.work_settings for update to authenticated using (private.is_admin()) with check (private.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_sessions' and policyname = 'work_sessions_select') then
    create policy work_sessions_select on public.work_sessions for select to authenticated using (private.can_see_work(employee_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_presence' and policyname = 'work_presence_select') then
    create policy work_presence_select on public.work_presence for select to authenticated using (private.can_see_work(employee_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'progress_checks' and policyname = 'progress_checks_select') then
    create policy progress_checks_select on public.progress_checks for select to authenticated
      using (private.can_see_work(employee_id) or (task_id is not null and private.can_view_task(task_id)));
  end if;
end $$;

revoke all on public.work_settings, public.work_sessions, public.work_presence, public.progress_checks from anon;
revoke insert, update, delete, truncate, trigger, references on public.work_sessions, public.work_presence, public.progress_checks from authenticated;
revoke insert, delete, truncate, trigger, references on public.work_settings from authenticated;
grant select on public.work_sessions, public.work_presence, public.progress_checks to authenticated;
grant select, update on public.work_settings to authenticated;

revoke execute on function private.work_close(uuid, timestamptz, text), private.work_sweep_employee(uuid), private.work_sweep_all(),
  private.work_next_check(uuid), private.work_segments(uuid, date), private.work_day_json(uuid, date, boolean),
  private.work_month_json(uuid, date, boolean), private.work_state(uuid), private.work_require_working(uuid),
  private.work_attendance_today(uuid), private.work_cfg() from public, anon, authenticated;
grant execute on function private.can_see_work(uuid) to authenticated;
revoke execute on function public.work_heartbeat(), public.work_start_task(uuid), public.work_start_meeting(text, text), public.work_pause(text),
  public.work_answer_check(uuid, text, integer, text), public.work_ask(uuid, text), public.work_day(uuid, date), public.work_month(uuid, date),
  public.work_team_month(date), public.work_team_live() from public, anon;
grant execute on function public.work_heartbeat(), public.work_start_task(uuid), public.work_start_meeting(text, text), public.work_pause(text),
  public.work_answer_check(uuid, text, integer, text), public.work_ask(uuid, text), public.work_day(uuid, date), public.work_month(uuid, date),
  public.work_team_month(date), public.work_team_live() to authenticated;

create or replace trigger trg_audit_work_settings after update on public.work_settings for each row execute function private.audit_row_change();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sigma-work-sweep') then perform cron.unschedule('sigma-work-sweep'); end if;
  perform cron.schedule('sigma-work-sweep', '* * * * *', 'select private.work_sweep_all();');
end $$;
