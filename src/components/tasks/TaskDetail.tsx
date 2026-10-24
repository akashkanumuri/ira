import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban, CheckCircle2, ExternalLink, FileText, Layers, Link2, MessageCircleQuestion, MessageSquare,
  Pause, Play, RefreshCw, RotateCcw, Send, ShieldAlert, Timer, Undo2, UserRound,
} from 'lucide-react';
import type { Employee, Task, TaskStatus } from '../../types/attendance';
import { dateLabel } from '../../lib/v2';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { getKolkataDateString } from '../../lib/workingDays';
import { fmtBytes, openFile } from '../../lib/sigma';
import {
  CLIENT_ROUND, DRAFT_DECISION, TASK_STATUS, fmtMinutes, isTaskClosed, loadTaskExtras, reviewApi, taskApi,
  type ClientRound, type TaskComment, type TaskDraft, type TaskEvent, type TaskFile,
} from '../../lib/tasks';
import { MOODS, clockOf, meetingLabel, workApi, type ProgressCheck, type WorkSession } from '../../lib/work';
import { useWork } from '../work/WorkTracker';
import { Avatar, Badge, Progress, cx } from '../../ui';
import { Modal } from '../../ui/Modal';

type Extras = Awaited<ReturnType<typeof loadTaskExtras>>;
type Prompt = null | { to: TaskStatus; title: string; noteLabel?: string; noteRequired?: boolean; link?: boolean; confirm: string; danger?: boolean };

const today = () => getKolkataDateString();
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** “Due in 3 days”, “Due today”, “2 days overdue”. */
function dueText(due: string, todayStr: string) {
  const d = Math.round((Date.parse(due) - Date.parse(todayStr)) / 86400000);
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d > 1) return `Due in ${d} days`;
  return `${-d} day${d === -1 ? '' : 's'} overdue`;
}
const clock = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
};

const EVENT_TEXT: Record<string, string> = {
  assigned: 'assigned the task', accepted: 'accepted it', in_progress: 'started work', blocked: 'marked it blocked',
  awaiting_review: 'handed it in', revision_required: 'asked for changes', completed: 'marked it complete',
  cancelled: 'cancelled it', removed: 'removed it',
};

export interface TaskViewer { employeeId: string; isAdmin: boolean }

/** Per-task review numbers: how many drafts it took and how they were judged. */
function TaskScorecard({ drafts, rounds }: { drafts: TaskDraft[]; rounds: ClientRound[] }) {
  const decided = drafts.filter((d) => d.decision !== 'pending');
  const approved = decided.filter((d) => d.decision === 'approved' || d.decision === 'auto_approved');
  const changes = decided.filter((d) => d.decision === 'changes_requested');
  const onTime = drafts.filter((d) => d.on_time !== false).length;
  const firstApproved = [...drafts].sort((a, b) => a.draft_no - b.draft_no).find((d) => d.decision === 'approved' || d.decision === 'auto_approved');
  const rate = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');
  const clientDecided = rounds.filter((r) => r.status === 'approved' || r.status === 'changes_requested');
  const clientOk = rounds.find((r) => r.status === 'approved');
  const tiles: Array<{ k: string; v: string; sub: string; tone?: string }> = [
    { k: 'Drafts', v: String(drafts.length), sub: firstApproved ? `approved on draft ${firstApproved.draft_no}` : decided.length ? 'not approved yet' : 'waiting for review' },
    { k: 'Approval rate', v: rate(approved.length, decided.length), sub: `${approved.length} of ${decided.length} reviewed`, tone: decided.length ? 'text-mint-700' : undefined },
    { k: 'Changes requested', v: rate(changes.length, decided.length), sub: `${changes.length} draft${changes.length === 1 ? '' : 's'} sent back`, tone: changes.length ? 'text-rose-600' : undefined },
    { k: 'On time', v: rate(onTime, drafts.length), sub: `${onTime} of ${drafts.length} by the due date` },
  ];
  if (rounds.length) tiles.push({ k: 'Client', v: clientOk ? `v${clientOk.round_no} ✓` : `${rounds.length} sent`, sub: `${clientDecided.filter((r) => r.status === 'changes_requested').length} change request${clientDecided.filter((r) => r.status === 'changes_requested').length === 1 ? '' : 's'}`, tone: clientOk ? 'text-mint-700' : undefined });
  return (
    <section aria-label="Task scorecard" className={cx('grid gap-2', tiles.length > 4 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4')}>
      {tiles.map((t) => (
        <div key={t.k} className="rounded-2xl border border-ink-100 bg-white px-3.5 py-3 min-w-0">
          <p className="text-[11px] font-semibold text-ink-500">{t.k}</p>
          <p className={cx('font-display text-[22px] font-bold leading-tight tnum', t.tone ?? 'text-ink-900')}>{t.v}</p>
          <p className="text-[11px] text-ink-500 truncate">{t.sub}</p>
        </div>
      ))}
    </section>
  );
}

export function TaskDetail({
  task, employees, viewer, deliverableName, onClose, onChanged,
}: {
  task: Task;
  tasks: Task[];
  employees: Employee[];
  viewer: TaskViewer;
  /** Kept for callers; subtasks were removed from the task page. */
  subtaskTargets?: Employee[];
  deliverableName?: (id?: string | null) => string | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const work = useWork();
  const [extras, setExtras] = useState<Extras | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [note, setNote] = useState('');
  const [link, setLink] = useState(task.submittedLink ?? '');
  const [comment, setComment] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
  const [fwd, setFwd] = useState<{ id: string; note: string } | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState('');
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [checks, setChecks] = useState<ProgressCheck[]>([]);
  const [tick, setTick] = useState(() => Date.now());
  const threadEnd = useRef<HTMLDivElement>(null);

  // Employees can only read their own record; task_people adds the names of the people on their tasks.
  const [people, setPeople] = useState<Array<{ id: string; profile_id: string | null; name: string }>>([]);
  useEffect(() => {
    let live = true;
    void (supabase as any).rpc('task_people').then(({ data }: any) => { if (live && Array.isArray(data)) setPeople(data); });
    return () => { live = false; };
  }, []);
  const allPeople = useMemo(() => {
    const list: Array<Pick<Employee, 'id' | 'name' | 'profileId'>> = [...employees];
    for (const p of people) if (!employees.some((e) => e.id === p.id)) list.push({ id: p.id, name: p.name, profileId: p.profile_id });
    return list;
  }, [employees, people]);
  const byId = useMemo(() => new Map(allPeople.map((e) => [e.id, e])), [allPeople]);
  const byProfile = useMemo(() => new Map(allPeople.filter((e) => e.profileId).map((e) => [e.profileId as string, e])), [allPeople]);

  const isAssignee = Boolean(viewer.employeeId) && task.assignedTo === viewer.employeeId;
  const isReviewer = viewer.isAdmin || (Boolean(viewer.employeeId) && task.assignedBy === viewer.employeeId);
  const closed = isTaskClosed(task) || Boolean(task.archivedAt);
  const meta = TASK_STATUS[task.status] ?? TASK_STATUS.assigned;
  const overdue = !closed && task.status !== 'awaiting_review' && task.dueDate < today();

  const reload = useCallback(async () => {
    try {
      const [x, s, c] = await Promise.all([loadTaskExtras(task.id), workApi.taskSessions(task.id), workApi.taskChecks(task.id)]);
      setExtras(x); setSessions(s); setChecks(c); setLoadError('');
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Couldn’t load task details.'); }
  }, [task.id]);
  useEffect(() => { void reload(); }, [reload]);

  const ws = work?.state ?? null;
  const running = ws?.current?.kind === 'task' && ws.current.task_id === task.id ? ws.current : null;
  const runningElsewhere = ws?.current && !running ? ws.current : null;
  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  // When the timer for this task stops (pause, check missed, submit), refresh the sessions list.
  const wasRunning = useRef(Boolean(running));
  useEffect(() => { if (wasRunning.current && !running) void reload(); wasRunning.current = Boolean(running); }, [running, reload]);

  const runningSec = running ? Math.max(0, Math.floor((tick - Date.parse(running.started_at)) / 1000)) : 0;
  const spentMin = (task.timeSpentMinutes ?? 0) + runningSec / 60;
  const drafts = extras?.drafts ?? [];
  const rounds = extras?.clientRounds ?? [];
  const nextDraftNo = (drafts[0]?.draft_no ?? 0) + 1;
  const todayStr = today();
  const todaySessions = sessions.filter((s) => getKolkataDateString(new Date(s.started_at)) === todayStr);
  const todayMin = todaySessions.reduce((m, s) => m + ((s.ended_at ? Date.parse(s.ended_at) : tick) - Date.parse(s.started_at)) / 60000, 0);
  const answered = checks.filter((c) => c.status !== 'pending' || c.asked_by);

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    if (busy) return false;
    setBusy(key);
    try {
      await fn();
      if (done) notify(done, 'success');
      await Promise.all([onChanged(), reload()]);
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Something went wrong.', 'error', 6000);
      return false;
    } finally { setBusy(null); }
  }

  const go = (to: TaskStatus, okText: string, n?: string | null, l?: string | null) =>
    run(`to:${to}`, () => taskApi.transition(task.id, to, n, l), okText).then((ok) => {
      if (ok) { setPrompt(null); setNote(''); if (to === 'awaiting_review' && isAssignee) work?.draftSubmitted(task.id); }
    });

  /* ---------- actions available to this viewer ---------- */
  const actions: Array<{ key: string; label: string; icon: React.ReactNode; kind: 'primary' | 'secondary' | 'danger' | 'mint'; onClick: () => void }> = [];
  if (!task.archivedAt) {
    if (isAssignee && ['assigned', 'accepted', 'in_progress', 'revision_required'].includes(task.status)) {
      if (isReviewer) actions.push({ key: 'done', label: 'Mark complete', icon: <CheckCircle2 className="w-4 h-4" />, kind: 'mint', onClick: () => setPrompt({ to: 'completed', title: 'Mark this task complete?', confirm: 'Mark complete' }) });
      else actions.push({ key: 'handin', label: `Submit draft ${nextDraftNo}`, icon: <Send className="w-4 h-4" />, kind: 'primary', onClick: () => { setLink(''); setPrompt({ to: 'awaiting_review', title: `Submit draft ${nextDraftNo} for review`, link: true, noteLabel: 'What changed in this draft? (optional)', confirm: 'Submit draft' }); } });
      if (task.status !== 'assigned') actions.push({ key: 'block', label: 'I’m blocked', icon: <ShieldAlert className="w-4 h-4" />, kind: 'secondary', onClick: () => setPrompt({ to: 'blocked', title: 'What’s blocking this task?', noteLabel: 'What do you need, and from whom?', noteRequired: true, confirm: 'Mark blocked' }) });
    }
    if (isReviewer && task.status === 'awaiting_review') {
      actions.push({ key: 'approve', label: `Approve draft ${drafts[0]?.draft_no ?? ''}`.trim(), icon: <CheckCircle2 className="w-4 h-4" />, kind: 'mint', onClick: () => setPrompt({ to: 'completed', title: `Approve draft ${drafts[0]?.draft_no ?? ''}`.trim(), noteLabel: 'Feedback for the assignee (optional)', confirm: 'Approve' }) });
      actions.push({ key: 'changes', label: 'Request changes', icon: <Undo2 className="w-4 h-4" />, kind: 'secondary', onClick: () => setPrompt({ to: 'revision_required', title: `What needs to change in draft ${drafts[0]?.draft_no ?? ''}?`.replace(' ?', '?'), noteLabel: 'Be specific so it can be fixed in one go', noteRequired: true, confirm: 'Send back' }) });
    }
    if (isReviewer && task.status === 'completed') actions.push({ key: 'reopen', label: 'Reopen', icon: <RotateCcw className="w-4 h-4" />, kind: 'secondary', onClick: () => setPrompt({ to: 'revision_required', title: 'Reopen with changes', noteLabel: 'What needs to change?', noteRequired: true, confirm: 'Reopen' }) });
    if (isReviewer && !closed) actions.push({ key: 'cancel', label: 'Cancel task', icon: <Ban className="w-4 h-4" />, kind: 'danger', onClick: () => setPrompt({ to: 'cancelled', title: 'Cancel this task?', noteLabel: 'Reason', noteRequired: true, confirm: 'Cancel task', danger: true }) });
  }

  const canWork = isAssignee && !task.archivedAt && !['completed', 'cancelled', 'awaiting_review'].includes(task.status);
  const notCheckedIn = !ws?.checked_in || ws.checked_out;
  const onBreak = ws?.attendance_state === 'on_break';
  const startBlockedReason = !work?.enabled ? null : notCheckedIn ? (ws?.checked_out ? 'You’ve checked out for today.' : 'Check in to start work.') : onBreak ? 'End your break first.' : !work.canStart ? 'Allow notifications to start.' : null;

  const canSendToClient = !task.archivedAt && task.status === 'completed' && Boolean(task.deliverableId) && isReviewer
    && !rounds.some((r) => r.status === 'pending');
  async function sendToClient() {
    const ok = await run('send', () => reviewApi.sendToClient(task.deliverableId as string, null, sendMsg.trim() || null, task.id), 'Sent to the client for review.');
    if (ok) { setSendOpen(false); setSendMsg(''); }
  }
  async function forward() {
    if (!fwd) return;
    const ok = await run('fwd', () => reviewApi.forward(fwd.id, fwd.note.trim() || null, task.id), 'Feedback sent to the assignee. The task is reopened.');
    if (ok) setFwd(null);
  }
  async function ask() {
    const q = askText.trim();
    if (q.length < 3) return;
    const ok = await run('ask', () => workApi.ask(task.id, q), `Asked ${task.assignedToName}. Their answer will appear here and in the discussion.`);
    if (ok) { setAskText(''); setAskOpen(false); }
  }

  async function sendComment() {
    const body = comment.trim();
    if (!body) return;
    const ok = await run('comment', () => taskApi.comment(task.id, body));
    if (ok) { setComment(''); setTimeout(() => threadEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50); }
  }

  const nameOf = (empId?: string | null) => (empId ? byId.get(empId)?.name ?? 'Employee' : 'Admin');
  const authorOf = (c: TaskComment) => (c.author_id ? byProfile.get(c.author_id)?.name ?? (c.author_id ? 'Admin' : '—') : 'Someone');
  const est = task.estimateMinutes ?? 0;

  return (
    <Modal title={task.title} onClose={onClose} wide closeDisabled={Boolean(busy)}>
      <div className="space-y-5 -mt-1">
        {/* header */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone} dot>{meta.label}</Badge>
          <Badge tone={task.priority === 'urgent' || task.priority === 'high' ? 'rose' : task.priority === 'medium' ? 'amber' : 'ink'}><span className="capitalize">{task.priority}</span></Badge>
          {!closed && task.status !== 'awaiting_review' && <Badge tone={overdue ? 'rose' : task.dueDate === todayStr ? 'amber' : 'ink'}>{dueText(task.dueDate, todayStr)}</Badge>}
          {drafts.length > 0 && <Badge tone="ink">{drafts.length} draft{drafts.length === 1 ? '' : 's'}</Badge>}
          {task.archivedAt && <Badge tone="ink">Removed</Badge>}
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {[
            ['Assigned to', task.assignedToName],
            ['Assigned by', (task.assignedBy ? byId.get(task.assignedBy)?.name : null) ?? task.assignedByName ?? 'Admin'],
            ['Dates', `${dateLabel(task.startDate)} → ${dateLabel(task.dueDate)}`],
          ].map(([k, v], i) => (
            <div key={k} className={cx('inset-tile px-3.5 py-3 min-w-0', i === 2 && 'col-span-2 sm:col-span-1')}><dt className="text-[11px] font-semibold text-ink-500">{k}</dt><dd className="text-[13px] font-bold text-ink-900 truncate mt-0.5">{v}</dd></div>
          ))}
        </dl>

        {task.statusNote && ['blocked', 'revision_required', 'cancelled', 'awaiting_review'].includes(task.status) && (
          <div className={cx('rounded-2xl px-4 py-3 text-[13px]', task.status === 'awaiting_review' ? 'bg-amber-50 text-amber-900' : task.status === 'cancelled' ? 'bg-ink-50 text-ink-700' : 'bg-rose-50 text-rose-900')}>
            <b>{task.status === 'blocked' ? 'Blocked: ' : task.status === 'revision_required' ? 'Changes requested: ' : task.status === 'cancelled' ? 'Cancelled: ' : 'Note from assignee: '}</b>{task.statusNote}
          </div>
        )}

        {/* brief */}
        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-[13px] font-bold text-ink-800"><FileText className="w-4 h-4 text-ink-400" />Brief</h4>
          {task.deliverableId && <p className="text-[13px] text-ink-600">Client deliverable: <b className="text-brand-700">{deliverableName?.(task.deliverableId) ?? 'Linked deliverable'}</b></p>}
          {task.description
            ? <p className="text-[14px] text-ink-700 whitespace-pre-wrap leading-relaxed">{task.description}</p>
            : <p className="text-[13px] text-ink-400">No brief was added. Ask in the discussion below if anything is unclear.</p>}
        </section>

        {/* tracking */}
        <section aria-label="Tracking" className={cx('rounded-2xl border p-4 space-y-3', running ? 'border-brand-200 bg-brand-50/50' : 'border-ink-200')}>
          <div className="flex flex-wrap items-center gap-3">
            <span className={cx('w-10 h-10 rounded-2xl flex items-center justify-center shrink-0', running ? 'bg-brand-600 text-white' : 'bg-ink-50 text-ink-500')}><Timer className="w-5 h-5" /></span>
            <div className="flex-1 min-w-[150px]">
              <p className="text-[12px] font-semibold text-ink-500">{running ? 'Timer running' : isAssignee ? 'Tracking' : 'Time on this task'}</p>
              <p className="font-display text-[22px] font-bold text-ink-900 tnum leading-tight">
                {running ? clock(runningSec) : fmtMinutes(Math.round(spentMin))}
                {running && <span className="text-[12px] font-semibold text-ink-500 ml-2">· {fmtMinutes(Math.round(spentMin))} total</span>}
              </p>
            </div>
            {canWork && work?.enabled && (running
              ? <button type="button" className="btn-secondary" disabled={Boolean(work.busy)} onClick={() => void work.pause()}><Pause className="w-4 h-4" />Pause</button>
              : <button type="button" className="btn-primary" disabled={Boolean(work.busy) || Boolean(startBlockedReason)} onClick={() => void work.startTask(task.id).then((ok) => { if (ok) void onChanged(); })}>
                  {work.startingId === task.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}{task.status === 'revision_required' ? 'Start changes' : 'Start'}
                </button>)}
          </div>
          {canWork && !running && (startBlockedReason || runningElsewhere) && (
            <p className="text-[12px] text-ink-500 flex flex-wrap items-center gap-2">
              {startBlockedReason ?? `Starting this pauses “${runningElsewhere?.kind === 'task' ? runningElsewhere.title : meetingLabel(runningElsewhere?.meeting_type)}”.`}
              {startBlockedReason === 'Allow notifications to start.' && <button type="button" className="font-semibold text-brand-700 underline" onClick={() => void work?.requestNotifications()}>Allow notifications</button>}
            </p>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between text-[12px] mb-1.5"><span className="font-semibold text-ink-600">Time vs estimate</span><span className="tnum font-bold text-ink-900">{est ? `${fmtMinutes(Math.round(spentMin))} / ${fmtMinutes(est)}` : 'No estimate'}</span></div>
              <Progress value={est ? Math.min(100, spentMin / est * 100) : 0} tone={est && spentMin > est ? 'rose' : 'brand'} />
            </div>
            <div>
              <div className="flex justify-between text-[12px] mb-1.5"><span className="font-semibold text-ink-600">Progress <span className="font-normal text-ink-400">from check-ins</span></span><span className="tnum font-bold text-ink-900">{Math.round(task.status === 'completed' ? 100 : task.progressPct ?? 0)}%</span></div>
              <Progress value={task.status === 'completed' ? 100 : task.progressPct ?? 0} tone={task.status === 'completed' ? 'mint' : task.status === 'blocked' ? 'rose' : 'brand'} />
            </div>
          </div>
          {todaySessions.length > 0 && (
            <div className="pt-1">
              <p className="text-[12px] font-semibold text-ink-600 mb-1.5">Today · {fmtMinutes(Math.round(todayMin))}</p>
              <ul className="flex flex-wrap gap-1.5">
                {[...todaySessions].reverse().map((s) => (
                  <li key={s.id} className={cx('rounded-full px-2.5 py-1 text-[11px] font-semibold tnum', s.ended_at ? 'bg-ink-50 text-ink-700' : 'bg-brand-100 text-brand-800')}>
                    {clockOf(s.started_at)}–{s.ended_at ? clockOf(s.ended_at) : 'now'}
                    {s.end_reason && SESSION_END[s.end_reason] ? <span className={cx('ml-1', ['missed_check', 'offline'].includes(s.end_reason) ? 'text-rose-600' : 'text-ink-400')}>· {SESSION_END[s.end_reason]}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* actions */}
        {actions.length > 0 && !prompt && (
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <button key={a.key} type="button" disabled={Boolean(busy)} onClick={a.onClick}
                className={cx(a.kind === 'primary' ? 'btn-primary' : a.kind === 'mint' ? 'btn-mint' : a.kind === 'danger' ? 'btn-ghost !text-rose-600' : 'btn-secondary', 'disabled:opacity-60')}>
                {busy === `to:${a.key}` ? <RefreshCw className="w-4 h-4 animate-spin" /> : a.icon}{a.label}
              </button>
            ))}
          </div>
        )}

        {prompt && (
          <div className="rounded-2xl border border-ink-200 p-4 space-y-3 anim-fade">
            <p className="font-display font-bold text-[15px] text-ink-900">{prompt.title}</p>
            {prompt.link && (
              <label className="block"><span className="label">Link to draft {nextDraftNo}</span>
                <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/…" className="input" autoFocus inputMode="url" />
                <span className="block text-[12px] text-ink-500 mt-1.5">Share a Drive, Figma, Canva or similar link with view access for the reviewer. Submitting stops the timer.</span>
              </label>
            )}
            {prompt.noteLabel && (
              <label className="block"><span className="label">{prompt.noteLabel}</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} className="input min-h-20" autoFocus={!prompt.link} maxLength={2000} />
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => { setPrompt(null); setNote(''); }} disabled={Boolean(busy)}>Back</button>
              <button type="button" disabled={Boolean(busy) || (prompt.noteRequired && !note.trim()) || (prompt.link && !/^https?:\/\/\S+/i.test(link.trim()))}
                className={cx(prompt.danger ? 'btn-danger' : 'btn-primary', 'disabled:opacity-50')}
                onClick={() => void go(prompt.to, `${TASK_STATUS[prompt.to].label}.`, note.trim() || null, prompt.link ? (link.trim() || null) : null)}>
                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}{prompt.confirm}
              </button>
            </div>
          </div>
        )}

        {loadError && <p className="text-[13px] text-rose-600">{loadError} <button className="underline font-semibold" onClick={() => void reload()}>Retry</button></p>}

        {/* drafts */}
        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-[13px] font-bold text-ink-800"><Layers className="w-4 h-4 text-ink-400" />Drafts
            {drafts.length > 0 && <span className="text-ink-500 font-semibold">{drafts.filter((d) => d.decision === 'approved' || d.decision === 'auto_approved').length ? 'approved on draft ' + (drafts.find((d) => d.decision === 'approved' || d.decision === 'auto_approved')?.draft_no ?? '') : `${drafts.length} submitted`}</span>}
          </h4>
          {drafts.map((d: TaskDraft) => {
            const dm = DRAFT_DECISION[d.decision];
            return (
              <div key={d.id} className={cx('rounded-2xl border px-4 py-3 space-y-2', d.decision === 'pending' ? 'border-amber-200 bg-amber-50/40' : 'border-ink-200')}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display font-bold text-[14px] text-ink-900">Draft {d.draft_no}</span>
                  <Badge tone={dm.tone} dot>{dm.label}</Badge>
                  {d.on_time === false && <Badge tone="rose">Late</Badge>}
                  <span className="text-[11px] text-ink-400 tnum ml-auto">{when(d.submitted_at)}</span>
                </div>
                <a href={d.link} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[13px] text-brand-700 font-semibold hover:underline min-w-0">
                  <Link2 className="w-4 h-4 shrink-0" /><span className="truncate">{d.link}</span><ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </a>
                {d.note && <p className="text-[13px] text-ink-600 whitespace-pre-wrap"><span className="text-ink-400">Note: </span>{d.note}</p>}
                {d.feedback && d.decision !== 'auto_approved' && (
                  <p className={cx('text-[13px] rounded-xl px-3 py-2 whitespace-pre-wrap', d.decision === 'changes_requested' ? 'bg-rose-50 text-rose-900' : 'bg-mint-50 text-mint-900')}>
                    <b>{d.decided_by ? (byProfile.get(d.decided_by)?.name ?? 'Reviewer') : 'Reviewer'}:</b> {d.feedback}
                  </p>
                )}
              </div>
            );
          })}
          {!drafts.length && task.submittedLink && (
            <a href={task.submittedLink} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border border-ink-200 px-3 py-2.5 text-[13px] text-brand-700 font-semibold hover:bg-brand-50/50">
              <Link2 className="w-4 h-4 shrink-0" /><span className="truncate flex-1">{task.submittedLink}</span><ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </a>
          )}
          {(extras?.files ?? []).map((f: TaskFile) => (
            <button key={f.id} type="button" onClick={() => void openFile(f as any).catch((e) => notify(e instanceof Error ? e.message : 'Can’t open file.', 'error'))}
              className="w-full flex items-center gap-2 rounded-xl border border-ink-200 px-3 py-2.5 text-left hover:bg-ink-50">
              <FileText className="w-4 h-4 text-ink-400 shrink-0" /><span className="text-[13px] font-semibold text-ink-800 truncate flex-1">{f.name}</span>
              <span className="text-[11px] text-ink-400 tnum">{fmtBytes(f.size_bytes)} · {dateLabel(f.created_at.slice(0, 10))}</span>
            </button>
          ))}
          {!drafts.length && !task.submittedLink && !(extras?.files.length) && <p className="text-[13px] text-ink-400">{isAssignee ? 'When the work is ready, submit it as a draft with a link.' : 'No drafts submitted yet.'}</p>}
        </section>

        {drafts.length > 0 && <TaskScorecard drafts={drafts} rounds={isReviewer ? rounds : []} />}

        {/* client review (managers and admins only; the client never sees who did the work) */}
        {isReviewer && task.deliverableId && (rounds.length > 0 || canSendToClient) && (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 text-[13px] font-bold text-ink-800"><UserRound className="w-4 h-4 text-ink-400" />Client review</h4>
              {canSendToClient && !sendOpen && <button type="button" className="btn-primary btn-sm" onClick={() => setSendOpen(true)}><Send className="w-3.5 h-3.5" />Send to client</button>}
            </div>
            {sendOpen && (
              <div className="rounded-2xl border border-brand-200 bg-brand-50/40 p-4 space-y-3 anim-fade">
                <p className="text-[13px] text-ink-700">The client gets the approved draft link as <b>version {(rounds[0]?.round_no ?? 0) + 1}</b> of <b>{deliverableName?.(task.deliverableId) ?? 'this deliverable'}</b>, sent from “IRA team”. They won’t see who worked on it.</p>
                <textarea value={sendMsg} onChange={(e) => setSendMsg(e.target.value)} className="input min-h-[70px]" maxLength={2000} placeholder="Message to the client (optional) — e.g. what to look at" />
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setSendOpen(false)} disabled={busy === 'send'}>Cancel</button>
                  <button type="button" className="btn-primary btn-sm" disabled={busy === 'send'} onClick={() => void sendToClient()}>{busy === 'send' ? 'Sending…' : 'Send for review'}</button>
                </div>
              </div>
            )}
            {rounds.map((r: ClientRound) => (
              <div key={r.id} className="rounded-2xl border border-ink-200 px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display font-bold text-[14px] text-ink-900">Version {r.round_no}</span>
                  <Badge tone={CLIENT_ROUND[r.status].tone} dot>{CLIENT_ROUND[r.status].label}</Badge>
                  <span className="text-[11px] text-ink-400 tnum ml-auto">sent {when(r.sent_at)}</span>
                </div>
                {r.client_comment && <p className={cx('text-[13px] rounded-xl px-3 py-2 whitespace-pre-wrap', r.status === 'changes_requested' ? 'bg-rose-50 text-rose-900' : 'bg-mint-50 text-mint-900')}><b>Client:</b> {r.client_comment}</p>}
                {r.status === 'changes_requested' && (r.forwarded_at
                  ? <p className="text-[12px] text-ink-500">Forwarded to {task.assignedToName} {when(r.forwarded_at)}.</p>
                  : fwd?.id === r.id ? (
                    <div className="space-y-2 anim-fade">
                      <textarea value={fwd.note} onChange={(e) => setFwd({ id: r.id, note: e.target.value })} className="input min-h-[60px]" maxLength={2000} placeholder={`Add your own guidance for ${task.assignedToName} (optional)`} />
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn-secondary btn-sm" onClick={() => setFwd(null)} disabled={busy === 'fwd'}>Cancel</button>
                        <button type="button" className="btn-primary btn-sm" disabled={busy === 'fwd'} onClick={() => void forward()}>{busy === 'fwd' ? 'Sending…' : 'Reopen task with this feedback'}</button>
                      </div>
                    </div>
                  ) : <button type="button" className="btn-secondary btn-sm" onClick={() => setFwd({ id: r.id, note: '' })}><Undo2 className="w-3.5 h-3.5" />Forward to {task.assignedToName}</button>)}
              </div>
            ))}
          </section>
        )}

        {/* progress updates */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 text-[13px] font-bold text-ink-800"><MessageCircleQuestion className="w-4 h-4 text-ink-400" />Progress updates</h4>
            {isReviewer && !isAssignee && !closed && !askOpen && <button type="button" className="btn-ghost btn-sm" onClick={() => setAskOpen(true)}><MessageCircleQuestion className="w-3.5 h-3.5" />Ask a question</button>}
          </div>
          {askOpen && (
            <div className="rounded-2xl border border-ink-200 p-3 space-y-2 anim-fade">
              <input value={askText} onChange={(e) => setAskText(e.target.value)} maxLength={300} className="input" autoFocus placeholder={`e.g. Will the first draft be ready by ${dateLabel(task.dueDate)}?`}
                onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }} />
              <p className="text-[11px] text-ink-500">{task.assignedToName} gets it as a pop-up and notification. It doesn’t affect their time.</p>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setAskOpen(false)} disabled={busy === 'ask'}>Cancel</button>
                <button type="button" className="btn-primary btn-sm" disabled={busy === 'ask' || askText.trim().length < 3} onClick={() => void ask()}>{busy === 'ask' ? 'Sending…' : 'Ask'}</button>
              </div>
            </div>
          )}
          {answered.slice(0, 10).map((c) => {
            const mood = MOODS.find((m) => m.id === c.mood);
            return (
              <div key={c.id} className="rounded-xl border border-ink-200 px-3.5 py-2.5 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  {c.status === 'answered' && mood ? <Badge tone={mood.tone} dot>{mood.label}</Badge>
                    : c.status === 'missed' ? <Badge tone="rose">Missed</Badge>
                    : c.status === 'cancelled' ? <Badge tone="ink">Not needed</Badge> : <Badge tone="amber">Waiting for reply</Badge>}
                  {c.progress_pct != null && <span className="tnum font-bold text-ink-900">{c.progress_pct}%</span>}
                  {c.asked_by && <span className="text-[11px] font-semibold text-brand-700">Asked by {byProfile.get(c.asked_by)?.name ?? 'manager'}</span>}
                  <span className="text-[11px] text-ink-400 tnum ml-auto">{when(c.answered_at ?? c.asked_at)}</span>
                </div>
                {c.asked_by && <p className="text-ink-500 mt-1">“{c.question}”</p>}
                {c.answer && <p className="text-ink-800 mt-1 whitespace-pre-wrap">{c.answer}</p>}
              </div>
            );
          })}
          {!answered.length && !askOpen && <p className="text-[13px] text-ink-400">{isAssignee ? 'While the timer runs you’ll be asked how it’s going every hour or so.' : 'Answers to progress checks show up here.'}</p>}
        </section>

        {/* discussion */}
        <section className="space-y-3">
          <h4 className="flex items-center gap-2 text-[13px] font-bold text-ink-800"><MessageSquare className="w-4 h-4 text-ink-400" />Discussion</h4>
          {(extras?.comments ?? []).map((c: TaskComment) => (
            <div key={c.id} className="flex gap-3">
              <Avatar name={authorOf(c)} size={30} tone={c.author_id && byProfile.get(c.author_id)?.id === task.assignedTo ? 'mint' : 'brand'} />
              <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-ink-50 px-3.5 py-2.5">
                <p className="text-[12px]"><b className="text-ink-900">{authorOf(c)}</b> <span className="text-ink-400">{when(c.created_at)}</span></p>
                <p className="text-[13px] text-ink-800 whitespace-pre-wrap mt-0.5 break-words">{c.body}</p>
              </div>
            </div>
          ))}
          <div ref={threadEnd} />
          {!task.archivedAt && (
            <div className="flex gap-2 items-end">
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendComment(); }}
                placeholder="Ask a question or share an update…" maxLength={4000} className="input min-h-[44px] !py-2.5" rows={1} />
              <button type="button" className="btn-primary !px-4" disabled={!comment.trim() || busy === 'comment'} onClick={() => void sendComment()} aria-label="Send comment"><Send className="w-4 h-4" /></button>
            </div>
          )}
        </section>

        {/* activity */}
        {(extras?.events.length ?? 0) > 0 && (
          <section className="space-y-2">
            <h4 className="text-[13px] font-bold text-ink-800">Activity</h4>
            <ol className="relative border-l border-ink-200 ml-1.5 space-y-2.5">
              {extras!.events.slice(0, 12).map((ev: TaskEvent) => (
                <li key={ev.id} className="pl-4 relative">
                  <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-white border-2 border-brand-400" />
                  <p className="text-[13px] text-ink-700"><b className="text-ink-900">{ev.actor_employee_id ? nameOf(ev.actor_employee_id) : 'Admin'}</b> {eventText(ev)}</p>
                  <p className="text-[11px] text-ink-400 tnum">{when(ev.created_at)}</p>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </Modal>
  );
}

const SESSION_END: Record<string, string> = {
  pause: 'paused', switch: 'switched', break: 'break', meeting: 'meeting', checkout: 'checked out', logout: 'logged out',
  offline: 'offline', missed_check: 'missed check', submitted: 'submitted', status: 'status change',
};

function eventText(ev: TaskEvent) {
  if (ev.event_type === 'progress') {
    const m = MOODS.find((x) => x.id === ev.metadata?.mood)?.label ?? 'an update';
    return <>checked in: <b>{m}</b>{ev.metadata?.progress != null ? ` · ${ev.metadata.progress}%` : ''}{ev.metadata?.note ? <span className="text-ink-500"> — “{ev.metadata.note}”</span> : null}</>;
  }
  return <>{EVENT_TEXT[ev.event_type] ?? ev.event_type.replace(/_/g, ' ')}{ev.metadata?.note ? <span className="text-ink-500"> — “{ev.metadata.note}”</span> : null}</>;
}
