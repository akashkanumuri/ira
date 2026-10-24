import React, { useEffect, useRef, useState } from 'react';
import { AuroraPanel } from './AuroraPanel';
import { Login3D, useLoginScene } from './Login3D';

export function AuthLayout({
  eyebrow,
  headline,
  notice,
  brand = 'ira',
  children,
}: {
  eyebrow: string;
  headline: string;
  notice?: string;
  /** 'sigma' = staff sign-in (SIGMA 1 brand + 3D robot scene); 'ira' = client sign-in. */
  brand?: 'sigma' | 'ira';
  children: React.ReactNode;
}) {
  const chosen = useLoginScene();
  const [failed, setFailed] = useState(false);
  const scene = brand === 'sigma' ? (chosen === 'aurora' ? 'sigma' : chosen) : 'aurora';
  if (scene !== 'aurora' && !failed) return <Scene3DLayout scene={scene} brand={brand} onFail={() => setFailed(true)}>{children}</Scene3DLayout>;
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

/** Sign-in page with a live 3D scene: the left panel is a window the scene breaks out of. */
function Scene3DLayout({ scene, brand, onFail, children }: { scene: 'portal' | 'bot' | 'sigma'; brand: 'sigma' | 'ira'; onFail: () => void; children: React.ReactNode }) {
  const deskQ = '(min-width: 1024px)';
  const [desk, setDesk] = useState(() => window.matchMedia(deskQ).matches);
  useEffect(() => { const m = window.matchMedia(deskQ); const on = () => setDesk(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  const panel = useRef<HTMLDivElement>(null), band = useRef<HTMLDivElement>(null), form = useRef<HTMLDivElement>(null);
  const dark = scene === 'portal';
  return (
    <div className={`relative min-h-dvh p-3 lg:p-4 grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-4 ${dark ? 'bg-[#07070d]' : 'bg-[var(--app-bg)]'}`}>
      <Login3D key={`${scene}-${desk}`} scene={scene} frameRef={desk ? panel : band} formRef={form} above={scene === 'bot'} onFail={onFail} />
      <aside ref={panel} className="hidden lg:block relative z-[1] rounded-[32px] min-h-[calc(100dvh-2rem)]">
        {dark && <img src={brand === 'sigma' ? '/brand/sigma1-wordmark-white.svg' : '/ira-logo-wordmark.png'} alt={brand === 'sigma' ? 'SIGMA 1' : 'IRA Hospitality'} className="absolute left-12 top-12 h-9 w-auto object-contain drop-shadow-[0_2px_12px_rgba(0,0,0,.6)]" />}
      </aside>
      <main className="relative z-[1] flex items-center justify-center px-2 py-8 sm:px-8">
        <div className="w-full max-w-[420px] min-w-0">
          <div ref={band} className={`lg:hidden relative rounded-[28px] ${scene === 'bot' ? 'h-44 mb-20' : scene === 'sigma' ? 'h-40 mb-4' : 'h-48 mb-8'}`} />
          <div ref={form} className={`relative rounded-[28px] p-6 sm:p-8 ${dark ? 'bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,.8),0_0_60px_-10px_rgba(139,92,246,.45)]' : 'bg-white shadow-[0_30px_80px_-30px_rgba(20,10,60,.35)] ring-1 ring-ink-100'}`}>
            {brand === 'sigma'
              ? <img src="/brand/sigma1-wordmark.svg" alt="SIGMA 1" className="h-7 w-auto object-contain mb-6" />
              : <img src="/ira-logo-wordmark.png" alt="IRA Hospitality" className="h-9 w-auto object-contain mb-6" />}
            {children}
          </div>
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
