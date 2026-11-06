// Live updates for every screen, without pressing Refresh.
//
// One signal — `ira:data` — tells open screens "something may have changed, load again". It fires when:
//   • a notification arrives for you (someone else acted: payment verified, draft sent, task approved…),
//   • you come back to the tab or window,
//   • every 45 seconds while the tab is visible (safety net),
//   • a screen in this tab saves something (signalDataChanged()).
// Screens subscribe with useLiveRefresh(load). Calls are debounced so a burst of signals = one reload.
import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

const EVT = 'ira:data';
const POLL_MS = 45_000;
const FOCUS_GAP_MS = 10_000;

export type LiveReason = 'notification' | 'focus' | 'poll' | 'local';

export function signalDataChanged(reason: LiveReason = 'local') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVT, { detail: { reason } }));
}

/** Re-run `load` whenever data may have changed. `load` can change between renders; the latest is used. */
export function useLiveRefresh(load: (() => unknown) | null | undefined, opts: { debounceMs?: number; enabled?: boolean } = {}) {
  const ref = useRef(load);
  ref.current = load;
  const enabled = opts.enabled ?? true;
  const wait = opts.debounceMs ?? 350;
  useEffect(() => {
    if (!enabled) return;
    let t: number | null = null;
    let running = false;
    let again = false;
    const fire = async () => {
      if (running) { again = true; return; }
      running = true;
      try { await ref.current?.(); } catch { /* the screen shows its own errors */ }
      finally {
        running = false;
        if (again) { again = false; void fire(); }
      }
    };
    const on = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => { t = null; void fire(); }, wait);
    };
    window.addEventListener(EVT, on);
    return () => { window.removeEventListener(EVT, on); if (t) window.clearTimeout(t); };
  }, [enabled, wait]);
}

/** Starts the shared triggers once per signed-in user. Returns a stop function. */
export function startLiveSync(userId: string): () => void {
  let stopped = false;
  let lastFocus = 0;

  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastFocus < FOCUS_GAP_MS) return;
    lastFocus = now;
    signalDataChanged('focus');
  };
  const onNote = () => signalDataChanged('notification');
  const poll = window.setInterval(() => { if (document.visibilityState === 'visible') signalDataChanged('poll'); }, POLL_MS);

  window.addEventListener('focus', onVisible);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('ira:notification', onNote);

  // Your own notifications arriving live (RLS limits this to rows you can read).
  let channel: any = null;
  try {
    channel = (supabase as any)
      .channel(`ira-live-${userId}-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` }, () => {
        if (!stopped) signalDataChanged('notification');
      })
      .subscribe();
  } catch { /* realtime unavailable: focus + polling still keep screens fresh */ }

  return () => {
    stopped = true;
    window.clearInterval(poll);
    window.removeEventListener('focus', onVisible);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('ira:notification', onNote);
    if (channel) void (supabase as any).removeChannel(channel);
  };
}
