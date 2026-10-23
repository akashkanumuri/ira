/**
 * SIGMA 1 client portal modules: Dashboard, Contracts, Deliverables,
 * Progress Tracker and Billing & Payment. Every action calls a validated RPC;
 * failures are shown to the user and nothing is reported as done until the
 * server confirms it.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Download,
  ExternalLink,
  FileSignature,
  FileText,
  GitPullRequest,
  History,
  Lock,
  Package,
  Paperclip,
  ShieldCheck,
  TrendingUp,
  Upload,
  X,
} from 'lucide-react';
import type { AuthUser } from '../../contexts/AuthContext';
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
  PageHeader,
  Progress,
  SearchField,
  Select,
  SidePanel,
  Stat,
  Status,
  Tabs,
  Textarea,
  Timeline,
  cx,
  useToast,
} from './ClientUI';
import {
  ACCEPT_ATTR,
  AWAITING_CLIENT_CONTRACT,
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
  openFile,
  rpc,
  todayIST,
  uploadAndAttach,
  validateFile,
  type ContractRow,
  type DeliverableRow,
  type DependencyRow,
  type FileRow,
  type InstallmentRow,
  type ModificationRow,
  type ProjectWorkspace,
} from '../../lib/sigma';
import { Stat as UiStat } from '../../ui';
import { Gauge, Ring } from '../../ui/charts';
import { greeting } from '../../ui/motion';

export type ClientPage = 'dashboard' | 'contracts' | 'deliverables' | 'progress' | 'payments' | 'settings' | 'notifications';

export interface WorkspaceProject {
  id: string;
  name: string;
  description: string | null;
  status: string;
  managerName: string;
  startDate: string | null;
  targetDate: string | null;
}

interface ViewProps {
  user: AuthUser;
  project: WorkspaceProject;
  ws: ProjectWorkspace;
  reload: () => Promise<void>;
  go: (p: ClientPage) => void;
}

const LOCK_MESSAGE = 'Download is temporarily unavailable because the associated payment is overdue.';
const MANUAL_LOCK_MESSAGE = 'Download is temporarily unavailable. Please contact your account manager.';

/** Client-facing label: the underlying status is preserved while access is locked. */
const clientStatus = (d: DeliverableRow) => (isLocked(d.lock_state) && d.status === 'Ready for Download' ? 'Locked' : d.status);

function lockText(d: DeliverableRow) {
  return d.lock_state === 'locked_payment' ? LOCK_MESSAGE : MANUAL_LOCK_MESSAGE;
}

function currentContract(ws: ProjectWorkspace): ContractRow | null {
  return ws.contracts[0] ?? null;
}

/* =========================================================================
   Shared: file list & picker
========================================================================= */

function FileList({
  files,
  emptyText,
  lockedMessage,
}: {
  files: FileRow[];
  emptyText: string;
  lockedMessage?: string | null;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (files.length === 0) return <p className="text-xs text-ink-3">{emptyText}</p>;
  return (
    <ul className="divide-y divide-line border border-line rounded-md">
      {files.map(f => (
        <li key={f.id} className="flex items-center gap-3 px-3 py-2.5">
          <FileText size={15} className="text-ink-3 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ink truncate">{f.name}</div>
            <div className="text-[11px] text-ink-3">
              v{f.version_no} · {fmtBytes(f.size_bytes)} · {fmtDate(f.created_at)}
              {f.is_final && <span className="ml-1.5 text-ok font-medium">Final</span>}
            </div>
          </div>
          {lockedMessage && f.is_final ? (
            <span className="inline-flex items-center gap-1 text-xs text-ink-3" title={lockedMessage}>
              <Lock size={13} /> Locked
            </span>
          ) : (
            <Button
              size="sm"
              icon={Download}
              loading={busy === f.id}
              onClick={async () => {
                setBusy(f.id);
                try {
                  await openFile(f);
                } catch (e) {
                  toast(errorMessage(e), 'err');
                } finally {
                  setBusy(null);
                }
              }}
            >
              Download
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function FilePicker({ files, onChange, label = 'Attach files' }: { files: File[]; onChange: (f: File[]) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <input
        ref={ref}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="sr-only"
        onChange={e => {
          const picked = Array.from(e.target.files ?? []);
          const bad = picked.map(validateFile).find(Boolean) ?? null;
          setErr(bad);
          if (!bad) onChange([...files, ...picked].slice(0, 10));
          e.target.value = '';
        }}
      />
      <Button type="button" icon={Paperclip} onClick={() => ref.current?.click()}>
        {label}
      </Button>
      {err && <p className="text-xs text-err mt-1.5">{err}</p>}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-ink-2">
              <FileText size={13} className="shrink-0" />
              <span className="truncate flex-1">{f.name}</span>
              <span className="text-ink-3">{fmtBytes(f.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                className="h-6 w-6 grid place-items-center rounded hover:bg-bg"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-ink-3 mt-1.5">PDF, images, Office documents, ZIP or video · up to 50 MB each.</p>
    </div>
  );
}

/* =========================================================================
   1. Dashboard
========================================================================= */

export function ClientDashboard({ user, project, ws, go }: ViewProps) {
  const contract = currentContract(ws);
  const today = todayIST();
  const prog = computeProgress(ws.deliverables);
  const count = (s: string[]) => ws.deliverables.filter(d => s.includes(d.status)).length;
  const overdueDeliv = ws.deliverables.filter(
    d => d.due_date && d.due_date < today && !['Completed', 'Ready for Download', 'Cancelled'].includes(d.status),
  ).length;
  const openDeps = ws.dependencies.filter(d => ['Requested', 'Pending', 'Rejected', 'Resubmission Required'].includes(d.status));
  const awaitingReview = ws.deliverables.filter(d => d.status === 'Awaiting Client Review');
  const counters = ws.modifications.filter(m => m.status === 'Counter Proposed');
  const ready = ws.deliverables.filter(d => d.status === 'Ready for Download');
  const billable = ws.installments.filter(i => !['Cancelled', 'Waived'].includes(i.status));
  const totalBilled = billable.reduce((s, i) => s + installmentTotal(i), 0);
  const paid = billable.reduce((s, i) => s + Number(i.amount_paid), 0);
  const overdue = billable.filter(i => i.status === 'Overdue');
  const due = billable.filter(i => ['Due', 'Partially Paid'].includes(i.status));
  const next = [...overdue, ...due, ...billable.filter(i => i.status === 'Upcoming')][0];

  const actions: { key: string; icon: typeof CreditCard; title: string; desc: string; to: ClientPage; cta: string; tone?: 'err' }[] = [];
  if (contract && AWAITING_CLIENT_CONTRACT.includes(contract.status)) {
    actions.push({
      key: 'contract', icon: FileSignature, title: `Contract awaiting acceptance — ${contract.title} v${contract.current_version_no}`,
      desc: `Sent ${fmtDate(contract.sent_at)} · ${contract.ref}`, to: 'contracts', cta: 'Review',
    });
  }
  openDeps.forEach(d => {
    const del = ws.deliverables.find(x => x.id === d.deliverable_id);
    actions.push({
      key: 'dep' + d.id, icon: Upload, title: `${d.name} required${del ? ` for ${del.name}` : ''}`,
      desc: d.status === 'Requested' || d.status === 'Pending' ? (d.required_by ? `Needed by ${fmtDate(d.required_by)}` : 'Requested by your project team') : `Please re-submit: ${d.review_comment ?? ''}`,
      to: 'progress', cta: 'Upload',
    });
  });
  awaitingReview.forEach(d =>
    actions.push({ key: 'rev' + d.id, icon: CheckCircle2, title: `${d.name} is ready for your review`, desc: `${d.deliverable_number} · version ${d.version_no}`, to: 'deliverables', cta: 'Review' }),
  );
  counters.forEach(m =>
    actions.push({ key: 'cr' + m.id, icon: GitPullRequest, title: `Counter-proposal on ${m.request_number}`, desc: m.reviewer_comment ?? '', to: 'deliverables', cta: 'Respond' }),
  );
  overdue.forEach(i =>
    actions.push({ key: 'od' + i.id, icon: CreditCard, title: `Payment overdue — ${i.name}`, desc: `${inr(installmentTotal(i) - Number(i.amount_paid))} was due ${fmtDate(i.due_date)}`, to: 'payments', cta: 'Pay', tone: 'err' }),
  );
  due.forEach(i =>
    actions.push({ key: 'due' + i.id, icon: CreditCard, title: `Payment due ${fmtDate(i.due_date)} — ${i.name}`, desc: inr(installmentTotal(i) - Number(i.amount_paid)), to: 'payments', cta: 'View' }),
  );
  ready.forEach(d =>
    actions.push({
      key: 'dl' + d.id, icon: isLocked(d.lock_state) ? Lock : Download,
      title: isLocked(d.lock_state) ? `${d.name} — download locked` : `${d.name} is ready for download`,
      desc: isLocked(d.lock_state) ? lockText(d) : `Completed ${fmtDate(d.ready_at ?? d.completed_at)}`, to: 'deliverables', cta: 'Open',
    }),
  );

  const todayStr = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date());
  const awaitingYou = count(['Awaiting Client Dependency', 'Awaiting Client Review']);
  const inProgress = count(['In Progress', 'Under Internal Review', 'Revision In Progress']);
  const paidPct = totalBilled > 0 ? Math.round((paid / totalBilled) * 100) : 0;
  const overdueAmt = overdue.reduce((s, i) => s + installmentTotal(i) - Number(i.amount_paid), 0);

  return (
    <div className="space-y-5">
      <header className="rise" style={{ ['--i' as any]: 0 }}>
        <p className="eyebrow">{todayStr}</p>
        <h1 className="font-display text-[28px] sm:text-[34px] font-bold text-ink-900 leading-tight mt-1">{greeting()}, {(user.primaryContact || user.name || '').split(' ')[0]}</h1>
        <p className="text-[14px] text-ink-500 mt-1">{project.name} · managed by {project.managerName}</p>
      </header>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <UiStat index={0} icon={<Package className="w-5 h-5" />} tone="brand" label="Deliverables" value={prog.total} caption={`${prog.done} completed`} onClick={() => go('deliverables')} />
        <UiStat index={1} icon={<TrendingUp className="w-5 h-5" />} tone="sky" label="In progress" value={inProgress} caption={`${count(['Pending'])} not started yet`} onClick={() => go('progress')} />
        <UiStat index={2} icon={<CheckCircle2 className="w-5 h-5" />} tone={awaitingYou ? 'amber' : 'mint'} label="Waiting on you" value={awaitingYou} caption={awaitingYou ? 'Reviews or files needed' : 'Nothing pending'} onClick={() => go('deliverables')} />
        <UiStat index={3} icon={<History className="w-5 h-5" />} tone={overdueDeliv ? 'rose' : 'ink'} label="Running late" value={overdueDeliv} caption="Past planned due date" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr] items-stretch">
        <section className="card p-5 sm:p-6 rise" style={{ ['--i' as any]: 4 }}>
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="font-display font-bold text-[17px] text-ink-900">Project progress</h2><p className="text-[13px] text-ink-500">How far along your deliverables are.</p></div>
            <button type="button" onClick={() => go('progress')} className="btn-ghost btn-sm">Tracker <ArrowRight className="w-3.5 h-3.5" /></button>
          </div>
          <div className="mt-5 flex flex-col sm:flex-row items-center gap-6">
            <Ring value={prog.countPct} size={168} stroke={14}>
              <div className="text-center"><p className="stat-value text-[34px] text-ink-900">{Math.round(prog.countPct)}%</p><p className="text-[11px] text-ink-500 font-semibold">{prog.done} of {prog.total} done</p></div>
            </Ring>
            <ul className="flex-1 w-full space-y-3">
              {[
                { label: 'Completed', n: prog.done, tone: 'bg-brand-600' },
                { label: 'In progress', n: inProgress, tone: 'bg-sky-400' },
                { label: 'Waiting on you', n: awaitingYou, tone: 'bg-amber-300' },
                { label: 'Not started', n: count(['Pending']), tone: 'bg-ink-200' },
              ].map(r => (
                <li key={r.label}>
                  <div className="flex items-center justify-between text-[13px]"><span className="inline-flex items-center gap-2 text-ink-600"><span className={cx('w-2.5 h-2.5 rounded-full', r.tone)} />{r.label}</span><span className="tnum font-bold text-ink-900">{r.n}</span></div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-ink-100 overflow-hidden"><div className={cx('h-full rounded-full grow-x', r.tone)} style={{ width: `${prog.total ? (r.n / prog.total) * 100 : 0}%` }} /></div>
                </li>
              ))}
              {prog.weightedPct != null && <li className="text-[12px] text-ink-500 pt-1">Weighted by effort: <b className="text-ink-800 tnum">{Math.round(prog.weightedPct)}%</b></li>}
            </ul>
          </div>
        </section>

        <section className="card p-5 sm:p-6 rise flex flex-col" style={{ ['--i' as any]: 5 }}>
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="font-display font-bold text-[17px] text-ink-900">Payments</h2><p className="text-[13px] text-ink-500">Verified payments only.</p></div>
            <button type="button" onClick={() => go('payments')} className="btn-ghost btn-sm">Billing <ArrowRight className="w-3.5 h-3.5" /></button>
          </div>
          <div className="mt-2 flex justify-center"><Gauge value={paidPct} size={200} tone={overdue.length ? 'amber' : 'mint'} label={<><span className="block stat-value text-[26px] text-ink-900">{paidPct}%</span><span className="text-[11px] text-ink-500 font-semibold">of billed is paid</span></>} /></div>
          <dl className="mt-auto grid grid-cols-2 gap-3 text-[13px]">
            <div className="inset-tile p-3"><dt className="text-[11px] text-ink-500 font-semibold">Paid</dt><dd className="font-bold text-ink-900 tnum mt-0.5">{inr(paid)}</dd></div>
            <div className="inset-tile p-3"><dt className="text-[11px] text-ink-500 font-semibold">Still due</dt><dd className="font-bold text-ink-900 tnum mt-0.5">{inr(Math.max(0, totalBilled - paid))}</dd></div>
            <div className="inset-tile p-3 col-span-2 flex items-center justify-between gap-3">
              <div><dt className="text-[11px] text-ink-500 font-semibold">{overdue.length ? 'Overdue' : 'Next payment'}</dt><dd className={cx('font-bold tnum mt-0.5', overdue.length ? 'text-rose-700' : 'text-ink-900')}>{overdue.length ? inr(overdueAmt) : next ? `${inr(installmentTotal(next) - Number(next.amount_paid))} · ${fmtDate(next.due_date)}` : 'Nothing scheduled'}</dd></div>
              {(overdue.length > 0 || due.length > 0) && <button type="button" className="btn-primary btn-sm" onClick={() => go('payments')}>Pay</button>}
            </div>
          </dl>
        </section>
      </div>

      <section className="card overflow-hidden rise" style={{ ['--i' as any]: 6 }}>
        <div className="px-5 sm:px-6 py-4 flex items-center justify-between gap-3 border-b border-ink-100">
          <div><h2 className="font-display font-bold text-[17px] text-ink-900">Needs your attention</h2><p className="text-[13px] text-ink-500">Things your project team is waiting on.</p></div>
          <Badge tone={actions.length ? 'primary' : 'ok'} icon={false}>{actions.length ? `${actions.length} item${actions.length > 1 ? 's' : ''}` : 'All clear'}</Badge>
        </div>
        {actions.length === 0 ? (
          <div className="px-5 sm:px-6 py-8 flex items-center gap-3 text-[14px] text-ink-600"><span className="w-10 h-10 rounded-full bg-mint-50 text-mint-600 grid place-items-center"><CheckCircle2 size={18} /></span>You’re all caught up. We’ll let you know when something needs you.</div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {actions.slice(0, 8).map(a => (
              <li key={a.key}>
                <button type="button" onClick={() => go(a.to)} className="w-full text-left flex items-center gap-3 px-5 sm:px-6 py-3.5 hover:bg-ink-50/70 transition-colors group">
                  <span className={cx('w-10 h-10 rounded-full grid place-items-center shrink-0', a.tone === 'err' ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-600')}><a.icon size={16} /></span>
                  <span className="flex-1 min-w-0"><span className="block text-[14px] font-semibold text-ink-900 truncate">{a.title}</span><span className="block text-[12px] text-ink-500 truncate">{a.desc}</span></span>
                  <span className={cx('hidden sm:inline-flex items-center gap-1 text-[13px] font-bold', a.tone === 'err' ? 'text-rose-600' : 'text-brand-600')}>{a.cta}<ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <section className="card p-5 sm:p-6 rise" style={{ ['--i' as any]: 7 }}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 grid place-items-center"><FileSignature size={17} /></span><div><h2 className="font-display font-bold text-[17px] text-ink-900">Contract</h2><p className="text-[12px] text-ink-500">{contract ? `${contract.ref} · v${contract.current_version_no}` : 'Not issued yet'}</p></div></div>
            {contract && <Status s={contract.status} />}
          </div>
          {contract ? (
            <KV cols={2} items={[
              ['Title', contract.title],
              ['Value', contract.contract_value != null ? `${inr(contract.contract_value)}${contract.tax_note ? ' ' + contract.tax_note : ''}` : '—'],
              ['Accepted', contract.accepted_at ? fmtDate(contract.accepted_at) : 'Not yet'],
              ['Runs', `${fmtDate(contract.start_date)} – ${fmtDate(contract.end_date)}`],
              ['Renewal date', fmtDate(contract.renewal_date)],
            ]} />
          ) : <p className="text-[13px] text-ink-500">Your project team will send the contract here for you to review and accept.</p>}
          {contract && <button type="button" onClick={() => go('contracts')} className="btn-secondary btn-sm mt-4">Open contract <ArrowRight className="w-3.5 h-3.5" /></button>}
        </section>

        <section className="card p-5 sm:p-6 rise" style={{ ['--i' as any]: 8 }}>
          <div className="flex items-center gap-3 mb-4"><span className="w-10 h-10 rounded-full bg-mint-50 text-mint-600 grid place-items-center"><Download size={17} /></span><div><h2 className="font-display font-bold text-[17px] text-ink-900">Ready for download</h2><p className="text-[12px] text-ink-500">Finished work you can collect.</p></div></div>
          {ready.length ? (
            <ul className="divide-y divide-ink-100 -mx-1">
              {ready.map(d => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-3 px-1">
                  <div className="min-w-0"><div className="text-[14px] font-semibold text-ink-900 truncate">{d.name}</div><div className="text-[12px] text-ink-500">Completed {fmtDate(d.ready_at ?? d.completed_at)}</div></div>
                  {isLocked(d.lock_state) ? <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-500" title={lockText(d)}><Lock size={13} /> Locked</span> : <Button size="sm" icon={Download} onClick={() => go('deliverables')}>Get files</Button>}
                </li>
              ))}
            </ul>
          ) : <p className="text-[13px] text-ink-500">Nothing yet — completed deliverables will appear here.</p>}
        </section>
      </div>
    </div>
  );
}


/* =========================================================================
   2. Sign Contract
========================================================================= */

export function ClientContracts({ user, project, ws, reload }: ViewProps) {
  const toast = useToast();
  const contract = currentContract(ws);
  const [agree, setAgree] = useState(false);
  const [dlg, setDlg] = useState<'accept' | 'decline' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const viewedRef = useRef<string | null>(null);

  const version = contract ? ws.contractVersions.find(v => v.contract_id === contract.id && v.version_no === contract.current_version_no) : null;
  const docFile = version?.document_file_id ? ws.files.find(f => f.id === version.document_file_id) : null;
  const awaiting = contract ? AWAITING_CLIENT_CONTRACT.includes(contract.status) : false;

  useEffect(() => {
    if (contract && contract.status === 'Sent' && viewedRef.current !== contract.id) {
      viewedRef.current = contract.id;
      rpc('client_mark_contract_viewed', { p_contract_id: contract.id }).then(() => reload()).catch(() => undefined);
    }
  }, [contract, reload]);

  if (!contract) {
    return (
      <>
        <PageHeader title="Sign Contract" desc="Review and respond to contracts issued for your project." />
        <Card pad={false}>
          <Empty icon={FileSignature} title="No contract issued yet" desc="When IRA sends a contract for this project it will appear here for your review." />
        </Card>
      </>
    );
  }

  const openDocument = async () => {
    try {
      if (docFile) await openFile(docFile, false);
      else if (version?.document_url || contract.url) window.open(version?.document_url || contract.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast(errorMessage(e), 'err');
    }
  };

  const accept = async () => {
    setBusy(true);
    try {
      await rpc('client_accept_contract', {
        p_contract_id: contract.id,
        p_version_no: contract.current_version_no,
        p_acknowledged: agree,
        p_user_agent: navigator.userAgent.slice(0, 400),
      });
      toast('Contract accepted. Your acceptance has been recorded.');
      setDlg(null);
      await reload();
    } catch (e) {
      toast(errorMessage(e), 'err');
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await rpc('client_decline_contract', {
        p_contract_id: contract.id,
        p_version_no: contract.current_version_no,
        p_reason: reason.trim(),
        p_user_agent: navigator.userAgent.slice(0, 400),
      });
      toast('Your response has been sent to the project team.', 'info');
      setDlg(null);
      setReason('');
      await reload();
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const history = ws.acceptances.filter(a => a.contract_id === contract.id);
  const versions = ws.contractVersions.filter(v => v.contract_id === contract.id);

  return (
    <>
      <PageHeader title="Sign Contract" desc="Open and read the contract, then accept or decline. The exact version, time and your account are permanently recorded." />

      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-5">
          <Card>
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="flex gap-3 min-w-0">
                <div className="w-10 h-10 rounded-md bg-primary-soft text-primary grid place-items-center shrink-0">
                  <FileSignature size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink truncate">{contract.title}</h2>
                  <p className="text-xs text-ink-2 mt-0.5">{project.name} · {contract.ref} · v{contract.current_version_no}</p>
                </div>
              </div>
              <Status s={contract.status} />
            </div>
            <KV
              cols={3}
              items={[
                ['Contract value', contract.contract_value != null ? `${inr(contract.contract_value)}${contract.tax_note ? ' ' + contract.tax_note : ''}` : '—'],
                ['Start date', fmtDate(contract.start_date)],
                ['End date', fmtDate(contract.end_date)],
                ['Renewal date', fmtDate(contract.renewal_date)],
                ['Sent', fmtDate(contract.sent_at, true)],
                ['Accepted', contract.accepted_at ? fmtDate(contract.accepted_at, true) : '—'],
              ]}
            />
            {version?.terms_summary && (
              <div className="mt-5 pt-5 border-t border-line">
                <div className="text-xs text-ink-3 mb-1">Key terms</div>
                <p className="text-[13px] text-ink-2 whitespace-pre-line leading-relaxed">{version.terms_summary}</p>
              </div>
            )}
            {version?.change_note && contract.current_version_no > 1 && (
              <div className="mt-4">
                <Alert title={`What changed in v${contract.current_version_no}`}>{version.change_note}</Alert>
              </div>
            )}
            <div className="mt-5">
              <Button icon={docFile ? Download : ExternalLink} onClick={openDocument}>
                {docFile ? 'View contract document' : 'Open contract'}
              </Button>
            </div>
          </Card>

          {contract.status === 'Accepted' ? (
            <Alert tone="ok" title="Contract accepted">
              Accepted on {fmtDate(contract.accepted_at, true)} against version {contract.current_version_no}. If IRA issues a revised version you will be asked to review it; this acceptance remains on record.
            </Alert>
          ) : contract.status === 'Declined' ? (
            <Alert tone="err" title="Contract declined">
              Reason given: “{contract.decline_reason}”. Your project team has been notified and may send a revised version.
            </Alert>
          ) : contract.status === 'Expired' || contract.status === 'Terminated' ? (
            <Alert tone="warn" title={`Contract ${contract.status.toLowerCase()}`}>Please contact your account manager about renewal.</Alert>
          ) : awaiting ? (
            <Card>
              <CardHead title="Your response" desc="Open and read the document above before accepting." />
              <Checkbox checked={agree} onChange={setAgree} label="I have read and agree to the terms and conditions of this contract." />
              {user.clientRole === 'client_user' && (
                <p className="text-xs text-ink-3 mt-3">Only your organisation’s client admin can accept or decline contracts.</p>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                <Button variant="primary" icon={CheckCircle2} disabled={!agree || user.clientRole === 'client_user'} onClick={() => setDlg('accept')}>
                  Accept contract
                </Button>
                <Button variant="ghost" disabled={user.clientRole === 'client_user'} onClick={() => setDlg('decline')}>
                  Decline
                </Button>
              </div>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHead title="Acceptance record" desc="Immutable history of responses to each version." />
            {history.length === 0 ? (
              <p className="text-[13px] text-ink-3">No response recorded yet.</p>
            ) : (
              <Timeline
                items={history.map(a => ({
                  tone: a.event === 'Accepted' ? ('ok' as const) : ('err' as const),
                  title: `${a.version} ${a.event.toLowerCase()}`,
                  meta: `${a.who} · ${fmtDate(a.created_at, true)}`,
                  body: a.note ? <span>“{a.note}”</span> : a.acknowledgement ? <span>{a.acknowledgement}</span> : undefined,
                }))}
              />
            )}
          </Card>
          {versions.length > 1 && (
            <Card>
              <CardHead title="Versions" />
              <Timeline
                items={versions.map(v => ({
                  title: `v${v.version_no}${v.version_no === contract.current_version_no ? ' (current)' : ''}`,
                  meta: fmtDate(v.created_at),
                  body: v.change_note ?? undefined,
                }))}
              />
            </Card>
          )}
        </div>
      </div>

      <Dialog
        open={dlg === 'accept'}
        onClose={() => !busy && setDlg(null)}
        title="Accept this contract?"
        desc={`You are accepting ${contract.ref} version ${contract.current_version_no} on behalf of ${user.companyName ?? 'your organisation'}. Your account, the time and your network address are recorded.`}
        footer={
          <>
            <Button onClick={() => setDlg(null)} disabled={busy}>Review again</Button>
            <Button variant="primary" loading={busy} onClick={accept}>Confirm acceptance</Button>
          </>
        }
      />
      <Dialog
        open={dlg === 'decline'}
        onClose={() => !busy && setDlg(null)}
        tone="danger"
        title="Decline this contract"
        desc="Please provide a reason for declining this contract. Your project team will be notified."
        footer={
          <>
            <Button onClick={() => setDlg(null)} disabled={busy}>Cancel</Button>
            <Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={decline}>Decline contract</Button>
          </>
        }
      >
        <Field label="Reason" required hint="At least 5 characters.">
          <Textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} placeholder="Which terms need to change?" />
        </Field>
      </Dialog>
    </>
  );
}

/* =========================================================================
   3. Deliverables
========================================================================= */

type ModForm = { type: 'quantity' | 'timeline' | 'scope' | 'other'; quantity: string; date: string; value: string; reason: string };

export function ClientDeliverables({ user, ws, reload }: ViewProps) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'detail' | 'modify' | 'review' | null>(null);
  const [form, setForm] = useState<ModForm>({ type: 'quantity', quantity: '', date: '', value: '', reason: '' });
  const [reviewComment, setReviewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [counterNote, setCounterNote] = useState('');

  const d = ws.deliverables.find(x => x.id === selectedId) ?? null;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ws.deliverables.filter(x =>
      (statusFilter === 'All' || clientStatus(x) === statusFilter) &&
      (!q || `${x.deliverable_number} ${x.name} ${x.description ?? ''} ${x.category ?? ''}`.toLowerCase().includes(q)),
    );
  }, [ws.deliverables, search, statusFilter]);

  const mods = (id: string) => ws.modifications.filter(m => m.deliverable_id === id);
  const openMod = (id: string, type?: string) => mods(id).find(m => OPEN_MODIFICATION.includes(m.status) && (!type || m.modification_type === type));
  const filesFor = (id: string) => latestFiles(ws.files.filter(f => f.parent_type === 'deliverable' && f.parent_id === id && f.visibility === 'client'));
  const versionsFor = (id: string) => ws.versions.filter(v => v.deliverable_id === id);

  const close = () => {
    setPanel(null);
    setSelectedId(null);
  };

  const submitModification = async () => {
    if (!d) return;
    setBusy(true);
    try {
      await rpc('client_request_modification', {
        p_deliverable_id: d.id,
        p_type: form.type,
        p_reason: form.reason.trim(),
        p_requested_quantity: form.type === 'quantity' ? Number(form.quantity) : null,
        p_requested_due_date: form.type === 'timeline' ? form.date : null,
        p_requested_value: form.type === 'scope' || form.type === 'other' ? form.value.trim() : null,
        p_idempotency_key: idempotencyKey('mod'),
      });
      toast('Modification request submitted for review.');
      setPanel('detail');
      setForm({ type: 'quantity', quantity: '', date: '', value: '', reason: '' });
      await reload();
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const review = async (approve: boolean) => {
    if (!d) return;
    setBusy(true);
    try {
      await rpc('client_review_deliverable', { p_deliverable_id: d.id, p_approve: approve, p_comment: reviewComment.trim() || null });
      toast(approve ? 'Deliverable approved.' : 'Your feedback has been sent to the team.');
      setReviewComment('');
      setPanel('detail');
      await reload();
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const respondCounter = async (m: ModificationRow, accept: boolean) => {
    setBusy(true);
    try {
      await rpc('client_respond_to_counter', { p_request_id: m.id, p_accept: accept, p_note: counterNote.trim() || null });
      toast(accept ? 'Counter-proposal accepted; scope updated.' : 'Counter-proposal declined.');
      setCounterNote('');
      await reload();
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (m: ModificationRow) => {
    setBusy(true);
    try {
      await rpc('client_withdraw_modification', { p_request_id: m.id });
      toast('Request withdrawn.', 'info');
      await reload();
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const formValid =
    form.reason.trim().length >= 5 &&
    (form.type === 'quantity'
      ? form.quantity !== '' && Number(form.quantity) >= 0 && d != null && Number(form.quantity) !== Number(d.quantity)
      : form.type === 'timeline'
      ? !!form.date && form.date !== d?.due_date
      : form.value.trim().length >= 3);

  if (ws.deliverables.length === 0) {
    return (
      <>
        <PageHeader title="Deliverables" desc="The agreed scope of work for this project." />
        <Card pad={false}>
          <Empty icon={Package} title="No deliverables yet" desc="Deliverables appear here once your contract is active and the scope is published." />
        </Card>
      </>
    );
  }

  const statusOptions = ['All', ...Array.from(new Set(ws.deliverables.map(clientStatus)))];

  return (
    <>
      <PageHeader
        title="Deliverables"
        desc="The agreed scope of work. To change quantity, scope or timeline, submit a modification request — the original scope is never overwritten and every approved change is versioned."
      />
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search deliverables" className="w-full sm:w-64" />
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full sm:w-56" aria-label="Filter by status">
          {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
      </FilterBar>

      <DataTable
        rows={rows}
        pageSize={12}
        onRow={r => { setSelectedId(r.id); setPanel('detail'); }}
        empty={<Empty icon={Package} title="No matching deliverables" desc="Adjust the search or status filter." />}
        cols={[
          { key: 'n', head: 'No.', w: '84px', mobile: 'hide', render: r => <span className="font-mono text-xs text-ink-2">{r.deliverable_number}</span> },
          {
            key: 'name', head: 'Deliverable', mobile: 'title',
            render: r => (
              <div className="py-1 min-w-0">
                <div className="font-medium text-ink truncate">{r.name}</div>
                <div className="text-xs text-ink-3 hidden md:block truncate max-w-[320px]">{r.category ? `${r.category} · ` : ''}{r.description ?? ''}</div>
              </div>
            ),
          },
          { key: 'q', head: 'Quantity', render: r => <span className="tnum">{fmtQty(r.quantity, r.unit)}</span> },
          { key: 'due', head: 'Due', render: r => <span className="text-xs text-ink-2">{r.timeline ? `${r.timeline} · ` : ''}{fmtDate(r.due_date)}</span> },
          { key: 's', head: 'Status', render: r => <Status s={clientStatus(r)} /> },
          {
            key: 'a', head: 'Your action',
            render: r =>
              r.status === 'Awaiting Client Review' ? <Badge tone="warn">Review</Badge>
              : openMod(r.id) ? <Badge tone={openMod(r.id)!.status === 'Counter Proposed' ? 'warn' : 'info'}>{openMod(r.id)!.status}</Badge>
              : r.client_action ? <span className="text-xs text-warn truncate">{r.client_action}</span>
              : <span className="text-ink-3">—</span>,
          },
        ]}
      />

      <SidePanel
        open={!!d && panel === 'detail'}
        onClose={close}
        title={d ? `${d.deliverable_number} · ${d.name}` : ''}
        sub={d ? `Version ${d.version_no} · updated ${fmtDate(d.updated_at)}` : undefined}
        footer={
          d && !['Cancelled'].includes(d.status) ? (
            <>
              {d.status === 'Awaiting Client Review' && user.clientRole !== 'client_user' && (
                <Button variant="primary" icon={CheckCircle2} onClick={() => setPanel('review')}>Review work</Button>
              )}
              <Button icon={GitPullRequest} onClick={() => setPanel('modify')}>Request modification</Button>
            </>
          ) : undefined
        }
      >
        {d && (
          <div className="space-y-6">
            <div className="flex gap-2 items-center flex-wrap">
              <Status s={clientStatus(d)} />
              <Badge>{d.priority} priority</Badge>
            </div>
            {isLocked(d.lock_state) && <Alert tone="warn" title="Download locked">{lockText(d)}</Alert>}
            {d.description && <p className="text-[13px] text-ink-2 leading-relaxed whitespace-pre-line">{d.description}</p>}
            <KV
              cols={2}
              items={[
                ['Quantity', fmtQty(d.quantity, d.unit)],
                ['Category', d.category ?? '—'],
                ['Start date', fmtDate(d.start_date)],
                ['Due date', fmtDate(d.due_date)],
                ['Timeline', d.timeline ?? '—'],
                ['Assigned team', d.assigned_team ?? d.responsible_name ?? 'Project team'],
                ['Client action', d.client_action ?? '—'],
                ['Reference', d.reference_url && /^https?:\/\//.test(d.reference_url) ? <LinkRef url={d.reference_url} label="Open link" /> : '—'],
              ]}
            />

            <section>
              <h3 className="text-[13px] font-semibold mb-2 text-ink">Files</h3>
              <FileList files={filesFor(d.id)} emptyText="No files shared yet." lockedMessage={isLocked(d.lock_state) ? lockText(d) : null} />
              {!isLocked(d.lock_state) && d.status !== 'Ready for Download' && filesFor(d.id).some(f => f.is_final) && (
                <p className="text-[11px] text-ink-3 mt-1.5">Final files become downloadable when the deliverable is marked ready.</p>
              )}
            </section>

            {mods(d.id).filter(m => m.status === 'Counter Proposed').map(m => (
              <Card key={m.id} className="!p-4">
                <div className="text-[13px] font-semibold text-ink mb-1">Counter-proposal on {m.request_number}</div>
                <p className="text-xs text-ink-2">
                  You asked for <b>{m.requested_value}</b>. The team proposes{' '}
                  <b>{m.counter_quantity != null ? fmtQty(m.counter_quantity, d.unit) : m.counter_due_date ? fmtDate(m.counter_due_date) : m.counter_value}</b>.
                </p>
                {m.reviewer_comment && <p className="text-xs text-ink-2 mt-1">“{m.reviewer_comment}”</p>}
                {m.billing_note && <p className="text-xs text-warn mt-1">Billing: {m.billing_note}</p>}
                <Field label="Note (optional)" className="mt-3">
                  <Input value={counterNote} onChange={e => setCounterNote(e.target.value)} maxLength={500} />
                </Field>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="primary" loading={busy} onClick={() => respondCounter(m, true)}>Accept</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => respondCounter(m, false)}>Decline</Button>
                </div>
              </Card>
            ))}

            <section>
              <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-1.5 text-ink"><History size={14} /> Modification history</h3>
              {mods(d.id).length === 0 ? (
                <p className="text-xs text-ink-3">No modifications requested.</p>
              ) : (
                <Timeline
                  items={mods(d.id).map(m => ({
                    tone: ['Approved', 'Counter Accepted'].includes(m.status) ? ('ok' as const) : ['Rejected', 'Counter Declined', 'Withdrawn'].includes(m.status) ? ('err' as const) : ('warn' as const),
                    title: (
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-ink">{m.request_number} · {m.field}</span>
                        <Status s={m.status} />
                      </span>
                    ),
                    meta: `${m.requested_by_name ?? 'Client'} · ${fmtDate(m.created_at, true)}`,
                    body: (
                      <div className="space-y-1 text-xs">
                        <div>
                          <span className="line-through text-ink-3">{m.previous_value}</span> → <span className="font-medium text-ink">{m.requested_value}</span>
                          {m.quantity_delta != null && <span className="ml-1 text-ink-3">({m.quantity_delta > 0 ? '+' : ''}{Number(m.quantity_delta)})</span>}
                        </div>
                        {m.reason && <div className="text-ink-2">Reason: {m.reason}</div>}
                        {m.reviewer_comment && <div className="text-ink-3">Decision: {m.reviewer_comment}</div>}
                        {m.status === 'Pending Review' && (
                          <button className="text-info hover:underline" disabled={busy} onClick={() => withdraw(m)}>Withdraw request</button>
                        )}
                      </div>
                    ),
                  }))}
                />
              )}
            </section>

            {versionsFor(d.id).length > 1 && (
              <section>
                <h3 className="text-[13px] font-semibold mb-3 text-ink">Scope versions</h3>
                <Timeline
                  items={versionsFor(d.id).map(v => ({
                    title: `Version ${v.version_no}`,
                    meta: fmtDate(v.created_at, true),
                    body: (
                      <span>
                        Qty {fmtQty(v.snapshot.quantity as number, v.snapshot.unit as string | null)} · Due {fmtDate(v.snapshot.due_date as string | null)}
                        {v.reason ? ` · ${v.reason}` : ''}
                      </span>
                    ),
                  }))}
                />
              </section>
            )}
          </div>
        )}
      </SidePanel>

      <SidePanel
        open={!!d && panel === 'modify'}
        onClose={() => setPanel('detail')}
        title="Request modification"
        sub={d ? `${d.deliverable_number} · ${d.name}` : undefined}
        footer={
          <>
            <Button onClick={() => setPanel('detail')} disabled={busy}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!formValid || !!(d && openMod(d.id, form.type))} onClick={submitModification}>Submit request</Button>
          </>
        }
      >
        {d && (
          <div className="space-y-4">
            <Alert title="Your request does not change the scope directly">
              The project team reviews it and may approve, reject or counter-propose. Approved changes create a new version; the original is kept.
            </Alert>
            {openMod(d.id, form.type) && <Alert tone="warn" title="A request of this type is already open for this deliverable." />}
            <Field label="Type of change" required>
              <Select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as ModForm['type'] })}>
                <option value="quantity">Quantity increase / decrease</option>
                <option value="timeline">Timeline (earlier or later delivery)</option>
                <option value="scope">Scope / nature of the deliverable</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            {form.type === 'quantity' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Current quantity"><Input value={fmtQty(d.quantity, d.unit)} readOnly disabled /></Field>
                <Field label="Requested quantity" required>
                  <Input type="number" min={0} step="1" inputMode="numeric" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
                </Field>
                {form.quantity !== '' && Number(form.quantity) !== Number(d.quantity) && (
                  <p className="col-span-2 text-xs text-ink-2">
                    Difference: <b>{Number(form.quantity) - Number(d.quantity) > 0 ? '+' : ''}{Number(form.quantity) - Number(d.quantity)}</b>
                  </p>
                )}
              </div>
            )}
            {form.type === 'timeline' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Current due date"><Input value={fmtDate(d.due_date)} readOnly disabled /></Field>
                <Field label="Requested due date" required>
                  <Input type="date" min={todayIST()} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </Field>
              </div>
            )}
            {(form.type === 'scope' || form.type === 'other') && (
              <Field label="Describe the change" required>
                <Textarea value={form.value} maxLength={2000} onChange={e => setForm({ ...form, value: e.target.value })} placeholder="e.g. Change 5 static posts to short videos" />
              </Field>
            )}
            <Field label="Reason" required hint="At least 5 characters.">
              <Textarea value={form.reason} maxLength={2000} onChange={e => setForm({ ...form, reason: e.target.value })} />
            </Field>
          </div>
        )}
      </SidePanel>

      <Dialog
        open={!!d && panel === 'review'}
        onClose={() => !busy && setPanel('detail')}
        title="Review delivered work"
        desc="Approve to mark the deliverable complete, or describe what needs to change."
        footer={
          <>
            <Button onClick={() => setPanel('detail')} disabled={busy}>Cancel</Button>
            <Button variant="danger" disabled={busy || reviewComment.trim().length < 5} onClick={() => review(false)}>Request changes</Button>
            <Button variant="primary" loading={busy} onClick={() => review(true)}>Approve</Button>
          </>
        }
      >
        <Field label="Comments" hint="Required when requesting changes.">
          <Textarea value={reviewComment} maxLength={2000} onChange={e => setReviewComment(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}

/* =========================================================================
   4. Progress Tracker (with client dependencies)
========================================================================= */

export function ClientProgress({ project, ws, reload, go }: ViewProps) {
  const toast = useToast();
  const prog = computeProgress(ws.deliverables);
  const [depId, setDepId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const dep = ws.dependencies.find(x => x.id === depId) ?? null;
  const openDeps = (deliverableId: string) =>
    ws.dependencies.filter(x => x.deliverable_id === deliverableId && ['Requested', 'Pending', 'Rejected', 'Resubmission Required'].includes(x.status));

  const submit = async () => {
    if (!dep) return;
    setBusy(true);
    const uploaded: string[] = [];
    try {
      for (const f of files) uploaded.push(await uploadAndAttach(f, 'dependency', dep.id, { visibility: 'client' }));
      await rpc('client_submit_dependency', { p_dependency_id: dep.id, p_note: note.trim() || null, p_file_ids: uploaded });
      toast('Thank you — your project team has been notified.');
      setDepId(null);
      setFiles([]);
      setNote('');
      await reload();
    } catch (e) {
      toast(errorMessage(e) + (uploaded.length ? ' Uploaded files were saved; please submit again.' : ''), 'err');
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const rows = ws.deliverables.filter(d => d.status !== 'Cancelled');

  return (
    <>
      <PageHeader title="Progress Tracker" desc={`${project.name} · where each deliverable stands`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Completed" value={`${prog.done}/${prog.total}`} sub={`${prog.countPct}% by count`} />
        <Stat label="Weighted progress" value={prog.weightedPct != null ? `${prog.weightedPct}%` : '—'} sub={prog.weightedPct != null ? 'By deliverable weightage' : 'Weightage not configured'} />
        <Stat label="Waiting on you" value={ws.dependencies.filter(x => ['Requested', 'Pending', 'Rejected', 'Resubmission Required'].includes(x.status)).length} sub="Requested items" tone="warn" />
        <Stat label="Target completion" value={<span className="text-[18px]">{fmtDate(project.targetDate)}</span>} sub={`Manager: ${project.managerName}`} />
      </div>
      <Card className="mb-5">
        <Progress value={prog.weightedPct ?? prog.countPct} label="Project completion" />
      </Card>

      <DataTable
        rows={rows}
        pageSize={15}
        empty={<Empty icon={TrendingUp} title="Nothing to track yet" desc="Progress appears once deliverables are active." />}
        cols={[
          { key: 'n', head: 'Sl. No.', w: '72px', mobile: 'hide', render: r => <span className="font-mono text-xs text-ink-2">{r.deliverable_number}</span> },
          { key: 'd', head: 'Deliverable', mobile: 'title', render: r => <span className="font-medium text-ink">{r.name}</span> },
          { key: 'q', head: 'Quantity', render: r => <span className="tnum">{fmtQty(r.quantity, r.unit)}</span> },
          { key: 't', head: 'Timeline', render: r => <span className="text-xs text-ink-2">{r.timeline ?? fmtDate(r.due_date)}</span> },
          { key: 's', head: 'Status', render: r => <Status s={clientStatus(r)} /> },
          {
            key: 'dep', head: 'Dependency',
            render: r => {
              const open = openDeps(r.id);
              return open.length ? <span className="text-xs text-warn">{open.map(x => x.name).join(', ')}</span> : <span className="text-ink-3 text-xs">None</span>;
            },
          },
          { key: 'u', head: 'Last updated', render: r => <span className="text-xs text-ink-2">{fmtDate(r.updated_at)}</span> },
        ]}
        actions={r => {
          const open = openDeps(r.id);
          if (open.length) return <Button size="sm" icon={Upload} onClick={() => setDepId(open[0].id)}>Upload</Button>;
          if (r.status === 'Ready for Download' && !isLocked(r.lock_state)) return <Button size="sm" icon={Download} onClick={() => go('deliverables')}>Download</Button>;
          return <Button size="sm" variant="ghost" onClick={() => go('deliverables')}>View</Button>;
        }}
      />

      <SidePanel
        open={!!dep}
        onClose={() => !busy && setDepId(null)}
        title={dep?.name ?? ''}
        sub={dep ? `Requested for ${ws.deliverables.find(x => x.id === dep.deliverable_id)?.name ?? 'deliverable'}` : undefined}
        footer={
          <>
            <Button onClick={() => setDepId(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={files.length === 0 && note.trim().length < 3} onClick={submit}>Submit</Button>
          </>
        }
      >
        {dep && (
          <div className="space-y-4">
            {dep.description && <p className="text-[13px] text-ink-2 whitespace-pre-line">{dep.description}</p>}
            <KV items={[['Needed by', fmtDate(dep.required_by)], ['Status', <Status key="s" s={dep.status} />]]} />
            {dep.review_comment && <Alert tone="warn" title="Feedback from the team">{dep.review_comment}</Alert>}
            <Alert tone="info" title="Do not upload passwords">
              If access credentials are needed, share them through your organisation’s password manager or ask your account manager for a secure method.
            </Alert>
            <FilePicker files={files} onChange={setFiles} />
            <Field label="Note or link" hint="Optional when you attach files.">
              <Textarea value={note} maxLength={2000} onChange={e => setNote(e.target.value)} />
            </Field>
            <FileList
              files={latestFiles(ws.files.filter(f => f.parent_type === 'dependency' && f.parent_id === dep.id))}
              emptyText="No files uploaded yet."
            />
          </div>
        )}
      </SidePanel>
    </>
  );
}

/* =========================================================================
   5. Billing & Payment
========================================================================= */

export function ClientPayments({ user, project, ws, reload }: ViewProps) {
  const toast = useToast();
  const contract = currentContract(ws);
  const [tab, setTab] = useState('schedule');
  const [instId, setInstId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState({ amount: '', reference: '', paidOn: todayIST(), method: 'bank_transfer' });
  const [proof, setProof] = useState<File[]>([]);
  const keyRef = useRef<string>(idempotencyKey('pay'));

  const inst = ws.installments.find(i => i.id === instId) ?? null;
  const billable = ws.installments.filter(i => !['Cancelled', 'Waived'].includes(i.status));
  const total = billable.reduce((s, i) => s + installmentTotal(i), 0);
  const paid = billable.reduce((s, i) => s + Number(i.amount_paid), 0);
  const overdue = billable.filter(i => i.status === 'Overdue');
  const pending = (id: string) => ws.payments.filter(p => p.installment_id === id && p.status === 'Submitted');
  const outstanding = (i: InstallmentRow) =>
    Math.max(0, installmentTotal(i) - Number(i.amount_paid) - pending(i.id).reduce((s, p) => s + Number(p.amount), 0));
  const canPay = (i: InstallmentRow) => user.clientRole !== 'client_user' && !['Paid', 'Cancelled', 'Waived'].includes(i.status) && outstanding(i) > 0;

  const startPay = (i: InstallmentRow) => {
    setInstId(i.id);
    setPay({ amount: String(outstanding(i)), reference: '', paidOn: todayIST(), method: 'bank_transfer' });
    setProof([]);
    keyRef.current = idempotencyKey('pay');
    setPayOpen(true);
  };

  const submitPayment = async () => {
    if (!inst) return;
    setBusy(true);
    try {
      let proofId: string | null = null;
      if (proof[0]) proofId = await uploadAndAttach(proof[0], 'payment', inst.id, { visibility: 'client' });
      await rpc('client_submit_payment', {
        p_installment_id: inst.id,
        p_amount: Number(pay.amount),
        p_reference: pay.reference.trim(),
        p_paid_on: pay.paidOn,
        p_method: pay.method,
        p_proof_file_id: proofId,
        p_idempotency_key: keyRef.current,
      });
      toast('Payment details submitted. The milestone updates once finance verifies the receipt.');
      setPayOpen(false);
      await reload();
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  if (ws.installments.length === 0) {
    return (
      <>
        <PageHeader title="Billing & Payment" desc={project.name} />
        <Card pad={false}>
          <Empty icon={CreditCard} title="No billing schedule yet" desc="Payment milestones appear here once finance publishes the schedule for your contract." />
        </Card>
      </>
    );
  }

  const amountNum = Number(pay.amount);
  const payValid = inst != null && amountNum > 0 && amountNum <= outstanding(inst) && pay.reference.trim().length >= 3 && !!pay.paidOn && pay.paidOn <= todayIST();

  return (
    <>
      <PageHeader title="Billing & Payment" desc="Milestones are marked paid only after finance verifies the receipt against the bank statement." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Contract value" value={contract?.contract_value != null ? inr(contract.contract_value) : '—'} sub={contract?.tax_note ?? undefined} />
        <Stat label="Amount paid" value={inr(paid)} sub="Verified receipts" />
        <Stat label="Amount due" value={inr(Math.max(0, total - paid))} sub={`of ${inr(total)} billed`} />
        <Stat label="Overdue" value={inr(overdue.reduce((s, i) => s + installmentTotal(i) - Number(i.amount_paid), 0))} sub={`${overdue.length} milestone${overdue.length === 1 ? '' : 's'}`} tone={overdue.length ? 'err' : undefined} />
      </div>
      {ws.deliverables.some(d => d.lock_state === 'locked_payment') && (
        <div className="mb-4">
          <Alert tone="err" title="Downloads temporarily unavailable">{LOCK_MESSAGE} Access is restored automatically once payment is verified.</Alert>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'schedule', label: 'Payment milestones', count: ws.installments.length },
          { id: 'history', label: 'Payment history', count: ws.payments.length },
        ]}
      />
      {tab === 'schedule' ? (
        <DataTable
          rows={ws.installments}
          pageSize={12}
          onRow={r => setInstId(r.id)}
          cols={[
            { key: 'n', head: '#', w: '48px', mobile: 'hide', render: r => <span className="tnum text-ink-2 font-mono">{r.installment_number}</span> },
            { key: 'm', head: 'Milestone', mobile: 'title', render: r => <div><div className="font-medium text-ink">{r.name}</div><div className="text-xs text-ink-3">{r.basis ?? (r.basis_type === 'recurring' ? 'Recurring' : 'Fixed amount')}</div></div> },
            { key: 'a', head: 'Amount', align: 'right', render: r => <span className="font-semibold">{inr(installmentTotal(r))}</span> },
            { key: 'p', head: 'Paid', align: 'right', render: r => <span className="tnum text-ink-2">{inr(r.amount_paid)}</span> },
            { key: 'd', head: 'Due', render: r => <span className="text-xs text-ink-2">{fmtDate(r.due_date)}</span> },
            { key: 's', head: 'Status', render: r => <span className="flex gap-1.5 flex-wrap"><Status s={r.status} />{pending(r.id).length > 0 && <Badge tone="info">Verification pending</Badge>}</span> },
            { key: 'i', head: 'Invoice', render: r => <span className="font-mono text-xs text-ink-2">{r.invoice_number ?? '—'}</span> },
          ]}
          actions={r => (canPay(r) ? <Button size="sm" onClick={() => startPay(r)}>Submit payment</Button> : null)}
        />
      ) : (
        <DataTable
          rows={ws.payments}
          pageSize={12}
          empty={<Empty icon={CreditCard} title="No payments yet" desc="Payments you submit or that finance records appear here." />}
          cols={[
            { key: 'd', head: 'Paid on', render: r => <span className="text-xs">{fmtDate(r.paid_on)}</span> },
            { key: 'm', head: 'Milestone', mobile: 'title', render: r => <span className="font-medium">{ws.installments.find(i => i.id === r.installment_id)?.name ?? '—'}</span> },
            { key: 'a', head: 'Amount', align: 'right', render: r => <span className="font-semibold">{inr(r.amount)}</span> },
            { key: 'r', head: 'Reference', render: r => <span className="font-mono text-xs">{r.reference}</span> },
            { key: 's', head: 'Status', render: r => <span className="flex flex-col"><Status s={r.status === 'Submitted' ? 'Pending Verification' : r.status} />{r.rejection_reason && <span className="text-[11px] text-err mt-0.5">{r.rejection_reason}</span>}</span> },
          ]}
        />
      )}
      <p className="text-xs text-ink-3 mt-4 flex items-center gap-1.5">
        <ShieldCheck size={14} className="shrink-0" /> Submitting a reference or receipt does not mark a milestone paid; finance verifies every payment.
      </p>

      <SidePanel
        open={!!inst && !payOpen}
        onClose={() => setInstId(null)}
        title={inst?.name ?? ''}
        sub={inst ? `Milestone ${inst.installment_number}${inst.invoice_number ? ` · ${inst.invoice_number}` : ''}` : undefined}
        footer={inst && canPay(inst) ? <Button variant="primary" onClick={() => startPay(inst)}>Submit payment</Button> : undefined}
      >
        {inst && (
          <div className="space-y-5">
            <Status s={inst.status} />
            {inst.status_reason && <Alert tone="warn" title={inst.status}>{inst.status_reason}</Alert>}
            <KV
              items={[
                ['Amount', inr(inst.amount)],
                ['Tax', inr(inst.tax_amount)],
                ['Total', inr(installmentTotal(inst))],
                ['Paid (verified)', inr(inst.amount_paid)],
                ['Due date', fmtDate(inst.due_date)],
                ['Basis', inst.basis ?? '—'],
              ]}
            />
            <section>
              <h3 className="text-[13px] font-semibold mb-2">Payments</h3>
              {ws.payments.filter(p => p.installment_id === inst.id).length === 0 ? (
                <p className="text-xs text-ink-3">No payments yet.</p>
              ) : (
                <Timeline
                  items={ws.payments.filter(p => p.installment_id === inst.id).map(p => ({
                    tone: p.status === 'Verified' ? ('ok' as const) : p.status === 'Rejected' ? ('err' as const) : ('warn' as const),
                    title: `${inr(p.amount)} · ${p.status === 'Submitted' ? 'awaiting verification' : p.status.toLowerCase()}`,
                    meta: `Ref ${p.reference} · paid ${fmtDate(p.paid_on)}`,
                    body: p.rejection_reason ?? undefined,
                  }))}
                />
              )}
            </section>
            <FileList files={latestFiles(ws.files.filter(f => (f.parent_type === 'invoice' || f.parent_type === 'payment') && f.parent_id === inst.id))} emptyText="No invoice or receipt files." />
          </div>
        )}
      </SidePanel>

      <SidePanel
        open={!!inst && payOpen}
        onClose={() => !busy && setPayOpen(false)}
        title="Submit payment details"
        sub={inst ? `${inst.name} · outstanding ${inr(outstanding(inst))}` : undefined}
        footer={
          <>
            <Button onClick={() => setPayOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!payValid} onClick={submitPayment}>Submit for verification</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert title="Verification required">Enter the details of a payment you have already made. Finance confirms it against the bank statement before the milestone is marked paid.</Alert>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount paid (₹)" required>
              <Input type="number" min={1} step="0.01" inputMode="decimal" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} error={inst != null && amountNum > outstanding(inst)} />
            </Field>
            <Field label="Payment date" required>
              <Input type="date" max={todayIST()} value={pay.paidOn} onChange={e => setPay({ ...pay, paidOn: e.target.value })} />
            </Field>
          </div>
          <Field label="Method">
            <Select value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })}>
              <option value="bank_transfer">Bank transfer (NEFT / RTGS / IMPS)</option>
              <option value="upi">UPI</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Transaction reference / UTR" required>
            <Input value={pay.reference} maxLength={120} onChange={e => setPay({ ...pay, reference: e.target.value })} placeholder="e.g. UTR 4021 8830 1123" />
          </Field>
          <Field label="Payment proof (optional)">
            <FilePicker files={proof} onChange={f => setProof(f.slice(-1))} label="Attach receipt" />
          </Field>
        </div>
      </SidePanel>
    </>
  );
}
