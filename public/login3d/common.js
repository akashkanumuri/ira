// Shared runtime for the 3D login scenes. Loaded only on the sign-in page.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export { THREE, RoundedBoxGeometry };

export const lowTier = () =>
  matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) < 4 || innerWidth < 700;

/**
 * Full-viewport stage. The "frame" is a DOM element whose on-screen rectangle becomes a 3D window at z = 0.
 * Things inside the window are stencil-clipped; things in front of it (z > 0) can leave it.
 */
export function createStage({ container, frameEl, transparent = false, bg = 0x07070d, frameColor = 0x020206, bloom = 0.8, threshold = 0.9, radius = 34 }) {
  const low = lowTier();
  // Always antialiased and rendered at the screen's real sharpness (up to 2×). If a device can't hold a
  // smooth frame rate, the loop below steps the resolution down gradually instead of starting blurry.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: transparent, stencil: true, powerPreference: 'high-performance' });
  const maxDpr = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(maxDpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  if (!transparent) scene.background = new THREE.Color(bg);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const fov = 35, dist = 20;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 400);
  camera.position.set(0, 0, dist);
  const stage = { THREE, renderer, scene, camera, dist, low, u: 1, W: 1, H: 1, frame: { x: 0, y: 0, w: 1, h: 1, cx: 0, cy: 0 } };

  // frame window + stencil mask
  const frameMat = new THREE.MeshBasicMaterial({ color: frameColor, depthWrite: false });
  const frameMesh = new THREE.Mesh(new THREE.BufferGeometry(), frameMat); frameMesh.renderOrder = -20; scene.add(frameMesh);
  const maskMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
  const mask = new THREE.Mesh(frameMesh.geometry, maskMat); mask.renderOrder = -10; scene.add(mask);
  stage.frameMesh = frameMesh; stage.mask = mask;
  stage.inside = (mat) => { mat.stencilWrite = true; mat.stencilRef = 1; mat.stencilFunc = THREE.EqualStencilFunc; return mat; };
  stage.outside = (mat) => { mat.stencilWrite = false; mat.stencilFunc = THREE.AlwaysStencilFunc; return mat; };

  let composer = null, bloomPass = null;
  if (!transparent && !low) {
    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, stencilBuffer: true, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(2, 2), bloom, 0.55, threshold);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }
  stage.bloomPass = bloomPass;

  const listeners = [];
  stage.onLayout = (fn) => listeners.push(fn);
  stage.px = (x, y, z = 0) => {
    const k = (dist - z) / dist;
    return new THREE.Vector3((x - stage.W / 2) * stage.u * k, (stage.H / 2 - y) * stage.u * k, z);
  };
  stage.toScreen = (v) => { const p = v.clone().project(camera); return { x: (p.x + 1) / 2 * stage.W, y: (1 - p.y) / 2 * stage.H }; };

  function layout() {
    const W = container.clientWidth || innerWidth, H = container.clientHeight || innerHeight;
    stage.W = W; stage.H = H;
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    composer?.setSize(W, H);
    stage.u = (2 * dist * Math.tan(THREE.MathUtils.degToRad(fov / 2))) / H;
    const r = frameEl.getBoundingClientRect(), cr = container.getBoundingClientRect();
    const x = r.left - cr.left, y = r.top - cr.top;
    const f = stage.frame;
    Object.assign(f, { x, y, w: r.width, h: r.height, visible: r.width > 4 && r.height > 4 });
    const c = stage.px(x + r.width / 2, y + r.height / 2);
    f.cx = c.x; f.cy = c.y; f.ww = r.width * stage.u; f.wh = r.height * stage.u;
    const rad = Math.min(radius, r.width / 2, r.height / 2) * stage.u;
    frameMesh.geometry.dispose();
    frameMesh.geometry = new THREE.ShapeGeometry(roundedRect(Math.max(f.ww, .01), Math.max(f.wh, .01), rad), 24);
    mask.geometry = frameMesh.geometry;
    frameMesh.position.set(f.cx, f.cy, 0); mask.position.copy(frameMesh.position);
    frameMesh.visible = mask.visible = f.visible;
    listeners.forEach((fn) => fn(stage));
  }
  stage.layout = layout;
  const ro = new ResizeObserver(() => layout()); ro.observe(container); ro.observe(frameEl);
  addEventListener('resize', layout);

  // pointer (normalised -1..1) for parallax and gaze
  stage.pointer = { x: 0, y: 0, sx: innerWidth / 2, sy: innerHeight / 2 };
  const onMove = (e) => { stage.pointer.sx = e.clientX; stage.pointer.sy = e.clientY; stage.pointer.x = e.clientX / innerWidth * 2 - 1; stage.pointer.y = e.clientY / innerHeight * 2 - 1; };
  addEventListener('pointermove', onMove, { passive: true });

  let raf = 0, last = performance.now(), running = true;
  stage.render = () => (composer ? composer.render() : renderer.render(scene, camera));
  stage.loop = (fn, still = false, warmup = 6) => {
    // run the simulation ahead so the first frame already looks "in motion"
    for (let i = 0, t0 = performance.now() / 1000 - warmup; i < warmup * 20; i++) fn(0.05, t0 + i * 0.05);
    if (still) { stage.render(); return; }
    // adaptive resolution: watch ~1.5 s windows; below ~45 fps drop the pixel ratio a notch (never under 1),
    // and if there is lots of headroom later, climb back toward the screen's native sharpness
    // Every step down is a trial: if rendering fewer pixels doesn't actually make frames faster (the browser
    // is capping the frame rate, e.g. battery saver at 30 fps), the resolution goes straight back up and
    // we stop stepping down — so a capped browser never gets a blurry picture for nothing.
    let win = 0, frames = 0, settle = 1.5, trial = null, noDrop = false;
    const applyPr = (v) => { renderer.setPixelRatio(v); renderer.setSize(stage.W, stage.H, false); composer?.setSize(stage.W, stage.H); };
    const tune = (dtRaw) => {
      if (window.__login3dFixedRes) return; // test hook: keep full resolution for screenshots
      win += dtRaw; frames++;
      if (win < 1.5) return;
      const fps = frames / win; win = 0; frames = 0;
      if ((settle -= 1.5) > 0) return; // ignore start-up hitches
      const pr = renderer.getPixelRatio();
      if (trial) {
        const helped = fps > trial.fps * 1.15;
        if (!helped) { applyPr(trial.pr); noDrop = true; trial = null; settle = 3; return; }
        trial = null;
      }
      if (fps < 45 && pr > 1 && !noDrop) { trial = { pr, fps }; applyPr(Math.max(1, pr - 0.25)); settle = 1.5; }
      else if (fps > 58 && pr < maxDpr) { applyPr(Math.min(maxDpr, pr + 0.25)); settle = 3; }
    };
    const tick = (t) => {
      if (!running) return;
      const dtRaw = (t - last) / 1000, dt = Math.min(0.05, dtRaw); last = t;
      if (!document.hidden) { fn(dt, t / 1000); stage.render(); if (dtRaw < 1) tune(dtRaw); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  stage.dispose = () => {
    running = false; cancelAnimationFrame(raf); ro.disconnect();
    removeEventListener('resize', layout); removeEventListener('pointermove', onMove);
    scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
    composer?.dispose?.(); renderer.dispose(); renderer.domElement.remove();
  };
  return stage;
}

export function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function radial(color = '#6d4dff') {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function cardTexture(title, sub, accent) {
  const w = 512, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,16,44,0.85)'; g.beginPath(); g.roundRect(0, 0, w, h, 40); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 3; g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, 38); g.stroke();
  g.fillStyle = accent; g.beginPath(); g.arc(56, 100, 14, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.font = '700 46px Manrope, Inter, system-ui'; g.fillText(title, 90, 116);
  g.fillStyle = 'rgba(255,255,255,.72)'; g.font = '600 34px Manrope, Inter, system-ui'; g.fillText(sub, 48, 182);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/**
 * Watches the sign-in form: which field has focus, how much is typed, where the caret roughly is,
 * plus sign-in results announced by the app via `window.dispatchEvent(new CustomEvent('ira-login', { detail: 'error' | 'success' }))`.
 */
export function watchForm(cb) {
  const state = { field: null, length: 0, caret: null, typedAt: 0, result: null, resultAt: 0 };
  const kind = (el) => (el instanceof HTMLInputElement ? (el.type === 'password' || el.autocomplete === 'current-password' ? 'password' : ['text', 'email', 'tel'].includes(el.type) || el.type === '' ? 'email' : null) : null);
  const caretOf = (el) => {
    const r = el.getBoundingClientRect();
    const approx = Math.min(r.width - 24, 48 + (el.value || '').length * 8.2);
    return { x: r.left + approx, y: r.top + r.height / 2 };
  };
  const onFocus = (e) => { const k = kind(e.target); if (!k) return; state.field = k; state.length = e.target.value.length; state.caret = caretOf(e.target); cb(state, 'focus'); };
  const onBlur = (e) => { if (!kind(e.target)) return; setTimeout(() => { if (!kind(document.activeElement)) { state.field = null; state.caret = null; cb(state, 'blur'); } }, 0); };
  const onInput = (e) => { const k = kind(e.target); if (!k) return; state.field = k; state.length = e.target.value.length; state.caret = caretOf(e.target); state.typedAt = performance.now(); cb(state, 'input'); };
  const onResult = (e) => { state.result = e.detail; state.resultAt = performance.now(); cb(state, e.detail); };
  document.addEventListener('focusin', onFocus); document.addEventListener('focusout', onBlur); document.addEventListener('input', onInput, true);
  addEventListener('ira-login', onResult);
  const a = document.activeElement; if (kind(a)) onFocus({ target: a });
  return () => { document.removeEventListener('focusin', onFocus); document.removeEventListener('focusout', onBlur); document.removeEventListener('input', onInput, true); removeEventListener('ira-login', onResult); };
}

export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
