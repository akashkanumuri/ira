import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { confirmDialog } from '../../ui/confirm';

const db = supabase as any;

/**
 * "Your personal data": what SIGMA keeps and a way to ask for it to be erased.
 * The request goes to the admins; erasing needs an admin because work, pay and contract records
 * must be kept by law (they stay, without the person's name).
 */
export function PrivacyCard({ kind, className }: { kind: 'employee' | 'client'; className?: string }) {
  const [pending, setPending] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void db.from('data_erasure_requests').select('id').is('handled_at', null).limit(1)
      .then(({ data, error }: { data: unknown[] | null; error: unknown }) => { if (live) setPending(error ? false : Boolean(data?.length)); });
    return () => { live = false; };
  }, []);

  const ask = async () => {
    if (busy) return;
    const ok = await confirmDialog({
      title: 'Ask to erase your personal data?',
      message: kind === 'employee'
        ? 'The admin will be told. Once your account is closed, your name, contact details, photo, documents, devices and check-in locations are erased. Attendance and pay records are kept without your name, as the law requires.'
        : 'Your account manager will be told. Once your access is closed, your name, email, phone and devices are erased. Contracts, signatures and payments are kept without your name, as the law requires.',
      confirmLabel: 'Send request',
    });
    if (!ok) return;
    setBusy(true);
    const { data, error } = await db.rpc('request_my_data_erasure', { p_note: null });
    setBusy(false);
    if (error) { notify(error.message || 'Could not send the request.', 'error'); return; }
    setPending(true);
    notify(String(data ?? 'Request sent.'), 'success');
  };

  return (
    <section className={className ?? 'card p-5 sm:p-6'}>
      <div className="flex items-start gap-3">
        <span className="grid place-items-center w-9 h-9 rounded-xl bg-ink-50 text-ink-600 shrink-0"><ShieldCheck className="w-4.5 h-4.5" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display font-bold text-[15px] text-ink-900">Your personal data</h3>
          <p className="mt-1 text-[13px] text-ink-600">
            SIGMA keeps your {kind === 'employee' ? 'name, work contact details, documents, attendance and pay records' : 'name, email, phone, contract signatures and payment records'}.
            It is never sold or shared with advertisers. You can ask for your personal data to be erased.
          </p>
          <div className="mt-3">
            {pending
              ? <p className="text-[13px] font-semibold text-amber-700">Erasure requested — the admin will handle it.</p>
              : <button type="button" className="btn-secondary btn-sm" disabled={busy || pending === null} onClick={() => void ask()}>{busy ? 'Sending…' : 'Ask to erase my data'}</button>}
          </div>
        </div>
      </div>
    </section>
  );
}
