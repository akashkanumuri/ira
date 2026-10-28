-- Verifies the office geofence (20261028150000_office_geofence.sql) inside a transaction that is always rolled back.
-- Paste the migration body where marked when testing before it is applied. Nothing persists.
begin;
-- @@MIGRATION@@
create temp table _r(msg text) on commit drop;
create temp table _ok(msg text) on commit drop;
grant all on _r, _ok to authenticated, anon;

do $$
declare
  v_emp uuid; v_prof uuid; v_admin uuid; v_res jsonb; v_id uuid; v_n int; v_meta jsonb; v_row record;
  o_lat double precision := 17.4400; o_lng double precision := 78.3480;
  m_per_deg_lat double precision := 111195.08;
begin
  select e.id, e.profile_id into v_emp, v_prof from public.employees e
   where e.status = 'active' and e.profile_id is not null and coalesce(e.work_mode, 'office') <> 'remote'
     and e.join_date <= (now() at time zone 'Asia/Kolkata')::date
     and not exists (select 1 from public.attendance a where a.employee_id = e.id and (a.date = (now() at time zone 'Asia/Kolkata')::date or a.current_state <> 'completed'))
     and not exists (select 1 from public.leave_requests l where l.employee_id = e.id and l.status = 'approved' and (now() at time zone 'Asia/Kolkata')::date between l.start_date and l.end_date)
   limit 1;
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_emp is null then insert into _r values ('no suitable employee for the test'); return; end if;

  -- distance helper
  if abs(private.geo_distance_m(o_lat, o_lng, o_lat + 1, o_lng) - m_per_deg_lat) > 5 then insert into _r values ('geo_distance_m wrong'); end if;

  -- A: fence off -> office check-in without location works
  perform set_config('request.jwt.claims', json_build_object('sub', v_prof, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_prof::text, true);
  set local role authenticated;
  v_res := public.attendance_check_in('office');
  reset role;
  if not coalesce((v_res->>'ok')::boolean, false) then insert into _r values ('A fence off: ' || v_res::text); else insert into _ok values ('A'); end if;
  delete from public.attendance where employee_id = v_emp and date = (now() at time zone 'Asia/Kolkata')::date;

  -- turn the fence on
  update public.office_location set latitude = o_lat, longitude = o_lng, radius_m = 150, enabled = true, name = 'Test Office';

  -- C: direct insert as the employee is refused
  begin
    set local role authenticated;
    insert into public.attendance(employee_id, date, mode) values (v_emp, (now() at time zone 'Asia/Kolkata')::date, 'office');
    reset role;
    insert into _r values ('C direct insert allowed with fence on');
  exception when others then
    reset role;
    if sqlerrm not like 'Office check-in needs your location%' then insert into _r values ('C wrong error: ' || sqlerrm); else insert into _ok values ('C'); end if;
  end;

  set local role authenticated;
  -- D: no location
  v_res := public.attendance_check_in('office');
  if v_res->>'reason' <> 'location_required' then insert into _r values ('D: ' || v_res::text); else insert into _ok values ('D'); end if;
  -- E: 2 km away
  v_res := public.attendance_check_in('office', o_lat + 2000 / m_per_deg_lat, o_lng, 20);
  if v_res->>'reason' <> 'outside' or abs((v_res->>'distance')::numeric - 2000) > 3 then insert into _r values ('E: ' || v_res::text); else insert into _ok values ('E'); end if;
  -- G: 300 m, ±50 -> outside
  v_res := public.attendance_check_in('office', o_lat + 300 / m_per_deg_lat, o_lng, 50);
  if v_res->>'reason' <> 'outside' then insert into _r values ('G: ' || v_res::text); else insert into _ok values ('G'); end if;
  -- H: near, but ±1500 m -> imprecise
  v_res := public.attendance_check_in('office', o_lat, o_lng, 1500);
  if v_res->>'reason' <> 'imprecise' then insert into _r values ('H: ' || v_res::text); else insert into _ok values ('H'); end if;
  -- H2: 600 m, ±400 -> imprecise (not "outside")
  v_res := public.attendance_check_in('office', o_lat + 600 / m_per_deg_lat, o_lng, 400);
  if v_res->>'reason' <> 'imprecise' then insert into _r values ('H2: ' || v_res::text); else insert into _ok values ('H2'); end if;
  -- K: employee cannot change the office
  update public.office_location set radius_m = 2000;
  get diagnostics v_n = row_count;
  if v_n <> 0 then insert into _r values ('K employee updated office_location'); else insert into _ok values ('K'); end if;
  -- I: employee cannot use admin check-in
  begin
    perform public.admin_check_in(v_emp, now(), 'sneaky');
    insert into _r values ('I employee could call admin_check_in');
  exception when others then insert into _ok values ('I');
  end;
  -- F: 120 m, ±30 -> accepted, geo recorded
  v_res := public.attendance_check_in('office', o_lat + 120 / m_per_deg_lat, o_lng, 30);
  reset role;
  if not coalesce((v_res->>'ok')::boolean, false) then insert into _r values ('F: ' || v_res::text);
  else
    select metadata into v_meta from public.attendance_events where attendance_id = (v_res->>'id')::uuid and event_type = 'check_in';
    if (v_meta->'geo'->>'distance_m')::numeric not between 118 and 122 then insert into _r values ('F geo meta: ' || coalesce(v_meta::text, 'null')); else insert into _ok values ('F'); end if;
  end if;
  -- check-out still works anywhere (no location involved)
  set local role authenticated;
  update public.attendance set current_state = 'completed' where id = (v_res->>'id')::uuid;
  reset role;
  if not exists (select 1 from public.attendance where id = (v_res->>'id')::uuid and check_out_at is not null) then insert into _r values ('checkout failed'); else insert into _ok values ('checkout'); end if;
  delete from public.attendance where employee_id = v_emp and date = (now() at time zone 'Asia/Kolkata')::date;

  -- WFH without approval is still refused (unchanged rule)
  begin
    set local role authenticated;
    perform public.attendance_check_in('wfh');
    reset role;
    if not exists (select 1 from public.wfh_requests w where w.employee_id = v_emp and w.status = 'approved' and w.date = (now() at time zone 'Asia/Kolkata')::date) then
      insert into _r values ('WFH without approval accepted');
    end if;
  exception when others then reset role; insert into _ok values ('wfh');
  end;
  delete from public.attendance where employee_id = v_emp and date = (now() at time zone 'Asia/Kolkata')::date;

  -- J: admin check-in
  if v_admin is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    set local role authenticated;
    v_id := public.admin_check_in(v_emp, now() - interval '1 hour', 'Laptop location off');
    reset role;
    select * into v_row from public.attendance where id = v_id;
    if v_row.mode <> 'office' or v_row.current_state <> 'working' or abs(extract(epoch from (v_row.check_in_at - (now() - interval '1 hour')))) > 5
       or v_row.notes not like 'Checked in by admin:%' then insert into _r values ('J row wrong');
    elsif not exists (select 1 from public.audit_logs where entity_id = v_id::text and action = 'admin_check_in') then insert into _r values ('J no audit');
    elsif not exists (select 1 from public.notifications where idempotency_key like 'admin_checkin_' || v_id || '%') then insert into _r values ('J no employee notification');
    else insert into _ok values ('J'); end if;
    -- admin can update the office row
    set local role authenticated;
    update public.office_location set radius_m = 200;
    get diagnostics v_n = row_count;
    reset role;
    if v_n <> 1 then insert into _r values ('admin could not update office'); else insert into _ok values ('admin update'); end if;
  end if;

  -- L: anon cannot call
  begin
    set local role anon;
    perform public.attendance_check_in('office', o_lat, o_lng, 10);
    reset role;
    insert into _r values ('L anon could call attendance_check_in');
  exception when others then reset role; insert into _ok values ('L');
  end;
exception when others then
  reset role;
  insert into _r values ('unexpected: ' || sqlerrm);
end $$;

select coalesce(string_agg(msg, ' | '), 'GEOFENCE_TEST failed=0') || ' · passed: ' || (select string_agg(msg, ',') from _ok) as result from _r;
rollback;
