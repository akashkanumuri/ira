-- Accounting MVP, part 2: company / client billing details, issue and cancel invoices.

create or replace function public.finance_set_company_profile(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_gstin text := upper(nullif(btrim(p->>'gstin'), '')); v_pan text := upper(nullif(btrim(p->>'pan'), ''));
begin
  perform private.require(private.has_permission('billing.settings'), 'Only admin or finance can change company billing details.');
  perform private.require(v_gstin is null or v_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$', 'That GSTIN does not look right.');
  perform private.require(v_pan is null or v_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$', 'That PAN does not look right.');
  perform private.require(v_gstin is null or nullif(p->>'state_code', '') is null or left(v_gstin, 2) = p->>'state_code', 'The GSTIN does not match the state.');
  perform private.require(coalesce((p->>'default_gst_rate')::numeric, 18) in (0, 5, 12, 18, 28, 40), 'Choose a GST rate.');
  update public.company_profile set
    legal_name = private.clean(p->>'legal_name', 160), trade_name = private.clean(p->>'trade_name', 160),
    gstin = v_gstin, pan = coalesce(v_pan, case when v_gstin is not null then substr(v_gstin, 3, 10) end),
    state_code = nullif(p->>'state_code', ''), address = private.clean(p->>'address', 400), city = private.clean(p->>'city', 80),
    pincode = nullif(btrim(coalesce(p->>'pincode', '')), ''), email = private.clean(p->>'email', 160), phone = private.clean(p->>'phone', 20),
    invoice_prefix = coalesce(upper(nullif(btrim(p->>'invoice_prefix'), '')), 'SIG'),
    default_sac = coalesce(nullif(btrim(p->>'default_sac'), ''), '998361'),
    default_gst_rate = coalesce((p->>'default_gst_rate')::numeric, 18),
    invoice_terms = private.clean(p->>'invoice_terms', 2000), signatory = private.clean(p->>'signatory', 120),
    updated_by = auth.uid(), updated_at = now()
  where id;
  perform private.audit('company_profile', 'company', 'update', p, null, null, null, '{}'::jsonb);
end $$;

create or replace function public.finance_set_client_billing(p_client_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_gstin text := upper(nullif(btrim(p->>'gstin'), '')); v_pan text := upper(nullif(btrim(p->>'pan'), ''));
  v_emails text[]; v_state text := nullif(p->>'state_code', '');
begin
  perform private.require(private.has_permission('invoice.generate') or private.has_permission('client.edit'),
    'Only admin or finance can change client billing details.');
  perform private.require(exists (select 1 from public.clients where id = p_client_id and deleted_at is null), 'Client not found.');
  perform private.require(private.clean(p->>'legal_name', 160) is not null, 'Enter the client''s legal (billing) name.');
  perform private.require(v_state ~ '^[0-9]{2}$', 'Choose the client''s state.');
  perform private.require(v_gstin is null or v_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$', 'That GSTIN does not look right.');
  perform private.require(v_gstin is null or left(v_gstin, 2) = v_state, 'The GSTIN does not match the state.');
  perform private.require(v_pan is null or v_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$', 'That PAN does not look right.');
  select coalesce(array_agg(lower(btrim(e))), '{}') into v_emails
  from jsonb_array_elements_text(coalesce(p->'billing_emails', '[]'::jsonb)) e where btrim(e) <> '';
  perform private.require(coalesce(array_length(v_emails, 1), 0) <= 5, 'Up to 5 billing emails.');
  perform private.require(not exists (select 1 from unnest(v_emails) e where e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'), 'One of the billing emails does not look right.');
  insert into public.client_billing_profiles as b (client_id, legal_name, gstin, pan, state_code, address, city, pincode, billing_emails, updated_by, updated_at)
  values (p_client_id, private.clean(p->>'legal_name', 160), v_gstin, coalesce(v_pan, case when v_gstin is not null then substr(v_gstin, 3, 10) end),
    v_state, private.clean(p->>'address', 400), private.clean(p->>'city', 80), nullif(btrim(coalesce(p->>'pincode', '')), ''), v_emails, auth.uid(), now())
  on conflict (client_id) do update set legal_name = excluded.legal_name, gstin = excluded.gstin, pan = excluded.pan,
    state_code = excluded.state_code, address = excluded.address, city = excluded.city, pincode = excluded.pincode,
    billing_emails = excluded.billing_emails, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform private.audit('client_billing_profile', p_client_id::text, 'update', p, null, p_client_id, null, '{}'::jsonb);
end $$;

-- Issue a GST invoice for a payment milestone. Returns the invoice number (same signature as before).
create or replace function public.finance_issue_invoice(p_installment_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  i public.payment_installments; c public.company_profile; b public.client_billing_profiles;
  v_no text; v_today date := private.today_ist(); v_rate numeric; v_tax numeric; v_half numeric;
  v_intra boolean; v_id uuid; v_ok boolean := false; r numeric; v_client text; v_project text;
begin
  perform private.require(private.has_permission('invoice.generate'), 'You are not allowed to issue invoices.');
  select * into i from public.payment_installments where id = p_installment_id and deleted_at is null for update;
  perform private.require(found, 'Payment milestone not found.');
  if exists (select 1 from public.invoices v where v.installment_id = i.id and v.status = 'issued') then
    return (select invoice_no from public.invoices v where v.installment_id = i.id and v.status = 'issued');
  end if;
  perform private.require(i.status not in ('Cancelled','Waived'), 'Cannot invoice a cancelled or waived milestone.');
  perform private.require(i.amount > 0, 'This milestone has no amount.');
  select * into c from public.company_profile where id;
  perform private.require(c.legal_name is not null and c.state_code is not null,
    'Add your company''s legal name and state in Accounts → Settings first.');
  select * into b from public.client_billing_profiles where client_id = i.client_id;
  perform private.require(b.client_id is not null, 'Add this client''s billing details (legal name and state) first.');

  v_tax := coalesce(i.tax_amount, 0);
  perform private.require(v_tax = 0 or c.gstin is not null, 'Add your GSTIN in Accounts → Settings before charging GST.');
  -- The GST already on the milestone must match a real rate.
  if v_tax = 0 then v_rate := 0; v_ok := true;
  else
    foreach r in array array[5, 12, 18, 28, 40, 3, 0.25]::numeric[] loop
      if abs(round(i.amount * r / 100, 2) - v_tax) <= 1 then v_rate := r; v_ok := true; exit; end if;
    end loop;
  end if;
  perform private.require(v_ok, 'The GST on this milestone (₹' || v_tax || ') is not a standard rate of ₹' || i.amount || '. Fix the tax amount first.');

  v_intra := c.state_code = b.state_code;
  v_half := round(v_tax / 2, 2);
  v_no := private.next_doc_no('INV', v_today);
  select company_name into v_client from public.clients where id = i.client_id;
  select name into v_project from public.projects where id = i.project_id;

  insert into public.invoices (invoice_no, fy, title, installment_id, client_id, project_id, contract_id, issue_date, due_date,
    supply_type, place_of_supply, seller, buyer, taxable_total, cgst_total, sgst_total, igst_total, grand_total, notes, created_by)
  values (v_no, private.fy_label(v_today), case when c.gstin is not null then 'Tax Invoice' else 'Invoice' end,
    i.id, i.client_id, i.project_id, i.contract_id, v_today, i.due_date,
    case when v_intra then 'intra' else 'inter' end, b.state_code,
    jsonb_build_object('legal_name', c.legal_name, 'trade_name', c.trade_name, 'gstin', c.gstin, 'pan', c.pan, 'state_code', c.state_code,
      'address', c.address, 'city', c.city, 'pincode', c.pincode, 'email', c.email, 'phone', c.phone, 'terms', c.invoice_terms, 'signatory', c.signatory,
      'bank', (select jsonb_build_object('account_name', s.bank_account_name, 'bank_name', s.bank_name, 'account_number', s.bank_account_number,
                 'ifsc', s.bank_ifsc, 'upi_id', s.upi_id) from public.billing_settings s where s.id)),
    jsonb_build_object('legal_name', b.legal_name, 'company_name', v_client, 'gstin', b.gstin, 'pan', b.pan, 'state_code', b.state_code,
      'address', b.address, 'city', b.city, 'pincode', b.pincode, 'emails', to_jsonb(b.billing_emails), 'project', v_project),
    i.amount, case when v_intra then v_half else 0 end, case when v_intra then v_tax - v_half else 0 end,
    case when v_intra then 0 else v_tax end, i.amount + v_tax,
    nullif(concat_ws(' · ', i.basis, case when i.period_start is not null then 'Period ' || to_char(i.period_start, 'DD Mon YYYY') || ' – ' || to_char(i.period_end, 'DD Mon YYYY') end), ''),
    auth.uid())
  returning id into v_id;

  insert into public.invoice_lines (invoice_id, line_no, description, sac, qty, unit_price, taxable, gst_rate, cgst, sgst, igst, total)
  values (v_id, 1, left(coalesce(v_project || ' — ', '') || i.name, 300), c.default_sac, 1, i.amount, i.amount, v_rate,
    case when v_intra then v_half else 0 end, case when v_intra then v_tax - v_half else 0 end, case when v_intra then 0 else v_tax end,
    i.amount + v_tax);

  update public.payment_installments set invoice_number = v_no, invoice_issued_at = now() where id = i.id;
  perform private.audit('invoice', v_id::text, 'issue', jsonb_build_object('invoice_no', v_no, 'total', i.amount + v_tax), null, i.client_id, i.project_id, '{}'::jsonb);
  perform private.notify_client(i.client_id, 'billing', 'New invoice ' || v_no,
    i.name || ': ₹' || to_char(i.amount + v_tax, 'FM99,99,99,999.00') || coalesce(' due ' || to_char(i.due_date, 'DD Mon YYYY'), ''),
    '/client/payments', 'invoice:' || v_id);
  return v_no;
end $$;

-- Cancel an invoice that has nothing paid against it. The number stays used (shown as cancelled in the register).
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
  update public.payment_installments set invoice_number = null, invoice_issued_at = null where id = i.id;
  perform private.audit('invoice', v.id::text, 'cancel', jsonb_build_object('invoice_no', v.invoice_no), btrim(p_reason), v.client_id, v.project_id, '{}'::jsonb);
  perform private.notify_client(v.client_id, 'billing', 'Invoice ' || v.invoice_no || ' cancelled', btrim(p_reason), '/client/payments', 'invoice-cancel:' || v.id);
end $$;
