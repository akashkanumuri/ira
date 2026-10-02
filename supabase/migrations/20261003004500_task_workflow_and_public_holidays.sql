-- V2 task workflow and public holiday calendar.
-- Keep this migration idempotent so a fresh environment can reproduce the
-- live production contract.

create or replace function public.create_task(
  p_title text,
  p_description text,
  p_assigned_to uuid,
  p_start_date date,
  p_due_date date,
  p_priority text default 'medium'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := private.current_employee_id();
  task_id uuid;
begin
  if nullif(trim(p_title),'') is null then raise exception 'Task title is required'; end if;
  if p_start_date is null or p_due_date is null or p_due_date < p_start_date then raise exception 'Due date cannot be before the start date'; end if;
  if p_priority not in ('low','medium','high','urgent') then raise exception 'Invalid task priority'; end if;
  if not private.is_admin() and (actor is null or not private.can_assign_task(p_assigned_to)) then raise exception 'You are not allowed to assign this employee'; end if;
  if not exists(select 1 from public.employees where id=p_assigned_to and status='active') then raise exception 'Selected employee is not active'; end if;
  insert into public.tasks(title,description,assigned_to,assigned_by,start_date,due_date,priority,status)
  values(trim(p_title),nullif(trim(coalesce(p_description,'')),''),p_assigned_to,case when private.is_admin() then null else actor end,p_start_date,p_due_date,p_priority,'assigned')
  returning id into task_id;
  return task_id;
end;
$$;

revoke all on function public.create_task(text,text,uuid,date,date,text) from public,anon;
grant execute on function public.create_task(text,text,uuid,date,date,text) to authenticated;

create or replace function public.submit_task(p_task_id uuid,p_submitted_link text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare actor uuid := private.current_employee_id(); task_id uuid;
begin
  if actor is null then raise exception 'Employee authentication required'; end if;
  if nullif(trim(p_submitted_link),'') is null or trim(p_submitted_link) !~* '^https?://' then raise exception 'A valid http(s) work link is required'; end if;
  update public.tasks set status='completed',submitted_link=trim(p_submitted_link),submitted_at=now(),updated_at=now()
  where id=p_task_id and assigned_to=actor and status='assigned'
  returning id into task_id;
  if task_id is null then raise exception 'Task is unavailable, already completed, or not assigned to you'; end if;
  return task_id;
end;
$$;

revoke all on function public.submit_task(uuid,text) from public,anon;
grant execute on function public.submit_task(uuid,text) to authenticated;

alter table public.holidays add column if not exists holiday_type text not null default 'company';
alter table public.holidays drop constraint if exists holidays_holiday_type_check;
alter table public.holidays add constraint holidays_holiday_type_check check (holiday_type in ('company','public'));
create unique index if not exists holidays_date_type_uidx on public.holidays(date,holiday_type);

drop policy if exists holidays_admin_delete on public.holidays;
create policy holidays_admin_delete on public.holidays
for delete to authenticated
using (private.is_admin() and holiday_type='company');

insert into public.holidays(name,date,description,holiday_type) values
('New Year','2026-01-01','Telangana State 2026 public calendar','public'),
('Bhogi','2026-01-14','Telangana State 2026 public calendar','public'),
('Sankranti / Pongal','2026-01-15','Telangana State 2026 public calendar','public'),
('Kanumu','2026-01-16','Telangana State 2026 public calendar','public'),
('Republic Day','2026-01-26','Telangana State 2026 public calendar','public'),
('Holi','2026-03-03','Telangana State 2026 public calendar','public'),
('Ugadi','2026-03-19','Telangana State 2026 public calendar','public'),
('Ramzan / Eid-ul-Fitr','2026-03-21','Telangana State 2026 public calendar','public'),
('Sri Rama Navami','2026-03-27','Telangana State 2026 public calendar','public'),
('Good Friday','2026-04-03','Telangana State 2026 public calendar','public'),
('Dr. B.R. Ambedkar''s Birthday','2026-04-14','Telangana State 2026 public calendar','public'),
('Buddha Purnima','2026-05-01','Telangana State 2026 public calendar','public'),
('Eid-ul-Azha / Bakrid','2026-05-27','Telangana State 2026 public calendar','public'),
('Moharram','2026-06-26','Telangana State 2026 public calendar','public'),
('Independence Day','2026-08-15','Telangana State 2026 public calendar','public'),
('Eid Milad-un-Nabi','2026-08-26','Telangana State 2026 public calendar','public'),
('Vinayaka Chavithi','2026-09-14','Telangana State 2026 public calendar','public'),
('Mahatma Gandhi Jayanthi','2026-10-02','Telangana State 2026 public calendar','public'),
('Saddula Bathukamma','2026-10-18','Telangana State 2026 public calendar','public'),
('Maharnavami','2026-10-19','Telangana State 2026 public calendar','public'),
('Vijaya Dasami','2026-10-20','Telangana State 2026 public calendar','public'),
('Following day of Vijaya Dasami','2026-10-21','Telangana State 2026 public calendar','public'),
('Deepavali','2026-11-08','Telangana State 2026 public calendar','public'),
('Christmas','2026-12-25','Telangana State 2026 public calendar','public')
on conflict (date,holiday_type) do update
set name=excluded.name,description=excluded.description;
