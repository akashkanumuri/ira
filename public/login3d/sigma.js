// SIGMA 1 — sign-in scene: a 3D SIGMA 1 logo and the hoodie robot.
//  Intro     the letters drop in one by one with a bouncy squash; the robot zooms in carrying the "1",
//            drops it into place (dodging it) and hops on top.
//  Idle      sits on the "1", swings its legs, waves and watches the cursor. After a few quiet seconds it
//            does little gags (taps the G so it wobbles, polishes the hourglass).
//  Away      if nobody touches the page for a while it goes off to play: runs, trips, platform-jumps
//            across the letters, falls off the "1", bounces on the M. Any cursor move or key press and it
//            flies straight back to the "1".
//  Password  it "borrows" the Σ hourglass and holds it over its eyes; a faded ghost marks the gap.
//  Wrong     the "1" tips over and the robot catches it (sweat drop, red eyes); the other letters jump.
//  Success   the Σ spins into a portal and the robot dives in.
import { THREE, createStage, watchForm, damp } from './common.js';
import { buildHoodbot } from './hoodbot.js';

// ---------- logo artwork (original SIGMA 1 logo, measured in artwork px; 134 px = 1 unit tall)
const Z = (zx, zy) => [zx / 2 + 150, zy / 2 + 437];
const ART = {
  hgTop: [Z(20, 18), Z(282, 18), Z(151, 150)],
  hgBot: [Z(20, 282), Z(151, 150), Z(282, 282)],
  I: [Z(308, 18), Z(375, 18), Z(375, 280), Z(308, 280)],
  M: [Z(690, 280), Z(690, 18), Z(829, 152), Z(968, 18), Z(968, 280), Z(903, 280), Z(903, 170), Z(829, 238), Z(755, 170), Z(755, 280)],
  A: [Z(988, 280), Z(1119, 18), Z(1250, 280), Z(1175, 280), Z(1166, 262), Z(1074, 262), Z(1065, 280)],
  Ahole: [Z(1099, 200), Z(1141, 200), Z(1120, 158)],
  one: [Z(1370, 280), Z(1370, 103), Z(1320, 122), Z(1320, 62), Z(1432, 20), Z(1432, 280)],
};
const ARTX = 513, BASE = 579, U = 1 / 134;
const v2 = ([x, y]) => new THREE.Vector2((x - ARTX) * U, (BASE - y) * U);
function gShape() {
  const [cx, cy] = Z(535, 150); const c = v2([cx, cy]);
  const ro = 66.5 * U, ri = 32.5 * U, a0 = THREE.MathUtils.degToRad(42), a1 = THREE.MathUtils.degToRad(-17) + Math.PI * 2;
  const s = new THREE.Shape(); s.absarc(c.x, c.y, ro, a0, a1, false);
  const top = c.y + 10 * U, bot = c.y - 19 * U, l = c.x + 2 * U;
  s.lineTo(c.x + ro, bot); s.lineTo(c.x + ro, top); s.lineTo(l, top); s.lineTo(l, bot);
  s.lineTo(c.x + Math.cos(a1) * ri, c.y + Math.sin(a1) * ri); s.absarc(c.x, c.y, ri, a1, a0, true); s.closePath();
  return s;
}
const ease = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function mount({ container, frameEl, reduced = false }) {
  const S = createStage({ container, frameEl, transparent: true });
  const { scene, renderer } = S;
  S.frameMesh.visible = false; S.mask.visible = false;
  S.onLayout(() => { S.frameMesh.visible = false; S.mask.visible = false; });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;

  const world = new THREE.Group(); world.rotation.set(.1, -.14, 0); scene.add(world);

  // ---------- 3D letters (pivot at bottom-centre so they can hop, squash and tip)
  const black = new THREE.MeshPhysicalMaterial({ color: 0x0b0b10, roughness: .2, metalness: .25, clearcoat: 1, clearcoatRoughness: .06 });
  const ex = (shapes) => { const g = new THREE.ExtrudeGeometry(shapes, { depth: .26, bevelEnabled: true, bevelThickness: .025, bevelSize: .018, bevelSegments: 3, curveSegments: 40 }); g.translate(0, 0, -.13); return g; };
  const L = {};
  const phys = (home, w, h) => ({ home, w, h, vy: 0, y: 0, sq: 0, wob: 0, dropAt: 0 });
  const addLetter = (key, shapes) => {
    const g = ex(shapes); g.computeBoundingBox(); const b = g.boundingBox; const cx = (b.min.x + b.max.x) / 2;
    g.translate(-cx, -b.min.y, 0);
    const m = new THREE.Mesh(g, black); m.castShadow = m.receiveShadow = true; m.position.set(cx, b.min.y, 0);
    m.userData = phys(m.position.clone(), b.max.x - b.min.x, b.max.y - b.min.y);
    world.add(m); L[key] = m; return m;
  };
  addLetter('I', [new THREE.Shape(ART.I.map(v2))]);
  addLetter('G', [gShape()]);
  addLetter('M', [new THREE.Shape(ART.M.map(v2))]);
  { const a = new THREE.Shape(ART.A.map(v2)); a.holes.push(new THREE.Path(ART.Ahole.map(v2))); addLetter('A', [a]); }
  addLetter('one', [new THREE.Shape(ART.one.map(v2))]);
  // Σ hourglass (pivots at its waist) + a faded ghost that marks the gap when the robot borrows it
  const waist = v2(Z(151, 150));
  const hg = new THREE.Group(); hg.position.set(waist.x, waist.y, 0); world.add(hg);
  const ghost = new THREE.Group(); ghost.position.copy(hg.position); world.add(ghost);
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x0b0b10, transparent: true, opacity: 0, depthWrite: false });
  [ART.hgTop, ART.hgBot].forEach((pts) => {
    const g = ex([new THREE.Shape(pts.map(v2))]); g.translate(-waist.x, -waist.y, 0);
    const m = new THREE.Mesh(g, black); m.castShadow = true; hg.add(m); ghost.add(new THREE.Mesh(g, ghostMat));
  });
  hg.userData = phys(hg.position.clone(), (282 - 20) / 2 * U, 1);
  L.hg = hg;
  const keys = ['hg', 'I', 'G', 'M', 'A', 'one'];

  // floor that only shows shadows + soft spotlight following the cursor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.ShadowMaterial({ opacity: .18 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.002; floor.receiveShadow = true; world.add(floor);
  const soft = (rgba) => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, rgba); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); };
  const spotTex = soft('rgba(139,92,246,.22)'), whiteTex = soft('rgba(255,255,255,1)');
  const spot = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: spotTex, transparent: true, depthWrite: false }));
  spot.rotation.x = -Math.PI / 2; spot.position.y = .003; world.add(spot);

  world.add(new THREE.HemisphereLight(0xffffff, 0xb9b4d8, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(-2, 6, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(S.low ? 1024 : 2048, S.low ? 1024 : 2048); Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 4, bottom: -3, near: .5, far: 20 }); sun.shadow.radius = 5; sun.shadow.bias = -.0008;
  world.add(sun); world.add(sun.target);
  const fill = new THREE.DirectionalLight(0xffd2a8, .9); fill.position.set(4, 2, 3); world.add(fill);

  // ---------- background: slow-drifting soft Σ triangles and mini hourglasses
  const bg = new THREE.Group(); scene.add(bg);
  const triGeo = (() => { const s = new THREE.Shape([new THREE.Vector2(-.5, .43), new THREE.Vector2(.5, .43), new THREE.Vector2(0, -.43)]); return new THREE.ExtrudeGeometry(s, { depth: .12, bevelEnabled: true, bevelSize: .03, bevelThickness: .03, bevelSegments: 2 }); })();
  const pastel = [0xa78bfa, 0xf9a8d4, 0x9ca3af, 0x67e8f9, 0xc4b5fd];
  const floaters = [];
  for (let i = 0; i < (S.low ? 8 : 16); i++) {
    const mat = new THREE.MeshPhysicalMaterial({ color: pastel[i % pastel.length], roughness: .25, clearcoat: 1, transparent: true, opacity: .7 });
    let m;
    if (i % 3 === 0) { m = new THREE.Group(); const a = new THREE.Mesh(triGeo, mat); const b = new THREE.Mesh(triGeo, mat); b.rotation.z = Math.PI; b.position.y = -.86; m.add(a, b); }
    else m = new THREE.Mesh(triGeo, mat);
    m.userData = { x: Math.random(), y: Math.random(), z: -4 - Math.random() * 10, s: .3 + Math.random() * .8, sp: .02 + Math.random() * .04, r: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(.6), ph: Math.random() * 6 };
    bg.add(m); floaters.push(m);
  }

  // ---------- the robot (feet at y = 0, ~3.9 units tall before scaling)
  const R = buildHoodbot(); world.add(R.root);
  const RS = .34; R.root.scale.setScalar(RS);
  const SITY = -.92 * RS, Z_FRONT = .45;
  const r = R.root;
  const EYE = new THREE.Color(1.6, 1.15, 1.3), EYE_ERR = new THREE.Color(2.4, .35, .35);

  // effects: portal, confetti, sweat drop, dust/jet puffs, polish sparkle
  const portal = new THREE.Group(); world.add(portal); portal.visible = false;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.62, .035, 16, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8b5cf6).multiplyScalar(2.2), toneMapped: false })); portal.add(ring);
  const disk = new THREE.Mesh(new THREE.CircleGeometry(.6, 64), new THREE.MeshBasicMaterial({ color: 0x1b0b46, transparent: true, opacity: .9 })); disk.position.z = -.01; portal.add(disk);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: spotTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(3.4, 3.4, 1); portal.add(halo);
  const CF = 90, cfPos = new Float32Array(CF * 3), cfVel = [], cfCol = new Float32Array(CF * 3);
  const cfGeo = new THREE.BufferGeometry(); cfGeo.setAttribute('position', new THREE.BufferAttribute(cfPos, 3)); cfGeo.setAttribute('color', new THREE.BufferAttribute(cfCol, 3));
  [0x8b5cf6, 0xf472b6, 0x22d3ee, 0xfbbf24, 0x34d399].forEach((c, i) => { for (let k = i; k < CF; k += 5) { const col = new THREE.Color(c); cfCol.set([col.r, col.g, col.b], k * 3); } });
  for (let i = 0; i < CF; i++) cfVel.push(new THREE.Vector3());
  const confetti = new THREE.Points(cfGeo, new THREE.PointsMaterial({ size: .06, vertexColors: true, transparent: true, opacity: 0, depthWrite: false })); world.add(confetti);
  const drop = new THREE.Mesh(new THREE.SphereGeometry(.045, 16, 16), new THREE.MeshPhysicalMaterial({ color: 0x9be7ff, roughness: .05, clearcoat: 1, transparent: true, opacity: 0 })); drop.scale.y = 1.4; world.add(drop);
  const PUFF = 30, puffs = [];
  for (let i = 0; i < PUFF; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0 })); world.add(m); puffs.push({ m, life: 0, v: new THREE.Vector3() }); }
  let puffI = 0;
  const emitPuff = (p, spread = 0) => { const q = puffs[puffI++ % PUFF]; q.m.position.copy(p); q.life = 1; q.m.scale.setScalar(.6 + Math.random() * .6); q.v.set((Math.random() - .5) * spread, spread * .3, (Math.random() - .5) * spread * .5); };
  const dust = (n = 6) => { for (let i = 0; i < n; i++) emitPuff(new THREE.Vector3(r.position.x + (Math.random() - .5) * .2, .03, r.position.z + (Math.random() - .5) * .1), 1.2); };
  const sparkle = new THREE.Sprite(new THREE.SpriteMaterial({ map: whiteTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); world.add(sparkle);

  // ---------- layout: fit the logo into the panel
  S.onLayout(() => {
    const f = S.frame, logoW = (866 - 160) * U, wide = f.w > 480;
    const K = (f.w * (wide ? .74 : .78) * S.u) / logoW;
    world.scale.setScalar(K);
    world.position.copy(S.px(f.x + f.w / 2, f.y + f.h * (wide ? .64 : .8)));
  });
  S.layout();

  // ---------- spots
  const one = L.one;
  const top1 = () => new THREE.Vector3(one.userData.home.x + .06, one.userData.h + SITY, .1);
  const topOf = (k) => {
    if (k === 'hg') return new THREE.Vector3(hg.userData.home.x, hg.userData.home.y + .5, 0);
    if (k === 'M') return new THREE.Vector3(L.M.userData.home.x - L.M.userData.w * .36, L.M.userData.h, 0);
    return new THREE.Vector3(L[k].userData.home.x + (k === 'one' ? .06 : 0), L[k].userData.h, 0);
  };
  const ground = (x, z = Z_FRONT) => new THREE.Vector3(x, 0, z);
  const xOf = (k) => L[k].userData.home.x;

  // ---------- state
  const now = () => performance.now() / 1000;
  const st = {
    intro: reduced ? null : { t: 0, released: false },
    atOne: !!reduced, homing: false, lastActive: now(), nextGag: now() + 6,
    field: null, caret: null, hgK: 0, error: 0, success: 0, oneTip: 0, oneTipTarget: 0,
    carry: !reduced, bob: 0, sit: false, gagging: false, playing: false,
  };
  // the robot's pose targets; reset every frame, then whatever is running overrides them
  const P = {};
  const restPose = () => Object.assign(P, { aLx: 0, aLz: -.12, aRx: 0, aRz: .12, lLx: 0, lRx: 0, rigX: 0, rigZ: 0, ry: null, headX: null, headZ: 0, k: 10 });

  // tiny step queue for scripted movement
  const Q = []; let cur = null;
  const push = (...s) => Q.push(...s);
  const clearQ = () => { Q.length = 0; cur = null; st.gagging = false; st.playing = false; st.homing = false; };
  const call = (fn) => ({ update() { fn(); return true; } });
  const wait = (dur, pose) => ({ update(dt, T, t) { pose?.(T, t); return t >= dur; } });
  const hopTo = (toFn, { h = .5, dur = .6, fly = false, spin = 0, sit = false, land = true, face = true } = {}) => {
    let from, to;
    return {
      spinning: !!spin,
      init() { from = r.position.clone(); to = typeof toFn === 'function' ? toFn() : toFn.clone(); },
      update(dt, T, t) {
        const k = Math.min(1, t / dur), e = fly ? 1 - Math.pow(1 - k, 2.2) : ease(k);
        r.position.lerpVectors(from, to, e); r.position.y += Math.sin(Math.PI * k) * h;
        if (face && Math.abs(to.x - from.x) > .05) P.ry = Math.sign(to.x - from.x) * (fly ? .9 : 1.1);
        if (fly) { Object.assign(P, { rigX: .45, aLx: .7, aRx: .7, aLz: -.5, aRz: .5, lLx: .4, lRx: .2, k: 12 }); if (Math.random() < .7) emitPuff(new THREE.Vector3(r.position.x, r.position.y - .02, r.position.z - .05)); }
        else Object.assign(P, { aLz: -2.5, aRz: 2.5, lLx: .5, lRx: -.4, rigX: .15, k: 14 });
        if (spin) R.rig.rotation.x = spin * Math.PI * 2 * ease(k);
        if (sit && k > .7) { P.lLx = P.lRx = -1.2; }
        if (k >= 1) { if (spin) R.rig.rotation.x = 0; if (land) { R.rig.scale.set(1.15, .82, 1.15); if (!sit && to.y < .05) dust(5); } return true; }
        return false;
      },
    };
  };
  const runTo = (xFn, z = Z_FRONT, speed = 1.5) => {
    let tx;
    return {
      init() { tx = typeof xFn === 'function' ? xFn() : xFn; },
      update(dt, T) {
        const dx = tx - r.position.x, d = Math.sign(dx);
        r.position.x += d * Math.min(Math.abs(dx), speed * dt); r.position.z = damp(r.position.z, z, 6, dt); r.position.y = damp(r.position.y, 0, 12, dt);
        runPose(T, d);
        if (Math.random() < .08) emitPuff(new THREE.Vector3(r.position.x - d * .1, .02, r.position.z), .4);
        return Math.abs(dx) < .01;
      },
    };
  };
  const runPose = (T, d) => {
    const c = T * 15;
    Object.assign(P, { ry: d * 1.45, lLx: Math.sin(c) * .9, lRx: -Math.sin(c) * .9, aLx: -Math.sin(c) * .9, aRx: Math.sin(c) * .9, aLz: -.2, aRz: .2, rigX: .2, k: 22 });
    st.bob = Math.abs(Math.sin(c)) * .08;
  };
  const sitPose = (T) => {
    st.sit = true;
    Object.assign(P, { lLx: -1.25 + Math.sin(T * 3) * .28, lRx: -1.25 + Math.sin(T * 3 + 1.4) * .28, ry: -.2, k: 16 });
  };
  const goHome = () => {
    if (st.homing) return;
    clearQ(); st.homing = true; st.atOne = false;
    const far = r.position.distanceTo(top1()) > .5;
    push(hopTo(top1, { h: far ? .9 : .4, dur: far ? .75 : .45, fly: far, sit: true, land: false }), call(() => { st.atOne = true; st.homing = false; R.rig.scale.set(1.1, .88, 1.1); }));
  };

  // ---------- gags while you're idle on the page, antics when you're away
  const gagTapG = () => [
    call(() => { st.gagging = true; st.atOne = false; }),
    hopTo(() => ground(xOf('G') + .28, .42), { h: .6, dur: .6 }),
    wait(1.6, (T, t) => { Object.assign(P, { ry: -2.45, aRx: -1.5 + Math.sin(T * 18) * .3, aRz: -.1, k: 20 }); if (t > .3 && t < 1.1) L.G.userData.wob = 1; if (t > 1.15) Object.assign(P, { ry: -.3, aLz: -.9, aRz: .9, headZ: .25 }); }),
    hopTo(top1, { h: .6, dur: .6, sit: true, land: false }),
    call(() => { st.gagging = false; st.atOne = true; st.nextGag = now() + 7; }),
  ];
  const gagPolish = () => [
    call(() => { st.gagging = true; st.atOne = false; }),
    hopTo(() => ground(hg.userData.home.x + .32, .42), { h: .7, dur: .8 }),
    wait(2.2, (T, t) => {
      Object.assign(P, { ry: -2.5, aRx: -1.35 + Math.sin(T * 11) * .25, aRz: .15 + Math.cos(T * 11) * .3, aLx: -.4, k: 22 });
      if (t > 1.8) Object.assign(P, { ry: -.2, aRz: 2.6, aRx: 0 });
      const s = .5 + .5 * Math.sin(T * 9); sparkle.material.opacity = t < 1.9 ? s * .9 : 0;
      sparkle.position.set(hg.position.x + Math.sin(T * 3.1) * .18, hg.position.y + Math.cos(T * 2.3) * .3, .2); sparkle.scale.setScalar(.12 + s * .15);
    }),
    call(() => { sparkle.material.opacity = 0; }),
    hopTo(top1, { h: .9, dur: .8, sit: true, land: false }),
    call(() => { st.gagging = false; st.atOne = true; st.nextGag = now() + 7; }),
  ];
  const fromHome = () => (st.atOne ? [call(() => { st.atOne = false; }), hopTo(() => ground(xOf('one') + .5, .35), { h: .4, dur: .55 })] : []);
  const anticRunTrip = () => [
    ...fromHome(),
    runTo(() => xOf('M') + .1), runTo(() => xOf('I') + .2, Z_FRONT, 1.9),
    wait(1.9, (T, t) => {
      if (t < .3) { Object.assign(P, { rigX: 1.55, aLz: -2.6, aRz: 2.6, ry: -1.45, k: 14 }); r.position.x -= .6 * (1 / 60); if (t < .05) dust(3); }
      else if (t < 1.2) { Object.assign(P, { rigX: 1.55, ry: -1.45, aLz: -2.6, aRz: 2.6, lLx: Math.sin(T * 14) * .6, lRx: -Math.sin(T * 14) * .6, k: 20 }); if (t > .3 && t < .35) dust(8); }
      else Object.assign(P, { ry: 0, headZ: Math.sin(T * 24) * .3, k: 8 });
    }),
  ];
  const anticPlatform = () => [
    ...fromHome(),
    runTo(() => xOf('hg') - .7),
    ...['hg', 'I', 'G', 'M', 'A', 'one'].flatMap((k) => [hopTo(() => topOf(k), { h: .55, dur: .5 }), call(() => { L[k].userData.sq = .25; })]),
    hopTo(() => ground(xOf('one') + .75, .3), { h: .5, dur: .6, spin: 1 }),
    wait(.6, () => Object.assign(P, { ry: 0, aLz: -2.6, aRz: 2.6 })),
  ];
  const anticFallOff = () => [
    ...(st.atOne ? [call(() => { st.atOne = false; })] : [runTo(() => xOf('one') + .55, .3), hopTo(() => topOf('one'), { h: .6, dur: .55 })]),
    hopTo(() => topOf('one'), { h: .15, dur: .3 }),
    wait(.5, () => Object.assign(P, { ry: 1.45, lLx: Math.sin(now() * 14) * .5, lRx: -Math.sin(now() * 14) * .5 })),
    call(() => { r.position.x = topOf('one').x; }),
    { init() { this.x0 = r.position.x; }, update(dt, T, t) { r.position.x = this.x0 + Math.min(.2, t * .5); Object.assign(P, { ry: 1.45, aLz: -1.5 + Math.sin(T * 18) * 1.1, aRz: 1.5 + Math.sin(T * 18 + 3) * 1.1, rigZ: -.25 + Math.sin(T * 10) * .18, k: 24 }); return t > 1.4; } },
    hopTo(() => ground(xOf('one') + .75, .25), { h: .15, dur: .55, face: false }),
    wait(1.4, (T, t) => { Object.assign(P, { rigZ: t < 1 ? -1.5 : 0, ry: 0, lLx: t < 1 ? Math.sin(T * 16) * .5 : 0, lRx: t < 1 ? -Math.sin(T * 16) * .5 : 0, headZ: t > 1 ? Math.sin(T * 24) * .3 : 0, k: t < .2 ? 18 : 8 }); if (t < .03) dust(10); }),
  ];
  const anticTrampoline = () => [
    ...fromHome(),
    runTo(() => xOf('M') + .65), hopTo(() => topOf('M'), { h: .5, dur: .5 }),
    ...[.35, .65, 1.0].flatMap((h, i) => [call(() => { L.M.userData.sq = .3; }), hopTo(() => topOf('M'), { h, dur: .45 + h * .3, spin: i === 2 ? 1 : 0, face: false })]),
    call(() => { L.M.userData.sq = .35; }),
    wait(.7, () => Object.assign(P, { ry: 0, aLz: -2.7, aRz: 2.7, k: 14 })),
    hopTo(() => ground(xOf('M') + .1, Z_FRONT), { h: .4, dur: .5 }),
  ];
  const antics = [anticRunTrip, anticPlatform, anticFallOff, anticTrampoline];
  let lastAntic = -1;
  const nextAntic = () => { let i; do i = Math.floor(Math.random() * antics.length); while (i === lastAntic); lastAntic = i; st.playing = true; push(...antics[i]()); };

  const wake = () => {
    st.lastActive = now(); st.nextGag = st.lastActive + 6;
    if (st.intro || st.success || st.error) return;
    if (!st.atOne || st.gagging || st.playing) goHome();
  };
  let lastPX = null;
  const onMove = (e) => {
    if (lastPX && Math.hypot(e.clientX - lastPX.x, e.clientY - lastPX.y) > 6) wake();
    lastPX = { x: e.clientX, y: e.clientY };
  };
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('keydown', wake);

  const endIntro = () => {
    if (!st.intro) return;
    if (st.carry) { st.carry = false; one.userData.y = Math.max(0, one.position.y); one.userData.vy = 0; }
    keys.forEach((k) => { L[k].userData.dropAt = 0; }); st.intro = null;
  };
  let hopLetter = 0;
  const stopForm = watchForm((f, ev) => {
    st.field = f.field; st.caret = f.caret;
    if (ev === 'focus' || ev === 'input') wake();
    if (ev === 'input' && f.field !== 'password' && !st.intro) { const k = keys[1 + (hopLetter++ % 5)]; L[k].userData.vy = 2.4; }
    if ((ev === 'error' || ev === 'success') && st.intro) endIntro();
    if (ev === 'error' && !st.success) {
      clearQ(); st.error = 1; st.atOne = false; st.oneTipTarget = -.5;
      keys.filter((k) => k !== 'one').forEach((k, i) => setTimeout(() => { L[k].userData.vy = 3.2; }, 60 + i * 70));
      push(
        hopTo(() => new THREE.Vector3(xOf('one') + .82, 0, 0), { h: .35, dur: .38 }),
        wait(1.15, (T) => Object.assign(P, { ry: -1.45, aLx: -2.45, aRx: -2.45, aLz: 0, aRz: 0, rigX: -.12, lLx: .3, lRx: -.3, headZ: Math.sin(T * 26) * .2, k: 18 })),
        call(() => { st.oneTipTarget = 0; }),
        wait(.55, (T) => Object.assign(P, { ry: -1.45, aLx: -1.6, aRx: -1.6, rigX: .3, lLx: Math.sin(T * 16) * .5, lRx: -Math.sin(T * 16) * .5, k: 18 })),
        call(() => { st.error = 0; }),
        hopTo(top1, { h: .55, dur: .55, sit: true, land: false }),
        call(() => { st.atOne = true; st.lastActive = now(); }),
      );
    }
    if (ev === 'success') {
      clearQ(); st.success = 1; st.atOne = false; portal.visible = true; portal.scale.setScalar(.01);
      push(hopTo(() => new THREE.Vector3(hg.userData.home.x, hg.userData.home.y - .1, .35), { h: 1.1, dur: 1.0, fly: true }), { update(dt) { r.scale.setScalar(damp(r.scale.x, 0, 4, dt)); r.rotation.z += dt * 10; r.position.lerp(portal.position, 1 - Math.exp(-4 * dt)); return false; } });
      for (let i = 0; i < CF; i++) { cfPos.set([hg.userData.home.x, hg.userData.home.y, .3], i * 3); cfVel[i].set((Math.random() - .5) * 3.5, 1.5 + Math.random() * 3, (Math.random() - .3) * 1.5); }
      confetti.material.opacity = 1;
    }
  });

  // ---------- intro setup
  if (st.intro) {
    keys.forEach((k, i) => { const u = L[k].userData; if (k !== 'one') { u.y = 4.5; u.dropAt = .15 + i * .22; } });
    r.position.set(xOf('one') + 5.5, 1.8, 0);
  } else r.position.copy(top1());

  // ---------- animation
  const tmp = new THREE.Vector3(), gazeLocal = new THREE.Vector3(), held = new THREE.Vector3();
  const cr = () => container.getBoundingClientRect();
  let clock = 0;
  S.loop((dt, t) => {
    const T = now(); clock += dt;
    restPose(); st.sit = false; st.bob = 0;

    // background drift + parallax
    floaters.forEach((m, i) => {
      const u = m.userData;
      const sx = (u.x * 1.4 - .2) * S.W, sy = ((u.y + t * u.sp) % 1.2 - .1) * S.H;
      const p = S.px(sx, S.H - sy, u.z); m.position.set(p.x - bg.position.x + Math.sin(t * .4 + u.ph) * .3, p.y, u.z);
      m.rotation.set(u.r.x * t, u.r.y * t, u.r.z * t + u.ph); m.scale.setScalar((i % 3 === 0 ? .5 : 1) * u.s * 1.6 * Math.max(.6, S.frame.w / 800));
    });
    bg.position.x = damp(bg.position.x, S.pointer.x * -.6, 2, dt); bg.position.y = damp(bg.position.y, S.pointer.y * .4, 2, dt);
    world.rotation.y = damp(world.rotation.y, -.14 + S.pointer.x * .06, 2.5, dt);
    world.rotation.x = damp(world.rotation.x, .1 + S.pointer.y * .03, 2.5, dt);

    const c = cr();
    const useCaret = st.caret && st.field === 'email';
    gazeLocal.copy(S.px((useCaret ? st.caret.x : S.pointer.sx) - c.left, (useCaret ? st.caret.y : S.pointer.sy) - c.top, 3)); world.worldToLocal(gazeLocal);
    tmp.copy(S.px(S.pointer.sx - c.left, S.pointer.sy - c.top, 0)); world.worldToLocal(tmp);
    spot.position.x = damp(spot.position.x, THREE.MathUtils.clamp(tmp.x, -3.5, 3.5), 4, dt); spot.position.z = .6;

    // intro: letters drop one by one, robot zooms in carrying the "1"
    if (st.intro) {
      const it = st.intro; it.t += dt;
      const from = new THREE.Vector3(xOf('one') + 5.5, 1.8, 0), to = new THREE.Vector3(xOf('one'), .55, 0);
      if (it.t < 1.15) r.position.copy(from);
      else if (it.t < 2.35) {
        const k = Math.min(1, (it.t - 1.15) / 1.2), e = 1 - Math.pow(1 - k, 3);
        r.position.lerpVectors(from, to, e); r.position.y += Math.sin(k * Math.PI * 3) * .06 * (1 - k);
        Object.assign(P, { ry: -.9 * (1 - k), rigX: .35 * (1 - k), lLx: .4, lRx: .2, k: 10 });
        if (Math.random() < .8) emitPuff(new THREE.Vector3(r.position.x + .05, r.position.y, r.position.z - .05));
      } else if (!it.released) {
        it.released = true; st.carry = false; one.userData.y = r.position.y + 3.95 * RS + .02; one.userData.vy = 0;
        push(hopTo(() => ground(xOf('one') + .72, .3), { h: .25, dur: .4 }), wait(.55, () => Object.assign(P, { ry: -.9, aLz: -.6, aRz: .6, headZ: .2 })), hopTo(top1, { h: .5, dur: .55, sit: true, land: false }), call(() => { st.atOne = true; st.intro = null; st.lastActive = now(); st.nextGag = now() + 5; }));
      }
      if (st.carry) Object.assign(P, { aLz: -2.85, aRz: 2.85, aLx: 0, aRx: 0 });
    }

    // run the script, otherwise idle behaviour
    if (!cur && Q.length) { cur = Q.shift(); cur.t = 0; cur.init?.(); }
    if (cur) { cur.t += dt; if (cur.update(dt, T, cur.t)) cur = null; }
    else if (!st.intro && !st.success) {
      const quiet = T - st.lastActive;
      if (st.atOne) {
        const p = top1(); r.position.x = damp(r.position.x, p.x, 8, dt); r.position.y = damp(r.position.y, p.y, 8, dt); r.position.z = damp(r.position.z, p.z, 8, dt);
        sitPose(T);
        if (st.hgK < .5 && (T % 7) < 1.4) Object.assign(P, { aRz: 2.6 + Math.sin(T * 12) * .35 });
        if (quiet > 11) { st.atOne = false; nextAntic(); }
        else if (quiet > 4 && T > st.nextGag && st.field !== 'password') push(...pick([gagTapG, gagPolish])());
      } else if (!st.homing) {
        if (quiet > 11) nextAntic(); else goHome();
      }
    }
    if (st.atOne && !cur) sitPose(T);

    // borrowed hourglass over the eyes while the password field is active
    const hgWant = st.field === 'password' && st.atOne && !cur && !st.error && !st.success ? 1 : 0;
    st.hgK = damp(st.hgK, hgWant, hgWant ? 5 : 8, dt);
    if (st.hgK > .02) Object.assign(P, { aLx: -2.0 * st.hgK, aRx: -2.0 * st.hgK, aLz: .38 * st.hgK - .12 * (1 - st.hgK), aRz: -.38 * st.hgK + .12 * (1 - st.hgK), headX: .12 });

    // letters: drop-in, hops, squash, wobble, the "1" tipping
    keys.forEach((k) => {
      const m = L[k], u = m.userData;
      if (k === 'one' && st.carry) {
        R.root.updateMatrixWorld(); m.position.set(r.position.x, r.position.y + 3.95 * RS + .02, r.position.z); m.rotation.z = Math.sin(T * 8) * .05; return;
      }
      if (st.intro && clock < u.dropAt) { m.visible = false; return; }
      m.visible = true;
      u.vy -= (st.intro ? 24 : 18) * dt; u.y = Math.max(0, u.y + u.vy * dt);
      if (u.y === 0 && u.vy < 0) { if (u.vy < -1.5) { u.sq = Math.min(.42, -u.vy * .055); u.vy = -u.vy * .28; } else u.vy = 0; }
      u.sq = damp(u.sq, 0, 7, dt); u.wob = damp(u.wob, 0, 2.2, dt);
      const s = u.sq * Math.cos(T * 30) * .4 + u.sq;
      if (k === 'hg') {
        held.set(0, -.08, 1.55); R.head.localToWorld(held); world.worldToLocal(held);
        m.position.lerpVectors(new THREE.Vector3(u.home.x, u.home.y + u.y, 0), held, st.hgK);
        m.scale.set((1 + s * .5) * (1 - .62 * st.hgK), (1 - s * .6) * (1 - .62 * st.hgK), 1 - .62 * st.hgK);
        m.rotation.y = r.rotation.y * st.hgK; m.rotation.x = R.head.rotation.x * st.hgK;
        ghostMat.opacity = .13 * st.hgK; ghost.visible = st.hgK > .01;
      } else {
        m.position.y = u.home.y + u.y; m.position.x = u.home.x; m.position.z = 0;
        m.scale.set(1 + s * .5, 1 - s * .6, 1 + s * .2);
        m.rotation.z = k === 'G' ? Math.sin(T * 22) * .09 * u.wob : 0;
      }
    });
    st.oneTip = damp(st.oneTip, st.oneTipTarget, st.oneTipTarget ? 9 : 4, dt);
    if (!st.carry) one.rotation.z = st.oneTip + (st.error && st.oneTipTarget ? Math.sin(T * 30) * .02 : 0);
    if (st.success) { hg.rotation.y += dt * 14; portal.position.set(hg.userData.home.x, hg.userData.home.y, .35); portal.scale.setScalar(damp(portal.scale.x, 1, 3, dt)); ring.rotation.z += dt * 3; halo.material.opacity = .7 + Math.sin(T * 6) * .3; }

    // apply the pose
    const k = P.k;
    R.armL.rotation.x = damp(R.armL.rotation.x, P.aLx, k, dt); R.armL.rotation.z = damp(R.armL.rotation.z, P.aLz, k, dt);
    R.armR.rotation.x = damp(R.armR.rotation.x, P.aRx, k, dt); R.armR.rotation.z = damp(R.armR.rotation.z, P.aRz, k, dt);
    R.legL.rotation.x = damp(R.legL.rotation.x, P.lLx, k, dt); R.legR.rotation.x = damp(R.legR.rotation.x, P.lRx, k, dt);
    if (!(cur && cur.spinning)) R.rig.rotation.x = damp(R.rig.rotation.x, P.rigX, k * .8, dt);
    R.rig.rotation.z = damp(R.rig.rotation.z, P.rigZ, k * .8, dt);
    if (P.ry !== null) r.rotation.y = damp(r.rotation.y, P.ry, 9, dt);
    R.rig.scale.x = damp(R.rig.scale.x, 1, 10, dt); R.rig.scale.y = damp(R.rig.scale.y, 1, 10, dt); R.rig.scale.z = damp(R.rig.scale.z, 1, 10, dt);
    R.rig.position.y = damp(R.rig.position.y, st.bob + (st.sit ? Math.sin(T * 2.2) * .02 : 0), 20, dt);

    // head: look at the cursor / caret
    tmp.copy(gazeLocal).sub(r.position);
    const lookable = st.atOne || st.intro;
    const yaw = lookable ? THREE.MathUtils.clamp(Math.atan2(tmp.x, Math.max(.5, tmp.z + 2)) - r.rotation.y, -.7, .7) * (1 - st.hgK) : 0;
    const pitch = lookable ? THREE.MathUtils.clamp(-Math.atan2(tmp.y - .4, Math.max(.5, tmp.z + 2)), -.45, .35) : 0;
    R.head.rotation.y = damp(R.head.rotation.y, yaw, 6, dt);
    R.head.rotation.x = damp(R.head.rotation.x, P.headX ?? pitch * (1 - st.hgK), 6, dt);
    R.head.rotation.z = damp(R.head.rotation.z, st.error ? Math.sin(T * 26) * .18 : P.headZ, 10, dt);
    R.eyes.position.x = damp(R.eyes.position.x, THREE.MathUtils.clamp(yaw * .12, -.08, .08), 10, dt);
    const blink = (T % 3.7) < .12;
    R.eyeL.scale.y = R.eyeR.scale.y = damp(R.eyeL.scale.y, blink ? .12 : st.error ? 1.25 : 1, 30, dt);
    R.eyeMat.color.lerp(st.error ? EYE_ERR : EYE, 1 - Math.exp(-10 * dt));

    // puffs, sweat drop, confetti
    puffs.forEach((q) => { if (q.life <= 0) { q.m.material.opacity = 0; return; } q.life -= dt * 1.6; q.m.material.opacity = q.life * .75; q.m.scale.multiplyScalar(1 + dt * 1.5); q.m.position.addScaledVector(q.v, dt); q.m.position.y -= dt * .2; });
    drop.material.opacity = damp(drop.material.opacity, st.error ? .9 : 0, 8, dt);
    if (st.error) { R.head.getWorldPosition(tmp); world.worldToLocal(tmp); drop.position.set(tmp.x + .2, tmp.y + .22 - (T % 1) * .15, tmp.z + .12); }
    if (confetti.material.opacity > 0) {
      for (let i = 0; i < CF; i++) { const v = cfVel[i]; v.y -= 6 * dt; cfPos[i * 3] += v.x * dt; cfPos[i * 3 + 1] += v.y * dt; cfPos[i * 3 + 2] += v.z * dt; }
      cfGeo.attributes.position.needsUpdate = true; confetti.material.opacity = Math.max(0, confetti.material.opacity - dt * .5);
    }
  }, reduced, 1);

  return { dispose: () => { stopForm(); removeEventListener('pointermove', onMove); removeEventListener('keydown', wake); S.dispose(); } };
}
