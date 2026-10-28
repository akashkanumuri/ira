import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { getKolkataDateString } from '../../lib/workingDays';
import { Button } from '../../ui';
import { Modal } from '../../ui/Modal';

const nowHHMM = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

/** Admin checks an employee in for today (e.g. their laptop couldn't confirm the office location). */
export function AdminCheckInModal({ employee, onClose, onDone }: { employee: { id: string; name: string }; onClose: () => void; onDone: () => Promise<void> | void }) {
  const [time, setTime] = useState(nowHHMM());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!/^\d{2}:\d{2}$/.test(time)) return setError('Pick the check-in time.');
    if (time > nowHHMM()) return setError('Check-in time can’t be later than now.');
    if (reason.trim().length < 3) return setError('Add a short reason, e.g. “Laptop location was off — confirmed at desk”.');
    setBusy(true);
    try {
      const at = `${getKolkataDateString()}T${time}:00+05:30`;
      const { error: e } = await (supabase as any).rpc('admin_check_in', { p_employee_id: employee.id, p_check_in_at: at, p_reason: reason.trim() });
      if (e) throw new Error(e.code === '23505' ? `${employee.name} is already checked in today.` : e.message);
      notify(`${employee.name} checked in at ${time}.`, 'success');
      await onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to check in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Check in ${employee.name}`} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <p className="text-sm text-ink-600 leading-relaxed">Use this when someone is at the office but their laptop couldn’t confirm the location. They’ll be notified, and the reason is kept in the activity log.</p>
        <label className="block max-w-[180px]">
          <span className="label">Check-in time (today)</span>
          <input type="time" className="input tnum" value={time} max={nowHHMM()} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Reason</span>
          <textarea className="input min-h-[84px]" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Laptop location was off — confirmed at desk" />
        </label>
        {error && <p className="text-[13px] font-semibold text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={() => void submit()}>Check in</Button>
        </div>
      </div>
    </Modal>
  );
}
