// Locomoção e combate dos personagens (contrato do Character em rig.js).
// Cada animação é um objeto { update(dt, speed?) -> boolean (true = terminou), duration?: s }.
//
// Princípios:
//  - Só mexemos em `rotation`/`quaternion` dos joints, em `hips.position.y` / `mountBody.position` (bobs que
//    o repouso restaura), em `root.position`/`root.rotation` (queda) e nunca em visibilidade.
//  - Nada é alocado por quadro: tudo é pré-alocado na criação da animação (quadros-chave compilados em
//    quaternions) e reaproveitado nos rascunhos do módulo.
//  - Toda animação captura a pose ATUAL no primeiro update e faz blend para a coreografia nos primeiros
//    ~0,15 s, para não saltar vindo do ciclo de andar ou da respiração.
//  - Arma e escudo são "apontados" no espaço da raiz do personagem: a orientação desejada é convertida na
//    rotação local do joint `weapon`/`shield` cancelando a cadeia de joints do braço. Assim a coreografia
//    vale para todos os personagens, seja qual for a pose de repouso do braço de cada um.
//
// Convenções do rig (rig.js): personagem olha +Z, lado R em +X, membros pendem em -Y.
//  ombro/quadril rotation.x NEGATIVO = membro para a frente;  tronco/cabeça rotation.x NEGATIVO = inclina para trás;
//  joelho rotation.x POSITIVO = flexão (canela para trás);  ombro rotation.z POSITIVO no lado R = abre o braço para fora.
//  Arma (pyr = pitch, yaw, roll no espaço da raiz): pitch POSITIVO = ponta para a frente; yaw POSITIVO = ponta para +X.
import * as THREE from './three.js';
import { resetPose } from './rig.js';

// ---------- Utilidades numéricas ----------
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
// Curvas de interpolação entre quadros-chave (o quadro de destino escolhe a curva)
const EASE = {
  lin: (x) => x,
  in: (x) => x * x * x,                                    // preparação lenta que acelera
  out: (x) => 1 - (1 - x) * (1 - x) * (1 - x),             // golpe: rápido no início, freia no fim
  snap: (x) => 1 - Math.pow(1 - x, 5),                     // impacto seco
  inout: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  smooth,
};
const BLEND_IN = 0.15;      // s de blend a partir da pose atual
const WALK_RATE = 7.0;      // rad/s de fase do ciclo de andar (speed = 1)
const TROT_RATE = 9.5;      // rad/s de fase do trote

// ---------- Rascunhos pré-alocados (nunca alocamos por quadro) ----------
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _e = new THREE.Euler();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ZERO_EULER = new THREE.Euler();
const ZERO_VEC = new THREE.Vector3();

// ---------- Pose de repouso ----------
const restMaps = new WeakMap(); // char -> Map(joint -> { rot, pos })
function restMap(char) {
  let m = restMaps.get(char);
  if (!m) {
    m = new Map();
    if (char.rest) for (const r of char.rest) m.set(r.o, r);
    restMaps.set(char, m);
  }
  return m;
}
const restRot = (char, j) => { const r = restMap(char).get(j); return r ? r.rot : ZERO_EULER; };
const restPos = (char, j) => { const r = restMap(char).get(j); return r ? r.pos : ZERO_VEC; };
// Restaura rotações e posições de repouso SEM mexer na visibilidade (resetPose do rig também mostra a
// cabeça, o que estragaria a câmera em primeira pessoa, que a esconde).
function toRest(char) {
  if (!char.rest) return;
  for (const r of char.rest) { r.o.rotation.copy(r.rot); r.o.position.copy(r.pos); }
}

// Nomes curtos usados nas coreografias -> joints do contrato
const ALIAS = {
  shR: 'shoulderR', elR: 'elbowR', shL: 'shoulderL', elL: 'elbowL',
  mBody: 'mountBody', mNeck: 'mountNeck', mHead: 'mountHead', mTail: 'mountTail',
};
const LEG_INDEX = { mFL: 0, mFR: 1, mBL: 2, mBR: 3 };
function jointOf(char, name) {
  if (name in LEG_INDEX) return char.joints.mountLegs ? char.joints.mountLegs[LEG_INDEX[name]] || null : null;
  return char.joints[ALIAS[name] || name] || null;
}

// Quaternion de (pitch, yaw, roll) para a arma: Ry(yaw) · Rx(pitch) · Ry(roll)
function pyrQuat(p, y, r, out) {
  out.setFromAxisAngle(Y_AXIS, y);
  out.multiply(_qc.setFromAxisAngle(X_AXIS, p));
  out.multiply(_qc.setFromAxisAngle(Y_AXIS, r));
  return out;
}

// Cadeia de joints da raiz (exclusive) até `end` (inclusive), do pai para o filho.
function chainTo(char, end) {
  const out = [];
  for (let o = end; o && o !== char.group; o = o.parent) out.unshift(o);
  return out;
}

// Mantém um objeto preso à mão (arma ou escudo) numa orientação desejada no ESPAÇO DA RAIZ, cancelando a
// orientação acumulada da cadeia de joints do braço (quaternions atuais).
class Aimer {
  constructor(char, jointName) {
    this.j = char.joints[jointName];
    this.chain = chainTo(char, this.j.parent);
    this.q0 = new THREE.Quaternion();       // rotação local no início da animação (blend)
    this.rest = new THREE.Quaternion();     // orientação de repouso no espaço da raiz
    this.rest.identity();
    for (const j of this.chain) this.rest.multiply(_q.setFromEuler(restRot(char, j)));
    this.rest.multiply(_q.setFromEuler(restRot(char, this.j)));
    this.keys = null;
  }
  capture() { this.q0.copy(this.j.quaternion); }
  // aplica a orientação `qRoot` (espaço da raiz), misturada com a inicial pelo peso w
  apply(qRoot, w) {
    _qa.identity();
    for (const j of this.chain) _qa.multiply(j.quaternion);
    _qa.invert().multiply(qRoot);
    if (w < 1) this.j.quaternion.slerpQuaternions(this.q0, _qa, w); else this.j.quaternion.copy(_qa);
  }
  applyRest(w) { this.apply(this.rest, w); }
}
const hasShield = (char) => !!(char.joints.shield && char.joints.shield.children.length);

// Conjunto de joints controlados por uma animação procedural (andar, respirar, recuo do golpe),
// com a pose inicial capturada para o blend de entrada.
class Poser {
  constructor(char, names) {
    this.items = [];
    this.map = {};
    for (const n of names) {
      const j = jointOf(char, n);
      if (!j) continue;
      const it = { j, q0: new THREE.Quaternion(), rest: restRot(char, j) };
      this.items.push(it);
      this.map[n] = it;
    }
  }
  capture() { for (const it of this.items) it.q0.copy(it.j.quaternion); }
  // rotação absoluta (Euler na ordem do repouso) misturada com a pose capturada pelo peso w
  set(name, x, y, z, w) {
    const it = this.map[name];
    if (!it) return;
    _e.set(x, y, z, it.rest.order);
    _q.setFromEuler(_e);
    if (w < 1) it.j.quaternion.slerpQuaternions(it.q0, _q, w); else it.j.quaternion.copy(_q);
  }
  // deslocamento em relação ao repouso
  add(name, dx, dy, dz, w) {
    const it = this.map[name];
    if (!it) return;
    this.set(name, it.rest.x + dx, it.rest.y + dy, it.rest.z + dz, w);
  }
  // deslocamento em relação à pose CAPTURADA (impulsos que voltam exatamente ao ponto de partida)
  nudge(name, dx, dy, dz) {
    const it = this.map[name];
    if (!it) return;
    _e.set(dx, dy, dz, it.rest.order);
    it.j.quaternion.copy(it.q0).multiply(_q.setFromEuler(_e));
  }
}

// ---------- Quadros-chave compilados ----------
// Um quadro: { t, ease, <joint>: [x,y,z] (Euler ABSOLUTO), '<joint>+': [dx,dy,dz] (RELATIVO ao repouso),
//              wpn: [pitch,yaw,roll] (arma no espaço da raiz; ausente = repouso), shd: idem para o escudo,
//              hipsY, mBodyY, mBodyZ (deslocamentos de posição), rootBack, rootUp, rootPitch, rootRoll (raiz) }
// Joint ausente num quadro = repouso. Na compilação tudo vira quaternion; por quadro só há slerps.
const SCALARS = ['hipsY', 'mBodyY', 'mBodyZ', 'rootBack', 'rootUp', 'rootPitch', 'rootRoll'];
const RESERVED = new Set(['t', 'ease', 'wpn', 'shd', ...SCALARS]);

function compileClip(char, frames) {
  const n = frames.length;
  const times = new Float32Array(n);
  const eases = [];
  for (let i = 0; i < n; i++) { times[i] = frames[i].t; eases.push(EASE[frames[i].ease || 'inout']); }
  const names = new Set();
  for (const f of frames) for (const k in f) if (!RESERVED.has(k)) names.add(k.endsWith('+') ? k.slice(0, -1) : k);
  const tracks = [];
  for (const name of names) {
    const j = jointOf(char, name);
    if (!j) continue;
    const rest = restRot(char, j);
    const keys = [];
    for (const f of frames) {
      const abs = f[name], rel = f[name + '+'];
      if (abs) _e.set(abs[0] || 0, abs[1] || 0, abs[2] || 0, rest.order);
      else if (rel) _e.set(rest.x + (rel[0] || 0), rest.y + (rel[1] || 0), rest.z + (rel[2] || 0), rest.order);
      else _e.copy(rest);
      keys.push(new THREE.Quaternion().setFromEuler(_e));
    }
    tracks.push({ j, keys, q0: new THREE.Quaternion() });
  }
  const aimTrack = (jointName, key) => {
    const a = new Aimer(char, jointName);
    a.keys = frames.map((f) => { const v = f[key]; const q = new THREE.Quaternion(); return v ? pyrQuat(v[0] || 0, v[1] || 0, v[2] || 0, q) : q.copy(a.rest); });
    return a;
  };
  const wpn = char.joints.weapon ? aimTrack('weapon', 'wpn') : null;
  const shd = hasShield(char) ? aimTrack('shield', 'shd') : null;
  const scalars = {};
  for (const s of SCALARS) if (frames.some((f) => f[s] !== undefined)) scalars[s] = Float32Array.from(frames, (f) => f[s] || 0);
  const J = char.joints;
  return {
    char, n, times, eases, tracks, wpn, shd, scalars, i: 0, e: 0,
    duration: times[n - 1],
    hipsRestY: restPos(char, J.hips).y, hipsY0: 0,
    bodyRest: J.mountBody ? restPos(char, J.mountBody) : null, bodyY0: 0, bodyZ0: 0,
  };
}
function captureClip(clip) {
  for (const tr of clip.tracks) tr.q0.copy(tr.j.quaternion);
  if (clip.wpn) clip.wpn.capture();
  if (clip.shd) clip.shd.capture();
  const J = clip.char.joints;
  clip.hipsY0 = J.hips.position.y - clip.hipsRestY;
  if (clip.bodyRest) { clip.bodyY0 = J.mountBody.position.y - clip.bodyRest.y; clip.bodyZ0 = J.mountBody.position.z - clip.bodyRest.z; }
  clip.i = 0;
}
const scalarAt = (clip, name) => { const v = clip.scalars[name]; return v ? lerp(v[clip.i], v[clip.i + 1], clip.e) : 0; };
// Aplica a pose no instante t com peso de blend w (0 = pose capturada, 1 = coreografia)
function sampleClip(clip, t, w) {
  const { times, n } = clip;
  let i = clip.i;
  while (i < n - 2 && t >= times[i + 1]) i++;
  clip.i = i;
  const t0 = times[i], t1 = times[i + 1];
  const e = t >= t1 ? 1 : clip.eases[i + 1](clamp01((t - t0) / (t1 - t0)));
  clip.e = e;
  for (const tr of clip.tracks) {
    _q.slerpQuaternions(tr.keys[i], tr.keys[i + 1], e);
    if (w < 1) tr.j.quaternion.slerpQuaternions(tr.q0, _q, w); else tr.j.quaternion.copy(_q);
  }
  // arma e escudo depois dos joints do braço (a cadeia já está na pose deste quadro)
  if (clip.wpn) { _qb.slerpQuaternions(clip.wpn.keys[i], clip.wpn.keys[i + 1], e); clip.wpn.apply(_qb, w); }
  if (clip.shd) { _qb.slerpQuaternions(clip.shd.keys[i], clip.shd.keys[i + 1], e); clip.shd.apply(_qb, w); }
  const J = clip.char.joints;
  if (clip.scalars.hipsY) J.hips.position.y = clip.hipsRestY + lerp(clip.hipsY0, scalarAt(clip, 'hipsY'), w);
  if (clip.bodyRest && (clip.scalars.mBodyY || clip.scalars.mBodyZ)) {
    J.mountBody.position.y = clip.bodyRest.y + lerp(clip.bodyY0, scalarAt(clip, 'mBodyY'), w);
    J.mountBody.position.z = clip.bodyRest.z + lerp(clip.bodyZ0, scalarAt(clip, 'mBodyZ'), w);
  }
}

// Animação a partir de um clipe compilado. opts: { hitAt, onHit, restAtEnd, blend, root }
// root = true: a raiz também é animada (rootBack/rootUp/rootPitch/rootRoll), no rumo capturado no início.
function clipAnim(char, clip, opts = {}) {
  const blend = opts.blend || BLEND_IN;
  const root = char.group;
  const p0 = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  let t = 0, started = false, hit = false, done = false, yaw0 = 0;
  return {
    duration: clip.duration,
    update(dt) {
      if (done) return true;
      if (!started) {
        started = true;
        captureClip(clip);
        if (opts.root) {
          p0.copy(root.position);
          yaw0 = root.rotation.y;
          fwd.set(Math.sin(yaw0), 0, Math.cos(yaw0)); // +Z local no mundo
          root.rotation.order = 'YXZ';                 // pitch/roll em torno dos eixos LOCAIS, depois do rumo
        }
      }
      t += dt;
      const w = blend > 0 ? smooth(t / blend) : 1;
      sampleClip(clip, t < clip.duration ? t : clip.duration, w);
      if (opts.root) {
        root.position.copy(p0).addScaledVector(fwd, -scalarAt(clip, 'rootBack'));
        root.position.y = p0.y + scalarAt(clip, 'rootUp');
        root.rotation.set(scalarAt(clip, 'rootPitch'), yaw0, scalarAt(clip, 'rootRoll'));
      }
      if (opts.hitAt !== undefined && !hit && t >= opts.hitAt) { hit = true; if (opts.onHit) opts.onHit(); }
      if (t >= clip.duration) {
        done = true;
        if (opts.restAtEnd) toRest(char);
        return true;
      }
      return false;
    },
  };
}

// =====================================================================================
// Andar
// =====================================================================================
const WALK_JOINTS = ['hips', 'torso', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR'];
const TROT_JOINTS = ['torso', 'head', 'shoulderL', 'shoulderR', 'mBody', 'mNeck', 'mHead', 'mTail', 'mFL', 'mFR', 'mBL', 'mBR'];

// Ciclo de andar contínuo. speed = fator do passo (1 = normal). Chame stop() ao parar (volta ao repouso).
export function createWalk(char) {
  const J = char.joints;
  const mounted = !!(char.mounted && J.mountLegs && J.mountBody);
  const P = new Poser(char, mounted ? TROT_JOINTS : WALK_JOINTS);
  const wpn = J.weapon ? new Aimer(char, 'weapon') : null;
  const shd = hasShield(char) ? new Aimer(char, 'shield') : null;
  const tunic = char.type === 'b' || char.type === 'q';   // túnica: passo mais curto
  const stride = tunic ? 0.55 : 1;
  const hipsRestY = restPos(char, J.hips).y;
  const bodyRestY = mounted ? restPos(char, J.mountBody).y : 0;
  let phase = 0, t = 0, started = false, hipsY0 = 0, bodyY0 = 0;
  const start = () => {
    started = true; t = 0; phase = 0;
    P.capture(); if (wpn) wpn.capture(); if (shd) shd.capture();
    hipsY0 = J.hips.position.y; if (mounted) bodyY0 = J.mountBody.position.y;
  };
  return {
    update(dt, speed = 1) {
      if (!started) start();
      t += dt;
      phase += dt * (mounted ? TROT_RATE : WALK_RATE) * speed;
      const w = smooth(t / 0.2);
      const s = Math.sin(phase), c = Math.cos(phase), c2 = Math.cos(phase * 2);
      if (mounted) {
        // Trote: pares diagonais (FL+BR / FR+BL) alternam; corpo sobe e desce duas vezes por ciclo.
        const a = 0.55 * Math.min(1.3, speed);
        P.add('mFL', s * a, 0, 0, w); P.add('mBR', s * a, 0, 0, w);
        P.add('mFR', -s * a, 0, 0, w); P.add('mBL', -s * a, 0, 0, w);
        P.add('mBody', 0.035 * c2, 0, 0.02 * s, w);
        P.add('mNeck', -0.06 * c2, 0, 0, w);
        P.add('mHead', 0.09 * Math.cos(phase * 2 + 0.6), 0.04 * s, 0, w);
        P.add('mTail', 0.12 * Math.abs(s), 0, 0.2 * Math.sin(phase * 0.5), w);
        J.mountBody.position.y = lerp(bodyY0, bodyRestY + 0.045 * Math.abs(s) - 0.015, w);
        // cavaleiro acompanha o balanço
        P.add('torso', 0.06 + 0.03 * c2, 0.02 * s, 0, w);
        P.add('head', -0.04 - 0.03 * c2, 0, 0, w);
        P.add('shoulderL', 0.04 * c2, 0, 0, w);
        P.add('shoulderR', 0.04 * c2, 0, 0, w);
      } else {
        // Pernas alternadas; o joelho dobra na fase de balanço (perna vindo de trás para a frente).
        const A = 0.55 * stride;
        P.set('hipL', s * A, 0, 0, w); P.set('hipR', -s * A, 0, 0, w);
        P.add('kneeL', 0.08 + Math.max(0, -c) * 0.95 * stride, 0, 0, w);
        P.add('kneeR', 0.08 + Math.max(0, c) * 0.95 * stride, 0, 0, w);
        // braços opostos às pernas; o braço da arma balança menos (a arma segue na vertical)
        P.add('shoulderL', -s * 0.32 * stride, 0, 0, w);
        P.add('shoulderR', s * 0.22 * stride, 0, 0, w);
        P.add('elbowL', -Math.max(0, -s) * 0.25 * stride, 0, 0, w);
        P.add('elbowR', -Math.max(0, s) * 0.15 * stride, 0, 0, w);
        // quadril sobe e desce (alto no apoio simples), roda com o passo; tronco compensa e inclina à frente
        J.hips.position.y = lerp(hipsY0, hipsRestY + (0.035 * Math.abs(s) - 0.017) * stride, w);
        P.add('hips', 0, 0.09 * s * stride, 0.035 * c * stride, w);
        P.add('torso', 0.07 + 0.02 * c2, -0.12 * s * stride, -0.03 * c * stride, w);
        P.add('head', -0.05, 0.05 * s, 0, w);
      }
      if (wpn) wpn.applyRest(w);
      if (shd) shd.applyRest(w);
      return false;
    },
    stop() { toRest(char); started = false; },
  };
}

// =====================================================================================
// Repouso "vivo": respiração, troca de peso, olhar em volta. Senos do tempo (sem deriva).
// =====================================================================================
const IDLE_JOINTS = ['torso', 'hips', 'head', 'shoulderL', 'shoulderR', 'mHead', 'mNeck', 'mTail', 'mFR'];
export function createIdle(char) {
  const P = new Poser(char, IDLE_JOINTS);
  const mounted = !!char.mounted;
  const ph = (char.group.id % 11) * 0.7; // defasagem por personagem: exército não respira em uníssono
  let t = 0, started = false;
  return {
    update(dt) {
      if (!started) { started = true; P.capture(); }
      t += dt;
      const w = smooth(t / 0.3);
      const breath = Math.sin(t * 1.6 + ph);
      const sway = Math.sin(t * 0.45 + ph * 1.3);
      const look = 0.6 * Math.sin(t * 0.55 + ph) + 0.4 * Math.sin(t * 0.23 + ph * 2.1);
      P.add('torso', 0.02 * breath, 0.01 * sway, -0.012 * sway, w);
      P.add('hips', 0, 0, 0.022 * sway, w);
      P.add('head', 0.03 * Math.sin(t * 0.37 + ph) - 0.01 * breath, 0.28 * look, 0, w);
      P.add('shoulderL', 0.02 * breath, 0, -0.01 * breath, w);
      P.add('shoulderR', 0.02 * breath, 0, 0.01 * breath, w);
      if (mounted) {
        P.add('mHead', 0.07 * Math.sin(t * 0.8 + ph), 0.08 * Math.sin(t * 0.31 + ph), 0, w);
        P.add('mNeck', 0.03 * Math.sin(t * 0.8 + ph + 1), 0, 0, w);
        P.add('mTail', 0.05 * Math.sin(t * 1.1 + ph), 0, 0.28 * Math.sin(t * 1.3 + ph), w);
        P.add('mFR', 0.05 * Math.max(0, Math.sin(t * 0.5 + ph)), 0, 0, w); // pata dianteira "escava"
      }
      return false;
    },
  };
}

// =====================================================================================
// Golpes (coreografia por arma). onHit é chamado UMA vez, no instante do impacto.
// =====================================================================================
// Lança de infantaria: recua a lança (pegada alta, ao lado do rosto), passo à frente, torção do tronco e
// estocada com o braço todo estendido. A haste cruza o campo de visão da primeira pessoa.
function spearFrames() {
  return [
    { t: 0 },
    { t: 0.42, ease: 'inout',
      shR: [-1.35, 0, 0.55], elR: [-1.8, 0, 0], torso: [0.02, 0.45, 0], head: [0.05, -0.25, 0],
      hipL: [-0.32, 0, 0], kneeL: [0.35, 0, 0], hipR: [0.22, 0, 0], kneeR: [0.1, 0, 0], hipsY: -0.03,
      wpn: [1.72, -0.2, 0], shL: [-0.35, 0, -0.45], elL: [-1.05, 0, 0] },
    { t: 0.6, ease: 'in',
      shR: [-1.45, 0, 0.55], elR: [-1.95, 0, 0], torso: [-0.02, 0.58, 0], head: [0.05, -0.32, 0],
      hipL: [-0.32, 0, 0], kneeL: [0.35, 0, 0], hipR: [0.22, 0, 0], kneeR: [0.1, 0, 0], hipsY: -0.03,
      wpn: [1.68, -0.28, 0], shL: [-0.4, 0, -0.5], elL: [-1.1, 0, 0] },
    { t: 0.74, ease: 'snap',
      shR: [-1.62, 0, 0.12], elR: [-0.05, 0, 0], torso: [0.32, -0.38, 0], head: [0.12, 0.05, 0],
      hipL: [-0.62, 0, 0], kneeL: [0.5, 0, 0], hipR: [0.5, 0, 0], kneeR: [0.12, 0, 0], hipsY: -0.09,
      wpn: [1.62, -0.06, 0], shL: [-0.3, 0, -0.55], elL: [-1.0, 0, 0] },
    { t: 0.92, ease: 'out',
      shR: [-1.55, 0, 0.12], elR: [-0.15, 0, 0], torso: [0.3, -0.35, 0], head: [0.1, 0.05, 0],
      hipL: [-0.6, 0, 0], kneeL: [0.5, 0, 0], hipR: [0.48, 0, 0], kneeR: [0.12, 0, 0], hipsY: -0.09,
      wpn: [1.6, -0.06, 0], shL: [-0.3, 0, -0.55], elL: [-1.0, 0, 0] },
    { t: 1.6, ease: 'inout' },
  ];
}
// Espada: ergue acima do ombro direito (ponta para trás) e desce em diagonal cruzando o corpo.
function swordFrames() {
  return [
    { t: 0 },
    { t: 0.45, ease: 'inout',
      shR: [-3.1, 0, 0.7], elR: [-1.1, 0, 0], torso: [-0.12, 0.42, 0.05], head: [-0.05, -0.2, 0],
      hipL: [-0.28, 0, 0], kneeL: [0.3, 0, 0], hipR: [0.2, 0, 0], kneeR: [0.1, 0, 0],
      wpn: [-0.85, 0.5, 0], shL: [-0.5, 0, -0.45], elL: [-1.2, 0, 0] },
    { t: 0.62, ease: 'in',
      shR: [-3.3, 0, 0.8], elR: [-1.3, 0, 0], torso: [-0.18, 0.55, 0.08], head: [-0.05, -0.25, 0],
      hipL: [-0.28, 0, 0], kneeL: [0.3, 0, 0], hipR: [0.2, 0, 0], kneeR: [0.1, 0, 0],
      wpn: [-1.15, 0.6, 0], shL: [-0.55, 0, -0.5], elL: [-1.2, 0, 0] },
    { t: 0.8, ease: 'snap',
      shR: [-1.15, 0, -0.35], elR: [-0.25, 0, 0], torso: [0.32, -0.45, -0.12], head: [0.15, 0.12, 0],
      hipL: [-0.55, 0, 0], kneeL: [0.5, 0, 0], hipR: [0.42, 0, 0], kneeR: [0.12, 0, 0], hipsY: -0.08,
      wpn: [1.5, -0.55, 0], shL: [-0.35, 0, -0.6], elL: [-1.1, 0, 0] },
    { t: 0.98, ease: 'out',
      shR: [-0.8, 0, -0.5], elR: [-0.35, 0, 0], torso: [0.34, -0.55, -0.14], head: [0.15, 0.15, 0],
      hipL: [-0.55, 0, 0], kneeL: [0.5, 0, 0], hipR: [0.42, 0, 0], kneeR: [0.12, 0, 0], hipsY: -0.08,
      wpn: [1.95, -0.85, 0], shL: [-0.35, 0, -0.6], elL: [-1.1, 0, 0] },
    { t: 1.55, ease: 'inout' },
  ];
}
// Martelo de guerra: as duas mãos erguem a arma acima da cabeça, corpo inclina para trás e desaba
// para a frente com leve agachamento no impacto.
function hammerFrames() {
  return [
    { t: 0 },
    { t: 0.5, ease: 'inout',
      shR: [-2.9, 0, -0.25], elR: [-0.7, 0, 0], shL: [-2.9, 0, 0.25], elL: [-0.7, 0, 0],
      torso: [-0.28, 0, 0], head: [-0.25, 0, 0], hipL: [-0.12, 0, 0], hipR: [-0.12, 0, 0], kneeL: [0.2, 0, 0], kneeR: [0.2, 0, 0], hipsY: -0.02,
      wpn: [-0.9, 0, 0], shd: [0.4, 0.3, 0] },
    { t: 0.76, ease: 'in',
      shR: [-3.1, 0, -0.25], elR: [-0.8, 0, 0], shL: [-3.1, 0, 0.25], elL: [-0.8, 0, 0],
      torso: [-0.38, 0, 0], head: [-0.3, 0, 0], hipL: [-0.15, 0, 0], hipR: [-0.15, 0, 0], kneeL: [0.25, 0, 0], kneeR: [0.25, 0, 0], hipsY: -0.03,
      wpn: [-1.2, 0, 0], shd: [0.4, 0.3, 0] },
    { t: 0.98, ease: 'snap',
      shR: [-1.15, 0, -0.15], elR: [-0.25, 0, 0], shL: [-1.15, 0, 0.15], elL: [-0.25, 0, 0],
      torso: [0.62, 0, 0], head: [0.25, 0, 0], hipL: [-0.55, 0, 0], hipR: [-0.55, 0, 0], kneeL: [0.75, 0, 0], kneeR: [0.75, 0, 0], hipsY: -0.17,
      wpn: [1.8, 0, 0], shd: [1.2, 0.2, 0] },
    { t: 1.18, ease: 'out',
      shR: [-1.1, 0, -0.15], elR: [-0.3, 0, 0], shL: [-1.1, 0, 0.15], elL: [-0.3, 0, 0],
      torso: [0.58, 0, 0], head: [0.22, 0, 0], hipL: [-0.5, 0, 0], hipR: [-0.5, 0, 0], kneeL: [0.7, 0, 0], kneeR: [0.7, 0, 0], hipsY: -0.15,
      wpn: [1.75, 0, 0], shd: [1.2, 0.2, 0] },
    { t: 1.75, ease: 'inout' },
  ];
}
// Báculo: varredura horizontal da direita para a esquerda na altura do rosto, com o tronco torcendo.
function staffFrames() {
  return [
    { t: 0 },
    { t: 0.45, ease: 'inout',
      shR: [-1.55, 0, 0.95], elR: [-0.6, 0, 0], torso: [0.0, 0.5, 0.05], head: [0.02, -0.15, 0],
      hipL: [-0.28, 0, 0], kneeL: [0.3, 0, 0], hipR: [0.2, 0, 0], kneeR: [0.1, 0, 0],
      wpn: [1.5, 0.95, 0], shL: [-0.8, 0, -0.4], elL: [-1.2, 0, 0] },
    { t: 0.62, ease: 'in',
      shR: [-1.6, 0, 1.1], elR: [-0.7, 0, 0], torso: [0.0, 0.62, 0.06], head: [0.02, -0.2, 0],
      hipL: [-0.28, 0, 0], kneeL: [0.3, 0, 0], hipR: [0.2, 0, 0], kneeR: [0.1, 0, 0],
      wpn: [1.5, 1.15, 0], shL: [-0.85, 0, -0.45], elL: [-1.25, 0, 0] },
    { t: 0.8, ease: 'snap',
      shR: [-1.62, 0, -0.25], elR: [-0.15, 0, 0], torso: [0.25, -0.55, -0.05], head: [0.1, 0.15, 0],
      hipL: [-0.5, 0, 0], kneeL: [0.4, 0, 0], hipR: [0.4, 0, 0], kneeR: [0.12, 0, 0], hipsY: -0.06,
      wpn: [1.6, -0.45, 0], shL: [-1.0, 0, -0.7], elL: [-1.4, 0, 0] },
    { t: 0.98, ease: 'out',
      shR: [-1.5, 0, -0.5], elR: [-0.2, 0, 0], torso: [0.25, -0.65, -0.05], head: [0.1, 0.2, 0],
      hipL: [-0.5, 0, 0], kneeL: [0.4, 0, 0], hipR: [0.4, 0, 0], kneeR: [0.12, 0, 0], hipsY: -0.06,
      wpn: [1.55, -0.9, 0], shL: [-1.0, 0, -0.7], elL: [-1.4, 0, 0] },
    { t: 1.6, ease: 'inout' },
  ];
}
// Lança de justa (montado): a lança desce para a horizontal em riste, o cavalo empina e avança com o
// corpo, o cavaleiro inclina-se na estocada e a lança volta para cima.
function lanceFrames() {
  return [
    { t: 0 },
    { t: 0.55, ease: 'inout',
      shR: [0.35, 0, 0.35], elR: [-1.35, 0, 0], torso: [0.1, 0.15, 0], head: [0.05, -0.1, 0],
      wpn: [1.45, -0.14, 0], shL: [-0.7, 0, -0.3], elL: [-1.3, 0, 0],
      'mBody+': [-0.28, 0, 0], mBodyY: 0.12, 'mFL+': [-1.05, 0, 0], 'mFR+': [-0.75, 0, 0], 'mBL+': [0.28, 0, 0], 'mBR+': [0.28, 0, 0],
      'mNeck+': [-0.25, 0, 0], 'mHead+': [0.12, 0, 0], 'mTail+': [0.35, 0, 0] },
    { t: 0.85, ease: 'in',
      shR: [0.3, 0, 0.3], elR: [-1.25, 0, 0], torso: [0.18, 0.12, 0], head: [0.05, -0.05, 0],
      wpn: [1.5, -0.12, 0], shL: [-0.8, 0, -0.3], elL: [-1.3, 0, 0],
      'mBody+': [0.04, 0, 0], mBodyY: 0.0, mBodyZ: 0.1, 'mFL+': [-0.35, 0, 0], 'mFR+': [-0.5, 0, 0], 'mBL+': [0.4, 0, 0], 'mBR+': [0.4, 0, 0],
      'mNeck+': [-0.05, 0, 0], 'mHead+': [0.05, 0, 0], 'mTail+': [0.2, 0, 0] },
    { t: 1.07, ease: 'snap',
      shR: [-0.75, 0, 0.2], elR: [-0.45, 0, 0], torso: [0.48, -0.15, 0], head: [0.12, 0.05, 0],
      wpn: [1.58, -0.1, 0], shL: [-0.95, 0, -0.35], elL: [-1.3, 0, 0],
      'mBody+': [0.12, 0, 0], mBodyY: -0.02, mBodyZ: 0.35, 'mFL+': [0.4, 0, 0], 'mFR+': [0.3, 0, 0], 'mBL+': [-0.35, 0, 0], 'mBR+': [-0.35, 0, 0],
      'mNeck+': [0.2, 0, 0], 'mHead+': [0.2, 0, 0], 'mTail+': [-0.2, 0, 0] },
    { t: 1.28, ease: 'out',
      shR: [-0.7, 0, 0.2], elR: [-0.5, 0, 0], torso: [0.42, -0.12, 0], head: [0.1, 0.05, 0],
      wpn: [1.55, -0.1, 0], shL: [-0.9, 0, -0.35], elL: [-1.3, 0, 0],
      'mBody+': [0.08, 0, 0], mBodyY: -0.01, mBodyZ: 0.3, 'mFL+': [0.3, 0, 0], 'mFR+': [0.2, 0, 0], 'mBL+': [-0.25, 0, 0], 'mBR+': [-0.25, 0, 0],
      'mNeck+': [0.12, 0, 0], 'mHead+': [0.15, 0, 0], 'mTail+': [-0.1, 0, 0] },
    { t: 1.9, ease: 'inout' },
  ];
}
// Sem arma conhecida: soco/empurrão com a mão direita
function punchFrames() {
  return [
    { t: 0 },
    { t: 0.4, ease: 'inout', shR: [0.4, 0, 0.3], elR: [-1.6, 0, 0], torso: [0, 0.45, 0], hipL: [-0.3, 0, 0], hipR: [0.2, 0, 0] },
    { t: 0.62, ease: 'snap', shR: [-1.6, 0, -0.1], elR: [-0.05, 0, 0], torso: [0.25, -0.4, 0], hipL: [-0.55, 0, 0], kneeL: [0.4, 0, 0], hipR: [0.4, 0, 0], hipsY: -0.06 },
    { t: 0.8, ease: 'out', shR: [-1.5, 0, -0.1], elR: [-0.15, 0, 0], torso: [0.25, -0.4, 0], hipL: [-0.55, 0, 0], kneeL: [0.4, 0, 0], hipR: [0.4, 0, 0], hipsY: -0.06 },
    { t: 1.3, ease: 'inout' },
  ];
}
const ATTACKS = {
  spear: { frames: spearFrames, hitAt: 0.71 },
  sword: { frames: swordFrames, hitAt: 0.77 },
  hammer: { frames: hammerFrames, hitAt: 0.95 },
  mace: { frames: swordFrames, hitAt: 0.77 },
  staff: { frames: staffFrames, hitAt: 0.77 },
  lance: { frames: lanceFrames, hitAt: 1.03 },
  none: { frames: punchFrames, hitAt: 0.6 },
};

// Golpe: prepara, golpeia (chama opts.onHit no impacto), recupera. Coreografia por attacker.weaponKind.
// O integrador já virou o atacante para a vítima e o pôs à distância de alcance.
export function createAttack(attacker, victim, opts = {}) {
  let def = ATTACKS[attacker.weaponKind] || ATTACKS.none;
  if (attacker.mounted && def !== ATTACKS.lance) def = ATTACKS.lance;       // montado sempre usa a lança em riste
  if (!attacker.mounted && def === ATTACKS.lance) def = ATTACKS.spear;      // lança a pé vira estocada
  const clip = compileClip(attacker, def.frames(attacker, victim));
  return clipAnim(attacker, clip, { hitAt: def.hitAt, onHit: opts.onHit, restAtEnd: true });
}

// =====================================================================================
// Recuo ao ser atingido: tronco e cabeça para trás, braços abrem; volta exatamente à pose anterior.
// =====================================================================================
const HIT_JOINTS = ['torso', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'mNeck', 'mHead'];
export function createHit(victim, dir) {
  const P = new Poser(victim, HIT_JOINTS);
  const dur = 0.38;
  let t = 0, started = false, side = 1;
  return {
    duration: dur,
    update(dt) {
      if (!started) {
        started = true; P.capture();
        // lado do golpe (componente lateral de `dir` no espaço da vítima) decide para onde a cabeça vira
        const yaw = victim.group.rotation.y;
        side = dir && (dir.x * Math.cos(yaw) - dir.z * Math.sin(yaw)) < 0 ? -1 : 1;
      }
      t += dt;
      const k = clamp01(t / dur);
      const p = Math.sin(k * Math.PI);                       // impulso que volta a zero
      const ph = Math.sin(clamp01((k - 0.08) / 0.92) * Math.PI); // cabeça atrasa um pouco
      P.nudge('torso', -0.42 * p, 0.12 * p * side, 0);
      P.nudge('head', -0.55 * ph, 0.2 * ph * side, 0);
      P.nudge('shoulderR', -0.25 * p, 0, 0.45 * p);
      P.nudge('shoulderL', -0.25 * p, 0, -0.45 * p);
      P.nudge('elbowR', -0.3 * p, 0, 0);
      P.nudge('elbowL', -0.3 * p, 0, 0);
      P.nudge('mNeck', -0.25 * p, 0, 0);
      P.nudge('mHead', -0.3 * ph, 0, 0);
      return k >= 1;
    },
  };
}

// =====================================================================================
// Queda (morte). dir = Vector3 unitário no mundo, do atacante para a vítima (a vítima olha para o
// atacante, então tomba para o seu -Z local, pivotando nos pés). Termina deitada e imóvel.
// =====================================================================================
function deathFrames(char, side) {
  const s = side;                       // sentido da torção do tronco/cabeça
  const heavy = char.type === 'r' || char.type === 'k';
  return [
    { t: 0 },
    // impacto: tronco e cabeça chicoteiam para trás, braços abrem, arma começa a cair
    { t: 0.2, ease: 'out',
      torso: [-0.45, 0.15 * s, 0], head: [-0.5, 0.1 * s, 0], shR: [-1.2, 0, 0.7], elR: [-0.5, 0, 0], shL: [-1.1, 0, -0.75], elL: [-0.45, 0, 0],
      hipL: [-0.12, 0, 0], kneeL: [0.3, 0, 0], hipR: [-0.08, 0, 0], kneeR: [0.25, 0, 0], hipsY: -0.03, rootBack: 0.08,
      wpn: [0.9, 0.35, 0], shd: [0.6, -0.5, 0] },
    // cambaleio: recua ~0,3 m, joelhos dobram, tronco torce, arma escorrega da mão
    { t: 0.52, ease: 'inout',
      torso: [-0.3, 0.4 * s, 0.12 * s], head: [-0.35, 0.35 * s, 0.1 * s], shR: [-0.55, 0, 0.95], elR: [-0.35, 0, 0], shL: [-0.45, 0, -1.05], elL: [-0.3, 0, 0],
      hipL: [-0.42, 0, 0], kneeL: [0.75, 0, 0], hipR: [-0.3, 0, 0], kneeR: [0.6, 0, 0], hipsY: -0.13, rootBack: 0.3, rootPitch: -0.18,
      wpn: [1.5, 0.7, 0], shd: [0.9, -0.8, 0] },
    // tomba para trás pivotando nos pés (acelera), braços em cruz, arma deita
    { t: 0.92, ease: 'in',
      torso: [0.05 * (heavy ? 0 : 1), 0.4 * s, 0.12 * s], head: [-0.4, 0.3 * s, 0.1 * s], shR: [-0.3, 0, 1.35], elR: [-0.15, 0, 0], shL: [-0.2, 0, -1.35], elL: [-0.15, 0, 0],
      hipL: [-0.3, 0, 0], kneeL: [0.5, 0, 0], hipR: [-0.18, 0, 0], kneeR: [0.35, 0, 0], hipsY: -0.1, rootBack: 0.3, rootPitch: -1.5, rootUp: 0.1,
      wpn: [0.15, 0.4, 0], shd: [0.3, -0.7, 0] },
    // quique ao tocar o chão
    { t: 1.04, ease: 'out',
      torso: [0.12, 0.35 * s, 0.1 * s], head: [-0.2, 0.3 * s, 0.1 * s], shR: [-0.45, 0, 1.3], elR: [-0.35, 0, 0], shL: [-0.35, 0, -1.3], elL: [-0.3, 0, 0],
      hipL: [-0.45, 0, 0], kneeL: [0.6, 0, 0], hipR: [-0.28, 0, 0], kneeR: [0.4, 0, 0], hipsY: -0.1, rootBack: 0.32, rootPitch: -1.36, rootUp: 0.12,
      wpn: [0.15, 0.45, 0], shd: [0.3, -0.7, 0] },
    { t: 1.2, ease: 'in',
      torso: [0.08, 0.3 * s, 0.08 * s], head: [-0.42, 0.35 * s, 0.1 * s], shR: [-0.25, 0, 1.4], elR: [-0.1, 0, 0], shL: [-0.15, 0, -1.4], elL: [-0.1, 0, 0],
      hipL: [-0.3, 0, 0], kneeL: [0.45, 0, 0], hipR: [-0.15, 0, 0], kneeR: [0.3, 0, 0], hipsY: -0.1, rootBack: 0.32, rootPitch: -1.5, rootUp: 0.1,
      wpn: [0.1, 0.45, 0], shd: [0.3, -0.7, 0] },
    // assenta e fica imóvel
    { t: 1.5, ease: 'out',
      torso: [0.08, 0.3 * s, 0.08 * s], head: [-0.42, 0.4 * s, 0.1 * s], shR: [-0.2, 0, 1.4], elR: [-0.05, 0, 0], shL: [-0.1, 0, -1.4], elL: [-0.05, 0, 0],
      hipL: [-0.28, 0, 0], kneeL: [0.42, 0, 0], hipR: [-0.12, 0, 0], kneeR: [0.26, 0, 0], hipsY: -0.1, rootBack: 0.32, rootPitch: -1.5, rootUp: 0.1,
      wpn: [0.1, 0.45, 0], shd: [0.3, -0.7, 0] },
  ];
}
// Montado: o cavalo empina, perde o equilíbrio e cai de lado (rolagem da raiz) com o cavaleiro.
function mountedDeathFrames(char, side) {
  const s = side; // +1: cai para o lado esquerdo (-X local); -1: para o direito
  return [
    { t: 0 },
    // empina: corpo sobe e gira, patas dianteiras no ar, cavaleiro chicoteia para trás
    { t: 0.38, ease: 'out',
      'mBody+': [-0.6, 0, 0], mBodyY: 0.22, 'mFL+': [-1.35, 0, 0], 'mFR+': [-1.0, 0, 0], 'mBL+': [0.55, 0, 0], 'mBR+': [0.55, 0, 0],
      'mNeck+': [-0.35, 0, 0], 'mHead+': [-0.25, 0, 0], 'mTail+': [0.45, 0, 0],
      torso: [-0.45, 0, 0], head: [-0.45, 0, 0], shR: [-1.25, 0, 0.7], elR: [-0.4, 0, 0], shL: [-1.0, 0, -0.9], elL: [-0.4, 0, 0],
      wpn: [1.0, 0.3, 0], shd: [0.5, -0.5, 0] },
    // começa a tombar de lado
    { t: 0.62, ease: 'in',
      'mBody+': [-0.35, 0, 0], mBodyY: 0.16, 'mFL+': [-1.0, 0, 0], 'mFR+': [-0.6, 0, 0], 'mBL+': [0.4, 0, 0], 'mBR+': [0.3, 0, 0],
      'mNeck+': [-0.2, 0, 0], 'mHead+': [-0.1, 0.2 * s, 0], 'mTail+': [0.3, 0, 0.3 * s],
      torso: [-0.35, 0.2 * s, -0.3 * s], head: [-0.35, 0.3 * s, -0.15 * s], shR: [-0.8, 0, 1.0], elR: [-0.3, 0, 0], shL: [-0.6, 0, -1.1], elL: [-0.3, 0, 0],
      rootRoll: 0.4 * s, rootUp: 0.03,
      wpn: [1.4, 0.5, 0], shd: [0.8, -0.7, 0] },
    // cai de lado (acelera); o corpo assenta a ~0,3 m (raio do tronco) do chão; patas esticam
    { t: 0.98, ease: 'in',
      'mBody+': [0.05, 0, 0], mBodyY: 0.0, 'mFL+': [0.35, 0, 0], 'mFR+': [-0.45, 0, 0], 'mBL+': [-0.25, 0, 0], 'mBR+': [0.4, 0, 0],
      'mNeck+': [0.2, 0.15 * s, 0], 'mHead+': [0.35, 0.25 * s, 0], 'mTail+': [-0.3, 0, 0.2 * s],
      torso: [-0.15, 0.25 * s, -0.45 * s], head: [-0.3, 0.4 * s, -0.2 * s], shR: [-0.35, 0, 1.35], elR: [-0.15, 0, 0], shL: [-0.25, 0, -1.35], elL: [-0.15, 0, 0],
      rootRoll: 1.5 * s, rootUp: 0.21,
      wpn: [0.2, 0.2, 0], shd: [0.3, -0.6, 0] },
    // quique
    { t: 1.1, ease: 'out',
      'mBody+': [0.02, 0, 0], mBodyY: 0.0, 'mFL+': [0.5, 0, 0], 'mFR+': [-0.3, 0, 0], 'mBL+': [-0.1, 0, 0], 'mBR+': [0.55, 0, 0],
      'mNeck+': [0.25, 0.15 * s, 0], 'mHead+': [0.3, 0.25 * s, 0], 'mTail+': [-0.35, 0, 0.2 * s],
      torso: [-0.1, 0.25 * s, -0.4 * s], head: [-0.15, 0.4 * s, -0.2 * s], shR: [-0.45, 0, 1.3], elR: [-0.3, 0, 0], shL: [-0.35, 0, -1.3], elL: [-0.3, 0, 0],
      rootRoll: 1.38 * s, rootUp: 0.27,
      wpn: [0.2, 0.2, 0], shd: [0.3, -0.6, 0] },
    { t: 1.28, ease: 'in',
      'mBody+': [0.03, 0, 0], mBodyY: 0.0, 'mFL+': [0.4, 0, 0], 'mFR+': [-0.35, 0, 0], 'mBL+': [-0.15, 0, 0], 'mBR+': [0.45, 0, 0],
      'mNeck+': [0.22, 0.15 * s, 0], 'mHead+': [0.35, 0.25 * s, 0], 'mTail+': [-0.3, 0, 0.2 * s],
      torso: [-0.12, 0.25 * s, -0.42 * s], head: [-0.32, 0.4 * s, -0.2 * s], shR: [-0.3, 0, 1.38], elR: [-0.12, 0, 0], shL: [-0.2, 0, -1.38], elL: [-0.12, 0, 0],
      rootRoll: 1.5 * s, rootUp: 0.21,
      wpn: [0.15, 0.2, 0], shd: [0.3, -0.6, 0] },
    // assenta, patas relaxam, imóvel
    { t: 1.6, ease: 'out',
      'mBody+': [0.03, 0, 0], mBodyY: 0.0, 'mFL+': [0.3, 0, 0], 'mFR+': [-0.25, 0, 0], 'mBL+': [-0.1, 0, 0], 'mBR+': [0.35, 0, 0],
      'mNeck+': [0.22, 0.15 * s, 0], 'mHead+': [0.38, 0.25 * s, 0], 'mTail+': [-0.3, 0, 0.2 * s],
      torso: [-0.12, 0.25 * s, -0.42 * s], head: [-0.32, 0.42 * s, -0.2 * s], shR: [-0.25, 0, 1.4], elR: [-0.08, 0, 0], shL: [-0.15, 0, -1.4], elL: [-0.08, 0, 0],
      rootRoll: 1.5 * s, rootUp: 0.21,
      wpn: [0.15, 0.2, 0], shd: [0.3, -0.6, 0] },
  ];
}
export function createDeath(victim, dir) {
  // componente lateral do golpe no espaço da vítima: decide o lado da torção / da rolagem
  const yaw = victim.group.rotation.y;
  const lateral = dir ? dir.x * Math.cos(yaw) - dir.z * Math.sin(yaw) : 0;
  const side = lateral < 0 ? -1 : 1;
  const mounted = !!(victim.mounted && victim.joints.mountBody && victim.joints.mountLegs);
  const clip = compileClip(victim, mounted ? mountedDeathFrames(victim, side) : deathFrames(victim, side));
  return clipAnim(victim, clip, { root: true, restAtEnd: false });
}

// =====================================================================================
// Vitória: ergue a arma ao alto, pequeno gesto de triunfo, volta ao repouso.
// =====================================================================================
function victoryFrames(char) {
  const m = char.mounted;
  const two = char.weaponKind === 'hammer'; // arma de duas mãos: a esquerda sobe junto
  return [
    { t: 0 },
    { t: 0.32, ease: 'out',
      shR: [-2.75, 0, 0.3], elR: [-0.25, 0, 0], torso: [-0.14, -0.1, 0], head: [-0.28, 0, 0], wpn: [-0.3, 0.05, 0],
      shL: two ? [-2.6, 0, -0.3] : [-0.35, 0, -0.55], elL: two ? [-0.5, 0, 0] : [-1.0, 0, 0],
      'mHead+': m ? [-0.35, 0, 0] : undefined, 'mNeck+': m ? [-0.25, 0, 0] : undefined, 'mFL+': m ? [-0.6, 0, 0] : undefined },
    { t: 0.5, ease: 'inout',
      shR: [-2.5, 0, 0.3], elR: [-0.6, 0, 0], torso: [-0.1, -0.08, 0], head: [-0.22, 0, 0], wpn: [-0.45, 0.05, 0],
      shL: two ? [-2.4, 0, -0.3] : [-0.35, 0, -0.55], elL: two ? [-0.8, 0, 0] : [-1.0, 0, 0],
      'mHead+': m ? [-0.2, 0, 0] : undefined, 'mNeck+': m ? [-0.15, 0, 0] : undefined, 'mFL+': m ? [-0.2, 0, 0] : undefined },
    { t: 0.68, ease: 'out',
      shR: [-2.8, 0, 0.3], elR: [-0.15, 0, 0], torso: [-0.15, -0.1, 0], head: [-0.3, 0, 0], wpn: [-0.25, 0.05, 0],
      shL: two ? [-2.65, 0, -0.3] : [-0.35, 0, -0.55], elL: two ? [-0.45, 0, 0] : [-1.0, 0, 0],
      'mHead+': m ? [-0.35, 0, 0] : undefined, 'mNeck+': m ? [-0.25, 0, 0] : undefined, 'mFL+': m ? [-0.5, 0, 0] : undefined },
    { t: 1.1, ease: 'inout' },
  ];
}
export function createVictory(char) {
  const frames = victoryFrames(char);
  for (const f of frames) for (const k in f) if (f[k] === undefined) delete f[k];
  const clip = compileClip(char, frames);
  return clipAnim(char, clip, { restAtEnd: true, blend: 0.12 });
}

export { resetPose };
