import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Pencil, Plus, UserPlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { log } from '../../lib/log';
import { fmtDate, todayIST } from '../../lib/sigma';
import { reviewApi, type ClientRound } from '../../lib/tasks';
import { createAssignedTask } from '../../lib/taskCreate';
import { notifyTaskAssigned } from '../../lib/notifications';
import { TaskAssignForm, type AssignTarget } from '../tasks/TaskAssignForm';
import { StaffClientReview } from '../common/StaffClientReview';
import { Modal } from '../../ui/Modal';
import { TaskDetail } from '../tasks/TaskDetail';
import { mapTask } from '../../lib/v2';
import type { Employee, Task } from '../../types/attendance';
import { DELIVERY_STAGES as STAGES, deliveryStageIndex as stageIndex } from '../../lib/deliveryStages';

const db = () => supabase as any;

/* ------------------------------------------------------------------ data */

interface Deliv {
  id: string; project_id: string; client_id: string | null; deliverable_number: string; name: string;
  description: string | null; due_date: string | null; status: string; responsible_name: string | null;
  stage_since: string | null; created_at: string; included_drafts: number | null; lock_state: string;
}
interface TaskRow {
  id: string; title: string; description: string | null; status: string; due_date: string | null;
  assigned_to: string | null; research_minutes: number | null; time_spent_minutes: number | null;
  created_at: string; started_at: string | null; submitted_at: string | null; completed_at: string | null;
  accepted_at: string | null; progress_pct: number | null; status_note: string | null;
}
interface DepRow { id: string; name: string; status: string; required_by: string | null; uploaded_at: string | null; created_at: string }

const DAY = 86_400_000;
const daysSince = (iso: string | null | undefined) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY)) : 0);
const dayWord = (n: number) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);
const forDays = (n: number) => (n === 0 ? 'since today' : `for ${dayWord(n)}`);
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const mins = (m: number | null) => (!m ? '—' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim());
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

const TASK_LABEL: Record<string, string> = {
  assigned: 'Not started', accepted: 'Started', in_progress: 'In progress', blocked: 'Stuck',
  awaiting_review: 'Waiting for OK', revision_required: 'Changes asked', completed: 'Completed', cancelled: 'Cancelled',
};
const TASK_TONE: Record<string, string> = {
  assigned: 'bg-ink-100 text-ink-700', accepted: 'bg-sky-50 text-sky-700', in_progress: 'bg-brand-50 text-brand-700',
  blocked: 'bg-rose-50 text-rose-700', awaiting_review: 'bg-amber-50 text-amber-800', revision_required: 'bg-rose-50 text-rose-700',
  completed: 'bg-mint-50 text-mint-700', cancelled: 'bg-ink-100 text-ink-500',
};

type Tone = 'brand' | 'amber' | 'rose' | 'mint';
/** The card class sets its own border outside Tailwind's layers, so the coloured edge is an inline style. */
const TONE_EDGE: Record<Tone, string> = { brand: '#5b35e8', amber: '#f0b429', rose: '#e5484d', mint: '#34a877' };
const TONE_TEXT: Record<Tone, string> = { brand: 'text-brand-700', amber: 'text-amber-800', rose: 'text-rose-700', mint: 'text-mint-700' };

type TabId = 'work' | 'holding' | 'client' | 'record';

/* ------------------------------------------------------------------ page */

/**
 * One deliverable, start to finish: where it stands right now, the stages it has walked, the tasks
 * it was broken into and who holds each, what is holding it up, and the full record.
 * The same page for an admin and a manager; it opens over whatever screen asked for it.
 */
export function DeliverablePage({
  deliverableId, employees, myEmployeeId, onClose, onEditDetails, initialTab,
}: {
  deliverableId: string;
  /** Open on this tab, e.g. 'client' when a notification is about a draft the client answered. */
  initialTab?: 'work' | 'holding' | 'client' | 'record';
  employees: AssignTarget[];
  myEmployeeId?: string | null;
  onClose: () => void;
  onEditDetails?: () => void;
}) {
  const [d, setD] = useState<Deliv | null>(null);
  const [names, setNames] = useState<{ project: string; client: string }>({ project: '', client: '' });
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [rounds, setRounds] = useState<ClientRound[]>([]);
  const [deps, setDeps] = useState<DepRow[]>([]);
  const [load, setLoad] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabId>(initialTab ?? 'work');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [showAllRecord, setShowAllRecord] = useState(false);
  /** People brought onto this deliverable with Add person who have no task here yet. */
  const [extraPeople, setExtraPeople] = useState<string[]>([]);
  const [addPersonOpen, setAddPersonOpen] = useState(false);
  const [openTask, setOpenTask] = useState<Task | null>(null);

  const openTaskDetail = useCallback(async (taskId: string) => {
    const { data, error: e } = await db().from('tasks').select('*').eq('id', taskId).maybeSingle();
    if (e || !data) { notify(e?.message ?? 'That task could not be opened.', 'error'); return; }
    setOpenTask(mapTask(data, new Map((employees as unknown as Employee[]).map((x) => [x.id, x]))));
  }, [employees]);

  const reload = useCallback(async () => {
    try {
      const { data: row, error: e1 } = await db().from('deliverables').select('*').eq('id', deliverableId).maybeSingle();
      if (e1) throw new Error(e1.message);
      if (!row) throw new Error('This deliverable no longer exists.');
      setD(row as Deliv);
      const [t, dp, p, open, r] = await Promise.all([
        db().from('tasks')
          .select('id, title, description, status, due_date, assigned_to, research_minutes, time_spent_minutes, created_at, started_at, submitted_at, completed_at, accepted_at, progress_pct, status_note')
          .eq('deliverable_id', deliverableId).is('archived_at', null).order('created_at', { ascending: true }),
        db().from('deliverable_dependencies').select('id, name, status, required_by, uploaded_at, created_at').eq('deliverable_id', deliverableId),
        db().from('projects').select('name, client_id').eq('id', row.project_id).maybeSingle(),
        db().from('tasks').select('assigned_to, status').is('archived_at', null).not('status', 'in', '(completed,cancelled)'),
        reviewApi.rounds(deliverableId).catch(() => [] as ClientRound[]),
      ]);
      if (t.error) throw new Error(t.error.message);
      setTasks((t.data ?? []) as TaskRow[]);
      setDeps((dp.data ?? []) as DepRow[]);
      setRounds(r);
      const counts: Record<string, number> = {};
      for (const o of (open.data ?? []) as Array<{ assigned_to: string | null }>) if (o.assigned_to) counts[o.assigned_to] = (counts[o.assigned_to] ?? 0) + 1;
      setLoad(counts);
      let client = '';
      const clientId = p.data?.client_id ?? row.client_id;
      if (clientId) {
        const c = await db().from('clients').select('company_name').eq('id', clientId).maybeSingle();
        client = c.data?.company_name ?? '';
      }
      setNames({ project: p.data?.name ?? '', client });
      setError('');
    } catch (err) {
      log.error('deliverable page failed to load', err);
      setError(err instanceof Error ? err.message : 'Could not load this deliverable.');
    }
  }, [deliverableId]);

  useEffect(() => { void reload(); }, [reload]);

  // The page sits over the app; stop the page behind it from scrolling.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const nameOf = useCallback((id: string | null) => (id ? employees.find((e) => e.id === id)?.name ?? 'Someone' : ''), [employees]);
  const clientName = names.client || 'the client';
  const today = todayIST();

  /* ---------- derived state ---------- */
  const live = useMemo(() => tasks.filter((t) => t.status !== 'cancelled'), [tasks]);
  /** Only the people working on this deliverable, in the order they joined it. */
  const team = useMemo(() => {
    const ids: string[] = [];
    for (const t of live) if (t.assigned_to && !ids.includes(t.assigned_to)) ids.push(t.assigned_to);
    for (const id of extraPeople) if (!ids.includes(id)) ids.push(id);
    return ids.map((id) => employees.find((e) => e.id === id) ?? { id, name: nameOf(id), designation: undefined } as AssignTarget);
  }, [live, extraPeople, employees, nameOf]);
  const onItCount = (id: string) => live.filter((t) => t.assigned_to === id && t.status !== 'completed').length;
  const notOnIt = employees.filter((e) => !team.some((m) => m.id === e.id));
  const doneCount = live.filter((t) => t.status === 'completed').length;
  const openTasks = live.filter((t) => t.status !== 'completed');
  const unassigned = openTasks.filter((t) => !t.assigned_to);
  const allDone = live.length > 0 && openTasks.length === 0;
  const stageDays = daysSince(d?.stage_since ?? d?.created_at);
  const idx = d ? stageIndex(d.status) : 0;
  const sentRounds = rounds.filter((r) => r.status !== 'withdrawn');
  const draftsUsed = sentRounds.length;
  const pendingRound = rounds.find((r) => r.status === 'pending');
  const waitingDeps = deps.filter((x) => ['Requested', 'Pending', 'Resubmission Required'].includes(x.status));

  /** Everything this deliverable is waiting on, worst first. */
  const blockers = useMemo(() => {
    const out: Array<{ key: string; age: number; tone: Tone; title: string; detail: string }> = [];
    if (pendingRound) {
      const age = daysSince(pendingRound.sent_at);
      out.push({ key: 'round', age, tone: age >= 3 ? 'rose' : 'amber', title: `${clientName} has not answered draft ${pendingRound.round_no}`, detail: `Sent ${when(pendingRound.sent_at)}. Nothing moves until they approve or ask for changes.` });
    }
    for (const x of waitingDeps) {
      const age = daysSince(x.created_at);
      out.push({ key: `dep-${x.id}`, age, tone: 'amber', title: `Waiting on ${clientName} for: ${x.name}`, detail: `Asked ${dayWord(age)} ago${x.required_by ? ` · needed by ${fmtDate(x.required_by)}` : ''}.` });
    }
    for (const t of unassigned) {
      out.push({ key: `un-${t.id}`, age: daysSince(t.created_at), tone: 'rose', title: `“${t.title}” has nobody on it`, detail: `Created ${dayWord(daysSince(t.created_at))} ago${t.due_date ? ` · due ${fmtDate(t.due_date)}` : ''}.` });
    }
    for (const t of openTasks) {
      if (!t.assigned_to) continue;
      if (t.status === 'blocked') out.push({ key: `bl-${t.id}`, age: daysSince(t.started_at ?? t.created_at), tone: 'rose', title: `“${t.title}” is blocked`, detail: `${nameOf(t.assigned_to)} cannot continue without help.` });
      else if (t.status === 'awaiting_review') out.push({ key: `rv-${t.id}`, age: daysSince(t.submitted_at), tone: 'amber', title: `“${t.title}” is waiting for your review`, detail: `${nameOf(t.assigned_to)} handed it in ${t.submitted_at ? when(t.submitted_at) : 'recently'}.` });
      else if (t.due_date && t.due_date < today) {
        const late = Math.max(1, Math.floor((new Date(`${today}T00:00:00`).getTime() - new Date(`${t.due_date}T00:00:00`).getTime()) / DAY));
        out.push({ key: `late-${t.id}`, age: late, tone: 'rose', title: `“${t.title}” is ${dayWord(late)} past its date`, detail: `${nameOf(t.assigned_to)} · ${TASK_LABEL[t.status] ?? t.status} · was due ${fmtDate(t.due_date)}.` });
      }
    }
    return out.sort((a, b) => b.age - a.age);
  }, [pendingRound, waitingDeps, unassigned, openTasks, clientName, nameOf, today]);

  /** The one-line answer to "where is this?", with the step that moves it on. */
  const now = useMemo((): { tone: Tone; title: string; detail: string; action?: { label: string; status?: string; tab?: TabId } } => {
    if (!d) return { tone: 'brand', title: 'Loading…', detail: '' };
    const s = d.status;
    if (s === 'Completed' || s === 'Ready for Download') return { tone: 'mint', title: 'Approved and finished', detail: `${clientName} signed this off. Nothing is waiting.` };
    if (s === 'Cancelled') return { tone: 'rose', title: 'Cancelled', detail: 'This deliverable was cancelled.' };
    if (s === 'Awaiting Client Review') return { tone: stageDays >= 3 ? 'rose' : 'amber', title: `Waiting on ${clientName} ${forDays(stageDays)}`, detail: pendingRound ? `Draft ${pendingRound.round_no} went out ${when(pendingRound.sent_at)}. It is their move.` : 'A draft is with the client. It is their move.', action: { label: 'See what was sent', tab: 'client' } };
    if (s === 'Awaiting Client Dependency') return { tone: 'amber', title: `Waiting on ${clientName} ${forDays(stageDays)}`, detail: waitingDeps.length ? `We asked for: ${waitingDeps.map((x) => x.name).join(', ')}.` : 'We need something from the client before work can continue.', action: { label: 'See what is holding it up', tab: 'holding' } };
    if (s === 'Under Internal Review') return { tone: 'brand', title: `In internal review ${forDays(stageDays)}`, detail: 'Check the work, then send a draft link to the client.', action: { label: 'Send to client', tab: 'client' } };
    if (live.length === 0) return { tone: 'rose', title: 'Not broken into tasks yet', detail: 'Nobody is working on this. Add the tasks and give each one an owner.', action: s === 'Draft' ? { label: 'Mark ready to start', status: 'Pending' } : undefined };
    if (unassigned.length > 0) return { tone: 'rose', title: `${unassigned.length} task${unassigned.length === 1 ? ' has' : 's have'} nobody on ${unassigned.length === 1 ? 'it' : 'them'}`, detail: 'Tick the tasks, then pick a name from the team list to hand them out.' };
    if (allDone) return { tone: 'mint', title: 'Every task is done — ready for internal review', detail: 'All the pieces were approved. Move it on so it can go to the client.', action: (s === 'In Progress' || s === 'Revision In Progress') ? { label: 'Move to internal review', status: 'Under Internal Review' } : s === 'Pending' ? { label: 'Start work', status: 'In Progress' } : undefined };
    if (s === 'Draft') return { tone: 'amber', title: 'Planned, not started', detail: 'Tasks are set up. Mark it ready when the contract is in place.', action: { label: 'Mark ready to start', status: 'Pending' } };
    if (s === 'Pending') return { tone: 'amber', title: `Ready to start ${forDays(stageDays)}`, detail: `${openTasks.length} task${openTasks.length === 1 ? '' : 's'} assigned and waiting.`, action: { label: 'Start work', status: 'In Progress' } };
    if (s === 'Modification Requested') return { tone: 'rose', title: `${clientName} asked for changes`, detail: 'Pass the feedback to the task it belongs to, then start the revision.', action: { label: 'See the feedback', tab: 'client' } };
    const worst = blockers[0];
    return { tone: worst && worst.tone === 'rose' ? 'rose' : 'brand', title: `${openTasks.length} of ${live.length} task${live.length === 1 ? '' : 's'} still open`, detail: worst ? `Most pressing: ${worst.title}.` : `In this stage ${forDays(stageDays)}. Work is moving.` };
  }, [d, clientName, stageDays, pendingRound, waitingDeps, live.length, unassigned.length, allDone, openTasks.length, blockers]);

  /** When each stage was reached, from what the records say. */
  const stageDates = useMemo(() => {
    const starts = live.map((t) => t.started_at).filter(Boolean).sort() as string[];
    const dones = live.map((t) => t.completed_at).filter(Boolean).sort() as string[];
    const firstSent = [...sentRounds].sort((a, b) => a.round_no - b.round_no)[0]?.sent_at ?? null;
    const approved = rounds.find((r) => r.status === 'approved')?.decided_at ?? null;
    return [d?.created_at ?? null, starts[0] ?? null, allDone ? dones[dones.length - 1] ?? null : null, firstSent, approved];
  }, [live, sentRounds, rounds, d?.created_at, allDone]);

  const record = useMemo(() => {
    const ev: Array<{ at: string; what: string; who: string }> = [];
    for (const r of rounds) {
      ev.push({ at: r.sent_at, what: `Draft ${r.round_no} sent to the client${r.is_extra ? ' (extra, charged)' : ''}`, who: 'Team' });
      if (r.decided_at && r.status === 'approved') ev.push({ at: r.decided_at, what: `Client approved draft ${r.round_no}`, who: clientName });
      if (r.decided_at && r.status === 'changes_requested') ev.push({ at: r.decided_at, what: `Client asked for changes on draft ${r.round_no}`, who: r.client_comment ? `${clientName} — “${r.client_comment}”` : clientName });
    }
    for (const t of tasks) {
      ev.push({ at: t.created_at, what: `Task added: ${t.title}`, who: t.assigned_to ? `for ${nameOf(t.assigned_to)}` : 'nobody assigned' });
      if (t.submitted_at) ev.push({ at: t.submitted_at, what: `${t.title} handed in`, who: nameOf(t.assigned_to) });
      if (t.completed_at) ev.push({ at: t.completed_at, what: `${t.title} approved`, who: nameOf(t.assigned_to) });
    }
    for (const x of deps) {
      ev.push({ at: x.created_at, what: `Asked the client for: ${x.name}`, who: 'Team' });
      if (x.uploaded_at) ev.push({ at: x.uploaded_at, what: `Client sent: ${x.name}`, who: clientName });
    }
    if (d) ev.push({ at: d.created_at, what: 'Deliverable created', who: d.responsible_name ?? 'Admin' });
    return ev.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [rounds, tasks, deps, d, clientName, nameOf]);

  /* ---------- actions ---------- */
  const moveStatus = async (status: string) => {
    if (!d || busy) return;
    setBusy('status');
    try {
      const { error: e } = await db().rpc('staff_set_deliverable_status', { p_deliverable_id: d.id, p_status: status, p_note: null });
      if (e) throw new Error(e.message);
      notify(`Moved to ${status}.`, 'success');
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not move this deliverable.', 'error'); }
    finally { setBusy(''); }
  };

  const assign = async (taskIds: string[], employeeId: string) => {
    if (!taskIds.length || !employeeId || busy) return;
    setBusy('assign');
    try {
      for (const id of taskIds) {
        const row = tasks.find((t) => t.id === id);
        if (!row || row.assigned_to === employeeId) continue;
        const { error: e } = await db().from('tasks').update({ assigned_to: employeeId }).eq('id', id);
        if (e) throw new Error(e.message);
        void notifyTaskAssigned({ assigneeEmployeeId: employeeId, taskTitle: row.title, dueDate: row.due_date ?? '', taskId: id, actorUserId: '' });
      }
      notify(taskIds.length === 1 ? `Given to ${nameOf(employeeId)}.` : `${taskIds.length} tasks given to ${nameOf(employeeId)}.`, 'success');
      setSelected({});
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not move the task.', 'error'); await reload(); }
    finally { setBusy(''); }
  };

  const submitNew = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy('new');
    try {
      await createAssignedTask(new FormData(e.currentTarget), { requestId: crypto.randomUUID(), deliverableId });
      notify('Task assigned.', 'success');
      setAddOpen(false);
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not assign this task.', 'error'); }
    finally { setBusy(''); }
  };

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: 'work', label: 'Work', count: live.length },
    { id: 'holding', label: 'Holding it up', count: blockers.length },
    { id: 'client', label: 'Client review', count: draftsUsed },
    { id: 'record', label: 'The record' },
  ];

  /* ---------- render ---------- */
  return createPortal(
    <div className="fixed inset-0 z-[70] overflow-y-auto" style={{ background: 'var(--app-bg)' }} role="dialog" aria-modal="true" aria-label={d ? d.name : 'Deliverable'}>
      <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-8 pt-5 pb-40 space-y-5">

        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" onClick={onClose} className="btn-secondary btn-sm shrink-0"><ArrowLeft className="w-4 h-4" />Back</button>
            <p className="text-[13px] font-semibold text-ink-500 truncate">
              {names.client || 'Client'} <span aria-hidden="true">/</span> {names.project || 'Project'} <span aria-hidden="true">/</span> <span className="text-ink-900">{d?.name ?? '…'}</span>
            </p>
          </div>
          {onEditDetails && <button type="button" onClick={onEditDetails} className="btn-secondary btn-sm"><Pencil className="w-4 h-4" />Details &amp; settings</button>}
        </div>

        {error && <div className="card p-5 text-[13.5px] text-rose-700">{error}</div>}

        {d && (
          <>
            {/* Header */}
            <section className="card p-5 sm:p-6 flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0 space-y-2.5">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="font-display text-[26px] font-bold tracking-tight text-ink-950">{d.name}</h1>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-brand-50 text-brand-700">{d.deliverable_number}</span>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13.5px] text-ink-600">
                  <span>Due <strong className="text-ink-900">{d.due_date ? fmtDate(d.due_date) : 'no date'}</strong></span>
                  <span>Drafts <strong className="text-ink-900">{draftsUsed} of {d.included_drafts ?? 3} used</strong></span>
                  <span>Tasks <strong className="text-ink-900">{doneCount} of {live.length} done</strong></span>
                  {d.responsible_name && <span>Responsible <strong className="text-ink-900">{d.responsible_name}</strong></span>}
                </div>
              </div>
              <span className="text-[12.5px] font-bold px-3 py-1.5 rounded-full bg-ink-100 text-ink-700">{d.status} · {stageDays === 0 ? 'since today' : `day ${stageDays + 1}`}</span>
            </section>

            {/* Right now */}
            <section className="card p-5 sm:p-6 pl-7 sm:pl-8 flex flex-wrap items-center justify-between gap-5" style={{ position: 'relative', overflow: 'hidden' }}>
              <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: TONE_EDGE[now.tone] }} />
              <div className="min-w-0 max-w-[720px] space-y-1.5">
                <p className={`text-[11.5px] font-extrabold tracking-[0.06em] ${TONE_TEXT[now.tone]}`}>RIGHT NOW</p>
                <h2 className="font-display text-[24px] sm:text-[27px] font-bold tracking-tight leading-tight text-ink-950">{now.title}</h2>
                {now.detail && <p className="text-[14px] text-ink-600 leading-relaxed">{now.detail}</p>}
              </div>
              {now.action && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy === 'status'}
                  onClick={() => { const a = now.action!; if (a.status) void moveStatus(a.status); else if (a.tab) setTab(a.tab); }}
                >
                  {now.action.label}
                </button>
              )}
            </section>

            {/* Journey */}
            <section className="card p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
                <h2 className="text-[15px] font-bold">The journey</h2>
                <p className="text-[12.5px] text-ink-500">Created {fmtDate(d.created_at)}{d.due_date ? ` · due ${fmtDate(d.due_date)}` : ''}</p>
              </div>
              <ol className="grid grid-cols-2 sm:grid-cols-5 gap-y-5">
                {STAGES.map((s, i) => {
                  const done = i < idx || (i === idx && s.id === 'done');
                  const here = i === idx && s.id !== 'done';
                  const long = here && stageDays >= 3;
                  return (
                    <li key={s.id} className="pr-3">
                      <div className="flex items-center">
                        <span className={`w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-mint-500 text-white' : here ? (long ? 'bg-amber-400 ring-4 ring-amber-100' : 'bg-brand-600 ring-4 ring-brand-100') : 'bg-ink-200'}`}>
                          {done && <Check className="w-3 h-3" strokeWidth={3} />}
                        </span>
                        <span className={`flex-1 h-[3px] ${done ? 'bg-mint-500' : 'bg-ink-100'}`} />
                      </div>
                      <p className={`mt-2.5 text-[13px] ${here ? 'font-extrabold text-ink-950' : done ? 'font-semibold text-ink-900' : 'font-semibold text-ink-400'}`}>{s.name}</p>
                      <p className="text-[11.5px] text-ink-500">
                        {here ? d.status : done ? (stageDates[i] ? fmtDate(stageDates[i]) : 'done') : 'still to come'}
                      </p>
                      {here && <p className={`text-[11.5px] font-bold ${long ? 'text-amber-800' : 'text-brand-700'}`}>{stageDays === 0 ? 'arrived today' : `${dayWord(stageDays)} here`}</p>}
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* Tabs */}
            <div className="inline-flex flex-wrap gap-1 p-1 rounded-full bg-white border border-ink-100" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-2 rounded-full text-[13px] font-semibold transition-colors ${tab === t.id ? 'bg-ink-950 text-white' : 'text-ink-600 hover:text-ink-900'}`}
                >
                  {t.label}
                  {t.count != null && t.count > 0 && <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-full ${tab === t.id ? 'bg-white/20' : t.id === 'holding' ? 'bg-rose-50 text-rose-700' : 'bg-ink-100 text-ink-600'}`}>{t.count}</span>}
                </button>
              ))}
            </div>

            {/* Work: people + tasks */}
            {tab === 'work' && (
              <div className="flex flex-wrap gap-5 items-start">
                <aside className="card p-4 w-full lg:w-[280px] shrink-0">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-[14px] font-bold">Working on this</h3>
                    <span className="text-xs font-semibold text-ink-500">{team.length} {team.length === 1 ? 'person' : 'people'}</span>
                  </div>
                  <p className="text-[12.5px] text-ink-500 mt-1 mb-3 leading-snug">
                    {selectedIds.length ? `Click a name to give them the ${selectedIds.length} ticked task${selectedIds.length === 1 ? '' : 's'}.` : 'Tick tasks in the list, then click a name.'}
                  </p>
                  <ul className="space-y-2 max-h-[420px] overflow-y-auto">
                    {team.map((p) => {
                      const n = load[p.id] ?? 0;
                      const here = onItCount(p.id);
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            disabled={!selectedIds.length || busy === 'assign'}
                            onClick={() => void assign(selectedIds, p.id)}
                            className={`w-full flex items-center gap-3 text-left rounded-2xl border px-3 py-2.5 transition-colors ${selectedIds.length ? 'border-brand-200 hover:bg-brand-50 cursor-pointer' : 'border-ink-100 cursor-default'}`}
                          >
                            <span className="w-8 h-8 rounded-xl bg-brand-50 text-brand-700 text-[12px] font-extrabold flex items-center justify-center shrink-0">{initials(p.name)}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13.5px] font-bold text-ink-900 truncate">{p.name}</span>
                              {p.designation && <span className="block text-[11.5px] text-ink-500 truncate">{p.designation}</span>}
                            </span>
                            <span className="text-right shrink-0">
                              <span className="block text-[11.5px] font-bold text-ink-900 whitespace-nowrap">{here} here</span>
                              <span className={`block text-[11px] font-semibold whitespace-nowrap ${n >= 8 ? 'text-rose-700' : n >= 5 ? 'text-amber-800' : 'text-ink-500'}`}>{n} open in all</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                    {team.length === 0 && <li className="text-[12.5px] text-ink-500 px-1 py-2">Nobody is on this yet. Add a person, or add a task with an owner.</li>}
                  </ul>
                  {addPersonOpen ? (
                    <div className="mt-2">
                      <label className="sr-only" htmlFor="add-person">Add a person</label>
                      <select
                        id="add-person"
                        autoFocus
                        className="input !min-h-[40px] !py-2 text-[13px]"
                        defaultValue=""
                        onChange={(e) => { const v = e.target.value; if (v) setExtraPeople((x) => [...x, v]); setAddPersonOpen(false); }}
                        onBlur={() => setAddPersonOpen(false)}
                      >
                        <option value="" disabled>Pick someone…</option>
                        {notOnIt.map((p) => <option key={p.id} value={p.id}>{p.name}{p.designation ? ` · ${p.designation}` : ''} ({load[p.id] ?? 0} open)</option>)}
                      </select>
                    </div>
                  ) : notOnIt.length > 0 && (
                    <button type="button" onClick={() => setAddPersonOpen(true)} className="mt-2 w-full rounded-2xl border border-dashed border-ink-200 text-[13px] font-bold text-ink-700 py-2.5 hover:border-brand-300 hover:text-brand-700 flex items-center justify-center gap-1.5">
                      <UserPlus className="w-4 h-4" />Add person
                    </button>
                  )}
                  {myEmployeeId && (
                    <div className="mt-3 pt-3 border-t border-ink-100">
                      <button type="button" disabled={!selectedIds.length || busy === 'assign'} onClick={() => void assign(selectedIds, myEmployeeId)} className="w-full rounded-2xl bg-ink-950 text-white text-[13.5px] font-bold py-3 disabled:opacity-40">Take it myself</button>
                      <p className="text-[11.5px] text-ink-500 mt-2 leading-snug">You can hold a task like anyone else. It still goes through review.</p>
                    </div>
                  )}
                </aside>

                <section className="card overflow-hidden flex-1 min-w-0 basis-[560px]">
                  <div className="px-5 py-4 border-b border-ink-100 flex flex-wrap items-center justify-between gap-3">
                    {selectedIds.length > 0 ? (
                      <div className="flex items-center gap-3">
                        <span className="text-[13.5px] font-extrabold">{selectedIds.length} selected</span>
                        <span className="text-[13px] text-ink-500">Pick someone from the team list</span>
                        <button type="button" onClick={() => setSelected({})} className="text-[12.5px] font-bold text-ink-500 hover:text-ink-900">Clear</button>
                      </div>
                    ) : (
                      <div className="flex items-baseline gap-2.5">
                        <h3 className="text-[15px] font-bold">Tasks in this deliverable</h3>
                        <span className="text-[12.5px] font-semibold text-ink-500">{doneCount} of {live.length} done</span>
                      </div>
                    )}
                    <button type="button" className="btn-primary btn-sm" onClick={() => setAddOpen(true)}><Plus className="w-4 h-4" />Add a task</button>
                  </div>

                  {live.length === 0 ? (
                    <div className="px-5 py-12 text-center">
                      <p className="text-[15px] font-bold text-ink-900">No tasks yet</p>
                      <p className="text-[13px] text-ink-500 mt-1 max-w-sm mx-auto">Break this deliverable into the pieces people will actually make, and give each one an owner and a brief.</p>
                      <button type="button" className="btn-primary mt-4" onClick={() => setAddOpen(true)}><Plus className="w-4 h-4" />Add the first task</button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <div className="min-w-[640px]">
                        <div className="grid grid-cols-[34px_minmax(0,2fr)_minmax(0,1.3fr)_80px_72px_136px] gap-3 px-5 py-2.5 bg-ink-50/70 border-b border-ink-100 text-[11px] font-extrabold tracking-[0.04em] text-ink-500">
                          <span /><span>TASK</span><span>OWNER</span><span>DUE</span><span>TIME</span><span>STATUS</span>
                        </div>
                        {live.map((t) => {
                          const late = t.status !== 'completed' && !!t.due_date && t.due_date < today;
                          return (
                            <div key={t.id} className={`grid grid-cols-[34px_minmax(0,2fr)_minmax(0,1.3fr)_80px_72px_136px] gap-3 px-5 py-3 border-b border-ink-100 items-center ${selected[t.id] ? 'bg-brand-50/50' : 'bg-white'}`}>
                              <input
                                type="checkbox"
                                className="w-[17px] h-[17px] accent-[var(--brand)] cursor-pointer"
                                aria-label={`Select ${t.title}`}
                                checked={!!selected[t.id]}
                                disabled={t.status === 'completed'}
                                onChange={() => setSelected((s) => ({ ...s, [t.id]: !s[t.id] }))}
                              />
                              <button type="button" onClick={() => void openTaskDetail(t.id)} className="min-w-0 text-left group" title="Open the task">
                                <span className="block text-[14px] font-bold text-ink-900 truncate group-hover:text-brand-700 group-hover:underline">{t.title}</span>
                                <span className="block text-[11.5px] text-ink-500 truncate">{t.description || 'No brief written'}</span>
                              </button>
                              <span className="min-w-0">
                                <label className="sr-only" htmlFor={`owner-${t.id}`}>Owner of {t.title}</label>
                                <select
                                  id={`owner-${t.id}`}
                                  className={`w-full rounded-xl border px-2.5 py-1.5 text-[13px] font-semibold bg-white ${t.assigned_to ? 'border-ink-100 text-ink-900' : 'border-dashed border-amber-400 bg-amber-50 text-amber-800'}`}
                                  value={t.assigned_to ?? ''}
                                  disabled={busy === 'assign' || t.status === 'completed'}
                                  onChange={(e) => void assign([t.id], e.target.value)}
                                >
                                  {!t.assigned_to && <option value="">Pick someone</option>}
                                  {t.assigned_to && !employees.some((p) => p.id === t.assigned_to) && <option value={t.assigned_to}>{nameOf(t.assigned_to)}</option>}
                                  {employees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                              </span>
                              <span className={`text-[13px] font-semibold ${late ? 'text-rose-700' : 'text-ink-900'}`}>{t.due_date ? fmtDate(t.due_date).replace(/ \d{4}$/, '') : '—'}</span>
                              <span className="text-[13px] text-ink-600 tnum">{mins(t.time_spent_minutes)}</span>
                              <button type="button" onClick={() => void openTaskDetail(t.id)} className="justify-self-start text-left min-w-0" title={t.status_note ?? undefined}>
                                <span className={`inline-block text-[11.5px] font-bold px-2.5 py-1 rounded-full ${TASK_TONE[t.status] ?? 'bg-ink-100 text-ink-700'}`}>
                                  {TASK_LABEL[t.status] ?? t.status}{['in_progress', 'blocked', 'revision_required'].includes(t.status) && (t.progress_pct ?? 0) > 0 ? ` · ${t.progress_pct}%` : ''}
                                </span>
                                <span className="block text-[10.5px] text-ink-500 mt-0.5 truncate">
                                  {t.status === 'completed' && t.completed_at ? when(t.completed_at)
                                    : t.status === 'awaiting_review' && t.submitted_at ? `in ${when(t.submitted_at)}`
                                    : t.started_at ? `since ${when(t.started_at)}`
                                    : t.accepted_at ? `${when(t.accepted_at)}` : ''}
                                </span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {live.length > 0 && (
                    <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-28 h-[7px] rounded-full bg-ink-100 overflow-hidden shrink-0"><span className="block h-full bg-brand-600" style={{ width: `${Math.round((doneCount / live.length) * 100)}%` }} /></span>
                        <span className="text-[13px] text-ink-600">
                          {doneCount} of {live.length} done
                          {unassigned.length > 0 && <> · <strong className="text-rose-700">{unassigned.length} with nobody on {unassigned.length === 1 ? 'it' : 'them'}</strong></>}
                        </span>
                      </div>
                      {unassigned.length > 0 && <span className="text-[12px] text-amber-800 flex items-center gap-1.5"><UserPlus className="w-3.5 h-3.5" />An unowned task holds up the whole deliverable</span>}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* Holding it up */}
            {tab === 'holding' && (
              <section className="card p-5 sm:p-6">
                <h3 className="text-[15px] font-bold">What is holding it up</h3>
                <p className="text-[12.5px] text-ink-500 mt-0.5 mb-4">Everything this deliverable is waiting on, longest first.</p>
                {blockers.length === 0 ? (
                  <p className="text-[13.5px] text-ink-600">Nothing. It is moving.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {blockers.map((b) => (
                      <li key={b.key} className={`rounded-2xl border px-4 py-3 flex items-start gap-3.5 ${b.tone === 'rose' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}>
                        <span className={`w-10 h-10 rounded-xl bg-white border flex items-center justify-center text-[12px] font-extrabold shrink-0 ${b.tone === 'rose' ? 'border-rose-200 text-rose-700' : 'border-amber-200 text-amber-800'}`}>{b.age > 0 ? `${b.age}d` : "new"}</span>
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-bold text-ink-900">{b.title}</span>
                          <span className="block text-[12.5px] text-ink-600 leading-snug">{b.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* Client review: the existing send / decide / forward loop */}
            {tab === 'client' && (
              <section className="card p-5 sm:p-6">
                <h3 className="text-[15px] font-bold">Client review</h3>
                <p className="text-[12.5px] text-ink-500 mt-0.5 mb-4">{draftsUsed} of {d.included_drafts ?? 3} included drafts used. The client never sees task names or who did the work.</p>
                <StaffClientReview deliverableId={d.id} deliverableStatus={d.status} nameOf={(id) => nameOf(id) || 'Someone'} onChanged={reload} />
              </section>
            )}

            {/* The record */}
            {tab === 'record' && (
              <section className="card p-5 sm:p-6">
                <div className="flex items-baseline justify-between mb-3">
                  <h3 className="text-[15px] font-bold">The record</h3>
                  <span className="text-[12.5px] text-ink-500">newest first</span>
                </div>
                <ul className="divide-y divide-ink-100">
                  {(showAllRecord ? record : record.slice(0, 8)).map((h, i) => (
                    <li key={`${h.at}-${i}`} className="flex gap-4 py-3">
                      <span className="text-[12px] font-semibold text-ink-500 w-[104px] shrink-0">{when(h.at)}</span>
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-semibold text-ink-900">{h.what}</span>
                        <span className="block text-[12px] text-ink-500">{h.who}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {record.length > 8 && !showAllRecord && (
                  <button type="button" className="btn-secondary w-full mt-3" onClick={() => setShowAllRecord(true)}>Show all {record.length} entries</button>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {openTask && (
        <TaskDetail
          task={openTask}
          tasks={[]}
          employees={employees as unknown as Employee[]}
          viewer={{ employeeId: myEmployeeId ?? '', isAdmin: !myEmployeeId }}
          onClose={() => setOpenTask(null)}
          onChanged={async () => { await reload(); await openTaskDetail(openTask.id); }}
        />
      )}

      {addOpen && d && (
        <Modal title="Assign work" onClose={() => setAddOpen(false)} closeDisabled={busy === 'new'} wide>
          <TaskAssignForm
            targets={employees}
            onSubmit={submitNew}
            onClose={() => setAddOpen(false)}
            busy={busy === 'new'}
            isAdmin
            fixedDeliverable={{ id: d.id, label: `${names.client ? `${names.client} · ` : ''}${d.deliverable_number} · ${d.name}` }}
          />
        </Modal>
      )}
    </div>,
    document.body,
  );
}
