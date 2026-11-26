-- Performance marketing, part 4: the client tells us "I paid" (amount, date, method, UTR). It stays "waiting for
-- confirmation" until an admin checks the bank and confirms it; only then does it become a receipt in the ad money.

create table if not exists public.mk_payment_claims (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  request_id uuid references public.mk_money(id),
  amount numeric(14,2) not null check (amount > 0 and amount <= 100000000),
  paid_on date not null,
  method text not null check (method in ('bank_transfer','upi','cash','cheque','card','other')),
  reference text check (reference is null or length(reference) <= 120),
  note text check (note is null or length(note) <= 600),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  receipt_id uuid references public.mk_money(id),
  reject_reason text check (reject_reason is null or length(reject_reason) <= 400),
  submitted_by uuid references public.profiles(id),
  decided_by uuid references public.profiles(id), decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mk_payment_claims_client_idx on public.mk_payment_claims(client_id, created_at desc);

alter table public.mk_payment_claims enable row level security;
revoke all on public.mk_payment_claims from anon;
revoke all on public.mk_payment_claims from authenticated;
grant select on public.mk_payment_claims to authenticated;
create policy mk_payment_claims_select on public.mk_payment_claims for select to authenticated
  using (private.mk_can_work(client_id) or private.mk_client_sees(client_id));
create policy offer_lock on public.mk_payment_claims as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));

create or replace function public.mk_claim_submit(p_request uuid, p_amount numeric, p_paid_on date, p_method text, p_reference text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_client uuid := private.current_client_id(); v_id uuid; v_ref text := private.clean(p_reference, 120);
begin
  perform private.require(v_client is not null and private.mk_client_sees(v_client), 'Marketing is not switched on for your account');
  perform private.require(private.has_permission('client.payment.submit'), 'Your account is not allowed to submit payments. Ask your organisation admin.');
  perform private.require(p_amount is not null and p_amount > 0 and p_amount <= 100000000, 'Enter the amount you paid');
  perform private.require(p_paid_on is not null and p_paid_on <= private.today_ist() and p_paid_on >= private.today_ist() - 180, 'Pick the date you paid (within the last 6 months)');
  perform private.require(p_method in ('bank_transfer','upi','cash','cheque','card','other'), 'Pick how you paid');
  perform private.require(p_method in ('cash','other') or v_ref is not null, 'Add the UTR / transaction reference so we can find it');
  perform private.require(p_request is null or exists (select 1 from public.mk_money where id = p_request and client_id = v_client and kind = 'request' and voided_at is null),
    'That payment request was not found');
  perform private.require((select count(*) from public.mk_payment_claims where client_id = v_client and status = 'pending') < 5,
    'You already have payments waiting for confirmation. We will confirm them shortly.');
  perform private.require(v_ref is null or not exists (
      select 1 from public.mk_payment_claims where client_id = v_client and status in ('pending','confirmed') and lower(reference) = lower(v_ref))
    and not exists (select 1 from public.mk_money where client_id = v_client and kind = 'receipt' and voided_at is null and lower(reference) = lower(v_ref)),
    'This reference has already been submitted');
  insert into public.mk_payment_claims (client_id, request_id, amount, paid_on, method, reference, note, submitted_by)
  values (v_client, p_request, p_amount, p_paid_on, p_method, v_ref, private.clean(p_note, 600), auth.uid()) returning id into v_id;
  perform private.notify_admins('marketing', 'Client says ad budget paid',
    (select company_name from public.clients where id = v_client) || ' paid ₹' || to_char(p_amount, 'FM99,99,99,990') ||
    coalesce(' (' || v_ref || ')', '') || '. Check the bank and confirm.', '/admin-marketing', 'mk-claim:' || v_id);
  perform private.audit('mk_payment_claim', v_id::text, 'submit', jsonb_build_object('amount', p_amount, 'reference', v_ref), null, v_client, null, '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.mk_claim_decide(p_id uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.mk_payment_claims; v_receipt uuid; v_req uuid; v_reason text := private.clean(p_reason, 400);
begin
  perform private.require(private.has_permission('marketing.manage') and not private.offer_locked(), 'Only an admin can confirm payments');
  select * into c from public.mk_payment_claims where id = p_id for update;
  perform private.require(found and c.status = 'pending', 'This payment is not waiting for confirmation');
  if p_action = 'confirm' then
    -- link to the request only while it is still open
    select m.id into v_req from public.mk_money m where m.id = c.request_id and m.voided_at is null;
    v_receipt := public.mk_money_add(c.client_id, jsonb_build_object('kind', 'receipt', 'amount', c.amount, 'entry_date', c.paid_on,
      'method', c.method, 'reference', c.reference, 'request_id', v_req, 'note', coalesce(c.note, 'Confirmed from client payment')));
    update public.mk_payment_claims set status = 'confirmed', receipt_id = v_receipt, decided_by = auth.uid(), decided_at = now() where id = c.id;
  elsif p_action = 'reject' then
    perform private.require(v_reason is not null, 'Tell the client why (e.g. not received in the bank yet)');
    update public.mk_payment_claims set status = 'rejected', reject_reason = v_reason, decided_by = auth.uid(), decided_at = now() where id = c.id;
    perform private.mk_notify_client(c.client_id, 'Payment not confirmed', '₹' || to_char(c.amount, 'FM99,99,99,990') || ': ' || v_reason, 'mk-claim-no:' || c.id);
  else
    perform private.require(false, 'Unknown action');
  end if;
  perform private.audit('mk_payment_claim', c.id::text, p_action, jsonb_build_object('amount', c.amount), v_reason, c.client_id, null, '{}'::jsonb);
end $$;

revoke all on function public.mk_claim_submit(uuid, numeric, date, text, text, text) from public, anon;
revoke all on function public.mk_claim_decide(uuid, text, text) from public, anon;
grant execute on function public.mk_claim_submit(uuid, numeric, date, text, text, text) to authenticated;
grant execute on function public.mk_claim_decide(uuid, text, text) to authenticated;
