# SIGMA 1 — Personal data map

Audit date: 8 Nov 2026. Covers the web app (`src/`), Edge Functions, the Supabase database and every outside service.

## 1. Where personal data comes in, where it goes, where it ends up

| Data | Collected where | Stored in | Who can read it | Leaves SIGMA? |
|---|---|---|---|---|
| **Employee name, work email, phone** | Admin "Add/Edit employee" form; employee Profile page | `employees` | The employee, admins, and managers who can assign them work | No |
| **Employee Login ID** | Admin "Add employee" form | `employees.login_id`; login email `loginid@employee.ira.local` in Supabase Auth | The employee, admins | No |
| **Passwords** | Admin "Add employee" form; set-password and reset links; Profile → Change password | **Only as a bcrypt hash in Supabase Auth.** Never in SIGMA tables, logs or responses | Nobody, because a hash can't be reversed | Only the first 5 characters of the SHA-1 hash go to the breach-check service. The password itself never leaves |
| **Salary** | Admin employee form | `salary_history`, `payroll_records` | The employee (own figures only), admins. Managers see late marks but no money | No |
| **HR documents** (offer letters, IDs) | Admin employee form | Private `hr-documents` bucket + `employee_documents` | The employee (own), admins. Opened through short-lived signed links | No |
| **Profile photo** | Profile page | Public `avatars` bucket (anyone with the exact link can view; only admins can list files) | Anyone with the link | No |
| **Check-in location** | Attendance check-in (browser location) | Distance check in the browser; `attendance_events.metadata.geo` (1 record so far) | The employee, admins | No |
| **Device and browser** (user agent, device label, random device ID) | Sign-in, check-in, device lock, push alerts | `auth_sessions`, `attendance_events`, `employee_device_locks`, `push_subscriptions` | The person, admins | No |
| **IP address** | Every audited action; contract signing | `audit_logs.ip_address`, `contract_acceptances.ip_address` | Audit viewers (admin permission); project managers for contract evidence | No |
| **Client company and contact** (company, contact person, email, phone, address, GSTIN) | Admin "New client" | `clients`, `client_users` | Admins, finance (payments), the client's own people, the managers on their projects | No |
| **Client sign-in email** | Client invitation | Supabase Auth + `client_users` | The client's own people, admins | Only inside the link the admin chooses to share (WhatsApp or copy) |
| **Contract signature** (typed name, time, IP, browser) | Client signs a contract | `contract_acceptances`, which cannot be changed afterwards | Managers on the project, the client | No |
| **Payment references** | Client "I've paid" form | `payments` | Finance, admins, the client | No |
| **SIGMA's own bank and UPI details** | Admin billing settings | `billing_settings` | Signed-in clients (so they can pay) | No |
| **Messages** (support, comments, leave reasons, task notes) | Various forms | Their own tables | Following each table's access rules | No |
| **Push alert address** | Turning on phone alerts | `push_subscriptions` | Only the owner | The alert text goes to Google, Apple or Mozilla push servers end-to-end encrypted, so they can't read it |
| **Session token + basic profile** | Sign-in | The browser's `localStorage` (how Supabase works) | That browser | No |

## 2. Outside services: what each one receives

| Service | Why | What it receives | Change made |
|---|---|---|---|
| **Supabase** (database, login, files, servers in Seoul) | The backend | Everything above | Already protected by row-level rules |
| **Vercel** | Hosts the website | Visitor IP and browser in its standard access logs | None needed |
| **Have I Been Pwned** | Rejects leaked passwords | 5 characters of a SHA-1 hash (k-anonymity) | One shared helper now; the check also runs on client password changes |
| **Push services** (Google FCM, Apple, Mozilla) | Phone alerts | Encrypted alert content | None needed |
| **Google Fonts** | Fonts | ~~Every visitor's IP and browser on every page load~~ | **Removed.** Fonts are now served by SIGMA itself |
| **WhatsApp** (`wa.me` link) | Sharing a setup or reset link | Only what the admin chooses to send: the person's name and the link | None. It only happens when the admin clicks |
| **Google Maps link** | Office location preview | Office coordinates (no personal data) | None |
| Analytics, error tracking, AI, payment gateway, email | — | **None are used** | — |

The database only calls outward to SIGMA's own push function.

## 3. What was fixed

1. **Logs.** There were 56 log calls. Some printed user IDs, whole notification objects, or raw database errors that can include an email (for example `Key (work_email)=(…)`). Every log line now goes through a redactor:
   - emails, phone and account numbers, tokens, API keys, IDs and database key details become `[REDACTED]`;
   - objects are logged as their field names only;
   - debug output is off in production.

   This applies in the browser (`src/lib/log.ts`) and in the server functions (`supabase/functions/_shared/log.ts`). Tested on sample data.
2. **Passwords.**
   - The admin "Reset password" button used to create a temporary password and **return it to the browser**. It now creates a **one-time reset link** that expires in 1 hour. The employee opens it and chooses their own password; nobody else ever sees it.
   - The old reset action is kept only until the new screens are live everywhere, then it will be deleted.
   - Client portal password change: it never asked for the current password, so it always failed. It now asks for it and runs the breach check.
3. **Google Fonts removed.** No visitor data goes to Google any more. The browser rules (CSP) no longer allow Google hosts.
4. **Data deletion.** There was no way to delete personal data. Now:
   - Employees and client contacts have a **"Your personal data"** card with **Ask to erase my data**. Admins get a high-priority alert.
   - On a **deactivated** person, admins have **Erase personal data** (type ERASE to confirm). It:
     - replaces name, email, phone, photo and Login ID with "Former employee EMP0009" or "Former contact";
     - deletes HR documents and their files, devices, push alerts, check-in locations, browser details and the person's notifications;
     - removes their name from other people's alerts and from the audit log, and blanks their IP addresses;
     - blocks the login for good with a random email and password.
   - **Kept without their name, as the law requires:** attendance hours, leave, payroll and salary figures, tasks, invoices and payments, and signed contract evidence.
   - Tested in a rolled-back run on the test employee and test client. All guards held: not active, wrong confirmation, not an admin, your own account. A second run is harmless, and the audit log stays locked for everyone else.

## 4. Checked and already fine

- **Plaintext passwords.** No table has a password column. Supabase Auth hashes with bcrypt. Admin-typed passwords go straight to Supabase Auth over HTTPS. They are not logged, stored or returned.
- **Cookies.** SIGMA sets none. Login is a token in `localStorage`, the standard for a Supabase single-page app. Moving it into `httpOnly` cookies would need a server in front of the app, which is a rebuild.
  - The XSS risk this creates is reduced by the strict Content Security Policy: only SIGMA's own scripts can run.
  - Other `localStorage` keys hold no personal data: UI preferences, the robot's tips, and a random device ID.
- **API responses.** Every table has row-level rules: people see only their own rows, their company's, or their projects'. Specific checks:
  - salary only to self and admins;
  - other clients' data never visible;
  - the one view runs with the caller's permissions;
  - functions that return personal data check the caller first;
  - only "Forgot password" works without signing in, and it gives the same answer whether or not the email exists.

## 5. Left as they are (decide if you want them changed)

- **Managers see their team's work email and phone.** They need them to contact the people they assign work to. This can be hidden if you want.
- **Profile photos are in a public bucket.** URLs are unguessable and listing is admin-only. They can be made private with signed links.
- **Free text** (leave reasons, task notes, chat messages, deliverable history snapshots) isn't rewritten on erasure. It's a business record, and the person's name inside other people's sentences can't be found reliably.
- **IP retention.** `audit_logs` keeps IPs with no expiry. Suggested: clear IPs older than 12 months automatically.
- **The push signing key is stored in a private database table.** It can't be reached through the app's API. Moving it to Supabase Vault would be tidier.
