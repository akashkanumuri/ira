import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bell, BriefcaseBusiness, Building2, CalendarDays, CheckCheck, Clock3, FileText, Home, Package, Paperclip, Pencil, Receipt, RefreshCw, Sparkles, Trash2, WalletCards } from 'lucide-react';
import { AlertSettings } from './AlertSettings';
import type { AuthUser } from '../../contexts/AuthContext';
import { deleteNotification, fetchUserNotifications, markAllNotificationsAsRead, markNotificationAsRead, type NotificationRecord, type NotificationType } from '../../lib/notifications';
import { notify } from '../../lib/toast';
import { Card, EmptyState, Page, PageHeader, PillTabs, Skeleton, cx, type Tone } from '../../ui';

const TYPE_META: Record<NotificationType, { label: string; icon: React.ReactNode; tone: Tone }> = {
  leave: { label: 'Leave', icon: <CalendarDays className="w-4 h-4" />, tone: 'amber' },
  wfh: { label: 'Work from home', icon: <Home className="w-4 h-4" />, tone: 'sky' },
  task: { label: 'Tasks', icon: <BriefcaseBusiness className="w-4 h-4" />, tone: 'brand' },
  attendance: { label: 'Attendance', icon: <Clock3 className="w-4 h-4" />, tone: 'mint' },
  holiday: { label: 'Holidays', icon: <Sparkles className="w-4 h-4" />, tone: 'brand' },
  payroll: { label: 'Payroll', icon: <WalletCards className="w-4 h-4" />, tone: 'mint' },
  system: { label: 'System', icon: <Bell className="w-4 h-4" />, tone: 'ink' },
  activity: { label: 'Team activity', icon: <Activity className="w-4 h-4" />, tone: 'sky' },
  contract: { label: 'Contracts', icon: <FileText className="w-4 h-4" />, tone: 'ink' },
  deliverable: { label: 'Deliverables', icon: <Package className="w-4 h-4" />, tone: 'brand' },
  dependency: { label: 'Client files', icon: <Paperclip className="w-4 h-4" />, tone: 'amber' },
  modification: { label: 'Changes', icon: <Pencil className="w-4 h-4" />, tone: 'amber' },
  billing: { label: 'Billing', icon: <Receipt className="w-4 h-4" />, tone: 'mint' },
  client: { label: 'Clients', icon: <Building2 className="w-4 h-4" />, tone: 'sky' },
};
const TONE_BG: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-600', mint: 'bg-mint-50 text-mint-600', amber: 'bg-amber-50 text-amber-600', rose: 'bg-rose-50 text-rose-600', sky: 'bg-sky-50 text-sky-600', ink: 'bg-ink-100 text-ink-600', dark: 'bg-ink-900 text-white',
};

const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
function dayHeading(key: string) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const y = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  if (key === today) return 'Today';
  if (key === y) return 'Yesterday';
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** Full notification history for staff. The bell shows the latest; this page shows everything kept. */
export function NotificationsPage({ user, onOpen }: { user: AuthUser; onOpen: (url: string) => void }) {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [type, setType] = useState<NotificationType | 'any'>('any');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchUserNotifications(user.id, 200));
    } finally {
      setLoading(false);
    }
  }, [user.id]);
  useEffect(() => { void load(); }, [load]);

  const unread = items.filter((n) => !n.read_at).length;
  const types = useMemo(() => Array.from(new Set(items.map((n) => n.type))).filter((t) => TYPE_META[t]), [items]);
  const shown = items.filter((n) => (filter === 'all' || !n.read_at) && (type === 'any' || n.type === type));
  const groups = useMemo(() => {
    const m = new Map<string, NotificationRecord[]>();
    for (const n of shown) m.set(dayKey(n.created_at), [...(m.get(dayKey(n.created_at)) ?? []), n]);
    return [...m.entries()];
  }, [shown]);

  async function open(n: NotificationRecord) {
    if (!n.read_at) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      void markNotificationAsRead(n.id);
    }
    if (n.action_url) onOpen(n.action_url);
  }
  async function markAll() {
    const ok = await markAllNotificationsAsRead(user.id);
    if (ok) setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    else notify('Couldn’t mark notifications as read. Try again.', 'error');
  }
  async function remove(id: string) {
    const before = items;
    setItems((prev) => prev.filter((x) => x.id !== id));
    const ok = await deleteNotification(id);
    if (!ok) { setItems(before); notify('Couldn’t dismiss that notification.', 'error'); }
  }

  return (
    <Page>
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : 'You’re all caught up.'}
        actions={<>
          <button type="button" className="btn-secondary" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</button>
          <button type="button" className="btn-primary" disabled={!unread} onClick={() => void markAll()}><CheckCheck className="w-4 h-4" /> Mark all read</button>
        </>}
      />
      <AlertSettings user={user} />
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <PillTabs value={filter} onChange={setFilter} items={[{ id: 'all', label: 'All', count: items.length }, { id: 'unread', label: 'Unread', count: unread || undefined }]} />
        {types.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {(['any', ...types] as const).map((t) => (
              <button key={t} type="button" onClick={() => setType(t)} className={cx('rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-colors', type === t ? 'bg-ink-900 text-white border-ink-900' : 'bg-white text-ink-600 border-ink-200 hover:border-ink-300')}>
                {t === 'any' ? 'Everything' : TYPE_META[t].label}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <Card className="p-5 space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}</Card>
      ) : groups.length ? (
        <div className="space-y-5">
          {groups.map(([day, list]) => (
            <section key={day} className="space-y-2">
              <p className="eyebrow">{dayHeading(day)}</p>
              <Card className="divide-y divide-ink-100 overflow-hidden">
                {list.map((n) => {
                  const meta = TYPE_META[n.type] ?? TYPE_META.system;
                  return (
                    <div key={n.id} className={cx('group flex items-start gap-3 px-4 sm:px-5 py-3.5 transition-colors', !n.read_at && 'bg-brand-50/40')}>
                      <button type="button" onClick={() => void open(n)} className="flex-1 min-w-0 flex items-start gap-3 text-left">
                        <span className={cx('w-10 h-10 rounded-full grid place-items-center shrink-0', TONE_BG[meta.tone])}>{meta.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className={cx('text-[14px] truncate', n.read_at ? 'font-semibold text-ink-700' : 'font-bold text-ink-900')}>{n.title}</span>
                            {!n.read_at && <span className="w-2 h-2 rounded-full bg-brand-600 shrink-0" aria-label="Unread" />}
                          </span>
                          <span className="block text-[13px] text-ink-600 mt-0.5 leading-snug">{n.message}</span>
                          <span className="block text-[11px] text-ink-400 mt-1 tnum">
                            {new Date(n.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} · {meta.label}
                            {n.action_url ? <span className="text-brand-600 font-semibold"> · Open</span> : null}
                          </span>
                        </span>
                      </button>
                      <button type="button" onClick={() => void remove(n.id)} className="icon-btn opacity-60 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 text-ink-400 hover:text-rose-600" title="Dismiss" aria-label="Dismiss notification"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  );
                })}
              </Card>
            </section>
          ))}
        </div>
      ) : (
        <Card><EmptyState icon={<Bell className="w-6 h-6" />} title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} text="Approvals, assignments and reminders will show up here." /></Card>
      )}
    </Page>
  );
}
