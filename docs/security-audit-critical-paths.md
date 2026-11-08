# SIGMA 1 — Critical-path security audit

8 Nov 2026. Covers sign-in and permissions, password reset, payments, and input handling (SQL, links, files).

## Summary

The database functions (about 120) all check who is calling. There's no raw or dynamic SQL, and no user content is ever inserted as HTML.

The real gaps were **direct table writes through the API** that skipped those checked functions. All of them are now closed and tested.

**Testing method:** each fix was run in a rolled-back transaction as a real non-admin user. It was tested before the fix (the hole worked) and after (it was blocked), and the legitimate path was checked to still work.

## Findings and fixes (all live)

| # | Severity | Vulnerability | How it was exploited | Fix |
|---|---|---|---|---|
| 1 | Critical | `projects`: managers could update any column | A one-line request set `access_open_until` (client unlocked without paying) or `client_id` (project shown to another client) | Trigger `guard_project_direct_write`: only admins change client, access or deletion. Tested: before = allowed, after = blocked; admin `staff_set_project_access` still works |
| 2 | Critical | `payment_installments`: invoice rights allowed editing `amount_paid` / `status` / `verified_*` / `deleted_at` | Mark a milestone Paid with no verified payment, or delete the unpaid first term, which unlocks the project | Trigger `guard_installment_direct_write`: money state changes only through Billing functions; direct inserts start at Upcoming with 0 paid. Tested before/after; editing the due date still works |
| 3 | High | Break start time came from the browser | A break started "in the future" counted as 0 minutes, so time away was paid as work | `validate_break_insert`: break starts at the server clock |
| 4 | High | Direct writes to `client_users` | A login could be attached to another client's organisation (access to that client's data) | Insert/update/delete revoked for `authenticated`. App uses checked functions only. Tested: permission denied |
| 5 | Medium | Task assigner could PATCH `project_id` / `deliverable_id` / `archived_at` | Move a task into another project, or delete it (admin-only) | `validate_task_update` keeps these fields; changes go through the checked functions. Tested |
| 6 | Medium | Reset links lived 24 h (clients) and 1 h (employees) | Wider window to use a leaked link | Client reset links clamped to 15 min in the database (tested: 15 min; invites keep 72 h). Employee links: set Email OTP Expiration to 900 s in the Supabase dashboard |
| 7 | Medium | Admin chose a new employee's first password | The admin knew the employee's password | New employees get a one-time setup link; the login starts with an unguessable random password nobody sees (employee-admin v19) |
| 8 | Medium | Password change didn't end other sessions | A stolen session survived the change | Every password change or reset ends all other sessions |
| 9 | Low | `javascript:` links possible in user-supplied URLs (already blocked by the CSP) | Script runs when someone clicks the link | `safeHref` on every link; database check on `deliverables.reference_url` |
| 10 | Low | File size and type were taken from the browser | Wrong metadata | Trigger reads them from what storage actually holds |
| 11 | Low | The CORS allow-list accepted any `ira-*.vercel.app` | A look-alike Vercel project could call the server functions from a victim's browser | Only the production site, this team's previews and localhost |

## Verified sound

- **Login tokens (JWTs):** signed by Supabase. Roles come from `profiles` in the database, never from the login token.
- **Deactivated people:** they get no data on their next action (`current_employee_id` and `current_client_id` require an active account).
- **Logging out:** cancels the refresh token on the server.
- **Reset tokens:**
  - client links: 256 bits of randomness, stored only as a SHA-256 hash, usable once (atomic reservation), tied to one login, older links cancelled when a new one is made;
  - employee links: Supabase's built-in one-time recovery links.
- **Payments:**
  - there's no payment gateway, so there are no webhooks to verify;
  - clients can't set prices, taxes or extra charges;
  - a client-reported payment stays "Submitted" until staff verify it;
  - the person who entered a payment can't verify it;
  - the amount can't exceed what's outstanding.
- **Uploads:**
  - bucket type and size limits are enforced by storage;
  - files are stored under each uploader's own folder;
  - reading a file is checked against the project;
  - files are served from Supabase's address, not the app's;
  - no HTML or SVG uploads are allowed.

## Settings only the owner can change

- Supabase → Authentication → Email: **Email OTP Expiration = 900**.
- Optional: lower the login-token (JWT) expiry (Auth settings) if staff turnover is high.

## Code and deployments

- Migration `20261108210000_critical_path_hardening.sql` (applied).
- Server functions: employee-admin v19, client-admin v6, client-setup v6.
- App: `src/lib/safeUrl.ts`, the `RecoveryGate` session revocation, and a setup link in the "Add employee" form.
