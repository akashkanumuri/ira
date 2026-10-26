-- SIGMA 1 — admin activity alerts + server-side push delivery
--
-- 1. Every row written to public.notifications is delivered to the recipient's devices by the server
--    (pg_net → push-worker edge function), so delivery no longer depends on a browser staying open.
--    Rows are claimed atomically; a cron tick retries anything that didn't go out.
-- 2. Admins get "activity" notifications when people sign in/out, check in/out, take breaks,
--    start/stop/switch tasks or meetings, and hand in tasks. Each admin can switch each kind off.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------- types, columns, preferences
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'attendance','leave','wfh','task','holiday','payroll','system','contract','deliverable','dependency',
  'modification','billing','client','activity'
]));

-- why a session ended: 'logout' (user signed out) or 'replaced' (closed by a newer sign-in)
alter table public.auth_sessions add column if not exists end_reason text;

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  activity jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
drop policy if exists notif_prefs_select_own on public.notification_preferences;
drop policy if exists notif_prefs_insert_own on public.notification_preferences;
drop policy if exists notif_prefs_update_own on public.notification_preferences;
create policy notif_prefs_select_own on public.notification_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy notif_prefs_insert_own on public.notification_preferences for insert to authenticated with check (user_id = (select auth.uid()));
create policy notif_prefs_update_own on public.notification_preferences for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on public.notification_preferences to authenticated;

-- ---------------------------------------------------------------- formatting helpers
create or replace function private.ist_time(p_ts timestamptz) returns text
language sql immutable set search_path = '' as $$
  select to_char(p_ts at time zone 'Asia/Kolkata', 'FMHH12:MI AM')
$$;

create or replace function private.fmt_duration(p_seconds integer) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_seconds is null then null
    when p_seconds < 60 then 'under a minute'
    when p_seconds < 3600 then (p_seconds / 60) || ' min'
    else (p_seconds / 3600) || 'h ' || ((p_seconds % 3600) / 60) || 'm'
  end
$$;

create or replace function private.device_label(p_ua text) returns text
language sql immutable set search_path = '' as $$
  select case
      when p_ua ilike '%edg/%' then 'Edge'
      when p_ua ilike '%firefox/%' then 'Firefox'
      when p_ua ilike '%chrome/%' or p_ua ilike '%crios/%' then 'Chrome'
      when p_ua ilike '%safari/%' then 'Safari'
      else 'Browser' end
    || ' on ' ||
    case
      when p_ua ilike '%iphone%' then 'iPhone'
      when p_ua ilike '%ipad%' then 'iPad'
      when p_ua ilike '%android%' then 'Android'
      when p_ua ilike '%windows%' then 'Windows'
      when p_ua ilike '%mac os%' or p_ua ilike '%macintosh%' then 'Mac'
      when p_ua ilike '%linux%' then 'Linux'
      else 'unknown device' end
$$;

-- who a profile is, for activity text: employee name, or "Name (Company)" for client users; null for admins
create or replace function private.person_label(p_profile uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_role text; v text;
begin
  select role into v_role from public.profiles where id = p_profile;
  if v_role is null or v_role = 'admin' then return null; end if;
  if v_role = 'client' then
    select coalesce(nullif(cu.full_name, ''), cu.email) || ' (' || c.company_name || ')' into v
      from public.client_users cu join public.clients c on c.id = cu.client_id
     where cu.profile_id = p_profile limit 1;
    if v is null then select c.company_name || ' (client)' into v from public.clients c where c.profile_id = p_profile limit 1; end if;
    return coalesce(v, 'A client');
  end if;
  select name into v from public.employees where profile_id = p_profile limit 1;
  return coalesce(v, 'A team member');
end $$;

create or replace function private.employee_label(p_employee uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select name from public.employees where id = p_employee), 'A team member')
$$;

-- ---------------------------------------------------------------- fan-out to admins (respects preferences)
-- kinds: signin, checkin, break, task, done
create or replace function private.notify_admins_activity(p_kind text, p_title text, p_message text, p_url text, p_key text, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select p.id from public.profiles p
    left join public.notification_preferences np on np.user_id = p.id
    where p.role = 'admin' and p.id is distinct from auth.uid()
      and coalesce((np.activity ->> p_kind)::boolean, true)
  loop
    perform private.notify(r.id, 'activity', p_title, p_message, p_url, p_key, coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('activity', p_kind));
  end loop;
end $$;

-- ---------------------------------------------------------------- activity triggers
create or replace function private.act_auth_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_who text;
begin
  v_who := private.person_label(NEW.user_id);
  if v_who is null then return NEW; end if;
  if TG_OP = 'INSERT' and NEW.status = 'active' then
    perform private.notify_admins_activity('signin', v_who || ' signed in',
      private.ist_time(NEW.login_at) || ' · ' || private.device_label(NEW.user_agent),
      '/admin-activity', 'act_signin_' || NEW.id, jsonb_build_object('user_id', NEW.user_id));
  elsif TG_OP = 'UPDATE' and OLD.status = 'active' and NEW.status = 'ended' and NEW.end_reason = 'logout' then
    perform private.notify_admins_activity('signin', v_who || ' signed out',
      private.ist_time(coalesce(NEW.logout_at, now())) || coalesce(' · after ' || private.fmt_duration(NEW.session_duration_seconds), ''),
      '/admin-activity', 'act_signout_' || NEW.id, jsonb_build_object('user_id', NEW.user_id));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_act_auth_session on public.auth_sessions;
create trigger trg_act_auth_session after insert or update of status on public.auth_sessions
  for each row execute function private.act_auth_session();

create or replace function private.act_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_who text := private.employee_label(NEW.employee_id); v_secs integer;
begin
  if TG_OP = 'INSERT' then
    if NEW.check_in_at is not null and NEW.check_out_at is null then
      perform private.notify_admins_activity('checkin', v_who || ' checked in',
        private.ist_time(NEW.check_in_at) || ' · ' || case NEW.mode when 'wfh' then 'working from home' when 'remote' then 'remote' else 'office' end,
        '/admin-attendance', 'act_checkin_' || NEW.id, jsonb_build_object('employee_id', NEW.employee_id));
    end if;
  elsif OLD.check_out_at is null and NEW.check_out_at is not null then
    v_secs := coalesce(nullif(NEW.working_seconds, 0),
      greatest(0, extract(epoch from (NEW.check_out_at - NEW.check_in_at))::int - coalesce(NEW.total_break_seconds, 0)));
    perform private.notify_admins_activity('checkin', v_who || ' checked out',
      private.ist_time(NEW.check_out_at) || coalesce(' · worked ' || private.fmt_duration(v_secs), ''),
      '/admin-attendance', 'act_checkout_' || NEW.id, jsonb_build_object('employee_id', NEW.employee_id));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_act_attendance on public.attendance;
create trigger trg_act_attendance after insert or update of check_out_at on public.attendance
  for each row execute function private.act_attendance();

create or replace function private.act_break() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_who text := private.employee_label(NEW.employee_id);
begin
  if TG_OP = 'INSERT' and NEW.break_end is null then
    perform private.notify_admins_activity('break', v_who || ' is on a break', private.ist_time(NEW.break_start),
      '/admin-attendance', 'act_break_' || NEW.id, jsonb_build_object('employee_id', NEW.employee_id));
  elsif TG_OP = 'UPDATE' and OLD.break_end is null and NEW.break_end is not null then
    perform private.notify_admins_activity('break', v_who || ' is back from break',
      private.ist_time(NEW.break_end) || ' · ' || private.fmt_duration(coalesce(NEW.duration_seconds, extract(epoch from (NEW.break_end - NEW.break_start))::int)),
      '/admin-attendance', 'act_breakend_' || NEW.id, jsonb_build_object('employee_id', NEW.employee_id));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_act_break on public.break_events;
create trigger trg_act_break after insert or update of break_end on public.break_events
  for each row execute function private.act_break();

create or replace function private.act_work_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_who text := private.employee_label(NEW.employee_id);
  v_what text; v_prev record; v_reason text;
begin
  v_what := case when NEW.kind = 'task'
    then '“' || coalesce((select title from public.tasks where id = NEW.task_id), 'a task') || '”'
    else coalesce(initcap(replace(NEW.meeting_type, '_', ' ')) || ' meeting', 'a meeting') end;
  if TG_OP = 'INSERT' then
    -- a switch ends one session and starts the next in the same moment: report it once, as a switch
    select ws.kind, ws.task_id, ws.meeting_type into v_prev from public.work_sessions ws
     where ws.employee_id = NEW.employee_id and ws.id <> NEW.id and ws.end_reason = 'switch'
       and ws.ended_at between NEW.started_at - interval '10 seconds' and NEW.started_at + interval '10 seconds'
     order by ws.ended_at desc limit 1;
    if found then
      perform private.notify_admins_activity('task', v_who || ' switched to ' || case when NEW.kind = 'task' then 'another task' else 'a meeting' end,
        v_what || ' · ' || private.ist_time(NEW.started_at), '/admin-worktime', 'act_ws_' || NEW.id,
        jsonb_build_object('employee_id', NEW.employee_id, 'task_id', NEW.task_id));
    else
      perform private.notify_admins_activity('task', v_who || case when NEW.kind = 'task' then ' started a task' else ' started a meeting' end,
        v_what || ' · ' || private.ist_time(NEW.started_at), '/admin-worktime', 'act_ws_' || NEW.id,
        jsonb_build_object('employee_id', NEW.employee_id, 'task_id', NEW.task_id));
    end if;
  elsif OLD.ended_at is null and NEW.ended_at is not null and coalesce(NEW.end_reason, '') <> 'switch' then
    v_reason := case NEW.end_reason
      when 'pause' then 'paused' when 'logout' then 'checked out' when 'checkout' then 'checked out'
      when 'missed_check' then 'missed the check-in' when 'break' then 'went on a break'
      when 'complete' then 'finished' when 'completed' then 'finished' else nullif(replace(NEW.end_reason, '_', ' '), '') end;
    perform private.notify_admins_activity('task', v_who || case when NEW.kind = 'task' then ' stopped a task' else ' ended a meeting' end,
      v_what || ' · ' || private.fmt_duration(extract(epoch from (NEW.ended_at - NEW.started_at))::int) || coalesce(' · ' || v_reason, ''),
      '/admin-worktime', 'act_wsend_' || NEW.id, jsonb_build_object('employee_id', NEW.employee_id, 'task_id', NEW.task_id));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_act_work_session on public.work_sessions;
create trigger trg_act_work_session after insert or update of ended_at on public.work_sessions
  for each row execute function private.act_work_session();

-- task handed in / completed by the assignee (skipped when admins already get the reviewer notification)
create or replace function private.act_task_done() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if NEW.status is distinct from OLD.status and NEW.status in ('awaiting_review', 'completed')
     and NEW.assigned_by is not null and private.current_employee_id() = NEW.assigned_to then
    perform private.notify_admins_activity('done',
      private.employee_label(NEW.assigned_to) || case NEW.status when 'completed' then ' completed a task' else ' handed in a task' end,
      '“' || NEW.title || '”', '/admin-tasks?task=' || NEW.id,
      'act_done_' || NEW.id || '_' || extract(epoch from NEW.updated_at)::bigint,
      jsonb_build_object('employee_id', NEW.assigned_to, 'task_id', NEW.id));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_act_task_done on public.tasks;
create trigger trg_act_task_done after update of status on public.tasks
  for each row execute function private.act_task_done();

-- ---------------------------------------------------------------- server-side push delivery
-- shared secret between the database and the push-worker function, generated here and kept in Vault
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_hook_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_hook_secret', 'Shared secret: database → push-worker');
  end if;
end $$;

create or replace function public.push_hook_secret() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = 'push_hook_secret');
end $$;
revoke all on function public.push_hook_secret() from public, anon, authenticated;
grant execute on function public.push_hook_secret() to service_role;

-- wake the worker (asynchronous; never blocks or fails the caller's transaction)
create or replace function private.ping_push_worker() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://htxalzgotwsbicseyigu.supabase.co/functions/v1/push-worker',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-push-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_hook_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000);
exception when others then
  null; -- delivery is retried by the cron tick
end $$;

create or replace function private.trg_notifications_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ping_push_worker();
  return null;
end $$;

drop trigger if exists trg_notifications_push on public.notifications;
create trigger trg_notifications_push after insert on public.notifications
  for each statement execute function private.trg_notifications_push();

-- claim a batch of undelivered notifications (only recent ones; never re-blasts history)
create or replace function public.claim_push_batch(p_limit integer default 50)
returns table(id uuid, recipient_id uuid, type text, title text, message text, action_url text, metadata jsonb, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  return query
  with c as (
    select n.id from public.notifications n
    where n.created_at > now() - interval '2 hours'
      and (
        coalesce(n.metadata ->> 'push_state', '') = ''
        or (n.metadata ->> 'push_state' in ('sending', 'failed')
            and (n.metadata ->> 'push_claimed_at')::timestamptz < now() - interval '2 minutes'
            and coalesce((n.metadata ->> 'push_attempts')::int, 0) < 3)
      )
    order by n.created_at
    limit greatest(1, least(p_limit, 200))
    for update skip locked
  )
  update public.notifications n
     set metadata = n.metadata || jsonb_build_object('push_state', 'sending', 'push_claimed_at', now(),
                                                    'push_attempts', coalesce((n.metadata ->> 'push_attempts')::int, 0) + 1)
    from c where n.id = c.id
  returning n.id, n.recipient_id, n.type, n.title, n.message, n.action_url, n.metadata, n.created_at;
end $$;
revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;

create or replace function public.finish_push(p_id uuid, p_state text, p_delivered integer default 0, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  update public.notifications
     set metadata = metadata || jsonb_build_object('push_state', p_state, 'pushed_at', now(), 'push_delivered', coalesce(p_delivered, 0))
                             || case when p_error is null then '{}'::jsonb else jsonb_build_object('push_error', left(p_error, 300)) end
   where id = p_id;
end $$;
revoke all on function public.finish_push(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.finish_push(uuid, text, integer, text) to service_role;

-- safety net: every minute, wake the worker if anything recent is still undelivered
create or replace function private.push_retry_tick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.notifications n
    where n.created_at > now() - interval '2 hours' and n.created_at < now() - interval '20 seconds'
      and (coalesce(n.metadata ->> 'push_state', '') = ''
           or (n.metadata ->> 'push_state' in ('sending', 'failed') and (n.metadata ->> 'push_claimed_at')::timestamptz < now() - interval '2 minutes'
               and coalesce((n.metadata ->> 'push_attempts')::int, 0) < 3))
  ) then
    perform private.ping_push_worker();
  end if;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sigma-push-retry') then
    perform cron.unschedule('sigma-push-retry');
  end if;
  perform cron.schedule('sigma-push-retry', '* * * * *', 'select private.push_retry_tick();');
end $$;

-- don't push the backlog that existed before this pipeline: mark it as already handled
update public.notifications
   set metadata = metadata || jsonb_build_object('push_state', 'legacy')
 where coalesce(metadata ->> 'push_state', '') = '';
