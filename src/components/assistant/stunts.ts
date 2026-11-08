/**
 * Sigma's stunts: scripts that move the robot around the whole screen (driven frame by frame, not by CSS)
 * together with the 3D poses/props and the screen-wide effects layer. Also drag-and-throw physics.
 *
 * Every script is short (≈4–7 s), can be cancelled at any moment (the robot then flies home), and never
 * takes clicks while it runs: the robot lets clicks pass through while it is performing.
 */
import type { Buddy3DApi, BuddyAction } from './Buddy3D';
import { Ball, Fx, Plane } from './fx';
import { log } from '../../lib/log';

export type StuntName =
  | 'rocket' | 'football' | 'hoverboard' | 'cleaner' | 'hide' | 'glitch' | 'hang' | 'plane'
  | 'victory' | 'facepalm' | 'cannon' | 'dj' | 'lunch' | 'coffee' | 'party' | 'bye' | 'explode';

/** the ones that roam the screen while the page is idle */
export const IDLE_STUNTS: StuntName[] = ['rocket', 'football', 'hoverboard', 'cleaner', 'hide', 'glitch', 'hang', 'plane'];

export interface StageDeps {
  fab: () => HTMLElement | null;
  bot: () => Buddy3DApi | null;
  /** robot box size */
  size: () => { w: number; h: number };
  home: () => { x: number; y: number };
  /** where the "floor" is (bottom edge of the robot box at home) */
  floor: () => number;
  /** tell React where the robot ended up; away=false when it is home */
  commit: (p: { x: number; y: number }, away: boolean) => void;
  onBusy: (busy: boolean) => void;
  /** put down gently somewhere: that becomes Sigma's spot */
  onDrop: (p: { x: number; y: number }) => void;
}

class Cancelled extends Error {}

export function createStage(d: StageDeps) {
  const fx = new Fx();
  let running: string | null = null;
  let token = 0;
  let cur = { x: 0, y: 0 };
  let cleanups: Array<() => void> = [];
  const onTidy = (fn: () => void) => { cleanups.push(fn); };

  const el = () => d.fab();
  const read = () => {
    const f = el(); if (!f) return cur;
    return { x: parseFloat(f.style.left) || 0, y: parseFloat(f.style.top) || 0 };
  };
  const place = (x: number, y: number) => {
    cur = { x, y };
    const f = el(); if (!f) return;
    f.style.left = `${x}px`; f.style.top = `${y}px`;
  };
  const begin = (name: string) => {
    running = name; const my = ++token;
    cur = read();
    const f = el(); f?.classList.add('buddy-driving'); f?.setAttribute('data-stunt', name);
    d.onBusy(true);
    return my;
  };
  const check = (my: number) => { if (my !== token) throw new Cancelled(); };
  const wait = (ms: number, my: number) => new Promise<void>((res, rej) => window.setTimeout(() => (my === token ? res() : rej(new Cancelled())), ms));
  const until = (fn: () => boolean, my: number, maxMs = 4000) => new Promise<void>((res, rej) => {
    const t0 = performance.now();
    const step = () => { if (my !== token) { rej(new Cancelled()); return; } if (fn() || performance.now() - t0 > maxMs) { res(); return; } requestAnimationFrame(step); };
    step();
  });
  /** move along fn(u) for dur ms; u = 0..1 */
  const path = (dur: number, fn: (u: number) => { x: number; y: number }, my: number, o: { ease?: boolean; trail?: boolean; fly?: boolean; onFrame?: (p: { x: number; y: number }, u: number, vx: number) => void } = {}) =>
    new Promise<void>((res, rej) => {
      const t0 = performance.now(); let px = cur.x, py = cur.y, lastT = t0;
      const { w, h } = d.size();
      const step = (now: number) => {
        if (my !== token) { rej(new Cancelled()); return; }
        const raw = Math.min(1, (now - t0) / dur), u = o.ease === false ? raw : raw * raw * (3 - 2 * raw);
        const p = fn(u); place(p.x, p.y);
        const dt = Math.max(.001, (now - lastT) / 1000); lastT = now;
        const vx = (p.x - px) / dt, vy = (p.y - py) / dt; px = p.x; py = p.y;
        if (o.fly !== false) d.bot()?.fly(true, Math.abs(vx) < 60 ? 0 : Math.sign(vx));
        if (o.trail !== false && (Math.abs(vx) + Math.abs(vy)) > 40) fx.trail(p.x + w / 2, p.y + h * .9, vx, vy);
        o.onFrame?.(p, u, vx);
        if (raw >= 1) { res(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  const line = (to: { x: number; y: number }, dur: number, my: number, o: Parameters<typeof path>[3] = {}) => {
    const from = { ...cur };
    return path(dur, (u) => ({ x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u }), my, o);
  };
  const tidy = () => {
    const f = el(); const b = d.bot();
    f?.classList.remove('buddy-driving', 'buddy-glitch'); f?.removeAttribute('data-stunt');
    if (f) { f.style.opacity = ''; f.style.transform = ''; f.style.transformOrigin = ''; }
    const cs = cleanups; cleanups = []; cs.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    b?.pose(null); b?.setFacing(0); b?.setZoom(1); b?.setDir(0);
    running = null; d.onBusy(false);
  };
  /** fly home with the normal CSS glide */
  const goHome = () => {
    const from = read(), to = d.home();
    tidy();
    const b = d.bot(); const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (dist > 4) { b?.fly(true, Math.abs(to.x - from.x) < 30 ? 0 : Math.sign(to.x - from.x)); window.setTimeout(() => d.bot()?.fly(false), Math.min(1400, 500 + dist * .8)); }
    else b?.fly(false);
    d.commit(to, false);
  };

  const W = () => window.innerWidth, H = () => window.innerHeight;

  const scripts: Record<StuntName, (my: number) => Promise<'home' | 'stay'>> = {
    /** blasts around the edge of the screen with a loop-the-loop along the top */
    rocket: async (my) => {
      const { w, h } = d.size(), m = 10;
      const tr = { x: W() - w - m, y: m }, tl = { x: m, y: m }, bl = { x: m, y: d.floor() - h };
      await line(tr, 900, my);
      const R = Math.min(110, H() * .16);
      const from = { ...cur };
      let looped = false;
      await path(1900, (u) => {
        const x = from.x + (tl.x - from.x) * u; let y = from.y;
        let dx = 0;
        if (u > .38 && u < .62) { const v = (u - .38) / .24, a = v * Math.PI * 2; dx = Math.sin(a) * R * .9; y += (1 - Math.cos(a)) * R; if (!looped) { looped = true; d.bot()?.play('backflip'); } }
        return { x: x + dx, y };
      }, my, { ease: false });
      await line(bl, 800, my);
      await line(d.home(), 1100, my);
      d.bot()?.fly(false);
      return 'home';
    },
    /** headers, a kick across the screen, a chase and a dribble back */
    football: async (my) => {
      const { w, h } = d.size(); const b = d.bot();
      const floorY = d.floor() - 2;
      const head = () => ({ x: cur.x + w * .5, top: cur.y + h * .16 });
      const ball = new Ball(head().x + 6, -30, floorY); ball.vy = 200;
      fx.addSprite(ball); onTidy(() => { ball.alive = false; });
      let headers = 0;
      while (headers < 2) {
        await until(() => ball.vy > 0 && ball.y + ball.r >= head().top, my, 3000);
        ball.vy = -820; ball.vx = headers === 1 ? -150 : 10; headers++;
        b?.play('header'); fx.sparkle(ball.x, ball.y + ball.r, 4);
      }
      await until(() => ball.y + ball.r >= floorY - 1 && ball.vy <= 0, my, 3000);
      b?.setFacing(-.7); b?.play('kick');
      await wait(260, my);
      ball.vx = -1150; ball.vy = -560; fx.dust(ball.x, floorY, 8);
      await wait(350, my);
      b?.setFacing(0);
      await line({ x: -w * 1.3, y: cur.y }, 1100, my);
      ball.alive = false;
      await wait(500, my);
      // dribble back in from the left
      const back = new Ball(-w, floorY - 15, floorY); back.g = 0; back.vy = 0; fx.addSprite(back); onTidy(() => { back.alive = false; });
      const target = d.home();
      await path(2100, (u) => ({ x: -w + (target.x + w) * u, y: target.y }), my, { onFrame: (p, u, vx) => { back.x = p.x + w + 4 + Math.sin(u * 30) * 6; back.y = floorY - back.r; back.vx = vx; } });
      back.alive = false; fx.dust(back.x, floorY, 10); fx.sparkle(back.x, floorY - 20, 6);
      d.bot()?.fly(false); d.bot()?.play('victory');
      return 'home';
    },
    /** rides a hoverboard across the bottom and back */
    hoverboard: async (my) => {
      const { w } = d.size(); const b = d.bot(); const y = cur.y;
      b?.pose('surf'); b?.setDir(-1);
      const left = { x: 16, y }, startX = cur.x;
      let ollied = false;
      await path(2000, (u) => ({ x: startX + (left.x - startX) * u, y: y - Math.sin(u * Math.PI * 4) * 6 }), my, { fly: false, onFrame: (p, u) => { if (!ollied && u > .5) { ollied = true; b?.play('ollie'); } fx.trail(p.x + w / 2, cur.y + d.size().h * .92, -300, 0); } });
      b?.setDir(1); await wait(350, my);
      await path(1900, (u) => ({ x: left.x + (d.home().x - left.x) * u, y: y - Math.sin(u * Math.PI * 4) * 6 }), my, { fly: false, onFrame: (p) => fx.trail(p.x + w / 2, cur.y + d.size().h * .92, 300, 0) });
      b?.pose(null); b?.setDir(0); b?.play('land');
      return 'home';
    },
    /** cleans the screen with a sponge; soapy streaks fade away */
    cleaner: async (my) => {
      const { w, h } = d.size(); const b = d.bot();
      const x0 = W() * .22, x1 = Math.max(x0 + 120, W() * .62), y0 = Math.max(70, H() * .18);
      await line({ x: x1, y: y0 }, 1000, my);
      d.bot()?.fly(false); b?.pose('wipe');
      const hand = () => ({ x: cur.x + w * .2, y: cur.y + h * .5 });
      for (let i = 0; i < 3; i++) {
        const fromX = i % 2 ? x0 : x1, toX = i % 2 ? x1 : x0, yy = y0 + i * 56;
        await path(1050, (u) => ({ x: fromX + (toX - fromX) * u, y: yy + Math.sin(u * Math.PI * 6) * 14 }), my, { fly: false, trail: false, onFrame: () => { const p = hand(); fx.smear(p.x, p.y); } });
      }
      b?.pose(null);
      const c = hand(); fx.sparkle(c.x, c.y, 12);
      b?.play('wave');
      await wait(900, my);
      return 'home';
    },
    /** zooms off the right, peeks in from the left, BOO! */
    hide: async (my) => {
      const { w, h } = d.size(); const b = d.bot();
      await line({ x: W() + 30, y: cur.y - 40 }, 700, my);
      await wait(900, my);
      const y = Math.max(80, H() * .38);
      place(-w * .62, y); b?.pose('lean');
      await line({ x: -w * .38, y }, 500, my, { fly: false, trail: false });
      await wait(1100, my);
      b?.pose(null);
      await line({ x: 24, y: y - 10 }, 260, my, { fly: false });
      b?.play('boo'); fx.comic('BOO!', 24 + w + 50, y + 4);
      await wait(1300, my);
      return 'home';
    },
    /** breaks into pixels and reappears in another corner */
    glitch: async (my) => {
      const { w, h } = d.size(); const f = el(); const b = d.bot();
      const zap = async (to: { x: number; y: number }) => {
        f?.classList.add('buddy-glitch'); await wait(450, my);
        fx.pixels(cur.x, cur.y, w, h, 'out'); if (f) f.style.opacity = '0';
        f?.classList.remove('buddy-glitch');
        await wait(320, my);
        place(to.x, to.y); fx.pixels(to.x, to.y, w, h, 'in');
        await wait(380, my);
        if (f) f.style.opacity = ''; f?.classList.add('buddy-glitch');
        await wait(300, my); f?.classList.remove('buddy-glitch');
      };
      const spots = [{ x: 16, y: 80 }, { x: W() - w - 16, y: 80 }, { x: 16, y: d.floor() - h }, { x: W() * .5 - w / 2, y: H() * .35 }];
      await zap(spots[Math.floor(Math.random() * spots.length)]);
      b?.play('look'); await wait(1700, my);
      await zap(d.home());
      b?.play('wave');
      return 'stay';
    },
    /** hangs upside down from the top edge of the screen and swings */
    hang: async (my) => {
      const { w, h } = d.size(); const f = el(); const b = d.bot();
      const x = W() * (.3 + Math.random() * .4) - w / 2;
      const feet = h * .75;          // where the sneakers are inside the box
      const top = 4 - feet;          // feet touching the top edge once flipped
      await line({ x, y: H() * .2 }, 900, my);
      // flip over while rising to the edge
      const y0 = cur.y; const t0 = performance.now();
      if (f) f.style.transformOrigin = `${w / 2}px ${feet}px`;
      await until(() => {
        const u = Math.min(1, (performance.now() - t0) / 550), e = u * u * (3 - 2 * u);
        place(x, y0 + (top - y0) * e); if (f) f.style.transform = `rotate(${180 * e}deg)`;
        return u >= 1;
      }, my, 1500);
      d.bot()?.fly(false); b?.pose('hang');
      const t1 = performance.now();
      await until(() => {
        const t = (performance.now() - t1) / 1000;
        if (f) f.style.transform = `rotate(${180 + Math.sin(t * 3.2) * 20 * Math.max(.3, 1 - t / 5)}deg)`;
        return t > 3.8;
      }, my, 5000);
      // lets go: flips back upright while dropping
      b?.pose(null); b?.play('startle');
      const t2 = performance.now(), yy = cur.y;
      await until(() => {
        const u = Math.min(1, (performance.now() - t2) / 600), e = u * u * (3 - 2 * u);
        place(x, yy + (H() * .38 - yy) * e); if (f) f.style.transform = `rotate(${180 + 180 * e}deg)`;
        return u >= 1;
      }, my, 1500);
      if (f) f.style.transform = '';
      return 'home';
    },
    /** throws a paper plane that loops across the page */
    plane: async (my) => {
      const { w, h } = d.size(); const b = d.bot();
      b?.setFacing(-.5); b?.play('throw');
      await wait(480, my);
      fx.addSprite(new Plane(cur.x + w * .2, cur.y + h * .3, fx));
      await wait(500, my);
      b?.setFacing(0); b?.play('look');
      await wait(2400, my);
      b?.play('celebrate');
      await wait(1600, my);
      return 'stay';
    },

    /* ── reactions to the real day ── */
    victory: async (my) => {
      fx.fireworks(6, 2600);
      await scripts.rocket(my);
      d.bot()?.play('victory');
      fx.confetti(cur.x + d.size().w / 2, cur.y + 10, -Math.PI / 2, 1.4, 90, 800);
      await wait(1600, my);
      return 'home';
    },
    facepalm: async (my) => { d.bot()?.play('facepalm'); await wait(3000, my); return 'stay'; },
    cannon: async (my) => {
      const { w } = d.size(); const b = d.bot();
      b?.play('victory');
      await wait(250, my);
      fx.confetti(cur.x + w * .5, cur.y + 20, -Math.PI / 2 - .5, .9, 160, 1150);
      await wait(250, my);
      fx.confetti(cur.x + w * .5, cur.y + 20, -Math.PI / 2 - .15, .7, 110, 1000);
      await wait(2000, my);
      return 'stay';
    },
    dj: async (my) => {
      const { w, h } = d.size();
      d.bot()?.play('dj'); fx.lights(cur.x + w / 2, cur.y + h * .5, 6);
      await wait(6000, my);
      return 'stay';
    },
    lunch: async (my) => { d.bot()?.play('munch'); await wait(4400, my); return 'stay'; },
    coffee: async (my) => { d.bot()?.play('sip'); await wait(4000, my); return 'stay'; },
    party: async (my) => {
      const { w } = d.size();
      d.bot()?.play('party'); fx.confetti(cur.x + w / 2, cur.y + 10, -Math.PI / 2, 1.6, 120, 900);
      await wait(4200, my); return 'stay';
    },
    /** packs its bag, waves bye, flies off — then peeks back in: "still here?" */
    bye: async (my) => {
      const { w } = d.size(); const b = d.bot();
      b?.prop('backpack', true); b?.play('bye');
      await wait(2500, my);
      await line({ x: W() + 40, y: cur.y - 120 }, 1100, my);
      b?.prop('backpack', false);
      await wait(2200, my);
      place(W() - w * .45, d.home().y); b?.pose('lean'); b?.setFacing(-.4);
      await wait(1400, my);
      b?.pose(null); b?.setFacing(0); b?.play('look');
      return 'home';
    },
    /** poked too often: falls apart and snaps back (on a bigger stage so the parts aren't clipped) */
    explode: async (my) => {
      const f = el(); const b = d.bot(); const { w, h } = d.size(); const Z = 3;
      const x = cur.x, y = cur.y;
      if (f) { f.style.left = `${x - (Z - 1) * w / 2}px`; f.style.top = `${y - (Z - 1) * h / 2}px`; f.style.width = `${w * Z}px`; f.style.height = `${h * Z}px`; }
      onTidy(() => { if (f) { f.style.left = `${x}px`; f.style.top = `${y}px`; f.style.width = `${w}px`; f.style.height = `${h}px`; } cur = { x, y }; });
      b?.setZoom(Z); b?.play('explode');
      fx.sparkle(x + w / 2, y + h / 2, 14); fx.comic('POP!', x + w / 2, y - 10, 1);
      await wait(1800 + 2800, my);
      // put the box back before reporting where Sigma is
      if (f) { f.style.left = `${x}px`; f.style.top = `${y}px`; f.style.width = `${w}px`; f.style.height = `${h}px`; }
      cur = { x, y };
      return 'stay';
    },
  };

  async function run(name: StuntName): Promise<boolean> {
    if (running || !el() || !d.bot()) return false;
    const my = begin(name);
    try {
      const end = await scripts[name](my);
      if (my !== token) return false;
      if (end === 'home') goHome();
      else { const at = read(); tidy(); const home = d.home(); d.commit(at, Math.hypot(at.x - home.x, at.y - home.y) > 4); }
      return true;
    } catch (e) {
      if (!(e instanceof Cancelled)) log.warn('[sigma] stunt', name, e);
      return false;
    }
  }
  /** stop whatever is running and fly home */
  function abort(goHomeToo = true) {
    if (!running) return;
    token++;
    if (goHomeToo) goHome(); else tidy();
  }

  /* ── drag and throw ── */
  let drag: null | { ox: number; oy: number; samples: Array<{ x: number; y: number; t: number }>; moved: boolean; sx: number; sy: number } = null;
  function dragStart(cx: number, cy: number) {
    if (running) abort(false);
    const p = read(); cur = p;
    drag = { ox: cx - p.x, oy: cy - p.y, samples: [], moved: false, sx: cx, sy: cy };
  }
  function dragMove(cx: number, cy: number) {
    if (!drag) return false;
    if (!drag.moved && Math.hypot(cx - drag.sx, cy - drag.sy) < 7) return false;
    if (!drag.moved) { drag.moved = true; running = 'drag'; token++; el()?.classList.add('buddy-driving'); d.bot()?.pose('dangle'); d.onBusy(true); }
    const { w, h } = d.size();
    place(Math.max(-w * .3, Math.min(W() - w * .7, cx - drag.ox)), Math.max(-h * .2, Math.min(H() - h * .6, cy - drag.oy)));
    const now = performance.now();
    drag.samples.push({ x: cur.x, y: cur.y, t: now });
    while (drag.samples.length > 2 && now - drag.samples[0].t > 90) drag.samples.shift();
    return true;
  }
  /** returns true when it was a drag (so the click should be ignored) */
  function dragEnd(): boolean {
    const g = drag; drag = null;
    if (!g || !g.moved) return false;
    const b = d.bot(); b?.pose(null);
    const s = g.samples, a = s[0], z = s[s.length - 1];
    const dt = a && z ? Math.max(.016, (z.t - a.t) / 1000) : 1;
    const vx = a && z ? (z.x - a.x) / dt : 0, vy = a && z ? (z.y - a.y) / dt : 0;
    const my = ++token; running = 'throw';
    if (Math.hypot(vx, vy) < 650) {
      // gently put down: Sigma stays where it was left
      b?.play('land'); el()?.classList.remove('buddy-driving'); running = null; d.onBusy(false);
      d.onDrop(read());
      return true;
    }
    void (async () => {
      try {
        const { w, h } = d.size(); let x = cur.x, y = cur.y, ux = vx, uy = vy; let bounces = 0; const t0 = performance.now();
        b?.pose('dangle');
        await until(() => {
          const dt2 = 1 / 60;
          uy += 1600 * dt2; ux *= .992; uy *= .992;
          x += ux * dt2; y += uy * dt2;
          const minX = 0, maxX = W() - w, minY = 0, maxY = d.floor() - h;
          let hit = false;
          if (x < minX) { x = minX; ux = -ux * .6; hit = true; } else if (x > maxX) { x = maxX; ux = -ux * .6; hit = true; }
          if (y < minY) { y = minY; uy = -uy * .6; hit = true; } else if (y > maxY) { y = maxY; uy = -uy * .5; ux *= .8; hit = true; }
          if (hit && Math.hypot(ux, uy) > 160) { bounces++; d.bot()?.play('squash'); fx.dust(x + w / 2, y + h * (y >= maxY ? .95 : .5), 8); }
          place(x, y);
          return (y >= maxY - .5 && Math.abs(uy) < 90 && Math.abs(ux) < 60) || performance.now() - t0 > 4200;
        }, my, 4600);
        d.bot()?.pose(null);
        d.bot()?.play(bounces > 0 ? 'dizzy' : 'land');
        await wait(bounces > 0 ? 2800 : 700, my);
        goHome();
      } catch { /* cancelled */ }
    })();
    return true;
  }
  const dragging = () => !!drag?.moved;

  return {
    fx, run, abort, dragStart, dragMove, dragEnd, dragging,
    busy: () => running !== null,
    dispose: () => { token++; fx.dispose(); },
  };
}
export type Stage = ReturnType<typeof createStage>;
export type { BuddyAction };
