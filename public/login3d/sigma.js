// SIGMA 1 — sign-in scene. A 3D SIGMA 1 logo with the hoodie robot.
// Idle: the robot plays hide-and-seek behind the letters while soft shapes drift in the background.
// Move the cursor or start typing and it rockets onto the "1" and watches you.
// Password: it pulls its hood over its eyes (and the Σ hourglass flips).
// Wrong password: the "1" tips over and the robot pushes it back up.
// Success: the Σ hourglass spins into a portal and the robot dives in.
import { THREE, RoundedBoxGeometry, createStage, watchForm, damp } from './common.js';
import { buildHoodie } from './hoodie.js';

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

export function mount({ container, frameEl, reduced = false }) {
  const S = createStage({ container, frameEl, transparent: true });
  const { scene, camera, renderer } = S;
  S.frameMesh.visible = false; S.mask.visible = false;
  S.onLayout(() => { S.frameMesh.visible = false; S.mask.visible = false; });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;

  const world = new THREE.Group(); world.rotation.set(.1, -.14, 0); scene.add(world);

  // ---------- 3D letters (pivot at bottom-centre so they can hop and tip)
  const black = new THREE.MeshPhysicalMaterial({ color: 0x0b0b10, roughness: .2, metalness: .25, clearcoat: 1, clearcoatRoughness: .06 });
  const ex = (shapes) => { const g = new THREE.ExtrudeGeometry(shapes, { depth: .26, bevelEnabled: true, bevelThickness: .025, bevelSize: .018, bevelSegments: 3, curveSegments: 40 }); g.translate(0, 0, -.13); return g; };
  const L = {};
  const addLetter = (key, shapes) => {
    const g = ex(shapes); g.computeBoundingBox(); const b = g.boundingBox; const cx = (b.min.x + b.max.x) / 2;
    g.translate(-cx, -b.min.y, 0);
    const m = new THREE.Mesh(g, black); m.castShadow = m.receiveShadow = true; m.position.set(cx, b.min.y, 0);
    m.userData = { home: m.position.clone(), w: b.max.x - b.min.x, h: b.max.y - b.min.y, vy: 0, y: 0, rz: 0, vrz: 0 };
    world.add(m); L[key] = m; return m;
  };
  addLetter('I', [new THREE.Shape(ART.I.map(v2))]);
  addLetter('G', [gShape()]);
  addLetter('M', [new THREE.Shape(ART.M.map(v2))]);
  { const a = new THREE.Shape(ART.A.map(v2)); a.holes.push(new THREE.Path(ART.Ahole.map(v2))); addLetter('A', [a]); }
  addLetter('one', [new THREE.Shape(ART.one.map(v2))]);
  // Σ hourglass: two triangles that spin together around the waist
  const hg = new THREE.Group(); const waist = v2(Z(151, 150)); hg.position.set(waist.x, waist.y, 0); world.add(hg);
  [ART.hgTop, ART.hgBot].forEach((pts) => { const g = ex([new THREE.Shape(pts.map(v2))]); g.translate(-waist.x, -waist.y, 0); const m = new THREE.Mesh(g, black); m.castShadow = true; hg.add(m); });
  hg.userData = { w: (282 - 20) / 2 * U, h: 1, x: waist.x };
  L.hg = hg;
  const letterKeys = ['I', 'G', 'M', 'A', 'one'];

  // floor that only shows shadows
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.ShadowMaterial({ opacity: .18 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.002; floor.receiveShadow = true; world.add(floor);
  // soft spotlight on the floor that follows the cursor
  const spotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(139,92,246,.22)'); gr.addColorStop(1, 'rgba(139,92,246,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const spot = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: spotTex, transparent: true, depthWrite: false }));
  spot.rotation.x = -Math.PI / 2; spot.position.y = .003; world.add(spot);

  // lights live inside the world so shadows scale with it
  world.add(new THREE.HemisphereLight(0xffffff, 0xb9b4d8, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3); sun.position.set(-2, 6, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(S.low ? 1024 : 2048, S.low ? 1024 : 2048); Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 4, bottom: -3, near: .5, far: 20 }); sun.shadow.radius = 5; sun.shadow.bias = -.0008;
  world.add(sun); world.add(sun.target);
  const fill = new THREE.DirectionalLight(0xa78bfa, .8); fill.position.set(4, 2, 3); world.add(fill);

  // ---------- background: slow-drifting soft Σ triangles and mini hourglasses
  const bg = new THREE.Group(); scene.add(bg);
  const triGeo = (() => { const s = new THREE.Shape([new THREE.Vector2(-.5, .43), new THREE.Vector2(.5, .43), new THREE.Vector2(0, -.43)]); return new THREE.ExtrudeGeometry(s, { depth: .12, bevelEnabled: true, bevelSize: .03, bevelThickness: .03, bevelSegments: 2 }); })();
  const pastel = [0xa78bfa, 0xf9a8d4, 0x9ca3af, 0x67e8f9, 0xc4b5fd];
  const floaters = [];
  for (let i = 0; i < (S.low ? 8 : 16); i++) {
    const mat = new THREE.MeshPhysicalMaterial({ color: pastel[i % pastel.length], roughness: .25, clearcoat: 1, transparent: true, opacity: .7 });
    let m;
    if (i % 3 === 0) { m = new THREE.Group(); const a = new THREE.Mesh(triGeo, mat); const b = new THREE.Mesh(triGeo, mat); b.rotation.z = Math.PI; b.position.y = -.86; m.add(a, b); m.scale.setScalar(.5); }
    else m = new THREE.Mesh(triGeo, mat);
    m.userData = { x: Math.random(), y: Math.random(), z: -4 - Math.random() * 10, s: .3 + Math.random() * .8, sp: .02 + Math.random() * .04, r: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(.6), ph: Math.random() * 6 };
    bg.add(m); floaters.push(m);
  }

  // ---------- the robot
  const R = buildHoodie(); world.add(R.root);
  const RS = .42; R.root.scale.setScalar(RS);
  const FOOT = .92 * RS, SIT = .36 * RS;

  // portal + confetti for success; sweat drop for errors
  const portal = new THREE.Group(); world.add(portal); portal.visible = false;
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8b5cf6).multiplyScalar(2.2), toneMapped: false, transparent: true });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.62, .035, 16, 96), ringMat); portal.add(ring);
  const disk = new THREE.Mesh(new THREE.CircleGeometry(.6, 64), new THREE.MeshBasicMaterial({ color: 0x1b0b46, transparent: true, opacity: .9 })); disk.position.z = -.01; portal.add(disk);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: spotTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(3.4, 3.4, 1); portal.add(halo);
  const CF = 90, cfPos = new Float32Array(CF * 3), cfVel = [], cfCol = new Float32Array(CF * 3);
  const cfGeo = new THREE.BufferGeometry(); cfGeo.setAttribute('position', new THREE.BufferAttribute(cfPos, 3)); cfGeo.setAttribute('color', new THREE.BufferAttribute(cfCol, 3));
  [0x8b5cf6, 0xf472b6, 0x22d3ee, 0xfbbf24, 0x34d399].forEach((c, i) => { for (let k = i; k < CF; k += 5) { const col = new THREE.Color(c); cfCol.set([col.r, col.g, col.b], k * 3); } });
  for (let i = 0; i < CF; i++) cfVel.push(new THREE.Vector3());
  const confetti = new THREE.Points(cfGeo, new THREE.PointsMaterial({ size: .06, vertexColors: true, transparent: true, opacity: 0, depthWrite: false })); world.add(confetti);
  const drop = new THREE.Mesh(new THREE.SphereGeometry(.05, 16, 16), new THREE.MeshPhysicalMaterial({ color: 0x9be7ff, roughness: .05, clearcoat: 1, transparent: true, opacity: 0 })); drop.scale.y = 1.4; world.add(drop);
  // jet puffs when it flies
  const PUFF = 24, puffs = [];
  for (let i = 0; i < PUFF; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(.05, 10, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0 })); world.add(m); puffs.push({ m, life: 0 }); }
  let puffI = 0;
  const emitPuff = (p) => { const q = puffs[puffI++ % PUFF]; q.m.position.copy(p); q.life = 1; q.m.scale.setScalar(.6 + Math.random() * .6); };

  // ---------- layout: fit the logo into the panel
  let K = 1, logoW = 1;
  S.onLayout(() => {
    const f = S.frame;
    logoW = (866 - 160) * U;
    const wide = f.w > 480;
    K = (f.w * (wide ? .78 : .8) * S.u) / logoW;
    world.scale.setScalar(K);
    const base = S.px(f.x + f.w / 2, f.y + f.h * (wide ? .62 : .78));
    world.position.copy(base);
  });
  S.layout();

  // ---------- spots
  const top1 = () => { const u = L.one.userData; return new THREE.Vector3(L.one.position.x + .08, u.h + SIT, 0); };
  const HIDES = [
    { k: 'G', side: 1, at: () => new THREE.Vector3(L.G.position.x + L.G.userData.w * .5 + .02, FOOT, -.45) },
    { k: 'M', side: -1, at: () => new THREE.Vector3(L.M.position.x - L.M.userData.w * .5 - .02, FOOT, -.45) },
    { k: 'A', side: 0, at: () => new THREE.Vector3(L.A.position.x, FOOT, -.42) },
    { k: 'hg', side: 1, at: () => new THREE.Vector3(hg.position.x + .35, FOOT, -.45) },
    { k: 'I', side: -1, at: () => new THREE.Vector3(L.I.position.x - .14, FOOT, -.42) },
  ];

  // ---------- motion state
  const st = {
    mode: 'roam', // roam | hop | perch | fly | fallen | portal
    hideIdx: 0, hideUntil: 0,
    hop: null, // { from, to, t, dur, h, then }
    lastActive: -1e9, field: null, caret: null,
    hood: 0, hoodTarget: 0, flip: 0, flipTarget: 0,
    oneTip: 0, oneTipTarget: 0, error: 0, success: 0,
  };
  const now = () => performance.now() / 1000;
  const startHop = (to, { h = .5, dur = .6, then = 'roam', fly = false } = {}) => {
    st.hop = { from: R.root.position.clone(), to: to.clone(), t: 0, dur, h, then, fly };
    st.mode = 'hop';
  };
  // place at the first hiding spot
  R.root.position.copy(HIDES[0].at()); st.hideUntil = now() + 2.5;

  const wake = () => {
    st.lastActive = now();
    if (st.mode === 'roam' || (st.mode === 'hop' && st.hop?.then === 'roam')) startHop(top1(), { h: 1.1, dur: .8, then: 'perch', fly: true });
  };
  let lastPX = null;
  const onMove = (e) => {
    if (lastPX) { const d = Math.hypot(e.clientX - lastPX.x, e.clientY - lastPX.y); if (d > 6) wake(); }
    lastPX = { x: e.clientX, y: e.clientY };
  };
  addEventListener('pointermove', onMove, { passive: true });

  let hopLetter = 0;
  const stopForm = watchForm((f, ev) => {
    st.field = f.field; st.caret = f.caret;
    if (ev === 'focus' || ev === 'input') wake();
    if (ev === 'input' && f.field !== 'password') { const k = letterKeys[hopLetter++ % letterKeys.length]; L[k].userData.vy = 2.2; }
    st.hoodTarget = f.field === 'password' ? 1 : 0;
    st.flipTarget = f.field === 'password' ? Math.PI : 0;
    if (ev === 'error') {
      st.error = 1; st.oneTipTarget = -.62;
      if (st.mode === 'perch' || st.mode === 'hop') { const p = new THREE.Vector3(L.one.position.x + .55, FOOT, .28); startHop(p, { h: .25, dur: .45, then: 'push' }); }
      setTimeout(() => { st.oneTipTarget = 0; }, 900);
      setTimeout(() => { st.error = 0; if (st.mode === 'push') startHop(top1(), { h: .6, dur: .6, then: 'perch' }); }, 1700);
    }
    if (ev === 'success') {
      st.success = 1; portal.visible = true; portal.scale.setScalar(.01);
      const target = new THREE.Vector3(hg.position.x, hg.position.y, .3);
      startHop(target, { h: 1.2, dur: 1.0, then: 'portal', fly: true });
      for (let i = 0; i < CF; i++) { cfPos.set([hg.position.x, hg.position.y, .3], i * 3); cfVel[i].set((Math.random() - .5) * 3.5, 1.5 + Math.random() * 3, (Math.random() - .3) * 1.5); }
      confetti.material.opacity = 1;
    }
  });

  // ---------- animation
  const tmp = new THREE.Vector3(), gazeLocal = new THREE.Vector3();
  const cr = () => container.getBoundingClientRect();
  S.loop((dt, t) => {
    const T = now();
    // background drift + parallax
    floaters.forEach((m, i) => {
      const u = m.userData; const f = S.frame;
      const sx = (u.x * 1.4 - .2) * S.W, sy = ((u.y + t * u.sp) % 1.2 - .1) * S.H;
      const p = S.px(sx, S.H - sy, u.z); m.position.set(p.x - bg.position.x + Math.sin(t * .4 + u.ph) * .3, p.y, u.z);
      m.rotation.set(u.r.x * t, u.r.y * t, u.r.z * t + u.ph); m.scale.setScalar((i % 3 === 0 ? .5 : 1) * u.s * 1.6 * Math.max(.6, S.frame.w / 800));
    });
    bg.position.x = damp(bg.position.x, S.pointer.x * -.6, 2, dt); bg.position.y = damp(bg.position.y, S.pointer.y * .4, 2, dt);
    world.rotation.y = damp(world.rotation.y, -.14 + S.pointer.x * .06, 2.5, dt);
    world.rotation.x = damp(world.rotation.x, .1 + S.pointer.y * .03, 2.5, dt);

    // pointer → local gaze point and floor spotlight
    const c = cr();
    const gx = st.caret && st.field === 'email' ? st.caret.x : S.pointer.sx, gy = st.caret && st.field === 'email' ? st.caret.y : S.pointer.sy;
    gazeLocal.copy(S.px(gx - c.left, gy - c.top, 3)); world.worldToLocal(gazeLocal);
    tmp.copy(S.px(S.pointer.sx - c.left, S.pointer.sy - c.top, 0)); world.worldToLocal(tmp);
    spot.position.x = damp(spot.position.x, THREE.MathUtils.clamp(tmp.x, -3.5, 3.5), 4, dt); spot.position.z = .6;

    // letters: spring hops + the "1" tipping
    letterKeys.forEach((k) => {
      const m = L[k], u = m.userData;
      u.vy -= 18 * dt; u.y = Math.max(0, u.y + u.vy * dt); if (u.y === 0 && u.vy < 0) u.vy = u.vy < -1.5 ? -u.vy * .25 : 0;
      m.position.y = u.home.y + u.y; m.scale.set(1 + (u.y === 0 && u.vy !== 0 ? .06 : 0), 1, 1);
    });
    st.oneTip = damp(st.oneTip, st.oneTipTarget, st.oneTipTarget ? 7 : 4, dt);
    L.one.rotation.z = st.oneTip + (st.error && !st.oneTipTarget ? Math.sin(T * 30) * .03 : 0);
    if (st.error) { L.A.userData.vy = Math.max(L.A.userData.vy, st.oneTipTarget ? .8 : 0); }
    // hourglass flips while the password field is active; spins when signing in
    st.flip = damp(st.flip, st.flipTarget, 3, dt);
    hg.rotation.z = st.flip;
    if (st.success) { hg.rotation.y += dt * 14; portal.position.set(hg.position.x, hg.position.y, .35); portal.scale.setScalar(damp(portal.scale.x, 1, 3, dt)); ring.rotation.z += dt * 3; halo.material.opacity = .7 + Math.sin(T * 6) * .3; }

    // robot
    const r = R.root;
    if (st.mode === 'hop' && st.hop) {
      const h = st.hop; h.t = Math.min(1, h.t + dt / h.dur);
      const e = h.t < .5 ? 2 * h.t * h.t : 1 - Math.pow(-2 * h.t + 2, 2) / 2;
      r.position.lerpVectors(h.from, h.to, e); r.position.y += Math.sin(Math.PI * h.t) * h.h;
      r.rotation.y = damp(r.rotation.y, Math.atan2(h.to.x - h.from.x, 1.2) * .6, 8, dt);
      R.rig.rotation.x = damp(R.rig.rotation.x, h.fly ? .35 : .15, 8, dt);
      R.armL.rotation.z = damp(R.armL.rotation.z, h.fly ? -2.6 : -.9, 10, dt); R.armR.rotation.z = damp(R.armR.rotation.z, h.fly ? 2.6 : .9, 10, dt);
      R.legL.rotation.x = damp(R.legL.rotation.x, .5, 10, dt); R.legR.rotation.x = damp(R.legR.rotation.x, -.3, 10, dt);
      if (h.fly && Math.random() < .6) { tmp.copy(r.position); tmp.y -= FOOT * .9; emitPuff(tmp); }
      if (h.t >= 1) {
        st.hop = null; st.mode = h.then; R.rig.scale.set(1.12, .86, 1.12); // squash on landing
        if (h.then === 'roam') st.hideUntil = T + 2.5 + Math.random() * 2;
      }
    } else if (st.mode === 'roam') {
      const spotH = HIDES[st.hideIdx % HIDES.length];
      // crouch behind the letter and peek out sideways now and then
      const peek = Math.max(0, Math.sin(T * 1.3)) ;
      const base = spotH.at();
      r.position.x = damp(r.position.x, base.x + (spotH.side ? spotH.side * peek * .18 : 0), 5, dt);
      r.position.y = damp(r.position.y, base.y - (spotH.side === 0 ? .05 : .12) + (spotH.side === 0 ? peek * .25 : 0), 5, dt);
      r.position.z = damp(r.position.z, base.z, 5, dt);
      r.rotation.y = damp(r.rotation.y, spotH.side * .5, 4, dt);
      R.rig.rotation.x = damp(R.rig.rotation.x, 0, 6, dt);
      R.head.rotation.z = damp(R.head.rotation.z, spotH.side * peek * -.35, 6, dt);
      R.armL.rotation.z = damp(R.armL.rotation.z, -.15, 6, dt); R.armR.rotation.z = damp(R.armR.rotation.z, .15, 6, dt);
      R.legL.rotation.x = damp(R.legL.rotation.x, 0, 6, dt); R.legR.rotation.x = damp(R.legR.rotation.x, 0, 6, dt);
      if (T > st.hideUntil) { st.hideIdx = (st.hideIdx + 1 + Math.floor(Math.random() * 2)) % HIDES.length; startHop(HIDES[st.hideIdx].at(), { h: .55, dur: .65, then: 'roam' }); }
    } else if (st.mode === 'perch') {
      const p = top1(); r.position.x = damp(r.position.x, p.x, 8, dt); r.position.y = damp(r.position.y, p.y + Math.sin(T * 2) * .01, 8, dt); r.position.z = damp(r.position.z, .02, 8, dt);
      r.rotation.y = damp(r.rotation.y, -.2, 4, dt); R.rig.rotation.x = damp(R.rig.rotation.x, 0, 6, dt);
      // sitting: legs dangle and swing
      R.legL.rotation.x = -1.45 + Math.sin(T * 3) * .25; R.legR.rotation.x = -1.45 + Math.sin(T * 3 + 1.4) * .25;
      const covering = st.hood > .5;
      R.armL.rotation.set(damp(R.armL.rotation.x, covering ? -2.3 : 0, 8, dt), 0, damp(R.armL.rotation.z, covering ? -.55 : -.25, 8, dt));
      const wave = !covering && (T % 7) < 1.4 ? Math.sin(T * 12) * .35 : 0;
      R.armR.rotation.set(damp(R.armR.rotation.x, covering ? -2.3 : 0, 8, dt), 0, damp(R.armR.rotation.z, covering ? .55 : (wave ? 2.6 + wave : .25), 8, dt));
      if (T - st.lastActive > 12 && !st.field) { st.hideIdx = Math.floor(Math.random() * HIDES.length); startHop(HIDES[st.hideIdx].at(), { h: .7, dur: .75, then: 'roam' }); }
    } else if (st.mode === 'push') {
      r.rotation.y = damp(r.rotation.y, -1.2, 8, dt); R.rig.rotation.x = damp(R.rig.rotation.x, .25, 8, dt);
      R.armL.rotation.set(-1.5, 0, 0); R.armR.rotation.set(-1.5, 0, 0);
      R.legL.rotation.x = Math.sin(T * 14) * .4; R.legR.rotation.x = -Math.sin(T * 14) * .4;
    } else if (st.mode === 'portal') {
      r.scale.setScalar(damp(r.scale.x, 0, 4, dt)); r.rotation.z += dt * 10; r.position.lerp(portal.position, 1 - Math.exp(-4 * dt));
    }
    R.rig.scale.x = damp(R.rig.scale.x, 1, 10, dt); R.rig.scale.y = damp(R.rig.scale.y, 1, 10, dt); R.rig.scale.z = damp(R.rig.scale.z, 1, 10, dt);
    R.rig.position.y = st.mode === 'roam' || st.mode === 'perch' ? Math.sin(T * 2.2) * .02 : 0;

    // head: look at the cursor / caret (not while hiding the face)
    tmp.copy(gazeLocal).sub(r.position);
    const yaw = THREE.MathUtils.clamp(Math.atan2(tmp.x, Math.max(.5, tmp.z + 2)) - r.rotation.y, -.8, .8);
    const pitch = THREE.MathUtils.clamp(-Math.atan2(tmp.y - .4, Math.max(.5, tmp.z + 2)), -.5, .4);
    st.hood = damp(st.hood, st.hoodTarget, 6, dt);
    R.head.rotation.y = damp(R.head.rotation.y, st.mode === 'roam' ? R.head.rotation.y * .9 + yaw * .1 : yaw * (1 - st.hood), 6, dt);
    R.head.rotation.x = damp(R.head.rotation.x, pitch * (1 - st.hood) + st.hood * .25, 6, dt);
    if (st.mode !== 'roam') R.head.rotation.z = damp(R.head.rotation.z, st.error ? Math.sin(T * 26) * .25 : 0, 8, dt);
    R.hood.rotation.x = st.hood * .62; R.hood.position.y = .05 - st.hood * .12;
    R.eyes.position.x = damp(R.eyes.position.x, THREE.MathUtils.clamp(yaw * .12, -.08, .08), 10, dt);
    // blink + error eyes
    const blink = (T % 3.7) < .12;
    R.eyeL.scale.y = R.eyeR.scale.y = damp(R.eyeL.scale.y, blink ? .15 : st.error ? 1.25 : 1, 30, dt);
    R.eyeMat.color.setRGB(...(st.error ? [1, .12, .12] : [1, .42, .58]));

    // puffs, sweat drop, confetti
    puffs.forEach((q) => { if (q.life <= 0) { q.m.material.opacity = 0; return; } q.life -= dt * 1.6; q.m.material.opacity = q.life * .8; q.m.scale.multiplyScalar(1 + dt * 1.5); q.m.position.y -= dt * .3; });
    drop.material.opacity = damp(drop.material.opacity, st.error ? .9 : 0, 8, dt);
    if (st.error) { R.head.getWorldPosition(tmp); world.worldToLocal(tmp); drop.position.set(tmp.x + .22, tmp.y + .25 - (T % 1) * .15, tmp.z + .1); }
    if (confetti.material.opacity > 0) {
      for (let i = 0; i < CF; i++) { const v = cfVel[i]; v.y -= 6 * dt; cfPos[i * 3] += v.x * dt; cfPos[i * 3 + 1] += v.y * dt; cfPos[i * 3 + 2] += v.z * dt; }
      cfGeo.attributes.position.needsUpdate = true; confetti.material.opacity = Math.max(0, confetti.material.opacity - dt * .5);
    }
  }, reduced, 1);

  return { dispose: () => { stopForm(); removeEventListener('pointermove', onMove); S.dispose(); } };
}
