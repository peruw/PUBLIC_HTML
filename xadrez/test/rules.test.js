import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, fromFEN, toFEN, START_FEN, generateLegalMoves, makeMove, undoMove,
  inCheck, gameStatus, toSAN, uciToMove, moveToUCI, squareIndex, squareName, perft, Q, N,
} from '../js/rules.js';

function play(state, ...ucis) {
  const sans = [];
  for (const u of ucis) {
    const m = uciToMove(state, u);
    assert.ok(m, 'lance ilegal: ' + u + ' em ' + toFEN(state));
    sans.push(toSAN(state, m));
    makeMove(state, m);
  }
  return sans;
}

test('FEN ida e volta', () => {
  const fens = [
    START_FEN,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 b - - 3 10',
  ];
  for (const f of fens) assert.equal(toFEN(fromFEN(f)), f);
});

test('perft posição inicial', () => {
  const s = createGame();
  assert.equal(perft(s, 1), 20);
  assert.equal(perft(s, 2), 400);
  assert.equal(perft(s, 3), 8902);
});

test('perft Kiwipete (roque, en passant, promoção, xeques)', () => {
  const s = fromFEN('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.equal(perft(s, 1), 48);
  assert.equal(perft(s, 2), 2039);
  assert.equal(perft(s, 3), 97862);
});

test('perft posição 3', () => {
  const s = fromFEN('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  assert.equal(perft(s, 1), 14);
  assert.equal(perft(s, 2), 191);
  assert.equal(perft(s, 3), 2812);
});

test('undo restaura a FEN exata', () => {
  const s = createGame();
  const before = toFEN(s);
  play(s, 'e2e4', 'd7d5', 'e4d5', 'g8f6', 'f1b5', 'c7c6', 'd5c6', 'b7c6');
  for (let i = 0; i < 8; i++) undoMove(s);
  assert.equal(toFEN(s), before);
});

test('roque bloqueado por casa atacada', () => {
  // Bispo preto em a6 ataca f1: brancas não podem rocar curto
  const s = fromFEN('r3k2r/8/b7/8/8/8/8/R3K2R w KQkq - 0 1');
  const kingMoves = generateLegalMoves(s, squareIndex('e1'));
  const ucis = kingMoves.map(moveToUCI);
  assert.ok(!ucis.includes('e1g1'), 'roque curto deveria estar bloqueado');
  assert.ok(ucis.includes('e1c1'), 'roque longo deveria ser permitido');
});

test('roque proibido em xeque', () => {
  const s = fromFEN('4k3/8/8/8/8/8/8/r3K2R w K - 0 1'); // torre em a1 dá xeque na 1ª linha
  const ucis = generateLegalMoves(s, squareIndex('e1')).map(moveToUCI);
  assert.ok(!ucis.includes('e1g1'));
});

test('en passant que exporia o rei é ilegal', () => {
  // Rei branco a5, peão branco b5, peão preto c5 (acabou de avançar duplo), torre preta h5
  const s = fromFEN('8/8/8/KPp4r/8/8/8/4k3 w - c6 0 1');
  const ucis = generateLegalMoves(s, squareIndex('b5')).map(moveToUCI);
  assert.ok(!ucis.includes('b5c6'), 'en passant deveria ser ilegal (torre em h5)');
});

test('en passant legal e SAN', () => {
  const s = createGame();
  const sans = play(s, 'e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6');
  assert.equal(sans[4], 'exd6');
  assert.equal(s.board[squareIndex('d5')], 0, 'peão capturado en passant deve sumir');
});

test('promoção com captura', () => {
  const s = fromFEN('1n2k3/2P5/8/8/8/8/8/4K3 w - - 0 1');
  const moves = generateLegalMoves(s, squareIndex('c7'));
  const promos = moves.filter((m) => m.to === squareIndex('b8'));
  assert.equal(promos.length, 4);
  const m = uciToMove(s, 'c7b8q');
  assert.equal(toSAN(s, m), 'cxb8=Q+');
  makeMove(s, m);
  assert.equal(s.board[squareIndex('b8')], Q);
  const m2 = uciToMove(fromFEN('1n2k3/2P5/8/8/8/8/8/4K3 w - - 0 1'), 'c7c8n');
  assert.equal(m2.promotion, N);
});

test('mate do pastor', () => {
  const s = createGame();
  const sans = play(s, 'e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7');
  assert.equal(sans[6], 'Qxf7#');
  const st = gameStatus(s);
  assert.deepEqual([st.over, st.result, st.reason], [true, '1-0', 'xeque-mate']);
});

test('afogamento', () => {
  const s = fromFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  const st = gameStatus(s);
  assert.equal(st.over, true);
  assert.equal(st.reason, 'afogamento');
  assert.equal(st.result, '1/2-1/2');
});

test('tripla repetição', () => {
  const s = createGame();
  play(s, 'g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8');
  const st = gameStatus(s);
  assert.equal(st.over, true);
  assert.equal(st.reason, 'tripla repetição');
});

test('material insuficiente', () => {
  assert.equal(gameStatus(fromFEN('8/8/4k3/8/8/2K5/8/8 w - - 0 1')).reason, 'material insuficiente');
  assert.equal(gameStatus(fromFEN('8/8/4k3/8/8/2K5/3B4/8 w - - 0 1')).reason, 'material insuficiente');
  assert.equal(gameStatus(fromFEN('8/8/4k3/8/8/2K5/3P4/8 w - - 0 1')).over, false);
});

test('SAN com desambiguação', () => {
  // Dois cavalos brancos podem ir para d2: b1 e f3 → Nbd2 / Nfd2
  const s = fromFEN('4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1');
  const m = uciToMove(s, 'b1d2');
  assert.equal(toSAN(s, m), 'Nbd2');
  // Duas torres na mesma coluna: R1e1 vs R7e1? torres a1 e a7 indo para a4 → R1a4 / R7a4
  const s2 = fromFEN('4k3/R7/8/8/8/8/8/R3K3 w - - 0 1');
  assert.equal(toSAN(s2, uciToMove(s2, 'a1a4')), 'R1a4');
  // Xeque
  const s3 = fromFEN('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
  assert.equal(toSAN(s3, uciToMove(s3, 'a1a8')), 'Ra8+');
});

test('roque em SAN e posição das torres', () => {
  const s = fromFEN('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
  assert.equal(toSAN(s, uciToMove(s, 'e1g1')), 'O-O');
  makeMove(s, uciToMove(s, 'e1g1'));
  assert.equal(squareName(squareIndex('f1')), 'f1');
  assert.equal(s.board[squareIndex('f1')], 4);
  assert.equal(s.board[squareIndex('h1')], 0);
  assert.equal(toSAN(s, uciToMove(s, 'e8c8')), 'O-O-O');
  makeMove(s, uciToMove(s, 'e8c8'));
  assert.equal(s.board[squareIndex('d8')], -4);
  undoMove(s); undoMove(s);
  assert.equal(toFEN(s), 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
});

test('inCheck', () => {
  const s = fromFEN('4k3/8/8/8/8/8/8/4KQ2 b - - 0 1');
  assert.equal(inCheck(s), false);
  const s2 = fromFEN('4k3/8/8/8/8/8/8/4K1Q1 b - - 0 1');
  assert.equal(inCheck(s2), false);
  const s3 = fromFEN('4k3/8/8/8/8/8/8/Q3K3 b - - 0 1');
  assert.equal(inCheck(s3), false);
  const s4 = fromFEN('4k3/8/8/8/4Q3/8/8/4K3 b - - 0 1');
  assert.equal(inCheck(s4), true);
});
