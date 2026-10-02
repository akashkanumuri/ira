import { supabase } from './supabase';
import type {
  AssignmentRule,
  AttendanceRecord,
  Department,
  Designation,
  Employee,
  EmployeeDocument,
  Holiday,
  LeaveLedger,
  LeaveRequest,
  PayrollPeriod,
  PayrollRecord,
  Task,
  WfhRequest,
} from '../types/attendance';

export const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function money(value: number | null | undefined) {
  return INR.format(Number(value ?? 0));
}

export function duration(seconds: number | null | undefined) {
  const s = Math.max(0, Math.floor(Number(seconds ?? 0)));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

export function dateLabel(date: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...options,
  });
}

export async function invokeEmployeeAdmin(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('employee-admin', { body });
  if (error) {
    let message = error.message || 'Employee action failed.';
    try {
      const response = (error as any).context as Response | undefined;
      if (response) {
        const payload = await response.clone().json().catch(() => null);
        if (payload?.error) message = String(payload.error);
      }
    } catch {
      // Keep the SDK message when the response body cannot be read.
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(String(data.error));
  return data;
}

export async function uploadAvatar(employeeId: string, file: File) {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'jpg';
  const path = `${employeeId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' });
  if (error) throw new Error(error.message);
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

export async function uploadEmployeeDocument(employeeId: string, file: File, documentType: string) {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${employeeId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from('hr-documents').upload(path, file, {
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) throw new Error(error.message);

  const { data, error: rowError } = await (supabase as any)
    .from('employee_documents')
    .insert({
      employee_id: employeeId,
      document_type: documentType,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    .select('*')
    .single();

  if (rowError || !data) {
    await supabase.storage.from('hr-documents').remove([path]);
    throw new Error(rowError?.message || 'Document record failed.');
  }
  return {
    id: data.id,
    employeeId,
    documentType,
    fileName: data.file_name,
    storagePath: data.storage_path,
    mimeType: data.mime_type,
    sizeBytes: data.size_bytes,
    createdAt: data.created_at,
  } as EmployeeDocument;
}

export async function getSignedDocumentUrl(path: string) {
  const { data, error } = await supabase.storage.from('hr-documents').createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export function mapEmployee(row: any, maps: {
  departments?: Map<string, string>;
  designations?: Map<string, string>;
  managers?: Map<string, string>;
  salary?: Map<string, number>;
} = {}): Employee {
  return {
    id: row.id,
    profileId: row.profile_id,
    empId: row.emp_id,
    loginId: row.login_id,
    name: row.name,
    email: row.work_email ?? '',
    workEmail: row.work_email ?? null,
    phone: row.phone ?? undefined,
    status: row.status,
    workMode: row.work_mode,
    avatar: row.avatar_url ?? '',
    department: maps.departments?.get(row.department_id) ?? '',
    departmentId: row.department_id,
    designation: maps.designations?.get(row.designation_id) ?? '',
    designationId: row.designation_id,
    manager: maps.managers?.get(row.manager_id) ?? null,
    managerId: row.manager_id,
    role: 'employee',
    shift: row.shift_start ?? undefined,
    shiftEnd: row.shift_end ?? undefined,
    joinDate: row.join_date,
    currentSalary: maps.salary?.get(row.id),
  };
}

export function mapAttendance(row: any, employeeMap: Map<string, Employee>, breaksByAttendance: Map<string, any[]> = new Map()): AttendanceRecord {
  const employee = employeeMap.get(row.employee_id);
  const checkIn = row.check_in_at ? new Date(row.check_in_at) : null;
  const checkOut = row.check_out_at ? new Date(row.check_out_at) : null;
  const breaks = (breaksByAttendance.get(row.id) ?? []).map((b: any) => ({
    id: b.id,
    attendanceId: b.attendance_id,
    employeeId: b.employee_id,
    breakStart: b.break_start,
    breakEnd: b.break_end,
    durationSeconds: b.duration_seconds == null ? undefined : Number(b.duration_seconds),
  }));
  const open = breaks.find((b: any) => !b.breakEnd);
  const activeBreak = open ? Math.floor((Date.now() - new Date(open.breakStart).getTime()) / 1000) : 0;
  const completedBreak = breaks.reduce((sum: number, b: any) => sum + Number(b.durationSeconds ?? 0), 0);
  const totalBreak = Math.max(Number(row.total_break_seconds ?? 0), completedBreak);
  const elapsed = checkIn ? Math.max(0, Math.floor(((checkOut ?? new Date()).getTime() - checkIn.getTime()) / 1000)) : 0;
  const working = checkOut
    ? Number(row.working_seconds ?? Math.max(0, elapsed - totalBreak))
    : Math.max(0, elapsed - totalBreak);

  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: employee?.name ?? '',
    employeeEmpId: employee?.empId ?? '',
    department: employee?.department ?? '',
    date: row.date,
    mode: row.mode,
    checkIn: checkIn?.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }),
    checkOut: checkOut?.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }),
    checkInIso: row.check_in_at ?? undefined,
    checkOutIso: row.check_out_at ?? undefined,
    workingSeconds: working,
    breakSeconds: totalBreak,
    elapsedSeconds: elapsed,
    currentBreakSeconds: activeBreak,
    workingHours: duration(working),
    breakDuration: duration(totalBreak),
    status: row.status,
    attendanceState: row.current_state,
    activeBreakStartIso: open?.breakStart ?? null,
    breaks,
    notes: row.notes ?? undefined,
  };
}

export function mapTask(row: any, employees: Map<string, Employee>): Task {
  const to = employees.get(row.assigned_to);
  const by = row.assigned_by ? employees.get(row.assigned_by) : undefined;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    assignedTo: row.assigned_to,
    assignedToName: to?.name ?? 'Employee',
    assignedToDesignation: to?.designation,
    assignedBy: row.assigned_by,
    assignedByName: by?.name ?? (row.assigned_by ? 'Employee' : 'Admin'),
    startDate: row.start_date,
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    submittedLink: row.submitted_link,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapHoliday(row: any): Holiday {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    dayOfWeek: new Date(`${row.date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long' }),
    description: row.description ?? '',
  };
}

export function mapLeave(row: any, employees: Map<string, Employee>): LeaveRequest {
  const emp = employees.get(row.employee_id);
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: emp?.name ?? '',
    department: emp?.department ?? '',
    leaveType: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    duration: row.duration === 'half' ? 'half' : 'full',
    days: Number(row.days ?? 0),
    paidDays: Number(row.paid_days ?? 0),
    unpaidDays: Number(row.unpaid_days ?? 0),
    reason: row.reason,
    status: row.status,
    requestedOn: row.created_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
  };
}

export function mapWfh(row: any, employees: Map<string, Employee>): WfhRequest {
  const emp = employees.get(row.employee_id);
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: emp?.name ?? '',
    department: emp?.department ?? '',
    date: row.date,
    duration: row.duration,
    reason: row.reason,
    note: row.note,
    requestedOn: row.created_at,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
  };
}

export function mapLedger(row: any): LeaveLedger {
  return {
    id: row.id,
    employeeId: row.employee_id,
    periodStart: row.period_start,
    openingBalance: Number(row.opening_balance ?? 0),
    accrual: Number(row.accrual ?? 0),
    adjustment: Number(row.adjustment ?? 0),
    paidUsed: Number(row.paid_used ?? 0),
    unpaidUsed: Number(row.unpaid_used ?? 0),
    closingBalance: Number(row.closing_balance ?? 0),
  };
}

export function mapPayrollPeriod(row: any): PayrollPeriod {
  return {
    id: row.id,
    monthStart: row.month_start,
    divisorMode: row.divisor_mode,
    dayDivisor: Number(row.day_divisor),
    status: row.status,
    finalizedAt: row.finalized_at,
  };
}

export function mapPayrollRecord(row: any, employees: Map<string, Employee>): PayrollRecord {
  return {
    id: row.id,
    periodId: row.period_id,
    employeeId: row.employee_id,
    employeeName: employees.get(row.employee_id)?.name ?? '',
    salarySnapshot: Number(row.salary_snapshot ?? 0),
    paidLeaveDays: Number(row.paid_leave_days ?? 0),
    unpaidLeaveDays: Number(row.unpaid_leave_days ?? 0),
    dailyRate: Number(row.daily_rate ?? 0),
    leaveDeduction: Number(row.leave_deduction ?? 0),
    finalPay: Number(row.final_pay ?? 0),
    finalizedAt: row.finalized_at,
  };
}

export function mapRule(row: any, designations: Map<string, string>): AssignmentRule {
  return {
    id: row.id,
    assignerDesignationId: row.assigner_designation_id,
    assignerDesignation: designations.get(row.assigner_designation_id) ?? '',
    assigneeDesignationId: row.assignee_designation_id,
    assigneeDesignation: row.assignee_designation_id ? (designations.get(row.assignee_designation_id) ?? '') : 'Any designation',
    scope: row.scope,
  };
}

export const ALL_DOCUMENT_TYPES = ['Aadhaar', 'PAN', 'Bank Document', 'Relieving Letter', 'Payslip', 'Other'];

export { type Department, type Designation };
