import React, { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { CHAIN_LABEL, leaveRuleText, useLeavePolicy, type LeaveChain, type LeaveType } from '../../lib/leave';
import { notify } from '../../lib/toast';
import { Badge, Button, Notice, Skeleton, cx } from '../../ui';
import { Modal } from '../../ui/Modal';

const db = supabase as any;
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

/** Admin: who approves leave, and the rules for each leave type. */
export function LeavePolicySettings() {
  const policy = useLeavePolicy();
  const [savingChain, setSavingChain] = useState<LeaveChain | null>(null);
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);

  async function setChain(chain: LeaveChain) {
    if (chain === policy.chain || savingChain) return;
    setSavingChain(chain);
    try {
      const { data, error } = await db.from('approval_settings').update({ leave_chain: chain }).eq('id', true).select('leave_chain').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Approval settings could not be saved. Refresh and try again.');
      notify('Leave approval chain updated.', 'success');
      await policy.reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Unable to save.', 'error');
    } finally {
      setSavingChain(null);
    }
  }

  if (!policy.loaded) return <div className="card p-5 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}</div>;
  if (!policy.ready) {
    return (
      <Notice tone="sky" title="Leave policy switches on with the next database update">
        Approval chains, leave limits and document rules are ready in the app and will appear here once the leave approvals update is applied. Until then leave works as it does today: admins approve everything.
      </Notice>
    );
  }

  return (
    <div className="space-y-4">
      <section className="card p-5 sm:p-6">
        <p className="font-display font-bold text-[15px] text-ink-900">Who approves leave</p>
        <p className="text-[13px] text-ink-500 mt-0.5">Applies to new requests. Employees without a reporting manager always go straight to admins, and admins can step in at any stage.</p>
        <div className="mt-5 grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Leave approval chain">
          {(Object.keys(CHAIN_LABEL) as LeaveChain[]).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={policy.chain === c} disabled={Boolean(savingChain)} onClick={() => void setChain(c)}
              className={cx('text-left rounded-2xl border px-4 py-4 transition-colors', policy.chain === c ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100' : 'border-ink-200 bg-white hover:border-ink-300')}>
              <span className="flex items-center justify-between gap-2"><span className="text-sm font-bold text-ink-900">{CHAIN_LABEL[c].title}</span>{policy.chain === c && <Badge tone="mint">Current</Badge>}{savingChain === c && <Badge tone="ink">Saving…</Badge>}</span>
              <span className="block text-[12px] text-ink-500 mt-1">{CHAIN_LABEL[c].text}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-ink-100 flex items-center justify-between gap-3">
          <div><p className="font-display font-bold text-[15px] text-ink-900">Leave types</p><p className="text-[12px] text-ink-500">Limits are checked when an employee applies; document rules are checked before approval.</p></div>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing('new')}><Plus className="w-3.5 h-3.5" /> Add type</button>
        </div>
        <ul className="divide-y divide-ink-100">
          {policy.types.map((t) => (
            <li key={t.code} className="px-5 sm:px-6 py-3.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink-900 flex items-center gap-2">{t.name}{!t.active && <Badge tone="ink">Hidden</Badge>}</p>
                <p className="text-[12px] text-ink-500 mt-0.5">{leaveRuleText(t)}</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setEditing(t)} title={`Edit ${t.name}`} aria-label={`Edit ${t.name}`}><Pencil className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      </section>

      {editing && <LeaveTypeDialog type={editing === 'new' ? null : editing} taken={policy.types.map((t) => t.code)} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await policy.reload(); }} />}
    </div>
  );
}

function LeaveTypeDialog({ type, taken, onClose, onSaved }: { type: LeaveType | null; taken: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(type?.name ?? '');
  const [isPaid, setIsPaid] = useState(type?.isPaid ?? true);
  const [annual, setAnnual] = useState(type?.annualLimit?.toString() ?? '');
  const [maxRun, setMaxRun] = useState(type?.maxConsecutiveDays?.toString() ?? '');
  const [docAfter, setDocAfter] = useState(type?.documentRequiredAfterDays?.toString() ?? '');
  const [notice, setNotice] = useState(String(type?.minNoticeDays ?? 0));
  const [halfDay, setHalfDay] = useState(type?.allowHalfDay ?? true);
  const [active, setActive] = useState(type?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    const n = name.trim();
    if (n.length < 2) return setError('Give the leave type a name.');
    const code = type?.code ?? n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 't_$1').slice(0, 31);
    if (!type && (!/^[a-z][a-z0-9_]{1,30}$/.test(code) || taken.includes(code))) return setError('Choose a different name — this one is already used.');
    const values = { annual: numOrNull(annual), maxRun: numOrNull(maxRun), docAfter: numOrNull(docAfter), notice: Number(notice || 0) };
    if ([values.annual, values.maxRun].some((v) => v != null && (!Number.isFinite(v) || v <= 0))) return setError('Limits must be more than zero, or left empty for no limit.');
    if (values.docAfter != null && (!Number.isFinite(values.docAfter) || values.docAfter < 0)) return setError('Document rule must be zero or more days.');
    if (!Number.isInteger(values.notice) || values.notice < 0 || values.notice > 90) return setError('Notice must be 0–90 days.');
    const row = { name: n, is_paid: isPaid, annual_limit: values.annual, max_consecutive_days: values.maxRun, document_required_after_days: values.docAfter, min_notice_days: values.notice, allow_half_day: halfDay, active };
    setBusy(true);
    try {
      const { error: err } = type
        ? await db.from('leave_types').update(row).eq('code', type.code)
        : await db.from('leave_types').insert({ code, ...row, sort_order: 100 });
      if (err) throw err;
      notify(type ? 'Leave type updated.' : 'Leave type added.', 'success');
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save the leave type.');
    } finally {
      setBusy(false);
    }
  }

  const toggle = (label: string, hint: string, value: boolean, set: (v: boolean) => void) => (
    <label className="flex items-start gap-3 rounded-2xl border border-ink-200 px-3.5 py-3 cursor-pointer hover:border-ink-300">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} className="mt-0.5 accent-[var(--brand)]" />
      <span><span className="block text-[13px] font-bold text-ink-900">{label}</span><span className="block text-[11px] text-ink-500">{hint}</span></span>
    </label>
  );

  return (
    <Modal title={type ? `Edit ${type.name} leave` : 'Add a leave type'} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        {error && <Notice tone="rose">{error}</Notice>}
        <label className="block"><span className="label">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maternity" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">Days allowed per year</span><input className="input" inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} placeholder="No limit" /></label>
          <label className="block"><span className="label">Most days in a row</span><input className="input" inputMode="decimal" value={maxRun} onChange={(e) => setMaxRun(e.target.value)} placeholder="No limit" /></label>
          <label className="block"><span className="label">Document needed over</span><input className="input" inputMode="decimal" value={docAfter} onChange={(e) => setDocAfter(e.target.value)} placeholder="Never" /><span className="text-[11px] text-ink-400">days · 0 = always</span></label>
          <label className="block"><span className="label">Notice (days ahead)</span><input className="input" inputMode="numeric" value={notice} onChange={(e) => setNotice(e.target.value)} /></label>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {toggle('Paid', 'Uses the paid balance', isPaid, setIsPaid)}
          {toggle('Half days', 'Can be taken as half a day', halfDay, setHalfDay)}
          {toggle('Available', 'Shown to employees', active, setActive)}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={() => void save()}>{type ? 'Save changes' : 'Add leave type'}</Button>
        </div>
      </div>
    </Modal>
  );
}
