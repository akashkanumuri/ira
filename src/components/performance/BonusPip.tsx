import React, { useCallback, useEffect, useState } from 'react';
import { Award, CheckCircle2, Gift, Play, RefreshCw, ShieldAlert, TriangleAlert, UserX } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { Badge, Card, CardHeader, EmptyState, Notice, Skeleton, cx, type Tone } from '../../ui';
import { Modal } from '../../ui/Modal';
import { getKolkataDateString } from '../../lib/workingDays';

/**
 * Bonus & PIP. SIGMA computes the numbers each month and raises cards; the admin approves or
 * dismisses every one. Thresholds and amounts are in Settings → Bonus & PIP.
 */

const db = () => supabase as any;

export interface PerfRules {
  enabled: boolean;
  attendance_bonus_amount: number; attendance_streak_days: number;
  performance_bonus_amount: number; performance_bonus_min_rate: number; min_activity: number;
  pip_first_draft_below: number; warn_first_draft_below: number;
  pip_late_handins_over: number;
  pip_on_time_below: number; warn_on_time_below: number;
  pip_overdue_over: number; warn_overdue_from: number;
  pip_draft_on_time_below: number; warn_draft_on_time_below: number;
  pip_days: number; termination_pip_count: number; termination_window_months: number;
}

export interface PerfNumbers {
  handins: number; late_handins: number; draft_on_time_rate: number | null;
  first_drafts_decided: number; first_draft_rate: number | null;
  tasks_done: number; on_time_rate: number | null; overdue: number; attendance_streak: number;
}

interface Flag {
  id: string; employee_id: string; month: string; kind: 'attendance_bonus' | 'performance_bonus' | 'pip' | 'warning' | 'termination_review';
  amount: number | null; reasons: string[]; status: 'pending' | 'approved' | 'dismissed' | 'recorded';
  payout: 'payslip' | 'gift_card' | null; pip_ends_on: string | null; decision_note: string | null; created_at: string; decided_at: string | null;
}

const KIND: Record<Flag['kind'], { label: string; tone: Tone; icon: React.ReactNode }> = {
  attendance_bonus: { label: 'Attendance bonus', tone: 'mint', icon: <Award className="w-4 h-4" /> },
  performance_bonus: { label: 'Performance bonus', tone: 'mint', icon: <Gift className="w-4 h-4" /> },
  pip: { label: 'PIP', tone: 'rose', icon: <ShieldAlert className="w-4 h-4" /> },
  warning: { label: 'Warning', tone: 'amber', icon: <TriangleAlert className="w-4 h-4" /> },
  termination_review: { label: 'Termination review', tone: 'rose', icon: <UserX className="w-4 h-4" /> },
};

const inr = (n: number | null) => (n == null ? '' : `₹${Number(n).toLocaleString('en-IN')}`);
const monthLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function useRules() {
  const [rules, setRules] = useState<PerfRules | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const { data, error: e } = await db().from('performance_rules').select('*').maybeSingle();
    if (e) setError(e.message); else setRules(data as PerfRules);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { rules, error, reload: load };
}

/* ------------------------------------------------------------------ Settings */

const FIELDS: Array<{ group: string; items: Array<{ key: keyof PerfRules; label: string; suffix?: string; hint?: string }> }> = [
  { group: 'Bonuses', items: [
    { key: 'attendance_bonus_amount', label: 'Attendance bonus', suffix: '₹' },
    { key: 'attendance_streak_days', label: 'On-time working days in a row', suffix: 'days' },
    { key: 'performance_bonus_amount', label: 'Performance bonus', suffix: '₹' },
    { key: 'performance_bonus_min_rate', label: 'First-draft approval above', suffix: '%' },
  ] },
  { group: 'PIP (performance improvement plan)', items: [
    { key: 'pip_first_draft_below', label: 'First-draft approval below', suffix: '%' },
    { key: 'pip_on_time_below', label: 'Tasks on time below', suffix: '%' },
    { key: 'pip_draft_on_time_below', label: 'Drafts on time below', suffix: '%' },
    { key: 'pip_late_handins_over', label: 'Late hand-ins in a month, more than', suffix: '' },
    { key: 'pip_overdue_over', label: 'Tasks gone overdue in a month, more than', suffix: '' },
    { key: 'pip_days', label: 'A PIP lasts', suffix: 'days' },
  ] },
  { group: 'Warnings (shown to the employee, no decision needed)', items: [
    { key: 'warn_first_draft_below', label: 'First-draft approval below', suffix: '%' },
    { key: 'warn_on_time_below', label: 'Tasks on time below', suffix: '%' },
    { key: 'warn_draft_on_time_below', label: 'Drafts on time below', suffix: '%' },
    { key: 'warn_overdue_from', label: 'Tasks gone overdue, from', suffix: '' },
  ] },
  { group: 'Fairness and termination review', items: [
    { key: 'min_activity', label: 'Minimum tasks or hand-ins before a rule can fire', suffix: '', hint: 'So a quiet month cannot trigger a PIP or a bonus.' },
    { key: 'termination_pip_count', label: 'Termination review after more than', suffix: 'PIPs' },
    { key: 'termination_window_months', label: '…within', suffix: 'months' },
  ] },
];

export function BonusPipSettings() {
  const { rules, error, reload } = useRules();
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (rules) setForm(Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, String(v)]))); }, [rules]);

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { enabled: form.enabled === 'true' };
      for (const g of FIELDS) for (const f of g.items) {
        const n = Number(form[f.key]);
        if (!Number.isFinite(n) || n < 0) throw new Error(`“${f.label}” needs a number.`);
        payload[f.key] = n;
      }
      const { error: e } = await db().rpc('performance_rules_save', { p: payload });
      if (e) throw new Error(e.message);
      notify('Bonus & PIP rules saved.', 'success');
      await reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); } finally { setBusy(false); }
  }

  if (error) return <Notice tone="rose">{error}</Notice>;
  if (!rules) return <Card className="p-5"><Skeleton className="h-40 w-full rounded-2xl" /></Card>;
  return (
    <Card className="p-5 sm:p-6 space-y-6">
      <CardHeader title="Bonus & PIP rules" subtitle="Checked on the 1st of every month for the month just ended. Nothing happens to anyone until you approve it on the Performance page." />
      <label className="flex items-center gap-3 text-[14px] font-semibold text-ink-900">
        <input type="checkbox" className="w-[18px] h-[18px] accent-[var(--brand)]" checked={form.enabled === 'true'} onChange={(e) => setForm({ ...form, enabled: String(e.target.checked) })} />
        Rules are switched on
      </label>
      {FIELDS.map((g) => (
        <section key={g.group}>
          <h4 className="text-[13px] font-bold text-ink-800 mb-2.5">{g.group}</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {g.items.map((f) => (
              <label key={f.key} className="block">
                <span className="label">{f.label}</span>
                <span className="flex items-center gap-2">
                  {f.suffix === '₹' && <span className="text-ink-500 font-semibold">₹</span>}
                  <input type="number" min={0} step="1" className="input" value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                  {f.suffix && f.suffix !== '₹' && <span className="text-[13px] text-ink-500 whitespace-nowrap">{f.suffix}</span>}
                </span>
                {f.hint && <span className="block text-[12px] text-ink-500 mt-1">{f.hint}</span>}
              </label>
            ))}
          </div>
        </section>
      ))}
      <div className="flex justify-end"><button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>{busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}Save rules</button></div>
    </Card>
  );
}

/* ------------------------------------------------------------------ Admin decisions */

export function BonusPipAdmin({ nameOf }: { nameOf: (employeeId: string) => string }) {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [view, setView] = useState<'pending' | 'history'>('pending');
  const [acting, setActing] = useState<{ flag: Flag; decision: 'approved' | 'dismissed' } | null>(null);
  const [note, setNote] = useState('');
  const [payout, setPayout] = useState<'payslip' | 'gift_card'>('payslip');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await db().from('performance_flags').select('*').order('created_at', { ascending: false }).limit(300);
    if (error) { notify(error.message, 'error'); setFlags([]); return; }
    setFlags((data ?? []) as Flag[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function evaluate(which: 'last' | 'this') {
    const d = new Date(`${getKolkataDateString()}T12:00:00Z`);
    if (which === 'last') d.setUTCMonth(d.getUTCMonth() - 1);
    const month = d.toISOString().slice(0, 8) + '01';
    setBusy(true);
    try {
      const { data, error } = await db().rpc('performance_evaluate', { p_month: month });
      if (error) throw new Error(error.message);
      notify(data ? `${data} new card${data === 1 ? '' : 's'} for ${monthLabel(month)}.` : `Nothing new for ${monthLabel(month)}.`, 'success');
      await load();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not run the check.', 'error'); } finally { setBusy(false); }
  }

  async function decide() {
    if (!acting) return;
    setBusy(true);
    try {
      const { error } = await db().rpc('performance_decide', { p_flag_id: acting.flag.id, p_decision: acting.decision, p_note: note.trim() || null, p_payout: payout });
      if (error) throw new Error(error.message);
      notify(acting.decision === 'approved' ? 'Approved.' : 'Dismissed.', 'success');
      setActing(null); setNote('');
      await load();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save the decision.', 'error'); } finally { setBusy(false); }
  }

  const pending = (flags ?? []).filter((f) => f.status === 'pending');
  const history = (flags ?? []).filter((f) => f.status !== 'pending');
  const shown = view === 'pending' ? pending : history;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2" role="group" aria-label="Show">
          {(['pending', 'history'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={cx('px-4 py-2 rounded-full text-[13px] font-semibold', view === v ? 'bg-ink-950 text-white' : 'bg-white border border-ink-100 text-ink-700')}>
              {v === 'pending' ? `Waiting for you · ${pending.length}` : `Decided · ${history.length}`}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void evaluate('this')}><Play className="w-3.5 h-3.5" />Check this month so far</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void evaluate('last')}><Play className="w-3.5 h-3.5" />Check last month</button>
        </div>
      </div>
      <p className="text-[12.5px] text-ink-500">SIGMA checks automatically on the 1st of each month. Nothing changes for anyone until you approve a card. Change the rules in Settings → Bonus & PIP.</p>

      {flags === null ? <Card className="p-5"><Skeleton className="h-24 w-full rounded-2xl" /></Card>
        : shown.length === 0 ? <Card><EmptyState icon={<CheckCircle2 className="w-6 h-6" />} title={view === 'pending' ? 'Nothing waiting for a decision' : 'No decisions yet'} /></Card>
        : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {shown.map((f) => {
              const k = KIND[f.kind];
              return (
                <Card key={f.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display font-bold text-[16px] text-ink-900 truncate">{nameOf(f.employee_id)}</p>
                      <p className="text-[12.5px] text-ink-500">{monthLabel(f.month)}</p>
                    </div>
                    <Badge tone={k.tone} dot>{k.label}{f.amount ? ` · ${inr(f.amount)}` : ''}</Badge>
                  </div>
                  <ul className="mt-3 space-y-1">{(f.reasons ?? []).map((r, i) => <li key={i} className="text-[13.5px] text-ink-700">• {r}</li>)}</ul>
                  {f.status !== 'pending' && (
                    <p className="mt-3 text-[12.5px] text-ink-500">
                      {f.status === 'approved' ? 'Approved' : f.status === 'dismissed' ? 'Dismissed' : 'Recorded'}
                      {f.payout ? ` · ${f.payout === 'payslip' ? 'add to payslip' : 'gift card'}` : ''}
                      {f.pip_ends_on ? ` · PIP until ${new Date(`${f.pip_ends_on}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : ''}
                      {f.decision_note ? ` · “${f.decision_note}”` : ''}
                    </p>
                  )}
                  {f.status === 'pending' && (
                    <div className="mt-4 flex gap-2">
                      <button type="button" className="btn-primary btn-sm" onClick={() => { setActing({ flag: f, decision: 'approved' }); setNote(''); setPayout('payslip'); }}>Approve</button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => { setActing({ flag: f, decision: 'dismissed' }); setNote(''); }}>Dismiss</button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

      {acting && (
        <Modal title={`${acting.decision === 'approved' ? 'Approve' : 'Dismiss'} · ${KIND[acting.flag.kind].label}`} onClose={() => !busy && setActing(null)} closeDisabled={busy}>
          <div className="space-y-4">
            <p className="text-[13.5px] text-ink-700"><b>{nameOf(acting.flag.employee_id)}</b> · {monthLabel(acting.flag.month)}</p>
            {acting.decision === 'approved' && (acting.flag.kind === 'attendance_bonus' || acting.flag.kind === 'performance_bonus') && (
              <fieldset className="space-y-2">
                <legend className="label">How is the {inr(acting.flag.amount)} paid?</legend>
                {(['payslip', 'gift_card'] as const).map((p) => (
                  <label key={p} className="flex items-center gap-2.5 text-[14px]">
                    <input type="radio" name="payout" checked={payout === p} onChange={() => setPayout(p)} className="accent-[var(--brand)]" />
                    {p === 'payslip' ? 'Add to this month’s payslip' : 'Gift card (outside payroll)'}
                  </label>
                ))}
              </fieldset>
            )}
            {acting.decision === 'approved' && acting.flag.kind === 'pip' && <Notice tone="amber">The PIP starts today and is shown to the employee in their Performance page.</Notice>}
            <label className="block"><span className="label">{acting.decision === 'dismissed' ? 'Reason (required)' : 'Note (optional)'}</span>
              <textarea className="input min-h-20" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setActing(null)}>Cancel</button>
              <button type="button" className={acting.decision === 'approved' ? 'btn-primary' : 'btn-danger'} disabled={busy || (acting.decision === 'dismissed' && !note.trim())} onClick={() => void decide()}>
                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}{acting.decision === 'approved' ? 'Approve' : 'Dismiss'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ My numbers (employee) */

export function MyBonusPip() {
  const { rules } = useRules();
  const [nums, setNums] = useState<PerfNumbers | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void (async () => {
      const [n, f] = await Promise.all([
        db().rpc('performance_numbers', {}),
        db().from('performance_flags').select('*').neq('status', 'dismissed').order('created_at', { ascending: false }).limit(24),
      ]);
      if (n.error) setError(n.error.message); else setNums(n.data as PerfNumbers);
      if (!f.error) setFlags((f.data ?? []) as Flag[]);
    })();
  }, []);

  if (error) return <Notice tone="rose">{error}</Notice>;
  if (!nums || !rules) return <Card className="p-5"><Skeleton className="h-32 w-full rounded-2xl" /></Card>;

  const rows: Array<{ label: string; value: string; good: boolean | null; target: string }> = [
    { label: 'On-time days in a row', value: `${nums.attendance_streak} days`, good: nums.attendance_streak >= rules.attendance_streak_days ? true : null, target: `${rules.attendance_streak_days} days = ${inr(rules.attendance_bonus_amount)} bonus` },
    { label: 'First-draft approval', value: nums.first_draft_rate == null ? '—' : `${nums.first_draft_rate}%`, good: nums.first_draft_rate == null ? null : nums.first_draft_rate >= rules.warn_first_draft_below, target: `above ${rules.performance_bonus_min_rate}% = ${inr(rules.performance_bonus_amount)} · below ${rules.pip_first_draft_below}% = PIP` },
    { label: 'Tasks on time', value: nums.on_time_rate == null ? '—' : `${nums.on_time_rate}%`, good: nums.on_time_rate == null ? null : nums.on_time_rate >= rules.warn_on_time_below, target: `keep above ${rules.warn_on_time_below}% · below ${rules.pip_on_time_below}% = PIP` },
    { label: 'Drafts on time', value: nums.draft_on_time_rate == null ? '—' : `${nums.draft_on_time_rate}%`, good: nums.draft_on_time_rate == null ? null : nums.draft_on_time_rate >= rules.warn_draft_on_time_below, target: `keep above ${rules.warn_draft_on_time_below}% · below ${rules.pip_draft_on_time_below}% = PIP` },
    { label: 'Late hand-ins', value: String(nums.late_handins), good: nums.late_handins <= rules.pip_late_handins_over, target: `more than ${rules.pip_late_handins_over} in a month = PIP` },
    { label: 'Tasks gone overdue', value: String(nums.overdue), good: nums.overdue < rules.warn_overdue_from, target: `aim for 0 · more than ${rules.pip_overdue_over} = PIP` },
  ];

  return (
    <div className="space-y-4">
      {flags.filter((f) => f.status === 'approved' && f.kind === 'pip' && f.pip_ends_on && f.pip_ends_on >= getKolkataDateString()).map((f) => (
        <Notice key={f.id} tone="rose" title="You are on a performance improvement plan">Until {new Date(`${f.pip_ends_on}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'UTC' })}. Reasons: {(f.reasons ?? []).join('; ')}.</Notice>
      ))}
      <Card className="p-5 sm:p-6">
        <CardHeader title="My numbers this month" subtitle="Bonuses and PIPs are checked on the 1st of each month. Your manager and admin see the same numbers." />
        <ul className="mt-4 divide-y divide-ink-100">
          {rows.map((r) => (
            <li key={r.label} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-[14px] font-bold text-ink-900">{r.label}</span>
                <span className="block text-[12px] text-ink-500">{r.target}</span>
              </span>
              <span className={cx('text-[16px] font-extrabold tnum', r.good === false ? 'text-rose-700' : r.good ? 'text-mint-600' : 'text-ink-900')}>{r.value}</span>
            </li>
          ))}
        </ul>
      </Card>
      {flags.length > 0 && (
        <Card className="p-5 sm:p-6">
          <CardHeader title="Bonuses, warnings and PIPs" />
          <ul className="mt-3 space-y-2">
            {flags.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
                <span><Badge tone={KIND[f.kind].tone}>{KIND[f.kind].label}</Badge> <span className="text-ink-600 ml-1">{monthLabel(f.month)} · {(f.reasons ?? []).join('; ')}</span></span>
                <span className="text-ink-500">{f.status === 'pending' ? 'Waiting for admin' : f.status === 'approved' ? `Approved${f.amount ? ` · ${inr(f.amount)}` : ''}` : 'Noted'}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
