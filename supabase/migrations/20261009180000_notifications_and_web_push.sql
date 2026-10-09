-- ============================================================================
-- Migration: 20261009180000_notifications_and_web_push.sql
-- Description: In-App Notifications and Standards-based Web Push Subscriptions
-- Project: IRA Presence V2
-- Canonical Time Zone: Asia/Kolkata
-- Safety: Local migration only. DO NOT apply to production without authorization.
-- ============================================================================

-- 1. NOTIFICATIONS TABLE
-- Stores persistent, recipient-targeted notifications for both Employees and Admins.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  type text not null check (type in ('attendance', 'leave', 'wfh', 'task', 'holiday', 'payroll', 'system')),
  title text not null,
  message text not null,
  action_url text,
  read_at timestamptz,
  idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Performance and query indexes
create index if not exists idx_notifications_recipient_created
  on public.notifications(recipient_id, created_at desc);

create index if not exists idx_notifications_recipient_unread
  on public.notifications(recipient_id)
  where read_at is null;

create index if not exists idx_notifications_idempotency
  on public.notifications(idempotency_key)
  where idempotency_key is not null;

-- 2. PUSH SUBSCRIPTIONS TABLE
-- Stores W3C Push API subscriptions for authorized user devices (browsers/phones).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions(user_id);

-- 3. ROW LEVEL SECURITY (RLS) POLICIES
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

-- Drop existing policies if re-running locally
drop policy if exists "notifications_select_own" on public.notifications;
drop policy if exists "notifications_update_own" on public.notifications;
drop policy if exists "notifications_delete_own" on public.notifications;
drop policy if exists "notifications_insert_authenticated" on public.notifications;

-- Notifications RLS:
-- Users can strictly read, update (mark as read), and delete ONLY their own notifications.
create policy "notifications_select_own"
  on public.notifications
  for select
  to authenticated
  using (recipient_id = auth.uid());

create policy "notifications_update_own"
  on public.notifications
  for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

create policy "notifications_delete_own"
  on public.notifications
  for delete
  to authenticated
  using (recipient_id = auth.uid());

-- Direct table insert is restricted to administrators (employees insert via trusted triggers or secure RPC)
create policy "notifications_insert_admin"
  on public.notifications
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Push Subscriptions RLS:
-- Users can strictly manage only their own device subscriptions.
drop policy if exists "push_sub_select_own" on public.push_subscriptions;
drop policy if exists "push_sub_insert_own" on public.push_subscriptions;
drop policy if exists "push_sub_update_own" on public.push_subscriptions;
drop policy if exists "push_sub_delete_own" on public.push_subscriptions;

create policy "push_sub_select_own"
  on public.push_subscriptions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "push_sub_insert_own"
  on public.push_subscriptions
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "push_sub_update_own"
  on public.push_subscriptions
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "push_sub_delete_own"
  on public.push_subscriptions
  for delete
  to authenticated
  using (user_id = auth.uid());

-- 4. REUSABLE HELPER FUNCTION: notify_user
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
begin
  if p_recipient_id is null then
    return null;
  end if;

  -- Direct external calls outside of triggers (pg_trigger_depth() = 0) are restricted to administrators
  if pg_trigger_depth() = 0 and auth.uid() is not null then
    if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
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

  return v_notification_id;
end;
$$;

revoke all on function public.notify_user(uuid, text, text, text, text, text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.notify_user(uuid, text, text, text, text, text, uuid, uuid, jsonb) to authenticated;

-- 5. BUSINESS EVENT AUTOMATION TRIGGERS

-- A. LEAVE REQUESTS TRIGGER
create or replace function public.trg_notify_leave_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp record;
  v_admin_profile record;
  v_emp_profile_id uuid;
begin
  -- Fetch requesting employee info
  select id, name, profile_id into v_emp
  from public.employees
  where id = coalesce(NEW.employee_id, OLD.employee_id);

  -- When employee SUBMITS a leave request -> notify authorized approvers (admins)
  if TG_OP = 'INSERT' then
    for v_admin_profile in
      select id from public.profiles where role = 'admin'
    loop
      perform public.notify_user(
        v_admin_profile.id,
        'leave',
        'New Leave Request',
        coalesce(v_emp.name, 'An employee') || ' requested ' || NEW.days || ' day(s) of ' || NEW.leave_type || ' leave (' || NEW.start_date || ' to ' || NEW.end_date || ').',
        '/admin-requests',
        'leave_submit_' || NEW.id || '_' || v_admin_profile.id,
        v_emp.id,
        v_emp.profile_id,
        jsonb_build_object('leave_id', NEW.id, 'status', NEW.status)
      );
    end loop;

  -- When approver REVIEWS leave request -> notify requesting employee
  elsif TG_OP = 'UPDATE' and OLD.status = 'pending' and NEW.status in ('approved', 'rejected') then
    if v_emp.profile_id is not null then
      perform public.notify_user(
        v_emp.profile_id,
        'leave',
        'Leave Request ' || initcap(NEW.status),
        'Your leave request for ' || NEW.start_date || ' to ' || NEW.end_date || ' has been ' || NEW.status || '.',
        '/emp-leave',
        'leave_review_' || NEW.id || '_' || NEW.status,
        v_emp.id,
        auth.uid(),
        jsonb_build_object('leave_id', NEW.id, 'status', NEW.status)
      );
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_leave_request_notify on public.leave_requests;
create trigger trg_leave_request_notify
  after insert or update of status on public.leave_requests
  for each row
  execute function public.trg_notify_leave_request();

-- B. WFH REQUESTS TRIGGER
create or replace function public.trg_notify_wfh_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp record;
  v_admin_profile record;
begin
  select id, name, profile_id into v_emp
  from public.employees
  where id = coalesce(NEW.employee_id, OLD.employee_id);

  -- When employee SUBMITS a WFH request -> notify admins
  if TG_OP = 'INSERT' then
    for v_admin_profile in
      select id from public.profiles where role = 'admin'
    loop
      perform public.notify_user(
        v_admin_profile.id,
        'wfh',
        'New WFH Request',
        coalesce(v_emp.name, 'An employee') || ' requested WFH on ' || NEW.date || ' (' || replace(NEW.duration, '_', ' ') || ').',
        '/admin-requests',
        'wfh_submit_' || NEW.id || '_' || v_admin_profile.id,
        v_emp.id,
        v_emp.profile_id,
        jsonb_build_object('wfh_id', NEW.id, 'status', NEW.status)
      );
    end loop;

  -- When approver REVIEWS WFH request -> notify requesting employee
  elsif TG_OP = 'UPDATE' and OLD.status = 'pending' and NEW.status in ('approved', 'rejected') then
    if v_emp.profile_id is not null then
      perform public.notify_user(
        v_emp.profile_id,
        'wfh',
        'WFH Request ' || initcap(NEW.status),
        'Your WFH request for ' || NEW.date || ' has been ' || NEW.status || '.',
        '/emp-wfh',
        'wfh_review_' || NEW.id || '_' || NEW.status,
        v_emp.id,
        auth.uid(),
        jsonb_build_object('wfh_id', NEW.id, 'status', NEW.status)
      );
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_wfh_request_notify on public.wfh_requests;
create trigger trg_wfh_request_notify
  after insert or update of status on public.wfh_requests
  for each row
  execute function public.trg_notify_wfh_request();

-- C. TASKS TRIGGER
create or replace function public.trg_notify_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignee record;
  v_assigner record;
  v_admin_profile record;
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

  -- When work is SUBMITTED (status changes to 'completed') -> notify the assigner or admins
  elsif TG_OP = 'UPDATE' and OLD.status <> 'completed' and NEW.status = 'completed' then
    if NEW.assigned_by is not null then
      select id, name, profile_id into v_assigner
      from public.employees
      where id = NEW.assigned_by;

      if v_assigner.profile_id is not null then
        perform public.notify_user(
          v_assigner.profile_id,
          'task',
          'Task Work Submitted',
          'Completed work submitted for: "' || NEW.title || '".',
          '/emp-tasks',
          'task_completed_' || NEW.id || '_' || v_assigner.profile_id,
          v_assigner.id,
          auth.uid(),
          jsonb_build_object('task_id', NEW.id, 'link', NEW.submitted_link)
        );
      end if;
    else
      -- Assigned by admin: notify admins
      for v_admin_profile in
        select id from public.profiles where role = 'admin'
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
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_task_notify on public.tasks;
create trigger trg_task_notify
  after insert or update on public.tasks
  for each row
  execute function public.trg_notify_task();

-- D. HOLIDAYS TRIGGER
create or replace function public.trg_notify_holiday()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp record;
begin
  if TG_OP = 'INSERT' then
    -- Notify all active employees
    for v_emp in
      select id, profile_id from public.employees where status = 'active' and profile_id is not null
    loop
      perform public.notify_user(
        v_emp.profile_id,
        'holiday',
        'Company Holiday Announced',
        NEW.name || ' on ' || NEW.date || '.',
        '/emp-holidays',
        'holiday_announce_' || NEW.id || '_' || v_emp.profile_id,
        v_emp.id,
        auth.uid(),
        jsonb_build_object('holiday_id', NEW.id, 'date', NEW.date)
      );
    end loop;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_holiday_notify on public.holidays;
create trigger trg_holiday_notify
  after insert on public.holidays
  for each row
  execute function public.trg_notify_holiday();

-- 6. REALTIME REGISTRATION
-- Ensure notifications table is broadcast over Supabase Realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end $$;
