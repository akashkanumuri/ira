create or replace function private.validate_regularization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  eid uuid := private.current_employee_id();
  a public.attendance%rowtype;
  emp_join date;
  local_date date := (now() at time zone 'Asia/Kolkata')::date;
  in_minutes integer;
  out_minutes integer;
begin
  if private.is_admin() then
    return new;
  end if;
  if eid is null or new.employee_id<>eid then raise exception 'Unauthorized correction request'; end if;
  if new.status<>'pending' then raise exception 'New correction must be pending'; end if;
  if new.date>local_date then raise exception 'Correction cannot be for a future date'; end if;
  select e.join_date into emp_join from public.employees e where e.id=eid and e.status='active';
  if emp_join is null then raise exception 'Active employee record not found'; end if;
  if new.date<emp_join then raise exception 'Correction cannot be before the employee join date'; end if;
  if extract(dow from new.date)=0 then raise exception 'Sunday is a weekly off'; end if;
  if exists(select 1 from public.holidays h where h.date=new.date) then raise exception 'This date is a company holiday'; end if;
  if exists(select 1 from public.leave_requests lr where lr.employee_id=eid and lr.status='approved' and lr.start_date<=new.date and lr.end_date>=new.date) then raise exception 'Approved leave exists for this date'; end if;
  if new.requested_check_in !~ '^[0-2][0-9]:[0-5][0-9]$' or new.requested_check_out !~ '^[0-2][0-9]:[0-5][0-9]$' then raise exception 'Correction times must use HH:MM format'; end if;
  in_minutes := split_part(new.requested_check_in,':',1)::integer*60 + split_part(new.requested_check_in,':',2)::integer;
  out_minutes := split_part(new.requested_check_out,':',1)::integer*60 + split_part(new.requested_check_out,':',2)::integer;
  if in_minutes>=1440 or out_minutes>=1440 or out_minutes<=in_minutes then raise exception 'Correction check-out must be later than check-in'; end if;
  select * into a from public.attendance where a.employee_id=eid and a.date=new.date limit 1;
  new.attendance_id:=a.id;
  new.original_check_in:=a.check_in_at;
  new.original_check_out:=a.check_out_at;
  new.updated_at:=now();
  return new;
end;
$function$;