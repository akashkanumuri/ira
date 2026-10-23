-- SIGMA 1 — names of the people an employee works with on tasks.
-- Employees can read only their own employees row (RLS), so "Assigned by" and comment authors
-- showed as "Employee"/"Admin". This returns id, name and role title for: whoever assigned me
-- work, whoever I assigned work to, and my reporting manager. Staff only; admins see everyone.

create or replace function public.task_people()
returns table (id uuid, profile_id uuid, name text, designation text, avatar_url text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.profile_id, e.name, d.name, e.avatar_url
  from public.employees e
  left join public.designations d on d.id = e.designation_id
  where private.current_client_id() is null
    and (private.is_admin()
      or e.id in (
        select t.assigned_by from public.tasks t where t.assigned_to = private.current_employee_id() and t.assigned_by is not null
        union select t.assigned_to from public.tasks t where t.assigned_by = private.current_employee_id()
        union select m.manager_id from public.employees m where m.id = private.current_employee_id() and m.manager_id is not null
        union select x.id from public.employees x where x.manager_id = private.current_employee_id()))
$$;
revoke execute on function public.task_people() from public, anon;
grant execute on function public.task_people() to authenticated;
