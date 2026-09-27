// Dama: rainha guerreira. Coroa alta de ouro com oito pontas (quatro altas rematadas por esferas) e joias
// engastadas na faixa; cabelo longo (calota, duas mechas à frente dos ombros e uma trança afunilada pelas
// costas); vestido longo pregueado na cor do exército com debrum fino dourado na barra e à frente; corpete
// de placas de aço polido sobre o peito, com orla dourada e colar; capa curta de tecido presa aos ombros com
// broche; ombreiras pequenas de aço; mangas justas com cotovelo marcado e luvas longas de couro com canhão.
// Espada esguia de 1,2 m com lâmina de secção losangular e guarda, escudete e pomo dourados.
// Postura ereta de sentinela: espada em pé ao lado do ombro direito, braço esquerdo solto ao lado do corpo.
// Contrato em ../rig.js: construída olhando para +Z, pés na origem, metros (a casa mede 2 m).
// Observações:
//  - Como no bispo, as malhas das pernas (pélvis, coxas, canelas, pés) são removidas: ficariam sempre dentro
//    do vestido e, ao andar, os pés sairiam pela saia. Os joints hip/knee permanecem para battle.js; a dama
//    desliza com o balanço dos quadris e dos braços. O vestido tem fundo fechado (nada oco ao tombar).
//  - Conjuntos de peças do mesmo material (coroa, joias, guarnição da espada, orlas douradas do tronco)
//    são fundidos numa só geometria em nível de módulo, para caber folgadamente no limite de malhas.
//  - A capa e sua orla são tornos parciais de perfil fechado (casca com espessura), para não sumirem quando
//    vistas pelo lado de dentro (os materiais compartilhados são de face única).
//  - Os dois materiais extras do módulo são o aço polido do corpete/ombreiras (um por exército): o M.metal
//    das peças pretas é quase negro e o corpete sumia contra o vestido e a capa. As joias usam M.accent.
import * as THREE from '../three.js';
import { humanoid, attachWeapon, mesh, G, snapshotRest } from '../rig.js';

// ---------- Medidas (as mesmas fórmulas de humanoid(), para as geometrias serem calculadas uma vez) ----------
const H = 1.84;                 // altura do esqueleto; com a coroa o total chega a ~2,0 m
const LEG = 0.47 * H;           // 0.865  altura dos quadris
const TORSO_H = 0.30 * H;       // 0.552
const HEAD_R = 0.085 * H;       // 0.156
const NECK_H = 0.035 * H;       // 0.064
const LIMB_R = 0.04 * H;        // 0.074 (build 'light')
const LOWER = 0.15 * H;         // 0.276 antebraço

// ---------- Materiais extras (no máximo 2, criados uma vez): aço polido do corpete, por exército ----------
// Brancas em aço claro; pretas em aço cinza-médio, bem mais claro que o M.metal preto, para o corpete de
// placas se destacar do vestido escuro, da capa e do cabelo.
const MAT_STEEL = {
  w: new THREE.MeshStandardMaterial({ color: 0xd9dee6, roughness: 0.3, metalness: 0.5 }),
  b: new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.3, metalness: 0.5 }),
};

// ---------- Utilidades de geometria ----------
const v2 = (x, y) => new THREE.Vector2(x, y);

// Funde várias primitivas (cada uma com sua posição/rotação/escala, opções iguais às de mesh()) numa única
// geometria: uma só malha para um conjunto de peças do mesmo material. Só posição e normal (os materiais
// não usam texturas). Não altera as geometrias de origem (as do cache G.* são compartilhadas).
const _o = new THREE.Object3D();
function merged(parts) {
  const pos = [], nor = [];
  for (const [geo, o = {}] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    _o.position.set(o.x || 0, o.y || 0, o.z || 0);
    _o.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    _o.scale.set(o.sx || o.s || 1, o.sy || o.s || 1, o.sz || o.s || 1);
    _o.updateMatrix();
    g.applyMatrix4(_o.matrix);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

// Pregas: ondula o raio de um torno em torno de Y (n pregas, amplitude amp relativa) com intensidade que
// cresce de yTop (zero) até yBot (máxima). Altera a geometria no lugar e recalcula as normais.
function pleat(geo, n, amp, yTop, yBot) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const w = Math.min(1, Math.max(0, (yTop - y) / (yTop - yBot)));
    const f = 1 + amp * w * Math.cos(n * Math.atan2(x, z));
    p.setXYZ(i, x * f, y, z * f);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------- Geometrias próprias (criadas UMA vez no módulo, reutilizadas pelas duas cores) ----------
// Perfis de torno ordenados de baixo para cima (normais para fora); em Lathe, phi = 0 fica em +Z.

// Vestido (saia), no espaço do joint `hips`: fundo fechado a 2 cm do chão, sino largo na barra, afunila
// até os quadris e termina dentro do cinto (cinto em hips y ≈ 0.12..0.175). Seis pregas que nascem na
// altura dos quadris e ganham relevo até a barra. A malha leva sz 0.9.
const PLEATS = 6, PLEAT_AMP = 0.035, PLEAT_TOP = -0.05, PLEAT_BOT = -LEG + 0.07;
const SKIRT = pleat(new THREE.LatheGeometry([
  v2(0.001, -LEG + 0.02), v2(0.40, -LEG + 0.02), v2(0.405, -LEG + 0.07),
  v2(0.365, -0.60), v2(0.31, -0.40), v2(0.26, -0.22), v2(0.225, -0.08), v2(0.205, 0.02), v2(0.192, 0.10), v2(0.186, 0.165),
], 24), PLEATS, PLEAT_AMP, PLEAT_TOP, PLEAT_BOT);
// Debrum fino da barra (8 cm): acompanha o pé do vestido, 6 a 9 mm para fora, descendo 8 mm abaixo do fundo.
const SKIRT_HEM = pleat(new THREE.LatheGeometry([
  v2(0.411, -LEG + 0.012), v2(0.414, -LEG + 0.07), v2(0.4085, -LEG + 0.095),
], 24), PLEATS, PLEAT_AMP, PLEAT_TOP, PLEAT_BOT);
// Debrum frontal: faixa vertical (±0.085 rad em torno de +Z) da barra até o cinto, 5 mm fora do vestido.
const SKIRT_STRIPE = pleat(new THREE.LatheGeometry([
  v2(0.409, -LEG + 0.09), v2(0.37, -0.60), v2(0.315, -0.40), v2(0.265, -0.22), v2(0.230, -0.08), v2(0.210, 0.02), v2(0.197, 0.10), v2(0.192, 0.14),
], 2, -0.085, 0.17), PLEATS, PLEAT_AMP, PLEAT_TOP, PLEAT_BOT);

// Corpete de placas, no espaço do joint `torso`: nasce dentro do cinto (torso y 0.064..0.12), cintura
// marcada, busto e borda superior sob o colo. A malha leva sz 0.85 (o tronco é elíptico).
const CORSELET = new THREE.LatheGeometry([
  v2(0.176, 0.085), v2(0.176, 0.15), v2(0.180, 0.24), v2(0.198, 0.32), v2(0.204, 0.38), v2(0.196, 0.43), v2(0.184, 0.47),
], 12);

// Capa curta (espaço do torso): casca com 1 cm de espessura, ±46° em torno de -Z (mais estreita que os
// braços, que pendem em x ≈ ±0.20, para não os atravessar), abraça as costas do alto dos ombros (y 0.565)
// até logo abaixo do cinto (y -0.02), abrindo em sino. A malha leva sx 1.1.
const CAPE_PHI0 = Math.PI - 0.80, CAPE_PHI = 1.60;
const CAPE = new THREE.LatheGeometry([
  v2(0.245, -0.02), v2(0.20, 0.25), v2(0.165, 0.45), v2(0.15, 0.52), v2(0.135, 0.565),   // face externa (de baixo para cima)
  v2(0.125, 0.565), v2(0.14, 0.52), v2(0.155, 0.45), v2(0.19, 0.25), v2(0.235, -0.02),   // face interna (de cima para baixo)
  v2(0.245, -0.02),
], 8, CAPE_PHI0, CAPE_PHI);
// Orla dourada da capa: mesma casca, 3 cm de altura na borda inferior, 1 cm mais larga em ângulo.
const CAPE_HEM = new THREE.LatheGeometry([
  v2(0.254, -0.035), v2(0.249, 0.0), v2(0.239, 0.0), v2(0.244, -0.035), v2(0.254, -0.035),
], 8, CAPE_PHI0 - 0.05, CAPE_PHI + 0.1);

// Ouro do tronco (uma malha): orla superior do corpete, colar na base do pescoço e orla da capa.
const TORSO_GOLD = merged([
  [G.torus(0.186, 0.012, 6, 16), { y: 0.47, rx: Math.PI / 2, sz: 0.85 }],
  [G.torus(0.098, 0.017, 6, 14), { y: TORSO_H + 0.012, rx: Math.PI / 2 }],
  [CAPE_HEM, { sx: 1.1 }],
]);

// Cabelo: esfera com abertura de 140° para o rosto (centrada em +Z); cobre nuca e têmporas sob a coroa.
const HAIR_OPEN = (140 / 180) * Math.PI;
const HAIR = new THREE.SphereGeometry(1, 10, 8, Math.PI / 2 + HAIR_OPEN / 2, Math.PI * 2 - HAIR_OPEN);
// Trança das costas (espaço da cabeça): torno estreito que nasce dentro da calota, na nuca, engrossa um
// pouco e afila até a ponta arredondada, terminando sobre a capa entre as omoplatas; a malha leva sz 0.6
// (ligeiramente achatada) e inclina para trás, acompanhando a curva da nuca.
const HAIR_MANE = new THREE.LatheGeometry([
  v2(0.001, -0.36), v2(0.018, -0.352), v2(0.036, -0.31), v2(0.052, -0.20), v2(0.066, -0.06),
  v2(0.078, 0.06), v2(0.076, 0.13), v2(0.055, 0.17), v2(0.001, 0.19),
], 8);
// Mechas da frente: caem das têmporas à frente dos ombros, afiladas até a ponta.
const HAIR_LOCK = new THREE.LatheGeometry([
  v2(0.001, -0.30), v2(0.014, -0.293), v2(0.028, -0.22), v2(0.036, -0.08), v2(0.032, 0.0), v2(0.001, 0.03),
], 7);

// Coroa (espaço do joint `hat`, que fica a 1.9·headR do joint da cabeça): faixa anelar com espessura
// (paredes externa e interna, para não se ver o crânio pelo topo), oito pontas cônicas alternando altas
// (rematadas por esferas) e baixas — tudo ouro numa malha só; oito joias engastadas na faixa, noutra.
const R = HEAD_R;
const CROWN_PARTS = [[new THREE.LatheGeometry([
  v2(0.97 * R, -0.52 * R), v2(1.15 * R, -0.52 * R), v2(1.15 * R, -0.12 * R), v2(0.97 * R, -0.12 * R), v2(0.97 * R, -0.52 * R),
], 12), {}]];
const JEWEL_PARTS = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2, tall = i % 2 === 0;
  const h = (tall ? 1.05 : 0.55) * R;
  const x = Math.sin(a) * 1.06 * R, z = Math.cos(a) * 1.06 * R;
  CROWN_PARTS.push([G.cone(0.12 * R, h, 6), { x, y: -0.12 * R + h / 2, z, ry: a }]);
  if (tall) CROWN_PARTS.push([G.sphere(0.075 * R, 6), { x, y: -0.12 * R + h + 0.05 * R, z }]);
  JEWEL_PARTS.push([G.sphere((tall ? 0.11 : 0.07) * R, 6), { x: Math.sin(a) * 1.15 * R, y: -0.32 * R, z: Math.cos(a) * 1.15 * R }]);
}
const CROWN_GOLD = merged(CROWN_PARTS);
const CROWN_JEWELS = merged(JEWEL_PARTS);

// Espada (espaço do joint `weapon`): punho na origem, lâmina ao longo de +Y até 1,2 m.
const SWORD_LEN = 1.2;
const BLADE = G.cyl(0.004, 0.026, SWORD_LEN - 0.105, 4); // secção losangular (4 lados) afilada; a malha leva sz 0.28
const SWORD_GOLD = merged([
  [G.cyl(0.011, 0.011, 0.19, 6), { y: 0.10, rz: Math.PI / 2 }],                              // quilhões (barra ao longo de X)
  [G.sphere(0.015, 6), { x: -0.095, y: 0.10 }], [G.sphere(0.015, 6), { x: 0.095, y: 0.10 }], // remates dos quilhões
  [G.box(0.036, 0.04, 0.026), { y: 0.10 }],                                                  // escudete central
  [G.sphere(0.026, 8), { y: -0.115, sy: 0.8 }],                                              // pomo
]);

// Alinha o joint com o mundo (orientação identidade no espaço da raiz), cancelando as rotações do braço.
const _q = new THREE.Quaternion();
function level(j) {
  j.parent.getWorldQuaternion(_q);
  j.quaternion.copy(_q).invert();
}
const meshes = (o) => o.children.filter((c) => c.isMesh);
const firstMesh = (o) => o.children.find((c) => c.isMesh);
// Remove a primeira malha filha de um joint (as malhas da base não têm nome; a ordem é fixa em rig.js).
function dropFirstMesh(o) { const m = firstMesh(o); if (m) o.remove(m); }

export function buildQueen(color) {
  const char = humanoid({ type: 'q', color, height: H, build: 'light', armor: 'cloth' });
  const { M, joints: J } = char;
  const r = HEAD_R;
  const hm = char.headMeshes;
  const steel = MAT_STEEL[color];
  const jewel = M.accent; // safiras (azul) nas brancas, rubis (vermelho) nas pretas: a cor de destaque do exército

  // ---------- Pernas escondidas pelo vestido: fora a pélvis, coxas, canelas e pés (os joints ficam) ----------
  dropFirstMesh(J.hips);
  for (const side of ['L', 'R']) {
    dropFirstMesh(J['hip' + side]);                                  // coxa
    dropFirstMesh(J['knee' + side]); dropFirstMesh(J['knee' + side]); // canela e pé
  }

  // ---------- Vestido: saia pregueada, debrum da barra e debrum frontal dourados ----------
  J.hips.add(mesh(SKIRT, M.accent, { sz: 0.9 }));
  J.hips.add(mesh(SKIRT_HEM, M.trim, { sz: 0.9 }));
  J.hips.add(mesh(SKIRT_STRIPE, M.trim, { sz: 0.9 }));

  // ---------- Tronco: corpo do vestido esguio, cinto dourado, corpete de aço, orlas, capa e broche ----------
  const [body, belt] = meshes(J.torso);
  body.material = M.accent;            // corpo do vestido na cor do exército
  body.scale.set(0.92, 1, 0.78);       // tronco mais estreito e delgado que o padrão
  belt.material = M.trim;              // cinto dourado (cinturão)
  belt.scale.set(0.96, 1, 0.85);
  J.torso.add(mesh(CORSELET, steel, { sz: 0.85 }));
  J.torso.add(mesh(TORSO_GOLD, M.trim));
  J.torso.add(mesh(CAPE, M.cloth, { sx: 1.1 }));
  J.torso.add(mesh(G.sphere(0.024, 8), jewel, { y: 0.552, z: 0.118, sz: 0.6 })); // broche da capa sobre o colar

  // ---------- Braços: ombreiras pequenas de aço, mangas do vestido, cotovelo marcado, luvas de couro ----------
  for (const side of ['L', 'R']) {
    const sh = J['shoulder' + side], el = J['elbow' + side], hd = J['hand' + side];
    const [pauldron, upperArm] = meshes(sh);
    pauldron.material = steel; pauldron.scale.set(0.72, 0.62, 0.72); // calota pequena, achatada sobre o ombro
    upperArm.material = M.accent;        // manga do vestido
    firstMesh(el).material = M.accent;   // manga justa até o punho
    firstMesh(hd).material = M.leather;  // luva
    // braços e mãos mais finos que o padrão do rig (figura esguia)
    upperArm.scale.set(0.88, 1, 0.88); firstMesh(el).scale.set(0.86, 1, 0.86); firstMesh(hd).scale.set(0.85, 1.05, 0.85);
    el.add(mesh(G.sphere(LIMB_R, 8), M.accent, { s: 0.92 }));                                 // cotovelo (a manga franze na dobra)
    el.add(mesh(G.cyl(LIMB_R * 0.84, LIMB_R * 1.06, 0.10, 8), M.leather, { y: -LOWER + 0.04 })); // canhão da luva
  }

  // ---------- Cabeça: sobrancelhas, boca, cabelo e coroa (tudo em headMeshes: some na primeira pessoa) ----------
  for (const sx of [-1, 1]) {
    const brow = mesh(G.box(r * 0.28, r * 0.06, r * 0.06), M.hair, { x: sx * r * 0.36, y: r * 1.22, z: r * 0.9, ry: sx * 0.35, rz: -sx * 0.15 });
    J.head.add(brow); hm.push(brow);
  }
  const mouth = mesh(G.box(r * 0.24, r * 0.045, r * 0.05), M.leather, { y: r * 0.5, z: r * 0.9 });
  J.head.add(mouth); hm.push(mouth);
  // calota de cabelo envolvendo o crânio; trança estreita descendo pela nuca e sobre a capa, entre as
  // omoplatas; duas mechas afiladas caindo das têmporas à frente dos ombros
  const hairCap = mesh(HAIR, M.hair, { y: r * 0.95, sx: r * 1.04, sy: r * 1.14, sz: r * 1.04 });
  const hairBack = mesh(HAIR_MANE, M.hair, { y: -0.02, z: -0.155, rx: 0.26, sz: 0.6 });
  J.head.add(hairCap); hm.push(hairCap);
  J.head.add(hairBack); hm.push(hairBack);
  for (const sx of [-1, 1]) {
    const lock = mesh(HAIR_LOCK, M.hair, { x: sx * r * 0.88, y: r * 0.55, z: r * 0.30, rz: sx * 0.10, rx: -0.06, sz: 0.8 });
    J.head.add(lock); hm.push(lock);
  }
  // coroa: a faixa envolve o crânio acima da testa (head 1.38r) até 1.78r
  const crown = mesh(CROWN_GOLD, M.trim);
  const jewels = mesh(CROWN_JEWELS, jewel);
  J.hat.add(crown); hm.push(crown);
  J.hat.add(jewels); hm.push(jewels);

  // ---------- Espada (ao longo de +Y, punho na origem) ----------
  const sword = new THREE.Group();
  sword.add(mesh(BLADE, M.blade, { y: 0.105 + (SWORD_LEN - 0.105) / 2, sz: 0.28 })); // lâmina (chata em Z, gumes em ±X)
  sword.add(mesh(G.cyl(0.017, 0.019, 0.19, 8), M.leather, {}));                       // empunhadura de couro
  sword.add(mesh(SWORD_GOLD, M.trim));                                                // guarda, escudete e pomo
  attachWeapon(char, sword, 'sword', SWORD_LEN);

  // ---------- Pose de repouso (sentinela): espada em pé ao lado do ombro direito, um pouco afastada da
  // linha do olhar; braço esquerdo solto ao longo do corpo, cotovelo apenas ligeiramente dobrado ----------
  J.shoulderR.rotation.set(-0.36, 0, 0.30);
  J.elbowR.rotation.x = -1.05;
  J.shoulderL.rotation.set(-0.04, 0, -0.12);
  J.elbowL.rotation.x = -0.14;
  char.group.updateMatrixWorld(true);
  level(J.weapon); // espada na vertical, guarda ao longo de X

  // altura real com a coroa (sem a arma): topo das esferas das pontas altas
  char.height = LEG + 0.03 * H + TORSO_H + NECK_H + r * 1.9 + (-0.12 + 1.05 + 0.05 + 0.075) * r;
  return snapshotRest(char);
}
