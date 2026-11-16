-- SIGMA 1 — 16 Nov 2026. Applied as offer_required_1_column, offer_required_2_protect, no_late_on_joining_day.
-- 1. employees.offer_required (default true): new employees see only their offer until they accept one.
--    Employees created before 16 Nov 2026 IST were set to false (backfill ran with the server role for that
--    transaction only, because private.protect_employee_update blocks other callers).
-- 2. protect_employee_update: employees cannot change offer_required on their own row.
-- 3. my_offer_gate: no offer + offer_required → gated, status 'Draft' ("Your offer letter is being prepared").
-- 4. private.late_minutes returns 0 on the employee's join_date (covers check-in status, late marks,
--    notifications, calendar and payroll); late_status hides late_after and returns first_day=true that day.
-- Full function bodies are in the database; see the migration names above.
alter table public.employees add column if not exists offer_required boolean not null default true;
