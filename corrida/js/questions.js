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

  const MODES = {
    corrida: { id: 'corrida', name: 'CORRIDA', short: 'TUDO', desc: 'As quatro operações, cada vez mais difíceis. Vale recorde e ranking.', ranked: true },
    somasub: { id: 'somasub', name: 'TREINO + −', short: '+ −', desc: 'Treino de adição e subtração: começa nos amigos do 10 e chega às centenas. Soma XP, mas não vale recorde nem ranking.', ops: ['add', 'sub'] },
    tabuada: { id: 'tabuada', name: 'TREINO ×', short: '×', desc: 'Treino de tabuada: começa no 2, 3, 4, 5 e 10 e termina nas difíceis, como 7 × 8. Soma XP, mas não vale recorde nem ranking.', ops: ['mul'] },
    divisao: { id: 'divisao', name: 'TREINO ÷', short: '÷', desc: 'Treino de divisão exata, o caminho de volta da tabuada. Soma XP, mas não vale recorde nem ranking.', ops: ['div'] },
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
  const MUL_TRICK = [10, 2, 5, 9, 4, 3, 11, 6, 8, 7, 12];
  function mulHow(a, b) {
    const ra = MUL_TRICK.indexOf(a), rb = MUL_TRICK.indexOf(b);
    const f = rb !== -1 && (ra === -1 || rb < ra) ? b : a, n = f === a ? b : a, p = n * f;
    switch (f) {
      case 10: return `Vezes 10: acrescente um zero. ${n} × 10 = ${p}.`;
      case 2: return `Vezes 2 é o dobro: ${n} + ${n} = ${p}.`;
      case 5: return `Vezes 5 é a metade de vezes 10: ${n * 10} ÷ 2 = ${p}.`;
      case 9: return `Vezes 9 é vezes 10 menos uma vez: ${n * 10} - ${n} = ${p}.`;
      case 4: return `Vezes 4 é o dobro do dobro: ${n} × 2 = ${n * 2}, e ${n * 2} × 2 = ${p}.`;
      case 3: return `Vezes 3 é o dobro mais uma vez: ${n * 2} + ${n} = ${p}.`;
      case 6: return `Vezes 6 é vezes 5 mais uma vez: ${n * 5} + ${n} = ${p}.`;
      case 8: return `Vezes 8 é o dobro de vezes 4: ${n} × 4 = ${n * 4}, e ${n * 4} × 2 = ${p}.`;
      case 7: return `Vezes 7 é vezes 5 mais vezes 2: ${n * 5} + ${n * 2} = ${p}.`;
      case 11: case 12: return `${n} × 10 = ${n * 10}, mais ${n} × ${f - 10} = ${n * (f - 10)}: dá ${p}.`;
      default: return `${a} × ${b} = ${a * b}.`;
    }
  }
  function explain(q) {
    const { type, a, b, c, ans } = q;
    if (type === 'add') {
      const x = Math.max(a, b), y = Math.min(a, b);
      if (y % 10 === 9) return `Some ${y + 1} e tire 1: ${x} + ${y + 1} = ${x + y + 1}, menos 1 dá ${ans}.`;
      const k = 10 - (x % 10);
      if (y < 10 && x % 10 && k < y) return `Complete a dezena: ${x} + ${k} = ${x + k}, e ${x + k} + ${y - k} = ${ans}.`;
      if (y >= 10 && y % 10) { const t = y - (y % 10); return `Some as dezenas e depois as unidades: ${x} + ${t} = ${x + t}, e ${x + t} + ${y % 10} = ${ans}.`; }
      if (y >= 10) return `Some só as dezenas: ${x} + ${y} = ${ans}.`;
      return `Conte a partir do maior: ${x}, mais ${y}, dá ${ans}.`;
    }
    if (type === 'sub') {
      if (b % 10 === 9) return `Tire ${b + 1} e devolva 1: ${a} - ${b + 1} = ${a - b - 1}, mais 1 dá ${ans}.`;
      const u = a % 10;
      if (b < 10 && u && u < b) return `Desça até a dezena: ${a} - ${u} = ${a - u}, e ${a - u} - ${b - u} = ${ans}.`;
      if (b >= 10 && b % 10) { const t = b - (b % 10); return `Tire as dezenas e depois as unidades: ${a} - ${t} = ${a - t}, e ${a - t} - ${b % 10} = ${ans}.`; }
      return `Confira somando: ${ans} + ${b} = ${a}.`;
    }
    if (type === 'mul') return mulHow(a, b);
    if (type === 'div') return `Pense na tabuada do ${b}: ${b} × ${ans} = ${a}.`;
    if (type === 'mixadd') return `Primeiro a multiplicação: ${a} × ${b} = ${a * b}. Depois ${a * b} + ${c} = ${ans}.`;
    if (type === 'mixsub') return `Primeiro a multiplicação: ${a} × ${b} = ${a * b}. Depois ${a * b} - ${c} = ${ans}.`;
    return '';
  }

  // ---------- dicas da tela final, pela operação em que a pessoa mais errou ----------
  const TIPS = {
    add: [
      'Dica: para somar 9, some 10 e tire 1. 27 + 9 = 37 - 1 = 36.',
      'Dica: complete a dezena. 8 + 5 = 8 + 2 + 3 = 10 + 3 = 13.',
      'Dica: some primeiro as dezenas, depois as unidades. 34 + 25 = 54 + 5 = 59.',
    ],
    sub: [
      'Dica: 25 - 8 é o mesmo que 25 - 10 + 2 = 17.',
      'Dica: desça até a dezena. 23 - 8 = 23 - 3 - 5 = 20 - 5 = 15.',
      'Dica: confira a subtração somando. Se 42 - 17 = 25, então 25 + 17 tem que dar 42.',
    ],
    mul: [
      'Dica: confira o último algarismo. 12 × 8 termina em 6, porque 2 × 8 = 16. Então 94 e 98 já estão fora: é 96.',
      'Dica: de 9 × 2 até 9 × 10, os algarismos do resultado somam 9. 9 × 7 = 63, e 6 + 3 = 9.',
      'Dica: número par vezes qualquer número inteiro dá sempre par. 6 × 7 não pode ser 43.',
      'Dica: vezes 4 é o dobro do dobro. 7 × 4 = 14 × 2 = 28.',
    ],
    div: [
      'Dica: dividir é perguntar quantas vezes cabe. 42 ÷ 6? 6 × 7 = 42, então é 7.',
      'Dica: confira a divisão multiplicando. Se 56 ÷ 8 = 7, então 8 × 7 tem que dar 56.',
    ],
    mix: [
      'Dica: numa conta como 3 × 4 + 2, a multiplicação vem primeiro: 12 + 2 = 14, e não 3 × 6.',
    ],
  };
  const tipFor = (type) => pick(TIPS[type === 'mixadd' || type === 'mixsub' ? 'mix' : type] || [].concat(TIPS.add, TIPS.sub, TIPS.mul, TIPS.div));

  QC.Questions = { MODES, make, distractors, explain, tipFor, TIPS, _ranked: ranked, _train: train, _keyOf: keyOf };
})();
