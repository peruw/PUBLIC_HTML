// IA interna (fallback quando o Stockfish não carrega): minimax alfa-beta com
// tabelas de posição (PST) e busca de capturas (quiescence) curta.
// JavaScript puro, sem Three.js. Usada também como avaliador estático no fallback.
import { generateLegalMoves, generatePseudoMoves, makeMove, undoMove, inCheck, typeOf, P, N, B, R, Q, K } from './rules.js';

const VALUE = { [P]: 100, [N]: 320, [B]: 330, [R]: 500, [Q]: 900, [K]: 0 };

// Tabelas do ponto de vista das brancas, índice = casa (a1 = 0). Valores em centipeões.
// (Escritas da 8ª para a 1ª linha para leitura humana; invertidas abaixo.)
const PST_RAW = {
  [P]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0],
  [N]: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50],
  [B]: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20],
  [R]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0],
  [Q]: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20],
  [K]: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20],
};
// PST[t][sq] para brancas; pretas usam a casa espelhada (sq ^ 56)
const PST = {};
for (const t of Object.keys(PST_RAW)) {
  const arr = new Int16Array(64);
  for (let i = 0; i < 64; i++) {
    const rowFromTop = i >> 3, f = i & 7;
    arr[(7 - rowFromTop) * 8 + f] = PST_RAW[t][i];
  }
  PST[t] = arr;
}

// Avaliação estática em centipeões, perspectiva das brancas.
export function evaluate(state) {
  const b = state.board;
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (p === 0) continue;
    const t = p > 0 ? p : -p;
    if (p > 0) score += VALUE[t] + PST[t][i];
    else score -= VALUE[t] + PST[t][i ^ 56];
  }
  return score;
}

const MATE = 100000;

function orderMoves(moves) {
  // capturas primeiro (MVV-LVA), promoções logo depois
  for (const m of moves) {
    m._score = (m.captured ? 10 * VALUE[typeOf(m.captured)] - VALUE[typeOf(m.piece)] : 0) + (m.promotion ? 800 : 0);
  }
  moves.sort((a, b) => b._score - a._score);
  return moves;
}

function quiesce(state, alpha, beta, sign, depthLeft) {
  const stand = sign * evaluate(state);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (depthLeft <= 0) return alpha;
  const moves = orderMoves(generatePseudoMoves(state).filter((m) => m.captured || m.promotion));
  const color = state.turn;
  for (const m of moves) {
    makeMove(state, m);
    if (inCheck(state, color)) { undoMove(state); continue; }
    const s = -quiesce(state, -beta, -alpha, -sign, depthLeft - 1);
    undoMove(state);
    if (s >= beta) return beta;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function negamax(state, depth, alpha, beta, sign, ply) {
  const moves = orderMoves(generateLegalMoves(state));
  if (moves.length === 0) {
    if (inCheck(state)) return -MATE + ply;
    return 0;
  }
  if (state.halfmove >= 100) return 0;
  if (depth === 0) return quiesce(state, alpha, beta, sign, 4);
  let best = -Infinity;
  for (const m of moves) {
    makeMove(state, m);
    const s = -negamax(state, depth - 1, -beta, -alpha, -sign, ply + 1);
    undoMove(state);
    if (s > best) best = s;
    if (s > alpha) alpha = s;
    if (alpha >= beta) break;
  }
  return best;
}

// Melhor lance. randomness (0..1): probabilidade de escolher entre lances quase iguais.
export function bestMove(state, { depth = 2, randomness = 0 } = {}) {
  const track = state.trackRepetition;
  state.trackRepetition = false;
  const sign = state.turn === 'w' ? 1 : -1;
  const moves = orderMoves(generateLegalMoves(state));
  if (moves.length === 0) { state.trackRepetition = track; return { move: null, scoreCp: 0 }; }
  const scored = [];
  let alpha = -Infinity;
  for (const m of moves) {
    makeMove(state, m);
    // Com aleatoriedade, cada lance da raiz é avaliado com janela completa para que os
    // scores sejam comparáveis (alfa-beta "fail-hard" igualaria os lances piores ao melhor).
    const s = -negamax(state, depth - 1, -Infinity, randomness > 0 ? Infinity : -alpha, -sign, 1);
    undoMove(state);
    scored.push({ move: m, score: s });
    if (s > alpha) alpha = s;
  }
  state.trackRepetition = track;
  scored.sort((a, b) => b.score - a.score);
  let pick = scored[0];
  if (randomness > 0 && scored.length > 1) {
    const window = 30 + randomness * 120; // cp
    const near = scored.filter((x) => scored[0].score - x.score <= window);
    if (Math.random() < randomness) pick = near[Math.floor(Math.random() * near.length)];
  }
  // scoreCp na perspectiva das brancas
  return { move: pick.move, scoreCp: sign * pick.score };
}
