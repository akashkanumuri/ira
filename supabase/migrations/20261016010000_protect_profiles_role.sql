-- Migration: 20261016010000_protect_profiles_role.sql
-- Description: Hardens public.profiles against unauthorized role, emp_id, and id modifications.
-- Prevents ordinary authenticated users (employees, clients) from elevating their own role to admin or manager,
-- while safely permitting direct superuser maintenance in psql / SQL Editor and verified admin operations.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role, postgres;

-- Ensure private.is_admin() helper is defined idempotently and safely
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
BEGIN
  IF coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = (SELECT auth.uid());
  RETURN coalesce(v_role = 'admin', false);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.is_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated, service_role, postgres;

-- 1. Create a security definer protection function in private schema
CREATE OR REPLACE FUNCTION private.protect_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Service role, direct database administrator (psql/SQL Editor with no JWT claims), and verified admins are authorized
  IF coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR (current_user IN ('postgres', 'supabase_admin') AND coalesce(current_setting('request.jwt.claim.role', true), '') = '')
     OR private.is_admin() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Block any unauthorized attempt by an ordinary user to modify their role
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Unauthorized: Users cannot modify their own profile role.';
  END IF;

  -- Block unauthorized modification of emp_id
  IF NEW.emp_id IS DISTINCT FROM OLD.emp_id THEN
    RAISE EXCEPTION 'Unauthorized: Users cannot modify their own employee ID.';
  END IF;

  -- Block unauthorized modification of the primary key
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Unauthorized: Profile ID cannot be modified.';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_profile_update() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.protect_profile_update() TO postgres, service_role;

-- 2. Attach trigger to public.profiles
DROP TRIGGER IF EXISTS trg_protect_profile_update ON public.profiles;
CREATE TRIGGER trg_protect_profile_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_profile_update();

-- 3. Replace legacy profiles_update_own policy
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) OR private.is_admin())
  WITH CHECK (id = (SELECT auth.uid()) OR private.is_admin());

COMMIT;
