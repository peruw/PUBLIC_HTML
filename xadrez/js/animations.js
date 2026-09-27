// Animações dos lances: deslizar, salto do cavalo, roque, en passant, promoção,
// captura (duelo em 1ª pessoa ou versão curta de cima), rei tombando no mate e poeira.
import * as THREE from './three.js';
import { ANIM, COLORS, PIECE_HEIGHT } from './config.js';
import { squareToWorld } from './board3d.js';
import { PIECE_LETTERS, colorOf } from './rules.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

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
    this.active = 0;
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
    this.active += placed;
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

// ---------- Primitivas de animação ----------
// Cada animação: { update(dt) -> true quando terminou }

function slide(group, toSq, dur, { hop = 0 } = {}) {
  const from = group.position.clone();
  const to = squareToWorld(toSq, new THREE.Vector3());
  let t = 0;
  return {
    update(dt) {
      t = Math.min(dur, t + dt);
      const k = easeInOut(t / dur);
      group.position.lerpVectors(from, to, k);
      if (hop) group.position.y = Math.sin(k * Math.PI) * hop;
      return t >= dur;
    },
  };
}

function slideToward(group, targetSq, stopDist, dur) {
  const from = group.position.clone();
  const to = squareToWorld(targetSq, new THREE.Vector3());
  _d.subVectors(to, from);
  const len = _d.length();
  const stop = Math.max(0, len - stopDist);
  to.copy(from).addScaledVector(_d.normalize(), stop);
  let t = 0;
  return {
    update(dt) {
      t = Math.min(dur, t + dt);
      group.position.lerpVectors(from, to, easeInOut(t / dur));
      return t >= dur;
    },
  };
}

function tremble(group, dur, amp = 0.08) {
  const base = group.position.clone();
  let t = 0;
  return {
    update(dt) {
      t = Math.min(dur, t + dt);
      const k = 1 - t / dur;
      group.position.x = base.x + Math.sin(t * 60) * amp * k;
      group.position.z = base.z + Math.cos(t * 47) * amp * k;
      group.rotation.z = Math.sin(t * 55) * 0.08 * k;
      if (t >= dur) { group.position.copy(base); group.rotation.z = 0; return true; }
      return false;
    },
  };
}

function sink(group, dur, onStart) {
  const h = group.userData.height;
  const y0 = group.position.y;
  const rot0 = group.rotation.y;
  let t = 0, started = false;
  return {
    update(dt) {
      if (!started) { started = true; if (onStart) onStart(); }
      t = Math.min(dur, t + dt);
      const k = easeOut(t / dur);
      group.position.y = y0 - (h + 0.3) * k;
      group.rotation.y = rot0 + k * 1.2;
      group.scale.set(1 - 0.2 * k, h, 1 - 0.2 * k);
      return t >= dur;
    },
  };
}

function rise(group, dur) {
  const h = group.userData.height;
  let t = 0;
  group.scale.set(0.01, 0.01, 0.01);
  return {
    update(dt) {
      t = Math.min(dur, t + dt);
      const k = easeOut(t / dur);
      group.scale.set(k, h * k, k);
      return t >= dur;
    },
  };
}

function fall(group, dur, dir = 1) {
  let t = 0;
  const r0 = group.rotation.x;
  return {
    update(dt) {
      t = Math.min(dur, t + dt);
      const k = 1 - Math.pow(1 - t / dur, 2);
      group.rotation.x = r0 + dir * (Math.PI / 2) * k;
      group.position.y = 0.4 * Math.sin(k * Math.PI) * 0.3;
      return t >= dur;
    },
  };
}

function parallel(...anims) {
  return { update(dt) { let done = true; for (const a of anims) if (!a.update(dt)) done = false; return done; } };
}
function delay(dur) { let t = 0; return { update(dt) { t += dt; return t >= dur; } }; }
function call(fn) { return { update() { fn(); return true; } }; }

export class Animator {
  constructor({ scene, board, rig }) {
    this.board = board;
    this.rig = rig;
    this.dust = new Dust(scene);
    this.queue = [];   // sequência de animações
    this.current = null;
    this.resolvers = [];
    this.busy = false;
  }

  _run(seq) {
    return new Promise((resolve) => {
      this.queue.push(...seq, call(() => resolve()));
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
    const mover = board.pieceAt(move.from);
    if (!mover) { board.applyMoveInstant(move); return Promise.resolve(); }
    const capturedSq = move.flags === 'e' ? move.to - sign * 8 : (move.captured ? move.to : -1);
    const victim = capturedSq >= 0 ? board.pieceAt(capturedSq) : null;
    const isKnight = move.piece === 2 || move.piece === -2;
    const seq = [];
    const eye = board.eyeHeight(mover);

    if (victim) {
      if (firstPerson) {
        seq.push(call(() => rig.followPiece(mover, eye)));
        seq.push(slideToward(mover, capturedSq, 2.2, ANIM.approach));
        seq.push(parallel(tremble(victim, ANIM.shake), call(() => rig.shake(0.35, ANIM.shake))));
        seq.push(parallel(
          sink(victim, ANIM.sink, () => this.dust.burst(victim.position, 50, 1.2)),
          delay(ANIM.sink * 0.5),
        ));
        seq.push(parallel(slide(mover, move.to, 0.35, { hop: isKnight ? 0.8 : 0 }), call(() => rig.shake(0.2, 0.3))));
      } else {
        seq.push(parallel(
          slide(mover, move.to, ANIM.slideShort, { hop: isKnight ? 1.2 : 0 }),
          sink(victim, ANIM.slideShort + 0.2, () => this.dust.burst(victim.position, 30, 1.0)),
        ));
      }
    } else {
      if (firstPerson) seq.push(call(() => rig.followPiece(mover, eye)));
      seq.push(slide(mover, move.to, firstPerson ? ANIM.slide : ANIM.slideShort, { hop: isKnight ? 1.2 : 0 }));
    }
    if (move.flags === 'k' || move.flags === 'q') {
      const rookFrom = move.flags === 'k' ? move.to + 1 : move.to - 2;
      const rookTo = move.flags === 'k' ? move.to - 1 : move.to + 1;
      const rook = board.pieceAt(rookFrom);
      if (rook) seq.push(slide(rook, rookTo, ANIM.slideShort));
    }
    seq.push(call(() => {
      rig.follow = null;
      board.applyMoveInstant(move);
    }));
    if (move.promotion) {
      seq.push(call(() => {
        const g = board.pieceAt(move.to);
        if (g) this.queue.unshift(rise(g, ANIM.promote));
        this.dust.burst(g ? g.position : squareToWorld(move.to, _a), 30, 0.8);
      }));
    }
    return this._run(seq);
  }

  // Rei da cor derrotada tomba
  kingFall(kingGroup) {
    if (!kingGroup) return Promise.resolve();
    const dir = kingGroup.userData.color === 'w' ? 1 : 1;
    return this._run([delay(0.3), parallel(fall(kingGroup, ANIM.fall, dir), call(() => this.rig.shake(0.25, 0.6))),
      call(() => this.dust.burst(kingGroup.position, 40, 1.4))]);
  }

  clear() {
    this.queue.length = 0;
    this.current = null;
    this.busy = false;
    this.rig.follow = null;
  }
}

export { PIECE_LETTERS, colorOf, PIECE_HEIGHT };
