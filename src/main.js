// SIGMA City — prototype. A living 3D island where every building is a part of SIGMA.
// All numbers shown here are SAMPLE data for the prototype; nothing reads SIGMA records yet.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { Water } from 'three/addons/Water.js';

/* ------------------------------------------------------------------ basics */
const QS = new URLSearchParams(location.search);
const MOBILE = Math.min(innerWidth, innerHeight) < 700 || QS.get('q') === 'low';
const STILL = QS.has('still'); // testing: render a few frames, then stop
const STILL_FRAMES = +(QS.get('still') || 4) || 4;
let frames = 0;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOWN_Y = 3.2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(7);

/* ------------------------------------------------------------------ renderer, scene, camera */
const host = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfd8ef, 1500, 5200);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 1, 20000);
// Home view: pulled further back on narrow (portrait) screens so the whole town fits.
const HOME = innerWidth / innerHeight < 1 ? { p: [150, 170, 700], t: [0, 26, -40] } : { p: [95, 92, 410], t: [0, 34, -60] };
camera.position.set(...HOME.p);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(...HOME.t);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 70;
controls.maxDistance = 980;
controls.maxPolarAngle = 1.42;
controls.update();

/* ------------------------------------------------------------------ noise + terrain height */
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
function ridged(x, y) { let s = 0, a = 0.55, f = 1; for (let i = 0; i < 6; i++) { let n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1); n *= n; s += a * n; f *= 2.07; a *= 0.5; } return s; }

/** How far from the coast (0 = centre, ~1 = shoreline). */
function coast(x, z) {
  const dx = x / 270, dz = z > 0 ? z / 200 : z / 360;
  return Math.sqrt(dx * dx + dz * dz) + (fbm(x * 0.012 + 11, z * 0.012 + 5, 4) - 0.5) * 0.2;
}
const TOWN = { x: 0, z: 10, r: 150 };
function townMask(x, z) { return smooth(TOWN.r + 20, TOWN.r - 25, Math.hypot(x - TOWN.x, z - TOWN.z)); }
function height(x, z) {
  const e = coast(x, z);
  let h = -10 + 13.2 * smooth(1.05, 0.86, e);
  const t = townMask(x, z);
  const inland = smooth(1.0, 0.78, e);
  h += (fbm(x * 0.02, z * 0.02) - 0.5) * 5 * (1 - t) * inland;
  const north = smooth(-70, -210, z);
  const sides = smooth(150, 245, Math.abs(x)) * smooth(60, -70, z) * 0.7;
  const m = Math.max(north, sides) * (1 - t) * inland;
  h += m * (24 + 128 * ridged(x * 0.0085 + 3.1, z * 0.0085 + 7.3));
  h += 38 * Math.exp(-(((x + 60) ** 2) / (2 * 60 ** 2) + ((z + 290) ** 2) / (2 * 45 ** 2))) * inland; // main peak
  return lerp(h, TOWN_Y, t);
}

/* ------------------------------------------------------------------ sky, sun, water, light */
// A designed sky: deep blue overhead, light at the horizon, a warm glow around the sun at dawn and dusk.
const SKY = {
  day: { top: new THREE.Color(0x2a74d6), hor: new THREE.Color(0xcfe7ff) },
  dusk: { top: new THREE.Color(0x34508f), hor: new THREE.Color(0xffb27c) },
  night: { top: new THREE.Color(0x040916), hor: new THREE.Color(0x12203d) },
};
const skyU = {
  top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunCol: { value: new THREE.Color(0xffffff) }, glow: { value: 0.3 }, disc: { value: 1 },
};
const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vDir;
    void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
  fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; uniform float disc; varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir); float h = d.y;
      vec3 c = mix(hor, top, pow(clamp(h, 0.0, 1.0), 0.48));
      c = mix(c, hor * 0.85, smoothstep(0.0, -0.3, h));
      float s = max(dot(d, normalize(sunDir)), 0.0);
      c += sunCol * (pow(s, 900.0) * 4.0 * disc + pow(s, 14.0) * glow * 0.55 + pow(s, 3.0) * glow * 0.22);
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
}));
sky.renderOrder = -1;
scene.add(sky);

const sunDir = new THREE.Vector3();
const sunLight = new THREE.DirectionalLight(0xfff2e0, 3);
sunLight.castShadow = true;
const SM = MOBILE ? 2048 : 4096;
sunLight.shadow.mapSize.set(SM, SM);
Object.assign(sunLight.shadow.camera, { left: -280, right: 280, top: 280, bottom: -280, near: 10, far: 1400 });
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.6;
scene.add(sunLight, sunLight.target);
const moonLight = new THREE.DirectionalLight(0x9db4ff, 0);
moonLight.position.set(-300, 400, -200);
scene.add(moonLight);
const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x6a5a3c, 0.9);
scene.add(hemi);

const loader = new THREE.TextureLoader();
const waterNormals = loader.load('./assets/waternormals.jpg', (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
const water = new Water(new THREE.PlaneGeometry(14000, 14000), {
  textureWidth: MOBILE ? 256 : 512, textureHeight: MOBILE ? 256 : 512, waterNormals,
  sunDirection: new THREE.Vector3(), sunColor: 0xffffff, waterColor: 0x0d6f8f, distortionScale: 2.4, fog: false, alpha: 1,
});
water.rotation.x = -Math.PI / 2;
water.material.uniforms.size.value = 2.2;
scene.add(water);

const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
let envRT = null;

// stars + moon
const stars = (() => {
  const g = new THREE.BufferGeometry(); const p = [];
  for (let i = 0; i < 1800; i++) {
    const th = rand() * Math.PI * 2, ph = Math.acos(rand() * 0.95);
    p.push(5000 * Math.sin(ph) * Math.cos(th), 5000 * Math.cos(ph) + 200, 5000 * Math.sin(ph) * Math.sin(th));
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const s = new THREE.Points(g, m); s.layers.set(1); scene.add(s); return s;
})();
const moon = new THREE.Mesh(new THREE.SphereGeometry(60, 24, 16), new THREE.MeshBasicMaterial({ color: 0xf3f0e4, fog: false, transparent: true, opacity: 0 }));
moon.position.set(-2600, 2100, -3600);
moon.layers.set(1);
camera.layers.enable(1);
scene.add(moon);

/* ------------------------------------------------------------------ terrain */
(function buildTerrain() {
  const SIZE = 760, SEG = MOBILE ? 200 : 300;
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -70);
  const pos = g.attributes.position, col = [];
  const cSandWet = new THREE.Color(0xc4a873), cSand = new THREE.Color(0xead6a4), cGrass = new THREE.Color(0x6e9f45),
    cGrass2 = new THREE.Color(0x94b85a), cForest = new THREE.Color(0x4d7a35), cRock = new THREE.Color(0x857a6c),
    cRock2 = new THREE.Color(0x6a6158), cSnow = new THREE.Color(0xf4f6fb), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = height(x, z);
    pos.setY(i, h);
    const slope = Math.hypot(height(x + 2, z) - height(x - 2, z), height(x, z + 2) - height(x, z - 2)) / 4;
    const e = coast(x, z), n = fbm(x * 0.05, z * 0.05, 3);
    if (h < 0.4) c.copy(cSandWet);
    else if (h < 2.9 && e > 0.8) c.copy(cSand).lerp(cSandWet, smooth(2.0, 0.4, h) * 0.6);
    else {
      c.copy(cGrass).lerp(cGrass2, n);
      c.lerp(cForest, smooth(6, 34, h) * 0.85);
      const rock = Math.max(smooth(1.0, 1.9, slope) * smooth(12, 30, h), smooth(52, 74, h + n * 10));
      c.lerp(n > 0.5 ? cRock : cRock2, rock);
      c.lerp(cSnow, smooth(84 + n * 16, 98 + n * 16, h));
    }
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }));
  m.receiveShadow = true; m.castShadow = true;
  scene.add(m);
})();

/* ------------------------------------------------------------------ materials + helpers */
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o });
const mats = {
  road: M(0x41444e, { roughness: 0.95 }), line: M(0xf4f1e6), plaza: M(0xd9d2c3, { roughness: 0.9 }),
  stone: M(0xece3cf), stoneDark: M(0xcfc3a8), white: M(0xf6f4ef), roof: M(0x3b4152), gold: M(0xd8b04a, { metalness: 0.6, roughness: 0.35 }),
  brick: M(0xb4543d), trim: M(0xf1ece2), concrete: M(0xb9b6ae, { roughness: 0.9 }), steel: M(0x8c95a3, { metalness: 0.5, roughness: 0.45 }),
  crane: M(0xf2b705, { roughness: 0.6 }), wood: M(0x9a7350, { roughness: 0.9 }), trunk: M(0x7d5c3c, { roughness: 0.9 }),
  leaf: M(0x3f8a3a, { roughness: 0.8, side: THREE.DoubleSide }), green: M(0x5aa04a), red: M(0xc9372c), navy: M(0x223a5e),
  glassDark: M(0x1d2a3d, { metalness: 0.4, roughness: 0.15 }),
};
function box(w, h, d, mat, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function cyl(rt, rb, h, mat, x, y, z, seg = 16, parent = scene) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function textTexture(text, { w = 512, h = 128, bg = 'rgba(0,0,0,0)', color = '#fff', font = 800, size = 78 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = color; x.font = `${font} ${size}px "Plus Jakarta Sans", system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/** A facade with windows. Returns a material set + setLit(fraction) to light windows (people checked in). */
const facades = [];
function facade({ cols, rows, wall = '#2b3a52', glass = '#6f8fb5', frame = '#1c2738', lit = 0.25, warm = '#ffd8a0', seed = 1, pad = 0.18, w = 256, h = 512 }) {
  const map = document.createElement('canvas'); map.width = w; map.height = h;
  const em = document.createElement('canvas'); em.width = w; em.height = h;
  const a = map.getContext('2d'), b = em.getContext('2d');
  a.fillStyle = wall; a.fillRect(0, 0, w, h);
  const cw = w / cols, ch = h / rows, r = rng(seed), wins = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = i * cw + cw * pad, y = j * ch + ch * pad, ww = cw * (1 - pad * 2), hh = ch * (1 - pad * 2);
    a.fillStyle = frame; a.fillRect(x - 1.5, y - 1.5, ww + 3, hh + 3);
    const g = a.createLinearGradient(x, y, x + ww, y + hh); g.addColorStop(0, glass); g.addColorStop(1, '#2a3a52');
    a.fillStyle = g; a.fillRect(x, y, ww, hh);
    wins.push({ x, y, ww, hh, rank: r() });
  }
  wins.sort((p, q) => p.rank - q.rank);
  const mapT = new THREE.CanvasTexture(map); mapT.colorSpace = THREE.SRGBColorSpace; mapT.anisotropy = 8;
  const emT = new THREE.CanvasTexture(em); emT.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: mapT, emissiveMap: emT, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.35, metalness: 0.25 });
  const state = { lit, mat };
  state.setLit = (f) => {
    state.lit = f; b.fillStyle = '#000'; b.fillRect(0, 0, w, h);
    const n = Math.round(wins.length * clamp(f, 0, 1));
    for (let k = 0; k < n; k++) { const q = wins[k]; b.fillStyle = k % 7 === 0 ? '#fff0d0' : warm; b.fillRect(q.x, q.y, q.ww, q.hh); }
    emT.needsUpdate = true;
  };
  state.setLit(lit);
  facades.push(state);
  return state;
}
const pickables = [];
function pickable(obj, key) { obj.traverse((o) => { if (o.isMesh) { o.userData.key = key; pickables.push(o); } }); }

/* ------------------------------------------------------------------ town ground: roads + plaza */
function road(x1, z1, x2, z2, w = 9) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const r = new THREE.Mesh(new THREE.PlaneGeometry(w, len), mats.road);
  r.rotation.x = -Math.PI / 2; r.rotation.z = -Math.atan2(x2 - x1, z2 - z1);
  r.position.set((x1 + x2) / 2, TOWN_Y + 0.06, (z1 + z2) / 2); r.receiveShadow = true; scene.add(r);
  for (let s = 6; s < len - 6; s += 10) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 4), mats.line);
    d.rotation.copy(r.rotation); const t = s / len;
    d.position.set(lerp(x1, x2, t), TOWN_Y + 0.08, lerp(z1, z2, t)); scene.add(d);
  }
}
road(0, -70, 0, 130); road(-125, 20, 125, 20); road(-95, 20, -95, -25); road(100, 20, 100, -28); road(0, 92, 75, 92, 7); road(0, 92, -55, 92, 7);
const plaza = new THREE.Mesh(new THREE.CircleGeometry(20, 48), mats.plaza);
plaza.rotation.x = -Math.PI / 2; plaza.position.set(0, TOWN_Y + 0.07, 20); plaza.receiveShadow = true; scene.add(plaza);
cyl(4, 4.6, 1.2, mats.stone, 0, TOWN_Y, 20);
const fountain = cyl(0.5, 0.5, 4, mats.white, 0, TOWN_Y + 1.2, 20);

/* ------------------------------------------------------------------ buildings */
const B = {}; // key -> { group, at: Vector3 (label anchor) }
function place(key, group, x, z, labelY) { group.position.set(x, TOWN_Y, z); scene.add(group); pickable(group, key); B[key] = { group, at: new THREE.Vector3(x, TOWN_Y + labelY, z) }; }

// Office towers — "Work & tasks"
const officeFacade = facade({ cols: 8, rows: 20, wall: '#27364d', glass: '#7fa3cc', frame: '#18222f', lit: 0.2, seed: 3 });
const officeFacade2 = facade({ cols: 6, rows: 14, wall: '#304260', glass: '#8fb2d8', frame: '#1c2738', lit: 0.2, seed: 9 });
{
  const g = new THREE.Group();
  box(56, 7, 38, mats.stoneDark, 0, 0, 0, g);
  const roofM = mats.roof;
  const t1 = new THREE.Mesh(new THREE.BoxGeometry(30, 76, 24), [officeFacade.mat, officeFacade.mat, roofM, roofM, officeFacade.mat, officeFacade.mat]);
  t1.position.set(-8, 7 + 38, -2); t1.castShadow = t1.receiveShadow = true; g.add(t1);
  const t2 = new THREE.Mesh(new THREE.BoxGeometry(20, 50, 18), [officeFacade2.mat, officeFacade2.mat, roofM, roofM, officeFacade2.mat, officeFacade2.mat]);
  t2.position.set(17, 7 + 25, 4); t2.castShadow = t2.receiveShadow = true; g.add(t2);
  box(12, 4, 10, mats.steel, -8, 83, -2, g);
  cyl(0.4, 0.4, 16, mats.steel, -4, 87, -4, 8, g);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(26, 6.5), new THREE.MeshStandardMaterial({ map: textTexture('SIGMA'), transparent: true, emissive: 0x8a6cff, emissiveMap: textTexture('SIGMA'), emissiveIntensity: 1.2 }));
  sign.position.set(-8, 78, 10.2); g.add(sign);
  place('office', g, 0, -30, 96);
}

// Bank — "Payroll, billing & payments"
const bankFacade = facade({ cols: 6, rows: 2, wall: '#efe5cf', glass: '#4d5f78', frame: '#c9bb98', lit: 0.1, seed: 5, w: 256, h: 128, pad: 0.24 });
{
  const g = new THREE.Group();
  box(46, 1.2, 32, mats.stoneDark, 0, 0, 0, g); box(43, 1.2, 29, mats.stone, 0, 1.2, 0, g);
  const body = new THREE.Mesh(new THREE.BoxGeometry(38, 15, 22), [bankFacade.mat, bankFacade.mat, mats.stone, mats.stone, bankFacade.mat, bankFacade.mat]);
  body.position.set(0, 2.4 + 7.5, -2); body.castShadow = body.receiveShadow = true; g.add(body);
  for (let i = 0; i < 6; i++) cyl(1.1, 1.3, 15, mats.white, -15 + i * 6, 2.4, 11, 20, g);
  box(40, 1.8, 26, mats.stone, 0, 17.4, 0, g);
  const tri = new THREE.Shape(); tri.moveTo(-21, 0); tri.lineTo(21, 0); tri.lineTo(0, 7.5); tri.closePath();
  const ped = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 26, bevelEnabled: false }), mats.stone);
  ped.position.set(0, 19.2, -13); ped.castShadow = true; g.add(ped);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.4), new THREE.MeshStandardMaterial({ map: textTexture('BANK', { color: '#7a5b14', size: 84 }), transparent: true }));
  plaque.position.set(0, 21.2, 13.1); g.add(plaque);
  place('bank', g, -72, 8, 34);
}

// School — "Performance & training"
const schoolFacade = facade({ cols: 9, rows: 3, wall: '#b4543d', glass: '#5f7c9c', frame: '#f1ece2', lit: 0.05, seed: 11, w: 384, h: 160, pad: 0.22 });
{
  const g = new THREE.Group();
  const wing = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 14, d), [schoolFacade.mat, schoolFacade.mat, mats.roof, mats.roof, schoolFacade.mat, schoolFacade.mat]); m.position.set(x, 7, z); m.castShadow = m.receiveShadow = true; g.add(m); };
  wing(44, 16, 0, -6); wing(16, 30, 26, 1);
  box(46, 1, 18, mats.trim, 0, 14, -6, g);
  const tower = box(8, 26, 8, mats.brick, -6, 0, 3, g);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(6.4, 8, 4), mats.roof); cap.rotation.y = Math.PI / 4; cap.position.set(-6, 30, 3); cap.castShadow = true; g.add(cap);
  const clock = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), mats.white); clock.position.set(-6, 21, 7.05); g.add(clock);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(30, 18), mats.green); field.rotation.x = -Math.PI / 2; field.position.set(-4, 0.09, 20); field.receiveShadow = true; g.add(field);
  const bus = box(12, 4.4, 4.6, M(0xf3c31b), 20, 0.6, 22, g); box(11.6, 1.2, 4.7, mats.glassDark, 20, 3.4, 22, g);
  void tower; void bus;
  place('school', g, 72, 4, 38);
}

// Town hall — "Admin & approvals" (flag waves when approvals wait)
let flag;
{
  const g = new THREE.Group();
  box(40, 1.2, 28, mats.stoneDark, 0, 0, 0, g);
  const hall = facade({ cols: 7, rows: 2, wall: '#f6f2ea', glass: '#55688a', frame: '#d8d0c0', lit: 0.1, seed: 21, w: 256, h: 128, pad: 0.24 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(36, 14, 24), [hall.mat, hall.mat, mats.white, mats.white, hall.mat, hall.mat]);
  body.position.set(0, 1.2 + 7, 0); body.castShadow = body.receiveShadow = true; g.add(body);
  cyl(8.5, 9, 5, mats.white, 0, 15.2, 0, 32, g);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(8.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M(0x6b8fb8, { metalness: 0.35, roughness: 0.35 }));
  dome.position.set(0, 20.2, 0); dome.castShadow = true; g.add(dome);
  cyl(0.25, 0.25, 14, mats.steel, 0, 28.5, 0, 8, g);
  const fg = new THREE.PlaneGeometry(7, 4.2, 14, 6); fg.translate(3.5, 0, 0);
  flag = new THREE.Mesh(fg, M(0xe94b3c, { side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(0.2, 40, 0); flag.castShadow = true; g.add(flag);
  flag.userData.base = fg.attributes.position.array.slice();
  place('townhall', g, 0, 58, 50);
}

// Post office — "Notifications"
{
  const g = new THREE.Group();
  const pf = facade({ cols: 4, rows: 2, wall: '#f2e9dc', glass: '#5c7291', frame: '#c9372c', lit: 0.1, seed: 31, w: 256, h: 128, pad: 0.24 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(22, 10, 16), [pf.mat, pf.mat, mats.red, mats.red, pf.mat, pf.mat]);
  body.position.y = 5; body.castShadow = body.receiveShadow = true; g.add(body);
  box(23, 1, 17, mats.red, 0, 10, 0, g);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.6), new THREE.MeshStandardMaterial({ map: textTexture('POST', { color: '#c9372c', size: 84 }), transparent: true }));
  sign.position.set(0, 8.6, 8.05); g.add(sign);
  cyl(0.9, 0.9, 3.4, mats.red, 13, 0, 9, 16, g);
  place('post', g, -55, 92, 18);
}

// Homes — "Work from home & leave"
const homeWindows = [];
{
  const g = new THREE.Group();
  const colors = [0xf2d7b6, 0xcfe3f2, 0xf6e9a8, 0xe8c9d6, 0xd6e8c6, 0xf3dccb];
  let k = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const x = i * 17, z = j * 20, hc = colors[k++ % colors.length];
    box(11, 7, 10, M(hc), x, 0, z, g);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(8.6, 5.5, 4), M(0x9b4a3a)); roof.rotation.y = Math.PI / 4; roof.position.set(x, 9.7, z); roof.castShadow = true; g.add(roof);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.2), new THREE.MeshStandardMaterial({ color: 0x33445c, emissive: 0xffd08a, emissiveIntensity: 0 }));
    win.position.set(x - 2, 3.8, z + 5.05); g.add(win); homeWindows.push(win);
    box(1.2, 2, 1.2, mats.green, x + 6.5, 0, z + 6, g);
  }
  place('homes', g, 92, 60, 24);
  B.homes.at.set(92 + 17, TOWN_Y + 24, 60 + 10);
}

// Construction sites — client projects (a floor per deliverable)
function constructionSite(key, x, z, done, total) {
  const g = new THREE.Group();
  const fence = M(0xe3e0d6);
  box(36, 2, 0.4, fence, 0, 0, 16, g); box(36, 2, 0.4, fence, 0, 0, -16, g); box(0.4, 2, 32, fence, -18, 0, 0, g); box(0.4, 2, 32, fence, 18, 0, 0, g);
  const floors = new THREE.Group(); g.add(floors);
  const FH = 6;
  const addFloor = (i, animate) => {
    const f = new THREE.Group();
    box(22, 0.9, 18, mats.concrete, 0, 0, 0, f);
    for (const [cx, cz] of [[-10, -8], [10, -8], [-10, 8], [10, 8], [0, -8], [0, 8]]) box(0.9, FH - 0.9, 0.9, mats.concrete, cx, 0.9, cz, f);
    if (i < done - 1) { const wf = facade({ cols: 6, rows: 1, wall: '#bdb8ad', glass: '#7f99b5', frame: '#8f8a80', lit: 0.0, seed: 40 + i, w: 256, h: 64 }); const wall = new THREE.Mesh(new THREE.BoxGeometry(21.4, FH - 0.9, 17.4), [wf.mat, wf.mat, mats.concrete, mats.concrete, wf.mat, wf.mat]); wall.position.y = 0.9 + (FH - 0.9) / 2; wall.castShadow = wall.receiveShadow = true; f.add(wall); }
    f.position.y = i * FH; floors.add(f);
    if (animate) { f.scale.set(1, 0.01, 1); f.userData.grow = 0; }
    return f;
  };
  for (let i = 0; i < done; i++) addFloor(i, false);
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(22, (total - done) * FH, 18), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.18 }));
  ghost.position.y = done * FH + ((total - done) * FH) / 2; g.add(ghost);
  // crane
  const craneH = total * FH + 14;
  box(2.2, craneH, 2.2, mats.crane, 15, 0, -10, g);
  box(44, 1.4, 1.6, mats.crane, 4, craneH, -10, g);
  box(5, 3, 3, mats.concrete, 24, craneH - 3, -10, g);
  box(3, 3, 3, mats.navy, 13, craneH - 3.5, -10, g);
  const hook = box(0.15, 14, 0.15, mats.steel, -12, craneH - 14, -10, g);
  const jib = new THREE.Group(); g.add(jib); void hook; void jib;
  place(key, g, x, z, craneH + 8);
  return { g, floors, ghost, done, total, FH, addFloor, x, z };
}
const siteA = constructionSite('siteA', -96, -46, 3, 6);
const siteB = constructionSite('siteB', 102, -50, 5, 8);

// Lighthouse — "Security"
let beam;
{
  const lx = -170, lz = 150, ly = Math.max(height(lx, lz), 2);
  const g = new THREE.Group(); g.position.set(lx, ly, lz); scene.add(g);
  for (let i = 0; i < 5; i++) cyl(3.2 - i * 0.28, 3.4 - i * 0.28, 5, i % 2 ? mats.red : mats.white, 0, i * 5, 0, 24, g);
  cyl(2.3, 2.3, 3, M(0xfff1b0, { emissive: 0xffe08a, emissiveIntensity: 0.4 }), 0, 25, 0, 24, g);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.8, 3, 24), mats.navy); cap.position.y = 29.5; g.add(cap);
  const bg = new THREE.ConeGeometry(7, 110, 24, 1, true); bg.translate(0, -55, 0); bg.rotateZ(Math.PI / 2);
  beam = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 26.5; g.add(beam);
  pickable(g, 'lighthouse');
  B.lighthouse = { group: g, at: new THREE.Vector3(lx, ly + 38, lz) };
}

/* ------------------------------------------------------------------ beach, pier, ships */
function palm(x, z, s = 1) {
  const y = height(x, z);
  const lean = new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).normalize().multiplyScalar(3 * s);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean.x * 0.3, 6 * s, lean.z * 0.3), new THREE.Vector3(lean.x, 13 * s, lean.z)]);
  const trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.55 * s, 8), mats.trunk); trunk.castShadow = true;
  const g = new THREE.Group(); g.add(trunk); g.position.set(x, y, z);
  for (let i = 0; i < 8; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.1 * s, 9 * s, 4), mats.leaf);
    leaf.geometry.translate(0, 4.5 * s, 0); leaf.position.set(lean.x, 13 * s, lean.z);
    leaf.rotation.set(Math.PI / 2.35, (i / 8) * Math.PI * 2, 0, 'YXZ'); leaf.scale.z = 0.25; leaf.castShadow = true; g.add(leaf);
  }
  scene.add(g); return g;
}
function umbrella(x, z, color) {
  const y = height(x, z), g = new THREE.Group(); g.position.set(x, y, z);
  cyl(0.15, 0.15, 5.5, mats.white, 0, 0, 0, 6, g);
  const top = new THREE.Mesh(new THREE.ConeGeometry(4, 1.6, 10), M(color, { side: THREE.DoubleSide })); top.position.y = 5.8; top.castShadow = true; g.add(top);
  const towel = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 5), M(color === 0xffffff ? 0x2f7de1 : 0xffffff)); towel.rotation.x = -Math.PI / 2; towel.position.set(2.2, 0.06, 1); g.add(towel);
  scene.add(g);
}
const beachSpots = [];
for (let x = -120; x <= 140; x += 3) for (let z = 120; z <= 210; z += 3) { const h = height(x, z); if (h > 0.9 && h < 2.6 && coast(x, z) > 0.84) beachSpots.push([x, z]); }
const pickSpot = () => beachSpots[Math.floor(rand() * beachSpots.length)];
if (beachSpots.length) {
  for (let i = 0; i < 16; i++) { const [x, z] = pickSpot(); palm(x - 4, z - 6, 0.8 + rand() * 0.5); }
  const cols = [0xe94b3c, 0xf3c31b, 0x2f7de1, 0xffffff, 0x2bb673];
  for (let i = 0; i < 9; i++) { const [x, z] = pickSpot(); umbrella(x, z, cols[i % cols.length]); }
}
// holiday sign on the beach
{
  const [sx, sz] = beachSpots.length ? beachSpots.reduce((p, q) => (Math.abs(q[0] + 20) + Math.abs(q[1] - 150) < Math.abs(p[0] + 20) + Math.abs(p[1] - 150) ? q : p)) : [-20, 150];
  const g = new THREE.Group(); g.position.set(sx, height(sx, sz), sz); scene.add(g);
  cyl(0.3, 0.3, 6, mats.wood, -4, 0, 0, 8, g); cyl(0.3, 0.3, 6, mats.wood, 4, 0, 0, 8, g);
  const board = new THREE.Mesh(new THREE.BoxGeometry(11, 4.4, 0.5), new THREE.MeshStandardMaterial({ map: textTexture('Christmas · 25 Dec', { w: 512, h: 200, bg: '#fff8e8', color: '#7a4a12', size: 54 }) }));
  board.position.y = 6.8; board.castShadow = true; g.add(board);
  pickable(g, 'beach'); B.beach = { group: g, at: new THREE.Vector3(sx, g.position.y + 14, sz) };
}
// pier
const PIER = { x: 46, z1: 128, z2: 222 };
{
  const len = PIER.z2 - PIER.z1;
  const deck = box(8, 0.7, len, mats.wood, PIER.x, 2.2, (PIER.z1 + PIER.z2) / 2);
  void deck;
  for (let z = PIER.z1 + 4; z < PIER.z2; z += 8) { cyl(0.45, 0.45, 9, mats.trunk, PIER.x - 3.6, -6, z, 8); cyl(0.45, 0.45, 9, mats.trunk, PIER.x + 3.6, -6, z, 8); }
}
function ship(color = 0xffffff, stripe = 0x223a5e) {
  const s = new THREE.Shape();
  s.moveTo(-6, -20); s.lineTo(6, -20); s.lineTo(6.4, 12); s.quadraticCurveTo(6, 22, 0, 28); s.quadraticCurveTo(-6, 22, -6.4, 12); s.closePath();
  const hg = new THREE.ExtrudeGeometry(s, { depth: 6, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.6, bevelSegments: 2 });
  hg.rotateX(-Math.PI / 2);
  const g = new THREE.Group();
  const hull = new THREE.Mesh(hg, M(stripe, { roughness: 0.5 })); hull.position.y = -2.5; hull.castShadow = true; g.add(hull);
  box(11, 1.2, 40, M(color), 0, 3.4, -2, g);
  box(9, 5, 12, M(color), 0, 4.6, 4, g);
  box(9.2, 1.4, 12.2, mats.glassDark, 0, 7.6, 4, g);
  box(7, 3.6, 7, M(color), 0, 9.6, 6, g);
  cyl(1.4, 1.6, 6, M(0xe94b3c), 0, 9.6, 12, 16, g);
  return g;
}
const ship1 = ship(); ship1.position.set(PIER.x - 13, 0, PIER.z2 - 14); scene.add(ship1); pickable(ship1, 'harbour');
B.harbour = { group: ship1, at: new THREE.Vector3(PIER.x - 13, 24, PIER.z2 - 14) };
const ship2 = ship(0xffffff, 0x0e6b5a); ship2.visible = false; scene.add(ship2); pickable(ship2, 'harbour');
// a small sailboat out in the bay
const sail = (() => {
  const g = new THREE.Group();
  const hull = box(3, 1.4, 9, mats.white, 0, -0.6, 0, g); void hull;
  cyl(0.15, 0.15, 12, mats.steel, 0, 0.8, 0, 6, g);
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0, 11); sh.lineTo(5.5, 0); sh.closePath();
  const s = new THREE.Mesh(new THREE.ShapeGeometry(sh), M(0xffffff, { side: THREE.DoubleSide })); s.position.set(0, 1.2, 0); s.rotation.y = Math.PI / 2; g.add(s);
  scene.add(g); return g;
})();

/* ------------------------------------------------------------------ trees (instanced) */
{
  const N = MOBILE ? 180 : 360;
  const trunkG = new THREE.CylinderGeometry(0.4, 0.55, 3, 6); trunkG.translate(0, 1.5, 0);
  const crownG = new THREE.ConeGeometry(2.6, 7, 7); crownG.translate(0, 6.5, 0);
  const trunks = new THREE.InstancedMesh(trunkG, mats.trunk, N);
  const crowns = new THREE.InstancedMesh(crownG, M(0x3e7a34, { roughness: 0.85 }), N);
  trunks.castShadow = crowns.castShadow = true; crowns.receiveShadow = true;
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  let n = 0, tries = 0;
  while (n < N && tries < 20000) {
    tries++;
    const x = (rand() - 0.5) * 520, z = -260 + rand() * 360, h = height(x, z);
    if (h < 3.6 || h > 42 || townMask(x, z) > 0.05 || coast(x, z) > 0.84) continue;
    const slope = Math.hypot(height(x + 2, z) - height(x - 2, z), height(x, z + 2) - height(x, z - 2)) / 4;
    if (slope > 0.6) continue;
    const s = 0.8 + rand() * 0.9;
    p.set(x, h - 0.3, z); sc.set(s, s * (0.9 + rand() * 0.4), s); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
    mtx.compose(p, q, sc); trunks.setMatrixAt(n, mtx); crowns.setMatrixAt(n, mtx);
    crowns.setColorAt(n, c.setHSL(0.27 + rand() * 0.06, 0.45, 0.24 + rand() * 0.1));
    n++;
  }
  trunks.count = crowns.count = n; scene.add(trunks, crowns);
}
// street lamps along the avenue
const lampBulbs = [], lampLights = [];
for (let z = -50; z <= 125; z += 25) for (const sx of [-6.5, 6.5]) {
  cyl(0.2, 0.25, 7, mats.steel, sx, TOWN_Y, z, 6);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfff1cc, emissive: 0xffd28a, emissiveIntensity: 0 }));
  b.position.set(sx, TOWN_Y + 7.2, z); scene.add(b); lampBulbs.push(b);
}
for (const [x, z] of [[0, 0], [0, 60], [0, 115], [-70, 25], [70, 25]]) { const l = new THREE.PointLight(0xffc070, 0, 70, 1.6); l.position.set(x, TOWN_Y + 8, z); scene.add(l); lampLights.push(l); }

/* ------------------------------------------------------------------ mountain goal flag */
let summit = new THREE.Vector3();
{
  let best = -1;
  for (let x = -200; x <= 200; x += 4) for (let z = -330; z <= -120; z += 4) { const h = height(x, z); if (h > best) { best = h; summit.set(x, h, z); } }
  const g = new THREE.Group(); g.position.copy(summit); scene.add(g);
  cyl(0.5, 0.5, 18, mats.steel, 0, -1, 0, 8, g);
  const fg = new THREE.PlaneGeometry(12, 7, 14, 6); fg.translate(6, 0, 0);
  const mf = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: textTexture('68%', { w: 256, h: 150, bg: '#5b3df5', color: '#ffffff', size: 92 }), side: THREE.DoubleSide }));
  mf.position.set(0.4, 13.5, 0); mf.castShadow = true; g.add(mf); mf.userData.base = fg.attributes.position.array.slice();
  B.mountain = { group: g, at: summit.clone().add(new THREE.Vector3(0, 30, 0)), flag: mf };
  pickable(g, 'mountain');
}

/* ------------------------------------------------------------------ clouds + storm */
const clouds = [];
const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.94 });
function cloud(x, y, z, s = 1, mat = cloudMat) {
  const g = new THREE.Group(), puffs = 6 + Math.floor(rand() * 5);
  const geo = new THREE.IcosahedronGeometry(1, 3);
  for (let i = 0; i < puffs; i++) {
    const m = new THREE.Mesh(geo, mat);
    const r = (7 + rand() * 7) * s; m.scale.set(r * 1.25, r * 0.8, r);
    m.position.set((rand() - 0.5) * 34 * s, (rand() - 0.2) * 5 * s, (rand() - 0.5) * 16 * s);
    m.castShadow = true; g.add(m);
  }
  g.position.set(x, y, z); scene.add(g); return g;
}
for (let i = 0; i < (MOBILE ? 9 : 15); i++) {
  const c = cloud(-500 + rand() * 1000, 150 + rand() * 70, -420 + rand() * 600, 0.8 + rand() * 0.9);
  c.userData.speed = 2 + rand() * 4; clouds.push(c);
}
const stormMat = new THREE.MeshStandardMaterial({ color: 0x5b606c, roughness: 1, transparent: true, opacity: 0.97 });
function stormCloud(site, visible = true) {
  const c = cloud(site.x, site.total * site.FH + 46, site.z, 0.75, stormMat.clone());
  const drops = 380, p = new Float32Array(drops * 6);
  for (let i = 0; i < drops; i++) { const x = (rand() - 0.5) * 34, z = (rand() - 0.5) * 22, y = -rand() * 40; p.set([x, y, z, x - 0.3, y - 2.2, z], i * 6); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xa9c4e0, transparent: true, opacity: 0.55 }));
  c.add(rain);
  const flash = new THREE.PointLight(0xc8d8ff, 0, 160, 1.2); flash.position.y = -10; c.add(flash);
  c.userData = { rain, flash, level: visible ? 1 : 0, target: visible ? 1 : 0, site };
  c.traverse((o) => { if (o.material && 'opacity' in o.material) o.material.opacity = visible ? o.material.opacity : 0; });
  return c;
}
const storms = [stormCloud(siteB, true), stormCloud(siteA, false)];

/* ------------------------------------------------------------------ vans on the road */
const vans = [];
function van(points, color, speed) {
  const g = new THREE.Group();
  box(4.4, 3.2, 8, M(color), 0, 0.6, 0, g); box(4.5, 1.4, 2.4, mats.glassDark, 0, 2, 3.2, g);
  for (const [x, z] of [[-2.2, -2.6], [2.2, -2.6], [-2.2, 2.6], [2.2, 2.6]]) { const w = cyl(0.8, 0.8, 0.6, mats.navy, x, 0, z, 10, g); w.rotation.z = Math.PI / 2; w.position.y = 0.8; }
  scene.add(g);
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, TOWN_Y + 0.1, z)), true, 'catmullrom', 0.1);
  vans.push({ g, curve, t: rand(), speed });
}
van([[3, -10], [3, 23], [-95, 23], [-95, -18], [-91, -18], [-91, 17], [-3, 17], [-3, -10]], 0xffffff, 0.018);
van([[3, -8], [3, 23], [100, 23], [100, -20], [104, -20], [104, 17], [-3, 17], [-3, 50], [3, 50]], 0x2f7de1, 0.015);

/* ------------------------------------------------------------------ effects: rainbow, fireworks */
const rainbow = new THREE.Group();
['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#3949ab', '#8e24aa'].forEach((c, i) => {
  const m = new THREE.Mesh(new THREE.TorusGeometry(70 - i * 2.2, 1.1, 6, 80, Math.PI), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  rainbow.add(m);
});
rainbow.position.set(-72, TOWN_Y, -10); scene.add(rainbow);
let rainbowT = 0;
const bursts = [];
function fireworks(at, colors = [0xff5a5a, 0xffd24a, 0x7c5cff, 0x4ad0ff, 0x58e08a], n = 3) {
  for (let k = 0; k < n; k++) {
    const N = 160, pos = new Float32Array(N * 3), vel = [];
    for (let i = 0; i < N; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(18 + rand() * 14); vel.push(v); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: colors[k % colors.length], size: 2.6, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const pts = new THREE.Points(g, m); pts.position.copy(at).add(new THREE.Vector3((rand() - 0.5) * 30, 10 + rand() * 18, (rand() - 0.5) * 30)); scene.add(pts);
    bursts.push({ pts, vel, t: -k * 0.35 });
  }
}

/* ------------------------------------------------------------------ labels + data (SAMPLE) */
const ICON = {
  office: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3M3 21h18"/>',
  bank: '<path d="M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M2 10l10-6 10 6z"/>',
  school: '<path d="M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 2 9 2 12 0v-5"/>',
  townhall: '<path d="M4 21V10M20 21V10M8 21v-6M16 21v-6M2 21h20M12 3a6 6 0 0 1 6 6H6a6 6 0 0 1 6-6zM12 1v2"/>',
  post: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  homes: '<path d="M3 11 12 4l9 7M5 10v10h14V10M10 20v-5h4v5"/>',
  site: '<path d="M4 21V9h6v12M10 13h4v8M2 21h20M7 9V4l13 2M20 6v4M18 10h4"/>',
  beach: '<path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 12v9M8 21h8"/>',
  ship: '<path d="M3 17h18l-2 4H5zM5 17V11h14v6M9 11V6h6v5M12 3v3"/>',
  mountain: '<path d="m3 20 6-11 4 6 2-3 6 8zM9 9l1.5-2.5M14 4v5l3-1.5L14 6"/>',
  lighthouse: '<path d="M9 21l1-13h4l1 13zM8 8h8M10 4h4l1 4H9zM4 6l3 1M20 6l-3 1M8 21h8"/>',
};
const svg = (k) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const DATA = {
  office: { kind: 'Office tower', title: 'Work & tasks', icon: 'office', sub: () => `${state.checkedIn} of 24 checked in`, lead: 'Windows light up as people check in. Delivery vans carry tasks out to the client project sites.', stats: () => [['Checked in', `${state.checkedIn} / 24`], ['Tasks open', '37'], ['Waiting for OK', '6'], ['Overdue', String(state.overdue)]], page: 'Work & tasks' },
  bank: { kind: 'Bank', title: 'Payroll & payments', icon: 'bank', sub: () => `₹${state.collected.toFixed(1)}L collected in Nov`, lead: 'A rainbow appears when a client payment arrives. Payroll for the month is prepared here.', stats: () => [['Collected this month', `₹${state.collected.toFixed(1)}L`], ['Invoices due', '3'], ['November payroll', 'Draft']], page: 'Billing & payroll' },
  school: { kind: 'School', title: 'Performance & growth', icon: 'school', sub: () => '2 bonus reviews waiting', lead: 'KRAs, reviews, bonus and PIP decisions. The bell rings when a review needs you.', stats: () => [['Bonus reviews', '2'], ['PIPs active', '0'], ['Reviews due', '4']], page: 'Performance' },
  townhall: { kind: 'Town hall', title: 'Admin & approvals', icon: 'townhall', sub: () => `${state.approvals} approvals waiting`, alert: () => state.approvals > 0, lead: 'The flag flies while approvals are waiting: leave, WFH, corrections, offers.', stats: () => [['Leave requests', '2'], ['Work from home', '1'], ['Attendance fixes', '0'], ['Offer letters', '1 sent']], page: 'Requests' },
  post: { kind: 'Post office', title: 'Notifications', icon: 'post', sub: () => '5 unread', lead: 'Every update lands here first — tasks, payments, approvals.', stats: () => [['Unread', '5'], ['Today', '14']], page: 'Notifications' },
  homes: { kind: 'Homes', title: 'Work from home & leave', icon: 'homes', sub: () => '4 working from home', lead: 'A lit window means that person is working from home today.', stats: () => [['Working from home', '4'], ['On leave', '1'], ['Next holiday', 'Christmas · 25 Dec']], page: 'Work from home' },
  siteA: { kind: 'Client project', title: 'Total Brand Revamp', icon: 'site', sub: () => `${siteA.done} of ${siteA.total} deliverables`, good: () => storms[1].userData.target === 0, alert: () => storms[1].userData.target > 0, lead: 'Each floor is a delivered deliverable. When the last floor is on, fireworks.', stats: () => [['Delivered', `${siteA.done} / ${siteA.total}`], ['In review', '1'], ['Overdue', storms[1].userData.target > 0 ? '1' : '0'], ['Contract', 'Signed']], page: 'Project' },
  siteB: { kind: 'Client project', title: 'Logo Creation', icon: 'site', sub: () => '2 overdue · storm', alert: () => true, lead: 'A storm sits over a project at risk — overdue work or an unpaid invoice. Clear it to bring the sun back.', stats: () => [['Delivered', `${siteB.done} / ${siteB.total}`], ['Overdue', '2'], ['Invoice', 'Unpaid · 12 days']], page: 'Project' },
  beach: { kind: 'Beach', title: 'Holidays', icon: 'beach', sub: () => 'Next: Christmas · 25 Dec', lead: 'The beach fills up on holidays. 14 company holidays and 1 optional a year.', stats: () => [['Next holiday', 'Christmas · 25 Dec'], ['Left this year', '1'], ['Optional chosen', '—']], page: 'Holidays' },
  harbour: { kind: 'Harbour', title: 'New clients', icon: 'ship', sub: () => `${state.newClients} contract${state.newClients === 1 ? '' : 's'} awaiting signature`, lead: 'A ship docks when a new client signs their contract and scope of work.', stats: () => [['Awaiting signature', String(state.newClients)], ['Signed this month', String(state.signed)]], page: 'Clients' },
  mountain: { kind: 'The mountain', title: 'November goal', icon: 'mountain', sub: () => `${Math.round(state.goal)}% collected`, lead: 'The flag climbs as the month’s goal gets closer — revenue collected or deliverables done.', stats: () => [['Goal', '₹6.2L collected'], ['So far', `${Math.round(state.goal)}%`], ['Days left', '12']], page: 'Reports' },
  lighthouse: { kind: 'Lighthouse', title: 'Security', icon: 'lighthouse', sub: () => 'All clear', good: () => true, lead: 'The light sweeps the bay at night. It turns red if something needs a security look — a new device, a locked account.', stats: () => [['Sign-in alerts', '0'], ['Devices', 'All known'], ['Offer lock', 'On']], page: 'Activity log' },
};
const state = { checkedIn: 6, overdue: 1, collected: 4.2, approvals: 3, newClients: 0, signed: 2, goal: 68 };
const labelsHost = document.getElementById('labels');
const labelEls = {};
for (const key of Object.keys(DATA)) {
  const el = document.createElement('div'); el.className = 'label'; labelsHost.appendChild(el); labelEls[key] = el;
}
function refreshLabels() {
  for (const [key, d] of Object.entries(DATA)) {
    const el = labelEls[key];
    el.classList.toggle('alert', !!d.alert?.()); el.classList.toggle('good', !!d.good?.());
    el.innerHTML = `<span class="ico">${svg(d.icon)}</span><span>${d.title}<small>${d.sub()}</small></span>`;
  }
  const storm = storms.filter((s) => s.userData.target > 0).length;
  document.getElementById('weather').textContent = storm ? `Mostly sunny · ${storm} storm${storm > 1 ? 's' : ''} over projects` : 'Clear skies · everything on track';
  document.getElementById('pulse-list').innerHTML = [
    ['Checked in', `${state.checkedIn} / 24`], ['Approvals waiting', state.approvals], ['Collected (Nov)', `₹${state.collected.toFixed(1)}L`], ['Monthly goal', `${Math.round(state.goal)}%`],
  ].map(([a, b]) => `<li><span>${a}</span><b>${b}</b></li>`).join('');
  if (openKey) showPanel(openKey, false);
}
const tmpV = new THREE.Vector3();
function placeLabels() {
  const w = innerWidth, h = innerHeight;
  for (const [key, el] of Object.entries(labelEls)) {
    const b = B[key]; if (!b) continue;
    tmpV.copy(b.at).project(camera);
    const sy = (-tmpV.y * 0.5 + 0.5) * h;
    const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 && sy > (w < 760 ? 150 : 120);
    el.classList.toggle('hidden', !vis || (tourT >= 0));
    if (vis) el.style.transform = `translate(${(tmpV.x * 0.5 + 0.5) * w}px, ${(-tmpV.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
    el.style.left = '0'; el.style.top = '0';
  }
}

/* ------------------------------------------------------------------ panel + picking */
let openKey = null;
const panel = document.getElementById('panel');
function showPanel(key, fly = true) {
  const d = DATA[key]; if (!d) return;
  openKey = key; panel.hidden = false;
  document.getElementById('panel-kind').textContent = d.kind;
  document.getElementById('panel-title').textContent = d.title;
  document.getElementById('panel-lead').textContent = d.lead;
  document.getElementById('panel-stats').innerHTML = d.stats().map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  document.getElementById('panel-open').textContent = `Open ${d.page} in SIGMA`;
  if (fly) { const at = B[key].at; flyTo(new THREE.Vector3(at.x + 70, Math.max(at.y + 30, 70), at.z + 110), new THREE.Vector3(at.x, at.y * 0.55, at.z)); }
}
document.getElementById('panel-close').onclick = () => { panel.hidden = true; openKey = null; };
document.getElementById('panel-open').onclick = () => toast('Prototype: this would open the SIGMA page.');
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const hit = pick(e); if (hit) showPanel(hit);
});
renderer.domElement.addEventListener('pointermove', (e) => { if (e.buttons) return; renderer.domElement.classList.toggle('pointing', !!pick(e)); });
function pick(e) {
  ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObjects(pickables, false)[0];
  return hit?.object.userData.key ?? null;
}

/* ------------------------------------------------------------------ camera moves */
let fly = null;
function flyTo(pos, target, dur = 1.4) { fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, t: 0, dur }; }
let tourT = -1;
const tour = {
  pos: new THREE.CatmullRomCurve3([[95, 92, 410], [-150, 90, 170], [-150, 70, -30], [-40, 150, -150], [120, 90, -80], [150, 60, 120], [95, 92, 410]].map((a) => new THREE.Vector3(...a))),
  tgt: new THREE.CatmullRomCurve3([[0, 18, -10], [-72, 15, 8], [-96, 20, -46], [-40, 60, -250], [102, 25, -50], [46, 5, 190], [0, 34, -60]].map((a) => new THREE.Vector3(...a))),
};

/* ------------------------------------------------------------------ time of day */
let mode = 'live', fixedHour = 12, lastEnvHour = -99;
function istHour() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const h = +p.find((x) => x.type === 'hour').value, m = +p.find((x) => x.type === 'minute').value;
  document.getElementById('clock').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return h + m / 60;
}
let night = 0;
function applyTime(hour) {
  const elev = 72 * Math.sin((Math.PI * (hour - 6)) / 12);
  const azim = 90 - ((hour - 6) / 12) * 180;
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - Math.max(elev, -12)), THREE.MathUtils.degToRad(azim));
  skyU.sunDir.value.copy(sunDir);
  water.material.uniforms.sunDirection.value.copy(sunDir).normalize();
  night = smooth(4, -7, elev);
  const low = smooth(22, 1, elev) * (1 - night);
  sunLight.position.copy(sunDir).multiplyScalar(600).add(new THREE.Vector3(0, 0, -20));
  sunLight.target.position.set(0, 0, -20);
  sunLight.intensity = 3.1 * smooth(-3, 8, elev);
  sunLight.color.setHex(0xfff3e4).lerp(new THREE.Color(0xff9b55), low);
  water.material.uniforms.sunColor.value.copy(sunLight.color).multiplyScalar(lerp(1, 0.2, night));
  water.material.uniforms.waterColor.value.setHex(0x0d6f8f).lerp(new THREE.Color(0xd8774a), low * 0.25).lerp(new THREE.Color(0x041a2b), night);
  moonLight.intensity = 0.45 * night;
  hemi.intensity = lerp(0.85, 0.16, night) * lerp(1, 0.7, low);
  hemi.color.setHex(0xcfe4ff).lerp(new THREE.Color(0xffc49a), low * 0.6).lerp(new THREE.Color(0x3a4a7a), night);
  renderer.toneMappingExposure = lerp(0.6, 0.44, night) + low * 0.06;
  skyU.top.value.copy(SKY.day.top).lerp(SKY.dusk.top, low).lerp(SKY.night.top, night);
  skyU.hor.value.copy(SKY.day.hor).lerp(SKY.dusk.hor, low).lerp(SKY.night.hor, night);
  skyU.sunCol.value.setHex(0xfff1d6).lerp(new THREE.Color(0xff8a45), low);
  skyU.glow.value = lerp(0.35, 1.6, low) * (1 - night);
  skyU.disc.value = 1 - night;
  scene.fog.color.copy(skyU.hor.value);
  stars.material.opacity = night; moon.material.opacity = night;
  for (const f of facades) f.mat.emissiveIntensity = lerp(0.25, 2.1, night);
  for (const b of lampBulbs) b.material.emissiveIntensity = 2.4 * night;
  for (const l of lampLights) l.intensity = 900 * night;
  homeWindows.forEach((w, i) => { w.material.emissiveIntensity = (i < 4 ? 1.8 : 0.0) * Math.max(night, 0.15); });
  beam.material.opacity = 0.11 * night;
  cloudMat.color.setHex(0xffffff).lerp(new THREE.Color(0xffd2b0), low * 0.8).lerp(new THREE.Color(0x56607e), night);
  cloudMat.emissive.setHex(0x1d2540); cloudMat.emissiveIntensity = night * 0.9;
  if (Math.abs(hour - lastEnvHour) > 0.25) {
    lastEnvHour = hour;
    if (envRT) envRT.dispose();
    envScene.add(sky); envRT = pmrem.fromScene(envScene); scene.add(sky);
    scene.environment = envRT.texture;
    scene.environmentIntensity = lerp(1, 0.15, night);
  }
}
document.querySelectorAll('.time button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.time button').forEach((x) => x.classList.toggle('on', x === b));
  mode = b.dataset.time === 'live' ? 'live' : 'fixed';
  if (mode === 'fixed') { targetHour = +b.dataset.time; } else { targetHour = istHour(); }
}));
let targetHour = istHour(), currentHour = targetHour;
const urlTime = QS.get('t');
if (urlTime) { mode = 'fixed'; targetHour = currentHour = +urlTime; document.querySelectorAll('.time button').forEach((x) => x.classList.toggle('on', x.dataset.time === urlTime)); }
setInterval(() => { if (mode === 'live') targetHour = istHour(); }, 30000);

/* ------------------------------------------------------------------ the live moments (sample events) */
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3600); }
let litAnim = null;
const EVENTS = {
  checkin() { litAnim = { from: officeFacade.lit, to: 0.78, t: 0 }; state.checkedIn = 19; toast('19 people checked in — the office lights up'); showPanel('office'); },
  deliverable() {
    if (siteA.done >= siteA.total) { toast('Total Brand Revamp is already complete'); return; }
    const f = siteA.addFloor(siteA.done, true); siteA.done++;
    siteA.ghost.scale.y = Math.max(0.001, (siteA.total - siteA.done) / (siteA.total - 3)); siteA.ghost.position.y = siteA.done * siteA.FH + ((siteA.total - siteA.done) * siteA.FH) / 2;
    if (siteA.done >= siteA.total) { siteA.ghost.visible = false; toast('Last deliverable done — project complete 🎉'); setTimeout(() => fireworks(new THREE.Vector3(-96, siteA.total * siteA.FH + 10, -46), undefined, 5), 600); }
    else toast(`Deliverable done — a floor goes up (${siteA.done} of ${siteA.total})`);
    void f; refreshLabels(); showPanel('siteA');
  },
  payment() { rainbowT = 7; state.collected += 0.9; state.goal = Math.min(100, state.goal + 14); toast('₹90,000 received — a rainbow over the bank'); fireworks(new THREE.Vector3(-72, 26, 8), [0xffd24a, 0xffe58a], 2); refreshLabels(); showPanel('bank'); },
  overdue() { storms[1].userData.target = 1; state.overdue++; toast('A task went overdue — clouds gather over Total Brand Revamp'); refreshLabels(); showPanel('siteA'); },
  client() {
    if (ship2.visible) { toast('The new client’s ship is already in'); return; }
    ship2.visible = true; ship2.userData.t = 0; state.newClients = 1; toast('A new client is coming in — their ship heads for the harbour'); refreshLabels();
    flyTo(new THREE.Vector3(160, 70, 330), new THREE.Vector3(PIER.x, 5, PIER.z2 - 10));
  },
  tour() { tourT = 0; panel.hidden = true; openKey = null; toast('Morning fly-over'); },
};
document.querySelectorAll('.dock button').forEach((b) => b.addEventListener('click', () => EVENTS[b.dataset.event]?.()));

/* ------------------------------------------------------------------ loop */
const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const motion = REDUCED ? 0.15 : 1;
  currentHour = lerp(currentHour, targetHour, 1 - Math.exp(-dt * 2.5));
  applyTime(currentHour);
  water.material.uniforms.time.value += dt * 0.45 * motion;

  for (const c of clouds) { c.position.x += c.userData.speed * dt * motion; if (c.position.x > 560) c.position.x = -560; }
  for (const s of storms) {
    const u = s.userData; u.level = lerp(u.level, u.target, 1 - Math.exp(-dt * 1.5));
    s.traverse((o) => { if (o.isMesh) o.material.opacity = 0.97 * u.level; });
    u.rain.material.opacity = 0.55 * u.level; s.visible = u.level > 0.01;
    const p = u.rain.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 2) { let y = p.getY(i) - dt * 60 * motion; if (y < -42) y = 0; p.setY(i, y); p.setY(i + 1, y - 2.2); }
    p.needsUpdate = true;
    u.flash.intensity = u.level > 0.5 && Math.random() < 0.006 ? 4000 : u.flash.intensity * 0.82;
  }
  // flags
  for (const f of [flag, B.mountain.flag]) {
    const pos = f.geometry.attributes.position, base = f.userData.base;
    for (let i = 0; i < pos.count; i++) { const x = base[i * 3]; pos.setZ(i, Math.sin(x * 0.9 - t * 4 * motion) * x * 0.06); }
    pos.needsUpdate = true; f.geometry.computeVertexNormals();
  }
  flag.visible = state.approvals > 0;
  B.mountain.flag.position.y = lerp(-2, 13.5, state.goal / 100);
  fountain.scale.y = 1 + Math.sin(t * 3) * 0.08;
  // ships + boat
  ship1.position.y = Math.sin(t * 0.9) * 0.35; ship1.rotation.z = Math.sin(t * 0.7) * 0.015;
  if (ship2.visible) {
    const u = ship2.userData; u.t = Math.min(1, (u.t ?? 0) + dt / 9);
    const e = 1 - (1 - u.t) ** 3;
    ship2.position.set(lerp(420, PIER.x + 13, e), Math.sin(t * 0.9 + 1) * 0.35, lerp(760, PIER.z2 - 14, e));
    ship2.rotation.y = lerp(-0.55, 0, e);
    if (u.t >= 1 && !u.docked) { u.docked = true; state.newClients = 0; state.signed++; toast('Contract signed — the new client’s ship has docked'); fireworks(new THREE.Vector3(PIER.x + 13, 8, PIER.z2 - 14), undefined, 2); refreshLabels(); }
  }
  const sa = t * 0.05 * motion; sail.position.set(Math.cos(sa) * 330 - 60, Math.sin(t * 1.3) * 0.3, 330 + Math.sin(sa) * 90); sail.rotation.y = -sa - Math.PI / 2;
  // vans
  for (const v of vans) { v.t = (v.t + dt * v.speed * motion) % 1; const p = v.curve.getPointAt(v.t), q = v.curve.getPointAt((v.t + 0.002) % 1); v.g.position.copy(p); v.g.lookAt(q.x, p.y, q.z); }
  // growing floors
  for (const f of siteA.floors.children) if (f.userData.grow !== undefined && f.userData.grow < 1) { f.userData.grow = Math.min(1, f.userData.grow + dt * 0.8); f.scale.y = 0.01 + 0.99 * (1 - (1 - f.userData.grow) ** 3); }
  // office lights animation
  if (litAnim) { litAnim.t = Math.min(1, litAnim.t + dt / 3); officeFacade.setLit(lerp(litAnim.from, litAnim.to, litAnim.t)); officeFacade2.setLit(lerp(litAnim.from, litAnim.to * 0.9, litAnim.t)); if (litAnim.t >= 1) litAnim = null; }
  // rainbow
  if (rainbowT > 0) rainbowT -= dt;
  const ro = smooth(0, 1.5, rainbowT) * 0.55 * (1 - night);
  rainbow.children.forEach((m) => (m.material.opacity = ro)); rainbow.visible = ro > 0.01;
  // fireworks
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]; b.t += dt; if (b.t < 0) { b.pts.visible = false; continue; } b.pts.visible = true;
    const p = b.pts.geometry.attributes.position;
    for (let k = 0; k < b.vel.length; k++) { const v = b.vel[k]; p.setXYZ(k, v.x * b.t, v.y * b.t - 9 * b.t * b.t, v.z * b.t); }
    p.needsUpdate = true; b.pts.material.opacity = Math.max(0, 1 - b.t / 2.2);
    if (b.t > 2.2) { scene.remove(b.pts); b.pts.geometry.dispose(); bursts.splice(i, 1); }
  }
  // lighthouse
  beam.rotation.y = t * 0.6 * motion;
  // camera
  if (tourT >= 0) {
    tourT += dt / 16; const k = Math.min(tourT, 1);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    camera.position.copy(tour.pos.getPointAt(e)); controls.target.copy(tour.tgt.getPointAt(e));
    if (tourT >= 1) tourT = -1;
  } else if (fly) {
    fly.t = Math.min(1, fly.t + dt / fly.dur); const e = 1 - (1 - fly.t) ** 3;
    camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e);
    if (fly.t >= 1) fly = null;
  }
  controls.update();
  renderer.render(scene, camera);
  placeLabels();
  frames++;
  if (STILL && frames > STILL_FRAMES) { window.__ready = true; return; }
  requestAnimationFrame(animate);
}
renderer.domElement.addEventListener('pointerdown', () => { fly = null; tourT = -1; });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

refreshLabels();
applyTime(currentHour);
animate();
if (STILL) document.getElementById('loading').remove();
else requestAnimationFrame(() => document.getElementById('loading')?.classList.add('done'));
window.__sigmaCity = { EVENTS, state };
