-- SIGMA 1 — one device per employee login.
-- An employee account can be signed in on one browser/device at a time. A sign-in from a second device is
-- refused until they sign out on the first one, or an admin releases the device. Admins and clients are exempt.
-- The device is identified by a random id the browser keeps (not hardware fingerprinting).

create table if not exists public.employee_device_locks (
  profile_id uuid primary key references auth.users(id) on delete cascade,
  device_id text not null check (length(device_id) between 8 and 100),
  device_label text,
  user_agent text,
  locked_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_blocked_at timestamptz,
  released_at timestamptz          -- set when an admin releases it: the old device is signed out, the next sign-in takes over
);
alter table public.employee_device_locks enable row level security;
drop policy if exists device_locks_select on public.employee_device_locks;
create policy device_locks_select on public.employee_device_locks for select to authenticated
  using (profile_id = (select auth.uid()) or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
grant select on public.employee_device_locks to authenticated;
-- no insert/update/delete grants: changes only go through the functions below

create or replace function private.is_device_locked_role(p_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = p_profile and role = 'employee')
$$;

-- Called right after a successful password check, and on every app start / minute while signed in.
-- Returns {ok:true} when this device holds (or just took) the lock, otherwise who holds it.
create or replace function public.device_claim(p_device_id text, p_user_agent text default null, p_is_sign_in boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_lock public.employee_device_locks%rowtype;
  v_label text := private.device_label(coalesce(p_user_agent, ''));
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not private.is_device_locked_role(v_uid) then return jsonb_build_object('ok', true, 'exempt', true); end if;
  if p_device_id is null or length(p_device_id) < 8 or length(p_device_id) > 100 then raise exception 'Invalid device'; end if;

  select * into v_lock from public.employee_device_locks where profile_id = v_uid for update;
  if not found then
    insert into public.employee_device_locks(profile_id, device_id, device_label, user_agent)
    values (v_uid, p_device_id, v_label, left(p_user_agent, 500));
    return jsonb_build_object('ok', true);
  end if;
  if v_lock.released_at is not null then
    if p_is_sign_in then
      update public.employee_device_locks set device_id = p_device_id, device_label = v_label, user_agent = left(p_user_agent, 500),
        locked_at = now(), last_seen_at = now(), released_at = null, last_blocked_at = null
       where profile_id = v_uid;
      return jsonb_build_object('ok', true);
    end if;
    return jsonb_build_object('ok', false, 'released', true);
  end if;
  if v_lock.device_id = p_device_id then
    update public.employee_device_locks set last_seen_at = now(),
      device_label = coalesce(nullif(v_label, 'Browser on unknown device'), device_label)
     where profile_id = v_uid;
    return jsonb_build_object('ok', true);
  end if;

  -- another device holds the login: refuse, and tell the admins about a sign-in attempt (at most every 10 min)
  if p_is_sign_in and (v_lock.last_blocked_at is null or v_lock.last_blocked_at < now() - interval '10 minutes') then
    update public.employee_device_locks set last_blocked_at = now() where profile_id = v_uid;
    perform private.notify_admins_activity('signin',
      private.person_label(v_uid) || ' tried to sign in on a second device',
      v_label || ' was refused · already signed in on ' || coalesce(v_lock.device_label, 'another device'),
      '/admin-employees', 'act_blocked_' || v_uid || '_' || to_char(now(), 'YYYYMMDDHH24MI'),
      jsonb_build_object('user_id', v_uid));
  end if;
  return jsonb_build_object('ok', false, 'device', coalesce(v_lock.device_label, 'another device'),
    'since', v_lock.locked_at, 'last_seen', v_lock.last_seen_at);
end $$;
revoke all on function public.device_claim(text, text, boolean) from public, anon;
grant execute on function public.device_claim(text, text, boolean) to authenticated;

-- Sign-out on the device that holds the lock frees the account for another device.
create or replace function public.device_release(p_device_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.employee_device_locks where profile_id = auth.uid() and device_id = p_device_id;
end $$;
revoke all on function public.device_release(text) from public, anon;
grant execute on function public.device_release(text) to authenticated;

-- Admin: free an employee whose device was lost, reset, or never signed out. The old device gets signed out
-- within a minute; the next sign-in (on any device) takes over.
create or replace function public.admin_release_device(p_profile_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Only an admin can release a device';
  end if;
  update public.employee_device_locks set released_at = now() where profile_id = p_profile_id;
end $$;
revoke all on function public.admin_release_device(uuid) from public, anon;
grant execute on function public.admin_release_device(uuid) to authenticated;
