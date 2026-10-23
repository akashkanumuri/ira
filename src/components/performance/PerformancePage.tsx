import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Hourglass, Target, Users } from 'lucide-react';
import type { AuthUser } from '../../contexts/AuthContext';
import type { Employee } from '../../types/attendance';
import { CYCLE_STATUS, PERIOD_LABEL, REVIEW_STATUS, perfApi, ratingFor, scoreTone, weighted, type Cycle, type Kra, type Review } from '../../lib/performance';
import { dateLabel } from '../../lib/v2';
import { notify } from '../../lib/toast';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Notice, Page, PageHeader, PillTabs, Skeleton, cx } from '../../ui';
import { Gauge } from '../../ui/charts';
import { Modal } from '../../ui/Modal';
import { GrowthTimeline } from './GrowthTimeline';
import { ReviewScorecard, TeamReviewMetrics } from './ReviewMetrics';
import { PunctualityCard, TeamPunctuality } from './Punctuality';

type Data = { cycles: Cycle[]; reviews: Review[]; kras: Kra[] };

export function PerformancePage({ user, employees = [] }: { user: AuthUser; employees?: Employee[] }) {
  const me = user.employeeDbId ?? '';
  const reports = useMemo(() => employees.filter((e) => e.managerId === me && e.status === 'active'), [employees, me]);
  const [tab, setTab] = useState<'mine' | 'punctuality' | 'team' | 'growth'>('mine');
  const [data, setData] = useState<Data>({ cycles: [], reviews: [], kras: [] });
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [error, setError] = useState('');
  const [openReview, setOpenReview] = useState<Review | null>(null);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      if (!(await perfApi.available())) { setState('unavailable'); return; }
      const ids = [me, ...reports.map((r) => r.id)];
      const [cycles, reviews, kras] = await Promise.all([perfApi.cycles(), perfApi.reviewsFor(ids), perfApi.krasFor(ids)]);
      setData({ cycles, reviews, kras });
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load performance reviews.');
      setState('error');
    }
  }, [me, reports]);
  useEffect(() => { void load(); }, [load]);

  const cycleOf = (id: string) => data.cycles.find((c) => c.id === id);
  const krasOf = (r: Review) => data.kras.filter((k) => k.cycle_id === r.cycle_id && k.employee_id === r.employee_id);
  const mine = data.reviews.filter((r) => r.employee_id === me).sort((a, b) => String(cycleOf(b.cycle_id)?.end_date).localeCompare(String(cycleOf(a.cycle_id)?.end_date)));
  const active = mine.filter((r) => r.status !== 'finalized');
  const past = mine.filter((r) => r.status === 'finalized');
  const team = data.reviews.filter((r) => r.employee_id !== me);
  const teamWaiting = team.filter((r) => r.status === 'manager_review');
  const latest = past[0];

  const tabs = [{ id: 'mine' as const, label: 'My reviews', count: active.length || undefined }, { id: 'punctuality' as const, label: 'Punctuality' }, ...(reports.length ? [{ id: 'team' as const, label: 'My team', count: teamWaiting.length || undefined }] : []), { id: 'growth' as const, label: 'Growth' }];

  return (
    <Page>
      <PageHeader title="Performance" subtitle="Your KRAs, reviews and career history." />
      {state === 'unavailable' && <Notice tone="sky" title="Performance reviews are almost ready">KRAs and reviews switch on once the performance database update is applied. Your growth history will appear here too.</Notice>}
      {state === 'error' && <Notice tone="rose">{error}</Notice>}
      <PillTabs value={tab} onChange={setTab} items={tabs} />

      {tab === 'mine' && <ReviewScorecard title="My work quality" />}
      {tab === 'punctuality' && <PunctualityCard title="My punctuality" />}
      {tab === 'team' && reports.length > 0 && <TeamReviewMetrics />}
      {tab === 'team' && reports.length > 0 && <TeamPunctuality />}

      {state === 'loading' && <Card className="p-5 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}</Card>}

      {state === 'ready' && tab === 'mine' && (
        <div className="space-y-4">
          {latest && (
            <Card className="p-5 sm:p-6 flex flex-col sm:flex-row items-center gap-6">
              <Gauge value={Number(latest.overall_score ?? 0)} size={190} tone={scoreTone(latest.overall_score) === 'rose' ? 'rose' : scoreTone(latest.overall_score) === 'amber' ? 'amber' : 'mint'}
                label={<><span className="block stat-value text-[26px] text-ink-900">{Number(latest.overall_score ?? 0).toFixed(1)}%</span><span className="text-[11px] text-ink-500">{latest.rating ?? ratingFor(latest.overall_score)}</span></>} />
              <div className="flex-1 min-w-0">
                <p className="eyebrow">Latest review · {cycleOf(latest.cycle_id)?.name}</p>
                {latest.manager_summary && <p className="text-[14px] text-ink-700 mt-2 leading-relaxed">“{latest.manager_summary}”</p>}
                <div className="grid sm:grid-cols-2 gap-3 mt-3 text-[13px]">
                  {latest.strengths && <div className="inset-tile p-3"><p className="text-[11px] font-bold text-mint-700 uppercase tracking-wide">Strengths</p><p className="text-ink-700 mt-1">{latest.strengths}</p></div>}
                  {latest.improvements && <div className="inset-tile p-3"><p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">To work on</p><p className="text-ink-700 mt-1">{latest.improvements}</p></div>}
                </div>
                <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => setOpenReview(latest)}>See KRA scores <ChevronRight className="w-3.5 h-3.5" /></button>
              </div>
            </Card>
          )}

          {active.map((r) => <SelfReviewCard key={r.id} review={r} cycle={cycleOf(r.cycle_id)} kras={krasOf(r)} onChanged={load} />)}

          {!active.length && !past.length && <Card><EmptyState icon={<Target className="w-6 h-6" />} title="No reviews yet" text="When HR opens a review cycle, your KRAs appear here for you to rate." /></Card>}

          {past.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-5 sm:p-6"><CardHeader title="Past reviews" /></div>
              <ul className="divide-y divide-ink-100">
                {past.map((r) => {
                  const c = cycleOf(r.cycle_id);
                  return (
                    <li key={r.id}>
                      <button type="button" onClick={() => setOpenReview(r)} className="w-full text-left px-5 sm:px-6 py-3.5 flex items-center gap-3 hover:bg-ink-50/70">
                        <div className="min-w-0 flex-1"><p className="text-sm font-bold text-ink-900">{c?.name}</p><p className="text-[12px] text-ink-500">{c ? `${PERIOD_LABEL[c.period_type]} · ${dateLabel(c.start_date)} – ${dateLabel(c.end_date)}` : ''}</p></div>
                        <Badge tone={scoreTone(r.overall_score)}>{Number(r.overall_score ?? 0).toFixed(1)}% · {r.rating}</Badge>
                        <ChevronRight className="w-4 h-4 text-ink-300" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      )}

      {state === 'ready' && tab === 'team' && (
        <div className="space-y-3">
          {team.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {team.map((r, i) => {
                const e = employees.find((x) => x.id === r.employee_id);
                const c = cycleOf(r.cycle_id);
                return (
                  <Card key={r.id} index={i} className="p-5">
                    <div className="flex items-center gap-3">
                      <Avatar name={e?.name} src={e?.avatar} size={42} />
                      <div className="min-w-0 flex-1"><p className="font-bold text-ink-900 truncate">{e?.name ?? 'Team member'}</p><p className="text-[12px] text-ink-500">{c?.name}</p></div>
                      <Badge tone={REVIEW_STATUS[r.status].tone} dot>{REVIEW_STATUS[r.status].label}</Badge>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <p className="text-[13px] text-ink-600">
                        {r.status === 'self_review' ? 'Waiting for their self-assessment.' : r.status === 'manager_review' ? (r.manager_submitted_at ? 'Sent to HR to finalize.' : 'Ready for your scores.') : `${Number(r.overall_score ?? 0).toFixed(1)}% · ${r.rating}`}
                      </p>
                      {r.status === 'manager_review' && !r.manager_submitted_at
                        ? <Button size="sm" onClick={() => setOpenReview(r)}>Review</Button>
                        : <button type="button" className="btn-ghost btn-sm" onClick={() => setOpenReview(r)}>View</button>}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : <Card><EmptyState icon={<Users className="w-6 h-6" />} title="No team reviews yet" text="Reviews for people who report to you appear here once a cycle opens." /></Card>}
        </div>
      )}

      {tab === 'growth' && me && (
        <Card className="p-5 sm:p-6"><CardHeader title="Career history" subtitle="Promotions, recognition, training and salary changes" /><div className="mt-5"><GrowthTimeline employeeId={me} /></div></Card>
      )}

      {openReview && (
        <ReviewDialog
          review={openReview} cycle={cycleOf(openReview.cycle_id)} kras={krasOf(openReview)}
          employeeName={openReview.employee_id === me ? 'Your review' : employees.find((e) => e.id === openReview.employee_id)?.name ?? 'Review'}
          asManager={openReview.employee_id !== me}
          onClose={() => setOpenReview(null)} onChanged={async () => { setOpenReview(null); await load(); }}
        />
      )}
    </Page>
  );
}

function ScoreInput({ value, onChange, disabled }: { value: number | ''; onChange: (v: number | '') => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={0} max={100} step={5} value={value === '' ? 0 : value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-[var(--brand)]" aria-label="Score" />
      <input type="number" min={0} max={100} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value))))} className="input !w-20 !min-h-[38px] text-center tnum" aria-label="Score out of 100" />
    </div>
  );
}

function SelfReviewCard({ review, cycle, kras, onChanged }: { review: Review; cycle?: Cycle; kras: Kra[]; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, { actual: string; score: number | ''; comment: string }>>(() =>
    Object.fromEntries(kras.map((k) => [k.id, { actual: k.actual ?? '', score: k.self_score ?? '', comment: k.self_comment ?? '' }])));
  const [summary, setSummary] = useState(review.self_summary ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const editable = review.status === 'self_review';
  const projected = weighted(kras, (k) => (draft[k.id]?.score === '' ? null : Number(draft[k.id]?.score)));

  async function saveOne(k: Kra) {
    const d = draft[k.id];
    if (d.score === '') { notify('Give this KRA a score.', 'error'); return; }
    setBusy(k.id);
    try { await perfApi.selfAssess(k.id, d.actual, Number(d.score), d.comment); notify('Saved.', 'success'); await onChanged(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Unable to save.', 'error'); }
    finally { setBusy(null); }
  }
  async function submit() {
    setBusy('submit');
    try {
      for (const k of kras) {
        const d = draft[k.id];
        if (d.score === '') throw new Error(`Score “${k.title}” first.`);
        if (Number(d.score) !== Number(k.self_score) || d.actual !== (k.actual ?? '') || d.comment !== (k.self_comment ?? '')) await perfApi.selfAssess(k.id, d.actual, Number(d.score), d.comment);
      }
      await perfApi.submitSelf(review.id, summary);
      notify('Self-review sent to your manager.', 'success');
      await onChanged();
    } catch (e) { notify(e instanceof Error ? e.message : 'Unable to submit.', 'error'); }
    finally { setBusy(null); }
  }

  return (
    <Card className="overflow-hidden">
      <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-ink-100">
        <div>
          <p className="font-display font-bold text-lg text-ink-900">{cycle?.name}</p>
          <p className="text-[13px] text-ink-500">{cycle ? `${PERIOD_LABEL[cycle.period_type]} · ${dateLabel(cycle.start_date)} – ${dateLabel(cycle.end_date)}` : ''}{cycle?.self_review_due ? ` · self-review due ${dateLabel(cycle.self_review_due)}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {projected != null && <Badge tone={scoreTone(projected)}>Your score {projected.toFixed(1)}%</Badge>}
          <Badge tone={REVIEW_STATUS[review.status].tone} dot>{REVIEW_STATUS[review.status].label}</Badge>
        </div>
      </div>
      {!editable && <div className="px-5 sm:px-6 pt-4"><Notice tone="brand" title="Sent to your manager">You can’t change your scores now. You’ll be notified when the review is finalized.</Notice></div>}
      <ul className="divide-y divide-ink-100">
        {kras.map((k) => {
          const d = draft[k.id];
          return (
            <li key={k.id} className="px-5 sm:px-6 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-sm font-bold text-ink-900">{k.title}</p>
                  <p className="text-[12px] text-ink-500 mt-0.5">{[k.target && `Target: ${k.target}`, k.measurement && `Measured by ${k.measurement}`].filter(Boolean).join(' · ')}</p>
                  {k.description && <p className="text-[13px] text-ink-600 mt-1">{k.description}</p>}
                </div>
                <Badge tone="ink">{Number(k.weightage)}%</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_260px] mt-3">
                <div className="grid gap-2">
                  <input className="input" placeholder="What you achieved (actual)" value={d?.actual ?? ''} disabled={!editable} onChange={(e) => setDraft((p) => ({ ...p, [k.id]: { ...p[k.id], actual: e.target.value } }))} maxLength={500} />
                  <input className="input" placeholder="Comment (optional)" value={d?.comment ?? ''} disabled={!editable} onChange={(e) => setDraft((p) => ({ ...p, [k.id]: { ...p[k.id], comment: e.target.value } }))} maxLength={2000} />
                </div>
                <div>
                  <span className="label">Your score</span>
                  <ScoreInput value={d?.score ?? ''} disabled={!editable} onChange={(v) => setDraft((p) => ({ ...p, [k.id]: { ...p[k.id], score: v } }))} />
                  {editable && <button type="button" className="btn-ghost btn-sm mt-1" disabled={busy === k.id} onClick={() => void saveOne(k)}>{busy === k.id ? 'Saving…' : k.self_score != null ? 'Saved · update' : 'Save'}</button>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {editable && (
        <div className="p-5 sm:p-6 border-t border-ink-100 space-y-3">
          <label className="block"><span className="label">Overall comment (optional)</span><textarea className="input" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} placeholder="Highlights, blockers, what you’d like to grow in" /></label>
          <div className="flex justify-end"><Button loading={busy === 'submit'} onClick={() => void submit()}>Submit self-review</Button></div>
        </div>
      )}
    </Card>
  );
}

function ReviewDialog({ review, cycle, kras, employeeName, asManager, onClose, onChanged }: {
  review: Review; cycle?: Cycle; kras: Kra[]; employeeName: string; asManager: boolean; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const canScore = asManager && review.status === 'manager_review' && !review.manager_submitted_at;
  const [scores, setScores] = useState<Record<string, { score: number | ''; comment: string }>>(() =>
    Object.fromEntries(kras.map((k) => [k.id, { score: k.manager_score ?? '', comment: k.manager_comment ?? '' }])));
  const [summary, setSummary] = useState(review.manager_summary ?? '');
  const [strengths, setStrengths] = useState(review.strengths ?? '');
  const [improvements, setImprovements] = useState(review.improvements ?? '');
  const [busy, setBusy] = useState(false);
  const projected = weighted(kras, (k) => (canScore ? (scores[k.id]?.score === '' ? null : Number(scores[k.id]?.score)) : k.final_score ?? k.manager_score ?? null));

  async function submit() {
    setBusy(true);
    try {
      for (const k of kras) {
        const s = scores[k.id];
        if (s.score === '') throw new Error(`Score “${k.title}” first.`);
        if (Number(s.score) !== Number(k.manager_score) || s.comment !== (k.manager_comment ?? '')) await perfApi.managerAssess(k.id, Number(s.score), s.comment);
      }
      if (!summary.trim()) throw new Error('Write a short summary.');
      await perfApi.submitManager(review.id, summary, strengths, improvements);
      notify('Review sent to HR to finalize.', 'success');
      await onChanged();
    } catch (e) { notify(e instanceof Error ? e.message : 'Unable to submit.', 'error'); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`${employeeName} · ${cycle?.name ?? ''}`} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={REVIEW_STATUS[review.status].tone} dot>{REVIEW_STATUS[review.status].label}</Badge>
          {cycle && <Badge tone={CYCLE_STATUS[cycle.status].tone}>{PERIOD_LABEL[cycle.period_type]}</Badge>}
          {projected != null && <Badge tone={scoreTone(projected)}>{review.status === 'finalized' ? 'Final' : 'Weighted'} {projected.toFixed(1)}%</Badge>}
        </div>
        {review.self_summary && <div className="inset-tile p-3 text-[13px] text-ink-700"><span className="text-[11px] font-bold text-ink-500 uppercase tracking-wide block mb-1">Their comment</span>{review.self_summary}</div>}
        <ul className="space-y-3">
          {kras.map((k) => (
            <li key={k.id} className="rounded-2xl border border-ink-100 p-4">
              <div className="flex items-start justify-between gap-2"><p className="text-sm font-bold text-ink-900">{k.title}</p><Badge tone="ink">{Number(k.weightage)}%</Badge></div>
              <p className="text-[12px] text-ink-500 mt-0.5">{[k.target && `Target: ${k.target}`, k.actual && `Actual: ${k.actual}`].filter(Boolean).join(' · ')}</p>
              <div className="flex flex-wrap gap-2 mt-2 text-[12px]">
                <Badge tone="ink">Self {k.self_score ?? '—'}</Badge>
                {!canScore && <Badge tone="brand">Manager {k.manager_score ?? '—'}</Badge>}
                {k.final_score != null && <Badge tone={scoreTone(k.final_score)}>Final {k.final_score}</Badge>}
              </div>
              {k.self_comment && <p className="text-[12px] text-ink-600 mt-2">“{k.self_comment}”</p>}
              {!canScore && k.manager_comment && <p className="text-[12px] text-ink-600 mt-1"><b>Manager:</b> {k.manager_comment}</p>}
              {canScore && (
                <div className="mt-3 grid gap-2 sm:grid-cols-[240px_1fr]">
                  <ScoreInput value={scores[k.id]?.score ?? ''} onChange={(v) => setScores((p) => ({ ...p, [k.id]: { ...p[k.id], score: v } }))} />
                  <input className="input" placeholder="Comment (optional)" value={scores[k.id]?.comment ?? ''} onChange={(e) => setScores((p) => ({ ...p, [k.id]: { ...p[k.id], comment: e.target.value } }))} />
                </div>
              )}
            </li>
          ))}
        </ul>
        {canScore ? (
          <div className="space-y-3">
            <label className="block"><span className="label">Summary</span><textarea className="input" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} /></label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block"><span className="label">Strengths</span><textarea className="input" value={strengths} onChange={(e) => setStrengths(e.target.value)} maxLength={2000} /></label>
              <label className="block"><span className="label">To work on</span><textarea className="input" value={improvements} onChange={(e) => setImprovements(e.target.value)} maxLength={2000} /></label>
            </div>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={() => void submit()}>Send to HR</Button></div>
          </div>
        ) : (
          <>
            {review.manager_summary && <p className="text-[13px] text-ink-700"><b>Manager summary:</b> {review.manager_summary}</p>}
            {review.status === 'self_review' && asManager && <p className={cx('text-[13px] text-ink-500 flex items-center gap-2')}><Hourglass className="w-4 h-4" /> Waiting for their self-assessment.</p>}
            {review.status === 'finalized' && <p className="text-[13px] text-mint-700 font-semibold flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Finalized {review.finalized_at ? dateLabel(review.finalized_at.slice(0, 10)) : ''}</p>}
            <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
          </>
        )}
      </div>
    </Modal>
  );
}
