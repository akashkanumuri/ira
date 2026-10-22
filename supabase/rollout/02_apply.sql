-- SIGMA 1 — STEP 2: APPLY (run only after step 1 showed "failed": 0)
-- Paste into Supabase Dashboard → SQL Editor → Run. Runs as one transaction: all or nothing.
begin;

-- ===== supabase/migrations/20261022100000_sigma_security_hardening.sql
-- SIGMA 1 — Security hardening (phase 0)
-- Closes direct client write paths that allowed a signed-in client to mark
-- payments as paid, rewrite contract status/URL/version and forge audit rows.
-- All client actions move to validated SECURITY DEFINER RPCs (see
-- 20261022120000_sigma_workflow_rpcs.sql). Reversible: policies can be
-- recreated from 20261016030000_client_portal_core_tables.sql if required.

-- 1. Remove client write policies that bypass business rules ----------------
drop policy if exists contracts_client_update on public.contracts;
drop policy if exists payment_installments_client_update on public.payment_installments;
drop policy if exists contract_acceptances_client_insert on public.contract_acceptances;
drop policy if exists change_requests_client_insert on public.change_requests;

-- Acceptance records are evidence: admins may read, nobody may edit.
drop policy if exists contract_acceptances_admin_all on public.contract_acceptances;

-- Managers must decide modification requests through the review RPC so the
-- original scope is versioned and the decision is audited.
drop policy if exists change_requests_manager_mutations on public.change_requests;
drop policy if exists change_requests_admin_all on public.change_requests;

-- 2. Least-privilege table grants ------------------------------------------
-- PostgREST never needs TRUNCATE/TRIGGER/REFERENCES for API roles, and
-- TRUNCATE bypasses RLS entirely.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p','v','m')
  loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

-- 3. Trigger functions must not be callable over /rest/v1/rpc --------------
revoke execute on function public.trg_notify_holiday() from public, anon, authenticated;
revoke execute on function public.trg_notify_leave_request() from public, anon, authenticated;
revoke execute on function public.trg_notify_task() from public, anon, authenticated;
revoke execute on function public.trg_notify_wfh_request() from public, anon, authenticated;
revoke execute on function public.trg_protect_notification_integrity() from public, anon, authenticated;
revoke execute on function public.trg_protect_push_sub_integrity() from public, anon, authenticated;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- private.can_view_project was granted to PUBLIC; restrict to signed-in roles.
revoke execute on function private.can_view_project(uuid) from public, anon;

-- ===== supabase/migrations/20261022110000_sigma_core_domain.sql
-- SIGMA 1 — Core domain model
-- Organisation → Client → Contract/Project → Deliverable → Task → Employee
-- Adds: multi-user client organisations, RBAC permissions, versioned contracts
-- and deliverables, modification requests, client dependencies, versioned
-- private files, payments with verification, configurable payment locks and an
-- immutable audit log. Existing rows are preserved and backfilled.

-- =========================================================================
-- 0. Helpers
-- =========================================================================
create or replace function private.try_parse_date(p text)
returns date language plpgsql immutable set search_path = '' as $$
begin
  if p is null or btrim(p) = '' or upper(btrim(p)) in ('TBD','—','-') then return null; end if;
  if p ~ '^\d{4}-\d{2}-\d{2}' then return substr(p,1,10)::date; end if;
  -- Indian convention DD/MM/YYYY (or DD-MM-YYYY)
  if p ~ '^\d{1,2}[/-]\d{1,2}[/-]\d{4}$' then return to_date(replace(p,'-','/'), 'DD/MM/YYYY'); end if;
  begin
    return p::date;
  exception when others then return null;
  end;
end $$;

create or replace function private.request_ip()
returns text language sql stable set search_path = '' as $$
  select nullif(split_part(coalesce(
    (nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for'),
    (nullif(current_setting('request.headers', true), '')::json ->> 'x-real-ip'), ''), ',', 1), '')
$$;

create or replace function private.today_ist()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- =========================================================================
-- 1. RBAC: roles, permissions, assignments
-- =========================================================================
create table if not exists public.roles (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null,
  scope text not null check (scope in ('staff','client')),
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.permissions (
  code text primary key check (code ~ '^[a-z][a-z0-9_.]{2,80}$'),
  module text not null,
  description text not null
);

create table if not exists public.role_permissions (
  role_code text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

create table if not exists public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_code text not null references public.roles(code) on delete restrict,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_code)
);

insert into public.roles(code, name, scope, description, is_system) values
  ('super_admin','Super Admin','staff','Complete system access',true),
  ('admin','Admin','staff','Operational and business management',true),
  ('hr_admin','HR Admin','staff','Employees, attendance, leave and payroll',true),
  ('finance_admin','Finance Admin','staff','Billing, invoices and payments',true),
  ('project_manager','Project / Account Manager','staff','Clients, projects and deliverables',true),
  ('employee','Employee','staff','Assigned work and employee modules',true),
  ('client_admin','Client Admin','client','Full access to their organisation portal',true),
  ('client_user','Client User','client','Restricted client portal access',true)
on conflict (code) do nothing;

insert into public.permissions(code, module, description) values
  -- client portal
  ('client.dashboard.view','client','View client dashboard'),
  ('client.contract.view','client','View contract'),
  ('client.contract.accept','client','Accept contract'),
  ('client.contract.decline','client','Decline contract'),
  ('client.deliverable.view','client','View deliverables'),
  ('client.modification.request','client','Request deliverable modification'),
  ('client.dependency.upload','client','Upload client dependency'),
  ('client.deliverable.download','client','Download deliverable'),
  ('client.deliverable.review','client','Approve or request changes on delivered work'),
  ('client.progress.view','client','View progress'),
  ('client.billing.view','client','View billing'),
  ('client.payment.history','client','View payment history'),
  ('client.payment.submit','client','Upload payment proof / reference'),
  ('client.users.manage','client','Add client users'),
  -- employee
  ('employee.task.view','employee','View assigned tasks'),
  ('employee.task.update','employee','Update task status'),
  ('employee.file.upload','employee','Upload work files'),
  ('employee.kra.view','employee','View KRA'),
  ('employee.leave.apply','employee','Apply leave'),
  ('employee.attendance.view','employee','View attendance'),
  ('employee.payroll.view','employee','View payroll'),
  -- admin / staff
  ('client.create','admin','Create client'),
  ('client.edit','admin','Edit client'),
  ('project.manage_all','admin','Manage every project'),
  ('contract.create','admin','Create and revise contracts'),
  ('contract.send','admin','Send contract to client'),
  ('deliverable.create','admin','Create deliverables'),
  ('deliverable.assign','admin','Assign employees to deliverables'),
  ('deliverable.status','admin','Change deliverable status'),
  ('deliverable.upload','admin','Upload deliverable files'),
  ('deliverable.modification.approve','admin','Approve deliverable modifications'),
  ('deliverable.lock','admin','Lock / unlock deliverables'),
  ('invoice.generate','finance','Generate invoices / milestones'),
  ('payment.record','finance','Record and verify payments'),
  ('billing.settings','finance','Configure payment lock rules'),
  ('employee.manage','hr','Manage employees'),
  ('payroll.manage','hr','Manage payroll'),
  ('attendance.manage','hr','Manage attendance'),
  ('kra.manage','hr','Manage KRAs'),
  ('audit.view','admin','View audit log'),
  ('rbac.manage','admin','Manage roles and permissions')
on conflict (code) do nothing;

insert into public.role_permissions(role_code, permission_code)
select 'super_admin', code from public.permissions
on conflict do nothing;

insert into public.role_permissions(role_code, permission_code)
select r, p from (values
  ('admin','client.create'),('admin','client.edit'),('admin','project.manage_all'),('admin','contract.create'),
  ('admin','contract.send'),('admin','deliverable.create'),('admin','deliverable.assign'),('admin','deliverable.status'),
  ('admin','deliverable.upload'),('admin','deliverable.modification.approve'),('admin','deliverable.lock'),
  ('admin','invoice.generate'),('admin','payment.record'),('admin','audit.view'),
  ('hr_admin','employee.manage'),('hr_admin','payroll.manage'),('hr_admin','attendance.manage'),('hr_admin','kra.manage'),
  ('finance_admin','invoice.generate'),('finance_admin','payment.record'),('finance_admin','billing.settings'),
  ('finance_admin','deliverable.lock'),('finance_admin','audit.view'),
  ('project_manager','deliverable.create'),('project_manager','deliverable.assign'),('project_manager','deliverable.status'),
  ('project_manager','deliverable.upload'),('project_manager','deliverable.modification.approve'),
  ('employee','employee.task.view'),('employee','employee.task.update'),('employee','employee.file.upload'),
  ('employee','employee.kra.view'),('employee','employee.leave.apply'),('employee','employee.attendance.view'),
  ('employee','employee.payroll.view'),
  ('client_admin','client.dashboard.view'),('client_admin','client.contract.view'),('client_admin','client.contract.accept'),
  ('client_admin','client.contract.decline'),('client_admin','client.deliverable.view'),('client_admin','client.modification.request'),
  ('client_admin','client.dependency.upload'),('client_admin','client.deliverable.download'),('client_admin','client.deliverable.review'),
  ('client_admin','client.progress.view'),('client_admin','client.billing.view'),('client_admin','client.payment.history'),
  ('client_admin','client.payment.submit'),('client_admin','client.users.manage'),
  ('client_user','client.dashboard.view'),('client_user','client.contract.view'),('client_user','client.deliverable.view'),
  ('client_user','client.dependency.upload'),('client_user','client.deliverable.download'),('client_user','client.progress.view'),
  ('client_user','client.modification.request')
) v(r, p)
on conflict do nothing;

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;

-- =========================================================================
-- 2. Client organisations and client users
-- =========================================================================
alter table public.clients
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists gstin text,
  add column if not exists industry text,
  add column if not exists account_manager_id uuid references public.employees(id) on delete set null,
  add column if not exists deleted_at timestamptz;

create table if not exists public.client_users (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  role text not null default 'client_user' check (role in ('client_admin','client_user')),
  status text not null default 'invited' check (status in ('invited','active','inactive')),
  full_name text,
  email text,
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_users_client_idx on public.client_users(client_id);
alter table public.client_users enable row level security;

-- Backfill: every existing client login becomes that organisation's Client Admin.
insert into public.client_users(client_id, profile_id, role, status, full_name, email)
select c.id, c.profile_id, 'client_admin', c.status, c.primary_contact, c.email
from public.clients c
on conflict (profile_id) do nothing;

-- Keep the organisation's primary login in client_users (the client-admin
-- edge function and invitation redemption still write clients.profile_id/status).
create or replace function private.sync_primary_client_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.client_users(client_id, profile_id, role, status, full_name, email)
  values (new.id, new.profile_id, 'client_admin', new.status, new.primary_contact, new.email)
  on conflict (profile_id) do update set
    status = case when public.client_users.client_id = excluded.client_id then excluded.status else public.client_users.status end,
    updated_at = now();
  return new;
end $$;
drop trigger if exists trg_sync_primary_client_user on public.clients;
create trigger trg_sync_primary_client_user after insert or update of status, profile_id on public.clients
for each row execute function private.sync_primary_client_user();

-- =========================================================================
-- 3. Authorization helpers
-- =========================================================================
create or replace function private.current_client_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select cu.client_id
  from public.client_users cu
  join public.profiles p on p.id = cu.profile_id and p.role = 'client'
  join public.clients c on c.id = cu.client_id and c.deleted_at is null and c.status <> 'inactive'
  where cu.profile_id = (select auth.uid()) and cu.status <> 'inactive'
  limit 1
$$;

create or replace function private.current_client_role()
returns text language sql stable security definer set search_path = '' as $$
  select cu.role from public.client_users cu
  where cu.profile_id = (select auth.uid()) and cu.status <> 'inactive'
  limit 1
$$;

create or replace function private.has_permission(p_code text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'service_role' then
    return true;
  end if;
  select role into v_role from public.profiles where id = (select auth.uid());
  if v_role is null then return false; end if;
  if v_role = 'admin' then return true; end if;  -- legacy admin = super admin
  if v_role = 'client' then
    return exists (select 1 from public.role_permissions rp
                   where rp.role_code = private.current_client_role() and rp.permission_code = p_code);
  end if;
  return exists (
    select 1 from public.role_permissions rp
    where rp.permission_code = p_code
      and (rp.role_code = 'employee' and v_role in ('employee','manager')
           or rp.role_code in (select ur.role_code from public.user_roles ur where ur.user_id = (select auth.uid())))
  );
end $$;

-- =========================================================================
-- 4. Projects → client hierarchy
-- =========================================================================
alter table public.projects
  add column if not exists client_id uuid references public.clients(id) on delete restrict,
  add column if not exists start_date date,
  add column if not exists target_date date,
  add column if not exists deleted_at timestamptz;
create index if not exists projects_client_idx on public.projects(client_id);

update public.projects p set client_id = c.id
from public.project_clients pc join public.clients c on c.profile_id = pc.client_id
where pc.project_id = p.id and p.client_id is null;

-- Bridge for older code paths that still write project_clients.
create or replace function private.sync_project_client()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.projects p set client_id = c.id
  from public.clients c where c.profile_id = new.client_id and p.id = new.project_id and p.client_id is null;
  return new;
end $$;
drop trigger if exists trg_sync_project_client on public.project_clients;
create trigger trg_sync_project_client after insert on public.project_clients
for each row execute function private.sync_project_client();

create or replace function private.is_project_manager(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_managers pm
                 where pm.project_id = p_project_id and pm.manager_id = private.current_employee_id())
$$;

create or replace function private.can_manage_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.has_permission('project.manage_all') or private.is_project_manager(p_project_id)
$$;

-- A project manager holds the project_manager role's permissions, scoped to
-- the projects they manage. Global staff roles apply to every project.
create or replace function private.project_permission(p_project_id uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.has_permission('project.manage_all') and private.has_permission(p_perm))
      or (private.is_project_manager(p_project_id)
          and exists (select 1 from public.role_permissions rp
                      where rp.role_code = 'project_manager' and rp.permission_code = p_perm))
$$;

create or replace function private.is_client_of_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects p
                 where p.id = p_project_id and p.deleted_at is null
                   and p.client_id is not null and p.client_id = private.current_client_id())
$$;

create or replace function private.can_view_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_manage_project(p_project_id) or private.is_client_of_project(p_project_id)
$$;

create or replace function private.can_view_project_finance(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.has_permission('payment.record') or private.has_permission('invoice.generate')
      or private.is_project_manager(p_project_id)
      or (private.is_client_of_project(p_project_id) and private.has_permission('client.billing.view'))
$$;

grant execute on function private.current_client_id() to authenticated;
grant execute on function private.current_client_role() to authenticated;
grant execute on function private.has_permission(text) to authenticated;
grant execute on function private.is_project_manager(uuid) to authenticated;
grant execute on function private.can_manage_project(uuid) to authenticated;
grant execute on function private.project_permission(uuid, text) to authenticated;
grant execute on function private.is_client_of_project(uuid) to authenticated;
grant execute on function private.can_view_project(uuid) to authenticated;
grant execute on function private.can_view_project_finance(uuid) to authenticated;
revoke execute on function private.can_view_project(uuid) from public, anon;

-- =========================================================================
-- 5. Contracts and immutable versions
-- =========================================================================
alter table public.contracts drop constraint if exists contracts_status_check;
update public.contracts set status = 'Awaiting Acceptance' where status = 'Pending Review';
alter table public.contracts
  add column if not exists client_id uuid references public.clients(id) on delete restrict,
  add column if not exists contract_value numeric(14,2) check (contract_value is null or contract_value >= 0),
  add column if not exists currency text not null default 'INR',
  add column if not exists tax_note text,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists renewal_date date,
  add column if not exists current_version_no integer not null default 1,
  add column if not exists sent_at timestamptz,
  add column if not exists viewed_at timestamptz,
  add column if not exists declined_at timestamptz,
  add column if not exists decline_reason text,
  add column if not exists terminated_at timestamptz,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_at timestamptz;
alter table public.contracts add constraint contracts_status_check check (status in
  ('Draft','Sent','Viewed','Awaiting Acceptance','Accepted','Declined','Expired','Terminated'));
alter table public.contracts alter column status set default 'Draft';
alter table public.contracts drop constraint if exists contracts_dates_check;
alter table public.contracts add constraint contracts_dates_check check (end_date is null or start_date is null or end_date >= start_date);

update public.contracts k set client_id = p.client_id from public.projects p where p.id = k.project_id and k.client_id is null;

create table if not exists public.contract_versions (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  title text not null,
  document_url text,
  document_file_id uuid,
  terms_summary text,
  contract_value numeric(14,2),
  start_date date,
  end_date date,
  change_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (contract_id, version_no)
);
alter table public.contract_versions enable row level security;

insert into public.contract_versions(contract_id, version_no, title, document_url, created_at)
select k.id, coalesce(nullif(regexp_replace(k.version, '\D', '', 'g'), '')::int, 1), k.title, k.url, k.created_at
from public.contracts k
where not exists (select 1 from public.contract_versions v where v.contract_id = k.id);
update public.contracts k set current_version_no = coalesce(nullif(regexp_replace(k.version, '\D', '', 'g'), '')::int, 1);

alter table public.contract_acceptances
  add column if not exists user_id uuid references public.profiles(id) on delete set null,
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists contract_version_id uuid references public.contract_versions(id) on delete restrict,
  add column if not exists version_no integer,
  add column if not exists ip_address text,
  add column if not exists user_agent text,
  add column if not exists acknowledgement text;

-- =========================================================================
-- 6. Deliverables, versions, status workflow
-- =========================================================================
alter table public.deliverables drop constraint if exists deliverables_status_check;
update public.deliverables set status = 'Pending' where status = 'Not Started';

alter table public.deliverables
  alter column quantity drop default;
alter table public.deliverables
  alter column quantity type numeric(12,2)
  using coalesce(nullif(regexp_replace(quantity, '[^0-9.]', '', 'g'), '')::numeric, 1);
alter table public.deliverables alter column quantity set default 1;
alter table public.deliverables add constraint deliverables_quantity_check check (quantity >= 0);

alter table public.deliverables alter column due_date drop not null;
alter table public.deliverables alter column due_date type date using private.try_parse_date(due_date);

alter table public.deliverables
  add column if not exists client_id uuid references public.clients(id) on delete restrict,
  add column if not exists contract_id uuid references public.contracts(id) on delete set null,
  add column if not exists category text,
  add column if not exists unit text,
  add column if not exists timeline text,
  add column if not exists start_date date,
  add column if not exists priority text not null default 'Medium',
  add column if not exists weightage numeric(5,2),
  add column if not exists version_no integer not null default 1,
  add column if not exists client_action text,
  add column if not exists assigned_team text,
  add column if not exists lock_state text not null default 'unlocked',
  add column if not exists lock_reason text,
  add column if not exists locked_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists ready_at timestamptz,
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_at timestamptz;

alter table public.deliverables add constraint deliverables_status_check check (status in (
  'Draft','Pending','In Progress','Awaiting Client Dependency','Under Internal Review','Awaiting Client Review',
  'Modification Requested','Revision In Progress','Completed','Ready for Download','Cancelled'));
alter table public.deliverables alter column status set default 'Draft';
alter table public.deliverables add constraint deliverables_priority_check check (priority in ('Low','Medium','High','Critical'));
alter table public.deliverables add constraint deliverables_weightage_check check (weightage is null or (weightage >= 0 and weightage <= 100));
alter table public.deliverables add constraint deliverables_lock_state_check check (lock_state in ('unlocked','locked_payment','locked_manual','override_unlocked'));
alter table public.deliverables add constraint deliverables_dates_check check (due_date is null or start_date is null or due_date >= start_date);

update public.deliverables d set client_id = p.client_id from public.projects p where p.id = d.project_id and d.client_id is null;
create unique index if not exists deliverables_project_number_uq on public.deliverables(project_id, deliverable_number) where deleted_at is null;
create index if not exists deliverables_responsible_idx on public.deliverables(responsible_id) where deleted_at is null;
create index if not exists deliverables_client_idx on public.deliverables(client_id);

create table if not exists public.deliverable_versions (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete restrict,
  version_no integer not null,
  snapshot jsonb not null,
  change_source text not null default 'edit' check (change_source in ('initial','edit','modification_request','backfill')),
  change_request_id uuid references public.change_requests(id) on delete set null,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (deliverable_id, version_no)
);
alter table public.deliverable_versions enable row level security;

create or replace function private.deliverable_scope(d public.deliverables)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('name', d.name, 'description', d.description, 'category', d.category,
    'quantity', d.quantity, 'unit', d.unit, 'timeline', d.timeline, 'start_date', d.start_date,
    'due_date', d.due_date, 'weightage', d.weightage, 'dependencies', d.dependencies)
$$;

insert into public.deliverable_versions(deliverable_id, version_no, snapshot, change_source, reason, created_at)
select d.id, 1, private.deliverable_scope(d), 'backfill', 'Scope captured at SIGMA 1 migration', d.created_at
from public.deliverables d
where not exists (select 1 from public.deliverable_versions v where v.deliverable_id = d.id);

-- Status transition rules (enforced on every write path).
create or replace function private.deliverable_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable set search_path = '' as $$
  select p_from = p_to or (p_from, p_to) in (
    ('Draft','Pending'),('Draft','Cancelled'),
    ('Pending','In Progress'),('Pending','Awaiting Client Dependency'),('Pending','Draft'),('Pending','Cancelled'),
    ('In Progress','Awaiting Client Dependency'),('In Progress','Under Internal Review'),('In Progress','Pending'),('In Progress','Cancelled'),
    ('Awaiting Client Dependency','In Progress'),('Awaiting Client Dependency','Pending'),('Awaiting Client Dependency','Cancelled'),
    ('Under Internal Review','In Progress'),('Under Internal Review','Awaiting Client Review'),('Under Internal Review','Completed'),('Under Internal Review','Cancelled'),
    ('Awaiting Client Review','Modification Requested'),('Awaiting Client Review','Completed'),('Awaiting Client Review','Revision In Progress'),
    ('Modification Requested','Revision In Progress'),('Modification Requested','Awaiting Client Review'),('Modification Requested','Cancelled'),
    ('Revision In Progress','Under Internal Review'),('Revision In Progress','Awaiting Client Review'),
    ('Completed','Ready for Download'),('Completed','Revision In Progress'),
    ('Ready for Download','Completed'),('Ready for Download','Revision In Progress'),
    ('Cancelled','Pending')
  )
$$;

create or replace function private.deliverables_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_client uuid;
begin
  select client_id into v_client from public.projects where id = new.project_id;
  new.client_id := v_client;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'A deliverable cannot be moved to another project' using errcode = 'P0001';
    end if;
    if new.status is distinct from old.status then
      if not private.deliverable_transition_allowed(old.status, new.status) then
        raise exception 'Invalid deliverable status change: % → %', old.status, new.status using errcode = 'P0001';
      end if;
      if new.status = 'Ready for Download' and not exists (
        select 1 from public.files f where f.parent_type = 'deliverable' and f.parent_id = new.id
          and f.is_final and f.visibility = 'client' and f.deleted_at is null) then
        raise exception 'Upload a final client-visible file before marking the deliverable ready for download' using errcode = 'P0001';
      end if;
      if new.status = 'Completed' and old.completed_at is null then new.completed_at := now(); end if;
      if new.status = 'Ready for Download' then new.ready_at := now(); end if;
    end if;
    if private.deliverable_scope(new) is distinct from private.deliverable_scope(old) then
      new.version_no := old.version_no + 1;
    else
      new.version_no := old.version_no;
    end if;
  else
    new.version_no := 1;
  end if;
  return new;
end $$;

create or replace function private.deliverables_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.deliverable_versions(deliverable_id, version_no, snapshot, change_source, reason, created_by)
    values (new.id, 1, private.deliverable_scope(new), 'initial', 'Initial scope', auth.uid());
  elsif new.version_no > old.version_no then
    insert into public.deliverable_versions(deliverable_id, version_no, snapshot, change_source, change_request_id, reason, created_by)
    values (new.id, new.version_no, private.deliverable_scope(new),
            coalesce(nullif(current_setting('sigma.change_source', true), ''), 'edit'),
            nullif(current_setting('sigma.change_request_id', true), '')::uuid,
            nullif(current_setting('sigma.change_reason', true), ''),
            auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists trg_deliverables_before_write on public.deliverables;
create trigger trg_deliverables_before_write before insert or update on public.deliverables
for each row execute function private.deliverables_before_write();
drop trigger if exists trg_deliverables_after_write on public.deliverables;
create trigger trg_deliverables_after_write after insert or update on public.deliverables
for each row execute function private.deliverables_after_write();

-- =========================================================================
-- 7. Modification requests (extends change_requests)
-- =========================================================================
alter table public.change_requests drop constraint if exists change_requests_status_check;
update public.change_requests set status = 'Approved' where status = 'Approved Change';
update public.change_requests set status = 'Rejected' where status = 'Change Declined';
alter table public.change_requests
  add column if not exists client_id uuid references public.clients(id) on delete restrict,
  add column if not exists modification_type text not null default 'other',
  add column if not exists original_quantity numeric(12,2),
  add column if not exists requested_quantity numeric(12,2),
  add column if not exists quantity_delta numeric(12,2) generated always as (requested_quantity - original_quantity) stored,
  add column if not exists original_due_date date,
  add column if not exists requested_due_date date,
  add column if not exists counter_quantity numeric(12,2),
  add column if not exists counter_due_date date,
  add column if not exists counter_value text,
  add column if not exists billing_note text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists client_response_note text,
  add column if not exists applied_version_no integer,
  add column if not exists idempotency_key text unique;
alter table public.change_requests add constraint change_requests_status_check check (status in
  ('Pending Review','Approved','Rejected','Counter Proposed','Counter Accepted','Counter Declined','Withdrawn'));
alter table public.change_requests add constraint change_requests_type_check check (modification_type in
  ('quantity','scope','timeline','revision','other'));
update public.change_requests r set client_id = p.client_id from public.projects p where p.id = r.project_id and r.client_id is null;
create unique index if not exists change_requests_open_per_type_uq on public.change_requests(deliverable_id, modification_type)
  where status in ('Pending Review','Counter Proposed');
create unique index if not exists change_requests_number_uq on public.change_requests(project_id, request_number);

-- =========================================================================
-- 8. Files (private, versioned, attached to any business object)
-- =========================================================================
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  file_group_id uuid not null default gen_random_uuid(),
  version_no integer not null default 1 check (version_no > 0),
  parent_type text not null check (parent_type in
    ('contract','deliverable','dependency','task','invoice','payment','employee','client','project')),
  parent_id uuid not null,
  client_id uuid references public.clients(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  name text not null check (length(name) between 1 and 255),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  storage_bucket text not null default 'sigma-files',
  storage_path text not null unique,
  visibility text not null default 'internal' check (visibility in ('internal','client')),
  is_final boolean not null default false,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (file_group_id, version_no)
);
create index if not exists files_parent_idx on public.files(parent_type, parent_id) where deleted_at is null;
create index if not exists files_client_idx on public.files(client_id);
alter table public.files enable row level security;

alter table public.contract_versions
  drop constraint if exists contract_versions_document_file_fk;
alter table public.contract_versions
  add constraint contract_versions_document_file_fk foreign key (document_file_id) references public.files(id) on delete restrict;

-- =========================================================================
-- 9. Client dependencies
-- =========================================================================
create table if not exists public.deliverable_dependencies (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  name text not null check (length(btrim(name)) between 2 and 200),
  description text,
  required_by date,
  status text not null default 'Requested' check (status in
    ('Requested','Pending','Uploaded','Accepted','Rejected','Resubmission Required')),
  client_note text,
  review_comment text,
  requested_by uuid references public.profiles(id) on delete set null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deliverable_dependencies_deliverable_idx on public.deliverable_dependencies(deliverable_id);
create index if not exists deliverable_dependencies_client_idx on public.deliverable_dependencies(client_id, status);
alter table public.deliverable_dependencies enable row level security;

-- =========================================================================
-- 10. Billing: milestones (payment_installments), payments, lock rules
-- =========================================================================
alter table public.payment_installments drop constraint if exists payment_installments_status_check;
alter table public.payment_installments alter column due_date drop not null;
alter table public.payment_installments alter column due_date type date using private.try_parse_date(due_date);
alter table public.payment_installments alter column paid_on type date using private.try_parse_date(paid_on);
update public.payment_installments set status = 'Due' where status = 'Pending Verification';
alter table public.payment_installments
  add column if not exists client_id uuid references public.clients(id) on delete restrict,
  add column if not exists contract_id uuid references public.contracts(id) on delete set null,
  add column if not exists basis_type text not null default 'fixed' check (basis_type in ('percentage','fixed','recurring')),
  add column if not exists percentage numeric(6,3) check (percentage is null or (percentage > 0 and percentage <= 100)),
  add column if not exists tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  add column if not exists amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists invoice_number text,
  add column if not exists invoice_issued_at timestamptz,
  add column if not exists status_override text,
  add column if not exists status_reason text,
  add column if not exists deleted_at timestamptz;
alter table public.payment_installments add constraint payment_installments_amount_check check (amount >= 0);
alter table public.payment_installments add constraint payment_installments_status_check check (status in
  ('Upcoming','Due','Partially Paid','Paid','Overdue','Disputed','Cancelled','Waived'));
alter table public.payment_installments add constraint payment_installments_override_check check (status_override is null or status_override in
  ('Disputed','Cancelled','Waived'));
create unique index if not exists payment_installments_invoice_uq on public.payment_installments(invoice_number) where invoice_number is not null;
update public.payment_installments i set client_id = p.client_id from public.projects p where p.id = i.project_id and i.client_id is null;

create table if not exists public.billing_settings (
  id boolean primary key default true check (id),
  auto_lock_enabled boolean not null default false,
  grace_days integer not null default 0 check (grace_days between 0 and 365),
  due_soon_days integer not null default 7 check (due_soon_days between 0 and 90),
  reminder_days_before integer not null default 3 check (reminder_days_before between 0 and 60),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.billing_settings(id) values (true) on conflict do nothing;
alter table public.billing_settings enable row level security;

create table if not exists public.client_billing_rules (
  client_id uuid primary key references public.clients(id) on delete cascade,
  auto_lock_enabled boolean,
  grace_days integer check (grace_days is null or grace_days between 0 and 365),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.client_billing_rules enable row level security;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid not null references public.payment_installments(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  reference text not null check (length(btrim(reference)) between 3 and 120),
  paid_on date not null,
  method text check (method is null or method in ('bank_transfer','upi','cheque','card','cash','other')),
  proof_file_id uuid references public.files(id) on delete restrict,
  status text not null default 'Submitted' check (status in ('Submitted','Verified','Rejected')),
  source text not null default 'client' check (source in ('client','finance')),
  notes text,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  rejection_reason text,
  idempotency_key text unique,
  check (status <> 'Verified' or (verified_by is not null and verified_at is not null))
);
create index if not exists payments_installment_idx on public.payments(installment_id);
create unique index if not exists payments_reference_uq on public.payments(installment_id, lower(btrim(reference))) where status <> 'Rejected';
alter table public.payments enable row level security;

create table if not exists public.deliverable_lock_events (
  id bigint generated always as identity primary key,
  deliverable_id uuid not null references public.deliverables(id) on delete restrict,
  previous_state text not null,
  new_state text not null,
  source text not null check (source in ('manual','payment_rule','payment_cleared','override')),
  reason text,
  installment_id uuid references public.payment_installments(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.deliverable_lock_events enable row level security;

-- =========================================================================
-- 11. Tasks → deliverable linkage (Client → Project → Deliverable → Task → Employee)
-- =========================================================================
alter table public.tasks
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists deliverable_id uuid references public.deliverables(id) on delete set null;
create index if not exists tasks_deliverable_idx on public.tasks(deliverable_id) where deliverable_id is not null;

-- =========================================================================
-- 12. Immutable audit log
-- =========================================================================
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_role text,
  client_id uuid,
  project_id uuid,
  entity_type text not null,
  entity_id text,
  action text not null,
  changes jsonb not null default '{}'::jsonb,
  reason text,
  ip_address text,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, occurred_at desc);
create index if not exists audit_logs_client_idx on public.audit_logs(client_id, occurred_at desc);
create index if not exists audit_logs_time_idx on public.audit_logs(occurred_at desc);
alter table public.audit_logs enable row level security;

create or replace function private.forbid_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% records are immutable', tg_table_name using errcode = 'P0001';
end $$;

drop trigger if exists trg_audit_logs_immutable on public.audit_logs;
create trigger trg_audit_logs_immutable before update or delete on public.audit_logs
for each row execute function private.forbid_mutation();
drop trigger if exists trg_contract_acceptances_immutable on public.contract_acceptances;
create trigger trg_contract_acceptances_immutable before update or delete on public.contract_acceptances
for each row execute function private.forbid_mutation();
-- Contract versions are immutable, except attaching the document to a draft
-- version that has never been sent (via staff_attach_contract_document).
create or replace function private.protect_contract_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('sigma.contract_doc_attach', true), '') = 'on'
     and (new.contract_id, new.version_no, new.title, new.terms_summary, new.contract_value, new.start_date, new.end_date, new.change_note, new.created_by, new.created_at)
         is not distinct from (old.contract_id, old.version_no, old.title, old.terms_summary, old.contract_value, old.start_date, old.end_date, old.change_note, old.created_by, old.created_at)
     and exists (select 1 from public.contracts k where k.id = old.contract_id and k.status = 'Draft' and k.sent_at is null)
     and not exists (select 1 from public.contract_acceptances a where a.contract_version_id = old.id) then
    return new;
  end if;
  raise exception 'contract_versions records are immutable' using errcode = 'P0001';
end $$;
drop trigger if exists trg_contract_versions_immutable on public.contract_versions;
create trigger trg_contract_versions_immutable before update or delete on public.contract_versions
for each row execute function private.protect_contract_version();
drop trigger if exists trg_deliverable_versions_immutable on public.deliverable_versions;
create trigger trg_deliverable_versions_immutable before update or delete on public.deliverable_versions
for each row execute function private.forbid_mutation();
drop trigger if exists trg_lock_events_immutable on public.deliverable_lock_events;
create trigger trg_lock_events_immutable before update or delete on public.deliverable_lock_events
for each row execute function private.forbid_mutation();

create or replace function private.audit(
  p_entity_type text, p_entity_id text, p_action text, p_changes jsonb default '{}'::jsonb,
  p_reason text default null, p_client_id uuid default null, p_project_id uuid default null,
  p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(actor_id, actor_role, client_id, project_id, entity_type, entity_id, action, changes, reason, ip_address, metadata)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()), p_client_id, p_project_id,
          p_entity_type, p_entity_id, p_action, coalesce(p_changes, '{}'::jsonb), p_reason, private.request_ip(), coalesce(p_metadata, '{}'::jsonb));
end $$;

-- Generic row-change audit. Records only changed fields (old → new).
create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_row jsonb := case when tg_op = 'DELETE' then v_old else v_new end;
  v_changes jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at') and (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;
  elsif tg_op = 'INSERT' then
    v_changes := v_new - 'token_hash';
  else
    v_changes := v_old - 'token_hash';
  end if;
  insert into public.audit_logs(actor_id, actor_role, client_id, project_id, entity_type, entity_id, action, changes, reason, ip_address)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()),
          case when tg_table_name = 'clients' then (v_row ->> 'id')::uuid else (v_row ->> 'client_id')::uuid end,
          case when tg_table_name = 'projects' then (v_row ->> 'id')::uuid else (v_row ->> 'project_id')::uuid end,
          tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'project_id'), lower(tg_op), v_changes,
          nullif(current_setting('sigma.change_reason', true), ''), private.request_ip());
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['clients','client_users','projects','project_managers','contracts','deliverables',
    'change_requests','deliverable_dependencies','payment_installments','payments','files','billing_settings',
    'client_billing_rules','user_roles','role_permissions','employees','salary_history','payroll_periods',
    'payroll_records','leave_requests']
  loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function private.audit_row_change()', t);
  end loop;
end $$;

-- =========================================================================
-- 13. Derive client ownership on child records (never trust the caller)
-- =========================================================================
create or replace function private.set_client_from_project()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select p.client_id into new.client_id from public.projects p where p.id = new.project_id;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['contracts','change_requests','deliverable_dependencies','payment_installments','payments']
  loop
    execute format('drop trigger if exists trg_client_from_project on public.%I', t);
    execute format('create trigger trg_client_from_project before insert or update of project_id on public.%I
                    for each row execute function private.set_client_from_project()', t);
  end loop;
end $$;

-- Notification categories for the new modules.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in
  ('attendance','leave','wfh','task','holiday','payroll','system','contract','deliverable','dependency','modification','billing','client'));

-- ===== supabase/migrations/20261022115000_sigma_rls_policies.sql
-- SIGMA 1 — Row Level Security for the client lifecycle
-- Principle: clients read only their organisation's non-draft records; every
-- client action and every evidence-bearing staff action goes through a
-- validated RPC. Staff writes that remain direct (projects, deliverables,
-- milestones) are constrained by triggers (status machine, versioning, audit).

create or replace function private.is_assigned_to_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.deliverables d
                 where d.project_id = p_project_id and d.deleted_at is null
                   and d.responsible_id = private.current_employee_id())
      or exists (select 1 from public.tasks t
                 where t.project_id = p_project_id and t.archived_at is null
                   and t.assigned_to = private.current_employee_id())
$$;
grant execute on function private.is_assigned_to_project(uuid) to authenticated;

-- ---------------------------------------------------------------- RBAC tables
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated using (true);
drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions for select to authenticated using (true);
drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);
drop policy if exists role_permissions_manage on public.role_permissions;
create policy role_permissions_manage on public.role_permissions for all to authenticated
  using (private.has_permission('rbac.manage')) with check (private.has_permission('rbac.manage'));
drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or private.has_permission('rbac.manage'));
drop policy if exists user_roles_manage on public.user_roles;
create policy user_roles_manage on public.user_roles for all to authenticated
  using (private.has_permission('rbac.manage')) with check (private.has_permission('rbac.manage'));

-- ---------------------------------------------------------------- clients
drop policy if exists clients_select_own_or_admin on public.clients;
drop policy if exists clients_select_scoped on public.clients;
create policy clients_select_scoped on public.clients for select to authenticated using (
  private.is_admin() or private.has_permission('client.edit') or private.has_permission('payment.record')
  or id = private.current_client_id()
  or exists (select 1 from public.projects p where p.client_id = clients.id
             and (private.is_project_manager(p.id) or private.is_assigned_to_project(p.id)))
);

drop policy if exists client_users_select on public.client_users;
create policy client_users_select on public.client_users for select to authenticated using (
  private.is_admin() or private.has_permission('client.edit') or client_id = private.current_client_id()
);
drop policy if exists client_users_admin_write on public.client_users;
create policy client_users_admin_write on public.client_users for all to authenticated
  using (private.is_admin() or private.has_permission('client.edit'))
  with check (private.is_admin() or private.has_permission('client.edit'));

-- ---------------------------------------------------------------- projects
drop policy if exists projects_select_authorized on public.projects;
create policy projects_select_authorized on public.projects for select to authenticated using (
  private.can_view_project(id) or private.is_assigned_to_project(id)
);

-- ---------------------------------------------------------------- contracts
drop policy if exists contracts_admin_all on public.contracts;
drop policy if exists contracts_select_authorized on public.contracts;
create policy contracts_select_authorized on public.contracts for select to authenticated using (
  private.can_manage_project(project_id) or private.has_permission('payment.record')
  or (private.is_client_of_project(project_id) and status <> 'Draft' and deleted_at is null
      and private.has_permission('client.contract.view'))
);

drop policy if exists contract_versions_select on public.contract_versions;
create policy contract_versions_select on public.contract_versions for select to authenticated using (
  exists (select 1 from public.contracts k where k.id = contract_versions.contract_id)
);

drop policy if exists contract_acceptances_select_authorized on public.contract_acceptances;
create policy contract_acceptances_select_authorized on public.contract_acceptances for select to authenticated using (
  private.can_manage_project(project_id) or private.is_client_of_project(project_id)
);

-- ---------------------------------------------------------------- deliverables
drop policy if exists deliverables_admin_all on public.deliverables;
drop policy if exists deliverables_manager_mutations on public.deliverables;
drop policy if exists deliverables_select_authorized on public.deliverables;
create policy deliverables_select_authorized on public.deliverables for select to authenticated using (
  private.can_manage_project(project_id)
  or (deleted_at is null and responsible_id = private.current_employee_id())
  or (private.is_client_of_project(project_id) and status <> 'Draft' and deleted_at is null
      and private.has_permission('client.deliverable.view'))
);
drop policy if exists deliverables_staff_insert on public.deliverables;
create policy deliverables_staff_insert on public.deliverables for insert to authenticated
  with check (private.project_permission(project_id, 'deliverable.create'));
-- Updates go through staff_update_deliverable / staff_set_deliverable_status /
-- staff_set_deliverable_lock / staff_archive_deliverable (reason + versioning).
drop policy if exists deliverables_staff_update on public.deliverables;

drop policy if exists deliverable_versions_select on public.deliverable_versions;
create policy deliverable_versions_select on public.deliverable_versions for select to authenticated using (
  exists (select 1 from public.deliverables d where d.id = deliverable_versions.deliverable_id)
);

-- ---------------------------------------------------------------- modifications
drop policy if exists change_requests_select_authorized on public.change_requests;
create policy change_requests_select_authorized on public.change_requests for select to authenticated using (
  private.can_manage_project(project_id) or private.is_client_of_project(project_id)
  or exists (select 1 from public.deliverables d where d.id = change_requests.deliverable_id
             and d.responsible_id = private.current_employee_id())
);

-- ---------------------------------------------------------------- dependencies
drop policy if exists deliverable_dependencies_select on public.deliverable_dependencies;
create policy deliverable_dependencies_select on public.deliverable_dependencies for select to authenticated using (
  private.can_manage_project(project_id) or private.is_client_of_project(project_id)
  or exists (select 1 from public.deliverables d where d.id = deliverable_dependencies.deliverable_id
             and d.responsible_id = private.current_employee_id())
);

-- ---------------------------------------------------------------- billing
drop policy if exists payment_installments_admin_all on public.payment_installments;
drop policy if exists payment_installments_select_authorized on public.payment_installments;
create policy payment_installments_select_authorized on public.payment_installments for select to authenticated using (
  private.can_view_project_finance(project_id) and (deleted_at is null or private.has_permission('payment.record'))
);
drop policy if exists payment_installments_finance_insert on public.payment_installments;
create policy payment_installments_finance_insert on public.payment_installments for insert to authenticated
  with check (private.has_permission('invoice.generate'));
drop policy if exists payment_installments_finance_update on public.payment_installments;
create policy payment_installments_finance_update on public.payment_installments for update to authenticated
  using (private.has_permission('invoice.generate')) with check (private.has_permission('invoice.generate'));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated using (
  private.has_permission('payment.record')
  or (private.is_client_of_project(project_id) and private.has_permission('client.payment.history'))
  or (private.is_client_of_project(project_id) and submitted_by = (select auth.uid()))
);

drop policy if exists billing_settings_select on public.billing_settings;
create policy billing_settings_select on public.billing_settings for select to authenticated using (
  private.has_permission('payment.record') or private.has_permission('billing.settings')
);
drop policy if exists billing_settings_update on public.billing_settings;
create policy billing_settings_update on public.billing_settings for update to authenticated
  using (private.has_permission('billing.settings')) with check (private.has_permission('billing.settings'));

drop policy if exists client_billing_rules_select on public.client_billing_rules;
create policy client_billing_rules_select on public.client_billing_rules for select to authenticated using (
  private.has_permission('payment.record') or private.has_permission('billing.settings')
);
drop policy if exists client_billing_rules_write on public.client_billing_rules;
create policy client_billing_rules_write on public.client_billing_rules for all to authenticated
  using (private.has_permission('billing.settings')) with check (private.has_permission('billing.settings'));

drop policy if exists deliverable_lock_events_select on public.deliverable_lock_events;
create policy deliverable_lock_events_select on public.deliverable_lock_events for select to authenticated using (
  private.has_permission('payment.record')
  or exists (select 1 from public.deliverables d where d.id = deliverable_lock_events.deliverable_id
             and private.can_manage_project(d.project_id))
);

-- ---------------------------------------------------------------- files
create or replace function private.can_read_file(p_file_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  f public.files;
  d public.deliverables;
  v_emp uuid := private.current_employee_id();
begin
  select * into f from public.files where id = p_file_id;
  if not found then return false; end if;
  if private.is_admin() then return true; end if;
  if f.deleted_at is not null then return false; end if;
  if f.uploaded_by = (select auth.uid()) then return true; end if;

  -- staff
  if f.project_id is not null and private.can_manage_project(f.project_id) then return true; end if;
  if f.parent_type in ('payment','invoice') and private.has_permission('payment.record') then return true; end if;
  if v_emp is not null then
    if f.parent_type = 'deliverable' and exists (select 1 from public.deliverables x where x.id = f.parent_id and x.responsible_id = v_emp) then return true; end if;
    if f.parent_type = 'dependency' and exists (select 1 from public.deliverable_dependencies dd join public.deliverables x on x.id = dd.deliverable_id
                                                where dd.id = f.parent_id and x.responsible_id = v_emp) then return true; end if;
    if f.parent_type = 'task' and exists (select 1 from public.tasks t where t.id = f.parent_id and (t.assigned_to = v_emp or t.assigned_by = v_emp)) then return true; end if;
  end if;

  -- client
  if f.client_id is null or f.client_id is distinct from private.current_client_id() or f.visibility <> 'client' then
    return false;
  end if;
  if f.project_id is not null and not private.is_client_of_project(f.project_id) then return false; end if;
  case f.parent_type
    when 'deliverable' then
      select * into d from public.deliverables where id = f.parent_id;
      if not found or d.deleted_at is not null or d.status = 'Draft' then return false; end if;
      if f.is_final then
        return d.status = 'Ready for Download'
           and d.lock_state in ('unlocked','override_unlocked')
           and private.has_permission('client.deliverable.download');
      end if;
      return private.has_permission('client.deliverable.view');
    when 'contract' then
      return exists (select 1 from public.contracts k where k.id = f.parent_id and k.status <> 'Draft' and k.deleted_at is null);
    when 'dependency', 'payment' then
      return true;
    when 'invoice' then
      return private.has_permission('client.billing.view');
    when 'project', 'client' then
      return true;
    else
      return false;
  end case;
end $$;
grant execute on function private.can_read_file(uuid) to authenticated;

drop policy if exists files_select on public.files;
create policy files_select on public.files for select to authenticated using (private.can_read_file(id));

-- ---------------------------------------------------------------- audit
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated using (private.has_permission('audit.view'));

-- ---------------------------------------------------------------- grants
grant select on public.roles, public.permissions, public.role_permissions, public.user_roles,
  public.client_users, public.contract_versions, public.deliverable_versions, public.deliverable_dependencies,
  public.files, public.payments, public.billing_settings, public.client_billing_rules,
  public.deliverable_lock_events, public.audit_logs to authenticated;
grant insert, update, delete on public.role_permissions, public.user_roles, public.client_users, public.client_billing_rules to authenticated;
grant update on public.billing_settings to authenticated;
revoke delete on public.deliverables, public.contracts, public.payment_installments, public.change_requests,
  public.contract_acceptances from authenticated;
revoke insert, update on public.contracts, public.contract_acceptances, public.change_requests from authenticated;
revoke all on public.roles, public.permissions, public.role_permissions, public.user_roles, public.client_users,
  public.contract_versions, public.deliverable_versions, public.deliverable_dependencies, public.files,
  public.payments, public.billing_settings, public.client_billing_rules, public.deliverable_lock_events,
  public.audit_logs from anon;

-- ===== supabase/migrations/20261022120000_sigma_workflow_rpcs.sql
-- SIGMA 1 — Workflow RPCs and event-driven side effects
-- Every function: SECURITY DEFINER, empty search_path, explicit authorization,
-- row locks for state transitions, audit + notifications in the same
-- transaction (all-or-nothing).

-- =========================================================================
-- Notification helpers (internal only)
-- =========================================================================
create or replace function private.notify(
  p_recipient uuid, p_type text, p_title text, p_message text,
  p_action_url text default null, p_key text default null, p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_recipient is null then return; end if;
  insert into public.notifications(recipient_id, actor_id, type, title, message, action_url, idempotency_key, metadata)
  values (p_recipient, auth.uid(), p_type, left(p_title, 200), left(p_message, 1000), p_action_url,
          case when p_key is null then null else p_key || ':' || p_recipient::text end, coalesce(p_metadata, '{}'::jsonb))
  on conflict (idempotency_key) do nothing;
end $$;

create or replace function private.notify_project_staff(
  p_project_id uuid, p_type text, p_title text, p_message text, p_action_url text, p_key text,
  p_include_finance boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select p.id from public.profiles p where p.role = 'admin'
    union
    select e.profile_id from public.project_managers pm join public.employees e on e.id = pm.manager_id
    where pm.project_id = p_project_id and e.profile_id is not null and e.status = 'active'
    union
    select ur.user_id from public.user_roles ur where p_include_finance and ur.role_code = 'finance_admin'
  loop
    if r.id is distinct from auth.uid() then
      perform private.notify(r.id, p_type, p_title, p_message, p_action_url, p_key);
    end if;
  end loop;
end $$;

create or replace function private.notify_client(
  p_client_id uuid, p_type text, p_title text, p_message text, p_action_url text, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select cu.profile_id from public.client_users cu
           where cu.client_id = p_client_id and cu.status <> 'inactive'
  loop
    if r.profile_id is distinct from auth.uid() then
      perform private.notify(r.profile_id, p_type, p_title, p_message, p_action_url, p_key);
    end if;
  end loop;
end $$;

create or replace function private.notify_employee(
  p_employee_id uuid, p_type text, p_title text, p_message text, p_action_url text, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_profile uuid;
begin
  select profile_id into v_profile from public.employees where id = p_employee_id and status = 'active';
  if v_profile is not null and v_profile is distinct from auth.uid() then
    perform private.notify(v_profile, p_type, p_title, p_message, p_action_url, p_key);
  end if;
end $$;

create or replace function private.require(p_condition boolean, p_message text)
returns void language plpgsql set search_path = '' as $$
begin
  if not coalesce(p_condition, false) then raise exception '%', p_message using errcode = 'P0001'; end if;
end $$;

-- =========================================================================
-- Deliverable side effects (status / assignment / lock guard)
-- =========================================================================
create or replace function private.deliverables_guard_lock()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.lock_state is distinct from old.lock_state and coalesce(current_setting('sigma.lock_change', true), '') <> 'on' then
    raise exception 'Use the lock controls to change deliverable access' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_deliverables_guard_lock on public.deliverables;
create trigger trg_deliverables_guard_lock before update of lock_state on public.deliverables
for each row execute function private.deliverables_guard_lock();

create or replace function private.deliverables_events()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_url text := '/client/deliverables';
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'Awaiting Client Review' then
      perform private.notify_client(new.client_id, 'deliverable', 'Deliverable ready for your review',
        new.deliverable_number || ' · ' || new.name || ' has been submitted for your review.', v_url,
        'deliv-review:' || new.id || ':' || new.version_no || ':' || extract(epoch from now())::bigint / 3600);
    elsif new.status = 'Ready for Download' then
      perform private.notify_client(new.client_id, 'deliverable', 'Deliverable ready for download',
        new.deliverable_number || ' · ' || new.name || ' is complete and ready to download.', v_url,
        'deliv-ready:' || new.id || ':' || new.version_no);
    elsif new.status in ('Modification Requested','Under Internal Review') then
      perform private.notify_project_staff(new.project_id, 'deliverable', 'Deliverable ' || lower(new.status),
        new.deliverable_number || ' · ' || new.name || ' is now ' || new.status || '.', '/admin/clients',
        'deliv-status:' || new.id || ':' || new.status || ':' || extract(epoch from now())::bigint / 60);
    end if;
  end if;
  if new.responsible_id is not null and (tg_op = 'INSERT' or new.responsible_id is distinct from old.responsible_id) then
    perform private.notify_employee(new.responsible_id, 'deliverable', 'Client deliverable assigned to you',
      new.deliverable_number || ' · ' || new.name, '/my-deliverables',
      'deliv-assign:' || new.id || ':' || new.responsible_id);
  end if;
  return null;
end $$;
drop trigger if exists trg_deliverables_events on public.deliverables;
create trigger trg_deliverables_events after insert or update on public.deliverables
for each row execute function private.deliverables_events();

-- Default deliverable number when not supplied.
create or replace function private.deliverables_default_number()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if new.deliverable_number is null or btrim(new.deliverable_number) = '' then
    perform pg_advisory_xact_lock(hashtext('deliv-num:' || new.project_id::text));
    select count(*) + 1 into n from public.deliverables where project_id = new.project_id;
    new.deliverable_number := 'D-' || lpad(n::text, 3, '0');
  end if;
  if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.responsible_id is not null then
    select name into new.responsible_name from public.employees where id = new.responsible_id;
  elsif tg_op = 'UPDATE' and old.responsible_id is not null then
    new.responsible_name := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_deliverables_default_number on public.deliverables;
create trigger trg_deliverables_default_number before insert or update of responsible_id on public.deliverables
for each row execute function private.deliverables_default_number();

-- =========================================================================
-- Contracts
-- =========================================================================
create or replace function public.staff_create_contract(
  p_project_id uuid, p_title text, p_ref text default null, p_document_url text default null,
  p_document_file_id uuid default null, p_contract_value numeric default null, p_tax_note text default null,
  p_start_date date default null, p_end_date date default null, p_renewal_date date default null,
  p_terms_summary text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_client uuid;
begin
  perform private.require(private.has_permission('contract.create'), 'You are not allowed to create contracts');
  select client_id into v_client from public.projects where id = p_project_id and deleted_at is null;
  perform private.require(v_client is not null, 'Project must belong to a client before a contract can be created');
  perform private.require(length(btrim(coalesce(p_title, ''))) >= 3, 'Contract title is required');
  perform private.require(p_document_url is null or p_document_url ~* '^https://', 'Contract link must be an https:// URL');
  perform private.require(p_end_date is null or p_start_date is null or p_end_date >= p_start_date, 'End date cannot be before start date');

  insert into public.contracts(project_id, title, ref, version, url, status, assigned_date, contract_value, tax_note,
    start_date, end_date, renewal_date, current_version_no, created_by)
  values (p_project_id, btrim(p_title), coalesce(nullif(btrim(p_ref), ''), 'CTR-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 4)),
          'v1', coalesce(p_document_url, ''), 'Draft', now(), p_contract_value, p_tax_note,
          p_start_date, p_end_date, p_renewal_date, 1, auth.uid())
  returning id into v_id;

  insert into public.contract_versions(contract_id, version_no, title, document_url, document_file_id, terms_summary,
    contract_value, start_date, end_date, change_note, created_by)
  values (v_id, 1, btrim(p_title), p_document_url, p_document_file_id, p_terms_summary, p_contract_value,
          p_start_date, p_end_date, 'Initial version', auth.uid());
  return v_id;
end $$;

create or replace function public.staff_revise_contract(
  p_contract_id uuid, p_change_note text, p_title text default null, p_document_url text default null,
  p_document_file_id uuid default null, p_contract_value numeric default null, p_start_date date default null,
  p_end_date date default null, p_renewal_date date default null, p_terms_summary text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare k public.contracts; v_next int; v_prev public.contract_versions;
begin
  select * into k from public.contracts where id = p_contract_id and deleted_at is null for update;
  perform private.require(found, 'Contract not found');
  perform private.require(private.has_permission('contract.create'), 'You are not allowed to revise contracts');
  perform private.require(k.status not in ('Terminated','Expired'), 'Terminated or expired contracts cannot be revised');
  perform private.require(length(btrim(coalesce(p_change_note, ''))) >= 3, 'Describe what changed in this version');
  perform private.require(p_document_url is null or p_document_url ~* '^https://', 'Contract link must be an https:// URL');
  select * into v_prev from public.contract_versions where contract_id = k.id and version_no = k.current_version_no;
  v_next := k.current_version_no + 1;

  insert into public.contract_versions(contract_id, version_no, title, document_url, document_file_id, terms_summary,
    contract_value, start_date, end_date, change_note, created_by)
  values (k.id, v_next, coalesce(nullif(btrim(p_title), ''), v_prev.title, k.title),
          coalesce(p_document_url, v_prev.document_url), coalesce(p_document_file_id, case when p_document_url is null then v_prev.document_file_id end),
          coalesce(p_terms_summary, v_prev.terms_summary), coalesce(p_contract_value, k.contract_value),
          coalesce(p_start_date, k.start_date), coalesce(p_end_date, k.end_date), btrim(p_change_note), auth.uid());

  -- Previous acceptance stays in contract_acceptances (immutable). The new
  -- version must be sent and accepted again.
  update public.contracts set
    current_version_no = v_next, version = 'v' || v_next,
    title = coalesce(nullif(btrim(p_title), ''), title),
    url = coalesce(p_document_url, case when p_document_file_id is not null then '' else url end),
    contract_value = coalesce(p_contract_value, contract_value),
    start_date = coalesce(p_start_date, start_date), end_date = coalesce(p_end_date, end_date),
    renewal_date = coalesce(p_renewal_date, renewal_date),
    status = 'Draft', accepted_at = null, accepted_url = null, viewed_at = null, sent_at = null,
    declined_at = null, decline_reason = null, updated_at = now()
  where id = k.id;
  return v_next;
end $$;

-- Attach the document to a draft version that has never been sent.
create or replace function public.staff_attach_contract_document(p_contract_id uuid, p_file_id uuid default null, p_url text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare k public.contracts;
begin
  select * into k from public.contracts where id = p_contract_id and deleted_at is null for update;
  perform private.require(found, 'Contract not found');
  perform private.require(private.has_permission('contract.create'), 'Not allowed');
  perform private.require(k.status = 'Draft' and k.sent_at is null, 'Only unsent drafts can have their document replaced; create a revised version instead');
  perform private.require((p_file_id is null) <> (p_url is null), 'Provide either a file or a link');
  perform private.require(p_url is null or p_url ~* '^https://', 'Contract link must be an https:// URL');
  perform private.require(p_file_id is null or exists (select 1 from public.files f where f.id = p_file_id and f.parent_type = 'contract' and f.parent_id = k.id and f.deleted_at is null),
    'Invalid contract file');
  perform set_config('sigma.contract_doc_attach', 'on', true);
  update public.contract_versions set document_file_id = p_file_id, document_url = p_url
  where contract_id = k.id and version_no = k.current_version_no;
  perform set_config('sigma.contract_doc_attach', '', true);
  update public.contracts set url = coalesce(p_url, ''), updated_at = now() where id = k.id;
end $$;

create or replace function public.staff_send_contract(p_contract_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare k public.contracts;
begin
  select * into k from public.contracts where id = p_contract_id and deleted_at is null for update;
  perform private.require(found, 'Contract not found');
  perform private.require(private.has_permission('contract.send'), 'You are not allowed to send contracts');
  perform private.require(k.status in ('Draft','Declined'), 'Only draft or declined contracts can be sent');
  perform private.require(k.client_id is not null, 'Contract has no client');
  perform private.require(exists (select 1 from public.contract_versions v where v.contract_id = k.id and v.version_no = k.current_version_no
    and (v.document_url is not null and v.document_url <> '' or v.document_file_id is not null)), 'Attach the contract document before sending');
  perform private.require(exists (select 1 from public.client_users cu where cu.client_id = k.client_id and cu.status <> 'inactive'),
    'The client has no portal user to receive this contract');
  update public.contracts set status = 'Sent', sent_at = now(), assigned_date = now(), updated_at = now() where id = k.id;
  perform private.notify_client(k.client_id, 'contract', 'New contract to review',
    k.title || ' (v' || k.current_version_no || ') is awaiting your review and acceptance.', '/client/contracts',
    'contract-sent:' || k.id || ':' || k.current_version_no);
end $$;

create or replace function public.client_mark_contract_viewed(p_contract_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare k public.contracts;
begin
  select * into k from public.contracts where id = p_contract_id and deleted_at is null for update;
  perform private.require(found and k.client_id = private.current_client_id(), 'Contract not found');
  if k.status = 'Sent' then
    update public.contracts set status = 'Viewed', viewed_at = now(), updated_at = now() where id = k.id;
  end if;
end $$;

create or replace function public.client_accept_contract(
  p_contract_id uuid, p_version_no integer, p_acknowledged boolean, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.contracts; v public.contract_versions; v_ack text :=
  'I have read and agree to the terms and conditions of this contract.';
  v_activated int;
begin
  select * into k from public.contracts where id = p_contract_id and deleted_at is null for update;
  perform private.require(found and k.client_id = private.current_client_id(), 'Contract not found');
  perform private.require(private.has_permission('client.contract.accept'), 'Your account is not permitted to accept contracts. Ask your organisation admin.');
  perform private.require(k.status in ('Sent','Viewed','Awaiting Acceptance'), 'This contract is not awaiting acceptance');
  perform private.require(p_version_no = k.current_version_no, 'A newer version of this contract has been issued. Please review the latest version.');
  perform private.require(p_acknowledged is true, 'You must confirm that you have read and agree to the terms');
  perform private.require(k.end_date is null or k.end_date >= private.today_ist(), 'This contract has already passed its end date');
  select * into v from public.contract_versions where contract_id = k.id and version_no = k.current_version_no;

  insert into public.contract_acceptances(contract_id, project_id, version, url, who, event, note, user_id, client_id,
    contract_version_id, version_no, ip_address, user_agent, acknowledgement)
  values (k.id, k.project_id, 'v' || k.current_version_no, coalesce(v.document_url, k.url, ''),
          coalesce((select full_name from public.client_users where profile_id = auth.uid()), 'Client user'),
          'Accepted', null, auth.uid(), k.client_id, v.id, k.current_version_no, private.request_ip(),
          left(p_user_agent, 400), v_ack);

  update public.contracts set status = 'Accepted', accepted_at = now(), accepted_url = coalesce(v.document_url, k.url),
    updated_at = now() where id = k.id;

  -- COMMIT → ASSIGN: draft deliverables under this contract become active.
  update public.deliverables set status = 'Pending'
  where project_id = k.project_id and status = 'Draft' and deleted_at is null
    and (contract_id is null or contract_id = k.id);
  get diagnostics v_activated = row_count;

  perform private.notify_project_staff(k.project_id, 'contract', 'Contract accepted',
    k.title || ' v' || k.current_version_no || ' was accepted by the client.', '/admin/clients',
    'contract-accepted:' || k.id || ':' || k.current_version_no);
  return jsonb_build_object('status', 'Accepted', 'version_no', k.current_version_no, 'deliverables_activated', v_activated);
end $$;

create or replace function public.client_decline_contract(
  p_contract_id uuid, p_version_no integer, p_reason text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare k public.contracts; v public.contract_versions;
begin
  select * into k from public.contracts where id = p_contract_id and deleted_at is null for update;
  perform private.require(found and k.client_id = private.current_client_id(), 'Contract not found');
  perform private.require(private.has_permission('client.contract.decline'), 'Your account is not permitted to decline contracts');
  perform private.require(k.status in ('Sent','Viewed','Awaiting Acceptance'), 'This contract is not awaiting a response');
  perform private.require(p_version_no = k.current_version_no, 'A newer version of this contract has been issued');
  perform private.require(length(btrim(coalesce(p_reason, ''))) >= 5, 'Please provide a reason for declining this contract');
  select * into v from public.contract_versions where contract_id = k.id and version_no = k.current_version_no;

  insert into public.contract_acceptances(contract_id, project_id, version, url, who, event, note, user_id, client_id,
    contract_version_id, version_no, ip_address, user_agent)
  values (k.id, k.project_id, 'v' || k.current_version_no, coalesce(v.document_url, k.url, ''),
          coalesce((select full_name from public.client_users where profile_id = auth.uid()), 'Client user'),
          'Declined', left(btrim(p_reason), 2000), auth.uid(), k.client_id, v.id, k.current_version_no,
          private.request_ip(), left(p_user_agent, 400));
  update public.contracts set status = 'Declined', declined_at = now(), decline_reason = left(btrim(p_reason), 2000),
    updated_at = now() where id = k.id;
  perform private.notify_project_staff(k.project_id, 'contract', 'Contract declined',
    k.title || ' v' || k.current_version_no || ' was declined: ' || left(btrim(p_reason), 200), '/admin/clients',
    'contract-declined:' || k.id || ':' || k.current_version_no);
end $$;

create or replace function public.staff_terminate_contract(p_contract_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare k public.contracts;
begin
  select * into k from public.contracts where id = p_contract_id and deleted_at is null for update;
  perform private.require(found, 'Contract not found');
  perform private.require(private.has_permission('contract.create'), 'You are not allowed to terminate contracts');
  perform private.require(k.status not in ('Terminated'), 'Contract is already terminated');
  perform private.require(length(btrim(coalesce(p_reason, ''))) >= 5, 'A termination reason is required');
  perform set_config('sigma.change_reason', btrim(p_reason), true);
  update public.contracts set status = 'Terminated', terminated_at = now(), updated_at = now() where id = k.id;
  perform private.notify_client(k.client_id, 'contract', 'Contract terminated', k.title || ' has been terminated.',
    '/client/contracts', 'contract-terminated:' || k.id);
end $$;

-- =========================================================================
-- Deliverable status (staff + responsible employee)
-- =========================================================================
create or replace function public.staff_set_deliverable_status(p_deliverable_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.deliverables; v_is_manager boolean; v_is_owner boolean;
begin
  select * into d from public.deliverables where id = p_deliverable_id and deleted_at is null for update;
  perform private.require(found, 'Deliverable not found');
  v_is_manager := private.project_permission(d.project_id, 'deliverable.status');
  v_is_owner := d.responsible_id is not null and d.responsible_id = private.current_employee_id();
  perform private.require(v_is_manager or v_is_owner, 'You are not allowed to update this deliverable');
  if not v_is_manager then
    perform private.require((d.status, p_status) in (
      ('Pending','In Progress'),('In Progress','Under Internal Review'),('Revision In Progress','Under Internal Review'),
      ('Awaiting Client Dependency','In Progress')),
      'Assigned employees can start work and submit for internal review; a manager handles other transitions');
    if d.status = 'Awaiting Client Dependency' then
      perform private.require(not exists (select 1 from public.deliverable_dependencies dd where dd.deliverable_id = d.id
        and dd.status not in ('Accepted')), 'Client dependencies are still outstanding');
    end if;
  end if;
  perform set_config('sigma.change_reason', coalesce(nullif(btrim(p_note), ''), 'Status → ' || p_status), true);
  update public.deliverables set status = p_status,
    client_action = case when p_status = 'Awaiting Client Review' then 'Review and approve the submitted work'
                         when p_status = 'Ready for Download' then 'Download the final files'
                         when p_status = 'Awaiting Client Dependency' then client_action
                         else null end
  where id = d.id;
end $$;

-- Staff scope / assignment edits. Scope changes on an active deliverable need a
-- reason; the before-trigger versions the scope and the audit log keeps the diff.
create or replace function public.staff_update_deliverable(p_deliverable_id uuid, p_changes jsonb, p_reason text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare d public.deliverables; v_version int; k text;
  v_scope_keys text[] := array['name','description','category','quantity','unit','timeline','start_date','due_date','weightage','dependencies'];
  v_allowed text[] := array['name','description','category','quantity','unit','timeline','start_date','due_date','weightage',
                            'dependencies','priority','responsible_id','assigned_team','reference_url','sort_order','contract_id'];
begin
  select * into d from public.deliverables where id = p_deliverable_id and deleted_at is null for update;
  perform private.require(found, 'Deliverable not found');
  perform private.require(jsonb_typeof(p_changes) = 'object', 'Invalid changes');
  for k in select jsonb_object_keys(p_changes) loop
    perform private.require(k = any(v_allowed), 'Field cannot be edited here: ' || k);
  end loop;
  perform private.require(private.project_permission(d.project_id, 'deliverable.create')
    or (p_changes ?& array['responsible_id'] and (select count(*) from jsonb_object_keys(p_changes)) = 1
        and private.project_permission(d.project_id, 'deliverable.assign')), 'You are not allowed to edit this deliverable');
  if d.status <> 'Draft' and exists (select 1 from unnest(v_scope_keys) s where p_changes ? s) then
    perform private.require(length(btrim(coalesce(p_reason, ''))) >= 5, 'Give a reason for changing the agreed scope');
  end if;
  if p_changes ? 'contract_id' and p_changes ->> 'contract_id' is not null then
    perform private.require(exists (select 1 from public.contracts c where c.id = (p_changes ->> 'contract_id')::uuid and c.project_id = d.project_id),
      'Contract does not belong to this project');
  end if;
  if p_changes ? 'responsible_id' and p_changes ->> 'responsible_id' is not null then
    perform private.require(exists (select 1 from public.employees e where e.id = (p_changes ->> 'responsible_id')::uuid and e.status = 'active'),
      'Selected employee is not active');
  end if;
  perform set_config('sigma.change_reason', coalesce(nullif(btrim(p_reason), ''), 'Edited by project team'), true);
  update public.deliverables set
    name = case when p_changes ? 'name' then btrim(p_changes ->> 'name') else name end,
    description = case when p_changes ? 'description' then nullif(btrim(p_changes ->> 'description'), '') else description end,
    category = case when p_changes ? 'category' then nullif(btrim(p_changes ->> 'category'), '') else category end,
    quantity = case when p_changes ? 'quantity' then (p_changes ->> 'quantity')::numeric else quantity end,
    unit = case when p_changes ? 'unit' then nullif(btrim(p_changes ->> 'unit'), '') else unit end,
    timeline = case when p_changes ? 'timeline' then nullif(btrim(p_changes ->> 'timeline'), '') else timeline end,
    start_date = case when p_changes ? 'start_date' then (p_changes ->> 'start_date')::date else start_date end,
    due_date = case when p_changes ? 'due_date' then (p_changes ->> 'due_date')::date else due_date end,
    weightage = case when p_changes ? 'weightage' then (p_changes ->> 'weightage')::numeric else weightage end,
    dependencies = case when p_changes ? 'dependencies' then coalesce(nullif(btrim(p_changes ->> 'dependencies'), ''), '—') else dependencies end,
    priority = case when p_changes ? 'priority' then p_changes ->> 'priority' else priority end,
    responsible_id = case when p_changes ? 'responsible_id' then (p_changes ->> 'responsible_id')::uuid else responsible_id end,
    assigned_team = case when p_changes ? 'assigned_team' then nullif(btrim(p_changes ->> 'assigned_team'), '') else assigned_team end,
    reference_url = case when p_changes ? 'reference_url' then coalesce(nullif(btrim(p_changes ->> 'reference_url'), ''), '—') else reference_url end,
    sort_order = case when p_changes ? 'sort_order' then (p_changes ->> 'sort_order')::int else sort_order end,
    contract_id = case when p_changes ? 'contract_id' then (p_changes ->> 'contract_id')::uuid else contract_id end
  where id = d.id
  returning version_no into v_version;
  return v_version;
end $$;

create or replace function public.staff_archive_deliverable(p_deliverable_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.deliverables;
begin
  select * into d from public.deliverables where id = p_deliverable_id and deleted_at is null for update;
  perform private.require(found, 'Deliverable not found');
  perform private.require(private.project_permission(d.project_id, 'deliverable.create'), 'Not allowed');
  perform private.require(length(btrim(coalesce(p_reason, ''))) >= 5, 'A reason is required');
  perform private.require(d.status in ('Draft','Pending','Cancelled'), 'Only draft, pending or cancelled deliverables can be archived; cancel it first');
  perform set_config('sigma.change_reason', btrim(p_reason), true);
  update public.deliverables set deleted_at = now() where id = d.id;
end $$;

-- =========================================================================
-- Client review of delivered work
-- =========================================================================
create or replace function public.client_review_deliverable(p_deliverable_id uuid, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.deliverables; v_num text;
begin
  select * into d from public.deliverables where id = p_deliverable_id and deleted_at is null for update;
  perform private.require(found and d.client_id = private.current_client_id() and private.is_client_of_project(d.project_id), 'Deliverable not found');
  perform private.require(private.has_permission('client.deliverable.review'), 'Your account is not permitted to review deliverables');
  perform private.require(d.status = 'Awaiting Client Review', 'This deliverable is not awaiting your review');
  if p_approve then
    perform set_config('sigma.change_reason', 'Approved by client' || coalesce(': ' || nullif(btrim(p_comment), ''), ''), true);
    update public.deliverables set status = 'Completed', client_action = null where id = d.id;
    perform private.notify_project_staff(d.project_id, 'deliverable', 'Client approved deliverable',
      d.deliverable_number || ' · ' || d.name || ' was approved by the client.', '/admin/clients',
      'deliv-approved:' || d.id || ':' || d.version_no);
    if d.responsible_id is not null then
      perform private.notify_employee(d.responsible_id, 'deliverable', 'Client approved your work',
        d.deliverable_number || ' · ' || d.name, '/my-deliverables', 'deliv-approved-emp:' || d.id || ':' || d.version_no);
    end if;
  else
    perform private.require(length(btrim(coalesce(p_comment, ''))) >= 5, 'Describe the changes you need');
    perform pg_advisory_xact_lock(hashtext('cr-num:' || d.project_id::text));
    select 'CR-' || lpad((count(*) + 1)::text, 3, '0') into v_num from public.change_requests where project_id = d.project_id;
    insert into public.change_requests(project_id, deliverable_id, request_number, field, previous_value, requested_value,
      reason, requested_by, requested_by_name, status, modification_type)
    values (d.project_id, d.id, v_num, 'Revision', 'Version ' || d.version_no, left(btrim(p_comment), 2000),
      left(btrim(p_comment), 2000), auth.uid(), (select full_name from public.client_users where profile_id = auth.uid()),
      'Pending Review', 'revision');
    perform set_config('sigma.change_reason', 'Client requested changes', true);
    update public.deliverables set status = 'Modification Requested', client_action = null where id = d.id;
    if d.responsible_id is not null then
      perform private.notify_employee(d.responsible_id, 'modification', 'Client requested changes',
        d.deliverable_number || ' · ' || left(btrim(p_comment), 180), '/my-deliverables', 'deliv-revision:' || d.id || ':' || v_num);
    end if;
  end if;
end $$;

-- =========================================================================
-- Modification requests
-- =========================================================================
create or replace function public.client_request_modification(
  p_deliverable_id uuid, p_type text, p_reason text,
  p_requested_quantity numeric default null, p_requested_due_date date default null,
  p_requested_value text default null, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.deliverables; v_id uuid; v_num text; v_field text; v_prev text; v_next text;
begin
  if p_idempotency_key is not null then
    select id into v_id from public.change_requests where idempotency_key = p_idempotency_key and requested_by = auth.uid();
    if v_id is not null then return v_id; end if;
  end if;
  select * into d from public.deliverables where id = p_deliverable_id and deleted_at is null for update;
  perform private.require(found and d.client_id = private.current_client_id() and private.is_client_of_project(d.project_id)
    and d.status <> 'Draft', 'Deliverable not found');
  perform private.require(private.has_permission('client.modification.request'), 'Your account is not permitted to request modifications');
  perform private.require(d.status not in ('Cancelled'), 'Cancelled deliverables cannot be modified');
  perform private.require(p_type in ('quantity','scope','timeline','other'), 'Choose a modification type');
  perform private.require(length(btrim(coalesce(p_reason, ''))) >= 5, 'Please enter a reason for this request');

  if p_type = 'quantity' then
    perform private.require(p_requested_quantity is not null and p_requested_quantity >= 0, 'Enter the requested quantity');
    perform private.require(p_requested_quantity <> d.quantity, 'Requested quantity is the same as the current quantity');
    v_field := 'Quantity'; v_prev := trim_scale(d.quantity)::text; v_next := trim_scale(p_requested_quantity)::text;
  elsif p_type = 'timeline' then
    perform private.require(p_requested_due_date is not null, 'Choose the requested delivery date');
    perform private.require(p_requested_due_date is distinct from d.due_date, 'Requested date is the same as the current date');
    v_field := 'Timeline'; v_prev := coalesce(to_char(d.due_date, 'YYYY-MM-DD'), 'Not set'); v_next := to_char(p_requested_due_date, 'YYYY-MM-DD');
  else
    perform private.require(length(btrim(coalesce(p_requested_value, ''))) >= 3, 'Describe the requested change');
    v_field := case when p_type = 'scope' then 'Description or scope' else 'Other' end;
    v_prev := coalesce(d.description, '—'); v_next := left(btrim(p_requested_value), 2000);
  end if;

  perform private.require(not exists (select 1 from public.change_requests r where r.deliverable_id = d.id
    and r.modification_type = p_type and r.status in ('Pending Review','Counter Proposed')),
    'There is already an open request of this type for this deliverable');

  perform pg_advisory_xact_lock(hashtext('cr-num:' || d.project_id::text));
  select 'CR-' || lpad((count(*) + 1)::text, 3, '0') into v_num from public.change_requests where project_id = d.project_id;

  insert into public.change_requests(project_id, deliverable_id, request_number, field, previous_value, requested_value,
    reason, requested_by, requested_by_name, status, modification_type, original_quantity, requested_quantity,
    original_due_date, requested_due_date, idempotency_key)
  values (d.project_id, d.id, v_num, v_field, v_prev, v_next, left(btrim(p_reason), 2000), auth.uid(),
    (select full_name from public.client_users where profile_id = auth.uid()), 'Pending Review', p_type,
    case when p_type = 'quantity' then d.quantity end, case when p_type = 'quantity' then p_requested_quantity end,
    case when p_type = 'timeline' then d.due_date end, case when p_type = 'timeline' then p_requested_due_date end,
    p_idempotency_key)
  returning id into v_id;

  perform private.notify_project_staff(d.project_id, 'modification', 'Modification requested',
    v_num || ' · ' || d.deliverable_number || ' ' || v_field || ': ' || v_prev || ' → ' || left(v_next, 120),
    '/admin/clients', 'cr-new:' || v_id);
  if d.responsible_id is not null then
    perform private.notify_employee(d.responsible_id, 'modification', 'Client requested a modification',
      v_num || ' · ' || d.deliverable_number || ' ' || d.name, '/my-deliverables', 'cr-new-emp:' || v_id);
  end if;
  return v_id;
end $$;

create or replace function private.apply_modification(r public.change_requests, p_quantity numeric, p_due date, p_value text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_version int;
begin
  perform set_config('sigma.change_source', 'modification_request', true);
  perform set_config('sigma.change_request_id', r.id::text, true);
  perform set_config('sigma.change_reason', r.request_number || ': ' || coalesce(r.reason, ''), true);
  if r.modification_type = 'quantity' then
    update public.deliverables set quantity = p_quantity where id = r.deliverable_id returning version_no into v_version;
  elsif r.modification_type = 'timeline' then
    update public.deliverables set due_date = p_due where id = r.deliverable_id returning version_no into v_version;
  elsif r.modification_type = 'scope' then
    update public.deliverables set description = p_value where id = r.deliverable_id returning version_no into v_version;
  elsif r.modification_type = 'revision' then
    update public.deliverables set status = 'Revision In Progress' where id = r.deliverable_id and status = 'Modification Requested'
    returning version_no into v_version;
  else
    select version_no into v_version from public.deliverables where id = r.deliverable_id;
  end if;
  perform set_config('sigma.change_source', '', true);
  perform set_config('sigma.change_request_id', '', true);
  return v_version;
end $$;

create or replace function public.staff_review_modification(
  p_request_id uuid, p_decision text, p_comment text,
  p_counter_quantity numeric default null, p_counter_due_date date default null, p_counter_value text default null,
  p_billing_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.change_requests; v_version int; v_reviewer text;
begin
  select * into r from public.change_requests where id = p_request_id for update;
  perform private.require(found, 'Request not found');
  perform private.require(private.project_permission(r.project_id, 'deliverable.modification.approve'),
    'You are not allowed to review modification requests');
  perform private.require(r.status = 'Pending Review', 'This request has already been decided');
  perform private.require(p_decision in ('approve','reject','counter'), 'Invalid decision');
  perform private.require(p_decision = 'approve' or length(btrim(coalesce(p_comment, ''))) >= 3, 'A comment is required');
  select coalesce(e.name, 'IRA team') into v_reviewer from public.profiles p left join public.employees e on e.profile_id = p.id where p.id = auth.uid();

  if p_decision = 'approve' then
    perform pg_advisory_xact_lock(hashtext('deliv:' || r.deliverable_id::text));
    v_version := private.apply_modification(r, r.requested_quantity, r.requested_due_date, r.requested_value);
    update public.change_requests set status = 'Approved', reviewer_name = v_reviewer, reviewed_by = auth.uid(),
      reviewer_comment = coalesce(nullif(btrim(p_comment), ''), 'Approved'), reviewed_at = now(),
      billing_note = nullif(btrim(p_billing_note), ''), applied_version_no = v_version, updated_at = now()
    where id = r.id;
  elsif p_decision = 'reject' then
    update public.change_requests set status = 'Rejected', reviewer_name = v_reviewer, reviewed_by = auth.uid(),
      reviewer_comment = btrim(p_comment), reviewed_at = now(), updated_at = now() where id = r.id;
    if r.modification_type = 'revision' then
      perform set_config('sigma.change_reason', r.request_number || ' rejected', true);
      update public.deliverables set status = 'Awaiting Client Review' where id = r.deliverable_id and status = 'Modification Requested';
    end if;
  else
    perform private.require(r.modification_type in ('quantity','timeline','scope'), 'Counter-proposals apply to quantity, timeline or scope requests');
    perform private.require(
      (r.modification_type = 'quantity' and p_counter_quantity is not null and p_counter_quantity >= 0)
      or (r.modification_type = 'timeline' and p_counter_due_date is not null)
      or (r.modification_type = 'scope' and length(btrim(coalesce(p_counter_value, ''))) >= 3),
      'Enter the counter-proposal');
    update public.change_requests set status = 'Counter Proposed', reviewer_name = v_reviewer, reviewed_by = auth.uid(),
      reviewer_comment = btrim(p_comment), counter_quantity = p_counter_quantity, counter_due_date = p_counter_due_date,
      counter_value = nullif(btrim(p_counter_value), ''), billing_note = nullif(btrim(p_billing_note), ''),
      reviewed_at = now(), updated_at = now()
    where id = r.id;
  end if;

  perform private.notify_client(r.client_id, 'modification',
    case p_decision when 'approve' then 'Modification approved' when 'reject' then 'Modification not approved' else 'Counter-proposal received' end,
    r.request_number || coalesce(' · ' || nullif(btrim(p_comment), ''), ''), '/client/deliverables',
    'cr-decision:' || r.id || ':' || p_decision);
  if p_decision = 'approve' then
    perform private.notify_employee((select responsible_id from public.deliverables where id = r.deliverable_id), 'modification',
      'Scope updated on your deliverable', r.request_number || ' approved — ' || r.field || ': ' || r.previous_value || ' → ' || left(r.requested_value, 120),
      '/my-deliverables', 'cr-approved-emp:' || r.id);
  end if;
end $$;

create or replace function public.client_respond_to_counter(p_request_id uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.change_requests; v_version int;
begin
  select * into r from public.change_requests where id = p_request_id for update;
  perform private.require(found and r.client_id = private.current_client_id() and private.is_client_of_project(r.project_id), 'Request not found');
  perform private.require(private.has_permission('client.modification.request'), 'Not permitted');
  perform private.require(r.status = 'Counter Proposed', 'There is no counter-proposal to respond to');
  if p_accept then
    perform pg_advisory_xact_lock(hashtext('deliv:' || r.deliverable_id::text));
    v_version := private.apply_modification(r, r.counter_quantity, r.counter_due_date, r.counter_value);
    update public.change_requests set status = 'Counter Accepted', client_response_note = nullif(btrim(p_note), ''),
      applied_version_no = v_version, updated_at = now() where id = r.id;
  else
    update public.change_requests set status = 'Counter Declined', client_response_note = nullif(btrim(p_note), ''),
      updated_at = now() where id = r.id;
  end if;
  perform private.notify_project_staff(r.project_id, 'modification',
    case when p_accept then 'Counter-proposal accepted' else 'Counter-proposal declined' end,
    r.request_number || coalesce(' · ' || nullif(btrim(p_note), ''), ''), '/admin/clients', 'cr-counter-resp:' || r.id);
end $$;

create or replace function public.client_withdraw_modification(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.change_requests;
begin
  select * into r from public.change_requests where id = p_request_id for update;
  perform private.require(found and r.client_id = private.current_client_id(), 'Request not found');
  perform private.require(r.status in ('Pending Review','Counter Proposed'), 'Only open requests can be withdrawn');
  update public.change_requests set status = 'Withdrawn', updated_at = now() where id = r.id;
  if r.modification_type = 'revision' then
    perform set_config('sigma.change_reason', r.request_number || ' withdrawn', true);
    update public.deliverables set status = 'Awaiting Client Review' where id = r.deliverable_id and status = 'Modification Requested';
  end if;
end $$;

-- =========================================================================
-- Client dependencies
-- =========================================================================
create or replace function public.staff_request_dependency(
  p_deliverable_id uuid, p_name text, p_description text default null, p_required_by date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.deliverables; v_id uuid;
begin
  select * into d from public.deliverables where id = p_deliverable_id and deleted_at is null for update;
  perform private.require(found, 'Deliverable not found');
  perform private.require(private.can_manage_project(d.project_id)
    or (d.responsible_id is not null and d.responsible_id = private.current_employee_id()), 'Not allowed');
  perform private.require(d.status not in ('Draft','Cancelled','Completed','Ready for Download'), 'Dependencies can only be requested on active deliverables');
  perform private.require(length(btrim(coalesce(p_name, ''))) >= 2, 'Name what the client needs to provide');
  insert into public.deliverable_dependencies(deliverable_id, project_id, name, description, required_by, status, requested_by)
  values (d.id, d.project_id, btrim(p_name), nullif(btrim(p_description), ''), p_required_by, 'Requested', auth.uid())
  returning id into v_id;
  perform set_config('sigma.change_reason', 'Waiting on client: ' || btrim(p_name), true);
  update public.deliverables set
    status = case when status in ('Pending','In Progress') then 'Awaiting Client Dependency' else status end,
    client_action = 'Provide: ' || btrim(p_name)
  where id = d.id;
  perform private.notify_client(d.client_id, 'dependency', 'Information required from you',
    btrim(p_name) || ' is needed for ' || d.deliverable_number || ' · ' || d.name
      || coalesce(' by ' || to_char(p_required_by, 'DD Mon YYYY'), '') || '.', '/client/progress', 'dep-new:' || v_id);
  return v_id;
end $$;

create or replace function public.client_submit_dependency(p_dependency_id uuid, p_note text default null, p_file_ids uuid[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare dd public.deliverable_dependencies; d public.deliverables; v_bad int;
begin
  select * into dd from public.deliverable_dependencies where id = p_dependency_id for update;
  perform private.require(found and dd.client_id = private.current_client_id() and private.is_client_of_project(dd.project_id), 'Request not found');
  perform private.require(private.has_permission('client.dependency.upload'), 'Your account is not permitted to upload dependencies');
  perform private.require(dd.status in ('Requested','Pending','Rejected','Resubmission Required'), 'This item has already been provided');
  perform private.require(coalesce(array_length(p_file_ids, 1), 0) > 0 or length(btrim(coalesce(p_note, ''))) >= 3,
    'Attach a file or provide the requested information');
  select count(*) into v_bad from unnest(coalesce(p_file_ids, '{}')) fid
  where not exists (select 1 from public.files f where f.id = fid and f.parent_type = 'dependency' and f.parent_id = dd.id
                    and f.uploaded_by = auth.uid() and f.deleted_at is null);
  perform private.require(v_bad = 0, 'One or more attachments are invalid');
  update public.deliverable_dependencies set status = 'Uploaded', client_note = nullif(btrim(p_note), ''),
    uploaded_by = auth.uid(), uploaded_at = now(), updated_at = now() where id = dd.id;
  select * into d from public.deliverables where id = dd.deliverable_id;
  if d.responsible_id is not null then
    perform private.notify_employee(d.responsible_id, 'dependency', 'Client provided a dependency',
      dd.name || ' for ' || d.deliverable_number || ' · ' || d.name, '/my-deliverables', 'dep-up:' || dd.id || ':' || extract(epoch from now())::bigint);
  end if;
  perform private.notify_project_staff(dd.project_id, 'dependency', 'Client provided a dependency',
    dd.name || ' for ' || d.deliverable_number || ' · ' || d.name, '/admin/clients', 'dep-up-staff:' || dd.id || ':' || extract(epoch from now())::bigint);
end $$;

create or replace function public.staff_review_dependency(p_dependency_id uuid, p_decision text, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare dd public.deliverable_dependencies; d public.deliverables; v_open int;
begin
  select * into dd from public.deliverable_dependencies where id = p_dependency_id for update;
  perform private.require(found, 'Dependency not found');
  select * into d from public.deliverables where id = dd.deliverable_id for update;
  perform private.require(private.can_manage_project(dd.project_id)
    or (d.responsible_id is not null and d.responsible_id = private.current_employee_id()), 'Not allowed');
  perform private.require(p_decision in ('accept','reject','resubmit'), 'Invalid decision');
  perform private.require(dd.status = 'Uploaded', 'Only uploaded items can be reviewed');
  perform private.require(p_decision = 'accept' or length(btrim(coalesce(p_comment, ''))) >= 3, 'Explain what is missing');
  update public.deliverable_dependencies set
    status = case p_decision when 'accept' then 'Accepted' when 'reject' then 'Rejected' else 'Resubmission Required' end,
    review_comment = nullif(btrim(p_comment), ''), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = dd.id;

  select count(*) into v_open from public.deliverable_dependencies where deliverable_id = d.id and status <> 'Accepted';
  if p_decision = 'accept' and v_open = 0 and d.status = 'Awaiting Client Dependency' then
    perform set_config('sigma.change_reason', 'All client dependencies accepted', true);
    update public.deliverables set status = 'In Progress', client_action = null where id = d.id;
  elsif p_decision <> 'accept' then
    update public.deliverables set client_action = 'Re-upload: ' || dd.name where id = d.id;
    perform private.notify_client(dd.client_id, 'dependency', 'Please re-submit requested information',
      dd.name || ': ' || btrim(p_comment), '/client/progress', 'dep-review:' || dd.id || ':' || extract(epoch from now())::bigint);
  end if;
  if p_decision = 'accept' and v_open = 0 then
    update public.deliverables set client_action = null where id = d.id and client_action is not null;
  end if;
end $$;

-- =========================================================================
-- Files
-- =========================================================================
create or replace function public.attach_file(
  p_storage_path text, p_parent_type text, p_parent_id uuid, p_name text,
  p_mime_type text default null, p_size_bytes bigint default null, p_visibility text default 'internal',
  p_is_final boolean default false, p_replaces_file_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_client_user uuid := private.current_client_id();
  v_project uuid; v_client uuid; v_group uuid; v_version int := 1; v_id uuid;
  v_allowed boolean := false; v_prev public.files;
begin
  perform private.require(v_uid is not null, 'Authentication required');
  perform private.require(p_storage_path like v_uid::text || '/%', 'Upload path is not owned by you');
  perform private.require(exists (select 1 from storage.objects o where o.bucket_id = 'sigma-files' and o.name = p_storage_path
    and o.owner_id = v_uid::text), 'Uploaded object not found');
  perform private.require(not exists (select 1 from public.files where storage_path = p_storage_path), 'File already attached');
  perform private.require(p_visibility in ('internal','client'), 'Invalid visibility');

  case p_parent_type
    when 'deliverable' then
      select project_id, client_id into v_project, v_client from public.deliverables where id = p_parent_id and deleted_at is null;
      v_allowed := v_client_user is null and (private.project_permission(v_project, 'deliverable.upload')
        or exists (select 1 from public.deliverables d where d.id = p_parent_id and d.responsible_id = private.current_employee_id()));
    when 'dependency' then
      select project_id, client_id into v_project, v_client from public.deliverable_dependencies where id = p_parent_id;
      v_allowed := (v_client_user is not null and v_client_user = v_client and private.has_permission('client.dependency.upload'))
        or (v_client_user is null and private.can_manage_project(v_project));
      if v_client_user is not null then p_visibility := 'client'; p_is_final := false; end if;
    when 'payment' then
      select project_id, client_id into v_project, v_client from public.payment_installments where id = p_parent_id and deleted_at is null;
      v_allowed := (v_client_user is not null and v_client_user = v_client and private.has_permission('client.payment.submit'))
        or (v_client_user is null and private.has_permission('payment.record'));
      if v_client_user is not null then p_visibility := 'client'; end if;
      p_is_final := false;
    when 'invoice' then
      select project_id, client_id into v_project, v_client from public.payment_installments where id = p_parent_id and deleted_at is null;
      v_allowed := v_client_user is null and private.has_permission('invoice.generate');
    when 'contract' then
      select project_id, client_id into v_project, v_client from public.contracts where id = p_parent_id and deleted_at is null;
      v_allowed := v_client_user is null and private.has_permission('contract.create');
    when 'task' then
      select project_id into v_project from public.tasks where id = p_parent_id;
      select client_id into v_client from public.projects where id = v_project;
      v_allowed := v_client_user is null and exists (select 1 from public.tasks t where t.id = p_parent_id
        and (private.is_admin() or t.assigned_to = private.current_employee_id() or t.assigned_by = private.current_employee_id()));
      p_visibility := 'internal';
    else
      v_allowed := false;
  end case;
  perform private.require(v_allowed, 'You are not allowed to attach files here');

  if p_replaces_file_id is not null then
    select * into v_prev from public.files where id = p_replaces_file_id and deleted_at is null;
    perform private.require(found and v_prev.parent_type = p_parent_type and v_prev.parent_id = p_parent_id, 'Invalid file to replace');
    perform pg_advisory_xact_lock(hashtext('file-group:' || v_prev.file_group_id::text));
    v_group := v_prev.file_group_id;
    select max(version_no) + 1 into v_version from public.files where file_group_id = v_group;
  else
    v_group := gen_random_uuid();
  end if;

  insert into public.files(file_group_id, version_no, parent_type, parent_id, client_id, project_id, name, mime_type,
    size_bytes, storage_path, visibility, is_final, uploaded_by)
  values (v_group, v_version, p_parent_type, p_parent_id, v_client, v_project, left(btrim(p_name), 255), p_mime_type,
    p_size_bytes, p_storage_path, p_visibility, coalesce(p_is_final, false), v_uid)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.archive_file(p_file_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.files;
begin
  select * into f from public.files where id = p_file_id and deleted_at is null for update;
  perform private.require(found, 'File not found');
  perform private.require(private.is_admin() or (f.project_id is not null and private.can_manage_project(f.project_id))
    or (f.uploaded_by = auth.uid() and private.current_client_id() is null), 'Not allowed');
  perform private.require(length(btrim(coalesce(p_reason, ''))) >= 3, 'A reason is required');
  perform set_config('sigma.change_reason', btrim(p_reason), true);
  update public.files set deleted_at = now() where id = f.id;
end $$;

-- =========================================================================
-- Billing: status, payments, locks
-- =========================================================================
create or replace function private.installment_status(i public.payment_installments)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_total numeric := coalesce(i.amount, 0) + coalesce(i.tax_amount, 0); v_today date := private.today_ist();
  v_soon int;
begin
  if i.status_override is not null then return i.status_override; end if;
  if v_total > 0 and i.amount_paid >= v_total then return 'Paid'; end if;
  if i.due_date is null then return case when i.amount_paid > 0 then 'Partially Paid' else 'Upcoming' end; end if;
  if v_today > i.due_date then return 'Overdue'; end if;
  if i.amount_paid > 0 then return 'Partially Paid'; end if;
  select due_soon_days into v_soon from public.billing_settings where id;
  if i.due_date - v_today <= coalesce(v_soon, 7) then return 'Due'; end if;
  return 'Upcoming';
end $$;

create or replace function private.installments_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_value numeric; v_n int;
begin
  select client_id into new.client_id from public.projects where id = new.project_id;
  if new.contract_id is not null then
    perform private.require(exists (select 1 from public.contracts k where k.id = new.contract_id and k.project_id = new.project_id),
      'Contract does not belong to this project');
  end if;
  if new.basis_type = 'percentage' then
    perform private.require(new.percentage is not null, 'Percentage is required for percentage-based milestones');
    select contract_value into v_value from public.contracts where id = new.contract_id;
    perform private.require(v_value is not null, 'Link a contract with a contract value to use percentage-based milestones');
    new.amount := round(v_value * new.percentage / 100, 2);
    new.basis := trim_scale(new.percentage)::text || '% of contract value';
  end if;
  if tg_op = 'INSERT' then
    if new.installment_number is null or new.installment_number <= 0 then
      perform pg_advisory_xact_lock(hashtext('inst-num:' || new.project_id::text));
      select coalesce(max(installment_number), 0) + 1 into v_n from public.payment_installments where project_id = new.project_id;
      new.installment_number := v_n;
    end if;
    new.amount_paid := 0;
  elsif coalesce(current_setting('sigma.payment_recalc', true), '') <> 'on' then
    new.amount_paid := old.amount_paid;  -- only verified payments change amount_paid
  end if;
  new.status := private.installment_status(new);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_installments_before_write on public.payment_installments;
create trigger trg_installments_before_write before insert or update on public.payment_installments
for each row execute function private.installments_before_write();

create or replace function private.recalc_installment(p_installment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('sigma.payment_recalc', 'on', true);
  update public.payment_installments i set
    amount_paid = coalesce((select sum(p.amount) from public.payments p where p.installment_id = i.id and p.status = 'Verified'), 0),
    paid_on = (select max(p.paid_on) from public.payments p where p.installment_id = i.id and p.status = 'Verified'),
    payment_reference = coalesce((select p.reference from public.payments p where p.installment_id = i.id and p.status = 'Verified'
                                  order by p.verified_at desc limit 1), i.payment_reference),
    verified_by = (select p.verified_by from public.payments p where p.installment_id = i.id and p.status = 'Verified' order by p.verified_at desc limit 1),
    verified_at = (select max(p.verified_at) from public.payments p where p.installment_id = i.id and p.status = 'Verified')
  where i.id = p_installment_id;
  perform set_config('sigma.payment_recalc', '', true);
end $$;

create or replace function private.evaluate_project_locks(p_project_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid; v_enabled boolean; v_grace int; v_inst public.payment_installments; r record;
  v_today date := private.today_ist();
begin
  select client_id into v_client from public.projects where id = p_project_id;
  select coalesce(cr.auto_lock_enabled, bs.auto_lock_enabled), coalesce(cr.grace_days, bs.grace_days)
    into v_enabled, v_grace
  from public.billing_settings bs left join public.client_billing_rules cr on cr.client_id = v_client
  where bs.id;

  select * into v_inst from public.payment_installments i
  where i.project_id = p_project_id and i.deleted_at is null and i.status = 'Overdue'
    and i.due_date is not null and (v_today - i.due_date) > coalesce(v_grace, 0)
  order by i.due_date limit 1;

  perform set_config('sigma.lock_change', 'on', true);
  if coalesce(v_enabled, false) and v_inst.id is not null then
    for r in update public.deliverables set lock_state = 'locked_payment', locked_at = now(),
               lock_reason = 'Payment overdue: ' || v_inst.name
             where project_id = p_project_id and deleted_at is null and lock_state = 'unlocked'
             returning id
    loop
      insert into public.deliverable_lock_events(deliverable_id, previous_state, new_state, source, reason, installment_id, actor_id)
      values (r.id, 'unlocked', 'locked_payment', 'payment_rule', 'Payment overdue beyond grace period: ' || v_inst.name, v_inst.id, auth.uid());
    end loop;
    if found then
      perform private.notify_client(v_client, 'billing', 'Downloads temporarily unavailable',
        'Download access is paused because ' || v_inst.name || ' is overdue. It is restored automatically once payment is verified.',
        '/client/payments', 'lock:' || p_project_id || ':' || v_inst.id);
      perform private.notify_project_staff(p_project_id, 'billing', 'Deliverables locked for overdue payment',
        v_inst.name || ' is overdue; client downloads are locked.', '/admin/clients', 'lock-staff:' || p_project_id || ':' || v_inst.id, true);
    end if;
  else
    for r in update public.deliverables set lock_state = 'unlocked', locked_at = null, lock_reason = null
             where project_id = p_project_id and lock_state = 'locked_payment'
             returning id
    loop
      insert into public.deliverable_lock_events(deliverable_id, previous_state, new_state, source, reason, actor_id)
      values (r.id, 'locked_payment', 'unlocked', 'payment_cleared', 'No overdue payment beyond grace period', auth.uid());
    end loop;
    if found then
      perform private.notify_client(v_client, 'billing', 'Downloads restored', 'Thank you — deliverable downloads are available again.',
        '/client/deliverables', 'unlock:' || p_project_id || ':' || v_today);
    end if;
  end if;
  perform set_config('sigma.lock_change', '', true);
end $$;

create or replace function public.client_submit_payment(
  p_installment_id uuid, p_amount numeric, p_reference text, p_paid_on date,
  p_method text default null, p_proof_file_id uuid default null, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.payment_installments; v_id uuid; v_outstanding numeric;
begin
  if p_idempotency_key is not null then
    select id into v_id from public.payments where idempotency_key = p_idempotency_key and submitted_by = auth.uid();
    if v_id is not null then return v_id; end if;
  end if;
  select * into i from public.payment_installments where id = p_installment_id and deleted_at is null for update;
  perform private.require(found and i.client_id = private.current_client_id() and private.is_client_of_project(i.project_id), 'Payment milestone not found');
  perform private.require(private.has_permission('client.payment.submit'), 'Your account is not permitted to submit payments');
  perform private.require(i.status not in ('Paid','Cancelled','Waived'), 'This milestone does not accept payments');
  v_outstanding := i.amount + i.tax_amount - i.amount_paid
    - coalesce((select sum(amount) from public.payments where installment_id = i.id and status = 'Submitted'), 0);
  perform private.require(p_amount is not null and p_amount > 0, 'Enter the amount paid');
  perform private.require(p_amount <= v_outstanding, 'Amount exceeds the outstanding balance awaiting verification (' || v_outstanding || ')');
  perform private.require(length(btrim(coalesce(p_reference, ''))) >= 3, 'Enter the bank / UPI transaction reference');
  perform private.require(p_paid_on is not null and p_paid_on <= private.today_ist() and p_paid_on > private.today_ist() - 365, 'Enter a valid payment date');
  perform private.require(p_proof_file_id is null or exists (select 1 from public.files f where f.id = p_proof_file_id
    and f.parent_type = 'payment' and f.parent_id = i.id and f.uploaded_by = auth.uid()), 'Invalid payment proof');

  insert into public.payments(installment_id, project_id, amount, reference, paid_on, method, proof_file_id, status, source,
    submitted_by, idempotency_key)
  values (i.id, i.project_id, p_amount, btrim(p_reference), p_paid_on, p_method, p_proof_file_id, 'Submitted', 'client',
    auth.uid(), p_idempotency_key)
  returning id into v_id;

  perform private.notify_project_staff(i.project_id, 'billing', 'Payment submitted for verification',
    i.name || ': ₹' || to_char(p_amount, 'FM99,99,99,999.00') || ' · ref ' || btrim(p_reference), '/admin/clients',
    'pay-submitted:' || v_id, true);
  return v_id;
exception when unique_violation then
  raise exception 'This payment reference has already been submitted for this milestone' using errcode = 'P0001';
end $$;

create or replace function public.finance_verify_payment(p_payment_id uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.payments; i public.payment_installments;
begin
  perform private.require(private.has_permission('payment.record'), 'You are not allowed to verify payments');
  select * into p from public.payments where id = p_payment_id for update;
  perform private.require(found, 'Payment not found');
  perform private.require(p.status = 'Submitted', 'This payment has already been processed');
  perform private.require(p.submitted_by is distinct from auth.uid(), 'You cannot verify a payment you submitted');
  select * into i from public.payment_installments where id = p.installment_id for update;
  if p_approve then
    perform private.require(p.amount <= i.amount + i.tax_amount - i.amount_paid, 'Verifying this payment would exceed the milestone total');
    update public.payments set status = 'Verified', verified_by = auth.uid(), verified_at = now(), notes = coalesce(nullif(btrim(p_reason), ''), notes)
    where id = p.id;
  else
    perform private.require(length(btrim(coalesce(p_reason, ''))) >= 3, 'A rejection reason is required');
    update public.payments set status = 'Rejected', verified_by = auth.uid(), verified_at = now(), rejection_reason = btrim(p_reason)
    where id = p.id;
  end if;
  perform private.recalc_installment(i.id);
  perform private.evaluate_project_locks(i.project_id);
  perform private.notify_client(i.client_id, 'billing',
    case when p_approve then 'Payment verified' else 'Payment could not be verified' end,
    i.name || ': ₹' || to_char(p.amount, 'FM99,99,99,999.00') || ' · ref ' || p.reference
      || case when p_approve then '' else ' — ' || btrim(p_reason) end, '/client/payments', 'pay-verified:' || p.id);
end $$;

create or replace function public.finance_record_payment(
  p_installment_id uuid, p_amount numeric, p_reference text, p_paid_on date,
  p_method text default null, p_notes text default null, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.payment_installments; v_id uuid;
begin
  perform private.require(private.has_permission('payment.record'), 'You are not allowed to record payments');
  if p_idempotency_key is not null then
    select id into v_id from public.payments where idempotency_key = p_idempotency_key;
    if v_id is not null then return v_id; end if;
  end if;
  select * into i from public.payment_installments where id = p_installment_id and deleted_at is null for update;
  perform private.require(found, 'Payment milestone not found');
  perform private.require(i.status not in ('Paid','Cancelled','Waived'), 'This milestone does not accept payments');
  perform private.require(p_amount is not null and p_amount > 0 and p_amount <= i.amount + i.tax_amount - i.amount_paid,
    'Amount must be positive and not exceed the outstanding balance');
  perform private.require(length(btrim(coalesce(p_reference, ''))) >= 3, 'Enter the bank statement / UTR reference');
  perform private.require(p_paid_on is not null and p_paid_on <= private.today_ist(), 'Enter the date the funds were received');
  insert into public.payments(installment_id, project_id, amount, reference, paid_on, method, status, source, notes,
    submitted_by, verified_by, verified_at, idempotency_key)
  values (i.id, i.project_id, p_amount, btrim(p_reference), p_paid_on, p_method, 'Verified', 'finance', nullif(btrim(p_notes), ''),
    auth.uid(), auth.uid(), now(), p_idempotency_key)
  returning id into v_id;
  perform private.recalc_installment(i.id);
  perform private.evaluate_project_locks(i.project_id);
  perform private.notify_client(i.client_id, 'billing', 'Payment received',
    i.name || ': ₹' || to_char(p_amount, 'FM99,99,99,999.00') || ' received. Thank you.', '/client/payments', 'pay-recorded:' || v_id);
  return v_id;
exception when unique_violation then
  raise exception 'This payment reference is already recorded for this milestone' using errcode = 'P0001';
end $$;

create or replace function public.finance_set_installment_override(p_installment_id uuid, p_override text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.payment_installments;
begin
  perform private.require(private.has_permission('payment.record'), 'Not allowed');
  perform private.require(p_override is null or p_override in ('Disputed','Cancelled','Waived'), 'Invalid status');
  perform private.require(length(btrim(coalesce(p_reason, ''))) >= 5, 'A reason is required');
  select * into i from public.payment_installments where id = p_installment_id and deleted_at is null for update;
  perform private.require(found, 'Payment milestone not found');
  perform set_config('sigma.change_reason', btrim(p_reason), true);
  update public.payment_installments set status_override = p_override, status_reason = btrim(p_reason) where id = i.id;
  perform private.evaluate_project_locks(i.project_id);
end $$;

create sequence if not exists public.invoice_number_seq;
create or replace function public.finance_issue_invoice(p_installment_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare i public.payment_installments; v_no text;
begin
  perform private.require(private.has_permission('invoice.generate'), 'Not allowed');
  select * into i from public.payment_installments where id = p_installment_id and deleted_at is null for update;
  perform private.require(found, 'Payment milestone not found');
  if i.invoice_number is not null then return i.invoice_number; end if;
  perform private.require(i.status not in ('Cancelled','Waived'), 'Cannot invoice a cancelled or waived milestone');
  v_no := 'INV-' || to_char(private.today_ist(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 5, '0');
  update public.payment_installments set invoice_number = v_no, invoice_issued_at = now() where id = i.id;
  perform private.notify_client(i.client_id, 'billing', 'New invoice issued',
    v_no || ' · ' || i.name || ': ₹' || to_char(i.amount + i.tax_amount, 'FM99,99,99,999.00')
      || coalesce(' due ' || to_char(i.due_date, 'DD Mon YYYY'), ''), '/client/payments', 'invoice:' || i.id);
  return v_no;
end $$;

create or replace function public.finance_generate_recurring_installments(
  p_project_id uuid, p_contract_id uuid, p_name text, p_amount numeric, p_tax_amount numeric,
  p_first_due date, p_months integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare m int;
begin
  perform private.require(private.has_permission('invoice.generate'), 'Not allowed');
  perform private.require(p_months between 1 and 36, 'Choose between 1 and 36 months');
  perform private.require(p_amount > 0 and coalesce(p_tax_amount, 0) >= 0, 'Enter a valid monthly amount');
  perform private.require(p_first_due is not null, 'First due date is required');
  for m in 0 .. p_months - 1 loop
    insert into public.payment_installments(project_id, contract_id, name, basis, basis_type, amount, tax_amount, due_date,
      period_start, period_end, status)
    values (p_project_id, p_contract_id, btrim(p_name) || ' — ' || to_char(p_first_due + make_interval(months => m), 'Mon YYYY'),
      'Monthly retainer', 'recurring', p_amount, coalesce(p_tax_amount, 0), (p_first_due + make_interval(months => m))::date,
      (date_trunc('month', p_first_due + make_interval(months => m)))::date,
      (date_trunc('month', p_first_due + make_interval(months => m)) + interval '1 month - 1 day')::date, 'Upcoming');
  end loop;
  return p_months;
end $$;

create or replace function public.staff_set_deliverable_lock(p_deliverable_id uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.deliverables; v_new text;
begin
  select * into d from public.deliverables where id = p_deliverable_id and deleted_at is null for update;
  perform private.require(found, 'Deliverable not found');
  perform private.require(private.has_permission('deliverable.lock') and (private.can_manage_project(d.project_id) or private.has_permission('payment.record')),
    'You are not allowed to change deliverable access');
  perform private.require(p_action in ('lock','unlock','auto'), 'Invalid action');
  perform private.require(length(btrim(coalesce(p_reason, ''))) >= 5, 'A reason is required');
  v_new := case p_action when 'lock' then 'locked_manual' when 'unlock' then 'override_unlocked' else 'unlocked' end;
  if v_new = d.lock_state then return; end if;
  perform set_config('sigma.lock_change', 'on', true);
  update public.deliverables set lock_state = v_new, lock_reason = case when p_action = 'auto' then null else btrim(p_reason) end,
    locked_at = case when p_action = 'lock' then now() else null end where id = d.id;
  insert into public.deliverable_lock_events(deliverable_id, previous_state, new_state, source, reason, actor_id)
  values (d.id, d.lock_state, v_new, case when p_action = 'unlock' then 'override' else 'manual' end, btrim(p_reason), auth.uid());
  perform set_config('sigma.lock_change', '', true);
  if p_action = 'auto' then perform private.evaluate_project_locks(d.project_id); end if;
end $$;

-- Periodic job: installment statuses, reminders, overdue alerts, locks, contract expiry.
create or replace function private.refresh_billing_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_changed int := 0; v_today date := private.today_ist(); v_remind int; p uuid;
begin
  select reminder_days_before into v_remind from public.billing_settings where id;
  for r in select i.*, private.installment_status(i) as computed from public.payment_installments i where i.deleted_at is null loop
    if r.computed is distinct from r.status then
      update public.payment_installments set updated_at = now() where id = r.id;  -- trigger recomputes status
      v_changed := v_changed + 1;
      if r.computed = 'Overdue' then
        perform private.notify_client(r.client_id, 'billing', 'Payment overdue',
          r.name || ' was due on ' || to_char(r.due_date, 'DD Mon YYYY') || '.', '/client/payments', 'overdue:' || r.id);
        perform private.notify_project_staff(r.project_id, 'billing', 'Payment overdue',
          r.name || ' was due on ' || to_char(r.due_date, 'DD Mon YYYY') || '.', '/admin/clients', 'overdue-staff:' || r.id, true);
      end if;
    end if;
    if r.computed in ('Upcoming','Due') and r.due_date is not null and r.due_date - v_today = coalesce(v_remind, 3) then
      perform private.notify_client(r.client_id, 'billing', 'Payment due in ' || coalesce(v_remind, 3) || ' days',
        r.name || ' is due on ' || to_char(r.due_date, 'DD Mon YYYY') || '.', '/client/payments', 'due-soon:' || r.id || ':' || r.due_date);
    end if;
  end loop;
  for p in select distinct project_id from public.payment_installments where deleted_at is null
           union select distinct project_id from public.deliverables where lock_state = 'locked_payment' loop
    perform private.evaluate_project_locks(p);
  end loop;
  update public.contracts set status = 'Expired', updated_at = now()
  where status = 'Accepted' and end_date is not null and end_date < v_today and deleted_at is null;
  return jsonb_build_object('installments_changed', v_changed, 'ran_at', now());
end $$;

create or replace function public.refresh_billing_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.has_permission('payment.record'), 'Not allowed');
  return private.refresh_billing_state();
end $$;

-- =========================================================================
-- Tasks linked to deliverables
-- =========================================================================
create or replace function public.staff_link_task_to_deliverable(p_task_id uuid, p_deliverable_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.deliverables; t public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and archived_at is null for update;
  perform private.require(found, 'Task not found');
  if p_deliverable_id is null then
    perform private.require(private.is_admin() or t.assigned_by = private.current_employee_id(), 'Not allowed');
    update public.tasks set deliverable_id = null, project_id = null where id = t.id;
    return;
  end if;
  select * into d from public.deliverables where id = p_deliverable_id and deleted_at is null;
  perform private.require(found, 'Deliverable not found');
  perform private.require(private.can_manage_project(d.project_id)
    or (d.responsible_id = private.current_employee_id() and t.assigned_by = private.current_employee_id()), 'Not allowed');
  update public.tasks set deliverable_id = d.id, project_id = d.project_id where id = t.id;
end $$;

-- =========================================================================
-- Grants
-- =========================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'staff_create_contract(uuid,text,text,text,uuid,numeric,text,date,date,date,text)',
    'staff_revise_contract(uuid,text,text,text,uuid,numeric,date,date,date,text)',
    'staff_send_contract(uuid)', 'staff_attach_contract_document(uuid,uuid,text)', 'client_mark_contract_viewed(uuid)',
    'client_accept_contract(uuid,integer,boolean,text)', 'client_decline_contract(uuid,integer,text,text)',
    'staff_terminate_contract(uuid,text)', 'staff_set_deliverable_status(uuid,text,text)',
    'staff_archive_deliverable(uuid,text)', 'staff_update_deliverable(uuid,jsonb,text)',
    'client_review_deliverable(uuid,boolean,text)',
    'client_request_modification(uuid,text,text,numeric,date,text,text)',
    'staff_review_modification(uuid,text,text,numeric,date,text,text)',
    'client_respond_to_counter(uuid,boolean,text)', 'client_withdraw_modification(uuid)',
    'staff_request_dependency(uuid,text,text,date)', 'client_submit_dependency(uuid,text,uuid[])',
    'staff_review_dependency(uuid,text,text)',
    'attach_file(text,text,uuid,text,text,bigint,text,boolean,uuid)', 'archive_file(uuid,text)',
    'client_submit_payment(uuid,numeric,text,date,text,uuid,text)', 'finance_verify_payment(uuid,boolean,text)',
    'finance_record_payment(uuid,numeric,text,date,text,text,text)', 'finance_set_installment_override(uuid,text,text)',
    'finance_issue_invoice(uuid)', 'finance_generate_recurring_installments(uuid,uuid,text,numeric,numeric,date,integer)',
    'staff_set_deliverable_lock(uuid,text,text)', 'refresh_billing_state()',
    'staff_link_task_to_deliverable(uuid,uuid)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Internal helpers are never callable from the API.
revoke execute on all functions in schema private from public, anon;
grant execute on function private.current_employee_id() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.can_assign_task(uuid) to authenticated;
grant execute on function private.current_client_id() to authenticated;
grant execute on function private.current_client_role() to authenticated;
grant execute on function private.has_permission(text) to authenticated;
grant execute on function private.is_project_manager(uuid) to authenticated;
grant execute on function private.can_manage_project(uuid) to authenticated;
grant execute on function private.is_client_of_project(uuid) to authenticated;
grant execute on function private.can_view_project(uuid) to authenticated;
grant execute on function private.can_view_project_finance(uuid) to authenticated;
grant execute on function private.project_permission(uuid, text) to authenticated;
grant execute on function private.is_assigned_to_project(uuid) to authenticated;
grant execute on function private.can_read_file(uuid) to authenticated;
revoke all on sequence public.invoice_number_seq from anon, authenticated;

-- ===== supabase/migrations/20261022130000_sigma_storage_and_jobs.sql
-- SIGMA 1 — Private file storage and scheduled billing evaluation

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('sigma-files', 'sigma-files', false, 52428800, array[
  'application/pdf','image/jpeg','image/png','image/webp','image/gif',
  'application/zip','application/x-zip-compressed',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv','video/mp4','video/quicktime','audio/mpeg',
  'image/vnd.adobe.photoshop','application/postscript','application/illustrator'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_read_storage_object(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.files f where f.storage_bucket = p_bucket and f.storage_path = p_name
                 and private.can_read_file(f.id))
$$;
revoke execute on function private.can_read_storage_object(text, text) from public, anon;
grant execute on function private.can_read_storage_object(text, text) to authenticated;

-- Upload only into your own folder: sigma-files/<auth.uid()>/<uuid>-<name>
drop policy if exists sigma_files_insert_own on storage.objects;
create policy sigma_files_insert_own on storage.objects for insert to authenticated with check (
  bucket_id = 'sigma-files' and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Read: the uploader (own folder), otherwise whoever may read the file record
-- (enforces client isolation, visibility and payment-lock rules).
drop policy if exists sigma_files_select on storage.objects;
create policy sigma_files_select on storage.objects for select to authenticated using (
  bucket_id = 'sigma-files' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or private.can_read_storage_object(bucket_id, name)
  )
);
-- No update/delete policies: stored objects are immutable; new versions are new objects.

-- Hourly billing evaluation (statuses, reminders, overdue alerts, locks, expiry).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sigma-billing-refresh') then
    perform cron.unschedule('sigma-billing-refresh');
  end if;
  perform cron.schedule('sigma-billing-refresh', '7 * * * *', 'select private.refresh_billing_state();');
end $$;

-- Least privilege for tables created by the SIGMA migrations (Supabase grants
-- broad default privileges on new public tables).
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p','v','m')
  loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', r.relname);
  end loop;
end $$;
revoke insert, update, delete on public.audit_logs, public.contract_versions, public.deliverable_versions,
  public.deliverable_lock_events, public.files, public.payments, public.deliverable_dependencies,
  public.roles, public.permissions from authenticated;

insert into supabase_migrations.schema_migrations(version, name, statements) values
  ('20261022100000','sigma_security_hardening', '{}'), ('20261022110000','sigma_core_domain', '{}'),
  ('20261022115000','sigma_rls_policies', '{}'), ('20261022120000','sigma_workflow_rpcs', '{}'),
  ('20261022130000','sigma_storage_and_jobs', '{}')
on conflict (version) do nothing;
commit;
select 'SIGMA 1 migrations applied' as result;
