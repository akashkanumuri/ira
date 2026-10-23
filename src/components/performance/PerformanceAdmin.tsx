import { TeamReviewMetrics } from './ReviewMetrics';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, CalendarRange, CheckCircle2, Lock, Play, Plus, Target, Trash2, TrendingUp } from 'lucide-react';
import type { Designation, Employee } from '../../types/attendance';
import { CYCLE_STATUS, PERIOD_LABEL, REVIEW_STATUS, perfApi, ratingFor, scoreTone, weighted, type Cycle, type Kra, type PerformanceSettings, type PeriodType, type PromotionCandidate, type Review } from '../../lib/performance';
import { dateLabel } from '../../lib/v2';
import { notify } from '../../lib/toast';
import { getKolkataDateString } from '../../lib/workingDays';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Notice, Page, PageHeader, PillTabs, SearchInput, Skeleton, Stat, cx } from '../../ui';
import { Modal } from '../../ui/Modal';
import { confirmDialog } from '../../ui/confirm';
import { GrowthTimeline, MilestoneDialog } from './GrowthTimeline';

export function PerformanceAdmin({ employees = [], designations = [] }: { employees?: Employee[]; designations?: Designation[] }) {
  const [tab, setTab] = useState<'cycles' | 'quality' | 'promotions' | 'growth'>('cycles');
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => { void perfApi.available().then(setAvailable); }, []);
  const active = useMemo(() => employees.filter((e) => e.status === 'active'), [employees]);

  return (
    <Page>
      <PageHeader title="Performance" subtitle="KRAs, review cycles, work quality, promotions and each person’s growth history." />
      {available === false && (
        <Notice tone="sky" title="Performance switches on with the next database update">
          Review cycles, KRAs, promotions and growth history are built and tested. They appear here once the performance update is applied.
        </Notice>
      )}
      {available && (
        <>
          <PillTabs value={tab} onChange={setTab} items={[{ id: 'cycles', label: 'Review cycles' }, { id: 'quality', label: 'Work quality' }, { id: 'promotions', label: 'Promotions' }, { id: 'growth', label: 'Growth history' }]} />
          {tab === 'cycles' && <Cycles employees={active} designations={designations} />}
          {tab === 'quality' && <TeamReviewMetrics />}
          {tab === 'promotions' && <Promotions designations={designations} />}
          {tab === 'growth' && <Growth employees={active} designations={designations} />}
        </>
      )}
      {available === null && <Card className="p-5 space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}</Card>}
    </Page>
  );
}

/* ------------------------------------------------------------------ cycles */

function Cycles({ employees, designations }: { employees: Employee[]; designations: Designation[] }) {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [kras, setKras] = useState<Kra[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [finalizing, setFinalizing] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const loadCycles = useCallback(async () => {
    try {
      const list = await perfApi.cycles();
      setCycles(list);
      setSelected((s) => s ?? list.find((c) => c.status !== 'closed')?.id ?? list[0]?.id ?? null);
    } catch (e) { notify(e instanceof Error ? e.message : 'Unable to load cycles.', 'error'); }
    finally { setLoading(false); }
  }, []);
  const loadCycle = useCallback(async (id: string) => {
    try {
      const [k, r] = await Promise.all([perfApi.kras(id), perfApi.reviews(id)]);
      setKras(k); setReviews(r);
    } catch (e) { notify(e instanceof Error ? e.message : 'Unable to load the cycle.', 'error'); }
  }, []);
  useEffect(() => { void loadCycles(); }, [loadCycles]);
  useEffect(() => { if (selected) void loadCycle(selected); }, [selected, loadCycle]);

  const cycle = cycles.find((c) => c.id === selected) ?? null;
  const rows = useMemo(() => {
    const ids = cycle?.status === 'draft' ? employees.map((e) => e.id) : Array.from(new Set(reviews.map((r) => r.employee_id)));
    const q = search.trim().toLowerCase();
    return ids.map((id) => {
      const e = employees.find((x) => x.id === id);
      const ks = kras.filter((k) => k.employee_id === id);
      return { id, e, kras: ks, weight: ks.reduce((s, k) => s + Number(k.weightage), 0), review: reviews.find((r) => r.employee_id === id) };
    }).filter((r) => !q || String(r.e?.name ?? '').toLowerCase().includes(q) || String(r.e?.designation ?? '').toLowerCase().includes(q));
  }, [cycle?.status, employees, reviews, kras, search]);

  const ready = rows.filter((r) => r.kras.length && r.weight === 100).length;
  const finalized = reviews.filter((r) => r.status === 'finalized');
  const avg = finalized.length ? finalized.reduce((s, r) => s + Number(r.overall_score ?? 0), 0) / finalized.length : null;

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); notify(ok, 'success'); await loadCycles(); if (selected) await loadCycle(selected); }
    catch (e) { notify(e instanceof Error ? e.message : 'Something went wrong.', 'error'); }
    finally { setBusy(false); }
  }

  if (loading) return <Card className="p-5 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}</Card>;

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr] items-start">
      <div className="space-y-3">
        <Button icon={<Plus className="w-4 h-4" />} className="w-full" onClick={() => setCreating(true)}>New review cycle</Button>
        {cycles.length ? cycles.map((c) => (
          <button key={c.id} type="button" onClick={() => setSelected(c.id)} className={cx('card w-full text-left p-4 transition-colors', selected === c.id ? 'ring-2 ring-brand-300' : 'hover:bg-ink-50/60')}>
            <div className="flex items-center justify-between gap-2"><p className="font-bold text-ink-900 truncate">{c.name}</p><Badge tone={CYCLE_STATUS[c.status].tone}>{CYCLE_STATUS[c.status].label}</Badge></div>
            <p className="text-[12px] text-ink-500 mt-1">{PERIOD_LABEL[c.period_type]} · {dateLabel(c.start_date)} – {dateLabel(c.end_date)}</p>
          </button>
        )) : <Card><EmptyState icon={<CalendarRange className="w-6 h-6" />} title="No review cycles" text="Create one, set KRAs for each person, then open it." className="!py-8" /></Card>}
      </div>

      {cycle ? (
        <div className="space-y-4">
          <Card className="p-5 sm:p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <p className="font-display font-bold text-xl text-ink-900">{cycle.name}</p>
                <p className="text-[13px] text-ink-500">{PERIOD_LABEL[cycle.period_type]} · {dateLabel(cycle.start_date)} – {dateLabel(cycle.end_date)}{cycle.self_review_due ? ` · self-review due ${dateLabel(cycle.self_review_due)}` : ''}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {cycle.status === 'draft' && <>
                  <button type="button" className="btn-ghost btn-sm text-rose-600" disabled={busy} onClick={async () => { if (await confirmDialog({ title: 'Delete this draft cycle?', message: 'Its KRAs are removed too. Nothing has been shared with employees yet.', confirmLabel: 'Delete draft', danger: true })) await act(() => perfApi.deleteDraftCycle(cycle.id).then(() => setSelected(null)), 'Draft deleted.'); }}><Trash2 className="w-3.5 h-3.5" /> Delete draft</button>
                  <Button icon={<Play className="w-4 h-4" />} loading={busy} onClick={async () => { if (await confirmDialog({ title: 'Open this review cycle?', message: `Everyone with KRAs (${ready}) is asked to rate themselves. KRAs can’t be added or re-weighted after this.`, confirmLabel: 'Open cycle' })) await act(() => perfApi.openCycle(cycle.id), 'Cycle opened — employees have been notified.'); }}>Open cycle</Button>
                </>}
                {cycle.status === 'open' && <Button variant="secondary" icon={<Lock className="w-4 h-4" />} loading={busy} onClick={async () => { if (await confirmDialog({ title: 'Close this cycle?', message: 'Every review must be finalized. Closed cycles are read-only.', confirmLabel: 'Close cycle' })) await act(() => perfApi.closeCycle(cycle.id), 'Cycle closed.'); }}>Close cycle</Button>}
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
              <Stat index={0} icon={<Target className="w-5 h-5" />} label={cycle.status === 'draft' ? 'KRAs ready' : 'In this cycle'} value={cycle.status === 'draft' ? ready : reviews.length} caption={cycle.status === 'draft' ? 'Weightage adds to 100%' : 'People being reviewed'} />
              <Stat index={1} tone="amber" label="Self-review" value={reviews.filter((r) => r.status === 'self_review').length} caption="Waiting for employee" />
              <Stat index={2} tone="brand" label="Manager review" value={reviews.filter((r) => r.status === 'manager_review').length} caption="Waiting for manager / HR" />
              <Stat index={3} tone="mint" label="Finalized" value={finalized.length} caption={avg != null ? `Average ${avg.toFixed(1)}%` : 'No scores yet'} />
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardHeader title={cycle.status === 'draft' ? 'Set KRAs for each person' : 'Reviews'} subtitle={cycle.status === 'draft' ? 'Weightage must add up to 100% before the cycle opens.' : undefined} />
              <SearchInput value={search} onChange={setSearch} placeholder="Search people" className="w-full sm:w-56" />
            </div>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[720px]">
                <thead><tr><th>Employee</th><th>KRAs</th><th>Status</th><th className="!text-right">Score</th><th /></tr></thead>
                <tbody>
                  {rows.map(({ id, e, kras: ks, weight, review }) => {
                    const score = review?.overall_score ?? weighted(ks, (k) => k.final_score ?? k.manager_score);
                    return (
                      <tr key={id}>
                        <td><div className="flex items-center gap-3"><Avatar name={e?.name} src={e?.avatar} size={32} /><div className="min-w-0"><p className="font-bold text-ink-900 truncate">{e?.name ?? '—'}</p><p className="text-[11px] text-ink-400">{e?.designation || '—'}</p></div></div></td>
                        <td>{ks.length ? <span className="tnum">{ks.length} · <span className={cx('font-semibold', weight === 100 ? 'text-mint-700' : 'text-rose-600')}>{weight}%</span></span> : <span className="text-ink-300">None</span>}</td>
                        <td>{review ? <Badge tone={REVIEW_STATUS[review.status].tone} dot>{review.status === 'manager_review' && review.manager_submitted_at ? 'Ready to finalize' : REVIEW_STATUS[review.status].label}</Badge> : <span className="text-ink-300">{cycle.status === 'draft' ? 'Draft' : '—'}</span>}</td>
                        <td className="tnum text-right">{score != null ? <span className="font-bold">{Number(score).toFixed(1)}%</span> : '—'}</td>
                        <td className="text-right">
                          {cycle.status === 'draft' && e && <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(e)}>{ks.length ? 'Edit KRAs' : 'Set KRAs'}</button>}
                          {cycle.status === 'open' && review && review.status !== 'finalized' && review.status !== 'self_review' && <button type="button" className="btn-primary btn-sm" onClick={() => setFinalizing(review)}>Finalize</button>}
                          {review?.status === 'finalized' && <button type="button" className="btn-ghost btn-sm" onClick={() => setFinalizing(review)}>View</button>}
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && <tr><td colSpan={5} className="!py-10 text-center text-ink-400">{cycle.status === 'draft' ? 'No active employees.' : 'Nobody in this cycle.'}</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {creating && <NewCycleDialog onClose={() => setCreating(false)} onCreated={async (c) => { setCreating(false); await loadCycles(); setSelected(c.id); }} />}
      {editing && cycle && <KraEditor cycle={cycle} employee={editing} existing={kras.filter((k) => k.employee_id === editing.id)} designations={designations} employees={employees}
        onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await loadCycle(cycle.id); }} />}
      {finalizing && cycle && <FinalizeDialog review={finalizing} kras={kras.filter((k) => k.employee_id === finalizing.employee_id)} employee={employees.find((e) => e.id === finalizing.employee_id)}
        onClose={() => setFinalizing(null)} onDone={async () => { setFinalizing(null); await loadCycle(cycle.id); }} />}
    </div>
  );
}

function NewCycleDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Cycle) => Promise<void> }) {
  const today = getKolkataDateString();
  const [name, setName] = useState('');
  const [period, setPeriod] = useState<PeriodType>('quarterly');
  const [start, setStart] = useState(today.slice(0, 8) + '01');
  const [end, setEnd] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (name.trim().length < 2) { notify('Name the cycle.', 'error'); return; }
    if (!start || !end || end < start) { notify('Pick a valid period.', 'error'); return; }
    setBusy(true);
    try { const c = await perfApi.createCycle({ name: name.trim(), period_type: period, start_date: start, end_date: end, self_review_due: due || null }); notify('Draft cycle created.', 'success'); await onCreated(c); }
    catch (e) { notify(e instanceof Error ? e.message : 'Unable to create the cycle.', 'error'); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="New review cycle" onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <label className="block"><span className="label">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q4 2026" maxLength={80} /></label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PERIOD_LABEL) as PeriodType[]).map((p) => (
            <button key={p} type="button" onClick={() => setPeriod(p)} className={cx('rounded-full px-4 py-2 text-[13px] font-semibold border', period === p ? 'bg-ink-950 text-white border-ink-950' : 'bg-white text-ink-600 border-ink-200 hover:border-ink-300')}>{PERIOD_LABEL[p]}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">From</span><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="block"><span className="label">To</span><input type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <label className="block"><span className="label">Self-review due (optional)</span><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <p className="text-[12px] text-ink-400">The cycle starts as a draft. Employees see nothing until you open it.</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Create draft</Button></div>
      </div>
    </Modal>
  );
}

type Row = { id?: string; title: string; target: string; measurement: string; description: string; weightage: number | '' };

function KraEditor({ cycle, employee, existing, designations, employees, onClose, onSaved }: {
  cycle: Cycle; employee: Employee; existing: Kra[]; designations: Designation[]; employees: Employee[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>(() => existing.length
    ? existing.map((k) => ({ id: k.id, title: k.title, target: k.target ?? '', measurement: k.measurement ?? '', description: k.description ?? '', weightage: Number(k.weightage) }))
    : [{ title: '', target: '', measurement: '', description: '', weightage: '' }]);
  const [copy, setCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const total = rows.reduce((s, r) => s + Number(r.weightage || 0), 0);
  const designation = designations.find((d) => (employee.designationId ? d.id === employee.designationId : d.name === employee.designation));
  const sameRole = designation ? employees.filter((e) => e.id !== employee.id && (e.designationId ? e.designationId === designation.id : e.designation === designation.name)).length : 0;
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    const clean = rows.filter((r) => r.title.trim() || r.weightage !== '');
    if (clean.some((r) => r.title.trim().length < 2)) { notify('Every KRA needs a title.', 'error'); return; }
    if (clean.some((r) => !(Number(r.weightage) > 0 && Number(r.weightage) <= 100))) { notify('Each weightage must be between 1 and 100.', 'error'); return; }
    setBusy(true);
    try {
      await perfApi.saveKras(cycle.id, employee.id, clean.map((r) => ({ ...r, weightage: Number(r.weightage) })), existing);
      if (copy && designation && clean.length) {
        const n = await perfApi.copyKras(cycle.id, employee.id, designation.id);
        notify(`Saved and copied to ${n} other ${designation.name}${n === 1 ? '' : 's'}.`, 'success');
      } else notify(total === 100 ? 'KRAs saved.' : `Saved — weightage is ${total}%, it must reach 100% before opening.`, total === 100 ? 'success' : 'info');
      await onSaved();
    } catch (e) { notify(e instanceof Error ? e.message : 'Unable to save KRAs.', 'error'); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`KRAs · ${employee.name}`} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-ink-500">{cycle.name} · {employee.designation || 'No designation'}</p>
          <Badge tone={total === 100 ? 'mint' : 'rose'}>{total}% of 100%</Badge>
        </div>
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={i} className="rounded-2xl border border-ink-200 p-3 space-y-2">
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="KRA title, e.g. Deliver client brand kits" value={r.title} onChange={(e) => set(i, { title: e.target.value })} maxLength={160} />
                <input className="input !w-24 text-center tnum" inputMode="decimal" placeholder="%" value={r.weightage} onChange={(e) => set(i, { weightage: e.target.value === '' ? '' : Number(e.target.value) })} aria-label="Weightage %" />
                <button type="button" className="icon-btn text-rose-500" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove KRA"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <input className="input" placeholder="Target, e.g. 12 kits" value={r.target} onChange={(e) => set(i, { target: e.target.value })} maxLength={300} />
                <input className="input" placeholder="How it’s measured" value={r.measurement} onChange={(e) => set(i, { measurement: e.target.value })} maxLength={300} />
              </div>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setRows((rs) => [...rs, { title: '', target: '', measurement: '', description: '', weightage: '' }])}><Plus className="w-3.5 h-3.5" /> Add KRA</button>
        {designation && sameRole > 0 && (
          <label className="flex items-start gap-3 rounded-2xl border border-ink-200 px-3.5 py-3 cursor-pointer hover:border-ink-300">
            <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} className="mt-0.5 accent-[var(--brand)]" />
            <span><span className="block text-[13px] font-bold text-ink-900">Use the same KRAs for every {designation.name}</span><span className="block text-[11px] text-ink-500">Replaces the KRAs of {sameRole} other {sameRole === 1 ? 'person' : 'people'} in this cycle.</span></span>
          </label>
        )}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save KRAs</Button></div>
      </div>
    </Modal>
  );
}

function FinalizeDialog({ review, kras, employee, onClose, onDone }: { review: Review; kras: Kra[]; employee?: Employee; onClose: () => void; onDone: () => Promise<void> }) {
  const done = review.status === 'finalized';
  const [overrides, setOverrides] = useState<Record<string, number | ''>>(() => Object.fromEntries(kras.map((k) => [k.id, k.final_score ?? k.manager_score ?? k.self_score ?? ''])));
  const [busy, setBusy] = useState(false);
  const projected = weighted(kras, (k) => (overrides[k.id] === '' ? null : Number(overrides[k.id])));

  async function finalize() {
    if (Object.values(overrides).some((v) => v === '')) { notify('Every KRA needs a final score.', 'error'); return; }
    setBusy(true);
    try {
      const changed = Object.fromEntries(kras.filter((k) => Number(overrides[k.id]) !== Number(k.manager_score ?? k.self_score)).map((k) => [k.id, Number(overrides[k.id])]));
      const score = await perfApi.finalize(review.id, changed);
      notify(`Finalized at ${Number(score).toFixed(1)}% — ${ratingFor(Number(score))}.`, 'success');
      await onDone();
    } catch (e) { notify(e instanceof Error ? e.message : 'Unable to finalize.', 'error'); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`${done ? 'Review' : 'Finalize'} · ${employee?.name ?? ''}`} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        {!review.manager_submitted_at && !done && <Notice tone="amber" title="Manager hasn’t scored yet">You can still finalize; scores default to the employee’s own ratings.</Notice>}
        {review.manager_summary && <div className="inset-tile p-3 text-[13px] text-ink-700"><b>Manager:</b> {review.manager_summary}</div>}
        <div className="overflow-x-auto">
          <table className="data-table min-w-[520px]">
            <thead><tr><th>KRA</th><th className="!text-right">Weight</th><th className="!text-right">Self</th><th className="!text-right">Manager</th><th className="!text-right">Final</th></tr></thead>
            <tbody>
              {kras.map((k) => (
                <tr key={k.id}>
                  <td><p className="font-semibold text-ink-900">{k.title}</p>{k.actual && <p className="text-[11px] text-ink-400">Actual: {k.actual}</p>}</td>
                  <td className="tnum text-right">{Number(k.weightage)}%</td>
                  <td className="tnum text-right">{k.self_score ?? '—'}</td>
                  <td className="tnum text-right">{k.manager_score ?? '—'}</td>
                  <td className="text-right">{done ? <b className="tnum">{k.final_score}</b> : <input className="input !w-20 !min-h-[36px] text-center tnum" inputMode="decimal" value={overrides[k.id]} onChange={(e) => setOverrides((o) => ({ ...o, [k.id]: e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value))) }))} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-600">Overall <b className="text-ink-900 tnum">{(done ? Number(review.overall_score) : projected)?.toFixed?.(1) ?? '—'}%</b> · {done ? review.rating : ratingFor(projected)}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>{done ? 'Close' : 'Cancel'}</Button>
            {!done && <Button icon={<CheckCircle2 className="w-4 h-4" />} loading={busy} onClick={() => void finalize()}>Finalize</Button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ promotions */

function Promotions({ designations }: { designations: Designation[] }) {
  const [settings, setSettings] = useState<PerformanceSettings | null>(null);
  const [list, setList] = useState<PromotionCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<PromotionCandidate | null>(null);
  const load = useCallback(async () => {
    try { const [s, c] = await Promise.all([perfApi.settings(), perfApi.candidates()]); setSettings(s); setList(c); }
    catch (e) { notify(e instanceof Error ? e.message : 'Unable to load promotions.', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!settings) return;
    setBusy(true);
    try { await perfApi.saveSettings(settings); notify('Promotion rule saved.', 'success'); await load(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Unable to save.', 'error'); }
    finally { setBusy(false); }
  }

  if (loading) return <Card className="p-5 space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}</Card>;
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr] items-start">
      <Card className="p-5 sm:p-6">
        <CardHeader title="Eligibility rule" subtitle="Who shows up as ready for a promotion conversation" />
        {settings && (
          <div className="space-y-3 mt-4">
            <label className="block"><span className="label">Average score at least</span><input className="input" inputMode="decimal" value={settings.promotion_min_score} onChange={(e) => setSettings({ ...settings, promotion_min_score: Number(e.target.value) })} /></label>
            <label className="block"><span className="label">Over the last … finalized reviews</span><input className="input" inputMode="numeric" value={settings.promotion_min_reviews} onChange={(e) => setSettings({ ...settings, promotion_min_reviews: Number(e.target.value) })} /></label>
            <label className="block"><span className="label">Months since joining or last promotion</span><input className="input" inputMode="numeric" value={settings.promotion_min_months} onChange={(e) => setSettings({ ...settings, promotion_min_months: Number(e.target.value) })} /></label>
            <Button className="w-full" loading={busy} onClick={() => void save()}>Save rule</Button>
          </div>
        )}
      </Card>
      <Card className="overflow-hidden">
        <div className="p-5 sm:p-6"><CardHeader title="Eligible now" subtitle="Eligibility is a prompt for a conversation, not an automatic promotion." /></div>
        {list.length ? (
          <ul className="divide-y divide-ink-100">
            {list.map((c) => (
              <li key={c.employee_id} className="px-5 sm:px-6 py-3.5 flex items-center gap-3">
                <Avatar name={c.name} size={36} />
                <div className="min-w-0 flex-1"><p className="font-bold text-ink-900 truncate">{c.name}</p><p className="text-[12px] text-ink-500">{c.designation ?? '—'} · {c.months_in_role} months in role · {c.reviews} review{c.reviews === 1 ? '' : 's'}</p></div>
                <Badge tone={scoreTone(Number(c.average_score))}>{Number(c.average_score).toFixed(1)}%</Badge>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setRecording(c)}><TrendingUp className="w-3.5 h-3.5" /> Record promotion</button>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={<Award className="w-6 h-6" />} title="Nobody meets the rule yet" text="People appear here once their finalized reviews meet the eligibility rule." />}
      </Card>
      {recording && <MilestoneDialog employeeId={recording.employee_id} mode="hr" initialKind="promotion" designations={designations} onClose={() => setRecording(null)} onSaved={async () => { setRecording(null); await load(); }} />}
    </div>
  );
}

/* ------------------------------------------------------------------ growth */

function Growth({ employees, designations }: { employees: Employee[]; designations: Designation[] }) {
  const [who, setWho] = useState(employees[0]?.id ?? '');
  const e = employees.find((x) => x.id === who);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <CardHeader title={e ? e.name : 'Growth history'} subtitle={e ? `${e.designation || '—'} · joined ${e.joinDate ? dateLabel(e.joinDate) : '—'}` : undefined} />
        <select className="input sm:!w-64" value={who} onChange={(ev) => setWho(ev.target.value)} aria-label="Employee">
          {employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      <div className="mt-5">{who ? <GrowthTimeline key={who} employeeId={who} canAdd="hr" designations={designations} /> : <EmptyState title="No active employees" />}</div>
    </Card>
  );
}
