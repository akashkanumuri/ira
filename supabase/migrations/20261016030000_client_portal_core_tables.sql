-- Migration: 20261016030000_client_portal_core_tables.sql
-- Description: Core tables for Contracts, Deliverables, Change Requests, Payments, Milestones, and Project Updates.
-- Full RLS and foreign keys to projects table.

BEGIN;

-- 1. Contracts Table
CREATE TABLE IF NOT EXISTS public.contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  ref TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'v1',
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending Review' CHECK (status IN ('Pending Review', 'Accepted', 'Declined')),
  assigned_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  accepted_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Contract Acceptances Table
CREATE TABLE IF NOT EXISTS public.contract_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  url TEXT NOT NULL,
  who TEXT NOT NULL,
  event TEXT NOT NULL DEFAULT 'Accepted',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Deliverables Table
CREATE TABLE IF NOT EXISTS public.deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  deliverable_number TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  quantity TEXT NOT NULL DEFAULT '1',
  due_date TEXT NOT NULL,
  dependencies TEXT NOT NULL DEFAULT '—',
  reference_url TEXT NOT NULL DEFAULT '—',
  responsible_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  responsible_name TEXT,
  status TEXT NOT NULL DEFAULT 'Not Started' CHECK (status IN ('Not Started', 'In Progress', 'Completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Change Requests Table
CREATE TABLE IF NOT EXISTS public.change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  deliverable_id UUID NOT NULL REFERENCES public.deliverables(id) ON DELETE CASCADE,
  request_number TEXT NOT NULL,
  field TEXT NOT NULL,
  previous_value TEXT,
  requested_value TEXT NOT NULL,
  reason TEXT,
  requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_by_name TEXT,
  status TEXT NOT NULL DEFAULT 'Pending Review' CHECK (status IN ('Pending Review', 'Approved Change', 'Change Declined')),
  reviewer_name TEXT,
  reviewer_comment TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Payment Installments Table
CREATE TABLE IF NOT EXISTS public.payment_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  installment_number INT NOT NULL,
  name TEXT NOT NULL,
  basis TEXT,
  amount NUMERIC(12, 2) NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Upcoming' CHECK (status IN ('Upcoming', 'Due', 'Overdue', 'Pending Verification', 'Paid')),
  payment_reference TEXT,
  paid_on TEXT,
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Milestones Table
CREATE TABLE IF NOT EXISTS public.milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_date TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'Upcoming' CHECK (state IN ('Upcoming', 'In Progress', 'Completed')),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Project Updates Table
CREATE TABLE IF NOT EXISTS public.project_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  meta TEXT NOT NULL,
  tone TEXT DEFAULT 'info',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS contracts_project_id_idx ON public.contracts(project_id);
CREATE INDEX IF NOT EXISTS contract_acceptances_contract_id_idx ON public.contract_acceptances(contract_id);
CREATE INDEX IF NOT EXISTS deliverables_project_id_idx ON public.deliverables(project_id);
CREATE INDEX IF NOT EXISTS change_requests_project_id_idx ON public.change_requests(project_id);
CREATE INDEX IF NOT EXISTS change_requests_deliverable_id_idx ON public.change_requests(deliverable_id);
CREATE INDEX IF NOT EXISTS payment_installments_project_id_idx ON public.payment_installments(project_id);
CREATE INDEX IF NOT EXISTS milestones_project_id_idx ON public.milestones(project_id);
CREATE INDEX IF NOT EXISTS project_updates_project_id_idx ON public.project_updates(project_id);

-- Enable RLS
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_updates ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contracts TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contract_acceptances TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.deliverables TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.change_requests TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_installments TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.milestones TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.project_updates TO authenticated, service_role;

-- RLS Policies
-- SELECT on all tables: uses private.can_view_project
CREATE POLICY "contracts_select_authorized" ON public.contracts
  FOR SELECT TO authenticated
  USING (private.can_view_project(project_id));

CREATE POLICY "contract_acceptances_select_authorized" ON public.contract_acceptances
  FOR SELECT TO authenticated
  USING (private.can_view_project(project_id));

CREATE POLICY "deliverables_select_authorized" ON public.deliverables
  FOR SELECT TO authenticated
  USING (private.can_view_project(project_id));

CREATE POLICY "change_requests_select_authorized" ON public.change_requests
  FOR SELECT TO authenticated
  USING (private.can_view_project(project_id));

CREATE POLICY "payment_installments_select_authorized" ON public.payment_installments
  FOR SELECT TO authenticated
  USING (private.can_view_project(project_id));

CREATE POLICY "milestones_select_authorized" ON public.milestones
  FOR SELECT TO authenticated
  USING (private.can_view_project(project_id));

CREATE POLICY "project_updates_select_authorized" ON public.project_updates
  FOR SELECT TO authenticated
  USING (private.can_view_project(project_id));

-- Admin full access on all tables
CREATE POLICY "contracts_admin_all" ON public.contracts
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

CREATE POLICY "contract_acceptances_admin_all" ON public.contract_acceptances
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

CREATE POLICY "deliverables_admin_all" ON public.deliverables
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

CREATE POLICY "change_requests_admin_all" ON public.change_requests
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

CREATE POLICY "payment_installments_admin_all" ON public.payment_installments
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

CREATE POLICY "milestones_admin_all" ON public.milestones
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

CREATE POLICY "project_updates_admin_all" ON public.project_updates
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

-- Manager policies on assigned projects
CREATE POLICY "deliverables_manager_mutations" ON public.deliverables
  FOR ALL TO authenticated
  USING (project_id IN (SELECT project_id FROM public.project_managers WHERE manager_id = private.current_employee_id()))
  WITH CHECK (project_id IN (SELECT project_id FROM public.project_managers WHERE manager_id = private.current_employee_id()));

CREATE POLICY "change_requests_manager_mutations" ON public.change_requests
  FOR ALL TO authenticated
  USING (project_id IN (SELECT project_id FROM public.project_managers WHERE manager_id = private.current_employee_id()))
  WITH CHECK (project_id IN (SELECT project_id FROM public.project_managers WHERE manager_id = private.current_employee_id()));

CREATE POLICY "milestones_manager_mutations" ON public.milestones
  FOR ALL TO authenticated
  USING (project_id IN (SELECT project_id FROM public.project_managers WHERE manager_id = private.current_employee_id()))
  WITH CHECK (project_id IN (SELECT project_id FROM public.project_managers WHERE manager_id = private.current_employee_id()));

CREATE POLICY "project_updates_manager_mutations" ON public.project_updates
  FOR ALL TO authenticated
  USING (project_id IN (SELECT project_id FROM public.project_managers WHERE manager_id = private.current_employee_id()))
  WITH CHECK (project_id IN (SELECT project_id FROM public.project_managers WHERE manager_id = private.current_employee_id()));

-- Client mutations
-- Client can accept or decline a contract for their project
CREATE POLICY "contracts_client_update" ON public.contracts
  FOR UPDATE TO authenticated
  USING (project_id IN (SELECT project_id FROM public.project_clients WHERE client_id = (SELECT auth.uid())))
  WITH CHECK (project_id IN (SELECT project_id FROM public.project_clients WHERE client_id = (SELECT auth.uid())));

-- Client can record contract acceptance
CREATE POLICY "contract_acceptances_client_insert" ON public.contract_acceptances
  FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT project_id FROM public.project_clients WHERE client_id = (SELECT auth.uid())));

-- Client can submit a change request
CREATE POLICY "change_requests_client_insert" ON public.change_requests
  FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT project_id FROM public.project_clients WHERE client_id = (SELECT auth.uid())));

-- Client can update payment installments with payment reference (for verification)
CREATE POLICY "payment_installments_client_update" ON public.payment_installments
  FOR UPDATE TO authenticated
  USING (project_id IN (SELECT project_id FROM public.project_clients WHERE client_id = (SELECT auth.uid())))
  WITH CHECK (project_id IN (SELECT project_id FROM public.project_clients WHERE client_id = (SELECT auth.uid())));

COMMIT;
