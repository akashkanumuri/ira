-- SIGMA 1 — database integration tests (RLS, tenant isolation, workflows)
--
-- Runs entirely inside one transaction and ALWAYS rolls back: the final
-- statement raises an exception carrying the JSON results, so no test data
-- is ever persisted. Run after the 202610221*_sigma_* migrations exist (or
-- prefix them inside the same BEGIN to dry-run unapplied migrations).
--
-- Expected output: ERROR "SIGMA_TEST_RESULTS {...}" with "failed": 0.

begin;

do $test$
declare
  results jsonb := '[]'::jsonb;
  failed int := 0;
  -- identities
  u_admin uuid := gen_random_uuid();
  u_c1 uuid := gen_random_uuid();    -- client A, client_admin
  u_c1b uuid := gen_random_uuid();   -- client A, client_user (restricted)
  u_c2 uuid := gen_random_uuid();    -- client B, client_admin
  u_emp uuid := gen_random_uuid();   -- employee responsible for deliverable
  u_mgr uuid := gen_random_uuid();   -- project manager of project A
  e_emp uuid; e_mgr uuid; desig uuid;
  cl_a uuid; cl_b uuid; pr_a uuid; pr_b uuid;
  d_a uuid; d_b uuid; k_a uuid; cr uuid; inst uuid; pay uuid; f_final uuid; dep uuid;
  n int; v text; ok boolean; j jsonb;

  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  -- ---------------------------------------------------------------- helpers
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  grant select, insert on _r to authenticated;

  -- ---------------------------------------------------------------- fixtures (as owner)
  insert into auth.users(id, email, raw_app_meta_data, aud, role)
  values (u_admin, 'sigma-test-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
         (u_c1, 'sigma-test-c1@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
         (u_c1b, 'sigma-test-c1b@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
         (u_c2, 'sigma-test-c2@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
         (u_emp, 'sigma-test-emp@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
         (u_mgr, 'sigma-test-mgr@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'client' where id in (u_c1, u_c1b, u_c2);
  update public.profiles set role = 'employee' where id in (u_emp, u_mgr);

  select id into desig from public.designations order by can_assign_tasks desc limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id)
  values (u_emp, 'ZZTEST01', 'zztest01', 'Test Designer', desig) returning id into e_emp;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id)
  values (u_mgr, 'ZZTEST02', 'zztest02', 'Test Manager', desig) returning id into e_mgr;

  insert into public.clients(profile_id, company_name, primary_contact, email, status)
  values (u_c1, 'Test Client A', 'Alice', 'sigma-test-c1@example.invalid', 'active') returning id into cl_a;
  insert into public.clients(profile_id, company_name, primary_contact, email, status)
  values (u_c2, 'Test Client B', 'Bob', 'sigma-test-c2@example.invalid', 'active') returning id into cl_b;
  insert into public.client_users(client_id, profile_id, role, status, full_name)
  values (cl_a, u_c1b, 'client_user', 'active', 'Alan');

  insert into public.projects(name, status, client_id) values ('Test Project A', 'active', cl_a) returning id into pr_a;
  insert into public.projects(name, status, client_id) values ('Test Project B', 'active', cl_b) returning id into pr_b;
  insert into public.project_managers(project_id, manager_id) values (pr_a, e_mgr);
  insert into public.deliverables(project_id, name, quantity, due_date, responsible_id, status)
  values (pr_a, 'Social posts', 10, v_today + 30, e_emp, 'Draft') returning id into d_a;
  insert into public.deliverables(project_id, name, quantity, status)
  values (pr_b, 'Brand book', 1, 'Pending') returning id into d_b;

  -- ---------------------------------------------------------------- 1. tenant isolation
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.projects where id in (pr_a, pr_b);
  insert into _r values ('client A sees only own project', n = 1, n::text);
  select count(*) into n from public.deliverables where id = d_b;
  insert into _r values ('client A cannot read client B deliverable by id', n = 0, n::text);
  select count(*) into n from public.deliverables where id = d_a;
  insert into _r values ('client A cannot see Draft deliverable', n = 0, n::text);
  select count(*) into n from public.clients where id = cl_b;
  insert into _r values ('client A cannot read client B organisation', n = 0, n::text);
  begin
    insert into public.contract_acceptances(contract_id, project_id, version, url, who, event)
    values (gen_random_uuid(), pr_a, 'v1', 'x', 'forged', 'Accepted');
    insert into _r values ('client cannot forge acceptance', false, 'insert succeeded');
  exception when others then
    insert into _r values ('client cannot forge acceptance', true, sqlerrm);
  end;
  begin
    perform public.staff_create_contract(pr_a, 'Hack', null, 'https://x.example');
    insert into _r values ('client cannot create contract', false, 'created');
  exception when others then insert into _r values ('client cannot create contract', true, sqlerrm);
  end;
  select count(*) into n from public.audit_logs;
  insert into _r values ('client cannot read audit log', n = 0, n::text);

  -- ---------------------------------------------------------------- 2. contract lifecycle
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  k_a := public.staff_create_contract(pr_a, 'Master Services Agreement', 'MSA-T1', 'https://docs.example/msa-v1.pdf',
                                      null, 600000, '+ GST', v_today, v_today + 365);
  select status into v from public.contracts where id = k_a;
  insert into _r values ('admin creates draft contract', v = 'Draft', v);

  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.contracts where id = k_a;
  insert into _r values ('client cannot see draft contract', n = 0, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform public.staff_revise_contract(k_a, 'Updated payment terms', null, 'https://docs.example/msa-v2.pdf');
  perform public.staff_send_contract(k_a);
  select status || '/v' || current_version_no into v from public.contracts where id = k_a;
  insert into _r values ('revised contract sent as v2', v = 'Sent/v2', v);
  select count(*) into n from public.contract_versions where contract_id = k_a;
  insert into _r values ('both contract versions retained', n = 2, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', u_c2, 'role', 'authenticated')::text, true);
  begin
    perform public.client_accept_contract(k_a, 2, true);
    insert into _r values ('other client cannot accept contract', false, 'accepted');
  exception when others then insert into _r values ('other client cannot accept contract', true, sqlerrm);
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_c1b, 'role', 'authenticated')::text, true);
  begin
    perform public.client_accept_contract(k_a, 2, true);
    insert into _r values ('restricted client user cannot accept', false, 'accepted');
  exception when others then insert into _r values ('restricted client user cannot accept', true, sqlerrm);
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  perform public.client_mark_contract_viewed(k_a);
  begin
    perform public.client_accept_contract(k_a, 1, true);
    insert into _r values ('stale version acceptance rejected', false, 'accepted');
  exception when others then insert into _r values ('stale version acceptance rejected', true, sqlerrm);
  end;
  begin
    perform public.client_accept_contract(k_a, 2, false);
    insert into _r values ('acknowledgement required', false, 'accepted');
  exception when others then insert into _r values ('acknowledgement required', true, sqlerrm);
  end;
  j := public.client_accept_contract(k_a, 2, true, 'test-agent');
  select status into v from public.contracts where id = k_a;
  insert into _r values ('client accepts current version', v = 'Accepted', v || ' ' || j::text);
  select count(*) into n from public.contract_acceptances
  where contract_id = k_a and event = 'Accepted' and user_id = u_c1 and version_no = 2 and acknowledgement is not null;
  insert into _r values ('acceptance evidence captured', n = 1, n::text);
  select status into v from public.deliverables where id = d_a;
  insert into _r values ('acceptance activates draft deliverables', v = 'Pending', v);
  begin
    perform public.client_accept_contract(k_a, 2, true);
    insert into _r values ('double acceptance blocked', false, 'accepted twice');
  exception when others then insert into _r values ('double acceptance blocked', true, sqlerrm);
  end;

  perform set_config('role', 'postgres', true);
  begin
    update public.contract_acceptances set who = 'tampered' where contract_id = k_a;
    insert into _r values ('acceptance records immutable (even owner)', false, 'updated');
  exception when others then insert into _r values ('acceptance records immutable (even owner)', true, sqlerrm);
  end;
  perform set_config('role', 'authenticated', true);

  -- ---------------------------------------------------------------- 3. modification requests
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  cr := public.client_request_modification(d_a, 'quantity', 'Campaign extended', 15, null, null, 'idem-1');
  select requested_quantity::text || '/' || quantity_delta::text into v from public.change_requests where id = cr;
  insert into _r values ('quantity request records original/requested/delta', v = '15.00/5.00', v);
  insert into _r values ('idempotent modification submit', public.client_request_modification(d_a, 'quantity', 'Campaign extended', 15, null, null, 'idem-1') = cr, '');
  begin
    perform public.client_request_modification(d_a, 'quantity', 'Again please', 20);
    insert into _r values ('one open request per type', false, 'second created');
  exception when others then insert into _r values ('one open request per type', true, sqlerrm);
  end;
  select count(*) into n from public.change_requests where id = cr;
  perform set_config('request.jwt.claims', json_build_object('sub', u_c2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.change_requests where id = cr;
  insert into _r values ('other client cannot see modification', n = 0, n::text);
  begin
    perform public.client_request_modification(d_a, 'quantity', 'Not my deliverable', 99);
    insert into _r values ('other client cannot request modification', false, 'created');
  exception when others then insert into _r values ('other client cannot request modification', true, sqlerrm);
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  begin
    perform public.staff_review_modification(cr, 'approve', 'ok');
    insert into _r values ('employee cannot approve modification', false, 'approved');
  exception when others then insert into _r values ('employee cannot approve modification', true, sqlerrm);
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  perform public.staff_review_modification(cr, 'approve', 'Approved with billing impact', null, null, null, '+5 posts billed next cycle');
  select quantity::text || '/v' || version_no into v from public.deliverables where id = d_a;
  insert into _r values ('approved modification updates scope with new version', v = '15.00/v2', v);
  select string_agg((snapshot ->> 'quantity'), ',' order by version_no) into v from public.deliverable_versions where deliverable_id = d_a;
  insert into _r values ('original scope preserved in history', v = '10.00,15.00', v);

  -- ---------------------------------------------------------------- 4. status workflow
  begin
    perform public.staff_set_deliverable_status(d_a, 'Completed');
    insert into _r values ('invalid transition rejected', false, 'Pending→Completed allowed');
  exception when others then insert into _r values ('invalid transition rejected', true, sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.staff_set_deliverable_status(d_a, 'In Progress');
  begin
    perform public.staff_set_deliverable_status(d_a, 'Awaiting Client Review');
    insert into _r values ('employee limited to own transitions', false, 'allowed');
  exception when others then insert into _r values ('employee limited to own transitions', true, sqlerrm);
  end;
  select count(*) into n from public.deliverables where id = d_b;
  insert into _r values ('employee cannot see unassigned client deliverable', n = 0, n::text);

  -- dependency loop
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  dep := public.staff_request_dependency(d_a, 'Logo files', 'Vector logo please', v_today + 3);
  select status into v from public.deliverables where id = d_a;
  insert into _r values ('dependency request blocks deliverable', v = 'Awaiting Client Dependency', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1b, 'role', 'authenticated')::text, true);
  perform public.client_submit_dependency(dep, 'Shared via the brand drive link https://drive.example/logo');
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.staff_review_dependency(dep, 'accept', null);
  select status into v from public.deliverables where id = d_a;
  insert into _r values ('accepted dependency unblocks deliverable', v = 'In Progress', v);
  select count(*) into n from public.notifications where recipient_id = u_emp and type = 'dependency';
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  select count(*) into n from public.notifications where type = 'dependency';
  insert into _r values ('employee notified of uploaded dependency', n >= 1, n::text);

  -- ---------------------------------------------------------------- 5. billing, verification and locks
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  insert into public.payment_installments(project_id, contract_id, name, basis_type, percentage, due_date, status)
  values (pr_a, k_a, 'Advance', 'percentage', 30, v_today - 2, 'Upcoming') returning id into inst;
  select amount::text || '/' || status into v from public.payment_installments where id = inst;
  insert into _r values ('percentage milestone computed and overdue', v = '180000.00/Overdue', v);

  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  begin
    update public.payment_installments set status = 'Paid', amount_paid = 180000 where id = inst;
    get diagnostics n = row_count;
    insert into _r values ('client cannot mark milestone paid', n = 0, n::text || ' rows');
  exception when others then insert into _r values ('client cannot mark milestone paid', true, sqlerrm);
  end;
  pay := public.client_submit_payment(inst, 100000, 'UTR123456', v_today - 1, 'bank_transfer', null, 'pay-idem-1');
  select status || '/' || amount_paid::text into v from public.payment_installments where id = inst;
  insert into _r values ('submitted reference is not counted as paid', v = 'Overdue/0.00', v);
  begin
    perform public.finance_verify_payment(pay, true);
    insert into _r values ('client cannot verify own payment', false, 'verified');
  exception when others then insert into _r values ('client cannot verify own payment', true, sqlerrm);
  end;
  begin
    perform public.client_submit_payment(inst, 90000, 'UTR999', v_today);
    insert into _r values ('cannot over-submit beyond outstanding', false, 'accepted');
  exception when others then insert into _r values ('cannot over-submit beyond outstanding', true, sqlerrm);
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  update public.billing_settings set auto_lock_enabled = true, grace_days = 0 where id;
  perform set_config('role', 'postgres', true);
  perform private.evaluate_project_locks(pr_a);
  perform set_config('role', 'authenticated', true);
  select lock_state into v from public.deliverables where id = d_a;
  insert into _r values ('overdue payment locks deliverables', v = 'locked_payment', v);
  select count(*) into n from public.deliverable_lock_events where deliverable_id = d_a and new_state = 'locked_payment';
  insert into _r values ('lock event recorded', n = 1, n::text);
  begin
    update public.deliverables set lock_state = 'unlocked' where id = d_a;
    get diagnostics n = row_count;
    insert into _r values ('lock cannot be bypassed by direct update', n = 0, n::text || ' rows');
  exception when others then insert into _r values ('lock cannot be bypassed by direct update', true, sqlerrm);
  end;
  perform set_config('role', 'postgres', true);
  begin
    update public.deliverables set lock_state = 'unlocked' where id = d_a;
    insert into _r values ('lock guard holds even for table owner', false, 'updated');
  exception when others then insert into _r values ('lock guard holds even for table owner', true, sqlerrm);
  end;
  perform set_config('role', 'authenticated', true);
  begin
    update public.deliverables set quantity = 999 where id = d_a;
    get diagnostics n = row_count;
    insert into _r values ('scope cannot be edited without the reasoned RPC', n = 0, n::text || ' rows');
  exception when others then insert into _r values ('scope cannot be edited without the reasoned RPC', true, sqlerrm);
  end;

  perform public.finance_verify_payment(pay, true, 'Matched bank statement');
  select status || '/' || amount_paid::text into v from public.payment_installments where id = inst;
  insert into _r values ('verified partial payment updates balance', v = 'Overdue/100000.00', v);
  perform public.finance_record_payment(inst, 80000, 'UTR777888', v_today, 'bank_transfer', 'Balance received');
  select status into v from public.payment_installments where id = inst;
  insert into _r values ('fully paid milestone', v = 'Paid', v);
  select lock_state into v from public.deliverables where id = d_a;
  insert into _r values ('payment clears lock automatically', v = 'unlocked', v);

  -- ---------------------------------------------------------------- 6. files & download gating
  perform set_config('role', 'postgres', true);
  insert into storage.objects(bucket_id, name, owner_id) values ('sigma-files', u_mgr::text || '/final.pdf', u_mgr::text);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  f_final := public.attach_file(u_mgr::text || '/final.pdf', 'deliverable', d_a, 'final.pdf', 'application/pdf', 1024, 'client', true);
  perform public.staff_set_deliverable_status(d_a, 'Under Internal Review');
  perform public.staff_set_deliverable_status(d_a, 'Awaiting Client Review');

  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  insert into _r values ('final file hidden before ready', not private.can_read_file(f_final), '');
  perform public.client_review_deliverable(d_a, true, 'Looks great');
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  perform public.staff_set_deliverable_status(d_a, 'Ready for Download');
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  insert into _r values ('client can download ready final file', private.can_read_file(f_final), '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_c2, 'role', 'authenticated')::text, true);
  insert into _r values ('other client cannot read file', not private.can_read_file(f_final), '');
  select count(*) into n from storage.objects where name = u_mgr::text || '/final.pdf';
  insert into _r values ('other client cannot read storage object', n = 0, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform public.staff_set_deliverable_lock(d_a, 'lock', 'Manual hold for dispute');
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  insert into _r values ('manual lock blocks download but deliverable stays visible',
    not private.can_read_file(f_final) and exists (select 1 from public.deliverables where id = d_a), '');

  -- ---------------------------------------------------------------- 7. audit & notifications
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  select count(*) into n from public.audit_logs where entity_type = 'deliverables' and entity_id = d_a::text;
  insert into _r values ('deliverable changes audited', n >= 5, n::text);
  select count(*) into n from public.audit_logs where entity_type = 'payments' and client_id = cl_a;
  insert into _r values ('payment events audited with client ownership', n >= 2, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.notifications where type = 'contract' and title = 'New contract to review';
  insert into _r values ('client notified once for sent contract', n = 1, n::text);

  -- ---------------------------------------------------------------- report
  perform set_config('role', 'postgres', true);
  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 160)))
    into failed, results from _r;
  raise exception 'SIGMA_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
end
$test$;

rollback;
