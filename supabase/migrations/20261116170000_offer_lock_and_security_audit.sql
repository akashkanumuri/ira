-- SIGMA 1 — 16 Nov 2026: database-level offer lock + security audit fixes.
-- Applied as: offer_lock_1_helpers, offer_lock_2_offer_flow, offer_lock_3_table_policies,
-- security_fix_payment_details_and_lock_gaps, offer_lock_4_push_subscription, offer_lock_5_storage,
-- offer_lock_6_grant, avatars_staff_read. (Function bodies live in the database; summary here.)
--
-- 1. private.offer_locked(): true while the signed-in employee has an unaccepted offer
--    (offer_required, or any offer exists) and no Accepted offer. Admins and clients are never locked.
-- 2. private.current_employee_id() returns null and private.has_permission() returns false while locked,
--    so every employee RPC and policy that identifies the caller refuses them.
--    private.employee_id_unchecked() is used only by my_offer_gate, offer_respond and the offer_letters policy.
-- 3. A RESTRICTIVE policy "offer_lock" on every public table (and storage.objects): a locked employee gets
--    nothing, except their own profiles / employees row (read only) and their own auth_sessions rows.
-- 4. Audit fixes: client_payment_details (company bank/UPI) now only for clients, admins and finance
--    (was: anyone signed in); get_my_approver_ids only for active employees/admins; archive_file and
--    save_push_subscription refuse locked employees.
-- 5. avatars: staff-only read policy, served through signed links (bucket made private after the app update).

-- Offer lock: an employee who has not accepted their offer letter gets nothing from any table,
-- except their own login record, employee row and session record (needed to sign in and see the offer)
-- and their offer letter itself. Restrictive policies are ANDed with every existing policy.
create policy offer_lock on public.approval_settings as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.attendance as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.attendance_events as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.audit_logs as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.auth_sessions as restrictive for all to authenticated using (not (select private.offer_locked()) or user_id = (select auth.uid())) with check (not (select private.offer_locked()) or user_id = (select auth.uid()));
create policy offer_lock on public.billing_settings as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.break_events as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.change_requests as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.client_billing_rules as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.client_invitations as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.client_password_requests as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.client_users as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.clients as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.contract_acceptances as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.contract_templates as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.contract_versions as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.contracts as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.data_erasure_requests as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.deliverable_client_reviews as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.deliverable_comments as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.deliverable_dependencies as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.deliverable_extra_charges as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.deliverable_lock_events as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.deliverable_versions as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.deliverables as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.departments as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.designations as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.employee_device_locks as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.employee_documents as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.employee_milestones as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.employee_work_rules as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock_read on public.employees as restrictive for select to authenticated using (not (select private.offer_locked()) or profile_id = (select auth.uid()));
create policy offer_lock_insert on public.employees as restrictive for insert to authenticated with check (not (select private.offer_locked()));
create policy offer_lock_update on public.employees as restrictive for update to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock_delete on public.employees as restrictive for delete to authenticated using (not (select private.offer_locked()));
create policy offer_lock on public.files as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.holidays as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.kras as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.leave_ledger as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.leave_requests as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.leave_types as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.milestones as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.notification_preferences as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.notifications as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.offer_clauses as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.offer_templates as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.office_location as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.payment_installments as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.payments as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.payroll_periods as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.payroll_records as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.payroll_settings as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.performance_cycles as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.performance_flags as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.performance_reviews as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.performance_rules as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.performance_settings as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.permissions as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock_read on public.profiles as restrictive for select to authenticated using (not (select private.offer_locked()) or id = (select auth.uid()));
create policy offer_lock_insert on public.profiles as restrictive for insert to authenticated with check (not (select private.offer_locked()));
create policy offer_lock_update on public.profiles as restrictive for update to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock_delete on public.profiles as restrictive for delete to authenticated using (not (select private.offer_locked()));
create policy offer_lock on public.progress_checks as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.project_clients as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.project_managers as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.project_updates as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.projects as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.push_subscriptions as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.regularization_requests as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.role_permissions as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.roles as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.salary_history as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.support_messages as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.support_requests as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.task_assignment_rules as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.task_comments as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.task_dependencies as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.task_drafts as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.task_events as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.task_research as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.task_time_logs as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.task_timers as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.tasks as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.user_roles as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.wfh_requests as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.work_presence as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.work_rule_templates as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.work_sessions as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.work_settings as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
