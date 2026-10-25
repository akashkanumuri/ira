// SIGMA 1 mascot, built to the client's character sheet: faceted black helmet head with a
// glass face screen and pink scan-line eyes, headphone ear modules with amber light rings
// (fin on the left ear), charcoal fleece zip hoodie, black articulated robot hands,
// wide sweatpants with light rolled cuffs, and black/white canvas sneakers.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const AMBER = 0xff9a2e, PINK = 0xff4f8b;

const crisp = (t) => { t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; return t; };
function fleeceTexture() {
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 36000; i++) { const v = 90 + Math.random() * 80 | 0; g.fillStyle = `rgba(${v},${v},${v},.5)`; g.beginPath(); g.arc(Math.random() * N, Math.random() * N, .7 + Math.random() * .9, 0, 7); g.fill(); }
  const t = crisp(new THREE.CanvasTexture(c)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); return t;
}
function scanTexture() {
  // drawn at 4× size with soft-edged scan lines so the eyes stay clean when magnified
  const W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#7a1838'; g.fillRect(0, 0, W, H);
  for (let y = 8; y < H; y += 24) { const gr = g.createLinearGradient(0, y, 0, y + 12); gr.addColorStop(0, 'rgba(255,208,223,.35)'); gr.addColorStop(.5, '#ffe2ec'); gr.addColorStop(1, 'rgba(255,208,223,.35)'); g.fillStyle = gr; g.beginPath(); g.roundRect(8, y, W - 16, 12, 6); g.fill(); }
  const t = crisp(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let glowTex;
function glow(color, scale, opacity = .6) {
  if (!glowTex) { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.3, 'rgba(255,255,255,.4)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); glowTex = new THREE.CanvasTexture(c); }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(scale); return s;
}
function octagon(w, h, c) {
  const x = w / 2, y = h / 2, s = new THREE.Shape();
  s.moveTo(-x + c, -y); s.lineTo(x - c, -y); s.lineTo(x, -y + c); s.lineTo(x, y - c); s.lineTo(x - c, y); s.lineTo(-x + c, y); s.lineTo(-x, y - c); s.lineTo(-x, -y + c); s.closePath();
  return s;
}

export function buildHoodbot() {
  const fleeceMap = fleeceTexture();
  const fleece = new THREE.MeshPhysicalMaterial({ color: 0x3c3c42, map: fleeceMap, bumpMap: fleeceMap, bumpScale: 1.2, roughness: 1, sheen: .25, sheenColor: new THREE.Color(0x77777f), sheenRoughness: .8 });
  const fleeceDark = fleece.clone(); fleeceDark.color = new THREE.Color(0x2f2f34);
  const sweat = fleece.clone(); sweat.color = new THREE.Color(0x45454b);
  const cuffMat = fleece.clone(); cuffMat.color = new THREE.Color(0x8e8e94);
  // micro-surface: fine speckle + faint brushed streaks so reflections break up like real painted metal
  const microTex = (() => {
    const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 20000; i++) { const v = 110 + Math.random() * 90 | 0; g.fillStyle = `rgba(${v},${v},${v},.45)`; g.fillRect(Math.random() * N, Math.random() * N, 1.2, 1.2); }
    for (let i = 0; i < 120; i++) { g.strokeStyle = `rgba(${Math.random() < .5 ? '70,70,70' : '200,200,200'},.15)`; g.beginPath(); const y = Math.random() * N; g.moveTo(0, y); g.lineTo(N, y + (Math.random() - .5) * 40); g.stroke(); }
    const t = crisp(new THREE.CanvasTexture(c)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); return t;
  })();
  const shell = new THREE.MeshPhysicalMaterial({ color: 0x2a2b30, roughness: .42, roughnessMap: microTex, metalness: .55, clearcoat: .6, clearcoatRoughness: .25 });
  const shellDark = new THREE.MeshPhysicalMaterial({ color: 0x18191d, roughness: .45, metalness: .5, clearcoat: .4, flatShading: true });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x050507, roughness: .06, metalness: .1, clearcoat: 1, clearcoatRoughness: .02 });
  const robo = new THREE.MeshPhysicalMaterial({ color: 0x141418, roughness: .36, roughnessMap: microTex, metalness: .65, clearcoat: .5 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 1, roughness: .25 });
  const cord = new THREE.MeshStandardMaterial({ color: 0xe9e9ec, roughness: .7 });
  const canvasBlack = new THREE.MeshStandardMaterial({ color: 0x232327, roughness: .85 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: .6 });
  const amber = new THREE.MeshBasicMaterial({ color: new THREE.Color(AMBER).multiplyScalar(1.3), toneMapped: false });
  const eyeMat = new THREE.MeshBasicMaterial({ map: scanTexture(), color: new THREE.Color(1.6, 1.15, 1.3), toneMapped: false });
  const M = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; return m; };

  const root = new THREE.Group();
  const rig = new THREE.Group(); root.add(rig);

  // ───── legs: wide sweatpants, rolled cuffs, canvas sneakers
  const mkLeg = (s) => {
    const l = new THREE.Group(); l.position.set(.3 * s, 1.2, 0); rig.add(l);
    const pant = M(new THREE.CylinderGeometry(.27, .34, .72, 28), sweat); pant.position.y = -.32; l.add(pant);
    const crease = M(new THREE.TorusGeometry(.32, .025, 8, 28), sweat); crease.rotation.x = Math.PI / 2; crease.position.y = -.48; l.add(crease);
    const cuff = M(new THREE.CylinderGeometry(.355, .355, .24, 28), cuffMat); cuff.position.y = -.72; l.add(cuff);
    const lip = M(new THREE.TorusGeometry(.35, .035, 8, 28), cuffMat); lip.rotation.x = Math.PI / 2; lip.position.y = -.6; l.add(lip);
    const shoe = new THREE.Group(); shoe.position.set(0, -1.08, .1); l.add(shoe);
    const sole = M(new RoundedBoxGeometry(.46, .13, .78, 4, .05), rubber); sole.position.y = -.05; shoe.add(sole);
    const stripe = M(new RoundedBoxGeometry(.47, .025, .79, 2, .01), canvasBlack); stripe.position.y = -.02; shoe.add(stripe);
    const upper = M(new RoundedBoxGeometry(.4, .3, .6, 5, .12), canvasBlack); upper.position.set(0, .13, -.05); shoe.add(upper);
    const toe = M(new THREE.SphereGeometry(.2, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), rubber); toe.scale.set(1.05, .55, 1); toe.position.set(0, .01, .22); shoe.add(toe);
    const tongue = M(new RoundedBoxGeometry(.2, .1, .3, 2, .04), canvasBlack); tongue.position.set(0, .26, .04); tongue.rotation.x = -.35; shoe.add(tongue);
    for (let i = 0; i < 3; i++) { const lace = M(new RoundedBoxGeometry(.2, .025, .04, 2, .01), cord); lace.position.set(0, .26 - i * .035, .13 - i * .075); lace.rotation.x = -.35; shoe.add(lace); }
    const collar = M(new THREE.TorusGeometry(.17, .03, 8, 24), rubber); collar.rotation.x = Math.PI / 2; collar.scale.set(1, 1.2, 1); collar.position.set(0, .28, -.15); shoe.add(collar);
    return l;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  // ───── hoodie torso
  const body = new THREE.Group(); body.position.y = 1.73; rig.add(body);
  const torso = M(new RoundedBoxGeometry(1.34, 1.08, .86, 8, .34), fleece); body.add(torso);
  const hem = M(new RoundedBoxGeometry(1.36, .16, .88, 4, .07), fleeceDark); hem.position.y = -.5; body.add(hem);
  const zip = M(new THREE.BoxGeometry(.035, 1.0, .02), silver); zip.position.set(0, -.02, .435); body.add(zip);
  const pull = M(new RoundedBoxGeometry(.05, .12, .02, 2, .008), silver); pull.position.set(.02, .36, .45); body.add(pull);
  for (const s of [-1, 1]) {

    const string = M(new THREE.CylinderGeometry(.016, .016, .42, 8), cord); string.position.set(.1 * s, .25, .445); body.add(string);
    const aglet = M(new THREE.CylinderGeometry(.02, .02, .06, 8), silver); aglet.position.set(.1 * s, .02, .445); body.add(aglet);
  }
  const pouch = M(new RoundedBoxGeometry(.9, .32, .06, 3, .025), fleeceDark); pouch.position.set(0, -.25, .42); body.add(pouch);
  for (const s of [-1, 1]) { const op = M(new THREE.BoxGeometry(.03, .3, .065), fleece); op.position.set(.42 * s, -.25, .425); op.rotation.z = .35 * s; body.add(op); }
  // hood bunched behind the neck + collar
  const hood = M(new THREE.SphereGeometry(.62, 32, 20), fleece); hood.scale.set(1.15, .62, .7); hood.position.set(0, .55, -.28); body.add(hood);
  const collarT = M(new THREE.TorusGeometry(.36, .12, 12, 32), fleece); collarT.rotation.x = Math.PI / 2 - .25; collarT.position.set(0, .56, .02); body.add(collarT);
  const neck = M(new THREE.CylinderGeometry(.17, .2, .3, 20), robo); neck.position.y = .7; body.add(neck);

  // ───── arms: fleece sleeves + black articulated hands
  const mkArm = (s) => {
    const a = new THREE.Group(); a.position.set(.68 * s, .32, 0); body.add(a);
    const shoulder = M(new THREE.SphereGeometry(.27, 24, 16), fleece); a.add(shoulder);
    const sleeve = M(new THREE.CapsuleGeometry(.24, .5, 8, 20), fleece); sleeve.position.y = -.38; a.add(sleeve);
    const cuff = M(new THREE.CylinderGeometry(.2, .2, .14, 20), fleeceDark); cuff.position.y = -.72; a.add(cuff);
    const patch = M(new RoundedBoxGeometry(.03, .14, .2, 2, .01), fleeceDark); patch.position.set(.235 * s, -.12, 0); a.add(patch);
    const hand = new THREE.Group(); hand.position.y = -.8; hand.scale.setScalar(1.55); a.add(hand);
    const wrist = M(new THREE.CylinderGeometry(.09, .1, .1, 12), robo); hand.add(wrist);
    const palm = M(new RoundedBoxGeometry(.15, .26, .29, 3, .05), robo); palm.position.y = -.15; hand.add(palm);
    const knuck = M(new RoundedBoxGeometry(.16, .05, .3, 2, .02), shellDark); knuck.position.set(0, -.27, 0); hand.add(knuck);
    for (let f = 0; f < 4; f++) {
      let parent = new THREE.Group(); parent.position.set(0, -.29, (f - 1.5) * .075); parent.rotation.z = -.18 * s; hand.add(parent);
      for (let k = 0; k < 3; k++) {
        const seg = M(new RoundedBoxGeometry(.09, .1 - k * .012, .074, 2, .026), k % 2 ? shellDark : robo); seg.position.y = -.05; parent.add(seg);
        const j = new THREE.Group(); j.position.y = -.1 + k * .012; j.rotation.z = -.32 * s; parent.add(j); parent = j;
      }
    }
    const th = new THREE.Group(); th.position.set(.04 * s, -.12, .14); th.rotation.set(.6, 0, -.3 * s); hand.add(th);
    const t1 = M(new RoundedBoxGeometry(.055, .1, .055, 2, .015), robo); t1.position.y = -.05; th.add(t1);
    const t2 = M(new RoundedBoxGeometry(.05, .08, .05, 2, .015), shellDark); t2.position.y = -.13; th.add(t2);
    a.rotation.z = s * .1;
    return a;
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // ───── head: faceted helmet
  const head = new THREE.Group(); head.position.y = 3.08; rig.add(head);
  const helm = M(new RoundedBoxGeometry(1.86, 1.62, 1.72, 3, .42), shell); head.add(helm);
  const crown = M(new THREE.ExtrudeGeometry(octagon(.9, .9, .25), { depth: .06, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 1 }), shellDark);
  crown.rotation.x = -Math.PI / 2; crown.position.set(0, .8, .05); head.add(crown);
  const brow = M(new THREE.BoxGeometry(.8, .22, .06), shellDark); brow.position.set(0, .62, .8); brow.rotation.x = -.6; head.add(brow);
  // glass face screen
  const face = M(new THREE.ExtrudeGeometry(octagon(1.5, 1.08, .28), { depth: .04, bevelEnabled: true, bevelThickness: .02, bevelSize: .02, bevelSegments: 2 }), glass);
  face.position.set(0, -.1, .84); head.add(face);
  const eyes = new THREE.Group(); eyes.position.set(0, -.06, .91); head.add(eyes);
  const eyeL = M(new THREE.PlaneGeometry(.2, .32), eyeMat), eyeR = M(new THREE.PlaneGeometry(.2, .32), eyeMat);
  eyeL.position.x = -.36; eyeR.position.x = .36; eyes.add(eyeL, eyeR);
  for (const e of [eyeL, eyeR]) { const g = glow(PINK, .9, .5); g.position.z = .02; e.add(g); }
  // side trims (amber LEDs)
  for (const s of [-1, 1]) {
    const led = M(new THREE.BoxGeometry(.03, .03, .3), amber); led.position.set(.62 * s, .74, .4); led.rotation.z = .5 * s; head.add(led);
    const led2 = M(new THREE.BoxGeometry(.02, .14, .02), amber); led2.position.set(1.06 * s, -.42, .3); head.add(led2);
  }
  // ear modules
  const ears = [-1, 1].map((s) => {
    const e = new THREE.Group(); e.position.set(1.08 * s, 0, -.05); head.add(e);
    const cup = M(new THREE.CylinderGeometry(.46, .5, .26, 40), shellDark); cup.rotation.z = Math.PI / 2; e.add(cup);
    const face2 = M(new THREE.CylinderGeometry(.36, .36, .06, 40), shell); face2.rotation.z = Math.PI / 2; face2.position.x = .14 * s; e.add(face2);
    const ring = M(new THREE.TorusGeometry(.27, .022, 8, 48, Math.PI * 1.35), amber); ring.rotation.y = s * Math.PI / 2; ring.rotation.x = .8; ring.position.x = .175 * s; e.add(ring);
    const cap = M(new THREE.CylinderGeometry(.13, .13, .1, 28), robo); cap.rotation.z = Math.PI / 2; cap.position.x = .19 * s; e.add(cap);
    const rg = glow(AMBER, .9, .25); rg.position.x = .25 * s; e.add(rg);
    return e;
  });
  // fin on the robot's left ear (viewer's right)
  const fin = M(new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(.26, 0), new THREE.Vector2(.18, 1.05), new THREE.Vector2(-.02, .95)]), { depth: .08, bevelEnabled: true, bevelThickness: .02, bevelSize: .02, bevelSegments: 1 }), shell);
  fin.rotation.set(0, Math.PI / 2, -.38); fin.position.set(.12, .15, .2); ears[1].add(fin);
  const finLed = M(new THREE.BoxGeometry(.02, .5, .02), amber); finLed.position.set(.2, .6, .05); finLed.rotation.z = -.38; ears[1].add(finLed);

  return { root, rig, head, eyes, eyeL, eyeR, eyeMat, armL, armR, legL, legR, body, hood, ears };
}
