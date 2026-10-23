import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban, CheckCircle2, Clock3, CornerDownRight, ExternalLink, FileText, Hand, Link2, ListChecks, MessageSquare,
  Paperclip, Play, Plus, RefreshCw, RotateCcw, Send, ShieldAlert, Timer, Undo2, X,
} from 'lucide-react';
import type { Employee, Task, TaskStatus } from '../../types/attendance';
import { dateLabel } from '../../lib/v2';
import { notify } from '../../lib/toast';
import { getKolkataDateString } from '../../lib/workingDays';
import { ACCEPT_ATTR, fmtBytes, openFile, uploadAndAttach, validateFile } from '../../lib/sigma';
import { TASK_STATUS, fmtMinutes, isTaskClosed, loadTaskExtras, taskApi, type TaskComment, type TaskEvent, type TaskFile, type TaskTimeLog, type TaskDependency } from '../../lib/tasks';
import { Avatar, Badge, Progress, cx } from '../../ui';
import { Modal } from '../../ui/Modal';

type Extras = Awaited<ReturnType<typeof loadTaskExtras>>;
type Prompt = null | { to: TaskStatus; title: string; noteLabel?: string; noteRequired?: boolean; link?: boolean; confirm: string; danger?: boolean };

const today = () => getKolkataDateString();
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const EVENT_TEXT: Record<string, string> = {
  assigned: 'assigned the task', accepted: 'accepted it', in_progress: 'started work', blocked: 'marked it blocked',
  awaiting_review: 'handed it in', revision_required: 'asked for changes', completed: 'marked it complete',
  cancelled: 'cancelled it', removed: 'removed it',
};

export interface TaskViewer { employeeId: string; isAdmin: boolean }

export function TaskDetail({
  task, tasks, employees, viewer, subtaskTargets = [], deliverableName, onClose, onChanged,
}: {
  task: Task;
  tasks: Task[];
  employees: Employee[];
  viewer: TaskViewer;
  /** People the viewer may hand a subtask to (beyond the assignee). */
  subtaskTargets?: Employee[];
  deliverableName?: (id?: string | null) => string | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [extras, setExtras] = useState<Extras | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [note, setNote] = useState('');
  const [link, setLink] = useState(task.submittedLink ?? '');
  const [progress, setProgress] = useState(task.progressPct ?? 0);
  const [comment, setComment] = useState('');
  const [timeOpen, setTimeOpen] = useState(false);
  const [timeForm, setTimeForm] = useState({ hours: '', minutes: '', date: today(), note: '' });
  const [subOpen, setSubOpen] = useState(false);
  const [subForm, setSubForm] = useState({ title: '', due: task.dueDate < today() ? today() : task.dueDate, to: '' });
  const [depPick, setDepPick] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const byProfile = useMemo(() => new Map(employees.filter((e) => e.profileId).map((e) => [e.profileId as string, e])), [employees]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const isAssignee = Boolean(viewer.employeeId) && task.assignedTo === viewer.employeeId;
  const isReviewer = viewer.isAdmin || (Boolean(viewer.employeeId) && task.assignedBy === viewer.employeeId);
  const closed = isTaskClosed(task) || Boolean(task.archivedAt);
  const meta = TASK_STATUS[task.status] ?? TASK_STATUS.assigned;
  const subtasks = tasks.filter((t) => t.parentTaskId === task.id && !t.archivedAt);
  const parent = task.parentTaskId ? taskById.get(task.parentTaskId) : null;
  const overdue = !closed && task.status !== 'awaiting_review' && task.dueDate < today();

  const reload = useCallback(async () => {
    try { setExtras(await loadTaskExtras(task.id)); setLoadError(''); }
    catch (e) { setLoadError(e instanceof Error ? e.message : 'Couldn’t load task details.'); }
  }, [task.id]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setProgress(task.progressPct ?? 0); }, [task.progressPct]);

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
    run(`to:${to}`, () => taskApi.transition(task.id, to, n, l), okText).then((ok) => { if (ok) { setPrompt(null); setNote(''); } });

  /* ---------- actions available to this viewer ---------- */
  const actions: Array<{ key: string; label: string; icon: React.ReactNode; kind: 'primary' | 'secondary' | 'danger' | 'mint'; onClick: () => void }> = [];
  if (!task.archivedAt) {
    if (isAssignee) {
      if (task.status === 'assigned') actions.push({ key: 'accept', label: 'Accept', icon: <Hand className="w-4 h-4" />, kind: 'secondary', onClick: () => void go('accepted', 'Task accepted.') });
      if (['assigned', 'accepted'].includes(task.status)) actions.push({ key: 'start', label: 'Start work', icon: <Play className="w-4 h-4" />, kind: 'primary', onClick: () => void go('in_progress', 'Marked in progress.') });
      if (task.status === 'blocked') actions.push({ key: 'resume', label: 'Resume', icon: <Play className="w-4 h-4" />, kind: 'primary', onClick: () => void go('in_progress', 'Back in progress.') });
      if (task.status === 'revision_required') actions.push({ key: 'restart', label: 'Work on changes', icon: <RotateCcw className="w-4 h-4" />, kind: 'secondary', onClick: () => void go('in_progress', 'Back in progress.') });
      if (['accepted', 'in_progress', 'revision_required'].includes(task.status)) {
        if (isReviewer) actions.push({ key: 'done', label: 'Mark complete', icon: <CheckCircle2 className="w-4 h-4" />, kind: 'mint', onClick: () => setPrompt({ to: 'completed', title: 'Mark this task complete?', confirm: 'Mark complete' }) });
        else actions.push({ key: 'handin', label: 'Hand in for review', icon: <Send className="w-4 h-4" />, kind: 'primary', onClick: () => setPrompt({ to: 'awaiting_review', title: 'Hand in for review', link: true, noteLabel: 'Note for the reviewer (optional)', confirm: 'Hand in' }) });
      }
      if (['accepted', 'in_progress', 'revision_required'].includes(task.status)) actions.push({ key: 'block', label: 'I’m blocked', icon: <ShieldAlert className="w-4 h-4" />, kind: 'secondary', onClick: () => setPrompt({ to: 'blocked', title: 'What’s blocking this task?', noteLabel: 'What do you need, and from whom?', noteRequired: true, confirm: 'Mark blocked' }) });
    }
    if (isReviewer && task.status === 'awaiting_review') {
      actions.push({ key: 'approve', label: 'Approve', icon: <CheckCircle2 className="w-4 h-4" />, kind: 'mint', onClick: () => void go('completed', 'Task approved.') });
      actions.push({ key: 'changes', label: 'Request changes', icon: <Undo2 className="w-4 h-4" />, kind: 'secondary', onClick: () => setPrompt({ to: 'revision_required', title: 'What needs to change?', noteLabel: 'Be specific so it can be fixed in one go', noteRequired: true, confirm: 'Send back' }) });
    }
    if (isReviewer && task.status === 'completed') actions.push({ key: 'reopen', label: 'Reopen', icon: <RotateCcw className="w-4 h-4" />, kind: 'secondary', onClick: () => setPrompt({ to: 'revision_required', title: 'Reopen with changes', noteLabel: 'What needs to change?', noteRequired: true, confirm: 'Reopen' }) });
    if (isReviewer && !closed) actions.push({ key: 'cancel', label: 'Cancel task', icon: <Ban className="w-4 h-4" />, kind: 'danger', onClick: () => setPrompt({ to: 'cancelled', title: 'Cancel this task?', noteLabel: 'Reason', noteRequired: true, confirm: 'Cancel task', danger: true }) });
  }

  async function uploadFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const bad = files.map(validateFile).find(Boolean);
    if (bad) { notify(bad, 'error'); return; }
    await run('upload', async () => { for (const f of files) await uploadAndAttach(f, 'task', task.id); }, files.length === 1 ? 'File attached.' : `${files.length} files attached.`);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function sendComment() {
    const body = comment.trim();
    if (!body) return;
    const ok = await run('comment', () => taskApi.comment(task.id, body));
    if (ok) { setComment(''); setTimeout(() => threadEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50); }
  }

  async function logTime() {
    const mins = (Number(timeForm.hours || 0) * 60) + Number(timeForm.minutes || 0);
    if (!mins || mins < 1) { notify('Enter the hours or minutes you spent.', 'error'); return; }
    const ok = await run('time', () => taskApi.logTime(task.id, Math.round(mins), timeForm.date, timeForm.note.trim() || null), 'Time logged.');
    if (ok) { setTimeForm({ hours: '', minutes: '', date: today(), note: '' }); setTimeOpen(false); }
  }

  async function addSubtask() {
    if (subForm.title.trim().length < 2) { notify('Give the subtask a title.', 'error'); return; }
    const ok = await run('sub', () => taskApi.createSubtask(task.id, subForm.title.trim(), subForm.due, subForm.to || null), 'Subtask added.');
    if (ok) { setSubForm({ title: '', due: subForm.due, to: '' }); setSubOpen(false); }
  }

  const depCandidates = tasks.filter((t) => t.id !== task.id && !t.archivedAt && !isTaskClosed(t) && t.parentTaskId !== task.id
    && !(extras?.waitsOn ?? []).some((d) => d.depends_on_id === t.id));
  const nameOf = (empId?: string | null) => (empId ? byId.get(empId)?.name ?? 'Employee' : 'Admin');
  const authorOf = (c: TaskComment) => (c.author_id ? byProfile.get(c.author_id)?.name ?? (c.author_id ? 'Admin' : '—') : 'Someone');
  const canEditSubtasks = !closed && task.status !== 'awaiting_review' && !task.parentTaskId && (isAssignee || isReviewer);

  return (
    <Modal title={task.title} onClose={onClose} wide closeDisabled={Boolean(busy)}>
      <div className="space-y-5 -mt-1">
        {/* header strip */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone} dot>{meta.label}</Badge>
          <Badge tone={task.priority === 'urgent' || task.priority === 'high' ? 'rose' : task.priority === 'medium' ? 'amber' : 'ink'}><span className="capitalize">{task.priority}</span></Badge>
          {overdue && <Badge tone="rose">Overdue</Badge>}
          {task.archivedAt && <Badge tone="ink">Removed</Badge>}
          {parent && <span className="inline-flex items-center gap-1 text-[12px] text-ink-500"><CornerDownRight className="w-3.5 h-3.5" />Subtask of <b className="text-ink-700">{parent.title}</b></span>}
        </div>

        {task.statusNote && ['blocked', 'revision_required', 'cancelled', 'awaiting_review'].includes(task.status) && (
          <div className={cx('rounded-2xl px-4 py-3 text-[13px]', task.status === 'awaiting_review' ? 'bg-amber-50 text-amber-900' : task.status === 'cancelled' ? 'bg-ink-50 text-ink-700' : 'bg-rose-50 text-rose-900')}>
            <b>{task.status === 'blocked' ? 'Blocked: ' : task.status === 'revision_required' ? 'Changes requested: ' : task.status === 'cancelled' ? 'Cancelled: ' : 'Note from assignee: '}</b>{task.statusNote}
          </div>
        )}

        {/* facts */}
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ['Assigned to', task.assignedToName],
            ['Assigned by', task.assignedByName || 'Admin'],
            ['Dates', `${dateLabel(task.startDate)} → ${dateLabel(task.dueDate)}`],
            ['Time spent', fmtMinutes(task.timeSpentMinutes)],
          ].map(([k, v]) => (
            <div key={k} className="inset-tile px-3.5 py-3 min-w-0"><dt className="text-[11px] font-semibold text-ink-500">{k}</dt><dd className="text-[13px] font-bold text-ink-900 truncate mt-0.5">{v}</dd></div>
          ))}
        </dl>
        {task.deliverableId && <p className="text-[13px] text-ink-600">Client deliverable: <b className="text-brand-700">{deliverableName?.(task.deliverableId) ?? 'Linked deliverable'}</b></p>}
        {task.description && <p className="text-[14px] text-ink-700 whitespace-pre-wrap leading-relaxed">{task.description}</p>}

        {/* progress */}
        <section>
          <div className="flex items-center justify-between text-[13px] mb-2"><span className="font-semibold text-ink-700">Progress</span><span className="tnum font-bold text-ink-900">{Math.round(isAssignee && !closed ? progress : task.progressPct ?? 0)}%</span></div>
          {isAssignee && ['accepted', 'in_progress', 'blocked', 'revision_required'].includes(task.status) ? (
            <div className="flex items-center gap-3">
              <input type="range" min={0} max={99} step={5} value={Math.min(99, progress)} onChange={(e) => setProgress(Number(e.target.value))} className="flex-1 accent-[var(--brand)]" aria-label="Progress" />
              <button type="button" className="btn-secondary btn-sm" disabled={busy === 'progress' || progress === (task.progressPct ?? 0)} onClick={() => void run('progress', () => taskApi.setProgress(task.id, Math.min(99, progress)), 'Progress saved.')}>Save</button>
            </div>
          ) : <Progress value={task.progressPct ?? 0} tone={task.status === 'completed' ? 'mint' : task.status === 'blocked' ? 'rose' : 'brand'} />}
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
              <label className="block"><span className="label">Work link {extras?.files.length ? <span className="font-normal text-ink-400">optional — files are attached</span> : null}</span>
                <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/…" className="input" autoFocus />
              </label>
            )}
            {prompt.link && (
              <p className="text-[12px] text-ink-500">Add a link or attach files below. {subtasks.some((s) => !isTaskClosed(s)) ? <b className="text-rose-600">Finish the open subtasks first.</b> : null}</p>
            )}
            {prompt.noteLabel && (
              <label className="block"><span className="label">{prompt.noteLabel}</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} className="input min-h-20" autoFocus={!prompt.link} maxLength={2000} />
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => { setPrompt(null); setNote(''); }} disabled={Boolean(busy)}>Back</button>
              <button type="button" disabled={Boolean(busy) || (prompt.noteRequired && !note.trim())}
                className={cx(prompt.danger ? 'btn-danger' : 'btn-primary', 'disabled:opacity-50')}
                onClick={() => void go(prompt.to, `${TASK_STATUS[prompt.to].label}.`, note.trim() || null, prompt.link ? (link.trim() || null) : null)}>
                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}{prompt.confirm}
              </button>
            </div>
          </div>
        )}

        {loadError && <p className="text-[13px] text-rose-600">{loadError} <button className="underline font-semibold" onClick={() => void reload()}>Retry</button></p>}

        {/* work handed in */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-[13px] font-bold text-ink-800"><Paperclip className="w-4 h-4 text-ink-400" />Work & files</h4>
            {(isAssignee || isReviewer) && !task.archivedAt && task.status !== 'cancelled' && (
              <>
                <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" onChange={(e) => void uploadFiles(e.target.files)} />
                <button type="button" className="btn-ghost btn-sm" disabled={busy === 'upload'} onClick={() => fileRef.current?.click()}>{busy === 'upload' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}Attach</button>
              </>
            )}
          </div>
          {task.submittedLink && (
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
          {!task.submittedLink && !(extras?.files.length) && <p className="text-[13px] text-ink-400">Nothing handed in yet.</p>}
        </section>

        {/* subtasks */}
        {!task.parentTaskId && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-[13px] font-bold text-ink-800"><ListChecks className="w-4 h-4 text-ink-400" />Subtasks {subtasks.length ? <span className="text-ink-400 font-semibold">{subtasks.filter((s) => s.status === 'completed').length}/{subtasks.length}</span> : null}</h4>
              {canEditSubtasks && !subOpen && <button type="button" className="btn-ghost btn-sm" onClick={() => setSubOpen(true)}><Plus className="w-3.5 h-3.5" />Add</button>}
            </div>
            {subtasks.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-xl border border-ink-200 px-3 py-2.5">
                <span className={cx('w-2 h-2 rounded-full shrink-0', s.status === 'completed' ? 'bg-mint-500' : s.status === 'cancelled' ? 'bg-ink-300' : s.status === 'blocked' ? 'bg-rose-500' : 'bg-brand-500')} />
                <span className={cx('text-[13px] font-semibold flex-1 truncate', s.status === 'completed' ? 'text-ink-400 line-through' : 'text-ink-800')}>{s.title}</span>
                <span className="text-[11px] text-ink-500 hidden sm:inline">{s.assignedToName} · {dateLabel(s.dueDate)}</span>
                <Badge tone={TASK_STATUS[s.status]?.tone ?? 'ink'}>{TASK_STATUS[s.status]?.label ?? s.status}</Badge>
              </div>
            ))}
            {!subtasks.length && !subOpen && <p className="text-[13px] text-ink-400">Break the work into smaller steps if it helps.</p>}
            {subOpen && (
              <div className="rounded-2xl border border-ink-200 p-3 grid sm:grid-cols-[1fr_150px] gap-2 anim-fade">
                <input value={subForm.title} onChange={(e) => setSubForm({ ...subForm, title: e.target.value })} placeholder="Subtask title" className="input" autoFocus maxLength={200} />
                <input type="date" value={subForm.due} min={today() < task.startDate ? today() : task.startDate} max={task.dueDate} onChange={(e) => setSubForm({ ...subForm, due: e.target.value })} className="input" aria-label="Due date" />
                {isReviewer && subtaskTargets.length > 0 && (
                  <select value={subForm.to} onChange={(e) => setSubForm({ ...subForm, to: e.target.value })} className="input sm:col-span-2" aria-label="Assign subtask to">
                    <option value="">{task.assignedToName} (same person)</option>
                    {subtaskTargets.filter((e) => e.id !== task.assignedTo).map((e) => <option key={e.id} value={e.id}>{e.name} · {e.designation}</option>)}
                  </select>
                )}
                <div className="sm:col-span-2 flex justify-end gap-2">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setSubOpen(false)}>Cancel</button>
                  <button type="button" className="btn-primary btn-sm" disabled={busy === 'sub'} onClick={() => void addSubtask()}>{busy === 'sub' ? 'Adding…' : 'Add subtask'}</button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* dependencies */}
        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-[13px] font-bold text-ink-800"><Clock3 className="w-4 h-4 text-ink-400" />Waits on</h4>
          {(extras?.waitsOn ?? []).map((d: TaskDependency) => {
            const b = taskById.get(d.depends_on_id);
            return (
              <div key={d.depends_on_id} className="flex items-center gap-3 rounded-xl border border-ink-200 px-3 py-2.5">
                <span className="text-[13px] font-semibold text-ink-800 flex-1 truncate">{b?.title ?? 'Another task'}</span>
                {b && <Badge tone={TASK_STATUS[b.status]?.tone ?? 'ink'}>{TASK_STATUS[b.status]?.label ?? b.status}</Badge>}
                {isReviewer && !closed && <button type="button" className="icon-btn" title="Remove" aria-label="Remove dependency" onClick={() => void run('dep', () => taskApi.setDependency(task.id, d.depends_on_id, false), 'Removed.')}><X className="w-4 h-4" /></button>}
              </div>
            );
          })}
          {!(extras?.waitsOn.length) && <p className="text-[13px] text-ink-400">Doesn’t wait on other tasks.</p>}
          {(extras?.blocks.length ?? 0) > 0 && <p className="text-[12px] text-ink-500">{extras!.blocks.length} other task{extras!.blocks.length === 1 ? '' : 's'} wait{extras!.blocks.length === 1 ? 's' : ''} on this one.</p>}
          {isReviewer && !closed && depCandidates.length > 0 && (
            <div className="flex gap-2">
              <select value={depPick} onChange={(e) => setDepPick(e.target.value)} className="input" aria-label="Task to wait on">
                <option value="">Add a task this one waits on…</option>
                {depCandidates.slice(0, 200).map((t) => <option key={t.id} value={t.id}>{t.title} · {t.assignedToName}</option>)}
              </select>
              <button type="button" className="btn-secondary" disabled={!depPick || busy === 'dep'} onClick={() => void run('dep', () => taskApi.setDependency(task.id, depPick, true), 'Dependency added.').then(() => setDepPick(''))}>Add</button>
            </div>
          )}
        </section>

        {/* time */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-[13px] font-bold text-ink-800"><Timer className="w-4 h-4 text-ink-400" />Time <span className="text-ink-500 font-semibold">{fmtMinutes(task.timeSpentMinutes)}</span></h4>
            {isAssignee && task.status !== 'cancelled' && !task.archivedAt && !timeOpen && <button type="button" className="btn-ghost btn-sm" onClick={() => setTimeOpen(true)}><Plus className="w-3.5 h-3.5" />Log time</button>}
          </div>
          {timeOpen && (
            <div className="rounded-2xl border border-ink-200 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 anim-fade">
              <input type="number" min={0} max={16} value={timeForm.hours} onChange={(e) => setTimeForm({ ...timeForm, hours: e.target.value })} placeholder="Hours" className="input" aria-label="Hours" />
              <input type="number" min={0} max={59} step={5} value={timeForm.minutes} onChange={(e) => setTimeForm({ ...timeForm, minutes: e.target.value })} placeholder="Minutes" className="input" aria-label="Minutes" />
              <input type="date" value={timeForm.date} max={today()} onChange={(e) => setTimeForm({ ...timeForm, date: e.target.value })} className="input col-span-2" aria-label="Date" />
              <input value={timeForm.note} onChange={(e) => setTimeForm({ ...timeForm, note: e.target.value })} placeholder="What did you work on? (optional)" maxLength={500} className="input col-span-2 sm:col-span-4" />
              <div className="col-span-2 sm:col-span-4 flex justify-end gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setTimeOpen(false)}>Cancel</button>
                <button type="button" className="btn-primary btn-sm" disabled={busy === 'time'} onClick={() => void logTime()}>{busy === 'time' ? 'Saving…' : 'Log time'}</button>
              </div>
            </div>
          )}
          {(extras?.timeLogs ?? []).slice(0, 6).map((l: TaskTimeLog) => (
            <div key={l.id} className="flex items-center gap-3 text-[13px]"><span className="tnum font-bold text-ink-900 w-16">{fmtMinutes(l.minutes)}</span><span className="text-ink-500 w-20">{dateLabel(l.work_date)}</span><span className="text-ink-600 truncate">{l.note ?? ''}</span></div>
          ))}
        </section>

        {/* discussion */}
        <section className="space-y-3">
          <h4 className="flex items-center gap-2 text-[13px] font-bold text-ink-800"><MessageSquare className="w-4 h-4 text-ink-400" />Discussion</h4>
          {(extras?.comments ?? []).map((c: TaskComment) => (
            <div key={c.id} className="flex gap-3">
              <Avatar name={authorOf(c)} size={30} tone={c.author_id && byProfile.get(c.author_id)?.id === task.assignedTo ? 'mint' : 'brand'} />
              <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-ink-50 px-3.5 py-2.5">
                <p className="text-[12px]"><b className="text-ink-900">{authorOf(c)}</b> <span className="text-ink-400">{when(c.created_at)}</span></p>
                <p className="text-[13px] text-ink-800 whitespace-pre-wrap mt-0.5">{c.body}</p>
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
                  <p className="text-[13px] text-ink-700"><b className="text-ink-900">{ev.actor_employee_id ? nameOf(ev.actor_employee_id) : 'Admin'}</b> {EVENT_TEXT[ev.event_type] ?? ev.event_type.replace(/_/g, ' ')}{ev.metadata?.note ? <span className="text-ink-500"> — “{ev.metadata.note}”</span> : null}</p>
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
