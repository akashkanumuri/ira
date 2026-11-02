import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Check, ChevronLeft, ChevronRight, Compass, Copy, MapPin, MoonStar, Settings2, Sparkles, X, Zap } from 'lucide-react';
import type { AuthUser } from '../../contexts/AuthContext';
import type { AttendanceRecord, Employee, Holiday, LeaveLedger, LeaveRequest, PayrollPeriod, PayrollRecord, Task, WfhRequest } from '../../types/attendance';
import { Buddy, type BuddyMood } from './Buddy';
import { Buddy3D, type Buddy3DApi, type BuddyAction } from './Buddy3D';
import { IDLE_STUNTS, createStage, type Stage, type StuntName } from './stunts';
import { PAGE_HELP, canAutoShow, computeNudges, loadMemory, saveMemory, type BuddyLevel, type BuddyMemory, type Nudge } from '../../lib/assistant';
import { useWork } from '../work/WorkTracker';
import { useWorkContext } from '../../lib/workContext';
import { fetchLateStatus, type LateStatus } from '../../lib/late';
import { GeoError, distanceM, fetchOffice, fmtDistance, getFix, locationHelp, type OfficeLocation } from '../../lib/officeLocation';
import { isPushOrigin, isPushSupported, subscribeToPush } from '../../lib/pushSubscription';
import { getKolkataDateString } from '../../lib/workingDays';
import { cx } from '../../ui';
import { supabase } from '../../lib/supabase';

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
  const [sleeping, setSleeping] = useState(false);   // nodded off after 2 min of nobody touching the page
  const [stunting, setStunting] = useState(false);   // a screen-wide stunt is running (tips wait)
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

  // smart insights worked out in the database from this person's own history (and their team's, for managers/admins)
  const [insights, setInsights] = useState<Nudge[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data, error } = await (supabase as any).rpc('assistant_insights');
        if (!alive || error || !Array.isArray(data)) return;
        setInsights(data.map((d: any) => ({ key: d.key, type: d.type, priority: Number(d.priority) as 1 | 2 | 3, mood: d.mood as BuddyMood, text: d.text,
          action: d.to ? { label: d.label || 'Open', to: d.to } : undefined })));
      } catch { /* older database: no insights yet */ }
    };
    void load();
    const id = window.setInterval(() => void load(), 10 * 60000);
    const on = () => void load();
    window.addEventListener('ira:attendance', on);
    return () => { alive = false; window.clearInterval(id); window.removeEventListener('ira:attendance', on); };
  }, []);

  // react to attendance actions
  useEffect(() => {
    const on = () => { setFlash('wave'); window.setTimeout(() => setFlash(null), 3500); setTick((t) => t + 1); };
    window.addEventListener('ira:attendance', on);
    return () => window.removeEventListener('ira:attendance', on);
  }, []);

  const nudges = useMemo(() => {
    if (!p.ready) return [];
    return [...insights, ...computeNudges({
      role, firstName, today, nowTime: nowIstTime(), myId: user.employeeDbId,
      attendance: p.attendance, tasks: p.tasks, leaveRequests: p.leaveRequests, wfhRequests: p.wfhRequests, holidays: p.holidays,
      ledgers: p.ledgers, payrollPeriods: p.payrollPeriods, payrollRecords: p.payrollRecords, employees: p.employees,
      rules: (ctx as any)?.rules ?? null, work: work?.state ?? null, late, notifyPermission: perm, managesPeople: p.managesPeople,
    })].sort((a, b) => a.priority - b.priority);
  }, [insights, p.ready, p.attendance, p.tasks, p.leaveRequests, p.wfhRequests, p.holidays, p.ledgers, p.payrollPeriods, p.payrollRecords, p.employees,
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
    if (view !== 'none' || !mem.setupDone || stunting || sleeping) return;
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
  }, [nudges, view, mem.setupDone, p.activeTab, stunting, sleeping]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const mood: BuddyMood = flash ?? (sleeping && view === 'none' ? 'sleepy' : view === 'tour' ? 'point' : view === 'setup' ? 'happy' : view === 'bubble' && bubble ? bubble.mood
    : nudges.some((n) => n.priority === 1) ? 'alert' : 'idle');
  const urgentCount = nudges.filter((n) => n.priority <= 2 && !mem.neverTypes?.[n.type]).length;

  /* ───── flying: the robot moves to what it is talking about, then flies home ───── */
  const bot = useRef<Buddy3DApi | null>(null);
  const fab = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const RW = mem.minimized ? 76 : 112, RH = mem.minimized ? 90 : 132;
  const floorY = () => window.innerHeight - (window.innerWidth < 1024 ? 78 : 8);
  const homePos = useCallback(() => {
    const W = window.innerWidth, H = window.innerHeight;
    if (mem.homeAt) return { x: Math.max(6, Math.min(W - RW - 6, mem.homeAt.fx * W)), y: Math.max(6, Math.min(H - RH - 6, mem.homeAt.fy * H)) };
    const mobile = W < 1024;
    return { x: W - RW - (mobile ? 6 : 14), y: H - RH - (mobile ? 78 : 8) };
  }, [RW, RH, mem.homeAt?.fx, mem.homeAt?.fy]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pos, setPos] = useState(() => ({ x: typeof window === 'undefined' ? 0 : window.innerWidth - 126, y: typeof window === 'undefined' ? 0 : window.innerHeight - 140 }));
  const [away, setAway] = useState(false);
  const posRef = useRef(pos); posRef.current = pos;
  // position is written straight to the element so the stunt scripts and React never fight over it
  useLayoutEffect(() => {
    const f = fab.current; if (!f || stage.current?.busy()) return;
    f.style.left = `${pos.x}px`; f.style.top = `${pos.y}px`; f.style.width = `${RW}px`; f.style.height = `${RH}px`;
  }, [pos, RW, RH]);
  const flyTimer = useRef(0);
  const flyTo = useCallback((to: { x: number; y: number }, isHome = false) => {
    if (stage.current?.busy()) stage.current.abort(false);
    const f = fab.current;
    const from = f && f.style.left ? { x: parseFloat(f.style.left) || 0, y: parseFloat(f.style.top) || 0 } : posRef.current;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    setAway(!isHome);
    if (dist < 4) return;
    const dir = Math.abs(to.x - from.x) < 30 ? 0 : Math.sign(to.x - from.x);
    bot.current?.fly(true, dir);
    setPos({ x: to.x, y: to.y });
    window.clearTimeout(flyTimer.current);
    flyTimer.current = window.setTimeout(() => bot.current?.fly(false), Math.min(1400, 500 + dist * .8));
  }, []);
  const flyHome = useCallback(() => flyTo(homePos(), true), [flyTo, homePos]);
  useEffect(() => { if (!away && !stage.current?.busy()) flyHome(); }, [RW, RH, mem.homeAt?.fx, mem.homeAt?.fy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = () => { if (!away && !stage.current?.busy()) setPos(homePos()); };
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [away, homePos]);
  const nextTo = (r: DOMRect) => ({ x: Math.min(window.innerWidth - RW - 8, r.right + 6), y: Math.max(8, Math.min(window.innerHeight - RH - 8, r.top + r.height / 2 - RH * .55)) });

  // the stunt stage (screen-wide flights, props, effects, drag and throw)
  const homeRef = useRef(homePos); homeRef.current = homePos;
  const sizeRef = useRef({ w: RW, h: RH }); sizeRef.current = { w: RW, h: RH };
  useEffect(() => {
    const s = createStage({
      fab: () => fab.current, bot: () => bot.current, size: () => sizeRef.current, home: () => homeRef.current(), floor: floorY,
      commit: (pt, isAway) => { setAway(isAway); setPos({ x: pt.x, y: pt.y }); },
      onBusy: (b) => setStunting(b),
      onDrop: (pt) => { update((m) => ({ ...m, homeAt: { fx: pt.x / window.innerWidth, fy: pt.y / window.innerHeight } })); setAway(false); setPos({ x: pt.x, y: pt.y }); },
    });
    stage.current = s;
    return () => { s.dispose(); stage.current = null; };
  }, [update]);

  // a tip about another page: fly next to that page in the menu and point at it
  useEffect(() => {
    if (view === 'bubble' && bubble?.action?.to) {
      const tab = bubble.action.to.split('?')[0];
      const el = document.querySelector(`[data-tour="${tab}"]`) as HTMLElement | null;
      if (el && el.offsetParent !== null && tab !== p.activeTab) { flyTo(nextTo(el.getBoundingClientRect())); return; }
    }
    if (stage.current?.busy()) return undefined;
    if (view === 'none' || view === 'panel' || view === 'setup') { const t = window.setTimeout(() => { if (!stage.current?.busy()) flyHome(); }, view === 'none' ? 700 : 0); return () => window.clearTimeout(t); }
    return undefined;
  }, [view, bubble?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // react with the body, not just the face
  useEffect(() => {
    if (view !== 'bubble' || !bubble) return;
    const a: Record<string, BuddyAction> = { worried: 'worried', celebrate: 'dance', happy: 'wave', wave: 'wave', alert: 'knock', think: 'look' };
    const act = a[bubble.mood];
    if (act) window.setTimeout(() => { if (!stage.current?.busy()) bot.current?.play(act); }, 900);
  }, [view, bubble?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (stage.current?.busy()) return;
    if (flash === 'wave') bot.current?.play('wave');
    if (flash === 'celebrate') bot.current?.play('celebrate');
  }, [flash]);

  /* ───── reactions to the real day ───── */
  const memRef = useRef(mem); memRef.current = mem;
  const viewRef = useRef(view); viewRef.current = view;
  const react = useCallback((name: StuntName) => {
    const b = bot.current, st = stage.current, m = memRef.current;
    if (!b || !st || !b.is3D() || m.minimized || (m.level ?? 'normal') === 'quiet' || document.hidden) return;
    const roam = viewRef.current === 'none' || viewRef.current === 'bubble';
    if (st.busy()) st.abort(false);
    if (!roam && name === 'bye') { b.play('bye'); return; }
    void st.run(!roam && name === 'victory' ? 'cannon' : name);
  }, []);
  const markDayFx = useCallback((k: string) => update((m) => ({ ...m, dayFx: { day: today, done: [...(m.dayFx?.day === today ? m.dayFx.done : []), k] } })), [update, today]);
  // check-in (on time → fireworks + victory lap; late → facepalm) and check-out (packs the bag, waves bye)
  const myToday = user.employeeDbId ? p.attendance.find((a) => a.employeeId === user.employeeDbId && a.date === today) : undefined;
  const prevAtt = useRef<{ in?: string; out?: string } | null>(null);
  useEffect(() => {
    if (!p.ready || !user.employeeDbId) return;
    const cur = { in: myToday?.checkIn, out: myToday?.checkOut };
    const prev = prevAtt.current; prevAtt.current = cur;
    if (!prev) return;
    const fresh = (iso?: string) => !iso || Date.now() - Date.parse(iso) < 5 * 60000; // not an old record that just finished loading
    if (!prev.in && cur.in && fresh(myToday?.checkInIso)) {
      void fetchLateStatus().then((s) => {
        const lateToday = Boolean(s?.enabled && !s.never_late && s.marks?.some((m) => m.date === today));
        react(lateToday ? 'facepalm' : 'victory');
      });
    } else if (!prev.out && cur.out && fresh(myToday?.checkOutIso)) { markDayFx('bye'); react('bye'); }
  }, [p.ready, myToday?.checkIn, myToday?.checkOut]); // eslint-disable-line react-hooks/exhaustive-deps
  // a task handed in (or approved) → confetti cannon; nothing left open → DJ set
  const prevTasks = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!p.ready || !user.employeeDbId) return;
    const mine = p.tasks.filter((t) => t.assignedTo === user.employeeDbId && !t.archivedAt);
    const m = new Map(mine.map((t) => [t.id, t.status as string]));
    const prev = prevTasks.current; prevTasks.current = m;
    if (!prev) return;
    const DONE = ['awaiting_review', 'completed'];
    const handed = mine.some((t) => prev.has(t.id) && DONE.includes(t.status) && !DONE.includes(prev.get(t.id) ?? ''));
    if (!handed) return;
    const open = mine.filter((t) => ['assigned', 'accepted', 'in_progress', 'revision_required', 'blocked'].includes(t.status)).length;
    react(open === 0 ? 'dj' : 'cannon');
  }, [p.ready, p.tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ───── idle: every ~30 s it does something crazy; after 2 min it falls asleep ───── */
  const lastInput = useRef(Date.now());
  const lastGag = useRef(Date.now());
  const gap = useRef(30000);
  const bag = useRef<string[]>([]);
  const sleepingRef = useRef(false); sleepingRef.current = sleeping;
  useEffect(() => {
    const mark = (e: Event) => {
      lastInput.current = Date.now();
      if (sleepingRef.current) { sleepingRef.current = false; setSleeping(false); window.setTimeout(() => bot.current?.play('startle'), 40); }
      // a click, key or wheel on the page stops a running stunt (the robot lets clicks through while performing)
      if (e.type !== 'pointermove' && stage.current?.busy() && !stage.current.dragging() && !fab.current?.contains(e.target as Node)) stage.current.abort();
    };
    const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    evs.forEach((ev) => window.addEventListener(ev, mark, { passive: true }));
    return () => evs.forEach((ev) => window.removeEventListener(ev, mark));
  }, []);
  useEffect(() => {
    const ist = () => ({ hm: nowIstTime().slice(0, 5), wd: new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Kolkata' }) });
    const dueDayFx = (): StuntName | null => {
      const { hm, wd } = ist(); const m = memRef.current;
      const done = m.dayFx?.day === today ? m.dayFx.done : [];
      if (hm >= '20:00' && !done.includes('bye')) return 'bye';
      if (wd === 'Fri' && hm >= '17:00' && !done.includes('party')) return 'party';
      if (hm >= '13:00' && hm < '14:30' && !done.includes('lunch')) return 'lunch';
      if (wd === 'Mon' && hm >= '09:00' && hm < '12:00' && !done.includes('coffee')) return 'coffee';
      return null;
    };
    const isTyping = () => { const a = document.activeElement as HTMLElement | null; return Boolean(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)); };
    const modalOpen = () => Boolean(document.querySelector('[aria-modal="true"], .ira-modal-overlay, .fixed.inset-0.z-50'));
    const nextGag = () => {
      if (!bag.current.length) {
        const all = [...IDLE_STUNTS, 'dance', 'juggle', 'backflip', 'visit'];
        for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
        bag.current = all;
      }
      return bag.current.shift() as string;
    };
    const id = window.setInterval(() => {
      const b = bot.current, st = stage.current;
      if (!b || !st) return;
      const { hm, wd } = ist();
      b.prop('hat', wd === 'Fri' && hm >= '17:00'); // party hat all Friday evening
      const quiet = (mem.level ?? 'normal') === 'quiet' || mem.minimized;
      if (quiet || !b.is3D() || (view !== 'none' && view !== 'bubble') || document.hidden || st.busy() || b.isBusy() || modalOpen()) return;
      const idleFor = Date.now() - lastInput.current;
      if (idleFor > 120000) { if (!sleepingRef.current && view === 'none') { sleepingRef.current = true; setSleeping(true); } return; }
      if (sleepingRef.current || idleFor < 30000 || Date.now() - lastGag.current < gap.current) return;
      lastGag.current = Date.now(); gap.current = 25000 + Math.random() * 15000;
      if (isTyping()) { b.play((['dance', 'juggle', 'spin', 'stretch', 'moonwalk'] as BuddyAction[])[Math.floor(Math.random() * 5)]); return; }
      const due = dueDayFx();
      if (due) { markDayFx(due); void st.run(due); return; }
      const g = nextGag();
      if (g === 'visit') {
        // pops over to the menu, peeks at a random page, comes back
        const items = Array.from(document.querySelectorAll('[data-tour]')).filter((e) => (e as HTMLElement).offsetParent !== null);
        const el = items[Math.floor(Math.random() * items.length)] as HTMLElement | undefined;
        if (!el) return;
        flyTo(nextTo(el.getBoundingClientRect()));
        window.setTimeout(() => bot.current?.play('peek'), 1400);
        window.setTimeout(() => { if (viewRef.current === 'none' || viewRef.current === 'bubble') flyHome(); }, 5200);
      } else if ((IDLE_STUNTS as string[]).includes(g)) void st.run(g as StuntName);
      else b.play(g as BuddyAction);
    }, 2000);
    return () => window.clearInterval(id);
  }, [mem.level, mem.minimized, view, flyTo, flyHome, today, markDayFx]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ───── play: click = panel, double-click = backflip, poke 5× = it falls apart; drag & throw ───── */
  const clicks = useRef(0);
  const clickTimer = useRef(0);
  const dragged = useRef(false);
  const onBotClick = (e: React.MouseEvent) => {
    if (dragged.current) { dragged.current = false; return; }
    if (e.detail === 0) { setView((v) => (v === 'panel' ? 'none' : 'panel')); return; } // keyboard
    clicks.current++;
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      const n = clicks.current; clicks.current = 0;
      const b = bot.current;
      if (n === 1 || !b?.is3D()) setView((v) => (v === 'panel' ? 'none' : 'panel'));
      else if (n === 2) b.play('backflip');
      else if (n < 5) b.play('annoyed');
      else { setView('none'); void stage.current?.run('explode'); }
    }, 260);
  };

  // pop-ups sit next to the robot wherever it is
  const leftHalf = pos.x + RW / 2 < (typeof window === 'undefined' ? 1200 : window.innerWidth) / 2;
  const upperHalf = pos.y + RH / 2 < (typeof window === 'undefined' ? 800 : window.innerHeight) / 2;
  const popStyle: React.CSSProperties = { position: 'absolute' };
  if (!away) {
    if (leftHalf) popStyle.left = 4; else popStyle.right = 4;
    if (upperHalf) popStyle.top = RH + 4; else popStyle.bottom = RH + 4;
  } else {
    if (leftHalf) popStyle.left = RW + 4; else popStyle.right = RW + 4;
    if (upperHalf) popStyle.top = 8; else popStyle.bottom = 8;
  }
  const hidePops = stunting || (sleeping && view === 'bubble');

  return (
    <div ref={fab} className="buddy-fab print:hidden" data-buddy>
      <div style={popStyle} className={cx('z-[1]', hidePops && 'hidden')}>
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
            onCorner={() => { update((m) => ({ ...m, homeAt: undefined })); setView('none'); }}
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
      </div>
      {view === 'tour' && (
        <Tour groups={p.navGroups} robotW={RW}
          onFocus={(r) => (r ? flyTo(nextTo(r)) : flyHome())}
          onClose={() => { update((m) => ({ ...m, setupDone: m.setupDone ?? new Date().toISOString() })); setView('none'); }} />
      )}

      <button
        type="button"
        onClick={onBotClick}
        onPointerDown={(e) => { if (e.button !== 0) return; stage.current?.dragStart(e.clientX, e.clientY); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* old browser */ } }}
        onPointerMove={(e) => { stage.current?.dragMove(e.clientX, e.clientY); }}
        onPointerUp={() => { if (stage.current?.dragEnd()) { dragged.current = true; window.setTimeout(() => { dragged.current = false; }, 400); } }}
        onPointerCancel={() => { stage.current?.dragEnd(); }}
        className="relative block w-full h-full rounded-[28px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
        style={{ zIndex: view === 'tour' ? 75 : undefined, touchAction: 'none' }}
        aria-label={`SIGMA 1 helper${urgentCount ? ` — ${urgentCount} tip${urgentCount === 1 ? '' : 's'}` : ''}`}
        aria-expanded={view === 'panel'}
      >
        <Buddy3D ref={bot} mood={mood} className="absolute inset-0" />
        {urgentCount > 0 && view !== 'panel' && !stunting && (
          <span className="absolute top-2 right-3 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[11px] font-bold grid place-items-center ring-2 ring-white">{urgentCount}</span>
        )}
      </button>
    </div>
  );
}

/* ───────────────────────── tip bubble ───────────────────────── */

function TipBubble({ n, onAction, onLater, onClose, onNever }: { n: Nudge; onAction: () => void; onLater: () => void; onClose: () => void; onNever: () => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <div role="status" className="buddy-bubble relative w-[min(340px,calc(100vw-24px))] rounded-3xl bg-white shadow-[0_24px_60px_-20px_rgb(30_10_80/0.45)] ring-1 ring-ink-100 p-4">
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
    </div>
  );
}

/* ───────────────────────── panel (click the robot) ───────────────────────── */

function Panel({ firstName, role, nudges, activeTab, mem, perm, onClose, onAction, onTour, onSetup, onLevel, onMinimize, onResetTips, onCorner }: {
  firstName: string; role: 'admin' | 'employee'; nudges: Nudge[]; activeTab: string; mem: BuddyMemory; perm: NotificationPermission | 'unsupported';
  onClose: () => void; onAction: (n: Nudge) => void; onTour: () => void; onSetup: () => void; onLevel: (l: BuddyLevel) => void; onMinimize: () => void; onResetTips: () => void; onCorner: () => void;
}) {
  const help = PAGE_HELP[activeTab];
  const level = mem.level ?? 'normal';
  const setupOk = perm === 'granted' && (role === 'admin' || mem.locationOk !== false);
  return (
    <div role="dialog" aria-label="SIGMA 1 helper" className="buddy-bubble relative w-[min(380px,calc(100vw-24px))] max-h-[min(640px,calc(100vh-140px))] overflow-y-auto rounded-3xl bg-white shadow-[0_24px_60px_-20px_rgb(30_10_80/0.45)] ring-1 ring-ink-100">
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
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px] text-ink-500">
            <span>Drag me anywhere · double-click for a flip</span>
            {mem.homeAt && <button type="button" onClick={onCorner} className="shrink-0 text-ink-500 hover:text-ink-800">Back to my corner</button>}
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
    <div role="dialog" aria-label="Set up SIGMA 1 on this laptop" className="buddy-bubble relative w-[min(400px,calc(100vw-24px))] rounded-3xl bg-white shadow-[0_24px_60px_-20px_rgb(30_10_80/0.5)] ring-1 ring-ink-100 overflow-hidden">
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

function Tour({ groups, onClose, onFocus, robotW }: { groups: NavGroupLite[]; onClose: () => void; onFocus: (r: DOMRect | null) => void; robotW: number }) {
  const items = useMemo(() => groups.flatMap((g) => g.items).filter((it) => PAGE_HELP[it.id]), [groups]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const it = items[i];
  const raf = useRef(0);

  useEffect(() => {
    const measure = () => {
      const el = it ? document.querySelector(`[data-tour="${it.id}"]`) as HTMLElement | null : null;
      if (el && el.offsetParent !== null) { el.scrollIntoView({ block: 'nearest' }); const b = el.getBoundingClientRect(); setRect(b); onFocus(b); } else { setRect(null); onFocus(null); }
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
    ? { position: 'fixed', left: Math.min(rect.right + 18 + robotW, window.innerWidth - 340), top: Math.max(12, Math.min(rect.top + rect.height / 2 - 70, window.innerHeight - 200)), zIndex: 71 }
    : { position: 'fixed', left: '50%', top: '40%', transform: 'translate(-50%, -50%)', zIndex: 71 };

  return (
    <>
      {rect ? <div className="buddy-spot" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />
        : <div className="fixed inset-0 z-[70] bg-ink-950/40" />}
      <div role="dialog" aria-label="Tour" style={cardStyle} className="buddy-bubble w-[min(320px,calc(100vw-24px))] rounded-3xl bg-white shadow-2xl ring-1 ring-ink-100 p-4">
        <div className="flex items-start gap-3">
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
