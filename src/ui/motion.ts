import { useEffect, useRef, useState } from 'react';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Counts from 0 to `target` once, the first time a value arrives.
 * Later updates (realtime refreshes) jump straight to the new value so
 * numbers never re-animate while someone is reading them.
 */
export function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  const animated = useRef(false);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (animated.current || prefersReducedMotion()) {
      setValue(target);
      return;
    }
    animated.current = true;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else setValue(target);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

/** Time-of-day greeting in India Standard Time. */
export function greeting(date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(date)
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
