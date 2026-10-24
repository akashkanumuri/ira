// IRA-BOT — a friendly robot climbs out of the portal and leans on the sign-in card.
// Eyes follow the cursor and what you type, it covers its eyes for the password,
// shakes its head on a wrong password and jumps for joy when you sign in.
import { THREE, RoundedBoxGeometry, createStage, radial, watchForm, damp, roundedRect } from './common.js';

const IST = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

export function mount({ container, frameEl, formEl, reduced = false }) {
  const S = createStage({ container, frameEl, transparent: true, frameColor: 0x0b0a1a });
  const { scene } = S;
  const proj = (z) => (S.dist - z) / S.dist;
  const inside = (m) => { S.inside(m); m.transparent = true; m.depthTest = false; return m; };

  // ---------------- inside the portal: a holographic workspace
  const room = new THREE.Group(); scene.add(room);
  const wall = new THREE.GridHelper(90, 45, 0xb69cff, 0x5a48c8); wall.rotation.x = Math.PI / 2; inside(wall.material); wall.material.opacity = .32; room.add(wall);
  const floor = new THREE.GridHelper(90, 45, 0x67e8f9, 0x2a6a8a); inside(floor.material); floor.material.opacity = .45; room.add(floor);
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), inside(new THREE.MeshBasicMaterial({ map: radial('#5b3cff'), opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false }))); room.add(haze);
  const stG = new THREE.BufferGeometry(); const stp = []; for (let i = 0; i < 600; i++) stp.push((Math.random() - .5) * 46, (Math.random() - .5) * 46, 0);
  stG.setAttribute('position', new THREE.Float32BufferAttribute(stp, 3));
  const stars = new THREE.Points(stG, inside(new THREE.PointsMaterial({ color: 0xffffff, size: .07, opacity: .7, depthWrite: false }))); room.add(stars);
  const neon = (c, k = 2) => inside(new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) }));
  const clock = new THREE.Group(); room.add(clock);
  clock.add(new THREE.Mesh(new THREE.TorusGeometry(5.2, .07, 12, 160), neon(0xa78bfa)));
  for (let i = 0; i < 12; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(.12, i % 3 ? .45 : .9, .05), neon(0x67e8f9)); const a = i / 12 * Math.PI * 2; t.position.set(Math.sin(a) * 4.6, Math.cos(a) * 4.6, 0); t.rotation.z = -a; clock.add(t); }
  const mkHand = (l, w, c) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(w, l, .05), neon(c)); m.position.y = l / 2; g.add(m); clock.add(g); return g; };
  const hMin = mkHand(3.8, .1, 0xffffff), hHour = mkHand(2.6, .18, 0xf472b6), hSec = mkHand(4.2, .04, 0x67e8f9);
  const cubes = [[-3, 2, -8, 0x34d399], [2.5, -1, -6, 0xfbbf24], [-1, -3.5, -9, 0x38bdf8], [3.5, 3.5, -12, 0xf472b6]].map(([x, y, z, c], i) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(1, 1, 1, 4, .2), inside(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: .6, metalness: .2, roughness: .3 })));
    m.userData = { x, y, z, i }; room.add(m); return m;
  });

  // occluder: anything of the robot behind the portal face stays "inside"
  const occ = new THREE.Mesh(S.frameMesh.geometry, new THREE.MeshBasicMaterial({ colorWrite: false })); occ.renderOrder = 1; scene.add(occ);

  // ---------------- the robot
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf6f5ff, roughness: .22, clearcoat: 1, clearcoatRoughness: .08, sheen: .3 });
  const dark = new THREE.MeshPhysicalMaterial({ color: 0x0c0b1d, roughness: .08, metalness: .4, clearcoat: 1 });
  const violet = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, emissive: 0x7c3aed, emissiveIntensity: 1.6 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x67e8f9).multiplyScalar(1.4), toneMapped: false });
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xc8a96a, metalness: 1, roughness: .2 });
  const R = (geo, mat) => new THREE.Mesh(geo, mat);

  const bot = new THREE.Group(); scene.add(bot);
  const rig = new THREE.Group(); bot.add(rig); // bob / jump
  const head = new THREE.Group(); head.position.set(0, 1.55, 0); rig.add(head);
  head.add(R(new RoundedBoxGeometry(2.3, 1.75, 1.7, 8, .62), white));
  const visor = R(new RoundedBoxGeometry(1.95, 1.2, .2, 6, .45), dark); visor.position.set(0, -.02, .8); head.add(visor);
  const eyes = new THREE.Group(); eyes.position.set(0, -.05, .93); head.add(eyes);
  const eyeGeo = new THREE.CapsuleGeometry(.13, .22, 8, 16);
  const eyeL = R(eyeGeo, eyeMat), eyeR = R(eyeGeo, eyeMat); eyeL.position.x = -.42; eyeR.position.x = .42; eyes.add(eyeL, eyeR);
  const happyGeo = new THREE.TorusGeometry(.16, .045, 8, 24, Math.PI);
  const hapL = R(happyGeo, eyeMat), hapR = R(happyGeo, eyeMat); hapL.position.set(-.42, -.05, 0); hapR.position.set(.42, -.05, 0); hapL.visible = hapR.visible = false; eyes.add(hapL, hapR);
  const mouth = R(new THREE.TorusGeometry(.18, .035, 8, 24, Math.PI), eyeMat); mouth.position.set(0, -.36, .93); mouth.rotation.z = Math.PI; head.add(mouth);
  [-1.2, 1.2].forEach((x) => { const ear = R(new THREE.CylinderGeometry(.32, .32, .22, 32), white); ear.rotation.z = Math.PI / 2; ear.position.set(x, 0, 0); head.add(ear); const ring = R(new THREE.TorusGeometry(.27, .05, 8, 32), violet); ring.rotation.y = Math.PI / 2; ring.position.set(x * 1.1, 0, 0); head.add(ring); });
  const ant = R(new THREE.CylinderGeometry(.035, .035, .55, 12), white); ant.position.set(-.3, 1.12, 0); ant.rotation.z = .25; head.add(ant);
  const bulb = R(new THREE.SphereGeometry(.15, 24, 24), violet); bulb.position.set(-.37, 1.42, 0); head.add(bulb);
  const glowMat = new THREE.SpriteMaterial({ map: radial('#a78bfa'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const bulbGlow = new THREE.Sprite(glowMat); bulbGlow.scale.set(1.3, 1.3, 1); bulbGlow.position.copy(bulb.position); head.add(bulbGlow);

  const body = R(new RoundedBoxGeometry(1.6, 1.5, 1.1, 8, .5), white); body.position.set(0, 0, -.05); rig.add(body);
  const chestCanvas = document.createElement('canvas'); chestCanvas.width = 256; chestCanvas.height = 128;
  const chestTex = new THREE.CanvasTexture(chestCanvas); chestTex.colorSpace = THREE.SRGBColorSpace;
  const drawChest = (txt, color = '#67e8f9') => { const g = chestCanvas.getContext('2d'); g.fillStyle = '#0c0b1d'; g.fillRect(0, 0, 256, 128); g.fillStyle = color; g.font = '800 66px Manrope, Inter, system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 128, 68); chestTex.needsUpdate = true; };
  const chest = R(new RoundedBoxGeometry(.95, .5, .08, 4, .12), [dark, dark, dark, dark, new THREE.MeshBasicMaterial({ map: chestTex, toneMapped: false }), dark]); chest.position.set(0, .12, .55); rig.add(chest);
  const neck = R(new THREE.CylinderGeometry(.28, .32, .3, 24), dark); neck.position.y = .82; rig.add(neck);

  const limb = (len) => new THREE.CapsuleGeometry(.2, len, 8, 16);
  const mkArm = (side) => {
    const a = new THREE.Group(); a.position.set(.95 * side, .35, .05); rig.add(a);
    const up = R(limb(.8), white); up.position.y = .55; a.add(up);
    const hand = R(new THREE.SphereGeometry(.3, 24, 24), white); hand.position.y = 1.15; a.add(hand);
    return a;
  };
  const armR = mkArm(1), armL = mkArm(-1);
  const watch = new THREE.Group(); watch.position.set(0, 1.45, .2); watch.rotation.set(.3, 0, -.9); armL.add(watch);
  watch.add(R(new THREE.TorusGeometry(.42, .09, 16, 48), gold));
  watch.add(R(new THREE.CircleGeometry(.36, 40), new THREE.MeshBasicMaterial({ color: 0xffffff })));
  const wHand = new THREE.Group(); watch.add(wHand); const wh = R(new THREE.BoxGeometry(.04, .28, .02), new THREE.MeshBasicMaterial({ color: 0xf43f5e })); wh.position.set(0, .14, .02); wHand.add(wh);
  const crown = R(new THREE.CylinderGeometry(.08, .08, .16, 16), gold); crown.position.y = .56; watch.add(crown);
  const legF = R(limb(.7), white); legF.position.set(.45, -1.05, .45); legF.rotation.set(.9, 0, .15); rig.add(legF);
  const footF = R(new RoundedBoxGeometry(.6, .32, .8, 4, .14), dark); footF.position.set(.5, -1.45, 1.05); rig.add(footF);
  const legB = R(limb(.7), white); legB.position.set(-.45, -1.05, -.9); legB.rotation.set(-.8, 0, -.1); rig.add(legB);
  bot.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.transparent = true; }); o.renderOrder = 5; } });

  // portal ripple where the robot crosses the frame, plus a confetti burst for success
  const rippleMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xa78bfa).multiplyScalar(1.5), transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false });
  const ripple = R(new THREE.RingGeometry(1, 1.06, 96), rippleMat); scene.add(ripple);
  const ripple2 = R(ripple.geometry, rippleMat.clone()); ripple2.material.opacity = .35; scene.add(ripple2);
  const CF = 160, cfPos = new Float32Array(CF * 3), cfCol = new Float32Array(CF * 3), cfVel = [];
  const cfGeo = new THREE.BufferGeometry(); cfGeo.setAttribute('position', new THREE.BufferAttribute(cfPos, 3)); cfGeo.setAttribute('color', new THREE.BufferAttribute(cfCol, 3));
  const PAL = [0x8b5cf6, 0x22d3ee, 0x34d399, 0xfbbf24, 0xf472b6];
  for (let i = 0; i < CF; i++) { const c = new THREE.Color(PAL[i % PAL.length]); cfCol.set([c.r, c.g, c.b], i * 3); cfVel.push(new THREE.Vector3()); }
  const confetti = new THREE.Points(cfGeo, new THREE.PointsMaterial({ size: .14, vertexColors: true, transparent: true, opacity: 0, depthWrite: false })); confetti.renderOrder = 6; scene.add(confetti);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8b7cff, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(6, 8, 10); scene.add(key);
  const rimL = new THREE.DirectionalLight(0x8b5cf6, 3); rimL.position.set(-8, 2, -4); scene.add(rimL);

  // speech bubble (HTML for crisp, accessible text)
  const bubble = document.createElement('div');
  bubble.setAttribute('aria-hidden', 'true');
  bubble.style.cssText = 'position:absolute;z-index:2;padding:12px 18px;border-radius:22px;background:#fff;color:#0d0d1a;font:700 15px/1.25 Manrope,Inter,system-ui;box-shadow:0 18px 40px -16px rgba(40,20,120,.45),0 0 0 1px rgba(20,20,40,.06);white-space:nowrap;transform:translate(-50%,-100%);transition:opacity .25s, transform .35s cubic-bezier(.2,.8,.2,1);pointer-events:none';
  const bubbleSub = 'font-weight:500;color:#6b6b80;font-size:13px;display:block;margin-top:2px';
  container.appendChild(bubble);
  const say = (a, b) => { bubble.innerHTML = `${a}${b ? `<span style="${bubbleSub}">${b}</span>` : ''}`; bubble.animate([{ transform: 'translate(-50%,-100%) scale(.9)' }, { transform: 'translate(-50%,-100%) scale(1)' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }); };
  say('Hi there! 👋', 'Ready to start your day?');

  // ---------------- layout
  let mode = 'desk', base = new THREE.Vector3(), scale = 1;
  S.onLayout(() => {
    const f = S.frame, fr = formEl.getBoundingClientRect(), cr = container.getBoundingClientRect();
    const formTop = fr.top - cr.top, formLeft = fr.left - cr.left, formRight = fr.right - cr.left;
    const zr = -16;
    room.position.set(0, 0, 0);
    wall.position.set(f.cx * proj(zr) , f.cy * proj(zr), zr - 2);
    floor.position.set(f.cx * proj(-8), f.cy - f.wh * .42, -8);
    haze.position.set(f.cx * proj(zr), f.cy * proj(zr) - 2, zr);
    stars.position.set(f.cx * proj(zr + .5), f.cy * proj(zr + .5), zr + .5);
    clock.position.set(f.cx * proj(-17), f.cy * proj(-17) + f.wh * .32, -17);
    clock.scale.setScalar(Math.min(1, f.ww / 10));
    cubes.forEach((m) => { const { x, y, z } = m.userData; m.position.set(f.cx * proj(z) + x * Math.min(1, f.ww / 10), f.cy * proj(z) + y * Math.min(1, f.wh / 12), z); });
    const wide = f.visible && f.w > 320 && f.h > 360;
    mode = wide ? 'desk' : 'phone';
    if (wide) {
      scale = Math.max(.75, Math.min(1.15, S.H / 900));
      base.copy(S.px(f.x + f.w + 40 * scale, formTop + fr.height * .6, 1.2));
      bot.rotation.set(.05, -.5, .06);
      const rp = S.px(f.x + f.w, formTop + fr.height * .6 + 55 * scale); ripple.position.set(rp.x, rp.y, .05); ripple2.position.copy(ripple.position);
      ripple.scale.set(.55 * scale, 1.5 * scale, 1); ripple2.scale.set(.8 * scale, 2.1 * scale, 1); ripple.visible = ripple2.visible = true;
    } else {
      scale = .55;
      base.copy(S.px(formRight - 64, formTop - 48, 1.5));
      bot.rotation.set(.05, -.35, 0);
      ripple.visible = ripple2.visible = false;
    }
    bot.position.copy(base); bot.scale.setScalar(scale);
  });
  S.layout();

  // ---------------- behaviour
  let pose = 'idle', poseUntil = 0, field = null, gaze = null, blinkAt = 2, jump = 0, shakeT = 0;
  const POSES = {
    idle: { rArm: [0, .2, -0.42], rLen: 1, lArm: [-.5, 0, .9], lLen: 1, headY: 1.55 },
    cover: { rArm: [.8, 0, .85], rLen: 1.45, lArm: [.8, 0, -.85], lLen: 1.45, headY: 1.38 },
    happy: { rArm: [0, 0, -2.5], rLen: 1, lArm: [0, 0, 2.5], lLen: 1, headY: 1.6 },
    sad: { rArm: [0, 0, -.25], rLen: 1, lArm: [0, 0, .25], lLen: 1, headY: 1.45 },
  };
  const setPose = (p, ms = 0) => { pose = p; poseUntil = ms ? performance.now() + ms : 0; };
  const stop = watchForm((st, ev) => {
    field = st.field; gaze = st.caret;
    if (ev === 'focus' || ev === 'input' || ev === 'blur') {
      if (pose === 'happy' || pose === 'sad') return;
      if (field === 'password') { setPose('cover'); say('I’m not looking 🙈', 'Promise.'); }
      else { setPose('idle'); if (field === 'email') say(st.length ? 'Looking good! ✍️' : 'Your email or employee ID', st.length ? '' : 'I’ll wait.'); else say('Hi there! 👋', 'Ready to start your day?'); }
    }
    if (ev === 'error') { setPose('sad', 2600); shakeT = 1; eyeMat.color.set(0xf43f5e); say('Hmm, that didn’t work 😕', 'Check your details and try again.'); drawChest('OOPS', '#f43f5e'); }
    if (ev === 'success') { setPose('happy', 4000); jump = 1; burst(); say('Let’s go! 🚀', 'Starting your day…'); drawChest('GO!', '#34d399'); }
  });
  function burst() {
    const hp = new THREE.Vector3(); head.getWorldPosition(hp);
    for (let i = 0; i < CF; i++) { cfPos.set([hp.x, hp.y, hp.z], i * 3); cfVel[i].set((Math.random() - .5) * 8, 4 + Math.random() * 6, (Math.random() - .2) * 4); }
    confetti.material.opacity = 1;
  }

  const hpos = new THREE.Vector3(), tgt = new THREE.Vector3();
  let lastSec = -1;
  S.loop((dt, t) => {
    const now = performance.now();
    if (poseUntil && now > poseUntil) { poseUntil = 0; eyeMat.color.set(0x67e8f9).multiplyScalar(1.4); drawChestTime(); setPose(field === 'password' ? 'cover' : 'idle'); if (!field) say('Hi there! 👋', 'Ready to start your day?'); }
    const P = POSES[pose];
    // arms
    armR.rotation.x = damp(armR.rotation.x, P.rArm[0], 8, dt); armR.rotation.y = damp(armR.rotation.y, P.rArm[1], 8, dt); armR.rotation.z = damp(armR.rotation.z, P.rArm[2] + (pose === 'idle' ? Math.sin(t * 3) * .12 : pose === 'happy' ? Math.sin(t * 14) * .25 : 0), 8, dt);
    armL.rotation.x = damp(armL.rotation.x, P.lArm[0], 8, dt); armL.rotation.y = damp(armL.rotation.y, P.lArm[1], 8, dt); armL.rotation.z = damp(armL.rotation.z, P.lArm[2] + (pose === 'happy' ? -Math.sin(t * 14) * .25 : 0), 8, dt);
    armR.scale.y = damp(armR.scale.y, P.rLen, 8, dt); armL.scale.y = damp(armL.scale.y, P.lLen, 8, dt);
    head.position.y = damp(head.position.y, P.headY, 8, dt);
    // gaze: caret when typing, otherwise the pointer
    const gx = gaze && field === 'email' ? gaze.x : S.pointer.sx, gy = gaze && field === 'email' ? gaze.y : S.pointer.sy;
    const cr = container.getBoundingClientRect();
    tgt.copy(S.px(gx - cr.left, gy - cr.top, 4));
    head.getWorldPosition(hpos);
    const dx = tgt.x - hpos.x, dy = tgt.y - hpos.y, dz = Math.max(2, tgt.z - hpos.z + 4);
    const yaw = THREE.MathUtils.clamp(Math.atan2(dx, dz) - bot.rotation.y * .6, -.7, .7), pitch = THREE.MathUtils.clamp(-Math.atan2(dy, dz), -.45, .45);
    const shake = shakeT > 0 ? Math.sin(t * 30) * .35 * shakeT : 0; shakeT = Math.max(0, shakeT - dt * .9);
    head.rotation.y = damp(head.rotation.y, (pose === 'cover' ? 0 : yaw) + shake, 6, dt);
    head.rotation.x = damp(head.rotation.x, pose === 'cover' ? .35 : pose === 'sad' ? .3 : pitch, 6, dt);
    head.rotation.z = damp(head.rotation.z, pose === 'happy' ? Math.sin(t * 8) * .12 : .06, 6, dt);
    eyes.position.x = damp(eyes.position.x, THREE.MathUtils.clamp(yaw * .35, -.18, .18), 10, dt);
    eyes.position.y = damp(eyes.position.y, -.05 + THREE.MathUtils.clamp(-pitch * .3, -.1, .1), 10, dt);
    // blink
    blinkAt -= dt; const blinking = blinkAt < .12 && blinkAt > 0; if (blinkAt < 0) blinkAt = 2.5 + Math.random() * 3;
    eyeL.scale.y = eyeR.scale.y = damp(eyeL.scale.y, blinking ? .1 : 1, 30, dt);
    eyeL.visible = eyeR.visible = pose !== 'happy'; hapL.visible = hapR.visible = pose === 'happy';
    mouth.scale.y = damp(mouth.scale.y, pose === 'sad' ? -1 : 1, 10, dt);
    // bob + jump
    jump = Math.max(0, jump - dt * .8);
    rig.position.y = Math.sin(t * 1.6) * .08 + (pose === 'happy' ? Math.abs(Math.sin(t * 7)) * .6 : 0) + Math.sin(jump * Math.PI) * 1.2;
    bot.rotation.z = damp(bot.rotation.z, .06 + Math.sin(t * 1.1) * .02, 4, dt);
    // antenna + ripple + room
    bulb.scale.setScalar(1 + Math.sin(t * 4) * .12); glowMat.opacity = .6 + Math.sin(t * 4) * .3;
    rippleMat.opacity = .5 + Math.sin(t * 2.4) * .3; ripple2.material.opacity = .25 + Math.sin(t * 2.4 + 1) * .15;
    cubes.forEach((m) => { m.rotation.x += dt * .4; m.rotation.y += dt * (.3 + m.userData.i * .05); m.position.y += Math.sin(t * 1.3 + m.userData.i) * .004; });
    const d = IST(); const s = d.getSeconds(), mi = d.getMinutes(), h = d.getHours() % 12;
    hSec.rotation.z = -s / 60 * Math.PI * 2; hMin.rotation.z = -(mi + s / 60) / 60 * Math.PI * 2; hHour.rotation.z = -(h + mi / 60) / 12 * Math.PI * 2;
    wHand.rotation.z = -(s + (now % 1000) / 1000) / 60 * Math.PI * 2;
    if (s !== lastSec && !poseUntil) { lastSec = s; drawChestTime(); }
    // confetti physics
    if (confetti.material.opacity > 0) {
      for (let i = 0; i < CF; i++) { const v = cfVel[i]; v.y -= 9.8 * dt; cfPos[i * 3] += v.x * dt; cfPos[i * 3 + 1] += v.y * dt; cfPos[i * 3 + 2] += v.z * dt; }
      cfGeo.attributes.position.needsUpdate = true; confetti.material.opacity = Math.max(0, confetti.material.opacity - dt * .45);
    }
    // bubble follows the head
    const hs = S.toScreen(hpos.clone().add(new THREE.Vector3(0, 1.6 * scale, 0)));
    bubble.style.left = `${hs.x + (mode === 'desk' ? 10 : -40)}px`; bubble.style.top = `${hs.y - 6}px`;
  }, reduced);
  function drawChestTime() { const d = IST(); drawChest(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`); }
  drawChestTime();

  return { dispose: () => { stop(); bubble.remove(); S.dispose(); } };
}
