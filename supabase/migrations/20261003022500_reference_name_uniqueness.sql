-- Normalize reference-name uniqueness for deterministic backend lookups.
create unique index if not exists designations_name_lower_unique_idx on public.designations(lower(name));
create unique index if not exists departments_name_lower_unique_idx on public.departments(lower(name));
create unique index if not exists employees_work_email_lower_unique_idx
  on public.employees(lower(work_email))
  where work_email is not null;
