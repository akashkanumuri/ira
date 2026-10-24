// WARP PORTAL — the sign-in panel is a portal into a tunnel of time; workday cards fly out of it toward you.
// Typing speeds the warp up, the password field turns it "secure" cyan, a wrong password flashes red,
// and signing in jumps to warp speed.
import { THREE, RoundedBoxGeometry, createStage, radial, cardTexture, watchForm, damp, roundedRect } from './common.js';

const PAL = [0x8b5cf6, 0x6366f1, 0x22d3ee, 0x34d399, 0xf472b6];
const CARDS = [
  ['Checked in', '09:02 · on time', '#34d399'], ['Brand guidelines', '▶ 01:42:10', '#a78bfa'], ['Team brief', '11:30 · 25 min', '#38bdf8'],
  ['Progress check', 'On track · 70%', '#22d3ee'], ['Break', '42 of 60 min', '#fbbf24'], ['Draft 2 approved', 'first time ✓', '#34d399'],
  ['Client call', '15:00 · Delta Spaces', '#f472b6'], ['Effective today', '7h 48m · 97%', '#a78bfa'],
];

export function mount({ container, frameEl, reduced = false }) {
  const S = createStage({ container, frameEl, bg: 0x07070d, frameColor: 0x020206, bloom: 0.9, threshold: 0.9 });
  const { scene, camera } = S;
  const proj = (z) => (S.dist - z) / S.dist;

  // ---- tunnel loops (rebuilt on layout)
  const loops = new THREE.Group(); scene.add(loops);
  const N = 42, SPAN = 3.1;
  const loopMats = [];
  // ---- warp streaks
  const STREAKS = S.low ? 160 : 380;
  const sPos = new Float32Array(STREAKS * 6), sCol = new Float32Array(STREAKS * 6), sData = [];
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3)); sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  const streaks = new THREE.LineSegments(sGeo, S.inside(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })));
  scene.add(streaks);
  for (let i = 0; i < STREAKS; i++) {
    const c = new THREE.Color(PAL[i % PAL.length]).multiplyScalar(1.6);
    sData.push({ a: Math.random() * Math.PI * 2, r: .5 + Math.random() * 6, z: -150 + Math.random() * 150, len: 3 + Math.random() * 10 });
    sCol.set([c.r * .15, c.g * .15, c.b * .15, c.r, c.g, c.b], i * 6);
  }
  const core = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), S.inside(new THREE.MeshBasicMaterial({ map: radial('#b69cff'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  scene.add(core);
  // ---- glowing rim
  const rimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xa78bfa).multiplyScalar(1.6) });
  let rim = null;
  // ---- sparks around the portal (outside)
  const SP = S.low ? 120 : 320;
  const spGeo = new THREE.BufferGeometry(); const spPos = new Float32Array(SP * 3); const spCol = new Float32Array(SP * 3); const spData = [];
  for (let i = 0; i < SP; i++) { const c = new THREE.Color(PAL[i % PAL.length]).multiplyScalar(1.4); spCol.set([c.r, c.g, c.b], i * 3); spData.push({ a: Math.random() * 6.28, r: Math.random(), z: Math.random() * 6, s: .2 + Math.random() * .8 }); }
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3)); spGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 3));
  scene.add(new THREE.Points(spGeo, new THREE.PointsMaterial({ size: .05, vertexColors: true, transparent: true, opacity: .85, depthWrite: false })));

  // ---- flying cards
  const cardGeo = new RoundedBoxGeometry(4, 2, .3, 5, .16);
  const cards = [];
  const NC = S.low ? 5 : 8;
  for (let i = 0; i < NC; i++) {
    const edge = new THREE.MeshPhysicalMaterial({ color: 0x241d4a, metalness: .5, roughness: .25, clearcoat: 1, transparent: true });
    const face = new THREE.MeshPhysicalMaterial({ color: 0x2a2744, emissive: 0xffffff, emissiveIntensity: .9, roughness: .3, clearcoat: 1, transparent: true });
    const m = new THREE.Mesh(cardGeo, [edge, edge, edge, edge, face, edge]);
    m.scale.setScalar(.66); scene.add(m);
    cards.push({ m, edge, face, t: i / NC, speed: .11 + Math.random() * .05, idx: i, from: new THREE.Vector3(), to: new THREE.Vector3(), spin: new THREE.Euler() });
  }
  const setCard = (c, k) => {
    const [title, sub, accent] = CARDS[k % CARDS.length];
    c.face.map?.dispose(); const tex = cardTexture(title, sub, accent);
    c.face.map = tex; c.face.emissiveMap = tex; c.face.needsUpdate = true;
    c.edge.emissive = new THREE.Color(accent); c.edge.emissiveIntensity = .25;
    // exit point: just past a random edge of the portal, toward the viewer
    const f = S.frame, side = Math.random();
    let sx, sy;
    if (side < .4) { sx = f.x + f.w + 40 + Math.random() * 160; sy = f.y + 60 + Math.random() * (f.h - 120); }
    else if (side < .7) { sx = f.x + Math.random() * f.w; sy = f.y - 30 + Math.random() * 60; }
    else { sx = f.x + Math.random() * f.w; sy = f.y + f.h - 30 + Math.random() * 60; }
    if (f.w < 600) { sy = Math.random() < .5 ? f.y - 10 - Math.random() * 40 : f.y + f.h + 10 + Math.random() * 60; sx = f.x + 30 + Math.random() * (f.w - 60); }
    sx = Math.min(sx, S.W - 80); sy = Math.max(40, Math.min(sy, S.H - 40));
    const z = 4 + Math.random() * 4;
    c.to.copy(S.px(sx, sy, z));
    c.m.scale.setScalar(.66 * Math.max(.4, Math.min(1, f.h / 860)));
    const zf = -55; const jitter = 2.4;
    c.from.set(f.cx * proj(zf) + (Math.random() - .5) * jitter, f.cy * proj(zf) + (Math.random() - .5) * jitter, zf);
    c.spin.set((Math.random() - .5) * .9, (Math.random() - .5) * 1.2, (Math.random() - .5) * .4);
    c.k = k;
  };

  let next = 0;
  S.onLayout(() => {
    const f = S.frame;
    // rebuild loops for the new frame size
    loops.clear(); loopMats.length = 0;
    const pts = roundedRect(f.ww * .94, f.wh * .94, Math.min(1.6, f.ww * .1)).getPoints(64).map((p) => new THREE.Vector3(p.x, p.y, 0));
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    for (let i = 0; i < N; i++) {
      const mat = S.inside(new THREE.LineBasicMaterial({ color: new THREE.Color(PAL[i % PAL.length]), transparent: true, depthWrite: false }));
      loopMats.push(mat); const l = new THREE.LineLoop(g, mat); l.userData.i = i; loops.add(l);
    }
    if (rim) { scene.remove(rim); rim.geometry.dispose(); }
    const rp = roundedRect(f.ww, f.wh, Math.min(34 * S.u, f.ww / 2, f.wh / 2)).getPoints(160).map((p) => new THREE.Vector3(p.x + f.cx, p.y + f.cy, .02));
    rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp, true), 320, .018, 6, true), rimMat); scene.add(rim);
    core.position.set(f.cx * proj(-140), f.cy * proj(-140), -140);
    cards.forEach((c) => setCard(c, next++));
  });
  S.layout();

  // ---- interaction state
  let speed = 1, speedTarget = 1, flash = 0, shake = 0, tint = new THREE.Color(0xa78bfa), tintTarget = new THREE.Color(0xa78bfa);
  let warpOut = 0;
  const stop = watchForm((st, ev) => {
    if (ev === 'input') speedTarget = st.field === 'password' ? 1.6 : 3.2;
    if (ev === 'focus' || ev === 'blur') speedTarget = st.field === 'password' ? .7 : 1;
    tintTarget.set(st.field === 'password' ? 0x22d3ee : 0xa78bfa);
    if (ev === 'error') { flash = 1; shake = 1; tintTarget.set(0xf43f5e); setTimeout(() => tintTarget.set(0xa78bfa), 900); }
    if (ev === 'success') { warpOut = 1; speedTarget = 16; }
  });

  const tmp = new THREE.Vector3();
  S.loop((dt, t) => {
    const f = S.frame;
    speed = damp(speed, speedTarget, 2.5, dt);
    if (speedTarget > 1 && speedTarget < 10) speedTarget = damp(speedTarget, 1, 1.2, dt);
    tint.lerp(tintTarget, 1 - Math.exp(-4 * dt));
    rimMat.color.copy(tint).multiplyScalar(1.5 + flash * 2);
    flash = Math.max(0, flash - dt * 1.5); shake = Math.max(0, shake - dt * 1.8);
    if (S.bloomPass) S.bloomPass.strength = .9 + flash * .8 + warpOut * 1.4;

    // tunnel: loops stream toward the viewer
    const off = (t * 6 * speed) % SPAN;
    loops.children.forEach((l) => {
      const i = l.userData.i; const z = -1 - (i * SPAN) + off;
      const zz = z > -.5 ? z - N * SPAN : z;
      l.position.set(f.cx * proj(zz), f.cy * proj(zz), zz);
      l.rotation.z = Math.sin(t * .2 + i * .1) * .06 + i * .012;
      const depth = Math.min(1, -zz / (N * SPAN));
      l.material.opacity = Math.max(.06, 1 - depth) * (zz > -4 ? (-zz / 4) : 1);
      l.material.color.set(PAL[i % PAL.length]).lerp(tint, .25).multiplyScalar(1.5 - depth * 1.1);
    });
    // streaks
    for (let i = 0; i < STREAKS; i++) {
      const d = sData[i]; d.z += dt * 30 * speed; if (d.z > 2) d.z = -150;
      const z1 = d.z, z2 = d.z + d.len * Math.min(3, speed);
      const cx = Math.cos(d.a) * d.r, cy = Math.sin(d.a) * d.r * 1.2;
      sPos.set([f.cx * proj(z1) + cx, f.cy * proj(z1) + cy, z1, f.cx * proj(z2) + cx, f.cy * proj(z2) + cy, Math.min(z2, -.1)], i * 6);
    }
    sGeo.attributes.position.needsUpdate = true;
    // sparks orbiting the rim
    for (let i = 0; i < SP; i++) {
      const d = spData[i]; d.a += dt * .15 * d.s * speed;
      const ex = f.ww / 2 + .2 + d.r * 1.6, ey = f.wh / 2 + .2 + d.r * 1.6;
      spPos.set([f.cx + Math.cos(d.a) * ex, f.cy + Math.sin(d.a) * ey, d.z], i * 3);
    }
    spGeo.attributes.position.needsUpdate = true;
    // cards
    cards.forEach((c) => {
      c.t += dt * c.speed * Math.min(4, speed);
      if (c.t >= 1) { c.t = 0; setCard(c, next++); }
      const e = c.t < .6 ? .85 * (c.t / .6) ** 2 : .85 + .15 * ((c.t - .6) / .4); // long dive, then a slow drift outside the portal
      tmp.copy(c.from).lerp(c.to, e);
      c.m.position.copy(tmp);
      c.m.rotation.set(c.spin.x * e, c.spin.y * e, c.spin.z * e + Math.sin(t + c.idx) * .03);
      const out = tmp.z > 0;
      [c.edge, c.face].forEach((m) => { out ? S.outside(m) : S.inside(m); m.opacity = Math.min(1, c.t * 6) * (c.t > .93 ? (1 - c.t) / .07 : 1); });
    });
    core.material.opacity = .9 + Math.sin(t * 2) * .1;
    // camera: gentle parallax + error shake
    camera.position.x = damp(camera.position.x, S.pointer.x * .5 + Math.sin(t * 50) * shake * .25, 3, dt);
    camera.position.y = damp(camera.position.y, -S.pointer.y * .35, 3, dt);
    camera.lookAt(0, 0, 0);
  }, reduced);

  scene.add(new THREE.AmbientLight(0xffffff, .5));
  const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(-4, 6, 10); scene.add(dl);

  return { dispose: () => { stop(); S.dispose(); } };
}
