// Vitrine da tela de escolha: o kart 3D do cientista selecionado girando devagar.
import * as THREE from './three.js';
import { createKartModel } from './models.js';

export class KartPreview {
  constructor(canvas, { quality }) {
    this.canvas = canvas;
    this.quality = quality;
    this.models = new Map();
    this.current = null;
    this.active = false;
    this.angle = -0.6;
    this.time = 0;
    this.ok = false;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.ok = true;
    } catch (err) {
      console.warn('vitrine 3D indisponível', err);
      return;
    }
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a4a3a, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 5, 4);
    this.scene.add(sun);
    // base giratória verde Quanta
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 1.7, 0.12, 48),
      new THREE.MeshStandardMaterial({ color: 0x16a86a, roughness: 0.5, metalness: 0.1 }),
    );
    base.position.y = -0.06;
    this.turntable = new THREE.Group();
    this.turntable.add(base);
    this.scene.add(this.turntable);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(0, 1.8, 4.3);
    this.camera.lookAt(0, 0.7, 0);
    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
  }

  setCharacter(id) {
    if (!this.ok || id === this.currentId) return;
    this.currentId = id;
    if (this.current) this.turntable.remove(this.current.group);
    let m = this.models.get(id);
    if (!m) {
      m = createKartModel(id, { quality: this.quality });
      this.models.set(id, m);
    }
    this.current = m;
    this.turntable.add(m.group);
    this.pop = 0; // pequeno "pulo" ao trocar
  }

  setActive(on) {
    if (!this.ok || on === this.active) return;
    this.active = on;
    if (on) {
      this.clock.getDelta();
      requestAnimationFrame(this.loop);
    }
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return false;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    return true;
  }

  loop() {
    if (!this.active) return;
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    if (!this.resize()) return;
    this.angle += dt * 0.7;
    this.turntable.rotation.y = this.angle;
    if (this.current) {
      this.pop = Math.min(1, (this.pop ?? 1) + dt * 3);
      const s = 0.9 + 0.1 * Math.sin(this.pop * Math.PI * 0.5);
      this.current.group.scale.setScalar(s);
      this.current.group.position.y = 0.04 * Math.sin(this.time * 2.2);
      this.current.update?.(dt, {
        speed: 6, steer: Math.sin(this.time * 0.8) * 0.4, drifting: false, driftDir: 0,
        onGround: true, boosting: false, stunned: false, time: this.time,
      });
    }
    this.renderer.render(this.scene, this.camera);
  }
}
