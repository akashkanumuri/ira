import React, { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import type { ToastPayload, ToastType } from '../../lib/toast';

interface ToastItem extends ToastPayload {
  id: string;
}

export const ToastHost: React.FC = () => {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastPayload>).detail;
      if (!detail?.message) return;
      const id = detail.id ?? crypto.randomUUID();
      setItems((current) => [...current, { ...detail, id }].slice(-4));
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== id));
      }, Math.max(1600, detail.duration ?? 4200));
    };
    window.addEventListener('ira:toast', onToast as EventListener);
    return () => window.removeEventListener('ira:toast', onToast as EventListener);
  }, []);

  return (
    <div className="fixed right-4 top-4 sm:right-6 sm:top-6 z-[100] w-[min(92vw,390px)] space-y-2.5 pointer-events-none" aria-live="polite" aria-atomic="true">
      {items.map((item) => {
        const styles: Record<ToastType, string> = {
          success: 'border-emerald-200/80 bg-emerald-50/90 text-emerald-950',
          error: 'border-rose-200/80 bg-rose-50/90 text-rose-950',
          info: 'border-slate-200/80 bg-white/90 text-slate-950',
        };
        const Icon = item.type === 'success' ? CheckCircle2 : item.type === 'error' ? CircleAlert : Info;
        return (
          <div key={item.id} className={`ira-toast pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-[0_20px_60px_rgba(15,23,42,.16)] backdrop-blur-xl ${styles[item.type]}`}>
            <span className="mt-0.5 shrink-0"><Icon className="w-4 h-4" /></span>
            <p className="text-sm leading-5 font-medium flex-1">{item.message}</p>
            <button type="button" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} className="shrink-0 rounded-full p-1 text-slate-500 hover:text-slate-900 hover:bg-black/5 transition" aria-label="Dismiss notification">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
