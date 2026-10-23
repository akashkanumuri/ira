-- SIGMA 1 — drafts, timer, client review loop and metrics. Always rolls back
-- (final statement raises with JSON results). Expected: "REVIEW_TEST_RESULTS" with "failed": 0.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

do $test$
declare
  u_admin uuid := gen_random_uuid(); u_pm uuid := gen_random_uuid(); u_emp uuid := gen_random_uuid(); u_out uuid := gen_random_uuid();
  u_client uuid := gen_random_uuid(); u_other uuid := gen_random_uuid();
  e_pm uuid; e_emp uuid; e_out uuid; desig uuid; cl uuid; cl2 uuid; pr uuid; dl uuid; t1 uuid; rv1 uuid; rv2 uuid;
  n int; v text; ok boolean; j jsonb; results jsonb; failed int; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  grant select, insert on _r to authenticated;
  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'rv-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_pm, 'rv-pm@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_emp, 'rv-emp@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_out, 'rv-out@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_client, 'rv-client@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated'),
    (u_other, 'rv-client2@example.invalid', '{"role":"client"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'employee' where id in (u_pm, u_emp, u_out);
  update public.profiles set role = 'client' where id in (u_client, u_other);
  select id into desig from public.designations order by can_assign_tasks desc limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id) values (u_pm, 'ZZR01', 'zzr01', 'R Manager', desig) returning id into e_pm;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, manager_id) values (u_emp, 'ZZR02', 'zzr02', 'R Designer', desig, e_pm) returning id into e_emp;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id) values (u_out, 'ZZR03', 'zzr03', 'R Outsider', desig) returning id into e_out;
  insert into public.clients(profile_id, company_name, primary_contact, email, status) values (u_client, 'Review Co', 'Rae', 'rv-client@example.invalid', 'active') returning id into cl;
  insert into public.clients(profile_id, company_name, primary_contact, email, status) values (u_other, 'Other Co', 'Otto', 'rv-client2@example.invalid', 'active') returning id into cl2;

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  insert into public.projects(name, client_id, status) values ('Review project', cl, 'active') returning id into pr;
  insert into public.project_managers(project_id, manager_id) values (pr, e_pm);
  insert into public.deliverables(project_id, client_id, deliverable_number, name, status, responsible_id) values (pr, cl, 'ZZR-001', 'Social posts', 'In Progress', e_emp) returning id into dl;
  insert into public.tasks(title, assigned_to, assigned_by, start_date, due_date, priority, project_id, deliverable_id, estimate_minutes)
  values ('Design 5 posts', e_emp, e_pm, v_today, v_today + 3, 'high', pr, dl, 240) returning id into t1;

  -- employee: timer + draft 1
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.task_timer_start(t1);
  select status into v from public.tasks where id = t1;
  insert into _r values ('timer start moves task in progress', v = 'in_progress', v);
  select count(*) into n from public.task_timers where task_id = t1;
  insert into _r values ('timer running', n = 1, n::text);
  begin perform public.task_transition(t1, 'awaiting_review', 'v1'); ok := false; exception when others then ok := sqlerrm like '%link%'; end;
  insert into _r values ('draft needs a link', ok, '');
  perform public.task_transition(t1, 'awaiting_review', 'First pass', 'https://drive.example.com/v1');
  select count(*) into n from public.task_timers where task_id = t1;
  select count(*) into failed from public.task_time_logs where task_id = t1 and note = 'Timer';
  insert into _r values ('hand-in stops timer and logs time', n = 0 and failed = 1, n || '/' || failed);
  select draft_no || ':' || decision || ':' || on_time into v from public.task_drafts where task_id = t1;
  insert into _r values ('draft 1 recorded', v = '1:pending:true', v);

  -- outsider cannot see drafts
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.task_drafts where task_id = t1;
  perform set_config('role', 'postgres', true);
  insert into _r values ('outsider cannot see drafts', n = 0, n::text);

  -- manager requests changes, then approves draft 2
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'revision_required', 'Use brand colours');
  select decision || ':' || feedback into v from public.task_drafts where task_id = t1 and draft_no = 1;
  insert into _r values ('draft 1 changes requested with feedback', v = 'changes_requested:Use brand colours', v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'in_progress');
  perform public.task_transition(t1, 'awaiting_review', null, 'https://drive.example.com/v2');
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'completed', 'Looks great');
  select string_agg(draft_no || ':' || decision, ',' order by draft_no) into v from public.task_drafts where task_id = t1;
  insert into _r values ('draft history', v = '1:changes_requested,2:approved', v);

  -- employee cannot send to client
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  begin perform public.staff_send_to_client(dl, null, null, t1); ok := false; exception when others then ok := true; end;
  insert into _r values ('employee cannot send to client', ok, '');

  -- manager sends version 1 (uses the approved draft link)
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  rv1 := public.staff_send_to_client(dl, null, 'Five posts for review', t1);
  select status into v from public.deliverables where id = dl;
  insert into _r values ('deliverable awaiting client review', v = 'Awaiting Client Review', v);
  select link into v from public.deliverable_client_reviews where id = rv1;
  insert into _r values ('round uses approved draft link', v = 'https://drive.example.com/v2', v);
  select count(*) into n from public.notifications where recipient_id = u_client and title = 'New version to review';
  insert into _r values ('client notified', n = 1, n::text);
  begin perform public.staff_send_to_client(dl, 'https://x.example.com', null, null); ok := false; exception when others then ok := true; end;
  insert into _r values ('cannot send while a round is pending', ok, '');

  -- client view: no staff names, no drafts
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  select count(*) into n from public.client_deliverable_reviews(dl);
  insert into _r values ('client sees version list', n = 1, n::text);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.task_drafts where task_id = t1;
  select count(*) into failed from public.deliverable_client_reviews;
  perform set_config('role', 'postgres', true);
  insert into _r values ('client cannot read drafts or raw review rows', n = 0 and failed = 0, n || '/' || failed);
  begin perform public.client_decide_review(rv1, false, 'no'); ok := false; exception when others then ok := true; end;
  insert into _r values ('change request needs a description', ok, '');
  perform public.client_decide_review(rv1, false, 'Make the logo bigger on post 3');
  select status into v from public.deliverables where id = dl;
  insert into _r values ('deliverable back to revision', v = 'Revision In Progress', v);
  select count(*) into n from public.notifications where recipient_id = u_pm and title like 'Client requested changes%';
  insert into _r values ('manager told about client changes', n = 1, n::text);
  select count(*) into n from public.notifications where recipient_id = u_emp and title like 'Client%';
  insert into _r values ('employee NOT told directly', n = 0, n::text);

  -- other client
  perform set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  select count(*) into n from public.client_deliverable_reviews(dl);
  insert into _r values ('other client sees nothing', n = 0, n::text);

  -- employee cannot forward; manager forwards → task reopened with comment
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  begin perform public.staff_forward_client_feedback(rv1, 'x'); ok := false; exception when others then ok := true; end;
  insert into _r values ('employee cannot forward', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  perform public.staff_forward_client_feedback(rv1, 'Bump to 1.5x please');
  select status into v from public.tasks where id = t1;
  insert into _r values ('task reopened for revision', v = 'revision_required', v);
  select count(*) into n from public.task_comments where task_id = t1 and body like 'Client feedback on version 1%';
  insert into _r values ('feedback posted on task', n = 1, n::text);
  select count(*) into n from public.notifications where recipient_id = u_emp and type = 'task';
  insert into _r values ('employee notified via task', n >= 1, n::text);

  -- draft 3, approve, version 2, client approves
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'in_progress');
  perform public.task_transition(t1, 'awaiting_review', null, 'https://drive.example.com/v3');
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'completed');
  rv2 := public.staff_send_to_client(dl, null, null, t1);
  select round_no into n from public.deliverable_client_reviews where id = rv2;
  insert into _r values ('admin sends version 2', n = 2, n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  perform public.client_decide_review(rv2, true, 'Perfect');
  select status into v from public.deliverables where id = dl;
  insert into _r values ('client approval completes deliverable', v = 'Completed', v);

  -- metrics
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  j := public.employee_review_metrics();
  insert into _r values ('metrics drafts', (j->>'drafts')::int = 3 and (j->>'approval_rate')::numeric = 66.7 and (j->>'first_draft_approval_rate')::numeric = 0, j::text);
  insert into _r values ('metrics client', (j->>'client_rounds')::int = 2 and (j->>'client_first_time_rate')::numeric = 0, j::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  begin perform public.employee_review_metrics(e_emp); ok := false; exception when others then ok := true; end;
  insert into _r values ('outsider cannot read metrics', ok, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  select count(*) into n from public.team_review_metrics() where employee_id = e_emp;
  insert into _r values ('manager team metrics include report', n = 1, n::text);

  -- legacy client review still works and records a round
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  insert into public.deliverables(project_id, client_id, deliverable_number, name, status) values (pr, cl, 'ZZR-002', 'Banner', 'Awaiting Client Review') returning id into dl;
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  perform public.client_review_deliverable(dl, false, 'Wrong size please fix');
  select d.status || '/' || r.status into v from public.deliverables d join public.deliverable_client_reviews r on r.deliverable_id = d.id where d.id = dl;
  insert into _r values ('legacy review records a round', v = 'Revision In Progress/changes_requested', coalesce(v, 'null'));

  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 200)))
    into failed, results from _r;
  raise exception 'REVIEW_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
end
$test$;

rollback;
