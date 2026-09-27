// Worker da IA interna: recebe { id, fen, depth, randomness } e devolve { id, uci, scoreCp }.
import { fromFEN, moveToUCI } from './rules.js';
import { bestMove, evaluate } from './ai.js';

self.onmessage = (e) => {
  const { id, fen, depth, randomness, evalOnly } = e.data;
  try {
    const state = fromFEN(fen);
    if (evalOnly) {
      self.postMessage({ id, scoreCp: evaluate(state) });
      return;
    }
    const { move, scoreCp } = bestMove(state, { depth, randomness });
    self.postMessage({ id, uci: move ? moveToUCI(move) : null, scoreCp });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
