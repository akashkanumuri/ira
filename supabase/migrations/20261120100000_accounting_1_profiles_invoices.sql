-- Accounting MVP, part 1: company tax profile, client billing profiles, document numbering, GST invoices.
-- Invoices are built from the existing payment milestones (payment_installments). Once issued an invoice is
-- an immutable snapshot (seller, buyer, lines, GST split); changes go through credit / debit notes.

-- Payments may now also be settled by client credit or a credit note (not cash received).
alter table public.payments drop constraint if exists payments_source_check;
alter table public.payments add constraint payments_source_check check (source = any (array['client','finance','credit','credit_note']));
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (method is null or method = any (array[
  'bank_transfer','upi','cheque','card','cash','other','client_credit','credit_note']));
alter table public.payments add column if not exists receipt_no text;
alter table public.payments add column if not exists receipt_group uuid;
create index if not exists payments_receipt_no_idx on public.payments(receipt_no);
create index if not exists payments_receipt_group_idx on public.payments(receipt_group);

-- ---------------------------------------------------------------- company tax profile (one row)
create table if not exists public.company_profile (
  id boolean primary key default true check (id),
  legal_name text check (legal_name is null or length(legal_name) <= 160),
  trade_name text check (trade_name is null or length(trade_name) <= 160),
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  state_code text check (state_code is null or state_code ~ '^[0-9]{2}$'),
  address text check (address is null or length(address) <= 400),
  city text check (city is null or length(city) <= 80),
  pincode text check (pincode is null or pincode ~ '^[0-9]{6}$'),
  email text check (email is null or length(email) <= 160),
  phone text check (phone is null or length(phone) <= 20),
  invoice_prefix text not null default 'SIG' check (invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
  default_sac text not null default '998361' check (default_sac ~ '^[0-9]{4,8}$'),
  default_gst_rate numeric not null default 18 check (default_gst_rate in (0, 5, 12, 18, 28, 40)),
  invoice_terms text check (invoice_terms is null or length(invoice_terms) <= 2000),
  signatory text check (signatory is null or length(signatory) <= 120),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint company_gstin_state check (gstin is null or state_code is null or left(gstin, 2) = state_code),
  constraint company_gstin_pan check (gstin is null or pan is null or substr(gstin, 3, 10) = pan)
);
insert into public.company_profile (id) values (true) on conflict do nothing;
alter table public.company_profile enable row level security;
revoke all on public.company_profile from anon;
revoke insert, update, delete on public.company_profile from authenticated;
grant select on public.company_profile to authenticated;
create policy company_profile_select on public.company_profile for select to authenticated
  using (private.has_permission('invoice.generate') or private.has_permission('payment.record') or private.has_permission('billing.settings'));
create policy offer_lock on public.company_profile as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));

-- ---------------------------------------------------------------- client billing profile
create table if not exists public.client_billing_profiles (
  client_id uuid primary key references public.clients(id) on delete cascade,
  legal_name text not null check (length(btrim(legal_name)) between 1 and 160),
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  state_code text not null check (state_code ~ '^[0-9]{2}$'),
  address text check (address is null or length(address) <= 400),
  city text check (city is null or length(city) <= 80),
  pincode text check (pincode is null or pincode ~ '^[0-9]{6}$'),
  billing_emails text[] not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint client_gstin_state check (gstin is null or left(gstin, 2) = state_code),
  constraint client_gstin_pan check (gstin is null or pan is null or substr(gstin, 3, 10) = pan),
  constraint client_emails_max check (coalesce(array_length(billing_emails, 1), 0) <= 5)
);
alter table public.client_billing_profiles enable row level security;
revoke all on public.client_billing_profiles from anon;
revoke insert, update, delete on public.client_billing_profiles from authenticated;
grant select on public.client_billing_profiles to authenticated;
create policy client_billing_profiles_select on public.client_billing_profiles for select to authenticated
  using (private.has_permission('invoice.generate') or private.has_permission('payment.record') or private.has_permission('client.edit')
         or (client_id = private.current_client_id() and private.has_permission('client.billing.view')));
create policy offer_lock on public.client_billing_profiles as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));

-- ---------------------------------------------------------------- numbering (gapless, per financial year)
create table if not exists private.doc_counters (
  doc text not null check (doc in ('INV','RCT','CN','DN')),
  fy text not null,
  last_no int not null default 0,
  primary key (doc, fy)
);

create or replace function private.fy_label(p_date date) returns text
language sql immutable set search_path = '' as $$
  select case when extract(month from p_date) >= 4
    then to_char(p_date, 'YY') || '-' || to_char(p_date + interval '1 year', 'YY')
    else to_char(p_date - interval '1 year', 'YY') || '-' || to_char(p_date, 'YY') end;
$$;

-- SIG/26-27/0001 (invoice) · SIG/RCT/26-27/0001 · SIG/CN/26-27/0001 · SIG/DN/26-27/0001
create or replace function private.next_doc_no(p_doc text, p_date date) returns text
language plpgsql security definer set search_path = '' as $$
declare v_fy text := private.fy_label(p_date); v_n int; v_prefix text;
begin
  select invoice_prefix into v_prefix from public.company_profile where id;
  insert into private.doc_counters (doc, fy, last_no) values (p_doc, v_fy, 1)
  on conflict (doc, fy) do update set last_no = private.doc_counters.last_no + 1
  returning last_no into v_n;
  return coalesce(v_prefix, 'SIG') || '/' || case when p_doc = 'INV' then '' else p_doc || '/' end || v_fy || '/' || lpad(v_n::text, 4, '0');
end $$;

-- ---------------------------------------------------------------- invoices
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  fy text not null,
  title text not null check (title in ('Tax Invoice','Invoice')),
  installment_id uuid references public.payment_installments(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  contract_id uuid references public.contracts(id) on delete set null,
  issue_date date not null,
  due_date date,
  supply_type text not null check (supply_type in ('intra','inter')),
  place_of_supply text not null check (place_of_supply ~ '^[0-9]{2}$'),
  seller jsonb not null,
  buyer jsonb not null,
  taxable_total numeric(14,2) not null check (taxable_total >= 0),
  cgst_total numeric(14,2) not null default 0 check (cgst_total >= 0),
  sgst_total numeric(14,2) not null default 0 check (sgst_total >= 0),
  igst_total numeric(14,2) not null default 0 check (igst_total >= 0),
  grand_total numeric(14,2) not null check (grand_total >= 0),
  notes text check (notes is null or length(notes) <= 2000),
  status text not null default 'issued' check (status in ('issued','cancelled')),
  cancelled_at timestamptz, cancelled_by uuid references public.profiles(id) on delete set null,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 400),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invoice_totals check (grand_total = taxable_total + cgst_total + sgst_total + igst_total)
);
create unique index if not exists invoices_active_installment_uq on public.invoices(installment_id) where status = 'issued';
create index if not exists invoices_client_idx on public.invoices(client_id, issue_date desc);
create index if not exists invoices_project_idx on public.invoices(project_id);

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  line_no int not null,
  description text not null check (length(description) between 1 and 300),
  sac text not null check (sac ~ '^[0-9]{4,8}$'),
  qty numeric(12,2) not null default 1 check (qty > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  taxable numeric(14,2) not null check (taxable >= 0),
  gst_rate numeric(5,2) not null check (gst_rate >= 0 and gst_rate <= 40),
  cgst numeric(14,2) not null default 0, sgst numeric(14,2) not null default 0, igst numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  unique (invoice_id, line_no)
);

-- Issued invoices never change, except being cancelled (status + who/why).
create or replace function private.invoice_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Invoices cannot be deleted. Cancel it or raise a credit note.' using errcode = '42501'; end if;
  if tg_table_name = 'invoice_lines' then raise exception 'Invoice lines cannot be changed after issue.' using errcode = '42501'; end if;
  if (to_jsonb(new) - array['status','cancelled_at','cancelled_by','cancel_reason'])
     is distinct from (to_jsonb(old) - array['status','cancelled_at','cancelled_by','cancel_reason'])
     or old.status = 'cancelled' then
    raise exception 'An issued invoice cannot be edited. Raise a credit or debit note instead.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists invoices_immutable on public.invoices;
create trigger invoices_immutable before update or delete on public.invoices for each row execute function private.invoice_immutable();
drop trigger if exists invoice_lines_immutable on public.invoice_lines;
create trigger invoice_lines_immutable before update or delete on public.invoice_lines for each row execute function private.invoice_immutable();

alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
revoke all on public.invoices, public.invoice_lines from anon;
revoke insert, update, delete on public.invoices, public.invoice_lines from authenticated;
grant select on public.invoices, public.invoice_lines to authenticated;
create policy invoices_select on public.invoices for select to authenticated
  using (private.can_view_project_finance(project_id) and (project_id is not null or private.has_permission('payment.record')));
create policy offer_lock on public.invoices as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy invoice_lines_select on public.invoice_lines for select to authenticated
  using (exists (select 1 from public.invoices v where v.id = invoice_id));
create policy offer_lock on public.invoice_lines as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));

-- A milestone that has an invoice keeps its amounts. Changes go through credit / debit notes.
create or replace function private.installment_invoice_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.invoice_number is not null and exists (select 1 from public.invoices v where v.installment_id = old.id and v.status = 'issued') then
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
drop trigger if exists trg_installment_invoice_lock on public.payment_installments;
create trigger trg_installment_invoice_lock after update on public.payment_installments
  for each row execute function private.installment_invoice_lock();

grant execute on function private.fy_label(date) to authenticated;
