-- Fix Supabase Data API grants for the production V2 application.
-- RLS and grants are separate controls. The service_role used only inside
-- Edge Functions must retain server-side access, while public anonymous
-- access stays closed and authenticated users only get DML needed by policies.

grant usage on schema public to authenticated, service_role;

-- The application is not public-data-first. Anonymous clients do not need
-- direct access to HR/attendance tables through the Data API.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- Remove unnecessary elevated table privileges from signed-in users.
revoke references, trigger, truncate on all tables in schema public from authenticated;

-- Employee HR document metadata is read by the authenticated app subject to RLS.
grant select on public.employee_documents to authenticated;

-- Edge Functions use the server-side service_role client for privileged
-- provisioning, payroll and credential operations.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Keep future public objects consistent with the explicit service_role model.
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
