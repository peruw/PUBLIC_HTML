// IA dos adversários: segue a linha de corrida (perseguição pura), faz drift nas
// curvas longas, desvia de perigos e de karts, usa itens com tática e aplica um
// rubber-band leve via kart.speedFactor.
import { TUNING } from './kart.js';

const TWO_PI = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
function wrapAngle(a) {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}
function wrapSigned(d, L) {
  d %= L;
  if (d > L / 2) d -= L;
  else if (d < -L / 2) d += L;
  return d;
}
const rand = (a, b) => a + Math.random() * (b - a);

// distâncias (m) à frente onde a curvatura é checada para frear
const SCAN = [5, 12, 20, 30, 42];

export class AIDriver {
  constructor(kart, track, { skill = 0.7, lane } = {}) {
    this.kart = kart;
    this.track = track;
    this.skill = clamp(+skill || 0, 0, 1);
    const sk = this.skill;
    // cada piloto tem sua própria faixa na pista (sorteada por corrida via `lane`)
    const golden = (((lane ?? kart.index) + 1) * 0.618034) % 1;
    this.baseOffset = (golden * 2 - 1) * (1.2 + (1 - sk) * 1.3);
    this._phase = Math.random() * TWO_PI;
    this._t = 0;
    this._lat = kart.lateral || 0;
    this._noise = 0;
    this._noiseTarget = 0;
    this._noiseT = 0;
    this._avoidT = 0;
    this._rampAhead = false;
    // drift
    this._driftDir = 0; // direção pretendida durante o pulo
    this._hopT = 0;
    this._driftCd = rand(0, 1);
    this._driftTarget = 2;
    this._driftT = 0;
    this._wideT = 0;
    this._trickDone = false;
    // recuperação
    this._stuckT = 0;
    this._reverseT = 0;
    // itens
    this._itemId = null;
    this._itemCnt = 0;
    this._itemT = 0;
    this._itemDelay = 0;
    this._pulse = false;
  }

  update(dt, world) {
    const k = this.kart;
    const c = k.controls;
    const track = world.track || this.track;
    this.track = track;
    const L = track.length;
    const sk = this.skill;
    this._t += dt;

    // o pulso de item dura 1 quadro (items.js normalmente já zerou)
    if (this._pulse) {
      c.useItem = false;
      this._pulse = false;
    }

    this._rubberBand(dt, world);

    if (k.frozen) {
      // largada: só ronca o motor
      c.steer = 0;
      c.brake = 0;
      c.drift = false;
      c.throttle = world.phase === 'countdown' && Math.sin(this._t * 2.7 + this._phase) > 0.55 ? 1 : 0;
      this._stuckT = 0;
      return;
    }
    if (k.stunned) {
      c.throttle = 1;
      c.brake = 0;
      c.steer = 0;
      c.drift = false;
      this._driftDir = 0;
      this._stuckT = 0;
      return;
    }

    const v = Math.max(0, k.speed);
    const hw = k.halfWidth || 9;
    const t0 = track.sample(k.s).tangent;
    const off = wrapAngle(k.heading - Math.atan2(t0.x, t0.z)); // + = apontando para a esquerda da pista

    // ---------- recuperação ----------
    if (Math.abs(k.speed) < 1 && this._reverseT <= 0) this._stuckT += dt;
    else this._stuckT = 0;
    if (this._stuckT > 1.5) {
      this._stuckT = 0;
      this._reverseT = rand(0.8, 1.2);
    }
    if (this._reverseT > 0) {
      // ré girando a frente de volta para o sentido da pista
      this._reverseT -= dt;
      c.throttle = 0;
      c.brake = 1;
      c.drift = false;
      c.steer = -clamp(off * 2, -1, 1);
      this._driftDir = 0;
      return;
    }
    if (Math.abs(off) > 1.75) {
      // contramão: vira de volta
      c.throttle = 1;
      c.brake = 0;
      c.drift = false;
      c.steer = off > 0 ? 1 : -1;
      this._driftDir = 0;
      return;
    }

    // ---------- alvo lateral ----------
    const ahead = clamp(7 + v * 0.55, 7, 26);
    const ts = k.s + ahead;
    const wander = Math.sin(this._t * 0.23 + this._phase) * (0.5 + (1 - sk) * 1.2);
    let lat = track.racingLine(ts) * (0.55 + 0.45 * sk) + this.baseOffset + wander;
    lat = this._attract(lat, k, track, L);
    lat = this._avoidKarts(lat, k, world, L);
    this._avoidT -= dt;
    lat = this._avoidHazards(lat, k, track, world, L, ahead);
    const lim = Math.max(1, hw - 1.3);
    lat = clamp(lat, -lim, lim);
    this._lat = damp(this._lat, lat, this._avoidT > 0 ? 14 : 4, dt);

    // ---------- perseguição pura ----------
    // desviando: mira mais perto para mudar de faixa mais rápido
    const avoiding = this._avoidT > 0;
    const tp = track.sample(avoiding ? k.s + ahead * 0.65 : ts);
    const tx = tp.pos.x + tp.right.x * this._lat;
    const tz = tp.pos.z + tp.right.z * this._lat;
    const dx = tx - k.position.x;
    const dz = tz - k.position.z;
    const dist = Math.max(3, Math.hypot(dx, dz));
    const alpha = wrapAngle(Math.atan2(dx, dz) - k.heading); // + = alvo à esquerda
    const vEff = Math.max(v, 4);
    const yawNeed = (-2 * vEff * Math.sin(alpha)) / dist; // rad/s, + = direita
    const rate = Math.max(0.3, k.turnRate(vEff));
    let steer = yawNeed / rate;

    // pequenos erros de pilotagem (menos habilidade = mais ruído)
    this._noiseT -= dt;
    if (this._noiseT <= 0) {
      this._noiseT = rand(0.4, 1.2);
      this._noiseTarget = (Math.random() * 2 - 1) * (1 - sk) * 0.35;
    }
    this._noise = damp(this._noise, this._noiseTarget, 3, dt);
    steer += this._noise;

    // ---------- acelerador / freio pela curvatura à frente ----------
    let maxK = 0;
    const scale = 0.6 + v / 40;
    for (let i = 0; i < SCAN.length; i++) {
      const cv = Math.abs(track.curvature(k.s + SCAN[i] * scale));
      if (cv > maxK) maxK = cv;
    }
    const allowed = (k.turnRate(v) * (k.drifting ? 1.15 : 0.95)) / Math.max(maxK, 1e-4);
    let thr = 1;
    let brk = 0;
    if (v > allowed + 1.5) thr = 0;
    if (v > allowed + 5) brk = 1;
    if (Math.abs(alpha) > 1.2 && v > 12) {
      thr = 0; // alvo muito de lado: alivia
      if (Math.abs(alpha) > 1.6) brk = 1;
    }

    // ---------- drift ----------
    const T = TUNING;
    let drift = false;
    this._driftCd -= dt;
    if (k.onGround) this._trickDone = false;
    if (k.drifting) {
      this._driftT += dt;
      const dir = k.driftDir;
      const need = yawNeed * dir;
      const base = Math.max(0.3, k.turnRate(v) * k.driftYawFactor);
      const into = (need / base - T.driftYawBase) / T.driftYawMod;
      steer = clamp(into, -1, 1) * dir;
      const minYaw = base * (T.driftYawBase - T.driftYawMod);
      // curva acabando: o drift gira mais do que o necessário
      if (need < minYaw * 0.45) this._wideT += dt;
      else this._wideT = Math.max(0, this._wideT - dt * 0.5);
      const outside = k.lateral * dir < -(hw - 1.1);
      const inside = k.lateral * dir > hw - 0.8;
      const release =
        k.driftLevel >= this._driftTarget ||
        this._wideT > 0.3 ||
        need < -0.2 ||
        (avoiding && need < minYaw) ||
        outside ||
        inside ||
        this._driftT > 5;
      drift = !release;
      if (release) this._endDriftPlan();
    } else if (this._driftDir !== 0) {
      // no pulo: segura o drift e aponta para o lado da curva
      this._hopT += dt;
      drift = true;
      // só o suficiente para o drift começar para o lado certo ao pousar
      steer = this._driftDir * Math.max(this._driftDir * clamp(steer, -1, 1), 0.4);
      if (k.onGround && this._hopT > 0.05) {
        // pousou sem começar o drift
        drift = false;
        this._endDriftPlan();
      }
    } else if (this._driftCd <= 0 && k.onGround && v > 14 && !k.offroad && !avoiding && !this._rampAhead) {
      const dir = this._curveAhead(k, track);
      if (dir !== 0) {
        if (Math.random() < 0.35 + 0.65 * sk) {
          this._driftDir = dir;
          this._hopT = 0;
          this._driftT = 0;
          this._wideT = 0;
          this._driftTarget = this._pickTarget();
          drift = true;
          steer = dir * Math.max(dir * clamp(steer, -1, 1), 0.4);
        } else {
          this._driftCd = 2; // desiste desta curva
        }
      }
    }

    // manobra na rampa
    if (!drift && !k.drifting && k.trickWindow > 0 && !this._trickDone) {
      this._trickDone = true;
      if (Math.random() < 0.3 + 0.65 * sk) drift = true;
    }

    c.throttle = thr;
    c.brake = brk;
    c.steer = clamp(steer, -1, 1);
    c.drift = drift;
    c.lookBack = false;

    this._useItems(dt, k, world, L);
  }

  _endDriftPlan() {
    this._driftDir = 0;
    this._driftT = 0;
    this._wideT = 0;
    this._driftCd = 0.3 + (1 - this.skill) * 0.6;
  }

  _pickTarget() {
    const r = Math.random();
    const sk = this.skill;
    if (sk >= 0.85) return r < 0.75 ? 3 : 2;
    if (sk >= 0.6) return r < 0.3 ? 3 : r < 0.85 ? 2 : 1;
    return r < 0.35 ? 2 : 1;
  }

  // Curva longa à frente? Devolve a direção (+1 direita, -1 esquerda) ou 0.
  _curveAhead(k, track) {
    const kMin = 1 / 75;
    let dir = 0;
    let run = 0;
    for (let d = 4; d <= 92; d += 4) {
      const cv = track.curvature(k.s + d);
      if (dir === 0) {
        if (Math.abs(cv) > kMin) {
          dir = cv > 0 ? 1 : -1;
          run = 4;
        } else if (d > 20) return 0;
      } else if (cv * dir > kMin * 0.7) run += 4;
      else break;
    }
    return run >= 40 - 12 * this.skill ? dir : 0;
  }

  // Aceleradores, rampas e caixas de item puxam a linha.
  _attract(lat, k, track, L) {
    this._rampAhead = false;
    const ramps = track.ramps;
    if (ramps) {
      for (let i = 0; i < ramps.length; i++) {
        const r = ramps[i];
        const ds = wrapSigned(r.s - k.s, L);
        if (ds < -2 || ds > 40) continue;
        this._rampAhead = true;
        const half = Math.max(0.5, r.width / 2 - 1.5);
        const rl = r.lateral || 0;
        if (Math.abs(lat - rl) < half + 4) return clamp(lat, rl - half, rl + half);
      }
    }
    if (this.skill > 0.35 && track.boostPads) {
      const pads = track.boostPads;
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        const ds = wrapSigned(p.s - k.s, L);
        // compara com a linha sem a faixa pessoal: ninguém fica sempre longe dos aceleradores
        if (ds > 3 && ds < 45 && Math.abs((p.lateral || 0) - (lat - this.baseOffset)) < 2 + 4 * this.skill) return p.lateral || 0;
      }
    }
    if (!k.item && !k.roulette && track.itemBoxSlots) {
      const boxes = track.itemBoxSlots;
      let best = lat;
      let bestD = 3.5;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        const ds = wrapSigned(b.s - k.s, L);
        if (ds < 3 || ds > 30) continue;
        const sp = track.sample(b.s);
        const bl = (b.pos.x - sp.pos.x) * sp.right.x + (b.pos.z - sp.pos.z) * sp.right.z;
        const d = Math.abs(bl - lat);
        if (d < bestD) {
          bestD = d;
          best = bl;
        }
      }
      return best;
    }
    return lat;
  }

  // Não bate na traseira de quem está à frente: passa pelo lado com mais espaço.
  _avoidKarts(lat, k, world, L) {
    const ks = world.karts;
    if (!ks) return lat;
    const lim = (k.halfWidth || 9) - 1.2;
    for (let i = 0; i < ks.length; i++) {
      const o = ks[i];
      if (o === k) continue;
      const ds = wrapSigned(o.s - k.s, L);
      if (ds < 1 || ds > 14) continue;
      if (k.speed < o.speed + 0.5) continue;
      if (Math.abs(o.lateral - lat) >= 2.5) continue;
      let side = lat >= o.lateral ? 1 : -1;
      let nl = o.lateral + side * 2.7;
      if (Math.abs(nl) > lim) {
        side = -side;
        nl = o.lateral + side * 2.7;
      }
      lat = nl;
    }
    return lat;
  }

  // Desvia de maçãs, buracos e projéteis à frente: prevê a posição lateral ao passar
  // pelo perigo e corrige o alvo para passar com folga.
  _avoidHazards(lat, k, track, world, L, ahead) {
    const hz = world.items?.hazards;
    if (!hz || !hz.length) return lat;
    const range = 22 + 18 * this.skill;
    const lim = (k.halfWidth || 9) - 1.0;
    for (let i = 0; i < hz.length; i++) {
      const h = hz[i];
      if (!h || !h.position || typeof h.s !== 'number') continue;
      const ds = wrapSigned(h.s - k.s, L);
      if (ds < 2 || ds > range) continue;
      const hs = track.sample(h.s);
      const hl = (h.position.x - hs.pos.x) * hs.right.x + (h.position.z - hs.pos.z) * hs.right.z;
      const clear = (h.radius || 1) + 1.9;
      const f = Math.max(0.3, Math.min(1, ds / ahead));
      const pred = k.lateral + (lat - k.lateral) * f; // lateral previsto ao chegar no perigo
      if (Math.abs(pred - hl) >= clear) continue;
      let side = pred >= hl ? 1 : -1;
      let want = hl + side * clear;
      if (Math.abs(want) > lim) {
        side = -side;
        want = hl + side * clear;
      }
      lat = k.lateral + (want - k.lateral) / f;
      this._avoidT = 0.35;
    }
    return lat;
  }

  // ---------- itens ----------
  _useItems(dt, k, world, L) {
    if (!k.item || k.roulette || k.stunned) {
      this._itemId = null;
      return;
    }
    if (k.item !== this._itemId || k.itemCount !== this._itemCnt) {
      this._itemId = k.item;
      this._itemCnt = k.itemCount;
      this._itemT = 0;
      this._itemDelay =
        k.item === 'maca' ? rand(4, 10)
          : k.item === 'tesla' ? rand(1, 4)
            : k.item === 'faraday' || k.item === 'buraco' ? rand(1, 3)
              : k.item === 'pilha3' ? rand(0.8, 1.2)
                : 0;
    }
    this._itemT += dt;
    const t = this._itemT;
    let use = false;
    switch (k.item) {
      case 'foguete':
        use = (t > 0.6 && (k.offroad || this._straightAhead(k))) || t > 12;
        break;
      case 'pilha3':
        use = t > this._itemDelay;
        break;
      case 'maca':
        use = (t > 0.5 && this._kartNear(k, world, L, -25, -1.5, false)) || t > this._itemDelay;
        break;
      case 'alfa':
        use = (t > 0.4 && this._kartNear(k, world, L, 2, 40, true)) || t > 8;
        break;
      case 'eletron':
        use = (t > 0.5 && this._kartNear(k, world, L, 2, 120, false)) || t > 15;
        break;
      case 'faraday':
      case 'tesla':
      case 'buraco':
        use = t > this._itemDelay;
        break;
      default:
        use = t > 5;
    }
    if (use) {
      k.controls.useItem = true;
      this._pulse = true;
      this._itemT = -0.5; // evita repetir antes do items.js consumir
    }
  }

  _straightAhead(k) {
    const tr = this.track;
    for (let d = 5; d <= 45; d += 10) if (Math.abs(tr.curvature(k.s + d)) > 1 / 110) return false;
    return true;
  }

  // Há kart entre `from` e `to` metros (negativo = atrás)? `aligned` exige mira reta.
  _kartNear(k, world, L, from, to, aligned) {
    const ks = world.karts;
    if (!ks) return false;
    for (let i = 0; i < ks.length; i++) {
      const o = ks[i];
      if (o === k || o.finished) continue;
      const ds = wrapSigned(o.s - k.s, L);
      if (ds < from || ds > to) continue;
      if (aligned) {
        if (Math.abs(o.lateral - k.lateral) > 2.5 + ds * 0.04) continue;
        const dx = o.position.x - k.position.x;
        const dz = o.position.z - k.position.z;
        if (Math.abs(wrapAngle(Math.atan2(dx, dz) - k.heading)) > 0.3) continue;
      }
      return true;
    }
    return false;
  }

  // ---------- rubber-band ----------
  _rubberBand(dt, world) {
    const k = this.kart;
    const p = world.player;
    let target = 1;
    if (p && p !== k) {
      const sk = this.skill;
      const pd = typeof p.distance === 'number' ? p.distance : p.progress;
      const kd = typeof k.distance === 'number' ? k.distance : k.progress;
      const gap = pd - kd; // + = jogador à frente
      const cc = world.cc || {};
      // ritmo base da classe (aiSpeed) × variação por habilidade
      target = (cc.aiSpeed ?? 1) * (0.93 + 0.07 * sk);
      if (!p.finished) {
        if (gap > 0) target *= 1 + (cc.aiCatchUp ?? 0.1) * clamp((gap - 15) / 120, 0, 1) * (0.5 + 0.5 * sk);
        else target *= 1 - 0.07 * clamp((-gap - 25) / 150, 0, 1) * (1.25 - 0.5 * sk);
      }
    }
    k.speedFactor = damp(k.speedFactor, target, 0.6, dt);
  }
}
