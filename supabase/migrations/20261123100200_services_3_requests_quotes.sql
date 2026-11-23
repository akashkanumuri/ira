-- Services module, part 3: client service requests, quotations (versioned), activity log.
-- Accepted quote → admin picks/creates the project → contract + payment terms (the usual Advance / … / Final style) →
-- first term requested → when it is paid (or admin records an exception) the quote lines become deliverables.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'attendance','leave','wfh','task','holiday','payroll','system','contract','deliverable','dependency',
  'modification','billing','client','activity','lead','service']));

alter table public.files drop constraint if exists files_parent_type_check;
alter table public.files add constraint files_parent_type_check check (parent_type = any (array[
  'contract','deliverable','dependency','task','invoice','payment','employee','client','project','leave','service_request']));

create sequence if not exists public.service_request_no_seq;

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique default ('SR-' || lpad(nextval('public.service_request_no_seq')::text, 4, '0')),
  client_id uuid not null references public.clients(id) on delete restrict,
  requested_by uuid references public.profiles(id) on delete set null,
  brief text not null check (length(btrim(brief)) between 5 and 4000),
  timeline text check (timeline is null or length(timeline) <= 200),
  preferred_date date,
  notes text check (notes is null or length(notes) <= 2000),
  status text not null default 'new' check (status in ('new','under_review','quote_draft','quote_sent','revision_requested',
    'approved','rejected','payment_pending','paid','in_progress','completed','cancelled')),
  assigned_to uuid references public.employees(id) on delete set null,
  project_id uuid references public.projects(id) on delete restrict,
  contract_id uuid references public.contracts(id) on delete restrict,
  accepted_quote_id uuid,
  payment_exception boolean not null default false,
  exception_reason text check (exception_reason is null or length(exception_reason) <= 400),
  exception_by uuid references public.profiles(id) on delete set null,
  close_reason text check (close_reason is null or length(close_reason) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_requests_client_idx on public.service_requests(client_id, created_at desc);
create index if not exists service_requests_status_idx on public.service_requests(status);
create index if not exists service_requests_contract_idx on public.service_requests(contract_id);

create table if not exists public.service_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  service_name text not null,
  category_name text,
  subcategory_name text
);
create index if not exists service_request_items_req_idx on public.service_request_items(request_id);

create table if not exists public.service_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete restrict,
  version_no int not null,
  status text not null default 'draft' check (status in ('draft','sent','accepted','rejected','revision_requested','superseded')),
  scope text check (scope is null or length(scope) <= 6000),
  timeline text check (timeline is null or length(timeline) <= 600),
  terms text check (terms is null or length(terms) <= 6000),
  valid_until date,
  payment_terms jsonb not null default '[{"name":"Advance","percentage":50},{"name":"Final payment","percentage":50}]'::jsonb,
  first_term_due_days int not null default 3 check (first_term_due_days between 0 and 60),
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  taxable_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  cgst_total numeric(14,2) not null default 0, sgst_total numeric(14,2) not null default 0, igst_total numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  supply_type text check (supply_type in ('intra','inter')),
  seller jsonb, buyer jsonb,
  client_note text check (client_note is null or length(client_note) <= 2000),
  sent_at timestamptz, sent_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz, responded_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, version_no)
);

create table if not exists public.service_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.service_quotes(id) on delete cascade,
  line_no int not null,
  service_id uuid references public.services(id) on delete set null,
  description text not null check (length(btrim(description)) between 1 and 300),
  details text check (details is null or length(details) <= 1000),
  sac text not null check (sac ~ '^[0-9]{4,8}$'),
  qty numeric(12,2) not null check (qty > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  taxable numeric(14,2) not null,
  gst_rate numeric(5,2) not null check (gst_rate in (0, 5, 12, 18, 28, 40)),
  tax numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  due_in_days int check (due_in_days is null or due_in_days between 0 and 730),
  unique (quote_id, line_no)
);

create table if not exists public.service_activity (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  kind text not null check (kind in ('status','note','quote','payment','system')),
  from_status text, to_status text,
  note text check (note is null or length(note) <= 2000),
  internal boolean not null default false,
  actor uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists service_activity_req_idx on public.service_activity(request_id, created_at desc);

-- Sent quotes are frozen: only their status / response fields change afterwards.
create or replace function private.service_quote_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'service_quote_items' then
    if exists (select 1 from public.service_quotes q where q.id = coalesce(new.quote_id, old.quote_id) and q.status <> 'draft') then
      raise exception 'A sent quotation cannot be changed. Make a new version.' using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'A sent quotation cannot be deleted.' using errcode = '42501'; end if;
    return old;
  end if;
  if old.status <> 'draft' and (to_jsonb(new) - array['status','responded_at','responded_by','client_note','updated_at'])
       is distinct from (to_jsonb(old) - array['status','responded_at','responded_by','client_note','updated_at']) then
    raise exception 'A sent quotation cannot be changed. Make a new version.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists service_quotes_frozen on public.service_quotes;
create trigger service_quotes_frozen before update or delete on public.service_quotes for each row execute function private.service_quote_frozen();
drop trigger if exists service_quote_items_frozen on public.service_quote_items;
create trigger service_quote_items_frozen before insert or update or delete on public.service_quote_items for each row execute function private.service_quote_frozen();

-- ---------------------------------------------------------------- access
create or replace function private.can_see_service_request(p_client uuid, p_assigned uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not private.offer_locked() and (
    private.has_permission('service.manage')
    or (p_assigned is not null and p_assigned = private.current_employee_id())
    or (p_client = private.current_client_id() and private.has_permission('client.dashboard.view')));
$$;
grant execute on function private.can_see_service_request(uuid, uuid) to authenticated;

alter table public.service_requests enable row level security;
alter table public.service_request_items enable row level security;
alter table public.service_quotes enable row level security;
alter table public.service_quote_items enable row level security;
alter table public.service_activity enable row level security;
revoke all on public.service_requests, public.service_request_items, public.service_quotes, public.service_quote_items, public.service_activity from anon;
revoke insert, update, delete on public.service_requests, public.service_request_items, public.service_quotes, public.service_quote_items, public.service_activity from authenticated;
grant select on public.service_requests, public.service_request_items, public.service_quotes, public.service_quote_items, public.service_activity to authenticated;

create policy service_requests_select on public.service_requests for select to authenticated
  using (private.can_see_service_request(client_id, assigned_to));
create policy service_request_items_select on public.service_request_items for select to authenticated
  using (exists (select 1 from public.service_requests r where r.id = request_id));
create policy service_quotes_select on public.service_quotes for select to authenticated
  using (exists (select 1 from public.service_requests r where r.id = request_id)
         and (status <> 'draft' or private.has_permission('service.manage')));
create policy service_quote_items_select on public.service_quote_items for select to authenticated
  using (exists (select 1 from public.service_quotes q where q.id = quote_id));
create policy service_activity_select on public.service_activity for select to authenticated
  using (exists (select 1 from public.service_requests r where r.id = request_id)
         and (not internal or private.current_client_id() is null));
create policy offer_lock on public.service_requests as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.service_request_items as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.service_quotes as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.service_quote_items as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.service_activity as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));

-- ---------------------------------------------------------------- helpers
create or replace function private.service_log(p_request uuid, p_kind text, p_from text, p_to text, p_note text, p_internal boolean)
returns void language sql security definer set search_path = '' as $$
  insert into public.service_activity (request_id, kind, from_status, to_status, note, internal, actor)
  values (p_request, p_kind, p_from, p_to, left(p_note, 2000), coalesce(p_internal, false), auth.uid());
$$;

create or replace function private.service_set_status(p_request uuid, p_to text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_from text;
begin
  select status into v_from from public.service_requests where id = p_request for update;
  if v_from is distinct from p_to then
    update public.service_requests set status = p_to, updated_at = now() where id = p_request;
    perform private.service_log(p_request, 'status', v_from, p_to, p_note, false);
  end if;
end $$;

create or replace function private.notify_service_managers(p_title text, p_message text, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select distinct p.id from public.profiles p
    where p.role = 'admin' or exists (select 1 from public.user_roles ur join public.role_permissions rp
      on rp.role_code = ur.role_code and rp.permission_code = 'service.manage' where ur.user_id = p.id)
  loop
    if r.id is distinct from auth.uid() then
      perform private.notify(r.id, 'service', p_title, p_message, '/admin-services', p_key || ':' || r.id, '{}'::jsonb);
    end if;
  end loop;
end $$;

-- Recalculate a draft quote's line maths and totals. Supply type comes from the seller and buyer state codes.
create or replace function private.service_quote_recalc(p_quote uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.service_quotes; r public.service_requests; v_seller text; v_buyer text; v_supply text;
begin
  select * into q from public.service_quotes where id = p_quote;
  select * into r from public.service_requests where id = q.request_id;
  select state_code into v_seller from public.company_profile where id;
  select state_code into v_buyer from public.client_billing_profiles where client_id = r.client_id;
  v_supply := case when v_seller is null or v_buyer is null then null when v_seller = v_buyer then 'intra' else 'inter' end;
  update public.service_quote_items set
    taxable = round(qty * unit_price - discount, 2),
    tax = round(round(qty * unit_price - discount, 2) * gst_rate / 100, 2),
    total = round(qty * unit_price - discount, 2) + round(round(qty * unit_price - discount, 2) * gst_rate / 100, 2)
  where quote_id = p_quote;
  update public.service_quotes s set
    subtotal = coalesce(x.sub, 0), discount_total = coalesce(x.disc, 0), taxable_total = coalesce(x.taxable, 0),
    tax_total = coalesce(x.tax, 0),
    cgst_total = case when v_supply = 'intra' then round(coalesce(x.tax, 0) / 2, 2) else 0 end,
    sgst_total = case when v_supply = 'intra' then coalesce(x.tax, 0) - round(coalesce(x.tax, 0) / 2, 2) else 0 end,
    igst_total = case when v_supply = 'inter' then coalesce(x.tax, 0) else 0 end,
    grand_total = coalesce(x.taxable, 0) + coalesce(x.tax, 0), supply_type = v_supply, updated_at = now()
  from (select round(sum(qty * unit_price), 2) sub, sum(discount) disc, sum(taxable) taxable, sum(tax) tax
          from public.service_quote_items where quote_id = p_quote) x
  where s.id = p_quote;
end $$;

-- ---------------------------------------------------------------- client: create / cancel
create or replace function public.client_service_request_create(p_service_ids uuid[], p_brief text, p_timeline text,
  p_preferred_date date, p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_client uuid := private.current_client_id(); v_id uuid; v_n int; v_no text; v_name text;
begin
  perform private.require(v_client is not null and not private.offer_locked(), 'Only client accounts can request services');
  perform private.require(private.has_permission('client.dashboard.view'), 'Your account is not allowed to request services');
  perform private.require(p_service_ids is not null and cardinality(p_service_ids) between 1 and 20, 'Pick between 1 and 20 services');
  perform private.require(length(btrim(coalesce(p_brief, ''))) between 5 and 4000, 'Describe what you need (at least a few words)');
  perform private.require(p_preferred_date is null or p_preferred_date >= private.today_ist(), 'Pick a preferred date from today on');
  perform private.require((select count(*) from public.service_requests where client_id = v_client
    and created_at > now() - interval '1 day') < 20, 'Too many requests today. Please try again tomorrow.');
  select count(*) into v_n from public.services s
    where s.id = any(p_service_ids) and s.visible and s.requestable and s.archived_at is null;
  perform private.require(v_n = (select count(distinct x) from unnest(p_service_ids) x), 'One of the selected services is no longer available');
  insert into public.service_requests (client_id, requested_by, brief, timeline, preferred_date, notes)
  values (v_client, auth.uid(), btrim(p_brief), private.clean(p_timeline, 200), p_preferred_date, private.clean(p_notes, 2000))
  returning id, request_no into v_id, v_no;
  insert into public.service_request_items (request_id, service_id, service_name, category_name, subcategory_name)
  select v_id, s.id, s.name, c.name, sc.name
  from public.services s join public.service_subcategories sc on sc.id = s.subcategory_id
  join public.service_categories c on c.id = sc.category_id
  where s.id = any(p_service_ids);
  perform private.service_log(v_id, 'status', null, 'new', 'Request submitted', false);
  select company_name into v_name from public.clients where id = v_client;
  perform private.notify_service_managers('New service request ' || v_no,
    coalesce(v_name, 'A client') || ' asked for ' || v_n || ' service' || case when v_n = 1 then '' else 's' end || '.', 'svc-new:' || v_id);
  perform private.audit('service_request', v_id::text, 'create', jsonb_build_object('services', v_n), null, v_client, null, '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.client_service_request_cancel(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.service_requests;
begin
  select * into r from public.service_requests where id = p_request for update;
  perform private.require(found and r.client_id = private.current_client_id() and not private.offer_locked(), 'Request not found');
  perform private.require(r.status in ('new','under_review','quote_draft','quote_sent','revision_requested','approved'),
    'This request can no longer be cancelled. Contact your account manager.');
  update public.service_requests set close_reason = private.clean(p_reason, 400) where id = r.id;
  update public.service_quotes set status = 'superseded', updated_at = now() where request_id = r.id and status in ('sent','revision_requested');
  perform private.service_set_status(r.id, 'cancelled', coalesce(private.clean(p_reason, 400), 'Cancelled by client'));
  perform private.notify_service_managers('Service request ' || r.request_no || ' cancelled', 'The client cancelled this request.', 'svc-cancel:' || r.id);
end $$;

-- ---------------------------------------------------------------- staff: status / assign / notes
create or replace function public.staff_service_request_update(p_request uuid, p_action text, p_value text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; v_emp uuid; v_note text := private.clean(p_note, 2000);
begin
  perform private.require(private.has_permission('service.manage') and not private.offer_locked(), 'You are not allowed to manage service requests');
  select * into r from public.service_requests where id = p_request for update;
  perform private.require(found, 'Request not found');
  case p_action
    when 'review' then
      perform private.require(r.status = 'new', 'Only new requests can be moved to review');
      perform private.service_set_status(r.id, 'under_review', v_note);
    when 'assign' then
      v_emp := nullif(p_value, '')::uuid;
      perform private.require(v_emp is null or exists (select 1 from public.employees e where e.id = v_emp and e.status = 'active'),
        'Pick an active employee');
      update public.service_requests set assigned_to = v_emp, updated_at = now() where id = r.id;
      perform private.service_log(r.id, 'system', null, null,
        coalesce('Assigned to ' || (select name from public.employees where id = v_emp), 'Unassigned'), true);
      if v_emp is not null then
        perform private.notify((select profile_id from public.employees where id = v_emp), 'service', 'Service request ' || r.request_no,
          'You were assigned to this request.', '/admin-services', 'svc-assign:' || r.id || ':' || v_emp, '{}'::jsonb);
      end if;
    when 'note' then
      perform private.require(v_note is not null, 'Write a note');
      perform private.service_log(r.id, 'note', null, null, v_note, coalesce(p_value, 'internal') <> 'client');
      if coalesce(p_value, 'internal') = 'client' then
        perform private.notify_client(r.client_id, 'service', 'Update on ' || r.request_no, left(v_note, 200), '/client/services', 'svc-note:' || r.id || ':' || md5(v_note));
      end if;
    when 'reject' then
      perform private.require(r.status in ('new','under_review','quote_draft','revision_requested','quote_sent','approved'), 'This request cannot be declined now');
      perform private.require(v_note is not null, 'Give the client a reason');
      update public.service_requests set close_reason = left(v_note, 400) where id = r.id;
      update public.service_quotes set status = 'superseded', updated_at = now() where request_id = r.id and status in ('sent','revision_requested');
      perform private.service_set_status(r.id, 'rejected', v_note);
      perform private.notify_client(r.client_id, 'service', r.request_no || ' was declined', left(v_note, 200), '/client/services', 'svc-reject:' || r.id);
    when 'complete' then
      perform private.require(r.status = 'in_progress', 'Only work in progress can be completed');
      perform private.service_set_status(r.id, 'completed', v_note);
      perform private.notify_client(r.client_id, 'service', r.request_no || ' completed', 'All work on this request is done.', '/client/services', 'svc-done:' || r.id);
    else
      perform private.require(false, 'Unknown action');
  end case;
end $$;

-- ---------------------------------------------------------------- staff: quote draft / send
create or replace function public.staff_service_quote_save(p_request uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; q public.service_quotes; e jsonb; v_n int := 0; v_sum numeric := 0; v_name text; v_pct numeric;
begin
  perform private.require(private.has_permission('service.manage') and not private.offer_locked(), 'You are not allowed to prepare quotations');
  select * into r from public.service_requests where id = p_request for update;
  perform private.require(found, 'Request not found');
  perform private.require(r.status in ('new','under_review','quote_draft','quote_sent','revision_requested'), 'This request is past the quotation stage');
  perform private.require(jsonb_typeof(p->'items') = 'array' and jsonb_array_length(p->'items') between 1 and 50, 'Add between 1 and 50 lines');
  perform private.require(jsonb_typeof(p->'payment_terms') = 'array' and jsonb_array_length(p->'payment_terms') between 1 and 6, 'Add between 1 and 6 payment terms');
  for e in select value from jsonb_array_elements(p->'payment_terms') loop
    v_pct := (e->>'percentage')::numeric;
    v_name := nullif(btrim(coalesce(e->>'name', '')), '');
    perform private.require(v_pct is not null and v_pct > 0 and v_pct <= 100, 'Each payment term needs a percentage above 0');
    perform private.require(v_name is not null and length(v_name) <= 80, 'Each payment term needs a short name');
    v_sum := v_sum + v_pct;
  end loop;
  perform private.require(abs(v_sum - 100) < 0.01, 'Payment terms must add up to 100% (now ' || trim_scale(v_sum) || '%)');
  perform private.require(nullif(p->>'valid_until', '') is null or (p->>'valid_until')::date >= private.today_ist(), 'Valid-until must be from today on');

  select * into q from public.service_quotes where request_id = r.id and status = 'draft' for update;
  if not found then
    insert into public.service_quotes (request_id, version_no, created_by)
    values (r.id, coalesce((select max(version_no) from public.service_quotes where request_id = r.id), 0) + 1, auth.uid())
    returning * into q;
  end if;
  update public.service_quotes set
    scope = private.clean(p->>'scope', 6000), timeline = private.clean(p->>'timeline', 600), terms = private.clean(p->>'terms', 6000),
    valid_until = nullif(p->>'valid_until', '')::date,
    payment_terms = (select jsonb_agg(jsonb_build_object('name', btrim(x->>'name'), 'percentage', (x->>'percentage')::numeric))
                     from jsonb_array_elements(p->'payment_terms') x),
    first_term_due_days = coalesce(nullif(p->>'first_term_due_days', '')::int, 3), updated_at = now()
  where id = q.id;
  delete from public.service_quote_items where quote_id = q.id;
  for e in select value from jsonb_array_elements(p->'items') loop
    v_n := v_n + 1;
    insert into public.service_quote_items (quote_id, line_no, service_id, description, details, sac, qty, unit_price, discount,
      taxable, gst_rate, tax, total, due_in_days)
    values (q.id, v_n, (select s.id from public.services s where s.id = nullif(e->>'service_id', '')::uuid),
      btrim(coalesce(e->>'description', '')), private.clean(e->>'details', 1000), btrim(coalesce(e->>'sac', '')),
      coalesce((e->>'qty')::numeric, 1), (e->>'unit_price')::numeric, coalesce(nullif(e->>'discount', '')::numeric, 0),
      0, coalesce(nullif(e->>'gst_rate', '')::numeric, 18), 0, 0, nullif(e->>'due_in_days', '')::int);
  end loop;
  perform private.require(not exists (select 1 from public.service_quote_items where quote_id = q.id and qty * unit_price - discount < 0),
    'A discount is larger than its line amount');
  perform private.service_quote_recalc(q.id);
  if r.status in ('new','under_review') then perform private.service_set_status(r.id, 'quote_draft', 'Quotation being prepared'); end if;
  return q.id;
end $$;

create or replace function public.staff_service_quote_send(p_quote uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.service_quotes; r public.service_requests; cp public.company_profile; bp public.client_billing_profiles; v_rates int;
begin
  perform private.require(private.has_permission('service.manage') and not private.offer_locked(), 'You are not allowed to send quotations');
  select * into q from public.service_quotes where id = p_quote for update;
  perform private.require(found and q.status = 'draft', 'Only a draft quotation can be sent');
  select * into r from public.service_requests where id = q.request_id for update;
  perform private.require(r.status in ('quote_draft','quote_sent','revision_requested','under_review','new'), 'This request is past the quotation stage');
  select * into cp from public.company_profile where id;
  perform private.require(found and cp.legal_name is not null and cp.state_code is not null, 'Fill in your company details in Finance → Settings first');
  select * into bp from public.client_billing_profiles where client_id = r.client_id;
  perform private.require(found and bp.legal_name is not null and bp.state_code is not null, 'Add this client''s billing details in Finance → Clients first');
  perform private.require(q.valid_until is not null and q.valid_until >= private.today_ist(), 'Set a valid-until date from today on');
  perform private.require(exists (select 1 from public.service_quote_items where quote_id = q.id), 'Add at least one line');
  select count(distinct gst_rate) into v_rates from public.service_quote_items where quote_id = q.id;
  perform private.require(v_rates = 1, 'Use one GST rate for all lines of a quotation (split different rates into separate requests)');
  perform private.service_quote_recalc(q.id);
  update public.service_quotes set
    seller = jsonb_build_object('legal_name', cp.legal_name, 'trade_name', cp.trade_name, 'gstin', cp.gstin, 'pan', cp.pan,
      'state_code', cp.state_code, 'address', cp.address, 'city', cp.city, 'pincode', cp.pincode, 'email', cp.email, 'phone', cp.phone),
    buyer = jsonb_build_object('legal_name', bp.legal_name, 'gstin', bp.gstin, 'state_code', bp.state_code, 'address', bp.address,
      'city', bp.city, 'pincode', bp.pincode),
    updated_at = now()
  where id = q.id;
  update public.service_quotes set status = 'sent', sent_at = now(), sent_by = auth.uid(), updated_at = now() where id = q.id;
  update public.service_quotes set status = 'superseded', updated_at = now()
    where request_id = r.id and id <> q.id and status in ('sent','revision_requested');
  perform private.service_log(r.id, 'quote', null, null, 'Quotation v' || q.version_no || ' sent', false);
  perform private.service_set_status(r.id, 'quote_sent', null);
  perform private.notify_client(r.client_id, 'service', 'Quotation ready for ' || r.request_no,
    'Review and accept quotation v' || q.version_no || ' before ' || to_char(q.valid_until, 'DD Mon YYYY') || '.', '/client/services', 'svc-quote:' || q.id);
  perform private.audit('service_quote', q.id::text, 'send', jsonb_build_object('version', q.version_no), null, r.client_id, null, '{}'::jsonb);
end $$;

create or replace function public.staff_service_quote_discard(p_quote uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.service_quotes;
begin
  perform private.require(private.has_permission('service.manage') and not private.offer_locked(), 'Not allowed');
  select * into q from public.service_quotes where id = p_quote for update;
  perform private.require(found and q.status = 'draft', 'Only a draft can be discarded');
  delete from public.service_quote_items where quote_id = q.id;
  delete from public.service_quotes where id = q.id;
end $$;

-- ---------------------------------------------------------------- client: respond to a quote
create or replace function public.client_service_quote_respond(p_quote uuid, p_action text, p_note text) returns text
language plpgsql security definer set search_path = '' as $$
declare q public.service_quotes; r public.service_requests; v_note text := private.clean(p_note, 2000);
begin
  select * into q from public.service_quotes where id = p_quote for update;
  perform private.require(found, 'Quotation not found');
  select * into r from public.service_requests where id = q.request_id for update;
  perform private.require(r.client_id = private.current_client_id() and not private.offer_locked(), 'Quotation not found');
  perform private.require(q.status = 'sent' and r.status = 'quote_sent', 'This quotation is not awaiting your answer');
  case p_action
    when 'accept' then
      perform private.require(private.has_permission('client.contract.accept'), 'Your account is not allowed to accept quotations. Ask your organisation admin.');
      perform private.require(q.valid_until >= private.today_ist(), 'This quotation has expired. Ask for a revised one.');
      update public.service_quotes set status = 'accepted', responded_at = now(), responded_by = auth.uid(), client_note = v_note where id = q.id;
      update public.service_requests set accepted_quote_id = q.id where id = r.id;
      perform private.service_set_status(r.id, 'approved', 'Quotation v' || q.version_no || ' accepted' || coalesce(': ' || v_note, ''));
      perform private.notify_service_managers(r.request_no || ' accepted', 'The client accepted quotation v' || q.version_no || '. Start the work to request the first payment.', 'svc-accept:' || q.id);
    when 'revise' then
      perform private.require(v_note is not null, 'Tell us what to change');
      update public.service_quotes set status = 'revision_requested', responded_at = now(), responded_by = auth.uid(), client_note = v_note where id = q.id;
      perform private.service_set_status(r.id, 'revision_requested', v_note);
      perform private.notify_service_managers(r.request_no || ': changes requested', left(v_note, 200), 'svc-revise:' || q.id);
    when 'reject' then
      update public.service_quotes set status = 'rejected', responded_at = now(), responded_by = auth.uid(), client_note = v_note where id = q.id;
      perform private.service_set_status(r.id, 'rejected', coalesce(v_note, 'Quotation declined by client'));
      perform private.notify_service_managers(r.request_no || ' declined', coalesce(left(v_note, 200), 'The client declined the quotation.'), 'svc-decline:' || q.id);
    else
      perform private.require(false, 'Unknown action');
  end case;
  perform private.audit('service_quote', q.id::text, p_action, jsonb_build_object('version', q.version_no), v_note, r.client_id, null, '{}'::jsonb);
  return p_action;
end $$;

-- ---------------------------------------------------------------- start work: project + contract + payment terms
create or replace function private.service_create_deliverables(p_request uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; n int;
begin
  select * into r from public.service_requests where id = p_request for update;
  if exists (select 1 from public.deliverables where contract_id = r.contract_id and deleted_at is null) then return 0; end if;
  insert into public.deliverables (project_id, contract_id, name, description, quantity, due_date, status, category, sort_order, created_by)
  select r.project_id, r.contract_id, left(i.description, 200), i.details, greatest(1, ceil(i.qty))::int,
    case when i.due_in_days is not null then private.today_ist() + i.due_in_days end, 'Pending', 'Service', i.line_no, auth.uid()
  from public.service_quote_items i where i.quote_id = r.accepted_quote_id order by i.line_no;
  get diagnostics n = row_count;
  update public.files set project_id = r.project_id where parent_type = 'service_request' and parent_id = r.id and project_id is null;
  return n;
end $$;

create or replace function public.staff_service_start(p_request uuid, p_project_id uuid, p_new_project_name text,
  p_payment_exception boolean, p_exception_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; q public.service_quotes; v_project uuid := p_project_id; v_contract uuid; e jsonb;
  v_n int := 0; v_count int; v_amt numeric; v_tax numeric; v_amt_left numeric; v_tax_left numeric; v_inst uuid; v_first uuid;
  v_profile uuid; v_deliv int := 0; v_reason text := private.clean(p_exception_reason, 400);
begin
  perform private.require(private.has_permission('service.manage') and private.has_permission('contract.create') and not private.offer_locked(),
    'You are not allowed to start service work');
  select * into r from public.service_requests where id = p_request for update;
  perform private.require(found and r.status = 'approved' and r.accepted_quote_id is not null, 'Only an accepted request can be started');
  select * into q from public.service_quotes where id = r.accepted_quote_id and status = 'accepted';
  perform private.require(found, 'Accepted quotation not found');
  if coalesce(p_payment_exception, false) then
    perform private.require(private.is_admin(), 'Only an admin can start work before the first payment');
    perform private.require(v_reason is not null, 'Give a reason for starting before payment');
  end if;

  if v_project is not null then
    perform private.require(exists (select 1 from public.projects p where p.id = v_project and p.client_id = r.client_id and p.deleted_at is null),
      'Pick a project that belongs to this client');
  else
    perform private.require(length(btrim(coalesce(p_new_project_name, ''))) between 2 and 120, 'Name the new project');
    select profile_id into v_profile from public.clients where id = r.client_id;
    perform private.require(v_profile is not null, 'This client has no portal account yet');
    insert into public.projects (name, description, status, created_by, client_id, start_date)
    values (btrim(p_new_project_name), left(q.scope, 2000), 'active', auth.uid(), r.client_id, private.today_ist())
    returning id into v_project;
    insert into public.project_clients (project_id, client_id) values (v_project, v_profile) on conflict do nothing;
  end if;

  insert into public.contracts (project_id, title, ref, url, status, accepted_at, contract_value, currency, tax_note,
    start_date, current_version_no, first_term_due_days, created_by, sent_at)
  values (v_project, 'Services · ' || r.request_no || ' (quotation v' || q.version_no || ')', r.request_no || '-Q' || q.version_no, '',
    'Accepted', coalesce(q.responded_at, now()), q.taxable_total, 'INR', 'GST ' || trim_scale(q.tax_total) || ' extra as per quotation',
    private.today_ist(), 1, q.first_term_due_days, auth.uid(), q.sent_at)
  returning id into v_contract;

  v_count := jsonb_array_length(q.payment_terms);
  v_amt_left := q.taxable_total; v_tax_left := q.tax_total;
  for e in select value from jsonb_array_elements(q.payment_terms) loop
    v_n := v_n + 1;
    if v_n = v_count then v_amt := v_amt_left; v_tax := v_tax_left;
    else
      v_amt := round(q.taxable_total * (e->>'percentage')::numeric / 100, 2);
      v_tax := round(q.tax_total * (e->>'percentage')::numeric / 100, 2);
    end if;
    v_amt_left := v_amt_left - v_amt; v_tax_left := v_tax_left - v_tax;
    insert into public.payment_installments (project_id, contract_id, term_no, name, basis_type, basis, amount, tax_amount, status)
    values (v_project, v_contract, v_n, e->>'name', 'fixed', trim_scale((e->>'percentage')::numeric) || '% of quotation ' || r.request_no,
      v_amt, v_tax, 'Upcoming')
    returning id into v_inst;
    if v_n = 1 then v_first := v_inst; end if;
  end loop;

  update public.service_requests set project_id = v_project, contract_id = v_contract,
    payment_exception = coalesce(p_payment_exception, false), exception_reason = v_reason,
    exception_by = case when coalesce(p_payment_exception, false) then auth.uid() end, updated_at = now()
  where id = r.id;

  update public.payment_installments set requested_at = now(), requested_by = auth.uid(),
    due_date = private.today_ist() + q.first_term_due_days where id = v_first;
  perform private.notify_client(r.client_id, 'billing', 'Payment requested',
    'First payment for ' || r.request_no || ' is due by ' || to_char(private.today_ist() + q.first_term_due_days, 'DD Mon YYYY') || '.',
    '/client/payments', 'pay-request:' || v_first || ':' || (private.today_ist() + q.first_term_due_days));

  if coalesce(p_payment_exception, false) then
    v_deliv := private.service_create_deliverables(r.id);
    perform private.service_set_status(r.id, 'in_progress', 'Started before payment: ' || v_reason);
    perform private.audit('service_request', r.id::text, 'payment_exception', jsonb_build_object('contract', v_contract), v_reason, r.client_id, v_project, '{}'::jsonb);
  else
    perform private.service_set_status(r.id, 'payment_pending', 'Waiting for the first payment');
  end if;
  perform private.audit('service_request', r.id::text, 'start', jsonb_build_object('project', v_project, 'contract', v_contract), null, r.client_id, v_project, '{}'::jsonb);
  return jsonb_build_object('project_id', v_project, 'contract_id', v_contract, 'deliverables', v_deliv);
end $$;

-- When the first term of a service contract is paid, the work starts.
create or replace function private.service_first_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; n int;
begin
  if new.term_no = 1 and new.status = 'Paid' and old.status is distinct from 'Paid' and new.contract_id is not null then
    select * into r from public.service_requests where contract_id = new.contract_id and status = 'payment_pending';
    if found then
      n := private.service_create_deliverables(r.id);
      perform private.service_set_status(r.id, 'in_progress', 'First payment received');
      perform private.service_log(r.id, 'payment', null, null, new.name || ' paid', false);
      perform private.notify_client(r.client_id, 'service', 'Work started on ' || r.request_no, 'Payment received. Your work has started.', '/client/services', 'svc-start:' || r.id);
      perform private.notify_service_managers('Payment received for ' || r.request_no, n || ' deliverable(s) are now active.', 'svc-paid:' || r.id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists service_first_payment on public.payment_installments;
create trigger service_first_payment after update of status on public.payment_installments
  for each row execute function private.service_first_payment();

-- ---------------------------------------------------------------- grants
revoke all on function public.client_service_request_create(uuid[], text, text, date, text) from public, anon;
revoke all on function public.client_service_request_cancel(uuid, text) from public, anon;
revoke all on function public.staff_service_request_update(uuid, text, text, text) from public, anon;
revoke all on function public.staff_service_quote_save(uuid, jsonb) from public, anon;
revoke all on function public.staff_service_quote_send(uuid) from public, anon;
revoke all on function public.staff_service_quote_discard(uuid) from public, anon;
revoke all on function public.client_service_quote_respond(uuid, text, text) from public, anon;
revoke all on function public.staff_service_start(uuid, uuid, text, boolean, text) from public, anon;
grant execute on function public.client_service_request_create(uuid[], text, text, date, text) to authenticated;
grant execute on function public.client_service_request_cancel(uuid, text) to authenticated;
grant execute on function public.staff_service_request_update(uuid, text, text, text) to authenticated;
grant execute on function public.staff_service_quote_save(uuid, jsonb) to authenticated;
grant execute on function public.staff_service_quote_send(uuid) to authenticated;
grant execute on function public.staff_service_quote_discard(uuid) to authenticated;
grant execute on function public.client_service_quote_respond(uuid, text, text) to authenticated;
grant execute on function public.staff_service_start(uuid, uuid, text, boolean, text) to authenticated;
revoke all on function private.service_quote_recalc(uuid), private.service_create_deliverables(uuid),
  private.service_log(uuid, text, text, text, text, boolean), private.service_set_status(uuid, text, text),
  private.notify_service_managers(text, text, text) from public, anon, authenticated;
