-- Performance Marketing (simple version): per-client setup and team, social posts calendar, ad campaigns with
-- daily results, uploaded reports, and the ad-money ledger (client pays us the ad budget; spend comes from results).
-- All writes go through permission-checked functions; tables are read-only to the browser.

insert into public.permissions (code, module, description) values
  ('marketing.manage', 'marketing', 'Set up marketing clients and team, record ad money, see all marketing work')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('super_admin', 'marketing.manage'), ('admin', 'marketing.manage')
on conflict do nothing;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'attendance','leave','wfh','task','holiday','payroll','system','contract','deliverable','dependency',
  'modification','billing','client','activity','lead','service','marketing']));

alter table public.files drop constraint if exists files_parent_type_check;
alter table public.files add constraint files_parent_type_check check (parent_type = any (array[
  'contract','deliverable','dependency','task','invoice','payment','employee','client','project','leave','service_request',
  'mk_post','mk_report']));

-- ---------------------------------------------------------------- setup
create table if not exists public.mk_clients (
  client_id uuid primary key references public.clients(id) on delete restrict,
  enabled boolean not null default true,
  client_access boolean not null default false,
  post_approval boolean not null default false,
  low_balance numeric(14,2) not null default 0 check (low_balance >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mk_team (
  client_id uuid not null references public.clients(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (client_id, employee_id)
);
create index if not exists mk_team_emp_idx on public.mk_team(employee_id);

-- ---------------------------------------------------------------- social posts
create table if not exists public.mk_posts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  platforms text[] not null check (cardinality(platforms) between 1 and 6
    and platforms <@ array['instagram','facebook','linkedin','youtube','x','google','whatsapp','other']),
  post_type text not null default 'post' check (post_type in ('post','reel','story','carousel','video','other')),
  scheduled_for timestamptz not null,
  title text check (title is null or length(title) <= 160),
  caption text check (caption is null or length(caption) <= 5000),
  status text not null default 'draft' check (status in ('draft','awaiting_approval','changes_requested','approved','posted','cancelled')),
  client_note text check (client_note is null or length(client_note) <= 2000),
  live_url text check (live_url is null or (length(live_url) <= 600 and live_url ~* '^https://')),
  reach int check (reach is null or reach >= 0), likes int check (likes is null or likes >= 0),
  comments int check (comments is null or comments >= 0), shares int check (shares is null or shares >= 0),
  posted_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mk_posts_client_idx on public.mk_posts(client_id, scheduled_for desc);

-- ---------------------------------------------------------------- ads
create table if not exists public.mk_campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 160),
  platform text not null check (platform in ('meta','google','linkedin','youtube','other')),
  objective text not null default 'leads' check (objective in ('leads','messages','sales','traffic','awareness','engagement','calls')),
  start_date date not null,
  end_date date check (end_date is null or end_date >= start_date),
  budget numeric(14,2) check (budget is null or budget >= 0),
  status text not null default 'running' check (status in ('planned','running','paused','completed')),
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mk_campaigns_client_idx on public.mk_campaigns(client_id, start_date desc);

create table if not exists public.mk_results (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.mk_campaigns(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  day date not null,
  spend numeric(14,2) not null default 0 check (spend >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  reach bigint not null default 0 check (reach >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  leads int not null default 0 check (leads >= 0),
  messages int not null default 0 check (messages >= 0),
  sales int not null default 0 check (sales >= 0),
  sales_value numeric(14,2) not null default 0 check (sales_value >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (campaign_id, day)
);
create index if not exists mk_results_client_day_idx on public.mk_results(client_id, day);

-- ---------------------------------------------------------------- reports
create table if not exists public.mk_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 160),
  period_start date, period_end date check (period_end is null or period_start is null or period_end >= period_start),
  visible_to_client boolean not null default true,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists mk_reports_client_idx on public.mk_reports(client_id, created_at desc);

-- ---------------------------------------------------------------- ad money (append-only ledger; mistakes are voided, never deleted)
create table if not exists public.mk_money (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  kind text not null check (kind in ('request','receipt','refund','adjustment')),
  amount numeric(14,2) not null check (kind = 'adjustment' or amount > 0),
  entry_date date not null,
  due_date date,
  request_id uuid references public.mk_money(id) on delete restrict,
  method text check (method is null or method in ('bank_transfer','upi','cash','cheque','card','other')),
  reference text check (reference is null or length(reference) <= 120),
  note text check (note is null or length(note) <= 600),
  voided_at timestamptz, voided_by uuid references public.profiles(id) on delete set null,
  void_reason text check (void_reason is null or length(void_reason) <= 400),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (amount <> 0)
);
create index if not exists mk_money_client_idx on public.mk_money(client_id, entry_date desc);
create unique index if not exists mk_money_ref_uniq on public.mk_money(client_id, kind, lower(reference))
  where reference is not null and voided_at is null and kind in ('receipt','refund');

-- ---------------------------------------------------------------- access helpers
create or replace function private.mk_can_work(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not private.offer_locked() and private.current_client_id() is null and (
    private.has_permission('marketing.manage')
    or exists (select 1 from public.mk_team t join public.mk_clients m on m.client_id = t.client_id and m.enabled
               where t.client_id = p_client and t.employee_id = private.current_employee_id()));
$$;
create or replace function private.mk_client_sees(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_client = private.current_client_id() and private.has_permission('client.dashboard.view')
    and exists (select 1 from public.mk_clients m where m.client_id = p_client and m.enabled and m.client_access);
$$;
grant execute on function private.mk_can_work(uuid), private.mk_client_sees(uuid) to authenticated;

alter table public.mk_clients enable row level security;
alter table public.mk_team enable row level security;
alter table public.mk_posts enable row level security;
alter table public.mk_campaigns enable row level security;
alter table public.mk_results enable row level security;
alter table public.mk_reports enable row level security;
alter table public.mk_money enable row level security;
revoke all on public.mk_clients, public.mk_team, public.mk_posts, public.mk_campaigns, public.mk_results, public.mk_reports, public.mk_money from anon;
revoke insert, update, delete on public.mk_clients, public.mk_team, public.mk_posts, public.mk_campaigns, public.mk_results, public.mk_reports, public.mk_money from authenticated;
grant select on public.mk_clients, public.mk_team, public.mk_posts, public.mk_campaigns, public.mk_results, public.mk_reports, public.mk_money to authenticated;

create policy mk_clients_select on public.mk_clients for select to authenticated
  using (private.mk_can_work(client_id) or private.mk_client_sees(client_id));
create policy mk_team_select on public.mk_team for select to authenticated
  using (private.mk_can_work(client_id));
create policy mk_posts_select on public.mk_posts for select to authenticated
  using (private.mk_can_work(client_id) or (private.mk_client_sees(client_id) and status not in ('draft','cancelled')));
create policy mk_campaigns_select on public.mk_campaigns for select to authenticated
  using (private.mk_can_work(client_id) or private.mk_client_sees(client_id));
create policy mk_results_select on public.mk_results for select to authenticated
  using (private.mk_can_work(client_id) or private.mk_client_sees(client_id));
create policy mk_reports_select on public.mk_reports for select to authenticated
  using (private.mk_can_work(client_id) or (private.mk_client_sees(client_id) and visible_to_client and archived_at is null));
create policy mk_money_select on public.mk_money for select to authenticated
  using (private.mk_can_work(client_id) or (private.mk_client_sees(client_id) and voided_at is null));
create policy offer_lock on public.mk_clients as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.mk_team as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.mk_posts as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.mk_campaigns as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.mk_results as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.mk_reports as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.mk_money as restrictive for all to authenticated using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
