-- SIGMA 1 — critical-path hardening (deep audit, 8 Nov 2026).
-- Every change below closes a way to bypass the audited database functions by writing to a table directly
-- through the API. Database functions (SECURITY DEFINER) are unaffected: inside them current_user is the
-- function owner, not 'authenticated'.

-- H1. Projects: a project manager could PATCH projects directly and change client_id (show the project to
--     another client) or access_hold / access_open_until (open a client's work without payment).
create or replace function private.guard_project_direct_write()
 returns trigger language plpgsql set search_path to ''
as $function$
begin
  if current_user <> 'authenticated' or private.is_admin() then return new; end if;
  if tg_op = 'UPDATE' then
    if new.client_id is distinct from old.client_id
       or new.access_hold is distinct from old.access_hold
       or new.access_hold_reason is distinct from old.access_hold_reason
       or new.access_open_until is distinct from old.access_open_until
       or new.deleted_at is distinct from old.deleted_at
       or new.created_by is distinct from old.created_by
       or new.id is distinct from old.id then
      raise exception 'Only an admin can change the client, access or deletion of a project' using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;
drop trigger if exists trg_guard_project_direct_write on public.projects;
create trigger trg_guard_project_direct_write before update on public.projects
  for each row execute function private.guard_project_direct_write();

-- H2. Payment milestones: anyone with invoice.generate could PATCH amount_paid / status / verified_* and mark a
--     milestone Paid with no verified payment behind it (which also unlocks the client's project), or soft-delete
--     an unpaid first term. Money state now changes only through the payment functions (recalc_installment).
create or replace function private.guard_installment_direct_write()
 returns trigger language plpgsql set search_path to ''
as $function$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    new.amount_paid := 0;
    if new.status is null or new.status not in ('Upcoming', 'Due') then new.status := 'Upcoming'; end if;
    new.paid_on := null; new.payment_reference := null; new.verified_at := null; new.verified_by := null;
    new.invoice_number := null; new.invoice_issued_at := null; new.requested_at := null; new.requested_by := null;
    new.status_override := null; new.status_reason := null; new.deleted_at := null;
    return new;
  end if;
  if new.amount_paid is distinct from old.amount_paid or new.status is distinct from old.status
     or new.paid_on is distinct from old.paid_on or new.payment_reference is distinct from old.payment_reference
     or new.verified_at is distinct from old.verified_at or new.verified_by is distinct from old.verified_by
     or new.invoice_number is distinct from old.invoice_number or new.invoice_issued_at is distinct from old.invoice_issued_at
     or new.requested_at is distinct from old.requested_at or new.requested_by is distinct from old.requested_by
     or new.status_override is distinct from old.status_override or new.status_reason is distinct from old.status_reason
     or new.deleted_at is distinct from old.deleted_at or new.project_id is distinct from old.project_id
     or new.contract_id is distinct from old.contract_id then
    raise exception 'Payments, status, invoices and deletion of a milestone go through Billing, not a direct edit' using errcode = '42501';
  end if;
  return new;
end $function$;
drop trigger if exists trg_guard_installment_direct_write on public.payment_installments;
create trigger trg_guard_installment_direct_write before insert or update on public.payment_installments
  for each row execute function private.guard_installment_direct_write();

-- H3. Breaks: an employee could insert a break with break_start in the future, so the break counted as
--     0 minutes and the time away was paid as work. The break now always starts at the server's clock.
create or replace function private.validate_break_insert()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  eid uuid := private.current_employee_id();
  a public.attendance%rowtype;
begin
  if eid is null or NEW.employee_id<>eid then raise exception 'Unauthorized break'; end if;
  select * into a from public.attendance where id=NEW.attendance_id for update;
  if a.employee_id<>eid then raise exception 'Attendance does not belong to employee'; end if;
  if a.current_state<>'working' or a.check_out_at is not null then raise exception 'Attendance is not in a working state'; end if;
  if exists(select 1 from public.break_events b where b.attendance_id=a.id and b.break_end is null) then raise exception 'A break is already open'; end if;
  if NEW.id is null then NEW.id:=extensions.uuid_generate_v4(); end if;
  NEW.break_start:=now();
  NEW.break_end:=null;
  NEW.duration_seconds:=null;
  return NEW;
end;
$function$;

-- H4. Tasks: the person who assigned a task could PATCH it to another project / deliverable, or archive it
--     (archiving is admin-only through archive_task). Linking goes through staff_link_task_to_deliverable.
create or replace function private.validate_task_update()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  eid uuid := private.current_employee_id();
  is_assignee boolean := (OLD.assigned_to = eid) and (NEW.assigned_to = OLD.assigned_to);
  is_assigner boolean := (OLD.assigned_by is not null) and (OLD.assigned_by = eid);
begin
  NEW.updated_at := now();
  if private.is_admin() or coalesce(current_setting('sigma.task_rpc', true), '') = 'on' then return NEW; end if;
  NEW.time_spent_minutes := OLD.time_spent_minutes; NEW.parent_task_id := OLD.parent_task_id;
  NEW.accepted_at := OLD.accepted_at; NEW.started_at := OLD.started_at;
  NEW.completed_at := OLD.completed_at; NEW.cancelled_at := OLD.cancelled_at;
  NEW.reviewed_by := OLD.reviewed_by; NEW.reviewed_at := OLD.reviewed_at;
  NEW.status_note := OLD.status_note; NEW.created_at := OLD.created_at;
  NEW.status := OLD.status; NEW.submitted_link := OLD.submitted_link; NEW.submitted_at := OLD.submitted_at; NEW.progress_pct := OLD.progress_pct;
  NEW.project_id := OLD.project_id; NEW.deliverable_id := OLD.deliverable_id; NEW.archived_at := OLD.archived_at;
  NEW.client_request_id := OLD.client_request_id;
  NEW.research_minutes := OLD.research_minutes; NEW.estimate_minutes := OLD.estimate_minutes;
  if is_assignee and not is_assigner then
    NEW.title := OLD.title; NEW.description := OLD.description;
    NEW.assigned_to := OLD.assigned_to; NEW.assigned_by := OLD.assigned_by;
    NEW.start_date := OLD.start_date; NEW.due_date := OLD.due_date; NEW.priority := OLD.priority;
    return NEW;
  end if;
  if is_assigner then
    if NEW.assigned_to <> OLD.assigned_to and not private.can_assign_task(NEW.assigned_to) then raise exception 'You are not allowed to assign this employee'; end if;
    NEW.assigned_by := OLD.assigned_by;
    return NEW;
  end if;
  raise exception 'Unauthorized task update';
end $function$;

-- H5. Client logins: staff with client.edit could INSERT/UPDATE client_users directly and attach any login
--     (profile_id) to any client organisation. The app only changes client_users through client_user_update and
--     the client-admin function (service role), so direct writes are removed.
revoke insert, update, delete on public.client_users from authenticated;

-- H6. Reset links for clients: at most 15 minutes (first-time setup invitations keep 72 hours).
--     Reset rows are the ones created with an explicit short expiry.
create or replace function private.clamp_reset_link_expiry()
 returns trigger language plpgsql set search_path to ''
as $function$
begin
  if new.expires_at <= now() + interval '25 hours' then
    new.expires_at := least(new.expires_at, now() + interval '15 minutes');
  end if;
  return new;
end $function$;
drop trigger if exists trg_clamp_reset_link_expiry on public.client_invitations;
create trigger trg_clamp_reset_link_expiry before insert on public.client_invitations
  for each row execute function private.clamp_reset_link_expiry();

-- H7. File records: size and type come from what storage actually holds, not from what the browser said.
create or replace function private.files_trust_storage_metadata()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare m jsonb;
begin
  select o.metadata into m from storage.objects o
   where o.bucket_id = coalesce(new.storage_bucket, 'sigma-files') and o.name = new.storage_path;
  if m is not null then
    new.size_bytes := coalesce(nullif(m ->> 'size', '')::bigint, new.size_bytes);
    new.mime_type := coalesce(nullif(m ->> 'mimetype', ''), new.mime_type);
  end if;
  return new;
end $function$;
drop trigger if exists trg_files_trust_storage_metadata on public.files;
create trigger trg_files_trust_storage_metadata before insert on public.files
  for each row execute function private.files_trust_storage_metadata();

-- H8. Links shown to clients must be web links (no javascript: or data: URLs).
alter table public.deliverables drop constraint if exists deliverables_reference_url_web;
alter table public.deliverables add constraint deliverables_reference_url_web
  check (reference_url in ('', '—') or reference_url ~* '^https?://[^[:space:]]+$') not valid;
alter table public.deliverables validate constraint deliverables_reference_url_web;
