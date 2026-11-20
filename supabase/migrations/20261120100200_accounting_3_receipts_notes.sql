-- Accounting MVP, part 3: receipts, one payment split across invoices, client credit, credit / debit notes.

-- ---------------------------------------------------------------- receipt numbers
-- Every verified cash payment (client upload or finance entry) gets a receipt number; payments recorded together share one.
create or replace function private.payment_receipt_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'Verified' and new.receipt_no is null and new.source in ('client','finance')
     and (tg_op = 'INSERT' or old.status is distinct from 'Verified') then
    if new.receipt_group is not null then
      select p.receipt_no into new.receipt_no from public.payments p where p.receipt_group = new.receipt_group and p.receipt_no is not null limit 1;
    end if;
    if new.receipt_no is null then
      new.receipt_no := private.next_doc_no('RCT', coalesce(new.paid_on, private.today_ist()));
    end if;
  end if;
  return new;
end $$;
create or replace trigger trg_payment_receipt_no before insert or update of status on public.payments
  for each row execute function private.payment_receipt_no();

-- ---------------------------------------------------------------- client credit
create table if not exists public.client_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  amount numeric(14,2) not null check (amount <> 0),
  kind text not null check (kind in ('overpayment','credit_note','applied','refund')),
  receipt_group uuid,
  payment_id uuid references public.payments(id) on delete restrict,
  adjustment_id uuid,
  note text check (note is null or length(note) <= 400),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_credit_ledger_client_idx on public.client_credit_ledger(client_id, created_at desc);
alter table public.client_credit_ledger enable row level security;
revoke all on public.client_credit_ledger from anon;
revoke insert, update, delete on public.client_credit_ledger from authenticated;
grant select on public.client_credit_ledger to authenticated;
create policy client_credit_ledger_select on public.client_credit_ledger for select to authenticated
  using (private.has_permission('payment.record') or private.has_permission('invoice.generate')
         or (client_id = private.current_client_id() and private.has_permission('client.billing.view')));
create policy offer_lock on public.client_credit_ledger as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));

create or replace function private.client_credit_balance(p_client_id uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0) from public.client_credit_ledger where client_id = p_client_id;
$$;

-- ---------------------------------------------------------------- one receipt, many invoices
-- p_allocations: [{"installment_id": "...", "amount": 1234.00}, ...]. Anything left over becomes client credit.
create or replace function public.finance_record_receipt(p_client_id uuid, p_amount numeric, p_reference text, p_paid_on date,
  p_method text, p_allocations jsonb, p_notes text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_group uuid := gen_random_uuid(); a jsonb; i public.payment_installments; v_amt numeric; v_sum numeric := 0;
  v_left numeric; v_first uuid; v_rct text; v_projects uuid[] := '{}'; p uuid; n int := 0;
begin
  perform private.require(private.has_permission('payment.record'), 'You are not allowed to record payments.');
  if p_idempotency_key is not null and exists (select 1 from public.payments where idempotency_key = p_idempotency_key || ':1') then
    select receipt_group into v_group from public.payments where idempotency_key = p_idempotency_key || ':1';
    return jsonb_build_object('receipt_group', v_group, 'receipt_no', (select receipt_no from public.payments where receipt_group = v_group limit 1), 'duplicate', true);
  end if;
  perform private.require(exists (select 1 from public.clients where id = p_client_id and deleted_at is null), 'Client not found.');
  perform private.require(p_amount is not null and p_amount > 0, 'Enter the amount received.');
  perform private.require(length(btrim(coalesce(p_reference, ''))) between 3 and 120, 'Enter the bank / UTR reference.');
  perform private.require(p_paid_on is not null and p_paid_on <= private.today_ist(), 'Enter the date the money was received.');
  perform private.require(p_method in ('bank_transfer','upi','cheque','card','cash','other'), 'Choose how it was paid.');
  perform private.require(jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) = 'array' and jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) <= 50,
    'Too many invoices in one receipt.');

  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_amt := round((a->>'amount')::numeric, 2);
    continue when v_amt is null or v_amt = 0;
    perform private.require(v_amt > 0, 'Amounts must be positive.');
    select * into i from public.payment_installments where id = (a->>'installment_id')::uuid and deleted_at is null for update;
    perform private.require(found and i.client_id = p_client_id, 'An invoice in this receipt belongs to another client.');
    perform private.require(i.status not in ('Paid','Cancelled','Waived'), i.name || ' does not take payments.');
    perform private.require(v_amt <= i.amount + i.tax_amount - i.amount_paid, i.name || ': more than what is due.');
    n := n + 1;
    insert into public.payments(installment_id, project_id, amount, reference, paid_on, method, status, source, notes,
      submitted_by, verified_by, verified_at, idempotency_key, receipt_group)
    values (i.id, i.project_id, v_amt, btrim(p_reference), p_paid_on, p_method, 'Verified', 'finance', private.clean(p_notes, 400),
      auth.uid(), auth.uid(), now(), coalesce(p_idempotency_key, v_group::text) || ':' || n, v_group)
    returning id into p;
    v_first := coalesce(v_first, p);
    v_sum := v_sum + v_amt;
    perform private.recalc_installment(i.id);
    if not i.project_id = any(v_projects) then v_projects := v_projects || i.project_id; end if;
  end loop;
  perform private.require(v_sum <= p_amount, 'The split is more than the amount received.');
  v_left := round(p_amount - v_sum, 2);
  if v_left > 0 then
    insert into public.client_credit_ledger (client_id, amount, kind, receipt_group, payment_id, note, created_by)
    values (p_client_id, v_left, 'overpayment', v_group, v_first, 'Received ' || btrim(p_reference) || ' — not allocated to an invoice', auth.uid());
  end if;
  foreach p in array v_projects loop perform private.evaluate_project_locks(p); end loop;
  select receipt_no into v_rct from public.payments where receipt_group = v_group and receipt_no is not null limit 1;
  if v_rct is null then v_rct := private.next_doc_no('RCT', p_paid_on); end if;  -- whole amount went to credit
  if v_sum = 0 then
    -- keep a receipt number on the credit entry's note so it can be printed
    update public.client_credit_ledger set note = v_rct || ' · ' || note where receipt_group = v_group;
  end if;
  perform private.audit('receipt', v_group::text, 'record', jsonb_build_object('receipt_no', v_rct, 'amount', p_amount, 'allocated', v_sum, 'credit', v_left),
    null, p_client_id, null, '{}'::jsonb);
  perform private.notify_client(p_client_id, 'billing', 'Payment received · ' || v_rct,
    '₹' || to_char(p_amount, 'FM99,99,99,999.00') || ' received. Thank you.', '/client/payments', 'receipt:' || v_group);
  return jsonb_build_object('receipt_group', v_group, 'receipt_no', v_rct, 'allocated', v_sum, 'credit', v_left);
end $$;

-- Use a client's credit to settle a milestone.
create or replace function public.finance_apply_credit(p_installment_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.payment_installments; v_bal numeric; v_pid uuid;
begin
  perform private.require(private.has_permission('payment.record'), 'You are not allowed to apply credit.');
  select * into i from public.payment_installments where id = p_installment_id and deleted_at is null for update;
  perform private.require(found, 'Milestone not found.');
  perform pg_advisory_xact_lock(hashtext('client-credit:' || i.client_id::text));
  v_bal := private.client_credit_balance(i.client_id);
  perform private.require(p_amount > 0 and p_amount <= v_bal, 'The client has ₹' || v_bal || ' credit.');
  perform private.require(i.status not in ('Paid','Cancelled','Waived') and p_amount <= i.amount + i.tax_amount - i.amount_paid, 'More than what is due.');
  insert into public.payments(installment_id, project_id, amount, reference, paid_on, method, status, source, submitted_by, verified_by, verified_at)
  values (i.id, i.project_id, round(p_amount, 2), 'CREDIT-' || left(gen_random_uuid()::text, 8), private.today_ist(), 'client_credit', 'Verified', 'credit',
    auth.uid(), auth.uid(), now())
  returning id into v_pid;
  insert into public.client_credit_ledger (client_id, amount, kind, payment_id, note, created_by)
  values (i.client_id, -round(p_amount, 2), 'applied', v_pid, 'Used for ' || coalesce(i.invoice_number, i.name), auth.uid());
  perform private.recalc_installment(i.id);
  perform private.evaluate_project_locks(i.project_id);
  perform private.audit('client_credit', i.client_id::text, 'apply', jsonb_build_object('amount', p_amount, 'installment', i.id), null, i.client_id, i.project_id, '{}'::jsonb);
end $$;

-- Money paid back to the client out of their credit.
create or replace function public.finance_record_refund(p_client_id uuid, p_amount numeric, p_reference text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_bal numeric;
begin
  perform private.require(private.is_admin(), 'Only admin can record a refund.');
  perform pg_advisory_xact_lock(hashtext('client-credit:' || p_client_id::text));
  v_bal := private.client_credit_balance(p_client_id);
  perform private.require(p_amount > 0 and p_amount <= v_bal, 'The client has ₹' || v_bal || ' credit.');
  perform private.require(length(btrim(coalesce(p_reference, ''))) >= 3, 'Enter the bank / UTR reference of the refund.');
  insert into public.client_credit_ledger (client_id, amount, kind, note, created_by)
  values (p_client_id, -round(p_amount, 2), 'refund', left('Refund ' || btrim(p_reference) || coalesce(' · ' || private.clean(p_note, 300), ''), 400), auth.uid());
  perform private.audit('client_credit', p_client_id::text, 'refund', jsonb_build_object('amount', p_amount, 'reference', p_reference), p_note, p_client_id, null, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------- credit / debit notes
create table if not exists public.invoice_adjustments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('credit','debit')),
  note_no text unique,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 3 and 400),
  taxable numeric(14,2) not null check (taxable > 0),
  gst_rate numeric(5,2) not null,
  cgst numeric(14,2) not null default 0, sgst numeric(14,2) not null default 0, igst numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  due_date date,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 400),
  issue_date date,
  applied_to_invoice numeric(14,2) not null default 0,
  to_client_credit numeric(14,2) not null default 0,
  installment_id uuid references public.payment_installments(id) on delete restrict
);
create index if not exists invoice_adjustments_invoice_idx on public.invoice_adjustments(invoice_id);
alter table public.invoice_adjustments enable row level security;
revoke all on public.invoice_adjustments from anon;
revoke insert, update, delete on public.invoice_adjustments from authenticated;
grant select on public.invoice_adjustments to authenticated;
create policy invoice_adjustments_select on public.invoice_adjustments for select to authenticated
  using (private.has_permission('invoice.generate') or private.has_permission('payment.record')
         or (status = 'approved' and client_id = private.current_client_id() and private.has_permission('client.billing.view')));
create policy offer_lock on public.invoice_adjustments as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));

create or replace function private.decide_adjustment(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.invoice_adjustments; v public.invoices; i public.payment_installments; v_no text; v_due numeric; v_apply numeric; v_pid uuid; v_inst uuid;
begin
  select * into a from public.invoice_adjustments where id = p_id for update;
  perform private.require(found and a.status = 'pending', 'This note was already decided.');
  if not p_approve then
    update public.invoice_adjustments set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = private.clean(p_note, 400) where id = a.id;
    perform private.audit('invoice_adjustment', a.id::text, 'reject', '{}'::jsonb, p_note, a.client_id, a.project_id, '{}'::jsonb);
    return;
  end if;
  select * into v from public.invoices where id = a.invoice_id;
  perform private.require(v.status = 'issued', 'The invoice is cancelled.');
  v_no := private.next_doc_no(case when a.kind = 'credit' then 'CN' else 'DN' end, private.today_ist());
  if a.kind = 'credit' then
    perform private.require(a.total <= v.grand_total - coalesce((select sum(x.total) from public.invoice_adjustments x
      where x.invoice_id = v.id and x.kind = 'credit' and x.status = 'approved'), 0), 'Credit notes would be more than the invoice.');
    select * into i from public.payment_installments where id = v.installment_id for update;
    v_due := greatest(i.amount + i.tax_amount - i.amount_paid, 0);
    v_apply := least(a.total, v_due);
    if v_apply > 0 then
      insert into public.payments(installment_id, project_id, amount, reference, paid_on, method, status, source, notes, submitted_by, verified_by, verified_at)
      values (i.id, i.project_id, v_apply, v_no, private.today_ist(), 'credit_note', 'Verified', 'credit_note', a.reason, auth.uid(), auth.uid(), now())
      returning id into v_pid;
      perform private.recalc_installment(i.id);
      perform private.evaluate_project_locks(i.project_id);
    end if;
    if a.total - v_apply > 0 then
      insert into public.client_credit_ledger (client_id, amount, kind, adjustment_id, note, created_by)
      values (a.client_id, a.total - v_apply, 'credit_note', a.id, v_no || ' — ' || a.reason, auth.uid());
    end if;
    update public.invoice_adjustments set status = 'approved', note_no = v_no, issue_date = private.today_ist(), decided_by = auth.uid(), decided_at = now(),
      decision_note = private.clean(p_note, 400), applied_to_invoice = v_apply, to_client_credit = a.total - v_apply where id = a.id;
  else
    insert into public.payment_installments (project_id, contract_id, name, basis_type, amount, tax_amount, due_date, invoice_number, invoice_issued_at)
    values (v.project_id, v.contract_id, left('Debit note ' || v_no || ' — ' || a.reason, 200), 'fixed', a.taxable, a.cgst + a.sgst + a.igst,
      coalesce(a.due_date, private.today_ist() + 7), v_no, now())
    returning id into v_inst;
    update public.invoice_adjustments set status = 'approved', note_no = v_no, issue_date = private.today_ist(), decided_by = auth.uid(), decided_at = now(),
      decision_note = private.clean(p_note, 400), installment_id = v_inst where id = a.id;
  end if;
  perform private.audit('invoice_adjustment', a.id::text, 'approve', jsonb_build_object('note_no', v_no, 'kind', a.kind, 'total', a.total), p_note, a.client_id, a.project_id, '{}'::jsonb);
  perform private.notify_client(a.client_id, 'billing', case when a.kind = 'credit' then 'Credit note ' else 'Debit note ' end || v_no,
    'Against ' || v.invoice_no || ': ₹' || to_char(a.total, 'FM99,99,99,999.00') || ' — ' || a.reason, '/client/payments', 'adj:' || a.id);
end $$;

-- Raise a credit note (reduce what the client owes) or a debit note (charge more) against an issued invoice.
-- Admin's own notes are approved straight away; others wait for admin.
create or replace function public.finance_request_adjustment(p_invoice_id uuid, p_kind text, p_taxable numeric, p_reason text, p_due_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.invoices; v_rate numeric; v_tax numeric; v_half numeric; v_id uuid; v_room numeric;
begin
  perform private.require(private.has_permission('invoice.generate'), 'You are not allowed to raise credit or debit notes.');
  perform private.require(p_kind in ('credit','debit'), 'Choose credit or debit note.');
  perform private.require(p_taxable is not null and p_taxable > 0, 'Enter the amount (before GST).');
  perform private.require(length(btrim(coalesce(p_reason, ''))) between 3 and 400, 'Say why.');
  select * into v from public.invoices where id = p_invoice_id;
  perform private.require(found and v.status = 'issued', 'Invoice not found or cancelled.');
  select max(gst_rate) into v_rate from public.invoice_lines where invoice_id = v.id;
  v_tax := round(round(p_taxable, 2) * coalesce(v_rate, 0) / 100, 2);
  v_half := round(v_tax / 2, 2);
  if p_kind = 'credit' then
    v_room := v.taxable_total - coalesce((select sum(x.taxable) from public.invoice_adjustments x
      where x.invoice_id = v.id and x.kind = 'credit' and x.status <> 'rejected'), 0);
    perform private.require(round(p_taxable, 2) <= v_room, 'Credit notes cannot be more than the invoice (₹' || v_room || ' left before GST).');
  end if;
  insert into public.invoice_adjustments (kind, invoice_id, client_id, project_id, reason, taxable, gst_rate, cgst, sgst, igst, total, due_date, requested_by)
  values (p_kind, v.id, v.client_id, v.project_id, btrim(p_reason), round(p_taxable, 2), coalesce(v_rate, 0),
    case when v.supply_type = 'intra' then v_half else 0 end, case when v.supply_type = 'intra' then v_tax - v_half else 0 end,
    case when v.supply_type = 'inter' then v_tax else 0 end, round(p_taxable, 2) + v_tax, p_due_date, auth.uid())
  returning id into v_id;
  if private.is_admin() then
    perform private.decide_adjustment(v_id, true, null);
  else
    perform private.notify_admins('billing', 'Approve a ' || p_kind || ' note', v.invoice_no || ': ₹' || (round(p_taxable, 2) + v_tax) || ' — ' || btrim(p_reason),
      '/admin-finance', 'adj-req:' || v_id);
  end if;
  return v_id;
end $$;

create or replace function public.finance_decide_adjustment(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Only admin can approve credit or debit notes.');
  perform private.decide_adjustment(p_id, p_approve, p_note);
end $$;

-- ---------------------------------------------------------------- invoice status / ageing (respects the caller's access)
create or replace view public.invoice_status with (security_invoker = true) as
select v.id, v.invoice_no, v.title, v.issue_date, coalesce(i.due_date, v.due_date) as due_date, v.client_id, v.project_id, v.installment_id,
  v.buyer->>'legal_name' as client_name, v.buyer->>'gstin' as client_gstin, v.place_of_supply, v.supply_type,
  v.taxable_total, v.cgst_total, v.sgst_total, v.igst_total, v.grand_total, v.status,
  coalesce(dn.total, 0) as debit_notes,
  coalesce(cn.total, 0) as credit_notes,
  case when v.status = 'cancelled' then 0 else coalesce(i.amount_paid, 0) end as settled,
  case when v.status = 'cancelled' then 0 else greatest(v.grand_total - coalesce(i.amount_paid, 0), 0) end as balance,
  case when v.status = 'cancelled' or v.grand_total - coalesce(i.amount_paid, 0) <= 0 or coalesce(i.due_date, v.due_date) is null then 0
       else greatest((now() at time zone 'Asia/Kolkata')::date - coalesce(i.due_date, v.due_date), 0) end as days_overdue,
  case when v.status = 'cancelled' then 'cancelled'
       when v.grand_total - coalesce(i.amount_paid, 0) <= 0 then 'paid'
       when coalesce(i.amount_paid, 0) > 0 then 'part_paid'
       else 'unpaid' end as payment_status
from public.invoices v
left join public.payment_installments i on i.id = v.installment_id
left join lateral (select sum(x.total) total from public.invoice_adjustments x where x.invoice_id = v.id and x.kind = 'credit' and x.status = 'approved') cn on true
left join lateral (select sum(x.total) total from public.invoice_adjustments x where x.invoice_id = v.id and x.kind = 'debit' and x.status = 'approved') dn on true;
grant select on public.invoice_status to authenticated;
revoke all on public.invoice_status from anon;

-- ---------------------------------------------------------------- grants
revoke all on function public.finance_set_company_profile(jsonb) from public, anon;
grant execute on function public.finance_set_company_profile(jsonb) to authenticated;
revoke all on function public.finance_set_client_billing(uuid, jsonb) from public, anon;
grant execute on function public.finance_set_client_billing(uuid, jsonb) to authenticated;
revoke all on function public.finance_cancel_invoice(uuid, text) from public, anon;
grant execute on function public.finance_cancel_invoice(uuid, text) to authenticated;
revoke all on function public.finance_record_receipt(uuid, numeric, text, date, text, jsonb, text, text) from public, anon;
grant execute on function public.finance_record_receipt(uuid, numeric, text, date, text, jsonb, text, text) to authenticated;
revoke all on function public.finance_apply_credit(uuid, numeric) from public, anon;
grant execute on function public.finance_apply_credit(uuid, numeric) to authenticated;
revoke all on function public.finance_record_refund(uuid, numeric, text, text) from public, anon;
grant execute on function public.finance_record_refund(uuid, numeric, text, text) to authenticated;
revoke all on function public.finance_request_adjustment(uuid, text, numeric, text, date) from public, anon;
grant execute on function public.finance_request_adjustment(uuid, text, numeric, text, date) to authenticated;
revoke all on function public.finance_decide_adjustment(uuid, boolean, text) from public, anon;
grant execute on function public.finance_decide_adjustment(uuid, boolean, text) to authenticated;

-- Debit-note milestones are locked the same way as invoiced ones.
create or replace function private.installment_invoice_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.invoice_number is not null and (
       exists (select 1 from public.invoices v where v.installment_id = old.id and v.status = 'issued')
    or exists (select 1 from public.invoice_adjustments a where a.installment_id = old.id and a.status = 'approved')) then
    if new.amount is distinct from old.amount or new.tax_amount is distinct from old.tax_amount
       or new.extra_amount is distinct from old.extra_amount or new.percentage is distinct from old.percentage
       or new.name is distinct from old.name or new.client_id is distinct from old.client_id then
      raise exception 'This milestone is already invoiced (%). Raise a credit or debit note to change the amount.', old.invoice_number using errcode = 'P0001';
    end if;
    if new.status_override in ('Cancelled','Waived') and old.status_override is distinct from new.status_override then
      raise exception 'Cancel invoice % or raise a credit note before cancelling or waiving this milestone.', old.invoice_number using errcode = 'P0001';
    end if;
    if new.deleted_at is not null and old.deleted_at is null then
      raise exception 'An invoiced milestone cannot be deleted. Cancel the invoice first.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
