-- IRA Presence V2 security/performance cleanup
-- Applied to Supabase project htxalzgotwsbicseyigu on 2026-10-02.
-- Keeps employee data scoped to self/admin/authorized task targets and restricts avatar deletion.

DROP POLICY IF EXISTS employees_assignment_targets_select ON public.employees;
DROP POLICY IF EXISTS employees_self_select ON public.employees;
CREATE POLICY employees_select_scope ON public.employees
FOR SELECT TO authenticated
USING (
  private.is_admin()
  OR profile_id = (SELECT auth.uid())
  OR (status = 'active' AND private.can_assign_task(id))
);

DROP POLICY IF EXISTS avatars_employee_delete ON storage.objects;
CREATE POLICY avatars_employee_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'avatars'
  AND name LIKE ((private.current_employee_id())::text || '/%')
);

CREATE INDEX IF NOT EXISTS employees_profile_id_lookup_idx ON public.employees(profile_id);
CREATE INDEX IF NOT EXISTS employees_manager_id_lookup_idx ON public.employees(manager_id);
CREATE INDEX IF NOT EXISTS employees_designation_id_lookup_idx ON public.employees(designation_id);
CREATE INDEX IF NOT EXISTS employees_department_id_lookup_idx ON public.employees(department_id);
CREATE INDEX IF NOT EXISTS employee_documents_employee_id_lookup_idx ON public.employee_documents(employee_id);

COMMENT ON TABLE public.employees IS 'Master employee record. Historical business records reference employee_id and are retained when an account is deactivated.';
COMMENT ON TABLE public.employee_documents IS 'Private HR documents. Access is admin-only; files are stored in the private hr-documents bucket.';
