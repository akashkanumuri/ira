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
