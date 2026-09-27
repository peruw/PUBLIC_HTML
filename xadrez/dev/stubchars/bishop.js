// Bispo: figura de túnica com mitra e báculo. (versão inicial/genérica)
import * as THREE from '../../js/three.js';
import { humanoid, attachWeapon, mesh, G, snapshotRest } from '../../js/rig.js';

export function buildBishop(color) {
  const char = humanoid({ type: 'b', color, height: 1.85, build: 'medium', armor: 'cloth' });
  const { M, dims } = char;
  const r = dims.headR;
  // mitra
  char.joints.hat.add(mesh(G.cone(r * 0.9, r * 2.2, 4), M.accent, { y: r * 0.6, ry: Math.PI / 4, sz: 0.5 }));
  // túnica longa (saia) cobrindo as pernas
  char.joints.hips.add(mesh(G.cyl(dims.torsoR * 1.1, dims.torsoR * 1.7, dims.legLen * 0.95, 12), M.cloth, { y: -dims.legLen * 0.48 }));
  const len = 2.0;
  const staff = new THREE.Group();
  staff.add(mesh(G.cyl(0.025, 0.03, len, 6), M.wood, { y: len / 2 }));
  staff.add(mesh(G.torus(0.12, 0.03, 6, 12), M.trim, { y: len + 0.1 }));
  attachWeapon(char, staff, 'staff', len + 0.22);
  return snapshotRest(char);
}
