import React, { useLayoutEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useCountUp } from './motion';

const cx = (...parts: Array<string | number | false | null | undefined>) => parts.filter((p) => typeof p === 'string' && p).join(' ');
export { cx };

export type Tone = 'brand' | 'mint' | 'amber' | 'rose' | 'sky' | 'ink' | 'dark';

const toneSoft: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-700',
  mint: 'bg-mint-50 text-mint-700',
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-700',
  sky: 'bg-sky-50 text-sky-700',
  ink: 'bg-ink-100 text-ink-600',
  dark: 'bg-ink-950 text-white',
};

const toneSolid: Record<Tone, string> = {
  brand: 'bg-brand-600 text-white',
  mint: 'bg-mint-500 text-white',
  amber: 'bg-amber-500 text-white',
  rose: 'bg-rose-500 text-white',
  sky: 'bg-sky-500 text-white',
  ink: 'bg-ink-200 text-ink-700',
  dark: 'bg-ink-950 text-white',
};

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-[1320px] space-y-5 sm:space-y-6', className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="rise flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="font-display text-[28px] sm:text-[34px] font-bold leading-[1.1] text-ink-950">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-ink-500 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  children,
  className,
  interactive,
  index,
  as: As = 'section',
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  index?: number;
  as?: 'section' | 'div' | 'article' | 'button';
  onClick?: () => void;
}) {
  const style = index != null ? ({ ['--i' as any]: index } as React.CSSProperties) : undefined;
  return (
    <As
      onClick={onClick}
      type={As === 'button' ? 'button' : undefined}
      style={style}
      className={cx('card rise', interactive && 'card-interactive cursor-pointer text-left', className)}
    >
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="font-display text-lg sm:text-xl font-bold text-ink-950 leading-tight">{title}</h2>
        {subtitle && <p className="mt-1 text-xs sm:text-[13px] text-ink-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data display                                                        */
/* ------------------------------------------------------------------ */

export function IconChip({ icon, tone = 'brand', solid, size = 'md' }: { icon: React.ReactNode; tone?: Tone; solid?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'w-8 h-8', md: 'w-11 h-11', lg: 'w-14 h-14' };
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full', sizes[size], solid ? toneSolid[tone] : toneSoft[tone])}>
      {icon}
    </span>
  );
}

function AnimatedNumber({ value, format }: { value: number; format?: (n: number) => string }) {
  const animated = useCountUp(value);
  const shown = Number.isInteger(value) ? Math.round(animated) : animated;
  return <>{format ? format(shown) : Math.round(shown).toLocaleString('en-IN')}</>;
}

/**
 * Headline number with a short caption — "1,928 · Total employees last year were 1,827".
 * The caption is where the exception goes ("3 overdue · 2 waiting on client").
 */
export function Stat({
  label,
  value,
  format,
  caption,
  icon,
  tone = 'brand',
  onClick,
  index,
  className,
}: {
  label: React.ReactNode;
  value: number | string | null | undefined;
  format?: (n: number) => string;
  caption?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
  onClick?: () => void;
  index?: number;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-3 min-h-11">
        {icon && <IconChip icon={icon} tone={tone} solid />}
        <span className="text-[15px] font-semibold text-ink-800 leading-tight">{label}</span>
      </div>
      <p className="stat-value mt-5 text-[34px] sm:text-[40px] text-ink-950">
        {typeof value === 'number' ? <AnimatedNumber value={value} format={format} /> : value ?? '—'}
      </p>
      {caption && <p className="mt-2 text-[13px] text-ink-500 leading-snug">{caption}</p>}
    </>
  );
  return (
    <Card index={index} interactive={Boolean(onClick)} onClick={onClick} as={onClick ? 'button' : 'section'} className={cx('p-5 sm:p-6 w-full', className)}>
      {body}
    </Card>
  );
}

export function Badge({ tone = 'ink', children, dot, className }: { tone?: Tone; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold leading-none whitespace-nowrap', toneSoft[tone], className)}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

/** Consistent colour for every status word used across the app. */
export function statusTone(status: string | null | undefined): Tone {
  const s = String(status ?? '').toLowerCase();
  if (['present', 'approved', 'completed', 'active', 'paid', 'accepted', 'verified', 'ready for download', 'done'].includes(s)) return 'mint';
  if (['late', 'pending', 'assigned', 'due', 'partially paid', 'awaiting client review', 'awaiting client dependency', 'awaiting acceptance', 'sent', 'viewed', 'requested', 'uploaded', 'submitted', 'draft-review', 'modification requested', 'resubmission required'].includes(s)) return 'amber';
  if (['rejected', 'inactive', 'absent', 'overdue', 'declined', 'cancelled', 'terminated', 'expired', 'locked', 'disputed', 'blocked'].includes(s)) return 'rose';
  if (['wfh', 'in progress', 'revision in progress', 'under internal review', 'upcoming'].includes(s)) return 'brand';
  if (['leave', 'holiday', 'off', 'week off'].includes(s)) return 'sky';
  return 'ink';
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const text = label ?? status;
  return (
    <Badge tone={statusTone(status)} dot>
      <span className="capitalize">{text}</span>
    </Badge>
  );
}

export function Progress({ value, tone = 'brand', className }: { value: number; tone?: Tone; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const bar = { brand: 'bg-brand-600', mint: 'bg-mint-500', amber: 'bg-amber-500', rose: 'bg-rose-500', sky: 'bg-sky-500', ink: 'bg-ink-400', dark: 'bg-ink-950' }[tone];
  return (
    <div className={cx('h-2.5 w-full rounded-full bg-ink-100 overflow-hidden', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-[width] duration-700 ease-out', bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Avatar({ name, src, size = 40, tone = 'brand' }: { name?: string | null; src?: string | null; size?: number; tone?: Tone }) {
  const initials = String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.36) };
  if (src) return <img src={src} alt={name ?? ''} style={style} className="rounded-full object-cover shrink-0 ring-2 ring-white" />;
  return (
    <span style={style} className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-bold ring-2 ring-white', toneSoft[tone])}>
      {initials || '?'}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'mint';

export function Button({
  variant = 'primary',
  size,
  icon,
  loading,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm'; icon?: React.ReactNode; loading?: boolean }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || loading} className={cx(`btn-${variant}`, size === 'sm' && 'btn-sm', className)}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/**
 * Segmented pill tabs with a sliding highlight ("Yours · Jessy · Neha").
 */
export function PillTabs<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  className,
}: {
  items: Array<{ id: T; label: React.ReactNode; count?: number }>;
  value: T;
  onChange: (id: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLButtonElement>(`[data-tab="${CSS.escape(value)}"]`);
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, items.length]);

  return (
    <div ref={wrap} role="tablist" className={cx('relative inline-flex max-w-full overflow-x-auto rounded-full bg-white border border-ink-100 p-1 shadow-[var(--shadow-soft)]', className)}>
      {indicator && (
        <span
          aria-hidden
          className="absolute top-1 bottom-1 rounded-full bg-ink-950 transition-[left,width] duration-300 ease-[cubic-bezier(.2,.7,.2,1)]"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-tab={item.id}
            onClick={() => onChange(item.id)}
            className={cx(
              'relative z-[1] inline-flex items-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors duration-200',
              size === 'sm' ? 'px-3.5 py-1.5 text-xs' : 'px-4 py-2 text-[13px]',
              active ? 'text-white' : 'text-ink-500 hover:text-ink-900'
            )}
          >
            {item.label}
            {typeof item.count === 'number' && item.count > 0 && (
              <span className={cx('min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold inline-flex items-center justify-center', active ? 'bg-white/20 text-white' : 'bg-ink-100 text-ink-600')}>
                {item.count > 99 ? '99+' : item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={cx('relative block', className)}>
      <span className="sr-only">{placeholder}</span>
      <svg aria-hidden viewBox="0 0 24 24" className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input !rounded-full !pl-10 !min-h-[40px]" />
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

export function EmptyState({ icon, title, text, action, className }: { icon?: React.ReactNode; title: React.ReactNode; text?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center px-6 py-12', className)}>
      {icon && <IconChip icon={icon} tone="ink" size="lg" />}
      <p className="mt-4 font-display text-lg font-bold text-ink-900">{title}</p>
      {text && <p className="mt-1.5 text-sm text-ink-500 max-w-sm">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('skeleton', className)} />;
}

export function SkeletonPage() {
  return (
    <Page>
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card p-6 space-y-5">
            <Skeleton className="h-11 w-11 rounded-full" />
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
      <div className="card p-6 space-y-4">
        <Skeleton className="h-5 w-48" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </Page>
  );
}

export function Notice({ tone = 'rose', title, children, action }: { tone?: Tone; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={cx('rise rounded-2xl px-4 py-3 text-sm flex items-start justify-between gap-3', toneSoft[tone])} role={tone === 'rose' ? 'alert' : 'status'}>
      <div className="min-w-0">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={cx(title ? 'mt-0.5' : false, 'opacity-90')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Small "+12%" / "-9%" pill used on trend charts. */
export function DeltaPill({ value, suffix = '%', goodWhenUp = true }: { value: number; suffix?: string; goodWhenUp?: boolean }) {
  const up = value >= 0;
  const good = up === goodWhenUp;
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold tnum', good ? 'bg-mint-100 text-mint-800' : 'bg-rose-50 text-rose-700')}>
      {up ? '+' : ''}
      {Math.round(value)}
      {suffix}
    </span>
  );
}
