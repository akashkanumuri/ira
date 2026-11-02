/**
 * Screen-wide effects for the Sigma robot: one transparent canvas over the page (never takes clicks)
 * for thruster trails, fireworks, confetti, soap streaks, glitch pixels, a football, a paper plane,
 * DJ lights and comic text. It only runs while something is on screen.
 */

type Shape = 'dot' | 'square' | 'smear' | 'bubble' | 'star';
interface Particle {
  x: number; y: number; vx: number; vy: number; g: number; drag: number;
  life: number; max: number; size: number; color: string; shape: Shape; rot: number; vr: number; grow: number; alpha: number;
}
export interface Sprite { update: (dt: number, t: number) => boolean; draw: (c: CanvasRenderingContext2D, t: number) => void }

const PALETTE = ['#8b5cf6', '#f472b6', '#22d3ee', '#fbbf24', '#34d399', '#ff4f8b', '#ff9a2e'];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export class Fx {
  private cv: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private parts: Particle[] = [];
  private sprites: Sprite[] = [];
  private raf = 0;
  private last = 0;
  private dpr = 1;
  W = 0; H = 0;

  private ensure() {
    if (this.cv) return;
    const cv = document.createElement('canvas');
    cv.className = 'buddy-fx';
    cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    this.cv = cv; this.ctx = cv.getContext('2d');
    this.resize();
    window.addEventListener('resize', this.resize);
  }
  private resize = () => {
    if (!this.cv) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
  };
  private kick() {
    this.ensure();
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); }
  }
  private frame = (now: number) => {
    this.raf = -1; // inside a frame: adding particles must not schedule a second loop
    const c = this.ctx; if (!c || !this.cv) { this.raf = 0; return; }
    const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
    const t = now / 1000;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    this.sprites = this.sprites.filter((s) => s.update(dt, t));
    for (const s of this.sprites) { c.save(); s.draw(c, t); c.restore(); }
    const keep: Particle[] = [];
    for (const p of this.parts) {
      p.life -= dt; if (p.life <= 0) continue;
      p.vy += p.g * dt; p.vx *= Math.pow(p.drag, dt * 60); p.vy *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.size += p.grow * dt;
      const k = p.life / p.max;
      c.globalAlpha = p.alpha * (p.shape === 'smear' ? Math.min(1, k * 2.5) : Math.min(1, k * 1.6));
      c.fillStyle = p.color; c.strokeStyle = p.color;
      if (p.shape === 'dot') { c.beginPath(); c.arc(p.x, p.y, Math.max(.5, p.size), 0, Math.PI * 2); c.fill(); }
      else if (p.shape === 'square') { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillRect(-p.size / 2, -p.size * .3, p.size, p.size * .6); c.restore(); }
      else if (p.shape === 'smear') { const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size); g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(160,190,255,0)'); c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, p.size, 0, Math.PI * 2); c.fill(); }
      else if (p.shape === 'bubble') { c.lineWidth = 1.5; c.beginPath(); c.arc(p.x, p.y, p.size, 0, Math.PI * 2); c.stroke(); c.globalAlpha *= .6; c.fillStyle = '#ffffff'; c.beginPath(); c.arc(p.x - p.size * .35, p.y - p.size * .35, p.size * .25, 0, Math.PI * 2); c.fill(); }
      else if (p.shape === 'star') { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? p.size * .3 : p.size; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); c.restore(); }
      keep.push(p);
    }
    c.globalAlpha = 1;
    this.parts = keep;
    if (this.parts.length || this.sprites.length) this.raf = requestAnimationFrame(this.frame);
    else { this.raf = 0; c.clearRect(0, 0, this.W, this.H); }
  };

  private add(p: Partial<Particle> & { x: number; y: number }) {
    const life = p.life ?? 1;
    this.parts.push({ vx: 0, vy: 0, g: 0, drag: 1, size: 3, color: '#fff', shape: 'dot', rot: 0, vr: 0, grow: 0, alpha: 1, ...p, life, max: life });
    if (this.parts.length > 1400) this.parts.splice(0, this.parts.length - 1400);
    this.kick();
  }
  addSprite(s: Sprite) { this.sprites.push(s); this.kick(); return s; }
  get busy() { return this.parts.length > 0 || this.sprites.length > 0; }

  /** amber thruster sparks behind the robot */
  trail(x: number, y: number, vx = 0, vy = 0) {
    for (let i = 0; i < 2; i++) this.add({ x: x + (Math.random() - .5) * 10, y, vx: -vx * .15 + (Math.random() - .5) * 40, vy: -vy * .15 + 40 + Math.random() * 60, life: .45 + Math.random() * .3, size: 2.5 + Math.random() * 3, grow: -3, color: Math.random() < .5 ? '#ff9a2e' : '#ffd08a' });
  }
  dust(x: number, y: number, n = 10) {
    for (let i = 0; i < n; i++) this.add({ x, y, vx: (Math.random() - .5) * 220, vy: -Math.random() * 80, g: 120, drag: .93, life: .6 + Math.random() * .3, size: 4 + Math.random() * 4, grow: 10, alpha: .35, color: '#b8b3d6' });
  }
  sparkle(x: number, y: number, n = 8) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 120; this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: .9, life: .7 + Math.random() * .4, size: 5 + Math.random() * 5, shape: 'star', vr: 4, color: pick(['#fbbf24', '#ffffff', '#c4b5fd']) }); }
  }
  /** confetti cannon from (x, y) towards angle (radians, 0 = right, -PI/2 = up) */
  confetti(x: number, y: number, angle = -Math.PI / 2, spread = .9, n = 140, speed = 900) {
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - .5) * spread, v = speed * (.45 + Math.random() * .7);
      this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 700, drag: .965, life: 2.2 + Math.random() * 1.4, size: 6 + Math.random() * 6, shape: 'square', rot: Math.random() * 6, vr: (Math.random() - .5) * 14, color: pick(PALETTE) });
    }
  }
  /** fireworks across the top of the screen */
  fireworks(n = 5, spanMs = 2400) {
    for (let i = 0; i < n; i++) window.setTimeout(() => this.rocket(), (i / n) * spanMs + Math.random() * 200);
  }
  private rocket() {
    this.ensure();
    const x0 = this.W * (.15 + Math.random() * .7), y1 = this.H * (.12 + Math.random() * .25);
    let x = x0, y = this.H + 10; const vy = -(this.H - y1) / .8, col = pick(PALETTE);
    this.addSprite({
      update: (dt) => {
        y += vy * dt;
        this.add({ x, y, vx: (Math.random() - .5) * 20, vy: 30, life: .35, size: 2.2, color: '#ffd08a' });
        if (y > y1) return true;
        for (let k = 0; k < 70; k++) { const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 260; this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 160, drag: .95, life: 1 + Math.random() * .7, size: 2.4 + Math.random() * 1.6, color: Math.random() < .2 ? '#ffffff' : col }); }
        return false;
      },
      draw: () => undefined,
    });
  }
  /** soap streak where the sponge passes */
  smear(x: number, y: number) {
    this.add({ x, y, life: 2.6, size: 20 + Math.random() * 8, shape: 'smear', alpha: .8, color: 'rgba(120,160,255,0.7)' });
    if (Math.random() < .18) this.add({ x: x + (Math.random() - .5) * 30, y: y + (Math.random() - .5) * 20, vy: -20 - Math.random() * 30, vx: (Math.random() - .5) * 20, life: 1.6, size: 4 + Math.random() * 7, shape: 'bubble', alpha: .8, color: '#8fb3ff' });
  }
  /** glitch: the robot breaks into pixels (out) or is put back together from them (in) */
  pixels(x: number, y: number, w: number, h: number, mode: 'out' | 'in') {
    const cols = ['#16161a', '#2a2b30', '#ff7fb0', '#ff9a2e', '#8b5cf6', '#22d3ee'];
    for (let i = 0; i < 90; i++) {
      const px = x + w * (.2 + Math.random() * .6), py = y + h * (.1 + Math.random() * .85);
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 120;
      if (mode === 'out') this.add({ x: px, y: py, vx: Math.cos(a) * d * 2.2, vy: Math.sin(a) * d * 2.2, drag: .9, life: .5 + Math.random() * .3, size: 5 + Math.random() * 5, shape: 'square', color: pick(cols) });
      else this.add({ x: px + Math.cos(a) * d, y: py + Math.sin(a) * d, vx: -Math.cos(a) * d * 2.6, vy: -Math.sin(a) * d * 2.6, drag: .92, life: .38 + Math.random() * .1, size: 5 + Math.random() * 5, shape: 'square', color: pick(cols) });
    }
  }
  /** comic speech text that pops and fades ("BOO!") */
  comic(text: string, x: number, y: number, dur = 1.4) {
    let t = 0;
    this.addSprite({
      update: (dt) => { t += dt; return t < dur; },
      draw: (c) => {
        const k = t / dur, s = t < .18 ? (t / .18) * 1.3 : t < .3 ? 1.3 - (t - .18) / .12 * .3 : 1;
        c.globalAlpha = k > .75 ? (1 - k) / .25 : 1;
        c.translate(x, y); c.rotate(-.12 + Math.sin(t * 18) * .03); c.scale(s, s);
        c.font = '900 44px system-ui, -apple-system, Segoe UI, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineJoin = 'round'; c.lineWidth = 9; c.strokeStyle = '#1b1530'; c.strokeText(text, 0, 0);
        c.fillStyle = '#fbbf24'; c.fillText(text, 0, 0);
      },
    });
  }
  /** coloured stage lights sweeping from (x, y) */
  lights(x: number, y: number, dur = 6) {
    let t = 0; const cols = ['rgba(255,79,139,0.16)', 'rgba(139,92,246,0.16)', 'rgba(34,211,238,0.14)'];
    this.addSprite({
      update: (dt) => { t += dt; if (Math.random() < .2) this.add({ x: Math.random() * this.W, y: Math.random() * this.H * .7, life: .5, size: 4 + Math.random() * 4, shape: 'star', color: pick(['#fbbf24', '#f472b6', '#22d3ee', '#ffffff']) }); return t < dur; },
      draw: (c) => {
        const fade = Math.min(1, t / .4, (dur - t) / .5); c.globalAlpha = Math.max(0, fade);
        const L = Math.hypot(this.W, this.H);
        cols.forEach((col, i) => {
          const a = -Math.PI / 2 + Math.sin(t * (1.3 + i * .4) + i * 2) * .9;
          c.fillStyle = col; c.beginPath(); c.moveTo(x, y);
          c.lineTo(x + Math.cos(a - .12) * L, y + Math.sin(a - .12) * L); c.lineTo(x + Math.cos(a + .12) * L, y + Math.sin(a + .12) * L); c.closePath(); c.fill();
        });
      },
    });
  }
  clear() { this.parts = []; this.sprites = []; }
  dispose() {
    if (this.raf > 0) cancelAnimationFrame(this.raf); this.raf = 0;
    window.removeEventListener('resize', this.resize);
    this.cv?.remove(); this.cv = null; this.ctx = null; this.parts = []; this.sprites = [];
  }
}

/** A football that the stunt script throws around (simple physics, bounces on a floor line). */
export class Ball implements Sprite {
  x: number; y: number; vx = 0; vy = 0; g = 1500; r = 15; rot = 0; floor: number; alive = true; rolling = false; bounces = 0;
  constructor(x: number, y: number, floor: number) { this.x = x; this.y = y; this.floor = floor; }
  update(dt: number) {
    if (!this.alive) return false;
    if (!this.rolling) {
      this.vy += this.g * dt; this.x += this.vx * dt; this.y += this.vy * dt;
      if (this.y > this.floor - this.r && this.vy > 0) { this.y = this.floor - this.r; this.vy *= -.55; this.vx *= .85; this.bounces++; if (Math.abs(this.vy) < 90) this.vy = 0; }
    }
    this.rot += (this.vx / this.r) * dt;
    return this.alive && this.x > -200 && this.x < window.innerWidth + 200;
  }
  draw(c: CanvasRenderingContext2D) {
    const { x, y, r } = this;
    // shadow on the floor
    const h = Math.max(0, this.floor - (y + r)); c.globalAlpha = Math.max(.08, .3 - h / 900);
    c.fillStyle = '#1b1530'; c.beginPath(); c.ellipse(x, this.floor - 1, r * (1 - Math.min(.5, h / 600)), r * .28, 0, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
    c.translate(x, y); c.rotate(this.rot);
    const g = c.createRadialGradient(-r * .35, -r * .4, r * .1, 0, 0, r); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#cfd1dc');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#18181d';
    const pent = (cx: number, cy: number, s: number) => { c.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / 5; c.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s); } c.closePath(); c.fill(); };
    pent(0, 0, r * .38);
    c.save(); c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / 5 + Math.PI / 5; pent(Math.cos(a) * r * .95, Math.sin(a) * r * .95, r * .3); }
    c.restore();
    c.strokeStyle = '#9ea1b3'; c.lineWidth = 1; c.beginPath(); c.arc(0, 0, r - .5, 0, Math.PI * 2); c.stroke();
  }
}

/** A paper plane that glides across the screen with one loop-the-loop. */
export class Plane implements Sprite {
  t = 0; x: number; y: number; private x0: number; private y0: number; private trail: Array<{ x: number; y: number }> = []; ang = Math.PI;
  constructor(x: number, y: number, private fx: Fx) { this.x = this.x0 = x; this.y = this.y0 = y; }
  update(dt: number) {
    this.t += dt; const t = this.t, speed = 430;
    const px = this.x, py = this.y;
    // glide left with a gentle wave; loop once around the middle of the trip
    let x = this.x0 - speed * t, y = this.y0 - 90 * Math.min(1, t) + Math.sin(t * 3) * 28;
    const lt = 1.25, ld = 1.0;
    if (t > lt) { const u = Math.min(1, (t - lt) / ld), a = u * Math.PI * 2; x += speed * Math.min(t - lt, ld) * 1; x -= Math.sin(a) * 90; y -= (1 - Math.cos(a)) * 90; }
    this.x = x; this.y = y;
    this.ang = Math.atan2(y - py, x - px);
    if (Math.random() < .6) this.trail.push({ x, y });
    if (this.trail.length > 26) this.trail.shift();
    if (t > 1.2 && t < 2.3 && Math.random() < .15) this.fx.sparkle(x, y, 1);
    return x > -80 && t < 6;
  }
  draw(c: CanvasRenderingContext2D) {
    this.trail.forEach((p, i) => { c.globalAlpha = (i / this.trail.length) * .5; c.fillStyle = '#8b5cf6'; c.beginPath(); c.arc(p.x, p.y, 1.6, 0, Math.PI * 2); c.fill(); });
    c.globalAlpha = 1;
    c.translate(this.x, this.y); c.rotate(this.ang);
    c.fillStyle = '#ffffff'; c.strokeStyle = '#6b6f86'; c.lineWidth = 1.2; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(18, 0); c.lineTo(-14, -11); c.lineTo(-8, 0); c.lineTo(-14, 11); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#e4e2f2'; c.beginPath(); c.moveTo(18, 0); c.lineTo(-8, 0); c.lineTo(-12, 5); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(18, 0); c.lineTo(-8, 0); c.stroke();
  }
}
