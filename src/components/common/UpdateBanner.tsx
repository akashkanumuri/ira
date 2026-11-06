import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Open tabs keep running the old build after a deploy, so fixes don't show until a reload.
 * Checks the live index.html (on focus and every 5 minutes) and offers a one-click reload
 * when the app bundle has changed.
 */
const bundleOf = (html: string) => html.match(/\/assets\/index-[^"']+\.js/)?.[0] ?? null;

export function UpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const current = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
      ?.getAttribute('src')?.match(/\/assets\/index-[^"']+\.js/)?.[0];
    if (!current) return; // dev server: nothing to compare
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/', { cache: 'no-store' });
        if (!res.ok) return;
        const live = bundleOf(await res.text());
        if (live && live !== current) setReady(true);
      } catch { /* offline: try again later */ }
    };
    const timer = window.setInterval(check, 5 * 60 * 1000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  if (!ready) return null;
  return (
    <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-24 lg:bottom-6 z-[140] flex items-center gap-3 rounded-full bg-ink-950 text-white pl-4 pr-1.5 py-1.5 text-[13px] font-medium shadow-[0_18px_40px_-12px_rgb(20_17_43/0.5)]">
      <span>A new version of SIGMA 1 is ready.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-full bg-white text-ink-950 px-3 py-1.5 font-semibold hover:bg-ink-50"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Reload
      </button>
    </div>
  );
}
