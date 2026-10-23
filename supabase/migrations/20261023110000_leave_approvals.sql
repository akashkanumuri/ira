-- SIGMA 1 — Leave approvals, leave types and supporting documents (spec 32–34, 51)
--
-- Additive. Existing requests keep their status; they're marked as not needing
-- a manager step. Admins can still approve or reject at any stage, so the
-- current app keeps working while the new screens roll out.
--
--   approval chain   'admin'               admin decides (today's behaviour)
--                    'manager_then_admin'  reporting manager first, then admin
--                    'manager'             reporting manager's decision is final
--   Employees with no active manager skip the manager step.
--   Starts as 'admin' so the live app behaves exactly as today; switch the
--   chain in Settings once the manager approval screen has shipped.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- settings
create table if not exists public.leave_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null check (length(btrim(name)) between 2 and 60),
  is_paid boolean not null default true,
  annual_limit numeric(5,1) check (annual_limit is null or annual_limit > 0),
  max_consecutive_days numeric(5,1) check (max_consecutive_days is null or max_consecutive_days > 0),
  document_required_after_days numeric(5,1) check (document_required_after_days is null or document_required_after_days >= 0),
  min_notice_days integer not null default 0 check (min_notice_days between 0 and 90),
  allow_half_day boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.leave_types(code, name, is_paid, sort_order) values
  ('casual', 'Casual', true, 1), ('sick', 'Sick', true, 2), ('earned', 'Earned', true, 3), ('unpaid', 'Unpaid', false, 4)
on conflict (code) do nothing;
-- Any type already used historically stays valid.
insert into public.leave_types(code, name, is_paid, sort_order)
select distinct lower(lr.leave_type), initcap(lr.leave_type), lower(lr.leave_type) <> 'unpaid', 50
from public.leave_requests lr
where lower(lr.leave_type) ~ '^[a-z][a-z0-9_]{1,30}$'
on conflict (code) do nothing;

create table if not exists public.approval_settings (
  id boolean primary key default true check (id),
  leave_chain text not null default 'admin' check (leave_chain in ('admin','manager_then_admin','manager')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.approval_settings(id) values (true) on conflict (id) do nothing;

alter table public.leave_types enable row level security;
alter table public.approval_settings enable row level security;

-- ---------------------------------------------------------------- request columns
alter table public.leave_requests
  add column if not exists manager_id uuid references public.employees(id) on delete set null,
  add column if not exists manager_status text,
  add column if not exists manager_note text,
  add column if not exists manager_reviewed_at timestamptz,
  add column if not exists cancelled_at timestamptz;

do $$ begin
  alter table public.leave_requests add constraint leave_requests_manager_status_check
    check (manager_status is null or manager_status in ('pending','approved','rejected','skipped'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.leave_requests add constraint leave_requests_manager_note_len check (manager_note is null or length(manager_note) <= 1000);
exception when duplicate_object then null; end $$;

alter table public.leave_requests drop constraint if exists leave_requests_status_check;
alter table public.leave_requests add constraint leave_requests_status_check check (status in ('pending','approved','rejected','cancelled'));

create index if not exists leave_requests_manager_idx on public.leave_requests(manager_id, status) where manager_id is not null;

-- ---------------------------------------------------------------- helpers
create or replace function private.leave_has_document(p_leave_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.files f where f.parent_type = 'leave' and f.parent_id = p_leave_id and f.deleted_at is null)
$$;

-- Raises when an approval would break the leave type's document rule.
create or replace function private.leave_check_document(r public.leave_requests)
returns void language plpgsql stable security definer set search_path = '' as $$
declare t public.leave_types;
begin
  select * into t from public.leave_types where code = lower(r.leave_type);
  if found and t.document_required_after_days is not null and r.days > t.document_required_after_days
     and not private.leave_has_document(r.id) then
    raise exception '% leave longer than % day(s) needs a supporting document before it can be approved',
      t.name, t.document_required_after_days using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------- triggers
create or replace function private.validate_leave_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  eid uuid := private.current_employee_id();
  calculated numeric;
  t public.leave_types;
  used numeric;
  v_chain text;
  v_mgr uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.leave_type := lower(btrim(new.leave_type));
  if private.is_admin() then
    if new.manager_status is null then new.manager_status := 'skipped'; end if;
    return new;
  end if;

  if eid is null or new.employee_id <> eid then raise exception 'Unauthorized leave request'; end if;
  if new.status <> 'pending' then raise exception 'New leave request must be pending'; end if;

  select * into t from public.leave_types where code = new.leave_type and active;
  if not found then raise exception 'Choose a valid leave type'; end if;
  if new.duration = 'half' and not t.allow_half_day then raise exception '% leave can’t be taken as a half day', t.name; end if;
  if t.min_notice_days > 0 and new.start_date < v_today + t.min_notice_days then
    raise exception '% leave needs % day(s) notice', t.name, t.min_notice_days;
  end if;

  calculated := private.calculate_leave_days(new.start_date, new.end_date, new.duration);
  if calculated <= 0 then raise exception 'Selected dates contain no working leave days'; end if;
  if t.max_consecutive_days is not null and calculated > t.max_consecutive_days then
    raise exception '% leave can be at most % working day(s) at a time', t.name, t.max_consecutive_days;
  end if;
  if t.annual_limit is not null then
    select coalesce(sum(lr.days), 0) into used from public.leave_requests lr
    where lr.employee_id = eid and lower(lr.leave_type) = t.code and lr.status in ('pending','approved')
      and extract(year from lr.start_date) = extract(year from new.start_date);
    if used + calculated > t.annual_limit then
      raise exception 'This would take you past the % % day(s) allowed this year (% already used or requested)',
        t.annual_limit, lower(t.name), used;
    end if;
  end if;

  if exists (
    select 1 from public.leave_requests lr
    where lr.employee_id = eid and lr.status in ('pending','approved') and lr.id <> new.id
      and lr.start_date <= new.end_date and lr.end_date >= new.start_date
  ) then
    raise exception 'A pending or approved leave already exists for part of these dates';
  end if;

  select leave_chain into v_chain from public.approval_settings where id;
  select m.id into v_mgr from public.employees e join public.employees m on m.id = e.manager_id
  where e.id = eid and m.status = 'active' and m.id <> eid;

  perform private.ensure_leave_ledgers(new.start_date);
  new.days := calculated;
  new.paid_days := 0;
  new.unpaid_days := 0;
  new.manager_id := v_mgr;
  new.manager_status := case when coalesce(v_chain, 'admin') = 'admin' or v_mgr is null then 'skipped' else 'pending' end;
  new.manager_note := null; new.manager_reviewed_at := null; new.cancelled_at := null;
  new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
  new.updated_at := now();
  return new;
end $$;

create or replace function private.handle_leave_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ledger public.leave_ledger%rowtype;
  available numeric;
  paid numeric;
  unpaid numeric;
  v_paid_type boolean;
  v_rpc boolean := coalesce(current_setting('sigma.leave_rpc', true), '') = 'on';
begin
  if NEW.status = OLD.status then
    -- Workflow columns only change through the leave_* functions (or an admin).
    if not v_rpc and not private.is_admin() then
      NEW.manager_id := OLD.manager_id; NEW.manager_status := OLD.manager_status;
      NEW.manager_note := OLD.manager_note; NEW.manager_reviewed_at := OLD.manager_reviewed_at;
      NEW.cancelled_at := OLD.cancelled_at;
    end if;
    NEW.updated_at := now();
    return NEW;
  end if;
  if not (private.is_admin() or v_rpc) then raise exception 'Only an approver can review leave'; end if;
  if OLD.status <> 'pending' then raise exception 'Only pending leave requests can be reviewed'; end if;

  if NEW.status = 'cancelled' then
    NEW.cancelled_at := now(); NEW.paid_days := 0; NEW.unpaid_days := 0;
    NEW.updated_at := now();
    return NEW;
  end if;

  NEW.reviewed_at := now();
  NEW.reviewed_by := (select auth.uid());
  if NEW.manager_status = 'pending' and private.is_admin() then NEW.manager_status := 'skipped'; end if;
  if NEW.status = 'approved' then
    perform private.leave_check_document(NEW);
    perform private.ensure_leave_ledgers(NEW.start_date);
    select * into ledger from public.leave_ledger l
      where l.employee_id = NEW.employee_id and l.period_start = date_trunc('month', NEW.start_date)::date for update;
    available := greatest(0, ledger.opening_balance + ledger.accrual + ledger.adjustment - ledger.paid_used);
    select lt.is_paid into v_paid_type from public.leave_types lt where lt.code = lower(NEW.leave_type);
    if not coalesce(v_paid_type, lower(NEW.leave_type) <> 'unpaid') then
      paid := 0; unpaid := NEW.days;
    else
      paid := least(available, NEW.days); unpaid := greatest(0, NEW.days - paid);
    end if;
    update public.leave_ledger
      set paid_used = paid_used + paid, unpaid_used = unpaid_used + unpaid,
          closing_balance = greatest(0, opening_balance + accrual + adjustment - (paid_used + paid)), updated_at = now()
      where id = ledger.id;
    NEW.paid_days := paid;
    NEW.unpaid_days := unpaid;
  elsif NEW.status = 'rejected' then
    NEW.paid_days := 0;
    NEW.unpaid_days := 0;
  else
    raise exception 'Invalid leave review status';
  end if;
  NEW.updated_at := now();
  return NEW;
end $$;

create or replace function public.trg_notify_leave_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_emp record;
  r record;
  v_msg text;
begin
  select id, name, profile_id into v_emp from public.employees where id = NEW.employee_id;
  v_msg := coalesce(v_emp.name, 'An employee') || ' · ' || NEW.days || ' day(s) of ' || NEW.leave_type || ' leave, '
           || to_char(NEW.start_date, 'DD Mon') || case when NEW.end_date <> NEW.start_date then ' – ' || to_char(NEW.end_date, 'DD Mon') else '' end;

  if TG_OP = 'INSERT' then
    if NEW.manager_status = 'pending' and NEW.manager_id is not null then
      perform private.notify_employee(NEW.manager_id, 'leave', 'Leave request to review', v_msg, '/emp-approvals', 'leave_submit_' || NEW.id);
    else
      for r in select id from public.profiles where role = 'admin' loop
        perform private.notify(r.id, 'leave', 'New leave request', v_msg, '/admin-requests?tab=leave', 'leave_submit_' || NEW.id,
          jsonb_build_object('leave_id', NEW.id));
      end loop;
    end if;
    return NEW;
  end if;

  -- manager approved, admin still to decide
  if NEW.status = 'pending' and OLD.manager_status = 'pending' and NEW.manager_status = 'approved' then
    for r in select id from public.profiles where role = 'admin' loop
      perform private.notify(r.id, 'leave', 'Leave approved by manager', v_msg || ' — ready for final approval.',
        '/admin-requests?tab=leave', 'leave_mgr_ok_' || NEW.id, jsonb_build_object('leave_id', NEW.id));
    end loop;
  end if;

  if OLD.status = 'pending' and NEW.status in ('approved','rejected') and v_emp.profile_id is not null then
    perform private.notify(v_emp.profile_id, 'leave', 'Leave request ' || NEW.status,
      'Your leave for ' || to_char(NEW.start_date, 'DD Mon') ||
      case when NEW.end_date <> NEW.start_date then ' – ' || to_char(NEW.end_date, 'DD Mon') else '' end || ' was ' || NEW.status || '.' ||
      coalesce(' Note: ' || coalesce(NEW.review_note, NEW.manager_note), ''),
      '/emp-leave', 'leave_review_' || NEW.id || '_' || NEW.status, jsonb_build_object('leave_id', NEW.id));
  end if;
  return NEW;
end $$;

-- ---------------------------------------------------------------- workflow functions
create or replace function public.leave_manager_review(p_leave_id uuid, p_decision text, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests; v_chain text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from public.leave_requests where id = p_leave_id for update;
  perform private.require(found, 'Leave request not found');
  perform private.require(r.manager_id is not null and r.manager_id = private.current_employee_id(), 'Only the reporting manager can review this request');
  perform private.require(r.status = 'pending' and r.manager_status = 'pending', 'This request is no longer waiting for you');
  perform private.require(p_decision in ('approved','rejected'), 'Choose approve or reject');
  perform private.require(p_decision = 'approved' or v_note is not null, 'Give a reason for rejecting');
  perform private.require(v_note is null or length(v_note) <= 1000, 'Note is too long');
  select leave_chain into v_chain from public.approval_settings where id;
  if p_decision = 'approved' then perform private.leave_check_document(r); end if;

  perform set_config('sigma.leave_rpc', 'on', true);
  update public.leave_requests set
    manager_status = p_decision, manager_note = v_note, manager_reviewed_at = now(),
    status = case when p_decision = 'rejected' then 'rejected'
                  when v_chain = 'manager' then 'approved' else status end,
    review_note = case when p_decision = 'rejected' or v_chain = 'manager' then v_note else review_note end
  where id = r.id;
  perform set_config('sigma.leave_rpc', '', true);
  return case when p_decision = 'rejected' then 'rejected' when v_chain = 'manager' then 'approved' else 'forwarded' end;
end $$;

create or replace function public.leave_admin_review(p_leave_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.require(private.is_admin(), 'Only an administrator can give final approval');
  select * into r from public.leave_requests where id = p_leave_id for update;
  perform private.require(found, 'Leave request not found');
  perform private.require(r.status = 'pending', 'This request was already reviewed');
  perform private.require(p_decision in ('approved','rejected'), 'Choose approve or reject');
  perform private.require(p_decision = 'approved' or v_note is not null, 'Give a reason for rejecting');
  perform private.require(v_note is null or length(v_note) <= 1000, 'Note is too long');
  update public.leave_requests set status = p_decision, review_note = v_note where id = r.id;
end $$;

create or replace function public.leave_cancel(p_leave_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests;
begin
  select * into r from public.leave_requests where id = p_leave_id for update;
  perform private.require(found and r.employee_id = private.current_employee_id(), 'Leave request not found');
  perform private.require(r.status = 'pending', 'Only a pending request can be withdrawn');
  perform set_config('sigma.leave_rpc', 'on', true);
  update public.leave_requests set status = 'cancelled' where id = r.id;
  perform set_config('sigma.leave_rpc', '', true);
end $$;

-- Requests from the caller's direct reports (names included, since managers
-- may not otherwise be able to read every report's employee row).
create or replace function public.leave_team_requests()
returns table (id uuid, employee_id uuid, employee_name text, designation text, avatar_url text, leave_type text,
  start_date date, end_date date, duration text, days numeric, reason text, status text, manager_status text,
  manager_note text, review_note text, has_document boolean, created_at timestamptz, available_paid numeric)
language sql stable security definer set search_path = '' as $$
  select lr.id, lr.employee_id, e.name, d.name, e.avatar_url, lr.leave_type, lr.start_date, lr.end_date, lr.duration, lr.days,
         lr.reason, lr.status, lr.manager_status, lr.manager_note, lr.review_note, private.leave_has_document(lr.id), lr.created_at,
         (select greatest(0, l.opening_balance + l.accrual + l.adjustment - l.paid_used) from public.leave_ledger l
           where l.employee_id = lr.employee_id and l.period_start = date_trunc('month', lr.start_date)::date)
  from public.leave_requests lr
  join public.employees e on e.id = lr.employee_id
  left join public.designations d on d.id = e.designation_id
  where lr.manager_id = private.current_employee_id()
    and (lr.status = 'pending' or lr.updated_at > now() - interval '60 days')
  order by (lr.status = 'pending' and lr.manager_status = 'pending') desc, lr.start_date
$$;

-- ---------------------------------------------------------------- supporting documents (files table)
alter table public.files drop constraint if exists files_parent_type_check;
alter table public.files add constraint files_parent_type_check check (parent_type in
  ('contract','deliverable','dependency','task','invoice','payment','employee','client','project','leave'));

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
    if f.parent_type = 'leave' and exists (select 1 from public.leave_requests lr where lr.id = f.parent_id and (lr.employee_id = v_emp or lr.manager_id = v_emp)) then return true; end if;
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

create or replace function public.attach_file(p_storage_path text, p_parent_type text, p_parent_id uuid, p_name text,
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
    when 'leave' then
      v_allowed := v_client_user is null and exists (select 1 from public.leave_requests lr where lr.id = p_parent_id
        and lr.status = 'pending' and (private.is_admin() or lr.employee_id = private.current_employee_id()));
      v_project := null; v_client := null; p_visibility := 'internal'; p_is_final := false;
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

-- ---------------------------------------------------------------- existing rows (column-only)
select set_config('sigma.leave_rpc', 'on', true);
update public.leave_requests set manager_status = 'skipped' where manager_status is null;
select set_config('sigma.leave_rpc', '', true);

-- Notify on manager decisions too (status alone doesn't change when a manager forwards a request).
create or replace trigger trg_leave_request_notify after insert or update of status, manager_status on public.leave_requests
  for each row execute function public.trg_notify_leave_request();

-- ---------------------------------------------------------------- RLS & grants
drop policy if exists leave_types_select on public.leave_types;
create policy leave_types_select on public.leave_types for select to authenticated using (true);
drop policy if exists leave_types_admin_write on public.leave_types;
create policy leave_types_admin_write on public.leave_types for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
drop policy if exists approval_settings_select on public.approval_settings;
create policy approval_settings_select on public.approval_settings for select to authenticated using (true);
drop policy if exists approval_settings_admin_update on public.approval_settings;
create policy approval_settings_admin_update on public.approval_settings for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

drop policy if exists leave_manager_select on public.leave_requests;
create policy leave_manager_select on public.leave_requests for select to authenticated
  using (manager_id is not null and manager_id = private.current_employee_id());

revoke all on public.leave_types, public.approval_settings from anon;
revoke truncate, trigger, references, delete on public.leave_types, public.approval_settings from authenticated;
revoke insert on public.approval_settings from authenticated;
grant select, insert, update on public.leave_types to authenticated;
grant select, update on public.approval_settings to authenticated;

revoke execute on function private.leave_has_document(uuid), private.leave_check_document(public.leave_requests) from public, anon;
grant execute on function private.leave_has_document(uuid), private.leave_check_document(public.leave_requests) to authenticated;
revoke execute on function public.leave_manager_review(uuid, text, text), public.leave_admin_review(uuid, text, text),
  public.leave_cancel(uuid), public.leave_team_requests() from public, anon;
grant execute on function public.leave_manager_review(uuid, text, text), public.leave_admin_review(uuid, text, text),
  public.leave_cancel(uuid), public.leave_team_requests() to authenticated;

create or replace trigger leave_types_updated_at before update on public.leave_types for each row execute function private.create_updated_at_trigger();
create or replace trigger trg_audit_leave_types after insert or update or delete on public.leave_types for each row execute function private.audit_row_change();
create or replace trigger trg_audit_approval_settings after update on public.approval_settings for each row execute function private.audit_row_change();
