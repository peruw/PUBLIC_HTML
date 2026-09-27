// Bispo: clérigo guerreiro. Túnica (alva) longa até os pés escondendo as pernas; sobreveste/escapulário
// na cor do exército com debrum dourado e cruz peitoral; ombros estreitos; mitra alta bipartida (dois
// painéis pontudos com fenda no meio) com faixa dourada e ínfulas atrás; barba curta; mãos visíveis.
// Báculo de 2,1 m: haste de madeira, nó e curva (crozier) dourados no topo. Sem armadura.
// Contrato em ../rig.js: construído olhando para +Z, pés na origem, metros (a casa mede 2 m).
// Observação: as malhas das pernas (pélvis, coxas, canelas e pés) são removidas: ficariam sempre dentro
// da túnica e, ao andar, os pés sairiam voando pela saia. Os joints hip/knee permanecem (battle.js pode
// movê-los à vontade); o bispo desliza com o balanço dos quadris e dos braços. A túnica tem fundo fechado
// para não se ver o oco quando o bispo tomba.
import * as THREE from '../three.js';
import { humanoid, attachWeapon, mesh, G, snapshotRest } from '../rig.js';

// ---------- Medidas (as mesmas fórmulas de humanoid(), para as geometrias serem calculadas uma vez) ----------
const H = 1.68;                 // altura do esqueleto; com a mitra o total chega a ~1.9 m
const LEG = 0.47 * H;           // 0.79  altura dos quadris
const TORSO_H = 0.30 * H;       // 0.50
const HEAD_R = 0.085 * H;       // 0.143
const LIMB_R = 0.04 * H;        // 0.067 (build 'light')
const LOWER = 0.15 * H;         // 0.252 antebraço

// ---------- Geometrias próprias (criadas UMA vez no módulo, reutilizadas pelas duas cores) ----------
const v2 = (x, y) => new THREE.Vector2(x, y);
// Perfis de torno ordenados de baixo para cima (normais para fora).

// Túnica: no espaço do joint `hips` (quadris a LEG m do chão). Fundo fechado em y = 0.03 m do chão,
// barra larga, afunila até a cintura e termina dentro do cinto (que fica em hips y ≈ 0.11..0.16).
const ROBE = new THREE.LatheGeometry([
  v2(0.001, -LEG + 0.03), v2(0.30, -LEG + 0.03), v2(0.305, -LEG + 0.07),
  v2(0.27, -0.50), v2(0.235, -0.30), v2(0.21, -0.10), v2(0.20, 0.0), v2(0.195, 0.10), v2(0.185, 0.155),
], 12);

// Sobreveste (painel da frente; o de trás é o mesmo girado 180°): torno parcial de ±43° em torno de +Z,
// no espaço do joint `torso`. Abraça o peito, passa por fora do cinto e desce até o joelho.
const PANEL_PROFILE = [
  v2(0.262, -0.40), v2(0.248, -0.30), v2(0.232, -0.20), v2(0.222, -0.10), v2(0.215, -0.02),
  v2(0.207, 0.055), v2(0.207, 0.11), v2(0.185, 0.15), v2(0.176, 0.25), v2(0.176, 0.40),
  v2(0.17, 0.45), v2(0.15, 0.50), v2(0.125, 0.53),
];
const PANEL_HALF = 0.75; // meia-largura angular (rad)
const PANEL = new THREE.LatheGeometry(PANEL_PROFILE, 6, -PANEL_HALF, PANEL_HALF * 2);
// Debrum: mesmo perfil 6 mm para dentro, 0.1 rad mais largo de cada lado e 4 cm mais comprido embaixo,
// de modo que só as bordas douradas apareçam em volta do painel.
const PANEL_TRIM = new THREE.LatheGeometry(
  [v2(0.262, -0.44), ...PANEL_PROFILE.map((p) => v2(p.x - 0.006, p.y))], 7, -PANEL_HALF - 0.1, PANEL_HALF * 2 + 0.2);

// Cruz peitoral (latina), centrada na origem, espessura em +Z.
function crossGeo(w, h, t, depth) {
  const s = new THREE.Shape();
  const yBar = h * 0.2; // centro da barra horizontal acima do centro
  s.moveTo(-t / 2, -h / 2); s.lineTo(t / 2, -h / 2); s.lineTo(t / 2, yBar - t / 2); s.lineTo(w / 2, yBar - t / 2);
  s.lineTo(w / 2, yBar + t / 2); s.lineTo(t / 2, yBar + t / 2); s.lineTo(t / 2, h / 2); s.lineTo(-t / 2, h / 2);
  s.lineTo(-t / 2, yBar + t / 2); s.lineTo(-w / 2, yBar + t / 2); s.lineTo(-w / 2, yBar - t / 2); s.lineTo(-t / 2, yBar - t / 2);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}
const CROSS = crossGeo(0.11, 0.16, 0.026, 0.018);

// Painel da mitra: arco ogival (base w, altura h) extrudado d em Z e centrado em z; base em y = 0.
function mitrePanelGeo(w, h, d) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, 0.2 * h);
  s.quadraticCurveTo(0.34 * w, 0.64 * h, 0, h);
  s.quadraticCurveTo(-0.34 * w, 0.64 * h, -w / 2, 0.2 * h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 5 });
  g.translate(0, 0, -d / 2);
  return g;
}
const MITRE_H = 1.6 * HEAD_R; // altura dos painéis acima da faixa
const MITRE_PANEL = mitrePanelGeo(1.9 * HEAD_R, MITRE_H, 0.55 * HEAD_R);
// Cabelo: esfera com abertura de 150° para o rosto (centrada em +Z); cobre a nuca e as têmporas sob a mitra.
const HAIR_OPEN = (150 / 180) * Math.PI;
const HAIR = new THREE.SphereGeometry(1, 10, 8, Math.PI / 2 + HAIR_OPEN / 2, Math.PI * 2 - HAIR_OPEN);

// Curva do báculo: arco de 270° (raio R, tubo t). Colocado com rz = -π/2 e centro em (+R, y0), começa
// tangente ao topo da haste, passa por cima e enrola para fora (+X), terminando embaixo à direita.
const CROOK_R = 0.095, CROOK_T = 0.015;
const CROOK = new THREE.TorusGeometry(CROOK_R, CROOK_T, 6, 14, Math.PI * 1.5);
// Báculo: punho na origem; base a STAFF_BUTT abaixo da mão, ponta a STAFF_TIP acima (total 2,1 m).
const STAFF_TIP = 1.2, STAFF_BUTT = 0.9;
const CROOK_Y0 = STAFF_TIP - CROOK_R - CROOK_T; // altura do centro do arco (topo em STAFF_TIP)

// Alinha o joint com o mundo (orientação identidade no espaço da raiz), cancelando as rotações do braço.
const _q = new THREE.Quaternion();
function level(j) {
  j.parent.getWorldQuaternion(_q);
  j.quaternion.copy(_q).invert();
}
const firstMesh = (o) => o.children.find((c) => c.isMesh);
// Remove a primeira malha filha de um joint (as malhas da base não têm nome; a ordem é fixa em rig.js).
function dropFirstMesh(o) { const m = firstMesh(o); if (m) o.remove(m); }

export function buildBishop(color) {
  const char = humanoid({ type: 'b', color, height: H, build: 'light', armor: 'cloth' });
  const { M, joints: J } = char;
  const r = HEAD_R;
  const hm = char.headMeshes;

  // ---------- Pernas escondidas pela túnica: fora a pélvis, coxas, canelas e pés (os joints ficam) ----------
  dropFirstMesh(J.hips);
  for (const side of ['L', 'R']) {
    dropFirstMesh(J['hip' + side]);                                  // coxa
    dropFirstMesh(J['knee' + side]); dropFirstMesh(J['knee' + side]); // canela e pé
  }

  // ---------- Túnica (alva) e cinto ----------
  J.hips.add(mesh(ROBE, M.cloth, { sz: 0.9 }));
  J.torso.children.filter((c) => c.isMesh)[1].material = M.leather; // cinto (2ª malha do torso) em couro

  // ---------- Sobreveste na cor do exército com debrum dourado (frente e costas) e cruz peitoral ----------
  for (const ry of [0, Math.PI]) {
    J.torso.add(mesh(PANEL_TRIM, M.trim, { ry, sz: 0.9 }));
    J.torso.add(mesh(PANEL, M.accent, { ry, sz: 0.9 }));
  }
  J.torso.add(mesh(CROSS, M.trim, { y: 0.30, z: 0.176 * 0.9 + 0.012 }));
  // colarinho dourado na base do pescoço
  J.torso.add(mesh(G.torus(0.105, 0.022, 6, 12), M.trim, { y: 0.545, rx: Math.PI / 2 }));

  // ---------- Braços: mangas da túnica com punhos largos; ombros estreitos cobertos pela sobreveste ----------
  for (const side of ['L', 'R']) {
    const sh = J['shoulder' + side], el = J['elbow' + side];
    dropFirstMesh(sh);                   // sem ombreira: ombros estreitos, a sobreveste cobre a junta
    firstMesh(el).material = M.cloth;    // antebraço vira manga
    el.add(mesh(G.cyl(LIMB_R * 0.85, LIMB_R * 1.45, LOWER * 0.45, 8), M.cloth, { y: -LOWER * 0.775 })); // punho em sino
  }

  // ---------- Cabeça: barba, sobrancelhas e mitra (tudo em headMeshes: some na primeira pessoa) ----------
  const hair = mesh(HAIR, M.hair, { y: r * 0.95, sx: r * 1.03, sy: r * 1.13, sz: r * 1.03 });
  const beard = mesh(G.sphere(0.5, 8), M.hair, { y: r * 0.32, z: r * 0.5, sx: r * 1.6, sy: r * 0.7, sz: r * 1.0 });
  J.head.add(hair); hm.push(hair);
  J.head.add(beard); hm.push(beard);
  for (const sx of [-1, 1]) {
    const brow = mesh(G.box(r * 0.3, r * 0.07, r * 0.06), M.hair, { x: sx * r * 0.36, y: r * 1.2, z: r * 0.9, ry: sx * 0.35 });
    J.head.add(brow); hm.push(brow);
  }
  // faixa da mitra envolvendo o crânio (no espaço do joint `hat`, que fica 0.15·headR abaixo do topo do
  // crânio): do alto das sobrancelhas (hat -0.55r) até hat -0.05r, onde o crânio já é estreito o bastante
  // para caber dentro dos painéis
  const band = mesh(G.cyl(r * 1.1, r * 1.1, r * 0.5, 12), M.accent, { y: -r * 0.3, sz: 0.92 });
  const circ = mesh(G.cyl(r * 1.15, r * 1.15, r * 0.2, 12), M.trim, { y: -r * 0.45, sz: 0.92 });  // debrum dourado
  // dois painéis ogivais sobre a faixa, inclinados para fora (rx positivo leva o topo para +Z): a fenda
  // em V fica entre eles; um forro fino no plano central esconde o topo do crânio dentro da fenda
  const front = mesh(MITRE_PANEL, M.accent, { y: -r * 0.05, z: r * 0.37, rx: 0.17 });
  const back = mesh(MITRE_PANEL, M.accent, { y: -r * 0.05, z: -r * 0.37, rx: -0.17 });
  const lining = mesh(G.box(r * 1.5, r * 0.7, r * 0.03), M.accent, { y: r * 0.3 });
  // faixa dourada vertical no painel da frente (filha do painel: acompanha a inclinação dele)
  const stripe = mesh(G.box(r * 0.16, r * 1.15, r * 0.04), M.trim, { y: r * 0.58, z: r * 0.295 });
  front.add(stripe);
  for (const m of [band, circ, front, back, lining]) J.hat.add(m);
  hm.push(band, circ, front, back, lining, stripe);
  // ínfulas: duas fitas pendendo da parte de trás da faixa
  for (const sx of [-1, 1]) {
    const lap = mesh(G.box(r * 0.28, r * 1.1, r * 0.05), M.accent, { x: sx * r * 0.32, y: -r * 1.1, z: -r * 1.08 });
    J.hat.add(lap); hm.push(lap);
  }

  // ---------- Báculo (ao longo de +Y, punho na origem; a haste continua abaixo da mão até o chão) ----------
  const staff = new THREE.Group();
  const shaftTop = CROOK_Y0 - 0.07, shaftLen = shaftTop + STAFF_BUTT - 0.02;
  staff.add(mesh(G.cyl(0.017, 0.02, shaftLen, 6), M.wood, { y: (shaftTop - STAFF_BUTT + 0.02) / 2 })); // haste
  staff.add(mesh(G.cyl(0.02, 0.014, 0.06, 6), M.metal, { y: -STAFF_BUTT + 0.03 }));                 // ponteira
  staff.add(mesh(G.sphere(0.04, 8), M.trim, { y: shaftTop }));                                       // nó
  staff.add(mesh(G.cyl(0.016, 0.016, 0.08, 6), M.trim, { y: CROOK_Y0 - 0.035 }));                    // colo
  staff.add(mesh(CROOK, M.trim, { x: CROOK_R, y: CROOK_Y0, rz: -Math.PI / 2 }));                     // curva
  staff.add(mesh(G.sphere(0.028, 8), M.trim, { x: CROOK_R, y: CROOK_Y0 - CROOK_R }));                // remate
  attachWeapon(char, staff, 'staff', STAFF_TIP);

  // ---------- Pose de repouso (sentinela): báculo em pé na mão direita, base no chão; esquerda relaxada ----------
  J.shoulderR.rotation.set(-0.22, 0, 0.0);
  J.elbowR.rotation.x = -0.85;
  J.shoulderL.rotation.set(-0.12, 0, -0.06);
  J.elbowL.rotation.x = -0.4;
  char.group.updateMatrixWorld(true);
  level(J.weapon); // báculo na vertical

  // altura real com a mitra (sem a arma): topo dos painéis = hat - 0.05·headR + MITRE_H
  char.height = LEG + 0.03 * H + TORSO_H + 0.035 * H + r * 1.9 - r * 0.05 + MITRE_H;
  return snapshotRest(char);
}
