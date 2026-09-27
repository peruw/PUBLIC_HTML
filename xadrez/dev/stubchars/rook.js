// Torre: guardião pesado com elmo ameado, escudo-torre e martelo de guerra. (versão inicial/genérica)
import * as THREE from '../../js/three.js';
import { humanoid, attachWeapon, attachShield, mesh, G, snapshotRest } from '../../js/rig.js';

export function buildRook(color) {
  const char = humanoid({ type: 'r', color, height: 1.9, build: 'heavy', armor: 'plate' });
  const { M, dims } = char;
  const r = dims.headR;
  char.joints.hat.add(mesh(G.cyl(r * 1.15, r * 1.15, r * 1.6, 10), M.metal, { y: -r * 0.8 }));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    char.joints.hat.add(mesh(G.box(r * 0.35, r * 0.4, r * 0.35), M.metal, { x: Math.cos(a) * r * 0.95, y: r * 0.15, z: Math.sin(a) * r * 0.95, ry: -a }));
  }
  const len = 1.1;
  const hammer = new THREE.Group();
  hammer.add(mesh(G.cyl(0.03, 0.035, len, 6), M.wood, { y: len / 2 }));
  hammer.add(mesh(G.box(0.18, 0.22, 0.4), M.metal, { y: len }));
  attachWeapon(char, hammer, 'hammer', len + 0.11);
  const shield = new THREE.Group();
  shield.add(mesh(G.box(0.55, 0.9, 0.05), M.metal, { y: -0.2 }));
  attachShield(char, shield);
  return snapshotRest(char);
}
