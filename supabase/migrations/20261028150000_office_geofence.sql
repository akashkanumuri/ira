-- SIGMA 1 — office geofence for check-in.
-- The admin saves the office's coordinates and a radius (default 150 m). Once it is switched on, an OFFICE check-in
-- is accepted only through public.attendance_check_in(), which receives the browser's location and checks the
-- distance on the server. Check-out, breaks, approved WFH and remote employees are not restricted.
-- An admin can check someone in for today (public.admin_check_in) when their location fails; a reason is required
-- and the action is written to the audit log.

create table if not exists public.office_location (
  id boolean primary key default true check (id),
  name text not null default 'Office' check (length(btrim(name)) between 1 and 80),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  radius_m integer not null default 150 check (radius_m between 50 and 2000),
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint office_location_needs_coords check (not enabled or (latitude is not null and longitude is not null))
);
insert into public.office_location(id) values (true) on conflict (id) do nothing;

alter table public.office_location enable row level security;
drop policy if exists office_location_select on public.office_location;
create policy office_location_select on public.office_location for select to authenticated using (true);
drop policy if exists office_location_admin_update on public.office_location;
create policy office_location_admin_update on public.office_location for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
revoke all on public.office_location from anon, authenticated;
grant select on public.office_location to authenticated;
grant update (name, latitude, longitude, radius_m, enabled) on public.office_location to authenticated;

create or replace function private.office_location_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  perform private.audit('office_location', 'office', 'update',
    jsonb_build_object('before', jsonb_build_object('name', OLD.name, 'latitude', OLD.latitude, 'longitude', OLD.longitude, 'radius_m', OLD.radius_m, 'enabled', OLD.enabled),
                       'after',  jsonb_build_object('name', NEW.name, 'latitude', NEW.latitude, 'longitude', NEW.longitude, 'radius_m', NEW.radius_m, 'enabled', NEW.enabled)));
  return NEW;
end $$;
drop trigger if exists trg_office_location_stamp on public.office_location;
create trigger trg_office_location_stamp before update on public.office_location
  for each row execute function private.office_location_stamp();

-- Great-circle distance in metres (haversine).
create or replace function private.geo_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

-- Insert guard: same rules as before, plus (a) an office check-in needs the location check when the fence is on,
-- and (b) the admin check-in path.
create or replace function private.validate_attendance_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  eid uuid;
  local_date date := (now() at time zone 'Asia/Kolkata')::date;
  emp record;
  wfh record;
  leave_rec record;
  is_reg boolean := coalesce(current_setting('ira.regularization',true),'off')='on';
  is_admin_in boolean := coalesce(current_setting('ira.admin_checkin',true),'off')='on';
begin
  if is_reg or is_admin_in then
    eid := NEW.employee_id;
  else
    eid := private.current_employee_id();
  end if;

  if eid is null then raise exception 'Active employee account required'; end if;
  if NEW.employee_id <> eid then raise exception 'Invalid employee'; end if;

  if not is_reg then
    NEW.date := local_date;

    if exists (
      select 1
      from public.attendance a
      where a.employee_id=eid
        and a.date<NEW.date
        and a.current_state<>'completed'
    ) then
      raise exception 'Previous attendance is still open. Close or regularize the previous shift before checking in.';
    end if;
  end if;

  select e.* into emp
  from public.employees e
  where e.id=eid and e.status='active';

  if emp.id is null then raise exception 'Active employee record not found'; end if;
  if NEW.date < emp.join_date then raise exception 'Attendance cannot be recorded before the employee join date'; end if;

  if extract(dow from NEW.date)=0 then raise exception 'Sunday is a weekly off'; end if;
  if exists(select 1 from public.holidays h where h.date=NEW.date) then raise exception 'This date is a company holiday'; end if;

  if emp.work_mode='remote' then
    if NEW.mode <> 'wfh' then raise exception 'Remote employees must check in as WFH'; end if;
  elsif NEW.mode='wfh' then
    select wr.* into wfh
    from public.wfh_requests wr
    where wr.employee_id=eid and wr.date=NEW.date and wr.status='approved';
    if wfh.id is null and not is_reg then
      raise exception 'WFH is not approved for this date';
    end if;
    NEW.wfh_request_id := wfh.id;
  end if;

  -- office geofence: an employee's own office check-in must come through attendance_check_in()
  if NEW.mode='office' and not is_reg and not is_admin_in
     and coalesce(current_setting('ira.geo_checkin',true),'off') <> 'on'
     and exists (select 1 from public.office_location o where o.id and o.enabled) then
    raise exception 'Office check-in needs your location. Refresh the page and check in again.';
  end if;

  select lr.* into leave_rec
  from public.leave_requests lr
  where lr.employee_id=eid
    and lr.status='approved'
    and lr.start_date<=NEW.date
    and lr.end_date>=NEW.date
  limit 1;

  if leave_rec.id is not null then raise exception 'Approved leave exists for this date'; end if;

  if NEW.id is null then NEW.id:=extensions.uuid_generate_v4(); end if;

  if is_reg then
    if NEW.check_in_at is null or NEW.check_out_at is null then raise exception 'Regularization requires both check-in and check-out'; end if;
    NEW.current_state:='completed';
    NEW.working_seconds:=greatest(0,floor(extract(epoch from(NEW.check_out_at-NEW.check_in_at)))::integer-coalesce(NEW.total_break_seconds,0));
    NEW.total_break_seconds:=coalesce(NEW.total_break_seconds,0);
  else
    NEW.check_in_at:=case when is_admin_in then coalesce(NEW.check_in_at, now()) else now() end;
    NEW.check_out_at:=null;
    NEW.current_state:='working';
    NEW.working_seconds:=0;
    NEW.total_break_seconds:=0;
  end if;

  NEW.status:=case when (NEW.check_in_at at time zone 'Asia/Kolkata')::time>emp.shift_start then 'late' else 'present' end;
  NEW.created_at:=coalesce(NEW.created_at,now());
  NEW.updated_at:=now();
  return NEW;
end;
$function$;

-- Employee check-in. Location is only needed (and only checked) for an office check-in while the fence is on.
-- Returns {ok:true,id} or {ok:false, reason:'location_required'|'imprecise'|'outside', distance, accuracy, radius, office}.
create or replace function public.attendance_check_in(
  p_mode text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy double precision default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_eid uuid := private.current_employee_id();
  v_off public.office_location%rowtype;
  v_dist double precision;
  v_geo jsonb;
  v_id uuid;
begin
  if v_eid is null then raise exception 'Active employee account required'; end if;
  if p_mode is null or p_mode not in ('office', 'wfh') then raise exception 'Invalid check-in mode'; end if;

  if p_mode = 'office' then
    select * into v_off from public.office_location where id;
    if found and v_off.enabled then
      if p_lat is null or p_lng is null or p_accuracy is null then
        return jsonb_build_object('ok', false, 'reason', 'location_required', 'office', v_off.name);
      end if;
      if p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_accuracy < 0 or p_accuracy > 1000000 then
        raise exception 'Invalid location';
      end if;
      v_dist := private.geo_distance_m(p_lat, p_lng, v_off.latitude, v_off.longitude);
      -- inside = the reading, allowing for up to 100 m of its own stated error, falls within the radius
      if p_accuracy > 1000 or v_dist - least(p_accuracy, 100) > v_off.radius_m then
        return jsonb_build_object('ok', false,
          'reason', case when p_accuracy > greatest(v_off.radius_m, 150) then 'imprecise' else 'outside' end,
          'distance', round(v_dist), 'accuracy', round(p_accuracy), 'radius', v_off.radius_m, 'office', v_off.name);
      end if;
      v_geo := jsonb_build_object('distance_m', round(v_dist), 'accuracy_m', round(p_accuracy), 'radius_m', v_off.radius_m);
      perform set_config('ira.geo_checkin', 'on', true);
    end if;
  end if;

  insert into public.attendance(employee_id, date, mode)
  values (v_eid, (now() at time zone 'Asia/Kolkata')::date, p_mode)
  returning id into v_id;
  perform set_config('ira.geo_checkin', 'off', true);

  if v_geo is not null then
    update public.attendance_events set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('geo', v_geo)
     where attendance_id = v_id and event_type = 'check_in';
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.attendance_check_in(text, double precision, double precision, double precision) from public, anon;
grant execute on function public.attendance_check_in(text, double precision, double precision, double precision) to authenticated;

-- Admin: check an employee in for today when their location fails. Reason required; audited; employee notified.
create or replace function public.admin_check_in(p_employee_id uuid, p_check_in_at timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees%rowtype;
  v_at timestamptz := coalesce(p_check_in_at, now());
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_id uuid;
begin
  if not private.is_admin() then raise exception 'Only an admin can check someone in'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'Add a reason (at least 3 characters)'; end if;
  if (v_at at time zone 'Asia/Kolkata')::date <> v_today then raise exception 'Check-in time must be today'; end if;
  if v_at > now() + interval '1 minute' then raise exception 'Check-in time can''t be in the future'; end if;
  select * into v_emp from public.employees where id = p_employee_id and status = 'active';
  if v_emp.id is null then raise exception 'Active employee not found'; end if;

  perform set_config('ira.admin_checkin', 'on', true);
  insert into public.attendance(employee_id, date, mode, check_in_at, notes)
  values (p_employee_id, v_today, case when v_emp.work_mode = 'remote' then 'wfh' else 'office' end, least(v_at, now()),
          'Checked in by admin: ' || left(btrim(p_reason), 300))
  returning id into v_id;
  perform set_config('ira.admin_checkin', 'off', true);

  update public.attendance_events set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'admin', 'by', auth.uid())
   where attendance_id = v_id and event_type = 'check_in';
  perform private.audit('attendance', v_id::text, 'admin_check_in',
    jsonb_build_object('employee_id', p_employee_id, 'check_in_at', least(v_at, now())), btrim(p_reason));
  if v_emp.profile_id is not null then
    perform private.notify(v_emp.profile_id, 'attendance', 'You were checked in by an admin',
      'Checked in at ' || private.ist_time(least(v_at, now())) || ' · ' || left(btrim(p_reason), 120),
      '/emp-attendance', 'admin_checkin_' || v_id, jsonb_build_object('attendance_id', v_id));
  end if;
  return v_id;
end $$;
revoke all on function public.admin_check_in(uuid, timestamptz, text) from public, anon;
grant execute on function public.admin_check_in(uuid, timestamptz, text) to authenticated;
