import React from 'react';

/** Decorative only — a calm calendar-like rhythm, no data. */
const PATTERN = [
  'i', 'i', 'b', 'b', 'b', 'm', 'i',
  'b', 'b', 'd', 'b', 'b', 'i', 'i',
  'b', 'm', 'b', 'b', 'i', 'b', 'd',
  'b', 'b', 'b', 'b', 'b', 'm', 'i',
  'b', 'b', 'b', 'b', 'i', 'i', 'i',
];
const DOT: Record<string, string> = {
  b: 'bg-brand-600',
  m: 'bg-mint-400',
  d: 'bg-white',
  i: 'bg-white/[0.06]',
};

export function AuthLayout({
  eyebrow,
  headline,
  notice,
  children,
}: {
  eyebrow: string;
  headline: string;
  notice?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[var(--app-bg)] p-3 lg:p-4 grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-4">
      <aside className="hidden lg:flex relative overflow-hidden rounded-[32px] bg-ink-950 text-white p-12 flex-col justify-between">
        <img src="/ira-logo-wordmark.png" alt="IRA Hospitality" className="h-11 w-auto object-contain object-left self-start" />

        <div className="relative z-[1] max-w-md">
          <p className="eyebrow !text-white/50">{eyebrow}</p>
          <h1 className="mt-4 font-display text-[44px] leading-[1.05] font-bold tracking-[-0.03em]">{headline}</h1>
        </div>

        <div className="relative z-[1] flex items-end justify-between gap-8">
          <p className="text-xs text-white/50 leading-relaxed max-w-[260px]">
            {notice ?? 'Accounts are created by your administrator. There is no public registration.'}
          </p>
          <div aria-hidden className="grid grid-cols-7 gap-2 shrink-0">
            {PATTERN.map((t, i) => (
              <span key={i} className={`rise w-7 h-7 rounded-full ${DOT[t]}`} style={{ ['--i' as any]: i * 0.6 }} />
            ))}
          </div>
        </div>
      </aside>

      <main className="flex items-center justify-center px-2 py-8 sm:px-8">
        <div className="w-full max-w-[400px] min-w-0">
          <img src="/ira-logo-wordmark.png" alt="IRA Hospitality" className="lg:hidden h-10 w-auto object-contain mb-10" />
          {children}
        </div>
      </main>
    </div>
  );
}

export function AuthField({
  icon,
  trailing,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & { icon: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <label className="relative flex items-center">
      <span className="absolute left-4 text-ink-400 pointer-events-none">{icon}</span>
      <input {...input} className={`input !min-h-[52px] !rounded-2xl !pl-12 ${trailing ? '!pr-12' : ''}`} />
      {trailing && <span className="absolute right-2">{trailing}</span>}
    </label>
  );
}
