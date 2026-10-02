-- Merge HR document SELECT policies into one permissive policy.
drop policy if exists employee_documents_admin_select on public.employee_documents;
drop policy if exists employee_documents_self_select on public.employee_documents;

create policy employee_documents_select_authenticated
on public.employee_documents
for select
to authenticated
using (private.is_admin() or employee_id = private.current_employee_id());
