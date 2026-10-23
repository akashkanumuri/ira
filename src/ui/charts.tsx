import React, { useId, useMemo, useState } from 'react';
import { cx, type Tone } from './index';
import { useCountUp } from './motion';

/* ------------------------------------------------------------------ */
/* Trend bars — striped tracks, one highlighted bar with a value tag   */
/* ------------------------------------------------------------------ */

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Optional text shown in the tooltip, e.g. "6h 20m". */
  display?: string;
  /** Optional small pill above the bar (e.g. change vs previous). */
  tag?: React.ReactNode;
}

export function BarTrend({
  data,
  max,
  highlight,
  onSelect,
  height = 220,
  emptyText = 'No data for this period yet.',
}: {
  data: BarDatum[];
  max?: number;
  highlight?: string;
  onSelect?: (key: string) => void;
  height?: number;
  emptyText?: string;
}) {
  const peak = Math.max(max ?? 0, ...data.map((d) => d.value), 1);
  const [hover, setHover] = useState<string | null>(null);
  const active = hover ?? highlight ?? null;

  if (!data.length) return <p className="py-16 text-center text-sm text-ink-400">{emptyText}</p>;

  return (
    <div className="w-full">
      <div className="flex items-end gap-2 sm:gap-3" style={{ height }}>
        {data.map((d, i) => {
          const pct = Math.max(0, Math.min(1, d.value / peak));
          const isActive = d.key === active;
          const isHighlight = d.key === highlight;
          return (
            <button
              key={d.key}
              type="button"
              onMouseEnter={() => setHover(d.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(d.key)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect?.(d.key)}
              aria-label={`${d.label}: ${d.display ?? d.value}`}
              className="relative flex-1 h-full flex flex-col justify-end items-center group focus:outline-none"
            >
              {(isActive || d.tag) && (
                <span
                  className={cx(
                    'absolute z-10 -translate-y-2 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold transition-opacity duration-150',
                    isActive ? 'bg-ink-950 text-white opacity-100' : 'opacity-100'
                  )}
                  style={{ bottom: `${Math.max(pct * 100, 8)}%` }}
                >
                  {isActive ? d.display ?? d.value : d.tag}
                </span>
              )}
              <span className="bar-stripes relative w-full max-w-[44px] h-full rounded-full overflow-hidden">
                <span
                  className={cx(
                    'grow-y absolute inset-x-0 bottom-0 rounded-full transition-colors duration-200',
                    isHighlight ? 'bg-gradient-to-t from-brand-700 to-brand-500' : isActive ? 'bg-brand-300' : 'bg-brand-200/80'
                  )}
                  style={{ height: `${pct * 100}%`, ['--i' as any]: i }}
                />
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2 sm:gap-3">
        {data.map((d) => (
          <span key={d.key} className={cx('flex-1 text-center text-[11px] sm:text-xs tnum', d.key === highlight ? 'font-bold text-ink-900' : 'text-ink-400')}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Semi-circle gauge                                                   */
/* ------------------------------------------------------------------ */

export function Gauge({ value, label, tone = 'mint', size = 220 }: { value: number; label?: React.ReactNode; tone?: Tone; size?: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const animated = useCountUp(pct, 900);
  const r = 80;
  const circ = Math.PI * r;
  const color = tone === 'brand' ? '#5b35e8' : tone === 'amber' ? '#e8a23b' : tone === 'rose' ? '#e5484d' : '#34a877';
  const id = useId();
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 112" width={size} height={size * 0.56} role="img" aria-label={`${Math.round(pct)}%`}>
        <defs>
          <pattern id={`${id}-stripes`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="#f2f1f7" />
            <rect width="3" height="8" fill="#e6e4ef" />
          </pattern>
        </defs>
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke={`url(#${id}-stripes)`} strokeWidth="22" strokeLinecap="round" />
        <path
          d="M20 100 A80 80 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth="22"
          strokeLinecap="round"
          strokeDasharray={`${(animated / 100) * circ} ${circ}`}
        />
      </svg>
      {label && <div className="-mt-2 text-sm font-semibold text-ink-700 text-center">{label}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Progress ring (time tracker)                                        */
/* ------------------------------------------------------------------ */

export function Ring({ value, size = 180, stroke = 12, tone = 'brand', children }: { value: number; size?: number; stroke?: number; tone?: Tone; children?: React.ReactNode }) {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = tone === 'mint' ? '#34a877' : tone === 'amber' ? '#e8a23b' : tone === 'rose' ? '#e5484d' : '#5b35e8';
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#efeef5" strokeWidth={stroke} strokeDasharray="2 6" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(.2,.7,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Month calendar with filled day circles                              */
/* ------------------------------------------------------------------ */

export interface DayMark {
  tone: Tone | 'none';
  label: string;
}

const dayTone: Record<Tone | 'none', string> = {
  brand: 'bg-brand-600 text-white',
  mint: 'bg-mint-400 text-white',
  amber: 'bg-amber-300 text-amber-950',
  rose: 'bg-white text-rose-600 ring-1 ring-inset ring-rose-200',
  sky: 'bg-sky-400 text-white',
  ink: 'bg-ink-100 text-ink-400',
  dark: 'bg-ink-950 text-white',
  none: 'bg-ink-50 text-ink-700',
};

export function DotCalendar({
  month,
  mark,
  selected,
  onSelect,
  today,
}: {
  /** First day of month, YYYY-MM-01 */
  month: string;
  mark: (date: string) => DayMark | null;
  selected?: string | null;
  onSelect?: (date: string) => void;
  today?: string;
}) {
  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const first = new Date(Date.UTC(y, m - 1, 1, 12)).getUTCDay();
    const offset = first === 0 ? 6 : first - 1; // Monday first
    const out: Array<string | null> = Array(offset).fill(null);
    for (let d = 1; d <= days; d++) out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-2">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span key={d} className="text-center text-[11px] sm:text-xs font-semibold text-ink-400">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {cells.map((date, i) => {
          if (!date) return <span key={`e${i}`} className="aspect-square rounded-full bar-stripes opacity-60" aria-hidden />;
          const m = mark(date);
          const isSelected = selected === date;
          const isToday = today === date;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelect?.(date)}
              title={m?.label}
              aria-label={`${date}${m ? ` · ${m.label}` : ''}`}
              aria-pressed={isSelected}
              className={cx(
                'aspect-square rounded-full flex items-center justify-center text-[12px] sm:text-sm font-bold tnum transition-transform duration-150 hover:scale-[1.06] focus:outline-none',
                dayTone[m?.tone ?? 'none'],
                isSelected && 'ring-2 ring-offset-2 ring-ink-950',
                !isSelected && isToday && 'ring-2 ring-offset-2 ring-brand-300'
              )}
            >
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: Array<{ tone: Tone; label: string }> }) {
  const dot: Record<Tone, string> = {
    brand: 'bg-brand-600', mint: 'bg-mint-400', amber: 'bg-amber-300', rose: 'bg-white ring-1 ring-inset ring-rose-300', sky: 'bg-sky-400', ink: 'bg-ink-200', dark: 'bg-ink-950',
  };
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-2 text-xs font-medium text-ink-500">
          <span className={cx('w-2.5 h-2.5 rounded-full', dot[it.tone])} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
