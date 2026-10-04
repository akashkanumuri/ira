-- Remove task allocations from active views while retaining task and event history.
alter table public.tasks
  add column if not exists archived_at timestamptz;

drop policy if exists tasks_select_participants on public.tasks;
create policy tasks_select_participants
on public.tasks
for select
to authenticated
using (
  private.is_admin()
  or (
    archived_at is null
    and (assigned_to = private.current_employee_id() or assigned_by = private.current_employee_id())
  )
);

drop policy if exists tasks_update_participants on public.tasks;
create policy tasks_update_participants
on public.tasks
for update
to authenticated
using (
  private.is_admin()
  or (
    archived_at is null
    and (assigned_to = private.current_employee_id() or assigned_by = private.current_employee_id())
  )
)
with check (
  private.is_admin()
  or (
    archived_at is null
    and (assigned_to = private.current_employee_id() or assigned_by = private.current_employee_id())
  )
);

create or replace function private.record_task_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := private.current_employee_id();
begin
  if TG_OP = 'INSERT' then
    insert into public.task_events(task_id, event_type, actor_employee_id, metadata)
    values (NEW.id, 'assigned', coalesce(actor, NEW.assigned_by), '{}'::jsonb);
  elsif TG_OP = 'UPDATE'
    and NEW.archived_at is distinct from OLD.archived_at
    and NEW.archived_at is not null then
    insert into public.task_events(task_id, event_type, actor_employee_id, metadata)
    values (
      NEW.id,
      'removed',
      actor,
      jsonb_build_object('archived_at', NEW.archived_at, 'actor_user_id', auth.uid())
    );
  elsif TG_OP = 'UPDATE' and NEW.status <> OLD.status then
    insert into public.task_events(task_id, event_type, actor_employee_id, metadata)
    values (NEW.id, NEW.status, coalesce(actor, NEW.assigned_to), jsonb_build_object('submitted_at', NEW.submitted_at));
  end if;
  return NEW;
end;
$function$;

create or replace function public.archive_task(p_task_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not private.is_admin() then
    raise exception 'Admin access required';
  end if;

  update public.tasks
  set archived_at = pg_catalog.now()
  where id = p_task_id and archived_at is null;

  if not found then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception 'Task has already been removed';
    end if;
    raise exception 'Task not found';
  end if;
end;
$function$;

revoke all on function public.archive_task(uuid) from public, anon, authenticated;
grant execute on function public.archive_task(uuid) to authenticated;
