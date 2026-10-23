import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { useAuth, type AuthUser, loginIdToAuthEmail } from './contexts/AuthContext';
import { AdminLoginScreen, EmployeeLoginScreen, ClientLoginScreen } from './components/auth/PortalLoginScreen';
import { ClientPasswordSetupScreen } from './components/client/ClientPasswordSetupScreen';
import { ClientPortalView } from './components/client/ClientPortalView';
import { AdminClientCenter } from './components/admin/AdminClientCenter';
import { AdminHome } from './components/admin/AdminHome';
import { EmployeeHome, MyAttendancePage } from './components/employee/EmployeeHome';
import { HolidayList, HolidaysPage, LeavePage, WfhPage } from './components/employee/TimeOffPages';
import { useLinkableDeliverables, type LinkableDeliverable } from './lib/linkableDeliverables';
import { ManagerClientWork } from './components/manager/ManagerClientWork';
import { AppShell, type NavGroup } from './ui/AppShell';
import { Avatar, Badge, EmptyState, IconChip, Notice as UiNotice, Page, PageHeader, PillTabs, SkeletonPage, Stat, StatusBadge as UiStatusBadge } from './ui';
import { Modal } from './ui/Modal';
import { ConfirmHost, confirmDialog } from './ui/confirm';
import { ToastHost } from './components/common/ToastHost';
import { notify, type NotificationCategory } from './lib/toast';
import {
  fetchUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  notifyLeaveSubmitted,
  notifyLeaveReviewed,
  notifyWfhSubmitted,
  notifyWfhReviewed,
  notifyTaskAssigned,
  notifyTaskSubmitted,
  notifyHolidayAdded,
  type NotificationRecord,
  type NotificationType
} from './lib/notifications';
import {
  isPushSupported,
  getPushPermissionState,
  isIosNeedsHomeScreen,
  subscribeToPush,
  unsubscribeFromPush,
  getExistingSubscription,
  registerServiceWorker,
  syncExistingPushSubscription,
  type PushPermissionStatus
} from './lib/pushSubscription';
import {
  Activity, ArrowRight, BriefcaseBusiness, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight,
  Clock3, Coffee, Download, Eye, FileClock, FileText, Filter, Home, KeyRound, LayoutDashboard, Link2,
  Bell, LogOut, Menu, Pencil, Play, Plus, RefreshCw, Search, Settings2, ShieldCheck, Trash2, UserRound,
  Users, WalletCards, X, Upload, Building2, CircleAlert, LockKeyhole, UserPlus, Smartphone, Sparkles,
  FolderKanban
} from 'lucide-react';
import type {
  AssignmentRule, AttendanceRecord, BreakEvent, Department, Designation, Employee, EmployeeDocument,
  Holiday, LeaveLedger, LeaveRequest, PayrollPeriod, PayrollRecord, Task, TaskPriority,
  WfhRequest, CorrectionRequest
} from './types/attendance';
import {
  ALL_DOCUMENT_TYPES, dateLabel, duration, mapAttendance, mapEmployee, mapHoliday,
  mapLeave, mapLedger, mapPayrollPeriod, mapPayrollRecord, mapRule, mapTask, mapWfh,
  money, invokeEmployeeAdmin, uploadAvatar, uploadEmployeeDocument, getSignedDocumentUrl
} from './lib/v2';
import { classifyDay, formatKolkataTime, getKolkataDateString } from './lib/workingDays';
import { performCheckIn, performStartBreak, performResumeWork, performCheckOut, recoverTodayAttendance, formatLiveTimer, fetchAttendanceRecord } from './lib/attendance';

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
  const [currentPath, setCurrentPath] = useState(() => (typeof window !== 'undefined' ? window.location.pathname : ''));

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const adminPath = currentPath.startsWith('/admin');
  const clientSetupPath = currentPath.startsWith('/client/setup');
  const clientPath = currentPath.startsWith('/client');

  useEffect(() => {
    if (user?.role === 'client' || clientPath) {
      document.title = 'IRA Client Portal';
    } else if (adminPath) {
      document.title = 'IRA Admin Portal';
    } else {
      document.title = 'IRA Attendance';
    }
  }, [user?.role, clientPath, adminPath]);

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  useEffect(() => {
    if (user?.id) {
      void syncExistingPushSubscription(user.id);
    }
  }, [user?.id]);

  if (clientSetupPath) {
    return <ClientPasswordSetupScreen />;
  }

  if (loading) return <LoadingScreen />;
  if (!user) {
    if (adminPath) return <AdminLoginScreen />;
    if (clientPath) return <ClientLoginScreen />;
    return <EmployeeLoginScreen />;
  }
  if (!isSupabaseConfigured) return <LoadingScreen label="Supabase is not configured." />;

  if (user.role === 'client') {
    return <ClientPortalView user={user} onLogout={signOut} />;
  }

  return <Portal user={user} onLogout={signOut} />;
}

function LiveClockDisplay() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="hidden sm:inline-flex items-center gap-2 h-10 px-4 rounded-full bg-white border border-ink-100 shadow-[var(--shadow-soft)] text-xs font-semibold text-ink-700 tnum">
      <span className="live-dot" />
      <span>{time.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })}</span>
      <span className="text-ink-300">·</span>
      <span className="text-ink-500">{time.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' })}</span>
    </div>
  );
}

function Portal({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const getInitialTab = () => {
    const p = typeof window !== 'undefined' ? window.location.pathname.replace(/^\//, '') : '';
    if (user.role === 'admin') {
      const validAdminTabs = ['admin-dashboard', 'admin-clients', 'admin-attendance', 'admin-tasks', 'admin-requests', 'admin-employees', 'admin-payroll', 'admin-holidays', 'admin-export', 'admin-settings'];
      if (validAdminTabs.includes(p)) return p;
      if (p === 'admin-reports') return 'admin-export';
      return 'admin-dashboard';
    } else {
      const validEmpTabs = ['emp-dashboard', 'emp-attendance', 'emp-client-work', 'emp-tasks', 'emp-leave', 'emp-wfh', 'emp-holidays', 'emp-payroll', 'emp-profile'];
      if (validEmpTabs.includes(p)) return p;
      return 'emp-dashboard';
    }
  };
  const [activeTab, setActiveTab] = useState(getInitialTab);

  // Keep the address bar in step with the page actually shown (e.g. an employee
  // opening an /admin-… link lands on their dashboard).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname !== `/${activeTab}`) window.history.replaceState(null, '', `/${activeTab}${window.location.search}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
        const departmentsMap = new Map<string, string>(departmentsData.map((d: any) => [d.id, d.name]));
        const designationsMap = new Map<string, string>(designationsData.map((d: any) => [d.id, d.name]));

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
          const managersMap = new Map<string, string>(rawEmployees.map((e: any) => [e.id, e.name]));
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
        const desMap = new Map<string, string>(desData.map((d: any) => [d.id, d.name]));
        const visibleSalary = new Map<string, number>();
        for (const salary of salaryR.data ?? []) if (!visibleSalary.has(salary.employee_id)) visibleSalary.set(salary.employee_id, Number(salary.monthly_salary));

        const employeeMap = new Map<string, Employee>();
        if (visibleEmpR.error) {
          for (const employee of fallbackEmployees) employeeMap.set(employee.id, employee);
        } else {
          const visibleRaw = visibleEmpR.data ?? [];
          const managerNames = new Map<string, string>(visibleRaw.map((row: any) => [row.id, row.name]));
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
    ] as Array<[string, string | undefined]>;

    let channel: any = null;
    let retryTimer: number | null = null;
    let stopped = false;
    let retryDelay = 1500;

    const handlePayload = (table: string, payload: any) => {
      const eventKey = `${table}:${payload.eventType}:${payload.new?.id ?? payload.old?.id ?? ''}`;
      if (lastRealtimeEvent.current !== eventKey) {
        lastRealtimeEvent.current = eventKey;
        const now = Date.now();
        window.setTimeout(() => {
          if (lastRealtimeEvent.current === eventKey && Date.now() - now > 800) lastRealtimeEvent.current = '';
        }, 900);

        if (user.role === 'admin' && table === 'attendance') {
          const next = payload.new ?? {};
          const previous = payload.old ?? {};
          const employeeName = dataSnapshot.current.employees.find(employee => employee.id === next.employee_id)?.name ?? 'An employee';
          if (payload.eventType === 'INSERT') {
            notify(employeeName + ' checked in.', 'info', 4200, 'attendance');
          } else if (payload.eventType === 'UPDATE' && next.current_state === 'completed' && previous.current_state !== 'completed') {
            notify(employeeName + ' checked out.', 'info', 4200, 'attendance');
          }
        } else if (user.role === 'admin' && table === 'break_events') {
          const next = payload.new ?? {};
          const previous = payload.old ?? {};
          const employeeName = dataSnapshot.current.employees.find(employee => employee.id === next.employee_id)?.name ?? 'An employee';
          if (payload.eventType === 'INSERT') notify(employeeName + ' started a break.', 'info', 4200, 'attendance');
          else if (payload.eventType === 'UPDATE' && next.break_end && !previous.break_end) notify(employeeName + ' resumed work.', 'info', 4200, 'attendance');
        } else if (table === 'tasks') {
          const next = payload.new ?? {};
          const previous = payload.old ?? {};
          if (user.role === 'employee' && payload.eventType === 'INSERT' && next.assigned_to === user.employeeDbId) {
            notify('New task assigned to you.', 'info', 4200, 'task');
          } else if (user.role === 'employee' && payload.eventType === 'UPDATE' && next.assigned_to === user.employeeDbId && previous.assigned_to !== next.assigned_to) {
            notify('A task has been assigned to you.', 'info', 4200, 'task');
          } else if (user.role === 'admin' && payload.eventType === 'UPDATE' && previous.status !== 'completed' && next.status === 'completed') {
            notify('Employee submitted completed work.', 'success', 4200, 'task');
          }
        } else if ((table === 'leave_requests' || table === 'wfh_requests' || table === 'regularization_requests') && user.role === 'employee') {
          if (payload.eventType === 'UPDATE' && payload.old?.status !== payload.new?.status) {
            const label = table === 'leave_requests' ? 'Leave request' : table === 'wfh_requests' ? 'WFH request' : 'Correction request';
            const category: NotificationCategory = table === 'leave_requests' ? 'leave' : table === 'wfh_requests' ? 'wfh' : 'correction';
            notify(`${label} ${payload.new?.status ?? 'updated'}.`, payload.new?.status === 'approved' ? 'success' : payload.new?.status === 'rejected' ? 'error' : 'info', 4200, category);
          }
        } else if (table === 'leave_requests' || table === 'wfh_requests' || table === 'regularization_requests') {
          if (user.role === 'admin' && payload.eventType === 'INSERT') {
            const label = table === 'leave_requests' ? 'leave' : table === 'wfh_requests' ? 'WFH' : 'attendance correction';
            const category: NotificationCategory | undefined = table === 'leave_requests' ? 'leave' : table === 'wfh_requests' ? 'wfh' : undefined;
            notify('New ' + label + ' request needs review.', 'info', 4200, category);
          }
        } else if (table === 'holidays' && (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE')) {
          notify('Holiday calendar updated.', 'info', 4200, 'holiday');
        } else if (table === 'payroll_records' && user.role === 'employee' && payload.eventType === 'UPDATE' && payload.new?.finalized_at) {
          notify('Your payroll has been finalized.', 'success', 4200, 'payroll');
        }
      }

      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => void reload(), 180);
    };

    const scheduleRetry = () => {
      if (stopped || retryTimer) return;
      const delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, 30000);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (stopped) return;
      if (channel) {
        try { await (supabase as any).removeChannel(channel); } catch { }
        channel = null;
      }
      channel = (supabase as any).channel(`ira-v2-${user.id}-${Date.now()}`);
      for (const [table, filter] of subscriptions) {
        const options: any = { event: '*', schema: 'public', table };
        if (filter) options.filter = filter;
        channel.on('postgres_changes', options, (payload: any) => handlePayload(table, payload));
      }
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          retryDelay = 1500;
          void reload();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Realtime can drop on mobile/network changes. Retry silently instead of showing a blocking error.
          scheduleRetry();
          void reload();
        }
      });
    };

    void connect();

    const fallbackRefresh = window.setInterval(() => {
      if (!stopped) void reload();
    }, 30000);

    return () => {
      stopped = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      window.clearInterval(fallbackRefresh);
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      if (channel) void (supabase as any).removeChannel(channel);
    };
  }, [user, reload]);

  const pendingLeaveCount = leaveRequests.filter(x => x.status === 'pending').length;
  const pendingWfhCount = wfhRequests.filter(x => x.status === 'pending').length;
  const employeeOpenTasksCount = tasks.filter(t => t.assignedTo === user.employeeDbId && t.status === 'assigned').length;

  const navGroups: NavGroup[] = user.role === 'admin'
    ? [
      { items: [{ id: 'admin-dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
      {
        label: 'Clients & delivery', items: [
          { id: 'admin-clients', label: 'Clients', icon: Building2 },
          { id: 'admin-tasks', label: 'Work & Assignments', icon: BriefcaseBusiness },
        ]
      },
      {
        label: 'People', items: [
          { id: 'admin-employees', label: 'Employees', icon: Users },
          { id: 'admin-attendance', label: 'Attendance', icon: Clock3 },
          { id: 'admin-requests', label: 'Requests', icon: FileClock, badge: pendingLeaveCount + pendingWfhCount },
          { id: 'admin-payroll', label: 'Payroll', icon: WalletCards },
          { id: 'admin-holidays', label: 'Holidays', icon: CalendarDays },
        ]
      },
      {
        label: 'Insights & setup', items: [
          { id: 'admin-export', label: 'Reports', icon: Download },
          { id: 'admin-settings', label: 'Settings', icon: Settings2 },
        ]
      },
    ]
    : [
      { items: [{ id: 'emp-dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
      {
        label: 'My work', items: [
          { id: 'emp-tasks', label: 'Work & Assignments', icon: BriefcaseBusiness, badge: employeeOpenTasksCount },
          { id: 'emp-client-work', label: 'Client Projects', icon: FolderKanban },
        ]
      },
      {
        label: 'Time', items: [
          { id: 'emp-attendance', label: 'My Attendance', icon: Clock3 },
          { id: 'emp-leave', label: 'Leave', icon: CalendarDays },
          { id: 'emp-wfh', label: 'Work from home', icon: Home },
          { id: 'emp-holidays', label: 'Holidays', icon: Sparkles },
        ]
      },
      {
        label: 'Me', items: [
          { id: 'emp-payroll', label: 'Payroll', icon: WalletCards },
          { id: 'emp-profile', label: 'Profile', icon: UserRound },
        ]
      },
    ];
  const mobilePrimary = user.role === 'admin'
    ? ['admin-dashboard', 'admin-clients', 'admin-attendance', 'admin-requests']
    : ['emp-dashboard', 'emp-attendance', 'emp-tasks', 'emp-leave'];


  const navigate = (target: string) => {
    const [tab, query] = target.split('?');
    const url = `/${tab}${query ? `?${query}` : ''}`;
    if (typeof window !== 'undefined' && `${window.location.pathname}${window.location.search}` !== url) {
      window.history.pushState(null, '', url);
    }
    setActiveTab(tab);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    const onPopState = () => {
      const p = window.location.pathname.replace(/^\//, '');
      if (p) setActiveTab(p);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
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
      payrollRecords={payrollRecords} loginSessions={loginSessions} employees={employees} designations={designations} rules={rules}
      onRefresh={reload} onSelectTab={navigate}
    />;

  return (
    <>
      <AppShell
        groups={navGroups}
        active={activeTab}
        onNavigate={navigate}
        mobilePrimary={mobilePrimary}
        user={{
          name: user.name || 'User',
          subtitle: user.role === 'admin' ? 'Administrator' : (user.designation || 'Employee'),
          avatar: user.avatar || null,
        }}
        onSignOut={() => void onLogout()}
        topRight={
          <>
            <LiveClockDisplay />
            <NotificationBell activeTab={activeTab} user={user} onSelectTab={navigate} />
          </>
        }
        banner={dataError ? <UiNotice tone="rose" action={<button type="button" onClick={() => void reload()} className="btn-secondary btn-sm">Retry</button>}>{dataError}</UiNotice> : null}
      >
        {loadingData ? <SkeletonPage /> : (
          <div key={activeTab} className="ira-section-transition">
            {selectedComponent}
          </div>
        )}
      </AppShell>
      <ToastHost />
      <ConfirmHost />
    </>
  );
}

function getPageTitle(tab: string) {
  return ({
    'admin-dashboard': 'Dashboard',
    'admin-clients': 'Clients',
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
    'emp-client-work': 'Client Projects',
    'emp-tasks': 'Work & Assignments',
    'emp-leave': 'Leave',
    'emp-wfh': 'WFH',
    'emp-payroll': 'Payroll',
    'emp-holidays': 'Holidays',
    'emp-profile': 'Profile',
  } as Record<string, string>)[tab] ?? 'Dashboard';
}

function AdminContent(props: any) {
  const { activeTab, user, onRefresh, onSelectTab } = props;
  if (activeTab === 'admin-clients') return <AdminClientCenter employees={props.employees} />;
  if (activeTab === 'admin-employees') return <EmployeesAdmin {...props} />;
  if (activeTab === 'admin-attendance') return <AttendanceAdmin {...props} />;
  if (activeTab === 'admin-tasks') return <TasksAdmin {...props} />;
  if (activeTab === 'admin-requests') return <RequestsAdmin {...props} />;
  if (activeTab === 'admin-payroll') return <PayrollAdmin {...props} />;
  if (activeTab === 'admin-holidays') return <HolidaysAdmin {...props} />;
  if (activeTab === 'admin-export') return <ExportsAdmin {...props} />;
  if (activeTab === 'admin-settings') return <SettingsAdmin {...props} />;
  return <AdminHome {...props} onSelectTab={onSelectTab} />;
}

function EmployeeContent(props: any) {
  const { activeTab } = props;
  if (activeTab === 'emp-attendance') return <MyAttendancePage {...props} />;
  if (activeTab === 'emp-client-work') return <ManagerClientWork user={props.user} employees={props.employees} />;
  if (activeTab === 'emp-tasks') return <TasksEmployee {...props} />;
  if (activeTab === 'emp-leave') return <LeavePage {...props} />;
  if (activeTab === 'emp-wfh') return <WfhPage {...props} />;
  if (activeTab === 'emp-payroll') return <PayrollEmployee {...props} />;
  if (activeTab === 'emp-holidays') return <HolidaysPage {...props} />;
  if (activeTab === 'emp-profile') return <ProfileEmployee {...props} />;
  return <EmployeeHome {...props} onSelectTab={props.onSelectTab} />;
}

function PayrollEmployee({ user, payrollPeriods, payrollRecords }: any) {
  const monthOf = (r: PayrollRecord) => (payrollPeriods as PayrollPeriod[]).find((p) => p.id === r.periodId)?.monthStart ?? '';
  const finalized = [...(payrollRecords as PayrollRecord[])]
    .filter((r) => Boolean(r.finalizedAt))
    .sort((a, b) => monthOf(b).localeCompare(monthOf(a)) || (b.finalizedAt ?? '').localeCompare(a.finalizedAt ?? ''));
  const latest = finalized[0];
  const year = today().slice(0, 4);
  const ytd = finalized.filter((r) => monthOf(r).startsWith(year)).reduce((s, r) => s + r.finalPay, 0);
  const monthName = (r: PayrollRecord) => (monthOf(r) ? new Date(`${monthOf(r)}T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—');

  return (
    <Page>
      <PageHeader title="Payroll" subtitle="Your finalized monthly pay and any leave deductions." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat index={0} icon={<WalletCards className="w-5 h-5" />} tone="brand" label="Latest pay" value={latest ? money(latest.finalPay) : '—'} caption={latest ? monthName(latest) : 'No finalized payslip yet'} />
        <Stat index={1} label={`Paid in ${year}`} value={ytd ? money(ytd) : '—'} caption={`${finalized.filter((r) => monthOf(r).startsWith(year)).length} payslip(s) this year`} />
        <Stat index={2} label="Monthly salary" value={money(user.currentSalary)} caption="Current base salary" />
      </div>
      {finalized.length === 0 ? (
        <div className="card"><EmptyState icon={<WalletCards className="w-6 h-6" />} title="No finalized payroll yet" text="Payslips appear here once payroll for a month is finalized." /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {finalized.map((r, i) => (
            <section key={r.id} className="card rise p-5 sm:p-6" style={{ ['--i' as any]: i }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">Payslip</p>
                  <p className="font-display text-xl font-bold text-ink-950 mt-1">{monthName(r)}</p>
                </div>
                <Badge tone="mint" dot>Finalized</Badge>
              </div>
              <p className="stat-value text-[34px] text-ink-950 mt-5">{money(r.finalPay)}</p>
              <div className="mt-4 space-y-0.5">
                <InfoRow label="Salary for the month" value={money(r.salarySnapshot)} />
                <InfoRow label="Paid leave used" value={`${r.paidLeaveDays} day(s)`} />
                <InfoRow label="Unpaid leave" value={`${r.unpaidLeaveDays} day(s)`} />
                <InfoRow label="Leave deduction" value={r.leaveDeduction ? `− ${money(r.leaveDeduction)}` : money(0)} />
              </div>
              <p className="text-[11px] text-ink-400 mt-3">Finalized {r.finalizedAt ? new Date(r.finalizedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</p>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}

async function linkTaskToDeliverable(taskId: string | null | undefined, deliverableId: string) {
  if (!taskId || !deliverableId) return;
  const { error } = await (supabase as any).rpc('staff_link_task_to_deliverable', { p_task_id: taskId, p_deliverable_id: deliverableId });
  if (error) notify(`Task created, but it couldn’t be linked to the deliverable: ${error.message}`, 'error', 7000);
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
  const myDesignation = (designations as Designation[]).find((d: Designation) => d.id === user.designationId);
  const canAssign = Boolean(user.designationId && (myDesignation?.canAssignTasks ?? (designations as Designation[]).some((d: Designation) => d.id === user.designationId && d.canAssignTasks)));
  const visibleAll = tasks.filter((t: Task) => !t.archivedAt && (t.assignedTo === myId || t.assignedBy === myId)).sort((a: Task, b: Task) => a.status === b.status ? a.dueDate.localeCompare(b.dueDate) : a.status === 'completed' ? 1 : -1);
  const [view, setView] = useState<'open' | 'done' | 'given'>('open');
  const mineOpen = visibleAll.filter((t: Task) => t.assignedTo === myId && t.status !== 'completed');
  const mineDone = visibleAll.filter((t: Task) => t.assignedTo === myId && t.status === 'completed');
  const given = visibleAll.filter((t: Task) => t.assignedBy === myId);
  const visible = view === 'open' ? mineOpen : view === 'done' ? mineDone : given;
  const overdueCount = mineOpen.filter((t: Task) => t.dueDate < today()).length;
  const weekEnd = (() => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
  const dueThisWeek = mineOpen.filter((t: Task) => t.dueDate >= today() && t.dueDate <= weekEnd).length;
  const linkable = useLinkableDeliverables(canAssign);
  const deliverableName = (id?: string | null) => { const d = id ? linkable.all.find((x) => x.id === id) : null; return d ? `${d.number ? d.number + ' · ' : ''}${d.name}` : null; };

  const myRules = (rules as AssignmentRule[]).filter(r => r.assignerDesignationId === user.designationId);
  const hasDirectReportRules = myRules.some(r => r.scope === 'direct_reports');
  const directReportDesignations = Array.from(new Set(myRules.filter(r => r.scope === 'direct_reports').map(r => r.assigneeDesignation || 'Direct reports'))).filter(Boolean);

  const targets = (employees as Employee[]).filter((e) =>
    e.status === 'active' &&
    e.id !== myId &&
    myRules.some(
      r => (!r.assigneeDesignationId || r.assigneeDesignationId === e.designationId) &&
        (r.scope === 'any' || (r.scope === 'direct_reports' && e.managerId === myId))
    )
  );

  async function submitTask() {
    if (submitBusy || !submitId) return;
    setMessage('');
    const cleanLink = link.trim();
    if (!/^https?:\/\//i.test(cleanLink)) { setMessage('Paste a valid http(s) work link.'); notify('Paste a valid work link.', 'error'); return; }
    setSubmitBusy(true);
    try {
      const { error } = await (supabase as any).rpc('submit_task', { p_task_id: submitId, p_submitted_link: cleanLink });
      if (error) throw error;
      notify('Work submitted successfully.', 'success');

      // Dispatch recipient notification to the assigner / admin
      const targetTask = (tasks as Task[]).find((t: Task) => t.id === submitId);
      void notifyTaskSubmitted({
        assignerEmployeeId: targetTask?.assignedBy ?? null,
        taskTitle: targetTask?.title ?? 'Task',
        taskId: submitId,
        actorUserId: user.id,
      });

      setSubmitId(''); setLink('');
      await onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit work.';
      setMessage(message);
      notify(message, 'error');
    } finally {
      setSubmitBusy(false);
    }
  }

  async function assignTask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; setMessage('');
    if (assignBusy) return;
    if (targets.length === 0) {
      setMessage('No employees are available for assignment.');
      notify('No employees are available for assignment.', 'error');
      return;
    }
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get('title') ?? '').trim(), to = String(fd.get('assignedTo') ?? ''), start = String(fd.get('startDate') ?? ''), due = String(fd.get('dueDate') ?? '');
    if (!title || !to || !start || !due) { setMessage('Complete all required task fields.'); return; }
    if (due < start) { setMessage('Due date cannot be before the start date.'); return; }
    assignRequestRef.current = crypto.randomUUID(); setAssignBusy(true);
    try {
      const { data: createdTaskId, error } = await (supabase as any).rpc('create_task', { p_title: title, p_description: clean(fd.get('description')), p_assigned_to: to, p_start_date: start, p_due_date: due, p_priority: String(fd.get('priority') ?? 'medium'), p_client_request_id: assignRequestRef.current });
      if (error) throw error;
      notify('Task assigned successfully.', 'success');

      const finalTaskId = createdTaskId || assignRequestRef.current;
      await linkTaskToDeliverable(createdTaskId, String(fd.get('deliverableId') ?? ''));

      // Dispatch recipient notification to assigned employee
      void notifyTaskAssigned({
        assigneeEmployeeId: to,
        taskTitle: title,
        dueDate: due,
        taskId: finalTaskId,
        actorUserId: user.id,
      });

      form.reset(); setAssignOpen(false); await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to assign task.'); notify(error instanceof Error ? error.message : 'Unable to assign task.', 'error'); }
    finally { assignRequestRef.current = null; setAssignBusy(false); }
  }

  return <PageShell
    title="Work & Assignments"
    subtitle="Your assignments, what you’ve handed in, and work you’ve given others."
    actions={canAssign ? <button onClick={() => setAssignOpen(true)} className="btn-primary"><Plus className="w-4 h-4" />Assign task</button> : undefined}
  >
    {message && <Notice type="error" text={message} />}
    <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
      <Stat index={0} icon={<BriefcaseBusiness className="w-5 h-5" />} tone="brand" label="Open" value={mineOpen.length} caption={mineOpen[0] ? `Next due ${dateLabel(mineOpen[0].dueDate)}` : 'Nothing open'} />
      <Stat index={1} label="Due this week" value={dueThisWeek} caption="Next 7 days" />
      <Stat index={2} label="Overdue" value={overdueCount} caption={overdueCount ? 'Past their due date' : 'All on time'} />
      <Stat index={3} label="Completed" value={mineDone.length} caption="Handed in with a work link" />
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <PillTabs value={view} onChange={setView} items={[{ id: 'open', label: 'Open', count: mineOpen.length }, { id: 'done', label: 'Completed', count: mineDone.length }, ...(canAssign || given.length ? [{ id: 'given' as const, label: 'Assigned by me', count: given.length }] : [])]} />
      {canAssign && (
        <Badge tone={targets.length > 0 ? 'brand' : 'amber'}>{targets.length > 0 ? `${targets.length} people you can assign` : 'Direct reports required to assign'}</Badge>
      )}
    </div>
    {assignOpen && (
      <Modal title="Assign work" onClose={() => setAssignOpen(false)} closeDisabled={assignBusy} wide>
        <TaskAssignForm
          targets={targets}
          onSubmit={assignTask}
          onClose={() => setAssignOpen(false)}
          busy={assignBusy}
          isAdmin={false}
          userDesignation={user.designation || myDesignation?.name || 'Manager'}
          directReportDesignations={directReportDesignations}
          hasDirectReportRules={hasDirectReportRules}
          deliverables={linkable.open}
        />
      </Modal>
    )}
    <TaskTable tasks={visible} employeeId={myId} onSubmit={(id) => { setSubmitId(id); setLink('') }} onRefresh={onRefresh} deliverableName={deliverableName} />
    {submitId && <Modal title="Submit completed work" onClose={() => setSubmitId('')}><div className="space-y-4"><div className="rounded-2xl bg-slate-50 border border-slate-200 p-4"><p className="text-sm font-semibold text-slate-900">Paste the final work link</p><p className="text-xs text-slate-500 mt-1">Submitting the link marks the assignment completed and makes the result visible to the person who assigned it.</p></div><input autoFocus value={link} onChange={e => setLink(e.target.value)} placeholder="https://your-work-link.com" className="input" /><div className="flex justify-end gap-2"><button onClick={() => setSubmitId('')} className="btn-secondary">Cancel</button><button disabled={!link.trim() || submitBusy} onClick={() => void submitTask()} className="btn-primary">{submitBusy ? <><RefreshCw className="w-4 h-4 animate-spin" />Submitting…</> : <><CheckCircle2 className="w-4 h-4" />Submit work</>}</button></div></div></Modal>}
  </PageShell>;
}

function TasksAdmin({ tasks, employees, designations, user, onRefresh }: any) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [employee, setEmployee] = useState('all'); const [designation, setDesignation] = useState('all'); const [status, setStatus] = useState('all'); const [priority, setPriority] = useState('all'); const [assignOpen, setAssignOpen] = useState(false); const [showRemoved, setShowRemoved] = useState(false); const [archiveTarget, setArchiveTarget] = useState<Task | null>(null); const [archiveBusy, setArchiveBusy] = useState(false); const [message, setMessage] = useState(''); const [assignBusy, setAssignBusy] = useState(false); const assignRequestRef = useRef<{ signature: string; id: string } | null>(null);
  const activeEmployees = (employees as Employee[]).filter(e => e.status === 'active');
  const linkable = useLinkableDeliverables(true);
  const deliverableName = (id?: string | null) => { const d = id ? linkable.all.find((x) => x.id === id) : null; return d ? `${d.number ? d.number + ' · ' : ''}${d.name}` : null; };
  const live = (tasks as Task[]).filter((t) => !t.archivedAt);
  const openCount = live.filter((t) => t.status !== 'completed').length;
  const overdueAll = live.filter((t) => t.status !== 'completed' && t.dueDate < today()).length;
  const doneCount = live.filter((t) => t.status === 'completed').length;
  const linkedCount = live.filter((t) => t.deliverableId).length;
  const filtered = (tasks as Task[]).filter(t => (showRemoved ? Boolean(t.archivedAt) : !t.archivedAt) && (!from || t.startDate >= from) && (!to || t.startDate <= to) && (employee === 'all' || t.assignedTo === employee) && (designation === 'all' || t.assignedToDesignation === designation) && (status === 'all' || t.status === status) && (priority === 'all' || t.priority === priority)).sort((a: Task, b: Task) => b.updatedAt.localeCompare(a.updatedAt));
  async function assignTask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; setMessage('');
    if (assignBusy) return;
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get('title') || '').trim(), toId = String(fd.get('assignedTo') || ''), start = String(fd.get('startDate') || today()), due = String(fd.get('dueDate') || today()), priorityValue = String(fd.get('priority') || 'medium');
    if (!title || !toId) { setMessage('Task title and employee are required.'); return; }
    if (due < start) { setMessage('Due date cannot be before the start date.'); return; }
    const description = clean(fd.get('description'));
    const signature = JSON.stringify([title, description, toId, start, due, priorityValue]);
    if (assignRequestRef.current?.signature !== signature) assignRequestRef.current = { signature, id: crypto.randomUUID() };
    setAssignBusy(true);
    try {
      const { data: createdTaskId, error } = await (supabase as any).rpc('create_task', { p_title: title, p_description: description, p_assigned_to: toId, p_start_date: start, p_due_date: due, p_priority: priorityValue, p_client_request_id: assignRequestRef.current.id });
      if (error) throw error;

      const finalTaskId = createdTaskId || assignRequestRef.current?.id;
      await linkTaskToDeliverable(createdTaskId, String(fd.get('deliverableId') ?? ''));

      // Dispatch recipient notification to assigned employee
      void notifyTaskAssigned({
        assigneeEmployeeId: toId,
        taskTitle: title,
        dueDate: due,
        taskId: finalTaskId,
        actorUserId: user?.id ?? '',
      });

      assignRequestRef.current = null; notify('Task assigned successfully.', 'success'); form.reset(); setAssignOpen(false); await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to assign task.'); notify(error instanceof Error ? error.message : 'Unable to assign task.', 'error'); }
    finally { setAssignBusy(false); }
  }
  async function removeTask() {
    if (!archiveTarget || archiveBusy) return;
    setArchiveBusy(true); setMessage('');
    try {
      const { error } = await (supabase as any).rpc('archive_task', { p_task_id: archiveTarget.id });
      if (error) throw error;
      notify('Task deleted. Its history is retained under Show removed.', 'success');
      setArchiveTarget(null);
      await onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete this task.';
      setMessage(message); notify(message, 'error');
    } finally { setArchiveBusy(false); }
  }
  return <PageShell
    title="Work & Assignments"
    subtitle="Everything assigned across the team — what’s open, late, handed in, and which client deliverable it serves."
    actions={<button onClick={() => setAssignOpen(true)} className="btn-primary"><Plus className="w-4 h-4" />Assign task</button>}
  >
    {message && <Notice type="error" text={message} />}
    <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
      <Stat index={0} icon={<BriefcaseBusiness className="w-5 h-5" />} tone="brand" label="Open" value={openCount} caption={`${activeEmployees.length} active people`} onClick={() => { setStatus('assigned'); setShowRemoved(false); }} />
      <Stat index={1} label="Overdue" value={overdueAll} caption={overdueAll ? 'Open past due date' : 'All on time'} />
      <Stat index={2} label="Handed in" value={doneCount} caption="Completed with a work link" onClick={() => { setStatus('completed'); setShowRemoved(false); }} />
      <Stat index={3} label="Linked to clients" value={linkedCount} caption="Tasks serving a client deliverable" />
    </div>
    <div className="card p-4 grid sm:grid-cols-2 lg:grid-cols-6 gap-2">
      <FilterInput label="From date"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input" /></FilterInput>
      <FilterInput label="To date"><input type="date" value={to} onChange={e => setTo(e.target.value)} className="input" /></FilterInput>
      <FilterInput label="Employee"><select value={employee} onChange={e => setEmployee(e.target.value)} className="input"><option value="all">All employees</option>{activeEmployees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></FilterInput>
      <FilterInput label="Designation"><select value={designation} onChange={e => setDesignation(e.target.value)} className="input"><option value="all">All</option>{(designations as Designation[]).map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</select></FilterInput>
      <FilterInput label="Status"><select value={status} onChange={e => setStatus(e.target.value)} className="input"><option value="all">All</option><option value="assigned">Assigned</option><option value="completed">Completed</option></select></FilterInput>
      <FilterInput label="Priority"><select value={priority} onChange={e => setPriority(e.target.value)} className="input"><option value="all">All</option>{['low', 'medium', 'high', 'urgent'].map(x => <option key={x}>{x}</option>)}</select></FilterInput>
    </div>
    <div className="flex items-center gap-3"><p className="text-[13px] font-semibold text-ink-600">{filtered.length} task{filtered.length === 1 ? '' : 's'}</p><label className="inline-flex items-center gap-2 text-[13px] text-ink-600"><input type="checkbox" checked={showRemoved} onChange={e => setShowRemoved(e.target.checked)} className="accent-[var(--brand)]" />Show removed</label></div>
    {assignOpen && <Modal title="Assign work" onClose={() => setAssignOpen(false)} closeDisabled={assignBusy} wide><TaskAssignForm targets={activeEmployees} onSubmit={assignTask} onClose={() => setAssignOpen(false)} busy={assignBusy} isAdmin={true} deliverables={linkable.open} /></Modal>}
    <TaskTable tasks={filtered} employeeId="" onSubmit={() => { }} onRefresh={onRefresh} admin onDelete={setArchiveTarget} archivingId={archiveBusy ? archiveTarget?.id : null} deliverableName={deliverableName} />
    {archiveTarget && <Modal title="Delete task allocation?" onClose={() => setArchiveTarget(null)} closeDisabled={archiveBusy}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">“{archiveTarget.title}” will be removed from active task lists. Its assignment, submission and event history will remain available under Show removed.</p>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={archiveBusy} onClick={() => setArchiveTarget(null)} className="btn-secondary disabled:opacity-50">Cancel</button>
          <button type="button" disabled={archiveBusy} onClick={() => void removeTask()} className="btn-secondary border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50">{archiveBusy ? <><RefreshCw className="w-4 h-4 animate-spin" />Deleting…</> : <><Trash2 className="w-4 h-4" />Delete task</>}</button>
        </div>
      </div>
    </Modal>}
  </PageShell>;
}

function TaskAssignForm({
  targets,
  onSubmit,
  onClose,
  busy = false,
  isAdmin = false,
  userDesignation,
  directReportDesignations = [],
  hasDirectReportRules = false,
  deliverables = [],
}: {
  deliverables?: LinkableDeliverable[];
  targets: Employee[];
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  busy?: boolean;
  isAdmin?: boolean;
  userDesignation?: string;
  directReportDesignations?: string[];
  hasDirectReportRules?: boolean;
}) {
  const hasNoTargets = targets.length === 0;

  return (
    <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4">
      {hasNoTargets && (
        <div className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 flex items-start gap-3">
          <div className="p-2 rounded-xl bg-amber-100 text-amber-800 shrink-0 mt-0.5">
            <CircleAlert className="w-5 h-5" />
          </div>
          <div className="space-y-1 text-xs">
            <p className="font-bold text-amber-950 text-sm">No employees available for assignment</p>
            {isAdmin ? (
              <p className="text-amber-900 leading-relaxed">
                There are currently no active employees in the organization. Add active employees under <span className="font-semibold">Employees / HR</span> to begin assigning tasks.
              </p>
            ) : hasDirectReportRules ? (
              <p className="text-amber-900 leading-relaxed">
                Your designation {userDesignation ? <span className="font-semibold">({userDesignation})</span> : ''} is configured to assign tasks to direct reports{directReportDesignations.length ? <> in <span className="font-semibold">{directReportDesignations.join(', ')}</span></> : ''}. However, no active employees are currently assigned to you as their reporting manager in HR.
              </p>
            ) : (
              <p className="text-amber-900 leading-relaxed">
                No active employees are authorized for task assignment under your current designation rules.
              </p>
            )}
            {!isAdmin && (
              <p className="text-amber-850 pt-1 font-medium">
                To delegate tasks, an administrator must assign team members to your reporting hierarchy in <span className="font-semibold">Employees / HR</span>, or configure assignment rules in <span className="font-semibold">Settings</span>.
              </p>
            )}
          </div>
        </div>
      )}

      <label className="md:col-span-2">
        <span className="label">Task</span>
        <input name="title" className="input" placeholder="e.g. Design homepage hero banner" required disabled={hasNoTargets} />
      </label>

      <label className="md:col-span-2">
        <span className="label">Description</span>
        <textarea name="description" className="input min-h-20" placeholder="Task requirements, deliverables and context…" disabled={hasNoTargets} />
      </label>

      <label>
        <span className="label">Assign To</span>
        {hasNoTargets ? (
          <div>
            <select name="assignedTo" disabled className="input bg-slate-50 text-slate-400 cursor-not-allowed border-slate-200" aria-disabled="true">
              <option value="">No authorized employees available</option>
            </select>
            <span className="text-[11px] text-amber-700 mt-1 block font-medium">
              {isAdmin ? 'Add active employees in HR to enable assignment.' : 'Direct reporting line required to delegate tasks.'}
            </span>
          </div>
        ) : (
          <select name="assignedTo" className="input" required defaultValue="">
            <option value="" disabled>Select employee</option>
            {targets.map(e => (
              <option key={e.id} value={e.id}>{e.name} · {e.designation}</option>
            ))}
          </select>
        )}
      </label>

      <label>
        <span className="label">Priority</span>
        <select name="priority" defaultValue="medium" className="input" disabled={hasNoTargets}>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="urgent">urgent</option>
        </select>
      </label>

      {deliverables.length > 0 && (
        <label className="md:col-span-2">
          <span className="label">Client deliverable <span className="font-normal text-ink-400">optional</span></span>
          <select name="deliverableId" defaultValue="" className="input" disabled={hasNoTargets}>
            <option value="">Not linked to a client deliverable</option>
            {Array.from(new Set(deliverables.map((d) => d.projectName))).map((project) => (
              <optgroup key={project} label={project}>
                {deliverables.filter((d) => d.projectName === project).map((d) => (
                  <option key={d.id} value={d.id}>{d.number ? `${d.number} · ` : ''}{d.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="block text-xs text-ink-400 mt-1.5">Links this work to the client’s deliverable so it shows who is responsible.</span>
        </label>
      )}

      <label>
        <span className="label">Start Date</span>
        <input type="date" name="startDate" defaultValue={today()} className="input" required disabled={hasNoTargets} />
      </label>

      <label>
        <span className="label">Due Date</span>
        <input type="date" name="dueDate" defaultValue={today()} className="input" required disabled={hasNoTargets} />
      </label>

      <div className="md:col-span-2 flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || hasNoTargets}
          title={hasNoTargets ? 'Cannot assign: No authorized employees available' : undefined}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? (
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Assigning…
            </span>
          ) : (
            'Assign'
          )}
        </button>
      </div>
    </form>
  );
}

function TaskTable({ tasks, employeeId, onSubmit, onDelete, archivingId, admin, deliverableName }: { tasks: Task[]; employeeId: string; onSubmit: (id: string) => void; onRefresh: () => Promise<void>; onDelete?: (task: Task) => void; archivingId?: string | null; admin?: boolean; deliverableName?: (id?: string | null) => string | null }) {
  return <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="data-table">
    <thead><tr><Th>Task</Th><Th>Assigned To</Th><Th>Dates</Th><Th>Priority</Th><Th>Status</Th><Th>Work Link</Th><Th>Action</Th></tr></thead>
    <tbody>{tasks.map(t => <tr key={t.id}><Td strong><span className="block max-w-[320px] truncate">{t.title}</span>{t.deliverableId ? <span className="mt-1 inline-flex max-w-[320px] truncate items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{deliverableName?.(t.deliverableId) ?? 'Client deliverable'}</span> : t.description ? <span className="block max-w-[320px] truncate text-[11px] font-normal text-ink-400">{t.description}</span> : null}</Td><Td>{t.assignedToName}<span className="block text-[10px] text-slate-400">{t.assignedToDesignation}</span></Td><Td>{dateLabel(t.startDate)} → {dateLabel(t.dueDate)}</Td><Td><PriorityBadge value={t.priority} /></Td><Td><StatusBadge label={t.archivedAt ? 'Removed' : t.status} /></Td><Td>{t.submittedLink ? <div className="space-y-0.5"><a href={t.submittedLink} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1"><Link2 className="w-3.5 h-3.5" />Open work</a>{t.submittedAt && <span className="block text-[10px] text-slate-400">{new Date(t.submittedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>}</div> : '—'}</Td><Td>{admin ? (t.archivedAt ? <span className="text-[10px] text-slate-400">History kept</span> : <button type="button" title="Delete task" aria-label={`Delete task: ${t.title}`} disabled={archivingId === t.id} onClick={() => onDelete?.(t)} className="icon-btn text-rose-600 disabled:opacity-50">{archivingId === t.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}</button>) : (!t.archivedAt && t.assignedTo === employeeId && t.status !== 'completed' ? <button onClick={() => onSubmit(t.id)} className="btn-primary btn-sm">Hand in</button> : '—')}</Td></tr>)}{!tasks.length && <EmptyRow colSpan={7} text="No tasks match the current filters." />}</tbody>
  </table></div></div>;
}

function EmployeesAdmin({ employees, departments, designations, onRefresh }: any) {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all'); const [modal, setModal] = useState<'create' | 'edit' | null>(null); const [editing, setEditing] = useState<Employee | null>(null); const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const filtered = (employees as Employee[]).filter(e => (status === 'all' || e.status === status) && (!search.trim() || `${e.name} ${e.empId} ${e.loginId} ${e.workEmail}`.toLowerCase().includes(search.toLowerCase())));
  return <PageShell title="Employees / HR" subtitle="Create accounts, assign people, manage credentials and onboarding documents.">
    <div className="flex flex-col sm:flex-row gap-2 justify-between">
      <div className="flex gap-2 flex-1"><div className="relative flex-1 max-w-xl"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, employee ID or Login ID…" className="input pl-9" /></div><select value={status} onChange={e => setStatus(e.target.value)} className="input w-auto"><option value="all">All status</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      <button onClick={() => { setEditing(null); setModal('create') }} className="btn-primary"><UserPlus className="w-4 h-4" />Add employee</button>
    </div>
    <div className="mt-4 card overflow-hidden"><div className="overflow-x-auto"><table className="data-table">
      <thead><tr><Th>Employee</Th><Th>Login ID</Th><Th>Designation</Th><Th>Department</Th><Th>Work Mode</Th><Th>Salary</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
      <tbody>{filtered.map(e => <tr key={e.id}><Td strong>{e.name}<span className="block text-[10px] text-slate-400">{e.empId}</span></Td><Td mono>{e.loginId}</Td><Td>{e.designation}</Td><Td>{e.department || '—'}</Td><Td>{e.workMode === 'remote' ? 'Remote' : 'Office'}</Td><Td>{money(e.currentSalary)}</Td><Td><StatusBadge label={e.status} /></Td><Td><div className="flex items-center gap-1.5"><button title="Edit" onClick={() => { setEditing(e); setModal('edit') }} className="icon-btn"><Pencil className="w-4 h-4" /></button><button disabled={statusBusyId === e.id} title={e.status === 'active' ? 'Deactivate' : 'Activate'} onClick={async () => { if (statusBusyId) return; if (!(await confirmDialog(e.status === 'active' ? { title: `Deactivate ${e.name}?`, message: 'Their sign-in will be disabled. All attendance, leave and payroll history is kept.', confirmLabel: 'Deactivate', danger: true } : { title: `Activate ${e.name}?`, message: 'They will be able to sign in again.', confirmLabel: 'Activate' }))) return; setStatusBusyId(e.id); try { await invokeEmployeeAdmin({ action: 'set_status', employeeId: e.id, status: e.status === 'active' ? 'inactive' : 'active' }); notify(e.status === 'active' ? 'Employee access disabled; history preserved.' : 'Employee account activated.', 'success'); await onRefresh(); } catch (error) { notify(error instanceof Error ? error.message : 'Unable to update employee status.', 'error') } finally { setStatusBusyId(null); } }} className="icon-btn">{statusBusyId === e.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}</button></div></Td></tr>)}{!filtered.length && <EmptyRow colSpan={8} text="No employees yet. Add the first employee to create their login." />}</tbody>
    </table></div></div>
    {modal && <EmployeeModal mode={modal} employee={editing} departments={departments} designations={designations} employees={employees} onClose={() => setModal(null)} onSaved={onRefresh} />}
  </PageShell>;
}

function EmployeeModal({ mode, employee, departments, designations, employees, onClose, onSaved }: { mode: 'create' | 'edit'; employee: Employee | null; departments: Department[]; designations: Designation[]; employees: Employee[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [resetBusy, setResetBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState<{ loginId: string; password?: string } | null>(null);
  const [docs, setDocs] = useState<{ type: string; file: File | null }[]>(ALL_DOCUMENT_TYPES.map(type => ({ type, file: null })));
  const [liveDesignations, setLiveDesignations] = useState<Designation[]>(designations);
  const [liveDepartments, setLiveDepartments] = useState<Department[]>(departments);
  const [refsLoading, setRefsLoading] = useState(true);
  const [form, setForm] = useState({
    name: employee?.name ?? '', workEmail: employee?.workEmail ?? '', phone: employee?.phone ?? '', loginId: employee?.loginId ?? '',
    password: '', confirmPassword: '', workMode: employee?.workMode ?? 'office', designationId: employee?.designationId ?? '', designationName: employee?.designation ?? '',
    departmentId: employee?.departmentId ?? '', departmentName: employee?.department ?? '', managerId: employee?.managerId ?? '', managerName: employee?.manager ?? '', joinDate: employee?.joinDate ?? today(), shiftStart: employee?.shift ?? '09:00', shiftEnd: employee?.shiftEnd ?? '18:00', monthlySalary: String(employee?.currentSalary ?? 0)
  });
  const [employeeDocs, setEmployeeDocs] = useState<EmployeeDocument[]>([]);
  useEffect(() => {
    // The parent already loads these reference rows with the authenticated session.
    // Do not make a second table request from the modal: that request can fail under
    // an otherwise valid admin session and is unnecessary for employee creation.
    setLiveDesignations(designations);
    setLiveDepartments(departments);
    setRefsLoading(false);

    setForm(prev => {
      const byName = (designations ?? []).find((d: Designation) => d.name.trim().toLowerCase() === String(prev.designationName || '').trim().toLowerCase());
      const byId = (designations ?? []).find((d: Designation) => d.id === prev.designationId);
      const d = byName ?? byId ?? designations?.[0];
      const depByName = (departments ?? []).find((x: Department) => x.name.trim().toLowerCase() === String(prev.departmentName || '').trim().toLowerCase());
      const depById = (departments ?? []).find((x: Department) => x.id === prev.departmentId);
      const dep = depByName ?? depById;
      return {
        ...prev,
        designationId: d?.id ?? '',
        designationName: d?.name ?? '',
        departmentId: prev.departmentName || prev.departmentId ? (dep?.id ?? '') : '',
        departmentName: prev.departmentName || prev.departmentId ? (dep?.name ?? '') : '',
      };
    });
  }, [designations, departments]);

  useEffect(() => { if (mode === 'edit' && employee) { void (async () => { const { data } = await (supabase as any).from('employee_documents').select('*').eq('employee_id', employee.id).order('created_at', { ascending: false }); if (data) setEmployeeDocs(data.map((r: any) => ({ id: r.id, employeeId: r.employee_id, documentType: r.document_type, fileName: r.file_name, storagePath: r.storage_path, mimeType: r.mime_type, sizeBytes: r.size_bytes, createdAt: r.created_at }))); })(); } }, [mode, employee]);
  const set = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const salary = Number(form.monthlySalary); if (!Number.isFinite(salary) || salary < 0) throw new Error('Enter a valid monthly salary.');
      if (refsLoading) throw new Error('Employee reference data is still loading. Please wait a moment and try again.');
      const currentDesignation =
        liveDesignations.find((d: Designation) => d.name.trim().toLowerCase() === String(form.designationName || '').trim().toLowerCase()) ??
        liveDesignations.find((d: Designation) => d.id === form.designationId);
      if (!currentDesignation) throw new Error('Please select a valid designation.');
      const currentDepartment = form.departmentName
        ? liveDepartments.find((d: Department) => d.name.trim().toLowerCase() === String(form.departmentName).trim().toLowerCase()) ??
        liveDepartments.find((d: Department) => d.id === form.departmentId)
        : null;
      if (form.departmentName && !currentDepartment) throw new Error('Please select a valid department.');

      if (mode === 'create') {
        if (form.password !== form.confirmPassword) throw new Error('Passwords do not match.');
        const result = await invokeEmployeeAdmin({ action: 'create_employee', name: form.name, workEmail: form.workEmail || null, phone: form.phone || null, loginId: form.loginId, password: form.password, workMode: form.workMode, designationId: currentDesignation.id, designationName: currentDesignation.name, departmentId: currentDepartment?.id || null, departmentName: currentDepartment?.name || null, managerId: form.managerId || null, managerName: form.managerName || null, joinDate: form.joinDate, shiftStart: form.shiftStart, shiftEnd: form.shiftEnd, monthlySalary: salary });
        const failedDocs: string[] = [];
        for (const doc of docs) { if (!doc.file) continue; try { await uploadEmployeeDocument(result.employeeId, doc.file, doc.type) } catch (docError) { failedDocs.push(doc.type) } }
        if (failedDocs.length) { setError(`Employee created. Some HR documents still need uploading: ${failedDocs.join(', ')}.`); notify('Employee created; some HR documents need attention.', 'info') } else { notify('Employee created successfully.', 'success') }
        setSuccess({ loginId: result.loginId }); await onSaved();
      } else {
        await invokeEmployeeAdmin({ action: 'update_employee', employeeId: employee!.id, name: form.name, workEmail: form.workEmail || null, phone: form.phone || null, workMode: form.workMode, designationId: currentDesignation.id, designationName: currentDesignation.name, departmentId: currentDepartment?.id || null, departmentName: currentDepartment?.name || null, managerId: form.managerId || null, managerName: form.managerName || null, joinDate: form.joinDate, shiftStart: form.shiftStart, shiftEnd: form.shiftEnd, monthlySalary: salary });
        const failedDocs: string[] = [];
        for (const doc of docs) { if (!doc.file) continue; try { await uploadEmployeeDocument(employee!.id, doc.file, doc.type) } catch { failedDocs.push(doc.type) } }
        if (failedDocs.length) notify(`Employee updated; failed document uploads: ${failedDocs.join(', ')}`, 'info'); else notify('Employee details updated.', 'success');
        await onSaved(); onClose();
      }
    } catch (err) { const message = err instanceof Error ? err.message : 'Unable to save employee.'; setError(message); notify(message, 'error') } finally { setBusy(false); }
  };
  async function resetPassword() { if (!employee || resetBusy) return; setError(''); setResetBusy(true); try { const r = await invokeEmployeeAdmin({ action: 'reset_password', employeeId: employee.id }); setSuccess({ loginId: r.loginId, password: r.temporaryPassword }); notify('Temporary password generated.', 'success') } catch (e) { const message = e instanceof Error ? e.message : 'Unable to reset password.'; setError(message); notify(message, 'error') } finally { setResetBusy(false) } }
  async function viewDoc(doc: EmployeeDocument) { try { const url = await getSignedDocumentUrl(doc.storagePath); window.open(url, '_blank', 'noopener,noreferrer') } catch (e) { const message = e instanceof Error ? e.message : 'Unable to open document.'; setError(message); notify(message, 'error') } }
  return <Modal title={mode === 'create' ? 'Add employee' : 'Edit employee'} onClose={onClose} closeDisabled={busy || resetBusy} wide>
    {success && <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex items-center gap-2 text-emerald-800 font-bold text-sm"><CheckCircle2 className="w-4 h-4" />Employee account ready</div><p className="text-xs text-emerald-700 mt-2">Login ID: <b>{success.loginId}</b>{success.password && <> · Temporary password: <b>{success.password}</b></>}</p>{mode === 'create' && <p className="text-[11px] text-emerald-700 mt-2">Share the password securely. It is not stored in the employee record.</p>}</div>}
    {error && <Notice type="error" text={error} />}
    <form onSubmit={save} className="space-y-6">
      <FormSection title="Personal details" icon={<UserRound className="w-4 h-4" />}><div className="grid md:grid-cols-2 gap-4"><Field label="Full name"><input value={form.name} onChange={e => set('name', e.target.value)} className="input" required /></Field><Field label="Work email"><input type="email" value={form.workEmail} onChange={e => set('workEmail', e.target.value)} className="input" /></Field><Field label="Phone"><input value={form.phone} onChange={e => set('phone', e.target.value)} className="input" /></Field><Field label="Join date"><input type="date" value={form.joinDate} onChange={e => set('joinDate', e.target.value)} className="input" required /></Field></div></FormSection>
      <FormSection title="Assignment" icon={<BriefcaseBusiness className="w-4 h-4" />}><div className="grid md:grid-cols-2 gap-4"><Field label="Designation"><select disabled={refsLoading || !liveDesignations.length} value={form.designationName} onChange={e => { const name = e.target.value; const d = liveDesignations.find(x => x.name === name); setForm(f => ({ ...f, designationName: name, designationId: d?.id ?? '' })) }} className="input" required><option value="">Select designation</option>{liveDesignations.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</select></Field><Field label="Department"><select disabled={refsLoading} value={form.departmentName} onChange={e => { const name = e.target.value; const d = liveDepartments.find(x => x.name === name); setForm(f => ({ ...f, departmentName: name, departmentId: d?.id ?? '' })) }} className="input"><option value="">No department</option>{liveDepartments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</select></Field><Field label="Manager"><select value={form.managerId} onChange={e => set('managerId', e.target.value)} className="input"><option value="">No manager</option>{employees.filter((e: Employee) => e.status === 'active' && e.id !== employee?.id).map((e: Employee) => <option key={e.id} value={e.id}>{e.name} · {e.designation}</option>)}</select></Field><Field label="Work mode"><select value={form.workMode} onChange={e => set('workMode', e.target.value)} className="input"><option value="office">Office</option><option value="remote">Remote</option></select></Field><Field label="Shift start"><input type="time" value={form.shiftStart} onChange={e => set('shiftStart', e.target.value)} className="input" required /></Field><Field label="Shift end"><input type="time" value={form.shiftEnd} onChange={e => set('shiftEnd', e.target.value)} className="input" required /></Field><Field label="Monthly salary"><input type="number" min="0" step="0.01" value={form.monthlySalary} onChange={e => set('monthlySalary', e.target.value)} className="input" required /></Field></div></FormSection>
      {mode === 'create' && <FormSection title="Login" icon={<KeyRound className="w-4 h-4" />}><div className="grid md:grid-cols-3 gap-4"><Field label="Login ID"><input value={form.loginId} onChange={e => set('loginId', e.target.value)} className="input" autoComplete="off" required pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" /></Field><Field label="Password"><input type="password" value={form.password} onChange={e => set('password', e.target.value)} className="input" autoComplete="new-password" minLength={12} required /></Field><Field label="Confirm password"><input type="password" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} className="input" autoComplete="new-password" minLength={12} required /></Field></div></FormSection>}
      {mode === 'create' && <FormSection title="HR onboarding documents" icon={<Upload className="w-4 h-4" />}><div className="grid md:grid-cols-2 gap-3">{docs.map((d, i) => <div key={d.type} className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-700">{d.type}</p><input type="file" onChange={e => setDocs(prev => prev.map((x, idx) => idx === i ? { ...x, file: e.target.files?.[0] ?? null } : x))} className="mt-2 block w-full text-[11px]" /></div>)}</div></FormSection>}
      {mode === 'edit' && <FormSection title="HR documents" icon={<FileText className="w-4 h-4" />}><div className="space-y-2">{employeeDocs.map(d => <button type="button" key={d.id} onClick={() => void viewDoc(d)} className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-left"><span><span className="block text-xs font-bold">{d.documentType}</span><span className="block text-[10px] text-slate-500">{d.fileName}</span></span><Eye className="w-4 h-4 text-slate-400" /></button>)}{!employeeDocs.length && <p className="text-xs text-slate-500">No documents uploaded yet.</p>}</div><div className="grid md:grid-cols-2 gap-3">{docs.map((d, i) => <div key={d.type} className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold">{d.type}</p><input type="file" onChange={e => setDocs(prev => prev.map((x, idx) => idx === i ? { ...x, file: e.target.files?.[0] ?? null } : x))} className="mt-2 block w-full text-[11px]" /></div>)}</div></FormSection>}
      <div className="flex flex-col sm:flex-row justify-between gap-2 pt-2">{mode === 'edit' ? <button type="button" onClick={() => void resetPassword()} className="btn-secondary"><KeyRound className="w-4 h-4" />Reset password</button> : <span />}<div className="flex justify-end gap-2"><button type="button" disabled={busy || resetBusy} onClick={onClose} className="btn-secondary disabled:opacity-50">Cancel</button><button disabled={busy} className="btn-primary">{busy ? 'Saving…' : mode === 'create' ? 'Create employee' : 'Save changes'}</button></div></div>
    </form>
  </Modal>;
}

function AttendanceAdmin({ attendance, employees, leaveRequests, wfhRequests, holidays }: any) {
  const [date, setDate] = useState(today()); const [search, setSearch] = useState(''); const cl = classifyDay(date, holidays);
  const rows = (employees as Employee[]).filter(e => e.status === 'active' && (!search || `${e.name}${e.empId}`.toLowerCase().includes(search.toLowerCase()))).map(e => {
    const record = attendance.find((a: AttendanceRecord) => a.employeeId === e.id && a.date === date); const leave = leaveRequests.find((l: LeaveRequest) => l.employeeId === e.id && l.status === 'approved' && l.startDate <= date && l.endDate >= date);
    return { e, record, leave };
  });
  return <PageShell title="Attendance" subtitle="Daily attendance with explicit login/check-in/break/check-out separation."><div className="card p-4 flex flex-col sm:flex-row gap-3"><label className="flex-1"><span className="label">Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" /></label><label className="flex-1"><span className="label">Search</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee…" className="input" /></label></div><div className="mt-4 card p-4 text-xs flex items-center gap-2"><CalendarDays className="w-4 h-4 text-blue-600" /><b>{dateLabel(date, { weekday: 'long' })}</b><span className="text-slate-500">· {cl.label}</span></div><div className="mt-4 card overflow-hidden"><div className="overflow-x-auto"><table className="data-table"><thead><tr><Th>Employee</Th><Th>Mode</Th><Th>Check-in</Th><Th>Break</Th><Th>Check-out</Th><Th>Working</Th><Th>Status</Th></tr></thead><tbody>{cl.isWorkingDay ? rows.map(({ e, record, leave }: any) => <tr key={e.id}><Td strong>{e.name}<span className="block text-[10px] text-slate-400">{e.empId}</span></Td><Td>{leave ? 'Leave' : record?.mode === 'wfh' ? 'WFH' : record ? 'Office' : e.workMode === 'remote' ? 'WFH' : '—'}</Td><Td mono>{record?.checkIn ?? '—'}</Td><Td mono>{record ? duration(record.breakSeconds) : '—'}</Td><Td mono>{record?.checkOut ?? '—'}</Td><Td mono>{record ? duration(record.workingSeconds) : '—'}</Td><Td><StatusBadge label={leave ? 'Leave' : record?.status ?? (e.joinDate && date < e.joinDate ? 'Not joined' : date > today() ? 'Upcoming' : date === today() ? 'Not checked-in' : 'Not recorded')} /></Td></tr>) : <tr><td colSpan={7} className="p-10 text-center text-sm text-slate-500">{cl.label}. No check-in required.</td></tr>}{cl.isWorkingDay && !rows.length && <EmptyRow colSpan={7} text="No active employees." />}</tbody></table></div></div></PageShell>;
}

function RequestsAdmin({ leaveRequests, wfhRequests, ledgers = [], employees = [], user, onRefresh }: any) {
  const [tab, setTab] = useState<'leave' | 'wfh'>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'wfh' ? 'wfh' : 'leave'
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  async function review(table: string, id: string, status: 'approved' | 'rejected') {
    const key = table + ':' + id;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const selectFields = table === 'leave_requests' ? 'id, employee_id, start_date, end_date' : 'id, employee_id, date';
      const { data, error } = await (supabase as any)
        .from(table)
        .update({ status, reviewed_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'pending')
        .select(selectFields)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This request was already reviewed. Refresh the list.');
      notify(status === 'approved' ? 'Request approved.' : 'Request rejected.', status === 'approved' ? 'success' : 'info', 4200, table === 'leave_requests' ? 'leave' : 'wfh');

      // Generate recipient notification for requesting employee
      if (table === 'leave_requests') {
        void notifyLeaveReviewed({
          employeeDbId: data.employee_id,
          status,
          startDate: data.start_date,
          endDate: data.end_date,
          leaveId: id,
          actorUserId: user?.id ?? '',
        });
      } else if (table === 'wfh_requests') {
        void notifyWfhReviewed({
          employeeDbId: data.employee_id,
          status,
          date: data.date,
          wfhId: id,
          actorUserId: user?.id ?? '',
        });
      }

      await onRefresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to review request.', 'error')
    } finally {
      setBusyKey(null);
    }
  }
  const leavePending = (leaveRequests as LeaveRequest[]).filter((r) => r.status === 'pending');
  const wfhPending = (wfhRequests as WfhRequest[]).filter((r) => r.status === 'pending');
  const balanceOf = (employeeId: string, date: string) =>
    (ledgers as LeaveLedger[]).find((l) => l.employeeId === employeeId && l.periodStart === `${date.slice(0, 7)}-01`);
  const avatarOf = (employeeId: string) => (employees as Employee[]).find((e) => e.id === employeeId)?.avatar || null;
  const rows = tab === 'leave' ? (leaveRequests as LeaveRequest[]) : (wfhRequests as WfhRequest[]);
  const pending = tab === 'leave' ? leavePending : wfhPending;
  const reviewed = rows.filter((r: any) => r.status !== 'pending');
  const table = tab === 'leave' ? 'leave_requests' : 'wfh_requests';

  return (
    <PageShell
      title="Requests"
      subtitle="Approve or reject time off and work-from-home. Employees are notified straight away."
      actions={<PillTabs value={tab} onChange={(v) => { setTab(v); window.history.replaceState(null, '', `/admin-requests?tab=${v}`); }} items={[{ id: 'leave', label: 'Leave', count: leavePending.length }, { id: 'wfh', label: 'Work from home', count: wfhPending.length }]} />}
    >
      <section className="space-y-3">
        <p className="eyebrow">Waiting for you · {pending.length}</p>
        {pending.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {pending.map((r: any, i: number) => {
              const bal = tab === 'leave' ? balanceOf(r.employeeId, r.startDate) : null;
              const available = bal ? Math.max(0, Number(bal.openingBalance) + Number(bal.accrual) + Number(bal.adjustment ?? 0) - Number(bal.paidUsed)) : null;
              const busy = busyKey === `${table}:${r.id}`;
              return (
                <section key={r.id} className="card rise p-5" style={{ ['--i' as any]: i }}>
                  <div className="flex items-start gap-3">
                    <Avatar name={r.employeeName} src={avatarOf(r.employeeId)} size={42} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink-900 truncate">{r.employeeName}</p>
                      <p className="text-xs text-ink-500 truncate">{r.department || '—'} · asked {r.requestedOn ? new Date(r.requestedOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '—'}</p>
                    </div>
                    <Badge tone="amber" dot>Pending</Badge>
                  </div>
                  <div className="mt-4 inset-tile p-4">
                    {tab === 'leave' ? (
                      <>
                        <p className="font-display text-lg font-bold text-ink-950">
                          {r.startDate === r.endDate ? dateLabel(r.startDate, { weekday: 'short', day: 'numeric', month: 'short' }) : `${dateLabel(r.startDate)} → ${dateLabel(r.endDate)}`}
                        </p>
                        <p className="text-[13px] text-ink-600 mt-0.5"><span className="capitalize font-semibold">{r.leaveType}</span> · {r.days} working day{Number(r.days) === 1 ? '' : 's'}{r.duration === 'half' ? ' (half day)' : ''}</p>
                        {available != null && r.leaveType !== 'unpaid' && (
                          <p className={`text-xs mt-1.5 ${available < Number(r.days) ? 'text-amber-700 font-semibold' : 'text-ink-500'}`}>
                            {available} paid day{available === 1 ? '' : 's'} available{available < Number(r.days) ? ` — ${Number(r.days) - available} would be unpaid` : ''}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="font-display text-lg font-bold text-ink-950">{dateLabel(r.date, { weekday: 'long', day: 'numeric', month: 'short' })}</p>
                        <p className="text-[13px] text-ink-600 mt-0.5">{String(r.duration).startsWith('half') ? 'Half day' : 'Full day'} at home</p>
                      </>
                    )}
                    <p className="text-[13px] text-ink-700 mt-3 leading-relaxed">“{r.reason}”</p>
                    {r.note && <p className="text-xs text-ink-500 mt-1">{r.note}</p>}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button type="button" disabled={!!busyKey} onClick={() => void review(table, r.id, 'rejected')} className="btn-secondary flex-1">Reject</button>
                    <button type="button" disabled={!!busyKey} onClick={() => void review(table, r.id, 'approved')} className="btn-primary flex-1">{busy ? 'Saving…' : 'Approve'}</button>
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="card"><EmptyState icon={<CheckCircle2 className="w-6 h-6" />} title="You’re all caught up" text={`No ${tab === 'leave' ? 'leave' : 'work-from-home'} requests are waiting.`} className="!py-10" /></div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="p-5 sm:p-6"><h2 className="font-display text-lg font-bold text-ink-950">Reviewed</h2><p className="text-[13px] text-ink-500 mt-1">{reviewed.length} decision{reviewed.length === 1 ? '' : 's'}</p></div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><Th>Employee</Th><Th>{tab === 'leave' ? 'Dates' : 'Date'}</Th><Th>Details</Th><Th>Decision</Th></tr></thead>
            <tbody>
              {reviewed.map((r: any) => (
                <tr key={r.id}>
                  <Td strong>{r.employeeName}</Td>
                  <Td>{tab === 'leave' ? (r.startDate === r.endDate ? dateLabel(r.startDate) : `${dateLabel(r.startDate)} → ${dateLabel(r.endDate)}`) : dateLabel(r.date)}</Td>
                  <Td>{tab === 'leave' ? <><span className="capitalize">{r.leaveType}</span> · {r.days}d{r.status === 'approved' ? ` · ${r.paidDays ?? 0} paid / ${r.unpaidDays ?? 0} unpaid` : ''}</> : String(r.duration).startsWith('half') ? 'Half day' : 'Full day'}</Td>
                  <Td><StatusBadge label={r.status} /></Td>
                </tr>
              ))}
              {!reviewed.length && <EmptyRow colSpan={4} text="Nothing reviewed yet." />}
            </tbody>
          </table>
        </div>
      </section>
    </PageShell>
  );
}

function PayrollAdmin({ employees, payrollPeriods, payrollRecords, onRefresh }: any) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState<{ monthly: number; divisor: 'calendar_days' | 'working_days' }>({ monthly: 1.5, divisor: 'calendar_days' });
  const period = [...(payrollPeriods as PayrollPeriod[])].find(p => p.monthStart.startsWith(month));
  const records = (payrollRecords as PayrollRecord[])
    .filter(r => period && r.periodId === period.id)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const { data, error } = await (supabase as any).from('payroll_settings').select('monthly_leave_accrual,divisor_mode').eq('id', true).maybeSingle();
      if (!mounted) return;
      if (!error && data) setSettings({ monthly: Number(data.monthly_leave_accrual), divisor: data.divisor_mode });
    })();
    return () => { mounted = false };
  }, []);

  async function generate() {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const { error } = await (supabase as any).rpc('generate_payroll', { p_month: month + '-01' });
      if (error) throw error;
      notify(`Payroll generated for ${month}.`, 'success', 4200, 'payroll');
      setMessage('Draft generated. Review the records before finalizing.');
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to generate payroll.');
      notify(error instanceof Error ? error.message : 'Unable to generate payroll.', 'error');
    } finally { setBusy(false); }
  }

  async function finalize() {
    if (!period || period.status !== 'draft' || busy) return;
    if (!(await confirmDialog({ title: 'Finalize payroll?', message: 'Employees will see these amounts as their payslip. The figures are saved as they are now.', confirmLabel: 'Finalize payroll' }))) return;
    setBusy(true); setMessage('');
    try {
      const { error } = await (supabase as any).rpc('finalize_payroll', { p_period_id: period.id });
      if (error) throw error;
      notify(`Payroll for ${month} finalized.`, 'success', 4200, 'payroll');
      setMessage('Payroll finalized and locked.');
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to finalize payroll.');
      notify(error instanceof Error ? error.message : 'Unable to finalize payroll.', 'error');
    } finally { setBusy(false); }
  }

  return <PageShell title="Payroll" subtitle="Monthly salary snapshots with a review-before-finalize workflow.">
    <div className="grid lg:grid-cols-3 gap-4">
      <section className="card p-5">
        <p className="label">Payroll month</p>
        <input type="month" value={month} onChange={e => { setMonth(e.target.value); setMessage('') }} className="input" />
        <div className="mt-4 text-xs text-slate-500 space-y-2">
          <div className="flex justify-between"><span>Paid-leave accrual</span><b className="text-slate-900">{settings.monthly}</b></div>
          <div className="flex justify-between"><span>Divisor</span><b className="text-slate-900">{settings.divisor === 'calendar_days' ? 'Calendar days' : 'Working days'}</b></div>
          {period && <div className="flex justify-between"><span>Days in divisor</span><b className="text-slate-900">{period.dayDivisor}</b></div>}
          {period && <div className="flex justify-between"><span>Status</span><StatusBadge label={period.status} /></div>}
        </div>
        <div className="flex gap-2 mt-5">
          <button disabled={busy || period?.status === 'finalized'} onClick={() => void generate()} className="btn-primary flex-1">{busy ? 'Generating…' : period?.status === 'finalized' ? 'Finalized & locked' : 'Generate draft'}</button>
          {period && period.status === 'draft' && <button disabled={busy} onClick={() => void finalize()} className="btn-secondary">Finalize</button>}
        </div>
        {message && <p className="text-xs mt-3 text-slate-600">{message}</p>}
      </section>
      <section className="lg:col-span-2 card overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div><h3 className="font-bold text-sm">Payroll records</h3><p className="text-xs text-slate-500 mt-1">{period ? period.status : 'No payroll period generated'} · {records.length} employee record(s)</p></div>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><Th>Employee</Th><Th>Salary Snapshot</Th><Th>Paid Leave</Th><Th>Unpaid Leave</Th><Th>Deduction</Th><Th>Final Pay</Th></tr></thead>
            <tbody>
              {records.map((r: PayrollRecord) => <tr key={r.id}><Td strong>{r.employeeName}</Td><Td>{money(r.salarySnapshot)}</Td><Td>{r.paidLeaveDays}</Td><Td>{r.unpaidLeaveDays}</Td><Td>{money(r.leaveDeduction)}</Td><Td strong>{money(r.finalPay)}</Td></tr>)}
              {!records.length && <EmptyRow colSpan={6} text={period ? 'No records for this period. Generate the payroll draft.' : 'Select a month and generate the payroll draft.'} />}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </PageShell>;
}

function HolidaysAdmin({ holidays, user, onRefresh }: any) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const fd = new FormData(e.currentTarget);
      const date = String(fd.get('date') || '');
      if (!date) throw new Error('Choose a holiday date.');
      const { data: existing } = await (supabase as any).from('holidays').select('id,name,holiday_type').eq('date', date).maybeSingle();
      if (existing) throw new Error(`A holiday is already scheduled for ${date} (${existing.name}).`);
      const holidayName = String(fd.get('name') || '').trim();
      const { data: newH, error } = await (supabase as any).from('holidays').insert({
        name: holidayName,
        date,
        description: clean(fd.get('description')),
        created_by: auth.user?.id ?? null,
        holiday_type: 'company'
      }).select('id').maybeSingle();
      if (error) throw error;
      notify('Company holiday added.', 'success');

      // Dispatch recipient notification to active employees
      void notifyHolidayAdded({
        holidayName,
        date,
        holidayId: newH?.id ?? crypto.randomUUID(),
        actorUserId: auth.user?.id ?? user?.id ?? '',
      });

      form.reset(); setOpen(false); await onRefresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to add holiday.', 'error')
    } finally {
      setBusy(false);
    }
  }
  const [toDelete, setToDelete] = useState<Holiday | null>(null);
  const [deleting, setDeleting] = useState(false);
  async function del(h: Holiday) {
    if (h.holidayType === 'public') { notify('Public calendar holidays are protected.', 'info'); return; }
    setDeleting(true);
    try {
      const { error } = await (supabase as any).from('holidays').delete().eq('id', h.id);
      if (error) throw error;
      notify('Company holiday removed.', 'success');
      setToDelete(null);
      await onRefresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to remove holiday.', 'error');
    } finally {
      setDeleting(false);
    }
  }
  return (
    <PageShell
      title="Holidays"
      subtitle="Company holidays you add are paid non-working days for everyone."
      actions={<button onClick={() => setOpen(true)} className="btn-primary"><Plus className="w-4 h-4" />Add holiday</button>}
    >
      <HolidayList
        holidays={holidays}
        renderActions={(h) => h.holidayType !== 'public'
          ? <button type="button" onClick={() => setToDelete(h)} className="icon-btn hover:!text-rose-600 hover:!bg-rose-50" title="Remove holiday" aria-label={`Remove ${h.name}`}><Trash2 className="w-4 h-4" /></button>
          : null}
      />
      {open && (
        <Modal title="Add a company holiday" onClose={() => setOpen(false)} closeDisabled={busy}>
          <form onSubmit={add} className="space-y-4">
            <Field label="Holiday name"><input name="name" className="input" placeholder="e.g. Founders’ Day" required /></Field>
            <Field label="Date"><input name="date" type="date" className="input" required /></Field>
            <Field label="Description" hint="optional"><input name="description" className="input" /></Field>
            <p className="text-xs text-ink-400">Everyone is notified. Check-in is blocked on this day and leave days skip it.</p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
              <button disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Add holiday'}</button>
            </div>
          </form>
        </Modal>
      )}
      {toDelete && (
        <Modal title="Remove this holiday?" onClose={() => setToDelete(null)} closeDisabled={deleting}>
          <div className="space-y-5">
            <p className="text-sm text-ink-600"><b className="text-ink-900">{toDelete.name}</b> on {dateLabel(toDelete.date, { weekday: 'long', day: 'numeric', month: 'long' })} will become a normal working day.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setToDelete(null)} disabled={deleting}>Keep it</button>
              <button type="button" className="btn-danger" onClick={() => void del(toDelete)} disabled={deleting}>{deleting ? 'Removing…' : 'Remove holiday'}</button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

function validateStrongPassword(password: string) { return password.length >= 12 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password) }

async function isPasswordLeaked(password: string) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  const prefix = hash.slice(0, 5), suffix = hash.slice(5);
  const response = await fetch('https://api.pwnedpasswords.com/range/' + prefix);
  if (!response.ok) throw new Error('Password security verification is temporarily unavailable. Please try again.');
  const body = await response.text();
  return body.split(/\r?\n/).some(line => line.split(':', 1)[0].trim().toUpperCase() === suffix);
}

function ProfileEmployee({ user, onRefresh }: any) {
  const [name, setName] = useState(user.name); const [phone, setPhone] = useState(user.phone ?? ''); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [documents, setDocuments] = useState<EmployeeDocument[]>([]); const [documentsLoading, setDocumentsLoading] = useState(true);
  const [pushState, setPushState] = useState<PushPermissionStatus>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    setPushState(getPushPermissionState());
    void getExistingSubscription().then(sub => setIsSubscribed(Boolean(sub)));
  }, []);

  async function handleTogglePush() {
    setPushBusy(true); setPushFeedback(null);
    try {
      if (isSubscribed) {
        await unsubscribeFromPush(user.id);
        setIsSubscribed(false);
        setPushFeedback({ message: 'Push notifications disabled on this device.', type: 'success' });
        notify('Push notifications disabled.', 'info');
      } else {
        const res = await subscribeToPush(user.id);
        if (!res.success) {
          setPushFeedback({ message: res.error || 'Failed to enable notifications.', type: 'error' });
        } else {
          setIsSubscribed(true);
          setPushState('granted');
          setPushFeedback({ message: 'Push notifications active on this device!', type: 'success' });
          notify('Phone notifications enabled.', 'success');
        }
      }
    } catch (e) {
      setPushFeedback({ message: e instanceof Error ? e.message : 'Error updating push settings.', type: 'error' });
    } finally {
      setPushBusy(false);
    }
  }

  useEffect(() => { let mounted = true; (async () => { if (!user.employeeDbId) { setDocumentsLoading(false); return } const { data, error: docError } = await (supabase as any).from('employee_documents').select('*').eq('employee_id', user.employeeDbId).order('created_at', { ascending: false }); if (!mounted) return; if (docError) { setError(docError.message); setDocuments([]) } else setDocuments((data ?? []).map((r: any) => ({ id: r.id, employeeId: r.employee_id, documentType: r.document_type, fileName: r.file_name, storagePath: r.storage_path, mimeType: r.mime_type, sizeBytes: r.size_bytes, createdAt: r.created_at }))); setDocumentsLoading(false) })(); return () => { mounted = false } }, [user.employeeDbId]);
  async function save() { setError(''); setMessage(''); if (!name.trim()) { setError('Name is required.'); return; } setSaving(true); try { const { error: err } = await (supabase as any).from('employees').update({ name: name.trim(), phone: phone.trim() || null }).eq('id', user.employeeDbId); if (err) throw err; setMessage('Profile updated.'); notify('Profile updated successfully.', 'success'); await onRefresh() } catch (error) { setError(error instanceof Error ? error.message : 'Unable to update profile.'); notify(error instanceof Error ? error.message : 'Unable to update profile.', 'error') } finally { setSaving(false) } }
  async function savePhoto(file: File) { try { if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPG, PNG or WebP image.'); if (file.size > 5 * 1024 * 1024) throw new Error('Profile images must be 5 MB or smaller.'); const url = await uploadAvatar(user.employeeDbId, file); const { error: err } = await (supabase as any).from('employees').update({ avatar_url: url }).eq('id', user.employeeDbId); if (err) throw err; await onRefresh(); setMessage('Profile photo updated.'); notify('Profile photo updated.', 'success') } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update photo.'); notify(e instanceof Error ? e.message : 'Unable to update photo.', 'error') } }
  async function password() { setError(''); setMessage(''); if (!currentPassword) { setError('Enter your current password.'); return } if (!validateStrongPassword(newPassword)) { setError('Password must be at least 12 characters and include uppercase, lowercase, number and symbol.'); return } if (newPassword !== confirm) { setError('New passwords do not match.'); return } setSaving(true); try { const authEmail = user.role === 'admin' ? 'ira.admin@ira-presence.local' : (user.loginId ? loginIdToAuthEmail(user.loginId) : ''); if (!authEmail) throw new Error('Unable to determine the account email.'); const { error: reauthError } = await supabase.auth.signInWithPassword({ email: authEmail, password: currentPassword }); if (reauthError) throw new Error('Current password is incorrect.'); if (await isPasswordLeaked(newPassword)) throw new Error('Choose a different password. This password has appeared in known data breaches.'); const { error: change } = await supabase.auth.updateUser({ password: newPassword }); if (change) throw change; setMessage('Password changed successfully.'); notify('Password changed successfully.', 'success'); setCurrentPassword(''); setNewPassword(''); setConfirm('') } catch (e) { setError(e instanceof Error ? e.message : 'Unable to change password.') } finally { setSaving(false) } }
  async function viewDocument(doc: EmployeeDocument) { try { const url = await getSignedDocumentUrl(doc.storagePath); window.open(url, '_blank', 'noopener,noreferrer') } catch (e) { setError(e instanceof Error ? e.message : 'Unable to open document.') } }
  return <PageShell title="Profile" subtitle="Personal details, HR documents and password."><div className="space-y-4">{(error || message) && <div>{error && <Notice type="error" text={error} />} {message && <Notice type="success" text={message} />}</div>}<div className="grid lg:grid-cols-2 gap-4"><section className="card p-5"><div className="flex items-center gap-4"><div className="relative">{user.avatar ? <img src={user.avatar} alt="" className="w-16 h-16 rounded-full object-cover ring-1 ring-slate-200" /> : <div className="w-16 h-16 rounded-full bg-slate-900 text-white flex items-center justify-center text-xl font-bold">{user.name.slice(0, 1)}</div>}<label className="absolute -right-1 -bottom-1 w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center cursor-pointer shadow-sm"><Upload className="w-4 h-4" /><input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void savePhoto(f) }} /></label></div><div><p className="text-lg font-bold">{user.name}</p><p className="text-xs text-slate-500">{user.designation} · {user.department}</p></div></div><div className="grid gap-4 mt-6"><Field label="Name"><input value={name} onChange={e => setName(e.target.value)} className="input" /></Field><Field label="Phone"><input value={phone} onChange={e => setPhone(e.target.value)} className="input" /></Field><InfoRow label="Login ID" value={user.loginId ?? '—'} /><InfoRow label="Employee ID" value={user.empId ?? '—'} /><InfoRow label="Work mode" value={user.workMode === 'remote' ? 'Remote' : 'Office'} /><InfoRow label="Designation" value={user.designation ?? '—'} /><InfoRow label="Manager" value={user.manager ?? '—'} /><InfoRow label="Monthly salary" value={money(user.currentSalary)} /><button disabled={saving} onClick={() => void save()} className="btn-primary w-fit">{saving ? 'Saving…' : 'Save personal details'}</button></div></section><section className="card p-5"><div className="flex items-center gap-2"><LockKeyhole className="w-4 h-4 text-blue-600" /><div><h3 className="font-bold text-sm">Change password</h3><p className="text-xs text-slate-500">Verify your current password before changing it.</p></div></div><div className="space-y-4 mt-5"><Field label="Current password"><input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="input" /></Field><Field label="New password"><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="input" minLength={12} /></Field><Field label="Confirm new password"><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} className="input" minLength={12} /></Field><button disabled={saving} onClick={() => void password()} className="btn-primary">Change password</button></div></section></div><section className="card p-5"><div className="flex items-center justify-between gap-3 flex-wrap"><div><div className="flex items-center gap-2"><Smartphone className="w-4 h-4 text-blue-600" /><h3 className="font-bold text-sm">Phone Push Notifications</h3></div><p className="text-xs text-slate-500 mt-1">Receive real-time alerts on your phone lock screen for assignments and approvals.</p></div><div className="flex items-center gap-2"><button type="button" disabled={pushBusy} onClick={() => void handleTogglePush()} className={isSubscribed ? 'btn-secondary text-rose-600' : 'btn-primary text-xs'}>{pushBusy ? 'Updating…' : isSubscribed ? 'Disable on this phone' : 'Enable phone notifications'}</button></div></div>{pushFeedback && <div className={`mt-3 p-3 rounded-xl border text-xs ${pushFeedback.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>{pushFeedback.message}</div>}{isIosNeedsHomeScreen() && <div className="mt-3 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1"><p className="font-bold">iPhone Setup Required</p><p className="text-[11px]">To enable push alerts on iOS, tap the Safari <b>Share</b> button, choose <b>Add to Home Screen</b>, and open the app from your home screen.</p></div>}</section><section className="card overflow-hidden"><div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2"><FileText className="w-4 h-4 text-blue-600" /><div><h3 className="font-bold text-sm">HR Documents</h3><p className="text-xs text-slate-500">Your secure employee records.</p></div></div>{documentsLoading ? <div className="p-6 text-sm text-slate-500">Loading documents…</div> : documents.length ? <div className="divide-y divide-slate-100">{documents.map(doc => <div key={doc.id} className="px-5 py-4 flex items-center justify-between gap-4"><div className="min-w-0"><p className="text-sm font-semibold truncate">{doc.fileName}</p><p className="text-[11px] text-slate-500 mt-1">{doc.documentType} · {dateLabel(String(doc.createdAt).slice(0, 10))}</p></div><button className="btn-secondary shrink-0" onClick={() => void viewDocument(doc)}><Eye className="w-3.5 h-3.5 mr-1" />View</button></div>)}</div> : <div className="p-6 text-sm text-slate-500">No HR documents uploaded yet.</div>}</section></div></PageShell>;
}

function ExportsAdmin({ employees, payrollPeriods }: any) {
  const [busy, setBusy] = useState<string | null>(null);
  const download = async (name: string, buildRows: () => Promise<any[]>) => { if (busy) return; setBusy(name); try { const rows = await buildRows(); const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Data'); XLSX.writeFile(wb, `${name}-${today()}.xlsx`); notify(`${rows.length} ${name} record(s) exported.`, 'success') } catch (e) { notify(e instanceof Error ? e.message : 'Unable to export data.', 'error') } finally { setBusy(null) } };
  async function fetchAll(table: string, orderBy: string) { const rows: any[] = []; let from = 0; const size = 1000; for (; ;) { let q = (supabase as any).from(table).select('*').range(from, from + size - 1); if (orderBy) q = q.order(orderBy, { ascending: false }); const { data, error } = await q; if (error) throw error; const page = data ?? []; rows.push(...page); if (page.length < size) break; from += size } return rows }
  const employeeMap = new Map((employees as Employee[]).map(e => [e.id, e]));
  const payrollPeriodMap = new Map((payrollPeriods as PayrollPeriod[]).map(p => [p.id, p]));
  return <PageShell title="Reports / Excel" subtitle="Download complete operational datasets without replacing source records."><div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3"><ExportCard disabled={Boolean(busy)} title={busy === 'employees' ? 'Exporting…' : 'Employees'} icon={<Users className="w-5 h-5" />} onClick={() => void download('employees', async () => (employees as Employee[]).map(e => ({ EmployeeID: e.empId, LoginID: e.loginId, Name: e.name, Designation: e.designation, Department: e.department, WorkMode: e.workMode, Salary: e.currentSalary, Status: e.status })))} /><ExportCard disabled={Boolean(busy)} title={busy === 'attendance' ? 'Exporting…' : 'Attendance'} icon={<Clock3 className="w-5 h-5" />} onClick={() => void download('attendance', async () => { const [raw, breaks] = await Promise.all([fetchAll('attendance_effective', 'date'), fetchAll('break_events', 'break_start')]); const breaksBy = new Map<string, any[]>(); for (const b of breaks) { const list = breaksBy.get(b.attendance_id) ?? []; list.push(b); breaksBy.set(b.attendance_id, list) } return raw.map(r => { const m = mapAttendance(r, employeeMap, breaksBy); return { Date: m.date, Employee: m.employeeName, EmployeeID: m.employeeEmpId, Mode: m.mode, CheckIn: m.checkIn ?? '', CheckOut: m.checkOut ?? '', Break: m.breakDuration ?? '', Working: m.workingHours ?? '', Status: m.status } }) })} /><ExportCard disabled={Boolean(busy)} title={busy === 'tasks' ? 'Exporting…' : 'Tasks'} icon={<BriefcaseBusiness className="w-5 h-5" />} onClick={() => void download('tasks', async () => { const rows = await fetchAll('tasks', 'start_date'); return rows.map(r => { const t = mapTask(r, employeeMap); return { Task: t.title, Employee: t.assignedToName, Start: t.startDate, Due: t.dueDate, Priority: t.priority, Status: t.status, SubmittedLink: t.submittedLink ?? '' } }) })} /><ExportCard disabled={Boolean(busy)} title={busy === 'payroll' ? 'Exporting…' : 'Payroll'} icon={<WalletCards className="w-5 h-5" />} onClick={() => void download('payroll', async () => { const rows = await fetchAll('payroll_records', 'created_at'); return rows.map(r => { const p = mapPayrollRecord(r, employeeMap); const period = payrollPeriodMap.get(p.periodId); return { Period: period?.monthStart?.slice(0, 7) ?? '', Status: p.finalizedAt ? 'finalized' : (period?.status ?? 'draft'), Employee: p.employeeName, Salary: p.salarySnapshot, PaidLeave: p.paidLeaveDays, UnpaidLeave: p.unpaidLeaveDays, Deduction: p.leaveDeduction, FinalPay: p.finalPay } }) })} /></div></PageShell>;
}

function ExportCard({ title, icon, onClick, disabled = false }: { title: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) { return <button disabled={disabled} onClick={onClick} className="export-card text-left disabled:opacity-50 disabled:cursor-not-allowed"><div className="w-10 h-10 rounded-2xl bg-blue-50/85 border border-blue-100 text-blue-600 flex items-center justify-center">{icon}</div><p className="font-bold text-sm mt-4 text-slate-950">{title}</p><p className="text-xs text-slate-500 mt-1">Download XLSX</p><div className="mt-4 text-xs font-bold text-blue-600 inline-flex items-center gap-1">Export <Download className="w-3.5 h-3.5" /></div></button> }

function SettingsAdmin({ designations, departments, rules, onRefresh }: any) {
  const [tab, setTab] = useState('rules');
  const [name, setName] = useState(''); const [canAssign, setCanAssign] = useState(false);
  const [payrollDivisor, setPayrollDivisor] = useState<'calendar_days' | 'working_days'>('calendar_days');
  const [payrollPolicyStatus, setPayrollPolicyStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [payrollPolicyLoadKey, setPayrollPolicyLoadKey] = useState(0);
  const [assigner, setAssigner] = useState(''); const [assignee, setAssignee] = useState(''); const [scope, setScope] = useState<'any' | 'direct_reports'>('direct_reports');
  useEffect(() => { let cancelled = false; (async () => { setPayrollPolicyStatus('loading'); try { const { data, error } = await (supabase as any).from('payroll_settings').select('divisor_mode').eq('id', true).maybeSingle(); if (error || !data || (data.divisor_mode !== 'calendar_days' && data.divisor_mode !== 'working_days')) throw error ?? new Error('Payroll policy is unavailable.'); if (cancelled) return; setPayrollDivisor(data.divisor_mode); setPayrollPolicyStatus('ready') } catch { if (!cancelled) setPayrollPolicyStatus('error') } })(); return () => { cancelled = true } }, [payrollPolicyLoadKey]);
  async function addDesignation() { const value = name.trim(); if (!value) { notify('Enter a designation name.', 'error'); return; } try { const { error } = await (supabase as any).from('designations').insert({ name: value, can_assign_tasks: canAssign }); if (error) throw error; notify('Designation added.', 'success'); setName(''); setCanAssign(false); await onRefresh() } catch (error) { notify(error instanceof Error ? error.message : 'Unable to add designation.', 'error') } }
  async function addDepartment() { const value = name.trim(); if (!value) { notify('Enter a department name.', 'error'); return; } try { const { error } = await (supabase as any).from('departments').insert({ name: value }); if (error) throw error; notify('Department added.', 'success'); setName(''); await onRefresh() } catch (error) { notify(error instanceof Error ? error.message : 'Unable to add department.', 'error') } }
  async function addRule() { if (!assigner) { notify('Select an assigner designation.', 'error'); return; } try { const { error } = await (supabase as any).from('task_assignment_rules').insert({ assigner_designation_id: assigner, assignee_designation_id: assignee || null, scope }); if (error) throw error; notify('Assignment rule added.', 'success'); setAssigner(''); setAssignee(''); await onRefresh() } catch (error) { notify(error instanceof Error ? error.message : 'Unable to add rule.', 'error') } }
  async function deleteRule(id: string) { if (!(await confirmDialog({ title: 'Delete this assignment rule?', message: 'People with this designation will no longer be able to assign work to the other designation.', confirmLabel: 'Delete rule', danger: true }))) return; try { const { error } = await (supabase as any).from('task_assignment_rules').delete().eq('id', id); if (error) throw error; notify('Assignment rule removed.', 'success'); await onRefresh() } catch (error) { notify(error instanceof Error ? error.message : 'Unable to remove rule.', 'error') } }
  async function savePayroll() { if (payrollPolicyStatus !== 'ready') { notify('Load the current payroll policy before saving.', 'error'); return } try { const { data, error } = await (supabase as any).from('payroll_settings').update({ divisor_mode: payrollDivisor }).eq('id', true).select('id').maybeSingle(); if (error) throw error; if (!data) throw new Error('Payroll policy could not be found. Refresh and try again.'); notify('Payroll policy saved.', 'success') } catch (error) { notify(error instanceof Error ? error.message : 'Unable to save payroll policy.', 'error') } }
  return <PageShell title="Settings" subtitle="Configure designations, assignment rules, departments and the payroll divisor policy."><div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">{[['rules', 'Assignment rules'], ['designations', 'Designations'], ['departments', 'Departments'], ['payroll', 'Payroll policy']].map(([id, l]) => <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 rounded-lg text-xs font-bold ${tab === id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>)}</div>{tab === 'rules' && <section className="mt-4 grid lg:grid-cols-2 gap-4"><div className="card p-5"><h3 className="font-bold text-sm">Add assignment rule</h3><div className="space-y-4 mt-4"><Field label="Assigner designation"><select value={assigner} onChange={e => setAssigner(e.target.value)} className="input"><option value="">Select</option>{designations.map((d: Designation) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="Assignee designation"><select value={assignee} onChange={e => setAssignee(e.target.value)} className="input"><option value="">Any designation</option>{designations.map((d: Designation) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="Scope"><select value={scope} onChange={e => setScope(e.target.value as any)} className="input"><option value="direct_reports">Direct reports</option><option value="any">Any employee</option></select></Field><button onClick={() => void addRule()} className="btn-primary">Add rule</button></div></div><div className="card overflow-hidden"><div className="p-5 border-b border-slate-100"><h3 className="font-bold text-sm">Current rules</h3></div>{rules.map((r: AssignmentRule) => <div key={r.id} className="p-4 border-b border-slate-100 flex items-center justify-between gap-3"><p className="text-xs"><b>{r.assignerDesignation}</b> → {r.assigneeDesignation} <span className="text-slate-400">· {r.scope}</span></p><button onClick={() => void deleteRule(r.id)} className="icon-btn text-rose-500"><Trash2 className="w-4 h-4" /></button></div>)}{!rules.length && <EmptyCard text="No assignment rules." />}</div></section>}{tab === 'designations' && <section className="mt-4 grid lg:grid-cols-2 gap-4"><div className="card p-5"><h3 className="font-bold text-sm">Add designation</h3><div className="space-y-4 mt-4"><Field label="Name"><input value={name} onChange={e => setName(e.target.value)} className="input" /></Field><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={canAssign} onChange={e => setCanAssign(e.target.checked)} />Can assign tasks</label><button onClick={() => void addDesignation()} className="btn-primary">Add designation</button></div></div><div className="card p-5">{designations.map((d: Designation) => <div key={d.id} className="flex justify-between p-3 border-b border-slate-100 last:border-0 text-xs"><b>{d.name}</b><span className="text-slate-500">{d.canAssignTasks ? 'Assigns tasks' : 'Receives tasks'}</span></div>)}</div></section>}{tab === 'departments' && <section className="mt-4 grid lg:grid-cols-2 gap-4"><div className="card p-5"><h3 className="font-bold text-sm">Add department</h3><div className="flex gap-2 mt-4"><input value={name} onChange={e => setName(e.target.value)} className="input" /><button onClick={() => void addDepartment()} className="btn-primary">Add</button></div></div><div className="card p-5">{departments.map((d: Department) => <div key={d.id} className="p-3 border-b border-slate-100 last:border-0 text-xs font-bold">{d.name}</div>)}</div></section>}{tab === 'payroll' && <section className="mt-4 card p-5 max-w-xl"><p className="text-sm font-bold">Payroll divisor</p><p className="text-xs text-slate-500 mt-1">Keep this configurable until the company confirms the final payroll policy.</p>{payrollPolicyStatus === 'loading' && <p role="status" className="text-xs text-slate-500 mt-3">Loading current payroll policy…</p>}{payrollPolicyStatus === 'error' && <div role="alert" className="mt-3 text-xs text-rose-700">Could not load the current payroll policy. Saving is disabled until it can be reloaded. <button type="button" onClick={() => setPayrollPolicyLoadKey(value => value + 1)} className="font-bold underline ml-1">Retry</button></div>}<select id="payroll-divisor" value={payrollDivisor} disabled={payrollPolicyStatus !== 'ready'} onChange={e => setPayrollDivisor(e.target.value as 'calendar_days' | 'working_days')} className="input mt-4 disabled:opacity-50"><option value="calendar_days">Calendar days</option><option value="working_days">Working days</option></select><button onClick={() => void savePayroll()} disabled={payrollPolicyStatus !== 'ready'} className="btn-primary mt-4 disabled:opacity-50 disabled:cursor-not-allowed">Save policy</button><p className="text-[11px] text-slate-400 mt-3">Paid leave accrual remains 1.5 days per month and carries forward.</p></section>}</PageShell>;
}

function PageShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Page>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <div className="space-y-4 sm:space-y-5">{children}</div>
    </Page>
  );
}

function NotificationBell({
  activeTab,
  user,
  onSelectTab,
}: {
  activeTab: string;
  user?: AuthUser;
  onSelectTab?: (tab: string) => void;
}) {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [pushState, setPushState] = useState<PushPermissionStatus>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [pushModalOpen, setPushModalOpen] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousTab = useRef(activeTab);

  const loadNotifications = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    try {
      const records = await fetchUserNotifications(user.id, 40);
      setItems(records);
    } catch (e) {
      console.warn('[NotificationBell] Load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const refreshPushStatus = useCallback(async () => {
    const perm = getPushPermissionState();
    setPushState(perm);
    const sub = await getExistingSubscription();
    setIsSubscribed(Boolean(sub));
  }, []);

  useEffect(() => {
    void loadNotifications();
    void refreshPushStatus();
  }, [loadNotifications, refreshPushStatus]);

  // Realtime Supabase listener on notifications table
  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured) return;

    const channel = (supabase as any)
      .channel(`bell-notifications-${user.id}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        (payload: any) => {
          if (payload.eventType === 'INSERT') {
            const next = payload.new as NotificationRecord;
            if (next.recipient_id !== user.id) return;
            setItems((prev) => [next, ...prev.filter((x) => x.id !== next.id)]);
            notify(next.message, 'info', 4200, next.type as any);
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as NotificationRecord;
            if (updated.recipient_id !== user.id) return;
            setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old;
            if (deleted?.id) setItems((prev) => prev.filter((x) => x.id !== deleted.id));
          }
        }
      )
      .subscribe();

    return () => {
      try {
        (supabase as any).removeChannel(channel);
      } catch { }
    };
  }, [user?.id]);

  useEffect(() => {
    if (previousTab.current !== activeTab) {
      previousTab.current = activeTab;
      setOpen(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const unreadCount = items.filter((x) => !x.read_at).length;
  const displayedItems = filter === 'unread' ? items.filter((x) => !x.read_at) : items;

  async function handleMarkRead(id: string) {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, read_at: new Date().toISOString() } : x)));
    await markNotificationAsRead(id);
  }

  async function handleMarkAllRead() {
    if (!user?.id) return;
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    await markAllNotificationsAsRead(user.id);
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setItems((prev) => prev.filter((x) => x.id !== id));
    await deleteNotification(id);
  }

  function handleItemClick(item: NotificationRecord) {
    void handleMarkRead(item.id);
    setOpen(false);
    if (!item.action_url || !onSelectTab) return;

    const url = item.action_url.replace(/^\//, '');
    let targetTab = url;
    if (url.startsWith('admin-requests')) targetTab = 'admin-requests';
    else if (url.startsWith('emp-leave')) targetTab = 'emp-leave';
    else if (url.startsWith('emp-wfh')) targetTab = 'emp-wfh';
    else if (url.startsWith('emp-tasks')) targetTab = 'emp-tasks';
    else if (url.startsWith('admin-tasks')) targetTab = 'admin-tasks';
    else if (url.startsWith('emp-holidays')) targetTab = 'emp-holidays';
    else if (url.startsWith('admin-holidays')) targetTab = 'admin-holidays';
    else if (url.startsWith('emp-attendance')) targetTab = 'emp-attendance';
    else if (url.startsWith('admin-attendance')) targetTab = 'admin-attendance';

    onSelectTab(targetTab);
  }

  async function handleEnablePush() {
    if (!user?.id) return;
    setPushBusy(true);
    setPushFeedback(null);
    try {
      const res = await subscribeToPush(user.id);
      if (!res.success) {
        setPushFeedback({ message: res.error || 'Failed to enable notifications.', type: 'error' });
      } else {
        setIsSubscribed(true);
        setPushState('granted');
        setPushFeedback({ message: 'Mobile notifications enabled successfully on this device.', type: 'success' });
        notify('Phone notifications enabled.', 'success');
      }
    } catch (e) {
      setPushFeedback({ message: e instanceof Error ? e.message : 'Subscription error.', type: 'error' });
    } finally {
      setPushBusy(false);
    }
  }

  async function handleDisablePush() {
    if (!user?.id) return;
    setPushBusy(true);
    try {
      await unsubscribeFromPush(user.id);
      setIsSubscribed(false);
      setPushFeedback({ message: 'Notifications disabled on this device.', type: 'success' });
      notify('Phone notifications disabled.', 'info');
    } catch {
      setPushFeedback({ message: 'Failed to disable notifications.', type: 'error' });
    } finally {
      setPushBusy(false);
    }
  }

  const getCategoryIcon = (type: NotificationType) => {
    switch (type) {
      case 'leave':
        return <CalendarDays className="w-3.5 h-3.5 text-amber-600" />;
      case 'wfh':
        return <Home className="w-3.5 h-3.5 text-indigo-600" />;
      case 'task':
        return <BriefcaseBusiness className="w-3.5 h-3.5 text-blue-600" />;
      case 'attendance':
        return <Clock3 className="w-3.5 h-3.5 text-emerald-600" />;
      case 'holiday':
        return <Sparkles className="w-3.5 h-3.5 text-purple-600" />;
      case 'payroll':
        return <WalletCards className="w-3.5 h-3.5 text-emerald-600" />;
      default:
        return <Bell className="w-3.5 h-3.5 text-slate-600" />;
    }
  };

  const getCategoryBg = (type: NotificationType) => {
    switch (type) {
      case 'leave':
        return 'bg-amber-50 border-amber-200';
      case 'wfh':
        return 'bg-indigo-50 border-indigo-200';
      case 'task':
        return 'bg-blue-50 border-blue-200';
      case 'attendance':
        return 'bg-emerald-50 border-emerald-200';
      case 'holiday':
        return 'bg-purple-50 border-purple-200';
      case 'payroll':
        return 'bg-emerald-50 border-emerald-200';
      default:
        return 'bg-slate-50 border-slate-200';
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="icon-btn icon-btn-surface relative"
        aria-label={unreadCount ? `${unreadCount} notifications` : 'Notifications'}
        aria-expanded={open}
        aria-controls="notification-panel"
      >
        <Bell className="w-4.5 h-4.5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-[var(--app-bg)] tnum">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {createPortal(
        <div
          ref={panelRef}
          id="notification-panel"
          role="region"
          aria-label="Notifications"
          aria-hidden={!open}
          className={
            'fixed left-3 right-3 top-16 lg:top-[72px] max-h-[min(80dvh,34rem)] rounded-3xl border border-ink-100 bg-white shadow-[0_30px_80px_-24px_rgb(20_17_43/0.35)] overflow-hidden z-[85] sm:left-auto sm:right-6 lg:right-8 sm:w-[min(90vw,400px)] origin-top transition-all duration-200 ease-out flex flex-col ' +
            (open ? 'visible opacity-100 translate-y-0 scale-100' : 'invisible pointer-events-none opacity-0 -translate-y-1 scale-95')
          }
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white/50">
            <div>
              <p className="text-xs font-bold text-slate-900">Notifications</p>
              <p className="text-[10px] text-slate-400">
                {unreadCount ? `${unreadCount} unread update${unreadCount === 1 ? '' : 's'}` : 'All caught up'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void handleMarkAllRead()}
                  className="text-[10px] font-bold text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Quick Mobile Web Push Banner */}
          <div className="px-3.5 py-2.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${isSubscribed ? 'bg-emerald-500 ring-2 ring-emerald-200' : 'bg-slate-300'}`} />
              <p className="text-[11px] text-slate-700 truncate font-medium">
                {isSubscribed ? 'Phone push alerts active' : 'Enable phone notifications'}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setPushModalOpen(true)}
                className={
                  isSubscribed
                    ? 'px-2 py-1 rounded-lg text-[10px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition'
                    : 'px-2 py-1 rounded-lg text-[10px] font-bold bg-blue-600 text-white hover:bg-blue-700 transition'
                }
              >
                {isSubscribed ? 'Manage' : 'Enable'}
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex border-b border-slate-100 text-xs px-3 py-1.5 gap-2 shrink-0 bg-white">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-semibold text-[11px] transition ${filter === 'all' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              All ({items.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              className={`px-2.5 py-1 rounded-lg font-semibold text-[11px] transition ${filter === 'unread' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto max-h-[calc(min(80dvh,32rem)_-_8.5rem)] divide-y divide-slate-100 flex-1">
            {loading ? (
              <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                Loading notifications…
              </div>
            ) : displayedItems.length > 0 ? (
              displayedItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  className={`group px-3.5 py-3 hover:bg-slate-50/80 transition-colors cursor-pointer flex items-start gap-3 relative ${!item.read_at ? 'bg-blue-50/30' : ''
                    }`}
                >
                  {/* Category icon */}
                  <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${getCategoryBg(item.type)}`}>
                    {getCategoryIcon(item.type)}
                  </div>

                  {/* Notification Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className={`text-xs ${!item.read_at ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                        {item.title}
                      </p>
                      <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                        {new Date(item.created_at).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Asia/Kolkata',
                        })}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2 leading-relaxed">
                      {item.message}
                    </p>
                    {item.action_url && (
                      <p className="text-[10px] text-blue-600 font-semibold mt-1 inline-flex items-center gap-0.5">
                        Tap to open →
                      </p>
                    )}
                  </div>

                  {/* Actions / Read status */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0 self-center">
                    {!item.read_at && (
                      <span className="w-2 h-2 rounded-full bg-blue-600" title="Unread" />
                    )}
                    <button
                      type="button"
                      onClick={(e) => void handleDelete(e, item.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 transition"
                      title="Dismiss notification"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-10 text-center text-xs text-slate-400">
                {filter === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Phone Push Notifications Modal */}
      {pushModalOpen && (
        <Modal title="Phone Push Notifications" onClose={() => setPushModalOpen(false)}>
          <div className="space-y-4 text-xs text-slate-600">
            {isSubscribed ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-100 shrink-0" />
                  <div>
                    <p className="font-bold text-slate-900 text-xs">Notifications enabled</p>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      You will receive real-time alerts on this device.
                    </p>
                  </div>
                </div>

                {pushFeedback && (
                  <div
                    className={`p-3 rounded-xl border text-[11px] ${pushFeedback.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                      }`}
                  >
                    {pushFeedback.message}
                  </div>
                )}

                <div className="flex justify-between items-center gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={pushBusy}
                    onClick={() => void handleDisablePush()}
                    className="text-xs text-rose-600 hover:text-rose-700 font-semibold py-1.5 transition"
                  >
                    {pushBusy ? 'Disabling…' : 'Turn off on this device'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setPushModalOpen(false)}
                    className="btn-secondary"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-slate-600 text-xs leading-relaxed">
                  Enable device notifications to receive alerts for assignments, approvals, and company updates.
                </p>

                {!isPushSupported() && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
                    <p className="font-bold">Notifications Not Supported</p>
                    <p className="mt-0.5">
                      Your current browser or device environment does not support Web Push notifications.
                    </p>
                  </div>
                )}

                {isIosNeedsHomeScreen() && (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
                    <p className="font-bold text-xs">iPhone / iPad Setup Required</p>
                    <p className="text-[11px] leading-relaxed">
                      Safari on iOS requires adding this website to your Home Screen before Web Push can be enabled:
                    </p>
                    <ol className="list-decimal list-inside text-[11px] space-y-0.5 pt-1 font-medium">
                      <li>Tap the Safari <b>Share</b> button (square with arrow up)</li>
                      <li>Scroll down and tap <b>Add to Home Screen</b></li>
                      <li>Open IRA Attendance from your Home Screen to enable alerts</li>
                    </ol>
                  </div>
                )}

                {pushState === 'denied' && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px]">
                    <p className="font-bold">Notifications Blocked</p>
                    <p className="mt-0.5">
                      Notification permission is blocked in your browser settings. Please click the site settings / lock icon in the browser address bar and set Notifications to Allow.
                    </p>
                  </div>
                )}

                {pushFeedback && (
                  <div
                    className={`p-3 rounded-xl border text-[11px] ${pushFeedback.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                      }`}
                  >
                    {pushFeedback.message}
                  </div>
                )}

                <div className="flex justify-end items-center gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setPushModalOpen(false)}
                    className="btn-secondary"
                  >
                    Close
                  </button>

                  <button
                    type="button"
                    disabled={pushBusy || pushState === 'denied' || !isPushSupported()}
                    onClick={() => void handleEnablePush()}
                    className="btn-primary"
                  >
                    {pushBusy ? 'Enabling…' : 'Enable phone notifications'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function LoadingScreen({ label = 'Loading IRA…' }: { label?: string }) { return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="text-sm text-slate-500 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" />{label}</div></div> }


function FormSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) { return <section className="ira-form-section"><div className="flex items-center gap-3 mb-4"><IconChip icon={icon} tone="brand" size="sm" /><h4 className="font-display text-base font-bold text-ink-950">{title}</h4></div>{children}</section> }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="block"><span className="label">{label}{hint && <span className="font-normal text-ink-400 ml-1">{hint}</span>}</span>{children}</label> }
function FilterInput({ label, children }: { label: string; children: React.ReactNode }) { return <div><span className="label">{label}</span>{children}</div> }
function InfoRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 py-2.5 border-b border-ink-100 last:border-0 text-[13px]"><span className="text-ink-500">{label}</span><b className="text-ink-900 text-right font-semibold">{value}</b></div> }
function Summary({ label, value }: { label: string; value: string | number }) { return <div className="card rise p-4 sm:p-5"><span className="text-[12px] font-semibold text-ink-500 block">{label}</span><b className="stat-value text-[28px] sm:text-[32px] mt-3 block text-ink-950">{value}</b></div> }
function Kpi({ label, value, icon, textValue = false }: { label: string; value: any; icon: React.ReactNode; textValue?: boolean }) { return <div className="card rise p-5"><div className="flex items-center gap-3"><IconChip icon={icon} tone="brand" size="sm" /><span className="text-[13px] font-semibold text-ink-700">{label}</span></div><p className={`mt-4 stat-value text-ink-950 ${textValue ? 'text-2xl' : 'text-[36px]'}`}>{value}</p></div> }
function DarkMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-white/5 border border-white/10 p-3"><span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">{label}</span><p className="text-sm font-bold font-mono mt-1">{value}</p></div> }
function AttendanceMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-50 border border-slate-200 p-3"><span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">{label}</span><p className="text-sm font-bold font-mono mt-1">{value}</p></div> }
function StatusBadge({ label }: { label: string; dark?: boolean }) { return <UiStatusBadge status={String(label ?? '')} /> }
function PriorityBadge({ value }: { value: TaskPriority }) { return <Badge tone={value === 'urgent' || value === 'high' ? 'rose' : value === 'medium' ? 'amber' : 'ink'}><span className="capitalize">{value}</span></Badge> }
function Notice({ type, text }: { type: 'error' | 'success'; text: string }) { return <UiNotice tone={type === 'error' ? 'rose' : 'mint'}>{text}</UiNotice> }
function Th({ children }: { children: React.ReactNode }) { return <th>{children}</th> }
function Td({ children, mono, strong }: { children: React.ReactNode; mono?: boolean; strong?: boolean }) { return <td className={`whitespace-nowrap ${mono ? 'tnum' : ''} ${strong ? 'font-bold text-ink-900' : ''}`}>{children}</td> }
function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) { return <tr><td colSpan={colSpan} className="!py-12 text-center text-ink-400">{text}</td></tr> }
function EmptyCard({ text }: { text: string }) { return <div className="card"><EmptyState title={text} className="!py-10" /></div> }

function clean(v: any) { const s = String(v ?? '').trim(); return s || null }
