import React, { useMemo, useState } from 'react';
import { BriefcaseBusiness, CalendarDays, ChevronRight, Clock3, Wallet } from 'lucide-react';
import type { AuthUser } from '../../contexts/AuthContext';
import type { AttendanceRecord, Employee, Holiday, LeaveLedger, LeaveRequest, PayrollPeriod, PayrollRecord, Task, WfhRequest } from '../../types/attendance';
import { getKolkataDateString } from '../../lib/workingDays';
import { dateLabel, money } from '../../lib/v2';
import { Badge, Card, CardHeader, EmptyState, Page, PageHeader, Stat, cx } from '../../ui';
import { greeting } from '../../ui/motion';
import { AttendanceMonth, AttendanceRecent, AttendanceToday, LoginSessions } from './EmployeeAttendance';

type Common = {
  user: AuthUser;
  attendance: AttendanceRecord[];
  holidays: Holiday[];
  leaveRequests: LeaveRequest[];
  wfhRequests: WfhRequest[];
  onRefresh: () => Promise<void>;
};

const today = () => getKolkataDateString();

export function EmployeeHome(props: Common & {
  ledgers: LeaveLedger[];
  payrollPeriods: PayrollPeriod[];
  payrollRecords: PayrollRecord[];
  tasks: Task[];
  employees: Employee[];
  onSelectTab: (tab: string) => void;
}) {
  const { user, attendance, ledgers, payrollPeriods, payrollRecords, tasks, employees, onSelectTab } = props;
  const [focus, setFocus] = useState<{ date: string; at: number } | null>(null);

  const ledger = ledgers.find((l) => l.periodStart === `${today().slice(0, 7)}-01`);
  const me = employees.find((e) => e.id === user.employeeDbId);
  const monthlySalary = me?.currentSalary ?? user.currentSalary ?? 0;

  const latestPay = useMemo(() => {
    const monthOf = (r: PayrollRecord) => payrollPeriods.find((p) => p.id === r.periodId)?.monthStart ?? '';
    const record = [...payrollRecords].filter((r) => r.finalizedAt).sort((a, b) => monthOf(b).localeCompare(monthOf(a)))[0];
    return record ? { record, month: monthOf(record) } : null;
  }, [payrollRecords, payrollPeriods]);

  const myOpen = useMemo(
    () =>
      tasks
        .filter((t) => t.assignedTo === user.employeeDbId && t.status !== 'completed')
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [tasks, user.employeeDbId]
  );
  const overdue = myOpen.filter((t) => t.dueDate && t.dueDate < today()).length;
  const dueSoon = myOpen.filter((t) => t.dueDate >= today()).slice(0, 5);

  const monthPrefix = today().slice(0, 7);
  const monthRecords = attendance.filter((a) => a.date.startsWith(monthPrefix));
  const late = monthRecords.filter((a) => a.status === 'late').length;
  const avgHours = monthRecords.length
    ? monthRecords.reduce((s, a) => s + Number(a.workingSeconds ?? 0), 0) / monthRecords.length / 3600
    : 0;

  const firstName = (user.name || '').split(' ')[0] || 'there';
  const headline = [
    myOpen.length ? `${myOpen.length} open task${myOpen.length === 1 ? '' : 's'}${overdue ? `, ${overdue} overdue` : ''}` : 'No open tasks',
    ledger ? `${ledger.closingBalance} leave day${Number(ledger.closingBalance) === 1 ? '' : 's'} available` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Page>
      <PageHeader
        eyebrow={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}
        title={`${greeting()}, ${firstName}!`}
        subtitle={headline}
      />

      <AttendanceToday {...props} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          index={1}
          icon={<CalendarDays className="w-5 h-5" />}
          tone="sky"
          label="Leave available"
          value={ledger ? Number(ledger.closingBalance) : '—'}
          format={(n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))}
          caption={ledger ? <>{ledger.openingBalance} carried forward · +{ledger.accrual} this month · {ledger.paidUsed} used</> : 'Balance updates monthly'}
          onClick={() => onSelectTab('emp-leave')}
        />
        <Stat
          index={2}
          icon={<BriefcaseBusiness className="w-5 h-5" />}
          tone="brand"
          label="Open tasks"
          value={myOpen.length}
          caption={myOpen.length ? <>{overdue ? <span className="text-rose-700 font-semibold">{overdue} overdue</span> : 'None overdue'}{dueSoon[0] ? <> · next due {dateLabel(dueSoon[0].dueDate)}</> : null}</> : 'You’re all caught up'}
          onClick={() => onSelectTab('emp-tasks')}
        />
        <Stat
          index={3}
          icon={<Clock3 className="w-5 h-5" />}
          tone="mint"
          label="Days worked this month"
          value={monthRecords.length}
          caption={monthRecords.length ? <>{avgHours.toFixed(1)}h average{late ? <> · <span className="text-amber-700 font-semibold">{late} late</span></> : ' · never late'}</> : 'No check-ins yet this month'}
          onClick={() => onSelectTab('emp-attendance')}
        />
        <Stat
          index={4}
          icon={<Wallet className="w-5 h-5" />}
          tone="dark"
          label="Latest pay"
          value={latestPay ? money(latestPay.record.finalPay) : '—'}
          caption={latestPay
            ? <>{new Date(`${latestPay.month}T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · base {money(monthlySalary)}/month</>
            : `Base ${money(monthlySalary)}/month · no finalized payslip yet`}
          onClick={() => onSelectTab('emp-payroll')}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <AttendanceMonth {...props} focusDate={focus} />
        <Card index={5} className="p-5 sm:p-6 flex flex-col">
          <CardHeader
            title="Up next"
            subtitle="Your open assignments by due date"
            action={<button type="button" className="btn-ghost btn-sm" onClick={() => onSelectTab('emp-tasks')}>All work <ChevronRight className="w-3.5 h-3.5" /></button>}
          />
          <div className="mt-4 -mx-2 flex-1">
            {myOpen.length ? (
              <ul className="space-y-1">
                {myOpen.slice(0, 6).map((t) => {
                  const late = t.dueDate && t.dueDate < today();
                  return (
                    <li key={t.id}>
                      <button type="button" onClick={() => onSelectTab('emp-tasks')} className="w-full flex items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-ink-50 transition-colors">
                        <span className={cx('w-11 h-11 shrink-0 rounded-2xl flex flex-col items-center justify-center leading-none', late ? 'bg-rose-50 text-rose-700' : 'bg-brand-50 text-brand-700')}>
                          <span className="text-[10px] font-bold uppercase">{new Date(`${t.dueDate}T12:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })}</span>
                          <span className="font-display text-base font-bold">{Number(t.dueDate.slice(8))}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-ink-900 truncate">{t.title}</span>
                          <span className="block text-xs text-ink-500 truncate">{t.assignedByName ? `From ${t.assignedByName}` : t.description || 'Assignment'}</span>
                        </span>
                        <Badge tone={t.priority === 'urgent' || t.priority === 'high' ? 'rose' : t.priority === 'medium' ? 'amber' : 'ink'}>
                          <span className="capitalize">{t.priority}</span>
                        </Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={<BriefcaseBusiness className="w-6 h-6" />} title="Nothing assigned" text="New assignments from your manager appear here." className="!py-10" />
            )}
          </div>
        </Card>
      </div>

      <AttendanceRecent attendance={attendance} onOpen={(date) => setFocus({ date, at: Date.now() })} />
    </Page>
  );
}

export function MyAttendancePage(props: Common & { loginSessions: any[] }) {
  const [focus, setFocus] = useState<{ date: string; at: number } | null>(null);
  return (
    <Page>
      <PageHeader title="My attendance" subtitle="Check in, take breaks, check out — and see every day of your month." />
      <AttendanceToday {...props} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <AttendanceMonth {...props} focusDate={focus} />
        <AttendanceRecent attendance={props.attendance} onOpen={(date) => setFocus({ date, at: Date.now() })} />
      </div>
      <LoginSessions sessions={props.loginSessions} />
    </Page>
  );
}
