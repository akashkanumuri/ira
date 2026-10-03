-- Preserve finalized payroll periods and snapshots against direct table mutations.
-- finalize_payroll updates records while their parent period is still a draft,
-- then marks the period finalized; that workflow remains allowed.
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
$;

drop trigger if exists payroll_period_finalized_lock on public.payroll_periods;
create trigger payroll_period_finalized_lock
before insert or update or delete on public.payroll_periods
for each row execute function private.protect_finalized_payroll_period();

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
