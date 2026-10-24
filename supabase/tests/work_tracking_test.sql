-- SIGMA 1 — work tracking tests. Always rolls back. Expected: ERROR "WORK_TEST_RESULTS {...}" with "failed": 0.
begin;

do $test$
declare
  u_admin uuid := gen_random_uuid(); u_emp uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_out uuid := gen_random_uuid();
  e_emp uuid; e_mgr uuid; e_out uuid; desig uuid; att uuid; brk uuid;
  t1 uuid; t2 uuid; k uuid; n int; v jsonb; ok boolean; results jsonb; failed int;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  d0 timestamptz;
begin
  create temp table if not exists _r(name text, passed boolean, detail text);

  insert into auth.users(id, email, raw_app_meta_data, aud, role) values
    (u_admin, 'work-test-admin@example.invalid', '{"role":"admin"}', 'authenticated', 'authenticated'),
    (u_emp, 'work-test-emp@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_mgr, 'work-test-mgr@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated'),
    (u_out, 'work-test-out@example.invalid', '{"role":"employee"}', 'authenticated', 'authenticated');
  update public.profiles set role = 'admin' where id = u_admin;
  update public.profiles set role = 'employee' where id in (u_emp, u_mgr, u_out);
  select id into desig from public.designations order by can_assign_tasks desc limit 1;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id) values (u_mgr, 'ZZW02', 'zzw02', 'W Manager', desig) returning id into e_mgr;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id, manager_id) values (u_emp, 'ZZW01', 'zzw01', 'W Designer', desig, e_mgr) returning id into e_emp;
  insert into public.employees(profile_id, emp_id, login_id, name, designation_id) values (u_out, 'ZZW03', 'zzw03', 'W Outsider', desig) returning id into e_out;

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  insert into public.tasks(title, assigned_to, assigned_by, start_date, due_date, priority)
  values ('W Logo', e_emp, e_mgr, v_today, v_today + 5, 'high') returning id into t1;
  insert into public.tasks(title, assigned_to, assigned_by, start_date, due_date, priority)
  values ('W Poster', e_emp, e_mgr, v_today, v_today + 2, 'medium') returning id into t2;

  -- employee: start before check-in is refused
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  begin perform public.work_start_task(t1); ok := false; exception when others then ok := sqlerrm like 'Check in first%'; end;
  insert into _r values ('start needs check-in', ok, '');

  insert into public.attendance(employee_id, date, mode) values (e_emp, v_today, 'office') returning id into att;
  v := public.work_heartbeat();
  insert into _r values ('heartbeat: checked in, first of day', (v->>'checked_in')::boolean and (v->>'first_of_day')::boolean, v::text);

  -- start = in progress, no accept step
  v := public.work_start_task(t1);
  insert into _r values ('start sets in_progress', (select status from public.tasks where id = t1) = 'in_progress', '');
  insert into _r values ('state shows running task', v->'current'->>'task_id' = t1::text, v::text);
  insert into _r values ('progress check scheduled', (select next_check_at from public.work_presence where employee_id = e_emp) between now() + interval '45 min' and now() + interval '75 min', '');

  -- switching closes the other
  perform public.work_start_task(t2);
  select count(*) into n from public.work_sessions where employee_id = e_emp and ended_at is null;
  insert into _r values ('one open session after switch', n = 1 and (select task_id from public.work_sessions where employee_id = e_emp and ended_at is null) = t2, n::text);
  insert into _r values ('switch reason recorded', exists (select 1 from public.work_sessions where task_id = t1 and end_reason = 'switch'), '');

  -- meeting pauses the task
  begin perform public.work_start_meeting('other', ''); ok := false; exception when others then ok := sqlerrm like 'Say what%'; end;
  insert into _r values ('other meeting needs a note', ok, '');
  v := public.work_start_meeting('team_brief');
  insert into _r values ('meeting running', v->'current'->>'kind' = 'meeting', v::text);

  -- break closes the meeting; start blocked during break
  insert into public.break_events(attendance_id, employee_id) values (att, e_emp) returning id into brk;
  insert into _r values ('break closes session', not exists (select 1 from public.work_sessions where employee_id = e_emp and ended_at is null), '');
  begin perform public.work_start_task(t1); ok := false; exception when others then ok := sqlerrm like 'End your break%'; end;
  insert into _r values ('no task during break', ok, '');
  update public.break_events set break_end = now() where id = brk;

  -- manual time logging removed
  insert into _r values ('task_log_time revoked', not has_function_privilege('authenticated', 'public.task_log_time(uuid,integer,date,text)', 'execute'), '');

  -- old timer RPC goes through sessions
  perform public.task_timer_start(t1);
  insert into _r values ('task_timer_start uses sessions', exists (select 1 from public.work_sessions where employee_id = e_emp and ended_at is null and task_id = t1), '');

  -- outsider cannot start someone else's task / see their work
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  begin perform public.work_start_task(t1); ok := false; exception when others then ok := sqlerrm like 'Only the assignee%'; end;
  insert into _r values ('outsider cannot start', ok, '');
  begin perform public.work_day(e_emp, v_today); ok := false; exception when others then ok := sqlerrm = 'Not allowed'; end;
  insert into _r values ('outsider cannot read day', ok, '');
  begin perform public.work_ask(t1, 'How is it?'); ok := false; exception when others then ok := sqlerrm like 'Only the manager%'; end;
  insert into _r values ('outsider cannot ask', ok, '');
  begin update public.work_settings set daily_break_minutes = 120; get diagnostics n = row_count; ok := n = 0;
  exception when others then ok := true; end;
  insert into _r values ('non-admin cannot change settings', ok and (select daily_break_minutes from public.work_settings) = 60, '');

  -- manager asks; employee answers into discussion; never counts as presence
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  k := public.work_ask(t1, 'Is the logo ready for the client call?');
  insert into _r values ('manager sees live board', exists (select 1 from public.work_team_live() where employee_id = e_emp), '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  v := public.work_heartbeat();
  insert into _r values ('question shows in pending', jsonb_array_length(v->'pending') = 1 and (v->'pending'->0->>'from_manager')::boolean, v->'pending'::text);
  begin perform public.work_answer_check(k, 'stuck', 30, ''); ok := false; exception when others then ok := sqlerrm like 'Say what%'; end;
  insert into _r values ('stuck needs a note', ok, '');
  perform public.work_answer_check(k, 'stuck', 30, 'Waiting for the brand colours');
  insert into _r values ('answer updates progress', (select progress_pct from public.tasks where id = t1) = 30, '');
  insert into _r values ('answer posted to discussion', exists (select 1 from public.task_comments where task_id = t1 and body like '↳ Is the logo%Stuck · 30%'), '');
  insert into _r values ('stuck notifies manager', exists (select 1 from public.notifications where recipient_id = u_mgr and title = 'Stuck on a task'), '');

  -- automatic check due → created; expired → missed and task closed at the question time
  update public.work_presence set next_check_at = now() - interval '1 min' where employee_id = e_emp;
  perform private.work_sweep_employee(e_emp);
  select id into k from public.progress_checks where employee_id = e_emp and is_presence and status = 'pending';
  insert into _r values ('auto check created + notified', k is not null and exists (select 1 from public.notifications where recipient_id = u_emp and title like 'How’s%'), '');
  update public.progress_checks set asked_at = now() - interval '6 min', expires_at = now() - interval '1 min' where id = k;
  update public.work_sessions set started_at = now() - interval '30 min' where employee_id = e_emp and ended_at is null;
  begin perform public.work_answer_check(k, 'on_track', 50, null); ok := false; exception when others then ok := sqlerrm like 'This check expired%'; end;
  insert into _r values ('late answer refused', ok, '');
  perform private.work_sweep_employee(e_emp);
  insert into _r values ('missed check marks missed', (select status from public.progress_checks where id = k) = 'missed', '');
  insert into _r values ('session closed at question time', exists (select 1 from public.work_sessions where employee_id = e_emp and end_reason = 'missed_check'
     and ended_at = (select asked_at from public.progress_checks where id = k)), '');
  insert into _r values ('time credited to task', (select time_spent_minutes from public.tasks where id = t1) >= 24, (select time_spent_minutes from public.tasks where id = t1)::text);

  -- offline: no heartbeat for 10+ minutes closes at last signal
  perform public.work_start_task(t1);
  update public.work_sessions set started_at = now() - interval '40 min' where employee_id = e_emp and ended_at is null;
  update public.work_presence set last_seen_at = now() - interval '15 min', next_check_at = null where employee_id = e_emp;
  perform private.work_sweep_employee(e_emp);
  insert into _r values ('offline closes at last signal', exists (select 1 from public.work_sessions where employee_id = e_emp and end_reason = 'offline'
     and ended_at = now() - interval '15 min'), '');

  -- submit draft stops the timer
  perform public.work_start_task(t2);
  begin
    perform public.task_transition(t2, 'awaiting_review', null, 'https://example.invalid/draft');
    ok := not exists (select 1 from public.work_sessions where employee_id = e_emp and ended_at is null)
          and exists (select 1 from public.work_sessions where task_id = t2 and end_reason = 'submitted');
  exception when others then ok := false; v := to_jsonb(sqlerrm); end;
  insert into _r values ('submit closes session', ok, coalesce(v::text, ''));

  -- day timeline: buffer, task, away, break
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  d0 := now() - interval '5 hours';
  delete from public.work_sessions where employee_id = e_emp;
  delete from public.break_events where attendance_id = att;
  update public.attendance set check_in_at = d0, current_state = 'working' where id = att;
  insert into public.work_sessions(employee_id, kind, task_id, started_at, ended_at, end_reason) values
    (e_emp, 'task', t1, d0 + interval '10 min', d0 + interval '70 min', 'pause'),
    (e_emp, 'meeting', null, d0 + interval '70 min', d0 + interval '100 min', 'pause'),
    (e_emp, 'task', t1, d0 + interval '120 min', d0 + interval '180 min', 'pause');
  update public.work_sessions set meeting_type = 'team_brief' where employee_id = e_emp and kind = 'meeting';
  insert into public.break_events(attendance_id, employee_id, break_start, break_end) values (att, e_emp, d0 + interval '180 min', d0 + interval '255 min');
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  v := public.work_day(e_emp, v_today);
  insert into _r values ('day: buffer 10', (v->>'buffer_min')::int = 10, v::text);
  insert into _r values ('day: task 120 + meeting 30 = effective 150', (v->>'task_min')::int = 120 and (v->>'meeting_min')::int = 30 and (v->>'effective_min')::int = 150, '');
  insert into _r values ('day: break capped at 60, overrun 15', (v->>'break_min')::int = 60 and (v->>'overrun_min')::int = 15, '');
  insert into _r values ('day: away = gap 20 + overrun 15 + tail 45', (v->>'away_min')::int = 80, v->>'away_min');
  v := public.work_month(e_emp, v_today);
  insert into _r values ('month has score + today row', v ? 'score' and (v->>'present')::int = 1, left(v::text, 400));
  insert into _r values ('team month lists report', exists (select 1 from public.work_team_month(v_today) where employee_id = e_emp), '');

  -- check-out closes the open session
  perform set_config('request.jwt.claims', json_build_object('sub', u_emp, 'role', 'authenticated')::text, true);
  perform public.work_start_task(t1);
  update public.attendance set current_state = 'completed' where id = att;
  insert into _r values ('checkout closes session', exists (select 1 from public.work_sessions where employee_id = e_emp and end_reason = 'checkout')
     and not exists (select 1 from public.work_sessions where employee_id = e_emp and ended_at is null), '');
  begin perform public.work_start_task(t1); ok := false; exception when others then ok := sqlerrm like 'You have checked out%'; end;
  insert into _r values ('no start after checkout', ok, '');

  select jsonb_agg(jsonb_build_object('name', name, 'passed', passed, 'detail', left(detail, 300))) filter (where not passed),
         count(*) filter (where not passed) into results, failed from _r;
  raise exception 'WORK_TEST_RESULTS failed=%/% %', failed, (select count(*) from _r), coalesce(results::text, '[]');
end $test$;

rollback;
