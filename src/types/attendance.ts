export type UserRole = 'employee' | 'admin';
export type AttendanceMode = 'office' | 'wfh';
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'wfh' | 'leave' | 'holiday';
export type AttendanceState = 'not_checked_in' | 'working' | 'on_break' | 'completed';
export type RequestStatus = 'pending' | 'approved' | 'rejected';
export type WorkMode = 'office' | 'remote';
export type TaskStatus = 'assigned' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Department {
  id: string;
  name: string;
}

export interface Designation {
  id: string;
  name: string;
  canAssignTasks: boolean;
}

export interface Employee {
  id: string;
  profileId?: string | null;
  empId: string;
  loginId?: string;
  name: string;
  email: string;
  workEmail?: string | null;
  avatar: string;
  department: string;
  departmentId?: string | null;
  designation: string;
  designationId?: string | null;
  role: UserRole;
  phone?: string;
  manager?: string | null;
  managerId?: string | null;
  shift?: string;
  shiftEnd?: string;
  joinDate?: string;
  status: 'active' | 'inactive';
  workMode?: WorkMode;
  wfhBalance?: number;
  leaveBalance?: number;
  currentSalary?: number;
}

export interface BreakEvent {
  id: string;
  attendanceId: string;
  employeeId: string;
  breakStart: string;
  breakEnd?: string | null;
  durationSeconds?: number;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmpId: string;
  department: string;
  date: string;
  mode: AttendanceMode;
  checkIn?: string;
  checkOut?: string;
  checkInIso?: string;
  checkOutIso?: string;
  workingHours?: string;
  breakDuration?: string;
  workingSeconds?: number;
  breakSeconds?: number;
  elapsedSeconds?: number;
  currentBreakSeconds?: number;
  status: AttendanceStatus;
  attendanceState?: AttendanceState;
  activeBreakStartIso?: string | null;
  breaks?: BreakEvent[];
  notes?: string;
}

export interface WfhRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  date: string;
  duration: 'full' | 'half' | 'full_day' | 'half_day';
  reason: string;
  note?: string;
  requestedOn: string;
  status: RequestStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  leaveType: 'casual' | 'sick' | 'earned' | 'unpaid' | string;
  startDate: string;
  endDate: string;
  duration: 'full' | 'half';
  days: number;
  paidDays?: number;
  unpaidDays?: number;
  reason: string;
  status: RequestStatus;
  requestedOn: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export interface CorrectionRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  date: string;
  originalCheckIn: string;
  originalCheckOut: string;
  requestedCheckIn: string;
  requestedCheckOut: string;
  reason: string;
  status: RequestStatus;
  requestedOn: string;
  reviewNote?: string;
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  dayOfWeek: string;
  description: string;
  mandatory?: boolean;
}

export interface AuthSession {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  loginTime: string;
  logoutTime?: string | null;
  sessionDuration?: string | null;
  userAgent?: string | null;
  sessionStatus: 'active' | 'ended' | 'expired';
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  assignedTo: string;
  assignedToName: string;
  assignedToDesignation?: string;
  assignedBy?: string | null;
  assignedByName?: string | null;
  startDate: string;
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  submittedLink?: string | null;
  submittedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveLedger {
  id: string;
  employeeId: string;
  periodStart: string;
  openingBalance: number;
  accrual: number;
  adjustment: number;
  paidUsed: number;
  unpaidUsed: number;
  closingBalance: number;
}

export interface PayrollPeriod {
  id: string;
  monthStart: string;
  divisorMode: 'calendar_days' | 'working_days';
  dayDivisor: number;
  status: 'draft' | 'finalized';
  finalizedAt?: string | null;
}

export interface PayrollRecord {
  id: string;
  periodId: string;
  employeeId: string;
  employeeName: string;
  salarySnapshot: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  dailyRate: number;
  leaveDeduction: number;
  finalPay: number;
  finalizedAt?: string | null;
}

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  documentType: string;
  fileName: string;
  storagePath: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt: string;
}

export interface AssignmentRule {
  id: string;
  assignerDesignationId: string;
  assignerDesignation: string;
  assigneeDesignationId?: string | null;
  assigneeDesignation: string;
  scope: 'any' | 'direct_reports';
}
