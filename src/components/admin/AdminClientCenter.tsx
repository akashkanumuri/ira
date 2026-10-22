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
import { ProjectOperations } from './ProjectOperations';
import { errorMessage } from '../../lib/sigma';
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
  const [activeTab, setActiveTab] = useState<'directory' | 'projects' | 'workspace'>('directory');

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
      const [{ data: cData, error: cErr }, { data: pData, error: pErr }, { data: pmData, error: pmErr }] = await Promise.all([
        db.from('clients').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
        db.from('projects').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
        db.from('project_managers').select('*, employees:manager_id(id, name, work_email)'),
      ]);
      const loadErr = cErr || pErr || pmErr;
      if (loadErr) throw loadErr;

      const projectManagerMap: Record<string, { id: string; name: string }> = {};
      (pmData || []).forEach((pm: any) => {
        if (pm.employees) {
          projectManagerMap[pm.project_id] = { id: pm.manager_id, name: pm.employees.name };
        }
      });

      const projectClientMap: Record<string, { id: string; name: string }> = {};
      (pData || []).forEach((p: any) => {
        const foundClient = (cData || []).find((c: any) => c.id === p.client_id);
        if (foundClient) projectClientMap[p.id] = { id: foundClient.id, name: foundClient.company_name };
      });

      const enrichedProjects = (pData || []).map((p: any) => ({
        ...p,
        clientName: projectClientMap[p.id]?.name || 'Unassigned',
        clientId: projectClientMap[p.id]?.id || null,
        managerName: projectManagerMap[p.id]?.name || 'Unassigned',
        managerId: projectManagerMap[p.id]?.id || null,
      }));

      const enrichedClients = (cData || []).map((c: any) => {
        const assignedProjs = enrichedProjects.filter((p: any) => p.client_id === c.id);
        const firstMgr = assignedProjs[0]?.managerName || '—';
        return {
          ...c,
          projectCount: assignedProjs.length,
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
      toast(errorMessage(err), 'err');
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
      toast(errorMessage(e), 'err');
    }
  };

  const handleAssignManagerToClientProjects = async () => {
    if (!selectedClient || !selectedMgrId) return;
    try {
      const db = supabase as any;
      const clientProjs = selectedClient.projects || [];
      for (const p of clientProjs) {
        const { error } = await db.from('project_managers').upsert({
          project_id: p.id,
          manager_id: selectedMgrId,
        });
        if (error) throw error;
      }
      toast('Manager assigned to client project(s).');
      setAssignMgrDialogOpen(false);
      void loadCoreData();
    } catch (e) {
      toast(errorMessage(e), 'err');
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
      const foundClient = clients.find(c => c.id === newProjectForm.clientId);
      const { data: newProj, error: pErr } = await db
        .from('projects')
        .insert({
          name: newProjectForm.name.trim(),
          description: newProjectForm.description.trim() || null,
          status: 'active',
          client_id: newProjectForm.clientId,
        })
        .select('id')
        .single();
      if (pErr) throw pErr;

      // Legacy link kept for older reports; projects.client_id is authoritative.
      if (foundClient) {
        const { error } = await db.from('project_clients').insert({ project_id: newProj.id, client_id: foundClient.profile_id });
        if (error) throw error;
      }
      if (newProjectForm.managerId) {
        const { error } = await db.from('project_managers').insert({ project_id: newProj.id, manager_id: newProjectForm.managerId });
        if (error) throw error;
      }

      toast(`Project "${newProjectForm.name}" created.`);
      setCreateProjectDialogOpen(false);
      setNewProjectForm({ name: '', description: '', clientId: '', managerId: '' });
      setSelectedProjectId(newProj.id);
      void loadCoreData();
    } catch (e) {
      toast(errorMessage(e), 'err');
    }
  };

  const workspaceProject = useMemo(
    () => projects.find(p => p.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

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
              Clients, projects, contracts, deliverables, modifications, dependencies and billing
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
            { id: 'workspace', label: 'Project Workspace' },
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
                        setActiveTab('workspace');
                        setSelectedProjectSideId(null);
                      }}
                    >
                      <span>Open project workspace</span>
                      <ArrowRight size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </SidePanel>
          </div>
        )}

        {/* ===============================================================
            PROJECT WORKSPACE (contract → deliverables → billing)
        =============================================================== */}
        {activeTab === 'workspace' && (
          <div className="space-y-4">
            {projects.length === 0 ? (
              <Card pad={false}>
                <Empty icon={FolderKanban} title="No projects yet" desc="Create a client and a project first." />
              </Card>
            ) : (
              <>
                <FilterBar>
                  <Select
                    value={selectedProjectId}
                    onChange={e => setSelectedProjectId(e.target.value)}
                    className="w-full sm:w-80"
                    aria-label="Project"
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.clientName}
                      </option>
                    ))}
                  </Select>
                </FilterBar>
                {workspaceProject && (
                  <ProjectOperations
                    key={workspaceProject.id}
                    projectId={workspaceProject.id}
                    projectName={workspaceProject.name}
                    clientId={workspaceProject.client_id ?? null}
                    employees={employees.map(e => ({ id: e.id, name: e.name, designation: e.designation, status: e.status }))}
                    mode="admin"
                  />
                )}
              </>
            )}
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
