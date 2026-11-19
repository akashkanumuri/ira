import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BarChart3, Building2, CheckCircle2, Clock3, Inbox, MapPin, MessageSquare, Pencil, Phone, Plus,
  RefreshCw, RotateCcw, Upload, UserPlus, XCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { GeoError, getFix } from '../../lib/officeLocation';
import type { Employee } from '../../types/attendance';
import { Badge, Card, CardHeader, EmptyState, Notice, PillTabs, SearchInput, Skeleton, Stat, cx, type Tone } from '../../ui';
import { Modal } from '../../ui/Modal';
import { ClientCreationModal } from '../admin/ClientCreationModal';

/**
 * Leads & Sales.
 * Revenue (calling team) calls leads and marks good ones; Field sales visit companies (location logged) and do the same.
 * Good leads go to admin / sales manager, who take them and turn them into clients.
 * Every change goes through permission-checked database functions; the browser never writes the tables directly.
 */

const db = () => supabase as any;

export type SalesRole = 'sales_caller' | 'sales_field' | 'sales_manager';
export const SALES_ROLES: { id: SalesRole; label: string; hint: string }[] = [
  { id: 'sales_caller', label: 'Revenue (calling team)', hint: 'Calls leads and passes good ones to admin' },
  { id: 'sales_field', label: 'Field sales', hint: 'Visits companies and logs each visit with location' },
  { id: 'sales_manager', label: 'Sales manager', hint: 'Sees all leads, assigns, imports and sees reports' },
];
export const salesRoleLabel = (r?: string | null) => SALES_ROLES.find((x) => x.id === r)?.label ?? '';

export const SOURCES: { id: string; label: string }[] = [
  { id: 'meta_ads', label: 'Meta ads' }, { id: 'google_ads', label: 'Google ads' }, { id: 'instagram', label: 'Instagram' },
  { id: 'website', label: 'Website' }, { id: 'whatsapp', label: 'WhatsApp' }, { id: 'referral', label: 'Referral' },
  { id: 'walk_in', label: 'Walk-in' }, { id: 'field_visit', label: 'Field visit' }, { id: 'phone_call', label: 'Phone call' },
  { id: 'event', label: 'Event' }, { id: 'other', label: 'Other' },
];
const sourceLabel = (s: string) => SOURCES.find((x) => x.id === s)?.label ?? s;

const STAGES: { id: Stage; label: string; tone: Tone }[] = [
  { id: 'new', label: 'New', tone: 'sky' },
  { id: 'calling', label: 'Following up', tone: 'brand' },
  { id: 'good', label: 'Good lead', tone: 'mint' },
  { id: 'with_admin', label: 'With admin', tone: 'amber' },
  { id: 'won', label: 'Client', tone: 'dark' },
  { id: 'lost', label: 'Lost', tone: 'rose' },
];
type Stage = 'new' | 'calling' | 'good' | 'with_admin' | 'won' | 'lost';
const stageOf = (s: string) => STAGES.find((x) => x.id === s) ?? STAGES[0];

const CALL_OUTCOMES = [
  { id: 'connected', label: 'Spoke to them' }, { id: 'interested', label: 'Interested' }, { id: 'call_back', label: 'Call back later' },
  { id: 'no_answer', label: 'No answer' }, { id: 'busy', label: 'Busy' }, { id: 'not_interested', label: 'Not interested' },
  { id: 'wrong_number', label: 'Wrong number' },
];
const VISIT_OUTCOMES = [
  { id: 'met', label: 'Met them' }, { id: 'follow_up', label: 'Visit again / follow up' }, { id: 'not_available', label: 'Not available' },
];
const LOST_REASONS = ['Not interested', 'Budget too low', 'Went with someone else', 'Not reachable', 'Wrong number / fake', 'Not the right fit', 'Other'];
const OUTCOME_LABEL: Record<string, string> = Object.fromEntries([...CALL_OUTCOMES, ...VISIT_OUTCOMES, { id: 'good', label: 'Marked good' }, { id: 'lost', label: 'Marked lost' }].map((o) => [o.id, o.label]));

export interface Lead {
  id: string; lead_no: string; contact_name: string; company: string | null; designation: string | null;
  phone: string | null; email: string | null; city: string | null; address: string | null; industry: string | null;
  source: string; campaign: string | null; service_interest: string | null; channel: 'calling' | 'field'; stage: Stage;
  need: string | null; budget: string | null; timeline: string | null; decision_maker: string | null; lost_reason: string | null;
  notes: string | null; owner_id: string | null; created_by: string | null; client_id: string | null;
  next_follow_up_at: string | null; first_contacted_at: string | null; last_contacted_at: string | null;
  call_count: number; visit_count: number; qualified_at: string | null; closed_at: string | null; created_at: string; updated_at: string;
}
interface Activity {
  id: string; lead_id: string; kind: string; outcome: string | null; note: string | null; by_profile: string | null; by_employee: string | null;
  started_at: string | null; ended_at: string | null; start_lat: number | null; start_lng: number | null; start_accuracy: number | null;
  end_lat: number | null; end_lng: number | null; metadata: any; created_at: string;
}
interface TeamMember { employee_id: string; name: string; role_code: SalesRole; avatar_url: string | null }

export interface SalesAccess { role: SalesRole | null; canCall: boolean; canVisit: boolean; canManage: boolean; ready: boolean }

const errText = (e: unknown, fallback: string) => {
  const m = (e as any)?.message ?? (e instanceof Error ? e.message : '');
  return m ? String(m).replace(/^.*?P0001:\s*/, '') : fallback;
};
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const isOpen = (l: Lead) => l.stage === 'new' || l.stage === 'calling';
const dueState = (l: Lead): 'overdue' | 'today' | 'later' | 'none' => {
  if (!l.next_follow_up_at || !isOpen(l)) return 'none';
  const t = new Date(l.next_follow_up_at);
  if (t.getTime() < Date.now() && dayKey(t) < dayKey(new Date())) return 'overdue';
  if (dayKey(t) <= dayKey(new Date())) return 'today';
  return 'later';
};
/** datetime-local value (IST) → ISO */
const localToIso = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : null);
const inDays = (n: number, hour = 11) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${dayKey(d)}T${String(hour).padStart(2, '0')}:00`;
};

/* ---------------------------------------------------------------- access */

export function useSalesAccess(isAdmin: boolean): SalesAccess {
  const [role, setRole] = useState<SalesRole | null>(null);
  const [ready, setReady] = useState(isAdmin);
  useEffect(() => {
    if (isAdmin) return;
    let alive = true;
    void db().rpc('my_sales_role').then(({ data }: any) => { if (alive) { setRole((data as SalesRole) ?? null); setReady(true); } });
    return () => { alive = false; };
  }, [isAdmin]);
  if (isAdmin) return { role: null, canCall: true, canVisit: false, canManage: true, ready: true };
  return { role, canCall: !!role, canVisit: role === 'sales_field' || role === 'sales_manager', canManage: role === 'sales_manager', ready };
}

/** Admin: profileId → sales role, for the employee list and form. */
export function useSalesRoles(enabled: boolean) {
  const [map, setMap] = useState<Record<string, SalesRole>>({});
  const reload = useCallback(async () => {
    if (!enabled) return;
    const { data } = await db().from('user_roles').select('user_id, role_code').in('role_code', SALES_ROLES.map((r) => r.id));
    const m: Record<string, SalesRole> = {};
    for (const r of data ?? []) m[r.user_id] = r.role_code;
    setMap(m);
  }, [enabled]);
  useEffect(() => { void reload(); }, [reload]);
  return { map, reload };
}

/* ---------------------------------------------------------------- page */

export function LeadsPage({ user, employees, onSelectTab }: { user: any; employees: Employee[]; onSelectTab?: (t: string) => void }) {
  const isAdmin = user.role === 'admin';
  const access = useSalesAccess(isAdmin);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [openVisit, setOpenVisit] = useState<Activity | null>(null);
  const [view, setView] = useState<string>('queue');
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('open');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await db().from('leads').select('*').order('updated_at', { ascending: false }).limit(2000);
    if (error) { setLoadError(error.message); setLeads([]); return; }
    setLoadError(''); setLeads(data ?? []);
    if (user.employeeDbId) {
      const { data: v } = await db().from('lead_activities').select('*').eq('kind', 'visit').eq('by_employee', user.employeeDbId).is('ended_at', null).order('started_at', { ascending: false }).limit(1);
      setOpenVisit(v?.[0] ?? null);
    }
  }, [user.employeeDbId]);

  useEffect(() => { if (access.ready && (access.canCall || access.canManage)) void load(); }, [access.ready, access.canCall, access.canManage, load]);
  useEffect(() => {
    if (!access.canManage) return;
    void db().rpc('sales_team').then(({ data }: any) => setTeam(data ?? []));
  }, [access.canManage]);
  useEffect(() => { if (access.ready) setView(access.canManage ? 'good' : 'queue'); }, [access.ready, access.canManage]);

  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of employees) m[e.id] = e.name;
    for (const t of team) m[t.employee_id] = t.name;
    return (id: string | null) => (id ? (id === user.employeeDbId ? 'You' : m[id] ?? 'Sales') : 'Unassigned');
  }, [employees, team, user.employeeDbId]);

  if (!access.ready) return <div className="mx-auto max-w-[1320px] space-y-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  if (!access.canCall && !access.canManage) {
    return <div className="mx-auto max-w-[1320px]"><Card className="p-6"><EmptyState icon={<Inbox className="w-5 h-5" />} title="Leads are for the sales team" text="Sales access comes with the Telecaller, Field Sales Executive or Sales Manager designation. Ask admin to set yours." /></Card></div>;
  }

  const all = leads ?? [];
  const mine = all.filter((l) => l.owner_id && l.owner_id === user.employeeDbId);
  const workList = access.canManage ? all : mine;
  const queue = mine.filter((l) => isOpen(l) && (l.stage === 'new' || dueState(l) === 'overdue' || dueState(l) === 'today' || !l.next_follow_up_at))
    .sort((a, b) => rank(a) - rank(b) || (a.next_follow_up_at ?? a.created_at).localeCompare(b.next_follow_up_at ?? b.created_at));
  const goodInbox = all.filter((l) => l.stage === 'good' || l.stage === 'with_admin').sort((a, b) => (b.qualified_at ?? '').localeCompare(a.qualified_at ?? ''));

  const listed = workList.filter((l) =>
    (stageFilter === 'all' || (stageFilter === 'open' ? isOpen(l) : l.stage === stageFilter)) &&
    (ownerFilter === 'all' || (ownerFilter === 'none' ? !l.owner_id : l.owner_id === ownerFilter)) &&
    (sourceFilter === 'all' || l.source === sourceFilter) &&
    (!search.trim() || `${l.lead_no} ${l.contact_name} ${l.company ?? ''} ${l.phone ?? ''} ${l.email ?? ''} ${l.city ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));

  const tabs = [
    ...(access.canCall && user.employeeDbId ? [{ id: 'queue', label: 'Today', count: queue.length }] : []),
    ...(access.canManage ? [{ id: 'good', label: 'Good leads', count: goodInbox.filter((l) => l.stage === 'good').length }] : []),
    { id: 'all', label: access.canManage ? 'All leads' : 'My leads' },
    ...(access.canManage ? [{ id: 'reports', label: 'Reports' }] : []),
  ];
  const current = openId ? all.find((l) => l.id === openId) ?? null : null;
  const overdue = mine.filter((l) => dueState(l) === 'overdue').length;
  const today = mine.filter((l) => dueState(l) === 'today').length;

  return (
    <div className="mx-auto w-full max-w-[1320px] space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] sm:text-[30px] font-bold text-ink-950 tracking-tight">{access.role === 'sales_field' ? 'Visits & leads' : access.role === 'sales_caller' ? 'My calls' : 'Leads'}</h1>
          <p className="text-[14px] text-ink-500 mt-1">{access.canManage ? 'Every lead from calls and field visits. Good leads land here for you to take forward.' : access.canVisit ? 'Your leads and company visits. Mark a lead good once you know their need, budget, timeline and decision maker.' : 'Call your leads, set follow-ups, and mark good ones for admin.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {access.canManage && <button type="button" className="btn-secondary" onClick={() => setImporting(true)}><Upload className="w-4 h-4" />Import</button>}
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}><Plus className="w-4 h-4" />Add lead</button>
        </div>
      </div>

      {loadError && <Notice tone="rose">{loadError}</Notice>}
      {openVisit && <VisitBanner visit={openVisit} lead={all.find((l) => l.id === openVisit.lead_id)} onOpen={() => setOpenId(openVisit.lead_id)} />}

      {(
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {access.canManage
            ? <>
              <Stat index={0} icon={<Inbox className="w-5 h-5" />} tone="mint" label="Good leads waiting" value={goodInbox.filter((l) => l.stage === 'good').length} caption="Marked good, not taken yet" onClick={() => setView('good')} />
              <Stat index={1} icon={<Phone className="w-5 h-5" />} tone="brand" label="Open leads" value={all.filter(isOpen).length} caption={`${all.filter((l) => l.stage === 'new').length} not called yet`} />
              <Stat index={2} icon={<Clock3 className="w-5 h-5" />} tone="rose" label="Follow-ups overdue" value={all.filter((l) => dueState(l) === 'overdue').length} caption="Across the team" />
              <Stat index={3} icon={<CheckCircle2 className="w-5 h-5" />} tone="dark" label="Became clients" value={all.filter((l) => l.stage === 'won').length} caption="All time" />
            </>
            : <>
              <Stat index={0} icon={<Inbox className="w-5 h-5" />} tone="sky" label="New" value={mine.filter((l) => l.stage === 'new').length} caption="Not called yet" onClick={() => setView('queue')} />
              <Stat index={1} icon={<Clock3 className="w-5 h-5" />} tone="amber" label="Due today" value={today} caption="Follow-ups for today" onClick={() => setView('queue')} />
              <Stat index={2} icon={<Clock3 className="w-5 h-5" />} tone="rose" label="Overdue" value={overdue} caption="Missed follow-ups" onClick={() => setView('queue')} />
              <Stat index={3} icon={<CheckCircle2 className="w-5 h-5" />} tone="mint" label="Good leads" value={mine.filter((l) => l.stage === 'good' || l.stage === 'with_admin' || l.stage === 'won').length} caption="Passed to admin" />
            </>}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs value={view} onChange={setView} items={tabs} />
        <button type="button" className="btn-ghost btn-sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" />Refresh</button>
      </div>

      {leads === null ? <Skeleton className="h-64" /> : view === 'queue' ? (
        <LeadList leads={queue} nameOf={nameOf} showOwner={false} onOpen={setOpenId}
          empty={{ title: 'Nothing to call right now', text: 'New leads and today’s follow-ups show up here.' }} />
      ) : view === 'good' ? (
        <LeadList leads={goodInbox} nameOf={nameOf} showOwner onOpen={setOpenId} qualified
          empty={{ title: 'No good leads waiting', text: 'When the calling team or field sales mark a lead good, it appears here.' }} />
      ) : view === 'reports' ? (
        <LeadReports leads={all} team={team} nameOf={nameOf} />
      ) : (
        <>
          <div className="card p-3 sm:p-4 flex flex-wrap gap-3 items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, company, phone, city or L-number" className="flex-1 min-w-[220px]" />
            <select aria-label="Stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="input !w-auto !min-h-[40px] !rounded-full !py-1.5">
              <option value="open">Open</option><option value="all">All stages</option>
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {access.canManage && <select aria-label="Owner" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="input !w-auto !min-h-[40px] !rounded-full !py-1.5">
              <option value="all">Everyone</option><option value="none">Unassigned</option>
              {team.map((t) => <option key={t.employee_id} value={t.employee_id}>{t.name}</option>)}
            </select>}
            <select aria-label="Source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="input !w-auto !min-h-[40px] !rounded-full !py-1.5">
              <option value="all">All sources</option>
              {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <span className="text-[13px] text-ink-500"><b className="text-ink-900">{listed.length}</b> leads</span>
          </div>
          <LeadList leads={listed} nameOf={nameOf} showOwner={access.canManage} onOpen={setOpenId}
            empty={{ title: workList.length ? 'Nobody matches these filters' : 'No leads yet', text: workList.length ? 'Clear a filter to see more.' : 'Add the first lead to get started.' }} />
        </>
      )}

      {adding && <LeadFormModal access={access} team={team} onClose={() => setAdding(false)} onSaved={async (id) => { setAdding(false); await load(); if (id) setOpenId(id); }} />}
      {importing && <ImportModal team={team} onClose={() => setImporting(false)} onDone={load} />}
      {current && <LeadDrawer lead={current} access={access} user={user} team={team} employees={employees} nameOf={nameOf} openVisit={openVisit}
        onClose={() => setOpenId(null)} onChanged={load} onSelectTab={onSelectTab} />}
    </div>
  );
}

const rank = (l: Lead) => ({ overdue: 0, today: 1, none: 2, later: 3 }[dueState(l)] + (l.stage === 'new' ? 0 : 0.5));

/* ---------------------------------------------------------------- list */

function LeadList({ leads, nameOf, showOwner, onOpen, empty, qualified }: { leads: Lead[]; nameOf: (id: string | null) => string; showOwner: boolean; onOpen: (id: string) => void; empty: { title: string; text: string }; qualified?: boolean }) {
  if (!leads.length) return <Card className="p-2"><EmptyState icon={<Inbox className="w-5 h-5" />} title={empty.title} text={empty.text} /></Card>;
  return (
    <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="data-table">
      <thead><tr><th>Lead</th><th>Contact</th><th>{qualified ? 'Budget · timeline' : 'Source'}</th><th>Stage</th><th>{qualified ? 'Marked good' : 'Next follow-up'}</th>{showOwner && <th>Owner</th>}<th /></tr></thead>
      <tbody>{leads.map((l) => {
        const st = stageOf(l.stage); const due = dueState(l);
        return (
          <tr key={l.id} className="cursor-pointer hover:bg-ink-50/60" onClick={() => onOpen(l.id)}>
            <td><p className="font-bold text-ink-900">{l.company || l.contact_name}</p><p className="text-[11px] text-ink-400">{l.lead_no}{l.city ? ` · ${l.city}` : ''}{l.channel === 'field' ? ' · field' : ''}</p></td>
            <td><p className="text-ink-800 font-semibold">{l.contact_name}</p><p className="text-[11px] text-ink-400 font-mono">{l.phone || l.email || '—'}</p></td>
            <td className="text-[13px] text-ink-700">{qualified ? `${l.budget ?? '—'} · ${l.timeline ?? '—'}` : sourceLabel(l.source)}</td>
            <td><Badge tone={st.tone} dot>{st.label}</Badge></td>
            <td className="text-[13px]">{qualified ? when(l.qualified_at) : l.next_follow_up_at && isOpen(l)
              ? <span className={cx('font-semibold', due === 'overdue' ? 'text-rose-700' : due === 'today' ? 'text-amber-800' : 'text-ink-700')}>{due === 'overdue' ? 'Overdue · ' : ''}{when(l.next_follow_up_at)}</span>
              : <span className="text-ink-400">{l.stage === 'new' ? 'Call now' : '—'}</span>}</td>
            {showOwner && <td className="text-[13px] text-ink-700">{nameOf(l.owner_id)}</td>}
            <td className="text-right"><ArrowRight className="w-4 h-4 text-ink-300 inline" /></td>
          </tr>
        );
      })}</tbody>
    </table></div></div>
  );
}

function VisitBanner({ visit, lead, onOpen }: { visit: Activity; lead?: Lead; onOpen: () => void }) {
  return (
    <div className="rounded-2xl border border-mint-200 bg-mint-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-[14px] text-mint-900 font-semibold"><MapPin className="w-4 h-4" />Visit in progress{lead ? ` at ${lead.company || lead.contact_name}` : ''} · since {when(visit.started_at)}</span>
      <button type="button" className="btn-primary btn-sm" onClick={onOpen}>Finish visit</button>
    </div>
  );
}

/* ---------------------------------------------------------------- add / edit */

type FormState = Record<string, string>;
const blankForm = (channel: 'calling' | 'field'): FormState => ({
  contact_name: '', company: '', designation: '', phone: '', email: '', city: '', address: '', industry: '',
  source: channel === 'field' ? 'field_visit' : 'phone_call', campaign: '', service_interest: '', notes: '', channel, owner_id: '', next_follow_up_at: '',
});

function LeadFormModal({ access, team, lead, onClose, onSaved }: { access: SalesAccess; team: TeamMember[]; lead?: Lead; onClose: () => void; onSaved: (id?: string) => Promise<void> }) {
  const [f, setF] = useState<FormState>(() => lead ? {
    contact_name: lead.contact_name, company: lead.company ?? '', designation: lead.designation ?? '', phone: lead.phone ?? '', email: lead.email ?? '',
    city: lead.city ?? '', address: lead.address ?? '', industry: lead.industry ?? '', source: lead.source, campaign: lead.campaign ?? '',
    service_interest: lead.service_interest ?? '', notes: lead.notes ?? '', channel: lead.channel, owner_id: '', next_follow_up_at: '',
  } : blankForm(access.role === 'sales_field' ? 'field' : 'calling'));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!f.contact_name.trim()) return setError('Enter the contact name.');
    if (!f.phone.trim() && !f.email.trim()) return setError('Enter a phone number or an email.');
    setBusy(true);
    try {
      const payload: any = { ...f };
      delete payload.owner_id; delete payload.next_follow_up_at;
      if (lead) {
        delete payload.channel;
        const { error } = await db().rpc('lead_update', { p_id: lead.id, p: payload });
        if (error) throw error;
        notify('Lead updated.', 'success'); await onSaved(lead.id);
      } else {
        if (access.canManage && f.owner_id) payload.owner_id = f.owner_id;
        if (f.next_follow_up_at) payload.next_follow_up_at = localToIso(f.next_follow_up_at);
        const { data, error } = await db().rpc('lead_create', { p: payload });
        if (error) throw error;
        notify(`Lead ${data?.lead_no ?? ''} added.`, 'success'); await onSaved(data?.id);
      }
    } catch (err) { setError(errText(err, 'Could not save the lead.')); } finally { setBusy(false); }
  };
  const input = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block"><span className="label">{label}</span><input value={f[k]} onChange={(e) => set(k, e.target.value)} className="input" {...props} /></label>
  );
  return (
    <Modal title={lead ? `Edit ${lead.lead_no}` : 'Add lead'} onClose={onClose} closeDisabled={busy} wide>
      {error && <Notice tone="rose">{error}</Notice>}
      <form onSubmit={save} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {input('contact_name', 'Contact name', { required: true, maxLength: 120 })}
          {input('company', 'Company / brand', { maxLength: 160 })}
          {input('phone', 'Phone', { inputMode: 'tel', maxLength: 20, placeholder: '98xxxxxxxx' })}
          {input('email', 'Email', { type: 'email', maxLength: 160 })}
          {input('designation', 'Their role', { maxLength: 80, placeholder: 'Owner, marketing head…' })}
          {input('industry', 'Industry', { maxLength: 80, placeholder: 'Restaurant, real estate…' })}
          {input('city', 'City / area', { maxLength: 80 })}
          {input('service_interest', 'Interested in', { maxLength: 200, placeholder: 'Social media, branding, ads…' })}
          <label className="block"><span className="label">Source</span><select value={f.source} onChange={(e) => set('source', e.target.value)} className="input">{SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          {input('campaign', 'Campaign', { maxLength: 120, placeholder: 'Optional' })}
          {!lead && (access.canVisit || access.canManage) && <label className="block"><span className="label">Team</span><select value={f.channel} onChange={(e) => set('channel', e.target.value)} className="input"><option value="calling">Calling</option>{access.canVisit && <option value="field">Field visit</option>}</select></label>}
          {!lead && access.canManage && <label className="block"><span className="label">Give to</span><select value={f.owner_id} onChange={(e) => set('owner_id', e.target.value)} className="input"><option value="">{access.role ? 'Me' : 'Unassigned'}</option>{team.map((t) => <option key={t.employee_id} value={t.employee_id}>{t.name} · {salesRoleLabel(t.role_code)}</option>)}</select></label>}
          {!lead && <label className="block"><span className="label">First follow-up <span className="font-normal text-ink-400 ml-1">optional</span></span><input type="datetime-local" value={f.next_follow_up_at} onChange={(e) => set('next_follow_up_at', e.target.value)} className="input" /></label>}
          <label className="block md:col-span-2"><span className="label">Address</span><input value={f.address} onChange={(e) => set('address', e.target.value)} className="input" maxLength={400} /></label>
          <label className="block md:col-span-2"><span className="label">Notes</span><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} className="input min-h-[80px]" maxLength={2000} /></label>
        </div>
        <p className="text-[12px] text-ink-500">If this phone or email is already in leads, it won’t be added twice — you’ll see whose lead it is.</p>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : lead ? 'Save changes' : 'Add lead'}</button></div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- detail */

function LeadDrawer({ lead, access, user, team, employees, nameOf, openVisit, onClose, onChanged, onSelectTab }: {
  lead: Lead; access: SalesAccess; user: any; team: TeamMember[]; employees: Employee[]; nameOf: (id: string | null) => string; openVisit: Activity | null;
  onClose: () => void; onChanged: () => Promise<void>; onSelectTab?: (t: string) => void;
}) {
  const [acts, setActs] = useState<Activity[] | null>(null);
  const [panel, setPanel] = useState<null | 'call' | 'good' | 'lost' | 'note' | 'visit_end' | 'edit' | 'convert' | 'assign'>(null);
  const [busy, setBusy] = useState(false);
  const [child, setChild] = useState(false);
  const loadActs = useCallback(async () => {
    const { data } = await db().from('lead_activities').select('*').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(200);
    setActs(data ?? []);
  }, [lead.id]);
  useEffect(() => { void loadActs(); }, [loadActs, lead.updated_at]);

  const isMine = !!lead.owner_id && lead.owner_id === user.employeeDbId;
  const canWork = access.canManage || (access.canCall && isMine);
  const st = stageOf(lead.stage);
  const visitHere = openVisit && openVisit.lead_id === lead.id ? openVisit : null;
  const done = async (msg: string) => { notify(msg, 'success'); setPanel(null); await onChanged(); await loadActs(); };
  const rpc = async (fn: string, args: any, msg: string) => {
    setBusy(true);
    try { const { error } = await db().rpc(fn, args); if (error) throw error; await done(msg); }
    catch (e) { notify(errText(e, 'That didn’t work.'), 'error', 7000); } finally { setBusy(false); }
  };
  const startVisit = async () => {
    setBusy(true);
    try {
      const fix = await getFix();
      const { error } = await db().rpc('lead_visit_start', { p_id: lead.id, p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy });
      if (error) throw error;
      await done('Visit started. Finish it when you leave.');
    } catch (e) { notify(e instanceof GeoError ? `${e.message} Allow location to log a visit.` : errText(e, 'Could not start the visit.'), 'error', 8000); }
    finally { setBusy(false); }
  };

  if (panel === 'edit') return <LeadFormModal access={access} team={team} lead={lead} onClose={() => setPanel(null)} onSaved={async () => { setPanel(null); await onChanged(); await loadActs(); }} />;
  return (
    <Modal title={`${lead.lead_no} · ${lead.company || lead.contact_name}`} onClose={onClose} closeDisabled={busy || child} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={st.tone} dot>{st.label}</Badge>
          <Badge tone="ink">{sourceLabel(lead.source)}</Badge>
          {lead.channel === 'field' && <Badge tone="sky">Field</Badge>}
          <span className="text-[12.5px] text-ink-500">Owner: <b className="text-ink-800">{nameOf(lead.owner_id)}</b> · {lead.call_count} calls · {lead.visit_count} visits</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <Info label="Contact" value={`${lead.contact_name}${lead.designation ? ` · ${lead.designation}` : ''}`} />
          <Info label="Phone" value={lead.phone ? <a className="text-brand-700 font-semibold" href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}>{lead.phone}</a> : '—'} />
          <Info label="Email" value={lead.email ? <a className="text-brand-700 font-semibold" href={`mailto:${lead.email}`}>{lead.email}</a> : '—'} />
          <Info label="City" value={lead.city || '—'} />
          <Info label="Industry" value={lead.industry || '—'} />
          <Info label="Interested in" value={lead.service_interest || '—'} />
          {lead.campaign && <Info label="Campaign" value={lead.campaign} />}
          <Info label="Next follow-up" value={isOpen(lead) ? when(lead.next_follow_up_at) : '—'} />
          {lead.address && <Info label="Address" value={lead.address} />}
        </div>
        {lead.notes && <p className="text-[13px] text-ink-700 bg-ink-50 rounded-xl px-3 py-2 whitespace-pre-wrap">{lead.notes}</p>}

        {(lead.need || lead.budget) && (
          <div className="rounded-2xl border border-mint-200 bg-mint-50/60 p-4 grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <Info label="Need" value={lead.need || '—'} /><Info label="Budget" value={lead.budget || '—'} />
            <Info label="Timeline" value={lead.timeline || '—'} /><Info label="Decision maker" value={lead.decision_maker || '—'} />
          </div>
        )}
        {lead.stage === 'lost' && lead.lost_reason && <Notice tone="rose">{`Lost: ${lead.lost_reason}`}</Notice>}

        {canWork && lead.stage !== 'won' && (
          <div className="flex flex-wrap gap-2">
            {lead.stage !== 'lost' && <button type="button" className="btn-primary btn-sm" onClick={() => setPanel('call')} disabled={busy}><Phone className="w-4 h-4" />Log call</button>}
            {lead.stage !== 'lost' && access.canVisit && user.employeeDbId && (visitHere
              ? <button type="button" className="btn-primary btn-sm" onClick={() => setPanel('visit_end')} disabled={busy}><MapPin className="w-4 h-4" />Finish visit</button>
              : <button type="button" className="btn-secondary btn-sm" onClick={() => void startVisit()} disabled={busy || !!openVisit} title={openVisit ? 'Finish your other visit first' : undefined}><MapPin className="w-4 h-4" />{busy ? 'Getting location…' : 'Start visit'}</button>)}
            {isOpen(lead) && <button type="button" className="btn-secondary btn-sm" onClick={() => setPanel('good')} disabled={busy}><CheckCircle2 className="w-4 h-4" />Mark good</button>}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPanel('note')} disabled={busy}><MessageSquare className="w-4 h-4" />Note</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPanel('edit')} disabled={busy}><Pencil className="w-4 h-4" />Edit</button>
            {lead.stage !== 'lost' && (isOpen(lead) || access.canManage) && <button type="button" className="btn-ghost btn-sm text-rose-700" onClick={() => setPanel('lost')} disabled={busy}><XCircle className="w-4 h-4" />Lost</button>}
          </div>
        )}
        {access.canManage && (
          <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4">
            <span className="text-[12px] font-bold uppercase tracking-wider text-ink-400 self-center mr-1">Manager</span>
            {lead.stage !== 'won' && <button type="button" className="btn-secondary btn-sm" onClick={() => setPanel('assign')} disabled={busy}><UserPlus className="w-4 h-4" />Assign</button>}
            {lead.stage === 'good' && <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void rpc('lead_take', { p_id: lead.id }, 'You’ve taken this lead.')}><Inbox className="w-4 h-4" />Take it</button>}
            {(lead.stage === 'good' || lead.stage === 'with_admin') && user.role === 'admin' && <button type="button" className="btn-primary btn-sm" onClick={() => setPanel('convert')} disabled={busy}><Building2 className="w-4 h-4" />Make client</button>}
            {lead.stage === 'lost' && <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void rpc('lead_reopen', { p_id: lead.id, p_note: null }, 'Lead reopened.')}><RotateCcw className="w-4 h-4" />Reopen</button>}
            {lead.stage === 'won' && lead.client_id && <button type="button" className="btn-secondary btn-sm" onClick={() => onSelectTab?.('admin-clients')}><Building2 className="w-4 h-4" />Open clients</button>}
          </div>
        )}

        {panel === 'call' && <CallPanel busy={busy} onCancel={() => setPanel(null)} onSave={(o, n, next) => void rpc('lead_log_call', { p_id: lead.id, p_outcome: o, p_note: n || null, p_next: next }, 'Call logged.')} />}
        {panel === 'visit_end' && visitHere && <VisitEndPanel busy={busy} setBusy={setBusy} visit={visitHere} onCancel={() => setPanel(null)} onDone={() => done('Visit logged.')} />}
        {panel === 'good' && <GoodPanel lead={lead} busy={busy} onCancel={() => setPanel(null)} onSave={(a) => void rpc('lead_mark_good', { p_id: lead.id, ...a }, 'Marked good. Admin has been told.')} />}
        {panel === 'lost' && <LostPanel busy={busy} onCancel={() => setPanel(null)} onSave={(r, n) => void rpc('lead_mark_lost', { p_id: lead.id, p_reason: r, p_note: n || null }, 'Marked lost.')} />}
        {panel === 'note' && <NotePanel busy={busy} onCancel={() => setPanel(null)} onSave={(n) => void rpc('lead_add_note', { p_id: lead.id, p_note: n }, 'Note added.')} />}
        {panel === 'assign' && <AssignPanel team={team} current={lead.owner_id} busy={busy} onCancel={() => setPanel(null)} onSave={(emp) => void rpc('lead_assign', { p_id: lead.id, p_employee: emp || null }, emp ? 'Lead assigned.' : 'Lead unassigned.')} />}
        {panel === 'convert' && <ConvertPanel lead={lead} employees={employees} busy={busy} onCreating={setChild} onCancel={() => setPanel(null)} onLink={(clientId) => void rpc('lead_mark_won', { p_id: lead.id, p_client_id: clientId }, 'Lead is now a client. 🎉')} />}

        <div>
          <h3 className="text-[13px] font-bold text-ink-900 mb-2">History</h3>
          {acts === null ? <Skeleton className="h-20" /> : !acts.length ? <p className="text-[13px] text-ink-500">Nothing yet.</p> : (
            <ol className="space-y-2">{acts.map((a) => <ActivityRow key={a.id} a={a} nameOf={nameOf} />)}</ol>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3 py-2 border-b border-ink-100 text-[13px]"><span className="text-ink-500 shrink-0">{label}</span><span className="text-ink-900 font-semibold text-right break-words min-w-0">{value}</span></div>;
}

function ActivityRow({ a, nameOf }: { a: Activity; nameOf: (id: string | null) => string }) {
  const who = a.by_employee ? nameOf(a.by_employee) : 'Admin';
  const title = a.kind === 'call' ? `Call · ${OUTCOME_LABEL[a.outcome ?? ''] ?? ''}`
    : a.kind === 'visit' ? (a.ended_at ? `Visit · ${OUTCOME_LABEL[a.outcome ?? ''] ?? ''}` : 'Visit in progress')
    : a.kind === 'stage' ? (a.outcome ? OUTCOME_LABEL[a.outcome] : a.metadata?.to === 'with_admin' ? 'Taken by admin' : a.metadata?.reopened ? 'Reopened' : 'Stage changed')
    : a.kind === 'assign' ? `Assigned to ${a.metadata?.to ? nameOf(a.metadata.to) : 'nobody'}`
    : a.kind === 'convert' ? 'Became a client' : a.kind === 'created' ? 'Lead added' : a.kind === 'import' ? 'Imported' : 'Note';
  const mins = a.started_at && a.ended_at ? Math.round((new Date(a.ended_at).getTime() - new Date(a.started_at).getTime()) / 60000) : null;
  const map = a.start_lat != null && a.start_lng != null ? `https://www.google.com/maps?q=${a.start_lat},${a.start_lng}` : null;
  return (
    <li className="rounded-xl border border-ink-100 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink-900">{title}</span>
        <span className="text-[11.5px] text-ink-400">{who} · {when(a.created_at)}</span>
      </div>
      {(a.note || a.metadata?.reason) && <p className="text-[12.5px] text-ink-700 mt-1 whitespace-pre-wrap">{a.metadata?.reason ? `${a.metadata.reason}${a.note ? ' — ' : ''}` : ''}{a.note}</p>}
      {a.kind === 'visit' && <p className="text-[11.5px] text-ink-500 mt-1">{mins != null ? `${mins} min · ` : ''}{map && <a className="text-brand-700 font-semibold" href={map} target="_blank" rel="noopener noreferrer">See location</a>}{a.start_accuracy != null ? ` (±${Math.round(a.start_accuracy)} m)` : ''}</p>}
    </li>
  );
}

function PanelBox({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-2xl border border-brand-200 bg-brand-50/40 p-4 space-y-3"><h3 className="text-[14px] font-bold text-ink-900">{title}</h3>{children}</div>;
}
function PanelActions({ busy, onCancel, label }: { busy: boolean; onCancel: () => void; label: string }) {
  return <div className="flex justify-end gap-2"><button type="button" className="btn-secondary btn-sm" onClick={onCancel} disabled={busy}>Cancel</button><button className="btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : label}</button></div>;
}
function FollowUpPicker({ value, onChange, required }: { value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <span className="label">Next follow-up {required ? '' : <span className="font-normal text-ink-400 ml-1">optional</span>}</span>
      <div className="flex flex-wrap gap-2 mb-2">
        {[{ l: 'Tomorrow', v: inDays(1) }, { l: 'In 3 days', v: inDays(3) }, { l: 'Next week', v: inDays(7) }].map((q) => (
          <button key={q.l} type="button" onClick={() => onChange(q.v)} className={cx('rounded-full px-3 py-1.5 text-[12px] font-semibold', value === q.v ? 'bg-ink-950 text-white' : 'bg-white border border-ink-200 text-ink-700')}>{q.l}</button>
        ))}
        {value && <button type="button" onClick={() => onChange('')} className="text-[12px] font-semibold text-ink-500">Clear</button>}
      </div>
      <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} className="input" required={required} />
    </div>
  );
}

function CallPanel({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (outcome: string, note: string, next: string | null) => void }) {
  const [o, setO] = useState(''); const [n, setN] = useState(''); const [next, setNext] = useState('');
  return (
    <PanelBox title="How did the call go?">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!o) return notify('Choose what happened on the call.', 'error'); if (o === 'call_back' && !next) return notify('Pick when to call back.', 'error'); onSave(o, n, localToIso(next)); }}>
        <div className="flex flex-wrap gap-2">{CALL_OUTCOMES.map((c) => <button key={c.id} type="button" onClick={() => setO(c.id)} className={cx('rounded-full px-3 py-1.5 text-[12.5px] font-semibold', o === c.id ? 'bg-ink-950 text-white' : 'bg-white border border-ink-200 text-ink-700')}>{c.label}</button>)}</div>
        <textarea value={n} onChange={(e) => setN(e.target.value)} className="input min-h-[70px]" placeholder="What did they say?" maxLength={2000} />
        <FollowUpPicker value={next} onChange={setNext} required={o === 'call_back'} />
        {(o === 'not_interested' || o === 'wrong_number') && <p className="text-[12px] text-ink-600">If this lead is finished, use <b>Lost</b> after saving.</p>}
        {o === 'interested' && <p className="text-[12px] text-ink-600">Know their need, budget, timeline and who decides? Use <b>Mark good</b> after saving.</p>}
        <PanelActions busy={busy} onCancel={onCancel} label="Save call" />
      </form>
    </PanelBox>
  );
}

function VisitEndPanel({ busy, setBusy, visit, onCancel, onDone }: { busy: boolean; setBusy: (b: boolean) => void; visit: Activity; onCancel: () => void; onDone: () => Promise<void> }) {
  const [o, setO] = useState(''); const [n, setN] = useState(''); const [next, setNext] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!o) return notify('Choose how the visit went.', 'error');
    if (o === 'follow_up' && !next) return notify('Pick the follow-up date.', 'error');
    setBusy(true);
    try {
      const fix = await getFix();
      const { error } = await db().rpc('lead_visit_end', { p_activity: visit.id, p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy, p_outcome: o, p_note: n || null, p_next: localToIso(next) });
      if (error) throw error;
      await onDone();
    } catch (err) { notify(err instanceof GeoError ? `${err.message} Allow location to finish the visit.` : errText(err, 'Could not finish the visit.'), 'error', 8000); }
    finally { setBusy(false); }
  };
  return (
    <PanelBox title="Finish the visit">
      <form className="space-y-3" onSubmit={save}>
        <p className="text-[12.5px] text-ink-600">Started {when(visit.started_at)}. Your location is recorded again when you finish.</p>
        <div className="flex flex-wrap gap-2">{VISIT_OUTCOMES.map((c) => <button key={c.id} type="button" onClick={() => setO(c.id)} className={cx('rounded-full px-3 py-1.5 text-[12.5px] font-semibold', o === c.id ? 'bg-ink-950 text-white' : 'bg-white border border-ink-200 text-ink-700')}>{c.label}</button>)}</div>
        <textarea value={n} onChange={(e) => setN(e.target.value)} className="input min-h-[70px]" placeholder="Who did you meet? What did they say?" maxLength={2000} />
        <FollowUpPicker value={next} onChange={setNext} required={o === 'follow_up'} />
        <PanelActions busy={busy} onCancel={onCancel} label={busy ? 'Getting location…' : 'Finish visit'} />
      </form>
    </PanelBox>
  );
}

function GoodPanel({ lead, busy, onCancel, onSave }: { lead: Lead; busy: boolean; onCancel: () => void; onSave: (a: any) => void }) {
  const [a, setA] = useState({ p_need: lead.need ?? lead.service_interest ?? '', p_budget: lead.budget ?? '', p_timeline: lead.timeline ?? '', p_decision_maker: lead.decision_maker ?? '', p_note: '' });
  const set = (k: string, v: string) => setA((x) => ({ ...x, [k]: v }));
  return (
    <PanelBox title="Mark as a good lead">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave({ ...a, p_note: a.p_note || null }); }}>
        <p className="text-[12.5px] text-ink-600">A good lead has all four answers. Admin is told straight away.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block md:col-span-2"><span className="label">What do they need?</span><input className="input" value={a.p_need} onChange={(e) => set('p_need', e.target.value)} required maxLength={1000} placeholder="Instagram management + 2 reels a week" /></label>
          <label className="block"><span className="label">Budget</span><input className="input" value={a.p_budget} onChange={(e) => set('p_budget', e.target.value)} required maxLength={120} placeholder="₹40k / month" /></label>
          <label className="block"><span className="label">When do they want to start?</span><input className="input" value={a.p_timeline} onChange={(e) => set('p_timeline', e.target.value)} required maxLength={120} placeholder="From next month" /></label>
          <label className="block md:col-span-2"><span className="label">Who decides?</span><input className="input" value={a.p_decision_maker} onChange={(e) => set('p_decision_maker', e.target.value)} required maxLength={120} placeholder="Owner — Ravi (spoke directly)" /></label>
          <label className="block md:col-span-2"><span className="label">Anything else for admin <span className="font-normal text-ink-400 ml-1">optional</span></span><textarea className="input min-h-[60px]" value={a.p_note} onChange={(e) => set('p_note', e.target.value)} maxLength={2000} /></label>
        </div>
        <PanelActions busy={busy} onCancel={onCancel} label="Mark good" />
      </form>
    </PanelBox>
  );
}

function LostPanel({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (reason: string, note: string) => void }) {
  const [r, setR] = useState(''); const [other, setOther] = useState(''); const [n, setN] = useState('');
  return (
    <PanelBox title="Why is this lead lost?">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const reason = r === 'Other' ? other.trim() : r; if (!reason) return notify('Say why the lead is lost.', 'error'); onSave(reason, n); }}>
        <div className="flex flex-wrap gap-2">{LOST_REASONS.map((x) => <button key={x} type="button" onClick={() => setR(x)} className={cx('rounded-full px-3 py-1.5 text-[12.5px] font-semibold', r === x ? 'bg-ink-950 text-white' : 'bg-white border border-ink-200 text-ink-700')}>{x}</button>)}</div>
        {r === 'Other' && <input className="input" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Reason" maxLength={400} required />}
        <textarea value={n} onChange={(e) => setN(e.target.value)} className="input min-h-[60px]" placeholder="Note (optional)" maxLength={2000} />
        <PanelActions busy={busy} onCancel={onCancel} label="Mark lost" />
      </form>
    </PanelBox>
  );
}

function NotePanel({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (n: string) => void }) {
  const [n, setN] = useState('');
  return (
    <PanelBox title="Add a note">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (n.trim()) onSave(n.trim()); }}>
        <textarea value={n} onChange={(e) => setN(e.target.value)} className="input min-h-[70px]" maxLength={2000} required />
        <PanelActions busy={busy} onCancel={onCancel} label="Add note" />
      </form>
    </PanelBox>
  );
}

function AssignPanel({ team, current, busy, onCancel, onSave }: { team: TeamMember[]; current: string | null; busy: boolean; onCancel: () => void; onSave: (emp: string) => void }) {
  const [v, setV] = useState(current ?? '');
  return (
    <PanelBox title="Give this lead to">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
        <select className="input" value={v} onChange={(e) => setV(e.target.value)}>
          <option value="">Nobody (unassigned)</option>
          {team.map((t) => <option key={t.employee_id} value={t.employee_id}>{t.name} · {salesRoleLabel(t.role_code)}</option>)}
        </select>
        {!team.length && <p className="text-[12px] text-ink-600">Nobody is in the sales team yet. Give employees the Telecaller, Field Sales Executive or Sales Manager designation.</p>}
        <PanelActions busy={busy} onCancel={onCancel} label="Assign" />
      </form>
    </PanelBox>
  );
}

function ConvertPanel({ lead, employees, busy, onCreating, onCancel, onLink }: { lead: Lead; employees: Employee[]; busy: boolean; onCreating: (b: boolean) => void; onCancel: () => void; onLink: (clientId: string) => void }) {
  const [clients, setClients] = useState<{ id: string; company_name: string }[]>([]);
  const [pick, setPick] = useState(''); const [creating, setCreatingRaw] = useState(false);
  const setCreating = (b: boolean) => { setCreatingRaw(b); onCreating(b); };
  const [created, setCreated] = useState<string | null>(null);
  useEffect(() => { void db().from('clients').select('id, company_name').is('deleted_at', null).order('company_name').then(({ data }: any) => setClients(data ?? [])); }, []);
  return (
    <PanelBox title="Make this lead a client">
      <p className="text-[12.5px] text-ink-600">Create the client account (they get a portal invite), or link a client you already added.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)} disabled={busy}><Plus className="w-4 h-4" />Create client from this lead</button>
      </div>
      <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); if (pick) onLink(pick); }}>
        <label className="block flex-1 min-w-[220px]"><span className="label">Or link an existing client</span>
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Choose client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
        </label>
        <button className="btn-secondary btn-sm" disabled={busy || !pick}>Link</button>
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </form>
      {creating && <ClientCreationModal employees={employees} initial={{ companyName: lead.company ?? '', primaryContact: lead.contact_name, email: lead.email ?? '' }}
        onClose={() => { setCreating(false); if (created) onLink(created); }} onCreated={(clientId) => { if (clientId) setCreated(clientId); }} />}
      {created && !creating && <p className="text-[12.5px] text-mint-800">Client created — linking the lead…</p>}
    </PanelBox>
  );
}

/* ---------------------------------------------------------------- import */

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const HEADER_MAP: Record<string, string> = {
  name: 'contact_name', 'contact name': 'contact_name', contact: 'contact_name', 'full name': 'contact_name', contact_name: 'contact_name',
  company: 'company', brand: 'company', business: 'company', 'company name': 'company',
  phone: 'phone', mobile: 'phone', 'phone number': 'phone', number: 'phone', whatsapp: 'phone',
  email: 'email', 'email address': 'email', city: 'city', location: 'city', area: 'city', industry: 'industry', category: 'industry',
  source: 'source', campaign: 'campaign', 'campaign name': 'campaign', service: 'service_interest', 'interested in': 'service_interest', service_interest: 'service_interest',
  designation: 'designation', role: 'designation', notes: 'notes', note: 'notes', remarks: 'notes',
};

function ImportModal({ team, onClose, onDone }: { team: TeamMember[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [text, setText] = useState(''); const [owner, setOwner] = useState(''); const [source, setSource] = useState('other');
  const [busy, setBusy] = useState(false); const [result, setResult] = useState<{ created: number; skipped: { row: number; reason: string }[] } | null>(null);
  const rows = useMemo(() => {
    const t = parseCsv(text); if (t.length < 2) return [];
    const head = t[0].map((h) => HEADER_MAP[h.trim().toLowerCase()] ?? '');
    return t.slice(1).map((r) => { const o: Record<string, string> = {}; head.forEach((k, i) => { if (k && r[i]?.trim()) o[k] = r[i].trim(); }); if (o.source) { const s = SOURCES.find((x) => x.label.toLowerCase() === o.source.toLowerCase() || x.id === o.source.toLowerCase()); o.source = s?.id ?? 'other'; } return o; });
  }, [text]);
  const mapped = useMemo(() => { const t = parseCsv(text); return t[0]?.map((h) => HEADER_MAP[h.trim().toLowerCase()]).filter(Boolean) ?? []; }, [text]);
  const run = async () => {
    if (!rows.length) return notify('Paste rows with a header line first.', 'error');
    if (rows.length > 1000) return notify('Import up to 1000 rows at a time.', 'error');
    setBusy(true);
    try {
      const { data, error } = await db().rpc('lead_import', { p_rows: rows, p_owner: owner || null, p_source: source });
      if (error) throw error;
      setResult(data); notify(`${data.created} leads imported.`, 'success'); await onDone();
    } catch (e) { notify(errText(e, 'Import failed.'), 'error', 7000); } finally { setBusy(false); }
  };
  return (
    <Modal title="Import leads" onClose={onClose} closeDisabled={busy} wide>
      <div className="space-y-4">
        <p className="text-[13px] text-ink-600">Open your sheet (Meta / Google lead export, Excel…), copy the rows <b>with the header line</b>, and paste them here. Or upload a .csv file. Columns we read: name, company, phone, email, city, industry, source, campaign, service, notes. Duplicates are skipped.</p>
        <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { if (f.size > 2_000_000) return notify('File is too big (2 MB max).', 'error'); setText(await f.text()); } }} className="block text-[12px]" />
        <textarea value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} className="input min-h-[160px] font-mono text-[12px]" placeholder={'name,company,phone,city\nRavi,Spice Route,9876543210,Hyderabad'} />
        {text && <p className="text-[12.5px] text-ink-600"><b>{rows.length}</b> rows · columns found: {mapped.length ? mapped.join(', ') : <span className="text-rose-700">none — check the header line</span>}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block"><span className="label">Give these leads to</span><select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Nobody yet (assign later)</option>{team.map((t) => <option key={t.employee_id} value={t.employee_id}>{t.name} · {salesRoleLabel(t.role_code)}</option>)}</select></label>
          <label className="block"><span className="label">Source when the sheet has none</span><select className="input" value={source} onChange={(e) => setSource(e.target.value)}>{SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        </div>
        {result && (
          <div className="rounded-2xl border border-ink-100 p-4">
            <p className="text-[14px] font-bold text-ink-900">{result.created} added · {result.skipped.length} skipped</p>
            {!!result.skipped.length && <ul className="mt-2 max-h-40 overflow-auto text-[12.5px] text-ink-700 space-y-0.5">{result.skipped.map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul>}
          </div>
        )}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>{result ? 'Close' : 'Cancel'}</button>{!result && <button type="button" className="btn-primary" onClick={() => void run()} disabled={busy || !rows.length}>{busy ? 'Importing…' : `Import ${rows.length || ''} leads`}</button>}</div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- reports */

function LeadReports({ leads, team, nameOf }: { leads: Lead[]; team: TeamMember[]; nameOf: (id: string | null) => string }) {
  const [range, setRange] = useState<'30' | '90' | 'all'>('30');
  const from = range === 'all' ? 0 : Date.now() - Number(range) * 86400000;
  const inRange = leads.filter((l) => new Date(l.created_at).getTime() >= from);
  const good = (l: Lead) => l.stage === 'good' || l.stage === 'with_admin' || l.stage === 'won';
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const firstCallHours = (ls: Lead[]) => {
    const xs = ls.filter((l) => l.first_contacted_at).map((l) => (new Date(l.first_contacted_at!).getTime() - new Date(l.created_at).getTime()) / 3600000);
    if (!xs.length) return '—';
    const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
    return avg < 1 ? `${Math.round(avg * 60)} min` : avg < 48 ? `${avg.toFixed(1)} h` : `${Math.round(avg / 24)} days`;
  };
  const bySource = SOURCES.map((s) => { const ls = inRange.filter((l) => l.source === s.id); return { ...s, n: ls.length, good: ls.filter(good).length, won: ls.filter((l) => l.stage === 'won').length }; }).filter((x) => x.n);
  const owners = Array.from(new Set([...team.map((t) => t.employee_id), ...inRange.map((l) => l.owner_id).filter(Boolean) as string[]]));
  const byPerson = owners.map((id) => { const ls = inRange.filter((l) => l.owner_id === id); return { id, n: ls.length, calls: ls.reduce((a, l) => a + l.call_count, 0), visits: ls.reduce((a, l) => a + l.visit_count, 0), good: ls.filter(good).length, won: ls.filter((l) => l.stage === 'won').length, overdue: ls.filter((l) => dueState(l) === 'overdue').length, first: firstCallHours(ls) }; });
  const lostReasons = Object.entries(inRange.filter((l) => l.stage === 'lost').reduce<Record<string, number>>((m, l) => { const k = l.lost_reason ?? 'Other'; m[k] = (m[k] ?? 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3"><PillTabs size="sm" value={range} onChange={setRange} items={[{ id: '30', label: 'Last 30 days' }, { id: '90', label: '90 days' }, { id: 'all', label: 'All time' }]} /><span className="text-[12.5px] text-ink-500">By the date the lead was added</span></div>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Stat index={0} icon={<Inbox className="w-5 h-5" />} tone="brand" label="Leads added" value={inRange.length} />
        <Stat index={1} icon={<CheckCircle2 className="w-5 h-5" />} tone="mint" label="Good leads" value={inRange.filter(good).length} caption={`${pct(inRange.filter(good).length, inRange.length)} of leads`} />
        <Stat index={2} icon={<Building2 className="w-5 h-5" />} tone="dark" label="Became clients" value={inRange.filter((l) => l.stage === 'won').length} caption={`${pct(inRange.filter((l) => l.stage === 'won').length, inRange.length)} of leads`} />
        <Stat index={3} icon={<Clock3 className="w-5 h-5" />} tone="amber" label="Time to first call" value={firstCallHours(inRange)} caption="Average" />
      </div>
      <Card className="p-5"><CardHeader title="By person" subtitle="Who is calling, visiting and closing" />
        <div className="overflow-x-auto mt-3"><table className="data-table"><thead><tr><th>Person</th><th>Leads</th><th>Calls</th><th>Visits</th><th>Good</th><th>Clients</th><th>Overdue</th><th>First call</th></tr></thead>
          <tbody>{byPerson.map((p) => <tr key={p.id}><td className="font-semibold">{nameOf(p.id)}</td><td>{p.n}</td><td>{p.calls}</td><td>{p.visits}</td><td>{p.good} <span className="text-ink-400 text-[11px]">{pct(p.good, p.n)}</span></td><td>{p.won}</td><td className={p.overdue ? 'text-rose-700 font-semibold' : ''}>{p.overdue}</td><td>{p.first}</td></tr>)}
            {!byPerson.length && <tr><td colSpan={8} className="text-center text-ink-500 py-6">No sales team yet.</td></tr>}</tbody></table></div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><CardHeader title="By source" subtitle="Where good leads come from" />
          <div className="overflow-x-auto mt-3"><table className="data-table"><thead><tr><th>Source</th><th>Leads</th><th>Good</th><th>Clients</th></tr></thead>
            <tbody>{bySource.map((s) => <tr key={s.id}><td className="font-semibold">{s.label}</td><td>{s.n}</td><td>{s.good} <span className="text-ink-400 text-[11px]">{pct(s.good, s.n)}</span></td><td>{s.won}</td></tr>)}
              {!bySource.length && <tr><td colSpan={4} className="text-center text-ink-500 py-6">No leads in this period.</td></tr>}</tbody></table></div>
        </Card>
        <Card className="p-5"><CardHeader title="Why leads are lost" />
          <ul className="mt-3 space-y-2">{lostReasons.map(([r, n]) => <li key={r} className="flex items-center justify-between text-[13px]"><span className="text-ink-700">{r}</span><b>{n}</b></li>)}
            {!lostReasons.length && <li className="text-[13px] text-ink-500">No lost leads in this period.</li>}</ul>
        </Card>
      </div>
      <p className="flex items-center gap-2 text-[12px] text-ink-500"><BarChart3 className="w-4 h-4" />Ad spend and cost per lead come with Performance Marketing.</p>
    </div>
  );
}
