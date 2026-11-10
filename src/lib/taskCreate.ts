import { supabase } from './supabase';
import { notify } from './toast';
import { notifyTaskAssigned } from './notifications';
import { getKolkataDateString } from './workingDays';

/**
 * Creating an assigned task, in one place.
 *
 * The Assign work form is opened from three places — Work & tasks, a manager's own page, and a
 * client deliverable — and every one of them has to create the task, link it to its deliverable,
 * set the estimate and research time, and tell the person. Keeping that here means the three
 * callers cannot drift apart.
 */

const db = () => supabase as any;

async function setResearch(taskId: string, minutesRaw: FormDataEntryValue | null) {
  const minutes = Math.round(Number(minutesRaw ?? ''));
  if (!Number.isFinite(minutes) || minutes === 30) return; // 30 min is the database default
  const { error } = await db().rpc('task_set_research', { p_task_id: taskId, p_minutes: Math.min(480, Math.max(5, minutes)) });
  if (error) notify(`Task assigned, but the research time couldn’t be set: ${error.message}`, 'error', 7000);
}

async function setEstimate(taskId: string, hoursRaw: FormDataEntryValue | null) {
  const hours = Number(hoursRaw ?? '');
  if (!Number.isFinite(hours) || hours <= 0) return;
  const { error } = await db().rpc('task_set_estimate', { p_task_id: taskId, p_minutes: Math.round(hours * 60) });
  if (error && !/does not exist|could not find/i.test(error.message)) notify(`Task created, but the estimate wasn’t saved: ${error.message}`, 'error', 6000);
}

async function linkToDeliverable(taskId: string, deliverableId: string) {
  if (!deliverableId) return;
  const { error } = await db().rpc('staff_link_task_to_deliverable', { p_task_id: taskId, p_deliverable_id: deliverableId });
  if (error) notify(`Task created, but it couldn’t be linked to the deliverable: ${error.message}`, 'error', 7000);
}

export interface AssignedTaskResult { taskId: string | null; title: string; assignedTo: string; dueDate: string }

/**
 * Reads the Assign work form and creates the task. Throws with a readable message when the form
 * is incomplete or the database refuses; the caller shows it.
 *
 * `requestId` makes the create idempotent: pass the same id when retrying the same form so a slow
 * network cannot produce two tasks.
 */
export async function createAssignedTask(
  fd: FormData,
  opts: { requestId: string; actorUserId?: string; deliverableId?: string | null },
): Promise<AssignedTaskResult> {
  const title = String(fd.get('title') || '').trim();
  const assignedTo = String(fd.get('assignedTo') || '');
  const description = String(fd.get('description') || '').trim();
  const start = String(fd.get('startDate') || getKolkataDateString());
  const due = String(fd.get('dueDate') || getKolkataDateString());
  const priority = String(fd.get('priority') || 'medium');

  if (!title || !assignedTo) throw new Error('Task title and employee are required.');
  if (!description) throw new Error('A brief is required: say what the person has to produce.');
  if (due < start) throw new Error('Due date cannot be before the start date.');

  const { data: taskId, error } = await db().rpc('create_task', {
    p_title: title, p_description: description, p_assigned_to: assignedTo,
    p_start_date: start, p_due_date: due, p_priority: priority, p_client_request_id: opts.requestId,
  });
  if (error) throw new Error(error.message);

  const deliverableId = opts.deliverableId ?? String(fd.get('deliverableId') ?? '');
  if (taskId) {
    await linkToDeliverable(taskId, deliverableId || '');
    await setEstimate(taskId, fd.get('estimateHours'));
    await setResearch(taskId, fd.get('researchMinutes'));
    void notifyTaskAssigned({
      assigneeEmployeeId: assignedTo, taskTitle: title, dueDate: due,
      taskId: taskId || opts.requestId, actorUserId: opts.actorUserId ?? '',
    });
  }
  return { taskId: taskId ?? null, title, assignedTo, dueDate: due };
}
