import { supabase, isSupabaseConfigured } from './supabase';
import type { AttendanceMode, AttendanceRecord, BreakEvent, AttendanceState } from '../types/attendance';
import { formatKolkataTime, getKolkataDateString } from './workingDays';

interface Result {
  success: boolean;
  error?: string;
  attendanceRecord?: AttendanceRecord;
}

function toBreak(row: any): BreakEvent {
  return {
    id: row.id,
    attendanceId: row.attendance_id,
    employeeId: row.employee_id,
    breakStart: row.break_start,
    breakEnd: row.break_end,
    durationSeconds: row.duration_seconds == null ? undefined : Number(row.duration_seconds),
  };
}

function emptyResult(): Result | null {
  return isSupabaseConfigured ? null : { success: false, error: 'Database is not configured.' };
}

function buildRecord(row: any, employeeName: string, empId: string, department: string, breaks: BreakEvent[] = []): AttendanceRecord {
  const checkIn = row.check_in_at ? new Date(row.check_in_at) : null;
  const checkOut = row.check_out_at ? new Date(row.check_out_at) : null;
  const storedBreak = Number(row.total_break_seconds ?? 0);
  const openBreak = breaks.find((b) => !b.breakEnd);
  const openBreakSeconds = openBreak
    ? Math.max(0, Math.floor((Date.now() - new Date(openBreak.breakStart).getTime()) / 1000))
    : 0;
  const completedBreak = breaks.reduce((sum, b) => sum + (b.breakEnd ? Number(b.durationSeconds ?? 0) : 0), 0);
  const totalBreak = Math.max(storedBreak, completedBreak + openBreakSeconds);
  const elapsed = checkIn
    ? Math.max(0, Math.floor(((checkOut ?? new Date()).getTime() - checkIn.getTime()) / 1000))
    : 0;
  const working = checkOut
    ? Number(row.working_seconds ?? Math.max(0, elapsed - totalBreak))
    : Math.max(0, elapsed - totalBreak);
  const state: AttendanceState =
    row.current_state === 'completed' || checkOut ? 'completed' :
    openBreak ? 'on_break' :
    checkIn ? 'working' :
    'not_checked_in';

  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName,
    employeeEmpId: empId,
    department,
    date: row.date,
    mode: row.mode,
    checkIn: checkIn ? formatKolkataTime(checkIn) : undefined,
    checkOut: checkOut ? formatKolkataTime(checkOut) : undefined,
    checkInIso: row.check_in_at ?? undefined,
    checkOutIso: row.check_out_at ?? undefined,
    workingSeconds: working,
    breakSeconds: totalBreak,
    elapsedSeconds: elapsed,
    currentBreakSeconds: openBreakSeconds,
    workingHours: formatWorkingTime(working),
    breakDuration: formatWorkingTime(totalBreak),
    status: row.status,
    attendanceState: state,
    activeBreakStartIso: openBreak?.breakStart ?? null,
    breaks,
    notes: row.notes ?? undefined,
  };
}

export async function fetchAttendanceRecord(employeeId: string, date = getKolkataDateString()): Promise<AttendanceRecord | null> {
  const unavailable = emptyResult();
  if (unavailable) return null;

  const db = supabase as any;
  const { data: row, error } = await db
    .from('attendance')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('date', date)
    .maybeSingle();

  if (error || !row) return null;

  const { data: breaks } = await db
    .from('break_events')
    .select('id,attendance_id,employee_id,break_start,break_end,duration_seconds')
    .eq('attendance_id', row.id)
    .order('break_start', { ascending: true });

  const [{ data: emp }, { data: dept }] = await Promise.all([
    db.from('employees').select('name,emp_id,department_id').eq('id', employeeId).maybeSingle(),
    db.from('employees').select('department_id').eq('id', employeeId).maybeSingle(),
  ]);

  let department = '';
  if (dept?.department_id) {
    const { data: d } = await db.from('departments').select('name').eq('id', dept.department_id).maybeSingle();
    department = d?.name ?? '';
  }

  return buildRecord(row, emp?.name ?? '', emp?.emp_id ?? '', department, (breaks ?? []).map(toBreak));
}

export async function recoverTodayAttendance(
  employeeId: string,
  employeeName: string,
  employeeEmpId: string,
  department: string
): Promise<AttendanceRecord | null> {
  const unavailable = emptyResult();
  if (unavailable) return null;

  const today = getKolkataDateString();
  const db = supabase as any;
  const { data: row, error } = await db
    .from('attendance')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('date', today)
    .maybeSingle();

  if (error || !row) return null;

  const { data: breaks, error: breaksError } = await db
    .from('break_events')
    .select('id,attendance_id,employee_id,break_start,break_end,duration_seconds')
    .eq('attendance_id', row.id)
    .order('break_start', { ascending: true });

  if (breaksError) return null;
  return buildRecord(row, employeeName, employeeEmpId, department, (breaks ?? []).map(toBreak));
}

/**
 * Check-in is intentionally a single database insert. The database trigger
 * sets the authoritative IST date/time, validates Sunday/holiday/leave/WFH,
 * enforces remote employees as WFH and writes the event trail.
 */
export async function performCheckIn(params: {
  employeeId: string;
  mode: AttendanceMode;
}): Promise<Result> {
  const unavailable = emptyResult();
  if (unavailable) return unavailable;

  const db = supabase as any;
  const { data, error } = await db
    .from('attendance')
    .insert({
      employee_id: params.employeeId,
      date: getKolkataDateString(),
      mode: params.mode,
    })
    .select('*')
    .single();

  if (error || !data) {
    console.error('[Attendance] Check-in failed', error);
    if (error?.code === '23505') return { success: false, error: 'You have already checked in for today.' };
    return { success: false, error: error?.message ?? 'Unable to record check-in.' };
  }

  const record = await recoverTodayAttendance(params.employeeId, '', '', '');
  return { success: true, attendanceRecord: record ?? buildRecord(data, '', '', '') };
}

export async function performStartBreak(record: AttendanceRecord): Promise<Result> {
  const unavailable = emptyResult();
  if (unavailable) return unavailable;
  if (record.attendanceState !== 'working') return { success: false, error: 'You must be working to start a break.' };

  const db = supabase as any;
  const { data, error } = await db
    .from('break_events')
    .insert({
      attendance_id: record.id,
      employee_id: record.employeeId,
    })
    .select('*')
    .single();

  if (error || !data) {
    console.error('[Attendance] Start break failed', error);
    return { success: false, error: error?.message ?? 'Unable to start break.' };
  }

  return {
    success: true,
    attendanceRecord: {
      ...record,
      attendanceState: 'on_break',
      activeBreakStartIso: data.break_start,
      breaks: [...(record.breaks ?? []), toBreak(data)],
    },
  };
}

export async function performResumeWork(record: AttendanceRecord): Promise<Result> {
  const unavailable = emptyResult();
  if (unavailable) return unavailable;
  if (record.attendanceState !== 'on_break' || !record.activeBreakStartIso) {
    return { success: false, error: 'You are not currently on break.' };
  }

  const db = supabase as any;
  const { data, error } = await db
    .from('break_events')
    .update({ break_end: new Date().toISOString() })
    .eq('attendance_id', record.id)
    .eq('break_start', record.activeBreakStartIso)
    .is('break_end', null)
    .select('*')
    .maybeSingle();

  if (error || !data) {
    console.error('[Attendance] Resume failed', error);
    return { success: false, error: error?.message ?? 'Unable to resume work.' };
  }

  const updatedBreak = toBreak(data);
  return {
    success: true,
    attendanceRecord: {
      ...record,
      attendanceState: 'working',
      activeBreakStartIso: null,
      breakSeconds: (record.breakSeconds ?? 0) + Number(updatedBreak.durationSeconds ?? 0),
      breakDuration: formatWorkingTime((record.breakSeconds ?? 0) + Number(updatedBreak.durationSeconds ?? 0)),
      currentBreakSeconds: 0,
      breaks: (record.breaks ?? []).map((b) => b.id === updatedBreak.id ? updatedBreak : b),
    },
  };
}

/**
 * Checkout is a state transition. The DB trigger rejects duplicate checkout
 * and rejects checkout while a break is open, then stamps checkout_at in IST
 * and calculates working_seconds authoritatively.
 */
export async function performCheckOut(record: AttendanceRecord): Promise<Result> {
  const unavailable = emptyResult();
  if (unavailable) return unavailable;
  if (record.attendanceState !== 'working') {
    return { success: false, error: record.attendanceState === 'on_break' ? 'Resume work before checking out.' : 'You cannot check out right now.' };
  }

  const db = supabase as any;
  const { data, error } = await db
    .from('attendance')
    .update({ current_state: 'completed' })
    .eq('id', record.id)
    .eq('employee_id', record.employeeId)
    .eq('current_state', 'working')
    .is('check_out_at', null)
    .select('*')
    .maybeSingle();

  if (error || !data) {
    console.error('[Attendance] Check-out failed', error);
    return { success: false, error: error?.message ?? 'Unable to record check-out.' };
  }

  const recovered = await recoverTodayAttendance(record.employeeId, record.employeeName, record.employeeEmpId, record.department);
  return { success: true, attendanceRecord: recovered ?? buildRecord(data, record.employeeName, record.employeeEmpId, record.department) };
}

export function formatWorkingTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${String(Math.floor(safe / 3600)).padStart(2, '0')}h ${String(Math.floor((safe % 3600) / 60)).padStart(2, '0')}m`;
}

export function formatLiveTimer(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${String(Math.floor(safe / 3600)).padStart(2, '0')}h ${String(Math.floor((safe % 3600) / 60)).padStart(2, '0')}m ${String(safe % 60).padStart(2, '0')}s`;
}
