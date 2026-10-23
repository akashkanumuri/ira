-- SIGMA 1 — deliverable comments and support request tests. Always rolls back
-- (final statement raises with JSON results). Expected: "COLLAB_TEST_RESULTS" with "failed": 0.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

do $test$
declare
  u_admin uuid := gen_random_uuid(); u_pm uuid := gen_random_uuid(); u_designer uuid := gen_random_uuid(); u_out uuid := gen_random_uuid();
  u_client uuid := gen_random_uuid(); u_other_client uuid := gen_random_uuid();
  e_pm uuid; e_designer uuid; e_out uuid; desig uuid; cl uuid; cl2 uuid; pr uuid; dl uuid; dl_draft uuid;
  c1 uuid; c2 uuid; sr uuid; n int; v text; ok boolean; results jsonb; failed int;
begin
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  grant select, insert on _r to authenticated;
  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'collab-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_pm, 'collab-pm@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_designer, 'collab-designer@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_out, 'collab-out@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_client, 'collab-client@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
    (u_other_client, 'collab-client2@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'employee' where id in (u_pm, u_designer, u_out);
  update public.profiles set role = 'client' where id in (u_client, u_other_client);
  select id into desig from public.designations limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_pm, 'ZZC01', 'zzc01', 'C Manager', desig, current_date) returning id into e_pm;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_designer, 'ZZC02', 'zzc02', 'C Designer', desig, current_date) returning id into e_designer;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, join_date) values (u_out, 'ZZC03', 'zzc03', 'C Outsider', desig, current_date) returning id into e_out;
  insert into public.clients(profile_id, company_name, primary_contact, email, status) values (u_client, 'Test Co', 'Tess', 'collab-client@example.invalid', 'active') returning id into cl;
  insert into public.clients(profile_id, company_name, primary_contact, email, status) values (u_other_client, 'Other Co', 'Otto', 'collab-client2@example.invalid', 'active') returning id into cl2;
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  insert into public.projects(name, client_id, status) values ('Test project', cl, 'active') returning id into pr;
  insert into public.project_managers(project_id, manager_id) values (pr, e_pm);
  insert into public.deliverables(project_id, client_id, deliverable_number, name, status, responsible_id) values (pr, cl, 'ZZ-001', 'Logo pack', 'In Progress', e_designer) returning id into dl;
  insert into public.deliverables(project_id, client_id, deliverable_number, name, status) values (pr, cl, 'ZZ-002', 'Secret draft', 'Draft') returning id into dl_draft;

  -- client comments
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  c1 := public.deliverable_add_comment(dl, 'Can we try a darker blue?');
  select count(*) into n from public.notifications where recipient_id = u_pm and title like 'Client comment on%';
  insert into _r values ('project manager told about client comment', n = 1, n::text);
  select count(*) into n from public.notifications where recipient_id = u_designer and title like 'Client comment on%';
  insert into _r values ('responsible designer NOT told (no client contact)', n = 0, n::text);
  begin perform public.deliverable_add_comment(dl, 'secret', true); select visibility into v from public.deliverable_comments where body = 'secret'; ok := v = 'client';
  exception when others then ok := false; end;
  insert into _r values ('client cannot post internal notes', ok, coalesce(v, ''));
  begin perform public.deliverable_add_comment(dl_draft, 'peek'); ok := false; exception when others then ok := true; end;
  insert into _r values ('client cannot comment on drafts', ok, '');

  -- staff replies (the designer has no access to the client thread)
  perform set_config('request.jwt.claims', json_build_object('sub', u_designer, 'role', 'authenticated')::text, true);
  begin perform public.deliverable_add_comment(dl, 'hello client'); ok := false; exception when others then ok := true; end;
  insert into _r values ('designer cannot post to client thread', ok, '');
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.deliverable_comments where deliverable_id = dl;
  perform set_config('role', 'postgres', true);
  insert into _r values ('designer cannot read client thread', n = 0, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  c2 := public.deliverable_add_comment(dl, 'Internal: check brand guide first', true);
  perform public.deliverable_add_comment(dl, 'Sure — new version tomorrow');
  select count(*) into n from public.notifications where recipient_id = u_client and title like 'New comment on%';
  insert into _r values ('client told about staff reply (not the internal note)', n = 1, n::text);
  select count(*) into n from public.deliverable_comments where deliverable_id = dl and author_kind = 'staff' and author_name <> 'IRA team';
  insert into _r values ('staff comments signed IRA team', n = 0, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.deliverable_comments where deliverable_id = dl;
  select count(*) into failed from public.deliverable_comments where id = c2;
  perform set_config('role', 'postgres', true);
  insert into _r values ('client sees thread without internal notes', n = 3 and failed = 0, n || '/' || failed);

  perform set_config('request.jwt.claims', json_build_object('sub', u_other_client, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.deliverable_comments where deliverable_id = dl;
  perform set_config('role', 'postgres', true);
  insert into _r values ('another client sees nothing', n = 0, n::text);
  begin perform public.deliverable_add_comment(dl, 'hi'); ok := false; exception when others then ok := true; end;
  insert into _r values ('another client cannot comment', ok, '');

  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.deliverable_comments where deliverable_id = dl;
  perform set_config('role', 'postgres', true);
  insert into _r values ('unrelated employee sees nothing', n = 0, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.deliverable_comments where deliverable_id = dl;
  perform set_config('role', 'postgres', true);
  insert into _r values ('project manager sees internal notes too', n = 4, n::text);

  -- support requests
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  sr := public.support_create('Invoice question', 'Is GST included in milestone 2?', 'billing', pr);
  select request_number into v from public.support_requests where id = sr;
  insert into _r values ('request numbered', v like 'SR-%', v);
  select count(*) into n from public.notifications where recipient_id = u_admin and title like 'Support request SR-%';
  insert into _r values ('admin notified of new request', n = 1, n::text);
  select count(*) into n from public.notifications where recipient_id = u_pm and title like 'Support request SR-%';
  insert into _r values ('project manager notified of new request', n = 1, n::text);
  begin perform public.support_create('Other project', 'x', 'question', gen_random_uuid()); ok := false; exception when others then ok := true; end;
  insert into _r values ('cannot attach someone else''s project', ok, '');

  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  perform public.support_reply(sr, 'Checking with finance', true);
  perform public.support_reply(sr, 'Yes, 18% GST is included.');
  select status into v from public.support_requests where id = sr;
  insert into _r values ('staff reply moves to in progress', v = 'in_progress', v);
  begin perform public.support_set_status(sr, 'in_progress', e_designer); ok := false; exception when others then ok := true; end;
  insert into _r values ('cannot assign support to a non-manager employee', ok, '');
  perform public.support_set_status(sr, 'resolved', e_pm);
  select count(*) into n from public.support_messages where request_id = sr and author_kind = 'staff' and author_name <> 'IRA team';
  insert into _r values ('support replies signed IRA team', n = 0, n::text);
  select count(*) into n from public.notifications where recipient_id = u_client and title like '% resolved';
  insert into _r values ('client told it is resolved', n = 1, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.support_messages where request_id = sr;
  perform set_config('role', 'postgres', true);
  insert into _r values ('client sees messages without internal note', n = 2, n::text);
  begin perform public.support_set_status(sr, 'in_progress'); ok := false; exception when others then ok := true; end;
  insert into _r values ('client cannot change workflow status', ok, '');
  perform public.support_reply(sr, 'Thanks, one more thing…');
  select status into v from public.support_requests where id = sr;
  insert into _r values ('client reply reopens resolved request', v = 'open', v);

  perform set_config('request.jwt.claims', json_build_object('sub', u_other_client, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.support_requests where id = sr;
  perform set_config('role', 'postgres', true);
  insert into _r values ('another client cannot see the request', n = 0, n::text);
  begin perform public.support_reply(sr, 'hijack'); ok := false; exception when others then ok := true; end;
  insert into _r values ('another client cannot reply', ok, '');

  perform set_config('request.jwt.claims', json_build_object('sub', u_designer, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.support_requests where id = sr;
  perform set_config('role', 'postgres', true);
  insert into _r values ('designer cannot see the request', n = 0, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.support_requests where id = sr;
  perform set_config('role', 'postgres', true);
  insert into _r values ('unrelated employee cannot see the request', n = 0, n::text);

  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 160)))
    into failed, results from _r;
  raise exception 'COLLAB_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
end
$test$;

rollback;
