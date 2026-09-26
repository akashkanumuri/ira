/**
 * IRA Presence real-time attendance engine.
 * Supabase is the only source of truth for attendance state.
 *
 * Employee flow:
 *   Office/WFH -> Check In -> Working -> Break/Resume (optional) -> Check Out
 *
 * Check-out stores the final working seconds for that exact IST calendar date.
 */

import { supabase, isSupabaseConfigured } from './supabase';
import type { AttendanceMode, AttendanceRecord, BreakEvent, AttendanceState } from '../types/attendance';
import { getKolkataDateString, formatKolkataTime } from './workingDays';

interface CheckInParams {
  employeeId: string;
  profileId: string;
  employeeName: string;
  employeeEmpId?: string;
  department?: string;
  employeeRole: string;
  mode: AttendanceMode;
}

interface OperationResult {
  success: boolean;
  error?: string;
  attendanceRecord?: AttendanceRecord;
}

function requireDatabase(): OperationResult | null {
  return isSupabaseConfigured ? null : { success: false, error: 'Unable to connect right now. Please try again.' };
}

function buildWorkingRecord(
  params: CheckInParams,
  id: string,
  date: string,
  nowIso: string,
  nowFormattedTime: string,
  status: 'present' | 'late'
): AttendanceRecord {
  return {
    id,
    employeeId: params.employeeId,
    employeeName: params.employeeName,
    employeeEmpId: params.employeeEmpId ?? '',
    department: params.department ?? '',
    date,
    mode: params.mode,
    checkIn: nowFormattedTime,
    checkInIso: nowIso,
    workingHours: '00h 00m',
    breakDuration: '00h 00m',
    workingSeconds: 0,
    breakSeconds: 0,
    elapsedSeconds: 0,
    currentBreakSeconds: 0,
    status,
    attendanceState: 'working',
    activeBreakStartIso: null,
    breaks: [],
  };
}

function toBreakEvent(row: any): BreakEvent {
  return {
    id: row.id,
    attendanceId: row.attendance_id,
    employeeId: row.employee_id,
    breakStart: row.break_start,
    breakEnd: row.break_end,
    durationSeconds: Number(row.duration_seconds ?? 0),
  };
}

/** CHECK IN */
export async function performCheckIn(params: CheckInParams): Promise<OperationResult> {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  const today = getKolkataDateString();
  const now = new Date();
  const nowIso = now.toISOString();
  const nowFormattedTime = formatKolkataTime(now);
  const db = supabase as any;

  const { data: existing, error: lookupError } = await db
    .from('attendance')
    .select('id, check_in_at, check_out_at, current_state')
    .eq('employee_id', params.employeeId)
    .eq('date', today)
    .maybeSingle();

  if (lookupError) {
    console.error('[CheckIn] Lookup failed:', lookupError);
    return { success: false, error: 'Unable to check today\'s attendance. Please try again.' };
  }

  if (existing?.check_in_at) {
    return { success: false, error: 'You have already checked in for today.' };
  }

  const { data: employeeRow, error: employeeError } = await db
    .from('employees')
    .select('shift_start')
    .eq('id', params.employeeId)
    .single();

  if (employeeError || !employeeRow) {
    return { success: false, error: 'Your employee account is not fully configured.' };
  }

  const shiftStart: string = employeeRow.shift_start ?? '09:00';
  const [hours, minutes] = shiftStart.split(':').map(Number);
  const graceMinutes = 15;
  const shiftCutoff = new Date(now);
  shiftCutoff.setHours(hours, minutes + graceMinutes, 0, 0);
  const status = now > shiftCutoff ? 'late' : 'present';

  const { data: inserted, error: insertError } = await db
    .from('attendance')
    .insert({
      employee_id: params.employeeId,
      date: today,
      mode: params.mode,
      status,
      check_in_at: nowIso,
      current_state: 'working',
      total_break_seconds: 0,
      working_seconds: 0,
    })
    .select('id, employee_id, date, mode, status, check_in_at, check_out_at, working_seconds, total_break_seconds, current_state')
    .single();

  if (insertError || !inserted) {
    console.error('[CheckIn] Insert failed:', insertError);
    return {
      success: false,
      error: insertError?.code === '23505' ? 'You have already checked in for today.' : 'Failed to record check-in. Please try again.',
    };
  }

  const record = buildWorkingRecord(
    params,
    inserted.id,
    today,
    inserted.check_in_at ?? nowIso,
    formatKolkataTime(new Date(inserted.check_in_at ?? nowIso)),
    status
  );

  const { error: eventError } = await db.from('attendance_events').insert({
    attendance_id: inserted.id,
    event_type: 'check_in',
    event_at: inserted.check_in_at ?? nowIso,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  });

  if (eventError) console.warn('[CheckIn] Event write failed:', eventError);

  return { success: true, attendanceRecord: record };
}

/** START BREAK */
export async function performStartBreak(record: AttendanceRecord, profileId: string, userRole: string): Promise<OperationResult> {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  if (record.attendanceState !== 'working') {
    return { success: false, error: 'You must be working to start a break.' };
  }

  const db = supabase as any;
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: openBreak } = await db
    .from('break_events')
    .select('id')
    .eq('attendance_id', record.id)
    .is('break_end', null)
    .limit(1)
    .maybeSingle();

  if (openBreak) return { success: false, error: 'A break is already in progress.' };

  const { data: breakRow, error: breakError } = await db
    .from('break_events')
    .insert({
      attendance_id: record.id,
      employee_id: record.employeeId,
      break_start: nowIso,
    })
    .select('id, attendance_id, employee_id, break_start, break_end, duration_seconds')
    .single();

  if (breakError || !breakRow) {
    console.error('[Break Start] Failed:', breakError);
    return { success: false, error: 'Unable to start break. Please try again.' };
  }

  const { error: stateError } = await db
    .from('attendance')
    .update({ current_state: 'on_break' })
    .eq('id', record.id)
    .eq('employee_id', record.employeeId)
    .eq('date', record.date)
    .eq('current_state', 'working')
    .is('check_out_at', null);

  if (stateError) {
    console.error('[Break Start] State update failed:', stateError);
    return { success: false, error: 'Unable to start break. Please try again.' };
  }

  const { error: eventError } = await db.from('attendance_events').insert({
    attendance_id: record.id,
    event_type: 'break_start',
    event_at: nowIso,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  });
  if (eventError) console.warn('[Break Start] Event write failed:', eventError);

  const newBreak = toBreakEvent(breakRow);
  return {
    success: true,
    attendanceRecord: {
      ...record,
      attendanceState: 'on_break',
      activeBreakStartIso: nowIso,
      breaks: [...(record.breaks ?? []), newBreak],
    },
  };
}

/** RESUME WORK */
export async function performResumeWork(record: AttendanceRecord, profileId: string, userRole: string): Promise<OperationResult> {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  if (record.attendanceState !== 'on_break' || !record.activeBreakStartIso) {
    return { success: false, error: 'You are not currently on break.' };
  }

  const db = supabase as any;
  const now = new Date();
  const nowIso = now.toISOString();
  const breakStartTime = new Date(record.activeBreakStartIso).getTime();
  const duration = Math.max(0, Math.floor((now.getTime() - breakStartTime) / 1000));
  const newTotalBreakSeconds = (record.breakSeconds ?? 0) + duration;

  const { data: updatedBreak, error: breakError } = await db
    .from('break_events')
    .update({ break_end: nowIso, duration_seconds: duration })
    .eq('attendance_id', record.id)
    .eq('break_start', record.activeBreakStartIso)
    .is('break_end', null)
    .select('id, attendance_id, employee_id, break_start, break_end, duration_seconds')
    .maybeSingle();

  if (breakError || !updatedBreak) {
    console.error('[Resume] Break update failed:', breakError);
    return { success: false, error: 'Unable to resume work. Please try again.' };
  }

  const { error: stateError } = await db
    .from('attendance')
    .update({ current_state: 'working', total_break_seconds: newTotalBreakSeconds })
    .eq('id', record.id)
    .eq('employee_id', record.employeeId)
    .eq('date', record.date)
    .eq('current_state', 'on_break')
    .is('check_out_at', null);

  if (stateError) {
    console.error('[Resume] Attendance update failed:', stateError);
    return { success: false, error: 'Unable to resume work. Please try again.' };
  }

  const { error: eventError } = await db.from('attendance_events').insert({
    attendance_id: record.id,
    event_type: 'break_end',
    event_at: nowIso,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  });
  if (eventError) console.warn('[Resume] Event write failed:', eventError);

  const updatedBreaks = (record.breaks ?? []).map((b) =>
    b.id === updatedBreak.id ? toBreakEvent(updatedBreak) : b
  );

  return {
    success: true,
    attendanceRecord: {
      ...record,
      attendanceState: 'working',
      activeBreakStartIso: null,
      breakSeconds: newTotalBreakSeconds,
      breakDuration: formatWorkingTime(newTotalBreakSeconds),
      breaks: updatedBreaks,
    },
  };
}

/** CHECK OUT */
export async function performCheckOut(record: AttendanceRecord, profileId: string, userRole: string): Promise<OperationResult> {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  if (!record.checkInIso) return { success: false, error: 'Cannot check out before checking in.' };
  if (record.attendanceState === 'completed' || record.checkOutIso) {
    return { success: false, error: 'You have already completed attendance for today.' };
  }

  const db = supabase as any;
  const now = new Date();
  const nowIso = now.toISOString();

  let totalBreakSeconds = record.breakSeconds ?? 0;
  let finalBreaks = record.breaks ?? [];

  if (record.attendanceState === 'on_break' && record.activeBreakStartIso) {
    const start = new Date(record.activeBreakStartIso).getTime();
    const duration = Math.max(0, Math.floor((now.getTime() - start) / 1000));
    totalBreakSeconds += duration;

    const { data: updatedBreak, error: breakError } = await db
      .from('break_events')
      .update({ break_end: nowIso, duration_seconds: duration })
      .eq('attendance_id', record.id)
      .eq('break_start', record.activeBreakStartIso)
      .is('break_end', null)
      .select('id, attendance_id, employee_id, break_start, break_end, duration_seconds')
      .maybeSingle();

    if (breakError || !updatedBreak) {
      return { success: false, error: 'Unable to close the active break. Please try again.' };
    }

    finalBreaks = finalBreaks.map((b) => b.id === updatedBreak.id ? toBreakEvent(updatedBreak) : b);

    const { error: breakEndEventError } = await db.from('attendance_events').insert({
      attendance_id: record.id,
      event_type: 'break_end',
      event_at: nowIso,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    });
    if (breakEndEventError) console.warn('[Checkout] Break-end event write failed:', breakEndEventError);
  }

  const checkInMs = new Date(record.checkInIso).getTime();
  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - checkInMs) / 1000));
  const actualWorkingSeconds = Math.max(0, elapsedSeconds - totalBreakSeconds);

  const { data: updated, error: checkoutError } = await db
    .from('attendance')
    .update({
      check_out_at: nowIso,
      working_seconds: actualWorkingSeconds,
      total_break_seconds: totalBreakSeconds,
      current_state: 'completed',
    })
    .eq('id', record.id)
    .eq('employee_id', record.employeeId)
    .eq('date', record.date)
    .is('check_out_at', null)
    .in('current_state', ['working', 'on_break'])
    .select('id, check_in_at, check_out_at, working_seconds, total_break_seconds, current_state')
    .maybeSingle();

  if (checkoutError || !updated) {
    console.error('[Checkout] Failed:', checkoutError);
    return { success: false, error: 'Unable to save checkout. Please try again.' };
  }

  const { error: eventError } = await db.from('attendance_events').insert({
    attendance_id: record.id,
    event_type: 'check_out',
    event_at: nowIso,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  });
  if (eventError) console.warn('[Checkout] Event write failed:', eventError);

  const checkOutDate = new Date(updated.check_out_at ?? nowIso);
  const checkInDate = new Date(updated.check_in_at ?? record.checkInIso);

  return {
    success: true,
    attendanceRecord: {
      ...record,
      checkOut: formatKolkataTime(checkOutDate),
      checkOutIso: updated.check_out_at ?? nowIso,
      attendanceState: 'completed',
      activeBreakStartIso: null,
      elapsedSeconds: Math.max(0, Math.floor((checkOutDate.getTime() - checkInDate.getTime()) / 1000)),
      breakSeconds: Number(updated.total_break_seconds ?? totalBreakSeconds),
      workingSeconds: Number(updated.working_seconds ?? actualWorkingSeconds),
      workingHours: formatWorkingTime(Number(updated.working_seconds ?? actualWorkingSeconds)),
      breakDuration: formatWorkingTime(Number(updated.total_break_seconds ?? totalBreakSeconds)),
      currentBreakSeconds: 0,
      breaks: finalBreaks,
    },
  };
}

/** Recover today's record from Supabase after refresh/re-login. */
export async function recoverTodayAttendance(
  employeeId: string,
  employeeName: string,
  employeeEmpId: string,
  department: string
): Promise<AttendanceRecord | null> {
  if (!isSupabaseConfigured) return null;

  const today = getKolkataDateString();
  try {
    const db = supabase as any;
    const { data: dbAtt, error } = await db
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('date', today)
      .maybeSingle();

    if (error) throw error;
    if (!dbAtt || !dbAtt.check_in_at) return null;

    const { data: dbBreaks, error: breaksError } = await db
      .from('break_events')
      .select('*')
      .eq('attendance_id', dbAtt.id)
      .order('break_start', { ascending: true });

    if (breaksError) throw breaksError;

    const breaks: BreakEvent[] = (dbBreaks ?? []).map((row: any) => toBreakEvent(row));
    const openBreak = breaks.find((b) => !b.breakEnd);
    const storedBreakSeconds = Number(dbAtt.total_break_seconds ?? 0);
    const completedBreakSeconds = breaks.reduce<number>(
      (sum, b) => sum + (b.breakEnd ? Number(b.durationSeconds ?? 0) : 0),
      0
    );
    const activeBreakSeconds = openBreak
      ? Math.max(0, Math.floor((Date.now() - new Date(openBreak.breakStart).getTime()) / 1000))
      : 0;
    const totalBreakSeconds = Math.max(storedBreakSeconds, completedBreakSeconds + activeBreakSeconds);

    const checkInDate = new Date(dbAtt.check_in_at);
    const checkOutDate = dbAtt.check_out_at ? new Date(dbAtt.check_out_at) : null;
    const elapsedSeconds = checkOutDate
      ? Math.max(0, Math.floor((checkOutDate.getTime() - checkInDate.getTime()) / 1000))
      : Math.max(0, Math.floor((Date.now() - checkInDate.getTime()) / 1000));

    const actualWorkingSeconds = checkOutDate
      ? Number(dbAtt.working_seconds ?? Math.max(0, elapsedSeconds - totalBreakSeconds))
      : Math.max(0, elapsedSeconds - totalBreakSeconds);

    const state: AttendanceState = checkOutDate
      ? 'completed'
      : openBreak
      ? 'on_break'
      : 'working';

    return {
      id: dbAtt.id,
      employeeId,
      employeeName,
      employeeEmpId,
      department,
      date: today,
      mode: dbAtt.mode,
      checkIn: formatKolkataTime(checkInDate),
      checkInIso: dbAtt.check_in_at,
      checkOut: checkOutDate ? formatKolkataTime(checkOutDate) : undefined,
      checkOutIso: dbAtt.check_out_at ?? undefined,
      workingSeconds: actualWorkingSeconds,
      breakSeconds: totalBreakSeconds,
      elapsedSeconds,
      workingHours: formatWorkingTime(actualWorkingSeconds),
      breakDuration: formatWorkingTime(totalBreakSeconds),
      currentBreakSeconds: activeBreakSeconds,
      status: dbAtt.status,
      attendanceState: state,
      activeBreakStartIso: openBreak?.breakStart ?? null,
      breaks,
    };
  } catch (error) {
    console.error('[Recovery] Database recovery failed:', error);
    return null;
  }
}

export function formatWorkingTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00h 00m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
}

export function formatLiveTimer(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00h 00m 00s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}
