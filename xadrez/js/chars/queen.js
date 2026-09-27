// Dama: rainha guerreira com coroa, vestido e espada. (versão inicial/genérica)
import * as THREE from '../three.js';
import { humanoid, attachWeapon, mesh, G, snapshotRest } from '../rig.js';

export function buildQueen(color) {
  const char = humanoid({ type: 'q', color, height: 1.95, build: 'light', armor: 'cloth' });
  const { M, dims } = char;
  const r = dims.headR;
  char.joints.hat.add(mesh(G.cyl(r * 0.9, r * 0.8, r * 0.5, 8), M.trim, { y: -r * 0.2 }));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    char.joints.hat.add(mesh(G.cone(r * 0.12, r * 0.5, 4), M.trim, { x: Math.cos(a) * r * 0.85, y: r * 0.25, z: Math.sin(a) * r * 0.85 }));
  }
  // vestido
  char.joints.hips.add(mesh(G.cyl(dims.torsoR * 1.0, dims.torsoR * 2.0, dims.legLen * 0.95, 14), M.accent, { y: -dims.legLen * 0.48 }));
  const len = 1.1;
  const sword = new THREE.Group();
  sword.add(mesh(G.box(0.05, len, 0.012), M.blade, { y: len / 2 + 0.12 }));
  sword.add(mesh(G.box(0.22, 0.03, 0.04), M.trim, { y: 0.12 }));
  sword.add(mesh(G.cyl(0.02, 0.02, 0.14, 6), M.leather, { y: 0.05 }));
  attachWeapon(char, sword, 'sword', len + 0.12);
  return snapshotRest(char);
}
