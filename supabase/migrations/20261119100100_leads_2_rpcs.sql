-- Leads & Sales: every write goes through these functions (no direct insert/update/delete for users).

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'attendance','leave','wfh','task','holiday','payroll','system','contract','deliverable','dependency',
  'modification','billing','client','activity','lead']));

create or replace function private.norm_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select case when length(d) < 6 then null
              when length(d) = 12 and left(d, 2) = '91' then right(d, 10)
              when length(d) = 11 and left(d, 1) = '0' then right(d, 10)
              else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x;
$$;

create or replace function private.norm_email(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(lower(btrim(coalesce(p, ''))), '');
$$;

create or replace function private.clean(p text, p_max int) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(btrim(coalesce(p, '')), p_max), '');
$$;

-- Who may work (call, edit, qualify) a lead: sales managers/admins, or the owner with lead.call.
create or replace function private.can_work_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not private.offer_locked() and exists (
    select 1 from public.leads l where l.id = p_lead and (
      private.has_permission('lead.manage')
      or (private.has_permission('lead.call') and l.owner_id is not null and l.owner_id = private.current_employee_id())));
$$;

-- Active employee who holds a sales role (eligible to own leads).
create or replace function private.is_sales_employee(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employees e
    join public.user_roles ur on ur.user_id = e.profile_id
    join public.role_permissions rp on rp.role_code = ur.role_code and rp.permission_code = 'lead.call'
    where e.id = p_employee and e.status = 'active');
$$;

create or replace function private.notify_lead_managers(p_title text, p_message text, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select distinct p.id from public.profiles p
    where p.role = 'admin'
       or exists (select 1 from public.user_roles ur join public.role_permissions rp
                  on rp.role_code = ur.role_code and rp.permission_code = 'lead.manage'
                  where ur.user_id = p.id)
  loop
    if r.id is distinct from auth.uid() then
      perform private.notify(r.id, 'lead', p_title, p_message, '/admin-leads', p_key || ':' || r.id, '{}'::jsonb);
    end if;
  end loop;
end $$;

create or replace function private.lead_duplicate(p_phone text, p_email text, p_except uuid)
returns text language sql stable security definer set search_path = '' as $$
  select l.lead_no || coalesce(' (with ' || split_part(e.name, ' ', 1) || ')', ' (unassigned)')
  from public.leads l left join public.employees e on e.id = l.owner_id
  where l.stage <> 'lost' and (p_except is null or l.id <> p_except)
    and ((p_phone is not null and l.phone_norm = p_phone) or (p_email is not null and l.email_norm = p_email))
  order by l.created_at limit 1;
$$;
