-- SIGMA 1 — contract terms and money are admin-only. A project manager runs the work, not the account.
-- Tightens read access only; nothing is deleted. Admin, people with project.manage_all, and finance
-- permissions (payment.record / invoice.generate) keep access exactly as before; clients are unchanged.

create or replace function private.can_view_project_finance(p_project_id uuid)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select private.is_admin() or private.has_permission('payment.record') or private.has_permission('invoice.generate')
      or private.has_permission('project.manage_all')
      or (private.is_client_of_project(p_project_id) and private.has_permission('client.billing.view'))
$function$;

drop policy if exists contracts_select_authorized on public.contracts;
create policy contracts_select_authorized on public.contracts for select to authenticated using (
  private.is_admin() or private.has_permission('project.manage_all') or private.has_permission('payment.record')
  or (private.is_client_of_project(project_id) and status <> 'Draft' and deleted_at is null and private.has_permission('client.contract.view'))
);

drop policy if exists contract_acceptances_select_authorized on public.contract_acceptances;
create policy contract_acceptances_select_authorized on public.contract_acceptances for select to authenticated using (
  private.is_admin() or private.has_permission('project.manage_all') or private.is_client_of_project(project_id)
);

drop policy if exists deliverable_extra_charges_select on public.deliverable_extra_charges;
create policy deliverable_extra_charges_select on public.deliverable_extra_charges for select to authenticated using (
  private.is_admin() or private.has_permission('project.manage_all')
  or private.has_permission('payment.record') or private.has_permission('invoice.generate')
  or (private.is_client_of_project(project_id) and private.has_permission('client.billing.view'))
);

-- A manager can no longer read the contract, so the database decides whether a new deliverable
-- starts as Draft (contract not accepted yet) or Pending (contract accepted).
create or replace function private.deliverable_initial_status()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if not private.is_admin() and NEW.status in ('Draft', 'Pending') then
    NEW.status := case when exists (
      select 1 from public.contracts k
       where k.project_id = NEW.project_id and k.deleted_at is null and k.status = 'Accepted'
    ) then 'Pending' else 'Draft' end;
  end if;
  return NEW;
end $function$;

drop trigger if exists deliverable_initial_status on public.deliverables;
create trigger deliverable_initial_status before insert on public.deliverables
  for each row execute function private.deliverable_initial_status();
