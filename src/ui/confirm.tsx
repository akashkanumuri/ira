import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';

type ConfirmOptions = {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let push: ((p: Pending) => void) | null = null;

/** In-app replacement for window.confirm — resolves true when confirmed. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) {
      resolve(false);
      return;
    }
    push({ ...options, resolve });
  });
}

/** Mount once near the root of each portal. */
export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    push = (p) => setPending(p);
    return () => {
      push = null;
    };
  }, []);

  if (!pending) return null;
  const close = (ok: boolean) => {
    pending.resolve(ok);
    setPending(null);
  };

  return (
    <Modal title={pending.title} onClose={() => close(false)}>
      <div className="space-y-5">
        <div className="text-sm text-ink-600 leading-relaxed">{pending.message}</div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => close(false)}>
            {pending.cancelLabel ?? 'Cancel'}
          </button>
          <button type="button" className={pending.danger ? 'btn-danger' : 'btn-primary'} onClick={() => close(true)} autoFocus>
            {pending.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
