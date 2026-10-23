/**
 * SIGMA 1 staff workspace for one project: contract, deliverables,
 * modifications, dependencies, files, billing and activity.
 * Used by Admin (full access) and Project Managers (scope limited by the
 * database: managers cannot verify payments or change billing settings).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DeliverableThread } from '../common/DeliverableThread';
import { StaffClientReview } from '../common/StaffClientReview';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  FileSignature,
  FileText,
  GitPullRequest,
  History,
  Lock,
  Package,
  Plus,
  RefreshCw,
  Send,
  Unlock,
  Upload,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHead,
  Checkbox,
  DataTable,
  Dialog,
  Empty,
  Field,
  FilterBar,
  Input,
  KV,
  LinkRef,
  Progress,
  SearchField,
  Select,
  SidePanel,
  Stat,
  Status,
  Switch,
  Tabs,
  Textarea,
  Timeline,
  useToast,
} from '../client/ClientUI';
import {
  ACCEPT_ATTR,
  AWAITING_CLIENT_CONTRACT,
  DELIVERABLE_STATUSES,
  DELIVERABLE_TRANSITIONS,
  OPEN_MODIFICATION,
  computeProgress,
  errorMessage,
  fmtBytes,
  fmtDate,
  fmtQty,
  idempotencyKey,
  inr,
  installmentTotal,
  isLocked,
  latestFiles,
  loadProjectWorkspace,
  must,
  openFile,
  rpc,
  todayIST,
  uploadAndAttach,
  validateFile,
  type DeliverableRow,
  type DeliverableStatus,
  type FileRow,
  type InstallmentRow,
  type ModificationRow,
  type ProjectWorkspace,
} from '../../lib/sigma';

interface Emp {
  id: string;
  name: string;
  designation?: string | null;
  status?: string;
}

interface Props {
  projectId: string;
  projectName: string;
  clientId: string | null;
  employees: Emp[];
  mode: 'admin' | 'manager';
}

const db = supabase as any;

/* ------------------------------------------------------------------ shared */

function useBusy() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, success?: string) => {
      setBusy(key);
      try {
        await fn();
        if (success) toast(success);
        return true;
      } catch (e) {
        toast(errorMessage(e), 'err');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}

function StaffFiles({ files, onArchived }: { files: FileRow[]; onArchived?: () => void }) {
  const { busy, run } = useBusy();
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  if (files.length === 0) return <p className="text-xs text-ink-3">No files yet.</p>;
  return (
    <>
      <ul className="divide-y divide-line border border-line rounded-md">
        {files.map(f => (
          <li key={f.id} className="flex items-center gap-3 px-3 py-2.5">
            <FileText size={15} className="text-ink-3 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-ink truncate">{f.name}</div>
              <div className="text-[11px] text-ink-3">
                v{f.version_no} · {fmtBytes(f.size_bytes)} · {fmtDate(f.created_at)} · {f.visibility === 'client' ? 'Client-visible' : 'Internal'}
                {f.is_final && <span className="ml-1 text-ok font-medium">· Final</span>}
              </div>
            </div>
            <Button size="sm" loading={busy === 'dl' + f.id} onClick={() => run('dl' + f.id, () => openFile(f))}>Download</Button>
            {onArchived && (
              <Button size="sm" variant="ghost" onClick={() => { setArchiveId(f.id); setReason(''); }}>Archive</Button>
            )}
          </li>
        ))}
      </ul>
      <Dialog
        open={!!archiveId}
        onClose={() => setArchiveId(null)}
        title="Archive file"
        desc="The file is hidden from everyone except administrators. Its record and earlier versions are kept."
        footer={
          <>
            <Button onClick={() => setArchiveId(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3}
              loading={busy === 'archive'}
              onClick={async () => {
                if (await run('archive', () => rpc('archive_file', { p_file_id: archiveId, p_reason: reason.trim() }), 'File archived.')) {
                  setArchiveId(null);
                  onArchived?.();
                }
              }}
            >
              Archive
            </Button>
          </>
        }
      >
        <Field label="Reason" required><Input value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </Dialog>
    </>
  );
}

function UploadBox({
  parentType,
  parentId,
  existing,
  allowFinal,
  defaultVisibility = 'internal',
  onDone,
}: {
  parentType: 'deliverable' | 'contract' | 'invoice' | 'payment' | 'dependency';
  parentId: string;
  existing: FileRow[];
  allowFinal?: boolean;
  defaultVisibility?: 'internal' | 'client';
  onDone: () => void;
}) {
  const { busy, run } = useBusy();
  const [file, setFile] = useState<File | null>(null);
  const [visibility, setVisibility] = useState<'internal' | 'client'>(defaultVisibility);
  const [isFinal, setIsFinal] = useState(false);
  const [replaces, setReplaces] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-3 border border-dashed border-line rounded-md p-3">
      <input
        type="file"
        accept={ACCEPT_ATTR}
        aria-label="Choose file"
        className="block w-full text-xs text-ink-2 file:mr-3 file:h-8 file:px-3 file:rounded-md file:border file:border-line file:bg-surface file:text-[13px] file:font-medium"
        onChange={e => {
          const f = e.target.files?.[0] ?? null;
          const bad = f ? validateFile(f) : null;
          setErr(bad);
          setFile(bad ? null : f);
        }}
      />
      {err && <p className="text-xs text-err">{err}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Visibility">
          <Select value={visibility} onChange={e => setVisibility(e.target.value as 'internal' | 'client')}>
            <option value="internal">Internal only</option>
            <option value="client">Visible to client</option>
          </Select>
        </Field>
        <Field label="New version of">
          <Select value={replaces} onChange={e => setReplaces(e.target.value)}>
            <option value="">— New file —</option>
            {existing.map(f => <option key={f.id} value={f.id}>{f.name} (v{f.version_no})</option>)}
          </Select>
        </Field>
      </div>
      {allowFinal && (
        <Checkbox checked={isFinal} onChange={setIsFinal} label="Final deliverable file (client can download once the deliverable is ready and not locked)" />
      )}
      <Button
        size="sm"
        variant="primary"
        icon={Upload}
        disabled={!file}
        loading={busy === 'up'}
        onClick={async () => {
          if (!file) return;
          const ok = await run(
            'up',
            () => uploadAndAttach(file, parentType, parentId, {
              visibility: isFinal ? 'client' : visibility,
              isFinal: allowFinal ? isFinal : false,
              replacesFileId: replaces || null,
            }),
            'File uploaded.',
          );
          if (ok) {
            setFile(null);
            setIsFinal(false);
            setReplaces('');
            onDone();
          }
        }}
      >
        Upload
      </Button>
    </div>
  );
}

/* =========================================================================
   Main component
========================================================================= */

export function ProjectOperations({ projectId, projectName, clientId, employees, mode, initialTab }: Props & { initialTab?: string }) {
  const [ws, setWs] = useState<ProjectWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(initialTab || 'overview');

  const reload = useCallback(async () => {
    try {
      setWs(await loadProjectWorkspace(projectId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [projectId]);

  useEffect(() => {
    setWs(null);
    void reload();
  }, [reload]);

  if (error) {
    return (
      <Card pad={false}>
        <Empty icon={AlertTriangle} title="Could not load this project" desc={error} action={<Button icon={RefreshCw} onClick={() => void reload()}>Retry</Button>} />
      </Card>
    );
  }
  if (!ws) {
    return <div className="py-16 text-center text-xs text-ink-3" role="status">Loading {projectName}…</div>;
  }

  const pendingMods = ws.modifications.filter(m => m.status === 'Pending Review').length;
  const pendingPayments = ws.payments.filter(p => p.status === 'Submitted').length;
  const uploadedDeps = ws.dependencies.filter(d => d.status === 'Uploaded').length;

  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'contract', label: 'Contract' },
          { id: 'deliverables', label: 'Deliverables', count: ws.deliverables.length },
          { id: 'modifications', label: 'Modifications', count: pendingMods || undefined },
          { id: 'dependencies', label: 'Client dependencies', count: uploadedDeps || undefined },
          { id: 'billing', label: 'Billing', count: pendingPayments || undefined },
          ...(mode === 'admin' ? [{ id: 'activity', label: 'Activity' }] : []),
        ]}
      />
      {tab === 'overview' && <Overview ws={ws} go={setTab} />}
      {tab === 'contract' && <ContractTab ws={ws} projectId={projectId} reload={reload} />}
      {tab === 'deliverables' && <DeliverablesTab ws={ws} projectId={projectId} employees={employees} reload={reload} />}
      {tab === 'modifications' && <ModificationsTab ws={ws} reload={reload} />}
      {tab === 'dependencies' && <DependenciesTab ws={ws} reload={reload} />}
      {tab === 'billing' && <BillingTab ws={ws} projectId={projectId} clientId={clientId} mode={mode} reload={reload} />}
      {tab === 'activity' && mode === 'admin' && <ActivityTab projectId={projectId} />}
    </div>
  );
}

/* ---------------------------------------------------------------- Overview */

function Overview({ ws, go }: { ws: ProjectWorkspace; go: (t: string) => void }) {
  const today = todayIST();
  const prog = computeProgress(ws.deliverables);
  const contract = ws.contracts[0];
  const active = ws.deliverables.filter(d => !['Cancelled', 'Draft'].includes(d.status));
  const overdue = active.filter(d => d.due_date && d.due_date < today && !['Completed', 'Ready for Download'].includes(d.status));
  const waitingClient = active.filter(d => ['Awaiting Client Dependency', 'Awaiting Client Review'].includes(d.status));
  const unassigned = active.filter(d => !d.responsible_id);
  const locked = ws.deliverables.filter(d => isLocked(d.lock_state));
  const billable = ws.installments.filter(i => !['Cancelled', 'Waived'].includes(i.status));
  const billed = billable.reduce((s, i) => s + installmentTotal(i), 0);
  const collected = billable.reduce((s, i) => s + Number(i.amount_paid), 0);
  const overdueAmt = billable.filter(i => i.status === 'Overdue').reduce((s, i) => s + installmentTotal(i) - Number(i.amount_paid), 0);

  const exceptions: { text: string; tab: string; tone: 'err' | 'warn' | 'info' }[] = [];
  if (!contract) exceptions.push({ text: 'No contract created yet', tab: 'contract', tone: 'warn' });
  else if (contract.status === 'Draft') exceptions.push({ text: 'Contract is still a draft — send it to the client', tab: 'contract', tone: 'warn' });
  else if (contract.status === 'Declined') exceptions.push({ text: `Client declined the contract: ${contract.decline_reason ?? ''}`, tab: 'contract', tone: 'err' });
  if (overdue.length) exceptions.push({ text: `${overdue.length} deliverable${overdue.length > 1 ? 's are' : ' is'} past due`, tab: 'deliverables', tone: 'err' });
  if (unassigned.length) exceptions.push({ text: `${unassigned.length} active deliverable${unassigned.length > 1 ? 's have' : ' has'} no responsible employee`, tab: 'deliverables', tone: 'warn' });
  const pend = ws.modifications.filter(m => m.status === 'Pending Review').length;
  if (pend) exceptions.push({ text: `${pend} modification request${pend > 1 ? 's' : ''} awaiting decision`, tab: 'modifications', tone: 'warn' });
  const up = ws.dependencies.filter(d => d.status === 'Uploaded').length;
  if (up) exceptions.push({ text: `${up} client upload${up > 1 ? 's' : ''} to review`, tab: 'dependencies', tone: 'info' });
  const sub = ws.payments.filter(p => p.status === 'Submitted').length;
  if (sub) exceptions.push({ text: `${sub} payment${sub > 1 ? 's' : ''} awaiting verification`, tab: 'billing', tone: 'info' });
  if (overdueAmt > 0) exceptions.push({ text: `${inr(overdueAmt)} overdue from the client`, tab: 'billing', tone: 'err' });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Deliverables" value={prog.total} sub={`${overdue.length} overdue · ${waitingClient.length} waiting on client`} tone={overdue.length ? 'err' : undefined} onClick={() => go('deliverables')} />
        <Stat label="Completion" value={`${prog.weightedPct ?? prog.countPct}%`} sub={prog.weightedPct != null ? 'Weighted' : 'By count'} />
        <Stat label="Billed / collected" value={inr(collected)} sub={`of ${inr(billed)} billed`} onClick={() => go('billing')} />
        <Stat label="Download locks" value={locked.length} sub={locked.length ? 'Deliverables locked' : 'None'} tone={locked.length ? 'warn' : undefined} />
      </div>
      <Card>
        <CardHead title="Needs attention" />
        {exceptions.length === 0 ? (
          <p className="text-[13px] text-ink-2 flex items-center gap-2"><CheckCircle2 size={15} className="text-ok" /> Nothing needs intervention.</p>
        ) : (
          <ul className="divide-y divide-line">
            {exceptions.map((x, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex items-center gap-2 text-[13px] text-ink min-w-0">
                  <span className={x.tone === 'err' ? 'text-err' : x.tone === 'warn' ? 'text-warn' : 'text-info'}><AlertTriangle size={14} /></span>
                  <span className="truncate">{x.text}</span>
                </span>
                <Button size="sm" onClick={() => go(x.tab)}>Open</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHead title="Progress" />
        <Progress value={prog.weightedPct ?? prog.countPct} label="Project completion" />
        <p className="text-[11px] text-ink-3 mt-2">
          {prog.done} of {prog.total} active deliverables completed{prog.weightedPct != null ? ' · weighted by deliverable weightage' : ' · add weightage to every deliverable for weighted progress'}.
        </p>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- Contract */

type ContractForm = { title: string; ref: string; url: string; value: string; taxNote: string; start: string; end: string; renewal: string; terms: string; note: string };
const emptyContract: ContractForm = { title: '', ref: '', url: '', value: '', taxNote: '+ GST', start: '', end: '', renewal: '', terms: '', note: '' };

function ContractTab({ ws, projectId, reload }: { ws: ProjectWorkspace; projectId: string; reload: () => Promise<void> }) {
  const { busy, run } = useBusy();
  const contract = ws.contracts[0] ?? null;
  const [panel, setPanel] = useState<'create' | 'revise' | null>(null);
  const [form, setForm] = useState<ContractForm>(emptyContract);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [terminate, setTerminate] = useState(false);
  const [reason, setReason] = useState('');

  const versions = contract ? ws.contractVersions.filter(v => v.contract_id === contract.id) : [];
  const current = versions.find(v => v.version_no === contract?.current_version_no);
  const docs = latestFiles(ws.files.filter(f => f.parent_type === 'contract' && f.parent_id === contract?.id));
  const history = contract ? ws.acceptances.filter(a => a.contract_id === contract.id) : [];

  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
  const valid = form.title.trim().length >= 3 && (form.url.trim().startsWith('https://') || !!docFile || panel === 'revise') && (!form.end || !form.start || form.end >= form.start);

  const save = async () => {
    if (panel === 'create') {
      await run('save', async () => {
        const id = await rpc<string>('staff_create_contract', {
          p_project_id: projectId,
          p_title: form.title.trim(),
          p_ref: form.ref.trim() || null,
          p_document_url: form.url.trim() || null,
          p_document_file_id: null,
          p_contract_value: numOrNull(form.value),
          p_tax_note: form.taxNote.trim() || null,
          p_start_date: form.start || null,
          p_end_date: form.end || null,
          p_renewal_date: form.renewal || null,
          p_terms_summary: form.terms.trim() || null,
        });
        if (docFile) {
          const fid = await uploadAndAttach(docFile, 'contract', id, { visibility: 'client' });
          await rpc('staff_attach_contract_document', { p_contract_id: id, p_file_id: fid });
        }
        setPanel(null);
        await reload();
      }, 'Contract saved as draft.');
    } else if (contract) {
      await run('save', async () => {
        let fid: string | null = null;
        if (docFile) fid = await uploadAndAttach(docFile, 'contract', contract.id, { visibility: 'client' });
        await rpc('staff_revise_contract', {
          p_contract_id: contract.id,
          p_change_note: form.note.trim(),
          p_title: form.title.trim() || null,
          p_document_url: form.url.trim() || null,
          p_document_file_id: fid,
          p_contract_value: numOrNull(form.value),
          p_start_date: form.start || null,
          p_end_date: form.end || null,
          p_renewal_date: form.renewal || null,
          p_terms_summary: form.terms.trim() || null,
        });
        setPanel(null);
        await reload();
      }, 'New contract version created as draft.');
    }
  };

  return (
    <div className="space-y-5">
      {!contract ? (
        <Card pad={false}>
          <Empty
            icon={FileSignature}
            title="No contract yet"
            desc="Create the contract that defines this project's scope and commercial terms."
            action={<Button variant="primary" icon={Plus} onClick={() => { setForm(emptyContract); setDocFile(null); setPanel('create'); }}>Create contract</Button>}
          />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
          <Card>
            <CardHead
              title={`${contract.title} · v${contract.current_version_no}`}
              desc={contract.ref}
              action={<Status s={contract.status} />}
            />
            <KV
              cols={3}
              items={[
                ['Value', contract.contract_value != null ? `${inr(contract.contract_value)} ${contract.tax_note ?? ''}` : '—'],
                ['Start', fmtDate(contract.start_date)],
                ['End', fmtDate(contract.end_date)],
                ['Renewal', fmtDate(contract.renewal_date)],
                ['Sent', fmtDate(contract.sent_at, true)],
                ['Viewed', fmtDate(contract.viewed_at, true)],
                ['Accepted', fmtDate(contract.accepted_at, true)],
                ['Document', current?.document_url ? <LinkRef url={current.document_url} label="Open link" /> : current?.document_file_id ? 'Uploaded file' : '—'],
              ]}
            />
            {contract.status === 'Declined' && <div className="mt-4"><Alert tone="err" title="Declined by client">{contract.decline_reason}</Alert></div>}
            {current?.terms_summary && <p className="mt-4 text-[13px] text-ink-2 whitespace-pre-line">{current.terms_summary}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              {['Draft', 'Declined'].includes(contract.status) && (
                <Button variant="primary" icon={Send} loading={busy === 'send'} onClick={() => run('send', async () => { await rpc('staff_send_contract', { p_contract_id: contract.id }); await reload(); }, 'Contract sent to the client.')}>
                  Send to client
                </Button>
              )}
              {!['Terminated', 'Expired'].includes(contract.status) && (
                <Button
                  icon={FileText}
                  onClick={() => {
                    setForm({ ...emptyContract, title: contract.title, value: contract.contract_value?.toString() ?? '', start: contract.start_date ?? '', end: contract.end_date ?? '', renewal: contract.renewal_date ?? '', terms: current?.terms_summary ?? '', taxNote: contract.tax_note ?? '' });
                    setDocFile(null);
                    setPanel('revise');
                  }}
                >
                  Create revised version
                </Button>
              )}
              {!['Terminated'].includes(contract.status) && (
                <Button variant="danger" onClick={() => { setReason(''); setTerminate(true); }}>Terminate</Button>
              )}
            </div>
            {AWAITING_CLIENT_CONTRACT.includes(contract.status) && (
              <p className="text-xs text-ink-3 mt-3">Waiting for the client to accept. Revising creates a new version and withdraws this one.</p>
            )}
            <div className="mt-5">
              <h3 className="text-[13px] font-semibold mb-2">Documents</h3>
              <StaffFiles files={docs} />
            </div>
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHead title="Acceptance record" desc="Immutable" />
              {history.length === 0 ? <p className="text-[13px] text-ink-3">No client response yet.</p> : (
                <Timeline items={history.map(a => ({
                  tone: a.event === 'Accepted' ? ('ok' as const) : ('err' as const),
                  title: `${a.version} ${a.event.toLowerCase()} by ${a.who}`,
                  meta: `${fmtDate(a.created_at, true)}${a.ip_address ? ` · IP ${a.ip_address}` : ''}`,
                  body: a.note ?? a.acknowledgement ?? undefined,
                }))} />
              )}
            </Card>
            <Card>
              <CardHead title="Versions" />
              <Timeline items={versions.map(v => ({ title: `v${v.version_no}`, meta: fmtDate(v.created_at, true), body: v.change_note ?? undefined }))} />
            </Card>
          </div>
        </div>
      )}

      <SidePanel
        open={!!panel}
        onClose={() => setPanel(null)}
        title={panel === 'create' ? 'Create contract' : 'Create revised version'}
        sub={panel === 'revise' ? 'The current version stays on record; the client must accept the new one.' : 'Saved as a draft until you send it.'}
        footer={<><Button onClick={() => setPanel(null)}>Cancel</Button><Button variant="primary" loading={busy === 'save'} disabled={!valid || (panel === 'revise' && form.note.trim().length < 3)} onClick={save}>Save draft</Button></>}
      >
        <div className="space-y-4">
          <Field label="Title" required><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Master Services Agreement" /></Field>
          {panel === 'create' && <Field label="Reference" hint="Leave blank to generate one."><Input value={form.ref} onChange={e => setForm({ ...form, ref: e.target.value })} /></Field>}
          {panel === 'revise' && <Field label="What changed" required><Textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contract value (₹)"><Input type="number" min={0} step="0.01" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></Field>
            <Field label="Tax note"><Input value={form.taxNote} onChange={e => setForm({ ...form, taxNote: e.target.value })} placeholder="+ GST" /></Field>
            <Field label="Start date"><Input type="date" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></Field>
            <Field label="End date"><Input type="date" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></Field>
            <Field label="Renewal date"><Input type="date" value={form.renewal} onChange={e => setForm({ ...form, renewal: e.target.value })} /></Field>
          </div>
          <Field label="Key terms summary"><Textarea value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} /></Field>
          <Field label="Document link" hint="https:// link (e.g. signed PDF in Drive). Optional if you upload the file.">
            <Input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://" />
          </Field>
          <div>
            <span className="block text-xs font-medium text-ink mb-1.5">Or upload the contract document</span>
            <input type="file" accept=".pdf,.doc,.docx" aria-label="Contract document" className="block w-full text-xs" onChange={e => {
              const f = e.target.files?.[0] ?? null;
              setDocFile(f && !validateFile(f) ? f : null);
            }} />
          </div>
        </div>
      </SidePanel>

      <Dialog
        open={terminate}
        onClose={() => setTerminate(false)}
        tone="danger"
        title="Terminate contract"
        desc="The client is notified. The contract and its history remain on record."
        footer={<><Button onClick={() => setTerminate(false)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 5} loading={busy === 'term'} onClick={async () => { if (await run('term', async () => { await rpc('staff_terminate_contract', { p_contract_id: contract!.id, p_reason: reason.trim() }); await reload(); }, 'Contract terminated.')) setTerminate(false); }}>Terminate</Button></>}
      >
        <Field label="Reason" required><Textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------ Deliverables */

type DelivForm = {
  name: string; description: string; category: string; quantity: string; unit: string; timeline: string;
  start: string; due: string; priority: string; weightage: string; responsible: string; team: string; ref: string; deps: string;
};
const emptyDeliv: DelivForm = { name: '', description: '', category: '', quantity: '1', unit: '', timeline: '', start: '', due: '', priority: 'Medium', weightage: '', responsible: '', team: '', ref: '', deps: '' };

function DeliverablesTab({ ws, projectId, employees, reload }: { ws: ProjectWorkspace; projectId: string; employees: Emp[]; reload: () => Promise<void> }) {
  const { busy, run } = useBusy();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState<DelivForm>(emptyDeliv);
  const [reason, setReason] = useState('');
  const [statusDlg, setStatusDlg] = useState<DeliverableStatus | null>(null);
  const [note, setNote] = useState('');
  const [lockDlg, setLockDlg] = useState<'lock' | 'unlock' | 'auto' | null>(null);
  const [depForm, setDepForm] = useState<{ name: string; desc: string; by: string } | null>(null);
  const [archive, setArchive] = useState(false);

  const d = ws.deliverables.find(x => x.id === selected) ?? null;
  const contract = ws.contracts[0] ?? null;
  const today = todayIST();
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ws.deliverables.filter(x =>
      (filter === 'All' || x.status === filter || (filter === 'Overdue' && x.due_date && x.due_date < today && !['Completed', 'Ready for Download', 'Cancelled'].includes(x.status)) || (filter === 'Locked' && isLocked(x.lock_state))) &&
      (!q || `${x.deliverable_number} ${x.name} ${x.responsible_name ?? ''}`.toLowerCase().includes(q)),
    );
  }, [ws.deliverables, search, filter, today]);

  const toForm = (x: DeliverableRow): DelivForm => ({
    name: x.name, description: x.description ?? '', category: x.category ?? '', quantity: String(x.quantity), unit: x.unit ?? '',
    timeline: x.timeline ?? '', start: x.start_date ?? '', due: x.due_date ?? '', priority: x.priority, weightage: x.weightage?.toString() ?? '',
    responsible: x.responsible_id ?? '', team: x.assigned_team ?? '', ref: x.reference_url && x.reference_url !== '—' ? x.reference_url : '', deps: x.dependencies && x.dependencies !== '—' ? x.dependencies : '',
  });

  const formValid = form.name.trim().length >= 2 && Number(form.quantity) >= 0 && (!form.start || !form.due || form.due >= form.start) &&
    (form.weightage === '' || (Number(form.weightage) >= 0 && Number(form.weightage) <= 100)) && (!form.ref || /^https?:\/\//.test(form.ref));

  const saveDeliverable = async () => {
    if (edit === 'create') {
      await run('save', async () => {
        await must(db.from('deliverables').insert({
          project_id: projectId,
          contract_id: contract?.id ?? null,
          name: form.name.trim(),
          description: form.description.trim() || null,
          category: form.category.trim() || null,
          quantity: Number(form.quantity),
          unit: form.unit.trim() || null,
          timeline: form.timeline.trim() || null,
          start_date: form.start || null,
          due_date: form.due || null,
          priority: form.priority,
          weightage: form.weightage === '' ? null : Number(form.weightage),
          responsible_id: form.responsible || null,
          assigned_team: form.team.trim() || null,
          reference_url: form.ref.trim() || '—',
          dependencies: form.deps.trim() || '—',
          status: contract?.status === 'Accepted' ? 'Pending' : 'Draft',
        }).select('id').single());
        setEdit(null);
        await reload();
      }, contract?.status === 'Accepted' ? 'Deliverable added and active.' : 'Deliverable added as draft; it activates when the contract is accepted.');
    } else if (d) {
      const before = toForm(d);
      const changes: Record<string, unknown> = {};
      const map: [keyof DelivForm, string, (v: string) => unknown][] = [
        ['name', 'name', v => v.trim()], ['description', 'description', v => v], ['category', 'category', v => v],
        ['quantity', 'quantity', v => Number(v)], ['unit', 'unit', v => v], ['timeline', 'timeline', v => v],
        ['start', 'start_date', v => v || null], ['due', 'due_date', v => v || null], ['priority', 'priority', v => v],
        ['weightage', 'weightage', v => (v === '' ? null : Number(v))], ['responsible', 'responsible_id', v => v || null],
        ['team', 'assigned_team', v => v], ['ref', 'reference_url', v => v], ['deps', 'dependencies', v => v],
      ];
      for (const [k, col, conv] of map) if (form[k] !== before[k]) changes[col] = conv(form[k]);
      if (Object.keys(changes).length === 0) { setEdit(null); return; }
      await run('save', async () => {
        await rpc('staff_update_deliverable', { p_deliverable_id: d.id, p_changes: changes, p_reason: reason.trim() || null });
        setEdit(null);
        await reload();
      }, 'Deliverable updated.');
    }
  };

  const scopeChanged = d && edit === 'edit' && d.status !== 'Draft' &&
    (['name', 'description', 'category', 'quantity', 'unit', 'timeline', 'start', 'due', 'weightage', 'deps'] as (keyof DelivForm)[])
      .some(k => form[k] !== toForm(d)[k]);

  const files = d ? latestFiles(ws.files.filter(f => f.parent_type === 'deliverable' && f.parent_id === d.id)) : [];
  const deps = d ? ws.dependencies.filter(x => x.deliverable_id === d.id) : [];
  const versions = d ? ws.versions.filter(v => v.deliverable_id === d.id) : [];

  return (
    <>
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search deliverables or owner" className="w-full sm:w-64" />
        <Select value={filter} onChange={e => setFilter(e.target.value)} className="w-full sm:w-56" aria-label="Filter">
          {['All', 'Overdue', 'Locked', ...DELIVERABLE_STATUSES].map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
        <div className="flex-1" />
        <Button variant="primary" icon={Plus} onClick={() => { setForm({ ...emptyDeliv }); setEdit('create'); }}>Add deliverable</Button>
      </FilterBar>
      {contract?.status !== 'Accepted' && (
        <div className="mb-4"><Alert title="Contract not accepted yet">New deliverables stay in Draft (hidden from the client) until the contract is accepted.</Alert></div>
      )}
      <DataTable
        rows={rows}
        pageSize={15}
        onRow={r => setSelected(r.id)}
        empty={<Empty icon={Package} title="No deliverables" desc="Add the agreed scope items for this project." />}
        cols={[
          { key: 'n', head: 'No.', w: '76px', mobile: 'hide', render: r => <span className="font-mono text-xs text-ink-2">{r.deliverable_number}</span> },
          { key: 'name', head: 'Deliverable', mobile: 'title', render: r => <div className="min-w-0"><div className="font-medium text-ink truncate">{r.name}</div><div className="text-xs text-ink-3">{r.category ?? ''}{r.weightage != null ? ` · ${r.weightage}%` : ''}</div></div> },
          { key: 'q', head: 'Qty', render: r => <span className="tnum">{fmtQty(r.quantity, r.unit)}</span> },
          { key: 'due', head: 'Due', render: r => <span className={r.due_date && r.due_date < today && !['Completed', 'Ready for Download', 'Cancelled'].includes(r.status) ? 'text-err text-xs font-medium' : 'text-xs text-ink-2'}>{fmtDate(r.due_date)}</span> },
          { key: 'o', head: 'Responsible', render: r => r.responsible_name ?? <span className="text-warn text-xs">Unassigned</span> },
          { key: 's', head: 'Status', render: r => <span className="flex items-center gap-1.5"><Status s={r.status} />{isLocked(r.lock_state) && <Lock size={12} className="text-err" aria-label="Locked" />}</span> },
        ]}
      />

      <SidePanel
        open={!!d && !edit}
        onClose={() => setSelected(null)}
        title={d ? `${d.deliverable_number} · ${d.name}` : ''}
        sub={d ? `Version ${d.version_no} · ${d.status}` : undefined}
        footer={d ? <><Button onClick={() => { setForm(toForm(d)); setReason(''); setEdit('edit'); }}>Edit</Button>{['Draft', 'Pending', 'Cancelled'].includes(d.status) && <Button variant="danger" onClick={() => { setReason(''); setArchive(true); }}>Archive</Button>}</> : undefined}
      >
        {d && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Status s={d.status} />
              <Badge>{d.priority}</Badge>
              {isLocked(d.lock_state) && <Badge tone="err">{d.lock_state === 'locked_payment' ? 'Locked: payment' : 'Locked: manual'}</Badge>}
              {d.lock_state === 'override_unlocked' && <Badge tone="info">Unlocked by override</Badge>}
            </div>
            <section>
              <h3 className="text-[13px] font-semibold mb-2">Move to</h3>
              <div className="flex flex-wrap gap-2">
                {(DELIVERABLE_TRANSITIONS[d.status] ?? []).map(s => (
                  <Button key={s} size="sm" onClick={() => { setNote(''); setStatusDlg(s); }}>{s}</Button>
                ))}
              </div>
            </section>
            <KV
              cols={2}
              items={[
                ['Quantity', fmtQty(d.quantity, d.unit)],
                ['Category', d.category ?? '—'],
                ['Start', fmtDate(d.start_date)],
                ['Due', fmtDate(d.due_date)],
                ['Timeline', d.timeline ?? '—'],
                ['Weightage', d.weightage != null ? `${d.weightage}%` : '—'],
                ['Responsible', d.responsible_name ?? 'Unassigned'],
                ['Team', d.assigned_team ?? '—'],
                ['Client action', d.client_action ?? '—'],
                ['Reference', d.reference_url && /^https?:\/\//.test(d.reference_url) ? <LinkRef url={d.reference_url} label="Open" /> : '—'],
              ]}
            />
            {d.description && <p className="text-[13px] text-ink-2 whitespace-pre-line">{d.description}</p>}

            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[13px] font-semibold">Client dependencies</h3>
                {!['Draft', 'Cancelled', 'Completed', 'Ready for Download'].includes(d.status) && (
                  <Button size="sm" icon={Plus} onClick={() => setDepForm({ name: '', desc: '', by: '' })}>Request</Button>
                )}
              </div>
              {deps.length === 0 ? <p className="text-xs text-ink-3">None requested.</p> : (
                <ul className="space-y-1.5">{deps.map(x => <li key={x.id} className="flex items-center justify-between text-[13px] gap-2"><span className="truncate">{x.name}</span><Status s={x.status} /></li>)}</ul>
              )}
            </section>

            <section>
              <h3 className="text-[13px] font-semibold mb-2">Files</h3>
              <StaffFiles files={files} onArchived={() => void reload()} />
              <div className="mt-3"><UploadBox parentType="deliverable" parentId={d.id} existing={files} allowFinal onDone={() => void reload()} /></div>
            </section>

            <StaffClientReview deliverableId={d.id} deliverableStatus={d.status} nameOf={(id) => employees.find((e) => e.id === id)?.name ?? 'Team member'} onChanged={reload} />

            <DeliverableThread deliverableId={d.id} staff />

            <section>
              <h3 className="text-[13px] font-semibold mb-2">Download access</h3>
              <p className="text-xs text-ink-2 mb-2">
                {d.lock_state === 'unlocked' ? 'Follows the payment lock rules.' : d.lock_state === 'override_unlocked' ? 'Unlocked manually; payment rules will not lock it until reset.' : d.lock_reason ?? 'Locked.'}
              </p>
              <div className="flex gap-2 flex-wrap">
                {d.lock_state !== 'locked_manual' && <Button size="sm" icon={Lock} onClick={() => { setNote(''); setLockDlg('lock'); }}>Lock</Button>}
                {isLocked(d.lock_state) && <Button size="sm" icon={Unlock} onClick={() => { setNote(''); setLockDlg('unlock'); }}>Unlock (override)</Button>}
                {d.lock_state !== 'unlocked' && <Button size="sm" onClick={() => { setNote(''); setLockDlg('auto'); }}>Reset to payment rules</Button>}
              </div>
            </section>

            <section>
              <h3 className="text-[13px] font-semibold mb-2 flex items-center gap-1.5"><History size={14} /> Scope versions</h3>
              <Timeline items={versions.map(v => ({
                title: `Version ${v.version_no} · ${v.change_source.replace('_', ' ')}`,
                meta: fmtDate(v.created_at, true),
                body: <span>Qty {fmtQty(v.snapshot.quantity as number, v.snapshot.unit as string | null)} · due {fmtDate(v.snapshot.due_date as string | null)}{v.reason ? ` · ${v.reason}` : ''}</span>,
              }))} />
            </section>
          </div>
        )}
      </SidePanel>

      <SidePanel
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit === 'create' ? 'Add deliverable' : 'Edit deliverable'}
        sub={edit === 'edit' && d && d.status !== 'Draft' ? 'Scope edits on active deliverables are versioned and need a reason.' : undefined}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy === 'save'} disabled={!formValid || (!!scopeChanged && reason.trim().length < 5)} onClick={saveDeliverable}>Save</Button></>}
      >
        <div className="space-y-4">
          <Field label="Name" required><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Description / scope"><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category"><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Branding, Marketing…" /></Field>
            <Field label="Priority"><Select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>{['Low', 'Medium', 'High', 'Critical'].map(p => <option key={p}>{p}</option>)}</Select></Field>
            <Field label="Quantity" required><Input type="number" min={0} step="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></Field>
            <Field label="Unit"><Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="Posts, Videos…" /></Field>
            <Field label="Start date"><Input type="date" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></Field>
            <Field label="Due date"><Input type="date" value={form.due} onChange={e => setForm({ ...form, due: e.target.value })} /></Field>
            <Field label="Timeline (text)"><Input value={form.timeline} onChange={e => setForm({ ...form, timeline: e.target.value })} placeholder="10 days, Monthly…" /></Field>
            <Field label="Weightage %"><Input type="number" min={0} max={100} step="0.5" value={form.weightage} onChange={e => setForm({ ...form, weightage: e.target.value })} /></Field>
          </div>
          <Field label="Responsible employee">
            <Select value={form.responsible} onChange={e => setForm({ ...form, responsible: e.target.value })}>
              <option value="">Unassigned</option>
              {employees.filter(e => e.status !== 'inactive').map(e => <option key={e.id} value={e.id}>{e.name}{e.designation ? ` (${e.designation})` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Assigned team"><Input value={form.team} onChange={e => setForm({ ...form, team: e.target.value })} /></Field>
          <Field label="What the client must provide"><Input value={form.deps} onChange={e => setForm({ ...form, deps: e.target.value })} placeholder="e.g. Logo files, product photos" /></Field>
          <Field label="Reference link"><Input value={form.ref} onChange={e => setForm({ ...form, ref: e.target.value })} placeholder="https://" error={!!form.ref && !/^https?:\/\//.test(form.ref)} /></Field>
          {scopeChanged && <Field label="Reason for scope change" required><Textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>}
        </div>
      </SidePanel>

      <Dialog
        open={!!statusDlg}
        onClose={() => setStatusDlg(null)}
        title={`Move to “${statusDlg}”`}
        desc={statusDlg === 'Ready for Download' ? 'Requires a final client-visible file. The client is notified.' : statusDlg === 'Awaiting Client Review' ? 'The client is notified to review the work.' : undefined}
        footer={<><Button onClick={() => setStatusDlg(null)}>Cancel</Button><Button variant="primary" loading={busy === 'status'} onClick={async () => { if (d && await run('status', async () => { await rpc('staff_set_deliverable_status', { p_deliverable_id: d.id, p_status: statusDlg, p_note: note.trim() || null }); await reload(); }, 'Status updated.')) setStatusDlg(null); }}>Confirm</Button></>}
      >
        <Field label="Note (optional)"><Input value={note} onChange={e => setNote(e.target.value)} /></Field>
      </Dialog>

      <Dialog
        open={!!lockDlg}
        onClose={() => setLockDlg(null)}
        title={lockDlg === 'lock' ? 'Lock downloads' : lockDlg === 'unlock' ? 'Unlock downloads (override)' : 'Reset to payment rules'}
        desc="Recorded with your name, the time, previous and new state, and the reason."
        footer={<><Button onClick={() => setLockDlg(null)}>Cancel</Button><Button variant="primary" disabled={note.trim().length < 5} loading={busy === 'lock'} onClick={async () => { if (d && await run('lock', async () => { await rpc('staff_set_deliverable_lock', { p_deliverable_id: d.id, p_action: lockDlg, p_reason: note.trim() }); await reload(); }, 'Access updated.')) setLockDlg(null); }}>Confirm</Button></>}
      >
        <Field label="Reason" required><Textarea value={note} onChange={e => setNote(e.target.value)} /></Field>
      </Dialog>

      <Dialog
        open={!!depForm}
        onClose={() => setDepForm(null)}
        title="Request from client"
        desc="The client is notified and the deliverable moves to Awaiting Client Dependency."
        footer={<><Button onClick={() => setDepForm(null)}>Cancel</Button><Button variant="primary" disabled={!depForm || depForm.name.trim().length < 2} loading={busy === 'dep'} onClick={async () => { if (d && depForm && await run('dep', async () => { await rpc('staff_request_dependency', { p_deliverable_id: d.id, p_name: depForm.name.trim(), p_description: depForm.desc.trim() || null, p_required_by: depForm.by || null }); await reload(); }, 'Request sent to the client.')) setDepForm(null); }}>Send request</Button></>}
      >
        {depForm && (
          <div className="space-y-3">
            <Field label="What is needed" required><Input value={depForm.name} onChange={e => setDepForm({ ...depForm, name: e.target.value })} placeholder="Logo files" /></Field>
            <Field label="Details"><Textarea value={depForm.desc} onChange={e => setDepForm({ ...depForm, desc: e.target.value })} /></Field>
            <Field label="Needed by"><Input type="date" min={today} value={depForm.by} onChange={e => setDepForm({ ...depForm, by: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>

      <Dialog
        open={archive}
        onClose={() => setArchive(false)}
        tone="danger"
        title="Archive deliverable"
        desc="It is removed from active views; history and audit records are kept."
        footer={<><Button onClick={() => setArchive(false)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 5} loading={busy === 'arch'} onClick={async () => { if (d && await run('arch', async () => { await rpc('staff_archive_deliverable', { p_deliverable_id: d.id, p_reason: reason.trim() }); setSelected(null); await reload(); }, 'Deliverable archived.')) setArchive(false); }}>Archive</Button></>}
      >
        <Field label="Reason" required><Textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </Dialog>
    </>
  );
}

/* ----------------------------------------------------------- Modifications */

function ModificationsTab({ ws, reload }: { ws: ProjectWorkspace; reload: () => Promise<void> }) {
  const { busy, run } = useBusy();
  const [tab, setTab] = useState('open');
  const [sel, setSel] = useState<string | null>(null);
  const [decision, setDecision] = useState<'approve' | 'reject' | 'counter'>('approve');
  const [comment, setComment] = useState('');
  const [counter, setCounter] = useState('');
  const [billing, setBilling] = useState('');
  const m = ws.modifications.find(x => x.id === sel) ?? null;
  const deliv = (m: ModificationRow) => ws.deliverables.find(d => d.id === m.deliverable_id);
  const rows = ws.modifications.filter(x => (tab === 'open' ? OPEN_MODIFICATION.includes(x.status) : !OPEN_MODIFICATION.includes(x.status)));

  const submit = async () => {
    if (!m) return;
    const args: Record<string, unknown> = { p_request_id: m.id, p_decision: decision, p_comment: comment.trim(), p_billing_note: billing.trim() || null };
    if (decision === 'counter') {
      if (m.modification_type === 'quantity') args.p_counter_quantity = Number(counter);
      else if (m.modification_type === 'timeline') args.p_counter_due_date = counter;
      else args.p_counter_value = counter.trim();
    }
    if (await run('dec', async () => { await rpc('staff_review_modification', args); await reload(); }, 'Decision recorded and client notified.')) setSel(null);
  };

  return (
    <>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'open', label: 'Open', count: ws.modifications.filter(x => OPEN_MODIFICATION.includes(x.status)).length }, { id: 'closed', label: 'Decided' }]} />
      <DataTable
        rows={rows}
        onRow={r => { setSel(r.id); setDecision('approve'); setComment(''); setCounter(''); setBilling(''); }}
        empty={<Empty icon={GitPullRequest} title="No requests" desc="Client modification requests appear here." />}
        cols={[
          { key: 'n', head: 'Request', mobile: 'title', render: r => <div><div className="font-medium">{r.request_number} · {r.field}</div><div className="text-xs text-ink-3">{deliv(r)?.deliverable_number} {deliv(r)?.name}</div></div> },
          { key: 'c', head: 'Change', render: r => <span className="text-xs"><span className="line-through text-ink-3">{r.previous_value}</span> → <b>{r.requested_value.slice(0, 60)}</b>{r.quantity_delta != null && ` (${r.quantity_delta > 0 ? '+' : ''}${Number(r.quantity_delta)})`}</span> },
          { key: 'b', head: 'By', render: r => <span className="text-xs">{r.requested_by_name ?? 'Client'} · {fmtDate(r.created_at)}</span> },
          { key: 's', head: 'Status', render: r => <Status s={r.status} /> },
        ]}
      />
      <SidePanel
        open={!!m}
        onClose={() => setSel(null)}
        title={m ? `${m.request_number} · ${m.field}` : ''}
        sub={m ? `${deliv(m)?.deliverable_number ?? ''} ${deliv(m)?.name ?? ''}` : undefined}
        footer={m?.status === 'Pending Review' ? <><Button onClick={() => setSel(null)}>Close</Button><Button variant="primary" loading={busy === 'dec'} disabled={(decision !== 'approve' && comment.trim().length < 3) || (decision === 'counter' && !counter.trim())} onClick={submit}>Record decision</Button></> : undefined}
      >
        {m && (
          <div className="space-y-5">
            <Status s={m.status} />
            <KV items={[
              ['Type', m.modification_type],
              ['Current', m.previous_value ?? '—'],
              ['Requested', m.requested_value],
              ['Difference', m.quantity_delta != null ? `${m.quantity_delta > 0 ? '+' : ''}${Number(m.quantity_delta)}` : '—'],
              ['Reason', m.reason ?? '—'],
              ['Submitted', fmtDate(m.created_at, true)],
            ]} />
            {m.reviewer_comment && <Alert title={`Decision by ${m.reviewer_name ?? 'team'}`}>{m.reviewer_comment}{m.billing_note ? ` · Billing: ${m.billing_note}` : ''}</Alert>}
            {m.status === 'Pending Review' && (
              <div className="space-y-4">
                <Field label="Decision">
                  <Select value={decision} onChange={e => setDecision(e.target.value as typeof decision)}>
                    <option value="approve">Approve — apply and version the scope</option>
                    <option value="reject">Reject</option>
                    {m.modification_type !== 'revision' && m.modification_type !== 'other' && <option value="counter">Counter-propose</option>}
                  </Select>
                </Field>
                {decision === 'counter' && (
                  <Field label="Counter-proposal" required>
                    {m.modification_type === 'quantity' ? <Input type="number" min={0} value={counter} onChange={e => setCounter(e.target.value)} />
                      : m.modification_type === 'timeline' ? <Input type="date" value={counter} onChange={e => setCounter(e.target.value)} />
                      : <Textarea value={counter} onChange={e => setCounter(e.target.value)} />}
                  </Field>
                )}
                <Field label="Comment to client" required={decision !== 'approve'}><Textarea value={comment} onChange={e => setComment(e.target.value)} /></Field>
                <Field label="Billing / commercial impact" hint="Recorded with the decision for finance."><Input value={billing} onChange={e => setBilling(e.target.value)} placeholder="e.g. +5 posts at ₹2,000 each from next cycle" /></Field>
              </div>
            )}
          </div>
        )}
      </SidePanel>
    </>
  );
}

/* ------------------------------------------------------------ Dependencies */

function DependenciesTab({ ws, reload }: { ws: ProjectWorkspace; reload: () => Promise<void> }) {
  const { busy, run } = useBusy();
  const [sel, setSel] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const dep = ws.dependencies.find(x => x.id === sel) ?? null;
  const files = dep ? latestFiles(ws.files.filter(f => f.parent_type === 'dependency' && f.parent_id === dep.id)) : [];
  const decide = async (decision: 'accept' | 'reject' | 'resubmit') => {
    if (!dep) return;
    if (await run(decision, async () => { await rpc('staff_review_dependency', { p_dependency_id: dep.id, p_decision: decision, p_comment: comment.trim() || null }); await reload(); }, 'Recorded.')) setSel(null);
  };
  return (
    <>
      <DataTable
        rows={ws.dependencies}
        onRow={r => { setSel(r.id); setComment(''); }}
        empty={<Empty icon={Upload} title="No client dependencies" desc="Request information or files from the client on a deliverable." />}
        cols={[
          { key: 'n', head: 'Item', mobile: 'title', render: r => <div><div className="font-medium">{r.name}</div><div className="text-xs text-ink-3">{ws.deliverables.find(d => d.id === r.deliverable_id)?.name}</div></div> },
          { key: 'b', head: 'Needed by', render: r => <span className="text-xs">{fmtDate(r.required_by)}</span> },
          { key: 'u', head: 'Uploaded', render: r => <span className="text-xs">{fmtDate(r.uploaded_at, true)}</span> },
          { key: 's', head: 'Status', render: r => <Status s={r.status} /> },
        ]}
      />
      <SidePanel
        open={!!dep}
        onClose={() => setSel(null)}
        title={dep?.name ?? ''}
        footer={dep?.status === 'Uploaded' ? <><Button variant="danger" disabled={comment.trim().length < 3} loading={busy === 'reject'} onClick={() => decide('reject')}>Reject</Button><Button disabled={comment.trim().length < 3} loading={busy === 'resubmit'} onClick={() => decide('resubmit')}>Ask to resubmit</Button><Button variant="primary" loading={busy === 'accept'} onClick={() => decide('accept')}>Accept</Button></> : undefined}
      >
        {dep && (
          <div className="space-y-4">
            <Status s={dep.status} />
            {dep.description && <p className="text-[13px] text-ink-2">{dep.description}</p>}
            {dep.client_note && <Alert title="Client note">{dep.client_note}</Alert>}
            <StaffFiles files={files} />
            {dep.status === 'Uploaded' && <Field label="Comment" hint="Required to reject or ask for resubmission."><Textarea value={comment} onChange={e => setComment(e.target.value)} /></Field>}
          </div>
        )}
      </SidePanel>
    </>
  );
}

/* ------------------------------------------------------------------ Billing */

function BillingTab({ ws, projectId, clientId, mode, reload }: { ws: ProjectWorkspace; projectId: string; clientId: string | null; mode: 'admin' | 'manager'; reload: () => Promise<void> }) {
  const { busy, run } = useBusy();
  const contract = ws.contracts[0] ?? null;
  const [sel, setSel] = useState<string | null>(null);
  const [add, setAdd] = useState<'single' | 'recurring' | null>(null);
  const [mf, setMf] = useState({ name: '', basisType: 'fixed', amount: '', pct: '', tax: '0', due: '', months: '3' });
  const [payDlg, setPayDlg] = useState(false);
  const [pf, setPf] = useState({ amount: '', reference: '', paidOn: todayIST(), method: 'bank_transfer', notes: '', key: '' });
  const [verify, setVerify] = useState<{ id: string; approve: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState<string | null>(null);
  const inst = ws.installments.find(i => i.id === sel) ?? null;
  const submitted = ws.payments.filter(p => p.status === 'Submitted');

  const billable = ws.installments.filter(i => !['Cancelled', 'Waived'].includes(i.status));
  const billed = billable.reduce((s, i) => s + installmentTotal(i), 0);
  const collected = billable.reduce((s, i) => s + Number(i.amount_paid), 0);
  const overdue = billable.filter(i => i.status === 'Overdue').reduce((s, i) => s + installmentTotal(i) - Number(i.amount_paid), 0);
  const plannedPct = ws.installments.filter(i => i.basis_type === 'percentage' && !['Cancelled', 'Waived'].includes(i.status)).reduce((s, i) => s + Number(i.percentage ?? 0), 0);

  const addMilestone = async () => {
    if (add === 'recurring') {
      await run('add', async () => {
        await rpc('finance_generate_recurring_installments', {
          p_project_id: projectId, p_contract_id: contract?.id ?? null, p_name: mf.name.trim(), p_amount: Number(mf.amount),
          p_tax_amount: Number(mf.tax || 0), p_first_due: mf.due, p_months: Number(mf.months),
        });
        setAdd(null);
        await reload();
      }, 'Recurring milestones created.');
      return;
    }
    await run('add', async () => {
      await must(db.from('payment_installments').insert({
        project_id: projectId,
        contract_id: contract?.id ?? null,
        name: mf.name.trim(),
        basis_type: mf.basisType,
        percentage: mf.basisType === 'percentage' ? Number(mf.pct) : null,
        amount: mf.basisType === 'percentage' ? 0 : Number(mf.amount),
        basis: mf.basisType === 'fixed' ? 'Fixed amount' : null,
        tax_amount: Number(mf.tax || 0),
        due_date: mf.due || null,
        status: 'Upcoming',
      }).select('id').single());
      setAdd(null);
      await reload();
    }, 'Milestone added.');
  };

  const mfValid = mf.name.trim().length >= 2 && Number(mf.tax || 0) >= 0 && (
    add === 'recurring' ? Number(mf.amount) > 0 && !!mf.due && Number(mf.months) >= 1 && Number(mf.months) <= 36
    : mf.basisType === 'percentage' ? Number(mf.pct) > 0 && Number(mf.pct) <= 100 && contract?.contract_value != null
    : Number(mf.amount) > 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Contract value" value={contract?.contract_value != null ? inr(contract.contract_value) : '—'} sub={contract?.tax_note ?? undefined} />
        <Stat label="Billed" value={inr(billed)} sub={plannedPct ? `${plannedPct}% of contract in % milestones` : undefined} />
        <Stat label="Collected" value={inr(collected)} sub="Verified payments" />
        <Stat label="Overdue" value={inr(overdue)} tone={overdue ? 'err' : undefined} sub={overdue ? 'Past due date' : 'None'} />
      </div>

      {submitted.length > 0 && (
        <Card>
          <CardHead title="Payments awaiting verification" desc="Client-submitted references are not counted until verified against the bank statement." />
          <ul className="divide-y divide-line">
            {submitted.map(p => {
              const proof = ws.files.find(f => f.id === p.proof_file_id);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium">{inr(p.amount)} · {ws.installments.find(i => i.id === p.installment_id)?.name}</div>
                    <div className="text-xs text-ink-3">Ref {p.reference} · paid {fmtDate(p.paid_on)} · {p.method?.replace('_', ' ') ?? '—'}</div>
                  </div>
                  {proof && <Button size="sm" onClick={() => run('p' + p.id, () => openFile(proof))}>Proof</Button>}
                  {mode === 'admin' && (
                    <>
                      <Button size="sm" variant="danger" onClick={() => { setReason(''); setVerify({ id: p.id, approve: false }); }}>Reject</Button>
                      <Button size="sm" variant="primary" onClick={() => { setReason(''); setVerify({ id: p.id, approve: true }); }}>Verify</Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <FilterBar>
        <div className="flex-1" />
        {mode === 'admin' && <Button onClick={() => { setMf({ name: 'Monthly retainer', basisType: 'recurring', amount: '', pct: '', tax: '0', due: '', months: '3' }); setAdd('recurring'); }}>Recurring billing</Button>}
        {mode === 'admin' && <Button variant="primary" icon={Plus} onClick={() => { setMf({ name: '', basisType: contract?.contract_value != null ? 'percentage' : 'fixed', amount: '', pct: '', tax: '0', due: '', months: '3' }); setAdd('single'); }}>Add milestone</Button>}
      </FilterBar>

      <DataTable
        rows={ws.installments}
        pageSize={12}
        onRow={r => setSel(r.id)}
        empty={<Empty icon={CreditCard} title="No payment milestones" desc="Add the payment schedule agreed in the contract." />}
        cols={[
          { key: 'n', head: '#', w: '44px', mobile: 'hide', render: r => <span className="font-mono text-xs">{r.installment_number}</span> },
          { key: 'm', head: 'Milestone', mobile: 'title', render: r => <div><div className="font-medium">{r.name}</div><div className="text-xs text-ink-3">{r.basis ?? r.basis_type}</div></div> },
          { key: 'a', head: 'Total', align: 'right', render: r => inr(installmentTotal(r)) },
          { key: 'p', head: 'Paid', align: 'right', render: r => inr(r.amount_paid) },
          { key: 'd', head: 'Due', render: r => <span className="text-xs">{fmtDate(r.due_date)}</span> },
          { key: 's', head: 'Status', render: r => <Status s={r.status} /> },
          { key: 'i', head: 'Invoice', render: r => <span className="font-mono text-xs">{r.invoice_number ?? '—'}</span> },
        ]}
      />

      {mode === 'admin' && clientId && <BillingRules clientId={clientId} />}

      <SidePanel
        open={!!inst}
        onClose={() => setSel(null)}
        title={inst?.name ?? ''}
        sub={inst ? `Milestone ${inst.installment_number}` : undefined}
        footer={inst && mode === 'admin' ? (
          <>
            {!inst.invoice_number && !['Cancelled', 'Waived'].includes(inst.status) && <Button loading={busy === 'inv'} onClick={() => run('inv', async () => { await rpc('finance_issue_invoice', { p_installment_id: inst.id }); await reload(); }, 'Invoice number issued and client notified.')}>Issue invoice</Button>}
            {!['Paid', 'Cancelled', 'Waived'].includes(inst.status) && <Button variant="primary" onClick={() => { setPf({ amount: String(installmentTotal(inst) - Number(inst.amount_paid)), reference: '', paidOn: todayIST(), method: 'bank_transfer', notes: '', key: idempotencyKey('rec') }); setPayDlg(true); }}>Record payment</Button>}
          </>
        ) : undefined}
      >
        {inst && (
          <div className="space-y-5">
            <Status s={inst.status} />
            <KV items={[
              ['Amount', inr(inst.amount)], ['Tax', inr(inst.tax_amount)], ['Total', inr(installmentTotal(inst))], ['Paid', inr(inst.amount_paid)],
              ['Due', fmtDate(inst.due_date)], ['Basis', inst.basis ?? inst.basis_type], ['Invoice', inst.invoice_number ?? '—'], ['Issued', fmtDate(inst.invoice_issued_at)],
            ]} />
            {inst.status_reason && <Alert tone="warn" title={`Status override: ${inst.status_override ?? 'cleared'}`}>{inst.status_reason}</Alert>}
            <section>
              <h3 className="text-[13px] font-semibold mb-2">Payments</h3>
              <Timeline items={ws.payments.filter(p => p.installment_id === inst.id).map(p => ({
                tone: p.status === 'Verified' ? ('ok' as const) : p.status === 'Rejected' ? ('err' as const) : ('warn' as const),
                title: `${inr(p.amount)} · ${p.status}${p.source === 'finance' ? ' (recorded by finance)' : ''}`,
                meta: `Ref ${p.reference} · ${fmtDate(p.paid_on)}`,
                body: p.rejection_reason ?? p.notes ?? undefined,
              }))} />
            </section>
            {mode === 'admin' && (
              <section className="space-y-3">
                <h3 className="text-[13px] font-semibold">Invoice / receipt files</h3>
                <StaffFiles files={latestFiles(ws.files.filter(f => f.parent_type === 'invoice' && f.parent_id === inst.id))} />
                <UploadBox parentType="invoice" parentId={inst.id} existing={latestFiles(ws.files.filter(f => f.parent_type === 'invoice' && f.parent_id === inst.id))} defaultVisibility="client" onDone={() => void reload()} />
                <h3 className="text-[13px] font-semibold pt-2">Status override</h3>
                <div className="flex flex-wrap gap-2">
                  {['Disputed', 'Cancelled', 'Waived'].filter(s => s !== inst.status_override).map(s => <Button key={s} size="sm" onClick={() => { setReason(''); setOverride(s); }}>{s}</Button>)}
                  {inst.status_override && <Button size="sm" onClick={() => { setReason(''); setOverride('clear'); }}>Clear override</Button>}
                </div>
              </section>
            )}
          </div>
        )}
      </SidePanel>

      <SidePanel
        open={!!add}
        onClose={() => setAdd(null)}
        title={add === 'recurring' ? 'Recurring monthly billing' : 'Add payment milestone'}
        footer={<><Button onClick={() => setAdd(null)}>Cancel</Button><Button variant="primary" disabled={!mfValid} loading={busy === 'add'} onClick={addMilestone}>Save</Button></>}
      >
        <div className="space-y-4">
          <Field label={add === 'recurring' ? 'Name prefix' : 'Milestone name'} required><Input value={mf.name} onChange={e => setMf({ ...mf, name: e.target.value })} placeholder="Advance" /></Field>
          {add === 'single' && (
            <Field label="Basis">
              <Select value={mf.basisType} onChange={e => setMf({ ...mf, basisType: e.target.value })}>
                <option value="percentage" disabled={contract?.contract_value == null}>Percentage of contract value</option>
                <option value="fixed">Fixed amount</option>
              </Select>
            </Field>
          )}
          {add === 'single' && mf.basisType === 'percentage' ? (
            <Field label="Percentage" required hint={contract?.contract_value != null && mf.pct ? `= ${inr((Number(contract.contract_value) * Number(mf.pct)) / 100)} of ${inr(contract.contract_value)}` : 'Requires a contract value.'}>
              <Input type="number" min={0.01} max={100} step="0.01" value={mf.pct} onChange={e => setMf({ ...mf, pct: e.target.value })} />
            </Field>
          ) : (
            <Field label={add === 'recurring' ? 'Monthly amount (₹, before tax)' : 'Amount (₹, before tax)'} required><Input type="number" min={1} step="0.01" value={mf.amount} onChange={e => setMf({ ...mf, amount: e.target.value })} /></Field>
          )}
          <Field label="Tax amount (₹)" hint="Enter the GST amount for this milestone; it is added to the total due."><Input type="number" min={0} step="0.01" value={mf.tax} onChange={e => setMf({ ...mf, tax: e.target.value })} /></Field>
          <Field label={add === 'recurring' ? 'First due date' : 'Due date'} required={add === 'recurring'}><Input type="date" value={mf.due} onChange={e => setMf({ ...mf, due: e.target.value })} /></Field>
          {add === 'recurring' && <Field label="Number of months" required><Input type="number" min={1} max={36} value={mf.months} onChange={e => setMf({ ...mf, months: e.target.value })} /></Field>}
        </div>
      </SidePanel>

      <Dialog
        open={payDlg}
        onClose={() => setPayDlg(false)}
        title="Record received payment"
        desc="Use only for funds confirmed on the bank statement. This marks the amount as verified."
        footer={<><Button onClick={() => setPayDlg(false)}>Cancel</Button><Button variant="primary" disabled={!inst || Number(pf.amount) <= 0 || pf.reference.trim().length < 3 || !pf.paidOn} loading={busy === 'rec'} onClick={async () => { if (inst && await run('rec', async () => { await rpc('finance_record_payment', { p_installment_id: inst.id, p_amount: Number(pf.amount), p_reference: pf.reference.trim(), p_paid_on: pf.paidOn, p_method: pf.method, p_notes: pf.notes.trim() || null, p_idempotency_key: pf.key }); await reload(); }, 'Payment recorded.')) setPayDlg(false); }}>Record</Button></>}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)" required><Input type="number" min={1} step="0.01" value={pf.amount} onChange={e => setPf({ ...pf, amount: e.target.value })} /></Field>
            <Field label="Received on" required><Input type="date" max={todayIST()} value={pf.paidOn} onChange={e => setPf({ ...pf, paidOn: e.target.value })} /></Field>
          </div>
          <Field label="Bank reference / UTR" required><Input value={pf.reference} onChange={e => setPf({ ...pf, reference: e.target.value })} /></Field>
          <Field label="Method"><Select value={pf.method} onChange={e => setPf({ ...pf, method: e.target.value })}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cheque">Cheque</option><option value="card">Card</option><option value="cash">Cash</option><option value="other">Other</option></Select></Field>
          <Field label="Notes"><Input value={pf.notes} onChange={e => setPf({ ...pf, notes: e.target.value })} /></Field>
        </div>
      </Dialog>

      <Dialog
        open={!!verify}
        onClose={() => setVerify(null)}
        tone={verify?.approve ? undefined : 'danger'}
        title={verify?.approve ? 'Verify payment' : 'Reject payment'}
        desc={verify?.approve ? 'Confirm the funds appear on the bank statement.' : 'The client is notified with your reason.'}
        footer={<><Button onClick={() => setVerify(null)}>Cancel</Button><Button variant={verify?.approve ? 'primary' : 'danger'} disabled={!verify?.approve && reason.trim().length < 3} loading={busy === 'ver'} onClick={async () => { if (verify && await run('ver', async () => { await rpc('finance_verify_payment', { p_payment_id: verify.id, p_approve: verify.approve, p_reason: reason.trim() || null }); await reload(); }, verify.approve ? 'Payment verified.' : 'Payment rejected.')) setVerify(null); }}>Confirm</Button></>}
      >
        <Field label={verify?.approve ? 'Note (optional)' : 'Reason'} required={!verify?.approve}><Input value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </Dialog>

      <Dialog
        open={!!override}
        onClose={() => setOverride(null)}
        title={override === 'clear' ? 'Clear status override' : `Mark as ${override}`}
        footer={<><Button onClick={() => setOverride(null)}>Cancel</Button><Button variant="primary" disabled={reason.trim().length < 5} loading={busy === 'ovr'} onClick={async () => { if (inst && await run('ovr', async () => { await rpc('finance_set_installment_override', { p_installment_id: inst.id, p_override: override === 'clear' ? null : override, p_reason: reason.trim() }); await reload(); }, 'Status updated.')) setOverride(null); }}>Confirm</Button></>}
      >
        <Field label="Reason" required><Textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}

function BillingRules({ clientId }: { clientId: string }) {
  const { busy, run } = useBusy();
  const [global, setGlobal] = useState<{ auto_lock_enabled: boolean; grace_days: number; due_soon_days: number; reminder_days_before: number } | null>(null);
  const [rule, setRule] = useState<{ useGlobal: boolean; enabled: boolean; grace: string }>({ useGlobal: true, enabled: false, grace: '0' });
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const g = await must<any>(db.from('billing_settings').select('*').eq('id', true).maybeSingle());
      const r = await must<any>(db.from('client_billing_rules').select('*').eq('client_id', clientId).maybeSingle());
      setGlobal(g);
      setRule(r ? { useGlobal: false, enabled: !!r.auto_lock_enabled, grace: String(r.grace_days ?? 0) } : { useGlobal: true, enabled: !!g?.auto_lock_enabled, grace: String(g?.grace_days ?? 0) });
      setErr(null);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <Alert tone="warn" title="Payment lock rules unavailable">{err}</Alert>;
  if (!global) return null;
  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <Card>
        <CardHead title="Organisation-wide payment rules" desc="Applies to every client unless overridden." />
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3"><span className="text-[13px]">Lock downloads when payment is overdue</span><Switch checked={global.auto_lock_enabled} onChange={v => setGlobal({ ...global, auto_lock_enabled: v })} label="Auto lock" /></div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Grace days"><Input type="number" min={0} max={365} value={global.grace_days} onChange={e => setGlobal({ ...global, grace_days: Number(e.target.value) })} /></Field>
            <Field label="'Due' window (days)"><Input type="number" min={0} max={90} value={global.due_soon_days} onChange={e => setGlobal({ ...global, due_soon_days: Number(e.target.value) })} /></Field>
            <Field label="Reminder (days before)"><Input type="number" min={0} max={60} value={global.reminder_days_before} onChange={e => setGlobal({ ...global, reminder_days_before: Number(e.target.value) })} /></Field>
          </div>
          <Button variant="primary" loading={busy === 'g'} onClick={() => run('g', async () => {
            await must(db.from('billing_settings').update({ auto_lock_enabled: global.auto_lock_enabled, grace_days: global.grace_days, due_soon_days: global.due_soon_days, reminder_days_before: global.reminder_days_before, updated_at: new Date().toISOString() }).eq('id', true).select('id').single());
            await rpc('refresh_billing_state');
            await load();
          }, 'Payment rules saved and evaluated.')}>Save rules</Button>
        </div>
      </Card>
      <Card>
        <CardHead title="This client" />
        <div className="space-y-4">
          <Checkbox checked={rule.useGlobal} onChange={v => setRule({ ...rule, useGlobal: v })} label="Use organisation-wide rules" />
          {!rule.useGlobal && (
            <>
              <div className="flex items-center justify-between gap-3"><span className="text-[13px]">Lock downloads when overdue</span><Switch checked={rule.enabled} onChange={v => setRule({ ...rule, enabled: v })} label="Client auto lock" /></div>
              <Field label="Grace days"><Input type="number" min={0} max={365} value={rule.grace} onChange={e => setRule({ ...rule, grace: e.target.value })} /></Field>
            </>
          )}
          <Button loading={busy === 'c'} onClick={() => run('c', async () => {
            if (rule.useGlobal) await must(db.from('client_billing_rules').delete().eq('client_id', clientId));
            else await must(db.from('client_billing_rules').upsert({ client_id: clientId, auto_lock_enabled: rule.enabled, grace_days: Number(rule.grace), updated_at: new Date().toISOString() }));
            await rpc('refresh_billing_state');
            await load();
          }, 'Client payment rule saved.')}>Save</Button>
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- Activity */

function ActivityTab({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const size = 50;
  useEffect(() => {
    (async () => {
      try {
        setRows(await must(db.from('audit_logs').select('*').eq('project_id', projectId).order('occurred_at', { ascending: false }).range(page * size, page * size + size - 1)));
      } catch (e) {
        setErr(errorMessage(e));
      }
    })();
  }, [projectId, page]);
  if (err) return <Alert tone="warn" title="Audit log unavailable">{err}</Alert>;
  if (!rows) return <p className="text-xs text-ink-3">Loading…</p>;
  const describe = (r: any) => {
    const keys = Object.keys(r.changes ?? {}).filter(k => !['updated_at', 'created_at'].includes(k));
    if (r.action !== 'update') return `${r.action} ${r.entity_type.replace(/_/g, ' ')}`;
    return keys.slice(0, 4).map(k => {
      const c = r.changes[k];
      return `${k.replace(/_/g, ' ')}: ${JSON.stringify(c?.from ?? null)} → ${JSON.stringify(c?.to ?? null)}`;
    }).join(' · ');
  };
  return (
    <Card>
      <CardHead title="Activity" desc="Immutable audit log for this project — who changed what, when, from what to what." />
      {rows.length === 0 ? <p className="text-[13px] text-ink-3">No activity recorded yet.</p> : (
        <Timeline items={rows.map(r => ({
          title: <span><b>{r.entity_type.replace(/_/g, ' ')}</b> · {describe(r)}</span>,
          meta: `${fmtDate(r.occurred_at, true)} · ${r.actor_role ?? 'system'}${r.ip_address ? ` · ${r.ip_address}` : ''}`,
          body: r.reason ?? undefined,
        }))} />
      )}
      <div className="flex justify-end gap-2 mt-4">
        <Button size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Newer</Button>
        <Button size="sm" disabled={rows.length < size} onClick={() => setPage(p => p + 1)}>Older</Button>
      </div>
    </Card>
  );
}
