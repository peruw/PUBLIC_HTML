// Modelos 3D procedurais: karts e pilotos cientistas (estilo chibi, sombreamento toon).
// Cada kart é mesclado em poucas malhas com cor por vértice (poucos draw calls).
// As partes animadas (rodas, volante, tronco, cabeça, braços, acessórios) ficam separadas.
import * as THREE from './three.js';
import { CHARACTERS, CHARACTER_BY_ID, statFactor } from './config.js';

const TAU = Math.PI * 2;
const HR = 0.3; // raio da cabeça (m)
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------------------
// Utilidades de cor e aleatoriedade determinística
// ---------------------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Mistura duas cores hex (em sRGB, suficiente para arte).
function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
const shade = (c, k) => mix(c, k < 1 ? 0x000000 : 0xffffff, k < 1 ? 1 - k : k - 1);

// ---------------------------------------------------------------------------
// Atlas de decalques (números, emblemas, E=mc², tabela periódica)
// Grade de 8 x 8 células de 128 px:
//   linha 0: branco, faixa E=mc² (1..4), placa 14-BIS (5..6), faces do cubo mágico (7)
//   linha 1: números 1..8          linha 2: emblemas 0..7
//   linhas 3 e 4: tabela periódica linha 5: números 9..16
//   linha 6: emblemas 8..15        linha 7: chapa fotográfica (0..1), quadro-negro (2..3),
//                                  planta azul (4), placa QUANTA (5..6)
// ---------------------------------------------------------------------------
const AW = 1024, AH = 1024, CELL = 128;
const WHITE_UV = [32 / AW, 1 - 32 / AH];
function cellUV(cx, cy, cw = 1, ch = 1) {
  const x = cx * CELL + 2, y = cy * CELL + 2, w = cw * CELL - 4, h = ch * CELL - 4;
  return [x / AW, 1 - (y + h) / AH, (x + w) / AW, 1 - y / AH];
}
// Retângulo em pixels do atlas (para pedaços menores que uma célula)
function pxUV(x, y, w, h, inset = 2) {
  return [(x + inset) / AW, 1 - (y + h - inset) / AH, (x + w - inset) / AW, 1 - (y + inset) / AH];
}
// Números 1..8 na linha 1 e 9..16 na linha 5
const numCell = (n) => (n >= 1 && n <= 8 ? [n - 1, 1] : n >= 9 && n <= 16 ? [n - 9, 5] : [(Math.max(1, n) - 1) % 8, 1]);
const numUV = (n) => cellUV(...numCell(n));
const ELEMENTS = [
  ['H', 1, '#7fd4ff'], ['He', 2, '#c9a7ff'], ['Li', 3, '#ff8f85'], ['C', 6, '#8fe39c'],
  ['N', 7, '#8fe39c'], ['O', 8, '#8fe39c'], ['Ne', 10, '#c9a7ff'], ['Na', 11, '#ff8f85'],
  ['Mg', 12, '#ffd27f'], ['Fe', 26, '#92c9f5'], ['Cu', 29, '#92c9f5'], ['Ga', 31, '#b9c4cc'],
  ['Ge', 32, '#7fd6c8'], ['Au', 79, '#f5d36b'], ['Ra', 88, '#ffd27f'], ['Md', 101, '#f59ac0'],
];
const tileUV = (sym) => { const i = ELEMENTS.findIndex((e) => e[0] === sym); return cellUV(i % 8, 3 + Math.floor(i / 8)); };
// Emblema de cada cientista: 0..7 na linha 2 do atlas, 8..15 na linha 6
const EMBLEM = {
  newton: 0, curie: 1, mendeleev: 2, einstein: 3, galileu: 4, darwin: 5, dumont: 6, oswaldo: 7,
  samuel: 8, lattes: 9, franklin: 10, johnson: 11, enedina: 12,
};
const emblemUV = (id) => {
  const i = EMBLEM[id] ?? 0;
  return cellUV(i % 8, i < 8 ? 2 : 6);
};
// Faces do cubo mágico: quadrantes de 64 px da célula (7, 0)
const cubeUV = (q) => pxUV(7 * CELL + (q % 2) * 64, Math.floor(q / 2) * 64, 64, 64, 1.5);

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function disc(g, cx, cy, r, fill) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = fill; g.fill(); }
const FONT = 'Arial, Helvetica, sans-serif';

function drawAtlas() {
  const cv = document.createElement('canvas');
  cv.width = AW; cv.height = AH;
  const g = cv.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, CELL, CELL);
  // Faixa E=mc² (células 1..4 da linha 0)
  roundRectPath(g, CELL + 4, 8, 4 * CELL - 8, CELL - 16, 26);
  g.fillStyle = '#ffffff'; g.fill();
  g.lineWidth = 10; g.strokeStyle = '#0d3b73'; g.stroke();
  g.fillStyle = '#0d3b73';
  g.font = `italic bold 86px Georgia, 'Times New Roman', serif`;
  g.fillText('E=mc²', CELL + 2 * CELL, 68);
  // Placa "14-BIS" (células 5..6)
  roundRectPath(g, 5 * CELL + 4, 14, 2 * CELL - 8, CELL - 28, 20);
  g.fillStyle = '#009c3b'; g.fill();
  g.lineWidth = 8; g.strokeStyle = '#ffdf00'; g.stroke();
  g.fillStyle = '#ffdf00'; g.font = `bold 62px ${FONT}`;
  g.fillText('14-BIS', 6 * CELL, 66);
  // Números 1..8 (linha 1) e 9..16 (linha 5)
  for (let n = 1; n <= 16; n++) {
    const [col, row] = numCell(n);
    const cx = col * CELL + 64, cy = row * CELL + 64;
    disc(g, cx, cy, 63, '#161616');
    disc(g, cx, cy, 52, '#ffffff');
    g.fillStyle = '#161616'; g.font = `bold ${n < 10 ? 78 : 62}px ${FONT}`;
    g.fillText(String(n), cx, cy + 5);
  }
  // Emblemas (linha 2)
  const ey = 2 * CELL + 64;
  // 0: maçã (Newton)
  {
    const cx = 64;
    disc(g, cx, ey, 63, '#5b3a29'); disc(g, cx, ey, 54, '#fff4d6');
    disc(g, cx - 13, ey + 8, 28, '#d62828'); disc(g, cx + 13, ey + 8, 28, '#d62828');
    disc(g, cx, ey + 20, 24, '#d62828');
    disc(g, cx - 16, ey, 7, '#ff8a80');
    g.strokeStyle = '#5b3a29'; g.lineWidth = 6; g.beginPath(); g.moveTo(cx, ey - 16); g.quadraticCurveTo(cx + 2, ey - 30, cx + 8, ey - 36); g.stroke();
    g.fillStyle = '#3a9d4e'; g.beginPath(); g.ellipse(cx + 20, ey - 28, 14, 7, -0.5, 0, TAU); g.fill();
  }
  // 1: símbolo de radiação (Curie)
  {
    const cx = CELL + 64;
    disc(g, cx, ey, 63, '#161616'); disc(g, cx, ey, 55, '#ffd400');
    g.fillStyle = '#161616';
    for (let k = 0; k < 3; k++) {
      const a0 = -Math.PI / 2 + k * (TAU / 3) - Math.PI / 6;
      g.beginPath(); g.moveTo(cx, ey); g.arc(cx, ey, 45, a0, a0 + Math.PI / 3); g.closePath(); g.fill();
    }
    disc(g, cx, ey, 16, '#ffd400'); disc(g, cx, ey, 10, '#161616');
  }
  // 2: frasco com "Md" (Mendeleev)
  {
    const cx = 2 * CELL + 64;
    disc(g, cx, ey, 63, '#2b2d42'); disc(g, cx, ey, 55, '#f59ac0');
    g.fillStyle = '#2b2d42'; g.font = `bold 58px ${FONT}`; g.fillText('Md', cx, ey + 6);
    g.font = `bold 20px ${FONT}`; g.fillText('101', cx, ey - 32);
  }
  // 3: átomo (Einstein, reserva)
  {
    const cx = 3 * CELL + 64;
    disc(g, cx, ey, 63, '#0d3b73'); disc(g, cx, ey, 55, '#ffffff');
    g.strokeStyle = '#1d7bd8'; g.lineWidth = 6;
    for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(cx, ey, 44, 16, k * Math.PI / 3, 0, TAU); g.stroke(); }
    disc(g, cx, ey, 10, '#d7263d');
  }
  // 4: Júpiter e as quatro luas (Galileu)
  {
    const cx = 4 * CELL + 64;
    disc(g, cx, ey, 63, '#e8a33c'); disc(g, cx, ey, 55, '#14213d');
    g.save(); g.beginPath(); g.arc(cx - 14, ey, 26, 0, TAU); g.clip();
    g.fillStyle = '#f2d2a0'; g.fillRect(cx - 40, ey - 26, 52, 52);
    g.fillStyle = '#c9773b'; g.fillRect(cx - 40, ey - 14, 52, 7); g.fillRect(cx - 40, ey + 4, 52, 8);
    g.restore();
    for (const dx of [-48, 22, 34, 46]) disc(g, cx + dx, ey + (dx === 34 ? -3 : 1), 4.5, '#ffffff');
    for (let k = 0; k < 6; k++) disc(g, cx - 30 + k * 13, ey - 40 + (k % 2) * 6, 1.8, '#ffe9a8');
  }
  // 5: árvore da vida (Darwin)
  {
    const cx = 5 * CELL + 64;
    disc(g, cx, ey, 63, '#3a7d44'); disc(g, cx, ey, 55, '#fbf3dc');
    g.strokeStyle = '#3b2f2f'; g.lineWidth = 5; g.lineCap = 'round';
    const br = (x, y, a, len, d) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      if (d > 0) { br(x2, y2, a - 0.55, len * 0.72, d - 1); br(x2, y2, a + 0.5, len * 0.72, d - 1); } else disc(g, x2, y2, 5, '#3a9d4e');
    };
    g.lineWidth = 4; br(cx, ey + 42, -Math.PI / 2, 26, 3);
  }
  // 6: 14-bis (Santos Dumont)
  {
    const cx = 6 * CELL + 64;
    disc(g, cx, ey, 63, '#ffdf00'); disc(g, cx, ey, 55, '#009c3b');
    g.fillStyle = '#fdf6e3';
    g.fillRect(cx - 44, ey - 14, 88, 7); g.fillRect(cx - 44, ey + 4, 88, 7);
    g.fillRect(cx - 44, ey - 14, 5, 25); g.fillRect(cx + 39, ey - 14, 5, 25); g.fillRect(cx - 3, ey - 14, 5, 25);
    g.fillRect(cx - 4, ey - 34, 8, 22);
    g.fillStyle = '#ffdf00'; g.font = `bold 24px ${FONT}`; g.fillText('14-BIS', cx, ey + 34);
  }
  // 7: mosquito proibido (Oswaldo Cruz)
  {
    const cx = 7 * CELL + 64;
    disc(g, cx, ey, 63, '#d7263d'); disc(g, cx, ey, 52, '#ffffff');
    g.fillStyle = '#cfd8dc';
    g.beginPath(); g.ellipse(cx - 14, ey - 16, 18, 8, -0.7, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(cx + 14, ey - 16, 18, 8, 0.7, 0, TAU); g.fill();
    g.strokeStyle = '#161616'; g.lineWidth = 3;
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
      g.beginPath(); g.moveTo(cx + s * 4, ey + k * 6); g.lineTo(cx + s * 22, ey + 14 + k * 8); g.lineTo(cx + s * 28, ey + 30 + k * 4); g.stroke();
    }
    g.fillStyle = '#161616';
    g.beginPath(); g.ellipse(cx, ey + 4, 7, 20, 0, 0, TAU); g.fill();
    disc(g, cx, ey - 20, 7, '#161616');
    g.lineWidth = 2; g.beginPath(); g.moveTo(cx, ey - 24); g.lineTo(cx, ey - 40); g.stroke();
    g.fillStyle = '#ffffff'; for (let k = 0; k < 3; k++) g.fillRect(cx - 7, ey - 6 + k * 9, 14, 3);
    g.strokeStyle = '#d7263d'; g.lineWidth = 11;
    g.beginPath(); g.moveTo(cx - 36, ey - 36); g.lineTo(cx + 36, ey + 36); g.stroke();
  }
  // Tabela periódica (linhas 3 e 4)
  ELEMENTS.forEach(([sym, num, col], i) => {
    const x = (i % 8) * CELL, y = (3 + Math.floor(i / 8)) * CELL;
    g.fillStyle = '#1f1f2e'; g.fillRect(x, y, CELL, CELL);
    roundRectPath(g, x + 6, y + 6, CELL - 12, CELL - 12, 12);
    g.fillStyle = col; g.fill();
    g.fillStyle = '#1f1f2e';
    g.textAlign = 'left'; g.font = `bold 24px ${FONT}`; g.fillText(String(num), x + 16, y + 26);
    g.textAlign = 'center'; g.font = `bold ${sym.length > 1 ? 58 : 66}px ${FONT}`; g.fillText(sym, x + 64, y + 74);
  });
  drawAtlasExtra(g);
  return cv;
}

// Alvo da Quanta Aulas (mesmo desenho do logo SVG de 64 x 64 do index.html), centrado em (cx, cy)
function quantaTarget(g, cx, cy, k, col = '#1fd685') {
  g.save();
  g.translate(cx - 32 * k, cy - 32 * k);
  g.scale(k, k);
  g.strokeStyle = col; g.fillStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
  g.lineWidth = 5;
  for (const r of [26, 17, 8]) { g.beginPath(); g.arc(30, 30, r, 0, TAU); g.stroke(); }
  g.beginPath(); g.arc(30, 30, 3.5, 0, TAU); g.fill();
  g.lineWidth = 4.5; g.beginPath(); g.moveTo(30, 30); g.lineTo(52, 52); g.stroke();
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(47, 55); g.lineTo(58, 58); g.lineTo(55, 47); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(52, 52); g.lineTo(60, 49); g.moveTo(52, 52); g.lineTo(49, 60); g.stroke();
  g.restore();
}

// Emblemas 8..12 (linha 6) e texturas dos acessórios (célula 7 da linha 0 e linha 7)
function drawAtlasExtra(g) {
  const ey = 6 * CELL + 64;
  const rr = rng(1947);
  // 8: alvo da Quanta (Prof. Samuel)
  {
    const cx = 64;
    disc(g, cx, ey, 63, '#1fd685'); disc(g, cx, ey, 55, '#0b1511');
    quantaTarget(g, cx + 3, ey + 3, 1.42);
  }
  // 9: raios cósmicos chegando ao monte Chacaltaya, com o píon (Lattes)
  {
    const cx = CELL + 64;
    disc(g, cx, ey, 63, '#f4d35e'); disc(g, cx, ey, 55, '#16324f');
    g.save(); g.beginPath(); g.arc(cx, ey, 55, 0, TAU); g.clip();
    g.strokeStyle = '#f4d35e'; g.lineWidth = 3.5; g.lineCap = 'round'; g.setLineDash([7, 5]);
    for (const [x1, x2] of [[-2, 4], [26, 16], [48, 30]]) { g.beginPath(); g.moveTo(cx + x1, ey - 58); g.lineTo(cx + x2, ey - 4); g.stroke(); }
    g.setLineDash([]);
    g.fillStyle = '#6d8196';
    g.beginPath(); g.moveTo(cx - 62, ey + 60); g.lineTo(cx - 26, ey + 8); g.lineTo(cx - 10, ey + 22); g.lineTo(cx + 14, ey - 8);
    g.lineTo(cx + 62, ey + 60); g.closePath(); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(cx + 14, ey - 8); g.lineTo(cx + 27, ey + 8); g.lineTo(cx + 19, ey + 5); g.lineTo(cx + 12, ey + 12);
    g.lineTo(cx + 6, ey + 4); g.lineTo(cx + 2, ey + 7); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(cx - 26, ey + 8); g.lineTo(cx - 17, ey + 17); g.lineTo(cx - 24, ey + 15); g.lineTo(cx - 32, ey + 17); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#ffffff'; g.font = `bold 44px Georgia, 'Times New Roman', serif`;
    g.fillText('π', cx - 24, ey - 22);
  }
  // 10: a "Foto 51", o X da difração de raios X do DNA (Rosalind Franklin)
  {
    const cx = 2 * CELL + 64;
    disc(g, cx, ey, 63, '#f1faee');
    const rg = g.createRadialGradient(cx, ey, 2, cx, ey, 56);
    rg.addColorStop(0, '#8a8a8a'); rg.addColorStop(0.45, '#3a3a3a'); rg.addColorStop(1, '#141414');
    g.fillStyle = rg; g.beginPath(); g.arc(cx, ey, 55, 0, TAU); g.fill();
    g.fillStyle = '#f2f2f2';
    for (let k = 1; k <= 5; k++) {
      for (const sy of [1, -1]) for (const sx of [1, -1]) {
        g.beginPath(); g.ellipse(cx + sx * k * 7.2, ey + sy * k * 8.2, 5.4 - k * 0.45, 2.6, 0, 0, TAU); g.fill();
      }
    }
    g.strokeStyle = '#e6e6e6'; g.lineWidth = 7; g.lineCap = 'butt';
    g.beginPath(); g.arc(cx, ey + 8, 50, -Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3); g.stroke();
    g.beginPath(); g.arc(cx, ey - 8, 50, Math.PI / 2 - 0.3, Math.PI / 2 + 0.3); g.stroke();
  }
  // 11: órbita em volta da Terra, com a cápsula (Katherine Johnson)
  {
    const cx = 3 * CELL + 64;
    disc(g, cx, ey, 63, '#ffbe0b'); disc(g, cx, ey, 55, '#0d1b3e');
    for (let k = 0; k < 9; k++) disc(g, cx - 44 + rr() * 88, ey - 44 + rr() * 30, 1.2 + rr() * 1.2, '#ffffff');
    g.strokeStyle = '#ffffff'; g.lineWidth = 4;
    g.beginPath(); g.ellipse(cx, ey + 4, 47, 19, -0.32, Math.PI, TAU); g.stroke();
    disc(g, cx, ey + 6, 21, '#3a86ff');
    g.fillStyle = '#52b788';
    g.beginPath(); g.ellipse(cx - 7, ey, 8, 6, 0.5, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(cx + 8, ey + 14, 6, 4, -0.3, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(cx, ey + 4, 47, 19, -0.32, 0, Math.PI); g.stroke();
    // cápsula (cone) sobre a órbita, apontando no sentido do movimento
    const t = -0.55, ox = 47 * Math.cos(t), oy = 19 * Math.sin(t);
    const px = cx + ox * Math.cos(-0.32) - oy * Math.sin(-0.32), py = ey + 4 + ox * Math.sin(-0.32) + oy * Math.cos(-0.32);
    g.save(); g.translate(px, py); g.rotate(-1.35);
    g.fillStyle = '#eef2f6'; g.beginPath(); g.moveTo(-8, 7); g.lineTo(8, 7); g.lineTo(3, -9); g.lineTo(-3, -9); g.closePath(); g.fill();
    g.fillStyle = '#d7263d'; g.fillRect(-8, 5, 16, 4);
    g.restore();
  }
  // 12: usina hidrelétrica, com a barragem e o raio (Enedina Marques)
  {
    const cx = 4 * CELL + 64;
    disc(g, cx, ey, 63, '#264653'); disc(g, cx, ey, 55, '#d4ecff');
    g.save(); g.beginPath(); g.arc(cx, ey, 55, 0, TAU); g.clip();
    g.fillStyle = '#2f80d1'; g.fillRect(cx - 60, ey - 6, 50, 70);
    g.fillStyle = '#6fb3f2'; g.fillRect(cx - 60, ey - 6, 50, 5);
    g.fillStyle = '#8f9aa6';
    g.beginPath(); g.moveTo(cx - 14, ey - 20); g.lineTo(cx - 2, ey - 20); g.lineTo(cx + 22, ey + 62); g.lineTo(cx - 14, ey + 62); g.closePath(); g.fill();
    g.fillStyle = '#b8c2cc'; g.fillRect(cx - 14, ey - 20, 12, 8);
    g.fillStyle = '#5aa9f0'; g.fillRect(cx + 14, ey + 38, 50, 30);
    g.restore();
    g.fillStyle = '#ffbe0b'; g.strokeStyle = '#264653'; g.lineWidth = 3; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(cx + 26, ey - 44); g.lineTo(cx + 8, ey - 6); g.lineTo(cx + 22, ey - 6); g.lineTo(cx + 10, ey + 26);
    g.lineTo(cx + 42, ey - 16); g.lineTo(cx + 28, ey - 16); g.lineTo(cx + 40, ey - 44); g.closePath(); g.fill(); g.stroke();
  }
  // Faces do cubo mágico (célula 7 da linha 0): 4 quadrantes com 3 x 3 adesivos
  {
    const K = { w: '#f5f5f5', y: '#ffd500', r: '#e3232c', o: '#ff7b10', b: '#1463d8', g: '#14a54f' };
    ['wwwwwwoww', 'rrrrrrgrr', 'gggyggggg', 'bbobbbbbb'].forEach((f, q) => {
      const fx = 7 * CELL + (q % 2) * 64, fy = Math.floor(q / 2) * 64;
      g.fillStyle = '#111114'; g.fillRect(fx, fy, 64, 64);
      for (let k = 0; k < 9; k++) {
        roundRectPath(g, fx + 3.5 + (k % 3) * 19.5, fy + 3.5 + Math.floor(k / 3) * 19.5, 18, 18, 4);
        g.fillStyle = K[f[k]]; g.fill();
      }
    });
  }
  // Chapa fotográfica de emulsão (células 0..1 da linha 7): vidro escuro com rastros claros
  {
    const x0 = 0, y0 = 7 * CELL, w = 2 * CELL, h = CELL;
    g.fillStyle = '#b9c7cf'; g.fillRect(x0, y0, w, h);
    const gr = g.createLinearGradient(x0, y0, x0 + w, y0 + h);
    gr.addColorStop(0, '#2a3439'); gr.addColorStop(1, '#161d21');
    g.fillStyle = gr; g.fillRect(x0 + 7, y0 + 7, w - 14, h - 14);
    g.fillStyle = 'rgba(210,220,200,0.22)';
    for (let i = 0; i < 320; i++) g.fillRect(x0 + 9 + rr() * (w - 18), y0 + 9 + rr() * (h - 18), 1.6, 1.6);
    // rastro = grãos de prata ao longo de uma linha
    const track = (pts, rad, col, step = 2.4) => {
      g.fillStyle = col;
      for (let j = 1; j < pts.length; j++) {
        const [xa, ya] = pts[j - 1], [xb, yb] = pts[j];
        const n = Math.max(2, Math.round(Math.hypot(xb - xa, yb - ya) / step));
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          g.beginPath();
          g.arc(x0 + xa + (xb - xa) * t + (rr() - 0.5) * 1.5, y0 + ya + (yb - ya) * t + (rr() - 0.5) * 1.5, rad * (0.7 + rr() * 0.5), 0, TAU);
          g.fill();
        }
      }
    };
    track([[14, 112], [242, 22]], 1.2, 'rgba(190,205,195,0.8)', 4); // raio cósmico atravessando
    track([[16, 26], [58, 40], [98, 60], [118, 70]], 2.5, '#fff6d0'); // píon que para...
    track([[118, 70], [150, 90], [184, 104]], 2.1, '#fff6d0'); // ...e vira múon
    track([[184, 104], [214, 84], [244, 70]], 1.1, 'rgba(255,246,208,0.75)', 3.2); // elétron
    for (let k = 0; k < 6; k++) { // estrela: núcleo que se desintegra
      const a = k * 1.05 + 0.3, L2 = 12 + rr() * 16;
      track([[204, 36], [204 + Math.cos(a) * L2, 36 + Math.sin(a) * L2]], 1.7, '#ffe9a8');
    }
    g.fillStyle = '#ffd166'; g.font = `italic bold 22px Georgia, serif`;
    g.fillText('π', x0 + 70, y0 + 30); g.fillText('μ', x0 + 162, y0 + 80);
  }
  // Quadro-negro (células 2..3 da linha 7): Terra, órbita tracejada e contas de giz
  {
    const x0 = 2 * CELL, y0 = 7 * CELL, w = 2 * CELL, h = CELL;
    g.fillStyle = '#243a2e'; g.fillRect(x0, y0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(x0 + rr() * w, y0 + rr() * h, 20 + rr() * 30, 8 + rr() * 10, rr(), 0, TAU); g.fill(); }
    const chalk = 'rgba(248,248,236,0.95)';
    g.strokeStyle = chalk; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.ellipse(x0 + 70, y0 + 66, 56, 30, -0.3, Math.PI, TAU); g.stroke();
    disc(g, x0 + 66, y0 + 68, 19, '#5c8fd6');
    g.fillStyle = '#7cc47f';
    g.beginPath(); g.ellipse(x0 + 60, y0 + 63, 7, 5, 0.5, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(x0 + 73, y0 + 76, 5, 3.5, -0.3, 0, TAU); g.fill();
    g.beginPath(); g.arc(x0 + 66, y0 + 68, 19, 0, TAU); g.stroke();
    g.setLineDash([8, 6]);
    g.beginPath(); g.ellipse(x0 + 70, y0 + 66, 56, 30, -0.3, 0, Math.PI); g.stroke();
    g.setLineDash([]);
    // cápsula e seta do movimento
    g.fillStyle = chalk;
    g.beginPath(); g.moveTo(x0 + 118, y0 + 30); g.lineTo(x0 + 128, y0 + 40); g.lineTo(x0 + 115, y0 + 42); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x0 + 20, y0 + 96); g.quadraticCurveTo(x0 + 8, y0 + 80, x0 + 14, y0 + 62); g.stroke();
    g.beginPath(); g.moveTo(x0 + 8, y0 + 70); g.lineTo(x0 + 14, y0 + 62); g.lineTo(x0 + 20, y0 + 70); g.stroke();
    g.textAlign = 'left'; g.font = `italic 19px Georgia, 'Times New Roman', serif`;
    g.fillText('x = r cos θ', x0 + 140, y0 + 28);
    g.fillText('y = r sen θ', x0 + 140, y0 + 54);
    g.fillText('v = √GM/r', x0 + 140, y0 + 80);
    g.fillText('T = 88 min', x0 + 140, y0 + 106);
    g.textAlign = 'center';
    g.strokeStyle = chalk; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0 + 174, y0 + 70); g.lineTo(x0 + 212, y0 + 70); g.stroke();
  }
  // Planta azul (célula 4 da linha 7): quadriculado e desenho técnico de uma barragem com turbina
  {
    const x0 = 4 * CELL, y0 = 7 * CELL;
    g.fillStyle = '#1f5fae'; g.fillRect(x0, y0, CELL, CELL);
    g.strokeStyle = 'rgba(220,235,255,0.28)'; g.lineWidth = 1;
    for (let i = 8; i < CELL; i += 16) {
      g.beginPath(); g.moveTo(x0 + i, y0); g.lineTo(x0 + i, y0 + CELL); g.stroke();
      g.beginPath(); g.moveTo(x0, y0 + i); g.lineTo(x0 + CELL, y0 + i); g.stroke();
    }
    g.strokeStyle = '#eef6ff'; g.lineWidth = 3; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(x0 + 20, y0 + 104); g.lineTo(x0 + 44, y0 + 24); g.lineTo(x0 + 58, y0 + 24); g.lineTo(x0 + 80, y0 + 104); g.closePath(); g.stroke();
    g.beginPath(); g.arc(x0 + 96, y0 + 88, 14, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(x0 + 60, y0 + 70); g.lineTo(x0 + 86, y0 + 80); g.stroke();
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x0 + 10, y0 + 14); g.lineTo(x0 + 118, y0 + 14); g.stroke();
    g.beginPath(); g.moveTo(x0 + 100, y0 + 30); g.lineTo(x0 + 120, y0 + 30); g.lineTo(x0 + 120, y0 + 60); g.stroke();
  }
  // Placa QUANTA (células 5..6 da linha 7): faixa 4:1 no meio da célula
  {
    const x0 = 5 * CELL, y0 = 7 * CELL + 32;
    roundRectPath(g, x0 + 4, y0 + 3, 248, 58, 14);
    g.fillStyle = '#0b1511'; g.fill();
    g.lineWidth = 5; g.strokeStyle = '#1fd685'; g.stroke();
    quantaTarget(g, x0 + 38, y0 + 32, 0.72);
    g.fillStyle = '#1fd685'; g.font = `bold 40px ${FONT}`;
    g.fillText('QUANTA', x0 + 150, y0 + 34);
  }
}

// ---------------------------------------------------------------------------
// Recursos compartilhados (criados uma vez)
// ---------------------------------------------------------------------------
let SH = null;
function shared() {
  if (SH) return SH;
  const grad = new THREE.DataTexture(new Uint8Array([120, 168, 222, 255]), 4, 1, THREE.RedFormat);
  grad.minFilter = THREE.NearestFilter;
  grad.magFilter = THREE.NearestFilter;
  grad.generateMipmaps = false;
  grad.needsUpdate = true;
  const atlas = new THREE.CanvasTexture(drawAtlas());
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, map: atlas, gradientMap: grad });
  mat.name = 'kart-toon';
  // Textura de brilho radial (sprites aditivos)
  const gc = document.createElement('canvas');
  gc.width = gc.height = 64;
  const g = gc.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  const glow = new THREE.CanvasTexture(gc);
  glow.colorSpace = THREE.SRGBColorSpace;
  // Qualidade baixa: Lambert com a mesma cor por vértice e o mesmo atlas. Sem a rampa toon a
  // leitura é a mesma, e o programa de shader é o mesmo do cenário (menos programas a compilar).
  const matLo = new THREE.MeshLambertMaterial({ vertexColors: true, map: atlas });
  matLo.name = 'kart-lambert';
  // matInst: cópia para o InstancedMesh das rodas (evita trocar de programa a cada kart)
  SH = { grad, atlas, mat, matInst: mat.clone(), matLo, matLoInst: matLo.clone(), glow, geo: new Map(), models: new Map() };
  return SH;
}

// ---------------------------------------------------------------------------
// Geometrias base unitárias (em cache)
// ---------------------------------------------------------------------------
function G(key, make) {
  const c = shared().geo;
  let g = c.get(key);
  if (!g) {
    g = make();
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox();
    c.set(key, g);
  }
  return g;
}
const sphereG = (w, h) => G(`s${w}.${h}`, () => new THREE.SphereGeometry(1, w, h));
const capG = (w, h, th) => G(`c${w}.${h}.${th}`, () => new THREE.SphereGeometry(1, w, h, 0, TAU, 0, th));
const cylG = (top, seg, open = false) => G(`y${top}.${seg}.${open}`, () => new THREE.CylinderGeometry(top, 1, 1, seg, 1, open));
const torusG = (tube, rs, ts, arc = TAU) => G(`t${tube}.${rs}.${ts}.${arc}`, () => new THREE.TorusGeometry(1, tube, rs, ts, arc));
const capsG = (len, cs, rs) => G(`k${len}.${cs}.${rs}`, () => new THREE.CapsuleGeometry(1, len, cs, rs));
const planeG = () => G('p', () => new THREE.PlaneGeometry(1, 1));
const circleG = (seg) => G(`o${seg}`, () => new THREE.CircleGeometry(0.5, seg));
const rboxG = (w, h, d, r, k) => G(`r${w}.${h}.${d}.${r}.${k}`, () => (k > 0 ? roundedBox(w, h, d, r, k) : new THREE.BoxGeometry(w, h, d)));
// Casca de barba na mandíbula: faixa esférica cuja borda de cima é baixa na frente
// (abaixo da boca) e alta nas laterais (costeletas). Ângulos em "pitch" (rad).
// ym: ângulo (yaw) máximo das costeletas; 1.75 passa por trás da orelha.
// pbs: borda de baixo nas laterais (a linha da mandíbula sobe até a orelha); padrão = pb.
const jawShellG = (pf, ps, pb, w, h, ym = 1.75, pbs = pb) => G(`j${pf}.${ps}.${pb}.${w}.${h}${ym === 1.75 && pbs === pb ? '' : `.${ym}.${pbs}`}`, () => {
  const g = new THREE.SphereGeometry(1, w, h, Math.PI / 2 - ym, 2 * ym, 0.5, 1);
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const yaw = -ym + 2 * ym * uv.getX(i);
    const k = Math.pow(Math.max(0, Math.cos(yaw)), 1.5);
    const top = ps + (pf - ps) * k, bot = pbs + (pb - pbs) * k;
    const pitch = bot + (top - bot) * uv.getY(i);
    const x = Math.sin(yaw) * Math.cos(pitch), y = Math.sin(pitch), z = Math.cos(yaw) * Math.cos(pitch);
    pos.setXYZ(i, x, y, z);
    nor.setXYZ(i, x, y, z);
  }
  return g;
});
// Icosfera suave e indexada (tufos de cabelo, barba): redonda com poucos triângulos.
const icoG = (d) => G(`i${d}`, () => indexByPosition(new THREE.IcosahedronGeometry(1, d)));
function indexByPosition(src) {
  const pos = src.attributes.position;
  const map = new Map();
  const P = [], I = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let j = map.get(key);
    if (j === undefined) { j = P.length / 3; map.set(key, j); P.push(x, y, z); }
    I.push(j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(P.slice(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((P.length / 3) * 2).fill(0), 2));
  g.setIndex(I);
  src.dispose();
  return g;
}
// Meio disco (boca aberta): plano XY, parte de baixo, profundidade em Z.
const mouthG = (seg) => G(`m${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, false, Math.PI / 2, Math.PI).rotateX(-Math.PI / 2));
// Arco de sorriso (metade de baixo de um toro).
const smileG = (tube) => G(`a${tube}`, () => new THREE.TorusGeometry(1, tube, 5, 12, Math.PI).rotateZ(Math.PI));
const latheG = (key, pts, seg) => G(`l${key}.${seg}`, () => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg));

// Caixa arredondada: grade da BoxGeometry remapeada e "esferificada" nos cantos.
function roundedBox(w, h, d, r, k) {
  const s = 2 * k + 1;
  const g = new THREE.BoxGeometry(1, 1, 1, s, s, s);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const half = [w / 2, h / 2, d / 2];
  r = Math.min(r, half[0], half[1], half[2]) * 0.999;
  const v = [0, 0, 0], inn = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    v[0] = pos.getX(i); v[1] = pos.getY(i); v[2] = pos.getZ(i);
    for (let a = 0; a < 3; a++) {
      const gi = Math.round((v[a] + 0.5) * s);
      let c;
      if (gi <= k) c = -half[a] + r * (gi / k);
      else c = half[a] - r * ((s - gi) / k);
      v[a] = c;
      inn[a] = Math.max(-half[a] + r, Math.min(half[a] - r, c));
    }
    let dx = v[0] - inn[0], dy = v[1] - inn[1], dz = v[2] - inn[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    pos.setXYZ(i, inn[0] + dx * r, inn[1] + dy * r, inn[2] + dz * r);
    nor.setXYZ(i, dx, dy, dz);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Montador: assa transformações + cor por vértice e concatena tudo numa malha.
// Contorno "casco invertido": cópia levemente maior, escura, com faces invertidas.
// ---------------------------------------------------------------------------
const _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4(), _nm = new THREE.Matrix3();
const _q = new THREE.Quaternion(), _eu = new THREE.Euler(), _p = new THREE.Vector3(), _sc = new THREE.Vector3(), _sc2 = new THREE.Vector3();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _col = new THREE.Color(), _oc = new THREE.Color();
const OUTLINE_K = 0.16;

// Níveis de detalhe: 1 = alta, 0 = baixa, -1 = distância média (LOD), -2 = longe (LOD).
// Os níveis negativos só existem mesclados e estáticos, sem contornos.
const DENS = { 1: 1, 0: 0.72, [-1]: 0.5, [-2]: 0.36 };
const MIN_PART = { 1: 0, 0: 0, [-1]: 0.02, [-2]: 0.04 }; // peças menores (m) somem a essa distância

const byDetail = (d, hi, lo, mid = lo, far = mid) => (d > 0 ? hi : d === 0 ? lo : d === -1 ? mid : far);

class Builder {
  constructor({ detail = 1, outline = true, ol = 0.012, olMin = 0 } = {}) {
    this.detail = detail;
    this.outline = outline && detail >= 0;
    this.ol = ol;
    this.olMin = olMin; // peças menores que isso (m) ficam sem contorno
    this.dens = DENS[detail] ?? 1; // densidade de tufos (cabelo/barba)
    this.minPart = MIN_PART[detail] ?? 0;
    this.P = []; this.N = []; this.C = []; this.U = []; this.I = [];
    this.IO = []; // triângulos dos contornos (ficam no fim do índice)
    this.n = 0;
    this.base = new THREE.Matrix4();
  }
  setBase(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
    this.base.compose(_p.set(x, y, z), _q.setFromEuler(_eu.set(rx, ry, rz)), _sc.set(s, s, s));
    return this;
  }
  // Valor por nível de detalhe: alta, baixa, média distância, longe
  lv(hi, lo, mid = lo, far = mid) { return byDetail(this.detail, hi, lo, mid, far); }
  seg(r) {
    const d = this.detail;
    if (d < 0) {
      const far = d < -1;
      if (r > 0.2) return far ? [8, 5] : [10, 7];
      if (r > 0.1) return far ? [6, 4] : [8, 5];
      if (r > 0.045) return far ? [5, 3] : [6, 4];
      return far ? [4, 3] : [5, 3];
    }
    const hi = d > 0;
    if (r > 0.2) return hi ? [20, 14] : [14, 10];
    if (r > 0.1) return hi ? [12, 9] : [10, 7];
    if (r > 0.045) return hi ? [10, 7] : [8, 6];
    return hi ? [7, 5] : [6, 4];
  }
  // rot: [x, y, z, ordem?] ou Quaternion; scl: número ou [x, y, z]
  add(geo, color, pos, rot, scl, opt = {}) {
    if (typeof scl === 'number') _sc.set(scl, scl, scl);
    else _sc.set(scl[0], scl[1], scl[2]);
    if (rot && rot.isQuaternion) _q.copy(rot);
    else if (rot) _q.setFromEuler(_eu.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ'));
    else _q.identity();
    _p.set(pos[0], pos[1], pos[2]);
    const bb = geo.boundingBox;
    const hx = Math.max(-bb.min.x, bb.max.x) * Math.abs(_sc.x);
    const hy = Math.max(-bb.min.y, bb.max.y) * Math.abs(_sc.y);
    const hz = Math.max(-bb.min.z, bb.max.z) * Math.abs(_sc.z);
    // LOD: detalhes pequenos (brilho do olho, botões...) nem aparecem de longe
    if (this.minPart > 0 && !opt.keep && Math.max(hx, hy, hz) < this.minPart) return this;
    _mA.compose(_p, _q, _sc);
    _mB.multiplyMatrices(this.base, _mA);
    _col.set(color);
    this._append(geo, _mB, _col, false, opt.uv);
    const t = opt.ol ?? this.ol;
    if (this.outline && t > 0) {
      if (Math.max(hx, hy, hz) < this.olMin) return this;
      _sc2.set(_sc.x * (hx > 1e-4 ? 1 + t / hx : 1), _sc.y * (hy > 1e-4 ? 1 + t / hy : 1), _sc.z * (hz > 1e-4 ? 1 + t / hz : 1));
      _mA.compose(_p, _q, _sc2);
      _mB.multiplyMatrices(this.base, _mA);
      _oc.copy(_col).multiplyScalar(OUTLINE_K);
      _oc.r += 0.004; _oc.g += 0.003; _oc.b += 0.006;
      this._append(geo, _mB, _oc, true, null);
    }
    return this;
  }
  // Contorno avulso: casco escuro e invertido de uma geometria já "engordada" pelo chamador
  // (tubos finos e curvos, em que a escala do contorno automático não acompanha a forma).
  hull(geo, color, pos, rot = null, scl = 1) {
    if (!this.outline) return this;
    if (typeof scl === 'number') _sc.set(scl, scl, scl);
    else _sc.set(scl[0], scl[1], scl[2]);
    if (rot) _q.setFromEuler(_eu.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ'));
    else _q.identity();
    _mA.compose(_p.set(pos[0], pos[1], pos[2]), _q, _sc);
    _mB.multiplyMatrices(this.base, _mA);
    _oc.set(color).multiplyScalar(OUTLINE_K);
    _oc.r += 0.004; _oc.g += 0.003; _oc.b += 0.006;
    this._append(geo, _mB, _oc, true, null);
    return this;
  }
  _append(geo, m, color, outline, uvRect) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv, idx = geo.index;
    _nm.getNormalMatrix(m);
    const flip = outline !== (m.determinant() < 0);
    const base = this.n;
    const I = outline ? this.IO : this.I;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m);
      this.P.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
      if (outline) _v.negate();
      this.N.push(_v.x, _v.y, _v.z);
      this.C.push(color.r, color.g, color.b);
      if (uvRect && uv) {
        this.U.push(uvRect[0] + uv.getX(i) * (uvRect[2] - uvRect[0]), uvRect[1] + uv.getY(i) * (uvRect[3] - uvRect[1]));
      } else this.U.push(WHITE_UV[0], WHITE_UV[1]);
    }
    const cnt = idx ? idx.count : pos.count;
    for (let i = 0; i < cnt; i += 3) {
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      if (flip) I.push(base + a, base + c, base + b);
      else I.push(base + a, base + b, base + c);
    }
    this.n += pos.count;
  }
  // ---- atalhos ----
  ell(color, pos, scl, rot = null, opt) {
    const r = typeof scl === 'number' ? scl : Math.max(scl[0], scl[1], scl[2]);
    // nos níveis de LOD o número de segmentos vem sempre do tamanho
    const [w, h] = (this.detail >= 0 && opt?.seg) || this.seg(r);
    return this.add(sphereG(w, h), color, pos, rot, scl, opt);
  }
  // Tufo (icosfera): cabelo, barba, cachos
  blob(color, pos, scl, rot = null, opt) {
    const geo = icoG(this.detail > 0 ? (opt?.fine ? 2 : 1) : 0);
    return this.add(geo, color, pos, rot, scl, opt);
  }
  box(color, pos, size, rad = 0.03, rot = null, opt) {
    const lo = this.detail === 0;
    // LOD médio: só as caixas bem arredondadas mantêm a curva; longe, todas viram caixas
    const k = this.detail < -1 ? 0 : this.detail < 0 ? (rad < 0.06 ? 0 : 1) : rad < (lo ? 0.05 : 0.012) ? 0 : rad < 0.06 || lo ? 1 : 2;
    return this.add(rboxG(size[0], size[1], size[2], k ? rad : 0, k), color, pos, rot, 1, opt);
  }
  // Cilindro de a (raio r0) até b (raio r1)
  cyl(color, a, b, r0, r1 = r0, seg = 0, opt) {
    if (r0 < r1) { const t = a; a = b; b = t; const tr = r0; r0 = r1; r1 = tr; }
    _v2.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _v2.length();
    _v2.divideScalar(len || 1);
    const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, _v2);
    const s = (this.detail >= 0 && seg) || (r0 > 0.06 ? this.lv(16, 10, 8, 6) : this.lv(10, 7, 5, 4));
    const top = Math.round((r1 / r0) * 100) / 100;
    return this.add(cylG(top, s, opt?.open), color, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], q, [r0, len, r0], opt);
  }
  cone(color, a, b, r, seg = 0, opt) { return this.cyl(color, a, b, r, 0, seg, opt); }
  // Cápsula de a até b
  limb(color, a, b, r, opt) {
    _v2.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _v2.length();
    _v2.divideScalar(len || 1);
    const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, _v2);
    const ratio = Math.max(0.1, Math.round((len / r) * 5) / 5);
    const geo = capsG(ratio, this.lv(3, 2, 1), this.lv(9, 7, 6, 5));
    return this.add(geo, color, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], q, r, opt);
  }
  torus(color, pos, rot, R, tube, arc = TAU, opt) {
    const tr = Math.round((tube / R) * 100) / 100;
    return this.add(torusG(tr, this.lv(8, 6, 4, 3), this.lv(20, 12, 8, 6), arc), color, pos, rot, R, opt);
  }
  decal(uv, pos, rot, w, h = w, round = false) {
    return this.add(round ? circleG(this.lv(28, 18, 10, 8)) : planeG(), 0xffffff, pos, rot, [w, h, 1], { uv, ol: 0 });
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    const idx = this.I.concat(this.IO);
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    // índices das peças sem os contornos: o passe de sombra desenha só essa faixa
    g.userData.solidCount = this.I.length;
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------------------
// Rosto e cabelo (coordenadas relativas ao centro da cabeça; frente = +Z)
// ---------------------------------------------------------------------------
// Ponto na superfície da cabeça. yaw > 0 = lado esquerdo do piloto (+X); pitch > 0 = para cima.
function hp(yaw, pitch, lift = 0) {
  const r = HR + lift;
  return [r * Math.sin(yaw) * Math.cos(pitch), r * Math.sin(pitch), r * Math.cos(yaw) * Math.cos(pitch)];
}
// Rotação que alinha +Z local com a normal da cabeça naquele ponto.
const hr = (yaw, pitch, roll = 0) => [-pitch, yaw, roll, 'YXZ'];
const _dq = new THREE.Vector3();
// Quaternion que leva +Z local para a direção (x, y, z)
const alongZ = (x, y, z) => new THREE.Quaternion().setFromUnitVectors(Z_AXIS, _dq.set(x, y, z).normalize());

// Calota de cabelo: esfera parcial inclinada para trás.
function hairCap(b, color, theta, tilt, scale = 1.07, dy = 0, dz = 0) {
  const [w, h] = b.lv([22, 14], [16, 10], [11, 6], [8, 5]);
  b.add(capG(w, h, theta), color, [0, dy, dz], [-tilt, 0, 0], typeof scale === 'number' ? HR * scale : scale.map((s) => s * HR));
}

function face(b, L, o = {}) {
  const skin = L.skin;
  const eyeYaw = o.eyeYaw ?? 0.33, eyeP = o.eyeP ?? 0.02, es = o.eyeScale ?? 1;
  const pupil = o.pupil ?? 0x2b1b12;
  for (const s of [1, -1]) {
    // olho branco, pupila e brilho
    const hi = b.detail > 0;
    b.ell(0xffffff, hp(s * eyeYaw, eyeP, -0.028), [0.066 * es, 0.084 * es, 0.045], hr(s * eyeYaw, eyeP), { ol: 0.009, seg: hi ? [12, 8] : [9, 6] });
    b.ell(pupil, hp(s * (eyeYaw - 0.035), eyeP - 0.012, 0.004), [0.037 * es, 0.05 * es, 0.022], hr(s * (eyeYaw - 0.035), eyeP - 0.012), { ol: 0, seg: hi ? [9, 6] : [7, 5] });
    b.ell(0xffffff, hp(s * (eyeYaw - 0.06), eyeP + 0.045, 0.017), 0.014 * es, null, { ol: 0, seg: [6, 4] });
    // sobrancelha
    const bp = eyeP + (o.browP ?? 0.25);
    const bw = o.browW ?? 0.1, bh = o.browH ?? 0.028;
    b.box(o.brow ?? L.hair, hp(s * (eyeYaw + 0.02), bp, o.browLift ?? 0.004), [bw, bh, 0.035], bh * 0.45, hr(s * (eyeYaw + 0.02), bp, s * (o.browTilt ?? 0.12)), { ol: 0.007 });
    // cílios
    if (o.lashes) {
      b.box(0x1a1010, hp(s * (eyeYaw + 0.075), eyeP + 0.07, 0.0), [0.05, 0.016, 0.02], 0.007, hr(s * (eyeYaw + 0.08), eyeP + 0.07, s * 0.5), { ol: 0 });
    }
    // bochechas rosadas
    if (o.cheeks !== false) b.ell(o.cheek ?? mix(skin, 0xff6f6f, 0.4), hp(s * 0.56, -0.15, -0.018), [0.058, 0.036, 0.025], hr(s * 0.56, -0.15), { ol: 0, seg: [8, 5] });
    // orelhas
    if (o.ears !== false) b.ell(shade(skin, 0.96), hp(s * 1.5, 0.0, -0.01), [0.04, 0.07, 0.055], hr(s * 1.5, 0), { ol: 0.009, seg: [8, 6] });
  }
  // nariz
  const nr = o.nose ?? 0.052;
  b.ell(o.noseCol ?? mix(skin, 0xd9826b, 0.18), hp(0, o.noseP ?? -0.1, -0.012), [nr, nr * (o.noseSY ?? 0.9), nr * 0.95], hr(0, -0.1), { ol: 0.008, seg: [10, 7] });
  // boca
  const mp = o.mouthP ?? -0.32;
  if (o.mouth === 'smile') {
    b.add(smileG(0.2), o.lip ?? 0x9b2c3a, hp(0, mp + 0.04, -0.004), hr(0, mp + 0.04), [0.058, 0.058, 0.06], { ol: 0 });
  } else if (o.mouth !== 'none') {
    const mw = o.mouthW ?? 0.085;
    b.add(mouthG(b.lv(14, 10, 6)), 0x6b1f2a, hp(0, mp, -0.01), hr(0, mp), [mw, mw * 0.7, 0.036], { ol: 0.007 });
    b.box(0xffffff, hp(0, mp - 0.03, 0.003), [mw * 1.55, 0.018, 0.02], 0.006, hr(0, mp - 0.03), { ol: 0 });
    b.ell(0xe86a7a, hp(0, mp - 0.13, 0.0), [mw * 0.5, 0.02, 0.02], hr(0, mp - 0.13), { ol: 0, seg: [8, 5] });
  }
}

// Barba: arco na mandíbula + parte pendurada em fileiras.
function beard(b, r, o) {
  const cols = o.colors;
  const pick = () => cols[Math.floor(r() * cols.length)];
  // mandíbula (costeletas até o queixo)
  const n = Math.max(5, Math.round((o.jawN ?? 11) * b.dens) | 1);
  for (let i = 0; i < n; i++) {
    const u = -1 + (2 * i) / (n - 1);
    const yaw = u * (o.jawYaw ?? 1.45);
    const pitch = -0.08 - (o.jawDrop ?? 0.62) * Math.pow(1 - Math.abs(u), 0.7);
    const rad = (o.jawR ?? 0.085) * (0.9 + r() * 0.25);
    b.blob(pick(), hp(yaw, pitch, o.jawLift ?? 0.0), [rad, rad * 1.1, rad * 0.85], hr(yaw, pitch), { ol: 0.01 });
  }
  // parte pendurada
  const rows = o.rows ?? 0;
  for (let k = 0; k < rows; k++) {
    const t = rows === 1 ? 0 : k / (rows - 1);
    const y = o.top + (o.bottom - o.top) * t;
    const w = o.round ? o.width * Math.sqrt(Math.max(0.05, 1 - t * t * 0.85)) : o.width + (o.tipW - o.width) * t;
    const cnt = Math.max(1, Math.round(((2 * w) / (o.size * 1.1)) * b.dens) + 1);
    for (let i = 0; i < cnt; i++) {
      const u = cnt === 1 ? 0 : -1 + (2 * i) / (cnt - 1);
      const x = u * w + (r() - 0.5) * 0.02;
      const z = o.z - u * u * 0.09 + (o.zLean ?? 0) * t + (r() - 0.5) * 0.015;
      const s = (o.size / Math.sqrt(b.dens)) * (0.85 + r() * 0.3) * (1 - t * (o.shrink ?? 0.25));
      const wild = o.wild ?? 0;
      b.blob(pick(), [x, y + (r() - 0.5) * 0.03, z], [s, s * (1.15 + wild * 0.6), s * 0.85], [(r() - 0.5) * wild, 0, u * 0.3 * wild + (r() - 0.5) * wild], { ol: 0.011 });
    }
  }
}

function mustache(b, color, o = {}) {
  const p = o.p ?? -0.19, w = o.w ?? 0.085, h = o.h ?? 0.045, tilt = o.tilt ?? 0.3, yaw = o.yaw ?? 0.12;
  for (const s of [1, -1]) {
    b.ell(color, hp(s * yaw, p, o.lift ?? 0.018), [w, h, h * 0.95], hr(s * yaw, p, -s * tilt), { ol: 0.008 });
  }
}

// Aro de óculos: moldura retangular de cantos arredondados no plano XY, com largura 1
// (altura ar, raio do canto rr, espessura do aro th, profundidade dp; tudo relativo à largura).
const rimG = (ar, rr, th, dp, cs = 3) => G(`g${ar}.${rr}.${th}.${dp}.${cs}`, () => {
  const rect = (p, w, h, r) => {
    const x = -w / 2, y = -h / 2;
    p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r);
    p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r);
    p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y);
  };
  const s = new THREE.Shape();
  rect(s, 1, ar, rr);
  const hole = new THREE.Path();
  rect(hole, 1 - 2 * th, ar - 2 * th, Math.max(0.02, rr - th));
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: dp, bevelEnabled: false, curveSegments: cs });
  g.translate(0, 0, -dp / 2);
  return g;
});

// Óculos de aros retangulares: lentes sobre os olhos, ponte e hastes que seguem a cabeça até a orelha.
function glasses(b, color, o = {}) {
  const yaw = o.yaw ?? 0.33, p = o.p ?? 0.02, lift = o.lift ?? 0.036, W = o.w ?? 0.17;
  const geo = rimG(o.ar ?? 0.78, o.r ?? 0.14, o.th ?? 0.08, o.dp ?? 0.07, b.lv(3, 2, 1, 1));
  const tr = o.temple ?? 0.009;
  const inner = [];
  for (const s of [1, -1]) {
    const c = hp(s * yaw, p, lift);
    const ly = s * yaw * (o.flat ?? 0.75); // lentes mais de frente que a curva da cabeça
    const ax = Math.cos(ly), az = -Math.sin(ly);
    b.add(geo, color, c, hr(ly, p, s * (o.roll ?? 0)), W, { ol: o.ol ?? 0 });
    const hw = W / 2 - W * (o.th ?? 0.08) * 0.5;
    const edge = [c[0] + s * hw * ax, c[1] + (o.templeY ?? 0.012), c[2] + s * hw * az];
    inner.push([c[0] - s * hw * ax, c[1] + 0.012, c[2] - s * hw * az]);
    const pts = [edge, ...[0.95, 1.22, 1.46].map((y) => hp(s * y, p + 0.06, o.templeLift ?? 0.018))];
    for (let i = 0; i < 3; i++) b.cyl(color, pts[i], pts[i + 1], tr, tr, 5, { ol: 0 });
  }
  b.cyl(color, inner[0], inner[1], tr * 1.1, tr * 1.1, 5, { ol: 0 });
}

// Cabeça genérica (cientista sem entrada em HEADS)
function genericHead(b, L) {
  face(b, L, { mouth: 'smile' });
  hairCap(b, L.hair, 1.5, 0.5, 1.06);
}

// ---- Cabeças de cada cientista ----
const HEADS = {
  newton(b, L, r) {
    const W = L.hair, W2 = 0xdcd4c6, W3 = 0xc9c0b0;
    face(b, L, { ears: false, brow: 0x8a7a68, nose: 0.06, noseSY: 1.05, mouth: 'grin', browTilt: 0.05 });
    hairCap(b, W, 1.42, 0.62, 1.08);
    // topo repartido ao meio
    for (const s of [1, -1]) b.blob(W, [s * 0.11, 0.2, 0.0], [0.17, 0.13, 0.22], [0.1, 0, -s * 0.45]);
    // cachos da peruca caindo até os ombros (fileiras desencontradas)
    const tone = [W2, W, W3, W];
    const nc = b.dens < 1 ? 6 : 8;
    for (let k = 0; k < 4; k++) {
      const n = k % 2 ? nc : nc + 1;
      for (let i = 0; i < n; i++) {
        const u = (i + (k % 2 ? 0.5 : 0)) / nc;
        const yaw = 1.12 + u * (TAU - 2.24) + (r() - 0.5) * 0.12;
        const rad = 0.27 + k * 0.036 + (r() - 0.5) * 0.015;
        const y = 0.09 - k * 0.13 + (r() - 0.5) * 0.03 - (Math.abs(Math.cos(yaw)) > 0.3 && Math.cos(yaw) > 0 ? 0.03 : 0);
        const rr = (0.1 - k * 0.004 + (r() - 0.5) * 0.02) * (b.dens < 1 ? 1.15 : 1);
        b.blob(tone[(i + k * 3) % 4], [Math.sin(yaw) * rad, y, Math.cos(yaw) * rad - 0.03], [rr, rr * 1.12, rr], null, { ol: 0.011 });
      }
    }
    // cachinhos no alto da nuca
    for (let i = 0; i < 6; i++) {
      const yaw = Math.PI + (i - 2.5) * 0.5;
      b.blob(i % 2 ? W2 : W, [Math.sin(yaw) * 0.24, 0.21 + (r() - 0.5) * 0.03, Math.cos(yaw) * 0.24 - 0.02], 0.085, null, { ol: 0.011 });
    }
  },

  curie(b, L, r) {
    const H = L.hair, H2 = shade(H, 0.84), H3 = shade(H, 1.12);
    face(b, L, { lashes: true, ears: false, brow: shade(H, 0.8), browW: 0.09, browH: 0.022, browTilt: -0.08, nose: 0.042, mouth: 'smile', lip: 0xb83a4b, eyeScale: 1.05 });
    hairCap(b, H, 1.5, 0.5, 1.07);
    // volume frontal fofo, penteado para trás
    for (let i = -3; i <= 3; i++) {
      const yaw = i * 0.3;
      b.blob(i % 2 ? H : H3, hp(yaw, 0.74 - Math.abs(i) * 0.07, 0.01), [0.1, 0.075, 0.1], hr(yaw, 0.74), { ol: 0.01 });
    }
    // laterais cobrindo as orelhas
    for (const s of [1, -1]) {
      b.blob(H, hp(s * 1.3, 0.14, -0.01), [0.08, 0.15, 0.13], hr(s * 1.3, 0.14), { ol: 0.01 });
      b.blob(H2, hp(s * 1.8, 0.05, -0.02), [0.08, 0.14, 0.13], hr(s * 1.8, 0.05), { ol: 0.01 });
    }
    // coque alto
    b.ell(H2, [0, 0.33, -0.1], [0.14, 0.125, 0.14]);
    b.ell(H3, [0.04, 0.38, -0.08], [0.07, 0.05, 0.07], null, { ol: 0 });
    b.torus(shade(H, 0.62), [0, 0.265, -0.09], [Math.PI / 2 + 0.25, 0, 0], 0.115, 0.022, TAU, { ol: 0 });
  },

  mendeleev(b, L, r) {
    const H = L.hair, H2 = shade(H, 0.8), H3 = mix(H, 0xffffff, 0.3);
    const cols = [H, H2, H3, H];
    face(b, L, { ears: false, brow: H2, browW: 0.13, browH: 0.045, browTilt: 0.22, browLift: 0.012, mouth: 'none', nose: 0.062, noseSY: 1.1 });
    hairCap(b, H, 1.42, 0.62, 1.07);
    // mechas longas penduradas até os ombros, desgrenhadas e abrindo para fora
    const ns = Math.round(8 * b.dens);
    for (let i = 0; i < ns * 2; i++) {
      const s = i % 2 ? 1 : -1;
      const j = Math.floor(i / 2);
      const yaw = s * (1.12 + j * (2 / ns) + (r() - 0.5) * 0.12);
      const rad = 0.29 + r() * 0.04;
      const len = 0.21 + r() * 0.08;
      b.blob(cols[i % 4], [Math.sin(yaw) * rad, -0.07 - r() * 0.08, Math.cos(yaw) * rad - 0.03], [0.075, len, 0.08], [-0.15 * Math.cos(yaw), yaw, s * (0.18 + r() * 0.35)], { ol: 0.011 });
    }
    // barba longa até o peito, afinando na ponta
    beard(b, r, { colors: cols, jawN: 11, jawR: 0.078, jawDrop: 0.62, jawYaw: 1.38, rows: 5, top: -0.32, bottom: -0.86, width: 0.19, tipW: 0.05, size: 0.095, z: 0.22, zLean: -0.02, wild: 0.7, shrink: 0.2 });
    mustache(b, H2, { w: 0.1, h: 0.048, tilt: 0.5, p: -0.22 });
  },

  einstein(b, L, r) {
    const W = L.hair, W2 = 0xe4e4e4, W3 = 0xcbcbcb, cols = [W, W2, W, W3];
    face(b, L, { brow: 0xbdbdbd, browW: 0.12, browH: 0.04, browTilt: -0.18, browLift: 0.01, nose: 0.064, noseSY: 1.0, mouth: 'grin', mouthP: -0.37, mouthW: 0.08 });
    hairCap(b, W, 1.25, 0.8, 1.05);
    // juba arrepiada: base fofa + mechas pontudas curtas saindo para os lados, trás e topo
    const rings = [
      { p: -0.32, n: 7, from: 1.4, len: 0.12 },
      { p: 0.0, n: 9, from: 1.2, len: 0.17 },
      { p: 0.36, n: 9, from: 0.95, len: 0.17 },
      { p: 0.72, n: 7, from: 0.35, len: 0.14 },
      { p: 1.12, n: 4, from: 0.0, len: 0.1 },
    ];
    let c = 0;
    for (const g of rings) {
      const gn = Math.max(3, Math.round(g.n * (0.3 + 0.7 * b.dens)));
      for (let i = 0; i < gn; i++) {
        const u = g.from === 0 ? (i + 0.5) / gn : i / (gn - 1);
        const yaw = g.from + (TAU - 2 * g.from) * u + (r() - 0.5) * 0.3;
        const p = g.p + (r() - 0.5) * 0.22;
        const dx = Math.sin(yaw) * Math.cos(p), dy = Math.sin(p) + 0.15, dz = Math.cos(yaw) * Math.cos(p);
        const n = Math.hypot(dx, dy, dz);
        const col = cols[c++ % 4];
        const L2 = HR + g.len * (0.75 + r() * 0.6);
        const tx = (dx / n) * L2 + (r() - 0.5) * 0.05, ty = (dy / n) * L2 + (r() - 0.3) * 0.05, tz = (dz / n) * L2;
        b.cone(col, [(dx / n) * 0.22, (dy / n) * 0.22, (dz / n) * 0.22], [tx, ty, tz], 0.095, 6, { ol: 0.01 });
        if (i % 2 === 0) b.blob(col, [(dx / n) * 0.3, (dy / n) * 0.3, (dz / n) * 0.3], 0.085, null, { ol: 0 });
      }
    }
    // bigode grosso grisalho
    mustache(b, 0xcfcfcf, { w: 0.1, h: 0.05, tilt: 0.32, p: -0.23, yaw: 0.12, lift: 0.02 });
    b.blob(0xbdbdbd, hp(0, -0.2, 0.03), [0.07, 0.04, 0.04], hr(0, -0.2), { ol: 0.006 });
  },

  galileu(b, L, r) {
    const H = L.hair, HB = 0x9c8b7a, HG = mix(HB, 0xc4bcb0, 0.45), CAP = 0x1b1b20;
    face(b, L, { brow: shade(H, 0.7), browW: 0.1, browTilt: 0.18, nose: 0.058, noseSY: 1.1, mouth: 'smile', lip: 0x7a2a2a, mouthP: -0.34 });
    // cabelo curto nas laterais e nuca
    hairCap(b, H, 1.85, 0.25, 1.05);
    // gorro preto baixo
    b.ell(CAP, [0, 0.17, -0.03], [0.325, 0.16, 0.33], [-0.18, 0, 0]);
    b.ell(CAP, [0, 0.25, -0.05], [0.26, 0.11, 0.26], [-0.18, 0, 0], { ol: 0 });
    // barba pontuda: casca lisa na mandíbula + ponta
    const [cw, ch] = b.lv([22, 8], [14, 5], [10, 4], [8, 3]);
    b.add(jawShellG(-0.5, -0.02, -1.3, cw, ch), HB, [0, 0, 0], null, [HR * 1.06, HR * 1.05, HR * 1.1], { ol: 0.01 });
    b.cone(HB, [0, -0.24, 0.2], [0, -0.48, 0.28], 0.105, 8, { ol: 0.01 });
    b.blob(HG, [0.04, -0.32, 0.25], [0.022, 0.06, 0.02], [0.3, 0, 0.25], { ol: 0 });
    mustache(b, HB, { w: 0.08, h: 0.036, tilt: 0.5, p: -0.24, yaw: 0.12 });
  },

  darwin(b, L, r) {
    const W = L.hair, W2 = 0xdedede, W3 = 0xcfcfcf, cols = [W, W2, W, W3];
    face(b, L, { ears: true, brow: W, browW: 0.13, browH: 0.05, browTilt: -0.25, browLift: 0.018, browP: 0.24, mouth: 'none', nose: 0.062, noseSY: 1.05 });
    // brilho da careca
    b.ell(mix(L.skin, 0xffffff, 0.55), hp(0.25, 0.95, -0.002), [0.07, 0.03, 0.045], hr(0.25, 0.95, 0.3), { ol: 0, seg: [8, 5] });
    // cabelo branco nas laterais e nuca
    const nh = Math.round(10 * b.dens), hs = 1 / Math.sqrt(b.dens);
    for (let i = 0; i <= nh; i++) {
      const yaw = 1.2 + i * ((TAU - 2.4) / nh);
      const p = 0.12 + Math.sin((i / nh) * Math.PI) * 0.1;
      b.blob(cols[i % 4], hp(yaw, p, 0.0), [0.09 * hs, 0.1 * hs, 0.08], hr(yaw, p), { ol: 0.011 });
      b.blob(cols[(i + 1) % 4], hp(yaw, p - 0.3, -0.01), [0.085 * hs, 0.1 * hs, 0.08], hr(yaw, p - 0.3), { ol: 0.011 });
    }
    // barba branca enorme e cheia
    beard(b, r, { colors: cols, jawN: 13, jawR: 0.105, jawDrop: 0.6, jawYaw: 1.5, rows: 4, top: -0.3, bottom: -0.66, width: 0.27, round: true, size: 0.12, z: 0.2, zLean: -0.03, wild: 0.2, shrink: 0.15 });
    mustache(b, W2, { w: 0.1, h: 0.05, tilt: 0.4, p: -0.2 });
  },

  dumont(b, L, r) {
    const H = L.hair, HAT = 0xefe4c8, HAT2 = 0xdccfa9, BAND = 0x3a2b22;
    face(b, L, { brow: H, browW: 0.09, browH: 0.022, browTilt: 0.06, nose: 0.05, mouth: 'smile', lip: 0x8a2f35, mouthP: -0.35, eyeScale: 0.98 });
    hairCap(b, H, 1.6, 0.4, 1.05);
    // bigode fino
    for (const s of [1, -1]) b.ell(H, hp(s * 0.1, -0.21, 0.014), [0.07, 0.014, 0.018], hr(s * 0.1, -0.21, -s * 0.18), { ol: 0.005 });
    // chapéu panamá de abas caídas (origem no topo da cabeça, levemente inclinado)
    b.setBase(0, 0.6, 0.03, 0.08, 0, 0.05);
    b.cyl(HAT, [0, -0.15, 0], [0, 0.07, 0], 0.255, 0.232);
    b.ell(HAT2, [0, 0.07, 0], [0.232, 0.035, 0.232], null, { ol: 0 });
    b.ell(shade(HAT2, 0.9), [0, 0.085, 0], [0.12, 0.03, 0.2], null, { ol: 0 });
    b.cyl(BAND, [0, -0.13, 0], [0, -0.07, 0], 0.262, 0.258, 0, { ol: 0.006 });
    b.cyl(HAT, [0, -0.21, 0], [0, -0.14, 0], 0.46, 0.27);
    b.setBase(0, 0.3, 0.03); // volta ao centro da cabeça
  },

  oswaldo(b, L, r) {
    const H = L.hair, H2 = mix(H, 0x8a7a70, 0.5), GL = 0x2d2d33;
    face(b, L, { brow: H, browW: 0.1, browH: 0.03, browTilt: 0.14, nose: 0.054, noseSY: 1.0, mouth: 'grin', mouthP: -0.42, mouthW: 0.07, eyeScale: 0.88 });
    hairCap(b, H, 1.5, 0.5, 1.06);
    // topete liso penteado para trás, com riscos de brilho
    b.ell(H, [0, 0.235, 0.05], [0.24, 0.1, 0.2], [0.35, 0, 0]);
    b.ell(H2, [0.07, 0.3, 0.07], [0.06, 0.012, 0.1], [0.5, 0.3, 0.2], { ol: 0, seg: [8, 5] });
    // bigode farto com pontas curvadas para cima
    mustache(b, H, { w: 0.095, h: 0.04, tilt: -0.12, p: -0.27, yaw: 0.13, lift: 0.02 });
    for (const s of [1, -1]) b.torus(H, hp(s * 0.4, -0.2, 0.02), hr(s * 0.4, -0.2, s * 0.9), 0.03, 0.014, Math.PI * 1.3, { ol: 0.005 });
    // óculos redondos com hastes que seguem a cabeça
    for (const s of [1, -1]) {
      b.torus(GL, hp(s * 0.33, 0.02, 0.028), hr(s * 0.33, 0.02), 0.07, 0.011, TAU, { ol: 0 });
      const pts = [0.56, 0.9, 1.22, 1.46].map((y) => hp(s * y, 0.07, 0.014));
      for (let i = 0; i < 3; i++) b.cyl(GL, pts[i], pts[i + 1], 0.009, 0.009, 5, { ol: 0 });
    }
    b.cyl(GL, hp(0.1, 0.03, 0.035), hp(-0.1, 0.03, 0.035), 0.009, 0.009, 5, { ol: 0 });
  },

  samuel(b, L, r) {
    const H = L.hair, H2 = mix(H, 0x6a5a50, 0.3), FADE = mix(H, L.skin, 0.4), BEARD = 0x30251e;
    face(b, L, { brow: H, browW: 0.105, browH: 0.032, browTilt: 0.03, browLift: 0.008, eyeYaw: 0.34, eyeScale: 0.86, nose: 0.057, noseSY: 0.95, mouth: 'grin', mouthP: -0.37, mouthW: 0.1 });
    // cabelo bem curto: degradê nas laterais e na nuca, mais comprido em cima e levantado na frente
    hairCap(b, FADE, 1.67, 0.78, 1.03);
    hairCap(b, H, 1.47, 0.52, 1.045);
    b.ell(H, [0, 0.17, 0.0], [0.24, 0.13, 0.23], [0.25, 0, 0]);
    // frente levantada: tufos curtos em pé ao longo da linha do cabelo, com pontinhas
    const n = Math.max(5, Math.round(8 * b.dens));
    for (let i = 0; i < n; i++) {
      const u = -1 + (2 * i) / (n - 1);
      const yaw = u * 0.62 + (r() - 0.5) * 0.06;
      const p = 0.76 - Math.abs(u) * 0.06 + (r() - 0.5) * 0.04;
      const tip = hp(yaw * 1.08, p + 0.12, 0.075 - Math.abs(u) * 0.02 + r() * 0.012);
      b.cone(i % 3 ? H : H2, hp(yaw, p - 0.02, -0.01), tip, 0.06, 6, { ol: 0.008 });
    }
    // barba curta e aparada: casca na mandíbula (das costeletas, na frente da orelha, até o queixo)
    const [cw, ch] = b.lv([24, 8], [16, 5], [10, 4], [8, 3]);
    b.add(jawShellG(-0.62, -0.05, -1.28, cw, ch, 1.42, -0.6), BEARD, [0, 0, 0], null, [HR * 1.035, HR * 1.03, HR * 1.05], { ol: 0.008 });
    b.blob(BEARD, hp(0, -0.8, -0.01), [0.1, 0.065, 0.07], hr(0, -0.8), { ol: 0.008 });
    // bigode ligado à barba pelos cantos da boca
    mustache(b, BEARD, { w: 0.076, h: 0.024, tilt: 0.18, p: -0.255, yaw: 0.105, lift: 0.012 });
    for (const s of [1, -1]) b.ell(BEARD, hp(s * 0.33, -0.44, 0.0), [0.026, 0.07, 0.024], hr(s * 0.33, -0.44, s * 0.3), { ol: 0.006 });
    // óculos retangulares de armação preta fina
    glasses(b, 0x141418, { yaw: 0.34, w: 0.18, ar: 0.72, r: 0.13, th: 0.065, templeLift: 0.024 });
  },

  lattes(b, L, r) {
    const H = L.hair, H2 = mix(H, 0x8a7a70, 0.4);
    face(b, L, { brow: H, browW: 0.105, browH: 0.032, browTilt: 0.02, browLift: 0.006, nose: 0.055, noseSY: 1.05, mouth: 'smile', lip: 0x8a3a3a, mouthP: -0.35 });
    hairCap(b, H, 1.44, 0.5, 1.055);
    // penteado para trás, com o topete (onda) na frente, puxado para a esquerda da risca
    b.ell(H, [0, 0.19, -0.04], [0.25, 0.12, 0.25], [0.15, 0, 0]);
    b.ell(H, [0.025, 0.25, 0.1], [0.19, 0.1, 0.16], [0.5, 0.1, -0.1]);
    b.ell(H, [0.05, 0.29, 0.17], [0.13, 0.065, 0.08], [0.9, 0.15, -0.12], { ol: 0.009 });
    for (const [x, ry] of [[-0.06, -0.2], [0.03, 0.05], [0.12, 0.3]]) {
      b.ell(H2, [x, 0.31 - Math.abs(x - 0.03) * 0.3, 0.02], [0.018, 0.01, 0.13], [0.2, ry, 0], { ol: 0, seg: [8, 5] });
    }
  },

  franklin(b, L, r) {
    const H = L.hair, H2 = shade(H, 0.8), H3 = mix(H, 0x8a5a3a, 0.3);
    face(b, L, { lashes: true, ears: false, brow: shade(H, 0.9), browW: 0.095, browH: 0.024, browTilt: -0.04, nose: 0.045, mouth: 'smile', lip: 0xb0485a, eyeScale: 1.03 });
    hairCap(b, H, 1.56, 0.5, 1.07);
    // risca do lado direito do rosto (-X): o volume de cima vai para a esquerda (+X)
    const nt = Math.max(4, Math.round(6 * b.dens));
    for (let i = 0; i < nt; i++) {
      const u = i / (nt - 1);
      const yaw = -0.35 + u * 1.25, p = 0.66 + Math.sin(u * Math.PI) * 0.1;
      b.blob(i % 2 ? H : H3, hp(yaw, p, 0.015), [0.12, 0.07, 0.11], hr(yaw, p, -0.45), { ol: 0.01 });
    }
    // ondas curtas nas laterais e na nuca, terminando na altura do queixo
    const nw = Math.max(3, Math.round(4 * b.dens));
    for (const s of [1, -1]) {
      for (let k = 0; k < 3; k++) {
        const p = 0.24 - k * 0.24;
        for (let i = 0; i < nw; i++) {
          const yaw = s * (1.05 + (k % 2) * 0.18 + i * (1.9 / nw));
          b.blob([H, H2, H3][(i + k) % 3], hp(yaw, p, 0.005 - k * 0.004), [0.11, 0.065, 0.08], hr(yaw, p, s * 0.3), { ol: 0.01 });
        }
      }
    }
  },

  johnson(b, L, r) {
    const H = L.hair, cols = [H, shade(H, 0.86), mix(H, 0xffffff, 0.35), shade(H, 0.94)];
    const warm = mix(L.skin, 0xd0605a, 0.32);
    face(b, L, { lashes: true, brow: 0x4a3a34, browW: 0.095, browH: 0.026, browTilt: -0.06, browLift: 0.008, eyeScale: 0.92, nose: 0.058, noseSY: 0.86, noseCol: mix(L.skin, 0x5a2e1e, 0.12), mouth: 'smile', lip: 0x9a4652, cheek: warm, pupil: 0x1e120c });
    hairCap(b, shade(H, 0.9), 1.42, 0.55, 1.05);
    // cachos curtos e arrumados cobrindo a calota (testa e rosto livres)
    const rows = [[1.35, 3], [1.08, 7], [0.8, 11], [0.52, 12], [0.24, 12], [-0.04, 10], [-0.3, 6]];
    let c = 0;
    rows.forEach(([p, n0], k) => {
      const n = Math.max(3, Math.round(n0 * b.dens));
      for (let i = 0; i < n; i++) {
        const yaw = ((i + (k % 2) * 0.5) / n) * TAU + (r() - 0.5) * 0.12;
        const f = Math.cos(yaw);
        const line = f > 0 ? 0.62 * Math.pow(f, 0.6) : 0.1 + 0.4 * f; // linha do cabelo
        if (p < line - 0.05) continue;
        const rad = (0.066 + r() * 0.014) / Math.sqrt(b.dens);
        b.blob(cols[c++ % 4], hp(yaw, p + (r() - 0.5) * 0.05, 0.03), rad, null, { ol: 0.01 });
      }
    });
    // óculos grandes de armação clara e brincos de pérola
    glasses(b, 0xeadcbc, { yaw: 0.34, w: 0.2, ar: 0.8, r: 0.3, th: 0.1, roll: 0.06, ol: 0.004, templeLift: 0.05, temple: 0.011 });
    for (const s of [1, -1]) b.ell(0xfaf5ea, hp(s * 1.47, -0.24, 0.035), 0.019, null, { ol: 0.004 });
  },

  enedina(b, L, r) {
    const H = L.hair, H2 = mix(H, 0x6a5a55, 0.4), HELM = 0xf7f7f3, HELM2 = 0xdedfd8;
    const warm = mix(L.skin, 0xd0605a, 0.3);
    face(b, L, { lashes: true, brow: H, browW: 0.095, browH: 0.026, browTilt: -0.05, browLift: 0.008, nose: 0.054, noseSY: 0.86, noseCol: mix(L.skin, 0x3a1e14, 0.1), mouth: 'smile', lip: 0x9a4450, cheek: warm, pupil: 0x1a100c });
    // cabelo liso puxado para trás, preso num coque baixo na nuca
    hairCap(b, H, 1.55, 0.35, 1.05);
    for (const s of [1, -1]) b.ell(H2, hp(s * 0.75, 0.42, 0.012), [0.012, 0.012, 0.09], hr(s * 0.75, 0.42, 0), { ol: 0, seg: [6, 4] });
    b.ell(H, [0, -0.1, -0.285], [0.13, 0.11, 0.1]);
    b.ell(H2, [0.04, -0.07, -0.37], [0.04, 0.025, 0.02], null, { ol: 0, seg: [6, 4] });
    // capacete de obra branco: casco, friso central e aba com pala na frente
    b.setBase(0, 0.39, 0.03, -0.16, 0, 0);
    const [w, h] = b.lv([22, 10], [16, 7], [10, 5], [8, 4]);
    b.add(capG(w, h, Math.PI / 2), HELM, [0, 0, 0], null, [0.335, 0.31, 0.335]);
    b.torus(HELM2, [0, 0, 0], [0, Math.PI / 2, 0], 0.31, 0.032, Math.PI, { ol: 0.008 });
    b.cyl(HELM, [0, -0.02, 0], [0, 0.01, 0], 0.365, 0.36);
    b.ell(HELM, [0, -0.01, 0.24], [0.25, 0.022, 0.17], null, { seg: b.lv([14, 6], [10, 5]) });
    b.cyl(HELM2, [0, 0.005, 0], [0, 0.04, 0], 0.34, 0.336, 0, { ol: 0 });
    b.setBase(0, 0.3, 0.03); // volta ao centro da cabeça
  },
};

// ---- Troncos (roupa); coordenadas relativas ao quadril (pivô de inclinação) ----
const TORSO_PROFILE = [[0, 0], [0.19, 0.01], [0.245, 0.1], [0.25, 0.26], [0.225, 0.4], [0.16, 0.5], [0.08, 0.545], [0, 0.55]];
function torsoBase(b, L, C, o = {}) {
  const w = 0.9 + C.stats.weight * 0.05;
  b.add(latheG('torso', TORSO_PROFILE, b.lv(18, 12, 8, 6)), o.color ?? L.outfit, [0, 0, 0], null, [w, 1, 0.82 * w]);
  // ombros
  for (const s of [1, -1]) b.blob(o.color ?? L.outfit, [s * 0.19 * w, 0.43, 0], [0.1, 0.09, 0.1]);
  // pescoço
  b.cyl(L.skin, [0, 0.48, 0.0], [0, 0.66, 0.02], 0.075, 0.07, 0, { ol: 0 });
  return w;
}
// Raio do perfil do tronco na altura y
function torsoR(y) {
  const P = TORSO_PROFILE;
  for (let i = 1; i < P.length; i++) {
    if (y <= P[i][1]) return P[i - 1][0] + ((P[i][0] - P[i - 1][0]) * (y - P[i - 1][1])) / (P[i][1] - P[i - 1][1]);
  }
  return 0;
}
// Ponto na frente do tronco (altura y, lado x; w = largura de torsoBase), afastado `lift` da
// superfície, e a rotação que deixa +Z local na normal (para golas, botões e decalques).
function chestAt(y, x, w, lift = 0) {
  const zAt = (yy) => {
    const a = torsoR(yy) * w, k = Math.min(0.97, Math.abs(x) / a);
    return 0.82 * a * Math.sqrt(1 - k * k);
  };
  const z = zAt(y), a = torsoR(y) * w, c = 0.82 * a;
  const pitch = Math.atan2(zAt(y + 0.01) - zAt(y - 0.01), 0.02);
  const yaw = Math.atan2(x / (a * a), z / (c * c));
  return { p: [x + Math.sin(yaw) * lift, y, z + Math.cos(yaw) * lift], r: [pitch, yaw, 0] };
}
const TORSOS = {
  newton(b, L, C) {
    torsoBase(b, L, C);
    // gola e jabô de renda branca
    b.torus(L.outfitAccent, [0, 0.54, 0.0], [Math.PI / 2, 0, 0], 0.085, 0.03);
    b.ell(L.outfitAccent, [0, 0.46, 0.14], [0.07, 0.06, 0.04], [0.3, 0, 0]);
    b.ell(L.outfitAccent, [0, 0.38, 0.17], [0.06, 0.06, 0.035], [0.2, 0, 0]);
    for (let i = 0; i < 3; i++) b.ell(0xe0b84a, [0, 0.27 - i * 0.08, 0.2], 0.018, null, { ol: 0.005 });
  },
  curie(b, L, C) {
    torsoBase(b, L, C);
    // gola alta preta com broche branco
    b.cyl(L.outfit, [0, 0.49, 0], [0, 0.62, 0.015], 0.088, 0.083);
    b.ell(L.outfitAccent, [0, 0.52, 0.09], 0.02, null, { ol: 0.005 });
    for (let i = 0; i < 4; i++) b.ell(0x3a3a44, [0, 0.4 - i * 0.08, 0.2 - i * 0.004], 0.014, null, { ol: 0 });
  },
  mendeleev(b, L, C) {
    torsoBase(b, L, C);
    for (const s of [1, -1]) b.box(L.outfitAccent, [s * 0.09, 0.36, 0.18], [0.06, 0.24, 0.03], 0.012, [0.2, 0, s * 0.3]);
  },
  einstein(b, L, C) {
    const w = torsoBase(b, L, C);
    // suéter com punho/gola canelados e colarinho branco
    b.torus(L.outfitAccent, [0, 0.515, 0.0], [Math.PI / 2, 0, 0], 0.1, 0.028);
    b.torus(L.outfitAccent, [0, 0.03, 0.0], [Math.PI / 2, 0, 0], 0.2 * w, 0.03, TAU, { ol: 0 });
    for (const s of [1, -1]) b.box(0xffffff, [s * 0.055, 0.52, 0.08], [0.07, 0.02, 0.07], 0.01, [0.5, s * 0.3, s * 0.4]);
  },
  galileu(b, L, C) {
    torsoBase(b, L, C);
    // gola branca larga deitada sobre os ombros
    b.cyl(L.outfitAccent, [0, 0.47, 0.01], [0, 0.5, 0.01], 0.2, 0.15, 0, { ol: 0.008 });
  },
  darwin(b, L, C) {
    torsoBase(b, L, C);
    for (const s of [1, -1]) b.box(shade(L.outfit, 0.8), [s * 0.1, 0.33, 0.18], [0.06, 0.26, 0.03], 0.012, [0.2, 0, s * 0.3]);
  },
  dumont(b, L, C) {
    torsoBase(b, L, C);
    // colarinho alto branco e gravata
    b.cyl(L.outfitAccent, [0, 0.49, 0.0], [0, 0.63, 0.015], 0.086, 0.082);
    b.ell(0x8c1c2c, [0, 0.49, 0.1], [0.035, 0.03, 0.02], null, { ol: 0.005 });
    b.box(0x8c1c2c, [0, 0.4, 0.17], [0.045, 0.14, 0.02], 0.01, [0.25, 0, 0]);
    for (const s of [1, -1]) b.box(shade(L.outfit, 0.8), [s * 0.08, 0.36, 0.175], [0.05, 0.22, 0.03], 0.012, [0.2, 0, s * 0.35]);
  },
  oswaldo(b, L, C) {
    torsoBase(b, L, C);
    // jaleco: lapelas, camisa escura e gravata
    b.box(0xdfe4ea, [0, 0.43, 0.14], [0.12, 0.12, 0.05], 0.02, [0.4, 0, 0], { ol: 0 });
    b.box(L.outfitAccent, [0, 0.35, 0.175], [0.04, 0.2, 0.02], 0.01, [0.22, 0, 0]);
    for (const s of [1, -1]) b.box(0xe4e8ee, [s * 0.075, 0.36, 0.18], [0.05, 0.24, 0.03], 0.012, [0.2, 0, s * 0.4]);
    b.box(0xdfe4ea, [0.12, 0.25, 0.19], [0.08, 0.06, 0.02], 0.01, [0.1, 0.2, 0], { ol: 0.005 });
    b.box(0x2e86de, [0.12, 0.29, 0.2], [0.012, 0.05, 0.012], 0.004, [0.1, 0.2, 0], { ol: 0 });
  },
  samuel(b, L, C) {
    const w = torsoBase(b, L, C);
    // camiseta henley: gola redonda canelada, carcela com 3 botões e o alvo da Quanta no peito
    const RIB = shade(L.outfit, 0.9);
    b.torus(RIB, [0, 0.515, 0.008], [Math.PI / 2 + 0.12, 0, 0], 0.09, 0.021);
    const pk = chestAt(0.43, 0, w, 0.006);
    b.box(RIB, pk.p, [0.056, 0.15, 0.016], 0.008, pk.r, { ol: 0.005 });
    for (let i = 0; i < 3; i++) {
      const bt = chestAt(0.475 - i * 0.043, 0, w, 0.016);
      b.ell(0x8b6a48, bt.p, [0.012, 0.012, 0.007], bt.r, { ol: 0.004, seg: [8, 6] });
    }
    const lg = chestAt(0.37, 0.105, w, 0.004);
    b.decal(emblemUV('samuel'), lg.p, lg.r, 0.062, 0.062, true);
  },
  lattes(b, L, C) {
    const w = torsoBase(b, L, C);
    // paletó com lapelas; no decote em V, camisa branca e gravata; lenço no bolso
    const SH = 0xffffff, TIE = 0x8e2430, LAP = shade(L.outfit, 0.8);
    b.cyl(SH, [0, 0.475, 0], [0, 0.555, 0.012], 0.09, 0.085);
    const v = chestAt(0.43, 0, w, 0.003);
    b.box(SH, v.p, [0.12, 0.15, 0.02], 0.02, v.r, { ol: 0.005 });
    for (const s of [1, -1]) b.box(SH, [s * 0.04, 0.515, 0.085], [0.06, 0.028, 0.05], 0.01, [0.7, s * 0.45, s * 0.55], { ol: 0.005 });
    const kn = chestAt(0.49, 0, w, 0.018);
    b.ell(TIE, kn.p, [0.03, 0.028, 0.02], kn.r, { ol: 0.005 });
    const ti = chestAt(0.4, 0, w, 0.014);
    b.box(TIE, ti.p, [0.042, 0.15, 0.014], 0.012, ti.r, { ol: 0.005 });
    for (const s of [1, -1]) {
      const lp = chestAt(0.4, s * 0.085, w, 0.01);
      b.box(LAP, lp.p, [0.06, 0.24, 0.026], 0.012, [lp.r[0], lp.r[1], s * 0.38]);
    }
    const pq = chestAt(0.33, 0.14, w, 0.012);
    b.box(SH, pq.p, [0.05, 0.03, 0.014], 0.006, [pq.r[0], pq.r[1], 0.3], { ol: 0.004 });
  },
  franklin(b, L, C) {
    const w = torsoBase(b, L, C);
    // jaleco branco aberto sobre a blusa azul-escura; bolso com caneta
    const BL = L.outfitAccent, LAP = 0xe4e9ef;
    b.cyl(BL, [0, 0.47, 0], [0, 0.55, 0.012], 0.088, 0.083);
    const v = chestAt(0.43, 0, w, 0.003);
    b.box(BL, v.p, [0.13, 0.16, 0.02], 0.02, v.r, { ol: 0.005 });
    for (const s of [1, -1]) b.box(BL, [s * 0.042, 0.508, 0.09], [0.065, 0.03, 0.05], 0.012, [0.7, s * 0.45, s * 0.5], { ol: 0.005 });
    for (const s of [1, -1]) {
      const lp = chestAt(0.4, s * 0.088, w, 0.01);
      b.box(LAP, lp.p, [0.06, 0.24, 0.026], 0.012, [lp.r[0], lp.r[1], s * 0.36]);
    }
    const pk = chestAt(0.28, -0.12, w, 0.008);
    b.box(LAP, pk.p, [0.08, 0.06, 0.02], 0.01, pk.r, { ol: 0.005 });
    b.box(0x9b5de5, [pk.p[0], pk.p[1] + 0.045, pk.p[2] + 0.004], [0.012, 0.05, 0.012], 0.004, pk.r, { ol: 0 });
  },
  johnson(b, L, C) {
    const w = torsoBase(b, L, C);
    // gola redonda e colar de pérolas, mais baixo na frente
    b.torus(shade(L.outfit, 0.85), [0, 0.515, 0.008], [Math.PI / 2 + 0.1, 0, 0], 0.092, 0.02);
    const n = b.lv(13, 11, 9, 7);
    for (let i = 0; i < n; i++) {
      const a = -1.3 + (2.6 * i) / (n - 1);
      const pe = chestAt(0.49 - 0.06 * Math.cos(a), Math.sin(a) * 0.115, w, 0.014);
      b.ell(0xfaf5ea, pe.p, 0.017, null, { ol: 0.004, seg: b.lv([7, 5], [6, 4]) });
    }
    for (let i = 0; i < 3; i++) {
      const bt = chestAt(0.33 - i * 0.07, 0, w, 0.01);
      b.ell(shade(L.outfit, 0.7), bt.p, [0.014, 0.014, 0.008], bt.r, { ol: 0, seg: [8, 6] });
    }
  },
  enedina(b, L, C) {
    const w = torsoBase(b, L, C);
    // gola branca deitada nos ombros, com as duas pontas na frente; botões e um lápis no bolso
    const WH = L.outfitAccent;
    const cr = torsoR(0.47) * w + 0.012;
    b.add(cylG(0.6, b.lv(18, 12, 8, 6)), WH, [0, 0.488, 0.004], null, [cr, 0.036, cr * 0.84], { ol: 0.008 });
    b.cyl(WH, [0, 0.49, 0], [0, 0.55, 0.012], 0.088, 0.084);
    for (const s of [1, -1]) {
      const cp = chestAt(0.455, s * 0.05, w, 0.006);
      b.ell(WH, cp.p, [0.05, 0.036, 0.012], [cp.r[0], cp.r[1], s * 0.7], { ol: 0.006 });
    }
    for (let i = 0; i < 3; i++) {
      const bt = chestAt(0.42 - i * 0.075, 0, w, 0.01);
      b.ell(WH, bt.p, [0.014, 0.014, 0.008], bt.r, { ol: 0.003, seg: [8, 6] });
    }
    const pk = chestAt(0.33, 0.12, w, 0.008);
    b.box(shade(L.outfit, 0.85), pk.p, [0.08, 0.06, 0.018], 0.01, pk.r, { ol: 0.005 });
    b.cyl(0xffc300, [pk.p[0] + 0.015, pk.p[1] + 0.01, pk.p[2] + 0.006], [pk.p[0] + 0.02, pk.p[1] + 0.09, pk.p[2] - 0.004], 0.009, 0.009, 6, { ol: 0.004 });
    b.cyl(0xf28aa0, [pk.p[0] + 0.02, pk.p[1] + 0.09, pk.p[2] - 0.004], [pk.p[0] + 0.021, pk.p[1] + 0.105, pk.p[2] - 0.006], 0.009, 0.009, 6, { ol: 0 });
  },
};
// Cor da calça de cada um
const PANTS = {
  newton: 0x3b2618, curie: 0x1c1c22, mendeleev: 0x23253a, einstein: 0x4a4a52,
  galileu: 0x1f1f1f, darwin: 0x2b2222, dumont: 0x2e3a4f, oswaldo: 0x2d3142,
  samuel: 0x2f3c56, lattes: 0x324152, franklin: 0x2b3148, johnson: 0x3a2e3a, enedina: 0x3c464d,
};
// Cor do punho da manga
const CUFFS = {
  newton: 0xf5f0e1, curie: 0x2a2a33, mendeleev: 0x8d99ae, einstein: 0x3d3d3d,
  galileu: 0xf1ede4, darwin: 0xd9cbb0, dumont: 0xffffff, oswaldo: 0xdfe4ea,
  samuel: 0xe6e6e2, lattes: 0xffffff, franklin: 0x33415c, johnson: 0x5e2046, enedina: 0xffffff,
};
// Braços especiais (o padrão é manga comprida com punho)
const ARMS = {
  // camiseta de manga curta: manga branca com barra e antebraço de pele
  samuel(b, L) {
    b.limb(L.outfit, [0, 0, 0], [0, 0, 0.15], 0.075);
    b.cyl(shade(L.outfit, 0.92), [0, 0, 0.13], [0, 0, 0.175], 0.08, 0.08);
    b.limb(L.skin, [0, 0, 0.16], [0, 0, ARM_LEN - 0.04], 0.058);
  },
};

// ---------------------------------------------------------------------------
// Kart
// ---------------------------------------------------------------------------
// Rodas: raio traseiro/dianteiro e posições (x, z)
const RR = 0.29, RF = 0.24, WX = 0.55, ZR = -0.58, ZF = 0.6;
const SW_POS = new THREE.Vector3(0, 0.72, 0.13), SW_TILT = 0.5, SW_R = 0.16;
const LEAN_POS = new THREE.Vector3(0, 0.36, -0.3);
const NECK_POS = new THREE.Vector3(0, 0.62, 0.02);
const SHOULDER = 0.2;
const HAND_A = 0.9; // ângulo das mãos no aro (a partir do topo)
const ARM_LEN = 0.46;
const DARK = 0x2a2d34, METAL = 0x5d636e, CHROME = 0xc9ced6, SEAT = 0x26282e;

// Proporções do kart pelos atributos (statFactor: -1 a +1; 3 = kart padrão).
// Peso: pontões, traseira e rodas maiores (chassi sobe junto); velocidade: bico mais longo e baixo;
// peso 4 ou 5: motor e escapamentos maiores. Calculado uma vez por personagem.
function kartDims(C) {
  const st = C.stats || {};
  const w = statFactor(st.weight ?? 3), sp = statFactor(st.speed ?? 3);
  const wide = 1 + 0.12 * w;
  const rr = RR * (1 + 0.15 * w), rf = RF * (1 + 0.15 * w);
  const podW = 0.22 * wide;
  const noseL = 0.66 * (1 + 0.14 * sp), noseH = 0.26 * (1 - 0.12 * sp);
  const eng = (st.weight ?? 3) >= 4 ? 1 + 0.12 * ((st.weight ?? 3) - 3) : 1;
  return {
    rr, rf,
    wx: WX * (1 + 0.04 * w), // bitola acompanha os pontões
    wheelShift: rr - RR, // decalques do pontão fogem da roda traseira quando ela cresce
    lift: (rr - RR) * 0.5, // rodas maiores levantam o chassi (e o piloto)
    podW, podX: 0.33 + podW / 2, podOut: 0.33 + podW + 0.003, // borda interna fixa; decalques na face externa
    rearW: 0.84 * wide,
    noseL, noseH, noseZ: 0.58 + (noseL - 0.66) / 2, noseY: 0.18 + noseH / 2, noseTilt: 0.07 + 0.04 * sp,
    noseFront: 0.91 + (noseL - 0.66),
    eng,
    exhaustTip: -0.95 - 0.14 * (eng - 1),
  };
}

function kartBody(b, C, num, D) {
  const K = C.colors.kart, A = C.colors.kartAccent;
  const nUV = numUV(num);
  // assoalho
  b.box(DARK, [0, 0.19, -0.05], [0.84, 0.12, 1.5], 0.05, null, { ol: 0 });
  // bico arredondado (topo inclinado: altura do topo em cada z)
  const nTop = (z) => D.noseY + D.noseH / 2 - (z - D.noseZ) * Math.tan(D.noseTilt);
  const dz = D.noseFront - 0.91, dy = (0.26 - D.noseH) / 2;
  b.box(K, [0, D.noseY, D.noseZ], [0.92, D.noseH, D.noseL], 0.12, [D.noseTilt, 0, 0]);
  b.box(A, [0, nTop(D.noseZ - 0.02) + 0.005, D.noseZ - 0.02], [0.16, 0.02, 0.56 * D.noseL / 0.66], 0.01, [D.noseTilt, 0, 0], { ol: 0 });
  // faróis
  for (const s of [1, -1]) {
    b.ell(0xfff4c2, [s * 0.29, 0.33 - dy, 0.9 + dz], [0.065, 0.055, 0.03], null, { ol: 0.01 });
    b.ell(0xffffff, [s * 0.27, 0.35 - dy, 0.92 + dz], 0.015, null, { ol: 0, seg: [6, 4] });
  }
  // para-choques
  b.limb(A, [-0.47, 0.2, 0.9 + dz], [0.47, 0.2, 0.9 + dz], 0.065);
  b.limb(A, [-0.36 * D.rearW / 0.84, 0.19, -0.9], [0.36 * D.rearW / 0.84, 0.19, -0.9], 0.055);
  // painel (cockpit) e coluna de direção
  b.box(K, [0, 0.5, 0.42], [0.62, 0.2, 0.32], 0.08, [0.25, 0, 0]);
  b.box(A, [0, 0.56, 0.43], [0.64, 0.05, 0.2], 0.02, [0.25, 0, 0], { ol: 0.008 });
  b.cyl(DARK, [0, 0.54, 0.4], [SW_POS.x, SW_POS.y, SW_POS.z], 0.028);
  // laterais (pontões)
  const numZ = C.id === 'einstein' ? 0.23 : 0.14;
  for (const s of [1, -1]) {
    b.box(K, [s * D.podX, 0.33, -0.06], [D.podW, 0.3, 0.86], 0.06);
    b.box(A, [s * D.podX, 0.49, -0.06], [D.podW - 0.02, 0.04, 0.8], 0.02, null, { ol: 0.008 });
    b.decal(nUV, [s * D.podOut, 0.33, numZ], [0, s * Math.PI / 2, 0], 0.2, 0.2, true);
  }
  // traseira + banco
  b.box(K, [0, 0.35, -0.62], [D.rearW, 0.28, 0.46], 0.1);
  b.box(SEAT, [0, 0.31, -0.33], [0.46, 0.09, 0.38], 0.04, null, { ol: 0 });
  b.box(SEAT, [0, 0.64, -0.53], [0.52, 0.52, 0.1], 0.05, [-0.2, 0, 0]);
  b.box(A, [0, 0.9, -0.58], [0.5, 0.06, 0.1], 0.03, [-0.2, 0, 0], { ol: 0.008 });
  // encosto: emblema do cientista (a câmera de perseguição vê)
  const back = [0, 0.747, -0.607], backR = [-0.2, Math.PI, 0];
  if (C.id === 'einstein') b.decal(cellUV(1, 0, 4, 1), back, backR, 0.46, 0.115);
  else if (C.id === 'dumont') b.decal(cellUV(5, 0, 2, 1), back, backR, 0.34, 0.17);
  else b.decal(emblemUV(C.id), back, backR, 0.23, 0.23, true);
  b.decal(nUV, [0, nTop(D.noseZ + 0.04) + 0.018, D.noseZ + 0.04], [-Math.PI / 2 + D.noseTilt, 0, 0], 0.2, 0.2, true);
  // motor e escapamentos (pontas em (±0.3, 0.45, D.exhaustTip)); pesados têm motor maior
  const e = D.eng, eTop = 0.45 + 0.2 * e;
  b.box(METAL, [0, 0.45 + 0.1 * e, -0.76], [0.44 * e, 0.2 * e, 0.28 * e], 0.05);
  for (let i = 0; i < 3; i++) b.box(shade(METAL, 0.8), [0, eTop + 0.01, -0.76 + (0.08 - i * 0.08) * e], [0.4 * e, 0.03, 0.04], 0, null, { ol: 0 });
  b.cyl(DARK, [0, eTop - 0.01, -0.74], [0, eTop + 0.07 * e, -0.74], 0.07 * e, 0.06 * e);
  for (const s of [1, -1]) {
    const tip = D.exhaustTip;
    b.cyl(CHROME, [s * 0.2 * e, 0.47, -0.72], [s * 0.3, 0.45, tip + 0.02], 0.045 * e, 0.05 * e);
    b.cyl(shade(CHROME, 0.8), [s * 0.3, 0.45, tip + 0.03], [s * 0.3, 0.45, tip], 0.062 * e, 0.062 * e);
    b.ell(0x111111, [s * 0.3, 0.45, tip - 0.003], [0.045 * e, 0.045 * e, 0.01], null, { ol: 0 });
  }
  // eixos (no centro das rodas; o chassi inteiro está levantado em D.lift)
  b.cyl(DARK, [-D.wx, D.rf - D.lift, ZF], [D.wx, D.rf - D.lift, ZF], 0.035, 0.035, 8, { ol: 0 });
  b.cyl(DARK, [-D.wx, D.rr - D.lift, ZR], [D.wx, D.rr - D.lift, ZR], 0.04, 0.04, 8, { ol: 0 });
}

// Pernas do piloto (fixas no kart)
function legs(b, id) {
  const pants = PANTS[id] ?? 0x2d3142;
  for (const s of [1, -1]) {
    // só a coxa aparece; canela e pé ficam sob o painel
    b.limb(pants, [s * 0.11, 0.38, -0.24], [s * 0.13, 0.52, 0.1], 0.075);
    b.limb(pants, [s * 0.13, 0.52, 0.1], [s * 0.13, 0.46, 0.24], 0.065, { ol: 0 });
  }
}

// Roda unitária (raio 1), eixo em X, calota virada para +X.
function wheelGeo(C, detail) {
  const b = new Builder({ detail, ol: 0.035 });
  const K = C.colors.kart, A = C.colors.kartAccent;
  b.add(torusG(0.52, b.lv(7, 6, 5, 4), b.lv(16, 12, 10, 8)), 0x222226, [0, 0, 0], [0, Math.PI / 2, 0], 0.66);
  b.cyl(A, [-0.34, 0, 0], [0.34, 0, 0], 0.5, 0.5, b.lv(14, 10, 8, 6), { ol: 0 });
  b.blob(K, [0.33, 0, 0], [0.12, 0.3, 0.3], null, { ol: 0.03 });
  if (detail < 0) return b.build(); // de longe: sem raios nem sulcos
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    b.box(0xffffff, [0.36, Math.cos(a) * 0.36, Math.sin(a) * 0.36], [0.04, 0.2, 0.1], 0, [a, 0, 0], { ol: 0 });
  }
  // sulcos do pneu
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    b.box(0x3a3a40, [0, Math.cos(a) * 0.985, Math.sin(a) * 0.985], [0.3, 0.04, 0.08], 0, [a, 0, 0], { ol: 0 });
  }
  return b.build();
}

// Volante com as mãos (gira em torno de Z local)
function steeringGeo(C, L, detail) {
  const b = new Builder({ detail, ol: 0.01 });
  b.add(torusG(0.15, b.lv(6, 5, 4, 3), b.lv(18, 12, 8, 6)), 0x1e2026, [0, 0, 0], null, SW_R);
  b.cyl(C.colors.kartAccent, [0, 0, -0.03], [0, 0, 0.02], 0.05, 0.05);
  for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
    b.box(0x1e2026, [Math.sin(a) * SW_R * 0.5, Math.cos(a) * SW_R * 0.5, 0], [0.025, SW_R, 0.02], 0.008, [0, 0, -a], { ol: 0 });
  }
  for (const s of [1, -1]) {
    b.ell(L.skin, [s * Math.sin(HAND_A) * SW_R, Math.cos(HAND_A) * SW_R, -0.01], [0.062, 0.058, 0.07]);
  }
  return b.build();
}

// Braço: cápsula ao longo de +Z (ombro na origem), punho perto da ponta
function armGeo(L, id, detail) {
  const b = new Builder({ detail, ol: 0.01 });
  if (ARMS[id]) {
    ARMS[id](b, L);
    return b.build();
  }
  const cuff = CUFFS[id] ?? L.outfitAccent;
  b.limb(L.outfit, [0, 0, 0], [0, 0, ARM_LEN - 0.04], 0.066);
  b.cyl(cuff, [0, 0, ARM_LEN - 0.1], [0, 0, ARM_LEN - 0.04], 0.074, 0.074);
  return b.build();
}

// ---- Acessórios de cada kart. ext: registra partes animadas ----
const KART_EXTRAS = {
  newton(b, C, ext, D) {
    // maçã vermelha no painel
    const p = [0.2, 0.67, 0.43];
    b.ell(0xd62828, p, [0.085, 0.078, 0.085]);
    b.ell(0xff6b6b, [p[0] + 0.03, p[1] + 0.03, p[2] + 0.05], 0.022, null, { ol: 0 });
    b.cyl(0x5b3a29, [p[0], p[1] + 0.06, p[2]], [p[0] + 0.01, p[1] + 0.11, p[2]], 0.01, 0.008, 5);
    b.ell(0x3a9d4e, [p[0] + 0.04, p[1] + 0.1, p[2]], [0.04, 0.012, 0.02], [0, 0, 0.5]);
    emblemSides(b, D, emblemUV('newton'));
  },
  curie(b, C, ext, D) {
    // suporte do frasco (o líquido brilhante é uma malha separada)
    const x = Math.min(0.32, D.rearW / 2 - 0.07), y = 0.49, z = -0.64; // não sobra para fora da traseira estreita
    b.cyl(C.colors.kartAccent, [x, y - 0.02, z], [x, y + 0.03, z], 0.13, 0.13);
    b.cyl(0x8a5a3a, [x, y + 0.36, z], [x, y + 0.42, z], 0.045, 0.05);
    b.torus(0xd0e8ff, [x, y + 0.33, z], [Math.PI / 2, 0, 0], 0.05, 0.012, TAU, { ol: 0 });
    ext.vial = { pos: [x, y + 0.02, z] };
    emblemSides(b, D, emblemUV('curie'));
  },
  mendeleev(b, C, ext, D) {
    // quadradinhos da tabela periódica
    const sides = [['H', 'He', 'C', 'O'], ['Na', 'Fe', 'Ga', 'Md']];
    for (const s of [1, -1]) {
      const syms = sides[s > 0 ? 0 : 1];
      for (let i = 0; i < 4; i++) {
        const zz = -0.16 + D.wheelShift - (i % 2) * 0.13, yy = 0.39 - Math.floor(i / 2) * 0.13;
        b.decal(tileUV(syms[i]), [s * D.podOut, yy, zz], [0, s * Math.PI / 2, 0], 0.12, 0.12);
      }
    }
    const nose = ['Li', 'N', 'Ne', 'Mg', 'Cu', 'Ge'];
    for (let i = 0; i < 6; i++) {
      const s = i < 3 ? 1 : -1, k = i % 3;
      b.decal(tileUV(nose[i]), [s * 0.462, D.noseY - 0.01, D.noseZ - 0.16 + k * 0.13], [0, s * Math.PI / 2, 0], 0.11, 0.11);
    }
    const back = [['Au', 0.34, 0.34], ['Ra', 0.11, 0.3], ['O', -0.11, 0.3], ['C', -0.34, 0.34]];
    for (const [sym, x, y] of back) b.decal(tileUV(sym), [x, y, -0.853], [0, Math.PI, 0], 0.11, 0.11);
    // placa "Md" no painel
    b.decal(emblemUV('mendeleev'), [-0.2, 0.62, 0.5], [-Math.PI / 2 + 0.6, 0, 0], 0.14, 0.14, true);
  },
  einstein(b, C, ext, D) {
    for (const s of [1, -1]) b.decal(cellUV(1, 0, 4, 1), [s * D.podOut, 0.33, -0.15], [0, s * Math.PI / 2, 0], 0.54, 0.135);
    // átomo no painel
    b.decal(emblemUV('einstein'), [-0.2, 0.62, 0.5], [-Math.PI / 2 + 0.6, 0, 0], 0.14, 0.14, true);
  },
  galileu(b, C, ext, D) {
    // luneta dourada inclinada para o céu
    const GOLD = 0xe0a526, GOLD2 = 0xb8801a, LEATHER = 0x7a3f22;
    const a = [-0.44, 0.64, -0.7], t = [-0.44, 1.12, 0.1];
    const P = (k) => [a[0] + (t[0] - a[0]) * k, a[1] + (t[1] - a[1]) * k, a[2] + (t[2] - a[2]) * k];
    b.cyl(LEATHER, P(0), P(1), 0.05, 0.072);
    b.cyl(GOLD, P(-0.05), P(0.07), 0.04, 0.056);
    for (const k of [0.3, 0.62, 0.97]) b.cyl(GOLD, P(k - 0.035), P(k + 0.035), 0.067 + k * 0.02, 0.07 + k * 0.022);
    b.cyl(GOLD2, P(0.99), P(1.03), 0.085, 0.085);
    b.ell(0x9fd3ff, P(1.03), [0.07, 0.07, 0.07], null, { ol: 0 });
    // suporte (forquilha)
    b.cyl(DARK, [-0.44, 0.47, -0.3], [-0.44, 0.86, -0.3], 0.03, 0.025);
    b.ell(GOLD2, [-0.44, 0.88, -0.3], 0.05);
    emblemSides(b, D, emblemUV('galileu'));
  },
  darwin(b, C, ext, D) {
    // galhinho-poleiro e corpo do tentilhão (a cabeça é separada)
    const TW = 0x6b4a2b;
    b.cyl(TW, [0.33, 0.48, -0.66], [0.34, 0.7, -0.66], 0.024, 0.02, 6);
    b.cyl(TW, [0.22, 0.7, -0.66], [0.46, 0.72, -0.64], 0.018, 0.016, 6);
    b.ell(0x3a9d4e, [0.45, 0.745, -0.64], [0.035, 0.014, 0.022], [0, 0, 0.6], { ol: 0 });
    b.setBase(0.34, 0.795, -0.66, 0, 0.9, 0, 1.3);
    b.ell(0x7a5a3c, [0, 0, 0], [0.07, 0.075, 0.095], [-0.45, 0, 0]);
    b.ell(0xd9b98a, [0, -0.02, 0.035], [0.05, 0.055, 0.055], [-0.4, 0, 0], { ol: 0 });
    for (const s of [1, -1]) b.ell(0x5a4330, [s * 0.055, 0.005, -0.015], [0.022, 0.05, 0.08], [-0.5, 0, 0], { ol: 0.006 });
    b.box(0x4a3626, [0, -0.04, -0.12], [0.06, 0.015, 0.1], 0.006, [0.6, 0, 0], { ol: 0.006 });
    for (const s of [1, -1]) b.cyl(0x8a6a4a, [s * 0.02, -0.06, 0.0], [s * 0.02, -0.075, 0.01], 0.008, 0.008, 4, { ol: 0 });
    b.setBase();
    ext.finch = { pos: [0.34 + 0.065 * Math.sin(0.9), 0.858, -0.66 + 0.065 * Math.cos(0.9)], yaw: 0.9, s: 1.3 };
    emblemSides(b, D, emblemUV('darwin'));
  },
  dumont(b, C, ext, D) {
    // asinhas em caixa (pipa de Hargrave, como no 14-bis): duas células abertas por lado,
    // com o diedro (inclinação para cima) característico do avião
    const FAB = 0xf7efd9, WOOD = 0x6b4a2b;
    for (const s of [1, -1]) {
      b.setBase(s * 0.5, 0.56, -0.16, 0, 0, s * 0.2);
      const w = 0.46, h = 0.2, d = 0.34, xm = s * w / 2;
      b.box(FAB, [xm, h, 0], [w, 0.014, d], 0, null, { ol: 0.008 });
      b.box(FAB, [xm, 0, 0], [w, 0.014, d], 0, null, { ol: 0.008 });
      for (const xx of [s * 0.015, s * w * 0.5, s * w]) b.box(FAB, [xx, h / 2, 0], [0.012, h, d], 0, null, { ol: 0.006 });
      for (const zz of [-d / 2, d / 2]) {
        for (const yy of [0, h]) b.cyl(WOOD, [0, yy, zz], [s * w, yy, zz], 0.011, 0.011, 5, { ol: 0 });
        b.cyl(WOOD, [s * w, 0, zz], [s * w, h, zz], 0.011, 0.011, 5, { ol: 0 });
      }
      b.setBase();
      b.cyl(WOOD, [s * 0.45, 0.47, -0.16], [s * 0.52, 0.57, -0.16], 0.018, 0.018, 5);
    }
    // mastro da hélice, na frente do kart (hélice puxando, lida como "para a frente")
    b.cyl(WOOD, [0, 0.5, 0.86], [0, 0.66, 1.02], 0.03, 0.025);
    emblemSides(b, D, emblemUV('dumont'));
    ext.propeller = { pos: [0, 0.66, 1.06] };
  },
  oswaldo(b, C, ext, D) {
    // microscópio preto e latão
    const BL = 0x1d1f24, BR = 0xc9a54a;
    b.setBase(0.3, 0.49, -0.66, 0, 0.5, 0, 1.3);
    b.box(BL, [0, 0.02, 0], [0.18, 0.04, 0.22], 0.015);
    b.cyl(BL, [0, 0.03, -0.07], [0, 0.2, -0.07], 0.03, 0.028);
    b.torus(BL, [0, 0.24, -0.02], [0, Math.PI / 2, 0], 0.07, 0.025, Math.PI * 1.1);
    b.box(BL, [0, 0.16, 0.03], [0.12, 0.02, 0.1], 0.008);
    b.cyl(BL, [0, 0.21, 0.05], [0, 0.4, 0.0], 0.035, 0.035);
    b.cyl(BR, [0, 0.36, 0.01], [0, 0.39, 0.003], 0.04, 0.04, 0, { ol: 0 });
    b.cyl(BL, [0, 0.4, 0.0], [0, 0.46, -0.012], 0.024, 0.026);
    b.cyl(BR, [0, 0.2, 0.05], [0, 0.17, 0.055], 0.02, 0.014, 0, { ol: 0 });
    b.ell(BR, [0.05, 0.25, -0.05], 0.022, null, { ol: 0.005 });
    b.setBase();
    emblemSides(b, D, emblemUV('oswaldo'));
  },
  samuel(b, C, ext, D) {
    // cubo mágico no painel: corpo preto e adesivos 3 x 3 (atlas) nas 5 faces visíveis
    const c = 0.13, h = c / 2 + 0.0015, sz = c * 0.95;
    b.setBase(0.2, 0.668, 0.44, 0.25, 0.42, 0);
    b.box(0x121214, [0, 0, 0], [c, c, c], 0.014);
    b.decal(cubeUV(0), [0, h, 0], [-Math.PI / 2, 0, 0], sz);
    b.decal(cubeUV(1), [0, 0, h], null, sz);
    b.decal(cubeUV(2), [h, 0, 0], [0, Math.PI / 2, 0], sz);
    b.decal(cubeUV(3), [-h, 0, 0], [0, -Math.PI / 2, 0], sz);
    b.decal(cubeUV(2), [0, 0, -h], [0, Math.PI, 0], sz);
    b.setBase();
    // placa QUANTA na traseira e o alvo da Quanta nas laterais
    b.decal(pxUV(5 * CELL, 7 * CELL + 32, 2 * CELL, 64), [0, 0.35, -0.853], [0, Math.PI, 0], 0.3, 0.075);
    emblemSides(b, D, emblemUV('samuel'));
  },
  lattes(b, C, ext, D) {
    // chapa fotográfica de emulsão numa haste, inclinada para o céu (como no monte Chacaltaya)
    const x = -Math.min(0.32, D.rearW / 2 - 0.08), z = -0.76;
    b.cyl(METAL, [x, 0.48, z + 0.02], [x, 0.66, z - 0.04], 0.02, 0.017);
    b.setBase(x, 0.74, z - 0.03, 0.85, Math.PI, 0);
    b.box(0xaebcc4, [0, 0, 0], [0.3, 0.2, 0.018], 0.008);
    b.decal(cellUV(0, 7, 2, 1), [0, 0, 0.0095], null, 0.28, 0.14);
    b.box(METAL, [0, -0.1, 0], [0.1, 0.035, 0.04], 0.01);
    b.setBase();
    emblemSides(b, D, emblemUV('lattes'));
  },
  franklin(b, C, ext, D) {
    // base do modelo de dupla hélice (a hélice gira: malha separada)
    const x = Math.min(0.3, D.rearW / 2 - 0.08), z = -0.68;
    b.cyl(0x2f2a3a, [x, 0.48, z], [x, 0.53, z], 0.085, 0.075);
    ext.dna = { pos: [x, 0.53, z] };
    emblemSides(b, D, emblemUV('franklin'));
  },
  johnson(b, C, ext, D) {
    // quadro-negro num cavalete, virado para trás (a câmera de perseguição vê a órbita)
    const x = Math.min(0.3, D.rearW / 2 - 0.1), z = -0.74, WOOD = 0x8a5a2b;
    for (const s of [1, -1]) b.cyl(WOOD, [x + s * 0.15, 0.48, z + 0.03], [x + s * 0.14, 0.72, z - 0.01], 0.016, 0.014);
    b.setBase(x, 0.8, z - 0.02, -0.15, Math.PI, 0);
    b.box(WOOD, [0, 0, 0], [0.4, 0.22, 0.026], 0.012);
    b.decal(cellUV(2, 7, 2, 1), [0, 0, 0.0135], null, 0.36, 0.18);
    b.decal(cellUV(2, 7, 2, 1), [0, 0, -0.0135], [0, Math.PI, 0], 0.36, 0.18);
    b.box(WOOD, [0, -0.12, 0.022], [0.3, 0.018, 0.04], 0.006);
    b.box(0xf4f1e8, [0.06, -0.105, 0.03], [0.05, 0.012, 0.012], 0.005, null, { ol: 0.003 });
    b.setBase();
    emblemSides(b, D, emblemUV('johnson'));
  },
  enedina(b, C, ext, D) {
    // rolo de planta azul amarrado no pontão esquerdo
    const x = D.podX, y = 0.555, z0 = -0.34, z1 = 0.14;
    b.cyl(0xffffff, [x, y, z0], [x, y, z1], 0.045, 0.045, 0, { uv: cellUV(4, 7), open: true });
    for (const [zz, dz] of [[z0, -1], [z1, 1]]) {
      b.cyl(0xdbe8f7, [x, y, zz - 0.002 * dz], [x, y, zz + 0.002 * dz], 0.044, 0.044, 0, { ol: 0 });
      b.cyl(0x1f5fae, [x, y, zz], [x, y, zz + 0.004 * dz], 0.024, 0.024, 8, { ol: 0 });
      b.cyl(0xdbe8f7, [x, y, zz], [x, y, zz + 0.006 * dz], 0.012, 0.012, 6, { ol: 0 });
    }
    for (const zz of [z0 + 0.1, z1 - 0.1]) b.cyl(0x3a2a22, [x, y, zz - 0.012], [x, y, zz + 0.012], 0.051, 0.051, 10, { ol: 0.004, open: true });
    // turbina Pelton na traseira: suporte, cano com o bocal do jato; a roda gira (malha separada)
    const tx = -Math.min(0.3, D.rearW / 2 - 0.12), ty = 0.86, tz = -0.74;
    b.cyl(METAL, [tx, 0.48, tz + 0.06], [tx, ty, tz + 0.06], 0.022, 0.02);
    b.ell(METAL, [tx, ty, tz + 0.06], [0.03, 0.03, 0.02]);
    b.cyl(0x2f80d1, [tx + 0.19, 0.48, tz], [tx + 0.19, 0.68, tz], 0.024, 0.022);
    b.cyl(0x2f80d1, [tx + 0.19, 0.68, tz], [tx + 0.07, 0.71, tz], 0.022, 0.014);
    ext.turbine = { pos: [tx, ty, tz] };
    emblemSides(b, D, emblemUV('enedina'));
  },
};
function emblemSides(b, D, uv) {
  for (const s of [1, -1]) b.decal(uv, [s * D.podOut, 0.33, -0.24 + D.wheelShift], [0, s * Math.PI / 2, 0], 0.2, 0.2, true);
}

// Propeller (hélice do 14-bis), cabeça do tentilhão e frasco de rádio: malhas separadas.
function propellerGeo(detail) {
  const b = new Builder({ detail, ol: 0.008 });
  for (const s of [1, -1]) {
    b.ell(0xa0703f, [0, s * 0.19, 0], [0.05, 0.19, 0.014], [0, 0.35 * s, 0]);
    b.ell(0x6b4a2b, [0, s * 0.33, 0], [0.04, 0.05, 0.016], [0, 0.35 * s, 0], { ol: 0 });
  }
  b.ell(0x3a3a40, [0, 0, 0.015], [0.045, 0.045, 0.04]);
  return b.build();
}
function finchHeadGeo(detail) {
  const b = new Builder({ detail, ol: 0.006 });
  b.ell(0x3e2f24, [0, 0.035, 0.02], 0.052);
  b.cone(0xe0bf7a, [0, 0.03, 0.055], [0, 0.02, 0.12], 0.028, 6);
  for (const s of [1, -1]) {
    b.ell(0x111111, [s * 0.036, 0.05, 0.045], 0.012, null, { ol: 0, seg: [6, 4] });
    b.ell(0xffffff, [s * 0.043, 0.056, 0.05], 0.004, null, { ol: 0, seg: [4, 3] });
  }
  return b.build();
}
// Hélice (curva) em volta de Y, de y = 0 a H, com `turns` voltas a partir da fase ph
class HelixCurve extends THREE.Curve {
  constructor(R, H, turns, ph) { super(); this.R = R; this.H = H; this.turns = turns; this.ph = ph; }
  getPoint(t, out = new THREE.Vector3()) {
    const a = this.ph + t * this.turns * TAU;
    return out.set(Math.cos(a) * this.R, t * this.H, Math.sin(a) * this.R);
  }
}
const helixG = (R, H, turns, ph, tube, seg, rs) => G(`h${R}.${H}.${turns}.${ph}.${tube}.${seg}.${rs}`, () => new THREE.TubeGeometry(new HelixCurve(R, H, turns, ph), seg, tube, rs, false));
// Modelo de dupla hélice do DNA (gira em torno de Y; origem na base)
function dnaGeo(detail) {
  const b = new Builder({ detail, ol: 0.008, olMin: detail === 0 ? 0.05 : 0 });
  const R = 0.085, H = 0.46, turns = 1.25, y0 = 0.04;
  const seg = b.lv(40, 24, 16, 12), rs = b.lv(6, 4, 4, 3);
  [0x4cc9f0, 0xffd166].forEach((col, k) => {
    b.add(helixG(R, H, turns, k * Math.PI, 0.017, seg, rs), col, [0, y0, 0], null, 1, { ol: 0 });
    b.hull(helixG(R, H, turns, k * Math.PI, 0.025, seg, rs), col, [0, y0, 0]);
  });
  // pares de bases: degraus em duas cores (A-T e C-G)
  const PAIRS = [[0xef476f, 0x06d6a0], [0x118ab2, 0xff9f1c], [0x06d6a0, 0xef476f], [0xff9f1c, 0x118ab2]];
  const n = b.lv(10, 8, 6, 5);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, a = t * turns * TAU, y = y0 + t * H;
    const p = [Math.cos(a) * R, y, Math.sin(a) * R], q = [-p[0], y, -p[2]], m = [0, y, 0];
    const [c1, c2] = PAIRS[i % 4];
    b.cyl(c1, p, m, 0.012, 0.012, 6, { ol: 0.004, open: true });
    b.cyl(c2, m, q, 0.012, 0.012, 6, { ol: 0.004, open: true });
  }
  b.cyl(0xb8bec6, [0, 0, 0], [0, y0 + H + 0.03, 0], 0.008, 0.008, 6, { ol: 0 });
  b.ell(0xb8bec6, [0, y0 + H + 0.035, 0], 0.016, null, { ol: 0.004 });
  return b.build();
}
// Roda Pelton (turbina de usina): gira em torno de Z; conchas duplas no aro
function turbineGeo(detail, C) {
  const b = new Builder({ detail, ol: 0.008, olMin: detail === 0 ? 0.05 : 0 });
  const ST = 0xc3ccd4, ST2 = 0x6f7a86;
  b.cyl(ST2, [0, 0, -0.016], [0, 0, 0.016], 0.1, 0.1);
  b.cyl(0xd4a24c, [0, 0, -0.04], [0, 0, 0.04], 0.033, 0.033);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    b.box(C.colors.kartAccent, [Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.018], [0.07, 0.022, 0.006], 0.004, [0, 0, a], { ol: 0 });
  }
  const n = b.lv(12, 10, 8, 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, c = Math.cos(a), s = Math.sin(a);
    b.ell(ST, [c * 0.122, s * 0.122, 0], [0.024, 0.034, 0.036], [0, 0, a], { ol: 0.006 });
    if (detail > 0) b.ell(0x39414a, [c * 0.128 - s * 0.012, s * 0.128 + c * 0.012, 0], [0.01, 0.02, 0.026], [0, 0, a], { ol: 0 });
  }
  return b.build();
}
// Acessórios que giram (malhas separadas): geometria, eixo local e velocidade (rad/s pela velocidade do kart)
const SPINNERS = {
  dna: { geo: (detail) => dnaGeo(detail), axis: 'y', rate: (v) => 1.4 + v * 0.1 },
  turbine: { geo: (detail, C) => turbineGeo(detail, C), axis: 'z', rate: (v) => 3 + v * 1.1 },
};

// Valores padrão de aparência (cientista novo sem tudo preenchido em config.js)
const DEFAULT_LOOK = { skin: 0xe8b98f, hair: 0x3a2a20, outfit: 0x2d3142, outfitAccent: 0xffffff };
const DEFAULT_COLORS = { kart: 0x8d99ae, kartAccent: 0xffffff };
const DEFAULT_STATS = { speed: 3, accel: 3, handling: 3, weight: 3 };

function vialGeo(detail) {
  // Erlenmeyer: brilho verde (material básico, sem sombreamento)
  const pts = [[0, 0], [0.11, 0], [0.12, 0.02], [0.115, 0.05], [0.05, 0.22], [0.038, 0.25], [0.038, 0.36], [0, 0.36]];
  return latheG('vial', pts, detail > 0 ? 16 : 10);
}

// ---------------------------------------------------------------------------
// Construção (com cache de geometria por personagem e nível de detalhe)
// ---------------------------------------------------------------------------
function buildParts(id, detail) {
  const key = `${id}:${detail}`;
  const sh = shared();
  if (sh.models.has(key)) return sh.models.get(key);
  // cópia com valores padrão: um cientista sem `look`/`colors` completos não quebra o modelo
  const C0 = CHARACTER_BY_ID[id] || CHARACTERS[0];
  const C = {
    ...C0, stats: { ...DEFAULT_STATS, ...C0.stats }, colors: { ...DEFAULT_COLORS, ...C0.colors }, look: { ...DEFAULT_LOOK, ...C0.look },
  };
  const L = C.look;
  const num = CHARACTERS.indexOf(C0) + 1;
  const outline = true;
  const ext = {};
  const D = kartDims(C);
  // corpo do kart + pernas + acessórios fixos
  const lo = detail === 0;
  const body = new Builder({ detail, outline, ol: 0.014, olMin: lo ? 0.1 : 0.03 });
  kartBody(body, C, num, D);
  legs(body, C.id);
  KART_EXTRAS[C.id]?.(body, C, ext, D);
  // tronco
  // baixa: só as peças grandes ganham contorno (menos triângulos)
  const torso = new Builder({ detail, outline, ol: 0.012, olMin: lo ? 0.08 : 0 });
  (TORSOS[C.id] || torsoBase)(torso, L, C);
  // cabeça (origem no pescoço; centro da cabeça em (0, 0.3, 0.03))
  const head = new Builder({ detail, outline, ol: 0.012, olMin: lo ? 0.08 : 0 });
  head.setBase(0, 0.3, 0.03);
  head.ell(L.skin, [0, 0, 0], [HR, HR * 0.97, HR * 0.98], null, { seg: byDetail(detail, [22, 16], [14, 10]) });
  (HEADS[C.id] || genericHead)(head, L, rng(num * 7919));
  const parts = {
    body: body.build(),
    torso: torso.build(),
    head: head.build(),
    arm: armGeo(L, C.id, detail),
    wheel: wheelGeo(C, detail),
    steer: steeringGeo(C, L, detail),
    ext,
    dims: D,
    extGeo: {
      propeller: ext.propeller ? propellerGeo(detail) : null,
      finch: ext.finch ? finchHeadGeo(detail) : null,
      vial: ext.vial ? vialGeo(detail) : null,
      // acessórios giratórios presentes neste kart: { chave: geometria }
      spin: Object.fromEntries(Object.keys(SPINNERS).filter((k) => ext[k]).map((k) => [k, SPINNERS[k].geo(detail, C)])),
    },
  };
  sh.models.set(key, parts);
  return parts;
}

const _hand = new THREE.Vector3(), _dir = new THREE.Vector3();
const _mInv = new THREE.Matrix4(), _mS = new THREE.Matrix4(), _wq = new THREE.Quaternion();
const _wp = new THREE.Vector3(), _ws = new THREE.Vector3(), _wm = new THREE.Matrix4();
const _qY = new THREE.Quaternion(), _qX = new THREE.Quaternion(), _qFlip = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// Junta as peças (só a faixa sem contornos) numa geometria só, com as matrizes dadas.
function mergeSolid(items) {
  const P = [], N = [], C = [], U = [], I = [];
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const { geo, m } of items) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, col = geo.attributes.color, uv = geo.attributes.uv;
    const idx = geo.index;
    const n = geo.userData.solidCount ?? idx.count;
    nm.getNormalMatrix(m);
    const flip = m.determinant() < 0;
    const remap = new Map();
    const vid = (i) => {
      let j = remap.get(i);
      if (j === undefined) {
        j = P.length / 3;
        remap.set(i, j);
        v.fromBufferAttribute(pos, i).applyMatrix4(m); P.push(v.x, v.y, v.z);
        v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N.push(v.x, v.y, v.z);
        C.push(col.getX(i), col.getY(i), col.getZ(i));
        U.push(uv.getX(i), uv.getY(i));
      }
      return j;
    };
    for (let k = 0; k < n; k += 3) {
      const a = vid(idx.getX(k)), b = vid(idx.getX(k + 1)), c = vid(idx.getX(k + 2));
      if (flip) I.push(a, c, b);
      else I.push(a, b, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
  g.computeBoundingSphere();
  return g;
}

// Níveis de detalhe (THREE.LOD) por qualidade: [distância (m), nível do Builder].
// Além do 1º nível, o kart é uma malha só (1 draw call), estática e sem contornos.
// O kart do jogador (câmera de perseguição a ~6 m) nunca troca de nível.
// baixa: detalhado até 8 m, ~4 mil triângulos até 14 m e ~2 mil além disso.
// alta: detalhado até 25 m (a essa distância o contorno tem menos de 1 px), depois a
// versão de 'baixa' mesclada e, bem longe, a mais simples.
const LOD_LEVELS = {
  baixa: [[8, -1], [14, -2]],
  alta: [[25, 0], [50, -2]],
};

export function createKartModel(characterId, { quality } = {}) {
  const low = !!(quality && quality.id === 'baixa');
  const detail = low ? 0 : 1;
  const shadows = !!(quality && quality.shadows);
  const parts = buildParts(characterId, detail);
  const D = parts.dims;
  const sh = shared();
  // baixa: Lambert (mesmo programa de shader do cenário, que também usa cor por vértice + textura)
  const mat = low ? sh.matLo : sh.mat;
  const matInst = low ? sh.matLoInst : sh.matInst;
  const root = new THREE.Group();
  root.name = `kart-${characterId}`;
  const group = new THREE.Group(); // versão detalhada (animada)
  // chassi e piloto sobem/descem com o tamanho das rodas; as rodas ficam no chão
  const chassis = new THREE.Group();
  chassis.position.y = D.lift;
  group.add(chassis);

  // Sombra sem os contornos: no passe de sombra desenha só a faixa das peças (drawRange);
  // o passe normal volta a desenhar tudo.
  const solidShadow = (m) => {
    const g = m.geometry, n = g.userData.solidCount;
    if (!m.castShadow || n === undefined || !g.index || n >= g.index.count) return;
    m.onBeforeShadow = () => { g.drawRange.count = n; };
    m.onBeforeRender = () => { g.drawRange.count = Infinity; };
  };
  const mk = (geo, parent, cast) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadows && cast;
    solidShadow(m);
    parent.add(m);
    return m;
  };
  const bodyMesh = mk(parts.body, chassis, true);

  // rodas (1 draw call)
  const wheels = new THREE.InstancedMesh(parts.wheel, matInst, 4);
  wheels.castShadow = shadows;
  solidShadow(wheels);
  wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(wheels);

  // volante
  const steerTilt = new THREE.Group();
  steerTilt.position.copy(SW_POS);
  steerTilt.rotation.x = SW_TILT;
  chassis.add(steerTilt);
  const steerMesh = mk(parts.steer, steerTilt, false);

  // piloto: inclinação (quadril) > tronco, braços, cabeça
  const lean = new THREE.Group();
  lean.position.copy(LEAN_POS);
  chassis.add(lean);
  const torsoMesh = mk(parts.torso, lean, true);
  const neck = new THREE.Group();
  neck.position.copy(NECK_POS);
  lean.add(neck);
  const headMesh = mk(parts.head, neck, true);
  const arms = [1, -1].map((s) => {
    const a = mk(parts.arm, lean, false);
    a.position.set(s * SHOULDER, 0.46, 0.0);
    a.userData.side = s;
    return a;
  });

  // acessórios animados
  let propeller = null, finch = null, vial = null, glow = null, vialMat = null;
  if (parts.extGeo.propeller) {
    propeller = mk(parts.extGeo.propeller, chassis, true);
    propeller.position.fromArray(parts.ext.propeller.pos);
  }
  if (parts.extGeo.finch) {
    finch = mk(parts.extGeo.finch, chassis, false);
    finch.position.fromArray(parts.ext.finch.pos);
    finch.rotation.y = parts.ext.finch.yaw;
    finch.scale.setScalar(parts.ext.finch.s || 1);
  }
  // modelo de DNA, turbina...: giram em torno de um eixo local
  const spinners = Object.entries(parts.extGeo.spin || {}).map(([k, geo]) => {
    const m = mk(geo, chassis, true);
    m.position.fromArray(parts.ext[k].pos);
    return { k, m, a: 0, axis: SPINNERS[k].axis, rate: SPINNERS[k].rate };
  });
  if (parts.extGeo.vial) {
    vialMat = new THREE.MeshBasicMaterial({ color: 0x7dff5a });
    vial = new THREE.Mesh(parts.extGeo.vial, vialMat);
    vial.position.fromArray(parts.ext.vial.pos);
    vial.position.y += D.lift;
    root.add(vial); // frasco e brilho ficam visíveis também na versão distante
    glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sh.glow, color: 0x66ff44, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
    glow.position.set(vial.position.x, vial.position.y + 0.1, vial.position.z);
    glow.scale.setScalar(0.7);
    root.add(glow);
  }

  // estado da animação
  let t = 0, spinF = 0, spinR = 0, steerV = 0, leanZ = 0, leanX = 0, headY = 0, bob = 0, peck = 0, propA = 0;

  function placeWheels() {
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const s = i % 2 === 0 ? 1 : -1;
      const r = front ? D.rf : D.rr;
      _wp.set(s * D.wx, r, front ? ZF : ZR);
      _qY.setFromAxisAngle(Y_AXIS, front ? -steerV * 0.42 : 0);
      _qX.setFromAxisAngle(X_AXIS, front ? spinF : spinR);
      _wq.multiplyQuaternions(_qY, _qX);
      if (s < 0) _wq.multiply(_qFlip);
      _ws.set(r, r, r);
      _wm.compose(_wp, _wq, _ws);
      wheels.setMatrixAt(i, _wm);
    }
    wheels.instanceMatrix.needsUpdate = true;
  }

  function aimArms() {
    steerTilt.updateMatrix();
    steerMesh.updateMatrix();
    lean.updateMatrix();
    _mS.multiplyMatrices(steerTilt.matrix, steerMesh.matrix);
    _mInv.copy(lean.matrix).invert();
    for (const a of arms) {
      const s = a.userData.side;
      _hand.set(s * Math.sin(HAND_A) * SW_R, Math.cos(HAND_A) * SW_R, -0.03).applyMatrix4(_mS).applyMatrix4(_mInv);
      _dir.subVectors(_hand, a.position);
      const len = _dir.length();
      _dir.divideScalar(len || 1);
      a.quaternion.setFromUnitVectors(Z_AXIS, _dir);
      a.scale.set(1, 1, len / ARM_LEN);
    }
  }

  placeWheels();
  aimArms();

  // Versões distantes: peças do nível dado sem contornos, na pose de repouso, mescladas
  // numa malha só (cache por personagem e nível)
  const merged = (lv) => {
    const key = `${characterId}:m${lv}`;
    let geo = sh.models.get(key);
    if (geo) return geo;
    const lp = buildParts(characterId, lv);
    group.updateMatrixWorld(true);
    const at = (m) => m.matrixWorld.clone();
    const items = [
      { geo: lp.body, m: at(bodyMesh) }, { geo: lp.torso, m: at(torsoMesh) }, { geo: lp.head, m: at(headMesh) },
      { geo: lp.steer, m: at(steerMesh) },
      ...arms.map((a) => ({ geo: lp.arm, m: at(a) })),
    ];
    for (let i = 0; i < 4; i++) {
      wheels.getMatrixAt(i, _wm);
      items.push({ geo: lp.wheel, m: _wm.clone().premultiply(wheels.matrixWorld) });
    }
    if (propeller && lp.extGeo.propeller) items.push({ geo: lp.extGeo.propeller, m: at(propeller) });
    if (finch && lp.extGeo.finch) items.push({ geo: lp.extGeo.finch, m: at(finch) });
    for (const sp of spinners) if (lp.extGeo.spin?.[sp.k]) items.push({ geo: lp.extGeo.spin[sp.k], m: at(sp.m) });
    geo = mergeSolid(items);
    sh.models.set(key, geo);
    return geo;
  };
  const lod = new THREE.LOD();
  lod.addLevel(group, 0);
  const lodMeshes = [];
  for (const [dist, lv] of LOD_LEVELS[low ? 'baixa' : 'alta']) {
    const m = new THREE.Mesh(merged(lv), mat);
    m.castShadow = shadows;
    lodMeshes.push(m);
    lod.addLevel(m, dist, 0.1); // histerese: volta ao nível anterior só 10% mais perto
  }
  root.add(lod);

  function update(dt, st = {}) {
    dt = Math.min(dt || 0, 0.1);
    t += dt;
    const time = st.time ?? t;
    const speed = st.speed || 0;
    const aspd = Math.abs(speed);
    const steer = Math.max(-1, Math.min(1, st.steer || 0));
    const dd = st.drifting ? st.driftDir || 0 : 0;
    const stunned = !!st.stunned;
    // rodas
    spinF += (speed / D.rf) * dt;
    spinR += (speed / D.rr) * dt;
    if (spinF > TAU * 100 || spinF < -TAU * 100) spinF %= TAU;
    if (spinR > TAU * 100 || spinR < -TAU * 100) spinR %= TAU;
    steerV = damp(steerV, steer, 14, dt);
    const near = group.visible; // longe: a versão simplificada não anima rodas/braços
    if (near) placeWheels();
    steerMesh.rotation.z = steerV * 0.85;
    // corpo do piloto: inclina na curva, recua no turbo, balança
    leanZ = damp(leanZ, steer * 0.1 + dd * 0.12, 8, dt);
    leanX = damp(leanX, st.boosting ? -0.1 : aspd > 1 ? 0.03 : 0, 6, dt);
    const g = st.onGround === false ? 0 : 1;
    bob = Math.sin(time * 17) * 0.008 * Math.min(1, aspd / 12) * g;
    lean.rotation.set(leanX, 0, leanZ);
    lean.position.y = LEAN_POS.y + bob;
    // cabeça olha para dentro do drift; atordoado: balança
    headY = damp(headY, -(steer * 0.22 + dd * 0.38), 6, dt);
    if (stunned) {
      neck.rotation.set(Math.sin(time * 9) * 0.12, headY + Math.sin(time * 13) * 0.35, Math.sin(time * 11) * 0.22);
    } else {
      neck.rotation.set(-leanX * 0.5 + Math.sin(time * 2.1) * 0.02, headY, -leanZ * 0.4);
    }
    if (near) aimArms();
    // acessórios
    if (propeller) {
      propA += (5 + aspd * 1.6) * dt;
      propeller.rotation.z = propA % TAU;
    }
    for (const sp of spinners) {
      sp.a = (sp.a + sp.rate(aspd) * dt) % TAU;
      sp.m.rotation[sp.axis] = sp.a;
    }
    if (finch) {
      peck = (peck + dt) % 2.4;
      const p = peck < 0.5 ? Math.sin((peck / 0.5) * Math.PI * 2) * 0.35 : 0;
      finch.rotation.set(p + Math.sin(time * 3) * 0.05, parts.ext.finch.yaw + Math.sin(time * 0.9) * 0.4, 0);
      finch.position.y = parts.ext.finch.pos[1] + Math.abs(Math.sin(time * 8)) * 0.01 * Math.min(1, aspd / 10);
    }
    if (vial) {
      const k = 0.75 + 0.25 * Math.sin(time * 4.2) + (st.boosting ? 0.2 : 0);
      vialMat.color.setRGB(0.3 * k + 0.1, 1.0 * k, 0.22 * k);
      glow.scale.setScalar(0.55 + 0.25 * k);
      glow.material.opacity = 0.55 + 0.35 * k;
    }
  }

  const tri = (g) => (g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0);
  const stats = {
    body: tri(parts.body), torso: tri(parts.torso), head: tri(parts.head), arms: 2 * tri(parts.arm),
    wheels: 4 * tri(parts.wheel), steer: tri(parts.steer),
    extras: tri(parts.extGeo.propeller) + tri(parts.extGeo.finch) + tri(parts.extGeo.vial) + (glow ? 2 : 0) +
      Object.values(parts.extGeo.spin || {}).reduce((a, g) => a + tri(g), 0),
  };
  stats.total = Object.values(stats).reduce((a, b) => a + b, 0);
  // Pontos úteis para efeitos: pontas dos escapamentos (local) e o grupo da cabeça
  const anchors = {
    exhausts: [new THREE.Vector3(0.3, 0.45 + D.lift, D.exhaustTip), new THREE.Vector3(-0.3, 0.45 + D.lift, D.exhaustTip)],
    head: neck,
  };
  // Geometrias/atlas são compartilhados (cache); só os materiais próprios são liberados
  const dispose = () => {
    if (vialMat) vialMat.dispose();
    if (glow) glow.material.dispose();
    wheels.dispose();
  };
  // Kart em destaque (o do jogador): as trocas de nível ficam 2x mais longe, para a câmera de
  // apresentação da largada (~10 m) não mostrar a versão estática. Sem custo por quadro.
  const baseDist = lod.levels.map((l) => l.distance);
  const setHero = (on = true) => {
    lod.levels.forEach((l, i) => (l.distance = baseDist[i] * (on ? 2 : 1)));
  };
  return { group: root, update, stats, anchors, dispose, setHero };
}

// ---------------------------------------------------------------------------
// Retratos (busto 3/4) renderizados fora da tela: { id: dataURL }
// ---------------------------------------------------------------------------
const _portraitCache = new Map();
// ss: supersampling (1 em 'baixa'). Todos os bustos vão para um só alvo (grade 4 x 2) e uma
// só leitura de pixels; depois cada célula é recortada no seu canvas.
export function renderPortraits(renderer, size = 256, { ss = 2 } = {}) {
  const ckey = `${size}:${ss}`;
  if (_portraitCache.has(ckey)) return _portraitCache.get(ckey);
  const sh = shared();
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7a8398, 1.05));
  const key = new THREE.DirectionalLight(0xfff6ea, 2.0);
  key.position.set(2.5, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdde8ff, 1.3);
  rim.position.set(-3, 2, -3);
  scene.add(rim);
  const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
  const cs = size * ss; // lado de cada célula
  const cols = 4, rows = Math.ceil(CHARACTERS.length / cols);
  const W = cols * cs, H = rows * cs;
  const rt = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace, depthBuffer: true });
  const buf = new Uint8Array(W * H * 4);
  const big = document.createElement('canvas');
  big.width = W; big.height = H;
  const bctx = big.getContext('2d');
  const img = bctx.createImageData(W, H);
  const out = {};

  // estado anterior do renderer
  const prevRT = renderer.getRenderTarget();
  const prevColor = new THREE.Color();
  renderer.getClearColor(prevColor);
  const prevAlpha = renderer.getClearAlpha();
  const prevVP = new THREE.Vector4();
  renderer.getViewport(prevVP);
  const prevAuto = renderer.autoClear;
  const prevShadow = renderer.shadowMap.enabled;
  // material só dos retratos (luzes próprias = outro programa): descartado no fim, o que
  // libera o programa em vez de deixá-lo guardado a corrida inteira
  const pmat = sh.mat.clone();

  try {
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    rt.scissorTest = false;
    renderer.setRenderTarget(rt);
    renderer.clear();
    CHARACTERS.forEach((C, i) => {
      const parts = buildParts(C.id, 1);
      parts.torso.drawRange.count = parts.head.drawRange.count = Infinity;
      const bust = new THREE.Group();
      const torso = new THREE.Mesh(parts.torso, pmat);
      bust.add(torso);
      const neck = new THREE.Group();
      neck.position.copy(NECK_POS);
      neck.rotation.set(0.04, 0.12, 0);
      bust.add(neck);
      neck.add(new THREE.Mesh(parts.head, pmat));
      scene.add(bust);
      // enquadramento: centro um pouco abaixo da cabeça, vista 3/4 de frente
      bust.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(neck);
      const top = Math.min(box.max.y, 1.5) + 0.03;
      const bottom = 0.4;
      const cy = (top + bottom) / 2;
      const h = top - bottom;
      const halfW = Math.max(box.max.x, -box.min.x, 0.36);
      const extent = Math.max(h / 2, halfW * 0.98);
      const dist = extent / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) + 0.25;
      const yaw = 0.5;
      cam.position.set(Math.sin(yaw) * dist, cy + 0.12, Math.cos(yaw) * dist + 0.03);
      cam.lookAt(0, cy, 0.03);
      // célula i: coluna i % cols, linha i / cols (linha 0 no alto da imagem; o GL conta de baixo)
      const x = (i % cols) * cs, y = (rows - 1 - Math.floor(i / cols)) * cs;
      rt.viewport.set(x, y, cs, cs);
      rt.scissor.set(x, y, cs, cs);
      rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      scene.remove(bust);
    });
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    // inverte verticalmente (WebGL lê de baixo para cima)
    const row = W * 4;
    for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    bctx.putImageData(img, 0, 0);
    CHARACTERS.forEach((C, i) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const c2 = cv.getContext('2d');
      c2.imageSmoothingEnabled = true;
      c2.imageSmoothingQuality = 'high';
      c2.drawImage(big, (i % cols) * cs, Math.floor(i / cols) * cs, cs, cs, 0, 0, size, size);
      out[C.id] = cv.toDataURL('image/png');
    });
  } finally {
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.setViewport(prevVP);
    renderer.autoClear = prevAuto;
    renderer.shadowMap.enabled = prevShadow;
    rt.dispose();
    pmat.dispose();
  }
  _portraitCache.set(ckey, out);
  return out;
}
