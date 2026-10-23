-- SIGMA 1 — client-visible rows carry no staff names. Always rolls back.
begin;
set local statement_timeout = '60s';

do $test$
declare
  u_admin uuid := gen_random_uuid(); u_emp uuid := gen_random_uuid(); u_client uuid := gen_random_uuid();
  e_emp uuid; desig uuid; cl uuid; pr uuid; dl uuid; n int; v text; results jsonb; failed int;
begin
  create temp table if not exists _r(name text, passed boolean, detail text);
  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'pv-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_emp, 'pv-emp@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_client, 'pv-client@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'employee' where id = u_emp;
  update public.profiles set role = 'client' where id = u_client;
  select id into desig from public.designations limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id) values (u_emp, 'ZZV01', 'zzv01', 'Satish Secret', desig) returning id into e_emp;
  insert into public.clients(profile_id, company_name, primary_contact, email, status) values (u_client, 'Privacy Co', 'Pia', 'pv-client@example.invalid', 'active') returning id into cl;
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  insert into public.projects(name, client_id, status) values ('Privacy project', cl, 'active') returning id into pr;
  insert into public.deliverables(project_id, client_id, name, status, responsible_id) values (pr, cl, 'Reel', 'In Progress', e_emp) returning id into dl;

  select coalesce(responsible_name, 'null') || '/' || (responsible_id = e_emp)::text into v from public.deliverables where id = dl;
  insert into _r values ('responsible kept as id only', v = 'null/true', v);

  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.deliverables d where d.id = dl and d.responsible_name is null;
  select count(*) into failed from public.employees where id = e_emp;
  perform set_config('role', 'postgres', true);
  insert into _r values ('client reads deliverable without a staff name', n = 1, n::text);
  insert into _r values ('client cannot resolve the id to a person', failed = 0, failed::text);

  insert into public.change_requests(project_id, deliverable_id, request_number, field, requested_value, reason, status, reviewer_name)
  values (pr, dl, 'CR-T01', 'Revision', 'Bigger logo', 'test', 'Approved', 'Some Manager');
  select reviewer_name into v from public.change_requests where request_number = 'CR-T01' and project_id = pr;
  insert into _r values ('reviewer shown as IRA team', v = 'IRA team', v);

  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 160)))
    into failed, results from _r;
  raise exception 'PRIVACY_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
end
$test$;

rollback;
