import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, Clock, Copy, CreditCard, FileSignature, LifeBuoy, PauseCircle, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fmtDate, inr } from '../../lib/sigma';
import { Button, Card, cx, useToast } from './ClientUI';
import type { ClientPage } from './ClientWorkspaceViews';

const db = supabase as any;

/** Mirrors the database rule private.client_project_stage — the database is what actually enforces it. */
export type ClientStage = 'none' | 'no_contract' | 'contract' | 'pay_first' | 'open' | 'locked';

export interface ClientPortalState {
  stage: ClientStage;
  contract: { id: string; title: string; status: string; value: number | null; first_term_due_days: number | null; reaccept: boolean } | null;
  term1: { id: string; name: string; amount: number; paid: number; status: string; due_date: string | null; requested_at: string | null; submitted: boolean } | null;
  overdue: { id: string; name: string; amount: number; due_date: string; lock_on: string } | null;
  auto_lock: boolean;
  grace_days: number;
  hold_reason: string | null;
  open_until: string | null;
}

/** Pages a client can open at each stage. Everything else waits until access opens. */
export const ALLOWED_PAGES: Record<ClientStage, ClientPage[]> = {
  none: ['dashboard', 'support', 'notifications', 'settings'],
  no_contract: ['dashboard', 'contracts', 'support', 'notifications', 'settings'],
  contract: ['dashboard', 'contracts', 'support', 'notifications', 'settings'],
  pay_first: ['dashboard', 'contracts', 'payments', 'support', 'notifications', 'settings'],
  locked: ['dashboard', 'contracts', 'payments', 'support', 'notifications', 'settings'],
  open: ['dashboard', 'contracts', 'deliverables', 'progress', 'payments', 'support', 'notifications', 'settings'],
};
export const isGated = (s: ClientStage | null | undefined) => !!s && s !== 'open';

interface PayDetails { account_name: string | null; bank_name: string | null; account_number: string | null; ifsc: string | null; upi_id: string | null; note: string | null }

export function usePaymentDetails(enabled: boolean) {
  const [d, setD] = useState<PayDetails | null>(null);
  useEffect(() => {
    if (!enabled) return;
    void db.rpc('client_payment_details').then(({ data }: { data: PayDetails | null }) => setD(data ?? null));
  }, [enabled]);
  return d;
}

export function PaymentDetailsBox({ details }: { details: PayDetails | null }) {
  const toast = useToast();
  if (!details || !(details.account_number || details.upi_id)) {
    return <p className="text-[13px] text-ink-500">Your account manager will share the bank details with you.</p>;
  }
  const rows: [string, string | null][] = [
    ['Account name', details.account_name], ['Bank', details.bank_name], ['Account number', details.account_number],
    ['IFSC', details.ifsc], ['UPI ID', details.upi_id],
  ];
  return (
    <div className="rounded-2xl border border-ink-100 divide-y divide-ink-100">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
          <span className="text-ink-500">{k}</span>
          <span className="flex items-center gap-2 font-semibold text-ink-900 font-mono">
            {v}
            <button type="button" className="icon-btn !w-7 !h-7" aria-label={`Copy ${k}`} onClick={() => { void navigator.clipboard?.writeText(v ?? ''); toast(`${k} copied`); }}><Copy size={13} /></button>
          </span>
        </div>
      ))}
      {details.note && <p className="px-4 py-2.5 text-[12.5px] text-ink-600">{details.note}</p>}
    </div>
  );
}

const STEPS = [
  { key: 'contract', label: 'Sign the contract', icon: FileSignature },
  { key: 'pay', label: 'Make the first payment', icon: CreditCard },
  { key: 'open', label: 'Work begins', icon: Sparkles },
] as const;

function Steps({ stage }: { stage: ClientStage }) {
  const at = stage === 'pay_first' ? 1 : stage === 'open' || stage === 'locked' ? 2 : 0;
  return (
    <ol className="grid grid-cols-3 gap-2 mt-6" aria-label="Getting started">
      {STEPS.map((s, i) => {
        const done = i < at;
        const now = i === at;
        const I = done ? CheckCircle2 : s.icon;
        return (
          <li key={s.key} className={cx('rounded-2xl px-3 py-3 border text-[12.5px] font-semibold flex items-center gap-2',
            done ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : now ? 'border-primary/40 bg-primary/5 text-primary' : 'border-ink-100 text-ink-400')}>
            <I size={16} className="shrink-0" /><span className="leading-tight">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** What a client sees until their project is open: one clear next step, nothing else to get lost in. */
export function ClientGate({ state, projectName, userName, go }: { state: ClientPortalState; projectName: string; userName: string; go: (p: ClientPage) => void }) {
  const details = usePaymentDetails(state.stage === 'pay_first' || state.stage === 'locked');
  const first = userName.split(' ')[0] || 'there';

  let icon = FileSignature;
  let title = '';
  let body: ReactNode = null;
  let action: ReactNode = null;

  switch (state.stage) {
    case 'no_contract':
    case 'none':
      icon = Clock;
      title = `Welcome, ${first}. Your contract is on its way.`;
      body = <>The team is preparing the contract for <b>{projectName}</b>. You’ll see it here as soon as it’s sent, with a notification.</>;
      action = <Button icon={LifeBuoy} onClick={() => go('support')}>Ask a question</Button>;
      break;
    case 'contract':
      icon = FileSignature;
      title = state.contract?.reaccept ? 'There’s a new version of your contract' : 'Your contract is ready to sign';
      body = <>Read <b>{state.contract?.title ?? 'the contract'}</b>{state.contract?.value ? <> ({inr(state.contract.value)}, GST included)</> : null}, then sign it by typing your name. It takes about two minutes.</>;
      action = <Button variant="primary" icon={FileSignature} onClick={() => go('contracts')}>Review & sign</Button>;
      break;
    case 'pay_first': {
      icon = CreditCard;
      const t = state.term1;
      const due = t ? Number(t.amount) - Number(t.paid) : 0;
      title = t?.submitted ? 'Thanks! We’re confirming your payment.' : `Make the first payment to start the work`;
      body = t?.submitted
        ? <>We’ve received your payment details for <b>{t.name}</b>. Your full project opens as soon as the team confirms it with the bank — usually within a working day.</>
        : (
          <div className="space-y-4">
            <p>Contract signed — thank you. <b>{t?.name ?? 'Term 1'}</b> of <b>{inr(due)}</b> is due{t?.due_date ? <> by <b>{fmtDate(t.due_date)}</b></> : null}. Pay by bank transfer or UPI, then tell us the reference.</p>
            <PaymentDetailsBox details={details} />
          </div>
        );
      action = <Button variant="primary" icon={CreditCard} onClick={() => go('payments')}>{t?.submitted ? 'See billing' : 'I’ve paid — add the reference'}</Button>;
      break;
    }
    case 'locked':
      icon = PauseCircle;
      title = 'Your project is paused';
      body = state.hold_reason
        ? <>{state.hold_reason}</>
        : state.overdue
          ? (
            <div className="space-y-4">
              <p><b>{state.overdue.name}</b> of <b>{inr(state.overdue.amount)}</b> was due on <b>{fmtDate(state.overdue.due_date)}</b>. Your work and files open again as soon as it’s paid.</p>
              <PaymentDetailsBox details={details} />
            </div>
          )
          : <>Please contact your account manager.</>;
      action = <Button variant="primary" icon={CreditCard} onClick={() => go('payments')}>Go to Billing & contract</Button>;
      break;
    default:
      return null;
  }

  const I = icon;
  return (
    <div className="max-w-2xl mx-auto py-4 sm:py-10">
      <Card>
        <div className="p-1 sm:p-3">
          <span className={cx('grid place-items-center w-12 h-12 rounded-2xl', state.stage === 'locked' ? 'bg-rose-50 text-rose-600' : 'bg-primary/10 text-primary')}><I size={22} /></span>
          <h1 className="mt-4 font-display text-[26px] sm:text-[30px] font-bold leading-tight text-ink-950">{title}</h1>
          <div className="mt-3 text-[14.5px] leading-relaxed text-ink-700">{body}</div>
          <div className="mt-6 flex flex-wrap gap-2">
            {action}
            {state.stage !== 'no_contract' && state.stage !== 'none' && <Button icon={LifeBuoy} onClick={() => go('support')}>Help</Button>}
          </div>
          {state.stage !== 'locked' && <Steps stage={state.stage} />}
        </div>
      </Card>
    </div>
  );
}
