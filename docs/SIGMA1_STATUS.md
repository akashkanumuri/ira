# SIGMA 1 — Implementation status

Branch: `sigma1/core-lifecycle` · Source spec: *SIGMA 1 Product Requirements & Functional Specification v1.0*

Legend: **Done** = code + database + authorization written and build/typecheck verified ·
**Done\*** = database behaviour verified by the automated suite ·
**Not started** = no implementation yet.

## Security fixes (found in the live database on 22 Oct 2026)

| Finding | Severity | Fix |
|---|---|---|
| Clients could `UPDATE payment_installments` directly (e.g. set status `Paid`) | Critical | Policy dropped; payments go through `client_submit_payment` → finance verification |
| Clients could `UPDATE contracts` (status, URL, version) | Critical | Policy dropped; `client_accept_contract` / `client_decline_contract` only |
| Clients could insert arbitrary `contract_acceptances` and `change_requests` (forged evidence, self-approved status) | High | Inserts only via validated RPCs; acceptance records immutable |
| Client UI ignored database errors and showed success | High | All actions surface server errors; no optimistic success |
| `TRUNCATE`/`TRIGGER`/`REFERENCES` granted to `anon`/`authenticated` on public tables | Medium | Revoked |
| Trigger functions executable over `/rest/v1/rpc` (incl. by `anon`) | Medium | Execute revoked |
| Admin UI fabricated payment references (`BANK-xxxx`) and "Client Representative" acceptance rows | High (integrity) | Removed; finance must enter the real bank reference |
| Notification "Email sent" badge shown for every notification; notification preferences "saved" without persistence | Medium (honesty) | Removed until email delivery exists |

## Requirement map

| Spec section | Status | Notes |
|---|---|---|
| 4–5 RBAC, granular permissions | Done* | `roles`, `permissions`, `role_permissions`, `user_roles`; `private.has_permission`; project managers carry PM permissions scoped to their projects. Role-management UI not built yet. |
| 6, 47 Multi-tenant isolation | Done* | `client_users` (multiple users per client organisation), `projects.client_id`; every RLS policy and RPC checks organisation ownership. |
| 7 Client dashboard | Done* | Action-required list, deliverable/contract/payment summaries, ready-for-download. |
| 8 Sign contract | Done* | Versioned contracts; accept requires acknowledgement + current version; records user, organisation, time, IP, user agent, version id; decline requires reason; admin notified. |
| 9–11 Deliverables + status workflow | Done* | 11 statuses with enforced transitions (DB trigger); "Locked" is a separate access state so the underlying status is never lost. |
| 12–14 Modification requests, scope never overwritten | Done* | Quantity / scope / timeline requests; approve / reject / counter-propose; every scope change writes an immutable `deliverable_versions` row. |
| 15 Client dependencies | Done* | Request → upload (files or note) → accept / reject / resubmit; acceptance of the last open item returns the deliverable to In Progress. |
| 16–17 Progress tracker, count vs weighted progress | Done* | Weighted progress shown when every active deliverable has a weightage. |
| 18–20 Billing, milestones, statuses | Done* | Percentage (of contract value), fixed and recurring monthly milestones; tax amount; invoice numbers; statuses computed from verified payments and dates. |
| 21–24 Payment lock, configurable rules, view vs download, admin override | Done* | Global + per-client rules (default **off**), grace days, manual lock / override unlock / reset, immutable lock events. |
| 35–36 Client → Project → Deliverable → Task → Employee | Partial | Tasks can be linked to deliverables (`staff_link_task_to_deliverable`); task UI linkage not added yet. |
| 37–38 File management + versioning | Done* | Private bucket `sigma-files`, `files` table with versions, storage RLS re-checks tenant / visibility / lock on every download. |
| 39–40 Notification engine (in-app) | Done* | Event-driven, idempotent keys. Email/SMS delivery: **Not started**. |
| 41, 61 Immutable audit log | Done* | Row-level diff trigger on 20 tables + immutable `audit_logs`; project activity view for admins. |
| 42, 62 Admin dashboard (client / delivery / finance exceptions) | Partial | Per-project exception panel exists; organisation-wide dashboard not yet extended. |
| 43 Client health score | Not started | Marked "future" in spec. |
| 44 Reporting | Not started | Existing HR exports unchanged. |
| 45 Global search | Not started | Per-list search/filters only. |
| 25–34 Employee module (KRA/KPI, performance, growth, attendance rules, leave, payroll) | Existing / partial | Attendance, leave, WFH, payroll, holidays exist from IRA Presence and are untouched. KRA/KPI, performance reviews, promotions: **Not started**. Extended task statuses: **Not started**. |
| 48 Mobile OTP, optional 2FA | Not started | Email/password + invitation flow exist. |
| 60 Soft delete | Done* | `deleted_at` on clients, projects, contracts, deliverables, milestones, files; delete grants revoked. |

\* Database verified on 22 Oct 2026: migrations applied to production; `supabase/tests/sigma_lifecycle_test.sql` run against the live database inside a rolled-back transaction — **55 / 55 passed**, no test data persisted. Browser checks of each portal follow the production deploy.

## Decisions taken (please confirm)

1. Existing deliverable due date `12/11/2026` is read as **12 Nov 2026** (DD/MM, Indian convention).
2. Payment auto-lock defaults to **off** until configured (approved).
3. When a contract is accepted, its Draft deliverables become **Pending** ("Deliverables = Active").
4. A client dependency upload notifies the team; the deliverable returns to In Progress when the dependency is **accepted** (spec §50 says on upload, workflow 4 says after acceptance — workflow 4 chosen).
5. Client users (restricted role) can view, upload dependencies, download and request modifications; only client admins accept/decline contracts, review work and submit payments.

## Deployment order

1. Apply migrations `20261022100000` → `20261022130000` (database first — the new frontend requires `client_users`).
2. Run `supabase/tests/sigma_lifecycle_test.sql` (rolls back).
3. Merge `sigma1/core-lifecycle` → `main` (Vercel production build).
4. Verify client, admin and employee flows on the live site.

Rollback: redeploy the previous Vercel production build. Database changes are additive except the type conversion of `deliverables.quantity/due_date` and `payment_installments.due_date/paid_on` (one existing row affected).

## Review flow (2026-10-23)

Built on `redesign/foundation` (type-checked build passes on Vercel preview):

- Employee task page: brief, Start/Pause timer (+ manual time log), optional estimate, numbered **link-only drafts** with notes, comments, activity, and a per-task scorecard (drafts, approval rate, changes-requested rate, on-time rate, client rounds).
- Manager **or** admin: approve / request changes per draft, send the approved draft to the client as a numbered version (signed "IRA team"), forward client change requests to the assignee (reopens the task as a new round).
- Client: sees versions only, approves or requests changes; never sees staff names, internal drafts or internal comments. Final link hidden while payment-locked.
- Productivity metrics per employee/team (Performance pages): drafts per task, approval and first-draft approval rate, on-time rate, cycle and review times, time vs estimate, client first-time approval.
- Links instead of uploads for work, contracts and client materials; payment proof is the bank reference. Leave certificates, HR documents and photos still upload.
- Privacy: `20261023160000_client_privacy.sql` stops copying staff names onto client-readable rows (dry run 4/4).

Not yet applied to production (waiting for owner confirmation of the database tool's `drop` prompt; the drops only replace check constraints and policies on new tables):
`20261023100000`…`20261023150000` (applied together with all 7 test suites, commit only if all pass), then `20261023160000_client_privacy.sql` together with the frontend release, then `supabase/seed/sample_review_flow.sql` (labelled sample project; `sample_review_flow_cleanup.sql` removes it).
