-- SIGMA 1 — task workflow tests. Always rolls back (the final statement
-- raises with the JSON results). Expected: ERROR "TASK_TEST_RESULTS {...}" with "failed": 0.
begin;

do $test$
declare
  u_admin uuid := gen_random_uuid();
  u_emp uuid := gen_random_uuid();     -- assignee
  u_mgr uuid := gen_random_uuid();     -- assigner (manager)
  u_out uuid := gen_random_uuid();     -- unrelated employee
  e_emp uuid; e_mgr uuid; e_out uuid; desig uuid;
  t1 uuid; t2 uuid; st uuid; c uuid; n int; v text; ok boolean;
  results jsonb; failed int;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  create temp table if not exists _r(name text, passed boolean, detail text) on commit drop;
  grant select, insert on _r to authenticated;

  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'task-test-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_emp, 'task-test-emp@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_mgr, 'task-test-mgr@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_out, 'task-test-out@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'employee' where id in (u_emp, u_mgr, u_out);
  select id into desig from public.designations order by can_assign_tasks desc limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id) values (u_mgr, 'ZZT02', 'zzt02', 'T Manager', desig) returning id into e_mgr;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, manager_id) values (u_emp, 'ZZT01', 'zzt01', 'T Designer', desig, e_mgr) returning id into e_emp;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id) values (u_out, 'ZZT03', 'zzt03', 'T Outsider', desig) returning id into e_out;

  -- admin assigns two tasks; manager is recorded as assigner on t1
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  insert into public.tasks(title, assigned_to, assigned_by, start_date, due_date, priority)
  values ('Logo concepts', e_emp, e_mgr, v_today, v_today + 5, 'high') returning id into t1;
  insert into public.tasks(title, assigned_to, assigned_by, start_date, due_date, priority)
  values ('Brand brief', e_emp, e_mgr, v_today, v_today + 2, 'medium') returning id into t2;
  select count(*) into n from public.notifications where recipient_id = u_emp and title = 'New task assigned';
  insert into _r values ('assignee notified of new tasks', n = 2, n::text);

  -- dependency: t1 waits on t2 (by assigner)
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  perform public.task_set_dependency(t1, t2, true);
  begin perform public.task_set_dependency(t2, t1, true); ok := false;
  exception when others then ok := sqlerrm like '%wait on each other%'; end;
  insert into _r values ('dependency cycle rejected', ok, '');

  -- assignee flow
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'accepted');
  begin perform public.task_transition(t1, 'in_progress'); ok := false;
  exception when others then ok := sqlerrm like 'Waiting on:%'; end;
  insert into _r values ('cannot start while dependency open', ok, '');
  begin perform public.task_transition(t1, 'completed'); ok := false;
  exception when others then ok := true; end;
  insert into _r values ('assignee cannot self-approve assigner task before hand-in', ok, '');

  begin perform public.task_set_progress(t2, 40); ok := false;
  exception when others then ok := sqlerrm like 'Start the task%'; end;
  insert into _r values ('progress requires started task', ok, '');
  perform public.task_transition(t2, 'in_progress');
  perform public.task_set_progress(t2, 40);
  perform public.task_log_time(t2, 90, v_today, 'research');
  perform public.task_log_time(t2, 30, v_today, null);
  select time_spent_minutes, progress_pct::text into n, v from public.tasks where id = t2;
  insert into _r values ('time and progress recorded', n = 120 and v = '40', n || ' / ' || v);
  begin perform public.task_log_time(t2, 30, v_today + 1, null); ok := false;
  exception when others then ok := true; end;
  insert into _r values ('future time log rejected', ok, '');

  -- subtask blocks hand-in
  st := public.task_create_subtask(t2, 'Competitor list', v_today + 1);
  begin perform public.task_transition(t2, 'awaiting_review', null, 'https://example.com/brief'); ok := false;
  exception when others then ok := sqlerrm like '%subtasks%'; end;
  insert into _r values ('open subtask blocks hand-in', ok, '');
  begin perform public.task_create_subtask(t2, 'Late sub', v_today + 9); ok := false;
  exception when others then ok := sqlerrm like '%on or before%'; end;
  insert into _r values ('subtask cannot be due after parent', ok, '');
  perform public.task_transition(st, 'in_progress');
  perform public.task_transition(st, 'completed');   -- self-assigned subtask: assignee may close it
  select status into v from public.tasks where id = st;
  insert into _r values ('self-assigned subtask closed by assignee', v = 'completed', v);

  begin perform public.task_transition(t2, 'awaiting_review'); ok := false;
  exception when others then ok := sqlerrm like 'Add a link%'; end;
  insert into _r values ('hand-in needs link or file', ok, '');
  perform public.task_transition(t2, 'awaiting_review', 'Draft attached', 'https://example.com/brief');
  select status into v from public.tasks where id = t2;
  insert into _r values ('handed in', v = 'awaiting_review', v);

  -- comment notifies assigner
  c := public.task_add_comment(t2, 'Please check section 2');
  select count(*) into n from public.notifications where recipient_id = u_mgr and title = 'New comment on a task';
  insert into _r values ('comment notifies assigner', n = 1, n::text);

  -- outsider cannot act or read
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  begin perform public.task_transition(t2, 'completed'); ok := false; exception when others then ok := true; end;
  insert into _r values ('outsider cannot approve', ok, '');
  begin perform public.task_add_comment(t2, 'hi'); ok := false; exception when others then ok := true; end;
  insert into _r values ('outsider cannot comment', ok, '');
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.task_comments where task_id = t2;
  insert into _r values ('outsider cannot read comments (RLS)', n = 0, n::text);
  perform set_config('role', 'postgres', true);

  -- reviewer sends back then approves
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  begin perform public.task_transition(t2, 'revision_required'); ok := false;
  exception when others then ok := sqlerrm like 'Say what%'; end;
  insert into _r values ('revision needs a note', ok, '');
  perform public.task_transition(t2, 'revision_required', 'Add pricing table');
  select count(*) into n from public.notifications where recipient_id = u_emp and title = 'Changes requested';
  insert into _r values ('assignee told about requested changes', n = 1, n::text);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.task_comments where task_id = t2;
  insert into _r values ('assigner reads comments (RLS)', n = 1, n::text);
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.task_transition(t2, 'awaiting_review', null, null);   -- earlier link is kept
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  perform public.task_transition(t2, 'completed');
  select status into v from public.tasks where id = t2;
  insert into _r values ('reviewer approved', v = 'completed', v);

  -- dependency now satisfied
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.task_transition(t1, 'in_progress');
  perform public.task_transition(t1, 'blocked', 'Waiting for client logo files');
  select count(*) into n from public.notifications where recipient_id = u_mgr and title = 'Task blocked';
  insert into _r values ('blocked notifies assigner', n = 1, n::text);

  -- legacy hand-in path (old app sets status = completed directly)
  perform public.task_transition(t1, 'in_progress');
  perform set_config('role', 'authenticated', true);
  update public.tasks set status = 'completed', submitted_link = 'https://example.com/logo' where id = t1;
  perform set_config('role', 'postgres', true);
  select status into v from public.tasks where id = t1;
  insert into _r values ('legacy completion still works for the live app', v = 'completed', v);

  -- direct update cannot skip workflow
  perform set_config('sigma.task_rpc', 'on', true);
  update public.tasks set status = 'in_progress', time_spent_minutes = 0 where id = t1;
  perform set_config('sigma.task_rpc', '', true);
  perform set_config('role', 'authenticated', true);
  update public.tasks set time_spent_minutes = 9999, progress_pct = 5, completed_at = now() where id = t1;
  perform set_config('role', 'postgres', true);
  select time_spent_minutes into n from public.tasks where id = t1;
  insert into _r values ('direct update cannot forge workflow fields', n = 0, n::text);

  -- cancel needs reviewer + reason
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  begin perform public.task_transition(t1, 'cancelled', 'no'); ok := false; exception when others then ok := true; end;
  insert into _r values ('assignee cannot cancel', ok, '');

  -- reminders
  perform set_config('request.jwt.claims', '', true);
  perform set_config('sigma.task_rpc', 'on', true);
  update public.tasks set status = 'in_progress', due_date = v_today + 1, start_date = v_today where id = t1;
  perform set_config('sigma.task_rpc', '', true);
  n := private.send_task_due_reminders();
  select count(*) into n from public.notifications where recipient_id = u_emp and title = 'Task due tomorrow';
  perform private.send_task_due_reminders();
  select count(*) - n into n from public.notifications where recipient_id = u_emp and title = 'Task due tomorrow';
  insert into _r values ('due reminder sent once', n = 0 and exists (select 1 from public.notifications where recipient_id = u_emp and title = 'Task due tomorrow'), n::text);

  select count(*) filter (where not passed), jsonb_agg(jsonb_build_object('test', name, 'ok', passed, 'detail', left(detail, 160)))
    into failed, results from _r;
  raise exception 'TASK_TEST_RESULTS %', jsonb_build_object('failed', failed, 'total', jsonb_array_length(results), 'results', results);
end
$test$;

rollback;
