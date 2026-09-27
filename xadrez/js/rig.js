// Esqueleto articulado, materiais e primitivas para os personagens (peças como figuras de batalha).
// Tudo procedural. Convenções (valem para chars/*.js e battle.js):
//  - O personagem é construído OLHANDO PARA +Z local, com os pés na origem. board3d gira o grupo.
//  - Unidades em metros. `height` é a altura total; a casa do tabuleiro mede 2 m.
//  - Membros pendem ao longo de -Y em repouso. rotation.x NEGATIVO no ombro/quadril = balança para a frente (+Z).
//  - A arma fica na mão direita, no joint `weapon`: geometria ao longo de +Y a partir do punho (ponta em +Y·weaponLength).
//    Em repouso a arma aponta para cima. O escudo fica no joint `shield` (mão esquerda) e olha para +Z.
//  - Cada joint é um THREE.Group cujo pivô é a articulação. Animações só mexem em `rotation` dos joints
//    (e em `root.position` para deslocar o corpo). `resetPose(char)` restaura o repouso.
import * as THREE from './three.js';

let SHADOWS = true;
export function setShadows(v) { SHADOWS = !!v; }

// ---------- Paleta dos dois exércitos ----------
export const ARMY = {
  w: {
    skin: 0xf1cdb0, armor: 0xdcd6c8, metal: 0xcfd4dc, cloth: 0xefe6d6, accent: 0x3f6db3, trim: 0xd4b25a,
    leather: 0x8a6a4a, wood: 0x7a5230, hair: 0x6b4a2e, horse: 0xe6dfd0, mane: 0xc9bda6, eye: 0x1c1c1c, blade: 0xe8ecf2,
  },
  b: {
    skin: 0xd8a986, armor: 0x2e2927, metal: 0x4b4f57, cloth: 0x3b332f, accent: 0xb9382f, trim: 0xb08d3c,
    leather: 0x4a3526, wood: 0x3a2618, hair: 0x1a1210, horse: 0x2a2320, mane: 0x120f0e, eye: 0xf2f2f2, blade: 0xb9bec7,
  },
};

const matCache = new Map();
// Materiais compartilhados por exército: { skin, armor, metal, cloth, accent, trim, leather, wood, hair, horse, mane, eye, blade }
export function materials(color) {
  if (matCache.has(color)) return matCache.get(color);
  const c = ARMY[color];
  const M = {
    skin: new THREE.MeshStandardMaterial({ color: c.skin, roughness: 0.75 }),
    armor: new THREE.MeshStandardMaterial({ color: c.armor, roughness: 0.45, metalness: 0.25 }),
    metal: new THREE.MeshStandardMaterial({ color: c.metal, roughness: 0.35, metalness: 0.6 }),
    cloth: new THREE.MeshStandardMaterial({ color: c.cloth, roughness: 0.9 }),
    accent: new THREE.MeshStandardMaterial({ color: c.accent, roughness: 0.8 }),
    trim: new THREE.MeshStandardMaterial({ color: c.trim, roughness: 0.35, metalness: 0.7 }),
    leather: new THREE.MeshStandardMaterial({ color: c.leather, roughness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({ color: c.wood, roughness: 0.8 }),
    hair: new THREE.MeshStandardMaterial({ color: c.hair, roughness: 0.9 }),
    horse: new THREE.MeshStandardMaterial({ color: c.horse, roughness: 0.8 }),
    mane: new THREE.MeshStandardMaterial({ color: c.mane, roughness: 0.95 }),
    eye: new THREE.MeshStandardMaterial({ color: c.eye, roughness: 0.4 }),
    blade: new THREE.MeshStandardMaterial({ color: c.blade, roughness: 0.25, metalness: 0.8 }),
  };
  matCache.set(color, M);
  return M;
}

// ---------- Geometrias (cache compartilhado) ----------
const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
export const G = {
  box: (w, h, d) => cached(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  sphere: (r, seg = 10) => cached(`sph${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2))),
  // cápsula: raio r, comprimento do cilindro len (altura total = len + 2r), centrada na origem, eixo Y
  capsule: (r, len, seg = 8) => cached(`cap${r},${len},${seg}`, () => new THREE.CapsuleGeometry(r, len, 3, seg)),
  cyl: (rt, rb, h, seg = 10) => cached(`cyl${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)),
  cone: (r, h, seg = 10) => cached(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  torus: (r, t, seg = 8, tub = 16) => cached(`tor${r},${t},${seg},${tub}`, () => new THREE.TorusGeometry(r, t, seg, tub)),
  ring: (ri, ro, seg = 16) => cached(`ring${ri},${ro},${seg}`, () => new THREE.RingGeometry(ri, ro, seg)),
  plane: (w, h) => cached(`pl${w},${h}`, () => new THREE.PlaneGeometry(w, h)),
};

// Cria um Mesh posicionado. o = { x, y, z, rx, ry, rz, s, sx, sy, sz, name }
export function mesh(geo, mat, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(o.x || 0, o.y || 0, o.z || 0);
  m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  if (o.s) m.scale.setScalar(o.s);
  if (o.sx || o.sy || o.sz) m.scale.set(o.sx || 1, o.sy || 1, o.sz || 1);
  m.castShadow = SHADOWS;
  m.receiveShadow = true;
  if (o.name) m.name = o.name;
  return m;
}

// Joint = Group com pivô na articulação
export function joint(name, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  return g;
}

// ---------- Humanoide padrão ----------
// opts: { color, height, build: 'light'|'medium'|'heavy', armor: 'cloth'|'leather'|'plate', helmet: bool }
// Devolve o Character (ver abaixo). Os módulos de cada peça acrescentam chapéus, capas, armas, etc.
export function humanoid(opts) {
  const { color, height = 1.7, build = 'medium', armor = 'leather' } = opts;
  const M = materials(color);
  const H = height;
  const legLen = 0.47 * H, thigh = legLen * 0.5, shin = legLen * 0.5;
  const torsoH = 0.30 * H;
  const headR = 0.085 * H;
  const neckH = 0.035 * H;
  const shoulderW = (build === 'heavy' ? 0.30 : build === 'light' ? 0.22 : 0.25) * H;
  const hipW = 0.14 * H;
  const upper = 0.16 * H, lower = 0.15 * H;
  const limbR = (build === 'heavy' ? 0.05 : 0.04) * H;
  const torsoR = (build === 'heavy' ? 0.13 : build === 'light' ? 0.10 : 0.115) * H;
  const bodyMat = armor === 'plate' ? M.armor : armor === 'leather' ? M.leather : M.cloth;

  const root = joint('root');
  const hips = joint('hips', 0, legLen, 0);
  root.add(hips);
  // pélvis
  hips.add(mesh(G.capsule(torsoR * 0.85, 0.02 * H, 8), bodyMat, { y: 0.02 * H, sx: 1.1, sy: 0.6 }));

  // pernas
  const legs = {};
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const hip = joint('hip' + side, sx * hipW / 2, 0, 0);
    hips.add(hip);
    hip.add(mesh(G.capsule(limbR * 1.1, thigh - limbR * 1.6, 8), bodyMat, { y: -thigh / 2 }));
    const knee = joint('knee' + side, 0, -thigh, 0);
    hip.add(knee);
    knee.add(mesh(G.capsule(limbR, shin - limbR * 1.6, 8), M.leather, { y: -shin / 2 }));
    // pé
    knee.add(mesh(G.box(limbR * 2.2, limbR * 1.2, limbR * 3.4), M.leather, { y: -shin + limbR * 0.4, z: limbR * 0.9 }));
    legs['hip' + side] = hip;
    legs['knee' + side] = knee;
  }

  // torso
  const torso = joint('torso', 0, 0.03 * H, 0);
  hips.add(torso);
  torso.add(mesh(G.capsule(torsoR, torsoH - torsoR * 1.2, 10), bodyMat, { y: torsoH / 2, sx: 1.15, sz: 0.85 }));
  // cinto
  torso.add(mesh(G.cyl(torsoR * 1.2, torsoR * 1.2, 0.03 * H, 12), M.leather, { y: 0.05 * H, sz: 0.85 }));

  // braços
  const arms = {};
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const shoulder = joint('shoulder' + side, sx * shoulderW / 2, torsoH * 0.92, 0);
    torso.add(shoulder);
    // ombreira
    shoulder.add(mesh(G.sphere(limbR * 1.5, 8), armor === 'plate' ? M.metal : bodyMat, { x: sx * limbR * 0.2 }));
    shoulder.add(mesh(G.capsule(limbR, upper - limbR * 1.6, 8), bodyMat, { y: -upper / 2 }));
    const elbow = joint('elbow' + side, 0, -upper, 0);
    shoulder.add(elbow);
    elbow.add(mesh(G.capsule(limbR * 0.9, lower - limbR * 1.5, 8), M.skin, { y: -lower / 2 }));
    const hand = joint('hand' + side, 0, -lower, 0);
    elbow.add(hand);
    hand.add(mesh(G.sphere(limbR * 1.1, 8), M.skin, { sy: 1.2 }));
    arms['shoulder' + side] = shoulder;
    arms['elbow' + side] = elbow;
    arms['hand' + side] = hand;
  }
  const weapon = joint('weapon', 0, 0, 0);
  arms.handR.add(weapon);
  const shield = joint('shield', 0, 0, 0);
  arms.handL.add(shield);

  // pescoço e cabeça
  const neck = joint('neck', 0, torsoH, 0);
  torso.add(neck);
  neck.add(mesh(G.cyl(limbR * 0.9, limbR, neckH, 8), M.skin, { y: neckH / 2 }));
  const head = joint('head', 0, neckH, 0);
  neck.add(head);
  const headMeshes = [];
  const skull = mesh(G.sphere(headR, 12), M.skin, { y: headR * 0.95, sy: 1.1 });
  head.add(skull); headMeshes.push(skull);
  // olhos
  for (const sx of [-1, 1]) {
    const e = mesh(G.sphere(headR * 0.13, 6), M.eye, { x: sx * headR * 0.35, y: headR * 1.0, z: headR * 0.85 });
    head.add(e); headMeshes.push(e);
  }
  // nariz
  const nose = mesh(G.cone(headR * 0.12, headR * 0.3, 6), M.skin, { y: headR * 0.8, z: headR * 0.95, rx: Math.PI / 2 });
  head.add(nose); headMeshes.push(nose);
  const hat = joint('hat', 0, headR * 1.9, 0); // topo da cabeça: chapéus/elmos/coroas
  head.add(hat);

  const joints = { root, hips, torso, neck, head, hat, weapon, shield, ...legs, ...arms };
  const char = {
    type: opts.type || '?', color, group: root, joints, headMeshes,
    height: H, eyeHeight: legLen + 0.03 * H + torsoH + neckH + headR * 1.0,
    eyeLocal: new THREE.Vector3(0, headR * 1.0, headR * 0.6), // no espaço do joint `head`
    weaponKind: 'none', weaponLength: 0, weaponTip: null,
    mounted: false,
    dims: { legLen, thigh, shin, torsoH, headR, neckH, shoulderW, upper, lower, limbR, torsoR },
    M,
    rest: null,
  };
  char.getEye = (out) => head.localToWorld(out.copy(char.eyeLocal));
  char.setHeadVisible = (v) => { for (const m of char.headMeshes) m.visible = v; };
  return char;
}

// Registra uma arma no personagem: `obj` deve estar construído ao longo de +Y com o punho na origem.
// kind: 'spear' | 'sword' | 'hammer' | 'staff' | 'lance' | 'mace'
export function attachWeapon(char, obj, kind, length) {
  char.joints.weapon.add(obj);
  char.weaponKind = kind;
  char.weaponLength = length;
  const tip = new THREE.Object3D();
  tip.name = 'weaponTip';
  tip.position.set(0, length, 0);
  char.joints.weapon.add(tip);
  char.weaponTip = tip;
  return obj;
}

export function attachShield(char, obj) {
  char.joints.shield.add(obj);
  return obj;
}

// Guarda a pose de repouso (chame no fim da construção) e permite restaurar.
// A raiz (char.group) fica de fora: posição e rumo dela pertencem ao tabuleiro/animador.
export function snapshotRest(char) {
  char.rest = [];
  char.group.traverse((o) => {
    if (o.isGroup && o !== char.group) char.rest.push({ o, rot: o.rotation.clone(), pos: o.position.clone() });
  });
  return char;
}
export function resetPose(char) {
  if (!char.rest) return;
  for (const r of char.rest) { r.o.rotation.copy(r.rot); r.o.position.copy(r.pos); }
  char.setHeadVisible(true);
}

// ---------- Cavalo (montaria do cavaleiro) ----------
// Devolve { group, joints: { body, neck, head, legFL, legFR, legBL, legBR, tail }, seat: Vector3 (posição da sela no espaço de body) }
export function horse({ color, height = 1.5 }) {
  const M = materials(color);
  const H = height;                  // altura até o lombo
  const bodyL = 1.05 * H, bodyR = 0.3 * H;
  const legLen = 0.62 * H;
  const group = joint('mount');
  const body = joint('body', 0, legLen + bodyR * 0.6, 0);
  group.add(body);
  body.add(mesh(G.capsule(bodyR, bodyL - bodyR * 2, 10), M.horse, { rx: Math.PI / 2 }));
  // sela
  body.add(mesh(G.box(bodyR * 1.9, bodyR * 0.35, bodyR * 1.3), M.leather, { y: bodyR * 0.85, z: -bodyR * 0.1 }));
  body.add(mesh(G.box(bodyR * 2.1, bodyR * 0.12, bodyR * 1.7), M.accent, { y: bodyR * 0.7, z: -bodyR * 0.1 }));
  // pescoço e cabeça
  const neck = joint('neck', 0, bodyR * 0.5, bodyL * 0.42);
  body.add(neck);
  neck.rotation.x = -0.9;
  neck.add(mesh(G.capsule(bodyR * 0.45, bodyR * 1.4, 8), M.horse, { y: bodyR * 0.8 }));
  neck.add(mesh(G.box(bodyR * 0.25, bodyR * 1.6, bodyR * 0.5), M.mane, { y: bodyR * 0.9, z: -bodyR * 0.35 }));
  const head = joint('head', 0, bodyR * 1.6, 0);
  neck.add(head);
  head.rotation.x = 1.4;
  head.add(mesh(G.capsule(bodyR * 0.3, bodyR * 0.9, 8), M.horse, { y: bodyR * 0.5, sx: 0.8 }));
  head.add(mesh(G.box(bodyR * 0.45, bodyR * 0.4, bodyR * 0.45), M.horse, { y: bodyR * 1.05 }));
  for (const sx of [-1, 1]) {
    head.add(mesh(G.cone(bodyR * 0.12, bodyR * 0.35, 6), M.horse, { x: sx * bodyR * 0.22, y: bodyR * 0.15, z: -bodyR * 0.2 }));
    head.add(mesh(G.sphere(bodyR * 0.07, 6), M.eye, { x: sx * bodyR * 0.26, y: bodyR * 0.55, z: bodyR * 0.1 }));
  }
  // rédeas
  head.add(mesh(G.torus(bodyR * 0.3, bodyR * 0.03, 6, 12), M.leather, { y: bodyR * 0.95, rx: Math.PI / 2 }));
  // pernas
  const legs = {};
  const legR = bodyR * 0.22;
  for (const [name, x, z] of [['legFL', -bodyR * 0.55, bodyL * 0.32], ['legFR', bodyR * 0.55, bodyL * 0.32], ['legBL', -bodyR * 0.55, -bodyL * 0.32], ['legBR', bodyR * 0.55, -bodyL * 0.32]]) {
    const l = joint(name, x, -bodyR * 0.3, z);
    body.add(l);
    l.add(mesh(G.capsule(legR, legLen * 0.55, 8), M.horse, { y: -legLen * 0.32 }));
    l.add(mesh(G.capsule(legR * 0.8, legLen * 0.3, 8), M.horse, { y: -legLen * 0.78 }));
    l.add(mesh(G.cyl(legR * 1.1, legR * 1.2, legR * 1.2, 8), M.hair, { y: -legLen + bodyR * 0.3 - legR * 0.3 }));
    legs[name] = l;
  }
  const tail = joint('tail', 0, bodyR * 0.4, -bodyL * 0.5);
  body.add(tail);
  tail.rotation.x = 0.6;
  tail.add(mesh(G.capsule(bodyR * 0.14, bodyR * 1.1, 6), M.mane, { y: -bodyR * 0.7 }));
  return { group, joints: { body, neck, head, tail, ...legs }, seat: new THREE.Vector3(0, bodyR * 1.0, -bodyR * 0.1), bodyY: legLen + bodyR * 0.6 };
}

// Objeto Character (contrato usado por board3d.js, animations.js e battle.js):
// {
//   type: 'p'|'n'|'b'|'r'|'q'|'k', color: 'w'|'b', group: THREE.Group (raiz nos pés, frente +Z),
//   joints: { root, hips, torso, neck, head, hat, shoulderL, shoulderR, elbowL, elbowR, handL, handR,
//             hipL, hipR, kneeL, kneeR, weapon, shield,
//             mount?, mountBody?, mountNeck?, mountHead?, mountLegs?: [FL, FR, BL, BR], mountTail? },
//   headMeshes: Mesh[], height, eyeHeight, eyeLocal, getEye(out), setHeadVisible(v),
//   weaponKind, weaponLength, weaponTip, mounted, dims, M, rest
// }
