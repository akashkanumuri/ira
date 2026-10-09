-- ============================================================================
-- Migration: 20261009190000_harden_notifications_security.sql
-- Description: Security hardening for Notifications and Push Subscriptions
-- Project: IRA Presence V2
-- Canonical Time Zone: Asia/Kolkata
-- Safety: Local migration only. DO NOT apply to production without authorization.
-- ============================================================================

-- 1. REVOKE INSECURE INSERT POLICY
-- Drop the overly permissive insert policy that allowed arbitrary client inserts
drop policy if exists "notifications_insert_authenticated" on public.notifications;

-- Enforce that only verified administrators can insert directly into public.notifications
-- (Employees generate notifications exclusively via trusted triggers or secured RPC)
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

-- 2. HARDEN NOTIFICATIONS UPDATE POLICY & PREVENT DATA TAMPERING
-- Drop and recreate update policy with strict recipient matching
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications
  for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Trigger to prevent employees from tampering with notification contents (title, message, type, recipient)
-- Non-admins are strictly restricted to updating only the read_at timestamp.
create or replace function public.trg_protect_notification_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- If caller is authenticated and not an administrator, prevent altering immutable fields
  if auth.uid() is not null and not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    if NEW.id is distinct from OLD.id or
       NEW.recipient_id is distinct from OLD.recipient_id or
       NEW.employee_id is distinct from OLD.employee_id or
       NEW.actor_id is distinct from OLD.actor_id or
       NEW.type is distinct from OLD.type or
       NEW.title is distinct from OLD.title or
       NEW.message is distinct from OLD.message or
       NEW.action_url is distinct from OLD.action_url or
       NEW.idempotency_key is distinct from OLD.idempotency_key or
       NEW.metadata is distinct from OLD.metadata or
       NEW.created_at is distinct from OLD.created_at then
      raise exception 'Unauthorized modification of notification content. Only read_at status may be updated.';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_notification_integrity on public.notifications;
create trigger trg_notification_integrity
  before update on public.notifications
  for each row
  execute function public.trg_protect_notification_integrity();

-- 3. HARDEN PUSH SUBSCRIPTION OWNERSHIP
-- Prevent transferring push subscription to another user
create or replace function public.trg_protect_push_sub_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.user_id is distinct from OLD.user_id then
    raise exception 'Cannot transfer push subscription ownership to another user.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_push_sub_integrity on public.push_subscriptions;
create trigger trg_push_sub_integrity
  before update on public.push_subscriptions
  for each row
  execute function public.trg_protect_push_sub_integrity();

-- 4. HARDEN NOTIFY_USER PROCEDURE WITH CALLER AUTHORIZATION CHECKS
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

  -- Validate caller permissions when invoked by an authenticated client
  if v_caller_id is not null then
    select (role = 'admin') into v_is_admin
    from public.profiles
    where id = v_caller_id;
    v_is_admin := coalesce(v_is_admin, false);

    -- Direct external RPC / SQL calls (pg_trigger_depth() = 0) are strictly restricted to administrators.
    -- Non-administrators generate notifications exclusively via trusted database triggers.
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

  return v_notification_id;
end;
$$;

revoke all on function public.notify_user(uuid, text, text, text, text, text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.notify_user(uuid, text, text, text, text, text, uuid, uuid, jsonb) to authenticated;
