-- ============================================================
-- OPTIONAL INITIAL CONFIGURATION — NO DUMMY EMPLOYEES OR ATTENDANCE
-- Run after schema.sql.
-- Create your 5 employee Auth users + 1 admin Auth user in Supabase Auth,
-- then create/link the corresponding employees rows with their real details.
-- ============================================================

INSERT INTO departments (id, name, description) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'Human Resources', 'People & Operations'),
  ('d1000000-0000-0000-0000-000000000002', 'Marketing', 'Brand & Growth Marketing'),
  ('d1000000-0000-0000-0000-000000000003', 'Design', 'UI/UX and Product Design'),
  ('d1000000-0000-0000-0000-000000000004', 'Engineering', 'Software Engineering & DevOps'),
  ('d1000000-0000-0000-0000-000000000005', 'Product', 'Product Management'),
  ('d1000000-0000-0000-0000-000000000006', 'Sales', 'Account Sales & Business Development')
ON CONFLICT (id) DO NOTHING;

-- Add only the holidays your company actually observes.
-- Example format:
-- INSERT INTO holidays (name, date, description, mandatory)
-- VALUES ('Company Holiday', '2026-12-25', 'Company holiday', TRUE)
-- ON CONFLICT (date) DO NOTHING;

-- After creating the separate admin Auth account, promote its profile:
-- UPDATE profiles SET role = 'admin', emp_id = NULL WHERE id = 'ADMIN_AUTH_USER_UUID';

-- Then insert exactly the 5 real employees and link each row to its Supabase Auth profile:
-- INSERT INTO employees (profile_id, emp_id, name, email, department_id, status)
-- VALUES (...real values...);
