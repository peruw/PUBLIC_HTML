// Xadrez em Primeira Pessoa: ponto de entrada. Renderer, loop, máquina de estados e integração.
import * as THREE from './three.js';
import { QUALITY, CAMERA } from './config.js';
import {
  createGame, generateLegalMoves, makeMove, undoMove, gameStatus, toSAN, toFEN, uciToMove,
  kingSquare, inCheck, PIECE_LETTERS, cloneState,
} from './rules.js';
import { Engine } from './engine.js';
import { buildBoard } from './board3d.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Animator } from './animations.js';
import { Hud } from './hud.js';
import { Menu } from './menu.js';

const isCoarse = matchMedia('(pointer: coarse)').matches;
const quality = isCoarse || Math.min(innerWidth, innerHeight) < 700 ? QUALITY.baixa : QUALITY.alta;

// ---------- Renderer e cena ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.pixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !!quality.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = 'none';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA.overheadFov, innerWidth / innerHeight, 0.1, 400);
const board = buildBoard(scene, quality);
const rig = new CameraRig(camera);
const animator = new Animator({ scene, board, rig });

// ---------- Estado do jogo ----------
function flyOverhead(side) {
  board.setLabelSide(side);
  return rig.flyToOverhead(side);
}

const G = {
  status: 'loading',   // loading | menu | playing | animating | thinking | gameover
  opts: null,
  game: null,
  humanColor: 'w',
  view: 'overhead',
  selected: -1,
  legal: [],
  sans: [],
  lastMove: null,
  cancelAnalysis: null,
  pendingCpu: null,
  dirty: true,
};

const engine = new Engine({ onStatus: (text, st) => { hud.setEngineStatus(text, st); menu.setLoading(text); } });

const hud = new Hud({
  onUndo: () => undo(),
  onRestart: () => restart(),
  onToggleView: () => toggleView(),
  onMenu: () => { if (G.status === 'playing' || G.status === 'thinking') { menu.show('pause'); } },
  onFlip: () => { if (G.view === 'overhead' && !rig.busy) { rig.side = rig.side === 'w' ? 'b' : 'w'; flyOverhead(rig.side); } },
});

const menu = new Menu({
  onStart: (opts) => startGame(opts),
  onResume: () => {},
  onRestart: () => restart(),
  onQuit: () => quitToMenu(),
});

const input = new Input({
  dom: renderer.domElement,
  camera,
  getPickables: () => board.pickables(),
  getIgnored: () => (G.view === 'firstperson' && G.selected >= 0 ? board.pieceAt(G.selected) : null),
  onTap: (hit) => onTap(hit),
  onLook: (dy, dp) => { rig.look(dy, dp); G.dirty = true; },
  onEscape: () => { if (G.view === 'firstperson' && G.status === 'playing') leaveFirstPerson(); },
});

// ---------- Fluxo ----------
function isHumanTurn() {
  if (!G.game) return false;
  if (G.opts.mode === '2p') return true;
  return G.game.turn === G.humanColor;
}

function playerSide() {
  if (G.opts.mode === '2p') return G.opts.rotate ? G.game.turn : 'w';
  return G.humanColor;
}

async function startGame(opts) {
  G.opts = opts;
  G.humanColor = opts.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : (opts.color || 'w');
  G.game = createGame();
  G.sans = [];
  G.lastMove = null;
  G.selected = -1;
  G.legal = [];
  animator.clear();
  board.setPosition(G.game);
  refreshHighlights();
  hud.resetEval();
  hud.setHistory([]);
  hud.setLines([]);
  hud.setEval({ cp: 0, mateIn: null });
  hud.show(true);
  engine.setLevel(opts.level);
  G.view = 'overhead';
  hud.setView('overhead');
  G.status = 'animating';
  await flyOverhead(playerSide());
  G.status = 'playing';
  G.dirty = true;
  updateTurnUi();
  if (!isHumanTurn()) computerTurn();
  else startAnalysis();
}

function restart() {
  if (!G.opts) return;
  engine.stop();
  if (G.cancelAnalysis) { G.cancelAnalysis(); G.cancelAnalysis = null; }
  startGame(G.opts);
}

function quitToMenu() {
  engine.stop();
  if (G.cancelAnalysis) { G.cancelAnalysis(); G.cancelAnalysis = null; }
  animator.clear();
  G.status = 'menu';
  hud.show(false);
  flyOverhead('w');
}

function updateTurnUi() {
  const check = inCheck(G.game);
  hud.setTurn(G.game.turn, check);
  hud.setUndoEnabled(G.game.history.length > 0);
  if (G.status === 'playing') {
    if (!isHumanTurn()) hud.showHint('Computador pensando…');
    else if (G.view === 'firstperson') hud.showHint('Toque numa casa azul para mover · Esc volta à vista de cima');
    else hud.showHint('Toque numa peça para ver pelos olhos dela');
  }
}

function refreshHighlights() {
  const check = inCheck(G.game) ? kingSquare(G.game.board, G.game.turn) : -1;
  board.highlight({
    selected: G.selected,
    targets: G.legal.filter((m) => !m.captured).map((m) => m.to),
    captures: G.legal.filter((m) => m.captured).map((m) => m.to),
    lastMove: G.lastMove,
    check,
  });
  G.dirty = true;
}

async function onTap({ sq, piece }) {
  if (G.status !== 'playing' || !isHumanTurn() || rig.busy || animator.busy) return;
  const g = G.game;
  const own = piece && piece.userData.color === g.turn;
  if (own) {
    if (sq === G.selected && G.view === 'firstperson') return;
    await selectPiece(sq, piece);
    return;
  }
  if (G.selected >= 0 && sq >= 0) {
    const cands = G.legal.filter((m) => m.to === sq);
    if (cands.length) {
      let move = cands[0];
      if (cands.length > 1 && cands[0].promotion) {
        const letter = await menu.askPromotion(g.turn);
        move = cands.find((m) => PIECE_LETTERS[m.promotion] === letter) || cands[0];
      }
      await humanMove(move);
      return;
    }
  }
  // Toque fora: limpa seleção (e sai da 1ª pessoa)
  if (G.selected >= 0) {
    G.selected = -1; G.legal = [];
    refreshHighlights();
    if (G.view === 'firstperson') leaveFirstPerson();
  }
}

async function selectPiece(sq, piece) {
  G.selected = sq;
  G.legal = generateLegalMoves(G.game, sq);
  refreshHighlights();
  G.status = 'animating';
  G.view = 'firstperson';
  hud.setView('firstperson');
  hud.showHint('Voando para a peça…');
  await rig.flyToPiece(piece.userData.char);
  G.status = 'playing';
  updateTurnUi();
}

async function leaveFirstPerson() {
  if (rig.busy) return;
  G.view = 'overhead';
  hud.setView('overhead');
  G.status = 'animating';
  await flyOverhead(playerSide());
  if (G.status === 'animating') G.status = 'playing';
  updateTurnUi();
}

function toggleView() {
  if (G.status !== 'playing' || rig.busy) return;
  if (G.view === 'firstperson') { leaveFirstPerson(); return; }
  // Sem peça selecionada: voa para o rei de quem joga
  const ks = kingSquare(G.game.board, G.game.turn);
  const g = board.pieceAt(ks);
  if (g && isHumanTurn()) selectPiece(ks, g);
}

async function humanMove(move) {
  const firstPerson = G.view === 'firstperson';
  const wasCpuMode = G.opts.mode === 'cpu';
  applyMoveToState(move);
  G.selected = -1; G.legal = [];
  refreshHighlights();
  G.status = 'animating';
  hud.showHint(firstPerson ? '' : '');
  // Em modo computador, já começa a pensar durante a animação
  if (wasCpuMode && !gameStatus(G.game).over) G.pendingCpu = engine.bestMove(toFEN(G.game));
  await animator.playMove(move, { firstPerson });
  refreshHighlights();
  if (firstPerson) {
    G.view = 'overhead';
    hud.setView('overhead');
    await flyOverhead(playerSide());
  } else if (G.opts.mode === '2p' && G.opts.rotate) {
    await flyOverhead(playerSide());
  }
  G.status = 'playing';
  if (await checkGameOver()) return;
  updateTurnUi();
  if (!isHumanTurn()) computerTurn();
  else startAnalysis();
}

function applyMoveToState(move) {
  const san = toSAN(G.game, move);
  makeMove(G.game, move);
  G.sans.push(san);
  G.lastMove = { from: move.from, to: move.to };
  hud.setHistory(G.sans);
  if (G.cancelAnalysis) { G.cancelAnalysis(); G.cancelAnalysis = null; }
}

async function computerTurn() {
  if (G.status !== 'playing' || isHumanTurn()) return;
  G.status = 'thinking';
  hud.showHint('Computador pensando…');
  hud.setLines([]);
  const gen = G.game.history.length;
  const req = G.pendingCpu || engine.bestMove(toFEN(G.game));
  G.pendingCpu = null;
  let res;
  try { res = await req; } catch (err) { console.warn('[xadrez] motor falhou', err); res = { uci: null }; }
  if (G.status !== 'thinking' || G.game.history.length !== gen || res.stale) return;
  let move = res.uci ? uciToMove(G.game, res.uci) : null;
  if (!move) {
    const legal = generateLegalMoves(G.game);
    move = legal[Math.floor(Math.random() * legal.length)];
  }
  if (!move) { G.status = 'playing'; await checkGameOver(); return; }
  const ply = G.game.history.length;
  if (res.scoreCp != null) { hud.pushEval(ply, res.scoreCp); hud.setEval({ cp: res.scoreCp, mateIn: null }); }
  applyMoveToState(move);
  refreshHighlights();
  G.status = 'animating';
  await animator.playMove(move, { firstPerson: false });
  refreshHighlights();
  G.status = 'playing';
  if (await checkGameOver()) return;
  updateTurnUi();
  startAnalysis();
}

function startAnalysis() {
  if (!G.game || G.status !== 'playing') return;
  const fen = toFEN(G.game);
  const ply = G.game.history.length;
  const snapshot = cloneState(G.game);
  if (G.cancelAnalysis) G.cancelAnalysis();
  G.cancelAnalysis = engine.analyze(fen, (upd) => {
    if (!G.game || G.game.history.length !== ply) return;
    hud.setEval({ cp: upd.scoreCp, mateIn: upd.mateIn });
    if (upd.lines && upd.lines.length) {
      hud.setLines(upd.lines.map((l) => {
        const m = l.uci ? uciToMove(snapshot, l.uci) : null;
        return { ...l, san: m ? toSAN(snapshot, m) : l.uci };
      }));
    } else if (upd.done) hud.setLines([]);
    if (upd.done) { hud.pushEval(ply, upd.scoreCp); G.cancelAnalysis = null; }
  });
}

async function checkGameOver() {
  const st = gameStatus(G.game);
  if (!st.over) return false;
  G.status = 'gameover';
  if (G.cancelAnalysis) { G.cancelAnalysis(); G.cancelAnalysis = null; }
  hud.showHint('');
  let title, detail;
  if (st.reason === 'xeque-mate') {
    const winner = st.result === '1-0' ? 'Brancas' : 'Pretas';
    const loserColor = st.result === '1-0' ? 'b' : 'w';
    title = `Xeque-mate! ${winner} vencem`;
    if (G.opts.mode === 'cpu') title = (st.result === '1-0') === (G.humanColor === 'w') ? 'Xeque-mate! Você venceu' : 'Xeque-mate! O computador venceu';
    detail = `${G.sans.length} meias-jogadas · ${st.result}`;
    hud.setEval({ cp: st.result === '1-0' ? 100000 : -100000, mateIn: null });
    hud.pushEval(G.game.history.length, st.result === '1-0' ? 10000 : -10000);
    const king = board.pieceAt(kingSquare(G.game.board, loserColor));
    await animator.kingFall(king);
  } else {
    title = 'Empate';
    detail = st.reason.charAt(0).toUpperCase() + st.reason.slice(1);
    hud.pushEval(G.game.history.length, 0);
  }
  hud.setTurn(G.game.turn, st.check);
  setTimeout(() => menu.showGameOver({ title, detail }), 600);
  return true;
}

async function undo() {
  if (!G.game || !G.game.history.length) return;
  if (!(G.status === 'playing' || G.status === 'thinking' || G.status === 'gameover')) return;
  engine.stop();
  G.pendingCpu = null;
  if (G.cancelAnalysis) { G.cancelAnalysis(); G.cancelAnalysis = null; }
  animator.clear();
  let n = 1;
  if (G.opts.mode === 'cpu') n = G.game.turn === G.humanColor ? 2 : 1;
  n = Math.min(n, G.game.history.length);
  for (let i = 0; i < n; i++) { undoMove(G.game); G.sans.pop(); }
  const h = G.game.history;
  G.lastMove = h.length ? { from: h[h.length - 1].move.from, to: h[h.length - 1].move.to } : null;
  G.selected = -1; G.legal = [];
  board.setPosition(G.game);
  hud.setHistory(G.sans);
  hud.truncateEval(G.game.history.length);
  hud.setLines([]);
  refreshHighlights();
  G.status = 'animating';
  G.view = 'overhead';
  hud.setView('overhead');
  await flyOverhead(playerSide());
  G.status = 'playing';
  updateTurnUi();
  if (!isHumanTurn()) computerTurn(); else startAnalysis();
}

// ---------- Loop ----------
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, clock.getDelta());
  let changed = animator.update(dt);
  if (rig.update(dt)) changed = true;
  board.update(dt);
  if (changed || G.dirty) {
    renderer.render(scene, camera);
    G.dirty = false;
  }
}

function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  rig.onResize(innerWidth, innerHeight);
  G.dirty = true;
  hud.drawGraph();
}
addEventListener('resize', onResize);

// ---------- Inicialização ----------
async function boot() {
  menu.show('loading');
  board.setPosition(createGame());
  hud.setView('overhead');
  frame();
  try {
    await engine.init({ timeoutMs: 20000 });
  } catch (err) {
    console.error(err);
  }
  G.status = 'menu';
  menu.show('title');
}
boot();

window.__xadrez = {
  get state() { return G; }, engine, board, rig, animator, input,
  fen: () => toFEN(G.game),
  play: (uci) => { const m = uciToMove(G.game, uci); if (m && isHumanTurn()) humanMove(m); return !!m; },
};
