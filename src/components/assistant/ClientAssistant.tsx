import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Compass, Sparkles, X } from 'lucide-react';
import type { BuddyMood } from './Buddy';
import { Buddy3D, type Buddy3DApi, type BuddyAction } from './Buddy3D';
import { Tour } from './Assistant';
import { useTuckOnScroll } from './useTuckOnScroll';
import { AWAITING_CLIENT_CONTRACT, inr, installmentTotal, type ProjectWorkspace } from '../../lib/sigma';
import { getKolkataDateString } from '../../lib/workingDays';

/**
 * Sigma for the client portal: the same 3D robot, kept calm (no screen-wide stunts).
 * It welcomes first-time clients, explains each page once, and points at what needs them:
 * a contract to accept, drafts to review, files the team asked for, payments due, unread updates.
 * Tips come only from the client's own project data already on screen — nothing is sent anywhere.
 */

type Page = 'dashboard' | 'contracts' | 'deliverables' | 'progress' | 'payments' | 'settings' | 'notifications' | 'support';
interface Tip { key: string; priority: 1 | 2 | 3; mood: BuddyMood; text: string; action?: { label: string; to?: Page; tour?: boolean } }
interface NavGroupLite { label?: string; items: Array<{ id: string; label: string }> }
interface Mem { welcomed?: boolean; seen?: Record<string, boolean>; snooze?: Record<string, number>; closed?: { day: string; keys: string[] }; minimized?: boolean }

export const CLIENT_PAGE_HELP: Record<string, { title: string; text: string }> = {
  dashboard: { title: 'Dashboard', text: 'Your project at a glance: what’s done, what needs you, and what’s due next.' },
  contracts: { title: 'Sign Contract', text: 'Read your contract and accept it here. If something needs changing, you can decline with a reason.' },
  deliverables: { title: 'Deliverables', text: 'Everything we’re making for you. When a draft is ready, open it here and approve it or ask for changes.' },
  progress: { title: 'Progress Tracker', text: 'Milestones and updates — and anything the team needs from you (logos, content, approvals).' },
  payments: { title: 'Billing & Payment', text: 'Your payment milestones and invoices. After paying, add the transfer reference here so we can confirm it.' },
  support: { title: 'Help & support', text: 'Ask a question or report a problem. The IRA team replies here and you get a notification.' },
  notifications: { title: 'Notifications', text: 'Every update from the team in one list. Click one to jump to it.' },
  settings: { title: 'Profile & Organisation', text: 'Your details, password, and (for admins) the people from your company who can sign in.' },
};

const KEY = (id: string) => `sigma-client-buddy:v1:${id}`;
const load = (id: string): Mem => { try { return JSON.parse(localStorage.getItem(KEY(id)) || '{}') as Mem; } catch { return {}; } };
const save = (id: string, m: Mem) => { try { localStorage.setItem(KEY(id), JSON.stringify(m)); } catch { /* storage blocked */ } };

const daysUntil = (d: string, today: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86400000);

function computeTips(ws: ProjectWorkspace | null, projectName: string, unread: number, canPay: boolean, today: string): Tip[] {
  if (!ws) return [];
  const tips: Tip[] = [];
  const c = ws.contracts[0];
  if (c && AWAITING_CLIENT_CONTRACT.includes(c.status)) {
    tips.push({ key: `contract:${c.id}:${c.current_version_no ?? 1}`, priority: 1, mood: 'point', text: `Your contract for ${projectName} is ready. Please read it and accept it so we can get started.`, action: { label: 'Open contract', to: 'contracts' } });
  }
  const reviews = ws.deliverables.filter((d) => d.status === 'Awaiting Client Review');
  if (reviews.length) {
    tips.push({ key: `review:${reviews.map((d) => d.id).join(',')}`, priority: 1, mood: 'happy',
      text: reviews.length === 1 ? `“${reviews[0].name}” is ready for your review. Approve it or ask for changes.` : `${reviews.length} drafts are ready for your review.`,
      action: { label: 'Review now', to: 'deliverables' } });
  }
  const needs = ws.dependencies.filter((d) => ['Requested', 'Pending', 'Rejected', 'Resubmission Required'].includes(d.status));
  if (needs.length) {
    const soon = needs.filter((d) => d.required_by).sort((a, b) => (a.required_by ?? '').localeCompare(b.required_by ?? ''))[0];
    const when = soon?.required_by ? (() => { const n = daysUntil(soon.required_by!, today); return n < 0 ? ' — it’s overdue' : n === 0 ? ' — needed today' : n === 1 ? ' — needed tomorrow' : ` — needed in ${n} days`; })() : '';
    tips.push({ key: `needs:${needs.map((d) => d.id + d.status).join(',')}`, priority: needs.some((d) => d.required_by && d.required_by < today) ? 1 : 2, mood: 'think',
      text: needs.length === 1 ? `The team needs “${needs[0].name}” from you to keep going${when}.` : `The team needs ${needs.length} things from you to keep going${when}.`,
      action: { label: 'See what’s needed', to: 'progress' } });
  }
  const open = ws.installments.filter((i) => !['Paid', 'Cancelled', 'Waived'].includes(i.status));
  const owed = (i: (typeof open)[number]) => Math.max(0, installmentTotal(i) - Number(i.amount_paid || 0));
  const overdue = open.filter((i) => i.status === 'Overdue' || (i.due_date && i.due_date < today && owed(i) > 0));
  if (overdue.length) {
    const sum = overdue.reduce((s, i) => s + owed(i), 0);
    tips.push({ key: `overdue:${overdue.map((i) => i.id).join(',')}`, priority: 1, mood: 'worried',
      text: `${inr(sum)} is past its due date${overdue.length === 1 ? ` (${overdue[0].name})` : ''}.${canPay ? ' Already paid? Add the transfer reference so we can confirm it.' : ' Your organisation’s admin can record the payment.'}`,
      action: { label: 'Open billing', to: 'payments' } });
  } else {
    const next = open.filter((i) => i.due_date && owed(i) > 0 && daysUntil(i.due_date, today) <= 7).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))[0];
    if (next?.due_date) {
      const n = daysUntil(next.due_date, today);
      tips.push({ key: `due:${next.id}:${next.due_date}`, priority: 2, mood: 'think',
        text: `${next.name}: ${inr(owed(next))} is due ${n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`}.`,
        action: { label: 'Open billing', to: 'payments' } });
    }
  }
  if (unread > 0) tips.push({ key: `unread:${unread}`, priority: 3, mood: 'wave', text: `You have ${unread} new update${unread === 1 ? '' : 's'} from the team.`, action: { label: 'Read updates', to: 'notifications' } });
  return tips.sort((a, b) => a.priority - b.priority);
}

export function ClientAssistant(p: {
  userId: string; firstName: string; page: Page; onNavigate: (to: Page) => void; navGroups: NavGroupLite[];
  ws: ProjectWorkspace | null; projectName: string; unread: number; canPay: boolean;
}) {
  const today = getKolkataDateString();
  const [mem, setMem] = useState<Mem>(() => load(p.userId));
  const update = useCallback((fn: (m: Mem) => Mem) => setMem((m) => { const n = fn(m); save(p.userId, n); return n; }), [p.userId]);
  const [view, setView] = useState<'none' | 'bubble' | 'panel' | 'tour'>('none');
  const [tip, setTip] = useState<Tip | null>(null);
  const tips = useMemo(() => computeTips(p.ws, p.projectName, p.unread, p.canPay, today), [p.ws, p.projectName, p.unread, p.canPay, today]);

  const closedToday = mem.closed?.day === today ? mem.closed.keys : [];
  const canShow = (t: Tip) => !closedToday.includes(t.key) && !((mem.snooze?.[t.key] ?? 0) > Date.now());

  // one bubble at a time: welcome first, then the most important thing, then "what's this page" once
  useEffect(() => {
    if (view !== 'none' || mem.minimized) return undefined;
    const t = window.setTimeout(() => {
      if (!mem.welcomed) {
        setTip({ key: 'welcome', priority: 3, mood: 'wave', text: `Hi ${p.firstName}! I’m Sigma. I’ll point out anything that needs you — contracts, drafts to review, payments. Want a quick look around?`, action: { label: 'Show me around', tour: true } });
        setView('bubble'); update((m) => ({ ...m, welcomed: true }));
        return;
      }
      const next = tips.find(canShow);
      if (next) { setTip(next); setView('bubble'); return; }
      const help = CLIENT_PAGE_HELP[p.page];
      if (help && !mem.seen?.[p.page]) {
        setTip({ key: `page:${p.page}`, priority: 3, mood: 'point', text: `${help.title}: ${help.text}` });
        setView('bubble'); update((m) => ({ ...m, seen: { ...(m.seen ?? {}), [p.page]: true } }));
      }
    }, 1200);
    return () => window.clearTimeout(t);
  }, [view, tips, p.page, mem.welcomed, mem.minimized]); // eslint-disable-line react-hooks/exhaustive-deps

  // a tip whose situation is over disappears by itself
  useEffect(() => {
    if (view === 'bubble' && tip && !tip.key.startsWith('page:') && tip.key !== 'welcome' && !tips.some((t) => t.key === tip.key)) { setView('none'); setTip(null); }
  }, [tips, view, tip]);

  const closeTip = (how: 'later' | 'close') => {
    if (tip && !tip.key.startsWith('page:') && tip.key !== 'welcome') {
      const k = tip.key;
      update((m) => how === 'later'
        ? { ...m, snooze: { ...(m.snooze ?? {}), [k]: Date.now() + 3 * 3600000 } }
        : { ...m, closed: { day: today, keys: [...(m.closed?.day === today ? m.closed.keys : []), k] } });
    }
    setTip(null); setView('none');
  };
  const act = (t: Tip) => {
    if (t.action?.tour) { setTip(null); setView('tour'); return; }
    if (t.action?.to) p.onNavigate(t.action.to);
    closeTip('close');
  };

  /* ── the robot's place on screen ── */
  const bot = useRef<Buddy3DApi | null>(null);
  const fab = useRef<HTMLDivElement>(null);
  const RW = mem.minimized ? 76 : 112, RH = mem.minimized ? 90 : 132;
  const home = useCallback(() => {
    const mobile = window.innerWidth < 1024;
    return { x: window.innerWidth - RW - (mobile ? 6 : 14), y: window.innerHeight - RH - (mobile ? 78 : 8) };
  }, [RW, RH]);
  const [pos, setPos] = useState(() => ({ x: typeof window === 'undefined' ? 0 : window.innerWidth - 126, y: typeof window === 'undefined' ? 0 : window.innerHeight - 140 }));
  const [away, setAway] = useState(false);
  useTuckOnScroll(fab, () => view === 'none' && !away);
  useLayoutEffect(() => {
    const f = fab.current; if (!f) return;
    f.style.left = `${pos.x}px`; f.style.top = `${pos.y}px`; f.style.width = `${RW}px`; f.style.height = `${RH}px`;
  }, [pos, RW, RH]);
  const flyTo = useCallback((to: { x: number; y: number }, isHome = false) => {
    const f = fab.current;
    const from = f && f.style.left ? { x: parseFloat(f.style.left), y: parseFloat(f.style.top) } : to;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    setAway(!isHome);
    if (dist < 4) return;
    bot.current?.fly(true, Math.abs(to.x - from.x) < 30 ? 0 : Math.sign(to.x - from.x));
    setPos({ x: to.x, y: to.y });
    window.setTimeout(() => bot.current?.fly(false), Math.min(1400, 500 + dist * .8));
  }, []);
  const flyHome = useCallback(() => flyTo(home(), true), [flyTo, home]);
  const nextTo = (r: DOMRect) => ({ x: Math.min(window.innerWidth - RW - 8, r.right + 6), y: Math.max(8, Math.min(window.innerHeight - RH - 8, r.top + r.height / 2 - RH * .55)) });
  useEffect(() => { if (!away) setPos(home()); }, [RW, RH]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = () => { if (!away) setPos(home()); };
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [away, home]);

  // a tip about another page: fly next to it in the menu and point
  useEffect(() => {
    if (view === 'bubble' && tip?.action?.to && tip.action.to !== p.page) {
      const el = document.querySelector(`[data-tour="${tip.action.to}"]`) as HTMLElement | null;
      if (el && el.offsetParent !== null) { flyTo(nextTo(el.getBoundingClientRect())); return undefined; }
    }
    if (view === 'none' || view === 'panel') { const t = window.setTimeout(flyHome, view === 'none' ? 600 : 0); return () => window.clearTimeout(t); }
    return undefined;
  }, [view, tip?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // body language (calm: no screen-wide stunts)
  useEffect(() => {
    if (view !== 'bubble' || !tip) return;
    const a: Partial<Record<BuddyMood, BuddyAction>> = { wave: 'wave', happy: 'wave', worried: 'worried', think: 'look' };
    const act2 = a[tip.mood];
    if (act2) window.setTimeout(() => bot.current?.play(act2), 900);
  }, [view, tip?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastInput = useRef(Date.now());
  useEffect(() => {
    const mark = () => { lastInput.current = Date.now(); };
    window.addEventListener('pointermove', mark, { passive: true });
    window.addEventListener('keydown', mark);
    const id = window.setInterval(() => {
      if (document.hidden || view !== 'none' || mem.minimized || !bot.current || bot.current.isBusy()) return;
      if (Date.now() - lastInput.current < 45000) return;
      lastInput.current = Date.now(); // a small, polite move about once a minute while idle
      bot.current.play((['look', 'wave', 'stretch'] as BuddyAction[])[Math.floor(Math.random() * 3)]);
    }, 5000);
    return () => { window.clearInterval(id); window.removeEventListener('pointermove', mark); window.removeEventListener('keydown', mark); };
  }, [view, mem.minimized]);

  const allClear = p.ws != null && tips.filter((t) => t.priority <= 2).length === 0;
  const mood: BuddyMood = view === 'tour' ? 'point' : view === 'bubble' && tip ? tip.mood : tips.some((t) => t.priority === 1) ? 'alert' : 'idle';
  const urgent = tips.filter((t) => t.priority <= 2).length;

  const leftHalf = pos.x + RW / 2 < (typeof window === 'undefined' ? 1200 : window.innerWidth) / 2;
  const popStyle: React.CSSProperties = { position: 'absolute' };
  if (!away) { popStyle.right = 4; popStyle.bottom = RH + 4; }
  else { if (leftHalf) popStyle.left = RW + 4; else popStyle.right = RW + 4; popStyle.top = 8; }

  return (
    <div ref={fab} className="buddy-fab print:hidden" data-buddy>
      <div style={popStyle} className="z-[1]">
        {view === 'bubble' && tip && (
          <div role="status" className="buddy-bubble relative w-[min(340px,calc(100vw-24px))] rounded-3xl bg-white shadow-[0_24px_60px_-20px_rgb(30_10_80/0.45)] ring-1 ring-ink-100 p-4">
            <button type="button" onClick={() => closeTip('close')} className="absolute top-2.5 right-2.5 icon-btn !w-8 !h-8" aria-label="Close tip"><X className="w-4 h-4" /></button>
            <p className="pr-7 text-[14px] leading-snug text-ink-800">{tip.text}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {tip.action && <button type="button" onClick={() => act(tip)} className="btn-primary btn-sm">{tip.action.label}</button>}
              {tip.key.startsWith('page:') || tip.key === 'welcome'
                ? <button type="button" onClick={() => closeTip('close')} className="btn-ghost btn-sm">{tip.key === 'welcome' ? 'Not now' : 'Got it'}</button>
                : <button type="button" onClick={() => closeTip('later')} className="btn-ghost btn-sm">Later</button>}
            </div>
          </div>
        )}
        {view === 'panel' && (
          <div role="dialog" aria-label="Sigma helper" className="buddy-bubble relative w-[min(360px,calc(100vw-24px))] max-h-[min(560px,calc(100vh-140px))] overflow-y-auto rounded-3xl bg-white shadow-[0_24px_60px_-20px_rgb(30_10_80/0.45)] ring-1 ring-ink-100">
            <div className="flex items-start gap-3 p-4 pb-2">
              <div className="min-w-0 flex-1">
                <p className="font-display text-[16px] font-bold text-ink-950">Hi {p.firstName}</p>
                <p className="text-[12.5px] text-ink-500">{allClear ? 'Nothing needs you right now — all up to date.' : 'Here’s what needs you.'}</p>
              </div>
              <button type="button" onClick={() => setView('none')} className="icon-btn !w-8 !h-8" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-4 pb-3 space-y-2">
              {tips.length === 0 && <p className="rounded-2xl bg-emerald-50 px-3 py-2.5 text-[13px] text-ink-700 flex items-center gap-2"><Sparkles className="w-4 h-4 text-brand-600" /> You’re all caught up.</p>}
              {tips.map((t) => (
                <button key={t.key} type="button" onClick={() => act(t)} className="w-full text-left rounded-2xl bg-ink-50 hover:bg-ink-100 px-3 py-2.5">
                  <p className="text-[13px] text-ink-800 leading-snug">{t.text}</p>
                  {t.action && <p className="mt-1 text-[12px] font-semibold text-brand-700">{t.action.label} →</p>}
                </button>
              ))}
            </div>
            <div className="border-t border-ink-100 px-4 py-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setView('tour')} className="btn-secondary btn-sm"><Compass className="w-3.5 h-3.5" /> Show me around</button>
              {CLIENT_PAGE_HELP[p.page] && (
                <button type="button" onClick={() => { setTip({ key: `page:${p.page}`, priority: 3, mood: 'point', text: `${CLIENT_PAGE_HELP[p.page].title}: ${CLIENT_PAGE_HELP[p.page].text}` }); setView('bubble'); }} className="btn-ghost btn-sm">What’s this page?</button>
              )}
              <button type="button" onClick={() => { update((m) => ({ ...m, minimized: !m.minimized })); setView('none'); }} className="btn-ghost btn-sm ml-auto">{mem.minimized ? 'Make me bigger' : 'Make me smaller'}</button>
            </div>
          </div>
        )}
      </div>
      {view === 'tour' && (
        <Tour groups={p.navGroups} robotW={RW} help={CLIENT_PAGE_HELP}
          onFocus={(r) => (r ? flyTo(nextTo(r)) : flyHome())}
          onClose={() => setView('none')} />
      )}
      <button
        type="button"
        onClick={() => setView((v) => (v === 'panel' ? 'none' : 'panel'))}
        className="relative block w-full h-full rounded-[28px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
        style={{ zIndex: view === 'tour' ? 75 : undefined }}
        aria-label={`Sigma helper${urgent ? ` — ${urgent} thing${urgent === 1 ? '' : 's'} need you` : ''}`}
        aria-expanded={view === 'panel'}
      >
        <Buddy3D ref={bot} mood={mood} className="absolute inset-0" />
        {urgent > 0 && view !== 'panel' && (
          <span className="absolute top-2 right-3 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[11px] font-bold grid place-items-center ring-2 ring-white">{urgent}</span>
        )}
      </button>
    </div>
  );
}
