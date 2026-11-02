-- SIGMA 1 — smart insights for the Sigma helper robot.
-- Worked out from each person's own history (no AI, no data leaves the database):
--   self:    weekday late pattern, slow start after check-in, tasks at risk vs. your usual effort, on-time streak,
--            missed progress checks, pay cut forecast for the month
--   team:    (managers: direct reports, no money; admins: everyone) repeat lateness, leave clashing with due work,
--            overdue piles, hand-ins waiting, meeting-heavy week
--   admin:   who hasn't checked in, client money due/overdue, payments to verify
-- Read-only. Returns [{key, type, priority, mood, text, to, label}].
set local lock_timeout = '5s';

create or replace function public.assistant_insights()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp uuid := private.current_employee_id();
  v_admin boolean := private.is_admin();
  v_today date := private.today_ist();
  v_month date := date_trunc('month', private.today_ist())::date;
  v_out jsonb := '[]'::jsonb;
  v_team uuid[];
  r record; v_txt text; v_n int; v_amt numeric; v_days int; v_sal numeric; v_abs numeric; v_unpaid numeric;
  v_tab_team text := case when private.is_admin() then 'admin-attendance' else 'emp-team-time' end;
  v_tab_tasks text := case when private.is_admin() then 'admin-tasks' else 'emp-tasks' end;
  dw_name text[] := array['Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays','Sundays'];
begin
  if v_emp is null and not v_admin then return v_out; end if;

  -- ───────────── about me ─────────────
  if v_emp is not null then
    -- A. late on the same weekday again and again
    select * into r from (
      select dw, count(*) n, count(*) filter (where lm > 0) late, round(avg(lm) filter (where lm > 0)) avg_late
      from (select extract(isodow from x.date)::int dw, private.late_minutes(v_emp, x.date, x.check_in_at) lm
            from public.attendance_effective x
            where x.employee_id = v_emp and x.date >= v_today - 56 and x.date < v_today and x.check_in_at is not null) d
      group by dw) g
    where late >= 2 and n >= 3 and late * 2 >= n order by late desc, avg_late desc limit 1;
    if found then
      v_out := v_out || jsonb_build_object('key', 'ins-lateday:' || r.dw || ':' || v_today, 'type', 'ins-lateday', 'priority', 2, 'mood', 'think',
        'text', 'You were late on ' || r.late || ' of your last ' || r.n || ' ' || dw_name[r.dw]
                || case when r.avg_late <= 60
                     then ' (about ' || r.avg_late || ' min each). Leaving ' || (ceil((r.avg_late + 5) / 5.0) * 5)::int || ' min earlier on ' || dw_name[r.dw] || ' keeps you on time.'
                     else '. Is something getting in the way on ' || dw_name[r.dw] || '? Talk to your manager if your start time needs to change.' end,
        'to', 'emp-attendance', 'label', 'See my days');
    end if;

    -- B. the first task starts long after check-in (that time is not counted)
    select round(avg(gap))::int, count(*) into v_n, v_days from (
      select extract(epoch from (min(w.started_at) - a.check_in_at)) / 60 as gap
      from public.attendance a join public.work_sessions w on w.employee_id = a.employee_id
        and w.started_at >= a.check_in_at and (w.started_at at time zone 'Asia/Kolkata')::date = a.date
      where a.employee_id = v_emp and a.date >= v_today - 21 and a.check_in_at is not null
      group by a.date, a.check_in_at) s
    where gap between 0 and 240;
    if v_days >= 3 and v_n >= 15 then
      v_out := v_out || jsonb_build_object('key', 'ins-slowstart:' || v_today, 'type', 'ins-slowstart', 'priority', 2, 'mood', 'think',
        'text', 'On average your first task timer starts ' || v_n || ' min after you check in — that time isn’t counted as work. Start a task right after checking in.',
        'to', 'emp-tasks', 'label', 'My tasks');
    end if;

    -- C. tasks due soon that are behind your usual effort
    for r in
      with mine as (
        select t.id, t.title, t.due_date, t.estimate_minutes,
               coalesce((select sum(extract(epoch from (coalesce(w.ended_at, now()) - w.started_at)) / 60) from public.work_sessions w where w.task_id = t.id), 0) as tracked
        from public.tasks t
        where t.assigned_to = v_emp and t.archived_at is null and t.status in ('assigned','accepted','in_progress','revision_required')
          and t.due_date between v_today and v_today + 2),
      usual as (
        select percentile_cont(.5) within group (order by m) as med from (
          select sum(extract(epoch from (w.ended_at - w.started_at)) / 60) m
          from public.work_sessions w join public.tasks t on t.id = w.task_id
          where t.assigned_to = v_emp and t.status = 'completed' and t.completed_at > now() - interval '90 days' and w.ended_at is not null
          group by t.id) x where m >= 30)
      select mine.*, coalesce(mine.estimate_minutes, (select med from usual))::int as typical, mine.estimate_minutes is not null as has_est
      from mine order by due_date limit 2
    loop
      if r.typical is not null and r.tracked < r.typical * .6 then
        v_out := v_out || jsonb_build_object('key', 'ins-risk:' || r.id || ':' || v_today, 'type', 'ins-risk', 'priority', case when r.due_date = v_today then 1 else 2 end, 'mood', 'worried',
          'text', '“' || left(r.title, 60) || '” is due ' || case when r.due_date = v_today then 'today' when r.due_date = v_today + 1 then 'tomorrow' else to_char(r.due_date, 'FMDay') end
                  || '. You’ve tracked ' || private.fmt_duration((r.tracked * 60)::int) || '; ' || case when r.has_est then 'the estimate is ' else 'your tasks usually take about ' end
                  || private.fmt_duration(r.typical * 60) || '. Start now to finish on time.',
          'to', 'emp-tasks?task=' || r.id, 'label', 'Start it');
      end if;
    end loop;

    -- D. on-time streak (good news too)
    select count(*) into v_n from (
      select x.date, private.late_minutes(v_emp, x.date, x.check_in_at) lm,
             row_number() over (order by x.date desc) rn
      from public.attendance_effective x where x.employee_id = v_emp and x.check_in_at is not null and x.date > v_today - 45 order by x.date desc) s
    where lm = 0 and rn <= (select coalesce(min(rn) - 1, 99) from (
      select row_number() over (order by x.date desc) rn, private.late_minutes(v_emp, x.date, x.check_in_at) lm
      from public.attendance_effective x where x.employee_id = v_emp and x.check_in_at is not null and x.date > v_today - 45) z where lm > 0);
    if v_n >= 5 then
      v_out := v_out || jsonb_build_object('key', 'ins-streak:' || v_n, 'type', 'ins-streak', 'priority', 3, 'mood', 'celebrate',
        'text', v_n || ' on-time check-ins in a row. Keep the streak going!', 'to', 'emp-performance', 'label', 'My punctuality');
    end if;

    -- E. progress checks missed this week
    select count(*) into v_n from public.progress_checks k
    where k.employee_id = v_emp and k.is_presence and k.status = 'missed' and k.asked_at >= date_trunc('week', now());
    if v_n >= 2 then
      v_out := v_out || jsonb_build_object('key', 'ins-missed:' || v_today, 'type', 'ins-missed', 'priority', 2, 'mood', 'worried',
        'text', 'You missed ' || v_n || ' progress checks this week — each one stopped your task timer. Keep notifications on and this tab awake.',
        'to', 'emp-time', 'label', 'My time');
    end if;

    -- F. pay forecast: cuts so far this month (absent days + unpaid leave)
    select sh.monthly_salary into v_sal from public.salary_history sh
    where sh.employee_id = v_emp and sh.effective_from <= v_today and (sh.effective_to is null or sh.effective_to >= v_month)
    order by sh.effective_from desc limit 1;
    if coalesce(v_sal, 0) > 0 then
      v_abs := private.payroll_absent_days(v_emp, greatest(v_month, coalesce((select absent_from from public.payroll_settings where id), v_month),
                 (select join_date from public.employees where id = v_emp)), v_today - 1);
      select coalesce(unpaid_used, 0) into v_unpaid from public.leave_ledger where employee_id = v_emp and period_start = v_month;
      v_unpaid := coalesce(v_unpaid, 0);
      v_days := extract(day from (v_month + interval '1 month' - interval '1 day'))::int;
      v_amt := round((v_abs + v_unpaid) * v_sal / v_days);
      if v_amt > 0 then
        v_out := v_out || jsonb_build_object('key', 'ins-pay:' || v_today || ':' || v_amt, 'type', 'ins-pay', 'priority', 2, 'mood', 'worried',
          'text', 'So far this month: ' || concat_ws(' and ', case when v_abs > 0 then v_abs || ' absent day' || case when v_abs = 1 then '' else 's' end end,
                    case when v_unpaid > 0 then v_unpaid || ' unpaid leave day' || case when v_unpaid = 1 then '' else 's' end end)
                  || ' — about ₹' || to_char(v_amt, 'FM99,99,99,999') || ' will come off ' || to_char(v_month, 'FMMonth') || ' pay.',
          'to', 'emp-payroll', 'label', 'Pay details');
      end if;
    end if;
  end if;

  -- ───────────── my team (admins: everyone; managers: direct reports) ─────────────
  select array_agg(e.id) into v_team from public.employees e
  where e.status = 'active' and (v_admin or (v_emp is not null and e.manager_id = v_emp)) and e.id is distinct from v_emp;

  if v_team is not null then
    -- G. repeat lateness this month
    select string_agg(name || ' (' || n || ')', ', ' order by n desc), count(*) into v_txt, v_n from (
      select e.name, count(*) n from public.attendance_effective x join public.employees e on e.id = x.employee_id
      where x.employee_id = any(v_team) and x.date >= v_month and x.check_in_at is not null and private.late_minutes(x.employee_id, x.date, x.check_in_at) > 0
      group by e.name having count(*) >= 3 order by n desc limit 3) s;
    if v_n > 0 then
      v_out := v_out || jsonb_build_object('key', 'ins-teamlate:' || v_today || ':' || v_txt, 'type', 'ins-teamlate', 'priority', 2, 'mood', 'worried',
        'text', 'Late again and again this month: ' || v_txt || '. 3 lates is the final warning — the next ones cut salary.',
        'to', v_tab_team, 'label', 'Attendance');
    end if;

    -- H. leave tomorrow clashing with their due work
    for r in
      select e.name, l.start_date, l.end_date, count(t.id) n
      from public.leave_requests l join public.employees e on e.id = l.employee_id
      join public.tasks t on t.assigned_to = l.employee_id and t.archived_at is null and t.status in ('assigned','accepted','in_progress','revision_required','blocked')
        and t.due_date between v_today + 1 and l.end_date
      where l.employee_id = any(v_team) and l.status = 'approved' and l.start_date <= v_today + 1 and l.end_date >= v_today + 1
      group by e.name, l.start_date, l.end_date order by n desc limit 2
    loop
      v_out := v_out || jsonb_build_object('key', 'ins-leaveclash:' || r.name || ':' || v_today, 'type', 'ins-leaveclash', 'priority', 2, 'mood', 'think',
        'text', r.name || ' is on leave from ' || case when r.start_date <= v_today + 1 then 'tomorrow' else to_char(r.start_date, 'FMDay DD Mon') end
                || ' and ' || r.n || ' of their task' || case when r.n = 1 then ' is' else 's are' end || ' due while away. Reassign or bring the date forward?',
        'to', v_tab_tasks, 'label', 'Open tasks');
    end loop;

    -- I. overdue piles
    select string_agg(name || ' (' || n || ')', ', ' order by n desc), count(*) into v_txt, v_n from (
      select e.name, count(*) n from public.tasks t join public.employees e on e.id = t.assigned_to
      where t.assigned_to = any(v_team) and t.archived_at is null and t.status in ('assigned','accepted','in_progress','revision_required','blocked') and t.due_date < v_today
      group by e.name having count(*) >= 2 order by n desc limit 3) s;
    if v_n > 0 then
      v_out := v_out || jsonb_build_object('key', 'ins-overdue:' || v_today || ':' || v_txt, 'type', 'ins-overdue', 'priority', 2, 'mood', 'worried',
        'text', 'Overdue work is piling up: ' || v_txt || '.', 'to', v_tab_tasks, 'label', 'Open tasks');
    end if;

    -- J. hand-ins waiting more than a day for me
    select count(*) into v_n from public.tasks t
    where t.status = 'awaiting_review' and t.archived_at is null and t.submitted_at < now() - interval '24 hours'
      and (v_admin or t.assigned_by = v_emp);
    if v_n > 0 then
      v_out := v_out || jsonb_build_object('key', 'ins-waiting:' || v_today || ':' || v_n, 'type', 'ins-waiting', 'priority', 2, 'mood', 'point',
        'text', v_n || ' hand-in' || case when v_n = 1 then ' has' else 's have' end || ' waited more than a day for review. Quick approvals keep work moving.',
        'to', v_tab_tasks, 'label', 'Review');
    end if;

    -- K. meeting-heavy week
    select round(100.0 * sum(m) filter (where kind = 'meeting') / nullif(sum(m), 0)), sum(m) into v_n, v_amt from (
      select w.kind, extract(epoch from (coalesce(w.ended_at, now()) - w.started_at)) / 60 m from public.work_sessions w
      where w.employee_id = any(v_team) and w.started_at >= date_trunc('week', now())) s;
    if v_n >= 35 and v_amt >= 300 then
      v_out := v_out || jsonb_build_object('key', 'ins-meetings:' || v_today, 'type', 'ins-meetings', 'priority', 3, 'mood', 'think',
        'text', v_n || '% of the team’s tracked time this week went to meetings. Shorter or fewer meetings give more time for task work.',
        'to', case when v_admin then 'admin-worktime' else 'emp-team-time' end, 'label', 'Team time');
    end if;
  end if;

  -- ───────────── admin only ─────────────
  if v_admin then
    -- L. not checked in yet, past their on-time limit
    select string_agg(e.name, ', ' order by e.name), count(*) into v_txt, v_n
    from public.employees e cross join lateral (select private.day_rules(e.id, v_today) dr) x
    where e.status = 'active' and coalesce((x.dr->>'working_day')::boolean, false) and coalesce((x.dr->>'attendance')::boolean, true)
      and x.dr->>'late_after' is not null and (now() at time zone 'Asia/Kolkata')::time > (x.dr->>'late_after')::time
      and not exists (select 1 from public.attendance a where a.employee_id = e.id and a.date = v_today)
      and not exists (select 1 from public.leave_requests l where l.employee_id = e.id and l.status = 'approved' and l.start_date <= v_today and l.end_date >= v_today);
    if v_n > 0 and (now() at time zone 'Asia/Kolkata')::time < time '15:00' then
      v_out := v_out || jsonb_build_object('key', 'ins-notin:' || v_today || ':' || v_n, 'type', 'ins-notin', 'priority', 2, 'mood', 'think',
        'text', v_n || ' ' || case when v_n = 1 then 'person hasn’t' else 'people haven’t' end || ' checked in yet: ' || v_txt || '.',
        'to', 'admin-attendance', 'label', 'Attendance');
    end if;

    -- M. client money this week
    select coalesce(sum(amount + coalesce(tax_amount, 0) - coalesce(amount_paid, 0)) filter (where due_date between v_today and v_today + 7), 0),
           coalesce(sum(amount + coalesce(tax_amount, 0) - coalesce(amount_paid, 0)) filter (where due_date < v_today), 0),
           count(*) filter (where due_date < v_today)
      into v_amt, v_sal, v_n
    from public.payment_installments
    where deleted_at is null and coalesce(status_override, status) in ('Upcoming','Due','Partially Paid','Overdue');
    if v_amt > 0 or v_sal > 0 then
      v_out := v_out || jsonb_build_object('key', 'ins-money:' || v_today, 'type', 'ins-money', 'priority', case when v_sal > 0 then 1 else 2 end, 'mood', case when v_sal > 0 then 'worried' else 'point' end,
        'text', concat_ws(' ', case when v_amt > 0 then '₹' || to_char(v_amt, 'FM99,99,99,999') || ' is due from clients in the next 7 days.' end,
                  case when v_sal > 0 then v_n || ' milestone' || case when v_n = 1 then ' is' else 's are' end || ' overdue (₹' || to_char(v_sal, 'FM99,99,99,999') || ').' end),
        'to', 'admin-finance', 'label', 'Finance');
    end if;
    select count(*), coalesce(sum(amount), 0) into v_n, v_amt from public.payments where status = 'Submitted';
    if v_n > 0 then
      v_out := v_out || jsonb_build_object('key', 'ins-verify:' || v_today || ':' || v_n, 'type', 'ins-verify', 'priority', 2, 'mood', 'point',
        'text', v_n || ' client payment' || case when v_n = 1 then '' else 's' end || ' (₹' || to_char(v_amt, 'FM99,99,99,999') || ') waiting for you to verify — they don’t count until you do.',
        'to', 'admin-finance', 'label', 'Verify');
    end if;
  end if;

  return v_out;
end $$;
revoke all on function public.assistant_insights() from public, anon;
grant execute on function public.assistant_insights() to authenticated;
