import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ClipboardList, MessageSquareMore, Plus, ShoppingBag, Sparkles, X, XCircle } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Notice, PillTabs, SearchInput, cx } from '../../ui';
import { Modal } from '../../ui/Modal';
import { notify } from '../../lib/toast';
import { useLiveRefresh } from '../../lib/live';
import {
  CLIENT_CANCELLABLE, FILE_STAGE, REQUEST_STATUS, errText, fmtDate, priceLabel, servicesApi, todayIST,
  type Catalogue, type Quote, type Service, type ServiceRequest,
} from '../../lib/services';
import { ActivityList, QuoteView, RequestFiles } from './shared';

/** Client portal: browse the service menu, request services, review and accept quotations. */
export function ClientServices({ onOpenPayments }: { onOpenPayments?: () => void }) {
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [rows, setRows] = useState<ServiceRequest[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [view, setView] = useState<'browse' | 'requests'>('browse');
  const [openId, setOpenId] = useState<string | null>(() => {
    try { return new URLSearchParams(window.location.search).get('request'); } catch { return null; }
  });
  const [cart, setCart] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([servicesApi.catalogue(), servicesApi.requests()]);
      setCat(c); setRows(r); setState('ready');
    } catch (e) { setError(errText(e, 'Unable to load services.')); setState('error'); }
  }, []);
  useLiveRefresh(load);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (openId) setView('requests'); }, [openId]);

  const open = rows.find((r) => r.id === openId) ?? null;
  const actionCount = rows.filter((r) => r.status === 'quote_sent').length;
  const toggle = (id: string) => setCart((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 20 ? c : [...c, id]));

  return (
    <div className="space-y-5">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Services</p>
          <h1 className="font-display text-[28px] font-bold text-ink-900 leading-tight mt-1">What can we do for you?</h1>
          <p className="text-[14px] text-ink-500 mt-1">Pick one or more services and tell us what you need. We’ll send you a quotation to review.</p>
        </div>
        <PillTabs value={view} onChange={(v) => { setView(v); setOpenId(null); }}
          items={[{ id: 'browse', label: 'Browse services' }, { id: 'requests', label: 'My requests', count: actionCount || undefined }]} />
      </header>

      {state === 'error' && <Notice tone="rose">{error}</Notice>}
      {state === 'loading' && <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-40 rounded-3xl" />)}</div>}

      {state === 'ready' && cat && view === 'browse' && (
        <Browse cat={cat} cart={cart} toggle={toggle} />
      )}
      {state === 'ready' && cat && view === 'requests' && (open
        ? <RequestDetail request={open} onBack={() => setOpenId(null)} onChanged={load} onOpenPayments={onOpenPayments} />
        : <RequestList rows={rows} onOpen={setOpenId} onBrowse={() => setView('browse')} />)}

      {cart.length > 0 && view === 'browse' && (
        <div className="sticky bottom-4 z-20">
          <div className="mx-auto max-w-3xl rounded-2xl bg-ink-950 text-white shadow-xl px-4 py-3 flex flex-wrap items-center gap-3">
            <ShoppingBag className="w-5 h-5 shrink-0" />
            <span className="text-[14px] font-semibold">{cart.length} service{cart.length === 1 ? '' : 's'} selected</span>
            <button type="button" className="text-[12px] text-white/70 hover:text-white underline" onClick={() => setCart([])}>Clear</button>
            <Button className="ml-auto" onClick={() => setAsking(true)}>Request a quotation</Button>
          </div>
        </div>
      )}

      {asking && cat && (
        <RequestDialog cat={cat} ids={cart} onRemove={toggle} onClose={() => setAsking(false)}
          onCreated={async (id) => { setAsking(false); setCart([]); await load(); setView('requests'); setOpenId(id); }} />
      )}
    </div>
  );
}

function Browse({ cat, cart, toggle }: { cat: Catalogue; cart: string[]; toggle: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [catId, setCatId] = useState<string>('');
  const subsById = useMemo(() => new Map(cat.subcategories.map((s) => [s.id, s])), [cat]);
  const visible = cat.services.filter((s) => s.visible && s.requestable && !s.archived_at && subsById.get(s.subcategory_id)?.visible !== false);
  const term = q.trim().toLowerCase();
  const matches = (s: Service) => !term || `${s.name} ${s.description ?? ''} ${subsById.get(s.subcategory_id)?.name ?? ''}`.toLowerCase().includes(term);
  const featured = !term && !catId ? visible.filter((s) => s.featured).slice(0, 6) : [];
  const categories = cat.categories.filter((c) => c.visible);
  const shownCats = catId ? categories.filter((c) => c.id === catId) : categories;

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search services — logo, reels, website…" className="md:flex-1" />
        <select className="input md:!w-64" value={catId} onChange={(e) => setCatId(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {featured.length > 0 && (
        <section>
          <h2 className="font-display font-bold text-[17px] text-ink-900 mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-brand-600" />Popular</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{featured.map((s) => <ServiceCard key={s.id} s={s} picked={cart.includes(s.id)} onToggle={() => toggle(s.id)} />)}</div>
        </section>
      )}

      {shownCats.map((c) => {
        const subs = cat.subcategories.filter((s) => s.category_id === c.id && s.visible);
        const blocks = subs.map((sub) => ({ sub, items: visible.filter((s) => s.subcategory_id === sub.id && matches(s)) })).filter((b) => b.items.length);
        if (!blocks.length) return null;
        return (
          <Card key={c.id} className="p-5 sm:p-6">
            <h2 className="font-display font-bold text-[19px] text-ink-900">{c.name}</h2>
            {c.description && <p className="text-[13px] text-ink-500 mt-0.5">{c.description}</p>}
            <div className="mt-4 space-y-5">
              {blocks.map(({ sub, items }) => (
                <div key={sub.id}>
                  <p className="text-[11.5px] font-bold uppercase tracking-wide text-ink-400 mb-2">{sub.name}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{items.map((s) => <ServiceCard key={s.id} s={s} picked={cart.includes(s.id)} onToggle={() => toggle(s.id)} />)}</div>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
      {term && !visible.some(matches) && <EmptyState icon={<ClipboardList className="w-6 h-6" />} title="No service matches" text="Try another word, or ask us through Help & support — we do custom work too." />}
    </div>
  );
}

function ServiceCard({ s, picked, onToggle }: { s: Service; picked: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={picked}
      className={cx('text-left rounded-2xl border p-4 transition-colors flex flex-col gap-1.5 min-h-[112px]',
        picked ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-600' : 'border-ink-100 bg-white hover:border-ink-300')}>
      <div className="flex items-start gap-2">
        <span className="font-semibold text-[14px] text-ink-900 flex-1">{s.name}</span>
        {picked ? <CheckCircle2 className="w-5 h-5 text-brand-600 shrink-0" /> : <Plus className="w-5 h-5 text-ink-300 shrink-0" />}
      </div>
      {s.description && <p className="text-[12.5px] text-ink-500 line-clamp-2">{s.description}</p>}
      <p className="mt-auto text-[12.5px] font-semibold text-ink-700">{priceLabel(s)}</p>
    </button>
  );
}

function RequestDialog({ cat, ids, onRemove, onClose, onCreated }: {
  cat: Catalogue; ids: string[]; onRemove: (id: string) => void; onClose: () => void; onCreated: (id: string) => Promise<void>;
}) {
  const [brief, setBrief] = useState(''); const [timeline, setTimeline] = useState(''); const [date, setDate] = useState(''); const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const picked = ids.map((id) => cat.services.find((s) => s.id === id)).filter(Boolean) as Service[];
  const submit = async () => {
    if (brief.trim().length < 5) { notify('Describe what you need in a few words.', 'error'); return; }
    setBusy(true);
    try {
      const id = await servicesApi.create(ids, brief.trim(), timeline.trim(), date, notes.trim());
      notify('Request sent. We’ll prepare a quotation and let you know.', 'success');
      await onCreated(id);
    } catch (e) { notify(errText(e, 'Could not send the request.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title="Request a quotation" onClose={onClose} closeDisabled={busy} wide>
      <div className="space-y-4">
        <div>
          <p className="label">Services</p>
          <div className="flex flex-wrap gap-2">
            {picked.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 border border-ink-100 pl-3 pr-1.5 py-1 text-[12.5px] font-semibold text-ink-800">
                {s.name}
                {picked.length > 1 && <button type="button" className="icon-btn !w-5 !h-5" aria-label={`Remove ${s.name}`} onClick={() => onRemove(s.id)}><X className="w-3 h-3" /></button>}
              </span>
            ))}
          </div>
        </div>
        <label className="block"><span className="label">What do you need?</span>
          <textarea className="input min-h-[120px]" value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000}
            placeholder="Your goal, audience, quantities, references, anything we should know." /></label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block"><span className="label">Timeline <span className="font-normal text-ink-400 ml-1">optional</span></span><input className="input" value={timeline} onChange={(e) => setTimeline(e.target.value)} maxLength={200} placeholder="e.g. within 3 weeks" /></label>
          <label className="block"><span className="label">Preferred start <span className="font-normal text-ink-400 ml-1">optional</span></span><input className="input" type="date" min={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <label className="block"><span className="label">Anything else <span className="font-normal text-ink-400 ml-1">optional</span></span><textarea className="input min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Budget range, links, contact preferences…" /></label>
        <p className="text-[12px] text-ink-500">You can add reference files after sending. Prices shown are a guide — your quotation has the final amount.</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={() => void submit()}>Send request</Button></div>
      </div>
    </Modal>
  );
}

function RequestList({ rows, onOpen, onBrowse }: { rows: ServiceRequest[]; onOpen: (id: string) => void; onBrowse: () => void }) {
  if (!rows.length) {
    return <Card><EmptyState icon={<ClipboardList className="w-6 h-6" />} title="No requests yet" text="Requests you send appear here with their quotations and progress."
      action={<Button onClick={onBrowse}>Browse services</Button>} className="!py-12" /></Card>;
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-ink-100">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onOpen(r.id)} className="w-full text-left px-5 sm:px-6 py-3.5 flex items-center gap-3 hover:bg-ink-50/70">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink-900 truncate">{(r.service_request_items ?? []).map((i) => i.service_name).join(', ') || r.brief}</p>
                <p className="text-[12px] text-ink-500">{r.request_no} · sent {fmtDate(r.created_at)}</p>
              </div>
              {r.status === 'quote_sent' && <Badge tone="brand">Action needed</Badge>}
              <Badge tone={REQUEST_STATUS[r.status].tone} dot>{REQUEST_STATUS[r.status].client}</Badge>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RequestDetail({ request: r, onBack, onChanged, onOpenPayments }: {
  request: ServiceRequest; onBack: () => void; onChanged: () => Promise<void>; onOpenPayments?: () => void;
}) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof servicesApi.detail>> | null>(null);
  const [respond, setRespond] = useState<{ quote: Quote; action: 'accept' | 'revise' | 'reject' } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const loadDetail = useCallback(async () => {
    try { setDetail(await servicesApi.detail(r.id)); } catch (e) { notify(errText(e, 'Could not load this request.'), 'error'); }
  }, [r.id]);
  useEffect(() => { void loadDetail(); }, [loadDetail, r.updated_at]);
  const refresh = async () => { await onChanged(); await loadDetail(); };

  const quotes = detail?.quotes ?? [];
  const current = quotes.find((q) => q.status === 'sent') ?? quotes.find((q) => q.status === 'accepted') ?? quotes[0] ?? null;
  const older = quotes.filter((q) => q !== current);
  const expired = current?.status === 'sent' && !!current.valid_until && current.valid_until < todayIST();
  const st = REQUEST_STATUS[r.status];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px] items-start">
      <Card className="p-5 sm:p-6 space-y-5">
        <button type="button" className="btn-ghost btn-sm w-fit" onClick={onBack}><ArrowLeft className="w-3.5 h-3.5" /> My requests</button>
        <div>
          <p className="text-[11px] font-bold text-ink-400 tnum">{r.request_no} · sent {fmtDate(r.created_at)}</p>
          <h2 className="font-display text-xl font-bold text-ink-900 mt-0.5">{(r.service_request_items ?? []).map((i) => i.service_name).join(', ')}</h2>
          <div className="mt-2"><Badge tone={st.tone} dot>{st.client}</Badge></div>
        </div>

        {r.status === 'payment_pending' && (
          <Notice tone="amber" title="Your first payment is due">Work starts as soon as it’s received.
            {onOpenPayments && <button type="button" className="btn-secondary btn-sm ml-2" onClick={onOpenPayments}>Go to Billing & Payment</button>}</Notice>
        )}
        {r.status === 'in_progress' && <Notice tone="mint" title="Work in progress">Follow progress and review drafts under Deliverables.</Notice>}
        {(r.status === 'rejected' || r.status === 'cancelled') && r.close_reason && <Notice tone="ink">{r.close_reason}</Notice>}

        {current ? (
          <div className="rounded-2xl border border-ink-100 p-4 sm:p-5">
            <QuoteView quote={current} />
            {current.status === 'sent' && r.status === 'quote_sent' && (
              <div className="mt-4 flex flex-wrap gap-2 justify-end">
                <button type="button" className="btn-ghost text-rose-700" onClick={() => setRespond({ quote: current, action: 'reject' })}><XCircle className="w-4 h-4" />Decline</button>
                <button type="button" className="btn-secondary" onClick={() => setRespond({ quote: current, action: 'revise' })}><MessageSquareMore className="w-4 h-4" />Ask for changes</button>
                <Button disabled={expired} title={expired ? 'This quotation has expired — ask for changes to get a new one' : undefined}
                  icon={<CheckCircle2 className="w-4 h-4" />} onClick={() => setRespond({ quote: current, action: 'accept' })}>Accept quotation</Button>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl bg-ink-50/70 p-4 text-[13px] text-ink-600">We’re reviewing your request. Your quotation will appear here and you’ll get a notification.</div>
        )}

        {older.length > 0 && (
          <details className="text-[13px]">
            <summary className="cursor-pointer text-ink-600 font-semibold">Earlier versions ({older.length})</summary>
            <div className="mt-3 space-y-4">{older.map((q) => <div key={q.id} className="rounded-2xl border border-ink-100 p-4 opacity-80"><QuoteView quote={q} compact /></div>)}</div>
          </details>
        )}

        <div>
          <p className="label">Your brief</p>
          <p className="text-[13.5px] text-ink-700 whitespace-pre-line">{r.brief}</p>
          <p className="text-[12px] text-ink-500 mt-1">{[r.timeline && `Timeline: ${r.timeline}`, r.preferred_date && `Preferred start: ${fmtDate(r.preferred_date)}`].filter(Boolean).join(' · ')}</p>
          {r.notes && <p className="text-[12.5px] text-ink-600 mt-1 whitespace-pre-line">{r.notes}</p>}
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="p-5 space-y-3">
          <h3 className="font-display font-bold text-[15px] text-ink-900">Files</h3>
          {detail ? <RequestFiles requestId={r.id} files={detail.files} canUpload={FILE_STAGE.includes(r.status)} onChanged={loadDetail} /> : <div className="skeleton h-10 rounded-xl" />}
        </Card>
        <Card className="p-5 space-y-3">
          <h3 className="font-display font-bold text-[15px] text-ink-900">History</h3>
          {detail ? <ActivityList items={detail.activity} /> : <div className="skeleton h-16 rounded-xl" />}
        </Card>
        {CLIENT_CANCELLABLE.includes(r.status) && (
          <button type="button" className="btn-ghost btn-sm text-rose-700" onClick={() => setCancelling(true)}>Cancel this request</button>
        )}
      </div>

      {respond && <RespondDialog {...respond} requestNo={r.request_no} onClose={() => setRespond(null)} onDone={refresh} />}
      {cancelling && <CancelDialog request={r} onClose={() => setCancelling(false)} onDone={refresh} />}
    </div>
  );
}

function RespondDialog({ quote, action, requestNo, onClose, onDone }: {
  quote: Quote; action: 'accept' | 'revise' | 'reject'; requestNo: string; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [note, setNote] = useState(''); const [agree, setAgree] = useState(false); const [busy, setBusy] = useState(false);
  const title = action === 'accept' ? `Accept quotation v${quote.version_no}?` : action === 'revise' ? 'Ask for changes' : 'Decline this quotation?';
  const go = async () => {
    setBusy(true);
    try {
      await servicesApi.respond(quote.id, action, note.trim());
      notify(action === 'accept' ? 'Accepted. We’ll schedule the work and request the first payment.' : action === 'revise' ? 'Sent. We’ll send you a revised quotation.' : 'Quotation declined.', 'success');
      await onDone(); onClose();
    } catch (e) { notify(errText(e, 'Could not send your answer.'), 'error', 8000); } finally { setBusy(false); }
  };
  const ok = action === 'accept' ? agree : action === 'revise' ? note.trim().length >= 3 : true;
  return (
    <Modal title={title} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        {action === 'accept' && (
          <>
            <p className="text-[13.5px] text-ink-700">You’re agreeing to {requestNo} at the amount, scope, payment terms and terms in quotation v{quote.version_no}. Your acceptance is recorded with your name, the time and your device.</p>
            <label className="flex items-start gap-2 text-[13px] text-ink-800"><input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I have read the quotation and agree to it on behalf of my organisation.</label>
          </>
        )}
        <label className="block"><span className="label">{action === 'revise' ? 'What should change?' : 'Note'} {action !== 'revise' && <span className="font-normal text-ink-400 ml-1">optional</span>}</span>
          <textarea className="input min-h-[90px]" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000}
            placeholder={action === 'revise' ? 'e.g. Drop the second line, spread payment over three terms' : ''} /></label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button>
          <Button loading={busy} disabled={!ok} className={action === 'reject' ? '!bg-rose-600' : undefined} onClick={() => void go()}>
            {action === 'accept' ? 'Accept quotation' : action === 'revise' ? 'Send' : 'Decline'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CancelDialog({ request, onClose, onDone }: { request: ServiceRequest; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await servicesApi.cancel(request.id, reason.trim()); notify('Request cancelled.', 'success'); await onDone(); onClose(); }
    catch (e) { notify(errText(e, 'Could not cancel.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Cancel ${request.request_no}?`} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <p className="text-[13.5px] text-ink-700">Any quotation on it is withdrawn. You can always send a new request.</p>
        <label className="block"><span className="label">Reason <span className="font-normal text-ink-400 ml-1">optional</span></span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400} /></label>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Keep it</Button><Button loading={busy} className="!bg-rose-600" onClick={() => void go()}>Cancel request</Button></div>
      </div>
    </Modal>
  );
}
