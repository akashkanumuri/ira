-- Sales staff are set up by designation (no separate field):
--   Telecaller            → Revenue department     → calling workspace (sales_caller)
--   Field Sales Executive → Field Sales department → field workspace   (sales_field)
--   Sales Manager         → Revenue department     → sees both teams   (sales_manager)
-- The employee's sales role follows their designation automatically (trigger below).

alter table public.designations
  add column if not exists sales_role text check (sales_role is null or sales_role in ('sales_caller','sales_field','sales_manager')),
  add column if not exists default_department_id uuid references public.departments(id) on delete set null;

insert into public.departments (name) select 'Revenue' where not exists (select 1 from public.departments where lower(name) = 'revenue');
insert into public.departments (name) select 'Field Sales' where not exists (select 1 from public.departments where lower(name) = 'field sales');

insert into public.designations (name, can_assign_tasks)
select v.name, false from (values ('Telecaller'), ('Field Sales Executive'), ('Sales Manager')) v(name)
where not exists (select 1 from public.designations d where lower(d.name) = lower(v.name));

update public.designations set sales_role = 'sales_caller',
  default_department_id = (select id from public.departments where lower(name) = 'revenue' limit 1) where lower(name) = 'telecaller';
update public.designations set sales_role = 'sales_field',
  default_department_id = (select id from public.departments where lower(name) = 'field sales' limit 1) where lower(name) = 'field sales executive';
update public.designations set sales_role = 'sales_manager',
  default_department_id = (select id from public.departments where lower(name) = 'revenue' limit 1) where lower(name) = 'sales manager';

create or replace function private.sync_sales_role(p_employee uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_profile uuid; v_role text; v_active boolean;
begin
  select e.profile_id, d.sales_role, e.status = 'active' into v_profile, v_role, v_active
  from public.employees e left join public.designations d on d.id = e.designation_id where e.id = p_employee;
  if v_profile is null then return; end if;
  if not v_active then v_role := null; end if;
  delete from public.user_roles where user_id = v_profile
    and role_code in ('sales_caller','sales_field','sales_manager') and role_code is distinct from v_role;
  if v_role is not null then
    insert into public.user_roles (user_id, role_code, granted_by, granted_at)
    select v_profile, v_role, auth.uid(), now()
    where not exists (select 1 from public.user_roles where user_id = v_profile and role_code = v_role);
  end if;
end $$;

create or replace function private.employees_sync_sales_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.sync_sales_role(new.id);
  return new;
end $$;

drop trigger if exists employees_sync_sales_role on public.employees;
create trigger employees_sync_sales_role
  after insert or update of designation_id, status, profile_id on public.employees
  for each row execute function private.employees_sync_sales_role();

-- When a designation's sales role changes, re-sync everyone holding it.
create or replace function private.designations_sync_sales_role()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.sales_role is distinct from old.sales_role then
    for r in select id from public.employees where designation_id = new.id loop
      perform private.sync_sales_role(r.id);
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists designations_sync_sales_role on public.designations;
create trigger designations_sync_sales_role
  after update of sales_role on public.designations
  for each row execute function private.designations_sync_sales_role();

-- Designation is now the only way to give sales access.
revoke execute on function public.set_sales_role(uuid, text) from authenticated;

-- Bring existing employees in line (only adds roles for people already holding a sales designation).
select private.sync_sales_role(e.id) from public.employees e
join public.designations d on d.id = e.designation_id where d.sales_role is not null;
