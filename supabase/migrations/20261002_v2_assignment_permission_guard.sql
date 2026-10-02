-- IRA Presence V2 assignment permission guard
-- Applied to Supabase project htxalzgotwsbicseyigu on 2026-10-02.

CREATE OR REPLACE FUNCTION private.can_assign_task(target_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=''
AS $$
  SELECT
    private.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.employees a
      JOIN public.designations ad ON ad.id = a.designation_id
      JOIN public.employees t ON t.id = target_employee_id
      JOIN public.designations td ON td.id = t.designation_id
      JOIN public.task_assignment_rules r ON r.assigner_designation_id = ad.id
      WHERE a.id = private.current_employee_id()
        AND ad.can_assign_tasks = true
        AND (r.assignee_designation_id IS NULL OR r.assignee_designation_id = td.id)
        AND (r.scope = 'any' OR (r.scope = 'direct_reports' AND t.manager_id = a.id))
    );
$$;

REVOKE ALL ON FUNCTION private.can_assign_task(uuid) FROM public, anon, authenticated;
