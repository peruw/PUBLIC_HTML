// Configuração do Xadrez em Primeira Pessoa. Somente leitura para os módulos.

export const SQUARE = 2;            // lado de uma casa (m)
export const BOARD_HALF = SQUARE * 4; // 8 m

export const COLORS = {
  sky: 0xbfd8ee,
  fog: 0xd6e4f0,
  grass: 0x5f8f4a,
  grassDark: 0x4d7a3b,
  lightSquare: 0xa9d18e,
  darkSquare: 0x2f6b3a,
  frame: 0x2b2118,
  brand: 0x173d24,       // fundo das placas e letreiros da Quanta
  brandText: '#f4f1e6',
  brandAccent: '#ffd54a',
  whitePiece: 0xf1ebe0,
  blackPiece: 0x2a2624,
  wall: 0xb8b0a2,
  trunk: 0x6b4a2e,
  leaves: 0x3f7a3a,
  leaves2: 0x568f45,
  selected: 0xffd54a,
  target: 0x64c8ff,
  capture: 0xff6b5a,
  lastMove: 0xfff1b0,
  check: 0xff3b3b,
  dust: 0xcfc6b8,
};

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
  alta: { shadows: true, shadowMap: 2048, pixelRatio: 2, trees: 60, realTrees: 34 },
  baixa: { shadows: false, shadowMap: 1024, pixelRatio: 1.5, trees: 24, realTrees: 12 },
};

export const STORE_PREFIX = 'xadrez-';
