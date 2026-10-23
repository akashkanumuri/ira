import React, { useState } from 'react';
import { Clock3 } from 'lucide-react';
import type { AuthUser } from '../../contexts/AuthContext';
import type { CorrectionRequest } from '../../types/attendance';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { dateLabel } from '../../lib/v2';
import { getKolkataDateString } from '../../lib/workingDays';
import { Button, Card, CardHeader, EmptyState, Notice, StatusBadge } from '../../ui';
import { Modal } from '../../ui/Modal';

const today = () => getKolkataDateString();

/** Employee form: ask an admin to correct check-in / check-out for a past day. */
export function CorrectionRequestDialog({ user, date, onClose, onSaved }: { user: AuthUser; date?: string | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [day, setDay] = useState(date ?? '');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get('reason') || '').trim();
    setError('');
    if (!day || day > today()) return setError('Choose today or a past date.');
    if (!checkIn || !checkOut) return setError('Enter both the check-in and check-out time.');
    if (checkOut <= checkIn) return setError('Check-out must be later than check-in.');
    if (!reason) return setError('Explain what happened so the reviewer can approve it.');
    setBusy(true);
    try {
      const { error: err } = await (supabase as any).from('regularization_requests').insert({
        employee_id: user.employeeDbId,
        date: day,
        requested_check_in: checkIn.slice(0, 5),
        requested_check_out: checkOut.slice(0, 5),
        reason,
        status: 'pending',
      });
      if (err) throw err;
      notify('Correction request sent for review.', 'success', 4200, 'correction');
      await onSaved();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to send the correction request.';
      setError(message);
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Request an attendance correction" onClose={onClose} closeDisabled={busy}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-500">Forgot to check in or out? Ask for the correct times. Your original record is kept; the approved times are used for reports and payroll.</p>
        {error && <Notice tone="rose">{error}</Notice>}
        <label className="block">
          <span className="label">Date</span>
          <input type="date" max={today()} value={day} onChange={(e) => setDay(e.target.value)} className="input" required />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Checked in at</span>
            <input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="input" required />
          </label>
          <label className="block">
            <span className="label">Checked out at</span>
            <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="input" required />
          </label>
        </div>
        <label className="block">
          <span className="label">What happened?</span>
          <textarea name="reason" className="input" placeholder="e.g. Phone battery died, checked out at 6:30 pm" required />
        </label>
        <p className="text-xs text-ink-400">Not allowed for Sundays, company holidays or days on approved leave.</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Send for review</Button>
        </div>
      </form>
    </Modal>
  );
}

export function MyCorrections({ corrections, onNew }: { corrections: CorrectionRequest[]; onNew: () => void }) {
  const sorted = [...corrections].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Card className="overflow-hidden">
      <div className="p-5 sm:p-6">
        <CardHeader title="Correction requests" subtitle="Fixes to check-in or check-out times you’ve asked for" action={<button type="button" className="btn-secondary btn-sm" onClick={onNew}>New request</button>} />
      </div>
      {sorted.length ? (
        <ul className="divide-y divide-ink-100">
          {sorted.map((c) => (
            <li key={c.id} className="px-5 sm:px-6 py-4 flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink-900">{dateLabel(c.date, { weekday: 'short' })}</p>
                <p className="text-xs text-ink-500 mt-0.5 tnum">
                  {c.originalCheckIn || c.originalCheckOut ? <>Recorded {c.originalCheckIn || '—'} → {c.originalCheckOut || '—'} · </> : 'No record · '}
                  asked for <b className="text-ink-800">{c.requestedCheckIn} → {c.requestedCheckOut}</b>
                </p>
                <p className="text-[13px] text-ink-600 mt-1 line-clamp-2">{c.reason}</p>
                {c.reviewNote && <p className="text-xs text-ink-500 mt-1"><b className="text-ink-700">Reviewer:</b> {c.reviewNote}</p>}
              </div>
              <StatusBadge status={c.status} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Clock3 className="w-6 h-6" />} title="No corrections requested" text="If a day’s times are wrong or missing, request a correction." className="!py-10" />
      )}
    </Card>
  );
}
