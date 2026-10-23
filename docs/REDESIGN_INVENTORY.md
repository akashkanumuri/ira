# SIGMA 1 — Frontend inventory (redesign baseline)

Taken 23 Oct 2026 from `main` (c1a39cf) + attendance leave fix. Every screen, action and state that the redesign must preserve.
Scope of the redesign: frontend only. Business logic, Supabase queries/RPCs and RLS are unchanged.

## App entry & routing (`src/App.tsx`)
| Path | Screen |
|---|---|
| `/` (signed out) | Employee login |
| `/admin…` (signed out) | Admin login |
| `/client…` (signed out) | Client login |
| `/client/setup` | Client password setup (invitation) |
| signed in, role `client` | Client portal (`ClientPortalView`) |
| signed in, admin/employee | `Portal` — tab = first path segment (`/admin-dashboard`, `/emp-attendance`, …) |

Shell: dark sidebar (`components/common/Sidebar.tsx`), top bar (live clock, notification bell, user, sign out), mobile drawer + 5-item bottom bar, toast host, realtime channel (15 tables) + 30 s fallback refresh.

## Admin portal
| Tab | Screen | Actions / states |
|---|---|---|
| admin-dashboard | Executive Dashboard | KPIs (active, present today office/WFH, pending requests, latest final payroll); attendance table for a chosen date with search, Excel export, "Full view"; row → inspection modal (check-in/out, breaks, working, leave); pending leave & WFH preview |
| admin-clients | Client Operations & Projects | Client directory (search, status filter, create client modal); Projects; Project workspace: Overview (exceptions), Contract, Deliverables, Modifications, Client dependencies, Billing (milestones, recurring, rules, locks), Activity |
| admin-employees | Employees / HR | Search, Add employee (personal, assignment, login, onboarding documents), edit, view documents, reset password |
| admin-attendance | Attendance | Daily attendance table by date |
| admin-tasks | Work & Assignments | Filters (dates, employee, designation, status, priority), show removed, Assign task, delete (archive) task |
| admin-requests | Requests | Leave / WFH tabs, approve / reject |
| admin-payroll | Payroll | Period select, generate draft, review, finalize |
| admin-holidays | Holidays | Add holiday |
| admin-export | Reports / Excel | XLSX exports (attendance, payroll, leave, employees…) |
| admin-settings | Settings | Designations, assignment rules, departments, payroll divisor |

## Employee / Manager portal
| Tab | Screen | Actions / states |
|---|---|---|
| emp-dashboard | Dashboard | Today's attendance summary, leave, tasks, payroll shortcuts |
| emp-attendance | My Attendance | Check-in (office/WFH), break, resume, check-out (confirm modal), close previous open shift, monthly calendar with day details modal, recent records, login sessions; blocked on leave/Sunday/holiday |
| emp-client-work | Client Projects | My deliverables (status changes); Managed projects (project workspace in manager mode) |
| emp-tasks | Work & Assignments | My tasks, submit work link, assign tasks (if designation allows) |
| emp-leave | Leave | Balance summary, apply leave (type, duration, dates, reason), history |
| emp-wfh | WFH | Request WFH (office-based), history; remote employees see notice |
| emp-payroll | Payroll / Salary | Finalized payslips with leave deductions |
| emp-holidays | Holidays | Holiday list |
| emp-profile | Profile | Details, avatar, documents, change password |

## Client portal (`components/client/*`)
Dashboard (action required, deliverable/contract/payment summaries, ready for download) · Sign Contract (view, accept with acknowledgement, decline with reason) · Deliverables (review, request modification, dependencies, downloads) · Progress Tracker (count/weighted progress) · Billing & Payment (milestones, submit payment proof) · Notifications · Profile & Organisation.

## Defects found during inventory (fix in the redesign)
1. Dashboard "Review" / "Review all" buttons open `admin-leave` / `admin-wfh`, which don't exist → land on the dashboard. Should open Requests (Leave / WFH tab).
2. Deep link `/admin-export` is not in the valid-tab list (`admin-reports` is listed instead) → refresh on Reports returns to the dashboard.
3. Desktop sidebar has no **Payroll** item for employees (mobile drawer has it) → employees can't reach payslips on desktop.
4. **Attendance correction requests** have no live UI: the table, realtime and data loading exist, but nothing lets an employee submit one or an admin review it (`emp-corrections` route renders the dashboard). The old `CorrectionsView` / `RegularizationView` files are not wired in.
5. 18 component files are dead code (never imported): `admin/AdminAttendanceTable, AdminDashboard, ClientDirectoryView, EmployeeDirectoryView, ExcelExportView, HolidaysView, LeaveManagementView, RegularizationView, WfhManagementView`, `client/ClientLoginView`, `common/Header`, `employee/CorrectionsView, EmployeeDashboard, EmployeeHolidaysView, LeaveRequestView, MyAttendanceCalendar, WfhRequestView`, `mobile/MobileNavBar` (+ `TodayAttendanceCard`, only used by a dead file).
6. Admin load: every refresh pulls all break events (no limit), 6,000 payroll rows, 1,500 attendance and tasks; refresh also runs on every realtime event and every 30 s.

## Frontend-only additions (backend already exists)
Org-wide admin dashboard (clients, delivery, people, finance exceptions) · Finance (invoices, payments, outstanding across clients) · Org-wide audit log · Role & permission management · Task ↔ deliverable linking on assignment · Notifications pages · Invoice PDF · Attendance corrections (submit + review), subject to confirming the review path.

## Status — 23 Oct 2026

Done on `redesign/foundation` (type check and build pass):
- Admin: Payroll (guided generate → review → finalize), Reports (9 exports, grouped), Settings (segmented rules, duplicate checks, payroll policy cards, read-only Roles & access matrix), Notifications page.
- Employee: Profile (header card, password rule hints, alert state), Notifications page.
- Client: Dashboard (progress ring, payment gauge, action list, contract and downloads).
- Links meant for the other role land on the closest page for the signed-in role.

Deferred to the backend phase (needs data that doesn't exist yet):
- Invoice PDF: there is no company billing profile (legal name, GSTIN, address, bank details). Generating a tax invoice without it would be incomplete.
- Editable roles: `has_permission` already reads `user_roles`, but staff screens are chosen by account type. Granting a staff role needs permission-driven navigation first.
