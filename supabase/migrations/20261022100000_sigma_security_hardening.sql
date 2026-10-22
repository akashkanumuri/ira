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
