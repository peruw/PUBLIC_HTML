import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, fromFEN, generateLegalMoves, makeMove, moveToUCI, toFEN, uciToMove } from '../js/rules.js';
import { bestMove, evaluate } from '../js/ai.js';

test('avaliação inicial é zero e simétrica', () => {
  assert.equal(evaluate(createGame()), 0);
  assert.ok(evaluate(fromFEN('4k3/8/8/8/8/8/8/4KQ2 w - - 0 1')) > 800);
  assert.ok(evaluate(fromFEN('4kq2/8/8/8/8/8/8/4K3 w - - 0 1')) < -800);
});

test('acha mate em 1', () => {
  // Mate do pastor: Qxf7#
  const s = fromFEN('r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 4');
  const { move } = bestMove(s, { depth: 2 });
  assert.equal(moveToUCI(move), 'h5f7');
  // Torre: mate no corredor
  const s2 = fromFEN('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  assert.equal(moveToUCI(bestMove(s2, { depth: 2 }).move), 'a1a8');
});

test('captura peça pendurada', () => {
  const s = fromFEN('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1');
  assert.equal(moveToUCI(bestMove(s, { depth: 2 }).move), 'd1d5');
});

test('nunca devolve lance ilegal em posições aleatórias', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let g = 0; g < 20; g++) {
    const s = createGame();
    for (let ply = 0; ply < 12; ply++) {
      const moves = generateLegalMoves(s);
      if (!moves.length) break;
      makeMove(s, moves[Math.floor(rnd() * moves.length)]);
    }
    const fen = toFEN(s);
    const { move } = bestMove(s, { depth: 2 });
    assert.equal(toFEN(s), fen, 'bestMove não deve alterar o estado');
    if (move) {
      const legal = uciToMove(s, moveToUCI(move));
      assert.ok(legal, 'lance ilegal ' + moveToUCI(move) + ' em ' + fen);
    } else {
      assert.equal(generateLegalMoves(s).length, 0);
    }
  }
});
