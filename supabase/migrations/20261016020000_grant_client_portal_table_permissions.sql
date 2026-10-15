-- Migration: 20261016020000_grant_client_portal_table_permissions.sql
-- Description: Grants table-level permissions on Client Portal tables to authenticated and service_role.
-- RLS policies remain strictly enforced on all tables for row-level access control.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.project_clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.project_managers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.client_invitations TO authenticated;

GRANT ALL ON TABLE public.clients TO service_role;
GRANT ALL ON TABLE public.projects TO service_role;
GRANT ALL ON TABLE public.project_clients TO service_role;
GRANT ALL ON TABLE public.project_managers TO service_role;
GRANT ALL ON TABLE public.client_invitations TO service_role;
