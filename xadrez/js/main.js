// Xadrez em Primeira Pessoa: ponto de entrada. Renderer, loop, máquina de estados e integração.
import * as THREE from './three.js';
import { QUALITY, CAMERA } from './config.js';
import {
  createGame, generateLegalMoves, makeMove, undoMove, gameStatus, toSAN, toFEN, uciToMove,
  kingSquare, inCheck, PIECE_LETTERS, cloneState, moveToUCI,
} from './rules.js';
import { Engine } from './engine.js';
import { buildBoard } from './board3d.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Animator } from './animations.js';
import { Hud } from './hud.js';
import { Menu } from './menu.js';
import { createIdle } from './battle.js';
import { setStyle, getStyle } from './skins.js';
import { openRoom, newRoomCode, normalizeCode } from './net.js';

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
  view: 'overhead',    // 'roam' (campo de batalha) | 'firstperson' | 'overhead'
  viewPref: 'roam',    // vista de repouso preferida: 'roam' | 'overhead'
  selected: -1,
  legal: [],
  sans: [],
  lastMove: null,
  cancelAnalysis: null,
  pendingCpu: null,
  dirty: true,
  gen: 0,              // muda a cada partida nova / desfazer / desistência: fluxos antigos param ao ver a troca
  over: null,          // { title, detail } da partida encerrada (☰ reabre)
  overTimer: 0,
};
// O fluxo assíncrono (animações, voo da câmera, motor) que começou na geração `gen` ainda vale?
const alive = (gen) => gen === G.gen;

const engine = new Engine({ onStatus: (text, st) => hud.setEngineStatus(text, st) });

const hud = new Hud({
  onUndo: () => undo(),
  onRestart: () => askRestart(),
  onToggleView: () => toggleView(),
  onTogglePerson: () => togglePerson(),
  onMenu: () => {
    if (G.status === 'gameover') { if (G.over) menu.showGameOver(G.over); return; }
    if (G.status === 'playing' || G.status === 'thinking' || G.status === 'animating') menu.show('pause');
  },
  onFlip: () => { if (G.view !== 'firstperson' && !rig.busy) { rig.side = rig.side === 'w' ? 'b' : 'w'; if (G.view === 'overhead') flyOverhead(rig.side); else rig.roam(rig.side); } },
  onMiniTap: (sq) => onTap({ sq, piece: board.pieceAt(sq) }),
});

const menu = new Menu({
  onStart: (opts) => startGame(opts),
  onResume: () => {},
  onRestart: () => restart(),
  onQuit: () => quitToMenu(),
  onResign: () => resign(),
  onOnlineCreate: (color) => onlineCreate(color),
  onOnlineJoin: (code) => onlineJoin(code),
  onOnlineCancel: () => onlineClose(),
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

// Vista de repouso (sem peça escolhida): passeio no campo ou vista de cima, conforme a preferência.
function idleView(side = playerSide()) {
  G.view = G.viewPref;
  hud.setView(G.view);
  board.setLabelSide(side);
  return G.viewPref === 'overhead' ? flyOverhead(side) : rig.roam(side);
}

async function startGame(opts) {
  const gen = ++G.gen;
  engine.stop();
  if (G.cancelAnalysis) { G.cancelAnalysis(); G.cancelAnalysis = null; }
  G.pendingCpu = null;            // resposta do computador pedida na partida anterior não vale aqui
  clearTimeout(G.overTimer);
  G.over = null;
  G.resigned = false;
  G.opts = opts;
  G.humanColor = opts.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : (opts.color || 'w');
  G.game = createGame();
  G.sans = [];
  for (const uci of opts.moves || []) {           // online: retoma uma partida em andamento
    const m = uciToMove(G.game, uci);
    if (!m) break;
    G.sans.push(toSAN(G.game, m));
    makeMove(G.game, m);
  }
  { const h = G.game.history; G.lastMove = h.length ? { from: h[h.length - 1].move.from, to: h[h.length - 1].move.to } : null; }
  G.selected = -1;
  G.legal = [];
  animator.clear();
  G.status = 'loading';
  if ((opts.style || 'classic') !== getStyle()) {
    menu.show('loading');
    menu.setLoading('Carregando personagens…');
    const ok = await setStyle(opts.style);
    if (!alive(gen)) return;
    if (!ok) hud.showHint('Não deu para carregar o desenho animado; usando os clássicos.');
    menu.hide();
  }
  // A abertura não espera o Stockfish; só a partida contra o computador precisa dele pronto.
  if (opts.mode === 'cpu' && !engine.ready) {
    menu.show('loading');
    menu.setLoading('Carregando o computador (Stockfish)…');
    await engine.whenReady;
    if (!alive(gen)) return;
    menu.hide();
  }
  board.setPosition(G.game);
  refreshHighlights();
  hud.resetEval();
  hud.setHistory(G.sans);
  hud.setLines([]);
  hud.setEval({ cp: 0, mateIn: null });
  hud.setAnalysisVisible(opts.mode !== 'online');
  hud.show(true);
  engine.setLevel(opts.level);
  G.status = 'animating';
  await idleView();
  if (!alive(gen)) return;
  G.status = 'playing';
  G.dirty = true;
  updateTurnUi();
  if (G.opts.mode === 'online') { if (await checkGameOver()) return; flushRemote(); return; }
  if (!isHumanTurn()) computerTurn();
  else startAnalysis();
}

function restart() {
  if (!G.opts) return;
  if (G.opts.mode === 'online') { onlineRematch(); return; }
  startGame(G.opts);
}

// Botão ↻ do HUD: no meio de uma partida, pergunta antes (um toque sem querer perdia o jogo).
async function askRestart() {
  if (!G.opts || !G.game || G.status === 'menu' || G.status === 'loading') return;
  const inProgress = G.status !== 'gameover' && G.game.history.length > 0;
  if (G.opts.mode === 'online') {
    if (inProgress && !(await menu.confirm({ title: 'Pedir revanche?', text: 'Se o seu amigo aceitar, esta partida acaba e começa outra com as cores trocadas.', yes: 'Pedir revanche', no: 'Continuar' }))) return;
    onlineRematch();
    return;
  }
  if (inProgress && !(await menu.confirm({ title: 'Reiniciar a partida?', text: 'A partida atual será perdida.', yes: 'Reiniciar', no: 'Continuar jogando' }))) return;
  restart();
}

function quitToMenu() {
  if (G.opts && G.opts.mode === 'online') onlineClose();
  G.gen++;
  clearTimeout(G.overTimer);
  engine.stop();
  G.pendingCpu = null;
  if (G.cancelAnalysis) { G.cancelAnalysis(); G.cancelAnalysis = null; }
  animator.clear();
  G.status = 'menu';
  hud.show(false);
  flyOverhead('w');
}

const youColor = () => (G.opts && G.opts.mode !== '2p' ? G.humanColor : null);

function updateTurnUi() {
  const check = inCheck(G.game);
  hud.setTurn(G.game.turn, check, youColor());
  hud.setUndoEnabled(G.opts.mode !== 'online' && G.game.history.length > 0);
  if (G.status === 'playing') {
    if (G.opts.mode === 'online' && NET.peers === 0) hud.showHint('Seu amigo desconectou… esperando ele voltar.');
    else if (G.opts.mode === 'online' && !isHumanTurn()) hud.showHint('Vez do seu amigo…');
    else if (!isHumanTurn()) hud.showHint('Computador pensando…');
    else if (G.view === 'firstperson') hud.showHint(isCoarse ? 'Toque numa casa azul para mover · toque fora cancela' : 'Clique numa casa azul para mover · Esc cancela');
    else hud.showHint('Toque numa peça sua no tabuleiro pequeno');
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
  hud.mini.set({
    board: G.game.board,
    hl: { selected: G.selected, targets: G.legal.filter((m) => !m.captured).map((m) => m.to), captures: G.legal.filter((m) => m.captured).map((m) => m.to), lastMove: G.lastMove, check },
    side: playerSide(),
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
        const gen = G.gen;
        const letter = await menu.askPromotion(g.turn);
        if (!alive(gen) || G.status !== 'playing' || !isHumanTurn()) return;
        if (!letter) return; // cancelou: continua com a peça escolhida
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
  const gen = G.gen;
  G.selected = sq;
  G.legal = generateLegalMoves(G.game, sq);
  refreshHighlights();
  G.status = 'animating';
  G.view = 'firstperson';
  hud.setView('firstperson');
  hud.showHint('Voando para a peça…');
  await rig.flyToPiece(piece.userData.char);
  if (!alive(gen)) return;
  G.status = 'playing';
  updateTurnUi();
  if (G.opts.mode === 'online') flushRemote();
}

async function leaveFirstPerson() {
  if (rig.busy) return;
  const gen = G.gen;
  G.selected = -1; G.legal = [];
  refreshHighlights();
  G.status = 'animating';
  await idleView();
  if (!alive(gen)) return;
  if (G.status === 'animating') G.status = 'playing';
  updateTurnUi();
  if (G.opts.mode === 'online') flushRemote();
}

// Alterna a vista de repouso entre campo de batalha e vista de cima
// 1ª ou 3ª pessoa ao seguir o personagem escolhido; a preferência fica salva neste aparelho.
const PERSON_KEY = 'xadrez_person';
function loadPerson() { try { return localStorage.getItem(PERSON_KEY) === 'third' ? 'third' : 'first'; } catch { return 'first'; } }
function togglePerson() {
  const p = rig.person === 'third' ? 'first' : 'third';
  rig.setPerson(p);
  hud.setPerson(p);
  try { localStorage.setItem(PERSON_KEY, p); } catch { /* sem armazenamento: vale só nesta sessão */ }
}
rig.setPerson(loadPerson());
hud.setPerson(rig.person);
window.addEventListener('keydown', (e) => {
  if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea')) togglePerson();
});

function toggleView() {
  if (G.status !== 'playing' || rig.busy) return;
  G.viewPref = G.viewPref === 'overhead' ? 'roam' : 'overhead';
  leaveFirstPerson();
}

async function humanMove(move) {
  const gen = G.gen;
  const firstPerson = G.view === 'firstperson';
  const wasCpuMode = G.opts.mode === 'cpu';
  if (G.opts.mode === 'online') sendMove(G.game.history.length, moveToUCI(move));
  applyMoveToState(move);
  G.selected = -1; G.legal = [];
  refreshHighlights();
  G.status = 'animating';
  hud.showHint('');
  // Em modo computador, já começa a pensar durante a animação
  if (wasCpuMode && !gameStatus(G.game).over) G.pendingCpu = engine.bestMove(toFEN(G.game));
  await animator.playMove(move, { firstPerson });
  if (!alive(gen)) return;
  refreshHighlights();
  await idleView();
  if (!alive(gen)) return;
  G.status = 'playing';
  if (await checkGameOver()) return;
  updateTurnUi();
  if (G.opts.mode === 'online') { flushRemote(); return; }
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
  if (G.opts.mode === 'online') saveSession();
}

async function computerTurn() {
  if (G.opts.mode === 'online' || G.status !== 'playing' || isHumanTurn()) return;
  const gen = G.gen;
  G.status = 'thinking';
  hud.showHint('Computador pensando…');
  hud.setLines([]);
  const ply0 = G.game.history.length;
  const req = G.pendingCpu || engine.bestMove(toFEN(G.game));
  G.pendingCpu = null;
  let res;
  try { res = await req; } catch (err) { console.warn('[xadrez] motor falhou', err); res = { uci: null }; }
  if (!alive(gen) || G.status !== 'thinking' || G.game.history.length !== ply0 || res.stale) return;
  let move = res.uci ? uciToMove(G.game, res.uci) : null;
  if (!move) {
    if (res.uci) console.warn('[xadrez] lance do motor inválido nesta posição:', res.uci);
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
  if (!alive(gen)) return;
  refreshHighlights();
  await idleView();
  if (!alive(gen)) return;
  G.status = 'playing';
  if (await checkGameOver()) return;
  updateTurnUi();
  startAnalysis();
}

function startAnalysis() {
  if (!G.game || G.status !== 'playing') return;
  if (G.opts.mode === 'online') { hud.setLines([]); return; } // sem ajuda do motor em partida contra pessoa
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
  const gen = G.gen;
  G.status = 'gameover';
  hud.setUndoEnabled(G.opts.mode !== 'online' && G.game.history.length > 0);
  if (G.cancelAnalysis) { G.cancelAnalysis(); G.cancelAnalysis = null; }
  hud.showHint('');
  let title, detail;
  if (st.reason === 'xeque-mate') {
    const winner = st.result === '1-0' ? 'Brancas' : 'Pretas';
    const loserColor = st.result === '1-0' ? 'b' : 'w';
    title = `Xeque-mate! ${winner} vencem`;
    if (G.opts.mode === 'cpu') title = (st.result === '1-0') === (G.humanColor === 'w') ? 'Xeque-mate! Você venceu' : 'Xeque-mate! O computador venceu';
    if (G.opts.mode === 'online') title = (st.result === '1-0') === (G.humanColor === 'w') ? 'Xeque-mate! Você venceu' : 'Xeque-mate! Seu amigo venceu';
    const n = Math.ceil(G.sans.length / 2);
    detail = `${n} ${n === 1 ? 'lance' : 'lances'} · ${st.result}`;
    hud.setEval({ cp: st.result === '1-0' ? 100000 : -100000, mateIn: null });
    hud.pushEval(G.game.history.length, st.result === '1-0' ? 10000 : -10000);
    const king = board.pieceAt(kingSquare(G.game.board, loserColor));
    await animator.kingFall(king);
    if (!alive(gen)) return true;
  } else {
    title = 'Empate';
    detail = st.reason.charAt(0).toUpperCase() + st.reason.slice(1);
    hud.pushEval(G.game.history.length, 0);
  }
  hud.setTurn(G.game.turn, st.check, youColor());
  showOver({ title, detail }, gen);
  return true;
}

// Mostra o resultado (com um respiro depois da última animação). "Ver tabuleiro" fecha a tela; ☰ reabre.
function showOver(over, gen) {
  G.over = over;
  hud.showHint('Fim de jogo · ☰ mostra o resultado');
  clearTimeout(G.overTimer);
  G.overTimer = setTimeout(() => { if (alive(gen) && G.status === 'gameover') menu.showGameOver(over); }, 600);
}

// Desistir (menu ☰). Contra o computador e online desiste quem está neste aparelho; em 2 jogadores, quem tem a vez.
async function resign() {
  if (!G.game || !G.opts || !(G.status === 'playing' || G.status === 'thinking' || G.status === 'animating')) return;
  const who = G.opts.mode === '2p' ? (G.game.turn === 'w' ? 'As brancas desistem' : 'As pretas desistem') : 'Você desiste';
  const ok = await menu.confirm({ title: 'Desistir da partida?', text: who + ' e a partida acaba.', yes: '🏳 Desistir', no: 'Continuar' });
  if (!ok || !G.game || G.status === 'gameover' || G.status === 'menu') return;
  menu.hide();
  const loser = G.opts.mode === '2p' ? G.game.turn : G.humanColor;
  if (G.opts.mode === 'online') sendResign(loser);
  endByResign(loser, true);
}

async function endByResign(loser, mine) {
  const gen = ++G.gen;           // encerra animações e respostas do motor em andamento
  clearTimeout(G.overTimer);
  engine.stop();
  G.pendingCpu = null;
  if (G.cancelAnalysis) { G.cancelAnalysis(); G.cancelAnalysis = null; }
  animator.clear();
  G.selected = -1; G.legal = [];
  board.setPosition(G.game);      // tabuleiro 3D em dia com a partida (a animação foi interrompida)
  refreshHighlights();
  G.status = 'gameover';
  G.resigned = true;              // desistência não se desfaz
  hud.setUndoEnabled(false);
  if (G.opts.mode === 'online') { NET.resignedBy = loser; NET.queue = []; saveSession(); }
  const result = loser === 'w' ? '0-1' : '1-0';
  const winner = loser === 'w' ? 'Pretas' : 'Brancas';
  let title, detail;
  if (G.opts.mode === 'cpu') { title = 'Você desistiu'; detail = `O computador venceu · ${result}`; }
  else if (G.opts.mode === 'online') {
    title = mine ? 'Você desistiu' : 'Seu amigo desistiu';
    detail = (mine ? 'Seu amigo venceu' : 'Você venceu!') + ` · ${result}`;
  } else { title = `${loser === 'w' ? 'Brancas' : 'Pretas'} desistiram`; detail = `${winner} vencem · ${result}`; }
  hud.setTurn(G.game.turn, inCheck(G.game), youColor());
  await idleView();
  if (!alive(gen)) return;
  await animator.kingFall(board.pieceAt(kingSquare(G.game.board, loser)));
  if (!alive(gen)) return;
  showOver({ title, detail }, gen);
}

async function undo() {
  if (!G.game || !G.game.history.length || G.opts.mode === 'online' || G.resigned) return;
  // também no meio de uma animação: G.gen encerra o fluxo dela e o tabuleiro é refeito abaixo
  if (!(G.status === 'playing' || G.status === 'thinking' || G.status === 'animating' || G.status === 'gameover')) return;
  const gen = ++G.gen;
  clearTimeout(G.overTimer);
  G.over = null;
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
  await idleView();
  if (!alive(gen)) return;
  G.status = 'playing';
  updateTurnUi();
  if (!isHumanTurn()) computerTurn(); else startAnalysis();
}

// ---------- Partida online (código de sala) ----------
// O anfitrião cria a sala e escolhe a cor; o convidado entra com o código. Cada lance vai com o número
// da meia-jogada (ply) e da rodada (r: aumenta a cada revanche) e é reenviado até o outro confirmar (ack).
// Se algo se perder, 'sync?' pede a lista completa de lances ao outro lado. Na dúvida, vale o anfitrião.
// A sala tem dono: o anfitrião só conversa com o convidado fixado (um 3º recebe 'full'), e a sessão fica no
// sessionStorage para a aba voltar à mesma sala se o celular recarregar a página.
const NET = {
  room: null, role: null, code: null, hostColor: 'w', peers: 0, ids: new Set(), started: false, pending: null,
  timers: [], queue: [], peerId: null, round: 0, gotStart: false, rematchAsked: false, rematchOffered: false,
  resignedBy: null, resignTimer: 0, startTimer: 0, tok: 0,
};

const SESSION_KEY = 'xadrez-online';
const SESSION_MAX_MS = 3 * 3600 * 1000;
function saveSession() {
  if (!NET.code) return;
  const inGame = NET.started && G.game && G.opts && G.opts.mode === 'online';
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      code: NET.code, role: NET.role, hostColor: NET.hostColor, peerId: NET.peerId, round: NET.round,
      started: !!inGame, moves: inGame ? movesUci() : [], resignedBy: NET.resignedBy, t: Date.now(),
    }));
  } catch { /* sem armazenamento: só não retoma depois de recarregar */ }
}
function loadSession() {
  try {
    const d = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (d && d.code && Date.now() - d.t < SESSION_MAX_MS) return d;
  } catch { /* ignora */ }
  return null;
}
function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ok */ } }

function netClearTimers() { for (const t of NET.timers) { clearTimeout(t); clearInterval(t); } NET.timers = []; }
function onNetStatus(st) { if (st === 'desconectado' && G.opts && G.opts.mode === 'online') hud.showHint('Conexão perdida… tentando voltar.'); }

// Sai da sala. forget = esquece a sessão salva (o jogador saiu de propósito).
function onlineClose(forget = true) {
  NET.tok++;
  netClearTimers();
  if (NET.pending && NET.pending.timer) clearInterval(NET.pending.timer);
  if (NET.room) { try { NET.room.send({ t: 'bye' }); } catch { /* ok */ } NET.room.close(); }
  Object.assign(NET, {
    room: null, role: null, code: null, peers: 0, ids: new Set(), started: false, pending: null, queue: [],
    peerId: null, round: 0, gotStart: false, rematchAsked: false, rematchOffered: false, resignedBy: null,
  });
  if (forget) clearSession();
}

const roomHandlers = () => ({ onMessage: onNetMessage, onPeers: onNetPeers, onStatus: onNetStatus });

// Cria a sala (ou, com `resume`, volta para a sala salva depois de recarregar a página).
async function onlineCreate(colorPref, resume = null) {
  onlineClose(!resume);
  const tok = NET.tok;
  const code = resume ? resume.code : newRoomCode();
  NET.role = 'host'; NET.code = code;
  NET.hostColor = resume ? resume.hostColor : colorPref === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : (colorPref === 'b' ? 'b' : 'w');
  if (resume) { NET.peerId = resume.peerId || null; NET.round = resume.round || 0; }
  menu.setOnlineStatus(resume ? 'Voltando para a sala ' + code + '…' : 'Criando a sala…');
  let room;
  try {
    room = await openRoom(code, { role: 'host', ...roomHandlers() });
  } catch (e) {
    console.warn('[online]', e);
    if (tok !== NET.tok) return;
    menu.setOnlineStatus('Não foi possível criar a sala. Verifique a internet e tente de novo.', true);
    onlineClose(!resume);
    return;
  }
  if (tok !== NET.tok) { room.close(); return; }   // o jogador desistiu enquanto conectava
  NET.room = room;
  saveSession();
  if (resume && resume.started) { await beginOnline(NET.hostColor, resume.moves || [], resume.resignedBy); return; }
  menu.showOnlineCode(code);
}

async function onlineJoin(rawCode, resume = null) {
  onlineClose(!resume);
  const tok = NET.tok;
  const code = normalizeCode(rawCode);
  NET.role = 'guest'; NET.code = code;
  if (resume) { NET.peerId = resume.peerId || null; NET.hostColor = resume.hostColor || 'w'; NET.round = resume.round || 0; }
  menu.setOnlineStatus((resume ? 'Voltando para a sala ' : 'Conectando à sala ') + code + '…');
  let room;
  try {
    room = await openRoom(code, { role: 'guest', ...roomHandlers() });
  } catch (e) {
    console.warn('[online]', e);
    if (tok !== NET.tok) return;
    menu.setOnlineStatus('Não foi possível conectar. Verifique a internet e tente de novo.', true);
    onlineClose(!resume);
    return;
  }
  if (tok !== NET.tok) { room.close(); return; }
  NET.room = room;
  saveSession();
  // Partida em andamento salva: volta ao tabuleiro já; o anfitrião confirma a posição ao responder o 'join'.
  if (resume && resume.started) await beginOnline(NET.hostColor === 'w' ? 'b' : 'w', resume.moves || [], resume.resignedBy);
  if (tok !== NET.tok) return;
  NET.gotStart = false;
  const ask = () => { if (!NET.gotStart && NET.room) NET.room.send({ t: 'join' }); };
  ask();
  NET.timers.push(setInterval(ask, 1500));
  if (!NET.started) {
    NET.timers.push(setTimeout(() => {
      if (!NET.gotStart && !NET.started) menu.setOnlineStatus('Sala não encontrada. Confira o código ou peça para o seu amigo criar outra.', true);
    }, 12000));
  }
}

// Volta para a sala salva (página recarregada) ou entra pelo convite ?sala=CODIGO.
function onlineBoot() {
  let sala = '';
  try {
    const params = new URLSearchParams(location.search);
    sala = normalizeCode(params.get('sala'));
    if (params.has('sala')) {  // tira o código da URL: recarregar depois não reentra numa sala velha
      params.delete('sala');
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    }
  } catch { /* sem convite */ }
  const saved = loadSession();
  if (saved && (sala.length !== 5 || saved.code === sala)) {
    menu.resetOnline(saved.code);
    menu.show('online');
    if (saved.role === 'host') onlineCreate(null, saved); else onlineJoin(saved.code, saved);
  } else if (sala.length === 5) {
    menu.resetOnline(sala);
    menu.show('online');
    onlineJoin(sala);
  }
}

// Presença: quantos dos "meus" parceiros estão na sala (depois de fixado, só conta o parceiro certo).
function onNetPeers(n, ids = []) {
  const had = NET.peers;
  NET.ids = new Set(ids);
  NET.peers = NET.peerId ? (NET.ids.has(NET.peerId) ? 1 : 0) : n;
  if (!G.opts || G.opts.mode !== 'online' || G.status === 'menu') return;
  if (NET.peers > 0 && had === 0 && NET.started) NET.room.send({ t: 'sync?', r: NET.round });
  if (G.status === 'playing' && had !== NET.peers) updateTurnUi(); // só quando alguém entra/sai (não apaga outras dicas)
}

const movesUci = () => G.game.history.map((h) => moveToUCI(h.move));

async function beginOnline(myColor, moves, resignedBy = null) {
  netClearTimers();
  NET.started = true;
  NET.queue = [];
  if (NET.pending && NET.pending.timer) clearInterval(NET.pending.timer);
  NET.pending = null;
  NET.rematchAsked = false; NET.rematchOffered = false;
  NET.resignedBy = null;
  menu.closeConfirm();
  NET.peers = Math.max(NET.peers, 1);
  menu.hide();
  const gen = G.gen + 1;          // a geração que startGame vai criar
  await startGame({ ...menu.opts, mode: 'online', color: myColor, moves });
  if (!alive(gen)) return;
  saveSession();
  if (resignedBy && G.status !== 'gameover') endByResign(resignedBy, resignedBy === G.humanColor);
  // Retomando uma partida (página recarregada, ressincronização): confere a lista de lances com o outro lado.
  else if (moves.length && NET.room) NET.room.send({ t: 'sync?', r: NET.round });
}

// O parceiro fixado, ou ninguém fixado ainda?
const fromPartner = (m) => !NET.peerId || m.from === NET.peerId;
const sameRound = (m) => m.r === undefined || m.r === NET.round;

function onNetMessage(m) {
  if (m.t !== 'join' && m.t !== 'start' && !fromPartner(m)) return; // 3º na sala: ignorado
  switch (m.t) {
    case 'join': {
      if (NET.role !== 'host') return;
      // Outro aparelho só assume a vaga se o convidado anterior não estiver mais na sala.
      if (NET.peerId && m.from !== NET.peerId && NET.ids.has(NET.peerId)) { NET.room.send({ t: 'full', to: m.from }); return; }
      if (NET.peerId !== m.from) { NET.peerId = m.from; NET.peers = NET.ids.has(m.from) ? 1 : NET.peers; }
      const moves = NET.started && G.game ? movesUci() : [];
      if (!NET.started) beginOnline(NET.hostColor, []);
      NET.room.send({ t: 'start', to: m.from, hostColor: NET.hostColor, moves, r: NET.round, resignedBy: NET.resignedBy });
      saveSession();
      break;
    }
    case 'start': {
      if (NET.role !== 'guest' || (NET.peerId && m.from !== NET.peerId && NET.gotStart)) return;
      NET.peerId = m.from;
      NET.gotStart = true;
      NET.room.send({ t: 'started', r: m.r });
      const fresh = !NET.started || m.r !== NET.round;
      NET.round = m.r || 0;
      NET.hostColor = m.hostColor === 'b' ? 'b' : 'w';
      if (fresh) beginOnline(NET.hostColor === 'w' ? 'b' : 'w', m.moves || [], m.resignedBy);
      else if (!m.restart) {          // (reenvio de uma revanche já começada: só confirma)
        syncTo(m.moves || [], true);
        if (m.resignedBy && G.status !== 'gameover') endByResign(m.resignedBy, m.resignedBy === G.humanColor);
      }
      saveSession();
      break;
    }
    case 'started':
      if (NET.role === 'host' && m.r === NET.round) clearInterval(NET.startTimer);
      break;
    case 'full':
      if (NET.role !== 'guest' || NET.started) return;
      menu.setOnlineStatus('Essa sala já tem dois jogadores. Peça um código novo ao seu amigo.', true);
      onlineClose();
      break;
    case 'move': if (sameRound(m)) onRemoteMove(m.ply, m.uci); break;
    case 'ack':
      if (sameRound(m) && NET.pending && m.ply === NET.pending.ply) { clearInterval(NET.pending.timer); NET.pending = null; }
      break;
    case 'sync?':
      if (G.game && NET.started && sameRound(m)) NET.room.send({ t: 'state', moves: movesUci(), r: NET.round, resignedBy: NET.resignedBy });
      break;
    case 'state':
      if (!sameRound(m)) return;
      syncTo(m.moves || [], NET.role === 'guest');
      if (m.resignedBy && G.status !== 'gameover') endByResign(m.resignedBy, m.resignedBy === G.humanColor);
      break;
    case 'rematch?': onRematchAsked(); break;
    case 'rematch-ok': if (NET.role === 'host' && NET.rematchAsked) hostRematch(); break;
    case 'rematch-no':
      if (!NET.rematchAsked) return;
      NET.rematchAsked = false;
      hud.showHint('Seu amigo preferiu não começar outra agora.');
      break;
    case 'resign':
      NET.room.send({ t: 'resign-ok', r: m.r });
      if (sameRound(m) && G.opts && G.opts.mode === 'online' && G.status !== 'gameover') endByResign(m.color, false);
      break;
    case 'resign-ok': clearInterval(NET.resignTimer); break;
    case 'bye':
      NET.peers = 0;
      if (G.opts && G.opts.mode === 'online' && G.status !== 'menu') hud.showHint('Seu amigo saiu da partida.');
      break;
    default: break;
  }
}

function sendMove(ply, uci) {
  if (!NET.room) return;
  if (NET.pending && NET.pending.timer) clearInterval(NET.pending.timer);
  const msg = { t: 'move', ply, uci, r: NET.round };
  NET.room.send(msg);
  NET.pending = { ply, uci, timer: setInterval(() => NET.room && NET.room.send(msg), 2500) };
}

function sendResign(color) {
  if (!NET.room) return;
  let n = 0;
  const msg = { t: 'resign', color, r: NET.round };
  clearInterval(NET.resignTimer);
  const send = () => { if (!NET.room || ++n > 12) { clearInterval(NET.resignTimer); return; } NET.room.send(msg); };
  send();
  NET.resignTimer = setInterval(send, 2000);
  NET.timers.push(NET.resignTimer);
}

function onRemoteMove(ply, uci) {
  if (NET.room) NET.room.send({ t: 'ack', ply, r: NET.round });
  if (!G.game || !NET.started) return;
  const n = G.game.history.length;
  if (ply < n) return;                                   // repetido
  if (ply > n) { NET.room.send({ t: 'sync?', r: NET.round }); return; } // perdemos algum lance
  if (NET.queue.some((q) => q.ply === ply)) return;
  NET.queue.push({ ply, uci });
  flushRemote();
}

async function flushRemote() {
  if (G.status !== 'playing' || !NET.queue.length || animator.busy) return;
  const gen = G.gen;
  const { ply, uci } = NET.queue.shift();
  if (!G.game || ply !== G.game.history.length || isHumanTurn()) { flushRemote(); return; }
  const move = uciToMove(G.game, uci);
  if (!move) { NET.room.send({ t: 'sync?', r: NET.round }); return; }
  if (G.selected >= 0) { G.selected = -1; G.legal = []; }
  applyMoveToState(move);
  refreshHighlights();
  G.status = 'animating';
  await animator.playMove(move, { firstPerson: false });
  if (!alive(gen)) return;
  refreshHighlights();
  await idleView();
  if (!alive(gen)) return;
  G.status = 'playing';
  if (await checkGameOver()) return;
  updateTurnUi();
  flushRemote();
}

// Alinha a partida local com a lista de lances do outro lado.
async function syncTo(moves, authoritative) {
  if (!G.game || !NET.started) return;
  const local = movesUci();
  // Meu último lance ainda não confirmado não está na lista do outro: reenvia em vez de desfazê-lo.
  if (NET.pending && local.length === moves.length + 1 && NET.pending.ply === moves.length && moves.every((u, i) => local[i] === u)) {
    NET.room.send({ t: 'move', ply: NET.pending.ply, uci: local[local.length - 1], r: NET.round });
    return;
  }
  const prefix = local.every((u, i) => moves[i] === u);
  if (prefix && moves.length === local.length) return;
  if (prefix && moves.length === local.length + 1) { onRemoteMove(local.length, moves[local.length]); return; }
  if ((prefix && moves.length > local.length) || authoritative) {
    await beginOnline(G.humanColor, moves);             // refaz a posição do outro lado (sem animação)
    return;
  }
  if (moves.every((u, i) => local[i] === u)) NET.room.send({ t: 'state', moves: local, r: NET.round }); // o outro está atrasado
}

// Revanche: quem pede manda 'rematch?'; o outro aceita ('rematch-ok') ou recusa ('rematch-no').
// Se os dois pedirem, vale na hora. Quem executa é sempre o anfitrião (troca as cores e abre nova rodada).
function onlineRematch() {
  if (!NET.room) return;
  if (NET.rematchOffered) { acceptRematch(); return; }
  NET.rematchAsked = true;
  NET.room.send({ t: 'rematch?' });
  hud.showHint('Pedido de revanche enviado. Esperando o seu amigo…');
}
async function onRematchAsked() {
  if (!G.opts || G.opts.mode !== 'online') return;
  if (NET.rematchAsked) { acceptRematch(); return; }
  if (NET.rematchOffered) return;
  NET.rematchOffered = true;
  const ok = await menu.confirm({
    title: 'Revanche?', text: 'Seu amigo quer começar outra partida, com as cores trocadas.', yes: 'Aceitar', no: 'Agora não',
  });
  if (!NET.room || !NET.rematchOffered) return;     // já resolvido (os dois pediram) ou saiu da sala
  if (ok) acceptRematch();
  else { NET.rematchOffered = false; NET.room.send({ t: 'rematch-no' }); }
}
function acceptRematch() {
  NET.rematchOffered = false;
  menu.closeConfirm();
  if (NET.role === 'host') hostRematch();
  else { NET.room.send({ t: 'rematch-ok' }); hud.showHint('Começando a revanche…'); }
}
function hostRematch() {
  NET.hostColor = NET.hostColor === 'w' ? 'b' : 'w'; // revanche: trocam de cor
  NET.round++;
  const r = NET.round, hostColor = NET.hostColor;
  beginOnline(hostColor, []);                        // (limpa os timers antes do primeiro await)
  // Reenvia até o convidado confirmar ('started'): sem isso, um 'start' perdido deixaria cada um numa partida.
  let n = 0;
  const send = () => { if (!NET.room || ++n > 30) { clearInterval(NET.startTimer); return; } NET.room.send({ t: 'start', to: NET.peerId || undefined, hostColor, moves: [], restart: true, r }); };
  send();
  NET.startTimer = setInterval(send, 2000);
  NET.timers.push(NET.startTimer);
}

// Em 3ª pessoa, esconde as peças entre a câmera e o personagem seguido (ou coladas na câmera),
// como nos jogos de ação, para ele nunca ficar tapado.
const hiddenByCam = new Set();
function blocksView(g) {
  const f = rig.follow.group.position, cx = camera.position.x, cz = camera.position.z;
  const dx = f.x - cx, dz = f.z - cz, len2 = dx * dx + dz * dz;
  const px = g.position.x - cx, pz = g.position.z - cz;
  if (px * px + pz * pz < 1.7 * 1.7) return true;
  const t = (px * dx + pz * dz) / Math.max(1e-6, len2);
  if (t <= 0 || t >= 0.92) return false;
  const ex = px - t * dx, ez = pz - t * dz;
  return ex * ex + ez * ez < 1.0 * 1.0;
}
function updateOccluders() {
  const on = rig.person === 'third' && rig.mode === 'firstperson' && !!rig.follow;
  let changed = false;
  for (const g of hiddenByCam) {
    if (!(on && g !== rig.follow.group && board.pieces.get(g.userData.sq) === g && blocksView(g))) {
      g.visible = true; hiddenByCam.delete(g); changed = true;
    }
  }
  if (!on) return changed;
  for (const g of board.pieces.values()) {
    if (g === rig.follow.group || hiddenByCam.has(g) || !g.visible) continue;
    if (blocksView(g)) { g.visible = false; hiddenByCam.add(g); changed = true; }
  }
  return changed;
}

// ---------- Loop ----------
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, clock.getDelta());
  let changed = animator.update(dt);
  // Personagens "vivos" (respiração, olhar) quando a câmera está no campo
  if (G.status !== 'menu' && G.status !== 'loading' && rig.mode !== 'overhead') {
    for (const g of board.pieces.values()) {
      const ch = g.userData.char;
      if (!ch || animator.active.has(ch)) continue;
      if (!ch.idle) ch.idle = createIdle(ch);
      ch.idle.update(dt);
    }
    changed = true;
  }
  if (rig.update(dt)) changed = true;
  if (updateOccluders()) changed = true;
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
  hud.mini.draw();
}
addEventListener('resize', onResize);

// ---------- Inicialização ----------
function boot() {
  board.setPosition(createGame());
  hud.setView('overhead');
  frame();
  // O motor carrega em segundo plano: a abertura aparece na hora (só a partida contra o computador espera por ele).
  engine.init({ timeoutMs: 20000 }).catch((err) => console.error(err));
  G.status = 'menu';
  menu.show('title');
  // Convite por link (?sala=CODIGO) ou volta para a sala salva se a página recarregou no meio da partida
  onlineBoot();
  // Cenário realista em segundo plano (céu, grama e árvores); o jogo já pode ser usado enquanto carrega.
  import('./scenery.js')
    .then(({ upgradeScenery }) => upgradeScenery({ scene, renderer, board, quality, onChange: () => { G.dirty = true; } }))
    .then(() => { G.sceneryReady = true; })
    .catch((e) => { console.warn('[cenário]', e); G.sceneryReady = true; });
}
boot();

window.__xadrez = {
  get state() { return G; }, get net() { return NET; }, renderer, scene, engine, board, rig, animator, input, menu, get mini() { return hud.mini; },
  fen: () => toFEN(G.game),
  play: (uci) => { const m = uciToMove(G.game, uci); if (m && isHumanTurn()) humanMove(m); return !!m; },
};
