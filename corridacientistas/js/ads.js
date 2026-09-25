// Patrocínio da Quanta Aulas no Campus da Ciência, como numa pista de verdade:
// placas de beira de pista, outdoors sobre pés, faixas no pórtico da largada, nas arquibancadas,
// na ponte e no túnel, um dirigível circulando e o logotipo pintado no gramado.
// Tudo é desenhado num atlas de canvas (logotipo real + fonte da marca, com alternativas) e
// mesclado em poucos pedaços (culling), com um único material.
import * as THREE from './three.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Identidade visual (site quantaaulas.com)
const BRAND = {
  bg: '#07120d', elev: '#0e1d16', card: '#112620', brand: '#1fd685', deep: '#16a86a',
  logo: '#11a57c', ink: '#e8f5ee', dim: '#9db0a6', gold: '#f5b94a', paper: '#f3faf6',
};
const FONT = "'Plus Jakarta Sans', 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap';
const LOGO_URL = new URL('../assets/quanta-logo.png', import.meta.url).href;
const ENVELOPE = '#eef3f0'; // cor do dirigível (o painel do atlas usa a mesma, sem emenda)

// ---------------------------------------------------------------------------
// Carregamento da fonte e do logotipo (uma vez por página). Sem prazo aqui: buildAds decide até
// quando vale redesenhar o atlas (a fonte pode chegar tarde numa rede lenta e ainda entrar).
let fontPromise = null;
function brandFontLoaded() {
  if (typeof document === 'undefined' || !document.fonts) return false;
  for (const f of document.fonts) if (/Plus Jakarta Sans/i.test(f.family) && f.status === 'loaded') return true;
  return false;
}
function loadBrandFont() {
  if (fontPromise) return fontPromise;
  fontPromise = new Promise((resolve) => {
    if (typeof document === 'undefined' || !document.fonts) { resolve(false); return; }
    if (brandFontLoaded()) { resolve(true); return; }
    const load = () => Promise.all([document.fonts.load('800 64px "Plus Jakarta Sans"'), document.fonts.load('700 64px "Plus Jakarta Sans"')])
      .then(([a]) => resolve(a.length > 0), () => resolve(false));
    // a página pode já pedir a fonte no <link> do Google Fonts (baixa junto com o three.js)
    const link = document.querySelector('link[href*="Plus+Jakarta+Sans"]');
    if (link) {
      if (link.sheet) load();
      else { link.addEventListener('load', load); link.addEventListener('error', () => resolve(false)); }
      return;
    }
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = FONT_CSS;
    el.onload = load;
    el.onerror = () => resolve(false);
    document.head.appendChild(el);
  });
  return fontPromise;
}
let logoPromise = null, logoImg = null;
function loadLogo() {
  if (logoPromise) return logoPromise;
  logoPromise = new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve(null); return; }
    const img = new Image();
    img.decoding = 'async';
    img.fetchPriority = 'high'; // <img> criada por script entraria com prioridade baixa
    img.onload = () => { art.img = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = LOGO_URL;
    logoImg = img;
  });
  return logoPromise;
}
// Logo pronto? Com a thread ocupada montando a cena, o PNG costuma já ter chegado mas o evento
// "load" ainda está na fila: complete + naturalWidth já permitem desenhá-lo (evita pintar o atlas duas vezes).
function logoReadyNow() {
  if (!art.img && logoImg && logoImg.complete && logoImg.naturalWidth > 0) art.img = logoImg;
  return !!art.img;
}

// ---------------------------------------------------------------------------
// Desenho 2D
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
const LOGO_PX = 512;
const LOGO_BOX = [19, 12, 321, 322]; // área opaca do PNG (alvo + flecha)
// img: PNG do logo; tint: logos recoloridos (cache só durante uma pintura do atlas; depois é liberado)
const art = { img: null, tint: new Map() };
// Começa a baixar logo e fonte já na importação: enquanto pista e ambiente são montados eles chegam,
// e o atlas costuma nascer certo (sem redesenhar).
if (typeof document !== 'undefined') { loadLogo(); loadBrandFont(); }

// Alvo com flecha desenhado à mão (usado se o PNG não carregar): anéis, recorte, centro, haste e penas
function drawTargetLogo(q, s, color) {
  const R = 0.4735 * s, cx = R, cy = R;
  const ux = Math.cos(0.7222), uy = Math.sin(0.7222); // 41,4° para baixo e à direita
  const P = (u, v) => [cx + (u * ux - v * uy) * R, cy + (u * uy + v * ux) * R];
  const fletch = () => {
    q.beginPath();
    [[1.0, -0.16], [1.33, -0.24], [1.26, 0], [1.33, 0.24], [1.0, 0.16]].forEach(([u, v], k) => {
      const [x, y] = P(u, v);
      if (k) q.lineTo(x, y); else q.moveTo(x, y);
    });
    q.closePath();
  };
  q.fillStyle = color;
  q.strokeStyle = color;
  for (const [a, b] of [[0.855, 1.0], [0.559, 0.704], [0.263, 0.408]]) {
    q.beginPath();
    q.arc(cx, cy, b * R, 0, TAU);
    q.arc(cx, cy, a * R, 0, TAU, true);
    q.fill();
  }
  q.globalCompositeOperation = 'destination-out';
  q.lineWidth = 0.22 * R;
  q.beginPath(); q.moveTo(...P(0.2, 0)); q.lineTo(...P(1.05, 0)); q.stroke();
  fletch(); q.lineWidth = 0.14 * R; q.stroke(); q.fill();
  q.globalCompositeOperation = 'source-over';
  q.beginPath(); q.arc(cx, cy, 0.105 * R, 0, TAU); q.fill();
  q.lineWidth = 0.066 * R;
  q.beginPath(); q.moveTo(cx, cy); q.lineTo(...P(1.02, 0)); q.stroke();
  fletch(); q.fill();
  q.lineWidth = 0.075 * R; q.lineCap = 'round';
  q.beginPath(); q.moveTo(...P(1.24, 0)); q.lineTo(...P(1.4, 0)); q.stroke();
  q.lineCap = 'butt';
}
// Logotipo numa cor (canvas quadrado em cache)
function logoCanvas(color) {
  const key = color + (art.img ? '|png' : '|vec');
  let c = art.tint.get(key);
  if (c) return c;
  c = makeCanvas(LOGO_PX, LOGO_PX);
  const q = c.getContext('2d');
  if (art.img) {
    q.imageSmoothingQuality = 'high';
    q.drawImage(art.img, LOGO_BOX[0], LOGO_BOX[1], LOGO_BOX[2], LOGO_BOX[3], 0, 0, LOGO_PX, LOGO_PX);
    q.globalCompositeOperation = 'source-in';
    q.fillStyle = color;
    q.fillRect(0, 0, LOGO_PX, LOGO_PX);
    q.globalCompositeOperation = 'source-over';
  } else drawTargetLogo(q, LOGO_PX, color);
  art.tint.set(key, c);
  return c;
}
function logo(g, x, y, size, color) {
  g.imageSmoothingQuality = 'high';
  g.drawImage(logoCanvas(color), x, y, size, size);
}
function setFont(g, size, weight = 800) {
  g.font = `${weight} ${Math.max(1, Math.round(size))}px ${FONT}`;
}
function setTrack(g, px) {
  if ('letterSpacing' in g) g.letterSpacing = `${px}px`;
}
// Tamanho de fonte que cabe na largura
function fitSize(g, str, size, maxW, weight = 800, track = 0) {
  setTrack(g, track);
  setFont(g, size, weight);
  const w = g.measureText(str).width;
  return w > maxW ? Math.floor(size * maxW / w) : size;
}
// Texto com base na altura das maiúsculas: yc = centro vertical das maiúsculas
function text(g, str, x, yc, { size, weight = 800, color, align = 'left', maxW = 1e9, track = 0 }) {
  const s = fitSize(g, str, size, maxW, weight, track);
  setFont(g, s, weight);
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillText(str, x, yc + s * 0.36);
  setTrack(g, 0);
  return s;
}
function textWidth(g, str, size, weight = 800, track = 0) {
  setTrack(g, track);
  setFont(g, size, weight);
  const w = g.measureText(str).width;
  setTrack(g, 0);
  return w;
}
function star(g, cx, cy, r, color) {
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.43 : r;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (k) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
  g.fillStyle = color;
  g.fill();
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
// Ícone genérico de câmera (contorno): indica que o @ é do Instagram
function cameraGlyph(g, x, y, s, color) {
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = s * 0.1;
  roundRect(g, x + s * 0.05, y + s * 0.05, s * 0.9, s * 0.9, s * 0.27);
  g.stroke();
  g.beginPath(); g.arc(x + s / 2, y + s / 2, s * 0.21, 0, TAU); g.stroke();
  g.beginPath(); g.arc(x + s * 0.745, y + s * 0.255, s * 0.065, 0, TAU); g.fill();
  g.restore();
}
// Fundos
function bgDark(g, w, h, rings = true) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#153428');
  gr.addColorStop(1, '#0a1913');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  if (rings) {
    // anéis do alvo, bem suaves, saindo da borda direita
    g.save();
    g.globalAlpha = 0.07;
    g.strokeStyle = BRAND.brand;
    g.lineWidth = h * 0.09;
    for (let k = 1; k <= 4; k++) {
      g.beginPath();
      g.arc(w * 0.98, h * 0.5, h * 0.36 * k, 0, TAU);
      g.stroke();
    }
    g.restore();
  }
}
function bgGreen(g, w, h) {
  const gr = g.createLinearGradient(0, 0, w * 0.3, h);
  gr.addColorStop(0, '#27e393');
  gr.addColorStop(1, '#14a867');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}
function bgPaper(g, w, h) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#f7fcf9');
  gr.addColorStop(1, '#e3f1e9');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}
function brandBar(g, x, y, w, h) {
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, BRAND.deep);
  gr.addColorStop(0.5, BRAND.brand);
  gr.addColorStop(1, BRAND.deep);
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
}
// Linha de elementos (logo, texto, ponto, barra, espaço) centrada em cx e reduzida para caber em maxW
function row(g, items, cx, yc, maxW) {
  const wOf = (it) => (it.logo ? it.logo : it.text ? textWidth(g, it.text, it.size, it.weight || 800, it.track || 0) : it.dot ? it.dot * 2 : it.bar ? it.bar : it.gap || 0);
  const total = items.reduce((a, it) => a + wOf(it), 0);
  const k = Math.min(1, maxW / total);
  let x = cx - (total * k) / 2;
  for (const it of items) {
    const w = wOf(it) * k;
    if (it.logo) logo(g, x, yc - (it.logo * k) / 2 + (it.dy || 0) * k, it.logo * k, it.color);
    else if (it.text) text(g, it.text, x, yc + (it.dy || 0) * k, { size: it.size * k, weight: it.weight || 800, color: it.color, track: (it.track || 0) * k });
    else if (it.dot) { g.fillStyle = it.color; g.beginPath(); g.arc(x + w / 2, yc, it.dot * k, 0, TAU); g.fill(); }
    else if (it.bar) { g.fillStyle = it.color; g.fillRect(x, yc - (it.h * k) / 2, w, it.h * k); }
    x += w;
  }
  return k;
}
// Logotipo + palavra, centrado em cx (ou a partir de x se align = 'left')
function lockup(g, x, yc, { logoSize, size, color = BRAND.ink, logoColor = BRAND.brand, gap = 0.28, str = 'QUANTA AULAS', track = 2, align = 'center', maxW = 1e9, weight = 800 }) {
  let s = size;
  let tw = textWidth(g, str, s, weight, track);
  let total = logoSize + logoSize * gap + tw;
  if (total > maxW) { const k = maxW / total; s *= k; logoSize *= k; tw *= k; total = maxW; }
  const x0 = align === 'center' ? x - total / 2 : x;
  logo(g, x0, yc - logoSize / 2, logoSize, logoColor);
  text(g, str, x0 + logoSize * (1 + gap), yc, { size: s, weight, color, track });
  return total;
}

// ---------------------------------------------------------------------------
// Artes (coordenadas de referência; o atlas escala para a qualidade)
const REF = {
  hoard: [1024, 192], wide: [1536, 192], bill: [1536, 512], blimp: [1536, 384], bridge: [1536, 160], grass: [1024, 1280],
};
const PAINT = {
  // Placas de beira de pista (≈ 5,9 × 1,1 m)
  h0(g, w, h) { // marca, fundo escuro
    bgDark(g, w, h);
    brandBar(g, 0, h - 12, w, 12);
    lockup(g, 36, h / 2 - 5, { logoSize: 132, size: 104, align: 'left', maxW: w - 70 });
  },
  h1(g, w, h) { // marca, fundo verde
    bgGreen(g, w, h);
    lockup(g, 36, h / 2, { logoSize: 132, size: 104, align: 'left', maxW: w - 70, color: BRAND.bg, logoColor: BRAND.bg });
  },
  h2(g, w, h) { // disciplinas
    bgDark(g, w, h);
    brandBar(g, 0, h - 10, w, 10);
    const parts = ['MATEMÁTICA', 'FÍSICA', 'QUÍMICA'];
    const dot = 22;
    let size = 82;
    const widthOf = (s) => parts.reduce((a, p) => a + textWidth(g, p, s, 800, 1), 0) + dot * 2 * 2.6;
    const tw = widthOf(size);
    if (tw > w - 70) size = Math.floor(size * (w - 70) / tw);
    let x = (w - widthOf(size)) / 2;
    const yc = h / 2 - 4;
    parts.forEach((p, k) => {
      text(g, p, x, yc, { size, color: BRAND.ink, track: 1 });
      x += textWidth(g, p, size, 800, 1);
      if (k < 2) {
        g.fillStyle = BRAND.brand;
        g.beginPath(); g.arc(x + dot * 1.3, yc, dot / 2, 0, TAU); g.fill();
        x += dot * 2.6;
      }
    });
  },
  h3(g, w, h) { // Doutor pelo ITA
    bgPaper(g, w, h);
    g.fillStyle = BRAND.deep;
    g.fillRect(0, h - 12, w, 12);
    logo(g, 36, h / 2 - 72, 138, BRAND.logo);
    text(g, 'DOUTOR PELO ITA', 210, h / 2 - 4, { size: 100, color: BRAND.bg, maxW: w - 250, track: 1 });
  },
  h4(g, w, h) { // avaliações
    bgDark(g, w, h);
    brandBar(g, 0, h - 10, w, 10);
    for (let k = 0; k < 5; k++) star(g, 78 + k * 70, h / 2 - 4, 34, BRAND.gold);
    text(g, '+600 AVALIAÇÕES', 440, h / 2 - 4, { size: 92, color: BRAND.ink, maxW: w - 470 });
  },
  h5(g, w, h) { // site
    bgGreen(g, w, h);
    text(g, 'quantaaulas.com', w / 2, h / 2 - 12, { size: 124, color: BRAND.bg, align: 'center', maxW: w - 80 });
  },
  h6(g, w, h) { // instagram: ícone de câmera + @
    bgDark(g, w, h);
    brandBar(g, 0, h - 10, w, 10);
    const gs = 104, gap = 30;
    const s = fitSize(g, '@quanta_aulas', 118, w - 70 - gs - gap);
    const tw = textWidth(g, '@quanta_aulas', s);
    const aw = textWidth(g, '@', s);
    const x0 = (w - (gs + gap + tw)) / 2;
    const yc = h / 2 - 10;
    cameraGlyph(g, x0, yc - gs / 2, gs, BRAND.brand);
    text(g, '@', x0 + gs + gap, yc, { size: s, color: BRAND.brand });
    text(g, 'quanta_aulas', x0 + gs + gap + aw, yc, { size: s, color: BRAND.ink });
  },
  h7(g, w, h) { // slogan sem logo, no maior corpo que cabe (lido de longe)
    bgPaper(g, w, h);
    g.fillStyle = BRAND.deep;
    g.fillRect(0, h - 12, w, 12);
    text(g, 'A evolução do aprendizado', w / 2, h / 2 - 16, { size: 116, color: BRAND.bg, align: 'center', maxW: w - 64 });
  },
  h8(g, w, h) { // aulas publicadas
    bgDark(g, w, h);
    brandBar(g, 0, h - 10, w, 10);
    const a = '5.000+', b = ' AULAS PUBLICADAS';
    let s = 96;
    const tw = textWidth(g, a + b, s);
    if (tw > w - 80) s = Math.floor(s * (w - 80) / tw);
    const x = (w - textWidth(g, a + b, s)) / 2;
    text(g, a, x, h / 2 - 4, { size: s, color: BRAND.brand });
    text(g, b, x + textWidth(g, a, s), h / 2 - 4, { size: s, color: BRAND.ink });
  },
  h9(g, w, h) { // Superprof
    bgDark(g, w, h);
    brandBar(g, 0, h - 10, w, 10);
    g.fillStyle = BRAND.gold;
    roundRect(g, 40, 30, 150, 124, 22); g.fill();
    text(g, '#1', 115, 90, { size: 92, color: BRAND.bg, align: 'center' });
    text(g, 'SUPERPROF BRASIL', 222, h / 2 - 4, { size: 92, color: BRAND.ink, maxW: w - 250 });
  },

  // Faixas largas das arquibancadas (≈ 11 × 1,4 m)
  f0(g, w, h) {
    bgDark(g, w, h, false);
    brandBar(g, 0, 0, w, 8); brandBar(g, 0, h - 8, w, 8);
    row(g, [
      { logo: 128, color: BRAND.brand }, { gap: 30 },
      { text: 'QUANTA AULAS', size: 100, color: BRAND.ink, track: 2 }, { gap: 40 },
      { bar: 6, h: 88, color: BRAND.brand }, { gap: 40 },
      { text: 'A evolução do aprendizado', size: 60, weight: 700, color: BRAND.brand, dy: -6 },
    ], w / 2, h / 2, w - 90);
  },
  f1(g, w, h) {
    bgGreen(g, w, h);
    const t = 'AULAS PARTICULARES DE MATEMÁTICA, FÍSICA E QUÍMICA';
    logo(g, 34, h / 2 - 62, 124, BRAND.bg);
    text(g, t, 190, h / 2 - 2, { size: 72, color: BRAND.bg, maxW: w - 230 });
  },
  f2(g, w, h) {
    bgDark(g, w, h, false);
    brandBar(g, 0, 0, w, 8); brandBar(g, 0, h - 8, w, 8);
    for (let k = 0; k < 5; k++) star(g, 70 + k * 64, h / 2, 30, BRAND.gold);
    const t = '+600 AVALIAÇÕES 5 ESTRELAS';
    const s = text(g, t, 400, h / 2, { size: 78, color: BRAND.ink, maxW: 700 });
    const x = 400 + textWidth(g, t, s) + 40;
    text(g, '#1 SUPERPROF BRASIL', x, h / 2, { size: 64, color: BRAND.gold, maxW: w - x - 40 });
  },

  // Outdoors 12 × 4 m
  b0(g, w, h) { // aulas particulares
    bgDark(g, w, h);
    brandBar(g, 0, h - 76, w, 76);
    text(g, 'quantaaulas.com', w - 60, h - 38, { size: 46, color: BRAND.bg, align: 'right' });
    text(g, 'QUANTA AULAS', 60, h - 38, { size: 46, color: BRAND.bg, track: 3 });
    const cx = 64;
    text(g, 'AULAS PARTICULARES DE', cx, 86, { size: 58, color: BRAND.brand, track: 3, maxW: 960 });
    const s = Math.min(fitSize(g, 'MATEMÁTICA, FÍSICA', 124, 1000), fitSize(g, 'E QUÍMICA', 124, 1000));
    text(g, 'MATEMÁTICA, FÍSICA', cx, 196, { size: s, color: BRAND.ink });
    text(g, 'E QUÍMICA', cx, 196 + s * 1.24, { size: s, color: BRAND.ink });
    logo(g, w - 400, 40, 340, BRAND.brand);
  },
  b1(g, w, h) { // ITA
    bgPaper(g, w, h);
    g.fillStyle = BRAND.elev;
    g.fillRect(0, h - 84, w, 84);
    brandBar(g, 0, h - 90, w, 6);
    lockup(g, 60, h - 42, { logoSize: 56, size: 46, align: 'left', color: BRAND.ink });
    text(g, 'A evolução do aprendizado', w - 60, h - 46, { size: 40, weight: 700, color: BRAND.brand, align: 'right' });
    logo(g, 56, 44, 320, BRAND.logo);
    text(g, 'DOUTOR PELO ITA', 430, 150, { size: 136, color: BRAND.bg, maxW: w - 480 });
    // verde escuro (≈ 6:1 sobre o papel); o verde da marca fica só nas barras
    text(g, '15 ANOS DE EXPERIÊNCIA', 434, 300, { size: 80, color: '#0b6b45', maxW: w - 480, track: 1 });
  },
  b2(g, w, h) { // agende
    bgGreen(g, w, h);
    g.save();
    g.globalAlpha = 0.06;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 40;
    for (let k = 1; k <= 5; k++) { g.beginPath(); g.arc(w * 0.12, h * 0.45, 120 * k, 0, TAU); g.stroke(); }
    g.restore();
    logo(g, 50, 56, 300, BRAND.bg); // escuro sobre o verde, como na placa h1
    text(g, 'AGENDE SUA', 410, 112, { size: 104, color: BRAND.bg, maxW: w - 460 });
    text(g, 'AULA EXPERIMENTAL', 410, 228, { size: 104, color: BRAND.bg, maxW: w - 460 });
    // chamada: endereço maior, numa pílula escura
    const url = 'quantaaulas.com';
    const s = fitSize(g, url, 92, w - 410 - 150);
    const tw = textWidth(g, url, s);
    g.fillStyle = BRAND.bg;
    roundRect(g, 410, 312, tw + 104, 142, 71); g.fill();
    text(g, url, 462, 383, { size: s, color: BRAND.brand });
  },
  b3(g, w, h) { // lógica
    bgDark(g, w, h, false);
    // símbolos de fundo (Matemática, Física, Química), bem suaves
    g.save();
    g.globalAlpha = 0.07;
    g.fillStyle = BRAND.brand;
    const sy = [['∫', 90, 150, 220], ['π', 520, 110, 150], ['Σ', 1180, 170, 190], ['√x', 840, 470, 150], ['Δ', 300, 470, 170], ['∞', 1420, 470, 150], ['H₂O', 1250, 330, 110]];
    for (const [c, x, y, s] of sy) { setFont(g, s, 700); g.textAlign = 'center'; g.fillText(c, x, y); }
    g.restore();
    const s = Math.min(fitSize(g, 'Entender a lógica,', 132, w - 140), fitSize(g, 'não só decorar fórmula.', 132, w - 140));
    text(g, 'Entender a lógica,', 70, 128, { size: s, color: BRAND.ink });
    text(g, 'não só decorar fórmula.', 70, 128 + s * 1.2, { size: s, color: BRAND.brand });
    row(g, [
      { text: 'MATEMÁTICA', size: 40, color: BRAND.dim, track: 2 }, { gap: 20 }, { dot: 6, color: BRAND.brand }, { gap: 20 },
      { text: 'FÍSICA', size: 40, color: BRAND.dim, track: 2 }, { gap: 20 }, { dot: 6, color: BRAND.brand }, { gap: 20 },
      { text: 'QUÍMICA', size: 40, color: BRAND.dim, track: 2 },
    ], 70 + 290, h - 80, 600);
    lockup(g, w - 70 - 560, h - 80, { logoSize: 84, size: 64, align: 'left', maxW: 560 });
  },
  b4(g, w, h) { // avaliações
    bgDark(g, w, h);
    for (let k = 0; k < 5; k++) star(g, 110 + k * 124, 118, 58, BRAND.gold);
    text(g, '+600 AVALIAÇÕES', 60, 262, { size: 120, color: BRAND.ink, maxW: 1000 });
    text(g, '5 ESTRELAS  ·  #1 SUPERPROF BRASIL', 64, 380, { size: 64, color: BRAND.gold, maxW: 1000, track: 1 });
    logo(g, w - 390, 50, 320, BRAND.brand);
    text(g, 'ALUNOS EM 10+ PAÍSES', w - 230, 440, { size: 40, color: BRAND.dim, align: 'center', maxW: 420 });
  },

  // Dirigível (fundo igual ao envelope): só logo + nome em duas linhas, no maior corpo que cabe
  // (visto a 100–250 m, lá de baixo)
  blimp(g, w, h) {
    g.fillStyle = ENVELOPE;
    g.fillRect(0, 0, w, h);
    const ls = 334;
    logo(g, 56, (h - ls) / 2, ls, BRAND.logo);
    const x = 56 + ls + 56, maxW = w - x - 40;
    const s = Math.min(fitSize(g, 'QUANTA', 206, maxW, 800, 5), fitSize(g, 'AULAS', 206, maxW, 800, 5));
    text(g, 'QUANTA', x, h / 2 - s * 0.47, { size: s, color: '#0b2418', track: 5 });
    text(g, 'AULAS', x, h / 2 + s * 0.47, { size: s, color: '#0b2418', track: 5 });
  },
  // Ponte (faixa entre os arcos)
  bridge(g, w, h) {
    bgDark(g, w, h, false);
    brandBar(g, 0, 0, w, 7); brandBar(g, 0, h - 7, w, 7);
    row(g, [
      { logo: 112, color: BRAND.brand }, { gap: 28 },
      { text: 'QUANTA AULAS', size: 90, color: BRAND.ink, track: 2 }, { gap: 34 },
      { dot: 7, color: BRAND.brand }, { gap: 34 },
      { text: 'A evolução do aprendizado', size: 56, weight: 700, color: BRAND.brand, dy: -5 },
    ], w / 2, h / 2, w - 80);
  },
  // Coroa do pórtico da largada
  crown(g, w, h) {
    bgDark(g, w, h, false);
    brandBar(g, 0, 0, w, 10); brandBar(g, 0, h - 10, w, 10);
    lockup(g, w / 2, h / 2, { logoSize: 142, size: 118, maxW: w - 120, track: 4 });
  },
  // Túnel: oferecimento
  tunnel(g, w, h) {
    bgDark(g, w, h, false);
    brandBar(g, 0, h - 10, w, 10);
    row(g, [
      { text: 'oferecimento', size: 58, weight: 700, color: BRAND.dim, dy: -4 }, { gap: 36 },
      { logo: 128, color: BRAND.brand }, { gap: 26 },
      { text: 'QUANTA AULAS', size: 106, color: BRAND.ink, track: 2 },
    ], w / 2, h / 2 - 4, w - 100);
  },
  // Gramado (tinta branca sobre fundo transparente): marca completa (1024²) + faixa para o acostamento (1024 × 256)
  grass(g, w, h) {
    g.clearRect(0, 0, w, h);
    logo(g, w / 2 - 300, 40, 600, '#ffffff');
    text(g, 'QUANTA AULAS', w / 2, 800, { size: 140, color: '#ffffff', align: 'center', maxW: w - 40, track: 6 });
    text(g, 'A evolução do aprendizado', w / 2, 930, { size: 70, weight: 700, color: '#ffffff', align: 'center', maxW: w - 120 });
    row(g, [{ logo: 190, color: '#ffffff' }, { gap: 40 }, { text: 'QUANTA AULAS', size: 150, color: '#ffffff', track: 5 }], w / 2, 1024 + 128, w - 40);
  },
};

// Atlas: regiões em px na resolução de referência 4096 × 2048 (alta); 'baixa' usa metade.
const HOARD_IDS = ['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'];
function atlasLayout() {
  const R = {};
  HOARD_IDS.forEach((id, k) => { R[id] = [0, k * 192, 1024, 192, 'hoard']; });
  R.white = [0, 1920, 1024, 128, null];
  ['b0', 'b1', 'b2', 'b3'].forEach((id, k) => { R[id] = [1024, k * 512, 1536, 512, 'bill']; });
  R.blimp = [2560, 0, 1536, 384, 'blimp'];
  R.bridge = [2560, 384, 1536, 160, 'bridge'];
  R.crown = [2560, 544, 1536, 192, 'wide'];
  R.tunnel = [2560, 736, 1536, 192, 'wide'];
  R.b4 = [2560, 928, 1536, 512, 'bill'];
  R.f0 = [2560, 1440, 1536, 192, 'wide'];
  R.f1 = [2560, 1632, 1536, 192, 'wide'];
  R.f2 = [2560, 1824, 1536, 192, 'wide'];
  return R;
}
function buildAtlas(hi) {
  // 2048 × 1024 nas duas qualidades: na tela fica igual ao de 4096 (placas a > 5 m, filtro anisotrópico)
  // e custa 1/4 da memória e do envio. A tinta do chão (vista de perto no acostamento) fica maior na alta.
  const S = 0.5, SG = hi ? 1 : 0.5;
  const W = 4096 * S, H = 2048 * S;
  const canvas = makeCanvas(W, H);
  const g = canvas.getContext('2d');
  const L = atlasLayout();
  const grass = makeCanvas(REF.grass[0] * SG, REF.grass[1] * SG);
  // uma tarefa por região (o redesenho tardio roda aos poucos, uma por quadro)
  const jobs = () => {
    const list = Object.entries(L).map(([id, [x, y, w, h, ref]]) => () => {
      g.save();
      g.beginPath(); g.rect(x * S, y * S, w * S, h * S); g.clip();
      g.clearRect(x * S, y * S, w * S, h * S);
      g.translate(x * S, y * S);
      if (!ref) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w * S, h * S); g.restore(); return; }
      const [rw, rh] = REF[ref];
      g.scale((w * S) / rw, (h * S) / rh);
      PAINT[id](g, rw, rh);
      g.restore();
    });
    list.push(() => {
      const q = grass.getContext('2d');
      q.save();
      q.scale(SG, SG);
      PAINT.grass(q, REF.grass[0], REF.grass[1]);
      q.restore();
    });
    // fim: libera os logos recoloridos (≈ 1 MB cada); a próxima pintura os refaz
    list.push(() => art.tint.clear());
    return list;
  };
  const draw = () => { for (const job of jobs()) job(); };
  draw();
  // uv [u0, v0, u1, v1] (canto inferior esquerdo -> superior direito), com meio texel de margem
  const uv = (id) => {
    const [x, y, w, h] = L[id];
    const e = 1.5 / S;
    return [(x + e) / 4096, 1 - (y + h - e) / 2048, (x + w - e) / 4096, 1 - (y + e) / 2048];
  };
  const wr = L.white;
  const white = [(wr[0] + wr[2] / 2) / 4096, 1 - (wr[1] + wr[3] / 2) / 2048];
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = hi ? 8 : 4;
  // tinta branca: textura linear (branco = 1) e pré-multiplicada, para os mipmaps não escurecerem as bordas
  const grassTex = new THREE.CanvasTexture(grass);
  grassTex.anisotropy = hi ? 8 : 2;
  grassTex.premultiplyAlpha = true;
  const upload = () => { tex.needsUpdate = true; grassTex.needsUpdate = true; };
  return { canvas, grass, tex, grassTex, uv, white, draw, jobs, upload };
}

// ---------------------------------------------------------------------------
// Geometria mesclada: posição, normal, cor, uv e "brilho" (emissivo proporcional à cor)
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _nn = new THREE.Vector3();
class Geo {
  constructor(white) { this.p = []; this.n = []; this.c = []; this.uv = []; this.gl = []; this.idx = []; this.white = white; }
  get count() { return this.p.length / 3; }
  vert(x, y, z, nx, ny, nz, col, u, v, glow) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col.r, col.g, col.b); this.uv.push(u, v); this.gl.push(glow);
    return this.count - 1;
  }
  // quadrilátero p0..p3 anti-horário visto de frente (p0 = inferior esquerdo); uv = região ou null
  quad(p0, p1, p2, p3, col, uv = null, glow = 0, n = null) {
    if (!n) n = _nn.crossVectors(_e1.subVectors(p1, p0), _e2.subVectors(p3, p0)).normalize();
    const w = this.white;
    const U = uv ? [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]] : [w, w, w, w];
    const b = this.count;
    [p0, p1, p2, p3].forEach((p, k) => this.vert(p.x, p.y, p.z, n.x, n.y, n.z, col, U[k][0], U[k][1], glow));
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  // face de caixa: centro c + n*hn, eixos u (direita) e v (cima) com u × v = n
  face(c, n, u, v, hn, hu, hv, col, uv, glow) {
    const P = (su, sv) => new THREE.Vector3(c.x + n.x * hn + u.x * hu * su + v.x * hv * sv, c.y + n.y * hn + u.y * hu * su + v.y * hv * sv, c.z + n.z * hn + u.z * hu * su + v.z * hv * sv);
    this.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), col, uv, glow, n);
  }
  // caixa orientada (ax × ay = az); front = uv da face +az; skip = faces omitidas ('b' fundo, 'k' costas...)
  box(c, ax, ay, az, hx, hy, hz, col, { front = null, back = null, glow = 0, frontCol = null, skip = '' } = {}) {
    const nax = ax.clone().negate(), nay = ay.clone().negate(), naz = az.clone().negate();
    const W = WHITE_COL;
    this.face(c, az, ax, ay, hz, hx, hy, front ? (frontCol || W) : col, front, front ? glow : 0);
    if (!skip.includes('k')) this.face(c, naz, nax, ay, hz, hx, hy, back ? (frontCol || W) : col, back, back ? glow : 0);
    if (!skip.includes('r')) this.face(c, ax, naz, ay, hx, hz, hy, col, null, 0);
    if (!skip.includes('l')) this.face(c, nax, az, ay, hx, hz, hy, col, null, 0);
    if (!skip.includes('t')) this.face(c, ay, ax, naz, hy, hx, hz, col, null, 0);
    if (!skip.includes('b')) this.face(c, nay, ax, az, hy, hx, hz, col, null, 0);
  }
  // mescla uma BufferGeometry transformada (cor única)
  geo(geo, m, col, glow = 0) {
    const P = geo.attributes.position, Nn = geo.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const b = this.count;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m);
      n.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize();
      this.vert(v.x, v.y, v.z, n.x, n.y, n.z, col, this.white[0], this.white[1], glow);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(b + geo.index.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(b + i);
  }
  append(o) {
    const b = this.count;
    for (const k of ['p', 'n', 'c', 'uv', 'gl']) { const A = this[k], B = o[k]; for (let i = 0; i < B.length; i++) A.push(B[i]); }
    for (let i = 0; i < o.idx.length; i++) this.idx.push(b + o.idx[i]);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('glow', new THREE.Float32BufferAttribute(this.gl, 1));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const WHITE_COL = new THREE.Color(1, 1, 1);
const col = (hex) => new THREE.Color(hex);
const UP = new THREE.Vector3(0, 1, 0);

// Material único: Lambert com atlas + cor por vértice; "glow" soma emissivo (placas iluminadas por trás)
function makeMaterial(map) {
  const m = new THREE.MeshLambertMaterial({ map, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float glow;\nvarying float vGlow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGlow = glow;');
    sh.fragmentShader = 'varying float vGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vGlow;');
  };
  m.customProgramCacheKey = () => 'quanta-ads';
  return m;
}

// ---------------------------------------------------------------------------
// buildAds(scene, track, quality, env, opts?) → { group, update(dt, t, camera), dispose() }
// opts.debug guarda volumes, pés e testes de visada para as verificações de dev/ads.html.
// Os anúncios são opcionais para o jogo: se uma peça falhar (ex.: algo mudou em track.js), só ela
// fica de fora; se falhar a base, volta um grupo vazio. Nunca trava o carregamento.
export function buildAds(scene, track, quality = {}, env = null, opts = {}) {
  const hold = { group: null, disposables: [] };
  try {
    return build(scene, track, quality || {}, env, opts || {}, hold);
  } catch (err) {
    console.warn('anúncios indisponíveis', err);
    if (hold.group) scene.remove(hold.group);
    hold.disposables.forEach((d) => d.dispose && d.dispose());
    const group = new THREE.Group();
    group.name = 'anuncios';
    return { group, update() {}, dispose() {} };
  }
}

function build(scene, track, quality, env, opts, hold) {
  const hi = quality.id !== 'baixa';
  const DEBUG = !!opts.debug;
  const group = new THREE.Group();
  group.name = 'anuncios';
  scene.add(group);
  hold.group = group;
  const meta = track.meta;
  const { N, ds, WD, FL, K } = meta;
  const LEN = track.length;
  const wrapS = (s) => ((s % LEN) + LEN) % LEN;
  const disposables = hold.disposables;
  const solids = []; // caixas sólidas (verificação de sobreposição; só com opts.debug)
  const feet = []; // pés apoiados no chão (idem)
  const skipped = []; // peças que falharam e ficaram de fora
  let alive = true;
  const part = (name, fn) => {
    try { return fn(); } catch (err) { skipped.push(name); console.warn(`anúncios: "${name}" ficou de fora`, err); return null; }
  };

  // tempos de cada etapa (ms), para a página de teste
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const times = {};
  let tMark = clock();
  const lap = (name) => { const t = clock(); times[name] = Math.round(t - tMark); tMark = t; };
  const fontWasReady = brandFontLoaded();
  const logoWasReady = logoReadyNow();
  const atlas = buildAtlas(hi);
  lap('atlas');
  const mat = makeMaterial(atlas.tex);
  disposables.push(atlas.tex, atlas.grassTex, mat);

  // Pedaços por célula (culling): cada peça vai para a célula do seu centro
  const CELL = 260;
  const cells = new Map();
  const geoAt = (x, z) => {
    const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    let b = cells.get(k);
    if (!b) cells.set(k, (b = new Geo(atlas.white)));
    return b;
  };
  const solid = (tag, c, ax, ay, az, hx, hy, hz) => {
    if (DEBUG) solids.push({ tag, c: c.clone(), ax: ax.clone(), ay: ay.clone(), az: az.clone(), hx, hy, hz });
  };
  const foot = (f) => { if (DEBUG) feet.push(f); };

  // Amostra da pista copiada (track.sample reutiliza o objeto)
  const at = (s) => {
    const r = track.sample(s);
    return {
      s: wrapS(s), pos: r.pos.clone(), right: r.right.clone(), wd: r.wallDist, hw: r.halfWidth,
      fwd: new THREE.Vector3(r.tangent.x, 0, r.tangent.z).normalize(),
    };
  };
  // Chão visível: terreno do ambiente ou a borda inclinada da pista (logo atrás do muro)
  const skirtY = (smp, lat) => {
    const e = Math.abs(lat) - smp.wd;
    if (e < 0.55 || e > 7) return -Infinity;
    return smp.pos.y - 0.02 - 0.88 * ((e - 0.55) / 6.45);
  };
  const terrainY = (x, z) => (env && env.groundAt ? env.groundAt(x, z) : 0);
  const _gp = new THREE.Vector3();
  const groundAt = (x, z, hintS) => {
    const p = track.project(_gp.set(x, 0, z), hintS);
    const smp = at(p.s);
    let g = terrainY(x, z);
    if (Math.abs(p.lateral) < smp.wd + 7.5 && !FL[Math.round(p.s / ds) % N]) g = Math.max(g, skirtY(smp, p.lateral));
    return g;
  };

  // Pneus no lado de fora das curvas fechadas (mesma regra de track.js): as placas recuam
  const tires = [new Uint8Array(N), new Uint8Array(N)];
  for (let i = 0; i < N; i++) {
    if (FL[i] || Math.abs(K[i]) < 1 / 62) continue;
    const side = K[i] > 0 ? 0 : 1;
    for (let d = -8; d <= 8; d++) { const j = (i + d + N) % N; if (!FL[j]) tires[side][j] = 1; }
  }
  const tireAt = (s, side) => tires[side < 0 ? 0 : 1][Math.round(wrapS(s) / ds) % N];
  // Placas de seta (curvas muito fechadas, lado de fora) e pórticos: trechos sem placas
  const cs = meta.ctrlS, bs = meta.bridgeS, ts = meta.tunnelS;
  const blocked = [[], []];
  {
    let last = -99;
    for (let i = 0; i < N; i += 3) {
      if (Math.abs(K[i]) < 1 / 45 || FL[i]) continue;
      const s = i * ds;
      if (s - last < 9) continue;
      last = s;
      blocked[K[i] > 0 ? 0 : 1].push([s - 11, s + 3]);
    }
    for (const s of [cs[2] + 16, cs[9] + 16, bs[0] - 26, ts[1] + 50, cs[29] + 30]) {
      blocked[0].push([s - 1.6, s + 1.6]); blocked[1].push([s - 1.6, s + 1.6]);
    }
    blocked[0].push([-1.2, 1.2]); blocked[1].push([-1.2, 1.2]); // postes do pórtico da largada
  }
  const isBlocked = (s, side) => {
    s = wrapS(s);
    for (const [a, b] of blocked[side < 0 ? 0 : 1]) {
      const aa = wrapS(a);
      const d = wrapS(s - aa);
      if (d <= b - a) return true;
    }
    return false;
  };

  const C = {
    frame: col(0x1a2621), back: col(0x22302a), leg: col(0x59645e), dark: col(0x0e1d16), steel: col(0x7c8a84),
    lamp: col(0xfff3cf), catwalk: col(0x39443f), green: col(BRAND.deep),
  };
  // lugares escolhidos na página dev/ads.html (debug.sight e capturas da câmera de perseguição)
  const B4 = [770, 28, 690, 4.4]; // outdoor b4: s, lateral, s para onde olha, altura livre
  const RUNOFF = { hairpin: 982, lab: 158 }; // início das faixas pintadas nas áreas de escape

  // ------------------------------------------------------------ placas de beira de pista
  const BOARD_H = 1.1, BOARD_Y = 1.0, BOARD_T = 0.12;
  const BOARD_L = BOARD_H * (1024 / 192);
  const SEQ = {
    main: ['h0', 'h2', 'h1', 'h4', 'h0', 'h3', 'h1', 'h5', 'h0', 'h6', 'h1', 'h8', 'h0', 'h7', 'h1', 'h9'],
    mix: ['h1', 'h0', 'h3', 'h2', 'h5', 'h4', 'h1', 'h6', 'h7', 'h8', 'h0', 'h9'],
  };
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  let boardCount = 0;
  // ponto na linha das placas (lateral = muro + recuo), na altura da pista
  const linePoint = (s, side, off, out) => {
    const r = track.sample(s);
    return out.copy(r.pos).addScaledVector(r.right, side * (r.wallDist + off));
  };
  function hoardingRun(s0, s1, side, seqName, seqOffset = 0) {
    if (s1 < s0) s1 += LEN;
    const seq = SEQ[seqName];
    // trechos contínuos livres (sem setas/pórticos)
    const spans = [];
    let cur = null;
    for (let s = s0; s <= s1 + 1e-6; s += 0.5) {
      const ok = !isBlocked(s, side) && !FL[Math.round(wrapS(s) / ds) % N];
      if (ok && !cur) cur = [s, s];
      if (ok) cur[1] = s;
      if (!ok && cur) { spans.push(cur); cur = null; }
    }
    if (cur) spans.push(cur);
    let k = seqOffset;
    for (const [a, b] of spans) {
      let tire = false;
      for (let s = a; s <= b; s += 1) if (tireAt(s, side)) { tire = true; break; }
      const off = tire ? 0.97 : 0.64;
      // comprimento físico da linha (por fora das curvas é maior)
      const ss = [], cum = [0];
      for (let s = a; s <= b + 1e-6; s += 0.5) ss.push(s);
      for (let i = 1; i < ss.length; i++) {
        linePoint(ss[i - 1], side, off, tmpA); linePoint(ss[i], side, off, tmpB);
        cum.push(cum[i - 1] + Math.hypot(tmpB.x - tmpA.x, tmpB.z - tmpA.z));
      }
      const total = cum[cum.length - 1];
      // placas entre 92% e 108% do tamanho nominal (a arte não deforma); a sobra fica nas pontas
      const n = Math.floor(total / (BOARD_L * 0.92));
      if (n < 1) continue;
      const len = Math.min(total / n, BOARD_L * 1.08);
      const sAt = (l) => {
        let i = 1;
        while (i < cum.length - 1 && cum[i] < l) i++;
        const f = (l - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
        return lerp(ss[i - 1], ss[i], clamp(f, 0, 1));
      };
      const bounds = [];
      for (let j = 0; j <= n; j++) bounds.push(sAt(j * len + (total - n * len) / 2));
      for (let j = 0; j < n; j++) {
        board(bounds[j], bounds[j + 1], side, off, seq[k % seq.length], j === 0, j === n - 1);
        k++;
      }
    }
    return k;
  }
  function board(sa, sb, side, off, id, capA, capB) {
    const A = at(sa), B = at(sb);
    const o = A.right.clone().add(B.right).setY(0).normalize().multiplyScalar(side); // para fora
    const pa = A.pos.clone().addScaledVector(A.right, side * (A.wd + off));
    const pb = B.pos.clone().addScaledVector(B.right, side * (B.wd + off));
    // corda por dentro da curva: garante o recuo no meio da placa
    const mid = pa.clone().add(pb).multiplyScalar(0.5);
    const pm = track.project(mid, (sa + sb) / 2);
    const need = pm.wallDist + off - 0.02 - Math.abs(pm.lateral);
    if (need > 0) { pa.addScaledVector(o, need); pb.addScaledVector(o, need); mid.addScaledVector(o, need); }
    // leitura da esquerda para a direita de quem olha da pista
    const vr = new THREE.Vector3(-o.z, 0, o.x);
    let L0 = pa, L1 = pb, y0 = A.pos.y, y1 = B.pos.y;
    if (tmpA.subVectors(pb, pa).dot(vr) < 0) { L0 = pb; L1 = pa; y0 = B.pos.y; y1 = A.pos.y; }
    const g = geoAt(mid.x, mid.z);
    const v = (p, y, dy, dOut) => new THREE.Vector3(p.x + o.x * dOut, y + dy, p.z + o.z * dOut);
    const yb = BOARD_Y, yt = BOARD_Y + BOARD_H, T = BOARD_T;
    // frente (arte), costas, topo
    g.quad(v(L0, y0, yb, 0), v(L1, y1, yb, 0), v(L1, y1, yt, 0), v(L0, y0, yt, 0), WHITE_COL, atlas.uv(id), 0.34);
    const baseY = hi ? yb : -0.55;
    g.quad(v(L1, y1, baseY, T), v(L0, y0, baseY, T), v(L0, y0, yt, T), v(L1, y1, yt, T), C.back);
    g.quad(v(L0, y0, yt, 0), v(L1, y1, yt, 0), v(L1, y1, yt, T), v(L0, y0, yt, T), C.frame);
    if (hi) g.quad(v(L1, y1, yb, 0), v(L0, y0, yb, 0), v(L0, y0, yb, T), v(L1, y1, yb, T), C.frame);
    // pontas (só nos extremos do trecho); na baixa descem junto com a saia
    const yEnd = hi ? yb : baseY;
    if (L0 === pa ? capA : capB) g.quad(v(L0, y0, yEnd, T), v(L0, y0, yEnd, 0), v(L0, y0, yt, 0), v(L0, y0, yt, T), C.frame);
    if (L1 === pa ? capA : capB) g.quad(v(L1, y1, yEnd, 0), v(L1, y1, yEnd, T), v(L1, y1, yt, T), v(L1, y1, yt, 0), C.frame);
    // pés (alta) ou saia até o chão (baixa); eixos ortonormais: ao longo da placa, cima, para fora
    const along = new THREE.Vector3().subVectors(L1, L0).setY(0);
    const lenH = along.length();
    along.normalize();
    const out = new THREE.Vector3(along.z, 0, -along.x);
    if (out.dot(o) < 0) out.negate();
    if (hi) {
      for (const t of [0.18, 0.82]) {
        const p = L0.clone().lerp(L1, t).addScaledVector(o, T + 0.07);
        const yy = lerp(y0, y1, t);
        const bottom = yy - 0.55;
        const top = yy + yb + 0.45;
        const c = new THREE.Vector3(p.x, (bottom + top) / 2, p.z);
        g.box(c, along, UP, out, 0.05, (top - bottom) / 2, 0.05, C.leg, { skip: 'b' });
        if (DEBUG) {
          // sólido só da parte acima do chão visível (abaixo fica enterrado)
          const gy = groundAt(p.x, p.z, sa);
          const vis = Math.max(bottom, gy);
          solid('placa-pé', new THREE.Vector3(p.x, (vis + top) / 2, p.z), along, UP, out, 0.05, (top - vis) / 2, 0.05);
          foot({ tag: 'placa', x: p.x, y: bottom, z: p.z, g: gy });
        }
      }
    }
    // saia (baixa): o sólido começa no chão visível; abaixo dele fica enterrada
    if (DEBUG) {
      let lowY = yb;
      if (!hi) {
        const p = L0.clone().lerp(L1, 0.5).addScaledVector(o, T);
        const gy = groundAt(p.x, p.z, sa);
        foot({ tag: 'placa', x: p.x, y: lerp(y0, y1, 0.5) + baseY, z: p.z, g: gy });
        lowY = Math.max(baseY, gy - (y0 + y1) / 2);
      }
      const cy = (y0 + y1) / 2 + (lowY + yt) / 2;
      const hy = (yt - lowY) / 2 + Math.abs(y1 - y0) / 2;
      solid('placa', new THREE.Vector3(mid.x + o.x * T / 2, cy, mid.z + o.z * T / 2), along, UP, out, lenH / 2, hy, T / 2 + 0.02);
    }
    boardCount++;
  }

  // Trechos de placas: [s0, s1, lado (-1 esquerda, 1 direita), sequência, só na alta]
  const RUNS = [
    [LEN - 82, 128, -1, 'main', false], // reta de largada: lado da universidade (saída da curva final)
    [LEN - 146, 128, 1, 'main', false], // reta de largada: arquibancadas (por dentro da curva final)
    [150, 246, -1, 'mix', false], // curva do Laboratório (por fora)
    [330, 404, -1, 'mix', true], // saída do S
    [420, 540, 1, 'mix', true], // subida do Observatório
    [628, 762, 1, 'mix', true], // cume (por fora)
    [bs[1] + 3, bs[1] + 40, 1, 'mix', true], // saída da ponte / entrada do grampo
    [1014, 1064, 1, 'mix', false], // saída do grampo
    [1070, ts[0] - 6, -1, 'mix', true], // chegada ao túnel
    [ts[1] + 6, cs[29] - 6, -1, 'mix', false], // reta de Tesla
    [ts[1] + 6, cs[29] - 6, 1, 'mix', true],
  ];
  RUNS.forEach(([s0, s1, side, seq, onlyHi], r) => {
    if (onlyHi && !hi) return;
    part(`placas ${Math.round(s0)}–${Math.round(s1)}`, () => hoardingRun(s0, s1, side, seq, r * 5 + (side > 0 ? 3 : 0)));
  });
  lap('placas');

  // ------------------------------------------------------------ triângulos do cenário (fora dos anúncios)
  // Usados no build pelos outdoors, que ficam longe do muro, onde a vegetação (sorteada por qualidade)
  // pode estar: para não atravessar nada e para não ficarem escondidos. Malhas de chão ficam de fora
  // (desempenho); o relevo entra na visada pelo env.groundAt.
  const GROUNDISH = /^(terreno|asfalto|acostamento|decalques|aceleradores|lagoa|ceu|montanhas|nuvens|horizonte|tunel-ceu|luzes-tunel|flores)/;
  let blockers = null;
  const getBlockers = () => {
    if (blockers) return blockers;
    blockers = [];
    scene.updateMatrixWorld(true);
    scene.traverse((m) => {
      // pula chão e objetos animados sem culling (pássaros, bolhas, arcos...): posição do build não vale
      if (!m.isMesh || !m.visible || !m.frustumCulled || !m.geometry || !m.geometry.attributes.position || GROUNDISH.test(m.name)) return;
      for (let q = m; q; q = q.parent) if (q === group) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      blockers.push(m);
    });
    return blockers;
  };
  const _sph = new THREE.Sphere(), _m4 = new THREE.Matrix4(), _mi = new THREE.Matrix4(), IDENT = new THREE.Matrix4();
  const _tv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  // Caixa orientada x triângulo (eixos separadores)
  const _L = new Float64Array(9), _E = new Float64Array(9);
  const sepAxis = (o, x, y, z) => {
    const r = o.hx * Math.abs(x) + o.hy * Math.abs(y) + o.hz * Math.abs(z);
    const p0 = _L[0] * x + _L[1] * y + _L[2] * z, p1 = _L[3] * x + _L[4] * y + _L[5] * z, p2 = _L[6] * x + _L[7] * y + _L[8] * z;
    return Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r;
  };
  function triHitsBox(T, o) {
    for (let j = 0; j < 3; j++) {
      const dx = T[j].x - o.c.x, dy = T[j].y - o.c.y, dz = T[j].z - o.c.z;
      _L[j * 3] = dx * o.ax.x + dy * o.ax.y + dz * o.ax.z;
      _L[j * 3 + 1] = dx * o.ay.x + dy * o.ay.y + dz * o.ay.z;
      _L[j * 3 + 2] = dx * o.az.x + dy * o.az.y + dz * o.az.z;
    }
    if (sepAxis(o, 1, 0, 0) || sepAxis(o, 0, 1, 0) || sepAxis(o, 0, 0, 1)) return false;
    for (let j = 0; j < 3; j++) for (let a = 0; a < 3; a++) _E[j * 3 + a] = _L[((j + 1) % 3) * 3 + a] - _L[j * 3 + a];
    if (sepAxis(o, _E[1] * _E[5] - _E[2] * _E[4], _E[2] * _E[3] - _E[0] * _E[5], _E[0] * _E[4] - _E[1] * _E[3])) return false;
    for (let j = 0; j < 3; j++) {
      const ex = _E[j * 3], ey = _E[j * 3 + 1], ez = _E[j * 3 + 2];
      if (sepAxis(o, 0, -ez, ey) || sepAxis(o, ez, 0, -ex) || sepAxis(o, -ey, ex, 0)) return false;
    }
    return true;
  }
  // Outdoors: pedaço do cenário em volta de cada lugar pedido. Câmeras de perseguição (5,7 m atrás do kart,
  // 2,3 m de altura, na linha de corrida) ao longo da aproximação [faceS - 30, s - 22] e a região que
  // cobre as câmeras e todos os candidatos (com folga do tamanho do outdoor).
  const TRIES = [[0, 0], [0, 3], [5, 0], [-5, 0], [0, 6], [5, 3], [-5, 3], [10, 0], [-10, 0], [0, 9], [10, 5], [-10, 5], [15, 0], [-15, 0]];
  function billSite(s, lat, faceS, o = {}) {
    const W = BILL_W0 * (o.k || 1);
    const cams = [];
    const s0 = faceS - 30, s1 = s - 22 < s0 ? s - 22 + LEN : s - 22;
    const n = clamp(Math.round((s1 - s0) / 10), 3, 14);
    for (let k = 0; k <= n; k++) {
      const cs2 = lerp(s0, s1, k / n);
      const rl = track.racingLine ? track.racingLine(wrapS(cs2)) : 0;
      const a = track.sample(cs2 - 5.7);
      const p = a.pos.clone().addScaledVector(a.right, rl);
      p.y += 2.3;
      const b = track.sample(cs2 + 4);
      const look = b.pos.clone().addScaledVector(b.right, rl);
      look.y += 1.2;
      cams.push({ p, f: look.sub(p).normalize() });
    }
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const grow = (x, z, r) => { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r); };
    for (const c of cams) grow(c.p.x, c.p.z, 2);
    // piso: abaixo dele nada toca o volume do outdoor (pés a partir de 0,9 m) nem os raios
    // (que saem a 2,3 m da pista e sobem até o painel)
    let yFloor = Infinity;
    for (const c of cams) yFloor = Math.min(yFloor, c.p.y);
    const out = Math.sign(lat) || 1;
    for (const [dS, dL] of TRIES) {
      const r = track.sample(s + dS);
      const x = r.pos.x + r.right.x * (lat + out * dL), z = r.pos.z + r.right.z * (lat + out * dL);
      grow(x, z, W / 2 + 4);
      yFloor = Math.min(yFloor, terrainY(x, z) + 0.4);
    }
    return { cams, x0, z0, x1, z1, yFloor, T: new Float32Array(0), n: 0, M: [] };
  }
  // Uma passada só pelos triângulos do cenário, distribuindo-os entre as regiões dos outdoors.
  // Cada malha (ou instância) é descartada pela esfera envolvente região a região; os vértices de
  // uma instância são transformados uma vez só.
  let _V = new Float32Array(0);
  function collectSites(sites) {
    if (!sites.length) return;
    const near = [];
    for (const m of getBlockers()) {
      const P = m.geometry.attributes.position, I = m.geometry.index;
      const nt = (I ? I.count : P.count) / 3;
      const inst = m.isInstancedMesh ? m.count : 1;
      // malhas estáticas já em coordenadas de mundo (matriz identidade): lê o array direto
      const raw = !m.isInstancedMesh && !P.isInterleavedBufferAttribute && P.itemSize === 3 && m.matrixWorld.equals(IDENT);
      let X = null;
      for (let k = 0; k < inst; k++) {
        _m4.copy(m.matrixWorld);
        if (m.isInstancedMesh) { m.getMatrixAt(k, _mi); _m4.multiply(_mi); }
        _sph.copy(m.geometry.boundingSphere).applyMatrix4(_m4);
        const sc = _sph.center, sr = _sph.radius;
        near.length = 0;
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity;
        for (const r of sites) {
          if (sc.x + sr < r.x0 || sc.x - sr > r.x1 || sc.z + sr < r.z0 || sc.z - sr > r.z1 || sc.y + sr < r.yFloor) continue;
          near.push(r);
          x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); z0 = Math.min(z0, r.z0); z1 = Math.max(z1, r.z1); y0 = Math.min(y0, r.yFloor);
        }
        if (!near.length) continue;
        // índices sempre em Uint32Array: o laço quente (gatherTris) fica com um tipo só e é otimizado
        if (!X) X = I ? (I.array instanceof Uint32Array ? I.array : Uint32Array.from(I.array)) : Uint32Array.from({ length: P.count }, (_, i) => i);
        let A = P.array;
        if (!raw) {
          if (_V.length < P.count * 3) _V = new Float32Array(P.count * 3);
          const e = _m4.elements;
          for (let v = 0; v < P.count; v++) {
            const x = P.getX(v), y = P.getY(v), z = P.getZ(v);
            _V[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
            _V[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
            _V[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          }
          A = _V;
        }
        gatherTris(A, X, nt, near, x0, x1, z0, z1, y0, m);
      }
    }
    _V = new Float32Array(0);
  }
  // Grade 2D (8 m) com os triângulos da região: colisão de volumes e linha de visada.
  // Visada = fração de raios livres (câmeras -> grade 5 × 3 no painel) entre os pontos no campo de
  // visão (≈ 50° do eixo) e a menos de 230 m, contra os triângulos e o relevo (env.groundAt).
  function siteTester(site, W, H) {
    const { cams, x0, z0 } = site;
    const G = 8, nx = Math.max(1, Math.ceil((site.x1 - x0) / G)), nz = Math.max(1, Math.ceil((site.z1 - z0) / G));
    const tris = site.T.subarray(0, site.n);
    const nT = tris.length / 9;
    const grid = new Array(nx * nz);
    const cx = (x) => clamp(Math.floor((x - x0) / G), 0, nx - 1), cz = (z) => clamp(Math.floor((z - z0) / G), 0, nz - 1);
    for (let i = 0; i < nT; i++) {
      const o = i * 9;
      const ax = cx(Math.min(tris[o], tris[o + 3], tris[o + 6])), bx = cx(Math.max(tris[o], tris[o + 3], tris[o + 6]));
      const az = cz(Math.min(tris[o + 2], tris[o + 5], tris[o + 8])), bz = cz(Math.max(tris[o + 2], tris[o + 5], tris[o + 8]));
      for (let gz = az; gz <= bz; gz++) for (let gx = ax; gx <= bx; gx++) (grid[gz * nx + gx] || (grid[gz * nx + gx] = [])).push(i);
    }
    const mark = new Int32Array(nT);
    let stamp = 0;
    // caixa orientada x triângulos da região: nome da malha atravessada, ou null
    const hits = (o) => {
      const R = Math.hypot(o.hx, o.hy, o.hz);
      stamp++;
      for (let gz = cz(o.c.z - R); gz <= cz(o.c.z + R); gz++) for (let gx = cx(o.c.x - R); gx <= cx(o.c.x + R); gx++) {
        const list = grid[gz * nx + gx];
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (mark[i] === stamp) continue;
          mark[i] = stamp;
          const q = i * 9;
          if (Math.min(tris[q + 1], tris[q + 4], tris[q + 7]) > o.c.y + R || Math.max(tris[q + 1], tris[q + 4], tris[q + 7]) < o.c.y - R) continue;
          _tv[0].set(tris[q], tris[q + 1], tris[q + 2]); _tv[1].set(tris[q + 3], tris[q + 4], tris[q + 5]); _tv[2].set(tris[q + 6], tris[q + 7], tris[q + 8]);
          if (triHitsBox(_tv, o)) return site.M[i].name || 'objeto';
        }
      }
      return null;
    };
    // raio x triângulo (Möller–Trumbore), t em (0,3; tmax)
    const rayTri = (i, ox, oy, oz, dx, dy, dz, tmax) => {
      const o = i * 9;
      const e1x = tris[o + 3] - tris[o], e1y = tris[o + 4] - tris[o + 1], e1z = tris[o + 5] - tris[o + 2];
      const e2x = tris[o + 6] - tris[o], e2y = tris[o + 7] - tris[o + 1], e2z = tris[o + 8] - tris[o + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-9) return false;
      const inv = 1 / det;
      const sx = ox - tris[o], sy = oy - tris[o + 1], sz = oz - tris[o + 2];
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) return false;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) return false;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      return t > 0.3 && t < tmax;
    };
    const blockedRay = (ox, oy, oz, dx, dy, dz, len) => {
      stamp++;
      let last = -1;
      for (let t = 0; t <= len + 1.5; t += 1.5) {
        const tt = Math.min(t, len);
        const gx = Math.floor((ox + dx * tt - x0) / G), gz = Math.floor((oz + dz * tt - z0) / G);
        if (gx < 0 || gz < 0 || gx >= nx || gz >= nz) continue;
        const ci = gz * nx + gx;
        if (ci === last) continue;
        last = ci;
        const list = grid[ci];
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (mark[i] === stamp) continue;
          mark[i] = stamp;
          if (rayTri(i, ox, oy, oz, dx, dy, dz, len - 0.4)) return true;
        }
      }
      // relevo (morros, cortes)
      for (let t = 3; t < len - 2; t += 4) if (terrainY(ox + dx * t, oz + dz * t) > oy + dy * t + 0.05) return true;
      return false;
    };
    const sight = (cand) => {
      const c = new THREE.Vector3(cand.base.x, cand.y0 + H / 2, cand.base.z);
      let seen = 0, tested = 0;
      for (const cam of cams) {
        // só quem vê a frente do painel
        if ((cam.p.x - c.x) * cand.az.x + (cam.p.z - c.z) * cand.az.z <= 0) continue;
        for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
          const u = (i / 4 - 0.5) * W * 0.9, w = (j / 2 - 0.5) * H * 0.8;
          const px = c.x + cand.ax.x * u + cand.az.x * 0.35, py = c.y + w, pz = c.z + cand.ax.z * u + cand.az.z * 0.35;
          let dx = px - cam.p.x, dy = py - cam.p.y, dz = pz - cam.p.z;
          const len = Math.hypot(dx, dy, dz);
          if (len > 230) continue;
          dx /= len; dy /= len; dz /= len;
          if (dx * cam.f.x + dy * cam.f.y + dz * cam.f.z < 0.64) continue;
          tested++;
          if (!blockedRay(cam.p.x, cam.p.y, cam.p.z, dx, dy, dz, len)) seen++;
        }
      }
      return { sight: tested >= 15 ? seen / tested : 0, tested };
    };
    return { hits, sight };
  }

  // ------------------------------------------------------------ outdoors sobre pés (12 × 4 m)
  const BILL_W0 = 12, BILL_H0 = 4;
  const billMoves = [], billSight = [];
  // posição candidata: base, orientação (de frente para o ponto faceS) e chão sob os pés
  function billLayout(s2, lat2, faceS, { clear = 4.4, yawAdj = 0, k: kk = 1 } = {}) {
    const BILL_W = BILL_W0 * kk, BILL_H = BILL_H0 * kk;
    const target = at(faceS).pos;
    const legX = BILL_W * 0.3;
    const f = at(s2);
    const base = f.pos.clone().addScaledVector(f.right, lat2);
    const az = new THREE.Vector3(target.x - base.x, 0, target.z - base.z).normalize();
    if (yawAdj) az.applyAxisAngle(UP, yawAdj);
    const ax = new THREE.Vector3(az.z, 0, -az.x); // direita de quem olha (ax × ay = az)
    const legPos = [-1, 1].map((k) => base.clone().addScaledVector(ax, k * legX).addScaledVector(az, -0.5));
    const grounds = legPos.map((p) => groundAt(p.x, p.z, s2));
    const gy = Math.max(...grounds);
    const y0 = gy + clear;
    // volume inteiro (pés acima de 0,9 m, painel, refletores), para a verificação
    const lo = Math.min(...grounds) + 0.9, top = y0 + BILL_H + 0.8;
    const vol = {
      c: base.clone().addScaledVector(az, 0.475).setY((lo + top) / 2), ax, ay: UP, az,
      hx: BILL_W / 2 + 0.35, hy: (top - lo) / 2, hz: 1.275,
    };
    return { s: s2, lat: lat2, base, az, ax, legPos, grounds, y0, vol, BILL_W, BILL_H, legX };
  }
  function billboard(id, s, lat, faceS, o, site) {
    // procura o lugar mais próximo do pedido que não atravesse nada (árvores mudam com a qualidade)
    // e que as câmeras vejam: aceita o primeiro com visada ≥ 80%; senão, o de melhor visada
    const out = Math.sign(lat) || 1;
    const k = o.k || 1;
    const test = siteTester(site, BILL_W0 * k, BILL_H0 * k);
    let L = null, best = null, blockedBy = null;
    for (const [dS, dL] of TRIES) {
      const cand = billLayout(s + dS, lat + out * dL, faceS, o);
      const hit = test.hits(cand.vol);
      if (hit) { if (!blockedBy) blockedBy = hit; continue; }
      Object.assign(cand, test.sight(cand));
      if (cand.sight >= 0.8) { L = cand; break; }
      if (!best || cand.sight > best.sight) best = cand;
    }
    if (!L) L = best || billLayout(s, lat, faceS, o); // nada livre: fica no lugar pedido
    if (L.s !== s || L.lat !== lat) billMoves.push(`${id}: ${blockedBy || 'visada'} -> s ${L.s.toFixed(0)}, lat ${L.lat.toFixed(0)}`);
    billSight.push({ id, s: L.s, lat: L.lat, sight: L.sight === undefined ? null : +L.sight.toFixed(2), rays: L.tested || 0 });
    const { base, az, ax, legPos, grounds, y0, BILL_W, BILL_H, legX } = L;
    const g = geoAt(base.x, base.z);
    const c = new THREE.Vector3(base.x, y0 + BILL_H / 2, base.z);
    // painel
    g.box(c, ax, UP, az, BILL_W / 2, BILL_H / 2, 0.14, C.back, { front: atlas.uv(id), glow: 0.36 });
    solid('outdoor', c, ax, UP, az, BILL_W / 2, BILL_H / 2, 0.14);
    // moldura saliente
    const fr = (dx, dy, hx, hy) => {
      const p = c.clone().addScaledVector(ax, dx).addScaledVector(UP, dy).addScaledVector(az, 0.08);
      g.box(p, ax, UP, az, hx, hy, 0.2, C.frame);
    };
    fr(0, BILL_H / 2 + 0.1, BILL_W / 2 + 0.2, 0.1);
    fr(0, -BILL_H / 2 - 0.1, BILL_W / 2 + 0.2, 0.1);
    fr(-BILL_W / 2 - 0.1, 0, 0.1, BILL_H / 2);
    fr(BILL_W / 2 + 0.1, 0, 0.1, BILL_H / 2);
    // faixa verde no topo da moldura
    const top = c.clone().addScaledVector(UP, BILL_H / 2 + 0.212).addScaledVector(az, 0.08);
    g.box(top, ax, UP, az, BILL_W / 2 + 0.2, 0.012, 0.2, C.green, { skip: 'b' });
    // pés, travessa e mãos-francesas
    legPos.forEach((p, k2) => {
      const bottom = grounds[k2] - 0.6, topY = y0 + BILL_H * 0.85;
      const lc = new THREE.Vector3(p.x, (bottom + topY) / 2, p.z);
      g.box(lc, ax, UP, az, 0.24, (topY - bottom) / 2, 0.24, C.leg, { skip: 'b' });
      solid('outdoor-pé', lc, ax, UP, az, 0.24, (topY - bottom) / 2, 0.24);
      foot({ tag: 'outdoor', x: p.x, y: bottom, z: p.z, g: grounds[k2] });
      // sapata de concreto
      const fc = new THREE.Vector3(p.x, grounds[k2] + 0.1, p.z);
      g.box(fc, ax, UP, az, 0.55, 0.3, 0.55, col(0xb9bdb6), { skip: 'b' });
      foot({ tag: 'sapata', x: p.x, y: grounds[k2] - 0.2, z: p.z, g: grounds[k2] });
    });
    const beamC = c.clone().addScaledVector(UP, -BILL_H / 2 - 0.45).addScaledVector(az, -0.5);
    g.box(beamC, ax, UP, az, legX + 0.24, 0.14, 0.14, C.leg);
    solid('outdoor-viga', beamC, ax, UP, az, legX + 0.24, 0.14, 0.14);
    if (hi) {
      // mãos-francesas em X entre os pés
      const ya = Math.min(...grounds) + 0.9, yb2 = y0 - 0.7;
      for (const k2 of [-1, 1]) {
        const a = base.clone().addScaledVector(ax, -legX * k2).addScaledVector(az, -0.5); a.y = ya;
        const b = base.clone().addScaledVector(ax, legX * k2).addScaledVector(az, -0.5); b.y = yb2;
        const d = b.clone().sub(a);
        const len = d.length();
        const dy = d.clone().normalize();
        const dz = az.clone();
        const dx = new THREE.Vector3().crossVectors(dy, dz).normalize();
        const mc = a.clone().add(b).multiplyScalar(0.5);
        g.box(mc, dx, dy, dz, 0.06, len / 2, 0.06, C.leg, { skip: 'tb' });
      }
      // passarela e refletores
      const cw = c.clone().addScaledVector(UP, -BILL_H / 2 - 0.26).addScaledVector(az, 0.55);
      g.box(cw, ax, UP, az, BILL_W / 2, 0.05, 0.45, C.catwalk);
      solid('outdoor-passarela', cw, ax, UP, az, BILL_W / 2, 0.05, 0.45);
      for (const t of [-0.375, -0.125, 0.125, 0.375]) {
        const arm = c.clone().addScaledVector(ax, t * BILL_W).addScaledVector(UP, BILL_H / 2 + 0.34).addScaledVector(az, 0.75);
        g.box(arm, ax, UP, az, 0.04, 0.04, 0.72, C.leg);
        const head = c.clone().addScaledVector(ax, t * BILL_W).addScaledVector(UP, BILL_H / 2 + 0.3).addScaledVector(az, 1.5);
        g.box(head, ax, UP, az, 0.28, 0.1, 0.16, C.frame, { skip: 'b' });
        // lente acesa voltada para o painel
        const lens = head.clone().addScaledVector(UP, -0.101);
        g.face(lens, UP.clone().negate(), ax, az, 0, 0.24, 0.12, C.lamp, null, 1.2);
      }
    }
    return { id, base, az, s: L.s, lat: L.lat };
  }
  // [id, s, lateral, s para onde olha, opções]
  const BILLS = [
    // Grampo: visto de frente por quem sai da ponte (maior, como nas zonas de frenagem)
    ['b0', 978, 26, 895, { k: 1.25 }],
    // Curva final: fim da reta de Tesla, à esquerda do pórtico
    ['b2', 1545, -25, 1450, { k: 1.3 }],
    // Cume: fim da subida do Observatório
    ['b1', 616, 30, 520, {}],
    // Fim da reta de largada (zona de frenagem, por fora), alto para passar por cima da placa F = m·a
    ['b3', 132, -30, 10, { clear: 6.2 }],
    // Descida do Observatório para a ponte (na reta de Tesla as bobinas escondiam o painel)
    ['b4', B4[0], B4[1], B4[2], { clear: B4[3] }],
  ];
  const bb = [];
  {
    const sites = BILLS.map(([id, s, lat, faceS, o]) => part(`outdoor ${id}`, () => billSite(s, lat, faceS, o)));
    part('outdoors: cenário', () => collectSites(sites.filter(Boolean)));
    lap('outdoors-cenario');
    BILLS.forEach(([id, s, lat, faceS, o], i) => {
      if (sites[i]) part(`outdoor ${id}`, () => bb.push(billboard(id, s, lat, faceS, o, sites[i])));
    });
  }
  lap('outdoors');
  if (!DEBUG) blockers = null; // libera a lista (a página de teste ainda usa)

  // ------------------------------------------------------------ faixas nas coberturas das arquibancadas
  part('arquibancadas', () => {
    // mesma geometria de environment.js
    const a = at(LEN - 40).pos, b = at(95).pos;
    const dir = b.clone().sub(a).setY(0).normalize();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    const wd = at(0).wd;
    const seq = ['f0', 'f1', 'f0', 'f2'];
    let k = 0;
    for (const [x0, x1] of [[-36, 40], [44, 108]]) {
      const len = x1 - x0, mid = (x0 + x1) / 2;
      const base = new THREE.Vector3(mid, 0, 0).addScaledVector(right, wd + 5);
      base.y = terrainY(base.x, base.z);
      const H = 1.4, T = 0.14;
      const segL = H * 8;
      const n = Math.max(1, Math.round(len / segL));
      const sl = len / n;
      const faceC = base.clone().addScaledVector(right, -0.5 + 0.06 + T / 2); // borda da frente da cobertura
      const yc = base.y + 12.0 - 0.02 - H / 2;
      const az = right.clone().negate(); // de frente para a pista
      const ax = new THREE.Vector3(az.z, 0, -az.x);
      for (let j = 0; j < n; j++) {
        const along = -len / 2 + (j + 0.5) * sl;
        const c = faceC.clone().addScaledVector(ax, along);
        c.y = yc;
        const g = geoAt(c.x, c.z);
        g.box(c, ax, UP, az, sl / 2, H / 2, T / 2, C.frame, { front: atlas.uv(seq[k++ % seq.length]), glow: 0.3, skip: (j ? 'l' : '') + (j < n - 1 ? 'r' : '') });
        solid('faixa-arquibancada', c, ax, UP, az, sl / 2, H / 2, T / 2);
      }
    }
  });

  // ------------------------------------------------------------ coroas sobre pórticos (arte dos dois lados)
  const crown = (tag, f, y0, W, H, region) => {
    const az = f.fwd.clone().negate(); // de frente para quem chega
    const ax = new THREE.Vector3(az.z, 0, -az.x);
    const T = 0.3;
    const c = f.pos.clone(); c.y = y0 + H / 2;
    const g = geoAt(c.x, c.z);
    // frente e verso com a arte (o verso já lê certo de quem olha de trás)
    const uvF = atlas.uv(region);
    g.box(c, ax, UP, az, W / 2, H / 2, T / 2, C.frame, { front: uvF, back: uvF, glow: 0.34 });
    solid(tag, c, ax, UP, az, W / 2, H / 2, T / 2);
    for (const k of [-1, 1]) {
      const p = c.clone().addScaledVector(ax, k * W * 0.32); p.y = y0 - 0.06;
      g.box(p, ax, UP, az, 0.18, 0.07, 0.12, C.frame);
    }
  };
  // Largada: sobre a faixa quadriculada do pórtico com luzes
  part('coroa-largada', () => {
    const f = at(0);
    crown('coroa-largada', f, f.pos.y + 8.4 + 1.3 + 1.75 + 0.45 + 0.12, 14, 1.75, 'crown');
  });
  // Reta de Tesla: "oferecimento" sobre a viga do pórtico temático, de frente para quem sai do túnel
  // (viga no topo a h + placa + 0,5 = 10,1 m, como em track.js; os arcos das bobinas passam acima de 12,3 m)
  part('coroa-tesla', () => {
    const f = at(ts[1] + 50);
    crown('coroa-tesla', f, f.pos.y + 7.2 + 2.4 + 0.5 + 0.12, 12, 1.5, 'tunnel');
  });

  // ------------------------------------------------------------ túnel: "oferecimento" sobre a fachada da entrada
  // arte dos dois lados: o verso é visto da subida do Observatório, que passa por cima do túnel
  // (a fachada da saída não recebe placa: fica de costas para quem corre)
  part('túnel', () => {
    const i0 = Math.ceil(ts[0] / ds) + 1, i1 = Math.floor(ts[1] / ds);
    const s = ts[0];
    const i = Math.round(s / ds);
    const f = at(s);
    const tp = meta.tunnelProfile(s, WD[i]);
    const mt = (meta.moundTop && meta.moundTop[clamp(i, i0, i1)]) || tp.top + 1;
    const Hh = mt + 1.8;
    const W = 14, H = 1.75, T = 0.3;
    const az = f.fwd.clone().negate();
    const ax = new THREE.Vector3(az.z, 0, -az.x);
    // sobre o topo da fachada, rente à face da frente
    const c = f.pos.clone().addScaledVector(az, 0.5 - 0.06 - T / 2);
    c.y = f.pos.y + Hh + 0.02 + H / 2;
    const uvT = atlas.uv('tunnel');
    geoAt(c.x, c.z).box(c, ax, UP, az, W / 2, H / 2, T / 2, C.frame, { front: uvT, back: uvT, glow: 0.36, skip: 'b' });
    solid('faixa-túnel', c, ax, UP, az, W / 2, H / 2 - 0.01, T / 2);
  });

  // ------------------------------------------------------------ ponte: faixa entre os tirantes do meio
  part('ponte', () => {
    // tirante mais próximo do meio do vão (a cada 6 m a partir da cabeceira)
    const mid = (bs[0] + bs[1]) / 2;
    const s = bs[0] + 6 + Math.round((mid - bs[0] - 6) / 6) * 6;
    const f = at(s);
    const j = Math.round(s / ds);
    const rise = 17 * Math.sin(Math.PI * clamp((s - bs[0]) / (bs[1] - bs[0]), 0, 1));
    const hangerLat = WD[j] + 1.9 - 0.08;
    const W = hangerLat * 2, H = W / 9.6, T = 0.12;
    const top = f.pos.y + 0.6 + rise - 0.45 - 0.25;
    const c = f.pos.clone(); c.y = top - H / 2;
    const az = f.fwd.clone().negate();
    const ax = new THREE.Vector3(az.z, 0, -az.x);
    const g = geoAt(c.x, c.z);
    g.box(c, ax, UP, az, W / 2, H / 2, T / 2, C.frame, { front: atlas.uv('bridge'), back: atlas.uv('bridge'), glow: 0.34 });
    solid('faixa-ponte', c, ax, UP, az, W / 2 - 0.02, H / 2, T / 2);
    // presilhas nos tirantes
    for (const k of [-1, 1]) for (const dy of [-H / 2 + 0.2, H / 2 - 0.2]) {
      const p = c.clone().addScaledVector(ax, k * (W / 2 - 0.12)); p.y += dy;
      g.box(p, ax, UP, az, 0.12, 0.1, 0.12, C.steel);
    }
  });

  // ------------------------------------------------------------ malhas estáticas
  // a menor célula junta-se à vizinha mais próxima até sobrarem poucos pedaços (menos draw calls;
  // na baixa quase não há triângulos, então o culling vale menos que as chamadas)
  {
    const target = hi ? 3 : 2;
    const center = (k) => k.split(',').map(Number);
    const tris = (k) => cells.get(k).idx.length / 3;
    while (cells.size > target) {
      let k = null;
      for (const o of cells.keys()) if (k === null || tris(o) < tris(k)) k = o;
      const [a, b] = center(k);
      let best = null, bd = Infinity;
      for (const o of cells.keys()) {
        if (o === k) continue;
        const [c2, d] = center(o);
        const dd = (a - c2) ** 2 + (b - d) ** 2;
        if (dd < bd) { bd = dd; best = o; }
      }
      cells.get(best).append(cells.get(k));
      cells.delete(k);
    }
  }
  let mk = 0;
  for (const b of cells.values()) {
    if (!b.count) continue;
    const m = new THREE.Mesh(b.build(), mat);
    m.name = `anuncios-${mk++}`;
    m.castShadow = !!quality.shadows;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    group.add(m);
    disposables.push(m.geometry);
  }
  cells.clear(); // arrays de montagem não servem mais
  lap('faixas+malhas');

  // ------------------------------------------------------------ tinta no chão (não é sólida: pode ficar dentro do corredor)
  // Logo no jardim da universidade (visto do alto: grua do título, vistas aéreas); faixas nos acostamentos
  // da reta de largada; e, para quem corre, faixas na área de escape por fora do grampo e da curva do
  // Laboratório, lidas de frente durante a frenagem (texto correndo ao longo da curva, topo para fora).
  part('tinta', () => {
    const b = new Geo(atlas.white);
    const white = col(0xffffff), mint = col(0x2ee89a);
    const V0 = 256 / 1280; // limite entre a marca (em cima) e a faixa (embaixo) no canvas da tinta
    // grade n × m de pontos (fn(i/n, j/m) -> [x, y, z]) mapeada em [u0..u1] × [v0..v1]
    const patch = (n, m, fn, u0, v0, u1, v1, color) => {
      const base = b.count;
      for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) {
        const [x, y, z] = fn(i / n, j / m);
        b.vert(x, y, z, 0, 1, 0, color, lerp(u0, u1, i / n), lerp(v0, v1, j / m), 0);
      }
      for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i;
        b.idx.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
      }
    };
    // jardim: entre a ala oeste do prédio e a pista, longe dos canteiros, árvores e pedras
    const cx = -10.2, cz = -36.2, S = 19;
    const n = hi ? 12 : 6;
    patch(n, n, (u, v) => {
      const x = cx - S / 2 + u * S, z = cz + S / 2 - v * S;
      return [x, terrainY(x, z) + 0.04, z];
    }, 0, V0, 1, 1, white);
    solid('gramado-logo', new THREE.Vector3(cx, terrainY(cx, cz) + 0.15, cz), new THREE.Vector3(1, 0, 0), UP, new THREE.Vector3(0, 0, 1), S / 2, 0.1, S / 2);
    // faixa no acostamento a partir de sA, lado side, entre halfWidth + inner e wallDist - 0,45;
    // comprimento real (medido na linha do meio da faixa) = 3,9 × largura, como a arte.
    // Lado esquerdo lê no sentido da corrida; o direito, ao contrário (sempre da esquerda para a direita
    // de quem olha da pista), com o topo das letras para fora.
    const strip = (sA, side, inner, color, segs) => {
      const r0 = track.sample(sA);
      const width = r0.wallDist - 0.45 - (r0.halfWidth + inner);
      const want = width * 3.9, latM = r0.halfWidth + inner + width / 2;
      let len = 0, sB = sA;
      const pa = r0.pos.clone().addScaledVector(r0.right, side * latM), pb = new THREE.Vector3();
      while (len < want && sB < sA + 60) {
        sB += 0.25;
        const r = track.sample(sB);
        pb.copy(r.pos).addScaledVector(r.right, side * latM);
        len += Math.hypot(pb.x - pa.x, pb.z - pa.z);
        pa.copy(pb);
      }
      const span = sB - sA;
      patch(segs, 1, (u, v) => {
        const s = side < 0 ? sA + u * span : sA + span - u * span;
        const r = track.sample(s);
        const lat = side * lerp(r.halfWidth + inner, r.wallDist - 0.45, v);
        return [r.pos.x + r.right.x * lat, r.pos.y + 0.02, r.pos.z + r.right.z * lat];
      }, 0.01, 0.005, 0.99, V0 - 0.005, color);
    };
    for (const side of [-1, 1]) strip(34, side, 0.55, white, 8);
    // escape do grampo (areia: tinta verde-menta) e da curva do Laboratório (grama: branca);
    // por dentro das zebras (1,4 m) quando houver
    strip(RUNOFF.hairpin, 1, 1.85, mint, 16);
    strip(RUNOFF.lab, -1, 0.55, white, 12);
    const geo = b.build();
    geo.deleteAttribute('glow');
    // tinta: textura pré-multiplicada (sem franja escura nos mipmaps) e mistura "one, 1 - alfa"
    const k = 0.92;
    const m = new THREE.MeshLambertMaterial({
      map: atlas.grassTex, color: new THREE.Color(k, k, k), vertexColors: true, transparent: true, opacity: k, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const lawn = new THREE.Mesh(geo, m);
    lawn.name = 'gramado-logo';
    lawn.receiveShadow = true;
    lawn.renderOrder = 1;
    lawn.matrixAutoUpdate = false;
    lawn.updateMatrix();
    lawn.userData.noCorridor = true; // tinta no chão
    group.add(lawn);
    disposables.push(geo, m);
  });

  // ------------------------------------------------------------ dirigível
  let blimp = null, orbit = null;
  const bp = new THREE.Vector3(), bt = new THREE.Vector3(), bq = new THREE.Quaternion(), be = new THREE.Euler(0, 0, 0, 'YXZ');
  function placeBlimp(t) {
    const { cx, cz, a, b } = orbit;
    const ang = orbit.ang;
    bp.set(cx + Math.cos(ang) * a, orbit.alt + Math.sin(t * 0.21) * 1.6, cz + Math.sin(ang) * b);
    // tangente (sentido anti-horário visto de cima: ângulo crescente)
    bt.set(-Math.sin(ang) * a, 0, Math.cos(ang) * b).normalize();
    be.set(Math.sin(t * 0.33) * 0.03, Math.atan2(bt.x, bt.z), -0.05);
    bq.setFromEuler(be);
    blimp.mesh.position.copy(bp);
    blimp.mesh.quaternion.copy(bq);
  }
  part('dirigível', () => {
    const bl = buildBlimp(hi, atlas, C);
    disposables.push(bl.mesh.geometry);
    bl.mesh.material = mat;
    bl.mesh.castShadow = !!quality.shadows;
    // órbita elíptica alta em volta do circuito
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < N; i += 4) {
      minX = Math.min(minX, meta.X[i]); maxX = Math.max(maxX, meta.X[i]);
      minZ = Math.min(minZ, meta.Z[i]); maxZ = Math.max(maxZ, meta.Z[i]);
    }
    orbit = {
      cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
      a: (maxX - minX) / 2 * 0.85, b: (maxZ - minZ) / 2 * 0.8,
      alt: 58, speed: 7.5, ang: 2.2,
    };
    blimp = bl;
    placeBlimp(0);
    group.add(bl.mesh);
  });

  lap('tinta+dirigivel');

  // ------------------------------------------------------------ fonte e logotipo reais
  // O atlas nasce com o que já chegou. O que chegar até o prazo (carregamento / título) entra num
  // redesenho só. Depois do prazo, só a fonte ainda justifica redesenhar (o logo vetorial é quase igual
  // ao PNG). Com o laço do jogo rodando, o redesenho é pintado aos poucos em update() (≈ 3 ms por quadro)
  // e vai para a GPU uma vez só, no fim.
  const DEADLINE = 6000;
  const now = clock;
  const drawn = { font: fontWasReady, logo: logoWasReady };
  let redraws = 0, jobs = null, lastRun = -Infinity, timer = 0;
  const redraw = (force) => {
    redraws++;
    drawn.font = brandFontLoaded();
    drawn.logo = logoReadyNow();
    if (force !== 'jobs' && (force === 'now' || now() - lastRun > 400)) { atlas.draw(); atlas.upload(); jobs = null; }
    else jobs = atlas.jobs();
  };
  const maybeRedraw = (late) => {
    if (!alive) return;
    const font = brandFontLoaded() && !drawn.font;
    const logo = logoReadyNow() && !drawn.logo;
    if (font || (logo && !late)) redraw();
  };
  if (!fontWasReady || !logoWasReady) {
    const deadline = new Promise((r) => { timer = setTimeout(r, DEADLINE); });
    Promise.race([Promise.allSettled([loadLogo(), loadBrandFont()]), deadline]).then(() => {
      clearTimeout(timer);
      timer = 0;
      maybeRedraw(false);
      if (alive && !drawn.font) loadBrandFont().then(() => maybeRedraw(true));
    });
  }

  // ------------------------------------------------------------ atualização
  let time = 0;
  function update(dt) {
    if (jobs) {
      const t0 = now();
      do { jobs.shift()(); } while (jobs.length && now() - t0 < 3);
      if (!jobs.length) { jobs = null; atlas.upload(); }
    }
    if (!dt) return;
    lastRun = now();
    time += dt;
    if (!blimp) return;
    // velocidade angular aproximada para velocidade constante na elipse
    const { a, b } = orbit;
    const r = Math.hypot(Math.sin(orbit.ang) * a, Math.cos(orbit.ang) * b);
    orbit.ang = (orbit.ang + (orbit.speed * dt) / Math.max(1, r)) % TAU;
    placeBlimp(time);
    blimp.spin(dt);
  }

  const handle = {
    group,
    update,
    dispose() {
      alive = false;
      if (timer) clearTimeout(timer);
      jobs = null;
      scene.remove(group);
      disposables.forEach((d) => d.dispose && d.dispose());
      art.tint.clear();
    },
  };
  if (DEBUG) {
    handle.atlas = atlas.tex; // extras só para a página de teste
    handle.debug = {
      solids, feet, boards: () => boardCount, billboards: bb, billMoves, billSight, skipped, times,
      canvases: { atlas: atlas.canvas, grass: atlas.grass },
      get redraws() { return redraws; }, get pending() { return jobs ? jobs.length : 0; },
      drawnWithLogo: logoWasReady, drawnWithFont: fontWasReady, orbit,
      // redesenha já ('now') ou aos poucos em update() ('jobs'), como no redesenho tardio
      redraw: (mode = 'jobs') => redraw(mode),
      // nota de visada de um outdoor hipotético (para escolher lugares)
      sight: (s, lat, faceS, o = {}) => {
        const k = o.k || 1;
        const site = billSite(s, lat, faceS, o);
        collectSites([site]);
        const test = siteTester(site, BILL_W0 * k, BILL_H0 * k);
        const L = billLayout(s, lat, faceS, o);
        return { ...test.sight(L), hit: test.hits(L.vol) };
      },
    };
  }
  return handle;
}


// Laço quente da coleta (fora do closure; índices sempre em Uint32Array)
function gatherTris(A, X, nt, near, x0, x1, z0, z1, y0, m) {
  for (let t = 0; t < nt; t++) {
    const a = X[t * 3] * 3, b = X[t * 3 + 1] * 3, c = X[t * 3 + 2] * 3;
    const ax0 = A[a], bx0 = A[b], cx0 = A[c];
    if ((ax0 > x1 && bx0 > x1 && cx0 > x1) || (ax0 < x0 && bx0 < x0 && cx0 < x0)) continue;
    const az0 = A[a + 2], bz0 = A[b + 2], cz0 = A[c + 2];
    if ((az0 > z1 && bz0 > z1 && cz0 > z1) || (az0 < z0 && bz0 < z0 && cz0 < z0)) continue;
    const ay0 = A[a + 1], by0 = A[b + 1], cy0 = A[c + 1];
    if (ay0 < y0 && by0 < y0 && cy0 < y0) continue;
    const mnx = ax0 < bx0 ? (ax0 < cx0 ? ax0 : cx0) : (bx0 < cx0 ? bx0 : cx0);
    const mxx = ax0 > bx0 ? (ax0 > cx0 ? ax0 : cx0) : (bx0 > cx0 ? bx0 : cx0);
    const mnz = az0 < bz0 ? (az0 < cz0 ? az0 : cz0) : (bz0 < cz0 ? bz0 : cz0);
    const mxz = az0 > bz0 ? (az0 > cz0 ? az0 : cz0) : (bz0 > cz0 ? bz0 : cz0);
    const mxy = ay0 > by0 ? (ay0 > cy0 ? ay0 : cy0) : (by0 > cy0 ? by0 : cy0);
    for (let q = 0; q < near.length; q++) {
      const r = near[q];
      if (mnx > r.x1 || mxx < r.x0 || mnz > r.z1 || mxz < r.z0 || mxy < r.yFloor) continue;
      if (r.n + 9 > r.T.length) { const nb = new Float32Array(r.T.length * 2 + 9 * 1024); nb.set(r.T); r.T = nb; }
      const T = r.T, o = r.n;
      r.M[o / 9] = m;
      T[o] = ax0; T[o + 1] = ay0; T[o + 2] = az0; T[o + 3] = bx0; T[o + 4] = by0; T[o + 5] = bz0; T[o + 6] = cx0; T[o + 7] = cy0; T[o + 8] = cz0;
      r.n = o + 9;
    }
  }
}

// ---------------------------------------------------------------------------
// Dirigível (homenagem aos dirigíveis de Santos Dumont): envelope, empenagem, gôndola e motores.
// Frente em +Z local. As hélices giram reescrevendo só os seus vértices.
function buildBlimp(hi, atlas, C) {
  const g = new Geo(atlas.white);
  const LB = 34, RM = 4.4;
  const NR = hi ? 26 : 14, NS = hi ? 24 : 12;
  const TM = 0.58; // raio máximo (a partir da cauda)
  const rAt = (t) => {
    if (t >= TM) return RM * Math.sqrt(Math.max(0, 1 - ((t - TM) / (1 - TM)) ** 2));
    return RM * Math.pow(Math.max(0, 1 - Math.pow((TM - t) / TM, 1.9)), 0.62);
  };
  // anéis mais densos no nariz e na cauda
  const ts = [];
  for (let i = 0; i <= NR; i++) {
    const u = i / NR;
    ts.push(0.5 - 0.5 * Math.cos(u * Math.PI));
  }
  const zAt = (t) => -LB / 2 + t * LB;
  const drdz = (t) => (rAt(Math.min(1, t + 0.002)) - rAt(Math.max(0, t - 0.002))) / ((Math.min(1, t + 0.002) - Math.max(0, t - 0.002)) * LB);
  // envelope claro, barriga verde da marca (é o que se vê da pista), friso escuro entre os dois
  const env = col(ENVELOPE), dark = col(0x0f2a1e), stripe = col(0x0f2a1e), belly = col(BRAND.deep);
  // Gomos em volta (φ a partir do lado +x, subindo): painel com a arte em cada lado,
  // friso verde logo abaixo e barriga escura. O lado -x é o espelho do +x.
  const D = 360 / NS;
  // faixa da arte de -30° a +45° (alta) ou +30° (baixa): voltada para quem olha lá de baixo, a 100–250 m
  const jLo = Math.round(-30 / D), jHi = Math.max(jLo + 2, Math.floor(45 / D)), jSt = jLo - 1;
  const mod = (j) => ((j % NS) + NS) % NS;
  const mirror = (j) => mod(NS / 2 - 1 - j);
  const kind = new Array(NS).fill('env');
  for (let j = jSt; j < jLo; j++) { kind[mod(j)] = 'env'; kind[mirror(j)] = 'env'; }
  kind[mod(jSt)] = 'stripe'; kind[mirror(jSt)] = 'stripe';
  for (let j = jLo; j < jHi; j++) { kind[mod(j)] = 'R'; kind[mirror(j)] = 'L'; }
  for (let j = 0; j < NS; j++) if (kind[j] === 'env' && Math.sin(((j + 0.5) * D * Math.PI) / 180) < -0.55) kind[j] = 'dark';
  const panelT0 = 0.2, panelT1 = 0.82;
  let pi0 = 0, pi1 = NR;
  while (ts[pi0] < panelT0) pi0++;
  while (ts[pi1] > panelT1) pi1--;
  const uvP = atlas.uv('blimp');
  const P = new THREE.Vector3(), Nn = new THREE.Vector3();
  const vtx = (i, j, out, nout) => {
    const t = ts[i], r = rAt(t), phi = (j / NS) * TAU;
    out.set(Math.cos(phi) * r, Math.sin(phi) * r, zAt(t));
    nout.set(Math.cos(phi), Math.sin(phi), -drdz(t)).normalize();
  };
  for (let i = 0; i < NR; i++) {
    for (let j = 0; j < NS; j++) {
      const k = kind[j];
      const panel = (k === 'R' || k === 'L') && i >= pi0 && i < pi1;
      let color = k === 'dark' ? belly : k === 'stripe' ? stripe : env;
      if (i === NR - 1 || i === 0) color = dark; // capa do nariz / ponta da cauda
      const glow = k === 'dark' ? 0.22 : 0.1;
      const b = g.count;
      for (const [ii, jj] of [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]) {
        vtx(ii, jj, P, Nn);
        let u = atlas.white[0], v = atlas.white[1];
        if (panel) {
          const tz = (ts[ii] - ts[pi0]) / (ts[pi1] - ts[pi0]);
          // ângulo do vértice medido a partir do lado do painel (sempre subindo)
          let ang = jj * D;
          if (k === 'R') { if (ang >= 180) ang -= 360; } else ang = 180 - ang;
          const tv = (ang - jLo * D) / ((jHi - jLo) * D);
          // lado +x lê do nariz para a cauda; lado -x, da cauda para o nariz
          const tu = k === 'R' ? 1 - tz : tz;
          u = lerp(uvP[0], uvP[2], clamp(tu, 0, 1));
          v = lerp(uvP[1], uvP[3], clamp(tv, 0, 1));
        }
        g.vert(P.x, P.y, P.z, Nn.x, Nn.y, Nn.z, panel ? WHITE_COL : color, u, v, glow);
      }
      g.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
  }
  // empenagem em cruz (verde da marca)
  const finCol = col(BRAND.deep);
  const fin = (phi) => {
    const dx = Math.cos(phi), dy = Math.sin(phi);
    const t0 = 0.05, t1 = 0.22;
    const z0 = zAt(t0), z1 = zAt(t1);
    const r0 = rAt(t0 + 0.02) * 0.7, r1 = rAt(t1) * 0.85;
    const span = phi === -Math.PI / 2 ? 2.6 : 3.3;
    const th = 0.14;
    const nx = -dy, ny = dx; // normal lateral da aleta
    const pts = [
      [z0, r0], [z1, r1], [z1 - 1.4, r1 + span], [z0 - 0.6, r0 + span * 0.92],
    ];
    const V = (k, s) => new THREE.Vector3(dx * pts[k][1] + nx * th * s, dy * pts[k][1] + ny * th * s, pts[k][0]);
    // duas faces grandes e bordas
    g.quad(V(0, 1), V(1, 1), V(2, 1), V(3, 1), finCol, null, 0.08);
    g.quad(V(1, -1), V(0, -1), V(3, -1), V(2, -1), finCol, null, 0.08);
    g.quad(V(3, -1), V(3, 1), V(2, 1), V(2, -1), dark);
    g.quad(V(2, -1), V(2, 1), V(1, 1), V(1, -1), dark);
    g.quad(V(0, -1), V(0, 1), V(3, 1), V(3, -1), dark);
  };
  fin(Math.PI / 2); fin(-Math.PI / 2); fin(0); fin(Math.PI);
  // gôndola com janelas
  const gz = 1.4, gl = 5.6, gw = 0.85, gh = 0.75;
  const gy = -RM - 0.55;
  const ax = new THREE.Vector3(1, 0, 0), ay = new THREE.Vector3(0, 1, 0), az = new THREE.Vector3(0, 0, 1);
  g.box(new THREE.Vector3(0, gy, gz), ax, ay, az, gw, gh, gl / 2, col(0x163a2a), { glow: 0.05 });
  for (const k of [-1, 1]) {
    // faixa de janelas nas laterais
    const c = new THREE.Vector3(k * (gw + 0.01), gy + 0.18, gz + 0.3);
    const n = new THREE.Vector3(k, 0, 0);
    g.face(c, n, new THREE.Vector3(0, 0, -k), ay, 0, gl / 2 - 0.9, 0.24, col(0xbfeaff), null, 0.55);
  }
  g.face(new THREE.Vector3(0, gy + 0.15, gz + gl / 2 + 0.01), az, ax, ay, 0, gw - 0.15, 0.3, col(0xbfeaff), null, 0.55);
  // motores laterais
  const podZ = gz - 0.6;
  for (const k of [-1, 1]) {
    g.box(new THREE.Vector3(k * 1.35, gy + 0.2, podZ), ax, ay, az, 0.5, 0.06, 0.25, col(0x163a2a));
    g.box(new THREE.Vector3(k * 2.05, gy + 0.2, podZ), ax, ay, az, 0.32, 0.32, 0.8, col(0x2a3a33));
  }
  // hélices (no fim do buffer; giram em update)
  const props = [];
  const blade = new THREE.BoxGeometry(2.2, 0.18, 0.05);
  for (const k of [-1, 1]) {
    const hub = new THREE.Vector3(k * 2.05, gy + 0.2, podZ - 0.86);
    const start = g.count;
    g.geo(blade, new THREE.Matrix4(), col(0x2b2f2d), 0);
    const end = g.count;
    props.push({ hub, start, end, ang: k * 0.7 });
  }
  blade.dispose();
  const geo = g.build();
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  pos.setUsage(THREE.DynamicDrawUsage);
  nor.setUsage(THREE.DynamicDrawUsage);
  // posições de repouso das pás (relativas ao cubo)
  for (const p of props) {
    p.rest = new Float32Array((p.end - p.start) * 3);
    p.restN = new Float32Array((p.end - p.start) * 3);
    for (let v = p.start; v < p.end; v++) {
      const o = (v - p.start) * 3;
      p.rest[o] = pos.getX(v); p.rest[o + 1] = pos.getY(v); p.rest[o + 2] = pos.getZ(v);
      p.restN[o] = nor.getX(v); p.restN[o + 1] = nor.getY(v); p.restN[o + 2] = nor.getZ(v);
    }
  }
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += 2;
  const mesh = new THREE.Mesh(geo);
  mesh.name = 'dirigivel';
  mesh.userData.noCorridor = true;
  const pStart = props[0].start, pEnd = props[props.length - 1].end;
  // faixa de envio reaproveitada (o three.js limpa a lista após cada envio; um objeto só, sem alocar)
  const rangeP = { start: pStart * 3, count: (pEnd - pStart) * 3 };
  const rangeN = { start: pStart * 3, count: (pEnd - pStart) * 3 };
  function spin(dt) {
    const pa = pos.array, na = nor.array;
    for (const p of props) {
      p.ang += dt * 14;
      const c = Math.cos(p.ang), s = Math.sin(p.ang);
      for (let v = p.start; v < p.end; v++) {
        const o = (v - p.start) * 3, w = v * 3;
        const x = p.rest[o], y = p.rest[o + 1];
        pa[w] = p.hub.x + x * c - y * s; pa[w + 1] = p.hub.y + x * s + y * c; pa[w + 2] = p.hub.z + p.rest[o + 2];
        const nx = p.restN[o], ny = p.restN[o + 1];
        na[w] = nx * c - ny * s; na[w + 1] = nx * s + ny * c; na[w + 2] = p.restN[o + 2];
      }
    }
    if (!pos.updateRanges.length) pos.updateRanges.push(rangeP);
    if (!nor.updateRanges.length) nor.updateRanges.push(rangeN);
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }
  spin(0);
  return { mesh, spin };
}
