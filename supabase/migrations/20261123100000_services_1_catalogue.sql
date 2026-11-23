-- Services module, part 1: the service catalogue (admin-managed, shown to clients in their portal).
-- Categories → subcategories → services. Archiving hides a service but keeps past requests intact.

insert into public.permissions (code, module, description) values
  ('service.manage', 'services', 'Manage the service catalogue, service requests and quotations')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('super_admin', 'service.manage'), ('admin', 'service.manage')
on conflict do nothing;

create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 600),
  icon text check (icon is null or icon ~ '^[a-z0-9-]{1,40}$'),
  sort_order int not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.service_categories(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  sort_order int not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category_id, name)
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  subcategory_id uuid not null references public.service_subcategories(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 160),
  description text check (description is null or length(description) <= 2000),
  image_url text check (image_url is null or image_url ~* '^https://[^[:space:]]+$'),
  pricing_type text not null default 'quote' check (pricing_type in ('quote','fixed')),
  price_from numeric(14,2) check (price_from is null or price_from >= 0),
  price_to numeric(14,2) check (price_to is null or price_to >= 0),
  fixed_price numeric(14,2) check (fixed_price is null or fixed_price >= 0),
  gst_rate numeric(5,2) not null default 18 check (gst_rate in (0, 5, 12, 18, 28, 40)),
  sac text check (sac is null or sac ~ '^[0-9]{4,8}$'),
  unit text check (unit is null or length(unit) <= 40),
  featured boolean not null default false,
  visible boolean not null default true,
  requestable boolean not null default true,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subcategory_id, name),
  constraint services_price_range check (price_from is null or price_to is null or price_to >= price_from),
  constraint services_fixed_price check (pricing_type <> 'fixed' or fixed_price is not null)
);
create index if not exists services_subcategory_idx on public.services(subcategory_id, sort_order);

alter table public.service_categories enable row level security;
alter table public.service_subcategories enable row level security;
alter table public.services enable row level security;
revoke all on public.service_categories, public.service_subcategories, public.services from anon;
revoke insert, update, delete on public.service_categories, public.service_subcategories, public.services from authenticated;
grant select on public.service_categories, public.service_subcategories, public.services to authenticated;

-- Staff who manage services see everything; clients see what is visible; other staff see visible items too (to talk to clients).
create policy service_categories_select on public.service_categories for select to authenticated
  using (private.has_permission('service.manage') or (visible and not private.offer_locked()));
create policy service_subcategories_select on public.service_subcategories for select to authenticated
  using (private.has_permission('service.manage') or (visible and not private.offer_locked()));
create policy services_select on public.services for select to authenticated
  using (private.has_permission('service.manage') or (visible and archived_at is null and not private.offer_locked()));
create policy offer_lock on public.service_categories as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.service_subcategories as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));
create policy offer_lock on public.services as restrictive for all to authenticated
  using (not (select private.offer_locked())) with check (not (select private.offer_locked()));

-- ---------------------------------------------------------------- catalogue management (admin)
-- One function for categories, subcategories and services: p_kind = 'category' | 'subcategory' | 'service'.
-- p_id null → create. Archiving / hiding never deletes; past requests keep their own copy of names and prices.
create or replace function public.service_catalogue_save(p_kind text, p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_type text;
begin
  perform private.require(private.has_permission('service.manage'), 'Only admin can change the service catalogue.');
  perform private.require(p_kind in ('category','subcategory','service'), 'Unknown catalogue item.');
  if p_kind = 'category' then
    perform private.require(private.clean(p->>'name', 120) is not null, 'Enter a category name.');
    if p_id is null then
      insert into public.service_categories (name, description, icon, sort_order, visible)
      values (private.clean(p->>'name', 120), private.clean(p->>'description', 600), nullif(p->>'icon', ''),
        coalesce((p->>'sort_order')::int, (select coalesce(max(sort_order), 0) + 10 from public.service_categories)), coalesce((p->>'visible')::boolean, true))
      returning id into v_id;
    else
      update public.service_categories set
        name = case when p ? 'name' then private.clean(p->>'name', 120) else name end,
        description = case when p ? 'description' then private.clean(p->>'description', 600) else description end,
        icon = case when p ? 'icon' then nullif(p->>'icon', '') else icon end,
        sort_order = coalesce((p->>'sort_order')::int, sort_order),
        visible = coalesce((p->>'visible')::boolean, visible), updated_at = now()
      where id = p_id returning id into v_id;
    end if;
  elsif p_kind = 'subcategory' then
    perform private.require(private.clean(p->>'name', 120) is not null or p_id is not null, 'Enter a subcategory name.');
    if p_id is null then
      perform private.require(exists (select 1 from public.service_categories where id = (p->>'category_id')::uuid), 'Choose a category.');
      insert into public.service_subcategories (category_id, name, sort_order, visible)
      values ((p->>'category_id')::uuid, private.clean(p->>'name', 120),
        coalesce((p->>'sort_order')::int, (select coalesce(max(sort_order), 0) + 10 from public.service_subcategories where category_id = (p->>'category_id')::uuid)),
        coalesce((p->>'visible')::boolean, true))
      returning id into v_id;
    else
      update public.service_subcategories set
        name = case when p ? 'name' then private.clean(p->>'name', 120) else name end,
        category_id = coalesce((p->>'category_id')::uuid, category_id),
        sort_order = coalesce((p->>'sort_order')::int, sort_order),
        visible = coalesce((p->>'visible')::boolean, visible)
      where id = p_id returning id into v_id;
    end if;
  else
    v_type := coalesce(nullif(p->>'pricing_type', ''), 'quote');
    perform private.require(v_type in ('quote','fixed'), 'Choose fixed price or custom quote.');
    perform private.require(v_type <> 'fixed' or nullif(p->>'fixed_price', '') is not null, 'Enter the fixed price.');
    if p_id is null then
      perform private.require(private.clean(p->>'name', 160) is not null, 'Enter a service name.');
      perform private.require(exists (select 1 from public.service_subcategories where id = (p->>'subcategory_id')::uuid), 'Choose a subcategory.');
      insert into public.services (subcategory_id, name, description, image_url, pricing_type, price_from, price_to, fixed_price, gst_rate, sac, unit,
        featured, visible, requestable, sort_order)
      values ((p->>'subcategory_id')::uuid, private.clean(p->>'name', 160), private.clean(p->>'description', 2000), nullif(p->>'image_url', ''),
        v_type, nullif(p->>'price_from', '')::numeric, nullif(p->>'price_to', '')::numeric, nullif(p->>'fixed_price', '')::numeric,
        coalesce(nullif(p->>'gst_rate', '')::numeric, 18), nullif(p->>'sac', ''), private.clean(p->>'unit', 40),
        coalesce((p->>'featured')::boolean, false), coalesce((p->>'visible')::boolean, true), coalesce((p->>'requestable')::boolean, true),
        coalesce((p->>'sort_order')::int, (select coalesce(max(sort_order), 0) + 10 from public.services where subcategory_id = (p->>'subcategory_id')::uuid)))
      returning id into v_id;
    else
      update public.services set
        name = case when p ? 'name' then private.clean(p->>'name', 160) else name end,
        subcategory_id = coalesce((p->>'subcategory_id')::uuid, subcategory_id),
        description = case when p ? 'description' then private.clean(p->>'description', 2000) else description end,
        image_url = case when p ? 'image_url' then nullif(p->>'image_url', '') else image_url end,
        pricing_type = case when p ? 'pricing_type' then v_type else pricing_type end,
        price_from = case when p ? 'price_from' then nullif(p->>'price_from', '')::numeric else price_from end,
        price_to = case when p ? 'price_to' then nullif(p->>'price_to', '')::numeric else price_to end,
        fixed_price = case when p ? 'fixed_price' then nullif(p->>'fixed_price', '')::numeric else fixed_price end,
        gst_rate = coalesce(nullif(p->>'gst_rate', '')::numeric, gst_rate),
        sac = case when p ? 'sac' then nullif(p->>'sac', '') else sac end,
        unit = case when p ? 'unit' then private.clean(p->>'unit', 40) else unit end,
        featured = coalesce((p->>'featured')::boolean, featured),
        visible = coalesce((p->>'visible')::boolean, visible),
        requestable = coalesce((p->>'requestable')::boolean, requestable),
        sort_order = coalesce((p->>'sort_order')::int, sort_order),
        archived_at = case when p ? 'archived' then case when (p->>'archived')::boolean then coalesce(archived_at, now()) else null end else archived_at end,
        updated_at = now()
      where id = p_id returning id into v_id;
    end if;
  end if;
  perform private.require(v_id is not null, 'Item not found.');
  perform private.audit('service_catalogue', v_id::text, case when p_id is null then 'create' else 'update' end, jsonb_build_object('kind', p_kind) || p, null, null, null, '{}'::jsonb);
  return v_id;
end $$;
revoke all on function public.service_catalogue_save(text, uuid, jsonb) from public, anon;
grant execute on function public.service_catalogue_save(text, uuid, jsonb) to authenticated;
