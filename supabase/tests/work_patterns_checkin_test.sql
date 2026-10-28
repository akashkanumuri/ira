-- Verifies 20261029120000_work_patterns_checkin.sql (after 20261029090000_work_patterns.sql) inside a rolled-back transaction.
begin;
-- @@MIGRATION@@
create temp table _r(msg text) on commit drop;
create temp table _ok(msg text) on commit drop;
grant all on _r, _ok to authenticated, anon;
create or replace function pg_temp.as_user(p uuid) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p::text, true);
$f$;
do $$
declare
  v_admin uuid; v_emp uuid; v_prof uuid; v_res jsonb; v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_dow int := extract(isodow from (now() at time zone 'Asia/Kolkata')::date); v_ctx jsonb; v_notes text;
  procedure_reset text;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select e.id, e.profile_id into v_emp, v_prof from public.employees e
   where e.status = 'active' and e.profile_id is not null and e.join_date <= v_today
     and not exists (select 1 from public.attendance a where a.employee_id = e.id and (a.date = v_today or a.current_state <> 'completed' or (a.mode = 'wfh' and a.date >= v_today - 7)))
     and not exists (select 1 from public.leave_requests l where l.employee_id = e.id and l.status = 'approved' and v_today between l.start_date and l.end_date)
   limit 1;
  if v_emp is null then insert into _r values ('no suitable employee'); return; end if;
  if v_dow = 7 then insert into _r values ('run on a non-Sunday'); return; end if;
  delete from public.holidays where date = v_today;
  update public.office_location set enabled = false;

  -- A: office default — WFH needs approval, office works
  perform pg_temp.as_user(v_prof); set local role authenticated;
  begin perform public.attendance_check_in('wfh'); insert into _r values ('A wfh w/o approval accepted');
  exception when others then if sqlerrm like 'WFH is not approved%' then insert into _ok values ('A-wfh'); else insert into _r values ('A wfh msg: ' || sqlerrm); end if; end;
  v_res := public.attendance_check_in('office');
  reset role;
  if not (v_res->>'ok')::boolean then insert into _r values ('A office ' || v_res::text); else insert into _ok values ('A-office'); end if;
  delete from public.attendance where employee_id = v_emp and date = v_today;

  -- B: hybrid, home days left → WFH free; quota = all working days → refused
  perform pg_temp.as_user(v_admin);
  perform public.admin_set_work_rules(v_emp, '{"location_mode":"hybrid","office_days_count":3,"extra_wfh":"not_allowed","schedule_type":"flexible","working_days":[1,2,3,4,5,6]}'::jsonb, v_today);
  perform pg_temp.as_user(v_prof); set local role authenticated;
  v_ctx := public.my_attendance_context();
  v_res := public.attendance_check_in('wfh');
  reset role;
  if not (v_res->>'ok')::boolean or (v_ctx->'hybrid'->>'required')::int < 1 then insert into _r values ('B wfh within quota ' || v_res::text || v_ctx::text); else insert into _ok values ('B-quota'); end if;
  delete from public.attendance where employee_id = v_emp and date = v_today;
  perform pg_temp.as_user(v_admin);
  perform public.admin_set_work_rules(v_emp, '{"location_mode":"hybrid","office_days_count":6,"extra_wfh":"not_allowed","schedule_type":"flexible","working_days":[1,2,3,4,5,6]}'::jsonb, v_today);
  perform pg_temp.as_user(v_prof); set local role authenticated;
  begin perform public.attendance_check_in('wfh'); insert into _r values ('B no home days left but accepted');
  exception when others then if sqlerrm like '%home days%' then insert into _ok values ('B-exhausted'); else insert into _r values ('B msg: ' || sqlerrm); end if; end;
  reset role;

  -- C: must-come today → WFH refused, office ok
  perform pg_temp.as_user(v_admin);
  perform public.admin_set_work_rules(v_emp, jsonb_build_object('location_mode','hybrid','office_days_count',2,'must_come_days',jsonb_build_array(v_dow),'extra_wfh','approval','schedule_type','flexible','working_days',jsonb_build_array(1,2,3,4,5,6)), v_today);
  perform pg_temp.as_user(v_prof); set local role authenticated;
  begin perform public.attendance_check_in('wfh'); insert into _r values ('C wfh on must-come accepted');
  exception when others then if sqlerrm like 'Today is one of your office days%' then insert into _ok values ('C-mustcome'); else insert into _r values ('C msg: ' || sqlerrm); end if; end;
  reset role;

  -- D: fence on but this person doesn't need the location check
  update public.office_location set latitude = 17.44, longitude = 78.35, enabled = true;
  perform pg_temp.as_user(v_admin);
  perform public.admin_set_work_rules(v_emp, '{"location_mode":"office","geofence_required":false,"schedule_type":"fixed","shift_start":"09:00","shift_end":"18:00"}'::jsonb, v_today);
  perform pg_temp.as_user(v_prof); set local role authenticated;
  v_res := public.attendance_check_in('office');
  reset role;
  if not (v_res->>'ok')::boolean then insert into _r values ('D no-geofence ' || v_res::text); else insert into _ok values ('D-nofence'); end if;
  delete from public.attendance where employee_id = v_emp and date = v_today;

  -- E: client visit
  perform pg_temp.as_user(v_admin);
  perform public.admin_set_work_rules(v_emp, '{"location_mode":"office","field_visit_allowed":true,"schedule_type":"fixed","shift_start":"09:00","shift_end":"18:00"}'::jsonb, v_today);
  perform pg_temp.as_user(v_prof); set local role authenticated;
  v_res := public.attendance_check_in('office', null, null, null, 'Delta Spaces site');
  reset role;
  select notes into v_notes from public.attendance where employee_id = v_emp and date = v_today;
  if not (v_res->>'ok')::boolean or v_notes <> 'Client visit: Delta Spaces site' then insert into _r values ('E visit ' || v_res::text || coalesce(v_notes,'')); else insert into _ok values ('E-visit'); end if;
  delete from public.attendance where employee_id = v_emp and date = v_today;
  -- fence still enforced for a normal office check-in
  perform pg_temp.as_user(v_prof); set local role authenticated;
  v_res := public.attendance_check_in('office');
  reset role;
  if v_res->>'reason' <> 'location_required' then insert into _r values ('E fence ' || v_res::text); else insert into _ok values ('E-fence'); end if;
  perform pg_temp.as_user(v_admin);
  perform public.admin_set_work_rules(v_emp, '{"location_mode":"office","field_visit_allowed":false,"schedule_type":"fixed","shift_start":"09:00","shift_end":"18:00"}'::jsonb, v_today);
  perform pg_temp.as_user(v_prof); set local role authenticated;
  begin perform public.attendance_check_in('office', null, null, null, 'Somewhere'); insert into _r values ('E visit not allowed but accepted');
  exception when others then insert into _ok values ('E-visit-blocked'); end;
  reset role;
  update public.office_location set enabled = false;

  -- F: today not a working day for them
  perform pg_temp.as_user(v_admin);
  perform public.admin_set_work_rules(v_emp, jsonb_build_object('working_days', (select jsonb_agg(d) from generate_series(1,7) d where d <> v_dow), 'schedule_type','fixed','shift_start','09:00','shift_end','18:00'), v_today);
  perform pg_temp.as_user(v_prof); set local role authenticated;
  begin perform public.attendance_check_in('office'); insert into _r values ('F off day accepted');
  exception when others then if sqlerrm like '%weekly off%' then insert into _ok values ('F-offday'); else insert into _r values ('F msg: ' || sqlerrm); end if; end;
  reset role;

  -- G: holiday today; someone who doesn't follow holidays can still check in
  insert into public.holidays(date, name) values (v_today, 'Test holiday');
  perform pg_temp.as_user(v_admin);
  perform public.admin_set_work_rules(v_emp, '{"schedule_type":"fixed","shift_start":"09:00","shift_end":"18:00"}'::jsonb, v_today);
  perform pg_temp.as_user(v_prof); set local role authenticated;
  begin perform public.attendance_check_in('office'); insert into _r values ('G holiday accepted');
  exception when others then insert into _ok values ('G-holiday'); end;
  reset role;
  perform pg_temp.as_user(v_admin);
  perform public.admin_set_work_rules(v_emp, '{"follows_holidays":false,"schedule_type":"fixed","shift_start":"09:00","shift_end":"18:00"}'::jsonb, v_today);
  perform pg_temp.as_user(v_prof); set local role authenticated;
  v_res := public.attendance_check_in('office');
  reset role;
  if not (v_res->>'ok')::boolean then insert into _r values ('G no-holidays ' || v_res::text); else insert into _ok values ('G-noholiday'); end if;
  delete from public.attendance where employee_id = v_emp and date = v_today;
  delete from public.holidays where date = v_today;

  -- H: project-based → no attendance
  perform pg_temp.as_user(v_admin);
  perform public.admin_set_work_rules(v_emp, jsonb_build_object('employment_type','project_based','engagement_end', v_today + 30,'schedule_type','flexible','pay_type','per_project','pay_rate',40000), v_today);
  perform pg_temp.as_user(v_prof); set local role authenticated;
  begin perform public.attendance_check_in('wfh'); insert into _r values ('H project-based checked in');
  exception when others then if sqlerrm like 'Attendance isn%' then insert into _ok values ('H-noattendance'); else insert into _r values ('H msg: ' || sqlerrm); end if; end;
  v_ctx := public.my_attendance_context();
  reset role;
  if (v_ctx->'rules'->'features'->>'leave')::boolean or not (v_ctx->'rules'->'features'->>'payouts')::boolean then insert into _r values ('H features'); else insert into _ok values ('H-features'); end if;

  -- I: remote → office refused, WFH ok
  perform pg_temp.as_user(v_admin);
  perform public.admin_set_work_rules(v_emp, '{"location_mode":"remote","schedule_type":"flexible"}'::jsonb, v_today);
  perform pg_temp.as_user(v_prof); set local role authenticated;
  begin perform public.attendance_check_in('office'); insert into _r values ('I remote office accepted');
  exception when others then insert into _ok values ('I-remote-office'); end;
  v_res := public.attendance_check_in('wfh');
  reset role;
  if not (v_res->>'ok')::boolean then insert into _r values ('I remote wfh ' || v_res::text); else insert into _ok values ('I-remote-wfh'); end if;
  delete from public.attendance where employee_id = v_emp and date = v_today;

  -- J: earliest check-in in the future
  if (now() at time zone 'Asia/Kolkata')::time < '23:58' then
    perform pg_temp.as_user(v_admin);
    perform public.admin_set_work_rules(v_emp, '{"earliest_checkin":"23:59","schedule_type":"fixed","shift_start":"09:00","shift_end":"18:00"}'::jsonb, v_today);
    perform pg_temp.as_user(v_prof); set local role authenticated;
    begin perform public.attendance_check_in('office'); insert into _r values ('J early accepted');
    exception when others then if sqlerrm like 'Check-in opens at%' then insert into _ok values ('J-earliest'); else insert into _r values ('J msg: ' || sqlerrm); end if; end;
    reset role;
  end if;
exception when others then reset role; insert into _r values ('unexpected: ' || sqlerrm);
end $$;
select coalesce(string_agg(msg, ' | '), 'CHECKIN_PATTERNS_TEST failed=0') || ' · passed: ' || (select string_agg(msg, ',') from _ok) as result from _r;
rollback;
