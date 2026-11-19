-- Leads & Sales (Phase 1): Revenue department (calling team) and Field sales.
-- Roles: sales_caller (calling team), sales_field (field sales), sales_manager (sees and assigns all leads).
-- Admins have every permission. Clients never see leads. Offer-locked employees see nothing (offer_lock policy).

insert into public.permissions (code, module, description) values
  ('lead.call',   'leads', 'Work own leads: call, follow up, mark good or lost'),
  ('lead.visit',  'leads', 'Field sales: log company visits with location'),
  ('lead.manage', 'leads', 'See all leads, assign, import, take good leads, convert to client')
on conflict (code) do nothing;

insert into public.roles (code, name, scope, description, is_system)
select v.code, v.name, 'staff', v.description, false from (values
  ('sales_caller',  'Revenue (calling team)', 'Calls leads and passes good ones to admin'),
  ('sales_field',   'Field sales',            'Visits companies and enters good leads'),
  ('sales_manager', 'Sales manager',          'Sees all leads, assigns and imports')
) v(code, name, description)
where not exists (select 1 from public.roles r where r.code = v.code);

insert into public.role_permissions (role_code, permission_code) values
  ('sales_caller', 'lead.call'),
  ('sales_field', 'lead.call'), ('sales_field', 'lead.visit'),
  ('sales_manager', 'lead.call'), ('sales_manager', 'lead.visit'), ('sales_manager', 'lead.manage'),
  ('super_admin', 'lead.call'), ('super_admin', 'lead.visit'), ('super_admin', 'lead.manage')
on conflict do nothing;

create sequence if not exists public.lead_no_seq;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_no text not null unique default ('L-' || lpad(nextval('public.lead_no_seq')::text, 4, '0')),
  contact_name text not null check (length(btrim(contact_name)) between 1 and 120),
  company text check (company is null or length(company) <= 160),
  designation text check (designation is null or length(designation) <= 80),
  phone text check (phone is null or length(phone) <= 20),
  phone_norm text,
  email text check (email is null or length(email) <= 160),
  email_norm text,
  city text check (city is null or length(city) <= 80),
  address text check (address is null or length(address) <= 400),
  industry text check (industry is null or length(industry) <= 80),
  source text not null default 'other' check (source in
    ('meta_ads','google_ads','instagram','website','whatsapp','referral','walk_in','field_visit','phone_call','event','other')),
  campaign text check (campaign is null or length(campaign) <= 120),
  service_interest text check (service_interest is null or length(service_interest) <= 200),
  channel text not null default 'calling' check (channel in ('calling','field')),
  stage text not null default 'new' check (stage in ('new','calling','good','with_admin','won','lost')),
  -- qualification (required to mark a lead good)
  need text check (need is null or length(need) <= 1000),
  budget text check (budget is null or length(budget) <= 120),
  timeline text check (timeline is null or length(timeline) <= 120),
  decision_maker text check (decision_maker is null or length(decision_maker) <= 120),
  lost_reason text check (lost_reason is null or length(lost_reason) <= 400),
  notes text check (notes is null or length(notes) <= 2000),
  owner_id uuid references public.employees(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  handled_by uuid references public.profiles(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  next_follow_up_at timestamptz,
  first_contacted_at timestamptz,
  last_contacted_at timestamptz,
  call_count int not null default 0,
  visit_count int not null default 0,
  qualified_at timestamptz,
  qualified_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_owner_idx on public.leads(owner_id);
create index if not exists leads_stage_idx on public.leads(stage);
create index if not exists leads_phone_idx on public.leads(phone_norm);
create index if not exists leads_email_idx on public.leads(email_norm);
create index if not exists leads_followup_idx on public.leads(next_follow_up_at);

create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null check (kind in ('created','call','visit','note','stage','assign','import','convert')),
  outcome text check (outcome is null or outcome in
    ('connected','no_answer','busy','call_back','not_interested','interested','wrong_number',
     'met','not_available','follow_up','good','lost')),
  note text check (note is null or length(note) <= 2000),
  by_profile uuid references public.profiles(id) on delete set null,
  by_employee uuid references public.employees(id) on delete set null,
  started_at timestamptz,
  ended_at timestamptz,
  start_lat double precision, start_lng double precision, start_accuracy double precision,
  end_lat double precision, end_lng double precision, end_accuracy double precision,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists lead_activities_lead_idx on public.lead_activities(lead_id, created_at desc);
create index if not exists lead_activities_open_visit_idx on public.lead_activities(by_employee) where kind = 'visit' and ended_at is null;

alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
revoke all on public.leads, public.lead_activities from anon;
revoke insert, update, delete on public.leads, public.lead_activities from authenticated;
grant select on public.leads, public.lead_activities to authenticated;

create or replace function private.can_see_lead(p_owner uuid, p_created_by uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not private.offer_locked() and (
    private.has_permission('lead.manage')
    or (private.has_permission('lead.call') and (
          p_owner = private.current_employee_id()
          or p_created_by = (select auth.uid())
          or (p_owner is not null and private.is_manager_of(p_owner))))
  );
$$;
revoke all on function private.can_see_lead(uuid, uuid) from public;
grant execute on function private.can_see_lead(uuid, uuid) to authenticated;

create policy leads_select on public.leads for select to authenticated
  using (private.can_see_lead(owner_id, created_by));
create policy offer_lock on public.leads as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));

create policy lead_activities_select on public.lead_activities for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id and private.can_see_lead(l.owner_id, l.created_by)));
create policy offer_lock on public.lead_activities as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
