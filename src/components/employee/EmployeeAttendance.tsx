import React, { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Coffee, Home, LogOut, Play, TriangleAlert } from 'lucide-react';
import type { AuthUser } from '../../contexts/AuthContext';
import type { AttendanceRecord, Holiday, LeaveRequest, WfhRequest } from '../../types/attendance';
import { performCheckIn, performCheckOut, performResumeWork, performStartBreak, fetchAttendanceRecord } from '../../lib/attendance';
import { classifyDay, formatKolkataTime, getKolkataDateString } from '../../lib/workingDays';
import { dateLabel, duration } from '../../lib/v2';
import { notify } from '../../lib/toast';
import { Badge, Button, Card, CardHeader, EmptyState, Notice, PillTabs, Skeleton, StatusBadge, cx, type Tone } from '../../ui';
import { DotCalendar, Legend, Ring, type DayMark } from '../../ui/charts';
import { Modal } from '../../ui/Modal';

const today = () => getKolkataDateString();

function hhmm(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

function shiftSeconds(start?: string | null, end?: string | null) {
  const toSec = (t?: string | null) => {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return Number.isFinite(h) ? h * 3600 + (m || 0) * 60 : null;
  };
  const a = toSec(start);
  const b = toSec(end);
  if (a == null || b == null || b <= a) return 9 * 3600;
  return b - a;
}

/** Live working / break seconds for an attendance record. */
function liveSeconds(record: AttendanceRecord | undefined, now: Date) {
  if (!record?.checkInIso) return { working: 0, onBreak: 0 };
  const breaks = Number(record.breakSeconds ?? 0);
  if (record.checkOutIso || record.attendanceState === 'completed') return { working: Number(record.workingSeconds ?? 0), onBreak: 0 };
  const elapsed = Math.max(0, Math.floor((now.getTime() - new Date(record.checkInIso).getTime()) / 1000));
  const onBreak =
    record.attendanceState === 'on_break' && record.activeBreakStartIso
      ? Math.max(0, Math.floor((now.getTime() - new Date(record.activeBreakStartIso).getTime()) / 1000))
      : 0;
  return { working: Math.max(0, elapsed - breaks - onBreak), onBreak };
}

const weekday = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });

function checkOutText(r: AttendanceRecord) {
  return r.checkOut ?? (r.attendanceState === 'completed' ? '—' : r.mode === 'wfh' ? 'Open (manual)' : 'Open');
}

type Props = {
  user: AuthUser;
  attendance: AttendanceRecord[];
  holidays: Holiday[];
  leaveRequests?: LeaveRequest[];
  wfhRequests?: WfhRequest[];
  onRefresh: () => Promise<void>;
};

/* ======================================================================
   Today — progress ring + actions
   ====================================================================== */

export function AttendanceToday({ user, attendance, holidays, leaveRequests = [], wfhRequests = [], onRefresh, compact }: Props & { compact?: boolean }) {
  const employeeId = user.employeeDbId!;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(new Date());
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const isRemote = user.workMode === 'remote';
  const approvedWfhToday = wfhRequests.find((r) => r.date === today() && r.status === 'approved');
  const [checkInMode, setCheckInMode] = useState<'office' | 'wfh'>(isRemote || approvedWfhToday ? 'wfh' : 'office');

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    setCheckInMode(isRemote || Boolean(approvedWfhToday) ? 'wfh' : 'office');
  }, [isRemote, approvedWfhToday?.id]);

  const current = attendance.find((a) => a.date === today());
  const state = current?.attendanceState ?? 'not_checked_in';
  const effectiveMode: 'office' | 'wfh' = current ? (current.mode === 'wfh' ? 'wfh' : 'office') : isRemote ? 'wfh' : checkInMode;

  const previousOpen = useMemo(
    () =>
      [...attendance]
        .filter((r) => r.date < today() && (r.attendanceState === 'working' || r.attendanceState === 'on_break'))
        .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
    [attendance]
  );

  const todayClass = classifyDay(today(), holidays);
  // The database rejects check-in on approved leave, Sundays and company holidays
  // (private.validate_attendance_insert), so the screen must not offer it.
  const todayLeave =
    leaveRequests.find((l) => l.employeeId === employeeId && l.status === 'approved' && l.startDate <= today() && l.endDate >= today()) ?? null;
  const blockedReason = todayLeave
    ? `You're on approved leave until ${dateLabel(todayLeave.endDate)}. No check-in is needed today.`
    : todayClass.type === 'holiday'
      ? `Today is a company holiday (${todayClass.label}). Attendance isn't recorded today.`
      : todayClass.type === 'sunday_off'
        ? 'Today is Sunday, your weekly off. Attendance isn’t recorded today.'
        : null;

  const run = async (fn: () => Promise<any>, ok: string) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await fn();
      if (!result?.success) {
        const m = result?.error ?? 'Action failed.';
        setMessage(m);
        notify(m, 'error');
        return;
      }
      notify(ok, 'success', 4200, 'attendance');
      await onRefresh();
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Action failed.';
      setMessage(m);
      notify(m, 'error');
    } finally {
      setBusy(false);
    }
  };

  const live = liveSeconds(current, now);
  const target = shiftSeconds(user.shift, user.shiftEnd);
  const pct = current ? Math.min(100, (live.working / target) * 100) : 0;
  const ringTone: Tone = state === 'on_break' ? 'amber' : state === 'completed' ? 'mint' : 'brand';

  const statusChip =
    state === 'working' ? <Badge tone="mint" dot>Working</Badge>
    : state === 'on_break' ? <Badge tone="amber" dot>On break</Badge>
    : state === 'completed' ? <Badge tone="ink" dot>Checked out</Badge>
    : todayLeave ? <Badge tone="sky" dot>On leave</Badge>
    : blockedReason ? <Badge tone="sky" dot>{todayClass.label}</Badge>
    : <Badge tone="brand" dot>Not checked in</Badge>;

  return (
    <Card className={cx('p-5 sm:p-7', compact ? '' : '')}>
      <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 lg:items-center">
        {/* Ring */}
        <div className="flex justify-center lg:justify-start shrink-0">
          <Ring value={pct} size={196} stroke={14} tone={ringTone}>
            <span className="eyebrow">{state === 'on_break' ? 'On break' : 'Working time'}</span>
            <span className="stat-value text-[42px] text-ink-950 mt-1">{hhmm(state === 'on_break' ? live.onBreak : live.working)}</span>
            <span className="text-xs text-ink-400 mt-1 tnum">of {hhmm(target)} shift</span>
          </Ring>
        </div>

        {/* Details + actions */}
        <div className="flex-1 min-w-0 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Today</p>
              <h2 className="font-display text-2xl font-bold text-ink-950 mt-1">{dateLabel(today(), { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
              <p className="text-[13px] text-ink-500 mt-1">
                {isRemote ? 'Permanent remote · WFH check-in' : approvedWfhToday ? 'Approved WFH today' : todayClass.isWorkingDay ? 'Working day' : todayClass.label}
                {user.shift ? ` · Shift ${user.shift.slice(0, 5)}–${(user.shiftEnd ?? '').slice(0, 5)}` : ''}
              </p>
            </div>
            {statusChip}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              ['Check-in', current?.checkIn ?? '—'],
              ['Break', duration((current?.breakSeconds ?? 0) + live.onBreak)],
              ['Working', current ? duration(live.working) : '—'],
              ['Check-out', current ? (current.checkOut ?? '—') : '—'],
            ].map(([label, value]) => (
              <div key={label} className="inset-tile px-3.5 py-3">
                <p className="text-[11px] font-semibold text-ink-500">{label}</p>
                <p className="mt-0.5 font-display text-base font-bold text-ink-950 tnum">{value}</p>
              </div>
            ))}
          </div>

          {message && <Notice tone="rose">{message}</Notice>}

          {previousOpen && !current ? (
            <div className="rounded-2xl bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <TriangleAlert className="w-5 h-5 text-amber-600 shrink-0" />
              <div className="flex-1 text-[13px] text-amber-900">
                <p className="font-bold">{previousOpen.mode === 'wfh' ? 'Your WFH shift is still open' : 'Your previous shift is still open'}</p>
                <p className="mt-0.5">{dateLabel(previousOpen.date)} was never checked out. Close it before starting today.</p>
              </div>
              <Button variant="secondary" loading={busy} onClick={() => void run(() => performCheckOut(previousOpen), 'Previous shift closed.')}>
                Close previous shift
              </Button>
            </div>
          ) : !current && blockedReason ? (
            <div className="rounded-2xl bg-sky-50 px-4 py-3.5 text-[13px] font-medium text-sky-800 flex items-center gap-2.5">
              <CalendarDays className="w-4 h-4 shrink-0" />
              {blockedReason}
            </div>
          ) : !current ? (
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              {!isRemote && (
                <PillTabs
                  items={[{ id: 'office', label: <><Building2 className="w-4 h-4" /> Office</> }, { id: 'wfh', label: <><Home className="w-4 h-4" /> Work from home</> }]}
                  value={effectiveMode}
                  onChange={(v) => setCheckInMode(v as 'office' | 'wfh')}
                />
              )}
              <Button
                className="sm:ml-auto !min-h-[48px] !px-7"
                icon={<Play className="w-4 h-4 fill-current" />}
                loading={busy}
                onClick={() => void run(() => performCheckIn({ employeeId, mode: effectiveMode }), `Checked in · ${effectiveMode === 'wfh' ? 'WFH' : 'Office'}`)}
              >
                Check in{effectiveMode === 'wfh' ? ' · WFH' : ''}
              </Button>
            </div>
          ) : state === 'working' ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" className="!min-h-[48px] flex-1 sm:flex-none" icon={<Coffee className="w-4 h-4" />} loading={busy} onClick={() => void run(() => performStartBreak(current), 'Break started.')}>
                  Start break
                </Button>
                <Button className="!min-h-[48px] flex-1 sm:flex-none !bg-ink-950 hover:!bg-ink-800" icon={<LogOut className="w-4 h-4" />} disabled={busy} onClick={() => setCheckoutOpen(true)}>
                  Check out
                </Button>
              </div>
              {effectiveMode === 'wfh' && <p className="text-xs text-ink-500">Work-from-home sessions need a manual check-out at the end of your day.</p>}
            </div>
          ) : state === 'on_break' ? (
            <div className="space-y-2">
              <Button variant="mint" className="!min-h-[48px]" icon={<Play className="w-4 h-4 fill-current" />} loading={busy} onClick={() => void run(() => performResumeWork(current), 'Work resumed.')}>
                Resume work
              </Button>
              <p className="text-xs text-amber-700">Resume work before checking out.</p>
            </div>
          ) : (
            <div className="rounded-2xl bg-mint-50 px-4 py-3.5 text-[13px] font-semibold text-mint-800 flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" /> Attendance complete for today. See you tomorrow.
            </div>
          )}
        </div>
      </div>

      {checkoutOpen && current && (
        <Modal title="Check out for today?" onClose={() => setCheckoutOpen(false)} closeDisabled={busy}>
          <div className="space-y-5">
            <p className="text-sm text-ink-600 leading-relaxed">
              This ends today's session at <b className="text-ink-900">{formatKolkataTime(now)}</b> with <b className="text-ink-900">{duration(live.working)}</b> worked.
              After check-out, more hours today need an administrator's review.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCheckoutOpen(false)}>Cancel</Button>
              <Button
                loading={busy}
                onClick={() => {
                  setCheckoutOpen(false);
                  void run(() => performCheckOut(current), 'Checked out.');
                }}
              >
                Check out
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

/* ======================================================================
   Month calendar + day details
   ====================================================================== */

export function AttendanceMonth({ user, attendance, holidays, leaveRequests = [], focusDate, onRequestCorrection }: Props & { focusDate?: { date: string; at: number } | null; onRequestCorrection?: (date: string) => void }) {
  const employeeId = user.employeeDbId!;
  const [monthOffset, setMonthOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [record, setRecord] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = new Date(`${today()}T12:00:00Z`);
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + monthOffset);
  const month = base.toISOString().slice(0, 10);

  const byDate = useMemo(() => new Map(attendance.map((a) => [a.date, a])), [attendance]);
  const leaveOn = (ds: string) => leaveRequests.find((l) => l.employeeId === employeeId && l.status === 'approved' && l.startDate <= ds && l.endDate >= ds);

  const mark = (ds: string): DayMark | null => {
    const cl = classifyDay(ds, holidays);
    const r = byDate.get(ds);
    if (user.joinDate && ds < user.joinDate) return { tone: 'ink', label: 'Before joining' };
    if (r?.status === 'late') return { tone: 'amber', label: 'Late' };
    if (r?.mode === 'wfh') return { tone: 'mint', label: 'Work from home' };
    if (r) return { tone: 'brand', label: 'Present' };
    if (cl.type === 'holiday') return { tone: 'dark', label: cl.label };
    if (cl.type === 'sunday_off') return { tone: 'ink', label: 'Weekly off' };
    if (leaveOn(ds)) return { tone: 'sky', label: 'Leave' };
    if (ds > today()) return null;
    if (ds === today()) return { tone: 'none', label: 'Today · not checked in' };
    return { tone: 'rose', label: 'No attendance recorded' };
  };

  const monthDays = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => `${month.slice(0, 8)}${String(i + 1).padStart(2, '0')}`);
  }, [month]);
  const summary = useMemo(() => {
    let present = 0, late = 0, wfh = 0, leave = 0, missed = 0;
    for (const ds of monthDays) {
      const m = mark(ds);
      if (!m) continue;
      if (m.label === 'Present') present++;
      else if (m.label === 'Late') late++;
      else if (m.label === 'Work from home') wfh++;
      else if (m.label === 'Leave') leave++;
      else if (m.tone === 'rose') missed++;
    }
    return { present, late, wfh, leave, missed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthDays, attendance, holidays, leaveRequests]);

  const open = async (ds: string) => {
    setSelected(ds);
    setLoading(true);
    setError(null);
    setRecord(null);
    try {
      setRecord(await fetchAttendanceRecord(employeeId, ds));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load attendance details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (focusDate?.date) void open(focusDate.date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDate?.at]);

  const selClass = selected ? classifyDay(selected, holidays) : null;
  const selLeave = selected ? leaveOn(selected) : null;

  return (
    <Card className="p-5 sm:p-7">
      <CardHeader
        title="Attendance history"
        subtitle={`${summary.present + summary.late + summary.wfh} days worked · ${summary.late} late · ${summary.leave} leave${summary.missed ? ` · ${summary.missed} not recorded` : ''}`}
        action={
          <div className="flex items-center gap-1">
            <button type="button" className="icon-btn" onClick={() => setMonthOffset((v) => v - 1)} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
            <span className="min-w-[120px] text-center text-[13px] font-bold text-ink-800">
              {base.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
            </span>
            <button type="button" className="icon-btn" onClick={() => setMonthOffset((v) => v + 1)} aria-label="Next month" disabled={monthOffset >= 0}><ChevronRight className="w-4 h-4" /></button>
          </div>
        }
      />
      <div className="mt-6 max-w-[520px] mx-auto">
        <DotCalendar month={month} mark={mark} selected={selected} today={today()} onSelect={(ds) => void open(ds)} />
      </div>
      <div className="mt-6 flex justify-center">
        <Legend items={[
          { tone: 'brand', label: 'Present' }, { tone: 'amber', label: 'Late' }, { tone: 'mint', label: 'WFH' },
          { tone: 'sky', label: 'Leave' }, { tone: 'dark', label: 'Holiday' }, { tone: 'rose', label: 'Not recorded' },
        ]} />
      </div>

      {selected && (
        <Modal title={dateLabel(selected, { weekday: 'long', day: 'numeric', month: 'long' })} onClose={() => setSelected(null)}>
          {loading ? (
            <div className="space-y-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-20 w-full rounded-2xl" /></div>
          ) : error ? (
            <Notice tone="rose">{error}</Notice>
          ) : !record && !selLeave && selClass?.type !== 'holiday' ? (
            <EmptyState
              icon={<CalendarDays className="w-6 h-6" />}
              title="No attendance recorded"
              text={selClass?.type === 'sunday_off' ? 'Sunday is a weekly off.' : selected > today() ? 'This day hasn’t happened yet.' : 'Nothing was recorded for this day.'}
              className="!py-6"
            />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink-600">
                  {record ? (record.mode === 'wfh' ? 'Work from home' : 'Office') : selClass?.label}
                </p>
                <StatusBadge status={record ? record.status : selLeave ? 'leave' : selClass?.type === 'holiday' ? 'holiday' : 'absent'} />
              </div>
              {record && (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    {[
                      ['Check-in', record.checkIn ?? '—'],
                      ['Check-out', checkOutText(record)],
                      ['Break', duration(record.breakSeconds ?? 0)],
                      ['Working', record.workingHours || duration(record.workingSeconds)],
                    ].map(([l, v]) => (
                      <div key={l} className="inset-tile p-3.5">
                        <p className="text-[11px] font-semibold text-ink-500">{l}</p>
                        <p className="mt-1 font-display text-lg font-bold text-ink-950 tnum">{v}</p>
                      </div>
                    ))}
                  </div>
                  {record.mode === 'wfh' && record.attendanceState !== 'completed' && (
                    <Notice tone="sky">This work-from-home session is still open and needs a manual check-out.</Notice>
                  )}
                  {record.breaks && record.breaks.length > 0 && (
                    <div>
                      <p className="text-sm font-bold text-ink-900 mb-2">Breaks ({record.breaks.length})</p>
                      <ul className="space-y-1.5 max-h-44 overflow-y-auto">
                        {record.breaks.map((b, i) => (
                          <li key={b.id || i} className="inset-tile px-3.5 py-2.5 flex items-center justify-between text-[13px]">
                            <span className="font-semibold text-ink-700">Break {i + 1}</span>
                            <span className="tnum text-ink-600">
                              {b.breakStart ? formatKolkataTime(new Date(b.breakStart)) : '—'} → {b.breakEnd ? formatKolkataTime(new Date(b.breakEnd)) : 'In progress'}
                              {b.durationSeconds != null ? ` · ${duration(b.durationSeconds)}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {record.notes && <p className="inset-tile px-3.5 py-3 text-[13px] text-ink-600"><b className="text-ink-800">Note:</b> {record.notes}</p>}
                </>
              )}
              {selLeave && <Notice tone="sky" title={`Approved ${selLeave.leaveType} leave`}>{selLeave.reason}</Notice>}
              {selClass?.type === 'holiday' && <Notice tone="dark" title="Company holiday">{selClass.label}</Notice>}
            </div>
          )}
          {onRequestCorrection && !loading && selected <= today() && selClass?.isWorkingDay && !selLeave && (
            <div className="mt-5 flex justify-end">
              <button type="button" className="btn-secondary btn-sm" onClick={() => { const d = selected; setSelected(null); onRequestCorrection(d); }}>
                Times wrong? Request a correction
              </button>
            </div>
          )}
        </Modal>
      )}
    </Card>
  );
}

/* ======================================================================
   Recent records + login sessions
   ====================================================================== */

export function AttendanceRecent({ attendance, onOpen }: { attendance: AttendanceRecord[]; onOpen?: (date: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(() => [...attendance].sort((a, b) => b.date.localeCompare(a.date)), [attendance]);
  const rows = showAll ? sorted : sorted.slice(0, 7);
  return (
    <Card className="overflow-hidden">
      <div className="p-5 sm:p-6">
        <CardHeader
          title="Recent records"
          subtitle="Check-in, check-out and hours worked"
          action={sorted.length > 7 ? <button type="button" className="btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show less' : `View all (${sorted.length})`}</button> : null}
        />
      </div>
      {rows.length ? (
        <>
          <div className="hidden sm:block overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Mode</th><th>Check-in</th><th>Check-out</th><th>Working</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => onOpen?.(r.date)} className={onOpen ? 'cursor-pointer' : ''}>
                    <td><span className="font-bold text-ink-900">{dateLabel(r.date)}</span> <span className="text-ink-400">{weekday(r.date)}</span></td>
                    <td>{r.mode === 'wfh' ? 'WFH' : 'Office'}</td>
                    <td className="tnum font-semibold text-ink-800">{r.checkIn ?? '—'}</td>
                    <td className="tnum">{checkOutText(r)}</td>
                    <td className="tnum">{r.workingHours || duration(r.workingSeconds)}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="sm:hidden divide-y divide-ink-100">
            {rows.map((r) => (
              <li key={r.id} className="px-5 py-3.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink-900">{dateLabel(r.date)} <span className="font-medium text-ink-400">{weekday(r.date)}</span></p>
                  <p className="text-xs text-ink-500 tnum">{r.mode === 'wfh' ? 'WFH' : 'Office'} · {r.checkIn ?? '—'} → {checkOutText(r)} · {r.workingHours || duration(r.workingSeconds)}</p>
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState icon={<CalendarDays className="w-6 h-6" />} title="No records yet" text="Your check-ins will appear here." />
      )}
    </Card>
  );
}

export function LoginSessions({ sessions }: { sessions: any[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="p-5 sm:p-6">
        <CardHeader title="Sign-in sessions" subtitle="When you signed in and out of the app — separate from attendance" />
      </div>
      {sessions.length ? (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Signed in</th><th>Signed out</th><th>Length</th><th>Status</th></tr></thead>
            <tbody>
              {sessions.slice(0, 50).map((s: any) => (
                <tr key={s.id}>
                  <td className="tnum">{new Date(s.loginTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="tnum">{s.logoutTime ? new Date(s.logoutTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Active'}</td>
                  <td className="tnum">{s.duration == null ? '—' : duration(Number(s.duration))}</td>
                  <td><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No sessions yet" className="!py-8" />
      )}
    </Card>
  );
}
