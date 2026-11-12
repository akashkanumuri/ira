-- SIGMA 1 — self-assigned tasks. Additive only.
-- Anyone can add a task for themselves (a reminder of work they owe). No approval is needed to
-- start it; when they hand it in, it goes to their reporting manager (employees.manager_id),
-- who reviews it like any other task. No reporting manager → the admin reviews it.

alter table public.tasks add column if not exists self_assigned boolean not null default false;

create or replace function public.create_self_task(
  p_title text, p_description text, p_start_date date, p_due_date date,
  p_priority text default 'medium', p_client_request_id uuid default null
) returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare
  v_emp uuid := private.current_employee_id();
  v_manager uuid;
  v_id uuid;
begin
  perform private.require(v_emp is not null, 'Only employees can add their own tasks');
  perform private.require(exists (select 1 from public.employees where id = v_emp and status = 'active'), 'Your account is not active');
  if p_client_request_id is not null then
    select id into v_id from public.tasks where client_request_id = p_client_request_id limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  perform private.require(nullif(btrim(coalesce(p_title, '')), '') is not null, 'Task title is required');
  perform private.require(length(btrim(p_title)) <= 200, 'Title is too long');
  perform private.require(p_description is null or length(p_description) <= 5000, 'Notes are too long');
  perform private.require(p_start_date is not null and p_due_date is not null and p_due_date >= p_start_date, 'Due date cannot be before the start date');
  perform private.require(p_priority in ('low','medium','high','urgent'), 'Invalid task priority');

  select manager_id into v_manager from public.employees
   where id = v_emp and manager_id is not null and manager_id <> v_emp;
  -- Only an active manager can review.
  if v_manager is not null and not exists (select 1 from public.employees where id = v_manager and status = 'active') then
    v_manager := null;
  end if;

  perform set_config('sigma.task_rpc', 'on', true);
  insert into public.tasks (title, description, assigned_to, assigned_by, start_date, due_date, priority, status,
                            client_request_id, self_assigned, research_minutes)
  values (btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), v_emp, v_manager, p_start_date, p_due_date,
          p_priority, 'assigned', p_client_request_id, true, null)
  on conflict (client_request_id) where client_request_id is not null do nothing
  returning id into v_id;
  perform set_config('sigma.task_rpc', '', true);

  if v_id is null and p_client_request_id is not null then
    select id into v_id from public.tasks where client_request_id = p_client_request_id limit 1;
  end if;
  perform private.require(v_id is not null, 'Unable to create task');
  return v_id;
end $function$;

revoke all on function public.create_self_task(text, text, date, date, text, uuid) from public, anon;
grant execute on function public.create_self_task(text, text, date, date, text, uuid) to authenticated;

-- A task you add for yourself does not notify you that it was "assigned".
create or replace function public.trg_notify_task()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare v_title text := NEW.title;
begin
  if TG_OP = 'INSERT' and NEW.self_assigned then return NEW; end if;
  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and OLD.assigned_to is distinct from NEW.assigned_to) then
    perform private.notify_employee(NEW.assigned_to, 'task',
      case when NEW.parent_task_id is null then 'New task assigned' else 'New subtask assigned' end,
      '"' || v_title || '" · due ' || to_char(NEW.due_date, 'DD Mon'), '/emp-tasks',
      'task_assign_' || NEW.id || '_' || NEW.assigned_to);
    return NEW;
  end if;
  if TG_OP <> 'UPDATE' or NEW.status = OLD.status then return NEW; end if;
  case NEW.status
    when 'awaiting_review' then
      perform private.notify_task_reviewers(NEW, 'Task ready for review',
        '"' || v_title || '" was handed in.', 'task_review_' || NEW.id || '_' || extract(epoch from NEW.updated_at)::bigint);
    when 'blocked' then
      perform private.notify_task_reviewers(NEW, 'Task blocked',
        '"' || v_title || '": ' || coalesce(NEW.status_note, 'no reason given'), 'task_blocked_' || NEW.id || '_' || extract(epoch from NEW.updated_at)::bigint);
    when 'completed' then
      if OLD.status <> 'awaiting_review' and private.current_employee_id() = NEW.assigned_to then
        perform private.notify_task_reviewers(NEW, 'Task completed',
          '"' || v_title || '" was completed.', 'task_done_' || NEW.id || '_' || extract(epoch from NEW.updated_at)::bigint);
      else
        perform private.notify_employee(NEW.assigned_to, 'task', 'Task approved',
          '"' || v_title || '" is marked complete.', '/emp-tasks', 'task_done_' || NEW.id || '_' || extract(epoch from NEW.updated_at)::bigint);
      end if;
    when 'revision_required' then
      perform private.notify_employee(NEW.assigned_to, 'task', 'Changes requested',
        '"' || v_title || '": ' || coalesce(NEW.status_note, ''), '/emp-tasks', 'task_revise_' || NEW.id || '_' || extract(epoch from NEW.updated_at)::bigint);
    when 'cancelled' then
      perform private.notify_employee(NEW.assigned_to, 'task', 'Task cancelled',
        '"' || v_title || '": ' || coalesce(NEW.status_note, ''), '/emp-tasks', 'task_cancel_' || NEW.id);
    else null;
  end case;
  return NEW;
end $function$;

-- The name of the signed-in employee's reporting manager (who reviews their own tasks). Name only.
create or replace function public.my_reporting_manager()
 returns table (id uuid, name text)
 language sql stable security definer set search_path to ''
as $function$
  select m.id, m.name
    from public.employees e
    join public.employees m on m.id = e.manager_id and m.status = 'active' and m.id <> e.id
   where e.id = private.current_employee_id()
$function$;
revoke all on function public.my_reporting_manager() from public, anon;
grant execute on function public.my_reporting_manager() to authenticated;
