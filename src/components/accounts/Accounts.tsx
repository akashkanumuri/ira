import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle, BadgeIndianRupee, Ban, Building2, CheckCircle2, Download, FileMinus, FilePlus, FileText, Landmark, Plus, Receipt,
  RefreshCw, Settings2, Wallet, XCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { Badge, Card, CardHeader, EmptyState, Notice, PillTabs, SearchInput, Skeleton, Stat, cx, type Tone } from '../../ui';
import { Modal } from '../../ui/Modal';
import { PaymentDetailsCard } from '../admin/BillingExtras';
import { FinancePage } from '../admin/FinancePage';
import { GST_STATES, inrFmt, openForInstallment, openInvoice, openNote, openReceipt, stateName } from './documents';

/**
 * Accounts: GST invoices (from payment milestones), receipts, client credit, credit / debit notes, ageing, month-end export.
 * Every change goes through permission-checked database functions; issued documents can't be edited.
 */

const db = () => supabase as any;
const errText = (e: unknown, fallback: string) => {
  const m = (e as any)?.message ?? (e instanceof Error ? e.message : '');
  return m ? String(m).replace(/^.*?P0001:\s*/, '') : fallback;
};
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const fmtDate = (d?: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
const num = (v: unknown) => Number(v ?? 0);
const newKey = () => (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

interface InvoiceRow {
  id: string; invoice_no: string; title: string; issue_date: string; due_date: string | null; client_id: string; project_id: string | null; installment_id: string | null;
  client_name: string; client_gstin: string | null; place_of_supply: string; supply_type: 'intra' | 'inter';
  taxable_total: number; cgst_total: number; sgst_total: number; igst_total: number; grand_total: number; status: 'issued' | 'cancelled';
  debit_notes: number; credit_notes: number; settled: number; balance: number; days_overdue: number; payment_status: 'paid' | 'part_paid' | 'unpaid' | 'cancelled';
}
interface Inst {
  id: string; client_id: string; project_id: string; name: string; amount: number; tax_amount: number; amount_paid: number; status: string;
  due_date: string | null; invoice_number: string | null; term_no: number | null; requested_at: string | null; installment_number: number;
}
interface Pay { id: string; installment_id: string; client_id: string; amount: number; reference: string; paid_on: string; method: string | null; source: string; status: string; receipt_no: string | null; receipt_group: string | null; verified_at: string | null }
interface Adj {
  id: string; kind: 'credit' | 'debit'; note_no: string | null; invoice_id: string; client_id: string; reason: string; taxable: number; gst_rate: number;
  cgst: number; sgst: number; igst: number; total: number; status: 'pending' | 'approved' | 'rejected'; requested_at: string; issue_date: string | null;
  applied_to_invoice: number; to_client_credit: number; installment_id: string | null; decision_note: string | null; due_date: string | null;
}
interface Client { id: string; company_name: string }
interface BillingProfile { client_id: string; legal_name: string; gstin: string | null; pan: string | null; state_code: string; address: string | null; city: string | null; pincode: string | null; billing_emails: string[] }
interface Ledger { id: string; client_id: string; amount: number; kind: string; note: string | null; created_at: string; receipt_group: string | null }

interface Data {
  invoices: InvoiceRow[]; insts: Inst[]; pays: Pay[]; adjs: Adj[]; clients: Client[]; profiles: BillingProfile[]; ledger: Ledger[]; company: any; projects: Record<string, string>;
}

const PAY_TONE: Record<string, Tone> = { paid: 'mint', part_paid: 'amber', unpaid: 'sky', cancelled: 'rose' };
const PAY_LABEL: Record<string, string> = { paid: 'Paid', part_paid: 'Part paid', unpaid: 'Unpaid', cancelled: 'Cancelled' };
const METHODS = [{ id: 'bank_transfer', label: 'Bank transfer' }, { id: 'upi', label: 'UPI' }, { id: 'cheque', label: 'Cheque' }, { id: 'card', label: 'Card' }, { id: 'cash', label: 'Cash' }, { id: 'other', label: 'Other' }];
const instDue = (i: Inst) => Math.max(0, num(i.amount) + num(i.tax_amount) - num(i.amount_paid));
const isOpenInst = (i: Inst) => !['Paid', 'Cancelled', 'Waived'].includes(i.status) && instDue(i) > 0;
const daysLate = (due: string | null) => (due ? Math.max(0, Math.floor((new Date(`${todayIST()}T00:00:00Z`).getTime() - new Date(`${due}T00:00:00Z`).getTime()) / 86400000)) : 0);
const bucketOf = (days: number) => (days <= 0 ? 'Not due' : days <= 30 ? '1–30 days' : days <= 60 ? '31–60 days' : days <= 90 ? '61–90 days' : '90+ days');
const BUCKETS = ['Not due', '1–30 days', '31–60 days', '61–90 days', '90+ days'];

async function loadAll(): Promise<Data> {
  const [inv, insts, pays, adjs, clients, profiles, ledger, company, projects] = await Promise.all([
    db().from('invoice_status').select('*').order('issue_date', { ascending: false }).limit(5000),
    db().from('payment_installments').select('id, client_id, project_id, name, amount, tax_amount, amount_paid, status, due_date, invoice_number, term_no, requested_at, installment_number').is('deleted_at', null).limit(5000),
    db().from('payments').select('id, installment_id, client_id, amount, reference, paid_on, method, source, status, receipt_no, receipt_group, verified_at').eq('status', 'Verified').order('paid_on', { ascending: false }).limit(5000),
    db().from('invoice_adjustments').select('*').order('requested_at', { ascending: false }).limit(2000),
    db().from('clients').select('id, company_name').is('deleted_at', null).order('company_name'),
    db().from('client_billing_profiles').select('*'),
    db().from('client_credit_ledger').select('id, client_id, amount, kind, note, created_at, receipt_group').order('created_at', { ascending: false }).limit(5000),
    db().from('company_profile').select('*').maybeSingle(),
    db().from('projects').select('id, name'),
  ]);
  const firstErr = [inv, insts, pays, adjs, clients].find((r) => r.error)?.error;
  if (firstErr) throw firstErr;
  const pm: Record<string, string> = {};
  for (const p of projects.data ?? []) pm[p.id] = p.name;
  return { invoices: inv.data ?? [], insts: insts.data ?? [], pays: pays.data ?? [], adjs: adjs.data ?? [], clients: clients.data ?? [], profiles: profiles.data ?? [], ledger: ledger.data ?? [], company: company.data, projects: pm };
}

/* ================================================================ page */

export function AccountsPage({ user, onSelectTab }: { user: any; onSelectTab: (tab: string) => void }) {
  const isAdmin = user.role === 'admin';
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const reload = useCallback(async () => {
    try { setData(await loadAll()); setError(''); } catch (e) { setError(errText(e, 'Could not load accounts.')); setData((d) => d ?? null); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const clientName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of data?.clients ?? []) m[c.id] = c.company_name;
    return (id: string) => m[id] ?? 'Client';
  }, [data]);

  const pending = data?.adjs.filter((a) => a.status === 'pending').length ?? 0;
  const companyReady = !!(data?.company?.legal_name && data?.company?.state_code);
  return (
    <div className="mx-auto w-full max-w-[1320px] space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] sm:text-[30px] font-bold text-ink-950 tracking-tight">Finance & accounts</h1>
          <p className="text-[14px] text-ink-500 mt-1">GST invoices, receipts, credit and debit notes, what’s owed, and the month-end file for your accountant.</p>
        </div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => void reload()}><RefreshCw className="w-4 h-4" />Refresh</button>
      </div>
      {error && <Notice tone="rose">{error}</Notice>}
      {data && !companyReady && (
        <Notice tone="amber">Add your company’s legal name, state and GSTIN in <button type="button" className="font-bold underline" onClick={() => setTab('settings')}>Settings</button> before issuing invoices. Have a CA confirm the GST setup before sending real invoices.</Notice>
      )}
      <PillTabs value={tab} onChange={setTab} items={[
        { id: 'overview', label: 'Overview' },
        { id: 'collections', label: 'Milestones & verify' },
        { id: 'invoices', label: 'Invoices', count: data?.invoices.filter((i) => i.status === 'issued' && i.balance > 0).length },
        { id: 'receipts', label: 'Receipts' },
        { id: 'notes', label: 'Credit & debit notes', count: pending || undefined },
        { id: 'clients', label: 'Clients & credit' },
        { id: 'monthend', label: 'Month-end' },
        { id: 'settings', label: 'Settings' },
      ]} />
      {tab === 'collections' ? <FinancePage onSelectTab={onSelectTab} embedded /> : !data ? <Skeleton className="h-72" /> : (
        tab === 'overview' ? <Overview data={data} clientName={clientName} go={setTab} reload={reload} />
        : tab === 'invoices' ? <Invoices data={data} clientName={clientName} reload={reload} />
        : tab === 'receipts' ? <Receipts data={data} clientName={clientName} reload={reload} />
        : tab === 'notes' ? <Notes data={data} clientName={clientName} reload={reload} isAdmin={isAdmin} />
        : tab === 'clients' ? <ClientsCredit data={data} reload={reload} isAdmin={isAdmin} />
        : tab === 'monthend' ? <MonthEnd data={data} clientName={clientName} />
        : <CompanySettings company={data.company} reload={reload} />
      )}
    </div>
  );
}

/* ================================================================ overview */

function outstandingRows(data: Data, clientName: (id: string) => string) {
  // Everything invoiced (tax invoices + debit notes) that still has money due.
  return data.insts.filter((i) => i.invoice_number && isOpenInst(i)).map((i) => ({
    inst: i, client: clientName(i.client_id), doc: i.invoice_number!, due: instDue(i), days: daysLate(i.due_date), bucket: bucketOf(daysLate(i.due_date)),
  }));
}

function Overview({ data, clientName, go, reload }: { data: Data; clientName: (id: string) => string; go: (t: string) => void; reload: () => Promise<void> }) {
  const rows = outstandingRows(data, clientName);
  const outstanding = rows.reduce((s, r) => s + r.due, 0);
  const overdue = rows.filter((r) => r.days > 0).reduce((s, r) => s + r.due, 0);
  const month = todayIST().slice(0, 7);
  const collected = data.pays.filter((p) => ['client', 'finance'].includes(p.source) && p.paid_on?.startsWith(month)).reduce((s, p) => s + num(p.amount), 0)
    + data.ledger.filter((l) => l.kind === 'overpayment' && l.created_at.slice(0, 7) === month).reduce((s, l) => s + num(l.amount), 0);
  const credit = data.ledger.reduce((s, l) => s + num(l.amount), 0);
  const toInvoice = data.insts.filter((i) => !i.invoice_number && isOpenInst(i) && (i.term_no == null || i.requested_at));
  const noProfile = data.clients.filter((c) => !data.profiles.some((p) => p.client_id === c.id) && data.insts.some((i) => i.client_id === c.id));
  const byBucket = BUCKETS.map((b) => ({ b, amt: rows.filter((r) => r.bucket === b).reduce((s, r) => s + r.due, 0), n: rows.filter((r) => r.bucket === b).length }));
  const max = Math.max(1, ...byBucket.map((x) => x.amt));
  const byClient = Object.entries(rows.reduce<Record<string, number>>((m, r) => { m[r.client] = (m[r.client] ?? 0) + r.due; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Stat index={0} icon={<BadgeIndianRupee className="w-5 h-5" />} tone="brand" label="Outstanding" value={inrFmt(outstanding)} caption={`${rows.length} invoices`} onClick={() => go('invoices')} />
        <Stat index={1} icon={<AlertTriangle className="w-5 h-5" />} tone="rose" label="Overdue" value={inrFmt(overdue)} caption={`${rows.filter((r) => r.days > 0).length} past due date`} />
        <Stat index={2} icon={<Landmark className="w-5 h-5" />} tone="mint" label="Received this month" value={inrFmt(collected)} caption="Cash and bank" onClick={() => go('receipts')} />
        <Stat index={3} icon={<Wallet className="w-5 h-5" />} tone="amber" label="Client credit held" value={inrFmt(credit)} caption="Advances and credit notes" onClick={() => go('clients')} />
      </div>
      {(toInvoice.length > 0 || noProfile.length > 0 || data.adjs.some((a) => a.status === 'pending')) && (
        <Card className="p-5"><CardHeader title="Needs attention" />
          <ul className="mt-3 space-y-2 text-[13.5px]">
            {data.adjs.some((a) => a.status === 'pending') && <li className="flex items-center justify-between gap-3"><span><b>{data.adjs.filter((a) => a.status === 'pending').length}</b> credit / debit notes waiting for approval</span><button type="button" className="btn-secondary btn-sm" onClick={() => go('notes')}>Review</button></li>}
            {toInvoice.length > 0 && <li className="flex items-center justify-between gap-3"><span><b>{toInvoice.length}</b> requested milestones without an invoice</span><button type="button" className="btn-secondary btn-sm" onClick={() => go('invoices')}>Issue invoices</button></li>}
            {noProfile.length > 0 && <li className="flex items-center justify-between gap-3"><span><b>{noProfile.length}</b> clients without billing details ({noProfile.slice(0, 3).map((c) => c.company_name).join(', ')}{noProfile.length > 3 ? '…' : ''})</span><button type="button" className="btn-secondary btn-sm" onClick={() => go('clients')}>Add details</button></li>}
          </ul>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><CardHeader title="Ageing" subtitle="Money owed, by how late it is" />
          <div className="mt-4 space-y-3">{byBucket.map((x) => (
            <div key={x.b}>
              <div className="flex justify-between text-[13px] mb-1"><span className="text-ink-700 font-semibold">{x.b}</span><span><b>{inrFmt(x.amt)}</b> <span className="text-ink-400">· {x.n}</span></span></div>
              <div className="h-2.5 rounded-full bg-ink-100 overflow-hidden"><div className={cx('h-full rounded-full', x.b === 'Not due' ? 'bg-sky-500' : x.b === '1–30 days' ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${(x.amt / max) * 100}%` }} /></div>
            </div>
          ))}</div>
        </Card>
        <Card className="p-5"><CardHeader title="Who owes the most" />
          {byClient.length ? <ul className="mt-3 divide-y divide-ink-100">{byClient.map(([c, amt]) => <li key={c} className="flex justify-between py-2 text-[13.5px]"><span className="text-ink-800 font-semibold">{c}</span><b>{inrFmt(amt)}</b></li>)}</ul>
            : <p className="mt-3 text-[13px] text-ink-500">Nothing outstanding.</p>}
        </Card>
      </div>
      <p className="text-[12px] text-ink-500">Reminders go to clients automatically: 3 days before the due date, on the day, 1 and 3 days late, then weekly — plus a warning the day before access pauses (if auto-pause is on). <button type="button" className="underline" onClick={() => void reload()}>Refresh</button></p>
    </div>
  );
}

/* ================================================================ invoices */

function Invoices({ data, clientName, reload }: { data: Data; clientName: (id: string) => string; reload: () => Promise<void> }) {
  const [q, setQ] = useState(''); const [f, setF] = useState('open'); const [busy, setBusy] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<InvoiceRow | null>(null); const [noteFor, setNoteFor] = useState<{ inv: InvoiceRow; kind: 'credit' | 'debit' } | null>(null);
  const toInvoice = data.insts.filter((i) => !i.invoice_number && isOpenInst(i) && (i.term_no == null || i.requested_at))
    .sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9'));
  const list = data.invoices.filter((i) => (f === 'all' || (f === 'open' ? i.status === 'issued' && i.balance > 0 : f === 'paid' ? i.payment_status === 'paid' : i.status === 'cancelled'))
    && (!q.trim() || `${i.invoice_no} ${i.client_name} ${clientName(i.client_id)}`.toLowerCase().includes(q.trim().toLowerCase())));
  const issue = async (i: Inst) => {
    setBusy(i.id);
    try { const { data: no, error } = await db().rpc('finance_issue_invoice', { p_installment_id: i.id }); if (error) throw error; notify(`Invoice ${no} issued. The client has been told.`, 'success'); await reload(); }
    catch (e) { notify(errText(e, 'Could not issue the invoice.'), 'error', 9000); } finally { setBusy(null); }
  };
  const open = (fn: () => Promise<void>) => { fn().catch((e) => notify(errText(e, 'Could not open the document.'), 'error')); };
  return (
    <div className="space-y-5">
      {toInvoice.length > 0 && (
        <Card className="p-5"><CardHeader title="Ready to invoice" subtitle="Milestones you’ve asked the client to pay, without an invoice yet" />
          <div className="overflow-x-auto mt-3"><table className="data-table"><thead><tr><th>Client</th><th>Milestone</th><th className="text-right">Amount</th><th className="text-right">GST</th><th>Due</th><th /></tr></thead>
            <tbody>{toInvoice.map((i) => <tr key={i.id}><td className="font-semibold">{clientName(i.client_id)}</td><td>{i.name}<div className="text-[11px] text-ink-400">{data.projects[i.project_id] ?? ''}</div></td>
              <td className="text-right">{inrFmt(i.amount)}</td><td className="text-right">{inrFmt(i.tax_amount)}</td><td>{fmtDate(i.due_date)}</td>
              <td className="text-right"><button type="button" className="btn-primary btn-sm" disabled={busy === i.id} onClick={() => void issue(i)}><FileText className="w-4 h-4" />{busy === i.id ? 'Issuing…' : 'Issue invoice'}</button></td></tr>)}</tbody></table></div>
          <p className="text-[12px] text-ink-500 mt-3">GST is taken from the milestone’s tax amount (it must match 5, 12, 18, 28 or 40%). CGST+SGST if the client is in your state, IGST otherwise.</p>
        </Card>
      )}
      <div className="card p-3 sm:p-4 flex flex-wrap gap-3 items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search invoice no. or client" className="flex-1 min-w-[220px]" />
        <PillTabs size="sm" value={f} onChange={setF} items={[{ id: 'open', label: 'Unpaid' }, { id: 'paid', label: 'Paid' }, { id: 'cancelled', label: 'Cancelled' }, { id: 'all', label: 'All' }]} />
      </div>
      {!list.length ? <Card className="p-2"><EmptyState icon={<FileText className="w-5 h-5" />} title="No invoices here" text="Issue an invoice from a milestone above, or from the project’s Billing tab." /></Card> : (
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="data-table">
          <thead><tr><th>Invoice</th><th>Client</th><th className="text-right">Total</th><th className="text-right">Balance</th><th>Due</th><th>Status</th><th /></tr></thead>
          <tbody>{list.map((i) => (
            <tr key={i.id}>
              <td><button type="button" className="font-mono text-[12.5px] font-bold text-brand-700" onClick={() => open(() => openInvoice(i.id))}>{i.invoice_no}</button><div className="text-[11px] text-ink-400">{fmtDate(i.issue_date)} · {i.supply_type === 'intra' ? 'CGST+SGST' : 'IGST'}</div></td>
              <td className="font-semibold">{i.client_name}<div className="text-[11px] text-ink-400 font-mono">{i.client_gstin ?? 'Unregistered'}</div></td>
              <td className="text-right">{inrFmt(i.grand_total)}{num(i.credit_notes) > 0 && <div className="text-[11px] text-rose-700">− CN {inrFmt(i.credit_notes)}</div>}{num(i.debit_notes) > 0 && <div className="text-[11px] text-amber-800">+ DN {inrFmt(i.debit_notes)}</div>}</td>
              <td className="text-right font-semibold">{inrFmt(i.balance)}</td>
              <td className={cx('text-[13px]', i.days_overdue > 0 && 'text-rose-700 font-semibold')}>{fmtDate(i.due_date)}{i.days_overdue > 0 ? ` · ${i.days_overdue}d late` : ''}</td>
              <td><Badge tone={PAY_TONE[i.payment_status]} dot>{PAY_LABEL[i.payment_status]}</Badge></td>
              <td className="text-right whitespace-nowrap">
                <button type="button" className="icon-btn" title="Download PDF" onClick={() => open(() => openInvoice(i.id))}><Download className="w-4 h-4" /></button>
                {i.status === 'issued' && <>
                  <button type="button" className="icon-btn" title="Credit note (reduce)" onClick={() => setNoteFor({ inv: i, kind: 'credit' })}><FileMinus className="w-4 h-4" /></button>
                  <button type="button" className="icon-btn" title="Debit note (charge more)" onClick={() => setNoteFor({ inv: i, kind: 'debit' })}><FilePlus className="w-4 h-4" /></button>
                  {num(i.settled) === 0 && num(i.credit_notes) === 0 && num(i.debit_notes) === 0 && <button type="button" className="icon-btn text-rose-700" title="Cancel invoice" onClick={() => setCancelFor(i)}><Ban className="w-4 h-4" /></button>}
                </>}
              </td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
      {cancelFor && <CancelInvoice inv={cancelFor} onClose={() => setCancelFor(null)} onDone={reload} />}
      {noteFor && <NoteModal inv={noteFor.inv} kind={noteFor.kind} onClose={() => setNoteFor(null)} onDone={reload} />}
    </div>
  );
}

function CancelInvoice({ inv, onClose, onDone }: { inv: InvoiceRow; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const { error } = await db().rpc('finance_cancel_invoice', { p_invoice_id: inv.id, p_reason: reason }); if (error) throw error; notify(`${inv.invoice_no} cancelled.`, 'success'); await onDone(); onClose(); }
    catch (e) { notify(errText(e, 'Could not cancel.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Cancel ${inv.invoice_no}?`} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <p className="text-[13.5px] text-ink-700">The number stays used and shows as cancelled in the register. The milestone can be invoiced again with a new number. Only possible while nothing is paid.</p>
        <label className="block"><span className="label">Why?</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400} placeholder="Wrong amount, wrong client…" /></label>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Keep it</button><button type="button" className="btn-primary !bg-rose-600" disabled={busy || reason.trim().length < 3} onClick={() => void go()}>{busy ? 'Cancelling…' : 'Cancel invoice'}</button></div>
      </div>
    </Modal>
  );
}

function NoteModal({ inv, kind, onClose, onDone }: { inv: InvoiceRow; kind: 'credit' | 'debit'; onClose: () => void; onDone: () => Promise<void> }) {
  const [amt, setAmt] = useState(''); const [reason, setReason] = useState(''); const [due, setDue] = useState(''); const [busy, setBusy] = useState(false);
  const rate = inv.taxable_total > 0 ? Math.round(((num(inv.cgst_total) + num(inv.sgst_total) + num(inv.igst_total)) / num(inv.taxable_total)) * 100) : 0;
  const tax = Math.round(num(amt) * rate) / 100;
  const go = async () => {
    setBusy(true);
    try {
      const { error } = await db().rpc('finance_request_adjustment', { p_invoice_id: inv.id, p_kind: kind, p_taxable: num(amt), p_reason: reason, p_due_date: kind === 'debit' && due ? due : null });
      if (error) throw error;
      notify(kind === 'credit' ? 'Credit note saved.' : 'Debit note saved.', 'success'); await onDone(); onClose();
    } catch (e) { notify(errText(e, 'Could not save the note.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${kind === 'credit' ? 'Credit note' : 'Debit note'} against ${inv.invoice_no}`} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <p className="text-[13px] text-ink-600">{kind === 'credit' ? 'Reduces what the client owes on this invoice. If it’s already paid, the amount is kept as the client’s credit.' : 'Charges more against this invoice. It becomes a new amount due for the client.'} Admin notes are approved straight away; others wait for admin.</p>
        <label className="block"><span className="label">Amount before GST</span><input className="input" type="number" min="0" step="0.01" value={amt} onChange={(e) => setAmt(e.target.value)} /></label>
        {num(amt) > 0 && <p className="text-[13px] text-ink-700">GST {rate}% = <b>{inrFmt(tax)}</b> · Total <b>{inrFmt(num(amt) + tax)}</b></p>}
        <label className="block"><span className="label">Reason</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400} placeholder={kind === 'credit' ? 'One reel dropped from scope' : 'Extra shoot day'} /></label>
        {kind === 'debit' && <label className="block"><span className="label">Due date</span><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} min={todayIST()} /></label>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn-primary" disabled={busy || num(amt) <= 0 || reason.trim().length < 3} onClick={() => void go()}>{busy ? 'Saving…' : 'Save note'}</button></div>
      </div>
    </Modal>
  );
}

/* ================================================================ receipts */

function Receipts({ data, clientName, reload }: { data: Data; clientName: (id: string) => string; reload: () => Promise<void> }) {
  const [rec, setRec] = useState(false); const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const m = new Map<string, { no: string; client_id: string; paid_on: string; method: string | null; reference: string; amount: number; n: number }>();
    for (const p of data.pays.filter((x) => x.receipt_no && ['client', 'finance'].includes(x.source))) {
      const g = m.get(p.receipt_no!) ?? { no: p.receipt_no!, client_id: p.client_id, paid_on: p.paid_on, method: p.method, reference: p.reference, amount: 0, n: 0 };
      g.amount += num(p.amount); g.n += 1; m.set(p.receipt_no!, g);
    }
    for (const g of m.values()) {
      const grp = data.pays.find((p) => p.receipt_no === g.no)?.receipt_group;
      if (grp) g.amount += data.ledger.filter((l) => l.kind === 'overpayment' && l.receipt_group === grp).reduce((s, l) => s + num(l.amount), 0);
    }
    return [...m.values()].sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  }, [data]);
  const list = groups.filter((g) => !q.trim() || `${g.no} ${clientName(g.client_id)} ${g.reference}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-5">
      <div className="card p-3 sm:p-4 flex flex-wrap gap-3 items-center justify-between">
        <SearchInput value={q} onChange={setQ} placeholder="Search receipt, client or UTR" className="flex-1 min-w-[220px]" />
        <button type="button" className="btn-primary" onClick={() => setRec(true)}><Plus className="w-4 h-4" />Record money received</button>
      </div>
      {!list.length ? <Card className="p-2"><EmptyState icon={<Receipt className="w-5 h-5" />} title="No receipts yet" text="Receipts are numbered automatically when a payment is verified or recorded." /></Card> : (
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="data-table">
          <thead><tr><th>Receipt</th><th>Client</th><th>Date</th><th>Mode · ref</th><th className="text-right">Amount</th><th /></tr></thead>
          <tbody>{list.map((g) => <tr key={g.no}>
            <td className="font-mono text-[12.5px] font-bold">{g.no}{g.n > 1 && <div className="text-[11px] text-ink-400 font-sans font-normal">split across {g.n} invoices</div>}</td>
            <td className="font-semibold">{clientName(g.client_id)}</td><td>{fmtDate(g.paid_on)}</td>
            <td className="text-[12.5px]">{METHODS.find((m) => m.id === g.method)?.label ?? g.method ?? '—'} · <span className="font-mono">{g.reference}</span></td>
            <td className="text-right font-semibold">{inrFmt(g.amount)}</td>
            <td className="text-right"><button type="button" className="icon-btn" title="Download receipt" onClick={() => openReceipt(g.no).catch((e) => notify(errText(e, 'Could not open.'), 'error'))}><Download className="w-4 h-4" /></button></td>
          </tr>)}</tbody>
        </table></div></div>
      )}
      <p className="text-[12px] text-ink-500">Client-uploaded payments still need verifying in the project’s Billing tab; once verified they get a receipt here.</p>
      {rec && <RecordReceipt data={data} clientName={clientName} onClose={() => setRec(false)} onDone={reload} />}
    </div>
  );
}

function RecordReceipt({ data, clientName, onClose, onDone }: { data: Data; clientName: (id: string) => string; onClose: () => void; onDone: () => Promise<void> }) {
  const [client, setClient] = useState(''); const [amount, setAmount] = useState(''); const [ref, setRef] = useState(''); const [date, setDate] = useState(todayIST());
  const [method, setMethod] = useState('bank_transfer'); const [notes, setNotes] = useState(''); const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [key] = useState(newKey);
  const open = data.insts.filter((i) => i.client_id === client && isOpenInst(i) && (i.term_no == null || i.requested_at || i.invoice_number))
    .sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9'));
  const allocated = Object.values(alloc).reduce((s, v) => s + num(v), 0);
  const left = Math.round((num(amount) - allocated) * 100) / 100;
  const auto = () => {
    let rem = num(amount); const a: Record<string, string> = {};
    for (const i of open) { if (rem <= 0) break; const take = Math.min(rem, instDue(i)); a[i.id] = String(Math.round(take * 100) / 100); rem -= take; }
    setAlloc(a);
  };
  const go = async () => {
    setBusy(true);
    try {
      const allocations = Object.entries(alloc).filter(([, v]) => num(v) > 0).map(([installment_id, v]) => ({ installment_id, amount: num(v) }));
      const { data: res, error } = await db().rpc('finance_record_receipt', { p_client_id: client, p_amount: num(amount), p_reference: ref, p_paid_on: date, p_method: method, p_allocations: allocations, p_notes: notes || null, p_idempotency_key: key });
      if (error) throw error;
      notify(`Receipt ${res.receipt_no} recorded.${num(res.credit) > 0 ? ` ${inrFmt(res.credit)} kept as client credit.` : ''}`, 'success');
      await onDone(); onClose();
    } catch (e) { notify(errText(e, 'Could not record the receipt.'), 'error', 9000); } finally { setBusy(false); }
  };
  const clientsWithOpen = data.clients.filter((c) => data.insts.some((i) => i.client_id === c.id && isOpenInst(i)));
  return (
    <Modal title="Record money received" onClose={onClose} closeDisabled={busy} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block md:col-span-2"><span className="label">Client</span><select className="input" value={client} onChange={(e) => { setClient(e.target.value); setAlloc({}); }}><option value="">Choose client</option>{clientsWithOpen.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
          <label className="block"><span className="label">Amount received</span><input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="block"><span className="label">Date received</span><input className="input" type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="block"><span className="label">How</span><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
          <label className="block"><span className="label">Bank / UTR reference</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} /></label>
        </div>
        {client && (
          <div className="rounded-2xl border border-ink-100 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2"><h3 className="text-[14px] font-bold text-ink-900">Split across invoices</h3><button type="button" className="btn-ghost btn-sm" disabled={!num(amount)} onClick={auto}>Oldest first</button></div>
            {!open.length ? <p className="text-[13px] text-ink-500">{clientName(client)} has nothing due. The whole amount will be kept as their credit.</p> : open.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0"><p className="text-[13px] font-semibold text-ink-900">{i.invoice_number ?? 'Not invoiced'} · {i.name}</p><p className="text-[11.5px] text-ink-500">Due {inrFmt(instDue(i))}{i.due_date ? ` · ${fmtDate(i.due_date)}` : ''}</p></div>
                <input className="input !w-36" type="number" min="0" step="0.01" max={instDue(i)} value={alloc[i.id] ?? ''} onChange={(e) => setAlloc((a) => ({ ...a, [i.id]: e.target.value }))} placeholder="0" />
              </div>
            ))}
            <p className={cx('text-[13px] font-semibold', left < 0 ? 'text-rose-700' : 'text-ink-700')}>{left < 0 ? `Split is ${inrFmt(-left)} more than received` : left > 0 ? `${inrFmt(left)} will be kept as client credit` : 'Fully split'}</p>
          </div>
        )}
        <label className="block"><span className="label">Note <span className="font-normal text-ink-400 ml-1">optional</span></span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={400} /></label>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy || !client || num(amount) <= 0 || ref.trim().length < 3 || left < 0} onClick={() => void go()}>{busy ? 'Saving…' : 'Record receipt'}</button></div>
      </div>
    </Modal>
  );
}

/* ================================================================ notes */

function Notes({ data, clientName, reload, isAdmin }: { data: Data; clientName: (id: string) => string; reload: () => Promise<void>; isAdmin: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const invNo = (id: string) => data.invoices.find((i) => i.id === id)?.invoice_no ?? '—';
  const decide = async (a: Adj, approve: boolean) => {
    let note: string | null = null;
    if (!approve) { note = window.prompt('Why are you rejecting this note?') ?? null; if (!note || note.trim().length < 3) return; }
    setBusy(a.id);
    try { const { error } = await db().rpc('finance_decide_adjustment', { p_id: a.id, p_approve: approve, p_note: note }); if (error) throw error; notify(approve ? 'Approved.' : 'Rejected.', 'success'); await reload(); }
    catch (e) { notify(errText(e, 'Could not save.'), 'error', 8000); } finally { setBusy(null); }
  };
  if (!data.adjs.length) return <Card className="p-2"><EmptyState icon={<FileMinus className="w-5 h-5" />} title="No credit or debit notes" text="Raise one from an invoice in the Invoices tab." /></Card>;
  return (
    <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="data-table">
      <thead><tr><th>Note</th><th>Client</th><th>Against</th><th>Reason</th><th className="text-right">Total</th><th>Status</th><th /></tr></thead>
      <tbody>{data.adjs.map((a) => <tr key={a.id}>
        <td><span className="font-mono text-[12.5px] font-bold">{a.note_no ?? '—'}</span><div className="text-[11px] text-ink-400">{a.kind === 'credit' ? 'Credit note' : 'Debit note'} · {fmtDate(a.issue_date ?? a.requested_at)}</div></td>
        <td className="font-semibold">{clientName(a.client_id)}</td><td className="font-mono text-[12px]">{invNo(a.invoice_id)}</td>
        <td className="text-[13px] max-w-[260px]">{a.reason}{a.status === 'approved' && a.kind === 'credit' && num(a.to_client_credit) > 0 && <div className="text-[11px] text-ink-500">{inrFmt(a.to_client_credit)} kept as client credit</div>}{a.decision_note && <div className="text-[11px] text-ink-500">{a.decision_note}</div>}</td>
        <td className={cx('text-right font-semibold', a.kind === 'credit' ? 'text-rose-700' : 'text-amber-800')}>{a.kind === 'credit' ? '−' : '+'}{inrFmt(a.total)}</td>
        <td><Badge tone={a.status === 'approved' ? 'mint' : a.status === 'pending' ? 'amber' : 'rose'} dot>{a.status === 'approved' ? 'Approved' : a.status === 'pending' ? 'Waiting' : 'Rejected'}</Badge></td>
        <td className="text-right whitespace-nowrap">
          {a.status === 'approved' && <button type="button" className="icon-btn" title="Download" onClick={() => openNote(a.id).catch((e) => notify(errText(e, 'Could not open.'), 'error'))}><Download className="w-4 h-4" /></button>}
          {a.status === 'pending' && isAdmin && <>
            <button type="button" className="btn-primary btn-sm" disabled={busy === a.id} onClick={() => void decide(a, true)}><CheckCircle2 className="w-4 h-4" />Approve</button>
            <button type="button" className="icon-btn text-rose-700" title="Reject" disabled={busy === a.id} onClick={() => void decide(a, false)}><XCircle className="w-4 h-4" /></button>
          </>}
        </td>
      </tr>)}</tbody>
    </table></div></div>
  );
}

/* ================================================================ clients & credit */

function ClientsCredit({ data, reload, isAdmin }: { data: Data; reload: () => Promise<void>; isAdmin: boolean }) {
  const [edit, setEdit] = useState<Client | null>(null); const [apply, setApply] = useState<Client | null>(null); const [refund, setRefund] = useState<Client | null>(null); const [q, setQ] = useState('');
  const bal = (id: string) => data.ledger.filter((l) => l.client_id === id).reduce((s, l) => s + num(l.amount), 0);
  const list = data.clients.filter((c) => !q.trim() || c.company_name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-5">
      <div className="card p-3 sm:p-4"><SearchInput value={q} onChange={setQ} placeholder="Search clients" /></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="data-table">
        <thead><tr><th>Client</th><th>Billing name · GSTIN</th><th>State</th><th className="text-right">Credit</th><th /></tr></thead>
        <tbody>{list.map((c) => { const p = data.profiles.find((x) => x.client_id === c.id); const b = bal(c.id); return (
          <tr key={c.id}>
            <td className="font-semibold">{c.company_name}</td>
            <td>{p ? <><p className="text-[13px]">{p.legal_name}</p><p className="text-[11px] text-ink-400 font-mono">{p.gstin ?? 'Unregistered'}</p></> : <Badge tone="amber">Billing details missing</Badge>}</td>
            <td className="text-[13px]">{p ? stateName(p.state_code) : '—'}</td>
            <td className={cx('text-right font-semibold', b > 0 && 'text-mint-700')}>{inrFmt(b)}</td>
            <td className="text-right whitespace-nowrap">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setEdit(c)}><Building2 className="w-4 h-4" />{p ? 'Edit' : 'Add'} billing</button>
              {b > 0 && <button type="button" className="btn-ghost btn-sm" onClick={() => setApply(c)}>Use credit</button>}
              {b > 0 && isAdmin && <button type="button" className="btn-ghost btn-sm" onClick={() => setRefund(c)}>Refund</button>}
            </td>
          </tr>
        ); })}</tbody>
      </table></div></div>
      {edit && <BillingProfileModal client={edit} profile={data.profiles.find((p) => p.client_id === edit.id)} onClose={() => setEdit(null)} onDone={reload} />}
      {apply && <ApplyCredit client={apply} balance={bal(apply.id)} insts={data.insts.filter((i) => i.client_id === apply.id && isOpenInst(i))} onClose={() => setApply(null)} onDone={reload} />}
      {refund && <RefundModal client={refund} balance={bal(refund.id)} onClose={() => setRefund(null)} onDone={reload} />}
    </div>
  );
}

export function BillingProfileModal({ client, profile, onClose, onDone }: { client: Client; profile?: BillingProfile; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ legal_name: profile?.legal_name ?? client.company_name, gstin: profile?.gstin ?? '', pan: profile?.pan ?? '', state_code: profile?.state_code ?? '', address: profile?.address ?? '', city: profile?.city ?? '', pincode: profile?.pincode ?? '', emails: (profile?.billing_emails ?? []).join(', ') });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const onGstin = (v: string) => { const g = v.toUpperCase().replace(/\s/g, ''); setF((x) => ({ ...x, gstin: g, state_code: /^\d{2}/.test(g) && GST_STATES.some((s) => s.code === g.slice(0, 2)) ? g.slice(0, 2) : x.state_code, pan: g.length >= 12 ? g.slice(2, 12) : x.pan })); };
  const go = async () => {
    setBusy(true);
    try {
      const { error } = await db().rpc('finance_set_client_billing', { p_client_id: client.id, p: { ...f, billing_emails: f.emails.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean) } });
      if (error) throw error; notify('Billing details saved.', 'success'); await onDone(); onClose();
    } catch (e) { notify(errText(e, 'Could not save.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Billing details · ${client.company_name}`} onClose={onClose} closeDisabled={busy} wide>
      <div className="space-y-4">
        <p className="text-[13px] text-ink-600">Printed on every invoice. The state decides CGST+SGST (same state as you) or IGST (other state).</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block md:col-span-2"><span className="label">Legal / billing name</span><input className="input" value={f.legal_name} onChange={(e) => set('legal_name', e.target.value)} maxLength={160} /></label>
          <label className="block"><span className="label">GSTIN <span className="font-normal text-ink-400 ml-1">leave empty if not registered</span></span><input className="input font-mono" value={f.gstin} onChange={(e) => onGstin(e.target.value)} maxLength={15} placeholder="36ABCDE1234F1Z5" /></label>
          <label className="block"><span className="label">PAN</span><input className="input font-mono" value={f.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} maxLength={10} /></label>
          <label className="block"><span className="label">State (place of supply)</span><select className="input" value={f.state_code} onChange={(e) => set('state_code', e.target.value)}><option value="">Choose state</option>{GST_STATES.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}</select></label>
          <label className="block"><span className="label">City</span><input className="input" value={f.city} onChange={(e) => set('city', e.target.value)} maxLength={80} /></label>
          <label className="block md:col-span-2"><span className="label">Address</span><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} maxLength={400} /></label>
          <label className="block"><span className="label">PIN code</span><input className="input" value={f.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" /></label>
          <label className="block"><span className="label">Billing emails <span className="font-normal text-ink-400 ml-1">up to 5, comma separated</span></span><input className="input" value={f.emails} onChange={(e) => set('emails', e.target.value)} /></label>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn-primary" disabled={busy || !f.legal_name.trim() || !f.state_code} onClick={() => void go()}>{busy ? 'Saving…' : 'Save'}</button></div>
      </div>
    </Modal>
  );
}

function ApplyCredit({ client, balance, insts, onClose, onDone }: { client: Client; balance: number; insts: Inst[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [inst, setInst] = useState(''); const [amt, setAmt] = useState(''); const [busy, setBusy] = useState(false);
  const sel = insts.find((i) => i.id === inst);
  const go = async () => {
    setBusy(true);
    try { const { error } = await db().rpc('finance_apply_credit', { p_installment_id: inst, p_amount: num(amt) }); if (error) throw error; notify('Credit used.', 'success'); await onDone(); onClose(); }
    catch (e) { notify(errText(e, 'Could not use credit.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Use credit · ${client.company_name}`} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <p className="text-[13.5px] text-ink-700">Available credit: <b>{inrFmt(balance)}</b></p>
        <label className="block"><span className="label">Settle</span><select className="input" value={inst} onChange={(e) => { setInst(e.target.value); const i = insts.find((x) => x.id === e.target.value); if (i) setAmt(String(Math.min(balance, instDue(i)))); }}><option value="">Choose invoice / milestone</option>{insts.map((i) => <option key={i.id} value={i.id}>{i.invoice_number ?? 'Not invoiced'} · {i.name} · due {inrFmt(instDue(i))}</option>)}</select></label>
        <label className="block"><span className="label">Amount</span><input className="input" type="number" min="0" step="0.01" max={sel ? Math.min(balance, instDue(sel)) : balance} value={amt} onChange={(e) => setAmt(e.target.value)} /></label>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn-primary" disabled={busy || !inst || num(amt) <= 0} onClick={() => void go()}>{busy ? 'Saving…' : 'Use credit'}</button></div>
      </div>
    </Modal>
  );
}

function RefundModal({ client, balance, onClose, onDone }: { client: Client; balance: number; onClose: () => void; onDone: () => Promise<void> }) {
  const [amt, setAmt] = useState(String(balance)); const [ref, setRef] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const { error } = await db().rpc('finance_record_refund', { p_client_id: client.id, p_amount: num(amt), p_reference: ref, p_note: note || null }); if (error) throw error; notify('Refund recorded.', 'success'); await onDone(); onClose(); }
    catch (e) { notify(errText(e, 'Could not record the refund.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Refund credit · ${client.company_name}`} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <p className="text-[13px] text-ink-600">Record money you have already sent back from the bank. Available credit: <b>{inrFmt(balance)}</b></p>
        <label className="block"><span className="label">Amount refunded</span><input className="input" type="number" min="0" step="0.01" max={balance} value={amt} onChange={(e) => setAmt(e.target.value)} /></label>
        <label className="block"><span className="label">Bank / UTR reference</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} /></label>
        <label className="block"><span className="label">Note <span className="font-normal text-ink-400 ml-1">optional</span></span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></label>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn-primary" disabled={busy || num(amt) <= 0 || ref.trim().length < 3} onClick={() => void go()}>{busy ? 'Saving…' : 'Record refund'}</button></div>
      </div>
    </Modal>
  );
}

/* ================================================================ month-end */

function MonthEnd({ data, clientName }: { data: Data; clientName: (id: string) => string }) {
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const inMonth = (d?: string | null) => !!d && d.slice(0, 7) === month;
  const sales = data.invoices.filter((i) => inMonth(i.issue_date));
  const notes = data.adjs.filter((a) => a.status === 'approved' && inMonth(a.issue_date));
  const receipts = data.pays.filter((p) => ['client', 'finance'].includes(p.source) && p.receipt_no && inMonth(p.paid_on));
  const totals = {
    taxable: sales.filter((i) => i.status === 'issued').reduce((s, i) => s + num(i.taxable_total), 0),
    gst: sales.filter((i) => i.status === 'issued').reduce((s, i) => s + num(i.cgst_total) + num(i.sgst_total) + num(i.igst_total), 0),
    received: receipts.reduce((s, p) => s + num(p.amount), 0),
  };
  const download = async () => {
    setBusy(true);
    try {
      const lines: Record<string, any[]> = {};
      if (sales.length) {
        const { data: l } = await db().from('invoice_lines').select('invoice_id, description, sac, gst_rate').in('invoice_id', sales.map((s) => s.id));
        for (const x of l ?? []) (lines[x.invoice_id] ??= []).push(x);
      }
      const wb = XLSX.utils.book_new();
      const sheet = (name: string, rows: any[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'Nothing this month' }]), name);
      sheet('Sales register', sales.map((i) => ({
        'Invoice no': i.invoice_no, Date: i.issue_date, Status: i.status === 'cancelled' ? 'Cancelled' : 'Issued', Client: i.client_name, GSTIN: i.client_gstin ?? 'Unregistered (B2C)',
        'Place of supply': stateName(i.place_of_supply), Supply: i.supply_type === 'intra' ? 'Intra-state' : 'Inter-state', SAC: (lines[i.id] ?? []).map((x) => x.sac).join(', '),
        'GST rate %': (lines[i.id] ?? []).map((x) => Number(x.gst_rate)).join(', '), Taxable: num(i.taxable_total), CGST: num(i.cgst_total), SGST: num(i.sgst_total), IGST: num(i.igst_total), Total: num(i.grand_total),
      })));
      sheet('Credit & debit notes', notes.map((a) => ({
        'Note no': a.note_no, Type: a.kind === 'credit' ? 'Credit note' : 'Debit note', Date: a.issue_date, Client: clientName(a.client_id),
        'Against invoice': data.invoices.find((i) => i.id === a.invoice_id)?.invoice_no ?? '', Reason: a.reason, 'GST rate %': Number(a.gst_rate), Taxable: num(a.taxable), CGST: num(a.cgst), SGST: num(a.sgst), IGST: num(a.igst), Total: num(a.total),
      })));
      sheet('Receipts', receipts.map((p) => ({
        'Receipt no': p.receipt_no, Date: p.paid_on, Client: clientName(p.client_id), Against: data.insts.find((i) => i.id === p.installment_id)?.invoice_number ?? data.insts.find((i) => i.id === p.installment_id)?.name ?? '',
        Mode: METHODS.find((m) => m.id === p.method)?.label ?? p.method, Reference: p.reference, Amount: num(p.amount),
      })));
      sheet('Outstanding (today)', outstandingRows(data, clientName).map((r) => ({ Client: r.client, Document: r.doc, Milestone: r.inst.name, 'Due date': r.inst.due_date, 'Days late': r.days, Bucket: r.bucket, 'Amount due': r.due })));
      const credit = data.clients.map((c) => ({ Client: c.company_name, Credit: data.ledger.filter((l) => l.client_id === c.id).reduce((s, l) => s + num(l.amount), 0) })).filter((r) => r.Credit !== 0);
      sheet('Client credit', credit);
      XLSX.writeFile(wb, `SIGMA-accounts-${month}.xlsx`);
      notify('Month-end file downloaded.', 'success');
    } catch (e) { notify(errText(e, 'Could not build the file.'), 'error'); } finally { setBusy(false); }
  };
  return (
    <Card className="p-5 space-y-5">
      <CardHeader title="Month-end file" subtitle="One Excel workbook for your accountant: sales register (GST), credit/debit notes, receipts, outstanding and client credit" />
      <div className="flex flex-wrap items-end gap-3">
        <label className="block"><span className="label">Month</span><input className="input" type="month" value={month} max={todayIST().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} /></label>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void download()}><Download className="w-4 h-4" />{busy ? 'Building…' : 'Download Excel'}</button>
      </div>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Stat index={0} icon={<FileText className="w-5 h-5" />} tone="brand" label="Invoices" value={sales.length} caption={`${sales.filter((i) => i.status === 'cancelled').length} cancelled`} />
        <Stat index={1} icon={<BadgeIndianRupee className="w-5 h-5" />} tone="sky" label="Taxable value" value={inrFmt(totals.taxable)} />
        <Stat index={2} icon={<Landmark className="w-5 h-5" />} tone="amber" label="GST charged" value={inrFmt(totals.gst)} />
        <Stat index={3} icon={<Receipt className="w-5 h-5" />} tone="mint" label="Received" value={inrFmt(totals.received)} />
      </div>
    </Card>
  );
}

/* ================================================================ settings */

function CompanySettings({ company, reload }: { company: any; reload: () => Promise<void> }) {
  const c = company ?? {};
  const [f, setF] = useState({
    legal_name: c.legal_name ?? '', trade_name: c.trade_name ?? '', gstin: c.gstin ?? '', pan: c.pan ?? '', state_code: c.state_code ?? '', address: c.address ?? '', city: c.city ?? '',
    pincode: c.pincode ?? '', email: c.email ?? '', phone: c.phone ?? '', invoice_prefix: c.invoice_prefix ?? 'SIG', default_sac: c.default_sac ?? '998361', default_gst_rate: String(c.default_gst_rate ?? 18),
    invoice_terms: c.invoice_terms ?? '', signatory: c.signatory ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const onGstin = (v: string) => { const g = v.toUpperCase().replace(/\s/g, ''); setF((x) => ({ ...x, gstin: g, state_code: /^\d{2}/.test(g) && GST_STATES.some((s) => s.code === g.slice(0, 2)) ? g.slice(0, 2) : x.state_code, pan: g.length >= 12 ? g.slice(2, 12) : x.pan })); };
  const go = async () => {
    setBusy(true);
    try { const { error } = await db().rpc('finance_set_company_profile', { p: { ...f, default_gst_rate: Number(f.default_gst_rate) } }); if (error) throw error; notify('Company details saved.', 'success'); await reload(); }
    catch (e) { notify(errText(e, 'Could not save.'), 'error', 8000); } finally { setBusy(false); }
  };
  const input = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => <label className="block"><span className="label">{label}</span><input className="input" value={(f as any)[k]} onChange={(e) => set(k, e.target.value)} {...props} /></label>;
  return (
    <div className="space-y-5">
      <Card className="p-5 space-y-4">
        <CardHeader title="Your company on invoices" subtitle="Changes apply to new invoices only — issued invoices keep the details they were issued with" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {input('legal_name', 'Legal name', { maxLength: 160 })}
          {input('trade_name', 'Brand / trade name', { maxLength: 160 })}
          <label className="block"><span className="label">GSTIN</span><input className="input font-mono" value={f.gstin} onChange={(e) => onGstin(e.target.value)} maxLength={15} placeholder="36ABCDE1234F1Z5" /></label>
          <label className="block"><span className="label">PAN</span><input className="input font-mono" value={f.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} maxLength={10} /></label>
          <label className="block"><span className="label">State</span><select className="input" value={f.state_code} onChange={(e) => set('state_code', e.target.value)}><option value="">Choose state</option>{GST_STATES.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}</select></label>
          {input('city', 'City', { maxLength: 80 })}
          <label className="block md:col-span-2"><span className="label">Address</span><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} maxLength={400} /></label>
          {input('pincode', 'PIN code', { inputMode: 'numeric', maxLength: 6 })}
          {input('email', 'Billing email', { type: 'email', maxLength: 160 })}
          {input('phone', 'Phone', { maxLength: 20 })}
          {input('signatory', 'Authorised signatory', { maxLength: 120 })}
        </div>
      </Card>
      <Card className="p-5 space-y-4">
        <CardHeader title="Numbering & GST" subtitle="Numbers restart every financial year (April): SIG/26-27/0001, SIG/RCT/26-27/0001, SIG/CN/…, SIG/DN/…" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {input('invoice_prefix', 'Prefix', { maxLength: 8 })}
          {input('default_sac', 'SAC code', { maxLength: 8, inputMode: 'numeric' })}
          <label className="block"><span className="label">Usual GST rate</span><select className="input" value={f.default_gst_rate} onChange={(e) => set('default_gst_rate', e.target.value)}>{['0', '5', '12', '18', '28', '40'].map((r) => <option key={r} value={r}>{r}%</option>)}</select></label>
          <label className="block md:col-span-3"><span className="label">Terms printed on invoices <span className="font-normal text-ink-400 ml-1">optional</span></span><textarea className="input min-h-[80px]" value={f.invoice_terms} onChange={(e) => set('invoice_terms', e.target.value)} maxLength={2000} placeholder="Payment within 7 days. Interest at 18% p.a. on late payment." /></label>
        </div>
        <p className="text-[12px] text-ink-500"><Settings2 className="w-3.5 h-3.5 inline mr-1" />998361 is the SAC for advertising agency services; confirm the right code and rate with your CA.</p>
        <div className="flex justify-end"><button type="button" className="btn-primary" disabled={busy} onClick={() => void go()}>{busy ? 'Saving…' : 'Save company details'}</button></div>
      </Card>
      <PaymentDetailsCard />
    </div>
  );
}

export { openForInstallment };
