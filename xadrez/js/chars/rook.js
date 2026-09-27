// Torre: guardião pesado de armadura de placas completa. Elmo-balde cilíndrico com AMEIAS no topo
// (como a torre de um castelo, lembrando a peça de xadrez) e fenda de visão em cruz embutida; ombreiras
// grandes; escudo-torre retangular alto na cor do exército com ameias; martelo de guerra de duas mãos com
// cabeça de ferro pesada. Postura de sentinela: pés bem afastados, martelo em pé ao lado do corpo (um pouco
// inclinado à frente para entrar no campo de visão em primeira pessoa), escudo à frente do antebraço esquerdo.
// Contrato em ../rig.js: pés na origem, olhando +Z, metros.
import * as THREE from '../three.js';
import { humanoid, attachWeapon, attachShield, mesh, G, snapshotRest } from '../rig.js';

// ---------- Materiais extras (no máximo 2, criados uma vez; iguais nas duas cores) ----------
// Fenda de visão: quase preto, fosco (é o vazio dentro do elmo).
const MAT_DARK = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.8 });
// Ferro da cabeça do martelo: metalness baixo para as faces sombrearem sem envmap (ferro forjado escuro, não espelho).
const MAT_IRON = new THREE.MeshStandardMaterial({ color: 0x6a6f78, roughness: 0.5, metalness: 0.25 });

// ---------- Geometrias próprias (criadas uma vez no módulo, reutilizadas pelas duas cores) ----------
const v2 = (x, y) => new THREE.Vector2(x, y);

// Acrescenta a um Shape o topo ameado, indo de (x1, y1) até (x0, y1): `merlons` merlões de altura mh.
function crenelTop(s, x0, x1, y1, merlons, mh) {
  const n = merlons * 2 - 1, seg = (x1 - x0) / n;
  for (let i = n - 1; i >= 0; i--) {
    const xa = x0 + seg * (i + 1), xb = x0 + seg * i;
    if (i % 2 === 0) { s.lineTo(xa, y1 + mh); s.lineTo(xb, y1 + mh); s.lineTo(xb, y1); } // merlão
    else s.lineTo(xb, y1); // vão
  }
}

// Anel de ameias do elmo: n merlões (setores anulares) extrudados para cima (+Y a partir de y=0).
function crenelRing(rIn, rOut, n, duty, h) {
  const shapes = [];
  const w = (Math.PI * 2 / n) * duty;
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 - w / 2 + (i / n) * Math.PI * 2; // um merlão centrado na frente (+Z)
    const s = new THREE.Shape();
    for (let k = 0; k <= 2; k++) { const a = a0 + w * k / 2; if (k === 0) s.moveTo(Math.cos(a) * rOut, Math.sin(a) * rOut); else s.lineTo(Math.cos(a) * rOut, Math.sin(a) * rOut); }
    for (let k = 2; k >= 0; k--) { const a = a0 + w * k / 2; s.lineTo(Math.cos(a) * rIn, Math.sin(a) * rIn); }
    s.closePath();
    shapes.push(s);
  }
  const g = new THREE.ExtrudeGeometry(shapes, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // extrusão em +Z vira +Y
  return g;
}

// Escudo-torre: retângulo alto centrado na origem, cantos inferiores chanfrados e topo ameado. Espessura em +Z.
function towerShieldGeo(w, h, merlons, mh, chamfer, depth) {
  const s = new THREE.Shape();
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2 - mh;
  s.moveTo(x0 + chamfer, y0); s.lineTo(x1 - chamfer, y0); s.lineTo(x1, y0 + chamfer); s.lineTo(x1, y1);
  crenelTop(s, x0, x1, y1, merlons, mh);
  s.lineTo(x0, y0 + chamfer); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}

// Emblema heráldico: silhueta de torre (base em y=0, centrada em x), base mais larga que o topo (paredes
// em talude), porta baixa em arco e 3 merlões — lê como castelo mesmo de longe (não como letra 'H').
function towerEmblemGeo(wBase, wTop, h, mh, doorW, doorH, depth) {
  const s = new THREE.Shape();
  const y1 = h - mh;
  s.moveTo(-wBase / 2, 0); s.lineTo(-doorW / 2, 0); s.lineTo(-doorW / 2, doorH - doorW / 2);
  s.absarc(0, doorH - doorW / 2, doorW / 2, Math.PI, 0, true);           // arco da porta
  s.lineTo(doorW / 2, 0); s.lineTo(wBase / 2, 0); s.lineTo(wTop / 2, y1);
  crenelTop(s, -wTop / 2, wTop / 2, y1, 3, mh);
  s.lineTo(-wBase / 2, 0); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}

// Perfis de torno (Lathe) ordenados de baixo para cima para que as normais apontem para fora.
const GEO_CRENELS = crenelRing(0.135, 0.19, 8, 0.55, 0.14);                      // ameias do elmo
const GEO_SHIELD = towerShieldGeo(0.56, 0.98, 4, 0.09, 0.05, 0.04);               // tábua do escudo
const GEO_EMBLEM = towerEmblemGeo(0.22, 0.17, 0.32, 0.07, 0.05, 0.08, 0.02);      // torre heráldica
const GEO_TABARD = new THREE.CylinderGeometry(0.2, 0.2, 0.40, 8, 1, true, -0.95, 1.9); // pano curvo sobre o peito
// Fenda de visão horizontal: casca poligonal de 3 faces (90°) alinhada com as 12 faces do elmo, ou seja,
// acompanha a curvatura do balde e fica rente à parede (2 mm para fora). Largura ~0.26 m (≈ 2/3 do diâmetro).
const GEO_SLIT_H = new THREE.CylinderGeometry(0.186, 0.187, 0.034, 3, 1, true, -Math.PI / 4, Math.PI / 2);
const GEO_PAULDRON = new THREE.LatheGeometry(                                     // ombreira abaulada com saia
  [v2(0.20, -0.20), v2(0.19, -0.12), v2(0.16, -0.06), v2(0.11, -0.02), v2(0.001, 0)], 10);
const GEO_FAULD = new THREE.LatheGeometry(                                        // saiote de placas em 3 lâminas
  [v2(0.31, -0.21), v2(0.30, -0.14), v2(0.285, -0.14), v2(0.29, -0.06), v2(0.275, -0.06), v2(0.28, 0.03), v2(0.265, 0.03), v2(0.27, 0.13)], 12);

const H = 1.76; // altura do esqueleto; com o elmo ameado o total chega a ~1.95 m

// Alinha o joint com o mundo (orientação identidade no espaço da raiz), cancelando as rotações do braço.
const _q = new THREE.Quaternion();
function level(j) {
  j.parent.getWorldQuaternion(_q);
  j.quaternion.copy(_q).invert();
}
const meshes = (o) => o.children.filter((c) => c.isMesh);
const firstMesh = (o) => meshes(o)[0];

export function buildRook(color) {
  const char = humanoid({ type: 'r', color, height: H, build: 'heavy', armor: 'plate' });
  const { M, dims, joints: J } = char;
  const { headR, torsoH, lower } = dims;

  // ---------- Armadura de placas completa: tronco, pélvis, coxas, braços e pés em metal ----------
  // (o rig usa M.armor bege para o corpo; aqui tudo vira placa; o tabardo e o escudo dão a cor do exército)
  firstMesh(J.torso).material = M.metal;
  firstMesh(J.hips).material = M.metal;

  // ---------- Cabeça: elmo-balde ameado (tudo em headMeshes, some na primeira pessoa) ----------
  const helmR = headR * 1.2, helmH = headR * 2.25; // ~0.18 de raio, ~0.34 de altura
  const helm = mesh(G.cyl(helmR, helmR * 1.03, helmH, 12), M.metal, { y: helmH / 2 + headR * 0.02, ry: Math.PI / 12 });
  // aro dourado: só um anel decorativo abaixo do topo (a tampa do elmo continua de metal, vista de cima)
  const band = mesh(G.cyl(helmR * 1.06, helmR * 1.06, 0.03, 12), M.trim, { y: helmH - 0.016, ry: Math.PI / 12 });
  const crenels = mesh(GEO_CRENELS, M.metal, { y: helmH + headR * 0.02 });
  // fenda em cruz embutida: barra horizontal curva (3 faces do balde) + barra vertical rente à face frontal
  const slitH = mesh(GEO_SLIT_H, MAT_DARK, { y: headR * 1.0 });
  const slitV = mesh(G.box(0.03, 0.17, 0.006), MAT_DARK, { y: headR * 1.0 - 0.045, z: helmR * 1.017 * Math.cos(Math.PI / 12) + 0.003 });
  for (const m of [helm, band, crenels, slitH, slitV]) { J.head.add(m); char.headMeshes.push(m); }

  // ---------- Tronco: gorjal, tabardo com emblema, saiote de placas ----------
  J.torso.add(mesh(G.cyl(0.14, 0.24, 0.10, 10), M.metal, { y: torsoH + 0.085, sz: 0.85 }));   // gorjal
  J.torso.add(mesh(GEO_TABARD, M.accent, { y: 0.29, sx: 1.36, sz: 1.01 }));                    // tabardo (abraça o peito)
  J.torso.add(mesh(GEO_EMBLEM, M.trim, { y: 0.16, z: 0.195, s: 0.85 }));                         // torre no peito
  J.hips.add(mesh(GEO_FAULD, M.metal, { sz: 0.85 }));                                            // saiote

  // ---------- Braços e pernas: ombreiras grandes, braçais, braçadeiras, manoplas, coxotes, grevas, sabatões ----------
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const [ball, upperArm] = meshes(J['shoulder' + side]);
    ball.scale.setScalar(0.7);            // ombreira básica encolhida, escondida sob a grande
    upperArm.material = M.metal;          // braçal de placa
    J['shoulder' + side].add(mesh(GEO_PAULDRON, M.metal, { x: sx * 0.03, y: 0.10, rz: -sx * 0.35 }));
    J['elbow' + side].add(mesh(G.cyl(0.085, 0.105, 0.19, 8), M.metal, { y: -lower * 0.52 }));
    firstMesh(J['elbow' + side]).material = M.metal; // antebraço em placa
    firstMesh(J['hand' + side]).material = M.metal;  // manopla
    // pernas: coxote, joelheira, greva e sabatão
    firstMesh(J['hip' + side]).material = M.metal;
    J['knee' + side].add(mesh(G.sphere(0.095, 8), M.metal, { z: 0.015, sy: 0.9 }));
    for (const m of meshes(J['knee' + side])) m.material = M.metal; // canela e pé
    // postura sólida: quadris bem afastados, pernas levemente abertas e pontas dos pés para fora
    J['hip' + side].position.x += sx * 0.085;
    J['hip' + side].rotation.z = sx * 0.05;
    J['knee' + side].rotation.y = sx * 0.14;
  }
  J.hips.position.y += 0.02; // compensa a sola do pé do rig, que desce 2 cm abaixo da origem

  // ---------- Escudo-torre (joint `shield`, olha +Z) ----------
  const shield = new THREE.Group();
  shield.add(mesh(GEO_SHIELD, M.accent, { z: -0.02 }));                        // tábua ameada
  shield.add(mesh(G.box(0.62, 0.10, 0.03), M.metal, { y: -0.12, z: -0.03 }));  // cinta de ferro (reforço horizontal)
  shield.add(mesh(GEO_EMBLEM, M.trim, { y: -0.34, z: 0.02 }));                  // torre heráldica
  shield.position.set(0.0, 0.06, 0.09); // à frente do antebraço esquerdo, junto ao flanco, ameias abaixo da ombreira
  shield.rotation.y = -0.15;            // borda interna um pouco à frente: cruza o flanco e não bate na coxa ao andar
  attachShield(char, shield);

  // ---------- Martelo de guerra de duas mãos (ao longo de +Y, punho na origem) ----------
  // A mão segura o cabo perto do ponto de equilíbrio (pega natural de um martelo pesado): 0.46 m de cabo abaixo
  // da mão, cabeça a 0.66 m acima dela. Assim a cabeça fica à altura do peito no repouso e assoma no canto
  // inferior da visão em primeira pessoa sem tapar a cena.
  const hammer = new THREE.Group();
  hammer.add(mesh(G.cyl(0.028, 0.032, 1.16, 8), M.wood, { y: 0.12 }));      // haste (-0.46 .. 0.70)
  hammer.add(mesh(G.cyl(0.038, 0.04, 0.32, 8), M.leather, { y: 0.0 }));     // empunhadura de couro
  hammer.add(mesh(G.cyl(0.05, 0.046, 0.12, 8), M.metal, { y: 0.55 }));      // colar
  hammer.add(mesh(G.box(0.16, 0.22, 0.42), MAT_IRON, { y: 0.66 }));         // cabeça de ferro (face em +Z)
  hammer.add(mesh(G.cone(0.05, 0.18, 6), M.blade, { y: 0.66, z: -0.30, rx: -Math.PI / 2 })); // espigão traseiro
  attachWeapon(char, hammer, 'hammer', 0.78); // ponta = topo da cabeça

  // ---------- Pose de repouso (sentinela) ----------
  J.shoulderR.rotation.set(-0.16, 0, 0.28);  // braços abertos: a haste passa fora da ombreira
  J.elbowR.rotation.x = -0.5;
  J.shoulderL.rotation.set(-0.10, 0, -0.18);
  J.elbowL.rotation.x = -0.42;
  char.group.updateMatrixWorld(true);
  level(J.weapon); // martelo em pé ...
  J.weapon.rotateX(0.30);  // ... levemente inclinado à frente (+Y da arma vai para +Z): a cabeça assoma no canto da visão em 1ª pessoa
  J.weapon.rotateZ(-0.03); // ... e um pouco para fora, afastando a haste da ombreira
  level(J.shield); // escudo vertical olhando +Z

  char.height = 1.95; // altura real com o elmo ameado (sem a arma)
  return snapshotRest(char);
}
