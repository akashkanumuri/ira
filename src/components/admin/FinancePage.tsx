import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeIndianRupee, CheckCircle2, ExternalLink, RefreshCw, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { inr } from '../../lib/sigma';
import { dateLabel } from '../../lib/v2';
import { getKolkataDateString } from '../../lib/workingDays';
import { Card, EmptyState, Notice, Page, PageHeader, PillTabs, SearchInput, SkeletonPage, Stat, StatusBadge } from '../../ui';

interface Milestone {
  id: string;
  name: string;
  number: number | null;
  client: string;
  project: string;
  projectId: string;
  dueDate: string | null;
  total: number;
  paid: number;
  status: string;
  invoice: string | null;
}

interface PaymentRow {
  id: string;
  client: string;
  project: string;
  projectId: string;
  milestone: string;
  amount: number;
  reference: string | null;
  method: string | null;
  paidOn: string | null;
  submittedAt: string | null;
  status: string;
  rejection: string | null;
}

type View = 'milestones' | 'payments' | 'outstanding';

const today = () => getKolkataDateString();

export function FinancePage({ onSelectTab }: { onSelectTab: (tab: string) => void }) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('outstanding');
  const [search, setSearch] = useState('');
  const [onlyToVerify, setOnlyToVerify] = useState(false);

  const load = useCallback(async () => {
    const db = supabase as any;
    const [mR, pR] = await Promise.all([
      db
        .from('payment_installments')
        .select('id, name, installment_number, amount, tax_amount, amount_paid, status, due_date, invoice_number, project_id, projects:project_id (name), clients:client_id (company_name)')
        .is('deleted_at', null)
        .order('due_date', { ascending: true }),
      db
        .from('payments')
        .select('id, amount, reference, method, paid_on, submitted_at, status, rejection_reason, project_id, projects:project_id (name), clients:client_id (company_name), payment_installments:installment_id (name)')
        .order('submitted_at', { ascending: false })
        .limit(500),
    ]);
    if (mR.error || pR.error) {
      setError((mR.error ?? pR.error).message ?? 'Unable to load finance data.');
      setLoading(false);
      return;
    }
    setMilestones(
      (mR.data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        number: r.installment_number ?? null,
        client: r.clients?.company_name ?? '—',
        project: r.projects?.name ?? '—',
        projectId: r.project_id,
        dueDate: r.due_date,
        total: Number(r.amount ?? 0) + Number(r.tax_amount ?? 0),
        paid: Number(r.amount_paid ?? 0),
        status: r.status,
        invoice: r.invoice_number ?? null,
      }))
    );
    setPayments(
      (pR.data ?? []).map((r: any) => ({
        id: r.id,
        client: r.clients?.company_name ?? '—',
        project: r.projects?.name ?? '—',
        projectId: r.project_id,
        milestone: r.payment_installments?.name ?? '—',
        amount: Number(r.amount ?? 0),
        reference: r.reference,
        method: r.method,
        paidOn: r.paid_on,
        submittedAt: r.submitted_at,
        status: r.status,
        rejection: r.rejection_reason,
      }))
    );
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const billable = milestones.filter((m) => !['Cancelled', 'Waived', 'Upcoming'].includes(m.status));
  const billed = billable.reduce((s, m) => s + m.total, 0);
  const collected = milestones.reduce((s, m) => s + m.paid, 0);
  const outstandingRows = billable.filter((m) => m.total - m.paid > 0.009).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const outstanding = outstandingRows.reduce((s, m) => s + (m.total - m.paid), 0);
  const overdue = milestones.filter((m) => m.status === 'Overdue');
  const overdueAmount = overdue.reduce((s, m) => s + Math.max(0, m.total - m.paid), 0);
  const toVerify = payments.filter((p) => p.status === 'Submitted');

  const q = search.trim().toLowerCase();
  const match = (...v: Array<string | null | undefined>) => !q || v.some((x) => String(x ?? '').toLowerCase().includes(q));
  const openProject = (projectId: string) => onSelectTab(`admin-clients?project=${projectId}&view=billing`);

  const shownMilestones = useMemo(() => (view === 'outstanding' ? outstandingRows : milestones).filter((m) => match(m.client, m.project, m.name, m.invoice)), [view, milestones, outstandingRows, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownPayments = payments.filter((p) => (!onlyToVerify || p.status === 'Submitted') && match(p.client, p.project, p.milestone, p.reference));

  if (loading) return <SkeletonPage />;

  return (
    <Page>
      <PageHeader
        title="Finance"
        subtitle="Billing, collections and what’s still owed — across every client."
        actions={<button type="button" className="btn-secondary" onClick={() => { setLoading(true); void load(); }}><RefreshCw className="w-4 h-4" /> Refresh</button>}
      />
      {error && <Notice tone="rose" title="Finance data couldn’t load">{error}</Notice>}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Stat index={0} icon={<BadgeIndianRupee className="w-5 h-5" />} tone="brand" label="Billed" value={inr(billed)} caption={`${billable.length} milestone${billable.length === 1 ? '' : 's'} due or past due`} />
        <Stat index={1} icon={<CheckCircle2 className="w-5 h-5" />} tone="mint" label="Collected" value={inr(collected)} caption={billed > 0 ? `${Math.round((collected / billed) * 100)}% of billed · verified only` : 'Verified payments only'} />
        <Stat index={2} icon={<Wallet className="w-5 h-5" />} tone="amber" label="Outstanding" value={inr(outstanding)} caption={outstandingRows[0]?.dueDate ? `Next due ${dateLabel(outstandingRows[0].dueDate)}` : 'Nothing owed'} />
        <Stat index={3} icon={<AlertTriangle className="w-5 h-5" />} tone="rose" label="Overdue" value={inr(overdueAmount)} caption={overdue.length ? `${overdue.length} milestone${overdue.length === 1 ? '' : 's'} past due` : 'Nothing overdue'} />
      </div>

      {toVerify.length > 0 && (
        <Notice tone="brand" title={`${toVerify.length} payment${toVerify.length === 1 ? '' : 's'} waiting for verification`} action={<button type="button" className="btn-primary btn-sm" onClick={() => { setView('payments'); setOnlyToVerify(true); }}>Review</button>}>
          Clients have submitted these. They don’t count as paid until finance verifies the bank reference.
        </Notice>
      )}

      <Card className="overflow-hidden">
        <div className="p-5 sm:p-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <PillTabs
            value={view}
            onChange={(v) => { setView(v); if (v !== 'payments') setOnlyToVerify(false); }}
            items={[
              { id: 'outstanding', label: 'Outstanding', count: outstandingRows.length },
              { id: 'milestones', label: 'All milestones', count: milestones.length },
              { id: 'payments', label: 'Payments', count: toVerify.length || undefined },
            ]}
          />
          <div className="flex flex-wrap items-center gap-3">
            {view === 'payments' && (
              <label className="inline-flex items-center gap-2 text-[13px] text-ink-600">
                <input type="checkbox" checked={onlyToVerify} onChange={(e) => setOnlyToVerify(e.target.checked)} className="accent-[var(--brand)]" /> Only waiting for verification
              </label>
            )}
            <SearchInput value={search} onChange={setSearch} placeholder="Search client, project, invoice" className="w-full sm:w-64" />
          </div>
        </div>

        {view !== 'payments' ? (
          shownMilestones.length ? (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[820px]">
                <thead><tr><th>Client · project</th><th>Milestone</th><th>Invoice</th><th>Due</th><th className="!text-right">Amount</th><th className="!text-right">Balance</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {shownMilestones.map((m) => {
                    const balance = Math.max(0, m.total - m.paid);
                    const late = m.dueDate && m.dueDate < today() && balance > 0;
                    return (
                      <tr key={m.id}>
                        <td><p className="font-bold text-ink-900">{m.client}</p><p className="text-[11px] text-ink-400">{m.project}</p></td>
                        <td>{m.number ? `#${m.number} · ` : ''}{m.name}</td>
                        <td className="tnum">{m.invoice ?? <span className="text-ink-300">Not issued</span>}</td>
                        <td className={`tnum ${late ? 'text-rose-700 font-semibold' : ''}`}>{m.dueDate ? dateLabel(m.dueDate) : '—'}</td>
                        <td className="tnum text-right font-semibold text-ink-800">{inr(m.total)}</td>
                        <td className="tnum text-right">{balance > 0 ? inr(balance) : <span className="text-mint-700 font-semibold">Paid</span>}</td>
                        <td><StatusBadge status={m.status} /></td>
                        <td><button type="button" className="icon-btn" onClick={() => openProject(m.projectId)} title="Open project billing" aria-label="Open project billing"><ExternalLink className="w-4 h-4" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<Wallet className="w-6 h-6" />} title={view === 'outstanding' ? 'Nothing outstanding' : 'No billing milestones yet'} text={view === 'outstanding' ? 'Every due milestone has been paid.' : 'Milestones are added from each project’s Billing tab.'} />
          )
        ) : shownPayments.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[820px]">
              <thead><tr><th>Client · project</th><th>Milestone</th><th className="!text-right">Amount</th><th>Reference</th><th>Paid on</th><th>Status</th><th /></tr></thead>
              <tbody>
                {shownPayments.map((p) => (
                  <tr key={p.id}>
                    <td><p className="font-bold text-ink-900">{p.client}</p><p className="text-[11px] text-ink-400">{p.project}</p></td>
                    <td>{p.milestone}</td>
                    <td className="tnum text-right font-semibold text-ink-800">{inr(p.amount)}</td>
                    <td className="tnum">{p.reference ?? '—'}{p.method ? <span className="block text-[11px] text-ink-400 capitalize">{p.method}</span> : null}</td>
                    <td className="tnum">{p.paidOn ? dateLabel(p.paidOn) : '—'}</td>
                    <td><StatusBadge status={p.status === 'Submitted' ? 'Pending' : p.status} label={p.status === 'Submitted' ? 'To verify' : p.status} />{p.rejection ? <span className="block text-[11px] text-rose-600 mt-1 max-w-[200px] truncate">{p.rejection}</span> : null}</td>
                    <td><button type="button" className="icon-btn" onClick={() => openProject(p.projectId)} title={p.status === 'Submitted' ? 'Verify in project billing' : 'Open project billing'} aria-label="Open project billing"><ExternalLink className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<BadgeIndianRupee className="w-6 h-6" />} title={onlyToVerify ? 'Nothing to verify' : 'No payments recorded yet'} text={onlyToVerify ? 'All submitted payments have been reviewed.' : 'Client submissions and finance-recorded payments appear here.'} />
        )}
      </Card>
    </Page>
  );
}
