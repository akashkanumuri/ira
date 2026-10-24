import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, Bell, BriefcaseBusiness, Coffee, MessageCircleQuestion, Pause, Play, RefreshCw, Users } from 'lucide-react';
import type { Task } from '../../types/attendance';
import { Modal } from '../../ui/Modal';
import { Badge, cx } from '../../ui';
import { notify } from '../../lib/toast';
import { dateLabel } from '../../lib/v2';
import { getKolkataDateString } from '../../lib/workingDays';
import { fetchAttendanceRecord, performResumeWork, performStartBreak } from '../../lib/attendance';
import { MEETING_TYPES, MOODS, WORK_NOT_READY, clockOf, hm, meetingLabel, ticker, workApi, type MeetingType, type Mood, type PendingCheck, type WorkState } from '../../lib/work';

/* ------------------------------------------------------------------ context */

type PickerMode = null | { kind: 'day' | 'next' | 'away' | 'switch'; awayFrom?: string; awayTo?: string; doneTaskId?: string; resumeId?: string };

interface WorkCtx {
  enabled: boolean;
  ready: boolean;
  state: WorkState | null;
  now: number;
  canStart: boolean;
  notifyPermission: NotificationPermission | 'unsupported';
  requestNotifications: () => Promise<void>;
  busy: string | null;
  startingId: string | null;
  tasksReady: boolean;
  startTask: (taskId: string) => Promise<boolean>;
  pause: () => Promise<void>;
  startMeeting: (type: MeetingType, note?: string | null) => Promise<boolean>;
  startBreak: () => Promise<void>;
  endBreak: () => Promise<void>;
  openPicker: (mode: PickerMode) => void;
  openMeeting: () => void;
  openCheck: () => void;
  refresh: () => Promise<void>;
  /** Call right after a draft is submitted: shows “Up next”. */
  draftSubmitted: (taskId: string) => void;
  beforeLogout: () => Promise<void>;
}

const Ctx = createContext<WorkCtx | null>(null);
export const useWork = () => useContext(Ctx);

const HEARTBEAT_MS = 2 * 60 * 1000;
const permissionNow = (): NotificationPermission | 'unsupported' => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported');
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** Order for “what should I work on”: paused/in-progress, overdue, due today, then priority and due date. */
export function rankTasks(list: Task[], lastTaskId?: string | null) {
  const today = getKolkataDateString();
  const bucket = (t: Task) => (t.id === lastTaskId ? 0 : t.status === 'in_progress' || t.status === 'revision_required' ? 1 : t.dueDate < today ? 2 : t.dueDate === today ? 3 : 4);
  return [...list].sort((a, b) => bucket(a) - bucket(b) || (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
}
export function taskReason(t: Task, lastTaskId?: string | null) {
  const today = getKolkataDateString();
  if (t.id === lastTaskId) return { text: 'Paused', tone: 'brand' as const };
  if (t.status === 'revision_required') return { text: 'Changes requested', tone: 'rose' as const };
  if (t.status === 'in_progress') return { text: 'In progress', tone: 'brand' as const };
  if (t.dueDate < today) return { text: 'Overdue', tone: 'rose' as const };
  if (t.dueDate === today) return { text: 'Due today', tone: 'amber' as const };
  return { text: `Due ${dateLabel(t.dueDate)}`, tone: 'ink' as const };
}

export function WorkProvider({ employeeId, tasks, tasksReady = true, attendanceKey, onAttendanceChanged, onOpenTask, children }: {
  employeeId: string | null;
  tasks: Task[];
  /** False while the task list is still loading. */
  tasksReady?: boolean;
  /** Changes whenever today’s attendance changes (check-in, break, check-out). */
  attendanceKey: string;
  onAttendanceChanged: () => Promise<void> | void;
  onOpenTask?: (taskId: string) => void;
  children: React.ReactNode;
}) {
  const enabled = Boolean(employeeId);
  const [state, setState] = useState<WorkState | null>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [perm, setPerm] = useState(permissionNow);
  const [picker, setPicker] = useState<PickerMode>(null);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState<string | null>(null);
  const prevRef = useRef<WorkState | null>(null);
  const localRef = useRef(false);
  const seenChecks = useRef<Set<string>>(new Set());
  const myTasks = useMemo(() => tasks.filter((t) => t.assignedTo === employeeId && !t.archivedAt && !['completed', 'cancelled', 'awaiting_review'].includes(t.status)), [tasks, employeeId]);

  const apply = useCallback((next: WorkState, local: boolean) => {
    const prev = prevRef.current;
    prevRef.current = next;
    setState(next);
    setReady(true);
    // A running task was closed by the server (missed check / offline): ask what now.
    if (!local && prev?.current && !next.current && next.checked_in && !next.checked_out && next.attendance_state === 'working') {
      setPicker({ kind: 'away', awayFrom: next.idle_since ?? undefined, awayTo: next.now });
    }
    // First time today after check-in.
    if (next.checked_in && !next.checked_out && next.first_of_day && next.attendance_state === 'working') {
      const key = `ira-startday-${getKolkataDateString()}`;
      try { if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); setPicker((p) => p ?? { kind: 'day' }); } } catch { /* storage blocked */ }
    }
    // New questions → system notification once.
    for (const p of next.pending) {
      if (seenChecks.current.has(p.id)) continue;
      seenChecks.current.add(p.id);
      void showSystemNotification(p);
      setCheckOpen((c) => c ?? p.id);
    }
    if (!next.pending.length) setCheckOpen(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || unavailable) return;
    try { apply(await workApi.heartbeat(), localRef.current); }
    catch (e) { if (e instanceof Error && e.message === WORK_NOT_READY) setUnavailable(true); }
    finally { localRef.current = false; }
  }, [enabled, unavailable, apply]);

  // Heartbeat: every 2 minutes, on focus, when the tab becomes visible, and when attendance changes.
  useEffect(() => {
    if (!enabled) return undefined;
    void refresh();
    const id = window.setInterval(() => void refresh(), HEARTBEAT_MS);
    const onVis = () => { if (document.visibilityState === 'visible') { setPerm(permissionNow()); void refresh(); } };
    const onAtt = () => { localRef.current = true; void refresh(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    window.addEventListener('ira:attendance', onAtt);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); window.removeEventListener('ira:attendance', onAtt); };
  }, [enabled, refresh]);
  useEffect(() => { if (enabled) { localRef.current = true; void refresh(); } }, [attendanceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 1-second clock while something is running or a check is pending.
  const ticking = Boolean(state?.current || state?.pending.length || (state?.checked_in && !state?.checked_out));
  useEffect(() => {
    if (!ticking) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  // When a presence check is about to expire, refresh right after so the screen shows the truth.
  useEffect(() => {
    const exp = state?.pending.find((p) => p.expires_at)?.expires_at;
    if (!exp) return undefined;
    const ms = Date.parse(exp) - Date.now() + 1500;
    const id = window.setTimeout(() => void refresh(), Math.max(1000, ms));
    return () => window.clearTimeout(id);
  }, [state?.pending, refresh]);

  // Tab title: live timer while working; flashes while a question waits.
  const baseTitle = useRef<string>('');
  useEffect(() => {
    if (!baseTitle.current) baseTitle.current = document.title.replace(/^(▶|⏰|☕|●)[^|]*\|\s*/, '');
    const base = baseTitle.current || 'IRA';
    if (state?.pending.length) {
      const flip = Math.floor(now / 1000) % 2 === 0;
      document.title = flip ? `⏰ Progress check waiting | ${base}` : base;
    } else if (state?.current) {
      const sec = (now - Date.parse(state.current.started_at)) / 1000;
      document.title = `${state.current.kind === 'task' ? '▶' : '●'} ${ticker(sec)} ${state.current.kind === 'task' ? (state.current.title ?? '') : meetingLabel(state.current.meeting_type)} | ${base}`;
    } else if (state?.attendance_state === 'on_break') {
      document.title = `☕ On break | ${base}`;
    } else document.title = base;
  }, [state, now]);
  useEffect(() => () => { if (baseTitle.current) document.title = baseTitle.current; }, []);

  async function act(key: string, fn: () => Promise<WorkState | void>, ok?: string) {
    if (busy) return false;
    setBusy(key);
    try {
      const s = await fn();
      localRef.current = true;
      if (s) apply(s, true); else await refresh();
      if (ok) notify(ok, 'success');
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Something went wrong.', 'error', 6000);
      return false;
    } finally { setBusy(null); }
  }

  const canStart = perm === 'granted' || perm === 'unsupported';
  const requestNotifications = useCallback(async () => {
    if (!('Notification' in window)) { setPerm('unsupported'); return; }
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== 'granted') notify('Notifications are blocked. Allow them for this site in your browser settings, then reload.', 'error', 8000);
    } catch { setPerm(permissionNow()); }
  }, []);

  const startTask = useCallback(async (taskId: string) => {
    if (!canStart) { notify('Allow notifications first — progress checks arrive as notifications.', 'error', 6000); return false; }
    setStartingId(taskId);
    const ok = await act('start', () => workApi.startTask(taskId));
    setStartingId(null);
    if (ok) setPicker(null);
    return ok;
  }, [canStart, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const pause = useCallback(async () => { await act('pause', () => workApi.pause('pause')); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const startMeeting = useCallback(async (type: MeetingType, note?: string | null) => {
    const ok = await act('meeting', () => workApi.startMeeting(type, note));
    if (ok) { setMeetingOpen(false); setPicker(null); }
    return ok;
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const startBreak = useCallback(async () => {
    if (!employeeId) return;
    const ok = await act('break', async () => {
      const rec = await fetchAttendanceRecord(employeeId);
      if (!rec) throw new Error('Check in first.');
      const r = await performStartBreak(rec);
      if (!r.success) throw new Error(r.error || 'Unable to start break.');
      await onAttendanceChanged();
    }, 'Break started. Enjoy!');
    if (ok) { setPicker(null); setMeetingOpen(false); }
  }, [employeeId, busy, onAttendanceChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  const endBreak = useCallback(async () => {
    if (!employeeId) return;
    const resume = prevRef.current?.last_task;
    const ok = await act('break', async () => {
      const rec = await fetchAttendanceRecord(employeeId);
      if (!rec) throw new Error('Attendance not found.');
      const r = await performResumeWork(rec);
      if (!r.success) throw new Error(r.error || 'Unable to end break.');
      await onAttendanceChanged();
    });
    if (ok) setPicker({ kind: 'next', resumeId: resume?.id });
  }, [employeeId, busy, onAttendanceChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  const value: WorkCtx = {
    enabled: enabled && !unavailable, ready, state, now, canStart, notifyPermission: perm, requestNotifications, busy, startingId, tasksReady,
    startTask, pause, startMeeting, startBreak, endBreak,
    openPicker: setPicker, openMeeting: () => setMeetingOpen(true), openCheck: () => setCheckOpen(state?.pending[0]?.id ?? null), refresh,
    draftSubmitted: (taskId) => { localRef.current = true; void refresh(); setPicker({ kind: 'next', doneTaskId: taskId }); },
    beforeLogout: async () => { if (prevRef.current?.current) { try { await workApi.pause('logout'); } catch { /* signing out anyway */ } } },
  };

  const pending = state?.pending ?? [];
  const activeCheck = pending.find((p) => p.id === checkOpen) ?? null;

  return (
    <Ctx.Provider value={value}>
      {children}
      {value.enabled && picker && state && (
        <TaskPicker mode={picker} state={state} tasks={myTasks} ctx={value} onOpenTask={onOpenTask} onClose={() => setPicker(null)} />
      )}
      {value.enabled && meetingOpen && <MeetingPicker ctx={value} onClose={() => setMeetingOpen(false)} />}
      {value.enabled && activeCheck && (
        <CheckDialog check={activeCheck} now={now} busy={busy === 'answer'}
          onLater={() => setCheckOpen(null)}
          onAnswer={(mood, progress, text) => void act('answer', () => workApi.answer(activeCheck.id, mood, progress, text), mood === 'stuck' ? 'Your manager has been told you’re stuck.' : 'Thanks — progress updated.')
            .then((ok) => { if (ok) setCheckOpen(null); })} />
      )}
    </Ctx.Provider>
  );
}

async function showSystemNotification(p: PendingCheck) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const title = p.from_manager ? `${p.asked_by_name ?? 'Your manager'} asks` : 'Progress check';
  const body = p.from_manager ? `${p.question}${p.task_title ? ` — ${p.task_title}` : ''}` : `${p.question} Answer within 5 minutes.`;
  const opts: NotificationOptions = { body, tag: `ira-check-${p.id}`, requireInteraction: true, data: { url: '/emp-tasks' }, icon: '/icon-192.png' } as NotificationOptions;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, opts); return; }
  } catch { /* fall back below */ }
  try { const n = new Notification(title, opts); n.onclick = () => { window.focus(); n.close(); }; } catch { /* not allowed here */ }
}

/* ------------------------------------------------------------------ work bar */

/** The always-visible strip at the top of the page while checked in. */
export function WorkBar() {
  const w = useWork();
  if (!w?.enabled || !w.state) return null;
  const s = w.state;
  if (!s.checked_in || s.checked_out) return null;
  const nowMs = w.now;

  const notifGate = !w.canStart && (
    <button type="button" className="btn-secondary btn-sm !bg-white" onClick={() => void w.requestNotifications()}><Bell className="w-3.5 h-3.5" />Allow notifications</button>
  );

  let tone = 'bg-white border-ink-200 text-ink-800';
  let icon: React.ReactNode = <BriefcaseBusiness className="w-4 h-4" />;
  let main: React.ReactNode;
  let actions: React.ReactNode;

  if (s.attendance_state === 'on_break') {
    const over = s.break_used_minutes > s.break_allow_minutes;
    tone = over ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-amber-50 border-amber-200 text-amber-900';
    icon = <Coffee className="w-4 h-4" />;
    main = <><b>On break</b><span className="opacity-80"> · {hm(s.break_used_minutes)} of {hm(s.break_allow_minutes)} used today{over ? ' — extra counts as away' : s.break_used_minutes >= s.break_allow_minutes - 5 ? ' — almost used up' : ''}</span></>;
    actions = <button type="button" className="btn-primary btn-sm" disabled={w.busy === 'break'} onClick={() => void w.endBreak()}><Play className="w-3.5 h-3.5" />Back to work</button>;
  } else if (s.current?.kind === 'task') {
    tone = 'bg-brand-50 border-brand-200 text-brand-900';
    icon = <span className="relative flex w-2.5 h-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-60 animate-ping" /><span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-brand-600" /></span>;
    main = <><span className="opacity-80 mr-1">Working on</span><b className="truncate">{s.current.title}</b><span className="tnum font-bold ml-2">{ticker((nowMs - Date.parse(s.current.started_at)) / 1000)}</span></>;
    actions = <>
      <button type="button" className="btn-secondary btn-sm !bg-white" disabled={Boolean(w.busy)} onClick={() => void w.pause()}><Pause className="w-3.5 h-3.5" />Pause</button>
      <button type="button" className="btn-ghost btn-sm" disabled={Boolean(w.busy)} onClick={() => w.openMeeting()}><Users className="w-3.5 h-3.5" /><span className="hidden sm:inline">Meeting</span></button>
      <button type="button" className="btn-ghost btn-sm" disabled={Boolean(w.busy)} onClick={() => void w.startBreak()}><Coffee className="w-3.5 h-3.5" /><span className="hidden sm:inline">Break</span></button>
      <button type="button" className="btn-ghost btn-sm hidden sm:inline-flex" disabled={Boolean(w.busy)} onClick={() => w.openPicker({ kind: 'switch' })}>Switch task</button>
    </>;
  } else if (s.current?.kind === 'meeting') {
    tone = 'bg-sky-50 border-sky-200 text-sky-900';
    icon = <Users className="w-4 h-4" />;
    main = <><b>{meetingLabel(s.current.meeting_type)}</b>{s.current.note ? <span className="opacity-80 truncate"> · {s.current.note}</span> : null}<span className="tnum font-bold ml-2">{ticker((nowMs - Date.parse(s.current.started_at)) / 1000)}</span></>;
    actions = <button type="button" className="btn-primary btn-sm" disabled={Boolean(w.busy)} onClick={() => w.openPicker({ kind: 'next' })}><Play className="w-3.5 h-3.5" />Back to work</button>;
  } else {
    const idle = s.idle_since ?? s.check_in_at;
    const bufferEnd = s.first_of_day && s.check_in_at ? Date.parse(s.check_in_at) + s.buffer_minutes * 60000 : 0;
    const inBuffer = bufferEnd > nowMs;
    if (inBuffer) {
      main = <><b>Getting started</b><span className="opacity-70"> · start a task within {Math.max(1, Math.ceil((bufferEnd - nowMs) / 60000))} min</span></>;
    } else {
      tone = 'bg-rose-50 border-rose-200 text-rose-900';
      icon = <AlarmClock className="w-4 h-4" />;
      main = <><b>No task running</b><span className="opacity-80"> · Away since {clockOf(idle)}</span></>;
    }
    actions = <>
      <button type="button" className="btn-primary btn-sm" disabled={Boolean(w.busy) || !w.canStart} onClick={() => w.openPicker({ kind: s.first_of_day ? 'day' : 'switch' })}><Play className="w-3.5 h-3.5" />Start a task</button>
      <button type="button" className="btn-ghost btn-sm" disabled={Boolean(w.busy)} onClick={() => w.openMeeting()}><Users className="w-3.5 h-3.5" /><span className="hidden sm:inline">Meeting</span></button>
      <button type="button" className="btn-ghost btn-sm" disabled={Boolean(w.busy)} onClick={() => void w.startBreak()}><Coffee className="w-3.5 h-3.5" /><span className="hidden sm:inline">Break</span></button>
    </>;
  }

  const checkBtn = s.pending.length > 0 && (
    <button type="button" className="btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700" onClick={() => w.openCheck()}><MessageCircleQuestion className="w-3.5 h-3.5" />Answer check</button>
  );

  return (
    <div role="status" aria-live="polite" className={cx('rounded-2xl border px-3 sm:px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] anim-fade', tone)}>
      <span className="shrink-0 flex items-center justify-center w-5">{icon}</span>
      <p className="flex-1 min-w-0 flex items-center whitespace-nowrap overflow-hidden">{main}</p>
      <div className="flex items-center gap-1.5 shrink-0 ml-auto">{checkBtn}{notifGate}{actions}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ pickers */

function TaskPicker({ mode, state, tasks, ctx, onOpenTask, onClose }: { mode: NonNullable<PickerMode>; state: WorkState; tasks: Task[]; ctx: WorkCtx; onOpenTask?: (id: string) => void; onClose: () => void }) {
  const lastId = mode.resumeId ?? state.last_task?.id ?? null;
  const list = rankTasks(tasks.filter((t) => t.id !== mode.doneTaskId && t.id !== state.current?.task_id), lastId);
  const suggested = list[0];
  const title = mode.kind === 'day' ? 'Start your day' : mode.kind === 'next' ? (mode.doneTaskId ? 'Draft submitted · Up next' : 'Back to work') : mode.kind === 'away' ? 'Your timer stopped' : 'Pick a task';
  const onBreak = state.attendance_state === 'on_break';
  return (
    <Modal title={title} onClose={onClose} closeDisabled={Boolean(ctx.busy)}>
      <div className="space-y-4 -mt-1">
        {mode.kind === 'away' && (
          <div className="rounded-2xl bg-rose-50 text-rose-900 px-4 py-3 text-[13px]">
            You were away from <b className="tnum">{clockOf(mode.awayFrom)}</b> to <b className="tnum">{clockOf(mode.awayTo)}</b> (a progress check went unanswered or the app lost connection). That time counts as away. What now?
          </div>
        )}
        {mode.kind === 'day' && <p className="text-[13px] text-ink-600">Pick what you’ll work on first. Time is tracked from when you press <b>Start</b>. After {state.buffer_minutes} minutes with nothing running, the time counts as away.</p>}
        {mode.kind === 'next' && mode.doneTaskId && <p className="text-[13px] text-ink-600">Nice — the timer stopped. Pick the next task to keep your time counted.</p>}
        {!ctx.canStart && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-[200px]">Allow notifications so progress checks reach you even when this tab is in the background.</span>
            <button type="button" className="btn-primary btn-sm" onClick={() => void ctx.requestNotifications()}><Bell className="w-3.5 h-3.5" />Allow</button>
          </div>
        )}
        {!ctx.tasksReady && !list.length ? (
          <p className="rounded-2xl bg-ink-50 px-4 py-6 text-center text-[13px] text-ink-500 flex items-center justify-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" />Loading your tasks…</p>
        ) : list.length ? (
          <ul className="space-y-2 max-h-[min(52vh,420px)] overflow-y-auto -mx-1 px-1">
            {list.slice(0, 12).map((t) => {
              const r = taskReason(t, lastId);
              const isNext = t.id === suggested?.id;
              return (
                <li key={t.id} className={cx('rounded-2xl border px-3.5 py-3 flex items-center gap-3', isNext ? 'border-brand-300 bg-brand-50/50' : 'border-ink-200')}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { onOpenTask?.(t.id); onClose(); }}>
                    <span className="flex items-center gap-2 flex-wrap">
                      {isNext && <span className="text-[10px] font-bold uppercase tracking-wide text-brand-700">Suggested</span>}
                      <Badge tone={r.tone}>{r.text}</Badge>
                      <span className="text-[11px] text-ink-500 capitalize">{t.priority}</span>
                    </span>
                    <span className="block font-semibold text-[14px] text-ink-900 truncate mt-1">{t.title}</span>
                  </button>
                  <button type="button" className={cx(isNext ? 'btn-primary' : 'btn-secondary', 'btn-sm shrink-0')} disabled={Boolean(ctx.busy) || !ctx.canStart || onBreak} onClick={() => void ctx.startTask(t.id)}>
                    {ctx.startingId === t.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}Start
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="rounded-2xl bg-ink-50 px-4 py-6 text-center text-[13px] text-ink-500">No open tasks. Ask your manager for work, or log a meeting if you’re in one.</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-ink-100">
          <button type="button" className="btn-secondary btn-sm mt-3" disabled={Boolean(ctx.busy)} onClick={() => ctx.openMeeting()}><Users className="w-3.5 h-3.5" />Meeting</button>
          {!onBreak && <button type="button" className="btn-secondary btn-sm mt-3" disabled={Boolean(ctx.busy)} onClick={() => void ctx.startBreak()}><Coffee className="w-3.5 h-3.5" />Break</button>}
          <button type="button" className="btn-ghost btn-sm mt-3 ml-auto" onClick={onClose}>Later</button>
        </div>
        {!state.current && <p className="text-[11px] text-ink-400 -mt-2">“Later” closes this, but until a task, meeting or break is running the time counts as away.</p>}
      </div>
    </Modal>
  );
}

function MeetingPicker({ ctx, onClose }: { ctx: WorkCtx; onClose: () => void }) {
  const [type, setType] = useState<MeetingType>('team_brief');
  const [note, setNote] = useState('');
  return (
    <Modal title="Start a meeting" onClose={onClose} closeDisabled={ctx.busy === 'meeting'}>
      <div className="space-y-4 -mt-1">
        <p className="text-[13px] text-ink-600">Your task timer pauses while you’re in the meeting. Meeting time counts as effective time. Tap <b>Back to work</b> when it ends.</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Meeting type">
          {MEETING_TYPES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={type === m.id} onClick={() => setType(m.id)}
              className={cx('rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors', type === m.id ? 'border-sky-400 bg-sky-50 text-sky-800' : 'border-ink-200 text-ink-700 hover:bg-ink-50')}>{m.label}</button>
          ))}
        </div>
        <label className="block"><span className="label">What’s it about? {type === 'other' ? '' : <span className="font-normal text-ink-400">(optional)</span>}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="input" placeholder="e.g. Spring campaign kickoff" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={ctx.busy === 'meeting'}>Cancel</button>
          <button type="button" className="btn-primary" disabled={ctx.busy === 'meeting' || (type === 'other' && note.trim().length < 3)} onClick={() => void ctx.startMeeting(type, note.trim() || null)}>
            {ctx.busy === 'meeting' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}Start meeting
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CheckDialog({ check, now, busy, onAnswer, onLater }: { check: PendingCheck; now: number; busy: boolean; onAnswer: (m: Mood, progress: number | null, text: string | null) => void; onLater: () => void }) {
  const [mood, setMood] = useState<Mood | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [text, setText] = useState('');
  const left = check.expires_at ? Math.max(0, Math.floor((Date.parse(check.expires_at) - now) / 1000)) : null;
  const expired = left === 0;
  const canSend = mood && !(mood === 'stuck' && text.trim().length < 3) && !expired;
  return (
    <Modal title={check.from_manager ? `Question from ${check.asked_by_name ?? 'your manager'}` : 'Progress check'} onClose={onLater} closeDisabled={busy}>
      <div className="space-y-4 -mt-1">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><MessageCircleQuestion className="w-5 h-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[16px] font-bold text-ink-900">{check.question}</p>
            {check.from_manager && check.task_title && <p className="text-[12px] text-ink-500 mt-0.5 truncate">{check.task_title}</p>}
          </div>
          {left != null && <span className={cx('tnum text-[13px] font-bold rounded-full px-2.5 py-1 shrink-0', left < 60 ? 'bg-rose-50 text-rose-700' : 'bg-ink-50 text-ink-700')}>{ticker(left)}</span>}
        </div>
        {expired ? <p className="rounded-2xl bg-rose-50 text-rose-900 px-4 py-3 text-[13px]">Time’s up — this check was missed and the time since it was asked counts as away.</p> : (
          <>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="How is it going">
              {MOODS.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={mood === m.id} onClick={() => setMood(m.id)}
                  className={cx('rounded-2xl border px-2 py-3 text-[13px] font-bold transition-colors',
                    mood === m.id ? (m.tone === 'rose' ? 'border-rose-400 bg-rose-50 text-rose-800' : m.tone === 'mint' ? 'border-mint-400 bg-mint-50 text-mint-800' : 'border-brand-400 bg-brand-50 text-brand-800') : 'border-ink-200 text-ink-700 hover:bg-ink-50')}>
                  {m.label}
                </button>
              ))}
            </div>
            {check.task_id && (
              <label className="block">
                <span className="label flex justify-between"><span>Progress</span><span className="tnum">{progress == null ? 'unchanged' : `${progress}%`}</span></span>
                <input type="range" min={0} max={95} step={5} value={progress ?? 0} onChange={(e) => setProgress(Number(e.target.value))} className="w-full accent-[var(--brand)]" aria-label="Progress percent" />
              </label>
            )}
            <label className="block"><span className="label">{mood === 'stuck' ? 'What are you stuck on?' : 'Note'} {mood !== 'stuck' && <span className="font-normal text-ink-400">(optional)</span>}</span>
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} className="input" placeholder={mood === 'stuck' ? 'e.g. waiting for brand colours from the client' : 'One line on where it stands'} />
            </label>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onLater} disabled={busy}>{expired ? 'Close' : 'Later'}</button>
          {!expired && <button type="button" className="btn-primary" disabled={!canSend || busy} onClick={() => mood && onAnswer(mood, progress, text.trim() || null)}>{busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}Send</button>}
        </div>
        {!check.from_manager && !expired && <p className="text-[11px] text-ink-400 -mt-2">Unanswered checks stop the timer and count as away from when they were asked.</p>}
      </div>
    </Modal>
  );
}

