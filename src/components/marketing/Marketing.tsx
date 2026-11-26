import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Megaphone, Plus, Settings2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { useLiveRefresh } from '../../lib/live';
import { Badge, Button, Card, EmptyState, Notice, PillTabs, SearchInput, cx } from '../../ui';
import { Modal } from '../../ui/Modal';
import type { Employee } from '../../types/attendance';
import { errText, inr, loadMarketing, mkApi, moneySummary, useMarketers, type MkClient, type MkData, type MkMoney, type MkResult } from '../../lib/marketing';
import { MarketingDashboard } from './Dashboard';
import { AdsSection, MoneySection, PostsSection, ReportsSection, type Mode, type People } from './Sections';

const db = () => supabase as any;
type Tab = 'overview' | 'posts' | 'ads' | 'reports' | 'money' | 'settings';

/** Admin and marketing team: marketing clients, then one client's dashboard, posts, ads, reports and ad money. */
export function MarketingWorkspace({ admin, employees, myEmployeeId }: { admin: boolean; employees: Employee[]; myEmployeeId?: string | null }) {
  const [rows, setRows] = useState<{ settings: MkClient; name: string; money: MkMoney[]; results: Pick<MkResult, 'spend' | 'day'>[]; team: string[] }[]>([]);
  const [clients, setClients] = useState<{ id: string; company_name: string }[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, c, m, r, t] = await Promise.all([
        db().from('mk_clients').select('*'),
        db().from('clients').select('id, company_name').is('deleted_at', null).order('company_name'),
        db().from('mk_money').select('client_id, kind, amount, request_id, id, voided_at, entry_date, due_date, method, reference, note, void_reason, created_at').limit(10000),
        db().from('mk_results').select('client_id, spend, day').limit(50000),
        db().from('mk_team').select('client_id, employee_id'),
      ]);
      for (const x of [s, c, m, r, t]) if (x.error) throw x.error;
      const names = new Map((c.data ?? []).map((x: any) => [x.id, x.company_name]));
      setClients(c.data ?? []);
      setRows((s.data ?? []).map((st: MkClient) => ({
        settings: st, name: String(names.get(st.client_id) ?? 'Client'),
        money: (m.data ?? []).filter((x: any) => x.client_id === st.client_id), results: (r.data ?? []).filter((x: any) => x.client_id === st.client_id),
        team: (t.data ?? []).filter((x: any) => x.client_id === st.client_id).map((x: any) => x.employee_id),
      })).sort((a: any, b: any) => a.name.localeCompare(b.name)));
      setState('ready');
    } catch (e) { setError(errText(e, 'Unable to load marketing.')); setState('error'); }
  }, []);
  useLiveRefresh(load);
  useEffect(() => { void load(); }, [load]);

  const open = rows.find((r) => r.settings.client_id === openId);
  if (open) return <ClientWorkspace clientId={open.settings.client_id} name={open.name} mode={admin ? 'admin' : 'team'} employees={employees} team={open.team} myEmployeeId={myEmployeeId ?? null} onBack={() => { setOpenId(null); void load(); }} />;

  const term = q.trim().toLowerCase();
  const shown = rows.filter((r) => !term || r.name.toLowerCase().includes(term));
  return (
    <div className="mx-auto w-full max-w-[1320px] space-y-5">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] sm:text-[34px] font-bold leading-[1.1] text-ink-950">Marketing</h1>
          <p className="mt-2 text-sm text-ink-500 max-w-2xl">Social posts, ad campaigns, results, reports and each client’s ad money.</p>
        </div>
        <div className="flex gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Search clients…" className="md:w-64" />
          {admin && <Button icon={<Plus className="w-4 h-4" />} onClick={() => setAdding(true)}>Add client</Button>}
        </div>
      </header>
      {state === 'error' && <Notice tone="rose">{error}</Notice>}
      {state === 'loading' && <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-40 rounded-3xl" />)}</div>}
      {state === 'ready' && !shown.length && (
        <Card><EmptyState icon={<Megaphone className="w-6 h-6" />} title={rows.length ? 'No match' : admin ? 'No marketing clients yet' : 'No clients assigned to you'}
          text={admin ? 'Add a client to start planning posts, running ads and tracking their ad money.' : 'Ask your admin to add you to a client’s marketing team.'}
          action={admin && !rows.length ? <Button onClick={() => setAdding(true)}>Add client</Button> : undefined} className="!py-12" /></Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {shown.map((r) => {
          const s = moneySummary(r.money as MkMoney[], r.results as MkResult[]);
          const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
          const monthSpend = r.results.filter((x) => x.day.startsWith(month)).reduce((a, x) => a + Number(x.spend), 0);
          const low = r.settings.low_balance > 0 && s.balance < r.settings.low_balance;
          return (
            <button key={r.settings.client_id} type="button" onClick={() => setOpenId(r.settings.client_id)}
              className="text-left rounded-3xl bg-white border border-ink-100 p-5 hover:border-ink-300 hover:shadow-sm transition">
              <div className="flex items-start gap-2">
                <p className="font-display font-bold text-[17px] text-ink-950 flex-1 truncate">{r.name}</p>
                {!r.settings.enabled && <Badge tone="ink">Paused</Badge>}
                {r.settings.client_access && <Badge tone="sky">Client sees</Badge>}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div><p className="text-[11px] text-ink-500 font-semibold">Spent this month</p><p className="font-display font-bold text-[17px] tnum">{inr(monthSpend, { compact: true })}</p></div>
                <div><p className="text-[11px] text-ink-500 font-semibold">Balance</p><p className={cx('font-display font-bold text-[17px] tnum', s.balance < 0 ? 'text-rose-700' : low ? 'text-amber-700' : 'text-ink-950')}>{inr(s.balance, { compact: true })}</p></div>
                <div><p className="text-[11px] text-ink-500 font-semibold">Pending</p><p className={cx('font-display font-bold text-[17px] tnum', s.pending > 0 ? 'text-amber-700' : 'text-ink-950')}>{inr(s.pending, { compact: true })}</p></div>
              </div>
              <p className="mt-3 text-[12px] text-ink-500">{r.team.length ? r.team.map((id) => employees.find((e) => e.id === id)?.name).filter(Boolean).join(', ') : 'No team assigned'}</p>
            </button>
          );
        })}
      </div>
      {adding && <AddClientDialog clients={clients.filter((c) => !rows.some((r) => r.settings.client_id === c.id))} onClose={() => setAdding(false)}
        onDone={async (id) => { setAdding(false); await load(); setOpenId(id); }} />}
    </div>
  );
}

function AddClientDialog({ clients, onClose, onDone }: { clients: { id: string; company_name: string }[]; onClose: () => void; onDone: (id: string) => Promise<void> }) {
  const [id, setId] = useState(clients[0]?.id ?? ''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await mkApi.saveClient(id, { enabled: true }); notify('Client added to marketing.', 'success'); await onDone(id); }
    catch (e) { notify(errText(e, 'Could not add.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a marketing client" onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        {clients.length ? <label className="block"><span className="label">Client</span><select className="input" value={id} onChange={(e) => setId(e.target.value)}>{clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
          : <p className="text-[13px] text-ink-600">Every client is already set up.</p>}
        <p className="text-[12px] text-ink-500">Client portal access is off until you turn it on in Settings.</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} disabled={!id} onClick={() => void go()}>Add</Button></div>
      </div>
    </Modal>
  );
}

function ClientWorkspace({ clientId, name, mode, employees, team, myEmployeeId, onBack }: { clientId: string; name: string; mode: Mode; employees: Employee[]; team: string[]; myEmployeeId: string | null; onBack: () => void }) {
  const marketerDesignations = useMarketers(true);
  const people: People = useMemo(() => ({
    marketers: employees.filter((e) => e.status === 'active' && e.designationId && marketerDesignations.includes(e.designationId)).map((e) => ({ id: e.id, name: e.name })),
    me: myEmployeeId,
    nameOf: (id) => (id ? employees.find((e) => e.id === id)?.name ?? (id === myEmployeeId ? 'Me' : 'Team member') : '—'),
  }), [employees, marketerDesignations, myEmployeeId]);
  const [data, setData] = useState<MkData | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setData(await loadMarketing(clientId)); setError(''); } catch (e) { setError(errText(e, 'Unable to load this client.')); }
  }, [clientId]);
  useLiveRefresh(load);
  useEffect(() => { void load(); }, [load]);
  const waiting = data?.posts.filter((p) => p.status === 'changes_requested').length ?? 0;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'posts', label: 'Posts', count: waiting || undefined }, { id: 'ads', label: 'Ads' },
    { id: 'reports', label: 'Reports' }, { id: 'money', label: 'Ad money' }, ...(mode === 'admin' ? [{ id: 'settings' as Tab, label: 'Settings' }] : []),
  ];
  return (
    <div className="mx-auto w-full max-w-[1320px] space-y-5">
      <button type="button" className="btn-ghost btn-sm w-fit" onClick={onBack}><ArrowLeft className="w-3.5 h-3.5" /> All marketing clients</button>
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <p className="eyebrow">Marketing</p>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold leading-[1.1] text-ink-950 mt-1">{name}</h1>
          {data?.settings && <p className="mt-1.5 text-[12.5px] text-ink-500">{data.settings.client_access ? 'Client can see this in their portal' : 'Hidden from the client'}{data.settings.post_approval ? ' · client approves posts' : ''}</p>}
        </div>
        <PillTabs value={tab} onChange={setTab} items={tabs} />
      </header>
      {error && <Notice tone="rose">{error}</Notice>}
      {!data && !error && <div className="skeleton h-72 rounded-3xl" />}
      {data && tab === 'overview' && <MarketingDashboard data={data} audience="team" />}
      {data && tab === 'posts' && <PostsSection clientId={clientId} data={data} mode={mode} reload={load} />}
      {data && tab === 'ads' && <AdsSection clientId={clientId} data={data} mode={mode} reload={load} people={people} />}
      {data && tab === 'reports' && <ReportsSection clientId={clientId} data={data} mode={mode} reload={load} />}
      {data && tab === 'money' && <MoneySection clientId={clientId} data={data} mode={mode} reload={load} people={people} />}
      {data && tab === 'settings' && mode === 'admin' && <SettingsPanel clientId={clientId} settings={data.settings} employees={employees} team={team} reload={load} />}
    </div>
  );
}

function SettingsPanel({ clientId, settings, employees, team, reload }: { clientId: string; settings: MkClient | null; employees: Employee[]; team: string[]; reload: () => Promise<void> }) {
  const [f, setF] = useState({ enabled: settings?.enabled ?? true, client_access: settings?.client_access ?? false, post_approval: settings?.post_approval ?? false, low_balance: String(settings?.low_balance ?? 0) });
  const [members, setMembers] = useState<string[]>(team);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useMemo(() => employees.filter((e) => e.status === 'active'), [employees]);
  const shown = active.filter((e) => !q.trim() || `${e.name} ${e.designation ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const save = async () => {
    setBusy(true);
    try { await mkApi.saveClient(clientId, f); await mkApi.setTeam(clientId, members); notify('Settings saved.', 'success'); await reload(); }
    catch (e) { notify(errText(e, 'Could not save.'), 'error', 8000); } finally { setBusy(false); }
  };
  const Toggle = ({ k, title, text }: { k: 'enabled' | 'client_access' | 'post_approval'; title: string; text: string }) => (
    <label className="flex items-start gap-3 rounded-2xl border border-ink-100 p-4 cursor-pointer hover:bg-ink-50/50">
      <input type="checkbox" className="mt-1" checked={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.checked }))} />
      <span><span className="block font-semibold text-[14px] text-ink-900">{title}</span><span className="block text-[12.5px] text-ink-500">{text}</span></span>
    </label>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <Card className="p-5 space-y-3">
        <h3 className="font-display font-bold text-[16px] text-ink-900 flex items-center gap-2"><Settings2 className="w-4 h-4" />Client options</h3>
        <Toggle k="client_access" title="Client can see marketing" text="Adds a Marketing tab to their portal: dashboard, posts, ads, reports and ad money." />
        <Toggle k="post_approval" title="Client approves posts" text="Posts wait for the client’s OK before they can be marked as posted." />
        <Toggle k="enabled" title="Marketing active" text="Turn off to pause this client. Nothing is deleted." />
        <label className="block"><span className="label">Low balance alert at ₹</span><input className="input" type="number" min="0" value={f.low_balance} onChange={(e) => setF((x) => ({ ...x, low_balance: e.target.value }))} />
          <span className="text-[11.5px] text-ink-500">You{f.client_access ? ' and the client' : ''} get a notification when the ad balance drops below this. 0 turns it off.</span></label>
      </Card>
      <Card className="p-5 space-y-3">
        <h3 className="font-display font-bold text-[16px] text-ink-900">Marketing team</h3>
        <p className="text-[12.5px] text-ink-500">Everyone with the <b>Performance Marketing</b> designation already works on all marketing clients. Add anyone else who should help with this client here.</p>
        <SearchInput value={q} onChange={setQ} placeholder="Search people…" />
        <ul className="max-h-72 overflow-auto divide-y divide-ink-100 rounded-2xl border border-ink-100">
          {shown.map((e) => (
            <li key={e.id}><label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-ink-50/60">
              <input type="checkbox" checked={members.includes(e.id)} onChange={(ev) => setMembers((m) => (ev.target.checked ? [...m, e.id] : m.filter((x) => x !== e.id)))} />
              <span className="text-[13.5px] text-ink-900 font-semibold">{e.name}</span><span className="text-[12px] text-ink-500">{e.designation}</span>
            </label></li>
          ))}
        </ul>
        <p className="text-[12px] text-ink-500">{members.length} selected</p>
      </Card>
      <div className="lg:col-span-2 flex justify-end"><Button loading={busy} onClick={() => void save()}>Save settings</Button></div>
    </div>
  );
}

/** Client portal: their own marketing (only when the admin has given access). */
export function ClientMarketing({ clientId }: { clientId: string }) {
  const [data, setData] = useState<MkData | null>(null);
  const [tab, setTab] = useState<Exclude<Tab, 'settings'>>('overview');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setData(await loadMarketing(clientId)); setError(''); } catch (e) { setError(errText(e, 'Unable to load marketing.')); }
  }, [clientId]);
  useLiveRefresh(load);
  useEffect(() => { void load(); }, [load]);
  const waiting = data?.posts.filter((p) => p.status === 'awaiting_approval').length ?? 0;
  return (
    <div className="space-y-5">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <p className="eyebrow">Marketing</p>
          <h1 className="font-display text-[28px] font-bold text-ink-900 leading-tight mt-1">Your marketing results</h1>
          <p className="text-[14px] text-ink-500 mt-1">Ad spend, results, posts and reports — updated by your marketing team.</p>
        </div>
        <PillTabs value={tab} onChange={setTab} items={[{ id: 'overview', label: 'Overview' }, { id: 'posts', label: 'Posts', count: waiting || undefined }, { id: 'ads', label: 'Ads' }, { id: 'reports', label: 'Reports' }, { id: 'money', label: 'Ad money' }]} />
      </header>
      {error && <Notice tone="rose">{error}</Notice>}
      {!data && !error && <div className="skeleton h-72 rounded-3xl" />}
      {data && !data.settings && <Notice tone="ink">Marketing isn’t switched on for your account.</Notice>}
      {data?.settings && tab === 'overview' && <MarketingDashboard data={data} audience="client" />}
      {data?.settings && tab === 'posts' && <PostsSection clientId={clientId} data={data} mode="client" reload={load} />}
      {data?.settings && tab === 'ads' && <AdsSection clientId={clientId} data={data} mode="client" reload={load} />}
      {data?.settings && tab === 'reports' && <ReportsSection clientId={clientId} data={data} mode="client" reload={load} />}
      {data?.settings && tab === 'money' && <MoneySection clientId={clientId} data={data} mode="client" reload={load} />}
    </div>
  );
}
