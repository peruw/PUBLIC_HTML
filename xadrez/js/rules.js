// Regras do xadrez em JavaScript puro (sem Three.js): geração de lances, xeque,
// mate, afogamento, roque, en passant, promoção, FEN, SAN, UCI e perft.
// Casas: índice 0..63, a1 = 0, h1 = 7, a8 = 56, h8 = 63 (rank*8 + file).
// Peças: inteiros com sinal. 1..6 = P N B R Q K brancas; -1..-6 = pretas. 0 = vazio.

export const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const PIECE_LETTERS = { 1: 'p', 2: 'n', 3: 'b', 4: 'r', 5: 'q', 6: 'k' };
const LETTER_PIECE = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };

// Roque (bitmask)
const WK = 1, WQ = 2, BK = 4, BQ = 8;

const KNIGHT_D = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const BISHOP_D = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
const ROOK_D = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export function squareName(sq) {
  return String.fromCharCode(97 + (sq & 7)) + (1 + (sq >> 3));
}
export function squareIndex(name) {
  return (name.charCodeAt(0) - 97) + (name.charCodeAt(1) - 49) * 8;
}
export function fileOf(sq) { return sq & 7; }
export function rankOf(sq) { return sq >> 3; }
export function colorOf(piece) { return piece > 0 ? 'w' : 'b'; }
export function typeOf(piece) { return piece < 0 ? -piece : piece; }

// ---------- Estado ----------

export function createGame(fen = START_FEN) {
  return fromFEN(fen);
}

export function fromFEN(fen) {
  const parts = fen.trim().split(/\s+/);
  const board = new Int8Array(64);
  const rows = parts[0].split('/');
  if (rows.length !== 8) throw new Error('FEN inválida: ' + fen);
  for (let r = 0; r < 8; r++) {
    const row = rows[r];
    let f = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') { f += ch.charCodeAt(0) - 48; continue; }
      const t = LETTER_PIECE[ch.toLowerCase()];
      if (!t || f > 7) throw new Error('FEN inválida: ' + fen);
      board[(7 - r) * 8 + f] = ch === ch.toUpperCase() ? t : -t;
      f++;
    }
    if (f !== 8) throw new Error('FEN inválida: ' + fen);
  }
  const turn = parts[1] === 'b' ? 'b' : 'w';
  let castling = 0;
  const c = parts[2] || '-';
  if (c.includes('K')) castling |= WK;
  if (c.includes('Q')) castling |= WQ;
  if (c.includes('k')) castling |= BK;
  if (c.includes('q')) castling |= BQ;
  const ep = parts[3] && parts[3] !== '-' ? squareIndex(parts[3]) : -1;
  const halfmove = parseInt(parts[4] || '0', 10) || 0;
  const fullmove = parseInt(parts[5] || '1', 10) || 1;
  const state = { board, turn, castling, ep, halfmove, fullmove, history: [], positionCounts: new Map(), trackRepetition: true };
  bumpPosition(state, 1);
  return state;
}

export function toFEN(state) {
  let out = '';
  for (let r = 7; r >= 0; r--) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = state.board[r * 8 + f];
      if (p === 0) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      const l = PIECE_LETTERS[typeOf(p)];
      out += p > 0 ? l.toUpperCase() : l;
    }
    if (empty) out += empty;
    if (r > 0) out += '/';
  }
  let c = '';
  if (state.castling & WK) c += 'K';
  if (state.castling & WQ) c += 'Q';
  if (state.castling & BK) c += 'k';
  if (state.castling & BQ) c += 'q';
  if (!c) c = '-';
  return `${out} ${state.turn} ${c} ${state.ep >= 0 ? squareName(state.ep) : '-'} ${state.halfmove} ${state.fullmove}`;
}

// Chave da posição para repetição (sem contadores). A casa de en passant só conta se houver um peão do lado
// a jogar pronto para capturar nela; senão a mesma posição pareceria diferente logo após um avanço duplo.
function positionKey(state) {
  let s = '';
  for (let i = 0; i < 64; i++) s += String.fromCharCode(80 + state.board[i]);
  return s + state.turn + state.castling + (epCapturable(state) ? state.ep : -1);
}
function epCapturable(state) {
  const ep = state.ep;
  if (ep < 0) return false;
  const sign = state.turn === 'w' ? 1 : -1;
  const from = ep - sign * 8; // linha dos peões que capturariam
  const f = ep & 7;
  return (f > 0 && state.board[from - 1] === sign * P) || (f < 7 && state.board[from + 1] === sign * P);
}
function bumpPosition(state, delta) {
  if (!state.trackRepetition) return;
  const key = positionKey(state);
  const n = (state.positionCounts.get(key) || 0) + delta;
  if (n <= 0) state.positionCounts.delete(key); else state.positionCounts.set(key, n);
}
function repetitionCount(state) {
  if (!state.trackRepetition) return 1;
  return state.positionCounts.get(positionKey(state)) || 0;
}

// ---------- Ataques ----------

// A casa `sq` é atacada por peças da cor `byColor` ('w'|'b')?
export function isAttacked(board, sq, byColor) {
  const sign = byColor === 'w' ? 1 : -1;
  const f = sq & 7, r = sq >> 3;
  // Peões: um peão branco em (f±1, r-1) ataca sq
  const pr = r - sign;
  if (pr >= 0 && pr < 8) {
    if (f > 0 && board[pr * 8 + f - 1] === sign * P) return true;
    if (f < 7 && board[pr * 8 + f + 1] === sign * P) return true;
  }
  for (let i = 0; i < 8; i++) {
    const nf = f + KNIGHT_D[i][0], nr = r + KNIGHT_D[i][1];
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && board[nr * 8 + nf] === sign * N) return true;
    const kf = f + KING_D[i][0], kr = r + KING_D[i][1];
    if (kf >= 0 && kf < 8 && kr >= 0 && kr < 8 && board[kr * 8 + kf] === sign * K) return true;
  }
  for (let i = 0; i < 4; i++) {
    let nf = f + BISHOP_D[i][0], nr = r + BISHOP_D[i][1];
    while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
      const p = board[nr * 8 + nf];
      if (p !== 0) { if (p === sign * B || p === sign * Q) return true; break; }
      nf += BISHOP_D[i][0]; nr += BISHOP_D[i][1];
    }
    nf = f + ROOK_D[i][0]; nr = r + ROOK_D[i][1];
    while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
      const p = board[nr * 8 + nf];
      if (p !== 0) { if (p === sign * R || p === sign * Q) return true; break; }
      nf += ROOK_D[i][0]; nr += ROOK_D[i][1];
    }
  }
  return false;
}

export function kingSquare(board, color) {
  const k = color === 'w' ? K : -K;
  for (let i = 0; i < 64; i++) if (board[i] === k) return i;
  return -1;
}

export function inCheck(state, color = state.turn) {
  const ks = kingSquare(state.board, color);
  if (ks < 0) return false;
  return isAttacked(state.board, ks, color === 'w' ? 'b' : 'w');
}

// ---------- Geração de lances ----------
// Move: { from, to, piece, captured, promotion, flags }
// flags: 'n' normal, 'c' captura, 'd' avanço duplo, 'e' en passant, 'k'/'q' roque, 'p' promoção ('cp' captura+promoção)

function addPawnMoves(list, from, to, piece, captured, flagBase) {
  const toRank = to >> 3;
  if (toRank === 0 || toRank === 7) {
    for (const promo of [Q, R, B, N]) {
      list.push({ from, to, piece, captured, promotion: promo, flags: flagBase + 'p' });
    }
  } else {
    list.push({ from, to, piece, captured, promotion: 0, flags: flagBase || 'n' });
  }
}

export function generatePseudoMoves(state, fromSq = -1) {
  const { board, turn } = state;
  const sign = turn === 'w' ? 1 : -1;
  const list = [];
  const start = fromSq >= 0 ? fromSq : 0;
  const end = fromSq >= 0 ? fromSq + 1 : 64;
  for (let sq = start; sq < end; sq++) {
    const piece = board[sq];
    if (piece === 0 || (piece > 0) !== (sign > 0)) continue;
    const t = typeOf(piece);
    const f = sq & 7, r = sq >> 3;
    if (t === P) {
      const r1 = r + sign;
      if (r1 >= 0 && r1 < 8) {
        const one = r1 * 8 + f;
        if (board[one] === 0) {
          addPawnMoves(list, sq, one, piece, 0, '');
          const startRank = sign > 0 ? 1 : 6;
          if (r === startRank) {
            const two = one + sign * 8;
            if (board[two] === 0) list.push({ from: sq, to: two, piece, captured: 0, promotion: 0, flags: 'd' });
          }
        }
        for (const df of [-1, 1]) {
          const nf = f + df;
          if (nf < 0 || nf > 7) continue;
          const to = r1 * 8 + nf;
          const target = board[to];
          if (target !== 0 && (target > 0) !== (sign > 0)) addPawnMoves(list, sq, to, piece, target, 'c');
          else if (to === state.ep && target === 0) {
            list.push({ from: sq, to, piece, captured: -sign * P, promotion: 0, flags: 'e' });
          }
        }
      }
    } else if (t === N || t === K) {
      const D = t === N ? KNIGHT_D : KING_D;
      for (let i = 0; i < 8; i++) {
        const nf = f + D[i][0], nr = r + D[i][1];
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const to = nr * 8 + nf;
        const target = board[to];
        if (target === 0) list.push({ from: sq, to, piece, captured: 0, promotion: 0, flags: 'n' });
        else if ((target > 0) !== (sign > 0)) list.push({ from: sq, to, piece, captured: target, promotion: 0, flags: 'c' });
      }
      if (t === K) {
        const enemy = sign > 0 ? 'b' : 'w';
        const home = sign > 0 ? 4 : 60;
        if (sq === home && !isAttacked(board, home, enemy)) {
          const kSide = sign > 0 ? WK : BK, qSide = sign > 0 ? WQ : BQ;
          if ((state.castling & kSide) && board[home + 1] === 0 && board[home + 2] === 0 &&
              board[home + 3] === sign * R && !isAttacked(board, home + 1, enemy) && !isAttacked(board, home + 2, enemy)) {
            list.push({ from: sq, to: home + 2, piece, captured: 0, promotion: 0, flags: 'k' });
          }
          if ((state.castling & qSide) && board[home - 1] === 0 && board[home - 2] === 0 && board[home - 3] === 0 &&
              board[home - 4] === sign * R && !isAttacked(board, home - 1, enemy) && !isAttacked(board, home - 2, enemy)) {
            list.push({ from: sq, to: home - 2, piece, captured: 0, promotion: 0, flags: 'q' });
          }
        }
      }
    } else {
      const dirs = t === B ? BISHOP_D : t === R ? ROOK_D : KING_D; // dama = 8 direções
      for (let i = 0; i < dirs.length; i++) {
        let nf = f + dirs[i][0], nr = r + dirs[i][1];
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          const to = nr * 8 + nf;
          const target = board[to];
          if (target === 0) list.push({ from: sq, to, piece, captured: 0, promotion: 0, flags: 'n' });
          else {
            if ((target > 0) !== (sign > 0)) list.push({ from: sq, to, piece, captured: target, promotion: 0, flags: 'c' });
            break;
          }
          nf += dirs[i][0]; nr += dirs[i][1];
        }
      }
    }
  }
  return list;
}

export function generateLegalMoves(state, fromSq = -1) {
  const pseudo = generatePseudoMoves(state, fromSq);
  const legal = [];
  const color = state.turn;
  const track = state.trackRepetition;
  state.trackRepetition = false;
  for (const m of pseudo) {
    makeMove(state, m);
    if (!inCheck(state, color)) legal.push(m);
    undoMove(state);
  }
  state.trackRepetition = track;
  return legal;
}

// ---------- Fazer / desfazer ----------

export function makeMove(state, move) {
  const { board } = state;
  const sign = move.piece > 0 ? 1 : -1;
  state.history.push({
    move, castling: state.castling, ep: state.ep, halfmove: state.halfmove, fullmove: state.fullmove,
  });
  board[move.from] = 0;
  if (move.flags === 'e') {
    board[move.to - sign * 8] = 0;
  }
  board[move.to] = move.promotion ? sign * move.promotion : move.piece;
  if (move.flags === 'k') { board[move.to + 1] = 0; board[move.to - 1] = sign * R; }
  else if (move.flags === 'q') { board[move.to - 2] = 0; board[move.to + 1] = sign * R; }

  // direitos de roque
  if (typeOf(move.piece) === K) state.castling &= sign > 0 ? ~(WK | WQ) : ~(BK | BQ);
  if (move.from === 0 || move.to === 0) state.castling &= ~WQ;
  if (move.from === 7 || move.to === 7) state.castling &= ~WK;
  if (move.from === 56 || move.to === 56) state.castling &= ~BQ;
  if (move.from === 63 || move.to === 63) state.castling &= ~BK;

  state.ep = move.flags === 'd' ? move.from + sign * 8 : -1;
  state.halfmove = (typeOf(move.piece) === P || move.captured) ? 0 : state.halfmove + 1;
  if (state.turn === 'b') state.fullmove++;
  state.turn = state.turn === 'w' ? 'b' : 'w';
  bumpPosition(state, 1);
  return state;
}

export function undoMove(state) {
  const h = state.history.pop();
  if (!h) return null;
  bumpPosition(state, -1);
  const { move } = h;
  const { board } = state;
  const sign = move.piece > 0 ? 1 : -1;
  board[move.from] = move.piece;
  board[move.to] = 0;
  if (move.flags === 'e') board[move.to - sign * 8] = move.captured;
  else if (move.captured) board[move.to] = move.captured;
  if (move.flags === 'k') { board[move.to + 1] = sign * R; board[move.to - 1] = 0; }
  else if (move.flags === 'q') { board[move.to - 2] = sign * R; board[move.to + 1] = 0; }
  state.castling = h.castling;
  state.ep = h.ep;
  state.halfmove = h.halfmove;
  state.fullmove = h.fullmove;
  state.turn = state.turn === 'w' ? 'b' : 'w';
  return move;
}

// ---------- Situação da partida ----------

function insufficientMaterial(board) {
  let minors = 0;
  let bishopColor = -1, mixedBishops = false;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p === 0) continue;
    const t = typeOf(p);
    if (t === K) continue;
    if (t === P || t === R || t === Q) return false;
    if (t === B) {
      const c = ((i & 7) + (i >> 3)) & 1;
      if (bishopColor === -1) bishopColor = c; else if (bishopColor !== c) mixedBishops = true;
    }
    minors++;
  }
  if (minors <= 1) return true;
  // Só bispos, todos na mesma cor de casa
  if (!mixedBishops) {
    for (let i = 0; i < 64; i++) if (typeOf(board[i]) === N) return false;
    return true;
  }
  return false;
}

export function gameStatus(state) {
  const moves = generateLegalMoves(state);
  const check = inCheck(state);
  if (moves.length === 0) {
    if (check) return { over: true, result: state.turn === 'w' ? '0-1' : '1-0', reason: 'xeque-mate', check };
    return { over: true, result: '1/2-1/2', reason: 'afogamento', check };
  }
  if (repetitionCount(state) >= 3) return { over: true, result: '1/2-1/2', reason: 'tripla repetição', check };
  if (state.halfmove >= 100) return { over: true, result: '1/2-1/2', reason: 'regra dos 50 lances', check };
  if (insufficientMaterial(state.board)) return { over: true, result: '1/2-1/2', reason: 'material insuficiente', check };
  return { over: false, result: null, reason: null, check };
}

// ---------- Notação ----------

export function moveToUCI(move) {
  return squareName(move.from) + squareName(move.to) + (move.promotion ? PIECE_LETTERS[move.promotion] : '');
}

export function uciToMove(state, uci) {
  if (!uci || uci.length < 4) return null;
  const from = squareIndex(uci.slice(0, 2));
  const to = squareIndex(uci.slice(2, 4));
  const promo = uci[4] ? LETTER_PIECE[uci[4].toLowerCase()] : 0;
  const moves = generateLegalMoves(state, from);
  for (const m of moves) {
    if (m.to === to && (m.promotion || 0) === (promo || 0)) return m;
    // Sem letra de promoção: assume dama
    if (m.to === to && !promo && m.promotion === Q) return m;
  }
  return null;
}

// SAN do lance na posição atual (chame ANTES de makeMove).
export function toSAN(state, move) {
  let san;
  if (move.flags === 'k') san = 'O-O';
  else if (move.flags === 'q') san = 'O-O-O';
  else {
    const t = typeOf(move.piece);
    const isCapture = move.captured !== 0;
    if (t === P) {
      san = isCapture ? squareName(move.from)[0] + 'x' : '';
      san += squareName(move.to);
      if (move.promotion) san += '=' + PIECE_LETTERS[move.promotion].toUpperCase();
    } else {
      san = PIECE_LETTERS[t].toUpperCase();
      // desambiguação
      const others = generateLegalMoves(state).filter((m) => m.from !== move.from && m.to === move.to && m.piece === move.piece);
      if (others.length) {
        const sameFile = others.some((m) => (m.from & 7) === (move.from & 7));
        const sameRank = others.some((m) => (m.from >> 3) === (move.from >> 3));
        if (!sameFile) san += squareName(move.from)[0];
        else if (!sameRank) san += squareName(move.from)[1];
        else san += squareName(move.from);
      }
      if (isCapture) san += 'x';
      san += squareName(move.to);
    }
  }
  const track = state.trackRepetition;
  state.trackRepetition = false;
  makeMove(state, move);
  if (inCheck(state)) san += generateLegalMoves(state).length === 0 ? '#' : '+';
  undoMove(state);
  state.trackRepetition = track;
  return san;
}

// ---------- Perft ----------

export function perft(state, depth) {
  if (depth === 0) return 1;
  const track = state.trackRepetition;
  state.trackRepetition = false;
  const moves = generateLegalMoves(state);
  let nodes = 0;
  if (depth === 1) nodes = moves.length;
  else {
    for (const m of moves) {
      makeMove(state, m);
      nodes += perft(state, depth - 1);
      undoMove(state);
    }
  }
  state.trackRepetition = track;
  return nodes;
}

// Cópia independente do estado (para IA em worker, etc.)
export function cloneState(state) {
  return {
    board: new Int8Array(state.board), turn: state.turn, castling: state.castling, ep: state.ep,
    halfmove: state.halfmove, fullmove: state.fullmove, history: [], positionCounts: new Map(state.positionCounts),
    trackRepetition: state.trackRepetition,
  };
}
