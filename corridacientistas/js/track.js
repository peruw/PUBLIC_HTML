// Pista "Campus da Ciência": traçado em 8 com viaduto sobre o túnel,
// consultas de posição (sample/project/curvature/racingLine) e malhas da pista.
import * as THREE from './three.js';
import { bus } from './events.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const wrapAngle = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

// ---------------------------------------------------------------------------
// Traçado: [x, z, meia-largura do asfalto, largura do acostamento]. Sentido da corrida = ordem.
const CTRL = [
  [0, 0, 10.5, 5], [70, 0, 10.5, 5], [130, 0, 10, 5], // reta de largada
  [180, 13, 9.5, 5.5], [208, 50, 9.5, 5.5], [214, 96, 9, 5], // curva do Laboratório
  [240, 136, 9, 5], [240, 182, 9, 5], [212, 216, 9, 5], // S
  [170, 248, 9, 5], [128, 280, 9, 5], [88, 312, 9, 5], [52, 344, 9, 5], // subida (viaduto no 11)
  [24, 380, 9.5, 5], [14, 420, 9.5, 5], [26, 460, 9, 5], // cume do Observatório e descida
  [58, 493, 8.5, 2], [102, 511, 8.5, 2], [150, 515, 8.5, 2], [194, 507, 9, 3], // ponte da lagoa
  [226, 492, 10, 5], [240, 466, 10, 5], [228, 440, 10, 5], // grampo
  [196, 414, 9, 3], [150, 368, 8.5, 2], [100, 314, 8.5, 2], [50, 260, 8.5, 2], // túnel
  [-4, 192, 9, 5], [-54, 128, 9, 5], // reta de Tesla
  [-92, 72, 9.5, 5.5], [-96, 26, 10, 5.5], [-66, 3, 10.5, 5], // curva final
];
// Relevo: [índice fracionário do ponto de controle, altura]
const ELEV = [
  [0, 0], [5.4, 0], [12.75, 16], [13.35, 16], [14.9, 10], [16.3, 4.4], [18.7, 3.8],
  [20.8, 2.2], [23.2, 0.5], [24.0, 0], [CTRL.length, 0],
];
const BRIDGE_K = [16.3, 18.75];
const TUNNEL_K = [23.95, 26.12];
const WATER_Y = -1.5;

// Gerador pseudoaleatório determinístico
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

// Interpolação cúbica monotônica (PCHIP) para o perfil de altura
function pchip(xs, ys) {
  const n = xs.length;
  const d = [];
  const m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) continue;
    const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i];
    const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = clamp((x - xs[i]) / h, 0, 1);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// ---------------------------------------------------------------------------
// Construtor de geometria mesclada (posição, normal, cor, uv)
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
class Builder {
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; this.idx = []; }
  get count() { return this.p.length / 3; }
  vert(x, y, z, nx, ny, nz, col, u, v) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col.r, col.g, col.b); this.uv.push(u, v);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); } // a,b,c,d anti-horário visto de frente
  // Mescla uma BufferGeometry transformada; uvRect remapeia o uv [0,1] para uma região do atlas.
  geo(geo, matrix, col, uvRect, uvFixed) {
    const base = this.count;
    const P = geo.attributes.position, Nn = geo.attributes.normal, U = geo.attributes.uv, C = geo.attributes.color;
    _m3.getNormalMatrix(matrix);
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(Nn, i).applyMatrix3(_m3).normalize();
      this.p.push(_v.x, _v.y, _v.z); this.n.push(_n.x, _n.y, _n.z);
      if (C) this.c.push(C.getX(i) * col.r, C.getY(i) * col.g, C.getZ(i) * col.b);
      else this.c.push(col.r, col.g, col.b);
      if (uvFixed) this.uv.push(uvFixed[0], uvFixed[1]);
      else if (uvRect && U) this.uv.push(lerp(uvRect[0], uvRect[2], U.getX(i)), lerp(uvRect[1], uvRect[3], U.getY(i)));
      else if (U) this.uv.push(U.getX(i), U.getY(i));
      else this.uv.push(0, 0);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// Caixa orientada (eixos unitários ax, ay, az; meias-medidas). A face +az pode receber uma região do atlas.
function addBox(b, c, ax, ay, az, hx, hy, hz, col, white, front, frontCol, skipBottom) {
  const faces = [
    [az, ax, ay, hz, hx, hy, front],
    [_neg(az), _neg(ax), ay, hz, hx, hy, null],
    [ax, _neg(az), ay, hx, hz, hy, null],
    [_neg(ax), az, ay, hx, hz, hy, null],
    [ay, ax, _neg(az), hy, hx, hz, null],
    [_neg(ay), ax, az, hy, hx, hz, null],
  ];
  for (let f = 0; f < 6; f++) {
    if (skipBottom && f === 5) continue;
    const [n, u, v, hn, hu, hv, reg] = faces[f];
    const cc = reg ? (frontCol || WHITE_COL) : col;
    const uv = reg || [white[0], white[1], white[0], white[1]];
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const ids = pts.map(([su, sv], k) => {
      const x = c.x + n.x * hn + u.x * hu * su + v.x * hv * sv;
      const y = c.y + n.y * hn + u.y * hu * su + v.y * hv * sv;
      const z = c.z + n.z * hn + u.z * hu * su + v.z * hv * sv;
      const uu = k === 0 || k === 3 ? uv[0] : uv[2];
      const vv = k < 2 ? uv[1] : uv[3];
      return b.vert(x, y, z, n.x, n.y, n.z, cc, uu, vv);
    });
    b.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}
const _negPool = [];
let _negI = 0;
function _neg(v) {
  if (_negPool.length < 64) _negPool.push(new THREE.Vector3());
  const o = _negPool[_negI++ % _negPool.length];
  return o.set(-v.x, -v.y, -v.z);
}
const WHITE_COL = new THREE.Color(1, 1, 1);
const col = (hex) => new THREE.Color(hex);

// ---------------------------------------------------------------------------
// Texturas procedurais
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function canvasTex(c, { repeat = false, aniso = 1, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// Asfalto: largura da pista em u (0..1), 12 m em v.
function asphaltTexture(hi, aniso) {
  const W = hi ? 512 : 256, H = hi ? 1024 : 512;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const r = mulberry(7);
  g.fillStyle = '#6e727b';
  g.fillRect(0, 0, W, H);
  // manchas suaves
  for (let i = 0; i < 40; i++) {
    const x = r() * W, y = r() * H, rad = (0.05 + r() * 0.15) * W;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.5;
    gr.addColorStop(0, dark ? 'rgba(40,42,48,0.10)' : 'rgba(150,152,160,0.08)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    for (const oy of [-H, 0, H]) g.fillRect(x - rad, y - rad + oy, rad * 2, rad * 2);
  }
  // granulado
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 34 + (r() < 0.04 ? 30 : 0) - (r() < 0.04 ? 26 : 0);
    d[i] += n; d[i + 1] += n; d[i + 2] += n + 2;
  }
  g.putImageData(img, 0, 0);
  // faixa de desgaste no meio de cada metade
  g.fillStyle = 'rgba(30,30,34,0.10)';
  g.fillRect(W * 0.22, 0, W * 0.12, H);
  g.fillRect(W * 0.66, 0, W * 0.12, H);
  // linhas de borda e tracejado central
  const line = (x0, w, y0, h) => {
    g.fillStyle = '#f4f4ee';
    g.fillRect(x0, y0, w, h);
    g.fillStyle = 'rgba(90,90,90,0.25)';
    for (let k = 0; k < (w * h) / 30; k++) g.fillRect(x0 + r() * w, y0 + r() * h, 1.5, 1.5);
  };
  line(W * 0.018, W * 0.018, 0, H);
  line(W * (1 - 0.036), W * 0.018, 0, H);
  line(W * 0.4925, W * 0.015, 0, H * 0.25);
  line(W * 0.4925, W * 0.015, H * 0.5, H * 0.25);
  return canvasTex(c, { repeat: true, aniso });
}

// Grama/terra: tons de cinza claros, multiplicados pela cor do vértice.
function grassTexture(hi, aniso) {
  const S = hi ? 256 : 128;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const r = mulberry(11);
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, S, S);
  const blades = hi ? 2600 : 900;
  for (let i = 0; i < blades; i++) {
    const x = r() * S, y = r() * S;
    const l = 150 + r() * 105;
    g.strokeStyle = `rgba(${l},${l},${l},0.55)`;
    g.lineWidth = 1;
    const dx = (r() - 0.5) * 3, dy = -2 - r() * 4;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + dx, y + oy + dy); g.stroke();
    }
  }
  for (let i = 0; i < 30; i++) {
    const x = r() * S, y = r() * S, rad = 8 + r() * 24;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, r() < 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(90,90,90,0.12)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  return canvasTex(c, { repeat: true, aniso });
}

// Céu estrelado do túnel
function starTexture(hi) {
  const W = hi ? 1024 : 512, H = hi ? 512 : 256;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const r = mulberry(99);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b0826');
  bg.addColorStop(0.5, '#1a0f45');
  bg.addColorStop(1, '#0b0826');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // nebulosas
  const neb = ['rgba(180,60,220,0.20)', 'rgba(40,140,255,0.18)', 'rgba(255,90,160,0.14)', 'rgba(60,220,200,0.12)'];
  for (let i = 0; i < 18; i++) {
    const x = r() * W, y = r() * H, rad = (0.08 + r() * 0.2) * W;
    for (const ox of [-W, 0, W]) {
      const gr = g.createRadialGradient(x + ox, y, 0, x + ox, y, rad);
      gr.addColorStop(0, neb[i % neb.length]);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2);
    }
  }
  // estrelas
  const n = hi ? 1400 : 500;
  for (let i = 0; i < n; i++) {
    const x = r() * W, y = r() * H;
    const big = r() < 0.06;
    const s = big ? 1.6 + r() * 1.6 : 0.5 + r() * 0.9;
    const tint = ['#ffffff', '#cfe3ff', '#fff2c8', '#ffd0f0'][Math.floor(r() * 4)];
    g.fillStyle = tint;
    g.globalAlpha = 0.5 + r() * 0.5;
    g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill();
    if (big) {
      g.globalAlpha = 0.35;
      g.fillRect(x - s * 4, y - 0.5, s * 8, 1);
      g.fillRect(x - 0.5, y - s * 4, 1, s * 8);
    }
  }
  g.globalAlpha = 1;
  return canvasTex(c, { repeat: true });
}

// Setas dos aceleradores (anima pelo offset)
function chevronTexture() {
  const W = 128, H = 256;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, W, 0);
  bg.addColorStop(0, '#1b0b4a'); bg.addColorStop(0.5, '#2b1470'); bg.addColorStop(1, '#1b0b4a');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  for (let k = 0; k < 2; k++) {
    const y0 = k * 128;
    const gr = g.createLinearGradient(0, y0 + 20, 0, y0 + 100);
    gr.addColorStop(0, '#fff6a8'); gr.addColorStop(0.5, '#ffb300'); gr.addColorStop(1, '#ff5a1f');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(W * 0.5, y0 + 18); g.lineTo(W * 0.92, y0 + 70); g.lineTo(W * 0.92, y0 + 104);
    g.lineTo(W * 0.5, y0 + 52); g.lineTo(W * 0.08, y0 + 104); g.lineTo(W * 0.08, y0 + 70);
    g.closePath(); g.fill();
  }
  // bordas ciano
  g.fillStyle = '#39f3ff';
  g.fillRect(0, 0, 7, H); g.fillRect(W - 7, 0, 7, H);
  const t = canvasTex(c, { repeat: true });
  return t;
}

// Brilho radial (sprites/pontos)
function glowTexture() {
  const S = 64;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return canvasTex(c);
}

// Atlas com placas, tabuleiro, setas e padrões. Região 'white' serve para geometria lisa.
function buildAtlas(hi, aniso) {
  const W = hi ? 2048 : 1024, H = hi ? 1024 : 512;
  const k = W / 2048;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.scale(k, k);
  const regions = {};
  const put = (name, x, y, w, h, draw) => {
    g.save(); g.translate(x, y);
    g.beginPath(); g.rect(0, 0, w, h); g.clip();
    draw(g, w, h);
    g.restore();
    // v invertido (flipY)
    regions[name] = [(x + 2) / 2048, 1 - (y + h - 2) / 1024, (x + w - 2) / 2048, 1 - (y + 2) / 1024];
  };
  const FONT = '"Trebuchet MS", "Segoe UI", "DejaVu Sans", Arial, sans-serif';
  const banner = (text, bg1, bg2, fg, stroke, deco) => (gg, w, h) => {
    const gr = gg.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, bg1); gr.addColorStop(1, bg2);
    gg.fillStyle = gr; gg.fillRect(0, 0, w, h);
    if (deco) deco(gg, w, h);
    gg.strokeStyle = 'rgba(255,255,255,0.85)'; gg.lineWidth = 8;
    gg.strokeRect(10, 10, w - 20, h - 20);
    let size = h * 0.56;
    gg.font = `900 ${size}px ${FONT}`;
    while (gg.measureText(text).width > w - 70 && size > 20) { size -= 2; gg.font = `900 ${size}px ${FONT}`; }
    gg.textAlign = 'center'; gg.textBaseline = 'middle';
    gg.lineJoin = 'round';
    gg.lineWidth = size * 0.16; gg.strokeStyle = stroke;
    gg.strokeText(text, w / 2, h * 0.54);
    gg.fillStyle = fg;
    gg.fillText(text, w / 2, h * 0.54);
  };
  const stars = (n, seed) => (gg, w, h) => {
    const r = mulberry(seed);
    for (let i = 0; i < n; i++) {
      gg.fillStyle = `rgba(255,255,255,${0.4 + r() * 0.6})`;
      gg.beginPath(); gg.arc(r() * w, r() * h, 1 + r() * 2.5, 0, TAU); gg.fill();
    }
  };
  // branco
  put('white', 0, 0, 48, 48, (gg, w, h) => { gg.fillStyle = '#fff'; gg.fillRect(0, 0, w, h); });
  // tabuleiro de chegada 16x2
  put('checker', 64, 0, 1024, 128, (gg, w, h) => {
    const s = w / 16;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
      gg.fillStyle = (i + j) % 2 ? '#141414' : '#f7f7f7';
      gg.fillRect(i * s, j * s, s, s);
    }
  });
  put('checkerSmall', 1104, 0, 256, 128, (gg, w, h) => {
    const s = 32;
    for (let i = 0; i < w / s; i++) for (let j = 0; j < h / s; j++) {
      gg.fillStyle = (i + j) % 2 ? '#141414' : '#f7f7f7';
      gg.fillRect(i * s, j * s, s, s);
    }
  });
  put('hazard', 1376, 0, 256, 64, (gg, w, h) => {
    gg.fillStyle = '#ffd000'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#1d1d1d';
    for (let x = -h; x < w + h; x += 48) { gg.beginPath(); gg.moveTo(x, h); gg.lineTo(x + 24, h); gg.lineTo(x + 24 + h, 0); gg.lineTo(x + h, 0); gg.fill(); }
  });
  put('redwhite', 1376, 64, 256, 64, (gg, w, h) => {
    for (let i = 0; i < 8; i++) { gg.fillStyle = i % 2 ? '#ffffff' : '#e3262f'; gg.fillRect(i * 32, 0, 32, h); }
  });
  put('ramp', 1912, 0, 128, 128, (gg, w, h) => {
    const gr = gg.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#ffe14d'); gr.addColorStop(1, '#ff8a1f');
    gg.fillStyle = gr; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#1b1b1b';
    for (let j = 0; j < 2; j++) {
      const y = 10 + j * 58;
      gg.beginPath(); gg.moveTo(w / 2, y); gg.lineTo(w * 0.86, y + 30); gg.lineTo(w * 0.86, y + 44);
      gg.lineTo(w / 2, y + 16); gg.lineTo(w * 0.14, y + 44); gg.lineTo(w * 0.14, y + 30); gg.fill();
    }
    gg.fillStyle = '#e3262f'; gg.fillRect(0, 0, 8, h); gg.fillRect(w - 8, 0, 8, h);
  });
  // seta de curva (aponta para a direita)
  put('arrow', 1648, 0, 128, 128, (gg, w, h) => {
    gg.fillStyle = '#e3262f'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#ffffff';
    for (let j = 0; j < 2; j++) {
      const x = 14 + j * 52;
      gg.beginPath(); gg.moveTo(x, 18); gg.lineTo(x + 30, 18); gg.lineTo(x + 62, 64); gg.lineTo(x + 30, 110);
      gg.lineTo(x, 110); gg.lineTo(x + 32, 64); gg.fill();
    }
  });
  put('arrowBlue', 1780, 0, 128, 128, (gg, w, h) => {
    gg.fillStyle = '#1a55d6'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#ffffff';
    for (let j = 0; j < 2; j++) {
      const x = 14 + j * 52;
      gg.beginPath(); gg.moveTo(x, 18); gg.lineTo(x + 30, 18); gg.lineTo(x + 62, 64); gg.lineTo(x + 30, 110);
      gg.lineTo(x, 110); gg.lineTo(x + 32, 64); gg.fill();
    }
  });
  // faixas com nomes dos setores
  const row = [
    ['largada', 'LARGADA • CHEGADA', '#e3262f', '#a3121b', '#ffffff', '#5a0a10'],
    ['lab', 'LABORATÓRIO', '#8a3cff', '#5518b8', '#ffffff', '#2a0a60'],
    ['obs', 'OBSERVATÓRIO', '#1b2f6b', '#0b1433', '#ffe36e', '#050a1e', stars(60, 3)],
    ['lagoa', 'LAGOA DE GALÁPAGOS', '#19b5c9', '#0b7d98', '#ffffff', '#07435a'],
    ['tunel', 'TÚNEL ESPACIAL', '#2a1060', '#0a0520', '#7ef9ff', '#12063a', stars(80, 5)],
    ['tesla', 'RETA DE TESLA', '#ffcf1a', '#f09000', '#1b1b1b', '#fff4c0'],
    ['campus', 'CAMPUS DA CIÊNCIA', '#f5ecd6', '#e2d3ae', '#2b3a6b', '#ffffff'],
  ];
  row.forEach(([name, text, a, b2, fg, st, deco], i) => {
    put(name, (i % 2) * 1024, 136 + Math.floor(i / 2) * 136, 1024, 128, banner(text, a, b2, fg, st, deco));
  });
  // placas com fórmulas (512x256)
  const boards = [
    ['emc2', 'E = mc²', '#ffffff', '#1d4fd8'],
    ['fma', 'F = m·a', '#fff3c4', '#d7263d'],
    ['pvnrt', 'PV = nRT', '#e8fff1', '#138a4a'],
    ['pitag', 'a² + b² = c²', '#ffffff', '#6a2bd9'],
    ['h2o', 'H₂O', '#dff6ff', '#0a7abf'],
    ['luz', 'c ≈ 300.000 km/s', '#1b1b2f', '#ffd23f'],
    ['grav', 'g = 9,8 m/s²', '#ffe8e0', '#c2401a'],
    ['dna', 'DNA', '#f0e6ff', '#7b2cbf'],
  ];
  boards.forEach(([name, text, bgc, fg], i) => {
    put(name, (i % 4) * 512, 688 + Math.floor(i / 4) * 168, 512, 160, (gg, w, h) => {
      gg.fillStyle = bgc; gg.fillRect(0, 0, w, h);
      gg.strokeStyle = fg; gg.lineWidth = 12; gg.strokeRect(14, 14, w - 28, h - 28);
      let size = h * 0.5;
      gg.font = `bold ${size}px ${FONT}`;
      while (gg.measureText(text).width > w - 70 && size > 20) { size -= 2; gg.font = `bold ${size}px ${FONT}`; }
      gg.textAlign = 'center'; gg.textBaseline = 'middle';
      gg.fillStyle = fg; gg.fillText(text, w / 2, h * 0.53);
    });
  });
  const tex = canvasTex(c, { aniso });
  const wr = regions.white;
  const white = [(wr[0] + wr[2]) / 2, (wr[1] + wr[3]) / 2];
  return { tex, regions, white };
}

// Atlas dos planetas (Júpiter, Terra, Lua, Marte, Saturno) e anel de Saturno separado
function planetTextures(hi) {
  const S = hi ? 1024 : 512;
  const c = makeCanvas(S, S / 2);
  const g = c.getContext('2d');
  g.scale(S / 1024, S / 1024);
  const r = mulberry(5);
  const cell = (ix, iy, fn) => { g.save(); g.translate(ix * 512, iy * 256); g.beginPath(); g.rect(0, 0, 512, 256); g.clip(); fn(g, 512, 256); g.restore(); };
  // Júpiter
  cell(0, 0, (gg, w, h) => {
    const bands = ['#e9d8b8', '#c98e5a', '#f1e3c8', '#b5703f', '#efe0c0', '#a8653a', '#e8d6b0', '#c4895a', '#f3e6cc'];
    const bh = h / bands.length;
    bands.forEach((b, i) => { gg.fillStyle = b; gg.fillRect(0, i * bh, w, bh + 1); });
    for (let i = 0; i < 300; i++) {
      gg.fillStyle = `rgba(${120 + r() * 100},${80 + r() * 60},${50 + r() * 40},0.18)`;
      gg.fillRect(r() * w, r() * h, 20 + r() * 60, 2 + r() * 3);
    }
    gg.fillStyle = '#b8452a';
    gg.beginPath(); gg.ellipse(w * 0.68, h * 0.64, 30, 14, 0, 0, TAU); gg.fill();
  });
  // Terra
  cell(1, 0, (gg, w, h) => {
    gg.fillStyle = '#1f6fd1'; gg.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = r() * w, y = h * (0.2 + r() * 0.6);
      gg.fillStyle = r() < 0.7 ? '#3faa4a' : '#caa25a';
      gg.beginPath();
      for (let a = 0; a < TAU; a += 0.5) {
        const rr = (18 + r() * 30);
        gg.lineTo(x + Math.cos(a) * rr * 1.4, y + Math.sin(a) * rr);
      }
      gg.fill();
    }
    gg.fillStyle = '#f4f8ff'; gg.fillRect(0, 0, w, 22); gg.fillRect(0, h - 22, w, 22);
    for (let i = 0; i < 40; i++) {
      gg.fillStyle = 'rgba(255,255,255,0.55)';
      gg.beginPath(); gg.ellipse(r() * w, r() * h, 20 + r() * 40, 4 + r() * 6, 0, 0, TAU); gg.fill();
    }
  });
  // Lua
  cell(0, 1, (gg, w, h) => {
    gg.fillStyle = '#b9b9bd'; gg.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = r() * w, y = r() * h, rr = 3 + r() * 16;
      gg.fillStyle = 'rgba(90,90,100,0.35)'; gg.beginPath(); gg.arc(x, y, rr, 0, TAU); gg.fill();
      gg.fillStyle = 'rgba(230,230,235,0.35)'; gg.beginPath(); gg.arc(x - rr * 0.25, y - rr * 0.25, rr * 0.6, 0, TAU); gg.fill();
    }
  });
  // Marte e Saturno (metades)
  cell(1, 1, (gg, w, h) => {
    gg.fillStyle = '#c1502e'; gg.fillRect(0, 0, w / 2, h);
    for (let i = 0; i < 60; i++) {
      gg.fillStyle = r() < 0.5 ? 'rgba(120,40,20,0.35)' : 'rgba(230,140,90,0.3)';
      gg.beginPath(); gg.arc(r() * w / 2, r() * h, 4 + r() * 18, 0, TAU); gg.fill();
    }
    gg.fillStyle = '#fbeee6'; gg.fillRect(0, 0, w / 2, 12);
    const bands = ['#f0dca8', '#d9b77a', '#f5e6bf', '#c9a064', '#efd9a5', '#dcc08a'];
    const bh = h / bands.length;
    bands.forEach((b, i) => { gg.fillStyle = b; gg.fillRect(w / 2, i * bh, w / 2, bh + 1); });
  });
  const tex = canvasTex(c);
  const rect = {
    jupiter: [0, 0.5, 0.5, 1], earth: [0.5, 0.5, 1, 1], moon: [0, 0, 0.5, 0.5],
    mars: [0.5, 0, 0.75, 0.5], saturn: [0.75, 0, 1, 0.5],
  };
  // anel (u = raio)
  const rc = makeCanvas(256, 8);
  const rg = rc.getContext('2d');
  for (let x = 0; x < 256; x++) {
    const t = x / 255;
    const a = t < 0.05 ? 0 : 0.35 + 0.55 * Math.abs(Math.sin(t * 23)) * (t > 0.62 && t < 0.68 ? 0.1 : 1);
    const l = 200 + Math.sin(t * 40) * 30;
    rg.fillStyle = `rgba(${l},${l * 0.9},${l * 0.72},${a})`;
    rg.fillRect(x, 0, 1, 8);
  }
  const ringTex = canvasTex(rc);
  return { tex, rect, ringTex };
}

// ---------------------------------------------------------------------------
export function buildTrack(scene, quality = {}) {
  const hi = quality.id !== 'baixa';
  const rand = mulberry(20260925);
  const group = new THREE.Group();
  group.name = 'pista';
  scene.add(group);

  // ------------------------------------------------------------ linha central
  const nC = CTRL.length;
  const curve = new THREE.CatmullRomCurve3(CTRL.map((c) => new THREE.Vector3(c[0], 0, c[1])), true, 'centripetal');
  const SUB = 200;
  const MD = nC * SUB;
  const DX = new Float64Array(MD + 1), DZ = new Float64Array(MD + 1), CUM = new Float64Array(MD + 1);
  const tmp = new THREE.Vector3();
  for (let i = 0; i <= MD; i++) {
    curve.getPoint(i / MD, tmp);
    DX[i] = tmp.x; DZ[i] = tmp.z;
    if (i) CUM[i] = CUM[i - 1] + Math.hypot(DX[i] - DX[i - 1], DZ[i] - DZ[i - 1]);
  }
  const length = CUM[MD];
  const sAtK = (k) => {
    const t = clamp(k, 0, nC) * SUB;
    const i = Math.min(Math.floor(t), MD - 1);
    return CUM[i] + (CUM[i + 1] - CUM[i]) * (t - i);
  };
  const N = Math.round(length);
  const ds = length / N;
  const X = new Float32Array(N), Y = new Float32Array(N), Z = new Float32Array(N);
  const HEAD = new Float32Array(N), PITCH = new Float32Array(N);
  const TX = new Float32Array(N), TY = new Float32Array(N), TZ = new Float32Array(N);
  const RX = new Float32Array(N), RZ = new Float32Array(N);
  const UX = new Float32Array(N), UY = new Float32Array(N), UZ = new Float32Array(N);
  const HW = new Float32Array(N), WD = new Float32Array(N);
  const KR = new Float32Array(N), K = new Float32Array(N), RL = new Float32Array(N);
  const FL = new Uint8Array(N); // 1 = ponte, 2 = túnel
  {
    let j = 0;
    for (let i = 0; i < N; i++) {
      const target = i * ds;
      while (CUM[j + 1] < target && j < MD - 1) j++;
      const f = (target - CUM[j]) / (CUM[j + 1] - CUM[j] || 1);
      X[i] = DX[j] + (DX[j + 1] - DX[j]) * f;
      Z[i] = DZ[j] + (DZ[j + 1] - DZ[j]) * f;
    }
  }
  const idx = (i) => ((i % N) + N) % N;
  const wrapS = (s) => ((s % length) + length) % length;
  const elev = pchip(ELEV.map((e) => sAtK(e[0])), ELEV.map((e) => e[1]));
  const ctrlS = CTRL.map((_, k) => sAtK(k));
  for (let i = 0; i < N; i++) Y[i] = elev(i * ds);
  for (let i = 0; i < N; i++) {
    const a = idx(i - 1), b = idx(i + 1);
    const h = Math.atan2(X[b] - X[a], Z[b] - Z[a]);
    const p = Math.atan((Y[b] - Y[a]) / (2 * ds));
    HEAD[i] = h; PITCH[i] = p;
    const sh = Math.sin(h), ch = Math.cos(h), sp = Math.sin(p), cp = Math.cos(p);
    TX[i] = sh * cp; TY[i] = sp; TZ[i] = ch * cp;
    RX[i] = -ch; RZ[i] = sh;
    UX[i] = -sh * sp; UY[i] = cp; UZ[i] = -ch * sp;
  }
  for (let i = 0; i < N; i++) {
    KR[i] = -wrapAngle(HEAD[idx(i + 1)] - HEAD[idx(i - 1)]) / (2 * ds);
    K[i] = -wrapAngle(HEAD[idx(i + 5)] - HEAD[idx(i - 5)]) / (10 * ds);
  }
  // larguras interpoladas entre pontos de controle
  for (let k = 0; k < nC; k++) {
    const s0 = ctrlS[k], s1 = k + 1 < nC ? ctrlS[k + 1] : length;
    const c0 = CTRL[k], c1 = CTRL[(k + 1) % nC];
    for (let i = Math.ceil(s0 / ds); i < Math.min(N, Math.ceil(s1 / ds)); i++) {
      const t = smooth01((i * ds - s0) / (s1 - s0));
      HW[i] = lerp(c0[2], c1[2], t);
      WD[i] = HW[i] + lerp(c0[3], c1[3], t);
    }
  }
  const bridgeS = [sAtK(BRIDGE_K[0]), sAtK(BRIDGE_K[1])];
  const tunnelS = [sAtK(TUNNEL_K[0]), sAtK(TUNNEL_K[1])];
  for (let i = 0; i < N; i++) {
    const s = i * ds;
    if (s >= bridgeS[0] && s <= bridgeS[1]) FL[i] = 1;
    if (s >= tunnelS[0] && s <= tunnelS[1]) FL[i] = 2;
  }
  // cruzamento (viaduto sobre o túnel)
  const crossing = (() => {
    let best = Infinity, bu = 0, bl = 0;
    for (let i = Math.floor(ctrlS[9] / ds); i < Math.floor(ctrlS[13] / ds); i++) {
      for (let j = Math.floor(tunnelS[0] / ds); j < Math.floor(tunnelS[1] / ds); j++) {
        const d = (X[i] - X[j]) ** 2 + (Z[i] - Z[j]) ** 2;
        if (d < best) { best = d; bu = i; bl = j; }
      }
    }
    return { upperS: bu * ds, lowerS: bl * ds, x: X[bu], z: Z[bu], sep: Y[bu] - Y[bl] };
  })();

  // ------------------------------------------------------------ interpolação
  const UP = new THREE.Vector3(0, 1, 0);
  const _S = {
    pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0),
    halfWidth: 9, wallDist: 14,
  };
  function sample(s) {
    s = wrapS(s);
    const fi = s / ds;
    const i = Math.floor(fi) % N;
    const n = (i + 1) % N;
    const f = fi - Math.floor(fi);
    _S.pos.set(lerp(X[i], X[n], f), lerp(Y[i], Y[n], f), lerp(Z[i], Z[n], f));
    _S.tangent.set(lerp(TX[i], TX[n], f), lerp(TY[i], TY[n], f), lerp(TZ[i], TZ[n], f)).normalize();
    _S.right.set(lerp(RX[i], RX[n], f), 0, lerp(RZ[i], RZ[n], f)).normalize();
    _S.up.set(lerp(UX[i], UX[n], f), lerp(UY[i], UY[n], f), lerp(UZ[i], UZ[n], f)).normalize();
    _S.halfWidth = lerp(HW[i], HW[n], f);
    _S.wallDist = lerp(WD[i], WD[n], f);
    return _S;
  }

  // Rampas: altura extra do chão sobre a cunha (o kart sobe a cunha antes do impulso)
  const ramps = [];
  const RAMP_H = 0.55;
  function rampLift(s, lat) {
    for (let r = 0; r < ramps.length; r++) {
      const rp = ramps[r];
      let d = s - (rp.s - rp.length / 2);
      if (d > length / 2) d -= length; else if (d < -length / 2) d += length;
      if (d < 0 || d > rp.length) continue;
      if (Math.abs(lat - rp.lateral) > rp.width / 2) continue;
      return { h: (d / rp.length) * RAMP_H, slope: RAMP_H / rp.length };
    }
    return null;
  }

  const _P = {
    s: 0, lateral: 0, groundY: 0, normal: new THREE.Vector3(0, 1, 0), halfWidth: 9, wallDist: 14, offroad: false,
  };
  function nearestIndex(pos, hintS) {
    let best = -1, bestD = Infinity;
    if (hintS === undefined || hintS === null || !Number.isFinite(hintS)) {
      for (let i = 0; i < N; i++) {
        const dx = pos.x - X[i], dz = pos.z - Z[i];
        const dy = (pos.y - Y[i]) * 2.5;
        const d = dx * dx + dz * dz + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }
    const c = Math.round(wrapS(hintS) / ds);
    const W = Math.ceil(40 / ds);
    let bk = 0;
    for (let k = -W; k <= W; k++) {
      const i = idx(c + k);
      const dx = pos.x - X[i], dz = pos.z - Z[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; bk = k; }
    }
    // longe demais da dica (teleporte/reposição): busca global
    if (Math.abs(bk) >= W || bestD > (WD[best] + 12) ** 2) return nearestIndex(pos, undefined);
    return best;
  }
  function project(pos, hintS) {
    const i0 = nearestIndex(pos, hintS);
    let s = i0 * ds;
    let lat = 0;
    for (let it = 0; it < 6; it++) {
      const w = wrapS(s);
      const fi = w / ds;
      const i = Math.floor(fi) % N, n = (i + 1) % N, f = fi - Math.floor(fi);
      const px = lerp(X[i], X[n], f), pz = lerp(Z[i], Z[n], f);
      let rx = lerp(RX[i], RX[n], f), rz = lerp(RZ[i], RZ[n], f);
      const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
      const dx = pos.x - px, dz = pos.z - pz;
      const along = dx * rz - dz * rx; // tangente horizontal = (rz, -rx)
      lat = dx * rx + dz * rz;
      const k = lerp(KR[i], KR[n], f);
      const den = Math.max(0.25, 1 - k * lat);
      s = w + along / den;
      if (Math.abs(along) < 1e-4) break;
    }
    s = wrapS(s);
    const smp = sample(s);
    const dx = pos.x - smp.pos.x, dz = pos.z - smp.pos.z;
    lat = dx * smp.right.x + dz * smp.right.z;
    _P.s = s;
    _P.lateral = lat;
    _P.groundY = smp.pos.y;
    _P.normal.copy(smp.up);
    const rl = ramps.length ? rampLift(s, lat) : null;
    if (rl) {
      _P.groundY += rl.h;
      _P.normal.addScaledVector(smp.tangent, -rl.slope).normalize();
    }
    _P.halfWidth = smp.halfWidth;
    _P.wallDist = smp.wallDist;
    _P.offroad = Math.abs(lat) > smp.halfWidth;
    return _P;
  }
  function curvature(s) {
    const fi = wrapS(s) / ds;
    const i = Math.floor(fi) % N;
    return lerp(K[i], K[(i + 1) % N], fi - Math.floor(fi));
  }

  // ------------------------------------------------------------ trajetória ideal
  // Por curva: fora na entrada, ápice por dentro, fora na saída; retas ligam as curvas.
  {
    const KC = new Float32Array(N);
    for (let i = 0; i < N; i++) KC[i] = -wrapAngle(HEAD[idx(i + 10)] - HEAD[idx(i - 10)]) / (20 * ds);
    const TH = 1 / 160;
    const corners = [];
    // começa num ponto de reta para não cortar uma curva ao meio
    let startI = 0;
    for (let i = 0; i < N; i++) if (Math.abs(KC[i]) < TH * 0.5) { startI = i; break; }
    let cur = null;
    for (let k = 0; k <= N; k++) {
      const i = idx(startI + k);
      const kk = KC[i];
      const on = Math.abs(kk) > TH;
      const sg = Math.sign(kk);
      if (on && cur && sg === cur.sign) {
        cur.end = startI + k; cur.turn += kk * ds;
        if (Math.abs(kk) > cur.peak) { cur.peak = Math.abs(kk); cur.apex = startI + k; }
      } else {
        if (cur) { corners.push(cur); cur = null; }
        if (on) cur = { sign: sg, start: startI + k, end: startI + k, apex: startI + k, peak: Math.abs(kk), turn: kk * ds };
      }
    }
    if (cur) corners.push(cur);
    // pontos-chave (índice contínuo, lateral)
    const keys = [];
    corners.forEach((c) => {
      const ang = Math.abs(c.turn);
      if (ang < 0.25) return; // curvas suaves não mudam a trajetória
      const apexI = Math.round((c.apex + (c.start + c.end) / 2) / 2);
      const L = clamp(22 + 38 * ang, 26, 90) / ds;
      const hw = (i) => HW[idx(Math.round(i))] - 2.4;
      keys.push({ i: apexI - L, lat: -c.sign * hw(apexI - L), kind: 'in' });
      keys.push({ i: apexI, lat: c.sign * hw(apexI), kind: 'apex' });
      keys.push({ i: apexI + L * 1.15, lat: -c.sign * hw(apexI + L * 1.15), kind: 'out' });
    });
    keys.sort((a, b) => a.i - b.i);
    // saída de uma curva depois da entrada da próxima: liga ápice a ápice
    for (let changed = true; changed;) {
      changed = false;
      for (let k = 0; k < keys.length - 1; k++) {
        if (keys[k + 1].i - keys[k].i < 12 / ds && keys[k].kind !== 'apex' && keys[k + 1].kind !== 'apex') {
          const m = { i: (keys[k].i + keys[k + 1].i) / 2, lat: (keys[k].lat + keys[k + 1].lat) / 2, kind: 'mid' };
          keys.splice(k, 2, m); changed = true; break;
        }
        if (keys[k].kind === 'out' && keys[k + 1].kind === 'in' && keys[k + 1].i < keys[k].i) { keys.splice(k, 2); changed = true; break; }
      }
      for (let k = 0; k < keys.length - 1; k++) {
        if (keys[k + 1].i < keys[k].i + 4) {
          if (keys[k].kind === 'apex') keys.splice(k + 1, 1); else keys.splice(k, 1);
          changed = true; break;
        }
      }
    }
    const raw = new Float32Array(N);
    if (keys.length < 2) raw.fill(0);
    else {
      const K2 = keys.length;
      for (let k = 0; k < K2; k++) {
        const a = keys[k], b = keys[(k + 1) % K2];
        let bi = b.i;
        if (bi <= a.i) bi += N;
        for (let i = Math.ceil(a.i); i < bi; i++) {
          const t = (i - a.i) / (bi - a.i);
          raw[idx(i)] = lerp(a.lat, b.lat, t * t * (3 - 2 * t));
        }
      }
    }
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let k = -6; k <= 6; k++) acc += raw[idx(i + k)];
      RL[i] = clamp(acc / 13, -(HW[i] - 2), HW[i] - 2);
    }
  }
  function racingLine(s) {
    const fi = wrapS(s) / ds;
    const i = Math.floor(fi) % N;
    return lerp(RL[i], RL[(i + 1) % N], fi - Math.floor(fi));
  }
  const headingAt = (s) => { const t = sample(s).tangent; return Math.atan2(t.x, t.z); };

  // ------------------------------------------------------------ elementos de jogo
  const gridSlots = [];
  for (let i = 0; i < 8; i++) {
    const s = wrapS(-7 - i * 3.6);
    const smp = sample(s);
    const lat = i % 2 === 0 ? 3.4 : -3.4;
    const pos = smp.pos.clone().addScaledVector(smp.right, lat);
    gridSlots.push({ pos, heading: Math.atan2(smp.tangent.x, smp.tangent.z), s, lateral: lat });
  }
  const itemBoxSlots = [];
  const boxRows = [
    [105, 5], [ctrlS[5] + 22, 5], [ctrlS[10] - 30, 4], [ctrlS[15] - 6, 5],
    [ctrlS[22] + 22, 4], [tunnelS[1] + 22, 5], [ctrlS[28] + 22, 4],
  ];
  for (const [s, n] of boxRows) {
    const smp = sample(s);
    const spread = Math.min(3.6, (smp.halfWidth * 2 - 4) / (n - 1));
    for (let k = 0; k < n; k++) {
      const lat = (k - (n - 1) / 2) * spread;
      const p = sample(s);
      itemBoxSlots.push({ pos: p.pos.clone().addScaledVector(p.right, lat).addScaledVector(UP, 1.2), s: wrapS(s), lateral: lat });
    }
  }
  const padDefs = [
    [ctrlS[4] + 4, 'line'], [ctrlS[6] + 26, 'line'], [ctrlS[10] + 10, 'line'], [ctrlS[14] + 8, 'inside'],
    [(bridgeS[0] + bridgeS[1]) / 2 + 12, 'center'], [ctrlS[21] + 4, 'inside'], [tunnelS[0] + 36, 'center'], [ctrlS[30] + 6, 'inside'],
  ];
  const boostPads = padDefs.map(([s, mode]) => {
    s = wrapS(s);
    const smp = sample(s);
    let lat = 0;
    if (mode === 'line') lat = racingLine(s);
    else if (mode === 'inside') lat = Math.sign(curvature(s) || 1) * (smp.halfWidth - 3.2);
    lat = clamp(lat, -(smp.halfWidth - 2.4), smp.halfWidth - 2.4);
    return { s, lateral: lat, length: 7, width: 4 };
  });
  ramps.push({ s: wrapS(ctrlS[13] + 12), lateral: 0, length: 6, width: 12, launch: 8.5 });
  ramps.push({ s: wrapS(ctrlS[27] + 18), lateral: -3.5, length: 6, width: 8, launch: 7.5 });

  const minimapPoints = [];
  for (let i = 0; i < 256; i++) {
    const p = sample((i / 256) * length).pos;
    minimapPoints.push({ x: p.x, z: p.z });
  }

  // ------------------------------------------------------------ zonas temáticas
  const zones = {
    largada: [wrapS(ctrlS[31] - 10), ctrlS[2] + 10],
    lab: [ctrlS[2] + 10, ctrlS[8] + 30],
    observatorio: [ctrlS[8] + 30, ctrlS[15] + 20],
    lagoa: [ctrlS[15] + 20, tunnelS[0]],
    tunel: [tunnelS[0], tunnelS[1]],
    tesla: [tunnelS[1], ctrlS[29]],
    final: [ctrlS[29], wrapS(ctrlS[31] - 10)],
  };
  const zoneOf = (s) => {
    s = wrapS(s);
    for (const [name, [a, b]] of Object.entries(zones)) {
      if (a <= b ? s >= a && s < b : s >= a || s < b) return name;
    }
    return 'largada';
  };

  // Perfil do túnel: vãos laterais ("baías") com planetas fora do corredor
  const bayA = [tunnelS[0] + 12, crossing.lowerS - 24];
  const bayB = [crossing.lowerS + 22, tunnelS[1] - 12];
  const bayAt = (s) => {
    const f = (a, b) => smooth01((s - a) / 8) * smooth01((b - s) / 8);
    return Math.max(f(bayA[0], bayA[1]), f(bayB[0], bayB[1]));
  };
  const tunnelProfile = (s, wd) => {
    const bay = bayAt(s);
    const span = wd + 0.7 + 7.5 * bay;
    const wallH = 4.6;
    const rise = 4.4 + 2.6 * bay;
    return { bay, span, wallH, rise, top: wallH + rise + 0.6 };
  };
  const ROOF = new Float32Array(N);
  const SPAN = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (FL[i] !== 2) continue;
    const tp = tunnelProfile(i * ds, WD[i]);
    ROOF[i] = tp.top;
    SPAN[i] = tp.span;
  }

  // ------------------------------------------------------------ materiais e texturas
  const maxAniso = 8;
  const aniso = hi ? maxAniso : 2;
  const asphalt = asphaltTexture(hi, aniso);
  const grass = grassTexture(hi, aniso);
  const atlas = buildAtlas(hi, aniso);
  const WHITE = atlas.white;
  const REG = atlas.regions;
  const matRoad = new THREE.MeshLambertMaterial({ map: asphalt, vertexColors: true });
  const matGround = new THREE.MeshLambertMaterial({ map: grass, vertexColors: true });
  const matAtlas = new THREE.MeshLambertMaterial({ map: atlas.tex, vertexColors: true });
  const matDecal = new THREE.MeshLambertMaterial({
    map: atlas.tex, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const matGlow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const disposables = [asphalt, grass, atlas.tex, matRoad, matGround, matAtlas, matDecal, matGlow];

  const mkMesh = (geo, mat, { cast = false, receive = true, name = '' } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.name = name;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    group.add(m);
    disposables.push(geo);
    return m;
  };

  // Paletas por setor
  const C = {
    grass: col(0x7cc943), grassDark: col(0x5da83a), sand: col(0xf0d9a0), sandWet: col(0xd9bd82),
    tunnelFloor: col(0x2a2644), concrete: col(0xd9d7d0), bridgeShoulder: col(0xbfc6cc), white: col(0xffffff),
    red: col(0xe3262f), dark: col(0x2b2b30),
  };
  const wallColors = {
    largada: [col(0x1d7bd8), col(0xffffff)], lab: [col(0x8a3cff), col(0xffffff)],
    observatorio: [col(0x243b8a), col(0xffd23f)], lagoa: [col(0x17a2b8), col(0xffffff)],
    tunel: [col(0x3b2a7a), col(0x6b4fd8)], tesla: [col(0xffc400), col(0x222222)], final: [col(0xe3262f), col(0xffffff)],
  };

  const P = (i, lat, dy, out) => out.set(X[i] + RX[i] * lat, Y[i] + dy, Z[i] + RZ[i] * lat);
  const va = new THREE.Vector3(), vb = new THREE.Vector3();
  const shade = new THREE.Color();

  // Fator de escurecimento dentro do túnel (suave nas bocas)
  const tunnelDark = (s) => {
    const a = smooth01((s - tunnelS[0] + 2) / 10) * smooth01((tunnelS[1] + 2 - s) / 10);
    return 1 - 0.5 * a;
  };

  // ------------------------------------------------------------ asfalto
  {
    const b = new Builder();
    for (let r = 0; r <= N; r++) {
      const i = r % N;
      const s = r * ds;
      const dk = tunnelDark(i * ds);
      shade.setRGB(dk, dk, dk * 1.02);
      P(i, -HW[i], 0, va); P(i, HW[i], 0, vb);
      b.vert(va.x, va.y, va.z, UX[i], UY[i], UZ[i], shade, 0, s / 12);
      b.vert(vb.x, vb.y, vb.z, UX[i], UY[i], UZ[i], shade, 1, s / 12);
    }
    for (let r = 0; r < N; r++) {
      const a = r * 2;
      // esquerda(i), direita(i), direita(i+1), esquerda(i+1) visto de cima
      b.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    mkMesh(b.build(), matRoad, { name: 'asfalto' });
  }

  // ------------------------------------------------------------ zebras (curvas)
  const curbL = new Uint8Array(N), curbR = new Uint8Array(N);
  {
    const raw = [new Uint8Array(N), new Uint8Array(N)];
    for (let i = 0; i < N; i++) {
      if (FL[i]) continue;
      const k = K[i];
      const a = Math.abs(k);
      if (a > 1 / 150) raw[k > 0 ? 1 : 0][i] = 1; // lado de dentro
      if (a > 1 / 70) raw[k > 0 ? 0 : 1][i] = 1; // lado de fora nas curvas fechadas
    }
    for (let side = 0; side < 2; side++) {
      const out = side ? curbR : curbL;
      for (let i = 0; i < N; i++) {
        if (!raw[side][i]) continue;
        for (let k = -7; k <= 7; k++) { const j = idx(i + k); if (!FL[j]) out[j] = 1; }
      }
    }
  }

  // ------------------------------------------------------------ acostamento, bordas externas e morro do túnel
  const shoulderColor = (i, out) => {
    const s = i * ds;
    if (FL[i] === 2) return out.copy(C.tunnelFloor);
    if (FL[i] === 1) return out.copy(C.bridgeShoulder);
    const z = zoneOf(s);
    if (z === 'lagoa' || (z === 'observatorio' && s > ctrlS[14] + 20)) return out.copy(C.sand);
    return out.copy(C.grass);
  };
  const gb = new Builder(); // material de grama (uv no mundo)
  const GUV = 1 / 7;
  {
    const cA = new THREE.Color(), cB = new THREE.Color();
    for (const side of [-1, 1]) {
      // faixa do acostamento: de HW até WD (ou até o vão, no túnel)
      const base = gb.count;
      for (let r = 0; r <= N; r++) {
        const i = r % N;
        shoulderColor(i, cA);
        const dk = tunnelDark(i * ds);
        cA.multiplyScalar(dk);
        const inner = HW[i], outer = FL[i] === 2 ? SPAN[i] : WD[i] + 0.3;
        P(i, side * inner, -0.005, va); P(i, side * outer, -0.005, vb);
        gb.vert(va.x, va.y, va.z, UX[i], UY[i], UZ[i], cA, va.x * GUV, va.z * GUV);
        gb.vert(vb.x, vb.y, vb.z, UX[i], UY[i], UZ[i], cA, vb.x * GUV, vb.z * GUV);
      }
      for (let r = 0; r < N; r++) {
        const a = base + r * 2;
        if (side < 0) gb.idx.push(a + 1, a, a + 2, a + 1, a + 2, a + 3);
        else gb.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
      // borda externa inclinada (fora da mureta), exceto ponte e túnel
      const VSTEP = hi ? 1 : 3;
      for (let r = 0; r < N; r += VSTEP) {
        const i = r, n = (r + VSTEP) % N;
        if (FL[i] || FL[n]) continue;
        const c0 = shoulderColor(i, cA).clone().lerp(C.grassDark, 0.3);
        const v0 = gb.count;
        for (const j of [i, n]) {
          P(j, side * (WD[j] + 0.55), -0.02, va);
          P(j, side * (WD[j] + 7), -0.9, vb);
          gb.vert(va.x, va.y, va.z, 0, 1, 0, c0, va.x * GUV, va.z * GUV);
          gb.vert(vb.x, vb.y, vb.z, 0, 1, 0, cB.copy(C.grassDark), vb.x * GUV, vb.z * GUV);
        }
        if (side < 0) gb.idx.push(v0 + 1, v0, v0 + 2, v0 + 1, v0 + 2, v0 + 3);
        else gb.idx.push(v0, v0 + 1, v0 + 3, v0, v0 + 3, v0 + 2);
      }
    }
    // morro sobre o túnel (perfil trapezoidal com topo plano), coberto de grama
    const i0 = Math.floor(tunnelS[0] / ds) + 1, i1 = Math.floor(tunnelS[1] / ds);
    const moundTop = new Float32Array(N);
    for (let i = i0; i <= i1; i++) {
      let top = ROOF[i] + 1.0;
      // sob o viaduto: sobe até encostar no aterro da pista de cima
      const d = Math.abs(i * ds - crossing.lowerS);
      if (d < 30) top = Math.max(top, lerp(crossing.sep - 0.45, top, smooth01((d - 14) / 16)));
      moundTop[i] = top;
    }
    // perfil arredondado: topo cobre a faixa onde o terreno afunda até o chão do túnel
    const MOUND_K = [-1, -0.7, -0.4, 0, 0.4, 0.7, 1];
    const moundPad = hi ? 7.5 : 11.5;
    const prof = (i, out) => {
      const top = moundTop[i];
      const sp = SPAN[i] + moundPad;
      const w = sp + (top + 3) / 2.4;
      out.length = 0;
      out.push([-w, -3]);
      for (const k of MOUND_K) out.push([k * sp, top - 1.1 * k * k]);
      out.push([w, -3]);
      return out;
    };
    const pr0 = [], pr1 = [];
    const cM = new THREE.Color();
    for (let i = i0; i < i1; i++) {
      prof(i, pr0); prof(i + 1, pr1);
      const nf = pr0.length - 1;
      for (let f = 0; f < nf; f++) {
        const v0 = gb.count;
        const pairs = [[i, pr0[f]], [i, pr0[f + 1]], [i + 1, pr1[f + 1]], [i + 1, pr1[f]]];
        const skirt = f === 0 || f === nf - 1;
        cM.copy(skirt ? C.grassDark : C.grass);
        for (const [j, [l, h]] of pairs) {
          va.set(X[j] + RX[j] * l, Y[j] + h, Z[j] + RZ[j] * l);
          const ny = skirt ? 0.4 : 1;
          const nl = f === 0 ? -0.9 : f === nf - 1 ? 0.9 : (l / (SPAN[j] + moundPad)) * 0.25;
          gb.vert(va.x, va.y, va.z, RX[j] * nl, ny, RZ[j] * nl, cM, va.x * GUV, va.z * GUV);
        }
        gb.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
      }
    }
    group.userData.moundTop = moundTop;
    group.userData.moundPad = moundPad;
    const cAp = C.grass.clone().lerp(C.grassDark, 0.4);
    for (const [sa, sb2] of [[tunnelS[0] - 16, tunnelS[0] + 1.5], [tunnelS[1] - 1.5, tunnelS[1] + 16]]) {
      const v0 = gb.count;
      let rows = 0;
      for (let ss = sa; ss <= sb2 + 1e-6; ss += 1.5) {
        const smp = sample(ss);
        const L = SPAN[Math.round(clamp(ss, tunnelS[0], tunnelS[1]) / ds) % N] + moundPad + 14;
        for (const e of [-1, 1]) {
          va.copy(smp.pos).addScaledVector(smp.right, e * L);
          va.y -= 0.3;
          gb.vert(va.x, va.y, va.z, 0, 1, 0, cAp, va.x * GUV, va.z * GUV);
        }
        rows++;
      }
      for (let r = 0; r < rows - 1; r++) {
        const a = v0 + r * 2;
        gb.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
  }
  mkMesh(gb.build(), matGround, { name: 'acostamento' });

  // ------------------------------------------------------------ decalques: zebras, chegada, grid
  {
    const b = new Builder();
    const cc = new THREE.Color();
    for (const side of [-1, 1]) {
      const flags = side < 0 ? curbL : curbR;
      for (let i = 0; i < N; i++) {
        const n = (i + 1) % N;
        if (!flags[i] || !flags[n]) continue;
        const block = Math.floor((i * ds) / 2) % 2;
        cc.copy(block ? C.white : C.red);
        const v0 = b.count;
        const lats = [HW[i], HW[i] + 0.7, HW[i] + 1.4];
        const lats2 = [HW[n], HW[n] + 0.7, HW[n] + 1.4];
        const hs = [0.02, 0.07, 0.02];
        for (let k = 0; k < 3; k++) {
          P(i, side * lats[k], hs[k], va);
          P(n, side * lats2[k], hs[k], vb);
          b.vert(va.x, va.y, va.z, UX[i], UY[i], UZ[i], cc, WHITE[0], WHITE[1]);
          b.vert(vb.x, vb.y, vb.z, UX[n], UY[n], UZ[n], cc, WHITE[0], WHITE[1]);
        }
        // v0: (i,k0) v0+1: (n,k0) v0+2: (i,k1) v0+3: (n,k1) v0+4: (i,k2) v0+5: (n,k2)
        for (let k = 0; k < 2; k++) {
          const a = v0 + k * 2;
          if (side > 0) b.idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
          else b.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
        }
      }
    }
    // linha de chegada (tabuleiro)
    {
      const rg = REG.checker;
      const v0 = b.count;
      for (const ss of [-1.3, 1.3]) {
        const smp = sample(ss);
        const hw = smp.halfWidth;
        va.copy(smp.pos).addScaledVector(smp.right, -hw); va.y += 0.02;
        vb.copy(smp.pos).addScaledVector(smp.right, hw); vb.y += 0.02;
        const v = ss < 0 ? rg[1] : rg[3];
        b.vert(va.x, va.y, va.z, 0, 1, 0, C.white, rg[0], v);
        b.vert(vb.x, vb.y, vb.z, 0, 1, 0, C.white, rg[2], v);
      }
      b.idx.push(v0, v0 + 1, v0 + 3, v0, v0 + 3, v0 + 2);
    }
    // marcas do grid
    const markQuad = (s0, s1, l0, l1) => {
      const v0 = b.count;
      for (const ss of [s0, s1]) {
        const smp = sample(ss);
        va.copy(smp.pos).addScaledVector(smp.right, l0); va.y += 0.02;
        vb.copy(smp.pos).addScaledVector(smp.right, l1); vb.y += 0.02;
        b.vert(va.x, va.y, va.z, 0, 1, 0, C.white, WHITE[0], WHITE[1]);
        b.vert(vb.x, vb.y, vb.z, 0, 1, 0, C.white, WHITE[0], WHITE[1]);
      }
      b.idx.push(v0, v0 + 1, v0 + 3, v0, v0 + 3, v0 + 2);
    };
    for (const g of gridSlots) {
      const sf = g.s + 1.4;
      markQuad(sf - 0.15, sf + 0.15, g.lateral - 1.1, g.lateral + 1.1);
      markQuad(sf - 1.6, sf, g.lateral - 1.1, g.lateral - 0.95);
      markQuad(sf - 1.6, sf, g.lateral + 0.95, g.lateral + 1.1);
    }
    mkMesh(b.build(), matDecal, { name: 'decalques' });
  }

  // ------------------------------------------------------------ estruturas (atlas): muretas, ponte, pórticos, placas
  const sb = new Builder();
  const tireSpots = [];
  const tireSide = [new Uint8Array(N), new Uint8Array(N)];
  {
    // pneus no lado de fora das curvas fechadas
    for (let i = 0; i < N; i++) {
      if (FL[i]) continue;
      const k = K[i];
      if (Math.abs(k) < 1 / 62) continue;
      const side = k > 0 ? 0 : 1; // fora da curva à direita = esquerda (0)
      for (let d = -8; d <= 8; d++) { const j = idx(i + d); if (!FL[j]) tireSide[side][j] = 1; }
    }
    const top = new THREE.Color(), cMain = new THREE.Color();
    for (const side of [-1, 1]) {
      const tflag = tireSide[side < 0 ? 0 : 1];
      const WSTEP = hi ? 2 : 4;
      for (let i = 0; i < N; i += WSTEP) {
        const n = idx(i + WSTEP);
        const s = i * ds;
        if (FL[i] === 1 || FL[n] === 1) continue; // ponte tem guarda-corpo
        if (tflag[i] && tflag[n]) {
          for (let t = 0; t < WSTEP * ds - 0.1; t += 0.86) tireSpots.push([i * ds + t, side]);
          continue;
        }
        const tun = FL[i] === 2 || FL[n] === 2;
        const z = zoneOf(s);
        const pal = wallColors[z];
        const block = Math.floor(s / 4) % 2;
        cMain.copy(pal[block]);
        top.copy(tun ? col(0x151028) : C.white);
        const H = tun ? 0.9 : 1.05, T = 0.5, B = tun ? -0.1 : -1.4;
        const band = tun ? H : H - 0.22;
        // faces: interna (baixo), interna (faixa), topo, externa
        const faces = hi ? [
          [[WD[i], -0.05], [WD[i], band], [WD[n], band], [WD[n], -0.05], -1, cMain],
          [[WD[i], band], [WD[i], H], [WD[n], H], [WD[n], band], -1, tun ? cMain : top],
          [[WD[i], H], [WD[i] + T, H], [WD[n] + T, H], [WD[n], H], 0, top],
          [[WD[i] + T, H], [WD[i] + T, B], [WD[n] + T, B], [WD[n] + T, H], 1, cMain],
        ] : [
          [[WD[i], -0.05], [WD[i], H], [WD[n], H], [WD[n], -0.05], -1, cMain],
          [[WD[i], H], [WD[i] + T, H], [WD[n] + T, H], [WD[n], H], 0, top],
          [[WD[i] + T, H], [WD[i] + T, B], [WD[n] + T, B], [WD[n] + T, H], 1, cMain],
        ];
        for (const [p0, p1, p2, p3, nd, cf] of faces) {
          const v0 = sb.count;
          const pts = [[i, p0], [i, p1], [n, p2], [n, p3]];
          for (const [j, [l, h]] of pts) {
            const L = side * l;
            va.set(X[j] + RX[j] * L, Y[j] + h, Z[j] + RZ[j] * L);
            let nx = 0, ny = 1, nz = 0;
            if (nd !== 0) { nx = RX[j] * side * nd; nz = RZ[j] * side * nd; ny = 0; }
            sb.vert(va.x, va.y, va.z, nx, ny, nz, cf, WHITE[0], WHITE[1]);
          }
          // orientação: depende do lado
          if (side > 0) sb.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
          else sb.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
        }
      }
    }
  }

  // Ajudantes de colocação
  const frame = (s) => {
    const smp = sample(s);
    return {
      pos: smp.pos.clone(), right: smp.right.clone(), up: UP.clone(),
      fwd: new THREE.Vector3(smp.tangent.x, 0, smp.tangent.z).normalize(), hw: smp.halfWidth, wd: smp.wallDist,
    };
  };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const place = (geo, pos, rotY, scl, color, extraRot) => {
    q.setFromAxisAngle(UP, rotY);
    if (extraRot) q.multiply(extraRot);
    sc.set(scl?.x ?? scl ?? 1, scl?.y ?? scl ?? 1, scl?.z ?? scl ?? 1);
    m4.compose(pos, q, sc);
    sb.geo(geo, m4, color, null, WHITE);
  };
  const GEO = {
    cyl: new THREE.CylinderGeometry(1, 1, 1, hi ? 14 : 8, 1),
    cylLow: new THREE.CylinderGeometry(1, 1, 1, 6, 1),
    sphere: new THREE.SphereGeometry(1, hi ? 16 : 10, hi ? 10 : 6),
    torus: new THREE.TorusGeometry(1, 0.28, hi ? 10 : 6, hi ? 24 : 14),
    cone: new THREE.ConeGeometry(1, 1, hi ? 12 : 8),
    box: new THREE.BoxGeometry(1, 1, 1),
  };
  Object.values(GEO).forEach((g) => disposables.push(g));

  // Guarda-corpo e estrutura da ponte (arco atirantado branco)
  {
    const i0 = Math.ceil(bridgeS[0] / ds), i1 = Math.floor(bridgeS[1] / ds);
    const cRail = col(0xf4f6f8), cTeal = col(0x0fa3b1), cUnder = col(0x8f9aa3), cKerb = col(0xdfe3e6);
    for (const side of [-1, 1]) {
      for (let i = i0 - 1; i < i1 + 1; i++) {
        const n = i + 1;
        // mureta baixa + faixa lateral (viga) + fundo
        const segs = [
          [[WD[i], -0.05], [WD[i], 0.35], [WD[n], 0.35], [WD[n], -0.05], -1, cKerb],
          [[WD[i], 0.35], [WD[i] + 0.5, 0.35], [WD[n] + 0.5, 0.35], [WD[n], 0.35], 0, cKerb],
          [[WD[i] + 0.5, 0.35], [WD[i] + 1.3, -0.2], [WD[n] + 1.3, -0.2], [WD[n] + 0.5, 0.35], 0, cRail],
          [[WD[i] + 1.3, -0.2], [WD[i] + 1.3, -1.9], [WD[n] + 1.3, -1.9], [WD[n] + 1.3, -0.2], 1, cTeal],
        ];
        for (const [p0, p1, p2, p3, nd, cf] of segs) {
          const v0 = sb.count;
          for (const [j, [l, h]] of [[i, p0], [i, p1], [n, p2], [n, p3]]) {
            const L = side * l;
            va.set(X[j] + RX[j] * L, Y[j] + h, Z[j] + RZ[j] * L);
            const nx = nd ? RX[j] * side * nd : 0, nz = nd ? RZ[j] * side * nd : 0;
            sb.vert(va.x, va.y, va.z, nx, nd ? 0 : 1, nz, cf, WHITE[0], WHITE[1]);
          }
          if (side > 0) sb.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
          else sb.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
        }
        // corrimão superior e intermediário
        for (const hgt of [1.15, 0.7]) {
          const v0 = sb.count;
          for (const [j, dl, dh] of [[i, 0.1, hgt - 0.07], [i, 0.1, hgt + 0.07], [n, 0.1, hgt + 0.07], [n, 0.1, hgt - 0.07]]) {
            const L = side * (WD[j] + dl);
            va.set(X[j] + RX[j] * L, Y[j] + dh, Z[j] + RZ[j] * L);
            sb.vert(va.x, va.y, va.z, -RX[j] * side, 0, -RZ[j] * side, hgt > 1 ? cTeal : cRail, WHITE[0], WHITE[1]);
          }
          if (side > 0) sb.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
          else sb.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
        }
      }
      // pilaretes do guarda-corpo
      for (let s = bridgeS[0] - 1; s < bridgeS[1] + 1; s += 2.5) {
        const f = frame(s);
        const p = f.pos.clone().addScaledVector(f.right, side * (f.wd + 0.25));
        p.y += 0.75;
        place(GEO.box, p, Math.atan2(f.fwd.x, f.fwd.z), { x: 0.14, y: 0.8, z: 0.14 }, cRail);
      }
      // arco e tirantes
      const L = bridgeS[1] - bridgeS[0];
      const rise = 17;
      const archLat = (j) => side * (WD[j] + 1.9);
      const archY = (s) => rise * Math.sin(Math.PI * clamp((s - bridgeS[0]) / L, 0, 1));
      for (let i = i0; i < i1; i += 2) {
        const n = Math.min(i + 2, i1);
        const hs = 0.45;
        const ring = (j) => {
          const y = Y[j] + 0.6 + archY(j * ds);
          const l = archLat(j);
          return [X[j] + RX[j] * l, y, Z[j] + RZ[j] * l];
        };
        const [ax, ay, az] = ring(i), [bx, by, bz] = ring(n);
        // seção quadrada ao longo do arco
        const corners = [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]];
        for (let f = 0; f < 4; f++) {
          const c0 = corners[f], c1 = corners[(f + 1) % 4];
          const v0 = sb.count;
          const nx = (c0[0] + c1[0]) / 2, ny = (c0[1] + c1[1]) / 2;
          for (const [px, py, pz, j, cc] of [[ax, ay, az, i, c0], [ax, ay, az, i, c1], [bx, by, bz, n, c1], [bx, by, bz, n, c0]]) {
            sb.vert(px + RX[j] * cc[0], py + cc[1], pz + RZ[j] * cc[0], RX[j] * nx, ny, RZ[j] * nx, cRail, WHITE[0], WHITE[1]);
          }
          sb.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
          sb.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
        }
      }
      for (let s = bridgeS[0] + 6; s < bridgeS[1] - 4; s += 6) {
        const f = frame(s);
        const j = Math.round(s / ds);
        const h = archY(s);
        if (h < 1.5) continue;
        const p = f.pos.clone().addScaledVector(f.right, archLat(j));
        p.y += 0.3 + h / 2;
        place(GEO.cylLow, p, 0, { x: 0.07, y: h, z: 0.07 }, cRail);
      }
      // pilares na água
      for (let s = bridgeS[0] + 14; s < bridgeS[1] - 8; s += 26) {
        const f = frame(s);
        const p = f.pos.clone().addScaledVector(f.right, side * (f.wd - 2.5));
        const topY = p.y - 1.9;
        const botY = WATER_Y - 4;
        p.y = (topY + botY) / 2;
        place(GEO.cyl, p, 0, { x: 1.1, y: topY - botY, z: 1.1 }, cUnder);
      }
    }
    // fundo do tabuleiro
    for (let i = i0 - 1; i < i1 + 1; i++) {
      const n = i + 1;
      const v0 = sb.count;
      for (const [j, l] of [[i, -WD[i] - 1.3], [i, WD[i] + 1.3], [n, WD[n] + 1.3], [n, -WD[n] - 1.3]]) {
        va.set(X[j] + RX[j] * l, Y[j] - 1.9, Z[j] + RZ[j] * l);
        sb.vert(va.x, va.y, va.z, 0, -1, 0, cUnder, WHITE[0], WHITE[1]);
      }
      sb.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    }
    // cabeceiras
    for (const s of [bridgeS[0] - 1, bridgeS[1] + 1]) {
      const f = frame(s);
      const p = f.pos.clone();
      p.y -= 3;
      place(GEO.box, p, Math.atan2(f.fwd.x, f.fwd.z), { x: (f.wd + 1.5) * 2, y: 5.6, z: 3 }, cKerb);
    }
  }

  // Pórtico genérico sobre a pista: postes fora do corredor, faixa a >= 7 m
  const gantry = (s, region, { h = 7.2, boardH = 2.4, colPost = col(0xf2f2f2), colFrame = col(0x2b2b30), boardW } = {}) => {
    const f = frame(s);
    const heading = Math.atan2(f.fwd.x, f.fwd.z);
    const span = f.wd + 1.2;
    for (const side of [-1, 1]) {
      const p = f.pos.clone().addScaledVector(f.right, side * span);
      p.y += (h + boardH) / 2 - 0.5;
      place(GEO.box, p, heading, { x: 0.7, y: h + boardH + 1, z: 0.7 }, colPost);
      const foot = f.pos.clone().addScaledVector(f.right, side * span);
      foot.y += 0.3;
      place(GEO.box, foot, heading, { x: 1.4, y: 0.6, z: 1.4 }, colFrame);
    }
    // viga
    const beam = f.pos.clone(); beam.y += h + boardH + 0.25;
    place(GEO.box, beam, heading, { x: span * 2 + 0.7, y: 0.5, z: 0.6 }, colPost);
    const bw = boardW || Math.min(span * 2 - 2, 26);
    const c = f.pos.clone(); c.y += h + boardH / 2;
    const back = f.fwd.clone().negate();
    addBox(sb, c, f.right, UP, back, bw / 2, boardH / 2, 0.2, colFrame, WHITE, REG[region], C.white);
    // verso também com o texto (visto de quem vem na contramão / na volta de cima)
    return f;
  };

  // ------------------------------------------------------------ pórtico de largada com luzes
  const startLights = { mesh: null, state: -1, timer: 0 };
  {
    const f = frame(0);
    const heading = Math.atan2(f.fwd.x, f.fwd.z);
    const span = f.wd + 1.4;
    const h = 8.4;
    const cPost = col(0x2a2d3a), cRed = col(0xe3262f);
    for (const side of [-1, 1]) {
      const p = f.pos.clone().addScaledVector(f.right, side * span);
      p.y += h / 2 + 1;
      place(GEO.box, p, heading, { x: 1.1, y: h + 2, z: 1.1 }, cPost);
      const cap = p.clone(); cap.y = f.pos.y + h + 2.3;
      place(GEO.sphere, cap, 0, 0.75, cRed);
      // bandeiras quadriculadas nos postes
      const fl = f.pos.clone().addScaledVector(f.right, side * (span + 0.9)); fl.y += 5;
      addBox(sb, fl, f.fwd.clone().multiplyScalar(-side), UP, f.right.clone().multiplyScalar(side), 1.0, 1.4, 0.04, C.white, WHITE, REG.checkerSmall, C.white);
    }
    const beam = f.pos.clone(); beam.y += h + 1.3;
    const back = f.fwd.clone().negate();
    // faixa principal com LARGADA • CHEGADA
    addBox(sb, beam, f.right, UP, back, Math.min(span - 1, 13), 1.3, 0.35, cPost, WHITE, REG.largada, C.white);
    const beam2 = beam.clone(); beam2.y += 1.75;
    addBox(sb, beam2, f.right, UP, back, span + 0.5, 0.45, 0.4, cPost, WHITE, REG.checker, C.white);
    // costas da faixa também com texto (quem olha para trás)
    const beamB = beam.clone().addScaledVector(f.fwd, 0.55);
    addBox(sb, beamB, f.right.clone().negate(), UP, f.fwd, Math.min(span - 1, 13), 1.3, 0.18, cPost, WHITE, REG.largada, C.white);
    // painel das luzes
    const panel = f.pos.clone().addScaledVector(back, 0.1); panel.y += h - 0.9;
    addBox(sb, panel, f.right, UP, back, 3.2, 0.75, 0.3, col(0x111114), WHITE, null, null);
    const lampGeo = new THREE.SphereGeometry(0.42, 16, 10);
    disposables.push(lampGeo);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    disposables.push(lampMat);
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 4);
    for (let k = 0; k < 4; k++) {
      const p = panel.clone().addScaledVector(f.right, (k - 1.5) * 1.5).addScaledVector(back, 0.32);
      m4.makeTranslation(p.x, p.y, p.z);
      lamps.setMatrixAt(k, m4);
      lamps.setColorAt(k, col(0x3a1010));
    }
    lamps.instanceMatrix.needsUpdate = true;
    lamps.frustumCulled = false;
    group.add(lamps);
    startLights.mesh = lamps;
  }
  const lampOff = col(0x3a1010), lampRed = col(0xff2020), lampGreen = col(0x30ff5a);
  const setLights = (n) => {
    // n: -1 apagado, 1..3 vermelhas acesas, 4 = verde
    startLights.state = n;
    const L = startLights.mesh;
    for (let k = 0; k < 4; k++) {
      let c = lampOff;
      if (n === 4) c = lampGreen;
      else if (n > 0 && k < n) c = lampRed;
      L.setColorAt(k, c);
    }
    L.instanceColor.needsUpdate = true;
  };
  const offs = [
    bus.on('race:countdown', ({ n }) => setLights(4 - n)),
    bus.on('race:go', () => { setLights(4); startLights.timer = 3; }),
  ];

  // ------------------------------------------------------------ bandeirolas sobre a reta de largada (vão livre > 7 m)
  {
    const cols = [col(0xe3262f), col(0xffd23f), col(0x1d7bd8), col(0x2fbf71), col(0xff7b29), col(0x8a3cff), col(0xffffff)];
    for (const s0 of [32, 58, 84, -44]) {
      const f = frame(s0);
      const span = f.wd + 1.6;
      for (const side of [-1, 1]) {
        const p = f.pos.clone().addScaledVector(f.right, side * span);
        p.y += 5.2;
        place(GEO.cylLow, p, 0, { x: 0.12, y: 10.4, z: 0.12 }, col(0xf2f2f2));
        const tip = p.clone(); tip.y += 5.3;
        place(GEO.sphere, tip, 0, 0.25, col(0xe3262f));
      }
      const nFl = Math.round(span * 2 / 1.1);
      for (let k = 0; k < nFl; k++) {
        const t0 = k / nFl, t1 = (k + 0.7) / nFl;
        const sag = (t) => 10.1 - 1.8 * Math.sin(Math.PI * t);
        const a = f.pos.clone().addScaledVector(f.right, lerp(-span, span, t0)); a.y += sag(t0);
        const b2 = f.pos.clone().addScaledVector(f.right, lerp(-span, span, t1)); b2.y += sag(t1);
        const c = a.clone().lerp(b2, 0.5); c.y -= 0.85;
        const cc = cols[k % cols.length];
        const v0 = sb.count;
        for (const v of [a, b2, c]) sb.vert(v.x, v.y, v.z, f.fwd.x, 0, f.fwd.z, cc, WHITE[0], WHITE[1]);
        for (const v of [a, b2, c]) sb.vert(v.x, v.y, v.z, -f.fwd.x, 0, -f.fwd.z, cc, WHITE[0], WHITE[1]);
        sb.idx.push(v0, v0 + 1, v0 + 2, v0 + 3, v0 + 5, v0 + 4);
      }
    }
  }

  // ------------------------------------------------------------ pórticos temáticos e placas
  gantry(ctrlS[2] + 16, 'lab', { colPost: col(0xefe9ff), colFrame: col(0x5518b8) });
  gantry(ctrlS[9] + 16, 'obs', { colPost: col(0xf5f7ff), colFrame: col(0x0b1433) });
  gantry(bridgeS[0] - 26, 'lagoa', { colPost: col(0xffffff), colFrame: col(0x0b7d98) });
  gantry(tunnelS[1] + 50, 'tesla', { colPost: col(0x2b2b30), colFrame: col(0xf09000) });
  gantry(ctrlS[29] + 30, 'largada', { colPost: col(0xffffff), colFrame: col(0xa3121b) });

  // Painéis com fórmulas fora da mureta, virados para quem chega
  const billboards = [
    [60, 1, 'emc2'], [ctrlS[3] + 10, -1, 'h2o'], [ctrlS[7] + 10, 1, 'pvnrt'], [ctrlS[9] - 10, -1, 'dna'],
    [ctrlS[12] + 5, 1, 'grav'], [ctrlS[16] - 8, -1, 'fma'], [ctrlS[22] + 30, -1, 'pitag'], [ctrlS[28] - 30, -1, 'luz'],
    [ctrlS[27] + 40, 1, 'emc2'], [ctrlS[1] + 40, -1, 'fma'],
  ];
  for (const [s, side, reg] of billboards) {
    const f = frame(s);
    const heading = Math.atan2(f.fwd.x, f.fwd.z);
    const lat = side * (f.wd + 4.5);
    const base = f.pos.clone().addScaledVector(f.right, lat);
    // gira um pouco para a pista
    const yaw = heading + Math.PI + side * 0.35;
    const az = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const ax = new THREE.Vector3(-az.z, 0, az.x).negate();
    const ay = UP;
    const c = base.clone(); c.y += 4.2;
    addBox(sb, c, ax, ay, az, 3.6, 1.35, 0.15, col(0x333338), WHITE, REG[reg], C.white);
    for (const k of [-1, 1]) {
      const p = base.clone().addScaledVector(ax, k * 2.6); p.y += 1.5;
      place(GEO.box, p, yaw, { x: 0.22, y: 3.2, z: 0.22 }, col(0x555560));
    }
  }

  // Placas de seta no lado de fora das curvas fechadas
  {
    let last = -99;
    for (let i = 0; i < N; i += 3) {
      const k = K[i];
      if (Math.abs(k) < 1 / 45 || FL[i]) continue;
      const s = i * ds;
      if (s - last < 9) continue;
      last = s;
      const f = frame(s);
      const side = k > 0 ? -1 : 1; // fora
      const lat = side * (f.wd + 2.2);
      const base = f.pos.clone().addScaledVector(f.right, lat);
      const heading = Math.atan2(f.fwd.x, f.fwd.z);
      const az = f.fwd.clone().negate();
      const ax = f.right.clone();
      const c = base.clone(); c.y += 1.9;
      const reg = REG[zoneOf(s) === 'final' || zoneOf(s) === 'lagoa' ? 'arrow' : 'arrowBlue'];
      // seta aponta para o lado da curva: espelha a região quando a curva é à esquerda
      const rr = k > 0 ? reg : [reg[2], reg[1], reg[0], reg[3]];
      addBox(sb, c, ax, UP, az, 1.1, 1.1, 0.08, col(0x222222), WHITE, rr, C.white);
      const p = base.clone(); p.y += 0.6;
      place(GEO.box, p, heading, { x: 0.15, y: 1.2, z: 0.15 }, col(0x777777));
    }
  }

  // ------------------------------------------------------------ bobinas de Tesla (torres)
  const teslaTops = [];
  {
    const cBase = col(0x2b2d3a), cCopper = col(0xd9823b), cSilver = col(0xdfe6ee), cRing = col(0x6b4fd8);
    const s0 = tunnelS[1] + 30;
    const s1 = ctrlS[28] + 30;
    const pairs = 4;
    for (let p = 0; p < pairs; p++) {
      const s = lerp(s0, s1, (p + 0.5) / pairs);
      const f = frame(s);
      for (const side of [-1, 1]) {
        const base = f.pos.clone().addScaledVector(f.right, side * (f.wd + 4));
        const y0 = base.y;
        const put = (geo, y, sx, sy, color) => { const pp = base.clone(); pp.y = y0 + y; place(geo, pp, 0, { x: sx, y: sy, z: sx }, color); };
        put(GEO.cyl, 0.6, 2.2, 1.2, cBase);
        put(GEO.cyl, 1.5, 1.6, 0.6, cRing);
        put(GEO.cyl, 6.2, 0.95, 9.2, cCopper);
        for (let r = 0; r < 6; r++) put(GEO.cyl, 2.5 + r * 1.4, 1.05, 0.12, col(0x8a4a1c));
        const top = base.clone(); top.y = y0 + 11.6;
        q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        m4.compose(top, q, sc.set(1.9, 1.9, 1.9));
        sb.geo(GEO.torus, m4, cSilver, null, WHITE);
        put(GEO.sphere, 11.6, 0.5, 0.5, cSilver);
        teslaTops.push(top);
      }
    }
  }

  // ------------------------------------------------------------ túnel: bocas (fachadas trapezoidais)
  {
    const cStone = col(0x6d6a8e), cStoneD = col(0x4a4768);
    for (const [s, dir] of [[tunnelS[0], 1], [tunnelS[1], -1]]) {
      const i = Math.round(s / ds);
      const f = frame(s);
      const tp = tunnelProfile(s, WD[i]);
      const mt = group.userData.moundTop[Math.min(Math.max(i, Math.ceil(tunnelS[0] / ds) + 1), Math.floor(tunnelS[1] / ds))] || tp.top + 1;
      const topW = tp.span + group.userData.moundPad + 1, botW = tp.span + group.userData.moundPad + 18;
      const Hh = mt + 1.8;
      const shape = new THREE.Shape();
      shape.moveTo(-botW, -3); shape.lineTo(botW, -3); shape.lineTo(botW, 1.5); shape.lineTo(topW + 4, Hh - 2.5);
      shape.lineTo(topW, Hh - 2.5); shape.lineTo(topW, Hh); shape.lineTo(-topW, Hh); shape.lineTo(-topW, Hh - 2.5);
      shape.lineTo(-topW - 4, Hh - 2.5); shape.lineTo(-botW, 1.5); shape.closePath();
      const hole = new THREE.Path();
      const seg = 20;
      hole.moveTo(-tp.span, -0.2);
      hole.lineTo(tp.span, -0.2);
      hole.lineTo(tp.span, tp.wallH);
      for (let k = 1; k <= seg; k++) {
        const a = (k / seg) * Math.PI;
        hole.lineTo(Math.cos(a) * tp.span, tp.wallH + Math.sin(a) * tp.rise);
      }
      hole.lineTo(-tp.span, -0.2);
      shape.holes.push(hole);
      const depth = 3;
      const eg = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
      // x = lateral (direita), y = altura, z = ao longo da pista
      const basis = new THREE.Matrix4().makeBasis(f.right.clone().negate(), UP, f.fwd.clone().negate());
      // Com x = -right, a face da frente (z=+depth -> -fwd) fica voltada para quem chega.
      const pos = f.pos.clone().addScaledVector(f.fwd, dir > 0 ? depth - 0.5 : 0.5);
      if (dir < 0) basis.makeBasis(f.right, UP, f.fwd.clone());
      if (dir < 0) pos.copy(f.pos).addScaledVector(f.fwd, -(depth - 0.5));
      basis.setPosition(pos);
      sb.geo(eg, basis, cStone, null, WHITE);
      eg.dispose();
      // moldura brilhante da boca e placa
      const back = dir > 0 ? f.fwd.clone().negate() : f.fwd.clone();
      const faceP = f.pos.clone().addScaledVector(back, 0.55);
      const sideAx = dir > 0 ? f.right.clone() : f.right.clone().negate();
      const signC = faceP.clone(); signC.y += tp.wallH + tp.rise + 1.6;
      addBox(sb, signC, sideAx, UP, back, Math.min(9, topW), 1.1, 0.25, cStoneD, WHITE, REG.tunel, C.white);
    }
  }

  // ------------------------------------------------------------ malha das estruturas
  const structures = mkMesh(sb.build(), matAtlas, { cast: true, receive: true, name: 'estruturas' });
  structures.frustumCulled = true;

  // ------------------------------------------------------------ pilhas de pneus (instanciadas)
  let tires = null;
  {
    // pilha de 3 pneus: cilindro aberto com "gomos" + tampa escura
    const seg = hi ? 7 : 6;
    const cg = new THREE.CylinderGeometry(0.42, 0.42, 0.93, seg, hi ? 6 : 1, true);
    const cp = cg.attributes.position;
    for (let k = 0; k < cp.count; k++) {
      const yy = cp.getY(k) + 0.465;
      const row = Math.round(yy / 0.155);
      const r = !hi ? 0.41 : row % 2 ? 0.43 : 0.36;
      const x = cp.getX(k), z = cp.getZ(k), l = Math.hypot(x, z) || 1;
      cp.setXYZ(k, (x / l) * r, yy, (z / l) * r);
    }
    cg.computeVertexNormals();
    const cap = new THREE.CircleGeometry(0.37, seg);
    cap.rotateX(-Math.PI / 2);
    const stack = new Builder();
    m4.identity();
    stack.geo(cg, m4, col(0xffffff));
    m4.makeTranslation(0, 0.93, 0);
    stack.geo(cap, m4, col(0x2a2a2a));
    cg.dispose(); cap.dispose();
    const geo = stack.build();
    geo.deleteAttribute('uv');
    disposables.push(geo);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    disposables.push(mat);
    const count = tireSpots.length;
    tires = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    const palette = [col(0x1e1e22), col(0xe3262f), col(0x1e1e22), col(0xffffff), col(0x1e1e22), col(0x1d7bd8), col(0x1e1e22), col(0xffd23f)];
    tireSpots.forEach(([s, side], k) => {
      const smp = sample(s);
      const p = smp.pos.clone().addScaledVector(smp.right, side * (smp.wallDist + 0.42));
      p.y -= 0.02;
      m4.makeTranslation(p.x, p.y, p.z);
      tires.setMatrixAt(k, m4);
      tires.setColorAt(k, palette[k % palette.length]);
    });
    tires.count = count;
    tires.castShadow = true;
    tires.receiveShadow = true;
    tires.instanceMatrix.needsUpdate = true;
    if (tires.instanceColor) tires.instanceColor.needsUpdate = true;
    tires.computeBoundingSphere();
    group.add(tires);
  }

  // ------------------------------------------------------------ interior do túnel (céu estrelado)
  const starTex = starTexture(hi);
  disposables.push(starTex);
  {
    const b = new Builder();
    const i0 = Math.ceil(tunnelS[0] / ds), i1 = Math.floor(tunnelS[1] / ds);
    const SEG = hi ? 22 : 14;
    const white = new THREE.Color(1, 1, 1);
    const rows = [];
    for (let i = i0; i <= i1; i++) {
      const s = i * ds;
      const tp = tunnelProfile(s, WD[i]);
      // perfil: parede esquerda sobe, arco, parede direita desce
      const pts = [];
      pts.push([-tp.span, -0.1]);
      pts.push([-tp.span, tp.wallH]);
      for (let k = 1; k < SEG; k++) {
        const a = Math.PI - (k / SEG) * Math.PI;
        pts.push([Math.cos(a) * tp.span, tp.wallH + Math.sin(a) * tp.rise]);
      }
      pts.push([tp.span, tp.wallH]);
      pts.push([tp.span, -0.1]);
      let acc = 0;
      const row = [];
      for (let k = 0; k < pts.length; k++) {
        if (k) acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        const [l, h] = pts[k];
        va.set(X[i] + RX[i] * l, Y[i] + h, Z[i] + RZ[i] * l);
        // normal para dentro (aprox.)
        const nx = -l, ny = -(h - tp.wallH) * 0.6;
        const nl = Math.hypot(nx, ny) || 1;
        row.push(b.vert(va.x, va.y, va.z, RX[i] * nx / nl, ny / nl, RZ[i] * nx / nl, white, acc / 24, s / 24));
      }
      rows.push(row);
    }
    for (let r = 0; r < rows.length - 1; r++) {
      const A = rows[r], B = rows[r + 1];
      for (let k = 0; k < A.length - 1; k++) b.idx.push(A[k], B[k], B[k + 1], A[k], B[k + 1], A[k + 1]);
    }
    const mat = new THREE.MeshBasicMaterial({ map: starTex, vertexColors: true, side: THREE.DoubleSide, fog: false });
    disposables.push(mat);
    mkMesh(b.build(), mat, { receive: false, name: 'tunel-ceu' });
  }

  // Faixas de luz e anéis dentro do túnel + contornos das rampas e aceleradores (brilho)
  const glowB = new Builder();
  {
    const i0 = Math.ceil(tunnelS[0] / ds), i1 = Math.floor(tunnelS[1] / ds);
    const cyan = col(0x39f3ff), mag = col(0xff4fd8), gold = col(0xffd23f);
    const strip = (latFn, h0, h1, color) => {
      for (let i = i0; i < i1; i++) {
        const n = i + 1;
        const v0 = glowB.count;
        for (const [j, h] of [[i, h0], [i, h1], [n, h1], [n, h0]]) {
          const l = latFn(j);
          va.set(X[j] + RX[j] * l, Y[j] + h, Z[j] + RZ[j] * l);
          glowB.vert(va.x, va.y, va.z, 0, 1, 0, color, 0, 0);
        }
        glowB.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3, v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
      }
    };
    // topo das muretas (linha ciano) e faixas na base do arco
    strip((j) => -WD[j] - 0.02, 0.84, 0.95, cyan);
    strip((j) => WD[j] + 0.02, 0.84, 0.95, cyan);
    strip((j) => -SPAN[j] + 0.05, 4.2, 4.45, mag);
    strip((j) => SPAN[j] - 0.05, 4.2, 4.45, mag);
    // anéis a cada 14 m
    for (let s = tunnelS[0] + 6; s < tunnelS[1] - 4; s += 14) {
      const i = Math.round(s / ds);
      const tp = tunnelProfile(s, WD[i]);
      const n = 24;
      for (let k = 0; k < n; k++) {
        const a0 = Math.PI - (k / n) * Math.PI, a1 = Math.PI - ((k + 1) / n) * Math.PI;
        const r0 = [Math.cos(a0) * (tp.span - 0.15), tp.wallH + Math.sin(a0) * (tp.rise - 0.15)];
        const r1 = [Math.cos(a1) * (tp.span - 0.15), tp.wallH + Math.sin(a1) * (tp.rise - 0.15)];
        const v0 = glowB.count;
        for (const [pp, dsx] of [[r0, -0.25], [r1, -0.25], [r1, 0.25], [r0, 0.25]]) {
          const j = i;
          va.set(X[j] + RX[j] * pp[0] + TX[j] * dsx, Y[j] + pp[1], Z[j] + RZ[j] * pp[0] + TZ[j] * dsx);
          glowB.vert(va.x, va.y, va.z, 0, 1, 0, (Math.round(s) / 14) % 2 < 1 ? cyan : gold, 0, 0);
        }
        glowB.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3, v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
      }
      // pés verticais dos anéis
      for (const side of [-1, 1]) {
        const v0 = glowB.count;
        for (const [h, dsx] of [[0, -0.25], [tp.wallH, -0.25], [tp.wallH, 0.25], [0, 0.25]]) {
          const l = side * (tp.span - 0.15);
          va.set(X[i] + RX[i] * l + TX[i] * dsx, Y[i] + h, Z[i] + RZ[i] * l + TZ[i] * dsx);
          glowB.vert(va.x, va.y, va.z, 0, 1, 0, cyan, 0, 0);
        }
        glowB.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3, v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
      }
    }
    // moldura das bocas do túnel
    for (const s of [tunnelS[0], tunnelS[1]]) {
      const i = Math.round(s / ds);
      const tp = tunnelProfile(s, WD[i]);
      const dir = s === tunnelS[0] ? -1 : 1;
      const n = 28;
      const pts = [[-tp.span - 0.4, 0], [-tp.span - 0.4, tp.wallH]];
      for (let k = 1; k < n; k++) {
        const a = Math.PI - (k / n) * Math.PI;
        pts.push([Math.cos(a) * (tp.span + 0.4), tp.wallH + Math.sin(a) * (tp.rise + 0.4)]);
      }
      pts.push([tp.span + 0.4, tp.wallH], [tp.span + 0.4, 0]);
      for (let k = 0; k < pts.length - 1; k++) {
        const p0 = pts[k], p1 = pts[k + 1];
        const d0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        const ox = -(p1[1] - p0[1]) / d0 * 0.55, oy = (p1[0] - p0[0]) / d0 * 0.55;
        const v0 = glowB.count;
        for (const [l, h] of [[p0[0], p0[1]], [p1[0], p1[1]], [p1[0] - ox, p1[1] - oy], [p0[0] - ox, p0[1] - oy]]) {
          va.set(X[i] + RX[i] * l + TX[i] * dir * 0.62, Y[i] + h, Z[i] + RZ[i] * l + TZ[i] * dir * 0.62);
          glowB.vert(va.x, va.y, va.z, 0, 1, 0, cyan, 0, 0);
        }
        glowB.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3, v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
      }
    }
  }
  mkMesh(glowB.build(), matGlow, { receive: false, name: 'luzes-tunel' });

  // Estrelas soltas no túnel (pontos aditivos)
  const glowTex = glowTexture();
  disposables.push(glowTex);
  {
    const n = hi ? 420 : 160;
    const pos = new Float32Array(n * 3);
    const cols = new Float32Array(n * 3);
    const cc = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const s = lerp(tunnelS[0] + 3, tunnelS[1] - 3, rand());
      const i = Math.round(s / ds);
      const tp = tunnelProfile(s, WD[i]);
      const a = Math.PI * (0.05 + rand() * 0.9);
      const rr = 0.8 + rand() * 0.15;
      const l = Math.cos(a) * tp.span * rr;
      const h = tp.wallH + Math.sin(a) * tp.rise * rr + (rand() < 0.3 ? -rand() * 3 : 0);
      if (Math.abs(l) < WD[i] + 0.5 && h < 6.5) continue;
      pos[k * 3] = X[i] + RX[i] * l; pos[k * 3 + 1] = Y[i] + h; pos[k * 3 + 2] = Z[i] + RZ[i] * l;
      cc.setHSL(rand() < 0.5 ? 0.55 : 0.8, 0.6, 0.75);
      cols[k * 3] = cc.r; cols[k * 3 + 1] = cc.g; cols[k * 3 + 2] = cc.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.9, map: glowTex, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
    });
    disposables.push(g, mat);
    const pts = new THREE.Points(g, mat);
    pts.name = 'estrelas-tunel';
    group.add(pts);
  }

  // Planetas nas baías do túnel
  const planets = [];
  {
    const pt = planetTextures(hi);
    disposables.push(pt.tex, pt.ringTex);
    const pmat = new THREE.MeshLambertMaterial({ map: pt.tex, emissive: 0xffffff, emissiveMap: pt.tex, emissiveIntensity: 0.55 });
    disposables.push(pmat);
    const sphereGeo = (rect) => {
      const g = new THREE.SphereGeometry(1, hi ? 40 : 22, hi ? 24 : 14);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, lerp(rect[0], rect[2], uv.getX(k)), lerp(rect[1], rect[3], uv.getY(k)));
      disposables.push(g);
      return g;
    };
    const addPlanet = (rect, s, side, radius, h, tilt, spin) => {
      const i = Math.round(s / ds);
      const l = side * (WD[i] + 4.6);
      const m = new THREE.Mesh(sphereGeo(rect), pmat);
      m.position.set(X[i] + RX[i] * l, Y[i] + h, Z[i] + RZ[i] * l);
      m.scale.setScalar(radius);
      m.rotation.z = tilt;
      m.userData.spin = spin;
      group.add(m);
      planets.push(m);
      return m;
    };
    const sA = (bayA[0] + bayA[1]) / 2, sB = (bayB[0] + bayB[1]) / 2;
    const saturn = addPlanet(pt.rect.saturn, sA - 12, -1, 2.2, 4.8, 0.3, 0.25);
    addPlanet(pt.rect.jupiter, sA + 8, 1, 3.1, 4.4, 0.05, 0.4);
    const earth = addPlanet(pt.rect.earth, sB - 4, 1, 2.5, 4.3, 0.41, 0.3);
    addPlanet(pt.rect.mars, sB + 8, -1, 1.5, 3.4, 0.2, 0.35);
    const moon = addPlanet(pt.rect.moon, sB - 4, 1, 0.7, 4.3, 0, 0.1);
    moon.userData.orbit = { center: earth.position.clone(), r: 4.0, speed: 0.5, s: sB - 4 };
    // anel de Saturno
    const ringGeo = new THREE.RingGeometry(1.35, 2.1, hi ? 64 : 32, 1);
    const rp = ringGeo.attributes.position, ruv = ringGeo.attributes.uv;
    for (let k = 0; k < rp.count; k++) {
      const r = Math.hypot(rp.getX(k), rp.getY(k));
      ruv.setXY(k, (r - 1.35) / 0.75, 0.5);
    }
    const ringMat = new THREE.MeshLambertMaterial({
      map: pt.ringTex, emissive: 0xffffff, emissiveMap: pt.ringTex, emissiveIntensity: 0.5,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    disposables.push(ringGeo, ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    const ringHolder = new THREE.Group();
    ringHolder.position.copy(saturn.position);
    ringHolder.scale.setScalar(2.2);
    // inclina o anel: borda de perto (lado da pista) mais alta
    const iS = Math.round((sA - 12) / ds);
    ringHolder.rotation.y = HEAD[iS];
    ringHolder.rotation.z = 0.55;
    ringHolder.add(ring);
    group.add(ringHolder);
  }

  // ------------------------------------------------------------ aceleradores (setas animadas)
  const chevTex = chevronTexture();
  disposables.push(chevTex);
  const padMat = new THREE.MeshBasicMaterial({
    map: chevTex, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  disposables.push(padMat);
  {
    const b = new Builder();
    const white = new THREE.Color(1, 1, 1);
    for (const pad of boostPads) {
      const segs = 8;
      const v0 = b.count;
      for (let k = 0; k <= segs; k++) {
        const s = pad.s - pad.length / 2 + (k / segs) * pad.length;
        const smp = sample(s);
        for (const e of [-1, 1]) {
          va.copy(smp.pos).addScaledVector(smp.right, pad.lateral + e * pad.width / 2).addScaledVector(smp.up, 0.03);
          b.vert(va.x, va.y, va.z, 0, 1, 0, white, e < 0 ? 0 : 1, (k / segs) * (pad.length / 3.5));
        }
      }
      for (let k = 0; k < segs; k++) {
        const a = v0 + k * 2;
        b.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    const m = mkMesh(b.build(), padMat, { receive: false, name: 'aceleradores' });
    m.renderOrder = 2;
  }

  // ------------------------------------------------------------ rampas (cunhas)
  {
    const b = new Builder();
    const w = new THREE.Color(1, 1, 1);
    const side = col(0xffd000);
    for (const rp of ramps) {
      const segs = 6;
      const rows = [];
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const s = rp.s - rp.length / 2 + t * rp.length;
        const smp = sample(s);
        const h = t * RAMP_H;
        const L = smp.pos.clone().addScaledVector(smp.right, rp.lateral - rp.width / 2);
        const R = smp.pos.clone().addScaledVector(smp.right, rp.lateral + rp.width / 2);
        rows.push({ L, R, h, t, up: smp.up.clone(), right: smp.right.clone() });
      }
      const reg = REG.ramp, hz = REG.hazard;
      // topo
      const v0 = b.count;
      for (const r of rows) {
        b.vert(r.L.x, r.L.y + r.h + 0.01, r.L.z, 0, 1, 0, w, reg[0], lerp(reg[1], reg[3], r.t));
        b.vert(r.R.x, r.R.y + r.h + 0.01, r.R.z, 0, 1, 0, w, reg[2], lerp(reg[1], reg[3], r.t));
      }
      for (let k = 0; k < segs; k++) { const a = v0 + k * 2; b.idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
      // laterais listradas
      for (const e of [-1, 1]) {
        const v1 = b.count;
        for (const r of rows) {
          const p = e < 0 ? r.L : r.R;
          b.vert(p.x, p.y - 0.05, p.z, r.right.x * e, 0, r.right.z * e, side, lerp(hz[0], hz[2], r.t), hz[1]);
          b.vert(p.x, p.y + r.h + 0.01, p.z, r.right.x * e, 0, r.right.z * e, side, lerp(hz[0], hz[2], r.t), lerp(hz[1], hz[3], Math.max(0.15, r.t)));
        }
        for (let k = 0; k < segs; k++) {
          const a = v1 + k * 2;
          if (e > 0) b.idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
          else b.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
        }
      }
      // face traseira (queda)
      const last = rows[segs];
      const v2 = b.count;
      const fw = sample(rp.s + rp.length / 2).tangent;
      for (const [p, h, u] of [[last.L, -0.05, hz[0]], [last.R, -0.05, hz[2]], [last.R, last.h + 0.01, hz[2]], [last.L, last.h + 0.01, hz[0]]]) {
        b.vert(p.x, p.y + h, p.z, fw.x, 0, fw.z, side, u, h > 0 ? hz[3] : hz[1]);
      }
      b.idx.push(v2, v2 + 2, v2 + 1, v2, v2 + 3, v2 + 2);
    }
    mkMesh(b.build(), matAtlas, { cast: true, receive: true, name: 'rampas' });
    // faixa luminosa na borda de saída das rampas
    const gl = new Builder();
    const cyan = col(0x7ef9ff);
    for (const rp of ramps) {
      const e = sample(rp.s + rp.length / 2 - 0.05);
      const v0 = gl.count;
      for (const [l, h] of [[-1, 0.02], [1, 0.02], [1, 0.14], [-1, 0.14]]) {
        va.copy(e.pos).addScaledVector(e.right, rp.lateral + (l * rp.width) / 2);
        va.y += RAMP_H + h - 0.12;
        gl.vert(va.x, va.y, va.z, 0, 1, 0, cyan, 0, 0);
      }
      gl.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3, v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
    }
    mkMesh(gl.build(), matGlow, { receive: false, name: 'rampas-brilho' });
  }

  // ------------------------------------------------------------ arcos elétricos das bobinas
  const arcs = [];
  const ARC_SEG = 14;
  let arcMesh = null, arcGlow = null;
  {
    for (let p = 0; p < teslaTops.length; p += 2) {
      arcs.push({ a: teslaTops[p], b: teslaTops[p + 1], bulge: 3.2, kind: 'over' });
      // arco lateral para um para-raios fora da pista
      const t = teslaTops[p + ((p / 2) % 2)];
      const smp = project(t, undefined);
      const side = Math.sign(smp.lateral) || 1;
      const g = t.clone().addScaledVector(sample(smp.s).right, side * 4.5).addScaledVector(sample(smp.s).tangent, 5);
      g.y = sample(smp.s).pos.y + 2.2;
      arcs.push({ a: t, b: g, bulge: 1.2, kind: 'side' });
    }
    const nA = arcs.length;
    const pos = new Float32Array(nA * ARC_SEG * 8 * 3);
    const index = [];
    for (let a = 0; a < nA; a++) {
      for (let k = 0; k < ARC_SEG; k++) {
        const base = (a * ARC_SEG + k) * 8;
        for (let q2 = 0; q2 < 2; q2++) {
          const v = base + q2 * 4;
          index.push(v, v + 1, v + 2, v, v + 2, v + 3);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(index);
    g.boundingSphere = new THREE.Sphere(teslaTops[0].clone().lerp(teslaTops[teslaTops.length - 1], 0.5), 200);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xd9c8ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
    });
    disposables.push(g, mat);
    arcMesh = new THREE.Mesh(g, mat);
    arcMesh.frustumCulled = false;
    arcMesh.name = 'arcos-tesla';
    group.add(arcMesh);
    // brilho nas esferas
    const gp = new Float32Array(teslaTops.length * 3);
    teslaTops.forEach((t, k) => { gp[k * 3] = t.x; gp[k * 3 + 1] = t.y; gp[k * 3 + 2] = t.z; });
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    const gm = new THREE.PointsMaterial({
      size: 9, map: glowTex, color: 0xb388ff, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false, fog: false,
    });
    disposables.push(gg, gm);
    arcGlow = new THREE.Points(gg, gm);
    arcGlow.name = 'brilho-tesla';
    group.add(arcGlow);
  }
  const arcTmp = { p: new THREE.Vector3(), q: new THREE.Vector3(), d: new THREE.Vector3(), n1: new THREE.Vector3(), n2: new THREE.Vector3() };
  const arcPts = [];
  for (let k = 0; k <= ARC_SEG; k++) arcPts.push(new THREE.Vector3());
  function regenArcs() {
    const pos = arcMesh.geometry.attributes.position.array;
    for (let a = 0; a < arcs.length; a++) {
      const arc = arcs[a];
      const { d, n1, n2 } = arcTmp;
      d.subVectors(arc.b, arc.a);
      const len = d.length();
      d.divideScalar(len);
      n1.set(-d.z, 0, d.x).normalize();
      n2.crossVectors(d, n1).normalize();
      const amp = len * 0.05;
      for (let k = 0; k <= ARC_SEG; k++) {
        const t = k / ARC_SEG;
        const p = arcPts[k].copy(arc.a).lerp(arc.b, t);
        p.y += Math.sin(Math.PI * t) * arc.bulge;
        if (k > 0 && k < ARC_SEG) {
          p.addScaledVector(n1, (Math.random() - 0.5) * 2 * amp);
          p.addScaledVector(n2, (Math.random() - 0.5) * 2 * amp);
        }
      }
      const w = arc.kind === 'over' ? 0.28 : 0.2;
      for (let k = 0; k < ARC_SEG; k++) {
        const p0 = arcPts[k], p1 = arcPts[k + 1];
        const base = ((a * ARC_SEG + k) * 8) * 3;
        const wk = w * (0.6 + 0.4 * Math.sin(Math.PI * (k + 0.5) / ARC_SEG));
        const quads = [n1, n2];
        for (let qi = 0; qi < 2; qi++) {
          const nn = quads[qi];
          const o = base + qi * 12;
          pos[o] = p0.x - nn.x * wk; pos[o + 1] = p0.y - nn.y * wk; pos[o + 2] = p0.z - nn.z * wk;
          pos[o + 3] = p1.x - nn.x * wk; pos[o + 4] = p1.y - nn.y * wk; pos[o + 5] = p1.z - nn.z * wk;
          pos[o + 6] = p1.x + nn.x * wk; pos[o + 7] = p1.y + nn.y * wk; pos[o + 8] = p1.z + nn.z * wk;
          pos[o + 9] = p0.x + nn.x * wk; pos[o + 10] = p0.y + nn.y * wk; pos[o + 11] = p0.z + nn.z * wk;
        }
      }
    }
    arcMesh.geometry.attributes.position.needsUpdate = true;
  }
  regenArcs();

  // ------------------------------------------------------------ 14-bis de Santos Dumont
  const plane = buildBiplane(hi, matAtlas, WHITE);
  group.add(plane.group);
  disposables.push(...plane.disposables);
  const flight = (() => {
    // círculo sobre a reta de Tesla com um looping por volta
    const sMid = lerp(tunnelS[1], ctrlS[28], 0.55);
    const f = frame(sMid);
    const center = f.pos.clone().addScaledVector(f.right, -32);
    const R = 58, alt = f.pos.y + 19, loopR = 11, speed = 16;
    const circ = TAU * R;
    const loopLen = TAU * loopR;
    const loopAt = circ * 0.35;
    return { center, R, alt, loopR, speed, circ, loopLen, loopAt, total: circ + loopLen, d: 0 };
  })();
  const fl = { p: new THREE.Vector3(), p2: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3(), x: new THREE.Vector3(), mat: new THREE.Matrix4() };
  const flInfo = { cx: 0, sz: 0 };
  function flightPos(d, out) {
    const F = flight;
    d = ((d % F.total) + F.total) % F.total;
    let arc, lx = 0, ly = 0;
    if (d < F.loopAt) arc = d;
    else if (d < F.loopAt + F.loopLen) {
      arc = F.loopAt;
      const tau = ((d - F.loopAt) / F.loopLen) * TAU;
      lx = F.loopR * Math.sin(tau);
      ly = F.loopR * (1 - Math.cos(tau));
    } else arc = d - F.loopLen;
    const ang = arc / F.R; // anti-horário visto de cima
    const cx = Math.cos(ang), sz = Math.sin(ang);
    // tangente do círculo (sentido de avanço)
    const tx = -sz, tz = cx;
    out.set(F.center.x + cx * F.R + tx * lx, F.alt + ly + Math.sin(ang * 2) * 2, F.center.z + sz * F.R + tz * lx);
    flInfo.cx = cx; flInfo.sz = sz;
    return flInfo;
  }
  function updatePlane(dt) {
    flight.d += flight.speed * dt;
    flightPos(flight.d + 0.6, fl.p2);
    const info = flightPos(flight.d, fl.p);
    fl.fwd.subVectors(fl.p2, fl.p).normalize();
    const F = flight;
    const dd = ((flight.d % F.total) + F.total) % F.total;
    if (dd >= F.loopAt && dd < F.loopAt + F.loopLen) {
      // no looping, o "para cima" aponta para o centro do looping
      const arc = F.loopAt, ang = arc / F.R;
      const cx = Math.cos(ang), sz = Math.sin(ang);
      fl.up.set(F.center.x + cx * F.R, F.alt + F.loopR + Math.sin(ang * 2) * 2, F.center.z + sz * F.R).sub(fl.p).normalize();
    } else {
      // inclinação na curva (para dentro do círculo)
      fl.up.set(-info.cx * 0.35, 1, -info.sz * 0.35).normalize();
    }
    fl.x.crossVectors(fl.up, fl.fwd).normalize();
    fl.up.crossVectors(fl.fwd, fl.x).normalize();
    fl.mat.makeBasis(fl.x, fl.up, fl.fwd);
    plane.group.quaternion.setFromRotationMatrix(fl.mat);
    plane.group.position.copy(fl.p);
    plane.prop.rotation.z += dt * 30;
  }
  updatePlane(0);

  // ------------------------------------------------------------ atualização por quadro
  let arcTimer = 0;
  function update(dt, t) {
    chevTex.offset.y = (chevTex.offset.y - dt * 1.6) % 1;
    arcTimer -= dt;
    if (arcTimer <= 0) {
      regenArcs();
      arcTimer = 0.05 + Math.random() * 0.05;
      arcMesh.material.opacity = 0.6 + Math.random() * 0.4;
      arcGlow.material.size = 7 + Math.random() * 4;
    }
    updatePlane(dt);
    for (let k = 0; k < planets.length; k++) {
      const p = planets[k];
      p.rotation.y += dt * p.userData.spin;
      const o = p.userData.orbit;
      if (o) {
        const a = t * o.speed;
        const i = Math.round(o.s / ds);
        p.position.set(o.center.x + TX[i] * Math.cos(a) * o.r, o.center.y + Math.sin(a) * 1.2, o.center.z + TZ[i] * Math.cos(a) * o.r);
        p.position.x -= RX[i] * Math.sin(a) * 1.2;
        p.position.z -= RZ[i] * Math.sin(a) * 1.2;
      }
    }
    if (startLights.timer > 0) {
      startLights.timer -= dt;
      if (startLights.timer <= 0) setLights(-1);
    }
  }

  const track = {
    name: 'Campus da Ciência',
    length,
    sample,
    project,
    curvature,
    racingLine,
    gridSlots,
    itemBoxSlots,
    boostPads,
    ramps,
    minimapPoints,
    update,
    group,
    // Extras (fora do contrato) usados por environment.js e testes
    meta: {
      N, ds, X, Y, Z, HW, WD, FL, ROOF, SPAN, HEAD, K,
      zones, zoneOf, bridgeS, tunnelS, crossing, ctrlS, waterY: WATER_Y,
      grassTexture: grass, headingAt, tunnelProfile,
      moundTop: group.userData.moundTop,
      moundPad: group.userData.moundPad,
    },
    dispose() {
      offs.forEach((off) => off());
      scene.remove(group);
      disposables.forEach((d) => d.dispose && d.dispose());
      if (tires) tires.dispose();
    },
  };
  return track;
}

// ---------------------------------------------------------------------------
// 14-bis: caixa-canard na frente, asas em células de pipa, motor e hélice empurrando atrás.
function buildBiplane(hi, material, WHITE) {
  const b = new Builder();
  const fabric = col(0xf6ead0), fabric2 = col(0xeadbb8), bamboo = col(0x9b6a3a), dark = col(0x3a3a3a), metal = col(0x9aa0a8);
  const m = new THREE.Matrix4();
  const bx = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, hi ? 6 : 4, 1);
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const addB = (x, y, z, sx, sy, sz, c, rx = 0, ry = 0, rz = 0) => {
    m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    b.geo(bx, m, c, null, WHITE);
  };
  const A = new THREE.Vector3(), B2 = new THREE.Vector3(), D = new THREE.Vector3(), Yv = new THREE.Vector3(0, 1, 0);
  const rod = (a, c2, r, c) => {
    A.set(a[0], a[1], a[2]); B2.set(c2[0], c2[1], c2[2]);
    D.subVectors(B2, A);
    const len = D.length();
    _q.setFromUnitVectors(Yv, D.normalize());
    m.compose(_p.addVectors(A, B2).multiplyScalar(0.5), _q, _s.set(r, len, r));
    b.geo(cyl, m, c, null, WHITE);
  };
  // asas principais (atrás): duas superfícies com diedro, divididas em 3 células de cada lado
  const span = 5.9, chord = 2.3, gap = 1.9, dih = 0.16, wz = -1.2;
  const yAt = (x) => Math.abs(x) * dih;
  for (const side of [-1, 1]) {
    for (const lvl of [0, 1]) {
      const cx = side * (0.35 + span / 2);
      addB(cx, lvl * gap + yAt(cx), wz, span, 0.05, chord, lvl ? fabric : fabric2, 0, 0, -side * dih);
      // longarina do bordo de ataque
      rod([side * 0.35, lvl * gap + yAt(0.35), wz + chord / 2], [side * (0.35 + span), lvl * gap + yAt(0.35 + span), wz + chord / 2], 0.05, bamboo);
    }
    for (const f of [0, 1 / 3, 2 / 3, 1]) {
      const x = side * (0.35 + f * span);
      addB(x, gap / 2 + yAt(x), wz, 0.04, gap, chord, fabric);
    }
  }
  // fuselagem: treliça de bambu até a caixa-canard
  const zc = 6.6;
  const tail = [[0.28, 0.45], [-0.28, 0.45], [0.28, 1.45], [-0.28, 1.45]];
  const head = [[0.14, 0.75], [-0.14, 0.75], [0.14, 1.15], [-0.14, 1.15]];
  for (let k = 0; k < 4; k++) rod([tail[k][0], tail[k][1], -2.2], [head[k][0], head[k][1], zc - 0.9], 0.045, bamboo);
  for (let t = 0.15; t < 0.95; t += 0.2) {
    const z = lerp(-2.2, zc - 0.9, t);
    const w = lerp(0.28, 0.14, t), y0 = lerp(0.45, 0.75, t), y1 = lerp(1.45, 1.15, t);
    rod([-w, y0, z], [w, y0, z], 0.03, bamboo);
    rod([-w, y1, z], [w, y1, z], 0.03, bamboo);
    rod([w, y0, z], [w, y1, z], 0.03, bamboo);
    rod([-w, y0, z], [-w, y1, z], 0.03, bamboo);
  }
  // pano cobrindo a parte da frente da fuselagem
  addB(0, 0.95, 3.6, 0.3, 0.42, 3.4, fabric2);
  // caixa-canard (pipa de caixa)
  const cw = 1.0, ch = 0.8, cd = 0.85;
  addB(0, 0.95 + ch, zc, cw * 2, 0.04, cd * 2, fabric);
  addB(0, 0.95 - ch, zc, cw * 2, 0.04, cd * 2, fabric);
  addB(-cw, 0.95, zc, 0.04, ch * 2, cd * 2, fabric);
  addB(cw, 0.95, zc, 0.04, ch * 2, cd * 2, fabric);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) rod([sx * cw, 0.95 + sy * ch, zc - cd], [sx * cw, 0.95 + sy * ch, zc + cd], 0.03, bamboo);
  // motor, hélice atrás; cesto do piloto à frente das asas
  addB(0, 1.0, -2.4, 0.6, 0.55, 0.8, dark);
  addB(0, 1.0, -2.0, 0.35, 0.3, 0.25, metal);
  addB(0, 0.45, 0.4, 0.75, 0.6, 0.75, bamboo);
  m.compose(_p.set(0, 1.12, 0.4), _q.identity(), _s.set(0.22, 0.24, 0.22));
  b.geo(new THREE.SphereGeometry(1, 8, 6), m, col(0xe8b98f), null, WHITE);
  addB(0, 0.82, 0.4, 0.34, 0.45, 0.24, col(0x2e3a4f));
  addB(0, 1.3, 0.4, 0.46, 0.05, 0.46, col(0xf1e3b8));
  addB(0, 1.4, 0.4, 0.28, 0.16, 0.28, col(0xf1e3b8));
  addB(0, 1.34, 0.4, 0.3, 0.04, 0.3, col(0x3a2a1a));
  // trem de pouso
  for (const side of [-1, 1]) {
    rod([side * 0.7, -0.35, -0.7], [side * 0.5, 0.02, -1.0], 0.04, metal);
    rod([side * 0.7, -0.35, -0.7], [side * 0.4, 0.02, -0.2], 0.04, metal);
    m.compose(_p.set(side * 0.72, -0.4, -0.7), _q.setFromEuler(_e.set(0, 0, Math.PI / 2)), _s.set(0.34, 0.08, 0.34));
    b.geo(cyl, m, dark, null, WHITE);
  }
  // escoras entre as asas
  for (const side of [-1, 1]) for (const f of [1 / 3, 2 / 3]) {
    const x = side * (0.35 + f * span);
    rod([x, yAt(x), wz - chord / 2 + 0.1], [x, gap + yAt(x), wz + chord / 2 - 0.1], 0.025, bamboo);
  }
  const geo = b.build();
  const group = new THREE.Group();
  group.name = '14-bis';
  const body = new THREE.Mesh(geo, material);
  body.castShadow = true;
  group.add(body);
  // hélice (duas pás) atrás do motor
  const pb = new Builder();
  m.compose(_p.set(0, 0, 0), _q.identity(), _s.set(2.5, 0.2, 0.05));
  pb.geo(bx, m, col(0x8b4a22), null, WHITE);
  m.compose(_p.set(0, 0, 0), _q.setFromEuler(_e.set(Math.PI / 2, 0, 0)), _s.set(0.14, 0.2, 0.14));
  pb.geo(cyl, m, dark, null, WHITE);
  const pgeo = pb.build();
  const prop = new THREE.Mesh(pgeo, material);
  prop.position.set(0, 1.0, -2.9);
  group.add(prop);
  group.scale.setScalar(1.25);
  const disposables = [geo, pgeo, bx, cyl];
  return { group, prop, disposables };
}
