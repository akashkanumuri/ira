-- IRA Presence — Live Attendance V1
-- Source of truth: Supabase Postgres + Supabase Auth
-- Timezone used by the application: Asia/Kolkata

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- DEPARTMENTS
-- ============================================================
-- ============================================================
-- PROFILES — one per Supabase Auth user
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('employee', 'admin')) DEFAULT 'employee',
  emp_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- EMPLOYEES — five real employee accounts can be linked here
-- ============================================================
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID UNIQUE REFERENCES profiles(id) ON DELETE SET NULL,
  emp_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  department_id UUID,
  designation TEXT,
  phone TEXT,
  manager_id UUID REFERENCES employees(id),
  shift_start TIME NOT NULL DEFAULT '09:00',
  shift_end TIME NOT NULL DEFAULT '18:00',
  join_date DATE,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  wfh_balance INTEGER NOT NULL DEFAULT 0,
  leave_balance INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Employee login is by name in the UI. Names therefore need to be unique.
CREATE UNIQUE INDEX employees_name_ci_unique ON employees (LOWER(TRIM(name)));

-- ============================================================
-- HOLIDAYS — maintained by Admin, read by both portals
-- ============================================================
CREATE TABLE holidays (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  date DATE NOT NULL UNIQUE,
  description TEXT,
  mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- WFH REQUESTS
-- ============================================================
CREATE TABLE wfh_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  duration TEXT NOT NULL CHECK (duration IN ('full_day', 'half_day')),
  reason TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, date)
);

-- ============================================================
-- LEAVE REQUESTS
-- ============================================================
CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('casual', 'sick', 'earned', 'unpaid')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days INTEGER NOT NULL CHECK (days > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- ============================================================
-- ATTENDANCE — exactly one row per employee per business date
-- ============================================================
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('office', 'wfh')),
  status TEXT NOT NULL CHECK (status IN ('present', 'late', 'absent', 'wfh', 'leave', 'holiday')) DEFAULT 'present',
  check_in_at TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  working_seconds INTEGER NOT NULL DEFAULT 0 CHECK (working_seconds >= 0),
  total_break_seconds INTEGER NOT NULL DEFAULT 0 CHECK (total_break_seconds >= 0),
  current_state TEXT NOT NULL CHECK (current_state IN ('not_checked_in', 'working', 'on_break', 'completed')) DEFAULT 'not_checked_in',
  wfh_request_id UUID REFERENCES wfh_requests(id),
  leave_request_id UUID REFERENCES leave_requests(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, date),
  CONSTRAINT attendance_checkout_after_checkin CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at > check_in_at)
);

-- ============================================================
-- BREAK EVENTS — explicit start/resume events
-- ============================================================
CREATE TABLE break_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attendance_id UUID NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  break_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  break_end TIMESTAMPTZ,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT break_end_after_start CHECK (break_end IS NULL OR break_end >= break_start)
);

-- ============================================================
-- ATTENDANCE EVENTS — immutable attendance action trail
-- ============================================================
CREATE TABLE attendance_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attendance_id UUID NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('check_in', 'check_out', 'break_start', 'break_end')),
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- REGULARIZATION / CORRECTIONS
-- ============================================================
CREATE TABLE regularization_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_id UUID REFERENCES attendance(id),
  date DATE NOT NULL,
  original_check_in TEXT,
  original_check_out TEXT,
  requested_check_in TIME NOT NULL,
  requested_check_out TIME NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AUTH SESSIONS — previous application logins, separate from attendance
-- ============================================================
CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  logout_at TIMESTAMPTZ,
  session_duration_seconds INTEGER CHECK (session_duration_seconds IS NULL OR session_duration_seconds >= 0),
  user_agent TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'ended', 'expired')) DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_attendance_employee_date ON attendance(employee_id, date DESC);
CREATE INDEX idx_attendance_date ON attendance(date);
CREATE INDEX idx_attendance_events_attendance ON attendance_events(attendance_id, event_at);
CREATE INDEX idx_break_events_attendance ON break_events(attendance_id, break_start);
CREATE INDEX idx_wfh_requests_employee_date ON wfh_requests(employee_id, date DESC);
CREATE INDEX idx_leave_requests_employee_date ON leave_requests(employee_id, start_date DESC);
CREATE INDEX idx_regularization_employee_date ON regularization_requests(employee_id, date DESC);
CREATE INDEX idx_auth_sessions_user_login ON auth_sessions(user_id, login_at DESC);
CREATE INDEX idx_employees_status ON employees(status);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_attendance_updated BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- AUTO-CREATE PROFILE ON SUPABASE AUTH USER CREATION
-- New accounts are employees by default. Promote the dedicated admin
-- account to role='admin' after it is created.
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, role, emp_id)
  VALUES (NEW.id, 'employee', NULL)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- EMPLOYEE NAME -> AUTH EMAIL LOOKUP
-- Employee UI asks only for Name + Password. This RPC resolves the
-- matching active employee email without exposing the employees table
-- to anonymous reads.
-- ============================================================
CREATE OR REPLACE FUNCTION get_employee_login_email(p_name TEXT)
RETURNS TEXT AS $$
  SELECT email
  FROM employees
  WHERE status = 'active'
    AND LOWER(TRIM(name)) = LOWER(TRIM(p_name))
  LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION get_employee_login_email(TEXT) TO anon, authenticated;

-- ============================================================
-- ROLE / EMPLOYEE HELPERS
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_my_employee_id()
RETURNS UUID AS $$
  SELECT id FROM employees WHERE profile_id = auth.uid();
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

-- Single security-definer account-context RPC used by the client after Supabase Auth.
-- This avoids RLS/relationship-query ambiguity during login.
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

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE wfh_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE break_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE regularization_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "profiles_select_own_or_admin" ON profiles
  FOR SELECT USING (id = auth.uid() OR get_my_role() = 'admin');
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- Employees
CREATE POLICY "employees_select_own_or_admin" ON employees
  FOR SELECT USING (profile_id = auth.uid() OR get_my_role() = 'admin');
CREATE POLICY "employees_admin_insert" ON employees
  FOR INSERT WITH CHECK (get_my_role() = 'admin');
CREATE POLICY "employees_admin_update" ON employees
  FOR UPDATE USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');

-- Holidays
CREATE POLICY "holidays_select_authenticated" ON holidays
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "holidays_admin_all" ON holidays
  FOR ALL USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');

-- Attendance
CREATE POLICY "attendance_select_own_or_admin" ON attendance
  FOR SELECT USING (employee_id = get_my_employee_id() OR get_my_role() = 'admin');
CREATE POLICY "attendance_insert_own_or_admin" ON attendance
  FOR INSERT WITH CHECK (employee_id = get_my_employee_id() OR get_my_role() = 'admin');
CREATE POLICY "attendance_update_own_or_admin" ON attendance
  FOR UPDATE USING (employee_id = get_my_employee_id() OR get_my_role() = 'admin')
  WITH CHECK (employee_id = get_my_employee_id() OR get_my_role() = 'admin');

-- Break events
CREATE POLICY "break_select_own_or_admin" ON break_events
  FOR SELECT USING (employee_id = get_my_employee_id() OR get_my_role() = 'admin');
CREATE POLICY "break_insert_own_or_admin" ON break_events
  FOR INSERT WITH CHECK (employee_id = get_my_employee_id() OR get_my_role() = 'admin');
CREATE POLICY "break_update_own_or_admin" ON break_events
  FOR UPDATE USING (employee_id = get_my_employee_id() OR get_my_role() = 'admin')
  WITH CHECK (employee_id = get_my_employee_id() OR get_my_role() = 'admin');

-- Attendance events
CREATE POLICY "attendance_events_select_own_or_admin" ON attendance_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.id = attendance_events.attendance_id
        AND (a.employee_id = get_my_employee_id() OR get_my_role() = 'admin')
    )
  );
CREATE POLICY "attendance_events_insert_own_or_admin" ON attendance_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.id = attendance_events.attendance_id
        AND (a.employee_id = get_my_employee_id() OR get_my_role() = 'admin')
    )
  );

-- WFH requests
CREATE POLICY "wfh_select_own_or_admin" ON wfh_requests
  FOR SELECT USING (employee_id = get_my_employee_id() OR get_my_role() = 'admin');
CREATE POLICY "wfh_insert_own" ON wfh_requests
  FOR INSERT WITH CHECK (employee_id = get_my_employee_id());
CREATE POLICY "wfh_update_own_or_admin" ON wfh_requests
  FOR UPDATE USING (employee_id = get_my_employee_id() OR get_my_role() = 'admin')
  WITH CHECK (employee_id = get_my_employee_id() OR get_my_role() = 'admin');

-- Leave requests
CREATE POLICY "leave_select_own_or_admin" ON leave_requests
  FOR SELECT USING (employee_id = get_my_employee_id() OR get_my_role() = 'admin');
CREATE POLICY "leave_insert_own" ON leave_requests
  FOR INSERT WITH CHECK (employee_id = get_my_employee_id());
CREATE POLICY "leave_update_own_or_admin" ON leave_requests
  FOR UPDATE USING (employee_id = get_my_employee_id() OR get_my_role() = 'admin')
  WITH CHECK (employee_id = get_my_employee_id() OR get_my_role() = 'admin');

-- Regularization
CREATE POLICY "regularization_select_own_or_admin" ON regularization_requests
  FOR SELECT USING (employee_id = get_my_employee_id() OR get_my_role() = 'admin');
CREATE POLICY "regularization_insert_own" ON regularization_requests
  FOR INSERT WITH CHECK (employee_id = get_my_employee_id());
CREATE POLICY "regularization_update_admin" ON regularization_requests
  FOR UPDATE USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');

-- Login sessions
CREATE POLICY "auth_sessions_select_own_or_admin" ON auth_sessions
  FOR SELECT USING (user_id = auth.uid() OR get_my_role() = 'admin');
CREATE POLICY "auth_sessions_insert_own" ON auth_sessions
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "auth_sessions_update_own_or_admin" ON auth_sessions
  FOR UPDATE USING (user_id = auth.uid() OR get_my_role() = 'admin')
  WITH CHECK (user_id = auth.uid() OR get_my_role() = 'admin');
