-- Migration: 20261009120000_v2_auto_checkout_office_attendance.sql
-- Description: Server-side automatic checkout at 8:00 PM IST for Office shifts without manual checkout.
-- Rule A: Office shifts automatically checked out at 8:00 PM IST if not checked out manually.
-- Rule B: Work From Home (WFH) shifts are strictly EXCLUDED from automatic checkout.
-- Security: Gated to background worker sessions only (session_user = 'postgres' AND auth.uid() IS NULL).
-- Resilient: Uses 8:00 PM IST as checkout timestamp even if scheduler runs later.
-- Idempotent: Safely skips already completed sessions; handles concurrency with FOR UPDATE SKIP LOCKED.

-- 1. Harden private.validate_attendance_update to support background system auto-checkout
CREATE OR REPLACE FUNCTION private.validate_attendance_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  is_admin boolean := private.is_admin();
  eid uuid := private.current_employee_id();
  open_break boolean;
begin
  -- Hardened background system auto-checkout bypass:
  -- 1. Strictly require session_user = 'postgres' (PostgREST callers connect as 'authenticator' and cannot spoof this)
  -- 2. Strictly require auth.uid() IS NULL (ensures no authenticated client JWT session is active)
  -- 3. Strictly require transaction-local GUC ira.system_auto_checkout = 'on'
  if session_user = 'postgres'
     and auth.uid() is null
     and coalesce(current_setting('ira.system_auto_checkout', true), 'off') = 'on' then

    -- Strictly require that the record being processed is OFFICE mode
    if OLD.mode <> 'office' then
      raise exception 'System auto-checkout is only permitted for office attendance';
    end if;

    -- Strictly preserve immutable core attendance fields
    NEW.id := OLD.id;
    NEW.employee_id := OLD.employee_id;
    NEW.date := OLD.date;
    NEW.mode := OLD.mode;
    NEW.status := OLD.status;
    NEW.check_in_at := OLD.check_in_at;
    NEW.wfh_request_id := OLD.wfh_request_id;
    NEW.leave_request_id := OLD.leave_request_id;
    NEW.created_at := OLD.created_at;

    -- Never overwrite an existing manual checkout timestamp
    if OLD.check_out_at is not null then
      raise exception 'Attendance record already has checkout timestamp';
    end if;

    -- Transition A: Intermediate break synchronization from private.sync_break_state()
    open_break := exists(select 1 from public.break_events b where b.attendance_id = OLD.id and b.break_end is null);
    if OLD.current_state = 'on_break' and NEW.current_state = 'working' and not open_break then
      NEW.updated_at := now();
      return NEW;
    end if;

    -- Transition B: Final checkout completion
    if NEW.current_state = 'completed' and NEW.check_out_at is not null then
      if open_break then
        raise exception 'Cannot auto-checkout attendance with active open break';
      end if;
      if NEW.check_out_at < OLD.check_in_at then
        raise exception 'Checkout time cannot be before check-in time';
      end if;
      NEW.updated_at := now();
      return NEW;
    end if;

    raise exception 'Invalid system attendance transition';
  end if;

  if is_admin then
    NEW.updated_at := now();
    return NEW;
  end if;

  if eid is null or OLD.employee_id <> eid then
    raise exception 'Unauthorized attendance update';
  end if;

  NEW.id := OLD.id;
  NEW.employee_id := OLD.employee_id;
  NEW.date := OLD.date;
  NEW.mode := OLD.mode;
  NEW.status := OLD.status;
  NEW.check_in_at := OLD.check_in_at;
  NEW.check_out_at := OLD.check_out_at;
  NEW.working_seconds := OLD.working_seconds;
  NEW.total_break_seconds := OLD.total_break_seconds;
  NEW.wfh_request_id := OLD.wfh_request_id;
  NEW.leave_request_id := OLD.leave_request_id;
  NEW.notes := OLD.notes;
  NEW.created_at := OLD.created_at;

  open_break := exists(select 1 from public.break_events b where b.attendance_id=OLD.id and b.break_end is null);
  if OLD.current_state='working' and NEW.current_state='on_break' and open_break then
    NEW.updated_at := now();
    return NEW;
  end if;

  if OLD.current_state='on_break' and NEW.current_state='working' and not open_break then
    NEW.updated_at := now();
    return NEW;
  end if;

  if OLD.current_state='working' and NEW.current_state='completed' then
    if open_break then raise exception 'Resume work before checking out'; end if;
    NEW.check_out_at := coalesce(NEW.check_out_at, now());
    NEW.total_break_seconds := coalesce(OLD.total_break_seconds, 0);
    NEW.working_seconds := greatest(0, floor(extract(epoch from (NEW.check_out_at - OLD.check_in_at)))::integer - NEW.total_break_seconds);
    NEW.updated_at := now();
    insert into public.attendance_events(attendance_id, event_type, event_at, user_agent, metadata)
    values(OLD.id, 'check_out', NEW.check_out_at, null, '{}'::jsonb);
    return NEW;
  end if;

  raise exception 'Invalid attendance state transition';
end;
$function$;

-- 2. Harden private.validate_break_update to permit closing open breaks during auto-checkout
CREATE OR REPLACE FUNCTION private.validate_break_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  eid uuid := private.current_employee_id();
  end_at timestamptz;
begin
  -- Hardened background system auto-checkout bypass:
  if session_user = 'postgres'
     and auth.uid() is null
     and coalesce(current_setting('ira.system_auto_checkout', true), 'off') = 'on' then

    -- Pin immutable fields
    NEW.id := OLD.id;
    NEW.attendance_id := OLD.attendance_id;
    NEW.employee_id := OLD.employee_id;
    NEW.break_start := OLD.break_start;
    NEW.created_at := OLD.created_at;

    if OLD.break_end is not null then
      raise exception 'Break is already closed';
    end if;

    -- Verify parent attendance mode is office
    if not exists (
      select 1 from public.attendance a
      where a.id = OLD.attendance_id and a.mode = 'office'
    ) then
      raise exception 'System break closure is only allowed for office attendance';
    end if;

    end_at := coalesce(NEW.break_end, now());
    if end_at <= OLD.break_start then
      end_at := OLD.break_start;
    end if;

    NEW.break_end := end_at;
    NEW.duration_seconds := greatest(0, floor(extract(epoch from (end_at - OLD.break_start)))::integer);
    return NEW;
  end if;

  if eid is null or OLD.employee_id <> eid then
    raise exception 'Unauthorized break update';
  end if;

  NEW.id := OLD.id;
  NEW.attendance_id := OLD.attendance_id;
  NEW.employee_id := OLD.employee_id;
  NEW.break_start := OLD.break_start;
  NEW.created_at := OLD.created_at;

  if OLD.break_end is not null then
    raise exception 'Break is already closed';
  end if;

  end_at := coalesce(NEW.break_end, now());
  if end_at <= OLD.break_start then
    raise exception 'Break end must be after break start';
  end if;

  NEW.break_end := end_at;
  NEW.duration_seconds := greatest(0, floor(extract(epoch from (end_at - OLD.break_start)))::integer);
  return NEW;
end;
$function$;

-- 3. Authoritative scheduled function for 8:00 PM IST Office auto-checkout
CREATE OR REPLACE FUNCTION private.auto_checkout_office_sessions(
  p_target_date date default (now() at time zone 'Asia/Kolkata')::date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  r record;
  cur_ist_time time := (now() at time zone 'Asia/Kolkata')::time;
  cur_ist_date date := (now() at time zone 'Asia/Kolkata')::date;
  target_checkout_at timestamptz;
  calc_break_seconds integer;
  calc_working_seconds integer;
  processed_count integer := 0;
begin
  -- Restrict execution to internal superuser or service_role
  if session_user <> 'postgres' and current_user <> 'service_role' and current_user <> 'postgres' then
    raise exception 'Access denied: private.auto_checkout_office_sessions is restricted to internal system callers';
  end if;

  -- Set transaction-local bypass flag
  perform set_config('ira.system_auto_checkout', 'on', true);

  -- Only process office attendance sessions that are still open
  -- STRICT RULE B: mode = 'wfh' is strictly EXCLUDED
  for r in
    select a.*
    from public.attendance a
    where a.mode = 'office'
      and a.current_state <> 'completed'
      and a.check_out_at is null
      and a.date <= coalesce(p_target_date, cur_ist_date)
      and (
        a.date < cur_ist_date
        or (a.date = cur_ist_date and cur_ist_time >= '20:00:00'::time)
      )
    order by a.date asc, a.check_in_at asc
    for update of a skip locked
  loop
    -- Target checkout time is strictly 8:00 PM IST on that attendance date
    target_checkout_at := (r.date || ' 20:00:00+05:30')::timestamptz;

    -- Edge case A: If check-in happened after 8:00 PM IST, use check-in timestamp
    if r.check_in_at > target_checkout_at then
      target_checkout_at := r.check_in_at;
    end if;

    -- Close open breaks safely:
    -- If a break started before 8:00 PM IST, close it at 8:00 PM IST (duration = 20:00 - break_start).
    -- If a break started at or after 8:00 PM IST, close it at its own start timestamp (duration = 0).
    update public.break_events
    set break_end = case
          when break_start >= target_checkout_at then break_start
          else target_checkout_at
        end,
        duration_seconds = case
          when break_start >= target_checkout_at then 0
          else greatest(0, floor(extract(epoch from (target_checkout_at - break_start)))::integer)
        end
    where attendance_id = r.id
      and break_end is null;

    -- Calculate total break duration
    select coalesce(sum(duration_seconds), 0)
    into calc_break_seconds
    from public.break_events
    where attendance_id = r.id;

    -- Calculate net working duration
    calc_working_seconds := greatest(0, floor(extract(epoch from (target_checkout_at - r.check_in_at)))::integer - calc_break_seconds);

    -- Update attendance row to completed
    update public.attendance
    set check_out_at = target_checkout_at,
        current_state = 'completed',
        total_break_seconds = calc_break_seconds,
        working_seconds = calc_working_seconds,
        notes = case
          when notes is null or notes = '' then 'Auto-checked out at 8:00 PM IST'
          else notes || ' | Auto-checked out at 8:00 PM IST'
        end,
        updated_at = now()
    where id = r.id;

    -- Record immutable audit event
    insert into public.attendance_events(attendance_id, event_type, event_at, user_agent, metadata)
    values (
      r.id,
      'check_out',
      target_checkout_at,
      'system_auto_checkout',
      jsonb_build_object(
        'auto_checkout', true,
        'mode', 'office',
        'scheduled_time', '20:00:00 IST',
        'execution_at', now()
      )
    );

    processed_count := processed_count + 1;
  end loop;

  -- Reset bypass flag before returning
  perform set_config('ira.system_auto_checkout', 'off', true);
  return processed_count;
exception
  when others then
    perform set_config('ira.system_auto_checkout', 'off', true);
    raise;
end;
$function$;

-- 4. Revoke access from public/authenticated/anon and grant only to internal postgres/service_role
revoke all on function private.auto_checkout_office_sessions(date) from public, authenticated, anon;
grant execute on function private.auto_checkout_office_sessions(date) to postgres, service_role;

-- 5. Register pg_cron scheduled job at 8:00 PM IST (14:30 UTC) daily
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'ira-office-auto-checkout') then
      perform cron.unschedule('ira-office-auto-checkout');
    end if;

    perform cron.schedule(
      'ira-office-auto-checkout',
      '30 14 * * *',
      $$select private.auto_checkout_office_sessions();$$
    );
  end if;
end $$;
