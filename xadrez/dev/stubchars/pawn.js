// Peão: soldado de infantaria leve com lança e escudo redondo. (versão inicial/genérica)
import * as THREE from '../../js/three.js';
import { humanoid, attachWeapon, attachShield, mesh, joint, G, snapshotRest } from '../../js/rig.js';

export function buildPawn(color) {
  const char = humanoid({ type: 'p', color, height: 1.7, build: 'light', armor: 'leather' });
  const { M, dims } = char;
  // capacete simples
  char.joints.hat.add(mesh(G.sphere(dims.headR * 1.08, 12), M.metal, { y: -dims.headR * 0.9, sy: 0.75 }));
  // lança
  const len = 2.2;
  const spear = new THREE.Group();
  spear.add(mesh(G.cyl(0.02, 0.025, len, 6), M.wood, { y: len / 2 }));
  spear.add(mesh(G.cone(0.05, 0.3, 6), M.blade, { y: len + 0.12 }));
  attachWeapon(char, spear, 'spear', len + 0.27);
  // escudo redondo
  const shield = new THREE.Group();
  shield.add(mesh(G.cyl(0.32, 0.32, 0.04, 16), M.wood, { rx: Math.PI / 2 }));
  shield.add(mesh(G.sphere(0.07, 8), M.metal, { z: 0.03 }));
  attachShield(char, shield);
  return snapshotRest(char);
}
