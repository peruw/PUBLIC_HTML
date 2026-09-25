// Corrida Quanta — camada 2D de efeitos em tela: chamas de pixel no placar/combo, fogos de artifício,
// confete, faíscas, moedas que voam até o placar e bordas da tela pegando fogo (FEVER).
// Um único <canvas> em baixa resolução (pixels grandes), acima do HUD e abaixo dos menus.
// O requestAnimationFrame só roda enquanto há algo vivo na tela (parado = custo zero).
(() => {
  'use strict';
  window.QC = window.QC || {};

  const TAU = Math.PI * 2;
  const MAX_PARTS = 900;
  const SOFT_PARTS = 620;     // enfeites (brasas, rastros) param aqui: sobra espaço para as explosões
  const MAX_CONF = 320;
  const MAX_COINS = 120;
  const MAX_ROCKETS = 24;     // no ar + na fila
  const MAX_WAVES = 36;
  const MAX_FLAMES = 24;
  const STEP = 1 / 60;        // passo fixo do fogo em grade
  const RM = 0.4;             // quantidade com movimento reduzido
  const K_CONF = 1, K_EMBER = 2, K_CRACK = 3;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const ease3 = (k) => 1 - (1 - k) * (1 - k) * (1 - k);
  // ruído barato (0..1) para as línguas de fogo
  const wave = (x, t) => 0.5 + 0.3 * Math.sin(x * 0.61 + t * 6.3) + 0.2 * Math.sin(x * 0.23 - t * 3.7 + 1.3);
  const wave2 = (x, t) => 0.5 + 0.32 * Math.sin(x * 0.083 + t * 1.9) + 0.18 * Math.sin(x * 0.21 - t * 3.3);

  // ---------- cores ----------
  const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  let probe = null;
  const rgbCache = new Map();
  function rgbOf(color) {
    const key = String(color);
    let v = rgbCache.get(key);
    if (v) return v;
    if (!probe) probe = document.createElement('canvas').getContext('2d');
    probe.fillStyle = '#000';
    probe.fillStyle = key;
    const s = probe.fillStyle;
    if (s[0] === '#') v = [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    else { const m = s.match(/[\d.]+/g) || [0, 0, 0]; v = [+m[0], +m[1], +m[2]]; }
    rgbCache.set(key, v);
    return v;
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const byte = (v) => clamp(Math.round(v), 0, 255);
  const hex = (c) => '#' + ((1 << 24) | (byte(c[0]) << 16) | (byte(c[1]) << 8) | byte(c[2])).toString(16).slice(1);
  const rgba = (c, a) => 'rgba(' + byte(c[0]) + ',' + byte(c[1]) + ',' + byte(c[2]) + ',' + a + ')';

  // rampa de partícula: branco quente -> cor -> escuro
  const rampCache = new Map();
  function ramp(color) {
    const key = String(color);
    let r = rampCache.get(key);
    if (r) return r;
    const c = rgbOf(key);
    r = [mix(c, WHITE, 0.85), mix(c, WHITE, 0.55), mix(c, WHITE, 0.25), c, c, mix(c, BLACK, 0.22), mix(c, BLACK, 0.42), mix(c, BLACK, 0.6)].map(hex);
    r.glow = rgba(c, 0.38);
    rampCache.set(key, r);
    return r;
  }
  // rampa de chama colorida (partículas)
  const fireRampCache = new Map();
  function fireRamp(color) {
    const key = String(color);
    let r = fireRampCache.get(key);
    if (r) return r;
    const c = rgbOf(key);
    r = [WHITE, mix(c, WHITE, 0.7), mix(c, WHITE, 0.45), mix(c, WHITE, 0.2), c, mix(c, BLACK, 0.2), mix(c, BLACK, 0.4), mix(c, BLACK, 0.58)].map(hex)
      .concat([rgba(mix(c, BLACK, 0.7), 0.5), rgba(mix(c, BLACK, 0.8), 0.28)]);
    r.glow = rgba(c, 0.22);
    fireRampCache.set(key, r);
    return r;
  }
  const FIRE_R = ['#ffffff', '#fff6c8', '#ffe066', '#ffc233', '#ff9a1f', '#ff6a14', '#e8401a', '#b82a12', '#7a1c10', 'rgba(70,40,36,0.55)', 'rgba(46,32,32,0.3)'];
  FIRE_R.glow = 'rgba(255,120,30,0.35)';
  const EMBER_R = ['#fff6c8', '#ffe066', '#ffc233', '#ff9a1f', '#ff6a14', '#e8401a', '#b82a12'];
  EMBER_R.glow = 'rgba(255,150,40,0.4)';
  const SMOKE_R = ['#8a7a70', '#6e5f58', '#56494a', '#443a3c', 'rgba(52,44,46,0.7)', 'rgba(40,34,36,0.45)'];
  SMOKE_R.glow = 'rgba(0,0,0,0)';
  const FLASH_R = ['#ffffff', '#ffffff', '#fff6c8', '#ffe066'];
  FLASH_R.glow = 'rgba(255,255,220,0.4)';

  const FW_COLORS = ['#ffd23f', '#1fd685', '#4fc3ff', '#c07bff', '#ff4d5e', '#ffb238', '#7dffc0', '#ff7ad0'];
  const FW_TYPES = ['peony', 'peony', 'ring', 'ring', 'double', 'willow', 'crackle'];
  const CONF_COLORS = ['#1fd685', '#ffd23f', '#ff4d5e', '#4fc3ff', '#c07bff', '#ffb238', '#ff7ad0', '#ffffff'];

  // paleta do fogo em grade (faixas, estilo pixel art): [calor < limite, r, g, b, a]
  const FIRE_STOPS = [
    [14, 0, 0, 0, 0],
    [32, 44, 24, 22, 90],
    [52, 100, 26, 16, 185],
    [76, 176, 30, 16, 255],
    [102, 226, 64, 26, 255],
    [130, 255, 106, 20, 255],
    [160, 255, 154, 31, 255],
    [190, 255, 194, 51, 255],
    [215, 255, 224, 102, 255],
    [238, 255, 246, 200, 255],
    [256, 255, 255, 255, 255],
  ];
  const pack = (r, g, b, a) => (LE ? ((a << 24) | (b << 16) | (g << 8) | r) : ((r << 24) | (g << 16) | (b << 8) | a)) >>> 0;
  function lutFrom(stops) {
    const lut = new Uint32Array(256);
    let j = 0;
    for (let h = 0; h < 256; h++) {
      while (h >= stops[j][0]) j++;
      const s = stops[j];
      lut[h] = s[4] ? pack(s[1], s[2], s[3], s[4]) : 0;
    }
    return lut;
  }
  const FIRE_LUT = lutFrom(FIRE_STOPS);
  const lutCache = new Map();
  function lutFor(color) {
    if (!color) return FIRE_LUT;
    const key = String(color);
    let l = lutCache.get(key);
    if (l) return l;
    const c = rgbOf(key);
    const d = (t) => mix(c, BLACK, t), w = (t) => mix(c, WHITE, t);
    const cols = [BLACK, d(0.75), d(0.55), d(0.35), d(0.15), c, c, w(0.2), w(0.4), w(0.7), WHITE];
    l = lutFrom(FIRE_STOPS.map((s, i) => [s[0], byte(cols[i][0]), byte(cols[i][1]), byte(cols[i][2]), s[4]]));
    lutCache.set(key, l);
    return l;
  }

  // ---------- fogo em grade (estilo "Doom fire") ----------
  // mode 'up': fonte na última linha, sobe. 'left'/'right': grade transposta (fonte na borda lateral da tela).
  function Grid(w, h, mode) {
    this.w = w; this.h = h; this.mode = mode || 'up';
    this.heat = new Uint8ClampedArray(w * h);
    this.src = new Float32Array(w);
    this.seed = ((Math.random() * 0x7fffffff) | 0) || 1;
    this.hot = 0;
    this.top = 0;   // linhas acima desta estão apagadas (pula no passo e no desenho)
    this.mx0 = this.mx1 = this.my0 = this.my1 = 0; // máscara: nunca pinta por cima do elemento
    const cv = document.createElement('canvas');
    const up = this.mode === 'up';
    cv.width = up ? w : h; cv.height = up ? h : w;
    this.cv = cv;
    this.cx = cv.getContext('2d');
    this.img = this.cx.createImageData(cv.width, cv.height);
    this.px = new Uint32Array(this.img.data.buffer);
  }
  Grid.prototype.step = function (decay, lean) {
    const w = this.w, h = this.h, heat = this.heat, src = this.src;
    const base = (h - 1) * w;
    for (let x = 0; x < w; x++) heat[base + x] = src[x];
    const dk = (decay * 2) / 65536;
    const tl = (85 + lean * 256) | 0, tr = tl + ((85 - lean * 256) | 0);
    const y0 = Math.max(1, this.top);
    let s = this.seed, hot = 0, top = h - 1;
    for (let y = y0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const v = heat[i];
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        if (v === 0) { heat[i - w] = 0; continue; }
        const r = s & 255;
        const nx = r < tl ? x - 1 : r < tr ? x + 1 : x;
        if (nx < 0 || nx >= w) continue;
        const nv = v - ((((s >>> 8) & 65535) * dk) | 0);
        heat[i - w + nx - x] = nv;
        if (nv > 0) { hot += nv; if (y <= top) top = y - 1; }
      }
    }
    // apaga restos acima do novo topo (mantém a invariante)
    if (top > y0 - 1) heat.fill(0, (y0 - 1) * w, top * w);
    this.seed = s || 1;
    this.hot = hot;
    this.top = top;
  };
  Grid.prototype.render = function (lut) {
    const w = this.w, h = this.h, heat = this.heat, px = this.px, top = this.top;
    if (this.mode === 'up') {
      px.fill(0, 0, top * w);
      for (let i = top * w, n = w * h; i < n; i++) px[i] = lut[heat[i]];
      const x0 = Math.max(0, this.mx0), x1 = Math.min(w, this.mx1);
      const y0 = Math.max(0, this.my0), y1 = Math.min(h, this.my1);
      if (x1 > x0) for (let y = y0; y < y1; y++) px.fill(0, y * w + x0, y * w + x1);
    } else if (this.mode === 'left') {
      px.fill(0);
      for (let y = top; y < h; y++) {
        const row = y * w, col = h - 1 - y;
        for (let x = 0; x < w; x++) px[x * h + col] = lut[heat[row + x]];
      }
    } else {
      px.fill(0);
      for (let y = top; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) px[x * h + y] = lut[heat[row + x]];
      }
    }
    this.cx.putImageData(this.img, 0, 0);
  };
  // nova grade reaproveitando o calor da anterior (o elemento pode pulsar/escalar)
  function regrid(old, w, h, mode) {
    const g = new Grid(w, h, mode);
    if (old && old.mode === g.mode) {
      const ow = old.w, oh = old.h, dy = h - oh;
      for (let y = 0; y < h; y++) {
        const oy = y - dy;
        if (oy < 0 || oy >= oh) continue;
        for (let x = 0; x < w; x++) g.heat[y * w + x] = old.heat[oy * ow + ((x * ow / w) | 0)];
      }
      g.seed = old.seed;
      g.hot = old.hot;
    }
    return g;
  }

  function create() {
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.className = 'qc-fx2d';
    cv.style.cssText = 'position:fixed;inset:0;display:block;pointer-events:none;z-index:4;visibility:hidden;';
    cv.style.imageRendering = 'pixelated';
    if (cv.style.imageRendering !== 'pixelated') cv.style.imageRendering = 'crisp-edges';
    // primeiro filho do body: com z-index igual (4, ex.: toasts) o resto da página fica por cima
    const host = document.body || document.documentElement;
    host.insertBefore(cv, host.firstChild);
    const ctx = cv.getContext('2d');

    let S = 3, W = 1, H = 1, cssW = 0, cssH = 0, dpr = 0, sized = false;
    let raf = 0, last = 0, clock = 0, fireAcc = 0, frames = 0, parity = 0;
    let dead = false, shown = false, q = 1, workEma = 0, updEma = 0, drawEma = 0;
    let queued = 0, conf = 0, awake = 0, pollT = 0;
    const due = [];   // callbacks de chegada: rodam no fim do quadro (podem chamar a API)
    const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reduced = !!(mq && mq.matches);
    const onMq = () => { reduced = !!mq.matches; };
    if (mq) { if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq); }

    const parts = [], pool = [], rockets = [], coins = [], waves = [], sched = [];
    const flames = new Map();
    const edge = { target: 0, cur: 0, color: null, lut: FIRE_LUT, rgb: [255, 96, 24], er: EMBER_R, acc: 0, pulse: 1, bottom: null, left: null, right: null };
    const rects = new Map();
    const main = new Map(), glow = new Map();

    // ---------- tela ----------
    function measure() {
      const de = document.documentElement;
      const vw = window.innerWidth || de.clientWidth || 1;
      const vh = window.innerHeight || de.clientHeight || 1;
      const r = window.devicePixelRatio || 1;
      if (vw === cssW && vh === cssH && r === dpr) return;
      const oldS = S;
      cssW = vw; cssH = vh; dpr = r;
      // 3 px por pixel no desktop, 2 em telas pequenas; múltiplo inteiro de pixels do aparelho
      const base = Math.min(vw, vh) < 560 ? 2 : 3;
      S = Math.max(1, Math.round(base * r)) / r;
      W = Math.max(1, Math.ceil(vw / S)); H = Math.max(1, Math.ceil(vh / S));
      cv.width = W; cv.height = H;
      cv.style.width = W * S + 'px'; cv.style.height = H * S + 'px';
      ctx.imageSmoothingEnabled = false;
      if (sized && oldS !== S) rescale(oldS / S);
      sized = true;
      edge.bottom = edge.left = edge.right = null;
      flames.forEach((f) => { f.grid = null; });
    }
    function rescale(k) {
      for (const p of parts) { p.x *= k; p.y *= k; p.vx *= k; p.vy *= k; p.g *= k; }
      for (const r of rockets) { r.sx *= k; r.sy *= k; r.tx *= k; r.ty *= k; r.x *= k; r.y *= k; }
      for (const w of waves) { w.x *= k; w.y *= k; w.r0 *= k; w.r1 *= k; }
      for (const c of coins) {
        c.sx *= k; c.sy *= k; c.bx *= k; c.by *= k; c.ox *= k; c.oy *= k; c.x *= k; c.y *= k; c.tx *= k; c.ty *= k;
        for (let i = 0; i < c.tr.length; i++) c.tr[i] *= k;
      }
    }
    function rectOf(el) {
      let r = rects.get(el);
      if (!r) { r = el.getBoundingClientRect(); rects.set(el, r); }
      return r;
    }

    // ---------- desenho em lotes por cor ----------
    function put(map, c, x, y, w, h) {
      let b = map.get(c);
      if (!b) { b = []; map.set(c, b); }
      b.push(x, y, w, h);
    }
    // brilho em cruz: vira uma estrelinha de pixel, em vez de um quadrado borrado
    function halo(c, x, y, s, arm) {
      put(glow, c, x - arm, y, s + arm * 2, s);
      put(glow, c, x, y - arm, s, s + arm * 2);
    }
    function flush(map) {
      for (const [c, b] of map) {
        if (!b.length) continue;
        ctx.fillStyle = c;
        for (let i = 0; i < b.length; i += 4) ctx.fillRect(b[i], b[i + 1], b[i + 2], b[i + 3]);
        b.length = 0;
      }
    }

    // ---------- partículas ----------
    const mult = () => q * (reduced ? RM : 1);
    const amount = (n) => Math.max(0, Math.min(MAX_PARTS - parts.length, Math.round(n * mult())));
    // lo = enfeite (brasa, rastro, lambida): cede lugar às explosões quando a tela enche
    function spawn(x, y, vx, vy, life, rp, lo) {
      if (parts.length >= (lo ? SOFT_PARTS : MAX_PARTS)) return null;
      const p = pool.pop() || {};
      p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.ramp = rp;
      p.age = 0; p.g = 0; p.drag = 0; p.size = 1; p.shrink = false; p.c0 = 0; p.tw = false; p.trail = 0; p.glow = 0;
      p.kind = 0; p.a = 0; p.b = 0; p.c = 0; p.d = 0; p.ph = 0; p.done = false;
      parts.push(p);
      return p;
    }
    function spark(x, y, vx, vy, rp) {
      const p = spawn(x, y, vx, vy, rand(0.9, 1.4), rp);
      if (!p) return null;
      p.g = 30; p.drag = 1.7; p.tw = true; p.trail = 2; p.glow = 0.45; p.shrink = true;
      p.size = Math.random() < 0.4 ? 2 : 1;
      return p;
    }
    // esfera 3D projetada: concentra faíscas na borda, parece um fogo de verdade
    function sphere(x, y, spd, rp) {
      const u = Math.random() * 2 - 1, a = Math.random() * TAU, rr = Math.sqrt(1 - u * u);
      return spark(x, y, Math.cos(a) * rr * spd, Math.sin(a) * rr * spd, rp);
    }
    function crackle(p) {
      const n = 2 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const c = spawn(p.x, p.y, rand(-45, 45), rand(-45, 45), rand(0.1, 0.2), FLASH_R, true);
        if (c) { c.drag = 3; c.glow = 1; }
      }
    }
    // anéis demais custam caro (varredura por linha): o mais velho sai
    function mkWave(x, y, r0, r1, th, life, rp, delay) {
      if (waves.length >= MAX_WAVES) waves.shift();
      waves.push({ x, y, r0, r1, th, life, rp, age: -(delay || 0), star: false });
    }
    // brilho em cruz no centro de uma explosão (encolhe)
    function mkStar(x, y, len, life, rp) {
      if (waves.length >= MAX_WAVES) waves.shift();
      waves.push({ x, y, r0: len, r1: 0, th: 0, life, rp, age: 0, star: true });
    }
    function ember(x, y, vx, vy, life, rp) {
      const p = spawn(x, y, vx, vy, life, rp, true);
      if (p) { p.kind = K_EMBER; p.a = rand(8, 20); p.b = rand(4, 9); p.ph = rand(0, TAU); p.tw = true; p.g = -10; p.size = Math.random() < 0.25 ? 2 : 1; p.shrink = true; }
      return p;
    }

    function updParts(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        let gone = p.age >= p.life;
        if (!gone) {
          if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; }
          p.vy += p.g * dt;
          let vx = p.vx;
          if (p.kind === K_CONF) {
            p.vx *= Math.exp(-0.8 * dt);
            p.vy += (p.b - p.vy) * Math.min(1, dt * 1.5);
            vx += Math.sin(p.age * p.a + p.ph) * p.c;
          } else if (p.kind === K_EMBER) {
            vx += Math.sin(p.age * p.b + p.ph) * p.a;
          } else if (p.kind === K_CRACK && !p.done && p.age > p.life * 0.6) {
            p.done = true; crackle(p); p.life = p.age + 0.04;
          }
          p.x += vx * dt; p.y += p.vy * dt;
          if (p.y > H + 6 || (p.y < -4 && p.vy < 0) || p.x < -12 || p.x > W + 12) gone = true;
        }
        if (gone) {
          if (p.kind === K_CONF) conf--;
          const lp = parts.pop();
          if (lp !== p) parts[i] = lp;
          pool.push(p);
        }
      }
    }
    function drawParts() {
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i], rp = p.ramp, n = rp.length;
        const k = p.age / p.life;
        if (p.tw && k > 0.45 && Math.random() < k - 0.3) continue;
        if (p.kind === K_CONF) { drawConf(p, k); continue; }
        let ci = p.c0 + ((k * (n - p.c0)) | 0);
        if (ci >= n) ci = n - 1;
        let s = p.size;
        if (p.shrink && s > 1) s = Math.max(1, Math.round(s * (1 - k) + 0.5));
        const x = Math.round(p.x - s * 0.5), y = Math.round(p.y - s * 0.5);
        if (p.glow && k < p.glow) halo(rp.glow, x, y, s, s > 1 ? 2 : 1);
        if (p.trail) {
          const tx = Math.round(p.x - p.vx * 0.03), ty = Math.round(p.y - p.vy * 0.03);
          if (tx !== x || ty !== y) put(main, rp[Math.min(n - 1, ci + 2)], tx, ty, 1, 1);
          if (p.trail > 1) {
            const ux = Math.round(p.x - p.vx * 0.06), uy = Math.round(p.y - p.vy * 0.06);
            if (ux !== tx || uy !== ty) put(main, rp[Math.min(n - 1, ci + 4)], ux, uy, 1, 1);
          }
        }
        put(main, rp[ci], x, y, s, s);
      }
    }
    // confete "girando": alterna formato e frente/verso
    function drawConf(p, k) {
      if (k > 0.85 && Math.random() < 0.5) return;
      const rp = p.ramp;
      const f = (((p.age * p.d + p.ph) / TAU) * 4) & 3;
      const x = Math.round(p.x), y = Math.round(p.y);
      if (f === 0) put(main, rp[3], x - 1, y, 3, 2);
      else if (f === 1) put(main, rp[2], x - 1, y, 3, 1);
      else if (f === 2) put(main, rp[5], x, y - 1, 2, 3);
      else put(main, rp[6], x, y - 1, 1, 3);
    }

    // ---------- ondas (anéis de pixel) ----------
    function updWaves(dt) {
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i];
        w.age += dt;
        if (w.age >= w.life) waves.splice(i, 1);
      }
    }
    function drawWaves() {
      for (let j = 0; j < waves.length; j++) {
        const w = waves[j];
        if (w.age < 0) continue;
        const k = w.age / w.life, rp = w.rp, n = rp.length;
        const R = Math.round(w.r0 + (w.r1 - w.r0) * ease3(k));
        const c = rp[Math.min(n - 1, (k * n) | 0)];
        if (w.star) {
          const cx = Math.round(w.x), cy = Math.round(w.y), L = Math.round(w.r0 * (1 - k));
          put(main, c, cx - L, cy, L * 2 + 1, 1);
          put(main, c, cx, cy - L, 1, L * 2 + 1);
          const d = Math.round(L * 0.45);
          if (d > 1) for (let i = 1; i <= d; i += 2) {
            put(main, c, cx - i, cy - i, 1, 1); put(main, c, cx + i, cy - i, 1, 1);
            put(main, c, cx - i, cy + i, 1, 1); put(main, c, cx + i, cy + i, 1, 1);
          }
          continue;
        }
        const th = w.th ? Math.max(1, Math.round(w.th * (1 - k * 0.5))) : 0;
        const ri = th ? R - th : -1;
        const dither = w.th && k > 0.6;
        const cx = Math.round(w.x), cy = Math.round(w.y);
        for (let dy = -R; dy <= R; dy++) {
          if (dither && ((dy + parity) & 1)) continue;
          const q2 = R * R + R - dy * dy;
          if (q2 < 0) continue;
          const xo = Math.floor(Math.sqrt(q2));
          const qi = ri >= 0 ? ri * ri + ri - dy * dy : -1;
          if (qi < 0) put(main, c, cx - xo, cy + dy, xo * 2 + 1, 1);
          else {
            const xi = Math.floor(Math.sqrt(qi)) + 1;
            if (xi <= xo) {
              put(main, c, cx - xo, cy + dy, xo - xi + 1, 1);
              put(main, c, cx + xi, cy + dy, xo - xi + 1, 1);
            }
          }
        }
      }
    }

    // ---------- fogos de artifício ----------
    function launch(tx, ty, cA, cB, type) {
      rockets.push({
        sx: tx + rand(-0.08, 0.08) * W, sy: H + 2, tx, ty, x: tx, y: H + 2,
        t: 0, dur: rand(0.32, 0.46), ph: rand(0, TAU), acc: 0, cA, cB, type,
      });
    }
    function updRockets(dt) {
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.t += dt / r.dur;
        const k = Math.min(1, r.t);
        r.x = r.sx + (r.tx - r.sx) * k + Math.sin(k * 9 + r.ph) * 1.2;
        r.y = r.sy + (r.ty - r.sy) * (1 - Math.pow(1 - k, 2.2));
        r.acc += dt * 110 * mult();
        while (r.acc >= 1) {
          r.acc--;
          const p = spawn(r.x + rand(-0.5, 0.5), r.y + rand(0, 2), rand(-7, 7), rand(8, 30), rand(0.2, 0.45), EMBER_R, true);
          if (p) { p.g = 30; p.tw = true; }
        }
        if (r.t >= 1) { rockets.splice(i, 1); explode(r); }
      }
    }
    function drawRockets() {
      for (const r of rockets) {
        const x = Math.round(r.x), y = Math.round(r.y);
        halo(EMBER_R.glow, x, y, 1, 2);
        put(main, '#ffffff', x, y, 1, 2);
      }
    }
    function explode(r) {
      const x = r.x, y = r.y, A = ramp(r.cA), B = ramp(r.cB);
      const spd = clamp(Math.min(W, H) * 0.5, 70, 170) * rand(0.85, 1.15);
      const n = amount(70 + W * 0.08);
      mkWave(x, y, 1, 4, 0, 0.12, FLASH_R);
      mkStar(x, y, 14, 0.26, FLASH_R);
      mkWave(x, y, 2, spd * 0.42, 1, 0.3, A);
      if (r.type === 'ring') {
        const tilt = rand(0, TAU), sq = rand(0.35, 1), ct = Math.cos(tilt), st = Math.sin(tilt);
        const m = Math.max(8, (n * 0.7) | 0);
        for (let i = 0; i < m; i++) {
          const a = (i / m) * TAU, ax = Math.cos(a) * spd, ay = Math.sin(a) * spd * sq, j = rand(0.97, 1.03);
          spark(x, y, (ax * ct - ay * st) * j, (ax * st + ay * ct) * j, A);
        }
        for (let i = m; i < n; i++) sphere(x, y, spd * 0.35, B);
      } else if (r.type === 'double') {
        for (let i = 0; i < n; i++) sphere(x, y, i < n * 0.6 ? spd : spd * 0.5, i < n * 0.6 ? A : B);
      } else if (r.type === 'willow') {
        for (let i = 0; i < n; i++) {
          const p = sphere(x, y, spd * 0.9, i & 3 ? A : EMBER_R);
          if (p) { p.life = rand(1.5, 2.2); p.drag = 1.5; p.g = 16; }
        }
      } else if (r.type === 'crackle') {
        for (let i = 0; i < n; i++) {
          const p = sphere(x, y, spd, i & 1 ? A : B);
          if (p && Math.random() < 0.5) p.kind = K_CRACK;
        }
      } else {
        for (let i = 0; i < n; i++) sphere(x, y, spd, Math.random() < 0.2 ? B : A);
      }
    }

    // ---------- moedas voando até o placar ----------
    function aim(c) {
      const el = c.el;
      if (el && el.getBoundingClientRect) {
        if (el.isConnected) {
          const r = rectOf(el);
          c.tx = (r.left + r.width / 2) / S; c.ty = (r.top + r.height / 2) / S;
        }
      } else if (el && typeof el.x === 'number') {
        c.tx = el.x / S; c.ty = el.y / S;
      }
    }
    function arrive(grp) {
      if (grp.fired) return;
      grp.fired = true;
      if (grp.cb) due.push(grp.cb);
    }
    // fora dos laços de atualização: o callback pode chamar clear()/fly()/destroy() à vontade
    function runDue() {
      const list = due.splice(0);
      for (const cb of list) {
        try { cb(); } catch (e) { setTimeout(() => { throw e; }); }
      }
    }
    function updCoins(dt) {
      for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        c.t += dt;
        const u = (c.t - c.delay) / c.dur;
        if (u < 0) continue;
        aim(c);
        if (u >= 1) {
          coins.splice(i, 1);
          // brilho curtinho: não pode esconder os dígitos do placar
          mkStar(c.tx, c.ty, 4, 0.12, FLASH_R);
          for (let j = 0; j < 4; j++) {
            const a = rand(0, TAU), v = rand(25, 60);
            const p = spawn(c.tx, c.ty, Math.cos(a) * v, Math.sin(a) * v, rand(0.18, 0.32), c.rp);
            if (p) { p.drag = 4; p.glow = 1; }
          }
          arrive(c.grp);
          continue;
        }
        // bezier cúbica: estoura para fora e é sugada para o alvo, acelerando
        const e = 0.3 * u + 0.7 * u * u, v = 1 - e;
        const a0 = v * v * v, a1 = 3 * v * v * e, a2 = 3 * v * e * e, a3 = e * e * e;
        const tr = c.tr;
        tr[4] = tr[2]; tr[5] = tr[3]; tr[2] = tr[0]; tr[3] = tr[1]; tr[0] = c.x; tr[1] = c.y;
        c.x = a0 * c.sx + a1 * c.bx + a2 * (c.tx + c.ox) + a3 * c.tx;
        c.y = a0 * c.sy + a1 * c.by + a2 * (c.ty + c.oy) + a3 * c.ty;
      }
    }
    function drawCoins() {
      for (let i = 0; i < coins.length; i++) {
        const c = coins[i];
        if (c.t < c.delay) continue;
        const rp = c.rp, tr = c.tr;
        const x = Math.round(c.x), y = Math.round(c.y);
        put(main, rp[6], Math.round(tr[4]), Math.round(tr[5]), 1, 1);
        put(main, rp[4], Math.round(tr[2]), Math.round(tr[3]), 1, 1);
        put(main, rp[2], Math.round(tr[0]), Math.round(tr[1]), 1, 1);
        halo(rp.glow, x, y, 1, 3);
        if (Math.cos(c.t * 16 + c.spin) > -0.35) {
          put(main, rp[3], x - 1, y, 3, 1);
          put(main, rp[3], x, y - 1, 1, 3);
          put(main, rp[0], x, y, 1, 1);
        } else {
          put(main, rp[5], x, y - 1, 1, 3);
        }
      }
    }

    // ---------- chamas em elementos do DOM ----------
    function updFlame(f, dt, steps) {
      const el = f.el;
      if (!el.isConnected) { flames.delete(el); return; }
      // acende rápido; apaga mais rápido ainda (errou = o fogo morre em ~0,5 s)
      if (f.target >= f.cur) f.cur += (f.target - f.cur) * Math.min(1, dt * 7);
      else f.cur = Math.max(f.target, f.cur - dt * (1 + (f.cur - f.target) * 2.5));
      if (f.target === 0 && f.cur < 0.02) f.cur = 0;
      const r = rectOf(el);
      const ok = visible(r);
      const I = ok ? f.cur : 0;
      const ew = Math.max(2, Math.round(r.width / S)), eh = Math.max(1, Math.round(r.height / S));
      const ex = Math.round(r.left / S), ey = Math.round(r.top / S);
      // número estreito e alto (um dígito) também ganha chama visível
      const maxH = Math.round(clamp(Math.max(ew * 0.8, eh * 1.1) + 8, 12, Math.max(12, Math.min(54, H * 0.32))));
      const pad = clamp(Math.round(ew * 0.15), 3, 10);
      const gw = ew + pad * 2, gh = Math.ceil(maxH * 1.3) + 2;
      if (!f.grid || f.grid.w !== gw || f.grid.h !== gh) f.grid = regrid(f.grid, gw, gh, 'up');
      const g = f.grid;
      // sem espaço acima (ex.: placar colado no topo) a fonte desce e o fogo sai "de trás" do elemento
      const off = clamp(Math.round(maxH * 0.7 - ey), 0, eh);
      f.gx = ex - pad; f.gy = ey + off - (gh - 1);
      // máscara = área do conteúdo (+1 px de folga): a moldura da caixa pode queimar, o texto nunca
      const ins = f.ins, mi = (k, n) => (ins ? Math.max(0, Math.round(ins[k] * n) - 1) : 0);
      g.mx0 = pad + mi(3, ew); g.mx1 = pad + ew - mi(1, ew);
      g.my0 = ey - f.gy + mi(0, eh); g.my1 = ey + eh - f.gy - mi(2, eh);
      f.mx = f.gx + g.mx0; f.my = f.gy + g.my0; f.mw = g.mx1 - g.mx0; f.mh = g.my1 - g.my0;
      f.ex = ex; f.ey = ey; f.ew = ew; f.eh = eh; f.I = I;
      const tH = Math.max(3, maxH * (0.2 + 0.8 * Math.pow(I, 1.15)));
      if (steps) {
        const hm = I > 0.004 ? 255 * (0.74 + 0.26 * I) : 0;
        const src = g.src;
        // línguas: picos que andam de um lado para o outro (~3 no placar)
        const k1 = TAU / (8 + ew * 0.3), k2 = k1 * 2.3, t = clock + f.sx;
        for (let x = 0; x < gw; x++) {
          const ix = x - pad;
          let tp = 1;
          if (ix < 0 || ix >= ew) { const d = ix < 0 ? -ix : ix - ew + 1; tp = 1 - d / (pad + 1); tp = tp > 0 ? tp * tp : 0; }
          const nz = 0.64 + 0.28 * Math.sin(x * k1 + t * 4.2) + 0.2 * Math.sin(x * k2 - t * 6.1);
          let lv = tp * clamp(nz, 0.3, 1);
          if (Math.random() < 0.06) lv *= 0.3;
          src[x] = hm * lv;
        }
        // sem fonte o calor ainda precisa decair, senão o resto do fogo sobe inteiro como uma faixa
        const dec = (hm || 190) / (tH + off * 0.9), lean = 0.07 * Math.sin(t * 1.7);
        for (let s = 0; s < steps; s++) g.step(dec, lean);
        g.render(f.lut);
      }
      if (I <= 0.01) {
        if (f.target === 0 && (f.cur === 0 || !ok) && !g.hot) flames.delete(el);
        else if (ok || g.hot) awake++;
        // elemento escondido/fora da tela e fogo já frio: dormente (não segura o laço)
        return;
      }
      awake++;
      const m = mult();
      // brasas soltas (fora do retângulo do elemento)
      f.ea += dt * (4 + 22 * I * I) * Math.sqrt(ew / 30) * m;
      while (f.ea >= 1) {
        f.ea--;
        if (off > 0 && Math.random() < 0.65) {
          const sd = Math.random() < 0.5;
          ember(sd ? ex + ew + rand(0, pad) : ex - rand(1, pad), ey + rand(0, eh), (sd ? 1 : -1) * rand(5, 25), -rand(20, 55), rand(0.5, 1), f.er);
        } else {
          ember(ex - pad * 0.5 + rand(0, ew + pad), Math.min(ey - 1, ey + off - rand(0, tH * 0.8)), rand(-10, 10), -rand(30, 70) * (0.6 + 0.4 * I), rand(0.5, 1.1), f.er);
        }
      }
      // lambidas nas laterais
      if (I > 0.2) {
        f.la += dt * (I - 0.2) * 70 * m;
        while (f.la >= 1) {
          f.la--;
          const sd = (f.side ^= 1);
          const lx = sd ? ex + ew + rand(0, 1) : ex - 1 - rand(0, 1);
          const ly = ey + (off > 0 ? rand(0.1, 1) : rand(0, 0.55)) * eh;
          const p = spawn(lx, ly, (sd ? 1 : -1) * rand(0, 7), -rand(25, 55), rand(0.16, 0.34) * (0.7 + 0.5 * I), f.fr, true);
          if (p) { p.size = I > 0.55 ? 2 : 1; p.shrink = true; p.c0 = 1; p.g = -40; p.drag = 1.2; }
        }
      }
    }
    function snuff(f) {
      const n = amount(8 + f.ew * 0.35 * f.I);
      for (let i = 0; i < n; i++) {
        const p = spawn(f.ex + rand(0, f.ew), f.ey - rand(0, 4), rand(-14, 14), -rand(18, 50), rand(0.5, 0.9), SMOKE_R);
        if (!p) break;
        p.size = Math.random() < 0.5 ? 3 : 2; p.shrink = true; p.drag = 2; p.g = -12; p.tw = true;
      }
      for (let i = 0, m = amount(6 + 10 * f.I); i < m; i++) {
        const p = spawn(f.ex + rand(0, f.ew), f.ey, rand(-50, 50), -rand(40, 110), rand(0.35, 0.7), f.er);
        if (!p) break;
        p.g = 90; p.drag = 1.5; p.trail = 1; p.glow = 0.4;
      }
    }
    function drawFlame(f) {
      if (!f.grid) return;
      ctx.drawImage(f.grid.cv, f.gx, f.gy);
      // contorno em brasa: o elemento parece "quente"
      const I = f.I;
      if (I > 0.3 && f.boxy) {
        const a = Math.round(clamp(0.2 + I * (0.35 + (reduced ? 0.2 : 0.35 * Math.random())), 0, 0.9) * 10) / 10;
        if (a > 0) {
          ctx.fillStyle = rgba(f.color ? rgbOf(f.color) : I > 0.7 ? [255, 200, 70] : [255, 140, 30], a);
          const x = f.ex - 1, y = f.ey - 1, w = f.ew + 2, h = f.eh + 2;
          ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1);
          ctx.fillRect(x, y + 1, 1, h - 2); ctx.fillRect(x + w - 1, y + 1, 1, h - 2);
        }
      }
    }

    // ---------- bordas da tela em chamas (FEVER) ----------
    function updEdge(dt, steps) {
      const e = edge;
      if (e.target === 0 && e.cur === 0 && !e.bottom) return;
      if (e.target >= e.cur) e.cur += (e.target - e.cur) * Math.min(1, dt * 3);
      else e.cur = Math.max(e.target, e.cur - dt * (0.8 + (e.cur - e.target) * 2));
      if (e.target === 0 && e.cur < 0.01) e.cur = 0;
      e.pulse = reduced ? 1 : 0.8 + 0.2 * Math.sin(clock * TAU * 2.1);
      if (reduced) { e.bottom = e.left = e.right = null; return; }
      const I = e.cur;
      const bh = Math.ceil(Math.min(H * 0.22, 72)), sd = Math.ceil(Math.min(W * 0.1, 40));
      if (!e.bottom || e.bottom.w !== W || e.bottom.h !== bh) e.bottom = new Grid(W, bh, 'up');
      if (!e.left || e.left.w !== H || e.left.h !== sd) { e.left = new Grid(H, sd, 'left'); e.right = new Grid(H, sd, 'right'); }
      if (steps) {
        const hm = I > 0.004 ? 255 * (0.72 + 0.28 * I) : 0;
        const b = e.bottom.src, l = e.left.src, rr = e.right.src;
        for (let x = 0; x < W; x++) b[x] = hm * (0.4 + 0.6 * wave2(x, clock)) * (Math.random() < 0.05 ? 0.3 : 1);
        for (let x = 0; x < H; x++) {
          const along = 0.22 + 0.78 * Math.pow(x / H, 0.9);
          l[x] = hm * along * (0.5 + 0.5 * wave(x * 0.5 + 7, clock)) * (Math.random() < 0.05 ? 0.3 : 1);
          rr[x] = hm * along * (0.5 + 0.5 * wave(x * 0.5 + 91, clock)) * (Math.random() < 0.05 ? 0.3 : 1);
        }
        const hd = hm || 190;
        const decB = hd / Math.max(3, bh * 0.78 * (0.3 + 0.7 * I) * e.pulse);
        const decS = hd / Math.max(2, sd * 0.72 * (0.3 + 0.7 * I) * e.pulse);
        for (let s = 0; s < steps; s++) { e.bottom.step(decB, 0); e.left.step(decS, 0.14); e.right.step(decS, 0.14); }
        e.bottom.render(e.lut); e.left.render(e.lut); e.right.render(e.lut);
      }
      if (!e.cur && !e.target && !e.bottom.hot && !e.left.hot && !e.right.hot) { e.bottom = e.left = e.right = null; return; }
      // brasas subindo do chão
      e.acc += dt * I * 30 * mult();
      while (e.acc >= 1) {
        e.acc--;
        if (Math.random() < 0.75) ember(rand(0, W), H - rand(0, bh * 0.5 * I), rand(-10, 10), -rand(50, 110), rand(0.8, 1.8), e.er);
        else { const r = Math.random() < 0.5; ember(r ? W - rand(0, sd * 0.5) : rand(0, sd * 0.5), rand(H * 0.3, H), (r ? -1 : 1) * rand(5, 25), -rand(40, 90), rand(0.6, 1.3), e.er); }
      }
    }
    function drawEdge() {
      const e = edge;
      const I = e.cur * e.pulse;
      if (I > 0.01) {
        const c = e.rgb, bw = 2, al = [0.34, 0.22, 0.13, 0.06];
        for (let i = 0; i < 4; i++) {
          const a0 = al[i] * I;
          if (a0 < 0.02) continue;
          ctx.fillStyle = rgba(c, Math.round(a0 * 40) / 40);
          ctx.fillRect(0, H - (i + 1) * bw, W, bw);
          // laterais em degraus: mais forte embaixo
          for (let j = 0; j < 8; j++) {
            const y0 = Math.round((H * j) / 8), y1 = Math.round((H * (j + 1)) / 8);
            ctx.globalAlpha = (j + 1) / 8;
            ctx.fillRect(i * bw, y0, bw, y1 - y0);
            ctx.fillRect(W - (i + 1) * bw, y0, bw, y1 - y0);
          }
          ctx.globalAlpha = 1;
        }
      }
      if (e.bottom) ctx.drawImage(e.bottom.cv, 0, H - e.bottom.h);
      if (e.left) ctx.drawImage(e.left.cv, 0, 0);
      if (e.right) ctx.drawImage(e.right.cv, W - e.right.h, 0);
      return I > 0.01 || !!e.bottom;
    }

    // ---------- laço ----------
    function update(dt) {
      rects.clear();
      for (let i = sched.length - 1; i >= 0; i--) {
        if (sched[i].at <= clock) { const s = sched[i]; sched.splice(i, 1); s.fn(); }
      }
      fireAcc += dt;
      let steps = 0;
      while (fireAcc >= STEP && steps < 3) { fireAcc -= STEP; steps++; }
      if (fireAcc > STEP) fireAcc = STEP;
      updEdge(dt, steps);
      awake = 0;
      flames.forEach((f) => updFlame(f, dt, steps));
      updRockets(dt);
      updCoins(dt);
      updParts(dt);
      updWaves(dt);
    }
    function render() {
      ctx.clearRect(0, 0, W, H);
      if (drawEdge()) {
        // a borda da FEBRE não passa por cima do número/placar em chamas
        flames.forEach((f) => { if (f.I > 0 && f.mw > 0 && f.mh > 0) ctx.clearRect(f.mx, f.my, f.mw, f.mh); });
      }
      flames.forEach(drawFlame);
      drawParts();
      drawWaves();
      drawCoins();
      drawRockets();
      ctx.globalCompositeOperation = 'lighter';
      flush(glow);
      ctx.globalCompositeOperation = 'source-over';
      flush(main);
    }
    function busy() {
      if (parts.length || rockets.length || coins.length || waves.length || sched.length || awake || due.length) return true;
      return edge.target > 0 || edge.cur > 0 || !!edge.bottom;
    }
    function frame(ts) {
      raf = 0;
      if (dead) return;
      const t0 = performance.now();
      let dt = last ? (ts - last) / 1000 : STEP;
      if (!(dt > 0)) dt = STEP; else if (dt > 0.05) dt = 0.05;
      last = ts;
      measure();
      clock += dt; parity ^= 1; frames++;
      update(dt);
      const t1 = performance.now();
      render();
      const t2 = performance.now();
      updEma += (t1 - t0 - updEma) * 0.1;
      drawEma += (t2 - t1 - drawEma) * 0.1;
      // qualidade adaptativa: se o quadro pesar, solta menos partículas
      workEma += (t2 - t0 - workEma) * 0.1;
      if (workEma > 6) q = Math.max(0.35, q - 0.02);
      else if (workEma < 3) q = Math.min(1, q + 0.004);
      if (due.length) runDue();
      // o callback pode ter chamado destroy() ou já religado o laço (wake): nunca dois RAFs
      if (dead || raf) return;
      if (busy()) raf = requestAnimationFrame(frame);
      else sleep();
    }
    function wake() {
      if (dead || raf) return;
      if (pollT) { clearTimeout(pollT); pollT = 0; }
      if (!shown) { cv.style.visibility = 'visible'; shown = true; }
      last = 0;
      raf = requestAnimationFrame(frame);
    }
    function sleep() {
      ctx.clearRect(0, 0, W, H);
      cv.style.visibility = 'hidden';
      shown = false;
      last = 0;
      // só sobrou fogo pedido em elemento escondido: confere de vez em quando, sem RAF
      if (flames.size && !pollT && !dead) pollT = setTimeout(poll, 250);
    }
    function visible(r) {
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < cssH && r.right > 0 && r.left < cssW;
    }
    function poll() {
      pollT = 0;
      if (dead || raf) return;
      measure();
      let any = false;
      for (const [el, f] of [...flames]) {
        if (!el.isConnected || !f.target) flames.delete(el);
        else if (visible(el.getBoundingClientRect())) any = true;
      }
      if (any) wake();
      else if (flames.size) pollT = setTimeout(poll, 250);
    }

    // ---------- API ----------
    function flamesApi(el, intensity, color) {
      if (dead || !el || el.nodeType !== 1) return fx;
      let I = clamp(+intensity || 0, 0, 1);
      if (I < 0.01) I = 0;
      let f = flames.get(el);
      if (!f) {
        if (I <= 0) return fx;
        // muitos elementos ao mesmo tempo: o pedido mais antigo cede a vez
        if (flames.size >= MAX_FLAMES) flames.delete(flames.keys().next().value);
        // contorno em brasa só em "caixas" (borda ou fundo); em texto solto ficaria um retângulo estranho
        const cs = getComputedStyle(el), bg = cs.backgroundColor || '';
        const boxy = parseFloat(cs.borderTopWidth) > 0 || !(bg === 'transparent' || /,\s*0\)$/.test(bg));
        // borda + padding em fração do tamanho (vale mesmo com o elemento escalado por transform)
        const w0 = el.offsetWidth || 0, h0 = el.offsetHeight || 0;
        const pv = (a, b) => (parseFloat(cs[a]) || 0) + (parseFloat(cs[b]) || 0);
        const ins = w0 > 0 && h0 > 0 ? [pv('borderTopWidth', 'paddingTop') / h0, pv('borderRightWidth', 'paddingRight') / w0,
          pv('borderBottomWidth', 'paddingBottom') / h0, pv('borderLeftWidth', 'paddingLeft') / w0].map((v) => clamp(v, 0, 0.4)) : null;
        f = { el, boxy, ins, target: 0, cur: 0, I: 0, mx: 0, my: 0, mw: 0, mh: 0, grid: null, color: undefined, lut: FIRE_LUT, fr: FIRE_R, er: EMBER_R, ea: 0, la: 0, side: 0, sx: rand(0, 100), gx: 0, gy: 0, ex: 0, ey: 0, ew: 0, eh: 0 };
        flames.set(el, f);
      }
      // apagou com o fogo alto (errou): baforada de fumaça e brasas
      if (!I && f.target > 0.2 && f.I > 0.2) snuff(f);
      let changed = f.target !== I;
      f.target = I;
      const c = color || null;
      if (c !== f.color) {
        changed = true;
        f.color = c; f.lut = lutFor(c);
        f.fr = c ? fireRamp(c) : FIRE_R; f.er = c ? ramp(c) : EMBER_R;
      }
      // mesmo valor de novo (jogo chamando todo quadro): nada a fazer; elemento escondido fica com o poll
      if (changed) wake();
      return fx;
    }
    function fireworks(count, opts) {
      if (dead) return fx;
      measure();
      let n = clamp(Math.round(count == null ? 3 : +count || 0), 0, 24);
      if (reduced) n = Math.ceil(n * 0.5);
      n = Math.min(n, MAX_ROCKETS - rockets.length - queued);
      if (n <= 0) return fx;
      const given = opts && Array.isArray(opts.colors) ? opts.colors.filter((c) => typeof c === 'string' && c) : [];
      const cols = given.length ? given : FW_COLORS;
      const slots = [];
      for (let i = 0; i < n; i++) slots.push(i);
      for (let i = n - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = slots[i]; slots[i] = slots[j]; slots[j] = t; }
      for (let i = 0; i < n; i++) {
        const tx = W * (0.1 + (0.8 * (slots[i] + rand(0.15, 0.85))) / n);
        const ty = H * rand(0.08, 0.5);
        const cA = pick(cols);
        let cB = pick(cols);
        for (let k = 0; k < 4 && cB === cA && cols.length > 1; k++) cB = pick(cols);
        const type = i === 0 ? 'peony' : pick(FW_TYPES);
        queued++;
        sched.push({ at: clock + (n > 1 ? (i / (n - 1)) * 0.8 : 0) + rand(0, 0.08), fn: () => { queued--; launch(tx, ty, cA, cB, type); } });
      }
      wake();
      return fx;
    }
    function confetti(count) {
      if (dead) return fx;
      measure();
      const n = Math.min(MAX_CONF - conf, amount(count == null ? 60 : +count || 0));
      for (let i = 0; i < n; i++) {
        const p = spawn(rand(0, W), -rand(1, H * 0.3), rand(-18, 18), H * rand(0.3, 0.6), 9, ramp(pick(CONF_COLORS)));
        if (!p) break;
        conf++;
        p.kind = K_CONF; p.a = rand(2, 4.5); p.b = H * rand(0.17, 0.26); p.c = rand(8, 22); p.d = rand(7, 15); p.ph = rand(0, TAU);
      }
      if (n > 0) wake();
      return fx;
    }
    function sparks(x, y, color, count) {
      if (dead) return fx;
      measure();
      const rp = ramp(color || '#ffd23f');
      const n = amount(count == null ? 24 : +count || 0);
      const sp = clamp(Math.min(W, H) * 0.45, 60, 160);
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), v = sp * rand(0.3, 1);
        const p = spawn(x / S, y / S, Math.cos(a) * v, Math.sin(a) * v, rand(0.25, 0.55), rp);
        if (!p) break;
        p.g = 70; p.drag = 3.2; p.trail = 1; p.glow = 0.5; p.shrink = true;
        p.size = Math.random() < 0.35 ? 2 : 1;
      }
      if (n) wake();
      return fx;
    }
    function fly(x, y, el, count, color, onArrive) {
      if (dead) return fx;
      measure();
      const want = clamp(Math.round(count == null ? 12 : +count || 0), 0, 60);
      const grp = { cb: typeof onArrive === 'function' ? onArrive : null, fired: false };
      const m = want ? Math.min(MAX_COINS - coins.length, Math.max(1, Math.round(want * (reduced ? 0.5 : 1)))) : 0;
      // sem moedas (count 0 ou limite cheio): o callback chega mesmo assim, no tempo de um voo
      if (m <= 0) { sched.push({ at: clock + (want ? 0.55 : 0), fn: () => arrive(grp) }); wake(); return fx; }
      const rp = ramp(color || '#ffd23f');
      const sx = x / S, sy = y / S, big = S < 2.5 ? 1.2 : 1;
      for (let i = 0; i < m; i++) {
        const a = -Math.PI / 2 + rand(-1.25, 1.25), mag = rand(18, 48) * big;
        const c = {
          el, sx, sy, bx: sx + Math.cos(a) * mag, by: sy + Math.sin(a) * mag, ox: rand(-28, 28), oy: rand(10, 36),
          tx: sx, ty: sy, x: sx, y: sy, tr: [sx, sy, sx, sy, sx, sy],
          t: 0, delay: i * Math.min(0.04, 0.32 / m) + rand(0, 0.03), dur: rand(0.5, 0.7), spin: rand(0, TAU), rp, grp,
        };
        aim(c);
        coins.push(c);
      }
      wake();
      return fx;
    }
    function edgeApi(intensity, color) {
      if (dead) return fx;
      edge.target = clamp(+intensity || 0, 0, 1);
      const c = color || null;
      if (c !== edge.color) {
        edge.color = c; edge.lut = lutFor(c);
        edge.rgb = c ? rgbOf(c) : [255, 96, 24]; edge.er = c ? ramp(c) : EMBER_R;
      }
      if (edge.target > 0) wake();
      return fx;
    }
    function shockwave(x, y, color) {
      if (dead) return fx;
      measure();
      const rp = ramp(color || '#ffd23f');
      const R = clamp(Math.min(W, H) * 0.32, 36, 130);
      const lx = x / S, ly = y / S;
      mkWave(lx, ly, 3, R, 3, 0.5, rp);
      mkWave(lx, ly, 2, R * 0.62, 2, 0.42, rp, 0.07);
      mkWave(lx, ly, 2, 8, 0, 0.14, FLASH_R);
      sparks(x, y, color, 14);
      wake();
      return fx;
    }
    function clear() {
      for (const p of parts) pool.push(p);
      parts.length = 0; rockets.length = 0; coins.length = 0; waves.length = 0; sched.length = 0; due.length = 0;
      queued = 0; conf = 0; awake = 0;
      flames.clear();
      if (pollT) { clearTimeout(pollT); pollT = 0; }
      edge.target = edge.cur = 0;
      edge.bottom = edge.left = edge.right = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      sleep();
      return fx;
    }
    function destroy() {
      if (dead) return;
      clear();
      dead = true;
      if (mq) { if (mq.removeEventListener) mq.removeEventListener('change', onMq); else if (mq.removeListener) mq.removeListener(onMq); }
      cv.remove();
      pool.length = 0;
    }
    // diagnóstico (testes / console)
    function stats() {
      return { running: !!raf, polling: !!pollT, frames, parts: parts.length, coins: coins.length, rockets: rockets.length + queued, waves: waves.length, sched: sched.length, flames: flames.size, edge: edge.cur, work: workEma, update: updEma, draw: drawEma, quality: q, scale: S, w: W, h: H, reduced };
    }

    const fx = { flames: flamesApi, fireworks, confetti, sparks, fly, edge: edgeApi, shockwave, clear, destroy, stats, canvas: cv };
    measure();
    return fx;
  }

  QC.FX2D = { create };
})();
