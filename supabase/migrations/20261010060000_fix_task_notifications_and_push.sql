-- IRA Presence V2: Fix Task Notifications, Manager Routing and Push Subscription Persistence
-- Migration: 20261010060000_fix_task_notifications_and_push.sql

-- 0. Ensure authenticated users have USAGE on schema private for RPC and RLS policies
grant usage on schema private to authenticated;

-- 1. Create secure save_push_subscription RPC
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_sub_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required to save push subscription';
  end if;

  if p_endpoint is null or p_p256dh is null or p_auth is null then
    raise exception 'Invalid subscription credentials';
  end if;

  insert into public.push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth,
    user_agent,
    updated_at
  )
  values (
    v_user_id,
    p_endpoint,
    p_p256dh,
    p_auth,
    p_user_agent,
    now()
  )
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      updated_at = now()
  returning id into v_sub_id;

  return v_sub_id;
end;
$$;

grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- 2. Enhance notify_user to return existing notification ID on idempotency conflict
create or replace function public.notify_user(
  p_recipient_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_action_url text default null,
  p_idempotency_key text default null,
  p_employee_id uuid default null,
  p_actor_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification_id uuid;
  v_caller_id uuid := auth.uid();
  v_is_admin boolean := false;
begin
  if p_recipient_id is null then
    return null;
  end if;

  if v_caller_id is not null then
    select (role = 'admin') into v_is_admin
    from public.profiles
    where id = v_caller_id;
    v_is_admin := coalesce(v_is_admin, false);

    if pg_trigger_depth() = 0 and not v_is_admin then
      raise exception 'Security violation: Direct notification creation is restricted to administrators.';
    end if;
  end if;

  insert into public.notifications (
    recipient_id,
    employee_id,
    actor_id,
    type,
    title,
    message,
    action_url,
    idempotency_key,
    metadata
  )
  values (
    p_recipient_id,
    p_employee_id,
    p_actor_id,
    p_type,
    p_title,
    p_message,
    p_action_url,
    p_idempotency_key,
    p_metadata
  )
  on conflict (idempotency_key) do nothing
  returning id into v_notification_id;

  if v_notification_id is null and p_idempotency_key is not null then
    select id into v_notification_id
    from public.notifications
    where idempotency_key = p_idempotency_key;
  end if;

  return v_notification_id;
end;
$$;

grant execute on function public.notify_user(uuid, text, text, text, text, text, uuid, uuid, jsonb) to authenticated;

-- 3. Update trg_notify_task to ensure correct recipient routing and action URL
create or replace function public.trg_notify_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignee record;
  v_assigner record;
  v_assigner_profile_id uuid := null;
  v_admin_profile record;
  v_assigner_url text;
begin
  -- When a task is ASSIGNED -> notify assigned employee
  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and OLD.assigned_to is distinct from NEW.assigned_to) then
    select id, name, profile_id into v_assignee
    from public.employees
    where id = NEW.assigned_to;

    if v_assignee.profile_id is not null then
      perform public.notify_user(
        v_assignee.profile_id,
        'task',
        'New Task Assigned',
        'You have been assigned: "' || NEW.title || '" (Due: ' || NEW.due_date || ').',
        '/emp-tasks',
        'task_assign_' || NEW.id || '_' || v_assignee.profile_id,
        v_assignee.id,
        auth.uid(),
        jsonb_build_object('task_id', NEW.id, 'priority', NEW.priority)
      );
    end if;

  -- When work is SUBMITTED (status changes to 'completed') -> notify the assigner and admins
  elsif TG_OP = 'UPDATE' and coalesce(OLD.status, '') <> 'completed' and NEW.status = 'completed' then
    -- A. Notify assigner if known (Manager or Admin)
    if NEW.assigned_by is not null then
      select e.id, e.name, e.profile_id, p.role into v_assigner
      from public.employees e
      left join public.profiles p on p.id = e.profile_id
      where e.id = NEW.assigned_by;

      if v_assigner.profile_id is not null then
        v_assigner_profile_id := v_assigner.profile_id;
        v_assigner_url := case when v_assigner.role = 'admin' then '/admin-tasks' else '/emp-tasks' end;

        perform public.notify_user(
          v_assigner.profile_id,
          'task',
          'Task Work Submitted',
          'Completed work submitted for: "' || NEW.title || '".',
          v_assigner_url,
          'task_completed_' || NEW.id || '_' || v_assigner.profile_id,
          v_assigner.id,
          auth.uid(),
          jsonb_build_object('task_id', NEW.id, 'link', NEW.submitted_link)
        );
      end if;
    end if;

    -- B. Notify all admins (who are not the assigner already notified above)
    for v_admin_profile in
      select id from public.profiles
      where role = 'admin'
        and (v_assigner_profile_id is null or id <> v_assigner_profile_id)
    loop
      perform public.notify_user(
        v_admin_profile.id,
        'task',
        'Task Work Submitted',
        'Completed work submitted for: "' || NEW.title || '".',
        '/admin-tasks',
        'task_completed_' || NEW.id || '_' || v_admin_profile.id,
        null,
        auth.uid(),
        jsonb_build_object('task_id', NEW.id, 'link', NEW.submitted_link)
      );
    end loop;
  end if;

  return NEW;
end;
$$;
