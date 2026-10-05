-- v2_production_workflow_hardening
-- Fix mid-month payroll proration and provide full UPDATE payloads to Realtime.

CREATE OR REPLACE FUNCTION private.generate_payroll_internal(p_month date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
  eligible_days integer;
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
    select 1 from public.payroll_periods pp
    where pp.id=v_period_id and pp.status='finalized'
  ) then
    raise exception 'Payroll period is finalized';
  else
    update public.payroll_periods
    set divisor_mode=v_divisor_mode, day_divisor=v_divisor, updated_at=now()
    where id=v_period_id;
  end if;

  for emp in
    select e.* from public.employees e
    where e.join_date < next_p
      and (
        e.status='active'
        or exists(
          select 1 from public.salary_history sh0
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
    where l.employee_id=emp.id and l.period_start=p;

    unpaid:=coalesce(ledger.unpaid_used,0);

    if v_divisor_mode='working_days' then
      eligible_days:=0;
      d:=greatest(p,emp.join_date);
      while d<next_p loop
        is_working := extract(dow from d)<>0
          and not exists(select 1 from public.holidays h where h.date=d);
        if is_working then eligible_days:=eligible_days+1; end if;
        d:=d+1;
      end loop;
    else
      eligible_days:=greatest(0,(next_p-greatest(p,emp.join_date)));
    end if;

    daily_rate:=case when v_divisor>0 then salary/v_divisor else 0 end;
    deduction:=round(unpaid*daily_rate,2);
    final_pay:=greatest(
      0,
      round((salary*least(v_divisor,eligible_days)/v_divisor)-deduction,2)
    );

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

ALTER TABLE public.attendance REPLICA IDENTITY FULL;
ALTER TABLE public.break_events REPLICA IDENTITY FULL;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER TABLE public.leave_requests REPLICA IDENTITY FULL;
ALTER TABLE public.wfh_requests REPLICA IDENTITY FULL;
ALTER TABLE public.regularization_requests REPLICA IDENTITY FULL;
ALTER TABLE public.holidays REPLICA IDENTITY FULL;
ALTER TABLE public.payroll_periods REPLICA IDENTITY FULL;
ALTER TABLE public.payroll_records REPLICA IDENTITY FULL;
