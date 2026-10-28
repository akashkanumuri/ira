-- SIGMA 1 — work patterns, step 2: check-in follows each person's rules (private.day_rules).
--  • working days / Saturdays / holidays come from the person's pattern (not a fixed Sunday + company holidays)
--  • hybrid: any N office days per week/month; home days within the quota need no request; beyond it follows
--    "extra WFH" (free · needs approval · not allowed); must-come days are office days
--  • office people: WFH needs an approved request unless their pattern says WFH is free
--  • remote: WFH only (unchanged)
--  • the office location check applies only when the pattern requires it; client/field visits (when allowed) check in
--    away from the office with a reason
--  • earliest check-in time
--  • freelancers / project-based (no attendance) can't check in
-- Late/present status is unchanged here (step 3).

-- Hybrid quota for the week/month containing p_date.
create or replace function private.hybrid_status(p_employee_id uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.employee_work_rules%rowtype;
  v_start date; v_end date; d date;
  v_working int := 0; v_office int := 0; v_home int := 0; v_required int;
begin
  r := private.work_rules_on(p_employee_id, p_date);
  if r.id is null or r.location_mode <> 'hybrid' then return null; end if;
  if r.office_days_period = 'month' then
    v_start := date_trunc('month', p_date)::date; v_end := (date_trunc('month', p_date) + interval '1 month - 1 day')::date;
  else
    v_start := p_date - (extract(isodow from p_date)::int - 1); v_end := v_start + 6;
  end if;
  d := v_start;
  while d <= v_end loop
    if coalesce((private.day_rules(p_employee_id, d)->>'working_day')::boolean, false)
       and not exists (select 1 from public.leave_requests l where l.employee_id = p_employee_id and l.status = 'approved' and d between l.start_date and l.end_date) then
      v_working := v_working + 1;
    end if;
    d := d + 1;
  end loop;
  select count(*) filter (where mode = 'office'), count(*) filter (where mode = 'wfh') into v_office, v_home
    from public.attendance where employee_id = p_employee_id and date between v_start and v_end;
  -- a holiday or leave in the period lowers the target (never above the days actually available)
  v_required := least(r.office_days_count, v_working);
  return jsonb_build_object('period', r.office_days_period, 'from', v_start, 'to', v_end,
    'required', v_required, 'configured', r.office_days_count, 'working_days', v_working,
    'office_done', v_office, 'home_done', v_home,
    'home_allowed', greatest(0, v_working - v_required),
    'home_left', greatest(0, v_working - v_required - v_home),
    'office_left', greatest(0, v_required - v_office));
end $$;

-- May this person check in as WFH on this date? Returns null when yes, otherwise the reason.
create or replace function private.wfh_refusal(p_employee_id uuid, p_date date, p_dr jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_extra text := coalesce(p_dr->'office_days'->>'extra_wfh', null); r public.employee_work_rules%rowtype; h jsonb;
begin
  if p_dr->>'location' = 'home' then return null; end if;
  -- an approved WFH request always counts
  if exists (select 1 from public.wfh_requests w where w.employee_id = p_employee_id and w.date = p_date and w.status = 'approved') then return null; end if;
  r := private.work_rules_on(p_employee_id, p_date);
  v_extra := coalesce(r.extra_wfh, 'approval');
  if p_dr->>'location' = 'either' then
    h := private.hybrid_status(p_employee_id, p_date);
    if coalesce((h->>'home_left')::int, 0) > 0 then return null; end if;
    if v_extra = 'free' then return null; end if;
    return case when v_extra = 'approval'
      then 'You’ve used this ' || coalesce(h->>'period', 'week') || '’s home days. Request WFH for today, or check in at the office.'
      else 'You’ve used this ' || coalesce(h->>'period', 'week') || '’s home days. Check in at the office today.' end;
  end if;
  -- 'office' location: an office person, or a hybrid must-come day
  if v_extra = 'free' then return null; end if;
  if r.location_mode = 'hybrid' then
    return case when v_extra = 'approval' then 'Today is one of your office days. Request WFH for today if you need it.' else 'Today is one of your office days.' end;
  end if;
  return case when v_extra = 'approval' then 'WFH is not approved for this date' else 'Work from home isn’t part of your work pattern.' end;
end $$;

create or replace function private.validate_attendance_insert()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  eid uuid;
  local_date date := (now() at time zone 'Asia/Kolkata')::date;
  emp record; wfh record; leave_rec record; dr jsonb; v_refuse text;
  is_reg boolean := coalesce(current_setting('ira.regularization',true),'off')='on';
  is_admin_in boolean := coalesce(current_setting('ira.admin_checkin',true),'off')='on';
begin
  if is_reg or is_admin_in then eid := NEW.employee_id; else eid := private.current_employee_id(); end if;
  if eid is null then raise exception 'Active employee account required'; end if;
  if NEW.employee_id <> eid then raise exception 'Invalid employee'; end if;
  if not is_reg then
    NEW.date := local_date;
    if exists (select 1 from public.attendance a where a.employee_id=eid and a.date<NEW.date and a.current_state<>'completed') then
      raise exception 'Previous attendance is still open. Close or regularize the previous shift before checking in.';
    end if;
  end if;
  select e.* into emp from public.employees e where e.id=eid and e.status='active';
  if emp.id is null then raise exception 'Active employee record not found'; end if;
  if NEW.date < emp.join_date then raise exception 'Attendance cannot be recorded before the employee join date'; end if;

  dr := private.day_rules(eid, NEW.date);
  if not coalesce((dr->>'attendance')::boolean, true) and not is_reg and not is_admin_in then
    raise exception 'Attendance isn’t tracked for your account';
  end if;
  if not coalesce((dr->>'working_day')::boolean, true) then
    case dr->>'off_reason'
      when 'holiday' then raise exception 'This date is a company holiday';
      when 'weekly_off' then raise exception '%', case when extract(dow from NEW.date)=0 then 'Sunday is a weekly off' else 'This is your weekly off' end;
      when 'saturday_off' then raise exception 'This Saturday is your day off';
      when 'engagement_ended' then raise exception 'Your engagement has ended';
      else null;
    end case;
  end if;

  if dr->>'location' = 'home' then
    if NEW.mode <> 'wfh' then raise exception 'Remote employees must check in as WFH'; end if;
  elsif NEW.mode='wfh' then
    select wr.* into wfh from public.wfh_requests wr where wr.employee_id=eid and wr.date=NEW.date and wr.status='approved';
    if not is_reg and not is_admin_in then
      v_refuse := private.wfh_refusal(eid, NEW.date, dr);
      if v_refuse is not null then raise exception '%', v_refuse; end if;
    end if;
    NEW.wfh_request_id := wfh.id;
  end if;

  if not is_reg and not is_admin_in and dr->>'earliest_checkin' is not null
     and (now() at time zone 'Asia/Kolkata')::time < (dr->>'earliest_checkin')::time then
    raise exception 'Check-in opens at %', to_char((dr->>'earliest_checkin')::time, 'HH12:MI AM');
  end if;

  if NEW.mode='office' and not is_reg and not is_admin_in
     and coalesce(current_setting('ira.geo_checkin',true),'off') <> 'on'
     and coalesce((dr->>'geofence')::boolean, true)
     and exists (select 1 from public.office_location o where o.id and o.enabled) then
    raise exception 'Office check-in needs your location. Refresh the page and check in again.';
  end if;

  select lr.* into leave_rec from public.leave_requests lr where lr.employee_id=eid and lr.status='approved' and lr.start_date<=NEW.date and lr.end_date>=NEW.date limit 1;
  if leave_rec.id is not null then raise exception 'Approved leave exists for this date'; end if;
  if NEW.id is null then NEW.id:=extensions.uuid_generate_v4(); end if;
  if is_reg then
    if NEW.check_in_at is null or NEW.check_out_at is null then raise exception 'Regularization requires both check-in and check-out'; end if;
    NEW.current_state:='completed';
    NEW.working_seconds:=greatest(0,floor(extract(epoch from(NEW.check_out_at-NEW.check_in_at)))::integer-coalesce(NEW.total_break_seconds,0));
    NEW.total_break_seconds:=coalesce(NEW.total_break_seconds,0);
  else
    NEW.check_in_at:=case when is_admin_in then coalesce(NEW.check_in_at, now()) else now() end;
    NEW.check_out_at:=null; NEW.current_state:='working'; NEW.working_seconds:=0; NEW.total_break_seconds:=0;
  end if;
  NEW.status:=case when (NEW.check_in_at at time zone 'Asia/Kolkata')::time>emp.shift_start then 'late' else 'present' end;
  NEW.created_at:=coalesce(NEW.created_at,now());
  NEW.updated_at:=now();
  return NEW;
end;
$function$;

-- Check-in: + client/field visit (reason; skips the office location check when the pattern allows it),
-- and the location check only when this person's pattern requires it.
drop function if exists public.attendance_check_in(text, double precision, double precision, double precision);
create or replace function public.attendance_check_in(
  p_mode text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy double precision default null,
  p_field_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_eid uuid := private.current_employee_id();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_dr jsonb; v_off public.office_location%rowtype; v_dist double precision; v_geo jsonb; v_id uuid; v_field text;
begin
  if v_eid is null then raise exception 'Active employee account required'; end if;
  if p_mode is null or p_mode not in ('office', 'wfh') then raise exception 'Invalid check-in mode'; end if;
  v_dr := private.day_rules(v_eid, v_today);
  v_field := nullif(btrim(coalesce(p_field_reason, '')), '');
  if v_field is not null then
    if p_mode <> 'office' then raise exception 'A client visit is an office-mode check-in'; end if;
    if not coalesce((v_dr->>'field_visit')::boolean, false) then raise exception 'Client visits aren’t part of your work pattern'; end if;
    if length(v_field) < 3 then raise exception 'Say where you’re going (at least 3 characters)'; end if;
    perform set_config('ira.geo_checkin', 'on', true);
    v_geo := jsonb_build_object('field_visit', left(v_field, 200));
    if p_lat is not null and p_lng is not null then
      v_geo := v_geo || jsonb_build_object('lat', round(p_lat::numeric, 5), 'lng', round(p_lng::numeric, 5), 'accuracy_m', round(coalesce(p_accuracy, 0)));
    end if;
  elsif p_mode = 'office' and coalesce((v_dr->>'geofence')::boolean, true) then
    select * into v_off from public.office_location where id;
    if found and v_off.enabled then
      if p_lat is null or p_lng is null or p_accuracy is null then
        return jsonb_build_object('ok', false, 'reason', 'location_required', 'office', v_off.name);
      end if;
      if p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_accuracy < 0 or p_accuracy > 1000000 then raise exception 'Invalid location'; end if;
      v_dist := private.geo_distance_m(p_lat, p_lng, v_off.latitude, v_off.longitude);
      if p_accuracy > 1000 or v_dist - least(p_accuracy, 100) > v_off.radius_m then
        return jsonb_build_object('ok', false, 'reason', case when p_accuracy > greatest(v_off.radius_m, 150) then 'imprecise' else 'outside' end,
          'distance', round(v_dist), 'accuracy', round(p_accuracy), 'radius', v_off.radius_m, 'office', v_off.name,
          'field_visit', coalesce((v_dr->>'field_visit')::boolean, false));
      end if;
      v_geo := jsonb_build_object('distance_m', round(v_dist), 'accuracy_m', round(p_accuracy), 'radius_m', v_off.radius_m);
      perform set_config('ira.geo_checkin', 'on', true);
    end if;
  else
    perform set_config('ira.geo_checkin', 'on', true);  -- no location check for this person
  end if;

  insert into public.attendance(employee_id, date, mode, notes)
  values (v_eid, v_today, p_mode, case when v_field is not null then 'Client visit: ' || left(v_field, 200) end)
  returning id into v_id;
  perform set_config('ira.geo_checkin', 'off', true);
  if v_geo is not null then
    update public.attendance_events set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('geo', v_geo)
     where attendance_id = v_id and event_type = 'check_in';
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.attendance_check_in(text, double precision, double precision, double precision, text) from public, anon;
grant execute on function public.attendance_check_in(text, double precision, double precision, double precision, text) to authenticated;

-- Everything the employee's attendance screen needs for today, in one call.
create or replace function public.my_attendance_context(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_eid uuid := private.current_employee_id();
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_dr jsonb; v_refusal text; v_req text;
begin
  if v_eid is null then return null; end if;
  v_dr := private.day_rules(v_eid, v_date);
  v_refusal := private.wfh_refusal(v_eid, v_date, v_dr);
  select status into v_req from public.wfh_requests where employee_id = v_eid and date = v_date order by created_at desc limit 1;
  return jsonb_build_object(
    'rules', v_dr,
    'hybrid', private.hybrid_status(v_eid, v_date),
    'wfh', jsonb_build_object('allowed', v_refusal is null, 'reason', v_refusal, 'request', v_req,
                              'can_request', (v_dr->'features'->>'wfh')::boolean),
    'office', (select jsonb_build_object('name', o.name, 'radius_m', o.radius_m, 'enabled', o.enabled) from public.office_location o where o.id)
  );
end $$;
revoke all on function public.my_attendance_context(date) from public, anon;
grant execute on function public.my_attendance_context(date) to authenticated;
