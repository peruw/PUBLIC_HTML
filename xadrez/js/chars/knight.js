// Cavalo: cavaleiro montado com lança de justa. (versão inicial/genérica)
// Contrato extra do cavaleiro: joints.mount (raiz do cavalo), mountBody, mountNeck, mountHead, mountLegs [FL, FR, BL, BR], mountTail.
import * as THREE from '../three.js';
import { humanoid, horse, attachWeapon, attachShield, mesh, G, snapshotRest } from '../rig.js';

export function buildKnight(color) {
  const rider = humanoid({ type: 'n', color, height: 1.55, build: 'medium', armor: 'plate' });
  const { M, dims } = rider;
  const h = horse({ color, height: 1.35 });
  // O cavalo é a raiz visual; o cavaleiro senta na sela.
  const root = rider.group;              // raiz nos pés do cavalo
  root.add(h.group);
  // move o corpo do cavaleiro (hips) para a sela, no espaço do corpo do cavalo
  const hips = rider.joints.hips;
  root.remove(hips);
  h.joints.body.add(hips);
  hips.position.copy(h.seat);
  hips.position.y += dims.legLen * 0.15;
  // pernas abertas sobre a sela
  rider.joints.hipL.rotation.set(-1.2, 0, -0.5);
  rider.joints.hipR.rotation.set(-1.2, 0, 0.5);
  rider.joints.kneeL.rotation.x = 1.6;
  rider.joints.kneeR.rotation.x = 1.6;
  // elmo
  rider.joints.hat.add(mesh(G.sphere(dims.headR * 1.1, 12), M.metal, { y: -dims.headR * 0.9 }));
  rider.joints.hat.add(mesh(G.cone(dims.headR * 0.25, dims.headR * 1.2, 6), M.accent, { y: dims.headR * 0.4 }));
  // lança
  const len = 2.8;
  const lance = new THREE.Group();
  lance.add(mesh(G.cyl(0.02, 0.045, len, 8), M.wood, { y: len / 2 }));
  lance.add(mesh(G.cone(0.05, 0.25, 6), M.blade, { y: len + 0.1 }));
  lance.add(mesh(G.cone(0.12, 0.25, 10), M.metal, { y: 0.3, rx: Math.PI }));
  attachWeapon(rider, lance, 'lance', len + 0.22);
  const shield = new THREE.Group();
  shield.add(mesh(G.box(0.45, 0.6, 0.05), M.accent, { y: -0.1 }));
  attachShield(rider, shield);

  rider.mounted = true;
  rider.joints.mount = h.group;
  rider.joints.mountBody = h.joints.body;
  rider.joints.mountNeck = h.joints.neck;
  rider.joints.mountHead = h.joints.head;
  rider.joints.mountLegs = [h.joints.legFL, h.joints.legFR, h.joints.legBL, h.joints.legBR];
  rider.joints.mountTail = h.joints.tail;
  rider.height = h.bodyY + 0.3 + dims.torsoH + dims.neckH + dims.headR * 2.2;
  rider.eyeHeight = h.bodyY + dims.legLen * 0.15 + 0.03 * 1.55 + dims.torsoH + dims.neckH + dims.headR;
  return snapshotRest(rider);
}
