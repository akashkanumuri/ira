import React, { useCallback, useEffect, useState } from 'react';
import { Award, BadgeIndianRupee, BookOpen, Flag, GraduationCap, MessageSquare, Plus, ShieldAlert, TrendingUp, UserCog } from 'lucide-react';
import { MILESTONE_KIND, perfApi, type Milestone, type MilestoneKind } from '../../lib/performance';
import { money, dateLabel } from '../../lib/v2';
import { notify } from '../../lib/toast';
import { getKolkataDateString } from '../../lib/workingDays';
import { Badge, Button, EmptyState, Notice, Skeleton, cx } from '../../ui';
import { Modal } from '../../ui/Modal';

const ICON: Record<MilestoneKind, React.ReactNode> = {
  promotion: <TrendingUp className="w-4 h-4" />, role_change: <UserCog className="w-4 h-4" />, recognition: <Award className="w-4 h-4" />,
  training: <BookOpen className="w-4 h-4" />, certification: <GraduationCap className="w-4 h-4" />, warning: <ShieldAlert className="w-4 h-4" />,
  improvement_plan: <Flag className="w-4 h-4" />, note: <MessageSquare className="w-4 h-4" />,
};
const DOT: Record<string, string> = {
  mint: 'bg-mint-50 text-mint-600 ring-mint-100', brand: 'bg-brand-50 text-brand-600 ring-brand-100', amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  sky: 'bg-sky-50 text-sky-600 ring-sky-100', rose: 'bg-rose-50 text-rose-600 ring-rose-100', ink: 'bg-ink-100 text-ink-600 ring-ink-100', dark: 'bg-ink-900 text-white ring-ink-200',
};

type Entry = { key: string; date: string; title: string; detail?: string | null; tone: string; icon: React.ReactNode; label: string; hidden?: boolean };

/** Career timeline: milestones plus salary revisions. `canAdd`: 'hr' (every kind) | 'manager' (recognition, training…) | false. */
export function GrowthTimeline({ employeeId, canAdd = false, showSalary = true, designations = [] }: { employeeId: string; canAdd?: 'hr' | 'manager' | false; showSalary?: boolean; designations?: Array<{ id: string; name: string }> }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [ms, sal] = await Promise.all([
        perfApi.milestones(employeeId),
        showSalary ? perfApi.salaryHistory(employeeId).catch(() => []) : Promise.resolve([]),
      ]);
      const list: Entry[] = ms.map((m: Milestone) => ({
        key: m.id, date: m.effective_date, title: m.title,
        detail: [m.from_value && m.to_value ? `${m.from_value} → ${m.to_value}` : m.to_value, m.details].filter(Boolean).join(' · ') || null,
        tone: MILESTONE_KIND[m.kind].tone, icon: ICON[m.kind], label: MILESTONE_KIND[m.kind].label, hidden: !m.visible_to_employee,
      }));
      const sorted = [...sal].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
      sorted.forEach((s, i) => list.push({
        key: `sal-${s.id}`, date: s.effective_from, title: i === 0 ? `Joined at ${money(s.monthly_salary)} / month` : `Salary revised to ${money(s.monthly_salary)} / month`,
        detail: i > 0 ? `from ${money(sorted[i - 1].monthly_salary)}` : null, tone: 'ink', icon: <BadgeIndianRupee className="w-4 h-4" />, label: 'Salary',
      }));
      list.sort((a, b) => b.date.localeCompare(a.date));
      setEntries(list);
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load the history.');
      setState('error');
    }
  }, [employeeId, showSalary]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      {canAdd && (
        <div className="flex justify-end mb-3"><button type="button" className="btn-secondary btn-sm" onClick={() => setAdding(true)}><Plus className="w-3.5 h-3.5" /> Add to history</button></div>
      )}
      {state === 'loading' && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}</div>}
      {state === 'error' && <Notice tone="sky">{error}</Notice>}
      {state === 'ready' && (entries.length ? (
        <ol className="relative ml-4 border-l border-ink-200 space-y-5">
          {entries.map((e, i) => (
            <li key={e.key} className="pl-6 relative rise" style={{ ['--i' as any]: i }}>
              <span className={cx('absolute -left-[17px] top-0 w-8 h-8 rounded-full grid place-items-center ring-4', DOT[e.tone])}>{e.icon}</span>
              <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide tnum">{dateLabel(e.date)}</p>
              <p className="text-sm font-bold text-ink-900 mt-0.5 flex flex-wrap items-center gap-2">{e.title}<Badge tone={e.tone as any}>{e.label}</Badge>{e.hidden && <Badge tone="ink">HR only</Badge>}</p>
              {e.detail && <p className="text-[13px] text-ink-600 mt-0.5">{e.detail}</p>}
            </li>
          ))}
        </ol>
      ) : <EmptyState icon={<TrendingUp className="w-6 h-6" />} title="No history yet" text="Promotions, recognition, training and salary changes appear here." className="!py-8" />)}
      {adding && canAdd && <MilestoneDialog employeeId={employeeId} mode={canAdd} designations={designations} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await load(); }} />}
    </div>
  );
}

export function MilestoneDialog({ employeeId, mode, initialKind, designations = [], onClose, onSaved }: {
  employeeId: string; mode: 'hr' | 'manager'; initialKind?: MilestoneKind; designations?: Array<{ id: string; name: string }>; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const kinds = (Object.keys(MILESTONE_KIND) as MilestoneKind[]).filter((k) => mode === 'hr' || !MILESTONE_KIND[k].hrOnly);
  const [kind, setKind] = useState<MilestoneKind>(initialKind && kinds.includes(initialKind) ? initialKind : kinds[0]);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(getKolkataDateString());
  const [details, setDetails] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const fromTo = kind === 'promotion' || kind === 'role_change';

  async function save() {
    if (title.trim().length < 2) { notify('Give it a title.', 'error'); return; }
    setBusy(true);
    try {
      await perfApi.addMilestone({ employeeId, kind, title: title.trim(), date, details, from: fromTo ? from : undefined, to: fromTo ? to : undefined, visible: mode === 'hr' ? visible : true });
      notify('Added to their history.', 'success');
      await onSaved();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Unable to save.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add to career history" onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={cx('rounded-full px-3.5 py-1.5 text-[12px] font-semibold border transition-colors', kind === k ? 'bg-ink-950 text-white border-ink-950' : 'bg-white text-ink-600 border-ink-200 hover:border-ink-300')}>{MILESTONE_KIND[k].label}</button>
          ))}
        </div>
        <label className="block"><span className="label">Title</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'promotion' ? 'e.g. Promoted to Senior Designer' : kind === 'training' ? 'e.g. Advanced Figma workshop' : ''} maxLength={160} /></label>
        {fromTo && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">From</span><input className="input" list="designation-options" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Previous role" /></label>
            <label className="block"><span className="label">To</span><input className="input" list="designation-options" value={to} onChange={(e) => setTo(e.target.value)} placeholder="New role" /></label>
            <datalist id="designation-options">{designations.map((d) => <option key={d.id} value={d.name} />)}</datalist>
          </div>
        )}
        <label className="block"><span className="label">Date</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="block"><span className="label">Details (optional)</span><textarea className="input" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={4000} /></label>
        {mode === 'hr' && (
          <label className="flex items-center gap-2 text-[13px] text-ink-700"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="accent-[var(--brand)]" /> Visible to the employee and their manager</label>
        )}
        {fromTo && <p className="text-[12px] text-ink-400">This records the change in their history. Update their designation on the employee profile as well.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={() => void save()}>Add</Button>
        </div>
      </div>
    </Modal>
  );
}
