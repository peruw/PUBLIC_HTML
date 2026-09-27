// Locomoção e combate dos personagens (contrato do Character em rig.js).
// Cada animação é um objeto { update(dt, speed?) -> boolean (true = terminou), duration?: s }.
// Só mexe em `rotation` dos joints, em `root.position` e em visibilidade; nunca aloca por quadro.
// (versão inicial mínima; a coreografia completa vem em battle.js final)
import * as THREE from './three.js';
import { resetPose } from './rig.js';

const _v = new THREE.Vector3();

// Ciclo de andar contínuo. speed = fator do passo (1 = normal). Chame stop() ao parar (volta ao repouso).
export function createWalk(char) {
  let t = 0;
  const J = char.joints;
  return {
    update(dt, speed = 1) {
      t += dt * 7 * speed;
      const s = Math.sin(t), c = Math.cos(t);
      if (char.mounted && J.mountLegs) {
        J.mountLegs[0].rotation.x = s * 0.6; J.mountLegs[3].rotation.x = s * 0.6;
        J.mountLegs[1].rotation.x = -s * 0.6; J.mountLegs[2].rotation.x = -s * 0.6;
        J.mountBody.position.y = J.mountBody.userData.y0 ?? (J.mountBody.userData.y0 = J.mountBody.position.y);
        J.mountBody.position.y = J.mountBody.userData.y0 + Math.abs(c) * 0.08;
      } else {
        J.hipL.rotation.x = s * 0.55; J.hipR.rotation.x = -s * 0.55;
        J.kneeL.rotation.x = Math.max(0, -c) * 0.8; J.kneeR.rotation.x = Math.max(0, c) * 0.8;
        J.shoulderL.rotation.x = -s * 0.35; J.shoulderR.rotation.x = s * 0.35;
        J.hips.position.y = (J.hips.userData.y0 ?? (J.hips.userData.y0 = J.hips.position.y)) + Math.abs(c) * 0.03;
      }
      return false;
    },
    stop() { resetPose(char); },
  };
}

export function createIdle(char) {
  let t = 0;
  const J = char.joints;
  return {
    update(dt) {
      t += dt;
      J.torso.rotation.x = Math.sin(t * 1.6) * 0.02;
      J.head.rotation.y = Math.sin(t * 0.7) * 0.15;
      return false;
    },
  };
}

// Golpe: prepara, golpeia (chama opts.onHit no impacto), recupera. Coreografia por char.weaponKind.
export function createAttack(attacker, victim, opts = {}) {
  const J = attacker.joints;
  const dur = 1.2;
  let t = 0, hit = false;
  return {
    duration: dur,
    update(dt) {
      t += dt;
      const k = Math.min(1, t / dur);
      const swing = k < 0.4 ? -k / 0.4 * 1.8 : -1.8 + Math.min(1, (k - 0.4) / 0.25) * 2.2;
      J.shoulderR.rotation.x = -1.2 + swing * 0.5;
      J.weapon.rotation.x = 1.2 + swing * 0.6;
      if (!hit && k >= 0.6) { hit = true; if (opts.onHit) opts.onHit(); }
      if (k >= 1) { resetPose(attacker); return true; }
      return false;
    },
  };
}

export function createHit(victim, dir) {
  let t = 0;
  const dur = 0.4;
  return {
    duration: dur,
    update(dt) {
      t += dt;
      const k = Math.min(1, t / dur);
      victim.joints.torso.rotation.x = -Math.sin(k * Math.PI) * 0.4;
      return k >= 1;
    },
  };
}

// Queda: tomba para trás na direção `dir` (Vector3 mundo, do atacante para a vítima).
export function createDeath(victim, dir) {
  let t = 0;
  const dur = 1.0;
  const root = victim.joints.root;
  return {
    duration: dur,
    update(dt) {
      t += dt;
      const k = Math.min(1, t / dur);
      const e = 1 - Math.pow(1 - k, 2);
      root.rotation.x = -e * Math.PI / 2 * 0.95;
      victim.joints.head.rotation.x = e * 0.6;
      return k >= 1;
    },
  };
}

export function createVictory(char) {
  let t = 0;
  const dur = 1.0;
  return {
    duration: dur,
    update(dt) {
      t += dt;
      const k = Math.min(1, t / dur);
      char.joints.shoulderR.rotation.x = -Math.PI * Math.sin(k * Math.PI / 2);
      return k >= 1;
    },
  };
}

export { resetPose };
