import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { useAuth, type AuthUser, loginIdToAuthEmail } from './contexts/AuthContext';
import { AdminLoginScreen, EmployeeLoginScreen } from './components/auth/PortalLoginScreen';
import { Sidebar } from './components/common/Sidebar';
import { ToastHost } from './components/common/ToastHost';
import { notify } from './lib/toast';
import {
  Activity, ArrowRight, BriefcaseBusiness, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight,
  Clock3, Download, Eye, FileClock, FileText, Filter, Home, KeyRound, LayoutDashboard, Link2,
  Bell, LogOut, Menu, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, Trash2, UserRound,
  Users, WalletCards, X, Upload, Building2, CircleAlert, LockKeyhole, UserPlus
} from 'lucide-react';
import type {
  AssignmentRule, AttendanceRecord, Department, Designation, Employee, EmployeeDocument,
  Holiday, LeaveLedger, LeaveRequest, PayrollPeriod, PayrollRecord, Task, TaskPriority,
  WfhRequest, CorrectionRequest
} from './types/attendance';
import {
  ALL_DOCUMENT_TYPES, dateLabel, duration, mapAttendance, mapEmployee, mapHoliday,
  mapLeave, mapLedger, mapPayrollPeriod, mapPayrollRecord, mapRule, mapTask, mapWfh,
  money, invokeEmployeeAdmin, uploadAvatar, uploadEmployeeDocument, getSignedDocumentUrl
} from './lib/v2';
import { classifyDay, formatKolkataTime, getKolkataDateString } from './lib/workingDays';
import { performCheckIn, performStartBreak, performResumeWork, performCheckOut, recoverTodayAttendance, formatLiveTimer } from './lib/attendance';

const today = () => getKolkataDateString();
const tomorrow = () => {
  const d = new Date(today() + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const authEmployee = (u: AuthUser): Employee => ({
  id: u.employeeDbId ?? u.id,
  profileId: u.id,
  empId: u.empId ?? '',
  loginId: u.loginId ?? '',
  name: u.name,
  email: u.email,
  workEmail: u.email,
  phone: u.phone,
  status: u.status ?? 'active',
  workMode: u.workMode,
  avatar: u.avatar ?? '',
  department: u.department ?? '',
  departmentId: u.departmentId,
  designation: u.designation ?? '',
  designationId: u.designationId,
  manager: u.manager ?? null,
  managerId: u.managerId ?? null,
  role: u.role,
  shift: u.shift,
  shiftEnd: u.shiftEnd,
  joinDate: u.joinDate,
  currentSalary: u.currentSalary,
});

export default function App() {
  const { user, loading, signOut } = useAuth();
  const adminPath = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
  if (loading) return <LoadingScreen />;
  if (!user) return adminPath ? <AdminLoginScreen /> : <EmployeeLoginScreen />;
  if (!isSupabaseConfigured) return <LoadingScreen label="Supabase is not configured." />;

  return <Portal user={user} onLogout={signOut} />;
}

function Portal({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const [activeTab, setActiveTab] = useState(user.role === 'admin' ? 'admin-dashboard' : 'emp-dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [headerNow, setHeaderNow] = useState(new Date());

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [wfhRequests, setWfhRequests] = useState<WfhRequest[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRequest[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [ledgers, setLedgers] = useState<LeaveLedger[]>([]);
  const [payrollPeriods, setPayrollPeriods] = useState<PayrollPeriod[]>([]);
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [rules, setRules] = useState<AssignmentRule[]>([]);
  const [loginSessions, setLoginSessions] = useState<any[]>([]);
  const lastRealtimeEvent = useRef<string>('');
  const reloadTimer = useRef<number | null>(null);
  const dataSnapshot = useRef({
    employees: [] as Employee[],
    departments: [] as Department[],
    designations: [] as Designation[],
  });
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setHeaderNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoadingData(prev => prev);
    const failures: string[] = [];
    const db = supabase as any;

    const safe = async (promise: Promise<any>, label: string) => {
      try {
        const result = await promise;
        if (result?.error) failures.push(label);
        return result;
      } catch (error) {
        failures.push(label);
        return { data: null, error: { message: error instanceof Error ? error.message : 'Request failed.' } };
      }
    };

    try {
      if (user.role === 'admin') {
        const [
          empR, depR, desR, salaryR, attR, breaksR, taskR, leaveR, wfhR, corrR,
          holR, ledgerR, ppR, prR, ruleR
        ] = await Promise.all([
          safe(db.from('employees').select('*').order('name'), 'employees'),
          safe(db.from('departments').select('*').order('name'), 'departments'),
          safe(db.from('designations').select('*').order('name'), 'designations'),
          safe(db.from('salary_history').select('employee_id,monthly_salary,effective_from').lte('effective_from', today()).order('effective_from', { ascending: false }), 'salary'),
          safe(db.from('attendance_effective').select('*').order('date', { ascending: false }).limit(1500), 'attendance'),
          safe(db.from('break_events').select('id,attendance_id,employee_id,break_start,break_end,duration_seconds').order('break_start'), 'breaks'),
          safe(db.from('tasks').select('*').order('start_date', { ascending: false }).limit(1500), 'tasks'),
          safe(db.from('leave_requests').select('*').order('created_at', { ascending: false }).limit(1000), 'leave'),
          safe(db.from('wfh_requests').select('*').order('created_at', { ascending: false }).limit(1000), 'wfh'),
          safe(db.from('regularization_requests').select('*').order('created_at', { ascending: false }).limit(1000), 'corrections'),
          safe(db.from('holidays').select('*').order('date'), 'holidays'),
          safe(db.from('leave_ledger').select('*').order('period_start', { ascending: false }).limit(1000), 'leave balances'),
          safe(db.from('payroll_periods').select('*').order('month_start', { ascending: false }).limit(60), 'payroll periods'),
          safe(db.from('payroll_records').select('*').order('created_at', { ascending: false }).limit(6000), 'payroll records'),
          safe(db.from('task_assignment_rules').select('*').order('created_at'), 'assignment rules'),
        ]);

        const fallbackEmployees = dataSnapshot.current.employees;
        const fallbackDepartments = dataSnapshot.current.departments;
        const fallbackDesignations = dataSnapshot.current.designations;

        const departmentsData = depR.error ? fallbackDepartments : (depR.data ?? []).map((d: any) => ({ id: d.id, name: d.name }));
        const designationsData = desR.error ? fallbackDesignations : (desR.data ?? []).map((d: any) => ({ id: d.id, name: d.name, canAssignTasks: Boolean(d.can_assign_tasks) }));
        const departmentsMap = new Map(departmentsData.map(d => [d.id, d.name]));
        const designationsMap = new Map(designationsData.map(d => [d.id, d.name]));

        if (!depR.error) {
          dataSnapshot.current.departments = departmentsData;
          setDepartments(departmentsData);
        }
        if (!desR.error) {
          dataSnapshot.current.designations = designationsData;
          setDesignations(designationsData);
        }

        const salaryMap = new Map<string, number>();
        for (const s of salaryR.data ?? []) if (!salaryMap.has(s.employee_id)) salaryMap.set(s.employee_id, Number(s.monthly_salary));

        let mappedEmployees = fallbackEmployees;
        if (!empR.error) {
          const rawEmployees = empR.data ?? [];
          const managersMap = new Map(rawEmployees.map((e: any) => [e.id, e.name]));
          mappedEmployees = rawEmployees.map((e: any) => mapEmployee(e, {
            departments: departmentsMap,
            designations: designationsMap,
            managers: managersMap,
            salary: salaryMap,
          }));
          dataSnapshot.current.employees = mappedEmployees;
          setEmployees(mappedEmployees);
        }
        const employeeMap = new Map(mappedEmployees.map(e => [e.id, e]));

        if (!attR.error && !breaksR.error) {
          const breaksBy = new Map<string, any[]>();
          for (const b of breaksR.data ?? []) {
            const list = breaksBy.get(b.attendance_id) ?? [];
            list.push(b);
            breaksBy.set(b.attendance_id, list);
          }
          setAttendance((attR.data ?? []).map((r: any) => mapAttendance(r, employeeMap, breaksBy)));
        }
        if (!taskR.error) setTasks((taskR.data ?? []).map((r: any) => mapTask(r, employeeMap)));
        if (!leaveR.error) setLeaveRequests((leaveR.data ?? []).map((r: any) => mapLeave(r, employeeMap)));
        if (!wfhR.error) setWfhRequests((wfhR.data ?? []).map((r: any) => mapWfh(r, employeeMap)));
        if (!corrR.error) {
          setCorrections((corrR.data ?? []).map((r: any) => ({
            id: r.id, employeeId: r.employee_id, employeeName: employeeMap.get(r.employee_id)?.name ?? '',
            department: employeeMap.get(r.employee_id)?.department ?? '', date: r.date,
            originalCheckIn: r.original_check_in ? formatKolkataTime(new Date(r.original_check_in)) : '',
            originalCheckOut: r.original_check_out ? formatKolkataTime(new Date(r.original_check_out)) : '',
            requestedCheckIn: r.requested_check_in, requestedCheckOut: r.requested_check_out,
            reason: r.reason, status: r.status, requestedOn: r.created_at, reviewNote: r.review_note,
          })));
        }
        if (!holR.error) setHolidays((holR.data ?? []).map(mapHoliday));
        if (!ledgerR.error) setLedgers((ledgerR.data ?? []).map(mapLedger));
        if (!ppR.error) setPayrollPeriods((ppR.data ?? []).map(mapPayrollPeriod));
        if (!prR.error) setPayrollRecords((prR.data ?? []).map((r: any) => mapPayrollRecord(r, employeeMap)));
        if (!ruleR.error) setRules((ruleR.data ?? []).map((r: any) => mapRule(r, designationsMap)));
      } else {
        const employeeId = user.employeeDbId;
        if (!employeeId) throw new Error('Your employee account is not linked.');

        const [
          visibleEmpR, desR, attR, taskR, leaveR, wfhR, corrR, holR, ledgerR,
          ppR, prR, sessR, salaryR, ruleR
        ] = await Promise.all([
          safe(db.from('employees').select('id,profile_id,emp_id,login_id,name,status,work_mode,shift_start,shift_end,department_id,designation_id,manager_id,avatar_url').order('name'), 'employees'),
          safe(db.from('designations').select('*').order('name'), 'designations'),
          safe(db.from('attendance_effective').select('*').eq('employee_id', employeeId).order('date', { ascending: false }).limit(1000), 'attendance'),
          safe(db.from('tasks').select('*').or(`assigned_to.eq.${employeeId},assigned_by.eq.${employeeId}`).order('due_date'), 'tasks'),
          safe(db.from('leave_requests').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(500), 'leave'),
          safe(db.from('wfh_requests').select('*').eq('employee_id', employeeId).order('date', { ascending: false }).limit(500), 'wfh'),
          safe(db.from('regularization_requests').select('*').eq('employee_id', employeeId).order('date', { ascending: false }).limit(500), 'corrections'),
          safe(db.from('holidays').select('*').order('date'), 'holidays'),
          safe(db.from('leave_ledger').select('*').eq('employee_id', employeeId).order('period_start', { ascending: false }).limit(120), 'leave balances'),
          safe(db.from('payroll_periods').select('*').order('month_start', { ascending: false }).limit(120), 'payroll periods'),
          safe(db.from('payroll_records').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(120), 'payroll records'),
          safe(db.from('auth_sessions').select('*').eq('user_id', user.id).order('login_at', { ascending: false }).limit(100), 'login sessions'),
          safe(db.from('salary_history').select('*').eq('employee_id', employeeId).lte('effective_from', today()).order('effective_from', { ascending: false }).limit(120), 'salary history'),
          safe(db.from('task_assignment_rules').select('*').order('created_at'), 'assignment rules'),
        ]);

        const emp = authEmployee(user);
        const fallbackEmployees = dataSnapshot.current.employees;
        const desData = desR.error ? dataSnapshot.current.designations : (desR.data ?? []).map((d: any) => ({ id: d.id, name: d.name, canAssignTasks: Boolean(d.can_assign_tasks) }));
        if (!desR.error) {
          dataSnapshot.current.designations = desData;
          setDesignations(desData);
        }
        const desMap = new Map(desData.map(d => [d.id, d.name]));
        const visibleSalary = new Map<string, number>();
        for (const salary of salaryR.data ?? []) if (!visibleSalary.has(salary.employee_id)) visibleSalary.set(salary.employee_id, Number(salary.monthly_salary));

        const employeeMap = new Map<string, Employee>();
        if (visibleEmpR.error) {
          for (const employee of fallbackEmployees) employeeMap.set(employee.id, employee);
        } else {
          const visibleRaw = visibleEmpR.data ?? [];
          const managerNames = new Map(visibleRaw.map((row: any) => [row.id, row.name]));
          for (const row of visibleRaw) {
            employeeMap.set(row.id, mapEmployee(row, { designations: desMap, managers: managerNames, salary: visibleSalary }));
          }
        }
        employeeMap.set(employeeId, emp);

        if (!visibleEmpR.error) {
          const mapped = Array.from(employeeMap.values());
          dataSnapshot.current.employees = mapped;
          setEmployees(mapped);
        }

        if (!attR.error) {
          const attendanceIds = (attR.data ?? []).map((a: any) => a.id);
          const breaksResult = attendanceIds.length
            ? await safe(db.from('break_events').select('id,attendance_id,employee_id,break_start,break_end,duration_seconds').in('attendance_id', attendanceIds).order('break_start'), 'breaks')
            : { data: [], error: null };
          if (!breaksResult.error) {
            const breaksBy = new Map<string, any[]>();
            for (const b of breaksResult.data ?? []) {
              const list = breaksBy.get(b.attendance_id) ?? [];
              list.push(b);
              breaksBy.set(b.attendance_id, list);
            }
            setAttendance((attR.data ?? []).map((r: any) => mapAttendance(r, employeeMap, breaksBy)));
          }
        }
        if (!taskR.error) setTasks((taskR.data ?? []).map((r: any) => mapTask(r, employeeMap)));
        if (!leaveR.error) setLeaveRequests((leaveR.data ?? []).map((r: any) => mapLeave(r, employeeMap)));
        if (!wfhR.error) setWfhRequests((wfhR.data ?? []).map((r: any) => mapWfh(r, employeeMap)));
        if (!corrR.error) {
          setCorrections((corrR.data ?? []).map((r: any) => ({
            id: r.id, employeeId: r.employee_id, employeeName: emp.name, department: emp.department, date: r.date,
            originalCheckIn: r.original_check_in ? formatKolkataTime(new Date(r.original_check_in)) : '',
            originalCheckOut: r.original_check_out ? formatKolkataTime(new Date(r.original_check_out)) : '',
            requestedCheckIn: r.requested_check_in, requestedCheckOut: r.requested_check_out, reason: r.reason,
            status: r.status, requestedOn: r.created_at, reviewNote: r.review_note,
          })));
        }
        if (!holR.error) setHolidays((holR.data ?? []).map(mapHoliday));
        if (!ledgerR.error) setLedgers((ledgerR.data ?? []).map(mapLedger));
        if (!ppR.error) setPayrollPeriods((ppR.data ?? []).map(mapPayrollPeriod));
        if (!prR.error) setPayrollRecords((prR.data ?? []).map((r: any) => mapPayrollRecord(r, employeeMap)));
        if (!sessR.error) setLoginSessions((sessR.data ?? []).map((r: any) => ({
          id: r.id, loginTime: r.login_at, logoutTime: r.logout_at, duration: r.session_duration_seconds,
          status: r.status, userAgent: r.user_agent,
        })));
        if (!ruleR.error) setRules((ruleR.data ?? []).map((r: any) => mapRule(r, desMap)));
      }

      setDataError(failures.length
        ? `Some live modules could not be refreshed: ${failures.join(', ')}. Available data remains on screen.`
        : '');
    } catch (e) {
      console.error('[Portal] load failed', e);
      setDataError(e instanceof Error ? e.message : 'Unable to load workspace data.');
    } finally {
      setLoadingData(false);
    }
  }, [user]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!user) return;
    const channel = (supabase as any).channel(`ira-v2-${user.id}`);
    const employeeId = user.role === 'employee' ? user.employeeDbId : null;
    const subscriptions = [
      ['employees', employeeId ? `id=eq.${employeeId}` : undefined],
      ['attendance', employeeId ? `employee_id=eq.${employeeId}` : undefined],
      ['break_events', employeeId ? `employee_id=eq.${employeeId}` : undefined],
      ['tasks', undefined],
      ['leave_requests', employeeId ? `employee_id=eq.${employeeId}` : undefined],
      ['wfh_requests', employeeId ? `employee_id=eq.${employeeId}` : undefined],
      ['regularization_requests', employeeId ? `employee_id=eq.${employeeId}` : undefined],
      ['holidays', undefined],
      ['salary_history', employeeId ? `employee_id=eq.${employeeId}` : undefined],
      ['leave_ledger', employeeId ? `employee_id=eq.${employeeId}` : undefined],
      ['payroll_periods', undefined],
      ['payroll_records', employeeId ? `employee_id=eq.${employeeId}` : undefined],
      ['departments', undefined],
      ['designations', undefined],
      ['task_assignment_rules', undefined],
    ] as Array<[string,string|undefined]>;
    for (const [table, filter] of subscriptions) {
      const options:any = { event: '*', schema: 'public', table };
      if (filter) options.filter = filter;
      channel.on('postgres_changes', options, (payload:any) => {
        const eventKey = `${table}:${payload.eventType}:${payload.new?.id ?? payload.old?.id ?? ''}`;
        if (lastRealtimeEvent.current !== eventKey) {
          lastRealtimeEvent.current = eventKey;
          const now = Date.now();
          window.setTimeout(() => { if (lastRealtimeEvent.current === eventKey && Date.now() - now > 800) lastRealtimeEvent.current = ''; }, 900);

          if (table === 'tasks') {
            const next = payload.new ?? {};
            const previous = payload.old ?? {};
            if (
              user.role === 'employee' &&
              payload.eventType === 'INSERT' &&
              next.assigned_to === user.employeeDbId
            ) {
              notify('New task assigned to you.', 'info');
            } else if (
              user.role === 'employee' &&
              payload.eventType === 'UPDATE' &&
              next.assigned_to === user.employeeDbId &&
              previous.assigned_to !== next.assigned_to
            ) {
              notify('A task has been assigned to you.', 'info');
            } else if (
              user.role === 'admin' &&
              payload.eventType === 'UPDATE' &&
              previous.status !== 'completed' &&
              next.status === 'completed'
            ) {
              notify('Employee submitted completed work.', 'success');
            }
          } else if ((table === 'leave_requests' || table === 'wfh_requests' || table === 'regularization_requests') && user.role === 'employee') {
            if (payload.eventType === 'UPDATE' && payload.old?.status !== payload.new?.status) {
              const label = table === 'leave_requests' ? 'Leave request' : table === 'wfh_requests' ? 'WFH request' : 'Correction request';
              notify(`${label} ${payload.new?.status ?? 'updated'}.`, payload.new?.status === 'approved' ? 'success' : payload.new?.status === 'rejected' ? 'error' : 'info');
            }
          } else if (table === 'leave_requests' || table === 'wfh_requests' || table === 'regularization_requests') {
            if (user.role === 'admin' && payload.eventType === 'INSERT') notify('New employee request needs review.', 'info');
          } else if (table === 'holidays' && (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE')) {
            notify('Holiday calendar updated.', 'info');
          } else if (table === 'payroll_records' && user.role === 'employee' && payload.eventType === 'UPDATE' && payload.new?.finalized_at) {
            notify('Your payroll has been finalized.', 'success');
          }
        }

        if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
        reloadTimer.current = window.setTimeout(() => void reload(), 180);
      });
    }
    channel.subscribe((status:string) => {
      if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        notify('Live updates are temporarily unavailable. The workspace will retry automatically.', 'error');
      }
    });
    return () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      (supabase as any).removeChannel(channel);
    };
  }, [user, reload]);

  const employeeNav = [
    ['emp-dashboard', 'Dashboard', LayoutDashboard],
    ['emp-attendance', 'My Attendance', Clock3],
    ['emp-tasks', 'Work & Assignments', BriefcaseBusiness],
    ['emp-leave', 'Leave', CalendarDays],
    ['emp-wfh', 'WFH', Home],
    ['emp-payroll', 'Payroll', WalletCards],
    ['emp-corrections', 'Corrections', FileClock],
    ['emp-holidays', 'Holidays', CalendarDays],
    ['emp-profile', 'Profile', UserRound],
  ] as const;

  const adminNav = [
    ['admin-dashboard', 'Dashboard', LayoutDashboard],
    ['admin-employees', 'Employees / HR', Users],
    ['admin-attendance', 'Attendance', Clock3],
    ['admin-tasks', 'Work & Assignments', BriefcaseBusiness],
    ['admin-requests', 'Requests', FileClock],
    ['admin-payroll', 'Payroll', WalletCards],
    ['admin-holidays', 'Holidays', CalendarDays],
    ['admin-export', 'Reports / Excel', Download],
    ['admin-settings', 'Settings', Settings2],
  ] as const;

  const pendingCount = leaveRequests.filter(x => x.status === 'pending').length + wfhRequests.filter(x => x.status === 'pending').length + corrections.filter(x => x.status === 'pending').length;
  const employeeOpenTasks = tasks.filter(t => t.assignedTo === user.employeeDbId && t.status === 'assigned').length;
  const adminSubmittedTasks = tasks.filter(t => t.status === 'completed').length;

  const navigate = (tab: string) => { setActiveTab(tab); setMobileOpen(false); };
  const selectedComponent = user.role === 'admin'
    ? <AdminContent
        user={user} activeTab={activeTab} employees={employees} departments={departments} designations={designations}
        attendance={attendance} tasks={tasks} leaveRequests={leaveRequests} wfhRequests={wfhRequests} corrections={corrections}
        holidays={holidays} ledgers={ledgers} payrollPeriods={payrollPeriods} payrollRecords={payrollRecords} rules={rules}
        onRefresh={reload} onSelectTab={navigate}
      />
    : <EmployeeContent
        user={user} activeTab={activeTab} attendance={attendance} tasks={tasks} leaveRequests={leaveRequests} wfhRequests={wfhRequests}
        corrections={corrections} holidays={holidays} ledgers={ledgers} payrollPeriods={payrollPeriods}
        payrollRecords={payrollRecords} loginSessions={loginSessions} employees={employees} designations={designations} rules={rules} onRefresh={reload}
      />;

  return (
    <div className="min-h-screen text-slate-900 flex ira-app-bg">
      <Sidebar
        activeRole={user.role} activeTab={activeTab} onSelectTab={navigate} currentUser={user}
        pendingTaskCount={user.role === 'admin' ? adminSubmittedTasks : employeeOpenTasks}
        pendingWfhCount={user.role === 'admin' ? wfhRequests.filter(x => x.status === 'pending').length : undefined}
        pendingLeaveCount={user.role === 'admin' ? leaveRequests.filter(x => x.status === 'pending').length : undefined}
        pendingCorrectionCount={user.role === 'admin' ? corrections.filter(x => x.status === 'pending').length : undefined}
      />
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        <header className="ira-topbar h-16 sticky top-0 z-20 flex items-center px-4 sm:px-6 gap-3">
          <button type="button" className="lg:hidden p-2 rounded-xl hover:bg-slate-100" onClick={() => setMobileOpen(v => !v)} aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileOpen} aria-controls="mobile-navigation"><Menu className="w-5 h-5" /></button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold">{user.role === 'admin' ? 'IRA Workforce Management' : 'IRA Employee Workspace'}</p>
            <h1 className="text-sm font-bold text-slate-900 truncate">{getPageTitle(activeTab)}</h1>
          </div>
          <div className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-xl bg-white/55 border border-slate-200/75 text-[11px] font-semibold text-slate-600 backdrop-blur-xl">
            <span className="ira-live-dot" />
            <span>{headerNow.toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true})}</span>
          </div>
          <NotificationBell />
          <div className="flex items-center gap-2.5 pl-2 sm:pl-3 border-l border-slate-200/70">
            <div className="w-8 h-8 rounded-full bg-slate-950 text-white flex items-center justify-center text-[11px] font-bold">{(user.name || 'U').charAt(0).toUpperCase()}</div>
            <div className="hidden md:block">
              <p className="text-xs font-semibold text-slate-900 leading-none">{user.name || 'User'}</p>
              <p className="text-[10px] text-slate-500 mt-1">{user.role === 'admin' ? 'Administrator' : (user.designation || 'Employee')}</p>
            </div>
            <button type="button" onClick={()=>void onLogout()} className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[11px] font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-all" title="Sign out" aria-label="Sign out">
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        {mobileOpen && (
          <div className="lg:hidden fixed inset-0 z-40 bg-slate-950/35" onClick={() => setMobileOpen(false)}>
            <div className="w-72 h-full bg-slate-950 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-slate-800 flex items-center justify-between text-white"><b>IRA Hospitality</b><button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation menu"><X className="w-5 h-5" /></button></div>
              <nav id="mobile-navigation" aria-label="Mobile navigation" className="p-3 space-y-1">
                {(user.role === 'admin' ? adminNav : employeeNav).map(([id, label, Icon]) => (
                  <button key={id} onClick={() => navigate(id)} className={`w-full text-left px-3 py-3 rounded-2xl flex items-center gap-3 text-sm transition-all ${activeTab === id ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-[0_12px_30px_rgba(37,99,235,.20)]' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><Icon className="w-4 h-4" />{label}</button>
                ))}
              </nav>
            </div>
          </div>
        )}

        {dataError && (
          <div className="mx-4 sm:mx-6 mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex items-center justify-between gap-3">
            <span>{dataError}</span><button onClick={() => void reload()} className="font-bold">Retry</button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8 overflow-y-auto ira-main">
          {loadingData ? <LoadingScreen label="Loading workspace…" /> : selectedComponent}
        </main>

        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 px-2 py-2 grid grid-cols-4">
          {(user.role === 'admin' ? adminNav.slice(0,4) : employeeNav.slice(0,4)).map(([id,label,Icon]) => (
            <button key={id} onClick={() => navigate(id)} className={`flex flex-col items-center gap-1 py-1.5 text-[10px] ${activeTab === id ? 'text-blue-600 font-bold' : 'text-slate-500'}`}><Icon className="w-4 h-4" />{label}</button>
          ))}
        </nav>
        <div className="hidden">{pendingCount}</div>
      </div>
      <ToastHost />
    </div>
  );
}

function getPageTitle(tab: string) {
  return ({
    'admin-dashboard': 'Dashboard',
    'admin-employees': 'Employees / HR',
    'admin-attendance': 'Attendance',
    'admin-tasks': 'Work & Assignments',
    'admin-requests': 'Requests',
    'admin-payroll': 'Payroll',
    'admin-holidays': 'Holidays',
    'admin-export': 'Reports / Excel',
    'admin-settings': 'Settings',
    'emp-dashboard': 'Dashboard',
    'emp-attendance': 'My Attendance',
    'emp-tasks': 'Work & Assignments',
    'emp-leave': 'Leave',
    'emp-wfh': 'WFH',
    'emp-payroll': 'Payroll',
    'emp-corrections': 'Corrections',
    'emp-holidays': 'Holidays',
    'emp-profile': 'Profile',
  } as Record<string,string>)[tab] ?? 'Dashboard';
}

function AdminContent(props: any) {
  const { activeTab, user, onRefresh, onSelectTab } = props;
  if (activeTab === 'admin-employees') return <EmployeesAdmin {...props} />;
  if (activeTab === 'admin-attendance') return <AttendanceAdmin {...props} />;
  if (activeTab === 'admin-tasks') return <TasksAdmin {...props} />;
  if (activeTab === 'admin-requests') return <RequestsAdmin {...props} />;
  if (activeTab === 'admin-payroll') return <PayrollAdmin {...props} />;
  if (activeTab === 'admin-holidays') return <HolidaysAdmin {...props} />;
  if (activeTab === 'admin-export') return <ExportsAdmin {...props} />;
  if (activeTab === 'admin-settings') return <SettingsAdmin {...props} />;
  return <AdminDashboard {...props} onSelectTab={onSelectTab} />;
}

function EmployeeContent(props: any) {
  const { activeTab } = props;
  if (activeTab === 'emp-attendance') return <AttendanceEmployee {...props} />;
  if (activeTab === 'emp-tasks') return <TasksEmployee {...props} />;
  if (activeTab === 'emp-leave') return <LeaveEmployee {...props} />;
  if (activeTab === 'emp-wfh') return <WfhEmployee {...props} />;
  if (activeTab === 'emp-payroll') return <PayrollEmployee {...props} />;
  if (activeTab === 'emp-corrections') return <CorrectionEmployee {...props} />;
  if (activeTab === 'emp-holidays') return <HolidaysEmployee {...props} />;
  if (activeTab === 'emp-profile') return <ProfileEmployee {...props} />;
  return <EmployeeDashboard {...props} onSelectTab={props.onSelectTab} />;
}

function AdminDashboard({ employees, attendance, leaveRequests, wfhRequests, corrections, holidays, payrollPeriods, payrollRecords, onSelectTab }: any) {
  const active = employees.filter((e: Employee) => e.status === 'active');
  const todayStr = today();
  const todayClass = classifyDay(todayStr, holidays);
  const todayRows = active.map((e: Employee) => {
    const record = attendance.find((a: AttendanceRecord) => a.employeeId === e.id && a.date === todayStr);
    const leave = leaveRequests.find((l: LeaveRequest) => l.employeeId === e.id && l.status === 'approved' && l.startDate <= todayStr && l.endDate >= todayStr);
    return { e, record, leave };
  });
  const present = todayRows.filter((x: any) => x.record?.status === 'present' || x.record?.status === 'late' || x.record?.status === 'wfh').length;
  const pending = [...leaveRequests, ...wfhRequests, ...corrections].filter((r: any) => r.status === 'pending').length;
  const latestPayrollPeriod = [...(payrollPeriods as PayrollPeriod[])]
    .filter(pp=>pp.status==='finalized' && Boolean(pp.finalizedAt))
    .sort((a,b)=>b.monthStart.localeCompare(a.monthStart) || (b.finalizedAt??'').localeCompare(a.finalizedAt??''))[0];
  const latestPayrollTotal = latestPayrollPeriod
    ? (payrollRecords as PayrollRecord[]).filter(p=>p.periodId===latestPayrollPeriod.id).reduce((sum,p)=>sum+p.finalPay,0)
    : 0;

  return (
    <PageShell title="Dashboard" subtitle="Live workforce snapshot.">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <Kpi label="Active Employees" value={active.length} icon={<Users className="w-4 h-4" />} />
        <Kpi label={todayClass.isWorkingDay ? 'Present Today' : 'Today'} value={todayClass.isWorkingDay ? present : 0} icon={<Activity className="w-4 h-4" />} />
        <Kpi label="Pending Requests" value={pending} icon={<FileClock className="w-4 h-4" />} />
        <Kpi label="Latest Final Payroll" value={latestPayrollPeriod ? money(latestPayrollTotal) : '—'} icon={<WalletCards className="w-4 h-4" />} textValue />
        {latestPayrollPeriod && <p className="text-[10px] text-slate-400 -mt-2 col-span-2 xl:col-span-4">Period: {dateLabel(latestPayrollPeriod.monthStart,{month:'long',year:'numeric'})}</p>}
      </div>

      <section className="mt-6 bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div><h2 className="font-bold text-sm">Today</h2><p className="text-xs text-slate-500 mt-0.5">{dateLabel(todayStr, { weekday: 'long' })} · {todayClass.label}</p></div>
          <button onClick={() => onSelectTab('admin-attendance')} className="text-xs font-bold text-blue-600">Open attendance <ArrowRight className="w-3.5 h-3.5 inline ml-1" /></button>
        </div>
        {todayClass.isWorkingDay ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider"><tr><Th>Employee</Th><Th>Mode</Th><Th>Check-in</Th><Th>Check-out</Th><Th>Working</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {todayRows.map(({e,record,leave}: any) => (
                  <tr key={e.id}>
                    <Td strong>{e.name}<span className="block text-[10px] text-slate-400">{e.designation}</span></Td>
                    <Td>{leave ? 'Leave' : record?.mode === 'wfh' ? 'WFH' : record ? 'Office' : e.workMode === 'remote' ? 'WFH' : '—'}</Td>
                    <Td mono>{record?.checkIn ?? '—'}</Td><Td mono>{record?.checkOut ?? '—'}</Td><Td mono>{record ? duration(record.workingSeconds) : '—'}</Td>
                    <Td><StatusBadge label={leave ? 'Leave' : record?.status ? record.status : todayClass.isWorkingDay ? 'Not checked-in' : todayClass.label} /></Td>
                  </tr>
                ))}
                {!todayRows.length && <EmptyRow colSpan={6} text="No active employees yet. Create the first employee from Employees / HR." />}
              </tbody>
            </table>
          </div>
        ) : <div className="p-8 text-center text-sm text-slate-500"><CalendarDays className="w-8 h-8 mx-auto text-slate-300 mb-2" />{todayClass.label}</div>}
      </section>
    </PageShell>
  );
}

function PayrollEmployee({ payrollPeriods, payrollRecords }: any) {
  const finalized = [...(payrollRecords as PayrollRecord[])]
    .filter(record => Boolean(record.finalizedAt))
    .sort((a, b) => {
      const aMonth = payrollPeriods.find((period: PayrollPeriod) => period.id === a.periodId)?.monthStart ?? '';
      const bMonth = payrollPeriods.find((period: PayrollPeriod) => period.id === b.periodId)?.monthStart ?? '';
      return bMonth.localeCompare(aMonth) || (b.finalizedAt ?? '').localeCompare(a.finalizedAt ?? '');
    });

  return (
    <PageShell title="Payroll / Salary" subtitle="Review your finalized salary payments and the leave deductions used for each month.">
      {finalized.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <WalletCards className="w-6 h-6 text-slate-400 mx-auto" />
          <h2 className="text-sm font-bold text-slate-900 mt-3">No finalized payroll yet</h2>
          <p className="text-xs text-slate-500 mt-1">Finalized payments will appear here after payroll is processed.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900">Finalized payment history</h2>
            <p className="text-xs text-slate-500 mt-1">{finalized.length} payment record{finalized.length === 1 ? '' : 's'}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                <tr>
                  <Th>Period</Th><Th>Salary snapshot</Th><Th>Paid leave</Th><Th>Unpaid leave</Th><Th>Deduction</Th><Th>Final pay</Th><Th>Finalized</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {finalized.map(record => {
                  const period = payrollPeriods.find((item: PayrollPeriod) => item.id === record.periodId);
                  return (
                    <tr key={record.id}>
                      <Td strong>{period?.monthStart?.slice(0, 7) ?? '—'}</Td>
                      <Td>{money(record.salarySnapshot)}</Td>
                      <Td>{record.paidLeaveDays}</Td>
                      <Td>{record.unpaidLeaveDays}</Td>
                      <Td>{money(record.leaveDeduction)}</Td>
                      <Td strong>{money(record.finalPay)}</Td>
                      <Td>{record.finalizedAt ? new Date(record.finalizedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function EmployeeDashboard({ user, attendance, leaveRequests, ledgers, payrollPeriods, payrollRecords, tasks, employees, onSelectTab }: any) {
  const [live, setLive] = useState(new Date());
  const emp = authEmployee(user);
  const todayRecord = attendance.find((x: AttendanceRecord) => x.date === today());
  useEffect(() => { const t = window.setInterval(() => setLive(new Date()), 1000); return () => window.clearInterval(t); }, []);
  const state = todayRecord?.attendanceState ?? 'not_checked_in';
  const running = state === 'working' || state === 'on_break';
  const elapsed = todayRecord ? Math.max(0, Math.floor((live.getTime() - new Date(todayRecord.checkInIso ?? live).getTime()) / 1000)) : 0;
  const currentBreak = state === 'on_break' ? Math.max(0, Math.floor((live.getTime() - new Date(todayRecord?.activeBreakStartIso ?? live).getTime()) / 1000)) : 0;
  const currentWorking = todayRecord ? Math.max(0, elapsed - Number(todayRecord.breakSeconds ?? 0) - currentBreak) : 0;
  const currentLedger = ledgers.find((l: LeaveLedger) => l.periodStart === `${today().slice(0,7)}-01`);
  const employeeMaster = (employees as Employee[] | undefined)?.find((e) => e.id === user.employeeDbId);
  const latestFinal = [...(payrollRecords as PayrollRecord[])]
    .filter((p)=>Boolean(p.finalizedAt))
    .sort((a,b)=>{
      const aPeriod=payrollPeriods.find((pp:PayrollPeriod)=>pp.id===a.periodId)?.monthStart ?? '';
      const bPeriod=payrollPeriods.find((pp:PayrollPeriod)=>pp.id===b.periodId)?.monthStart ?? '';
      return bPeriod.localeCompare(aPeriod) || (b.finalizedAt ?? '').localeCompare(a.finalizedAt ?? '');
    })[0];
  const monthlySalary = employeeMaster?.currentSalary ?? user.currentSalary ?? latestFinal?.salarySnapshot ?? 0;
  const dueTasks = [...(tasks as Task[])]
    .filter((t)=>t.status!=='completed')
    .sort((a,b)=>a.dueDate.localeCompare(b.dueDate) || a.priority.localeCompare(b.priority))
    .slice(0,4);

  const kolkataHour=Number(new Intl.DateTimeFormat('en-IN',{hour:'2-digit',hourCycle:'h23',timeZone:'Asia/Kolkata'}).format(new Date()));
  const greeting=kolkataHour<12?'morning':kolkataHour<17?'afternoon':'evening';
  return (
    <PageShell title={`Good ${greeting}, ${user.name.split(' ')[0]}`} subtitle={new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Kolkata'})}>
      <div className="grid xl:grid-cols-3 gap-4">
        <section className="xl:col-span-2 bg-slate-950 text-white rounded-3xl p-5 sm:p-7 shadow-[0_18px_60px_rgba(15,23,42,.14)]">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-bold">Today's attendance</p><h2 className="text-2xl sm:text-3xl font-bold mt-2">{formatKolkataTime(live,true)}</h2></div>
            <StatusBadge label={state === 'completed' ? 'Completed' : state === 'on_break' ? 'On Break' : state === 'working' ? 'Working' : 'Ready'} dark />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-6">
            <DarkMetric label="Check-in" value={todayRecord?.checkIn ?? '—'} />
            <DarkMetric label="Break" value={duration((todayRecord?.breakSeconds ?? 0) + currentBreak)} />
            <DarkMetric label="Working" value={duration(running ? currentWorking : todayRecord?.workingSeconds ?? 0)} />
            <DarkMetric label="Check-out" value={todayRecord?.checkOut ?? '—'} />
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {!todayRecord && <button onClick={() => onSelectTab?.('emp-attendance')} className="btn-secondary !bg-white !text-slate-950">Go to attendance <ArrowRight className="w-4 h-4"/></button>}
            {todayRecord && state !== 'completed' && <span className="text-xs text-slate-400">Attendance actions are available in the Attendance section.</span>}
          </div>
        </section>
        <section className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6">
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-bold">Payroll</p>
          <h3 className="text-lg font-bold mt-2">{money(monthlySalary)}</h3>
          <p className="text-xs text-slate-500 mt-1">Monthly salary</p>
          <div className="mt-5 pt-4 border-t border-slate-100 flex items-end justify-between">
            <div><p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Latest finalized pay</p><p className="text-xl font-bold mt-1">{latestFinal ? money(latestFinal.finalPay) : 'Awaiting payroll'}</p>{latestFinal&&<p className="text-[10px] text-slate-400 mt-1">{payrollPeriods.find((p:PayrollPeriod)=>p.id===latestFinal.periodId)?.monthStart?.slice(0,7) ?? ''}</p>}</div>
            <WalletCards className="w-5 h-5 text-blue-600" />
          </div>
          {latestFinal && <p className="text-[11px] text-slate-500 mt-3">Unpaid leave: {latestFinal.unpaidLeaveDays} day(s) · Deduction {money(latestFinal.leaveDeduction)}</p>}
          {latestFinal && <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2"><p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Recent finalized payments</p><button type="button" onClick={() => onSelectTab?.('emp-payroll')} className="text-[10px] font-semibold text-blue-600 hover:text-blue-700">View history</button></div>
            <div className="space-y-1.5">
              {[...(payrollRecords as PayrollRecord[])]
                .filter(p=>Boolean(p.finalizedAt))
                .sort((a,b)=>{
                  const am=payrollPeriods.find((pp:PayrollPeriod)=>pp.id===a.periodId)?.monthStart ?? '';
                  const bm=payrollPeriods.find((pp:PayrollPeriod)=>pp.id===b.periodId)?.monthStart ?? '';
                  return bm.localeCompare(am) || (b.finalizedAt??'').localeCompare(a.finalizedAt??'');
                })
                .slice(0,4)
                .map(p=><div key={p.id} className="flex items-center justify-between rounded-xl bg-slate-50/80 border border-slate-100 px-3 py-2.5">
                  <span className="text-[11px] font-semibold text-slate-600">{payrollPeriods.find((pp:PayrollPeriod)=>pp.id===p.periodId)?.monthStart?.slice(0,7) ?? '—'}</span>
                  <span className="text-xs font-bold text-slate-950">{money(p.finalPay)}</span>
                </div>)}
            </div>
          </div>}
        </section>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <section className="bg-white rounded-2xl border border-slate-200 p-5 lg:col-span-2">
          <div className="flex items-center justify-between"><div><h3 className="font-bold text-sm">Leave balance</h3><p className="text-xs text-slate-500 mt-1">Unused paid leave carries forward.</p></div><CalendarDays className="w-5 h-5 text-blue-600" /></div>
          <div className="grid grid-cols-3 gap-3 mt-5">
            <Summary label="Available" value={currentLedger ? currentLedger.closingBalance : '—'} />
            <Summary label="Carry forward" value={currentLedger ? currentLedger.openingBalance : '—'} />
            <Summary label="This month added" value={currentLedger ? currentLedger.accrual : '1.5'} />
          </div>
          {currentLedger && <p className="text-[11px] text-slate-500 mt-4">Paid used: {currentLedger.paidUsed} · Unpaid used: {currentLedger.unpaidUsed}</p>}
        </section>
        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between"><div><h3 className="font-bold text-sm">Upcoming work</h3><p className="text-xs text-slate-500 mt-1">Your assigned tasks.</p></div><BriefcaseBusiness className="w-5 h-5 text-blue-600" /></div>
          <div className="mt-4 space-y-2">{dueTasks.map((t: Task) => <div key={t.id} className="p-3 rounded-xl bg-slate-50 border border-slate-100"><p className="text-xs font-bold">{t.title}</p><p className="text-[10px] text-slate-500 mt-1">Due {dateLabel(t.dueDate)} · {t.priority}</p></div>)}{!dueTasks.length && <p className="text-xs text-slate-400 py-6 text-center">No open tasks.</p>}</div>
        </section>
      </div>
    </PageShell>
  );
}

function propsHasAssignableDesignation(designations: Designation[] | undefined, id: string) {
  return Boolean(designations?.find(d => d.id === id)?.canAssignTasks);
}

function AttendanceEmployee({ user, attendance, holidays, leaveRequests = [], loginSessions = [], onRefresh }: any) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(new Date());

  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t); }, []);

  const employeeId = user.employeeDbId!;
  const base = new Date(today() + 'T12:00:00Z');
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + monthOffset);
  const y = base.getUTCFullYear(); const m = base.getUTCMonth();
  const monthStart = `${y}-${String(m+1).padStart(2,'0')}-01`;
  const days = new Date(Date.UTC(y,m+1,0)).getUTCDate();
  const first = new Date(Date.UTC(y,m,1,12)).getUTCDay();
  const offset = first === 0 ? 6 : first - 1;
  const current = attendance.find((a: AttendanceRecord) => a.date === today());

  const refreshRecord = async () => {
    await onRefresh();
  };

  const run = async (fn: () => Promise<any>, successMessage: string) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const result = await fn();
      if (!result?.success) {
        const message = result?.error ?? 'Action failed.';
        setMessage(message);
        notify(message, 'error');
        return;
      }
      notify(successMessage, 'success');
      await refreshRecord();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action failed.';
      setMessage(message);
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const state = current?.attendanceState ?? 'not_checked_in';
  const isRemote = user.workMode === 'remote';
  const todayClass = classifyDay(today(), holidays);
  const isHolidayToday = todayClass.type === 'holiday';
  const isSunday = todayClass.type === 'sunday_off';

  return (
    <PageShell title="My Attendance" subtitle="Check-in, breaks, checkout and your monthly history.">
      {message && <Notice type="error" text={message} />}
      <section className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-7">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div><p className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-bold">Today</p><h2 className="text-2xl font-bold mt-1">{dateLabel(today(), { weekday: 'long' })}</h2><p className="text-xs text-slate-500 mt-1">{isRemote ? 'Permanent remote · WFH check-in' : isHolidayToday ? 'Company holiday · no attendance required' : isSunday ? 'Weekly off · Sunday' : 'Monday–Saturday working day'}</p></div>
          <div className="text-left lg:text-right"><p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Live clock</p><p className="font-mono text-xl font-bold">{formatKolkataTime(now,true)}</p></div>
        </div>

        <div className="grid sm:grid-cols-4 gap-3 mt-6">
          <AttendanceMetric label="Check-in" value={current?.checkIn ?? '—'} />
          <AttendanceMetric label="Break" value={duration((current?.breakSeconds ?? 0) + (state === 'on_break' ? Math.floor((now.getTime() - new Date(current?.activeBreakStartIso ?? now).getTime()) / 1000) : 0))} />
          <AttendanceMetric label="Working" value={current ? liveWorking(current, now) : '00h 00m'} />
          <AttendanceMetric label="Check-out" value={current?.checkOut ?? '—'} />
        </div>

        {!isHolidayToday && !isSunday && (
          <div className="mt-6 flex flex-wrap gap-2">
            {!current && <button disabled={busy} onClick={() => void run(() => performCheckIn({ employeeId, mode: isRemote ? 'wfh' : 'office' }), `Checked in · ${isRemote ? 'WFH' : 'Office'}`)} className="px-5 py-3 rounded-xl bg-blue-600 text-white text-xs font-bold shadow-sm">{busy ? 'Saving…' : `Check in · ${isRemote ? 'WFH' : 'Office'}`}</button>}
            {current && state === 'working' && <button disabled={busy} onClick={() => void run(() => performStartBreak(current), 'Break started.')} className="px-5 py-3 rounded-xl bg-amber-500 text-white text-xs font-bold">{busy ? 'Saving…' : 'Start break'}</button>}
            {current && state === 'on_break' && <button disabled={busy} onClick={() => void run(() => performResumeWork(current), 'Work resumed.')} className="px-5 py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold">{busy ? 'Saving…' : 'Resume work'}</button>}
            {current && state === 'working' && <button disabled={busy} onClick={() => void run(() => performCheckOut(current), 'Checked out successfully.')} className="px-5 py-3 rounded-xl bg-slate-950 text-white text-xs font-bold">{busy ? 'Saving…' : 'Check out'}</button>}
            {state === 'on_break' && <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-3">Resume work before checking out.</span>}
            {state === 'completed' && <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-3">Attendance completed for today.</span>}
          </div>
        )}
      </section>

      <section className="mt-5 bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between gap-4"><div><h3 className="font-bold text-sm">Monthly calendar</h3><p className="text-xs text-slate-500 mt-1">Sunday is weekly off. Public and company holidays are paid non-working days.</p></div><div className="flex items-center gap-1"><button onClick={() => setMonthOffset(v=>v-1)} className="p-2 rounded-lg hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button><span className="px-3 text-xs font-bold min-w-28 text-center">{base.toLocaleDateString('en-IN',{month:'long',year:'numeric',timeZone:'Asia/Kolkata'})}</span><button onClick={() => setMonthOffset(v=>v+1)} className="p-2 rounded-lg hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button></div></div>
        <div className="grid grid-cols-7 gap-1 mt-5">{['MON','TUE','WED','THU','FRI','SAT','SUN'].map((d,i)=><div key={d} className={`text-[9px] font-bold text-center py-2 ${i===6?'text-purple-600':'text-slate-400'}`}>{d}</div>)}{Array.from({length:offset}).map((_,i)=><div key={`e${i}`} className="h-20 bg-slate-50 rounded-xl" />)}{Array.from({length:days},(_,i)=>{
          const d=i+1; const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; const cl=classifyDay(ds,holidays); const r=attendance.find((a:AttendanceRecord)=>a.date===ds);
          const approvedLeave=(leaveRequests as LeaveRequest[]).find((l)=>l.status==='approved'&&l.startDate<=ds&&l.endDate>=ds);
          const isFuture=ds>today(); const isBeforeJoin=Boolean(user.joinDate&&ds<user.joinDate);
          const label=isBeforeJoin?'Not joined':r?.status==='late'?'Late':r?.mode==='wfh'?'WFH':r?.status==='present'?'Present':r?.status==='leave'?'Leave':cl.type==='holiday'?'Holiday':cl.type==='sunday_off'?'Off':approvedLeave?'Leave':isFuture?'Upcoming':ds===today()?'Not checked-in':'Not recorded';
          const style=label==='Present'?'text-emerald-700 bg-emerald-50 border-emerald-200':label==='WFH'?'text-sky-700 bg-sky-50 border-sky-200':label==='Late'?'text-amber-700 bg-amber-50 border-amber-200':label==='Leave'?'text-purple-700 bg-purple-50 border-purple-200':label==='Holiday'?'text-indigo-700 bg-indigo-50 border-indigo-200':label==='Off'?'text-purple-600 bg-purple-50 border-purple-100':label==='Upcoming'?'text-slate-400 bg-white border-slate-100':'text-slate-500 bg-slate-50 border-slate-200';
          return <div key={ds} title={cl.type==='holiday'?cl.label:approvedLeave?'Approved leave':label} className={`h-20 rounded-xl border p-2 flex flex-col justify-between ${ds===today()?'ring-2 ring-blue-500/20':''} `}><span className="text-xs font-bold">{d}</span><span className={`text-[9px] rounded-md px-1.5 py-1 border font-bold truncate ${style}`}>{label}</span></div>;
        })}</div>
      </section>
      <section className="mt-5 bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-bold text-sm">Login sessions</h3>
          <p className="text-xs text-slate-500 mt-1">Login/logout history is separate from attendance check-in/check-out.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider"><tr><Th>Login</Th><Th>Logout</Th><Th>Session</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loginSessions.slice(0,50).map((s:any)=><tr key={s.id}>
                <Td mono>{new Date(s.loginTime).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</Td>
                <Td mono>{s.logoutTime?new Date(s.logoutTime).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'Active'}</Td>
                <Td mono>{s.duration==null?'—':duration(Number(s.duration))}</Td>
                <Td><StatusBadge label={s.status}/></Td>
              </tr>)}
              {!loginSessions.length && <EmptyRow colSpan={4} text="No login sessions yet."/>}
            </tbody>
          </table>
        </div>
      </section>
    </PageShell>
  );
}

function liveWorking(record: AttendanceRecord, now: Date) {
  if (record.checkOutIso) return duration(record.workingSeconds);
  const elapsed = Math.max(0, Math.floor((now.getTime() - new Date(record.checkInIso ?? now).getTime()) / 1000));
  const activeBreak = record.attendanceState === 'on_break' && record.activeBreakStartIso ? Math.max(0, Math.floor((now.getTime() - new Date(record.activeBreakStartIso).getTime()) / 1000)) : 0;
  return duration(Math.max(0, elapsed - Number(record.breakSeconds ?? 0) - activeBreak));
}

function TasksEmployee({ user, tasks, employees, designations, rules, onRefresh }: any) {
  const [submitId, setSubmitId] = useState('');
  const [link, setLink] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const assignRequestRef = useRef<string | null>(null);
  const myId = user.employeeDbId!;
  const canAssign = Boolean(user.designationId && (designations as Designation[]).some((d:Designation)=>d.id===user.designationId && d.canAssignTasks));
  const visible = tasks.filter((t:Task)=>t.assignedTo===myId || t.assignedBy===myId).sort((a:Task,b:Task)=>a.status===b.status?a.dueDate.localeCompare(b.dueDate):a.status==='completed'?1:-1);
  const targets = (employees as Employee[]).filter((e)=>e.status==='active' && e.id!==myId && (rules as AssignmentRule[]).some(r=>r.assignerDesignationId===user.designationId && (r.assigneeDesignationId==null || r.assigneeDesignationId===e.designationId) && (r.scope==='any' || (r.scope==='direct_reports' && e.managerId===myId))));

  async function submitTask() {
    if (submitBusy || !submitId) return;
    setMessage('');
    const cleanLink=link.trim();
    if (!/^https?:\/\//i.test(cleanLink)) { setMessage('Paste a valid http(s) work link.'); notify('Paste a valid work link.','error'); return; }
    setSubmitBusy(true);
    try {
      const { error } = await (supabase as any).rpc('submit_task',{p_task_id:submitId,p_submitted_link:cleanLink});
      if(error) throw error;
      notify('Work submitted successfully.','success');
      setSubmitId('');setLink('');
      await onRefresh();
    } catch(error) {
      const message=error instanceof Error?error.message:'Unable to submit work.';
      setMessage(message);
      notify(message,'error');
    } finally {
      setSubmitBusy(false);
    }
  }

  async function assignTask(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();setMessage('');
    if(assignBusy)return;
    const fd=new FormData(e.currentTarget);
    const title=String(fd.get('title')??'').trim(),to=String(fd.get('assignedTo')??''),start=String(fd.get('startDate')??''),due=String(fd.get('dueDate')??'');
    if(!title||!to||!start||!due){setMessage('Complete all required task fields.');return;}
    if(due<start){setMessage('Due date cannot be before the start date.');return;}
    assignRequestRef.current=crypto.randomUUID();setAssignBusy(true);
    try{
      const {error}=await (supabase as any).rpc('create_task',{p_title:title,p_description:clean(fd.get('description')),p_assigned_to:to,p_start_date:start,p_due_date:due,p_priority:String(fd.get('priority')??'medium'),p_client_request_id:assignRequestRef.current});
      if(error)throw error;
      notify('Task assigned successfully.','success');
      e.currentTarget.reset();setAssignOpen(false);await onRefresh();
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to assign task.');notify(error instanceof Error?error.message:'Unable to assign task.','error');}
    finally{assignRequestRef.current=null;setAssignBusy(false);}
  }

  return <PageShell title="Work & Assignments" subtitle="Assignments, progress and completed work.">
    {message&&<Notice type="error" text={message}/>}
    <div className="flex flex-col sm:flex-row gap-3 justify-between mb-4">
      <div className="flex items-center gap-2"><div className="text-xs text-slate-500">{visible.length} task(s)</div>{canAssign&&<span className="text-[10px] rounded-full bg-blue-50 text-blue-700 border border-blue-100 px-2 py-1">You can assign</span>}</div>
      {canAssign&&<button onClick={()=>setAssignOpen(v=>!v)} className="btn-primary"><Plus className="w-4 h-4"/>{assignOpen?'Close':'Assign task'}</button>}
    </div>
    {assignOpen&&<TaskAssignForm targets={targets} onSubmit={assignTask} onClose={()=>setAssignOpen(false)} busy={assignBusy}/>}
    <TaskTable tasks={visible} employeeId={myId} onSubmit={(id)=>{setSubmitId(id);setLink('')}} onRefresh={onRefresh}/>
    {submitId&&<Modal title="Submit completed work" onClose={()=>setSubmitId('')}><div className="space-y-4"><div className="rounded-2xl bg-slate-50 border border-slate-200 p-4"><p className="text-sm font-semibold text-slate-900">Paste the final work link</p><p className="text-xs text-slate-500 mt-1">Submitting the link marks the assignment completed and makes the result visible to the person who assigned it.</p></div><input autoFocus value={link} onChange={e=>setLink(e.target.value)} placeholder="https://your-work-link.com" className="input"/><div className="flex justify-end gap-2"><button onClick={()=>setSubmitId('')} className="btn-secondary">Cancel</button><button disabled={!link.trim()||submitBusy} onClick={()=>void submitTask()} className="btn-primary">{submitBusy?<><RefreshCw className="w-4 h-4 animate-spin"/>Submitting…</>:<><CheckCircle2 className="w-4 h-4"/>Submit work</>}</button></div></div></Modal>}
  </PageShell>;
}

function TasksAdmin({ tasks, employees, designations, onRefresh }: any) {
  const [from,setFrom]=useState('');const [to,setTo]=useState('');const [employee,setEmployee]=useState('all');const [designation,setDesignation]=useState('all');const [status,setStatus]=useState('all');const [priority,setPriority]=useState('all');const [assignOpen,setAssignOpen]=useState(false);const [message,setMessage]=useState('');const [assignBusy,setAssignBusy]=useState(false);const assignRequestRef=useRef<{signature:string;id:string}|null>(null);
  const activeEmployees=(employees as Employee[]).filter(e=>e.status==='active');
  const filtered=(tasks as Task[]).filter(t=>(!from||t.startDate>=from)&&(!to||t.startDate<=to)&&(employee==='all'||t.assignedTo===employee)&&(designation==='all'||t.assignedToDesignation===designation)&&(status==='all'||t.status===status)&&(priority==='all'||t.priority===priority)).sort((a:Task,b:Task)=>b.updatedAt.localeCompare(a.updatedAt));
  async function assignTask(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();setMessage('');
    if(assignBusy)return;
    const fd=new FormData(e.currentTarget);
    const title=String(fd.get('title')||'').trim(),toId=String(fd.get('assignedTo')||''),start=String(fd.get('startDate')||today()),due=String(fd.get('dueDate')||today()),priorityValue=String(fd.get('priority')||'medium');
    if(!title||!toId){setMessage('Task title and employee are required.');return;}
    if(due<start){setMessage('Due date cannot be before the start date.');return;}
    const description=clean(fd.get('description'));
    const signature=JSON.stringify([title,description,toId,start,due,priorityValue]);
    if(assignRequestRef.current?.signature!==signature)assignRequestRef.current={signature,id:crypto.randomUUID()};
    setAssignBusy(true);
    try{
      const {error}=await (supabase as any).rpc('create_task',{p_title:title,p_description:description,p_assigned_to:toId,p_start_date:start,p_due_date:due,p_priority:priorityValue,p_client_request_id:assignRequestRef.current.id});
      if(error)throw error;
      assignRequestRef.current=null;notify('Task assigned successfully.','success');e.currentTarget.reset();setAssignOpen(false);await onRefresh();
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to assign task.');notify(error instanceof Error?error.message:'Unable to assign task.','error');}
    finally{setAssignBusy(false);}
  }
  return <PageShell title="Work & Assignments" subtitle="Admin view of assignments, submissions and completion history.">
    {message&&<Notice type="error" text={message}/>}
    <div className="bg-white rounded-2xl border border-slate-200 p-4 grid sm:grid-cols-2 lg:grid-cols-6 gap-2">
      <FilterInput label="From date"><input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="input"/></FilterInput>
      <FilterInput label="To date"><input type="date" value={to} onChange={e=>setTo(e.target.value)} className="input"/></FilterInput>
      <FilterInput label="Employee"><select value={employee} onChange={e=>setEmployee(e.target.value)} className="input"><option value="all">All employees</option>{activeEmployees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></FilterInput>
      <FilterInput label="Designation"><select value={designation} onChange={e=>setDesignation(e.target.value)} className="input"><option value="all">All</option>{(designations as Designation[]).map(d=><option key={d.id} value={d.name}>{d.name}</option>)}</select></FilterInput>
      <FilterInput label="Status"><select value={status} onChange={e=>setStatus(e.target.value)} className="input"><option value="all">All</option><option value="assigned">Assigned</option><option value="completed">Completed</option></select></FilterInput>
      <FilterInput label="Priority"><select value={priority} onChange={e=>setPriority(e.target.value)} className="input"><option value="all">All</option>{['low','medium','high','urgent'].map(x=><option key={x}>{x}</option>)}</select></FilterInput>
    </div>
    <div className="flex justify-between items-center mt-4"><p className="text-xs text-slate-500">{filtered.length} task(s)</p><button onClick={()=>setAssignOpen(v=>!v)} className="btn-primary"><Plus className="w-4 h-4"/>{assignOpen?'Close':'Assign task'}</button></div>
    {assignOpen&&<TaskAssignForm targets={activeEmployees} onSubmit={assignTask} onClose={()=>setAssignOpen(false)} busy={assignBusy}/>}
    <TaskTable tasks={filtered} employeeId="" onSubmit={()=>{}} onRefresh={onRefresh} admin/>
  </PageShell>;
}

function TaskAssignForm({targets,onSubmit,onClose,busy=false}:{targets:Employee[];onSubmit:(e:React.FormEvent<HTMLFormElement>)=>void;onClose:()=>void;busy?:boolean}) {
  return <form onSubmit={onSubmit} className="bg-white border border-slate-200 rounded-2xl p-5 mt-4 grid md:grid-cols-2 gap-4">
    <label className="md:col-span-2"><span className="label">Task</span><input name="title" className="input" required/></label>
    <label className="md:col-span-2"><span className="label">Description</span><textarea name="description" className="input min-h-20"/></label>
    <label><span className="label">Assign To</span><select name="assignedTo" className="input" required><option value="">Select employee</option>{targets.map(e=><option key={e.id} value={e.id}>{e.name} · {e.designation}</option>)}</select></label>
    <label><span className="label">Priority</span><select name="priority" defaultValue="medium" className="input"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="urgent">urgent</option></select></label>
    <label><span className="label">Start Date</span><input type="date" name="startDate" defaultValue={today()} className="input" required/></label>
    <label><span className="label">Due Date</span><input type="date" name="dueDate" defaultValue={today()} className="input" required/></label>
    <div className="md:col-span-2 flex justify-end gap-2"><button type="button" onClick={onClose} className="btn-secondary">Cancel</button><button disabled={busy} className="btn-primary">{busy?'Assigning…':'Assign'}</button></div>
  </form>;
}

function TaskTable({tasks,employeeId,onSubmit,admin}:{tasks:Task[];employeeId:string;onSubmit:(id:string)=>void;onRefresh:()=>Promise<void>;admin?:boolean}) {
  return <div className="mt-4 bg-white rounded-2xl border border-slate-200 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-xs">
    <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider"><tr><Th>Task</Th><Th>Assigned To</Th><Th>Dates</Th><Th>Priority</Th><Th>Status</Th><Th>Work Link</Th><Th>Action</Th></tr></thead>
    <tbody className="divide-y divide-slate-100">{tasks.map(t=><tr key={t.id}><Td strong>{t.title}<span className="block text-[10px] text-slate-400">{t.description}</span></Td><Td>{t.assignedToName}<span className="block text-[10px] text-slate-400">{t.assignedToDesignation}</span></Td><Td>{dateLabel(t.startDate)} → {dateLabel(t.dueDate)}</Td><Td><PriorityBadge value={t.priority}/></Td><Td><StatusBadge label={t.status}/></Td><Td>{t.submittedLink?<div className="space-y-0.5"><a href={t.submittedLink} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1"><Link2 className="w-3.5 h-3.5"/>Open work</a>{t.submittedAt&&<span className="block text-[10px] text-slate-400">{new Date(t.submittedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</span>}</div>:'—'}</Td><Td>{!admin&&t.assignedTo===employeeId&&t.status!=='completed'?<button onClick={()=>onSubmit(t.id)} className="btn-secondary">Submit</button>:'—'}</Td></tr>)}{!tasks.length&&<EmptyRow colSpan={7} text="No tasks match the current filters."/>}</tbody>
  </table></div></div>;
}

function EmployeesAdmin({ employees, departments, designations, onRefresh }: any) {
  const [search,setSearch]=useState(''); const [status,setStatus]=useState('all'); const [modal,setModal]=useState<'create'|'edit'|null>(null); const [editing,setEditing]=useState<Employee|null>(null); const [statusBusyId,setStatusBusyId]=useState<string|null>(null);
  const filtered=(employees as Employee[]).filter(e=>(status==='all'||e.status===status)&&(!search.trim()||`${e.name} ${e.empId} ${e.loginId} ${e.workEmail}`.toLowerCase().includes(search.toLowerCase())));
  return <PageShell title="Employees / HR" subtitle="Create accounts, assign people, manage credentials and onboarding documents.">
    <div className="flex flex-col sm:flex-row gap-2 justify-between">
      <div className="flex gap-2 flex-1"><div className="relative flex-1 max-w-xl"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, employee ID or Login ID…" className="input pl-9"/></div><select value={status} onChange={e=>setStatus(e.target.value)} className="input w-auto"><option value="all">All status</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      <button onClick={()=>{setEditing(null);setModal('create')}} className="btn-primary"><UserPlus className="w-4 h-4"/>Add employee</button>
    </div>
    <div className="mt-4 bg-white rounded-2xl border border-slate-200 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-xs">
      <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider"><tr><Th>Employee</Th><Th>Login ID</Th><Th>Designation</Th><Th>Department</Th><Th>Work Mode</Th><Th>Salary</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
      <tbody className="divide-y divide-slate-100">{filtered.map(e=><tr key={e.id}><Td strong>{e.name}<span className="block text-[10px] text-slate-400">{e.empId}</span></Td><Td mono>{e.loginId}</Td><Td>{e.designation}</Td><Td>{e.department||'—'}</Td><Td>{e.workMode==='remote'?'Remote':'Office'}</Td><Td>{money(e.currentSalary)}</Td><Td><StatusBadge label={e.status}/></Td><Td><div className="flex items-center gap-1.5"><button title="Edit" onClick={()=>{setEditing(e);setModal('edit')}} className="icon-btn"><Pencil className="w-4 h-4"/></button><button disabled={statusBusyId===e.id} title={e.status==='active'?'Deactivate':'Activate'} onClick={async()=>{if(statusBusyId)return;if(!confirm(e.status==='active'?'Deactivate this employee account? Historical records will be preserved and login access will be disabled.':'Activate this employee account?'))return;setStatusBusyId(e.id);try{await invokeEmployeeAdmin({action:'set_status',employeeId:e.id,status:e.status==='active'?'inactive':'active'});notify(e.status==='active'?'Employee access disabled; history preserved.':'Employee account activated.','success');await onRefresh();}catch(error){notify(error instanceof Error?error.message:'Unable to update employee status.','error')}finally{setStatusBusyId(null);}}} className="icon-btn">{statusBusyId===e.id?<RefreshCw className="w-4 h-4 animate-spin"/>:<Trash2 className="w-4 h-4"/>}</button></div></Td></tr>)}{!filtered.length&&<EmptyRow colSpan={8} text="No employees yet. Add the first employee to create their login."/>}</tbody>
    </table></div></div>
    {modal&&<EmployeeModal mode={modal} employee={editing} departments={departments} designations={designations} employees={employees} onClose={()=>setModal(null)} onSaved={onRefresh}/>}
  </PageShell>;
}

function EmployeeModal({mode,employee,departments,designations,employees,onClose,onSaved}:{mode:'create'|'edit';employee:Employee|null;departments:Department[];designations:Designation[];employees:Employee[];onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false);const [resetBusy,setResetBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState<{loginId:string;password?:string}|null>(null);
  const [docs,setDocs]=useState<{type:string;file:File|null}[]>(ALL_DOCUMENT_TYPES.map(type=>({type,file:null})));
  const [liveDesignations,setLiveDesignations]=useState<Designation[]>(designations);
  const [liveDepartments,setLiveDepartments]=useState<Department[]>(departments);
  const [refsLoading,setRefsLoading]=useState(true);
  const [form,setForm]=useState({
    name:employee?.name??'',workEmail:employee?.workEmail??'',phone:employee?.phone??'',loginId:employee?.loginId??'',
    password:'',confirmPassword:'',workMode:employee?.workMode??'office',designationId:employee?.designationId??'',designationName:employee?.designation??'',
    departmentId:employee?.departmentId??'',departmentName:employee?.department??'',managerId:employee?.managerId??'',managerName:employee?.manager??'',joinDate:employee?.joinDate??today(),shiftStart:employee?.shift??'09:00',shiftEnd:employee?.shiftEnd??'18:00',monthlySalary:String(employee?.currentSalary??0)
  });
  const [employeeDocs,setEmployeeDocs]=useState<EmployeeDocument[]>([]);
  useEffect(()=>{
    // The parent already loads these reference rows with the authenticated session.
    // Do not make a second table request from the modal: that request can fail under
    // an otherwise valid admin session and is unnecessary for employee creation.
    setLiveDesignations(designations);
    setLiveDepartments(departments);
    setRefsLoading(false);

    setForm(prev=>{
      const byName=(designations??[]).find((d:Designation)=>d.name.trim().toLowerCase()===String(prev.designationName||'').trim().toLowerCase());
      const byId=(designations??[]).find((d:Designation)=>d.id===prev.designationId);
      const d=byName??byId??designations?.[0];
      const depByName=(departments??[]).find((x:Department)=>x.name.trim().toLowerCase()===String(prev.departmentName||'').trim().toLowerCase());
      const depById=(departments??[]).find((x:Department)=>x.id===prev.departmentId);
      const dep=depByName??depById;
      return {
        ...prev,
        designationId:d?.id??'',
        designationName:d?.name??'',
        departmentId:prev.departmentName || prev.departmentId ? (dep?.id??'') : '',
        departmentName:prev.departmentName || prev.departmentId ? (dep?.name??'') : '',
      };
    });
  },[designations,departments]);

  useEffect(()=>{ if(mode==='edit'&&employee){void (async()=>{const {data}=await (supabase as any).from('employee_documents').select('*').eq('employee_id',employee.id).order('created_at',{ascending:false});if(data)setEmployeeDocs(data.map((r:any)=>({id:r.id,employeeId:r.employee_id,documentType:r.document_type,fileName:r.file_name,storagePath:r.storage_path,mimeType:r.mime_type,sizeBytes:r.size_bytes,createdAt:r.created_at})));})();}},[mode,employee]);
  const set=(key:string,value:string)=>setForm(f=>({...f,[key]:value}));
  const save=async(e:React.FormEvent)=>{e.preventDefault();setError('');setBusy(true);
    try{
      const salary=Number(form.monthlySalary); if(!Number.isFinite(salary)||salary<0)throw new Error('Enter a valid monthly salary.');
      if(refsLoading) throw new Error('Employee reference data is still loading. Please wait a moment and try again.');
      const currentDesignation =
        liveDesignations.find((d:Designation)=>d.name.trim().toLowerCase()===String(form.designationName||'').trim().toLowerCase()) ??
        liveDesignations.find((d:Designation)=>d.id===form.designationId);
      if(!currentDesignation) throw new Error('Please select a valid designation.');
      const currentDepartment = form.departmentName
        ? liveDepartments.find((d:Department)=>d.name.trim().toLowerCase()===String(form.departmentName).trim().toLowerCase()) ??
          liveDepartments.find((d:Department)=>d.id===form.departmentId)
        : null;
      if(form.departmentName && !currentDepartment) throw new Error('Please select a valid department.');

      if(mode==='create'){
        if(form.password!==form.confirmPassword)throw new Error('Passwords do not match.');
        const result=await invokeEmployeeAdmin({action:'create_employee',name:form.name,workEmail:form.workEmail||null,phone:form.phone||null,loginId:form.loginId,password:form.password,workMode:form.workMode,designationId:currentDesignation.id,designationName:currentDesignation.name,departmentId:currentDepartment?.id||null,departmentName:currentDepartment?.name||null,managerId:form.managerId||null,managerName:form.managerName||null,joinDate:form.joinDate,shiftStart:form.shiftStart,shiftEnd:form.shiftEnd,monthlySalary:salary});
        const failedDocs:string[]=[];
        for(const doc of docs){if(!doc.file)continue;try{await uploadEmployeeDocument(result.employeeId,doc.file,doc.type)}catch(docError){failedDocs.push(doc.type)}}
        if(failedDocs.length){setError(`Employee created. Some HR documents still need uploading: ${failedDocs.join(', ')}.`);notify('Employee created; some HR documents need attention.','info')}else{notify('Employee created successfully.','success')}
        setSuccess({loginId:result.loginId}); await onSaved();
      }else{
        await invokeEmployeeAdmin({action:'update_employee',employeeId:employee!.id,name:form.name,workEmail:form.workEmail||null,phone:form.phone||null,workMode:form.workMode,designationId:currentDesignation.id,designationName:currentDesignation.name,departmentId:currentDepartment?.id||null,departmentName:currentDepartment?.name||null,managerId:form.managerId||null,managerName:form.managerName||null,joinDate:form.joinDate,shiftStart:form.shiftStart,shiftEnd:form.shiftEnd,monthlySalary:salary});
        const failedDocs:string[]=[];
        for(const doc of docs){if(!doc.file)continue;try{await uploadEmployeeDocument(employee!.id,doc.file,doc.type)}catch{failedDocs.push(doc.type)}}
        if(failedDocs.length)notify(`Employee updated; failed document uploads: ${failedDocs.join(', ')}`,'info');else notify('Employee details updated.','success');
        await onSaved(); onClose();
      }
    }catch(err){const message=err instanceof Error?err.message:'Unable to save employee.';setError(message);notify(message,'error')}finally{setBusy(false);}
  };
  async function resetPassword(){if(!employee||resetBusy)return;setError('');setResetBusy(true);try{const r=await invokeEmployeeAdmin({action:'reset_password',employeeId:employee.id});setSuccess({loginId:r.loginId,password:r.temporaryPassword});notify('Temporary password generated.','success')}catch(e){const message=e instanceof Error?e.message:'Unable to reset password.';setError(message);notify(message,'error')}finally{setResetBusy(false)}}
  async function viewDoc(doc:EmployeeDocument){try{const url=await getSignedDocumentUrl(doc.storagePath);window.open(url,'_blank','noopener,noreferrer')}catch(e){const message=e instanceof Error?e.message:'Unable to open document.';setError(message);notify(message,'error')}}
  return <Modal title={mode==='create'?'Add employee':'Edit employee'} onClose={onClose} closeDisabled={busy||resetBusy} wide>
    {success&&<div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex items-center gap-2 text-emerald-800 font-bold text-sm"><CheckCircle2 className="w-4 h-4"/>Employee account ready</div><p className="text-xs text-emerald-700 mt-2">Login ID: <b>{success.loginId}</b>{success.password&&<> · Temporary password: <b>{success.password}</b></>}</p>{mode==='create'&&<p className="text-[11px] text-emerald-700 mt-2">Share the password securely. It is not stored in the employee record.</p>}</div>}
    {error&&<Notice type="error" text={error}/>}
    <form onSubmit={save} className="space-y-6">
      <FormSection title="Personal details" icon={<UserRound className="w-4 h-4"/>}><div className="grid md:grid-cols-2 gap-4"><Field label="Full name"><input value={form.name} onChange={e=>set('name',e.target.value)} className="input" required/></Field><Field label="Work email"><input type="email" value={form.workEmail} onChange={e=>set('workEmail',e.target.value)} className="input"/></Field><Field label="Phone"><input value={form.phone} onChange={e=>set('phone',e.target.value)} className="input"/></Field><Field label="Join date"><input type="date" value={form.joinDate} onChange={e=>set('joinDate',e.target.value)} className="input" required/></Field></div></FormSection>
      <FormSection title="Assignment" icon={<BriefcaseBusiness className="w-4 h-4"/>}><div className="grid md:grid-cols-2 gap-4"><Field label="Designation"><select disabled={refsLoading||!liveDesignations.length} value={form.designationName} onChange={e=>{const name=e.target.value;const d=liveDesignations.find(x=>x.name===name);setForm(f=>({...f,designationName:name,designationId:d?.id??''}))}} className="input" required><option value="">Select designation</option>{liveDesignations.map(d=><option key={d.id} value={d.name}>{d.name}</option>)}</select></Field><Field label="Department"><select disabled={refsLoading} value={form.departmentName} onChange={e=>{const name=e.target.value;const d=liveDepartments.find(x=>x.name===name);setForm(f=>({...f,departmentName:name,departmentId:d?.id??''}))}} className="input"><option value="">No department</option>{liveDepartments.map(d=><option key={d.id} value={d.name}>{d.name}</option>)}</select></Field><Field label="Manager"><select value={form.managerId} onChange={e=>set('managerId',e.target.value)} className="input"><option value="">No manager</option>{employees.filter((e:Employee)=>e.status==='active'&&e.id!==employee?.id).map((e:Employee)=><option key={e.id} value={e.id}>{e.name} · {e.designation}</option>)}</select></Field><Field label="Work mode"><select value={form.workMode} onChange={e=>set('workMode',e.target.value)} className="input"><option value="office">Office</option><option value="remote">Remote</option></select></Field><Field label="Shift start"><input type="time" value={form.shiftStart} onChange={e=>set('shiftStart',e.target.value)} className="input" required/></Field><Field label="Shift end"><input type="time" value={form.shiftEnd} onChange={e=>set('shiftEnd',e.target.value)} className="input" required/></Field><Field label="Monthly salary"><input type="number" min="0" step="0.01" value={form.monthlySalary} onChange={e=>set('monthlySalary',e.target.value)} className="input" required/></Field></div></FormSection>
      {mode==='create'&&<FormSection title="Login" icon={<KeyRound className="w-4 h-4"/>}><div className="grid md:grid-cols-3 gap-4"><Field label="Login ID"><input value={form.loginId} onChange={e=>set('loginId',e.target.value)} className="input" autoComplete="off" required pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}"/></Field><Field label="Password"><input type="password" value={form.password} onChange={e=>set('password',e.target.value)} className="input" autoComplete="new-password" minLength={12} required/></Field><Field label="Confirm password"><input type="password" value={form.confirmPassword} onChange={e=>set('confirmPassword',e.target.value)} className="input" autoComplete="new-password" minLength={12} required/></Field></div></FormSection>}
      {mode==='create'&&<FormSection title="HR onboarding documents" icon={<Upload className="w-4 h-4"/>}><div className="grid md:grid-cols-2 gap-3">{docs.map((d,i)=><div key={d.type} className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-700">{d.type}</p><input type="file" onChange={e=>setDocs(prev=>prev.map((x,idx)=>idx===i?{...x,file:e.target.files?.[0]??null}:x))} className="mt-2 block w-full text-[11px]"/></div>)}</div></FormSection>}
      {mode==='edit'&&<FormSection title="HR documents" icon={<FileText className="w-4 h-4"/>}><div className="space-y-2">{employeeDocs.map(d=><button type="button" key={d.id} onClick={()=>void viewDoc(d)} className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-left"><span><span className="block text-xs font-bold">{d.documentType}</span><span className="block text-[10px] text-slate-500">{d.fileName}</span></span><Eye className="w-4 h-4 text-slate-400"/></button>)}{!employeeDocs.length&&<p className="text-xs text-slate-500">No documents uploaded yet.</p>}</div><div className="grid md:grid-cols-2 gap-3">{docs.map((d,i)=><div key={d.type} className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold">{d.type}</p><input type="file" onChange={e=>setDocs(prev=>prev.map((x,idx)=>idx===i?{...x,file:e.target.files?.[0]??null}:x))} className="mt-2 block w-full text-[11px]"/></div>)}</div></FormSection>}
      <div className="flex flex-col sm:flex-row justify-between gap-2 pt-2">{mode==='edit'?<button type="button" onClick={()=>void resetPassword()} className="btn-secondary"><KeyRound className="w-4 h-4"/>Reset password</button>:<span/>}<div className="flex justify-end gap-2"><button type="button" disabled={busy||resetBusy} onClick={onClose} className="btn-secondary disabled:opacity-50">Cancel</button><button disabled={busy} className="btn-primary">{busy?'Saving…':mode==='create'?'Create employee':'Save changes'}</button></div></div>
    </form>
  </Modal>;
}

function AttendanceAdmin({attendance,employees,leaveRequests,wfhRequests,holidays}:any){
  const [date,setDate]=useState(today());const [search,setSearch]=useState('');const cl=classifyDay(date,holidays);
  const rows=(employees as Employee[]).filter(e=>e.status==='active'&&(!search||`${e.name}${e.empId}`.toLowerCase().includes(search.toLowerCase()))).map(e=>{
    const record=attendance.find((a:AttendanceRecord)=>a.employeeId===e.id&&a.date===date);const leave=leaveRequests.find((l:LeaveRequest)=>l.employeeId===e.id&&l.status==='approved'&&l.startDate<=date&&l.endDate>=date);
    return {e,record,leave};
  });
  return <PageShell title="Attendance" subtitle="Daily attendance with explicit login/check-in/break/check-out separation."><div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row gap-3"><label className="flex-1"><span className="label">Date</span><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="input"/></label><label className="flex-1"><span className="label">Search</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search employee…" className="input"/></label></div><div className="mt-4 bg-white border border-slate-200 rounded-2xl p-4 text-xs flex items-center gap-2"><CalendarDays className="w-4 h-4 text-blue-600"/><b>{dateLabel(date,{weekday:'long'})}</b><span className="text-slate-500">· {cl.label}</span></div><div className="mt-4 bg-white rounded-2xl border border-slate-200 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase tracking-wider"><tr><Th>Employee</Th><Th>Mode</Th><Th>Check-in</Th><Th>Break</Th><Th>Check-out</Th><Th>Working</Th><Th>Status</Th></tr></thead><tbody className="divide-y divide-slate-100">{cl.isWorkingDay?rows.map(({e,record,leave}:any)=><tr key={e.id}><Td strong>{e.name}<span className="block text-[10px] text-slate-400">{e.empId}</span></Td><Td>{leave?'Leave':record?.mode==='wfh'?'WFH':record?'Office':e.workMode==='remote'?'WFH':'—'}</Td><Td mono>{record?.checkIn??'—'}</Td><Td mono>{record?duration(record.breakSeconds):'—'}</Td><Td mono>{record?.checkOut??'—'}</Td><Td mono>{record?duration(record.workingSeconds):'—'}</Td><Td><StatusBadge label={leave?'Leave':record?.status??(e.joinDate&&date<e.joinDate?'Not joined':date>today()?'Upcoming':date===today()?'Not checked-in':'Not recorded')}/></Td></tr>):<tr><td colSpan={7} className="p-10 text-center text-sm text-slate-500">{cl.label}. No check-in required.</td></tr>}{cl.isWorkingDay&&!rows.length&&<EmptyRow colSpan={7} text="No active employees."/ >}</tbody></table></div></div></PageShell>;
}

function RequestsAdmin({leaveRequests,wfhRequests,corrections,onRefresh}:any){
  const [tab,setTab]=useState<'leave'|'wfh'|'corrections'>('leave');
  const [busyKey,setBusyKey]=useState<string|null>(null);
  async function review(table:string,id:string,status:'approved'|'rejected'){const key=table+':'+id;if(busyKey)return;setBusyKey(key);try{const {data,error}=await(supabase as any).from(table).update({status,reviewed_at:new Date().toISOString()}).eq('id',id).eq('status','pending').select('id').maybeSingle();if(error)throw error;if(!data)throw new Error('This request was already reviewed. Refresh the list.');notify(status==='approved'?'Request approved.':'Request rejected.',status==='approved'?'success':'info');await onRefresh();}catch(error){notify(error instanceof Error?error.message:'Unable to review request.','error')}finally{setBusyKey(null);}}
  return <PageShell title="Requests" subtitle="Review employee leave, WFH and attendance correction requests."><div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">{[['leave','Leave'],['wfh','WFH'],['corrections','Corrections']].map(([id,l])=><button key={id} onClick={()=>setTab(id as any)} className={`px-4 py-2 rounded-lg text-xs font-bold ${tab===id?'bg-white shadow-sm text-slate-900':'text-slate-500'}`}>{l}</button>)}</div>{tab==='leave'&&<RequestTable type="leave" rows={leaveRequests} onReview={(id,s)=>void review('leave_requests',id,s)} busyKey={busyKey} />}{tab==='wfh'&&<RequestTable type="wfh" rows={wfhRequests} onReview={(id,s)=>void review('wfh_requests',id,s)} busyKey={busyKey} />}{tab==='corrections'&&<RequestTable type="corrections" rows={corrections} onReview={(id,s)=>void review('regularization_requests',id,s)} busyKey={busyKey} />}</PageShell>;
}

function RequestTable({type,rows,onReview,busyKey}:{type:'leave'|'wfh'|'corrections';rows:any[];onReview:(id:string,s:'approved'|'rejected')=>void;busyKey:string|null}){
  const title=type==='leave'?'Leave requests':type==='wfh'?'WFH requests':'Correction requests';
  return <div className="mt-4 bg-white rounded-2xl border border-slate-200 overflow-hidden"><div className="p-4 border-b border-slate-100"><h3 className="font-bold text-sm">{title}</h3></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500 uppercase tracking-wider"><tr><Th>Employee</Th><Th>Date</Th><Th>Details</Th><Th>Status</Th><Th>Action</Th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map(r=><tr key={r.id}><Td strong>{r.employeeName}<span className="block text-[10px] text-slate-400">{r.department}</span></Td><Td>{type==='leave'?dateLabel(r.startDate)+' → '+dateLabel(r.endDate):dateLabel(r.date)}</Td><Td>{type==='leave'?`${r.leaveType} · ${r.days} day(s) · paid ${r.paidDays??0} · unpaid ${r.unpaidDays??0} · ${r.reason}`:type==='wfh'?`${r.duration} · ${r.reason}`:`${r.originalCheckIn||'—'} → ${r.originalCheckOut||'—'} · requested ${r.requestedCheckIn} → ${r.requestedCheckOut}`}</Td><Td><StatusBadge label={r.status}/></Td><Td>{r.status==='pending'?<div className="flex gap-1.5"><button disabled={!!busyKey} onClick={()=>onReview(r.id,'approved')} className="btn-approve">{busyKey?'Saving…':'Approve'}</button><button disabled={!!busyKey} onClick={()=>onReview(r.id,'rejected')} className="btn-reject">{busyKey?'Saving…':'Reject'}</button></div>:<span className="text-slate-400">Reviewed</span>}</Td></tr>)}{!rows.length&&<EmptyRow colSpan={5} text="No requests."/>}</tbody></table></div></div>;
}

function PayrollAdmin({employees,payrollPeriods,payrollRecords,onRefresh}:any){
  const [month,setMonth]=useState(today().slice(0,7));
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [settings,setSettings]=useState<{monthly:number;divisor:'calendar_days'|'working_days'}>({monthly:1.5,divisor:'calendar_days'});
  const period=[...(payrollPeriods as PayrollPeriod[])].find(p=>p.monthStart.startsWith(month));
  const records=(payrollRecords as PayrollRecord[])
    .filter(r=>period&&r.periodId===period.id)
    .sort((a,b)=>a.employeeName.localeCompare(b.employeeName));

  useEffect(()=>{
    let mounted=true;
    void (async()=>{
      const {data,error}=await(supabase as any).from('payroll_settings').select('monthly_leave_accrual,divisor_mode').eq('id',true).maybeSingle();
      if(!mounted)return;
      if(!error&&data)setSettings({monthly:Number(data.monthly_leave_accrual),divisor:data.divisor_mode});
    })();
    return()=>{mounted=false};
  },[]);

  async function generate(){
    if(busy)return;
    setBusy(true);setMessage('');
    try{
      const {error}=await(supabase as any).rpc('generate_payroll',{p_month:month+'-01'});
      if(error)throw error;
      notify(`Payroll generated for ${month}.`,'success');
      setMessage('Draft generated. Review the records before finalizing.');
      await onRefresh();
    }catch(error){
      setMessage(error instanceof Error?error.message:'Unable to generate payroll.');
      notify(error instanceof Error?error.message:'Unable to generate payroll.','error');
    }finally{setBusy(false);}
  }

  async function finalize(){
    if(!period||period.status!=='draft'||busy)return;
    if(!confirm('Finalize this payroll period? Employees will see the saved payroll snapshot.'))return;
    setBusy(true);setMessage('');
    try{
      const {error}=await(supabase as any).rpc('finalize_payroll',{p_period_id:period.id});
      if(error)throw error;
      notify(`Payroll for ${month} finalized.`,'success');
      setMessage('Payroll finalized and locked.');
      await onRefresh();
    }catch(error){
      setMessage(error instanceof Error?error.message:'Unable to finalize payroll.');
      notify(error instanceof Error?error.message:'Unable to finalize payroll.','error');
    }finally{setBusy(false);}
  }

  return <PageShell title="Payroll" subtitle="Monthly salary snapshots with a review-before-finalize workflow.">
    <div className="grid lg:grid-cols-3 gap-4">
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <p className="label">Payroll month</p>
        <input type="month" value={month} onChange={e=>{setMonth(e.target.value);setMessage('')}} className="input"/>
        <div className="mt-4 text-xs text-slate-500 space-y-2">
          <div className="flex justify-between"><span>Paid-leave accrual</span><b className="text-slate-900">{settings.monthly}</b></div>
          <div className="flex justify-between"><span>Divisor</span><b className="text-slate-900">{settings.divisor==='calendar_days'?'Calendar days':'Working days'}</b></div>
          {period&&<div className="flex justify-between"><span>Days in divisor</span><b className="text-slate-900">{period.dayDivisor}</b></div>}
          {period&&<div className="flex justify-between"><span>Status</span><StatusBadge label={period.status}/></div>}
        </div>
        <div className="flex gap-2 mt-5">
          <button disabled={busy||period?.status==='finalized'} onClick={()=>void generate()} className="btn-primary flex-1">{busy?'Generating…':period?.status==='finalized'?'Finalized & locked':'Generate draft'}</button>
          {period&&period.status==='draft'&&<button disabled={busy} onClick={()=>void finalize()} className="btn-secondary">Finalize</button>}
        </div>
        {message&&<p className="text-xs mt-3 text-slate-600">{message}</p>}
      </section>
      <section className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div><h3 className="font-bold text-sm">Payroll records</h3><p className="text-xs text-slate-500 mt-1">{period?period.status:'No payroll period generated'} · {records.length} employee record(s)</p></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider"><tr><Th>Employee</Th><Th>Salary Snapshot</Th><Th>Paid Leave</Th><Th>Unpaid Leave</Th><Th>Deduction</Th><Th>Final Pay</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((r:PayrollRecord)=><tr key={r.id}><Td strong>{r.employeeName}</Td><Td>{money(r.salarySnapshot)}</Td><Td>{r.paidLeaveDays}</Td><Td>{r.unpaidLeaveDays}</Td><Td>{money(r.leaveDeduction)}</Td><Td strong>{money(r.finalPay)}</Td></tr>)}
              {!records.length&&<EmptyRow colSpan={6} text={period?'No records for this period. Generate the payroll draft.':'Select a month and generate the payroll draft.'}/>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </PageShell>;
}

function HolidaysAdmin({holidays,onRefresh}:any){
  const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);
  async function add(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);try{const {data:auth}=await supabase.auth.getUser();const fd=new FormData(e.currentTarget);const date=String(fd.get('date')||'');if(!date)throw new Error('Choose a holiday date.');const {data:existing}=await(supabase as any).from('holidays').select('id,name,holiday_type').eq('date',date).maybeSingle();if(existing)throw new Error(`A holiday is already scheduled for ${date} (${existing.name}).`);const {error}=await(supabase as any).from('holidays').insert({name:String(fd.get('name')||'').trim(),date,description:clean(fd.get('description')),created_by:auth.user?.id??null,holiday_type:'company'});if(error)throw error;notify('Company holiday added.','success');e.currentTarget.reset();setOpen(false);await onRefresh();}catch(error){notify(error instanceof Error?error.message:'Unable to add holiday.','error')}finally{setBusy(false);}}
  async function del(id:string){const item=(holidays as Holiday[]).find((h:Holiday)=>h.id===id);if(item?.holidayType==='public'){notify('Public calendar holidays are protected.','info');return;}if(!confirm('Delete this company holiday?'))return;try{const {error}=await(supabase as any).from('holidays').delete().eq('id',id);if(error)throw error;notify('Company holiday removed.','success');await onRefresh();}catch(error){notify(error instanceof Error?error.message:'Unable to remove holiday.','error')}}
  return <PageShell title="Holidays" subtitle="All admin-added holidays are paid company non-working days."><div className="flex justify-end"><button onClick={()=>setOpen(v=>!v)} className="btn-primary"><Plus className="w-4 h-4"/>Add holiday</button></div>{open&&<form onSubmit={add} className="mt-4 bg-white rounded-2xl border border-slate-200 p-5 grid md:grid-cols-3 gap-4"><Field label="Holiday name"><input name="name" className="input" required/></Field><Field label="Date"><input name="date" type="date" className="input" required/></Field><Field label="Description"><input name="description" className="input"/></Field><div className="md:col-span-3 flex justify-end gap-2"><button type="button" onClick={()=>setOpen(false)} className="btn-secondary">Cancel</button><button disabled={busy} className="btn-primary">{busy?'Saving…':'Add holiday'}</button></div></form>}<div className="mt-4 grid md:grid-cols-2 xl:grid-cols-3 gap-3">{holidays.map((h:Holiday)=><div key={h.id} className="bg-white rounded-2xl border border-slate-200 p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase font-bold tracking-wider text-indigo-600">{dateLabel(h.date,{weekday:'long'})}</p><div className="flex items-center gap-2 mt-1"><h3 className="font-bold">{h.name}</h3>{h.holidayType==='public'&&<span className="text-[9px] rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 font-bold">Public</span>}</div><p className="text-xs text-slate-500 mt-1">{h.description||'Company holiday'}</p></div>{h.holidayType!=='public'&&<button onClick={()=>void del(h.id)} className="icon-btn text-rose-500" title="Delete company holiday"><Trash2 className="w-4 h-4"/></button>}</div></div>)}{!holidays.length&&<EmptyCard text="No company holidays added yet."/>}</div></PageShell>;
}

function HolidaysEmployee({holidays}:any){
  const items=[...(holidays as Holiday[])].sort((a,b)=>a.date.localeCompare(b.date));
  return <PageShell title="Holidays" subtitle="Public and company holidays are paid non-working days."><div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{items.map((h:Holiday)=><div key={h.id} className="bg-white rounded-2xl border border-slate-200 p-5"><div className="flex items-center justify-between gap-3"><p className="text-[10px] uppercase tracking-wider font-bold text-indigo-600">{dateLabel(h.date,{weekday:'long'})}</p>{h.holidayType==='public'&&<span className="text-[9px] rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 font-bold">Public</span>}</div><h3 className="font-bold mt-1">{h.name}</h3><p className="text-xs text-slate-500 mt-2">{h.description||(h.holidayType==='public'?'Public calendar holiday':'Paid company holiday')}</p></div>)}{!items.length&&<EmptyCard text="No holidays are scheduled yet."/>}</div></PageShell>;
}

function LeaveEmployee({user,leaveRequests,ledgers,holidays,onRefresh}:any){
  const [open,setOpen]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const current=ledgers.find((l:LeaveLedger)=>l.periodStart===`${today().slice(0,7)}-01`);
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setError('');setBusy(true);try{const fd=new FormData(e.currentTarget);const start=String(fd.get('startDate')||'');const end=String(fd.get('endDate')||'');if(end<start)throw new Error('End date cannot be before start date.');if(start.slice(0,7)!==end.slice(0,7))throw new Error('A leave request must stay within one calendar month.');const leaveDuration=String(fd.get('duration'));if(leaveDuration==='half'&&start!==end)throw new Error('Half-day leave must use one date.');const {error:err}=await(supabase as any).from('leave_requests').insert({employee_id:user.employeeDbId,leave_type:String(fd.get('leaveType')),start_date:start,end_date:end,duration:leaveDuration,reason:String(fd.get('reason')||'').trim()});if(err)throw err;notify('Leave request submitted.','success');e.currentTarget.reset();setOpen(false);await onRefresh();}catch(error){const message=error instanceof Error?error.message:'Unable to submit leave request.';setError(message);notify(message,'error')}finally{setBusy(false);}}
  return <PageShell title="Leave" subtitle="Paid leave accrues at 1.5 days/month and unused balance carries forward.">{error&&<Notice type="error" text={error}/>}<div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Summary label="Available" value={current?.closingBalance??'—'}/><Summary label="Carry forward" value={current?.openingBalance??'—'}/><Summary label="Added" value={current?.accrual??1.5}/><Summary label="Unpaid used" value={current?.unpaidUsed??0}/></div><div className="mt-4 flex justify-end"><button onClick={()=>setOpen(v=>!v)} className="btn-primary"><Plus className="w-4 h-4"/>Apply leave</button></div>{open&&<form onSubmit={submit} className="mt-4 bg-white rounded-2xl border border-slate-200 p-5 grid md:grid-cols-2 gap-4"><Field label="Leave type"><select name="leaveType" className="input"><option value="casual">Casual</option><option value="sick">Sick</option><option value="earned">Earned</option><option value="unpaid">Unpaid</option></select></Field><Field label="Duration"><select name="duration" className="input"><option value="full">Full day</option><option value="half">Half day</option></select></Field><Field label="Start date"><input name="startDate" type="date" min={today()} className="input" required/></Field><Field label="End date"><input name="endDate" type="date" min={today()} className="input" required/></Field><Field label="Reason"><input name="reason" className="input md:col-span-2" required/></Field><div className="md:col-span-2 flex justify-end gap-2"><button type="button" onClick={()=>setOpen(false)} className="btn-secondary">Cancel</button><button disabled={busy} className="btn-primary">{busy?'Submitting…':'Submit request'}</button></div></form>}<div className="mt-4 bg-white rounded-2xl border border-slate-200 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase tracking-wider"><tr><Th>Dates</Th><Th>Type</Th><Th>Days</Th><Th>Paid / Unpaid</Th><Th>Reason</Th><Th>Status</Th></tr></thead><tbody className="divide-y divide-slate-100">{leaveRequests.map((r:LeaveRequest)=><tr key={r.id}><Td>{dateLabel(r.startDate)} → {dateLabel(r.endDate)}</Td><Td>{r.leaveType}</Td><Td>{r.days}</Td><Td>{r.paidDays??0} / {r.unpaidDays??0}</Td><Td>{r.reason}</Td><Td><StatusBadge label={r.status}/></Td></tr>)}{!leaveRequests.length&&<EmptyRow colSpan={6} text="No leave requests yet."/>}</tbody></table></div></div></PageShell>;
}

function CorrectionEmployee({user,corrections,onRefresh}:any){
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const myCorrections=(corrections as CorrectionRequest[]).filter(r=>r.employeeId===user.employeeDbId);

  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const fd=new FormData(e.currentTarget);
      const date=String(fd.get('date')||'');
      const requestedCheckIn=String(fd.get('requestedCheckIn')||'');
      const requestedCheckOut=String(fd.get('requestedCheckOut')||'');
      const reason=String(fd.get('reason')||'').trim();

      if(!date||!requestedCheckIn||!requestedCheckOut||!reason) throw new Error('Complete all required fields.');
      if(date>today()) throw new Error('A correction can only be requested for today or an earlier date.');
      if(requestedCheckOut<=requestedCheckIn) throw new Error('Check-out time must be later than check-in time.');

      const {error:err}=await (supabase as any).from('regularization_requests').insert({
        employee_id:user.employeeDbId,
        date,
        requested_check_in:requestedCheckIn,
        requested_check_out:requestedCheckOut,
        reason,
      });
      if(err) throw err;
      notify('Correction request submitted.','success');
      e.currentTarget.reset();
      setOpen(false);
      await onRefresh();
    } catch(error) {
      const message=error instanceof Error?error.message:'Unable to submit correction request.';
      setError(message);
      notify(message,'error');
    } finally {
      setBusy(false);
    }
  }

  return <PageShell title="Corrections" subtitle="Request a correction for a missed or incorrect attendance time. Original attendance is preserved.">
    {error&&<Notice type="error" text={error}/>}
    <div className="flex justify-end">
      <button onClick={()=>setOpen(v=>!v)} className="btn-primary"><Plus className="w-4 h-4"/>Request correction</button>
    </div>
    {open&&<form onSubmit={submit} className="mt-4 bg-white rounded-2xl border border-slate-200 p-5 grid md:grid-cols-2 gap-4">
      <Field label="Date"><input name="date" type="date" max={today()} className="input" required/></Field>
      <Field label="Reason"><input name="reason" className="input" required/></Field>
      <Field label="Correct check-in"><input name="requestedCheckIn" type="time" className="input" required/></Field>
      <Field label="Correct check-out"><input name="requestedCheckOut" type="time" className="input" required/></Field>
      <div className="md:col-span-2 flex justify-end gap-2">
        <button type="button" onClick={()=>setOpen(false)} className="btn-secondary">Cancel</button>
        <button disabled={busy} className="btn-primary">{busy?'Submitting…':'Submit request'}</button>
      </div>
    </form>}
    <div className="mt-4 bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider"><tr><Th>Date</Th><Th>Original</Th><Th>Requested</Th><Th>Reason</Th><Th>Status</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {myCorrections.map(r=><tr key={r.id}>
            <Td>{dateLabel(r.date)}</Td>
            <Td mono>{r.originalCheckIn||'—'} → {r.originalCheckOut||'—'}</Td>
            <Td mono>{r.requestedCheckIn} → {r.requestedCheckOut}</Td>
            <Td>{r.reason}</Td>
            <Td><StatusBadge label={r.status}/></Td>
          </tr>)}
          {!myCorrections.length&&<EmptyRow colSpan={5} text="No correction requests yet."/>}
        </tbody>
      </table></div>
    </div>
  </PageShell>;
}

function WfhEmployee({user,wfhRequests,onRefresh}:any){
  const [open,setOpen]=useState(false);const [error,setError]=useState('');const remote=user.workMode==='remote';
  const [busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setError('');setBusy(true);try{const fd=new FormData(e.currentTarget);const date=String(fd.get('date')||'');if(date<=today())throw new Error('WFH requests must be for a future working day.');const {error:err}=await(supabase as any).from('wfh_requests').insert({employee_id:user.employeeDbId,date,duration:String(fd.get('duration')),reason:String(fd.get('reason')||'').trim(),note:clean(fd.get('note'))});if(err)throw err;notify('WFH request submitted.','success');e.currentTarget.reset();setOpen(false);await onRefresh();}catch(error){const message=error instanceof Error?error.message:'Unable to submit WFH request.';setError(message);notify(message,'error')}finally{setBusy(false);}}
  return <PageShell title="WFH" subtitle="Temporary WFH requests are for office-based employees.">{remote?<div className="bg-sky-50 border border-sky-200 rounded-2xl p-5 text-sm text-sky-900"><b>Permanent remote employee</b><p className="text-xs mt-1">You do not need a daily WFH request. Your attendance check-in is automatically treated as WFH.</p></div>:<>{error&&<Notice type="error" text={error}/>}<div className="flex justify-end"><button onClick={()=>setOpen(v=>!v)} className="btn-primary"><Plus className="w-4 h-4"/>Request WFH</button></div>{open&&<form onSubmit={submit} className="mt-4 bg-white rounded-2xl border border-slate-200 p-5 grid md:grid-cols-2 gap-4"><Field label="Date"><input type="date" name="date" min={tomorrow()} className="input" required/></Field><Field label="Duration"><select name="duration" className="input"><option value="full">Full day</option><option value="half">Half day</option></select></Field><Field label="Reason"><input name="reason" className="input" required/></Field><Field label="Note"><input name="note" className="input"/></Field><div className="md:col-span-2 flex justify-end gap-2"><button type="button" onClick={()=>setOpen(false)} className="btn-secondary">Cancel</button><button disabled={busy} className="btn-primary">{busy?'Submitting…':'Submit request'}</button></div></form>}<div className="mt-4 bg-white rounded-2xl border border-slate-200 overflow-hidden"><table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase tracking-wider"><tr><Th>Date</Th><Th>Duration</Th><Th>Reason</Th><Th>Status</Th></tr></thead><tbody className="divide-y divide-slate-100">{wfhRequests.map((r:WfhRequest)=><tr key={r.id}><Td>{dateLabel(r.date)}</Td><Td>{r.duration}</Td><Td>{r.reason}</Td><Td><StatusBadge label={r.status}/></Td></tr>)}{!wfhRequests.length&&<EmptyRow colSpan={4} text="No WFH requests yet."/>}</tbody></table></div></>}</PageShell>;
}

function validateStrongPassword(password:string){return password.length>=12&&/[A-Z]/.test(password)&&/[a-z]/.test(password)&&/\d/.test(password)&&/[^A-Za-z0-9]/.test(password)}

async function isPasswordLeaked(password:string){
  const digest=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(password));
  const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('').toUpperCase();
  const prefix=hash.slice(0,5),suffix=hash.slice(5);
  const response=await fetch('https://api.pwnedpasswords.com/range/'+prefix);
  if(!response.ok)throw new Error('Password security verification is temporarily unavailable. Please try again.');
  const body=await response.text();
  return body.split(/\r?\n/).some(line=>line.split(':',1)[0].trim().toUpperCase()===suffix);
}

function ProfileEmployee({user,onRefresh}:any){
  const [name,setName]=useState(user.name);const [phone,setPhone]=useState(user.phone??'');const [message,setMessage]=useState('');const [error,setError]=useState('');const [saving,setSaving]=useState(false);const [currentPassword,setCurrentPassword]=useState('');const [newPassword,setNewPassword]=useState('');const [confirm,setConfirm]=useState('');const [documents,setDocuments]=useState<EmployeeDocument[]>([]);const [documentsLoading,setDocumentsLoading]=useState(true);
  useEffect(()=>{let mounted=true;(async()=>{if(!user.employeeDbId){setDocumentsLoading(false);return}const {data,error:docError}=await(supabase as any).from('employee_documents').select('*').eq('employee_id',user.employeeDbId).order('created_at',{ascending:false});if(!mounted)return;if(docError){setError(docError.message);setDocuments([])}else setDocuments((data??[]).map((r:any)=>({id:r.id,employeeId:r.employee_id,documentType:r.document_type,fileName:r.file_name,storagePath:r.storage_path,mimeType:r.mime_type,sizeBytes:r.size_bytes,createdAt:r.created_at})));setDocumentsLoading(false)})();return()=>{mounted=false}},[user.employeeDbId]);
  async function save(){setError('');setMessage('');if(!name.trim()){setError('Name is required.');return;}setSaving(true);try{const {error:err}=await(supabase as any).from('employees').update({name:name.trim(),phone:phone.trim()||null}).eq('id',user.employeeDbId);if(err)throw err;setMessage('Profile updated.');notify('Profile updated successfully.','success');await onRefresh()}catch(error){setError(error instanceof Error?error.message:'Unable to update profile.');notify(error instanceof Error?error.message:'Unable to update profile.','error')}finally{setSaving(false)}}
  async function savePhoto(file:File){try{if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Use a JPG, PNG or WebP image.');if(file.size>5*1024*1024)throw new Error('Profile images must be 5 MB or smaller.');const url=await uploadAvatar(user.employeeDbId,file);const {error:err}=await(supabase as any).from('employees').update({avatar_url:url}).eq('id',user.employeeDbId);if(err)throw err;await onRefresh();setMessage('Profile photo updated.');notify('Profile photo updated.','success')}catch(e){setError(e instanceof Error?e.message:'Unable to update photo.');notify(e instanceof Error?e.message:'Unable to update photo.','error')}}
  async function password(){setError('');setMessage('');if(!currentPassword){setError('Enter your current password.');return}if(!validateStrongPassword(newPassword)){setError('Password must be at least 12 characters and include uppercase, lowercase, number and symbol.');return}if(newPassword!==confirm){setError('New passwords do not match.');return}setSaving(true);try{const authEmail=user.role==='admin'?'ira.admin@ira-presence.local':(user.loginId?loginIdToAuthEmail(user.loginId):'');if(!authEmail)throw new Error('Unable to determine the account email.');const {error:reauthError}=await supabase.auth.signInWithPassword({email:authEmail,password:currentPassword});if(reauthError)throw new Error('Current password is incorrect.');if(await isPasswordLeaked(newPassword))throw new Error('Choose a different password. This password has appeared in known data breaches.');const {error:change}=await supabase.auth.updateUser({password:newPassword});if(change)throw change;setMessage('Password changed successfully.');notify('Password changed successfully.','success');setCurrentPassword('');setNewPassword('');setConfirm('')}catch(e){setError(e instanceof Error?e.message:'Unable to change password.')}finally{setSaving(false)}}
  async function viewDocument(doc:EmployeeDocument){try{const url=await getSignedDocumentUrl(doc.storagePath);window.open(url,'_blank','noopener,noreferrer')}catch(e){setError(e instanceof Error?e.message:'Unable to open document.')}}
  return <PageShell title="Profile" subtitle="Personal details, HR documents and password."><div className="space-y-4">{(error||message)&&<div>{error&&<Notice type="error" text={error}/>} {message&&<Notice type="success" text={message}/>}</div>}<div className="grid lg:grid-cols-2 gap-4"><section className="bg-white rounded-2xl border border-slate-200 p-5"><div className="flex items-center gap-4"><div className="relative">{user.avatar?<img src={user.avatar} alt="" className="w-16 h-16 rounded-full object-cover ring-1 ring-slate-200"/>:<div className="w-16 h-16 rounded-full bg-slate-900 text-white flex items-center justify-center text-xl font-bold">{user.name.slice(0,1)}</div>}<label className="absolute -right-1 -bottom-1 w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center cursor-pointer shadow-sm"><Upload className="w-4 h-4"/><input type="file" accept="image/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void savePhoto(f)}}/></label></div><div><p className="text-lg font-bold">{user.name}</p><p className="text-xs text-slate-500">{user.designation} · {user.department}</p></div></div><div className="grid gap-4 mt-6"><Field label="Name"><input value={name} onChange={e=>setName(e.target.value)} className="input"/></Field><Field label="Phone"><input value={phone} onChange={e=>setPhone(e.target.value)} className="input"/></Field><InfoRow label="Login ID" value={user.loginId??'—'}/><InfoRow label="Employee ID" value={user.empId??'—'}/><InfoRow label="Work mode" value={user.workMode==='remote'?'Remote':'Office'}/><InfoRow label="Designation" value={user.designation??'—'}/><InfoRow label="Manager" value={user.manager??'—'}/><InfoRow label="Monthly salary" value={money(user.currentSalary)}/><button disabled={saving} onClick={()=>void save()} className="btn-primary w-fit">{saving?'Saving…':'Save personal details'}</button></div></section><section className="bg-white rounded-2xl border border-slate-200 p-5"><div className="flex items-center gap-2"><LockKeyhole className="w-4 h-4 text-blue-600"/><div><h3 className="font-bold text-sm">Change password</h3><p className="text-xs text-slate-500">Verify your current password before changing it.</p></div></div><div className="space-y-4 mt-5"><Field label="Current password"><input type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} className="input"/></Field><Field label="New password"><input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} className="input" minLength={12}/></Field><Field label="Confirm new password"><input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} className="input" minLength={12}/></Field><button disabled={saving} onClick={()=>void password()} className="btn-primary">Change password</button></div></section></div><section className="bg-white rounded-2xl border border-slate-200 overflow-hidden"><div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2"><FileText className="w-4 h-4 text-blue-600"/><div><h3 className="font-bold text-sm">HR Documents</h3><p className="text-xs text-slate-500">Your secure employee records.</p></div></div>{documentsLoading?<div className="p-6 text-sm text-slate-500">Loading documents…</div>:documents.length?<div className="divide-y divide-slate-100">{documents.map(doc=><div key={doc.id} className="px-5 py-4 flex items-center justify-between gap-4"><div className="min-w-0"><p className="text-sm font-semibold truncate">{doc.fileName}</p><p className="text-[11px] text-slate-500 mt-1">{doc.documentType} · {dateLabel(String(doc.createdAt).slice(0,10))}</p></div><button className="btn-secondary shrink-0" onClick={()=>void viewDocument(doc)}><Eye className="w-3.5 h-3.5 mr-1"/>View</button></div>)}</div>:<div className="p-6 text-sm text-slate-500">No HR documents uploaded yet.</div>}</section></div></PageShell>;
}

function ExportsAdmin({employees,payrollPeriods}:any){
  const [busy,setBusy]=useState<string|null>(null);
  const download=async(name:string,buildRows:()=>Promise<any[]>)=>{if(busy)return;setBusy(name);try{const rows=await buildRows();const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Data');XLSX.writeFile(wb,`${name}-${today()}.xlsx`);notify(`${rows.length} ${name} record(s) exported.`,'success')}catch(e){notify(e instanceof Error?e.message:'Unable to export data.','error')}finally{setBusy(null)}};
  async function fetchAll(table:string,orderBy:string){const rows:any[]=[];let from=0;const size=1000;for(;;){let q=(supabase as any).from(table).select('*').range(from,from+size-1);if(orderBy)q=q.order(orderBy,{ascending:false});const {data,error}=await q;if(error)throw error;const page=data??[];rows.push(...page);if(page.length<size)break;from+=size}return rows}
  const employeeMap=new Map((employees as Employee[]).map(e=>[e.id,e]));
  const payrollPeriodMap=new Map((payrollPeriods as PayrollPeriod[]).map(p=>[p.id,p]));
  return <PageShell title="Reports / Excel" subtitle="Download complete operational datasets without replacing source records."><div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3"><ExportCard disabled={Boolean(busy)} title={busy==='employees'?'Exporting…':'Employees'} icon={<Users className="w-5 h-5"/>} onClick={()=>void download('employees',async()=>(employees as Employee[]).map(e=>({EmployeeID:e.empId,LoginID:e.loginId,Name:e.name,Designation:e.designation,Department:e.department,WorkMode:e.workMode,Salary:e.currentSalary,Status:e.status})))} /><ExportCard disabled={Boolean(busy)} title={busy==='attendance'?'Exporting…':'Attendance'} icon={<Clock3 className="w-5 h-5"/>} onClick={()=>void download('attendance',async()=>{const [raw,breaks]=await Promise.all([fetchAll('attendance_effective','date'),fetchAll('break_events','break_start')]);const breaksBy=new Map<string,any[]>();for(const b of breaks){const list=breaksBy.get(b.attendance_id)??[];list.push(b);breaksBy.set(b.attendance_id,list)}return raw.map(r=>{const m=mapAttendance(r,employeeMap,breaksBy);return {Date:m.date,Employee:m.employeeName,EmployeeID:m.employeeEmpId,Mode:m.mode,CheckIn:m.checkIn??'',CheckOut:m.checkOut??'',Break:m.breakDuration??'',Working:m.workingHours??'',Status:m.status}})})} /><ExportCard disabled={Boolean(busy)} title={busy==='tasks'?'Exporting…':'Tasks'} icon={<BriefcaseBusiness className="w-5 h-5"/>} onClick={()=>void download('tasks',async()=>{const rows=await fetchAll('tasks','start_date');return rows.map(r=>{const t=mapTask(r,employeeMap);return {Task:t.title,Employee:t.assignedToName,Start:t.startDate,Due:t.dueDate,Priority:t.priority,Status:t.status,SubmittedLink:t.submittedLink??''}})})} /><ExportCard disabled={Boolean(busy)} title={busy==='payroll'?'Exporting…':'Payroll'} icon={<WalletCards className="w-5 h-5"/>} onClick={()=>void download('payroll',async()=>{const rows=await fetchAll('payroll_records','created_at');return rows.map(r=>{const p=mapPayrollRecord(r,employeeMap);const period=payrollPeriodMap.get(p.periodId);return {Period:period?.monthStart?.slice(0,7)??'',Status:p.finalizedAt?'finalized':(period?.status??'draft'),Employee:p.employeeName,Salary:p.salarySnapshot,PaidLeave:p.paidLeaveDays,UnpaidLeave:p.unpaidLeaveDays,Deduction:p.leaveDeduction,FinalPay:p.finalPay}})})} /></div></PageShell>;
}

function ExportCard({title,icon,onClick,disabled=false}:{title:string;icon:React.ReactNode;onClick:()=>void;disabled?:boolean}){return <button disabled={disabled} onClick={onClick} className="export-card text-left disabled:opacity-50 disabled:cursor-not-allowed"><div className="w-10 h-10 rounded-2xl bg-blue-50/85 border border-blue-100 text-blue-600 flex items-center justify-center">{icon}</div><p className="font-bold text-sm mt-4 text-slate-950">{title}</p><p className="text-xs text-slate-500 mt-1">Download XLSX</p><div className="mt-4 text-xs font-bold text-blue-600 inline-flex items-center gap-1">Export <Download className="w-3.5 h-3.5"/></div></button>}

function SettingsAdmin({designations,departments,rules,onRefresh}:any){
  const [tab,setTab]=useState('rules');
  const [name,setName]=useState('');const [canAssign,setCanAssign]=useState(false);
  const [payrollDivisor,setPayrollDivisor]=useState<'calendar_days'|'working_days'>('calendar_days');
  const [payrollPolicyStatus,setPayrollPolicyStatus]=useState<'loading'|'ready'|'error'>('loading');
  const [payrollPolicyLoadKey,setPayrollPolicyLoadKey]=useState(0);
  const [assigner,setAssigner]=useState('');const [assignee,setAssignee]=useState('');const [scope,setScope]=useState<'any'|'direct_reports'>('direct_reports');
  useEffect(()=>{let cancelled=false;(async()=>{setPayrollPolicyStatus('loading');try{const {data,error}=await(supabase as any).from('payroll_settings').select('divisor_mode').eq('id',true).maybeSingle();if(error||!data||(data.divisor_mode!=='calendar_days'&&data.divisor_mode!=='working_days'))throw error??new Error('Payroll policy is unavailable.');if(cancelled)return;setPayrollDivisor(data.divisor_mode);setPayrollPolicyStatus('ready')}catch{if(!cancelled)setPayrollPolicyStatus('error')}})();return()=>{cancelled=true}},[payrollPolicyLoadKey]);
  async function addDesignation(){const value=name.trim();if(!value){notify('Enter a designation name.','error');return;}try{const {error}=await(supabase as any).from('designations').insert({name:value,can_assign_tasks:canAssign});if(error)throw error;notify('Designation added.','success');setName('');setCanAssign(false);await onRefresh()}catch(error){notify(error instanceof Error?error.message:'Unable to add designation.','error')}}
  async function addDepartment(){const value=name.trim();if(!value){notify('Enter a department name.','error');return;}try{const {error}=await(supabase as any).from('departments').insert({name:value});if(error)throw error;notify('Department added.','success');setName('');await onRefresh()}catch(error){notify(error instanceof Error?error.message:'Unable to add department.','error')}}
  async function addRule(){if(!assigner){notify('Select an assigner designation.','error');return;}try{const {error}=await(supabase as any).from('task_assignment_rules').insert({assigner_designation_id:assigner,assignee_designation_id:assignee||null,scope});if(error)throw error;notify('Assignment rule added.','success');setAssigner('');setAssignee('');await onRefresh()}catch(error){notify(error instanceof Error?error.message:'Unable to add rule.','error')}}
  async function deleteRule(id:string){if(!confirm('Delete this assignment rule?'))return;try{const {error}=await(supabase as any).from('task_assignment_rules').delete().eq('id',id);if(error)throw error;notify('Assignment rule removed.','success');await onRefresh()}catch(error){notify(error instanceof Error?error.message:'Unable to remove rule.','error')}}
  async function savePayroll(){if(payrollPolicyStatus!=='ready'){notify('Load the current payroll policy before saving.','error');return}try{const {data,error}=await(supabase as any).from('payroll_settings').update({divisor_mode:payrollDivisor}).eq('id',true).select('id').maybeSingle();if(error)throw error;if(!data)throw new Error('Payroll policy could not be found. Refresh and try again.');notify('Payroll policy saved.','success')}catch(error){notify(error instanceof Error?error.message:'Unable to save payroll policy.','error')}}
  return <PageShell title="Settings" subtitle="Configure designations, assignment rules, departments and the payroll divisor policy."><div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">{[['rules','Assignment rules'],['designations','Designations'],['departments','Departments'],['payroll','Payroll policy']].map(([id,l])=><button key={id} onClick={()=>setTab(id)} className={`px-4 py-2 rounded-lg text-xs font-bold ${tab===id?'bg-white shadow-sm text-slate-900':'text-slate-500'}`}>{l}</button>)}</div>{tab==='rules'&&<section className="mt-4 grid lg:grid-cols-2 gap-4"><div className="bg-white rounded-2xl border border-slate-200 p-5"><h3 className="font-bold text-sm">Add assignment rule</h3><div className="space-y-4 mt-4"><Field label="Assigner designation"><select value={assigner} onChange={e=>setAssigner(e.target.value)} className="input"><option value="">Select</option>{designations.map((d:Designation)=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="Assignee designation"><select value={assignee} onChange={e=>setAssignee(e.target.value)} className="input"><option value="">Any designation</option>{designations.map((d:Designation)=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="Scope"><select value={scope} onChange={e=>setScope(e.target.value as any)} className="input"><option value="direct_reports">Direct reports</option><option value="any">Any employee</option></select></Field><button onClick={()=>void addRule()} className="btn-primary">Add rule</button></div></div><div className="bg-white rounded-2xl border border-slate-200 overflow-hidden"><div className="p-5 border-b border-slate-100"><h3 className="font-bold text-sm">Current rules</h3></div>{rules.map((r:AssignmentRule)=><div key={r.id} className="p-4 border-b border-slate-100 flex items-center justify-between gap-3"><p className="text-xs"><b>{r.assignerDesignation}</b> → {r.assigneeDesignation} <span className="text-slate-400">· {r.scope}</span></p><button onClick={()=>void deleteRule(r.id)} className="icon-btn text-rose-500"><Trash2 className="w-4 h-4"/></button></div>)}{!rules.length&&<EmptyCard text="No assignment rules."/>}</div></section>}{tab==='designations'&&<section className="mt-4 grid lg:grid-cols-2 gap-4"><div className="bg-white rounded-2xl border border-slate-200 p-5"><h3 className="font-bold text-sm">Add designation</h3><div className="space-y-4 mt-4"><Field label="Name"><input value={name} onChange={e=>setName(e.target.value)} className="input"/></Field><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={canAssign} onChange={e=>setCanAssign(e.target.checked)}/>Can assign tasks</label><button onClick={()=>void addDesignation()} className="btn-primary">Add designation</button></div></div><div className="bg-white rounded-2xl border border-slate-200 p-5">{designations.map((d:Designation)=><div key={d.id} className="flex justify-between p-3 border-b border-slate-100 last:border-0 text-xs"><b>{d.name}</b><span className="text-slate-500">{d.canAssignTasks?'Assigns tasks':'Receives tasks'}</span></div>)}</div></section>}{tab==='departments'&&<section className="mt-4 grid lg:grid-cols-2 gap-4"><div className="bg-white rounded-2xl border border-slate-200 p-5"><h3 className="font-bold text-sm">Add department</h3><div className="flex gap-2 mt-4"><input value={name} onChange={e=>setName(e.target.value)} className="input"/><button onClick={()=>void addDepartment()} className="btn-primary">Add</button></div></div><div className="bg-white rounded-2xl border border-slate-200 p-5">{departments.map((d:Department)=><div key={d.id} className="p-3 border-b border-slate-100 last:border-0 text-xs font-bold">{d.name}</div>)}</div></section>}{tab==='payroll'&&<section className="mt-4 bg-white rounded-2xl border border-slate-200 p-5 max-w-xl"><p className="text-sm font-bold">Payroll divisor</p><p className="text-xs text-slate-500 mt-1">Keep this configurable until the company confirms the final payroll policy.</p>{payrollPolicyStatus==='loading'&&<p role="status" className="text-xs text-slate-500 mt-3">Loading current payroll policy…</p>}{payrollPolicyStatus==='error'&&<div role="alert" className="mt-3 text-xs text-rose-700">Could not load the current payroll policy. Saving is disabled until it can be reloaded. <button type="button" onClick={()=>setPayrollPolicyLoadKey(value=>value+1)} className="font-bold underline ml-1">Retry</button></div>}<select id="payroll-divisor" value={payrollDivisor} disabled={payrollPolicyStatus!=='ready'} onChange={e=>setPayrollDivisor(e.target.value as 'calendar_days'|'working_days')} className="input mt-4 disabled:opacity-50"><option value="calendar_days">Calendar days</option><option value="working_days">Working days</option></select><button onClick={()=>void savePayroll()} disabled={payrollPolicyStatus!=='ready'} className="btn-primary mt-4 disabled:opacity-50 disabled:cursor-not-allowed">Save policy</button><p className="text-[11px] text-slate-400 mt-3">Paid leave accrual remains 1.5 days per month and carries forward.</p></section>}</PageShell>;
}

function PageShell({title,subtitle,children}:{title:string;subtitle?:string;children:React.ReactNode}){return <div className="ira-page max-w-[1440px] mx-auto"><div className="mb-6 sm:mb-7"><div className="flex items-end justify-between gap-4"><div><h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-950">{title}</h2>{subtitle&&<p className="text-xs sm:text-sm text-slate-500 mt-1.5 max-w-3xl">{subtitle}</p>}</div><span className="hidden xl:inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/65 px-3 py-1.5 text-[10px] font-semibold text-slate-500 backdrop-blur-xl"><span className="ira-live-dot"/>Live data</span></div></div>{children}</div>}

function NotificationBell(){
  const [items,setItems]=useState<{id:string;type:'success'|'error'|'info';message:string;at:number}[]>([]);
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    const onToast=(event:Event)=>{
      const detail=(event as CustomEvent<any>).detail;
      if(!detail?.message)return;
      const item={id:detail.id??crypto.randomUUID(),type:detail.type??'info',message:String(detail.message),at:Date.now()};
      setItems(current=>[item,...current.filter(x=>x.id!==item.id)].slice(0,8));
    };
    window.addEventListener('ira:toast',onToast as EventListener);
    return()=>window.removeEventListener('ira:toast',onToast as EventListener);
  },[]);
  const unread=items.length;
  return <div className="relative">
    <button type="button" onClick={()=>setOpen(v=>!v)} className="relative inline-flex items-center justify-center w-10 h-10 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-white/70 transition-all" aria-label={unread?String(unread)+' notifications':'Notifications'} aria-expanded={open}>
      <Bell className="w-4.5 h-4.5"/>
      {unread>0&&<span className="absolute -right-0.5 -top-0.5 min-w-4.5 h-4.5 px-1 rounded-full bg-blue-600 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white">{unread>9?'9+':unread}</span>}
    </button>
    {open&&<div className="absolute right-0 top-12 w-[min(88vw,360px)] rounded-2xl border border-slate-200/80 bg-white/90 backdrop-blur-2xl shadow-[0_24px_70px_rgba(15,23,42,.16)] overflow-hidden z-50">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div><p className="text-xs font-bold text-slate-900">Notifications</p><p className="text-[10px] text-slate-400">{unread?unread+' recent update'+(unread===1?'':'s'):'All caught up'}</p></div>
        {unread>0&&<button type="button" onClick={()=>setItems([])} className="text-[10px] font-bold text-blue-600 hover:text-blue-700">Clear</button>}
      </div>
      {unread?<div className="max-h-80 overflow-y-auto">{items.map(item=><div key={item.id} className="px-4 py-3 border-b border-slate-100 last:border-0 flex gap-3">
        <span className={'mt-0.5 w-2 h-2 rounded-full shrink-0 '+(item.type==='success'?'bg-emerald-500':item.type==='error'?'bg-rose-500':'bg-blue-500')}/>
        <div className="min-w-0"><p className="text-xs font-semibold text-slate-800">{item.message}</p><p className="text-[10px] text-slate-400 mt-1">{new Date(item.at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}</p></div>
      </div>)}</div>:<div className="px-4 py-8 text-center text-xs text-slate-400">No new notifications.</div>}
    </div>}
  </div>
}
function LoadingScreen({label='Loading IRA…'}:{label?:string}){return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="text-sm text-slate-500 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin"/>{label}</div></div>}

function Modal({title,onClose,children,wide=false,closeDisabled=false}:{title:string;onClose:()=>void;children:React.ReactNode;wide?:boolean;closeDisabled?:boolean}){
  const dialogRef=useRef<HTMLDivElement>(null);
  const requestClose=useCallback(()=>{if(!closeDisabled)onClose()},[closeDisabled,onClose]);
  useEffect(()=>{
    const previousOverflow=document.body.style.overflow;
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    document.body.style.overflow='hidden';
    const getFocusable=()=>Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')??[]);
    const focusable=getFocusable();
    (focusable[0]??dialogRef.current)?.focus();
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){requestClose();return}
      if(event.key!=='Tab')return;
      const items=getFocusable();
      if(!items.length){event.preventDefault();dialogRef.current?.focus();return}
      const first=items[0],last=items[items.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    };
    window.addEventListener('keydown',onKey);
    return()=>{document.body.style.overflow=previousOverflow;window.removeEventListener('keydown',onKey);previousFocus?.focus()};
  },[requestClose]);
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-slate-950/55 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center overflow-y-auto overscroll-contain" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target)requestClose()}}>
      <div ref={dialogRef} tabIndex={-1} className={`ira-modal w-full ${wide?'max-w-5xl':'max-w-lg'} max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto flex flex-col`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="shrink-0 px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 flex items-center justify-between bg-white"><h3 className="font-bold text-slate-950 truncate pr-3">{title}</h3><button type="button" disabled={closeDisabled} onClick={requestClose} className="icon-btn shrink-0 disabled:opacity-50" aria-label="Close"><X className="w-5 h-5"/></button></div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}

function FormSection({title,icon,children}:{title:string;icon:React.ReactNode;children:React.ReactNode}){return <section className="ira-form-section"><div className="flex items-center gap-2 mb-3"><span className="w-8 h-8 rounded-xl bg-slate-100/85 border border-slate-200 flex items-center justify-center text-slate-600">{icon}</span><h4 className="text-sm font-bold text-slate-950">{title}</h4></div>{children}</section>}
function Field({label,hint,children}:{label:string;hint?:string;children:React.ReactNode}){return <label className="block"><span className="label">{label}{hint&&<span className="font-normal text-slate-400 ml-1">{hint}</span>}</span>{children}</label>}
function FilterInput({label,children}:{label:string;children:React.ReactNode}){return <div><span className="label">{label}</span>{children}</div>}
function InfoRow({label,value}:{label:string;value:string}){return <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 text-xs"><span className="text-slate-500">{label}</span><b className="text-slate-800 text-right">{value}</b></div>}
function Summary({label,value}:{label:string;value:string|number}){return <div className="summary-card"><span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block">{label}</span><b className="text-lg mt-1 block text-slate-950">{value}</b></div>}
function Kpi({label,value,icon,textValue=false}:{label:string;value:any;icon:React.ReactNode;textValue?:boolean}){return <div className="kpi-card"><div className="flex items-center justify-between text-slate-400"><span className="text-[10px] uppercase tracking-[0.12em] font-bold">{label}</span>{icon}</div><p className={`mt-3 font-bold text-slate-950 ${textValue?'text-base':'text-2xl'}`}>{value}</p></div>}
function DarkMetric({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-white/5 border border-white/10 p-3"><span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">{label}</span><p className="text-sm font-bold font-mono mt-1">{value}</p></div>}
function AttendanceMetric({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-slate-50 border border-slate-200 p-3"><span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">{label}</span><p className="text-sm font-bold font-mono mt-1">{value}</p></div>}
function StatusBadge({label,dark=false}:{label:string;dark?:boolean}){const x=String(label).toLowerCase();let c='bg-slate-100 text-slate-600 border-slate-200';if(x==='present'||x==='approved'||x==='completed'||x==='active')c='bg-emerald-50 text-emerald-700 border-emerald-200';if(x==='late'||x==='pending'||x==='assigned')c='bg-amber-50 text-amber-700 border-amber-200';if(x==='rejected'||x==='inactive'||x==='absent')c='bg-rose-50 text-rose-700 border-rose-200';if(x==='wfh')c='bg-sky-50 text-sky-700 border-sky-200';if(x==='leave')c='bg-purple-50 text-purple-700 border-purple-200';return <span className={`inline-flex items-center px-2 py-1 rounded-full border text-[10px] font-bold uppercase ${dark?'bg-white/10 text-white border-white/10':c}`}>{label}</span>}
function PriorityBadge({value}:{value:TaskPriority}){return <span className="text-[10px] uppercase tracking-wider font-bold text-slate-600">{value}</span>}
function Notice({type,text}:{type:'error'|'success';text:string}){return <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm flex items-start gap-2 ${type==='error'?'border-rose-200 bg-rose-50 text-rose-800':'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{type==='error'?<CircleAlert className="w-4 h-4 mt-0.5 shrink-0"/>:<CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0"/>}{text}</div>}
function Th({children}:{children:React.ReactNode}){return <th className="px-4 py-3 font-semibold whitespace-nowrap">{children}</th>}
function Td({children,mono,strong}:{children:React.ReactNode;mono?:boolean;strong?:boolean}){return <td className={`px-4 py-3.5 whitespace-nowrap ${mono?'font-mono':''} ${strong?'font-bold text-slate-800':''}`}>{children}</td>}
function EmptyRow({colSpan,text}:{colSpan:number;text:string}){return <tr><td colSpan={colSpan} className="p-10 text-center text-slate-500">{text}</td></tr>}
function EmptyCard({text}:{text:string}){return <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">{text}</div>}

function clean(v:any){const s=String(v??'').trim();return s||null}
