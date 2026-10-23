/**
 * Employee "Client Projects" area.
 *  - My deliverables: client deliverables assigned to me (Client → Project →
 *    Deliverable → Task → Employee), with the transitions an assignee may make,
 *    dependency review, file uploads and scope history.
 *  - Managed projects: the full project workspace for projects I manage.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderKanban, Package, RefreshCw } from 'lucide-react';
import type { Employee } from '../../types/attendance';
import type { AuthUser } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  DataTable,
  Empty,
  Field,
  FilterBar,
  Input,
  KV,
  PageHeader,
  Select,
  SidePanel,
  Status,
  Tabs,
  Textarea,
  Timeline,
  ToastProvider,
  useToast,
} from '../client/ClientUI';
import { ProjectOperations } from '../admin/ProjectOperations';
import {
  EMPLOYEE_TRANSITIONS,
  errorMessage,
  fmtDate,
  fmtQty,
  latestFiles,
  must,
  openFile,
  rpc,
  todayIST,
  uploadAndAttach,
  validateFile,
  ACCEPT_ATTR,
  type DeliverableRow,
  type DeliverableStatus,
  type DependencyRow,
  type FileRow,
  type ModificationRow,
} from '../../lib/sigma';

interface Props {
  user: AuthUser;
  employees: Employee[];
}

const db = supabase as any;

export const ManagerClientWork: React.FC<Props> = props => (
  <ToastProvider>
    <ClientWorkInternal {...props} />
  </ToastProvider>
);

function ClientWorkInternal({ user, employees }: Props) {
  const [managed, setManaged] = useState<{ id: string; name: string; client_id: string | null; clientName: string }[]>([]);
  // Deep link: /emp-client-work?project=<id>&view=<workspace tab> opens a managed project.
  const deepLink = useMemo(() => {
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    return { project: q.get('project') ?? '', view: q.get('view') ?? '' };
  }, []);
  const [tab, setTab] = useState(deepLink.project ? 'managed' : 'mine');
  const [projectId, setProjectId] = useState(deepLink.project);
  const [error, setError] = useState<string | null>(null);

  const loadManaged = useCallback(async () => {
    if (!user.employeeDbId) return;
    try {
      const pm = await must<any[]>(db.from('project_managers').select('project_id').eq('manager_id', user.employeeDbId));
      const ids = pm.map(x => x.project_id);
      if (!ids.length) { setManaged([]); setTab('mine'); return; }
      const rows = await must<any[]>(db.from('projects').select('id, name, client_id, clients:client_id (company_name)').in('id', ids).is('deleted_at', null).order('created_at', { ascending: false }));
      const mapped = rows.map(r => ({ id: r.id, name: r.name, client_id: r.client_id, clientName: r.clients?.company_name ?? 'Client' }));
      setManaged(mapped);
      setProjectId(prev => (prev && mapped.some(m => m.id === prev) ? prev : mapped[0]?.id || ''));
      if (!mapped.length) setTab('mine');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [user.employeeDbId]);

  useEffect(() => { void loadManaged(); }, [loadManaged]);
  const project = managed.find(p => p.id === projectId) ?? null;

  return (
    <div className="space-y-4">
      <PageHeader title="Client Projects" desc="Client deliverables assigned to you and projects you manage." />
      {error && <Alert tone="err" title="Could not load your projects">{error}</Alert>}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'mine', label: 'My deliverables' },
          ...(managed.length ? [{ id: 'managed', label: 'Managed projects', count: managed.length }] : []),
        ]}
      />
      {tab === 'mine' && <MyDeliverables user={user} />}
      {tab === 'managed' && (
        managed.length === 0 ? (
          <Card pad={false}><Empty icon={FolderKanban} title="No managed projects" desc="Projects assigned to you as manager appear here." /></Card>
        ) : (
          <>
            <FilterBar>
              <Select value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full sm:w-80" aria-label="Project">
                {managed.map(p => <option key={p.id} value={p.id}>{p.name} — {p.clientName}</option>)}
              </Select>
            </FilterBar>
            {project && (
              <ProjectOperations
                key={project.id}
                projectId={project.id}
                projectName={project.name}
                clientId={project.client_id}
                employees={employees.map(e => ({ id: e.id, name: e.name, designation: e.designation, status: e.status }))}
                mode="manager"
                initialTab={project.id === deepLink.project ? deepLink.view || undefined : undefined}
              />
            )}
          </>
        )
      )}
    </div>
  );
}

function MyDeliverables({ user }: { user: AuthUser }) {
  const toast = useToast();
  const [rows, setRows] = useState<(DeliverableRow & { projects?: { name: string; clients?: { company_name: string } } })[] | null>(null);
  const [deps, setDeps] = useState<DependencyRow[]>([]);
  const [mods, setMods] = useState<ModificationRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusDlg, setStatusDlg] = useState<DeliverableStatus | null>(null);
  const [note, setNote] = useState('');
  const [depForm, setDepForm] = useState<{ name: string; desc: string; by: string } | null>(null);
  const [upload, setUpload] = useState<File | null>(null);
  const [resubmitId, setResubmitId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user.employeeDbId) { setRows([]); return; }
    try {
      const d = await must<any[]>(db.from('deliverables').select('*, projects:project_id (name, clients:client_id (company_name))')
        .eq('responsible_id', user.employeeDbId).is('deleted_at', null).order('due_date', { ascending: true, nullsFirst: false }));
      const ids = d.map(x => x.id);
      const [dp, md] = ids.length
        ? await Promise.all([
            must<DependencyRow[]>(db.from('deliverable_dependencies').select('*').in('deliverable_id', ids)),
            must<ModificationRow[]>(db.from('change_requests').select('*').in('deliverable_id', ids).order('created_at', { ascending: false })),
          ])
        : [[], []];
      const parentIds = [...ids, ...dp.map(x => x.id)];
      const fl = parentIds.length
        ? await must<FileRow[]>(db.from('files').select('*').in('parent_id', parentIds).is('deleted_at', null))
        : [];
      setRows(d);
      setDeps(dp);
      setMods(md);
      setFiles(fl);
      setErr(null);
    } catch (e) {
      setErr(errorMessage(e));
      setRows([]);
    }
  }, [user.employeeDbId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok); await load(); return true; } catch (e) { toast(errorMessage(e), 'err'); return false; } finally { setBusy(null); }
  };

  const d = rows?.find(x => x.id === sel) ?? null;
  const today = todayIST();
  const active = useMemo(() => (rows ?? []).filter(x => !['Cancelled'].includes(x.status)), [rows]);

  if (rows === null) return <p className="text-xs text-ink-3" role="status">Loading…</p>;
  if (err) return <Alert tone="err" title="Could not load your deliverables">{err}</Alert>;

  const dFiles = d ? latestFiles(files.filter(f => f.parent_type === 'deliverable' && f.parent_id === d.id)) : [];
  const dDeps = d ? deps.filter(x => x.deliverable_id === d.id) : [];
  const dMods = d ? mods.filter(x => x.deliverable_id === d.id) : [];

  return (
    <>
      <FilterBar>
        <span className="text-[13px] text-ink-2">
          {active.length} assigned · {active.filter(x => x.due_date && x.due_date < today && !['Completed', 'Ready for Download'].includes(x.status)).length} overdue ·{' '}
          {active.filter(x => x.status === 'Modification Requested').length} with client change requests
        </span>
        <div className="flex-1" />
        <Button size="sm" icon={RefreshCw} onClick={() => void load()}>Refresh</Button>
      </FilterBar>
      <DataTable
        rows={active}
        pageSize={12}
        onRow={r => setSel(r.id)}
        empty={<Empty icon={Package} title="No client deliverables assigned" desc="Deliverables your manager assigns to you appear here." />}
        cols={[
          { key: 'd', head: 'Deliverable', mobile: 'title', render: r => <div><div className="font-medium">{r.deliverable_number} · {r.name}</div><div className="text-xs text-ink-3">{r.projects?.clients?.company_name} · {r.projects?.name}</div></div> },
          { key: 'q', head: 'Qty', render: r => fmtQty(r.quantity, r.unit) },
          { key: 'due', head: 'Due', render: r => <span className={r.due_date && r.due_date < today && !['Completed', 'Ready for Download'].includes(r.status) ? 'text-err text-xs font-medium' : 'text-xs'}>{fmtDate(r.due_date)}</span> },
          { key: 'p', head: 'Priority', render: r => <Badge tone={r.priority === 'Critical' || r.priority === 'High' ? 'err' : r.priority === 'Medium' ? 'warn' : 'neutral'}>{r.priority}</Badge> },
          { key: 's', head: 'Status', render: r => <Status s={r.status} /> },
        ]}
      />

      <SidePanel open={!!d} onClose={() => setSel(null)} title={d ? `${d.deliverable_number} · ${d.name}` : ''} sub={d ? `${d.projects?.clients?.company_name ?? ''} · v${d.version_no}` : undefined}>
        {d && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Status s={d.status} />
              {(EMPLOYEE_TRANSITIONS[d.status] ?? []).map(s => (
                <Button key={s} size="sm" variant="primary" onClick={() => { setNote(''); setStatusDlg(s); }}>{s === 'Under Internal Review' ? 'Submit for review' : s === 'In Progress' ? 'Start work' : s}</Button>
              ))}
            </div>
            {d.status === 'Modification Requested' && <Alert tone="warn" title="Client requested changes">Your manager will review the request and move this to revision.</Alert>}
            <KV items={[
              ['Quantity', fmtQty(d.quantity, d.unit)], ['Due', fmtDate(d.due_date)], ['Timeline', d.timeline ?? '—'],
              ['Priority', d.priority], ['Client must provide', d.dependencies && d.dependencies !== '—' ? d.dependencies : '—'], ['Team', d.assigned_team ?? '—'],
            ]} />
            {d.description && <p className="text-[13px] text-ink-2 whitespace-pre-line">{d.description}</p>}

            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[13px] font-semibold">Client dependencies</h3>
                {!['Completed', 'Ready for Download', 'Cancelled', 'Draft'].includes(d.status) && <Button size="sm" onClick={() => setDepForm({ name: '', desc: '', by: '' })}>Request from client</Button>}
              </div>
              {dDeps.length === 0 ? <p className="text-xs text-ink-3">None.</p> : (
                <ul className="space-y-2">
                  {dDeps.map(x => (
                    <li key={x.id} className="border border-line rounded-md p-2.5">
                      <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium">{x.name}</span><Status s={x.status} /></div>
                      {x.client_note && <p className="text-xs text-ink-2 mt-1">{x.client_note}</p>}
                      {latestFiles(files.filter(f => f.parent_type === 'dependency' && f.parent_id === x.id)).map(f => (
                        <button key={f.id} className="block text-xs text-info hover:underline mt-1" onClick={() => openFile(f).catch(e => toast(errorMessage(e), 'err'))}>{f.name}</button>
                      ))}
                      {x.status === 'Uploaded' && (
                        <div className="flex gap-2 mt-2">
                          <Button size="sm" variant="primary" loading={busy === 'acc' + x.id} onClick={() => act('acc' + x.id, () => rpc('staff_review_dependency', { p_dependency_id: x.id, p_decision: 'accept' }), 'Accepted.')}>Accept</Button>
                          <Button size="sm" onClick={() => { setNote(''); setResubmitId(x.id); }}>Ask to resubmit</Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="text-[13px] font-semibold mb-2">Work files</h3>
              {dFiles.length === 0 ? <p className="text-xs text-ink-3">No files yet.</p> : (
                <ul className="space-y-1">
                  {dFiles.map(f => <li key={f.id}><button className="text-xs text-info hover:underline" onClick={() => openFile(f).catch(e => toast(errorMessage(e), 'err'))}>{f.name} (v{f.version_no}{f.visibility === 'client' ? ', client-visible' : ''})</button></li>)}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input type="file" accept={ACCEPT_ATTR} aria-label="Upload work file" className="text-xs" onChange={e => { const f = e.target.files?.[0] ?? null; if (f && validateFile(f)) { toast(validateFile(f)!, 'err'); return; } setUpload(f); }} />
                <Button size="sm" disabled={!upload} loading={busy === 'up'} onClick={() => upload && act('up', () => uploadAndAttach(upload, 'deliverable', d.id, { visibility: 'internal' }), 'Uploaded for internal review.').then(ok => ok && setUpload(null))}>Upload</Button>
              </div>
              <p className="text-[11px] text-ink-3 mt-1">Your uploads are internal. Your manager publishes final files to the client.</p>
            </section>

            {dMods.length > 0 && (
              <section>
                <h3 className="text-[13px] font-semibold mb-2">Client modification requests</h3>
                <Timeline items={dMods.map(m => ({ title: `${m.request_number} · ${m.field} · ${m.status}`, meta: fmtDate(m.created_at, true), body: <span>{m.previous_value} → {m.requested_value}{m.reason ? ` · ${m.reason}` : ''}</span> }))} />
              </section>
            )}
          </div>
        )}
      </SidePanel>

      <Dialog
        open={!!statusDlg}
        onClose={() => setStatusDlg(null)}
        title={statusDlg === 'Under Internal Review' ? 'Submit for internal review' : `Move to ${statusDlg}`}
        footer={<><Button onClick={() => setStatusDlg(null)}>Cancel</Button><Button variant="primary" loading={busy === 'st'} onClick={async () => { if (d && await act('st', () => rpc('staff_set_deliverable_status', { p_deliverable_id: d.id, p_status: statusDlg, p_note: note.trim() || null }), 'Status updated.')) setStatusDlg(null); }}>Confirm</Button></>}
      >
        <Field label="Note (optional)"><Input value={note} onChange={e => setNote(e.target.value)} /></Field>
      </Dialog>

      <Dialog
        open={!!resubmitId}
        onClose={() => setResubmitId(null)}
        title="Ask the client to resubmit"
        desc="Your comment is sent to the client."
        footer={<><Button onClick={() => setResubmitId(null)}>Cancel</Button><Button variant="primary" disabled={note.trim().length < 3} loading={busy === 'rs'} onClick={async () => { if (resubmitId && await act('rs', () => rpc('staff_review_dependency', { p_dependency_id: resubmitId, p_decision: 'resubmit', p_comment: note.trim() }), 'Client asked to resubmit.')) setResubmitId(null); }}>Send</Button></>}
      >
        <Field label="What is missing" required><Textarea value={note} onChange={e => setNote(e.target.value)} /></Field>
      </Dialog>

      <Dialog
        open={!!depForm}
        onClose={() => setDepForm(null)}
        title="Request from client"
        desc="The client and your manager are notified."
        footer={<><Button onClick={() => setDepForm(null)}>Cancel</Button><Button variant="primary" disabled={!depForm || depForm.name.trim().length < 2} loading={busy === 'dep'} onClick={async () => { if (d && depForm && await act('dep', () => rpc('staff_request_dependency', { p_deliverable_id: d.id, p_name: depForm.name.trim(), p_description: depForm.desc.trim() || null, p_required_by: depForm.by || null }), 'Request sent.')) setDepForm(null); }}>Send</Button></>}
      >
        {depForm && (
          <div className="space-y-3">
            <Field label="What is needed" required><Input value={depForm.name} onChange={e => setDepForm({ ...depForm, name: e.target.value })} /></Field>
            <Field label="Details"><Textarea value={depForm.desc} onChange={e => setDepForm({ ...depForm, desc: e.target.value })} /></Field>
            <Field label="Needed by"><Input type="date" min={today} value={depForm.by} onChange={e => setDepForm({ ...depForm, by: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>
    </>
  );
}
