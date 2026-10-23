-- SIGMA 1 — performance (KRA / reviews / milestones) tests. Always rolls back (final statement
-- raises with the JSON results). Expected: ERROR "PERF_TEST_RESULTS {...}" with "failed": 0.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

do $test$
declare
  u_admin uuid := gen_random_uuid(); u_emp uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_out uuid := gen_random_uuid();
  e_emp uuid; e_mgr uuid; e_out uuid; desig uuid;
  cyc uuid; k1 uuid; k2 uuid; rv uuid; n int; v text; ok boolean; num numeric; m uuid;
  results jsonb; failed int;
begin
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  grant select, insert on _r to authenticated;
  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'perf-test-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_emp, 'perf-test-emp@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_mgr, 'perf-test-mgr@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_out, 'perf-test-out@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'employee' where id in (u_emp, u_mgr, u_out);
  select id into desig from public.designations limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_mgr, 'ZZP02', 'zzp02', 'P Manager', desig, current_date - 800) returning id into e_mgr;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, manager_id, join_date) values (u_emp, 'ZZP01', 'zzp01', 'P Employee', desig, e_mgr, current_date - 800) returning id into e_emp;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_out, 'ZZP03', 'zzp03', 'P Outsider', desig, current_date - 800) returning id into e_out;

  -- admin sets up a draft cycle through RLS
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.performance_cycles(name, period_type, start_date, end_date) values ('Q3 test', 'quarterly', current_date - 90, current_date) returning id into cyc;
  insert into public.kras(cycle_id, employee_id, title, target, weightage) values (cyc, e_emp, 'Deliver brand kits', '12 kits', 60) returning id into k1;
  insert into public.kras(cycle_id, employee_id, title, target, weightage) values (cyc, e_emp, 'Client satisfaction', '4.5 / 5', 30) returning id into k2;
  perform set_config('role', 'postgres', true);

  -- employee can't see draft KRAs
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.kras where cycle_id = cyc;
  perform set_config('role', 'postgres', true);
  insert into _r values ('draft KRAs hidden from employee', n = 0, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  begin perform public.performance_open_cycle(cyc); ok := false; exception when others then ok := sqlerrm like 'Weightage must add up to 100%'; end;
  insert into _r values ('weightage must total 100', ok, '');
  update public.kras set weightage = 40 where id = k2;
  n := public.performance_open_cycle(cyc);
  insert into _r values ('cycle opens and creates reviews', n = 1, n::text);
  select id into rv from public.performance_reviews where cycle_id = cyc and employee_id = e_emp;
  select count(*) into n from public.notifications where recipient_id = u_emp and title = 'Performance review open';
  insert into _r values ('employee told the review is open', n = 1, n::text);
  begin
    insert into public.kras(cycle_id, employee_id, title, weightage) values (cyc, e_emp, 'Late add', 10); ok := false;
  exception when others then ok := sqlerrm like 'KRAs can only be added%'; end;
  insert into _r values ('no KRAs added after opening', ok, '');

  -- employee self-assessment
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.kras where cycle_id = cyc;
  update public.kras set self_score = 100, manager_score = 100 where id = k1;
  perform set_config('role', 'postgres', true);
  insert into _r values ('employee sees own KRAs once open', n = 2, n::text);
  select coalesce(self_score, -1) into num from public.kras where id = k1;
  insert into _r values ('employee cannot write scores directly', num = -1, num::text);
  begin perform public.performance_submit_self(rv); ok := false; exception when others then ok := sqlerrm like 'Score every KRA%'; end;
  insert into _r values ('cannot submit before scoring all', ok, '');
  perform public.performance_self_assess(k1, '11 kits', 85, 'One kit slipped');
  perform public.performance_self_assess(k2, '4.6', 95);
  begin perform public.performance_manager_assess(k1, 100); ok := false; exception when others then ok := true; end;
  insert into _r values ('employee cannot manager-score self', ok, '');
  perform public.performance_submit_self(rv, 'Good quarter');
  select count(*) into n from public.notifications where recipient_id = u_mgr and title = 'Self-review submitted';
  insert into _r values ('manager notified of self-review', n = 1, n::text);
  begin perform public.performance_self_assess(k1, 'x', 50); ok := false; exception when others then ok := sqlerrm like '%already submitted%'; end;
  insert into _r values ('self-assessment locked after submit', ok, '');

  -- outsider
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  begin perform public.performance_manager_assess(k1, 10); ok := false; exception when others then ok := true; end;
  insert into _r values ('outsider cannot score', ok, '');
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.performance_reviews where id = rv;
  perform set_config('role', 'postgres', true);
  insert into _r values ('outsider cannot read review', n = 0, n::text);

  -- manager
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.kras where cycle_id = cyc;
  perform set_config('role', 'postgres', true);
  insert into _r values ('manager sees report KRAs', n = 2, n::text);
  perform public.performance_manager_assess(k1, 90, 'Strong');
  begin perform public.performance_submit_manager(rv, 'Solid'); ok := false; exception when others then ok := sqlerrm like 'Score every KRA%'; end;
  insert into _r values ('manager must score all', ok, '');
  perform public.performance_manager_assess(k2, 80);
  perform public.performance_submit_manager(rv, 'Solid quarter', 'Craft', 'Speed');
  select overall_score into num from public.performance_reviews where id = rv;
  insert into _r values ('manager weighted score = 86', num = 86, num::text);
  begin perform public.performance_finalize(rv); ok := false; exception when others then ok := true; end;
  insert into _r values ('manager cannot finalize', ok, '');
  begin perform public.employee_add_milestone(e_emp, 'promotion', 'Senior designer', current_date); ok := false; exception when others then ok := true; end;
  insert into _r values ('manager cannot record promotion', ok, '');
  m := public.employee_add_milestone(e_emp, 'recognition', 'Client shout-out', current_date, 'Praised by Acme');
  insert into _r values ('manager records recognition', m is not null, '');

  -- admin finalizes with an override
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  num := public.performance_finalize(rv, jsonb_build_object(k2::text, 85));
  select rating into v from public.performance_reviews where id = rv;
  insert into _r values ('final weighted score = 88 with override', num = 88, num::text);
  insert into _r values ('rating assigned', v = 'Exceeds expectations', v);
  select count(*) into n from public.notifications where recipient_id = u_emp and title = 'Performance review finalized';
  insert into _r values ('employee told of final score', n = 1, n::text);
  begin update public.kras set title = 'changed' where id = k1; ok := false; exception when others then ok := sqlerrm like '%closed%'; end;
  insert into _r values ('finalized KRAs locked', ok, '');
  perform public.performance_close_cycle(cyc);
  select status into v from public.performance_cycles where id = cyc;
  insert into _r values ('cycle closed', v = 'closed', v);

  -- milestones & visibility
  perform public.employee_add_milestone(e_emp, 'warning', 'Late delivery', current_date, null, null, null, false);
  perform public.employee_add_milestone(e_emp, 'promotion', 'Senior designer', current_date - 400, null, 'Designer', 'Senior designer');
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.employee_milestones where employee_id = e_emp;
  select count(*) into failed from public.employee_milestones where employee_id = e_emp and kind = 'warning';
  perform set_config('role', 'postgres', true);
  insert into _r values ('employee sees visible milestones only', n = 2 and failed = 0, n || '/' || failed);

  -- promotion candidates
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  update public.performance_settings set promotion_min_reviews = 1, promotion_min_score = 80, promotion_min_months = 6 where id;
  select count(*) into n from public.performance_promotion_candidates() where employee_id = e_emp;
  insert into _r values ('eligible employee listed for promotion', n = 1, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  select count(*) into n from public.performance_promotion_candidates();
  insert into _r values ('employees cannot list candidates', n = 0, n::text);

  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 160)))
    into failed, results from _r;
  raise exception 'PERF_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
end
$test$;

rollback;
