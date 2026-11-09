-- SIGMA 1 — fixes from the final run-through (9 Nov 2026).

-- 1. Push alerts on a shared phone/computer: when a second person signs in on a device the first person used,
--    saving the device failed ("Cannot transfer push subscription ownership") — so the new person got no alerts
--    and the old person's alerts kept arriving on that device. The device is now handed to whoever signs in.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
 returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_user_id uuid := auth.uid(); v_sub_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required to save push subscription'; end if;
  if p_endpoint is null or p_p256dh is null or p_auth is null then raise exception 'Invalid subscription credentials'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Invalid subscription endpoint'; end if;
  -- This browser now belongs to the person signed in on it: stop sending the previous person's alerts here.
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> v_user_id;
  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth, user_agent, updated_at)
  values (v_user_id, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300), now())
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, updated_at = now()
  returning id into v_sub_id;
  return v_sub_id;
end $function$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- 2. Breaks: an employee could end a break with any break_end they chose (e.g. one minute after it started),
--    so a long break counted as one minute. A break now ends at the server's clock. Only the system
--    (scheduled auto check-out, service role) may close a break at a given time.
create or replace function private.validate_break_update()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  eid uuid := private.current_employee_id();
  end_at timestamptz;
begin
  if private.is_service_role() then
    NEW.id := OLD.id; NEW.attendance_id := OLD.attendance_id; NEW.employee_id := OLD.employee_id;
    NEW.break_start := OLD.break_start; NEW.created_at := OLD.created_at;
    if OLD.break_end is not null then raise exception 'Break is already closed'; end if;
    end_at := greatest(coalesce(NEW.break_end, now()), OLD.break_start);
    NEW.break_end := end_at;
    NEW.duration_seconds := greatest(0, floor(extract(epoch from (end_at - OLD.break_start)))::integer);
    return NEW;
  end if;
  if eid is null or OLD.employee_id<>eid then raise exception 'Unauthorized break update'; end if;
  NEW.id:=OLD.id; NEW.attendance_id:=OLD.attendance_id; NEW.employee_id:=OLD.employee_id;
  NEW.break_start:=OLD.break_start; NEW.created_at:=OLD.created_at;
  if OLD.break_end is not null then raise exception 'Break is already closed'; end if;
  end_at:=now();
  if end_at<=OLD.break_start then raise exception 'Break end must be after break start'; end if;
  NEW.break_end:=end_at;
  NEW.duration_seconds:=greatest(0,floor(extract(epoch from (end_at-OLD.break_start)))::integer);
  return NEW;
end;
$function$;

-- 3. "Auto check-out" in How they work (none / at shift end / at midnight) was saved but nothing acted on it,
--    so people who forgot to check out stayed "working" and were blocked the next morning.
--    Runs every 10 minutes; checks the person out at the time their rule says (not the time the job runs).
create or replace function private.auto_checkout_due()
 returns integer language plpgsql security definer set search_path to ''
as $function$
declare
  a public.attendance; dr jsonb; sh jsonb; v_mode text; v_target timestamptz; v_break int; v_work int;
  v_profile uuid; n int := 0; v_label text;
begin
  -- Act as the system for the attendance/break checks (admin path), only inside this function.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  for a in
    select * from public.attendance
    where current_state <> 'completed' and check_out_at is null and check_in_at is not null
      and date >= (now() at time zone 'Asia/Kolkata')::date - 7
    order by date, check_in_at
    for update skip locked
  loop
    dr := private.day_rules(a.employee_id, a.date);
    v_mode := coalesce(dr ->> 'auto_checkout', 'none');
    if v_mode = 'shift_end' then
      sh := coalesce(nullif(dr -> 'shift2', 'null'::jsonb), nullif(dr -> 'shift', 'null'::jsonb));
      continue when sh is null or sh ->> 'end' is null;
      v_target := ((a.date + case when coalesce((sh ->> 'overnight')::boolean, false) then 1 else 0 end)
                   + (sh ->> 'end')::time) at time zone 'Asia/Kolkata';
      v_label := 'at the end of the shift';
    elsif v_mode = 'midnight' then
      v_target := ((a.date + 1)::timestamp at time zone 'Asia/Kolkata') - interval '1 second';
      v_label := 'at midnight';
    else
      continue;
    end if;
    -- Checked in after the shift had already ended (late or extra work): close at midnight instead, never at check-in.
    if v_target <= a.check_in_at then
      v_target := ((a.date + 1)::timestamp at time zone 'Asia/Kolkata') - interval '1 second';
      v_label := 'at midnight';
    end if;
    continue when now() < v_target or v_target <= a.check_in_at;

    -- Close an open break at the check-out time (or where it started, if it started later).
    update public.break_events set break_end = greatest(break_start, v_target)
     where attendance_id = a.id and break_end is null;
    select coalesce(sum(duration_seconds), 0) into v_break from public.break_events where attendance_id = a.id;
    v_work := greatest(0, floor(extract(epoch from (v_target - a.check_in_at)))::integer - v_break);

    update public.attendance set check_out_at = v_target, current_state = 'completed',
      total_break_seconds = v_break, working_seconds = v_work,
      notes = concat_ws(' · ', nullif(notes, ''), 'Checked out automatically ' || v_label)
     where id = a.id;
    insert into public.attendance_events(attendance_id, event_type, event_at, user_agent, metadata)
    values (a.id, 'check_out', v_target, 'system', jsonb_build_object('auto_checkout', v_mode));

    select profile_id into v_profile from public.employees where id = a.employee_id;
    if v_profile is not null then
      perform private.notify(v_profile, 'attendance', 'You were checked out automatically',
        'You didn’t check out, so SIGMA checked you out ' || v_label || ' (' || private.ist_time(v_target) || '). '
        || 'If you worked later, ask for a correction.', '/emp-attendance', 'auto-checkout:' || a.id,
        jsonb_build_object('attendance_id', a.id));
    end if;
    n := n + 1;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  return n;
end $function$;
revoke all on function private.auto_checkout_due() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sigma-auto-checkout') then
    perform cron.unschedule('sigma-auto-checkout');
  end if;
  perform cron.schedule('sigma-auto-checkout', '*/10 * * * *', $c$select private.auto_checkout_due();$c$);
end $$;

-- 4. Faster notification / push queries: evaluate auth.uid() once per query, not once per row.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated using (recipient_id = (select auth.uid()));
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications for delete to authenticated using (recipient_id = (select auth.uid()));
drop policy if exists notifications_insert_admin on public.notifications;
create policy notifications_insert_admin on public.notifications for insert to authenticated
  with check (exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin'));
drop policy if exists push_sub_select_own on public.push_subscriptions;
create policy push_sub_select_own on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists push_sub_insert_own on public.push_subscriptions;
create policy push_sub_insert_own on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists push_sub_update_own on public.push_subscriptions;
create policy push_sub_update_own on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists push_sub_delete_own on public.push_subscriptions;
create policy push_sub_delete_own on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
