-- IRA Presence V2 WFH review validation
-- Applied to Supabase project htxalzgotwsbicseyigu on 2026-10-02.

CREATE OR REPLACE FUNCTION private.handle_wfh_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  eid uuid := private.current_employee_id();
BEGIN
  IF NEW.status = OLD.status THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only admin can review WFH requests';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending WFH requests can be reviewed';
  END IF;

  IF NEW.status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Invalid WFH review status';
  END IF;

  NEW.reviewed_at := now();
  NEW.reviewed_by := (SELECT auth.uid());

  IF NEW.status = 'approved' THEN
    IF extract(dow FROM NEW.date) = 0 THEN
      RAISE EXCEPTION 'Sunday is a weekly off';
    END IF;
    IF EXISTS (SELECT 1 FROM public.holidays h WHERE h.date = NEW.date) THEN
      RAISE EXCEPTION 'Selected date is a company holiday';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.leave_requests lr
      WHERE lr.employee_id = NEW.employee_id
        AND lr.status = 'approved'
        AND lr.start_date <= NEW.date
        AND lr.end_date >= NEW.date
    ) THEN
      RAISE EXCEPTION 'Approved leave exists for this date';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = NEW.employee_id
        AND e.status = 'active'
        AND e.work_mode = 'remote'
    ) THEN
      RAISE EXCEPTION 'Remote employees do not need a WFH request';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wfh_status_change ON public.wfh_requests;
CREATE TRIGGER wfh_status_change
BEFORE UPDATE ON public.wfh_requests
FOR EACH ROW EXECUTE FUNCTION private.handle_wfh_status_change();

REVOKE ALL ON FUNCTION private.handle_wfh_status_change() FROM public, anon, authenticated;
