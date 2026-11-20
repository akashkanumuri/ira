-- Manual invoices: type the lines yourself (any number, each with its own SAC, qty, rate and GST %).
-- A matching payment item is created on the project so payments, receipts, credit, reminders and
-- ageing work exactly as for invoices raised from the payment plan. Dated today (numbers stay in order).

alter table public.invoices add column if not exists manual boolean not null default false;

create or replace function public.finance_create_manual_invoice(p_project_id uuid, p_due_date date, p_lines jsonb, p_notes text, p_title text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.company_profile; b public.client_billing_profiles; v_client uuid; v_project text; v_client_name text;
  v_today date := private.today_ist(); v_intra boolean; l jsonb; n int := 0;
  v_desc text; v_sac text; v_qty numeric; v_rate numeric; v_gst numeric; v_taxable numeric; v_tax numeric; v_half numeric;
  t_taxable numeric := 0; t_cgst numeric := 0; t_sgst numeric := 0; t_igst numeric := 0;
  v_no text; v_inv uuid; v_inst uuid; v_name text;
begin
  perform private.require(private.has_permission('invoice.generate'), 'You are not allowed to issue invoices.');
  select p.client_id, p.name into v_client, v_project from public.projects p where p.id = p_project_id and p.deleted_at is null;
  perform private.require(v_client is not null, 'Choose a project that belongs to a client.');
  perform private.require(jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) between 1 and 50, 'Add 1 to 50 lines.');
  perform private.require(p_due_date is null or p_due_date >= v_today, 'The due date is in the past.');
  select * into c from public.company_profile where id;
  perform private.require(c.legal_name is not null and c.state_code is not null, 'Add your company''s legal name and state in Finance & accounts → Settings first.');
  select * into b from public.client_billing_profiles where client_id = v_client;
  perform private.require(b.client_id is not null, 'Add this client''s billing details (legal name and state) first.');
  select company_name into v_client_name from public.clients where id = v_client;
  v_intra := c.state_code = b.state_code;

  -- Validate every line first.
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_desc := private.clean(l->>'description', 300);
    v_sac := coalesce(nullif(btrim(coalesce(l->>'sac', '')), ''), c.default_sac);
    v_qty := round((l->>'qty')::numeric, 2);
    v_rate := round((l->>'rate')::numeric, 2);
    v_gst := (l->>'gst_rate')::numeric;
    perform private.require(v_desc is not null, 'Line ' || n || ': add a description.');
    perform private.require(v_sac ~ '^[0-9]{4,8}$', 'Line ' || n || ': SAC must be 4–8 digits.');
    perform private.require(v_qty is not null and v_qty > 0 and v_qty <= 100000, 'Line ' || n || ': quantity must be more than 0.');
    perform private.require(v_rate is not null and v_rate >= 0 and v_rate <= 100000000, 'Line ' || n || ': enter the rate.');
    perform private.require(v_gst in (0, 5, 12, 18, 28, 40), 'Line ' || n || ': choose a GST rate.');
    perform private.require(v_gst = 0 or c.gstin is not null, 'Add your GSTIN in Finance & accounts → Settings before charging GST.');
    v_taxable := round(v_qty * v_rate, 2);
    v_tax := round(v_taxable * v_gst / 100, 2);
    v_half := round(v_tax / 2, 2);
    t_taxable := t_taxable + v_taxable;
    if v_intra then t_cgst := t_cgst + v_half; t_sgst := t_sgst + (v_tax - v_half); else t_igst := t_igst + v_tax; end if;
  end loop;
  perform private.require(t_taxable > 0, 'The invoice total is zero.');

  v_no := private.next_doc_no('INV', v_today);
  v_name := left(coalesce(private.clean(p_title, 120), 'Invoice ' || v_no), 200);

  -- The payment item behind the invoice (amounts locked once the invoice exists).
  insert into public.payment_installments (project_id, name, basis_type, amount, tax_amount, due_date, requested_at, requested_by, invoice_number, invoice_issued_at)
  values (p_project_id, v_name, 'fixed', t_taxable, t_cgst + t_sgst + t_igst, coalesce(p_due_date, v_today + 7), now(), auth.uid(), v_no, now())
  returning id into v_inst;

  insert into public.invoices (invoice_no, fy, title, installment_id, client_id, project_id, contract_id, issue_date, due_date,
    supply_type, place_of_supply, seller, buyer, taxable_total, cgst_total, sgst_total, igst_total, grand_total, notes, created_by, manual)
  values (v_no, private.fy_label(v_today), case when c.gstin is not null then 'Tax Invoice' else 'Invoice' end,
    v_inst, v_client, p_project_id, null, v_today, coalesce(p_due_date, v_today + 7),
    case when v_intra then 'intra' else 'inter' end, b.state_code,
    jsonb_build_object('legal_name', c.legal_name, 'trade_name', c.trade_name, 'gstin', c.gstin, 'pan', c.pan, 'state_code', c.state_code,
      'address', c.address, 'city', c.city, 'pincode', c.pincode, 'email', c.email, 'phone', c.phone, 'terms', c.invoice_terms, 'signatory', c.signatory,
      'bank', (select jsonb_build_object('account_name', s.bank_account_name, 'bank_name', s.bank_name, 'account_number', s.bank_account_number,
                 'ifsc', s.bank_ifsc, 'upi_id', s.upi_id) from public.billing_settings s where s.id)),
    jsonb_build_object('legal_name', b.legal_name, 'company_name', v_client_name, 'gstin', b.gstin, 'pan', b.pan, 'state_code', b.state_code,
      'address', b.address, 'city', b.city, 'pincode', b.pincode, 'emails', to_jsonb(b.billing_emails), 'project', v_project),
    t_taxable, t_cgst, t_sgst, t_igst, t_taxable + t_cgst + t_sgst + t_igst, private.clean(p_notes, 2000), auth.uid(), true)
  returning id into v_inv;

  n := 0;
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_qty := round((l->>'qty')::numeric, 2); v_rate := round((l->>'rate')::numeric, 2); v_gst := (l->>'gst_rate')::numeric;
    v_taxable := round(v_qty * v_rate, 2); v_tax := round(v_taxable * v_gst / 100, 2); v_half := round(v_tax / 2, 2);
    insert into public.invoice_lines (invoice_id, line_no, description, sac, qty, unit_price, taxable, gst_rate, cgst, sgst, igst, total)
    values (v_inv, n, private.clean(l->>'description', 300), coalesce(nullif(btrim(coalesce(l->>'sac', '')), ''), c.default_sac), v_qty, v_rate, v_taxable, v_gst,
      case when v_intra then v_half else 0 end, case when v_intra then v_tax - v_half else 0 end, case when v_intra then 0 else v_tax end, v_taxable + v_tax);
  end loop;

  perform private.audit('invoice', v_inv::text, 'issue_manual', jsonb_build_object('invoice_no', v_no, 'total', t_taxable + t_cgst + t_sgst + t_igst, 'lines', n),
    null, v_client, p_project_id, '{}'::jsonb);
  perform private.notify_client(v_client, 'billing', 'New invoice ' || v_no,
    v_name || ': ₹' || to_char(t_taxable + t_cgst + t_sgst + t_igst, 'FM99,99,99,999.00') || ' due ' || to_char(coalesce(p_due_date, v_today + 7), 'DD Mon YYYY'),
    '/client/payments', 'invoice:' || v_inv);
  return jsonb_build_object('invoice_id', v_inv, 'invoice_no', v_no);
end $$;
revoke all on function public.finance_create_manual_invoice(uuid, date, jsonb, text, text) from public, anon;
grant execute on function public.finance_create_manual_invoice(uuid, date, jsonb, text, text) to authenticated;

-- Cancelling a manual invoice also cancels the payment item behind it (it existed only for that invoice).
create or replace function public.finance_cancel_invoice(p_invoice_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.invoices; i public.payment_installments;
begin
  perform private.require(private.has_permission('invoice.generate'), 'You are not allowed to cancel invoices.');
  perform private.require(private.clean(p_reason, 400) is not null and length(btrim(p_reason)) >= 3, 'Say why the invoice is cancelled.');
  select * into v from public.invoices where id = p_invoice_id for update;
  perform private.require(found and v.status = 'issued', 'Invoice not found or already cancelled.');
  select * into i from public.payment_installments where id = v.installment_id for update;
  perform private.require(coalesce(i.amount_paid, 0) = 0 and not exists (select 1 from public.payments p where p.installment_id = i.id and p.status = 'Submitted'),
    'Payments are recorded against this invoice. Raise a credit note instead.');
  perform private.require(not exists (select 1 from public.invoice_adjustments a where a.invoice_id = v.id and a.status <> 'rejected'),
    'This invoice has credit or debit notes. Raise a credit note instead.');
  update public.invoices set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason) where id = v.id;
  if v.manual then
    update public.payment_installments set invoice_number = null, invoice_issued_at = null, status_override = 'Cancelled',
      status_reason = left('Invoice ' || v.invoice_no || ' cancelled: ' || btrim(p_reason), 400) where id = i.id;
  else
    update public.payment_installments set invoice_number = null, invoice_issued_at = null where id = i.id;
  end if;
  perform private.audit('invoice', v.id::text, 'cancel', jsonb_build_object('invoice_no', v.invoice_no), btrim(p_reason), v.client_id, v.project_id, '{}'::jsonb);
  perform private.notify_client(v.client_id, 'billing', 'Invoice ' || v.invoice_no || ' cancelled', btrim(p_reason), '/client/payments', 'invoice-cancel:' || v.id);
end $$;
