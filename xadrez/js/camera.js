// Câmera: vista de cima (overhead), primeira pessoa (olhos do personagem) e plano cinematográfico
// da batalha, com tweens suaves, olhar por arrasto em 1ª pessoa, seguir o personagem e tremor.
import * as THREE from './three.js';
import { CAMERA } from './config.js';

const _p = new THREE.Vector3();
const _look = new THREE.Vector3();
const _tmp = new THREE.Object3D();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _d = new THREE.Vector3();
const _side = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FP_PITCH = -0.24; // olhar um pouco para baixo em 1ª pessoa (casas vizinhas visíveis)
// 3ª pessoa (estilo Fortnite): câmera atrás e acima do ombro, olhando por cima do personagem
const TP = { pitch: -0.3, dist: 4.4, shoulder: 0.85, lookH: 0.8, minY: 1.2, fov: 60, smooth: 9 };
const _tp = new THREE.Vector3();
const _tq = new THREE.Quaternion();

// Orientação de câmera (olha por -Z) de `eye` para `target`
function lookQuat(eye, target, out) {
  _m.lookAt(eye, target, UP);
  return out.setFromRotationMatrix(_m);
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wob = (t, a, b, c) => Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 2.1) * 0.2;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'overhead';   // 'overhead' | 'firstperson' | 'cinematic' | 'roam'
    this.roamT = 0;
    this.transition = null;   // { f0, f1, t, dur, resolve, next }
    this.side = 'w';
    this.follow = null;       // Character seguido em 1ª pessoa
    this.dyaw = 0; this.dpitch = 0;    // deslocamento do olhar por arrasto
    this.shakeT = 0; this.shakeDur = 0; this.shakeAmp = 0; this.shakeTime = 0;
    this.basePos = new THREE.Vector3();
    this.baseQuat = new THREE.Quaternion();
    this._p0 = new THREE.Vector3(); this._p1 = new THREE.Vector3();
    this._q0 = new THREE.Quaternion(); this._q1 = new THREE.Quaternion();
    this._pendingFollow = null;
    this.person = 'first';    // 'first' | 'third': como seguir o personagem escolhido
    this.setOverheadInstant('w');
  }

  overheadPose(side, outPos, outQuat) {
    const d = CAMERA.overheadDist;
    const s = side === 'w' ? 1 : -1;
    outPos.set(0, Math.sin(CAMERA.overheadPitch) * d, s * Math.cos(CAMERA.overheadPitch) * d);
    _look.set(0, 0, 0);
    lookQuat(outPos, _look, outQuat);
  }

  setOverheadInstant(side) {
    this.side = side;
    this.mode = 'overhead';
    this._stopFollow();
    this.overheadPose(side, this.basePos, this.baseQuat);
    this.camera.position.copy(this.basePos);
    this.camera.quaternion.copy(this.baseQuat);
    this.camera.fov = CAMERA.overheadFov;
    this.camera.updateProjectionMatrix();
  }

  _stopFollow() {
    if (this.follow) this.follow.setHeadVisible(true);
    this.follow = null;
    this._pendingFollow = null;
  }

  _startTween(p1, q1, f1, dur, next) {
    return new Promise((resolve) => {
      if (this.transition) { const t = this.transition; this.transition = null; t.resolve(); }
      this._p0.copy(this.basePos);
      this._q0.copy(this.baseQuat);
      this._p1.copy(p1);
      this._q1.copy(q1);
      this.transition = { f0: this.camera.fov, f1, t: 0, dur, resolve, next };
      this._stopFollow();
      this.dyaw = 0; this.dpitch = 0;
    });
  }

  flyToOverhead(side = this.side) {
    this.side = side;
    this.overheadPose(side, _p, _tmp.quaternion);
    return this._startTween(_p, _tmp.quaternion, CAMERA.overheadFov, CAMERA.flyDur, 'overhead');
  }

  // Passeio do "general": atrás da 1ª fileira do lado `side`, à altura dos olhos, olhando para o inimigo,
  // deslocando-se devagar de um lado para o outro. Modo contínuo (renderiza sempre).
  roam(side = this.side) {
    this.side = side;
    this.roamT = 0;
    this.dyaw = 0; this.dpitch = 0;
    this._roamPose(side, 0, _p, _tmp.quaternion);
    return this._startTween(_p, _tmp.quaternion, 62, CAMERA.flyDur, 'roam');
  }
  _roamPose(side, t, outPos, outQuat) {
    const s = side === 'w' ? 1 : -1;
    const x = Math.sin(t * 0.11) * 4.5;
    outPos.set(x, 2.6 + Math.sin(t * 0.6) * 0.02, s * 12.0);
    _e.set(-0.17 + this.dpitch, (s === 1 ? 0 : Math.PI) + this.dyaw + Math.sin(t * 0.07) * 0.12, 0, 'YXZ');
    outQuat.setFromEuler(_e);
  }

  _personFov() { return this.person === 'third' ? TP.fov : CAMERA.firstPersonFov; }

  // Troca entre 1ª e 3ª pessoa; vale na hora se já estiver seguindo alguém
  setPerson(person) {
    this.person = person === 'third' ? 'third' : 'first';
    const ch = this.follow || this._pendingFollow;
    if (this.follow) this.follow.setHeadVisible(this.person === 'third');
    if (ch && (this.mode === 'firstperson' || this.transition)) {
      this.camera.fov = this._personFov();
      this.camera.updateProjectionMatrix();
      if (this.transition) this.transition.f1 = this._personFov();
    }
  }

  // Pose de 3ª pessoa: atrás e acima do ombro; o arrasto orbita em volta do personagem
  _tpPose(char, outPos, outQuat) {
    char.group.updateMatrixWorld(true);
    char.group.getWorldPosition(_look);
    _look.y += (char.height || 1.8) * TP.lookH;
    const yaw = char.group.rotation.y + Math.PI + this.dyaw;
    const pitch = THREE.MathUtils.clamp(TP.pitch + this.dpitch, -1.1, 0.15);
    const cp = Math.cos(pitch);
    _d.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp); // direção do olhar
    _side.set(Math.cos(yaw), 0, -Math.sin(yaw));                       // direita da tela
    outPos.copy(_look).addScaledVector(_d, -TP.dist).addScaledVector(_side, TP.shoulder);
    if (outPos.y < TP.minY) outPos.y = TP.minY;
    _e.set(pitch, yaw, 0, 'YXZ');
    outQuat.setFromEuler(_e);
  }

  // Pose de 1ª pessoa do personagem: olhos + olhar para a frente dele
  _fpPose(char, outPos, outQuat) {
    if (this.person === 'third') return this._tpPose(char, outPos, outQuat);
    char.group.updateMatrixWorld(true);
    char.getEye(outPos);
    _e.set(FP_PITCH + this.dpitch, char.group.rotation.y + Math.PI + this.dyaw, 0, 'YXZ');
    outQuat.setFromEuler(_e);
  }

  // Voa para os olhos do personagem (Character do contrato de rig.js) e passa a segui-lo.
  flyToPiece(char) {
    this.dyaw = 0; this.dpitch = 0;
    this._fpPose(char, _p, _tmp.quaternion);
    const pr = this._startTween(_p, _tmp.quaternion, this._personFov(), CAMERA.flyDur, 'firstperson');
    this._pendingFollow = char;
    return pr;
  }

  // Em 1ª pessoa: a câmera acompanha os olhos do personagem (andar, golpe, viradas)
  followChar(char) {
    if (this.follow && this.follow !== char) this.follow.setHeadVisible(true);
    this.follow = char;
    char.setHeadVisible(this.person === 'third');
  }

  // Plano cinematográfico da batalha: lateral aos dois combatentes (a: atacante, b: vítima; Vector3 mundo)
  cinematic(a, b, dur = 0.7) {
    _d.subVectors(b, a);
    const len = Math.max(0.5, _d.length());
    _d.normalize();
    _side.crossVectors(UP, _d).normalize();
    // fica do lado mais próximo da câmera atual
    if (_side.dot(this.basePos) < 0) _side.negate();
    _look.copy(a).lerp(b, 0.5); _look.y += 1.0;
    _p.copy(_look).addScaledVector(_side, 3.4 + len * 0.9).addScaledVector(_d, -0.6);
    _p.y = 3.4; // acima das cabeças, para outros personagens não taparem a cena
    lookQuat(_p, _look, _tmp.quaternion);
    return this._startTween(_p, _tmp.quaternion, 50, dur, 'cinematic');
  }

  look(dyaw, dpitch) {
    if (this.mode !== 'firstperson' && this.mode !== 'roam') return;
    this.dyaw = THREE.MathUtils.clamp(this.dyaw + dyaw, -CAMERA.yawLimit, CAMERA.yawLimit);
    this.dpitch = THREE.MathUtils.clamp(this.dpitch + dpitch, CAMERA.pitchMin, CAMERA.pitchMax);
  }

  shake(amp, dur) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeDur = dur;
    this.shakeT = 0;
  }

  get busy() { return !!this.transition || this.shakeT < this.shakeDur; }

  update(dt) {
    let changed = false;
    if (this.transition) {
      const tr = this.transition;
      tr.t = Math.min(tr.dur, tr.t + dt);
      const k = ease(tr.t / tr.dur);
      // Voando para um personagem: o alvo acompanha os olhos dele (ele pode estar se mexendo)
      if (tr.next === 'firstperson' && this._pendingFollow) this._fpPose(this._pendingFollow, this._p1, this._q1);
      this.basePos.lerpVectors(this._p0, this._p1, k);
      this.baseQuat.slerpQuaternions(this._q0, this._q1, k);
      this.camera.fov = tr.f0 + (tr.f1 - tr.f0) * k;
      this.camera.updateProjectionMatrix();
      changed = true;
      if (tr.t >= tr.dur) {
        this.transition = null;
        this.mode = tr.next;
        if (tr.next === 'firstperson' && this._pendingFollow) {
          this.followChar(this._pendingFollow);
          this._pendingFollow = null;
        }
        tr.resolve();
      }
    } else if (this.mode === 'firstperson' && this.follow) {
      if (this.person === 'third') {
        // suaviza o balanço da caminhada e os golpes
        this._tpPose(this.follow, _tp, _tq);
        const k = 1 - Math.exp(-TP.smooth * dt);
        this.basePos.lerp(_tp, k);
        this.baseQuat.slerp(_tq, k);
      } else {
        this._fpPose(this.follow, this.basePos, this.baseQuat);
      }
      changed = true;
    } else if (this.mode === 'roam') {
      this.roamT += dt;
      this._roamPose(this.side, this.roamT, this.basePos, this.baseQuat);
      changed = true;
    }
    this.camera.position.copy(this.basePos);
    this.camera.quaternion.copy(this.baseQuat);
    if (this.shakeT < this.shakeDur) {
      this.shakeT += dt;
      this.shakeTime += dt;
      const k = 1 - this.shakeT / this.shakeDur;
      const a = this.shakeAmp * k * k;
      const t = this.shakeTime * 40;
      this.camera.position.x += wob(t, 1.0, 2.3, 3.7) * a;
      this.camera.position.y += wob(t, 1.7, 2.9, 4.1) * a * 0.7;
      this.camera.rotateZ(wob(t, 1.3, 2.1, 3.3) * a * 0.05);
      if (this.shakeT >= this.shakeDur) this.shakeAmp = 0;
      changed = true;
    }
    return changed;
  }

  onResize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
