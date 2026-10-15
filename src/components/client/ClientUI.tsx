import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Search,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

export const cx = (...a: (string | false | undefined | null)[]) => a.filter(Boolean).join(' ');

/* ---------- Buttons ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: LucideIcon;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon: Icon,
  children,
  className,
  disabled,
  ...p
}: BtnProps) {
  const v = {
    primary: 'bg-primary text-white hover:bg-primary-hover border border-primary',
    secondary: 'bg-surface text-ink border border-line hover:bg-bg hover:border-[#d3d8e2]',
    ghost: 'text-ink-2 hover:bg-[#eef0f4] hover:text-ink border border-transparent',
    danger: 'bg-surface text-err border border-[#f0c4c4] hover:bg-err-soft',
  }[variant];

  return (
    <button
      {...p}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-[13px]',
        v,
        className
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

/* ---------- Badges ---------- */
export type Tone = 'neutral' | 'ok' | 'warn' | 'err' | 'info' | 'primary';
const tones: Record<Tone, string> = {
  neutral: 'bg-[#eef0f4] text-ink-2',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  err: 'bg-err-soft text-err',
  info: 'bg-info-soft text-[#2a64b5]',
  primary: 'bg-primary-soft text-primary',
};
const toneIcon: Partial<Record<Tone, LucideIcon>> = {
  ok: CheckCircle2,
  err: XCircle,
  warn: AlertTriangle,
  info: Info,
};

export function Badge({
  tone = 'neutral',
  children,
  icon = true,
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: boolean;
}) {
  const I = toneIcon[tone];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 h-5 px-1.5 rounded text-[11px] font-medium whitespace-nowrap',
        tones[tone]
      )}
    >
      {icon && I ? (
        <I size={11} strokeWidth={2.4} />
      ) : tone !== 'neutral' && icon ? (
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}

const statusMap: Record<string, Tone> = {
  Present: 'ok',
  Absent: 'err',
  Late: 'warn',
  'Work From Home': 'info',
  'Pending Correction': 'warn',
  Incomplete: 'warn',
  'On Leave': 'neutral',
  Active: 'ok',
  active: 'ok',
  Inactive: 'neutral',
  inactive: 'neutral',
  Invited: 'info',
  'Invitation Pending': 'info',
  'Invitation Expired': 'err',
  'Not Started': 'neutral',
  'In Progress': 'info',
  Submitted: 'primary',
  'Under Review': 'warn',
  'Changes Requested': 'err',
  Completed: 'ok',
  completed: 'ok',
  'Pending Review': 'warn',
  Accepted: 'ok',
  Declined: 'err',
  'Change Requested': 'warn',
  'Approved Change': 'ok',
  'Change Declined': 'err',
  Updated: 'primary',
  Current: 'neutral',
  Approved: 'ok',
  Pending: 'warn',
  Rejected: 'err',
  Upcoming: 'neutral',
  Due: 'warn',
  Overdue: 'err',
  'Pending Verification': 'info',
  Paid: 'ok',
  Finalized: 'ok',
  Draft: 'neutral',
  Delayed: 'err',
  'On Track': 'ok',
  'Needs Attention': 'warn',
  High: 'err',
  Medium: 'warn',
  Low: 'neutral',
  Sent: 'ok',
  Failed: 'err',
  'Not Sent': 'neutral',
  'On Hold': 'warn',
  paused: 'warn',
};

export const Status = ({ s }: { s: string }) => <Badge tone={statusMap[s] ?? 'neutral'}>{s}</Badge>;

/* ---------- Layout Primitives ---------- */
export const Card = ({
  children,
  className,
  pad = true,
}: {
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) => (
  <section className={cx('bg-surface border border-line rounded-lg', pad && 'p-5', className)}>
    {children}
  </section>
);

export function CardHead({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        {desc && <p className="text-xs text-ink-2 mt-0.5">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  desc,
  actions,
  crumbs,
}: {
  title: string;
  desc?: string;
  actions?: ReactNode;
  crumbs?: string[];
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
      <div className="min-w-0">
        {crumbs && (
          <div className="flex items-center gap-1 text-xs text-ink-3 mb-1.5">
            {crumbs.map((c, i) => (
              <span key={c} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} />}
                <span className={i === crumbs.length - 1 ? 'text-ink-2' : ''}>{c}</span>
              </span>
            ))}
          </div>
        )}
        <h1 className="text-[26px] leading-8 font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {desc && <p className="text-[13px] text-ink-2 mt-1 max-w-2xl">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: Tone;
  onClick?: () => void;
}) {
  const El = onClick ? 'button' : 'div';
  return (
    <El
      onClick={onClick}
      className={cx(
        'bg-surface border border-line rounded-lg p-4 text-left',
        onClick && 'hover:border-[#c9cfdb] transition-colors cursor-pointer'
      )}
    >
      <div className="text-xs text-ink-2">{label}</div>
      <div className="text-[26px] leading-9 font-semibold tracking-[-0.02em] tnum mt-1 text-ink">
        {value}
      </div>
      {sub && (
        <div
          className={cx(
            'text-xs mt-0.5',
            tone === 'warn' ? 'text-warn' : tone === 'err' ? 'text-err' : 'text-ink-3'
          )}
        >
          {sub}
        </div>
      )}
    </El>
  );
}

export const Avatar = ({ name, size = 28 }: { name: string; size?: number }) => {
  const ini = name
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="rounded-full bg-primary-soft text-primary font-semibold grid place-items-center shrink-0 select-none"
    >
      {ini || 'U'}
    </span>
  );
};

export const Person = ({ name, sub }: { name: string; sub?: string }) => (
  <div className="flex items-center gap-2.5 min-w-0">
    <Avatar name={name} />
    <div className="min-w-0">
      <div className="text-[13px] font-medium text-ink truncate">{name}</div>
      {sub && <div className="text-xs text-ink-3 truncate">{sub}</div>}
    </div>
  </div>
);

export function Progress({ value, label }: { value: number; label?: string }) {
  const safe = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div className="flex items-center gap-2" role="progressbar" aria-valuenow={safe} aria-label={label}>
      <div className="h-1.5 flex-1 bg-[#e9ecf2] rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${safe}%` }} />
      </div>
      <span className="text-xs text-ink-2 tnum w-9 text-right">{safe}%</span>
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const I = toneIcon[tone] ?? Info;
  return (
    <div
      className={cx(
        'flex gap-3 rounded-lg border p-3.5',
        tone === 'warn'
          ? 'bg-warn-soft border-[#efdcb3]'
          : tone === 'err'
          ? 'bg-err-soft border-[#f0c4c4]'
          : tone === 'ok'
          ? 'bg-ok-soft border-[#bfe0d0]'
          : 'bg-info-soft border-[#c5daf4]'
      )}
    >
      <I
        size={16}
        className={cx(
          'mt-0.5 shrink-0',
          tone === 'warn'
            ? 'text-warn'
            : tone === 'err'
            ? 'text-err'
            : tone === 'ok'
            ? 'text-ok'
            : 'text-info'
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-ink">{title}</div>
        {children && <div className="text-xs text-ink-2 mt-0.5 leading-relaxed">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Empty({
  icon: I,
  title,
  desc,
  action,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-6">
      <div className="w-10 h-10 rounded-md bg-[#eef0f4] grid place-items-center text-ink-2 mb-3">
        <I size={18} />
      </div>
      <div className="text-sm font-medium text-ink">{title}</div>
      <p className="text-xs text-ink-2 mt-1 max-w-xs">{desc}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cx('skeleton h-3', className)} />
);

export function LinkRef({ url, label }: { url: string; label?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-[13px] text-info hover:underline max-w-full"
    >
      <ExternalLink size={13} className="shrink-0" />
      <span className="truncate">{label ?? url}</span>
    </a>
  );
}

/* ---------- Form Controls ---------- */
export function Field({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      <span className="block text-xs font-medium text-ink mb-1.5">
        {label}
        {required && <span className="text-err ml-0.5" aria-label="required">*</span>}
      </span>
      {children}
      {error ? (
        <span className="flex items-center gap-1 text-xs text-err mt-1.5">
          <XCircle size={12} />
          {error}
        </span>
      ) : (
        hint && <span className="block text-xs text-ink-3 mt-1.5">{hint}</span>
      )}
    </label>
  );
}

const ctl =
  'w-full h-9 px-3 rounded-md border bg-surface text-[13px] text-ink placeholder:text-ink-3 transition-colors hover:border-[#c9cfdb] focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:bg-bg disabled:text-ink-3';

export const Input = ({
  error,
  className,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) => (
  <input {...p} className={cx(ctl, error ? 'border-err' : 'border-line', className)} />
);

export const Select = ({
  children,
  className,
  ...p
}: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    {...p}
    className={cx(
      ctl,
      'pr-8 appearance-none bg-no-repeat bg-[right_10px_center] bg-[length:12px] border-line cursor-pointer',
      className
    )}
    style={{
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%23697386' stroke-width='2' viewBox='0 0 24 24'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
    }}
  >
    {children}
  </select>
);

export const Textarea = ({
  className,
  ...p
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    {...p}
    className={cx(ctl, 'h-auto py-2 min-h-20 resize-y border-line', className)}
  />
);

export function PasswordInput(p: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...p} type={show ? 'text' : 'password'} className="pr-9" />
      <button
        type="button"
        aria-label={show ? 'Hide password' : 'Show password'}
        onClick={() => setShow(!show)}
        className="absolute right-0 top-0 h-9 w-9 grid place-items-center text-ink-3 hover:text-ink cursor-pointer"
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cx('relative', className)}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
        aria-label={placeholder}
      />
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
}) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer text-[13px] leading-5 text-ink select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="mt-0.5 w-4 h-4 shrink-0 rounded-[4px] border border-[#b9c0cf] bg-surface grid place-items-center peer-checked:bg-primary peer-checked:border-primary peer-focus-visible:outline-2 peer-focus-visible:outline-info peer-focus-visible:outline-offset-2 text-transparent peer-checked:text-white transition-colors">
        <Check size={11} strokeWidth={3.5} />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'w-9 h-5 rounded-full relative transition-colors shrink-0 cursor-pointer',
        checked ? 'bg-primary' : 'bg-[#cbd1dc]'
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow-sm',
          checked ? 'left-[18px]' : 'left-0.5'
        )}
      />
    </button>
  );
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex gap-1 border-b border-line mb-5 overflow-x-auto -mx-1 px-1"
    >
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'h-10 px-3 text-[13px] font-medium whitespace-nowrap border-b-2 -mb-px transition-colors flex items-center gap-1.5 cursor-pointer',
            value === t.id
              ? 'border-primary text-ink'
              : 'border-transparent text-ink-2 hover:text-ink'
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span
              className={cx(
                'text-[11px] px-1.5 rounded tnum',
                value === t.id
                  ? 'bg-primary-soft text-primary font-semibold'
                  : 'bg-[#eef0f4] text-ink-2'
              )}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ---------- Data Table ---------- */
export type Col<T> = {
  key: string;
  head: string;
  render: (r: T) => ReactNode;
  w?: string;
  align?: 'right';
  sortable?: boolean;
  mobile?: 'title' | 'hide' | 'meta';
};

export function DataTable<T extends { id: string | number }>({
  cols,
  rows,
  onRow,
  actions,
  empty,
  loading,
  pageSize = 8,
}: {
  cols: Col<T>[];
  rows: T[];
  onRow?: (r: T) => void;
  actions?: (r: T) => ReactNode;
  empty?: ReactNode;
  loading?: boolean;
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows.length]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const view = rows.slice(page * pageSize, page * pageSize + pageSize);
  const title = cols.find(c => c.mobile === 'title') ?? cols[0];

  if (loading) {
    return (
      <div className="bg-surface border border-line rounded-lg divide-y divide-line">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-6 px-4 h-12">
            <Skeleton className="w-8 h-8 rounded-full" />
            <Skeleton className="w-40" />
            <Skeleton className="w-24 hidden sm:block" />
            <Skeleton className="w-20 hidden md:block" />
            <Skeleton className="w-16 ml-auto" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-surface border border-line rounded-lg overflow-hidden">
      {rows.length === 0 ? (
        empty
      ) : (
        <>
          <div className="hidden md:block overflow-auto max-h-[640px]">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-[#fafbfc]">
                <tr className="border-b border-line">
                  {cols.map(c => (
                    <th
                      key={c.key}
                      style={{ width: c.w }}
                      className={cx(
                        'h-10 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2 whitespace-nowrap',
                        c.align === 'right' && 'text-right'
                      )}
                    >
                      {c.head}
                    </th>
                  ))}
                  {actions && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {view.map(r => (
                  <tr
                    key={r.id}
                    onClick={() => onRow?.(r)}
                    className={cx(
                      'h-[52px] border-b border-line last:border-0 transition-colors',
                      onRow && 'cursor-pointer hover:bg-[#f9fafc]'
                    )}
                  >
                    {cols.map(c => (
                      <td
                        key={c.key}
                        className={cx(
                          'px-4 align-middle text-ink',
                          c.align === 'right' && 'text-right tnum'
                        )}
                      >
                        {c.render(r)}
                      </td>
                    ))}
                    {actions && (
                      <td
                        className="px-2"
                        onClick={e => e.stopPropagation()}
                      >
                        {actions(r)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="md:hidden divide-y divide-line">
            {view.map(r => (
              <li
                key={r.id}
                onClick={() => onRow?.(r)}
                className="p-4 space-y-2.5 active:bg-bg cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium min-w-0 text-ink">{title.render(r)}</div>
                  {actions && <div onClick={e => e.stopPropagation()}>{actions(r)}</div>}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {cols
                    .filter(c => c !== title && c.mobile !== 'hide')
                    .map(c => (
                      <div key={c.key} className="min-w-0">
                        <dt className="text-[11px] text-ink-3">{c.head}</dt>
                        <dd className="text-[13px] mt-0.5 truncate text-ink">{c.render(r)}</dd>
                      </div>
                    ))}
                </dl>
              </li>
            ))}
          </ul>
          {rows.length > pageSize && (
            <div className="flex items-center justify-between px-4 h-12 border-t border-line text-xs text-ink-2">
              <span className="tnum">
                {page * pageSize + 1}–{Math.min(rows.length, (page + 1) * pageSize)} of {rows.length}
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= pages - 1}
                  onClick={() => setPage(page + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const FilterBar = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-2 mb-4">{children}</div>
);

/* ---------- Overlays ---------- */
export function Dialog({
  open,
  onClose,
  title,
  desc,
  children,
  footer,
  tone,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  desc?: string;
  children?: ReactNode;
  footer: ReactNode;
  tone?: 'danger';
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-[#172033]/40 anim-fade"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        className="bg-surface w-full sm:max-w-md rounded-t-xl sm:rounded-lg border border-line shadow-[0_12px_40px_rgba(23,32,51,0.18)] anim-slide overflow-hidden"
      >
        <div className="p-5">
          <h2
            className={cx(
              'text-[17px] font-semibold tracking-[-0.01em] text-ink',
              tone === 'danger' && 'text-err'
            )}
          >
            {title}
          </h2>
          {desc && <p className="text-[13px] text-ink-2 mt-1.5 leading-relaxed">{desc}</p>}
          {children && <div className="mt-4">{children}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-line bg-[#fafbfc]">
          {footer}
        </div>
      </div>
    </div>
  );
}

export function SidePanel({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-[#172033]/30 anim-fade" onClick={onClose}>
      <aside
        role="dialog"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        className="absolute right-0 top-0 bottom-0 w-full sm:w-[440px] bg-surface border-l border-line flex flex-col anim-slide shadow-[-12px_0_40px_rgba(23,32,51,0.1)]"
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line bg-surface">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink truncate">{title}</h2>
            {sub && <p className="text-xs text-ink-2 mt-0.5 truncate">{sub}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="h-8 w-8 grid place-items-center rounded-md hover:bg-[#eef0f4] text-ink-2 cursor-pointer"
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-line bg-[#fafbfc]">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
}

/* ---------- Toasts ---------- */
type ToastT = { id: number; tone: Tone; msg: string };
const ToastCtx = createContext<(msg: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastT[]>([]);
  const push = (msg: string, tone: Tone = 'ok') => {
    const id = Date.now() + Math.random();
    setItems(i => [...i, { id, tone, msg }]);
    setTimeout(() => setItems(i => i.filter(t => t.id !== id)), 4200);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col gap-2 items-end pointer-events-none"
      >
        {items.map(t => {
          const I = toneIcon[t.tone] ?? Info;
          return (
            <div
              key={t.id}
              className="anim-slide pointer-events-auto flex items-center gap-2.5 bg-ink text-white text-[13px] pl-3.5 pr-4 py-2.5 rounded-md shadow-lg max-w-sm"
            >
              <I
                size={15}
                className={
                  t.tone === 'ok'
                    ? 'text-[#5fd3a2]'
                    : t.tone === 'err'
                    ? 'text-[#ff8c8c]'
                    : 'text-[#9cc3f5]'
                }
              />
              {t.msg}
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Timeline & KV ---------- */
export function Timeline({
  items,
}: {
  items: { title: ReactNode; meta: string; body?: ReactNode; tone?: Tone }[];
}) {
  return (
    <ol className="relative">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 pb-5 last:pb-0 relative">
          {i < items.length - 1 && (
            <span className="absolute left-[5px] top-4 bottom-0 w-px bg-line" />
          )}
          <span
            className={cx(
              'w-[11px] h-[11px] rounded-full mt-1 shrink-0 border-2 bg-surface',
              it.tone === 'ok'
                ? 'border-ok'
                : it.tone === 'err'
                ? 'border-err'
                : it.tone === 'warn'
                ? 'border-warn'
                : 'border-primary'
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ink">{it.title}</div>
            <div className="text-xs text-ink-3 mt-0.5">{it.meta}</div>
            {it.body && (
              <div className="text-xs text-ink-2 mt-1.5 leading-relaxed">{it.body}</div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function KV({
  items,
  cols = 2,
}: {
  items: [string, ReactNode][];
  cols?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cx(
        'grid gap-x-8 gap-y-4',
        cols === 1
          ? 'grid-cols-1'
          : cols === 2
          ? 'grid-cols-1 sm:grid-cols-2'
          : 'grid-cols-2 lg:grid-cols-3'
      )}
    >
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-ink-3">{k}</dt>
          <dd className="text-[13px] mt-0.5 break-words text-ink font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
