import { useState } from 'react';
import { ShieldAlert, Trash2 } from 'lucide-react';
import { Button, Notice } from '../../ui';
import { Modal } from '../../ui/Modal';
import { notify } from '../../lib/toast';
import { invokeEmployeeAdmin } from '../../lib/v2';

/**
 * Admin-only: erase a deactivated person's personal data (an employee or a client contact).
 * The database checks the caller, that the person is deactivated, and the typed confirmation.
 */
export function ErasePersonDialog({ profileId, name, kind, onClose, onDone }: {
  profileId: string;
  name: string;
  kind: 'employee' | 'client';
  onClose: () => void;
  onDone?: () => void | Promise<void>;
}) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const erase = async () => {
    if (confirm !== 'ERASE' || busy) return;
    setBusy(true); setError('');
    try {
      const r = await invokeEmployeeAdmin({ action: 'erase_person', profileId, confirm }) as { incomplete?: string[] };
      if (r?.incomplete?.length) notify(`Personal data erased. Couldn’t finish: ${r.incomplete.join(', ')} — run it again.`, 'error');
      else notify('Personal data erased.', 'success');
      await onDone?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not erase this person’s data.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Erase personal data" onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4 text-[13.5px] text-ink-700">
        <p>
          This permanently removes <b className="text-ink-900">{name}</b>’s personal data. It can’t be undone.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3">
            <p className="font-semibold text-rose-800 flex items-center gap-1.5"><Trash2 className="w-4 h-4" />Removed</p>
            <ul className="mt-2 space-y-1 text-[12.5px] text-rose-900 list-disc pl-4">
              <li>Name, email, phone{kind === 'employee' ? ', photo, Login ID' : ''}</li>
              {kind === 'employee' && <li>HR documents and their files</li>}
              <li>Devices, browser details, push alerts</li>
              {kind === 'employee' && <li>Check-in locations</li>}
              <li>Their notifications; their name in others’ alerts and the audit log</li>
              <li>Sign-in (blocked for good)</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-ink-100 bg-ink-50 p-3">
            <p className="font-semibold text-ink-800 flex items-center gap-1.5"><ShieldAlert className="w-4 h-4" />Kept, without their name</p>
            <ul className="mt-2 space-y-1 text-[12.5px] text-ink-700 list-disc pl-4">
              {kind === 'employee'
                ? <><li>Attendance hours, leave and payroll figures</li><li>Salary history</li><li>Tasks and work records</li></>
                : <><li>Contracts and signed acceptances (legal record)</li><li>Invoices and payments</li><li>Project work</li></>}
              <li>Shown as “{kind === 'employee' ? 'Former employee' : 'Former contact'}”</li>
            </ul>
          </div>
        </div>
        <label className="block">
          <span className="label">Type <b>ERASE</b> to confirm</span>
          <input className="input font-mono" value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase())} autoComplete="off" />
        </label>
        {error && <Notice tone="rose">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={() => void erase()} disabled={confirm !== 'ERASE' || busy} icon={<Trash2 className="w-4 h-4" />}>
            {busy ? 'Erasing…' : 'Erase personal data'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
