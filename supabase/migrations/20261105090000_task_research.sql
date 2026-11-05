-- SIGMA 1 — Research before work (every task)
--
-- • Each task carries research time (minutes), on top of its effort estimate. New tasks default to 30 min.
--   Tasks that were never started get 30 min; tasks already started or finished are left as they were (no research step).
-- • Starting a task runs a research timer first. "Done researching" (any time, or after the time is up) asks for
--   at least one reference link, key findings and the plan; only then does the work timer start.
-- • The submission goes to the person who assigned the task and to admins as a priority item; they approve it or
--   comment. Work does not wait for approval. Submission, approval and comments appear in the task discussion.
-- • Research time is counted as work time for the day, but not in the task's time-vs-estimate.
-- • Clients never see any of this (task-level visibility only: admins, assignee, assigner, project managers).
-- Additive: new column/table/functions; existing rows are only touched by the one backfill below.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- tasks: research time
alter table public.tasks add column if not exists research_minutes integer;
do $$ begin
  alter table public.tasks add constraint tasks_research_minutes_check check (research_minutes is null or research_minutes between 5 and 480);
exception when duplicate_object then null; end $$;
alter table public.tasks alter column research_minutes set default 30;

-- never-started open tasks get the default research step (approved)
select set_config('sigma.task_rpc', 'on', true);
update public.tasks set research_minutes = 30
where research_minutes is null and archived_at is null and started_at is null and status in ('assigned','accepted');
select set_config('sigma.task_rpc', '', true);

-- ---------------------------------------------------------------- research submissions (one per task)
create table if not exists public.task_research (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  started_at timestamptz not null default now(),
  spent_seconds integer not null default 0 check (spent_seconds >= 0),
  submitted_at timestamptz,
  links text[] not null default '{}',
  findings text check (findings is null or length(findings) <= 3000),
  plan text check (plan is null or length(plan) <= 3000),
  status text not null default 'researching' check (status in ('researching','submitted','approved','commented')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 2000),
  check (status = 'researching' or (submitted_at is not null and cardinality(links) between 1 and 10 and findings is not null and plan is not null))
);
create index if not exists task_research_open_idx on public.task_research(status) where status = 'submitted';
alter table public.task_research enable row level security;
drop policy if exists task_research_select on public.task_research;
create policy task_research_select on public.task_research for select to authenticated using (private.can_view_task(task_id));
revoke insert, update, delete on public.task_research from anon, authenticated;
grant select on public.task_research to authenticated;

-- a discussion entry can point at the research it is about (shown as a card in the chat)
alter table public.task_comments add column if not exists research_id uuid references public.task_research(id) on delete set null;

-- research time vs work time in the timer
alter table public.work_sessions add column if not exists phase text not null default 'work';
do $$ begin
  alter table public.work_sessions add constraint work_sessions_phase_check check (phase in ('work','research') and (phase = 'work' or kind = 'task'));
exception when duplicate_object then null; end $$;

-- the assignee can't change research time by editing the task
create or replace function private.validate_task_update()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  eid uuid := private.current_employee_id();
  is_assignee boolean := (OLD.assigned_to = eid) and (NEW.assigned_to = OLD.assigned_to);
  is_assigner boolean := (OLD.assigned_by is not null) and (OLD.assigned_by = eid);
begin
  NEW.updated_at := now();
  if private.is_admin() or coalesce(current_setting('sigma.task_rpc', true), '') = 'on' then return NEW; end if;
  NEW.time_spent_minutes := OLD.time_spent_minutes; NEW.parent_task_id := OLD.parent_task_id;
  NEW.accepted_at := OLD.accepted_at; NEW.started_at := OLD.started_at;
  NEW.completed_at := OLD.completed_at; NEW.cancelled_at := OLD.cancelled_at;
  NEW.reviewed_by := OLD.reviewed_by; NEW.reviewed_at := OLD.reviewed_at;
  NEW.status_note := OLD.status_note; NEW.created_at := OLD.created_at;
  NEW.status := OLD.status; NEW.submitted_link := OLD.submitted_link; NEW.submitted_at := OLD.submitted_at; NEW.progress_pct := OLD.progress_pct;
  if is_assignee and not is_assigner then
    NEW.title := OLD.title; NEW.description := OLD.description;
    NEW.assigned_to := OLD.assigned_to; NEW.assigned_by := OLD.assigned_by;
    NEW.start_date := OLD.start_date; NEW.due_date := OLD.due_date; NEW.priority := OLD.priority;
    NEW.project_id := OLD.project_id; NEW.deliverable_id := OLD.deliverable_id; NEW.archived_at := OLD.archived_at;
    NEW.research_minutes := OLD.research_minutes; NEW.estimate_minutes := OLD.estimate_minutes;
    return NEW;
  end if;
  if is_assigner then
    if NEW.assigned_to <> OLD.assigned_to and not private.can_assign_task(NEW.assigned_to) then raise exception 'You are not allowed to assign this employee'; end if;
    NEW.assigned_by := OLD.assigned_by;
    return NEW;
  end if;
  raise exception 'Unauthorized task update';
end $function$;

-- no hand-in before the research is in
create or replace function private.task_research_gate()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if NEW.status = 'awaiting_review' and OLD.status is distinct from 'awaiting_review' and NEW.research_minutes is not null
     and not exists (select 1 from public.task_research r where r.task_id = NEW.id and r.submitted_at is not null) then
    raise exception 'Submit your research for this task first' using errcode = 'P0001';
  end if;
  return NEW;
end $function$;
drop trigger if exists task_research_gate on public.tasks;
create trigger task_research_gate before update of status on public.tasks for each row execute function private.task_research_gate();

-- ---------------------------------------------------------------- timer: research phase
create or replace function private.work_close(p_emp uuid, p_at timestamptz, p_reason text)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare s public.work_sessions; v_min int; v_prev text := coalesce(current_setting('sigma.task_rpc', true), '');
begin
  update public.work_sessions set ended_at = greatest(started_at, least(coalesce(p_at, now()), now())), end_reason = p_reason
  where employee_id = p_emp and ended_at is null
  returning * into s;
  if not found then return; end if;
  if s.kind = 'task' and s.phase = 'research' then
    -- research time: kept on the research record, not in the task's time-vs-estimate
    update public.task_research set spent_seconds = spent_seconds + greatest(0, round(extract(epoch from (s.ended_at - s.started_at)))::int)
    where task_id = s.task_id;
  elsif s.kind = 'task' then
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
end $function$;

create or replace function private.work_state(p_emp uuid)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare c public.work_settings := private.work_cfg(); a public.attendance := private.work_attendance_today(p_emp);
  s public.work_sessions; v_cur jsonb; v_last jsonb; v_idle timestamptz; v_first boolean; v_break numeric; v_pending jsonb; v_title text;
  v_rmin int; v_rspent int;
begin
  select * into s from public.work_sessions where employee_id = p_emp and ended_at is null;
  if s.id is not null then
    select title, research_minutes into v_title, v_rmin from public.tasks where id = s.task_id;
    select spent_seconds into v_rspent from public.task_research where task_id = s.task_id;
    v_cur := jsonb_build_object('kind', s.kind, 'task_id', s.task_id, 'title', coalesce(v_title, s.note), 'meeting_type', s.meeting_type,
                                'note', s.note, 'started_at', s.started_at, 'phase', s.phase,
                                'research_minutes', case when s.phase = 'research' then v_rmin end,
                                'research_spent_seconds', case when s.phase = 'research' then coalesce(v_rspent, 0) end);
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
end $function$;

create or replace function public.work_start_task(p_task_id uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_emp uuid := private.current_employee_id(); t public.tasks; s public.work_sessions; v_phase text := 'work';
begin
  perform private.require(v_emp is not null, 'Only employees track work');
  select * into t from public.tasks where id = p_task_id and archived_at is null;
  perform private.require(found and t.assigned_to = v_emp, 'Only the assignee can work on this task');
  perform private.require(t.status not in ('completed','cancelled','awaiting_review'), 'This task isn’t open for work');
  perform private.work_require_working(v_emp);
  if t.research_minutes is not null
     and not exists (select 1 from public.task_research r where r.task_id = t.id and r.submitted_at is not null) then
    v_phase := 'research';
  end if;
  select * into s from public.work_sessions where employee_id = v_emp and ended_at is null;
  if s.id is not null and s.kind = 'task' and s.task_id = t.id and s.phase = v_phase then
    return private.work_state(v_emp);
  end if;
  if t.status in ('assigned','accepted','blocked','revision_required') then
    perform public.task_transition(t.id, 'in_progress');
  end if;
  perform private.work_close(v_emp, now(), 'switch');
  if v_phase = 'research' then
    insert into public.task_research(task_id, employee_id) values (t.id, v_emp) on conflict (task_id) do nothing;
  end if;
  insert into public.work_sessions(employee_id, kind, task_id, phase) values (v_emp, 'task', t.id, v_phase);
  insert into public.work_presence(employee_id, last_seen_at) values (v_emp, now())
  on conflict (employee_id) do update set last_seen_at = now();
  perform private.work_next_check(v_emp);
  return private.work_state(v_emp);
end $function$;

-- ---------------------------------------------------------------- set research time (whoever assigned the task)
create or replace function public.task_set_research(p_task_id uuid, p_minutes integer)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and archived_at is null for update;
  perform private.require(found and private.task_is_reviewer(t), 'Only the person who assigned the task can set its research time');
  perform private.require(p_minutes between 5 and 480, 'Research time must be between 5 minutes and 8 hours');
  perform private.require(not exists (select 1 from public.task_research r where r.task_id = t.id and r.submitted_at is not null),
    'The research for this task is already in');
  perform set_config('sigma.task_rpc', 'on', true);
  update public.tasks set research_minutes = p_minutes where id = t.id;
  perform set_config('sigma.task_rpc', '', true);
end $function$;

-- ---------------------------------------------------------------- submit research → work timer starts
create or replace function public.task_research_submit(p_task_id uuid, p_links text[], p_findings text, p_plan text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_emp uuid := private.current_employee_id(); t public.tasks; r public.task_research; s public.work_sessions;
  v_links text[]; v_find text := btrim(coalesce(p_findings, '')); v_plan text := btrim(coalesce(p_plan, ''));
  v_body text; v_cid uuid; v_who text; v_spent int; v_profile uuid; v_working boolean;
begin
  perform private.require(v_emp is not null, 'Only employees submit research');
  select * into t from public.tasks where id = p_task_id and archived_at is null for update;
  perform private.require(found and t.assigned_to = v_emp, 'Only the assignee can submit research for this task');
  perform private.require(t.research_minutes is not null, 'This task has no research step');
  select coalesce(array_agg(x), '{}') into v_links
    from (select btrim(u) as x from unnest(coalesce(p_links, '{}')) u where btrim(u) <> '') q;
  perform private.require(cardinality(v_links) between 1 and 10, 'Add at least one reference link (up to 10)');
  perform private.require(not exists (select 1 from unnest(v_links) u where u !~* '^https?://\S+$' or length(u) > 500),
    'Each link must start with http:// or https://');
  perform private.require(length(v_find) between 10 and 3000, 'Write your key findings (at least 10 characters)');
  perform private.require(length(v_plan) between 10 and 3000, 'Write your plan / direction (at least 10 characters)');

  -- close a running research timer for this task first, so its time is counted
  select * into s from public.work_sessions where employee_id = v_emp and ended_at is null;
  v_working := s.id is not null and s.task_id = t.id and s.phase = 'research';
  if v_working then perform private.work_close(v_emp, now(), 'switch'); end if;

  insert into public.task_research(task_id, employee_id) values (t.id, v_emp) on conflict (task_id) do nothing;
  select * into r from public.task_research where task_id = t.id for update;
  perform private.require(r.submitted_at is null, 'Research for this task was already submitted');
  update public.task_research set links = v_links, findings = v_find, plan = v_plan, submitted_at = now(), status = 'submitted'
  where id = r.id returning spent_seconds into v_spent;

  v_body := 'Research submitted · ' || greatest(1, round(v_spent / 60.0))::int || ' min of ' || t.research_minutes || ' min planned' || E'\n\n'
    || 'Links:' || E'\n' || (select string_agg('• ' || u, E'\n') from unnest(v_links) u) || E'\n\n'
    || 'Key findings:' || E'\n' || v_find || E'\n\n' || 'Plan:' || E'\n' || v_plan;
  insert into public.task_comments(task_id, author_id, body, research_id) values (t.id, auth.uid(), left(v_body, 4000), r.id) returning id into v_cid;

  -- priority alert: whoever assigned it, the project's managers, and every admin
  select name into v_who from public.employees where id = v_emp;
  if t.assigned_by is not null then
    select profile_id into v_profile from public.employees where id = t.assigned_by and status = 'active';
    if v_profile is not null then
      perform private.notify(v_profile, 'task', 'Research ready to review', coalesce(v_who, 'Someone') || ' finished research for "' || t.title || '"',
        '/emp-tasks?task=' || t.id, 'task_research_' || r.id, jsonb_build_object('kind', 'research', 'task_id', t.id, 'research_id', r.id));
    end if;
  end if;
  perform private.notify(p.id, 'task', 'Research ready to review', coalesce(v_who, 'Someone') || ' finished research for "' || t.title || '"',
      '/admin-tasks?task=' || t.id, 'task_research_' || r.id, jsonb_build_object('kind', 'research', 'task_id', t.id, 'research_id', r.id))
  from public.profiles p where p.role = 'admin';

  -- the work timer starts now (if they were researching and are still at work)
  if v_working then
    insert into public.work_sessions(employee_id, kind, task_id, phase) values (v_emp, 'task', t.id, 'work');
    perform private.work_next_check(v_emp);
  end if;
  return private.work_state(v_emp);
end $function$;

-- ---------------------------------------------------------------- review: approve or comment
create or replace function public.task_research_review(p_task_id uuid, p_decision text, p_note text default null)
 returns text language plpgsql security definer set search_path to ''
as $function$
declare t public.tasks; r public.task_research; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_body text; v_status text;
begin
  select * into t from public.tasks where id = p_task_id and archived_at is null;
  perform private.require(found and private.task_is_reviewer(t), 'Only the person who assigned the task, its project manager or an admin can review its research');
  perform private.require(p_decision in ('approve','comment'), 'Unknown decision');
  select * into r from public.task_research where task_id = t.id for update;
  perform private.require(found and r.submitted_at is not null, 'No research has been submitted for this task yet');
  perform private.require(p_decision = 'approve' or v_note is not null, 'Write your comment');
  perform private.require(v_note is null or length(v_note) <= 2000, 'Comment is too long');
  perform private.require(not (p_decision = 'approve' and r.status = 'approved'), 'Already approved');
  v_status := case when p_decision = 'approve' then 'approved' when r.status = 'approved' then 'approved' else 'commented' end;
  update public.task_research set status = v_status, reviewed_by = auth.uid(), reviewed_at = now(),
    review_note = coalesce(v_note, review_note) where id = r.id;
  v_body := case when p_decision = 'approve' then 'Research approved' || coalesce(' — ' || v_note, '') else 'On the research: ' || v_note end;
  insert into public.task_comments(task_id, author_id, body, research_id) values (t.id, auth.uid(), v_body, r.id);
  perform private.notify_employee(t.assigned_to, 'task',
    case when p_decision = 'approve' then 'Research approved' else 'Comment on your research' end,
    '"' || t.title || '": ' || left(coalesce(v_note, 'Looks good — carry on.'), 140), '/emp-tasks?task=' || t.id,
    'task_research_review_' || r.id || '_' || p_decision || '_' || (select count(*) from public.task_comments c where c.research_id = r.id));
  return v_status;
end $function$;

-- ---------------------------------------------------------------- what's waiting for me (Sigma's priority list)
create or replace function public.task_research_inbox()
 returns table(research_id uuid, task_id uuid, task_title text, employee_name text, submitted_at timestamptz, spent_seconds integer, research_minutes integer)
 language sql stable security definer set search_path to ''
as $function$
  select r.id, t.id, t.title, e.name, r.submitted_at, r.spent_seconds, t.research_minutes
  from public.task_research r
  join public.tasks t on t.id = r.task_id and t.archived_at is null
  join public.employees e on e.id = r.employee_id
  where r.status = 'submitted' and private.task_is_reviewer(t)
    and (t.assigned_to is distinct from private.current_employee_id())
  order by r.submitted_at
  limit 20
$function$;

revoke all on function public.task_set_research(uuid, integer) from public, anon;
revoke all on function public.task_research_submit(uuid, text[], text, text) from public, anon;
revoke all on function public.task_research_review(uuid, text, text) from public, anon;
revoke all on function public.task_research_inbox() from public, anon;
grant execute on function public.task_set_research(uuid, integer) to authenticated;
grant execute on function public.task_research_submit(uuid, text[], text, text) to authenticated;
grant execute on function public.task_research_review(uuid, text, text) to authenticated;
grant execute on function public.task_research_inbox() to authenticated;
