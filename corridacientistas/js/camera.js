// Câmera do jogo: perseguição (chase), órbita, pódio e sobrevoo (demo da tela inicial).
// Suavização por molas criticamente amortecidas; nada é alocado por quadro.
import * as THREE from './three.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();

// Diferença angular em (-PI, PI]
function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Mola criticamente amortecida (estilo SmoothDamp). Estado: { v }.
function damp1(cur, target, st, key, smooth, dt) {
  const omega = 2 / Math.max(1e-4, smooth);
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (st[key] + omega * change) * dt;
  st[key] = (st[key] - omega * temp) * e;
  return target + (change + temp) * e;
}
function dampV(cur, target, vel, smooth, dt) {
  const omega = 2 / Math.max(1e-4, smooth);
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let c = cur.x - target.x, t = (vel.x + omega * c) * dt;
  vel.x = (vel.x - omega * t) * e;
  cur.x = target.x + (c + t) * e;
  c = cur.y - target.y; t = (vel.y + omega * c) * dt;
  vel.y = (vel.y - omega * t) * e;
  cur.y = target.y + (c + t) * e;
  c = cur.z - target.z; t = (vel.z + omega * c) * dt;
  vel.z = (vel.z - omega * t) * e;
  cur.z = target.z + (c + t) * e;
}
// Ruído suave barato (soma de senos) para o tremor
const wob = (t, a, b, c) => Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 2.1) * 0.2;

const SHOTS = ['chase', 'front', 'side', 'crane', 'trackside'];

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.opts = {};
    this.target = null;
    // ajustes do modo chase
    this.distance = 5.4;
    this.height = 2.3;
    this.lookAhead = 4;
    this.baseFov = 64;
    // estado suavizado
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.lookVel = new THREE.Vector3();
    this.st = { yaw: 0, y: 0, ly: 0, fov: 0, punch: 0, dist: 0, roll: 0 };
    this.yaw = 0;
    this.camY = 0;
    this.lookY = 0;
    this.fov = camera.fov || this.baseFov;
    this.punch = 0;
    this.extraDist = 0;
    this.topRef = 0; // velocidade máxima de referência (sem turbo)
    this.roll = 0;
    this._snap = true;
    this._lookBack = false;
    // tremor
    this.shakeT = 0;
    this.shakeDur = 0;
    this.shakeI = 0;
    this.time = 0;
    // órbita / pódio / sobrevoo
    this.orbitAngle = 0;
    this.shotIndex = -1;
    this.shotTime = 0;
    this.shotKart = null;
    this.shotType = 'chase';
    this.fixed = new THREE.Vector3();
    this.shotSide = 1;
    this.shotCount = 0;
  }

  follow(kart) {
    if (kart !== this.target) this._snap = true;
    this.target = kart;
  }

  setMode(mode, opts = {}) {
    this.mode = mode;
    this.opts = opts || {};
    this._snap = true;
    if (mode === 'orbit') this.orbitAngle = this.opts.angle ?? this.orbitAngle;
    if (mode === 'flyover') {
      this.shotIndex = -1;
      this.shotTime = 0;
      this.shotCount = 0;
    }
  }

  snap() {
    this._snap = true;
  }

  shake(intensity = 0.3, duration = 0.4) {
    const left = this.shakeDur > 0 ? this.shakeI * (this.shakeT / this.shakeDur) : 0;
    if (intensity >= left) {
      this.shakeI = intensity;
      this.shakeT = this.shakeDur = Math.max(0.05, duration);
    }
  }

  update(dt, world, input = {}) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    this.time += dt;
    const lookBack = !!(input && input.lookBack);
    if (lookBack !== this._lookBack) {
      this._lookBack = lookBack;
      this._snap = true;
    }
    let fovT = this.baseFov;
    switch (this.mode) {
      case 'orbit': fovT = this._orbit(dt); break;
      case 'podium': fovT = this._podium(dt); break;
      case 'flyover': fovT = this._flyover(dt, world); break;
      default:
        if (!this.target) return;
        fovT = this._chase(dt, world, this.target, lookBack);
    }
    this._apply(dt, fovT);
    this._snap = false;
  }

  // ---- perseguição ----
  _chase(dt, world, kart, lookBack, opts = null) {
    const snap = this._snap;
    const pos = kart.position;
    // rumo alvo: mistura o rumo do kart com a direção do movimento (no drift, o kart aparece de lado)
    let yawT = kart.heading || 0;
    const vx = kart.velocity ? kart.velocity.x : 0, vz = kart.velocity ? kart.velocity.z : 0;
    if (vx * vx + vz * vz > 9 && (kart.speed ?? 1) > 0) {
      const vh = Math.atan2(vx, vz);
      yawT += angDiff(yawT, vh) * (kart.drifting ? 0.7 : 0.35);
    }
    if (snap) {
      this.yaw = yawT;
      this.st.yaw = 0;
    } else {
      const target = this.yaw + angDiff(this.yaw, yawT);
      this.yaw = damp1(this.yaw, target, this.st, 'yaw', kart.stunned ? 0.45 : 0.2, dt);
    }
    _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _r.set(-_f.z, 0, _f.x);
    // velocidade relativa (abre o FOV e afasta um pouco)
    const boosting = (kart.boostTime || 0) > 0 || (kart.starTime || 0) > 0;
    const ms = kart.maxSpeed || 25;
    if (!boosting || this.topRef <= 0 || snap) this.topRef = Math.max(8, ms);
    const ratio = Math.min(1.3, Math.abs(kart.speed || 0) / this.topRef);
    const aspect = this.camera.aspect || 16 / 9;
    // tela em pé: câmera um pouco mais perto, mais alta e olhando mais para baixo
    const tall = aspect < 1 ? 1 - aspect : 0;
    const distT = (opts?.distance ?? this.distance) * (1 - tall * 0.15) + Math.min(1, ratio) * 0.35;
    this.extraDist = snap ? distT : damp1(this.extraDist, distT, this.st, 'dist', 0.35, dt);
    const h = (opts?.height ?? this.height) + tall * 1.4;
    const air = kart.onGround === false;

    if (lookBack) {
      // olhar para trás: câmera na frente do kart, instantânea
      _desired.copy(pos).addScaledVector(_f, this.distance * 0.9);
      _desired.y = pos.y + h * 0.85;
      _look.copy(pos).addScaledVector(_f, -4);
      _look.y = pos.y + 1;
      this.pos.copy(_desired);
      this.look.copy(_look);
      this.camY = _desired.y;
      this.lookY = _look.y;
    } else {
      _desired.copy(pos).addScaledVector(_f, -this.extraDist);
      const yT = pos.y + h;
      this.camY = snap ? yT : damp1(this.camY, yT, this.st, 'y', air ? 0.32 : 0.12, dt);
      _desired.y = this.camY;
      _look.copy(pos).addScaledVector(_f, this.lookAhead);
      const lyT = pos.y + 1 - tall * 1.1;
      this.lookY = snap ? lyT : damp1(this.lookY, lyT, this.st, 'ly', air ? 0.25 : 0.08, dt);
      _look.y = this.lookY;
      this.pos.copy(_desired);
      this.look.copy(_look);
    }
    this._keepInside(world, kart.s);
    // leve inclinação lateral nas curvas
    const steer = kart.controls ? kart.controls.steer || 0 : 0;
    const rollT = lookBack ? 0 : -steer * 0.025 - (kart.drifting ? (kart.driftDir || 0) * 0.02 : 0);
    this.roll = snap ? rollT : damp1(this.roll, rollT, this.st, 'roll', 0.3, dt);
    // FOV: 68 → ~80 com a velocidade, com um "soco" extra no turbo
    this.punch = damp1(this.punch, boosting ? 6 : 0, this.st, 'punch', boosting ? 0.12 : 0.5, dt);
    return (opts?.fov ?? this.baseFov) + 10 * Math.min(1, ratio) * Math.min(1, ratio) + this.punch;
  }

  // Mantém a câmera acima do chão e dentro do corredor da pista (sem atravessar muros)
  _keepInside(world, hintS) {
    const track = world && world.track;
    if (!track) return;
    const p = track.project(this.pos, hintS);
    const minY = p.groundY + 0.8;
    const lateral = p.lateral, wall = p.wallDist, s = p.s;
    if (this.pos.y < minY) this.pos.y = minY;
    const lim = wall - 0.7;
    if (lim > 0 && Math.abs(lateral) > lim) {
      const smp = track.sample(s);
      this.pos.addScaledVector(smp.right, Math.sign(lateral) * lim - lateral);
    }
  }

  // ---- órbita ----
  _orbit(dt) {
    const o = this.opts;
    const tgt = o.target;
    const tp = tgt ? (tgt.isVector3 ? tgt : tgt.position || (tgt.object3d && tgt.object3d.position)) : null;
    const cx = tp ? tp.x : 0, cy = tp ? tp.y : 0, cz = tp ? tp.z : 0;
    this.orbitAngle += (o.speed ?? 0.35) * dt;
    const r = o.radius ?? 5, h = o.height ?? 2;
    _desired.set(cx + Math.sin(this.orbitAngle) * r, cy + h, cz + Math.cos(this.orbitAngle) * r);
    _look.set(cx, cy + (o.lookHeight ?? 0.9), cz);
    // acompanha o alvo rigidamente (só o ângulo anda); suavização opcional
    if (o.smooth) this._moveTo(_desired, _look, o.smooth, dt);
    else { this.pos.copy(_desired); this.look.copy(_look); }
    this.roll = 0;
    return o.fov ?? 50;
  }

  // ---- pódio ----
  _podium(dt) {
    const o = this.opts;
    const p = o.position || _t.set(0, 3, 8);
    const l = o.lookAt || _v.set(0, 1, 0);
    const t = this.time;
    _desired.set(p.x + Math.sin(t * 0.45) * 0.25, p.y + Math.sin(t * 0.7) * 0.08, p.z + Math.cos(t * 0.45) * 0.12);
    _look.copy(l);
    this._moveTo(_desired, _look, o.smooth ?? 0.8, dt);
    this.roll = 0;
    return o.fov ?? 45;
  }

  _moveTo(p, l, smooth, dt) {
    if (this._snap) {
      this.pos.copy(p);
      this.look.copy(l);
      this.vel.set(0, 0, 0);
      this.lookVel.set(0, 0, 0);
    } else {
      dampV(this.pos, p, this.vel, smooth, dt);
      dampV(this.look, l, this.lookVel, smooth * 0.6, dt);
    }
  }

  // ---- sobrevoo (tela inicial): alterna planos a cada ~6 s ----
  _flyover(dt, world) {
    const karts = (world && world.karts) || [];
    const track = world && world.track;
    if (!karts.length || !track) return this._orbit(dt);
    const dur = this.opts.shotTime ?? 6;
    this.shotTime += dt;
    let kart = this.shotKart;
    const tooFar = this.shotType === 'trackside' && kart && this.pos.distanceToSquared(kart.position) > 45 * 45;
    if (this.shotIndex < 0 || this.shotTime >= dur || !kart || tooFar) {
      this.shotIndex = (this.shotIndex + 1) % SHOTS.length;
      this.shotType = SHOTS[this.shotIndex];
      this.shotCount++;
      kart = this.shotKart = karts[(this.shotCount * 3 + 1) % karts.length];
      this.shotTime = 0;
      this.shotSide = this.shotCount % 2 ? 1 : -1;
      this._snap = true;
      this.yaw = kart.heading || 0;
      // pontos fixos (grua e beira da pista) calculados no início do plano
      if (this.shotType === 'crane' || this.shotType === 'trackside') {
        const ahead = this.shotType === 'crane' ? 22 : 40;
        const smp = track.sample((kart.s || 0) + ahead);
        const side = this.shotType === 'crane' ? smp.halfWidth + 4 : Math.max(2, smp.wallDist - 1.2);
        this.fixed.copy(smp.pos).addScaledVector(smp.right, side * this.shotSide);
        this.fixed.y += this.shotType === 'crane' ? 12 : 1.3;
      }
    }
    if (this.shotType === 'chase') return this._chase(dt, world, kart, false, { distance: 6.5, height: 2.3, fov: 62 });
    const pos = kart.position;
    const yawT = kart.heading || 0;
    this.yaw = this._snap ? yawT : damp1(this.yaw, this.yaw + angDiff(this.yaw, yawT), this.st, 'yaw', 0.35, dt);
    _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _r.set(-_f.z, 0, _f.x);
    let fov = 55;
    switch (this.shotType) {
      case 'front':
        // plano de frente mostrando o rosto do piloto
        _desired.copy(pos).addScaledVector(_f, 4.6).addScaledVector(_r, 1.1 * this.shotSide);
        _desired.y = pos.y + 1.45;
        _look.copy(pos).addScaledVector(_f, 0.3);
        _look.y = pos.y + 1.0;
        this.pos.copy(_desired);
        this.look.copy(_look);
        fov = 42;
        break;
      case 'side':
        // travelling lateral baixo
        _desired.copy(pos).addScaledVector(_r, 3.6 * this.shotSide).addScaledVector(_f, 0.6 + this.shotTime * 0.15);
        _desired.y = pos.y + 0.65;
        _look.copy(pos).addScaledVector(_f, 0.6);
        _look.y = pos.y + 0.8;
        this.pos.copy(_desired);
        this.look.copy(_look);
        fov = 48;
        break;
      case 'crane':
        // grua alta subindo devagar
        _desired.copy(this.fixed);
        _desired.y += this.shotTime * 0.9;
        _look.copy(pos);
        _look.y += 0.8;
        this._moveTo(_desired, _look, 0.35, dt);
        fov = 50;
        break;
      default:
        // câmera fixa na beira da pista, girando para acompanhar
        _look.copy(pos);
        _look.y += 0.9;
        this._moveTo(this.fixed, _look, 0.25, dt);
        fov = 38;
    }
    this._keepInside(world, kart.s);
    this.roll = 0;
    return fov;
  }

  // ---- aplica posição, olhar, FOV (com correção de tela estreita) e tremor ----
  _apply(dt, fovT) {
    const cam = this.camera;
    const aspect = cam.aspect || 16 / 9;
    // em telas estreitas (celular em pé), garante um campo horizontal utilizável
    if (aspect < 1) {
      const hRef = fovT * DEG * 0.9;
      const vNeed = (2 * Math.atan(Math.tan(hRef / 2) / aspect)) / DEG;
      fovT = Math.min(100, Math.max(fovT, vNeed));
    }
    this.fov = this._snap ? fovT : damp1(this.fov, fovT, this.st, 'fov', 0.25, dt);
    cam.position.copy(this.pos);
    let roll = this.roll;
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const k = this.shakeI * (this.shakeT / this.shakeDur);
      const t = this.time;
      cam.position.x += wob(t, 37.1, 23.7, 61.3) * k;
      cam.position.y += wob(t, 29.3, 41.9, 17.7) * k * 0.7;
      cam.position.z += wob(t, 33.7, 19.1, 53.9) * k;
      roll += wob(t, 21.3, 35.1, 47.7) * k * 0.08;
    }
    cam.lookAt(this.look);
    if (roll) cam.rotateZ(roll);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
