// Corrida Quanta — contas, modos de jogo, respostas erradas plausíveis e a explicação depois de um erro.
// CORRIDA é o modo do ranking: as faixas de números são as de sempre e as regras de pontos, nível e
// velocidade (em index.html) são as que o servidor confere. Os treinos focam uma operação só.
(() => {
  'use strict';
  window.QC = window.QC || {};

  const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }

  // textos vêm do dicionário (js/i18n.js); sem ele, ficam em pt-BR
  const tt = (k, p, fb) => { const v = QC.t ? QC.t(k, p) : k; return v === k && fb !== undefined ? fb : v; };
  const mode = (id, extra) => Object.assign({
    id,
    get name() { return tt(`mode.${id}.name`); },
    get desc() { return tt(`mode.${id}.desc`); },
  }, extra);
  const MODES = {
    corrida: mode('corrida', { ranked: true }),
    somasub: mode('somasub', { ops: ['add', 'sub'] }),
    tabuada: mode('tabuada', { ops: ['mul'] }),
    divisao: mode('divisao', { ops: ['div'] }),
  };

  // ---------- modo CORRIDA (mesmas faixas da versão anterior) ----------
  function rankedType(level) {
    const types = ['add'];
    if (level >= 2) types.push('sub');
    if (level >= 3) types.push('mul');
    if (level >= 4) types.push('div');
    if (level >= 6) types.push('mix');
    // nos primeiros níveis, a operação nova aparece mais
    return level <= 4 && Math.random() < 0.6 ? types[types.length - 1] : pick(types);
  }
  function ranked(type, level) {
    const big = Math.max(0, level - 5);
    let a, b, c;
    switch (type) {
      case 'add': a = rand(2, 12 + big * 15); b = rand(2, 12 + big * 15); return { type, a, b, text: `${a} + ${b}`, ans: a + b };
      case 'sub': a = rand(6, 20 + big * 15); b = rand(1, a - 1); return { type, a, b, text: `${a} - ${b}`, ans: a - b };
      case 'mul': a = rand(2, 9 + Math.min(big, 3)); b = rand(2, 9); return { type, a, b, text: `${a} × ${b}`, ans: a * b };
      case 'div': { b = rand(2, 9); const q = rand(2, 9 + Math.min(big, 3)); return { type, a: b * q, b, text: `${b * q} ÷ ${b}`, ans: q }; }
      default:
        a = rand(2, 9); b = rand(2, 9);
        if (Math.random() < 0.5) { c = rand(1, 15); return { type: 'mixadd', a, b, c, text: `${a} × ${b} + ${c}`, ans: a * b + c }; }
        c = rand(1, Math.min(15, a * b - 1));
        return { type: 'mixsub', a, b, c, text: `${a} × ${b} - ${c}`, ans: a * b - c };
    }
  }

  // ---------- treinos: degraus pequenos, um conceito novo por nível ----------
  function mulPair(level) {
    if (level <= 1) return [pick([2, 3, 4, 5, 10]), rand(2, 10)];
    if (level === 2) return [rand(2, 6), rand(2, 10)];
    if (level <= 4) return [rand(2, 9), rand(2, 9)];
    // daqui em diante, metade das contas são as mais esquecidas (6, 7, 8 e 9)
    return Math.random() < 0.5 ? [rand(6, 9), rand(6, 9)] : [rand(2, 10), rand(3, 9)];
  }
  function train(type, level) {
    let a, b;
    const L = Math.min(level, 6);
    if (type === 'add') {
      if (L === 1) { a = rand(1, 9); b = rand(1, 10 - a); }                 // até 10
      else if (L === 2) { a = rand(2, 9); b = rand(2, 9); }                  // passa de 10
      else if (L === 3) { a = rand(11, 49); b = rand(2, 9); }                // dezena + unidade
      else if (L === 4) { a = rand(11, 49); b = rand(11, 49); }
      else if (L === 5) { a = rand(15, 99); b = rand(15, 99); }
      else { a = rand(101, 399); b = rand(12, 99); }                         // centenas
      if (Math.random() < 0.5) [a, b] = [b, a];
      return { type, a, b, text: `${a} + ${b}`, ans: a + b };
    }
    if (type === 'sub') {
      if (L === 1) { a = rand(3, 10); b = rand(1, a - 1); }
      else if (L === 2) { a = rand(11, 18); b = rand(2, 9); }
      else if (L === 3) { a = rand(21, 59); b = rand(2, 9); }
      else if (L === 4) { a = rand(30, 69); b = rand(11, a - 5); }
      else if (L === 5) { a = rand(50, 99); b = rand(12, a - 5); }
      else { a = rand(120, 399); b = rand(12, 99); }
      return { type, a, b, text: `${a} - ${b}`, ans: a - b };
    }
    const [x, y] = mulPair(level);
    if (type === 'mul') {
      [a, b] = Math.random() < 0.5 ? [x, y] : [y, x];
      return { type, a, b, text: `${a} × ${b}`, ans: a * b };
    }
    // divisão: o divisor é um fator da tabuada do nível e o quociente o outro
    // nos dois primeiros níveis o divisor é sempre o fator fácil (2, 3, 4, 5 ou 10)
    const [d, q] = level <= 2 || Math.random() < 0.5 ? [x, y] : [y, x];
    b = Math.max(2, d);
    return { type: 'div', a: b * q, b, text: `${b * q} ÷ ${b}`, ans: q };
  }

  // ---------- respostas erradas: erros que um aluno comete de verdade ----------
  function distractors(q, count) {
    const { ans, type, a, b, c } = q;
    const typical = [];
    const near = [ans + 1, ans - 1, ans + 2, ans - 2];
    if (type === 'add') {
      if ((a % 10) + (b % 10) >= 10) typical.push(ans - 10);    // esqueceu o "vai um"
      if (ans >= 20) typical.push(ans + 10);
    } else if (type === 'sub') {
      if (a % 10 < b % 10) typical.push(ans + 10);              // tirou o menor do maior: 23 - 8 vira 25
      if (ans >= 20) typical.push(ans - 10);
    } else if (type === 'mul') {
      typical.push(a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b); // vizinhos na tabuada
    } else if (type === 'div') {
      if (b !== ans) typical.push(b);                            // trocou divisor e quociente
      typical.push(ans + 1, ans - 1);
    } else if (type === 'mixadd') {
      typical.push(a * (b + c), ans + 10, ans - 10);             // somou antes de multiplicar
    } else if (type === 'mixsub') {
      if (b > c) typical.push(a * (b - c));
      typical.push(ans + 10, ans - 10);
    }
    const ok = (v) => Number.isInteger(v) && v >= 0 && v !== ans;
    const T = shuffle([...new Set(typical)].filter(ok));
    const N = shuffle([...new Set(near)].filter(ok));
    const out = [];
    while (out.length < count && (T.length || N.length)) {
      const src = T.length && (!N.length || Math.random() < 0.55) ? T : N;
      const v = src.shift();
      if (!out.includes(v)) out.push(v);
    }
    for (let k = 3; out.length < count; k++) {
      for (const v of [ans + k, ans - k]) if (out.length < count && ok(v) && !out.includes(v)) out.push(v);
    }
    return out;
  }

  // ---------- nova pergunta, sem repetir as últimas ----------
  function keyOf(q) {
    return q.type + ':' + (q.type === 'add' || q.type === 'mul' ? [q.a, q.b].sort((x, y) => x - y).join(',') : q.text);
  }
  function make(modeId, level, n, recent) {
    const m = MODES[modeId] || MODES.corrida;
    let q = null;
    for (let tries = 0; tries < 30; tries++) {
      q = m.ranked ? ranked(rankedType(level), level) : train(pick(m.ops), level);
      if (!recent || !recent.includes(keyOf(q))) break;
    }
    if (recent) { recent.push(keyOf(q)); if (recent.length > 14) recent.shift(); }
    q.wrong = distractors(q, n - 1);
    return q;
  }

  // ---------- explicação curta depois de um erro (sempre calculada, nunca decorada) ----------
  // cada idioma tem a sua frase (chaves ex.* em i18n.js); os números são calculados aqui
  const MUL_TRICK = [10, 2, 5, 9, 4, 3, 11, 6, 8, 7, 12];
  function mulHow(a, b) {
    const ra = MUL_TRICK.indexOf(a), rb = MUL_TRICK.indexOf(b);
    const f = rb !== -1 && (ra === -1 || rb < ra) ? b : a, n = f === a ? b : a, p = n * f;
    const v = { n, p, n2: n * 2, n4: n * 4, n5: n * 5, n10: n * 10 };
    if (f === 11 || f === 12) return tt('ex.mul.11', Object.assign(v, { f1: f - 10, nf: n * (f - 10) }));
    if ([10, 2, 5, 9, 4, 3, 6, 8, 7].includes(f)) return tt(`ex.mul.${f}`, v);
    return tt('ex.mul.plain', { a, b, p: a * b });
  }
  function explain(q) {
    const { type, a, b, c, ans } = q;
    if (type === 'add') {
      const x = Math.max(a, b), y = Math.min(a, b);
      if (y % 10 === 9) return tt('ex.add.nine', { x, y1: y + 1, s: x + y + 1, ans });
      const k = 10 - (x % 10);
      if (y < 10 && x % 10 && k < y) return tt('ex.add.ten', { x, k, xk: x + k, r: y - k, ans });
      if (y >= 10 && y % 10) { const t = y - (y % 10); return tt('ex.add.tens', { x, t, xt: x + t, u: y % 10, ans }); }
      if (y >= 10) return tt('ex.add.onlyTens', { x, y, ans });
      return tt('ex.add.count', { x, y, ans });
    }
    if (type === 'sub') {
      if (b % 10 === 9) return tt('ex.sub.nine', { a, b1: b + 1, d: a - b - 1, ans });
      const u = a % 10;
      if (b < 10 && u && u < b) return tt('ex.sub.ten', { a, u, au: a - u, r: b - u, ans });
      if (b >= 10 && b % 10) { const t = b - (b % 10); return tt('ex.sub.tens', { a, t, at: a - t, u: b % 10, ans }); }
      return tt('ex.sub.check', { ans, b, a });
    }
    if (type === 'mul') return mulHow(a, b);
    if (type === 'div') return tt('ex.div', { a, b, ans });
    if (type === 'mixadd' || type === 'mixsub') return tt(`ex.${type}`, { a, b, ab: a * b, c, ans });
    return '';
  }

  // ---------- dicas da tela final, pela operação em que a pessoa mais errou ----------
  // seed (0 a 1) escolhe a dica; com o mesmo seed, trocar o idioma mostra a mesma dica traduzida
  const TIP_TYPES = ['add', 'sub', 'mul', 'div', 'mix'];
  const tipList = (k) => (QC.I18N ? QC.I18N.list(`tips.${k}`) : []);
  function tipFor(type, seed) {
    const k = type === 'mixadd' || type === 'mixsub' ? 'mix' : type;
    const arr = TIP_TYPES.includes(k) ? tipList(k) : [].concat(...['add', 'sub', 'mul', 'div'].map(tipList));
    if (!arr.length) return '';
    return arr[Math.floor((seed === undefined ? Math.random() : seed) * arr.length) % arr.length];
  }

  QC.Questions = { MODES, make, distractors, explain, tipFor, TIP_TYPES, _ranked: ranked, _train: train, _keyOf: keyOf };
})();
