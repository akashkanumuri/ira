-- Sales team list (for assigning leads and reports). Sales managers and admin only.
create or replace function public.sales_team()
returns table (employee_id uuid, name text, role_code text, avatar_url text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.has_permission('lead.manage'), 'Only a sales manager or admin can see the sales team.');
  return query
    select e.id, e.name, ur.role_code, e.avatar_url
    from public.employees e
    join public.user_roles ur on ur.user_id = e.profile_id and ur.role_code in ('sales_caller','sales_field','sales_manager')
    where e.status = 'active'
    order by e.name;
end $$;
revoke all on function public.sales_team() from public, anon;
grant execute on function public.sales_team() to authenticated;

-- My own sales role (any signed-in employee; returns null when none or offer not accepted).
create or replace function public.my_sales_role()
returns text language sql stable security definer set search_path = '' as $$
  select ur.role_code from public.user_roles ur
  where ur.user_id = auth.uid() and ur.role_code in ('sales_caller','sales_field','sales_manager')
    and not private.offer_locked()
  order by case ur.role_code when 'sales_manager' then 1 when 'sales_field' then 2 else 3 end
  limit 1;
$$;
revoke all on function public.my_sales_role() from public, anon;
grant execute on function public.my_sales_role() to authenticated;
