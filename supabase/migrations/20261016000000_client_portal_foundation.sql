-- Migration: 20261016000000_client_portal_foundation.sql
-- Description: Establishes foundation for IRA Client Portal.
-- Additive only. Preserves all existing employee and admin behavior.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role, postgres;

-- 1. Extend profiles.role check constraint to support 'client' and 'manager'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'profiles_role_check' 
    AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
  END IF;

  ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('employee', 'admin', 'client', 'manager'));
END $$;

-- 2. Clients master table
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  primary_contact TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Projects table
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Project-Clients junction table
CREATE TABLE IF NOT EXISTS public.project_clients (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, client_id)
);

-- 5. Project-Managers junction table
CREATE TABLE IF NOT EXISTS public.project_managers (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  manager_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, manager_id)
);

-- 6. Client invitation tokens table (stores SHA-256 hash only; 72-hour expiration; single-use)
CREATE TABLE IF NOT EXISTS public.client_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '72 hours'),
  used_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Performance and lookup indexes
CREATE INDEX IF NOT EXISTS clients_profile_id_idx ON public.clients(profile_id);
CREATE INDEX IF NOT EXISTS clients_email_idx ON public.clients(email);
CREATE INDEX IF NOT EXISTS project_clients_client_id_idx ON public.project_clients(client_id);
CREATE INDEX IF NOT EXISTS project_managers_manager_id_idx ON public.project_managers(manager_id);
CREATE INDEX IF NOT EXISTS client_invitations_token_hash_idx ON public.client_invitations(token_hash);
CREATE INDEX IF NOT EXISTS client_invitations_client_id_idx ON public.client_invitations(client_id);

-- Enable Row Level Security
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_invitations ENABLE ROW LEVEL SECURITY;

-- Non-recursive project view permission helper
CREATE OR REPLACE FUNCTION private.can_view_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR private.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.project_clients 
      WHERE project_id = p_project_id AND client_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_managers 
      WHERE project_id = p_project_id AND manager_id = private.current_employee_id()
    );
$$;

GRANT EXECUTE ON FUNCTION private.can_view_project(uuid) TO authenticated, service_role, postgres;

-- 7. RLS Policies

-- Clients table
DROP POLICY IF EXISTS "clients_select_own_or_admin" ON public.clients;
CREATE POLICY "clients_select_own_or_admin" ON public.clients
  FOR SELECT TO authenticated
  USING (
    profile_id = (SELECT auth.uid())
    OR private.is_admin()
  );

DROP POLICY IF EXISTS "clients_admin_mutations" ON public.clients;
CREATE POLICY "clients_admin_mutations" ON public.clients
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

-- Projects table (uses non-recursive helper)
DROP POLICY IF EXISTS "projects_select_authorized" ON public.projects;
CREATE POLICY "projects_select_authorized" ON public.projects
  FOR SELECT TO authenticated
  USING (private.can_view_project(id));

DROP POLICY IF EXISTS "projects_admin_mutations" ON public.projects;
CREATE POLICY "projects_admin_mutations" ON public.projects
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS "projects_manager_update" ON public.projects;
CREATE POLICY "projects_manager_update" ON public.projects
  FOR UPDATE TO authenticated
  USING (id IN (SELECT project_id FROM public.project_managers WHERE manager_id = private.current_employee_id()))
  WITH CHECK (id IN (SELECT project_id FROM public.project_managers WHERE manager_id = private.current_employee_id()));

-- Project-Clients junction table
DROP POLICY IF EXISTS "project_clients_select" ON public.project_clients;
CREATE POLICY "project_clients_select" ON public.project_clients
  FOR SELECT TO authenticated
  USING (
    client_id = (SELECT auth.uid())
    OR private.is_admin()
    OR private.can_view_project(project_id)
  );

DROP POLICY IF EXISTS "project_clients_admin_mutations" ON public.project_clients;
CREATE POLICY "project_clients_admin_mutations" ON public.project_clients
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

-- Project-Managers junction table
DROP POLICY IF EXISTS "project_managers_select" ON public.project_managers;
CREATE POLICY "project_managers_select" ON public.project_managers
  FOR SELECT TO authenticated
  USING (
    manager_id = private.current_employee_id()
    OR private.is_admin()
    OR private.can_view_project(project_id)
  );

DROP POLICY IF EXISTS "project_managers_admin_mutations" ON public.project_managers;
CREATE POLICY "project_managers_admin_mutations" ON public.project_managers
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

-- Client invitations table (strictly inaccessible to clients; read/write reserved for admins & Edge Functions)
DROP POLICY IF EXISTS "client_invitations_admin_access" ON public.client_invitations;
CREATE POLICY "client_invitations_admin_access" ON public.client_invitations
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

-- 8. Self-healing client status reconciliation on initial login
CREATE OR REPLACE FUNCTION private.reconcile_client_login()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.clients
  SET status = 'active', updated_at = now()
  WHERE profile_id = NEW.user_id AND status = 'invited';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconcile_client_login ON public.auth_sessions;
CREATE TRIGGER trg_reconcile_client_login
  AFTER INSERT ON public.auth_sessions
  FOR EACH ROW
  EXECUTE FUNCTION private.reconcile_client_login();

COMMIT;
