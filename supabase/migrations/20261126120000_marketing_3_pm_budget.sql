-- Performance marketing, part 3:
-- 1) A "Performance Marketing" designation makes someone a performance marketer: the Marketing workspace for every
--    marketing client (checked from the designation directly, nothing to sync).
-- 2) Team budgets: client pays admin → admin gives budget to a performance marketer → they spend it on ads.
--    Admin can only give what the client has actually paid (minus what is already with the team).
--    Clients never see this internal step.

-- The role lives on the designation: anyone whose designation is marked marketing_role (and who is active) is a
-- performance marketer. No separate role rows to keep in sync.
alter table public.designations add column if not exists marketing_role boolean not null default false;
insert into public.designations (name, can_assign_tasks)
select 'Performance Marketing', false where not exists (select 1 from public.designations where lower(name) = 'performance marketing');
update public.designations set marketing_role = true,
  default_department_id = (select id from public.departments where lower(name) = 'marketing' limit 1)
where lower(name) = 'performance marketing';

create or replace function private.mk_emp_is_marketer(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e join public.designations d on d.id = e.designation_id
                 where e.id = p_employee and e.status = 'active' and d.marketing_role);
$$;
create or replace function private.mk_i_am_marketer() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_employee_id() is not null and private.mk_emp_is_marketer(private.current_employee_id());
$$;
grant execute on function private.mk_emp_is_marketer(uuid), private.mk_i_am_marketer() to authenticated;

-- Performance marketers work on every enabled marketing client.
create or replace function private.mk_can_work(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not private.offer_locked() and private.current_client_id() is null and (
    private.has_permission('marketing.manage')
    or ((private.mk_i_am_marketer()
         or exists (select 1 from public.mk_team t where t.client_id = p_client and t.employee_id = private.current_employee_id()))
        and exists (select 1 from public.mk_clients m where m.client_id = p_client and m.enabled)));
$$;

create or replace function public.my_marketing_access() returns boolean
language sql stable security definer set search_path = '' as $$
  select not private.offer_locked() and private.current_client_id() is null and (
    private.has_permission('marketing.manage') or private.mk_i_am_marketer()
    or exists (select 1 from public.mk_team where employee_id = private.current_employee_id()));
$$;
revoke all on function public.my_marketing_access() from public, anon;
grant execute on function public.my_marketing_access() to authenticated;

-- Who ran a campaign (their budget pays for it).
alter table public.mk_campaigns add column if not exists owner_id uuid references public.employees(id);

-- ---------------------------------------------------------------- team budgets
create table if not exists public.mk_budget (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  employee_id uuid not null references public.employees(id),
  kind text not null check (kind in ('given','returned','request')),
  amount numeric(14,2) not null check (amount > 0 and amount <= 100000000),
  entry_date date not null,
  request_id uuid references public.mk_budget(id),
  status text check ((kind = 'request') = (status is not null) and (status is null or status in ('open','approved','declined'))),
  note text check (note is null or length(note) <= 600),
  decided_by uuid references public.profiles(id), decided_at timestamptz,
  voided_at timestamptz, voided_by uuid references public.profiles(id),
  void_reason text check (void_reason is null or length(void_reason) <= 400),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists mk_budget_client_idx on public.mk_budget(client_id, employee_id);

alter table public.mk_budget enable row level security;
revoke all on public.mk_budget from anon;
revoke all on public.mk_budget from authenticated;
grant select on public.mk_budget to authenticated;
create policy mk_budget_select on public.mk_budget for select to authenticated
  using (private.has_permission('marketing.manage') and not private.offer_locked()
         or (employee_id = private.current_employee_id() and private.mk_can_work(client_id)));
create policy offer_lock on public.mk_budget as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));

create or replace function private.mk_received(p_client uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case kind when 'receipt' then amount when 'refund' then -amount when 'adjustment' then amount else 0 end), 0)
  from public.mk_money where client_id = p_client and voided_at is null;
$$;
create or replace function private.mk_with_team(p_client uuid, p_employee uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case kind when 'given' then amount when 'returned' then -amount else 0 end), 0)
  from public.mk_budget where client_id = p_client and voided_at is null and (p_employee is null or employee_id = p_employee);
$$;
create or replace function private.mk_pm_spent(p_client uuid, p_employee uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(r.spend), 0) from public.mk_results r join public.mk_campaigns c on c.id = r.campaign_id
  where r.client_id = p_client and c.owner_id = p_employee;
$$;
create or replace function private.mk_is_marketer(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.mk_emp_is_marketer(p_employee);
$$;

create or replace function public.mk_budget_give(p_client uuid, p_employee uuid, p_amount numeric, p_note text, p_request uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_free numeric; r public.mk_budget;
begin
  perform private.require(private.has_permission('marketing.manage') and not private.offer_locked(), 'Only an admin can give budget');
  perform private.require(exists (select 1 from public.mk_clients where client_id = p_client), 'Set up marketing for this client first');
  perform private.require(private.mk_is_marketer(p_employee), 'Pick someone with the Performance Marketing role');
  perform private.require(p_amount is not null and p_amount > 0, 'Enter an amount');
  perform pg_advisory_xact_lock(hashtext('mk-budget:' || p_client));
  v_free := private.mk_received(p_client) - private.mk_with_team(p_client, null);
  perform private.require(p_amount <= v_free,
    case when v_free <= 0 then 'The client has not paid any ad money that is still with you. Record the client''s payment first.'
         else 'Only ₹' || to_char(v_free, 'FM99,99,99,990.00') || ' of the client''s payment is still with you.' end);
  if p_request is not null then
    select * into r from public.mk_budget where id = p_request and kind = 'request' for update;
    perform private.require(found and r.status = 'open' and r.client_id = p_client and r.employee_id = p_employee, 'That request is not open');
    update public.mk_budget set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = r.id;
  end if;
  insert into public.mk_budget (client_id, employee_id, kind, amount, entry_date, request_id, note, created_by)
  values (p_client, p_employee, 'given', p_amount, private.today_ist(), p_request, private.clean(p_note, 600), auth.uid())
  returning id into v_id;
  perform private.notify((select profile_id from public.employees where id = p_employee), 'marketing', 'Ad budget given',
    '₹' || to_char(p_amount, 'FM99,99,99,990') || ' for ' || (select company_name from public.clients where id = p_client) || '.',
    '/emp-marketing', 'mk-bud:' || v_id, '{}'::jsonb);
  perform private.audit('mk_budget', v_id::text, 'give', jsonb_build_object('employee', p_employee, 'amount', p_amount), private.clean(p_note, 600), p_client, null, '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.mk_budget_return(p_client uuid, p_employee uuid, p_amount numeric, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require(private.has_permission('marketing.manage') and not private.offer_locked(), 'Only an admin can record returned budget');
  perform private.require(p_amount is not null and p_amount > 0, 'Enter an amount');
  perform pg_advisory_xact_lock(hashtext('mk-budget:' || p_client));
  perform private.require(p_amount <= private.mk_with_team(p_client, p_employee), 'That is more than this person holds for this client');
  insert into public.mk_budget (client_id, employee_id, kind, amount, entry_date, note, created_by)
  values (p_client, p_employee, 'returned', p_amount, private.today_ist(), private.clean(p_note, 600), auth.uid()) returning id into v_id;
  perform private.audit('mk_budget', v_id::text, 'return', jsonb_build_object('employee', p_employee, 'amount', p_amount), private.clean(p_note, 600), p_client, null, '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.mk_budget_request(p_client uuid, p_amount numeric, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := private.current_employee_id(); v_id uuid;
begin
  perform private.require(v_emp is not null and private.mk_can_work(p_client) and private.mk_is_marketer(v_emp), 'Only performance marketers can ask for budget');
  perform private.require(p_amount is not null and p_amount > 0, 'Enter an amount');
  perform private.require((select count(*) from public.mk_budget where client_id = p_client and employee_id = v_emp and kind = 'request' and status = 'open') < 3,
    'You already have open requests for this client');
  insert into public.mk_budget (client_id, employee_id, kind, amount, entry_date, status, note, created_by)
  values (p_client, v_emp, 'request', p_amount, private.today_ist(), 'open', private.clean(p_note, 600), auth.uid()) returning id into v_id;
  perform private.notify_admins('marketing', 'Ad budget requested',
    (select name from public.employees where id = v_emp) || ' asks ₹' || to_char(p_amount, 'FM99,99,99,990') || ' for ' || (select company_name from public.clients where id = p_client) || '.',
    '/admin-marketing', 'mk-bud-req:' || v_id);
  return v_id;
end $$;

create or replace function public.mk_budget_decide(p_id uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.mk_budget; v_reason text := private.clean(p_reason, 400);
begin
  perform private.require(private.has_permission('marketing.manage') and not private.offer_locked(), 'Only an admin can do this');
  select * into r from public.mk_budget where id = p_id for update;
  perform private.require(found and r.voided_at is null, 'Entry not found');
  if p_action = 'decline' then
    perform private.require(r.kind = 'request' and r.status = 'open', 'That request is not open');
    update public.mk_budget set status = 'declined', decided_by = auth.uid(), decided_at = now(), void_reason = v_reason where id = r.id;
    perform private.notify((select profile_id from public.employees where id = r.employee_id), 'marketing', 'Budget request declined',
      coalesce(v_reason, 'Your request for ₹' || to_char(r.amount, 'FM99,99,99,990') || ' was declined.'), '/emp-marketing', 'mk-bud-no:' || r.id, '{}'::jsonb);
  elsif p_action = 'void' then
    perform private.require(r.kind in ('given','returned'), 'Only given or returned budget can be voided');
    perform private.require(v_reason is not null, 'Give a reason');
    update public.mk_budget set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = r.id;
    if r.request_id is not null then update public.mk_budget set status = 'open', decided_by = null, decided_at = null where id = r.request_id; end if;
  else
    perform private.require(false, 'Unknown action');
  end if;
  perform private.audit('mk_budget', r.id::text, p_action, jsonb_build_object('amount', r.amount), v_reason, r.client_id, null, '{}'::jsonb);
end $$;

do $g$
declare f text;
begin
  foreach f in array array['public.mk_budget_give(uuid, uuid, numeric, text, uuid)', 'public.mk_budget_return(uuid, uuid, numeric, text)',
    'public.mk_budget_request(uuid, numeric, text)', 'public.mk_budget_decide(uuid, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;

-- Campaign owner: set from the form (admin picks a marketer) or defaults to the marketer creating it.
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.mk_campaign_save(uuid,uuid,jsonb)'::regprocedure);
  if position('owner_id' in d) = 0 then
    n := replace(d, $a$declare r public.mk_campaigns; v_client uuid := p_client; v_id uuid;$a$,
      $a$declare r public.mk_campaigns; v_client uuid := p_client; v_id uuid; v_owner uuid := nullif(p->>'owner_id', '')::uuid;$a$);
    n := replace(n, $a$  perform private.require(nullif(p->>'start_date', '') is not null, 'Pick a start date');$a$,
      $a$  perform private.require(nullif(p->>'start_date', '') is not null, 'Pick a start date');
  if v_owner is null and private.mk_is_marketer(private.current_employee_id()) and not private.has_permission('marketing.manage') then
    v_owner := private.current_employee_id();
  end if;
  perform private.require(v_owner is null or private.mk_is_marketer(v_owner), 'Pick someone with the Performance Marketing role to run it');$a$);
    n := replace(n, $a$    insert into public.mk_campaigns (client_id, name, platform, objective, start_date, end_date, budget, status, notes, created_by)$a$,
      $a$    insert into public.mk_campaigns (client_id, name, platform, objective, start_date, end_date, budget, status, notes, created_by, owner_id)$a$);
    n := replace(n, $a$            private.clean(p->>'notes', 2000), auth.uid())$a$, $a$            private.clean(p->>'notes', 2000), auth.uid(), v_owner)$a$);
    n := replace(n, $a$    status = coalesce(nullif(p->>'status', ''), status), notes = private.clean(p->>'notes', 2000), updated_at = now()$a$,
      $a$    status = coalesce(nullif(p->>'status', ''), status), notes = private.clean(p->>'notes', 2000),
    owner_id = case when p ? 'owner_id' then v_owner else owner_id end, updated_at = now()$a$);
    if (length(n) - length(replace(n, 'v_owner', ''))) / 7 < 6 then raise exception 'mk_campaign_save: anchors not found'; end if;
    execute n;
  end if;

  -- Low budget alert for the marketer running this campaign.
  d := pg_get_functiondef('public.mk_results_save(uuid,jsonb)'::regprocedure);
  if position('mk_pm_spent' in d) = 0 then
    n := replace(d, $a$  return n;
end $a$, $a$  if c.owner_id is not null and m.low_balance > 0 then
    v_received := private.mk_with_team(c.client_id, c.owner_id) - private.mk_pm_spent(c.client_id, c.owner_id);
    if v_received < m.low_balance then
      perform private.notify((select profile_id from public.employees where id = c.owner_id), 'marketing', 'Your ad budget is running low',
        (select company_name from public.clients where id = c.client_id) || ': ₹' || to_char(greatest(v_received, 0), 'FM99,99,99,990') || ' left with you. Ask the admin for more.',
        '/emp-marketing', 'mk-pm-low:' || c.client_id || ':' || c.owner_id || ':' || private.today_ist(), '{}'::jsonb);
    end if;
  end if;
  return n;
end $a$);
    if n = d then raise exception 'mk_results_save: anchor not found'; end if;
    execute n;
  end if;
end $mig$;
