// Rei: o soberano do exército — a figura mais imponente do tabuleiro, reconhecível à distância pela coroa
// grande e pela capa até o chão. Coroa dourada com oito pontas (quatro altas em forma de folha), dois arcos
// cruzados, gorro de veludo na cor do exército com joias engastadas na faixa, orbe e cruz no topo; cabelo
// comprido, barba longa e bigode. Gola de pele clara (arminho) em volta do pescoço e capa longa na cor do
// exército caindo das costas até 3 cm do chão (casca com espessura: não há faces invisíveis quando ele
// tomba). Armadura de placas com ombreiras grandes debruadas de ouro, tabardo com debrum dourado e emblema
// de coroa, cinto dourado com joia, saiote de placas, braçadeiras com punhos dourados, manoplas, joelheiras
// e grevas. Espadão largo de 1,3 m (do punho à ponta) com guarda cruzada, virola e pomo dourados.
// Postura de sentinela: em pé, firme, espadão na vertical diante do ombro direito, braço esquerdo relaxado.
// Contrato em ../rig.js: construído olhando para +Z, pés na origem, metros (a casa mede 2 m).
// Observações:
//  - Conjuntos de peças do mesmo material (coroa, joias, cabelo+barba, guarnição da espada) são fundidos
//    numa só geometria em nível de módulo, para caber folgadamente no limite de malhas.
//  - O peitoral básico do humanoide (cápsula) é encurtado 15% em Y para o pescoço aparecer sob a gola.
//  - A capa é rígida: ao andar, as mãos podem roçar a borda dela atrás do corpo (sem simulação de pano).
import * as THREE from '../three.js';
import { humanoid, attachWeapon, mesh, G, snapshotRest } from '../rig.js';

// ---------- Medidas (as mesmas fórmulas de humanoid(), para as geometrias serem calculadas uma vez) ----------
const H = 1.87;                       // altura do esqueleto; com a coroa o total chega a ~2.1 m
const LEG = 0.47 * H;                 // 0.879  altura dos quadris
const TORSO_H = 0.30 * H;             // 0.561
const R = 0.085 * H;                  // 0.159  raio da cabeça (headR)
const NECK_H = 0.035 * H;             // 0.065
const TORSO_R = 0.13 * H;             // 0.243  (build 'heavy'); a cápsula do tronco leva sx 1.15, sz 0.85
const LOWER = 0.15 * H;               // 0.2805 antebraço
const FLOOR_T = -(LEG + 0.03 * H);    // y do chão no espaço do joint `torso` (-0.935)

// ---------- Material extra (1 dos 2 permitidos; criado uma vez, igual nas duas cores) ----------
const MAT_FUR = new THREE.MeshStandardMaterial({ color: 0xf3ece0, roughness: 1.0 }); // pele de arminho

// ---------- Utilidades de geometria ----------
const v2 = (x, y) => new THREE.Vector2(x, y);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
// Cópia transformada de uma geometria (o = { x, y, z, rx, ry, rz, s, sx, sy, sz }, como em mesh()).
function part(geo, o = {}) {
  _p.set(o.x || 0, o.y || 0, o.z || 0);
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0);
  const s = o.s ?? 1;
  _s.set(o.sx ?? s, o.sy ?? s, o.sz ?? s);
  _m.compose(_p, _q.setFromEuler(_e), _s);
  return geo.clone().applyMatrix4(_m);
}
// Funde várias geometrias (mesmo material) numa só malha. Só posição e normal (não há texturas).
function merged(parts) {
  const P = [], N = [];
  let n = 0;
  for (let g of parts) {
    if (g.index) g = g.toNonIndexed();
    P.push(g.attributes.position.array); N.push(g.attributes.normal.array);
    n += g.attributes.position.count;
  }
  const cat = (arrs) => { const out = new Float32Array(n * 3); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(cat(P), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(cat(N), 3));
  return geo;
}
// Prisma: polígono (lista de [x, y]) extrudado com profundidade d, centrado em z = 0.
function prism(pts, d) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

// ---------- Coroa (espaço do joint `hat`, que fica 0.15·R abaixo do topo do crânio) ----------
// Aro da testa (hat -0.57R) ao alto do crânio (hat -0.15R); pontas sobre o aro (folhas: altas nos eixos,
// baixas nas diagonais); dois meio-arcos achatados cruzados; orbe e cruz no topo. Tudo ouro, uma malha.
const crownPoint = (w, h) => prism([[-w / 2, 0], [w / 2, 0], [w * 0.4, h * 0.45], [0, h], [-w * 0.4, h * 0.45]], 0.1 * R);
const POINT_TALL = crownPoint(0.62 * R, 0.62 * R), POINT_SHORT = crownPoint(0.42 * R, 0.34 * R);
const ARCH = new THREE.TorusGeometry(1.02 * R, 0.1 * R, 6, 14, Math.PI); // meio-arco no plano XY (de +X a -X)
const CROWN_GOLD = merged([
  part(new THREE.CylinderGeometry(1.1 * R, 1.04 * R, 0.42 * R, 12), { y: -0.36 * R }),
  ...Array.from({ length: 8 }, (_, i) => part(i % 2 ? POINT_SHORT : POINT_TALL, { y: -0.15 * R, z: 1.07 * R }).rotateY(i * Math.PI / 4)),
  part(ARCH, { y: -0.15 * R, sy: 0.78 }),
  part(ARCH, { y: -0.15 * R, sy: 0.78, ry: Math.PI / 2 }),
  part(new THREE.SphereGeometry(0.2 * R, 8, 6), { y: 0.78 * R }),                 // orbe
  part(new THREE.BoxGeometry(0.08 * R, 0.55 * R, 0.08 * R), { y: 1.2 * R }),       // cruz: haste
  part(new THREE.BoxGeometry(0.36 * R, 0.08 * R, 0.08 * R), { y: 1.3 * R }),       // cruz: braço
]);
const CROWN_TOP = 1.475 * R; // topo da cruz acima do joint `hat`
// Veludo: gorro sob os arcos e oito joias engastadas entre as pontas (cor de destaque do exército).
const CROWN_VELVET = merged([
  part(new THREE.SphereGeometry(0.97 * R, 10, 8), { y: -0.15 * R, sy: 0.76 }),
  ...Array.from({ length: 8 }, (_, i) => part(new THREE.SphereGeometry(0.1 * R, 6, 5), { y: -0.36 * R, z: 1.09 * R }).rotateY((i + 0.5) * Math.PI / 4)),
]);

// ---------- Cabelo, barba, bigode e sobrancelhas (espaço do joint `head`; uma só malha) ----------
const HAIR_OPEN = (150 / 180) * Math.PI; // abertura para o rosto (centrada em +Z)
const HAIR = merged([
  part(new THREE.SphereGeometry(1, 10, 8, Math.PI / 2 + HAIR_OPEN / 2, Math.PI * 2 - HAIR_OPEN), { y: 0.95 * R, sx: 1.05 * R, sy: 1.15 * R, sz: 1.05 * R }),
  part(new THREE.SphereGeometry(1, 8, 6), { y: 0.35 * R, z: 0.3 * R, sx: 1.02 * R, sy: 0.5 * R, sz: 0.78 * R }),   // maxilar barbado
  part(new THREE.ConeGeometry(0.72 * R, 1.3 * R, 8), { y: -0.1 * R, z: 0.5 * R, rx: Math.PI, sz: 0.6 }),           // barba longa, ponta para baixo
  part(new THREE.SphereGeometry(1, 8, 6), { y: 0.62 * R, z: 0.9 * R, sx: 0.44 * R, sy: 0.1 * R, sz: 0.14 * R }),   // bigode
  part(new THREE.BoxGeometry(0.3 * R, 0.07 * R, 0.06 * R), { x: -0.36 * R, y: 1.2 * R, z: 0.9 * R, ry: -0.35 }),  // sobrancelhas
  part(new THREE.BoxGeometry(0.3 * R, 0.07 * R, 0.06 * R), { x: 0.36 * R, y: 1.2 * R, z: 0.9 * R, ry: 0.35 }),
]);

// ---------- Capa (espaço do joint `torso`): casca fechada de 2,5 cm, ±70° em torno de -Z ----------
// Perfil externo da barra (3 cm acima do chão) até a gola, depois o interno de volta (normais corretas dos
// dois lados). Em Lathe, phi = 0 fica em +Z; a capa é centrada em phi = π (costas). O eixo fica em z = -0.03.
const CAPE_T = 0.025;
// A barra abre bastante (raio 0.66) para o calcanhar da perna que vai para trás ao andar não furar a capa.
const CAPE_OUT = [v2(0.66, FLOOR_T + 0.03), v2(0.585, -0.70), v2(0.46, -0.45), v2(0.36, -0.20), v2(0.29, 0.05), v2(0.25, 0.30), v2(0.228, 0.48), v2(0.22, 0.575)];
const CAPE_HALF = (66 / 180) * Math.PI;
const CAPE = new THREE.LatheGeometry([...CAPE_OUT, ...CAPE_OUT.slice().reverse().map((p) => v2(p.x - CAPE_T, p.y)), CAPE_OUT[0]], 10, Math.PI - CAPE_HALF, CAPE_HALF * 2);

// ---------- Tabardo (espaço do torso): painel frontal ±0.85 rad que abraça o peito; raios em unidades do
// tronco (a malha leva sx 1.15·TORSO_R, sz 0.85·TORSO_R). Nasce dentro do cinto e afunila no alto do peito,
// terminando dentro da gola. O debrum é o mesmo painel um pouco para dentro e mais largo em ângulo.
const TABARD_PROFILE = [v2(1.03, 0.085), v2(1.03, 0.39), v2(1.0, 0.45), v2(0.93, 0.50), v2(0.86, 0.53)];
const TAB_HALF = 0.85;
const TABARD = new THREE.LatheGeometry(TABARD_PROFILE, 6, -TAB_HALF, TAB_HALF * 2);
const TABARD_TRIM = new THREE.LatheGeometry(TABARD_PROFILE.map((p) => v2(p.x - 0.02, p.y)), 7, -TAB_HALF - 0.1, TAB_HALF * 2 + 0.2);
// Emblema: silhueta de coroa (base em y = 0), 3 cm de espessura para as bordas assentarem no painel curvo.
const EMBLEM = prism([[-0.085, 0], [0.085, 0], [0.085, 0.05], [0.06, 0.13], [0.03, 0.07], [0, 0.15], [-0.03, 0.07], [-0.06, 0.13], [-0.085, 0.05]], 0.03);

// ---------- Saiote de placas (espaço do joint `hips`): quatro lâminas, nasce dentro do cinto ----------
const FAULD = new THREE.LatheGeometry([
  v2(0.345, -0.24), v2(0.335, -0.16), v2(0.318, -0.16), v2(0.325, -0.08), v2(0.308, -0.08), v2(0.315, 0.0),
  v2(0.298, 0.0), v2(0.305, 0.08), v2(0.288, 0.08), v2(0.29, 0.15),
], 12);

// ---------- Ombreira: cúpula abaulada (topo no joint do ombro), com aro dourado na borda ----------
const PAULDRON_R = 0.19;
const PAULDRON = new THREE.LatheGeometry([v2(PAULDRON_R, -0.19), v2(0.188, -0.12), v2(0.165, -0.055), v2(0.115, -0.012), v2(0.05, 0), v2(0.001, 0)], 10);

// ---------- Espadão (ao longo de +Y, punho na origem; ponta em SWORD_LEN) ----------
const SWORD_LEN = 1.3, BLADE_Y0 = 0.19;
const bladeShape = new THREE.Shape();
bladeShape.moveTo(-0.062, 0); bladeShape.lineTo(0.062, 0); bladeShape.lineTo(0.05, 0.86);
bladeShape.lineTo(0, SWORD_LEN - BLADE_Y0); bladeShape.lineTo(-0.05, 0.86); bladeShape.closePath();
// lâmina larga com chanfro (fio) nas duas faces: ~2 cm de espessura no total
const BLADE = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.006, bevelSegments: 1 });
BLADE.translate(0, BLADE_Y0, -0.005);
const SWORD_GOLD = merged([
  part(new THREE.SphereGeometry(0.04, 8, 6), { y: -0.17 }),                 // pomo
  part(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), { y: 0.145 }),      // virola
  part(new THREE.BoxGeometry(0.42, 0.045, 0.07), { y: 0.178 }),              // guarda cruzada
  part(new THREE.SphereGeometry(0.032, 8, 6), { x: -0.21, y: 0.178 }),      // remates da guarda
  part(new THREE.SphereGeometry(0.032, 8, 6), { x: 0.21, y: 0.178 }),
]);

// Alinha o joint com o mundo (orientação identidade no espaço da raiz), cancelando as rotações do braço.
const _wq = new THREE.Quaternion();
function level(j) {
  j.parent.getWorldQuaternion(_wq);
  j.quaternion.copy(_wq).invert();
}
const firstMesh = (o) => o.children.find((c) => c.isMesh);

export function buildKing(color) {
  const char = humanoid({ type: 'k', color, height: H, build: 'heavy', armor: 'plate' });
  const { M, joints: J } = char;
  const hm = char.headMeshes;

  // ---------- Tronco: peitoral encurtado, cinto dourado com joia, tabardo debruado, saiote ----------
  firstMesh(J.torso).scale.y = 0.85;                                   // o pescoço aparece sob a gola
  J.torso.children.filter((c) => c.isMesh)[1].material = M.trim;        // cinto (2ª malha do torso) em ouro
  J.torso.add(mesh(G.box(0.07, 0.05, 0.016), M.accent, { y: 0.05 * H, z: 1.2 * TORSO_R * 0.85 + 0.008 })); // joia da fivela
  J.torso.add(mesh(TABARD_TRIM, M.trim, { sx: 1.15 * TORSO_R, sz: 0.85 * TORSO_R }));
  J.torso.add(mesh(TABARD, M.accent, { sx: 1.15 * TORSO_R, sz: 0.85 * TORSO_R }));
  J.torso.add(mesh(EMBLEM, M.trim, { y: 0.25, z: 0.85 * TORSO_R * 1.03 + 0.017 }));
  J.hips.add(mesh(FAULD, M.metal, { sz: 0.85 }));

  // ---------- Gola de pele e capa ----------
  J.torso.add(mesh(G.torus(0.15, 0.065, 8, 16), MAT_FUR, { y: 0.57, rx: Math.PI / 2 }));
  J.torso.add(mesh(CAPE, M.accent, { z: -0.03 }));

  // ---------- Braços e pernas: ombreiras grandes, braçadeiras, punhos dourados, manoplas, joelheiras, grevas ----------
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const sh = J['shoulder' + side], el = J['elbow' + side], hd = J['hand' + side], kn = J['knee' + side];
    sh.remove(firstMesh(sh));                                           // ombreira básica fora: entra a grande
    const pauldron = mesh(PAULDRON, M.metal, { x: sx * 0.03, y: 0.09, rz: -sx * 0.3 }); // inclinada para fora
    pauldron.add(mesh(G.torus(PAULDRON_R, 0.015, 6, 16), M.trim, { y: -0.19, rx: Math.PI / 2 })); // aro dourado
    sh.add(pauldron);
    firstMesh(el).material = M.metal;                                   // braçadeira
    el.add(mesh(G.cyl(0.095, 0.1, 0.035, 8), M.trim, { y: -LOWER * 0.68 })); // punho dourado acima da manopla
    firstMesh(hd).material = M.metal;                                   // manopla
    firstMesh(kn).material = M.metal;                                   // greva
    kn.add(mesh(G.sphere(0.105, 8), M.metal, { z: 0.015, sy: 0.9 }));   // joelheira
    J['hip' + side].position.x += sx * 0.035;                           // pés um pouco afastados: postura firme
  }

  // ---------- Cabeça: cabelo/barba e coroa (tudo em headMeshes: some na câmera em primeira pessoa) ----------
  const hair = mesh(HAIR, M.hair);
  J.head.add(hair); hm.push(hair);
  const gold = mesh(CROWN_GOLD, M.trim), velvet = mesh(CROWN_VELVET, M.accent);
  J.hat.add(gold, velvet); hm.push(gold, velvet);

  // ---------- Espadão ----------
  const sword = new THREE.Group();
  sword.add(mesh(G.cyl(0.024, 0.027, 0.30, 8), M.leather, { y: -0.01 }));  // empunhadura de couro (mão no meio)
  sword.add(mesh(SWORD_GOLD, M.trim));
  sword.add(mesh(BLADE, M.blade));
  sword.add(mesh(G.box(0.02, 0.6, 0.024), M.metal, { y: 0.53 }));          // goteira (canal central) da lâmina
  attachWeapon(char, sword, 'sword', SWORD_LEN);

  // ---------- Pose de repouso (sentinela): espadão em pé diante do ombro direito; esquerdo relaxado ----------
  J.shoulderR.rotation.set(-0.42, 0, 0.12); // um pouco para fora: a lâmina fica ao lado da cabeça, não à frente
  J.elbowR.rotation.x = -0.98;
  J.shoulderL.rotation.set(-0.1, 0, -0.22);
  J.elbowL.rotation.x = -0.35;
  char.group.updateMatrixWorld(true);
  level(J.weapon); // lâmina na vertical

  // altura real com a coroa (sem a arma); a altura dos olhos não muda
  char.height = LEG + 0.03 * H + TORSO_H + NECK_H + 1.9 * R + CROWN_TOP;
  return snapshotRest(char);
}
