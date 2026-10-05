import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../js/engine.js';

// Worker UCI falso: cada 'go' vira uma busca que termina sozinha depois de `ms`, ou na hora com 'stop'.
// O lance devolvido depende da FEN da busca, então dá para ver se a resposta é da posição certa.
// Registra se algum comando chegou com outra busca ainda rodando (o que o UCI não permite).
class FakeUci {
  constructor(answers, ms = 300) {
    this.answers = answers; this.ms = ms; this.fen = null; this.search = null; this.violations = []; this.log = [];
  }
  emit(line) { setTimeout(() => this.onmessage && this.onmessage({ data: line }), 1); }
  finish() {
    const s = this.search; if (!s) return;
    clearTimeout(s.timer); this.search = null;
    this.emit(`info depth 5 multipv 1 score cp 33 pv ${s.move}`);
    this.emit(`bestmove ${s.move}`);
  }
  postMessage(cmd) {
    this.log.push(cmd);
    if (cmd === 'stop') { this.finish(); return; }
    if (this.search) this.violations.push(cmd);
    if (cmd.startsWith('position fen ')) this.fen = cmd.slice(13);
    if (cmd.startsWith('go')) {
      const move = this.answers[this.fen] || '0000';
      this.search = { move, timer: setTimeout(() => this.finish(), this.ms) };
    }
  }
  terminate() {}
}

const A = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const B = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

function fakeEngine(ms) {
  const fake = new FakeUci({ [A]: 'e2e4', [B]: 'e7e5' }, ms);
  const e = new Engine();
  e._attach(fake);
  e.kind = 'stockfish';
  e.ready = true;
  e._markReady();
  return { e, fake };
}

test('bestMove depois de cancelar uma análise devolve o lance da posição nova', async () => {
  const { e, fake } = fakeEngine(400);
  const cancel = e.analyze(A, () => {});
  await new Promise((r) => setTimeout(r, 30));    // análise de A rodando
  cancel();
  const res = await e.bestMove(B);                 // o 'bestmove e2e4' atrasado de A não pode valer
  assert.equal(res.uci, 'e7e5');
  assert.deepEqual(fake.violations, []);
});

test('bestMove substituído por outro resolve como stale, e o novo responde certo', async () => {
  const { e, fake } = fakeEngine(400);
  const first = e.bestMove(A);
  await new Promise((r) => setTimeout(r, 30));
  e.stop();                                        // ex.: reiniciar a partida
  const second = e.bestMove(B);
  const [r1, r2] = await Promise.all([first, second]);
  assert.equal(r1.stale, true);
  assert.equal(r2.uci, 'e7e5');
  assert.deepEqual(fake.violations, []);
});

test('pedidos que ficaram velhos na fila nem chegam ao motor', async () => {
  const { e, fake } = fakeEngine(200);
  const p1 = e.bestMove(A);
  const p2 = e.bestMove(A);
  const p3 = e.bestMove(B);
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(r1.stale, true);
  assert.equal(r2.stale, true);
  assert.equal(r3.uci, 'e7e5');
  assert.ok(fake.log.filter((c) => c.startsWith('go')).length <= 2);
  assert.deepEqual(fake.violations, []);
});

test('bestMove pedido antes de o motor ficar pronto espera e responde', async () => {
  const fake = new FakeUci({ [A]: 'e2e4' }, 50);
  const e = new Engine();
  const p = e.bestMove(A);
  await new Promise((r) => setTimeout(r, 30));
  e._attach(fake); e.kind = 'stockfish'; e.ready = true; e._markReady();
  assert.equal((await p).uci, 'e2e4');
});

test('análise entrega as linhas e termina com done', async () => {
  const { e } = fakeEngine(50);
  const ups = [];
  await new Promise((resolve) => e.analyze(A, (u) => { ups.push(u); if (u.done) resolve(); }));
  const last = ups[ups.length - 1];
  assert.equal(last.done, true);
  assert.equal(last.lines[0].uci, 'e2e4');
  assert.equal(last.scoreCp, 33);
});
