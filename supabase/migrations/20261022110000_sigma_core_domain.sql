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
