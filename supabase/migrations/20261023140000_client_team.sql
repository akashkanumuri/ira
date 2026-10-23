-- SIGMA 1 — client admins manage their own organisation's portal users (permission client.users.manage)
--
-- Inviting a colleague creates a login, so it runs in the client-admin edge function
-- (service role). This migration adds the safe in-database parts: changing a colleague's
-- role or access. Additive: one function.

set local lock_timeout = '5s';

create or replace function public.client_user_update(p_client_user_id uuid, p_status text default null, p_role text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare cu public.client_users; v_primary uuid; v_admins int; v_ira_admin boolean := private.is_admin();
begin
  select * into cu from public.client_users where id = p_client_user_id for update;
  perform private.require(found, 'User not found');
  perform private.require(v_ira_admin or (private.current_client_id() = cu.client_id and private.has_permission('client.users.manage')),
    'Only your organisation’s administrator can change access');
  perform private.require(cu.profile_id is distinct from auth.uid(), 'You can’t change your own access');
  perform private.require(p_status is null or p_status in ('active','inactive'), 'Unknown status');
  perform private.require(p_role is null or p_role in ('client_admin','client_user'), 'Unknown role');
  perform private.require(not (p_status = 'active' and cu.status = 'invited'), 'They need to finish setting up their account first');
  select profile_id into v_primary from public.clients where id = cu.client_id;
  perform private.require(v_ira_admin or cu.profile_id is distinct from v_primary, 'The primary contact’s access is managed by IRA');

  -- Keep at least one active client admin.
  if (p_status = 'inactive' or p_role = 'client_user') and cu.role = 'client_admin' and cu.status = 'active' then
    select count(*) into v_admins from public.client_users
    where client_id = cu.client_id and role = 'client_admin' and status = 'active' and id <> cu.id;
    perform private.require(v_admins > 0, 'Your organisation needs at least one active administrator');
  end if;

  update public.client_users set
    status = coalesce(case when p_status = 'active' and cu.status = 'inactive' then 'active' else p_status end, status),
    role = coalesce(p_role, role),
    updated_at = now()
  where id = cu.id;
end $$;

revoke execute on function public.client_user_update(uuid, text, text) from public, anon;
grant execute on function public.client_user_update(uuid, text, text) to authenticated;
