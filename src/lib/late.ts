import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

/** One counted late in a month. cut is in days (0 = warning, 0.5 = half day, 1 = full day). */
export interface LateMark { date: string; check_in: string; late_min: number; n: number; cut: number; kind: 'warning' | 'half' | 'full'; amount: number | null }

export interface LateStatus {
  month: string; enabled: boolean; warnings: number; from: string;
  count: number; cut_days: number; daily_rate: number | null; cut_amount: number | null;
  next_n: number; next_cut: number; late_after: string | null; never_late: boolean;
  marks: LateMark[];
}

export interface LateTeamRow { employee_id: string; name: string; count: number; cut_days: number; dates: Array<{ date: string; n: number; late_min: number; cut: number }> }

const db = supabase as any;

export async function fetchLateStatus(employeeId?: string | null, month?: string | null): Promise<LateStatus | null> {
  const { data, error } = await db.rpc('late_status', { p_employee_id: employeeId ?? null, p_month: month ?? null });
  if (error || !data) return null; // not installed yet / not allowed → screens simply hide the late section
  return data as LateStatus;
}

export async function fetchLateTeam(month?: string | null): Promise<LateTeamRow[]> {
  const { data, error } = await db.rpc('late_team', { p_month: month ?? null });
  return error || !Array.isArray(data) ? [] : (data as LateTeamRow[]);
}

/** Live late status for the signed-in employee (or one employee for admins); refreshes after every check-in. */
export function useLateStatus(employeeId?: string | null, month?: string | null, enabled = true) {
  const [status, setStatus] = useState<LateStatus | null | undefined>(undefined);
  const load = useCallback(async () => { if (enabled) setStatus(await fetchLateStatus(employeeId, month)); }, [employeeId, month, enabled]);
  useEffect(() => {
    if (!enabled) { setStatus(null); return; }
    void load();
    const on = () => { void load(); };
    window.addEventListener('ira:attendance', on);
    return () => window.removeEventListener('ira:attendance', on);
  }, [load, enabled]);
  return { status, reload: load };
}

export const cutLabel = (cut: number) => (cut >= 1 ? 'Full-day cut' : cut > 0 ? 'Half-day cut' : 'Warning');
export const cutShort = (cut: number) => (cut >= 1 ? '−1 day' : cut > 0 ? '−½ day' : 'Warning');

/** What a late with this number means, in plain words. */
export function lateStepLabel(n: number, warnings: number) {
  if (n <= warnings) return n === warnings ? `Final warning (${n} of ${warnings})` : `Warning ${n} of ${warnings}`;
  return n === warnings + 1 ? 'Half-day salary cut' : 'Full-day salary cut';
}

/** Cut (in days) that the next late would cost. */
export const nextCutText = (s: LateStatus) =>
  s.next_cut >= 1 ? 'a full day’s salary' : s.next_cut > 0 ? 'half a day’s salary' : `warning ${s.next_n} of ${s.warnings}`;

export const lateTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
export const lateDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
