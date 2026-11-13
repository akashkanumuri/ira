-- SIGMA 1 — bonus, PIP and termination review. Additive only.
-- SIGMA never changes anyone's job or pay by itself: it computes the numbers, raises a card, and the
-- admin approves or dismisses it. Every threshold and amount lives in performance_rules (Settings).

-- 1. The rules (one row, editable by the admin in Settings → Bonus & PIP).
create table if not exists public.performance_rules (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  start_month date not null default date '2026-11-01',
  attendance_bonus_amount numeric not null default 500 check (attendance_bonus_amount >= 0),
  attendance_streak_days int not null default 60 check (attendance_streak_days between 1 and 366),
  performance_bonus_amount numeric not null default 2500 check (performance_bonus_amount >= 0),
  performance_bonus_min_rate numeric not null default 90 check (performance_bonus_min_rate between 0 and 100),
  min_activity int not null default 5 check (min_activity between 0 and 100),
  pip_first_draft_below numeric not null default 70 check (pip_first_draft_below between 0 and 100),
  warn_first_draft_below numeric not null default 80 check (warn_first_draft_below between 0 and 100),
  pip_late_handins_over int not null default 5 check (pip_late_handins_over >= 0),
  pip_on_time_below numeric not null default 70 check (pip_on_time_below between 0 and 100),
  warn_on_time_below numeric not null default 80 check (warn_on_time_below between 0 and 100),
  pip_overdue_over int not null default 10 check (pip_overdue_over >= 0),
  warn_overdue_from int not null default 5 check (warn_overdue_from >= 0),
  pip_draft_on_time_below numeric not null default 70 check (pip_draft_on_time_below between 0 and 100),
  warn_draft_on_time_below numeric not null default 80 check (warn_draft_on_time_below between 0 and 100),
  pip_days int not null default 60 check (pip_days between 1 and 365),
  termination_pip_count int not null default 3 check (termination_pip_count >= 1),
  termination_window_months int not null default 12 check (termination_window_months between 1 and 60),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.performance_rules (id) values (true) on conflict (id) do nothing;
alter table public.performance_rules enable row level security;
drop policy if exists performance_rules_read on public.performance_rules;
create policy performance_rules_read on public.performance_rules for select to authenticated using (true);
-- Writes only through performance_rules_save (admin).

-- 2. What the rules produced: bonus, PIP, warning and termination-review cards.
create table if not exists public.performance_flags (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  month date not null,
  kind text not null check (kind in ('attendance_bonus','performance_bonus','pip','warning','termination_review')),
  amount numeric,
  reasons jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','dismissed','recorded')),
  payout text check (payout in ('payslip','gift_card')),
  pip_ends_on date,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  unique (employee_id, month, kind)
);
create index if not exists performance_flags_status on public.performance_flags (status, created_at desc);
alter table public.performance_flags enable row level security;
drop policy if exists performance_flags_read on public.performance_flags;
create policy performance_flags_read on public.performance_flags for select to authenticated using (
  private.is_admin()
  or employee_id = private.current_employee_id()
  or exists (select 1 from public.employees e where e.id = performance_flags.employee_id and e.manager_id = private.current_employee_id())
);
-- Writes only through the functions below.

-- 3. The numbers for one person and one month.
create or replace function private.performance_metrics(p_emp uuid, p_month date)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare
  m0 date := date_trunc('month', p_month)::date;
  m1 date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_handins int; v_late int; v_ontime_drafts int;
  v_first_decided int; v_first_ok int;
  v_done int; v_done_on_time int; v_overdue int;
  v_streak int := 0; d date; a record; v_leave boolean; v_hol boolean;
begin
  select count(*), count(*) filter (where not coalesce(dr.on_time, true)), count(*) filter (where coalesce(dr.on_time, true))
    into v_handins, v_late, v_ontime_drafts
    from public.task_drafts dr join public.tasks t on t.id = dr.task_id
   where t.assigned_to = p_emp and t.archived_at is null
     and (dr.submitted_at at time zone 'Asia/Kolkata')::date >= m0 and (dr.submitted_at at time zone 'Asia/Kolkata')::date < m1;

  select count(*), count(*) filter (where dr.decision = 'approved')
    into v_first_decided, v_first_ok
    from public.task_drafts dr join public.tasks t on t.id = dr.task_id
   where t.assigned_to = p_emp and t.archived_at is null and dr.draft_no = 1
     and dr.decision in ('approved','changes_requested')
     and (dr.decided_at at time zone 'Asia/Kolkata')::date >= m0 and (dr.decided_at at time zone 'Asia/Kolkata')::date < m1;

  -- Tasks finished this month, and whether the work was handed in by the due date.
  select count(*),
         count(*) filter (where coalesce(
           (select min(dr.submitted_at) from public.task_drafts dr where dr.task_id = t.id), t.completed_at)
           at time zone 'Asia/Kolkata' < (t.due_date + 1))
    into v_done, v_done_on_time
    from public.tasks t
   where t.assigned_to = p_emp and t.archived_at is null and t.status = 'completed'
     and (t.completed_at at time zone 'Asia/Kolkata')::date >= m0 and (t.completed_at at time zone 'Asia/Kolkata')::date < m1;

  -- Tasks that went past their due date this month without being handed in on time.
  select count(*) into v_overdue
    from public.tasks t
   where t.assigned_to = p_emp and t.archived_at is null and t.status <> 'cancelled'
     and t.due_date >= m0 and t.due_date < m1 and t.due_date < v_today
     and coalesce((select min(dr.submitted_at) from public.task_drafts dr where dr.task_id = t.id), t.completed_at,
                  'infinity'::timestamptz) at time zone 'Asia/Kolkata' >= (t.due_date + 1);

  -- On-time attendance streak, counted back from the end of the month (or today).
  -- A late check-in or a missed weekday ends it; approved leave, holidays and Sundays pause it;
  -- a Saturday with no check-in is treated as a day off.
  d := least(m1 - 1, v_today);
  while d >= m0 - 400 loop
    select * into a from public.attendance where employee_id = p_emp and date = d limit 1;
    if a.id is not null and a.check_in_at is not null then
      exit when coalesce(private.late_minutes(p_emp, d, a.check_in_at), 0) > 0;
      v_streak := v_streak + 1;
    else
      select exists (select 1 from public.leave_requests l where l.employee_id = p_emp and l.status = 'approved' and d between l.start_date and l.end_date) into v_leave;
      select exists (select 1 from public.holidays h where h.date = d) into v_hol;
      if not (v_leave or v_hol or extract(isodow from d) in (6, 7) or d = v_today) then exit; end if;
    end if;
    d := d - 1;
  end loop;

  return jsonb_build_object(
    'handins', v_handins,
    'late_handins', v_late,
    'draft_on_time_rate', case when v_handins > 0 then round(100.0 * v_ontime_drafts / v_handins) end,
    'first_drafts_decided', v_first_decided,
    'first_draft_rate', case when v_first_decided > 0 then round(100.0 * v_first_ok / v_first_decided) end,
    'tasks_done', v_done,
    'on_time_rate', case when v_done > 0 then round(100.0 * v_done_on_time / v_done) end,
    'overdue', v_overdue,
    'attendance_streak', v_streak
  );
end $function$;

-- 4. Evaluate one month for everyone (or one person). Re-running is safe: cards are unique per
--    person, month and kind, and decided cards are never touched.
create or replace function public.performance_evaluate(p_month date, p_employee_id uuid default null)
 returns int language plpgsql security definer set search_path to ''
as $function$
declare
  r public.performance_rules;
  m0 date := date_trunc('month', p_month)::date;
  e record; m jsonb; v_reasons jsonb; v_warn jsonb; v_n int := 0; v_pips int;
  fd numeric; ot numeric; dot numeric; od int; lh int; act int;
begin
  perform private.require(private.is_admin() or current_user in ('postgres','supabase_admin'), 'Admin only');
  select * into r from public.performance_rules where id;
  if not r.enabled or m0 < r.start_month then return 0; end if;

  for e in select id from public.employees where status = 'active' and (p_employee_id is null or id = p_employee_id) loop
    m := private.performance_metrics(e.id, m0);
    fd := (m->>'first_draft_rate')::numeric; ot := (m->>'on_time_rate')::numeric; dot := (m->>'draft_on_time_rate')::numeric;
    od := (m->>'overdue')::int; lh := (m->>'late_handins')::int;
    act := greatest((m->>'handins')::int, (m->>'tasks_done')::int);

    -- Bonuses
    if (m->>'attendance_streak')::int >= r.attendance_streak_days
       and not exists (select 1 from public.performance_flags f where f.employee_id = e.id and f.kind = 'attendance_bonus'
                        and f.status in ('pending','approved') and f.month > m0 - make_interval(days => r.attendance_streak_days)) then
      insert into public.performance_flags (employee_id, month, kind, amount, reasons, metrics)
      values (e.id, m0, 'attendance_bonus', r.attendance_bonus_amount,
              jsonb_build_array(format('%s working days in a row on time', m->>'attendance_streak')), m)
      on conflict do nothing;
      v_n := v_n + 1;
    end if;
    if fd is not null and fd > r.performance_bonus_min_rate and (m->>'first_drafts_decided')::int >= r.min_activity then
      insert into public.performance_flags (employee_id, month, kind, amount, reasons, metrics)
      values (e.id, m0, 'performance_bonus', r.performance_bonus_amount,
              jsonb_build_array(format('First-draft approval %s%% (above %s%%)', fd, r.performance_bonus_min_rate)), m)
      on conflict do nothing;
      v_n := v_n + 1;
    end if;

    -- PIP and warnings (only when there was enough work to judge)
    v_reasons := '[]'::jsonb; v_warn := '[]'::jsonb;
    if act >= r.min_activity then
      if fd is not null and fd < r.pip_first_draft_below then v_reasons := v_reasons || to_jsonb(format('First-draft approval %s%% (below %s%%)', fd, r.pip_first_draft_below));
      elsif fd is not null and fd < r.warn_first_draft_below then v_warn := v_warn || to_jsonb(format('First-draft approval %s%%', fd)); end if;
      if ot is not null and ot < r.pip_on_time_below then v_reasons := v_reasons || to_jsonb(format('Tasks on time %s%% (below %s%%)', ot, r.pip_on_time_below));
      elsif ot is not null and ot < r.warn_on_time_below then v_warn := v_warn || to_jsonb(format('Tasks on time %s%%', ot)); end if;
      if dot is not null and dot < r.pip_draft_on_time_below then v_reasons := v_reasons || to_jsonb(format('Drafts on time %s%% (below %s%%)', dot, r.pip_draft_on_time_below));
      elsif dot is not null and dot < r.warn_draft_on_time_below then v_warn := v_warn || to_jsonb(format('Drafts on time %s%%', dot)); end if;
      if lh > r.pip_late_handins_over then v_reasons := v_reasons || to_jsonb(format('%s late hand-ins (more than %s)', lh, r.pip_late_handins_over)); end if;
    end if;
    if od > r.pip_overdue_over then v_reasons := v_reasons || to_jsonb(format('%s tasks went overdue (more than %s)', od, r.pip_overdue_over));
    elsif od >= r.warn_overdue_from and od > 0 then v_warn := v_warn || to_jsonb(format('%s tasks went overdue', od)); end if;

    if jsonb_array_length(v_reasons) > 0 then
      insert into public.performance_flags (employee_id, month, kind, reasons, metrics)
      values (e.id, m0, 'pip', v_reasons, m) on conflict do nothing;
      v_n := v_n + 1;
    elsif jsonb_array_length(v_warn) > 0 then
      insert into public.performance_flags (employee_id, month, kind, reasons, metrics, status)
      values (e.id, m0, 'warning', v_warn, m, 'recorded') on conflict do nothing;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $function$;

-- 5. Admin decision on a card.
create or replace function public.performance_decide(p_flag_id uuid, p_decision text, p_note text default null, p_payout text default null)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare f public.performance_flags; r public.performance_rules; v_pips int; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.require(private.is_admin(), 'Admin only');
  select * into f from public.performance_flags where id = p_flag_id for update;
  perform private.require(found, 'Not found');
  perform private.require(f.status = 'pending', 'Already decided');
  perform private.require(p_decision in ('approved','dismissed'), 'Approve or dismiss');
  perform private.require(p_decision = 'approved' or v_note is not null, 'Give a reason for dismissing');
  if p_decision = 'approved' and f.kind in ('attendance_bonus','performance_bonus') then
    perform private.require(p_payout in ('payslip','gift_card'), 'Choose payslip or gift card');
  end if;
  select * into r from public.performance_rules where id;
  update public.performance_flags set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = v_note,
         payout = case when kind in ('attendance_bonus','performance_bonus') and p_decision = 'approved' then p_payout end,
         pip_ends_on = case when kind = 'pip' and p_decision = 'approved' then (now() at time zone 'Asia/Kolkata')::date + r.pip_days end
   where id = f.id;

  -- More than N approved PIPs in the window → a termination review card.
  if f.kind = 'pip' and p_decision = 'approved' then
    select count(*) into v_pips from public.performance_flags
     where employee_id = f.employee_id and kind = 'pip' and status = 'approved'
       and decided_at > now() - make_interval(months => r.termination_window_months);
    if v_pips > r.termination_pip_count then
      insert into public.performance_flags (employee_id, month, kind, reasons)
      values (f.employee_id, f.month, 'termination_review', jsonb_build_array(format('%s PIPs in %s months', v_pips, r.termination_window_months)))
      on conflict do nothing;
    end if;
  end if;
end $function$;

-- 6. Save the rules (admin).
create or replace function public.performance_rules_save(p jsonb)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  perform private.require(private.is_admin(), 'Admin only');
  update public.performance_rules set
    enabled = coalesce((p->>'enabled')::boolean, enabled),
    attendance_bonus_amount = coalesce((p->>'attendance_bonus_amount')::numeric, attendance_bonus_amount),
    attendance_streak_days = coalesce((p->>'attendance_streak_days')::int, attendance_streak_days),
    performance_bonus_amount = coalesce((p->>'performance_bonus_amount')::numeric, performance_bonus_amount),
    performance_bonus_min_rate = coalesce((p->>'performance_bonus_min_rate')::numeric, performance_bonus_min_rate),
    min_activity = coalesce((p->>'min_activity')::int, min_activity),
    pip_first_draft_below = coalesce((p->>'pip_first_draft_below')::numeric, pip_first_draft_below),
    warn_first_draft_below = coalesce((p->>'warn_first_draft_below')::numeric, warn_first_draft_below),
    pip_late_handins_over = coalesce((p->>'pip_late_handins_over')::int, pip_late_handins_over),
    pip_on_time_below = coalesce((p->>'pip_on_time_below')::numeric, pip_on_time_below),
    warn_on_time_below = coalesce((p->>'warn_on_time_below')::numeric, warn_on_time_below),
    pip_overdue_over = coalesce((p->>'pip_overdue_over')::int, pip_overdue_over),
    warn_overdue_from = coalesce((p->>'warn_overdue_from')::int, warn_overdue_from),
    pip_draft_on_time_below = coalesce((p->>'pip_draft_on_time_below')::numeric, pip_draft_on_time_below),
    warn_draft_on_time_below = coalesce((p->>'warn_draft_on_time_below')::numeric, warn_draft_on_time_below),
    pip_days = coalesce((p->>'pip_days')::int, pip_days),
    termination_pip_count = coalesce((p->>'termination_pip_count')::int, termination_pip_count),
    termination_window_months = coalesce((p->>'termination_window_months')::int, termination_window_months),
    updated_at = now(), updated_by = auth.uid()
  where id;
end $function$;

-- 7. Live numbers: my own, or (for admin / a manager) one person's.
create or replace function public.performance_numbers(p_employee_id uuid default null, p_month date default null)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v_emp uuid := coalesce(p_employee_id, private.current_employee_id());
begin
  perform private.require(v_emp is not null, 'No employee');
  perform private.require(private.is_admin() or v_emp = private.current_employee_id()
    or exists (select 1 from public.employees e where e.id = v_emp and e.manager_id = private.current_employee_id()), 'Not allowed');
  return private.performance_metrics(v_emp, coalesce(p_month, (now() at time zone 'Asia/Kolkata')::date));
end $function$;

revoke all on function public.performance_evaluate(date, uuid) from public, anon;
revoke all on function public.performance_decide(uuid, text, text, text) from public, anon;
revoke all on function public.performance_rules_save(jsonb) from public, anon;
revoke all on function public.performance_numbers(uuid, date) from public, anon;
grant execute on function public.performance_evaluate(date, uuid) to authenticated;
grant execute on function public.performance_decide(uuid, text, text, text) to authenticated;
grant execute on function public.performance_rules_save(jsonb) to authenticated;
grant execute on function public.performance_numbers(uuid, date) to authenticated;

-- 8. Run on the 1st of every month at 06:00 IST for the month just ended.
do $$ begin
  perform cron.unschedule('performance-monthly') where exists (select 1 from cron.job where jobname = 'performance-monthly');
  perform cron.schedule('performance-monthly', '30 0 1 * *',
    $c$select public.performance_evaluate(((now() at time zone 'Asia/Kolkata') - interval '1 month')::date)$c$);
end $$;
