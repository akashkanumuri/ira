import React, { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Target, Users, Wallet } from 'lucide-react';
import { Badge, Card, PillTabs, cx } from '../../ui';
import {
  CAMPAIGN_STATUS, emptyTotals, fmtDay, inr, moneySummary, num, platformOf, resultsOf, shiftDay, sumResults, todayIST,
  type MkData, type Totals,
} from '../../lib/marketing';
import { BarList, BudgetMeter, TrendChart } from './Charts';

type Range = '7d' | '30d' | 'month' | 'last_month' | 'all';
const RANGES: { id: Range; label: string }[] = [
  { id: '7d', label: '7 days' }, { id: '30d', label: '30 days' }, { id: 'month', label: 'This month' }, { id: 'last_month', label: 'Last month' }, { id: 'all', label: 'All time' },
];
function rangeDates(r: Range, first: string | null): { from: string; to: string } {
  const today = todayIST();
  if (r === '7d') return { from: shiftDay(today, -6), to: today };
  if (r === '30d') return { from: shiftDay(today, -29), to: today };
  if (r === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (r === 'last_month') { const end = shiftDay(`${today.slice(0, 8)}01`, -1); return { from: `${end.slice(0, 8)}01`, to: end }; }
  return { from: first ?? today, to: today };
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

type Metric = 'spend' | 'results' | 'clicks' | 'reach' | 'cpr';
const METRICS: { id: Metric; label: string }[] = [
  { id: 'spend', label: 'Spend' }, { id: 'results', label: 'Results' }, { id: 'cpr', label: 'Cost / result' }, { id: 'clicks', label: 'Clicks' }, { id: 'reach', label: 'Reach' },
];

/** The analytics view shared by the team and the client. */
export function MarketingDashboard({ data, audience }: { data: MkData; audience: 'team' | 'client' }) {
  const [range, setRange] = useState<Range>('30d');
  const [metric, setMetric] = useState<Metric>('spend');
  const first = data.results[0]?.day ?? null;
  const { from, to } = rangeDates(range, first);
  const len = daysBetween(from, to) + 1;
  const prevFrom = shiftDay(from, -len); const prevTo = shiftDay(from, -1);

  const inRange = useMemo(() => data.results.filter((r) => r.day >= from && r.day <= to), [data.results, from, to]);
  const prev = useMemo(() => (range === 'all' ? [] : data.results.filter((r) => r.day >= prevFrom && r.day <= prevTo)), [data.results, prevFrom, prevTo, range]);
  const t = sumResults(inRange); const p = sumResults(prev);
  const money = moneySummary(data.money, data.results);

  const series = useMemo(() => {
    const byDay = new Map<string, Totals>();
    for (const r of inRange) { const cur = byDay.get(r.day) ?? emptyTotals(); for (const k of Object.keys(cur) as (keyof Totals)[]) cur[k] += Number(r[k] ?? 0); byDay.set(r.day, cur); }
    const start = range === 'all' && first ? first : from;
    const out: { day: string; value: number }[] = [];
    for (let d = start; d <= to && out.length < 800; d = shiftDay(d, 1)) {
      const v = byDay.get(d) ?? emptyTotals();
      const res = resultsOf(v);
      out.push({ day: d, value: metric === 'spend' ? v.spend : metric === 'results' ? res : metric === 'clicks' ? v.clicks : metric === 'reach' ? v.reach : res ? v.spend / res : 0 });
    }
    return out;
  }, [inRange, metric, from, to, range, first]);

  const byPlatform = useMemo(() => {
    const m = new Map<string, Totals>();
    for (const r of inRange) {
      const c = data.campaigns.find((x) => x.id === r.campaign_id); const k = c?.platform ?? 'other';
      const cur = m.get(k) ?? emptyTotals(); for (const key of Object.keys(cur) as (keyof Totals)[]) cur[key] += Number(r[key] ?? 0); m.set(k, cur);
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, label: platformOf(k).label, value: v.spend, color: platformOf(k).color,
      sub: `${num(resultsOf(v))} results${resultsOf(v) ? ` · ${inr(v.spend / resultsOf(v))} each` : ''}` })).sort((a, b) => b.value - a.value);
  }, [inRange, data.campaigns]);

  const campaigns = useMemo(() => data.campaigns.map((c) => {
    const s = sumResults(inRange.filter((r) => r.campaign_id === c.id));
    return { c, s, res: resultsOf(s) };
  }).filter((x) => x.s.spend > 0 || x.c.status === 'running').sort((a, b) => b.s.spend - a.s.spend), [data.campaigns, inRange]);

  const posts = data.posts.filter((x) => x.status !== 'cancelled');
  const postedInRange = posts.filter((x) => x.status === 'posted' && (x.posted_at ?? x.scheduled_for).slice(0, 10) >= from && (x.posted_at ?? x.scheduled_for).slice(0, 10) <= to).length;
  const upcoming = posts.filter((x) => x.status !== 'posted' && x.scheduled_for >= new Date().toISOString()).length;
  const waiting = posts.filter((x) => x.status === 'awaiting_approval').length;

  const results = resultsOf(t); const prevResults = resultsOf(p);
  const cpr = results ? t.spend / results : 0; const prevCpr = prevResults ? p.spend / prevResults : 0;
  const ctr = t.impressions ? (t.clicks / t.impressions) * 100 : 0;
  const fmt = metric === 'spend' || metric === 'cpr' ? (v: number) => inr(v, { compact: true }) : (v: number) => num(Math.round(v), true);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs size="sm" value={range} onChange={setRange} items={RANGES} />
        <p className="text-[12px] text-ink-500">{fmtDay(range === 'all' && first ? first : from, true)} – {fmtDay(to, true)}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={<Wallet className="w-4 h-4" />} label="Spent on ads" value={inr(t.spend)} delta={range === 'all' ? null : change(t.spend, p.spend)} neutral />
        <Kpi icon={<Target className="w-4 h-4" />} label="Results" value={num(results)} hint={[t.leads && `${num(t.leads)} leads`, t.messages && `${num(t.messages)} messages`, t.sales && `${num(t.sales)} sales`].filter(Boolean).join(' · ') || undefined} delta={range === 'all' ? null : change(results, prevResults)} />
        <Kpi icon={<CheckCircle2 className="w-4 h-4" />} label="Cost per result" value={results ? inr(Math.round(cpr)) : '—'} delta={range === 'all' || !prevCpr || !cpr ? null : change(cpr, prevCpr)} lowerIsBetter />
        <Kpi icon={<Users className="w-4 h-4" />} label="People reached" value={num(t.reach, true)} hint={`${num(t.impressions, true)} views · ${num(t.clicks, true)} clicks · CTR ${ctr.toFixed(2)}%`} delta={range === 'all' ? null : change(t.reach, p.reach)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h3 className="font-display font-bold text-[16px] text-ink-900">Day by day</h3>
            <PillTabs size="sm" value={metric} onChange={setMetric} items={METRICS} />
          </div>
          <TrendChart points={series} format={fmt} label={METRICS.find((m) => m.id === metric)!.label} />
        </Card>
        <Card className="p-5 space-y-4">
          <h3 className="font-display font-bold text-[16px] text-ink-900">Ad money</h3>
          <div className="grid grid-cols-2 gap-3">
            <MoneyStat label="Received" value={money.received} />
            <MoneyStat label="Spent" value={money.spent} />
            <MoneyStat label="Balance left" value={money.balance} tone={money.balance < 0 ? 'rose' : (data.settings?.low_balance ?? 0) > 0 && money.balance < (data.settings?.low_balance ?? 0) ? 'amber' : 'ink'} />
            <MoneyStat label={audience === 'client' ? 'To pay' : 'Pending from client'} value={money.pending} tone={money.pending > 0 ? 'amber' : 'ink'} />
          </div>
          <BudgetMeter received={money.received} spent={money.spent} />
          {money.requests.filter((r) => r.open > 0).slice(0, 3).map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-[12.5px]">
              <span className="text-amber-900">Requested {fmtDay(r.entry_date)}{r.due_date ? ` · due ${fmtDay(r.due_date)}` : ''}</span>
              <span className="font-semibold tnum text-amber-900">{inr(r.open)}</span>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4">
        <Card className="p-5 space-y-4">
          <h3 className="font-display font-bold text-[16px] text-ink-900">Spend by platform</h3>
          <BarList items={byPlatform} format={(v) => inr(v, { compact: true })} />
          <div className="border-t border-ink-100 pt-4">
            <h4 className="text-[12px] font-bold uppercase tracking-wide text-ink-400 mb-2">Social posts</h4>
            <div className="grid grid-cols-3 gap-2 text-center">
              <MiniStat label="Posted" value={postedInRange} />
              <MiniStat label="Coming up" value={upcoming} />
              <MiniStat label={audience === 'client' ? 'For your OK' : 'Awaiting client'} value={waiting} highlight={waiting > 0} />
            </div>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <div className="px-5 pt-5 pb-3 flex items-center gap-2"><h3 className="font-display font-bold text-[16px] text-ink-900">Campaigns</h3><span className="text-[12px] text-ink-500">in this period</span></div>
          {campaigns.length ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Campaign</th><th>Status</th><th className="text-right">Spent</th><th className="text-right">Results</th><th className="text-right">Cost / result</th><th className="text-right">CTR</th></tr></thead>
                <tbody>{campaigns.map(({ c, s, res }) => (
                  <tr key={c.id}>
                    <td className="min-w-[200px]"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: platformOf(c.platform).color }} />
                      <span className="font-semibold text-ink-900">{c.name}</span></div><p className="text-[11.5px] text-ink-500 ml-4">{platformOf(c.platform).label}</p></td>
                    <td><Badge tone={CAMPAIGN_STATUS[c.status].tone} dot>{CAMPAIGN_STATUS[c.status].label}</Badge></td>
                    <td className="text-right tnum font-semibold">{inr(s.spend)}</td>
                    <td className="text-right tnum">{num(res)}</td>
                    <td className="text-right tnum">{res ? inr(Math.round(s.spend / res)) : '—'}</td>
                    <td className="text-right tnum text-ink-600">{s.impressions ? `${((s.clicks / s.impressions) * 100).toFixed(2)}%` : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="px-5 pb-6 text-[13px] text-ink-400">No campaign results in this period.</p>}
        </Card>
      </div>
    </div>
  );
}

function change(cur: number, prev: number) { if (!prev) return null; return ((cur - prev) / prev) * 100; }

function Kpi({ icon, label, value, hint, delta, lowerIsBetter, neutral }: {
  icon: React.ReactNode; label: string; value: string; hint?: string; delta: number | null; lowerIsBetter?: boolean; neutral?: boolean;
}) {
  const good = delta == null ? null : neutral ? null : lowerIsBetter ? delta < 0 : delta > 0;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-2 text-ink-500 text-[12.5px] font-semibold"><span className="w-7 h-7 rounded-lg bg-brand-50 text-brand-700 grid place-items-center">{icon}</span>{label}</div>
      <p className="mt-3 font-display text-[26px] sm:text-[30px] font-bold text-ink-950 leading-none tnum">{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 min-h-[18px]">
        {delta != null && Number.isFinite(delta) && (
          <span className={cx('inline-flex items-center gap-0.5 text-[12px] font-semibold', good == null ? 'text-ink-500' : good ? 'text-emerald-700' : 'text-rose-700')}>
            {delta >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}{Math.abs(delta).toFixed(0)}%
            <span className="text-ink-400 font-normal">vs before</span>
          </span>
        )}
        {hint && <span className="text-[11.5px] text-ink-500">{hint}</span>}
      </div>
    </Card>
  );
}
function MoneyStat({ label, value, tone = 'ink' }: { label: string; value: number; tone?: 'ink' | 'amber' | 'rose' }) {
  return (
    <div className="rounded-2xl bg-ink-50/70 px-3 py-2.5">
      <p className="text-[11.5px] text-ink-500 font-semibold">{label}</p>
      <p className={cx('font-display text-[19px] font-bold tnum', tone === 'rose' ? 'text-rose-700' : tone === 'amber' ? 'text-amber-700' : 'text-ink-950')}>{inr(value)}</p>
    </div>
  );
}
function MiniStat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={cx('rounded-xl px-2 py-2', highlight ? 'bg-amber-50' : 'bg-ink-50/70')}>
      <p className="font-display font-bold text-[18px] text-ink-950 tnum">{value}</p>
      <p className="text-[11px] text-ink-500">{label}</p>
    </div>
  );
}

