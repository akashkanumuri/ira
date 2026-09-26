import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  UserRole,
  Employee,
  AttendanceRecord,
  WfhRequest,
  LeaveRequest,
  CorrectionRequest,
  Holiday,
  AttendanceMode,
  AuthSession,
} from './types/attendance';
import { useAuth } from './contexts/AuthContext';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { getKolkataDateString } from './lib/workingDays';
import {
  performCheckIn,
  performStartBreak,
  performResumeWork,
  performCheckOut,
  recoverTodayAttendance,
  formatWorkingTime,
} from './lib/attendance';
import { mapAuthSession } from './lib/session';

import { EmployeeLoginScreen, AdminLoginScreen } from './components/auth/PortalLoginScreen';
import { Header } from './components/common/Header';
import { Sidebar } from './components/common/Sidebar';
import { MobileNavBar } from './components/mobile/MobileNavBar';

import { EmployeeDashboard } from './components/employee/EmployeeDashboard';
import { MyAttendanceCalendar } from './components/employee/MyAttendanceCalendar';
import { WfhRequestView } from './components/employee/WfhRequestView';
import { LeaveRequestView } from './components/employee/LeaveRequestView';
import { CorrectionsView } from './components/employee/CorrectionsView';
import { EmployeeHolidaysView } from './components/employee/EmployeeHolidaysView';

import { AdminDashboard } from './components/admin/AdminDashboard';
import { AdminAttendanceTable } from './components/admin/AdminAttendanceTable';
import { WfhManagementView } from './components/admin/WfhManagementView';
import { LeaveManagementView } from './components/admin/LeaveManagementView';
import { RegularizationView } from './components/admin/RegularizationView';
import { EmployeeDirectoryView } from './components/admin/EmployeeDirectoryView';
import { ExcelExportView } from './components/admin/ExcelExportView';
import { HolidaysView } from './components/admin/HolidaysView';

function toEmployee(row: any): Employee {
  return {
    id: row.id,
    empId: row.emp_id ?? '',
    name: row.name ?? 'Employee',
    email: row.email ?? '',
    avatar: row.avatar_url ?? '',
    department: row.departments?.name ?? row.department ?? '',
    designation: row.designation ?? '',
    role: row.role ?? 'employee',
    phone: row.phone ?? '',
    manager: row.manager ?? '',
    shift: row.shift_start ?? '',
    joinDate: row.join_date ?? '',
    status: row.status ?? 'active',
    wfhBalance: Number(row.wfh_balance ?? 0),
    leaveBalance: Number(row.leave_balance ?? 0),
  };
}

function toAttendanceRecord(row: any, employeeName?: string, employeeEmpId?: string, department?: string): AttendanceRecord {
  const checkIn = row.check_in_at ? new Date(row.check_in_at) : null;
  const checkOut = row.check_out_at ? new Date(row.check_out_at) : null;
  const elapsedSeconds = checkIn
    ? Math.max(0, Math.floor(((checkOut ?? new Date()).getTime() - checkIn.getTime()) / 1000))
    : 0;
  const breakSeconds = Number(row.total_break_seconds ?? 0);
  const workingSeconds = Number(row.working_seconds ?? Math.max(0, elapsedSeconds - breakSeconds));

  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: employeeName ?? row.employees?.name ?? 'Employee',
    employeeEmpId: employeeEmpId ?? row.employees?.emp_id ?? row.employee_emp_id ?? '',
    department: department ?? row.employees?.departments?.name ?? row.department ?? '',
    date: row.date,
    mode: row.mode ?? 'office',
    checkIn: checkIn ? checkIn.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) : undefined,
    checkInIso: row.check_in_at ?? undefined,
    checkOut: checkOut ? checkOut.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) : undefined,
    checkOutIso: row.check_out_at ?? undefined,
    workingHours: formatWorkingTime(workingSeconds),
    breakDuration: formatWorkingTime(breakSeconds),
    workingSeconds,
    breakSeconds,
    elapsedSeconds,
    currentBreakSeconds: 0,
    status: row.status,
    attendanceState: row.current_state ?? (row.check_out_at ? 'completed' : row.check_in_at ? 'working' : 'not_checked_in'),
    activeBreakStartIso: null,
    breaks: [],
    notes: row.notes ?? undefined,
  };
}

function toHoliday(row: any): Holiday {
  const date = row.date as string;
  return {
    id: row.id,
    name: row.name,
    date,
    dayOfWeek: new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long' }),
    description: row.description ?? '',
    mandatory: Boolean(row.mandatory),
  };
}

export default function App() {
  const { user, loading: authLoading, signOut } = useAuth();
  const activeRole: UserRole = user?.role ?? 'employee';
  const isLoggedIn = Boolean(user);
  const isAdminPath = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');

  const [activeTab, setActiveTab] = useState(activeRole === 'admin' ? 'admin-dashboard' : 'emp-dashboard');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord[]>([]);
  const [adminAttendanceHistory, setAdminAttendanceHistory] = useState<AttendanceRecord[]>([]);
  const [attendanceHistory, setAttendanceHistory] = useState<AttendanceRecord[]>([]);
  const [wfhRequests, setWfhRequests] = useState<WfhRequest[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [correctionRequests, setCorrectionRequests] = useState<CorrectionRequest[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loginSessions, setLoginSessions] = useState<AuthSession[]>([]);

  useEffect(() => {
    setActiveTab(activeRole === 'admin' ? 'admin-dashboard' : 'emp-dashboard');
  }, [activeRole]);

  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const wantsAdmin = activeRole === 'admin';
    const shouldBeAdminPath = wantsAdmin && !window.location.pathname.startsWith('/admin');
    const shouldBeEmployeePath = !wantsAdmin && window.location.pathname.startsWith('/admin');
    if (shouldBeAdminPath) window.location.replace('/admin/login');
    else if (shouldBeEmployeePath) window.location.replace('/login');
  }, [user?.id, activeRole]);

  const currentUser: Employee = useMemo(() => ({
    id: user?.employeeDbId ?? user?.id ?? '',
    empId: user?.empId ?? '',
    name: user?.name ?? '',
    email: user?.email ?? '',
    avatar: user?.avatar ?? '',
    department: user?.department ?? '',
    designation: user?.designation ?? '',
    role: activeRole,
    phone: user?.phone ?? '',
    manager: user?.manager ?? '',
    shift: user?.shift ?? '',
    joinDate: '',
    status: user?.status ?? 'active',
    wfhBalance: 0,
    leaveBalance: 0,
  }), [user, activeRole]);

  const currentTodayRecord = useMemo(() => {
    const today = getKolkataDateString();
    return todayAttendance.find((r) => r.employeeId === currentUser.id && r.date === today) ?? null;
  }, [todayAttendance, currentUser.id]);

  const loadRecords = useCallback(async () => {
    if (!isSupabaseConfigured || !user) return;
    const db = supabase as any;
    const today = getKolkataDateString();

    if (activeRole === 'admin') {
      const [employeeResult, attendanceResult, wfhResult, leaveResult, correctionResult, holidayResult] = await Promise.all([
        db.from('employees').select('*, departments(name)').order('name', { ascending: true }),
        db.from('attendance').select('*, employees(name, emp_id, departments(name))').order('date', { ascending: false }).order('check_in_at', { ascending: true }).limit(2000),
        db.from('wfh_requests').select('*, employees(name)').order('created_at', { ascending: false }),
        db.from('leave_requests').select('*, employees(name)').order('created_at', { ascending: false }),
        db.from('regularization_requests').select('*, employees(name)').order('created_at', { ascending: false }),
        db.from('holidays').select('*').order('date', { ascending: true }),
      ]);

      if (employeeResult.error) console.error('[Admin] Employee load failed:', employeeResult.error);
      if (attendanceResult.error) console.error('[Admin] Attendance load failed:', attendanceResult.error);
      if (employeeResult.data) setEmployees(employeeResult.data.map(toEmployee));
      if (attendanceResult.data) {
        const history = attendanceResult.data.map((row: any) => toAttendanceRecord(row));
        setAdminAttendanceHistory(history);
        setTodayAttendance(history.filter((record: AttendanceRecord) => record.date === today));
      }
      if (holidayResult.data) setHolidays(holidayResult.data.map(toHoliday));
      if (wfhResult.data) setWfhRequests(wfhResult.data.map((row: any) => ({
        id: row.id,
        employeeId: row.employee_id,
        employeeName: row.employees?.name ?? 'Employee',
        department: '',
        date: row.date,
        duration: row.duration,
        reason: row.reason,
        note: row.note ?? undefined,
        requestedOn: row.created_at,
        status: row.status,
        reviewedBy: row.reviewed_by ?? undefined,
        reviewedAt: row.reviewed_at ?? undefined,
      })));
      if (leaveResult.data) setLeaveRequests(leaveResult.data.map((row: any) => ({
        id: row.id,
        employeeId: row.employee_id,
        employeeName: row.employees?.name ?? 'Employee',
        department: '',
        leaveType: row.leave_type,
        startDate: row.start_date,
        endDate: row.end_date,
        days: row.days,
        reason: row.reason,
        status: row.status,
        requestedOn: row.created_at,
      })));
      if (correctionResult.data) setCorrectionRequests(correctionResult.data.map((row: any) => ({
        id: row.id,
        employeeId: row.employee_id,
        employeeName: row.employees?.name ?? 'Employee',
        department: '',
        date: row.date,
        originalCheckIn: row.original_check_in ?? '',
        originalCheckOut: row.original_check_out ?? '',
        requestedCheckIn: row.requested_check_in,
        requestedCheckOut: row.requested_check_out,
        reason: row.reason,
        status: row.status,
        requestedOn: row.created_at,
      })));
    } else if (user.employeeDbId) {
      const [attendanceResult, wfhResult, leaveResult, correctionResult, holidayResult, sessionResult] = await Promise.all([
        db.from('attendance').select('*').eq('employee_id', user.employeeDbId).order('date', { ascending: false }).limit(370),
        db.from('wfh_requests').select('*').eq('employee_id', user.employeeDbId).order('created_at', { ascending: false }),
        db.from('leave_requests').select('*').eq('employee_id', user.employeeDbId).order('created_at', { ascending: false }),
        db.from('regularization_requests').select('*').eq('employee_id', user.employeeDbId).order('created_at', { ascending: false }),
        db.from('holidays').select('*').order('date', { ascending: true }),
        db.from('auth_sessions').select('*').eq('user_id', user.id).order('login_at', { ascending: false }).limit(50),
      ]);

      if (attendanceResult.data) {
        const history = attendanceResult.data.map((row: any) => toAttendanceRecord(row, currentUser.name, currentUser.empId, currentUser.department));
        setAttendanceHistory(history);
        setTodayAttendance(history.filter((record: AttendanceRecord) => record.date === today));
      }
      if (holidayResult.data) setHolidays(holidayResult.data.map(toHoliday));
      if (sessionResult.data) setLoginSessions(sessionResult.data.map((row: any) => mapAuthSession(row, currentUser.name, activeRole)));
      if (wfhResult.data) setWfhRequests(wfhResult.data.map((row: any) => ({
        id: row.id, employeeId: row.employee_id, employeeName: currentUser.name, department: currentUser.department ?? '',
        date: row.date, duration: row.duration, reason: row.reason, note: row.note ?? undefined,
        requestedOn: row.created_at, status: row.status, reviewedBy: row.reviewed_by ?? undefined, reviewedAt: row.reviewed_at ?? undefined,
      })));
      if (leaveResult.data) setLeaveRequests(leaveResult.data.map((row: any) => ({
        id: row.id, employeeId: row.employee_id, employeeName: currentUser.name, department: currentUser.department ?? '',
        leaveType: row.leave_type, startDate: row.start_date, endDate: row.end_date, days: row.days,
        reason: row.reason, status: row.status, requestedOn: row.created_at,
      })));
      if (correctionResult.data) setCorrectionRequests(correctionResult.data.map((row: any) => ({
        id: row.id, employeeId: row.employee_id, employeeName: currentUser.name, department: currentUser.department ?? '',
        date: row.date, originalCheckIn: row.original_check_in ?? '', originalCheckOut: row.original_check_out ?? '',
        requestedCheckIn: row.requested_check_in, requestedCheckOut: row.requested_check_out, reason: row.reason,
        status: row.status, requestedOn: row.created_at,
      })));
    }
  }, [activeRole, currentUser.department, currentUser.empId, currentUser.name, user]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;
    void loadRecords();
  }, [user?.id, activeRole, loadRecords]);

  useEffect(() => {
    if (!user?.employeeDbId) return;
    void recoverTodayAttendance(user.employeeDbId, currentUser.name, currentUser.empId, currentUser.department ?? '').then((record) => {
      if (!record) return;
      setTodayAttendance((prev) => {
        const index = prev.findIndex((item) => item.id === record.id);
        if (index === -1) return [record, ...prev];
        const copy = [...prev];
        copy[index] = record;
        return copy;
      });
      setAttendanceHistory((prev) => {
        const index = prev.findIndex((item) => item.id === record.id);
        if (index === -1) return [record, ...prev];
        const copy = [...prev];
        copy[index] = record;
        return copy;
      });
    });
  }, [user?.employeeDbId, currentUser.name, currentUser.empId, currentUser.department]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user) return;
    const channel = (supabase as any)
      .channel(`ira-presence-live-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => void loadRecords())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'break_events' }, () => void loadRecords())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wfh_requests' }, () => void loadRecords())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => void loadRecords())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'regularization_requests' }, () => void loadRecords())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holidays' }, () => void loadRecords())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => void loadRecords())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auth_sessions', filter: `user_id=eq.${user.id}` }, () => {
        if (activeRole === 'employee') void loadRecords();
      })
      .subscribe();
    return () => {
      (supabase as any).removeChannel(channel);
    };
  }, [user?.id, activeRole, loadRecords]);

  const replaceTodayRecord = (record: AttendanceRecord) => {
    setTodayAttendance((prev) => {
      const index = prev.findIndex((item) => item.id === record.id);
      if (index === -1) return [record, ...prev];
      const copy = [...prev];
      copy[index] = record;
      return copy;
    });
    setAttendanceHistory((prev) => {
      const index = prev.findIndex((item) => item.id === record.id);
      if (index === -1) return [record, ...prev];
      const copy = [...prev];
      copy[index] = record;
      return copy;
    });
  };

  const handleCheckIn = async (mode: AttendanceMode) => {
    if (!user?.employeeDbId) return { success: false, error: 'Your employee account is not linked to an employee record.' };
    const result = await performCheckIn({
      employeeId: user.employeeDbId,
      profileId: user.id,
      employeeName: currentUser.name,
      employeeEmpId: currentUser.empId,
      department: currentUser.department,
      employeeRole: activeRole,
      mode,
    });
    if (result.success && result.attendanceRecord) replaceTodayRecord(result.attendanceRecord);
    return result;
  };

  const handleStartBreak = async () => {
    if (!currentTodayRecord) return { success: false, error: 'No active attendance record found.' };
    const result = await performStartBreak(currentTodayRecord, user?.id ?? currentUser.id, 'Employee');
    if (result.success && result.attendanceRecord) replaceTodayRecord(result.attendanceRecord);
    return result;
  };

  const handleResumeWork = async () => {
    if (!currentTodayRecord) return { success: false, error: 'No active attendance record found.' };
    const result = await performResumeWork(currentTodayRecord, user?.id ?? currentUser.id, 'Employee');
    if (result.success && result.attendanceRecord) replaceTodayRecord(result.attendanceRecord);
    return result;
  };

  const handleCheckOut = async () => {
    if (!currentTodayRecord) return { success: false, error: 'No active attendance record found.' };
    const result = await performCheckOut(currentTodayRecord, user?.id ?? currentUser.id, 'Employee');
    if (result.success && result.attendanceRecord) replaceTodayRecord(result.attendanceRecord);
    if (result.success) void loadRecords();
    return result;
  };

  const handleSubmitWfhRequest = async (newReq: Omit<WfhRequest, 'id' | 'requestedOn' | 'status'>) => {
    if (!isSupabaseConfigured || !user?.employeeDbId) throw new Error('Something went wrong. Please try again.');
    const { data, error } = await (supabase as any).from('wfh_requests').insert({
      employee_id: user.employeeDbId,
      date: newReq.date,
      duration: newReq.duration,
      reason: newReq.reason,
      note: newReq.note ?? null,
    }).select('id, created_at, status').single();
    if (error) throw error;
    setWfhRequests((prev) => [{ ...newReq, id: data.id, requestedOn: data.created_at, status: data.status }, ...prev]);
  };

  const handleSubmitLeaveRequest = async (newReq: Omit<LeaveRequest, 'id' | 'requestedOn' | 'status'>) => {
    if (!isSupabaseConfigured || !user?.employeeDbId) throw new Error('Something went wrong. Please try again.');
    const { data, error } = await (supabase as any).from('leave_requests').insert({
      employee_id: user.employeeDbId,
      leave_type: newReq.leaveType,
      start_date: newReq.startDate,
      end_date: newReq.endDate,
      days: newReq.days,
      reason: newReq.reason,
    }).select('id, created_at, status').single();
    if (error) throw error;
    setLeaveRequests((prev) => [{ ...newReq, id: data.id, requestedOn: data.created_at, status: data.status }, ...prev]);
  };

  const handleSubmitCorrection = async (newReq: Omit<CorrectionRequest, 'id' | 'requestedOn' | 'status'>) => {
    if (!isSupabaseConfigured || !user?.employeeDbId) throw new Error('Something went wrong. Please try again.');
    const { data, error } = await (supabase as any).from('regularization_requests').insert({
      employee_id: user.employeeDbId,
      date: newReq.date,
      original_check_in: newReq.originalCheckIn || null,
      original_check_out: newReq.originalCheckOut || null,
      requested_check_in: newReq.requestedCheckIn,
      requested_check_out: newReq.requestedCheckOut,
      reason: newReq.reason,
    }).select('id, created_at, status').single();
    if (error) throw error;
    setCorrectionRequests((prev) => [{ ...newReq, id: data.id, requestedOn: data.created_at, status: data.status }, ...prev]);
  };

  const review = async (table: string, id: string, status: 'approved' | 'rejected') => {
    if (!isSupabaseConfigured || !user?.id) throw new Error('Something went wrong. Please try again.');
    const { error } = await (supabase as any).from(table).update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    void loadRecords();
  };

  const handleApproveWfh = async (id: string) => { await review('wfh_requests', id, 'approved'); };
  const handleRejectWfh = async (id: string) => { await review('wfh_requests', id, 'rejected'); };
  const handleApproveLeave = async (id: string) => { await review('leave_requests', id, 'approved'); };
  const handleRejectLeave = async (id: string) => { await review('leave_requests', id, 'rejected'); };
  const handleApproveCorrection = async (id: string) => { await review('regularization_requests', id, 'approved'); };
  const handleRejectCorrection = async (id: string) => { await review('regularization_requests', id, 'rejected'); };

  const handleAddHoliday = async (holiday: Omit<Holiday, 'id'>) => {
    if (!isSupabaseConfigured || !user?.id) throw new Error('Something went wrong. Please try again.');
    const { data, error } = await (supabase as any).from('holidays').insert({
      name: holiday.name,
      date: holiday.date,
      description: holiday.description,
      mandatory: holiday.mandatory,
      created_by: user.id,
    }).select('*').single();
    if (error) throw error;
    setHolidays((prev) => [...prev, toHoliday(data)].sort((a, b) => a.date.localeCompare(b.date)));
  };

  const handleLogout = async () => { await signOut(); };

  if (authLoading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="text-xs font-semibold text-slate-500">Loading IRA Presence…</div></div>;
  }

  if (!isLoggedIn) {
    return isAdminPath ? <AdminLoginScreen /> : <EmployeeLoginScreen />;
  }

  // During a brief URL transition, do not render the wrong portal.
  if ((activeRole === 'admin') !== isAdminPath) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="text-xs font-semibold text-slate-500">Opening your portal…</div></div>;
  }

  const isCheckedIn = Boolean(currentTodayRecord?.checkIn && !currentTodayRecord?.checkOut);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col font-sans antialiased selection:bg-blue-600 selection:text-white">
      <Header currentUser={currentUser} activeRole={activeRole} onLogout={handleLogout} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeRole={activeRole}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          currentUser={currentUser}
          onLogout={handleLogout}
          pendingWfhCount={wfhRequests.filter((r) => r.status === 'pending').length}
          pendingLeaveCount={leaveRequests.filter((r) => r.status === 'pending').length}
          pendingCorrectionCount={correctionRequests.filter((r) => r.status === 'pending').length}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8">
          {activeRole === 'employee' && (
            <>
              {activeTab === 'emp-dashboard' && (
                <EmployeeDashboard
                  currentUser={currentUser}
                  todayRecord={currentTodayRecord}
                  onCheckIn={handleCheckIn}
                  onStartBreak={handleStartBreak}
                  onResumeWork={handleResumeWork}
                  onCheckOut={handleCheckOut}
                />
              )}
              {activeTab === 'emp-attendance' && (
                <MyAttendanceCalendar currentUser={currentUser} attendanceHistory={attendanceHistory} holidays={holidays} loginSessions={loginSessions} />
              )}
              {activeTab === 'emp-wfh' && <WfhRequestView currentUser={currentUser} wfhRequests={wfhRequests} onSubmitWfhRequest={handleSubmitWfhRequest} />}
              {activeTab === 'emp-leave' && <LeaveRequestView currentUser={currentUser} leaveRequests={leaveRequests} onSubmitLeaveRequest={handleSubmitLeaveRequest} />}
              {activeTab === 'emp-corrections' && <CorrectionsView currentUser={currentUser} correctionRequests={correctionRequests} onSubmitCorrection={handleSubmitCorrection} />}
              {activeTab === 'emp-holidays' && <EmployeeHolidaysView holidays={holidays} />}
            </>
          )}

          {activeRole === 'admin' && (
            <>
              {activeTab === 'admin-dashboard' && <AdminDashboard todayAttendance={todayAttendance} employees={employees} wfhRequests={wfhRequests} leaveRequests={leaveRequests} correctionRequests={correctionRequests} holidays={holidays} onSelectTab={setActiveTab} />}
              {activeTab === 'admin-attendance' && <AdminAttendanceTable records={adminAttendanceHistory} />}
              {activeTab === 'admin-employees' && <EmployeeDirectoryView employees={employees} />}
              {activeTab === 'admin-wfh' && <WfhManagementView wfhRequests={wfhRequests} onApproveWfh={handleApproveWfh} onRejectWfh={handleRejectWfh} />}
              {activeTab === 'admin-leave' && <LeaveManagementView leaveRequests={leaveRequests} onApproveLeave={handleApproveLeave} onRejectLeave={handleRejectLeave} />}
              {activeTab === 'admin-corrections' && <RegularizationView correctionRequests={correctionRequests} onApproveCorrection={handleApproveCorrection} onRejectCorrection={handleRejectCorrection} />}
              {activeTab === 'admin-export' && <ExcelExportView />}
              {activeTab === 'admin-holidays' && <HolidaysView holidays={holidays} onAddHoliday={handleAddHoliday} />}
            </>
          )}
        </main>
      </div>

      <MobileNavBar role={activeRole} activeTab={activeTab} onSelectTab={setActiveTab} isCheckedIn={isCheckedIn} pendingRequestsCount={wfhRequests.filter((r) => r.status === 'pending').length} />
    </div>
  );
}
