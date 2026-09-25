// Corrida Quanta — criaturas malucas de cada fase: unicórnios, meteoros, baleias, OVNIs...
// Sprites de pixel art + partículas quadradinhas (2 draw calls para todas as partículas).
(() => {
  'use strict';
  window.QC = window.QC || {};
  const QC = window.QC;

  const TYPES = ['unicorn', 'meteor', 'shooting-star', 'whale', 'fish', 'bubble', 'dragon', 'ember',
    'ufo', 'rocket', 'donut', 'balloon', 'snowflake', 'bird', 'duck', 'comet'];

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const coin = () => (Math.random() < 0.5 ? -1 : 1);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const backOut = (k) => { const u = k - 1; return 1 + 2.7 * u * u * u + 1.7 * u * u; };
  const smooth = (k) => k * k * (3 - 2 * k);

  // limites (desempenho em celular)
  const MAX_ACTIVE = 12;       // criaturas simultâneas (bando/cardume conta como 1)
  const CELE_EXTRA = 4;        // folga extra durante a comemoração
  const CAP_NORM = 1400;       // partículas normais
  const CAP_GLOW = 1100;       // partículas brilhantes (aditivas)
  const POOL_KEEP = 3;         // instâncias guardadas por tipo para reuso

  // ================= Pixel art =================
  const PAL = {
    k: '#1c0f2e', w: '#ffffff', W: '#cfdcff', g: '#9aa3c2', G: '#5b6386',
    p: '#ff8fd0', P: '#a45cff', m: '#ff4fa3', y: '#ffd23f', Y: '#fff6b0',
    o: '#ff9f1c', r: '#ff4d5e', R: '#a3122a', b: '#5aa0ff', B: '#2456c9',
    c: '#8ff3ff', C: '#2bb8d9', e: '#1fd685', E: '#0f7a4c', l: '#7dffc0',
    n: '#b07a4a', N: '#5a3a22', a: '#7a6a8c', A: '#43385a', h: '#b8a8cc',
  };

  const ART = {
    unicorn: [[
      '......w.............Y...',
      '.....wWw...........yy...',
      '....wWWw......Pp.wyy....',
      '....wWWww....PpPwwww....',
      '...wWWWww...PpPwwwkww...',
      '...wWWww...PpPwwwwwwww..',
      '....wWw...PpPwwwwwwwwWW.',
      '.....ww..PpPwwww..WWW...',
      'pP...wwwwPwwwwwW........',
      'PpP.wwwwwwwwwwwW........',
      '.PpPwwwwwwwwwwwW........',
      '..PwwwwwwwwwwwWW........',
      '...PWWwwwwwwWWW.........',
      '...wW.W.....wW.W........',
      '..wW...W....w...W.......',
      '..y.....y..y.....y......',
    ], [
      '....................Y...',
      '...................yy...',
      '..............Pp.wyy....',
      '.............PpPwwww....',
      '............PpPwwwkww...',
      '...........PpPwwwwwwww..',
      'ww........PpPwwwwwwwwWW.',
      'wWWww....PpPwwww..WWW...',
      '.wWWWwwwwPwwwwwW........',
      '..wWWwwwwwwwwwwW........',
      'P..wwwwwwwwwwwwW........',
      'pP.wwwwwwwwwwwWW........',
      '.pPPWWwwwwwwWWW.........',
      '..P.wWW.....wWW.........',
      '.....yW......yW.........',
      '........................',
    ]],
    meteor: [[
      '....r.......',
      '..r..oyyAAA.',
      '.r.ooyYYhaaA',
      '..ooyYYYhaaA',
      'rooyyYYYaaaA',
      '.rooyyYYaAaA',
      '..r.ooyyAAA.',
      '....r.......',
    ], [
      '......r.....',
      '.r..ooyyAAA.',
      '..ooyyYYhaaA',
      'rooyyYYYhaaA',
      '.rooyYYYaaaA',
      '..rooyYYaAaA',
      '.r..ooyyAAA.',
      '...r........',
    ]],
    whale: [[
      'BB..........................',
      'BbB.........BBBBBBBB........',
      '.BbB.....BBBbbbbbbbbBBB.....',
      '..BbB..BBbbbbbbbbbbbbbbBB...',
      '...BbBBbbbbbbbbbbbbbbbbbbB..',
      '....BbbbbbbbbbbbbbbbbbwwbbB.',
      '...BbBbbbbbbbbbbbbbbbbwkbbB.',
      '..BbB.BbbbbbbbbbbbbbbbbbbbbB',
      '.BbB..BbbbbbbbbbbbbbbbbbbbbB',
      'BBB....BbbbbbbbbbbbbbbbbkbbB',
      '.......BWWbbbbbbbbbbbbbkkWB.',
      '........BWWWWWWWWWWWWWWWWB..',
      '.........BBWcWcWcWcWcWcBB...',
      '...........BBBBBBBBBBBB.....',
    ]],
    fish: [[
      '.....oo..',
      'o..ooooko',
      'ooooYoooo',
      'o..ooooo.',
      '....oo...',
    ], [
      '.....oo..',
      '...ooooko',
      '.oooYoooo',
      'oo.ooooo.',
      'o...oo...',
    ]],
    ufo: [[
      '........cccc........',
      '......ccwwcccc......',
      '.....ccwccccccC.....',
      '...WWWWWWWWWWWWWW...',
      '.WWggggggggggggggWW.',
      'WgGyGgrGgeGgyGgrGgGW',
      '.GGggggggggggggggGG.',
      '...GGGGGGGGGGGGGG...',
      '......GGGGGGGG......',
    ], [
      '........cccc........',
      '......ccwwcccc......',
      '.....ccwccccccC.....',
      '...WWWWWWWWWWWWWW...',
      '.WWggggggggggggggWW.',
      'WgGeGgyGgrGgeGgyGgGW',
      '.GGggggggggggggggGG.',
      '...GGGGGGGGGGGGGG...',
      '......GGGGGGGG......',
    ]],
    cow: [[
      '..........g.g',
      '.........wwww',
      'wwwkkwwwwwkww',
      '.wkkkwwkkwwpp',
      '.wwkwwwkkwwpp',
      '.wwwwwwwwww..',
      '.w.w....w.w..',
      '.g.g....g.g..',
    ]],
    rocket: [[
      '...rr...',
      '..rrrr..',
      '..rwwr..',
      '.wwwwww.',
      '.wwccww.',
      '.wcCBcw.',
      '.wwccww.',
      '.wwwwww.',
      '.wwwwww.',
      '.WwwwwW.',
      '.WwrrwW.',
      'rWwwwwWr',
      'rrWWWWrr',
      'rr.GG.rr',
      '..oyyo..',
      '..yYYy..',
      '...yy...',
      '...o....',
    ], [
      '...rr...',
      '..rrrr..',
      '..rwwr..',
      '.wwwwww.',
      '.wwccww.',
      '.wcCBcw.',
      '.wwccww.',
      '.wwwwww.',
      '.wwwwww.',
      '.WwwwwW.',
      '.WwrrwW.',
      'rWwwwwWr',
      'rrWWWWrr',
      'rr.GG.rr',
      '..yYYy..',
      '.oyYYyo.',
      '..oyyo..',
      '...yo...',
    ]],
    bird: [[
      'w.......w',
      'ww.....ww',
      '.ww.w.ww.',
      '...www...',
      '....y....',
    ], [
      '.........',
      '....w....',
      '..wwwww..',
      '.ww.y.ww.',
      'w.......w',
    ]],
    duck: [[
      '.............yyyy.......',
      '...........yyyyyyyy.....',
      '..........yyyyyyyyyy....',
      '..........yyyyyyywwy....',
      '.........yyyyyyyywky....',
      '.........yyyyyyyyyyyoo..',
      '.........yyyyyyyyyyooooo',
      '.........Yyyyyyyyyyoooo.',
      '..........Yyyyyyyyrrrr..',
      'y..........Yyyyyyy......',
      'yy.......yyyyyyyyyy.....',
      'yyy....yyyyyyyyyyyyyy...',
      'yyyyyyyyyyyyyyyyyyyyyyy.',
      'yyyyyyyqqqqyyyyyyyyyyyy.',
      'Yyyyyyyyqqqqqyyyyyyyyyy.',
      '.Yyyyyyyyqqqqqyyyyyyyyy.',
      '..Yyyyyyyyyyyyyyyyyyyy..',
      '...YYyyyyyyyyyyyyyyyYY..',
      '.....YYYYYYYYYYYYYYYY...',
    ]],
  };

  // dragão: corpo fixo + asa em 3 posições (sobreposição)
  const DRAGON_BODY = [
    '............................',
    '............................',
    '...................W.W......',
    '...................DdDdd....',
    '..................DddddddD..',
    '..................DdwkdddddD',
    '.................DddddhhhhhD',
    '................DdddhD......',
    '...............Ddddh........',
    '..............Ddddhh........',
    '.DD......DDDDDdddhh.........',
    'DdDD...DDdddddddhhh.........',
    '.DddD.DdddddddddhhD.........',
    '..DddDddddddddddhD..........',
    '...DDdhhhhhhhhhhD...........',
    '......DhD....DhD............',
    '......yy.....yy.............',
    '............................',
  ];
  const DRAGON_WINGS = [{
    0: '......DD',
    1: '.....DvvD',
    2: '.....DvvvD',
    3: '......DvvvD',
    4: '......DvvvvD',
    5: '.......DvvvvD',
    6: '.......DvvvvvD',
    7: '........DvvvvvD',
    8: '.........DDvvvD',
    9: '...........DDD',
  }, {
    6: 'DDDD',
    7: '.DvvDDDD',
    8: '..DvvvvvDDDD',
    9: '...DDvvvvvvvDD',
    10: '.....DDDDvvvvD',
    11: '.........DDDD',
  }, {
    12: '...........DvvD',
    13: '..........DvvvD',
    14: '.........DvvvD',
    15: '........DvvvD',
    16: '........DvvD',
    17: '........DDD',
  }];
  const dragonFrames = () => DRAGON_WINGS.map((wing) => DRAGON_BODY.map((row, y) => {
    const o = wing[y];
    if (!o) return row;
    let out = '';
    for (let x = 0; x < row.length; x++) out += o[x] && o[x] !== '.' ? o[x] : row[x];
    return out;
  }));

  // variações de cor (sobrescrevem a paleta)
  const PALS = {
    dragonGreen: { d: '#46d160', D: '#1d7a3a', h: '#ffe08a', v: '#a6f07a' },
    dragonRed: { d: '#ff5a4a', D: '#9e1a2a', h: '#ffd23f', v: '#ffa36a' },
    whale: { b: '#5aa0ff', B: '#2456c9', W: '#dff3ff' },
    duck: { y: '#ffe14d', Y: '#e8a800', q: '#f5c000', o: '#ff8a1c', r: '#e0561c' },
    fishOrange: { o: '#ff9f1c', Y: '#fff6b0', k: '#1c0f2e' },
    fishCyan: { o: '#5fe3ff', Y: '#ffffff', k: '#1c0f2e' },
    fishPink: { o: '#ff7ac8', Y: '#ffd23f', k: '#1c0f2e' },
    gull: { w: '#ffffff', y: '#ffd23f' },
    flamingo: { w: '#ff8fd0', y: '#ffffff' },
    parrotR: { w: '#ff4d5e', y: '#ffd23f' },
    parrotB: { w: '#5fb8ff', y: '#ffd23f' },
    parrotY: { w: '#ffd23f', y: '#ff4d5e' },
  };

  // formas das partículas (atlas 64x8, 8 células de 8x8)
  const SHAPES = [
    ['########', '########', '########', '########', '########', '########', '########', '########'], // 0 quadrado
    ['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..'], // 1 fumaça
    ['..####..', '.#....#.', '#.##...#', '#.#....#', '#......#', '#......#', '.#....#.', '..####..'], // 2 bolha
    ['...#....', '.#.#.#..', '..###...', '#######.', '..###...', '.#.#.#..', '...#....', '........'], // 3 floco
    ['...#....', '...#....', '..###...', '#######.', '..###...', '...#....', '...#....', '........'], // 4 estrela
    ['...##...', '..####..', '.######.', '########', '########', '.######.', '..####..', '...##...'], // 5 losango
    ['.##..##.', '########', '########', '########', '.######.', '..####..', '...##...', '........'], // 6 coração
    ['........', '........', '..####..', '..####..', '..####..', '..####..', '........', '........'], // 7 ponto
  ];

  const VS = [
    'attribute float aSize;',
    'attribute vec4 aColor;',
    'attribute float aShape;',
    'uniform float uScale;',
    'varying vec4 vColor;',
    'varying float vShape;',
    'void main() {',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  float ps = max(1.0, floor(aSize * projectionMatrix[1][1] * uScale / max(0.1, -mv.z) + 0.5));',
    '  gl_PointSize = ps;',
    '  vColor = aColor;',
    // pontinhos pequenos viram quadrados cheios (a forma não caberia)
    '  vShape = ps < 4.0 ? 0.0 : aShape;',
    '}',
  ].join('\n');
  const FS = [
    'uniform sampler2D uAtlas;',
    'varying vec4 vColor;',
    'varying float vShape;',
    'void main() {',
    '  vec2 pc = min(gl_PointCoord, vec2(0.999));',
    '  vec4 tx = texture2D(uAtlas, vec2((vShape + pc.x) / 8.0, 1.0 - pc.y));',
    '  if (tx.a < 0.5 || vColor.a < 0.02) discard;',
    '  gl_FragColor = vec4(vColor.rgb * tx.rgb, vColor.a);',
    '}',
  ].join('\n');

  const RAIN = [0xff4d5e, 0xff9f1c, 0xffd23f, 0x1fd685, 0x3fa9ff, 0x9b5cff];
  const P_FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'r0', 'g0', 'b0', 'r1', 'g1', 'b1',
    'a', 'sh', 'gr', 'dr', 'an', 'wa', 'wf', 'ph', 'fl', 'fp'];

  function create(T, scene) {
    const root = new T.Group();
    root.name = 'qc-creatures';
    scene.add(root);

    // ---------- câmera (lida no render; valores padrão do jogo até o 1º quadro) ----------
    const cam = { x: 0, y: 5.2, z: 8.6, tanV: Math.tan(31 * Math.PI / 180), aspect: 1.6, tanUp: Math.tan(19.5 * Math.PI / 180) };
    const halfW = (z) => Math.max(8, (cam.z - z) * cam.tanV * cam.aspect);   // meia largura visível na profundidade z
    const topY = (z) => cam.y + (cam.z - z) * cam.tanUp;                      // topo da tela na profundidade z

    // ---------- texturas ----------
    const texs = [];
    function canvasTex(w, h, draw) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
      draw(g, w, h);
      const t = new T.CanvasTexture(c);
      t.magFilter = T.NearestFilter; t.minFilter = T.NearestFilter; t.generateMipmaps = false;
      texs.push(t);
      return t;
    }
    function pixTex(rows, pal, flip) {
      const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
      return canvasTex(w, h, (g) => {
        rows.forEach((row, y) => {
          for (let x = 0; x < row.length; x++) {
            const ch = row[x];
            if (ch === '.') continue;
            g.fillStyle = pal[ch] || PAL[ch] || '#ff00ff';
            g.fillRect(flip ? w - 1 - x : x, y, 1, 1);
          }
        });
      });
    }
    const FR = {};
    // quadros para a direita (r) e espelhados (l)
    function frames(key, list, over) {
      if (FR[key]) return FR[key];
      const pal = Object.assign({}, PAL, over || {});
      return (FR[key] = { r: list.map((rows) => pixTex(rows, pal, false)), l: list.map((rows) => pixTex(rows, pal, true)) });
    }
    const PROC = {};
    const proc = (key, w, h, draw) => PROC[key] || (PROC[key] = canvasTex(w, h, draw));

    const TEX = {
      unicorn: () => frames('unicorn', ART.unicorn),
      meteor: () => frames('meteor', ART.meteor, { a: '#8a7a9c', A: '#4a3e60', h: '#c8b8dc' }),
      whale: () => frames('whale', ART.whale, PALS.whale),
      fish: (v) => frames('fish-' + v, ART.fish, PALS[v]),
      dragon: (v) => frames('dragon-' + v, dragonFrames(), PALS[v]),
      ufo: () => frames('ufo', ART.ufo),
      cow: () => frames('cow', ART.cow),
      rocket: () => frames('rocket', ART.rocket),
      bird: (v) => frames('bird-' + v, ART.bird, PALS[v]),
      duck: () => frames('duck', ART.duck, PALS.duck),
      beam: (i) => proc('beam' + i, 16, 32, (g, w, h) => {
        for (let y = 0; y < h; y++) {
          const hw = 2 + 6 * (y / (h - 1));
          const x0 = Math.round(8 - hw), x1 = Math.round(8 + hw);
          const stripe = (y + i * 2) % 4 < 2;
          g.fillStyle = stripe ? 'rgba(220,255,170,0.85)' : 'rgba(170,255,140,0.45)';
          g.fillRect(x0, y, x1 - x0, 1);
          g.fillStyle = 'rgba(255,255,220,1)';
          g.fillRect(x0, y, 1, 1); g.fillRect(x1 - 1, y, 1, 1);
        }
      }),
      comet: () => proc('comet', 9, 9, (g) => {
        for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
          const d = Math.hypot(x - 4, y - 4);
          if (d > 4.3) continue;
          g.fillStyle = d < 1.5 ? '#ffffff' : d < 2.6 ? '#bff6ff' : d < 3.5 ? '#5fb8ff' : '#6a4aff';
          g.fillRect(x, y, 1, 1);
        }
      }),
      donut: (v) => proc('donut' + v, 16, 16, (g) => {
        const fr = [['#ff7ac8', '#ffb8e4'], ['#7a3f1d', '#a55a2c'], ['#6af0c0', '#b8ffe4']][v];
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const dx = x - 7.5, dy = y - 7.5, d = Math.hypot(dx, dy);
          if (d > 7.7 || d < 2.3) continue;
          const edge = 6.1 + Math.sin(Math.atan2(dy, dx) * 5 + 0.6) * 0.8;
          if (d < 3.1 || d > edge) g.fillStyle = x + y > 17 ? '#b06a2c' : '#e0a050';
          else g.fillStyle = x + y < 10 ? fr[1] : fr[0];
          g.fillRect(x, y, 1, 1);
        }
        const spr = [[4, 5, '#ffd23f'], [10, 3, '#5fb8ff'], [12, 8, '#ffffff'], [3, 10, '#7dffc0'], [8, 12, '#ff4d5e'], [6, 3, '#ffffff'], [12, 11, '#ffd23f'], [11, 5, '#a45cff']];
        for (const [x, y, col] of spr) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
      }),
      candy: () => proc('candy', 20, 10, (g) => {
        for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) {
          const cx = x - 9.5, cy = y - 4.5;
          const body = (cx * cx) / 25 + (cy * cy) / 18 <= 1;
          const tail = Math.abs(cx) > 4 && Math.abs(cy) <= (Math.abs(cx) - 4) * 0.8 + 0.6 && Math.abs(cx) < 10;
          if (!body && !tail) continue;
          if (body) g.fillStyle = Math.floor((x + y) / 2) % 2 ? '#ff4d5e' : '#ffffff';
          else g.fillStyle = Math.abs(cx) > 8 ? '#ffd23f' : '#ffe98a';
          g.fillRect(x, y, 1, 1);
        }
      }),
      lolly: () => proc('lolly', 12, 20, (g) => {
        g.fillStyle = '#ffffff'; g.fillRect(5, 11, 2, 9);
        for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
          const dx = x - 5.5, dy = y - 5.5, d = Math.hypot(dx, dy);
          if (d > 5.8) continue;
          const sw = (Math.atan2(dy, dx) / (Math.PI * 2) + d / 5) % 1;
          g.fillStyle = d > 5 ? '#b8339a' : sw < 0.25 || (sw > 0.5 && sw < 0.75) ? '#ff5fa2' : '#fff0a0';
          g.fillRect(x, y, 1, 1);
        }
      }),
      balloon: (v) => proc('balloon' + v, 14, 20, (g) => {
        const cols = [['#ff4d5e', '#ffd23f'], ['#5fb8ff', '#ffffff'], ['#1fd685', '#ffffff']][v];
        for (let y = 0; y < 15; y++) for (let x = 0; x < 14; x++) {
          const dx = x - 6.5, dy = y - 6.5;
          const rx = y <= 7 ? 6.6 : 6.6 - (y - 7) * 0.62;
          if (Math.abs(dx) > rx || (y <= 7 && Math.hypot(dx / 6.6, dy / 6.8) > 1)) continue;
          let col;
          if (v === 2) {
            const d = Math.hypot(dx, (y - 6.2) * 1.05);
            col = d < 1.4 || (d > 2.6 && d < 3.9) || d > 5.3 ? cols[1] : cols[0];
            if (y >= 12) col = '#0f7a4c';
          } else {
            col = Math.floor((dx / (rx + 0.01) + 1) * 2.5) % 2 ? cols[1] : cols[0];
          }
          g.fillStyle = col; g.fillRect(x, y, 1, 1);
          if (x > 7 && y > 2 && y < 12 && Math.abs(dx) > rx - 1.2) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x, y, 1, 1); }
        }
        g.fillStyle = '#5a3a22'; g.fillRect(4, 15, 1, 2); g.fillRect(9, 15, 1, 2);
        g.fillStyle = '#b07a4a'; g.fillRect(4, 17, 6, 3);
        g.fillStyle = '#5a3a22'; g.fillRect(4, 18, 6, 1);
      }),
    };

    // atlas das partículas
    const atlas = canvasTex(64, 8, (g) => {
      SHAPES.forEach((rows, i) => rows.forEach((row, y) => {
        for (let x = 0; x < 8; x++) if (row[x] === '#') {
          g.fillStyle = i === 2 && (x < 4 && y < 4 && y > 1) ? '#ffffff' : i === 2 ? '#d8eeff' : '#ffffff';
          g.fillRect(i * 8 + x, y, 1, 1);
        }
      }));
    });

    // ---------- partículas ----------
    function makeSys(cap, additive) {
      const geo = new T.BufferGeometry();
      const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 4), siz = new Float32Array(cap), shp = new Float32Array(cap);
      const aPos = new T.BufferAttribute(pos, 3), aCol = new T.BufferAttribute(col, 4);
      const aSiz = new T.BufferAttribute(siz, 1), aShp = new T.BufferAttribute(shp, 1);
      for (const at of [aPos, aCol, aSiz, aShp]) at.setUsage(T.DynamicDrawUsage);
      geo.setAttribute('position', aPos); geo.setAttribute('aColor', aCol);
      geo.setAttribute('aSize', aSiz); geo.setAttribute('aShape', aShp);
      geo.setDrawRange(0, 0);
      const mat = new T.ShaderMaterial({
        uniforms: { uAtlas: { value: atlas }, uScale: { value: 134 } },
        vertexShader: VS, fragmentShader: FS,
        transparent: true, depthWrite: false,
        blending: additive ? T.AdditiveBlending : T.NormalBlending,
      });
      const pts = new T.Points(geo, mat);
      pts.frustumCulled = false; pts.renderOrder = additive ? 3 : 2;
      root.add(pts);
      const S = { pts, geo, mat, aPos, aCol, aSiz, aShp, pos, col, siz, shp, cap, n: 0 };
      for (const f of P_FIELDS) S[f] = new Float32Array(cap);
      return S;
    }
    const norm = makeSys(CAP_NORM, false);
    const glow = makeSys(CAP_GLOW, true);

    // lê a câmera real e o tamanho do buffer a cada render
    const v2 = new T.Vector2();
    norm.pts.onBeforeRender = (renderer, sc, camera) => {
      renderer.getDrawingBufferSize(v2);
      norm.mat.uniforms.uScale.value = glow.mat.uniforms.uScale.value = v2.y / 2;
      if (!camera || !camera.isPerspectiveCamera) return;
      const e = camera.matrixWorld.elements;
      cam.x = e[12]; cam.y = e[13]; cam.z = e[14];
      const half = camera.fov * Math.PI / 360;
      cam.tanV = Math.tan(half); cam.aspect = camera.aspect || 1;
      const pitch = Math.asin(clamp(-e[9], -1, 1));
      cam.tanUp = Math.tan(clamp(half + pitch, 0.05, 1.4));
    };

    const FX = {
      rainbow: { life: [0.7, 0.8], size: 0.8, grow: 0.6, a: 1, fp: 3 },
      spark: { glow: 1, life: [0.4, 0.8], size: 0.7, sizeJ: 0.3, grow: 0.3, c0: 0xfff6b0, c1: 0xff4d5e, grav: 16, drag: 1.5 },
      fire: { glow: 1, life: [0.3, 0.55], size: 1.1, sizeJ: 0.3, grow: 0.25, c0: 0xfff0a0, c1: 0xff3a1a, spread: 1.2, drag: 2 },
      smoke: { life: [0.8, 1.3], size: 1.0, sizeJ: 0.3, grow: 2.4, c0: 0xa89cb8, c1: 0x3a3448, a: 0.6, shape: 1, spread: 0.8, drag: 1 },
      rsmoke: { life: [1.2, 1.9], size: 1.0, sizeJ: 0.3, grow: 2.8, c0: 0xf2f4ff, c1: 0x6a7088, a: 0.75, shape: 1, spread: 1.1, drag: 1.5 },
      flame: { glow: 1, life: [0.15, 0.3], size: 0.9, grow: 0.3, c0: 0xfff6b0, c1: 0xff5a1a, spread: 0.6 },
      flash: { glow: 1, life: [0.18, 0.25], size: 4, grow: 1.8, c0: 0xfff6b0, c1: 0xff6a1a, a: 0.9, shape: 1, fp: 1 },
      splash: { life: [0.6, 1.0], size: 0.6, sizeJ: 0.4, grow: 0.6, colors: [0xffffff, 0x8ff3ff, 0x5aa0ff], grav: 26 },
      drip: { life: [0.5, 0.8], size: 0.4, colors: [0xffffff, 0x8ff3ff], grav: 20 },
      ripple: { life: [0.6, 0.9], size: 0.55, grow: 0.4, colors: [0xffffff, 0x8ff3ff], a: 0.9, drag: 2 },
      starHead: { glow: 1, life: [0.05, 0.08], size: 1.5, c0: 0xffffff },
      starTrail: { glow: 1, life: [0.25, 0.4], size: 0.8, grow: 0.2, c0: 0xffffff, c1: 0x6ab8ff, fp: 1 },
      cometTail: { glow: 1, life: [1.5, 2.1], size: 2.0, sizeJ: 0.3, grow: 0.15, c0: 0xe8ffff, c1: 0x7a4aff, a: 0.9, fp: 1.2, drag: 0.5, spread: 0.5 },
      dragonFire: { glow: 1, life: [0.35, 0.55], size: 0.8, grow: 2.0, c0: 0xfff6b0, c1: 0xff3a1a, spread: 2, drag: 3 },
      sparkle: { glow: 1, life: [0.5, 0.9], size: 1.1, shape: 4, colors: [0xffffff, 0xffd23f, 0xff8fd0, 0x8ff3ff], grav: 4, drag: 2 },
      heart: { life: [0.7, 1.1], size: 1.2, shape: 6, colors: [0xff8fd0, 0xff4d5e, 0xffffff], grav: -2, drag: 2 },
      bubble: { life: [5, 8], size: 1.0, sizeJ: 0.4, grow: 1, c0: 0xbff6ff, a: 0.9, shape: 2, wob: 0.8 },
      ember: { glow: 1, life: [2.2, 4], size: 0.55, sizeJ: 0.4, grow: 0.4, colors: [0xfff0a0, 0xffb040, 0xff6a1a], c1: 0xff2a0a, shape: 5, wob: 0.6, flick: 14, fp: 1.5 },
      snow: { life: [7, 10], size: 0.9, sizeJ: 0.35, colors: [0xffffff, 0xe0f4ff, 0xc8e8ff], a: 0.95, shape: 3, wob: 0.9 },
      firework: { glow: 1, life: [0.8, 1.2], size: 0.9, colors: [0xffd23f, 0xff8fd0, 0x7dffc0, 0x8ff3ff, 0xffffff], grav: 6, drag: 1.6 },
    };

    function emit(fx, x, y, z, vx, vy, vz, anchor, color) {
      const P = fx.glow ? glow : norm;
      if (P.n >= P.cap) return;
      const i = P.n++;
      const sp = fx.spread || 0;
      P.x[i] = x; P.y[i] = y; P.z[i] = z;
      P.vx[i] = vx + (sp ? rnd(-sp, sp) : 0); P.vy[i] = vy + (sp ? rnd(-sp, sp) : 0); P.vz[i] = vz + (sp ? rnd(-sp, sp) * 0.5 : 0);
      P.age[i] = 0; P.life[i] = rnd(fx.life[0], fx.life[1]);
      const s = fx.size * (fx.sizeJ ? rnd(1 - fx.sizeJ, 1 + fx.sizeJ) : 1);
      P.s0[i] = s; P.s1[i] = s * (fx.grow === undefined ? 1 : fx.grow);
      const c0 = color !== undefined ? color : fx.colors ? pick(fx.colors) : fx.c0;
      const c1 = fx.c1 === undefined ? c0 : fx.c1;
      P.r0[i] = (c0 >> 16 & 255) / 255; P.g0[i] = (c0 >> 8 & 255) / 255; P.b0[i] = (c0 & 255) / 255;
      P.r1[i] = (c1 >> 16 & 255) / 255; P.g1[i] = (c1 >> 8 & 255) / 255; P.b1[i] = (c1 & 255) / 255;
      P.a[i] = fx.a === undefined ? 1 : fx.a;
      P.sh[i] = fx.shape || 0; P.gr[i] = fx.grav || 0; P.dr[i] = fx.drag || 0; P.an[i] = anchor;
      P.wa[i] = fx.wob || 0; P.wf[i] = rnd(1.5, 3.5); P.ph[i] = rnd(0, 6.28); P.fl[i] = fx.flick || 0; P.fp[i] = fx.fp || 2;
    }

    function stepSys(P, dt, dz) {
      let i = 0;
      while (i < P.n) {
        const age = P.age[i] + dt;
        let dead = age >= P.life[i];
        if (!dead) {
          P.age[i] = age;
          P.vy[i] -= P.gr[i] * dt;
          if (P.dr[i]) { const d = Math.max(0, 1 - P.dr[i] * dt); P.vx[i] *= d; P.vy[i] *= d; P.vz[i] *= d; }
          P.x[i] += (P.vx[i] + (P.wa[i] ? Math.cos(age * P.wf[i] + P.ph[i]) * P.wa[i] : 0)) * dt;
          P.y[i] += P.vy[i] * dt;
          P.z[i] += P.vz[i] * dt + dz * P.an[i];
          const x = P.x[i], y = P.y[i], z = P.z[i];
          // nunca na frente da pista (corredor livre para os portais)
          dead = z > 12 || z < -140 || (z > -72 && y < 8.8 && x > -6.2 && x < 6.2);
        }
        if (dead) {
          const last = --P.n;
          if (i !== last) for (const f of P_FIELDS) P[f][i] = P[f][last];
          continue;
        }
        const k = age / P.life[i];
        const j3 = i * 3, j4 = i * 4;
        P.pos[j3] = P.x[i]; P.pos[j3 + 1] = P.y[i]; P.pos[j3 + 2] = P.z[i];
        P.siz[i] = P.s0[i] + (P.s1[i] - P.s0[i]) * k;
        P.shp[i] = P.sh[i];
        let a = P.a[i] * (1 - Math.pow(k, P.fp[i]));
        if (P.fl[i]) a *= 0.55 + 0.45 * Math.sin(age * P.fl[i] + P.ph[i]);
        P.col[j4] = P.r0[i] + (P.r1[i] - P.r0[i]) * k;
        P.col[j4 + 1] = P.g0[i] + (P.g1[i] - P.g0[i]) * k;
        P.col[j4 + 2] = P.b0[i] + (P.b1[i] - P.b0[i]) * k;
        P.col[j4 + 3] = Math.ceil(a * 4) / 4; // alfa em degraus (visual retrô)
        i++;
      }
      const n = P.n;
      P.geo.setDrawRange(0, n);
      if (n) {
        P.aPos.updateRange.count = n * 3; P.aPos.needsUpdate = true;
        P.aCol.updateRange.count = n * 4; P.aCol.needsUpdate = true;
        P.aSiz.updateRange.count = n; P.aSiz.needsUpdate = true;
        P.aShp.updateRange.count = n; P.aShp.needsUpdate = true;
      }
    }

    function splash(x, y, z, n, anchor) {
      for (let i = 0; i < n; i++) emit(FX.splash, x + rnd(-1.6, 1.6), y, z + rnd(-1, 1), rnd(-3, 3), rnd(6, 13), rnd(-1.5, 1.5), anchor);
    }
    function sparkleAt(x, y, z, n, anchor) {
      for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), s = rnd(3, 8); emit(FX.sparkle, x, y, z, Math.cos(a) * s, Math.sin(a) * s, 0, anchor); }
    }

    // ---------- instâncias ----------
    const matList = (c) => c.mats;
    function inst() {
      const g = new T.Group(); g.visible = false; root.add(g);
      return { g, mats: [], sp: null, age: 0, acc: 0 };
    }
    // sprite de pixel art (recorte por alfa, sem ordenar)
    function spr(c, tex, w, h, fog) {
      const m = new T.SpriteMaterial({ map: tex, alphaTest: 0.5, transparent: false, fog: !!fog });
      const s = new T.Sprite(m); s.scale.set(w, h, 1); c.g.add(s); c.mats.push(m);
      return s;
    }
    // sprite brilhante (aditivo)
    function glowSpr(c, tex, w, h) {
      const m = new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false });
      const s = new T.Sprite(m); s.scale.set(w, h, 1); c.g.add(s); c.mats.push(m);
      return s;
    }
    const setMap = (s, tex) => { if (s.material.map !== tex) s.material.map = tex; };
    // rotação do sprite para apontar na direção (vx, vy); arte desenhada virada para a direita
    const faceRot = (dir, vx, vy) => (dir > 0 ? Math.atan2(vy, vx) : Math.atan2(-vy, -vx));

    // voo lateral pelo céu: entra por um lado e sai pelo outro
    function crossStart(c, cele, z0, z1, y0, y1, d0, d1, anchor, w, h) {
      c.dir = coin(); c.w = w;
      c.z = cele ? rnd(-52, -70) : rnd(z0, z1);
      const hw = halfW(c.z) + w;
      const lo = 8.5 + h / 2;
      c.y = clamp(cele ? rnd(lo + 1, lo + 8) : rnd(y0, y1), lo, Math.max(lo, topY(c.z) - h / 2 - 1));
      c.x = cele ? -c.dir * rnd(0.05, 0.6) * (hw - w) : -c.dir * hw;
      c.vx = c.dir * 2 * hw / rnd(d0, d1);
      c.anchor = anchor;
    }
    function crossStep(c, dt, dz) {
      c.x += c.vx * dt; c.z += dz * c.anchor;
      return c.dir * c.x < halfW(c.z) + c.w + 1 && c.z < -22 && c.age < 25;
    }

    let curSpeed = 16;
    const DEF = {};

    // ---------- unicórnio com arco-íris ----------
    DEF.unicorn = {
      cap: 2, every: [6, 11],
      make() { const c = inst(); c.sp = spr(c, TEX.unicorn().r[0], 8, 5.33); return c; },
      start(c, cele) {
        crossStart(c, cele, -60, -95, 12, 21, 4.5, 6.5, 0.12, 8, 5.33);
        c.tex = TEX.unicorn()[c.dir > 0 ? 'r' : 'l']; c.trail = 0;
      },
      step(c, dt, dz) {
        const alive = crossStep(c, dt, dz);
        setMap(c.sp, c.tex[Math.floor(c.age * 7) % 2]);
        const bob = Math.sin(c.age * 7) * 0.3;
        c.g.position.set(c.x, c.y + bob, c.z);
        c.trail += Math.abs(c.vx) * dt;
        while (c.trail > 0.7) {
          c.trail -= 0.7;
          const tx = c.x - c.dir * (3.3 + c.trail);
          for (let b = 0; b < 6; b++) emit(FX.rainbow, tx, c.y + bob + 1.3 - b * 0.62, c.z + 0.2, 0, 0, 0, c.anchor, RAIN[b]);
        }
        return alive;
      },
    };

    // ---------- meteoro ----------
    DEF.meteor = {
      cap: 3, every: [2.2, 4.5],
      make() { const c = inst(); c.sp = spr(c, TEX.meteor().r[0], 4.6, 3.1); return c; },
      start(c, cele, idx) {
        c.side = cele ? (idx % 2 ? 1 : -1) : coin();
        c.z = cele ? rnd(-52, -75) : rnd(-65, -110);
        const hw = halfW(c.z), top = topY(c.z);
        c.x = c.side * rnd(9, Math.max(10, hw * 0.75));
        c.y = cele ? top - rnd(2, 7) : top + 3;
        const sp = rnd(16, 24), ang = rnd(0.95, 1.3);
        c.vx = c.side * Math.cos(ang) * sp; c.vy = -Math.sin(ang) * sp; c.vz = -rnd(0, 5);
        c.anchor = 0.2;
        c.sp.material.rotation = Math.atan2(c.vy, c.vx);
        c.g.scale.setScalar(cele ? 1.25 : rnd(0.85, 1.15));
        c.tex = TEX.meteor().r; c.acc = 0; c.acc2 = 0;
      },
      step(c, dt, dz) {
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt + dz * c.anchor;
        setMap(c.sp, c.tex[Math.floor(c.age * 12) % 2]);
        c.g.position.set(c.x, c.y, c.z);
        const len = Math.hypot(c.vx, c.vy), ux = c.vx / len, uy = c.vy / len;
        c.acc += dt * 70;
        while (c.acc >= 1) { c.acc--; emit(FX.fire, c.x - ux * 1.2, c.y - uy * 1.2, c.z, -c.vx * 0.15, -c.vy * 0.15, 0, c.anchor); }
        c.acc2 += dt * 22;
        while (c.acc2 >= 1) { c.acc2--; emit(FX.smoke, c.x - ux * 2, c.y - uy * 2, c.z - 0.3, 0, 0.6, 0, c.anchor); }
        if (c.y < -8) {
          emit(FX.flash, c.x, -8, c.z, 0, 0, 0, c.anchor);
          for (let i = 0; i < 18; i++) emit(FX.spark, c.x, -8, c.z, rnd(-7, 7), rnd(4, 13), rnd(-3, 3), c.anchor);
          return false;
        }
        return Math.abs(c.x) < halfW(c.z) + 12 && c.z < 8;
      },
    };

    // ---------- estrela cadente ----------
    DEF['shooting-star'] = {
      cap: 3, every: [2.5, 6],
      make() { return inst(); },
      start(c, cele) {
        c.dir = coin(); c.z = rnd(-95, -122);
        const hw = halfW(c.z), top = topY(c.z);
        c.x = -c.dir * rnd(0.1, 0.9) * hw;
        c.y = rnd(Math.max(14, top * 0.55), Math.max(15, top - 2));
        const sp = hw * rnd(0.9, 1.3);
        c.vx = c.dir * sp; c.vy = -sp * rnd(0.1, 0.28);
        c.life = cele ? rnd(0.9, 1.2) : rnd(0.6, 0.9);
      },
      step(c, dt) {
        const px = c.x, py = c.y;
        c.x += c.vx * dt; c.y += c.vy * dt;
        if (c.age < c.life) {
          emit(FX.starHead, c.x, c.y, c.z, 0, 0, 0, 0);
          const n = Math.min(40, Math.ceil(Math.hypot(c.x - px, c.y - py) / 0.55));
          for (let k = 0; k < n; k++) { const f = k / n; emit(FX.starTrail, px + (c.x - px) * f, py + (c.y - py) * f, c.z, 0, 0, 0, 0); }
        }
        return c.age < c.life + 0.4;
      },
    };

    // ---------- baleia saltando do oceano ----------
    DEF.whale = {
      cap: 1, every: [6, 11],
      make() { const c = inst(); c.sp = spr(c, TEX.whale().r[0], 10, 5, true); return c; },
      start(c, cele, idx) {
        c.side = cele ? (idx % 2 ? 1 : -1) : coin();
        c.dur = rnd(2.4, 3.0); c.apex = rnd(2.5, 6);
        c.x0 = c.side * rnd(9.5, 11.5); c.x1 = c.x0 + c.side * rnd(8, 11);
        c.vz = -Math.min(curSpeed * 0.45, 14);
        c.z = cele ? rnd(-40, -56) : -48 - (curSpeed + c.vz) * c.dur * 0.5;
        c.s = cele ? 0.14 : 0; c.out = false;
        c.sp.material.map = TEX.whale()[c.side > 0 ? 'r' : 'l'][0];
      },
      step(c, dt, dz) {
        c.s += dt / c.dur;
        c.z += c.vz * dt + dz;
        const s = Math.min(c.s, 1), H = c.apex + 12;
        const x = c.x0 + (c.x1 - c.x0) * s, y = -12 + H * 4 * s * (1 - s);
        c.sp.material.rotation = faceRot(c.side, c.x1 - c.x0, H * 4 * (1 - 2 * s)) * 0.85;
        c.g.position.set(x, y, c.z);
        if (!c.out && y > -9.5) { c.out = true; splash(x, -9.5, c.z, 16, 1); }
        if (y > -6 && Math.random() < dt * 14) emit(FX.drip, x - c.side * rnd(0, 3), y - 1, c.z, 0, 0, 0, 1);
        if (c.s >= 1) { splash(x, -9.5, c.z, 24, 1); return false; }
        return c.z < 10;
      },
    };

    // ---------- cardume de peixes ----------
    DEF.fish = {
      cap: 2, every: [4, 8],
      make() {
        const c = inst(); c.fish = [];
        for (let i = 0; i < 7; i++) { const s = spr(c, TEX.fish('fishOrange').r[0], 2.1, 1.17, true); s.userData = { d: 0, dx: 0, dz: 0, ap: 0, len: 0, st: 0 }; c.fish.push(s); }
        return c;
      },
      start(c, cele, idx) {
        c.side = cele ? (idx % 2 ? 1 : -1) : coin();
        c.n = 4 + Math.floor(Math.random() * 4);
        c.dur = rnd(1.1, 1.4);
        c.vz = -Math.min(curSpeed * 0.4, 10);
        c.z = cele ? rnd(-34, -48) : -38 - (curSpeed + c.vz) * 1.1;
        c.x0 = c.side * rnd(9, 11);
        const vs = ['fishOrange', 'fishCyan', 'fishPink'], mix = Math.random() < 0.35, v0 = pick(vs);
        c.fish.forEach((f, i) => {
          const u = f.userData;
          u.d = i * rnd(0.1, 0.16); u.dx = rnd(-0.8, 0.8); u.dz = -i * 0.9 + rnd(-0.3, 0.3);
          u.ap = rnd(-0.5, 3.5); u.len = rnd(5, 7.5); u.st = 0;
          u.tex = TEX.fish(mix ? pick(vs) : v0)[c.side > 0 ? 'r' : 'l'];
          f.visible = false;
        });
        c.g.position.set(0, 0, c.z);
      },
      step(c, dt, dz) {
        c.z += c.vz * dt + dz;
        c.g.position.z = c.z;
        let alive = false;
        for (let i = 0; i < c.n; i++) {
          const f = c.fish[i], u = f.userData, s = (c.age - u.d) / c.dur;
          if (s < 0) { alive = true; continue; }
          if (s > 1) {
            if (u.st < 2) { u.st = 2; f.visible = false; splash(c.x0 + c.side * u.len + u.dx, -9.5, c.z + u.dz, 5, 1); }
            continue;
          }
          alive = true; f.visible = true;
          const H = u.ap + 11;
          const x = c.x0 + u.dx + c.side * u.len * s, y = -11 + H * 4 * s * (1 - s);
          if (u.st === 0 && y > -9.5) { u.st = 1; splash(x, -9.5, c.z + u.dz, 4, 1); }
          f.position.set(x, y, u.dz);
          f.material.rotation = faceRot(c.side, c.side * u.len, H * 4 * (1 - 2 * s)) * 0.8;
          setMap(f, u.tex[Math.floor(c.age * 10 + i) % 2]);
        }
        for (let i = c.n; i < c.fish.length; i++) c.fish[i].visible = false;
        return alive && c.z < 10;
      },
    };

    // ---------- dragão ----------
    DEF.dragon = {
      cap: 1, every: [7, 12],
      make() { const c = inst(); c.sp = spr(c, TEX.dragon('dragonGreen').r[0], 10, 6.43); return c; },
      start(c, cele) {
        crossStart(c, cele, -62, -95, 12.5, 21, 5, 7, 0.1, 10, 6.43);
        c.tex = TEX.dragon(Math.random() < 0.5 ? 'dragonGreen' : 'dragonRed')[c.dir > 0 ? 'r' : 'l'];
        c.fire = cele ? 0.3 : rnd(0.6, 1.4); c.puff = 0;
      },
      step(c, dt, dz) {
        const alive = crossStep(c, dt, dz);
        const f = [0, 1, 2, 1][Math.floor(c.age * 8) % 4];
        setMap(c.sp, c.tex[f]);
        const bob = Math.sin(c.age * 4) * 0.6 + (f === 2 ? 0.25 : 0);
        c.g.position.set(c.x, c.y + bob, c.z);
        c.fire -= dt;
        if (c.fire <= 0) { c.fire = rnd(1.1, 2.4); c.puff = 0.5; }
        if (c.puff > 0) {
          c.puff -= dt;
          c.acc += dt * 60;
          while (c.acc >= 1) {
            c.acc--;
            emit(FX.dragonFire, c.x + c.dir * 4.9, c.y + bob + 0.9, c.z + 0.2, c.vx + c.dir * rnd(8, 13), rnd(-2.5, 0.5), 0, c.anchor);
          }
        }
        return alive;
      },
    };

    // ---------- OVNI abduzindo uma vaca ----------
    DEF.ufo = {
      cap: 1, every: [9, 15],
      make() {
        const c = inst();
        c.beam = glowSpr(c, TEX.beam(0), 6, 16); c.beam.center.set(0.5, 1); c.beam.position.set(0, -0.9, -0.05);
        c.cow = spr(c, TEX.cow().r[0], 3.1, 1.91);
        c.sp = spr(c, TEX.ufo().r[0], 6.4, 2.9);
        return c;
      },
      start(c, cele, idx) {
        c.side = cele ? (idx % 2 ? 1 : -1) : coin();
        c.z = cele ? rnd(-48, -60) : rnd(-52, -78);
        const hw = halfW(c.z);
        c.x = c.side * rnd(13, Math.max(13.5, Math.min(24, hw * 0.72)));
        c.hy = clamp(rnd(12, 16), 11, Math.max(11, topY(c.z) - 3));
        c.y = cele ? c.hy : topY(c.z) + 4;
        c.phase = cele ? 1 : 0; c.pt = 0; c.vx = 0; c.vy = 0;
        c.withCow = Math.random() < 0.7;
        c.beamLen = c.hy + 3.1;
        c.cow.visible = false; c.beam.visible = false;
        c.cow.material.map = TEX.cow()[c.side > 0 ? 'l' : 'r'][0];
        c.anchor = 0.15;
      },
      step(c, dt, dz, t) {
        c.pt += dt; c.z += dz * c.anchor;
        setMap(c.sp, TEX.ufo().r[Math.floor(c.age * 6) % 2]);
        let bob = Math.sin(c.age * 3) * 0.3;
        if (c.phase === 0) {
          c.y += (c.hy - c.y) * (1 - Math.pow(0.015, dt));
          if (c.pt > 1.1) { c.phase = 1; c.pt = 0; }
        } else if (c.phase === 1) {
          const on = Math.min(1, c.pt / 0.25);
          c.beam.visible = true;
          c.beam.scale.set(6 * on, c.beamLen, 1);
          c.beam.material.opacity = 0.5 + Math.sin(t * 23) * 0.12;
          setMap(c.beam, TEX.beam(Math.floor(c.age * 10) % 2));
          const endT = c.withCow ? 3.6 : 2.2;
          if (c.withCow) {
            const k = clamp((c.pt - 0.35) / 2.7, 0, 1);
            if (k > 0 && k < 1) {
              c.cow.visible = true;
              const wy = -3.2 + (c.hy - 1.6 + 3.2) * smooth(k);
              c.cow.position.set(Math.sin(c.pt * 2.3) * 0.4, wy - c.y - bob, 0.05);
              c.cow.material.rotation = Math.sin(c.pt * 4.5) * 0.55;
              const sc = k > 0.85 ? 1 - (k - 0.85) / 0.15 * 0.7 : 1;
              c.cow.scale.set(3.1 * sc, 1.91 * sc, 1);
            } else if (k >= 1 && c.cow.visible) {
              c.cow.visible = false;
              sparkleAt(c.x, c.y - 0.8, c.z + 0.3, 14, c.anchor);
            }
          }
          if (c.pt > endT) { c.phase = 2; c.pt = 0; c.beam.visible = false; c.cow.visible = false; }
        } else {
          bob = 0;
          c.vy += 26 * dt; c.vx += c.side * 18 * dt;
          c.y += c.vy * dt; c.x += c.vx * dt;
          if (c.y > topY(c.z) + 5 || Math.abs(c.x) > halfW(c.z) + 8) return false;
        }
        c.g.position.set(c.x, c.y + bob, c.z);
        return c.age < 15;
      },
    };

    // ---------- foguete ----------
    DEF.rocket = {
      cap: 2, every: [4, 8],
      make() { const c = inst(); c.sp = spr(c, TEX.rocket().r[0], 2.2, 4.95); return c; },
      start(c, cele, idx) {
        c.side = cele ? (idx % 2 ? 1 : -1) : coin();
        c.z = cele ? rnd(-48, -62) : rnd(-55, -95);
        const hw = halfW(c.z);
        c.x = c.side * rnd(12, Math.max(12.5, Math.min(30, hw * 0.85)));
        c.y = cele ? rnd(1, 6) : -7; c.vy = cele ? 9 : 1.5; c.vx = c.side * rnd(0.5, 2);
        c.anchor = 0.25; c.acc2 = 0;
        c.sp.material.rotation = -c.side * rnd(0.03, 0.12);
        if (!cele) for (let i = 0; i < 14; i++) emit(FX.rsmoke, c.x, -6, c.z, rnd(-4, 4), rnd(0, 1.5), rnd(-1, 1), c.anchor);
      },
      step(c, dt, dz) {
        c.vy = Math.min(c.vy + 12 * dt, 34);
        c.y += c.vy * dt; c.x += c.vx * dt; c.z += dz * c.anchor;
        setMap(c.sp, TEX.rocket().r[Math.floor(c.age * 16) % 2]);
        c.g.position.set(c.x, c.y, c.z);
        const nx = c.x + Math.sin(c.sp.material.rotation) * 1.6, ny = c.y - 2.4;
        c.acc += dt * 45;
        while (c.acc >= 1) { c.acc--; emit(FX.flame, nx, ny, c.z + 0.1, 0, -rnd(6, 10), 0, c.anchor); }
        c.acc2 += dt * 26;
        while (c.acc2 >= 1) { c.acc2--; emit(FX.rsmoke, nx, ny - 0.8, c.z - 0.2, 0, rnd(-1, 0.3), 0, c.anchor); }
        return c.y < topY(c.z) + 6 && c.age < 9;
      },
    };

    // ---------- doces flutuando ----------
    DEF.donut = {
      cap: 4, every: [1.8, 3.6],
      make() { const c = inst(); c.sp = spr(c, TEX.donut(0), 5, 5); return c; },
      start(c, cele) {
        const v = pick(['donut', 'donut', 'donut', 'candy', 'lolly']);
        c.kind = v;
        const w = v === 'candy' ? 6 : v === 'lolly' ? 3.3 : rnd(4.4, 5.6);
        const h = v === 'candy' ? 3 : v === 'lolly' ? 5.5 : w;
        c.sp.material.map = v === 'candy' ? TEX.candy() : v === 'lolly' ? TEX.lolly() : TEX.donut(Math.random() < 0.6 ? 0 : Math.random() < 0.5 ? 1 : 2);
        c.sp.scale.set(w, h, 1);
        c.z = cele ? rnd(-45, -62) : rnd(-50, -92);
        const hw = halfW(c.z), top = topY(c.z), lo = 9 + Math.max(w, h) / 2;
        c.x = rnd(-hw * 0.85, hw * 0.85);
        c.y = rnd(lo, Math.max(lo, top - h / 2 - 1));
        c.vx = rnd(-2.5, 2.5); c.spin = rnd(0.8, 1.8) * coin(); c.rot = rnd(0, 6.28);
        c.life = rnd(5, 7); c.anchor = 0.25; c.popped = false;
        c.g.scale.setScalar(0.01);
      },
      step(c, dt, dz) {
        c.x += c.vx * dt; c.z += dz * c.anchor;
        c.rot += c.spin * dt;
        c.sp.material.rotation = c.kind === 'lolly' ? Math.sin(c.rot) * 0.5 : c.rot;
        const left = c.life - c.age;
        let s = c.age < 0.4 ? Math.max(0.01, backOut(c.age / 0.4)) : 1;
        if (left < 0.25) s = Math.max(0.01, left / 0.25);
        c.g.scale.setScalar(s);
        c.g.position.set(c.x, c.y + Math.sin(c.age * 2 + c.spin) * 0.5, c.z);
        if (left < 0.25 && !c.popped) {
          c.popped = true;
          for (let i = 0; i < 8; i++) { const a = rnd(0, 6.28); emit(Math.random() < 0.5 ? FX.heart : FX.sparkle, c.x, c.y, c.z, Math.cos(a) * 5, Math.sin(a) * 5, 0, c.anchor); }
        }
        return left > 0 && c.z < -20;
      },
    };

    // ---------- balões de ar quente ----------
    DEF.balloon = {
      cap: 3, every: [2.5, 5],
      make() { const c = inst(); c.sp = spr(c, TEX.balloon(0), 4.6, 6.57); return c; },
      start(c, cele, idx) {
        c.side = cele ? (idx % 2 ? 1 : -1) : coin();
        c.z = cele ? rnd(-45, -62) : rnd(-50, -100);
        const hw = halfW(c.z);
        c.x = c.side * rnd(10.5, Math.max(11, Math.min(30, hw * 0.88)));
        c.y = cele ? rnd(4, 12) : -8;
        c.vy = cele ? rnd(3, 4.5) : rnd(2.2, 3.5);
        c.sp.material.map = TEX.balloon(Math.random() < 0.4 ? 2 : Math.random() < 0.5 ? 0 : 1);
        c.anchor = 0.3; c.ph = rnd(0, 6);
      },
      step(c, dt, dz) {
        c.y += c.vy * dt; c.z += dz * c.anchor;
        c.g.position.set(c.x + Math.sin(c.age * 0.9 + c.ph) * 0.6, c.y, c.z);
        c.sp.material.rotation = Math.sin(c.age * 1.3 + c.ph) * 0.06;
        return c.y < topY(c.z) + 6 && c.z < -22 && c.age < 30;
      },
    };

    // ---------- bando de pássaros em V ----------
    DEF.bird = {
      cap: 1, every: [6, 11],
      make() {
        const c = inst(); c.birds = [];
        for (let i = 0; i < 9; i++) { const s = spr(c, TEX.bird('gull').r[0], 2.6, 1.45); s.userData = { dx: 0, dy: 0, dz: 0, tex: null }; c.birds.push(s); }
        return c;
      },
      start(c, cele) {
        crossStart(c, cele, -48, -85, 13, 21, 5.5, 7.5, 0.12, 12, 6);
        c.n = pick([5, 7, 9]);
        const variant = pick(['gull', 'gull', 'flamingo', 'parrot']);
        c.birds.forEach((b, i) => {
          const u = b.userData, rank = Math.ceil(i / 2), up = i % 2 ? 1 : -1;
          u.dx = -c.dir * rank * 2.3; u.dy = up * rank * 1.05; u.dz = rank * 0.4;
          u.tex = TEX.bird(variant === 'parrot' ? pick(['parrotR', 'parrotB', 'parrotY']) : variant).r;
          b.visible = i < c.n;
        });
      },
      step(c, dt, dz) {
        const alive = crossStep(c, dt, dz);
        c.g.position.set(c.x, c.y + Math.sin(c.age * 1.6) * 0.5, c.z);
        for (let i = 0; i < c.n; i++) {
          const b = c.birds[i], u = b.userData;
          b.position.set(u.dx, u.dy + Math.sin(c.age * 3 + i) * 0.15, u.dz);
          setMap(b, u.tex[Math.floor(c.age * 6 + i * 0.5) % 2]);
        }
        return alive;
      },
    };

    // ---------- pato de borracha gigante ----------
    DEF.duck = {
      cap: 1, every: [9, 15],
      make() { const c = inst(); c.sp = spr(c, TEX.duck().r[0], 13, 10.3, true); return c; },
      start(c, cele, idx) {
        c.side = cele ? (idx % 2 ? 1 : -1) : coin();
        c.x = c.side * rnd(14, 17);
        c.vz = -Math.min(curSpeed * 0.35, 10);
        c.z = cele ? rnd(-52, -62) : -118;
        c.sp.material.map = TEX.duck()[c.side > 0 ? 'l' : 'r'][0]; // olha para a pista
      },
      step(c, dt, dz) {
        c.z += c.vz * dt + dz;
        c.g.position.set(c.x, -10 + 5.15 - 1.5 + Math.sin(c.age * 2.4) * 0.35, c.z);
        c.sp.material.rotation = Math.sin(c.age * 1.9) * 0.09;
        c.acc += dt * 16;
        while (c.acc >= 1) {
          c.acc--;
          const sx = coin();
          emit(FX.ripple, c.x + sx * rnd(3.5, 6), -9.7, c.z + rnd(-1, 1), sx * rnd(1.5, 3), 0, rnd(-0.8, 0.8), 1);
        }
        return c.z < 6;
      },
    };

    // ---------- cometa ----------
    DEF.comet = {
      cap: 1, every: [14, 22],
      make() { const c = inst(); c.sp = glowSpr(c, TEX.comet(), 3.4, 3.4); return c; },
      start(c, cele) {
        c.dir = coin(); c.z = rnd(-110, -124);
        const hw = halfW(c.z), top = topY(c.z);
        c.y = clamp(rnd(top * 0.62, top - 5), 16, 70);
        c.x = cele ? -c.dir * rnd(0.2, 0.6) * hw : -c.dir * (hw + 4);
        c.vx = c.dir * 2 * (hw + 4) / rnd(7, 9); c.vy = -rnd(0.4, 1.2);
      },
      step(c, dt) {
        c.x += c.vx * dt; c.y += c.vy * dt;
        const s = 3.4 + Math.sin(c.age * 9) * 0.35;
        c.sp.scale.set(s, s, 1);
        c.g.position.set(c.x, c.y, c.z);
        c.acc += dt * 110;
        while (c.acc >= 1) {
          c.acc--;
          emit(FX.cometTail, c.x - c.dir * 0.6, c.y + rnd(-0.5, 0.5), c.z - 0.2, -c.dir * rnd(1, 3), rnd(-0.4, 0.4), 0, 0);
        }
        if (Math.random() < dt * 6) emit(FX.sparkle, c.x - c.dir * rnd(2, 12), c.y + rnd(-1.5, 1.5), c.z, 0, 0, 0, 0);
        return c.dir * c.x < halfW(c.z) + 8 && c.age < 20;
      },
    };

    // ---------- ambientes (só partículas) ----------
    const AMB = {
      bubble: {
        rate: 5, burst: 40,
        spawn(cele) {
          const z = cele ? rnd(-70, -22) : rnd(-115, -20);
          const x = coin() * rnd(7, Math.max(8, Math.min(halfW(z), 34)));
          emit(FX.bubble, x, cele ? rnd(-4, 14) : rnd(-9, 12), z, 0, rnd(1.4, 3), 0, 1);
        },
      },
      ember: {
        rate: 16, burst: 60,
        spawn(cele) {
          const z = cele ? rnd(-70, -20) : rnd(-110, -15);
          const sx = coin(), x = sx * rnd(7, Math.max(8, Math.min(halfW(z), 36)));
          emit(FX.ember, x, cele ? rnd(-2, 14) : rnd(-9, 5), z, sx * rnd(0, 0.8), rnd(1.5, 4.5), 0, 1);
        },
      },
      snowflake: {
        rate: 24, burst: 70,
        spawn(cele) {
          const z = cele ? rnd(-75, -20) : rnd(-115, -12);
          const hw = Math.min(halfW(z), 45);
          let x = rnd(-hw, hw);
          if (z > -74 && Math.abs(x) < 7) x = (x < 0 ? -1 : 1) * rnd(7, Math.max(8, hw));
          const top = topY(z);
          emit(FX.snow, x, cele ? rnd(6, top) : rnd(2, top + 1), z, rnd(-0.5, 0.5), -rnd(1.5, 3.2), 0, 1);
        },
      },
    };

    // ---------- estado ----------
    let types = [], inten = 0.5, rate = 1.3, paused = false;
    const timers = {}, accs = {}, counts = {};
    const active = [], pools = {};
    TYPES.forEach((id) => { counts[id] = 0; timers[id] = 1; accs[id] = 0; });

    function spawn(id, cele, idx) {
      const pool = pools[id] || (pools[id] = []);
      const c = pool.pop() || DEF[id].make();
      c.type = id; c.age = 0; c.acc = 0; c.g.userData.type = id;
      c.g.scale.setScalar(1);
      DEF[id].start(c, !!cele, idx || 0);
      c.g.visible = true;
      active.push(c); counts[id]++;
      DEF[id].step(c, 0, 0, clock); // já posiciona no 1º quadro
    }
    function disposeInst(c) {
      root.remove(c.g);
      for (const m of matList(c)) m.dispose();
    }
    function release(i) {
      const c = active[i];
      active[i] = active[active.length - 1]; active.pop();
      counts[c.type]--;
      c.g.visible = false;
      const pool = pools[c.type];
      if (pool.length < POOL_KEEP) pool.push(c); else disposeInst(c);
    }
    const capFor = (id) => DEF[id].cap + (inten > 0.66 ? 1 : 0);

    function fireworks() {
      for (let k = 0; k < 3; k++) {
        const z = rnd(-60, -80), x = rnd(-0.6, 0.6) * halfW(z), y = rnd(14, Math.max(15, topY(z) - 4));
        for (let i = 0; i < 26; i++) { const a = (i / 26) * 6.28, s = rnd(6, 9); emit(FX.firework, x, y, z, Math.cos(a) * s, Math.sin(a) * s, 0, 0.1); }
      }
    }

    let clock = 0;
    const api = {
      setTypes(ids, intensity) {
        const next = (ids || []).filter((id) => DEF[id] || AMB[id]);
        for (const id of next) if (types.indexOf(id) < 0) { timers[id] = rnd(0.3, 2); accs[id] = 0; }
        types = next;
        inten = clamp(typeof intensity === 'number' ? intensity : 0.5, 0, 1);
        rate = 0.6 + 1.4 * inten;
      },
      update(dt, dz, t) {
        if (paused || !(dt > 0)) return;
        dt = Math.min(dt, 0.1); dz = dz || 0;
        clock = typeof t === 'number' ? t : clock + dt;
        curSpeed += (dz / dt - curSpeed) * Math.min(1, dt * 4);
        for (const id of types) {
          const amb = AMB[id];
          if (amb) {
            accs[id] += amb.rate * rate * dt;
            while (accs[id] >= 1) { accs[id]--; amb.spawn(false); }
            continue;
          }
          timers[id] -= dt;
          if (timers[id] <= 0) {
            const ev = DEF[id].every;
            timers[id] = rnd(ev[0], ev[1]) / rate;
            if (counts[id] < capFor(id) && active.length < MAX_ACTIVE) spawn(id, false);
          }
        }
        for (let i = active.length - 1; i >= 0; i--) {
          const c = active[i];
          c.age += dt;
          if (!DEF[c.type].step(c, dt, dz, clock)) release(i);
        }
        stepSys(norm, dt, dz);
        stepSys(glow, dt, dz);
      },
      celebrate() {
        const list = types.slice().sort(() => Math.random() - 0.5);
        if (!list.length) { fireworks(); return; }
        const n = clamp(list.length + 2, 3, 5);
        for (let i = 0; i < n; i++) {
          const id = list[i % list.length];
          if (AMB[id]) {
            if (i < list.length) for (let k = 0; k < AMB[id].burst; k++) AMB[id].spawn(true);
            continue;
          }
          if (counts[id] < DEF[id].cap + 3 && active.length < MAX_ACTIVE + CELE_EXTRA) spawn(id, true, i);
          // os próximos naturais demoram um pouco para não entupir o céu
          timers[id] = Math.max(timers[id], rnd(2, 4));
        }
      },
      clear() {
        while (active.length) { const c = active.pop(); counts[c.type]--; disposeInst(c); }
        for (const id in pools) { pools[id].forEach(disposeInst); pools[id].length = 0; }
        norm.n = glow.n = 0;
        norm.geo.setDrawRange(0, 0); glow.geo.setDrawRange(0, 0);
        // libera a GPU; as texturas voltam a subir sozinhas se usadas de novo
        for (const t of texs) t.dispose();
      },
      setPaused(p) { paused = !!p; },
      dispose() {
        api.clear();
        scene.remove(root);
        norm.geo.dispose(); norm.mat.dispose(); glow.geo.dispose(); glow.mat.dispose();
      },
      stats() { return { creatures: active.length, particles: norm.n + glow.n, types: types.slice(), intensity: inten }; },
      // para a página de testes: todas as texturas de pixel art
      debugTextures() {
        TYPES.forEach((id) => { if (TEX[id]) TEX[id](id === 'fish' ? 'fishOrange' : id === 'dragon' ? 'dragonGreen' : id === 'bird' ? 'gull' : 0); });
        TEX.cow(); TEX.beam(0); TEX.candy(); TEX.lolly(); TEX.balloon(1); TEX.balloon(2); TEX.donut(1); TEX.donut(2);
        TEX.dragon('dragonRed'); TEX.fish('fishCyan'); TEX.bird('parrotR');
        const out = [];
        for (const k in FR) FR[k].r.forEach((t, i) => out.push([k + i, t.image]));
        for (const k in PROC) out.push([k, PROC[k].image]);
        out.push(['atlas', atlas.image]);
        return out;
      },
    };
    return api;
  }

  QC.Creatures = { TYPES, PREVIEW_ORDER: TYPES.slice(), create };
})();
