// Coreografia dos lances com os personagens: andar até a casa, roque, en passant, promoção,
// captura = batalha (aproximação, golpe, queda da vítima, gesto de vitória), rei caindo no mate e poeira.
// A câmera em 1ª pessoa segue o atacante; na vista de cima a captura ganha um plano cinematográfico.
import * as THREE from './three.js';
import { ANIM, COLORS } from './config.js';
import { squareToWorld } from './board3d.js';
import { createWalk, createAttack, createDeath, createVictory, resetPose } from './battle.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const TAU = Math.PI * 2;

// Alcance do golpe por tipo de arma (distância do atacante à vítima no impacto, m)
const REACH = { spear: 1.7, lance: 2.4, sword: 1.3, hammer: 1.35, staff: 1.55, mace: 1.3, none: 1.2 };
const WALK_SPEED = 3.0;   // m/s
const HORSE_SPEED = 4.2;

// Rumo "de sentinela" de cada cor (personagens são construídos olhando +Z; brancas olham -Z no mundo)
export const faceYaw = (color) => (color === 'w' ? Math.PI : 0);
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }

// ---------- Poeira ----------
let _dustTex = null;
function dustTexture() {
  if (_dustTex) return _dustTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  _dustTex = new THREE.CanvasTexture(c);
  return _dustTex;
}

class Dust {
  constructor(scene) {
    this.n = 96;
    this.pos = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.life = new Float32Array(this.n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({ color: COLORS.dust, size: 0.16, map: dustTexture(), transparent: true, opacity: 0.8, depthWrite: false, alphaTest: 0.05 });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    for (let i = 0; i < this.n; i++) this.pos[i * 3 + 1] = -50;
    scene.add(this.points);
  }
  burst(center, count = 40, spread = 1.0) {
    let placed = 0;
    for (let i = 0; i < this.n && placed < count; i++) {
      if (this.life[i] > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.pos[i * 3] = center.x + Math.cos(a) * r * 0.3;
      this.pos[i * 3 + 1] = center.y + 0.1;
      this.pos[i * 3 + 2] = center.z + Math.sin(a) * r * 0.3;
      this.vel[i * 3] = Math.cos(a) * (1 + Math.random() * 2);
      this.vel[i * 3 + 1] = 1.5 + Math.random() * 2;
      this.vel[i * 3 + 2] = Math.sin(a) * (1 + Math.random() * 2);
      this.life[i] = 0.8 + Math.random() * 0.6;
      placed++;
    }
    this.points.visible = true;
  }
  update(dt) {
    if (!this.points.visible) return false;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -50; continue; }
      alive++;
      this.vel[i * 3 + 1] -= 6 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05) { this.pos[i * 3 + 1] = 0.05; this.vel[i * 3 + 1] = 0; this.vel[i * 3] *= 0.9; this.vel[i * 3 + 2] *= 0.9; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    if (!alive) this.points.visible = false;
    return true;
  }
}

// ---------- Primitivas de animação: { update(dt) -> true quando termina } ----------

function delay(dur) { let t = 0; return { update(dt) { t += dt; return t >= dur; } }; }
function call(fn) { return { update() { fn(); return true; } }; }
function parallel(...anims) {
  const pending = anims.slice();
  return { update(dt) { for (let i = pending.length - 1; i >= 0; i--) if (pending[i].update(dt)) pending.splice(i, 1); return pending.length === 0; } };
}
function seq(...anims) {
  let i = 0;
  return { update(dt) { while (i < anims.length) { if (!anims[i].update(dt)) return false; i++; } return true; } };
}
// Espera uma promessa (ex.: tween de câmera)
function waitFor(promiseFactory) {
  let started = false, done = false;
  return { update() { if (!started) { started = true; Promise.resolve(promiseFactory()).then(() => { done = true; }); } return done; } };
}
// Adapta uma Anim de battle.js (update(dt) -> done)
function battleAnim(anim) { return anim && anim.update ? anim : call(() => {}); }

// Gira o grupo para o rumo alvo (menor caminho)
function turnTo(group, yaw, dur) {
  let t = 0, y0 = 0, delta = 0, started = false;
  return {
    update(dt) {
      if (!started) { started = true; y0 = group.rotation.y; delta = angDiff(y0, yaw); if (Math.abs(delta) < 0.02) { group.rotation.y = yaw; return true; } }
      t = Math.min(dur, t + dt);
      group.rotation.y = y0 + delta * easeInOut(t / dur);
      return t >= dur;
    },
  };
}

// Anda até `target` (Vector3 mundo, y ignorado) com ciclo de andar; vira-se para a direção do movimento.
// hop: altura do salto (cavalo pula por cima das peças)
function walkTo(char, target, { hop = 0 } = {}) {
  const group = char.group;
  const from = new THREE.Vector3();
  const to = new THREE.Vector3(target.x, 0, target.z);
  let walk = null, t = 0, dur = 1, started = false, yaw0 = 0, yawTo = 0;
  return {
    update(dt) {
      if (!started) {
        started = true;
        from.copy(group.position); from.y = 0;
        const dist = from.distanceTo(to);
        const speed = char.mounted ? HORSE_SPEED : WALK_SPEED;
        dur = Math.max(0.35, Math.min(1.8, dist / speed));
        yaw0 = group.rotation.y;
        yawTo = dist > 0.01 ? Math.atan2(to.x - from.x, to.z - from.z) : yaw0; // olhando +Z local
        walk = createWalk(char);
      }
      t = Math.min(dur, t + dt);
      const k = t / dur;
      // vira nos primeiros 25% do trajeto
      const kt = Math.min(1, k / 0.25);
      group.rotation.y = yaw0 + angDiff(yaw0, yawTo) * easeInOut(kt);
      group.position.lerpVectors(from, to, easeInOut(k));
      group.position.y = hop ? Math.sin(k * Math.PI) * hop : 0;
      walk.update(dt, char.mounted ? 1.1 : 1);
      if (t >= dur) { walk.stop(); group.position.y = 0; return true; }
      return false;
    },
  };
}

// Combate: golpe do atacante + (a partir do impacto) queda da vítima; termina quando os dois acabam.
function combat(attacker, victim, onHit) {
  let attack = null, death = null, started = false, attackDone = false, deathDone = false;
  const dir = new THREE.Vector3();
  return {
    update(dt) {
      if (!started) {
        started = true;
        dir.subVectors(victim.group.position, attacker.group.position).setY(0).normalize();
        attack = battleAnim(createAttack(attacker, victim, {
          onHit: () => { onHit(); death = battleAnim(createDeath(victim, dir)); },
        }));
      }
      if (!attackDone && attack.update(dt)) attackDone = true;
      if (death && !deathDone && death.update(dt)) deathDone = true;
      if (attackDone && !death) { death = battleAnim(createDeath(victim, dir)); } // garantia: onHit não veio
      return attackDone && deathDone;
    },
  };
}

function sink(group, dur, onStart) {
  const h = group.userData.height || 1.8;
  let t = 0, started = false;
  return {
    update(dt) {
      if (!started) { started = true; if (onStart) onStart(); }
      t = Math.min(dur, t + dt);
      const k = easeOut(t / dur);
      group.position.y = -(h + 0.3) * k;
      return t >= dur;
    },
  };
}
function rise(group, dur) {
  let t = 0;
  group.scale.setScalar(0.01);
  return {
    update(dt) {
      t = Math.min(dur, t + dt);
      const k = easeOut(t / dur);
      group.scale.setScalar(Math.max(0.01, k));
      return t >= dur;
    },
  };
}

export class Animator {
  constructor({ scene, board, rig }) {
    this.board = board;
    this.rig = rig;
    this.dust = new Dust(scene);
    this.queue = [];
    this.current = null;
    this.busy = false;
    this.active = new Set();   // personagens sendo animados (o idle não mexe neles)
  }

  _run(seqList) {
    return new Promise((resolve) => {
      this.queue.push(...seqList, call(() => resolve()));
      this.busy = true;
    });
  }

  update(dt) {
    let changed = this.dust.update(dt);
    while (dt > 0 && (this.current || this.queue.length)) {
      if (!this.current) this.current = this.queue.shift();
      const done = this.current.update(dt);
      changed = true;
      if (done) { this.current = null; } else break;
    }
    this.busy = !!(this.current || this.queue.length);
    return changed || this.busy;
  }

  // Anima um lance já validado. O tabuleiro visual é sincronizado ao final (applyMoveInstant).
  playMove(move, { firstPerson = false } = {}) {
    const board = this.board, rig = this.rig;
    const sign = move.piece > 0 ? 1 : -1;
    const moverGroup = board.pieceAt(move.from);
    if (!moverGroup || !moverGroup.userData.char) { board.applyMoveInstant(move); return Promise.resolve(); }
    const mover = moverGroup.userData.char;
    const capturedSq = move.flags === 'e' ? move.to - sign * 8 : (move.captured ? move.to : -1);
    const victimGroup = capturedSq >= 0 ? board.pieceAt(capturedSq) : null;
    const victim = victimGroup && victimGroup.userData.char ? victimGroup.userData.char : null;
    const dest = squareToWorld(move.to, new THREE.Vector3());
    const hop = mover.mounted ? 0.9 : 0;
    const s = [];
    const active = [mover];
    if (victim) active.push(victim);

    if (firstPerson) s.push(call(() => rig.followChar(mover)));

    if (victim) {
      const vpos = victimGroup.position.clone();
      const reach = REACH[mover.weaponKind] || REACH.none;
      // ponto de parada: a `reach` metros da vítima, vindo da casa de origem
      _d.subVectors(vpos, moverGroup.position).setY(0);
      const dist = _d.length();
      const stop = vpos.clone().addScaledVector(_d.normalize(), -Math.min(reach, dist * 0.9));
      const yawToVictim = Math.atan2(vpos.x - stop.x, vpos.z - stop.z);
      const yawToAttacker = yawToVictim + Math.PI;
      // câmera cinematográfica na vista de cima
      if (!firstPerson && rig.mode !== 'overhead') s.push(waitFor(() => rig.cinematic(stop, vpos)));
      s.push(parallel(
        walkTo(mover, stop, { hop }),
        seq(delay(0.15), turnTo(victimGroup, yawToAttacker, 0.35)),
      ));
      s.push(turnTo(moverGroup, yawToVictim, 0.15));
      s.push(combat(mover, victim, () => {
        this.dust.burst(vpos, 45, 1.2);
        rig.shake(firstPerson ? 0.35 : 0.2, 0.45);
      }));
      s.push(parallel(battleAnim(createVictory(mover)), delay(0.4)));
      s.push(call(() => { board.removePiece(capturedSq); }));
      // segue até a casa final (curto) e volta a olhar o inimigo
      s.push(walkTo(mover, dest, { hop: 0 }));
    } else {
      // sem captura: na vista cinematográfica a câmera fica ao lado do trajeto
      if (!firstPerson && rig.mode !== 'overhead') s.push(waitFor(() => rig.cinematic(moverGroup.position, dest)));
      s.push(walkTo(mover, dest, { hop }));
    }
    s.push(turnTo(moverGroup, faceYaw(mover.color), 0.3));

    if (move.flags === 'k' || move.flags === 'q') {
      const rookFrom = move.flags === 'k' ? move.to + 1 : move.to - 2;
      const rookTo = move.flags === 'k' ? move.to - 1 : move.to + 1;
      const rookGroup = board.pieceAt(rookFrom);
      if (rookGroup && rookGroup.userData.char) {
        active.push(rookGroup.userData.char);
        const rdest = squareToWorld(rookTo, new THREE.Vector3());
        // a torre anda junto com o rei: substitui o último passo por um paralelo
        const kingWalk = s.pop(); // turnTo do rei
        const kingMove = s.pop(); // walkTo do rei
        s.push(parallel(seq(kingMove, kingWalk), seq(walkTo(rookGroup.userData.char, rdest), turnTo(rookGroup, faceYaw(mover.color), 0.3))));
      }
    }

    s.push(call(() => {
      board.applyMoveInstant(move);
      for (const c of active) this.active.delete(c);
    }));
    if (move.promotion) {
      s.push(call(() => {
        const g = board.pieceAt(move.to);
        if (g) this.queue.unshift(rise(g, ANIM.promote));
        this.dust.burst(g ? g.position : squareToWorld(move.to, _a), 30, 0.8);
      }));
    }
    for (const c of active) this.active.add(c);
    return this._run(s);
  }

  // Rei da cor derrotada tomba
  kingFall(kingGroup) {
    if (!kingGroup || !kingGroup.userData.char) return Promise.resolve();
    const char = kingGroup.userData.char;
    this.active.add(char);
    const dir = new THREE.Vector3(0, 0, char.color === 'w' ? 1 : -1);
    return this._run([
      delay(0.3),
      parallel(battleAnim(createDeath(char, dir)), seq(delay(0.5), call(() => { this.rig.shake(0.25, 0.6); this.dust.burst(kingGroup.position, 40, 1.4); }))),
    ]);
  }

  clear() {
    this.queue.length = 0;
    this.current = null;
    this.busy = false;
    this.active.clear();
  }
}

export { resetPose };
