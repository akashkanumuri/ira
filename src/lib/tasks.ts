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
export interface TaskFile { id: string; name: string; size_bytes: number | null; created_at: string; uploaded_by: string | null; storage_bucket: string; storage_path: string }

const db = supabase as any;

/** True when an error means a table or function from a not-yet-applied migration is missing. */
export function isMissingSchema(err: { code?: string; message?: string } | null | undefined) {
  if (!err) return false;
  return ['42P01', '42883', 'PGRST202', 'PGRST205', '42703'].includes(String(err.code ?? '')) ||
    /does not exist|could not find the (table|function)/i.test(String(err.message ?? ''));
}

export async function loadTaskExtras(taskId: string) {
  const [c, l, d, b, e, f] = await Promise.all([
    db.from('task_comments').select('*').eq('task_id', taskId).order('created_at'),
    db.from('task_time_logs').select('*').eq('task_id', taskId).order('work_date', { ascending: false }),
    db.from('task_dependencies').select('*').eq('task_id', taskId),
    db.from('task_dependencies').select('*').eq('depends_on_id', taskId),
    db.from('task_events').select('*').eq('task_id', taskId).order('created_at', { ascending: false }).limit(50),
    db.from('files').select('id, name, size_bytes, created_at, uploaded_by, storage_bucket, storage_path').eq('parent_type', 'task').eq('parent_id', taskId).is('deleted_at', null).order('created_at', { ascending: false }),
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
};
