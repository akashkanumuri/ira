-- One device per employee login: a device that has been closed/inactive for 1 hour no longer holds the login.
-- The app checks in every minute while open (device_claim with p_is_sign_in = false), so last_seen_at tracks
-- real use. A sign-in on a new device takes over once the holder has been silent for an hour; if the old
-- device comes back it is signed out ("now signed in on another device").
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
  if v_lock.device_id = p_device_id and v_lock.released_at is null then
    update public.employee_device_locks set last_seen_at = now(),
      device_label = coalesce(nullif(v_label, 'Browser on unknown device'), device_label)
     where profile_id = v_uid;
    return jsonb_build_object('ok', true);
  end if;
  -- the login is free for a new sign-in when an admin released it or the holder has been inactive for 1 hour
  if p_is_sign_in and (v_lock.released_at is not null or v_lock.last_seen_at < now() - interval '1 hour') then
    update public.employee_device_locks set device_id = p_device_id, device_label = v_label, user_agent = left(p_user_agent, 500),
      locked_at = now(), last_seen_at = now(), released_at = null, last_blocked_at = null
     where profile_id = v_uid;
    return jsonb_build_object('ok', true);
  end if;
  if v_lock.released_at is not null then
    return jsonb_build_object('ok', false, 'released', true);
  end if;

  if p_is_sign_in and (v_lock.last_blocked_at is null or v_lock.last_blocked_at < now() - interval '10 minutes') then
    update public.employee_device_locks set last_blocked_at = now() where profile_id = v_uid;
    perform private.notify_admins_activity('signin',
      private.person_label(v_uid) || ' tried to sign in on a second device',
      v_label || ' was refused · already signed in on ' || coalesce(v_lock.device_label, 'another device'),
      '/admin-employees', 'act_blocked_' || v_uid || '_' || to_char(now(), 'YYYYMMDDHH24MI'),
      jsonb_build_object('user_id', v_uid));
  end if;
  return jsonb_build_object('ok', false, 'device', coalesce(v_lock.device_label, 'another device'),
    'since', v_lock.locked_at, 'last_seen', v_lock.last_seen_at,
    'free_at', v_lock.last_seen_at + interval '1 hour');
end $$;
revoke all on function public.device_claim(text, text, boolean) from public, anon;
grant execute on function public.device_claim(text, text, boolean) to authenticated;
