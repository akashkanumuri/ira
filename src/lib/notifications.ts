// IRA Presence V2 - Persistent In-App Notifications & Event Generator
import { supabase, isSupabaseConfigured } from './supabase';
import { notify } from './toast';
import type { Database } from './database.types';

export type NotificationType = 'attendance' | 'leave' | 'wfh' | 'task' | 'holiday' | 'payroll' | 'system';

export interface NotificationRecord {
  id: string;
  recipient_id: string;
  employee_id: string | null;
  actor_id: string | null;
  type: NotificationType;
  title: string;
  message: string;
  action_url: string | null;
  read_at: string | null;
  idempotency_key: string | null;
  metadata: any;
  created_at: string;
}

export interface CreateNotificationInput {
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string;
  idempotencyKey?: string;
  employeeId?: string;
  actorId?: string;
  metadata?: Record<string, any>;
}

// In-memory fallback cache when offline or if table is in initial migration phase
const localFallbackStore: NotificationRecord[] = [];

/**
 * Resolves all Supabase user IDs that are authorized approvers (Admins + direct manager).
 */
export async function getApproverUserIds(): Promise<string[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data, error } = await (supabase as any).rpc('get_my_approver_ids');
    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((r: any) => r.profile_id).filter(Boolean);
    }
  } catch {}

  try {
    const { data } = await (supabase as any)
      .from('profiles')
      .select('id')
      .eq('role', 'admin');
    return (data ?? []).map((r: any) => r.id).filter(Boolean);
  } catch {
    return [];
  }
}

export const getAdminUserIds = getApproverUserIds;

/**
 * Resolves the Supabase Auth profile_id for a given employee DB record ID.
 */
export async function getEmployeeProfileId(employeeDbId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !employeeDbId) return null;
  try {
    const { data } = await (supabase as any)
      .from('employees')
      .select('profile_id')
      .eq('id', employeeDbId)
      .maybeSingle();
    return data?.profile_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves the Supabase Auth profile IDs for all active employees.
 */
export async function getActiveEmployeeProfileIds(): Promise<string[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data } = await (supabase as any)
      .from('employees')
      .select('profile_id')
      .eq('status', 'active')
      .not('profile_id', 'is', null);
    return (data ?? []).map((r: any) => r.profile_id).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Fetch persistent notifications for the authenticated user, newest first.
 */
export async function fetchUserNotifications(userId: string, limit = 50): Promise<NotificationRecord[]> {
  if (!isSupabaseConfigured || !userId) {
    return localFallbackStore.filter((n) => n.recipient_id === userId);
  }

  try {
    const { data, error } = await (supabase as any)
      .from('notifications')
      .select('*')
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[Notifications] Fetch warning (using local store fallback):', error.message);
      return localFallbackStore.filter((n) => n.recipient_id === userId);
    }

    return (data ?? []) as NotificationRecord[];
  } catch (err) {
    console.warn('[Notifications] Fetch exception:', err);
    return localFallbackStore.filter((n) => n.recipient_id === userId);
  }
}

/**
 * Mark a single notification as read by timestamping read_at.
 */
export async function markNotificationAsRead(notificationId: string): Promise<boolean> {
  const readTimestamp = new Date().toISOString();

  // Update in-memory fallback
  const fallback = localFallbackStore.find((n) => n.id === notificationId);
  if (fallback) fallback.read_at = readTimestamp;

  if (!isSupabaseConfigured) return true;

  try {
    const { error } = await (supabase as any)
      .from('notifications')
      .update({ read_at: readTimestamp })
      .eq('id', notificationId);

    if (error) {
      console.warn('[Notifications] Mark read warning:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Notifications] Mark read error:', err);
    return false;
  }
}

/**
 * Mark all unread notifications for a user as read.
 */
export async function markAllNotificationsAsRead(userId: string): Promise<boolean> {
  const readTimestamp = new Date().toISOString();

  for (const item of localFallbackStore) {
    if (item.recipient_id === userId && !item.read_at) {
      item.read_at = readTimestamp;
    }
  }

  if (!isSupabaseConfigured || !userId) return true;

  try {
    const { error } = await (supabase as any)
      .from('notifications')
      .update({ read_at: readTimestamp })
      .eq('recipient_id', userId)
      .is('read_at', null);

    if (error) {
      console.warn('[Notifications] Mark all read warning:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Notifications] Mark all read error:', err);
    return false;
  }
}

/**
 * Delete a notification from the user's history.
 */
export async function deleteNotification(notificationId: string): Promise<boolean> {
  const idx = localFallbackStore.findIndex((n) => n.id === notificationId);
  if (idx !== -1) localFallbackStore.splice(idx, 1);

  if (!isSupabaseConfigured) return true;

  try {
    const { error } = await (supabase as any)
      .from('notifications')
      .delete()
      .eq('id', notificationId);

    if (error) {
      console.warn('[Notifications] Delete warning:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Notifications] Delete error:', err);
    return false;
  }
}

/**
 * Dispatches an automated Web Push message to the recipient's registered device(s).
 * Calls the trusted backend / Edge Function or logs delivery intent.
 */
export async function dispatchPushToRecipient(
  recipientId: string,
  title: string,
  body: string,
  actionUrl = '/',
  notificationId?: string,
  idempotencyKey?: string
) {
  if (!isSupabaseConfigured || !recipientId) return;

  try {
    // Attempt Supabase Edge Function invoke for secure server-side push dispatch
    const { error } = await supabase.functions.invoke('send-push', {
      body: {
        recipientId,
        title,
        body,
        actionUrl,
        notificationId,
        idempotencyKey,
      },
    });

    if (error) {
      console.debug('[Notifications] Edge function push dispatch notice:', error.message);
    }
  } catch (e) {
    console.debug('[Notifications] Push dispatch exception:', e);
  }
}

/**
 * Creates a persistent notification for a specific recipient.
 * Validates inputs, prevents duplicates via idempotency keys, and dispatches Web Push.
 */
export async function createNotification(input: CreateNotificationInput): Promise<NotificationRecord | null> {
  if (!input.recipientId || !input.title || !input.message) {
    console.warn('[Notifications] Missing required notification fields:', input);
    return null;
  }

  const record: NotificationRecord = {
    id: crypto.randomUUID(),
    recipient_id: input.recipientId,
    employee_id: input.employeeId ?? null,
    actor_id: input.actorId ?? null,
    type: input.type,
    title: input.title,
    message: input.message,
    action_url: input.actionUrl ?? null,
    read_at: null,
    idempotency_key: input.idempotencyKey ?? null,
    metadata: input.metadata ?? {},
    created_at: new Date().toISOString(),
  };

  // Prevent duplicate if idempotency key already exists in local store
  if (input.idempotencyKey && localFallbackStore.some((n) => n.idempotency_key === input.idempotencyKey)) {
    return null;
  }

  localFallbackStore.unshift(record);

  if (isSupabaseConfigured) {
    try {
      // 1. Attempt secure RPC notify_user first (enforces security & caller verification in DB)
      const { data: rpcId, error: rpcError } = await (supabase as any).rpc('notify_user', {
        p_recipient_id: input.recipientId,
        p_type: input.type,
        p_title: input.title,
        p_message: input.message,
        p_action_url: input.actionUrl ?? null,
        p_idempotency_key: input.idempotencyKey ?? null,
        p_employee_id: input.employeeId ?? null,
        p_actor_id: input.actorId ?? null,
        p_metadata: input.metadata ?? {},
      });

      if (!rpcError && rpcId) {
        record.id = rpcId;
      } else {
        // 2. Fallback to direct table insert (permitted for admins under hardened RLS)
        const payload: any = {
          recipient_id: input.recipientId,
          employee_id: input.employeeId ?? null,
          actor_id: input.actorId ?? null,
          type: input.type,
          title: input.title,
          message: input.message,
          action_url: input.actionUrl ?? null,
          idempotency_key: input.idempotencyKey ?? null,
          metadata: input.metadata ?? {},
        };

        const { data, error } = await (supabase as any)
          .from('notifications')
          .insert(payload)
          .select('*')
          .maybeSingle();

        if (error) {
          if (error.code === '23505') {
            return null;
          }
          console.debug('[Notifications] Insert DB notice (using fallback store):', error.message);
        } else if (data) {
          record.id = data.id;
        }
      }
    } catch (err) {
      console.debug('[Notifications] Insert DB exception:', err);
    }
  }

  // Trigger push notification with verified notification reference and idempotency key
  void dispatchPushToRecipient(input.recipientId, input.title, input.message, input.actionUrl ?? '/', record.id, input.idempotencyKey);

  return record;
}

// ============================================================================
// CONVENIENCE RECIPIENT-ROUTED EVENT HANDLERS
// ============================================================================

/**
 * When an employee submits a leave request:
 * Notify the authorized approver(s) (Admins and direct manager).
 */
export async function notifyLeaveSubmitted(params: {
  employeeName: string;
  days: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  leaveId: string;
  employeeDbId: string;
  actorUserId: string;
  adminUserIds?: string[];
}): Promise<void> {
  const { employeeName, days, leaveType, startDate, endDate, leaveId } = params;
  const approverIds = params.adminUserIds && params.adminUserIds.length ? params.adminUserIds : await getApproverUserIds();

  for (const approverId of approverIds) {
    const idempotencyKey = `leave_submit_${leaveId}_${approverId}`;
    void dispatchPushToRecipient(
      approverId,
      'New Leave Request',
      `${employeeName} requested ${days} day(s) of ${leaveType} leave (${startDate} to ${endDate}).`,
      '/admin-requests',
      undefined,
      idempotencyKey
    );
  }
}

/**
 * When an approver reviews a leave request:
 * Notify the requesting employee.
 */
export async function notifyLeaveReviewed(params: {
  employeeProfileId?: string | null;
  employeeDbId: string;
  status: 'approved' | 'rejected';
  startDate: string;
  endDate: string;
  leaveId: string;
  actorUserId: string;
}): Promise<void> {
  const { employeeDbId, status, startDate, endDate, leaveId, actorUserId } = params;
  const profileId = params.employeeProfileId || await getEmployeeProfileId(employeeDbId);
  if (!profileId) return;

  const statusLabel = status === 'approved' ? 'Approved' : 'Rejected';
  const idempotencyKey = `leave_review_${leaveId}_${status}`;

  // Database trigger trg_leave_request_notify creates in-app notification row.
  // Dispatch Web Push to employee backed by the verified trigger notification.
  void dispatchPushToRecipient(
    profileId,
    `Leave Request ${statusLabel}`,
    `Your leave request for ${startDate} to ${endDate} has been ${status}.`,
    '/emp-leave',
    undefined,
    idempotencyKey
  );
}

/**
 * When an employee requests WFH:
 * Notify the authorized approver(s) (Admins and direct manager).
 */
export async function notifyWfhSubmitted(params: {
  employeeName: string;
  date: string;
  duration: string;
  wfhId: string;
  employeeDbId: string;
  actorUserId: string;
  adminUserIds?: string[];
}): Promise<void> {
  const { employeeName, date, duration, wfhId } = params;
  const approverIds = params.adminUserIds && params.adminUserIds.length ? params.adminUserIds : await getApproverUserIds();

  for (const approverId of approverIds) {
    const idempotencyKey = `wfh_submit_${wfhId}_${approverId}`;
    void dispatchPushToRecipient(
      approverId,
      'New WFH Request',
      `${employeeName} requested WFH for ${date} (${duration.replace('_', ' ')}).`,
      '/admin-requests',
      undefined,
      idempotencyKey
    );
  }
}

/**
 * When an approver reviews a WFH request:
 * Notify the requesting employee.
 */
export async function notifyWfhReviewed(params: {
  employeeProfileId?: string | null;
  employeeDbId: string;
  status: 'approved' | 'rejected';
  date: string;
  wfhId: string;
  actorUserId: string;
}): Promise<void> {
  const { employeeDbId, status, date, wfhId, actorUserId } = params;
  const profileId = params.employeeProfileId || await getEmployeeProfileId(employeeDbId);
  if (!profileId) return;

  const statusLabel = status === 'approved' ? 'Approved' : 'Rejected';
  const idempotencyKey = `wfh_review_${wfhId}_${status}`;

  // Database trigger trg_wfh_request_notify creates in-app notification row.
  // Dispatch Web Push to employee backed by the verified trigger notification.
  void dispatchPushToRecipient(
    profileId,
    `WFH Request ${statusLabel}`,
    `Your WFH request for ${date} has been ${status}.`,
    '/emp-wfh',
    undefined,
    idempotencyKey
  );
}

/**
 * When a task is assigned:
 * Notify the assigned employee.
 */
export async function notifyTaskAssigned(params: {
  assigneeProfileId?: string | null;
  assigneeEmployeeId: string;
  taskTitle: string;
  dueDate: string;
  taskId: string;
  actorUserId: string;
}): Promise<void> {
  const { assigneeEmployeeId, taskTitle, dueDate, taskId, actorUserId } = params;
  const profileId = params.assigneeProfileId || await getEmployeeProfileId(assigneeEmployeeId);
  if (!profileId) return;

  const idempotencyKey = `task_assign_${taskId}_${profileId}`;

  // Database trigger trg_task_notify creates in-app notification row.
  // Dispatch Web Push to employee backed by the verified trigger notification.
  void dispatchPushToRecipient(
    profileId,
    'New Task Assigned',
    `You have been assigned: "${taskTitle}" (Due: ${dueDate}).`,
    '/emp-tasks',
    undefined,
    idempotencyKey
  );
}

/**
 * When an employee submits completed task work:
 * Notify the reviewer / assigner / admin.
 */
export async function notifyTaskSubmitted(params: {
  assignerProfileId?: string | null;
  assignerEmployeeId?: string | null;
  taskTitle: string;
  taskId: string;
  actorUserId: string;
  adminUserIds?: string[];
}): Promise<void> {
  const { taskTitle, taskId } = params;

  let assignerProfileId = params.assignerProfileId;
  if (!assignerProfileId && params.assignerEmployeeId) {
    assignerProfileId = await getEmployeeProfileId(params.assignerEmployeeId);
  }

  const adminIds = params.adminUserIds && params.adminUserIds.length ? params.adminUserIds : await getApproverUserIds();
  const allRecipients = Array.from(new Set([
    ...(assignerProfileId ? [assignerProfileId] : []),
    ...adminIds,
  ]));

  for (const rId of allRecipients) {
    const isAssigner = rId === assignerProfileId;
    const actionUrl = isAssigner ? '/emp-tasks' : '/admin-tasks';
    const idempotencyKey = `task_completed_${taskId}_${rId}`;
    void dispatchPushToRecipient(
      rId,
      'Task Work Submitted',
      `Completed work submitted for: "${taskTitle}".`,
      actionUrl,
      undefined,
      idempotencyKey
    );
  }
}

/**
 * When an admin announces a holiday:
 * Notify active employees.
 */
export async function notifyHolidayAdded(params: {
  holidayName: string;
  date: string;
  holidayId: string;
  actorUserId: string;
  activeEmployeeProfileIds?: string[];
}): Promise<void> {
  const { holidayName, date, holidayId } = params;
  const profileIds = params.activeEmployeeProfileIds && params.activeEmployeeProfileIds.length
    ? params.activeEmployeeProfileIds
    : await getActiveEmployeeProfileIds();

  for (const profileId of profileIds) {
    const idempotencyKey = `holiday_announce_${holidayId}_${profileId}`;
    void dispatchPushToRecipient(
      profileId,
      'Company Holiday Announced',
      `${holidayName} scheduled on ${date}.`,
      '/emp-holidays',
      undefined,
      idempotencyKey
    );
  }
}
