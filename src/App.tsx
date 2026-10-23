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
import { FinancePage } from './components/admin/FinancePage';
import { ActivityLogPage } from './components/admin/ActivityLogPage';
import { NotificationsPage } from './components/common/NotificationsPage';
import { GlobalSearch } from './components/common/GlobalSearch';
import { SupportInbox } from './components/common/SupportInbox';
import { TaskDetail } from './components/tasks/TaskDetail';
import { TASK_STATUS, TASK_STATUS_ORDER, fmtMinutes, isTaskClosed, isTaskOpen, isTaskWithAssignee } from './lib/tasks';
import { RolesMatrix } from './components/admin/RolesMatrix';
import { TeamApprovals } from './components/employee/TeamApprovals';
import { LeavePolicySettings } from './components/admin/LeavePolicySettings';
import { PerformanceAdmin } from './components/performance/PerformanceAdmin';
import { PerformancePage } from './components/performance/PerformancePage';
import { leaveApi } from './lib/leave';
import { openFile } from './lib/sigma';
import { EmployeeHome, MyAttendancePage } from './components/employee/EmployeeHome';
import { HolidayList, HolidaysPage, LeavePage, WfhPage } from './components/employee/TimeOffPages';
import { useLinkableDeliverables, type LinkableDeliverable } from './lib/linkableDeliverables';
import { ManagerClientWork } from './components/manager/ManagerClientWork';
import { AppShell, type NavGroup } from './ui/AppShell';
import { Avatar, Badge, EmptyState, IconChip, Notice as UiNotice, Page, PageHeader, PillTabs, SearchInput, SkeletonPage, Stat, StatusBadge as UiStatusBadge } from './ui';
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
  FolderKanban, BadgeIndianRupee, History, UserX, UserCheck, CornerDownRight, ListChecks, ClipboardCheck, Target, LifeBuoy
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
    } else if (user ? user.role === 'admin' : adminPath) {
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

const ADMIN_TABS = ['admin-dashboard', 'admin-clients', 'admin-attendance', 'admin-tasks', 'admin-requests', 'admin-employees', 'admin-payroll', 'admin-holidays', 'admin-export', 'admin-settings', 'admin-finance', 'admin-activity', 'admin-notifications', 'admin-performance', 'admin-support'];
const EMP_TABS = ['emp-dashboard', 'emp-attendance', 'emp-client-work', 'emp-tasks', 'emp-leave', 'emp-wfh', 'emp-holidays', 'emp-payroll', 'emp-profile', 'emp-notifications', 'emp-approvals', 'emp-performance', 'emp-support'];
const CROSS_ROLE: Record<string, string> = {
  'admin-tasks': 'emp-tasks', 'admin-attendance': 'emp-attendance', 'admin-holidays': 'emp-holidays', 'admin-payroll': 'emp-payroll', 'admin-notifications': 'emp-notifications',
  'emp-tasks': 'admin-tasks', 'emp-attendance': 'admin-attendance', 'emp-holidays': 'admin-holidays', 'emp-payroll': 'admin-payroll', 'emp-leave': 'admin-requests', 'emp-wfh': 'admin-requests', 'emp-notifications': 'admin-notifications', 'emp-approvals': 'admin-requests', 'emp-performance': 'admin-performance', 'admin-performance': 'emp-performance', 'admin-support': 'emp-support', 'emp-support': 'admin-support', 'admin-clients': 'emp-client-work',
};
/** Cross-role mappings whose pages understand the same deep-link query. */
const QUERY_SAFE = new Set(['admin-clients>emp-client-work', 'admin-tasks>emp-tasks', 'emp-tasks>admin-tasks', 'admin-support>emp-support', 'emp-support>admin-support']);

/** The page a path resolves to for this role; links meant for the other role land on the closest equivalent. */
/** Older notification links that pre-date the current routes. */
const LEGACY_ROUTES: Record<string, string> = {
  'admin/clients': 'admin-clients', 'my-deliverables': 'emp-client-work', 'admin/tasks': 'admin-tasks', 'admin/leave': 'admin-requests',
};

function resolveTab(role: AuthUser['role'], raw: string): string {
  const stripped = raw.replace(/^\//, '').split('?')[0].replace(/\/$/, '');
  const tab = LEGACY_ROUTES[stripped] ?? stripped;
  const allowed = role === 'admin' ? ADMIN_TABS : EMP_TABS;
  if (allowed.includes(tab)) return tab;
  if (role === 'admin' && tab === 'admin-reports') return 'admin-export';
  const mapped = CROSS_ROLE[tab];
  if (mapped && allowed.includes(mapped)) return mapped;
  return role === 'admin' ? 'admin-dashboard' : 'emp-dashboard';
}

function Portal({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const getInitialTab = () => resolveTab(user.role, typeof window !== 'undefined' ? window.location.pathname : '');
  const [activeTab, setActiveTab] = useState(getInitialTab);
  // Bumped on every navigation so a page re-reads its deep link (?project=, ?task=…) even when the tab doesn't change.
  const [navKey, setNavKey] = useState(0);

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
          } else if (user.role === 'admin' && payload.eventType === 'UPDATE' && previous.status !== next.status && (next.status === 'awaiting_review' || next.status === 'blocked')) {
            notify(next.status === 'blocked' ? 'A task is blocked.' : 'Work handed in for review.', next.status === 'blocked' ? 'info' : 'success', 4200, 'task');
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
  const employeeOpenTasksCount = tasks.filter(t => !t.archivedAt && ((t.assignedTo === user.employeeDbId && (t.status === 'assigned' || t.status === 'revision_required')) || (t.assignedBy === user.employeeDbId && t.status === 'awaiting_review'))).length;

  const managesPeople = user.role !== 'admin' && employees.some(e => e.managerId === user.employeeDbId && e.status === 'active');

  const navGroups: NavGroup[] = user.role === 'admin'
    ? [
      { items: [{ id: 'admin-dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
      {
        label: 'Clients & delivery', items: [
          { id: 'admin-clients', label: 'Clients', icon: Building2 },
          { id: 'admin-finance', label: 'Finance', icon: BadgeIndianRupee },
          { id: 'admin-support', label: 'Client support', icon: LifeBuoy },
          { id: 'admin-tasks', label: 'Work & Assignments', icon: BriefcaseBusiness, badge: tasks.filter(t => !t.archivedAt && t.status === 'awaiting_review').length },
        ]
      },
      {
        label: 'People', items: [
          { id: 'admin-employees', label: 'Employees', icon: Users },
          { id: 'admin-attendance', label: 'Attendance', icon: Clock3 },
          { id: 'admin-requests', label: 'Requests', icon: FileClock, badge: pendingLeaveCount + pendingWfhCount },
          { id: 'admin-performance', label: 'Performance', icon: Target },
          { id: 'admin-payroll', label: 'Payroll', icon: WalletCards },
          { id: 'admin-holidays', label: 'Holidays', icon: CalendarDays },
        ]
      },
      {
        label: 'Insights & setup', items: [
          { id: 'admin-export', label: 'Reports', icon: Download },
          { id: 'admin-activity', label: 'Activity log', icon: History },
          { id: 'admin-notifications', label: 'Notifications', icon: Bell },
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
      ...(managesPeople ? [{ label: 'My team', items: [{ id: 'emp-approvals', label: 'Team approvals', icon: ClipboardCheck }] }] : []),
      {
        label: 'Me', items: [
          { id: 'emp-performance', label: 'Performance', icon: Target },
          { id: 'emp-payroll', label: 'Payroll', icon: WalletCards },
          { id: 'emp-notifications', label: 'Notifications', icon: Bell },
          { id: 'emp-profile', label: 'Profile', icon: UserRound },
        ]
      },
    ];
  const mobilePrimary = user.role === 'admin'
    ? ['admin-dashboard', 'admin-clients', 'admin-attendance', 'admin-requests']
    : ['emp-dashboard', 'emp-attendance', 'emp-tasks', 'emp-leave'];


  const navigate = (target: string) => {
    const [rawTab, rawQuery] = target.split('?');
    const tab = resolveTab(user.role, rawTab);
    const cleanRaw = rawTab.replace(/^\//, '');
    const query = tab === cleanRaw || QUERY_SAFE.has(`${cleanRaw}>${tab}`) ? rawQuery : undefined;
    const url = `/${tab}${query ? `?${query}` : ''}`;
    if (typeof window !== 'undefined' && `${window.location.pathname}${window.location.search}` !== url) {
      window.history.pushState(null, '', url);
    }
    setActiveTab(tab);
    setNavKey((k) => k + 1);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    const onPopState = () => {
      setActiveTab(resolveTab(user.role, window.location.pathname));
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
            <GlobalSearch role={user.role} onNavigate={navigate} />
            <LiveClockDisplay />
            <NotificationBell activeTab={activeTab} user={user} onSelectTab={navigate} />
          </>
        }
        banner={dataError ? <UiNotice tone="rose" action={<button type="button" onClick={() => void reload()} className="btn-secondary btn-sm">Retry</button>}>{dataError}</UiNotice> : null}
      >
        {loadingData ? <SkeletonPage /> : (
          <div key={activeTab} className="ira-section-transition">
            <React.Fragment key={`${activeTab}:${navKey}`}>{selectedComponent}</React.Fragment>
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
    'admin-export': 'Reports',
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
    'admin-notifications': 'Notifications',
    'emp-notifications': 'Notifications',
    'emp-approvals': 'Team approvals',
    'emp-performance': 'Performance',
    'admin-performance': 'Performance',
    'admin-support': 'Client support',
    'emp-support': 'Client support',
    'admin-finance': 'Finance',
    'admin-activity': 'Activity log',
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
  if (activeTab === 'admin-finance') return <FinancePage onSelectTab={onSelectTab} />;
  if (activeTab === 'admin-activity') return <ActivityLogPage />;
  if (activeTab === 'admin-support') return <SupportInbox employees={props.employees} canAssign />;
  if (activeTab === 'admin-performance') return <PerformanceAdmin employees={props.employees} designations={props.designations} />;
  if (activeTab === 'admin-notifications') return <NotificationsPage user={user} onOpen={onSelectTab} />;
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
  if (activeTab === 'emp-support') return <SupportInbox employees={props.employees} canAssign={false} />;
  if (activeTab === 'emp-performance') return <PerformancePage user={props.user} employees={props.employees} />;
  if (activeTab === 'emp-approvals') return <TeamApprovals onRefresh={props.onRefresh} />;
  if (activeTab === 'emp-notifications') return <NotificationsPage user={props.user} onOpen={props.onSelectTab} />;
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

async function setTaskEstimate(taskId: string | null | undefined, hoursRaw: FormDataEntryValue | null) {
  const hours = Number(hoursRaw ?? '');
  if (!taskId || !Number.isFinite(hours) || hours <= 0) return;
  const { error } = await (supabase as any).rpc('task_set_estimate', { p_task_id: taskId, p_minutes: Math.round(hours * 60) });
  if (error && !/does not exist|could not find/i.test(error.message)) notify(`Task created, but the estimate wasn’t saved: ${error.message}`, 'error', 6000);
}

async function linkTaskToDeliverable(taskId: string | null | undefined, deliverableId: string) {
  if (!taskId || !deliverableId) return;
  const { error } = await (supabase as any).rpc('staff_link_task_to_deliverable', { p_task_id: taskId, p_deliverable_id: deliverableId });
  if (error) notify(`Task created, but it couldn’t be linked to the deliverable: ${error.message}`, 'error', 7000);
}

/** Hide subtasks from a list when their parent is also listed — they're shown inside the parent. */
function topLevel(list: Task[]) {
  const ids = new Set(list.map((t) => t.id));
  return list.filter((t) => !t.parentTaskId || !ids.has(t.parentTaskId));
}
const byDue = (a: Task, b: Task) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title);

function TasksEmployee({ user, tasks, employees, designations, rules, onRefresh }: any) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('task'));
  const assignRequestRef = useRef<string | null>(null);
  const myId = user.employeeDbId!;
  const myDesignation = (designations as Designation[]).find((d: Designation) => d.id === user.designationId);
  const canAssign = Boolean(user.designationId && (myDesignation?.canAssignTasks ?? (designations as Designation[]).some((d: Designation) => d.id === user.designationId && d.canAssignTasks)));
  const all = (tasks as Task[]).filter((t) => !t.archivedAt && (t.assignedTo === myId || t.assignedBy === myId));
  const [view, setView] = useState<'open' | 'review' | 'done' | 'given'>('open');
  const mine = all.filter((t) => t.assignedTo === myId);
  const mineOpen = mine.filter(isTaskWithAssignee).sort(byDue);
  const mineReview = mine.filter((t) => t.status === 'awaiting_review').sort(byDue);
  const mineDone = mine.filter(isTaskClosed).sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));
  const given = all.filter((t) => t.assignedBy === myId && t.assignedTo !== myId).sort((a, b) => (a.status === 'awaiting_review' ? -1 : 0) - (b.status === 'awaiting_review' ? -1 : 0) || byDue(a, b));
  const toReview = given.filter((t) => t.status === 'awaiting_review').length;
  const visible = topLevel(view === 'open' ? mineOpen : view === 'review' ? mineReview : view === 'done' ? mineDone : given);
  const overdueCount = mineOpen.filter((t) => t.dueDate < today()).length;
  const weekEnd = (() => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
  const dueThisWeek = mineOpen.filter((t) => t.dueDate >= today() && t.dueDate <= weekEnd).length;
  const linkable = useLinkableDeliverables(canAssign);
  const deliverableName = (id?: string | null) => { const d = id ? linkable.all.find((x) => x.id === id) : null; return d ? `${d.number ? d.number + ' · ' : ''}${d.name}` : null; };

  const myRules = (rules as AssignmentRule[]).filter(r => r.assignerDesignationId === user.designationId);
  const hasDirectReportRules = myRules.some(r => r.scope === 'direct_reports');
  const directReportDesignations = Array.from(new Set(myRules.filter(r => r.scope === 'direct_reports').map(r => r.assigneeDesignation || 'Direct reports'))).filter(Boolean);
  const targets = (employees as Employee[]).filter((e) =>
    e.status === 'active' && e.id !== myId &&
    myRules.some(r => (!r.assigneeDesignationId || r.assigneeDesignationId === e.designationId) && (r.scope === 'any' || (r.scope === 'direct_reports' && e.managerId === myId)))
  );
  const openTask = openId ? (tasks as Task[]).find((t) => t.id === openId) ?? null : null;

  async function assignTask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; setMessage('');
    if (assignBusy) return;
    if (targets.length === 0) { setMessage('No employees are available for assignment.'); notify('No employees are available for assignment.', 'error'); return; }
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get('title') ?? '').trim(), to = String(fd.get('assignedTo') ?? ''), start = String(fd.get('startDate') ?? ''), due = String(fd.get('dueDate') ?? '');
    if (!title || !to || !start || !due) { setMessage('Complete all required task fields.'); return; }
    if (due < start) { setMessage('Due date cannot be before the start date.'); return; }
    assignRequestRef.current = crypto.randomUUID(); setAssignBusy(true);
    try {
      const { data: createdTaskId, error } = await (supabase as any).rpc('create_task', { p_title: title, p_description: clean(fd.get('description')), p_assigned_to: to, p_start_date: start, p_due_date: due, p_priority: String(fd.get('priority') ?? 'medium'), p_client_request_id: assignRequestRef.current });
      if (error) throw error;
      notify('Task assigned.', 'success');
      await linkTaskToDeliverable(createdTaskId, String(fd.get('deliverableId') ?? ''));
      await setTaskEstimate(createdTaskId, fd.get('estimateHours'));
      void notifyTaskAssigned({ assigneeEmployeeId: to, taskTitle: title, dueDate: due, taskId: createdTaskId || assignRequestRef.current, actorUserId: user.id });
      form.reset(); setAssignOpen(false); await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to assign task.'); notify(error instanceof Error ? error.message : 'Unable to assign task.', 'error'); }
    finally { assignRequestRef.current = null; setAssignBusy(false); }
  }

  return <PageShell
    title="Work & Assignments"
    subtitle="What you’re working on, what’s waiting for review, and work you’ve given others."
    actions={canAssign ? <button onClick={() => setAssignOpen(true)} className="btn-primary"><Plus className="w-4 h-4" />Assign task</button> : undefined}
  >
    {message && <UiNotice tone="rose">{message}</UiNotice>}
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      <Stat index={0} icon={<BriefcaseBusiness className="w-5 h-5" />} tone="brand" label="To do" value={mineOpen.length} caption={mineOpen[0] ? `Next due ${dateLabel(mineOpen[0].dueDate)}` : 'Nothing open'} onClick={() => setView('open')} />
      <Stat index={1} label="Due this week" value={dueThisWeek} caption="Next 7 days" onClick={() => setView('open')} />
      <Stat index={2} label="Overdue" value={overdueCount} tone={overdueCount ? 'rose' : 'brand'} caption={overdueCount ? 'Past their due date' : 'All on time'} onClick={() => setView('open')} />
      <Stat index={3} label={given.length ? 'Waiting for your review' : 'In review'} value={given.length ? toReview : mineReview.length} caption={given.length ? 'Handed in by your team' : 'Handed in, awaiting approval'} onClick={() => setView(given.length ? 'given' : 'review')} />
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <PillTabs value={view} onChange={setView} items={[
        { id: 'open', label: 'To do', count: mineOpen.length },
        { id: 'review', label: 'In review', count: mineReview.length || undefined },
        { id: 'done', label: 'Done', count: mineDone.length || undefined },
        ...(canAssign || given.length ? [{ id: 'given' as const, label: toReview ? `Assigned by me · ${toReview} to review` : 'Assigned by me', count: given.length }] : []),
      ]} />
      {canAssign && <Badge tone={targets.length > 0 ? 'brand' : 'amber'}>{targets.length > 0 ? `${targets.length} people you can assign` : 'Direct reports required to assign'}</Badge>}
    </div>
    {assignOpen && (
      <Modal title="Assign work" onClose={() => setAssignOpen(false)} closeDisabled={assignBusy} wide>
        <TaskAssignForm targets={targets} onSubmit={assignTask} onClose={() => setAssignOpen(false)} busy={assignBusy} isAdmin={false}
          userDesignation={user.designation || myDesignation?.name || 'Manager'} directReportDesignations={directReportDesignations}
          hasDirectReportRules={hasDirectReportRules} deliverables={linkable.open} />
      </Modal>
    )}
    <TaskTable tasks={visible} allTasks={tasks} onOpen={(t) => setOpenId(t.id)} showAssignee={view === 'given'} deliverableName={deliverableName}
      empty={view === 'open' ? 'Nothing to do right now.' : view === 'review' ? 'Nothing waiting for review.' : view === 'done' ? 'No finished tasks yet.' : 'You haven’t assigned any work yet.'} />
    {openTask && <TaskDetail task={openTask} tasks={tasks} employees={employees} viewer={{ employeeId: myId, isAdmin: false }} subtaskTargets={targets}
      deliverableName={deliverableName} onClose={() => setOpenId(null)} onChanged={onRefresh} />}
  </PageShell>;
}

function TasksAdmin({ tasks, employees, designations, user, onRefresh }: any) {
  const [search, setSearch] = useState(''); const [employee, setEmployee] = useState('all'); const [designation, setDesignation] = useState('all'); const [status, setStatus] = useState<string>('open'); const [priority, setPriority] = useState('all'); const [assignOpen, setAssignOpen] = useState(false); const [archiveTarget, setArchiveTarget] = useState<Task | null>(null); const [archiveBusy, setArchiveBusy] = useState(false); const [message, setMessage] = useState(''); const [assignBusy, setAssignBusy] = useState(false); const assignRequestRef = useRef<{ signature: string; id: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('task'));
  const activeEmployees = (employees as Employee[]).filter(e => e.status === 'active');
  const linkable = useLinkableDeliverables(true);
  const deliverableName = (id?: string | null) => { const d = id ? linkable.all.find((x) => x.id === id) : null; return d ? `${d.number ? d.number + ' · ' : ''}${d.name}` : null; };
  const live = (tasks as Task[]).filter((t) => !t.archivedAt);
  const openCount = live.filter(isTaskOpen).length;
  const overdueAll = live.filter((t) => isTaskWithAssignee(t) && t.dueDate < today()).length;
  const reviewCount = live.filter((t) => t.status === 'awaiting_review').length;
  const blockedCount = live.filter((t) => t.status === 'blocked').length;
  const q = search.trim().toLowerCase();
  const filtered = topLevel((tasks as Task[]).filter(t =>
    (status === 'removed' ? Boolean(t.archivedAt) : !t.archivedAt) &&
    (status === 'all' || status === 'removed' || (status === 'open' ? isTaskOpen(t) : status === 'overdue' ? isTaskWithAssignee(t) && t.dueDate < today() : t.status === status)) &&
    (employee === 'all' || t.assignedTo === employee) && (designation === 'all' || t.assignedToDesignation === designation) &&
    (priority === 'all' || t.priority === priority) && (!q || `${t.title} ${t.assignedToName} ${t.description ?? ''}`.toLowerCase().includes(q))
  )).sort((a: Task, b: Task) => (status === 'open' || status === 'overdue' ? byDue(a, b) : b.updatedAt.localeCompare(a.updatedAt)));
  const openTask = openId ? (tasks as Task[]).find((t) => t.id === openId) ?? null : null;

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
      await linkTaskToDeliverable(createdTaskId, String(fd.get('deliverableId') ?? ''));
      await setTaskEstimate(createdTaskId, fd.get('estimateHours'));
      void notifyTaskAssigned({ assigneeEmployeeId: toId, taskTitle: title, dueDate: due, taskId: createdTaskId || assignRequestRef.current?.id, actorUserId: user?.id ?? '' });
      assignRequestRef.current = null; notify('Task assigned.', 'success'); form.reset(); setAssignOpen(false); await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to assign task.'); notify(error instanceof Error ? error.message : 'Unable to assign task.', 'error'); }
    finally { setAssignBusy(false); }
  }
  async function removeTask() {
    if (!archiveTarget || archiveBusy) return;
    setArchiveBusy(true); setMessage('');
    try {
      const { error } = await (supabase as any).rpc('archive_task', { p_task_id: archiveTarget.id });
      if (error) throw error;
      notify('Task removed. Its history is kept under Removed.', 'success');
      setArchiveTarget(null); setOpenId(null);
      await onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to remove this task.';
      setMessage(message); notify(message, 'error');
    } finally { setArchiveBusy(false); }
  }
  return <PageShell
    title="Work & Assignments"
    subtitle="Everything assigned across the team — what’s moving, what’s stuck, what’s waiting for review, and which client deliverable it serves."
    actions={<button onClick={() => setAssignOpen(true)} className="btn-primary"><Plus className="w-4 h-4" />Assign task</button>}
  >
    {message && <UiNotice tone="rose">{message}</UiNotice>}
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      <Stat index={0} icon={<BriefcaseBusiness className="w-5 h-5" />} tone="brand" label="Open" value={openCount} caption={`${activeEmployees.length} active people`} onClick={() => setStatus('open')} />
      <Stat index={1} label="To review" value={reviewCount} tone={reviewCount ? 'amber' : 'brand'} caption="Handed in, waiting for approval" onClick={() => setStatus('awaiting_review')} />
      <Stat index={2} label="Blocked" value={blockedCount} tone={blockedCount ? 'rose' : 'brand'} caption="Can’t continue without help" onClick={() => setStatus('blocked')} />
      <Stat index={3} label="Overdue" value={overdueAll} tone={overdueAll ? 'rose' : 'brand'} caption={overdueAll ? 'Past due, not handed in' : 'All on time'} onClick={() => setStatus('overdue')} />
    </div>
    <div className="card p-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
      <FilterInput label="Search"><SearchInput value={search} onChange={setSearch} placeholder="Task or person" /></FilterInput>
      <FilterInput label="Status"><select value={status} onChange={e => setStatus(e.target.value)} className="input">
        <option value="open">All open</option><option value="overdue">Overdue</option>
        {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS[s].label}</option>)}
        <option value="all">Everything</option><option value="removed">Removed</option>
      </select></FilterInput>
      <FilterInput label="Employee"><select value={employee} onChange={e => setEmployee(e.target.value)} className="input"><option value="all">All employees</option>{activeEmployees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></FilterInput>
      <FilterInput label="Designation"><select value={designation} onChange={e => setDesignation(e.target.value)} className="input"><option value="all">All</option>{(designations as Designation[]).map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</select></FilterInput>
      <FilterInput label="Priority"><select value={priority} onChange={e => setPriority(e.target.value)} className="input"><option value="all">All</option>{['low', 'medium', 'high', 'urgent'].map(x => <option key={x} value={x} className="capitalize">{x}</option>)}</select></FilterInput>
    </div>
    <p className="text-[13px] font-semibold text-ink-600">{filtered.length} task{filtered.length === 1 ? '' : 's'}</p>
    {assignOpen && <Modal title="Assign work" onClose={() => setAssignOpen(false)} closeDisabled={assignBusy} wide><TaskAssignForm targets={activeEmployees} onSubmit={assignTask} onClose={() => setAssignOpen(false)} busy={assignBusy} isAdmin={true} deliverables={linkable.open} /></Modal>}
    <TaskTable tasks={filtered} allTasks={tasks} onOpen={(t) => setOpenId(t.id)} showAssignee deliverableName={deliverableName}
      onDelete={status === 'removed' ? undefined : setArchiveTarget} archivingId={archiveBusy ? archiveTarget?.id : null} empty="No tasks match these filters." />
    {openTask && <TaskDetail task={openTask} tasks={tasks} employees={employees} viewer={{ employeeId: '', isAdmin: true }} subtaskTargets={activeEmployees}
      deliverableName={deliverableName} onClose={() => setOpenId(null)} onChanged={onRefresh} />}
    {archiveTarget && <Modal title="Remove this task?" onClose={() => setArchiveTarget(null)} closeDisabled={archiveBusy}>
      <div className="space-y-4">
        <p className="text-sm text-ink-600">“{archiveTarget.title}” will be removed from active lists. Its history stays available under the Removed filter.</p>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={archiveBusy} onClick={() => setArchiveTarget(null)} className="btn-secondary disabled:opacity-50">Cancel</button>
          <button type="button" disabled={archiveBusy} onClick={() => void removeTask()} className="btn-danger disabled:opacity-50">{archiveBusy ? <><RefreshCw className="w-4 h-4 animate-spin" />Removing…</> : <><Trash2 className="w-4 h-4" />Remove task</>}</button>
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

      <label>
        <span className="label">Estimated effort <span className="font-normal text-ink-400">optional · hours</span></span>
        <input type="number" name="estimateHours" min={0.25} max={999} step={0.25} className="input" placeholder="e.g. 4" disabled={hasNoTargets} />
        <span className="block text-xs text-ink-400 mt-1.5">Compared with the time the assignee tracks.</span>
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

function TaskTable({ tasks, allTasks, onOpen, onDelete, archivingId, showAssignee, deliverableName, empty = 'No tasks.' }: { tasks: Task[]; allTasks: Task[]; onOpen: (task: Task) => void; onDelete?: (task: Task) => void; archivingId?: string | null; showAssignee?: boolean; deliverableName?: (id?: string | null) => string | null; empty?: string }) {
  const subCount = (id: string) => { const subs = allTasks.filter((s) => s.parentTaskId === id && !s.archivedAt); return subs.length ? `${subs.filter((s) => s.status === 'completed').length}/${subs.length}` : null; };
  if (!tasks.length) return <div className="card"><EmptyState icon={<BriefcaseBusiness className="w-6 h-6" />} title={empty} /></div>;
  return <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="data-table min-w-[760px]">
    <thead><tr><Th>Task</Th>{showAssignee && <Th>Assigned to</Th>}<Th>Due</Th><Th>Priority</Th><Th>Status</Th><Th>Time</Th>{onDelete && <Th> </Th>}</tr></thead>
    <tbody>{tasks.map(t => {
      const meta = TASK_STATUS[t.status] ?? TASK_STATUS.assigned;
      const late = !t.archivedAt && isTaskWithAssignee(t) && t.dueDate < today();
      const subs = subCount(t.id);
      return (
        <tr key={t.id} className="cursor-pointer hover:bg-ink-50/60" onClick={() => onOpen(t)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t) }}>
          <td>
            <span className="block max-w-[340px] truncate font-bold text-ink-900">{t.parentTaskId && <CornerDownRight className="inline w-3.5 h-3.5 mr-1 text-ink-400 -mt-0.5" />}{t.title}</span>
            <span className="mt-1 flex flex-wrap gap-1.5">
              {t.deliverableId && <span className="inline-flex max-w-[260px] truncate items-center rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{deliverableName?.(t.deliverableId) ?? 'Client deliverable'}</span>}
              {subs && <span className="inline-flex items-center gap-1 rounded-full bg-ink-50 px-2 py-0.5 text-[11px] font-semibold text-ink-600"><ListChecks className="w-3 h-3" />{subs}</span>}
              {t.submittedLink && <span className="inline-flex items-center gap-1 rounded-full bg-mint-50 px-2 py-0.5 text-[11px] font-semibold text-mint-700"><Link2 className="w-3 h-3" />Work linked</span>}
            </span>
          </td>
          {showAssignee && <td><div className="flex items-center gap-2"><Avatar name={t.assignedToName} size={28} /><div className="min-w-0"><p className="font-semibold text-ink-800 truncate">{t.assignedToName}</p><p className="text-[11px] text-ink-400 truncate">{t.assignedToDesignation}</p></div></div></td>}
          <td className={`tnum whitespace-nowrap ${late ? 'text-rose-700 font-semibold' : ''}`}>{dateLabel(t.dueDate)}{late && <span className="block text-[11px] font-semibold">Overdue</span>}</td>
          <td><PriorityBadge value={t.priority} /></td>
          <td className="min-w-[150px]">
            {t.archivedAt ? <Badge tone="ink">Removed</Badge> : <Badge tone={meta.tone} dot>{meta.label}</Badge>}
            {!t.archivedAt && !isTaskClosed(t) && <div className="mt-1.5 h-1.5 w-28 rounded-full bg-ink-100 overflow-hidden"><div className={`h-full rounded-full ${t.status === 'blocked' ? 'bg-rose-500' : 'bg-brand-500'}`} style={{ width: `${t.progressPct ?? 0}%` }} /></div>}
          </td>
          <td className="tnum text-ink-600">{fmtMinutes(t.timeSpentMinutes)}</td>
          {onDelete && <td onClick={(e) => e.stopPropagation()}>{!t.archivedAt && <button type="button" title="Remove task" aria-label={`Remove task: ${t.title}`} disabled={archivingId === t.id} onClick={() => onDelete(t)} className="icon-btn text-ink-400 hover:!text-rose-600 disabled:opacity-50">{archivingId === t.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}</button>}</td>}
        </tr>
      );
    })}</tbody>
  </table></div></div>;
}

function EmployeesAdmin({ employees, departments, designations, onRefresh }: any) {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all'); const [modal, setModal] = useState<'create' | 'edit' | null>(null); const [editing, setEditing] = useState<Employee | null>(null); const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  // Deep link from search: /admin-employees?employee=<id> opens that profile once.
  const deepEmployee = useRef<string | null>(typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('employee') : null);
  useEffect(() => {
    if (!deepEmployee.current) return;
    const target = (employees as Employee[]).find((x) => x.id === deepEmployee.current);
    if (!target) return;
    deepEmployee.current = null;
    setEditing(target);
    setModal('edit');
  }, [employees]);
  const filtered = (employees as Employee[]).filter(e => (status === 'all' || e.status === status) && (!search.trim() || `${e.name} ${e.empId} ${e.loginId} ${e.workEmail}`.toLowerCase().includes(search.toLowerCase())));
  const all = employees as Employee[];
  const activeCount = all.filter((e) => e.status === 'active').length;
  const remoteCount = all.filter((e) => e.status === 'active' && e.workMode === 'remote').length;
  const deptCount = new Set(all.filter((e) => e.status === 'active').map((e) => e.department).filter(Boolean)).size;
  const toggleStatus = async (e: Employee) => {
    if (statusBusyId) return;
    if (!(await confirmDialog(e.status === 'active' ? { title: `Deactivate ${e.name}?`, message: 'Their sign-in will be disabled. All attendance, leave and payroll history is kept.', confirmLabel: 'Deactivate', danger: true } : { title: `Activate ${e.name}?`, message: 'They will be able to sign in again.', confirmLabel: 'Activate' }))) return;
    setStatusBusyId(e.id);
    try {
      await invokeEmployeeAdmin({ action: 'set_status', employeeId: e.id, status: e.status === 'active' ? 'inactive' : 'active' });
      notify(e.status === 'active' ? 'Employee access disabled; history preserved.' : 'Employee account activated.', 'success');
      await onRefresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to update employee status.', 'error');
    } finally {
      setStatusBusyId(null);
    }
  };
  return (
    <PageShell
      title="Employees"
      subtitle="Accounts, roles, reporting lines and onboarding documents."
      actions={<button onClick={() => { setEditing(null); setModal('create') }} className="btn-primary"><UserPlus className="w-4 h-4" />Add employee</button>}
    >
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Stat index={0} icon={<Users className="w-5 h-5" />} tone="brand" label="Active" value={activeCount} caption={`${all.length} accounts in total`} />
        <Stat index={1} label="Inactive" value={all.length - activeCount} caption="Sign-in disabled, history kept" />
        <Stat index={2} label="Remote" value={remoteCount} caption="Check in as WFH automatically" />
        <Stat index={3} label="Departments" value={deptCount} caption="With active people" />
      </div>
      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <PillTabs value={status} onChange={setStatus} items={[{ id: 'all', label: 'Everyone', count: all.length }, { id: 'active', label: 'Active', count: activeCount }, { id: 'inactive', label: 'Inactive', count: all.length - activeCount }]} />
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, ID or login" className="w-full md:w-72" />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="data-table">
        <thead><tr><Th>Employee</Th><Th>Login ID</Th><Th>Role</Th><Th>Work mode</Th><Th>Salary</Th><Th>Status</Th><Th> </Th></tr></thead>
        <tbody>{filtered.map(e => (
          <tr key={e.id}>
            <td>
              <div className="flex items-center gap-3">
                <Avatar name={e.name} src={e.avatar || null} size={36} />
                <div className="min-w-0"><p className="font-bold text-ink-900 truncate">{e.name}</p><p className="text-[11px] text-ink-400 truncate">{e.empId}{e.manager ? ` · reports to ${e.manager}` : ''}</p></div>
              </div>
            </td>
            <Td mono>{e.loginId}</Td>
            <td><p className="text-ink-800 font-semibold">{e.designation || '—'}</p><p className="text-[11px] text-ink-400">{e.department || '—'}</p></td>
            <Td>{e.workMode === 'remote' ? 'Remote' : 'Office'}</Td>
            <Td mono>{money(e.currentSalary)}</Td>
            <Td><StatusBadge label={e.status} /></Td>
            <td>
              <div className="flex items-center justify-end gap-1">
                <button title="Edit" aria-label={`Edit ${e.name}`} onClick={() => { setEditing(e); setModal('edit') }} className="icon-btn"><Pencil className="w-4 h-4" /></button>
                <button disabled={statusBusyId === e.id} title={e.status === 'active' ? 'Deactivate' : 'Activate'} aria-label={e.status === 'active' ? `Deactivate ${e.name}` : `Activate ${e.name}`} onClick={() => void toggleStatus(e)} className={`icon-btn ${e.status === 'active' ? 'hover:!text-rose-600 hover:!bg-rose-50' : 'hover:!text-mint-700 hover:!bg-mint-50'}`}>
                  {statusBusyId === e.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : e.status === 'active' ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                </button>
              </div>
            </td>
          </tr>
        ))}{!filtered.length && <EmptyRow colSpan={7} text={all.length ? 'Nobody matches this search.' : 'No employees yet. Add the first employee to create their login.'} />}</tbody>
      </table></div></div>
      {modal && <EmployeeModal mode={modal} employee={editing} departments={departments} designations={designations} employees={employees} onClose={() => setModal(null)} onSaved={onRefresh} />}
    </PageShell>
  );
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

function AttendanceAdmin({ attendance, employees, leaveRequests, holidays }: any) {
  const [date, setDate] = useState(today());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'working' | 'break' | 'done' | 'out' | 'leave'>('all');
  const cl = classifyDay(date, holidays);
  const base = (employees as Employee[]).filter((e) => e.status === 'active').map((e) => {
    const record = (attendance as AttendanceRecord[]).find((a) => a.employeeId === e.id && a.date === date);
    const leave = (leaveRequests as LeaveRequest[]).find((l) => l.employeeId === e.id && l.status === 'approved' && l.startDate <= date && l.endDate >= date);
    const state: 'working' | 'break' | 'done' | 'out' | 'leave' = leave && !record ? 'leave' : !record ? 'out' : record.attendanceState === 'on_break' ? 'break' : record.attendanceState === 'completed' ? 'done' : 'working';
    return { e, record, leave, state };
  });
  const count = (k: string) => base.filter((r) => r.state === k).length;
  const rows = base.filter((r) => (filter === 'all' || r.state === filter) && (!search || `${r.e.name} ${r.e.empId} ${r.e.designation}`.toLowerCase().includes(search.toLowerCase())));
  const isToday = date === today();
  const strip = [
    { k: 'working', label: isToday ? 'Working now' : 'Still open', tone: 'bg-mint-500' },
    { k: 'break', label: 'On break', tone: 'bg-amber-400' },
    { k: 'done', label: 'Checked out', tone: 'bg-brand-600' },
    { k: 'out', label: cl.isWorkingDay ? 'Not in' : cl.label, tone: 'bg-ink-300' },
    { k: 'leave', label: 'On leave', tone: 'bg-sky-400' },
  ] as const;
  const statusOf = (r: any) => r.leave && !r.record ? 'leave' : r.record?.status ?? (r.e.joinDate && date < r.e.joinDate ? 'Not joined' : date > today() ? 'Upcoming' : !cl.isWorkingDay ? cl.label : date === today() ? 'Not checked in' : 'absent');
  return (
    <PageShell
      title="Attendance"
      subtitle="Who is in, on a break or out — for any day."
      actions={<input type="date" value={date} onChange={(e) => setDate(e.target.value || today())} className="input !w-auto !rounded-full !min-h-[42px]" aria-label="Date" />}
    >
      <section className="card rise p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-ink-950">{dateLabel(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <Badge tone={cl.isWorkingDay ? 'mint' : 'sky'}>{cl.label}</Badge>
        </div>
        <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-ink-100" aria-hidden>
          {strip.map((x) => { const n = count(x.k); return n ? <span key={x.k} className={`${x.tone} h-full transition-[width] duration-700`} style={{ width: `${(n / Math.max(base.length, 1)) * 100}%` }} /> : null; })}
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
          {strip.map((x) => (
            <button key={x.k} type="button" onClick={() => setFilter(filter === x.k ? 'all' : x.k)} className={`rounded-2xl px-3.5 py-3 text-left transition-colors ${filter === x.k ? 'bg-ink-950 text-white' : 'inset-tile hover:bg-ink-100'}`}>
              <span className="flex items-center gap-2 text-[12px] font-semibold opacity-80"><span className={`w-2 h-2 rounded-full ${x.tone}`} />{x.label}</span>
              <span className="stat-value block text-2xl mt-1.5">{count(x.k)}</span>
            </button>
          ))}
        </div>
      </section>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <p className="text-[13px] font-semibold text-ink-600">{filter === 'all' ? `${rows.length} people` : `${rows.length} ${strip.find((x) => x.k === filter)?.label.toLowerCase()}`}{filter !== 'all' && <button type="button" className="ml-2 text-brand-700" onClick={() => setFilter('all')}>Show everyone</button>}</p>
        <SearchInput value={search} onChange={setSearch} placeholder="Search people" className="w-full sm:w-64" />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="data-table">
        <thead><tr><Th>Employee</Th><Th>Mode</Th><Th>Check-in</Th><Th>Break</Th><Th>Check-out</Th><Th>Working</Th><Th>Status</Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.e.id}>
              <td><div className="flex items-center gap-3"><Avatar name={r.e.name} src={r.e.avatar || null} size={34} /><div className="min-w-0"><p className="font-bold text-ink-900 truncate">{r.e.name}</p><p className="text-[11px] text-ink-400 truncate">{r.e.designation || r.e.empId}</p></div></div></td>
              <Td>{r.leave && !r.record ? 'Leave' : r.record?.mode === 'wfh' ? 'WFH' : r.record ? 'Office' : r.e.workMode === 'remote' ? 'WFH' : '—'}</Td>
              <Td mono>{r.record?.checkIn ?? '—'}</Td>
              <Td mono>{r.record ? duration(r.record.breakSeconds) : '—'}</Td>
              <Td mono>{r.record?.checkOut ?? (r.record ? (r.state === 'break' ? 'On break' : 'Open') : '—')}</Td>
              <Td mono>{r.record ? r.record.workingHours || duration(r.record.workingSeconds) : '—'}</Td>
              <Td><StatusBadge label={statusOf(r)} /></Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow colSpan={7} text={base.length ? 'Nobody in this group.' : 'No active employees.'} />}
        </tbody>
      </table></div></div>
    </PageShell>
  );
}

function RequestsAdmin({ leaveRequests, wfhRequests, corrections = [], ledgers = [], employees = [], user, onRefresh }: any) {
  const [tab, setTab] = useState<'leave' | 'wfh' | 'corrections'>(() => {
    const t = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null;
    return t === 'wfh' || t === 'corrections' ? t : 'leave';
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  async function review(table: string, id: string, status: 'approved' | 'rejected') {
    const key = table + ':' + id;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const selectFields = table === 'leave_requests' ? 'id, employee_id, start_date, end_date' : 'id, employee_id, date';
      // regularization_requests: approval is applied by the database (apply_regularization_approval).
      const { data, error } = await (supabase as any)
        .from(table)
        .update({ status, reviewed_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'pending')
        .select(selectFields)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This request was already reviewed. Refresh the list.');
      notify(status === 'approved' ? 'Request approved.' : 'Request rejected.', status === 'approved' ? 'success' : 'info', 4200, table === 'leave_requests' ? 'leave' : table === 'wfh_requests' ? 'wfh' : 'correction');

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
  const nameOf = (employeeId?: string | null) => (employeeId ? (employees as Employee[]).find((e) => e.id === employeeId)?.name : undefined);
  async function openLeaveDocument(leaveId: string) {
    try {
      const docs = await leaveApi.documents(leaveId);
      if (!docs.length) { notify('No supporting document attached.', 'info'); return; }
      await openFile(docs[0], false);
    } catch (e) { notify(e instanceof Error ? e.message : 'Unable to open the document.', 'error'); }
  }
  const corrPending = (corrections as CorrectionRequest[]).filter((r) => r.status === 'pending');
  const rows: any[] = tab === 'leave' ? leaveRequests : tab === 'wfh' ? wfhRequests : corrections;
  const pending = tab === 'leave' ? leavePending : tab === 'wfh' ? wfhPending : corrPending;
  const reviewed = rows.filter((r: any) => r.status !== 'pending');
  const table = tab === 'leave' ? 'leave_requests' : tab === 'wfh' ? 'wfh_requests' : 'regularization_requests';

  return (
    <PageShell
      title="Requests"
      subtitle="Approve or reject time off and work-from-home. Employees are notified straight away."
      actions={<PillTabs value={tab} onChange={(v) => { setTab(v); window.history.replaceState(null, '', `/admin-requests?tab=${v}`); }} items={[{ id: 'leave', label: 'Leave', count: leavePending.length }, { id: 'wfh', label: 'Work from home', count: wfhPending.length }, { id: 'corrections', label: 'Corrections', count: corrPending.length }]} />}
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
                    {tab === 'corrections' ? (
                      <>
                        <p className="font-display text-lg font-bold text-ink-950">{dateLabel(r.date, { weekday: 'short' })}</p>
                        <p className="text-[13px] text-ink-600 mt-0.5 tnum">
                          {r.originalCheckIn || r.originalCheckOut ? <>Recorded {r.originalCheckIn || '—'} → {r.originalCheckOut || '—'}</> : 'No attendance recorded'}
                        </p>
                        <p className="text-[13px] text-ink-900 mt-0.5 tnum">Asks for <b>{r.requestedCheckIn} → {r.requestedCheckOut}</b></p>
                      </>
                    ) : tab === 'leave' ? (
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
                        {r.managerStatus === 'pending' && <p className="text-xs mt-1.5 text-amber-700 font-semibold">Waiting for {nameOf(r.managerId) ?? 'their manager'} · you can still decide</p>}
                        {r.managerStatus === 'approved' && <p className="text-xs mt-1.5 text-mint-700 font-semibold">Approved by {nameOf(r.managerId) ?? 'their manager'}{r.managerNote ? ` — “${r.managerNote}”` : ''}</p>}
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
                    {tab === 'leave' && <button type="button" onClick={() => void openLeaveDocument(r.id)} className="icon-btn icon-btn-surface" title="View supporting document" aria-label="View supporting document"><FileText className="w-4 h-4" /></button>}
                    <button type="button" disabled={!!busyKey} onClick={() => void review(table, r.id, 'rejected')} className="btn-secondary flex-1">Reject</button>
                    <button type="button" disabled={!!busyKey} onClick={() => void review(table, r.id, 'approved')} className="btn-primary flex-1">{busy ? 'Saving…' : 'Approve'}</button>
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="card"><EmptyState icon={<CheckCircle2 className="w-6 h-6" />} title="You’re all caught up" text={`No ${tab === 'leave' ? 'leave' : tab === 'wfh' ? 'work-from-home' : 'attendance correction'} requests are waiting.`} className="!py-10" /></div>
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
                  <Td>{tab === 'leave' ? <><span className="capitalize">{r.leaveType}</span> · {r.days}d{r.status === 'approved' ? ` · ${r.paidDays ?? 0} paid / ${r.unpaidDays ?? 0} unpaid` : ''}</> : tab === 'wfh' ? (String(r.duration).startsWith('half') ? 'Half day' : 'Full day') : `${r.requestedCheckIn} → ${r.requestedCheckOut}`}</Td>
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

  const totalPay = records.reduce((sum, r) => sum + r.finalPay, 0);
  const totalDeduction = records.reduce((sum, r) => sum + r.leaveDeduction, 0);
  const unpaidDays = records.reduce((sum, r) => sum + Number(r.unpaidLeaveDays || 0), 0);
  const step = !period ? 1 : period.status === 'draft' ? 2 : 3;
  const monthName = new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const steps = [
    { n: 1, title: 'Generate draft', text: 'Snapshot salaries and leave for the month' },
    { n: 2, title: 'Review', text: 'Check every amount and deduction' },
    { n: 3, title: 'Finalize & lock', text: 'Employees see it as their payslip' },
  ];
  return (
    <PageShell
      title="Payroll"
      subtitle="Generate a draft, review it, then finalize. Finalized months are locked."
      actions={<input type="month" value={month} onChange={e => { setMonth(e.target.value); setMessage('') }} className="input !w-auto !rounded-full !min-h-[42px]" aria-label="Payroll month" />}
    >
      <section className="card rise p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center gap-5 lg:gap-8">
          <div className="min-w-0">
            <p className="eyebrow">{monthName}</p>
            <p className="font-display text-2xl font-bold text-ink-950 mt-1">{!period ? 'Not started' : period.status === 'draft' ? 'Draft ready for review' : 'Finalized and locked'}</p>
            <p className="text-[13px] text-ink-500 mt-1">Leave accrual {settings.monthly}/month · daily rate uses {settings.divisor === 'calendar_days' ? 'calendar days' : 'working days'}{period ? ` (${period.dayDivisor})` : ''}</p>
          </div>
          <ol className="flex-1 grid sm:grid-cols-3 gap-2">
            {steps.map((x) => (
              <li key={x.n} className={`rounded-2xl px-4 py-3 ${step === x.n ? 'bg-ink-950 text-white' : step > x.n ? 'bg-mint-50 text-mint-800' : 'inset-tile text-ink-500'}`}>
                <span className="text-[11px] font-bold opacity-70">STEP {x.n}{step > x.n ? ' · DONE' : ''}</span>
                <span className="block text-sm font-bold mt-0.5">{x.title}</span>
                <span className="block text-[11px] opacity-75 mt-0.5">{x.text}</span>
              </li>
            ))}
          </ol>
          <div className="flex gap-2 shrink-0">
            {period?.status !== 'finalized' && <button disabled={busy} onClick={() => void generate()} className={period ? 'btn-secondary' : 'btn-primary'}>{busy && !period ? 'Generating…' : period ? 'Regenerate draft' : 'Generate draft'}</button>}
            {period && period.status === 'draft' && <button disabled={busy || !records.length} onClick={() => void finalize()} className="btn-primary">{busy ? 'Working…' : 'Finalize'}</button>}
          </div>
        </div>
        {message && <p className="text-[13px] mt-4 text-ink-600">{message}</p>}
      </section>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Stat index={1} icon={<WalletCards className="w-5 h-5" />} tone="brand" label="Total payout" value={records.length ? money(totalPay) : '—'} caption={`${records.length} employee${records.length === 1 ? '' : 's'}`} />
        <Stat index={2} label="Leave deductions" value={records.length ? money(totalDeduction) : '—'} caption={`${unpaidDays} unpaid day${unpaidDays === 1 ? '' : 's'} in total`} />
        <Stat index={3} label="Paid leave used" value={records.reduce((sum, r) => sum + Number(r.paidLeaveDays || 0), 0)} caption="Days across the team" />
        <Stat index={4} label="Status" value={period ? (period.status === 'draft' ? 'Draft' : 'Locked') : '—'} caption={period?.finalizedAt ? `Finalized ${new Date(period.finalizedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}` : 'Not finalized'} />
      </div>

      <section className="card overflow-hidden">
        <div className="p-5 sm:p-6"><h2 className="font-display text-lg font-bold text-ink-950">Payroll records</h2><p className="text-[13px] text-ink-500 mt-1">Salary is the snapshot taken when the draft was generated.</p></div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><Th>Employee</Th><Th>Salary</Th><Th>Paid leave</Th><Th>Unpaid leave</Th><Th>Deduction</Th><Th>Final pay</Th></tr></thead>
            <tbody>
              {records.map((r: PayrollRecord) => <tr key={r.id}><Td strong>{r.employeeName}</Td><Td mono>{money(r.salarySnapshot)}</Td><Td>{r.paidLeaveDays}</Td><Td>{r.unpaidLeaveDays}</Td><Td mono>{r.leaveDeduction ? `− ${money(r.leaveDeduction)}` : money(0)}</Td><Td strong>{money(r.finalPay)}</Td></tr>)}
              {!records.length && <EmptyRow colSpan={6} text={period ? 'No records for this period. Regenerate the draft.' : 'Generate the draft for this month to see records.'} />}
            </tbody>
          </table>
        </div>
      </section>
    </PageShell>
  );
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
  const pwChecks = [
    { ok: newPassword.length >= 12, text: '12+ characters' },
    { ok: /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword), text: 'Upper & lower case' },
    { ok: /\d/.test(newPassword), text: 'A number' },
    { ok: /[^A-Za-z0-9]/.test(newPassword), text: 'A symbol' },
  ];
  const dirty = name.trim() !== user.name || (phone.trim() || '') !== (user.phone ?? '');
  return (
    <PageShell title="Profile" subtitle="Your details, password, phone alerts and HR documents.">
      <div className="space-y-4">
        {error && <UiNotice tone="rose">{error}</UiNotice>}
        {message && !error && <UiNotice tone="mint">{message}</UiNotice>}

        <section className="card overflow-hidden rise" style={{ ['--i' as any]: 0 }}>
          <div className="h-20 sm:h-24 bg-gradient-to-r from-brand-600 via-brand-500 to-brand-400 relative">
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '14px 14px' }} />
          </div>
          <div className="px-5 sm:px-6 pb-5">
            <div className="relative w-fit -mt-10">
              {user.avatar ? <img src={user.avatar} alt="" className="w-20 h-20 rounded-full object-cover ring-4 ring-white" /> : <div className="w-20 h-20 rounded-full ring-4 ring-white"><Avatar name={user.name} size={80} /></div>}
              <label className="absolute -right-1 -bottom-1 w-8 h-8 rounded-full bg-white border border-ink-200 flex items-center justify-center cursor-pointer shadow-sm hover:bg-ink-50" title="Change photo">
                <Upload className="w-4 h-4 text-ink-700" />
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void savePhoto(f); e.target.value = '' }} />
              </label>
            </div>
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl font-bold text-ink-900 truncate">{user.name}</p>
              <p className="text-[13px] text-ink-500">{[user.designation, user.department].filter(Boolean).join(' · ') || '—'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {user.empId && <Badge tone="brand">{user.empId}</Badge>}
              <Badge tone={user.workMode === 'remote' ? 'sky' : 'mint'} dot>{user.workMode === 'remote' ? 'Remote' : 'Office'}</Badge>
            </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2 items-start">
          <section className="card p-5 sm:p-6 rise" style={{ ['--i' as any]: 1 }}>
            <div className="flex items-center gap-3"><IconChip icon={<UserRound className="w-5 h-5" />} size="sm" /><div><h3 className="font-display font-bold text-[15px] text-ink-900">Personal details</h3><p className="text-[12px] text-ink-500">You can update your name and phone.</p></div></div>
            <div className="grid gap-4 mt-5">
              <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} className="input" autoComplete="name" /></Field>
              <Field label="Phone"><input value={phone} onChange={e => setPhone(e.target.value)} className="input" inputMode="tel" autoComplete="tel" /></Field>
              <div className="flex justify-end"><button disabled={saving || !dirty} onClick={() => void save()} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">{saving ? 'Saving…' : 'Save changes'}</button></div>
            </div>
            <div className="mt-6 pt-5 border-t border-ink-100">
              <p className="eyebrow mb-3">Work details · set by HR</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                {[['Login ID', user.loginId ?? '—'], ['Employee ID', user.empId ?? '—'], ['Designation', user.designation ?? '—'], ['Department', user.department ?? '—'], ['Manager', user.manager ?? '—'], ['Monthly salary', money(user.currentSalary)]].map(([k, v]) => (
                  <div key={k} className="min-w-0"><dt className="text-ink-400 text-[11px] font-semibold uppercase tracking-wide">{k}</dt><dd className="text-ink-900 font-semibold truncate tnum mt-0.5">{v}</dd></div>
                ))}
              </dl>
            </div>
          </section>

          <div className="space-y-4">
            <section className="card p-5 sm:p-6 rise" style={{ ['--i' as any]: 2 }}>
              <div className="flex items-center gap-3"><IconChip icon={<LockKeyhole className="w-5 h-5" />} size="sm" tone="ink" /><div><h3 className="font-display font-bold text-[15px] text-ink-900">Password</h3><p className="text-[12px] text-ink-500">Confirm your current password to change it.</p></div></div>
              <div className="space-y-4 mt-5">
                <Field label="Current password"><input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="input" autoComplete="current-password" /></Field>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="New password"><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="input" minLength={12} autoComplete="new-password" /></Field>
                  <Field label="Confirm"><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} className="input" minLength={12} autoComplete="new-password" /></Field>
                </div>
                {newPassword && (
                  <ul className="flex flex-wrap gap-1.5">{pwChecks.map(c => <li key={c.text} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${c.ok ? 'bg-mint-50 text-mint-700' : 'bg-ink-50 text-ink-500'}`}>{c.ok ? <Check className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />}{c.text}</li>)}{confirm && <li className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${confirm === newPassword ? 'bg-mint-50 text-mint-700' : 'bg-rose-50 text-rose-700'}`}>{confirm === newPassword ? 'Matches' : 'Doesn’t match'}</li>}</ul>
                )}
                <div className="flex justify-end"><button disabled={saving || !currentPassword || !newPassword} onClick={() => void password()} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">Change password</button></div>
              </div>
            </section>

            <section className="card p-5 sm:p-6 rise" style={{ ['--i' as any]: 3 }}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3"><IconChip icon={<Smartphone className="w-5 h-5" />} size="sm" tone="mint" /><div><h3 className="font-display font-bold text-[15px] text-ink-900">Phone alerts</h3><p className="text-[12px] text-ink-500">Lock-screen alerts for assignments and approvals.</p></div></div>
                <Badge tone={isSubscribed ? 'mint' : pushState === 'denied' ? 'rose' : 'ink'} dot>{isSubscribed ? 'On for this device' : pushState === 'denied' ? 'Blocked in browser' : 'Off'}</Badge>
              </div>
              <div className="mt-4 flex justify-end"><button type="button" disabled={pushBusy} onClick={() => void handleTogglePush()} className={isSubscribed ? 'btn-secondary' : 'btn-primary'}>{pushBusy ? 'Updating…' : isSubscribed ? 'Turn off on this device' : 'Turn on for this device'}</button></div>
              {pushFeedback && <div className="mt-3"><UiNotice tone={pushFeedback.type === 'success' ? 'mint' : 'rose'}>{pushFeedback.message}</UiNotice></div>}
              {isIosNeedsHomeScreen() && <div className="mt-3"><UiNotice tone="amber" title="iPhone needs one extra step">In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>, then open the app from your home screen to allow alerts.</UiNotice></div>}
            </section>
          </div>
        </div>

        <section className="card overflow-hidden rise" style={{ ['--i' as any]: 4 }}>
          <div className="px-5 sm:px-6 py-4 border-b border-ink-100 flex items-center gap-3"><IconChip icon={<FileText className="w-5 h-5" />} size="sm" tone="sky" /><div><h3 className="font-display font-bold text-[15px] text-ink-900">HR documents</h3><p className="text-[12px] text-ink-500">Shared with you by HR. Links open securely and expire.</p></div></div>
          {documentsLoading ? <div className="p-5 space-y-3">{[0, 1].map(i => <div key={i} className="skeleton h-12 rounded-2xl" />)}</div> : documents.length ? (
            <ul className="divide-y divide-ink-100">{documents.map(doc => (
              <li key={doc.id} className="px-5 sm:px-6 py-3.5 flex items-center gap-4">
                <span className="w-9 h-9 rounded-xl bg-ink-50 text-ink-500 flex items-center justify-center shrink-0"><FileText className="w-4 h-4" /></span>
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink-900 truncate">{doc.fileName}</p><p className="text-[11px] text-ink-500 mt-0.5">{doc.documentType} · {dateLabel(String(doc.createdAt).slice(0, 10))}</p></div>
                <button className="btn-secondary btn-sm shrink-0" onClick={() => void viewDocument(doc)}><Eye className="w-3.5 h-3.5" />View</button>
              </li>
            ))}</ul>
          ) : <EmptyState icon={<FileText className="w-6 h-6" />} title="No documents yet" text="Offer letters, payslips and other HR files appear here once uploaded." className="!py-10" />}
        </section>
      </div>
    </PageShell>
  );
}

type ExportSpec = { id: string; group: string; title: string; text: string; icon: React.ReactNode; tone: 'brand' | 'mint' | 'amber' | 'sky' | 'rose' | 'ink'; build: () => Promise<any[]> };

function ExportsAdmin({ employees, payrollPeriods }: any) {
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<Record<string, { rows: number; at: string }>>({});
  const download = async (spec: ExportSpec) => {
    if (busy) return;
    setBusy(spec.id);
    try {
      const rows = await spec.build();
      const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No records' }]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Data');
      XLSX.writeFile(wb, `${spec.id}-${today()}.xlsx`);
      setLast(prev => ({ ...prev, [spec.id]: { rows: rows.length, at: formatKolkataTime(new Date()) } }));
      notify(`${rows.length} ${spec.title.toLowerCase()} record(s) exported.`, 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Unable to export data.', 'error');
    } finally {
      setBusy(null);
    }
  };
  async function fetchAll(table: string, orderBy: string, select = '*') { const rows: any[] = []; let from = 0; const size = 1000; for (; ;) { let q = (supabase as any).from(table).select(select).range(from, from + size - 1); if (orderBy) q = q.order(orderBy, { ascending: false }); const { data, error } = await q; if (error) throw error; const page = data ?? []; rows.push(...page); if (page.length < size) break; from += size } return rows }
  const employeeMap = new Map((employees as Employee[]).map(e => [e.id, e]));
  const payrollPeriodMap = new Map((payrollPeriods as PayrollPeriod[]).map(p => [p.id, p]));
  const empName = (id: string | null | undefined) => (id ? employeeMap.get(id)?.name ?? '' : '');
  const empCode = (id: string | null | undefined) => (id ? employeeMap.get(id)?.empId ?? '' : '');

  const specs: ExportSpec[] = [
    { id: 'employees', group: 'People', title: 'Employees', text: 'Directory with designation, department, work mode, salary and status.', icon: <Users className="w-5 h-5" />, tone: 'brand', build: async () => (employees as Employee[]).map(e => ({ EmployeeID: e.empId, LoginID: e.loginId, Name: e.name, Designation: e.designation, Department: e.department, WorkMode: e.workMode, Salary: e.currentSalary, Status: e.status })) },
    { id: 'attendance', group: 'People', title: 'Attendance', text: 'Every day’s check-in, check-out, breaks and hours. Uses approved corrections.', icon: <Clock3 className="w-5 h-5" />, tone: 'mint', build: async () => { const [raw, breaks] = await Promise.all([fetchAll('attendance_effective', 'date'), fetchAll('break_events', 'break_start')]); const breaksBy = new Map<string, any[]>(); for (const b of breaks) { const list = breaksBy.get(b.attendance_id) ?? []; list.push(b); breaksBy.set(b.attendance_id, list) } return raw.map(r => { const m = mapAttendance(r, employeeMap, breaksBy); return { Date: m.date, Employee: m.employeeName, EmployeeID: m.employeeEmpId, Mode: m.mode, CheckIn: m.checkIn ?? '', CheckOut: m.checkOut ?? '', Break: m.breakDuration ?? '', Working: m.workingHours ?? '', Status: m.status } }) } },
    { id: 'leave', group: 'People', title: 'Leave requests', text: 'All leave with paid and unpaid days, status and reviewer note.', icon: <CalendarDays className="w-5 h-5" />, tone: 'amber', build: async () => (await fetchAll('leave_requests', 'start_date', 'employee_id, leave_type, start_date, end_date, duration, days, paid_days, unpaid_days, reason, status, review_note, created_at')).map(r => ({ Employee: empName(r.employee_id), EmployeeID: empCode(r.employee_id), Type: r.leave_type, From: r.start_date, To: r.end_date, Duration: r.duration, Days: r.days, PaidDays: r.paid_days, UnpaidDays: r.unpaid_days, Reason: r.reason ?? '', Status: r.status, ReviewNote: r.review_note ?? '', RequestedOn: String(r.created_at ?? '').slice(0, 10) })) },
    { id: 'wfh', group: 'People', title: 'Work from home', text: 'WFH requests by date, duration and status.', icon: <Home className="w-5 h-5" />, tone: 'sky', build: async () => (await fetchAll('wfh_requests', 'date', 'employee_id, date, duration, reason, status, review_note, created_at')).map(r => ({ Employee: empName(r.employee_id), EmployeeID: empCode(r.employee_id), Date: r.date, Duration: r.duration, Reason: r.reason ?? '', Status: r.status, ReviewNote: r.review_note ?? '', RequestedOn: String(r.created_at ?? '').slice(0, 10) })) },
    { id: 'payroll', group: 'Money', title: 'Payroll', text: 'Monthly payroll records with leave deductions and final pay.', icon: <WalletCards className="w-5 h-5" />, tone: 'brand', build: async () => { const rows = await fetchAll('payroll_records', 'created_at'); return rows.map(r => { const p = mapPayrollRecord(r, employeeMap); const period = payrollPeriodMap.get(p.periodId); return { Period: period?.monthStart?.slice(0, 7) ?? '', Status: p.finalizedAt ? 'finalized' : (period?.status ?? 'draft'), Employee: p.employeeName, Salary: p.salarySnapshot, PaidLeave: p.paidLeaveDays, UnpaidLeave: p.unpaidLeaveDays, Deduction: p.leaveDeduction, FinalPay: p.finalPay } }) } },
    { id: 'billing', group: 'Money', title: 'Billing milestones', text: 'Every payment milestone with invoice number, due date, amount and balance.', icon: <BadgeIndianRupee className="w-5 h-5" />, tone: 'mint', build: async () => (await fetchAll('payment_installments', 'due_date', 'installment_number, name, amount, tax_amount, amount_paid, status, due_date, invoice_number, deleted_at, projects:project_id (name), clients:client_id (company_name)')).filter(r => !r.deleted_at).map(r => { const total = Number(r.amount ?? 0) + Number(r.tax_amount ?? 0); const paid = Number(r.amount_paid ?? 0); return { Client: r.clients?.company_name ?? '', Project: r.projects?.name ?? '', Number: r.installment_number ?? '', Milestone: r.name, Invoice: r.invoice_number ?? '', Due: r.due_date ?? '', Amount: Number(r.amount ?? 0), Tax: Number(r.tax_amount ?? 0), Total: total, Paid: paid, Balance: Math.max(0, total - paid), Status: r.status } }) },
    { id: 'payments', group: 'Money', title: 'Payments', text: 'Client payment submissions and verified receipts with references.', icon: <CheckCircle2 className="w-5 h-5" />, tone: 'amber', build: async () => (await fetchAll('payments', 'submitted_at', 'amount, reference, method, paid_on, submitted_at, status, rejection_reason, projects:project_id (name), clients:client_id (company_name), payment_installments:installment_id (name)')).map(r => ({ Client: r.clients?.company_name ?? '', Project: r.projects?.name ?? '', Milestone: r.payment_installments?.name ?? '', Amount: Number(r.amount ?? 0), Reference: r.reference ?? '', Method: r.method ?? '', PaidOn: r.paid_on ?? '', SubmittedAt: String(r.submitted_at ?? '').slice(0, 16).replace('T', ' '), Status: r.status, RejectionReason: r.rejection_reason ?? '' })) },
    { id: 'tasks', group: 'Work', title: 'Tasks', text: 'Assigned work with dates, priority, status and handed-in links.', icon: <BriefcaseBusiness className="w-5 h-5" />, tone: 'sky', build: async () => { const rows = await fetchAll('tasks', 'start_date'); return rows.map(r => { const t = mapTask(r, employeeMap); return { Task: t.title, Subtask: t.parentTaskId ? 'Yes' : '', Employee: t.assignedToName, AssignedBy: t.assignedByName ?? '', Start: t.startDate, Due: t.dueDate, Priority: t.priority, Status: TASK_STATUS[t.status]?.label ?? t.status, ProgressPct: t.progressPct ?? 0, HoursSpent: Math.round(((t.timeSpentMinutes ?? 0) / 60) * 100) / 100, CompletedOn: t.completedAt ? t.completedAt.slice(0, 10) : '', Note: t.statusNote ?? '', SubmittedLink: t.submittedLink ?? '' } }) } },
    { id: 'clients', group: 'Work', title: 'Clients & projects', text: 'Client directory with each project, its status and dates.', icon: <Building2 className="w-5 h-5" />, tone: 'ink', build: async () => { const [clients, projects] = await Promise.all([fetchAll('clients', 'company_name', 'id, company_name, primary_contact, email, phone, industry, gstin, status, deleted_at'), fetchAll('projects', 'created_at', 'client_id, name, status, start_date, target_date, deleted_at')]); const out: any[] = []; for (const c of clients.filter(c => !c.deleted_at)) { const ps = projects.filter(p => p.client_id === c.id && !p.deleted_at); const base = { Client: c.company_name, Contact: c.primary_contact ?? '', Email: c.email ?? '', Phone: c.phone ?? '', Industry: c.industry ?? '', GSTIN: c.gstin ?? '', ClientStatus: c.status }; if (!ps.length) out.push({ ...base, Project: '', ProjectStatus: '', Start: '', Target: '' }); for (const p of ps) out.push({ ...base, Project: p.name, ProjectStatus: p.status, Start: p.start_date ?? '', Target: p.target_date ?? '' }) } return out } },
  ];
  const groups = ['People', 'Money', 'Work'];

  return (
    <PageShell title="Reports" subtitle="Download complete datasets as Excel files. Exports are read-only — nothing in the system changes.">
      <div className="space-y-6">
        {groups.map(g => (
          <section key={g} className="space-y-3">
            <p className="eyebrow">{g}</p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {specs.filter(s => s.group === g).map((s, i) => {
                const running = busy === s.id;
                const done = last[s.id];
                return (
                  <div key={s.id} className="card p-5 flex flex-col rise" style={{ ['--i' as any]: i }}>
                    <div className="flex items-start gap-3">
                      <IconChip icon={s.icon} tone={s.tone} />
                      <div className="min-w-0">
                        <p className="font-display font-bold text-[15px] text-ink-900">{s.title}</p>
                        <p className="text-[13px] text-ink-500 mt-0.5 leading-snug">{s.text}</p>
                      </div>
                    </div>
                    <div className="mt-auto pt-5 flex items-center justify-between gap-3">
                      <span className="text-[12px] text-ink-400 tnum">{done ? `${done.rows} rows · ${done.at}` : 'Excel (.xlsx)'}</span>
                      <button type="button" disabled={Boolean(busy)} onClick={() => void download(s)} className="btn-secondary btn-sm disabled:opacity-50 disabled:cursor-not-allowed">
                        {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        {running ? 'Preparing…' : 'Export'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </PageShell>
  );
}

function SettingsAdmin({ designations, departments, rules, onRefresh }: any) {
  const [tab, setTab] = useState<'rules' | 'designations' | 'departments' | 'payroll' | 'leave' | 'roles'>('rules');
  const [name, setName] = useState(''); const [canAssign, setCanAssign] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [payrollDivisor, setPayrollDivisor] = useState<'calendar_days' | 'working_days'>('calendar_days');
  const [savedDivisor, setSavedDivisor] = useState<'calendar_days' | 'working_days' | null>(null);
  const [payrollPolicyStatus, setPayrollPolicyStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [payrollPolicyLoadKey, setPayrollPolicyLoadKey] = useState(0);
  const [assigner, setAssigner] = useState(''); const [assignee, setAssignee] = useState(''); const [scope, setScope] = useState<'any' | 'direct_reports'>('direct_reports');
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => { let cancelled = false; (async () => { setPayrollPolicyStatus('loading'); try { const { data, error } = await (supabase as any).from('payroll_settings').select('divisor_mode').eq('id', true).maybeSingle(); if (error || !data || (data.divisor_mode !== 'calendar_days' && data.divisor_mode !== 'working_days')) throw error ?? new Error('Payroll policy is unavailable.'); if (cancelled) return; setPayrollDivisor(data.divisor_mode); setSavedDivisor(data.divisor_mode); setPayrollPolicyStatus('ready') } catch { if (!cancelled) setPayrollPolicyStatus('error') } })(); return () => { cancelled = true } }, [payrollPolicyLoadKey]);
  const run = async (key: string, fn: () => Promise<void>) => { if (saving) return; setSaving(key); try { await fn() } finally { setSaving(null) } };
  async function addDesignation() { const value = name.trim(); if (!value) { notify('Enter a designation name.', 'error'); return; } if ((designations as Designation[]).some(d => d.name.toLowerCase() === value.toLowerCase())) { notify('That designation already exists.', 'error'); return; } await run('designation', async () => { try { const { error } = await (supabase as any).from('designations').insert({ name: value, can_assign_tasks: canAssign }); if (error) throw error; notify('Designation added.', 'success'); setName(''); setCanAssign(false); await onRefresh() } catch (error) { notify(error instanceof Error ? error.message : 'Unable to add designation.', 'error') } }) }
  async function addDepartment() { const value = deptName.trim(); if (!value) { notify('Enter a department name.', 'error'); return; } if ((departments as Department[]).some(d => d.name.toLowerCase() === value.toLowerCase())) { notify('That department already exists.', 'error'); return; } await run('department', async () => { try { const { error } = await (supabase as any).from('departments').insert({ name: value }); if (error) throw error; notify('Department added.', 'success'); setDeptName(''); await onRefresh() } catch (error) { notify(error instanceof Error ? error.message : 'Unable to add department.', 'error') } }) }
  async function addRule() { if (!assigner) { notify('Select who can assign.', 'error'); return; } await run('rule', async () => { try { const { error } = await (supabase as any).from('task_assignment_rules').insert({ assigner_designation_id: assigner, assignee_designation_id: assignee || null, scope }); if (error) throw error; notify('Assignment rule added.', 'success'); setAssigner(''); setAssignee(''); await onRefresh() } catch (error) { notify(error instanceof Error ? error.message : 'Unable to add rule.', 'error') } }) }
  async function deleteRule(id: string) { if (!(await confirmDialog({ title: 'Delete this assignment rule?', message: 'People with this designation will no longer be able to assign work to the other designation.', confirmLabel: 'Delete rule', danger: true }))) return; try { const { error } = await (supabase as any).from('task_assignment_rules').delete().eq('id', id); if (error) throw error; notify('Assignment rule removed.', 'success'); await onRefresh() } catch (error) { notify(error instanceof Error ? error.message : 'Unable to remove rule.', 'error') } }
  async function savePayroll() { if (payrollPolicyStatus !== 'ready') { notify('Load the current payroll policy before saving.', 'error'); return } await run('payroll', async () => { try { const { data, error } = await (supabase as any).from('payroll_settings').update({ divisor_mode: payrollDivisor }).eq('id', true).select('id').maybeSingle(); if (error) throw error; if (!data) throw new Error('Payroll policy could not be found. Refresh and try again.'); setSavedDivisor(payrollDivisor); notify('Payroll policy saved.', 'success') } catch (error) { notify(error instanceof Error ? error.message : 'Unable to save payroll policy.', 'error') } }) }

  return (
    <PageShell title="Settings" subtitle="How work is organised: who can assign tasks to whom, job titles, departments and the payroll policy.">
      <PillTabs value={tab} onChange={setTab} items={[{ id: 'rules', label: 'Assignment rules', count: rules.length }, { id: 'designations', label: 'Designations', count: designations.length }, { id: 'departments', label: 'Departments', count: departments.length }, { id: 'leave', label: 'Leave policy' }, { id: 'payroll', label: 'Payroll policy' }, { id: 'roles', label: 'Roles & access' }]} />

      {tab === 'leave' && <section className="anim-fade" key="leave"><LeavePolicySettings /></section>}

      {tab === 'roles' && <section className="anim-fade" key="roles"><RolesMatrix /></section>}

      {tab === 'rules' && (
        <section className="grid gap-4 lg:grid-cols-[360px_1fr] items-start anim-fade" key="rules">
          <div className="card p-5 sm:p-6">
            <p className="font-display font-bold text-[15px] text-ink-900">New rule</p>
            <p className="text-[13px] text-ink-500 mt-0.5">Decide which job titles can hand work to which.</p>
            <div className="space-y-4 mt-5">
              <Field label="Who can assign"><select value={assigner} onChange={e => setAssigner(e.target.value)} className="input"><option value="">Select a designation</option>{designations.map((d: Designation) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
              <Field label="To whom"><select value={assignee} onChange={e => setAssignee(e.target.value)} className="input"><option value="">Any designation</option>{designations.map((d: Designation) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
              <Field label="Reach">
                <div className="grid grid-cols-2 gap-2">
                  {([['direct_reports', 'Direct reports', 'Only people who report to them'], ['any', 'Anyone', 'Across the whole company']] as const).map(([id, l, h]) => (
                    <button key={id} type="button" onClick={() => setScope(id)} className={`text-left rounded-2xl border px-3.5 py-3 transition-colors ${scope === id ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100' : 'border-ink-200 bg-white hover:border-ink-300'}`}>
                      <span className="block text-[13px] font-bold text-ink-900">{l}</span>
                      <span className="block text-[11px] text-ink-500 mt-0.5 leading-snug">{h}</span>
                    </button>
                  ))}
                </div>
              </Field>
              <button onClick={() => void addRule()} disabled={saving === 'rule'} className="btn-primary w-full disabled:opacity-60"><Plus className="w-4 h-4" />{saving === 'rule' ? 'Adding…' : 'Add rule'}</button>
            </div>
          </div>
          <div className="card overflow-hidden">
            <div className="px-5 sm:px-6 py-4 border-b border-ink-100"><p className="font-display font-bold text-[15px] text-ink-900">Current rules</p></div>
            {rules.length ? (
              <ul className="divide-y divide-ink-100">
                {rules.map((r: AssignmentRule) => (
                  <li key={r.id} className="px-5 sm:px-6 py-3.5 flex items-center gap-3">
                    <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2 text-[13px]">
                      <Badge tone="brand">{r.assignerDesignation}</Badge>
                      <ArrowRight className="w-3.5 h-3.5 text-ink-300" />
                      <Badge tone={r.assigneeDesignation && r.assigneeDesignation !== 'Any' ? 'mint' : 'ink'}>{r.assigneeDesignation || 'Any designation'}</Badge>
                      <span className="text-ink-400 text-[12px]">{r.scope === 'any' ? 'anyone' : 'direct reports only'}</span>
                    </div>
                    <button onClick={() => void deleteRule(r.id)} className="icon-btn text-rose-500 hover:bg-rose-50" title="Delete rule" aria-label="Delete rule"><Trash2 className="w-4 h-4" /></button>
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={<ShieldCheck className="w-6 h-6" />} title="No assignment rules" text="Without rules, only administrators can assign work." />}
          </div>
        </section>
      )}

      {tab === 'designations' && (
        <section className="grid gap-4 lg:grid-cols-[360px_1fr] items-start anim-fade" key="designations">
          <div className="card p-5 sm:p-6">
            <p className="font-display font-bold text-[15px] text-ink-900">New designation</p>
            <div className="space-y-4 mt-5">
              <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addDesignation() }} className="input" placeholder="e.g. Senior Designer" /></Field>
              <label className="flex items-start gap-3 rounded-2xl border border-ink-200 px-3.5 py-3 cursor-pointer hover:border-ink-300">
                <input type="checkbox" checked={canAssign} onChange={e => setCanAssign(e.target.checked)} className="mt-0.5 accent-[var(--brand)]" />
                <span><span className="block text-[13px] font-bold text-ink-900">Can assign tasks</span><span className="block text-[11px] text-ink-500">Also needs an assignment rule to say to whom.</span></span>
              </label>
              <button onClick={() => void addDesignation()} disabled={saving === 'designation'} className="btn-primary w-full disabled:opacity-60"><Plus className="w-4 h-4" />{saving === 'designation' ? 'Adding…' : 'Add designation'}</button>
            </div>
          </div>
          <div className="card overflow-hidden">
            {designations.length ? (
              <ul className="divide-y divide-ink-100">
                {designations.map((d: Designation) => (
                  <li key={d.id} className="px-5 sm:px-6 py-3.5 flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-ink-900">{d.name}</span>
                    <Badge tone={d.canAssignTasks ? 'brand' : 'ink'} dot>{d.canAssignTasks ? 'Assigns tasks' : 'Receives tasks'}</Badge>
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={<BriefcaseBusiness className="w-6 h-6" />} title="No designations yet" text="Add the job titles used in your company." />}
          </div>
        </section>
      )}

      {tab === 'departments' && (
        <section className="grid gap-4 lg:grid-cols-[360px_1fr] items-start anim-fade" key="departments">
          <div className="card p-5 sm:p-6">
            <p className="font-display font-bold text-[15px] text-ink-900">New department</p>
            <div className="space-y-4 mt-5">
              <Field label="Name"><input value={deptName} onChange={e => setDeptName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addDepartment() }} className="input" placeholder="e.g. Design" /></Field>
              <button onClick={() => void addDepartment()} disabled={saving === 'department'} className="btn-primary w-full disabled:opacity-60"><Plus className="w-4 h-4" />{saving === 'department' ? 'Adding…' : 'Add department'}</button>
            </div>
          </div>
          <div className="card p-5 sm:p-6">
            {departments.length ? (
              <div className="flex flex-wrap gap-2">{departments.map((d: Department) => <span key={d.id} className="inline-flex items-center gap-2 rounded-full bg-ink-50 border border-ink-100 px-3.5 py-2 text-[13px] font-semibold text-ink-800"><Building2 className="w-3.5 h-3.5 text-ink-400" />{d.name}</span>)}</div>
            ) : <EmptyState icon={<Building2 className="w-6 h-6" />} title="No departments yet" text="Departments group employees in reports and the directory." />}
          </div>
        </section>
      )}

      {tab === 'payroll' && (
        <section className="card p-5 sm:p-6 max-w-2xl anim-fade" key="payroll">
          <p className="font-display font-bold text-[15px] text-ink-900">Daily rate for leave deductions</p>
          <p className="text-[13px] text-ink-500 mt-0.5">Unpaid leave is deducted at monthly salary ÷ this number of days. Changes apply to payroll you generate from now on; finalized months stay locked.</p>
          {payrollPolicyStatus === 'loading' && <div className="mt-5 grid sm:grid-cols-2 gap-3"><div className="skeleton h-24 rounded-2xl" /><div className="skeleton h-24 rounded-2xl" /></div>}
          {payrollPolicyStatus === 'error' && <div className="mt-5"><UiNotice tone="rose" title="Couldn’t load the current policy" action={<button type="button" onClick={() => setPayrollPolicyLoadKey(v => v + 1)} className="btn-secondary btn-sm">Retry</button>}>Saving is disabled until it loads.</UiNotice></div>}
          {payrollPolicyStatus === 'ready' && (
            <>
              <div className="mt-5 grid sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Payroll divisor">
                {([['calendar_days', 'Calendar days', 'All days in the month (28–31).'], ['working_days', 'Working days', 'Excludes Sundays and company holidays.']] as const).map(([id, l, h]) => (
                  <button key={id} type="button" role="radio" aria-checked={payrollDivisor === id} onClick={() => setPayrollDivisor(id)} className={`text-left rounded-2xl border px-4 py-4 transition-colors ${payrollDivisor === id ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100' : 'border-ink-200 bg-white hover:border-ink-300'}`}>
                    <span className="flex items-center justify-between"><span className="text-sm font-bold text-ink-900">{l}</span>{savedDivisor === id && <Badge tone="mint">Current</Badge>}</span>
                    <span className="block text-[12px] text-ink-500 mt-1">{h}</span>
                  </button>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] text-ink-400">Paid leave accrues 1.5 days a month and carries forward.</p>
                <button onClick={() => void savePayroll()} disabled={payrollDivisor === savedDivisor || saving === 'payroll'} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">{saving === 'payroll' ? 'Saving…' : 'Save policy'}</button>
              </div>
            </>
          )}
        </section>
      )}
    </PageShell>
  );
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

    onSelectTab(item.action_url.replace(/^\//, ''));
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
          {onSelectTab && (
            <button
              type="button"
              onClick={() => { setOpen(false); onSelectTab(user?.role === 'admin' ? 'admin-notifications' : 'emp-notifications'); }}
              className="w-full border-t border-ink-100 px-4 py-3 text-[13px] font-bold text-brand-600 hover:bg-brand-50/60 transition-colors"
            >
              See all notifications
            </button>
          )}
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
