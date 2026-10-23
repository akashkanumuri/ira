import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, LifeBuoy, RefreshCw } from 'lucide-react';
import type { Employee } from '../../types/attendance';
import { SUPPORT_CATEGORY, SUPPORT_STATUS, supportApi, type SupportRequest } from '../../lib/support';
import { Badge, Card, EmptyState, Notice, Page, PageHeader, PillTabs, SearchInput, Skeleton, cx } from '../../ui';
import { SupportConversation } from './SupportConversation';

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
};

/** Staff view of client support requests. RLS limits employees to requests on projects they manage or that are assigned to them. */
export function SupportInbox({ employees = [], canAssign }: { employees?: Employee[]; canAssign: boolean }) {
  const [rows, setRows] = useState<SupportRequest[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'active' | 'resolved' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(() => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('request') : null));

  const load = useCallback(async () => {
    try { setRows(await supportApi.list()); setState('ready'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load support requests.'); setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const active = rows.filter((r) => !['resolved', 'closed'].includes(r.status));
  const q = search.trim().toLowerCase();
  const shown = useMemo(() => (tab === 'active' ? active : tab === 'resolved' ? rows.filter((r) => ['resolved', 'closed'].includes(r.status)) : rows)
    .filter((r) => !q || `${r.request_number} ${r.subject} ${r.clients?.company_name ?? ''} ${r.projects?.name ?? ''}`.toLowerCase().includes(q)), [rows, active, tab, q]);
  const open = rows.find((r) => r.id === openId) ?? null;
  const assignees = employees.filter((e) => e.status === 'active').map((e) => ({ id: e.id, name: e.name }));
  const nameOf = (id: string | null) => (id ? employees.find((e) => e.id === id)?.name : null);

  return (
    <Page>
      <PageHeader title="Client support" subtitle="Questions and problems raised by clients from their portal." actions={<button type="button" className="btn-secondary" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</button>} />
      {state === 'error' && <Notice tone="sky">{error}</Notice>}
      {state !== 'error' && (
        <div className="grid gap-4 lg:grid-cols-[380px_1fr] items-start">
          <div className={cx('space-y-3', open && 'hidden lg:block')}>
            <PillTabs value={tab} onChange={setTab} items={[{ id: 'active', label: 'Open', count: active.length || undefined }, { id: 'resolved', label: 'Resolved' }, { id: 'all', label: 'All' }]} />
            <SearchInput value={search} onChange={setSearch} placeholder="Search requests" />
            {state === 'loading' ? <Card className="p-4 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}</Card>
              : shown.length ? (
                <Card className="divide-y divide-ink-100 overflow-hidden">
                  {shown.map((r) => (
                    <button key={r.id} type="button" onClick={() => { setOpenId(r.id); window.history.replaceState(null, '', `${window.location.pathname}?request=${r.id}`); }}
                      className={cx('w-full text-left px-4 py-3.5 transition-colors', openId === r.id ? 'bg-brand-50' : 'hover:bg-ink-50/70')}>
                      <div className="flex items-center justify-between gap-2"><span className="text-[11px] font-bold text-ink-400 tnum">{r.request_number}</span><span className="text-[11px] text-ink-400">{ago(r.last_message_at)}</span></div>
                      <p className="text-sm font-bold text-ink-900 truncate mt-0.5">{r.subject}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <Badge tone={SUPPORT_STATUS[r.status].tone} dot>{SUPPORT_STATUS[r.status].label}</Badge>
                        <span className="text-[12px] text-ink-500 truncate">{r.clients?.company_name}{r.projects?.name ? ` · ${r.projects.name}` : ''}</span>
                        {r.priority === 'high' && <Badge tone="rose">High</Badge>}
                      </div>
                    </button>
                  ))}
                </Card>
              ) : <Card><EmptyState icon={<LifeBuoy className="w-6 h-6" />} title={tab === 'active' ? 'No open requests' : 'Nothing here'} text="Requests clients send from their portal appear here." className="!py-10" /></Card>}
          </div>
          {open ? (
            <Card className="p-5 sm:p-6 lg:min-h-[560px] flex flex-col">
              <button type="button" className="btn-ghost btn-sm w-fit lg:hidden mb-3" onClick={() => setOpenId(null)}><ArrowLeft className="w-3.5 h-3.5" /> All requests</button>
              <p className="text-[11px] font-bold text-ink-400 tnum">{open.request_number} · {SUPPORT_CATEGORY[open.category]}</p>
              <h2 className="font-display text-xl font-bold text-ink-900 mt-0.5">{open.subject}</h2>
              <p className="text-[13px] text-ink-500 mb-4">{open.clients?.company_name}{open.projects?.name ? ` · ${open.projects.name}` : ''}{nameOf(open.assigned_to) ? ` · assigned to ${nameOf(open.assigned_to)}` : ''}</p>
              <div className="flex-1 min-h-0"><SupportConversation key={open.id} request={open} staff assignees={canAssign ? assignees : []} onChanged={load} /></div>
            </Card>
          ) : (
            <Card className="hidden lg:flex items-center justify-center min-h-[400px]"><EmptyState icon={<LifeBuoy className="w-6 h-6" />} title="Pick a request" text="Open a request to read and reply." /></Card>
          )}
        </div>
      )}
    </Page>
  );
}
