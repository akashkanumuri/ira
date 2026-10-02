-- IRA Presence V2 final incremental migration
-- Applied to Supabase project htxalzgotwsbicseyigu on 2026-10-02.
-- Canonical business rules live in the existing base schema plus this migration.
-- Time zone: Asia/Kolkata.

alter table public.employees add column if not exists login_id text;
update public.employees set login_id = lower(regexp_replace(emp_id, '[^a-zA-Z0-9._-]+', '-', 'g')) where login_id is null;
alter table public.employees alter column login_id set not null;
create unique index if not exists employees_login_id_ci_unique on public.employees(lower(trim(login_id)));
create unique index if not exists employees_work_email_ci_unique on public.employees(lower(trim(work_email))) where work_email is not null;

alter table public.auth_sessions drop constraint if exists auth_sessions_status_check;
alter table public.auth_sessions add constraint auth_sessions_status_check check (status = any(array['active','ended','expired']));

create extension if not exists btree_gist with schema extensions;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.salary_history'::regclass
      and conname='salary_history_valid_range'
  ) then
    alter table public.salary_history
      add constraint salary_history_valid_range
      check (effective_to is null or effective_to >= effective_from);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.salary_history'::regclass
      and conname='salary_history_no_overlap'
  ) then
    alter table public.salary_history
      add constraint salary_history_no_overlap
      exclude using gist (
        employee_id with =,
        daterange(effective_from, coalesce(effective_to, '9999-12-31'::date), '[]') with &&
      );
  end if;
end $$;

drop function if exists public.get_employee_login_email(text);
drop function if exists public.get_current_user_context();
drop function if exists public.get_my_role();
drop function if exists public.get_my_employee_id();

create sequence if not exists public.employee_number_seq start with 1;

create or replace function public.next_employee_id()
returns text
language plpgsql
security definer
set search_path=''
as $$
begin
  return 'EMP' || lpad(nextval('public.employee_number_seq')::text, 4, '0');
end;
$$;
revoke all on function public.next_employee_id() from public, anon, authenticated;
grant execute on function public.next_employee_id() to service_role;

alter table public.tasks drop constraint if exists tasks_dates_valid;

create index if not exists holidays_created_by_idx on public.holidays(created_by);

drop policy if exists salary_history_admin on public.salary_history;
drop policy if exists salary_history_self_select on public.salary_history;
drop policy if exists salary_history_select on public.salary_history;
create policy salary_history_select on public.salary_history
for select to authenticated
using (employee_id = private.current_employee_id() or private.is_admin());

drop policy if exists employees_assignment_targets_select on public.employees;
create policy employees_assignment_targets_select on public.employees
for select to authenticated
using (
  private.is_admin()
  or profile_id = (select auth.uid())
  or (status='active' and private.can_assign_task(id))
);

-- Cron: run at 00:05 IST daily; the ledger function is idempotent,
-- so the current month is created automatically and historical rows are preserved.
select cron.unschedule('ira-monthly-leave-ledger');
select cron.unschedule('ira-monthly-leave-ledger-v2');
select cron.schedule(
  'ira-monthly-leave-ledger-v2',
  '35 18 * * *',
  $$select private.ensure_leave_ledgers((now() at time zone 'Asia/Kolkata')::date);$$
);

-- Edge Function:
-- supabase/functions/employee-admin/index.ts
-- verifies the caller is an admin and provisions Auth + profile + employee + salary + leave ledger.
