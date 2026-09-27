// Peão: soldado de infantaria — a peça mais simples e numerosa do exército.
// Chapéu-de-ferro de aba larga sobre coifa acolchoada; gambesão de tecido com saia, tabardo na cor
// do exército e cinto de couro com fivela e adaga; calças de tecido, botas e luvas de couro.
// Lança de 2,3 m com ponta de ferro (mão do joint `weapon`) e escudo redondo de madeira com umbo de
// ferro (joint `shield`). Contrato em ../rig.js: construído olhando para +Z, pés na origem, metros.
// Observação: no rig o lado 'R' fica em +X; olhando para +Z isso é anatomicamente a esquerda, então
// em primeira pessoa a lança aparece à esquerda e o escudo à direita (convenção comum a todo o exército).
import * as THREE from '../three.js';
import { humanoid, attachWeapon, attachShield, mesh, G, snapshotRest } from '../rig.js';

// ---------- Geometrias próprias: criadas UMA vez no módulo e compartilhadas pelas duas cores ----------
// Chapéu-de-ferro: perfil (raio, altura) em unidades de headR, percorrido no sentido anti-horário
// para que as normais apontem para fora. Pontos repetidos produzem vincos (arestas vivas) na aba.
const KETTLE_PROFILE = [
  [0, 0.12], [1.08, 0.12], [1.08, 0.12],            // disco interno (fica escondido dentro da cabeça)
  [1.62, -0.14], [1.62, -0.14], [1.66, -0.08], [1.66, -0.08], // face de baixo e borda da aba
  [1.12, 0.2], [1.12, 0.2],                         // face de cima da aba até a calota
  [1.06, 0.42], [0.9, 0.66], [0.62, 0.84], [0.3, 0.94], [0, 0.97], // calota
].map(([r, y]) => new THREE.Vector2(r, y));
const KETTLE = new THREE.LatheGeometry(KETTLE_PROFILE, 12);
// Coifa acolchoada: esfera com abertura de 100° para o rosto (centrada em +Z).
const COIF_OPEN = (100 / 180) * Math.PI;
const COIF = new THREE.SphereGeometry(1, 10, 8, Math.PI / 2 + COIF_OPEN / 2, Math.PI * 2 - COIF_OPEN);
// Meia-esfera (umbo do escudo), eixo +Y.
const HEMI = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
// Painel do tabardo: casca de cilindro aberta cobrindo ±43° em torno de +Z, afunilada em cima (colarinho)
// e um pouco embaixo, para a borda ficar dentro do cinto (que é um prisma de 12 lados) e não furá-lo.
const TABARD = new THREE.CylinderGeometry(0.88, 0.97, 1, 6, 1, true, -0.75, 1.5);

// Primeira malha filha de um joint (as malhas da base não têm nome; a ordem é fixa em rig.js).
const firstMesh = (j) => j.children.find((o) => o.isMesh);

// Lança: punho a BUTT metros da base, ponta a TIP metros acima da mão (total 2,3 m).
const SPEAR_TOTAL = 2.3, SPEAR_BUTT = 0.95, SPEAR_TIP = SPEAR_TOTAL - SPEAR_BUTT;
// Escudo: raio e distância da mão à tábua.
const SHIELD_R = 0.3, SHIELD_Z = 0.09;

export function buildPawn(color) {
  const char = humanoid({ type: 'p', color, height: 1.7, build: 'light', armor: 'cloth' });
  const { M, dims, joints: J } = char;
  const r = dims.headR, lr = dims.limbR, tr = dims.torsoR, tH = dims.torsoH;
  const hm = char.headMeshes;

  // ---- Mangas e luvas: o gambesão vai até o punho; as mãos ganham luvas de couro (só troca o material).
  firstMesh(J.elbowL).material = M.cloth;
  firstMesh(J.elbowR).material = M.cloth;
  firstMesh(J.handL).material = M.leather;
  firstMesh(J.handR).material = M.leather;

  // ---- Cabeça (tudo em headMeshes, para sumir na câmera em primeira pessoa)
  // coifa acolchoada envolvendo o crânio, com o rosto aberto
  const coif = mesh(COIF, M.cloth, { y: r * 0.95, sx: r * 1.08, sy: r * 1.19, sz: r * 1.08 });
  J.head.add(coif); hm.push(coif);
  // chapéu-de-ferro: a aba fica logo acima das sobrancelhas (y = 1,3·headR no espaço da cabeça)
  const kettle = mesh(KETTLE, M.metal, { y: -r * 0.6, s: r });
  J.hat.add(kettle); hm.push(kettle);
  // sobrancelhas e boca (expressão neutra)
  for (const sx of [-1, 1]) {
    const brow = mesh(G.box(r * 0.3, r * 0.07, r * 0.06), M.hair, { x: sx * r * 0.36, y: r * 1.2, z: r * 0.9, ry: sx * 0.35 });
    J.head.add(brow); hm.push(brow);
  }
  const mouth = mesh(G.box(r * 0.3, r * 0.05, r * 0.05), M.leather, { y: r * 0.5, z: r * 0.9 });
  J.head.add(mouth); hm.push(mouth);

  // ---- Gambesão: tabardo na cor do exército (painéis da frente e das costas), fivela do cinto
  for (const ry of [0, Math.PI]) {
    // vai do meio do cinto (fica preso sob ele) até a base do pescoço
    J.torso.add(mesh(TABARD, M.accent, { y: tH * 0.575, ry, sx: tr * 1.24, sy: tH * 0.815, sz: tr * 0.97 }));
  }
  J.torso.add(mesh(G.box(0.06, 0.05, 0.02), M.trim, { y: tH / 6, z: tr * 1.02 + 0.01 }));
  // saia do gambesão: começa dentro do cinto e desce até o meio da coxa
  J.hips.add(mesh(G.cyl(tr * 1.18, tr * 1.32, dims.legLen * 0.38, 12), M.cloth, { y: -dims.legLen * 0.025, sz: 0.8 }));
  // adaga embainhada pendurada no cinto, no quadril do lado L do rig (-X): bainha + cabo
  const dagger = new THREE.Group();
  dagger.position.set(-tr * 1.35, 0.01, 0.03);
  dagger.rotation.set(0.2, 0, -0.1);
  dagger.add(mesh(G.box(0.03, 0.22, 0.045), M.leather, {}));
  dagger.add(mesh(G.cyl(0.012, 0.015, 0.1, 6), M.wood, { y: 0.16 }));
  J.hips.add(dagger);
  // canos das botas, logo abaixo do joelho
  for (const knee of [J.kneeL, J.kneeR]) {
    knee.add(mesh(G.cyl(lr * 1.22, lr * 1.22, lr * 0.7, 8), M.leather, { y: -lr * 0.65 }));
  }

  // ---- Lança (ao longo de +Y, punho na origem; a haste continua abaixo da mão até a base)
  const spear = new THREE.Group();
  const shaftLen = SPEAR_TIP - 0.4 + SPEAR_BUTT;
  spear.add(mesh(G.cyl(0.016, 0.02, shaftLen, 6), M.wood, { y: (SPEAR_TIP - 0.4 - SPEAR_BUTT) / 2 })); // haste
  spear.add(mesh(G.cyl(0.024, 0.024, 0.16, 6), M.leather, {}));                                  // empunhadura
  spear.add(mesh(G.cyl(0.019, 0.026, 0.1, 6), M.metal, { y: SPEAR_TIP - 0.35 }));               // encaixe
  spear.add(mesh(G.cone(0.042, 0.3, 6), M.blade, { y: SPEAR_TIP - 0.15, sz: 0.45 }));            // folha da ponta
  spear.add(mesh(G.cyl(0.021, 0.017, 0.05, 6), M.metal, { y: -SPEAR_BUTT + 0.025 }));           // ponteira da base
  attachWeapon(char, spear, 'spear', SPEAR_TIP);

  // ---- Escudo redondo (olha para +Z; a mão fica atrás do umbo segurando a barra)
  const shield = new THREE.Group();
  shield.add(mesh(G.cyl(SHIELD_R, SHIELD_R * 0.97, 0.035, 14), M.wood, { z: SHIELD_Z, rx: Math.PI / 2 })); // tábua
  shield.add(mesh(G.torus(SHIELD_R, 0.018, 6, 14), M.metal, { z: SHIELD_Z }));                           // aro
  shield.add(mesh(G.cyl(SHIELD_R * 0.62, SHIELD_R * 0.62, 0.006, 14), M.accent, { z: SHIELD_Z + 0.02, rx: Math.PI / 2 })); // pintura
  shield.add(mesh(HEMI, M.metal, { z: SHIELD_Z + 0.022, rx: Math.PI / 2, sx: 0.08, sy: 0.055, sz: 0.08 })); // umbo
  shield.add(mesh(G.box(0.14, 0.03, 0.025), M.leather, { z: SHIELD_Z - 0.03 }));                          // barra de pegada
  attachShield(char, shield);

  // ---- Pose de sentinela: lança em pé, plantada à frente do ombro direito; escudo erguido diante do peito
  J.shoulderR.rotation.set(-0.35, 0, 0);
  J.elbowR.rotation.x = -0.85;
  J.shoulderL.rotation.set(-0.4, 0, -0.25);
  J.elbowL.rotation.x = -1.3;
  // As mãos ficam inclinadas; os joints da arma e do escudo compensam para a lança ficar na vertical
  // e o escudo de frente (+Z do personagem), com o topo levemente inclinado para trás.
  const q = new THREE.Quaternion();
  J.weapon.quaternion.copy(J.handR.getWorldQuaternion(q).invert());
  J.shield.quaternion.copy(J.handL.getWorldQuaternion(q).invert());
  J.shield.rotateX(-0.12);

  // altura real com o chapéu (a aba fica em 1,3·headR e a calota sobe 0,97·headR acima dela)
  char.height = dims.legLen + 0.03 * 1.7 + tH + dims.neckH + r * 2.27;
  return snapshotRest(char);
}
