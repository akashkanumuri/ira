import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { isMissingSchema } from './tasks';
import { uploadAndAttach } from './sigma';

/** Leave policy and approval chain. Falls back to the built-in types until the leave approvals migration is applied. */
export interface LeaveType {
  code: string;
  name: string;
  isPaid: boolean;
  annualLimit: number | null;
  maxConsecutiveDays: number | null;
  documentRequiredAfterDays: number | null;
  minNoticeDays: number;
  allowHalfDay: boolean;
  active: boolean;
  sortOrder: number;
}
export type LeaveChain = 'admin' | 'manager_then_admin' | 'manager';

export const BUILT_IN_LEAVE_TYPES: LeaveType[] = [
  ['casual', 'Casual', true], ['sick', 'Sick', true], ['earned', 'Earned', true], ['unpaid', 'Unpaid', false],
].map(([code, name, isPaid], i) => ({
  code: code as string, name: name as string, isPaid: isPaid as boolean, annualLimit: null, maxConsecutiveDays: null,
  documentRequiredAfterDays: null, minNoticeDays: 0, allowHalfDay: true, active: true, sortOrder: i + 1,
}));

export const CHAIN_LABEL: Record<LeaveChain, { title: string; text: string }> = {
  admin: { title: 'Admin decides', text: 'Requests go straight to administrators.' },
  manager_then_admin: { title: 'Manager, then admin', text: 'The reporting manager approves first; an admin gives the final approval.' },
  manager: { title: 'Manager decides', text: 'The reporting manager’s approval is final. Admins can still step in.' },
};

const db = supabase as any;

export const mapLeaveType = (r: any): LeaveType => ({
  code: r.code, name: r.name, isPaid: Boolean(r.is_paid),
  annualLimit: r.annual_limit == null ? null : Number(r.annual_limit),
  maxConsecutiveDays: r.max_consecutive_days == null ? null : Number(r.max_consecutive_days),
  documentRequiredAfterDays: r.document_required_after_days == null ? null : Number(r.document_required_after_days),
  minNoticeDays: Number(r.min_notice_days ?? 0), allowHalfDay: r.allow_half_day !== false, active: r.active !== false,
  sortOrder: Number(r.sort_order ?? 0),
});

export function useLeavePolicy() {
  const [types, setTypes] = useState<LeaveType[]>(BUILT_IN_LEAVE_TYPES);
  const [chain, setChain] = useState<LeaveChain>('admin');
  const [ready, setReady] = useState(false); // migration applied
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    const [t, s] = await Promise.all([
      db.from('leave_types').select('*').order('sort_order').order('name'),
      db.from('approval_settings').select('leave_chain').eq('id', true).maybeSingle(),
    ]);
    if (t.error || s.error) {
      setReady(false);
    } else {
      setTypes((t.data ?? []).map(mapLeaveType));
      if (s.data?.leave_chain) setChain(s.data.leave_chain);
      setReady(true);
    }
    setLoaded(true);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { types, chain, ready, loaded, reload };
}

export interface TeamLeaveRequest {
  id: string; employee_id: string; employee_name: string; designation: string | null; avatar_url: string | null;
  leave_type: string; start_date: string; end_date: string; duration: 'full' | 'half'; days: number; reason: string | null;
  status: string; manager_status: string | null; manager_note: string | null; review_note: string | null;
  has_document: boolean; created_at: string; available_paid: number | null;
}

async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(isMissingSchema(error) ? 'This switches on once the leave approvals database update is applied.' : error.message);
  return data as T;
}

export const leaveApi = {
  teamRequests: () => rpc<TeamLeaveRequest[]>('leave_team_requests'),
  managerReview: (id: string, decision: 'approved' | 'rejected', note?: string | null) =>
    rpc<'approved' | 'rejected' | 'forwarded'>('leave_manager_review', { p_leave_id: id, p_decision: decision, p_note: note ?? null }),
  cancel: (id: string) => rpc('leave_cancel', { p_leave_id: id }),
  attachDocument: (leaveId: string, file: File) => uploadAndAttach(file, 'leave', leaveId),
  documents: async (leaveId: string) => {
    const { data, error } = await db.from('files').select('id, name, storage_bucket, storage_path, created_at')
      .eq('parent_type', 'leave').eq('parent_id', leaveId).is('deleted_at', null).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{ id: string; name: string; storage_bucket: string; storage_path: string; created_at: string }>;
  },
};

/** One-line rule summary shown when choosing a leave type. */
export function leaveRuleText(t: LeaveType) {
  const parts: string[] = [t.isPaid ? 'Paid from your balance' : 'Unpaid'];
  if (t.annualLimit != null) parts.push(`up to ${t.annualLimit} day${t.annualLimit === 1 ? '' : 's'} a year`);
  if (t.maxConsecutiveDays != null) parts.push(`max ${t.maxConsecutiveDays} in a row`);
  if (t.minNoticeDays > 0) parts.push(`${t.minNoticeDays} day${t.minNoticeDays === 1 ? '' : 's'} notice`);
  if (t.documentRequiredAfterDays != null) parts.push(t.documentRequiredAfterDays === 0 ? 'document required' : `document needed over ${t.documentRequiredAfterDays} day${t.documentRequiredAfterDays === 1 ? '' : 's'}`);
  if (!t.allowHalfDay) parts.push('no half days');
  return parts.join(' · ');
}
