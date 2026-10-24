// The SIGMA 1 mascot: a chibi robot in a knitted hoodie — glossy black visor head,
// glowing pink pill eyes, black mechanical hands, rolled-up pants and pink-white sneakers.
import { THREE, RoundedBoxGeometry } from './common.js';

function knitTexture(base = '#8d8d93') {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 8) { // vertical ribs
    const grd = g.createLinearGradient(x, 0, x + 8, 0);
    grd.addColorStop(0, 'rgba(0,0,0,.18)'); grd.addColorStop(.5, 'rgba(255,255,255,.14)'); grd.addColorStop(1, 'rgba(0,0,0,.18)');
    g.fillStyle = grd; g.fillRect(x, 0, 8, 256);
  }
  for (let y = 0; y < 256; y += 6) { g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(0, y, 256, 1); } // stitches
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '255,255,255'},${Math.random() * .08})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(3, 3); return t;
}

export function buildHoodie() {
  const knitMap = knitTexture();
  const knit = new THREE.MeshPhysicalMaterial({ color: 0x9c9ca3, map: knitMap, bumpMap: knitMap, bumpScale: 1.4, roughness: 1, sheen: .45, sheenColor: new THREE.Color(0xb8b8c0), sheenRoughness: .8 });
  const knitDark = knit.clone(); knitDark.color = new THREE.Color(0x85858c);
  const visorMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0f, roughness: .06, metalness: .35, clearcoat: 1, clearcoatRoughness: .03 });
  const blackMetal = new THREE.MeshPhysicalMaterial({ color: 0x141418, roughness: .3, metalness: .8, clearcoat: .6 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x23232a, roughness: .9 });
  const shoeWhite = new THREE.MeshPhysicalMaterial({ color: 0xfafafa, roughness: .45, clearcoat: .4 });
  const shoePink = new THREE.MeshStandardMaterial({ color: 0xeeb3a3, roughness: .7 });
  const cord = new THREE.MeshStandardMaterial({ color: 0xe8c2b2, roughness: .7 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8fa3).multiplyScalar(1.25), toneMapped: false });
  const M = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };

  const root = new THREE.Group();   // placed in the world
  const rig = new THREE.Group(); root.add(rig); // bob / hop / squash

  // ---------- head + hood
  const head = new THREE.Group(); head.position.set(0, 1.62, 0); rig.add(head);
  const visor = M(new RoundedBoxGeometry(1.7, 1.28, 1.42, 10, .5), visorMat); visor.position.z = .08; head.add(visor);
  const eyes = new THREE.Group(); eyes.position.set(0, .07, .8); head.add(eyes);
  const pill = new THREE.CapsuleGeometry(.058, .17, 6, 16);
  const eyeL = M(pill, eyeMat), eyeR = M(pill, eyeMat); eyeL.position.x = -.32; eyeR.position.x = .32; eyes.add(eyeL, eyeR);
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,90,140,1)'); gr.addColorStop(1, 'rgba(255,90,140,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  [eyeL, eyeR].forEach((e) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.set(.42, .55, 1); e.add(s); });
  // hood: a knitted shell open at the front
  const hood = new THREE.Group(); hood.position.set(0, .05, -.05); head.add(hood);
  const gap = 1.7;
  const shell = M(new THREE.SphereGeometry(1.08, 64, 40, Math.PI / 2 + gap / 2, Math.PI * 2 - gap, 0, Math.PI * .8), knit);
  shell.material = knit; shell.material.side = THREE.DoubleSide; shell.scale.set(1.04, 1.12, 1.16); shell.position.set(0, .06, -.1); hood.add(shell);
  const rim = M(new THREE.TorusGeometry(.95, .11, 14, 64), knitDark); rim.position.set(0, -.02, .7); rim.scale.set(1.0, .8, 1); rim.rotation.x = .08; hood.add(rim);
  // headphone (left) + antenna (right)
  const phone = M(new THREE.CylinderGeometry(.3, .3, .2, 40), blackMetal); phone.rotation.z = Math.PI / 2; phone.position.set(-1.2, .02, .05); head.add(phone);
  const phoneRing = M(new THREE.TorusGeometry(.2, .03, 10, 40), new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: .9, roughness: .25 })); phoneRing.rotation.y = Math.PI / 2; phoneRing.position.set(-1.31, .02, .05); head.add(phoneRing);
  const antenna = M(new THREE.CylinderGeometry(.012, .012, .7, 8), blackMetal); antenna.position.set(.62, 1.1, -.15); antenna.rotation.z = -.28; head.add(antenna);
  const tip = M(new THREE.SphereGeometry(.04, 12, 12), eyeMat); tip.position.set(.72, 1.43, -.15); head.add(tip);

  // ---------- hoodie body
  const body = new THREE.Group(); body.position.y = .45; rig.add(body);
  const torso = M(new RoundedBoxGeometry(1.5, 1.08, 1.04, 8, .44), knit); torso.scale.set(1, 1, 1); body.add(torso);
  const band = M(new THREE.CylinderGeometry(.66, .66, .16, 40), knitDark); band.scale.set(1.05, 1, .74); band.position.y = -.5; body.add(band);
  const pocket = M(new RoundedBoxGeometry(.8, .34, .08, 4, .06), knitDark); pocket.position.set(0, -.18, .49); body.add(pocket);
  const collar = M(new THREE.TorusGeometry(.38, .1, 12, 32), knitDark); collar.rotation.x = Math.PI / 2; collar.position.set(0, .52, .05); body.add(collar);
  [-.12, .12].forEach((x, i) => { const s = M(new THREE.CylinderGeometry(.018, .018, .55, 8), cord); s.position.set(x, .2, .52); s.rotation.z = i ? -.05 : .05; body.add(s); const t = M(new THREE.CylinderGeometry(.026, .026, .07, 10), blackMetal); t.position.set(x + (i ? -.012 : .012), -.09, .53); body.add(t); });

  // ---------- arms: knitted sleeve + cuff + black mechanical hand
  const mkArm = (side) => {
    const a = new THREE.Group(); a.position.set(.74 * side, .78, 0); rig.add(a);
    const sleeve = M(new THREE.CapsuleGeometry(.2, .5, 8, 16), knit); sleeve.position.y = -.38; a.add(sleeve);
    const cuff = M(new THREE.CylinderGeometry(.17, .17, .12, 24), knitDark); cuff.position.y = -.74; a.add(cuff);
    const hand = new THREE.Group(); hand.position.y = -.88; a.add(hand);
    hand.add(M(new THREE.SphereGeometry(.13, 20, 16), blackMetal));
    for (let f = 0; f < 3; f++) { const fg = M(new THREE.CapsuleGeometry(.032, .12, 4, 8), blackMetal); fg.position.set((f - 1) * .07, -.14, .04); fg.rotation.x = .3; hand.add(fg); }
    const th = M(new THREE.CapsuleGeometry(.035, .08, 4, 8), blackMetal); th.position.set(.1 * -side, -.06, .08); th.rotation.z = side * .8; hand.add(th);
    a.rotation.z = side * .12;
    return a;
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // ---------- legs: dark pants, rolled cuffs, sneakers
  const mkLeg = (side) => {
    const l = new THREE.Group(); l.position.set(.3 * side, -.1, 0); rig.add(l);
    const leg = M(new THREE.CylinderGeometry(.21, .23, .5, 24), pants); leg.position.y = -.25; l.add(leg);
    const roll = M(new THREE.CylinderGeometry(.25, .25, .14, 24), knitDark); roll.position.y = -.5; l.add(roll);
    const shoe = new THREE.Group(); shoe.position.set(0, -.68, .08); l.add(shoe);
    const sole = M(new RoundedBoxGeometry(.4, .14, .62, 4, .06), shoeWhite); sole.position.y = -.05; shoe.add(sole);
    const upper = M(new RoundedBoxGeometry(.36, .24, .48, 4, .1), shoePink); upper.position.set(0, .11, -.05); shoe.add(upper);
    const toe = M(new RoundedBoxGeometry(.37, .16, .22, 4, .08), shoeWhite); toe.position.set(0, .04, .2); shoe.add(toe);
    return l;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  // (height from sole to hood top ≈ 3.1 units, feet at y ≈ -0.85)
  return { root, rig, head, hood, eyes, eyeL, eyeR, eyeMat, armL, armR, legL, legR, body, materials: { knit, visorMat } };
}
