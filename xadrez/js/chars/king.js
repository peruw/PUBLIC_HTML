// Rei: coroa grande, capa e espada larga. (versão inicial/genérica)
import * as THREE from '../three.js';
import { humanoid, attachWeapon, mesh, G, snapshotRest } from '../rig.js';

export function buildKing(color) {
  const char = humanoid({ type: 'k', color, height: 2.05, build: 'medium', armor: 'plate' });
  const { M, dims } = char;
  const r = dims.headR;
  char.joints.hat.add(mesh(G.cyl(r * 1.0, r * 0.9, r * 0.6, 8), M.trim, { y: -r * 0.2 }));
  char.joints.hat.add(mesh(G.box(r * 0.2, r * 0.9, r * 0.2), M.trim, { y: r * 0.5 }));
  char.joints.hat.add(mesh(G.box(r * 0.6, r * 0.2, r * 0.2), M.trim, { y: r * 0.6 }));
  // capa
  char.joints.torso.add(mesh(G.box(dims.shoulderW * 1.1, dims.torsoH + dims.legLen * 0.7, 0.03), M.accent, { y: dims.torsoH * 0.9 - (dims.torsoH + dims.legLen * 0.7) / 2, z: -dims.torsoR * 0.95 }));
  const len = 1.25;
  const sword = new THREE.Group();
  sword.add(mesh(G.box(0.08, len, 0.015), M.blade, { y: len / 2 + 0.15 }));
  sword.add(mesh(G.box(0.3, 0.04, 0.05), M.trim, { y: 0.15 }));
  sword.add(mesh(G.cyl(0.025, 0.025, 0.2, 6), M.leather, { y: 0.06 }));
  attachWeapon(char, sword, 'sword', len + 0.15);
  return snapshotRest(char);
}
