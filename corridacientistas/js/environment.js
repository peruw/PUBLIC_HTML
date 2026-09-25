// Ambiente do "Campus da Ciência": céu, neblina, luzes, terreno, lagoa, montanhas,
// nuvens, vegetação e os marcos temáticos (universidade, laboratório, observatório...).
import * as THREE from './three.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const col = (hex) => new THREE.Color(hex);

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(i, j) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ---------------------------------------------------------------------------
// Mesclagem simples de geometrias com cor por vértice
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
class Merge {
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; this.idx = []; }
  get count() { return this.p.length / 3; }
  add(geo, matrix, color, uvRect, uvFixed) {
    const base = this.count;
    const g = geo.index ? geo : geo;
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    _m3.getNormalMatrix(matrix);
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(N, i).applyMatrix3(_m3).normalize();
      this.p.push(_v.x, _v.y, _v.z);
      this.n.push(_n.x, _n.y, _n.z);
      this.c.push(color.r, color.g, color.b);
      if (uvFixed) this.uv.push(uvFixed[0], uvFixed[1]);
      else if (uvRect && U) this.uv.push(lerp(uvRect[0], uvRect[2], U.getX(i)), lerp(uvRect[1], uvRect[3], U.getY(i)));
      else if (U) this.uv.push(U.getX(i), U.getY(i));
      else this.uv.push(0, 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    return this;
  }
  vert(x, y, z, nx, ny, nz, c, u = 0, v = 0) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(c.r, c.g, c.b); this.uv.push(u, v);
    return this.count - 1;
  }
  build(withUV = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (withUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const S3 = new THREE.Vector3();
const P3 = new THREE.Vector3();
const mat4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => {
  P3.set(x, y, z); E.set(rx, ry, rz); Q.setFromEuler(E); S3.set(sx, sy, sz);
  return M4.compose(P3, Q, S3);
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function canvasTex(c, aniso = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// Atlas do ambiente: elementos da tabela periódica, bandeiras, letreiro e janelas
const ELEMENTS = [
  ['H', 1, 'Hidrogênio', '#ff6b6b'], ['He', 2, 'Hélio', '#b388ff'], ['C', 6, 'Carbono', '#5cd67a'], ['N', 7, 'Nitrogênio', '#5cd67a'],
  ['O', 8, 'Oxigênio', '#5cd67a'], ['Na', 11, 'Sódio', '#ffb347'], ['Fe', 26, 'Ferro', '#6fb7ff'], ['Cu', 29, 'Cobre', '#6fb7ff'],
  ['Ag', 47, 'Prata', '#6fb7ff'], ['Au', 79, 'Ouro', '#ffd23f'], ['Ra', 88, 'Rádio', '#ff8fd0'], ['Po', 84, 'Polônio', '#9be7ff'],
  ['Md', 101, 'Mendelévio', '#ff8fd0'], ['Ne', 10, 'Neônio', '#b388ff'], ['Si', 14, 'Silício', '#9be7ff'], ['U', 92, 'Urânio', '#ff8fd0'],
];
function envAtlas(hi) {
  const S = hi ? 1024 : 512;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.scale(S / 1024, S / 1024);
  const R = {};
  const put = (name, x, y, w, h, fn) => {
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); fn(g, w, h); g.restore();
    R[name] = [(x + 2) / 1024, 1 - (y + h - 2) / 1024, (x + w - 2) / 1024, 1 - (y + 2) / 1024];
  };
  const FONT = '"Trebuchet MS", "Segoe UI", "DejaVu Sans", Arial, sans-serif';
  put('white', 0, 0, 32, 32, (gg, w, h) => { gg.fillStyle = '#fff'; gg.fillRect(0, 0, w, h); });
  ELEMENTS.forEach(([sym, num, name, color], i) => {
    put('el' + i, (i % 8) * 128, 40 + Math.floor(i / 8) * 128, 128, 128, (gg, w, h) => {
      gg.fillStyle = '#ffffff'; gg.fillRect(0, 0, w, h);
      gg.fillStyle = color; gg.fillRect(6, 6, w - 12, h - 12);
      gg.fillStyle = 'rgba(255,255,255,0.35)'; gg.fillRect(6, 6, w - 12, 18);
      gg.fillStyle = '#1b1b2a';
      gg.textAlign = 'left'; gg.textBaseline = 'top';
      gg.font = `bold 20px ${FONT}`; gg.fillText(String(num), 14, 12);
      gg.textAlign = 'center'; gg.textBaseline = 'middle';
      gg.font = `900 ${sym.length > 1 ? 56 : 64}px ${FONT}`; gg.fillText(sym, w / 2, h * 0.52);
      let fs = 16; gg.font = `bold ${fs}px ${FONT}`;
      while (gg.measureText(name).width > w - 16 && fs > 8) { fs--; gg.font = `bold ${fs}px ${FONT}`; }
      gg.fillText(name, w / 2, h - 18);
    });
  });
  // bandeira do Brasil
  put('flagBR', 0, 300, 220, 150, (gg, w, h) => {
    gg.fillStyle = '#009c3b'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#ffdf00'; gg.beginPath(); gg.moveTo(w / 2, 12); gg.lineTo(w - 16, h / 2); gg.lineTo(w / 2, h - 12); gg.lineTo(16, h / 2); gg.fill();
    gg.fillStyle = '#002776'; gg.beginPath(); gg.arc(w / 2, h / 2, h * 0.24, 0, TAU); gg.fill();
    gg.strokeStyle = '#ffffff'; gg.lineWidth = 6;
    gg.beginPath(); gg.arc(w / 2 + 10, h / 2 + 40, h * 0.34, Math.PI * 1.18, Math.PI * 1.62); gg.stroke();
    gg.fillStyle = '#fff';
    for (let k = 0; k < 14; k++) { gg.beginPath(); gg.arc(w / 2 - 20 + (k * 37) % 44, h / 2 + 2 + (k * 17) % 22, 1.8, 0, TAU); gg.fill(); }
  });
  // bandeiras com átomo
  const atomFlag = (bg) => (gg, w, h) => {
    gg.fillStyle = bg; gg.fillRect(0, 0, w, h);
    gg.strokeStyle = '#ffffff'; gg.lineWidth = 6;
    for (let k = 0; k < 3; k++) { gg.beginPath(); gg.ellipse(w / 2, h / 2, w * 0.3, h * 0.12, (k * Math.PI) / 3, 0, TAU); gg.stroke(); }
    gg.fillStyle = '#fff'; gg.beginPath(); gg.arc(w / 2, h / 2, 10, 0, TAU); gg.fill();
  };
  put('flagA', 230, 300, 220, 150, atomFlag('#8a3cff'));
  put('flagB', 460, 300, 220, 150, atomFlag('#e3262f'));
  // letreiro do prédio
  put('campus', 0, 460, 1024, 110, (gg, w, h) => {
    gg.fillStyle = '#f3ead7'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#1f2f66';
    gg.textAlign = 'center'; gg.textBaseline = 'middle';
    let fs = 78; gg.font = `bold ${fs}px Georgia, "DejaVu Serif", serif`;
    const text = 'CAMPUS DA CIÊNCIA';
    while (gg.measureText(text).width > w - 60) { fs -= 2; gg.font = `bold ${fs}px Georgia, "DejaVu Serif", serif`; }
    gg.fillText(text, w / 2, h / 2 + 4);
    gg.fillStyle = '#c9a44a'; gg.fillRect(20, 8, w - 40, 5); gg.fillRect(20, h - 13, w - 40, 5);
  });
  // janela (vidro com caixilho)
  put('window', 700, 300, 96, 150, (gg, w, h) => {
    gg.fillStyle = '#f3ead7'; gg.fillRect(0, 0, w, h);
    const gr = gg.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#9fd3ff'); gr.addColorStop(0.5, '#3a6fb0'); gr.addColorStop(1, '#27497a');
    gg.fillStyle = gr; gg.fillRect(10, 10, w - 20, h - 20);
    gg.fillStyle = '#f3ead7'; gg.fillRect(w / 2 - 3, 10, 6, h - 20); gg.fillRect(10, h * 0.45, w - 20, 6);
  });
  put('obsSign', 0, 580, 512, 96, (gg, w, h) => {
    gg.fillStyle = '#0b1433'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#ffe36e'; gg.textAlign = 'center'; gg.textBaseline = 'middle';
    gg.font = `900 54px ${FONT}`; gg.fillText('OBSERVATÓRIO', w / 2, h / 2 + 3);
  });
  put('labSign', 512, 580, 512, 96, (gg, w, h) => {
    gg.fillStyle = '#5518b8'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#ffffff'; gg.textAlign = 'center'; gg.textBaseline = 'middle';
    gg.font = `900 50px ${FONT}`; gg.fillText('LABORATÓRIO', w / 2, h / 2 + 3);
  });
  put('rocket', 0, 690, 256, 64, (gg, w, h) => {
    gg.fillStyle = '#ffffff'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#1d4fd8'; gg.textAlign = 'center'; gg.textBaseline = 'middle';
    gg.font = `900 40px ${FONT}`; gg.fillText('BRASIL', w / 2, h / 2 + 2);
  });
  const tex = canvasTex(c, hi ? 4 : 1);
  const wr = R.white;
  return { tex, R, white: [(wr[0] + wr[2]) / 2, (wr[1] + wr[3]) / 2] };
}

// ---------------------------------------------------------------------------
export function buildEnvironment(scene, track, quality = {}, renderer) {
  const hi = quality.id !== 'baixa';
  const density = quality.scenery ?? (hi ? 1 : 0.45);
  const drawDist = quality.drawDistance || (hi ? 700 : 420);
  const meta = track.meta;
  const { N, ds, X, Y, Z, WD, FL, SPAN } = meta;
  const rand = mulberry(424242);
  const group = new THREE.Group();
  group.name = 'ambiente';
  scene.add(group);
  const disposables = [];
  const keep = (...a) => { disposables.push(...a); return a[0]; };
  const UP = new THREE.Vector3(0, 1, 0);

  // ------------------------------------------------------------ céu, neblina e luzes
  const SUN_DIR = new THREE.Vector3(0.38, 0.72, 0.58).normalize();
  const skyTop = col(0x2f86e8), skyHorizon = col(0xcdeeff), skyBottom = col(0xa9d8f0);
  scene.fog = new THREE.Fog(skyHorizon.clone(), drawDist * 0.28, drawDist);
  scene.background = skyHorizon.clone();
  const skyMat = keep(new THREE.ShaderMaterial({
    uniforms: {
      top: { value: skyTop }, horizon: { value: skyHorizon }, bottom: { value: skyBottom },
      sunDir: { value: SUN_DIR }, sunColor: { value: col(0xfff1c9) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top, horizon, bottom, sunDir, sunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.62));
        c = mix(c, bottom, smoothstep(0.0, -0.2, h));
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        c += sunColor * (pow(sd, 1400.0) * 4.0 + pow(sd, 90.0) * 0.45 + pow(sd, 8.0) * 0.16);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  }));
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(100, 32, 16)), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.name = 'ceu';
  group.add(sky);

  const hemi = new THREE.HemisphereLight(0xd6ecff, 0x6f8f4a, 1.55);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.35);
  sun.position.copy(SUN_DIR).multiplyScalar(200);
  sun.name = 'sol';
  group.add(sun);
  group.add(sun.target);
  const SHADOW_HALF = hi ? 60 : 45;
  if (quality.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMapSize || 2048, quality.shadowMapSize || 2048);
    const sc = sun.shadow.camera;
    sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
    sc.near = 1; sc.far = 420;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sc.updateProjectionMatrix();
  }
  const baseSun = sun.intensity, baseHemi = hemi.intensity;

  // ------------------------------------------------------------ campo de distância à pista
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]);
    minZ = Math.min(minZ, Z[i]); maxZ = Math.max(maxZ, Z[i]);
  }
  const CX = (minX + maxX) / 2, CZ = (minZ + maxZ) / 2;
  const FM = 110; // margem do campo
  const FC = 2; // célula
  const fx0 = minX - FM, fz0 = minZ - FM;
  const fnx = Math.ceil((maxX - minX + 2 * FM) / FC) + 1, fnz = Math.ceil((maxZ - minZ + 2 * FM) / FC) + 1;
  const field = new Float32Array(fnx * fnz).fill(999);
  // extensão sólida de cada amostra: corredor, ponte ou morro do túnel
  const moundTop = meta.moundTop;
  const extent = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (FL[i] === 2) extent[i] = SPAN[i] + 2.2 + ((moundTop[i] || 10) + 3) / 1.15;
    else extent[i] = WD[i] + (FL[i] === 1 ? 2.5 : 0.8);
  }
  for (let i = 0; i < N; i++) {
    const R = extent[i] + 40;
    const i0 = Math.max(0, Math.floor((X[i] - R - fx0) / FC)), i1 = Math.min(fnx - 1, Math.ceil((X[i] + R - fx0) / FC));
    const j0 = Math.max(0, Math.floor((Z[i] - R - fz0) / FC)), j1 = Math.min(fnz - 1, Math.ceil((Z[i] + R - fz0) / FC));
    for (let j = j0; j <= j1; j++) {
      const dz = fz0 + j * FC - Z[i];
      for (let k = i0; k <= i1; k++) {
        const dx = fx0 + k * FC - X[i];
        const d = Math.sqrt(dx * dx + dz * dz) - extent[i];
        const o = j * fnx + k;
        if (d < field[o]) field[o] = d;
      }
    }
  }
  // folga até o sólido mais próximo da pista (m); fora do campo = longe
  const clearance = (x, z) => {
    const fi = (x - fx0) / FC, fj = (z - fz0) / FC;
    if (fi < 0 || fj < 0 || fi >= fnx - 1 || fj >= fnz - 1) return 999;
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const o = j * fnx + i;
    return lerp(lerp(field[o], field[o + 1], u), lerp(field[o + fnx], field[o + fnx + 1], u), v);
  };
  // áreas reservadas (marcos) para a vegetação não invadir
  const reserved = [];
  const reserve = (x, z, r) => reserved.push([x, z, r]);
  const isReserved = (x, z, r = 0) => {
    for (const [a, b, rr] of reserved) if ((x - a) ** 2 + (z - b) ** 2 < (rr + r) ** 2) return true;
    return false;
  };

  // ------------------------------------------------------------ relevo natural
  const summitS = meta.ctrlS[13];
  const sSum = track.sample(summitS);
  const obsPos = sSum.pos.clone().addScaledVector(sSum.right, sSum.wallDist + 20);
  const LAGOON = [[125, 522, 92, 40], [152, 468, 48, 34], [72, 560, 46, 30]];
  const ISLETS = [[128, 466, 11, 1.3], [160, 553, 9, 1.0], [82, 566, 7, 0.9], [106, 540, 4.5, 0.6]];
  const lagoonF = (x, z) => {
    let f = -1;
    for (const [cx, cz, rx, rz] of LAGOON) {
      const q = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2;
      f = Math.max(f, 1 - q);
    }
    return f;
  };
  const flats = []; // [x, z, raio, altura]
  const outside = (x, z) => {
    const dx = Math.max(minX - 40 - x, 0, x - maxX - 40);
    const dz = Math.max(minZ - 40 - z, 0, z - maxZ - 40);
    return Math.hypot(dx, dz);
  };
  const natural = (x, z) => {
    let h = (vnoise(x / 95 + 3, z / 95 + 1) - 0.5) * 5 + (vnoise(x / 33 + 9, z / 33 + 4) - 0.5) * 1.6;
    const d = outside(x, z);
    h += smooth01(d / 280) * (22 + 60 * vnoise(x / 170 + 11, z / 170 + 5)) + smooth01((d - 250) / 400) * 40;
    // morro do observatório
    h += 19 * Math.exp(-((x - obsPos.x) ** 2 + (z - obsPos.z) ** 2) / (2 * 58 * 58));
    h += 8 * Math.exp(-((x - (obsPos.x + 60)) ** 2 + (z - (obsPos.z - 50)) ** 2) / (2 * 50 * 50));
    // lagoa
    const f = lagoonF(x, z);
    if (f > -0.3) {
      const t = smooth01((f + 0.05) / 0.2);
      h = lerp(h, -1.5 - 3.2 * smooth01(f / 0.55), t);
      for (const [ix, iz, r, top] of ISLETS) {
        const q = ((x - ix) ** 2 + (z - iz) ** 2) / (r * r);
        if (q < 2.5) h = Math.max(h, -1.5 + top + 0.3 - q * 2.2 + (vnoise(x / 3, z / 3) - 0.5) * 0.4);
      }
    }
    for (const [fx, fz, r, fy] of flats) {
      const q = Math.hypot(x - fx, z - fz) / r;
      if (q < 1.6) h = lerp(fy, h, smooth01((q - 1) / 0.6));
    }
    return h;
  };

  // ------------------------------------------------------------ malha do terreno
  const fine = hi ? 4 : 6;
  const TERR = 950;
  const axis = (min, max, f0, f1) => {
    const a = [];
    for (let v = f0; v <= f1 + 1e-6; v += fine) a.push(v);
    let step = fine, v = f0;
    while (v > min) { step = Math.min(step * 1.22, 120); v -= step; a.unshift(Math.max(v, min)); }
    step = fine; v = a[a.length - 1];
    while (v < max) { step = Math.min(step * 1.22, 120); v += step; a.push(Math.min(v, max)); }
    return a;
  };
  const xs = axis(CX - TERR, CX + TERR, minX - 75, maxX + 75);
  const zs = axis(CZ - TERR, CZ + TERR, minZ - 75, maxZ + 75);
  const nx = xs.length, nz = zs.length;
  // Marcos precisam de chão plano: definidos antes do relevo
  const sStart = track.sample(20);
  const campus = { x: 30, z: -64, y: 0 };
  flats.push([campus.x, campus.z + 6, 58, -0.35]);
  flats.push([30, 36, 62, -0.35]);
  flats.push([obsPos.x, obsPos.z, 22, sSum.pos.y + 0.6]);
  void sStart;

  const H = new Float32Array(nx * nz);
  const LO = new Float32Array(nx * nz).fill(-1e9);
  const HI = new Float32Array(nx * nz).fill(1e9);
  const LOWF = new Float32Array(nx * nz).fill(1e9);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = natural(xs[i], zs[j]);
  const bsearch = (arr, v) => {
    let a = 0, b = arr.length - 1;
    while (b - a > 1) { const m = (a + b) >> 1; if (arr[m] <= v) a = m; else b = m; }
    return a;
  };
  for (let s = 0; s < N; s++) {
    const zone = WD[s] + 6.5;
    const R = FL[s] === 2 ? SPAN[s] + 2 : zone + 40;
    const i0 = bsearch(xs, X[s] - R), i1 = bsearch(xs, X[s] + R) + 1;
    const j0 = bsearch(zs, Z[s] - R), j1 = bsearch(zs, Z[s] + R) + 1;
    for (let j = j0; j <= Math.min(j1, nz - 1); j++) {
      const dz = zs[j] - Z[s];
      for (let i = i0; i <= Math.min(i1, nx - 1); i++) {
        const dx = xs[i] - X[s];
        const d = Math.sqrt(dx * dx + dz * dz);
        const o = j * nx + i;
        if (FL[s] === 1) {
          if (d < WD[s] + 3) HI[o] = Math.min(HI[o], Y[s] - 3.6);
          continue;
        }
        if (FL[s] === 2) {
          if (d < SPAN[s] + 1.2) LOWF[o] = Math.min(LOWF[o], Y[s] - 0.45);
          continue;
        }
        const e = Math.max(0, d - zone);
        HI[o] = Math.min(HI[o], Y[s] - 0.35 + e * 0.62);
        LO[o] = Math.max(LO[o], Y[s] - 0.95 - e * 0.55);
      }
    }
  }
  for (let o = 0; o < H.length; o++) {
    let h = H[o];
    if (LO[o] > HI[o]) h = HI[o];
    else h = clamp(h, LO[o], HI[o]);
    if (h > LOWF[o]) h = LOWF[o];
    H[o] = h;
  }
  // altura do terreno em qualquer ponto (bilinear na grade)
  const groundAt = (x, z) => {
    if (x <= xs[0] || x >= xs[nx - 1] || z <= zs[0] || z >= zs[nz - 1]) return natural(x, z);
    const i = bsearch(xs, x), j = bsearch(zs, z);
    const u = (x - xs[i]) / (xs[i + 1] - xs[i]), v = (z - zs[j]) / (zs[j + 1] - zs[j]);
    const o = j * nx + i;
    return lerp(lerp(H[o], H[o + 1], u), lerp(H[o + nx], H[o + nx + 1], u), v);
  };

  const grassTex = meta.grassTexture;
  {
    const pos = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    const cols = new Float32Array(nx * nz * 3);
    const g1 = col(0x7cc943), g2 = col(0x62b23c), g3 = col(0x93d653), far = col(0x5f9e4a), dirt = col(0xb48d5c), sand = col(0xf0d9a0), wet = col(0xcdb57e), deep = col(0xa89567), mount = col(0x7aa35a);
    const c = new THREE.Color();
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const o = j * nx + i;
      const x = xs[i], z = zs[j], h = H[o];
      pos[o * 3] = x; pos[o * 3 + 1] = h; pos[o * 3 + 2] = z;
      uv[o * 2] = x / 7; uv[o * 2 + 1] = z / 7;
      const n = vnoise(x / 26, z / 26), n2 = vnoise(x / 9 + 5, z / 9);
      c.copy(g1).lerp(g2, smooth01((n - 0.35) * 3)).lerp(g3, smooth01((n2 - 0.6) * 4) * 0.6);
      const d = outside(x, z);
      if (d > 30) c.lerp(far, smooth01((d - 30) / 250) * 0.7);
      if (h > 35) c.lerp(mount, smooth01((h - 35) / 40) * 0.6);
      // inclinação
      const hx = i > 0 && i < nx - 1 ? (H[o + 1] - H[o - 1]) / (xs[i + 1] - xs[i - 1]) : 0;
      const hz = j > 0 && j < nz - 1 ? (H[o + nx] - H[o - nx]) / (zs[j + 1] - zs[j - 1]) : 0;
      const sl = Math.hypot(hx, hz);
      if (sl > 0.75 && clearance(x, z) > 2) c.lerp(dirt, smooth01((sl - 0.75) * 2) * 0.7);
      // praia e fundo da lagoa
      const lf = lagoonF(x, z);
      if (lf > -0.35) {
        if (h < -1.2) c.copy(wet).lerp(deep, smooth01((-1.5 - h) / 3));
        else if (h < 0.4) c.lerp(sand, smooth01((0.4 - h) / 0.8));
      }
      cols[o * 3] = c.r; cols[o * 3 + 1] = c.g; cols[o * 3 + 2] = c.b;
    }
    const idx = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c2 = a + nx, d = c2 + 1;
      idx.push(a, c2, b, b, c2, d);
    }
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.setIndex(nx * nz > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, keep(new THREE.MeshLambertMaterial({ map: grassTex, vertexColors: true })));
    m.receiveShadow = true;
    m.name = 'terreno';
    m.matrixAutoUpdate = false;
    group.add(m);
  }

  // ------------------------------------------------------------ lagoa (água com profundidade)
  const waterUniforms = {
    uTime: { value: 0 }, uShallow: { value: col(0x5fe6e0) }, uDeep: { value: col(0x138fc4) }, uFoam: { value: col(0xffffff) },
  };
  {
    const WY = meta.waterY;
    let lx0 = Infinity, lx1 = -Infinity, lz0 = Infinity, lz1 = -Infinity;
    for (const [cx, cz, rx, rz] of LAGOON) { lx0 = Math.min(lx0, cx - rx); lx1 = Math.max(lx1, cx + rx); lz0 = Math.min(lz0, cz - rz); lz1 = Math.max(lz1, cz + rz); }
    lx0 -= 10; lx1 += 10; lz0 -= 10; lz1 += 10;
    const step = hi ? 2.5 : 4;
    const wx = Math.ceil((lx1 - lx0) / step) + 1, wz = Math.ceil((lz1 - lz0) / step) + 1;
    const pos = [], depth = [], idx = [];
    const used = new Int32Array(wx * wz).fill(-1);
    for (let j = 0; j < wz; j++) for (let i = 0; i < wx; i++) {
      const x = lx0 + i * step, z = lz0 + j * step;
      used[j * wx + i] = pos.length / 3;
      pos.push(x, WY, z);
      depth.push(WY - groundAt(x, z));
    }
    for (let j = 0; j < wz - 1; j++) for (let i = 0; i < wx - 1; i++) {
      const a = used[j * wx + i], b = used[j * wx + i + 1], c2 = used[(j + 1) * wx + i], d = used[(j + 1) * wx + i + 1];
      // só células com alguma parte submersa
      if (Math.max(depth[a], depth[b], depth[c2], depth[d]) < -0.3) continue;
      idx.push(a, c2, b, b, c2, d);
    }
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mat = keep(new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, waterUniforms]),
      vertexShader: /* glsl */`
        attribute float depth;
        varying float vDepth;
        varying vec3 vW;
        #include <fog_pars_vertex>
        void main() {
          vDepth = depth;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform vec3 uShallow, uDeep, uFoam;
        varying float vDepth;
        varying vec3 vW;
        #include <fog_pars_fragment>
        void main() {
          if (vDepth < -0.05) discard;
          float t = uTime;
          float r1 = sin(vW.x * 0.33 + t * 1.1 + sin(vW.z * 0.21 + t * 0.6) * 1.6);
          float r2 = sin(vW.z * 0.41 - t * 0.9 + sin(vW.x * 0.27 - t * 0.45) * 1.8);
          float r3 = sin((vW.x + vW.z) * 0.9 + t * 2.1);
          float rip = (r1 + r2) * 0.25 + 0.5;
          float dd = smoothstep(0.0, 3.2, vDepth);
          vec3 c = mix(uShallow, uDeep, dd);
          c += (rip - 0.5) * 0.10;
          c += smoothstep(0.86, 1.0, rip * 0.85 + r3 * 0.15) * 0.35;
          float foam = 1.0 - smoothstep(0.02, 0.35 + 0.08 * sin(t * 1.7 + vW.x * 0.5), vDepth);
          c = mix(c, uFoam, foam * 0.85);
          float a = mix(0.55, 0.9, dd);
          a = max(a, foam * 0.9);
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true, fog: true, depthWrite: false,
    }));
    const w = new THREE.Mesh(g, mat);
    w.name = 'lagoa';
    w.renderOrder = 1;
    group.add(w);
  }

  // ------------------------------------------------------------ montanhas distantes (seguem a câmera)
  const farGroup = new THREE.Group();
  farGroup.name = 'horizonte';
  group.add(farGroup);
  {
    const b = new Merge();
    const haze = skyHorizon.clone();
    const layers = [
      { r: 1000, hMin: 70, hMax: 190, colA: col(0x7f9fc4), seed: 1, n: hi ? 110 : 60 },
      { r: 900, hMin: 35, hMax: 95, colA: col(0x6f9c7a), seed: 7, n: hi ? 90 : 50 },
    ];
    const cTop = new THREE.Color(), cBase = new THREE.Color();
    for (const L of layers) {
      const pts = [];
      for (let k = 0; k <= L.n; k++) {
        const a = (k / L.n) * TAU;
        const n = vnoise(Math.cos(a) * 4 + L.seed * 10, Math.sin(a) * 4 + L.seed * 3);
        const n2 = vnoise(Math.cos(a) * 11 + L.seed, Math.sin(a) * 11);
        const hgt = L.hMin + (L.hMax - L.hMin) * Math.pow(n, 1.6) + (n2 - 0.5) * 25;
        pts.push([a, Math.max(10, hgt)]);
      }
      for (let k = 0; k < L.n; k++) {
        const [a0, h0] = pts[k], [a1, h1] = pts[k + 1];
        const x0 = Math.cos(a0) * L.r, z0 = Math.sin(a0) * L.r, x1 = Math.cos(a1) * L.r, z1 = Math.sin(a1) * L.r;
        // sombreamento falso pela direção do sol
        const nx2 = Math.cos((a0 + a1) / 2), nz2 = Math.sin((a0 + a1) / 2);
        const lit = 0.82 + 0.18 * (-(nx2 * SUN_DIR.x + nz2 * SUN_DIR.z));
        cTop.copy(L.colA).multiplyScalar(lit).lerp(haze, 0.25);
        cBase.copy(haze);
        const snow = (h) => (h > 160 ? 1 : 0);
        const v0 = b.vert(x0, -30, z0, 0, 1, 0, cBase);
        const v1 = b.vert(x1, -30, z1, 0, 1, 0, cBase);
        const c0 = cTop.clone().lerp(col(0xffffff), snow(h0) * 0.7);
        const c1 = cTop.clone().lerp(col(0xffffff), snow(h1) * 0.7);
        const v2 = b.vert(x1, h1, z1, 0, 1, 0, c1);
        const v3 = b.vert(x0, h0, z0, 0, 1, 0, c0);
        b.idx.push(v0, v2, v1, v0, v3, v2);
      }
    }
    const g = keep(b.build(false));
    const m = new THREE.Mesh(g, keep(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide })));
    m.frustumCulled = false;
    m.renderOrder = -5;
    m.name = 'montanhas';
    farGroup.add(m);
  }
  // nuvens: aglomerados low-poly
  {
    const b = new Merge();
    const ico = keep(new THREE.IcosahedronGeometry(1, hi ? 1 : 0));
    const white = col(0xffffff), under = col(0xdde8f5);
    const n = hi ? 26 : 14;
    for (let k = 0; k < n; k++) {
      const a = rand() * TAU, r = 380 + rand() * 520;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = 150 + rand() * 110;
      const puffs = 4 + Math.floor(rand() * 4);
      const size = 18 + rand() * 22;
      for (let p = 0; p < puffs; p++) {
        const ox = (p - puffs / 2) * size * 0.75 + (rand() - 0.5) * size * 0.4;
        const oy = (rand() - 0.2) * size * 0.35;
        const oz = (rand() - 0.5) * size * 0.8;
        const s = size * (0.55 + rand() * 0.5);
        b.add(ico, mat4(cx + ox * Math.cos(a) - oz * Math.sin(a), cy + oy, cz + ox * Math.sin(a) + oz * Math.cos(a), 0, rand() * 3, 0, s, s * 0.62, s), p % 2 ? white : under);
      }
    }
    const g = keep(b.build(false));
    // clareia a parte de cima das nuvens pela normal
    const cattr = g.attributes.color, nattr = g.attributes.normal;
    for (let i = 0; i < cattr.count; i++) {
      const up = nattr.getY(i);
      const k = 0.86 + 0.14 * up;
      cattr.setXYZ(i, cattr.getX(i) * k, cattr.getY(i) * k, Math.min(1, cattr.getZ(i) * (k + 0.03)));
    }
    const m = new THREE.Mesh(g, keep(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
    m.frustumCulled = false;
    m.renderOrder = -4;
    m.name = 'nuvens';
    farGroup.add(m);
  }

  // ------------------------------------------------------------ atlas e malha estática dos marcos
  const atlas = envAtlas(hi);
  keep(atlas.tex);
  const AR = atlas.R, AW = atlas.white;
  const matAtlas = keep(new THREE.MeshLambertMaterial({ map: atlas.tex, vertexColors: true }));
  const st = new Merge(); // estruturas estáticas (castShadow)
  const G = {
    box: keep(new THREE.BoxGeometry(1, 1, 1)),
    cyl: keep(new THREE.CylinderGeometry(1, 1, 1, hi ? 16 : 10, 1)),
    cyl6: keep(new THREE.CylinderGeometry(1, 1, 1, 6, 1)),
    sph: keep(new THREE.SphereGeometry(1, hi ? 18 : 10, hi ? 12 : 7)),
    cone: keep(new THREE.ConeGeometry(1, 1, hi ? 16 : 10, 1)),
    torus: keep(new THREE.TorusGeometry(1, 0.08, 6, hi ? 40 : 24)),
    ico: keep(new THREE.IcosahedronGeometry(1, 0)),
  };
  const addS = (geo, x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) => st.add(geo, mat4(x, y, z, rx, ry, rz, sx, sy, sz), color, null, AW);
  // caixa com uma região do atlas nas faces laterais (4 lados ou só a frente)
  const texBox = (x, y, z, sx, sy, sz, ry, region, color, allSides = true) => {
    const g = G.box;
    const P = g.attributes.position, Nn = g.attributes.normal, U = g.attributes.uv;
    const m = mat4(x, y, z, 0, ry, 0, sx, sy, sz);
    _m3.getNormalMatrix(m);
    const base = st.count;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(m);
      const ny = Nn.getY(i), nzz = Nn.getZ(i);
      _n.fromBufferAttribute(Nn, i).applyMatrix3(_m3).normalize();
      const side = Math.abs(ny) < 0.5 && (allSides || nzz > 0.5);
      const r = side ? region : null;
      const cc = side ? col(0xffffff) : color;
      st.p.push(_v.x, _v.y, _v.z); st.n.push(_n.x, _n.y, _n.z); st.c.push(cc.r, cc.g, cc.b);
      if (r) st.uv.push(lerp(r[0], r[2], U.getX(i)), lerp(r[1], r[3], U.getY(i)));
      else st.uv.push(AW[0], AW[1]);
    }
    for (let i = 0; i < g.index.count; i++) st.idx.push(base + g.index.getX(i));
  };
  const posAt = (s, lat, out = new THREE.Vector3()) => {
    const smp = track.sample(s);
    out.copy(smp.pos).addScaledVector(smp.right, lat);
    out.y = groundAt(out.x, out.z);
    return out;
  };
  const headingAt = (s) => meta.headingAt(s);
  const animated = []; // funções (dt, t)

  // ------------------------------------------------------------ universidade (Campus da Ciência)
  {
    const cx = campus.x, cz = campus.z, y0 = groundAt(cx, cz + 10);
    const cream = col(0xf3ead7), stone = col(0xe4d8bd), roof = col(0xb9c2cc), dome = col(0x5fb3a1), gold = col(0xd9b34a), step = col(0xd8d2c4), dark = col(0x3c4a66);
    const W = 96, D = 24, Hb = 15;
    const fz = cz + D / 2; // fachada (lado da pista, +z)
    addS(G.box, cx, y0 - 1 + Hb / 2, cz, W, Hb + 2, D, cream);
    addS(G.box, cx, y0 + Hb + 0.4, cz, W + 1.2, 0.8, D + 1.2, stone);
    addS(G.box, cx, y0 + Hb + 1.2, cz, W - 4, 0.8, D - 4, roof);
    addS(G.box, cx, y0 + 0.6, cz, W + 1.5, 1.2, D + 1.5, stone);
    // alas laterais mais altas
    for (const sx of [-1, 1]) {
      addS(G.box, cx + sx * (W / 2 - 8), y0 + 9, cz + 1, 16, 20, D + 3, cream);
      addS(G.box, cx + sx * (W / 2 - 8), y0 + 19.3, cz + 1, 17, 0.8, D + 4, stone);
      // janelas das alas
      for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) {
        texBox(cx + sx * (W / 2 - 8) + (k - 1) * 4.6, y0 + 3.2 + r * 5.2, cz + 1 + (D + 3) / 2 + 0.05, 2.4, 3.6, 0.12, 0, AR.window, cream, false);
      }
    }
    // janelas do corpo central
    for (let r = 0; r < 2; r++) for (let k = -7; k <= 7; k++) {
      if (Math.abs(k) < 3) continue;
      const wx = cx + k * 4.2;
      if (Math.abs(wx - cx) > W / 2 - 17) continue;
      texBox(wx, y0 + 4 + r * 6, fz + 0.05, 2.2, 3.6, 0.12, 0, AR.window, cream, false);
    }
    // escadaria e pórtico com colunas
    const PW = 30, PD = 9;
    for (let k = 0; k < 4; k++) addS(G.box, cx, y0 + 0.25 + k * 0.5, fz + PD + 3 - k * 1.1, PW + 6 - k, 0.5, 3 + k * 0.3, step);
    addS(G.box, cx, y0 + 1.9, fz + PD / 2 + 0.5, PW, 0.6, PD, stone);
    const colH = 11;
    for (let k = 0; k < 8; k++) {
      const x = cx - PW / 2 + 1.8 + k * ((PW - 3.6) / 7);
      const z = fz + PD - 0.8;
      addS(G.box, x, y0 + 2.5, z, 1.9, 0.6, 1.9, stone);
      addS(G.cyl, x, y0 + 2.8 + colH / 2, z, 0.72, colH, 0.72, col(0xfbf7ee));
      addS(G.box, x, y0 + 3 + colH, z, 1.9, 0.5, 1.9, stone);
    }
    const eY = y0 + 3.2 + colH + 0.5;
    addS(G.box, cx, eY + 1.1, fz + PD / 2, PW + 1.5, 2.2, PD + 1.5, stone);
    // letreiro no friso
    texBox(cx, eY + 1.1, fz + PD + 0.8, PW - 2, 1.9, 0.1, 0, AR.campus, stone, false);
    // frontão (prisma triangular)
    {
      const tri = new THREE.Shape();
      tri.moveTo(-PW / 2 - 0.8, 0); tri.lineTo(PW / 2 + 0.8, 0); tri.lineTo(0, 5.2); tri.closePath();
      const pg = new THREE.ExtrudeGeometry(tri, { depth: PD + 1.5, bevelEnabled: false });
      st.add(pg, mat4(cx, eY + 2.2, fz - 0.75, 0, 0, 0, 1, 1, 1), cream, null, AW);
      const inner = new THREE.Shape();
      inner.moveTo(-PW / 2 + 1.2, 0); inner.lineTo(PW / 2 - 1.2, 0); inner.lineTo(0, 3.9); inner.closePath();
      const ig = new THREE.ExtrudeGeometry(inner, { depth: 0.2, bevelEnabled: false });
      st.add(ig, mat4(cx, eY + 2.6, fz + PD + 0.8, 0, 0, 0, 1, 1, 1), col(0xd6c7a6), null, AW);
      pg.dispose(); ig.dispose();
      // átomo dourado no tímpano
      for (let k = 0; k < 3; k++) st.add(G.torus, mat4(cx, eY + 4.1, fz + PD + 1.1, 0, 0, (k * Math.PI) / 3, 1.6, 0.7, 1.4), gold, null, AW);
      addS(G.sph, cx, eY + 4.1, fz + PD + 1.1, 0.35, 0.35, 0.35, gold);
    }
    // cúpula
    addS(G.cyl, cx, y0 + Hb + 2.5, cz, 7.5, 3, 7.5, cream);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      addS(G.box, cx + Math.cos(a) * 7.6, y0 + Hb + 2.6, cz + Math.sin(a) * 7.6, 0.5, 2.6, 0.5, stone, -a);
    }
    st.add(keep(new THREE.SphereGeometry(1, hi ? 24 : 14, hi ? 12 : 8, 0, TAU, 0, Math.PI / 2)), mat4(cx, y0 + Hb + 4, cz, 0, 0, 0, 7.2, 6.4, 7.2), dome, null, AW);
    addS(G.cyl, cx, y0 + Hb + 11, cz, 1.2, 2, 1.2, cream);
    addS(G.cone, cx, y0 + Hb + 13, cz, 1.4, 2.2, 1.4, dome);
    addS(G.sph, cx, y0 + Hb + 14.4, cz, 0.45, 0.45, 0.45, gold);
    // mastros com bandeiras
    const flags = ['flagA', 'flagBR', 'flagB'];
    flags.forEach((f, k) => {
      const x = cx + (k - 1) * 12, z = fz + PD + 12;
      addS(G.cyl, x, y0 + 6, z, 0.12, 12, 0.12, col(0xdddddd));
      addS(G.sph, x, y0 + 12.1, z, 0.22, 0.22, 0.22, gold);
      texBox(x + 1.9, y0 + 10.6, z, 3.6, 2.4, 0.06, 0, AR[f], col(0xffffff), true);
    });
    // canteiros de flores e caminho
    addS(G.box, cx, y0 + 0.02, fz + PD + 18, 10, 0.1, 30, col(0xe9dcc0));
    reserve(cx, cz, 58);
    reserve(cx, fz + 20, 20);
  }

  // ------------------------------------------------------------ arquibancadas com torcida
  const crowdSpots = [];
  {
    const smpA = track.sample(track.length - 40), smpB = track.sample(95);
    const a = smpA.pos, b = smpB.pos;
    const dir = b.clone().sub(a).setY(0).normalize();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    const heading = Math.atan2(dir.x, dir.z);
    const tiers = 8;
    const stands = [[-36, 40], [44, 108]];
    const seatCols = [col(0xe3262f), col(0x1d7bd8), col(0xffd23f), col(0x2fbf71), col(0x8a3cff)];
    const wd = track.sample(0).wallDist;
    for (const [x0, x1] of stands) {
      const len = x1 - x0;
      const mid = (x0 + x1) / 2;
      const base = new THREE.Vector3(mid, 0, 0).addScaledVector(right, wd + 5);
      base.y = groundAt(base.x, base.z);
      const faceOut = right.clone(); // arquibancada fica à direita, olhando para a pista (-right)
      for (let k = 0; k < tiers; k++) {
        const dist = 1.2 + k * 1.3;
        const h = 0.9 + k * 0.75;
        const c = base.clone().addScaledVector(faceOut, dist);
        addS(G.box, c.x, base.y + h / 2, c.z, len, h, 1.3, k % 2 ? col(0xd9dde4) : col(0xc5cad3), heading + Math.PI / 2);
        // assentos coloridos
        for (let sgi = 0; sgi < 6; sgi++) {
          const sx = -len / 2 + (sgi + 0.5) * (len / 6);
          const sp = c.clone().addScaledVector(dir, sx).addScaledVector(faceOut, -0.35);
          addS(G.box, sp.x, base.y + h + 0.18, sp.z, len / 6 - 0.4, 0.36, 0.5, seatCols[(sgi + k) % seatCols.length], heading + Math.PI / 2);
        }
        for (let p = 0.5; p < len - 0.4; p += hi ? 0.78 : 1.1) {
          if (rand() < 0.14) continue;
          const pp = c.clone().addScaledVector(dir, -len / 2 + p + (rand() - 0.5) * 0.15).addScaledVector(faceOut, 0.05);
          crowdSpots.push([pp.x, base.y + h, pp.z, heading + Math.PI]);
        }
      }
      // parede de trás, cobertura e pilares
      const back = base.clone().addScaledVector(faceOut, 1.2 + tiers * 1.3 + 0.4);
      addS(G.box, back.x, base.y + 4.5, back.z, len, 9, 0.6, col(0x2b3a6b), heading + Math.PI / 2);
      const roofC = base.clone().addScaledVector(faceOut, 6);
      addS(G.box, roofC.x, base.y + 12.2, roofC.z, len + 2, 0.4, 13, col(0xf4f4f4), heading + Math.PI / 2, 0, 0);
      for (let k = 0; k <= 5; k++) {
        const pp = back.clone().addScaledVector(dir, -len / 2 + (k / 5) * len);
        addS(G.cyl, pp.x, base.y + 6, pp.z, 0.3, 12, 0.3, col(0xbfc6cc));
      }
      // faixa frontal colorida
      const front = base.clone().addScaledVector(faceOut, 0.4);
      addS(G.box, front.x, base.y + 0.6, front.z, len, 1.2, 0.3, col(0xe3262f), heading + Math.PI / 2);
      for (let k = -2; k <= 2; k++) reserve(mid + k * len / 5, base.z + 8, 10);
    }
  }
  let crowd = null;
  const crowdTime = { value: 0 };
  if (crowdSpots.length) {
    const body = keep(new THREE.BoxGeometry(0.46, 0.62, 0.3));
    body.translate(0, 0.35, 0);
    const head = keep(new THREE.IcosahedronGeometry(0.17, 0));
    head.translate(0, 0.86, 0);
    const mk = (geo, colors) => {
      const mat = keep(new THREE.MeshLambertMaterial({ color: 0xffffff }));
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = crowdTime;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
          #include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
            float hop = max(0.0, sin(uTime * (5.0 + ph * 4.0) + ph * 6.2831));
            float wave = fract((ip.x * 0.7 - uTime * 18.0) / 160.0);
            float ola = smoothstep(0.0, 0.025, wave) * smoothstep(0.07, 0.03, wave);
            transformed.y += hop * hop * 0.22 * step(0.45, ph) + ola * 0.55;
          #endif
        `);
      };
      const im = new THREE.InstancedMesh(geo, mat, crowdSpots.length);
      const c = new THREE.Color();
      crowdSpots.forEach(([x, y, z, h], i) => {
        im.setMatrixAt(i, mat4(x, y, z, 0, h, 0, 1, 0.9 + rand() * 0.25, 1));
        im.setColorAt(i, c.copy(colors[Math.floor(rand() * colors.length)]));
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false;
      im.receiveShadow = false;
      im.computeBoundingSphere();
      group.add(im);
      return im;
    };
    const shirts = [0xe3262f, 0x1d7bd8, 0xffd23f, 0x2fbf71, 0x8a3cff, 0xff7b29, 0xffffff, 0x17a2b8, 0xff5fa2, 0x009c3b].map(col);
    const skins = [0xf2c9a0, 0xe0ac7e, 0xc68642, 0x8d5524, 0xf6d7b8, 0x6b4226].map(col);
    crowd = [mk(body, shirts), mk(head, skins)];
    crowd[0].name = 'torcida'; crowd[1].name = 'torcida-cabecas';
  }

  // ------------------------------------------------------------ Laboratório: vidrarias gigantes, DNA, tabela periódica
  const glass = new Merge();
  const liquid = new Merge();
  const bubbleSrc = []; // [x, y0, y1, z, raio]
  const liquidColors = [col(0x3cff7a), col(0xff4fd8), col(0x39c6ff), col(0xffd23f), col(0xff7b29), col(0xa66bff)];
  const lathe = (profile, seg) => {
    const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    return keep(g);
  };
  const SEG = hi ? 28 : 16;
  const flaskProfile = (R, H) => [[0.01, 0], [R * 0.92, 0], [R, R * 0.12], [R * 0.34, H * 0.62], [R * 0.28, H * 0.7], [R * 0.28, H * 0.97], [R * 0.34, H], [R * 0.3, H]];
  const addFlask = (x, z, R, H, ci, kind) => {
    const y = groundAt(x, z);
    let prof, liqProf;
    if (kind === 'erlen') {
      prof = flaskProfile(R, H);
      const f = 0.45;
      liqProf = [[0.01, 0.15], [R * 0.88, 0.15], [R * 0.93, R * 0.14], [lerp(R, R * 0.34, (H * f - R * 0.12) / (H * 0.62 - R * 0.12)), H * f], [0.01, H * f]];
    } else if (kind === 'beaker') {
      prof = [[0.01, 0], [R, 0], [R, H], [R * 1.08, H * 1.02]];
      liqProf = [[0.01, 0.15], [R * 0.95, 0.15], [R * 0.95, H * 0.55], [0.01, H * 0.55]];
    } else { // tubo de ensaio
      prof = [];
      for (let k = 0; k <= 6; k++) { const a = (k / 6) * Math.PI / 2; prof.push([Math.sin(a) * R, R - Math.cos(a) * R]); }
      prof.push([R, H], [R * 1.15, H * 1.01]);
      liqProf = [];
      for (let k = 0; k <= 6; k++) { const a = (k / 6) * Math.PI / 2; liqProf.push([Math.sin(a) * R * 0.9, R - Math.cos(a) * R * 0.9 + 0.1]); }
      liqProf.push([R * 0.9, H * 0.6], [0.01, H * 0.6]);
    }
    glass.add(lathe(prof, SEG), mat4(x, y, z), col(0xdff6ff));
    liquid.add(lathe(liqProf, SEG), mat4(x, y, z), liquidColors[ci % liquidColors.length]);
    const lvl = kind === 'erlen' ? H * 0.45 : kind === 'beaker' ? H * 0.55 : H * 0.6;
    const rr = kind === 'erlen' ? R * 0.6 : kind === 'beaker' ? R * 0.75 : R * 0.6;
    bubbleSrc.push([x, y + 0.6, y + lvl, z, rr, ci]);
    reserve(x, z, R + 2);
  };
  // escolhe pontos fora do corredor ao redor do setor do laboratório
  const labSpots = [
    [meta.ctrlS[3] - 6, -1, 'erlen', 5, 14], [meta.ctrlS[3] + 22, -1, 'beaker', 4.2, 10], [meta.ctrlS[4] + 20, -1, 'tube', 1.6, 13],
    [meta.ctrlS[4] + 26, -1, 'tube', 1.6, 11], [meta.ctrlS[4] + 32, -1, 'tube', 1.6, 12.5], [meta.ctrlS[5] + 34, -1, 'erlen', 6, 16],
    [meta.ctrlS[6] + 30, 1, 'beaker', 5, 11], [meta.ctrlS[4] - 10, 1, 'erlen', 4.5, 12], [meta.ctrlS[7] + 10, -1, 'erlen', 5.5, 15],
    [meta.ctrlS[5] + 10, 1, 'tube', 1.5, 10], [meta.ctrlS[5] + 15, 1, 'tube', 1.5, 12],
  ];
  labSpots.forEach(([s, side, kind, R, Hh], k) => {
    const smp = track.sample(s);
    let lat = side * (smp.wallDist + R + 4);
    const p = smp.pos.clone().addScaledVector(smp.right, lat);
    if (clearance(p.x, p.z) < R + 1.5) { lat += side * (R + 1.5 - clearance(p.x, p.z) + 1); p.copy(smp.pos).addScaledVector(smp.right, lat); }
    addFlask(p.x, p.z, R, Hh, k, kind);
  });
  // tripé com bico de Bunsen perto de um frasco grande
  const glassMesh = glass.count ? new THREE.Mesh(keep(glass.build(false)), keep(new THREE.MeshLambertMaterial({
    vertexColors: true, transparent: true, opacity: 0.33, depthWrite: false, side: THREE.DoubleSide, emissive: 0x335566, emissiveIntensity: 0.25,
  }))) : null;
  const liquidMesh = liquid.count ? new THREE.Mesh(keep(liquid.build(false)), keep(new THREE.MeshLambertMaterial({
    vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.0, transparent: true, opacity: 0.88,
  }))) : null;
  if (liquidMesh) {
    // líquidos levemente luminosos: emissivo pela própria cor do vértice
    liquidMesh.material.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor * 0.45;');
    };
    liquidMesh.name = 'liquidos';
    liquidMesh.renderOrder = 2;
    group.add(liquidMesh);
  }
  if (glassMesh) { glassMesh.name = 'vidros'; glassMesh.renderOrder = 3; group.add(glassMesh); }
  // bolhas
  let bubbles = null;
  const bubbleData = [];
  {
    const per = hi ? 7 : 4;
    for (const [x, y0, y1, z, r, ci] of bubbleSrc) {
      for (let k = 0; k < per; k++) bubbleData.push({ x, y0, y1, z, r, ph: rand(), sp: 0.12 + rand() * 0.12, ox: (rand() - 0.5) * 2, oz: (rand() - 0.5) * 2, size: 0.25 + rand() * 0.35, ci });
    }
    if (bubbleData.length) {
      const g = keep(new THREE.IcosahedronGeometry(1, hi ? 1 : 0));
      const m = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }));
      bubbles = new THREE.InstancedMesh(g, m, bubbleData.length);
      const c = new THREE.Color();
      bubbleData.forEach((b, i) => bubbles.setColorAt(i, c.copy(liquidColors[b.ci % liquidColors.length]).lerp(col(0xffffff), 0.6)));
      bubbles.frustumCulled = false;
      bubbles.name = 'bolhas';
      bubbles.renderOrder = 4;
      group.add(bubbles);
    }
  }
  const bM = new THREE.Matrix4(), bP = new THREE.Vector3(), bQ = new THREE.Quaternion(), bS = new THREE.Vector3();
  animated.push((dt, t) => {
    if (!bubbles) return;
    for (let i = 0; i < bubbleData.length; i++) {
      const b = bubbleData[i];
      const f = (t * b.sp + b.ph) % 1;
      const y = b.y0 + f * (b.y1 - b.y0);
      const wob = Math.sin(t * 3 + b.ph * 20) * 0.25;
      bP.set(b.x + b.ox * b.r * 0.5 + wob, y, b.z + b.oz * b.r * 0.5);
      const s = b.size * (0.5 + f * 0.8);
      bS.set(s, s, s);
      bM.compose(bP, bQ, bS);
      bubbles.setMatrixAt(i, bM);
    }
    bubbles.instanceMatrix.needsUpdate = true;
  });

  // Torre de DNA girando (fora da curva do Laboratório)
  let dna = null;
  {
    const s = meta.ctrlS[3] + 8;
    const smp = track.sample(s);
    const p = smp.pos.clone().addScaledVector(smp.right, -(smp.wallDist + 16));
    const y = groundAt(p.x, p.z);
    reserve(p.x, p.z, 12);
    // pedestal
    addS(G.cyl, p.x, y + 0.8, p.z, 7, 1.6, 7, col(0x5518b8));
    addS(G.cyl, p.x, y + 1.9, p.z, 5.5, 0.6, 5.5, col(0xefe9ff));
    texBox(p.x, y + 0.8, p.z + 7.05, 6, 1.2, 0.05, 0, AR.labSign, col(0x5518b8), false);
    const b = new Merge();
    const Hh = 38, R = 4.2, turns = 3.2;
    const n = hi ? 150 : 80;
    const sph = keep(new THREE.IcosahedronGeometry(1, hi ? 1 : 0));
    const cylG = keep(new THREE.CylinderGeometry(1, 1, 1, hi ? 8 : 5, 1));
    const cA = col(0x39c6ff), cB = col(0xff4fd8);
    const pairs = [[col(0xff4a4a), col(0x3cff7a)], [col(0xffd23f), col(0x4a7bff)]];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const a = t * turns * TAU;
      const yy = 2.5 + t * Hh;
      for (const [off, cc] of [[0, cA], [Math.PI, cB]]) {
        b.add(sph, mat4(Math.cos(a + off) * R, yy, Math.sin(a + off) * R, 0, 0, 0, 0.62), cc);
      }
      if (k % 4 === 0 && k > 0 && k < n) {
        const pr = pairs[(k / 4) % 2];
        const ax = Math.cos(a) * R, az = Math.sin(a) * R;
        // meia ligação de cada lado
        for (const [sgn, cc] of [[1, pr[0]], [-1, pr[1]]]) {
          const mx = (ax * sgn) / 2, mz = (az * sgn) / 2;
          E.set(0, -a, Math.PI / 2);
          Q.setFromEuler(E);
          P3.set(mx, yy, mz);
          S3.set(0.28, R, 0.28);
          M4.compose(P3, Q, S3);
          b.add(cylG, M4, cc);
        }
      }
    }
    const g = keep(b.build(false));
    const mat = keep(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x221133 }));
    dna = new THREE.Mesh(g, mat);
    dna.position.set(p.x, y, p.z);
    dna.castShadow = true;
    dna.name = 'dna';
    group.add(dna);
    animated.push((dt) => { dna.rotation.y += dt * 0.35; });
  }

  // Blocos da tabela periódica (pilhas e fileiras)
  {
    const spots = [
      [meta.ctrlS[2] + 6, 1, 3], [meta.ctrlS[5] - 8, 1, 2], [meta.ctrlS[6] + 8, -1, 3], [meta.ctrlS[7] + 30, -1, 2],
      [meta.ctrlS[8] + 10, 1, 3], [meta.ctrlS[1], -1, 2], [meta.ctrlS[9] + 20, -1, 2],
    ];
    let el = 0;
    for (const [s, side, count] of spots) {
      const smp = track.sample(s);
      const h = headingAt(s);
      for (let k = 0; k < count; k++) {
        const size = 3.6;
        const along = (k - (count - 1) / 2) * (size + 0.4);
        const lat = side * (smp.wallDist + 4.5 + (k % 2) * 1.2);
        const p = smp.pos.clone().addScaledVector(smp.right, lat).addScaledVector(smp.tangent, along);
        if (clearance(p.x, p.z) < 3) continue;
        const y = groundAt(p.x, p.z);
        const ry = h + (rand() - 0.5) * 0.5;
        texBox(p.x, y + size / 2 - 0.1, p.z, size, size, size, ry, AR['el' + (el % ELEMENTS.length)], col(0xffffff), true);
        el++;
        if (k === 0 && count > 2) {
          texBox(p.x, y + size * 1.5, p.z, size * 0.9, size * 0.9, size * 0.9, ry + 0.4, AR['el' + (el % ELEMENTS.length)], col(0xffffff), true);
          el++;
        }
        reserve(p.x, p.z, size);
      }
    }
  }

  // ------------------------------------------------------------ Observatório no cume
  let domeGroup = null;
  {
    const p = obsPos;
    const y = groundAt(p.x, p.z);
    reserve(p.x, p.z, 20);
    const white = col(0xf7f9fc), base = col(0xc9d3e0), dark = col(0x1b1f33);
    addS(G.cyl, p.x, y + 3, p.z, 10.5, 7, 10.5, base);
    addS(G.cyl, p.x, y + 6.7, p.z, 11, 0.5, 11, white);
    // anexo com placa
    const toTrack = sSum.pos.clone().sub(p).setY(0).normalize();
    const hdg = Math.atan2(toTrack.x, toTrack.z);
    const ax = p.clone().addScaledVector(toTrack, 11);
    addS(G.box, ax.x, y + 2.5, ax.z, 10, 5, 7, base, hdg);
    const signP = p.clone().addScaledVector(toTrack, 14.55);
    texBox(signP.x, y + 3.5, signP.z, 8, 1.5, 0.1, hdg, AR.obsSign, dark, false);
    addS(G.box, ax.x + toTrack.x * 3.52, y + 1.3, ax.z + toTrack.z * 3.52, 2, 2.6, 0.1, dark, hdg);
    // cúpula com fenda aberta + telescópio (gira devagar)
    const b = new Merge();
    const slit = 0.36;
    const segW = hi ? 32 : 18;
    const half1 = keep(new THREE.SphereGeometry(10, segW, hi ? 16 : 10, slit / 2, TAU - slit, 0, Math.PI / 2));
    b.add(half1, mat4(0, 0, 0), white);
    const inner = keep(new THREE.SphereGeometry(9.7, segW, hi ? 16 : 10, slit / 2, TAU - slit, 0, Math.PI / 2));
    // interior escuro (inverte as faces)
    const ii = inner.index.array;
    for (let k = 0; k < ii.length; k += 3) { const tmp = ii[k]; ii[k] = ii[k + 1]; ii[k + 1] = tmp; }
    const nn = inner.attributes.normal;
    for (let k = 0; k < nn.count; k++) nn.setXYZ(k, -nn.getX(k), -nn.getY(k), -nn.getZ(k));
    b.add(inner, mat4(0, 0, 0), dark);
    // venezianas da fenda
    b.add(G.box, mat4(0, 9.6, 0, 0, 0, 0, 0.5, 0.8, 1), col(0xdde3ea));
    // telescópio saindo pela fenda (fenda voltada para +z local)
    const tel = keep(new THREE.CylinderGeometry(1.1, 1.3, 16, hi ? 18 : 10, 1));
    const telM = mat4(0, 6.5, 5.2, Math.PI / 2 - 0.75, 0, 0, 1, 1, 1);
    b.add(tel, telM, col(0xe8ecf2));
    b.add(keep(new THREE.CylinderGeometry(1.35, 1.35, 1.2, hi ? 18 : 10, 1)), mat4(0, 6.5 + Math.cos(0.75) * 7.6, 5.2 + Math.sin(0.75) * 7.6, Math.PI / 2 - 0.75, 0, 0), col(0x2b3a6b));
    b.add(keep(new THREE.CircleGeometry(1.1, 16)), mat4(0, 6.5 + Math.cos(0.75) * 8.25, 5.2 + Math.sin(0.75) * 8.25, -0.75 - Math.PI, 0, 0), col(0x0a0f22));
    b.add(G.box, mat4(0, 3, 0, 0, 0, 0, 1.4, 6, 1.4), col(0x6a7384));
    const g = keep(b.build(false));
    const dome = new THREE.Mesh(g, keep(new THREE.MeshLambertMaterial({ vertexColors: true })));
    dome.castShadow = true;
    domeGroup = new THREE.Group();
    domeGroup.position.set(p.x, y + 6.9, p.z);
    domeGroup.rotation.y = hdg + 0.6;
    domeGroup.add(dome);
    domeGroup.name = 'observatorio';
    group.add(domeGroup);
    const baseRot = domeGroup.rotation.y;
    animated.push((dt, t) => { domeGroup.rotation.y = baseRot + Math.sin(t * 0.08) * 1.1; });
    // antena parabólica ao lado
    const dp = p.clone().addScaledVector(new THREE.Vector3(-toTrack.z, 0, toTrack.x), 18);
    const dy = groundAt(dp.x, dp.z);
    addS(G.cyl, dp.x, dy + 2.5, dp.z, 0.35, 5, 0.35, col(0xbfc6cc));
    st.add(keep(new THREE.SphereGeometry(4, hi ? 20 : 12, 6, 0, TAU, 0, 0.9)), mat4(dp.x, dy + 7.2, dp.z, -2.3, hdg, 0), col(0xf2f4f7), null, AW);
    addS(G.cyl, dp.x, dy + 6.2, dp.z, 0.12, 3, 0.12, col(0x777777), 0, 0.6);
    reserve(dp.x, dp.z, 6);
  }

  // ------------------------------------------------------------ Lagoa: tartarugas, flamingos, iguanas
  {
    const shell = keep(new THREE.SphereGeometry(1, hi ? 14 : 9, hi ? 8 : 5, 0, TAU, 0, Math.PI / 2));
    const addTortoise = (x, z, rot, s) => {
      const y = groundAt(x, z);
      st.add(shell, mat4(x, y + 0.35 * s, z, 0, rot, 0, 1.25 * s, 0.9 * s, 1.5 * s), col(0x5b5132), null, AW);
      // placas do casco
      for (let k = 0; k < 5; k++) {
        const a = rot + (k / 5) * TAU;
        st.add(G.ico, mat4(x + Math.sin(a) * 0.65 * s, y + 0.95 * s, z + Math.cos(a) * 0.75 * s, 0, a, 0, 0.38 * s, 0.12 * s, 0.38 * s), col(0x7a6b40), null, AW);
      }
      st.add(G.ico, mat4(x, y + 1.18 * s, z, 0, rot, 0, 0.42 * s, 0.14 * s, 0.5 * s), col(0x7a6b40), null, AW);
      const hx = x + Math.sin(rot) * 1.75 * s, hz = z + Math.cos(rot) * 1.75 * s;
      st.add(G.cyl, mat4(x + Math.sin(rot) * 1.3 * s, y + 0.7 * s, z + Math.cos(rot) * 1.3 * s, 0.9, rot, 0, 0.2 * s, 0.9 * s, 0.2 * s), col(0x8c8466), null, AW);
      st.add(G.sph, mat4(hx, y + 0.95 * s, hz, 0, rot, 0, 0.3 * s, 0.26 * s, 0.4 * s), col(0x8c8466), null, AW);
      for (const [lx, lz] of [[-0.8, 0.8], [0.8, 0.8], [-0.8, -0.8], [0.8, -0.8]]) {
        const px = x + Math.cos(rot) * lx * s + Math.sin(rot) * lz * s;
        const pz = z - Math.sin(rot) * lx * s + Math.cos(rot) * lz * s;
        st.add(G.cyl6, mat4(px, y + 0.3 * s, pz, 0, 0, 0, 0.25 * s, 0.6 * s, 0.25 * s), col(0x8c8466), null, AW);
      }
      reserve(x, z, 2.5 * s);
    };
    addTortoise(ISLETS[0][0] - 2, ISLETS[0][1] + 1, 0.7, 1.6);
    addTortoise(ISLETS[0][0] + 4, ISLETS[0][1] - 3, 2.6, 1.3);
    addTortoise(ISLETS[1][0], ISLETS[1][1], 4.0, 1.5);
    addTortoise(ISLETS[2][0] + 1, ISLETS[2][1], 1.2, 1.2);
    // tartarugas na margem perto do grampo
    const sh = track.sample(meta.ctrlS[21]);
    const tp = sh.pos.clone().addScaledVector(sh.right, sh.wallDist + 9);
    if (clearance(tp.x, tp.z) > 3) addTortoise(tp.x, tp.z, 3.5, 1.4);
    // flamingos na água rasa
    const pink = col(0xff7fa8), beak = col(0x222222);
    const addFlamingo = (x, z, rot) => {
      const y = meta.waterY;
      for (const lx of [-0.12, 0.12]) st.add(G.cyl6, mat4(x + lx, y + 0.6, z, 0, 0, 0, 0.04, 1.6, 0.04), pink, null, AW);
      st.add(G.sph, mat4(x, y + 1.55, z, 0, rot, 0, 0.35, 0.3, 0.6), pink, null, AW);
      st.add(G.cyl6, mat4(x + Math.sin(rot) * 0.35, y + 2.0, z + Math.cos(rot) * 0.35, 0.25, rot, 0, 0.05, 0.9, 0.05), pink, null, AW);
      st.add(G.sph, mat4(x + Math.sin(rot) * 0.5, y + 2.45, z + Math.cos(rot) * 0.5, 0, rot, 0, 0.14, 0.14, 0.2), pink, null, AW);
      st.add(G.cone, mat4(x + Math.sin(rot) * 0.72, y + 2.4, z + Math.cos(rot) * 0.72, Math.PI / 2 + 0.5, rot, 0, 0.06, 0.25, 0.06), beak, null, AW);
    };
    const fl = [[150, 490], [156, 494], [161, 488], [98, 552], [104, 556], [182, 540]];
    fl.forEach(([x, z], k) => { if (groundAt(x, z) < meta.waterY - 0.2 && clearance(x, z) > 2) addFlamingo(x, z, k * 1.3); });
    // iguanas marinhas nas pedras
    const addIguana = (x, z, rot) => {
      const y = groundAt(x, z);
      st.add(G.ico, mat4(x, y + 0.5, z, 0, rot, 0, 0.9, 0.5, 0.8), col(0x6f6a64), null, AW);
      st.add(G.sph, mat4(x, y + 1.05, z, 0, rot, 0, 0.18, 0.14, 0.55), col(0x2d2d33), null, AW);
      st.add(G.sph, mat4(x + Math.sin(rot) * 0.5, y + 1.12, z + Math.cos(rot) * 0.5, 0, rot, 0, 0.12, 0.1, 0.16), col(0x3a3a40), null, AW);
      st.add(G.cone, mat4(x - Math.sin(rot) * 0.8, y + 1.0, z - Math.cos(rot) * 0.8, -Math.PI / 2, rot, 0, 0.08, 0.7, 0.08), col(0x2d2d33), null, AW);
    };
    addIguana(ISLETS[0][0] + 6, ISLETS[0][1] + 5, 1);
    addIguana(ISLETS[3][0], ISLETS[3][1], 2.2);
    addIguana(ISLETS[1][0] - 5, ISLETS[1][1] + 3, 4);
  }

  // ------------------------------------------------------------ outros adereços científicos
  const spin = []; // {mesh|index, ...}
  {
    // Foguete na plataforma (no meio do campo interno)
    const rx = 70, rz = 150;
    if (clearance(rx, rz) > 12) {
      const y = groundAt(rx, rz);
      addS(G.box, rx, y + 0.5, rz, 12, 1, 12, col(0x8a8f99));
      addS(G.cyl, rx, y + 11, rz, 2.2, 18, 2.2, col(0xf7f7f7));
      texBox(rx, y + 11, rz, 4.3, 3.2, 4.3, 0.3, AR.rocket, col(0xffffff), true);
      addS(G.cone, rx, y + 23, rz, 2.2, 6, 2.2, col(0xe3262f));
      addS(G.cyl, rx, y + 1.8, rz, 2.4, 1.6, 2.4, col(0x333333));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + 0.3;
        addS(G.box, rx + Math.cos(a) * 2.8, y + 4, rz + Math.sin(a) * 2.8, 0.25, 4, 2.2, col(0xe3262f), -a);
      }
      addS(G.cyl, rx + 1.2, y + 17, rz, 0.5, 0.5, 0.5, col(0x1d4fd8));
      // torre de lançamento
      addS(G.box, rx - 5, y + 13, rz, 1.4, 26, 1.4, col(0xff7b29));
      for (let k = 0; k < 6; k++) addS(G.box, rx - 3.5, y + 4 + k * 4, rz, 3, 0.35, 0.35, col(0xff7b29));
      reserve(rx, rz, 12);
    }
    // Átomo gigante com elétrons girando (campo interno, perto da curva final)
    const ax = -40, az = 110;
    if (clearance(ax, az) > 10) {
      const y = groundAt(ax, az);
      addS(G.cyl, ax, y + 1, ax === ax ? az : az, 3.2, 2, 3.2, col(0x2b3a6b));
      const b = new Merge();
      const orb = keep(new THREE.TorusGeometry(7, 0.18, 6, hi ? 48 : 28));
      for (let k = 0; k < 3; k++) b.add(orb, mat4(0, 0, 0, Math.PI / 2 + 0.2, (k * Math.PI) / 3, 0, 1, 1, 1), col(0x39c6ff));
      const nuc = keep(new THREE.IcosahedronGeometry(1, 1));
      const nucl = [[0, 0, 0], [0.9, 0.3, 0], [-0.6, 0.7, 0.4], [0.2, -0.8, 0.6], [-0.4, -0.3, -0.9], [0.5, 0.6, -0.7], [-0.9, -0.2, 0.3]];
      nucl.forEach(([x, yy, z], k) => b.add(nuc, mat4(x * 1.1, yy * 1.1, z * 1.1, 0, 0, 0, 1.0), k % 2 ? col(0xff4a4a) : col(0x4a7bff)));
      const g = keep(b.build(false));
      const atom = new THREE.Mesh(g, keep(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x112244 })));
      atom.position.set(ax, y + 11, az);
      atom.castShadow = true;
      atom.name = 'atomo';
      group.add(atom);
      const eg = keep(new THREE.IcosahedronGeometry(0.75, 1));
      const electrons = new THREE.InstancedMesh(eg, keep(new THREE.MeshBasicMaterial({ color: 0xfff27a })), 3);
      electrons.position.copy(atom.position);
      electrons.frustumCulled = false;
      group.add(electrons);
      const em = new THREE.Matrix4(), ep = new THREE.Vector3(), eq = new THREE.Quaternion(), es = new THREE.Vector3(1, 1, 1);
      const eu = new THREE.Euler();
      animated.push((dt, t) => {
        atom.rotation.y = t * 0.2;
        for (let k = 0; k < 3; k++) {
          const a = t * (1.6 + k * 0.3) + k * 2;
          ep.set(Math.cos(a) * 7, 0, Math.sin(a) * 7);
          eu.set(Math.PI / 2 + 0.2, (k * Math.PI) / 3 + t * 0.2, 0);
          eq.setFromEuler(eu);
          // posição no plano da órbita (o toro está no plano xy local)
          ep.set(Math.cos(a) * 7, Math.sin(a) * 7, 0).applyQuaternion(eq);
          em.compose(ep, bQ, es);
          electrons.setMatrixAt(k, em);
        }
        electrons.instanceMatrix.needsUpdate = true;
      });
      reserve(ax, az, 10);
    }
    // Macieira de Newton (em frente ao prédio)
    {
      const x = campus.x + 30, z = campus.z + 30;
      const y = groundAt(x, z);
      addS(G.cyl, x, y + 2.2, z, 0.5, 4.4, 0.5, col(0x6b4423));
      for (const [ox, oy, oz, r] of [[0, 6, 0, 3.4], [2, 5.2, 1, 2.4], [-2, 5.4, -1, 2.5], [0.5, 7.4, -0.5, 2.2]]) addS(G.ico, x + ox, y + oy, z + oz, r, r * 0.85, r, col(0x3f9e3a));
      for (let k = 0; k < 16; k++) {
        const a = k * 2.4, r = 2.2 + (k % 3) * 0.6;
        addS(G.sph, x + Math.cos(a) * r, y + 4.8 + (k % 4) * 0.9, z + Math.sin(a) * r, 0.28, 0.28, 0.28, col(0xe3262f));
      }
      addS(G.sph, x + 1.2, y + 0.25, z + 2.5, 0.3, 0.3, 0.3, col(0xe3262f));
      reserve(x, z, 5);
    }
  }

  // Aerogeradores nos morros distantes (rotor girando)
  const turbines = [];
  {
    const spots = [[CX + 430, CZ - 250], [CX + 520, CZ - 120], [CX - 420, CZ + 300], [CX - 380, CZ - 320], [CX + 460, CZ + 380]];
    for (const [x, z] of spots) {
      const y = groundAt(x, z);
      addS(G.cone, x, y + 22, z, 1.4, 44, 1.4, col(0xf4f6f8));
      addS(G.box, x, y + 44, z, 1.6, 1.6, 3.2, col(0xf4f6f8), 0.5);
      turbines.push(new THREE.Vector3(x, y + 44, z));
    }
  }
  let rotors = null;
  {
    const b = new Merge();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      b.add(G.box, mat4(Math.cos(a) * 9, Math.sin(a) * 9, 0, 0, 0, a, 18, 1.1, 0.3), col(0xffffff));
    }
    b.add(G.sph, mat4(0, 0, 0, 0, 0, 0, 1.2), col(0xe3262f));
    const g = keep(b.build(false));
    rotors = new THREE.InstancedMesh(g, keep(new THREE.MeshLambertMaterial({ vertexColors: true })), turbines.length);
    rotors.frustumCulled = false;
    rotors.name = 'rotores';
    group.add(rotors);
    const rm = new THREE.Matrix4(), rq = new THREE.Quaternion(), rp = new THREE.Vector3(), re = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    animated.push((dt, t) => {
      for (let k = 0; k < turbines.length; k++) {
        re.set(0, 0.5, t * 1.2 + k);
        rq.setFromEuler(re);
        rp.copy(turbines[k]).addScaledVector(_v.set(Math.sin(0.5), 0, Math.cos(0.5)), 1.8);
        rm.compose(rp, rq, one);
        rotors.setMatrixAt(k, rm);
      }
      rotors.instanceMatrix.needsUpdate = true;
    });
  }

  // Postes de luz ao longo da pista (fora do corredor)
  const lampSpots = [];
  {
    let side = 1;
    for (let s = 12; s < track.length; s += hi ? 38 : 55) {
      const i = Math.round(s / ds) % N;
      if (FL[i]) continue;
      const smp = track.sample(s);
      const lat = side * (smp.wallDist + 2.6);
      const p = smp.pos.clone().addScaledVector(smp.right, lat);
      if (clearance(p.x, p.z) < 1.2) continue;
      lampSpots.push([p.x, groundAt(p.x, p.z), p.z, Math.atan2(-smp.right.x * side, -smp.right.z * side)]);
      side = -side;
    }
  }
  const instanced = (name, geo, material, spots, colorFn, { cast = true, receive = false } = {}) => {
    if (!spots.length) return null;
    const im = new THREE.InstancedMesh(geo, material, spots.length);
    const c = new THREE.Color();
    spots.forEach((sp, i) => {
      const [x, y, z, ry = 0, s = 1, sy = s] = sp;
      im.setMatrixAt(i, mat4(x, y, z, 0, ry, 0, s, sy, s));
      if (colorFn) im.setColorAt(i, colorFn(c, i));
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = cast && !!quality.shadows;
    im.receiveShadow = receive;
    im.name = name;
    im.computeBoundingSphere();
    group.add(im);
    return im;
  };
  {
    const b = new Merge();
    b.add(G.cyl6, mat4(0, 3.6, 0, 0, 0, 0, 0.13, 7.2, 0.13), col(0x3a3f4a));
    b.add(G.cyl6, mat4(0, 0.3, 0, 0, 0, 0, 0.3, 0.6, 0.3), col(0x3a3f4a));
    b.add(G.box, mat4(0, 7.1, 0.7, 0, 0, 0, 0.14, 0.14, 1.5), col(0x3a3f4a));
    b.add(G.box, mat4(0, 6.95, 1.45, 0, 0, 0, 0.5, 0.22, 0.9), col(0xf2f2f2));
    b.add(G.box, mat4(0, 6.82, 1.45, 0, 0, 0, 0.4, 0.06, 0.75), col(0xfff6c8));
    const g = keep(b.build(false));
    instanced('postes', g, keep(new THREE.MeshLambertMaterial({ vertexColors: true })), lampSpots, null);
  }

  // ------------------------------------------------------------ vegetação espalhada
  const vegMat = keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const vegMatDS = keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  const geoTree = (() => {
    const b = new Merge();
    b.add(G.cyl6, mat4(0, 1.8, 0, 0, 0, 0, 0.32, 3.6, 0.32), col(0x7a5230));
    const ico = keep(new THREE.IcosahedronGeometry(1, hi ? 1 : 0));
    b.add(ico, mat4(0, 5.2, 0, 0, 0, 0, 2.9, 2.5, 2.9), col(0x5fb43b));
    b.add(ico, mat4(1.4, 4.4, 0.6, 0, 1, 0, 1.8, 1.6, 1.8), col(0x6cc443));
    b.add(ico, mat4(-1.2, 4.6, -0.7, 0, 2, 0, 1.9, 1.7, 1.9), col(0x57a836));
    return keep(b.build(false));
  })();
  const geoIpe = (() => {
    const b = new Merge();
    b.add(G.cyl6, mat4(0, 2.2, 0, 0, 0, 0, 0.3, 4.4, 0.3), col(0x6b4a33));
    b.add(G.cyl6, mat4(0.8, 4.4, 0, 0, 0, -0.6, 0.15, 2, 0.15), col(0x6b4a33));
    const ico = keep(new THREE.IcosahedronGeometry(1, hi ? 1 : 0));
    b.add(ico, mat4(0, 5.8, 0, 0, 0, 0, 3.2, 2.2, 3.2), col(0xffffff));
    b.add(ico, mat4(1.6, 5.2, 0.4, 0, 1, 0, 1.8, 1.3, 1.8), col(0xf4f4f4));
    return keep(b.build(false));
  })();
  const geoPine = (() => {
    const b = new Merge();
    b.add(G.cyl6, mat4(0, 1.2, 0, 0, 0, 0, 0.28, 2.4, 0.28), col(0x6b4a2e));
    const cone = keep(new THREE.ConeGeometry(1, 1, hi ? 8 : 6, 1));
    b.add(cone, mat4(0, 3.6, 0, 0, 0, 0, 2.6, 3.4, 2.6), col(0x2f7d3a));
    b.add(cone, mat4(0, 5.6, 0, 0, 0.4, 0, 2.0, 3.0, 2.0), col(0x358a41));
    b.add(cone, mat4(0, 7.4, 0, 0, 0.8, 0, 1.3, 2.6, 1.3), col(0x3c9848));
    return keep(b.build(false));
  })();
  const geoPalm = (() => {
    const b = new Merge();
    let x = 0, y = 0, lean = 0;
    for (let k = 0; k < 6; k++) {
      const h = 1.3;
      lean += 0.07;
      b.add(G.cyl6, mat4(x + Math.sin(lean) * h / 2, y + Math.cos(lean) * h / 2, 0, 0, 0, -lean, 0.26 - k * 0.02, h, 0.26 - k * 0.02), k % 2 ? col(0xa98a5c) : col(0x8f7349));
      x += Math.sin(lean) * h; y += Math.cos(lean) * h;
    }
    const leaf = keep(new THREE.PlaneGeometry(0.9, 4.2, 1, 4));
    const lp = leaf.attributes.position;
    for (let k = 0; k < lp.count; k++) {
      const t = (lp.getY(k) + 2.1) / 4.2;
      lp.setXYZ(k, lp.getX(k) * (1 - t * 0.7), lp.getY(k) + 2.1, -t * t * 1.8);
    }
    leaf.computeVertexNormals();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU;
      b.add(leaf, mat4(x, y, 0, -1.2, a, 0, 1, 1, 1), k % 2 ? col(0x3fa34d) : col(0x4cb85a));
    }
    for (let k = 0; k < 3; k++) b.add(G.ico, mat4(x + Math.cos(k * 2.1) * 0.35, y - 0.35, Math.sin(k * 2.1) * 0.35, 0, 0, 0, 0.25), col(0x6b4a2e));
    return keep(b.build(false));
  })();
  const geoBush = (() => {
    const b = new Merge();
    b.add(G.ico, mat4(0, 0.7, 0, 0, 0, 0, 1.3, 1.0, 1.3), col(0x4f9e35));
    b.add(G.ico, mat4(0.9, 0.55, 0.3, 0, 1, 0, 0.9, 0.8, 0.9), col(0x5bb040));
    b.add(G.ico, mat4(-0.7, 0.5, -0.4, 0, 2, 0, 0.8, 0.7, 0.8), col(0x468f2f));
    return keep(b.build(false));
  })();
  const geoRock = (() => {
    const g = keep(new THREE.DodecahedronGeometry(1, 0));
    const p = g.attributes.position;
    const r = mulberry(3);
    for (let k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) * (0.8 + r() * 0.4), p.getY(k) * (0.6 + r() * 0.3), p.getZ(k) * (0.8 + r() * 0.4));
    g.computeVertexNormals();
    return keep(new Merge().add(g, mat4(0, 0.35, 0), col(0x9a9a9a)).build(false));
  })();
  const geoFlower = (() => {
    const b = new Merge();
    const t = keep(new THREE.OctahedronGeometry(0.2, 0));
    const r = mulberry(9);
    for (let k = 0; k < 7; k++) {
      const a = r() * TAU, d = r() * 0.8;
      b.add(t, mat4(Math.cos(a) * d, 0.3 + r() * 0.15, Math.sin(a) * d, 0, r() * 3, 0, 1, 0.6, 1), col(0xffffff));
    }
    b.add(keep(new THREE.ConeGeometry(0.9, 0.35, 5, 1)), mat4(0, 0.12, 0), col(0x4f9e35));
    return keep(b.build(false));
  })();

  const lists = { tree: [], ipe: [], pine: [], palm: [], bush: [], rock: [], flower: [] };
  const okSpot = (x, z, r, minClear = 3) => {
    if (clearance(x, z) < r + minClear) return false;
    if (isReserved(x, z, r)) return false;
    const h = groundAt(x, z);
    if (h < meta.waterY + 0.35) return false;
    return true;
  };
  const scatter = (count, pick, place) => {
    let tries = count * 8;
    let n = 0;
    while (n < count && tries-- > 0) {
      const [x, z] = pick();
      if (place(x, z)) n++;
    }
  };
  // bosques no campo interno e ao redor
  const groves = Math.round(46 * density);
  for (let g = 0; g < groves; g++) {
    const x0 = lerp(minX - 160, maxX + 160, rand()), z0 = lerp(minZ - 160, maxZ + 160, rand());
    if (clearance(x0, z0) < 12 || isReserved(x0, z0, 8)) continue;
    const pine = z0 > 330 && lagoonF(x0, z0) < -0.6 ? rand() < 0.7 : rand() < 0.25;
    const n = 5 + Math.floor(rand() * 10);
    for (let k = 0; k < n; k++) {
      const x = x0 + (rand() - 0.5) * 36, z = z0 + (rand() - 0.5) * 36;
      if (!okSpot(x, z, 2.5)) continue;
      const y = groundAt(x, z);
      const s = 0.8 + rand() * 0.6;
      if (pine) lists.pine.push([x, y - 0.1, z, rand() * TAU, s]);
      else if (rand() < 0.12) lists.ipe.push([x, y - 0.1, z, rand() * TAU, s]);
      else lists.tree.push([x, y - 0.1, z, rand() * TAU, s]);
    }
  }
  // cinturão de árvores mais afastado (horizonte)
  scatter(Math.round(320 * density), () => {
    const a = rand() * TAU, r = 140 + rand() * 380;
    return [CX + Math.cos(a) * r * 1.1, CZ + Math.sin(a) * r * 1.25];
  }, (x, z) => {
    if (!okSpot(x, z, 3, 8)) return false;
    const y = groundAt(x, z);
    const s = 0.9 + rand() * 0.7;
    if (y > 12 || rand() < 0.35) lists.pine.push([x, y - 0.1, z, rand() * TAU, s]);
    else lists.tree.push([x, y - 0.1, z, rand() * TAU, s]);
    return true;
  });
  // árvores soltas perto da pista
  scatter(Math.round(150 * density), () => [lerp(minX - 60, maxX + 60, rand()), lerp(minZ - 60, maxZ + 60, rand())], (x, z) => {
    if (!okSpot(x, z, 2.5, 4)) return false;
    const y = groundAt(x, z);
    const r = rand();
    if (lagoonF(x, z) > -0.5) lists.palm.push([x, y - 0.1, z, rand() * TAU, 0.9 + rand() * 0.4]);
    else if (r < 0.15) lists.ipe.push([x, y - 0.1, z, rand() * TAU, 0.8 + rand() * 0.5]);
    else if (r < 0.75) lists.tree.push([x, y - 0.1, z, rand() * TAU, 0.8 + rand() * 0.5]);
    else lists.pine.push([x, y - 0.1, z, rand() * TAU, 0.8 + rand() * 0.5]);
    return true;
  });
  // palmeiras nas ilhotas e margens da lagoa
  for (const [ix, iz, r] of ISLETS) {
    for (let k = 0; k < Math.max(1, Math.round(r / 3.5)); k++) {
      const a = rand() * TAU, d = rand() * r * 0.45;
      const x = ix + Math.cos(a) * d, z = iz + Math.sin(a) * d;
      if (!okSpot(x, z, 1, 1)) continue;
      lists.palm.push([x, groundAt(x, z) - 0.1, z, rand() * TAU, 0.9 + rand() * 0.3]);
    }
  }
  scatter(Math.round(40 * density + 10), () => {
    const L = LAGOON[Math.floor(rand() * LAGOON.length)];
    const a = rand() * TAU, q = 1.0 + rand() * 0.35;
    return [L[0] + Math.cos(a) * L[2] * q, L[1] + Math.sin(a) * L[3] * q];
  }, (x, z) => {
    if (!okSpot(x, z, 1.5, 2)) return false;
    const y = groundAt(x, z);
    if (y > 3) return false;
    lists.palm.push([x, y - 0.1, z, rand() * TAU, 0.9 + rand() * 0.45]);
    return true;
  });
  // arbustos, pedras e flores
  scatter(Math.round(420 * density), () => [lerp(minX - 90, maxX + 90, rand()), lerp(minZ - 90, maxZ + 90, rand())], (x, z) => {
    if (!okSpot(x, z, 1, 1.5)) return false;
    lists.bush.push([x, groundAt(x, z) - 0.1, z, rand() * TAU, 0.7 + rand() * 0.7]);
    return true;
  });
  scatter(Math.round(150 * density), () => [lerp(minX - 120, maxX + 120, rand()), lerp(minZ - 120, maxZ + 120, rand())], (x, z) => {
    if (!okSpot(x, z, 1, 1.5)) return false;
    const s = 0.5 + rand() * 1.6;
    lists.rock.push([x, groundAt(x, z) - 0.15 * s, z, rand() * TAU, s]);
    return true;
  });
  scatter(Math.round(900 * density), () => [lerp(minX - 50, maxX + 50, rand()), lerp(minZ - 50, maxZ + 50, rand())], (x, z) => {
    if (!okSpot(x, z, 0.5, 0.8)) return false;
    lists.flower.push([x, groundAt(x, z) - 0.05, z, rand() * TAU, 0.8 + rand() * 0.6]);
    return true;
  });
  // canteiros floridos na frente do prédio
  for (let k = 0; k < (hi ? 60 : 26); k++) {
    const x = campus.x + (rand() - 0.5) * 60, z = campus.z + 22 + rand() * 18;
    if (clearance(x, z) < 1 || Math.abs(x - campus.x) < 6) continue;
    lists.flower.push([x, groundAt(x, z) - 0.05, z, rand() * TAU, 1 + rand() * 0.5]);
  }
  const greens = (c) => c.setHSL(0.26 + (rand() - 0.5) * 0.06, 0.5 + rand() * 0.25, 0.75 + rand() * 0.25).lerp(col(0xffffff), 0.35);
  instanced('arvores', geoTree, vegMat, lists.tree, greens);
  instanced('ipes', geoIpe, vegMat, lists.ipe, (c) => c.set(rand() < 0.5 ? 0xff7eb6 : 0xffd23f));
  instanced('pinheiros', geoPine, vegMat, lists.pine, greens);
  instanced('palmeiras', geoPalm, vegMatDS, lists.palm, greens);
  instanced('arbustos', geoBush, vegMat, lists.bush, greens);
  instanced('pedras', geoRock, vegMat, lists.rock, (c) => c.setHSL(0.08, 0.1, 0.55 + rand() * 0.3), { cast: false });
  const flowerCols = [0xff4a6e, 0xffd23f, 0xffffff, 0xb388ff, 0xff8a3d, 0xff7eb6].map(col);
  instanced('flores', geoFlower, vegMat, lists.flower, (c) => c.copy(flowerCols[Math.floor(rand() * flowerCols.length)]), { cast: false });

  // ------------------------------------------------------------ malha estática dos marcos
  {
    const g = keep(st.build(true));
    const m = new THREE.Mesh(g, matAtlas);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = 'marcos';
    m.matrixAutoUpdate = false;
    group.add(m);
  }

  // ------------------------------------------------------------ pássaros (tentilhões) sobre a lagoa
  let birds = null;
  const birdData = [];
  {
    const n = hi ? 14 : 8;
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, -0.9, 0, -0.1, 0, 0, -0.3, 0, 0, 0.3, 0, 0, -0.3, 0.9, 0, -0.1], 3));
    g.computeVertexNormals();
    birds = new THREE.InstancedMesh(g, keep(new THREE.MeshBasicMaterial({ color: 0x3b3b46, side: THREE.DoubleSide })), n);
    birds.frustumCulled = false;
    birds.name = 'passaros';
    group.add(birds);
    for (let k = 0; k < n; k++) birdData.push({ ph: rand() * TAU, r: 25 + rand() * 30, h: 10 + rand() * 12, sp: 0.25 + rand() * 0.15, cx: 130 + (rand() - 0.5) * 40, cz: 500 + (rand() - 0.5) * 40 });
  }
  const birdM = new THREE.Matrix4(), birdP = new THREE.Vector3(), birdQ = new THREE.Quaternion(), birdS = new THREE.Vector3(), birdE = new THREE.Euler();
  animated.push((dt, t) => {
    for (let k = 0; k < birdData.length; k++) {
      const b = birdData[k];
      const a = t * b.sp + b.ph;
      birdP.set(b.cx + Math.cos(a) * b.r, b.h + Math.sin(a * 2.3) * 1.5, b.cz + Math.sin(a) * b.r);
      birdE.set(0, -a, 0);
      birdQ.setFromEuler(birdE);
      const flap = 0.35 + Math.abs(Math.sin(t * 9 + b.ph * 3));
      birdS.set(1.3, 1, 1.3 * flap);
      birdM.compose(birdP, birdQ, birdS);
      birds.setMatrixAt(k, birdM);
    }
    birds.instanceMatrix.needsUpdate = true;
  });

  // ------------------------------------------------------------ atualização por quadro
  const camFwd = new THREE.Vector3();
  const target = new THREE.Vector3();
  let camHint;
  let dim = 0;
  const tunnelS = meta.tunnelS;
  const texel = (2 * SHADOW_HALF) / (quality.shadowMapSize || 2048);
  function update(dt, t, camera) {
    waterUniforms.uTime.value = t;
    crowdTime.value = t;
    for (let k = 0; k < animated.length; k++) animated[k](dt, t);
    if (!camera) return;
    // céu, nuvens e montanhas acompanham a câmera
    sky.position.copy(camera.position);
    const far = Math.min(camera.far || 2000, 4000);
    const sc = (far * 0.88) / 1000;
    farGroup.position.set(camera.position.x, 0, camera.position.z);
    farGroup.scale.set(sc, sc, sc);
    farGroup.rotation.y = t * 0.002;
    // sombra: caixa apertada à frente da câmera, alinhada aos texels
    camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    if (camFwd.lengthSq() < 1e-6) camFwd.set(0, 0, 1);
    camFwd.normalize();
    target.copy(camera.position).addScaledVector(camFwd, SHADOW_HALF * 0.55);
    target.x = Math.round(target.x / texel) * texel;
    target.z = Math.round(target.z / texel) * texel;
    target.y = 0;
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(SUN_DIR, 200);
    sun.target.updateMatrixWorld();
    // dentro do túnel: luz do dia reduzida
    const r = track.project(camera.position, camHint);
    camHint = r.s;
    const inT = r.s > tunnelS[0] + 3 && r.s < tunnelS[1] - 3 && camera.position.y < r.groundY + 11 && Math.abs(r.lateral) < 20;
    dim += ((inT ? 1 : 0) - dim) * Math.min(1, dt * 4);
    sun.intensity = baseSun * (1 - 0.72 * dim);
    hemi.intensity = baseHemi * (1 - 0.5 * dim);
  }

  return {
    update,
    sun,
    hemi,
    groundAt,
    dispose() {
      scene.remove(group);
      scene.fog = null;
      disposables.forEach((d) => d && d.dispose && d.dispose());
    },
  };
}
