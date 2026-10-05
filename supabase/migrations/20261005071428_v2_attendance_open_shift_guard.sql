-- v2_attendance_open_shift_guard
-- Prevent starting a new attendance day while an earlier shift is unresolved.

CREATE OR REPLACE FUNCTION private.validate_attendance_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  eid uuid;
  local_date date := (now() at time zone 'Asia/Kolkata')::date;
  emp record;
  wfh record;
  leave_rec record;
begin
  if coalesce(current_setting('ira.regularization',true),'off')='on' then
    eid := NEW.employee_id;
  else
    eid := private.current_employee_id();
  end if;

  if eid is null then raise exception 'Active employee account required'; end if;
  if NEW.employee_id <> eid then raise exception 'Invalid employee'; end if;

  if coalesce(current_setting('ira.regularization',true),'off') <> 'on' then
    NEW.date := local_date;

    if exists (
      select 1 from public.attendance a
      where a.employee_id=eid
        and a.date<NEW.date
        and a.current_state<>'completed'
    ) then
      raise exception 'Previous attendance is still open. Close or regularize the previous shift before checking in.';
    end if;
  end if;

  select e.* into emp
  from public.employees e
  where e.id=eid and e.status='active';

  if emp.id is null then raise exception 'Active employee record not found'; end if;
  if NEW.date < emp.join_date then raise exception 'Attendance cannot be recorded before the employee join date'; end if;

  if extract(dow from NEW.date)=0 then raise exception 'Sunday is a weekly off'; end if;
  if exists(select 1 from public.holidays h where h.date=NEW.date) then raise exception 'This date is a company holiday'; end if;

  if emp.work_mode='remote' then
    if NEW.mode <> 'wfh' then raise exception 'Remote employees must check in as WFH'; end if;
  elsif NEW.mode='wfh' then
    select wr.* into wfh
    from public.wfh_requests wr
    where wr.employee_id=eid and wr.date=NEW.date and wr.status='approved';
    if wfh.id is null and coalesce(current_setting('ira.regularization',true),'off') <> 'on' then
      raise exception 'WFH is not approved for this date';
    end if;
    NEW.wfh_request_id := wfh.id;
  end if;

  select lr.* into leave_rec
  from public.leave_requests lr
  where lr.employee_id=eid
    and lr.status='approved'
    and lr.start_date<=NEW.date
    and lr.end_date>=NEW.date
  limit 1;

  if leave_rec.id is not null then raise exception 'Approved leave exists for this date'; end if;

  if NEW.id is null then NEW.id:=extensions.uuid_generate_v4(); end if;

  if coalesce(current_setting('ira.regularization',true),'off')='on' then
    if NEW.check_in_at is null or NEW.check_out_at is null then raise exception 'Regularization requires both check-in and check-out'; end if;
    NEW.current_state:='completed';
    NEW.working_seconds:=greatest(0,floor(extract(epoch from(NEW.check_out_at-NEW.check_in_at)))::integer-coalesce(NEW.total_break_seconds,0));
    NEW.total_break_seconds:=coalesce(NEW.total_break_seconds,0);
  else
    NEW.check_in_at:=now();
    NEW.check_out_at:=null;
    NEW.current_state:='working';
    NEW.working_seconds:=0;
    NEW.total_break_seconds:=0;
  end if;

  NEW.status:=case when (NEW.check_in_at at time zone 'Asia/Kolkata')::time>emp.shift_start then 'late' else 'present' end;
  NEW.created_at:=coalesce(NEW.created_at,now());
  NEW.updated_at:=now();
  return NEW;
end;
$function$;
