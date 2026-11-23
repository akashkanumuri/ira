import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Archive, Ban, CheckCircle2, ClipboardList, Eye, EyeOff, FilePlus, Pencil, Play, Plus, RotateCcw, Send, Star, Trash2, XCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { useLiveRefresh } from '../../lib/live';
import { Badge, Button, Card, EmptyState, Notice, PillTabs, SearchInput, cx } from '../../ui';
import { Modal } from '../../ui/Modal';
import type { Employee } from '../../types/attendance';
import {
  GST_RATES, OPEN_STATUSES, REQUEST_STATUS, addDaysIST, errText, fmtDate, inr, priceLabel, servicesApi, todayIST,
  type Catalogue, type PaymentTerm, type Quote, type RequestStatus, type Service, type ServiceRequest,
} from '../../lib/services';
import { ActivityList, QuoteView, RequestFiles } from './shared';

const db = () => supabase as any;
const num = (v: unknown) => Number(v ?? 0);
const key = () => (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

interface Ctx {
  cat: Catalogue; clients: { id: string; company_name: string }[]; projects: { id: string; name: string; client_id: string | null }[];
  billing: Set<string>; company: { legal_name?: string; state_code?: string; default_sac?: string } | null;
  people: Record<string, string>; employees: Employee[];
}

/** Admin: service requests inbox, quotation builder, start-work conversion and the service catalogue. */
export function AdminServices({ employees, onSelectTab }: { employees: Employee[]; onSelectTab?: (tab: string) => void }) {
  const [tab, setTab] = useState<'requests' | 'catalogue'>('requests');
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [rows, setRows] = useState<ServiceRequest[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [cat, reqs, clients, projects, billing, company, cus] = await Promise.all([
        servicesApi.catalogue(), servicesApi.requests(),
        db().from('clients').select('id, company_name').is('deleted_at', null).order('company_name'),
        db().from('projects').select('id, name, client_id').is('deleted_at', null).order('name'),
        db().from('client_billing_profiles').select('client_id'),
        db().from('company_profile').select('legal_name, state_code, default_sac').maybeSingle(),
        db().from('client_users').select('profile_id, full_name'),
      ]);
      const people: Record<string, string> = {};
      for (const e of employees) if (e.profileId) people[e.profileId] = e.name;
      for (const c of cus.data ?? []) if (c.full_name) people[c.profile_id] = c.full_name;
      setCtx({
        cat, clients: clients.data ?? [], projects: projects.data ?? [], billing: new Set((billing.data ?? []).map((b: any) => b.client_id)),
        company: company.data ?? null, people, employees: employees.filter((e) => e.status === 'active'),
      });
      setRows(reqs); setState('ready');
    } catch (e) { setError(errText(e, 'Unable to load services.')); setState('error'); }
  }, [employees]);
  useLiveRefresh(load);
  useEffect(() => { void load(); }, [load]);

  const waiting = rows.filter((r) => ['new', 'revision_requested', 'approved'].includes(r.status)).length;
  return (
    <div className="mx-auto w-full max-w-[1320px] space-y-5">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] sm:text-[34px] font-bold leading-[1.1] text-ink-950">Services</h1>
          <p className="mt-2 text-sm text-ink-500 max-w-2xl">Client requests, quotations and your service menu. An accepted quotation becomes a project with payment terms; work starts when the first payment is in.</p>
        </div>
        <PillTabs value={tab} onChange={setTab} items={[{ id: 'requests', label: 'Requests', count: waiting || undefined }, { id: 'catalogue', label: 'Service menu' }]} />
      </header>
      {state === 'error' && <Notice tone="rose">{error}</Notice>}
      {state === 'loading' && <div className="skeleton h-72 rounded-3xl" />}
      {state === 'ready' && ctx && tab === 'requests' && <Requests rows={rows} ctx={ctx} reload={load} onSelectTab={onSelectTab} />}
      {state === 'ready' && ctx && tab === 'catalogue' && <CatalogueManager cat={ctx.cat} reload={load} />}
    </div>
  );
}

/* ------------------------------------------------------------------ requests */

type Filter = 'action' | 'open' | 'closed' | 'all';
const ACTION: RequestStatus[] = ['new', 'under_review', 'quote_draft', 'revision_requested', 'approved'];

function Requests({ rows, ctx, reload, onSelectTab }: { rows: ServiceRequest[]; ctx: Ctx; reload: () => Promise<void>; onSelectTab?: (tab: string) => void }) {
  const [filter, setFilter] = useState<Filter>('action');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(() => { try { return new URLSearchParams(window.location.search).get('request'); } catch { return null; } });
  const clientName = (id: string) => ctx.clients.find((c) => c.id === id)?.company_name ?? 'Client';
  const term = q.trim().toLowerCase();
  const shown = rows.filter((r) => (filter === 'all' ? true : filter === 'action' ? ACTION.includes(r.status) : filter === 'open' ? OPEN_STATUSES.includes(r.status) : !OPEN_STATUSES.includes(r.status)))
    .filter((r) => !term || `${r.request_no} ${clientName(r.client_id)} ${r.brief} ${(r.service_request_items ?? []).map((i) => i.service_name).join(' ')}`.toLowerCase().includes(term));
  const open = rows.find((r) => r.id === openId);
  if (open) return <RequestDetail r={open} ctx={ctx} clientName={clientName(open.client_id)} onBack={() => setOpenId(null)} reload={reload} onSelectTab={onSelectTab} />;
  const count = (f: Filter) => rows.filter((r) => (f === 'action' ? ACTION.includes(r.status) : f === 'open' ? OPEN_STATUSES.includes(r.status) : !OPEN_STATUSES.includes(r.status))).length;
  return (
    <Card className="overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-ink-100 flex flex-col md:flex-row gap-3 md:items-center">
        <PillTabs size="sm" value={filter} onChange={setFilter} items={[
          { id: 'action', label: 'Needs you', count: count('action') || undefined }, { id: 'open', label: 'Open', count: count('open') || undefined },
          { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' }]} />
        <SearchInput value={q} onChange={setQ} placeholder="Search client, SR number, service…" className="md:ml-auto md:w-80" />
      </div>
      {shown.length ? (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Request</th><th>Client</th><th>Services</th><th>Owner</th><th>Status</th><th>Received</th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-ink-50/70" onClick={() => setOpenId(r.id)}>
                <td className="font-semibold tnum whitespace-nowrap">{r.request_no}</td>
                <td className="whitespace-nowrap">{clientName(r.client_id)}</td>
                <td className="max-w-[320px]"><span className="line-clamp-2">{(r.service_request_items ?? []).map((i) => i.service_name).join(', ')}</span></td>
                <td className="whitespace-nowrap text-ink-600">{ctx.employees.find((e) => e.id === r.assigned_to)?.name ?? '—'}</td>
                <td><Badge tone={REQUEST_STATUS[r.status].tone} dot>{REQUEST_STATUS[r.status].label}</Badge></td>
                <td className="whitespace-nowrap text-ink-500">{fmtDate(r.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <EmptyState icon={<ClipboardList className="w-6 h-6" />} title={rows.length ? 'Nothing here' : 'No service requests yet'} text="Clients request services from the Services tab in their portal." className="!py-12" />}
    </Card>
  );
}

function RequestDetail({ r, ctx, clientName, onBack, reload, onSelectTab }: {
  r: ServiceRequest; ctx: Ctx; clientName: string; onBack: () => void; reload: () => Promise<void>; onSelectTab?: (tab: string) => void;
}) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof servicesApi.detail>> | null>(null);
  const [note, setNote] = useState(''); const [toClient, setToClient] = useState(false); const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false); const [starting, setStarting] = useState(false); const [building, setBuilding] = useState(false);
  const loadDetail = useCallback(async () => { try { setDetail(await servicesApi.detail(r.id)); } catch (e) { notify(errText(e, 'Could not load the request.'), 'error'); } }, [r.id]);
  useEffect(() => { void loadDetail(); }, [loadDetail, r.updated_at]);
  const refresh = async () => { await reload(); await loadDetail(); };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); notify(ok, 'success'); await refresh(); } catch (e) { notify(errText(e, 'That didn’t work.'), 'error', 8000); } finally { setBusy(false); }
  };

  const quotes = detail?.quotes ?? [];
  const draft = quotes.find((q) => q.status === 'draft') ?? null;
  const latestSent = quotes.find((q) => q.status !== 'draft') ?? null;
  const quoting = ['new', 'under_review', 'quote_draft', 'quote_sent', 'revision_requested'].includes(r.status);
  const st = REQUEST_STATUS[r.status];
  const nameOf = (id: string | null) => (id ? ctx.people[id] ?? 'Team' : 'System');
  const hasBilling = ctx.billing.has(r.client_id);

  return (
    <div className="space-y-4">
      <button type="button" className="btn-ghost btn-sm w-fit" onClick={onBack}><ArrowLeft className="w-3.5 h-3.5" /> All requests</button>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px] items-start">
        <div className="space-y-4">
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-ink-400 tnum">{r.request_no} · {clientName} · received {fmtDate(r.created_at)}</p>
                <h2 className="font-display text-xl font-bold text-ink-900 mt-0.5">{(r.service_request_items ?? []).map((i) => i.service_name).join(', ')}</h2>
                <div className="mt-2 flex flex-wrap gap-2"><Badge tone={st.tone} dot>{st.label}</Badge>{r.payment_exception && <Badge tone="amber">Started before payment</Badge>}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {r.status === 'new' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => servicesApi.staffUpdate(r.id, 'review', null, null), 'Marked as under review.')}>Mark reviewing</Button>}
                {r.status === 'approved' && <Button size="sm" icon={<Play className="w-4 h-4" />} onClick={() => setStarting(true)}>Start work</Button>}
                {r.status === 'in_progress' && <Button size="sm" variant="secondary" icon={<CheckCircle2 className="w-4 h-4" />} disabled={busy} onClick={() => void act(() => servicesApi.staffUpdate(r.id, 'complete', null, null), 'Marked complete. The client has been told.')}>Mark complete</Button>}
                {['new', 'under_review', 'quote_draft', 'revision_requested', 'quote_sent', 'approved'].includes(r.status) && <button type="button" className="btn-ghost btn-sm text-rose-700" onClick={() => setDeclining(true)}><Ban className="w-4 h-4" />Decline</button>}
              </div>
            </div>
            {r.status === 'revision_requested' && latestSent?.client_note && <Notice tone="amber" title="The client asked for changes">{latestSent.client_note}</Notice>}
            {r.status === 'approved' && <Notice tone="mint" title="Quotation accepted">Start the work to create the contract and payment terms. The first payment is requested from the client straight away.</Notice>}
            {r.project_id && (
              <p className="text-[13px] text-ink-600">Project: <b>{ctx.projects.find((p) => p.id === r.project_id)?.name ?? '—'}</b>
                {onSelectTab && <button type="button" className="ml-2 text-brand-700 hover:underline" onClick={() => onSelectTab('admin-clients')}>Open in Clients</button>}
                {onSelectTab && <button type="button" className="ml-2 text-brand-700 hover:underline" onClick={() => onSelectTab('admin-finance')}>Payments</button>}</p>
            )}
            {r.payment_exception && r.exception_reason && <p className="text-[12.5px] text-amber-800">Started before payment: {r.exception_reason}</p>}
            {r.close_reason && <p className="text-[12.5px] text-ink-600">Reason: {r.close_reason}</p>}
            <div>
              <p className="label">Client brief</p>
              <p className="text-[13.5px] text-ink-700 whitespace-pre-line">{r.brief}</p>
              <p className="text-[12px] text-ink-500 mt-1">{[r.timeline && `Timeline: ${r.timeline}`, r.preferred_date && `Preferred start: ${fmtDate(r.preferred_date)}`].filter(Boolean).join(' · ') || 'No timeline given'}</p>
              {r.notes && <p className="text-[12.5px] text-ink-600 mt-1 whitespace-pre-line">{r.notes}</p>}
            </div>
          </Card>

          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display font-bold text-[17px] text-ink-900 mr-auto">Quotation</h3>
              {quoting && !draft && !building && <Button size="sm" icon={<FilePlus className="w-4 h-4" />} onClick={() => setBuilding(true)}>{latestSent ? 'New version' : 'Prepare quotation'}</Button>}
            </div>
            {quoting && !hasBilling && <Notice tone="amber">This client has no billing details yet. Add them in Finance & accounts → Clients & credit before sending a quotation (needed for the GST split).</Notice>}
            {!ctx.company?.legal_name && <Notice tone="amber">Your company details are missing. Add them in Finance & accounts → Settings.</Notice>}
            {detail && (draft || building) && quoting
              ? <QuoteBuilder r={r} ctx={ctx} draft={draft} base={latestSent} onCancel={() => setBuilding(false)} onSaved={async () => { setBuilding(false); await refresh(); }} />
              : null}
            {detail && quotes.filter((q) => q.status !== 'draft').map((q, i) => (
              <details key={q.id} open={i === 0} className="rounded-2xl border border-ink-100 p-4">
                <summary className="cursor-pointer text-[13px] font-semibold text-ink-700">Version {q.version_no} · {fmtDate(q.sent_at)} · {inr(q.grand_total)}</summary>
                <div className="mt-3"><QuoteView quote={q} /></div>
              </details>
            ))}
            {detail && !quotes.length && !building && <p className="text-[13px] text-ink-500">No quotation yet.</p>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5 space-y-3">
            <h3 className="font-display font-bold text-[15px] text-ink-900">Owner</h3>
            <select className="input" value={r.assigned_to ?? ''} disabled={busy}
              onChange={(e) => void act(() => servicesApi.staffUpdate(r.id, 'assign', e.target.value || null, null), e.target.value ? 'Assigned.' : 'Unassigned.')}>
              <option value="">Unassigned</option>
              {ctx.employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.designation ? ` · ${e.designation}` : ''}</option>)}
            </select>
            <p className="text-[11.5px] text-ink-500">The owner can see this request and is notified.</p>
          </Card>
          <Card className="p-5 space-y-3">
            <h3 className="font-display font-bold text-[15px] text-ink-900">Files</h3>
            {detail ? <RequestFiles requestId={r.id} files={detail.files} canUpload staff onChanged={loadDetail} /> : <div className="skeleton h-10 rounded-xl" />}
          </Card>
          <Card className="p-5 space-y-3">
            <h3 className="font-display font-bold text-[15px] text-ink-900">Notes & history</h3>
            <textarea className="input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder={toClient ? 'Message the client…' : 'Internal note — the client never sees this'} />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[12px] text-ink-600"><input type="checkbox" checked={toClient} onChange={(e) => setToClient(e.target.checked)} />Send to client</label>
              <Button size="sm" className="ml-auto" disabled={busy || !note.trim()} onClick={() => void act(async () => { await servicesApi.staffUpdate(r.id, 'note', toClient ? 'client' : 'internal', note.trim()); setNote(''); }, toClient ? 'Sent to the client.' : 'Note added.')}>Add</Button>
            </div>
            {detail ? <ActivityList items={[...detail.activity].reverse()} staff nameOf={nameOf} /> : <div className="skeleton h-16 rounded-xl" />}
          </Card>
        </div>
      </div>
      {declining && <DeclineDialog r={r} onClose={() => setDeclining(false)} onDone={refresh} />}
      {starting && <StartDialog r={r} ctx={ctx} quote={quotes.find((q) => q.id === r.accepted_quote_id) ?? null} onClose={() => setStarting(false)} onDone={refresh} />}
    </div>
  );
}

/* ------------------------------------------------------------------ quote builder */

interface Line { key: string; service_id: string | null; description: string; details: string; sac: string; qty: string; unit_price: string; discount: string; due_in_days: string }
const DEFAULT_TERMS: PaymentTerm[] = [{ name: 'Advance', percentage: 50 }, { name: 'Final payment', percentage: 50 }];

function QuoteBuilder({ r, ctx, draft, base, onCancel, onSaved }: {
  r: ServiceRequest; ctx: Ctx; draft: Quote | null; base: Quote | null; onCancel: () => void; onSaved: () => Promise<void>;
}) {
  const src = draft ?? base;
  const defaultSac = ctx.company?.default_sac ?? '998361';
  const fromRequest = (): Line[] => (r.service_request_items ?? []).map((i) => {
    const s = ctx.cat.services.find((x) => x.id === i.service_id);
    return {
      key: key(), service_id: i.service_id, description: i.service_name, details: '', sac: s?.sac ?? defaultSac, qty: '1',
      unit_price: s ? String(s.pricing_type === 'fixed' ? s.fixed_price ?? '' : s.price_from ?? '') : '', discount: '', due_in_days: '',
    };
  });
  const [lines, setLines] = useState<Line[]>(() => (src?.service_quote_items?.length
    ? src.service_quote_items.map((i) => ({ key: key(), service_id: i.service_id, description: i.description, details: i.details ?? '', sac: i.sac, qty: String(num(i.qty)), unit_price: String(num(i.unit_price)), discount: num(i.discount) ? String(num(i.discount)) : '', due_in_days: i.due_in_days == null ? '' : String(i.due_in_days) }))
    : fromRequest()));
  const firstGst = src?.service_quote_items?.[0]?.gst_rate ?? ctx.cat.services.find((s) => s.id === r.service_request_items?.[0]?.service_id)?.gst_rate ?? 18;
  const [gst, setGst] = useState(String(num(firstGst)));
  const [scope, setScope] = useState(src?.scope ?? r.brief);
  const [timeline, setTimeline] = useState(src?.timeline ?? r.timeline ?? '');
  const [terms, setTerms] = useState(src?.terms ?? '');
  const [validUntil, setValid] = useState(src?.valid_until && src.valid_until >= todayIST() ? src.valid_until : addDaysIST(15));
  const [pay, setPay] = useState<PaymentTerm[]>(src?.payment_terms?.length ? src.payment_terms : DEFAULT_TERMS);
  const [dueDays, setDueDays] = useState(String(src?.first_term_due_days ?? 3));
  const [busy, setBusy] = useState(false);

  const setLine = (k: string, f: keyof Line, v: string) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, [f]: v } : l)));
  const calc = lines.map((l) => Math.max(0, Math.round((num(l.qty) * num(l.unit_price) - num(l.discount)) * 100) / 100));
  const taxable = calc.reduce((a, b) => a + b, 0);
  const tax = calc.reduce((a, b) => a + Math.round(b * num(gst)) / 100, 0);
  const paySum = pay.reduce((a, t) => a + num(t.percentage), 0);
  const problem = !lines.length ? 'Add a line.' : lines.some((l) => !l.description.trim()) ? 'Every line needs a description.'
    : lines.some((l) => !/^\d{4,8}$/.test(l.sac)) ? 'SAC codes are 4–8 digits.' : lines.some((l) => num(l.qty) <= 0) ? 'Quantity must be above 0.'
    : lines.some((l) => l.unit_price === '' || num(l.unit_price) < 0) ? 'Every line needs a rate.' : lines.some((l) => num(l.discount) > num(l.qty) * num(l.unit_price)) ? 'A discount is larger than its line.'
    : pay.some((t) => !t.name.trim() || num(t.percentage) <= 0) ? 'Each payment term needs a name and a percentage.'
    : Math.abs(paySum - 100) > 0.01 ? `Payment terms add up to ${paySum}% — they must make 100%.` : !validUntil || validUntil < todayIST() ? 'Pick a valid-until date.' : '';

  const payload = () => ({
    scope, timeline, terms, valid_until: validUntil, first_term_due_days: Math.max(0, Math.min(60, Math.round(num(dueDays)))),
    payment_terms: pay.map((t) => ({ name: t.name.trim(), percentage: num(t.percentage) })),
    items: lines.map((l) => ({ service_id: l.service_id, description: l.description.trim(), details: l.details.trim() || null, sac: l.sac, qty: num(l.qty), unit_price: num(l.unit_price), discount: num(l.discount), gst_rate: num(gst), due_in_days: l.due_in_days === '' ? null : Math.round(num(l.due_in_days)) })),
  });
  const save = async (send: boolean) => {
    setBusy(true);
    try {
      const id = await servicesApi.saveQuote(r.id, payload());
      if (send) await servicesApi.sendQuote(id);
      notify(send ? 'Quotation sent. The client has been notified.' : 'Draft saved.', 'success');
      await onSaved();
    } catch (e) { notify(errText(e, 'Could not save the quotation.'), 'error', 9000); } finally { setBusy(false); }
  };
  const discard = async () => {
    if (!draft) { onCancel(); return; }
    setBusy(true);
    try { await servicesApi.discardQuote(draft.id); notify('Draft discarded.', 'success'); await onSaved(); }
    catch (e) { notify(errText(e, 'Could not discard.'), 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border-2 border-brand-100 bg-brand-50/20 p-4 space-y-4">
      <p className="text-[13px] font-semibold text-ink-800">{draft ? `Draft v${draft.version_no}` : base ? `New version (replaces v${base.version_no} when sent)` : 'New quotation'}</p>
      <div className="rounded-2xl border border-ink-100 bg-white overflow-hidden">
        <div className="overflow-x-auto"><table className="data-table">
          <thead><tr><th>Item</th><th>SAC</th><th className="text-right">Qty</th><th className="text-right">Rate ₹</th><th className="text-right">Discount ₹</th><th className="text-right">Ready in</th><th className="text-right">Amount</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={l.key}>
              <td className="min-w-[240px] space-y-1">
                <input className="input" value={l.description} onChange={(e) => setLine(l.key, 'description', e.target.value)} maxLength={300} placeholder="Line description" />
                <input className="input !text-[12px]" value={l.details} onChange={(e) => setLine(l.key, 'details', e.target.value)} maxLength={1000} placeholder="Details (optional)" />
              </td>
              <td><input className="input !w-24 font-mono" value={l.sac} inputMode="numeric" onChange={(e) => setLine(l.key, 'sac', e.target.value.replace(/\D/g, '').slice(0, 8))} /></td>
              <td><input className="input !w-20 text-right" type="number" min="0" step="0.01" value={l.qty} onChange={(e) => setLine(l.key, 'qty', e.target.value)} /></td>
              <td><input className="input !w-28 text-right" type="number" min="0" step="0.01" value={l.unit_price} onChange={(e) => setLine(l.key, 'unit_price', e.target.value)} /></td>
              <td><input className="input !w-24 text-right" type="number" min="0" step="0.01" value={l.discount} onChange={(e) => setLine(l.key, 'discount', e.target.value)} /></td>
              <td><div className="flex items-center gap-1 justify-end"><input className="input !w-16 text-right" type="number" min="0" max="730" value={l.due_in_days} onChange={(e) => setLine(l.key, 'due_in_days', e.target.value)} placeholder="—" /><span className="text-[11px] text-ink-400">days</span></div></td>
              <td className="text-right whitespace-nowrap font-semibold tnum">{inr(calc[i])}</td>
              <td>{lines.length > 1 && <button type="button" className="icon-btn text-rose-700" title="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><XCircle className="w-4 h-4" /></button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="p-3 border-t border-ink-100 flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost btn-sm" disabled={lines.length >= 50} onClick={() => setLines((ls) => [...ls, { key: key(), service_id: null, description: '', details: '', sac: defaultSac, qty: '1', unit_price: '', discount: '', due_in_days: '' }])}><Plus className="w-4 h-4" />Add line</button>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-600">GST for all lines
              <select className="input !w-24" value={gst} onChange={(e) => setGst(e.target.value)}>{GST_RATES.map((g) => <option key={g} value={g}>{g}%</option>)}</select></label>
          </div>
          <div className="text-[13px] min-w-[220px] space-y-1">
            <div className="flex justify-between"><span className="text-ink-500">Taxable</span><span className="tnum">{inr(taxable)}</span></div>
            <div className="flex justify-between"><span className="text-ink-500">GST {gst}%</span><span className="tnum">{inr(tax)}</span></div>
            <div className="flex justify-between border-t border-ink-200 pt-1.5 text-[15px] font-bold"><span>Total</span><span className="tnum">{inr(taxable + tax)}</span></div>
          </div>
        </div>
      </div>
      <p className="text-[11.5px] text-ink-500">“Ready in” sets each deliverable’s due date, counted from the day work starts. Every line becomes a deliverable on the project.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="label">Payment terms <span className={cx('font-normal ml-1', Math.abs(paySum - 100) > 0.01 ? 'text-rose-700' : 'text-ink-400')}>{paySum}% of 100%</span></p>
          {pay.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input" value={t.name} maxLength={80} onChange={(e) => setPay((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="input !w-20 text-right" type="number" min="1" max="100" value={t.percentage} onChange={(e) => setPay((p) => p.map((x, j) => (j === i ? { ...x, percentage: num(e.target.value) } : x)))} />
              <span className="text-[12px] text-ink-500">%</span>
              <span className="text-[12px] text-ink-600 tnum w-24 text-right">{inr(Math.round((taxable + tax) * num(t.percentage)) / 100)}</span>
              {pay.length > 1 && <button type="button" className="icon-btn text-rose-700" title="Remove term" onClick={() => setPay((p) => p.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></button>}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            {pay.length < 6 && <button type="button" className="btn-ghost btn-sm" onClick={() => setPay((p) => [...p, { name: `Term ${p.length + 1}`, percentage: Math.max(0, 100 - p.reduce((a, t) => a + num(t.percentage), 0)) }])}><Plus className="w-4 h-4" />Add term</button>}
            <label className="flex items-center gap-1.5 text-[12px] text-ink-600">First payment due in <input className="input !w-16 text-right" type="number" min="0" max="60" value={dueDays} onChange={(e) => setDueDays(e.target.value)} /> days</label>
          </div>
        </div>
        <div className="space-y-3">
          <label className="block"><span className="label">Valid until</span><input className="input" type="date" min={todayIST()} value={validUntil} onChange={(e) => setValid(e.target.value)} /></label>
          <label className="block"><span className="label">Timeline <span className="font-normal text-ink-400 ml-1">shown to client</span></span><input className="input" value={timeline} maxLength={600} onChange={(e) => setTimeline(e.target.value)} placeholder="e.g. 3 weeks from first payment" /></label>
        </div>
      </div>
      <label className="block"><span className="label">Scope</span><textarea className="input min-h-[80px]" value={scope} maxLength={6000} onChange={(e) => setScope(e.target.value)} /></label>
      <label className="block"><span className="label">Terms <span className="font-normal text-ink-400 ml-1">optional</span></span><textarea className="input min-h-[60px]" value={terms} maxLength={6000} onChange={(e) => setTerms(e.target.value)} placeholder="Revisions included, what’s excluded, cancellation…" /></label>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {problem && <span className="text-[12.5px] text-amber-800 mr-auto">{problem}</span>}
        <button type="button" className="btn-ghost text-rose-700" disabled={busy} onClick={() => void discard()}>{draft ? 'Discard draft' : 'Cancel'}</button>
        <Button variant="secondary" disabled={busy || !!problem} onClick={() => void save(false)}>Save draft</Button>
        <Button disabled={busy || !!problem || !ctx.billing.has(r.client_id)} icon={<Send className="w-4 h-4" />} onClick={() => void save(true)}>Send to client · {inr(taxable + tax)}</Button>
      </div>
      <p className="text-[11.5px] text-ink-500">Once sent, a quotation can’t be edited — make a new version instead. The older one is replaced for the client.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ start / decline */

function StartDialog({ r, ctx, quote, onClose, onDone }: { r: ServiceRequest; ctx: Ctx; quote: Quote | null; onClose: () => void; onDone: () => Promise<void> }) {
  const projects = ctx.projects.filter((p) => p.client_id === r.client_id);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [name, setName] = useState(() => `${(r.service_request_items ?? [])[0]?.service_name ?? 'Services'} · ${r.request_no}`.slice(0, 120));
  const [exception, setException] = useState(false); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = (mode === 'new' ? name.trim().length >= 2 : !!projectId) && (!exception || reason.trim().length >= 3);
  const go = async () => {
    setBusy(true);
    try {
      const res = await servicesApi.start(r.id, mode === 'existing' ? projectId : null, mode === 'new' ? name.trim() : null, exception, exception ? reason.trim() : null);
      notify(exception ? `Work started. ${res.deliverables} deliverable(s) created; the first payment is still requested.` : 'Contract and payment terms created. The first payment has been requested from the client.', 'success', 8000);
      await onDone(); onClose();
    } catch (e) { notify(errText(e, 'Could not start the work.'), 'error', 9000); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Start ${r.request_no}`} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        {quote && <p className="text-[13px] text-ink-700">Quotation v{quote.version_no}: <b>{inr(quote.grand_total)}</b> in {quote.payment_terms.length} payment{quote.payment_terms.length === 1 ? '' : 's'} ({quote.payment_terms.map((t) => `${t.name} ${t.percentage}%`).join(' · ')}). First payment due in {quote.first_term_due_days} day(s).</p>}
        <div className="flex gap-2">
          <button type="button" className={cx('rounded-full px-3.5 py-1.5 text-[12px] font-semibold border', mode === 'new' ? 'bg-ink-950 text-white border-ink-950' : 'bg-white text-ink-600 border-ink-200')} onClick={() => setMode('new')}>New project</button>
          <button type="button" disabled={!projects.length} className={cx('rounded-full px-3.5 py-1.5 text-[12px] font-semibold border disabled:opacity-40', mode === 'existing' ? 'bg-ink-950 text-white border-ink-950' : 'bg-white text-ink-600 border-ink-200')} onClick={() => setMode('existing')}>Add to existing project</button>
        </div>
        {mode === 'new'
          ? <label className="block"><span className="label">Project name</span><input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
          : <>
            <label className="block"><span className="label">Project</span><select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <Notice tone="amber" title="Heads-up">The client’s portal follows the newest contract on a project. Until this first payment is in, the client won’t be able to open that project’s deliverables — including older ones. A new project avoids that.</Notice>
          </>}
        <label className="flex items-start gap-2 text-[13px] text-ink-800"><input type="checkbox" className="mt-0.5" checked={exception} onChange={(e) => setException(e.target.checked)} />
          <span>Start work before the first payment <span className="text-ink-500">(admin only — recorded in the activity log)</span></span></label>
        {exception && <label className="block"><span className="label">Reason</span><input className="input" value={reason} maxLength={400} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Retainer client, payment confirmed by phone" /></label>}
        <p className="text-[12px] text-ink-500">This creates an accepted contract from the quotation, the payment terms, and requests the first payment. Deliverables are created {exception ? 'now' : 'when the first payment is received'}.</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} disabled={!ok} icon={<Play className="w-4 h-4" />} onClick={() => void go()}>Start work</Button></div>
      </div>
    </Modal>
  );
}

function DeclineDialog({ r, onClose, onDone }: { r: ServiceRequest; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await servicesApi.staffUpdate(r.id, 'reject', null, reason.trim()); notify('Declined. The client has been told.', 'success'); await onDone(); onClose(); }
    catch (e) { notify(errText(e, 'Could not decline.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Decline ${r.request_no}?`} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <p className="text-[13.5px] text-ink-700">The client sees this reason. Any open quotation is withdrawn.</p>
        <label className="block"><span className="label">Reason for the client</span><textarea className="input min-h-[80px]" value={reason} maxLength={400} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button loading={busy} disabled={reason.trim().length < 3} className="!bg-rose-600" onClick={() => void go()}>Decline</Button></div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ catalogue */

function CatalogueManager({ cat, reload }: { cat: Catalogue; reload: () => Promise<void> }) {
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [edit, setEdit] = useState<{ kind: 'category' | 'subcategory' | 'service'; item: any; parent?: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const term = q.trim().toLowerCase();
  const quick = async (kind: 'category' | 'subcategory' | 'service', id: string, patch: Record<string, unknown>, ok: string) => {
    setBusyId(id);
    try { await servicesApi.saveCatalogue(kind, id, patch); notify(ok, 'success'); await reload(); }
    catch (e) { notify(errText(e, 'Could not save.'), 'error'); } finally { setBusyId(null); }
  };
  const total = cat.services.filter((s) => !s.archived_at).length;

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5 flex flex-col md:flex-row gap-3 md:items-center">
        <SearchInput value={q} onChange={setQ} placeholder={`Search ${total} services…`} className="md:w-96" />
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-600"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
        <Button className="md:ml-auto" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setEdit({ kind: 'category', item: null })}>Category</Button>
      </Card>
      {cat.categories.map((c) => {
        const subs = cat.subcategories.filter((s) => s.category_id === c.id);
        const blocks = subs.map((sub) => ({ sub, items: cat.services.filter((s) => s.subcategory_id === sub.id && (showArchived || !s.archived_at) && (!term || s.name.toLowerCase().includes(term))) }))
          .filter((b) => !term || b.items.length);
        if (term && !blocks.length) return null;
        return (
          <Card key={c.id} className="overflow-hidden">
            <div className="px-5 py-4 border-b border-ink-100 flex flex-wrap items-center gap-2">
              <h3 className={cx('font-display font-bold text-[17px]', c.visible ? 'text-ink-900' : 'text-ink-400')}>{c.name}</h3>
              {!c.visible && <Badge tone="ink">Hidden</Badge>}
              <div className="ml-auto flex gap-1">
                <button type="button" className="icon-btn" title={c.visible ? 'Hide from clients' : 'Show to clients'} disabled={busyId === c.id} onClick={() => void quick('category', c.id, { visible: !c.visible }, c.visible ? 'Category hidden.' : 'Category visible.')}>{c.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button>
                <button type="button" className="icon-btn" title="Edit" onClick={() => setEdit({ kind: 'category', item: c })}><Pencil className="w-4 h-4" /></button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit({ kind: 'subcategory', item: null, parent: c.id })}><Plus className="w-4 h-4" />Subcategory</button>
              </div>
            </div>
            <div className="divide-y divide-ink-100">
              {blocks.map(({ sub, items }) => (
                <div key={sub.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <p className={cx('text-[12px] font-bold uppercase tracking-wide', sub.visible ? 'text-ink-500' : 'text-ink-300')}>{sub.name}</p>
                    {!sub.visible && <Badge tone="ink">Hidden</Badge>}
                    <button type="button" className="icon-btn !w-7 !h-7" title={sub.visible ? 'Hide' : 'Show'} disabled={busyId === sub.id} onClick={() => void quick('subcategory', sub.id, { visible: !sub.visible }, 'Saved.')}>{sub.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</button>
                    <button type="button" className="icon-btn !w-7 !h-7" title="Rename" onClick={() => setEdit({ kind: 'subcategory', item: sub, parent: c.id })}><Pencil className="w-3.5 h-3.5" /></button>
                    <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => setEdit({ kind: 'service', item: null, parent: sub.id })}><Plus className="w-4 h-4" />Service</button>
                  </div>
                  {items.length ? (
                    <ul className="space-y-1">
                      {items.map((s) => (
                        <li key={s.id} className={cx('flex flex-wrap items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-ink-50/70', (s.archived_at || !s.visible) && 'opacity-60')}>
                          <span className="text-[13.5px] font-semibold text-ink-900 min-w-0 flex-1 truncate">{s.name}</span>
                          {s.featured && <Badge tone="brand">Popular</Badge>}
                          {s.archived_at && <Badge tone="ink">Archived</Badge>}
                          {!s.requestable && !s.archived_at && <Badge tone="amber">Not requestable</Badge>}
                          <span className="text-[12px] text-ink-500 whitespace-nowrap">{priceLabel(s)}</span>
                          <button type="button" className="icon-btn !w-7 !h-7" title={s.featured ? 'Remove from popular' : 'Mark popular'} disabled={busyId === s.id} onClick={() => void quick('service', s.id, { featured: !s.featured }, 'Saved.')}><Star className={cx('w-3.5 h-3.5', s.featured && 'fill-current text-brand-600')} /></button>
                          <button type="button" className="icon-btn !w-7 !h-7" title={s.visible ? 'Hide from clients' : 'Show to clients'} disabled={busyId === s.id} onClick={() => void quick('service', s.id, { visible: !s.visible }, 'Saved.')}>{s.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</button>
                          <button type="button" className="icon-btn !w-7 !h-7" title="Edit" onClick={() => setEdit({ kind: 'service', item: s, parent: s.subcategory_id })}><Pencil className="w-3.5 h-3.5" /></button>
                          <button type="button" className="icon-btn !w-7 !h-7" title={s.archived_at ? 'Restore' : 'Archive'} disabled={busyId === s.id} onClick={() => void quick('service', s.id, { archived: !s.archived_at }, s.archived_at ? 'Restored.' : 'Archived. Past requests keep their copy.')}>{s.archived_at ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}</button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-[12.5px] text-ink-400">No services.</p>}
                </div>
              ))}
              {!subs.length && <p className="px-5 py-3 text-[12.5px] text-ink-400">No subcategories yet.</p>}
            </div>
          </Card>
        );
      })}
      {edit && <CatalogueEdit {...edit} cat={cat} onClose={() => setEdit(null)} onDone={reload} />}
    </div>
  );
}

function CatalogueEdit({ kind, item, parent, cat, onClose, onDone }: {
  kind: 'category' | 'subcategory' | 'service'; item: any; parent?: string; cat: Catalogue; onClose: () => void; onDone: () => Promise<void>;
}) {
  const s = item as Service | null;
  const [f, setF] = useState<Record<string, string | boolean>>(() => kind === 'service' ? {
    name: s?.name ?? '', description: s?.description ?? '', pricing_type: s?.pricing_type ?? 'quote', price_from: s?.price_from == null ? '' : String(s.price_from),
    price_to: s?.price_to == null ? '' : String(s.price_to), fixed_price: s?.fixed_price == null ? '' : String(s.fixed_price), gst_rate: String(s?.gst_rate ?? 18),
    sac: s?.sac ?? '', unit: s?.unit ?? '', requestable: s?.requestable ?? true, subcategory_id: s?.subcategory_id ?? parent ?? '',
  } : { name: item?.name ?? '', description: item?.description ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const go = async () => {
    setBusy(true);
    try {
      const p: Record<string, unknown> = kind === 'service'
        ? { ...f, sac: String(f.sac).trim(), fixed_price: f.pricing_type === 'fixed' ? f.fixed_price : '' }
        : kind === 'subcategory' ? { name: f.name, category_id: parent } : { name: f.name, description: f.description };
      await servicesApi.saveCatalogue(kind, item?.id ?? null, p);
      notify('Saved.', 'success'); await onDone(); onClose();
    } catch (e) { notify(errText(e, 'Could not save.'), 'error', 8000); } finally { setBusy(false); }
  };
  const title = `${item ? 'Edit' : 'New'} ${kind}`;
  const priceOk = kind !== 'service' || (f.pricing_type !== 'fixed' || String(f.fixed_price) !== '') && (String(f.sac) === '' || /^\d{4,8}$/.test(String(f.sac)));
  return (
    <Modal title={title} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <label className="block"><span className="label">Name</span><input className="input" value={String(f.name)} maxLength={kind === 'service' ? 160 : 120} onChange={(e) => set('name', e.target.value)} /></label>
        {kind !== 'subcategory' && <label className="block"><span className="label">Description <span className="font-normal text-ink-400 ml-1">shown to clients</span></span><textarea className="input min-h-[70px]" value={String(f.description)} maxLength={kind === 'service' ? 2000 : 600} onChange={(e) => set('description', e.target.value)} /></label>}
        {kind === 'service' && (
          <>
            <label className="block"><span className="label">Subcategory</span>
              <select className="input" value={String(f.subcategory_id)} onChange={(e) => set('subcategory_id', e.target.value)}>
                {cat.categories.map((c) => <optgroup key={c.id} label={c.name}>{cat.subcategories.filter((x) => x.category_id === c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
              </select></label>
            <div className="flex gap-2">
              {(['quote', 'fixed'] as const).map((t) => (
                <button key={t} type="button" onClick={() => set('pricing_type', t)} className={cx('rounded-full px-3.5 py-1.5 text-[12px] font-semibold border', f.pricing_type === t ? 'bg-ink-950 text-white border-ink-950' : 'bg-white text-ink-600 border-ink-200')}>{t === 'quote' ? 'Custom quote' : 'Fixed price'}</button>
              ))}
            </div>
            {f.pricing_type === 'fixed'
              ? <label className="block"><span className="label">Price ₹ (before GST)</span><input className="input" type="number" min="0" step="0.01" value={String(f.fixed_price)} onChange={(e) => set('fixed_price', e.target.value)} /></label>
              : <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="label">Guide from ₹</span><input className="input" type="number" min="0" value={String(f.price_from)} onChange={(e) => set('price_from', e.target.value)} /></label>
                <label className="block"><span className="label">Guide to ₹</span><input className="input" type="number" min="0" value={String(f.price_to)} onChange={(e) => set('price_to', e.target.value)} /></label>
              </div>}
            <div className="grid grid-cols-3 gap-3">
              <label className="block"><span className="label">GST</span><select className="input" value={String(f.gst_rate)} onChange={(e) => set('gst_rate', e.target.value)}>{GST_RATES.map((g) => <option key={g} value={g}>{g}%</option>)}</select></label>
              <label className="block"><span className="label">SAC</span><input className="input font-mono" inputMode="numeric" value={String(f.sac)} onChange={(e) => set('sac', e.target.value.replace(/\D/g, '').slice(0, 8))} /></label>
              <label className="block"><span className="label">Unit</span><input className="input" value={String(f.unit)} maxLength={40} onChange={(e) => set('unit', e.target.value)} placeholder="per post" /></label>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-ink-700"><input type="checkbox" checked={!!f.requestable} onChange={(e) => set('requestable', e.target.checked)} />Clients can request it</label>
            <p className="text-[12px] text-ink-500">Every request is confirmed by you with a quotation — clients never pay directly from the menu.</p>
          </>
        )}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} disabled={!String(f.name).trim() || !priceOk} onClick={() => void go()}>Save</Button></div>
      </div>
    </Modal>
  );
}

