// SIGMA 1 helper robot for the app pages — the same hoodie robot as the sign-in page (hoodbot.js),
// in a small transparent canvas that the page moves around. It hovers on amber thrusters, flies, points,
// reacts with moods, and plays gags when the page is quiet.
//
// mount({ container, reduced, onClick }) → { setMood, play, fly, setFacing, isBusy, dispose }
//   moods:   idle | happy | worried | sleepy | alert | think | point | wave | celebrate
//   actions: wave | celebrate | backflip | worried | yawn | knock | dance | spin | juggle | look | land | peek | stretch | moonwalk
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildHoodbot } from './hoodbot.js';

const AMBER = 0xff9a2e;

export function mount({ container, reduced = false, onClick = null }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const cv = renderer.domElement;
  cv.style.width = '100%'; cv.style.height = '100%'; cv.style.display = 'block'; cv.style.cursor = onClick ? 'pointer' : 'default';
  container.appendChild(cv);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 2.25, 12.2); camera.lookAt(0, 2.05, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b4d8, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(-3, 6, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffd2a8, .8); fill.position.set(4, 2, 3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xbfd0ff, 2.4); rim.position.set(3, 4, -5); scene.add(rim);

  // ---------- the robot (same model as the sign-in page)
  const R = buildHoodbot(); scene.add(R.root);
  const r = R.root;
  R.root.traverse((o) => {
    const m = o.material; if (!m || !m.isMeshPhysicalMaterial) return;
    if (m.flatShading === false && m.metalness >= .5 && m.roughness < .5) { m.roughness = Math.max(.18, m.roughness - .12); m.clearcoat = 1; m.clearcoatRoughness = .12; m.envMapIntensity = 1.4; }
    if (m.roughness < .1) { m.envMapIntensity = .6; m.clearcoat = 0; m.specularIntensity = .12; m.roughness = .05; } // face glass: no white glare when the head tips back
  });
  const eyeLight = new THREE.PointLight(0xff4f8b, .5, 2.5, 2); eyeLight.position.set(0, -1.1, 1.0); R.head.add(eyeLight); // pink spill on the hoodie, not on the glass
  const EYE = new THREE.Color(1.6, 1.15, 1.3);
  // softer eye halo at this small size (two additive halos would wash the whole screen out)
  for (const e of [R.eyeL, R.eyeR]) e.children.forEach((c) => { if (c.isSprite) { c.material.opacity = .16; c.scale.setScalar(.6); } });

  // ---------- effects
  const soft = (rgba) => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, rgba); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); };
  const glowTex = soft('rgba(255,255,255,1)');
  // thrusters under the sneakers
  const jets = [R.legL, R.legR].map((leg) => {
    const g = new THREE.Group(); g.position.set(0, -1.32, .1); leg.add(g);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff1d6, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); core.scale.set(.32, .5, 1); g.add(core);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: AMBER, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); flame.scale.set(.6, 1.1, 1); flame.position.y = -.25; g.add(flame);
    return { g, core, flame };
  });
  // soft shadow on the "floor"
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.1), new THREE.MeshBasicMaterial({ map: soft('rgba(20,10,50,1)'), transparent: true, depthWrite: false, opacity: .35 }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = .01; scene.add(contact);
  // puffs (thruster smoke / landing dust)
  const puffs = [];
  for (let i = 0; i < 26; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(.09, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0 })); scene.add(m); puffs.push({ m, life: 0, v: new THREE.Vector3() }); }
  let pi = 0;
  const puff = (p, v) => { const q = puffs[pi++ % puffs.length]; q.m.position.copy(p); q.v.copy(v); q.life = 1; q.m.scale.setScalar(.7 + Math.random() * .6); };
  // confetti
  const CF = 70, cfPos = new Float32Array(CF * 3), cfCol = new Float32Array(CF * 3), cfVel = Array.from({ length: CF }, () => new THREE.Vector3());
  const cfGeo = new THREE.BufferGeometry(); cfGeo.setAttribute('position', new THREE.BufferAttribute(cfPos, 3)); cfGeo.setAttribute('color', new THREE.BufferAttribute(cfCol, 3));
  [0x8b5cf6, 0xf472b6, 0x22d3ee, 0xfbbf24, 0x34d399].forEach((c, i) => { const col = new THREE.Color(c); for (let k = i; k < CF; k += 5) cfCol.set([col.r, col.g, col.b], k * 3); });
  const confetti = new THREE.Points(cfGeo, new THREE.PointsMaterial({ size: .16, vertexColors: true, transparent: true, opacity: 0, depthWrite: false })); scene.add(confetti);
  let cfLife = 0;
  const burst = () => { cfLife = 1; for (let i = 0; i < CF; i++) { cfPos.set([r.position.x, r.position.y + 3.4, 0], i * 3); cfVel[i].set((Math.random() - .5) * 6, 3 + Math.random() * 4, (Math.random() - .5) * 2); } };
  // sweat drop
  const drop = new THREE.Mesh(new THREE.SphereGeometry(.09, 14, 12), new THREE.MeshPhysicalMaterial({ color: 0x9be7ff, roughness: .05, clearcoat: 1, transparent: true, opacity: 0 })); drop.scale.y = 1.4; scene.add(drop);
  let dropT = -1;
  // Zzz
  const zTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#a78bfa'; g.font = '800 52px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('z', 32, 34); return new THREE.CanvasTexture(c); })();
  const zs = [0, 1, 2].map(() => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, opacity: 0, depthWrite: false })); s.scale.setScalar(.5); scene.add(s); return s; });
  // juggling balls
  const balls = [0xff4f8b, AMBER, 0x8b5cf6].map((c) => { const m = new THREE.Mesh(new THREE.SphereGeometry(.16, 18, 14), new THREE.MeshPhysicalMaterial({ color: c, roughness: .25, clearcoat: 1 })); m.visible = false; scene.add(m); return m; });

  // ---------- state
  const now = () => performance.now() / 1000;
  const st = { mood: 'idle', flying: false, dir: 0, facing: 0, action: null, look: { x: 0, y: 0 }, lastBlink: now(), blinkUntil: 0, landT: -1 };
  const P = {};
  const rest = () => Object.assign(P, { aLx: 0, aLz: -.12, aRx: 0, aRz: .12, lLx: 0, lRx: 0, rigX: 0, rigZ: 0, rigY: 0, headX: null, headY: null, headZ: 0, y: .35, ry: 0, eyeY: 1, eyeX: 1, eyeRot: 0, eyeDY: 0, k: 9 });
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const ease = (t) => t * t * (3 - 2 * t);

  // mood → resting pose (applied every frame before any action)
  const moodPose = (T) => {
    switch (st.mood) {
      case 'happy': P.eyeY = .5; P.eyeDY = .04; P.headZ = Math.sin(T * 2) * .06; break;
      case 'worried': P.eyeRot = .32; P.eyeY = .8; P.headX = .12; P.aLx = -.5; P.aRx = -.5; break;
      case 'sleepy': P.eyeY = .1; P.headX = .38; P.headZ = .12; P.y = .25; P.aLz = -.05; P.aRz = .05; break;
      case 'alert': P.eyeY = 1.25; P.eyeX = 1.2; P.headX = -.08; break;
      case 'think': P.eyeDY = .06; P.headZ = .14; P.headX = .04; P.aRx = -1.9; P.aRz = .55; break;
      case 'point': P.aLz = -1.45 - Math.sin(T * 5) * .05; P.aLx = -.15; P.headY = -.35; P.ry = -.25; break;
      case 'wave': P.aRz = 2.7; P.aRx = Math.sin(T * 9) * .3; P.eyeY = .5; break;
      case 'celebrate': P.aLz = -2.6; P.aRz = 2.6; P.eyeY = .5; break;
      default: break;
    }
  };

  // ---------- scripted actions: { dur, f(t, k, T) } — t seconds into it, k 0..1
  const ACTIONS = {
    wave: { dur: 2.2, f: (t, k, T) => { P.aRz = 2.7; P.aRx = Math.sin(T * 10) * .35; P.eyeY = .5; P.headZ = -.1; } },
    celebrate: { dur: 2.4, f: (t, k) => { const j = jump(t, .25, 1.15, .7); P.y += j; P.aLz = -2.6; P.aRz = 2.6; P.eyeY = .5; if (t > .25 && t < 1.15) P.rigX = -Math.PI * 2 * ease((t - .25) / .9); if (Math.abs(t - .7) < .02 && cfLife <= 0) burst(); } },
    backflip: { dur: 1.8, f: (t) => { const j = jump(t, .2, 1.0, .7); P.y += j; P.lLx = P.lRx = -.8 * Math.min(1, j); if (t > .2 && t < 1.0) P.rigX = -Math.PI * 2 * ease((t - .2) / .8); } },
    worried: { dur: 2.6, f: (t, k, T) => { P.eyeRot = .32; P.eyeY = .8; P.headZ = Math.sin(T * 14) * .08; P.aLx = -1.2; P.aRx = -1.2; P.aLz = -.4; P.aRz = .4; if (dropT < 0 && t < .1) dropT = 0; } },
    yawn: { dur: 2.6, f: (t, k) => { const s = Math.sin(Math.PI * k); P.aLz = -2.4 * s - .1; P.aRz = 2.4 * s + .1; P.headX = -.35 * s; P.eyeY = 1 - .9 * s; P.rigX = -.08 * s; } },
    stretch: { dur: 2.2, f: (t, k) => { const s = Math.sin(Math.PI * k); P.aLz = -2.9 * s; P.aRz = 2.9 * s; P.y += .2 * s; P.rigZ = Math.sin(k * Math.PI * 2) * .15; } },
    knock: { dur: 1.8, f: (t, k, T) => { P.rigX = .28; P.aRx = -1.55 + (t > .4 && t < 1.5 ? Math.max(0, Math.sin(T * 18)) * -.35 : 0); P.aRz = .2; P.headX = .1; P.eyeY = 1.15; P.y += .1; } },
    dance: { dur: 4.2, f: (t, k, T) => { P.rigZ = Math.sin(T * 7) * .22; P.ry = Math.sin(T * 3.5) * .5; P.aLz = -1.2 - Math.sin(T * 7) * .8; P.aRz = 1.2 - Math.sin(T * 7) * .8; P.headZ = Math.sin(T * 7 + 1) * .15; P.y += Math.abs(Math.sin(T * 7)) * .25; P.lLx = Math.max(0, Math.sin(T * 7)) * -.6; P.lRx = Math.max(0, -Math.sin(T * 7)) * -.6; P.eyeY = .5; } },
    spin: { dur: 2.0, f: (t, k) => { P.ry = Math.PI * 2 * ease(k); P.aLz = -1.4; P.aRz = 1.4; P.y += Math.sin(Math.PI * k) * .35; } },
    moonwalk: { dur: 3.2, f: (t, k, T) => { P.ry = -Math.PI / 2 * Math.min(1, t * 3) * (k < .9 ? 1 : (1 - k) * 10); P.lLx = Math.sin(T * 6) * .5; P.lRx = -Math.sin(T * 6) * .5; P.aLx = -Math.sin(T * 6) * .4; P.aRx = Math.sin(T * 6) * .4; P.rigX = -.08; } },
    look: { dur: 3.2, f: (t, k) => { P.headY = Math.sin(k * Math.PI * 2) * .7; P.headX = -.1; P.eyeDY = .02; } },
    land: { dur: .7, f: (t) => { const s = t < .25 ? t / .25 : 1 - (t - .25) / .45; P.y -= .25 * Math.max(0, s); P.lLx = P.lRx = -.4 * Math.max(0, s); P.aLz = -.6 * Math.max(0, s); P.aRz = .6 * Math.max(0, s); } },
    peek: { dur: 3.0, f: (t, k, T) => { P.rigZ = .45 * Math.sin(Math.PI * Math.min(1, k * 1.4)); P.headY = -.4; P.aLz = -1.3; P.aLx = Math.sin(T * 10) * .3; } },
    juggle: { dur: 4.5, f: (t, k, T) => { P.aLx = -1.3; P.aRx = -1.3; P.aLz = -.25; P.aRz = .25; P.headX = -.25; P.eyeDY = .04; juggling = t < 4.3; } },
  };
  function jump(t, t0, t1, h) { if (t < t0) return -.25 * (t / t0); if (t > t1) return -.2 * Math.max(0, 1 - (t - t1) / .3); const u = (t - t0) / (t1 - t0); return 4 * h * u * (1 - u); }
  let juggling = false;

  // ---------- pointer → head/eyes follow
  const onMove = (e) => {
    const b = cv.getBoundingClientRect();
    const dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height * .3);
    st.look.x = Math.max(-1, Math.min(1, dx / 500)); st.look.y = Math.max(-1, Math.min(1, dy / 400));
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  const onClickCv = () => onClick?.();
  cv.addEventListener('click', onClickCv);

  // ---------- size
  let W = 0, H = 0;
  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    if (w === W && h === H) return; W = w; H = h;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  // ---------- loop
  let raf = 0, last = now(), alive = true, hidden = document.hidden;
  const onVis = () => { hidden = document.hidden; if (!hidden && !raf) { last = now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVis);
  const tmp = new THREE.Vector3();

  function frame() {
    raf = 0;
    if (!alive) return;
    const T = now(), dt = Math.min(.05, T - last); last = T;
    rest();
    // hover bob on the thrusters (always a little afloat)
    P.y += reduced ? 0 : Math.sin(T * 2.2) * .08;
    if (st.mood !== 'idle') moodPose(T);
    if (st.flying) { P.lLx = -.55; P.lRx = -.25; P.rigX = .12; P.rigZ = -st.dir * .28; P.ry = st.dir * .55; P.aLz = -.55; P.aRz = .55; P.aLx = .35; P.aRx = .35; P.y += .5; }
    const a = st.action;
    if (a) { const t = T - a.t0, k = Math.min(1, t / a.def.dur); a.def.f(t, k, T); if (t >= a.def.dur) { st.action = null; juggling = false; } }
    P.ry += st.facing;
    // apply pose
    const k = P.k;
    R.armL.rotation.x = damp(R.armL.rotation.x, P.aLx, k, dt); R.armL.rotation.z = damp(R.armL.rotation.z, P.aLz, k, dt);
    R.armR.rotation.x = damp(R.armR.rotation.x, P.aRx, k, dt); R.armR.rotation.z = damp(R.armR.rotation.z, P.aRz, k, dt);
    R.legL.rotation.x = damp(R.legL.rotation.x, P.lLx, k, dt); R.legR.rotation.x = damp(R.legR.rotation.x, P.lRx, k, dt);
    const flipping = st.action && (st.action.name === 'celebrate' || st.action.name === 'backflip') && Math.abs(P.rigX) > .3;
    R.rig.rotation.x = flipping ? P.rigX : damp(R.rig.rotation.x, P.rigX, k * .8, dt);
    // flips turn around the body's middle, not the feet
    const th = flipping ? R.rig.rotation.x : 0;
    R.rig.position.y = 1.95 * (1 - Math.cos(th)); R.rig.position.z = -1.95 * Math.sin(th);
    R.rig.rotation.z = damp(R.rig.rotation.z, P.rigZ, k * .8, dt);
    r.position.y = damp(r.position.y, P.y, 10, dt);
    r.rotation.y = st.action?.name === 'spin' ? P.ry : damp(r.rotation.y, P.ry, 6, dt);
    const yaw = P.headY ?? st.look.x * .55, pitch = P.headX ?? st.look.y * .3;
    R.head.rotation.y = damp(R.head.rotation.y, yaw, 7, dt);
    R.head.rotation.x = damp(R.head.rotation.x, pitch, 7, dt);
    R.head.rotation.z = damp(R.head.rotation.z, P.headZ, 8, dt);
    // eyes: blink, mood shape, follow
    if (T - st.lastBlink > 3 + Math.random() * 3) { st.lastBlink = T; st.blinkUntil = T + .12; }
    const blink = T < st.blinkUntil && st.mood !== 'sleepy';
    const ey = blink ? .1 : P.eyeY;
    for (const [e, s] of [[R.eyeL, -1], [R.eyeR, 1]]) {
      e.scale.y = damp(e.scale.y, ey, 25, dt); e.scale.x = damp(e.scale.x, P.eyeX, 12, dt);
      e.rotation.z = damp(e.rotation.z, P.eyeRot * -s, 10, dt);
    }
    R.eyes.position.x = damp(R.eyes.position.x, st.look.x * .09, 8, dt);
    R.eyes.position.y = damp(R.eyes.position.y, -.06 + P.eyeDY + (-st.look.y * .05), 8, dt);
    R.eyeMat.color.copy(EYE);
    eyeLight.intensity = .5 * R.eyeL.scale.y;
    // thrusters: always a gentle glow, strong while flying or jumping
    const thrust = reduced ? 0 : st.flying ? 1 : Math.max(.25, Math.min(1, (r.position.y - .3) * 1.2));
    for (const j of jets) {
      const f = thrust * (.85 + Math.random() * .3);
      j.core.material.opacity = .9 * f; j.flame.material.opacity = .75 * f;
      j.flame.scale.set(.55 + f * .2, .7 + f * .9, 1);
      if (st.flying && Math.random() < .5) { j.g.getWorldPosition(tmp); puff(tmp, new THREE.Vector3((Math.random() - .5) * .6 + st.dir * 1.2, -1.5 - Math.random(), 0)); }
    }
    contact.material.opacity = .32 * Math.exp(-Math.max(0, r.position.y) * .5);
    contact.scale.setScalar(1 + r.position.y * .25);
    // puffs
    for (const q of puffs) { if (q.life <= 0) { q.m.material.opacity = 0; continue; } q.life -= dt * 1.6; q.m.position.addScaledVector(q.v, dt); q.m.scale.multiplyScalar(1 + dt * 1.5); q.m.material.opacity = Math.max(0, q.life) * .5; }
    // confetti
    if (cfLife > 0) { cfLife -= dt * .45; for (let i = 0; i < CF; i++) { cfVel[i].y -= 9 * dt; cfPos[i * 3] += cfVel[i].x * dt; cfPos[i * 3 + 1] += cfVel[i].y * dt; cfPos[i * 3 + 2] += cfVel[i].z * dt; } cfGeo.attributes.position.needsUpdate = true; confetti.material.opacity = Math.max(0, Math.min(1, cfLife * 2)); } else confetti.material.opacity = 0;
    // sweat drop
    if (dropT >= 0) { dropT += dt; R.head.localToWorld(tmp.set(.8, .6, .6)); drop.position.set(tmp.x, tmp.y - dropT * 1.6, tmp.z); drop.material.opacity = Math.max(0, 1 - dropT); if (dropT > 1.1) { dropT = -1; drop.material.opacity = 0; } }
    // Zzz while sleepy
    zs.forEach((z, i) => { if (st.mood !== 'sleepy') { z.material.opacity = 0; return; } const u = ((T * .45 + i / 3) % 1); R.head.localToWorld(tmp.set(.9, 1, .3)); z.position.set(tmp.x + u * .7, tmp.y + u * 1.4, tmp.z); z.scale.setScalar(.3 + u * .35); z.material.opacity = Math.sin(Math.PI * u) * .95; });
    // juggling
    balls.forEach((b, i) => {
      b.visible = juggling; if (!juggling) return;
      const u = ((T * .9 + i / 3) % 1), side = Math.floor((T * .9 + i / 3) % 2) ? 1 : -1;
      R.body.localToWorld(tmp.set(0, -.5, .9));
      b.position.set(tmp.x + side * (-.55 + 1.1 * u), tmp.y + Math.sin(Math.PI * u) * 1.6 + .2, tmp.z);
    });
    renderer.render(scene, camera);
    const busy = st.flying || st.action || cfLife > 0 || dropT >= 0 || puffs.some((q) => q.life > 0);
    if (!hidden) { if (busy || !reduced) raf = requestAnimationFrame(frame); }
  }
  raf = requestAnimationFrame(frame);

  return {
    setMood(m) { st.mood = m || 'idle'; },
    play(name) {
      const def = ACTIONS[name]; if (!def || reduced) return 0;
      st.action = { name, def, t0: now() };
      if (name === 'celebrate') cfLife = 0;
      if (!raf && !hidden) { last = now(); raf = requestAnimationFrame(frame); }
      return def.dur;
    },
    fly(on, dir = 0) { st.flying = !!on; st.dir = Math.max(-1, Math.min(1, dir)); if (!on && !reduced) this.play('land'); },
    setFacing(rad) { st.facing = rad; },
    isBusy() { return !!st.action || st.flying; },
    dispose() {
      alive = false; cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', onVis);
      cv.removeEventListener('click', onClickCv);
      scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
      pmrem.dispose(); renderer.dispose(); cv.remove();
    },
  };
}
