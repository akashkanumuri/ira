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
