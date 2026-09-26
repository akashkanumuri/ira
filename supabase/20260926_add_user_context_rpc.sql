-- IRA Presence: production login-context RPC
-- Run once in Supabase SQL Editor after the base schema.
-- It does not create users or change passwords.

CREATE OR REPLACE FUNCTION get_current_user_context()
RETURNS TABLE (
  role TEXT,
  profile_emp_id TEXT,
  employee_id UUID,
  emp_id TEXT,
  name TEXT,
  email TEXT,
  avatar_url TEXT,
  designation TEXT,
  phone TEXT,
  shift_start TIME,
  status TEXT,
  wfh_balance INTEGER,
  leave_balance INTEGER
) AS $$
  SELECT
    p.role,
    p.emp_id AS profile_emp_id,
    e.id AS employee_id,
    e.emp_id,
    e.name,
    e.email,
    e.avatar_url,
    e.designation,
    e.phone,
    e.shift_start,
    e.status,
    e.wfh_balance,
    e.leave_balance
  FROM profiles p
  LEFT JOIN employees e
    ON e.profile_id = p.id
  WHERE p.id = auth.uid();
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION get_current_user_context() TO authenticated;
