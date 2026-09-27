// Configuração do Xadrez em Primeira Pessoa. Somente leitura para os módulos.

export const SQUARE = 2;            // lado de uma casa (m)
export const BOARD_HALF = SQUARE * 4; // 8 m

// Altura das peças (m) e altura dos "olhos" (fração da altura)
export const PIECE_HEIGHT = { p: 1.6, n: 2.0, b: 2.2, r: 1.9, q: 2.5, k: 2.7 };
export const EYE_FRACTION = 0.85;

export const COLORS = {
  sky: 0xbfd8ee,
  fog: 0xd6e4f0,
  grass: 0x5f8f4a,
  grassDark: 0x4d7a3b,
  lightSquare: 0xe9dfc9,
  darkSquare: 0x6d5a4a,
  frame: 0x3d2b1f,
  whitePiece: 0xf1ebe0,
  blackPiece: 0x2a2624,
  wall: 0xb8b0a2,
  trunk: 0x6b4a2e,
  leaves: 0x3f7a3a,
  leaves2: 0x568f45,
  selected: 0xffd54a,
  target: 0x64c8ff,
  capture: 0xff6b5a,
  lastMove: 0xb9e37a,
  check: 0xff3b3b,
  dust: 0xcfc6b8,
};

// Perfis de torno (LatheGeometry): pontos [raio, altura] em unidades relativas à altura 1.
// Cada peça é depois escalada para PIECE_HEIGHT. O raio 0 fecha o topo.
export const LATHE_PROFILES = {
  p: [[0, 0], [0.42, 0], [0.44, 0.06], [0.36, 0.12], [0.26, 0.16], [0.2, 0.3], [0.16, 0.5], [0.22, 0.56], [0.16, 0.62], [0.24, 0.7], [0.26, 0.8], [0.2, 0.92], [0.1, 0.99], [0, 1]],
  r: [[0, 0], [0.42, 0], [0.44, 0.07], [0.36, 0.14], [0.3, 0.2], [0.27, 0.5], [0.28, 0.72], [0.34, 0.76], [0.36, 0.78], [0.36, 0.97], [0.3, 0.97], [0.3, 0.9], [0, 0.9]],
  b: [[0, 0], [0.4, 0], [0.42, 0.06], [0.34, 0.12], [0.22, 0.18], [0.18, 0.32], [0.16, 0.5], [0.24, 0.56], [0.16, 0.62], [0.22, 0.7], [0.2, 0.8], [0.12, 0.9], [0.06, 0.96], [0, 1]],
  q: [[0, 0], [0.42, 0], [0.44, 0.06], [0.36, 0.12], [0.24, 0.18], [0.2, 0.32], [0.17, 0.52], [0.24, 0.58], [0.17, 0.64], [0.22, 0.74], [0.26, 0.86], [0.22, 0.9], [0.14, 0.93], [0.08, 0.98], [0, 1]],
  k: [[0, 0], [0.42, 0], [0.44, 0.06], [0.36, 0.12], [0.24, 0.18], [0.2, 0.32], [0.17, 0.52], [0.24, 0.58], [0.17, 0.64], [0.22, 0.74], [0.26, 0.84], [0.22, 0.88], [0.1, 0.9], [0, 0.9]],
  // cavalo: só a base; a cabeça é extrudada
  n: [[0, 0], [0.42, 0], [0.44, 0.06], [0.36, 0.12], [0.26, 0.18], [0.22, 0.3], [0, 0.3]],
};

// Silhueta 2D da cabeça do cavalo (x, y) em unidades relativas à altura 1, olhando para -x
export const KNIGHT_SHAPE = [
  [-0.18, 0.28], [0.18, 0.28], [0.2, 0.45], [0.17, 0.6], [0.22, 0.72], [0.18, 0.82], [0.1, 0.9],
  [0.05, 1.0], [-0.01, 0.92], [-0.09, 0.98], [-0.13, 0.9], [-0.28, 0.84], [-0.4, 0.78], [-0.4, 0.7],
  [-0.27, 0.67], [-0.17, 0.6], [-0.14, 0.5], [-0.16, 0.4],
];

export const CAMERA = {
  overheadFov: 45,
  firstPersonFov: 72,
  flyDur: 0.9,           // s
  overheadDist: 23.5,      // distância do centro (m)
  overheadPitch: 56 * Math.PI / 180,
  yawLimit: 70 * Math.PI / 180,
  pitchMin: -40 * Math.PI / 180,
  pitchMax: 18 * Math.PI / 180,
};

export const ANIM = {
  slide: 0.6,
  slideShort: 0.45,
  shake: 0.5,
  sink: 0.8,
  approach: 0.7,
  fall: 1.0,
  promote: 0.6,
};

// Níveis de dificuldade. skill/depth para o Stockfish; aiDepth/randomness para a IA interna.
export const DIFFICULTY = [
  { level: 1, name: 'Iniciante', skill: 0, depth: 1, movetime: 200, aiDepth: 1, randomness: 0.6 },
  { level: 2, name: 'Fácil', skill: 3, depth: 4, movetime: 400, aiDepth: 2, randomness: 0.3 },
  { level: 3, name: 'Médio', skill: 8, depth: 8, movetime: 800, aiDepth: 2, randomness: 0.1 },
  { level: 4, name: 'Difícil', skill: 14, depth: 12, movetime: 1500, aiDepth: 3, randomness: 0 },
  { level: 5, name: 'Mestre', skill: 20, depth: 18, movetime: 3000, aiDepth: 3, randomness: 0 },
];

export const ANALYSIS = { multipv: 3, depth: 12, movetime: 900 };

// Candidatos de Stockfish no CDN, em ordem de preferência. Todos single-thread (sem SharedArrayBuffer).
// O build 17.1 lê o caminho do .wasm pelo hash da URL do worker (#<wasm codificado>).
export const STOCKFISH_CANDIDATES = [
  {
    name: 'Stockfish 17.1 (lite)',
    js: 'https://cdn.jsdelivr.net/npm/stockfish@17.1.0/src/stockfish-17.1-lite-single-03e3232.js',
    wasm: 'https://cdn.jsdelivr.net/npm/stockfish@17.1.0/src/stockfish-17.1-lite-single-03e3232.wasm',
    timeout: 25000,
  },
  {
    name: 'Stockfish 10 (asm.js)',
    js: 'https://cdn.jsdelivr.net/npm/stockfish@10.0.2/src/stockfish.asm.js',
    wasm: null,
    timeout: 20000,
  },
];

export const QUALITY = {
  alta: { shadows: true, shadowMap: 2048, pixelRatio: 2, trees: 60 },
  baixa: { shadows: false, shadowMap: 1024, pixelRatio: 1.5, trees: 24 },
};

export const STORE_PREFIX = 'xadrez-';
