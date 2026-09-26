import * as XLSX from 'xlsx';
import { supabase, isSupabaseConfigured } from './supabase';

export interface ExportFilters {
  startDate?: string;
  endDate?: string;
  employeeId?: string;
  month?: string; // YYYY-MM
}

export interface ExportRow {
  'Employee Name': string;
  Date: string;
  Day: string;
  'Attendance Mode': string;
  'Check-in Time': string;
  'Break Duration': string;
  'Check-out Time': string;
  'Working Hours': string;
  'Attendance Status': string;
}

function formatSeconds(seconds: number | null | undefined): string {
  const value = Math.max(0, Number(seconds ?? 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
}

function formatTime(ts: string | null): string {
  if (!ts) return '--';
  return new Date(ts).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function dayOfWeek(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
  });
}

export async function fetchAttendanceData(filters: ExportFilters): Promise<ExportRow[]> {
  if (!isSupabaseConfigured) {
    throw new Error('Unable to load attendance records right now. Please try again.');
  }

  const db = supabase as any;
  let query = db
    .from('attendance')
    .select('date, mode, status, check_in_at, check_out_at, working_seconds, total_break_seconds, employees!inner(name)')
    .order('date', { ascending: true });

  if (filters.startDate) query = query.gte('date', filters.startDate);
  if (filters.endDate) query = query.lte('date', filters.endDate);
  if (filters.employeeId) query = query.eq('employee_id', filters.employeeId);
  if (filters.month) {
    const [year, month] = filters.month.split('-').map(Number);
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(year, month, 0);
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    query = query.gte('date', start).lte('date', endDate);
  }

  const pageSize = 1000;
  const allRows: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await query.range(from, from + pageSize - 1);
    if (error) {
      console.error('[Export] Query failed:', error);
      throw new Error('Failed to load real attendance records for export.');
    }
    allRows.push(...(page ?? []));
    if (!page || page.length < pageSize) break;
  }

  return allRows.map((row: any) => ({
    'Employee Name': row.employees?.name ?? 'Employee',
    Date: formatDate(row.date),
    Day: dayOfWeek(row.date),
    'Attendance Mode': row.mode === 'wfh' ? 'WFH' : row.mode === 'office' ? 'Office' : '--',
    'Check-in Time': formatTime(row.check_in_at),
    'Break Duration': formatSeconds(row.total_break_seconds),
    'Check-out Time': formatTime(row.check_out_at),
    'Working Hours': formatSeconds(row.working_seconds),
    'Attendance Status': String(row.status ?? '--').replace(/^./, (c: string) => c.toUpperCase()),
  }));
}

export function rowsToWorkbook(rows: ExportRow[], filters: ExportFilters) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 14 },
    { wch: 15 }, { wch: 14 }, { wch: 16 }, { wch: 18 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');

  const summary = [
    { Field: 'Report Generated', Value: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) },
    { Field: 'Total Records', Value: rows.length },
    { Field: 'Period', Value: filters.month ?? (filters.startDate && filters.endDate ? `${filters.startDate} to ${filters.endDate}` : 'All dates') },
    { Field: 'Present', Value: rows.filter((r) => r['Attendance Status'] === 'Present').length },
    { Field: 'Late', Value: rows.filter((r) => r['Attendance Status'] === 'Late').length },
    { Field: 'WFH', Value: rows.filter((r) => r['Attendance Mode'] === 'WFH').length },
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), 'Summary');
  return workbook;
}

export async function exportToExcel(filters: ExportFilters, filename?: string): Promise<void> {
  const rows = await fetchAttendanceData(filters);
  if (!rows.length) throw new Error('No real attendance records found for the selected period.');
  const workbook = rowsToWorkbook(rows, filters);
  XLSX.writeFile(workbook, filename ?? 'attendance-report.xlsx');
}

export async function exportMonthlyReport(employeeId: string | null, month: string): Promise<void> {
  await exportToExcel({ month, ...(employeeId ? { employeeId } : {}) }, `attendance-${month}.xlsx`);
}
