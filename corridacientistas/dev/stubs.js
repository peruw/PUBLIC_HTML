// Stubs de teste: uma pista oval simples que implementa a interface Track,
// um modelo de kart em caixa e um kart que anda sozinho pela linha central.
// Servem para testar cada módulo isoladamente (ver ARCHITECTURE.md).
import * as THREE from '../js/three.js';
import { CHARACTERS } from '../js/config.js';

const UP = new THREE.Vector3(0, 1, 0);

export function buildStubTrack(scene) {
  // Linha central: oval com ondulação e subida/descida suave.
  const dense = [];
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const r = 1 + 0.12 * Math.sin(3 * t);
    dense.push(new THREE.Vector3(Math.sin(t) * 150 * r, 3 + 3 * Math.sin(2 * t), Math.cos(t) * 90 * r));
  }
  // Sentido anti-horário visto de cima => pista vira para a esquerda; tudo bem para teste.
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + dense[i % N].distanceTo(dense[i - 1]));
  const length = cum[N];
  const STEP = 1;
  const count = Math.floor(length / STEP);
  const pts = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * length;
    while (cum[j + 1] < target) j++;
    const f = (target - cum[j]) / (cum[j + 1] - cum[j]);
    pts.push(dense[j].clone().lerp(dense[(j + 1) % N], f));
  }
  const ds = length / count;
  const tangents = pts.map((p, i) => pts[(i + 1) % count].clone().sub(pts[(i - 1 + count) % count]).normalize());
  const rights = tangents.map((t) => new THREE.Vector3(-t.z, 0, t.x).normalize());
  const headings = tangents.map((t) => Math.atan2(t.x, t.z));
  const HALF = 9;
  const WALL = 15;

  const _s = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: UP.clone(), halfWidth: HALF, wallDist: WALL };
  const wrap = (s) => ((s % length) + length) % length;
  function sample(s) {
    s = wrap(s);
    const fi = s / ds;
    const i = Math.floor(fi) % count;
    const n = (i + 1) % count;
    const f = fi - Math.floor(fi);
    _s.pos.copy(pts[i]).lerp(pts[n], f);
    _s.tangent.copy(tangents[i]).lerp(tangents[n], f).normalize();
    _s.right.copy(rights[i]).lerp(rights[n], f).normalize();
    return _s;
  }

  const _d = new THREE.Vector3();
  const _p = { s: 0, lateral: 0, groundY: 0, normal: UP.clone(), halfWidth: HALF, wallDist: WALL, offroad: false };
  function project(pos, hintS) {
    let best = -1;
    let bestD = Infinity;
    if (hintS === undefined) {
      for (let i = 0; i < count; i++) {
        const dx = pos.x - pts[i].x, dz = pos.z - pts[i].z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    } else {
      const c = Math.round(wrap(hintS) / ds);
      for (let k = -40; k <= 40; k++) {
        const i = (c + k + count) % count;
        const dx = pos.x - pts[i].x, dz = pos.z - pts[i].z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    _d.copy(pos).sub(pts[best]);
    const along = _d.x * tangents[best].x + _d.z * tangents[best].z;
    const s = wrap(best * ds + along);
    const smp = sample(s);
    _d.copy(pos).sub(smp.pos);
    _p.s = s;
    _p.lateral = _d.x * smp.right.x + _d.z * smp.right.z;
    _p.groundY = smp.pos.y;
    _p.offroad = Math.abs(_p.lateral) > HALF;
    return _p;
  }

  function curvature(s) {
    const a = headings[Math.floor(wrap(s - 4) / ds) % count];
    const b = headings[Math.floor(wrap(s + 4) / ds) % count];
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return -d / 8;
  }
  const racingLine = (s) => THREE.MathUtils.clamp(curvature(s + 10) * 300, -6, 6);

  // Grid: 2 colunas escalonadas atrás da linha de chegada.
  const gridSlots = [];
  for (let i = 0; i < 8; i++) {
    const s = wrap(-8 - i * 5);
    const smp = sample(s);
    const lat = i % 2 === 0 ? -3.5 : 3.5;
    const pos = smp.pos.clone().addScaledVector(smp.right, lat);
    gridSlots.push({ pos, heading: Math.atan2(smp.tangent.x, smp.tangent.z), s });
  }
  const itemBoxSlots = [];
  for (const s of [120, 420]) {
    for (let k = -2; k <= 2; k++) {
      const smp = sample(s);
      itemBoxSlots.push({ pos: smp.pos.clone().addScaledVector(smp.right, k * 3.2).add(new THREE.Vector3(0, 1.2, 0)), s });
    }
  }
  const boostPads = [{ s: 250, lateral: 0, length: 8, width: 4 }];
  const ramps = [{ s: 330, lateral: 0, length: 6, width: 10, launch: 8 }];
  const minimapPoints = [];
  for (let i = 0; i < 256; i++) {
    const p = sample((i / 256) * length).pos;
    minimapPoints.push({ x: p.x, z: p.z });
  }

  // Visual simples.
  const group = new THREE.Group();
  const ribbon = (inner, outer, color, dy) => {
    const pos = [];
    const idx = [];
    for (let i = 0; i <= count; i++) {
      const k = i % count;
      const a = pts[k].clone().addScaledVector(rights[k], inner);
      const b = pts[k].clone().addScaledVector(rights[k], outer);
      pos.push(a.x, a.y + dy, a.z, b.x, b.y + dy, b.z);
      if (i < count) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    group.add(m);
  };
  ribbon(-HALF, HALF, 0x555a60, 0.0);
  ribbon(-WALL, -HALF, 0x5da545, -0.02);
  ribbon(HALF, WALL, 0x5da545, -0.02);
  for (const side of [-1, 1]) {
    const wp = [];
    for (let i = 0; i <= count; i += 2) {
      const p = pts[i % count].clone().addScaledVector(rights[i % count], side * WALL);
      wp.push(p.x, p.y + 0.6, p.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff3333 })));
  }
  const padMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 8), new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
  const ps = sample(250);
  padMesh.position.copy(ps.pos).add(new THREE.Vector3(0, 0.03, 0));
  padMesh.rotation.set(-Math.PI / 2, 0, Math.atan2(ps.tangent.x, ps.tangent.z));
  group.add(padMesh);
  const rampMesh = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 6), new THREE.MeshLambertMaterial({ color: 0x3399ff }));
  const rs = sample(330);
  rampMesh.position.copy(rs.pos).add(new THREE.Vector3(0, 0.2, 0));
  rampMesh.rotation.y = Math.atan2(rs.tangent.x, rs.tangent.z);
  group.add(rampMesh);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshLambertMaterial({ color: 0x3f7f35 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  group.add(ground);
  scene.add(group);

  return {
    name: 'Pista de teste', length, sample, project, curvature, racingLine,
    gridSlots, itemBoxSlots, boostPads, ramps, minimapPoints, update() {},
  };
}

export function stubLights(scene) {
  scene.background = new THREE.Color(0x8fd3ff);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x446633, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(50, 100, 30);
  scene.add(sun);
}

export function createStubKartModel(characterId) {
  const c = CHARACTERS.find((x) => x.id === characterId) || CHARACTERS[0];
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 1.8), new THREE.MeshLambertMaterial({ color: c.colors.kart }));
  body.position.y = 0.45;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshLambertMaterial({ color: c.look.skin }));
  head.position.set(0, 1.35, -0.2);
  group.add(head);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  nose.position.set(0, 0.6, 0.95);
  group.add(nose);
  return { group, update() {} };
}

// Kart de teste: segue a linha central na velocidade `cruise`, implementa a
// interface mínima usada por itens, efeitos, câmera e áudio.
export class StubKart {
  constructor({ character, isPlayer = false, index = 0, bus, track, cruise = 20, lateral = 0 }) {
    this.character = character;
    this.isPlayer = isPlayer;
    this.index = index;
    this.bus = bus;
    this.track = track;
    this.object3d = new THREE.Group();
    this.visual = new THREE.Group();
    this.object3d.add(this.visual);
    this.model = createStubKartModel(character.id);
    this.visual.add(this.model.group);
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.vy = 0;
    this.s = 0;
    this.lateral = lateral;
    this.cruise = cruise;
    this.onGround = true;
    this.offroad = false;
    this.airTime = 0;
    this.controls = { throttle: 0, brake: 0, steer: 0, drift: false, useItem: false, lookBack: false };
    this.drifting = false; this.driftDir = 0; this.driftLevel = 0;
    this.boostTime = 0; this.starTime = 0; this.shrinkTime = 0; this.spinTime = 0; this.tumbleTime = 0;
    this.frozen = false; this.speedFactor = 1;
    this.item = null; this.itemCount = 0; this.roulette = null;
    this.lap = 1; this.progress = 0; this.place = index + 1; this.finished = false; this.finishTime = 0;
  }
  get maxSpeed() { return this.cruise * (this.boostTime > 0 ? 1.35 : 1) * (this.shrinkTime > 0 ? 0.7 : 1); }
  get invincible() { return this.starTime > 0; }
  get stunned() { return this.spinTime > 0 || this.tumbleTime > 0; }
  placeAt(slot) { this.s = slot.s; this.position.copy(slot.pos); this.heading = slot.heading; this.speed = 0; }
  applyBoost(duration, strength = 1, source = 'item') {
    this.boostTime = Math.max(this.boostTime, duration);
    this.bus?.emit('kart:boost', { kart: this, source, duration });
  }
  hit(type, by) {
    if (this.invincible) return;
    if (type === 'tumble') this.tumbleTime = 1.6; else this.spinTime = 1.1;
    this.boostTime = 0;
    this.bus?.emit('kart:hit', { kart: this, type, by });
  }
  shrink(d) { if (!this.invincible) this.shrinkTime = d; }
  update(dt) {
    for (const k of ['boostTime', 'starTime', 'shrinkTime', 'spinTime', 'tumbleTime']) this[k] = Math.max(0, this[k] - dt);
    if (this.frozen) return;
    const target = this.stunned ? 2 : this.maxSpeed;
    this.speed += (target - this.speed) * Math.min(1, dt * 2);
    this.s = (this.s + this.speed * dt) % this.track.length;
    const smp = this.track.sample(this.s);
    this.position.copy(smp.pos).addScaledVector(smp.right, this.lateral);
    this.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
    this.velocity.copy(smp.tangent).multiplyScalar(this.speed);
    this.object3d.position.copy(this.position);
    this.object3d.rotation.y = this.heading;
    this.visual.rotation.y = this.spinTime > 0 ? this.spinTime * 12 : 0;
    this.visual.rotation.x = this.tumbleTime > 0 ? this.tumbleTime * 8 : 0;
    const sc = this.shrinkTime > 0 ? 0.55 : 1;
    this.visual.scale.setScalar(sc);
  }
}

// Monta cena básica + renderer + loop. Retorna { scene, camera, renderer, track, onFrame }.
export function stubScene({ withTrack = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.style.margin = '0';
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 2000);
  stubLights(scene);
  const track = withTrack ? buildStubTrack(scene) : null;
  const frames = [];
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    for (const f of frames) f(dt, clock.elapsedTime);
    renderer.render(scene, camera);
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  return { scene, camera, renderer, track, onFrame: (f) => frames.push(f) };
}
