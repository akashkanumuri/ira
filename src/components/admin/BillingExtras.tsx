import { useCallback, useEffect, useState } from 'react';
import { Landmark, Lock, PauseCircle, PlayCircle, Receipt, Send, Unlock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { errorMessage, fmtDate, inr, rpc, todayIST, type InstallmentRow } from '../../lib/sigma';
import { Badge, Button, Card, CardHead, Dialog, Field, Input, Select, Textarea, useToast, type Tone } from '../client/ClientUI';
import { useLiveRefresh } from '../../lib/live';

const db = supabase as any;

/** What the client can do right now, from the database's own rule (client_portal_state). */
export type ClientStage = 'none' | 'no_contract' | 'contract' | 'pay_first' | 'open' | 'locked';
export const STAGE_LABEL: Record<ClientStage, { label: string; tone: Tone; hint: string }> = {
  none: { label: 'No client', tone: 'neutral', hint: 'This project has no client yet.' },
  no_contract: { label: 'No contract sent', tone: 'neutral', hint: 'The client sees only Contract and Help until you send a contract.' },
  contract: { label: 'Waiting for signature', tone: 'info', hint: 'The contract is with the client. They see only Contract and Help.' },
  pay_first: { label: 'Waiting for Term 1', tone: 'warn', hint: 'Signed. Full access opens once you verify the Term 1 payment.' },
  open: { label: 'Full access', tone: 'ok', hint: 'The client can see their work, review drafts and send inputs.' },
  locked: { label: 'Paused', tone: 'err', hint: 'The client sees only Billing & contract and Help.' },
};

export interface PortalState {
  stage: ClientStage;
  overdue: { name: string; amount: number; due_date: string; lock_on: string } | null;
  auto_lock: boolean;
  grace_days: number;
  hold_reason: string | null;
  open_until: string | null;
}

export function useClientStage(projectId: string, refreshKey?: unknown) {
  const [state, setState] = useState<PortalState | null>(null);
  const load = useCallback(async () => {
    try { setState(await rpc<PortalState>('client_portal_state', { p_project_id: projectId })); } catch { setState(null); }
  }, [projectId]);
  useLiveRefresh(load);
  useEffect(() => { void load(); }, [load, refreshKey]);
  return { state, reload: load };
}

export function StagePill({ stage }: { stage: ClientStage }) {
  const s = STAGE_LABEL[stage] ?? STAGE_LABEL.none;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Admin: see and change the client's access to this project (pause / resume / open for a few days). */
export function ClientAccessCard({ projectId, refreshKey, onChanged }: { projectId: string; refreshKey?: unknown; onChanged?: () => void }) {
  const toast = useToast();
  const { state, reload } = useClientStage(projectId, refreshKey);
  const [dlg, setDlg] = useState<'hold' | 'open' | null>(null);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('3');
  const [busy, setBusy] = useState(false);

  const act = async (action: 'hold' | 'release' | 'open_for_days') => {
    setBusy(true);
    try {
      await rpc('staff_set_project_access', { p_project_id: projectId, p_action: action, p_days: Number(days), p_reason: reason.trim() || null });
      toast(action === 'hold' ? 'Project paused for the client.' : action === 'release' ? 'Pause removed.' : `Opened for ${days} days.`);
      setDlg(null);
      await reload();
      onChanged?.();
    } catch (e) { toast(errorMessage(e), 'err'); } finally { setBusy(false); }
  };

  if (!state) return null;
  const meta = STAGE_LABEL[state.stage] ?? STAGE_LABEL.none;
  const canControl = state.stage === 'open' || state.stage === 'locked';
  return (
    <Card>
      <CardHead
        title="Client access"
        desc={state.hold_reason ? `Paused by you: “${state.hold_reason}”` : state.open_until ? `Open until ${fmtDate(state.open_until)}, even if a payment is late.` : meta.hint}
        action={<StagePill stage={state.stage} />}
      />
      {state.overdue && (
        <p className="text-[13px] text-ink-2 mb-3">
          {state.overdue.name} · {inr(state.overdue.amount)} was due {fmtDate(state.overdue.due_date)}.
          {state.auto_lock ? ` The project pauses on ${fmtDate(state.overdue.lock_on)} if it isn’t paid.` : ' Auto-pause is off for this client.'}
        </p>
      )}
      {canControl && (
        <div className="flex flex-wrap gap-2">
          {!state.hold_reason && <Button size="sm" icon={PauseCircle} onClick={() => { setReason(''); setDlg('hold'); }}>Pause now</Button>}
          {state.hold_reason && <Button size="sm" icon={PlayCircle} loading={busy} onClick={() => void act('release')}>Remove pause</Button>}
          {state.stage === 'locked' && !state.hold_reason && <Button size="sm" icon={Unlock} onClick={() => { setDays('3'); setReason(''); setDlg('open'); }}>Open for a few days</Button>}
          {state.open_until && <Button size="sm" icon={Lock} loading={busy} onClick={() => void act('release')}>End the extension</Button>}
        </div>
      )}
      <Dialog
        open={dlg === 'hold'}
        onClose={() => setDlg(null)}
        tone="danger"
        title="Pause this project for the client"
        desc="They’ll see only Billing & contract and Help, with your reason, until you remove the pause."
        footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={() => void act('hold')}>Pause</Button></>}
      >
        <Field label="Reason (the client sees this)" required><Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Payment for Term 2 is pending." /></Field>
      </Dialog>
      <Dialog
        open={dlg === 'open'}
        onClose={() => setDlg(null)}
        title="Open the project for a few days"
        desc="Gives the client access while a late payment is being sorted out. It pauses again on its own afterwards."
        footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void act('open_for_days')}>Open</Button></>}
      >
        <Field label="Open for"><Select value={days} onChange={e => setDays(e.target.value)}>{[1, 3, 5, 7, 14].map(d => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}</Select></Field>
      </Dialog>
    </Card>
  );
}

/** Admin: ask the client to pay a plan term (Term 2, Term 3…) with a due date. */
export function RequestPaymentDialog({ inst, open, onClose, onDone }: { inst: InstallmentRow | null; open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    // A week from today in India time (not the browser's UTC date, which is a day behind before 5:30 AM).
    const d = new Date(`${todayIST()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7);
    setDue(inst?.due_date && inst.due_date >= todayIST() ? inst.due_date : d.toISOString().slice(0, 10));
  }, [open, inst?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!inst) return null;
  const outstanding = Number(inst.amount) + Number(inst.tax_amount) - Number(inst.amount_paid);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={inst.requested_at ? `Change due date · ${inst.name}` : `Request ${inst.name}`}
      desc={`${inr(outstanding)} — the client is notified in SIGMA and reminded 3 days before, on the day, and every other day after.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Send} loading={busy} disabled={!due || due < todayIST()} onClick={async () => {
        setBusy(true);
        try { await rpc('finance_request_installment', { p_installment_id: inst.id, p_due_date: due }); toast('Payment requested.'); onClose(); await onDone(); }
        catch (e) { toast(errorMessage(e), 'err'); } finally { setBusy(false); }
      }}>{inst.requested_at ? 'Save' : 'Request payment'}</Button></>}
    >
      <Field label="Due date" required><Input type="date" min={todayIST()} value={due} onChange={e => setDue(e.target.value)} /></Field>
    </Dialog>
  );
}

interface ExtraCharge { id: string; deliverable_id: string; draft_no: number; amount: number | null; status: 'to_bill' | 'billed' | 'waived'; created_at: string; deliverables?: { name: string; deliverable_number: string } | null }

/** Admin: extra drafts the client asked for after the included ones — set the price or waive. */
export function ExtraChargesCard({ projectId, onChanged }: { projectId: string; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [rows, setRows] = useState<ExtraCharge[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await db.from('deliverable_extra_charges').select('id, deliverable_id, draft_no, amount, status, created_at, deliverables:deliverable_id (name, deliverable_number)')
      .eq('project_id', projectId).order('created_at', { ascending: false });
    setRows(Array.isArray(data) ? data : []);
  }, [projectId]);
  useLiveRefresh(load);
  useEffect(() => { void load(); }, [load]);
  if (rows.length === 0) return null;
  const open = rows.filter(r => r.status === 'to_bill');
  return (
    <Card>
      <CardHead title="Extra drafts" desc="The client asked for changes after the included drafts. Set the price to add it to their next unpaid term, or waive it." />
      <ul className="divide-y divide-line">
        {rows.map(r => (
          <li key={r.id} className="py-2.5 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium truncate">{r.deliverables?.deliverable_number} · {r.deliverables?.name ?? 'Deliverable'} — draft {r.draft_no}</p>
              <p className="text-xs text-ink-3">{fmtDate(r.created_at, true)}</p>
            </div>
            {r.status === 'to_bill' ? (
              <>
                <Input aria-label="Extra amount" type="number" min={1} placeholder="₹ amount" className="!w-32" value={amounts[r.id] ?? ''} onChange={e => setAmounts(a => ({ ...a, [r.id]: e.target.value }))} />
                <Button size="sm" variant="primary" icon={Receipt} loading={busy === r.id} disabled={!(Number(amounts[r.id]) > 0)} onClick={async () => {
                  setBusy(r.id);
                  try { await rpc('finance_bill_extra', { p_charge_id: r.id, p_amount: Number(amounts[r.id]), p_note: null }); toast('Added to the client’s bill.'); await load(); await onChanged(); }
                  catch (e) { toast(errorMessage(e), 'err'); } finally { setBusy(null); }
                }}>Add to bill</Button>
                <Button size="sm" loading={busy === r.id + 'w'} onClick={async () => {
                  setBusy(r.id + 'w');
                  try { await rpc('finance_waive_extra', { p_charge_id: r.id, p_note: null }); toast('Waived.'); await load(); }
                  catch (e) { toast(errorMessage(e), 'err'); } finally { setBusy(null); }
                }}>Waive</Button>
              </>
            ) : (
              <Badge tone={r.status === 'billed' ? 'ok' : 'neutral'}>{r.status === 'billed' ? `Billed ${inr(r.amount)}` : 'Waived'}</Badge>
            )}
          </li>
        ))}
      </ul>
      {open.length === 0 && <p className="text-xs text-ink-3 mt-2">All extras are handled.</p>}
    </Card>
  );
}

/** Admin: the bank / UPI details clients see when they pay. */
export function PaymentDetailsCard() {
  const toast = useToast();
  const [f, setF] = useState({ name: '', bank: '', number: '', ifsc: '', upi: '', note: '' });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void (async () => {
      const { data } = await db.from('billing_settings').select('bank_account_name, bank_name, bank_account_number, bank_ifsc, upi_id, payment_note').eq('id', true).maybeSingle();
      if (data) setF({ name: data.bank_account_name ?? '', bank: data.bank_name ?? '', number: data.bank_account_number ?? '', ifsc: data.bank_ifsc ?? '', upi: data.upi_id ?? '', note: data.payment_note ?? '' });
      setLoaded(true);
    })();
  }, []);
  if (!loaded) return null;
  return (
    <Card>
      <CardHead title="How clients pay you" desc="Shown to clients when a payment is due. Leave blank what you don’t use." action={<Landmark size={18} className="text-ink-3" />} />
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Account name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Bank"><Input value={f.bank} onChange={e => setF({ ...f, bank: e.target.value })} /></Field>
        <Field label="Account number"><Input value={f.number} onChange={e => setF({ ...f, number: e.target.value })} inputMode="numeric" /></Field>
        <Field label="IFSC"><Input value={f.ifsc} onChange={e => setF({ ...f, ifsc: e.target.value.toUpperCase() })} placeholder="HDFC0001234" /></Field>
        <Field label="UPI ID"><Input value={f.upi} onChange={e => setF({ ...f, upi: e.target.value })} placeholder="name@okhdfc" /></Field>
        <Field label="Note for clients"><Input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="Use the project name as the reference" /></Field>
      </div>
      <div className="mt-4">
        <Button variant="primary" loading={busy} onClick={async () => {
          setBusy(true);
          try { await rpc('staff_set_payment_details', { p_account_name: f.name, p_bank_name: f.bank, p_account_number: f.number, p_ifsc: f.ifsc, p_upi_id: f.upi, p_note: f.note }); toast('Payment details saved.'); }
          catch (e) { toast(errorMessage(e), 'err'); } finally { setBusy(false); }
        }}>Save payment details</Button>
      </div>
    </Card>
  );
}
