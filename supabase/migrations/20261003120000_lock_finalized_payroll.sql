-- Preserve finalized payroll periods and snapshots against direct table mutations.
-- finalize_payroll updates records while their parent period is still a draft,
-- then marks the period finalized; that workflow remains allowed.
-- The holiday date constraint already enforces uniqueness; remove the duplicate index.
drop index if exists public.holidays_date_unique_idx;

create or replace function private.protect_finalized_payroll_period()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'finalized' then
      raise exception 'Payroll periods must be finalized through the payroll workflow';
    end if;
    return new;
  end if;

  if old.status = 'finalized' then
    raise exception 'Finalized payroll periods are locked';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists payroll_period_finalized_lock on public.payroll_periods;
create trigger payroll_period_finalized_lock
before insert or update or delete on public.payroll_periods
for each row execute function private.protect_finalized_payroll_period();

-- Only the checked finalization RPC may move a period from draft to finalized.
-- The RPC runs as its owner and validates the complete period before updating it.
drop policy if exists payroll_periods_admin on public.payroll_periods;
create policy payroll_periods_admin
on public.payroll_periods
for all
to authenticated
using (private.is_admin() and status = 'draft')
with check (private.is_admin() and status = 'draft');

-- Run the public entry point with the migration owner so it can execute the
-- private generator. Keep the caller authorization check in this wrapper and do
-- not grant authenticated users direct access to the internal generator.
create or replace function public.generate_payroll(p_month date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.is_admin() then
    raise exception 'Admin access required';
  end if;

  return private.generate_payroll_internal(p_month);
end;
$function$;

revoke all on function public.generate_payroll(date) from PUBLIC, anon, authenticated;
grant execute on function public.generate_payroll(date) to authenticated;

create or replace function public.finalize_payroll(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  period_status text;
  record_count integer;
begin
  if not private.is_admin() then
    raise exception 'Admin access required';
  end if;

  select pp.status into period_status
  from public.payroll_periods pp
  where pp.id = p_period_id
  for update;

  if period_status is null then
    raise exception 'Payroll period not found';
  end if;

  if period_status = 'finalized' then
    raise exception 'Payroll period is already finalized';
  end if;

  if period_status <> 'draft' then
    raise exception 'Only a draft payroll period can be finalized';
  end if;

  select count(*) into record_count
  from public.payroll_records pr
  where pr.period_id = p_period_id;

  if record_count = 0 then
    raise exception 'Generate the payroll draft before finalizing';
  end if;

  update public.payroll_records
  set finalized_at = coalesce(finalized_at, now()),
      updated_at = now()
  where period_id = p_period_id;

  update public.payroll_periods
  set status = 'finalized',
      finalized_at = coalesce(finalized_at, now()),
      updated_at = now()
  where id = p_period_id;
end;
$function$;

revoke all on function public.finalize_payroll(uuid) from PUBLIC, anon, authenticated;
grant execute on function public.finalize_payroll(uuid) to authenticated;

create or replace function private.protect_finalized_payroll_record()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_period_status text;
  new_period_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.finalized_at is not null then
      raise exception 'Finalized payroll records are locked';
    end if;

    select pp.status into old_period_status
    from public.payroll_periods pp
    where pp.id = old.period_id;

    if old_period_status = 'finalized' then
      raise exception 'Finalized payroll records are locked';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select pp.status into new_period_status
    from public.payroll_periods pp
    where pp.id = new.period_id;

    if new_period_status = 'finalized' then
      raise exception 'Finalized payroll records are locked';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists payroll_record_finalized_lock on public.payroll_records;
create trigger payroll_record_finalized_lock
before insert or update or delete on public.payroll_records
for each row execute function private.protect_finalized_payroll_record();
