-- Rollback-only checks for 20261101090000_dryrun_logic_fixes.sql.
-- Run after the migration body inside one transaction; the final RAISE aborts it, so nothing is kept.
create temp table _r(id text, ok boolean, got text);
grant all on _r to authenticated;

-- fixtures (all rolled back)
-- AKASH K: Mon–Fri from 15 Oct; today (Sun) remote, starts 10 min ago; from 9 Nov flexible Mon–Fri, engagement ends 20 Nov
update public.employee_work_rules set working_days = '{1,2,3,4,5}' where employee_id = '3f1455bb-9c6a-4d4d-9131-f11c8ef29393' and effective_from = '2026-10-15';
insert into public.employee_work_rules(employee_id, effective_from, location_mode, schedule_type, working_days, shift_start, shift_end)
values ('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', private.today_ist(), 'remote', 'fixed', '{1,2,3,4,5,6,7}',
        ((now() at time zone 'Asia/Kolkata') - interval '10 minutes')::time(0), ((now() at time zone 'Asia/Kolkata') + interval '8 hours')::time(0));
insert into public.employee_work_rules(employee_id, effective_from, location_mode, schedule_type, working_days, extra_wfh, engagement_end)
values ('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', '2026-11-09', 'office', 'flexible', '{1,2,3,4,5}', 'approval', '2026-11-20');
-- jcob: today remote, started 30 min ago; 3 Nov 10:00–19:00 grace 5 / early grace 0; 4 Nov overnight 22:00–06:00
insert into public.employee_work_rules(employee_id, effective_from, location_mode, schedule_type, working_days, shift_start, shift_end)
values ('0e43a311-bfef-4c39-a322-84706eb2adf3', private.today_ist(), 'remote', 'fixed', '{1,2,3,4,5,6,7}',
        ((now() at time zone 'Asia/Kolkata') - interval '30 minutes')::time(0), ((now() at time zone 'Asia/Kolkata') + interval '8 hours')::time(0));
insert into public.employee_work_rules(employee_id, effective_from, location_mode, schedule_type, working_days, shift_start, shift_end, late_grace_minutes)
values ('0e43a311-bfef-4c39-a322-84706eb2adf3', '2026-11-03', 'office', 'fixed', '{1,2,3,4,5,6}', '10:00', '19:00', 5);
insert into public.employee_work_rules(employee_id, effective_from, location_mode, schedule_type, working_days, shift_start, shift_end)
values ('0e43a311-bfef-4c39-a322-84706eb2adf3', '2026-11-04', 'office', 'fixed', '{1,2,3,4,5,6}', '22:00', '06:00');

-- nightly sync: today's rule reached the legacy columns (was 'Unauthorized employee update')
insert into _r select 'sync: today rule applied to employee', e.work_mode = 'remote', e.work_mode || ' ' || e.shift_start from public.employees e where e.id = '3f1455bb-9c6a-4d4d-9131-f11c8ef29393';
do $$ begin perform private.work_rules_daily_sync(); insert into _r values ('sync: nightly job runs', true, null);
exception when others then insert into _r values ('sync: nightly job runs', false, sqlerrm); end $$;

-- F1: company grace (15 min) on a 09:00 shift
insert into _r select 'F1 09:10 on time', private.late_minutes('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', '2026-11-02', '2026-11-02 09:10+05:30') = 0, private.late_minutes('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', '2026-11-02', '2026-11-02 09:10+05:30')::text;
insert into _r select 'F1 09:15 on time (edge)', private.late_minutes('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', '2026-11-02', '2026-11-02 09:15+05:30') = 0, null;
insert into _r select 'F1 09:16 late 16', private.late_minutes('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', '2026-11-02', '2026-11-02 09:16+05:30') = 16, private.late_minutes('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', '2026-11-02', '2026-11-02 09:16+05:30')::text;
insert into _r select 'F1 08:40 early not late', private.late_minutes('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', '2026-11-02', '2026-11-02 08:40+05:30') = 0, null;
-- F2: flexible never late; per-person start + grace; overnight
insert into _r select 'F2 flexible 11:30 not late', private.late_minutes('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', '2026-11-10', '2026-11-10 11:30+05:30') = 0, null;
insert into _r select 'F2 10:05 grace 5 on time', private.late_minutes('0e43a311-bfef-4c39-a322-84706eb2adf3', '2026-11-03', '2026-11-03 10:05+05:30') = 0, null;
insert into _r select 'F2 10:06 late 6', private.late_minutes('0e43a311-bfef-4c39-a322-84706eb2adf3', '2026-11-03', '2026-11-03 10:06+05:30') = 6, private.late_minutes('0e43a311-bfef-4c39-a322-84706eb2adf3', '2026-11-03', '2026-11-03 10:06+05:30')::text;
insert into _r select 'F2 overnight 22:20 late 20', private.late_minutes('0e43a311-bfef-4c39-a322-84706eb2adf3', '2026-11-04', '2026-11-04 22:20+05:30') = 20, private.late_minutes('0e43a311-bfef-4c39-a322-84706eb2adf3', '2026-11-04', '2026-11-04 22:20+05:30')::text;
insert into _r select 'F2 overnight 21:50 not late', private.late_minutes('0e43a311-bfef-4c39-a322-84706eb2adf3', '2026-11-04', '2026-11-04 21:50+05:30') = 0, null;
insert into _r select 'early 18:30 = 30', private.early_minutes('0e43a311-bfef-4c39-a322-84706eb2adf3', '2026-11-03', '2026-11-03 18:30+05:30') = 30, private.early_minutes('0e43a311-bfef-4c39-a322-84706eb2adf3', '2026-11-03', '2026-11-03 18:30+05:30')::text;
insert into _r select 'early 19:10 = 0', private.early_minutes('0e43a311-bfef-4c39-a322-84706eb2adf3', '2026-11-03', '2026-11-03 19:10+05:30') = 0, null;
insert into _r select 'early flexible = 0', private.early_minutes('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', '2026-11-10', '2026-11-10 12:00+05:30') = 0, null;

-- real check-ins (as the employees): 10 min after start → present, 30 min after → late
select set_config('request.jwt.claims', '{"sub":"5663d4b7-57e0-4b44-ba2b-58d47ff9c1a5","role":"authenticated"}', true), set_config('request.jwt.claim.sub', '5663d4b7-57e0-4b44-ba2b-58d47ff9c1a5', true);
set local role authenticated;
do $$ begin perform public.attendance_check_in('wfh');
  insert into _r select 'F1 check-in 10 min after start = present', status = 'present', status from public.attendance where employee_id = '3f1455bb-9c6a-4d4d-9131-f11c8ef29393' and date = private.today_ist();
exception when others then insert into _r values ('F1 check-in 10 min after start = present', false, sqlerrm); end $$;
-- F6: leave Mon 9 – Sun 15 Nov on a Mon–Fri pattern = 5 days
do $$ declare v numeric; begin
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, duration, reason)
  values ('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', 'casual', '2026-11-09', '2026-11-15', 'full', 'test') returning days into v;
  insert into _r values ('F6 leave counts own working days (5)', v = 5, v::text);
exception when others then insert into _r values ('F6 leave counts own working days (5)', false, sqlerrm); end $$;
-- F6: WFH on their Saturday off is refused; a working day is accepted
do $$ begin
  insert into public.wfh_requests(employee_id, date, reason) values ('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', '2026-11-14', 'test');
  insert into _r values ('F6 WFH on own weekly off refused', false, 'accepted');
exception when others then insert into _r values ('F6 WFH on own weekly off refused', sqlerrm ilike '%weekly off%', sqlerrm); end $$;
do $$ begin
  insert into public.wfh_requests(employee_id, date, reason) values ('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', '2026-11-17', 'test');
  insert into _r values ('F6 WFH on a working day accepted', true, null);
exception when others then insert into _r values ('F6 WFH on a working day accepted', false, sqlerrm); end $$;
-- F16: correction on their Saturday off (31 Oct) is refused
do $$ begin
  insert into public.regularization_requests(employee_id, date, requested_check_in, requested_check_out, reason)
  values ('3f1455bb-9c6a-4d4d-9131-f11c8ef29393', '2026-10-31', '09:00', '18:00', 'test');
  insert into _r values ('F16 correction on own weekly off refused', false, 'accepted');
exception when others then insert into _r values ('F16 correction on own weekly off refused', sqlerrm ilike '%weekly off%', sqlerrm); end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"95db649a-fdea-4e93-a8f6-5cb59d5bbe4c","role":"authenticated"}', true), set_config('request.jwt.claim.sub', '95db649a-fdea-4e93-a8f6-5cb59d5bbe4c', true);
set local role authenticated;
do $$ begin perform public.attendance_check_in('wfh');
  insert into _r select 'F1 check-in 30 min after start = late', status = 'late', status from public.attendance where employee_id = '0e43a311-bfef-4c39-a322-84706eb2adf3' and date = private.today_ist();
exception when others then insert into _r values ('F1 check-in 30 min after start = late', false, sqlerrm); end $$;
do $$ declare v jsonb; begin v := public.employee_punctuality();
  insert into _r values ('punctuality runs', v ? 'late_after', v->>'late_after');
exception when others then insert into _r values ('punctuality runs', false, sqlerrm); end $$;
reset role;

-- F3: office person, WFH not approved → message says "a day ahead", not "request WFH for today"
select set_config('request.jwt.claims', '{"sub":"53adba60-3b56-415a-a54b-31a5b7855b42","role":"authenticated"}', true), set_config('request.jwt.claim.sub', '53adba60-3b56-415a-a54b-31a5b7855b42', true);
set local role authenticated;
do $$ declare v jsonb; begin v := public.my_attendance_context();
  insert into _r values ('F3 WFH message is accurate', (v->'wfh'->>'reason') ilike '%a day ahead%' and (v->'wfh'->>'reason') not ilike '%request wfh for today%', v->'wfh'->>'reason');
exception when others then insert into _r values ('F3 WFH message is accurate', false, sqlerrm); end $$;
reset role;

-- F8: assignee (satish) can't complete their own task
select set_config('request.jwt.claims', '{"sub":"f532d64a-6b98-464c-9421-38ffc3401d48","role":"authenticated"}', true), set_config('request.jwt.claim.sub', 'f532d64a-6b98-464c-9421-38ffc3401d48', true);
set local role authenticated;
do $$ declare v text; begin
  update public.tasks set status = 'completed', submitted_link = 'https://example.com/x' where id = '522c2c9a-2b73-480b-96b5-d9d8a1967788';
  select status into v from public.tasks where id = '522c2c9a-2b73-480b-96b5-d9d8a1967788';
  insert into _r values ('F8 direct update cannot complete', v = 'in_progress', v);
exception when others then insert into _r values ('F8 direct update cannot complete', true, 'blocked: ' || sqlerrm); end $$;
do $$ begin perform public.submit_task('6d1013e0-0317-49d4-a42f-1249109e1429', 'https://example.com/x');
  insert into _r select 'F8 submit_task cannot complete', status <> 'completed', status from public.tasks where id = '6d1013e0-0317-49d4-a42f-1249109e1429';
exception when others then insert into _r values ('F8 submit_task cannot complete', true, 'blocked: ' || sqlerrm); end $$;
do $$ begin perform public.task_transition('522c2c9a-2b73-480b-96b5-d9d8a1967788', 'awaiting_review', null, 'https://example.com/x');
  insert into _r values ('F8 hand-in for review still works', true, null);
exception when others then insert into _r values ('F8 hand-in for review still works', false, sqlerrm); end $$;
do $$ begin perform public.task_transition('522c2c9a-2b73-480b-96b5-d9d8a1967788', 'completed', null, null);
  insert into _r values ('F8 assignee cannot approve', false, 'approved');
exception when others then insert into _r values ('F8 assignee cannot approve', true, sqlerrm); end $$;
reset role;
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);

-- F4/F5: payroll
update public.payroll_settings set absent_from = '2026-09-01';
select private.generate_payroll_internal('2026-09-01');
insert into _r select 'F4 Sep: satish absent days = working days − leave', r.absent_days = 24 - coalesce((select sum(days) from public.leave_requests where employee_id = r.employee_id and status = 'approved' and start_date >= '2026-09-01' and end_date < '2026-10-01'), 0),
  format('absent %s, ded %s, rate %s, final %s, salary %s', r.absent_days, r.absent_deduction, round(r.daily_rate, 2), r.final_pay, r.salary_snapshot)
from public.payroll_records r join public.payroll_periods p on p.id = r.period_id where p.month_start = '2026-09-01' and r.employee_id = '8eedfd61-c3c5-4680-ae6d-a2cf155f3d18';
insert into _r select 'F4 final = salary − leave ded − absent ded', r.final_pay = greatest(0, round(r.salary_snapshot - r.leave_deduction - r.absent_deduction, 2)), r.final_pay::text
from public.payroll_records r join public.payroll_periods p on p.id = r.period_id where p.month_start = '2026-09-01' and r.employee_id = '8eedfd61-c3c5-4680-ae6d-a2cf155f3d18';
insert into _r select 'F4 not before join (AKASH K not in Sep)', not exists (select 1 from public.payroll_records r join public.payroll_periods p on p.id = r.period_id where p.month_start = '2026-09-01' and r.employee_id = '3f1455bb-9c6a-4d4d-9131-f11c8ef29393'), null;
update public.payroll_settings set absent_from = '2026-11-01';
select private.generate_payroll_internal('2026-11-01');
insert into _r select 'F4 no future days counted (Nov, generated 1 Nov)', coalesce(sum(r.absent_days), 0) = 0, sum(r.absent_days)::text
from public.payroll_records r join public.payroll_periods p on p.id = r.period_id where p.month_start = '2026-11-01';
insert into _r select 'F5 pay stops at engagement end (20 Nov → 20/30)', r.final_pay = round(r.salary_snapshot * 20 / 30, 2), format('final %s of %s', r.final_pay, r.salary_snapshot)
from public.payroll_records r join public.payroll_periods p on p.id = r.period_id where p.month_start = '2026-11-01' and r.employee_id = '3f1455bb-9c6a-4d4d-9131-f11c8ef29393';
do $$ begin perform private.generate_payroll_internal('2026-10-01'); insert into _r values ('Oct (finalized) still locked', false, 'regenerated');
exception when others then insert into _r values ('Oct (finalized) still locked', sqlerrm ilike '%finalized%', sqlerrm); end $$;
do $$ declare v jsonb; begin v := private.work_day_json('8eedfd61-c3c5-4680-ae6d-a2cf155f3d18', (select max(date) from public.attendance where employee_id = '8eedfd61-c3c5-4680-ae6d-a2cf155f3d18'));
  insert into _r values ('work_day_json still works', true, v->>'late');
exception when others then insert into _r values ('work_day_json still works', false, sqlerrm); end $$;

do $$ begin raise exception 'RESULTS % / % passed: %', (select count(*) filter (where ok) from _r), (select count(*) from _r),
  (select json_agg(json_build_object('t', id, 'ok', ok, 'got', got)) from _r); end $$;
