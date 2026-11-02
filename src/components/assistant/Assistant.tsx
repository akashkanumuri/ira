import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Check, ChevronLeft, ChevronRight, Compass, Copy, MapPin, MoonStar, Settings2, Sparkles, X, Zap } from 'lucide-react';
import type { AuthUser } from '../../contexts/AuthContext';
import type { AttendanceRecord, Employee, Holiday, LeaveLedger, LeaveRequest, PayrollPeriod, PayrollRecord, Task, WfhRequest } from '../../types/attendance';
import { Buddy, type BuddyMood } from './Buddy';
import { PAGE_HELP, canAutoShow, computeNudges, loadMemory, saveMemory, type BuddyLevel, type BuddyMemory, type Nudge } from '../../lib/assistant';
import { useWork } from '../work/WorkTracker';
import { useWorkContext } from '../../lib/workContext';
import { fetchLateStatus, type LateStatus } from '../../lib/late';
import { GeoError, distanceM, fetchOffice, fmtDistance, getFix, locationHelp, type OfficeLocation } from '../../lib/officeLocation';
import { isPushOrigin, isPushSupported, subscribeToPush } from '../../lib/pushSubscription';
import { getKolkataDateString } from '../../lib/workingDays';
import { cx } from '../../ui';

interface NavGroupLite { label?: string; items: Array<{ id: string; label: string }> }

export interface AssistantProps {
  user: AuthUser;
  activeTab: string;
  onNavigate: (to: string) => void;
  navGroups: NavGroupLite[];
  managesPeople: boolean;
  ready: boolean;
  attendance: AttendanceRecord[];
  tasks: Task[];
  leaveRequests: LeaveRequest[];
  wfhRequests: WfhRequest[];
  holidays: Holiday[];
  ledgers: LeaveLedger[];
  payrollPeriods: PayrollPeriod[];
  payrollRecords: PayrollRecord[];
  employees: Employee[];
}

type View = 'none' | 'bubble' | 'panel' | 'setup' | 'tour';
type SetupStep = 'welcome' | 'notify' | 'location' | 'awake' | 'tour' | 'done';
const SITE = 'ira-eta-two.vercel.app';
const nowIstTime = () => new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Kolkata' });
const notifPerm = (): NotificationPermission | 'unsupported' => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported');

export function Assistant(p: AssistantProps) {
  const { user } = p;
  const role: 'admin' | 'employee' = user.role === 'admin' ? 'admin' : 'employee';
  const firstName = (user.name || '').split(' ')[0] || 'there';
  const work = useWork();
  const ctx = useWorkContext(role === 'employee' ? user.id : null);

  const [mem, setMem] = useState<BuddyMemory>(() => loadMemory(user.id));
  const update = useCallback((fn: (m: BuddyMemory) => BuddyMemory) => {
    setMem((m) => { const n = fn(m); saveMemory(user.id, n); return n; });
  }, [user.id]);

  const [view, setView] = useState<View>('none');
  const [bubble, setBubble] = useState<Nudge | null>(null);
  const [flash, setFlash] = useState<BuddyMood | null>(null);
  const [tick, setTick] = useState(0);
  const [late, setLate] = useState<LateStatus | null>(null);
  const [perm, setPerm] = useState(notifPerm);
  const today = getKolkataDateString();

  // refresh the clock-based tips every minute and when the tab comes back
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60000);
    const vis = () => { if (document.visibilityState === 'visible') { setPerm(notifPerm()); setTick((t) => t + 1); } };
    document.addEventListener('visibilitychange', vis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, []);

  // late status (employees) — refreshed after each check-in
  useEffect(() => {
    if (role !== 'employee') return undefined;
    let alive = true;
    const load = () => void fetchLateStatus().then((s) => { if (alive) setLate(s); });
    load();
    window.addEventListener('ira:attendance', load);
    return () => { alive = false; window.removeEventListener('ira:attendance', load); };
  }, [role]);

  // react to attendance actions
  useEffect(() => {
    const on = () => { setFlash('wave'); window.setTimeout(() => setFlash(null), 3500); setTick((t) => t + 1); };
    window.addEventListener('ira:attendance', on);
    return () => window.removeEventListener('ira:attendance', on);
  }, []);

  const nudges = useMemo(() => {
    if (!p.ready) return [];
    return computeNudges({
      role, firstName, today, nowTime: nowIstTime(), myId: user.employeeDbId,
      attendance: p.attendance, tasks: p.tasks, leaveRequests: p.leaveRequests, wfhRequests: p.wfhRequests, holidays: p.holidays,
      ledgers: p.ledgers, payrollPeriods: p.payrollPeriods, payrollRecords: p.payrollRecords, employees: p.employees,
      rules: (ctx as any)?.rules ?? null, work: work?.state ?? null, late, notifyPermission: perm, managesPeople: p.managesPeople,
    });
  }, [p.ready, p.attendance, p.tasks, p.leaveRequests, p.wfhRequests, p.holidays, p.ledgers, p.payrollPeriods, p.payrollRecords, p.employees,
    ctx, work?.state, late, perm, p.managesPeople, tick, role, firstName, today, user.employeeDbId]);

  // first time on this laptop: run the setup
  useEffect(() => {
    if (!p.ready || mem.setupDone) return undefined;
    if ((mem.snooze?.setup ?? 0) > Date.now()) return undefined;
    const t = window.setTimeout(() => setView((v) => (v === 'none' || v === 'bubble' ? 'setup' : v)), 1200);
    return () => window.clearTimeout(t);
  }, [p.ready, mem.setupDone, mem.snooze?.setup]);

  // pop one tip at a time
  useEffect(() => {
    if (view !== 'none' || !mem.setupDone) return;
    const next = nudges.find((n) => canAutoShow(n, mem, today));
    if (next) {
      setBubble(next); setView('bubble');
      update((m) => ({ ...m, shown: { day: today, keys: [...(m.shown?.day === today ? m.shown.keys : []), next.key] } }));
      return;
    }
    // first visit to a page: say what it is for (once)
    const help = PAGE_HELP[p.activeTab];
    if (help && !mem.toursDone?.[p.activeTab] && (mem.level ?? 'normal') !== 'quiet' && !mem.minimized) {
      setBubble({ key: `page:${p.activeTab}`, type: 'page', priority: 3, mood: 'point', text: `${help.title}: ${help.text}` });
      setView('bubble');
      update((m) => ({ ...m, toursDone: { ...(m.toursDone ?? {}), [p.activeTab]: true } }));
    }
  }, [nudges, view, mem.setupDone, p.activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // a tip whose situation is over disappears by itself
  useEffect(() => {
    if (view === 'bubble' && bubble && bubble.type !== 'page' && !nudges.some((n) => n.key === bubble.key)) { setView('none'); setBubble(null); }
  }, [nudges, view, bubble]);

  const closeBubble = (how: 'later' | 'close' | 'never') => {
    if (bubble && bubble.type !== 'page') {
      const b = bubble;
      update((m) => ({
        ...m,
        dismissedTypes: { ...(m.dismissedTypes ?? {}), [b.type]: (m.dismissedTypes?.[b.type] ?? 0) + 1 },
        snooze: how === 'later' ? { ...(m.snooze ?? {}), [b.key]: Date.now() + 3 * 3600000 } : m.snooze,
        neverTypes: how === 'never' ? { ...(m.neverTypes ?? {}), [b.type]: true } : m.neverTypes,
      }));
    }
    setBubble(null); setView('none');
  };

  const enableNotifications = useCallback(async (): Promise<string | null> => {
    try {
      if (isPushSupported() && isPushOrigin()) {
        const r = await subscribeToPush(user.id);
        setPerm(notifPerm());
        return r.success ? null : (r.error ?? 'Notifications couldn’t be turned on.');
      }
      if (!('Notification' in window)) return 'This browser doesn’t support notifications.';
      const r = await Notification.requestPermission();
      setPerm(r);
      return r === 'granted' ? null : r === 'denied' ? 'Notifications were blocked.' : 'You closed the prompt — try again.';
    } catch (e) {
      return e instanceof Error ? e.message : 'Notifications couldn’t be turned on.';
    }
  }, [user.id]);

  const doAction = async (n: Nudge) => {
    if (n.action?.kind === 'notifications') {
      const err = await enableNotifications();
      if (err) { setBubble({ ...n, mood: 'worried', text: err, action: { label: 'Show me how', kind: 'setup' } }); return; }
      setFlash('celebrate'); window.setTimeout(() => setFlash(null), 3000);
      setBubble(null); setView('none');
      return;
    }
    if (n.action?.kind === 'setup') { setBubble(null); setView('setup'); return; }
    if (n.action?.to) p.onNavigate(n.action.to);
    setBubble(null); setView('none');
  };

  const mood: BuddyMood = flash ?? (view === 'tour' ? 'point' : view === 'setup' ? 'happy' : view === 'bubble' && bubble ? bubble.mood
    : nudges.some((n) => n.priority === 1) ? 'alert' : 'idle');
  const urgentCount = nudges.filter((n) => n.priority <= 2 && !mem.neverTypes?.[n.type]).length;

  return (
    <div className="buddy-fab print:hidden" data-buddy>
      {view === 'bubble' && bubble && (
        <TipBubble n={bubble} onAction={() => void doAction(bubble)} onLater={() => closeBubble('later')} onClose={() => closeBubble('close')} onNever={() => closeBubble('never')} />
      )}
      {view === 'panel' && (
        <Panel
          firstName={firstName} role={role} nudges={nudges} activeTab={p.activeTab} mem={mem} perm={perm}
          onClose={() => setView('none')} onAction={(n) => void doAction(n)}
          onTour={() => setView('tour')} onSetup={() => setView('setup')}
          onLevel={(level) => update((m) => ({ ...m, level, minimized: false }))}
          onMinimize={() => { update((m) => ({ ...m, minimized: !m.minimized })); setView('none'); }}
          onResetTips={() => update((m) => ({ ...m, neverTypes: {}, dismissedTypes: {}, snooze: {} }))}
        />
      )}
      {view === 'setup' && (
        <Setup
          role={role} firstName={firstName} mem={mem} perm={perm} rules={(ctx as any)?.rules ?? null}
          enableNotifications={enableNotifications}
          onPatch={(patch) => update((m) => ({ ...m, ...patch }))}
          onLater={() => { update((m) => ({ ...m, snooze: { ...(m.snooze ?? {}), setup: Date.now() + 4 * 3600000 } })); setView('none'); }}
          onTour={() => { update((m) => ({ ...m, setupDone: m.setupDone ?? new Date().toISOString() })); setView('tour'); }}
          onDone={() => { update((m) => ({ ...m, setupDone: new Date().toISOString() })); setView('none'); setFlash('celebrate'); window.setTimeout(() => setFlash(null), 3500); }}
        />
      )}
      {view === 'tour' && <Tour groups={p.navGroups} onClose={() => { update((m) => ({ ...m, setupDone: m.setupDone ?? new Date().toISOString() })); setView('none'); }} />}

      <button
        type="button"
        onClick={() => setView((v) => (v === 'panel' ? 'none' : 'panel'))}
        className={cx('buddy-btn relative grid place-items-center', mem.minimized ? 'w-12 h-12' : 'w-[68px] h-[68px]')}
        aria-label={`SIGMA 1 helper${urgentCount ? ` — ${urgentCount} tip${urgentCount === 1 ? '' : 's'}` : ''}`}
        aria-expanded={view === 'panel'}
      >
        <Buddy mood={mood} size={mem.minimized ? 44 : 64} />
        {urgentCount > 0 && view !== 'panel' && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[11px] font-bold grid place-items-center ring-2 ring-white">{urgentCount}</span>
        )}
      </button>
    </div>
  );
}

/* ───────────────────────── tip bubble ───────────────────────── */

function TipBubble({ n, onAction, onLater, onClose, onNever }: { n: Nudge; onAction: () => void; onLater: () => void; onClose: () => void; onNever: () => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <div role="status" className="buddy-bubble absolute bottom-[84px] right-0 w-[min(340px,calc(100vw-24px))] rounded-3xl bg-white shadow-[0_24px_60px_-20px_rgb(30_10_80/0.45)] ring-1 ring-ink-100 p-4">
      <button type="button" onClick={onClose} className="absolute top-2.5 right-2.5 icon-btn !w-8 !h-8" aria-label="Close tip"><X className="w-4 h-4" /></button>
      <p className="pr-7 text-[14px] leading-snug text-ink-800">{n.text}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {n.action && <button type="button" onClick={onAction} className="btn-primary btn-sm">{n.action.label}</button>}
        {n.type !== 'page' && <button type="button" onClick={onLater} className="btn-ghost btn-sm">Later</button>}
        {n.type !== 'page' && n.priority > 1 && (
          <span className="relative ml-auto">
            <button type="button" onClick={() => setMenu((v) => !v)} className="text-[12px] text-ink-400 hover:text-ink-700">More</button>
            {menu && <button type="button" onClick={onNever} className="absolute right-0 bottom-6 whitespace-nowrap rounded-xl bg-white ring-1 ring-ink-100 shadow-lg px-3 py-2 text-[12px] text-ink-700 hover:bg-ink-50">Don’t show tips like this</button>}
          </span>
        )}
        {n.type === 'page' && <button type="button" onClick={onClose} className="btn-ghost btn-sm">Got it</button>}
      </div>
      <span className="absolute -bottom-2 right-7 w-4 h-4 rotate-45 bg-white ring-1 ring-ink-100 [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
    </div>
  );
}

/* ───────────────────────── panel (click the robot) ───────────────────────── */

function Panel({ firstName, role, nudges, activeTab, mem, perm, onClose, onAction, onTour, onSetup, onLevel, onMinimize, onResetTips }: {
  firstName: string; role: 'admin' | 'employee'; nudges: Nudge[]; activeTab: string; mem: BuddyMemory; perm: NotificationPermission | 'unsupported';
  onClose: () => void; onAction: (n: Nudge) => void; onTour: () => void; onSetup: () => void; onLevel: (l: BuddyLevel) => void; onMinimize: () => void; onResetTips: () => void;
}) {
  const help = PAGE_HELP[activeTab];
  const level = mem.level ?? 'normal';
  const setupOk = perm === 'granted' && (role === 'admin' || mem.locationOk !== false);
  return (
    <div role="dialog" aria-label="SIGMA 1 helper" className="buddy-bubble absolute bottom-[84px] right-0 w-[min(380px,calc(100vw-24px))] max-h-[min(640px,calc(100vh-140px))] overflow-y-auto rounded-3xl bg-white shadow-[0_24px_60px_-20px_rgb(30_10_80/0.45)] ring-1 ring-ink-100">
      <div className="sticky top-0 bg-gradient-to-br from-brand-600 to-violet-500 text-white px-5 py-4 flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-white/95 grid place-items-center shrink-0"><Buddy mood="happy" size={44} follow={false} /></div>
        <div className="min-w-0 flex-1">
          <p className="font-display font-bold text-[16px] leading-tight">Hi {firstName}!</p>
          <p className="text-[12px] text-white/80">{nudges.length ? `${nudges.length} thing${nudges.length === 1 ? '' : 's'} for you right now` : 'All clear. Ask me anything below.'}</p>
        </div>
        <button type="button" onClick={onClose} className="w-8 h-8 rounded-full grid place-items-center hover:bg-white/15" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>

      <div className="p-4 space-y-4">
        <section>
          <p className="eyebrow mb-2">For you</p>
          {nudges.length ? (
            <ul className="space-y-2">
              {nudges.map((n) => (
                <li key={n.key} className={cx('rounded-2xl px-3.5 py-3 text-[13px] leading-snug', n.priority === 1 ? 'bg-rose-50 text-rose-900' : n.priority === 2 ? 'bg-amber-50 text-amber-950' : 'bg-ink-50 text-ink-800')}>
                  <p>{n.text}</p>
                  {n.action && <button type="button" onClick={() => onAction(n)} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-bold text-brand-700 hover:underline">{n.action.label} <ChevronRight className="w-3.5 h-3.5" /></button>}
                </li>
              ))}
            </ul>
          ) : <p className="text-[13px] text-ink-500">Nothing needs you right now.</p>}
        </section>

        {help && (
          <section className="rounded-2xl ring-1 ring-ink-100 p-3.5">
            <p className="text-[13px] font-bold text-ink-900">This page: {help.title}</p>
            <p className="mt-1 text-[13px] text-ink-600 leading-snug">{help.text}</p>
          </section>
        )}

        <section className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onTour} className="rounded-2xl ring-1 ring-ink-100 hover:bg-ink-50 px-3 py-3 text-left">
            <Compass className="w-4 h-4 text-brand-600" /><p className="mt-1.5 text-[13px] font-bold text-ink-900">Show me around</p><p className="text-[11.5px] text-ink-500">A 1-minute tour of the menu</p>
          </button>
          <button type="button" onClick={onSetup} className="rounded-2xl ring-1 ring-ink-100 hover:bg-ink-50 px-3 py-3 text-left">
            <Settings2 className="w-4 h-4 text-brand-600" /><p className="mt-1.5 text-[13px] font-bold text-ink-900">Set up this laptop</p>
            <p className={cx('text-[11.5px]', setupOk ? 'text-mint-700' : 'text-rose-600')}>{setupOk ? 'All permissions on' : 'Something needs turning on'}</p>
          </button>
        </section>

        <section>
          <p className="eyebrow mb-2">How chatty should I be?</p>
          <div className="grid grid-cols-3 gap-1.5">
            {([['chatty', 'Chatty', Zap], ['normal', 'Normal', Sparkles], ['quiet', 'Quiet', MoonStar]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" onClick={() => onLevel(id)} aria-pressed={level === id}
                className={cx('rounded-xl px-2 py-2 text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5', level === id ? 'bg-brand-600 text-white' : 'bg-ink-50 text-ink-700 hover:bg-ink-100')}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-500">{level === 'chatty' ? 'Every tip pops up, up to 8 a day.' : level === 'normal' ? 'Only important tips pop up (about 4 a day). The rest wait here.' : 'I stay quiet. Tips wait here until you click me.'}</p>
          <div className="mt-2 flex items-center justify-between text-[12px]">
            <button type="button" onClick={onMinimize} className="text-ink-500 hover:text-ink-800">{mem.minimized ? 'Make me bigger' : 'Make me smaller'}</button>
            {(Object.keys(mem.neverTypes ?? {}).length > 0) && <button type="button" onClick={onResetTips} className="text-ink-500 hover:text-ink-800">Show hidden tips again</button>}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ───────────────────────── setup: everything this laptop needs ───────────────────────── */

function Setup({ role, firstName, mem, perm, rules, enableNotifications, onPatch, onLater, onTour, onDone }: {
  role: 'admin' | 'employee'; firstName: string; mem: BuddyMemory; perm: NotificationPermission | 'unsupported'; rules: any | null;
  enableNotifications: () => Promise<string | null>; onPatch: (p: Partial<BuddyMemory>) => void; onLater: () => void; onTour: () => void; onDone: () => void;
}) {
  const [office, setOffice] = useState<OfficeLocation | null | undefined>(undefined);
  useEffect(() => { let alive = true; void fetchOffice().then((o) => { if (alive) setOffice(o); }); return () => { alive = false; }; }, []);
  const needsLocation = role === 'employee' && Boolean(office?.enabled) && (rules ? rules.location !== 'home' && rules.geofence !== false && rules.attendance !== false : true);
  const steps: SetupStep[] = ['welcome', 'notify', ...(needsLocation ? ['location' as const] : []), ...(role === 'employee' ? ['awake' as const] : []), 'tour', 'done'];
  const [i, setI] = useState(0);
  const step = steps[Math.min(i, steps.length - 1)];
  const next = () => setI((x) => Math.min(x + 1, steps.length - 1));
  const back = () => setI((x) => Math.max(0, x - 1));

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string; steps?: string[] } | null>(null);
  useEffect(() => { setMsg(null); }, [step]);

  const askNotify = async () => {
    setBusy(true);
    const err = await enableNotifications();
    setBusy(false);
    if (err) setMsg({ tone: 'bad', text: err, steps: typeof Notification !== 'undefined' && Notification.permission === 'denied' ? ['Click the lock (or tune) icon at the left of the address bar.', 'Set Notifications to “Allow”.', 'Reload the page.'] : undefined });
    else { setMsg({ tone: 'ok', text: 'Notifications are on. You’ll get progress checks, approvals and alerts even when SIGMA 1 is in the background.' }); }
  };
  const askLocation = async () => {
    setBusy(true);
    try {
      const fix = await getFix();
      onPatch({ locationOk: true });
      if (office?.latitude != null && office.longitude != null) {
        const d = Math.max(0, distanceM(fix, { lat: office.latitude, lng: office.longitude }) - Math.min(fix.accuracy, 100));
        setMsg({ tone: 'ok', text: d <= office.radius_m
          ? `Location works. You’re about ${fmtDistance(d)} from ${office.name} — office check-in will work here.`
          : `Location works. You’re about ${fmtDistance(d)} from ${office.name}; office check-in works within ${fmtDistance(office.radius_m)}, so it will work once you’re there.` });
      } else setMsg({ tone: 'ok', text: 'Location works on this laptop.' });
    } catch (e) {
      onPatch({ locationOk: false });
      const g = e instanceof GeoError ? e : new GeoError('unavailable', 'Your laptop couldn’t work out its location.');
      setMsg({ tone: 'bad', text: g.message, steps: locationHelp(g.kind) });
    } finally { setBusy(false); }
  };

  const notifyOk = perm === 'granted';
  const total = steps.length - 1;
  const pos = Math.min(i, total);

  return (
    <div role="dialog" aria-label="Set up SIGMA 1 on this laptop" className="buddy-bubble absolute bottom-[84px] right-0 w-[min(400px,calc(100vw-24px))] rounded-3xl bg-white shadow-[0_24px_60px_-20px_rgb(30_10_80/0.5)] ring-1 ring-ink-100 overflow-hidden">
      <div className="h-1.5 bg-ink-100"><div className="h-full bg-gradient-to-r from-brand-600 to-violet-400 transition-all" style={{ width: `${(pos / total) * 100}%` }} /></div>
      <div className="p-5">
        {step === 'welcome' && (<>
          <h3 className="font-display text-[19px] font-bold text-ink-950">Hi {firstName}, I’m Sigma 👋</h3>
          <p className="mt-2 text-[14px] text-ink-700 leading-relaxed">I’ll guide you around SIGMA 1 and remind you of what matters — check-in, tasks, leave, holidays and pay. First, let’s get this laptop ready. It takes about a minute.</p>
          <ul className="mt-3 space-y-1.5 text-[13px] text-ink-600">
            <li className="flex gap-2"><BellRing className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />Notifications — so you never miss {role === 'employee' ? 'a progress check or an approval' : 'requests and team alerts'}</li>
            {needsLocation && <li className="flex gap-2"><MapPin className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />Location — checked once, only when you check in at the office</li>}
            {role === 'employee' && <li className="flex gap-2"><Zap className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />Keep SIGMA 1 awake — so your task time keeps counting</li>}
            <li className="flex gap-2"><Compass className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />A quick tour of the menu</li>
          </ul>
        </>)}

        {step === 'notify' && (<>
          <h3 className="font-display text-[18px] font-bold text-ink-950 flex items-center gap-2"><BellRing className="w-5 h-5 text-brand-600" />Turn on notifications</h3>
          <p className="mt-2 text-[14px] text-ink-700 leading-relaxed">
            {role === 'employee'
              ? 'While a task timer runs I’ll ask a quick “How’s it going?” every 45–75 minutes — miss it and the timer stops. Notifications make sure you see it, plus approvals, late warnings and messages.'
              : 'You’ll be alerted about leave and WFH requests, hand-ins to review, client payments and your team’s check-ins.'}
          </p>
          <p className="mt-2 text-[12.5px] text-ink-500">Your browser will ask — choose <b>Allow</b>.</p>
          {notifyOk && !msg && <Ok text="Notifications are already on for this laptop." />}
        </>)}

        {step === 'location' && (<>
          <h3 className="font-display text-[18px] font-bold text-ink-950 flex items-center gap-2"><MapPin className="w-5 h-5 text-brand-600" />Allow your location</h3>
          <p className="mt-2 text-[14px] text-ink-700 leading-relaxed">Office check-in confirms you’re within {fmtDistance(office?.radius_m)} of {office?.name || 'the office'}. Your location is read <b>once, only when you check in</b> — never tracked during the day.</p>
          <p className="mt-2 text-[12.5px] text-ink-500">Keep Wi-Fi switched on (even on a phone hotspot) so the laptop can find itself. Your browser will ask — choose <b>Allow</b>.</p>
        </>)}

        {step === 'awake' && (<>
          <h3 className="font-display text-[18px] font-bold text-ink-950 flex items-center gap-2"><Zap className="w-5 h-5 text-brand-600" />Keep SIGMA 1 awake</h3>
          <p className="mt-2 text-[14px] text-ink-700 leading-relaxed">If your laptop sleeps or Chrome puts this tab to sleep, the task timer stops after 10 minutes. Two quick things:</p>
          <ol className="mt-2 list-decimal pl-5 space-y-1 text-[13px] text-ink-700">
            <li>In Chrome open <b>Settings → Performance</b>, find <b>“Always keep these sites active”</b>, click <b>Add</b> and paste <CopySite />.</li>
            <li>Keep the laptop lid open while a task timer is running.</li>
          </ol>
        </>)}

        {step === 'tour' && (<>
          <h3 className="font-display text-[18px] font-bold text-ink-950 flex items-center gap-2"><Compass className="w-5 h-5 text-brand-600" />Want a quick tour?</h3>
          <p className="mt-2 text-[14px] text-ink-700 leading-relaxed">I’ll point at each part of the menu and tell you what it’s for. About a minute. You can always ask again by clicking me.</p>
        </>)}

        {step === 'done' && (<>
          <h3 className="font-display text-[19px] font-bold text-ink-950">You’re all set 🎉</h3>
          <p className="mt-2 text-[14px] text-ink-700 leading-relaxed">I’ll sit here in the corner. I’ll pop up when something matters — and you can click me any time for tips, a tour, or to make me quieter.</p>
        </>)}

        {msg && (msg.tone === 'ok' ? <Ok text={msg.text} /> : (
          <div className="mt-3 rounded-2xl bg-rose-50 px-3.5 py-3 text-[13px] text-rose-900">
            <p className="font-semibold">{msg.text}</p>
            {msg.steps && <ol className="mt-1.5 list-decimal pl-4 space-y-0.5 text-rose-800">{msg.steps.map((s) => <li key={s}>{s}</li>)}</ol>}
          </div>
        ))}

        <div className="mt-4 flex items-center gap-2">
          {i > 0 && step !== 'done' && <button type="button" onClick={back} className="icon-btn !w-9 !h-9" aria-label="Back"><ChevronLeft className="w-4 h-4" /></button>}
          {step === 'welcome' && <><button type="button" onClick={next} className="btn-primary">Let’s go</button><button type="button" onClick={onLater} className="btn-ghost">Later</button></>}
          {step === 'notify' && (notifyOk
            ? <button type="button" onClick={next} className="btn-primary">Next</button>
            : <><button type="button" onClick={() => void askNotify()} disabled={busy} className="btn-primary">{busy ? 'Waiting…' : 'Allow notifications'}</button><button type="button" onClick={next} className="btn-ghost">Skip</button></>)}
          {step === 'location' && (mem.locationOk && msg?.tone === 'ok'
            ? <button type="button" onClick={next} className="btn-primary">Next</button>
            : <><button type="button" onClick={() => void askLocation()} disabled={busy} className="btn-primary">{busy ? 'Finding you…' : 'Allow location'}</button><button type="button" onClick={next} className="btn-ghost">Skip</button></>)}
          {step === 'awake' && <><button type="button" onClick={() => { onPatch({ keepActiveDone: true }); next(); }} className="btn-primary">Done</button><button type="button" onClick={next} className="btn-ghost">Skip</button></>}
          {step === 'tour' && <><button type="button" onClick={onTour} className="btn-primary">Show me</button><button type="button" onClick={next} className="btn-ghost">No thanks</button></>}
          {step === 'done' && <button type="button" onClick={onDone} className="btn-primary">Start using SIGMA 1</button>}
          <span className="ml-auto text-[11.5px] text-ink-400">{pos + 1} / {total + 1}</span>
        </div>
      </div>
    </div>
  );
}

function Ok({ text }: { text: string }) {
  return <div className="mt-3 rounded-2xl bg-mint-50 px-3.5 py-3 text-[13px] text-mint-800 flex gap-2"><Check className="w-4 h-4 shrink-0 mt-0.5" />{text}</div>;
}

function CopySite() {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" onClick={() => { void navigator.clipboard?.writeText(SITE).then(() => { setOk(true); window.setTimeout(() => setOk(false), 1800); }); }}
      className="inline-flex items-center gap-1 rounded-lg bg-ink-100 px-1.5 py-0.5 font-mono text-[12px] text-ink-800 hover:bg-ink-200">
      {SITE} {ok ? <Check className="w-3 h-3 text-mint-700" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

/* ───────────────────────── tour: point at each menu item ───────────────────────── */

function Tour({ groups, onClose }: { groups: NavGroupLite[]; onClose: () => void }) {
  const items = useMemo(() => groups.flatMap((g) => g.items).filter((it) => PAGE_HELP[it.id]), [groups]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const it = items[i];
  const raf = useRef(0);

  useEffect(() => {
    const measure = () => {
      const el = it ? document.querySelector(`[data-tour="${it.id}"]`) as HTMLElement | null : null;
      if (el && el.offsetParent !== null) { el.scrollIntoView({ block: 'nearest' }); setRect(el.getBoundingClientRect()); } else setRect(null);
    };
    measure();
    const on = () => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(measure); };
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('resize', on); cancelAnimationFrame(raf.current); };
  }, [it]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') setI((x) => Math.min(items.length - 1, x + 1)); if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1)); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [items.length, onClose]);

  if (!it) return null;
  const help = PAGE_HELP[it.id];
  const last = i === items.length - 1;
  const cardStyle: React.CSSProperties = rect
    ? { position: 'fixed', left: Math.min(rect.right + 18, window.innerWidth - 340), top: Math.max(12, Math.min(rect.top + rect.height / 2 - 70, window.innerHeight - 200)), zIndex: 71 }
    : { position: 'fixed', left: '50%', top: '40%', transform: 'translate(-50%, -50%)', zIndex: 71 };

  return (
    <>
      {rect ? <div className="buddy-spot" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />
        : <div className="fixed inset-0 z-[70] bg-ink-950/40" />}
      <div role="dialog" aria-label="Tour" style={cardStyle} className="buddy-bubble w-[min(320px,calc(100vw-24px))] rounded-3xl bg-white shadow-2xl ring-1 ring-ink-100 p-4">
        <div className="flex items-start gap-3">
          <Buddy mood="point" size={52} follow={false} />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-brand-600">{i + 1} of {items.length}</p>
            <p className="font-display text-[16px] font-bold text-ink-950">{it.label}</p>
            <p className="mt-1 text-[13px] text-ink-700 leading-snug">{help.text}</p>
            {!rect && <p className="mt-1 text-[11.5px] text-ink-500">Find it in the menu.</p>}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {i > 0 && <button type="button" onClick={() => setI(i - 1)} className="icon-btn !w-9 !h-9" aria-label="Back"><ChevronLeft className="w-4 h-4" /></button>}
          <button type="button" onClick={() => (last ? onClose() : setI(i + 1))} className="btn-primary btn-sm">{last ? 'Finish' : 'Next'}</button>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm ml-auto">Skip tour</button>
        </div>
      </div>
    </>
  );
}
