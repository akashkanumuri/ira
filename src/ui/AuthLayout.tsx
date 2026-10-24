import React from 'react';
import { AuroraPanel } from './AuroraPanel';

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
      <aside className="hidden lg:flex relative overflow-hidden rounded-[32px] bg-[#06060f] text-white p-12 flex-col justify-between min-h-[calc(100dvh-2rem)]">
        <AuroraPanel />
        <img src="/ira-logo-wordmark.png" alt="IRA Hospitality" className="relative z-[3] h-11 w-auto object-contain object-left self-start drop-shadow-[0_2px_12px_rgba(0,0,0,.5)]" />
        <div className="relative z-[3] flex items-end justify-between gap-8">
          <div className="max-w-sm">
            <p className="eyebrow !text-white/50">{eyebrow}</p>
            <h1 className="mt-2 font-display text-[26px] leading-[1.15] font-bold tracking-[-0.02em] text-white/95">{headline}</h1>
          </div>
          <p className="text-xs text-white/45 leading-relaxed max-w-[220px] text-right">
            {notice ?? 'Accounts are created by your administrator. There is no public registration.'}
          </p>
        </div>
      </aside>

      <main className="flex items-center justify-center px-2 py-8 sm:px-8">
        <div className="w-full max-w-[400px] min-w-0">
          <div className="lg:hidden relative overflow-hidden rounded-[28px] h-40 mb-8 flex items-end p-5 bg-[#06060f]">
            <AuroraPanel compact />
            <img src="/ira-logo-wordmark.png" alt="IRA Hospitality" className="relative z-[3] h-9 w-auto object-contain" />
            <span className="relative z-[3] ml-auto text-[11px] font-semibold tracking-[0.2em] uppercase text-white/60">{eyebrow.split('·').pop()?.trim()}</span>
          </div>
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
