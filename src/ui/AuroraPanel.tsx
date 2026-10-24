import React, { useEffect, useRef, useState } from 'react';

/**
 * Login hero: drifting aurora light, a huge live IST clock with rolling digits,
 * and a looping "workday" timeline (check-in → task → meeting → break → check-out).
 * Purely decorative; respects prefers-reduced-motion.
 */

const STEPS = [
  { key: 'in', label: 'Check in', time: '09:02', note: 'Day started', color: '#34d399' },
  { key: 'task', label: 'Task', time: '09:14', note: 'Brand guidelines · timer running', color: '#a78bfa' },
  { key: 'meet', label: 'Meeting', time: '11:30', note: 'Team brief · 25 min', color: '#38bdf8' },
  { key: 'break', label: 'Break', time: '13:05', note: 'Lunch · 42 of 60 min', color: '#fbbf24' },
  { key: 'out', label: 'Check out', time: '18:01', note: 'Effective 7h 48m · 97%', color: '#f472b6' },
];
const STEP_MS = 2600;

function istParts() {
  const s = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  return s.split(':'); // HH, MM, SS
}

function Digit({ value }: { value: string }) {
  const n = Number(value);
  return (
    <span className="aur-digit" aria-hidden>
      <span className="aur-digit-strip" style={{ transform: `translateY(${-n * 10}%)` }}>
        {Array.from({ length: 10 }, (_, i) => <span key={i}>{i}</span>)}
      </span>
    </span>
  );
}

export function AuroraPanel({ compact = false }: { compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(istParts);
  const [step, setStep] = useState(0);
  const [reduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const id = window.setInterval(() => setTime(istParts()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (reduced) return undefined;
    const id = window.setInterval(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS);
    return () => window.clearInterval(id);
  }, [reduced]);

  // Pointer parallax: light follows the cursor.
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || compact) return undefined;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { el.style.setProperty('--mx', x.toFixed(3)); el.style.setProperty('--my', y.toFixed(3)); });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
  }, [reduced, compact]);

  const [hh, mm, ss] = time;
  const cur = STEPS[step];
  const pct = (step / (STEPS.length - 1)) * 100;

  return (
    <div ref={ref} className={`aur ${compact ? 'aur-compact' : ''} ${reduced ? 'aur-still' : ''}`} aria-hidden>
      <style>{CSS}</style>
      <div className="aur-sky">
        <span className="aur-blob aur-b1" />
        <span className="aur-blob aur-b2" />
        <span className="aur-blob aur-b3" />
        <span className="aur-blob aur-b4" />
        <span className="aur-ribbon aur-r1" />
        <span className="aur-ribbon aur-r2" />
        <span className="aur-stars" />
        <span className="aur-grain" />
        <span className="aur-spot" />
      </div>

      {!compact && (
        <div className="aur-center">
          <p className="aur-kicker"><span className="aur-live" />Live · India Standard Time</p>
          <div className="aur-clock">
            <Digit value={hh[0]} /><Digit value={hh[1]} />
            <span className="aur-colon">:</span>
            <Digit value={mm[0]} /><Digit value={mm[1]} />
            <span className="aur-colon">:</span>
            <span className="aur-sec"><Digit value={ss[0]} /><Digit value={ss[1]} /></span>
          </div>

          <div className="aur-line">
            <div className="aur-track"><div className="aur-fill" style={{ width: `${pct}%`, background: `linear-gradient(90deg, #34d399, ${cur.color})` }} /></div>
            <span className="aur-comet" style={{ left: `${pct}%`, ['--c' as any]: cur.color }} />
            {STEPS.map((s, i) => (
              <span key={s.key} className={`aur-node ${i <= step ? 'on' : ''} ${i === step ? 'now' : ''}`} style={{ left: `${(i / (STEPS.length - 1)) * 100}%`, ['--c' as any]: s.color }}>
                <span className="aur-dot" />
                <span className="aur-lbl">{s.label}</span>
              </span>
            ))}
          </div>

          <div className="aur-card" key={cur.key} style={{ ['--c' as any]: cur.color }}>
            <span className="aur-card-time">{cur.time}</span>
            <span className="aur-card-sep" />
            <span className="aur-card-txt"><b>{cur.label}</b> {cur.note}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
.aur{position:absolute;inset:0;overflow:hidden;--mx:0;--my:0;background:#06060f;isolation:isolate}
.aur-sky{position:absolute;inset:-10%;filter:saturate(1.25)}
.aur-blob{position:absolute;border-radius:50%;filter:blur(70px);mix-blend-mode:screen;opacity:.75;will-change:transform}
.aur-b1{width:60%;height:55%;left:-5%;top:5%;background:radial-gradient(circle,#7c3aed 0%,transparent 65%);animation:aurA 18s ease-in-out infinite alternate;translate:calc(var(--mx)*-60px) calc(var(--my)*-40px)}
.aur-b2{width:55%;height:60%;right:-10%;top:-5%;background:radial-gradient(circle,#06b6d4 0%,transparent 65%);animation:aurB 22s ease-in-out infinite alternate;translate:calc(var(--mx)*50px) calc(var(--my)*30px)}
.aur-b3{width:70%;height:50%;left:15%;bottom:-10%;background:radial-gradient(circle,#10b981 0%,transparent 62%);animation:aurC 26s ease-in-out infinite alternate;translate:calc(var(--mx)*-30px) calc(var(--my)*60px)}
.aur-b4{width:40%;height:40%;left:45%;top:35%;background:radial-gradient(circle,#c8a96a 0%,transparent 65%);opacity:.45;animation:aurA 30s ease-in-out infinite alternate-reverse;translate:calc(var(--mx)*80px) calc(var(--my)*80px)}
.aur-ribbon{position:absolute;left:-20%;width:140%;height:38%;border-radius:50%;filter:blur(38px);mix-blend-mode:screen;opacity:.55;will-change:transform}
.aur-r1{top:18%;background:linear-gradient(90deg,transparent,#22d3ee 25%,#a78bfa 55%,#34d399 80%,transparent);animation:aurWave 14s ease-in-out infinite alternate}
.aur-r2{top:48%;height:26%;opacity:.4;background:linear-gradient(90deg,transparent,#f472b6 20%,#818cf8 50%,#2dd4bf 85%,transparent);animation:aurWave 19s ease-in-out infinite alternate-reverse}
.aur-stars{position:absolute;inset:0;background-image:radial-gradient(1px 1px at 12% 22%,#fff8,transparent),radial-gradient(1px 1px at 28% 78%,#fff6,transparent),radial-gradient(1.5px 1.5px at 62% 14%,#fff9,transparent),radial-gradient(1px 1px at 78% 62%,#fff6,transparent),radial-gradient(1px 1px at 88% 30%,#fff7,transparent),radial-gradient(1px 1px at 44% 48%,#fff5,transparent),radial-gradient(1.5px 1.5px at 8% 70%,#fff7,transparent),radial-gradient(1px 1px at 52% 88%,#fff5,transparent);animation:aurTwinkle 5s ease-in-out infinite alternate}
.aur-grain{position:absolute;inset:0;opacity:.09;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.aur-spot{position:absolute;width:520px;height:520px;border-radius:50%;left:calc(50% + var(--mx)*90% - 260px);top:calc(50% + var(--my)*90% - 260px);background:radial-gradient(circle,rgba(255,255,255,.10),transparent 60%);transition:left .25s ease-out,top .25s ease-out;pointer-events:none}
.aur::after{content:"";position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 110%,rgba(6,6,15,.85),transparent 60%),linear-gradient(180deg,rgba(6,6,15,.35),transparent 30%,transparent 70%,rgba(6,6,15,.55));pointer-events:none}

.aur-center{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:0 8%;gap:34px;translate:calc(var(--mx)*-14px) calc(var(--my)*-10px);transition:translate .3s ease-out}
.aur-kicker{display:flex;align-items:center;gap:10px;font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:rgba(255,255,255,.6);font-weight:700;animation:aurIn 1s .2s both}
.aur-live{width:8px;height:8px;border-radius:50%;background:#34d399;box-shadow:0 0 0 0 rgba(52,211,153,.7);animation:aurPulse 1.6s infinite}
.aur-clock{display:flex;align-items:center;font-family:var(--font-display,inherit);font-weight:800;font-size:clamp(64px,8.6vw,132px);line-height:1;letter-spacing:-.04em;color:#fff;font-variant-numeric:tabular-nums;text-shadow:0 0 40px rgba(167,139,250,.55),0 0 90px rgba(34,211,238,.25);animation:aurRise 1.2s cubic-bezier(.2,.8,.2,1) both}
.aur-digit{display:inline-block;height:1em;overflow:hidden;width:.62em;text-align:center;-webkit-mask-image:linear-gradient(180deg,transparent,#000 18%,#000 82%,transparent);mask-image:linear-gradient(180deg,transparent,#000 18%,#000 82%,transparent)}
.aur-digit-strip{display:flex;flex-direction:column;transition:transform .7s cubic-bezier(.65,0,.35,1)}
.aur-digit-strip>span{height:1em;display:block;background:linear-gradient(180deg,#fff 30%,#c4b5fd 75%,#67e8f9);-webkit-background-clip:text;background-clip:text;color:transparent}
.aur-colon{margin:0 .04em;transform:translateY(-.06em);color:rgba(255,255,255,.55);animation:aurBlink 1s steps(1) infinite}
.aur-sec{display:inline-flex;font-size:.42em;align-self:flex-start;margin-top:.12em;opacity:.8}

.aur-line{position:relative;width:min(100%,520px);height:58px;animation:aurIn 1s .5s both}
.aur-track{position:absolute;left:0;right:0;top:10px;height:3px;border-radius:9px;background:rgba(255,255,255,.12);overflow:hidden}
.aur-fill{height:100%;border-radius:9px;transition:width 1.1s cubic-bezier(.65,0,.35,1),background .6s;box-shadow:0 0 18px currentColor}
.aur-comet{position:absolute;top:4px;width:15px;height:15px;margin-left:-7.5px;border-radius:50%;background:#fff;box-shadow:0 0 12px 4px var(--c),0 0 40px 10px var(--c);transition:left 1.1s cubic-bezier(.65,0,.35,1),box-shadow .6s;z-index:2}
.aur-node{position:absolute;top:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:12px}
.aur-dot{width:23px;height:23px;border-radius:50%;border:2px solid rgba(255,255,255,.22);background:#0b0b18;transition:all .5s}
.aur-node.on .aur-dot{border-color:var(--c);background:color-mix(in srgb,var(--c) 30%,#0b0b18)}
.aur-node.now .aur-dot{transform:scale(1.25);box-shadow:0 0 0 6px color-mix(in srgb,var(--c) 22%,transparent),0 0 26px var(--c)}
.aur-lbl{font-size:11px;font-weight:700;letter-spacing:.04em;color:rgba(255,255,255,.4);white-space:nowrap;transition:color .5s}
.aur-node.on .aur-lbl{color:rgba(255,255,255,.85)}

.aur-card{display:flex;align-items:center;gap:14px;padding:12px 18px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);color:rgba(255,255,255,.85);font-size:14px;box-shadow:0 10px 40px -10px var(--c);animation:aurCard .7s cubic-bezier(.2,.8,.2,1) both}
.aur-card-time{font-variant-numeric:tabular-nums;font-weight:800;color:var(--c)}
.aur-card-sep{width:1px;height:18px;background:rgba(255,255,255,.2)}
.aur-card-txt b{color:#fff;margin-right:4px}

.aur-compact .aur-blob{filter:blur(50px);opacity:.55}
.aur-compact .aur-ribbon{opacity:.35}
.aur-still *{animation:none!important;transition:none!important}

@keyframes aurA{0%{transform:translate(0,0) scale(1)}50%{transform:translate(18%,12%) scale(1.25)}100%{transform:translate(-8%,22%) scale(.9)}}
@keyframes aurB{0%{transform:translate(0,0) scale(1.1)}50%{transform:translate(-22%,18%) scale(.85)}100%{transform:translate(-10%,-6%) scale(1.3)}}
@keyframes aurC{0%{transform:translate(0,0) scale(1)}50%{transform:translate(-15%,-20%) scale(1.2)}100%{transform:translate(12%,-8%) scale(.95)}}
@keyframes aurWave{0%{transform:translateX(-8%) rotate(-6deg) scaleY(.8)}50%{transform:translateX(6%) rotate(4deg) scaleY(1.2)}100%{transform:translateX(10%) rotate(-2deg) scaleY(.9)}}
@keyframes aurTwinkle{from{opacity:.35}to{opacity:.9}}
@keyframes aurPulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.7)}70%{box-shadow:0 0 0 10px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}
@keyframes aurBlink{50%{opacity:.15}}
@keyframes aurRise{from{opacity:0;transform:translateY(30px) scale(.96);filter:blur(10px)}to{opacity:1;transform:none;filter:none}}
@keyframes aurIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes aurCard{from{opacity:0;transform:translateY(10px) scale(.97);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
`;
