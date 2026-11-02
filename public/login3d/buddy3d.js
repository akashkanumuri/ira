// SIGMA 1 helper robot for the app pages — the same hoodie robot as the sign-in page (hoodbot.js),
// in a small transparent canvas that the page moves around. It hovers on amber thrusters, flies, points,
// reacts with moods, and plays gags when the page is quiet.
//
// mount({ container, reduced, onClick }) → { setMood, play, fly, setDir, setFacing, pose, prop, setZoom, isBusy, dispose }
//   moods:   idle | happy | worried | sleepy | alert | think | point | wave | celebrate
//   actions: wave | celebrate | backflip | worried | yawn | knock | dance | spin | juggle | look | land | peek | stretch | moonwalk
//            header | kick | throw | ollie | boo | startle | facepalm | victory | squash | dizzy | annoyed | sip | munch | party | dj | bye | explode
//   poses (held until cleared): surf | wipe | hang | dangle | lean
//   props:   board | sponge | mug | sandwich | hat | backpack | deck
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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
  const puff = (p, v, color = 0xffffff, size = 1) => { const q = puffs[pi++ % puffs.length]; q.m.position.copy(p); q.v.copy(v); q.life = 1; q.m.material.color.setHex(color); q.m.scale.setScalar((.7 + Math.random() * .6) * size); };
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


  // ---------- props (hidden until a stunt needs them)
  const mat = (c, o = {}) => new THREE.MeshPhysicalMaterial({ color: c, roughness: .5, ...o });
  const stripes = (cols, n = 8) => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(0, i * 128 / n, 128, 128 / n + 1); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const props = {};
  const hold = new THREE.Group(); hold.position.set(0, -1.22, .2); R.armR.add(hold); // in the right hand
  { // hoverboard under the sneakers
    const g = new THREE.Group(); g.position.y = -.12; R.rig.add(g);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, .14, 40), mat(0x1d1d24, { roughness: .3, clearcoat: 1 })); deck.scale.set(1.3, 1, .55); g.add(deck);
    const rimL = new THREE.Mesh(new THREE.TorusGeometry(1, .04, 8, 64), new THREE.MeshBasicMaterial({ color: AMBER })); rimL.rotation.x = Math.PI / 2; rimL.scale.set(1.3, .55, 1); g.add(rimL);
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: AMBER, transparent: true, opacity: .85, depthWrite: false, blending: THREE.AdditiveBlending })); gl.scale.set(3.2, .8, 1); gl.position.y = -.3; g.add(gl);
    props.board = g;
  }
  { // sponge for cleaning the screen
    const g = new THREE.Group(); hold.add(g);
    g.add(new THREE.Mesh(new RoundedBoxGeometry(.42, .3, .24, 3, .07), mat(0xffd34d, { roughness: .9 })));
    for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(.06 + Math.random() * .05, 10, 8), mat(0xffffff, { roughness: .1, transmission: .6, transparent: true, opacity: .9 })); b.position.set((Math.random() - .5) * .4, (Math.random() - .5) * .25, .14); g.add(b); }
    props.sponge = g;
  }
  { // coffee mug (upright when the arm points forward)
    const g = new THREE.Group(); g.rotation.x = Math.PI / 2; hold.add(g);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(.19, .16, .36, 28), mat(0x8b5cf6, { roughness: .35, clearcoat: 1 })); g.add(cup);
    const coffee = new THREE.Mesh(new THREE.CylinderGeometry(.165, .165, .02, 24), mat(0x4a2c1a, { roughness: .2 })); coffee.position.y = .16; g.add(coffee);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(.1, .03, 8, 20), mat(0x8b5cf6, { roughness: .35 })); handle.position.x = .22; g.add(handle);
    props.mug = g;
  }
  { // sandwich
    const g = new THREE.Group(); g.rotation.x = Math.PI / 2; hold.add(g);
    const bread = mat(0xe8b66a, { roughness: .9 });
    const b1 = new THREE.Mesh(new RoundedBoxGeometry(.5, .08, .4, 2, .03), bread); b1.position.y = -.08; g.add(b1);
    const let1 = new THREE.Mesh(new RoundedBoxGeometry(.56, .04, .44, 2, .015), mat(0x4ade80, { roughness: .7 })); g.add(let1);
    const tom = new THREE.Mesh(new RoundedBoxGeometry(.48, .04, .36, 2, .015), mat(0xef4444, { roughness: .5 })); tom.position.y = .04; g.add(tom);
    const b2 = new THREE.Mesh(new RoundedBoxGeometry(.5, .08, .4, 2, .03), bread); b2.position.y = .1; g.add(b2);
    props.sandwich = g;
  }
  { // party hat
    const g = new THREE.Group(); g.position.set(.18, 1.12, .05); g.rotation.z = -.22; R.head.add(g);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(.4, .85, 28, 1, true), new THREE.MeshStandardMaterial({ map: stripes(['#ff4f8b', '#fbbf24', '#8b5cf6', '#22d3ee'], 8), roughness: .6, side: THREE.DoubleSide })); cone.position.y = .42; g.add(cone);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(.11, 14, 10), mat(0xfbbf24, { roughness: .9 })); pom.position.y = .88; g.add(pom);
    props.hat = g;
  }
  { // backpack for going home
    const g = new THREE.Group(); g.position.set(0, -.02, -.62); R.body.add(g);
    g.add(new THREE.Mesh(new RoundedBoxGeometry(1.05, 1.0, .46, 4, .14), mat(0x6d28d9, { roughness: .6 })));
    const pocket = new THREE.Mesh(new RoundedBoxGeometry(.7, .4, .12, 3, .05), mat(0x5b21b6, { roughness: .6 })); pocket.position.set(0, -.18, -.26); g.add(pocket);
    const zipB = new THREE.Mesh(new THREE.BoxGeometry(.72, .03, .02), new THREE.MeshBasicMaterial({ color: AMBER })); zipB.position.set(0, .04, -.33); g.add(zipB);
    for (const s of [-1, 1]) { const strap = new THREE.Mesh(new RoundedBoxGeometry(.1, .9, .05, 2, .02), mat(0x4c1d95, { roughness: .6 })); strap.position.set(.36 * s, .02, 1.07); g.add(strap); }
    props.backpack = g;
  }
  { // DJ deck in front of the robot
    const g = new THREE.Group(); g.position.set(0, .95, 1.25); R.root.add(g);
    g.add(new THREE.Mesh(new RoundedBoxGeometry(2.5, .42, 1.0, 3, .08), mat(0x18181d, { roughness: .35, clearcoat: 1 })));
    const discTex = stripes(['#222228', '#3a3a44'], 6);
    const discs = [-.62, .62].map((x) => { const d = new THREE.Mesh(new THREE.CylinderGeometry(.36, .36, .05, 32), new THREE.MeshStandardMaterial({ map: discTex, roughness: .4 })); d.position.set(x, .24, 0); g.add(d); return d; });
    for (let i = 0; i < 5; i++) { const led = new THREE.Mesh(new THREE.BoxGeometry(.08, .03, .05), new THREE.MeshBasicMaterial({ color: [0xff4f8b, AMBER, 0x8b5cf6, 0x22d3ee, 0x34d399][i] })); led.position.set(-.24 + i * .12, .22, .38); g.add(led); }
    g.userData.discs = discs;
    props.deck = g;
  }
  for (const k in props) props[k].visible = false;
  const held = {}; // props switched on from outside (e.g. the Friday party hat)
  // dizzy stars
  const starTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#fbbf24'; g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 12 : 28; g.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr); } g.closePath(); g.fill(); return new THREE.CanvasTexture(c); })();
  const stars = [0, 1, 2].map(() => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, opacity: 0, depthWrite: false })); s.scale.setScalar(.42); scene.add(s); return s; });
  let dizzy = false;
  // explode: the parts fly apart and snap back together
  const parts = [R.head, R.armL, R.armR, R.legL, R.legR, R.body, R.ears[0], R.ears[1]].map((o) => ({ o, base: o.position.clone(), dir: new THREE.Vector3(), spin: new THREE.Vector3(), applied: new THREE.Vector3() }));
  let boom = -1;

  // ---------- state
  const now = () => performance.now() / 1000;
  const st = { mood: 'idle', flying: false, dir: 0, facing: 0, action: null, pose: null, zoom: 1, look: { x: 0, y: 0 }, lastBlink: now(), blinkUntil: 0, landT: -1 };
  const P = {};
  const rest = () => Object.assign(P, { aLx: 0, aLz: -.12, aRx: 0, aRz: .12, lLx: 0, lRx: 0, rigX: 0, rigZ: 0, rigY: 0, headX: null, headY: null, headZ: 0, y: .35, ry: 0, eyeY: 1, eyeX: 1, eyeRot: 0, eyeDY: 0, sq: 0, k: 9 });
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
    header: { dur: .5, f: (t, k) => { const s = Math.sin(Math.PI * k); P.headX = -.6 * s; P.y += .3 * s; P.eyeY = 1.25; P.aLz = -.7; P.aRz = .7; } },
    kick: { dur: .85, f: (t, k) => { P.lRx = k < .35 ? .55 * ease(k / .35) : k < .55 ? .55 - 2.2 * ease((k - .35) / .2) : -1.65 * (1 - ease((k - .55) / .45)); P.aLz = -.9; P.aRz = .9; P.aRx = .4; P.rigX = -.12 * Math.sin(Math.PI * k); P.eyeY = 1.2; } },
    throw: { dur: 1.0, f: (t, k) => { if (k < .4) { const u = ease(k / .4); P.aRz = 2.3 * u; P.aRx = .7 * u; } else if (k < .6) { const u = ease((k - .4) / .2); P.aRz = 2.3 - 1.7 * u; P.aRx = .7 - 2.5 * u; } else { const u = ease((k - .6) / .4); P.aRz = .6 - .5 * u; P.aRx = -1.8 * (1 - u); } P.headY = -.35; P.rigZ = .1 * Math.sin(Math.PI * k); } },
    ollie: { dur: .9, f: (t) => { const j = jump(t, .1, .7, .7); P.y += j; P.lLx = P.lRx = -.5 * Math.min(1, Math.max(0, j)); P.rigX = .15 * Math.max(0, j); } },
    boo: { dur: 1.5, f: (t) => { P.y += Math.max(0, jump(t, 0, .45, .45)); P.aLz = -2.3; P.aRz = 2.3; P.aLx = -.7; P.aRx = -.7; P.eyeY = 1.5; P.eyeX = 1.3; P.headX = -.12; } },
    startle: { dur: 1.4, f: (t, k) => { P.y += jump(t, 0, .55, 1.0); const s = k < .6 ? 1 : 1 - (k - .6) / .4; P.aLz = -2.7 * s - .1; P.aRz = 2.7 * s + .1; P.eyeY = 1 + .5 * s; P.eyeX = 1 + .3 * s; P.lLx = -.6 * s; P.lRx = .3 * s; if (t < .05 && dropT < 0) dropT = 0; } },
    facepalm: { dur: 3.0, f: (t, k, T) => { const s = Math.min(1, t / .4) * (t > 2.6 ? Math.max(0, (3 - t) / .4) : 1); P.aRx = -2.45 * s; P.aRz = .12 + .6 * s; P.headX = .35 * s; P.headY = Math.sin(T * 3.5) * .22 * s; P.eyeY = 1 - .7 * s; P.y -= .05 * s; } },
    victory: { dur: 2.2, f: (t, k, T) => { P.y += Math.max(0, jump(t, .1, .7, .55)); P.aRz = 2.8; P.aRx = -.2 + Math.sin(T * 12) * .25; P.aLz = -.4; P.eyeY = .5; if (Math.abs(t - .35) < .02 && cfLife <= 0) burst(); } },
    squash: { dur: .35, f: (t, k) => { P.sq = .28 * Math.sin(Math.PI * k); P.k = 30; } },
    dizzy: { dur: 2.8, f: (t, k, T) => { P.headZ = Math.sin(T * 6) * .2; P.headX = Math.cos(T * 6) * .1; P.eyeRot = Math.sin(T * 9) * 1.6; P.eyeY = .85; P.rigZ = Math.sin(T * 3) * .12; P.aLz = -.35 + Math.sin(T * 5) * .2; P.aRz = .35 - Math.sin(T * 5) * .2; dizzy = t < 2.6; } },
    annoyed: { dur: 1.8, f: (t, k, T) => { P.eyeY = .45; P.eyeRot = -.38; P.headY = Math.sin(T * 16) * .25; P.aLz = -.55; P.aRz = .55; P.aLx = .55; P.aRx = .55; P.lRx = Math.max(0, Math.sin(T * 12)) * -.4; } },
    sip: { dur: 4.0, props: ['mug'], f: (t, k, T) => { const up = Math.min(1, t / .5) * (t > 3.5 ? Math.max(0, (4 - t) / .5) : 1); const sp = t > 1.2 && t < 2.8 ? Math.sin(Math.PI * (t - 1.2) / 1.6) : 0; P.aRx = -1.35 * up - .95 * sp; P.aRz = .3 * up; P.headX = -.2 * sp; P.eyeY = sp > .3 ? .2 : .55; if (Math.random() < .12) { hold.getWorldPosition(tmp); puff(tmp.add(new THREE.Vector3(0, .35, 0)), new THREE.Vector3((Math.random() - .5) * .2, .6 + Math.random() * .3, 0), 0xffffff, .55); } } },
    munch: { dur: 4.4, props: ['sandwich'], f: (t, k, T) => { const up = Math.min(1, t / .5) * (t > 3.9 ? Math.max(0, (4.4 - t) / .5) : 1); const bite = [1.0, 1.9, 2.8].reduce((a, b0) => Math.max(a, t > b0 && t < b0 + .45 ? Math.sin(Math.PI * (t - b0) / .45) : 0), 0); P.aRx = -1.4 * up - .9 * bite; P.aRz = .3 * up; P.headX = .12 * bite; P.eyeY = .5; if (bite > .9 && Math.random() < .5) { hold.getWorldPosition(tmp); puff(tmp, new THREE.Vector3((Math.random() - .5) * .8, -1.2, .3), 0xc58a3d, .35); } } },
    party: { dur: 4.2, props: ['hat'], f: (t, k, T) => { ACTIONS.dance.f(t, k, T); if (t < .05 && cfLife <= 0) burst(); } },
    dj: { dur: 6.0, props: ['deck'], f: (t, k, T) => { P.aLx = -1.1; P.aRx = -1.1 + Math.sin(T * 14) * .14; P.aLz = -.28; P.aRz = .28 + Math.sin(T * 7) * .18; P.headX = Math.abs(Math.sin(T * 7)) * .28 - .06; P.headZ = Math.sin(T * 3.5) * .1; P.y += Math.abs(Math.sin(T * 7)) * .1; P.eyeY = .5; const d = props.deck.userData.discs; d[0].rotation.y += .2; d[1].rotation.y -= .17; } },
    bye: { dur: 2.6, props: ['backpack'], f: (t, k, T) => { P.aRz = 2.7; P.aRx = Math.sin(T * 10) * .35; P.eyeY = .5; P.headZ = -.1; P.ry = .25 * Math.sin(Math.PI * k); } },
    explode: { dur: 1.8, start: () => { boom = 0; for (const p of parts) { p.dir.set((Math.random() - .5) * 2, Math.random() * 1.4 - .2, (Math.random() - .2) * 1.2).normalize().multiplyScalar(2.2 + Math.random() * 1.4); p.spin.set((Math.random() - .5) * 8, (Math.random() - .5) * 8, (Math.random() - .5) * 8); } R.body.getWorldPosition(tmp); for (let i = 0; i < 16; i++) puff(tmp, new THREE.Vector3((Math.random() - .5) * 5, (Math.random() - .3) * 5, (Math.random() - .5) * 2), i % 3 ? 0xffffff : AMBER, 1.6); }, f: (t) => { boom = t; P.eyeY = t < 1.3 ? 1.4 : 1; } },
  };
  // held poses (while flying around the screen, hanging, being dragged…)
  const POSES = {
    surf: (T) => { P.ry = st.dir * 1.05; P.aLz = -1.25; P.aRz = 1.25; P.aLx = .15; P.aRx = -.15; P.lLx = -.28; P.lRx = -.28; P.rigZ = -st.dir * .12 + Math.sin(T * 3) * .05; P.y += .3; P.eyeY = .6; },
    wipe: (T) => { P.aRx = -1.45 + Math.cos(T * 10) * .35; P.aRz = .55 + Math.sin(T * 10) * .45; P.aLz = -.45; P.headY = Math.sin(T * 10) * .12; P.eyeY = .6; P.y += .2; },
    // hanging upside down from the top of the screen (the page flips the canvas): arms dangle, legs stuck to the edge
    hang: (T) => { P.y = .35; P.aLz = -2.75 + Math.sin(T * 5) * .25; P.aRz = 2.75 + Math.sin(T * 5 + 1) * .25; P.aLx = Math.sin(T * 3) * .2; P.aRx = -Math.sin(T * 3) * .2; P.lLx = Math.sin(T * 2.6) * .12; P.lRx = -Math.sin(T * 2.6) * .12; P.headX = .22; P.headZ = Math.sin(T * 2) * .1; P.eyeY = .55; },
    dangle: (T) => { P.aLz = -2.5 + Math.sin(T * 14) * .4; P.aRz = 2.5 + Math.sin(T * 14 + 1) * .4; P.lLx = Math.sin(T * 12) * .6; P.lRx = -Math.sin(T * 12) * .6; P.eyeRot = .32; P.eyeY = 1.25; P.headZ = Math.sin(T * 9) * .12; },
    lean: (T) => { P.rigZ = -.4; P.headZ = -.25; P.headY = .3; P.eyeY = 1.1; P.aLz = -.3; },
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
    // undo last frame's explode offsets before posing
    for (const p of parts) { p.o.position.copy(p.base); p.o.rotation.x -= p.applied.x; p.o.rotation.y -= p.applied.y; p.o.rotation.z -= p.applied.z; p.applied.set(0, 0, 0); }
    rest();
    // hover bob on the thrusters (always a little afloat)
    P.y += reduced ? 0 : Math.sin(T * 2.2) * .08;
    if (st.mood !== 'idle') moodPose(T);
    if (st.flying) { P.lLx = -.55; P.lRx = -.25; P.rigX = .12; P.rigZ = -st.dir * .28; P.ry = st.dir * .55; P.aLz = -.55; P.aRz = .55; P.aLx = .35; P.aRx = .35; P.y += .5; }
    if (st.pose && POSES[st.pose]) POSES[st.pose](T);
    const a = st.action;
    if (a) {
      const t = T - a.t0, k = Math.min(1, t / a.def.dur); a.def.f(t, k, T);
      if (t >= a.def.dur) { st.action = null; juggling = false; dizzy = false; if (a.name === 'explode') { boom = -1; api.play('dizzy'); } }
    }
    // props: held from outside, or needed by the running action / pose
    const need = st.action?.def.props;
    for (const k2 in props) props[k2].visible = !!held[k2] || !!need?.includes(k2) || (k2 === 'board' && st.pose === 'surf') || (k2 === 'sponge' && st.pose === 'wipe');
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
    r.scale.set(1 + P.sq * .5, 1 - P.sq, 1 + P.sq * .5);
    r.rotation.y = st.action?.name === 'spin' ? P.ry : damp(r.rotation.y, P.ry, 6, dt);
    const yaw = P.headY ?? st.look.x * .55, pitch = P.headX ?? st.look.y * .3;
    R.head.rotation.y = damp(R.head.rotation.y, yaw, 7, dt);
    R.head.rotation.x = damp(R.head.rotation.x, pitch, 7, dt);
    R.head.rotation.z = damp(R.head.rotation.z, P.headZ, 8, dt);
    // explode: parts fly out, hang there, snap back
    if (boom >= 0) {
      const e = boom < .22 ? ease(boom / .22) : boom < .95 ? 1 : boom < 1.55 ? 1 - ease((boom - .95) / .6) : 0;
      for (const p of parts) { p.o.position.addScaledVector(p.dir, e); p.applied.copy(p.spin).multiplyScalar(e * .5); p.o.rotation.x += p.applied.x; p.o.rotation.y += p.applied.y; p.o.rotation.z += p.applied.z; }
    }
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
    // dizzy stars around the head
    stars.forEach((s2, i) => { if (!dizzy) { s2.material.opacity = 0; return; } const a2 = T * 4 + i * Math.PI * 2 / 3; R.head.localToWorld(tmp.set(Math.cos(a2) * 1.25, 1.05 + Math.sin(a2 * 2) * .08, Math.sin(a2) * 1.0)); s2.position.copy(tmp); s2.material.opacity = .95; s2.material.rotation = T * 3; });
    // stage zoom: a bigger canvas with the camera further back keeps the robot the same size on screen
    const cz = 12.2 * st.zoom; if (camera.position.z !== cz) { camera.position.set(0, 2.25, cz); camera.lookAt(0, 2.05, 0); }
    // juggling
    balls.forEach((b, i) => {
      b.visible = juggling; if (!juggling) return;
      const u = ((T * .9 + i / 3) % 1), side = Math.floor((T * .9 + i / 3) % 2) ? 1 : -1;
      R.body.localToWorld(tmp.set(0, -.5, .9));
      b.position.set(tmp.x + side * (-.55 + 1.1 * u), tmp.y + Math.sin(Math.PI * u) * 1.6 + .2, tmp.z);
    });
    renderer.render(scene, camera);
    const busy = st.flying || st.action || st.pose || cfLife > 0 || dropT >= 0 || puffs.some((q) => q.life > 0);
    if (!hidden) { if (busy || !reduced) raf = requestAnimationFrame(frame); }
  }
  raf = requestAnimationFrame(frame);

  const wake = () => { if (!raf && !hidden && alive) { last = now(); raf = requestAnimationFrame(frame); } };
  const api = {
    setMood(m) { st.mood = m || 'idle'; },
    play(name) {
      const def = ACTIONS[name]; if (!def || reduced) return 0;
      if (st.action?.name === 'explode') { boom = -1; }
      dizzy = false; juggling = false;
      st.action = { name, def, t0: now() };
      if (name === 'celebrate' || name === 'victory' || name === 'party') cfLife = 0;
      def.start?.();
      wake();
      return def.dur;
    },
    fly(on, dir = 0) { st.flying = !!on; st.dir = Math.max(-1, Math.min(1, dir)); if (!on && !reduced) api.play('land'); },
    setDir(dir) { st.dir = Math.max(-1, Math.min(1, dir)); },
    setFacing(rad) { st.facing = rad; },
    pose(name) { st.pose = name && POSES[name] ? name : null; wake(); },
    prop(name, on) { if (name in props) { held[name] = !!on; wake(); } },
    setZoom(z) { st.zoom = Math.max(1, Math.min(4, z || 1)); wake(); },
    isBusy() { return !!st.action || st.flying; },
    dispose() {
      alive = false; cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', onVis);
      cv.removeEventListener('click', onClickCv);
      scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
      pmrem.dispose(); renderer.dispose(); cv.remove();
    },
  };
  return api;
}
