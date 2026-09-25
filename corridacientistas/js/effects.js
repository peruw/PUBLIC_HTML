// Efeitos visuais: partículas (pool fixo), faíscas de drift, chamas de turbo, poeira,
// gaiola de Faraday, raios, ondas de choque e flash de tela. Tudo procedural.
import * as THREE from './three.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------
// Utilidades de geometria (também usadas por items.js)
// ---------------------------------------------------------------------------

// Junta geometrias (position, normal e color, se todas tiverem) numa só, indexada.
export function mergeGeometries(list) {
  let nv = 0;
  let ni = 0;
  const hasColor = list.every((g) => g.attributes.color);
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = hasColor ? new Float32Array(nv * 3) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
    }
    const n = g.attributes.normal;
    if (n) for (let i = 0; i < n.count; i++) {
      nor[(vo + i) * 3] = n.getX(i);
      nor[(vo + i) * 3 + 1] = n.getY(i);
      nor[(vo + i) * 3 + 2] = n.getZ(i);
    }
    if (col) {
      const c = g.attributes.color;
      for (let i = 0; i < c.count; i++) {
        col[(vo + i) * 3] = c.getX(i);
        col[(vo + i) * 3 + 1] = c.getY(i);
        col[(vo + i) * 3 + 2] = c.getZ(i);
      }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io++] = vo + i;
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// Pinta todos os vértices de uma geometria com uma cor (atributo color).
export function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

// ---------------------------------------------------------------------------
// Atlas de formas (4 × 2 células) desenhado em canvas
// ---------------------------------------------------------------------------
export const SHAPE = { GLOW: 0, SPARK: 1, STAR: 2, SMOKE: 3, SQUARE: 4, SHARD: 5, ATOM: 6, RING: 7 };

let _atlas = null;
export function getAtlas() {
  if (_atlas) return _atlas;
  const C = 128;
  const cv = document.createElement('canvas');
  cv.width = C * 4;
  cv.height = C * 2;
  const g = cv.getContext('2d');
  const cell = (i, fn) => {
    g.save();
    g.translate((i % 4) * C + C / 2, Math.floor(i / 4) * C + C / 2);
    fn(g, C / 2);
    g.restore();
  };
  const radial = (g, r, stops) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    for (const [o, a] of stops) gr.addColorStop(o, `rgba(255,255,255,${a})`);
    g.fillStyle = gr;
    g.fillRect(-r, -r, r * 2, r * 2);
  };
  // 0: brilho suave
  cell(0, (g, r) => radial(g, r, [[0, 1], [0.18, 0.8], [0.45, 0.28], [0.75, 0.07], [1, 0]]));
  // 1: faísca (núcleo duro)
  cell(1, (g, r) => radial(g, r, [[0, 1], [0.3, 1], [0.55, 0.4], [0.8, 0.08], [1, 0]]));
  // 2: estrela de 5 pontas
  cell(2, (g, r) => {
    radial(g, r, [[0, 0.5], [0.5, 0.12], [1, 0]]);
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 ? r * 0.36 : r * 0.82;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = '#fff';
    g.shadowColor = '#fff';
    g.shadowBlur = r * 0.2;
    g.fill();
  });
  // 3: fumaça (vários bolos com semente fixa)
  cell(3, (g, r) => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 11; k++) {
      const a = rnd() * TAU;
      const d = rnd() * r * 0.36;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      const rr = r * (0.34 + rnd() * 0.26);
      const sh = 215 + Math.floor(rnd() * 40);
      const gr = g.createRadialGradient(x, y - rr * 0.2, 0, x, y, rr);
      gr.addColorStop(0, `rgba(${sh},${sh},${sh},0.5)`);
      gr.addColorStop(0.6, `rgba(${sh},${sh},${sh},0.28)`);
      gr.addColorStop(1, `rgba(${sh},${sh},${sh},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, rr, 0, TAU);
      g.fill();
    }
  });
  // 4: confete (retângulo arredondado)
  cell(4, (g, r) => {
    g.fillStyle = '#fff';
    const w = r * 1.3;
    const h = r * 0.85;
    g.beginPath();
    if (g.roundRect) g.roundRect(-w / 2, -h / 2, w, h, r * 0.12);
    else g.rect(-w / 2, -h / 2, w, h);
    g.fill();
  });
  // 5: caco (triângulo)
  cell(5, (g, r) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, -r * 0.85);
    g.lineTo(r * 0.75, r * 0.6);
    g.lineTo(-r * 0.6, r * 0.45);
    g.closePath();
    g.fill();
  });
  // 6: átomo (núcleo + 3 órbitas)
  cell(6, (g, r) => {
    radial(g, r, [[0, 0.35], [0.5, 0.08], [1, 0]]);
    g.strokeStyle = '#fff';
    g.lineWidth = r * 0.09;
    for (let k = 0; k < 3; k++) {
      g.save();
      g.rotate((k * Math.PI) / 3);
      g.beginPath();
      g.ellipse(0, 0, r * 0.8, r * 0.3, 0, 0, TAU);
      g.stroke();
      g.restore();
    }
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(0, 0, r * 0.17, 0, TAU);
    g.fill();
  });
  // 7: anel
  cell(7, (g, r) => radial(g, r, [[0, 0], [0.55, 0], [0.72, 0.35], [0.8, 1], [0.88, 0.35], [1, 0]]));

  _atlas = new THREE.CanvasTexture(cv);
  _atlas.flipY = false;
  _atlas.minFilter = THREE.LinearMipmapLinearFilter;
  _atlas.magFilter = THREE.LinearFilter;
  return _atlas;
}

// ---------------------------------------------------------------------------
// SpriteBatch: sprites de frente para a câmera (ou esticados na direção do
// movimento) num único draw call, via InstancedBufferGeometry.
// ---------------------------------------------------------------------------
const SPRITE_VS = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iDir;
attribute vec4 iCol;
attribute vec4 iPar; // tamanho, rotação, forma, núcleo branco
varying vec2 vUv;
varying vec4 vCol;
varying float vHot;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float size = abs(iPar.x); // tamanho negativo = sem deslocamento de profundidade
  float shape = iPar.z;
  vec2 c = position.xy;
  bool done = false;
  if (dot(iDir, iDir) > 1e-8) {
    // rastro esticado entre cauda e cabeça (com perspectiva correta)
    vec3 tail = (modelViewMatrix * vec4(iPos - iDir, 1.0)).xyz;
    vec3 head = mvPosition.xyz;
    vec3 axis = head - tail;
    vec3 side = cross(axis, head);
    float sl = length(side);
    if (sl > 1e-6) {
      side /= sl;
      vec3 ax = normalize(axis);
      vec3 a = tail - ax * size * 0.5;
      vec3 b = head + ax * size * 0.5;
      mvPosition.xyz = mix(a, b, c.x + 0.5) + side * (c.y * size);
      done = true;
    }
  }
  if (!done) {
    float r = iPar.y;
    if (abs(shape - 4.0) < 0.5) c.y *= abs(cos(r * 1.7)) * 0.85 + 0.15; // confete "virando"
    float cs = cos(r);
    float sn = sin(r);
    mvPosition.xy += vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) * size;
    // puxa o sprite para a câmera (mesmo tamanho na tela) para não ser cortado pelo chão
    float zo = iPar.x < 0.0 ? 0.0 : min(size * 0.45, max(0.0, -mvPosition.z - 0.6));
    float zn = mvPosition.z + zo;
    mvPosition.xy *= zn / mvPosition.z;
    mvPosition.z = zn;
  }
  vec2 cell = vec2(mod(shape, 4.0), floor(shape / 4.0 + 0.01));
  vUv = (cell + vec2(position.x + 0.5, 0.5 - position.y) * 0.97 + 0.015) / vec2(4.0, 2.0);
  vCol = iCol;
  vHot = iPar.w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const SPRITE_FS = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vCol;
varying float vHot;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = vCol.a * t.a;
  if (a < 0.004) discard;
  vec3 col = mix(vCol.rgb, vec3(1.0), clamp(t.a * t.a * t.a * vHot, 0.0, 1.0));
  gl_FragColor = vec4(col * t.rgb, a);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    #ifdef ADDITIVE
      gl_FragColor.a *= 1.0 - fogFactor;
    #else
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
    #endif
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function dynAttr(geo, name, size, max) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size);
  a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute(name, a);
  return a;
}

export class SpriteBatch {
  constructor(max, { additive = true, renderOrder = 0 } = {}) {
    this.max = max;
    this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = dynAttr(g, 'iPos', 3, max);
    this.aDir = dynAttr(g, 'iDir', 3, max);
    this.aCol = dynAttr(g, 'iCol', 4, max);
    this.aPar = dynAttr(g, 'iPar', 4, max);
    this._ranges = [this.aPos, this.aDir, this.aCol, this.aPar].map(() => ({ start: 0, count: 0 }));
    g.instanceCount = 0;
    this.geometry = g;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null } }]);
    uniforms.uMap.value = getAtlas();
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: SPRITE_VS,
      fragmentShader: SPRITE_FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: additive ? { ADDITIVE: '' } : {},
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
  }

  begin() {
    this.n = 0;
  }

  // Adiciona um sprite. (dx,dy,dz) != 0 => sprite esticado de pos-dir até pos.
  push(x, y, z, dx, dy, dz, r, g, b, a, size, rot, shape, hot) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const p = this.aPos.array;
    const d = this.aDir.array;
    const c = this.aCol.array;
    const q = this.aPar.array;
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    d[i * 3] = dx; d[i * 3 + 1] = dy; d[i * 3 + 2] = dz;
    c[i * 4] = r; c[i * 4 + 1] = g; c[i * 4 + 2] = b; c[i * 4 + 3] = a;
    q[i * 4] = size; q[i * 4 + 1] = rot; q[i * 4 + 2] = shape; q[i * 4 + 3] = hot;
  }

  commit() {
    const n = this.n;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    const attrs = [this.aPos, this.aDir, this.aCol, this.aPar];
    for (let k = 0; k < 4; k++) {
      const a = attrs[k];
      const r = this._ranges[k];
      r.start = 0;
      r.count = n * a.itemSize;
      a.updateRanges.length = 0;
      a.updateRanges.push(r); // reutiliza o objeto: sem alocação por quadro
      a.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Pool de partículas simuladas na CPU e desenhadas por um SpriteBatch.
// ---------------------------------------------------------------------------
const S = 26; // floats por partícula
// 0-2 pos, 3-5 vel, 6 idade, 7 vida (<0 = só 1 quadro), 8 tam0, 9 tam1, 10-12 cor0, 13-15 cor1,
// 16 alfa, 17 arrasto, 18 gravidade, 19 rotação, 20 giro, 21 forma, 22 esticar, 23 núcleo, 24 balanço, 25 fade-in

class ParticlePool {
  constructor(max, additive, renderOrder) {
    this.max = max;
    this.n = 0;
    this.d = new Float32Array(max * S);
    this.batch = new SpriteBatch(max, { additive, renderOrder });
  }

  spawn(p) {
    let i = this.n;
    if (i >= this.max) i = (Math.random() * this.max) | 0; // pool cheio: substitui uma qualquer
    else this.n++;
    const d = this.d;
    const o = i * S;
    d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z;
    d[o + 3] = p.vx; d[o + 4] = p.vy; d[o + 5] = p.vz;
    d[o + 6] = 0; d[o + 7] = p.life;
    d[o + 8] = p.s0; d[o + 9] = p.s1 < 0 ? p.s0 : p.s1;
    const c0 = p.c0;
    const c1 = p.useC1 ? p.c1 : p.c0;
    d[o + 10] = c0.r; d[o + 11] = c0.g; d[o + 12] = c0.b;
    d[o + 13] = c1.r; d[o + 14] = c1.g; d[o + 15] = c1.b;
    d[o + 16] = p.a; d[o + 17] = p.drag; d[o + 18] = p.grav;
    d[o + 19] = p.rot; d[o + 20] = p.spin; d[o + 21] = p.shape;
    d[o + 22] = p.stretch; d[o + 23] = p.hot; d[o + 24] = p.wob; d[o + 25] = p.fadeIn;
  }

  update(dt) {
    const d = this.d;
    let i = 0;
    while (i < this.n) {
      const o = i * S;
      const life = d[o + 7];
      d[o + 6] += dt;
      if (life < 0 || d[o + 6] >= life) {
        // troca com a última e encolhe
        const last = (this.n - 1) * S;
        if (last !== o) d.copyWithin(o, last, last + S);
        this.n--;
        continue;
      }
      const f = 1 / (1 + d[o + 17] * dt);
      d[o + 3] *= f;
      d[o + 4] = d[o + 4] * f - d[o + 18] * dt;
      d[o + 5] *= f;
      const w = d[o + 24];
      if (w !== 0) {
        const age = d[o + 6];
        d[o + 3] += Math.sin(age * 9 + o) * w * dt;
        d[o + 5] += Math.cos(age * 7.3 + o) * w * dt;
      }
      d[o] += d[o + 3] * dt;
      d[o + 1] += d[o + 4] * dt;
      d[o + 2] += d[o + 5] * dt;
      d[o + 19] += d[o + 20] * dt;
      i++;
    }
  }

  commit() {
    const d = this.d;
    const b = this.batch;
    b.begin();
    for (let i = 0; i < this.n; i++) {
      const o = i * S;
      const life = d[o + 7];
      const age = d[o + 6];
      const t = life > 0 ? age / life : 0;
      const u = 1 - t;
      const size = d[o + 8] + (d[o + 9] - d[o + 8]) * t;
      const fi = d[o + 25];
      const fade = (fi > 0 ? Math.min(1, age / fi) : 1) * (life > 0 ? Math.min(1, u * 2) : 1);
      const st = d[o + 22];
      b.push(
        d[o], d[o + 1], d[o + 2],
        d[o + 3] * st, d[o + 4] * st, d[o + 5] * st,
        d[o + 10] * u + d[o + 13] * t, d[o + 11] * u + d[o + 14] * t, d[o + 12] * u + d[o + 15] * t,
        d[o + 16] * fade, size, d[o + 19], d[o + 21], d[o + 23],
      );
    }
    b.commit();
  }

  clear() {
    this.n = 0;
  }
}

// Parâmetros de emissão reutilizáveis (evita alocar objetos por partícula).
class Emit {
  constructor() {
    this.c0 = new THREE.Color();
    this.c1 = new THREE.Color();
    this.reset();
  }
  reset() {
    this.x = this.y = this.z = 0;
    this.vx = this.vy = this.vz = 0;
    this.life = 0.5; this.s0 = 0.3; this.s1 = -1;
    this.c0.setRGB(1, 1, 1); this.useC1 = false;
    this.a = 1; this.drag = 0; this.grav = 0;
    this.rot = Math.random() * TAU; this.spin = 0; this.shape = SHAPE.GLOW;
    this.stretch = 0; this.hot = 0; this.wob = 0; this.fadeIn = 0;
    return this;
  }
  at(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  vel(x, y, z) { this.vx = x; this.vy = y; this.vz = z; return this; }
  col(c0, c1) {
    setCol(this.c0, c0);
    if (c1 !== undefined && c1 !== null) { setCol(this.c1, c1); this.useC1 = true; }
    return this;
  }
}

function setCol(out, c) {
  if (c && c.isColor) out.copy(c);
  else out.setHex(c);
  return out;
}

// ---------------------------------------------------------------------------
// Raios (fitas de frente para a câmera, núcleo + brilho) num único draw call.
// ---------------------------------------------------------------------------
const BOLT_VS = /* glsl */ `
attribute vec4 aCol;
attribute float aSide;
varying vec4 vCol;
varying float vSide;
void main() {
  vCol = aCol;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BOLT_FS = /* glsl */ `
varying vec4 vCol;
varying float vSide;
void main() {
  float f = 1.0 - vSide * vSide;
  gl_FragColor = vec4(vCol.rgb, vCol.a * f * f);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class BoltBatch {
  constructor(max = 32, segs = 12) {
    this.max = max;
    this.segs = segs;
    const P = segs + 1;
    this.P = P;
    this.vPer = P * 4; // 2 fitas × P pontos × 2 lados
    this.iPer = segs * 12; // 2 fitas × segs quads × 6 índices
    const nV = max * this.vPer;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(nV * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const side = new Float32Array(nV);
    for (let i = 0; i < nV; i++) side[i] = i % 2 ? 1 : -1;
    const idx = new Uint16Array(max * this.iPer);
    let k = 0;
    for (let b = 0; b < max; b++) {
      for (let r = 0; r < 2; r++) {
        const base = b * this.vPer + r * P * 2;
        for (let s = 0; s < segs; s++) {
          const i0 = base + s * 2;
          idx[k++] = i0; idx[k++] = i0 + 1; idx[k++] = i0 + 3;
          idx[k++] = i0; idx[k++] = i0 + 3; idx[k++] = i0 + 2;
        }
      }
    }
    g.setAttribute('position', this.aPos);
    g.setAttribute('aCol', this.aCol);
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: BOLT_VS, fragmentShader: BOLT_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 14;
    this.mesh.visible = false;
    this.bolts = [];
    for (let i = 0; i < max; i++) {
      this.bolts.push({
        a: new THREE.Vector3(), b: new THREE.Vector3(), offA: new THREE.Vector3(), offB: new THREE.Vector3(),
        follow: null, parent: null, parentIdx: 0, freeEnd: false,
        age: 0, life: 0, amp: 1, wGlow: 1, wCore: 0.2, taper: 0.5,
        cGlow: new THREE.Color(), cCore: new THREE.Color(), alpha: 1,
        jit: new Float32Array(P * 2), pts: new Float32Array(P * 3), rejit: 0, flick: 1,
      });
    }
    this.n = 0;
    this._rP = { start: 0, count: 0 };
    this._rC = { start: 0, count: 0 };
  }

  // o: { a, b, follow, parent, parentIdx, freeEnd, life, amp, wGlow, wCore, glow, core, alpha, taper }
  spawn(o) {
    let bl;
    if (this.n < this.max) bl = this.bolts[this.n++];
    else if (o.force) {
      // pool cheio: reaproveita o raio mais adiantado na vida
      bl = this.bolts[0];
      for (let i = 1; i < this.n; i++) if (this.bolts[i].age / this.bolts[i].life > bl.age / bl.life) bl = this.bolts[i];
    } else return null;
    bl.follow = o.follow || null;
    bl.parent = o.parent || null;
    bl.parentIdx = o.parentIdx || 0;
    bl.freeEnd = !!o.freeEnd;
    if (bl.follow) {
      bl.offA.copy(o.a).sub(bl.follow.position);
      bl.offB.copy(o.b).sub(bl.follow.position);
    }
    bl.a.copy(o.a);
    bl.b.copy(o.b);
    bl.age = 0;
    bl.life = o.life ?? 0.3;
    bl.amp = o.amp ?? 0.5;
    bl.wGlow = o.wGlow ?? 0.8;
    bl.wCore = o.wCore ?? 0.14;
    bl.taper = o.taper ?? 0.5;
    bl.alpha = o.alpha ?? 1;
    setCol(bl.cGlow, o.glow ?? 0x8f6bff);
    setCol(bl.cCore, o.core ?? 0xf4eeff);
    bl.rejit = 0;
    return bl;
  }

  clear() {
    this.n = 0;
    this.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  update(dt, camera) {
    let i = 0;
    while (i < this.n) {
      const bl = this.bolts[i];
      bl.age += dt;
      if (bl.age >= bl.life) {
        this.n--;
        this.bolts[i] = this.bolts[this.n];
        this.bolts[this.n] = bl;
        continue;
      }
      i++;
    }
    const n = this.n;
    this.mesh.visible = n > 0 && !!camera;
    this.geometry.setDrawRange(0, n * this.iPer);
    if (!n || !camera) return;
    const cam = camera.position;
    const P = this.P;
    const segs = this.segs;
    const pos = this.aPos.array;
    const col = this.aCol.array;
    for (let b = 0; b < n; b++) {
      const bl = this.bolts[b];
      if (bl.follow) {
        bl.a.copy(bl.follow.position).add(bl.offA);
        bl.b.copy(bl.follow.position).add(bl.offB);
      }
      if (bl.parent) {
        const pp = bl.parent.pts;
        const k = bl.parentIdx * 3;
        bl.a.set(pp[k], pp[k + 1], pp[k + 2]);
      }
      bl.rejit -= dt;
      if (bl.rejit <= 0) {
        bl.rejit = 0.04 + Math.random() * 0.03;
        bl.flick = 0.55 + Math.random() * 0.45;
        const j = bl.jit;
        // deslocamento aleatório suavizado (mais parecido com raio de verdade)
        let px = 0;
        let py = 0;
        for (let k = 0; k < P; k++) {
          px = px * 0.35 + (Math.random() * 2 - 1);
          py = py * 0.35 + (Math.random() * 2 - 1);
          j[k * 2] = px;
          j[k * 2 + 1] = py;
        }
      }
      // eixos perpendiculares ao raio
      _d.subVectors(bl.b, bl.a);
      const len = _d.length() || 1;
      _d.multiplyScalar(1 / len);
      _p1.set(0, 1, 0);
      if (Math.abs(_d.y) > 0.9) _p1.set(1, 0, 0);
      _p1.cross(_d).normalize();
      _p2.crossVectors(_d, _p1);
      const pts = bl.pts;
      const amp = bl.amp;
      for (let k = 0; k < P; k++) {
        const t = k / segs;
        const env = bl.freeEnd ? Math.min(1, t * 3) : Math.sin(Math.PI * t);
        const j1 = bl.jit[k * 2] * amp * env;
        const j2 = bl.jit[k * 2 + 1] * amp * env;
        pts[k * 3] = bl.a.x + _d.x * len * t + _p1.x * j1 + _p2.x * j2;
        pts[k * 3 + 1] = bl.a.y + _d.y * len * t + _p1.y * j1 + _p2.y * j2;
        pts[k * 3 + 2] = bl.a.z + _d.z * len * t + _p1.z * j1 + _p2.z * j2;
      }
      const e = bl.age / bl.life;
      const alpha = bl.alpha * Math.sqrt(1 - e) * bl.flick;
      for (let r = 0; r < 2; r++) {
        const w = r ? bl.wCore : bl.wGlow;
        const c = r ? bl.cCore : bl.cGlow;
        const al = r ? alpha : alpha * 0.6;
        const base = b * this.vPer + r * P * 2;
        for (let k = 0; k < P; k++) {
          const k0 = Math.max(0, k - 1) * 3;
          const k1 = Math.min(segs, k + 1) * 3;
          _t.set(pts[k1] - pts[k0], pts[k1 + 1] - pts[k0 + 1], pts[k1 + 2] - pts[k0 + 2]);
          _c.set(cam.x - pts[k * 3], cam.y - pts[k * 3 + 1], cam.z - pts[k * 3 + 2]);
          _s.crossVectors(_t, _c);
          const sl = _s.length() || 1;
          const hw = (w * 0.5 * (1 - bl.taper * (k / segs))) / sl;
          const v0 = (base + k * 2) * 3;
          pos[v0] = pts[k * 3] - _s.x * hw;
          pos[v0 + 1] = pts[k * 3 + 1] - _s.y * hw;
          pos[v0 + 2] = pts[k * 3 + 2] - _s.z * hw;
          pos[v0 + 3] = pts[k * 3] + _s.x * hw;
          pos[v0 + 4] = pts[k * 3 + 1] + _s.y * hw;
          pos[v0 + 5] = pts[k * 3 + 2] + _s.z * hw;
          const c0 = (base + k * 2) * 4;
          col[c0] = col[c0 + 4] = c.r;
          col[c0 + 1] = col[c0 + 5] = c.g;
          col[c0 + 2] = col[c0 + 6] = c.b;
          col[c0 + 3] = col[c0 + 7] = al;
        }
      }
    }
    this._rP.count = n * this.vPer * 3;
    this._rC.count = n * this.vPer * 4;
    this.aPos.updateRanges.length = 0;
    this.aPos.updateRanges.push(this._rP);
    this.aCol.updateRanges.length = 0;
    this.aCol.updateRanges.push(this._rC);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Geometrias e materiais procedurais
// ---------------------------------------------------------------------------

// Chama do escapamento: dois cones (externo laranja, interno branco) apontando para -Z.
export function buildFlameGeometry() {
  const cone = (r, len, cBase, cTip) => {
    const g = new THREE.ConeGeometry(r, len, 12, 3, true);
    g.rotateX(-Math.PI / 2); // ponta para -Z
    g.translate(0, 0, -len / 2);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const a = new THREE.Color(cBase);
    const b = new THREE.Color(cTip);
    for (let i = 0; i < p.count; i++) {
      const t = clamp(-p.getZ(i) / len, 0, 1);
      const k = Math.pow(1 - t, 1.3);
      col[i * 3] = (a.r * (1 - t) + b.r * t) * k;
      col[i * 3 + 1] = (a.g * (1 - t) + b.g * t) * k;
      col[i * 3 + 2] = (a.b * (1 - t) + b.b * t) * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  return mergeGeometries([cone(1, 1, 0xffc070, 0xff3000), cone(0.5, 0.55, 0xffffff, 0xffd080)]);
}

// Gaiola de Faraday: meridianos + paralelos feitos de tubos finos.
function buildCageGeometry(lowQ) {
  const parts = [];
  const tube = 0.022;
  const rs = lowQ ? 3 : 4;
  for (let i = 0; i < 5; i++) {
    const g = new THREE.TorusGeometry(1, tube, rs, lowQ ? 28 : 40);
    g.rotateY((i * Math.PI) / 5);
    parts.push(g);
  }
  for (const y of [-0.3, 0.12, 0.5, 0.8]) {
    const r = Math.sqrt(1 - y * y);
    const g = new THREE.TorusGeometry(r, tube, rs, lowQ ? 28 : 40);
    g.rotateX(Math.PI / 2);
    g.translate(0, y, 0);
    parts.push(g);
  }
  // nós nas interseções do topo
  const knob = new THREE.SphereGeometry(0.06, 8, 6);
  knob.translate(0, 1, 0);
  parts.push(knob);
  return mergeGeometries(parts);
}

const SHELL_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vP = position;
  gl_Position = projectionMatrix * mv;
}`;
const SHELL_FS = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(f, 2.2);
  float bands = 0.5 + 0.5 * sin(vP.y * 18.0 - uTime * 7.0 + sin(vP.x * 5.0 + uTime) * 2.0);
  float a = (rim * 0.9 + 0.05 + bands * 0.07 * (0.3 + rim)) * uAlpha;
  gl_FragColor = vec4(uColor * (0.6 + rim), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function ringTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  gr.addColorStop(0.72, 'rgba(255,255,255,0.25)');
  gr.addColorStop(0.86, 'rgba(255,255,255,1)');
  gr.addColorStop(0.93, 'rgba(255,255,255,0.4)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(cv);
  return t;
}

// ---------------------------------------------------------------------------
// Paleta (cores lineares prontas, sem conversão por quadro)
// ---------------------------------------------------------------------------
const C = (h) => new THREE.Color(h);
const PAL = {
  white: C(0xffffff),
  sparkWarm: C(0xfff3c4),
  sparkWarm2: C(0xffb347),
  drift: [C(0xfff0b0), C(0x3fa9ff), C(0xff9f1c), C(0xc77dff)],
  driftEnd: [C(0xff9a2e), C(0x1f5cff), C(0xff4d00), C(0x7a2cff)],
  flame0: C(0xffe39a),
  flame1: C(0xff3d0a),
  smokeDark: C(0x2c2c30),
  smokeMid: C(0x6d6d72),
  smokeLight: C(0xb9b9be),
  dust: C(0x8f6d45),
  dust2: C(0xc9a877),
  fire0: C(0xfff0b0),
  fire1: C(0xff5a14),
  fire2: C(0x9a1c00),
  purple0: C(0xf0c8ff),
  purple1: C(0x7b2cbf),
  orangeHot: C(0xffa040),
  blue0: C(0xe6f7ff),
  blue1: C(0x2f7dff),
  electric: C(0xa8d8ff),
  star: C(0xffe14d),
  apple: C(0xd61f2c),
  appleFlesh: C(0xfff1c7),
  leaf: C(0x47b53a),
  confetti: [0xff3b3b, 0xffd23f, 0x3ddc84, 0x4cc9f0, 0xb388ff, 0xff7bd5, 0xff9f1c, 0xffffff].map(C),
  flameTint: C(0xffffff),
  atomIcon: C(0x3fa9ff),
  flameHot: C(0xffc458),
};
const H = (h, k) => new THREE.Color(h).multiplyScalar(k); // cor "HDR" (> 1)
const EXP = {
  fire: {
    flash: C(0xffd890), core: H(0xffa52e, 1.45), mid: C(0xb52200), glow: C(0xff6a10),
    spark0: C(0xffd060), spark1: C(0xff4000), ring: C(0xff7a1a), smoke0: C(0x3a3a3e), smoke1: C(0x7a7a80),
  },
  purple: {
    flash: C(0xd9a6ff), core: H(0xa35cff, 1.15), mid: C(0x33096e), glow: C(0x7a2cff),
    spark0: C(0xffc6ff), spark1: C(0xff7a1a), ring: C(0xb266ff), smoke0: C(0x2a1840), smoke1: C(0x5d4b70),
  },
  blue: {
    flash: C(0xb8e8ff), core: H(0x74d2ff, 1.3), mid: C(0x1640b8), glow: C(0x2f8dff),
    spark0: C(0xd8f4ff), spark1: C(0x2f8dff), ring: C(0x5cc0ff), smoke0: C(0x3a4450), smoke1: C(0x7a8490),
  },
};

// temporários
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _t = new THREE.Vector3();
const _c = new THREE.Vector3();
const _s = new THREE.Vector3();
const _back = new THREE.Vector3();
const _right = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _sc = new THREE.Vector3();
const _col = new THREE.Color();
const _col2 = new THREE.Color();
const _camF = new THREE.Vector3();
const _camR = new THREE.Vector3();
const _camU = new THREE.Vector3();
const _bp = new THREE.Vector3();

const PIPES = [[0.3, 0.45, -0.95], [-0.3, 0.45, -0.95]];
const WHEELS = [[0.6, 0.1, -0.62], [-0.6, 0.1, -0.62]];
const easeOutBack = (t) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------
export class Effects {
  constructor({ scene, bus, quality }) {
    this.scene = scene;
    this.bus = bus;
    this.quality = quality || { particles: 1 };
    this.q = clamp(this.quality.particles ?? 1, 0.2, 1.5);
    const lowQ = this.quality.id === 'baixa';
    this.root = new THREE.Group();
    this.root.name = 'effects';
    scene.add(this.root);

    this.alpha = new ParticlePool(Math.round(1400 * this.q), false, 11);
    this.add = new ParticlePool(Math.round(2800 * this.q), true, 12);
    this.root.add(this.alpha.batch.mesh, this.add.batch.mesh);
    this.bolts = new BoltBatch(lowQ ? 32 : 48, lowQ ? 9 : 12);
    this.root.add(this.bolts.mesh);
    this._e = new Emit();

    // chamas de turbo (cones instanciados)
    this.flames = new THREE.InstancedMesh(
      buildFlameGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      16,
    );
    for (let i = 0; i < 16; i++) this.flames.setColorAt(i, PAL.white);
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 12;
    this.flames.count = 0;
    this.root.add(this.flames);

    // ondas de choque (anéis no chão)
    const ringGeo = new THREE.PlaneGeometry(2, 2);
    ringGeo.rotateX(-Math.PI / 2);
    const ringTex = ringTexture();
    this.rings = [];
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 10;
      this.root.add(mesh);
      this.rings.push({ mesh, mat, age: 0, life: 1, r0: 1, r1: 2, a: 1, active: false });
    }

    // gaiolas de Faraday (uma por kart ativo)
    const cageGeo = buildCageGeometry(lowQ);
    const cageMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ef, metalness: 0.55, roughness: 0.28, emissive: 0x5a8cff, emissiveIntensity: 0.55 });
    const shellGeo = new THREE.SphereGeometry(1, lowQ ? 20 : 28, lowQ ? 14 : 20);
    const shellBase = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new THREE.Color(0x7fb8ff) } },
      vertexShader: SHELL_VS, fragmentShader: SHELL_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.cages = [];
    for (let i = 0; i < 8; i++) {
      const group = new THREE.Group();
      const cage = new THREE.Mesh(cageGeo, cageMat);
      const shellMat = shellBase.clone();
      const shell = new THREE.Mesh(shellGeo, shellMat);
      shell.scale.setScalar(1.03);
      shell.renderOrder = 9;
      group.add(cage, shell);
      group.visible = false;
      this.root.add(group);
      this.cages.push({ group, cage, shell, shellMat, used: false });
    }

    this.kstate = new Map();
    this.world = null;
    this.time = 0;
    this.confettiT = 0;
    this.confettiKart = null;
    this._warm = false;
    this._frame = 0;
    this._confAcc = 0;
    this._strAcc = 0;
    this._flashEl = null;
    this._off = [];
    if (bus) this._listen(bus);
  }

  // ---------------------------------------------------------------- eventos
  _listen(bus) {
    const on = (n, f) => this._off.push(bus.on(n, f));
    on('kart:boost', (e) => e?.kart && this._boostPuff(e.kart, e.source));
    on('kart:hit', (e) => {
      if (!e?.kart) return;
      const k = e.kart;
      _v.copy(k.position).addScaledVector(UP, 1.3 * this._scaleOf(k));
      if (e.type === 'shock') this.burst('electric', _v, { kart: k, scale: 0.9, bolts: 0 });
      else {
        this.burst('stars', _v, { scale: e.type === 'tumble' ? 1.4 : 1 });
        _v.copy(k.position).addScaledVector(UP, 0.6);
        this.burst('smoke', _v, { scale: e.type === 'tumble' ? 1.3 : 0.8 });
      }
    });
    on('kart:wall', (e) => e?.kart && this._wallSparks(e.kart, e.strength ?? 1));
    on('kart:land', (e) => {
      if (!e?.kart || !(e.airTime > 0.3)) return;
      this.burst('dust', e.kart.position, { scale: clamp(0.7 + e.airTime * 0.4, 0.7, 1.6) });
    });
    on('kart:driftLevel', (e) => e?.kart && e.level > 0 && this._driftLevelUp(e.kart, e.level));
    on('item:pickup', (e) => e?.pos && this.burst('pickup', e.pos, { vel: e.kart?.velocity }));
    on('item:explode', (e) => {
      if (!e?.pos) return;
      switch (e.item) {
        case 'maca': this.burst('apple', e.pos); break;
        case 'alfa': this.burst('explosion', e.pos, { scale: 0.75 }); break;
        case 'eletron': this.burst('explosion', e.pos, { scale: 0.8, palette: 'blue' }); break;
        case 'buraco': this.burst('explosion', e.pos, { scale: 1.45, palette: 'purple' }); break;
        case 'break': this.burst('sparks', e.pos, { count: 14 }); break;
        default: this.burst('explosion', e.pos, { scale: 0.8 });
      }
    });
    on('item:lightning', (e) => this._lightning(e?.by));
    on('item:blackhole', (e) => {
      if (!e?.pos) return;
      this.flash(0x6a2cbf, 0.45, 0.35);
      this._ring(e.pos, 0.2, PAL.purple0, 1, 12, 0.7, 0.9);
    });
    on('race:finish', (e) => {
      if (e?.kart?.isPlayer) this.confetti(e.kart);
    });
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
    this.scene.remove(this.root);
  }

  // ---------------------------------------------------------------- API
  reset() {
    this.add.clear();
    this.alpha.clear();
    this.add.commit();
    this.alpha.commit();
    this.bolts.clear();
    for (const r of this.rings) { r.active = false; r.mesh.visible = false; }
    for (const c of this.cages) { c.used = false; c.group.visible = false; }
    this.flames.count = 0;
    this.kstate.clear();
    this.confettiT = 0;
    this.confettiKart = null;
    if (this._flashEl) {
      this._flashEl.style.transition = 'none';
      this._flashEl.style.opacity = '0';
    }
  }

  // Flash de tela: overlay DOM #flash com opacidade que some.
  flash(color = 0xffffff, duration = 0.3, strength = 0.6) {
    if (typeof document === 'undefined') return;
    let el = this._flashEl || document.getElementById('flash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'flash';
      document.body.appendChild(el);
    }
    Object.assign(el.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '50' });
    this._flashEl = el;
    const css = typeof color === 'string' ? color : '#' + (color >>> 0).toString(16).padStart(6, '0');
    el.style.transition = 'none';
    el.style.background = css;
    el.style.opacity = String(strength);
    void el.offsetWidth; // força reflow para reiniciar a transição
    el.style.transition = `opacity ${Math.max(0.05, duration)}s ease-out`;
    el.style.opacity = '0';
  }

  confetti(kart) {
    this.confettiKart = kart;
    this.confettiT = 3.2;
    // canhões de confete dos dois lados (acompanham o kart)
    const e = this._e;
    const o = kart.object3d;
    const kv = kart.velocity;
    const n = Math.round(80 * this.q);
    for (const side of [-1, 1]) {
      this._lw(o, 1, side * 0.9, 1.0, 0.3, _v);
      _right.set(side, 0, 0).applyQuaternion(o.quaternion);
      for (let i = 0; i < n; i++) {
        e.reset().at(_v);
        e.vel(_right.x * rand(1, 4) + rand(-1.5, 1.5), rand(5, 9), _right.z * rand(1, 4) + rand(-1.5, 1.5));
        if (kv) { e.vx += kv.x; e.vz += kv.z; }
        this._confettiP(e);
        e.grav = 6; e.drag = 0; e.life = rand(1.2, 1.8);
        this.alpha.spawn(e);
      }
    }
  }

  // parâmetros comuns do confete (sem arrasto: acompanha o kart; cai devagar e balança)
  _confettiP(e) {
    e.col(PAL.confetti[(Math.random() * PAL.confetti.length) | 0]);
    e.life = rand(2.2, 3.2);
    e.s0 = rand(0.2, 0.3);
    e.drag = 0;
    e.grav = 1.1;
    e.wob = 5;
    e.spin = rand(-9, 9);
    e.shape = Math.random() < 0.8 ? SHAPE.SQUARE : SHAPE.SHARD;
  }

  // Explosões e outros efeitos pontuais.
  burst(type, pos, opts = {}) {
    if (!pos) return;
    pos = _bp.copy(pos); // cópia: quem chama pode passar um temporário
    const q = this.q;
    const sc = opts.scale ?? 1;
    const e = this._e;
    const cnt = (n) => Math.max(1, Math.round(n * q * (opts.countMul ?? 1)));
    switch (type) {
      case 'explosion': {
        const P = opts.palette === 'purple' ? EXP.purple : opts.palette === 'blue' ? EXP.blue : EXP.fire;
        const k = Math.min(sc, 1.7);
        // clarão
        e.reset().at(pos).col(P.flash);
        e.life = 0.14; e.s0 = 3 * sc; e.s1 = 5 * sc; e.hot = 0.6; e.a = 0.6;
        this.add.spawn(e);
        // bola de fogo (mistura normal: lê bem contra o céu claro)
        for (let i = 0, n = cnt(20 * k); i < n; i++) {
          _v.randomDirection();
          const sp = rand(2, 7) * sc;
          e.reset().at(pos).vel(_v.x * sp, _v.y * sp * 0.6 + 1.5 * sc, _v.z * sp);
          e.x += _v.x * 0.5 * sc; e.y += _v.y * 0.35 * sc; e.z += _v.z * 0.5 * sc;
          e.col(P.core, P.mid);
          e.life = rand(0.4, 0.75); e.s0 = rand(1.1, 1.7) * sc; e.s1 = rand(2.4, 3.4) * sc;
          e.drag = 4; e.grav = -3; e.hot = 0.15; e.shape = SHAPE.SMOKE; e.spin = rand(-2, 2);
          this.alpha.spawn(e);
        }
        // brilho aditivo por cima
        for (let i = 0, n = Math.max(2, Math.round(5 * k)); i < n; i++) {
          _v.randomDirection();
          e.reset().at(pos).vel(_v.x * 3 * sc, _v.y * 2 * sc + 1, _v.z * 3 * sc).col(P.glow);
          e.life = rand(0.25, 0.4); e.s0 = 2.6 * sc; e.s1 = 4 * sc; e.a = 0.28; e.hot = 0; e.drag = 3;
          this.add.spawn(e);
        }
        // faíscas
        for (let i = 0, n = cnt(30 * k); i < n; i++) {
          _v.randomDirection();
          if (_v.y < -0.2) _v.y = -_v.y;
          const sp = rand(9, 22) * sc;
          e.reset().at(pos).vel(_v.x * sp, _v.y * sp + 3, _v.z * sp).col(P.spark0, P.spark1);
          e.life = rand(0.4, 0.9); e.s0 = 0.14 * Math.sqrt(sc); e.s1 = 0.05;
          e.drag = 1.2; e.grav = 14; e.stretch = 0.045; e.hot = 0.2; e.shape = SHAPE.SPARK;
          this.add.spawn(e);
        }
        // fumaça que aparece depois do fogo
        for (let i = 0, n = cnt(12 * k); i < n; i++) {
          _v.randomDirection();
          e.reset().at(pos).vel(_v.x * 2.5 * sc, rand(1.5, 3.5) * sc, _v.z * 2.5 * sc);
          e.col(P.smoke0, P.smoke1);
          e.life = rand(1.2, 2.0); e.s0 = 1.3 * Math.min(sc, 1.2); e.s1 = rand(3.0, 4.0) * Math.min(sc, 1.2);
          e.drag = 1.6; e.grav = -0.7; e.a = sc > 1.2 ? 0.4 : 0.55; e.fadeIn = 0.3; e.shape = SHAPE.SMOKE; e.spin = rand(-0.8, 0.8);
          this.alpha.spawn(e);
        }
        // detritos escuros
        for (let i = 0, n = cnt(8 * k); i < n; i++) {
          _v.randomDirection();
          e.reset().at(pos).vel(_v.x * 9 * sc, rand(5, 11), _v.z * 9 * sc).col(0x241a14);
          e.life = rand(0.6, 1.0); e.s0 = rand(0.12, 0.22) * Math.min(sc, 1.1); e.grav = 20; e.drag = 0.6;
          e.shape = SHAPE.SHARD; e.spin = rand(-12, 12);
          this.alpha.spawn(e);
        }
        _v.copy(pos); _v.y -= 0.45;
        this._ring(_v, 0.4 * sc, P.ring, 0.5, 7.5 * sc, 0.55);
        if (sc > 1.2) this._ring(_v, 0.4 * sc, P.flash, 0.8, 11 * sc, 0.4);
        break;
      }
      case 'sparks': {
        const n = cnt(opts.count ?? 18);
        const dir = opts.dir;
        const base = opts.vel;
        for (let i = 0; i < n; i++) {
          _v.randomDirection();
          if (dir) { _v.addScaledVector(dir, 1.3).normalize(); }
          if (_v.y < 0) _v.y *= -0.5;
          const sp = rand(5, 12) * sc;
          e.reset().at(pos).vel(_v.x * sp, _v.y * sp + 2, _v.z * sp);
          if (base) { e.vx += base.x; e.vy += base.y; e.vz += base.z; }
          e.col(opts.color ?? PAL.sparkWarm, PAL.sparkWarm2);
          e.life = rand(0.25, 0.55); e.s0 = 0.1 * sc; e.s1 = 0.04;
          e.grav = 15; e.drag = 1.5; e.stretch = 0.04; e.hot = 0.9; e.shape = SHAPE.SPARK;
          this.add.spawn(e);
        }
        e.reset().at(pos).col(opts.color ?? PAL.sparkWarm2);
        e.life = 0.12; e.s0 = 1.4 * sc; e.s1 = 0.4; e.hot = 0.8;
        if (base) e.vel(base.x, base.y, base.z);
        this.add.spawn(e);
        break;
      }
      case 'confetti': {
        const n = cnt(opts.count ?? 120);
        for (let i = 0; i < n; i++) {
          _v.randomDirection();
          e.reset().at(pos).vel(_v.x * 5 * sc, rand(4, 8) * sc, _v.z * 5 * sc);
          if (opts.vel) { e.vx += opts.vel.x; e.vz += opts.vel.z; }
          this._confettiP(e);
          e.grav = 5; e.life = rand(1.5, 2.5);
          this.alpha.spawn(e);
        }
        break;
      }
      case 'smoke': {
        for (let i = 0, n = cnt(8 * sc); i < n; i++) {
          _v.randomDirection();
          e.reset().at(pos).vel(_v.x * 1.5, rand(0.8, 2.2), _v.z * 1.5);
          e.x += _v.x * 0.4; e.z += _v.z * 0.4;
          e.col(opts.color ?? PAL.smokeLight, PAL.smokeMid);
          e.life = rand(0.8, 1.3); e.s0 = 0.6 * sc; e.s1 = 1.8 * sc; e.drag = 2; e.a = 0.55;
          e.fadeIn = 0.1; e.shape = SHAPE.SMOKE; e.spin = rand(-1, 1);
          this.alpha.spawn(e);
        }
        break;
      }
      case 'electric': {
        const k = opts.kart || null;
        const nb = Math.round((opts.bolts ?? 5) * Math.min(1.5, sc));
        for (let i = 0; i < nb; i++) {
          _v.randomDirection().multiplyScalar(rand(0.9, 1.7) * sc).add(pos);
          this.bolts.spawn({
            a: pos, b: _v, follow: k, life: rand(0.12, 0.26), amp: 0.22 * sc,
            wGlow: 0.45 * sc, wCore: 0.07 * sc, glow: 0x4f8dff, core: 0xeaf6ff, freeEnd: true, taper: 0.8,
          });
        }
        for (let i = 0, n = cnt(16 * sc); i < n; i++) {
          _v.randomDirection();
          const sp = rand(3, 9) * sc;
          e.reset().at(pos).vel(_v.x * sp, _v.y * sp + 1, _v.z * sp).col(PAL.blue0, PAL.blue1);
          if (k && k.velocity) { e.vx += k.velocity.x; e.vy += k.velocity.y; e.vz += k.velocity.z; }
          e.life = rand(0.2, 0.45); e.s0 = 0.09 * sc; e.s1 = 0.03; e.grav = 6; e.drag = 2;
          e.stretch = 0.035; e.hot = 1; e.shape = SHAPE.SPARK;
          this.add.spawn(e);
        }
        e.reset().at(pos).col(PAL.electric);
        if (k && k.velocity) e.vel(k.velocity.x, k.velocity.y, k.velocity.z);
        e.life = 0.18; e.s0 = 2.4 * sc; e.s1 = 1; e.hot = 0.7; e.a = 0.9;
        this.add.spawn(e);
        break;
      }
      case 'pickup': {
        const n = cnt(24);
        for (let i = 0; i < n; i++) {
          _v.randomDirection();
          const sp = rand(4, 10);
          e.reset().at(pos).vel(_v.x * sp, _v.y * sp * 0.7 + 3.5, _v.z * sp);
          if (opts.vel) { e.vx += opts.vel.x * 0.7; e.vz += opts.vel.z * 0.7; }
          _col.setHSL(Math.random(), 1, 0.5);
          e.c0.copy(_col);
          e.life = rand(0.55, 0.95); e.s0 = rand(0.24, 0.38); e.s1 = 0.06;
          e.grav = 13; e.drag = 1.4; e.spin = rand(-14, 14); e.shape = SHAPE.SHARD;
          this.alpha.spawn(e);
        }
        for (let i = 0, m = cnt(14); i < m; i++) {
          _v.randomDirection();
          const sp = rand(2, 6);
          e.reset().at(pos).vel(_v.x * sp, _v.y * sp + 2, _v.z * sp);
          _col.setHSL(Math.random(), 1, 0.55);
          e.c0.copy(_col);
          e.life = rand(0.4, 0.7); e.s0 = rand(0.3, 0.5); e.s1 = 0.05; e.drag = 2.5; e.grav = 2;
          e.shape = SHAPE.STAR; e.hot = 0.25; e.spin = rand(-4, 4);
          this.add.spawn(e);
        }
        e.reset().at(pos).col(PAL.white);
        e.life = 0.16; e.s0 = 2.8; e.s1 = 3.8; e.hot = 0.6; e.a = 0.7;
        this.add.spawn(e);
        break;
      }
      case 'dust': {
        const n = cnt(16 * sc);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + rand(-0.2, 0.2);
          const sp = rand(2.5, 5) * sc;
          e.reset().at(pos).vel(Math.cos(a) * sp, rand(0.4, 1.4), Math.sin(a) * sp);
          e.y += 0.15;
          e.col(opts.color ?? PAL.dust2, PAL.dust);
          e.life = rand(0.6, 1.0); e.s0 = 0.5 * sc; e.s1 = 1.8 * sc; e.drag = 3.5; e.a = 0.55;
          e.fadeIn = 0.06; e.shape = SHAPE.SMOKE; e.spin = rand(-1, 1);
          this.alpha.spawn(e);
        }
        break;
      }
      case 'stars': {
        const n = Math.max(4, Math.round(7 * sc));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          e.reset().at(pos).vel(Math.cos(a) * 3.5, rand(3, 6), Math.sin(a) * 3.5).col(PAL.star);
          e.life = rand(0.6, 0.85); e.s0 = 0.55; e.s1 = 0.25; e.grav = 9; e.drag = 1;
          e.shape = SHAPE.STAR; e.spin = rand(-6, 6);
          this.alpha.spawn(e);
        }
        e.reset().at(pos).col(0xfff2a0);
        e.life = 0.15; e.s0 = 1.8; e.s1 = 2.4; e.hot = 0.8; e.a = 0.7;
        this.add.spawn(e);
        break;
      }
      case 'flame': {
        for (let i = 0, n = cnt(10 * sc); i < n; i++) {
          _v.randomDirection();
          e.reset().at(pos).vel(_v.x * 3 * sc, _v.y * 3 * sc + 1, _v.z * 3 * sc).col(opts.color ?? PAL.flame0, PAL.flame1);
          if (opts.vel) { e.vx += opts.vel.x; e.vy += opts.vel.y; e.vz += opts.vel.z; }
          e.life = rand(0.2, 0.35); e.s0 = 0.5 * sc; e.s1 = 0.1; e.drag = 3; e.hot = 0.7; e.shape = SHAPE.GLOW;
          this.add.spawn(e);
        }
        break;
      }
      case 'apple': {
        for (let i = 0, n = cnt(22); i < n; i++) {
          _v.randomDirection();
          const sp = rand(3, 8);
          e.reset().at(pos).vel(_v.x * sp, Math.abs(_v.y) * sp + 3, _v.z * sp);
          e.col(Math.random() < 0.65 ? PAL.apple : PAL.appleFlesh);
          e.life = rand(0.5, 0.9); e.s0 = rand(0.18, 0.32); e.s1 = 0.08; e.grav = 16; e.drag = 1;
          e.shape = Math.random() < 0.5 ? SHAPE.SHARD : SHAPE.SQUARE; e.spin = rand(-12, 12);
          this.alpha.spawn(e);
        }
        for (let i = 0; i < 3; i++) {
          e.reset().at(pos).vel(rand(-2, 2), rand(4, 7), rand(-2, 2)).col(PAL.leaf);
          e.life = 0.9; e.s0 = 0.3; e.grav = 9; e.drag = 1.5; e.shape = SHAPE.SHARD; e.spin = rand(-8, 8);
          this.alpha.spawn(e);
        }
        e.reset().at(pos).col(0xff8080);
        e.life = 0.15; e.s0 = 2.6; e.s1 = 3.4; e.hot = 0.8; e.a = 0.7;
        this.add.spawn(e);
        this.burst('smoke', pos, { scale: 0.6, color: 0xffd0d0 });
        break;
      }
      case 'implosion': {
        // partículas caindo para o centro
        for (let i = 0, n = cnt(40 * sc); i < n; i++) {
          _v.randomDirection();
          const r = rand(2.5, 5.5) * sc;
          const life = rand(0.25, 0.4);
          e.reset().vel(-_v.x * r / life, -_v.y * r / life, -_v.z * r / life);
          e.x = pos.x + _v.x * r; e.y = pos.y + _v.y * r; e.z = pos.z + _v.z * r;
          if (opts.vel) { e.vx += opts.vel.x; e.vy += opts.vel.y; e.vz += opts.vel.z; }
          e.col(Math.random() < 0.5 ? PAL.purple1 : PAL.orangeHot, PAL.purple0);
          e.life = life; e.s0 = 0.1; e.s1 = 0.05; e.stretch = 0.03; e.hot = 0.2; e.a = 0.8; e.shape = SHAPE.SPARK;
          e.fadeIn = 0.1;
          this.add.spawn(e);
        }
        break;
      }
      case 'trail': {
        // rastro entre opts.from e pos
        const from = opts.from || pos;
        const dist = from.distanceTo(pos);
        const spacing = opts.spacing ?? 0.45;
        const n = Math.min(10, Math.max(1, Math.ceil(dist / spacing)));
        const life = opts.life ?? 0.3;
        const size = opts.size ?? 0.5;
        const c0 = opts.color ?? 0xffffff;
        const c1 = opts.color2 ?? c0;
        for (let i = 0; i < n; i++) {
          const f = (i + 1) / n;
          e.reset().col(c0, c1);
          e.x = from.x + (pos.x - from.x) * f + rand(-0.06, 0.06);
          e.y = from.y + (pos.y - from.y) * f + rand(-0.06, 0.06);
          e.z = from.z + (pos.z - from.z) * f + rand(-0.06, 0.06);
          e.life = life * rand(0.8, 1.1); e.s0 = size; e.s1 = size * 0.3; e.hot = opts.hot ?? 0.4;
          e.a = opts.alpha ?? 0.8;
          e.vel(rand(-0.3, 0.3), rand(-0.1, 0.4), rand(-0.3, 0.3));
          this.add.spawn(e);
        }
        break;
      }
      case 'glow': {
        e.reset().at(pos).col(opts.color ?? 0xffffff);
        e.life = opts.life ?? 0.2; e.s0 = opts.size ?? 1.5; e.s1 = opts.size1 ?? e.s0 * 1.4;
        e.hot = opts.hot ?? 0.8; e.a = opts.alpha ?? 1;
        this.add.spawn(e);
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- update
  update(dt, world) {
    this.world = world;
    this.time += dt;
    if (!this._warm && world?.renderer && world.camera && world.scene) {
      this._warm = true;
      try { world.renderer.compile(this.root, world.camera, world.scene); } catch (err) { /* sem aquecimento */ }
    }
    this.add.update(dt);
    this.alpha.update(dt);

    let nf = 0;
    const karts = world?.karts;
    if (karts) {
      for (let i = 0; i < karts.length; i++) nf = this._kartFx(karts[i], dt, nf);
    }
    this.flames.count = nf;
    this.flames.visible = nf > 0;
    if (nf) {
      this.flames.instanceMatrix.needsUpdate = true;
      this.flames.instanceColor.needsUpdate = true;
    }
    // cages sem dono (kart saiu da lista)
    for (const c of this.cages) if (c.used && c._seen !== this._frame) { c.used = false; c.group.visible = false; }

    this._confettiUpdate(dt);
    this._streaks(dt, world);
    this.bolts.update(dt, world?.camera);
    this._ringsUpdate(dt);
    this.add.commit();
    this.alpha.commit();
    this._frame++;
  }

  _state(k) {
    let s = this.kstate.get(k);
    if (!s) {
      s = {
        wheel: [0, 0], pipe: [0, 0], smoke: 0, dust: 0, sparkle: 0, lastLevel: 0,
        tint: new THREE.Color(1, 0.55, 0.2), cage: null, cageT: 0, crackle: 0, cageEnd: 0,
      };
      this.kstate.set(k, s);
    }
    return s;
  }

  _scaleOf(k) {
    return k.visual ? k.visual.scale.x || 1 : 1;
  }

  // ponto local do kart -> mundo (usa a raiz object3d: posição + rumo)
  _lw(o, sc, x, y, z, out) {
    return out.set(x * sc, y * sc, z * sc).applyQuaternion(o.quaternion).add(o.position);
  }

  _kartFx(k, dt, nf) {
    const o = k.object3d;
    if (!o) return nf;
    const st = this._state(k);
    const sc = this._scaleOf(k);
    const e = this._e;
    const q = this.q;
    const vel = k.velocity;
    const onGround = k.onGround !== false;
    const stunned = !!k.stunned;
    _back.set(0, 0, -1).applyQuaternion(o.quaternion);
    _right.set(-1, 0, 0).applyQuaternion(o.quaternion); // direita de quem dirige = -X local

    // --- faíscas de drift
    if (k.drifting && onGround && !stunned) {
      const lvl = clamp(k.driftLevel | 0, 0, 3);
      st.lastLevel = lvl;
      const rate = [40, 130, 150, 170][lvl] * q;
      const c0 = PAL.drift[lvl];
      const c1 = PAL.driftEnd[lvl];
      for (let w = 0; w < 2; w++) {
        const wh = WHEELS[w];
        this._lw(o, sc, wh[0], wh[1], wh[2], _v);
        st.wheel[w] += rate * dt;
        while (st.wheel[w] >= 1) {
          st.wheel[w] -= 1;
          const out = w === 0 ? -1 : 1; // lado de fora da roda
          e.reset().at(_v);
          const sp = rand(1.5, 4.5);
          e.vel(
            _back.x * sp + _right.x * out * rand(0.3, 2.2) + rand(-0.6, 0.6),
            rand(1.2, 4),
            _back.z * sp + _right.z * out * rand(0.3, 2.2) + rand(-0.6, 0.6),
          );
          if (vel) { e.vx += vel.x * 0.93; e.vy += vel.y * 0.5; e.vz += vel.z * 0.93; }
          e.col(c0, c1);
          e.life = rand(0.14, lvl ? 0.32 : 0.24);
          e.s0 = (lvl ? rand(0.12, 0.19) : rand(0.07, 0.11)) * sc;
          e.s1 = 0.03;
          e.grav = 16; e.drag = 2; e.stretch = 0.014; e.hot = lvl ? 0.22 : 0.6; e.shape = SHAPE.SPARK;
          this.add.spawn(e);
        }
        // clarão na roda (1 quadro)
        e.reset().at(_v).col(c0);
        e.life = -1;
        e.s0 = (lvl ? 0.62 + lvl * 0.16 : 0.4) * sc * rand(0.85, 1.15);
        e.hot = lvl ? 0.3 : 0.5; e.a = lvl ? 0.95 : 0.5;
        this.add.spawn(e);
        if (lvl === 3 && Math.random() < 10 * dt * q) {
          e.reset().at(_v).vel(rand(-2, 2) + (vel ? vel.x * 0.8 : 0), rand(2, 4), rand(-2, 2) + (vel ? vel.z * 0.8 : 0));
          e.col(c0, c1); e.life = 0.45; e.s0 = 0.38 * sc; e.s1 = 0.05; e.shape = SHAPE.STAR; e.hot = 0.15;
          e.grav = 4; e.drag = 2; e.spin = rand(-6, 6);
          this.add.spawn(e);
        }
      }
    } else {
      st.wheel[0] = st.wheel[1] = 0;
    }

    // --- chamas do escapamento
    const boosting = k.boostTime > 0 && !stunned;
    const speed = Math.abs(k.speed || 0);
    const idle = !boosting && !stunned && speed > 1 && (k.controls?.throttle ?? 0) > 0.05 && !k.frozen;
    if ((boosting || idle) && nf < 15) {
      const t = this.time;
      for (let p = 0; p < 2; p++) {
        const pp = PIPES[p];
        this._lw(o, sc, pp[0], pp[1], pp[2], _v);
        const fl = 0.8 + 0.2 * Math.sin(t * 53 + p * 2 + k.index) + 0.15 * Math.sin(t * 31 + p);
        const len = boosting ? (1.2 + 0.35 * Math.min(1, k.boostTime)) * fl : 0.38 * fl;
        const w = boosting ? 0.2 : 0.09;
        _sc.set(w * sc, w * sc, len * sc);
        _m.compose(_v, o.quaternion, _sc);
        this.flames.setMatrixAt(nf, _m);
        if (boosting) this.flames.setColorAt(nf, st.tint);
        else this.flames.setColorAt(nf, _col.setRGB(0.55, 0.65, 1));
        nf++;
        if (boosting) {
          st.pipe[p] += 70 * q * dt;
          while (st.pipe[p] >= 1) {
            st.pipe[p] -= 1;
            e.reset().at(_v);
            const sp = rand(3.5, 7);
            e.vel(_back.x * sp + rand(-0.5, 0.5), rand(0.1, 0.9), _back.z * sp + rand(-0.5, 0.5));
            if (vel) { e.vx += vel.x * 0.9; e.vy += vel.y * 0.9; e.vz += vel.z * 0.9; }
            e.c0.copy(PAL.flameHot).lerp(st.tint, 0.4);
            e.c1.copy(st.tint).multiplyScalar(0.75); e.useC1 = true;
            e.life = rand(0.12, 0.24); e.s0 = rand(0.35, 0.5) * sc; e.s1 = 0.1 * sc;
            e.drag = 2; e.hot = 0.25; e.a = 0.75; e.shape = SHAPE.GLOW;
            this.add.spawn(e);
          }
          // brilho quente na saída
          e.reset().at(_v).col(st.tint);
          e.life = -1; e.s0 = 0.65 * sc * fl; e.hot = 0.3; e.a = 0.6;
          this.add.spawn(e);
        }
      }
      if (boosting) {
        st.smoke += 9 * q * dt;
        while (st.smoke >= 1) {
          st.smoke -= 1;
          this._lw(o, sc, 0, 0.5, -1.6, _v);
          e.reset().at(_v).vel(_back.x * 2 + rand(-0.6, 0.6), rand(0.5, 1.5), _back.z * 2 + rand(-0.6, 0.6));
          if (vel) { e.vx += vel.x * 0.6; e.vz += vel.z * 0.6; }
          e.col(PAL.smokeMid, PAL.smokeLight);
          e.life = rand(0.5, 0.8); e.s0 = 0.4 * sc; e.s1 = 1.3 * sc; e.drag = 2; e.a = 0.3; e.fadeIn = 0.08;
          e.shape = SHAPE.SMOKE; e.spin = rand(-1, 1);
          this.alpha.spawn(e);
        }
      }
    } else {
      st.pipe[0] = st.pipe[1] = 0;
    }

    // --- poeira fora da pista
    if (k.offroad && onGround && speed > 5) {
      st.dust += (14 + speed * 0.8) * q * dt;
      while (st.dust >= 1) {
        st.dust -= 1;
        const wh = WHEELS[Math.random() < 0.5 ? 0 : 1];
        this._lw(o, sc, wh[0], 0.15, wh[2], _v);
        e.reset().at(_v).vel(_back.x * rand(1, 3) + rand(-1, 1), rand(0.8, 2.2), _back.z * rand(1, 3) + rand(-1, 1));
        if (vel) { e.vx += vel.x * 0.35; e.vz += vel.z * 0.35; }
        e.col(PAL.dust2, PAL.dust);
        e.life = rand(0.5, 0.85); e.s0 = 0.45 * sc; e.s1 = rand(1.3, 1.9) * sc; e.drag = 2.5; e.a = 0.62;
        e.fadeIn = 0.05; e.shape = SHAPE.SMOKE; e.spin = rand(-1.5, 1.5);
        this.alpha.spawn(e);
      }
    }

    // --- gaiola de Faraday
    if (k.starTime > 0) {
      if (!st.cage) {
        st.cage = this._takeCage();
        st.cageT = 0;
        if (st.cage) {
          _v.copy(o.position).addScaledVector(UP, 0.8 * sc);
          this.burst('electric', _v, { kart: k, scale: 1.2, bolts: 7 });
          this._ring(o.position, 0.5, PAL.electric, 0.45, 5, 0.8);
        }
      }
      const c = st.cage;
      if (c) {
        c._seen = this._frame;
        st.cageT += dt;
        const pop = st.cageT < 0.35 ? Math.max(0.01, easeOutBack(st.cageT / 0.35)) : 1;
        const blink = k.starTime < 1.5 && Math.floor(k.starTime * 12) % 2 === 0;
        c.group.visible = !blink;
        c.group.position.copy(o.position).addScaledVector(UP, 0.75 * sc);
        c.group.quaternion.copy(o.quaternion);
        c.group.scale.set(1.35 * sc * pop, 1.12 * sc * pop, 1.55 * sc * pop);
        c.cage.rotation.y += dt * 1.4;
        c.shellMat.uniforms.uTime.value = this.time;
        c.shellMat.uniforms.uAlpha.value = 0.8 + 0.2 * Math.sin(this.time * 20);
        // estalos elétricos na superfície
        st.crackle -= dt;
        if (st.crackle <= 0) {
          st.crackle = rand(0.05, 0.16) / Math.max(0.5, q);
          _v2.randomDirection();
          if (_v2.y < -0.2) _v2.y = -_v2.y;
          _v3.copy(_v2).add(_v.randomDirection().multiplyScalar(0.7)).normalize();
          if (_v3.y < -0.2) _v3.y = -_v3.y;
          const gx = c.group.scale.x, gy = c.group.scale.y, gz = c.group.scale.z;
          _v2.set(_v2.x * gx, _v2.y * gy, _v2.z * gz).applyQuaternion(o.quaternion).add(c.group.position);
          _v3.set(_v3.x * gx, _v3.y * gy, _v3.z * gz).applyQuaternion(o.quaternion).add(c.group.position);
          this.bolts.spawn({ a: _v2, b: _v3, follow: k, life: rand(0.07, 0.14), amp: 0.14, wGlow: 0.32, wCore: 0.05, glow: 0x5c9dff, core: 0xffffff, taper: 0.2 });
          e.reset().at(_v3).col(PAL.electric);
          if (vel) e.vel(vel.x, vel.y, vel.z);
          e.life = 0.1; e.s0 = 0.7; e.hot = 1;
          this.add.spawn(e);
        }
      }
    } else if (st.cage) {
      const c = st.cage;
      c.used = false;
      c.group.visible = false;
      st.cage = null;
      _v.copy(o.position).addScaledVector(UP, 0.8 * sc);
      this.burst('sparks', _v, { count: 12, color: PAL.electric, vel });
    }

    // --- atordoado: estrelinhas e átomo girando sobre a cabeça
    if (stunned) {
      const t = this.time * 5.5;
      const n = 4;
      this._lw(o, 1, 0, 0, 0, _v2);
      for (let i = 0; i < n; i++) {
        const a = t + (i * TAU) / n;
        e.reset();
        e.x = _v2.x + Math.cos(a) * 0.6 * sc;
        e.y = _v2.y + (2.0 + Math.sin(a * 2) * 0.08) * sc;
        e.z = _v2.z + Math.sin(a) * 0.6 * sc;
        e.col(i === 0 ? PAL.atomIcon : PAL.star);
        e.life = -1; e.s0 = (i === 0 ? 0.55 : 0.4) * sc; e.shape = i === 0 ? SHAPE.ATOM : SHAPE.STAR;
        e.rot = -a * 0.7;
        this.alpha.spawn(e);
      }
    }

    // --- encolhido pelo raio: faísquinhas elétricas
    if (k.shrinkTime > 0) {
      st.sparkle += 8 * q * dt;
      while (st.sparkle >= 1) {
        st.sparkle -= 1;
        _v.randomDirection().multiplyScalar(0.6 * sc);
        _v.y = Math.abs(_v.y) + 0.4 * sc;
        _v.add(o.position);
        e.reset().at(_v).col(PAL.electric, PAL.blue1);
        if (vel) e.vel(vel.x, vel.y + 1, vel.z);
        e.life = 0.18; e.s0 = 0.35; e.s1 = 0.05; e.shape = SHAPE.STAR; e.hot = 1; e.spin = 8;
        this.add.spawn(e);
      }
    }
    return nf;
  }

  _takeCage() {
    for (const c of this.cages) if (!c.used) { c.used = true; c._seen = this._frame; return c; }
    return null;
  }

  _boostPuff(k, source) {
    const o = k.object3d;
    if (!o) return;
    const st = this._state(k);
    if (source === 'drift') st.tint.copy(PAL.drift[clamp(st.lastLevel || 1, 1, 3)]);
    else if (source === 'pad') st.tint.setRGB(1, 0.62, 0.18);
    else st.tint.setRGB(1, 0.5, 0.15);
    const sc = this._scaleOf(k);
    const e = this._e;
    _back.set(0, 0, -1).applyQuaternion(o.quaternion);
    const vel = k.velocity;
    for (let p = 0; p < 2; p++) {
      const pp = PIPES[p];
      this._lw(o, sc, pp[0], pp[1], pp[2], _v);
      const n = Math.round(14 * this.q);
      for (let i = 0; i < n; i++) {
        _v2.randomDirection().multiplyScalar(0.55).add(_back).normalize();
        const sp = rand(3, 8);
        e.reset().at(_v).vel(_v2.x * sp, _v2.y * sp + 0.6, _v2.z * sp);
        if (vel) { e.vx += vel.x * 0.85; e.vy += vel.y * 0.85; e.vz += vel.z * 0.85; }
        e.c0.copy(PAL.flameHot).lerp(st.tint, 0.45);
        e.c1.copy(st.tint).multiplyScalar(0.7); e.useC1 = true;
        e.life = rand(0.18, 0.32); e.s0 = rand(0.35, 0.6) * sc; e.s1 = 0.1; e.drag = 3; e.hot = 0.35; e.a = 0.8;
        e.shape = Math.random() < 0.5 ? SHAPE.GLOW : SHAPE.SMOKE; e.spin = rand(-3, 3);
        this.add.spawn(e);
      }
      e.reset().at(_v).col(st.tint);
      if (vel) e.vel(vel.x, vel.y, vel.z);
      e.life = 0.16; e.s0 = 1.3 * sc; e.s1 = 1.9 * sc; e.hot = 0.5; e.a = 0.65;
      this.add.spawn(e);
    }
  }

  _driftLevelUp(k, level) {
    const o = k.object3d;
    if (!o) return;
    const sc = this._scaleOf(k);
    const c = PAL.drift[clamp(level, 1, 3)];
    const e = this._e;
    const vel = k.velocity;
    for (let w = 0; w < 2; w++) {
      const wh = WHEELS[w];
      this._lw(o, sc, wh[0], wh[1] + 0.1, wh[2], _v);
      for (let i = 0, n = Math.round(10 * this.q); i < n; i++) {
        _v2.randomDirection();
        e.reset().at(_v).vel(_v2.x * 5, Math.abs(_v2.y) * 5 + 1, _v2.z * 5).col(c, PAL.white);
        if (vel) { e.vx += vel.x * 0.9; e.vz += vel.z * 0.9; }
        e.life = 0.3; e.s0 = 0.12; e.s1 = 0.04; e.grav = 8; e.drag = 2; e.stretch = 0.04; e.hot = 1; e.shape = SHAPE.SPARK;
        this.add.spawn(e);
      }
      e.reset().at(_v).col(c);
      if (vel) e.vel(vel.x, vel.y, vel.z);
      e.life = 0.2; e.s0 = 1.6 * sc; e.s1 = 0.6; e.hot = 1;
      this.add.spawn(e);
    }
  }

  // Raspão no muro: faíscas saindo do lado do muro, jogadas para trás e para cima.
  _wallSparks(k, strength) {
    const o = k.object3d;
    if (!o) return;
    const s = clamp(strength > 1.5 ? strength / 20 : strength, 0.15, 1);
    const side = (k.lateral ?? 0) >= 0 ? 1 : -1; // lado do muro (positivo = direita)
    const sc = this._scaleOf(k);
    const e = this._e;
    const vel = k.velocity;
    _back.set(0, 0, -1).applyQuaternion(o.quaternion);
    _right.set(-1, 0, 0).applyQuaternion(o.quaternion);
    const n = Math.round((20 + 40 * s) * this.q);
    for (let i = 0; i < n; i++) {
      this._lw(o, sc, -side * 0.68, rand(0.15, 0.55), rand(-0.8, 0.7), _v); // local -X = direita
      const sp = rand(4, 11) * (0.7 + s * 0.6);
      const inward = rand(0.1, 0.7);
      e.reset().at(_v).vel(
        (_back.x * rand(0.6, 1) - _right.x * side * inward) * sp,
        rand(1.5, 5),
        (_back.z * rand(0.6, 1) - _right.z * side * inward) * sp,
      );
      if (vel) { e.vx += vel.x * 0.7; e.vy += vel.y * 0.5; e.vz += vel.z * 0.7; }
      e.col(PAL.sparkWarm, PAL.sparkWarm2);
      e.life = rand(0.25, 0.55); e.s0 = rand(0.12, 0.18); e.s1 = 0.04;
      e.grav = 15; e.drag = 1.5; e.stretch = 0.03; e.hot = 0.45; e.shape = SHAPE.SPARK;
      this.add.spawn(e);
    }
    this._lw(o, sc, -side * 0.7, 0.35, 0, _v);
    e.reset().at(_v).col(PAL.sparkWarm2);
    if (vel) e.vel(vel.x, vel.y, vel.z);
    e.life = 0.14; e.s0 = 2.2 * (0.6 + s * 0.6); e.s1 = 0.6; e.hot = 0.5; e.a = 0.8;
    this.add.spawn(e);
    if (s > 0.5) this.burst('smoke', _v, { scale: 0.5 });
  }

  // Raio da Bobina de Tesla em cada adversário atingido.
  _lightning(by) {
    this.flash(0xd0b8ff, 0.35, 0.55);
    const karts = this.world?.karts;
    if (!karts) return;
    for (const k of karts) {
      if (k === by || k.invincible) continue;
      this.strike(k);
    }
  }

  // Raio vindo do céu sobre um kart (público: útil para testes e outros módulos).
  strike(k) {
    const o = k.object3d || k;
    const pos = o.position;
    _v.set(pos.x + rand(-6, 6), pos.y + 38, pos.z + rand(-6, 6));
    _v2.copy(pos).addScaledVector(UP, 0.9);
    const main = this.bolts.spawn({ a: _v, b: _v2, follow: k, life: 0.5, amp: 2.6, wGlow: 3.2, wCore: 0.5, glow: 0x8a55ff, core: 0xf6f0ff, taper: 0.35, force: true });
    if (main) {
      for (let i = 0; i < 2; i++) {
        const idx = 3 + i * 3 + ((Math.random() * 2) | 0);
        _v3.set(pos.x + rand(-7, 7), pos.y + rand(8, 20), pos.z + rand(-7, 7));
        this.bolts.spawn({ a: _v, b: _v3, follow: k, parent: main, parentIdx: idx, freeEnd: true, life: 0.3, amp: 1.3, wGlow: 1.4, wCore: 0.18, glow: 0x8a5cff, core: 0xeee6ff, taper: 0.8, force: true });
      }
    }
    this.burst('electric', _v2, { kart: k, scale: 1.1, bolts: 3 });
    this._ring(pos, 0.3, PAL.purple0, 0.4, 5, 0.9);
    this._ring(pos, 0.3, PAL.electric, 0.6, 3, 0.6);
  }

  _ring(pos, r0, color, life, r1, alpha = 1, yOff = 0.08) {
    let r = null;
    for (const x of this.rings) if (!x.active) { r = x; break; }
    if (!r) {
      // reaproveita o mais velho
      r = this.rings[0];
      for (const x of this.rings) if (x.age / x.life > r.age / r.life) r = x;
    }
    r.active = true;
    r.age = 0;
    r.life = life;
    r.r0 = r0;
    r.r1 = r1;
    r.a = alpha;
    setCol(r.mat.color, color);
    r.mesh.position.copy(pos);
    r.mesh.position.y += yOff;
    r.mesh.scale.setScalar(r0);
    r.mesh.visible = true;
  }

  _ringsUpdate(dt) {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.age += dt;
      const e = r.age / r.life;
      if (e >= 1) { r.active = false; r.mesh.visible = false; continue; }
      const ease = 1 - Math.pow(1 - e, 3);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * ease);
      r.mat.opacity = r.a * Math.pow(1 - e, 1.4);
    }
  }

  _confettiUpdate(dt) {
    if (this.confettiT <= 0 || !this.confettiKart) return;
    this.confettiT -= dt;
    const k = this.confettiKart;
    const o = k.object3d;
    const kv = k.velocity;
    const e = this._e;
    this._confAcc += 90 * this.q * dt;
    while (this._confAcc >= 1) {
      this._confAcc -= 1;
      // chuva à frente e em volta do kart, na altura que a câmera vê
      this._lw(o, 1, rand(-4.5, 4.5), rand(2.5, 5.5), rand(-2, 9), _v);
      e.reset().at(_v).vel(rand(-0.6, 0.6), rand(-0.8, 0), rand(-0.6, 0.6));
      if (kv) { e.vx += kv.x; e.vz += kv.z; }
      this._confettiP(e);
      e.fadeIn = 0.15;
      this.alpha.spawn(e);
    }
  }

  _streaks(dt, world) {
    const p = world?.player;
    const cam = world?.camera;
    if (!p || !cam || !(p.boostTime > 0) || p.stunned) return;
    const e = this._e;
    cam.matrixWorld.extractBasis(_camR, _camU, _camF);
    _camF.negate(); // câmera olha para -Z
    this._strAcc += 55 * this.q * dt;
    while (this._strAcc >= 1) {
      this._strAcc -= 1;
      const a = Math.random() * TAU;
      const r = rand(2.2, 4.8);
      const d = rand(5, 14);
      e.reset();
      e.x = cam.position.x + _camF.x * d + (_camR.x * Math.cos(a) + _camU.x * Math.sin(a)) * r;
      e.y = cam.position.y + _camF.y * d + (_camR.y * Math.cos(a) + _camU.y * Math.sin(a)) * r;
      e.z = cam.position.z + _camF.z * d + (_camR.z * Math.cos(a) + _camU.z * Math.sin(a)) * r;
      const sp = rand(14, 24);
      e.vel(-_camF.x * sp, -_camF.y * sp, -_camF.z * sp);
      if (p.velocity) { e.vx += p.velocity.x; e.vy += p.velocity.y; e.vz += p.velocity.z; }
      e.col(0xffffff);
      e.life = rand(0.18, 0.3); e.s0 = 0.035; e.a = 0.4; e.stretch = 0.05; e.fadeIn = 0.05; e.shape = SHAPE.SPARK;
      this.add.spawn(e);
    }
  }
}
