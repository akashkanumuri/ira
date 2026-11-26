import React, { useMemo, useRef, useState } from 'react';
import { cx } from '../../ui';

/**
 * Small, dependency-free charts for the marketing dashboard.
 * One measure per chart (no dual axes), thin marks, recessive grid, hover tooltip on every chart.
 */

export interface Point { day: string; value: number }

const W = 720; const H = 220; const PAD = { l: 48, r: 12, t: 12, b: 26 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Area + line trend over days, with a crosshair tooltip. */
export function TrendChart({ points, format, color = '#5b35e8', label }: {
  points: Point[]; format: (v: number) => string; color?: string; label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const max = useMemo(() => niceMax(Math.max(0, ...points.map((p) => p.value))), [points]);
  if (!points.length) return <div className="h-[220px] grid place-items-center text-[13px] text-ink-400">No results in this period yet.</div>;
  const iw = W - PAD.l - PAD.r; const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${PAD.t + ih} L${x(0).toFixed(1)},${PAD.t + ih} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const step = Math.max(1, Math.ceil(points.length / 7));
  const gid = `g${label.replace(/\W/g, '')}`;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect(); if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = points.length === 1 ? 0 : Math.round(((px - PAD.l) / iw) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const hp = hover != null ? points[hover] : null;
  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-[220px] touch-none" role="img" aria-label={`${label} by day`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" /><stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#ececf2" strokeWidth="1" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill="#8a8a99">{format(t)}</text>
          </g>
        ))}
        {points.map((p, i) => (i % step === 0 || i === points.length - 1) && (
          <text key={p.day} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10.5" fill="#8a8a99">
            {new Date(`${p.day}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}
          </text>
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hp && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={PAD.t + ih} stroke="#c9c9d6" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(hover!)} cy={y(hp.value)} r="5" fill={color} stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute top-1 rounded-xl bg-ink-950 text-white px-3 py-2 text-[12px] shadow-lg"
          style={{ left: `clamp(0px, calc(${(x(hover!) / W) * 100}% - 60px), calc(100% - 130px))` }}>
          <p className="text-white/60">{new Date(`${hp.day}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}</p>
          <p className="font-semibold tnum">{label}: {format(hp.value)}</p>
        </div>
      )}
    </div>
  );
}

/** Horizontal bars, one row per item, value labels on the right. */
export function BarList({ items, format }: { items: { key: string; label: string; value: number; color: string; sub?: string }[]; format: (v: number) => string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0);
  if (!items.length || total <= 0) return <p className="text-[13px] text-ink-400 py-6 text-center">Nothing to show yet.</p>;
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.key} onPointerEnter={() => setHover(i.key)} onPointerLeave={() => setHover(null)} className="group">
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="flex items-center gap-2 text-ink-700 font-semibold"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: i.color }} />{i.label}</span>
            <span className="tnum text-ink-900 font-semibold">{format(i.value)} <span className="text-ink-400 font-normal">· {Math.round((i.value / total) * 100)}%</span></span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-ink-100 overflow-hidden">
            <div className={cx('h-full rounded-full transition-[width] duration-500', hover && hover !== i.key && 'opacity-50')} style={{ width: `${(i.value / max) * 100}%`, background: i.color }} />
          </div>
          {i.sub && <p className="text-[11.5px] text-ink-500 mt-1">{i.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Ad budget meter: how much of the money received has been spent. */
export function BudgetMeter({ received, spent }: { received: number; spent: number }) {
  const pct = received > 0 ? Math.min(100, (spent / received) * 100) : spent > 0 ? 100 : 0;
  const over = spent > received;
  return (
    <div>
      <div className="h-3 rounded-full bg-ink-100 overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Ad budget used">
        <div className={cx('h-full rounded-full', over ? 'bg-rose-500' : pct > 85 ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-[12px] text-ink-500">{received > 0 ? `${Math.round((spent / received) * 100)}% of the ad money received is spent` : 'No ad money received yet'}{over ? ' — spending is ahead of payments' : ''}</p>
    </div>
  );
}
