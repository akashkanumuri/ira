import { supabase } from './supabase';
import { isMissingSchema } from './tasks';

const db = supabase as any;

export type MeetingType = 'team_brief' | 'client_call' | 'internal' | 'training' | 'other';
export const MEETING_TYPES: Array<{ id: MeetingType; label: string }> = [
  { id: 'team_brief', label: 'Team brief' },
  { id: 'client_call', label: 'Client call' },
  { id: 'internal', label: 'Internal discussion' },
  { id: 'training', label: 'Training' },
  { id: 'other', label: 'Other' },
];
export const meetingLabel = (t?: string | null) => MEETING_TYPES.find((m) => m.id === t)?.label ?? 'Meeting';

export type Mood = 'on_track' | 'almost_done' | 'stuck';
export const MOODS: Array<{ id: Mood; label: string; tone: 'mint' | 'brand' | 'rose' }> = [
  { id: 'on_track', label: 'On track', tone: 'mint' },
  { id: 'almost_done', label: 'Almost done', tone: 'brand' },
  { id: 'stuck', label: 'Stuck', tone: 'rose' },
];

export interface PendingCheck {
  id: string; question: string; task_id: string | null; task_title: string | null;
  asked_at: string; expires_at: string | null; from_manager: boolean; asked_by_name: string | null;
}
export interface WorkState {
  now: string;
  checked_in: boolean; checked_out: boolean; attendance_state: 'working' | 'on_break' | 'completed' | null; check_in_at: string | null;
  current: null | { kind: 'task' | 'meeting'; task_id: string | null; title: string | null; meeting_type: MeetingType | null; note: string | null; started_at: string };
  last_task: null | { id: string; title: string; ended_at: string; reason: string | null };
  idle_since: string | null; first_of_day: boolean; buffer_minutes: number;
  break_used_minutes: number; break_allow_minutes: number;
  pending: PendingCheck[];
}

export type SegmentKind = 'task' | 'meeting' | 'break' | 'away' | 'buffer';
export interface Segment { start: string; end: string; kind: SegmentKind; label: string; task_id: string | null; reason: string | null; minutes: number }
export interface WorkDay {
  date: string; check_in: string; check_out: string | null; open: boolean; shift_start: string; shift_end: string;
  late: boolean; left_early: boolean;
  gross_min: number; task_min: number; meeting_min: number; break_min: number; away_min: number; buffer_min: number; overrun_min: number; away_count: number;
  effective_min: number; required_min: number; effective_pct: number | null; productivity_pct: number | null;
  meeting_over_cap: boolean; below_min: boolean; checks_answered: number; checks_missed: number; drafts: number;
  tasks: Array<{ task_id: string; title: string; minutes: number }>;
  segments?: Segment[];
}
export type MonthDay = Partial<WorkDay> & { date: string; kind: 'present' | 'leave' | 'off' | 'absent' | 'today' };
export interface WorkMonth {
  from: string; to: string; working_days: number; present: number; leave: number; absent: number;
  late_days: number; below_min_days: number; overrun_days: number; avg_check_in: string | null;
  effective_min: number; task_min: number; meeting_min: number; break_min: number; away_min: number; gross_min: number; required_min: number;
  avg_effective_min: number | null; effectiveness_pct: number | null; productivity_pct: number | null;
  tasks_due: number; tasks_on_time: number; deadline_pct: number | null;
  first_drafts: number; first_draft_ok: number; quality_pct: number | null;
  checks_answered: number; checks_missed: number;
  score: number | null; weights: { time: number; deadlines: number; quality: number };
  days?: MonthDay[] | null;
}
export interface WorkSettings {
  daily_break_minutes: number; checkin_buffer_minutes: number; check_min_minutes: number; check_max_minutes: number;
  check_answer_minutes: number; offline_minutes: number; meeting_cap_minutes: number; min_effective_pct: number;
  required_minutes: number; weight_time: number; weight_deadlines: number; weight_quality: number; updated_at?: string;
}
export interface WorkSession { id: string; employee_id: string; kind: 'task' | 'meeting'; task_id: string | null; started_at: string; ended_at: string | null; end_reason: string | null }
export interface ProgressCheck {
  id: string; employee_id: string; task_id: string | null; asked_by: string | null; question: string; is_presence: boolean;
  asked_at: string; expires_at: string | null; status: 'pending' | 'answered' | 'missed' | 'cancelled';
  answered_at: string | null; mood: Mood | null; progress_pct: number | null; answer: string | null;
}

export const WORK_NOT_READY = 'Work tracking switches on once its database update is applied.';
async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(isMissingSchema(error) ? WORK_NOT_READY : error.message);
  return data as T;
}

export const workApi = {
  heartbeat: () => call<WorkState>('work_heartbeat'),
  startTask: (taskId: string) => call<WorkState>('work_start_task', { p_task_id: taskId }),
  startMeeting: (type: MeetingType, note?: string | null) => call<WorkState>('work_start_meeting', { p_type: type, p_note: note ?? null }),
  pause: (reason: 'pause' | 'logout' = 'pause') => call<WorkState>('work_pause', { p_reason: reason }),
  answer: (checkId: string, mood: Mood, progress: number | null, answer: string | null) =>
    call<WorkState>('work_answer_check', { p_check_id: checkId, p_mood: mood, p_progress: progress, p_answer: answer }),
  ask: (taskId: string, question: string) => call<string>('work_ask', { p_task_id: taskId, p_question: question }),
  day: (employeeId: string | null, date: string) => call<WorkDay | null>('work_day', { p_employee_id: employeeId, p_date: date }),
  month: (employeeId: string | null, month: string) => call<WorkMonth>('work_month', { p_employee_id: employeeId, p_month: month }),
  teamMonth: (month: string) => call<Array<{ employee_id: string; name: string; designation: string | null; summary: WorkMonth }>>('work_team_month', { p_month: month }),
  teamLive: () => call<Array<{ employee_id: string; name: string; designation: string | null; state: WorkState; last_seen_at: string | null }>>('work_team_live'),
  async settings(): Promise<WorkSettings | null> {
    const { data, error } = await db.from('work_settings').select('*').maybeSingle();
    if (error) { if (isMissingSchema(error)) return null; throw new Error(error.message); }
    return data as WorkSettings | null;
  },
  async saveSettings(patch: Partial<WorkSettings>) {
    const { data, error } = await db.from('work_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', true).select('*');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Only admins can change work-tracking settings.');
    return data[0] as WorkSettings;
  },
  async taskSessions(taskId: string) {
    const { data, error } = await db.from('work_sessions').select('*').eq('task_id', taskId).order('started_at', { ascending: false }).limit(40);
    if (error) return [] as WorkSession[];
    return (data ?? []) as WorkSession[];
  },
  async taskChecks(taskId: string) {
    const { data, error } = await db.from('progress_checks').select('*').eq('task_id', taskId).in('status', ['answered', 'missed', 'pending']).order('asked_at', { ascending: false }).limit(30);
    if (error) return [] as ProgressCheck[];
    return (data ?? []) as ProgressCheck[];
  },
};

/* ---------- formatting ---------- */
export const hm = (min?: number | null) => {
  const m = Math.max(0, Math.round(Number(min ?? 0)));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h}h ${String(r).padStart(2, '0')}m` : `${r}m`;
};
export const clockOf = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
export const ticker = (sec: number) => {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`;
};
export const SEGMENT_STYLE: Record<SegmentKind, { label: string; bar: string; chip: string }> = {
  task: { label: 'Task', bar: 'bg-brand-500', chip: 'bg-brand-50 text-brand-700' },
  meeting: { label: 'Meeting', bar: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700' },
  break: { label: 'Break', bar: 'bg-amber-400', chip: 'bg-amber-50 text-amber-800' },
  away: { label: 'Away', bar: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700' },
  buffer: { label: 'Getting started', bar: 'bg-ink-300', chip: 'bg-ink-50 text-ink-600' },
};

/** First day of the month containing `d` (YYYY-MM-DD). */
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1 + by, 1));
  return dt.toISOString().slice(0, 10);
};
export const monthName = (m: string) => new Date(`${m}T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
