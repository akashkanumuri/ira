-- SIGMA 1 — 16 Nov 2026. Applied as optional_holidays_1_setup, optional_holidays_2_leave_rules,
-- holidays_2026_company_calendar.
-- 1. public.optional_holidays (+ RLS: read for signed-in, write admin; offer_lock restrictive policy).
-- 2. leave type 'optional_holiday' (paid, 1 per year, full day). validate_leave_request: only on an
--    optional_holidays date, one full day; handle_leave_status_change: approved optional holiday is fully
--    paid and does not touch leave_ledger. payroll_absent_days already excludes approved leave.
-- 3. 2026 holidays replaced with the IRA Hospitality Festive Calendar 2026 (owner-approved final list):
--    14 fixed holidays (holiday_type 'company') + 3 optional (Good Friday, Bakrid, Raksha Bandhan).
--    Holi on 3 Mar 2026 (PDF typo "3 Jan 2026, Tue").
create table if not exists public.optional_holidays (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  date date not null unique,
  description text check (description is null or length(description) <= 300),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
-- (policies, leave type, function bodies and the holiday rows: see the applied migrations above)
