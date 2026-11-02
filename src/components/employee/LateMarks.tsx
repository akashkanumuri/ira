import React from 'react';
import { AlarmClock } from 'lucide-react';
import { Badge, Card, CardHeader, cx } from '../../ui';
import { money } from '../../lib/v2';
import { cutShort, lateDate, lateStepLabel, lateTime, nextCutText, useLateStatus, type LateStatus } from '../../lib/late';

const ord = (n: number) => { const t = n % 100; return n + (t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'); };
const monthName = (m: string) => new Date(`${m}T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' });
const to12 = (t: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
};

/** The month's late ladder: numbered warnings, then the half-day and full-day cuts. */
function Ladder({ s }: { s: LateStatus }) {
  const steps = [
    ...Array.from({ length: s.warnings }, (_, i) => ({ n: i + 1, label: i + 1 === s.warnings ? 'Final warning' : `Warning ${i + 1}`, tone: 'amber' as const })),
    { n: s.warnings + 1, label: '½ day cut', tone: 'rose' as const },
    { n: s.warnings + 2, label: '1 day cut', tone: 'rose' as const },
  ];
  const extra = Math.max(0, s.count - (s.warnings + 2));
  return (
    <div>
      <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((st) => {
          const done = s.count >= st.n;
          const next = s.count + 1 === st.n;
          return (
            <li key={st.n} className="min-w-0">
              <div className={cx('h-2.5 rounded-full transition-colors',
                done ? (st.tone === 'rose' ? 'bg-rose-500' : 'bg-amber-400') : next ? 'bg-ink-200 ring-2 ring-offset-1 ring-ink-300' : 'bg-ink-100')} />
              <p className={cx('mt-1.5 text-[11px] leading-tight truncate', done ? 'font-bold text-ink-800' : 'text-ink-400')}>{st.n}. {st.label}</p>
            </li>
          );
        })}
      </ol>
      {extra > 0 && <p className="mt-2 text-[12px] font-semibold text-rose-700">+{extra} more full-day cut{extra === 1 ? '' : 's'}</p>}
    </div>
  );
}

export function LateMarksCard({ status, detailed, index }: { status: LateStatus | null | undefined; detailed?: boolean; index?: number }) {
  if (!status || !status.enabled) return null;
  if (status.never_late && status.count === 0) return null; // flexible / project-based: no late rule to show
  const s = status;
  const nextAmount = s.daily_rate != null && s.next_cut > 0 ? ` (${money(s.next_cut * s.daily_rate)})` : '';
  const atRisk = s.count >= s.warnings;
  return (
    <Card index={index} className="p-5 sm:p-6 space-y-4">
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><AlarmClock className="w-5 h-5 text-ink-400" />Late marks · {monthName(s.month)}</span>}
        subtitle={`${s.warnings} warnings a month. The ${ord(s.warnings + 1)} late cuts half a day’s salary, every late after that a full day.`}
        action={s.count > 0
          ? <Badge tone={s.cut_days > 0 ? 'rose' : 'amber'}>{s.count} late{s.count === 1 ? '' : 's'}{s.cut_days > 0 ? ` · −${s.cut_days} day${s.cut_days === 1 ? '' : 's'}` : ''}</Badge>
          : <Badge tone="mint">No lates</Badge>}
      />
      <Ladder s={s} />
      <div className={cx('rounded-2xl px-4 py-3 text-[13px] leading-snug', atRisk ? 'bg-rose-50 text-rose-800' : s.count ? 'bg-amber-50 text-amber-900' : 'bg-mint-50 text-mint-800')}>
        {s.never_late
          ? 'You’re on flexible hours now, so new check-ins aren’t marked late.'
          : <>
              {s.count === 0 ? 'No lates this month.' : `${s.count} late${s.count === 1 ? '' : 's'} so far${s.cut_days > 0 ? ` · ${s.cut_days} day${s.cut_days === 1 ? '' : 's'} of salary cut${s.cut_amount != null ? ` (${money(s.cut_amount)})` : ''}` : ''}.`}
              {' '}<b>Your next late: {nextCutText(s)}{nextAmount}.</b>
              {s.late_after && <> Check in by {to12(s.late_after)} to stay on time.</>}
            </>}
      </div>
      {detailed && s.marks.length > 0 && (
        <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-100">
          {s.marks.map((m) => (
            <li key={m.date} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className={cx('grid place-items-center w-7 h-7 rounded-full text-[12px] font-bold shrink-0', m.cut > 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800')}>#{m.n}</span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-ink-900">{lateDate(m.date)}</span>
                <span className="text-ink-500"> · in {lateTime(m.check_in)} · {m.late_min} min late</span>
              </span>
              <span className={cx('text-right shrink-0 font-semibold', m.cut > 0 ? 'text-rose-700' : 'text-amber-800')}>
                {m.cut > 0 ? `${cutShort(m.cut)}${m.amount != null ? ` · ${money(m.amount)}` : ''}` : lateStepLabel(m.n, s.warnings)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Admin / manager view of one person's lates in a month (payroll breakdown, attendance). */
export function LateBreakdown({ employeeId, month }: { employeeId: string; month: string }) {
  const { status } = useLateStatus(employeeId, month, true);
  if (status === undefined) return <p className="text-[13px] text-ink-500">Loading…</p>;
  if (!status) return <p className="text-[13px] text-ink-500">Late details aren’t available.</p>;
  if (!status.marks.length) return <p className="text-[13px] text-ink-500">No lates in this month.</p>;
  return <LateMarksCard status={{ ...status, never_late: false, late_after: null }} detailed />;
}
