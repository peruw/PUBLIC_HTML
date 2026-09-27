// Entrada: toque/clique com raycast (peça ou casa), arrasto para olhar em 1ª pessoa, Esc.
import * as THREE from './three.js';

const TAP_PX = 8;
const TAP_MS = 400;

export class Input {
  constructor({ dom, camera, getPickables, onTap, onLook, onEscape }) {
    this.dom = dom;
    this.camera = camera;
    this.getPickables = getPickables;
    this.onTap = onTap;
    this.onLook = onLook;
    this.onEscape = onEscape;
    this.enabled = true;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.down = null;
    this.dragging = false;

    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      this.down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, lx: e.clientX, ly: e.clientY };
      this.dragging = false;
      try { dom.setPointerCapture(e.pointerId); } catch (_) { /* ignora */ }
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.down || e.pointerId !== this.down.id) return;
      const dx = e.clientX - this.down.lx, dy = e.clientY - this.down.ly;
      this.down.lx = e.clientX; this.down.ly = e.clientY;
      if (!this.dragging && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > TAP_PX) this.dragging = true;
      if (this.dragging && this.enabled) this.onLook(-dx * 0.004, -dy * 0.004);
    });
    const up = (e) => {
      if (!this.down || e.pointerId !== this.down.id) return;
      const d = this.down; this.down = null;
      try { dom.releasePointerCapture(e.pointerId); } catch (_) { /* ignora */ }
      if (this.dragging || performance.now() - d.t > TAP_MS) return;
      if (!this.enabled) return;
      this._tap(e.clientX, e.clientY);
    };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', () => { this.down = null; });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.onEscape();
    });
  }

  _tap(x, y) {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.getPickables(), true);
    if (!hits.length) { this.onTap({ sq: -1, piece: null }); return; }
    const h = hits[0];
    if (h.object.userData && h.object.userData.pieceGroup) {
      const g = h.object.userData.pieceGroup;
      this.onTap({ sq: g.userData.sq, piece: g });
    } else if (h.instanceId !== undefined) {
      this.onTap({ sq: h.instanceId, piece: null });
    } else {
      this.onTap({ sq: -1, piece: null });
    }
  }
}
