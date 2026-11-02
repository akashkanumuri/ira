import type { AttendanceRecord, Employee, Holiday, LeaveLedger, LeaveRequest, PayrollPeriod, PayrollRecord, Task, WfhRequest } from '../types/attendance';
import type { WorkState } from './work';
import type { LateStatus } from './late';
import type { BuddyMood } from '../components/assistant/Buddy';

/* ───────────────────────── per-person, per-laptop memory ───────────────────────── */

export type BuddyLevel = 'chatty' | 'normal' | 'quiet';
export interface BuddyMemory {
  setupDone?: string;                    // ISO time the laptop setup was finished
  locationOk?: boolean;
  keepActiveDone?: boolean;
  toursDone?: Record<string, boolean>;   // page id → seen
  dismissedTypes?: Record<string, number>; // how many times each kind of tip was closed
  neverTypes?: Record<string, boolean>;  // "don't show this again"
  snooze?: Record<string, number>;       // tip key → until (ms)
  shown?: { day: string; keys: string[] }; // tips that popped up today
  level?: BuddyLevel;
  minimized?: boolean;
  /** once-a-day reactions already played (lunch, coffee, party, bye) */
  dayFx?: { day: string; done: string[] };
  /** where the person put Sigma down (fractions of the window); missing = bottom-right corner */
  homeAt?: { fx: number; fy: number };
}

const KEY = (userId: string) => `sigma-buddy:v1:${userId}`;
export function loadMemory(userId: string): BuddyMemory {
  try { return JSON.parse(localStorage.getItem(KEY(userId)) || '{}') as BuddyMemory; } catch { return {}; }
}
export function saveMemory(userId: string, m: BuddyMemory) {
  try { localStorage.setItem(KEY(userId), JSON.stringify(m)); } catch { /* storage blocked: the robot simply forgets */ }
}

/* ───────────────────────── what each page is for (tours + "what's this page") ───────────────────────── */

export const PAGE_HELP: Record<string, { title: string; text: string }> = {
  'emp-dashboard': { title: 'Dashboard', text: 'Your day at a glance: check-in, late marks, leave left, open tasks and your latest pay.' },
  'emp-tasks': { title: 'Work & Assignments', text: 'Your tasks. Press Start to run the timer — only timed work counts. Hand in a link when done; your manager approves it.' },
  'emp-client-work': { title: 'Client Projects', text: 'Client projects you manage: review drafts and send versions to the client.' },
  'emp-attendance': { title: 'My Attendance', text: 'Check in, take breaks and check out. Tap any day in the calendar to see times, breaks and late marks.' },
  'emp-time': { title: 'My time', text: 'Where your day went: task time, meetings, breaks and away time, day by day.' },
  'emp-leave': { title: 'Leave', text: 'Apply for leave and see your balance. Only your working days are counted.' },
  'emp-wfh': { title: 'Work from home', text: 'Ask for a work-from-home day at least a day ahead. Approved days let you check in as WFH.' },
  'emp-holidays': { title: 'Holidays', text: 'Company and public holidays for the year — plan your leave around them.' },
  'emp-team-time': { title: 'Team time', text: 'How your team’s day is going: who is in, what they are working on, and their hours.' },
  'emp-approvals': { title: 'Team approvals', text: 'Leave and work-from-home requests from your team that need your decision.' },
  'emp-performance': { title: 'Performance', text: 'Your goals, reviews and punctuality score.' },
  'emp-payroll': { title: 'Payroll', text: 'Your payslips with every deduction explained: unpaid leave, absent days and late cuts.' },
  'emp-notifications': { title: 'Notifications', text: 'Everything SIGMA 1 told you, in one list.' },
  'emp-profile': { title: 'Profile', text: 'Your details, password and alert settings.' },
  'admin-dashboard': { title: 'Dashboard', text: 'The whole company today: who is in, what needs your attention, money in and out.' },
  'admin-clients': { title: 'Clients', text: 'Clients, their projects, contracts, deliverables and billing milestones.' },
  'admin-support': { title: 'Client support', text: 'Questions and requests from clients.' },
  'admin-finance': { title: 'Finance', text: 'Payments to verify, invoices and what is overdue.' },
  'admin-employees': { title: 'Employees / HR', text: 'Add people, set how they work (office, hybrid, remote, hours) and their pay.' },
  'admin-attendance': { title: 'Attendance', text: 'Who is in today, late marks, and check someone in when their location fails.' },
  'admin-worktime': { title: 'Work time', text: 'Tracked task and meeting time for everyone.' },
  'admin-tasks': { title: 'Work & Assignments', text: 'Assign work, review hand-ins and send approved work to clients.' },
  'admin-requests': { title: 'Requests', text: 'Approve or reject leave and work-from-home.' },
  'admin-performance': { title: 'Performance', text: 'Review cycles, goals and punctuality for the team.' },
  'admin-payroll': { title: 'Payroll', text: 'Generate the month, check deductions (leave, absent, late), then finalize to lock payslips.' },
  'admin-holidays': { title: 'Holidays', text: 'The holiday calendar everyone follows.' },
  'admin-export': { title: 'Reports', text: 'Download attendance, payroll, tasks and billing as spreadsheets.' },
  'admin-activity': { title: 'Activity log', text: 'Every important change, who made it and when.' },
  'admin-notifications': { title: 'Notifications', text: 'Alerts about your team’s activity.' },
  'admin-settings': { title: 'Settings', text: 'Company rules: leave, work patterns, office location, payroll and roles.' },
};

/* ───────────────────────── tips worked out from live data ───────────────────────── */

export interface Nudge {
  key: string;          // unique per situation (e.g. "due:<task>:<day>")
  type: string;         // kind of tip (for "don't show again" and learning)
  priority: 1 | 2 | 3;  // 1 urgent, 2 important, 3 good to know
  mood: BuddyMood;
  text: string;
  action?: { label: string; to?: string; kind?: 'notifications' | 'setup' };
}

export interface NudgeInput {
  role: 'admin' | 'employee';
  firstName: string;
  today: string;                 // YYYY-MM-DD (IST)
  nowTime: string;               // HH:MM:SS (IST)
  myId?: string | null;
  attendance: AttendanceRecord[];
  tasks: Task[];
  leaveRequests: LeaveRequest[];
  wfhRequests: WfhRequest[];
  holidays: Holiday[];
  ledgers: LeaveLedger[];
  payrollPeriods: PayrollPeriod[];
  payrollRecords: PayrollRecord[];
  employees: Employee[];
  rules: any | null;             // today's work-pattern rules (employee)
  work: WorkState | null;
  late: LateStatus | null;
  notifyPermission: NotificationPermission | 'unsupported';
  managesPeople: boolean;
}

const fmt12 = (t?: string | null) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
};
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const minsBetween = (a: string, b: string) => { const [ah, am] = a.split(':').map(Number); const [bh, bm] = b.split(':').map(Number); return (bh * 60 + bm) - (ah * 60 + am); };
const OPEN = new Set(['assigned', 'accepted', 'in_progress', 'revision_required', 'blocked']);
const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export function computeNudges(x: NudgeInput): Nudge[] {
  const out: Nudge[] = [];
  const add = (n: Nudge) => out.push(n);

  if (x.notifyPermission === 'default' || x.notifyPermission === 'denied') {
    add({ key: 'perm-notify', type: 'perm-notify', priority: 2, mood: 'alert',
      text: x.notifyPermission === 'denied'
        ? 'Notifications are blocked on this laptop, so you’ll miss progress checks and approvals. Let me show you how to turn them back on.'
        : 'Turn on notifications so you never miss a progress check, an approval or a message.',
      action: { label: x.notifyPermission === 'denied' ? 'Show me how' : 'Turn on', kind: x.notifyPermission === 'denied' ? 'setup' : 'notifications' } });
  }

  const upcomingHoliday = [...x.holidays].filter((h) => h.date >= x.today && h.date <= addDays(x.today, 14)).sort((a, b) => a.date.localeCompare(b.date))[0];

  if (x.role === 'employee' && x.myId) {
    const me = x.myId;
    const myAtt = x.attendance.filter((a) => a.employeeId === me);
    const todayRec = myAtt.find((a) => a.date === x.today);
    const prevOpen = myAtt.find((a) => a.date < x.today && a.attendanceState && a.attendanceState !== 'completed');
    const onLeaveToday = x.leaveRequests.some((l) => l.employeeId === me && l.status === 'approved' && l.startDate <= x.today && l.endDate >= x.today);
    const tracked = x.rules ? x.rules.attendance !== false : true;
    const workingDay = x.rules ? Boolean(x.rules.working_day) : true;
    const lateAfter: string | null = x.rules?.late_after ?? x.late?.late_after ?? null;
    const shiftEnd: string | null = x.rules?.shift2?.end ?? x.rules?.shift?.end ?? x.rules?.core?.end ?? null;
    const myTasks = x.tasks.filter((t) => t.assignedTo === me && !t.archivedAt && OPEN.has(t.status));

    if (tracked && prevOpen) {
      add({ key: `prev-open:${prevOpen.date}`, type: 'prev-open', priority: 1, mood: 'worried',
        text: `Your shift on ${dayName(prevOpen.date)} was never checked out. Close it first — then you can check in today.`, action: { label: 'Close it', to: 'emp-attendance' } });
    } else if (tracked && workingDay && !todayRec && !onLeaveToday) {
      const past = lateAfter ? x.nowTime > lateAfter : false;
      const lateInfo = x.late && x.late.enabled && x.late.count > 0 ? ` You’re on late warning ${Math.min(x.late.count, x.late.warnings)} of ${x.late.warnings}.` : '';
      if (past && x.late?.enabled) {
        const cut = x.late.next_cut >= 1 ? 'a full day’s salary' : x.late.next_cut > 0 ? 'half a day’s salary' : `warning ${x.late.next_n} of ${x.late.warnings}`;
        add({ key: `checkin-late:${x.today}`, type: 'checkin', priority: 1, mood: 'worried',
          text: `You’re past ${fmt12(lateAfter)}. Checking in now counts as late #${x.late.next_n} this month — ${cut}.`, action: { label: 'Check in now', to: 'emp-attendance' } });
      } else if (past) {
        add({ key: `checkin-late:${x.today}`, type: 'checkin', priority: 1, mood: 'worried', text: `You haven’t checked in yet and it’s past ${fmt12(lateAfter)}.`, action: { label: 'Check in now', to: 'emp-attendance' } });
      } else {
        add({ key: `checkin:${x.today}`, type: 'checkin', priority: 2, mood: 'wave',
          text: `Morning ${x.firstName}! ${lateAfter ? `Check in by ${fmt12(lateAfter)} to be on time.` : 'Don’t forget to check in.'}${lateInfo}`, action: { label: 'Check in', to: 'emp-attendance' } });
      }
    }

    const working = todayRec && todayRec.attendanceState === 'working';
    if (working && x.work && !x.work.current && myTasks.length) {
      const next = [...myTasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      add({ key: `idle:${x.today}:${x.work.last_task?.ended_at ?? 'start'}`, type: 'idle', priority: 2, mood: 'think',
        text: `You’re checked in but no task timer is running — only timed work counts. Next up: “${next.title}”${next.dueDate ? `, due ${dayName(next.dueDate)}` : ''}.`, action: { label: 'Start it', to: `emp-tasks?task=${next.id}` } });
    }
    if (x.work?.current?.kind === 'task') {
      const mins = (Date.now() - Date.parse(x.work.current.started_at)) / 60000;
      if (mins >= 40 && mins < 80) add({ key: `check-soon:${x.work.current.started_at}`, type: 'check-soon', priority: 3, mood: 'point',
        text: `“${x.work.current.title ?? 'Your task'}” has been running ${Math.round(mins)} min. A quick progress check is coming — keep this tab open and answer within 5 minutes.` });
    }

    const overdue = myTasks.filter((t) => t.dueDate && t.dueDate < x.today);
    const dueToday = myTasks.filter((t) => t.dueDate === x.today);
    if (overdue.length) add({ key: `overdue:${x.today}`, type: 'due', priority: 1, mood: 'worried',
      text: overdue.length === 1 ? `“${overdue[0].title}” is overdue (was due ${dayName(overdue[0].dueDate)}).` : `${overdue.length} tasks are overdue. The oldest is “${overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0].title}”.`,
      action: { label: 'Open', to: overdue.length === 1 ? `emp-tasks?task=${overdue[0].id}` : 'emp-tasks' } });
    if (dueToday.length) add({ key: `due:${x.today}`, type: 'due', priority: 2, mood: 'point',
      text: dueToday.length === 1 ? `“${dueToday[0].title}” is due today.` : `${dueToday.length} tasks are due today.`, action: { label: 'Open', to: dueToday.length === 1 ? `emp-tasks?task=${dueToday[0].id}` : 'emp-tasks' } });

    if (x.late?.enabled && x.late.count >= x.late.warnings && todayRec) {
      add({ key: `late-level:${x.today}:${x.late.count}`, type: 'late', priority: 2, mood: 'worried',
        text: x.late.count === x.late.warnings
          ? `That was your final late warning for the month. The next late cuts half a day${x.late.daily_rate ? ` (${money(x.late.daily_rate / 2)})` : ''}.`
          : `${x.late.count} lates this month — ${x.late.cut_days} day${x.late.cut_days === 1 ? '' : 's'} of salary cut so far. Every further late cuts a full day.`,
        action: { label: 'See my lates', to: 'emp-attendance' } });
    }

    if (working && shiftEnd && minsBetween(shiftEnd, x.nowTime.slice(0, 5)) >= 30) {
      add({ key: `still-in:${x.today}`, type: 'still-in', priority: 2, mood: 'sleepy',
        text: `Your shift ended at ${fmt12(shiftEnd)}. Still working, or time to check out?`, action: { label: 'Check out', to: 'emp-attendance' } });
    }

    const soonLeave = x.leaveRequests.filter((l) => l.employeeId === me && l.status === 'approved' && l.startDate > x.today && l.startDate <= addDays(x.today, 7)).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    if (soonLeave) {
      const dueThen = myTasks.filter((t) => t.dueDate && t.dueDate >= soonLeave.startDate && t.dueDate <= soonLeave.endDate).length;
      add({ key: `leave-soon:${soonLeave.id}`, type: 'leave-soon', priority: 3, mood: 'happy',
        text: `Your leave from ${dayName(soonLeave.startDate)} is approved.${dueThen ? ` ${dueThen} task${dueThen === 1 ? ' is' : 's are'} due while you’re away — hand ${dueThen === 1 ? 'it' : 'them'} over or finish early.` : ' Enjoy!'}`,
        action: { label: dueThen ? 'View tasks' : 'View leave', to: dueThen ? 'emp-tasks' : 'emp-leave' } });
    }
    const waiting = x.leaveRequests.find((l) => l.employeeId === me && l.status === 'pending' && l.requestedOn && l.requestedOn.slice(0, 10) <= addDays(x.today, -2));
    if (waiting) add({ key: `leave-wait:${waiting.id}`, type: 'leave-wait', priority: 3, mood: 'think',
      text: `Your leave request for ${dayName(waiting.startDate)} has been waiting since ${dayName(waiting.requestedOn.slice(0, 10))}.`, action: { label: 'View', to: 'emp-leave' } });

    if (upcomingHoliday) {
      const ledger = x.ledgers.find((l) => l.employeeId === me && l.periodStart === `${x.today.slice(0, 7)}-01`) ?? x.ledgers.find((l) => l.periodStart === `${x.today.slice(0, 7)}-01`);
      const bal = ledger ? Number(ledger.closingBalance) : null;
      const d = dow(upcomingHoliday.date);
      const bridge = d === 2 ? addDays(upcomingHoliday.date, -1) : d === 4 ? addDays(upcomingHoliday.date, 1) : null;
      const bridgeTaken = bridge && x.holidays.some((h) => h.date === bridge);
      add({ key: `holiday:${upcomingHoliday.date}`, type: 'holiday', priority: 3, mood: 'celebrate',
        text: `${upcomingHoliday.name} is on ${dayName(upcomingHoliday.date)}.${bridge && !bridgeTaken && bal != null && bal >= 1 ? ` Take ${dayName(bridge)} off for a 4-day break — you have ${bal} leave day${bal === 1 ? '' : 's'}.` : ''}`,
        action: bridge && !bridgeTaken && bal != null && bal >= 1 ? { label: 'Apply leave', to: 'emp-leave' } : { label: 'Holidays', to: 'emp-holidays' } });
    }

    const monthOf = (r: PayrollRecord) => x.payrollPeriods.find((p) => p.id === r.periodId)?.monthStart ?? '';
    const lastPay = x.payrollRecords.filter((r) => r.employeeId === me && r.finalizedAt && Date.now() - Date.parse(r.finalizedAt) < 10 * 86400000).sort((a, b) => monthOf(b).localeCompare(monthOf(a)))[0];
    if (lastPay) {
      const cuts = [lastPay.unpaidLeaveDays ? `${lastPay.unpaidLeaveDays} unpaid leave` : '', lastPay.absentDays ? `${lastPay.absentDays} absent` : '', lastPay.lateDays ? `${lastPay.lateDays} late` : ''].filter(Boolean).join(', ');
      add({ key: `payslip:${lastPay.id}`, type: 'payslip', priority: 3, mood: 'happy',
        text: `Your ${new Date(`${monthOf(lastPay)}T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' })} payslip is ready: ${money(lastPay.finalPay)}${cuts ? ` (cuts: ${cuts} day${cuts.includes(',') ? 's' : ''})` : ''}.`,
        action: { label: 'Open payslip', to: 'emp-payroll' } });
    }

    if (x.managesPeople) {
      const toReview = x.tasks.filter((t) => t.assignedBy === me && t.status === 'awaiting_review' && !t.archivedAt);
      if (toReview.length) add({ key: `review:${x.today}:${toReview.length}`, type: 'review', priority: 2, mood: 'point',
        text: `${toReview.length} hand-in${toReview.length === 1 ? ' is' : 's are'} waiting for your review.`, action: { label: 'Review', to: 'emp-tasks' } });
    }
  }

  if (x.role === 'admin') {
    const leaves = x.leaveRequests.filter((l) => l.status === 'pending');
    const wfh = x.wfhRequests.filter((w) => w.status === 'pending');
    if (leaves.length) add({ key: `adm-leave:${x.today}:${leaves.length}`, type: 'adm-requests', priority: 2, mood: 'point',
      text: `${leaves.length} leave request${leaves.length === 1 ? ' is' : 's are'} waiting — ${leaves.slice(0, 2).map((l) => l.employeeName).join(', ')}${leaves.length > 2 ? '…' : ''}.`, action: { label: 'Review', to: 'admin-requests?tab=leave' } });
    if (wfh.length) add({ key: `adm-wfh:${x.today}:${wfh.length}`, type: 'adm-requests', priority: 2, mood: 'point',
      text: `${wfh.length} work-from-home request${wfh.length === 1 ? ' is' : 's are'} waiting.`, action: { label: 'Review', to: 'admin-requests?tab=wfh' } });
    const review = x.tasks.filter((t) => t.status === 'awaiting_review' && !t.archivedAt);
    if (review.length) add({ key: `adm-review:${x.today}:${review.length}`, type: 'review', priority: 2, mood: 'point',
      text: `${review.length} task hand-in${review.length === 1 ? ' is' : 's are'} waiting for approval.`, action: { label: 'Review', to: 'admin-tasks' } });
    const active = x.employees.filter((e) => e.status === 'active');
    const todayAtt = x.attendance.filter((a) => a.date === x.today);
    const open = x.attendance.filter((a) => a.date < x.today && a.attendanceState && a.attendanceState !== 'completed');
    if (open.length) add({ key: `adm-open:${x.today}:${open.length}`, type: 'adm-open', priority: 2, mood: 'worried',
      text: `${open.length} ${open.length === 1 ? 'person' : 'people'} never checked out on an earlier day (${open.slice(0, 2).map((a) => a.employeeName).join(', ')}). They must close it before checking in.`, action: { label: 'Attendance', to: 'admin-attendance' } });
    if (active.length && x.nowTime >= '09:20' && x.nowTime <= '13:00' && dow(x.today) !== 0 && !x.holidays.some((h) => h.date === x.today)) {
      const onLeave = x.leaveRequests.filter((l) => l.status === 'approved' && l.startDate <= x.today && l.endDate >= x.today).length;
      const late = todayAtt.filter((a) => a.status === 'late').length;
      add({ key: `adm-today:${x.today}`, type: 'adm-today', priority: 3, mood: 'happy',
        text: `Today so far: ${todayAtt.length} of ${active.length} checked in${late ? `, ${late} late` : ''}${onLeave ? `, ${onLeave} on leave` : ''}.`, action: { label: 'Attendance', to: 'admin-attendance' } });
    }
    const day = Number(x.today.slice(8, 10));
    if (day <= 7) {
      const prev = new Date(`${x.today.slice(0, 7)}-01T12:00:00Z`); prev.setUTCMonth(prev.getUTCMonth() - 1);
      const prevMonth = prev.toISOString().slice(0, 10);
      const period = x.payrollPeriods.find((p) => p.monthStart === prevMonth);
      if (!period || period.status !== 'finalized') add({ key: `adm-payroll:${prevMonth}`, type: 'adm-payroll', priority: 2, mood: 'think',
        text: `${prev.toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' })} payroll ${period ? 'is still a draft — check it and finalize' : 'hasn’t been generated yet'}.`, action: { label: 'Payroll', to: 'admin-payroll' } });
    }
    if (upcomingHoliday) add({ key: `holiday:${upcomingHoliday.date}`, type: 'holiday', priority: 3, mood: 'celebrate',
      text: `${upcomingHoliday.name} is on ${dayName(upcomingHoliday.date)}.`, action: { label: 'Holidays', to: 'admin-holidays' } });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

/** Which tips may pop up on their own right now (the rest wait in the robot’s list). */
export function canAutoShow(n: Nudge, m: BuddyMemory, today: string, now = Date.now()) {
  const level = m.level ?? 'normal';
  if (level === 'quiet' || m.minimized) return false;
  if (m.neverTypes?.[n.type]) return false;
  if ((m.snooze?.[n.key] ?? 0) > now) return false;
  if (level === 'normal' && n.priority > 2) return false;
  if ((m.dismissedTypes?.[n.type] ?? 0) >= 3 && n.priority > 1) return false; // learnt: they don't want this kind
  const shown = m.shown?.day === today ? m.shown.keys : [];
  if (shown.includes(n.key)) return false;
  const cap = level === 'chatty' ? 8 : 4;
  return n.priority === 1 || shown.length < cap;
}
