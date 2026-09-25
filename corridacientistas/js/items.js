// Sistema de itens: caixas com átomo, roleta, uso dos itens e projéteis/armadilhas
// (maçã, partícula alfa, elétron teleguiado, buraco negro...). Tudo procedural.
import * as THREE from './three.js';
import { ITEMS, ITEM_IDS, RACE } from './config.js';
import { SpriteBatch, SHAPE, mergeGeometries, paint, buildFlameGeometry } from './effects.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const easeOutBack = (t) => {
  const c1 = 2.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const MAX_APPLES = 14;
const MAX_ALFA = 16;
const MAX_ELETRON = 16;
const MAX_HOLES = 3;
const BOX_SIZE = 1.3;
const BOX_RADIUS = 1.8; // raio de coleta
const APPLE_HIT = 1.3;
const PROJ_HIT = 1.5;

// temporários (sem alocação por quadro)
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _col = new THREE.Color();
const _v2d = new THREE.Vector2();
const OPT_SMOKE_S = { scale: 0.35 }; // opções reutilizadas (sem alocar por quadro)

// ---------------------------------------------------------------------------
// Geometrias procedurais
// ---------------------------------------------------------------------------

// Cubo arredondado (soma de Minkowski de um cubo menor com uma esfera), lado 1.
function roundedBox(r, N) {
  const g = new THREE.BoxGeometry(1, 1, 1, N, N, N);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const inner = 0.5 - r;
  const K = 5;
  for (let i = 0; i < p.count; i++) {
    _v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    p.setXYZ(
      i,
      inner * clamp(_v.x * K, -1, 1) + r * _v.x,
      inner * clamp(_v.y * K, -1, 1) + r * _v.y,
      inner * clamp(_v.z * K, -1, 1) + r * _v.z,
    );
    n.setXYZ(i, _v.x, _v.y, _v.z);
  }
  g.deleteAttribute('uv');
  return g;
}

// Núcleo: 2 prótons vermelhos + 2 nêutrons cinzas num tetraedro.
function nucleusGeometry(r, d, seg = 10) {
  const parts = [];
  const pts = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  pts.forEach((p, i) => {
    const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 3));
    const k = d / Math.sqrt(3);
    g.translate(p[0] * k, p[1] * k, p[2] * k);
    paint(g, i % 2 === 0 ? 0xff3b30 : 0xd9dde6);
    parts.push(g);
  });
  return mergeGeometries(parts);
}

// Maçã: perfil torneado com covinhas, cabinho e folha.
function appleGeometry() {
  const pts = [];
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI; // 0 = base, PI = topo
    let x = Math.sin(th) * (1 + 0.1 * -Math.cos(th));
    let y = -Math.cos(th) * 0.86;
    y -= 0.3 * Math.exp(-Math.pow((Math.PI - th) / 0.42, 2)); // covinha de cima
    y += 0.12 * Math.exp(-Math.pow(th / 0.35, 2)); // covinha de baixo
    if (i === 0 || i === N) x = 0;
    pts.push(new THREE.Vector2(Math.max(0, x) * 0.42, y * 0.42));
  }
  const body = new THREE.LatheGeometry(pts, 22);
  body.deleteAttribute('uv');
  const p = body.attributes.position;
  const col = new Float32Array(p.count * 3);
  const dark = new THREE.Color(0x9e0f1a);
  const red = new THREE.Color(0xe0262f);
  const blush = new THREE.Color(0xf5a33a);
  for (let i = 0; i < p.count; i++) {
    const t = clamp((p.getY(i) / 0.42 + 0.86) / 1.5, 0, 1);
    _col.copy(dark).lerp(red, t);
    // mancha amarelada de um lado
    const side = Math.max(0, p.getX(i) / 0.42) * Math.max(0, 1 - Math.abs(p.getY(i) / 0.42 - 0.1) * 1.6);
    _col.lerp(blush, side * 0.35);
    col[i * 3] = _col.r; col[i * 3 + 1] = _col.g; col[i * 3 + 2] = _col.b;
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stem = new THREE.CylinderGeometry(0.022, 0.03, 0.22, 6);
  stem.deleteAttribute('uv');
  stem.rotateZ(-0.25);
  stem.translate(0.02, 0.33, 0);
  paint(stem, 0x5a3a1c);
  const leaf = new THREE.SphereGeometry(0.13, 8, 5);
  leaf.deleteAttribute('uv');
  leaf.scale(1, 0.22, 0.48);
  leaf.rotateZ(0.5);
  leaf.translate(0.13, 0.36, 0.02);
  paint(leaf, 0x3fae3a);
  return mergeGeometries([body, stem, leaf]);
}

// Foguete: corpo branco, bico e aletas vermelhas, bocal escuro, janelinha azul. Aponta para +Z.
function rocketGeometry() {
  const P = [];
  const add = (g, c) => { g.deleteAttribute('uv'); paint(g, c); P.push(g); };
  const body = new THREE.CylinderGeometry(0.14, 0.14, 0.72, 14);
  body.rotateX(Math.PI / 2);
  add(body, 0xf4f4f4);
  const band = new THREE.CylinderGeometry(0.147, 0.147, 0.08, 14);
  band.rotateX(Math.PI / 2);
  band.translate(0, 0, 0.18);
  add(band, 0xe63946);
  const nose = new THREE.ConeGeometry(0.14, 0.32, 14);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, 0.52);
  add(nose, 0xe63946);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.BoxGeometry(0.025, 0.2, 0.26);
    fin.translate(0, 0.2, -0.24);
    fin.rotateZ((k * Math.PI) / 2 + Math.PI / 4);
    add(fin, 0xe63946);
  }
  const noz = new THREE.CylinderGeometry(0.09, 0.12, 0.12, 12);
  noz.rotateX(-Math.PI / 2);
  noz.translate(0, 0, -0.42);
  add(noz, 0x3a3d45);
  const win = new THREE.SphereGeometry(0.06, 10, 8);
  win.translate(0, 0.115, 0.3);
  add(win, 0x4cc9f0);
  // cintas que prendem no kart
  for (const z of [-0.12, 0.12]) {
    const strap = new THREE.TorusGeometry(0.152, 0.02, 4, 16);
    strap.translate(0, 0, z);
    add(strap, 0x2b2b2b);
  }
  return mergeGeometries(P);
}

// Pilha de Volta: discos de cobre/feltro/zinco entre placas de madeira com hastes de vidro.
function voltaGeometry() {
  const P = [];
  const add = (g, c) => { g.deleteAttribute('uv'); paint(g, c); P.push(g); };
  let y = 0;
  const plate = () => {
    const g = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14);
    g.translate(0, y + 0.025, 0);
    add(g, 0x8b5a2b);
    y += 0.05;
  };
  plate();
  const seq = [0xd9822b, 0x6b4f3a, 0xb8c2cc, 0xd9822b, 0x6b4f3a, 0xb8c2cc, 0xd9822b, 0x6b4f3a, 0xb8c2cc];
  for (const c of seq) {
    const h = c === 0x6b4f3a ? 0.025 : 0.045;
    const g = new THREE.CylinderGeometry(0.15, 0.15, h, 14);
    g.translate(0, y + h / 2, 0);
    add(g, c);
    y += h;
  }
  plate();
  for (let k = 0; k < 3; k++) {
    const a = (k * TAU) / 3;
    const g = new THREE.CylinderGeometry(0.016, 0.016, y, 5);
    g.translate(Math.cos(a) * 0.18, y / 2, Math.sin(a) * 0.18);
    add(g, 0xcfe8ff);
  }
  // fio de cobre em arco saindo do topo
  const wire = new THREE.TorusGeometry(0.16, 0.012, 4, 14, Math.PI);
  wire.rotateY(Math.PI / 2);
  wire.translate(0, y, 0);
  add(wire, 0xff9b3d);
  const m = mergeGeometries(P);
  m.translate(0, -y / 2, 0);
  return m;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------
const BOX_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
#include <fog_pars_vertex>
void main() {
  vec4 lp = vec4(position, 1.0);
  vec3 ln = normal;
  #ifdef USE_INSTANCING
    lp = instanceMatrix * lp;
    ln = mat3(instanceMatrix) * ln;
  #endif
  vec4 mvPosition = modelViewMatrix * lp;
  vN = normalMatrix * ln;
  vV = -mvPosition.xyz;
  vP = position;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const BOX_FS = /* glsl */ `
uniform float uTime;
uniform float uBack;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
#include <fog_pars_fragment>
vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  float ndv = abs(dot(n, v));
  float fr = pow(1.0 - ndv, 2.0);
  vec3 a = abs(vP);
  float mx = max(a.x, max(a.y, a.z));
  float mn = min(a.x, min(a.y, a.z));
  float m2 = a.x + a.y + a.z - mx - mn; // 2ª maior coordenada: perto das arestas
  float edge = smoothstep(0.32, 0.46, m2);
  float h = dot(vP, vec3(0.9, 1.4, 0.7)) + uTime * 0.22 + fr * 0.7;
  vec3 rainbow = hue(fract(h));
  vec3 L = normalize(vec3(0.35, 0.85, 0.4));
  float spec = pow(max(dot(reflect(-v, n), L), 0.0), 28.0);
  vec3 col = mix(vec3(0.9, 0.95, 1.0), rainbow, 0.9) * (0.5 + fr * 0.9 + edge * 1.4) + spec;
  float alpha = 0.2 + fr * 0.5 + edge * 0.65 + spec * 0.6;
  if (uBack > 0.5) { alpha *= 0.5; col *= 0.8; }
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const DISK_VS = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const DISK_FS = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vP;
void main() {
  float r = length(vP);
  float t = clamp((r - 0.72) / (2.3 - 0.72), 0.0, 1.0);
  float a = atan(vP.y, vP.x);
  float sw = sin(a * 3.0 + 5.0 / (r + 0.15) - uTime * 6.0) * 0.5 + 0.5;
  float sw2 = sin(a * 7.0 - 9.0 / (r + 0.3) - uTime * 9.0) * 0.5 + 0.5;
  float b = mix(sw, sw2, 0.35);
  vec3 hot = vec3(1.0, 0.86, 0.55);
  vec3 orange = vec3(1.0, 0.38, 0.05);
  vec3 purple = vec3(0.42, 0.08, 0.85);
  vec3 col = mix(mix(hot, orange, smoothstep(0.0, 0.25, t)), purple, smoothstep(0.25, 0.8, t));
  col *= 0.75 + 0.5 * b;
  float inner = smoothstep(0.0, 0.05, t);
  float outer = 1.0 - smoothstep(0.45, 1.0, t);
  float alpha = inner * outer * (0.45 + 0.55 * b) * uAlpha;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SWIRL_VS = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uViewH;
uniform float uSpeed;
varying float vT;
void main() {
  float ph = fract(uTime * uSpeed * (0.35 + aSeed.x * 0.5) + aSeed.y);
  float r = mix(2.9, 0.62, ph);
  float ang = aSeed.z * 6.2832 + ph * 6.5 + uTime * 1.5;
  vec3 p = vec3(cos(ang) * r, sin(ang) * r, (aSeed.w - 0.5) * 0.6 * (1.0 - ph));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (0.1 + 0.1 * aSeed.w) * projectionMatrix[1][1] * uViewH * 0.5 / max(0.1, -mv.z);
  vT = ph;
  gl_Position = projectionMatrix * mv;
}`;
const SWIRL_FS = /* glsl */ `
varying float vT;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = 1.0 - d * 2.0;
  a *= a;
  vec3 col = mix(vec3(0.45, 0.12, 1.0), vec3(1.0, 0.5, 0.1), vT);
  float fade = smoothstep(0.0, 0.15, vT) * (1.0 - smoothstep(0.85, 1.0, vT));
  gl_FragColor = vec4(col, a * fade * 0.85);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------------------
// ItemSystem
// ---------------------------------------------------------------------------
export class ItemSystem {
  constructor({ scene, track, bus, effects, quality }) {
    this.scene = scene;
    this.track = track;
    this.bus = bus;
    this.effects = effects || null;
    this.quality = quality || { particles: 1 };
    this.lowQ = this.quality.id === 'baixa';
    this.root = new THREE.Group();
    this.root.name = 'items';
    scene.add(this.root);
    this.time = 0;
    this.karts = [];
    this.world = null;
    this.hazards = [];
    this._warm = false;
    this._viewH = 720;

    // brilhos aditivos (núcleos, elétrons, projéteis) num único draw call
    this.glows = new SpriteBatch(360, { additive: true, renderOrder: 13 });
    this.root.add(this.glows.mesh);

    this._buildBoxes();
    this._buildApples();
    this._buildProjectiles();
    this._buildHoles();
    this._buildRockets();
    this._buildBatteries();
  }

  // ------------------------------------------------------------ construção
  _instanced(geo, mat, count, renderOrder = 0) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.renderOrder = renderOrder;
    m.count = 0;
    m.visible = false;
    this.root.add(m);
    return m;
  }

  _buildBoxes() {
    const slots = this.track?.itemBoxSlots || [];
    this.boxes = slots.map((sl, i) => ({
      pos: sl.pos.clone(), s: sl.s, alive: true, timer: 0, pop: 1, phase: i * 1.713,
    }));
    const N = this.boxes.length;
    const shellGeo = roundedBox(0.2, this.lowQ ? 6 : 8);
    const mk = (back) => new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uBack: { value: back ? 1 : 0 } }]),
      vertexShader: BOX_VS, fragmentShader: BOX_FS,
      transparent: true, depthWrite: false, fog: true,
      side: back ? THREE.BackSide : THREE.FrontSide,
    });
    this.boxMats = [mk(true), mk(false)];
    this.boxBack = this._instanced(shellGeo, this.boxMats[0], N, 1);
    this.boxFront = this._instanced(shellGeo, this.boxMats[1], N, 3);
    this.boxFront.instanceMatrix = this.boxBack.instanceMatrix; // mesma matriz para as duas faces
    const glowMat = (c) => new THREE.MeshBasicMaterial({ color: c });
    this.boxNucleus = this._instanced(nucleusGeometry(0.075, 0.12, this.lowQ ? 7 : 9), new THREE.MeshBasicMaterial({ vertexColors: true }), N);
    this.boxOrbits = this._instanced(new THREE.TorusGeometry(0.4, 0.018, 4, this.lowQ ? 28 : 40), glowMat(0x8fe4ff), N * 3);
    this.boxElectrons = this._instanced(new THREE.SphereGeometry(0.06, 8, 6), glowMat(0xeafcff), N * 3);
    // rotações fixas das 3 órbitas (60° entre si)
    this._orbitQ = [0, 1, 2].map((k) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, (k * Math.PI) / 3)));
  }

  _buildApples() {
    this.apples = [];
    for (let i = 0; i < MAX_APPLES; i++) {
      const pos = new THREE.Vector3();
      this.apples.push({
        active: false, pos, from: new THREE.Vector3(), to: new THREE.Vector3(), s: 0, ground: 0,
        owner: null, age: 0, immune: 0, t: 0, landed: false, phase: 0, squash: 0,
        hazard: { position: pos, s: 0, radius: 1.0, type: 'maca', lateral: 0 },
      });
    }
    this.appleMesh = this._instanced(
      appleGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.05, emissive: 0x220000 }),
      MAX_APPLES,
    );
  }

  _buildProjectiles() {
    this.projs = [];
    const mk = (type) => {
      const pos = new THREE.Vector3();
      return {
        type, active: false, pos, prev: new THREE.Vector3(), vel: new THREE.Vector3(),
        s: 0, lateral: 0, owner: null, target: null, age: 0, life: 8, immune: 0.4,
        mode: 'straight', speed: 48, h: 0.65, spin: 0,
        hazard: { position: pos, s: 0, radius: 1.0, type, lateral: 0 },
      };
    };
    for (let i = 0; i < MAX_ALFA; i++) this.projs.push(mk('alfa'));
    for (let i = 0; i < MAX_ELETRON; i++) this.projs.push(mk('eletron'));
    this.alfaMesh = this._instanced(
      nucleusGeometry(0.2, 0.3, 12),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1, emissive: 0x3a1400 }),
      MAX_ALFA,
    );
    this.eCore = this._instanced(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: 0x46b8ff }), MAX_ELETRON);
    this.eRing = this._instanced(
      new THREE.TorusGeometry(0.62, 0.035, 6, 40),
      new THREE.MeshBasicMaterial({ color: 0x2f95ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
      MAX_ELETRON * 2, 12,
    );
  }

  _buildHoles() {
    this.holes = [];
    const coreGeo = new THREE.SphereGeometry(0.6, 24, 16);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
    const diskGeo = new THREE.RingGeometry(0.72, 2.3, 64, 1);
    const n = this.lowQ ? 40 : 80;
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seeds[i] = Math.random();
    const swirlGeo = new THREE.BufferGeometry();
    swirlGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    swirlGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    for (let i = 0; i < MAX_HOLES; i++) {
      const group = new THREE.Group();
      const core = new THREE.Mesh(coreGeo, coreMat);
      const diskMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 } },
        vertexShader: DISK_VS, fragmentShader: DISK_FS,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const disk = new THREE.Mesh(diskGeo, diskMat);
      disk.renderOrder = 12;
      const swirlMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uViewH: { value: 720 }, uSpeed: { value: 0.9 } },
        vertexShader: SWIRL_VS, fragmentShader: SWIRL_FS,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const swirl = new THREE.Points(swirlGeo, swirlMat);
      swirl.frustumCulled = false;
      swirl.renderOrder = 12;
      disk.add(swirl);
      group.add(core, disk);
      group.visible = false;
      this.root.add(group);
      this.holes.push({
        active: false, group, disk, diskMat, swirlMat, owner: null, target: null,
        s: 0, pos: new THREE.Vector3(), start: new THREE.Vector3(), boom: new THREE.Vector3(),
        phase: 'fly', t: 0, age: 0, scale: 1, heading: 0, lateral: 0,
      });
    }
  }

  _buildRockets() {
    this.rockets = [];
    const geo = rocketGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2 });
    const flameGeo = buildFlameGeometry();
    const flameMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    for (let i = 0; i < 8; i++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(geo, mat);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.z = -0.47;
      flame.renderOrder = 12;
      group.add(body, flame);
      group.position.set(0, 0.8, -1.25);
      group.visible = false;
      this.root.add(group);
      this.rockets.push({ group, flame, kart: null, t: 0, dur: 1.3, out: 0, active: false, prev: new THREE.Vector3(), smoke: 0 });
    }
  }

  _buildBatteries() {
    this.batMesh = this._instanced(
      voltaGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35, emissive: 0x101010 }),
      24,
    );
  }

  // ------------------------------------------------------------ API pública
  reset(karts) {
    this.karts = karts || [];
    for (const a of this.apples) a.active = false;
    for (const p of this.projs) p.active = false;
    for (const h of this.holes) { h.active = false; h.group.visible = false; }
    for (const r of this.rockets) this._detachRocket(r);
    for (const b of this.boxes) { b.alive = true; b.pop = 1; b.timer = 0; }
    for (const k of this.karts) {
      k.item = null;
      k.itemCount = 0;
      k.roulette = null;
      if (k.controls) k.controls.useItem = false;
    }
    this.hazards.length = 0;
    for (const m of [this.appleMesh, this.alfaMesh, this.eCore, this.eRing, this.batMesh]) { m.count = 0; m.visible = false; }
    this.glows.begin();
    this.glows.commit();
  }

  giveItem(kart, itemId) {
    const it = ITEMS[itemId];
    if (!kart || !it) return;
    kart.item = itemId;
    kart.itemCount = it.uses || 1;
    kart.roulette = null;
    this.bus?.emit('item:got', { kart, item: itemId });
  }

  rollItem(kart) {
    if (!kart || kart.item || kart.roulette) return;
    const i = (Math.random() * ITEM_IDS.length) | 0;
    kart.roulette = { time: RACE.rouletteTime, showing: ITEM_IDS[i], _i: i, _tick: 0.07 };
  }

  // Sorteio ponderado pela posição (1..8). Público para testes.
  pickItem(place) {
    const p = clamp(Math.round(place || 4), 1, 8) - 1;
    let total = 0;
    for (const id of ITEM_IDS) total += ITEMS[id].weights[p] || 0;
    if (total <= 0) return 'foguete';
    let r = Math.random() * total;
    for (const id of ITEM_IDS) {
      r -= ITEMS[id].weights[p] || 0;
      if (r < 0) return id;
    }
    return ITEM_IDS[ITEM_IDS.length - 1];
  }

  // ------------------------------------------------------------ update
  update(dt, world) {
    const karts = world?.karts || this.karts;
    this.karts = karts;
    this.world = world;
    this.time += dt;
    if (world?.renderer) {
      if (!this._warm && world.camera && world.scene) {
        this._warm = true;
        try { world.renderer.compile(this.root, world.camera, world.scene); } catch (err) { /* ok */ }
      }
      this._viewH = world.renderer.getDrawingBufferSize(_v2d).y || 720;
    }
    this.glows.begin();
    this._updateBoxes(dt, karts);
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      if (k.roulette) this._updateRoulette(k, dt);
      this._checkUse(k);
    }
    this._updateApples(dt, karts);
    this._updateProjectiles(dt, karts);
    this._updateHoles(dt, karts);
    this._updateRockets(dt);
    this._updateBatteries(karts);
    this.glows.commit();
    this._updateHazards();
  }

  // ------------------------------------------------------------ caixas
  _updateBoxes(dt, karts) {
    const t = this.time;
    const boxes = this.boxes;
    const n = boxes.length;
    if (!n) return;
    this.boxMats[0].uniforms.uTime.value = t;
    this.boxMats[1].uniforms.uTime.value = t;
    let visible = 0;
    for (let i = 0; i < n; i++) {
      const b = boxes[i];
      if (!b.alive) {
        b.timer -= dt;
        if (b.timer <= 0) { b.alive = true; b.pop = 0; }
      } else if (b.pop < 1) b.pop = Math.min(1, b.pop + dt / 0.45);
      const sc = b.alive ? Math.max(0, easeOutBack(b.pop)) : 0;
      if (sc > 0) visible++;
      // casca
      _v.copy(b.pos);
      _v.y += Math.sin(t * 2.1 + b.phase) * 0.13;
      _e.set(0.42 + Math.sin(t * 0.8 + b.phase) * 0.12, t * 0.9 + b.phase, 0.38);
      _q.setFromEuler(_e);
      _s.setScalar(BOX_SIZE * sc);
      _m.compose(_v, _q, _s);
      this.boxBack.setMatrixAt(i, _m);
      // átomo interno
      _e.set(t * 1.1 + b.phase, t * 1.7, t * 0.6);
      _q.setFromEuler(_e);
      _s.setScalar(sc);
      _m.compose(_v, _q, _s);
      this.boxNucleus.setMatrixAt(i, _m);
      for (let k = 0; k < 3; k++) {
        _q2.multiplyQuaternions(_q, this._orbitQ[k]);
        _s.set(sc, sc * 0.4, sc);
        _m.compose(_v, _q2, _s);
        this.boxOrbits.setMatrixAt(i * 3 + k, _m);
        const th = t * (3.4 + k * 0.5) + k * 2.1 + b.phase;
        _v2.set(Math.cos(th) * 0.4 * sc, Math.sin(th) * 0.4 * 0.4 * sc, 0).applyQuaternion(_q2).add(_v);
        _s.setScalar(sc);
        _m.compose(_v2, _q2, _s);
        this.boxElectrons.setMatrixAt(i * 3 + k, _m);
        if (sc > 0) this.glows.push(_v2.x, _v2.y, _v2.z, 0, 0, 0, 0.3, 0.8, 1, 1, 0.42 * sc, 0, SHAPE.GLOW, 0.7);
      }
      if (sc > 0) {
        const pulse = 1 + Math.sin(t * 5 + b.phase) * 0.12;
        this.glows.push(_v.x, _v.y, _v.z, 0, 0, 0, 1, 0.55, 0.35, 0.85, 1.05 * sc * pulse, 0, SHAPE.GLOW, 0.8);
        // halo arco-íris atrás da caixa (destaca a caixa no cenário)
        _col.setHSL((t * 0.25 + b.phase * 0.13) % 1, 1, 0.55);
        this.glows.push(_v.x, _v.y, _v.z, 0, 0, 0, _col.r, _col.g, _col.b, 0.42, -3.0 * sc, 0, SHAPE.GLOW, 0);
      }
      // coleta
      if (b.alive && b.pop > 0.25) {
        for (let j = 0; j < karts.length; j++) {
          const k = karts[j];
          const dx = k.position.x - b.pos.x;
          const dy = k.position.y + 0.7 - b.pos.y;
          const dz = k.position.z - b.pos.z;
          if (dx * dx + dy * dy + dz * dz < BOX_RADIUS * BOX_RADIUS) {
            this._pickup(b, k);
            break;
          }
        }
      }
    }
    this.boxBack.count = this.boxFront.count = this.boxNucleus.count = n;
    this.boxBack.visible = this.boxFront.visible = this.boxNucleus.visible = visible > 0;
    this.boxOrbits.count = n * 3;
    this.boxElectrons.count = n * 3;
    this.boxOrbits.visible = this.boxElectrons.visible = visible > 0;
    this.boxBack.instanceMatrix.needsUpdate = true;
    this.boxNucleus.instanceMatrix.needsUpdate = true;
    this.boxOrbits.instanceMatrix.needsUpdate = true;
    this.boxElectrons.instanceMatrix.needsUpdate = true;
  }

  _pickup(b, k) {
    b.alive = false;
    b.timer = RACE.boxRespawn;
    this.bus?.emit('item:pickup', { kart: k, pos: b.pos });
    if (!k.item && !k.roulette) this.rollItem(k);
  }

  // ------------------------------------------------------------ roleta e uso
  _updateRoulette(k, dt) {
    const r = k.roulette;
    r.time -= dt;
    r._tick -= dt;
    if (r._tick <= 0) {
      r._i = (r._i + 1 + ((Math.random() * 2) | 0)) % ITEM_IDS.length;
      r.showing = ITEM_IDS[r._i];
      const frac = 1 - Math.max(0, r.time) / RACE.rouletteTime;
      r._tick += 0.07 + 0.16 * frac * frac; // desacelera no fim
    }
    if (r.time <= 0) {
      const id = this.pickItem(k.place);
      k.item = id;
      k.itemCount = ITEMS[id].uses || 1;
      k.roulette = null;
      this.bus?.emit('item:got', { kart: k, item: id });
    }
  }

  _checkUse(k) {
    const c = k.controls;
    if (!c) return;
    const use = c.useItem;
    c.useItem = false; // pulso consumido sempre
    if (use && k.item && !k.roulette && !k.stunned && !k.frozen) this._use(k);
  }

  _use(k) {
    const id = k.item;
    switch (id) {
      case 'foguete':
        k.applyBoost(1.3, 1, 'item');
        this._attachRocket(k, 1.3);
        break;
      case 'pilha3': {
        const cnt = Math.min(3, k.itemCount || 1);
        this._batteryPos(k, cnt - 1, _v3);
        k.applyBoost(1.1, 1, 'item');
        this.effects?.burst('electric', _v3, { kart: k, scale: 0.55, bolts: 3 });
        break;
      }
      case 'maca':
        this._dropApple(k);
        break;
      case 'alfa':
        this._fire(k, 'alfa');
        break;
      case 'eletron':
        this._fire(k, 'eletron');
        break;
      case 'faraday':
        k.starTime = 7;
        break;
      case 'tesla':
        this._tesla(k);
        break;
      case 'buraco':
        this._launchHole(k);
        break;
      default:
        break;
    }
    k.itemCount = (k.itemCount || 1) - 1;
    if (k.itemCount <= 0) {
      k.item = null;
      k.itemCount = 0;
    }
    this.bus?.emit('item:use', { kart: k, item: id });
  }

  _scaleOf(k) {
    return k.visual ? k.visual.scale.x || 1 : 1;
  }

  // ------------------------------------------------------------ foguete
  _attachRocket(k, dur) {
    let r = this.rockets.find((x) => x.active && x.kart === k);
    if (!r) r = this.rockets.find((x) => !x.active);
    if (!r) return;
    const parent = k.visual || k.object3d;
    if (!parent) return;
    if (r.group.parent !== parent) parent.add(r.group);
    r.active = true;
    r.kart = k;
    r.t = 0;
    r.out = 0;
    r.dur = dur;
    r.group.visible = true;
    r.group.scale.setScalar(0.01);
    this._rocketNozzle(r, r.prev);
  }

  _detachRocket(r) {
    r.active = false;
    r.kart = null;
    r.group.visible = false;
    if (r.group.parent !== this.root) this.root.add(r.group);
  }

  // bocal do foguete em coordenadas do mundo
  _rocketNozzle(r, out) {
    const k = r.kart;
    const o = k.object3d;
    const ks = this._scaleOf(k);
    out.set(0, 0.8 * ks, (-1.25 - 0.5 * r.group.scale.x) * ks);
    if (o) out.applyQuaternion(o.quaternion).add(o.position);
    else out.add(k.position);
    return out;
  }

  _updateRockets(dt) {
    const fx = this.effects;
    for (const r of this.rockets) {
      if (!r.active) continue;
      const k = r.kart;
      r.t += dt;
      const ending = r.t > r.dur || (r.t > 0.15 && !(k.boostTime > 0)) || k.stunned;
      let sc;
      if (ending) {
        r.out += dt;
        sc = 1 - r.out / 0.25;
        if (sc <= 0) {
          if (fx) {
            this._rocketNozzle(r, _v);
            fx.burst('smoke', _v, { scale: 0.5 });
          }
          this._detachRocket(r);
          continue;
        }
      } else sc = Math.min(1, Math.max(0.01, easeOutBack(Math.min(1, r.t / 0.22))));
      r.group.scale.setScalar(sc * 1.2);
      const fl = 0.85 + 0.25 * Math.sin(this.time * 47) + 0.1 * Math.sin(this.time * 83);
      r.flame.scale.set(0.15, 0.15, (ending ? 0.4 : 1.25) * fl);
      if (fx) {
        this._rocketNozzle(r, _v);
        if (!ending) fx.trail(r.prev, _v, 0xffb640, 0xff3000, 0.75, 0.18, 0.3, 0.7, 0.4);
        r.smoke += dt;
        if (r.smoke > 0.06) {
          r.smoke = 0;
          fx.burst('smoke', _v, OPT_SMOKE_S);
        }
        r.prev.copy(_v);
      }
    }
  }

  // ------------------------------------------------------------ pilhas de Volta
  _batteryPos(k, j, out) {
    const sc = this._scaleOf(k);
    const a = this.time * 2.4 + (j * TAU) / 3 + (k.index || 0);
    return out.set(
      Math.cos(a) * 1.35 * sc,
      (1.05 + Math.sin(this.time * 4 + j * 2) * 0.1) * sc,
      Math.sin(a) * 1.35 * sc,
    ).add(k.position);
  }

  _updateBatteries(karts) {
    let n = 0;
    const t = this.time;
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      if (k.item !== 'pilha3' || k.roulette) continue;
      const cnt = Math.min(3, k.itemCount || 0);
      const sc = this._scaleOf(k);
      for (let j = 0; j < cnt && n < 24; j++) {
        this._batteryPos(k, j, _v);
        _e.set(0.25 * Math.sin(t * 3 + j), t * 3 + j * 2, 0.25 * Math.cos(t * 2.5 + j));
        _q.setFromEuler(_e);
        _s.setScalar(1.15 * sc);
        _m.compose(_v, _q, _s);
        this.batMesh.setMatrixAt(n++, _m);
        // faísca no topo
        const f = 0.6 + 0.4 * Math.sin(t * 31 + j * 5 + i);
        this.glows.push(_v.x, _v.y + 0.33 * sc, _v.z, 0, 0, 0, 0.4, 0.8, 1, 0.8, 0.45 * f * sc, 0, SHAPE.GLOW, 0.9);
      }
    }
    this.batMesh.count = n;
    this.batMesh.visible = n > 0;
    if (n) this.batMesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ maçã
  _dropApple(k) {
    let a = this.apples.find((x) => !x.active);
    if (!a) {
      a = this.apples[0];
      for (const x of this.apples) if (x.age > a.age) a = x; // remove a mais antiga
      this.effects?.burst('smoke', a.pos, { scale: 0.5 });
    }
    const h = k.heading || 0;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const sc = this._scaleOf(k);
    a.from.copy(k.position).addScaledVector(UP, 1.1 * sc);
    a.from.x -= fx * 0.8;
    a.from.z -= fz * 0.8;
    _v.copy(k.position);
    _v.x -= fx * 2.5;
    _v.z -= fz * 2.5;
    const pr = this.track.project(_v, k.s);
    a.ground = pr.groundY;
    a.s = pr.s;
    a.hazard.lateral = pr.lateral;
    a.to.set(_v.x, a.ground + 0.36, _v.z);
    a.pos.copy(a.from);
    a.active = true;
    a.owner = k;
    a.age = 0;
    a.immune = 0.6;
    a.t = 0;
    a.landed = false;
    a.phase = Math.random() * TAU;
    a.squash = 0;
    a.hazard.s = a.s;
  }

  _updateApples(dt, karts) {
    let n = 0;
    const t = this.time;
    for (const a of this.apples) {
      if (!a.active) continue;
      a.age += dt;
      if (!a.landed) {
        a.t = Math.min(1, a.t + dt / 0.38);
        a.pos.lerpVectors(a.from, a.to, a.t);
        a.pos.y += Math.sin(a.t * Math.PI) * 0.9;
        if (a.t >= 1) {
          a.landed = true;
          a.squash = 1;
          if (this.effects) {
            _v.set(a.pos.x, a.ground, a.pos.z);
            this.effects.burst('dust', _v, { scale: 0.45 });
          }
        }
      }
      a.squash = Math.max(0, a.squash - dt * 4);
      // colisão com karts
      let hit = false;
      if (a.t > 0.5) {
        for (let i = 0; i < karts.length; i++) {
          const k = karts[i];
          if (k === a.owner && a.age < a.immune) continue;
          const dx = k.position.x - a.pos.x;
          const dz = k.position.z - a.pos.z;
          const dy = k.position.y - a.ground;
          if (dx * dx + dz * dz > APPLE_HIT * APPLE_HIT || dy > 1.3 || dy < -1.2) continue;
          if (k.stunned) continue;
          if (!k.invincible) k.hit('spin', a.owner);
          hit = true;
          break;
        }
      }
      if (hit) {
        a.active = false;
        this.bus?.emit('item:explode', { pos: a.pos, item: 'maca' });
        continue;
      }
      // desenho: balanço suave e amassadinho ao pousar
      const sq = Math.sin(a.squash * Math.PI) * 0.25;
      _e.set(Math.sin(t * 3 + a.phase) * 0.12, a.phase + t * 0.3, Math.cos(t * 2.6 + a.phase) * 0.12);
      _q.setFromEuler(_e);
      _s.set(1 + sq, 1 - sq, 1 + sq);
      _v.copy(a.pos);
      _v.y -= sq * 0.1;
      _m.compose(_v, _q, _s);
      this.appleMesh.setMatrixAt(n++, _m);
    }
    this.appleMesh.count = n;
    this.appleMesh.visible = n > 0;
    if (n) this.appleMesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ projéteis
  _take(type) {
    let best = null;
    for (const p of this.projs) {
      if (p.type !== type) continue;
      if (!p.active) return p;
      if (!best || p.age > best.age) best = p;
    }
    return best; // reaproveita o mais velho
  }

  _fire(k, type) {
    const p = this._take(type);
    if (!p) return;
    const h = k.heading || 0;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const back = type === 'alfa' && !!k.controls?.lookBack;
    const dir = back ? -1 : 1;
    const sc = this._scaleOf(k);
    p.active = true;
    p.owner = k;
    p.age = 0;
    p.immune = 0.4;
    p.spin = Math.random() * TAU;
    p.h = type === 'alfa' ? 0.65 : 0.8;
    p.pos.copy(k.position);
    p.pos.x += fx * dir * (back ? 1.9 : 1.5);
    p.pos.z += fz * dir * (back ? 1.9 : 1.5);
    p.pos.y += p.h * sc;
    const pr = this.track.project(p.pos, k.s);
    p.s = pr.s;
    p.lateral = pr.lateral;
    p.prev.copy(p.pos);
    p.target = null;
    if (type === 'alfa') {
      p.life = 8;
      p.speed = back ? 40 : 48 + Math.max(0, k.speed || 0) * 0.3;
      p.mode = 'straight';
    } else {
      p.life = 12;
      p.speed = 52;
      const place = k.place || 0;
      if (place > 1) {
        for (const o of this.karts) if (o !== k && o.place === place - 1) { p.target = o; break; }
      }
      p.mode = p.target ? 'track' : 'straight';
    }
    p.vel.set(fx * dir * p.speed, 0, fz * dir * p.speed);
  }

  _updateProjectiles(dt, karts) {
    const track = this.track;
    const fx = this.effects;
    let na = 0;
    let ne = 0;
    const t = this.time;
    for (const p of this.projs) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age > p.life) {
        p.active = false;
        fx?.burst('smoke', p.pos, { scale: 0.45 });
        fx?.burst('glow', p.pos, { color: p.type === 'alfa' ? 0xffd23f : 0x4cc9f0, size: 1.4, life: 0.2 });
        continue;
      }
      p.prev.copy(p.pos);
      // --- movimento
      if (p.mode === 'track' && p.target) {
        const tg = p.target;
        p.s = (p.s + p.speed * dt) % track.length;
        p.lateral += (tg.lateral - p.lateral) * Math.min(1, dt * 2.2);
        const smp = track.sample(p.s);
        const lim = smp.wallDist - 0.8;
        p.lateral = clamp(p.lateral, -lim, lim);
        p.pos.copy(smp.pos).addScaledVector(smp.right, p.lateral);
        p.pos.y += p.h;
        _v.copy(tg.position).addScaledVector(UP, 0.6);
        if (_v.distanceToSquared(p.pos) < 20 * 20) p.mode = 'home';
      } else if (p.mode === 'home' && p.target) {
        const tg = p.target;
        _v.copy(tg.position).addScaledVector(UP, 0.6).sub(p.pos);
        const d = _v.length();
        if (d > 45) {
          p.mode = 'track';
        } else {
          const sp = Math.max(p.speed, (tg.speed || 0) + 14);
          if (d > 1e-4) p.pos.addScaledVector(_v, Math.min(1, (sp * dt) / d));
          const pr = track.project(p.pos, p.s);
          p.s = pr.s;
          p.lateral = pr.lateral;
          p.pos.y = Math.max(p.pos.y, pr.groundY + 0.35);
        }
      } else {
        // reta com ricochete nos muros
        p.pos.addScaledVector(p.vel, dt);
        const pr = track.project(p.pos, p.s);
        p.s = pr.s;
        const lat = pr.lateral;
        const lim = pr.wallDist - 0.6;
        const ground = pr.groundY;
        if (Math.abs(lat) > lim) {
          const sgn = lat > 0 ? 1 : -1;
          const smp = track.sample(p.s);
          const vn = p.vel.x * smp.right.x + p.vel.z * smp.right.z;
          if (vn * sgn > 0) {
            p.vel.x -= 2 * vn * smp.right.x;
            p.vel.z -= 2 * vn * smp.right.z;
          }
          p.pos.x = smp.pos.x + smp.right.x * sgn * lim;
          p.pos.z = smp.pos.z + smp.right.z * sgn * lim;
          p.lateral = sgn * lim;
          if (fx) {
            _v.copy(p.pos).addScaledVector(smp.right, sgn * 0.4);
            _v2.copy(smp.right).multiplyScalar(-sgn);
            fx.burst('sparks', _v, { count: 10, dir: _v2, color: p.type === 'alfa' ? 0xffe066 : 0x9fe3ff });
          }
        } else p.lateral = lat;
        p.pos.y = ground + p.h;
      }
      p.hazard.s = p.s;
      p.hazard.lateral = p.lateral;

      // --- colisões
      let dead = false;
      for (let i = 0; i < karts.length; i++) {
        const k = karts[i];
        if (k === p.owner && p.age < p.immune) continue;
        const dx = k.position.x - p.pos.x;
        const dy = k.position.y + 0.6 - p.pos.y;
        const dz = k.position.z - p.pos.z;
        if (dx * dx + dy * dy + dz * dz > PROJ_HIT * PROJ_HIT) continue;
        if (k.invincible) { dead = true; break; } // quebra na gaiola, sem efeito
        if (k.stunned) continue;
        k.hit('spin', p.owner);
        dead = true;
        break;
      }
      if (!dead) {
        for (const a of this.apples) {
          if (!a.active || !a.landed) continue;
          if (a.pos.distanceToSquared(p.pos) < 1.2 * 1.2) {
            a.active = false;
            this.bus?.emit('item:explode', { pos: a.pos, item: 'maca' });
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        p.active = false;
        this.bus?.emit('item:explode', { pos: p.pos, item: p.type });
        continue;
      }

      // --- desenho
      p.spin += dt * 9;
      const pop = Math.min(1, p.age / 0.1);
      if (p.type === 'alfa') {
        _e.set(p.spin, p.spin * 0.7, 0);
        _q.setFromEuler(_e);
        _s.setScalar(pop);
        _m.compose(p.pos, _q, _s);
        this.alfaMesh.setMatrixAt(na++, _m);
        const f = 0.9 + 0.1 * Math.sin(t * 40 + p.spin);
        this.glows.push(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, 1, 0.5, 0.04, 0.85, -3.0 * f * pop, 0, SHAPE.GLOW, 0.35);
        fx?.trail(p.prev, p.pos, 0xffc23a, 0xff4a00, 0.75, 0.24, 0.3, 0.55, 0.25);
      } else {
        _s.setScalar(pop);
        _q.identity();
        _m.compose(p.pos, _q, _s);
        this.eCore.setMatrixAt(ne, _m);
        for (let r = 0; r < 2; r++) {
          _e.set(p.spin * (r ? 1.3 : 0.8) + r * 1.2, p.spin * 0.5 + r * 2, r * 0.9);
          _q.setFromEuler(_e);
          _m.compose(p.pos, _q, _s);
          this.eRing.setMatrixAt(ne * 2 + r, _m);
        }
        ne++;
        const f = 0.85 + 0.15 * Math.sin(t * 33 + p.spin);
        this.glows.push(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, 0.05, 0.35, 1, 0.8, -3.0 * f * pop, 0, SHAPE.GLOW, 0.2);
        this.glows.push(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, 0.1, 0.45, 1, 0.45, -2.2 * pop, t * 4, SHAPE.RING, 0);
        fx?.trail(p.prev, p.pos, 0x5cc8ff, 0x1d4dff, 0.7, 0.26, 0.3, 0.55, 0.25);
      }
    }
    this.alfaMesh.count = na;
    this.alfaMesh.visible = na > 0;
    if (na) this.alfaMesh.instanceMatrix.needsUpdate = true;
    this.eCore.count = ne;
    this.eRing.count = ne * 2;
    this.eCore.visible = this.eRing.visible = ne > 0;
    if (ne) {
      this.eCore.instanceMatrix.needsUpdate = true;
      this.eRing.instanceMatrix.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------ Tesla
  _tesla(k) {
    for (const o of this.karts) {
      if (o === k || o.invincible) continue;
      const pl = clamp(o.place || 4, 1, 8);
      o.shrink(3.5 + (8 - pl) * 0.35);
      o.hit('shock', k);
    }
    this.bus?.emit('item:lightning', { by: k });
  }

  // ------------------------------------------------------------ buraco negro
  _launchHole(k) {
    let target = null;
    for (const o of this.karts) if (o !== k && o.place === 1) target = o;
    if (!target) for (const o of this.karts) if (o !== k && o.place === 2) target = o;
    if (!target) {
      for (const o of this.karts) {
        if (o === k) continue;
        if (!target || (o.place || 99) < (target.place || 99)) target = o;
      }
    }
    if (!target) return false;
    let h = this.holes.find((x) => !x.active);
    if (!h) {
      h = this.holes[0];
      for (const x of this.holes) if (x.age > h.age) h = x;
    }
    const sc = this._scaleOf(k);
    h.active = true;
    h.owner = k;
    h.target = target;
    h.s = k.s || 0;
    h.lateral = k.lateral || 0;
    h.start.copy(k.position).addScaledVector(UP, 1.6 * sc);
    h.pos.copy(h.start);
    h.phase = 'fly';
    h.t = 0;
    h.age = 0;
    h.scale = 0.2;
    h.heading = k.heading || 0;
    h.group.visible = true;
    h.group.position.copy(h.pos);
    h.group.scale.setScalar(0.2);
    this.effects?.burst('implosion', h.start, { scale: 0.4 });
    return true;
  }

  _updateHoles(dt, karts) {
    const track = this.track;
    const L = track.length;
    for (const h of this.holes) {
      if (!h.active) continue;
      h.age += dt;
      const tg = h.target;
      if (h.phase === 'fly') {
        let d = (((tg.s - h.s) % L) + L * 1.5) % L - L * 0.5; // distância com sinal (curta)
        const step = 75 * dt;
        if (Math.abs(d) <= step + 1 || h.age > 19) {
          h.phase = 'hover';
          h.t = 0;
        } else {
          h.s = (((h.s + Math.sign(d) * step) % L) + L) % L;
          d -= Math.sign(d) * step;
        }
        const smp = track.sample(h.s);
        const near = clamp(1 - (Math.abs(d) - 5) / 40, 0, 1);
        h.lateral += ((tg.lateral || 0) * near - h.lateral) * Math.min(1, dt * 3);
        _v.copy(smp.pos).addScaledVector(smp.right, h.lateral).addScaledVector(UP, 4);
        const rise = Math.min(1, h.age / 0.45);
        const e = 1 - Math.pow(1 - rise, 3);
        h.pos.lerpVectors(h.start, _v, e);
        h.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
        h.scale = Math.min(1, 0.2 + h.age * 3);
      } else if (h.phase === 'hover') {
        h.t += dt;
        const f = Math.min(1, h.t / 0.7);
        _v.copy(tg.position).addScaledVector(UP, 4.4 - 0.9 * f);
        h.pos.lerp(_v, 1 - Math.exp(-14 * dt));
        h.heading = tg.heading || h.heading;
        h.scale = 1 + 0.9 * (f * f * (3 - 2 * f));
        if (h.t >= 0.7) {
          h.phase = 'implode';
          h.t = 0;
          this.effects?.burst('implosion', h.pos, { scale: 1.2, vel: tg.velocity });
        }
      } else {
        h.t += dt;
        _v.copy(tg.position).addScaledVector(UP, 2.6);
        h.pos.lerp(_v, 1 - Math.exp(-20 * dt));
        const f = Math.min(1, h.t / 0.2);
        h.scale = 1.9 * (1 - f) * (1 - f) + 0.01;
        if (f >= 1) {
          this._holeBoom(h, karts);
          continue;
        }
      }
      // desenho
      h.group.position.copy(h.pos);
      h.group.rotation.set(0, h.heading, 0);
      h.group.scale.setScalar(h.scale);
      h.disk.rotation.set(-Math.PI / 2 + 0.62, 0, 0);
      const speed = h.phase === 'fly' ? 1 : h.phase === 'hover' ? 1.8 : 4;
      h.diskMat.uniforms.uTime.value += dt * speed;
      h.swirlMat.uniforms.uTime.value += dt * speed;
      h.swirlMat.uniforms.uViewH.value = this._viewH;
      const s = h.scale;
      const pulse = 1 + 0.08 * Math.sin(this.time * 12);
      // halo roxo atrás da esfera (sem deslocamento: a esfera preta o encobre) + anel de fótons
      this.glows.push(h.pos.x, h.pos.y, h.pos.z, 0, 0, 0, 0.22, 0.03, 0.6, 0.35, -3.4 * s * pulse, 0, SHAPE.GLOW, -1);
      this.glows.push(h.pos.x, h.pos.y, h.pos.z, 0, 0, 0, 1, 0.42, 0.08, 0.8, -1.6 * s, this.time * 2, SHAPE.RING, -1);
      if (h.age > 20) this._holeBoom(h, karts);
    }
  }

  _holeBoom(h, karts) {
    const tg = h.target;
    const c = tg.position;
    for (const o of karts) {
      if (o.invincible) continue;
      const dx = o.position.x - c.x;
      const dy = o.position.y - c.y;
      const dz = o.position.z - c.z;
      if (dx * dx + dy * dy + dz * dz < 64) o.hit('tumble', h.owner);
    }
    h.boom.copy(c).addScaledVector(UP, 1);
    h.active = false;
    h.group.visible = false;
    this.bus?.emit('item:blackhole', { target: tg, pos: h.boom });
    this.bus?.emit('item:explode', { pos: h.boom, item: 'buraco' });
  }

  // ------------------------------------------------------------ perigos (IA)
  _updateHazards() {
    const hz = this.hazards;
    let n = 0;
    for (const a of this.apples) if (a.active) hz[n++] = a.hazard;
    for (const p of this.projs) if (p.active) hz[n++] = p.hazard;
    hz.length = n;
  }
}

