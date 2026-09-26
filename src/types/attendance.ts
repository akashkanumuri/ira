export type UserRole = 'employee' | 'admin';
export type AttendanceMode = 'office' | 'wfh';
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'wfh' | 'leave' | 'holiday';
export type AttendanceState = 'not_checked_in' | 'working' | 'on_break' | 'completed';
export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface Employee {
  id: string;
  empId: string;
  name: string;
  email: string;
  avatar: string;
  department: string;
  designation: string;
  role: UserRole;
  phone?: string;
  manager?: string;
  shift?: string;
  joinDate?: string;
  status: 'active' | 'inactive';
  wfhBalance?: number;
  leaveBalance?: number;
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
  duration: 'full_day' | 'half_day';
  reason: string;
  note?: string;
  requestedOn: string;
  status: RequestStatus;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  leaveType: 'casual' | 'sick' | 'earned' | 'unpaid';
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: RequestStatus;
  requestedOn: string;
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
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  dayOfWeek: string;
  description: string;
  mandatory: boolean;
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
