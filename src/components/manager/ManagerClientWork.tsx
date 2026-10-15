import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Employee } from '../../types/attendance';
import type { AuthUser } from '../../contexts/AuthContext';
import {
  FolderKanban,
  Package,
  GitPullRequest,
  TrendingUp,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  Pencil,
  FileText,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
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
  Progress,
  Select,
  SidePanel,
  Stat,
  Status,
  Tabs,
  Textarea,
  Timeline,
  useToast,
  ToastProvider,
} from '../client/ClientUI';

interface Props {
  user: AuthUser;
  employees: Employee[];
}

export const ManagerClientWork: React.FC<Props> = ({ user, employees }) => {
  return (
    <ToastProvider>
      <ManagerClientWorkInternal user={user} employees={employees} />
    </ToastProvider>
  );
};

const ManagerClientWorkInternal: React.FC<Props> = ({ user, employees }) => {
  const toast = useToast();
  const [tab, setTab] = useState<'projects' | 'deliverables' | 'changes' | 'progress'>('projects');

  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  /* ---------- Load Manager's Assigned Projects ---------- */
  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const db = supabase as any;
      // Fetch project_managers for this employee
      const empId = user.employeeDbId;
      let pQuery = db.from('projects').select('*').order('created_at', { ascending: false });

      if (empId) {
        const { data: pmList } = await db
          .from('project_managers')
          .select('project_id')
          .eq('manager_id', empId);
        const pIds = (pmList || []).map((pm: any) => pm.project_id);
        if (pIds.length > 0) {
          pQuery = pQuery.in('id', pIds);
        } else {
          setProjects([]);
          setLoading(false);
          return;
        }
      }

      const [{ data: pData }, { data: pcData }, { data: cData }] = await Promise.all([
        pQuery,
        db.from('project_clients').select('*'),
        db.from('clients').select('id, profile_id, company_name'),
      ]);

      const clientMap: Record<string, string> = {};
      (pcData || []).forEach((pc: any) => {
        const found = (cData || []).find((c: any) => c.profile_id === pc.client_id);
        if (found) clientMap[pc.project_id] = found.company_name;
      });

      const enriched = (pData || []).map((p: any) => ({
        ...p,
        clientName: clientMap[p.id] || 'Client Organization',
      }));

      setProjects(enriched);
      if (enriched.length > 0 && !selectedProjectId) {
        setSelectedProjectId(enriched[0].id);
      }
    } catch (e) {
      console.error('[ManagerClientWork] Failed to load projects:', e);
    } finally {
      setLoading(false);
    }
  }, [user.employeeDbId, selectedProjectId]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const selectedProject = useMemo(() => {
    return projects.find(p => p.id === selectedProjectId) || projects[0] || null;
  }, [projects, selectedProjectId]);

  /* =========================================================================
     TAB 2: DELIVERABLES
  ========================================================================= */
  const [deliverables, setDeliverables] = useState<any[]>([]);
  const [selectedDelivId, setSelectedDelivId] = useState<string | null>(null);
  const [addDelivDialogOpen, setAddDelivDialogOpen] = useState(false);
  const [delivForm, setDelivForm] = useState({
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
      setDeliverables(data || []);
    } catch (e) {
      console.error('[ManagerClientWork] Failed to load deliverables:', e);
    }
  }, []);

  useEffect(() => {
    if (tab === 'deliverables' && selectedProjectId) {
      void loadDeliverables(selectedProjectId);
    }
  }, [tab, selectedProjectId, loadDeliverables]);

  const activeDeliverable = useMemo(() => {
    return deliverables.find(d => d.id === selectedDelivId) || null;
  }, [deliverables, selectedDelivId]);

  const handleAddDeliverable = async () => {
    if (!delivForm.name.trim() || !selectedProjectId) {
      toast('Name is required.', 'warn');
      return;
    }
    try {
      const db = supabase as any;
      const num = `D-${String(deliverables.length + 1).padStart(3, '0')}`;
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
        responsible_name: foundEmp?.name || user.name || 'Team',
        status: 'Not Started',
      });
      if (error) throw error;
      toast(`Deliverable ${num} added.`);
      setAddDelivDialogOpen(false);
      setDelivForm({ name: '', desc: '', qty: '1', due: '', deps: '—', ref: '—', responsibleId: '' });
      void loadDeliverables(selectedProjectId);
    } catch (e) {
      toast('Failed to add deliverable.', 'err');
    }
  };

  /* =========================================================================
     TAB 3: CHANGE REQUESTS
  ========================================================================= */
  const [changesList, setChangesList] = useState<any[]>([]);
  const [changesTab, setChangesTab] = useState<'pending' | 'decided'>('pending');
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [decisionDialog, setDecisionDialog] = useState<'approve' | 'decline' | null>(null);
  const [decisionComment, setDecisionComment] = useState('');

  const loadChanges = useCallback(async () => {
    try {
      const db = supabase as any;
      const projIds = projects.map(p => p.id);
      if (projIds.length === 0) {
        setChangesList([]);
        return;
      }
      const { data } = await db
        .from('change_requests')
        .select('*, deliverables:deliverable_id(id, deliverable_number, name), projects:project_id(id, name)')
        .in('project_id', projIds)
        .order('created_at', { ascending: false });
      setChangesList(data || []);
    } catch (e) {
      console.error('[ManagerClientWork] Failed to load changes:', e);
    }
  }, [projects]);

  useEffect(() => {
    if (tab === 'changes') {
      void loadChanges();
    }
  }, [tab, loadChanges]);

  const activeChange = useMemo(() => {
    return changesList.find(c => c.id === selectedChangeId) || null;
  }, [changesList, selectedChangeId]);

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
      await db
        .from('change_requests')
        .update({
          status: isApprove ? 'Approved Change' : 'Change Declined',
          reviewer_name: user.name || 'Project Manager',
          reviewer_comment: decisionComment.trim() || (isApprove ? 'Approved.' : 'Declined.'),
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeChange.id);

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
      setSelectedChangeId(null);
      void loadChanges();
    } catch (e) {
      toast('Failed to record decision.', 'err');
    }
  };

  /* =========================================================================
     TAB 4: PROJECT PROGRESS, MILESTONES & UPDATES
  ========================================================================= */
  const [milestones, setMilestones] = useState<any[]>([]);
  const [updates, setUpdates] = useState<any[]>([]);
  const [addMilestoneDialogOpen, setAddMilestoneDialogOpen] = useState(false);
  const [postUpdateDialogOpen, setPostUpdateDialogOpen] = useState(false);
  const [milestoneForm, setMilestoneForm] = useState({ name: '', targetDate: '', state: 'Upcoming' });
  const [updateForm, setUpdateForm] = useState({ title: '', tone: 'info' });

  const loadProgressData = useCallback(async (projId: string) => {
    if (!projId) return;
    try {
      const db = supabase as any;
      const [{ data: mData }, { data: uData }, { data: dData }] = await Promise.all([
        db.from('milestones').select('*').eq('project_id', projId).order('sort_order', { ascending: true }),
        db.from('project_updates').select('*').eq('project_id', projId).order('created_at', { ascending: false }),
        db.from('deliverables').select('status').eq('project_id', projId),
      ]);
      setMilestones(mData || []);
      setUpdates(uData || []);
      if (dData) setDeliverables(dData);
    } catch (e) {
      console.error('[ManagerClientWork] Failed to load progress:', e);
    }
  }, []);

  useEffect(() => {
    if (tab === 'progress' && selectedProjectId) {
      void loadProgressData(selectedProjectId);
    }
  }, [tab, selectedProjectId, loadProgressData]);

  const handleAddMilestone = async () => {
    if (!milestoneForm.name.trim() || !selectedProjectId) return;
    try {
      const db = supabase as any;
      await db.from('milestones').insert({
        project_id: selectedProjectId,
        name: milestoneForm.name.trim(),
        target_date: milestoneForm.targetDate || 'TBD',
        state: milestoneForm.state || 'Upcoming',
        sort_order: milestones.length + 1,
      });
      toast('Milestone scheduled.');
      setAddMilestoneDialogOpen(false);
      setMilestoneForm({ name: '', targetDate: '', state: 'Upcoming' });
      void loadProgressData(selectedProjectId);
    } catch (e) {
      toast('Failed to schedule milestone.', 'err');
    }
  };

  const handlePostUpdate = async () => {
    if (!updateForm.title.trim() || !selectedProjectId) return;
    try {
      const db = supabase as any;
      const meta = `${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${user.name || 'Manager'}`;
      await db.from('project_updates').insert({
        project_id: selectedProjectId,
        title: updateForm.title.trim(),
        meta,
        tone: updateForm.tone || 'info',
      });
      toast('Project update published to client workspace.');
      setPostUpdateDialogOpen(false);
      setUpdateForm({ title: '', tone: 'info' });
      void loadProgressData(selectedProjectId);
    } catch (e) {
      toast('Failed to post update.', 'err');
    }
  };

  const completedDelivCount = deliverables.filter(d => d.status === 'Completed').length;
  const progressPct = deliverables.length > 0 ? Math.round((completedDelivCount / deliverables.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="border-b border-line bg-surface px-4 sm:px-6 pt-2">
        <div className="flex items-center justify-between pb-3 flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">Manager Client Work & Progress</h1>
            <p className="text-xs text-ink-3 mt-0.5">
              Deliverables, client change requests, milestone tracking, and updates for your assigned projects
            </p>
          </div>
          <Button size="sm" icon={RefreshCw} loading={loading} onClick={() => void loadProjects()}>
            Refresh
          </Button>
        </div>

        <Tabs
          value={tab}
          onChange={t => setTab(t as any)}
          tabs={[
            { id: 'projects', label: 'Assigned Projects', count: projects.length },
            { id: 'deliverables', label: 'Deliverables' },
            { id: 'changes', label: 'Change Requests', count: pendingChanges.length || undefined },
            { id: 'progress', label: 'Project Progress' },
          ]}
        />
      </div>

      <div className="px-4 sm:px-6">
        {/* PROJECTS TAB */}
        {tab === 'projects' && (
          <div className="space-y-4">
            <DataTable
              rows={projects}
              empty={
                <Empty
                  icon={FolderKanban}
                  title="No assigned projects"
                  desc="Projects assigned to you by administrators will appear here."
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
                { key: 'status', head: 'Status', render: (r: any) => <Status s={r.status} /> },
                {
                  key: 'created',
                  head: 'Assigned Date',
                  render: (r: any) =>
                    new Date(r.created_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    }),
                },
              ]}
              actions={r => (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setSelectedProjectId(r.id);
                      setTab('deliverables');
                    }}
                  >
                    Deliverables
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setSelectedProjectId(r.id);
                      setTab('progress');
                    }}
                  >
                    Progress
                  </Button>
                </div>
              )}
            />
          </div>
        )}

        {/* DELIVERABLES TAB */}
        {tab === 'deliverables' && (
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
              <Button variant="primary" icon={Plus} onClick={() => setAddDelivDialogOpen(true)}>
                Add Deliverable
              </Button>
            </FilterBar>

            <DataTable
              rows={deliverables}
              onRow={r => setSelectedDelivId(r.id)}
              empty={
                <Empty
                  icon={Package}
                  title="No deliverables configured"
                  desc="Add deliverables to define the project scope for this client."
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
              onClose={() => setSelectedDelivId(null)}
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

        {/* CHANGE REQUESTS TAB */}
        {tab === 'changes' && (
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
              onRow={r => setSelectedChangeId(r.id)}
              empty={
                <Empty
                  icon={CheckCircle2}
                  title="No change requests"
                  desc="Client change requests on your assigned projects will appear here."
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
                { key: 'field', head: 'Field', render: (r: any) => r.field },
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
              onClose={() => setSelectedChangeId(null)}
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
                      ['Reason', activeChange.reason || 'None'],
                      ['Submitted', new Date(activeChange.created_at).toLocaleDateString('en-IN')],
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

        {/* PROJECT PROGRESS TAB */}
        {tab === 'progress' && (
          <div className="space-y-6">
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
              <Button icon={Plus} onClick={() => setAddMilestoneDialogOpen(true)}>
                Add Milestone
              </Button>
              <Button variant="primary" icon={Plus} onClick={() => setPostUpdateDialogOpen(true)}>
                Post Project Update
              </Button>
            </FilterBar>

            <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
              <div className="space-y-6">
                <Card>
                  <CardHead
                    title={selectedProject?.name || 'Project Overview'}
                    desc={`Client: ${selectedProject?.clientName || 'Client'}`}
                  />
                  <div className="mt-4">
                    <div className="flex justify-between text-xs mb-2">
                      <span className="text-ink-2">Deliverables completed</span>
                      <span className="font-semibold text-ink">
                        {completedDelivCount} of {deliverables.length} ({progressPct}%)
                      </span>
                    </div>
                    <Progress value={progressPct} label="Deliverables completed" />
                  </div>
                </Card>

                <Card>
                  <CardHead title="Scheduled Milestones" />
                  {milestones.length === 0 ? (
                    <p className="text-xs text-ink-3">No milestones scheduled yet.</p>
                  ) : (
                    <Timeline
                      items={milestones.map(m => ({
                        tone: m.state === 'Completed' ? 'ok' : m.state === 'In Progress' ? 'warn' : undefined,
                        title: (
                          <span className="flex items-center gap-2">
                            <span className="font-semibold text-ink">{m.name}</span>
                            <Status s={m.state} />
                          </span>
                        ),
                        meta: m.target_date,
                      }))}
                    />
                  )}
                </Card>
              </div>

              <div>
                <Card>
                  <CardHead title="Recent Project Updates" />
                  {updates.length === 0 ? (
                    <p className="text-xs text-ink-3">No updates published yet.</p>
                  ) : (
                    <Timeline
                      items={updates.map(u => ({
                        title: u.title,
                        meta: u.meta,
                        tone: u.tone,
                      }))}
                    />
                  )}
                </Card>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* DIALOGS */}
      {/* Add Deliverable */}
      <Dialog
        open={addDelivDialogOpen}
        onClose={() => setAddDelivDialogOpen(false)}
        title="Add Deliverable"
        footer={
          <>
            <Button onClick={() => setAddDelivDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleAddDeliverable}>
              Save Deliverable
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Deliverable Name" required>
            <Input
              value={delivForm.name}
              onChange={e => setDelivForm({ ...delivForm, name: e.target.value })}
              placeholder="e.g. Design System V1"
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={delivForm.desc}
              onChange={e => setDelivForm({ ...delivForm, desc: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <Input
                value={delivForm.qty}
                onChange={e => setDelivForm({ ...delivForm, qty: e.target.value })}
              />
            </Field>
            <Field label="Timeline / Due Date">
              <Input
                value={delivForm.due}
                onChange={e => setDelivForm({ ...delivForm, due: e.target.value })}
                placeholder="e.g. 25 Nov 2026"
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

      {/* Decision Dialog */}
      <Dialog
        open={!!decisionDialog}
        onClose={() => setDecisionDialog(null)}
        tone={decisionDialog === 'decline' ? 'danger' : undefined}
        title={decisionDialog === 'approve' ? 'Approve Change Request?' : 'Decline Change Request?'}
        desc={
          decisionDialog === 'approve'
            ? 'Approving will update the deliverable immediately. The previous state is preserved in history.'
            : 'Declining leaves the deliverable unchanged.'
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
        <Field label="Feedback to Client">
          <Textarea
            value={decisionComment}
            onChange={e => setDecisionComment(e.target.value)}
            placeholder="Add explanation or decision notes..."
          />
        </Field>
      </Dialog>

      {/* Add Milestone Dialog */}
      <Dialog
        open={addMilestoneDialogOpen}
        onClose={() => setAddMilestoneDialogOpen(false)}
        title="Schedule Milestone"
        footer={
          <>
            <Button onClick={() => setAddMilestoneDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleAddMilestone}>
              Schedule
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Milestone Name" required>
            <Input
              value={milestoneForm.name}
              onChange={e => setMilestoneForm({ ...milestoneForm, name: e.target.value })}
              placeholder="e.g. Alpha Release"
            />
          </Field>
          <Field label="Target Date" required>
            <Input
              value={milestoneForm.targetDate}
              onChange={e => setMilestoneForm({ ...milestoneForm, targetDate: e.target.value })}
              placeholder="e.g. 10 Dec 2026"
            />
          </Field>
          <Field label="Status">
            <Select
              value={milestoneForm.state}
              onChange={e => setMilestoneForm({ ...milestoneForm, state: e.target.value })}
            >
              <option value="Upcoming">Upcoming</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
            </Select>
          </Field>
        </div>
      </Dialog>

      {/* Post Update Dialog */}
      <Dialog
        open={postUpdateDialogOpen}
        onClose={() => setPostUpdateDialogOpen(false)}
        title="Post Project Update"
        desc="This update appears in the client's dashboard and project progress feed."
        footer={
          <>
            <Button onClick={() => setPostUpdateDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handlePostUpdate}>
              Publish Update
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Update Headline" required>
            <Input
              value={updateForm.title}
              onChange={e => setUpdateForm({ ...updateForm, title: e.target.value })}
              placeholder="e.g. API Integration complete; testing underway"
            />
          </Field>
          <Field label="Tone">
            <Select
              value={updateForm.tone}
              onChange={e => setUpdateForm({ ...updateForm, tone: e.target.value })}
            >
              <option value="info">Informational</option>
              <option value="ok">Positive / Milestone Reached</option>
              <option value="warn">Attention Needed</option>
            </Select>
          </Field>
        </div>
      </Dialog>
    </div>
  );
};
