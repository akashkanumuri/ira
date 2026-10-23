-- SIGMA 1 — KRA / KPI, performance reviews, growth history and promotions (spec 29–31)
--
-- Additive: new tables only. Nothing existing changes.
--
--   performance_cycles   a review period (monthly / quarterly / half-yearly / annual)
--                        draft → open (employees self-assess) → closed
--   kras                 one key result area for one employee in one cycle:
--                        weightage, target, measurement, actual, self / manager / final score (0–100)
--   performance_reviews  one per employee per cycle:
--                        self_review → manager_review → finalized, with the overall weighted score
--   employee_milestones  career timeline: promotions, role changes, recognition, warnings,
--                        improvement plans, training and certifications (salary history stays in salary_history)
--   performance_settings promotion-eligibility rule
--
-- Who can do what
--   admin / kra.manage   everything
--   reporting manager    sees their reports' KRAs and reviews, scores them, adds non-sensitive milestones
--   employee             sees their own KRAs (once the cycle is open), self-assesses, sees visible milestones

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- tables
create table if not exists public.performance_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  period_type text not null check (period_type in ('monthly','quarterly','half_yearly','annual')),
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft','open','closed')),
  self_review_due date,
  created_by uuid references public.profiles(id) on delete set null,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.kras (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.performance_cycles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  title text not null check (length(btrim(title)) between 2 and 160),
  description text check (description is null or length(description) <= 2000),
  measurement text check (measurement is null or length(measurement) <= 300),
  target text check (target is null or length(target) <= 300),
  weightage numeric(5,2) not null check (weightage > 0 and weightage <= 100),
  actual text check (actual is null or length(actual) <= 500),
  self_score numeric(5,2) check (self_score is null or self_score between 0 and 100),
  self_comment text check (self_comment is null or length(self_comment) <= 2000),
  manager_score numeric(5,2) check (manager_score is null or manager_score between 0 and 100),
  manager_comment text check (manager_comment is null or length(manager_comment) <= 2000),
  final_score numeric(5,2) check (final_score is null or final_score between 0 and 100),
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kras_cycle_employee_idx on public.kras(cycle_id, employee_id);
create index if not exists kras_employee_idx on public.kras(employee_id);

create table if not exists public.performance_reviews (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.performance_cycles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  manager_id uuid references public.employees(id) on delete set null,
  status text not null default 'self_review' check (status in ('self_review','manager_review','finalized')),
  self_summary text check (self_summary is null or length(self_summary) <= 4000),
  manager_summary text check (manager_summary is null or length(manager_summary) <= 4000),
  strengths text check (strengths is null or length(strengths) <= 2000),
  improvements text check (improvements is null or length(improvements) <= 2000),
  overall_score numeric(5,2) check (overall_score is null or overall_score between 0 and 100),
  rating text,
  self_submitted_at timestamptz,
  manager_submitted_at timestamptz,
  finalized_at timestamptz,
  finalized_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, employee_id)
);
create index if not exists performance_reviews_employee_idx on public.performance_reviews(employee_id);
create index if not exists performance_reviews_manager_idx on public.performance_reviews(manager_id) where manager_id is not null;

create table if not exists public.employee_milestones (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  kind text not null check (kind in ('promotion','role_change','recognition','warning','improvement_plan','training','certification','note')),
  title text not null check (length(btrim(title)) between 2 and 160),
  details text check (details is null or length(details) <= 4000),
  effective_date date not null,
  from_value text check (from_value is null or length(from_value) <= 160),
  to_value text check (to_value is null or length(to_value) <= 160),
  visible_to_employee boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employee_milestones_employee_idx on public.employee_milestones(employee_id, effective_date desc);

create table if not exists public.performance_settings (
  id boolean primary key default true check (id),
  promotion_min_score numeric(5,2) not null default 80 check (promotion_min_score between 0 and 100),
  promotion_min_reviews integer not null default 2 check (promotion_min_reviews between 1 and 12),
  promotion_min_months integer not null default 12 check (promotion_min_months between 0 and 120),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.performance_settings(id) values (true) on conflict (id) do nothing;

alter table public.performance_cycles enable row level security;
alter table public.kras enable row level security;
alter table public.performance_reviews enable row level security;
alter table public.employee_milestones enable row level security;
alter table public.performance_settings enable row level security;

-- ---------------------------------------------------------------- helpers
create or replace function private.can_manage_performance()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.has_permission('kra.manage')
$$;

-- The caller is the reporting manager of this employee.
create or replace function private.is_manager_of(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e
                 where e.id = p_employee_id and e.manager_id is not null
                   and e.manager_id = private.current_employee_id())
$$;

create or replace function private.rating_for(p_score numeric)
returns text language sql immutable set search_path = '' as $$
  select case when p_score is null then null
              when p_score >= 90 then 'Outstanding'
              when p_score >= 75 then 'Exceeds expectations'
              when p_score >= 60 then 'Meets expectations'
              when p_score >= 40 then 'Needs improvement'
              else 'Unsatisfactory' end
$$;

create or replace function private.review_weighted_score(p_cycle uuid, p_employee uuid, p_which text)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when sum(k.weightage) > 0 and count(*) = count(
           case p_which when 'self' then k.self_score when 'manager' then k.manager_score else coalesce(k.final_score, k.manager_score, k.self_score) end)
         then round(sum(k.weightage * case p_which when 'self' then k.self_score when 'manager' then k.manager_score
                                       else coalesce(k.final_score, k.manager_score, k.self_score) end) / sum(k.weightage), 2)
         end
  from public.kras k where k.cycle_id = p_cycle and k.employee_id = p_employee
$$;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin NEW.updated_at := now(); return NEW; end $$;

-- KRAs are added, removed and weighted while the cycle is a draft; wording can still be fixed until the review is finalized.
create or replace function private.guard_kra_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text; v_review text;
begin
  select status into v_status from public.performance_cycles where id = coalesce(NEW.cycle_id, OLD.cycle_id);
  select status into v_review from public.performance_reviews
    where cycle_id = coalesce(NEW.cycle_id, OLD.cycle_id) and employee_id = coalesce(NEW.employee_id, OLD.employee_id);
  if coalesce(current_setting('sigma.perf_rpc', true), '') = 'on' then
    return coalesce(NEW, OLD);
  end if;
  if v_status = 'closed' or v_review = 'finalized' then raise exception 'This review is closed'; end if;
  if TG_OP in ('INSERT','DELETE') and v_status <> 'draft' then
    raise exception 'KRAs can only be added or removed while the cycle is a draft';
  end if;
  if TG_OP = 'UPDATE' and v_status <> 'draft' and NEW.weightage is distinct from OLD.weightage then
    raise exception 'Weightage is fixed once the cycle is open';
  end if;
  if TG_OP = 'UPDATE' then
    -- Scores are only set through the assessment functions.
    NEW.self_score := OLD.self_score; NEW.self_comment := OLD.self_comment; NEW.actual := OLD.actual;
    NEW.manager_score := OLD.manager_score; NEW.manager_comment := OLD.manager_comment;
    NEW.final_score := OLD.final_score; NEW.created_by := OLD.created_by;
    NEW.cycle_id := OLD.cycle_id; NEW.employee_id := OLD.employee_id;
  elsif TG_OP = 'INSERT' then
    NEW.self_score := null; NEW.self_comment := null; NEW.actual := null;
    NEW.manager_score := null; NEW.manager_comment := null; NEW.final_score := null;
    NEW.created_by := auth.uid();
  end if;
  return coalesce(NEW, OLD);
end $$;

-- ---------------------------------------------------------------- triggers
create or replace trigger performance_cycles_updated_at before update on public.performance_cycles for each row execute function private.touch_updated_at();
create or replace trigger kras_updated_at before update on public.kras for each row execute function private.touch_updated_at();
create or replace trigger performance_reviews_updated_at before update on public.performance_reviews for each row execute function private.touch_updated_at();
create or replace trigger employee_milestones_updated_at before update on public.employee_milestones for each row execute function private.touch_updated_at();
create or replace trigger kras_guard before insert or update or delete on public.kras for each row execute function private.guard_kra_write();

create or replace trigger trg_audit_performance_cycles after insert or update or delete on public.performance_cycles for each row execute function private.audit_row_change();
create or replace trigger trg_audit_kras after insert or update or delete on public.kras for each row execute function private.audit_row_change();
create or replace trigger trg_audit_performance_reviews after insert or update or delete on public.performance_reviews for each row execute function private.audit_row_change();
create or replace trigger trg_audit_employee_milestones after insert or update or delete on public.employee_milestones for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------- workflow functions
create or replace function public.performance_open_cycle(p_cycle_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.performance_cycles; r record; n int := 0; v_bad text;
begin
  perform private.require(private.can_manage_performance(), 'Only HR or an administrator can open a review cycle');
  select * into c from public.performance_cycles where id = p_cycle_id for update;
  perform private.require(found, 'Cycle not found');
  perform private.require(c.status = 'draft', 'This cycle is already open');
  perform private.require(exists (select 1 from public.kras where cycle_id = c.id), 'Add KRAs before opening the cycle');
  select string_agg(e.name || ' (' || trim(to_char(s.total, 'FM990.##')) || '%)', ', ') into v_bad
  from (select employee_id, sum(weightage) total from public.kras where cycle_id = c.id group by employee_id) s
  join public.employees e on e.id = s.employee_id
  where s.total <> 100;
  perform private.require(v_bad is null, 'Weightage must add up to 100% for each person: ' || coalesce(v_bad, ''));

  perform set_config('sigma.perf_rpc', 'on', true);
  update public.performance_cycles set status = 'open', opened_at = now() where id = c.id;
  for r in select distinct k.employee_id, e.manager_id from public.kras k join public.employees e on e.id = k.employee_id where k.cycle_id = c.id loop
    insert into public.performance_reviews(cycle_id, employee_id, manager_id, status)
    values (c.id, r.employee_id, r.manager_id, 'self_review')
    on conflict (cycle_id, employee_id) do nothing;
    perform private.notify_employee(r.employee_id, 'system', 'Performance review open',
      c.name || ': rate yourself on your KRAs' || coalesce(' by ' || to_char(c.self_review_due, 'DD Mon'), '') || '.',
      '/emp-performance', 'perf_open_' || c.id || '_' || r.employee_id);
    n := n + 1;
  end loop;
  perform set_config('sigma.perf_rpc', '', true);
  return n;
end $$;

create or replace function public.performance_self_assess(p_kra_id uuid, p_actual text, p_score numeric, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare k public.kras; rv public.performance_reviews;
begin
  select * into k from public.kras where id = p_kra_id for update;
  perform private.require(found and k.employee_id = private.current_employee_id(), 'KRA not found');
  select * into rv from public.performance_reviews where cycle_id = k.cycle_id and employee_id = k.employee_id;
  perform private.require(found and rv.status = 'self_review', 'Your self-assessment is already submitted');
  perform private.require(p_score is not null and p_score between 0 and 100, 'Score must be between 0 and 100');
  perform set_config('sigma.perf_rpc', 'on', true);
  update public.kras set actual = nullif(btrim(coalesce(p_actual, '')), ''), self_score = round(p_score, 2),
    self_comment = nullif(btrim(coalesce(p_comment, '')), '') where id = k.id;
  perform set_config('sigma.perf_rpc', '', true);
end $$;

create or replace function public.performance_submit_self(p_review_id uuid, p_summary text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare rv public.performance_reviews; v_missing int; v_name text; r record;
begin
  select * into rv from public.performance_reviews where id = p_review_id for update;
  perform private.require(found and rv.employee_id = private.current_employee_id(), 'Review not found');
  perform private.require(rv.status = 'self_review', 'Already submitted');
  select count(*) into v_missing from public.kras where cycle_id = rv.cycle_id and employee_id = rv.employee_id and self_score is null;
  perform private.require(v_missing = 0, 'Score every KRA before submitting (' || v_missing || ' left)');
  perform set_config('sigma.perf_rpc', 'on', true);
  update public.performance_reviews set status = 'manager_review', self_summary = nullif(btrim(coalesce(p_summary, '')), ''),
    self_submitted_at = now() where id = rv.id;
  perform set_config('sigma.perf_rpc', '', true);
  select name into v_name from public.employees where id = rv.employee_id;
  if rv.manager_id is not null then
    perform private.notify_employee(rv.manager_id, 'system', 'Self-review submitted',
      coalesce(v_name, 'A team member') || ' finished their self-assessment. Add your scores.', '/emp-performance', 'perf_self_' || rv.id);
  else
    for r in select id from public.profiles where role = 'admin' loop
      perform private.notify(r.id, 'system', 'Self-review submitted', coalesce(v_name, 'An employee') || ' finished their self-assessment.',
        '/admin-performance', 'perf_self_' || rv.id, jsonb_build_object('review_id', rv.id));
    end loop;
  end if;
end $$;

create or replace function public.performance_manager_assess(p_kra_id uuid, p_score numeric, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare k public.kras; rv public.performance_reviews;
begin
  select * into k from public.kras where id = p_kra_id for update;
  perform private.require(found, 'KRA not found');
  perform private.require(private.is_manager_of(k.employee_id) or private.can_manage_performance(), 'Only the reporting manager can score this KRA');
  perform private.require(k.employee_id is distinct from private.current_employee_id(), 'You can’t score your own KRAs as manager');
  select * into rv from public.performance_reviews where cycle_id = k.cycle_id and employee_id = k.employee_id;
  perform private.require(found and rv.status = 'manager_review', 'Waiting for the self-assessment first');
  perform private.require(p_score is not null and p_score between 0 and 100, 'Score must be between 0 and 100');
  perform set_config('sigma.perf_rpc', 'on', true);
  update public.kras set manager_score = round(p_score, 2), manager_comment = nullif(btrim(coalesce(p_comment, '')), '') where id = k.id;
  perform set_config('sigma.perf_rpc', '', true);
end $$;

create or replace function public.performance_submit_manager(p_review_id uuid, p_summary text, p_strengths text default null, p_improvements text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare rv public.performance_reviews; v_missing int; v_name text; r record;
begin
  select * into rv from public.performance_reviews where id = p_review_id for update;
  perform private.require(found, 'Review not found');
  perform private.require(private.is_manager_of(rv.employee_id) or private.can_manage_performance(), 'Only the reporting manager can submit this review');
  perform private.require(rv.employee_id is distinct from private.current_employee_id(), 'You can’t review yourself');
  perform private.require(rv.status = 'manager_review', 'This review isn’t waiting for the manager');
  select count(*) into v_missing from public.kras where cycle_id = rv.cycle_id and employee_id = rv.employee_id and manager_score is null;
  perform private.require(v_missing = 0, 'Score every KRA before submitting (' || v_missing || ' left)');
  perform private.require(length(btrim(coalesce(p_summary, ''))) > 0, 'Write a short summary');
  perform set_config('sigma.perf_rpc', 'on', true);
  update public.performance_reviews set manager_summary = btrim(p_summary),
    strengths = nullif(btrim(coalesce(p_strengths, '')), ''), improvements = nullif(btrim(coalesce(p_improvements, '')), ''),
    manager_submitted_at = now(),
    overall_score = private.review_weighted_score(rv.cycle_id, rv.employee_id, 'manager')
  where id = rv.id;
  perform set_config('sigma.perf_rpc', '', true);
  select name into v_name from public.employees where id = rv.employee_id;
  for r in select id from public.profiles where role = 'admin' loop
    perform private.notify(r.id, 'system', 'Review ready to finalize', coalesce(v_name, 'An employee') || '’s manager review is in.',
      '/admin-performance', 'perf_mgr_' || rv.id, jsonb_build_object('review_id', rv.id));
  end loop;
end $$;

-- p_overrides: optional {"<kra id>": score} to adjust final scores; otherwise the manager score is final.
create or replace function public.performance_finalize(p_review_id uuid, p_overrides jsonb default '{}'::jsonb)
returns numeric language plpgsql security definer set search_path = '' as $$
declare rv public.performance_reviews; v_score numeric; v_missing int; c public.performance_cycles;
begin
  perform private.require(private.can_manage_performance(), 'Only HR or an administrator can finalize a review');
  select * into rv from public.performance_reviews where id = p_review_id for update;
  perform private.require(found, 'Review not found');
  perform private.require(rv.status <> 'finalized', 'Already finalized');
  perform private.require(rv.employee_id is distinct from private.current_employee_id(), 'You can’t finalize your own review');
  select * into c from public.performance_cycles where id = rv.cycle_id;
  perform private.require(c.status = 'open', 'The cycle must be open');
  perform set_config('sigma.perf_rpc', 'on', true);
  update public.kras k set final_score = round(least(100, greatest(0,
      coalesce((p_overrides ->> k.id::text)::numeric, k.manager_score, k.self_score))), 2)
  where k.cycle_id = rv.cycle_id and k.employee_id = rv.employee_id;
  select count(*) into v_missing from public.kras where cycle_id = rv.cycle_id and employee_id = rv.employee_id and final_score is null;
  perform private.require(v_missing = 0, 'Some KRAs have no score yet');
  v_score := private.review_weighted_score(rv.cycle_id, rv.employee_id, 'final');
  update public.performance_reviews set status = 'finalized', overall_score = v_score, rating = private.rating_for(v_score),
    finalized_at = now(), finalized_by = auth.uid() where id = rv.id;
  perform set_config('sigma.perf_rpc', '', true);
  perform private.notify_employee(rv.employee_id, 'system', 'Performance review finalized',
    c.name || ': ' || trim(to_char(v_score, 'FM990.0')) || '% · ' || private.rating_for(v_score) || '.', '/emp-performance', 'perf_final_' || rv.id);
  return v_score;
end $$;

create or replace function public.performance_close_cycle(p_cycle_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.performance_cycles; v_open int;
begin
  perform private.require(private.can_manage_performance(), 'Only HR or an administrator can close a cycle');
  select * into c from public.performance_cycles where id = p_cycle_id for update;
  perform private.require(found and c.status = 'open', 'Only an open cycle can be closed');
  select count(*) into v_open from public.performance_reviews where cycle_id = c.id and status <> 'finalized';
  perform private.require(v_open = 0, 'Finalize every review first (' || v_open || ' left)');
  perform set_config('sigma.perf_rpc', 'on', true);
  update public.performance_cycles set status = 'closed', closed_at = now() where id = c.id;
  perform set_config('sigma.perf_rpc', '', true);
end $$;

-- Copy a KRA set to every active employee with a designation (draft cycles only).
create or replace function public.performance_copy_kras(p_cycle_id uuid, p_from_employee uuid, p_designation_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.performance_cycles; e record; n int := 0;
begin
  perform private.require(private.can_manage_performance(), 'Only HR or an administrator can set KRAs');
  select * into c from public.performance_cycles where id = p_cycle_id;
  perform private.require(found and c.status = 'draft', 'KRAs can only be copied while the cycle is a draft');
  perform private.require(exists (select 1 from public.kras where cycle_id = c.id and employee_id = p_from_employee), 'Nothing to copy');
  for e in select id from public.employees where designation_id = p_designation_id and status = 'active' and id <> p_from_employee loop
    delete from public.kras where cycle_id = c.id and employee_id = e.id;
    insert into public.kras(cycle_id, employee_id, title, description, measurement, target, weightage, sort_order)
    select c.id, e.id, title, description, measurement, target, weightage, sort_order from public.kras
    where cycle_id = c.id and employee_id = p_from_employee;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Employees whose recent finalized reviews meet the promotion rule.
create or replace function public.performance_promotion_candidates()
returns table (employee_id uuid, name text, designation text, months_in_role integer, reviews integer, average_score numeric, last_promotion date)
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.performance_settings where id),
  last_promo as (
    select m.employee_id, max(m.effective_date) d from public.employee_milestones m where m.kind = 'promotion' group by m.employee_id
  ),
  recent as (
    select r.employee_id, r.overall_score, row_number() over (partition by r.employee_id order by c.end_date desc) rn
    from public.performance_reviews r join public.performance_cycles c on c.id = r.cycle_id
    where r.status = 'finalized' and r.overall_score is not null
  )
  select e.id, e.name, d.name,
         (extract(year from age(current_date, coalesce(lp.d, e.join_date))) * 12 + extract(month from age(current_date, coalesce(lp.d, e.join_date))))::int,
         count(rc.*)::int, round(avg(rc.overall_score), 1), lp.d
  from public.employees e
  cross join s
  left join public.designations d on d.id = e.designation_id
  left join last_promo lp on lp.employee_id = e.id
  join recent rc on rc.employee_id = e.id and rc.rn <= s.promotion_min_reviews
  where private.can_manage_performance() and e.status = 'active'
  group by e.id, e.name, d.name, lp.d, e.join_date, s.promotion_min_reviews, s.promotion_min_score, s.promotion_min_months
  having count(rc.*) >= s.promotion_min_reviews and avg(rc.overall_score) >= s.promotion_min_score
     and (extract(year from age(current_date, coalesce(lp.d, e.join_date))) * 12 + extract(month from age(current_date, coalesce(lp.d, e.join_date)))) >= s.promotion_min_months
  order by avg(rc.overall_score) desc
$$;

-- Record a milestone. Managers may add recognition, training and certification for their reports;
-- promotions, role changes, warnings and improvement plans are HR-only.
create or replace function public.employee_add_milestone(p_employee_id uuid, p_kind text, p_title text, p_effective_date date,
  p_details text default null, p_from text default null, p_to text default null, p_visible boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_hr boolean := private.can_manage_performance();
begin
  perform private.require(p_kind in ('promotion','role_change','recognition','warning','improvement_plan','training','certification','note'), 'Unknown milestone type');
  perform private.require(v_hr or (private.is_manager_of(p_employee_id) and p_kind in ('recognition','training','certification','note')),
    'You can’t add this to the employee’s history');
  perform private.require(length(btrim(coalesce(p_title, ''))) between 2 and 160, 'Give it a title');
  perform private.require(p_effective_date is not null and p_effective_date <= (now() at time zone 'Asia/Kolkata')::date + 366, 'Pick a valid date');
  insert into public.employee_milestones(employee_id, kind, title, details, effective_date, from_value, to_value, visible_to_employee, created_by)
  values (p_employee_id, p_kind, btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), p_effective_date,
          nullif(btrim(coalesce(p_from, '')), ''), nullif(btrim(coalesce(p_to, '')), ''),
          case when v_hr then coalesce(p_visible, true) else true end, auth.uid())
  returning id into v_id;
  if coalesce(p_visible, true) and p_kind in ('promotion','recognition','certification') then
    perform private.notify_employee(p_employee_id, 'system',
      case p_kind when 'promotion' then 'Congratulations on your promotion' when 'recognition' then 'You were recognised' else 'Certification recorded' end,
      btrim(p_title), '/emp-performance', 'milestone_' || v_id);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- RLS
drop policy if exists performance_cycles_select on public.performance_cycles;
create policy performance_cycles_select on public.performance_cycles for select to authenticated
  using (private.can_manage_performance() or status <> 'draft');
drop policy if exists performance_cycles_write on public.performance_cycles;
create policy performance_cycles_write on public.performance_cycles for all to authenticated
  using (private.can_manage_performance()) with check (private.can_manage_performance());

drop policy if exists kras_select on public.kras;
create policy kras_select on public.kras for select to authenticated
  using (private.can_manage_performance()
      or ((employee_id = private.current_employee_id() or private.is_manager_of(employee_id))
          and exists (select 1 from public.performance_cycles c where c.id = cycle_id and c.status <> 'draft')));
drop policy if exists kras_write on public.kras;
create policy kras_write on public.kras for all to authenticated
  using (private.can_manage_performance()) with check (private.can_manage_performance());

drop policy if exists performance_reviews_select on public.performance_reviews;
create policy performance_reviews_select on public.performance_reviews for select to authenticated
  using (private.can_manage_performance() or employee_id = private.current_employee_id() or private.is_manager_of(employee_id));

drop policy if exists employee_milestones_select on public.employee_milestones;
create policy employee_milestones_select on public.employee_milestones for select to authenticated
  using (private.can_manage_performance()
      or (visible_to_employee and (employee_id = private.current_employee_id() or private.is_manager_of(employee_id))));
drop policy if exists employee_milestones_hr_write on public.employee_milestones;
create policy employee_milestones_hr_write on public.employee_milestones for update to authenticated
  using (private.can_manage_performance()) with check (private.can_manage_performance());

drop policy if exists performance_settings_select on public.performance_settings;
create policy performance_settings_select on public.performance_settings for select to authenticated using (true);
drop policy if exists performance_settings_update on public.performance_settings;
create policy performance_settings_update on public.performance_settings for update to authenticated
  using (private.can_manage_performance()) with check (private.can_manage_performance());

-- ---------------------------------------------------------------- grants
revoke all on public.performance_cycles, public.kras, public.performance_reviews, public.employee_milestones, public.performance_settings from anon;
revoke truncate, trigger, references on public.performance_cycles, public.kras, public.performance_reviews, public.employee_milestones, public.performance_settings from authenticated;
grant select, insert, update, delete on public.performance_cycles, public.kras to authenticated;
revoke insert, update, delete on public.performance_reviews from authenticated;
grant select on public.performance_reviews to authenticated;
revoke insert, delete on public.employee_milestones from authenticated;
grant select, update on public.employee_milestones to authenticated;
revoke insert, delete on public.performance_settings from authenticated;
grant select, update on public.performance_settings to authenticated;

revoke execute on function private.can_manage_performance(), private.is_manager_of(uuid), private.review_weighted_score(uuid, uuid, text),
  private.guard_kra_write() from public, anon;
grant execute on function private.can_manage_performance(), private.is_manager_of(uuid), private.rating_for(numeric) to authenticated;

revoke execute on function public.performance_open_cycle(uuid), public.performance_self_assess(uuid, text, numeric, text),
  public.performance_submit_self(uuid, text), public.performance_manager_assess(uuid, numeric, text),
  public.performance_submit_manager(uuid, text, text, text), public.performance_finalize(uuid, jsonb),
  public.performance_close_cycle(uuid), public.performance_copy_kras(uuid, uuid, uuid),
  public.performance_promotion_candidates(),
  public.employee_add_milestone(uuid, text, text, date, text, text, text, boolean) from public, anon;
grant execute on function public.performance_open_cycle(uuid), public.performance_self_assess(uuid, text, numeric, text),
  public.performance_submit_self(uuid, text), public.performance_manager_assess(uuid, numeric, text),
  public.performance_submit_manager(uuid, text, text, text), public.performance_finalize(uuid, jsonb),
  public.performance_close_cycle(uuid), public.performance_copy_kras(uuid, uuid, uuid),
  public.performance_promotion_candidates(),
  public.employee_add_milestone(uuid, text, text, date, text, text, text, boolean) to authenticated;
