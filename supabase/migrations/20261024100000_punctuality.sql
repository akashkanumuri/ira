-- SIGMA 1 — punctuality: office timing (check-in/out vs the employee's shift) and deadlines
-- (tasks and drafts handed in by their due date). Read-only functions; no table changes.
-- Visible to the employee, their reporting manager, and HR/admin (kra.manage).
-- "Late" uses the same rule as attendance: checked in after shift start.

create or replace function public.employee_punctuality(p_employee_id uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp uuid := coalesce(p_employee_id, private.current_employee_id());
  v_from date := coalesce(p_from, private.today_ist() - 29);
  v_to date := least(coalesce(p_to, private.today_ist()), private.today_ist());
  v_today date := private.today_ist();
  e public.employees;
  v jsonb;
begin
  perform private.require(v_emp is not null, 'Employee not found');
  perform private.require(v_emp = private.current_employee_id() or private.is_manager_of(v_emp) or private.can_manage_performance(), 'Not allowed');
  select * into e from public.employees where id = v_emp;
  perform private.require(found, 'Employee not found');

  with a as (
    select x.date, x.check_out_at, coalesce(x.total_break_seconds, 0) as break_s,
           (x.check_in_at at time zone 'Asia/Kolkata')::time as cin,
           (x.check_out_at at time zone 'Asia/Kolkata')::time as cout
    from public.attendance_effective x
    where x.employee_id = v_emp and x.date between v_from and v_to and x.check_in_at is not null
  ), d as (
    select a.*,
           greatest(0, floor(extract(epoch from (a.cin - coalesce(e.shift_start, time '09:00'))) / 60))::int as late_min,
           case when a.check_out_at is not null and a.cout >= a.cin and a.cout < coalesce(e.shift_end, time '18:00')
                then floor(extract(epoch from (coalesce(e.shift_end, time '18:00') - a.cout)) / 60)::int else 0 end as early_min
    from a
  ), t as (
    select k.status, k.due_date, (k.completed_at at time zone 'Asia/Kolkata')::date as done_on
    from public.tasks k
    where k.assigned_to = v_emp and k.archived_at is null and k.status <> 'cancelled' and k.due_date between v_from and v_to
  ), td as (
    select t.*,
           (t.status = 'completed' and t.done_on <= t.due_date) as on_time,
           (t.status = 'completed' and t.done_on > t.due_date) as late,
           (t.status not in ('completed','awaiting_review') and t.due_date < v_today) as overdue
    from t
  ), dr as (
    select x.on_time from public.task_drafts x join public.tasks k on k.id = x.task_id
    where k.assigned_to = v_emp and (x.submitted_at at time zone 'Asia/Kolkata')::date between v_from and v_to
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'shift_start', to_char(coalesce(e.shift_start, time '09:00'), 'HH24:MI'),
    'shift_end', to_char(coalesce(e.shift_end, time '18:00'), 'HH24:MI'),
    'days_present', (select count(*) from d),
    'on_time_days', (select count(*) from d where late_min = 0),
    'late_days', (select count(*) from d where late_min > 0),
    'on_time_rate', (select round(100.0 * count(*) filter (where late_min = 0) / nullif(count(*), 0), 1) from d),
    'avg_late_minutes', (select round(avg(late_min)) from d where late_min > 0),
    'total_late_minutes', (select coalesce(sum(late_min), 0) from d),
    'early_leave_days', (select count(*) from d where early_min > 0),
    'avg_early_minutes', (select round(avg(early_min)) from d where early_min > 0),
    'missed_checkout_days', (select count(*) from d where check_out_at is null and date < v_today),
    'avg_check_in', (select to_char(time '00:00' + make_interval(secs => avg(extract(epoch from cin))), 'HH24:MI') from d),
    'avg_break_minutes', (select round(avg(break_s) / 60.0) from d),
    'days', coalesce((select jsonb_agg(jsonb_build_object('date', date, 'in', to_char(cin, 'HH24:MI'), 'out', to_char(cout, 'HH24:MI'),
                       'late', late_min, 'early', early_min) order by date) from d), '[]'::jsonb),
    'tasks_due', (select count(*) from td where on_time or late or overdue),
    'tasks_on_time', (select count(*) from td where on_time),
    'tasks_late', (select count(*) from td where late),
    'tasks_overdue', (select count(*) from td where overdue),
    'task_on_time_rate', (select round(100.0 * count(*) filter (where on_time) / nullif(count(*) filter (where on_time or late or overdue), 0), 1) from td),
    'avg_days_late', (select round(avg(done_on - due_date), 1) from td where late),
    'drafts', (select count(*) from dr),
    'drafts_on_time', (select count(*) from dr where on_time is not false),
    'draft_on_time_rate', (select round(100.0 * count(*) filter (where on_time is not false) / nullif(count(*), 0), 1) from dr)
  ) into v;
  return v;
end $$;

create or replace function public.team_punctuality(p_from date default null, p_to date default null)
returns table (employee_id uuid, name text, metrics jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  select e.id, e.name, public.employee_punctuality(e.id, p_from, p_to)
  from public.employees e
  where e.status = 'active' and (private.can_manage_performance() or e.manager_id = private.current_employee_id())
  order by e.name;
end $$;

revoke execute on function public.employee_punctuality(uuid, date, date), public.team_punctuality(date, date) from public, anon;
grant execute on function public.employee_punctuality(uuid, date, date), public.team_punctuality(date, date) to authenticated;
