// Motor: Stockfish (Worker carregado do CDN) com fallback para a IA interna (ai-worker.js).
// API única usada pelo jogo. Scores sempre na perspectiva das brancas (centipeões).
import { DIFFICULTY, ANALYSIS, STOCKFISH_CANDIDATES } from './config.js';
import { fromFEN, moveToUCI } from './rules.js';
import { bestMove as aiBestMove, evaluate as aiEvaluate } from './ai.js';

const MATE_CP = 10000;

function makeBlobWorker(candidate) {
  const src = `importScripts(${JSON.stringify(candidate.js)});`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  // O build do Stockfish lê o caminho do .wasm em self.location.hash
  const w = new Worker(candidate.wasm ? url + '#' + encodeURIComponent(candidate.wasm) : url);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return w;
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

export class Engine {
  constructor({ onStatus } = {}) {
    this.onStatus = onStatus || (() => {});
    this.kind = null;        // 'stockfish' | 'interno'
    this.name = '';
    this.worker = null;
    this.level = DIFFICULTY[2];
    this.listeners = [];
    this.reqId = 0;
    this.ready = false;
    this._pendingAi = new Map();
    // Uma busca do Stockfish por vez (ver _enqueue). _searching resolve no 'bestmove' da busca em andamento.
    this._chain = Promise.resolve();
    this._searching = null;
    this.whenReady = new Promise((r) => { this._markReady = r; });
  }

  status(text, state) { this.onStatus(text, state); }

  async init({ timeoutMs = 20000 } = {}) {
    this.status('Carregando motor…', 'carregando');
    if (typeof Worker !== 'undefined') {
      for (const cand of STOCKFISH_CANDIDATES) {
        try {
          const ok = await this._tryStockfish(cand, Math.min(timeoutMs, cand.timeout));
          if (ok) {
            this.kind = 'stockfish';
            this.name = cand.name;
            this.ready = true;
            this.status('Stockfish pronto', 'pronto');
            this._markReady();
            return this;
          }
        } catch (err) {
          console.warn('[xadrez] falha ao carregar', cand.name, err);
        }
      }
    }
    await this._startInternal();
    return this;
  }

  async _tryStockfish(cand, timeoutMs) {
    const w = makeBlobWorker(cand);
    const gotUciOk = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      w.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data : (e.data && e.data.data) || '';
        if (line.includes('uciok')) { clearTimeout(timer); resolve(true); }
      };
      w.onerror = () => { clearTimeout(timer); resolve(false); };
    });
    // Alguns builds só aceitam comandos depois de inicializar; repetimos 'uci' algumas vezes.
    const poke = async () => {
      for (let i = 0; i < 8; i++) {
        try { w.postMessage('uci'); } catch (_) { /* ignora */ }
        await wait(500);
      }
    };
    poke();
    const ok = await gotUciOk;
    if (!ok) { try { w.terminate(); } catch (_) { /* ignora */ } return false; }
    this._attach(w);
    await this._isready();
    return true;
  }

  // Liga o worker UCI aos listeners (também usado pelos testes com um worker falso).
  _attach(w) {
    this.worker = w;
    w.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : (e.data && e.data.data) || '';
      for (const l of this.listeners.slice()) l(line);
    };
    w.onerror = (err) => console.warn('[xadrez] erro no Stockfish', err);
  }

  async _startInternal() {
    this.kind = 'interno';
    this.name = 'IA interna';
    try {
      this.worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const p = this._pendingAi.get(e.data.id);
        if (!p) return;
        this._pendingAi.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data);
      };
      this.worker.onerror = (err) => console.warn('[xadrez] erro na IA interna', err);
    } catch (err) {
      console.warn('[xadrez] worker interno indisponível, IA na thread principal', err);
      this.worker = null;
      this._aiSync = { fromFEN, moveToUCI, bestMove: aiBestMove, evaluate: aiEvaluate };
    }
    this.ready = true;
    this.status('Modo simples (motor indisponível)', 'fallback');
    this._markReady();
  }

  _send(cmd) { if (this.worker && this.kind === 'stockfish') this.worker.postMessage(cmd); }

  _isready() {
    return new Promise((resolve) => {
      const l = (line) => { if (line.includes('readyok')) { this._off(l); resolve(); } };
      this._on(l);
      this._send('isready');
      setTimeout(() => { this._off(l); resolve(); }, 3000);
    });
  }

  _on(l) { this.listeners.push(l); }
  _off(l) { const i = this.listeners.indexOf(l); if (i >= 0) this.listeners.splice(i, 1); }

  // O nível vale a partir da próxima busca (bestMove manda o Skill Level antes de cada 'go').
  setLevel(level) {
    this.level = DIFFICULTY.find((d) => d.level === level) || DIFFICULTY[2];
  }

  stop() {
    this.reqId++;
    if (this.kind === 'stockfish' && this._searching) this._send('stop');
  }

  // Fila de buscas do Stockfish: uma por vez. Antes de começar, para a busca anterior e espera o
  // 'bestmove' dela; senão esse 'bestmove' atrasado seria lido como a resposta da busca nova (o
  // computador jogaria um lance da posição antiga, ilegal, e cairia num lance sorteado).
  // Pedidos que ficaram velhos enquanto esperavam (id !== reqId) nem chegam ao motor.
  _enqueue(id, start) {
    const run = async () => {
      if (id !== this.reqId) return false;
      if (this._searching) {
        this._send('stop');
        await Promise.race([this._searching, wait(2500)]);
      }
      if (id !== this.reqId) return false;
      start();
      return true;
    };
    const p = this._chain.then(run, run);
    this._chain = p.catch(() => {});
    return p;
  }

  // Envia os comandos de uma busca; onLine recebe cada linha até o 'bestmove' (inclusive).
  _search(cmds, onLine) {
    let finish;
    const done = new Promise((r) => { finish = r; });
    this._searching = done;
    const l = (line) => {
      if (line.startsWith('bestmove')) {
        this._off(l);
        if (this._searching === done) this._searching = null;
        finish();
      }
      onLine(line);
    };
    this._on(l);
    for (const c of cmds) this._send(c);
  }

  // Melhor lance para a FEN. Resolve { uci, scoreCp } (scoreCp perspectiva das brancas) ou { uci: null }.
  // Pedidos substituídos por outro (ou por stop) resolvem com stale: true.
  async bestMove(fen) {
    const id = ++this.reqId;
    const stale = { uci: null, scoreCp: null, stale: true };
    await this.whenReady;
    if (id !== this.reqId) return stale;
    if (this.kind === 'stockfish') {
      return new Promise((resolve) => {
        let lastScore = null;
        const turn = fen.split(' ')[1];
        this._enqueue(id, () => this._search([
          'setoption name MultiPV value 1',
          'setoption name Skill Level value ' + this.level.skill,
          'position fen ' + fen,
          `go depth ${this.level.depth} movetime ${this.level.movetime}`,
        ], (line) => {
          if (id !== this.reqId) { resolve(stale); return; }
          if (line.startsWith('info') && line.includes(' score ') && (!/multipv \d+/.test(line) || /multipv 1\b/.test(line))) {
            lastScore = parseScore(line, turn).cp;
          }
          if (line.startsWith('bestmove')) {
            const uci = line.split(/\s+/)[1];
            resolve({ uci: uci && uci !== '(none)' ? uci : null, scoreCp: lastScore });
          }
        })).then((started) => { if (!started) resolve(stale); });
      });
    }
    return this._internal({ id, fen, depth: this.level.aiDepth, randomness: this.level.randomness })
      .then((r) => (id === this.reqId ? r : stale));
  }

  // Análise contínua da posição. onUpdate({ scoreCp, mateIn, lines: [{ uci, scoreCp, mateIn }] , done })
  // Devolve função para cancelar. Antes de o motor ficar pronto, a análise espera (não falha).
  analyze(fen, onUpdate) {
    const id = ++this.reqId;
    const turn = fen.split(' ')[1];
    const live = () => id === this.reqId;
    this.whenReady.then(() => {
      if (!live()) return;
      if (this.kind === 'stockfish') {
        const lines = [];
        this._enqueue(id, () => this._search([
          // Análise sempre na força máxima e com várias linhas
          'setoption name Skill Level value 20',
          'setoption name MultiPV value ' + ANALYSIS.multipv,
          'position fen ' + fen,
          `go depth ${ANALYSIS.depth} movetime ${ANALYSIS.movetime}`,
        ], (line) => {
          if (!live()) return;
          if (line.startsWith('info') && line.includes(' pv ')) {
            const m = /multipv (\d+)/.exec(line);
            const idx = m ? parseInt(m[1], 10) - 1 : 0;
            const pv = / pv (\S+)/.exec(line);
            const sc = parseScore(line, turn);
            lines[idx] = { uci: pv ? pv[1] : null, scoreCp: sc.cp, mateIn: sc.mate };
            if (lines[0]) onUpdate({ scoreCp: lines[0].scoreCp, mateIn: lines[0].mateIn, lines: lines.filter(Boolean), done: false });
          }
          if (line.startsWith('bestmove')) {
            onUpdate({ scoreCp: lines[0] ? lines[0].scoreCp : 0, mateIn: lines[0] ? lines[0].mateIn : null, lines: lines.filter(Boolean), done: true });
          }
        }));
        return;
      }
      this._internal({ id, fen, evalOnly: true }).then((r) => {
        if (!live()) return;
        onUpdate({ scoreCp: r.scoreCp, mateIn: null, lines: [], done: true });
      }).catch(() => {});
    });
    return () => { if (live()) this.stop(); };
  }

  _internal(msg) {
    if (this.worker && this.kind === 'interno') {
      return new Promise((resolve, reject) => {
        this._pendingAi.set(msg.id, { resolve, reject });
        this.worker.postMessage(msg);
      });
    }
    // Sem worker: roda na thread principal
    const ai = this._aiSync;
    return new Promise((resolve) => setTimeout(() => {
      const state = ai.fromFEN(msg.fen);
      if (msg.evalOnly) { resolve({ id: msg.id, scoreCp: ai.evaluate(state) }); return; }
      const { move, scoreCp } = ai.bestMove(state, { depth: msg.depth, randomness: msg.randomness });
      resolve({ id: msg.id, uci: move ? ai.moveToUCI(move) : null, scoreCp });
    }, 10));
  }

  dispose() {
    this.stop();
    if (this.worker) { try { this.worker.terminate(); } catch (_) { /* ignora */ } }
    this.worker = null;
    this.ready = false;
  }
}

// Converte "score cp X" / "score mate M" (lado a mover) para perspectiva das brancas.
function parseScore(line, turn) {
  const sign = turn === 'b' ? -1 : 1;
  const cp = /score cp (-?\d+)/.exec(line);
  if (cp) return { cp: sign * parseInt(cp[1], 10), mate: null };
  const mate = /score mate (-?\d+)/.exec(line);
  if (mate) {
    const m = parseInt(mate[1], 10);
    const s = m === 0 ? (sign < 0 ? 1 : -1) : Math.sign(m); // mate 0 = lado a mover está em mate
    return { cp: sign * s * (MATE_CP - Math.abs(m)), mate: sign * m };
  }
  return { cp: 0, mate: null };
}

export { MATE_CP };
