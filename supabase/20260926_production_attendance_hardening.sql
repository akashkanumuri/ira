-- IRA Presence production hardening
-- Removes location/geofence requirements. Attendance is enforced by approved
-- WFH/leave/holiday rules and server-side timestamps.

begin;

create or replace function public.ira_validate_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  local_date date := (now() at time zone 'Asia/Kolkata')::date;
  shift_start time;
begin
  new.date := local_date;
  new.check_in_at := now();

  if extract(isodow from local_date) = 7 then
    raise exception 'Attendance is not available on Sunday.';
  end if;

  if exists (select 1 from public.holidays h where h.date = local_date) then
    raise exception 'Attendance is not available on a company holiday.';
  end if;

  if exists (
    select 1
    from public.leave_requests l
    where l.employee_id = new.employee_id
      and local_date between l.start_date and l.end_date
      and l.status = 'approved'
      and l.leave_type <> 'unpaid'
  ) then
    raise exception 'Approved leave exists for today.';
  end if;

  if new.mode = 'wfh' then
    if not exists (
      select 1 from public.wfh_requests w
      where w.employee_id = new.employee_id
        and w.date = local_date
        and w.status = 'approved'
    ) then
      raise exception 'WFH is not approved for today.';
    end if;
    new.status := 'wfh';
  else
    select e.shift_start into shift_start
    from public.employees e
    where e.id = new.employee_id;

    if shift_start is null then
      shift_start := '09:00';
    end if;

    new.status := case
      when (now() at time zone 'Asia/Kolkata')::time >
           (shift_start + interval '15 minutes')
      then 'late'
      else 'present'
    end;
  end if;

  new.current_state := 'working';
  new.total_break_seconds := 0;
  new.working_seconds := 0;
  return new;
end;
$$;

drop trigger if exists trg_ira_validate_attendance on public.attendance;
create trigger trg_ira_validate_attendance
before insert on public.attendance
for each row execute function public.ira_validate_attendance();

create or replace function public.ira_attendance_server_times()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  break_total integer;
begin
  if new.current_state = 'completed' and old.check_out_at is null then
    new.check_out_at := now();
    select coalesce(sum(coalesce(duration_seconds, 0)), 0)
      into break_total
      from public.break_events
      where attendance_id = new.id
        and break_end is not null;
    new.total_break_seconds := break_total;
    new.working_seconds := greatest(
      0,
      floor(extract(epoch from (new.check_out_at - new.check_in_at)))::integer - break_total
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ira_attendance_server_times on public.attendance;
create trigger trg_ira_attendance_server_times
before update on public.attendance
for each row execute function public.ira_attendance_server_times();

create or replace function public.ira_break_server_times()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.attendance a
      where a.id = new.attendance_id
        and a.employee_id = new.employee_id
        and a.current_state = 'working'
        and a.check_out_at is null
    ) then
      raise exception 'Attendance is not in a working state.';
    end if;
    new.break_start := now();
    new.break_end := null;
    new.duration_seconds := null;
    return new;
  end if;

  if old.break_end is null and new.break_end is not null then
    new.break_end := now();
    new.duration_seconds := greatest(
      0,
      floor(extract(epoch from (new.break_end - old.break_start)))::integer
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ira_break_server_times on public.break_events;
create trigger trg_ira_break_server_times
before insert or update on public.break_events
for each row execute function public.ira_break_server_times();

create or replace function public.ira_event_server_time()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.event_at := now();
  return new;
end;
$$;

drop trigger if exists trg_ira_event_server_time on public.attendance_events;
create trigger trg_ira_event_server_time
before insert on public.attendance_events
for each row execute function public.ira_event_server_time();

-- Realtime is required by the dashboard/history/admin views.
do $$
declare
  t text;
begin
  foreach t in array array[
    'attendance',
    'attendance_events',
    'auth_sessions',
    'break_events',
    'employees',
    'holidays',
    'leave_requests',
    'regularization_requests',
    'wfh_requests'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;