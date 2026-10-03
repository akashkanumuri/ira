-- IRA V2 production hardening:
-- 1) Keep the public holiday calendar visible in the employee calendar.
-- 2) Remove the ambiguous legacy create_task overload.
-- 3) Make historical payroll generation select employees whose employment/salary
--    actually overlaps the selected payroll month, including inactive employees
--    with historical salary records.

insert into public.holidays (name, date, description, holiday_type)
values
  ('New Year', '2026-01-01', 'Telangana State Portal calendar 2026', 'public'),
  ('Bhogi', '2026-01-14', 'Telangana State Portal calendar 2026', 'public'),
  ('Sankranti / Pongal', '2026-01-15', 'Telangana State Portal calendar 2026', 'public'),
  ('Kanumu', '2026-01-16', 'Telangana State Portal calendar 2026', 'public'),
  ('Republic Day', '2026-01-26', 'Telangana State Portal calendar 2026', 'public'),
  ('Holi', '2026-03-03', 'Telangana State Portal calendar 2026', 'public'),
  ('Ugadi', '2026-03-19', 'Telangana State Portal calendar 2026', 'public'),
  ('Eid-ul-Fitr', '2026-03-21', 'Telangana State Portal calendar 2026', 'public'),
  ('Following day of Eid-ul-Fitr', '2026-03-22', 'Telangana State Portal calendar 2026', 'public'),
  ('Sri Rama Navami', '2026-03-27', 'Telangana State Portal calendar 2026', 'public'),
  ('Good Friday', '2026-04-03', 'Telangana State Portal calendar 2026', 'public'),
  ('Dr. B.R. Ambedkar Birthday', '2026-04-14', 'Telangana State Portal calendar 2026', 'public'),
  ('Buddha Purnima', '2026-05-01', 'Telangana State Portal calendar 2026', 'public'),
  ('Eid-ul-Adha (Bakrid)', '2026-05-27', 'Telangana State Portal calendar 2026', 'public'),
  ('Moharram', '2026-06-26', 'Telangana State Portal calendar 2026', 'public'),
  ('Ratha Yathra', '2026-07-16', 'Telangana State Portal calendar 2026', 'public'),
  ('Bonalu', '2026-08-10', 'Telangana State Portal calendar 2026', 'public'),
  ('Independence Day', '2026-08-15', 'Telangana State Portal calendar 2026', 'public'),
  ('Eid Milad-un-Nabi', '2026-08-26', 'Telangana State Portal calendar 2026', 'public'),
  ('Sravana Purnima / Rakhi Purnimi', '2026-08-28', 'Telangana State Portal calendar 2026', 'public'),
  ('Sri Krishnashtami', '2026-09-04', 'Telangana State Portal calendar 2026', 'public'),
  ('Vinayaka Chavithi', '2026-09-14', 'Telangana State Portal calendar 2026', 'public'),
  ('Mahatma Gandhi Jayanthi', '2026-10-02', 'Telangana State Portal calendar 2026', 'public'),
  ('Saddula Bathukamma', '2026-10-18', 'Telangana State Portal calendar 2026', 'public'),
  ('Maharnavami', '2026-10-19', 'Telangana State Portal calendar 2026', 'public'),
  ('Vijaya Dasami', '2026-10-20', 'Telangana State Portal calendar 2026', 'public'),
  ('Following day of Vijaya Dasami', '2026-10-21', 'Telangana State Portal calendar 2026', 'public'),
  ('Birthday of Hazrath Syed Mohd. Juvanpuri', '2026-10-26', 'Telangana State Portal calendar 2026', 'public'),
  ('Naraka Chathurdhi / Deepavali', '2026-11-08', 'Telangana State Portal calendar 2026', 'public'),
  ('Karthika Pournami', '2026-11-24', 'Telangana State Portal calendar 2026', 'public'),
  ('Christmas Eve', '2026-12-24', 'Telangana State Portal calendar 2026', 'public'),
  ('Christmas', '2026-12-25', 'Telangana State Portal calendar 2026', 'public'),
  ('Boxing Day / Hazrath Ali Birthday', '2026-12-26', 'Telangana State Portal calendar 2026', 'public')
on conflict (date) do nothing;

drop function if exists public.create_task(text,text,uuid,date,date,text);

create or replace function private.generate_payroll_internal(p_month date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  p date := date_trunc('month',p_month)::date;
  next_p date := (p + interval '1 month')::date;
  v_period_id uuid;
  emp record;
  salary numeric;
  ledger public.leave_ledger%rowtype;
  v_divisor integer;
  daily_rate numeric;
  unpaid numeric;
  deduction numeric;
  final_pay numeric;
  working_days integer;
  d date;
  is_working boolean;
  v_divisor_mode text;
begin
  perform private.ensure_leave_ledgers((next_p - 1)::date);

  select s.divisor_mode into v_divisor_mode
  from public.payroll_settings s
  where s.id=true;

  if v_divisor_mode='working_days' then
    working_days:=0;
    d:=p;
    while d<next_p loop
      is_working := extract(dow from d)<>0
        and not exists(select 1 from public.holidays h where h.date=d);
      if is_working then working_days:=working_days+1; end if;
      d:=d+1;
    end loop;
    v_divisor:=greatest(1,working_days);
  else
    v_divisor:=extract(day from (next_p - interval '1 day'))::integer;
  end if;

  select pp.id into v_period_id
  from public.payroll_periods pp
  where pp.month_start=p;

  if v_period_id is null then
    insert into public.payroll_periods(month_start,divisor_mode,day_divisor,status)
    values(p,v_divisor_mode,v_divisor,'draft')
    returning id into v_period_id;
  elsif exists(
    select 1
    from public.payroll_periods pp
    where pp.id=v_period_id and pp.status='finalized'
  ) then
    raise exception 'Payroll period is finalized';
  else
    update public.payroll_periods
    set divisor_mode=v_divisor_mode,
        day_divisor=v_divisor,
        updated_at=now()
    where id=v_period_id;
  end if;

  for emp in
    select e.*
    from public.employees e
    where e.join_date < next_p
      and (
        e.status='active'
        or exists(
          select 1
          from public.salary_history sh0
          where sh0.employee_id=e.id
            and sh0.effective_from < next_p
            and (sh0.effective_to is null or sh0.effective_to >= p)
        )
        or exists(
          select 1
          from public.payroll_records pr0
          join public.payroll_periods pp0 on pp0.id=pr0.period_id
          where pr0.employee_id=e.id and pp0.month_start=p
        )
      )
    order by e.name
  loop
    select sh.monthly_salary into salary
    from public.salary_history sh
    where sh.employee_id=emp.id
      and sh.effective_from<next_p
      and (sh.effective_to is null or sh.effective_to>=p)
    order by sh.effective_from desc
    limit 1;

    salary:=coalesce(salary,0);

    select * into ledger
    from public.leave_ledger l
    where l.employee_id=emp.id
      and l.period_start=p;

    unpaid:=coalesce(ledger.unpaid_used,0);
    daily_rate:=case when v_divisor>0 then salary/v_divisor else 0 end;
    deduction:=round(unpaid*daily_rate,2);
    final_pay:=greatest(0,round(salary-deduction,2));

    insert into public.payroll_records(
      period_id,employee_id,salary_snapshot,paid_leave_days,
      unpaid_leave_days,daily_rate,leave_deduction,final_pay
    )
    values(
      v_period_id,emp.id,salary,coalesce(ledger.paid_used,0),
      unpaid,daily_rate,deduction,final_pay
    )
    on conflict(period_id,employee_id) do update
    set salary_snapshot=excluded.salary_snapshot,
        paid_leave_days=excluded.paid_leave_days,
        unpaid_leave_days=excluded.unpaid_leave_days,
        daily_rate=excluded.daily_rate,
        leave_deduction=excluded.leave_deduction,
        final_pay=excluded.final_pay,
        updated_at=now();
  end loop;

  return v_period_id;
end;
$function$;

revoke all on function private.generate_payroll_internal(date) from public;
grant execute on function private.generate_payroll_internal(date) to postgres;
