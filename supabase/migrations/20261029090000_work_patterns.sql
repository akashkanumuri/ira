-- SIGMA 1 — work patterns, step 1 (foundation).
-- How someone works is set per person and dated: employee_work_rules holds one row per change (effective_from).
-- private.day_rules(employee, date) is the single answer to "what are this person's rules on this date?" and is what
-- check-in, late/absent, leave, payroll and reports move onto in steps 2–4.
-- Legacy columns employees.work_mode / shift_start / shift_end are kept in sync so everything that reads them today
-- keeps working unchanged. Existing employees get a "Standard office" row built from their current settings.

-- ---------------------------------------------------------------- per-employee rules (dated)
create table if not exists public.employee_work_rules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  effective_from date not null,

  -- 1. employment
  employment_type text not null default 'full_time' check (employment_type in ('full_time','part_time','intern','freelancer','project_based')),
  probation_end date,
  engagement_end date,
  project_ids uuid[] not null default '{}',
  access_end_mode text not null default 'never' check (access_end_mode in ('never','end_date','project_close')),

  -- 2. where
  location_mode text not null default 'office' check (location_mode in ('office','hybrid','remote')),
  office_days_count smallint check (office_days_count between 1 and 31),
  office_days_period text not null default 'week' check (office_days_period in ('week','month')),
  must_come_days smallint[] not null default '{}',
  extra_wfh text not null default 'approval' check (extra_wfh in ('not_allowed','approval','free')),
  geofence_required boolean not null default true,
  field_visit_allowed boolean not null default false,

  -- 3. working days & time off
  working_days smallint[] not null default '{1,2,3,4,5,6}',
  saturday_off text not null default 'none' check (saturday_off in ('none','first_third','second_fourth','all')),
  follows_holidays boolean not null default true,
  leave_mode text not null default 'standard' check (leave_mode in ('standard','none')),

  -- 4. timing
  schedule_type text not null default 'fixed' check (schedule_type in ('fixed','flexible','flexible_core','split')),
  shift_start time,
  shift_end time,
  shift2_start time,
  shift2_end time,
  core_start time,
  core_end time,
  full_day_minutes integer not null default 480 check (full_day_minutes between 30 and 1440),
  half_day_minutes integer not null default 240 check (half_day_minutes between 0 and 1440),
  absent_below_minutes integer not null default 0 check (absent_below_minutes between 0 and 1440),
  late_grace_minutes integer check (late_grace_minutes between 0 and 240),
  early_grace_minutes integer check (early_grace_minutes between 0 and 240),
  break_minutes integer check (break_minutes between 0 and 480),
  earliest_checkin time,
  auto_checkout text not null default 'none' check (auto_checkout in ('none','shift_end','midnight')),
  extra_hours text not null default 'show' check (extra_hours in ('ignore','show','approval','paid')),

  -- 5. pay (monthly salary itself stays in salary_history)
  pay_type text not null default 'monthly' check (pay_type in ('monthly','hourly','stipend','per_project','per_milestone','per_deliverable')),
  pay_rate numeric(12,2) check (pay_rate >= 0),
  tds_percent numeric(5,2) check (tds_percent between 0 and 50),

  -- 6. feature overrides: {"wfh": false, ...}; missing key = decided by the settings above
  features jsonb not null default '{}'::jsonb,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, effective_from)
);
create index if not exists employee_work_rules_lookup on public.employee_work_rules(employee_id, effective_from desc);

alter table public.employee_work_rules enable row level security;
drop policy if exists work_rules_select on public.employee_work_rules;
create policy work_rules_select on public.employee_work_rules for select to authenticated
  using (private.is_admin() or employee_id = private.current_employee_id());
revoke all on public.employee_work_rules from anon, authenticated;
grant select on public.employee_work_rules to authenticated;
-- writes only through public.admin_set_work_rules()

-- ---------------------------------------------------------------- templates
create table if not exists public.work_rule_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 60),
  description text,
  rules jsonb not null,
  is_builtin boolean not null default false,
  sort_order integer not null default 100,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.work_rule_templates enable row level security;
drop policy if exists work_templates_select on public.work_rule_templates;
create policy work_templates_select on public.work_rule_templates for select to authenticated using (private.is_admin());
drop policy if exists work_templates_write on public.work_rule_templates;
create policy work_templates_write on public.work_rule_templates for all to authenticated
  using (private.is_admin() and not is_builtin) with check (private.is_admin() and not is_builtin);
revoke all on public.work_rule_templates from anon, authenticated;
grant select, insert, update, delete on public.work_rule_templates to authenticated;

insert into public.work_rule_templates(name, description, rules, is_builtin, sort_order) values
 ('Standard office', 'Office every working day · fixed 9–6 · 8 h · Mon–Sat',
  '{"employment_type":"full_time","location_mode":"office","schedule_type":"fixed","shift_start":"09:00","shift_end":"18:00","full_day_minutes":480,"half_day_minutes":240,"working_days":[1,2,3,4,5,6]}', true, 10),
 ('Hybrid 3 days', 'Any 3 office days a week · flexible hours · 8 h',
  '{"employment_type":"full_time","location_mode":"hybrid","office_days_count":3,"office_days_period":"week","extra_wfh":"free","schedule_type":"flexible","full_day_minutes":480,"half_day_minutes":240,"working_days":[1,2,3,4,5,6]}', true, 20),
 ('Remote', 'Works from home · flexible with core hours 11–4 · 8 h',
  '{"employment_type":"full_time","location_mode":"remote","schedule_type":"flexible_core","core_start":"11:00","core_end":"16:00","full_day_minutes":480,"half_day_minutes":240,"working_days":[1,2,3,4,5,6]}', true, 30),
 ('Part-time 4 h', 'Office · any 4 hours · Mon–Fri',
  '{"employment_type":"part_time","location_mode":"office","schedule_type":"flexible","full_day_minutes":240,"half_day_minutes":120,"working_days":[1,2,3,4,5],"extra_hours":"approval"}', true, 40),
 ('Intern', 'Office · fixed 10–6 · stipend',
  '{"employment_type":"intern","location_mode":"office","schedule_type":"fixed","shift_start":"10:00","shift_end":"18:00","full_day_minutes":420,"half_day_minutes":210,"working_days":[1,2,3,4,5,6],"pay_type":"stipend","access_end_mode":"end_date"}', true, 50),
 ('Project-based', 'Tied to a project · no attendance or leave · paid per project',
  '{"employment_type":"project_based","location_mode":"remote","schedule_type":"flexible","full_day_minutes":480,"half_day_minutes":240,"leave_mode":"none","follows_holidays":false,"pay_type":"per_project","access_end_mode":"project_close","extra_wfh":"free","geofence_required":false}', true, 60)
on conflict (name) do nothing;

-- ---------------------------------------------------------------- validation
create or replace function private.validate_work_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_join date; d smallint;
begin
  select join_date into v_join from public.employees where id = NEW.employee_id;
  if NEW.working_days is null or cardinality(NEW.working_days) = 0 then raise exception 'Pick at least one working day'; end if;
  foreach d in array NEW.working_days loop if d < 1 or d > 7 then raise exception 'Invalid working day'; end if; end loop;
  NEW.working_days := (select array_agg(distinct x order by x) from unnest(NEW.working_days) x);
  NEW.must_come_days := coalesce((select array_agg(distinct x order by x) from unnest(NEW.must_come_days) x), '{}');

  if NEW.location_mode = 'hybrid' then
    if NEW.office_days_count is null then raise exception 'Set how many office days a hybrid employee needs'; end if;
    if NEW.office_days_period = 'week' and NEW.office_days_count > cardinality(NEW.working_days) then
      raise exception 'Office days a week (%) can''t be more than working days (%)', NEW.office_days_count, cardinality(NEW.working_days);
    end if;
    if NEW.office_days_period = 'month' and NEW.office_days_count > 27 then raise exception 'Office days a month is too high'; end if;
    if not (NEW.must_come_days <@ NEW.working_days) then raise exception 'Must-come days have to be working days'; end if;
    if NEW.office_days_period = 'week' and cardinality(NEW.must_come_days) > NEW.office_days_count then
      raise exception 'More must-come days than office days a week';
    end if;
  else
    NEW.office_days_count := null;
    NEW.must_come_days := '{}';
  end if;

  if NEW.schedule_type in ('fixed','split') and (NEW.shift_start is null or NEW.shift_end is null) then raise exception 'Set the shift start and end'; end if;
  if NEW.schedule_type = 'split' and (NEW.shift2_start is null or NEW.shift2_end is null) then raise exception 'Set the second shift start and end'; end if;
  if NEW.schedule_type = 'flexible_core' and (NEW.core_start is null or NEW.core_end is null or NEW.core_end <= NEW.core_start) then raise exception 'Set core hours (end after start)'; end if;
  if NEW.half_day_minutes >= NEW.full_day_minutes then raise exception 'Half-day hours must be less than full-day hours'; end if;
  if NEW.absent_below_minutes > NEW.half_day_minutes then raise exception 'Absent threshold must be at or below the half-day threshold'; end if;

  if NEW.employment_type = 'project_based' and cardinality(NEW.project_ids) = 0 and NEW.engagement_end is null then
    raise exception 'A project-based person needs a project or an end date';
  end if;
  if NEW.employment_type = 'intern' and NEW.engagement_end is null then raise exception 'Set the internship end date'; end if;
  if NEW.access_end_mode = 'end_date' and NEW.engagement_end is null then raise exception 'Set the end date access should end on'; end if;
  if NEW.access_end_mode = 'project_close' and cardinality(NEW.project_ids) = 0 then raise exception 'Link a project for access to end when it closes'; end if;
  if NEW.engagement_end is not null and NEW.engagement_end < NEW.effective_from then raise exception 'End date is before the start date'; end if;
  if v_join is not null and NEW.probation_end is not null and NEW.probation_end < v_join then raise exception 'Probation end is before the join date'; end if;
  if NEW.pay_type in ('hourly','per_project','per_milestone','per_deliverable') and NEW.pay_rate is null then raise exception 'Set the pay rate'; end if;
  if NEW.pay_type = 'hourly' and NEW.employment_type in ('freelancer','project_based') and coalesce((NEW.features->>'my_time')::boolean, true) = false then
    raise exception 'Hourly pay needs time tracking switched on';
  end if;
  if cardinality(NEW.project_ids) > 0 and exists (select 1 from unnest(NEW.project_ids) p where not exists (select 1 from public.projects x where x.id = p)) then
    raise exception 'Unknown project';
  end if;
  NEW.updated_at := now();
  return NEW;
end $$;
drop trigger if exists trg_validate_work_rules on public.employee_work_rules;
create trigger trg_validate_work_rules before insert or update on public.employee_work_rules
  for each row execute function private.validate_work_rules();

-- ---------------------------------------------------------------- lookups
-- The rules row in force on a date (latest effective_from on or before it).
create or replace function private.work_rules_on(p_employee_id uuid, p_date date)
returns public.employee_work_rules language sql stable security definer set search_path = '' as $$
  select r.* from public.employee_work_rules r
   where r.employee_id = p_employee_id and r.effective_from <= p_date
   order by r.effective_from desc limit 1
$$;

-- Which features this person can use (settings + overrides).
create or replace function private.work_features(r public.employee_work_rules)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'attendance', r.employment_type not in ('freelancer','project_based'),
    'my_time',    true,
    'leave',      r.employment_type not in ('freelancer','project_based') and r.leave_mode <> 'none',
    'wfh',        r.employment_type not in ('freelancer','project_based') and (r.location_mode = 'office' or (r.location_mode = 'hybrid' and (r.extra_wfh = 'approval' or cardinality(r.must_come_days) > 0))),
    'holidays',   r.employment_type not in ('freelancer','project_based') and r.follows_holidays,
    'payroll',    r.employment_type in ('full_time','part_time','intern'),
    'payouts',    r.employment_type in ('freelancer','project_based'),
    'client_projects', true
  ) || coalesce(r.features, '{}'::jsonb)
$$;

-- "What are this person's rules on this date?"
create or replace function private.day_rules(p_employee_id uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees%rowtype;
  r public.employee_work_rules%rowtype;
  v_dow smallint := extract(isodow from p_date);
  v_nth int := ceil(extract(day from p_date) / 7.0);
  v_reason text := null;
  v_where text;
  v_feat jsonb;
  v_grace int;
  v_late time;
begin
  select * into e from public.employees where id = p_employee_id;
  if e.id is null then return null; end if;
  r := private.work_rules_on(p_employee_id, p_date);
  if r.id is null then
    -- no row yet (shouldn't happen after the seed): behave exactly like the legacy settings
    r.employment_type := 'full_time'; r.location_mode := case when e.work_mode = 'remote' then 'remote' else 'office' end;
    r.working_days := '{1,2,3,4,5,6}'; r.saturday_off := 'none'; r.follows_holidays := true; r.leave_mode := 'standard';
    r.schedule_type := 'fixed'; r.shift_start := coalesce(e.shift_start, '09:00'); r.shift_end := coalesce(e.shift_end, '18:00');
    r.full_day_minutes := 480; r.half_day_minutes := 240; r.absent_below_minutes := 0; r.geofence_required := true;
    r.must_come_days := '{}'; r.extra_wfh := 'approval'; r.field_visit_allowed := false; r.features := '{}';
    r.auto_checkout := 'none'; r.extra_hours := 'show'; r.pay_type := 'monthly'; r.project_ids := '{}';
  end if;
  v_feat := private.work_features(r);

  if e.join_date is not null and p_date < e.join_date then v_reason := 'before_join';
  elsif r.engagement_end is not null and p_date > r.engagement_end then v_reason := 'engagement_ended';
  elsif not (v_dow = any(r.working_days)) then v_reason := 'weekly_off';
  elsif v_dow = 6 and (r.saturday_off = 'all' or (r.saturday_off = 'second_fourth' and v_nth in (2,4)) or (r.saturday_off = 'first_third' and v_nth in (1,3))) then v_reason := 'saturday_off';
  elsif r.follows_holidays and exists (select 1 from public.holidays h where h.date = p_date) then v_reason := 'holiday';
  end if;

  v_where := case r.location_mode
    when 'office' then 'office'
    when 'remote' then 'home'
    else case when v_dow = any(r.must_come_days) then 'office' else 'either' end end;

  select coalesce(r.late_grace_minutes, ws.checkin_buffer_minutes, 15) into v_grace from public.work_settings ws where ws.id;
  v_grace := coalesce(v_grace, r.late_grace_minutes, 15);
  v_late := case r.schedule_type
    when 'fixed' then r.shift_start + make_interval(mins => v_grace)
    when 'split' then r.shift_start + make_interval(mins => v_grace)
    when 'flexible_core' then r.core_start + make_interval(mins => v_grace)
    else null end;

  return jsonb_build_object(
    'date', p_date,
    'rules_id', r.id,
    'employment_type', r.employment_type,
    'working_day', v_reason is null,
    'off_reason', v_reason,
    'attendance', (v_feat->>'attendance')::boolean,
    'location', v_where,
    'location_mode', r.location_mode,
    'geofence', r.geofence_required,
    'field_visit', r.field_visit_allowed,
    'office_days', case when r.location_mode = 'hybrid' then jsonb_build_object('count', r.office_days_count, 'period', r.office_days_period, 'must_come', to_jsonb(r.must_come_days), 'extra_wfh', r.extra_wfh) end,
    'schedule', r.schedule_type,
    'shift', case when r.schedule_type in ('fixed','split') then jsonb_build_object('start', r.shift_start, 'end', r.shift_end, 'overnight', r.shift_end <= r.shift_start) end,
    'shift2', case when r.schedule_type = 'split' then jsonb_build_object('start', r.shift2_start, 'end', r.shift2_end) end,
    'core', case when r.schedule_type = 'flexible_core' then jsonb_build_object('start', r.core_start, 'end', r.core_end) end,
    'late_after', v_late,
    'early_grace_minutes', coalesce(r.early_grace_minutes, 0),
    'full_day_minutes', r.full_day_minutes,
    'half_day_minutes', r.half_day_minutes,
    'absent_below_minutes', r.absent_below_minutes,
    'break_minutes', coalesce(r.break_minutes, (select daily_break_minutes from public.work_settings where id)),
    'earliest_checkin', r.earliest_checkin,
    'auto_checkout', r.auto_checkout,
    'extra_hours', r.extra_hours,
    'features', v_feat
  );
end $$;

-- Readable by the employee themselves and admins.
create or replace function public.employee_day_rules(p_employee_id uuid default null, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := coalesce(p_employee_id, private.current_employee_id());
begin
  if v_emp is null then raise exception 'Employee not found'; end if;
  if not private.is_admin() and v_emp is distinct from private.current_employee_id() then raise exception 'Not allowed'; end if;
  return private.day_rules(v_emp, coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date));
end $$;
revoke all on function public.employee_day_rules(uuid, date) from public, anon;
grant execute on function public.employee_day_rules(uuid, date) to authenticated;

-- ---------------------------------------------------------------- keep legacy columns in sync
create or replace function private.sync_employee_legacy(p_employee_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.employee_work_rules%rowtype;
begin
  r := private.work_rules_on(p_employee_id, (now() at time zone 'Asia/Kolkata')::date);
  if r.id is null then return; end if;
  update public.employees e set
    work_mode = case when r.location_mode = 'remote' then 'remote' else 'office' end,
    shift_start = case r.schedule_type when 'flexible_core' then r.core_start when 'flexible' then e.shift_start else r.shift_start end,
    shift_end   = case r.schedule_type when 'flexible_core' then r.core_end   when 'flexible' then e.shift_end   else coalesce(r.shift2_end, r.shift_end) end
  where e.id = p_employee_id
    and (e.work_mode, e.shift_start, e.shift_end) is distinct from (
      case when r.location_mode = 'remote' then 'remote' else 'office' end,
      case r.schedule_type when 'flexible_core' then r.core_start when 'flexible' then e.shift_start else r.shift_start end,
      case r.schedule_type when 'flexible_core' then r.core_end when 'flexible' then e.shift_end else coalesce(r.shift2_end, r.shift_end) end);
end $$;

create or replace function private.after_work_rules_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.sync_employee_legacy(coalesce(NEW.employee_id, OLD.employee_id));
  return null;
end $$;
drop trigger if exists trg_work_rules_sync on public.employee_work_rules;
create trigger trg_work_rules_sync after insert or update or delete on public.employee_work_rules
  for each row execute function private.after_work_rules_change();

-- Daily at 00:05 IST: rules dated for today take effect on the legacy columns.
create or replace function private.work_rules_daily_sync() returns void
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  for v in select distinct employee_id from public.employee_work_rules
            where effective_from = (now() at time zone 'Asia/Kolkata')::date loop
    perform private.sync_employee_legacy(v);
  end loop;
end $$;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'sigma-work-rules-sync') then perform cron.unschedule('sigma-work-rules-sync'); end if;
  perform cron.schedule('sigma-work-rules-sync', '35 18 * * *', 'select private.work_rules_daily_sync()');
end $$;

-- ---------------------------------------------------------------- admin write
-- Saves the rules for an employee from a date. Same date again = replace that row. Audited.
create or replace function public.admin_set_work_rules(p_employee_id uuid, p_rules jsonb, p_effective_from date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_from date := coalesce(p_effective_from, (now() at time zone 'Asia/Kolkata')::date);
  v_row public.employee_work_rules%rowtype;
  v_id uuid;
  v_old jsonb;
begin
  if not private.is_admin() then raise exception 'Only an admin can change how someone works'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id) then raise exception 'Employee not found'; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then raise exception 'Invalid rules'; end if;

  -- start from defaults, apply the given fields
  v_row := jsonb_populate_record(null::public.employee_work_rules,
    jsonb_build_object('employee_id', p_employee_id, 'effective_from', v_from) ||
    (p_rules - 'id' - 'employee_id' - 'effective_from' - 'created_by' - 'created_at' - 'updated_at'));

  select to_jsonb(x) into v_old from public.employee_work_rules x where x.employee_id = p_employee_id and x.effective_from = v_from;

  insert into public.employee_work_rules as t (
    employee_id, effective_from, employment_type, probation_end, engagement_end, project_ids, access_end_mode,
    location_mode, office_days_count, office_days_period, must_come_days, extra_wfh, geofence_required, field_visit_allowed,
    working_days, saturday_off, follows_holidays, leave_mode,
    schedule_type, shift_start, shift_end, shift2_start, shift2_end, core_start, core_end,
    full_day_minutes, half_day_minutes, absent_below_minutes, late_grace_minutes, early_grace_minutes, break_minutes,
    earliest_checkin, auto_checkout, extra_hours, pay_type, pay_rate, tds_percent, features, created_by)
  values (
    p_employee_id, v_from,
    coalesce(v_row.employment_type, 'full_time'), v_row.probation_end, v_row.engagement_end, coalesce(v_row.project_ids, '{}'), coalesce(v_row.access_end_mode, 'never'),
    coalesce(v_row.location_mode, 'office'), v_row.office_days_count, coalesce(v_row.office_days_period, 'week'), coalesce(v_row.must_come_days, '{}'),
    coalesce(v_row.extra_wfh, 'approval'), coalesce(v_row.geofence_required, true), coalesce(v_row.field_visit_allowed, false),
    coalesce(v_row.working_days, '{1,2,3,4,5,6}'), coalesce(v_row.saturday_off, 'none'), coalesce(v_row.follows_holidays, true), coalesce(v_row.leave_mode, 'standard'),
    coalesce(v_row.schedule_type, 'fixed'), v_row.shift_start, v_row.shift_end, v_row.shift2_start, v_row.shift2_end, v_row.core_start, v_row.core_end,
    coalesce(v_row.full_day_minutes, 480), coalesce(v_row.half_day_minutes, 240), coalesce(v_row.absent_below_minutes, 0),
    v_row.late_grace_minutes, v_row.early_grace_minutes, v_row.break_minutes,
    v_row.earliest_checkin, coalesce(v_row.auto_checkout, 'none'), coalesce(v_row.extra_hours, 'show'),
    coalesce(v_row.pay_type, 'monthly'), v_row.pay_rate, v_row.tds_percent, coalesce(v_row.features, '{}'), auth.uid())
  on conflict (employee_id, effective_from) do update set
    employment_type = excluded.employment_type, probation_end = excluded.probation_end, engagement_end = excluded.engagement_end,
    project_ids = excluded.project_ids, access_end_mode = excluded.access_end_mode,
    location_mode = excluded.location_mode, office_days_count = excluded.office_days_count, office_days_period = excluded.office_days_period,
    must_come_days = excluded.must_come_days, extra_wfh = excluded.extra_wfh, geofence_required = excluded.geofence_required,
    field_visit_allowed = excluded.field_visit_allowed, working_days = excluded.working_days, saturday_off = excluded.saturday_off,
    follows_holidays = excluded.follows_holidays, leave_mode = excluded.leave_mode, schedule_type = excluded.schedule_type,
    shift_start = excluded.shift_start, shift_end = excluded.shift_end, shift2_start = excluded.shift2_start, shift2_end = excluded.shift2_end,
    core_start = excluded.core_start, core_end = excluded.core_end, full_day_minutes = excluded.full_day_minutes,
    half_day_minutes = excluded.half_day_minutes, absent_below_minutes = excluded.absent_below_minutes,
    late_grace_minutes = excluded.late_grace_minutes, early_grace_minutes = excluded.early_grace_minutes, break_minutes = excluded.break_minutes,
    earliest_checkin = excluded.earliest_checkin, auto_checkout = excluded.auto_checkout, extra_hours = excluded.extra_hours,
    pay_type = excluded.pay_type, pay_rate = excluded.pay_rate, tds_percent = excluded.tds_percent, features = excluded.features,
    created_by = excluded.created_by
  returning t.id into v_id;

  perform private.audit('employee_work_rules', v_id::text, case when v_old is null then 'create' else 'update' end,
    jsonb_build_object('employee_id', p_employee_id, 'effective_from', v_from, 'before', v_old,
                       'after', (select to_jsonb(x) - 'created_at' - 'updated_at' from public.employee_work_rules x where x.id = v_id)));
  return v_id;
end $$;
revoke all on function public.admin_set_work_rules(uuid, jsonb, date) from public, anon;
grant execute on function public.admin_set_work_rules(uuid, jsonb, date) to authenticated;

-- ---------------------------------------------------------------- seed existing employees (no behaviour change)
insert into public.employee_work_rules (employee_id, effective_from, employment_type, location_mode, schedule_type,
  shift_start, shift_end, full_day_minutes, half_day_minutes, working_days, extra_wfh)
select e.id, coalesce(e.join_date, (now() at time zone 'Asia/Kolkata')::date), 'full_time',
       case when e.work_mode = 'remote' then 'remote' else 'office' end, 'fixed',
       coalesce(e.shift_start, '09:00'), coalesce(e.shift_end, '18:00'),
       coalesce((select required_minutes from public.work_settings where id), 480),
       coalesce((select required_minutes from public.work_settings where id), 480) / 2,
       '{1,2,3,4,5,6}', 'approval'
  from public.employees e
 where not exists (select 1 from public.employee_work_rules r where r.employee_id = e.id)
on conflict (employee_id, effective_from) do nothing;

-- New employees created by the admin function get Standard office until the form saves their own rules.
create or replace function private.default_work_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.employee_work_rules (employee_id, effective_from, location_mode, schedule_type, shift_start, shift_end, working_days)
  values (NEW.id, coalesce(NEW.join_date, (now() at time zone 'Asia/Kolkata')::date),
          case when NEW.work_mode = 'remote' then 'remote' else 'office' end, 'fixed',
          coalesce(NEW.shift_start, '09:00'), coalesce(NEW.shift_end, '18:00'), '{1,2,3,4,5,6}')
  on conflict (employee_id, effective_from) do nothing;
  return NEW;
end $$;
drop trigger if exists trg_default_work_rules on public.employees;
create trigger trg_default_work_rules after insert on public.employees
  for each row execute function private.default_work_rules();
