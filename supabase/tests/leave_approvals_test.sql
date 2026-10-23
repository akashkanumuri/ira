-- SIGMA 1 — leave approval tests. Always rolls back (final statement raises
-- with JSON results). Expected: ERROR "LEAVE_TEST_RESULTS {...}" with "failed": 0.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

do $test$
declare
  u_admin uuid := gen_random_uuid();
  u_emp uuid := gen_random_uuid();
  u_mgr uuid := gen_random_uuid();
  u_solo uuid := gen_random_uuid();
  u_out uuid := gen_random_uuid();
  e_emp uuid; e_mgr uuid; e_solo uuid; e_out uuid; desig uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l6 uuid; n int; v text; ok boolean; num numeric;
  results jsonb; failed int;
  base date; mon date;
begin
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  grant select, insert on _r to authenticated;
  base := (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date + 62))::date + 7;
  mon := base + ((8 - extract(isodow from base)::int) % 7);   -- a Monday about two months out

  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'leave-test-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_emp, 'leave-test-emp@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_mgr, 'leave-test-mgr@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_solo, 'leave-test-solo@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_out, 'leave-test-out@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'employee' where id in (u_emp, u_mgr, u_solo, u_out);
  select id into desig from public.designations limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_mgr, 'ZZL02', 'zzl02', 'L Manager', desig, current_date) returning id into e_mgr;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, manager_id, join_date) values (u_emp, 'ZZL01', 'zzl01', 'L Employee', desig, e_mgr, current_date) returning id into e_emp;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_solo, 'ZZL03', 'zzl03', 'L Solo', desig, current_date) returning id into e_solo;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_out, 'ZZL04', 'zzl04', 'L Outsider', desig, current_date) returning id into e_out;
  -- 0. default chain = admin: an employee with a manager still goes straight to admins (live app unchanged)
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, reason, status)
  values (e_emp, 'casual', mon + 14, mon + 14, 'full', 'default chain', 'pending') returning id into l6;
  select manager_status into v from public.leave_requests where id = l6;
  insert into _r values ('default chain keeps admin-only approval', v = 'skipped', v);
  select count(*) into n from public.notifications where recipient_id = u_admin and title = 'New leave request';
  insert into _r values ('admin notified under default chain', n = 1, n::text);
  perform set_config('request.jwt.claims', '', true);
  update public.approval_settings set leave_chain = 'manager_then_admin' where id;

  -- 1. submit → manager first
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, reason, status)
  values (e_emp, 'casual', mon, mon, 'full', 'family', 'pending') returning id into l1;
  select manager_status into v from public.leave_requests where id = l1;
  insert into _r values ('new request waits for manager', v = 'pending', v);
  select count(*) into n from public.notifications where recipient_id = u_mgr and title = 'Leave request to review';
  insert into _r values ('manager notified', n = 1, n::text);

  begin
    insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, status, reason)
    values (e_emp, 'vacation', mon + 1, mon + 1, 'full', 'pending', 'test'); ok := false;
  exception when others then ok := sqlerrm like 'Choose a valid leave type%'; end;
  insert into _r values ('unknown leave type rejected', ok, '');

  -- employee cannot approve own request
  perform set_config('role', 'authenticated', true);
  update public.leave_requests set status = 'approved' where id = l1;
  perform set_config('role', 'postgres', true);
  select status into v from public.leave_requests where id = l1;
  insert into _r values ('employee cannot self-approve', v = 'pending', v);

  -- 2. visibility
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.leave_requests where id = l1;
  perform set_config('role', 'postgres', true);
  insert into _r values ('outsider cannot see request', n = 0, n::text);
  begin perform public.leave_manager_review(l1, 'approved'); ok := false; exception when others then ok := true; end;
  insert into _r values ('outsider cannot review', ok, '');

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.leave_requests where id = l1;
  perform set_config('role', 'postgres', true);
  insert into _r values ('manager can see report request (RLS)', n = 1, n::text);
  select count(*) into n from public.leave_team_requests() where id = l1 and employee_name = 'L Employee';
  insert into _r values ('team list includes request with name', n = 1, n::text);

  -- 3. manager decision
  begin perform public.leave_manager_review(l1, 'rejected'); ok := false; exception when others then ok := sqlerrm like 'Give a reason%'; end;
  insert into _r values ('reject needs a reason', ok, '');
  v := public.leave_manager_review(l1, 'approved', 'Fine by me');
  select status || '/' || manager_status into v from public.leave_requests where id = l1;
  insert into _r values ('manager approval forwards to admin', v = 'pending/approved', v);
  select count(*) into n from public.notifications where recipient_id = u_admin and title = 'Leave approved by manager';
  insert into _r values ('admin told it is ready', n = 1, n::text);

  -- 4. admin final
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform public.leave_admin_review(l1, 'approved');
  select status, paid_days + unpaid_days into v, num from public.leave_requests where id = l1;
  insert into _r values ('admin final approval books the day', v = 'approved' and num = 1, v || ' ' || num);
  select count(*) into n from public.notifications where recipient_id = u_emp and title = 'Leave request approved';
  insert into _r values ('employee notified of approval', n = 1, n::text);

  -- 5. limits & documents (admin configures sick leave)
  update public.leave_types set annual_limit = 2, document_required_after_days = 0 where code = 'sick';
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  begin
    insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, status, reason)
    values (e_emp, 'sick', mon + 7, mon + 9, 'full', 'pending', 'test'); ok := false;
  exception when others then ok := sqlerrm like '%allowed this year%'; end;
  insert into _r values ('annual limit enforced', ok, '');
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, status, reason)
  values (e_emp, 'sick', mon + 1, mon + 1, 'full', 'pending', 'test') returning id into l2;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  begin perform public.leave_manager_review(l2, 'approved'); ok := false; exception when others then ok := sqlerrm like '%supporting document%'; end;
  insert into _r values ('document required before approval', ok, '');
  perform set_config('role', 'postgres', true);
  insert into public.files(file_group_id, version_no, parent_type, parent_id, name, storage_path, visibility, uploaded_by)
  values (gen_random_uuid(), 1, 'leave', l2, 'note.pdf', u_emp::text || '/note.pdf', 'internal', u_emp);
  perform public.leave_manager_review(l2, 'approved');
  select manager_status into v from public.leave_requests where id = l2;
  insert into _r values ('approves once document attached', v = 'approved', v);
  ok := private.can_read_file((select id from public.files where parent_id = l2));
  insert into _r values ('manager can open the document', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  ok := not private.can_read_file((select id from public.files where parent_id = l2));
  insert into _r values ('outsider cannot open the document', ok, '');

  -- 6. withdraw
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, status, reason)
  values (e_emp, 'casual', mon + 2, mon + 2, 'half', 'pending', 'test') returning id into l3;
  perform public.leave_cancel(l3);
  select status into v from public.leave_requests where id = l3;
  insert into _r values ('employee can withdraw pending request', v = 'cancelled', v);

  -- 7. manager-only chain is final
  update public.approval_settings set leave_chain = 'manager' where id;
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, status, reason)
  values (e_emp, 'casual', mon + 3, mon + 3, 'full', 'pending', 'test') returning id into l4;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  v := public.leave_manager_review(l4, 'approved');
  select status into v from public.leave_requests where id = l4;
  insert into _r values ('manager-only chain approves directly', v = 'approved', v);

  -- 8. no manager → straight to admin; old admin screen path still works
  perform set_config('request.jwt.claims', json_build_object('sub', u_solo, 'role', 'authenticated')::text, true);
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, status, reason)
  values (e_solo, 'casual', mon, mon, 'full', 'pending', 'test') returning id into l5;
  select manager_status into v from public.leave_requests where id = l5;
  insert into _r values ('no manager skips manager step', v = 'skipped', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.leave_requests set status = 'rejected', reviewed_at = now() where id = l5 and status = 'pending';
  perform set_config('role', 'postgres', true);
  select status into v from public.leave_requests where id = l5;
  insert into _r values ('existing admin screen can still decide', v = 'rejected', v);

  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 160)))
    into failed, results from _r;
  raise exception 'LEAVE_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
end
$test$;

rollback;
