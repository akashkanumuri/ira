import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle, ArrowRight, BadgeIndianRupee, Building2, CalendarClock, ChevronRight, ClipboardCheck,
  Download, FileSignature, FileClock, Home, Package, RefreshCw, Users, Wallet, Upload, Hourglass,
} from 'lucide-react';
import type { AuthUser } from '../../contexts/AuthContext';
import type { AttendanceRecord, BreakEvent, Employee, Holiday, LeaveRequest, PayrollPeriod, PayrollRecord, WfhRequest } from '../../types/attendance';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { dateLabel, duration, money } from '../../lib/v2';
import { classifyDay, formatKolkataTime, getKolkataDateString } from '../../lib/workingDays';
import { inr } from '../../lib/sigma';
import { useOrgOverview } from '../../lib/orgOverview';
import { Avatar, Badge, Card, CardHeader, EmptyState, IconChip, Page, PageHeader, SearchInput, Skeleton, Stat, StatusBadge, cx, type Tone } from '../../ui';
import { BarTrend, Gauge, Legend } from '../../ui/charts';
import { Modal } from '../../ui/Modal';
import { greeting } from '../../ui/motion';

const compactInr = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `₹${Math.round(n)}`;
};

interface Props {
  user: AuthUser;
  employees: Employee[];
  attendance: AttendanceRecord[];
  leaveRequests: LeaveRequest[];
  wfhRequests: WfhRequest[];
  holidays: Holiday[];
  payrollPeriods: PayrollPeriod[];
  payrollRecords: PayrollRecord[];
  onSelectTab: (tab: string) => void;
}

type Row = { e: Employee; record?: AttendanceRecord; leave?: LeaveRequest };

function rowStatus(row: Row, isWorkingDay: boolean, dayType: string) {
  if (row.leave) return 'leave';
  if (row.record?.status) return row.record.status;
  if (isWorkingDay) return 'absent';
  return dayType === 'holiday' ? 'holiday' : 'off';
}

function rowMode(row: Row) {
  if (row.leave) return 'Leave';
  if (row.record?.mode === 'wfh' || (!row.record && row.e.workMode === 'remote')) return 'WFH';
  return 'Office';
}

function checkOutLabel(record?: AttendanceRecord) {
  if (!record) return '—';
  if (record.checkOut) return record.checkOut;
  if (record.attendanceState === 'completed') return '—';
  return record.mode === 'wfh' ? 'Open (manual)' : 'Open';
}

export function AdminHome({ user, employees, attendance, leaveRequests, wfhRequests, holidays, payrollPeriods, payrollRecords, onSelectTab }: Props) {
  const today = getKolkataDateString();
  const org = useOrgOverview(true);
  const [selectedDate, setSelectedDate] = useState(today);
  const [search, setSearch] = useState('');
  const [inspect, setInspect] = useState<Row | null>(null);
  const [inspectBreaks, setInspectBreaks] = useState<BreakEvent[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);

  const active = useMemo(() => employees.filter((e) => e.status === 'active'), [employees]);
  const byKey = useMemo(() => {
    const m = new Map<string, AttendanceRecord>();
    for (const a of attendance) m.set(`${a.employeeId}|${a.date}`, a);
    return m;
  }, [attendance]);
  const leaveOn = (employeeId: string, date: string) =>
    leaveRequests.find((l) => l.employeeId === employeeId && l.status === 'approved' && l.startDate <= date && l.endDate >= date);

  /* ---------- Today ---------- */
  const todayClass = classifyDay(today, holidays);
  const presentToday = active.filter((e) => ['present', 'late', 'wfh'].includes(String(byKey.get(`${e.id}|${today}`)?.status)));
  const officeToday = presentToday.filter((e) => byKey.get(`${e.id}|${today}`)?.mode === 'office').length;
  const wfhToday = presentToday.length - officeToday;
  const onLeaveToday = active.filter((e) => !byKey.get(`${e.id}|${today}`) && leaveOn(e.id, today)).length;
  const notCheckedIn = todayClass.isWorkingDay ? active.length - presentToday.length - onLeaveToday : 0;
  const lateToday = presentToday.filter((e) => byKey.get(`${e.id}|${today}`)?.status === 'late').length;

  const pendingLeaves = leaveRequests.filter((r) => r.status === 'pending');
  const pendingWfh = wfhRequests.filter((r) => r.status === 'pending');

  /* ---------- Attendance trend: last 8 working days ---------- */
  const trend = useMemo(() => {
    const days: string[] = [];
    const d = new Date(`${today}T12:00:00Z`);
    for (let i = 0; i < 30 && days.length < 8; i++) {
      const ds = d.toISOString().slice(0, 10);
      if (classifyDay(ds, holidays).isWorkingDay) days.unshift(ds);
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return days.map((ds) => {
      const present = active.filter((e) => ['present', 'late', 'wfh'].includes(String(byKey.get(`${e.id}|${ds}`)?.status))).length;
      return {
        key: ds,
        label: new Date(`${ds}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }).slice(0, 3),
        value: present,
        display: `${present} of ${active.length} · ${dateLabel(ds)}`,
      };
    });
  }, [today, holidays, active, byKey]);
  const avgAttendance = trend.length && active.length ? Math.round((trend.reduce((s, t) => s + t.value, 0) / (trend.length * active.length)) * 100) : 0;

  /* ---------- Payroll ---------- */
  const latestPayroll = useMemo(() => {
    const period = [...payrollPeriods]
      .filter((p) => p.status === 'finalized' && p.finalizedAt)
      .sort((a, b) => b.monthStart.localeCompare(a.monthStart))[0];
    if (!period) return null;
    const total = payrollRecords.filter((r) => r.periodId === period.id).reduce((s, r) => s + r.finalPay, 0);
    return { period, total };
  }, [payrollPeriods, payrollRecords]);

  /* ---------- Needs attention ---------- */
  const o = org.data;
  const attention: Array<{ key: string; tone: Tone; icon: React.ReactNode; title: string; caption: string; to: string }> = [];
  if (pendingLeaves.length) attention.push({ key: 'leave', tone: 'amber', icon: <CalendarClock className="w-5 h-5" />, title: `${pendingLeaves.length} leave request${pendingLeaves.length === 1 ? '' : 's'} to review`, caption: pendingLeaves.slice(0, 2).map((r) => r.employeeName).join(', '), to: 'admin-requests?tab=leave' });
  if (pendingWfh.length) attention.push({ key: 'wfh', tone: 'amber', icon: <Home className="w-5 h-5" />, title: `${pendingWfh.length} WFH request${pendingWfh.length === 1 ? '' : 's'} to review`, caption: pendingWfh.slice(0, 2).map((r) => r.employeeName).join(', '), to: 'admin-requests?tab=wfh' });
  if (o?.finance.paymentsToVerify) attention.push({ key: 'pay', tone: 'brand', icon: <BadgeIndianRupee className="w-5 h-5" />, title: `${o.finance.paymentsToVerify} client payment${o.finance.paymentsToVerify === 1 ? '' : 's'} to verify`, caption: 'Submitted by clients — not counted until verified', to: 'admin-clients' });
  if (o?.finance.overdueCount) attention.push({ key: 'overdue', tone: 'rose', icon: <AlertTriangle className="w-5 h-5" />, title: `${o.finance.overdueCount} payment milestone${o.finance.overdueCount === 1 ? '' : 's'} overdue`, caption: `${inr(o.finance.overdueAmount)} outstanding`, to: 'admin-clients' });
  if (o?.delivery.overdue) attention.push({ key: 'dover', tone: 'rose', icon: <Package className="w-5 h-5" />, title: `${o.delivery.overdue} deliverable${o.delivery.overdue === 1 ? '' : 's'} past due date`, caption: 'Open deliverables with a due date before today', to: 'admin-clients' });
  if (o?.modifications.open) attention.push({ key: 'mods', tone: 'amber', icon: <FileClock className="w-5 h-5" />, title: `${o.modifications.open} modification request${o.modifications.open === 1 ? '' : 's'} open`, caption: 'Client asked to change scope, quantity or timeline', to: 'admin-clients' });
  if (o?.dependencies.toReview) attention.push({ key: 'deps', tone: 'brand', icon: <Upload className="w-5 h-5" />, title: `${o.dependencies.toReview} client upload${o.dependencies.toReview === 1 ? '' : 's'} to review`, caption: 'Dependencies submitted by clients', to: 'admin-clients' });
  if (o?.delivery.awaitingReview) attention.push({ key: 'review', tone: 'brand', icon: <ClipboardCheck className="w-5 h-5" />, title: `${o.delivery.awaitingReview} deliverable${o.delivery.awaitingReview === 1 ? '' : 's'} in internal review`, caption: 'Ready for a reviewer before going to the client', to: 'admin-clients' });
  if (o?.contracts.awaitingClient) attention.push({ key: 'contracts', tone: 'ink', icon: <FileSignature className="w-5 h-5" />, title: `${o.contracts.awaitingClient} contract${o.contracts.awaitingClient === 1 ? '' : 's'} awaiting signature`, caption: 'Sent to the client, not yet accepted', to: 'admin-clients' });
  if (notCheckedIn > 0) attention.push({ key: 'absent', tone: 'ink', icon: <Hourglass className="w-5 h-5" />, title: `${notCheckedIn} not checked in yet`, caption: 'Working day, no attendance and no approved leave', to: 'admin-attendance' });

  /* ---------- Attendance table ---------- */
  const dateClass = classifyDay(selectedDate, holidays);
  const rows: Row[] = active
    .filter((e) => !search || `${e.name} ${e.empId} ${e.designation} ${e.department}`.toLowerCase().includes(search.toLowerCase()))
    .map((e) => ({ e, record: byKey.get(`${e.id}|${selectedDate}`), leave: leaveOn(e.id, selectedDate) }));

  const openInspect = async (row: Row) => {
    setInspect(row);
    setInspectBreaks([]);
    if (!row.record?.id) return;
    setInspectLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('break_events')
        .select('id,attendance_id,employee_id,break_start,break_end,duration_seconds')
        .eq('attendance_id', row.record.id)
        .order('break_start', { ascending: true });
      if (!error && data) {
        setInspectBreaks(data.map((b: any) => ({
          id: b.id, attendanceId: b.attendance_id, employeeId: b.employee_id, breakStart: b.break_start, breakEnd: b.break_end,
          durationSeconds: b.duration_seconds == null ? undefined : Number(b.duration_seconds),
        })));
      }
    } finally {
      setInspectLoading(false);
    }
  };

  const exportDay = () => {
    try {
      const data = rows.map((row) => ({
        'Employee ID': row.e.empId,
        'Employee Name': row.e.name,
        Department: row.e.department,
        Designation: row.e.designation,
        Date: selectedDate,
        'Work Mode': rowMode(row),
        'Check-In': row.record?.checkIn ?? '—',
        'Check-Out': checkOutLabel(row.record),
        'Break Duration': duration(row.record?.breakSeconds ?? 0),
        'Working Hours': row.record?.workingHours || duration(row.record?.workingSeconds ?? 0),
        Status: rowStatus(row, dateClass.isWorkingDay, dateClass.type),
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
      XLSX.writeFile(wb, `IRA_Attendance_${selectedDate}.xlsx`);
      notify(`Exported attendance for ${dateLabel(selectedDate)}`, 'success');
    } catch {
      notify('Failed to export attendance.', 'error');
    }
  };

  const collectedPct = o && o.finance.billed > 0 ? (o.finance.collected / o.finance.billed) * 100 : 0;
  const firstName = (user.name || '').split(' ')[0] || 'there';

  return (
    <Page>
      <PageHeader
        eyebrow={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}
        title={`${greeting()}, ${firstName}!`}
        subtitle={attention.length ? `${attention.length} thing${attention.length === 1 ? '' : 's'} need${attention.length === 1 ? 's' : ''} your attention today.` : 'Everything is on track today.'}
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => onSelectTab('admin-export')}>
              <Download className="w-4 h-4" /> Reports
            </button>
            <button type="button" className="btn-primary" onClick={() => onSelectTab('admin-clients')}>
              <Building2 className="w-4 h-4" /> Clients
            </button>
          </>
        }
      />

      {/* Headline numbers */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          index={0}
          icon={<Users className="w-5 h-5" />}
          tone="brand"
          label="Present today"
          value={presentToday.length}
          caption={todayClass.isWorkingDay
            ? <>{officeToday} office · {wfhToday} WFH · {onLeaveToday} on leave{lateToday ? <> · <span className="text-amber-700 font-semibold">{lateToday} late</span></> : null}</>
            : `${todayClass.label} — no attendance expected`}
          onClick={() => onSelectTab('admin-attendance')}
        />
        <Stat
          index={1}
          icon={<Building2 className="w-5 h-5" />}
          tone="mint"
          label="Active clients"
          value={o ? o.clients.active : org.loading ? '·' : '—'}
          caption={o ? <>{o.contracts.awaitingClient} contract{o.contracts.awaitingClient === 1 ? '' : 's'} awaiting signature · {o.clients.newThisMonth} new this month</> : org.error ?? 'Loading…'}
          onClick={() => onSelectTab('admin-clients')}
        />
        <Stat
          index={2}
          icon={<Package className="w-5 h-5" />}
          tone="dark"
          label="Open deliverables"
          value={o ? o.delivery.open : org.loading ? '·' : '—'}
          caption={o ? <><span className={cx(o.delivery.overdue && 'text-rose-700 font-semibold')}>{o.delivery.overdue} overdue</span> · {o.delivery.awaitingClient} waiting on client</> : org.error ?? 'Loading…'}
          onClick={() => onSelectTab('admin-clients')}
        />
        <Stat
          index={3}
          icon={<Wallet className="w-5 h-5" />}
          tone="amber"
          label="Outstanding"
          value={o ? o.finance.outstanding : org.loading ? '·' : '—'}
          format={compactInr}
          caption={o ? (o.finance.overdueAmount > 0
            ? <><span className="text-rose-700 font-semibold">{inr(o.finance.overdueAmount)} overdue</span>{o.finance.nextDue ? <> · next due {dateLabel(o.finance.nextDue.date)}</> : null}</>
            : o.finance.nextDue ? <>Next due {dateLabel(o.finance.nextDue.date)} · {inr(o.finance.nextDue.amount)}</> : 'Nothing due') : org.error ?? 'Loading…'}
          onClick={() => onSelectTab('admin-clients')}
        />
      </div>

      {/* Trend + attention */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card index={4} className="p-5 sm:p-7">
          <CardHeader
            title="Attendance"
            subtitle={`Present per working day · last ${trend.length} working days · ${avgAttendance}% average`}
            action={<button type="button" className="btn-secondary btn-sm" onClick={() => onSelectTab('admin-attendance')}>Full view <ArrowRight className="w-3.5 h-3.5" /></button>}
          />
          <div className="mt-8">
            <BarTrend data={trend} max={Math.max(active.length, 1)} highlight={today} onSelect={(d) => setSelectedDate(d)} height={210} />
          </div>
        </Card>

        <Card index={5} className="p-5 sm:p-6 flex flex-col">
          <CardHeader
            title="Needs attention"
            subtitle="Exceptions across people, clients and billing"
            action={org.error ? <button type="button" className="icon-btn" onClick={() => void org.reload()} aria-label="Retry"><RefreshCw className="w-4 h-4" /></button> : null}
          />
          <div className="mt-4 -mx-2 flex-1">
            {org.loading && !o ? (
              <div className="space-y-3 px-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}</div>
            ) : attention.length ? (
              <ul className="space-y-1 max-h-[340px] overflow-y-auto pr-1">
                {attention.map((a) => (
                  <li key={a.key}>
                    <button type="button" onClick={() => onSelectTab(a.to)} className="w-full flex items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-ink-50 transition-colors group">
                      <IconChip icon={a.icon} tone={a.tone} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-ink-900 truncate">{a.title}</span>
                        <span className="block text-xs text-ink-500 truncate">{a.caption}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-ink-700 group-hover:translate-x-0.5 transition-all" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<ClipboardCheck className="w-6 h-6" />} title="All clear" text="No pending requests, overdue work or payments right now." className="!py-8" />
            )}
            {org.error && <p className="px-2 pt-2 text-xs text-rose-600">Client & billing items couldn’t load: {org.error}</p>}
          </div>
        </Card>
      </div>

      {/* Team table + finance */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card index={6} className="overflow-hidden">
          <div className="p-5 sm:p-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <CardHeader
              title="Team today"
              subtitle={<>{dateLabel(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' })} · <Badge tone={dateClass.isWorkingDay ? 'mint' : 'sky'}>{dateClass.label}</Badge></>}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={selectedDate} max={today} onChange={(e) => setSelectedDate(e.target.value || today)} className="input !w-auto !min-h-[40px] !rounded-full !py-1.5 !text-[13px]" aria-label="Date" />
              <SearchInput value={search} onChange={setSearch} placeholder="Search people" className="w-full sm:w-48" />
              <button type="button" className="icon-btn icon-btn-surface" onClick={exportDay} disabled={!rows.length} title="Download Excel" aria-label="Download Excel">
                <Download className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Employee</th><th>Mode</th><th>Check-in</th><th>Check-out</th><th>Working</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.e.id} onClick={() => void openInspect(row)} className="cursor-pointer">
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={row.e.name} src={row.e.avatar || null} size={34} />
                        <div className="min-w-0">
                          <p className="font-bold text-ink-900 truncate">{row.e.name}</p>
                          <p className="text-[11px] text-ink-400 truncate">{row.e.designation || row.e.department || row.e.empId}</p>
                        </div>
                      </div>
                    </td>
                    <td>{rowMode(row)}</td>
                    <td className="tnum font-semibold text-ink-800">{row.record?.checkIn ?? '—'}</td>
                    <td className="tnum">{checkOutLabel(row.record)}</td>
                    <td className="tnum">{row.record ? row.record.workingHours || duration(row.record.workingSeconds) : '—'}</td>
                    <td><StatusBadge status={rowStatus(row, dateClass.isWorkingDay, dateClass.type)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="md:hidden divide-y divide-ink-100">
            {rows.map((row) => (
              <li key={row.e.id}>
                <button type="button" onClick={() => void openInspect(row)} className="w-full px-5 py-3.5 flex items-center gap-3 text-left">
                  <Avatar name={row.e.name} src={row.e.avatar || null} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-ink-900 truncate">{row.e.name}</span>
                    <span className="block text-xs text-ink-500 tnum">{rowMode(row)} · {row.record?.checkIn ?? 'No check-in'}{row.record?.checkOut ? ` → ${row.record.checkOut}` : ''}</span>
                  </span>
                  <StatusBadge status={rowStatus(row, dateClass.isWorkingDay, dateClass.type)} />
                </button>
              </li>
            ))}
          </ul>
          {!rows.length && <EmptyState icon={<Users className="w-6 h-6" />} title={search ? 'No matches' : 'No active employees'} text={search ? `Nobody matches “${search}”.` : undefined} />}
        </Card>

        <div className="space-y-4">
          <Card index={7} className="p-5 sm:p-6">
            <CardHeader title="Collections" subtitle="Verified payments against billed milestones" />
            {o ? (
              o.finance.billed > 0 ? (
                <>
                  <div className="mt-4 flex justify-center">
                    <Gauge value={collectedPct} tone="mint" label={<span className="stat-value text-3xl text-ink-950">{Math.round(collectedPct)}%</span>} />
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="inset-tile p-3.5">
                      <p className="text-[11px] font-semibold text-ink-500">Collected</p>
                      <p className="mt-1 font-display text-lg font-bold text-ink-950 tnum">{inr(o.finance.collected)}</p>
                    </div>
                    <div className="inset-tile p-3.5">
                      <p className="text-[11px] font-semibold text-ink-500">Billed</p>
                      <p className="mt-1 font-display text-lg font-bold text-ink-950 tnum">{inr(o.finance.billed)}</p>
                    </div>
                  </div>
                  <div className="mt-4"><Legend items={[{ tone: 'mint', label: 'Collected (verified)' }, { tone: 'ink', label: 'Still due' }]} /></div>
                </>
              ) : (
                <EmptyState icon={<Wallet className="w-6 h-6" />} title="Nothing billed yet" text="Collections appear once payment milestones are due." className="!py-8" />
              )
            ) : (
              <Skeleton className="mt-6 h-40 w-full rounded-3xl" />
            )}
          </Card>

          <Card index={8} className="p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <IconChip icon={<Wallet className="w-5 h-5" />} tone="brand" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink-500">Latest final payroll</p>
                <p className="font-display text-2xl font-bold text-ink-950 tnum">{latestPayroll ? money(latestPayroll.total) : '—'}</p>
                <p className="text-xs text-ink-400">{latestPayroll ? new Date(`${latestPayroll.period.monthStart}T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'No finalized payroll yet'}</p>
              </div>
              <button type="button" className="icon-btn icon-btn-surface" onClick={() => onSelectTab('admin-payroll')} aria-label="Open payroll">
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </Card>
        </div>
      </div>

      {inspect && (
        <Modal title={inspect.e.name} onClose={() => setInspect(null)}>
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={inspect.e.name} src={inspect.e.avatar || null} size={44} />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink-900 truncate">{inspect.e.designation || '—'}</p>
                  <p className="text-xs text-ink-500 truncate">{inspect.e.empId} · {inspect.e.department} · {dateLabel(selectedDate)}</p>
                </div>
              </div>
              <StatusBadge status={rowStatus(inspect, dateClass.isWorkingDay, dateClass.type)} />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                ['Check-in', inspect.record?.checkIn ?? '—'],
                ['Check-out', checkOutLabel(inspect.record)],
                ['Total break', duration(inspect.record?.breakSeconds ?? 0)],
                ['Working', inspect.record ? inspect.record.workingHours || duration(inspect.record.workingSeconds) : '—'],
              ].map(([label, value]) => (
                <div key={label} className="inset-tile p-3.5">
                  <p className="text-[11px] font-semibold text-ink-500">{label}</p>
                  <p className="mt-1 font-display text-lg font-bold text-ink-950 tnum">{value}</p>
                </div>
              ))}
            </div>
            {inspect.leave && (
              <div className="rounded-2xl bg-sky-50 px-4 py-3 text-[13px] text-sky-800">
                <span className="font-bold capitalize">Approved {inspect.leave.leaveType} leave</span> · {inspect.leave.reason}
              </div>
            )}
            <div>
              <p className="text-sm font-bold text-ink-900 mb-2">Breaks ({inspectBreaks.length})</p>
              {inspectLoading ? (
                <Skeleton className="h-12 w-full rounded-2xl" />
              ) : inspectBreaks.length ? (
                <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                  {inspectBreaks.map((b, i) => (
                    <li key={b.id || i} className="inset-tile px-3.5 py-2.5 flex items-center justify-between text-[13px]">
                      <span className="font-semibold text-ink-700">Break {i + 1}</span>
                      <span className="tnum text-ink-600">
                        {b.breakStart ? formatKolkataTime(new Date(b.breakStart)) : '—'} → {b.breakEnd ? formatKolkataTime(new Date(b.breakEnd)) : 'In progress'}
                        {b.durationSeconds != null ? ` · ${duration(b.durationSeconds)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-400">No breaks recorded.</p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
