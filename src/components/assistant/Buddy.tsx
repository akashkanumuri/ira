import React, { useEffect, useRef, useState } from 'react';

/** Moods the mini robot can show. */
export type BuddyMood = 'idle' | 'happy' | 'wave' | 'worried' | 'sleepy' | 'think' | 'celebrate' | 'alert' | 'point';

/**
 * The SIGMA 1 mascot as a light 2D SVG (the 3D one stays on the sign-in page): faceted black helmet,
 * glass face screen with pink scan-line eyes, headphone ears with amber rings (fin on the left), charcoal hoodie.
 * Eyes follow the pointer; it blinks, bobs, and changes face with its mood.
 */
export function Buddy({ mood = 'idle', size = 72, follow = true, className }: { mood?: BuddyMood; size?: number; follow?: boolean; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!follow) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return undefined;
    let raf = 0;
    const on = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height * 0.42);
        const d = Math.max(1, Math.hypot(dx, dy));
        const k = Math.min(1, d / 300);
        setLook({ x: (dx / d) * 3.2 * k, y: (dy / d) * 2.2 * k });
      });
    };
    window.addEventListener('pointermove', on, { passive: true });
    return () => { window.removeEventListener('pointermove', on); if (raf) cancelAnimationFrame(raf); };
  }, [follow]);

  const eyesShift = mood === 'think' ? { x: 2.5, y: -2.5 } : mood === 'sleepy' ? { x: 0, y: 1.5 } : look;
  const PINK = '#ff7fb0';

  const eye = (cx: number, left: boolean) => {
    const x = cx + eyesShift.x;
    const y = 50 + eyesShift.y;
    switch (mood) {
      case 'happy':
      case 'celebrate':
      case 'wave':
        return <path d={`M${x - 6} ${y + 2} Q${x} ${y - 6} ${x + 6} ${y + 2}`} stroke={PINK} strokeWidth="3.4" strokeLinecap="round" fill="none" />;
      case 'sleepy':
        return <path d={`M${x - 6} ${y + 1} L${x + 6} ${y + 1}`} stroke={PINK} strokeWidth="3" strokeLinecap="round" />;
      case 'worried':
        return <rect x={x - 4} y={y - 5} width="8" height="10" rx="4" fill={PINK} transform={`rotate(${left ? -14 : 14} ${x} ${y})`} />;
      case 'alert':
        return <circle cx={x} cy={y} r="5.6" fill={PINK} />;
      default:
        return <rect className="buddy-eye" x={x - 4} y={y - 6} width="8" height="12" rx="4" fill={PINK} />;
    }
  };

  return (
    <svg ref={ref} viewBox="0 0 120 120" width={size} height={size} className={className} aria-hidden="true" data-mood={mood}>
      <defs>
        <linearGradient id="bd-helmet" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3b42" />
          <stop offset="0.55" stopColor="#17181c" />
          <stop offset="1" stopColor="#0d0d10" />
        </linearGradient>
        <linearGradient id="bd-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1c1d24" />
          <stop offset="1" stopColor="#050507" />
        </linearGradient>
        <linearGradient id="bd-hood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a4a52" />
          <stop offset="1" stopColor="#2f2f34" />
        </linearGradient>
        <filter id="bd-glow" filterUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <pattern id="bd-scan" width="4" height="2.2" patternUnits="userSpaceOnUse">
          <rect width="4" height="1" fill="#000" opacity="0.28" />
        </pattern>
      </defs>

      <g className="buddy-body">
        {/* hoodie shoulders + zip */}
        <path d="M18 120 C18 96 34 86 60 86 C86 86 102 96 102 120 Z" fill="url(#bd-hood)" />
        <path d="M60 90 L60 120" stroke="#c9ccd2" strokeWidth="1.6" />
        <circle cx="60" cy="96" r="1.8" fill="#e9e9ec" />
        {/* hood behind the head */}
        <path d="M24 66 C22 34 40 16 60 16 C80 16 98 34 96 66 C96 80 86 92 60 92 C34 92 24 80 24 66 Z" fill="#3c3c42" />
        {/* drawstrings */}
        <path d="M50 88 L48 102" stroke="#e9e9ec" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M70 88 L72 102" stroke="#e9e9ec" strokeWidth="1.6" strokeLinecap="round" />

        {/* headphone ears with amber rings; fin on the left ear */}
        <path d="M22 46 L16 36 L24 42 Z" fill="#18191d" />
        <circle cx="27" cy="54" r="9.5" fill="#2a2b30" />
        <circle className="buddy-ear" cx="27" cy="54" r="6" fill="none" stroke="#ff9a2e" strokeWidth="2" />
        <circle cx="93" cy="54" r="9.5" fill="#2a2b30" />
        <circle className="buddy-ear" cx="93" cy="54" r="6" fill="none" stroke="#ff9a2e" strokeWidth="2" />

        {/* faceted helmet */}
        <path d="M33 38 L44 26 L76 26 L87 38 L89 62 L80 76 L40 76 L31 62 Z" fill="url(#bd-helmet)" />
        <path d="M44 26 L76 26 L70 32 L50 32 Z" fill="#ffffff" opacity="0.12" />
        {/* glass face screen */}
        <rect x="38" y="36" width="44" height="30" rx="11" fill="url(#bd-glass)" />
        <rect x="38" y="36" width="44" height="30" rx="11" fill="url(#bd-scan)" />
        <path d="M42 40 Q50 37 58 38" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <g filter="url(#bd-glow)" className="buddy-eyes">
          {eye(50, true)}
          {eye(70, false)}
        </g>
        {mood === 'worried' && <path d="M86 30 q3 5 0 7 q-3 -2 0 -7 Z" fill="#9be7ff" className="buddy-drop" />}
        {mood === 'alert' && <text x="98" y="30" fontSize="20" fontWeight="800" fill="#f43f5e" fontFamily="system-ui">!</text>}
        {mood === 'think' && <g fill="#a78bfa"><circle cx="94" cy="28" r="2.2" /><circle cx="100" cy="20" r="3" /><circle cx="108" cy="11" r="3.8" /></g>}
        {mood === 'sleepy' && <text x="88" y="28" fontSize="13" fontWeight="800" fill="#a78bfa" fontFamily="system-ui" className="buddy-z">z</text>}
      </g>

      {/* hand: waves, points, or celebrates */}
      {(mood === 'wave' || mood === 'celebrate' || mood === 'point') && (
        <g className={mood === 'point' ? 'buddy-point' : 'buddy-wave'} style={{ transformOrigin: '96px 104px' }}>
          <path d="M96 104 L104 82" stroke="#3c3c42" strokeWidth="9" strokeLinecap="round" />
          <circle cx="105" cy="78" r="7" fill="#141418" />
          <rect x="102" y="66" width="3.4" height="9" rx="1.7" fill="#141418" />
          <rect x="106" y="67" width="3.4" height="8" rx="1.7" fill="#141418" />
        </g>
      )}
      {mood === 'celebrate' && (
        <g className="buddy-confetti">
          <rect x="14" y="14" width="5" height="5" rx="1" fill="#8b5cf6" />
          <rect x="102" y="40" width="5" height="5" rx="1" fill="#f472b6" />
          <rect x="8" y="44" width="4" height="4" rx="1" fill="#22d3ee" />
          <rect x="30" y="6" width="4" height="4" rx="1" fill="#fbbf24" />
          <rect x="88" y="8" width="4" height="4" rx="1" fill="#34d399" />
        </g>
      )}
    </svg>
  );
}
