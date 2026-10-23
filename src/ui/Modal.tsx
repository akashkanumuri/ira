import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** Accessible dialog: focus trap, Escape to close, body scroll lock, mobile-safe viewport. */
export function Modal({ title, onClose, children, wide = false, closeDisabled = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; closeDisabled?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeStateRef = useRef({ closeDisabled, onClose });
  closeStateRef.current = { closeDisabled, onClose };
  const requestClose = useCallback(() => { const state = closeStateRef.current; if (!state.closeDisabled) state.onClose() }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const previousVisualVh = root.style.getPropertyValue('--ira-visual-vh');

    const updateVisualViewport = () => {
      const height = Math.max(320, Math.round(viewport?.height ?? window.innerHeight));
      root.style.setProperty('--ira-visual-vh', `${height}px`);
    };

    document.body.style.overflow = 'hidden';
    updateVisualViewport();
    viewport?.addEventListener('resize', updateVisualViewport);
    viewport?.addEventListener('scroll', updateVisualViewport);

    // Do not focus the first form control on mobile. That can summon the keyboard
    // as soon as the dialog opens and can cause the browser to pan/blur the form.
    requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }));

    const getFocusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? []);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { requestClose(); return }
      if (event.key !== 'Tab') return;
      const items = getFocusable();
      if (!items.length) { event.preventDefault(); dialogRef.current?.focus(); return }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      viewport?.removeEventListener('resize', updateVisualViewport);
      viewport?.removeEventListener('scroll', updateVisualViewport);
      if (previousVisualVh) root.style.setProperty('--ira-visual-vh', previousVisualVh);
      else root.style.removeProperty('--ira-visual-vh');
      window.setTimeout(() => previousFocus?.focus({ preventScroll: true }), 0);
      window.removeEventListener('keydown', onKey);
    };
  }, [requestClose]);

  return createPortal(
    <div className="ira-modal-overlay p-3 sm:p-6 overscroll-contain" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) requestClose() }}>
      <div ref={dialogRef} tabIndex={-1} className={`ira-modal w-full ${wide ? 'max-w-5xl' : 'max-w-lg'} max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] my-auto flex flex-col`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="shrink-0 px-5 sm:px-7 pt-5 sm:pt-6 pb-3 flex items-center justify-between gap-3 bg-white"><h3 className="font-display text-xl font-bold text-ink-950 truncate">{title}</h3><button type="button" disabled={closeDisabled} onClick={requestClose} className="icon-btn icon-btn-surface shrink-0 disabled:opacity-50" aria-label="Close"><X className="w-5 h-5" /></button></div>
        <div className="ira-modal-body min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-7 pb-6 pt-2">{children}</div>
      </div>
    </div>,
    document.body
  );
}
