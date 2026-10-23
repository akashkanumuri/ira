-- SIGMA 1 — client team management tests (client_user_update). Always rolls back.
-- Expected: ERROR "TEAM_TEST_RESULTS {...}" with "failed": 0. Dry-run 2026-10-23: 7/7 pass.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $test$
declare
  u_admin uuid := gen_random_uuid(); u_primary uuid := gen_random_uuid(); u_col uuid := gen_random_uuid(); u_viewer uuid := gen_random_uuid(); u_other uuid := gen_random_uuid();
  cl uuid; cl2 uuid; cu_col uuid; cu_viewer uuid; cu_primary uuid; ok boolean; v text; results jsonb; failed int;
begin
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'team-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_primary, 'team-primary@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
    (u_col, 'team-col@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
    (u_viewer, 'team-viewer@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
    (u_other, 'team-other@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'client' where id in (u_primary, u_col, u_viewer, u_other);
  insert into public.clients(profile_id, company_name, primary_contact, email, status) values (u_primary, 'Team Co', 'Pri', 'team-primary@example.invalid', 'active') returning id into cl;
  insert into public.clients(profile_id, company_name, primary_contact, email, status) values (u_other, 'Other Co', 'Oth', 'team-other@example.invalid', 'active') returning id into cl2;
  select id into cu_primary from public.client_users where profile_id = u_primary;
  insert into public.client_users(client_id, profile_id, role, status, full_name, email) values (cl, u_col, 'client_admin', 'active', 'Col', 'team-col@example.invalid') returning id into cu_col;
  insert into public.client_users(client_id, profile_id, role, status, full_name, email) values (cl, u_viewer, 'client_user', 'active', 'Viewer', 'team-viewer@example.invalid') returning id into cu_viewer;

  perform set_config('request.jwt.claims', json_build_object('sub', u_viewer, 'role', 'authenticated')::text, true);
  begin perform public.client_user_update(cu_col, 'inactive'); ok := false; exception when others then ok := true; end;
  insert into _r values ('client user cannot change access', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  begin perform public.client_user_update(cu_viewer, 'inactive'); ok := false; exception when others then ok := true; end;
  insert into _r values ('other organisation cannot change access', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_col, 'role', 'authenticated')::text, true);
  begin perform public.client_user_update(cu_primary, 'inactive'); ok := false; exception when others then ok := sqlerrm like '%managed by IRA%'; end;
  insert into _r values ('primary contact protected', ok, '');
  begin perform public.client_user_update(cu_col, null, 'client_user'); ok := false; exception when others then ok := sqlerrm like '%own access%'; end;
  insert into _r values ('cannot change own access', ok, '');
  perform public.client_user_update(cu_viewer, 'inactive');
  select status into v from public.client_users where id = cu_viewer;
  insert into _r values ('client admin deactivates colleague', v = 'inactive', v);
  perform public.client_user_update(cu_viewer, 'active', 'client_admin');
  select status || '/' || role into v from public.client_users where id = cu_viewer;
  insert into _r values ('client admin reactivates and promotes', v = 'active/client_admin', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_viewer, 'role', 'authenticated')::text, true);
  perform public.client_user_update(cu_col, 'inactive');
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  update public.client_users set role = 'client_user' where id = cu_primary;
  begin perform public.client_user_update(cu_viewer, 'inactive'); ok := false; exception when others then ok := sqlerrm like '%at least one active administrator%'; end;
  insert into _r values ('last active client admin kept', ok, '');

  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 160)))
    into failed, results from _r;
  raise exception 'TEAM_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
end
$test$;

rollback;
