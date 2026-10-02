-- Prevent duplicate task creation from rapid repeated clicks/network retries.
alter table public.tasks add column if not exists client_request_id uuid;

create unique index if not exists tasks_client_request_id_uidx
  on public.tasks(client_request_id)
  where client_request_id is not null;

create or replace function public.create_task(
  p_title text,
  p_description text,
  p_assigned_to uuid,
  p_start_date date,
  p_due_date date,
  p_priority text default 'medium',
  p_client_request_id uuid default null
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
  if p_client_request_id is not null then
    select t.id into task_id
    from public.tasks t
    where t.client_request_id=p_client_request_id
    limit 1;
    if task_id is not null then return task_id; end if;
  end if;

  if nullif(trim(p_title),'') is null then raise exception 'Task title is required'; end if;
  if p_start_date is null or p_due_date is null or p_due_date < p_start_date then raise exception 'Due date cannot be before the start date'; end if;
  if p_priority not in ('low','medium','high','urgent') then raise exception 'Invalid task priority'; end if;
  if not private.is_admin() and (actor is null or not private.can_assign_task(p_assigned_to)) then raise exception 'You are not allowed to assign this employee'; end if;
  if not exists(select 1 from public.employees where id=p_assigned_to and status='active') then raise exception 'Selected employee is not active'; end if;

  insert into public.tasks(
    title,description,assigned_to,assigned_by,start_date,due_date,priority,status,client_request_id
  )
  values(
    trim(p_title),
    nullif(trim(coalesce(p_description,'')),''),
    p_assigned_to,
    case when private.is_admin() then null else actor end,
    p_start_date,p_due_date,p_priority,'assigned',p_client_request_id
  )
  on conflict (client_request_id) where client_request_id is not null
  do nothing
  returning id into task_id;

  if task_id is null and p_client_request_id is not null then
    select t.id into task_id from public.tasks t where t.client_request_id=p_client_request_id limit 1;
  end if;

  if task_id is null then raise exception 'Unable to create task'; end if;
  return task_id;
end;
$$;

revoke all on function public.create_task(text,text,uuid,date,date,text,uuid) from public,anon;
grant execute on function public.create_task(text,text,uuid,date,date,text,uuid) to authenticated;
