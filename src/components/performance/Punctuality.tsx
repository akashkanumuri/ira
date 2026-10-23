import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlarmClock, CalendarCheck2, Download, Info, LogOut, Timer } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getKolkataDateString } from '../../lib/workingDays';
import { Card, CardHeader, Skeleton, cx } from '../../ui';
import { Modal } from '../../ui/Modal';

export interface PunctualityDay { date: string; in: string | null; out: string | null; late: number; early: number }
export interface Punctuality {
  from: string; to: string; shift_start: string; shift_end: string;
  days_present: number; on_time_days: number; late_days: number; on_time_rate: number | null;
  avg_late_minutes: number | null; total_late_minutes: number; early_leave_days: number; avg_early_minutes: number | null;
  missed_checkout_days: number; avg_check_in: string | null; avg_break_minutes: number | null; days: PunctualityDay[];
  tasks_due: number; tasks_on_time: number; tasks_late: number; tasks_overdue: number; task_on_time_rate: number | null;
  avg_days_late: number | null; drafts: number; drafts_on_time: number; draft_on_time_rate: number | null;
}

const db = supabase as any;
const RANGES = [{ id: 30, label: '30 days' }, { id: 90, label: '90 days' }] as const;
function range(days: number) {
  const to = getKolkataDateString();
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return { from: d.toISOString().slice(0, 10), to };
}
async function call<T>(fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(Number(v))}%`);
const mins = (m: number | null | undefined) => {
  if (m == null) return '—';
  const v = Math.round(Number(m));
  return v >= 60 ? `${Math.floor(v / 60)}h${v % 60 ? ` ${v % 60}m` : ''}` : `${v}m`;
};
const tone = (v: number | null | undefined, good = 90, ok = 70) => (v == null ? 'text-ink-400' : v >= good ? 'text-mint-700' : v >= ok ? 'text-amber-700' : 'text-rose-600');
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Tile({ label, value, hint, cls, icon }: { label: string; value: string; hint: string; cls?: string; icon?: React.ReactNode }) {
  return (
    <div className="inset-tile px-3.5 py-3" title={hint}>
      <p className="text-[11px] font-semibold text-ink-500 flex items-center gap-1.5">{icon}{label}</p>
      <p className={cx('stat-value text-[22px] leading-tight mt-0.5', cls ?? 'text-ink-900')}>{value}</p>
      <p className="text-[11px] text-ink-400 mt-0.5 line-clamp-2">{hint}</p>
    </div>
  );
}

/** Day-by-day check-in strip: green on time, amber up to 15 min late, rose later; a notch marks leaving early. */
function DayStrip({ days }: { days: PunctualityDay[] }) {
  if (!days.length) return null;
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {days.map((d) => {
          const c = d.late === 0 ? 'bg-mint-500' : d.late <= 15 ? 'bg-amber-400' : 'bg-rose-500';
          return (
            <span key={d.date} className={cx('relative w-6 h-6 rounded-lg grid place-items-center text-[10px] font-bold text-white', c)}
              title={`${dayLabel(d.date)} · in ${d.in ?? '—'}${d.late ? ` (${mins(d.late)} late)` : ''} · out ${d.out ?? '—'}${d.early ? ` (${mins(d.early)} early)` : ''}`}>
              {Number(d.date.slice(8, 10))}
              {d.early > 0 && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-1 rounded-full bg-ink-900" />}
            </span>
          );
        })}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-[11px] text-ink-500">
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded bg-mint-500" />On time</span>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded bg-amber-400" />Up to 15 min late</span>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded bg-rose-500" />Later</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-1 rounded-full bg-ink-900" />Left early</span>
      </p>
    </div>
  );
}

/** One person's punctuality: office timing against their shift, and deadlines. */
export function PunctualityCard({ employeeId, title = 'Punctuality', embedded = false }: { employeeId?: string | null; title?: string; embedded?: boolean }) {
  const [days, setDays] = useState<30 | 90>(30);
  const [p, setP] = useState<Punctuality | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setP(null); setError('');
    const { from, to } = range(days);
    try { setP(await call<Punctuality>('employee_punctuality', { p_employee_id: employeeId ?? null, p_from: from, p_to: to })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t load punctuality.'); }
  }, [employeeId, days]);
  useEffect(() => { void load(); }, [load]);

  const body = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display font-bold text-[17px] text-ink-900 flex items-center gap-2"><AlarmClock className="w-4.5 h-4.5 text-brand-600" />{title}</h3>
          <p className="text-[13px] text-ink-500 mt-0.5">{p ? `Shift ${p.shift_start}–${p.shift_end} · ${p.days_present} day${p.days_present === 1 ? '' : 's'} checked in` : 'Check-ins against your shift, and deadlines met'}</p>
        </div>
        <div className="flex rounded-full bg-ink-100 p-1" role="tablist" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.id} type="button" role="tab" aria-selected={days === r.id} onClick={() => setDays(r.id)}
              className={cx('px-3 py-1 rounded-full text-[12px] font-semibold transition-colors', days === r.id ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800')}>{r.label}</button>
          ))}
        </div>
      </div>
      {error && <p className="text-[13px] text-rose-600">{error}</p>}
      {!p && !error && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>}
      {p && (
        <div className="space-y-5">
          <section className="space-y-3">
            <h4 className="text-[12px] font-bold uppercase tracking-wide text-ink-500">Office timing</h4>
            {p.days_present === 0 ? <p className="text-[13px] text-ink-500">No check-ins in this period.</p> : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Tile icon={<CalendarCheck2 className="w-3.5 h-3.5" />} label="On-time check-ins" value={pct(p.on_time_rate)} hint={`${p.on_time_days} of ${p.days_present} days by ${p.shift_start}`} cls={tone(p.on_time_rate)} />
                  <Tile icon={<AlarmClock className="w-3.5 h-3.5" />} label="Late days" value={String(p.late_days)} hint={p.late_days ? `Average ${mins(p.avg_late_minutes)} late · ${mins(p.total_late_minutes)} in total` : 'Never late'} cls={p.late_days ? 'text-rose-600' : 'text-mint-700'} />
                  <Tile icon={<LogOut className="w-3.5 h-3.5" />} label="Left early" value={String(p.early_leave_days)} hint={p.early_leave_days ? `Average ${mins(p.avg_early_minutes)} before ${p.shift_end}` : `Stayed till ${p.shift_end}`} cls={p.early_leave_days ? 'text-amber-700' : 'text-mint-700'} />
                  <Tile icon={<Timer className="w-3.5 h-3.5" />} label="Average check-in" value={p.avg_check_in ?? '—'} hint={`Shift starts ${p.shift_start}${p.missed_checkout_days ? ` · ${p.missed_checkout_days} day${p.missed_checkout_days === 1 ? '' : 's'} without check-out` : ''}`} />
                </div>
                <DayStrip days={p.days} />
              </>
            )}
          </section>
          <section className="space-y-3">
            <h4 className="text-[12px] font-bold uppercase tracking-wide text-ink-500">Deadlines</h4>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Tile label="Tasks on time" value={pct(p.task_on_time_rate)} hint={p.tasks_due ? `${p.tasks_on_time} of ${p.tasks_due} due tasks finished by the due date` : 'No tasks were due in this period'} cls={tone(p.task_on_time_rate, 85, 65)} />
              <Tile label="Overdue now" value={String(p.tasks_overdue)} hint="Past the due date and not handed in" cls={p.tasks_overdue ? 'text-rose-600' : 'text-mint-700'} />
              <Tile label="Finished late" value={String(p.tasks_late)} hint={p.tasks_late ? `Average ${p.avg_days_late} day${p.avg_days_late === 1 ? '' : 's'} after the due date` : 'None finished late'} cls={p.tasks_late ? 'text-amber-700' : undefined} />
              <Tile label="Drafts on time" value={pct(p.draft_on_time_rate)} hint={p.drafts ? `${p.drafts_on_time} of ${p.drafts} drafts submitted by the due date` : 'No drafts submitted'} cls={tone(p.draft_on_time_rate, 85, 65)} />
            </div>
          </section>
        </div>
      )}
    </>
  );
  return embedded ? <div>{body}</div> : <Card className="p-5 sm:p-6">{body}</Card>;
}

/** Managers (their reports) and HR/admin (everyone): punctuality side by side, sortable, exportable. */
export function TeamPunctuality() {
  const [days, setDays] = useState<30 | 90>(30);
  const [rows, setRows] = useState<Array<{ employee_id: string; name: string; metrics: Punctuality }> | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<'name' | 'ontime' | 'late' | 'tasks'>('ontime');
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);
  const load = useCallback(async () => {
    setRows(null); setError('');
    const { from, to } = range(days);
    try { setRows(await call('team_punctuality', { p_from: from, p_to: to })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t load team punctuality.'); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(() => {
    const list = (rows ?? []).filter((r) => r.metrics.days_present > 0 || r.metrics.tasks_due > 0);
    if (sort === 'name') return list;
    const val = (m: Punctuality) => sort === 'ontime' ? m.on_time_rate : sort === 'late' ? -(m.avg_late_minutes ?? 0) : m.task_on_time_rate;
    return [...list].sort((a, b) => Number(val(b.metrics) ?? -1) - Number(val(a.metrics) ?? -1));
  }, [rows, sort]);

  function exportCsv() {
    const head = ['Employee', 'Days checked in', 'On-time check-ins %', 'Late days', 'Avg minutes late', 'Left early days', 'Average check-in', 'Tasks due', 'Tasks on time %', 'Overdue now', 'Drafts on time %'];
    const lines = sorted.map(({ name, metrics: m }) => [name, m.days_present, m.on_time_rate ?? '', m.late_days, m.avg_late_minutes ?? '', m.early_leave_days, m.avg_check_in ?? '', m.tasks_due, m.task_on_time_rate ?? '', m.tasks_overdue, m.draft_on_time_rate ?? '']);
    const csv = [head, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const r = range(days);
    Object.assign(document.createElement('a'), { href: url, download: `punctuality-${r.from}-to-${r.to}.csv` }).click();
    URL.revokeObjectURL(url);
  }

  const th = (id: typeof sort, label: string, left = false) => (
    <th className={cx('px-3 py-2.5 font-semibold', left ? 'text-left pl-4' : 'text-right')}>
      <button type="button" onClick={() => setSort(id)} className={cx('hover:text-ink-900', sort === id && 'text-brand-700')}>{label}</button>
    </th>
  );
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Team punctuality" subtitle="Check-ins against each person’s shift, and deadlines met. Select a person for their day-by-day view."
        action={<div className="flex items-center gap-2">
          <select className="input !w-auto !min-h-[36px] !text-[13px]" value={days} onChange={(e) => setDays(Number(e.target.value) as 30 | 90)} aria-label="Period">
            {RANGES.map((r) => <option key={r.id} value={r.id}>Last {r.label}</option>)}
          </select>
          <button type="button" className="btn-secondary btn-sm" disabled={!sorted.length} onClick={exportCsv}><Download className="w-3.5 h-3.5" />CSV</button>
        </div>} />
      {error && <p className="px-5 pb-4 text-[13px] text-rose-600">{error}</p>}
      {!rows && !error && <div className="p-5 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}</div>}
      {rows && !sorted.length && <p className="px-5 pb-5 text-[13px] text-ink-500">No check-ins or due tasks in this period.</p>}
      {sorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-ink-500 bg-ink-50/70">
              <tr>
                {th('name', 'Employee', true)}
                {th('ontime', 'On-time check-ins')}
                <th className="px-3 py-2.5 text-right font-semibold">Late days</th>
                {th('late', 'Avg late')}
                <th className="px-3 py-2.5 text-right font-semibold">Left early</th>
                <th className="px-3 py-2.5 text-right font-semibold">Avg check-in</th>
                {th('tasks', 'Tasks on time')}
                <th className="px-3 py-2.5 text-right font-semibold">Overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {sorted.map(({ employee_id, name, metrics: m }) => (
                <tr key={employee_id} className="hover:bg-ink-50/50 cursor-pointer" tabIndex={0}
                  onClick={() => setOpen({ id: employee_id, name })} onKeyDown={(e) => { if (e.key === 'Enter') setOpen({ id: employee_id, name }); }}>
                  <td className="px-4 py-2.5 font-semibold text-ink-900">{name}</td>
                  <td className={cx('px-3 py-2.5 text-right tnum font-bold', tone(m.on_time_rate))}>{m.days_present ? `${pct(m.on_time_rate)}` : '—'}<span className="text-ink-400 font-normal"> {m.days_present ? `of ${m.days_present}d` : ''}</span></td>
                  <td className={cx('px-3 py-2.5 text-right tnum', m.late_days ? 'text-rose-600 font-semibold' : 'text-ink-600')}>{m.late_days}</td>
                  <td className="px-3 py-2.5 text-right tnum text-ink-600">{mins(m.avg_late_minutes)}</td>
                  <td className={cx('px-3 py-2.5 text-right tnum', m.early_leave_days ? 'text-amber-700 font-semibold' : 'text-ink-600')}>{m.early_leave_days}</td>
                  <td className="px-3 py-2.5 text-right tnum text-ink-600">{m.avg_check_in ?? '—'}</td>
                  <td className={cx('px-3 py-2.5 text-right tnum font-bold', tone(m.task_on_time_rate, 85, 65))}>{pct(m.task_on_time_rate)}</td>
                  <td className={cx('px-3 py-2.5 text-right tnum', m.tasks_overdue ? 'text-rose-600 font-semibold' : 'text-ink-600')}>{m.tasks_overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-[11px] text-ink-400 flex items-center gap-1.5"><Info className="w-3.5 h-3.5" />Late means checking in after the shift start, the same rule as attendance. Leave days and days off are not counted.</p>
        </div>
      )}
      {open && (
        <Modal title={`${open.name} · punctuality`} onClose={() => setOpen(null)} wide>
          <PunctualityCard employeeId={open.id} title="Punctuality" embedded />
        </Modal>
      )}
    </Card>
  );
}
