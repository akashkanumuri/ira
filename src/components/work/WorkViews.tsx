import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Coffee, Download, RefreshCw, Settings2, Users } from 'lucide-react';
import { Avatar, Badge, Card, EmptyState, Notice, Page, PageHeader, PillTabs, Skeleton, cx } from '../../ui';
import { notify } from '../../lib/toast';
import { dateLabel } from '../../lib/v2';
import { getKolkataDateString } from '../../lib/workingDays';
import {
  SEGMENT_STYLE, WORK_NOT_READY, clockOf, hm, meetingLabel, monthName, monthStart, shiftMonth, ticker, workApi,
  type MonthDay, type WorkDay, type WorkMonth, type WorkSettings, type WorkState,
} from '../../lib/work';
import { useWork } from './WorkTracker';

const today = () => getKolkataDateString();
const pctText = (v?: number | null) => (v == null ? '—' : `${Math.round(Number(v))}%`);
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'rose' | 'mint' | 'amber' | 'brand' }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white px-3.5 py-3 min-w-0">
      <p className="text-[11px] font-semibold text-ink-500 truncate">{label}</p>
      <p className={cx('font-display text-[20px] sm:text-[22px] font-bold leading-tight tnum truncate',
        tone === 'rose' ? 'text-rose-600' : tone === 'mint' ? 'text-mint-700' : tone === 'amber' ? 'text-amber-700' : tone === 'brand' ? 'text-brand-700' : 'text-ink-900')}>{value}</p>
      {sub && <p className="text-[11px] text-ink-500 truncate">{sub}</p>}
    </div>
  );
}

function useLoad<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t load.'); } finally { setLoading(false); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

/* ------------------------------------------------------------------ day */

export function DayView({ employeeId, date, onDate, title }: { employeeId: string | null; date: string; onDate: (d: string) => void; title?: string }) {
  const { data: d, error, loading, reload } = useLoad<WorkDay | null>(() => workApi.day(employeeId, date), [employeeId, date]);
  const isToday = date === today();
  useEffect(() => {
    if (!isToday) return undefined;
    const id = window.setInterval(() => void reload(), 60000);
    return () => window.clearInterval(id);
  }, [isToday, reload]);
  const segs = d?.segments ?? [];
  const span = segs.length ? Date.parse(segs[segs.length - 1].end) - Date.parse(segs[0].start) : 0;

  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-[16px] font-bold text-ink-900 flex-1 min-w-[160px]">{title ?? 'Day'} · {weekday(date)}, {dateLabel(date)}</h3>
        <div className="flex items-center gap-1">
          <button type="button" className="icon-btn icon-btn-surface" aria-label="Previous day" onClick={() => onDate(addDays(date, -1))}><ChevronLeft className="w-4 h-4" /></button>
          <input type="date" value={date} max={today()} onChange={(e) => e.target.value && onDate(e.target.value)} className="input !h-9 !py-1 !w-[150px]" aria-label="Pick a day" />
          <button type="button" className="icon-btn icon-btn-surface" aria-label="Next day" disabled={date >= today()} onClick={() => onDate(addDays(date, 1))}><ChevronRight className="w-4 h-4" /></button>
          <button type="button" className="icon-btn icon-btn-surface" aria-label="Refresh" onClick={() => void reload()}><RefreshCw className={cx('w-4 h-4', loading && 'animate-spin')} /></button>
        </div>
      </div>
      {error ? <Notice tone={error === WORK_NOT_READY ? 'amber' : 'rose'}>{error}</Notice> : loading && !d ? <Skeleton className="h-48" /> : !d ? (
        <EmptyState title="No attendance this day" text="Nothing was tracked — not checked in, on leave, or a day off." className="!py-8" />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {d.late && <Badge tone="rose">Late check-in</Badge>}
            {d.left_early && <Badge tone="amber">Left early</Badge>}
            {d.below_min && <Badge tone="rose">Below minimum</Badge>}
            {d.overrun_min > 0 && <Badge tone="amber">Break over by {hm(d.overrun_min)}</Badge>}
            {d.meeting_over_cap && <Badge tone="amber">Meetings over the daily cap</Badge>}
            {d.checks_missed > 0 && <Badge tone="rose">{d.checks_missed} missed check{d.checks_missed === 1 ? '' : 's'}</Badge>}
            {d.open && <Badge tone="brand" dot>Live</Badge>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <Tile label="Check-in → out" value={`${clockOf(d.check_in)}–${d.check_out ? clockOf(d.check_out) : 'now'}`} sub={`Shift ${d.shift_start}–${d.shift_end}`} tone={d.late ? 'rose' : undefined} />
            <Tile label="Effective" value={hm(d.effective_min)} sub={`of ${hm(d.required_min)} · ${pctText(d.effective_pct)}`} tone={d.below_min ? 'rose' : (d.effective_pct ?? 0) >= 90 ? 'mint' : undefined} />
            <Tile label="Task time" value={hm(d.task_min)} sub={`Productivity ${pctText(d.productivity_pct)}`} tone="brand" />
            <Tile label="Meetings" value={hm(d.meeting_min)} />
            <Tile label="Break" value={hm(d.break_min)} sub={d.overrun_min ? `+${hm(d.overrun_min)} over` : 'within allowance'} tone={d.overrun_min ? 'amber' : undefined} />
            <Tile label="Away" value={hm(d.away_min)} sub={`${d.away_count} time${d.away_count === 1 ? '' : 's'}`} tone={d.away_min > 30 ? 'rose' : undefined} />
          </div>
          {span > 0 && (
            <div>
              <div className="flex h-4 rounded-full overflow-hidden bg-ink-100" role="img" aria-label="Timeline of the day">
                {segs.map((s, i) => (
                  <span key={i} className={SEGMENT_STYLE[s.kind].bar} style={{ width: `${Math.max(0.4, (Date.parse(s.end) - Date.parse(s.start)) / span * 100)}%` }} title={`${clockOf(s.start)}–${clockOf(s.end)} ${s.label}`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-ink-500">
                {(['task', 'meeting', 'break', 'away', 'buffer'] as const).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className={cx('w-2.5 h-2.5 rounded-full', SEGMENT_STYLE[k].bar)} />{SEGMENT_STYLE[k].label}</span>)}
              </div>
            </div>
          )}
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="data-table min-w-[520px]">
              <thead><tr><th>Time</th><th>What</th><th>Type</th><th className="text-right">Duration</th></tr></thead>
              <tbody>
                {segs.map((s, i) => (
                  <tr key={i}>
                    <td className="tnum whitespace-nowrap text-ink-600">{clockOf(s.start)}–{clockOf(s.end)}</td>
                    <td className="max-w-[280px]"><span className="block truncate font-semibold text-ink-900">{s.label}</span></td>
                    <td><span className={cx('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', SEGMENT_STYLE[s.kind].chip)}>{SEGMENT_STYLE[s.kind].label}</span></td>
                    <td className="tnum text-right font-semibold">{hm(s.minutes)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold"><td colSpan={3}>Effective (task + meetings)</td><td className="tnum text-right">{hm(d.effective_min)}</td></tr>
              </tfoot>
            </table>
          </div>
          {d.tasks.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {d.tasks.map((t) => <span key={t.task_id} className="rounded-full bg-brand-50 text-brand-800 px-2.5 py-1 text-[12px] font-semibold max-w-full truncate">{t.title} · {hm(t.minutes)}</span>)}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ month */

function ScoreCard({ m }: { m: WorkMonth }) {
  const parts = [
    { k: 'Time', v: m.effectiveness_pct, w: m.weights.time, sub: `${hm(m.effective_min)} of ${hm(m.required_min)}` },
    { k: 'Deadlines', v: m.deadline_pct, w: m.weights.deadlines, sub: `${m.tasks_on_time} of ${m.tasks_due} on time` },
    { k: 'Quality', v: m.quality_pct, w: m.weights.quality, sub: `${m.first_draft_ok} of ${m.first_drafts} first drafts approved` },
  ];
  return (
    <div className="rounded-2xl border border-ink-200 p-4 grid gap-4 sm:grid-cols-[150px_1fr] items-center">
      <div className="text-center sm:text-left">
        <p className="text-[12px] font-semibold text-ink-500">Score</p>
        <p className={cx('font-display text-[44px] font-bold leading-none tnum', m.score == null ? 'text-ink-300' : m.score >= 85 ? 'text-mint-700' : m.score >= 70 ? 'text-brand-700' : 'text-rose-600')}>{m.score ?? '—'}</p>
        <p className="text-[11px] text-ink-500 mt-1">out of 100</p>
      </div>
      <div className="space-y-2.5">
        {parts.map((p) => (
          <div key={p.k}>
            <div className="flex justify-between text-[12px] mb-1"><span className="font-semibold text-ink-700">{p.k} <span className="text-ink-400 font-normal">· {p.w}%</span></span><span className="tnum font-bold text-ink-900">{pctText(p.v)}</span></div>
            <div className="h-2 rounded-full bg-ink-100 overflow-hidden"><div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, p.v ?? 0)}%` }} /></div>
            <p className="text-[11px] text-ink-500 mt-0.5">{p.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const DAY_KIND: Record<MonthDay['kind'], { label: string; tone: 'ink' | 'amber' | 'rose' | 'brand' }> = {
  present: { label: 'Present', tone: 'ink' }, leave: { label: 'Leave', tone: 'amber' }, off: { label: 'Off', tone: 'ink' }, absent: { label: 'Absent', tone: 'rose' }, today: { label: 'Today', tone: 'brand' },
};

export function MonthView({ employeeId, month, onMonth, onDay, title }: { employeeId: string | null; month: string; onMonth: (m: string) => void; onDay: (d: string) => void; title?: string }) {
  const { data: m, error, loading, reload } = useLoad<WorkMonth>(() => workApi.month(employeeId, month), [employeeId, month]);
  const days = (m?.days ?? []).slice().reverse();
  const thisMonth = monthStart(today());

  function exportCsv() {
    if (!m) return;
    const rows = [['Date', 'Status', 'Check-in', 'Check-out', 'Task (min)', 'Meetings (min)', 'Break (min)', 'Away (min)', 'Effective (min)', 'Effective %', 'Late', 'Below minimum']];
    for (const d of m.days ?? []) rows.push([d.date, d.kind, d.check_in ? clockOf(d.check_in) : '', d.check_out ? clockOf(d.check_out) : '', String(d.task_min ?? ''), String(d.meeting_min ?? ''), String(d.break_min ?? ''), String(d.away_min ?? ''), String(d.effective_min ?? ''), String(d.effective_pct ?? ''), d.late ? 'yes' : '', d.below_min ? 'yes' : '']);
    const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `work-time-${month.slice(0, 7)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-[16px] font-bold text-ink-900 flex-1 min-w-[160px]">{title ?? 'Month'} · {monthName(month)}</h3>
        <div className="flex items-center gap-1">
          <button type="button" className="icon-btn icon-btn-surface" aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}><ChevronLeft className="w-4 h-4" /></button>
          <button type="button" className="icon-btn icon-btn-surface" aria-label="Next month" disabled={month >= thisMonth} onClick={() => onMonth(shiftMonth(month, 1))}><ChevronRight className="w-4 h-4" /></button>
          <button type="button" className="icon-btn icon-btn-surface" aria-label="Refresh" onClick={() => void reload()}><RefreshCw className={cx('w-4 h-4', loading && 'animate-spin')} /></button>
          <button type="button" className="icon-btn icon-btn-surface" aria-label="Download CSV" disabled={!m} onClick={exportCsv}><Download className="w-4 h-4" /></button>
        </div>
      </div>
      {error ? <Notice tone={error === WORK_NOT_READY ? 'amber' : 'rose'}>{error}</Notice> : loading && !m ? <Skeleton className="h-64" /> : m && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <Tile label="Present" value={`${m.present}/${m.working_days}`} sub={`${m.leave} leave · ${m.absent} absent`} />
            <Tile label="Avg effective / day" value={hm(m.avg_effective_min)} sub={`Effectiveness ${pctText(m.effectiveness_pct)}`} tone={(m.effectiveness_pct ?? 0) >= 90 ? 'mint' : m.effectiveness_pct == null ? undefined : 'rose'} />
            <Tile label="Productivity" value={pctText(m.productivity_pct)} sub="task time ÷ time at work" tone="brand" />
            <Tile label="Late days" value={m.late_days} sub={`Avg check-in ${m.avg_check_in ?? '—'}`} tone={m.late_days ? 'rose' : undefined} />
            <Tile label="Days below minimum" value={m.below_min_days} tone={m.below_min_days ? 'rose' : undefined} />
            <Tile label="Away total" value={hm(m.away_min)} sub={`${m.checks_missed} missed check${m.checks_missed === 1 ? '' : 's'}`} tone={m.away_min > 120 ? 'rose' : undefined} />
          </div>
          <ScoreCard m={m} />
          {/* desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="data-table min-w-[760px]">
              <thead><tr><th>Day</th><th>In–out</th><th className="text-right">Task</th><th className="text-right">Meetings</th><th className="text-right">Break</th><th className="text-right">Away</th><th className="text-right">Effective</th><th>Flags</th></tr></thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.date} className={cx(d.kind === 'present' || d.kind === 'today' ? 'cursor-pointer hover:bg-ink-50/60' : 'text-ink-400')} onClick={() => (d.kind === 'present' || d.kind === 'today') && d.check_in && onDay(d.date)}>
                    <td className="whitespace-nowrap"><b className="text-ink-900">{weekday(d.date)} {dateLabel(d.date)}</b></td>
                    {d.check_in ? <>
                      <td className="tnum whitespace-nowrap">{clockOf(d.check_in)}–{d.check_out ? clockOf(d.check_out) : '…'}</td>
                      <td className="tnum text-right">{hm(d.task_min)}</td>
                      <td className="tnum text-right">{hm(d.meeting_min)}</td>
                      <td className={cx('tnum text-right', (d.overrun_min ?? 0) > 0 && 'text-amber-700 font-semibold')}>{hm(d.break_min)}</td>
                      <td className={cx('tnum text-right', (d.away_min ?? 0) > 30 && 'text-rose-600 font-semibold')}>{hm(d.away_min)}</td>
                      <td className="tnum text-right"><b>{hm(d.effective_min)}</b> <span className={cx('text-[11px]', d.below_min ? 'text-rose-600 font-bold' : 'text-ink-500')}>{pctText(d.effective_pct)}</span></td>
                      <td className="whitespace-nowrap space-x-1">{d.late && <Badge tone="rose">Late</Badge>}{d.below_min && <Badge tone="rose">Below min</Badge>}{(d.overrun_min ?? 0) > 0 && <Badge tone="amber">Break</Badge>}</td>
                    </> : <td colSpan={7}><Badge tone={DAY_KIND[d.kind].tone}>{DAY_KIND[d.kind].label}</Badge></td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold"><td>Total</td><td /><td className="tnum text-right">{hm(m.task_min)}</td><td className="tnum text-right">{hm(m.meeting_min)}</td><td className="tnum text-right">{hm(m.break_min)}</td><td className="tnum text-right">{hm(m.away_min)}</td><td className="tnum text-right">{hm(m.effective_min)}</td><td /></tr>
              </tfoot>
            </table>
          </div>
          {/* phone list */}
          <ul className="sm:hidden divide-y divide-ink-100 -mx-1">
            {days.map((d) => (
              <li key={d.date}>
                <button type="button" disabled={!d.check_in} onClick={() => d.check_in && onDay(d.date)} className="w-full text-left px-1 py-2.5 flex items-center gap-3 disabled:opacity-60">
                  <span className="w-14 shrink-0"><b className="block text-[13px] text-ink-900">{dateLabel(d.date).replace(/ \d{4}$/, '')}</b><span className="text-[11px] text-ink-500">{weekday(d.date)}</span></span>
                  {d.check_in ? (
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center justify-between gap-2"><span className="tnum text-[12px] text-ink-600">{clockOf(d.check_in)}–{d.check_out ? clockOf(d.check_out) : '…'}</span><b className={cx('tnum text-[13px]', d.below_min ? 'text-rose-600' : 'text-ink-900')}>{hm(d.effective_min)} · {pctText(d.effective_pct)}</b></span>
                      <span className="mt-1 flex h-1.5 rounded-full overflow-hidden bg-ink-100">
                        <span className="bg-brand-500" style={{ width: `${(d.task_min ?? 0) / Math.max(1, d.gross_min ?? 1) * 100}%` }} />
                        <span className="bg-sky-500" style={{ width: `${(d.meeting_min ?? 0) / Math.max(1, d.gross_min ?? 1) * 100}%` }} />
                        <span className="bg-amber-400" style={{ width: `${(d.break_min ?? 0) / Math.max(1, d.gross_min ?? 1) * 100}%` }} />
                        <span className="bg-rose-500" style={{ width: `${(d.away_min ?? 0) / Math.max(1, d.gross_min ?? 1) * 100}%` }} />
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">{d.late && <Badge tone="rose">Late</Badge>}{d.below_min && <Badge tone="rose">Below min</Badge>}{(d.away_min ?? 0) > 30 && <Badge tone="rose">Away {hm(d.away_min)}</Badge>}</span>
                    </span>
                  ) : <span className="flex-1"><Badge tone={DAY_KIND[d.kind].tone}>{DAY_KIND[d.kind].label}</Badge></span>}
                  {d.check_in && <ChevronRight className="w-4 h-4 text-ink-300 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ pages */

/** Employee “My time”: today live, then any day or month. */
export function MyTimePage() {
  const [view, setView] = useState<'day' | 'month'>('day');
  const [date, setDate] = useState(today());
  const [month, setMonth] = useState(monthStart(today()));
  const work = useWork();
  return (
    <Page>
      <PageHeader title="My time" subtitle="Every minute from check-in to check-out is task, meeting, break or away. Time is recorded live and can’t be edited." />
      {work?.enabled && <LiveNow state={work.state} />}
      <PillTabs value={view} onChange={setView} items={[{ id: 'day', label: 'Day' }, { id: 'month', label: 'Month' }]} />
      {view === 'day'
        ? <DayView employeeId={null} date={date} onDate={setDate} />
        : <MonthView employeeId={null} month={month} onMonth={setMonth} onDay={(d) => { setDate(d); setView('day'); }} />}
    </Page>
  );
}

function LiveNow({ state }: { state: WorkState | null }) {
  if (state && !state.checked_in) return <Notice tone="ink">Check in from My Attendance to start tracking today.</Notice>;
  return null;
}

function liveStatus(s: WorkState, nowMs: number, lastSeen: string | null) {
  const offline = lastSeen ? nowMs - Date.parse(lastSeen) > 10 * 60000 : true;
  if (!s.checked_in) return { label: 'Not checked in', tone: 'ink' as const, detail: '' };
  if (s.checked_out) return { label: 'Checked out', tone: 'ink' as const, detail: '' };
  if (s.attendance_state === 'on_break') return { label: 'On break', tone: 'amber' as const, detail: `${hm(s.break_used_minutes)} used` };
  if (s.current?.kind === 'task') return { label: 'Working', tone: 'brand' as const, detail: `${s.current.title} · ${ticker((nowMs - Date.parse(s.current.started_at)) / 1000)}` };
  if (s.current?.kind === 'meeting') return { label: 'In a meeting', tone: 'sky' as const, detail: `${meetingLabel(s.current.meeting_type)} · ${ticker((nowMs - Date.parse(s.current.started_at)) / 1000)}` };
  return { label: offline ? 'Offline' : 'Away', tone: 'rose' as const, detail: `since ${clockOf(s.idle_since ?? s.check_in_at)}` };
}

function LiveBoard({ onOpen }: { onOpen: (id: string, name: string) => void }) {
  const { data, error, loading, reload } = useLoad(() => workApi.teamLive(), []);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const a = window.setInterval(() => setNow(Date.now()), 1000); const b = window.setInterval(() => void reload(), 60000); return () => { window.clearInterval(a); window.clearInterval(b); }; }, [reload]);
  const rows = data ?? [];
  const counts = useMemo(() => {
    const c = { working: 0, meeting: 0, break: 0, away: 0, out: 0 };
    for (const r of rows) {
      const s = r.state;
      if (!s.checked_in || s.checked_out) c.out++; else if (s.attendance_state === 'on_break') c.break++; else if (s.current?.kind === 'task') c.working++; else if (s.current?.kind === 'meeting') c.meeting++; else c.away++;
    }
    return c;
  }, [rows]);
  if (error) return <Notice tone={error === WORK_NOT_READY ? 'amber' : 'rose'}>{error}</Notice>;
  if (loading && !data) return <Skeleton className="h-48" />;
  if (!rows.length) return <Card><EmptyState icon={<Users className="w-6 h-6" />} title="No one reports to you yet" className="!py-10" /></Card>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        <Tile label="Working" value={counts.working} tone="brand" />
        <Tile label="Meeting" value={counts.meeting} />
        <Tile label="Break" value={counts.break} tone={counts.break ? 'amber' : undefined} />
        <Tile label="Away" value={counts.away} tone={counts.away ? 'rose' : undefined} />
        <Tile label="Not in / out" value={counts.out} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const st = liveStatus(r.state, now, r.last_seen_at);
          return (
            <button key={r.employee_id} type="button" onClick={() => onOpen(r.employee_id, r.name)} className="card p-3.5 flex items-center gap-3 text-left hover:border-brand-200 transition-colors min-w-0">
              <Avatar name={r.name} size={38} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><b className="text-[14px] text-ink-900 truncate">{r.name}</b><Badge tone={st.tone} dot>{st.label}</Badge></span>
                <span className="block text-[12px] text-ink-500 truncate mt-0.5">{st.detail || r.designation || ''}</span>
                {r.state.pending.length > 0 && <span className="block text-[11px] font-semibold text-amber-700 mt-0.5">Progress check waiting</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TeamMonth({ month, onMonth, onOpen }: { month: string; onMonth: (m: string) => void; onOpen: (id: string, name: string) => void }) {
  const { data, error, loading, reload } = useLoad(() => workApi.teamMonth(month), [month]);
  const [sort, setSort] = useState<'name' | 'score' | 'eff' | 'away'>('score');
  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    const v = (x: typeof a) => (sort === 'score' ? x.summary.score : sort === 'eff' ? x.summary.effectiveness_pct : -(x.summary.away_min ?? 0)) ?? -1;
    return Number(v(b)) - Number(v(a));
  }), [data, sort]);
  const thisMonth = monthStart(today());
  const sortBtn = (k: typeof sort, label: string) => <button type="button" className={cx('font-semibold', sort === k ? 'text-brand-700' : '')} onClick={() => setSort(k)}>{label}</button>;
  return (
    <Card className="p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-[16px] font-bold text-ink-900 flex-1">Team · {monthName(month)}</h3>
        <button type="button" className="icon-btn icon-btn-surface" aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}><ChevronLeft className="w-4 h-4" /></button>
        <button type="button" className="icon-btn icon-btn-surface" aria-label="Next month" disabled={month >= thisMonth} onClick={() => onMonth(shiftMonth(month, 1))}><ChevronRight className="w-4 h-4" /></button>
        <button type="button" className="icon-btn icon-btn-surface" aria-label="Refresh" onClick={() => void reload()}><RefreshCw className={cx('w-4 h-4', loading && 'animate-spin')} /></button>
      </div>
      {error ? <Notice tone={error === WORK_NOT_READY ? 'amber' : 'rose'}>{error}</Notice> : loading && !data ? <Skeleton className="h-48" /> : !rows.length ? <EmptyState title="No one to show" className="!py-8" /> : (
        <>
          <div className="hidden md:block overflow-x-auto">
            <table className="data-table min-w-[900px]">
              <thead><tr>
                <th>{sortBtn('name', 'Employee')}</th><th className="text-right">Present</th><th className="text-right">Avg effective</th><th className="text-right">{sortBtn('eff', 'Effectiveness')}</th>
                <th className="text-right">Late</th><th className="text-right">Below min</th><th className="text-right">{sortBtn('away', 'Away')}</th><th className="text-right">On time</th><th className="text-right">First-time ✓</th><th className="text-right">{sortBtn('score', 'Score')}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const s = r.summary;
                  return (
                    <tr key={r.employee_id} className="cursor-pointer hover:bg-ink-50/60" onClick={() => onOpen(r.employee_id, r.name)}>
                      <td><div className="flex items-center gap-2 min-w-0"><Avatar name={r.name} size={28} /><div className="min-w-0"><p className="font-semibold text-ink-900 truncate">{r.name}</p><p className="text-[11px] text-ink-400 truncate">{r.designation}</p></div></div></td>
                      <td className="tnum text-right">{s.present}/{s.working_days}</td>
                      <td className="tnum text-right">{hm(s.avg_effective_min)}</td>
                      <td className={cx('tnum text-right font-semibold', s.effectiveness_pct != null && s.effectiveness_pct < 90 ? 'text-rose-600' : 'text-ink-900')}>{pctText(s.effectiveness_pct)}</td>
                      <td className={cx('tnum text-right', s.late_days ? 'text-rose-600 font-semibold' : '')}>{s.late_days}</td>
                      <td className={cx('tnum text-right', s.below_min_days ? 'text-rose-600 font-semibold' : '')}>{s.below_min_days}</td>
                      <td className="tnum text-right">{hm(s.away_min)}</td>
                      <td className="tnum text-right">{pctText(s.deadline_pct)}</td>
                      <td className="tnum text-right">{pctText(s.quality_pct)}</td>
                      <td className="tnum text-right"><b className={cx('text-[15px]', s.score == null ? 'text-ink-300' : s.score >= 85 ? 'text-mint-700' : s.score >= 70 ? 'text-brand-700' : 'text-rose-600')}>{s.score ?? '—'}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="md:hidden space-y-2">
            {rows.map((r) => {
              const s = r.summary;
              return (
                <li key={r.employee_id}>
                  <button type="button" onClick={() => onOpen(r.employee_id, r.name)} className="w-full rounded-2xl border border-ink-200 p-3 text-left">
                    <div className="flex items-center gap-2.5"><Avatar name={r.name} size={32} /><b className="flex-1 truncate text-[14px] text-ink-900">{r.name}</b><b className={cx('tnum text-[20px] font-display', s.score == null ? 'text-ink-300' : s.score >= 85 ? 'text-mint-700' : s.score >= 70 ? 'text-brand-700' : 'text-rose-600')}>{s.score ?? '—'}</b></div>
                    <div className="grid grid-cols-4 gap-1 mt-2 text-center">
                      {[['Present', `${s.present}/${s.working_days}`], ['Effective', pctText(s.effectiveness_pct)], ['Late', String(s.late_days)], ['Away', hm(s.away_min)]].map(([k, v]) => (
                        <div key={k} className="rounded-xl bg-ink-50 py-1.5"><p className="text-[10px] text-ink-500">{k}</p><p className="tnum text-[12px] font-bold text-ink-900">{v}</p></div>
                      ))}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Person drill-down used by managers and admins: month → day. */
function PersonTime({ id, name, onBack }: { id: string; name: string; onBack: () => void }) {
  const [view, setView] = useState<'month' | 'day'>('month');
  const [month, setMonth] = useState(monthStart(today()));
  const [date, setDate] = useState(today());
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={onBack}><ArrowLeft className="w-4 h-4" />Team</button>
        <Avatar name={name} size={30} /><b className="font-display text-[16px] text-ink-900">{name}</b>
        <div className="ml-auto"><PillTabs size="sm" value={view} onChange={setView} items={[{ id: 'month', label: 'Month' }, { id: 'day', label: 'Day' }]} /></div>
      </div>
      {view === 'month'
        ? <MonthView employeeId={id} month={month} onMonth={setMonth} onDay={(d) => { setDate(d); setView('day'); }} title={name} />
        : <DayView employeeId={id} date={date} onDate={setDate} title={name} />}
    </div>
  );
}

export function TeamTimePage({ admin = false }: { admin?: boolean }) {
  const [tab, setTab] = useState<'live' | 'month' | 'settings'>('live');
  const [month, setMonth] = useState(monthStart(today()));
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null);
  const open = (id: string, name: string) => setPerson({ id, name });
  return (
    <Page>
      <PageHeader title={admin ? 'Work time' : 'Team time'} subtitle={admin ? 'Live status, monthly effectiveness and score for everyone, and the tracking rules.' : 'Who’s working right now, and each person’s month. Tap a person to see their days.'} />
      {person ? <PersonTime id={person.id} name={person.name} onBack={() => setPerson(null)} /> : (
        <>
          <PillTabs value={tab} onChange={setTab} items={[{ id: 'live', label: 'Live' }, { id: 'month', label: 'Month' }, ...(admin ? [{ id: 'settings' as const, label: 'Rules' }] : [])]} />
          {tab === 'live' && <LiveBoard onOpen={open} />}
          {tab === 'month' && <TeamMonth month={month} onMonth={setMonth} onOpen={open} />}
          {tab === 'settings' && admin && <WorkSettingsForm />}
        </>
      )}
    </Page>
  );
}

/* ------------------------------------------------------------------ admin rules */

const FIELDS: Array<{ k: keyof WorkSettings; label: string; hint: string; min: number; max: number; unit: string }> = [
  { k: 'checkin_buffer_minutes', label: 'Start buffer after check-in', hint: 'Time to settle in before “away” starts', min: 0, max: 60, unit: 'min' },
  { k: 'daily_break_minutes', label: 'Daily break allowance', hint: 'Breaks beyond this count as away', min: 0, max: 240, unit: 'min' },
  { k: 'check_min_minutes', label: 'Progress check — earliest', hint: 'Random check between earliest and latest', min: 10, max: 240, unit: 'min' },
  { k: 'check_max_minutes', label: 'Progress check — latest', hint: '', min: 10, max: 240, unit: 'min' },
  { k: 'check_answer_minutes', label: 'Time to answer a check', hint: 'Missed → away from the question time', min: 1, max: 30, unit: 'min' },
  { k: 'offline_minutes', label: 'Offline after', hint: 'No signal from the app for this long closes the timer', min: 3, max: 60, unit: 'min' },
  { k: 'meeting_cap_minutes', label: 'Meeting flag after', hint: 'Flag only', min: 0, max: 600, unit: 'min/day' },
  { k: 'required_minutes', label: 'Required effective time', hint: 'Per full day', min: 60, max: 900, unit: 'min' },
  { k: 'min_effective_pct', label: 'Flag days below', hint: 'Effectiveness %', min: 0, max: 100, unit: '%' },
  { k: 'weight_time', label: 'Score weight · time', hint: 'Weights must add up to 100', min: 0, max: 100, unit: '%' },
  { k: 'weight_deadlines', label: 'Score weight · deadlines', hint: '', min: 0, max: 100, unit: '%' },
  { k: 'weight_quality', label: 'Score weight · quality', hint: 'First draft approved', min: 0, max: 100, unit: '%' },
];

function WorkSettingsForm() {
  const { data, error, loading, reload } = useLoad(() => workApi.settings(), []);
  const [form, setForm] = useState<Partial<WorkSettings>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setForm(data); }, [data]);
  const sum = Number(form.weight_time ?? 0) + Number(form.weight_deadlines ?? 0) + Number(form.weight_quality ?? 0);
  const invalid = sum !== 100 || Number(form.check_max_minutes) < Number(form.check_min_minutes);
  async function save() {
    setBusy(true);
    try {
      const patch: Partial<WorkSettings> = {};
      for (const f of FIELDS) (patch as any)[f.k] = Math.round(Number(form[f.k]));
      await workApi.saveSettings(patch);
      notify('Work-tracking rules saved.', 'success');
      await reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Couldn’t save.', 'error', 6000); } finally { setBusy(false); }
  }
  if (error) return <Notice tone="rose">{error}</Notice>;
  if (loading && !data) return <Skeleton className="h-64" />;
  if (!data) return <Notice tone="amber">{WORK_NOT_READY}</Notice>;
  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <div className="flex items-center gap-2"><Settings2 className="w-4 h-4 text-ink-400" /><h3 className="font-display text-[16px] font-bold text-ink-900">Tracking rules</h3></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.k} className="block">
            <span className="label">{f.label}</span>
            <div className="flex items-center gap-2">
              <input type="number" min={f.min} max={f.max} value={form[f.k] ?? ''} onChange={(e) => setForm({ ...form, [f.k]: (e.target.value === '' ? '' : Number(e.target.value)) as any })} className="input tnum" />
              <span className="text-[12px] text-ink-500 w-14 shrink-0">{f.unit}</span>
            </div>
            {f.hint && <span className="block text-[11px] text-ink-500 mt-1">{f.hint}</span>}
          </label>
        ))}
      </div>
      {sum !== 100 && <Notice tone="amber">Score weights add up to {sum}%. They must add up to 100%.</Notice>}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-ink-500 flex items-center gap-1.5"><Coffee className="w-3.5 h-3.5" />Changes apply from now; past days are recalculated with the new rules.</p>
        <button type="button" className="btn-primary" disabled={busy || invalid} onClick={() => void save()}>{busy ? 'Saving…' : 'Save rules'}</button>
      </div>
    </Card>
  );
}
