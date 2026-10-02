-- V2 production hardening
-- Keeps original attendance immutable when corrections are approved, exposes an effective
-- attendance read model, lets employees read their own private HR documents, and protects
-- employee-owned immutable fields.

create or replace function private.protect_employee_update()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(current_setting('request.jwt.claim.role', true),'') = 'service_role' or private.is_admin() then
    NEW.updated_at := now();
    return NEW;
  end if;

  if private.current_employee_id() is null or OLD.id <> private.current_employee_id() then
    raise exception 'Unauthorized employee update';
  end if;

  NEW.profile_id := OLD.profile_id;
  NEW.emp_id := OLD.emp_id;
  NEW.login_id := OLD.login_id;
  NEW.status := OLD.status;
  NEW.work_mode := OLD.work_mode;
  NEW.shift_start := OLD.shift_start;
  NEW.shift_end := OLD.shift_end;
  NEW.join_date := OLD.join_date;
  NEW.department_id := OLD.department_id;
  NEW.designation_id := OLD.designation_id;
  NEW.manager_id := OLD.manager_id;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  return NEW;
end;
$function$;

create or replace function private.apply_regularization_approval()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  local_checkin timestamptz;
  local_checkout timestamptz;
  new_attendance_id uuid;
  a public.attendance%rowtype;
begin
  if NEW.status = OLD.status then
    NEW.updated_at := now();
    return NEW;
  end if;

  if not private.is_admin() then
    raise exception 'Only admin can review corrections';
  end if;

  if OLD.status <> 'pending' then
    raise exception 'Only pending corrections can be reviewed';
  end if;

  NEW.reviewed_at := now();
  NEW.reviewed_by := (select auth.uid());

  if NEW.status = 'approved' then
    local_checkin := ((NEW.date + NEW.requested_check_in) at time zone 'Asia/Kolkata');
    local_checkout := ((NEW.date + NEW.requested_check_out) at time zone 'Asia/Kolkata');

    if NEW.attendance_id is null then
      perform set_config('ira.regularization','on',true);

      insert into public.attendance(
        employee_id,date,mode,check_in_at,check_out_at,working_seconds,
        total_break_seconds,current_state,status,notes
      )
      select
        NEW.employee_id,
        NEW.date,
        case
          when e.work_mode='remote' then 'wfh'
          when exists (
            select 1 from public.wfh_requests wr
            where wr.employee_id=e.id and wr.date=NEW.date and wr.status='approved'
          ) then 'wfh'
          else 'office'
        end,
        local_checkin,
        local_checkout,
        greatest(0, floor(extract(epoch from (local_checkout-local_checkin)))::integer),
        0,
        'completed',
        case
          when (local_checkin at time zone 'Asia/Kolkata')::time > e.shift_start then 'late'
          else 'present'
        end,
        'Created from approved attendance regularization'
      from public.employees e
      where e.id=NEW.employee_id
      returning id into new_attendance_id;

      perform set_config('ira.regularization','off',true);

      if new_attendance_id is null then
        raise exception 'Employee not found for correction';
      end if;

      NEW.attendance_id := new_attendance_id;

      insert into public.attendance_events(attendance_id,event_type,event_at,metadata)
      values(
        NEW.attendance_id,'regularization',now(),
        jsonb_build_object(
          'request_id',NEW.id,
          'original_check_in',NEW.original_check_in,
          'original_check_out',NEW.original_check_out,
          'requested_check_in',NEW.requested_check_in,
          'requested_check_out',NEW.requested_check_out,
          'immutable',true,
          'created_attendance',true
        )
      );
    else
      select * into a from public.attendance where id=NEW.attendance_id;

      if a.id is null then
        raise exception 'Attendance record not found for correction';
      end if;

      insert into public.attendance_events(attendance_id,event_type,event_at,metadata)
      values(
        a.id,'regularization',now(),
        jsonb_build_object(
          'request_id',NEW.id,
          'original_check_in',NEW.original_check_in,
          'original_check_out',NEW.original_check_out,
          'requested_check_in',NEW.requested_check_in,
          'requested_check_out',NEW.requested_check_out,
          'immutable',true,
          'created_attendance',false
        )
      );
    end if;
  end if;

  NEW.updated_at:=now();
  return NEW;
end;
$function$;

drop view if exists public.attendance_effective;

create view public.attendance_effective
with (security_invoker=true)
as
select
  a.id,a.employee_id,a.date,a.mode,
  case
    when corr.id is not null then
      case
        when ((a.date + corr.requested_check_in) at time zone 'Asia/Kolkata')::time > e.shift_start then 'late'
        else 'present'
      end
    else a.status
  end as status,
  case when corr.id is not null
    then ((a.date + corr.requested_check_in) at time zone 'Asia/Kolkata')
    else a.check_in_at
  end as check_in_at,
  case when corr.id is not null
    then ((a.date + corr.requested_check_out) at time zone 'Asia/Kolkata')
    else a.check_out_at
  end as check_out_at,
  case when corr.id is not null
    then greatest(
      0,
      floor(
        extract(
          epoch from (
            ((a.date + corr.requested_check_out) at time zone 'Asia/Kolkata')
            - ((a.date + corr.requested_check_in) at time zone 'Asia/Kolkata')
          )
        )
      )::integer - coalesce(a.total_break_seconds,0)
    )
    else a.working_seconds
  end as working_seconds,
  a.total_break_seconds,
  case when corr.id is not null then 'completed' else a.current_state end as current_state,
  a.wfh_request_id,a.leave_request_id,a.notes,a.created_at,a.updated_at,
  corr.id as regularization_id
from public.attendance a
join public.employees e on e.id=a.employee_id
left join lateral (
  select rr.id,rr.requested_check_in,rr.requested_check_out,rr.reviewed_at,rr.created_at
  from public.regularization_requests rr
  where rr.attendance_id=a.id and rr.status='approved'
  order by rr.reviewed_at desc nulls last, rr.created_at desc
  limit 1
) corr on true;

grant select on public.attendance_effective to authenticated;

drop policy if exists employee_documents_self_select on public.employee_documents;
create policy employee_documents_self_select
on public.employee_documents
for select to authenticated
using (employee_id=private.current_employee_id() or private.is_admin());

drop policy if exists hr_documents_employee_select on storage.objects;
create policy hr_documents_employee_select
on storage.objects
for select to authenticated
using (
  bucket_id='hr-documents'
  and name like ((private.current_employee_id())::text || '/%')
);

create index if not exists idx_regularization_attendance_approved_latest
on public.regularization_requests(attendance_id,status,reviewed_at desc,created_at desc);
