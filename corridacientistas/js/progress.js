// Progresso do jogador (salvo no aparelho): recordes, troféus por cientista,
// curiosidades já vistas e perguntas-relâmpago. Também conta as estatísticas
// da corrida atual (turbos de drift, itens, batidas) a partir dos eventos do bus.
import { CHARACTERS, ITEMS, CLASSES } from './config.js';
import { charText, itemText, getLang } from './i18n.js';

export const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

// Banco de perguntas: uma por cientista e uma por item que tem pergunta.
// O texto vem do idioma atual; a resposta certa (answer) fica em config.js, igual em todos os idiomas.
const QUIZ = [
  ...CHARACTERS.filter((c) => c.quiz).map((c) => ({ id: 'c-' + c.id, about: c.id, kind: 'char', key: c.id, answer: c.quiz.answer })),
  ...Object.values(ITEMS).filter((it) => it.quiz).map((it) => ({ id: 'i-' + it.id, about: null, kind: 'item', key: it.id, answer: it.quiz.answer })),
];
const QUIZ_BY_ID = Object.fromEntries(QUIZ.map((q) => [q.id, q]));
export const QUIZ_TOTAL = QUIZ.length;

// Texto da pergunta no idioma atual, na ordem embaralhada `order`.
// explain: explicação da pergunta do cientista, ou a curiosidade do item.
export function quizText(id, order) {
  const q = QUIZ_BY_ID[id];
  if (!q) return null;
  const src = q.kind === 'char' ? charText(q.key) : itemText(q.key);
  const quiz = src.quiz || {};
  const opts = quiz.options || [];
  const ord = order || opts.map((_, i) => i);
  const answerText = opts[q.answer] || '';
  return {
    q: quiz.q || '',
    options: ord.map((i) => opts[i]),
    correct: ord.indexOf(q.answer),
    explain: q.kind === 'char' ? quiz.explain || '' : src.fact || '',
    words: answerWords(answerText),
  };
}

// Palavras da resposta certa (a curiosidade mostrada junto não pode entregá-la).
// Em chinês/japonês não há espaços: usa a resposta inteira.
function answerWords(text) {
  const lc = text.toLowerCase();
  const words = lc.split(/[^\p{L}\d-]+/u).filter((w) => w.length >= 5 || /\d/.test(w));
  if (/^(zh|ja)/.test(getLang()) && lc) words.push(lc.replace(/[\s（(].*$/u, ''));
  return words;
}

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export class Progress {
  constructor({ bus, store }) {
    this.store = store;
    this.data = this._load();
    this.player = null;
    this.stats = null;
    const me = (k) => !!k && k === this.player;
    bus.on('kart:driftEnd', ({ kart, level, cancelled }) => {
      if (!me(kart) || !this.stats) return;
      if (!cancelled && level > 0) {
        this.stats.driftBoosts++;
        this.stats.bestDrift = Math.max(this.stats.bestDrift, level);
      }
    });
    bus.on('item:use', ({ kart }) => { if (me(kart) && this.stats) this.stats.items++; });
    bus.on('kart:hit', ({ kart }) => { if (me(kart) && this.stats) this.stats.hits++; });
    bus.on('kart:trick', ({ kart }) => { if (me(kart) && this.stats) this.stats.tricks++; });
    bus.on('kart:boost', ({ kart, source }) => { if (me(kart) && this.stats && source === 'rocket') this.stats.rocket = true; });
  }

  _load() {
    const d = this.store.get('progress', null);
    const ok = d && typeof d === 'object';
    return {
      records: (ok && d.records) || {}, // 'cc|voltas' -> { time, char }
      bestLap: (ok && d.bestLap) || {}, // cc -> { time, char }
      places: (ok && d.places) || {}, // char -> { cc: melhor colocação }
      quiz: (ok && Array.isArray(d.quiz) && d.quiz) || [], // ids acertados
      factIdx: (ok && d.factIdx) || {}, // char -> próxima curiosidade
      races: (ok && d.races) || 0,
    };
  }

  _save() {
    this.store.set('progress', this.data);
  }

  get races() {
    return this.data.races;
  }

  // ---------- corrida ----------
  startRace(player) {
    this.player = player;
    this.stats = { driftBoosts: 0, bestDrift: 0, items: 0, hits: 0, tricks: 0, rocket: false };
  }

  // Fecha a corrida do jogador: atualiza recordes e troféus e devolve o resumo para a tela de resultado.
  finishRace(results, player, { cc, laps }) {
    const me = results.find((r) => r.kart === player);
    const place = me ? me.place : results.length;
    const finished = !!player.finished;
    const time = finished ? player.finishTime : null;
    const lapTimes = player.lapTimes || [];
    const bestLap = lapTimes.length ? Math.min(...lapTimes) : null;
    const d = this.data;
    const charId = player.character.id;
    const out = { place, time, bestLap, stats: { ...this.stats }, charId, cc, laps };

    const key = `${cc}|${laps}`;
    const prev = d.records[key];
    out.prevRecord = prev ? prev.time : null;
    if (finished && (!prev || time < prev.time)) {
      d.records[key] = { time, char: charId };
      out.newRecord = !!prev; // primeiro tempo registrado não é "novo recorde"
      out.firstRecord = !prev;
    }
    const prevLap = d.bestLap[cc];
    if (bestLap && (!prevLap || bestLap < prevLap.time)) {
      d.bestLap[cc] = { time: bestLap, char: charId };
      out.newBestLap = !!prevLap;
    }
    const pl = (d.places[charId] ||= {});
    const before = pl[cc] || 99;
    if (place < before) pl[cc] = place;
    if (place <= 3 && place < before) out.newMedal = place;
    d.races++;
    this._save();
    this.player = null;
    return out;
  }

  record(cc, laps) {
    return this.data.records[`${cc}|${laps}`] || null;
  }

  bestLapOf(cc) {
    return this.data.bestLap[cc] || null;
  }

  // Melhor colocação do cientista numa classe (ou null).
  bestPlace(charId, cc) {
    return this.data.places[charId]?.[cc] || null;
  }

  medalCount() {
    let n = 0;
    for (const c of CHARACTERS) for (const cc of Object.keys(CLASSES)) if ((this.data.places[c.id]?.[cc] || 99) <= 3) n++;
    return { n, total: CHARACTERS.length * Object.keys(CLASSES).length };
  }

  // ---------- curiosidades ----------
  // Alterna entre as curiosidades do cientista a cada chamada e devolve o índice escolhido.
  // avoid: palavras que não podem aparecer (para a curiosidade não entregar a resposta da pergunta).
  nextFact(charId, avoid = []) {
    const list = charText(charId).facts || [];
    if (!list.length) return 0;
    const start = (this.data.factIdx[charId] || 0) % list.length;
    const bad = (f) => avoid.some((w) => w && f.toLowerCase().includes(w));
    let i = start;
    for (let n = 0; n < list.length && bad(list[i]); n++) i = (i + 1) % list.length;
    if (bad(list[i])) i = start;
    this.data.factIdx[charId] = (i + 1) % list.length;
    this._save();
    return i;
  }

  randomFact() {
    const c = CHARACTERS[(Math.random() * CHARACTERS.length) | 0];
    const n = (charText(c.id).facts || []).length || 1;
    return { c, idx: (Math.random() * n) | 0 };
  }

  // ---------- perguntas ----------
  // Primeiro a do cientista escolhido; depois, uma ainda não acertada.
  // Devolve só a ordem das alternativas; o texto sai de quizText() no idioma da tela.
  pickQuiz(charId) {
    const done = new Set(this.data.quiz);
    let pool = QUIZ.filter((q) => q.about === charId && !done.has(q.id));
    if (!pool.length) pool = QUIZ.filter((q) => !done.has(q.id));
    if (!pool.length) pool = QUIZ; // acertou todas: continua sorteando
    const q = pool[(Math.random() * pool.length) | 0];
    return { id: q.id, about: q.about, order: shuffle([0, 1, 2]) };
  }

  answerQuiz(id, ok) {
    if (ok && !this.data.quiz.includes(id)) {
      this.data.quiz.push(id);
      this._save();
    }
  }

  quizScore() {
    const valid = new Set(QUIZ.map((q) => q.id));
    return { right: this.data.quiz.filter((id) => valid.has(id)).length, total: QUIZ_TOTAL };
  }
}
