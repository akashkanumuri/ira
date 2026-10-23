import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { AWAITING_CLIENT_CONTRACT, OPEN_MODIFICATION } from './sigma';
import { getKolkataDateString } from './workingDays';

/**
 * Organisation-wide client / delivery / finance snapshot for the admin dashboard.
 * Selects only the columns the summaries need; RLS limits rows to what the
 * signed-in admin may read.
 */
export interface OrgOverview {
  clients: { total: number; active: number; newThisMonth: number };
  contracts: { awaitingClient: number; declined: number; expiringSoon: number };
  delivery: {
    open: number;
    overdue: number;
    awaitingClient: number;
    awaitingReview: number;
    blocked: number;
    readyForDownload: number;
    completed: number;
  };
  modifications: { open: number };
  dependencies: { toReview: number; waitingOnClient: number };
  finance: {
    billed: number;
    collected: number;
    outstanding: number;
    overdueAmount: number;
    overdueCount: number;
    nextDue: { date: string; amount: number } | null;
    paymentsToVerify: number;
  };
}

const OPEN_DELIVERABLE = ['Pending', 'In Progress', 'Awaiting Client Dependency', 'Under Internal Review', 'Awaiting Client Review', 'Modification Requested', 'Revision In Progress'];

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function loadOrgOverview(): Promise<OrgOverview> {
  const db = supabase as any;
  const today = getKolkataDateString();
  const monthStart = `${today.slice(0, 7)}-01`;

  const [clientsR, contractsR, delivR, modsR, depsR, instR, payR] = await Promise.all([
    db.from('clients').select('id,status,created_at').is('deleted_at', null),
    db.from('contracts').select('id,status,end_date').is('deleted_at', null),
    db.from('deliverables').select('id,status,due_date,lock_state').is('deleted_at', null),
    db.from('change_requests').select('id,status'),
    db.from('deliverable_dependencies').select('id,status'),
    db.from('payment_installments').select('id,amount,tax_amount,amount_paid,status,due_date').is('deleted_at', null),
    db.from('payments').select('id,status'),
  ]);
  const firstError = [clientsR, contractsR, delivR, modsR, depsR, instR, payR].find((r) => r.error)?.error;
  if (firstError) throw firstError;

  const clients = clientsR.data ?? [];
  const contracts = contractsR.data ?? [];
  const deliverables = delivR.data ?? [];
  const installments = instR.data ?? [];

  const open = deliverables.filter((d: any) => OPEN_DELIVERABLE.includes(d.status));
  const billable = installments.filter((i: any) => !['Cancelled', 'Waived', 'Upcoming'].includes(i.status));
  const total = (i: any) => Number(i.amount ?? 0) + Number(i.tax_amount ?? 0);
  const overdue = installments.filter((i: any) => i.status === 'Overdue');
  const upcoming = installments
    .filter((i: any) => ['Upcoming', 'Due', 'Partially Paid'].includes(i.status) && i.due_date && i.due_date >= today)
    .sort((a: any, b: any) => a.due_date.localeCompare(b.due_date))[0];

  return {
    clients: {
      total: clients.length,
      active: clients.filter((c: any) => String(c.status).toLowerCase() === 'active').length,
      newThisMonth: clients.filter((c: any) => String(c.created_at ?? '').slice(0, 10) >= monthStart).length,
    },
    contracts: {
      awaitingClient: contracts.filter((c: any) => AWAITING_CLIENT_CONTRACT.includes(c.status)).length,
      declined: contracts.filter((c: any) => c.status === 'Declined').length,
      expiringSoon: contracts.filter((c: any) => c.status === 'Accepted' && c.end_date && c.end_date >= today && c.end_date <= addDays(today, 30)).length,
    },
    delivery: {
      open: open.length,
      overdue: open.filter((d: any) => d.due_date && d.due_date < today).length,
      awaitingClient: open.filter((d: any) => d.status === 'Awaiting Client Dependency' || d.status === 'Awaiting Client Review').length,
      awaitingReview: open.filter((d: any) => d.status === 'Under Internal Review').length,
      blocked: deliverables.filter((d: any) => d.lock_state === 'locked_payment' || d.lock_state === 'locked_manual').length,
      readyForDownload: deliverables.filter((d: any) => d.status === 'Ready for Download').length,
      completed: deliverables.filter((d: any) => d.status === 'Completed' || d.status === 'Ready for Download').length,
    },
    modifications: { open: (modsR.data ?? []).filter((m: any) => OPEN_MODIFICATION.includes(m.status)).length },
    dependencies: {
      toReview: (depsR.data ?? []).filter((d: any) => d.status === 'Uploaded').length,
      waitingOnClient: (depsR.data ?? []).filter((d: any) => ['Requested', 'Pending', 'Resubmission Required', 'Rejected'].includes(d.status)).length,
    },
    finance: {
      billed: billable.reduce((s: number, i: any) => s + total(i), 0),
      collected: installments.reduce((s: number, i: any) => s + Number(i.amount_paid ?? 0), 0),
      outstanding: billable.reduce((s: number, i: any) => s + Math.max(0, total(i) - Number(i.amount_paid ?? 0)), 0),
      overdueAmount: overdue.reduce((s: number, i: any) => s + Math.max(0, total(i) - Number(i.amount_paid ?? 0)), 0),
      overdueCount: overdue.length,
      nextDue: upcoming ? { date: upcoming.due_date, amount: Math.max(0, total(upcoming) - Number(upcoming.amount_paid ?? 0)) } : null,
      paymentsToVerify: (payR.data ?? []).filter((p: any) => p.status === 'Submitted').length,
    },
  };
}

export function useOrgOverview(enabled = true) {
  const [data, setData] = useState<OrgOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      setData(await loadOrgOverview());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Unable to load the client and finance overview.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}
