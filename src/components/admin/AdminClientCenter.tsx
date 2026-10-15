import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Employee } from '../../types/attendance';
import {
  Building2,
  FolderKanban,
  FileSignature,
  Package,
  GitPullRequest,
  CreditCard,
  Plus,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Mail,
  User,
  ArrowRight,
  ExternalLink,
  History,
  Pencil,
  Clock,
  ShieldCheck,
  Lock,
  UserPlus,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { invokeClientAdmin } from '../../lib/v2';
import { ClientCreationModal } from './ClientCreationModal';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHead,
  DataTable,
  Dialog,
  Empty,
  Field,
  FilterBar,
  Input,
  KV,
  LinkRef,
  PageHeader,
  Person,
  SearchField,
  Select,
  SidePanel,
  Stat,
  Status,
  Tabs,
  Textarea,
  Timeline,
  useToast,
  ToastProvider,
  cx,
} from '../client/ClientUI';

interface Props {
  employees: Employee[];
}

export const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN');

export const AdminClientCenter: React.FC<Props> = ({ employees }) => {
  return (
    <ToastProvider>
      <AdminClientCenterInternal employees={employees} />
    </ToastProvider>
  );
};

const AdminClientCenterInternal: React.FC<Props> = ({ employees }) => {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'directory' | 'projects' | 'contracts' | 'deliverables' | 'changes' | 'payments'>('directory');

  /* =========================================================================
     SHARED STATE
  ========================================================================= */
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  // Modals & Panels
  const [showCreateClientModal, setShowCreateClientModal] = useState(false);

  /* ---------- Load Clients & Projects ---------- */
  const loadCoreData = useCallback(async () => {
    setLoading(true);
    try {
      const db = supabase as any;
      const [{ data: cData }, { data: pData }, { data: pcData }, { data: pmData }] = await Promise.all([
        db.from('clients').select('*').order('created_at', { ascending: false }),
        db.from('projects').select('*').order('created_at', { ascending: false }),
        db.from('project_clients').select('*'),
        db.from('project_managers').select('*, employees:manager_id(id, name, work_email)'),
      ]);

      const clientProjectCount: Record<string, number> = {};
      const clientProjectList: Record<string, string[]> = {};
      (pcData || []).forEach((pc: any) => {
        clientProjectCount[pc.client_id] = (clientProjectCount[pc.client_id] || 0) + 1;
        clientProjectList[pc.client_id] = [...(clientProjectList[pc.client_id] || []), pc.project_id];
      });

      const projectManagerMap: Record<string, { id: string; name: string }> = {};
      (pmData || []).forEach((pm: any) => {
        if (pm.employees) {
          projectManagerMap[pm.project_id] = { id: pm.manager_id, name: pm.employees.name };
        }
      });

      const projectClientMap: Record<string, { id: string; name: string }> = {};
      (pcData || []).forEach((pc: any) => {
        const foundClient = (cData || []).find((c: any) => c.profile_id === pc.client_id);
        if (foundClient) {
          projectClientMap[pc.project_id] = { id: foundClient.id, name: foundClient.company_name };
        }
      });

      const enrichedProjects = (pData || []).map((p: any) => ({
        ...p,
        clientName: projectClientMap[p.id]?.name || 'Unassigned',
        clientId: projectClientMap[p.id]?.id || null,
        managerName: projectManagerMap[p.id]?.name || 'Unassigned',
        managerId: projectManagerMap[p.id]?.id || null,
      }));

      const enrichedClients = (cData || []).map((c: any) => {
        const assignedProjIds = clientProjectList[c.profile_id] || [];
        const assignedProjs = enrichedProjects.filter((p: any) => assignedProjIds.includes(p.id));
        const firstMgr = assignedProjs[0]?.managerName || '—';
        return {
          ...c,
          projectCount: clientProjectCount[c.profile_id] || 0,
          managerName: firstMgr,
          projects: assignedProjs,
        };
      });

      setClients(enrichedClients);
      setProjects(enrichedProjects);
      if (enrichedProjects.length > 0 && !selectedProjectId) {
        setSelectedProjectId(enrichedProjects[0].id);
      }
    } catch (err) {
      console.error('[AdminClientCenter] Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void loadCoreData();
  }, [loadCoreData]);

  /* =========================================================================
     TAB 1: CLIENT DIRECTORY & DETAIL
  ========================================================================= */
  const [clientSearch, setClientSearch] = useState('');
  const [clientStatusFilter, setClientStatusFilter] = useState('All');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientDetailTab, setClientDetailTab] = useState('overview');
  const [assignMgrDialogOpen, setAssignMgrDialogOpen] = useState(false);
  const [selectedMgrId, setSelectedMgrId] = useState('');
  const [toggleAccessDialogOpen, setToggleAccessDialogOpen] = useState(false);
  const [resendingClient, setResendingClient] = useState<string | null>(null);

  const selectedClient = useMemo(() => {
    return clients.find(c => c.id === selectedClientId) || null;
  }, [clients, selectedClientId]);

  const filteredClients = clients.filter(c => {
    const matchesStatus =
      clientStatusFilter === 'All' ||
      c.status?.toLowerCase() === clientStatusFilter.toLowerCase();
    const term = clientSearch.trim().toLowerCase();
    const matchesSearch =
      !term ||
      c.company_name?.toLowerCase().includes(term) ||
      c.primary_contact?.toLowerCase().includes(term) ||
      c.email?.toLowerCase().includes(term);
    return matchesStatus && matchesSearch;
  });

  const handleResendInvitation = async (c: any) => {
    setResendingClient(c.id);
    try {
      const res = await invokeClientAdmin({
        action: 'resend_invitation',
        clientId: c.profile_id,
      });
      if (res?.success) {
        toast(
          res.emailDelivery?.sent
            ? `Invitation email delivered to ${c.email}!`
            : 'New invitation link generated successfully.'
        );
      } else {
        toast(res?.error || 'Failed to resend invitation.', 'err');
      }
    } catch (e) {
      toast('Failed to resend invitation.', 'err');
    } finally {
      setResendingClient(null);
    }
  };

  const handleToggleClientAccess = async () => {
    if (!selectedClient) return;
    const nextStatus = selectedClient.status === 'active' ? 'inactive' : 'active';
    try {
      const { error } = await (supabase as any)
        .from('clients')
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', selectedClient.id);
      if (error) throw error;
      toast(`Client access set to ${nextStatus}.`);
      setToggleAccessDialogOpen(false);
      void loadCoreData();
    } catch (e) {
      toast('Failed to update client status.', 'err');
    }
  };

  const handleAssignManagerToClientProjects = async () => {
    if (!selectedClient || !selectedMgrId) return;
    try {
      const db = supabase as any;
      const clientProjs = selectedClient.projects || [];
      for (const p of clientProjs) {
        await db.from('project_managers').upsert({
          project_id: p.id,
          manager_id: selectedMgrId,
        });
      }
      toast('Manager assigned to client project(s).');
      setAssignMgrDialogOpen(false);
      void loadCoreData();
    } catch (e) {
      toast('Failed to assign manager.', 'err');
    }
  };

  /* =========================================================================
     TAB 2: PROJECTS
  ========================================================================= */
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [newProjectForm, setNewProjectForm] = useState({
    name: '',
    description: '',
    clientId: '',
    managerId: '',
  });
  const [selectedProjectSideId, setSelectedProjectSideId] = useState<string | null>(null);

  const activeSideProject = useMemo(() => {
    return projects.find(p => p.id === selectedProjectSideId) || null;
  }, [projects, selectedProjectSideId]);

  const handleCreateProject = async () => {
    if (!newProjectForm.name.trim() || !newProjectForm.clientId) {
      toast('Please provide project name and select a client.', 'warn');
      return;
    }
    try {
      const db = supabase as any;
      const { data: newProj, error: pErr } = await db
        .from('projects')
        .insert({
          name: newProjectForm.name.trim(),
          description: newProjectForm.description.trim() || null,
          status: 'active',
        })
        .select('id')
        .single();

      if (pErr) throw pErr;

      // Link client
      const foundClient = clients.find(c => c.id === newProjectForm.clientId);
      if (foundClient) {
        await db.from('project_clients').insert({
          project_id: newProj.id,
          client_id: foundClient.profile_id,
        });
      }

      // Link manager if selected
      if (newProjectForm.managerId) {
        await db.from('project_managers').insert({
          project_id: newProj.id,
          manager_id: newProjectForm.managerId,
        });
      }

      toast(`Project "${newProjectForm.name}" created.`);
      setCreateProjectDialogOpen(false);
      setNewProjectForm({ name: '', description: '', clientId: '', managerId: '' });
      void loadCoreData();
    } catch (e) {
      toast('Failed to create project.', 'err');
    }
  };

  /* =========================================================================
     TAB 3: CONTRACTS
  ========================================================================= */
  const [contractsList, setContractsList] = useState<any[]>([]);
  const [selectedContractSideId, setSelectedContractSideId] = useState<string | null>(null);
  const [attachContractDialogOpen, setAttachContractDialogOpen] = useState(false);
  const [amendContractDialogOpen, setAmendContractDialogOpen] = useState(false);
  const [contractForm, setContractForm] = useState({
    projectId: '',
    title: '',
    ref: '',
    url: '',
  });
  const [amendUrl, setAmendUrl] = useState('');
  const [contractAcceptances, setContractAcceptances] = useState<any[]>([]);

  const loadContracts = useCallback(async () => {
    try {
      const db = supabase as any;
      const [{ data: cData }, { data: aData }] = await Promise.all([
        db.from('contracts').select('*, projects:project_id(id, name)').order('created_at', { ascending: false }),
        db.from('contract_acceptances').select('*').order('created_at', { ascending: false }),
      ]);
      setContractsList(cData || []);
      setContractAcceptances(aData || []);
    } catch (e) {
      console.error('[AdminClientCenter] Failed to load contracts:', e);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'contracts') {
      void loadContracts();
    }
  }, [activeTab, loadContracts]);

  const activeContract = useMemo(() => {
    return contractsList.find(c => c.id === selectedContractSideId) || null;
  }, [contractsList, selectedContractSideId]);

  const handleAttachContract = async () => {
    if (!contractForm.projectId || !contractForm.title.trim() || !contractForm.url.trim()) {
      toast('Please enter project, title, and valid contract link.', 'warn');
      return;
    }
    try {
      const db = supabase as any;
      const ref = contractForm.ref.trim() || `MSA-IRA-${Date.now().toString().slice(-4)}`;
      const { error } = await db.from('contracts').insert({
        project_id: contractForm.projectId,
        title: contractForm.title.trim(),
        ref,
        version: 'v1',
        url: contractForm.url.trim(),
        status: 'Pending Review',
        assigned_date: new Date().toISOString(),
      });
      if (error) throw error;
      toast('Contract attached and assigned to client.');
      setAttachContractDialogOpen(false);
      setContractForm({ projectId: '', title: '', ref: '', url: '' });
      void loadContracts();
    } catch (e) {
      toast('Failed to attach contract.', 'err');
    }
  };

  const handleAmendContract = async () => {
    if (!activeContract || !amendUrl.trim()) return;
    try {
      const db = supabase as any;
      const currentVerNum = parseInt(activeContract.version.replace('v', ''), 10) || 1;
      const nextVer = `v${currentVerNum + 1}`;

      // 1. If currently accepted, preserve in history
      if (activeContract.status === 'Accepted') {
        await db.from('contract_acceptances').insert({
          contract_id: activeContract.id,
          project_id: activeContract.project_id,
          version: activeContract.version,
          url: activeContract.accepted_url || activeContract.url,
          who: 'Client Representative',
          event: 'Accepted',
          note: 'Superseded by amendment; terms preserved.',
        });
      }

      // 2. Update contract record
      await db
        .from('contracts')
        .update({
          version: nextVer,
          url: amendUrl.trim(),
          status: 'Pending Review',
          assigned_date: new Date().toISOString(),
          accepted_at: null,
          accepted_url: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeContract.id);

      toast(`Contract amended to ${nextVer} and queued for client review.`);
      setAmendContractDialogOpen(false);
      setAmendUrl('');
      void loadContracts();
    } catch (e) {
      toast('Failed to amend contract.', 'err');
    }
  };

  /* =========================================================================
     TAB 4: DELIVERABLES
  ========================================================================= */
  const [deliverablesList, setDeliverablesList] = useState<any[]>([]);
  const [selectedDelivSideId, setSelectedDelivSideId] = useState<string | null>(null);
  const [addDelivDialogOpen, setAddDelivDialogOpen] = useState(false);
  const [delivForm, setDelivForm] = useState({
    number: '',
    name: '',
    desc: '',
    qty: '1',
    due: '',
    deps: '—',
    ref: '—',
    responsibleId: '',
  });

  const loadDeliverables = useCallback(async (projId: string) => {
    if (!projId) return;
    try {
      const db = supabase as any;
      const { data } = await db
        .from('deliverables')
        .select('*')
        .eq('project_id', projId)
        .order('deliverable_number', { ascending: true });
      setDeliverablesList(data || []);
    } catch (e) {
      console.error('[AdminClientCenter] Failed to load deliverables:', e);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'deliverables' && selectedProjectId) {
      void loadDeliverables(selectedProjectId);
    }
  }, [activeTab, selectedProjectId, loadDeliverables]);

  const activeDeliverable = useMemo(() => {
    return deliverablesList.find(d => d.id === selectedDelivSideId) || null;
  }, [deliverablesList, selectedDelivSideId]);

  const handleAddDeliverable = async () => {
    if (!delivForm.name.trim() || !selectedProjectId) {
      toast('Deliverable name is required.', 'warn');
      return;
    }
    try {
      const db = supabase as any;
      const num = delivForm.number.trim() || `D-${String(deliverablesList.length + 1).padStart(3, '0')}`;
      const foundEmp = employees.find(e => e.id === delivForm.responsibleId);
      const { error } = await db.from('deliverables').insert({
        project_id: selectedProjectId,
        deliverable_number: num,
        name: delivForm.name.trim(),
        description: delivForm.desc.trim() || '—',
        quantity: delivForm.qty || '1',
        due_date: delivForm.due || 'TBD',
        dependencies: delivForm.deps || '—',
        reference_url: delivForm.ref || '—',
        responsible_id: delivForm.responsibleId || null,
        responsible_name: foundEmp?.name || 'Project Team',
        status: 'Not Started',
      });
      if (error) throw error;
      toast(`Deliverable ${num} added.`);
      setAddDelivDialogOpen(false);
      setDelivForm({
        number: '',
        name: '',
        desc: '',
        qty: '1',
        due: '',
        deps: '—',
        ref: '—',
        responsibleId: '',
      });
      void loadDeliverables(selectedProjectId);
    } catch (e) {
      toast('Failed to add deliverable.', 'err');
    }
  };

  /* =========================================================================
     TAB 5: CHANGE REQUESTS
  ========================================================================= */
  const [changesList, setChangesList] = useState<any[]>([]);
  const [changesTab, setChangesTab] = useState<'pending' | 'decided'>('pending');
  const [selectedChangeSideId, setSelectedChangeSideId] = useState<string | null>(null);
  const [decisionDialog, setDecisionDialog] = useState<'approve' | 'decline' | null>(null);
  const [decisionComment, setDecisionComment] = useState('');

  const loadChanges = useCallback(async () => {
    try {
      const db = supabase as any;
      const { data } = await db
        .from('change_requests')
        .select('*, deliverables:deliverable_id(id, deliverable_number, name), projects:project_id(id, name)')
        .order('created_at', { ascending: false });
      setChangesList(data || []);
    } catch (e) {
      console.error('[AdminClientCenter] Failed to load changes:', e);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'changes') {
      void loadChanges();
    }
  }, [activeTab, loadChanges]);

  const activeChange = useMemo(() => {
    return changesList.find(c => c.id === selectedChangeSideId) || null;
  }, [changesList, selectedChangeSideId]);

  const pendingChanges = useMemo(() => {
    return changesList.filter(c => c.status === 'Pending Review');
  }, [changesList]);

  const decidedChanges = useMemo(() => {
    return changesList.filter(c => c.status !== 'Pending Review');
  }, [changesList]);

  const handleApplyChangeDecision = async () => {
    if (!activeChange || !decisionDialog) return;
    const isApprove = decisionDialog === 'approve';
    try {
      const db = supabase as any;
      // 1. Update change request record
      await db
        .from('change_requests')
        .update({
          status: isApprove ? 'Approved Change' : 'Change Declined',
          reviewer_name: 'IRA Management',
          reviewer_comment: decisionComment.trim() || (isApprove ? 'Approved.' : 'Declined.'),
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeChange.id);

      // 2. If approved, update deliverable field directly
      if (isApprove && activeChange.deliverable_id) {
        const fieldKeyMap: Record<string, string> = {
          Name: 'name',
          'Description or scope': 'description',
          Quantity: 'quantity',
          Timeline: 'due_date',
          Dependencies: 'dependencies',
          'Links or clarifications': 'reference_url',
        };
        const dbCol = fieldKeyMap[activeChange.field];
        if (dbCol) {
          await db
            .from('deliverables')
            .update({
              [dbCol]: activeChange.requested_value,
              updated_at: new Date().toISOString(),
            })
            .eq('id', activeChange.deliverable_id);
        }
      }

      toast(isApprove ? 'Change request approved and deliverable updated.' : 'Change request declined.');
      setDecisionDialog(null);
      setDecisionComment('');
      setSelectedChangeSideId(null);
      void loadChanges();
    } catch (e) {
      toast('Failed to record decision.', 'err');
    }
  };

  /* =========================================================================
     TAB 6: PAYMENT SCHEDULES
  ========================================================================= */
  const [installmentsList, setInstallmentsList] = useState<any[]>([]);
  const [selectedInstSideId, setSelectedInstSideId] = useState<string | null>(null);
  const [addInstDialogOpen, setAddInstDialogOpen] = useState(false);
  const [verifyPaymentDialogOpen, setVerifyPaymentDialogOpen] = useState(false);
  const [verifyRefInput, setVerifyRefInput] = useState('');
  const [instForm, setInstForm] = useState({
    name: '',
    amount: '',
    due: '',
    basis: '',
  });

  const loadInstallments = useCallback(async (projId: string) => {
    if (!projId) return;
    try {
      const db = supabase as any;
      const { data } = await db
        .from('payment_installments')
        .select('*')
        .eq('project_id', projId)
        .order('installment_number', { ascending: true });
      setInstallmentsList(data || []);
    } catch (e) {
      console.error('[AdminClientCenter] Failed to load installments:', e);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'payments' && selectedProjectId) {
      void loadInstallments(selectedProjectId);
    }
  }, [activeTab, selectedProjectId, loadInstallments]);

  const activeInstallment = useMemo(() => {
    return installmentsList.find(i => i.id === selectedInstSideId) || null;
  }, [installmentsList, selectedInstSideId]);

  const totalInstallmentAmount = useMemo(() => {
    return installmentsList.reduce((acc, i) => acc + Number(i.amount || 0), 0);
  }, [installmentsList]);

  const totalPaidAmount = useMemo(() => {
    return installmentsList
      .filter(i => i.status === 'Paid')
      .reduce((acc, i) => acc + Number(i.amount || 0), 0);
  }, [installmentsList]);

  const nextDueInstallment = useMemo(() => {
    return (
      installmentsList.find(i => ['Due', 'Overdue', 'Pending Verification'].includes(i.status)) ||
      installmentsList.find(i => i.status === 'Upcoming') ||
      null
    );
  }, [installmentsList]);

  const handleAddInstallment = async () => {
    if (!instForm.name.trim() || !instForm.amount || !selectedProjectId) {
      toast('Name and amount are required.', 'warn');
      return;
    }
    try {
      const db = supabase as any;
      const num = installmentsList.length + 1;
      const amt = parseFloat(instForm.amount);
      const basis = instForm.basis.trim() || `${Math.round((amt / (totalInstallmentAmount + amt || 1)) * 100)}%`;
      const { error } = await db.from('payment_installments').insert({
        project_id: selectedProjectId,
        installment_number: num,
        name: instForm.name.trim(),
        basis,
        amount: amt,
        due_date: instForm.due || 'TBD',
        status: 'Upcoming',
      });
      if (error) throw error;
      toast(`Installment ${num} added.`);
      setAddInstDialogOpen(false);
      setInstForm({ name: '', amount: '', due: '', basis: '' });
      void loadInstallments(selectedProjectId);
    } catch (e) {
      toast('Failed to add installment.', 'err');
    }
  };

  const handleRecordVerifiedPayment = async () => {
    if (!activeInstallment) return;
    const finalRef = verifyRefInput.trim() || activeInstallment.payment_reference || `BANK-${Date.now().toString().slice(-6)}`;
    try {
      const db = supabase as any;
      const nowStr = new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date());

      await db
        .from('payment_installments')
        .update({
          status: 'Paid',
          payment_reference: finalRef,
          paid_on: nowStr,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeInstallment.id);

      toast(`Installment ${activeInstallment.installment_number} marked as Paid.`);
      setVerifyPaymentDialogOpen(false);
      setVerifyRefInput('');
      setSelectedInstSideId(null);
      void loadInstallments(selectedProjectId);
    } catch (e) {
      toast('Failed to record payment.', 'err');
    }
  };

  /* =========================================================================
     RENDER
  ========================================================================= */

  return (
    <div className="space-y-6">
      {/* Top Navigation Tabs for Client Work Center */}
      <div className="border-b border-line bg-surface px-4 sm:px-6 pt-2">
        <div className="flex items-center justify-between pb-3 flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">Client Operations & Projects</h1>
            <p className="text-xs text-ink-3 mt-0.5">
              Full lifecycle client directory, contracts, deliverables, change requests, and payments
            </p>
          </div>
          <Button
            size="sm"
            icon={RefreshCw}
            loading={loading}
            onClick={() => void loadCoreData()}
          >
            Refresh
          </Button>
        </div>

        <Tabs
          value={activeTab}
          onChange={t => {
            setActiveTab(t as any);
            setSelectedClientId(null);
          }}
          tabs={[
            { id: 'directory', label: 'Client Directory', count: clients.length },
            { id: 'projects', label: 'Projects', count: projects.length },
            { id: 'contracts', label: 'Contracts' },
            { id: 'deliverables', label: 'Deliverables' },
            { id: 'changes', label: 'Change Requests', count: pendingChanges.length || undefined },
            { id: 'payments', label: 'Payment Schedules' },
          ]}
        />
      </div>

      {/* Main Tab Views */}
      <div className="px-4 sm:px-6">
        {/* ===============================================================
            TAB 1: DIRECTORY
        =============================================================== */}
        {activeTab === 'directory' && (
          <>
            {selectedClientId && selectedClient ? (
              /* Client Detail View */
              <div className="space-y-5 animate-fade-in">
                <button
                  onClick={() => setSelectedClientId(null)}
                  className="text-xs text-ink-3 hover:text-ink font-semibold flex items-center gap-1.5"
                >
                  ← Back to Client Directory
                </button>

                <PageHeader
                  title={selectedClient.company_name}
                  desc={`${selectedClient.primary_contact} · ${selectedClient.email}`}
                  actions={
                    <div className="flex items-center gap-2">
                      <Button
                        icon={UserPlus}
                        onClick={() => {
                          setSelectedMgrId(selectedClient.projects?.[0]?.managerId || '');
                          setAssignMgrDialogOpen(true);
                        }}
                      >
                        Assign Manager
                      </Button>
                      <Button
                        variant="primary"
                        icon={Plus}
                        onClick={() => {
                          setNewProjectForm({
                            name: '',
                            description: '',
                            clientId: selectedClient.id,
                            managerId: selectedClient.projects?.[0]?.managerId || '',
                          });
                          setCreateProjectDialogOpen(true);
                        }}
                      >
                        Create Project
                      </Button>
                    </div>
                  }
                />

                <Tabs
                  value={clientDetailTab}
                  onChange={setClientDetailTab}
                  tabs={[
                    { id: 'overview', label: 'Overview' },
                    { id: 'projects', label: 'Projects', count: selectedClient.projects?.length || 0 },
                    { id: 'access', label: 'Account Access' },
                  ]}
                />

                {clientDetailTab === 'overview' && (
                  <Card>
                    <KV
                      cols={3}
                      items={[
                        ['Primary Contact', selectedClient.primary_contact],
                        ['Login ID / Email', selectedClient.email],
                        ['Assigned Manager', selectedClient.managerName],
                        ['Account Status', <Status key="s" s={selectedClient.status} />],
                        ['Projects Active', String(selectedClient.projectCount)],
                        [
                          'Created On',
                          new Date(selectedClient.created_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          }),
                        ],
                      ]}
                    />
                  </Card>
                )}

                {clientDetailTab === 'projects' && (
                  <DataTable
                    rows={selectedClient.projects || []}
                    empty={
                      <Empty
                        icon={FolderKanban}
                        title="No Projects Assigned"
                        desc="Create a project to initialize scope and deliverables for this client."
                        action={
                          <Button
                            variant="primary"
                            icon={Plus}
                            onClick={() => {
                              setNewProjectForm({
                                name: '',
                                description: '',
                                clientId: selectedClient.id,
                                managerId: '',
                              });
                              setCreateProjectDialogOpen(true);
                            }}
                          >
                            Create Project
                          </Button>
                        }
                      />
                    }
                    cols={[
                      {
                        key: 'name',
                        head: 'Project Name',
                        render: (r: any) => <span className="font-semibold text-ink">{r.name}</span>,
                      },
                      { key: 'managerName', head: 'Manager', render: (r: any) => r.managerName },
                      { key: 'status', head: 'Status', render: (r: any) => <Status s={r.status} /> },
                    ]}
                  />
                )}

                {clientDetailTab === 'access' && (
                  <div className="grid lg:grid-cols-2 gap-5">
                    <Card>
                      <CardHead title="Account Status" />
                      {selectedClient.status === 'active' && (
                        <Alert tone="ok" title="Password Set. Account Active.">
                          The client representative has authenticated and holds active workspace access.
                        </Alert>
                      )}
                      {selectedClient.status === 'invited' && (
                        <Alert title="Invitation Pending">
                          Welcome email was generated. The client has not completed password initialization.
                        </Alert>
                      )}
                      {selectedClient.status === 'inactive' && (
                        <Alert tone="err" title="Access Disabled">
                          Client account is currently deactivated. Sign-in attempts will be rejected.
                        </Alert>
                      )}
                      <div className="flex flex-wrap gap-2 mt-5">
                        <Button
                          icon={RefreshCw}
                          loading={resendingClient === selectedClient.id}
                          onClick={() => handleResendInvitation(selectedClient)}
                        >
                          Resend Invitation Link
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => setToggleAccessDialogOpen(true)}
                        >
                          {selectedClient.status === 'active' ? 'Disable Access' : 'Enable Access'}
                        </Button>
                      </div>
                    </Card>

                    <Card>
                      <CardHead title="Security & Governance" />
                      <Timeline
                        items={[
                          {
                            title: 'Client Record Provisioned',
                            meta: new Date(selectedClient.created_at).toLocaleDateString('en-IN'),
                            tone: 'ok',
                          },
                          {
                            title: 'Scoped RLS Active',
                            meta: 'Row-Level Security isolated to client UUID',
                            tone: 'ok',
                          },
                        ]}
                      />
                    </Card>
                  </div>
                )}
              </div>
            ) : (
              /* Client Directory List */
              <div className="space-y-4">
                <FilterBar>
                  <SearchField
                    value={clientSearch}
                    onChange={setClientSearch}
                    placeholder="Search client or primary contact"
                    className="w-full sm:w-72"
                  />
                  <Select
                    value={clientStatusFilter}
                    onChange={e => setClientStatusFilter(e.target.value)}
                    className="w-full sm:w-40"
                  >
                    <option value="All">All statuses</option>
                    <option value="active">Active</option>
                    <option value="invited">Invited</option>
                    <option value="inactive">Inactive</option>
                  </Select>
                  <div className="flex-1" />
                  <Button
                    variant="primary"
                    icon={Plus}
                    onClick={() => setShowCreateClientModal(true)}
                  >
                    Create client
                  </Button>
                </FilterBar>

                <DataTable
                  rows={filteredClients}
                  onRow={r => setSelectedClientId(r.id)}
                  empty={
                    <Empty
                      icon={Building2}
                      title="No clients found"
                      desc="Create your first client account to invite client stakeholders."
                      action={
                        <Button
                          variant="primary"
                          icon={Plus}
                          onClick={() => setShowCreateClientModal(true)}
                        >
                          Create client
                        </Button>
                      }
                    />
                  }
                  cols={[
                    {
                      key: 'company',
                      head: 'Client / Company',
                      render: (r: any) => (
                        <div>
                          <div className="font-semibold text-ink">{r.company_name}</div>
                          <div className="text-xs text-ink-3">
                            {r.primary_contact} · {r.email}
                          </div>
                        </div>
                      ),
                    },
                    { key: 'manager', head: 'Manager', render: (r: any) => r.managerName },
                    { key: 'projects', head: 'Projects', align: 'center', render: (r: any) => r.projectCount },
                    { key: 'status', head: 'Account Status', render: (r: any) => <Status s={r.status} /> },
                  ]}
                />
              </div>
            )}
          </>
        )}

        {/* ===============================================================
            TAB 2: PROJECTS
        =============================================================== */}
        {activeTab === 'projects' && (
          <div className="space-y-4">
            <FilterBar>
              <div className="flex-1" />
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => {
                  setNewProjectForm({
                    name: '',
                    description: '',
                    clientId: clients[0]?.id || '',
                    managerId: '',
                  });
                  setCreateProjectDialogOpen(true);
                }}
              >
                Create Project
              </Button>
            </FilterBar>

            <DataTable
              rows={projects}
              onRow={r => setSelectedProjectSideId(r.id)}
              empty={
                <Empty
                  icon={FolderKanban}
                  title="No projects configured"
                  desc="Create a project and link it to an authorized client."
                />
              }
              cols={[
                {
                  key: 'name',
                  head: 'Project',
                  render: (r: any) => (
                    <div>
                      <div className="font-semibold text-ink">{r.name}</div>
                      <div className="text-xs text-ink-3">{r.clientName}</div>
                    </div>
                  ),
                },
                { key: 'manager', head: 'Manager', render: (r: any) => r.managerName },
                { key: 'status', head: 'Status', render: (r: any) => <Status s={r.status} /> },
                {
                  key: 'created',
                  head: 'Created',
                  render: (r: any) =>
                    new Date(r.created_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    }),
                },
              ]}
            />

            <SidePanel
              open={!!activeSideProject}
              onClose={() => setSelectedProjectSideId(null)}
              title={activeSideProject?.name || ''}
              sub={activeSideProject ? `${activeSideProject.clientName} · ${activeSideProject.managerName}` : ''}
            >
              {activeSideProject && (
                <div className="space-y-5">
                  <Status s={activeSideProject.status} />
                  <p className="text-xs text-ink-2 leading-relaxed">
                    {activeSideProject.description || 'No description provided.'}
                  </p>
                  <KV
                    items={[
                      ['Client Company', activeSideProject.clientName],
                      ['Assigned Manager', activeSideProject.managerName],
                      [
                        'Created',
                        new Date(activeSideProject.created_at).toLocaleDateString('en-IN'),
                      ],
                    ]}
                  />
                  <div className="pt-4 border-t border-line space-y-2">
                    <Button
                      className="w-full justify-between"
                      onClick={() => {
                        setSelectedProjectId(activeSideProject.id);
                        setActiveTab('deliverables');
                        setSelectedProjectSideId(null);
                      }}
                    >
                      <span>View Deliverables</span>
                      <ArrowRight size={14} />
                    </Button>
                    <Button
                      className="w-full justify-between"
                      onClick={() => {
                        setSelectedProjectId(activeSideProject.id);
                        setActiveTab('payments');
                        setSelectedProjectSideId(null);
                      }}
                    >
                      <span>Payment Schedule</span>
                      <ArrowRight size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </SidePanel>
          </div>
        )}

        {/* ===============================================================
            TAB 3: CONTRACTS
        =============================================================== */}
        {activeTab === 'contracts' && (
          <div className="space-y-4">
            <FilterBar>
              <div className="flex-1" />
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => {
                  setContractForm({
                    projectId: projects[0]?.id || '',
                    title: '',
                    ref: '',
                    url: '',
                  });
                  setAttachContractDialogOpen(true);
                }}
              >
                Attach Contract URL
              </Button>
            </FilterBar>

            <DataTable
              rows={contractsList}
              onRow={r => setSelectedContractSideId(r.id)}
              empty={
                <Empty
                  icon={FileSignature}
                  title="No contracts attached"
                  desc="Attach a contract URL (e.g. Google Drive) to invite client sign-off."
                />
              }
              cols={[
                {
                  key: 'title',
                  head: 'Contract',
                  render: (r: any) => (
                    <div>
                      <div className="font-semibold text-ink">{r.title}</div>
                      <div className="text-xs text-ink-3">
                        {r.projects?.name} · {r.ref}
                      </div>
                    </div>
                  ),
                },
                { key: 'version', head: 'Version', render: (r: any) => r.version },
                { key: 'status', head: 'Status', render: (r: any) => <Status s={r.status} /> },
                {
                  key: 'acceptedAt',
                  head: 'Accepted At',
                  render: (r: any) =>
                    r.accepted_at
                      ? new Date(r.accepted_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '—',
                },
              ]}
            />

            <SidePanel
              open={!!activeContract && !amendContractDialogOpen}
              onClose={() => setSelectedContractSideId(null)}
              title={activeContract?.title || ''}
              sub={activeContract ? `${activeContract.ref} · ${activeContract.version}` : ''}
              footer={
                <Button
                  icon={Pencil}
                  onClick={() => {
                    setAmendUrl(activeContract?.url || '');
                    setAmendContractDialogOpen(true);
                  }}
                >
                  Amend Contract
                </Button>
              }
            >
              {activeContract && (
                <div className="space-y-5">
                  <Status s={activeContract.status} />
                  <KV
                    cols={1}
                    items={[
                      [
                        'Contract Link',
                        <LinkRef key="link" url={activeContract.url} label={activeContract.url} />,
                      ],
                      [
                        'Accepted At',
                        activeContract.accepted_at
                          ? new Date(activeContract.accepted_at).toLocaleString('en-IN')
                          : 'Not yet accepted',
                      ],
                    ]}
                  />

                  <div>
                    <h3 className="text-[13px] font-semibold mb-3">Acceptance History</h3>
                    <Timeline
                      items={contractAcceptances
                        .filter(a => a.contract_id === activeContract.id)
                        .map(a => ({
                          tone: 'ok' as const,
                          title: `${a.version} accepted`,
                          meta: `${a.who} · ${new Date(a.created_at).toLocaleDateString('en-IN')}`,
                          body: a.note,
                        }))}
                    />
                  </div>
                </div>
              )}
            </SidePanel>
          </div>
        )}

        {/* ===============================================================
            TAB 4: DELIVERABLES
        =============================================================== */}
        {activeTab === 'deliverables' && (
          <div className="space-y-4">
            <FilterBar>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-3">Project:</span>
                <Select
                  value={selectedProjectId}
                  onChange={e => setSelectedProjectId(e.target.value)}
                  className="w-64"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.clientName})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex-1" />
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => setAddDelivDialogOpen(true)}
              >
                Add Deliverable
              </Button>
            </FilterBar>

            <DataTable
              rows={deliverablesList}
              onRow={r => setSelectedDelivSideId(r.id)}
              empty={
                <Empty
                  icon={Package}
                  title="No deliverables configured"
                  desc="Add deliverables to define the project scope for the client."
                />
              }
              cols={[
                {
                  key: 'num',
                  head: 'No.',
                  render: (r: any) => <span className="font-mono text-xs">{r.deliverable_number}</span>,
                },
                {
                  key: 'name',
                  head: 'Deliverable',
                  render: (r: any) => (
                    <div>
                      <div className="font-medium text-ink">{r.name}</div>
                      <div className="text-xs text-ink-3 truncate max-w-xs">{r.description}</div>
                    </div>
                  ),
                },
                { key: 'qty', head: 'Qty', align: 'center', render: (r: any) => r.quantity },
                { key: 'due', head: 'Timeline', render: (r: any) => r.due_date },
                { key: 'owner', head: 'Responsible', render: (r: any) => r.responsible_name },
                { key: 'status', head: 'Status', render: (r: any) => <Status s={r.status} /> },
              ]}
            />

            <SidePanel
              open={!!activeDeliverable}
              onClose={() => setSelectedDelivSideId(null)}
              title={activeDeliverable ? `${activeDeliverable.deliverable_number} · ${activeDeliverable.name}` : ''}
            >
              {activeDeliverable && (
                <div className="space-y-5">
                  <Status s={activeDeliverable.status} />
                  <p className="text-xs text-ink-2 leading-relaxed">{activeDeliverable.description}</p>
                  <KV
                    cols={2}
                    items={[
                      ['Quantity', activeDeliverable.quantity],
                      ['Timeline', activeDeliverable.due_date],
                      ['Dependencies', activeDeliverable.dependencies],
                      ['Responsible', activeDeliverable.responsible_name],
                    ]}
                  />
                </div>
              )}
            </SidePanel>
          </div>
        )}

        {/* ===============================================================
            TAB 5: CHANGE REQUESTS
        =============================================================== */}
        {activeTab === 'changes' && (
          <div className="space-y-4">
            <Tabs
              value={changesTab}
              onChange={t => setChangesTab(t as any)}
              tabs={[
                { id: 'pending', label: 'Pending Review', count: pendingChanges.length },
                { id: 'decided', label: 'Decided', count: decidedChanges.length },
              ]}
            />

            <DataTable
              rows={changesTab === 'pending' ? pendingChanges : decidedChanges}
              onRow={r => setSelectedChangeSideId(r.id)}
              empty={
                <Empty
                  icon={CheckCircle2}
                  title="All caught up"
                  desc="No change requests waiting in this queue."
                />
              }
              cols={[
                {
                  key: 'req',
                  head: 'Request #',
                  render: (r: any) => <span className="font-mono text-xs">{r.request_number}</span>,
                },
                {
                  key: 'del',
                  head: 'Deliverable',
                  render: (r: any) => (
                    <div>
                      <div className="font-medium text-ink">
                        {r.deliverables?.deliverable_number} · {r.deliverables?.name}
                      </div>
                      <div className="text-xs text-ink-3">{r.projects?.name}</div>
                    </div>
                  ),
                },
                { key: 'field', head: 'Field Changed', render: (r: any) => r.field },
                {
                  key: 'val',
                  head: 'Requested Value',
                  render: (r: any) => (
                    <span className="text-xs font-semibold text-primary">{r.requested_value}</span>
                  ),
                },
                { key: 'by', head: 'Requested By', render: (r: any) => r.requested_by_name },
                { key: 'status', head: 'Status', render: (r: any) => <Status s={r.status} /> },
              ]}
            />

            <SidePanel
              open={!!activeChange && !decisionDialog}
              onClose={() => setSelectedChangeSideId(null)}
              title={activeChange ? `${activeChange.request_number} · ${activeChange.field}` : ''}
              sub={activeChange?.projects?.name}
              footer={
                activeChange?.status === 'Pending Review' ? (
                  <div className="flex gap-2">
                    <Button variant="danger" onClick={() => setDecisionDialog('decline')}>
                      Decline
                    </Button>
                    <Button variant="primary" onClick={() => setDecisionDialog('approve')}>
                      Approve Change
                    </Button>
                  </div>
                ) : undefined
              }
            >
              {activeChange && (
                <div className="space-y-5">
                  <Status s={activeChange.status} />
                  <div className="border border-line rounded-lg divide-y divide-line">
                    <div className="p-3">
                      <div className="text-xs text-ink-3 mb-1">Previous Value</div>
                      <div className="text-xs text-ink-2">{activeChange.previous_value || '—'}</div>
                    </div>
                    <div className="p-3 bg-primary-soft/40">
                      <div className="text-xs text-primary font-bold mb-1">Requested Value</div>
                      <div className="text-xs font-semibold text-ink">
                        {activeChange.requested_value}
                      </div>
                    </div>
                  </div>

                  <KV
                    cols={1}
                    items={[
                      ['Requested by', activeChange.requested_by_name],
                      ['Reason for request', activeChange.reason || 'No reason provided'],
                      [
                        'Submitted',
                        new Date(activeChange.created_at).toLocaleDateString('en-IN'),
                      ],
                    ]}
                  />

                  {activeChange.reviewer_comment && (
                    <Alert
                      tone={activeChange.status === 'Approved Change' ? 'ok' : 'err'}
                      title={`Decision by ${activeChange.reviewer_name}`}
                    >
                      {activeChange.reviewer_comment}
                    </Alert>
                  )}
                </div>
              )}
            </SidePanel>
          </div>
        )}

        {/* ===============================================================
            TAB 6: PAYMENTS
        =============================================================== */}
        {activeTab === 'payments' && (
          <div className="space-y-5">
            <FilterBar>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-3">Project:</span>
                <Select
                  value={selectedProjectId}
                  onChange={e => setSelectedProjectId(e.target.value)}
                  className="w-64"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.clientName})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex-1" />
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => setAddInstDialogOpen(true)}
              >
                Add Installment
              </Button>
            </FilterBar>

            {/* Payment Summary Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat
                label="Total Schedule Amount"
                value={inr(totalInstallmentAmount)}
                sub={`${installmentsList.length} installments`}
              />
              <Stat
                label="Verified Paid"
                value={inr(totalPaidAmount)}
                sub="Bank verified"
              />
              <Stat
                label="Remaining Balance"
                value={inr(totalInstallmentAmount - totalPaidAmount)}
              />
              <Stat
                label={nextDueInstallment?.status === 'Pending Verification' ? 'Awaiting Verification' : 'Next Due'}
                value={nextDueInstallment ? inr(nextDueInstallment.amount) : '—'}
                sub={nextDueInstallment ? `${nextDueInstallment.name} · ${nextDueInstallment.due_date}` : ''}
                tone={nextDueInstallment?.status === 'Pending Verification' ? 'warn' : undefined}
              />
            </div>

            <DataTable
              rows={installmentsList}
              onRow={r => setSelectedInstSideId(r.id)}
              empty={
                <Empty
                  icon={CreditCard}
                  title="No payment installments"
                  desc="Configure installment milestones for this project."
                />
              }
              cols={[
                {
                  key: 'num',
                  head: '#',
                  render: (r: any) => <span className="font-mono text-xs">{r.installment_number}</span>,
                },
                {
                  key: 'name',
                  head: 'Installment Name',
                  render: (r: any) => (
                    <div>
                      <div className="font-semibold text-ink">{r.name}</div>
                      <div className="text-xs text-ink-3">{r.basis} of project amount</div>
                    </div>
                  ),
                },
                { key: 'amount', head: 'Amount', align: 'right', render: (r: any) => inr(r.amount) },
                { key: 'due', head: 'Due Date', render: (r: any) => r.due_date },
                { key: 'status', head: 'Status', render: (r: any) => <Status s={r.status} /> },
                { key: 'ref', head: 'Reference', render: (r: any) => r.payment_reference || '—' },
              ]}
            />

            <SidePanel
              open={!!activeInstallment && !verifyPaymentDialogOpen}
              onClose={() => setSelectedInstSideId(null)}
              title={activeInstallment?.name || ''}
              sub={activeInstallment ? `Installment #${activeInstallment.installment_number}` : ''}
              footer={
                activeInstallment && activeInstallment.status !== 'Paid' ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setVerifyRefInput(activeInstallment.payment_reference || '');
                      setVerifyPaymentDialogOpen(true);
                    }}
                  >
                    Record Verified Payment
                  </Button>
                ) : undefined
              }
            >
              {activeInstallment && (
                <div className="space-y-5">
                  <Status s={activeInstallment.status} />
                  <KV
                    items={[
                      ['Amount', inr(activeInstallment.amount)],
                      ['Share', activeInstallment.basis],
                      ['Due Date', activeInstallment.due_date],
                      ['Payment Reference', activeInstallment.payment_reference || '—'],
                      ['Paid On', activeInstallment.paid_on || '—'],
                    ]}
                  />
                  {activeInstallment.status === 'Paid' && (
                    <Alert tone="ok" title="Verified in Bank Account">
                      This installment was verified against bank receipt records.
                    </Alert>
                  )}
                </div>
              )}
            </SidePanel>
          </div>
        )}
      </div>

      {/* ===============================================================
          MODALS AND DIALOGS
      =============================================================== */}

      {/* Add Client Modal */}
      {showCreateClientModal && (
        <ClientCreationModal
          employees={employees}
          onClose={() => setShowCreateClientModal(false)}
          onCreated={() => {
            setShowCreateClientModal(false);
            void loadCoreData();
          }}
        />
      )}

      {/* Create Project Dialog */}
      <Dialog
        open={createProjectDialogOpen}
        onClose={() => setCreateProjectDialogOpen(false)}
        title="Create New Project"
        desc="Attach the project to an active client and assign a project manager."
        footer={
          <>
            <Button onClick={() => setCreateProjectDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleCreateProject}>
              Create Project
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Project Name" required>
            <Input
              value={newProjectForm.name}
              onChange={e => setNewProjectForm({ ...newProjectForm, name: e.target.value })}
              placeholder="e.g. Mobile App Redesign"
            />
          </Field>
          <Field label="Client" required>
            <Select
              value={newProjectForm.clientId}
              onChange={e => setNewProjectForm({ ...newProjectForm, clientId: e.target.value })}
            >
              <option value="">Select client...</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.company_name} ({c.primary_contact})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assign Manager">
            <Select
              value={newProjectForm.managerId}
              onChange={e => setNewProjectForm({ ...newProjectForm, managerId: e.target.value })}
            >
              <option value="">Unassigned</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.designation || 'Staff'})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description (Optional)">
            <Textarea
              value={newProjectForm.description}
              onChange={e => setNewProjectForm({ ...newProjectForm, description: e.target.value })}
              placeholder="Scope and high-level milestones..."
            />
          </Field>
        </div>
      </Dialog>

      {/* Attach Contract Dialog */}
      <Dialog
        open={attachContractDialogOpen}
        onClose={() => setAttachContractDialogOpen(false)}
        title="Attach Contract URL"
        desc="Contracts are referenced as secure external links (e.g. Google Drive / DocuSign)."
        footer={
          <>
            <Button onClick={() => setAttachContractDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleAttachContract}>
              Attach Contract
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Project" required>
            <Select
              value={contractForm.projectId}
              onChange={e => setContractForm({ ...contractForm, projectId: e.target.value })}
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.clientName})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contract Title" required>
            <Input
              value={contractForm.title}
              onChange={e => setContractForm({ ...contractForm, title: e.target.value })}
              placeholder="Master Services Agreement"
            />
          </Field>
          <Field label="Contract Ref (Optional)">
            <Input
              value={contractForm.ref}
              onChange={e => setContractForm({ ...contractForm, ref: e.target.value })}
              placeholder="e.g. MSA-IRA-2026-001"
            />
          </Field>
          <Field label="Contract URL" required hint="Shareable link accessible to the client.">
            <Input
              value={contractForm.url}
              onChange={e => setContractForm({ ...contractForm, url: e.target.value })}
              placeholder="https://drive.google.com/file/..."
            />
          </Field>
        </div>
      </Dialog>

      {/* Amend Contract Dialog */}
      <Dialog
        open={amendContractDialogOpen}
        onClose={() => setAmendContractDialogOpen(false)}
        title="Amend Contract"
        desc={`Creating an amendment advances the contract version. The previous accepted version remains permanently on record in the acceptance history.`}
        footer={
          <>
            <Button onClick={() => setAmendContractDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleAmendContract}>
              Save Amendment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="New Contract URL" required hint="Paste updated contract document link.">
            <Input
              value={amendUrl}
              onChange={e => setAmendUrl(e.target.value)}
              placeholder="https://drive.google.com/..."
            />
          </Field>
        </div>
      </Dialog>

      {/* Add Deliverable Dialog */}
      <Dialog
        open={addDelivDialogOpen}
        onClose={() => setAddDelivDialogOpen(false)}
        title="Add Deliverable"
        desc="Define a new deliverable item for client review and tracking."
        footer={
          <>
            <Button onClick={() => setAddDelivDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleAddDeliverable}>
              Add Deliverable
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Deliverable Name" required>
            <Input
              value={delivForm.name}
              onChange={e => setDelivForm({ ...delivForm, name: e.target.value })}
              placeholder="e.g. Frontend Architecture"
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={delivForm.desc}
              onChange={e => setDelivForm({ ...delivForm, desc: e.target.value })}
              placeholder="Scope details and expected output..."
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <Input
                value={delivForm.qty}
                onChange={e => setDelivForm({ ...delivForm, qty: e.target.value })}
              />
            </Field>
            <Field label="Due Date">
              <Input
                value={delivForm.due}
                onChange={e => setDelivForm({ ...delivForm, due: e.target.value })}
                placeholder="e.g. 15 Nov 2026"
              />
            </Field>
          </div>
          <Field label="Responsible Employee">
            <Select
              value={delivForm.responsibleId}
              onChange={e => setDelivForm({ ...delivForm, responsibleId: e.target.value })}
            >
              <option value="">Unassigned</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>

      {/* Decision on Change Request Dialog */}
      <Dialog
        open={!!decisionDialog}
        onClose={() => setDecisionDialog(null)}
        tone={decisionDialog === 'decline' ? 'danger' : undefined}
        title={decisionDialog === 'approve' ? 'Approve Change Request?' : 'Decline Change Request?'}
        desc={
          decisionDialog === 'approve'
            ? 'Approving will immediately update the deliverable to the requested value. Previous terms stay in history.'
            : 'Declining leaves the deliverable unchanged. The client will be notified.'
        }
        footer={
          <>
            <Button onClick={() => setDecisionDialog(null)}>Cancel</Button>
            <Button
              variant={decisionDialog === 'approve' ? 'primary' : 'danger'}
              onClick={handleApplyChangeDecision}
            >
              {decisionDialog === 'approve' ? 'Approve' : 'Decline'}
            </Button>
          </>
        }
      >
        <Field label="Comment to Client (Optional)">
          <Textarea
            value={decisionComment}
            onChange={e => setDecisionComment(e.target.value)}
            placeholder="Add explanation or feedback..."
          />
        </Field>
      </Dialog>

      {/* Add Installment Dialog */}
      <Dialog
        open={addInstDialogOpen}
        onClose={() => setAddInstDialogOpen(false)}
        title="Add Payment Installment"
        desc="Schedule a payment milestone with amount and due date."
        footer={
          <>
            <Button onClick={() => setAddInstDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleAddInstallment}>
              Save Installment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Installment / Milestone Name" required>
            <Input
              value={instForm.name}
              onChange={e => setInstForm({ ...instForm, name: e.target.value })}
              placeholder="e.g. Phase 1 Completion"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)" required>
              <Input
                type="number"
                value={instForm.amount}
                onChange={e => setInstForm({ ...instForm, amount: e.target.value })}
                placeholder="250000"
              />
            </Field>
            <Field label="Due Date" required>
              <Input
                value={instForm.due}
                onChange={e => setInstForm({ ...instForm, due: e.target.value })}
                placeholder="e.g. 10 Nov 2026"
              />
            </Field>
          </div>
          <Field label="Share / Basis (Optional)">
            <Input
              value={instForm.basis}
              onChange={e => setInstForm({ ...instForm, basis: e.target.value })}
              placeholder="e.g. 25% on contract sign-off"
            />
          </Field>
        </div>
      </Dialog>

      {/* Record Verified Payment Dialog */}
      <Dialog
        open={verifyPaymentDialogOpen}
        onClose={() => setVerifyPaymentDialogOpen(false)}
        title="Record Verified Bank Payment?"
        desc={`Confirm receipt of ${inr(activeInstallment?.amount || 0)} for "${activeInstallment?.name}".`}
        footer={
          <>
            <Button onClick={() => setVerifyPaymentDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleRecordVerifiedPayment}>
              Confirm and Mark as Paid
            </Button>
          </>
        }
      >
        <Field label="Bank Transaction Reference / UTR" required>
          <Input
            value={verifyRefInput}
            onChange={e => setVerifyRefInput(e.target.value)}
            placeholder="e.g. NEFT-99218204 or UTR-2026"
          />
        </Field>
      </Dialog>

      {/* Assign Manager to Client Projects Dialog */}
      <Dialog
        open={assignMgrDialogOpen}
        onClose={() => setAssignMgrDialogOpen(false)}
        title="Assign Project Manager"
        desc="Selected manager will oversee projects for this client."
        footer={
          <>
            <Button onClick={() => setAssignMgrDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleAssignManagerToClientProjects}>
              Assign Manager
            </Button>
          </>
        }
      >
        <Field label="Select Employee">
          <Select value={selectedMgrId} onChange={e => setSelectedMgrId(e.target.value)}>
            <option value="">Select manager...</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.designation || 'Staff'})
              </option>
            ))}
          </Select>
        </Field>
      </Dialog>

      {/* Toggle Client Access Dialog */}
      <Dialog
        open={toggleAccessDialogOpen}
        onClose={() => setToggleAccessDialogOpen(false)}
        tone="danger"
        title={selectedClient?.status === 'active' ? 'Disable Client Access?' : 'Enable Client Access?'}
        desc="Historical records and logs are preserved. Disabled clients cannot sign in to the portal."
        footer={
          <>
            <Button onClick={() => setToggleAccessDialogOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleToggleClientAccess}>
              Confirm
            </Button>
          </>
        }
      />
    </div>
  );
};
