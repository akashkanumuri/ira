-- Allow the assigned employee to complete their own task while keeping
-- assignment metadata immutable and preserving server-side authorization.
create or replace function private.validate_task_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid := private.current_employee_id();
  is_assignee boolean := (OLD.assigned_to = eid) and (NEW.assigned_to = OLD.assigned_to);
  is_assigner boolean := (OLD.assigned_by is not null) and (OLD.assigned_by = eid);
begin
  if private.is_admin() then
    NEW.updated_at := now();
    return NEW;
  end if;

  if is_assignee and not is_assigner then
    NEW.title := OLD.title;
    NEW.description := OLD.description;
    NEW.assigned_to := OLD.assigned_to;
    NEW.assigned_by := OLD.assigned_by;
    NEW.start_date := OLD.start_date;
    NEW.due_date := OLD.due_date;
    NEW.priority := OLD.priority;
    NEW.created_at := OLD.created_at;

    if NEW.status = 'completed' and OLD.status = 'assigned' then
      if NEW.submitted_link is null or trim(NEW.submitted_link) !~* '^https?://' then
        raise exception 'A valid completed work link is required';
      end if;
      NEW.submitted_link := trim(NEW.submitted_link);
      NEW.submitted_at := coalesce(NEW.submitted_at, now());
    else
      NEW.status := OLD.status;
      NEW.submitted_link := OLD.submitted_link;
      NEW.submitted_at := OLD.submitted_at;
    end if;

    NEW.updated_at := now();
    return NEW;
  end if;

  if is_assigner then
    if NEW.assigned_to <> OLD.assigned_to and not private.can_assign_task(NEW.assigned_to) then
      raise exception 'You are not allowed to assign this employee';
    end if;
    NEW.assigned_by := OLD.assigned_by;
    NEW.status := OLD.status;
    NEW.submitted_link := OLD.submitted_link;
    NEW.submitted_at := OLD.submitted_at;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
    return NEW;
  end if;

  raise exception 'Unauthorized task update';
end;
$$;

revoke all on function private.validate_task_update() from public;
grant execute on function private.validate_task_update() to postgres;
