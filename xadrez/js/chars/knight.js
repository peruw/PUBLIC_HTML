// Cavalo: cavaleiro montado — a peça "cavalo" do xadrez como figura de batalha (estilo medieval, low-poly).
// Cavalo de guerra compacto com pescoço arqueado e cabeça recolhida (silhueta da peça de xadrez): tronco,
// pescoço e crânio feitos por LatheGeometry (perfis criados uma vez no módulo), face/focinho destacados do crânio,
// orelhas, olhos, crina volumosa na crista + topete, cauda em dois segmentos, pernas com joelho/jarrete
// modelados e cascos, caparazão completo na cor do exército (envolve o tronco, o rabo sai por uma abertura),
// sela com arção e patilha, estribos e rédeas em dois segmentos que acompanham a curva do pescoço.
// Cavaleiro de armadura de placas com sobreveste, gorjal, grande elmo (great helm) com barra nasal e pluma
// grande curvada para trás, escudo triangular (heater) no braço esquerdo e lança de justa de 2,8 m na mão
// direita (em pé no repouso, guarda-mão aberto para a ponta).
// Contrato em ../rig.js: pés (cascos) na origem, olhando +Z, metros. Joints extras do cavaleiro:
// joints.mount (raiz do cavalo), mountBody, mountNeck, mountHead, mountLegs [FL, FR, BL, BR], mountTail.
import * as THREE from '../three.js';
import { humanoid, horse, attachWeapon, attachShield, mesh, G, snapshotRest } from '../rig.js';

// ---------- Materiais extras (no máximo 2; criados uma vez, iguais nas duas cores) ----------
const MAT_DARK = new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.7 });  // fenda de visão do elmo
const MAT_HOOF = new THREE.MeshStandardMaterial({ color: 0x6b6259, roughness: 0.55 }); // cascos (cor de chifre: contrasta nos dois exércitos)

// ---------- Dimensões principais ----------
const RIDER_H = 1.60;                 // altura do esqueleto do cavaleiro (em pé); montado, o conjunto tem ~2.55 m
const BODY_Y = 1.07, BODY_Z = -0.15;  // centro do corpo do cavalo no espaço da raiz (recuado para centrar a pegada)
const BODY_SX = 1.08, BODY_SY = 1.12; // tronco um pouco mais largo (peito cheio) e mais alto do que largo
const LEG_Y = -0.12;                  // altura do pivô das pernas no espaço do corpo
const LEG_LEN = BODY_Y + LEG_Y;       // do pivô ao chão (0.95)
const HOCK_Y = -0.45, HOCK_Z = -0.14; // jarrete das traseiras (no espaço do joint da perna)
const SEAT_Y = 0.40;                  // topo da sela no espaço do corpo do cavalo
const HIPS_Z = -0.08;                 // posição da bacia do cavaleiro ao longo do dorso

// ---------- Geometrias próprias (criadas UMA vez no módulo, reutilizadas pelas duas cores) ----------
const v2 = (x, y) => new THREE.Vector2(x, y);
// Torno em torno de Y; perfis ordenados de baixo para cima (normais para fora).
const lathe = (pts, seg = 10, phiStart = 0, phiLen = Math.PI * 2) => new THREE.LatheGeometry(pts.map(([r, y]) => v2(r, y)), seg, phiStart, phiLen);
// Torno com eixo em Z (perfil (raio, z), frente em +Z).
const latheZ = (pts, seg) => lathe(pts, seg).rotateX(Math.PI / 2);

// Tronco do cavalo: garupa arredondada atrás, cintura levemente mais fina, peito cheio e largo na frente.
const GEO_BODY = latheZ([[0, -0.60], [0.17, -0.57], [0.26, -0.50], [0.295, -0.38], [0.285, -0.22], [0.275, -0.05],
  [0.275, 0.10], [0.29, 0.28], [0.285, 0.42], [0.24, 0.53], [0.14, 0.58], [0, 0.595]], 12);
// Caparazão completo: casca fechada 2,5-3 cm acima do tronco, da garupa (abertura para a cauda) até o peito,
// onde afunda no tronco (borda escondida). Cobre dorso, flancos e barriga como uma manta de guerra.
const GEO_CAPARISON = latheZ([[0.16, -0.585], [0.25, -0.555], [0.30, -0.50], [0.325, -0.38], [0.315, -0.22], [0.305, -0.05],
  [0.305, 0.10], [0.32, 0.28], [0.31, 0.36], [0.26, 0.43]], 12);
// Pescoço: base larga enterrada no tronco (sem degrau), afinando até a nuca (escala sz alonga de frente para trás).
const GEO_NECK = lathe([[0.16, -0.14], [0.215, -0.02], [0.215, 0.12], [0.185, 0.28], [0.145, 0.42], [0.11, 0.52], [0.07, 0.57], [0, 0.59]], 10);
// Crânio: da nuca (y≈-0.07) às bochechas largas (ganachas) afinando na testa; a face/focinho é uma peça à parte.
const GEO_SKULL = lathe([[0, -0.07], [0.08, -0.05], [0.125, 0.04], [0.135, 0.14], [0.115, 0.23], [0.085, 0.29], [0, 0.31]], 10);
// Perna dianteira (origem no pivô, chão em y=-0.95): braço grosso, joelho marcado, canela fina, boleto, quartela.
const GEO_FORELEG = lathe([[0.042, -0.90], [0.058, -0.85], [0.046, -0.78], [0.045, -0.62], [0.062, -0.50], [0.058, -0.40],
  [0.075, -0.24], [0.095, -0.08], [0.095, 0.02], [0.06, 0.08], [0, 0.1]], 8);
// Perna traseira, parte de baixo (origem no jarrete): jarrete saliente, canela, boleto, quartela.
const GEO_HINDLEG = lathe([[0.042, -0.45], [0.058, -0.40], [0.046, -0.33], [0.048, -0.16], [0.07, -0.04], [0.08, 0.03], [0.05, 0.08], [0, 0.1]], 8);
// Grande elmo (unidades de headR): cilindro com topo levemente abaulado; a base fica logo acima do gorjal.
const GEO_HELM = lathe([[0, -0.2], [1.15, -0.2], [1.2, 0.6], [1.2, 1.95], [1.1, 2.2], [0.7, 2.36], [0, 2.42]], 12);
// Fenda de visão: faixa que abraça a frente do elmo (±0.8 rad), cortada ao meio pela barra nasal.
const GEO_SLIT = new THREE.CylinderGeometry(1.23, 1.23, 0.16, 8, 1, true, -0.8, 1.6);
// Sobreveste: tabardo que envolve o torso inteiro, levemente afunilado em cima.
const GEO_SURCOAT = new THREE.CylinderGeometry(1.05, 1.15, 1, 10, 1, true);

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
  m.scale.set(1, _a.distanceTo(_b) + r, 1); // um pouco mais comprido para as emendas se sobreporem
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
  B.add(mesh(GEO_BODY, M.horse, { sx: BODY_SX, sy: BODY_SY }));           // tronco
  B.add(mesh(GEO_CAPARISON, M.accent, { sx: BODY_SX, sy: BODY_SY }));     // caparazão completo
  // sela: assento acolchoado, patilha (atrás) e arção (na frente)
  B.add(mesh(G.box(0.30, 0.06, 0.44), M.leather, { y: SEAT_Y - 0.03, z: HIPS_Z }));
  B.add(mesh(G.box(0.28, 0.11, 0.05), M.leather, { y: SEAT_Y + 0.03, z: HIPS_Z - 0.22, rx: -0.35 }));
  B.add(mesh(G.box(0.16, 0.09, 0.05), M.leather, { y: SEAT_Y + 0.015, z: HIPS_Z + 0.22, rx: 0.3 }));

  // pescoço arqueado (sai do alto do peito, 40° à frente) com crina volumosa ao longo de toda a crista
  const N = HJ.neck;
  N.position.set(0, 0.13, 0.36);
  N.rotation.set(0.7, 0, 0);
  N.add(mesh(GEO_NECK, M.horse, { sz: 1.25 }));
  // crina: lâmina alta que cavalga a crista (lado de trás do pescoço), do peito à nuca, caindo para o lado esquerdo
  N.add(mesh(G.capsule(0.075, 0.50, 6), M.leather, { x: -0.03, y: 0.30, z: -0.20, rx: 0.12, rz: 0.1, sx: 0.55, sz: 1.7 }));

  // cabeça recolhida (nuca no alto, focinho apontando para baixo e à frente)
  const HD = HJ.head;
  HD.position.set(0, 0.56, 0);
  HD.rotation.set(1.8, 0, 0);
  HD.add(mesh(GEO_SKULL, M.horse, { sx: 0.95, sz: 1.15 }));                                          // crânio e ganachas
  HD.add(mesh(G.capsule(0.078, 0.22, 8), M.horse, { y: 0.38, z: -0.025, rx: 0.12, sx: 0.85, sz: 1.1 })); // face e focinho (quebra com o crânio)
  HD.add(mesh(G.capsule(0.05, 0.16, 6), M.leather, { y: 0.02, z: -0.12, rx: -0.55, sx: 0.7, sz: 1.4 }));   // topete entre as orelhas
  for (const sx of [-1, 1]) {
    HD.add(mesh(G.cone(0.035, 0.14, 6), M.horse, { x: sx * 0.055, y: -0.06, z: -0.10, rx: -2.5, rz: sx * 0.25 })); // orelhas
    HD.add(mesh(G.sphere(0.026, 6), M.eye, { x: sx * 0.105, y: 0.13, z: -0.06 }));                                  // olhos
  }
  // rédeas: dos cantos da boca sobem em dois segmentos colados ao lado do pescoço até a base dele (cernelha)
  root.updateMatrixWorld(true);
  for (const sx of [-1, 1]) {
    const bit = N.worldToLocal(HD.localToWorld(new THREE.Vector3(sx * 0.07, 0.46, 0.05)));
    const mid = new THREE.Vector3(sx * 0.165, 0.40, 0.05);   // lado do pescoço, a meia altura (raio ≈0.15 aqui)
    const base = new THREE.Vector3(sx * 0.215, 0.06, 0.02);  // base do pescoço (raio 0.215), na cernelha
    bar(N, bit, mid, 0.009, M.leather);
    bar(N, mid, base, 0.009, M.leather);
  }

  // pernas: dianteiras em uma peça torneada (braço, joelho, canela, boleto); traseiras com coxa inclinada
  // para trás até o jarrete saliente e canela reta abaixo dele; cascos cor de chifre
  for (const [name, x, z] of [['legFL', -0.215, 0.36], ['legFR', 0.215, 0.36], ['legBL', -0.20, -0.38], ['legBR', 0.20, -0.38]]) {
    const L = HJ[name];
    L.position.set(x, LEG_Y, z);
    L.rotation.set(0, 0, 0);
    if (z > 0) {
      L.add(mesh(GEO_FORELEG, M.horse, {}));
      L.add(mesh(G.cyl(0.06, 0.072, 0.10, 8), MAT_HOOF, { y: -(LEG_LEN - 0.05) }));
    } else {
      const tilt = Math.atan2(-HOCK_Z, -HOCK_Y);
      L.add(mesh(G.capsule(0.085, 0.30, 8), M.horse, { y: HOCK_Y / 2, z: HOCK_Z / 2, rx: tilt, sz: 1.25 })); // coxa/perna
      L.add(mesh(GEO_HINDLEG, M.horse, { y: HOCK_Y, z: HOCK_Z }));                                          // jarrete + canela
      L.add(mesh(G.cyl(0.06, 0.072, 0.10, 8), MAT_HOOF, { y: -(LEG_LEN - 0.05), z: HOCK_Z }));
    }
  }
  // cauda em dois segmentos: raiz saindo pela abertura do caparazão e mecha comprida caindo
  const T = HJ.tail;
  T.position.set(0, 0.10, -0.53);
  T.rotation.set(0.3, 0, 0);
  T.add(mesh(G.capsule(0.06, 0.16, 6), M.leather, { y: -0.10, sz: 1.2 }));
  T.add(mesh(G.capsule(0.07, 0.40, 6), M.leather, { y: -0.40, z: 0.0, rx: -0.2, sx: 1.1, sz: 1.3 }));

  // =================== CAVALEIRO ===================
  // A bacia do cavaleiro passa a ser filha do corpo do cavalo (senta na sela e acompanha o galope).
  root.remove(J.hips);
  B.add(J.hips);
  J.hips.position.set(0, SEAT_Y + 0.06, HIPS_Z);
  // pernas montando de verdade: coxas abertas sobre a sela, joelhos dobrados, canelas e pés junto aos flancos
  J.hipL.position.x = -0.13; J.hipR.position.x = 0.13;
  J.hipL.rotation.set(-0.8, 0, -0.36); J.hipR.rotation.set(-0.8, 0, 0.36);
  J.kneeL.rotation.set(1.0, 0, 0.26); J.kneeR.rotation.set(1.0, 0, -0.26);
  // placas: grevas e sabatões de metal (sabatão mais curto e estreito), manoplas e braçadeiras
  for (const side of ['L', 'R']) {
    const knee = J['knee' + side];
    const kneeMeshes = knee.children.filter((m) => m.isMesh);
    for (const m of kneeMeshes) m.material = M.metal;
    kneeMeshes[1].scale.set(0.8, 0.9, 0.8); // sabatão
    firstMesh(J['elbow' + side]).material = M.metal;
    firstMesh(J['hand' + side]).material = M.metal;
    firstMesh(J['shoulder' + side]).scale.setScalar(1.1); // ombreiras um pouco maiores
  }
  // gorjal e sobreveste (tabardo) na cor do exército
  J.torso.add(mesh(G.cyl(0.12, 0.2, 0.1, 10), M.metal, { y: torsoH + 0.03, sz: 0.85 }));
  J.torso.add(mesh(GEO_SURCOAT, M.accent, { y: 0.26, sx: 0.215, sy: 0.36, sz: 0.162 }));

  // ---- Cabeça: o grande elmo cobre tudo; as malhas do rosto da base são descartadas (ficariam escondidas).
  for (const m of rider.headMeshes) J.head.remove(m);
  rider.headMeshes.length = 0;
  J.neck.remove(firstMesh(J.neck)); // o pescoço ficaria escondido dentro do gorjal/elmo
  const helm = mesh(GEO_HELM, M.metal, { s: headR });
  const slit = mesh(GEO_SLIT, MAT_DARK, { y: headR * 1.05, s: headR });
  const nasal = mesh(G.box(0.03, 0.30, 0.012), M.trim, { y: headR * 1.0, z: headR * 1.2 });
  // pluma de justa grande: dois segmentos, sobe do topo do elmo e curva para trás (fica legível à distância)
  const plume = mesh(G.capsule(0.04, 0.14, 6), M.accent, { y: headR * 2.42 + 0.01, z: -headR * 0.3 - 0.05, rx: -1.0, sx: 0.75, sz: 1.5 });
  const plume2 = mesh(G.capsule(0.04, 0.28, 6), M.accent, { y: headR * 2.42 + 0.075, z: -headR * 0.3 - 0.27, rx: -1.45, sx: 0.7, sz: 1.3 });
  for (const m of [helm, slit, nasal, plume, plume2]) { J.head.add(m); rider.headMeshes.push(m); }

  // ---- Escudo heater (joint `shield`, olha +Z): preso ao antebraço esquerdo, virado um pouco para a esquerda
  const shield = new THREE.Group();
  shield.add(mesh(GEO_SHIELD, M.accent, {}));
  shield.add(mesh(GEO_EMBLEM, M.trim, { y: -0.16, z: 0.03 }));
  shield.position.set(0, -0.05, 0.06);
  attachShield(rider, shield);

  // ---- Lança de justa (2,8 m no total: 0,62 m abaixo do punho, ponta 2,18 m acima; a base fica acima do pé)
  const BUTT = 0.62, TIP = 2.18;
  const lance = new THREE.Group();
  lance.add(mesh(G.cyl(0.016, 0.042, TIP - 0.3 + BUTT, 8), M.wood, { y: (TIP - 0.3 - BUTT) / 2 })); // haste afunilada
  lance.add(mesh(G.cyl(0.045, 0.045, 0.24, 8), M.leather, {}));                               // empunhadura
  lance.add(mesh(G.cone(0.085, 0.22, 10), M.metal, { y: 0.26, rx: Math.PI }));                 // guarda-mão (vamplate): abre para a ponta
  lance.add(mesh(G.cone(0.03, 0.32, 6), M.blade, { y: TIP - 0.16 }));                          // ponta
  lance.add(mesh(GEO_PENNON, M.accent, { y: TIP - 0.45, ry: Math.PI / 2 }));                    // flâmula (aponta para trás)
  attachWeapon(rider, lance, 'lance', TIP);

  // ---- Pose de sentinela: lança em pé ao lado do corpo (braço aberto: a haste passa longe do joelho e do pé),
  // escudo à frente do antebraço esquerdo
  J.shoulderR.rotation.set(-0.35, 0, 0.42);
  J.elbowR.rotation.x = -0.85;
  J.shoulderL.rotation.set(-0.35, 0, -0.1);
  J.elbowL.rotation.x = -1.3;
  root.updateMatrixWorld(true);
  level(J.weapon);
  J.weapon.rotateX(0.06); J.weapon.rotateZ(0.06); // quase vertical: topo um nada à frente e para dentro
  level(J.shield);
  J.shield.rotateY(-0.4);

  // estribos: correia da sela até o ferro, sob cada pé (posição do pé lida da pose)
  root.updateMatrixWorld(true);
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const foot = B.worldToLocal(J['knee' + side].localToWorld(new THREE.Vector3(0, -dims.shin - 0.02, 0.02)));
    const top = new THREE.Vector3(sx * 0.16, SEAT_Y - 0.06, HIPS_Z + 0.02);
    bar(B, top, foot, 0.012, M.leather);
    B.add(mesh(G.torus(0.05, 0.01, 6, 10), M.metal, { x: foot.x, y: foot.y - 0.03, z: foot.z, ry: Math.PI / 2 }));
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
  const box = new THREE.Box3();
  for (const m of [helm, plume, plume2]) box.expandByObject(m);
  rider.height = +box.max.y.toFixed(3);
  rider.eyeHeight = +rider.getEye(new THREE.Vector3()).y.toFixed(3);
  return snapshotRest(rider);
}
