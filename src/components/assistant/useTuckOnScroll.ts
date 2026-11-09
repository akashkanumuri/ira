import { useEffect, useRef, type RefObject } from 'react';

/**
 * While the page scrolls, the resting helper shrinks into its corner and fades so it doesn't sit on the
 * content passing under it; it comes back shortly after scrolling stops. It never tucks while it is
 * talking, flying somewhere or performing (`canTuck` returns false then).
 */
export function useTuckOnScroll(fab: RefObject<HTMLElement | null>, canTuck: () => boolean) {
  const can = useRef(canTuck);
  can.current = canTuck;
  useEffect(() => {
    let timer = 0;
    const untuck = () => fab.current?.classList.remove('buddy-tucked');
    const onScroll = (e: Event) => {
      const f = fab.current;
      if (!f) return;
      // scrolling inside the helper's own panel doesn't count
      if (e.target instanceof Node && f.contains(e.target)) return;
      if (!can.current()) { untuck(); return; }
      f.classList.add('buddy-tucked');
      window.clearTimeout(timer);
      timer = window.setTimeout(untuck, 900);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      window.clearTimeout(timer);
      untuck();
    };
  }, [fab]);
}
