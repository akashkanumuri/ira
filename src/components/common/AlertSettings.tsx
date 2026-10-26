import React, { useEffect, useState } from 'react';
import { BellRing, Coffee, Laptop, ListChecks, LogIn, MonitorCheck, Play, UserCheck } from 'lucide-react';
import type { AuthUser } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { getExistingSubscription, getPushPermissionState, isPushSupported, sendLocalTestPushNotification, subscribeToPush } from '../../lib/pushSubscription';
import { notify } from '../../lib/toast';
import { Card, CardHeader, cx } from '../../ui';

export type ActivityKind = 'signin' | 'checkin' | 'break' | 'task' | 'done';

const KINDS: { id: ActivityKind; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'signin', label: 'Sign in & sign out', hint: 'Someone signs in to SIGMA 1 or signs out (clients included).', icon: <LogIn className="w-4 h-4" /> },
  { id: 'checkin', label: 'Check in & check out', hint: 'Start and end of the work day, with hours worked.', icon: <UserCheck className="w-4 h-4" /> },
  { id: 'break', label: 'Breaks', hint: 'Someone starts a break or comes back.', icon: <Coffee className="w-4 h-4" /> },
  { id: 'task', label: 'Task & meeting timer', hint: 'Starts, stops or switches the task or meeting they are working on.', icon: <Play className="w-4 h-4" /> },
  { id: 'done', label: 'Tasks handed in', hint: 'A task is handed in for review or marked complete.', icon: <ListChecks className="w-4 h-4" /> },
];

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cx('relative w-11 h-6 rounded-full transition-colors shrink-0', on ? 'bg-brand-600' : 'bg-ink-200')}>
      <span className={cx('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', on && 'translate-x-5')} />
    </button>
  );
}

/** Desktop alerts for this computer + (admins) which team activity creates an alert. */
export function AlertSettings({ user }: { user: AuthUser }) {
  const isAdmin = user.role === 'admin';
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  const [prefsAvailable, setPrefsAvailable] = useState(true);
  const [device, setDevice] = useState<'unsupported' | 'off' | 'blocked' | 'on' | 'checking'>('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isPushSupported()) { if (alive) setDevice('unsupported'); return; }
      const perm = getPushPermissionState();
      if (perm === 'denied') { if (alive) setDevice('blocked'); return; }
      const sub = await getExistingSubscription();
      if (alive) setDevice(perm === 'granted' && sub ? 'on' : 'off');
    })();
    if (isAdmin) {
      void (supabase as any).from('notification_preferences').select('activity').eq('user_id', user.id).maybeSingle()
        .then(({ data, error }: any) => {
          if (!alive) return;
          if (error) { setPrefsAvailable(false); return; }
          setPrefs((data?.activity as Record<string, boolean>) ?? {});
        });
    }
    return () => { alive = false; };
  }, [isAdmin, user.id]);

  async function enableDevice() {
    setBusy(true);
    try {
      const res = await subscribeToPush(user.id);
      if (res.success) { setDevice('on'); notify('Desktop alerts are on for this computer.', 'success'); }
      else { setDevice(getPushPermissionState() === 'denied' ? 'blocked' : 'off'); notify(res.error || 'Couldn’t turn on desktop alerts.', 'error'); }
    } finally { setBusy(false); }
  }

  async function setKind(kind: ActivityKind, on: boolean) {
    const next = { ...(prefs ?? {}), [kind]: on };
    const before = prefs;
    setPrefs(next);
    const { error } = await (supabase as any).from('notification_preferences')
      .upsert({ user_id: user.id, activity: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) { setPrefs(before); notify('Couldn’t save that setting. Try again.', 'error'); }
  }

  return (
    <Card className="p-5 sm:p-6 space-y-5">
      <CardHeader title="Alerts" subtitle={isAdmin ? 'Get a desktop notification the moment something happens in your team.' : 'Get a desktop notification for approvals, assignments and reminders.'} />

      <div className="rounded-2xl border border-ink-100 bg-ink-50/50 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <span className={cx('w-10 h-10 rounded-full grid place-items-center shrink-0', device === 'on' ? 'bg-mint-50 text-mint-600' : 'bg-white text-ink-500 ring-1 ring-ink-100')}>
          {device === 'on' ? <MonitorCheck className="w-5 h-5" /> : <Laptop className="w-5 h-5" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-ink-900">Desktop alerts on this computer</p>
          <p className="text-[12.5px] text-ink-500 mt-0.5">
            {device === 'on' && 'On. Alerts appear in the corner of your screen (Windows) or Notification Centre (Mac), even when this tab is closed — as long as the browser is running.'}
            {device === 'off' && 'Off. Turn it on to see alerts pop up on your screen while you work in other apps.'}
            {device === 'blocked' && 'Blocked in this browser. Click the lock icon next to the address, allow Notifications for this site, then reload.'}
            {device === 'unsupported' && 'This browser can’t show desktop alerts. Use Chrome, Edge, Safari or Firefox.'}
            {device === 'checking' && 'Checking…'}
          </p>
        </div>
        {device === 'off' && <button type="button" className="btn-primary btn-sm shrink-0" disabled={busy} onClick={() => void enableDevice()}><BellRing className="w-4 h-4" /> Turn on</button>}
        {device === 'on' && (
          <button type="button" className="btn-secondary btn-sm shrink-0"
            onClick={async () => { const ok = await sendLocalTestPushNotification('SIGMA 1 · Test alert', 'Desktop alerts are working on this computer.', '/'); if (!ok) notify('Couldn’t show a test alert — check your system notification settings.', 'error'); }}>
            Send test
          </button>
        )}
      </div>

      {isAdmin && prefsAvailable && (
        <div>
          <p className="eyebrow mb-2">Team activity</p>
          <div className="divide-y divide-ink-100 rounded-2xl border border-ink-100 overflow-hidden">
            {KINDS.map((k) => {
              const on = prefs ? prefs[k.id] !== false : true;
              return (
                <div key={k.id} className="flex items-center gap-3 px-4 py-3 bg-white">
                  <span className="w-8 h-8 rounded-full grid place-items-center bg-brand-50 text-brand-600 shrink-0">{k.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold text-ink-900">{k.label}</p>
                    <p className="text-[12px] text-ink-500">{k.hint}</p>
                  </div>
                  <Switch on={on} label={k.label} onChange={(v) => void setKind(k.id, v)} />
                </div>
              );
            })}
          </div>
          <p className="text-[11.5px] text-ink-400 mt-2">These also appear in your bell and on this page, even when desktop alerts are off.</p>
        </div>
      )}
    </Card>
  );
}
