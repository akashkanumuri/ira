-- SIGMA 1 — Client journey: contract → Term 1 → full access; drafts with 3 included; extra drafts billed;
-- payment requests with due dates, reminders and a project lock after 7 grace days.
--
-- Agreed with Akash (Nov 2026):
--  • The admin writes the contract in SIGMA (terms text + reusable templates) together with the payment plan (e.g. 50/30/20).
--    Contract value is final (GST included).
--  • The client sees only Contract + Support until the contract is accepted (tick + typed name) and Term 1 is verified.
--    Accepting requests Term 1 automatically; later terms are requested by hand from Billing.
--  • Drafts are sent by hand (link + note). 3 drafts included per deliverable (admin can change it per deliverable).
--    Asking for changes on the last included draft needs the client's "I understand" — the extra is recorded to bill.
--  • An extra charge is added to the next unpaid term; if every term is paid it becomes its own payment request.
--  • Requested payments have due dates; reminders 3 days before, on the day, and every 2 days when overdue.
--    7 days after the due date the client's project is locked (only Billing & contract and Help stay open) until paid.
--    On for every client by default; the admin can switch it off per client, hold, or open a project for some days.
-- Additive: new columns/tables/functions; changed functions keep their behaviour for staff.

set local lock_timeout = '5s';

-- ============================================================== settings: lock defaults + how to pay
alter table public.billing_settings
  add column if not exists bank_account_name text, add column if not exists bank_name text,
  add column if not exists bank_account_number text, add column if not exists bank_ifsc text,
  add column if not exists upi_id text, add column if not exists payment_note text;
update public.billing_settings set auto_lock_enabled = true, grace_days = 7, updated_at = now() where id;

-- ============================================================== contracts: written terms, signature, templates
alter table public.contract_versions add column if not exists terms_body text;
do $$ begin alter table public.contract_versions add constraint contract_versions_body_len check (terms_body is null or length(terms_body) <= 100000);
exception when duplicate_object then null; end $$;
alter table public.contracts add column if not exists first_term_due_days integer not null default 7;
do $$ begin alter table public.contracts add constraint contracts_first_term_due_days_check check (first_term_due_days between 0 and 90);
exception when duplicate_object then null; end $$;
alter table public.contract_acceptances add column if not exists signer_name text;

create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  body text not null default '' check (length(body) <= 100000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.contract_templates enable row level security;
drop policy if exists contract_templates_rw on public.contract_templates;
create policy contract_templates_rw on public.contract_templates for all to authenticated
  using (private.is_admin() or private.has_permission('contract.create'))
  with check (private.is_admin() or private.has_permission('contract.create'));
grant select, insert, update, delete on public.contract_templates to authenticated;

-- draft contracts (never sent) can be edited in place; everything else stays immutable
create or replace function private.protect_contract_version()
 returns trigger language plpgsql set search_path to ''
as $function$
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('sigma.contract_doc_attach', true), '') = 'on'
     and (new.contract_id, new.version_no, new.title, new.terms_summary, new.contract_value, new.start_date, new.end_date, new.change_note, new.created_by, new.created_at)
         is not distinct from (old.contract_id, old.version_no, old.title, old.terms_summary, old.contract_value, old.start_date, old.end_date, old.change_note, old.created_by, old.created_at)
     and exists (select 1 from public.contracts k where k.id = old.contract_id and k.status = 'Draft' and k.sent_at is null)
     and not exists (select 1 from public.contract_acceptances a where a.contract_version_id = old.id) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and coalesce(current_setting('sigma.contract_draft_edit', true), '') = 'on'
     and (new.contract_id, new.version_no, new.created_by, new.created_at) is not distinct from (old.contract_id, old.version_no, old.created_by, old.created_at)
     and exists (select 1 from public.contracts k where k.id = old.contract_id and k.status = 'Draft' and k.sent_at is null and k.current_version_no = old.version_no)
     and not exists (select 1 from public.contract_acceptances a where a.contract_version_id = old.id) then
    return new;
  end if;
  raise exception 'contract_versions records are immutable' using errcode = 'P0001';
end $function$;

-- ============================================================== payment terms: plan, requests, extras
alter table public.payment_installments
  add column if not exists term_no integer,
  add column if not exists requested_at timestamptz,
  add column if not exists requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists extra_amount numeric not null default 0;
do $$ begin alter table public.payment_installments add constraint payment_installments_extra_check check (extra_amount >= 0);
exception when duplicate_object then null; end $$;
create index if not exists payment_installments_contract_term_idx on public.payment_installments(contract_id, term_no) where deleted_at is null;

create or replace function private.installment_status(i public.payment_installments)
 returns text language plpgsql stable security definer set search_path to ''
as $function$
declare v_total numeric := coalesce(i.amount, 0) + coalesce(i.tax_amount, 0); v_today date := private.today_ist();
  v_soon int;
begin
  if i.status_override is not null then return i.status_override; end if;
  if v_total > 0 and i.amount_paid >= v_total then return 'Paid'; end if;
  -- a planned term is not payable until it is requested
  if i.term_no is not null and i.requested_at is null then return case when i.amount_paid > 0 then 'Partially Paid' else 'Upcoming' end; end if;
  if i.due_date is null then return case when i.amount_paid > 0 then 'Partially Paid' else 'Upcoming' end; end if;
  if v_today > i.due_date then return 'Overdue'; end if;
  if i.amount_paid > 0 then return 'Partially Paid'; end if;
  select due_soon_days into v_soon from public.billing_settings where id;
  if i.due_date - v_today <= coalesce(v_soon, 7) then return 'Due'; end if;
  return 'Upcoming';
end $function$;

create or replace function private.installments_before_write()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare v_value numeric; v_n int; v_recalc boolean := false;
begin
  select client_id into new.client_id from public.projects where id = new.project_id;
  if new.contract_id is not null then
    perform private.require(exists (select 1 from public.contracts k where k.id = new.contract_id and k.project_id = new.project_id),
      'Contract does not belong to this project');
  end if;
  if new.basis_type = 'percentage' then
    perform private.require(new.percentage is not null, 'Percentage is required for percentage-based milestones');
    if tg_op = 'INSERT' then
      v_recalc := true;
    elsif new.percentage is distinct from old.percentage or (new.requested_at is null and coalesce(new.amount_paid, 0) = 0) then
      v_recalc := true;
    end if;
    if v_recalc then
      select contract_value into v_value from public.contracts where id = new.contract_id;
      perform private.require(v_value is not null, 'Link a contract with a contract value to use percentage-based milestones');
      new.amount := round(v_value * new.percentage / 100, 2) + coalesce(new.extra_amount, 0);
    elsif new.extra_amount is distinct from old.extra_amount then
      new.amount := old.amount - coalesce(old.extra_amount, 0) + coalesce(new.extra_amount, 0);
    end if;
    new.basis := trim_scale(new.percentage)::text || '% of contract value';
  end if;
  if tg_op = 'INSERT' then
    if new.installment_number is null or new.installment_number <= 0 then
      perform pg_advisory_xact_lock(hashtext('inst-num:' || new.project_id::text));
      select coalesce(max(installment_number), 0) + 1 into v_n from public.payment_installments where project_id = new.project_id;
      new.installment_number := v_n;
    end if;
    new.amount_paid := 0;
  elsif coalesce(current_setting('sigma.payment_recalc', true), '') <> 'on' then
    new.amount_paid := old.amount_paid;  -- only verified payments change amount_paid
  end if;
  new.status := private.installment_status(new);
  new.updated_at := now();
  return new;
end $function$;

-- ============================================================== project access (what the client may see)
alter table public.projects
  add column if not exists access_hold boolean not null default false,
  add column if not exists access_hold_reason text,
  add column if not exists access_open_until date;

/** 'none' | 'no_contract' | 'contract' | 'pay_first' | 'open' | 'locked' */
create or replace function private.client_project_stage(p_project_id uuid)
 returns text language plpgsql stable security definer set search_path to ''
as $function$
declare pr public.projects; k public.contracts; t1 public.payment_installments; v_enabled boolean; v_grace int; v_today date := private.today_ist();
begin
  select * into pr from public.projects where id = p_project_id;
  if not found then return 'none'; end if;
  -- the latest contract the client has seen, or one being revised after it was accepted
  select * into k from public.contracts c where c.project_id = p_project_id and c.deleted_at is null
    and (c.status <> 'Draft' or exists (select 1 from public.contract_acceptances a where a.contract_id = c.id and a.event = 'Accepted'))
  order by c.created_at desc limit 1;
  if k.id is null then return 'no_contract'; end if;
  if not exists (select 1 from public.contract_acceptances a where a.contract_id = k.id and a.event = 'Accepted') then return 'contract'; end if;
  select * into t1 from public.payment_installments where contract_id = k.id and term_no = 1 and deleted_at is null limit 1;
  if t1.id is not null and t1.status not in ('Paid','Waived') then return 'pay_first'; end if;
  if pr.access_hold then return 'locked'; end if;
  if pr.access_open_until is not null and pr.access_open_until >= v_today then return 'open'; end if;
  select coalesce(cr.auto_lock_enabled, bs.auto_lock_enabled), coalesce(cr.grace_days, bs.grace_days) into v_enabled, v_grace
  from public.billing_settings bs left join public.client_billing_rules cr on cr.client_id = pr.client_id where bs.id;
  if coalesce(v_enabled, false) and exists (select 1 from public.payment_installments i where i.project_id = p_project_id and i.deleted_at is null
      and i.status = 'Overdue' and i.due_date is not null and (v_today - i.due_date) > coalesce(v_grace, 0)) then
    return 'locked';
  end if;
  return 'open';
end $function$;

create or replace function private.client_project_open(p_project_id uuid)
 returns boolean language sql stable security definer set search_path to ''
as $function$ select private.client_project_stage(p_project_id) = 'open' $function$;

-- clients see deliverables, inputs, change requests and their files only while the project is open
drop policy if exists deliverables_select_authorized on public.deliverables;
create policy deliverables_select_authorized on public.deliverables for select to authenticated using (
  private.can_manage_project(project_id)
  or ((deleted_at is null) and (responsible_id = private.current_employee_id()))
  or (private.is_client_of_project(project_id) and status <> 'Draft' and deleted_at is null
      and private.has_permission('client.deliverable.view') and private.client_project_open(project_id)));

drop policy if exists change_requests_select_authorized on public.change_requests;
create policy change_requests_select_authorized on public.change_requests for select to authenticated using (
  private.can_manage_project(project_id)
  or (private.is_client_of_project(project_id) and private.client_project_open(project_id))
  or exists (select 1 from public.deliverables d where d.id = change_requests.deliverable_id and d.responsible_id = private.current_employee_id()));

drop policy if exists deliverable_dependencies_select on public.deliverable_dependencies;
create policy deliverable_dependencies_select on public.deliverable_dependencies for select to authenticated using (
  private.can_manage_project(project_id)
  or (private.is_client_of_project(project_id) and private.client_project_open(project_id))
  or exists (select 1 from public.deliverables d where d.id = deliverable_dependencies.deliverable_id and d.responsible_id = private.current_employee_id()));

create or replace function private.is_deliverable_client(p_deliverable_id uuid)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from public.deliverables d where d.id = p_deliverable_id
                 and d.deleted_at is null and d.status <> 'Draft'
                 and private.is_client_of_project(d.project_id)
                 and private.has_permission('client.deliverable.view')
                 and private.client_project_open(d.project_id))
$function$;

create or replace function private.can_read_file(p_file_id uuid)
 returns boolean language plpgsql stable security definer set search_path to ''
as $function$
declare
  f public.files;
  d public.deliverables;
  v_emp uuid := private.current_employee_id();
begin
  select * into f from public.files where id = p_file_id;
  if not found then return false; end if;
  if private.is_admin() then return true; end if;
  if f.deleted_at is not null then return false; end if;
  if f.uploaded_by = (select auth.uid()) then return true; end if;
  if f.project_id is not null and private.can_manage_project(f.project_id) then return true; end if;
  if f.parent_type in ('payment','invoice') and private.has_permission('payment.record') then return true; end if;
  if v_emp is not null then
    if f.parent_type = 'deliverable' and exists (select 1 from public.deliverables x where x.id = f.parent_id and x.responsible_id = v_emp) then return true; end if;
    if f.parent_type = 'dependency' and exists (select 1 from public.deliverable_dependencies dd join public.deliverables x on x.id = dd.deliverable_id
                                                where dd.id = f.parent_id and x.responsible_id = v_emp) then return true; end if;
    if f.parent_type = 'task' and exists (select 1 from public.tasks t where t.id = f.parent_id and (t.assigned_to = v_emp or t.assigned_by = v_emp)) then return true; end if;
    if f.parent_type = 'leave' and exists (select 1 from public.leave_requests lr where lr.id = f.parent_id and (lr.employee_id = v_emp or lr.manager_id = v_emp)) then return true; end if;
  end if;
  if f.client_id is null or f.client_id is distinct from private.current_client_id() or f.visibility <> 'client' then
    return false;
  end if;
  if f.project_id is not null and not private.is_client_of_project(f.project_id) then return false; end if;
  case f.parent_type
    when 'deliverable' then
      select * into d from public.deliverables where id = f.parent_id;
      if not found or d.deleted_at is not null or d.status = 'Draft' then return false; end if;
      if not private.client_project_open(d.project_id) then return false; end if;
      if f.is_final then
        return d.status = 'Ready for Download'
           and d.lock_state in ('unlocked','override_unlocked')
           and private.has_permission('client.deliverable.download');
      end if;
      return private.has_permission('client.deliverable.view');
    when 'contract' then
      return exists (select 1 from public.contracts k where k.id = f.parent_id and k.status <> 'Draft' and k.deleted_at is null);
    when 'dependency' then
      return exists (select 1 from public.deliverable_dependencies dd where dd.id = f.parent_id and private.client_project_open(dd.project_id));
    when 'payment' then
      return true;
    when 'invoice' then
      return private.has_permission('client.billing.view');
    when 'project', 'client' then
      return true;
    else
      return false;
  end case;
end $function$;

-- client writes on a paused project are refused (covers every client RPC on these tables)
create or replace function private.client_write_needs_open()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if private.current_client_id() is not null and not private.client_project_open(new.project_id) then
    raise exception 'Your project is paused. Please check Billing & contract.' using errcode = 'P0001';
  end if;
  return new;
end $function$;
drop trigger if exists client_write_needs_open on public.change_requests;
create trigger client_write_needs_open before insert or update on public.change_requests for each row execute function private.client_write_needs_open();
drop trigger if exists client_write_needs_open on public.deliverable_dependencies;
create trigger client_write_needs_open before insert or update on public.deliverable_dependencies for each row execute function private.client_write_needs_open();

-- ============================================================== drafts: included count, extras to bill
alter table public.deliverables add column if not exists included_drafts integer not null default 3;
do $$ begin alter table public.deliverables add constraint deliverables_included_drafts_check check (included_drafts between 1 and 20);
exception when duplicate_object then null; end $$;
alter table public.deliverable_client_reviews
  add column if not exists is_extra boolean not null default false,
  add column if not exists extra_ack_at timestamptz;

create table if not exists public.deliverable_extra_charges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  review_id uuid not null unique references public.deliverable_client_reviews(id) on delete cascade,
  draft_no integer not null,
  amount numeric check (amount is null or amount > 0),
  status text not null default 'to_bill' check (status in ('to_bill','billed','waived')),
  installment_id uuid references public.payment_installments(id) on delete set null,
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  billed_at timestamptz,
  billed_by uuid references public.profiles(id) on delete set null
);
create index if not exists deliverable_extra_charges_project_idx on public.deliverable_extra_charges(project_id, status);
alter table public.deliverable_extra_charges enable row level security;
drop policy if exists deliverable_extra_charges_select on public.deliverable_extra_charges;
create policy deliverable_extra_charges_select on public.deliverable_extra_charges for select to authenticated using (
  private.can_manage_project(project_id) or private.has_permission('payment.record') or private.has_permission('invoice.generate')
  or (private.is_client_of_project(project_id) and private.has_permission('client.billing.view')));
revoke insert, update, delete on public.deliverable_extra_charges from anon, authenticated;
grant select on public.deliverable_extra_charges to authenticated;

create or replace function public.staff_send_to_client(p_deliverable_id uuid, p_link text, p_message text default null, p_task_id uuid default null)
 returns uuid language plpgsql security definer set search_path to ''
as $function$
declare d public.deliverables; t public.tasks; v_link text := nullif(btrim(coalesce(p_link, '')), ''); v_round int; v_seq int; v_id uuid; v_draft uuid;
begin
  select * into d from public.deliverables where id = p_deliverable_id and deleted_at is null for update;
  perform private.require(found, 'Deliverable not found');
  perform private.require(private.current_client_id() is null and private.can_manage_project(d.project_id), 'Only a manager or admin can send work to the client');
  perform private.require(d.status not in ('Draft','Cancelled'), 'This deliverable isn’t active');
  perform private.require(not exists (select 1 from public.deliverable_client_reviews where deliverable_id = d.id and status = 'pending'),
    'The client is still reviewing the last draft');
  if p_task_id is not null then
    select * into t from public.tasks where id = p_task_id and archived_at is null;
    perform private.require(found and t.deliverable_id = d.id, 'That task isn’t linked to this deliverable');
    perform private.require(t.status = 'completed', 'Approve the work internally before sending it to the client');
    select id, coalesce(v_link, link) into v_draft, v_link from public.task_drafts
      where task_id = t.id and decision in ('approved','auto_approved') order by draft_no desc limit 1;
    v_link := coalesce(v_link, t.submitted_link);
  end if;
  perform private.require(v_link is not null and v_link ~* '^https?://\S+$' and length(v_link) <= 1000, 'Add the link the client should review (http:// or https://)');
  perform private.require(p_message is null or length(p_message) <= 2000, 'Note is too long');
  select coalesce(max(round_no), 0) + 1 into v_round from public.deliverable_client_reviews where deliverable_id = d.id;
  select count(*) + 1 into v_seq from public.deliverable_client_reviews where deliverable_id = d.id and status <> 'withdrawn';
  perform private.deliverable_to_client_review(d.id, 'Draft ' || v_seq || ' sent to client');
  insert into public.deliverable_client_reviews(deliverable_id, project_id, client_id, task_id, draft_id, round_no, link, message, sent_by, is_extra)
  values (d.id, d.project_id, d.client_id, p_task_id, v_draft, v_round, v_link, nullif(btrim(coalesce(p_message, '')), ''), auth.uid(),
          v_seq > d.included_drafts)
  returning id into v_id;
  if d.client_id is not null then
    perform private.notify_client(d.client_id, 'deliverable', 'New draft to review',
      d.name || ' · draft ' || v_seq || ' is ready for your review.', '/client/deliverables', 'client_review_' || v_id);
  end if;
  return v_id;
end $function$;

drop function if exists public.client_decide_review(uuid, boolean, text);
create or replace function public.client_decide_review(p_review_id uuid, p_approve boolean, p_comment text default null, p_extra_ack boolean default false)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare r public.deliverable_client_reviews; d public.deliverables; v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_last boolean; v_seq int;
begin
  select * into r from public.deliverable_client_reviews where id = p_review_id for update;
  perform private.require(found and r.status = 'pending', 'This draft is no longer waiting for your review');
  select * into d from public.deliverables where id = r.deliverable_id for update;
  perform private.require(d.client_id = private.current_client_id() and private.is_client_of_project(d.project_id), 'Deliverable not found');
  perform private.require(private.has_permission('client.deliverable.review'), 'Your account is not permitted to review deliverables');
  perform private.require(private.client_project_open(d.project_id), 'Your project is paused. Please check Billing & contract.');
  perform private.require(p_approve or length(coalesce(v_comment, '')) >= 5, 'Describe the changes you need');
  select count(*) into v_seq from public.deliverable_client_reviews x where x.deliverable_id = d.id and x.status <> 'withdrawn' and x.round_no <= r.round_no;
  v_last := not p_approve and v_seq >= d.included_drafts;
  if v_last then
    perform private.require(coalesce(p_extra_ack, false),
      'This was your last included draft. Please confirm that further changes are charged extra.');
  end if;
  update public.deliverable_client_reviews set status = case when p_approve then 'approved' else 'changes_requested' end,
    client_comment = v_comment, decided_by = auth.uid(), decided_at = now(),
    extra_ack_at = case when v_last then now() else extra_ack_at end
  where id = r.id;
  if d.status = 'Awaiting Client Review' then
    perform set_config('sigma.change_reason', case when p_approve then 'Approved by client' else 'Client requested changes' end, true);
    update public.deliverables set status = case when p_approve then 'Completed' else 'Revision In Progress' end, client_action = null where id = d.id;
  end if;
  if v_last then
    insert into public.deliverable_extra_charges(project_id, client_id, deliverable_id, review_id, draft_no)
    values (d.project_id, d.client_id, d.id, r.id, v_seq + 1) on conflict (review_id) do nothing;
    perform private.notify_project_staff(d.project_id, 'billing', 'Extra draft to bill',
      d.name || ': the client asked for changes after the last included draft (' || d.included_drafts || '). Draft ' || (v_seq + 1) || ' is billable.',
      '/admin-clients?project=' || d.project_id || '&view=billing', 'extra_draft_' || r.id, true);
  end if;
  perform private.notify_project_staff(d.project_id, 'deliverable',
    case when p_approve then 'Client approved ' || d.name else 'Client requested changes on ' || d.name end,
    'Draft ' || v_seq || coalesce(': “' || left(v_comment, 160) || '”', ''),
    '/admin-clients?project=' || d.project_id || '&view=deliverables', 'client_decision_' || r.id, false);
end $function$;
grant execute on function public.client_decide_review(uuid, boolean, text, boolean) to authenticated;

-- the client's list of drafts (adds included / extra info)
drop function if exists public.client_deliverable_reviews(uuid);
create or replace function public.client_deliverable_reviews(p_deliverable_id uuid)
 returns table(id uuid, round_no integer, link text, message text, sent_at timestamptz, status text, client_comment text,
               decided_at timestamptz, link_locked boolean, is_extra boolean, included_drafts integer)
 language sql stable security definer set search_path to ''
as $function$
  select r.id, (row_number() over (order by r.round_no))::int,
         case when r.status = 'approved' and d.lock_state in ('locked_payment','locked_manual') then null else r.link end,
         r.message, r.sent_at, r.status, r.client_comment, r.decided_at,
         (r.status = 'approved' and d.lock_state in ('locked_payment','locked_manual')),
         r.is_extra, d.included_drafts
  from public.deliverable_client_reviews r join public.deliverables d on d.id = r.deliverable_id
  where r.deliverable_id = p_deliverable_id and r.status <> 'withdrawn' and private.is_deliverable_client(p_deliverable_id)
  order by r.round_no desc
$function$;
grant execute on function public.client_deliverable_reviews(uuid) to authenticated;

-- ============================================================== contract builder (staff)
create or replace function public.staff_update_contract_draft(p_contract_id uuid, p_title text, p_contract_value numeric,
  p_start_date date, p_end_date date, p_terms_body text, p_first_term_due_days integer default 7)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare k public.contracts;
begin
  select * into k from public.contracts where id = p_contract_id and deleted_at is null for update;
  perform private.require(found, 'Contract not found');
  perform private.require(private.has_permission('contract.create'), 'You are not allowed to edit contracts');
  perform private.require(k.status = 'Draft' and k.sent_at is null, 'Only an unsent draft can be edited. Make a new version instead.');
  perform private.require(length(btrim(coalesce(p_title, ''))) >= 3, 'Contract title is required');
  perform private.require(p_contract_value is null or p_contract_value > 0, 'Contract value must be more than 0');
  perform private.require(p_end_date is null or p_start_date is null or p_end_date >= p_start_date, 'End date cannot be before start date');
  perform private.require(p_terms_body is null or length(p_terms_body) <= 100000, 'Contract text is too long');
  perform private.require(coalesce(p_first_term_due_days, 7) between 0 and 90, 'Term 1 due days must be between 0 and 90');
  update public.contracts set title = btrim(p_title), contract_value = p_contract_value, start_date = p_start_date, end_date = p_end_date,
    first_term_due_days = coalesce(p_first_term_due_days, 7), updated_at = now() where id = k.id;
  perform set_config('sigma.contract_draft_edit', 'on', true);
  update public.contract_versions set title = btrim(p_title), contract_value = p_contract_value, start_date = p_start_date,
    end_date = p_end_date, terms_body = p_terms_body
  where contract_id = k.id and version_no = k.current_version_no;
  perform set_config('sigma.contract_draft_edit', '', true);
  -- planned terms follow the value
  update public.payment_installments set updated_at = now()
  where contract_id = k.id and deleted_at is null and term_no is not null and requested_at is null and amount_paid = 0;
end $function$;

/** p_terms: [{"name": "Advance", "percentage": 50}, ...] — the full plan, in order; must total 100. */
create or replace function public.staff_set_payment_plan(p_contract_id uuid, p_terms jsonb)
 returns integer language plpgsql security definer set search_path to ''
as $function$
declare k public.contracts; v_sum numeric := 0; v_n int := 0; e jsonb; v_pct numeric; v_name text;
begin
  select * into k from public.contracts where id = p_contract_id and deleted_at is null for update;
  perform private.require(found, 'Contract not found');
  perform private.require(private.has_permission('contract.create'), 'You are not allowed to edit contracts');
  perform private.require(k.status not in ('Terminated','Expired'), 'This contract is closed');
  perform private.require(coalesce(k.contract_value, 0) > 0, 'Set the contract value first');
  perform private.require(not exists (select 1 from public.payment_installments i where i.contract_id = k.id and i.term_no is not null
    and i.deleted_at is null and (i.requested_at is not null or i.amount_paid > 0)),
    'Payments have already been requested on this plan. Adjust the remaining terms from Billing.');
  perform private.require(jsonb_typeof(p_terms) = 'array' and jsonb_array_length(p_terms) between 1 and 10, 'Add between 1 and 10 payment terms');
  for e in select value from jsonb_array_elements(p_terms) loop
    v_pct := (e->>'percentage')::numeric;
    perform private.require(v_pct is not null and v_pct > 0 and v_pct <= 100, 'Each term needs a percentage above 0');
    v_sum := v_sum + v_pct;
  end loop;
  perform private.require(abs(v_sum - 100) < 0.01, 'The terms must add up to 100% (now ' || trim_scale(v_sum) || '%)');
  update public.payment_installments set deleted_at = now() where contract_id = k.id and term_no is not null and deleted_at is null;
  for e in select value from jsonb_array_elements(p_terms) loop
    v_n := v_n + 1;
    v_name := nullif(btrim(coalesce(e->>'name', '')), '');
    perform private.require(v_name is null or length(v_name) <= 80, 'Term name is too long');
    insert into public.payment_installments(project_id, contract_id, term_no, name, basis_type, percentage, status)
    values (k.project_id, k.id, v_n, coalesce(v_name, 'Term ' || v_n), 'percentage', (e->>'percentage')::numeric, 'Upcoming');
  end loop;
  return v_n;
end $function$;

create or replace function public.staff_send_contract(p_contract_id uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare k public.contracts; v_sum numeric;
begin
  select * into k from public.contracts where id = p_contract_id and deleted_at is null for update;
  perform private.require(found, 'Contract not found');
  perform private.require(private.has_permission('contract.send'), 'You are not allowed to send contracts');
  perform private.require(k.status in ('Draft','Declined'), 'Only draft or declined contracts can be sent');
  perform private.require(k.client_id is not null, 'Contract has no client');
  perform private.require(exists (select 1 from public.contract_versions v where v.contract_id = k.id and v.version_no = k.current_version_no
    and (length(btrim(coalesce(v.terms_body, ''))) >= 20 or (v.document_url is not null and v.document_url <> '') or v.document_file_id is not null)),
    'Write the contract terms (or attach the document) before sending');
  perform private.require(coalesce(k.contract_value, 0) > 0, 'Set the contract value before sending');
  select sum(percentage) into v_sum from public.payment_installments where contract_id = k.id and term_no is not null and deleted_at is null;
  perform private.require(v_sum is not null and abs(v_sum - 100) < 0.01, 'Add the payment plan (terms adding up to 100%) before sending');
  perform private.require(exists (select 1 from public.client_users cu where cu.client_id = k.client_id and cu.status <> 'inactive'),
    'The client has no portal user to receive this contract');
  update public.contracts set status = 'Sent', sent_at = now(), assigned_date = now(), updated_at = now() where id = k.id;
  perform private.notify_client(k.client_id, 'contract', 'Your contract is ready',
    k.title || ' is ready for you to review and accept.', '/client/contracts',
    'contract-sent:' || k.id || ':' || k.current_version_no);
end $function$;

-- revising keeps the written terms
drop function if exists public.staff_revise_contract(uuid, text, text, text, uuid, numeric, date, date, date, text);
create or replace function public.staff_revise_contract(p_contract_id uuid, p_change_note text, p_title text default null, p_document_url text default null,
  p_document_file_id uuid default null, p_contract_value numeric default null, p_start_date date default null, p_end_date date default null,
  p_renewal_date date default null, p_terms_summary text default null, p_terms_body text default null)
 returns integer language plpgsql security definer set search_path to ''
as $function$
declare k public.contracts; v_next int; v_prev public.contract_versions;
begin
  select * into k from public.contracts where id = p_contract_id and deleted_at is null for update;
  perform private.require(found, 'Contract not found');
  perform private.require(private.has_permission('contract.create'), 'You are not allowed to revise contracts');
  perform private.require(k.status not in ('Terminated','Expired'), 'Terminated or expired contracts cannot be revised');
  perform private.require(length(btrim(coalesce(p_change_note, ''))) >= 3, 'Describe what changed in this version');
  perform private.require(p_document_url is null or p_document_url ~* '^https://', 'Contract link must be an https:// URL');
  perform private.require(p_terms_body is null or length(p_terms_body) <= 100000, 'Contract text is too long');
  select * into v_prev from public.contract_versions where contract_id = k.id and version_no = k.current_version_no;
  v_next := k.current_version_no + 1;
  insert into public.contract_versions(contract_id, version_no, title, document_url, document_file_id, terms_summary, terms_body,
    contract_value, start_date, end_date, change_note, created_by)
  values (k.id, v_next, coalesce(nullif(btrim(p_title), ''), v_prev.title, k.title),
          coalesce(p_document_url, v_prev.document_url), coalesce(p_document_file_id, case when p_document_url is null then v_prev.document_file_id end),
          coalesce(p_terms_summary, v_prev.terms_summary), coalesce(p_terms_body, v_prev.terms_body), coalesce(p_contract_value, k.contract_value),
          coalesce(p_start_date, k.start_date), coalesce(p_end_date, k.end_date), btrim(p_change_note), auth.uid());
  -- Previous acceptance stays in contract_acceptances (immutable). The new version must be sent and accepted again.
  update public.contracts set
    current_version_no = v_next, version = 'v' || v_next,
    title = coalesce(nullif(btrim(p_title), ''), title),
    url = coalesce(p_document_url, case when p_document_file_id is not null then '' else url end),
    contract_value = coalesce(p_contract_value, contract_value),
    start_date = coalesce(p_start_date, start_date), end_date = coalesce(p_end_date, end_date),
    renewal_date = coalesce(p_renewal_date, renewal_date),
    status = 'Draft', accepted_at = null, accepted_url = null, viewed_at = null, sent_at = null,
    declined_at = null, decline_reason = null, updated_at = now()
  where id = k.id;
  return v_next;
end $function$;

-- ============================================================== client: sign + Term 1
-- Acceptance rows are immutable, so the typed signer name is written at insert time
-- (passed through a transaction-local setting). Accepting also requests Term 1 once,
-- whichever path the client used.
create or replace function public.client_accept_contract(p_contract_id uuid, p_version_no integer, p_acknowledged boolean, p_user_agent text default null)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare k public.contracts; v public.contract_versions; v_ack text :=
  'I have read and agree to the terms and conditions of this contract.';
  v_activated int; v_signer text := nullif(btrim(coalesce(current_setting('sigma.signer_name', true), '')), '');
begin
  select * into k from public.contracts where id = p_contract_id and deleted_at is null for update;
  perform private.require(found and k.client_id = private.current_client_id(), 'Contract not found');
  perform private.require(private.has_permission('client.contract.accept'), 'Your account is not permitted to accept contracts. Ask your organisation admin.');
  perform private.require(k.status in ('Sent','Viewed','Awaiting Acceptance'), 'This contract is not awaiting acceptance');
  perform private.require(p_version_no = k.current_version_no, 'A newer version of this contract has been issued. Please review the latest version.');
  perform private.require(p_acknowledged is true, 'You must confirm that you have read and agree to the terms');
  perform private.require(k.end_date is null or k.end_date >= private.today_ist(), 'This contract has already passed its end date');
  select * into v from public.contract_versions where contract_id = k.id and version_no = k.current_version_no;

  insert into public.contract_acceptances(contract_id, project_id, version, url, who, event, note, user_id, client_id,
    contract_version_id, version_no, ip_address, user_agent, acknowledgement, signer_name)
  values (k.id, k.project_id, 'v' || k.current_version_no, coalesce(v.document_url, k.url, ''),
          coalesce((select full_name from public.client_users where profile_id = auth.uid()), 'Client user'),
          'Accepted', null, auth.uid(), k.client_id, v.id, k.current_version_no, private.request_ip(),
          left(p_user_agent, 400), v_ack, left(v_signer, 120));

  update public.contracts set status = 'Accepted', accepted_at = now(), accepted_url = coalesce(v.document_url, k.url),
    updated_at = now() where id = k.id;

  -- COMMIT → ASSIGN: draft deliverables under this contract become active.
  update public.deliverables set status = 'Pending'
  where project_id = k.project_id and status = 'Draft' and deleted_at is null
    and (contract_id is null or contract_id = k.id);
  get diagnostics v_activated = row_count;

  -- Accepting requests Term 1 of the payment plan (once).
  update public.payment_installments set requested_at = now(), requested_by = auth.uid(),
    due_date = private.today_ist() + coalesce(k.first_term_due_days, 7)
  where contract_id = k.id and term_no = 1 and deleted_at is null and requested_at is null;

  perform private.notify_project_staff(k.project_id, 'contract', 'Contract accepted',
    k.title || ' v' || k.current_version_no || ' was accepted by the client' || coalesce(' (signed by ' || v_signer || ')', '') || '.',
    '/admin/clients', 'contract-accepted:' || k.id || ':' || k.current_version_no);
  return jsonb_build_object('status', 'Accepted', 'version_no', k.current_version_no, 'deliverables_activated', v_activated);
end $function$;

create or replace function public.client_sign_contract(p_contract_id uuid, p_version_no integer, p_signer_name text, p_user_agent text default null)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_name text := btrim(coalesce(p_signer_name, '')); r jsonb; v_first boolean;
begin
  perform private.require(length(v_name) between 3 and 120, 'Type your full name to sign');
  v_first := not exists (select 1 from public.contract_acceptances a where a.contract_id = p_contract_id and a.event = 'Accepted');
  perform set_config('sigma.signer_name', v_name, true);
  r := public.client_accept_contract(p_contract_id, p_version_no, true, p_user_agent);
  perform set_config('sigma.signer_name', '', true);
  return r || jsonb_build_object('first_acceptance', v_first);
end $function$;

create or replace function public.client_submit_payment(p_installment_id uuid, p_amount numeric, p_reference text, p_paid_on date,
  p_method text default null, p_proof_file_id uuid default null, p_idempotency_key text default null)
 returns uuid language plpgsql security definer set search_path to ''
as $function$
declare i public.payment_installments; v_id uuid; v_outstanding numeric;
begin
  if p_idempotency_key is not null then
    select id into v_id from public.payments where idempotency_key = p_idempotency_key and submitted_by = auth.uid();
    if v_id is not null then return v_id; end if;
  end if;
  select * into i from public.payment_installments where id = p_installment_id and deleted_at is null for update;
  perform private.require(found and i.client_id = private.current_client_id() and private.is_client_of_project(i.project_id), 'Payment milestone not found');
  perform private.require(private.has_permission('client.payment.submit'), 'Your account is not permitted to submit payments');
  perform private.require(i.status not in ('Paid','Cancelled','Waived'), 'This milestone does not accept payments');
  perform private.require(i.term_no is null or i.requested_at is not null, 'This payment hasn’t been requested yet');
  v_outstanding := i.amount + i.tax_amount - i.amount_paid
    - coalesce((select sum(amount) from public.payments where installment_id = i.id and status = 'Submitted'), 0);
  perform private.require(p_amount is not null and p_amount > 0, 'Enter the amount paid');
  perform private.require(p_amount <= v_outstanding, 'Amount exceeds the outstanding balance awaiting verification (' || v_outstanding || ')');
  perform private.require(length(btrim(coalesce(p_reference, ''))) >= 3, 'Enter the bank / UPI transaction reference');
  perform private.require(p_paid_on is not null and p_paid_on <= private.today_ist() and p_paid_on > private.today_ist() - 365, 'Enter a valid payment date');
  perform private.require(p_proof_file_id is null or exists (select 1 from public.files f where f.id = p_proof_file_id
    and f.parent_type = 'payment' and f.parent_id = i.id and f.uploaded_by = auth.uid()), 'Invalid payment proof');
  insert into public.payments(installment_id, project_id, amount, reference, paid_on, method, proof_file_id, status, source,
    submitted_by, idempotency_key)
  values (i.id, i.project_id, p_amount, btrim(p_reference), p_paid_on, p_method, p_proof_file_id, 'Submitted', 'client',
    auth.uid(), p_idempotency_key)
  returning id into v_id;
  perform private.notify_project_staff(i.project_id, 'billing', 'Payment submitted for verification',
    i.name || ': ₹' || to_char(p_amount, 'FM99,99,99,999.00') || ' · ref ' || btrim(p_reference), '/admin/clients',
    'pay-submitted:' || v_id, true);
  return v_id;
exception when unique_violation then
  raise exception 'This payment reference has already been submitted for this milestone' using errcode = 'P0001';
end $function$;

-- how to pay (bank / UPI), readable by the client
create or replace function public.client_payment_details()
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select case when auth.uid() is null then null else
    jsonb_build_object('account_name', bank_account_name, 'bank_name', bank_name, 'account_number', bank_account_number,
                       'ifsc', bank_ifsc, 'upi_id', upi_id, 'note', payment_note) end
  from public.billing_settings where id
$function$;

create or replace function public.staff_set_payment_details(p_account_name text, p_bank_name text, p_account_number text, p_ifsc text, p_upi_id text, p_note text)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  perform private.require(private.is_admin() or private.has_permission('billing.settings'), 'Only an admin can change payment details');
  perform private.require(p_ifsc is null or btrim(p_ifsc) = '' or btrim(p_ifsc) ~* '^[A-Z]{4}0[A-Z0-9]{6}$', 'IFSC looks wrong (e.g. HDFC0001234)');
  perform private.require(p_upi_id is null or btrim(p_upi_id) = '' or btrim(p_upi_id) ~ '^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$', 'UPI ID looks wrong (e.g. name@okhdfc)');
  update public.billing_settings set bank_account_name = nullif(btrim(p_account_name), ''), bank_name = nullif(btrim(p_bank_name), ''),
    bank_account_number = nullif(btrim(p_account_number), ''), bank_ifsc = upper(nullif(btrim(p_ifsc), '')),
    upi_id = nullif(btrim(p_upi_id), ''), payment_note = nullif(btrim(p_note), ''), updated_by = auth.uid(), updated_at = now()
  where id;
end $function$;

-- ============================================================== billing actions (staff)
create or replace function public.finance_request_installment(p_installment_id uuid, p_due_date date)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare i public.payment_installments;
begin
  select * into i from public.payment_installments where id = p_installment_id and deleted_at is null for update;
  perform private.require(found, 'Payment term not found');
  perform private.require(private.is_admin() or private.has_permission('invoice.generate'), 'You are not allowed to request payments');
  perform private.require(i.status not in ('Paid','Cancelled','Waived'), 'This term is already settled');
  perform private.require(p_due_date is not null and p_due_date >= private.today_ist(), 'Pick a due date from today on');
  update public.payment_installments set requested_at = coalesce(requested_at, now()), requested_by = coalesce(requested_by, auth.uid()),
    due_date = p_due_date where id = i.id;
  perform private.notify_client(i.client_id, 'billing', 'Payment requested',
    i.name || ' · ₹' || to_char(i.amount + i.tax_amount - i.amount_paid, 'FM99,99,99,999') || ' is due by ' || to_char(p_due_date, 'DD Mon YYYY') || '.',
    '/client/payments', 'pay-request:' || i.id || ':' || p_due_date);
end $function$;

create or replace function public.finance_bill_extra(p_charge_id uuid, p_amount numeric, p_note text default null)
 returns uuid language plpgsql security definer set search_path to ''
as $function$
declare c public.deliverable_extra_charges; d public.deliverables; i public.payment_installments; v_id uuid;
begin
  select * into c from public.deliverable_extra_charges where id = p_charge_id for update;
  perform private.require(found, 'Extra charge not found');
  perform private.require(private.is_admin() or private.has_permission('invoice.generate'), 'You are not allowed to bill extras');
  perform private.require(c.status = 'to_bill', 'This extra has already been handled');
  perform private.require(p_amount is not null and p_amount > 0 and p_amount <= 10000000, 'Enter the extra amount');
  select * into d from public.deliverables where id = c.deliverable_id;
  -- the next unpaid term carries it; if every term is paid it becomes its own payment request
  select * into i from public.payment_installments where project_id = c.project_id and deleted_at is null
    and status not in ('Paid','Cancelled','Waived') order by installment_number limit 1 for update;
  if i.id is not null then
    update public.payment_installments set extra_amount = extra_amount + p_amount,
      amount = case when basis_type = 'percentage' then amount else amount + p_amount end
    where id = i.id;
    v_id := i.id;
    perform private.notify_client(c.client_id, 'billing', 'Extra draft added to ' || i.name,
      'Extra draft for ' || d.name || ' (draft ' || c.draft_no || '): ₹' || to_char(p_amount, 'FM99,99,99,999') || ' added to ' || i.name || '.',
      '/client/payments', 'extra-billed:' || c.id);
  else
    insert into public.payment_installments(project_id, name, basis_type, basis, amount, extra_amount, status, requested_at, requested_by, due_date)
    values (c.project_id, 'Extra draft · ' || d.name || ' (draft ' || c.draft_no || ')', 'fixed', 'Extra draft', p_amount, p_amount, 'Upcoming',
            now(), auth.uid(), private.today_ist() + 7)
    returning id into v_id;
    perform private.notify_client(c.client_id, 'billing', 'Payment requested',
      'Extra draft for ' || d.name || ': ₹' || to_char(p_amount, 'FM99,99,99,999') || ' due by ' || to_char(private.today_ist() + 7, 'DD Mon YYYY') || '.',
      '/client/payments', 'extra-billed:' || c.id);
  end if;
  update public.deliverable_extra_charges set amount = p_amount, status = 'billed', installment_id = v_id, note = nullif(btrim(coalesce(p_note, '')), ''),
    billed_at = now(), billed_by = auth.uid() where id = c.id;
  return v_id;
end $function$;

create or replace function public.finance_waive_extra(p_charge_id uuid, p_note text default null)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare c public.deliverable_extra_charges;
begin
  select * into c from public.deliverable_extra_charges where id = p_charge_id for update;
  perform private.require(found, 'Extra charge not found');
  perform private.require(private.is_admin() or private.has_permission('invoice.generate'), 'You are not allowed to change extras');
  perform private.require(c.status = 'to_bill', 'This extra has already been handled');
  update public.deliverable_extra_charges set status = 'waived', note = nullif(btrim(coalesce(p_note, '')), ''), billed_at = now(), billed_by = auth.uid()
  where id = c.id;
end $function$;

create or replace function public.staff_withdraw_draft(p_review_id uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare r public.deliverable_client_reviews; d public.deliverables;
begin
  select * into r from public.deliverable_client_reviews where id = p_review_id for update;
  perform private.require(found, 'Draft not found');
  select * into d from public.deliverables where id = r.deliverable_id for update;
  perform private.require(private.current_client_id() is null and private.can_manage_project(d.project_id), 'Only a manager or admin can withdraw a draft');
  perform private.require(r.status = 'pending', 'Only a draft the client hasn’t answered can be withdrawn');
  update public.deliverable_client_reviews set status = 'withdrawn' where id = r.id;
  if d.status = 'Awaiting Client Review' then
    perform set_config('sigma.change_reason', 'Draft withdrawn by the team', true);
    update public.deliverables set status = 'Revision In Progress' where id = d.id;
  end if;
end $function$;

create or replace function public.staff_set_included_drafts(p_deliverable_id uuid, p_count integer)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare d public.deliverables;
begin
  select * into d from public.deliverables where id = p_deliverable_id and deleted_at is null for update;
  perform private.require(found and private.current_client_id() is null and private.can_manage_project(d.project_id), 'Only a manager or admin can change this');
  perform private.require(p_count between 1 and 20, 'Included drafts must be between 1 and 20');
  update public.deliverables set included_drafts = p_count where id = d.id;
end $function$;

create or replace function public.staff_set_project_access(p_project_id uuid, p_action text, p_days integer default 7, p_reason text default null)
 returns text language plpgsql security definer set search_path to ''
as $function$
declare pr public.projects; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into pr from public.projects where id = p_project_id and deleted_at is null for update;
  perform private.require(found, 'Project not found');
  perform private.require(private.is_admin() or private.has_permission('payment.record'), 'Only an admin can change client access');
  perform private.require(p_action in ('hold','release','open_for_days'), 'Unknown action');
  if p_action = 'hold' then
    perform private.require(v_reason is not null, 'Give a reason — the client sees it');
    update public.projects set access_hold = true, access_hold_reason = left(v_reason, 300), access_open_until = null, updated_at = now() where id = pr.id;
    perform private.notify_client(pr.client_id, 'billing', 'Project paused', left(v_reason, 300), '/client/payments', 'hold:' || pr.id || ':' || extract(epoch from now())::bigint);
  elsif p_action = 'release' then
    update public.projects set access_hold = false, access_hold_reason = null, access_open_until = null, updated_at = now() where id = pr.id;
  else
    perform private.require(p_days between 1 and 60, 'Open for 1 to 60 days');
    update public.projects set access_hold = false, access_hold_reason = null, access_open_until = private.today_ist() + p_days, updated_at = now() where id = pr.id;
  end if;
  return private.client_project_stage(pr.id);
end $function$;

-- ============================================================== one call for the portal (client) and the stage pill (staff)
create or replace function public.client_portal_state(p_project_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v_stage text; k public.contracts; t1 public.payment_installments; od public.payment_installments; pr public.projects;
  v_grace int; v_enabled boolean; v_pending_reaccept boolean;
begin
  perform private.require(private.is_client_of_project(p_project_id) or private.can_manage_project(p_project_id) or private.has_permission('payment.record'),
    'Project not found');
  select * into pr from public.projects where id = p_project_id;
  v_stage := private.client_project_stage(p_project_id);
  select * into k from public.contracts c where c.project_id = p_project_id and c.deleted_at is null
    and (c.status <> 'Draft' or exists (select 1 from public.contract_acceptances a where a.contract_id = c.id and a.event = 'Accepted')
         or private.current_client_id() is null)
  order by c.created_at desc limit 1;
  if k.id is not null then
    select * into t1 from public.payment_installments where contract_id = k.id and term_no = 1 and deleted_at is null limit 1;
  end if;
  select coalesce(cr.auto_lock_enabled, bs.auto_lock_enabled), coalesce(cr.grace_days, bs.grace_days) into v_enabled, v_grace
  from public.billing_settings bs left join public.client_billing_rules cr on cr.client_id = pr.client_id where bs.id;
  select * into od from public.payment_installments i where i.project_id = p_project_id and i.deleted_at is null and i.status = 'Overdue'
  order by i.due_date limit 1;
  v_pending_reaccept := k.id is not null and k.status in ('Sent','Viewed','Awaiting Acceptance')
    and exists (select 1 from public.contract_acceptances a where a.contract_id = k.id and a.event = 'Accepted');
  return jsonb_build_object(
    'stage', v_stage,
    'contract', case when k.id is null then null else jsonb_build_object('id', k.id, 'title', k.title, 'status', k.status,
      'version_no', k.current_version_no, 'value', k.contract_value, 'sent_at', k.sent_at, 'viewed_at', k.viewed_at,
      'first_term_due_days', k.first_term_due_days, 'reaccept', v_pending_reaccept) end,
    'term1', case when t1.id is null then null else jsonb_build_object('id', t1.id, 'name', t1.name, 'amount', t1.amount,
      'paid', t1.amount_paid, 'status', t1.status, 'due_date', t1.due_date, 'requested_at', t1.requested_at,
      'submitted', exists (select 1 from public.payments p where p.installment_id = t1.id and p.status = 'Submitted')) end,
    'overdue', case when od.id is null then null else jsonb_build_object('id', od.id, 'name', od.name,
      'amount', od.amount + od.tax_amount - od.amount_paid, 'due_date', od.due_date,
      'lock_on', (od.due_date + coalesce(v_grace, 0) + 1)) end,
    'auto_lock', coalesce(v_enabled, false), 'grace_days', coalesce(v_grace, 0),
    'hold_reason', case when pr.access_hold then pr.access_hold_reason end,
    'open_until', pr.access_open_until);
end $function$;

-- ============================================================== reminders + lock notices (hourly job)
create or replace function private.evaluate_project_locks(p_project_id uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare
  v_client uuid; v_enabled boolean; v_grace int; v_inst public.payment_installments; r record;
  v_today date := private.today_ist();
begin
  select client_id into v_client from public.projects where id = p_project_id;
  select coalesce(cr.auto_lock_enabled, bs.auto_lock_enabled), coalesce(cr.grace_days, bs.grace_days)
    into v_enabled, v_grace
  from public.billing_settings bs left join public.client_billing_rules cr on cr.client_id = v_client
  where bs.id;

  select * into v_inst from public.payment_installments i
  where i.project_id = p_project_id and i.deleted_at is null and i.status = 'Overdue'
    and i.due_date is not null and (v_today - i.due_date) > coalesce(v_grace, 0)
  order by i.due_date limit 1;

  perform set_config('sigma.lock_change', 'on', true);
  if coalesce(v_enabled, false) and v_inst.id is not null then
    for r in update public.deliverables set lock_state = 'locked_payment', locked_at = now(),
               lock_reason = 'Payment overdue: ' || v_inst.name
             where project_id = p_project_id and deleted_at is null and lock_state = 'unlocked'
             returning id
    loop
      insert into public.deliverable_lock_events(deliverable_id, previous_state, new_state, source, reason, installment_id, actor_id)
      values (r.id, 'unlocked', 'locked_payment', 'payment_rule', 'Payment overdue beyond grace period: ' || v_inst.name, v_inst.id, auth.uid());
    end loop;
    perform private.notify_client(v_client, 'billing', 'Project paused',
      'Your project is paused because ' || v_inst.name || ' is overdue. Pay to restore access to your work.',
      '/client/payments', 'lock:' || p_project_id || ':' || v_inst.id);
    perform private.notify_project_staff(p_project_id, 'billing', 'Client project paused for overdue payment',
      v_inst.name || ' is ' || (v_today - v_inst.due_date) || ' days overdue; the client can only see Billing and Help.', '/admin/clients',
      'lock-staff:' || p_project_id || ':' || v_inst.id, true);
  else
    for r in update public.deliverables set lock_state = 'unlocked', locked_at = null, lock_reason = null
             where project_id = p_project_id and lock_state = 'locked_payment'
             returning id
    loop
      insert into public.deliverable_lock_events(deliverable_id, previous_state, new_state, source, reason, actor_id)
      values (r.id, 'locked_payment', 'unlocked', 'payment_cleared', 'No overdue payment beyond grace period', auth.uid());
    end loop;
    if found then
      perform private.notify_client(v_client, 'billing', 'Project restored', 'Thank you — your project is open again.',
        '/client/deliverables', 'unlock:' || p_project_id || ':' || v_today);
    end if;
  end if;
  perform set_config('sigma.lock_change', '', true);
end $function$;

create or replace function private.refresh_billing_state()
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare r record; v_changed int := 0; v_today date := private.today_ist(); v_remind int; p uuid; v_due numeric;
begin
  select reminder_days_before into v_remind from public.billing_settings where id;
  for r in select i.*, private.installment_status(i) as computed from public.payment_installments i where i.deleted_at is null loop
    if r.computed is distinct from r.status then
      update public.payment_installments set updated_at = now() where id = r.id;  -- trigger recomputes status
      v_changed := v_changed + 1;
    end if;
    continue when r.term_no is not null and r.requested_at is null;   -- not requested yet: no reminders
    continue when r.due_date is null or r.computed in ('Paid','Cancelled','Waived');
    v_due := r.amount + r.tax_amount - r.amount_paid;
    if r.due_date - v_today = coalesce(v_remind, 3) then
      perform private.notify_client(r.client_id, 'billing', 'Payment due in ' || coalesce(v_remind, 3) || ' days',
        r.name || ' · ₹' || to_char(v_due, 'FM99,99,99,999') || ' is due on ' || to_char(r.due_date, 'DD Mon YYYY') || '.', '/client/payments',
        'due-soon:' || r.id || ':' || r.due_date);
    elsif r.due_date = v_today then
      perform private.notify_client(r.client_id, 'billing', 'Payment due today',
        r.name || ' · ₹' || to_char(v_due, 'FM99,99,99,999') || ' is due today.', '/client/payments', 'due-today:' || r.id || ':' || r.due_date);
    elsif v_today > r.due_date and (v_today - r.due_date) % 2 = 1 then
      perform private.notify_client(r.client_id, 'billing', 'Payment overdue',
        r.name || ' · ₹' || to_char(v_due, 'FM99,99,99,999') || ' was due on ' || to_char(r.due_date, 'DD Mon YYYY') || '.', '/client/payments',
        'overdue:' || r.id || ':' || v_today);
      if v_today - r.due_date = 1 then
        perform private.notify_project_staff(r.project_id, 'billing', 'Payment overdue',
          r.name || ' was due on ' || to_char(r.due_date, 'DD Mon YYYY') || '.', '/admin/clients', 'overdue-staff:' || r.id, true);
      end if;
    end if;
  end loop;
  for p in select distinct project_id from public.payment_installments where deleted_at is null
           union select distinct project_id from public.deliverables where lock_state = 'locked_payment' loop
    perform private.evaluate_project_locks(p);
  end loop;
  update public.contracts set status = 'Expired', updated_at = now()
  where status = 'Accepted' and end_date is not null and end_date < v_today and deleted_at is null;
  return jsonb_build_object('installments_changed', v_changed, 'ran_at', now());
end $function$;

-- ============================================================== grants
revoke all on function public.staff_update_contract_draft(uuid, text, numeric, date, date, text, integer) from public, anon;
revoke all on function public.staff_set_payment_plan(uuid, jsonb) from public, anon;
revoke all on function public.staff_revise_contract(uuid, text, text, text, uuid, numeric, date, date, date, text, text) from public, anon;
revoke all on function public.client_sign_contract(uuid, integer, text, text) from public, anon;
revoke all on function public.client_payment_details() from public, anon;
revoke all on function public.staff_set_payment_details(text, text, text, text, text, text) from public, anon;
revoke all on function public.finance_request_installment(uuid, date) from public, anon;
revoke all on function public.finance_bill_extra(uuid, numeric, text) from public, anon;
revoke all on function public.finance_waive_extra(uuid, text) from public, anon;
revoke all on function public.staff_set_included_drafts(uuid, integer) from public, anon;
revoke all on function public.staff_withdraw_draft(uuid) from public, anon;
grant execute on function public.staff_withdraw_draft(uuid) to authenticated;
revoke all on function public.staff_set_project_access(uuid, text, integer, text) from public, anon;
revoke all on function public.client_portal_state(uuid) from public, anon;
revoke all on function public.client_decide_review(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.staff_update_contract_draft(uuid, text, numeric, date, date, text, integer) to authenticated;
grant execute on function public.staff_set_payment_plan(uuid, jsonb) to authenticated;
grant execute on function public.staff_revise_contract(uuid, text, text, text, uuid, numeric, date, date, date, text, text) to authenticated;
grant execute on function public.client_sign_contract(uuid, integer, text, text) to authenticated;
grant execute on function public.client_payment_details() to authenticated;
grant execute on function public.staff_set_payment_details(text, text, text, text, text, text) to authenticated;
grant execute on function public.finance_request_installment(uuid, date) to authenticated;
grant execute on function public.finance_bill_extra(uuid, numeric, text) to authenticated;
grant execute on function public.finance_waive_extra(uuid, text) to authenticated;
grant execute on function public.staff_set_included_drafts(uuid, integer) to authenticated;
grant execute on function public.staff_set_project_access(uuid, text, integer, text) to authenticated;
grant execute on function public.client_portal_state(uuid) to authenticated;
grant execute on function public.client_decide_review(uuid, boolean, text, boolean) to authenticated;
