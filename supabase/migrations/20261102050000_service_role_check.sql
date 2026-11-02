-- SIGMA 1 — recognise the service role the way current PostgREST reports it.
-- PostgREST no longer sets the legacy GUC request.jwt.claim.role; only request.jwt.claims (JSON).
-- Effect before this fix:
--   * Admin "Edit employee" (employee-admin edge function, service role) failed with 'Unauthorized employee update'.
--   * private.is_admin() returned false for the service role.
--   * protect_profile_update's "direct database" exception matched every caller (current_user is the
--     definer inside SECURITY DEFINER), so it never blocked anyone. Not exploitable today because
--     authenticated has no UPDATE grant on profiles, but the guard now works as written.
set local lock_timeout = '5s';

create or replace function private.is_service_role()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    '') = 'service_role'
$$;
revoke all on function private.is_service_role() from public, anon;
grant execute on function private.is_service_role() to authenticated, service_role;

create or replace function private.is_admin()
returns boolean language plpgsql security definer set search_path = '' as $$
DECLARE
  v_role text;
BEGIN
  IF private.is_service_role() THEN
    RETURN true;
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = (SELECT auth.uid());
  RETURN coalesce(v_role = 'admin', false);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

create or replace function private.protect_profile_update()
returns trigger language plpgsql security definer set search_path = '' as $$
BEGIN
  -- Service role, direct database access with no request at all (SQL editor, migrations, cron), and admins
  IF private.is_service_role()
     OR (coalesce(current_setting('request.jwt.claims', true), '') = '' AND coalesce(current_setting('request.jwt.claim.role', true), '') = '')
     OR private.is_admin() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Unauthorized: Users cannot modify their own profile role.';
  END IF;
  IF NEW.emp_id IS DISTINCT FROM OLD.emp_id THEN
    RAISE EXCEPTION 'Unauthorized: Users cannot modify their own employee ID.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Unauthorized: Profile ID cannot be modified.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

create or replace function private.protect_employee_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.is_service_role() or private.is_admin() then
    NEW.updated_at := now();
    return NEW;
  end if;
  if coalesce(current_setting('sigma.rules_sync', true), '') = 'on' then
    return private.employee_legacy_only(OLD, NEW);
  end if;
  if private.current_employee_id() is null or OLD.id <> private.current_employee_id() then raise exception 'Unauthorized employee update'; end if;
  NEW.profile_id := OLD.profile_id; NEW.emp_id := OLD.emp_id; NEW.login_id := OLD.login_id; NEW.status := OLD.status;
  NEW.work_mode := OLD.work_mode; NEW.shift_start := OLD.shift_start; NEW.shift_end := OLD.shift_end; NEW.join_date := OLD.join_date;
  NEW.department_id := OLD.department_id; NEW.designation_id := OLD.designation_id; NEW.manager_id := OLD.manager_id;
  NEW.created_at := OLD.created_at; NEW.updated_at := now();
  return NEW;
end;
$$;
