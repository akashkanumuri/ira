-- SIGMA 1 — late login rule (agreed 2 Nov 2026)
--  * A late = check-in after the person's own start time + grace (private.late_minutes). Flexible / project-based are never late.
--  * Counted per calendar month from 1 Nov 2026, for everyone with a fixed start. No excusing, no exemptions.
--  * Lates 1–3: numbered warnings (no cut). 4th: half a day's salary. 5th and every later late: a full day each.
--  * A day is never cut more than one day in total (late + short/absent day together). Days with approved leave don't count.
--  * Employee is notified on every late; admins are notified when a cut applies.
-- Additive only: new columns default to "no cut"; October (finalized) is untouched.
set local lock_timeout = '5s';

alter table public.payroll_settings add column if not exists late_rule_enabled boolean not null default true;
alter table public.payroll_settings add column if not exists late_warnings integer not null default 3;
alter table public.payroll_settings add column if not exists late_from date not null default '2026-11-01';
do $$ begin
  alter table public.payroll_settings add constraint payroll_settings_late_warnings_check check (late_warnings between 0 and 10);
exception when duplicate_object then null; end $$;

alter table public.payroll_records add column if not exists late_count integer not null default 0;
alter table public.payroll_records add column if not exists late_days numeric(6,2) not null default 0;
alter table public.payroll_records add column if not exists late_deduction numeric(12,2) not null default 0;

-- Every counted late of one employee in one month, numbered, with its cut in days.
create or replace function private.late_marks(p_emp uuid, p_month date)
returns table(day date, check_in_at timestamptz, late_min integer, n integer, cut numeric, day_cap numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.payroll_settings;
  m0 date := date_trunc('month', p_month)::date;
  m1 date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  select * into s from public.payroll_settings where id;
  return query
  with d as (
    select x.date as day, x.check_in_at, x.check_out_at, x.working_seconds,
           private.late_minutes(p_emp, x.date, x.check_in_at) as lm
    from public.attendance_effective x
    where x.employee_id = p_emp and x.date >= m0 and x.date < m1 and x.date >= coalesce(s.late_from, m0)
      and x.check_in_at is not null
      and not exists (select 1 from public.leave_requests lr where lr.employee_id = p_emp and lr.status = 'approved'
                      and lr.start_date <= x.date and lr.end_date >= x.date)
  ), l as (
    select d.*, row_number() over (order by d.day)::int as rn from d where d.lm > 0
  )
  select l.day, l.check_in_at, l.lm, l.rn,
    case when not coalesce(s.late_rule_enabled, true) or l.rn <= coalesce(s.late_warnings, 3) then 0::numeric
         when l.rn = coalesce(s.late_warnings, 3) + 1 then 0.5::numeric
         else 1::numeric end,
    -- what is left of this day after a short/absent-day cut (so one day is never cut more than once)
    greatest(0::numeric, 1 - case
      when l.check_out_at is null then 0
      when coalesce((dr.r->>'absent_below_minutes')::int, 0) > 0 and coalesce(l.working_seconds, 0) / 60 < (dr.r->>'absent_below_minutes')::int then 1
      when coalesce((dr.r->>'half_day_minutes')::int, 0) > 0 and coalesce(l.working_seconds, 0) / 60 < (dr.r->>'half_day_minutes')::int then 0.5
      else 0 end)
  from l cross join lateral (select private.day_rules(p_emp, l.day) as r) dr
  order by l.day;
end $$;
revoke all on function private.late_marks(uuid, date) from public, anon, authenticated;

-- Late status for one person and month: used by the employee screens, the admin payroll breakdown and team views.
create or replace function public.late_status(p_employee_id uuid default null, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp uuid := coalesce(p_employee_id, private.current_employee_id());
  v_month date := date_trunc('month', coalesce(p_month, private.today_ist()))::date;
  v_self boolean; v_admin boolean := private.is_admin();
  s public.payroll_settings; v_salary numeric; v_rate numeric; v_days int;
  v_marks jsonb; v_count int; v_cut numeric; v_dr jsonb;
begin
  perform private.require(v_emp is not null, 'Employee not found');
  v_self := v_emp = private.current_employee_id();
  perform private.require(v_self or v_admin or private.is_manager_of(v_emp), 'Not allowed');
  select * into s from public.payroll_settings where id;
  v_days := extract(day from (v_month + interval '1 month' - interval '1 day'))::int;
  if v_self or v_admin then
    select sh.monthly_salary into v_salary from public.salary_history sh
    where sh.employee_id = v_emp and sh.effective_from <= (v_month + interval '1 month' - interval '1 day')::date
      and (sh.effective_to is null or sh.effective_to >= v_month)
    order by sh.effective_from desc limit 1;
    v_rate := coalesce(v_salary, 0) / v_days;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', m.day, 'check_in', m.check_in_at, 'late_min', m.late_min, 'n', m.n,
           'cut', least(m.cut, m.day_cap),
           'kind', case when m.cut = 0 then 'warning' when m.cut = 0.5 then 'half' else 'full' end,
           'amount', case when v_rate is not null then round(least(m.cut, m.day_cap) * v_rate, 2) end) order by m.day), '[]'::jsonb),
         count(*), coalesce(sum(least(m.cut, m.day_cap)), 0)
    into v_marks, v_count, v_cut
  from private.late_marks(v_emp, v_month) m;
  v_dr := private.day_rules(v_emp, private.today_ist());
  return jsonb_build_object(
    'month', v_month, 'enabled', coalesce(s.late_rule_enabled, true), 'warnings', coalesce(s.late_warnings, 3), 'from', s.late_from,
    'count', v_count, 'cut_days', v_cut,
    'daily_rate', round(v_rate, 2), 'cut_amount', case when v_rate is not null then round(v_cut * v_rate, 2) end,
    'next_n', v_count + 1,
    'next_cut', case when not coalesce(s.late_rule_enabled, true) or v_count + 1 <= coalesce(s.late_warnings, 3) then 0
                     when v_count + 1 = coalesce(s.late_warnings, 3) + 1 then 0.5 else 1 end,
    'late_after', v_dr->>'late_after',
    'never_late', v_dr->>'late_after' is null,
    'marks', v_marks);
end $$;
revoke all on function public.late_status(uuid, date) from public, anon;
grant execute on function public.late_status(uuid, date) to authenticated;

-- Late counts for everyone the caller may see (admin: all; manager: direct reports). No money for managers.
create or replace function public.late_team(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_month date := date_trunc('month', coalesce(p_month, private.today_ist()))::date; v_admin boolean := private.is_admin(); v_me uuid := private.current_employee_id();
begin
  perform private.require(v_admin or v_me is not null, 'Not allowed');
  return coalesce((
    select jsonb_agg(jsonb_build_object('employee_id', e.id, 'name', e.name, 'count', x.cnt, 'cut_days', x.cut,
             'dates', x.dates) order by x.cnt desc, e.name)
    from public.employees e
    cross join lateral (
      select count(*)::int as cnt, coalesce(sum(least(m.cut, m.day_cap)), 0) as cut,
             coalesce(jsonb_agg(jsonb_build_object('date', m.day, 'n', m.n, 'late_min', m.late_min, 'cut', least(m.cut, m.day_cap)) order by m.day), '[]'::jsonb) as dates
      from private.late_marks(e.id, v_month) m) x
    where e.status = 'active' and x.cnt > 0
      and (v_admin or e.manager_id = v_me)), '[]'::jsonb);
end $$;
revoke all on function public.late_team(date) from public, anon;
grant execute on function public.late_team(date) to authenticated;

-- Notify on every late check-in: warnings 1..N to the employee; cuts to the employee and admins.
create or replace function private.notify_late_checkin()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  s public.payroll_settings; v_profile uuid; v_n int; v_min int; v_who text; v_month text; v_title text; v_msg text; w int;
begin
  if coalesce(current_setting('ira.regularization', true), 'off') = 'on' then return NEW; end if;
  if NEW.check_in_at is null then return NEW; end if;
  select * into s from public.payroll_settings where id;
  if not coalesce(s.late_rule_enabled, true) or NEW.date < coalesce(s.late_from, NEW.date) then return NEW; end if;
  v_min := private.late_minutes(NEW.employee_id, NEW.date, NEW.check_in_at);
  if v_min <= 0 then return NEW; end if;
  select m.n into v_n from private.late_marks(NEW.employee_id, NEW.date) m where m.day = NEW.date;
  if v_n is null then return NEW; end if;
  w := coalesce(s.late_warnings, 3);
  v_month := to_char(NEW.date, 'FMMonth');
  select profile_id into v_profile from public.employees where id = NEW.employee_id;
  if v_n < w then
    v_title := 'Late warning ' || v_n || ' of ' || w;
    v_msg := 'Checked in at ' || private.ist_time(NEW.check_in_at) || ', ' || v_min || ' min late. '
             || (w - v_n) || ' warning' || case when w - v_n = 1 then '' else 's' end || ' left in ' || v_month || ' before salary is cut.';
  elsif v_n = w then
    v_title := 'Final late warning (' || v_n || ' of ' || w || ')';
    v_msg := 'Checked in at ' || private.ist_time(NEW.check_in_at) || ', ' || v_min || ' min late. Your next late in ' || v_month || ' cuts half a day''s salary.';
  elsif v_n = w + 1 then
    v_title := 'Late: half-day salary cut';
    v_msg := 'Late #' || v_n || ' in ' || v_month || ' (checked in ' || private.ist_time(NEW.check_in_at) || ', ' || v_min || ' min late). Half a day''s salary will be deducted. Every further late this month cuts a full day.';
  else
    v_title := 'Late: full-day salary cut';
    v_msg := 'Late #' || v_n || ' in ' || v_month || ' (checked in ' || private.ist_time(NEW.check_in_at) || ', ' || v_min || ' min late). A full day''s salary will be deducted.';
  end if;
  if v_profile is not null then
    perform private.notify(v_profile, 'attendance', v_title, v_msg, '/emp-attendance', 'late_' || NEW.id,
      jsonb_build_object('late_n', v_n, 'late_min', v_min, 'date', NEW.date));
  end if;
  if v_n > w then
    v_who := private.employee_label(NEW.employee_id);
    perform private.notify_admins_activity('checkin', v_who || ': ' || lower(v_title),
      'Late #' || v_n || ' in ' || v_month || ' · ' || private.ist_time(NEW.check_in_at) || ', ' || v_min || ' min late',
      '/admin-attendance', 'late_admin_' || NEW.id, jsonb_build_object('employee_id', NEW.employee_id, 'late_n', v_n));
  end if;
  return NEW;
exception when others then
  return NEW;  -- a notification problem must never block a check-in
end $$;

drop trigger if exists trg_notify_late_checkin on public.attendance;
create trigger trg_notify_late_checkin after insert on public.attendance
  for each row execute function private.notify_late_checkin();

-- Payroll: add the late cut next to unpaid leave and absent days.
create or replace function private.generate_payroll_internal(p_month date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p date := date_trunc('month',p_month)::date; next_p date := (p + interval '1 month')::date;
  v_period_id uuid; emp record; salary numeric; ledger public.leave_ledger%rowtype; v_divisor integer; daily_rate numeric;
  unpaid numeric; deduction numeric; absent numeric; absent_ded numeric; final_pay numeric; working_days integer; eligible_days integer;
  d date; is_working boolean; v_divisor_mode text; v_absent_from date; v_end date; v_eng date;
  v_late_count integer; v_late_days numeric; v_late_ded numeric;
begin
  perform private.ensure_leave_ledgers((next_p - 1)::date);
  select s.divisor_mode, s.absent_from into v_divisor_mode, v_absent_from from public.payroll_settings s where s.id=true;
  if v_divisor_mode='working_days' then
    working_days:=0; d:=p;
    while d<next_p loop
      is_working := extract(dow from d)<>0 and not exists(select 1 from public.holidays h where h.date=d);
      if is_working then working_days:=working_days+1; end if;
      d:=d+1;
    end loop;
    v_divisor:=greatest(1,working_days);
  else
    v_divisor:=extract(day from (next_p - interval '1 day'))::integer;
  end if;
  select pp.id into v_period_id from public.payroll_periods pp where pp.month_start=p;
  if v_period_id is null then
    insert into public.payroll_periods(month_start,divisor_mode,day_divisor,status) values(p,v_divisor_mode,v_divisor,'draft') returning id into v_period_id;
  elsif exists(select 1 from public.payroll_periods pp where pp.id=v_period_id and pp.status='finalized') then
    raise exception 'Payroll period is finalized';
  else
    update public.payroll_periods set divisor_mode=v_divisor_mode, day_divisor=v_divisor, updated_at=now() where id=v_period_id;
  end if;
  for emp in
    select e.* from public.employees e
    where e.join_date < next_p and (e.status='active'
        or exists(select 1 from public.salary_history sh0 where sh0.employee_id=e.id and sh0.effective_from < next_p and (sh0.effective_to is null or sh0.effective_to >= p))
        or exists(select 1 from public.payroll_records pr0 join public.payroll_periods pp0 on pp0.id=pr0.period_id where pr0.employee_id=e.id and pp0.month_start=p))
    order by e.name
  loop
    select sh.monthly_salary into salary from public.salary_history sh
    where sh.employee_id=emp.id and sh.effective_from<next_p and (sh.effective_to is null or sh.effective_to>=p) order by sh.effective_from desc limit 1;
    salary:=coalesce(salary,0);
    select * into ledger from public.leave_ledger l where l.employee_id=emp.id and l.period_start=p;
    unpaid:=coalesce(ledger.unpaid_used,0);
    v_eng := (private.work_rules_on(emp.id, (next_p - 1))).engagement_end;
    v_end := case when v_eng is not null and v_eng < next_p then v_eng + 1 else next_p end;
    if v_divisor_mode='working_days' then
      eligible_days:=0; d:=greatest(p,emp.join_date);
      while d<v_end loop
        is_working := extract(dow from d)<>0 and not exists(select 1 from public.holidays h where h.date=d);
        if is_working then eligible_days:=eligible_days+1; end if;
        d:=d+1;
      end loop;
    else
      eligible_days:=greatest(0,(v_end-greatest(p,emp.join_date)));
    end if;
    daily_rate:=case when v_divisor>0 then salary/v_divisor else 0 end;
    deduction:=round(unpaid*daily_rate,2);
    absent := 0;
    if salary > 0 then
      absent := private.payroll_absent_days(emp.id, greatest(p, emp.join_date, coalesce(v_absent_from, p)), least(v_end - 1, private.today_ist() - 1));
    end if;
    absent_ded := round(absent*daily_rate,2);
    select count(*)::int, coalesce(sum(least(m.cut, m.day_cap)), 0) into v_late_count, v_late_days
    from private.late_marks(emp.id, p) m where m.day < v_end;
    v_late_ded := case when salary > 0 then round(v_late_days*daily_rate,2) else 0 end;
    final_pay:=greatest(0, round((salary*least(v_divisor,eligible_days)/v_divisor)-deduction-absent_ded-v_late_ded,2));
    insert into public.payroll_records(period_id,employee_id,salary_snapshot,paid_leave_days,unpaid_leave_days,daily_rate,leave_deduction,
      absent_days,absent_deduction,late_count,late_days,late_deduction,final_pay)
    values(v_period_id,emp.id,salary,coalesce(ledger.paid_used,0),unpaid,daily_rate,deduction,absent,absent_ded,v_late_count,v_late_days,v_late_ded,final_pay)
    on conflict(period_id,employee_id) do update
    set salary_snapshot=excluded.salary_snapshot, paid_leave_days=excluded.paid_leave_days, unpaid_leave_days=excluded.unpaid_leave_days,
        daily_rate=excluded.daily_rate, leave_deduction=excluded.leave_deduction, absent_days=excluded.absent_days,
        absent_deduction=excluded.absent_deduction, late_count=excluded.late_count, late_days=excluded.late_days,
        late_deduction=excluded.late_deduction, final_pay=excluded.final_pay, updated_at=now();
  end loop;
  return v_period_id;
end;
$$;
