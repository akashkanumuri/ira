-- Services module, part 5: fire the "first payment" trigger on every status change (receipts update amount_paid,
-- and status is derived in a BEFORE trigger, so "update of status" never matched), and gapless SR numbers.
drop trigger if exists service_first_payment on public.payment_installments;
create trigger service_first_payment after update on public.payment_installments
  for each row when (new.status is distinct from old.status) execute function private.service_first_payment();

alter table public.service_requests alter column request_no drop default;
drop sequence if exists public.service_request_no_seq;

create or replace function private.service_request_number() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('service-request-no'));
  new.request_no := 'SR-' || lpad((coalesce((select max(substring(request_no from 4)::int) from public.service_requests), 0) + 1)::text, 4, '0');
  return new;
end $$;
drop trigger if exists service_request_number on public.service_requests;
create trigger service_request_number before insert on public.service_requests
  for each row execute function private.service_request_number();
