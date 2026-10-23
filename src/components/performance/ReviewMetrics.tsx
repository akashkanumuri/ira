import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Gauge as GaugeIcon, Info } from 'lucide-react';
import { fmtMinutes, hrs, pct, reviewApi, type ReviewMetrics } from '../../lib/tasks';
import { getKolkataDateString } from '../../lib/workingDays';
import { Card, CardHeader, Notice, Skeleton, cx } from '../../ui';

const RANGES = [
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: '180', label: '6 months', days: 180 },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

function rangeDates(id: RangeId) {
  const to = getKolkataDateString();
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (RANGES.find((r) => r.id === id)!.days - 1));
  return { from: d.toISOString().slice(0, 10), to };
}

const goodTone = (v: number | null | undefined, good = 80, ok = 60) => (v == null ? 'text-ink-400' : v >= good ? 'text-mint-700' : v >= ok ? 'text-amber-700' : 'text-rose-600');

/** One person's draft-and-review quality over a period: self, their manager, or HR/admin. */
export function ReviewScorecard({ employeeId, title = 'Work quality', subtitle }: { employeeId?: string | null; title?: string; subtitle?: string }) {
  const [range, setRange] = useState<RangeId>('90');
  const [m, setM] = useState<ReviewMetrics | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setM(null); setError('');
    const { from, to } = rangeDates(range);
    try { setM(await reviewApi.metrics(employeeId ?? null, from, to)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t load metrics.'); }
  }, [employeeId, range]);
  useEffect(() => { void load(); }, [load]);

  if (error && /switch on/i.test(error)) return <Notice tone="sky">Draft and review metrics switch on once the review database update is applied.</Notice>;

  const tiles: Array<{ label: string; value: string; hint: string; cls?: string }> = m ? [
    { label: 'First-draft approval', value: pct(m.first_draft_approval_rate), hint: 'Tasks approved on the first draft', cls: goodTone(m.first_draft_approval_rate, 70, 45) },
    { label: 'Drafts per task', value: m.drafts_per_task == null ? '—' : String(m.drafts_per_task), hint: 'Average drafts before approval (lower is better)', cls: m.drafts_per_task == null ? 'text-ink-400' : m.drafts_per_task <= 1.5 ? 'text-mint-700' : m.drafts_per_task <= 2.5 ? 'text-amber-700' : 'text-rose-600' },
    { label: 'Approval rate', value: pct(m.approval_rate), hint: `${m.approved_drafts} approved · ${m.changes_drafts} sent back`, cls: goodTone(m.approval_rate, 65, 45) },
    { label: 'On time', value: pct(m.on_time_rate), hint: 'Completed tasks finished by the due date', cls: goodTone(m.on_time_rate, 85, 65) },
    { label: 'Time to first draft', value: hrs(m.avg_first_draft_hours), hint: 'From assignment to draft 1' },
    { label: 'Review turnaround', value: hrs(m.avg_review_hours), hint: 'How long drafts wait for a decision' },
    { label: 'Client first-time approval', value: pct(m.client_first_time_rate), hint: `${m.client_rounds} client round${m.client_rounds === 1 ? '' : 's'} · ${m.client_changes} asked for changes`, cls: goodTone(m.client_first_time_rate, 75, 50) },
    { label: 'Time vs estimate', value: m.estimate_minutes ? `${Math.round(m.estimate_actual_minutes / m.estimate_minutes * 100)}%` : '—', hint: m.estimate_minutes ? `${fmtMinutes(m.estimate_actual_minutes)} tracked of ${fmtMinutes(m.estimate_minutes)} estimated` : 'No estimated tasks finished yet', cls: !m.estimate_minutes ? 'text-ink-400' : m.estimate_actual_minutes <= m.estimate_minutes * 1.1 ? 'text-mint-700' : 'text-amber-700' },
  ] : [];

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display font-bold text-[17px] text-ink-900 flex items-center gap-2"><GaugeIcon className="w-4.5 h-4.5 text-brand-600" />{title}</h3>
          <p className="text-[13px] text-ink-500 mt-0.5">{subtitle ?? (m ? `${m.tasks} task${m.tasks === 1 ? '' : 's'} assigned · ${m.completed} completed · ${m.drafts} draft${m.drafts === 1 ? '' : 's'} · ${fmtMinutes(m.logged_minutes)} tracked` : 'Drafts, reviews and client approvals')}</p>
        </div>
        <div className="flex rounded-full bg-ink-100 p-1" role="tablist" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.id} type="button" role="tab" aria-selected={range === r.id} onClick={() => setRange(r.id)}
              className={cx('px-3 py-1 rounded-full text-[12px] font-semibold transition-colors', range === r.id ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800')}>{r.label}</button>
          ))}
        </div>
      </div>
      {error && <p className="text-[13px] text-rose-600">{error}</p>}
      {!m && !error && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>}
      {m && (m.tasks === 0 ? (
        <p className="text-[13px] text-ink-500">No tasks in this period yet.</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {tiles.map((t) => (
            <div key={t.label} className="inset-tile px-3.5 py-3" title={t.hint}>
              <p className="text-[11px] font-semibold text-ink-500">{t.label}</p>
              <p className={cx('stat-value text-[22px] leading-tight mt-0.5', t.cls ?? 'text-ink-900')}>{t.value}</p>
              <p className="text-[11px] text-ink-400 mt-0.5 line-clamp-2">{t.hint}</p>
            </div>
          ))}
        </div>
      ))}
    </Card>
  );
}

/** Managers (their reports) and HR/admin (everyone): compare people side by side and export. */
export function TeamReviewMetrics() {
  const [range, setRange] = useState<RangeId>('90');
  const [rows, setRows] = useState<Array<{ employee_id: string; name: string; metrics: ReviewMetrics }> | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<'name' | 'first' | 'drafts' | 'ontime' | 'client'>('name');
  const load = useCallback(async () => {
    setRows(null); setError('');
    const { from, to } = rangeDates(range);
    try { setRows(await reviewApi.teamMetrics(from, to)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t load team metrics.'); }
  }, [range]);
  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(() => {
    const list = (rows ?? []).filter((r) => r.metrics.tasks > 0);
    const val = (r: (typeof list)[number]) => sort === 'first' ? r.metrics.first_draft_approval_rate : sort === 'drafts' ? -(r.metrics.drafts_per_task ?? 99) : sort === 'ontime' ? r.metrics.on_time_rate : r.metrics.client_first_time_rate;
    return sort === 'name' ? list : [...list].sort((a, b) => Number(val(b) ?? -1) - Number(val(a) ?? -1));
  }, [rows, sort]);

  function exportCsv() {
    const head = ['Employee', 'Tasks', 'Completed', 'Drafts', 'Drafts per task', 'First-draft approval %', 'Approval %', 'On-time %', 'Avg hours to first draft', 'Avg review hours', 'Client rounds', 'Client first-time approval %', 'Tracked hours'];
    const lines = sorted.map(({ name, metrics: m }) => [name, m.tasks, m.completed, m.drafts, m.drafts_per_task ?? '', m.first_draft_approval_rate ?? '', m.approval_rate ?? '', m.on_time_rate ?? '', m.avg_first_draft_hours ?? '', m.avg_review_hours ?? '', m.client_rounds, m.client_first_time_rate ?? '', (m.logged_minutes / 60).toFixed(1)]);
    const csv = [head, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `work-quality-${rangeDates(range).from}-to-${rangeDates(range).to}.csv` });
    a.click(); URL.revokeObjectURL(url);
  }

  if (error && /switch on/i.test(error)) return <Notice tone="sky">Team metrics switch on once the review database update is applied.</Notice>;

  const th = (id: typeof sort, label: string) => (
    <th className="px-3 py-2.5 text-right font-semibold"><button type="button" onClick={() => setSort(id)} className={cx('hover:text-ink-900', sort === id && 'text-brand-700')}>{label}</button></th>
  );
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Team work quality" subtitle="Draft approvals, rework and client approvals per person."
        action={<div className="flex items-center gap-2">
          <select className="input !w-auto !min-h-[36px] !text-[13px]" value={range} onChange={(e) => setRange(e.target.value as RangeId)} aria-label="Period">
            {RANGES.map((r) => <option key={r.id} value={r.id}>Last {r.label}</option>)}
          </select>
          <button type="button" className="btn-secondary btn-sm" disabled={!sorted.length} onClick={exportCsv}><Download className="w-3.5 h-3.5" />CSV</button>
        </div>} />
      {error && <p className="px-5 pb-4 text-[13px] text-rose-600">{error}</p>}
      {!rows && !error && <div className="p-5 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}</div>}
      {rows && !sorted.length && <p className="px-5 pb-5 text-[13px] text-ink-500">No tasks in this period.</p>}
      {sorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-ink-500 bg-ink-50/70">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold"><button type="button" onClick={() => setSort('name')} className={cx('hover:text-ink-900', sort === 'name' && 'text-brand-700')}>Employee</button></th>
                <th className="px-3 py-2.5 text-right font-semibold">Tasks</th>
                {th('first', 'First-draft ✓')}
                {th('drafts', 'Drafts/task')}
                {th('ontime', 'On time')}
                {th('client', 'Client 1st-time ✓')}
                <th className="px-3 py-2.5 text-right font-semibold">Tracked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {sorted.map(({ employee_id, name, metrics: m }) => (
                <tr key={employee_id} className="hover:bg-ink-50/50">
                  <td className="px-4 py-2.5 font-semibold text-ink-900">{name}</td>
                  <td className="px-3 py-2.5 text-right tnum text-ink-600">{m.completed}/{m.tasks}</td>
                  <td className={cx('px-3 py-2.5 text-right tnum font-bold', goodTone(m.first_draft_approval_rate, 70, 45))}>{pct(m.first_draft_approval_rate)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{m.drafts_per_task ?? '—'}</td>
                  <td className={cx('px-3 py-2.5 text-right tnum font-bold', goodTone(m.on_time_rate, 85, 65))}>{pct(m.on_time_rate)}</td>
                  <td className={cx('px-3 py-2.5 text-right tnum font-bold', goodTone(m.client_first_time_rate, 75, 50))}>{pct(m.client_first_time_rate)}</td>
                  <td className="px-3 py-2.5 text-right tnum text-ink-600">{fmtMinutes(m.logged_minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-[11px] text-ink-400 flex items-center gap-1.5"><Info className="w-3.5 h-3.5" />Counts tasks assigned in the period. Cancelled tasks are left out.</p>
        </div>
      )}
    </Card>
  );
}
