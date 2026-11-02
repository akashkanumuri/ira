import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Buddy, type BuddyMood } from './Buddy';

export type BuddyAction = 'wave' | 'celebrate' | 'backflip' | 'worried' | 'yawn' | 'knock' | 'dance' | 'spin' | 'juggle' | 'look' | 'land' | 'peek' | 'stretch' | 'moonwalk'
  | 'header' | 'kick' | 'throw' | 'ollie' | 'boo' | 'startle' | 'facepalm' | 'victory' | 'squash' | 'dizzy' | 'annoyed' | 'sip' | 'munch' | 'party' | 'dj' | 'bye' | 'explode';
export type BuddyPose = 'surf' | 'wipe' | 'hang' | 'dangle' | 'lean';
export type BuddyProp = 'board' | 'sponge' | 'mug' | 'sandwich' | 'hat' | 'backpack' | 'deck';
export interface Buddy3DApi {
  setMood: (m: BuddyMood) => void;
  play: (a: BuddyAction) => number;
  fly: (on: boolean, dir?: number) => void;
  setDir: (dir: number) => void;
  setFacing: (rad: number) => void;
  pose: (p: BuddyPose | null) => void;
  prop: (p: BuddyProp, on: boolean) => void;
  setZoom: (z: number) => void;
  /** true once the real 3D robot is running (false for the flat fallback) */
  is3D: () => boolean;
  isBusy: () => boolean;
  dispose: () => void;
}

function webglOk() {
  try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

/** The real 3D robot (same model as the sign-in page). Falls back to the flat robot when 3D isn't possible. */
export const Buddy3D = forwardRef<Buddy3DApi | null, { mood: BuddyMood; className?: string }>(function Buddy3D({ mood, className }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Buddy3DApi | null>(null);
  const [failed, setFailed] = useState(false);
  const moodRef = useRef(mood); moodRef.current = mood;

  useImperativeHandle(ref, () => ({
    setMood: (m) => api.current?.setMood(m),
    play: (a) => api.current?.play(a) ?? 0,
    fly: (on, dir) => api.current?.fly(on, dir),
    setDir: (d) => api.current?.setDir(d),
    setFacing: (r) => api.current?.setFacing(r),
    pose: (p) => api.current?.pose(p),
    prop: (p, on) => api.current?.prop(p, on),
    setZoom: (z) => api.current?.setZoom(z),
    is3D: () => Boolean(api.current),
    isBusy: () => api.current?.isBusy() ?? false,
    dispose: () => api.current?.dispose(),
  }), []);

  useEffect(() => {
    const el = host.current;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!el || !webglOk() || reduced) { setFailed(true); return undefined; }
    let cancelled = false;
    const url = '/login3d/buddy3d.js';
    import(/* @vite-ignore */ url)
      .then((mod: any) => {
        if (cancelled) return;
        api.current = mod.mount({ container: el, reduced: false });
        api.current?.setMood(moodRef.current);
      })
      .catch((e) => { console.warn('[buddy3d] using the flat robot', e); if (!cancelled) setFailed(true); });
    return () => { cancelled = true; api.current?.dispose(); api.current = null; };
  }, []);

  useEffect(() => { api.current?.setMood(mood); }, [mood]);

  if (failed) return <div className={className}><Buddy mood={mood} size={64} /></div>;
  return <div ref={host} className={className} aria-hidden="true" />;
});
