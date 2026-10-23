import React, { useMemo, useState } from 'react';
import { CalendarDays, CalendarPlus, Home, PartyPopper, Plus, Sparkles } from 'lucide-react';
import type { AuthUser } from '../../contexts/AuthContext';
import type { Holiday, LeaveLedger, LeaveRequest, WfhRequest } from '../../types/attendance';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { notifyLeaveSubmitted, notifyWfhSubmitted } from '../../lib/notifications';
import { dateLabel } from '../../lib/v2';
import { getKolkataDateString } from '../../lib/workingDays';
import { Badge, Button, Card, CardHeader, EmptyState, Notice, Page, PageHeader, PillTabs, Stat, StatusBadge, cx } from '../../ui';
import { Modal } from '../../ui/Modal';

const today = () => getKolkataDateString();
const tomorrow = () => {
  const d = new Date(`${today()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

function ChoiceGroup<T extends string>({ name, value, onChange, options }: { name: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; hint?: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup">
      {options.map((o) => (
        <label
          key={o.value}
          className={cx(
            'cursor-pointer rounded-2xl border px-4 py-3 transition-colors',
            value === o.value ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/10' : 'border-ink-200 bg-white hover:border-ink-300'
          )}
        >
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
          <span className="block text-sm font-bold text-ink-900">{o.label}</span>
          {o.hint && <span className="block text-xs text-ink-500 mt-0.5">{o.hint}</span>}
        </label>
      ))}
    </div>
  );
}

/* ======================================================================
   Leave
   ====================================================================== */

export function LeavePage({ user, leaveRequests, ledgers, onRefresh }: { user: AuthUser; leaveRequests: LeaveRequest[]; ledgers: LeaveLedger[]; onRefresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [leaveType, setLeaveType] = useState('casual');
  const [leaveDuration, setLeaveDuration] = useState<'full' | 'half'>('full');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const current = ledgers.find((l) => l.periodStart === `${today().slice(0, 7)}-01`);
  const mine = useMemo(() => [...leaveRequests].sort((a, b) => b.startDate.localeCompare(a.startDate)), [leaveRequests]);
  const counts = {
    all: mine.length,
    pending: mine.filter((r) => r.status === 'pending').length,
    approved: mine.filter((r) => r.status === 'approved').length,
    rejected: mine.filter((r) => r.status === 'rejected').length,
  };
  const rows = filter === 'all' ? mine : mine.filter((r) => r.status === filter);
  const upcoming = mine.find((r) => r.status === 'approved' && r.endDate >= today());

  const span = start && end && end >= start ? daysBetween(start, end) + 1 : 0;

  const reset = () => {
    setLeaveType('casual');
    setLeaveDuration('full');
    setStart('');
    setEnd('');
    setError('');
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError('');
    setBusy(true);
    try {
      const startDate = start;
      const endDate = leaveDuration === 'half' ? start : end;
      if (!startDate || !endDate) throw new Error('Choose the dates for your leave.');
      if (endDate < startDate) throw new Error('End date cannot be before start date.');
      if (startDate.slice(0, 7) !== endDate.slice(0, 7)) throw new Error('A leave request must stay within one calendar month.');
      if (leaveDuration === 'half' && startDate !== endDate) throw new Error('Half-day leave must use one date.');
      const reason = String(fd.get('reason') || '').trim();
      if (!reason) throw new Error('Add a short reason for your manager.');
      const { data: newLeave, error: err } = await (supabase as any)
        .from('leave_requests')
        .insert({ employee_id: user.employeeDbId, leave_type: leaveType, start_date: startDate, end_date: endDate, duration: leaveDuration, reason })
        .select('id')
        .maybeSingle();
      if (err) throw err;
      notify('Leave request submitted.', 'success', 4200, 'leave');
      void notifyLeaveSubmitted({
        employeeName: user.name,
        days: leaveDuration === 'half' ? 0.5 : 1,
        leaveType,
        startDate,
        endDate,
        leaveId: newLeave?.id ?? crypto.randomUUID(),
        employeeDbId: user.employeeDbId ?? "",
        actorUserId: user.id,
      });
      setOpen(false);
      reset();
      await onRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to submit leave request.';
      setError(message);
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Leave"
        subtitle="Paid leave builds up 1.5 days every month, and unused days carry forward."
        actions={<Button icon={<CalendarPlus className="w-4 h-4" />} onClick={() => { reset(); setOpen(true); }}>Apply for leave</Button>}
      />

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat index={0} icon={<CalendarDays className="w-5 h-5" />} tone="brand" label="Available" value={current ? Number(current.closingBalance) : '—'} format={(n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))} caption="Paid days you can take" />
        <Stat index={1} label="Carried forward" value={current ? Number(current.openingBalance) : '—'} format={(n) => n.toFixed(1)} caption="From previous months" />
        <Stat index={2} label="Added this month" value={current ? Number(current.accrual) : 1.5} format={(n) => n.toFixed(1)} caption="Monthly accrual" />
        <Stat index={3} label="Used this month" value={current ? Number(current.paidUsed) + Number(current.unpaidUsed) : 0} format={(n) => n.toFixed(1)} caption={current ? `${current.paidUsed} paid · ${current.unpaidUsed} unpaid` : '—'} />
      </div>

      {upcoming && (
        <Notice tone="sky" title={`Approved ${upcoming.leaveType} leave`}>
          {upcoming.startDate === upcoming.endDate ? dateLabel(upcoming.startDate, { weekday: 'long', day: 'numeric', month: 'long' }) : `${dateLabel(upcoming.startDate)} → ${dateLabel(upcoming.endDate)}`} · {upcoming.days} day{upcoming.days === 1 ? '' : 's'}
        </Notice>
      )}

      <Card className="overflow-hidden">
        <div className="p-5 sm:p-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <CardHeader title="Your requests" subtitle="Newest first" />
          <PillTabs
            size="sm"
            value={filter}
            onChange={setFilter}
            items={[
              { id: 'all', label: 'All', count: counts.all },
              { id: 'pending', label: 'Pending', count: counts.pending },
              { id: 'approved', label: 'Approved', count: counts.approved },
              { id: 'rejected', label: 'Rejected', count: counts.rejected },
            ]}
          />
        </div>
        {rows.length ? (
          <ul className="divide-y divide-ink-100">
            {rows.map((r) => (
              <li key={r.id} className="px-5 sm:px-6 py-4 flex items-start gap-4">
                <span className="w-12 h-12 shrink-0 rounded-2xl bg-ink-50 flex flex-col items-center justify-center leading-none">
                  <span className="text-[10px] font-bold uppercase text-ink-500">{new Date(`${r.startDate}T12:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })}</span>
                  <span className="font-display text-lg font-bold text-ink-950">{Number(r.startDate.slice(8))}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink-900">
                    <span className="capitalize">{r.leaveType}</span> leave · {r.days} day{r.days === 1 ? '' : 's'}
                    {r.duration === 'half' && <span className="font-medium text-ink-500"> (half day)</span>}
                  </p>
                  <p className="text-xs text-ink-500 mt-0.5 tnum">
                    {r.startDate === r.endDate ? dateLabel(r.startDate, { weekday: 'short', day: 'numeric', month: 'short' }) : `${dateLabel(r.startDate)} → ${dateLabel(r.endDate)}`}
                    {r.status === 'approved' && (r.unpaidDays ?? 0) > 0 ? ` · ${r.paidDays ?? 0} paid, ${r.unpaidDays} unpaid` : ''}
                  </p>
                  <p className="text-[13px] text-ink-600 mt-1.5 line-clamp-2">{r.reason}</p>
                  {r.reviewNote && <p className="text-xs text-ink-500 mt-1"><b className="text-ink-700">Reviewer:</b> {r.reviewNote}</p>}
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<CalendarDays className="w-6 h-6" />} title={filter === 'all' ? 'No leave requests yet' : `No ${filter} requests`} text={filter === 'all' ? 'Requests you send appear here with their status.' : undefined} />
        )}
      </Card>

      {open && (
        <Modal title="Apply for leave" onClose={() => setOpen(false)} closeDisabled={busy}>
          <form onSubmit={submit} className="space-y-5">
            {error && <Notice tone="rose">{error}</Notice>}
            <div>
              <span className="label">Leave type</span>
              <div className="flex flex-wrap gap-2">
                {[['casual', 'Casual'], ['sick', 'Sick'], ['earned', 'Earned'], ['unpaid', 'Unpaid']].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setLeaveType(v)} className={cx('rounded-full px-4 py-2 text-[13px] font-semibold border transition-colors', leaveType === v ? 'bg-ink-950 text-white border-ink-950' : 'bg-white text-ink-600 border-ink-200 hover:border-ink-300')}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label">Duration</span>
              <ChoiceGroup name="duration" value={leaveDuration} onChange={setLeaveDuration} options={[{ value: 'full', label: 'Full day(s)' }, { value: 'half', label: 'Half day', hint: 'One date only' }]} />
            </div>
            <div className={cx('grid gap-3', leaveDuration === 'full' ? 'sm:grid-cols-2' : '')}>
              <label className="block">
                <span className="label">{leaveDuration === 'half' ? 'Date' : 'From'}</span>
                <input type="date" min={today()} value={start} onChange={(e) => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} className="input" required />
              </label>
              {leaveDuration === 'full' && (
                <label className="block">
                  <span className="label">To</span>
                  <input type="date" min={start || today()} value={end} onChange={(e) => setEnd(e.target.value)} className="input" required />
                </label>
              )}
            </div>
            {leaveDuration === 'full' && span > 0 && (
              <p className="text-xs text-ink-500 -mt-2">
                {span} calendar day{span === 1 ? '' : 's'} — Sundays and company holidays in this range aren’t counted as leave.
              </p>
            )}
            <label className="block">
              <span className="label">Reason</span>
              <textarea name="reason" className="input" placeholder="A short note for your manager" required />
            </label>
            <p className="text-xs text-ink-400">A request must stay within one calendar month. If your paid balance runs out, extra days are counted as unpaid.</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" loading={busy}>Submit request</Button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}

/* ======================================================================
   Work from home
   ====================================================================== */

export function WfhPage({ user, wfhRequests, onRefresh }: { user: AuthUser; wfhRequests: WfhRequest[]; onRefresh: () => Promise<void> }) {
  const remote = user.workMode === 'remote';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wfhDuration, setWfhDuration] = useState<'full' | 'half'>('full');

  const mine = useMemo(() => [...wfhRequests].sort((a, b) => b.date.localeCompare(a.date)), [wfhRequests]);
  const pending = mine.filter((r) => r.status === 'pending').length;
  const upcomingApproved = mine.filter((r) => r.status === 'approved' && r.date >= today());
  const thisMonth = mine.filter((r) => r.status === 'approved' && r.date.startsWith(today().slice(0, 7))).length;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError('');
    setBusy(true);
    try {
      const date = String(fd.get('date') || '');
      if (!date || date <= today()) throw new Error('WFH requests must be for a future working day.');
      const reason = String(fd.get('reason') || '').trim();
      if (!reason) throw new Error('Add a short reason.');
      const note = String(fd.get('note') || '').trim() || null;
      const { data: newWfh, error: err } = await (supabase as any)
        .from('wfh_requests')
        .insert({ employee_id: user.employeeDbId, date, duration: wfhDuration, reason, note })
        .select('id')
        .maybeSingle();
      if (err) throw err;
      notify('WFH request submitted.', 'success', 4200, 'wfh');
      void notifyWfhSubmitted({
        employeeName: user.name,
        date,
        duration: wfhDuration,
        wfhId: newWfh?.id ?? crypto.randomUUID(),
        employeeDbId: user.employeeDbId ?? "",
        actorUserId: user.id,
      });
      setOpen(false);
      await onRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to submit WFH request.';
      setError(message);
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Work from home"
        subtitle={remote ? 'You’re a permanent remote employee.' : 'Ask for a day at home in advance. Approved days let you check in as WFH.'}
        actions={!remote ? <Button icon={<Plus className="w-4 h-4" />} onClick={() => { setError(''); setWfhDuration('full'); setOpen(true); }}>Request WFH</Button> : undefined}
      />

      {remote ? (
        <Card className="p-6 sm:p-8 flex items-start gap-4">
          <span className="w-12 h-12 rounded-full bg-mint-50 text-mint-700 inline-flex items-center justify-center shrink-0"><Home className="w-6 h-6" /></span>
          <div>
            <p className="font-display text-lg font-bold text-ink-950">No daily requests needed</p>
            <p className="text-sm text-ink-500 mt-1">Every check-in is recorded as work from home automatically.</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <Stat index={0} icon={<Home className="w-5 h-5" />} tone="mint" label="Upcoming WFH days" value={upcomingApproved.length} caption={upcomingApproved[0] ? `Next: ${dateLabel(upcomingApproved[0].date, { weekday: 'short', day: 'numeric', month: 'short' })}` : 'None approved ahead'} />
            <Stat index={1} label="Waiting for approval" value={pending} caption={pending ? 'Your manager will review these' : 'Nothing pending'} />
            <Stat index={2} label="Approved this month" value={thisMonth} caption="Days at home this month" />
          </div>

          <Card className="overflow-hidden">
            <div className="p-5 sm:p-6"><CardHeader title="Your requests" subtitle="Newest first" /></div>
            {mine.length ? (
              <ul className="divide-y divide-ink-100">
                {mine.map((r) => (
                  <li key={r.id} className="px-5 sm:px-6 py-4 flex items-start gap-4">
                    <span className="w-12 h-12 shrink-0 rounded-2xl bg-mint-50 flex flex-col items-center justify-center leading-none">
                      <span className="text-[10px] font-bold uppercase text-mint-700">{new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })}</span>
                      <span className="font-display text-lg font-bold text-ink-950">{Number(r.date.slice(8))}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink-900">
                        {dateLabel(r.date, { weekday: 'long' })} · {String(r.duration).startsWith('half') ? 'Half day' : 'Full day'}
                      </p>
                      <p className="text-[13px] text-ink-600 mt-1 line-clamp-2">{r.reason}</p>
                      {r.note && <p className="text-xs text-ink-500 mt-0.5">{r.note}</p>}
                      {r.reviewNote && <p className="text-xs text-ink-500 mt-1"><b className="text-ink-700">Reviewer:</b> {r.reviewNote}</p>}
                    </div>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Home className="w-6 h-6" />} title="No WFH requests yet" text="Requests you send appear here with their status." />
            )}
          </Card>
        </>
      )}

      {open && (
        <Modal title="Request work from home" onClose={() => setOpen(false)} closeDisabled={busy}>
          <form onSubmit={submit} className="space-y-5">
            {error && <Notice tone="rose">{error}</Notice>}
            <label className="block">
              <span className="label">Date</span>
              <input type="date" name="date" min={tomorrow()} className="input" required />
            </label>
            <div>
              <span className="label">Duration</span>
              <ChoiceGroup name="duration" value={wfhDuration} onChange={setWfhDuration} options={[{ value: 'full', label: 'Full day' }, { value: 'half', label: 'Half day' }]} />
            </div>
            <label className="block">
              <span className="label">Reason</span>
              <input name="reason" className="input" placeholder="Why you need to work from home" required />
            </label>
            <label className="block">
              <span className="label">Note <span className="font-normal text-ink-400">optional</span></span>
              <input name="note" className="input" placeholder="Anything your manager should know" />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" loading={busy}>Submit request</Button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}

/* ======================================================================
   Holidays
   ====================================================================== */

export function HolidayList({ holidays, renderActions }: { holidays: Holiday[]; renderActions?: (h: Holiday) => React.ReactNode }) {
  const sorted = useMemo(() => [...holidays].sort((a, b) => a.date.localeCompare(b.date)), [holidays]);
  const next = sorted.find((h) => h.date >= today());
  const byMonth = useMemo(() => {
    const m = new Map<string, Holiday[]>();
    for (const h of sorted) {
      const k = h.date.slice(0, 7);
      m.set(k, [...(m.get(k) ?? []), h]);
    }
    return [...m.entries()];
  }, [sorted]);

  if (!sorted.length) {
    return <Card><EmptyState icon={<Sparkles className="w-6 h-6" />} title="No holidays scheduled yet" text="Company and public holidays appear here once added." /></Card>;
  }

  const inDays = next ? daysBetween(today(), next.date) : 0;

  return (
    <div className="space-y-5">
      {next && (
        <Card className="p-6 sm:p-8 !bg-ink-950 !border-ink-950 text-white overflow-hidden relative">
          <div className="relative z-[1] flex flex-col sm:flex-row sm:items-end justify-between gap-6">
            <div>
              <p className="eyebrow !text-white/50">Next holiday</p>
              <p className="font-display text-3xl sm:text-4xl font-bold mt-2">{next.name}</p>
              <p className="text-sm text-white/60 mt-2">{dateLabel(next.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="stat-value text-6xl">{inDays}</span>
              <span className="text-sm text-white/60">{inDays === 0 ? 'today' : inDays === 1 ? 'day to go' : 'days to go'}</span>
            </div>
          </div>
          <PartyPopper aria-hidden className="absolute -right-6 -bottom-6 w-40 h-40 text-white/[0.04]" />
        </Card>
      )}
      {byMonth.map(([month, items], gi) => (
        <section key={month} className="space-y-3">
          <p className="eyebrow">{new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((h, i) => {
              const past = h.date < today();
              return (
                <Card key={h.id} index={gi + i} className={cx('p-4 flex items-center gap-4', past && 'opacity-60')}>
                  <span className={cx('w-14 h-14 shrink-0 rounded-2xl flex flex-col items-center justify-center leading-none', h.id === next?.id ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700')}>
                    <span className="text-[10px] font-bold uppercase opacity-80">{dateLabel(h.date, { weekday: 'short' })}</span>
                    <span className="font-display text-xl font-bold">{Number(h.date.slice(8))}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink-900 truncate">{h.name}</p>
                    <p className="text-xs text-ink-500 truncate">{h.description || (h.holidayType === 'public' ? 'Public holiday' : 'Paid company holiday')}</p>
                  </div>
                  {h.holidayType === 'public' && <Badge tone="sky">Public</Badge>}
                  {renderActions?.(h)}
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function HolidaysPage({ holidays }: { holidays: Holiday[] }) {
  return (
    <Page>
      <PageHeader title="Holidays" subtitle="Company and public holidays are paid days off." />
      <HolidayList holidays={holidays} />
    </Page>
  );
}
