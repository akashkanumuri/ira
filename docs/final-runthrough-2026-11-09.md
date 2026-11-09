# SIGMA 1 — Final run-through (9 Nov 2026)

## How it was checked

- **Production logs:** API, database, sign-in and server functions (last 24 h).
- **Background jobs:** all 6 scheduled jobs and their last 7 days of runs, plus the push alert pipeline.
- **Data consistency:** 20 checks covering attendance, breaks, payments vs milestones, tasks, leave balances, deliverables vs client reviews, contracts, projects, work rules and invitations.
- **Code:** time zone handling, navigation targets, money formatting.
- **Admin screens:** all 16, signed in as admin.
  - Automatic checks on each page for broken values (NaN / undefined / Invalid Date), sideways scrolling, clipped text and console errors.
  - Visual review at 1366 px (laptop) and 390 px (phone).
- **Database fixes:** tested first in a rolled-back transaction, then applied.

## Healthy

- No database errors from real use.
- Every scheduled job ran successfully for 7 days.
- Push alerts delivered.
- All 20 data-consistency checks returned 0 problems: verified payments equal amount paid on every milestone, and no orphaned or contradictory records.
- No broken values or console errors on any admin page.

## Fixed (live)

| # | Problem | Fix |
|---|---|---|
| 1 | A second person signing in on a shared phone or computer got no alerts, and the first person's alerts kept arriving there (seen in logs on an Android phone) | The device is handed to whoever signs in |
| 2 | An employee could end a break with any time they chose (a 2-hour break recorded as 1 minute) | A break ends at the server's clock |
| 3 | "Auto check-out" (at shift end / at midnight) was saved per person but nothing acted on it | A job every 10 min checks people out at the time their rule says, then notifies them. Check-in after the shift ended → closes at midnight, never at check-in |
| 4 | Contract `{today}` date and the default payment due date used the UTC date (a day behind before 5:30 AM IST) | India time |
| 5 | Payroll draft for November was calculated on 2 Nov but showed "Draft ready" with 0 absences and 0 late days, while the dashboard shows late cuts; October was finalized on 9 Oct, before the month ended | The page warns when the draft is older than today or the month isn't over, and the finalize dialog repeats the warning |
| 6 | At phone width the dashboard attendance card and the holidays page were 54–141 px wider than the screen (sideways scrolling) | 51 responsive grids fixed so content can't push past the screen |
| 7 | Employees table was 33 px too wide on a laptop, cutting off the edit buttons | Login ID moved under the name |
| 8 | Sidebar label "Work & Assignme…" was cut off | "Work & tasks" |
| 9 | Attendance said "Working now 1" while Work time said "Working 0 / Away 1" for the same person | Attendance card reads "Checked in" (Work time shows who is actually active) |
| 10 | Notification and push queries re-checked the user on every row | Checked once per query (faster) |

## For the owner to decide

- **November payroll:** press **Regenerate draft** before finalizing.
- **Finalizing before month end:** it is still allowed, now with a warning. It can be blocked entirely if you prefer.
- **Employee and client screens:** checked through shared code only. A signed-in pass as an employee and as a client is still to do.
