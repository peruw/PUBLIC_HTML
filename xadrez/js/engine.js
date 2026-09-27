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
    this.worker = w;
    w.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : (e.data && e.data.data) || '';
      for (const l of this.listeners) l(line);
    };
    w.onerror = (err) => console.warn('[xadrez] erro no Stockfish', err);
    await this._isready();
    return true;
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

  setLevel(level) {
    this.level = DIFFICULTY.find((d) => d.level === level) || DIFFICULTY[2];
    this._applyLevel();
  }
  _applyLevel() {
    if (this.kind !== 'stockfish') return;
    this._send('setoption name Skill Level value ' + this.level.skill);
  }

  stop() {
    this.reqId++;
    if (this.kind === 'stockfish') this._send('stop');
  }

  // Melhor lance para a FEN. Resolve { uci, scoreCp } (scoreCp perspectiva das brancas) ou { uci: null }.
  async bestMove(fen) {
    const id = ++this.reqId;
    if (this.kind === 'stockfish') {
      return new Promise((resolve) => {
        let lastScore = null;
        const turn = fen.split(' ')[1];
        const l = (line) => {
          if (id !== this.reqId) { this._off(l); resolve({ uci: null, scoreCp: null, stale: true }); return; }
          if (line.startsWith('info') && line.includes(' score ') && (!/multipv \d+/.test(line) || /multipv 1\b/.test(line))) {
            lastScore = parseScore(line, turn).cp;
          }
          if (line.startsWith('bestmove')) {
            this._off(l);
            const uci = line.split(/\s+/)[1];
            resolve({ uci: uci && uci !== '(none)' ? uci : null, scoreCp: lastScore });
          }
        };
        this._on(l);
        this._send('setoption name MultiPV value 1');
        this._send('setoption name Skill Level value ' + this.level.skill);
        this._send('position fen ' + fen);
        this._send(`go depth ${this.level.depth} movetime ${this.level.movetime}`);
      });
    }
    return this._internal({ id, fen, depth: this.level.aiDepth, randomness: this.level.randomness })
      .then((r) => (id === this.reqId ? r : { uci: null, scoreCp: null, stale: true }));
  }

  // Análise contínua da posição. onUpdate({ scoreCp, mateIn, lines: [{ uci, scoreCp, mateIn }] , done })
  // Devolve função para cancelar.
  analyze(fen, onUpdate) {
    const id = ++this.reqId;
    const turn = fen.split(' ')[1];
    if (this.kind === 'stockfish') {
      const lines = [];
      const l = (line) => {
        if (id !== this.reqId) { this._off(l); return; }
        if (line.startsWith('info') && line.includes(' pv ')) {
          const m = /multipv (\d+)/.exec(line);
          const idx = m ? parseInt(m[1], 10) - 1 : 0;
          const pv = / pv (\S+)/.exec(line);
          const sc = parseScore(line, turn);
          lines[idx] = { uci: pv ? pv[1] : null, scoreCp: sc.cp, mateIn: sc.mate };
          onUpdate({ scoreCp: lines[0].scoreCp, mateIn: lines[0].mateIn, lines: lines.filter(Boolean), done: false });
        }
        if (line.startsWith('bestmove')) {
          this._off(l);
          onUpdate({ scoreCp: lines[0] ? lines[0].scoreCp : 0, mateIn: lines[0] ? lines[0].mateIn : null, lines: lines.filter(Boolean), done: true });
        }
      };
      this._on(l);
      // Análise sempre na força máxima e com várias linhas
      this._send('setoption name Skill Level value 20');
      this._send('setoption name MultiPV value ' + ANALYSIS.multipv);
      this._send('position fen ' + fen);
      this._send(`go depth ${ANALYSIS.depth} movetime ${ANALYSIS.movetime}`);
      return () => { if (id === this.reqId) this.stop(); this._off(l); };
    }
    this._internal({ id, fen, evalOnly: true }).then((r) => {
      if (id !== this.reqId) return;
      onUpdate({ scoreCp: r.scoreCp, mateIn: null, lines: [], done: true });
    }).catch(() => {});
    return () => { if (id === this.reqId) this.reqId++; };
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
