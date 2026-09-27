// Cavalo: cavaleiro montado — a peça "cavalo" do xadrez como figura de batalha (estilo medieval, low-poly).
// Cavalo de guerra compacto com pescoço arqueado e cabeça recolhida (silhueta da peça de xadrez): corpo,
// pescoço e cabeça feitos por LatheGeometry (perfis criados uma vez no módulo), orelhas, olhos, crina, cauda,
// pernas articuladas com cascos, caparazão na cor do exército, sela com arção e patilha, estribos e rédeas.
// Cavaleiro de armadura de placas com sobreveste, gorjal, grande elmo (great helm) com barra nasal e pluma,
// escudo triangular (heater) no braço esquerdo e lança de justa de 2,8 m na mão direita (em pé no repouso).
// Contrato em ../rig.js: pés (cascos) na origem, olhando +Z, metros. Joints extras do cavaleiro:
// joints.mount (raiz do cavalo), mountBody, mountNeck, mountHead, mountLegs [FL, FR, BL, BR], mountTail.
import * as THREE from '../three.js';
import { humanoid, horse, attachWeapon, attachShield, mesh, G, snapshotRest } from '../rig.js';

// ---------- Material extra (no máximo 2; criado uma vez, igual nas duas cores) ----------
const MAT_DARK = new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.7 }); // cascos e fenda de visão do elmo

// ---------- Dimensões principais ----------
const RIDER_H = 1.55;                 // altura do esqueleto do cavaleiro (em pé); montado, o conjunto tem ~2.5 m
const BODY_Y = 1.07, BODY_Z = -0.15;  // centro do corpo do cavalo no espaço da raiz (recuado para centrar a pegada)
const BODY_SY = 1.15;                 // o tronco do cavalo é mais alto do que largo
const LEG_Y = -0.12;                  // altura do pivô das pernas no espaço do corpo
const LEG_LEN = BODY_Y + LEG_Y;       // do pivô ao chão
const SEAT_Y = 0.40;                  // topo da sela no espaço do corpo do cavalo
const HIPS_Z = -0.08;                 // posição da bacia do cavaleiro ao longo do dorso

// ---------- Geometrias próprias (criadas UMA vez no módulo, reutilizadas pelas duas cores) ----------
const v2 = (x, y) => new THREE.Vector2(x, y);
// Torno em torno de Y; perfis ordenados de baixo para cima (normais para fora).
const lathe = (pts, seg = 10, phiStart = 0, phiLen = Math.PI * 2) => new THREE.LatheGeometry(pts.map(([r, y]) => v2(r, y)), seg, phiStart, phiLen);
// Torno com eixo em Z (perfil (raio, z), frente em +Z): a parte de cima fica em phi = π.
const latheZ = (pts, seg, phiStart, phiLen) => lathe(pts, seg, phiStart, phiLen).rotateX(Math.PI / 2);

// Tronco do cavalo: peito fundo na frente, cintura levemente mais fina, garupa arredondada atrás.
const GEO_BODY = latheZ([[0, -0.60], [0.17, -0.57], [0.26, -0.50], [0.295, -0.38], [0.285, -0.22], [0.27, -0.05],
  [0.27, 0.10], [0.285, 0.28], [0.27, 0.42], [0.22, 0.52], [0.12, 0.57], [0, 0.585]], 12);
// Caparazão: casca 2,5 cm acima do tronco cobrindo 240° (dorso e flancos), do peito à garupa.
const CAP_A = 2.1;
const GEO_CAPARISON = latheZ([[0.285, -0.50], [0.32, -0.38], [0.31, -0.22], [0.295, -0.05], [0.295, 0.10], [0.31, 0.28], [0.29, 0.40]],
  12, Math.PI - CAP_A, CAP_A * 2);
// Pescoço: grosso na base, afinando até a nuca (escala sz alonga o perfil de frente para trás).
const GEO_NECK = lathe([[0.21, 0], [0.205, 0.14], [0.17, 0.30], [0.13, 0.44], [0.095, 0.53], [0.05, 0.57], [0, 0.585]], 10);
// Cabeça: da nuca (y≈-0.07) ao focinho (y≈0.53): bochechas largas, face afinando, focinho arredondado.
const GEO_HEAD = lathe([[0, -0.07], [0.07, -0.05], [0.115, 0.03], [0.13, 0.13], [0.115, 0.24], [0.085, 0.36], [0.075, 0.45], [0.06, 0.51], [0, 0.535]], 10);
// Grande elmo (unidades de headR): cilindro com topo levemente abaulado; a base fica logo acima do gorjal.
const GEO_HELM = lathe([[0, -0.2], [1.2, -0.2], [1.24, 0.6], [1.24, 2.0], [1.15, 2.25], [0.75, 2.42], [0, 2.5]], 12);
// Fenda de visão: faixa que abraça a frente do elmo (±0.8 rad), cortada ao meio pela barra nasal.
const GEO_SLIT = new THREE.CylinderGeometry(1.27, 1.27, 0.16, 8, 1, true, -0.8, 1.6);
// Sobreveste: painel curvo que abraça o peito (±54°), levemente afunilado em cima; um na frente, outro atrás.
const GEO_SURCOAT = new THREE.CylinderGeometry(0.9, 1, 1, 8, 1, true, -0.95, 1.9);

// Escudo triangular (heater): topo reto, lados curvos convergindo na ponta de baixo. Espessura em +Z.
function heaterGeo(w, h, depth) {
  const s = new THREE.Shape();
  const x = w / 2, yt = h * 0.48, yb = -h * 0.52;
  s.moveTo(-x, yt); s.lineTo(x, yt);
  s.bezierCurveTo(x, yt * 0.1, x * 0.75, yb * 0.55, 0, yb);
  s.bezierCurveTo(-x * 0.75, yb * 0.55, -x, yt * 0.1, -x, yt);
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}
// Emblema heráldico: silhueta da cabeça de cavalo (a peça de xadrez), olhando para -X; base em y=0.
function knightEmblemGeo(size, depth) {
  const pts = [[-0.42, 0], [0.42, 0], [0.42, 0.14], [0.28, 0.2], [0.3, 0.55], [0.22, 0.78], [0.1, 0.9], [0.14, 1.0],
    [0.02, 0.93], [-0.1, 1.0], [-0.12, 0.88], [-0.32, 0.72], [-0.5, 0.5], [-0.46, 0.4], [-0.3, 0.42], [-0.18, 0.5], [-0.24, 0.2], [-0.42, 0.14]];
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x * size, y * size) : s.moveTo(x * size, y * size)));
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}
// Flâmula da lança: triângulo comprido no plano XY (haste em x=0), espessura fina em Z.
function pennonGeo(len, h, depth) {
  const s = new THREE.Shape();
  s.moveTo(0, h / 2); s.lineTo(len, 0); s.lineTo(0, -h / 2); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}
const GEO_SHIELD = heaterGeo(0.46, 0.60, 0.03);
const GEO_EMBLEM = knightEmblemGeo(0.30, 0.012);
const GEO_PENNON = pennonGeo(0.36, 0.12, 0.006);

// ---------- Utilidades ----------
const _q = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
// Alinha o joint com o mundo (orientação identidade), cancelando as rotações acumuladas do braço.
function level(j) { j.parent.getWorldQuaternion(_q); j.quaternion.copy(_q).invert(); }
// Primeira malha filha de um joint (as malhas da base não têm nome; a ordem é fixa em rig.js).
const firstMesh = (o) => o.children.find((c) => c.isMesh);
// Cilindro fino ligando dois pontos (no espaço de `parent`): rédeas e correias.
function bar(parent, a, b, r, mat) {
  _a.copy(a); _b.copy(b);
  const m = mesh(G.cyl(r, r, 1, 6), mat, {});
  m.scale.set(1, _a.distanceTo(_b), 1);
  m.position.copy(_a).add(_b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, _b.sub(_a).normalize());
  parent.add(m);
  return m;
}
// Remove todas as malhas de uma subárvore (ficam só os joints).
function stripMeshes(obj) {
  const del = [];
  obj.traverse((o) => { if (o.isMesh) del.push(o); });
  for (const m of del) m.parent.remove(m);
}

export function buildKnight(color) {
  const rider = humanoid({ type: 'n', color, height: RIDER_H, build: 'medium', armor: 'plate' });
  const { M, dims, joints: J } = rider;
  const { headR, torsoH } = dims;
  const root = rider.group;

  // =================== CAVALO ===================
  // horse() dá o esqueleto do contrato (mount → body → neck → head, legs, tail); as malhas genéricas
  // são substituídas por um cavalo com proporções corretas. Os joints são reposicionados para o novo corpo.
  const h = horse({ color, height: 1.4 });
  stripMeshes(h.group);
  const HJ = h.joints;
  root.add(h.group);
  const B = HJ.body;
  B.position.set(0, BODY_Y, BODY_Z);
  B.rotation.set(0, 0, 0);
  B.add(mesh(GEO_BODY, M.horse, { sy: BODY_SY }));                       // tronco
  B.add(mesh(GEO_CAPARISON, M.accent, { sy: BODY_SY }));                 // caparazão
  // sela: assento acolchoado, patilha (atrás) e arção (na frente)
  B.add(mesh(G.box(0.30, 0.06, 0.44), M.leather, { y: SEAT_Y - 0.03, z: HIPS_Z }));
  B.add(mesh(G.box(0.28, 0.11, 0.05), M.leather, { y: SEAT_Y + 0.03, z: HIPS_Z - 0.22, rx: -0.35 }));
  B.add(mesh(G.box(0.16, 0.09, 0.05), M.leather, { y: SEAT_Y + 0.015, z: HIPS_Z + 0.22, rx: 0.3 }));

  // pescoço arqueado (sai do alto do peito, 40° à frente) com crina na crista
  const N = HJ.neck;
  N.position.set(0, 0.13, 0.36);
  N.rotation.set(0.7, 0, 0);
  N.add(mesh(GEO_NECK, M.horse, { sz: 1.25 }));
  N.add(mesh(G.capsule(0.08, 0.42, 6), M.mane, { y: 0.28, z: -0.2, rx: 0.2, sx: 0.7 }));

  // cabeça recolhida (nuca no alto, focinho apontando para baixo e à frente)
  const HD = HJ.head;
  HD.position.set(0, 0.55, 0);
  HD.rotation.set(1.8, 0, 0);
  HD.add(mesh(GEO_HEAD, M.horse, { sx: 0.8, sz: 1.2 }));                                  // crânio + face + focinho
  HD.add(mesh(G.sphere(0.1, 8), M.horse, { y: 0.15, z: 0.08, sx: 0.8, sy: 1.3, sz: 0.9 })); // ganacha (mandíbula)
  for (const sx of [-1, 1]) {
    HD.add(mesh(G.cone(0.035, 0.13, 6), M.horse, { x: sx * 0.05, y: -0.06, z: -0.10, rx: -2.5, rz: sx * 0.25 })); // orelhas
    HD.add(mesh(G.sphere(0.028, 6), M.eye, { x: sx * 0.10, y: 0.10, z: -0.06 }));                                 // olhos
  }
  HD.add(mesh(G.torus(0.085, 0.012, 6, 12), M.leather, { y: 0.40, rx: Math.PI / 2, sx: 0.8, sy: 1.2 }));        // focinheira
  // rédeas: dos cantos da boca, pelos lados do pescoço, até a cernelha (presas ao pescoço; acompanham a cabeça)
  root.updateMatrixWorld(true);
  for (const sx of [-1, 1]) {
    const bit = N.worldToLocal(HD.localToWorld(new THREE.Vector3(sx * 0.075, 0.44, 0.07)));
    const withers = N.worldToLocal(B.localToWorld(new THREE.Vector3(sx * 0.21, 0.30, 0.30)));
    bar(N, bit, withers, 0.009, M.leather);
  }

  // pernas: braço/coxa grossos, canela fina, casco escuro; as traseiras são mais robustas
  for (const [name, x, z] of [['legFL', -0.19, 0.36], ['legFR', 0.19, 0.36], ['legBL', -0.19, -0.38], ['legBR', 0.19, -0.38]]) {
    const L = HJ[name];
    const back = z < 0;
    L.position.set(x, LEG_Y, z);
    L.rotation.set(0, 0, 0);
    // traseiras: coxa + perna inclinadas para trás até o jarrete, canela reta abaixo dele
    const hock = back ? -0.12 : 0;
    L.add(mesh(G.capsule(0.075, 0.30, 8), M.horse, { y: -0.21, z: hock / 2, rx: back ? 0.27 : 0, sz: back ? 1.3 : 1.05 }));
    L.add(mesh(G.capsule(0.05, 0.34, 8), M.horse, { y: -0.62, z: hock }));
    L.add(mesh(G.cyl(0.06, 0.072, 0.10, 8), MAT_DARK, { y: -(LEG_LEN - 0.05), z: hock }));
  }
  // cauda
  const T = HJ.tail;
  T.position.set(0, 0.2, -0.56);
  T.rotation.set(0.1, 0, 0);
  T.add(mesh(G.capsule(0.065, 0.55, 6), M.mane, { y: -0.33, sz: 1.25 }));

  // =================== CAVALEIRO ===================
  // A bacia do cavaleiro passa a ser filha do corpo do cavalo (senta na sela e acompanha o galope).
  root.remove(J.hips);
  B.add(J.hips);
  J.hips.position.set(0, SEAT_Y + 0.07, HIPS_Z);
  // pernas montando de verdade: coxas abertas sobre a sela, joelhos dobrados, canelas junto aos flancos
  J.hipL.position.x = -0.13; J.hipR.position.x = 0.13;
  J.hipL.rotation.set(-0.8, 0, -0.42); J.hipR.rotation.set(-0.8, 0, 0.42);
  J.kneeL.rotation.set(1.0, 0, 0.15); J.kneeR.rotation.set(1.0, 0, -0.15);
  // placas: grevas e sabatões de metal, manoplas e braçadeiras
  for (const side of ['L', 'R']) {
    const knee = J['knee' + side];
    for (const m of knee.children) if (m.isMesh) m.material = M.metal;
    firstMesh(J['elbow' + side]).material = M.metal;
    firstMesh(J['hand' + side]).material = M.metal;
    firstMesh(J['shoulder' + side]).scale.setScalar(1.2); // ombreiras maiores
  }
  // gorjal e sobreveste na cor do exército
  J.torso.add(mesh(G.cyl(0.12, 0.2, 0.1, 10), M.metal, { y: torsoH + 0.03, sz: 0.85 }));
  for (const ry of [0, Math.PI]) J.torso.add(mesh(GEO_SURCOAT, M.accent, { y: 0.25, ry, sx: 0.215, sy: 0.34, sz: 0.162 }));

  // ---- Cabeça: o grande elmo cobre tudo; as malhas do rosto da base são descartadas (ficariam escondidas).
  for (const m of rider.headMeshes) J.head.remove(m);
  rider.headMeshes.length = 0;
  J.neck.remove(firstMesh(J.neck)); // o pescoço ficaria escondido dentro do gorjal/elmo
  const helm = mesh(GEO_HELM, M.metal, { s: headR });
  const slit = mesh(GEO_SLIT, MAT_DARK, { y: headR * 1.05, s: headR });
  const nasal = mesh(G.box(0.03, 0.30, 0.012), M.trim, { y: headR * 1.0, z: headR * 1.24 });
  const plume = mesh(G.capsule(0.03, 0.24, 6), M.accent, { y: headR * 2.5, z: -headR * 0.45, rx: -1.05, sx: 0.5, sz: 1.6 });
  for (const m of [helm, slit, nasal, plume]) { J.head.add(m); rider.headMeshes.push(m); }

  // ---- Escudo heater (joint `shield`, olha +Z): preso ao antebraço esquerdo, virado um pouco para a esquerda
  const shield = new THREE.Group();
  shield.add(mesh(GEO_SHIELD, M.accent, {}));
  shield.add(mesh(GEO_EMBLEM, M.trim, { y: -0.16, z: 0.03 }));
  shield.position.set(0, -0.05, 0.06);
  attachShield(rider, shield);

  // ---- Lança de justa (2,8 m no total: 0,85 m abaixo do punho, ponta 1,95 m acima)
  const BUTT = 0.85, TIP = 1.95;
  const lance = new THREE.Group();
  lance.add(mesh(G.cyl(0.016, 0.042, TIP - 0.3 + BUTT, 8), M.wood, { y: (TIP - 0.3 - BUTT) / 2 })); // haste afunilada
  lance.add(mesh(G.cyl(0.045, 0.045, 0.24, 8), M.leather, {}));                               // empunhadura
  lance.add(mesh(G.cone(0.10, 0.22, 10), M.metal, { y: 0.22 }));                               // guarda-mão (vamplate)
  lance.add(mesh(G.cone(0.03, 0.32, 6), M.blade, { y: TIP - 0.16 }));                          // ponta
  lance.add(mesh(GEO_PENNON, M.accent, { y: TIP - 0.45, ry: Math.PI / 2 }));                    // flâmula (aponta para trás)
  attachWeapon(rider, lance, 'lance', TIP);

  // ---- Pose de sentinela: lança em pé ao lado do corpo, escudo à frente do antebraço esquerdo
  J.shoulderR.rotation.set(-0.35, 0, 0.38);
  J.elbowR.rotation.x = -0.8;
  J.shoulderL.rotation.set(-0.35, 0, -0.1);
  J.elbowL.rotation.x = -1.3;
  root.updateMatrixWorld(true);
  level(J.weapon);
  J.weapon.rotateX(0.1); J.weapon.rotateZ(0.08); // topo levemente à frente e para dentro (base para fora): a lança não bate no joelho
  level(J.shield);
  J.shield.rotateY(-0.4);

  // estribos: correia da sela até o ferro, sob cada pé (posição do pé lida da pose)
  root.updateMatrixWorld(true);
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const foot = B.worldToLocal(J['knee' + side].localToWorld(new THREE.Vector3(0, -dims.shin - 0.02, 0.02)));
    const top = new THREE.Vector3(sx * 0.16, SEAT_Y - 0.06, HIPS_Z + 0.02);
    bar(B, top, foot, 0.012, M.leather);
    B.add(mesh(G.torus(0.055, 0.01, 6, 10), M.metal, { x: foot.x, y: foot.y - 0.03, z: foot.z, ry: Math.PI / 2 }));
  }

  // ---- Contrato do montado
  rider.mounted = true;
  J.mount = h.group;
  J.mountBody = B;
  J.mountNeck = N;
  J.mountHead = HD;
  J.mountLegs = [HJ.legFL, HJ.legFR, HJ.legBL, HJ.legBR];
  J.mountTail = T;
  // alturas reais (sem a lança): topo da pluma e olho no espaço do mundo
  root.updateMatrixWorld(true);
  rider.height = +plume.localToWorld(new THREE.Vector3(0, 0.15, 0)).y.toFixed(3);
  rider.eyeHeight = +rider.getEye(new THREE.Vector3()).y.toFixed(3);
  return snapshotRest(rider);
}
