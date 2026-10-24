import React, { useEffect, useRef, useState } from 'react';

export type LoginScene = 'portal' | 'bot' | 'sigma';

/** Which sign-in look to show: `?login=portal|bot|aurora` (remembered on this device). */
export function useLoginScene(): LoginScene | 'aurora' {
  const [v] = useState<LoginScene | 'aurora'>(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('login');
      if (q === 'portal' || q === 'bot' || q === 'sigma' || q === 'aurora') { localStorage.setItem('ira-login-scene', q); return q; }
      const s = localStorage.getItem('ira-login-scene');
      if (s === 'portal' || s === 'bot' || s === 'sigma') return s;
    } catch { /* storage blocked */ }
    return 'aurora';
  });
  return v;
}

function webglOk() {
  try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

/**
 * Mounts a full-viewport 3D scene (loaded on demand from /login3d/*.js).
 * `frameRef` is the panel that becomes the 3D window; `formRef` is the sign-in card.
 * Calls `onFail` if WebGL or the scene can't load, so the caller can fall back.
 */
export function Login3D({ scene, frameRef, formRef, above = false, onFail }: {
  scene: LoginScene;
  frameRef: React.RefObject<HTMLElement | null>;
  formRef: React.RefObject<HTMLElement | null>;
  above?: boolean;
  onFail: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let api: { dispose: () => void } | null = null;
    let cancelled = false;
    const el = host.current, frameEl = frameRef.current, formEl = formRef.current;
    if (!el || !frameEl || !formEl || !webglOk()) { onFail(); return undefined; }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const url = `/login3d/${scene}.js`;
    import(/* @vite-ignore */ url)
      .then((mod: any) => { if (!cancelled) api = mod.mount({ container: el, frameEl, formEl, reduced }); })
      .catch((e) => { console.warn('[login3d] falling back', e); if (!cancelled) onFail(); });
    return () => { cancelled = true; api?.dispose(); };
  }, [scene]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={host} aria-hidden className={`fixed inset-0 ${above ? 'z-30 pointer-events-none' : 'z-0'}`} />;
}
