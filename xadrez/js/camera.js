// Câmera: vista de cima (overhead) e primeira pessoa (olhos da peça), com tweens suaves,
// olhar por arrasto em 1ª pessoa, seguir a peça durante o lance e tremor.
import * as THREE from './three.js';
import { CAMERA } from './config.js';

const _p = new THREE.Vector3();
const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _tmp = new THREE.Object3D();
const _m = new THREE.Matrix4();
// Orientação de câmera (olha por -Z) de `eye` para `target`
function lookQuat(eye, target, out) {
  _m.lookAt(eye, target, UP);
  return out.setFromRotationMatrix(_m);
}
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wob = (t, a, b, c) => Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 2.1) * 0.2;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'overhead';   // 'overhead' | 'firstperson'
    this.transition = null;   // { p0, p1, q0, q1, f0, f1, t, dur, resolve, next }
    this.side = 'w';
    this.follow = null;       // Group seguido em 1ª pessoa
    this.followEye = 0;
    this.yaw = 0; this.pitch = 0;      // olhar base em 1ª pessoa
    this.dyaw = 0; this.dpitch = 0;    // deslocamento por arrasto
    this.shakeT = 0; this.shakeDur = 0; this.shakeAmp = 0; this.shakeTime = 0;
    this.fadeAlpha = 0;
    this.basePos = new THREE.Vector3();
    this.baseQuat = new THREE.Quaternion();
    this._p0 = new THREE.Vector3(); this._p1 = new THREE.Vector3();
    this._q0 = new THREE.Quaternion(); this._q1 = new THREE.Quaternion();
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
    this.follow = null;
    this.overheadPose(side, this.basePos, this.baseQuat);
    this.camera.position.copy(this.basePos);
    this.camera.quaternion.copy(this.baseQuat);
    this.camera.fov = CAMERA.overheadFov;
    this.camera.updateProjectionMatrix();
  }

  _startTween(p1, q1, f1, dur, next) {
    return new Promise((resolve) => {
      if (this.transition) { const t = this.transition; this.transition = null; t.resolve(); }
      this._p0.copy(this.basePos);
      this._q0.copy(this.baseQuat);
      this._p1.copy(p1);
      this._q1.copy(q1);
      this.transition = { f0: this.camera.fov, f1, t: 0, dur, resolve, next };
      this.follow = null;
      this.dyaw = 0; this.dpitch = 0;
    });
  }

  flyToOverhead(side = this.side) {
    this.side = side;
    this.overheadPose(side, _p, _tmp.quaternion);
    return this._startTween(_p, _tmp.quaternion, CAMERA.overheadFov, CAMERA.flyDur, 'overhead');
  }

  // Voa para os olhos da peça. eye: altura dos olhos. A peça olha para o lado inimigo.
  flyToPiece(group, eye) {
    const s = group.userData.color === 'w' ? -1 : 1; // frente: -Z para brancas
    _p.copy(group.position); _p.y += eye;
    _look.set(group.position.x * 0.6, 0.9, group.position.z + s * 9);
    lookQuat(_p, _look, _tmp.quaternion);
    const pr = this._startTween(_p, _tmp.quaternion, CAMERA.firstPersonFov, CAMERA.flyDur, 'firstperson');
    this.followEye = eye;
    this._pendingFollow = group;
    return pr;
  }

  // Em 1ª pessoa: a câmera acompanha a peça (usado nas animações)
  followPiece(group, eye) {
    this.follow = group;
    this.followEye = eye;
  }

  look(dyaw, dpitch) {
    if (this.mode !== 'firstperson') return;
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
      this.basePos.lerpVectors(this._p0, this._p1, k);
      this.baseQuat.slerpQuaternions(this._q0, this._q1, k);
      this.camera.fov = tr.f0 + (tr.f1 - tr.f0) * k;
      this.camera.updateProjectionMatrix();
      changed = true;
      if (tr.t >= tr.dur) {
        this.transition = null;
        this.mode = tr.next;
        if (tr.next === 'firstperson') {
          _e.setFromQuaternion(this.baseQuat, 'YXZ');
          this.yaw = _e.y; this.pitch = _e.x;
          if (this._pendingFollow) { this.follow = this._pendingFollow; this._pendingFollow = null; }
        }
        tr.resolve();
      }
    } else if (this.mode === 'firstperson') {
      if (this.follow) {
        this.basePos.copy(this.follow.position);
        this.basePos.y += this.followEye;
        changed = true;
      }
      _e.set(this.pitch + this.dpitch, this.yaw + this.dyaw, 0, 'YXZ');
      this.baseQuat.setFromEuler(_e);
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
