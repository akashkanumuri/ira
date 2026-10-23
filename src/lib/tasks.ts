import { supabase } from './supabase';
import type { Task, TaskStatus } from '../types/attendance';
import type { Tone } from '../ui';

/** Task workflow vocabulary shared by every task screen. */
export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone; hint: string }> = {
  assigned: { label: 'New', tone: 'sky', hint: 'Waiting for the assignee to accept' },
  accepted: { label: 'Accepted', tone: 'brand', hint: 'Accepted, not started yet' },
  in_progress: { label: 'In progress', tone: 'brand', hint: 'Being worked on' },
  blocked: { label: 'Blocked', tone: 'rose', hint: 'Can’t continue — see the reason' },
  awaiting_review: { label: 'In review', tone: 'amber', hint: 'Handed in, waiting for the reviewer' },
  revision_required: { label: 'Changes requested', tone: 'rose', hint: 'Sent back with notes' },
  completed: { label: 'Completed', tone: 'mint', hint: 'Approved' },
  cancelled: { label: 'Cancelled', tone: 'ink', hint: 'No longer needed' },
};

export const TASK_STATUS_ORDER: TaskStatus[] = ['assigned', 'accepted', 'in_progress', 'blocked', 'revision_required', 'awaiting_review', 'completed', 'cancelled'];

export const isTaskClosed = (t: Pick<Task, 'status'>) => t.status === 'completed' || t.status === 'cancelled';
export const isTaskOpen = (t: Pick<Task, 'status'>) => !isTaskClosed(t);
/** Work the assignee still has to do (not with the reviewer, not closed). */
export const isTaskWithAssignee = (t: Pick<Task, 'status'>) => !isTaskClosed(t) && t.status !== 'awaiting_review';

export function fmtMinutes(min?: number | null) {
  const m = Math.max(0, Math.round(Number(min ?? 0)));
  if (!m) return '0h';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

export interface TaskComment { id: string; task_id: string; author_id: string | null; body: string; created_at: string }
export interface TaskTimeLog { id: string; task_id: string; employee_id: string; work_date: string; minutes: number; note: string | null; created_at: string }
export interface TaskDependency { task_id: string; depends_on_id: string; created_at: string }
export interface TaskEvent { id: string; task_id: string; event_type: string; actor_employee_id: string | null; metadata: any; created_at: string }
export type DraftDecision = 'pending' | 'approved' | 'changes_requested' | 'auto_approved';
export interface TaskDraft {
  id: string; task_id: string; draft_no: number; link: string; note: string | null; submitted_by: string | null; submitted_at: string;
  on_time: boolean | null; decision: DraftDecision; decided_by: string | null; decided_at: string | null; feedback: string | null;
}
export interface TaskTimer { employee_id: string; task_id: string; started_at: string }
export type ClientRoundStatus = 'pending' | 'approved' | 'changes_requested' | 'withdrawn';
/** Staff view of a version sent to the client. */
export interface ClientRound {
  id: string; deliverable_id: string; project_id: string; task_id: string | null; draft_id: string | null; round_no: number;
  link: string | null; message: string | null; sent_by: string | null; sent_at: string; status: ClientRoundStatus;
  client_comment: string | null; decided_at: string | null; forwarded_at: string | null; forward_note: string | null;
}
/** Client view of a version (no staff identities, link hidden while payment-locked). */
export interface ClientVersion {
  id: string; round_no: number; link: string | null; message: string | null; sent_at: string; status: ClientRoundStatus;
  client_comment: string | null; decided_at: string | null; link_locked: boolean;
}
export const DRAFT_DECISION: Record<DraftDecision, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting for review', tone: 'amber' },
  approved: { label: 'Approved', tone: 'mint' },
  changes_requested: { label: 'Changes requested', tone: 'rose' },
  auto_approved: { label: 'Completed directly', tone: 'ink' },
};
export const CLIENT_ROUND: Record<ClientRoundStatus, { label: string; clientLabel: string; tone: Tone }> = {
  pending: { label: 'With client', clientLabel: 'Waiting for your review', tone: 'amber' },
  approved: { label: 'Client approved', clientLabel: 'You approved', tone: 'mint' },
  changes_requested: { label: 'Client wants changes', clientLabel: 'You asked for changes', tone: 'rose' },
  withdrawn: { label: 'Withdrawn', clientLabel: 'Withdrawn', tone: 'ink' },
};

export interface ReviewMetrics {
  from: string; to: string; tasks: number; completed: number; open: number; overdue: number;
  drafts: number; drafts_per_task: number | null; approved_drafts: number; changes_drafts: number; pending_drafts: number;
  approval_rate: number | null; first_draft_approval_rate: number | null; on_time_rate: number | null;
  avg_cycle_hours: number | null; avg_first_draft_hours: number | null; avg_review_hours: number | null;
  logged_minutes: number; estimate_minutes: number; estimate_actual_minutes: number;
  client_rounds: number; client_approved: number; client_changes: number; client_first_time_rate: number | null;
}

export interface TaskFile { id: string; name: string; size_bytes: number | null; created_at: string; uploaded_by: string | null; storage_bucket: string; storage_path: string }

const db = supabase as any;

/** True when an error means a table or function from a not-yet-applied migration is missing. */
export function isMissingSchema(err: { code?: string; message?: string } | null | undefined) {
  if (!err) return false;
  return ['42P01', '42883', 'PGRST202', 'PGRST205', '42703'].includes(String(err.code ?? '')) ||
    /does not exist|could not find the (table|function)/i.test(String(err.message ?? ''));
}

export async function loadTaskExtras(taskId: string) {
  const [c, l, d, b, e, f, dr, tm, cr] = await Promise.all([
    db.from('task_comments').select('*').eq('task_id', taskId).order('created_at'),
    db.from('task_time_logs').select('*').eq('task_id', taskId).order('work_date', { ascending: false }),
    db.from('task_dependencies').select('*').eq('task_id', taskId),
    db.from('task_dependencies').select('*').eq('depends_on_id', taskId),
    db.from('task_events').select('*').eq('task_id', taskId).order('created_at', { ascending: false }).limit(50),
    db.from('files').select('id, name, size_bytes, created_at, uploaded_by, storage_bucket, storage_path').eq('parent_type', 'task').eq('parent_id', taskId).is('deleted_at', null).order('created_at', { ascending: false }),
    db.from('task_drafts').select('*').eq('task_id', taskId).order('draft_no', { ascending: false }),
    db.from('task_timers').select('*').eq('task_id', taskId).maybeSingle(),
    db.from('deliverable_client_reviews').select('*').eq('task_id', taskId).order('round_no', { ascending: false }),
  ]);
  const err = c.error || l.error || d.error || e.error || f.error;
  if (err) {
    if (isMissingSchema(err)) throw new Error('Comments, time logs and subtasks switch on once the task workflow database update is applied.');
    throw new Error(err.message);
  }
  return {
    comments: (c.data ?? []) as TaskComment[],
    timeLogs: (l.data ?? []) as TaskTimeLog[],
    waitsOn: (d.data ?? []) as TaskDependency[],
    blocks: (b.data ?? []) as TaskDependency[],
    events: (e.data ?? []) as TaskEvent[],
    files: (f.data ?? []) as TaskFile[],
    // Review-flow tables arrive with a later update; tolerate them being absent.
    drafts: (dr.error ? [] : dr.data ?? []) as TaskDraft[],
    timer: (tm.error ? null : tm.data ?? null) as TaskTimer | null,
    clientRounds: (cr.error ? [] : cr.data ?? []) as ClientRound[],
    reviewFlowReady: !dr.error,
  };
}

async function call<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(isMissingSchema(error) ? 'This action switches on once the task workflow database update is applied.' : error.message);
  return data as T;
}

export const taskApi = {
  transition: (taskId: string, to: TaskStatus, note?: string | null, link?: string | null) =>
    call<string>('task_transition', { p_task_id: taskId, p_to: to, p_note: note ?? null, p_link: link ?? null }),
  setProgress: (taskId: string, pct: number) => call('task_set_progress', { p_task_id: taskId, p_pct: pct }),
  logTime: (taskId: string, minutes: number, workDate: string, note?: string | null) =>
    call<string>('task_log_time', { p_task_id: taskId, p_minutes: minutes, p_work_date: workDate, p_note: note ?? null }),
  comment: (taskId: string, body: string) => call<string>('task_add_comment', { p_task_id: taskId, p_body: body }),
  setDependency: (taskId: string, dependsOnId: string, add: boolean) =>
    call('task_set_dependency', { p_task_id: taskId, p_depends_on_id: dependsOnId, p_add: add }),
  createSubtask: (parentId: string, title: string, dueDate: string, assignedTo?: string | null, description?: string | null) =>
    call<string>('task_create_subtask', { p_parent_id: parentId, p_title: title, p_due_date: dueDate, p_assigned_to: assignedTo ?? null, p_description: description ?? null }),
  timerStart: (taskId: string) => call<string>('task_timer_start', { p_task_id: taskId }),
  timerStop: () => call<number>('task_timer_stop', {}),
};

const REVIEW_NOT_READY = 'Drafts and client reviews switch on once the review database update is applied.';
async function rcall<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(isMissingSchema(error) ? REVIEW_NOT_READY : error.message);
  return data as T;
}

/** Manager/admin ⇄ client review loop, and productivity metrics. */
export const reviewApi = {
  rounds: async (deliverableId: string) => {
    const { data, error } = await db.from('deliverable_client_reviews').select('*').eq('deliverable_id', deliverableId).order('round_no', { ascending: false });
    if (error) throw new Error(isMissingSchema(error) ? REVIEW_NOT_READY : error.message);
    return (data ?? []) as ClientRound[];
  },
  approvedTasks: async (deliverableId: string) => {
    const { data, error } = await db.from('tasks').select('id, title, status, submitted_link, assigned_to, completed_at')
      .eq('deliverable_id', deliverableId).is('archived_at', null).order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{ id: string; title: string; status: TaskStatus; submitted_link: string | null; assigned_to: string; completed_at: string | null }>;
  },
  sendToClient: (deliverableId: string, link: string | null, message: string | null, taskId: string | null) =>
    rcall<string>('staff_send_to_client', { p_deliverable_id: deliverableId, p_link: link, p_message: message, p_task_id: taskId }),
  forward: (reviewId: string, note: string | null, taskId?: string | null) =>
    rcall('staff_forward_client_feedback', { p_review_id: reviewId, p_note: note, p_task_id: taskId ?? null }),
  clientVersions: (deliverableId: string) => rcall<ClientVersion[]>('client_deliverable_reviews', { p_deliverable_id: deliverableId }),
  clientDecide: (reviewId: string, approve: boolean, comment: string | null) =>
    rcall('client_decide_review', { p_review_id: reviewId, p_approve: approve, p_comment: comment }),
  metrics: (employeeId?: string | null, from?: string | null, to?: string | null) =>
    rcall<ReviewMetrics>('employee_review_metrics', { p_employee_id: employeeId ?? null, p_from: from ?? null, p_to: to ?? null }),
  teamMetrics: (from?: string | null, to?: string | null) =>
    rcall<Array<{ employee_id: string; name: string; metrics: ReviewMetrics }>>('team_review_metrics', { p_from: from ?? null, p_to: to ?? null }),
};

export const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(Number(v))}%`);
export const hrs = (v: number | null | undefined) => {
  if (v == null) return '—';
  const h = Number(v);
  return h >= 48 ? `${Math.round(h / 24)}d` : h >= 1 ? `${Math.round(h)}h` : `${Math.max(1, Math.round(h * 60))}m`;
};
