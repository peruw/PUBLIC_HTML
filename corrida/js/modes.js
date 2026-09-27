// Corrida Quanta — modos de jogo: Matemática (contas geradas), Química e Física (bancos em js/banks.js).
// Texto "rico": _x ou _{xy} = índice (subscrito), ^x ou ^{xy} = expoente. Ex.: H_2O, C_6H_{12}O_6, v_0^2.
// Cada pergunta: { key, kind, title, text, ans, wrong: [...], why }
//   key   identifica a pergunta (sem repetir na mesma corrida; relatório da sala)
//   title linha de cima (opcional), text o que se pede, why a explicação mostrada depois do erro
// make(level, n, ctx): ctx.rng() sorteia (Math.random ou o gerador semeado da sala) e ctx.recent guarda as últimas chaves.
(() => {
  'use strict';
  window.QC = window.QC || {};

  // ================= Sorteio =================
  // gerador determinístico (mulberry32): a mesma semente dá a mesma sequência em qualquer aparelho
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash32 = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  // gerador da pergunta nº i de uma sala: só depende da semente e de i (todos veem as mesmas perguntas)
  const rngFor = (seed, i) => mulberry32(hash32(String(seed) + ':' + i));

  const R = {
    rng: Math.random,
    int(a, b) { return a + Math.floor(R.rng() * (b - a + 1)); },
    pick(arr) { return arr[Math.floor(R.rng() * arr.length)]; },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(R.rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      return arr;
    },
    chance(p) { return R.rng() < p; },
  };

  // ================= Utilidades =================
  const fmtNum = (v) => {
    const r = Math.round(v * 100) / 100;
    return String(r).replace('.', ',');
  };
  // completa as erradas com respostas de outras perguntas do mesmo banco; garante count distintas e ≠ certa
  function fill(ans, traps, pool, count) {
    const seen = new Set([norm(ans)]);
    const out = [];
    const add = (v) => { if (v == null) return; const k = norm(v); if (seen.has(k)) return; seen.add(k); out.push(v); };
    R.shuffle(traps.slice()).forEach((t) => { if (out.length < count) add(t); });
    R.shuffle(pool.slice()).forEach((t) => { if (out.length < count) add(t); });
    return out.slice(0, count);
  }
  const norm = (v) => String(v).replace(/\s+/g, '').toLowerCase();
  // distratores numéricos: valores dados (erros típicos) e, se faltar, vizinhos
  function numFill(ans, candidates, count, unit, step) {
    const seen = new Set([ans]);
    const out = [];
    const add = (v) => { if (typeof v !== 'number' || !isFinite(v) || v <= 0 || seen.has(v)) return; seen.add(v); out.push(v); };
    R.shuffle(candidates.slice()).forEach((v) => { if (out.length < count) add(Math.round(v * 100) / 100); });
    for (let k = 1; out.length < count; k++) { add(ans + k * step); if (out.length < count) add(ans - k * step); }
    return out.map((v) => fmtNum(v) + (unit ? ' ' + unit : ''));
  }
  const withUnit = (v, unit) => fmtNum(v) + (unit ? ' ' + unit : '');

  // átomos de cada elemento numa fórmula na notação rica: H_2SO_4 -> {H:2,S:1,O:4}; Ca(OH)_2 -> {Ca:1,O:2,H:2}
  function parseFormula(s) {
    let i = 0;
    const num = () => {
      if (s[i] !== '_') return 1;
      i++;
      if (s[i] === '{') { const j = s.indexOf('}', i); const v = parseInt(s.slice(i + 1, j), 10); i = j + 1; return v || 1; }
      const v = parseInt(s[i], 10); i++; return v || 1;
    };
    const group = () => {
      const out = {};
      while (i < s.length) {
        const c = s[i];
        if (c === ')') break;
        if (c === '(') {
          i++; const inner = group(); i++;
          const k = num();
          for (const e in inner) out[e] = (out[e] || 0) + inner[e] * k;
          continue;
        }
        const m = /^[A-Z][a-z]?/.exec(s.slice(i));
        if (!m) { i++; continue; }
        i += m[0].length;
        const k = num();
        out[m[0]] = (out[m[0]] || 0) + k;
      }
      return out;
    };
    return group();
  }
  // massas atômicas arredondadas (as usadas em sala de aula)
  const MASS = {
    H: 1, He: 4, Li: 7, Be: 9, B: 11, C: 12, N: 14, O: 16, F: 19, Ne: 20, Na: 23, Mg: 24, Al: 27, Si: 28, P: 31, S: 32,
    Cl: 35.5, Ar: 40, K: 39, Ca: 40, Ti: 48, Cr: 52, Mn: 55, Fe: 56, Co: 59, Ni: 59, Cu: 63.5, Zn: 65, Br: 80, Ag: 108,
    Sn: 119, I: 127, Ba: 137, Pt: 195, Au: 197, Hg: 201, Pb: 207, U: 238,
  };
  function molarMass(formula) {
    const at = parseFormula(formula);
    let m = 0;
    for (const e in at) { if (!(e in MASS)) return null; m += MASS[e] * at[e]; }
    return Math.round(m * 10) / 10;
  }
  const CLS_NAME = { acido: 'Ácido', base: 'Base', sal: 'Sal', oxido: 'Óxido' };
  // nome do elemento pelo símbolo (para explicar contagens)
  const elName = (sym) => { const e = B().elements.find((x) => x.symbol === sym); return e ? e.name : sym; };
  // subscritos Unicode para explicações em texto corrido: H_2O -> H₂O
  const plain = (rich) => String(rich)
    .replace(/_\{([^}]*)\}/g, (m, d) => sub(d)).replace(/_(\S)/g, (m, d) => sub(d))
    .replace(/\^\{([^}]*)\}/g, (m, d) => sup(d)).replace(/\^(\S)/g, (m, d) => sup(d));
  const sub = (s) => String(s).replace(/[0-9+\-]/g, (c) => '₀₁₂₃₄₅₆₇₈₉₊₋'['0123456789+-'.indexOf(c)]);
  const sup = (s) => String(s).replace(/[0-9+\-]/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻'['0123456789+-'.indexOf(c)]);

  // ================= Matemática =================
  function mathQuestion(level, n) {
    let a, b, c, text, ans;
    const big = Math.max(0, level - 5);
    const types = ['add'];
    if (level >= 2) types.push('sub');
    if (level >= 3) types.push('mul');
    if (level >= 4) types.push('div');
    if (level >= 6) types.push('mix');
    const type = level <= 4 && R.chance(0.6) ? types[types.length - 1] : R.pick(types);
    switch (type) {
      case 'add': a = R.int(2, 12 + big * 15); b = R.int(2, 12 + big * 15); text = `${a} + ${b}`; ans = a + b; break;
      case 'sub': a = R.int(6, 20 + big * 15); b = R.int(1, a - 1); text = `${a} - ${b}`; ans = a - b; break;
      case 'mul': a = R.int(2, 9 + Math.min(big, 3)); b = R.int(2, 9); text = `${a} × ${b}`; ans = a * b; break;
      case 'div': b = R.int(2, 9); ans = R.int(2, 9 + Math.min(big, 3)); a = b * ans; text = `${a} ÷ ${b}`; break;
      case 'mix':
        a = R.int(2, 9); b = R.int(2, 9);
        if (R.chance(0.5)) { c = R.int(1, 15); text = `${a} × ${b} + ${c}`; ans = a * b + c; }
        else { c = R.int(1, a * b - 1); text = `${a} × ${b} - ${c}`; ans = a * b - c; }
        break;
    }
    const opts = [ans + 1, ans - 1, ans + 2, ans - 2, ans + 10, ans - 10, ans + 3, ans - 3];
    if (type === 'mul') opts.push(a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b, a + b);
    if (type === 'div') opts.push(b, ans * 2);
    if (type === 'sub') opts.push(a + b);
    if (type === 'add') opts.push(Math.abs(a - b));
    const pool = R.shuffle([...new Set(opts)].filter((v) => v !== ans && v >= 0));
    const wrong = pool.slice(0, n - 1);
    for (let k = 4; wrong.length < n - 1; k++) if (!wrong.includes(ans + k)) wrong.push(ans + k);
    return { key: 'mat:' + text, kind: type, title: '', text, ans, wrong, why: '' };
  }

  // ================= Química =================
  const B = () => QC.Banks || { elements: [], molecules: [], physics: [], bio: [], geo: [] };
  const elsOf = (tiers) => B().elements.filter((e) => tiers.includes(e.tier));
  const molsOf = (tiers) => B().molecules.filter((m) => tiers.includes(m.tier));

  const chem = {
    // nome -> símbolo
    sym(tiers, n) {
      const bank = elsOf(tiers); if (!bank.length) return null;
      const e = R.pick(bank);
      return { key: 'quim:sym:' + e.symbol, kind: 'sym', title: e.name, text: 'Símbolo', ans: e.symbol,
        wrong: fill(e.symbol, e.traps, bank.map((x) => x.symbol), n - 1), why: e.why };
    },
    // símbolo -> nome
    name(tiers, n) {
      const bank = elsOf(tiers); if (!bank.length) return null;
      const e = R.pick(bank);
      const all = B().elements;
      const similar = all.filter((x) => x.symbol !== e.symbol && (x.symbol[0] === e.symbol[0] || x.name[0] === e.name[0])).map((x) => x.name);
      return { key: 'quim:name:' + e.symbol, kind: 'name', title: `Símbolo ${e.symbol}`, text: 'Elemento', ans: e.name,
        wrong: fill(e.name, similar, all.map((x) => x.name), n - 1), why: e.why };
    },
    // número atômico
    z(tiers, n) {
      const bank = elsOf(tiers).filter((e) => e.z); if (!bank.length) return null;
      const e = R.pick(bank);
      const wrong = numFill(e.z, [e.z + 1, e.z - 1, e.z + 2, e.z - 2, Math.round(e.mass), e.z * 2], n - 1, '', 1);
      return { key: 'quim:z:' + e.symbol, kind: 'z', title: `${e.name} (${e.symbol})`, text: 'Número atômico', ans: String(e.z), wrong,
        why: `${e.name} tem número atômico ${e.z}: ${e.z} prótons no núcleo.` };
    },
    // nome -> fórmula
    formula(tiers, n) {
      const bank = molsOf(tiers); if (!bank.length) return null;
      const m = R.pick(bank);
      return { key: 'quim:formula:' + m.formula, kind: 'formula', title: m.name, text: 'Fórmula', ans: m.formula,
        wrong: fill(m.formula, m.traps, bank.map((x) => x.formula), n - 1), why: m.why };
    },
    // fórmula -> nome
    molname(tiers, n) {
      const bank = molsOf(tiers); if (!bank.length) return null;
      const m = R.pick(bank);
      const all = B().molecules;
      const similar = all.filter((x) => m.traps.some((t) => norm(t) === norm(x.formula))).map((x) => x.name);
      return { key: 'quim:molname:' + m.formula, kind: 'molname', title: m.formula, text: 'Substância', ans: m.name,
        wrong: fill(m.name, similar, all.map((x) => x.name), n - 1), why: m.why };
    },
    // quantos átomos de um elemento (ou no total) numa fórmula
    count(tiers, n) {
      const bank = molsOf(tiers).filter((m) => Object.keys(parseFormula(m.formula)).length >= 2); if (!bank.length) return null;
      const m = R.pick(bank);
      const at = parseFormula(m.formula);
      const syms = Object.keys(at);
      const total = syms.reduce((s, e) => s + at[e], 0);
      if (R.chance(0.3)) {
        const wrong = numFill(total, [total - 1, total + 1, syms.length, total - syms.length + 1, total * 2], n - 1, '', 1);
        return { key: 'quim:count:' + m.formula + ':*', kind: 'count', title: m.formula, text: 'Átomos no total', ans: String(total), wrong,
          why: `${plain(m.formula)}: ${syms.map((e) => `${at[e]} ${e}`).join(' + ')} = ${total} átomos.` };
      }
      const e = R.pick(syms);
      const others = syms.filter((x) => x !== e).map((x) => at[x]);
      const wrong = numFill(at[e], [at[e] + 1, at[e] - 1, ...others, total, at[e] * 2], n - 1, '', 1);
      return { key: 'quim:count:' + m.formula + ':' + e, kind: 'count', title: m.formula, text: `Átomos de ${e}`, ans: String(at[e]), wrong,
        why: `Em ${plain(m.formula)} há ${at[e]} átomo${at[e] > 1 ? 's' : ''} de ${elName(e).toLowerCase()} (${e}).` };
    },
    // ácido, base, sal ou óxido
    cls(tiers, n) {
      const bank = molsOf(tiers).filter((m) => CLS_NAME[m.cls]); if (!bank.length) return null;
      const m = R.pick(bank);
      const ans = CLS_NAME[m.cls];
      const wrong = fill(ans, Object.values(CLS_NAME), [], n - 1);
      const dica = { acido: 'ácidos liberam H⁺ em água (começam com H)', base: 'bases têm OH⁻ (hidróxidos)', sal: 'sais vêm de ácido + base', oxido: 'óxidos são binários com oxigênio' }[m.cls];
      const nome = m.name.replace(/\s*\([^)]*\)/g, '');
      return { key: 'quim:cls:' + m.formula, kind: 'cls', title: m.formula, text: 'Função', ans, wrong,
        why: `${nome} (${plain(m.formula)}) é ${ans.toLowerCase()}: ${dica}.` };
    },
    // massa molar
    molar(tiers, n) {
      const bank = molsOf(tiers).filter((m) => molarMass(m.formula) !== null && Object.keys(parseFormula(m.formula)).length <= 4); if (!bank.length) return null;
      const m = R.pick(bank);
      const at = parseFormula(m.formula);
      const ans = molarMass(m.formula);
      const uniq = Object.keys(at).reduce((s, e) => s + MASS[e], 0);          // esqueceu os índices
      const cands = [uniq, ans - 1, ans + 1, ans - 16, ans + 16, ans - 2, ans + 2, ans * 2, ans / 2];
      const wrong = numFill(ans, cands, n - 1, 'g/mol', 1);
      const conta = Object.keys(at).map((e) => `${at[e] > 1 ? at[e] + '·' : ''}${fmtNum(MASS[e])}`).join(' + ');
      return { key: 'quim:molar:' + m.formula, kind: 'molar', title: m.formula, text: 'Massa molar', ans: withUnit(ans, 'g/mol'), wrong,
        why: `M(${plain(m.formula)}) = ${conta} = ${fmtNum(ans)} g/mol.` };
    },
  };
  // progressão: átomos -> contagem e nomes -> fórmulas e funções -> massa molar e substâncias difíceis
  const CHEM_PLAN = [
    /* 1 */ [['sym', ['facil']]],
    /* 2 */ [['sym', ['facil']], ['sym', ['facil']], ['name', ['facil']]],
    /* 3 */ [['sym', ['medio']], ['sym', ['medio']], ['name', ['facil', 'medio']], ['count', ['facil']]],
    /* 4 */ [['sym', ['medio']], ['count', ['facil']], ['formula', ['facil']], ['z', ['facil']]],
    /* 5 */ [['formula', ['facil']], ['formula', ['facil']], ['count', ['facil', 'medio']], ['cls', ['facil', 'medio']], ['name', ['medio']]],
    /* 6 */ [['formula', ['medio']], ['formula', ['facil', 'medio']], ['cls', ['facil', 'medio']], ['count', ['medio']], ['sym', ['dificil']]],
    /* 7 */ [['formula', ['medio']], ['molname', ['facil', 'medio']], ['molar', ['facil']], ['cls', ['medio']], ['z', ['facil', 'medio']]],
    /* 8 */ [['formula', ['dificil']], ['molar', ['facil', 'medio']], ['molname', ['medio', 'dificil']], ['count', ['dificil']], ['sym', ['dificil']]],
    /* 9+ */ [['formula', ['dificil']], ['molar', ['medio']], ['molname', ['dificil']], ['cls', ['medio']], ['count', ['dificil']], ['name', ['dificil']], ['z', ['medio', 'dificil']]],
  ];
  function chemistry(level, n) {
    const plan = CHEM_PLAN[Math.min(level, CHEM_PLAN.length) - 1];
    // de vez em quando volta um tipo de nível anterior, para revisar
    const src = level > 2 && R.chance(0.2) ? CHEM_PLAN[R.int(0, Math.min(level, CHEM_PLAN.length) - 2)] : plan;
    for (let t = 0; t < 6; t++) {
      const [kind, tiers] = R.pick(src);
      const q = chem[kind](tiers, n);
      if (q) return q;
    }
    return chem.sym(['facil', 'medio', 'dificil'], n);
  }

  // ================= Física =================
  const physOf = (tiers) => B().physics.filter((e) => tiers.includes(e.tier));
  const phys = {
    // nome -> equação
    eq(tiers, n) {
      const bank = physOf(tiers); if (!bank.length) return null;
      const e = R.pick(bank);
      return { key: 'fis:eq:' + e.name, kind: 'eq', title: e.name, text: e.lhs, ans: e.rhs,
        wrong: fill(e.rhs, e.traps, bank.map((x) => x.rhs), n - 1), why: e.why };
    },
    // grandeza -> unidade SI
    unit(tiers, n) {
      // só grandezas de verdade (a conversão km/h -> m/s já tem a unidade no nome)
      const bank = physOf(tiers).filter((e) => e.unit && e.unit !== 'adimensional' && !/km\/h/.test(e.name)); if (!bank.length) return null;
      const e = R.pick(bank);
      const pool = [...new Set(B().physics.map((x) => x.unit))];
      return { key: 'fis:unit:' + e.name, kind: 'unit', title: e.name, text: `Unidade de ${e.lhs}`, ans: e.unit,
        wrong: fill(e.unit, e.unit_traps || [], pool, n - 1), why: `${e.name}: ${e.lhs} = ${e.rhs}, medida em ${plain(e.unit)} no SI.` };
    },
    // conta com números pequenos (usa a força do cálculo mental do jogo)
    num(tier, n) {
      const T = NUMERIC.filter((t) => t.tier <= tier);
      const tpl = R.pick(T);
      const q = tpl.make();
      const wrong = numFill(q.ans, q.traps, n - 1, tpl.unit, q.step || 1);
      return { key: 'fis:num:' + tpl.id + ':' + q.key, kind: 'num', title: `${tpl.name}: ${q.given}`, text: tpl.lhs, ans: withUnit(q.ans, tpl.unit), wrong,
        why: `${tpl.lhs} = ${tpl.formula} = ${q.steps} = ${withUnit(q.ans, tpl.unit)}` };
    },
  };
  // g = 10 m/s², c da água = 1 cal/(g·°C)
  const NUMERIC = [
    { id: 'fma', tier: 1, name: '2ª lei de Newton', lhs: 'F', formula: 'm·a', unit: 'N',
      make() { const m = R.pick([2, 3, 4, 5, 6, 8, 10]), a = R.pick([2, 3, 4, 5]); return { key: m + ':' + a, given: `m = ${m} kg, a = ${a} m/s^2`, ans: m * a, traps: [m + a, m * a * 2, Math.abs(m - a), m], steps: `${m}·${a}` }; } },
    { id: 'peso', tier: 1, name: 'Peso', lhs: 'P', formula: 'm·g', unit: 'N',
      make() { const m = R.pick([2, 3, 5, 6, 8, 10, 12, 15, 20]); return { key: String(m), given: `m = ${m} kg, g = 10 m/s^2`, ans: m * 10, traps: [m, m * 5, m + 10, m * 100], steps: `${m}·10` }; } },
    { id: 'vmed', tier: 1, name: 'Velocidade média', lhs: 'v_m', formula: 'Δs/Δt', unit: 'm/s',
      make() { const t = R.pick([2, 4, 5, 10, 20]), v = R.pick([3, 5, 8, 10, 12, 15, 20]), d = v * t; return { key: d + ':' + t, given: `Δs = ${d} m, Δt = ${t} s`, ans: v, traps: [d * t, d + t, v * 2, d - t], steps: `${d}/${t}` }; } },
    { id: 'dens', tier: 1, name: 'Densidade', lhs: 'd', formula: 'm/V', unit: 'g/cm^3',
      make() { const V = R.pick([2, 4, 5, 10, 20, 50]), d = R.pick([1, 2, 3, 5, 8]), m = d * V; return { key: m + ':' + V, given: `m = ${m} g, V = ${V} cm^3`, ans: d, traps: [m * V, m + V, d * 2, V], steps: `${m}/${V}` }; } },
    { id: 'press', tier: 1, name: 'Pressão', lhs: 'p', formula: 'F/A', unit: 'Pa',
      make() { const A = R.pick([2, 4, 5, 10]), p = R.pick([10, 20, 25, 50, 100]), F = p * A; return { key: F + ':' + A, given: `F = ${F} N, A = ${A} m^2`, ans: p, traps: [F * A, F + A, p * 2, A], steps: `${F}/${A}` }; } },
    { id: 'acel', tier: 1, name: 'Aceleração média', lhs: 'a_m', formula: 'Δv/Δt', unit: 'm/s^2',
      make() { const t = R.pick([2, 4, 5, 10]), a = R.pick([2, 3, 4, 5, 6]), dv = a * t; return { key: dv + ':' + t, given: `Δv = ${dv} m/s, Δt = ${t} s`, ans: a, traps: [dv * t, dv + t, a * 2, dv - t], steps: `${dv}/${t}` }; } },
    { id: 'ec', tier: 2, name: 'Energia cinética', lhs: 'E_c', formula: 'm·v^2/2', unit: 'J',
      make() { const m = R.pick([2, 4, 6, 8, 10]), v = R.pick([2, 3, 4, 5, 10]); const ans = m * v * v / 2; return { key: m + ':' + v, given: `m = ${m} kg, v = ${v} m/s`, ans, traps: [m * v * v, m * v / 2, m * v, m * v * v / 4], steps: `${m}·${v}^2/2`, step: ans >= 50 ? 10 : 2 }; } },
    { id: 'ep', tier: 2, name: 'Energia potencial gravitacional', lhs: 'E_p', formula: 'm·g·h', unit: 'J',
      make() { const m = R.pick([1, 2, 3, 4, 5, 10]), h = R.pick([2, 3, 5, 10, 20]); return { key: m + ':' + h, given: `m = ${m} kg, h = ${h} m, g = 10 m/s^2`, ans: m * 10 * h, traps: [m * h, m * 10, m * 10 * h / 2, m * 10 + h], steps: `${m}·10·${h}`, step: 10 }; } },
    { id: 'trab', tier: 2, name: 'Trabalho de uma força', lhs: 'τ', formula: 'F·d', unit: 'J',
      make() { const F = R.pick([5, 10, 20, 50]), d = R.pick([2, 3, 4, 5, 10]); return { key: F + ':' + d, given: `F = ${F} N, d = ${d} m (mesma direção)`, ans: F * d, traps: [F / d, F + d, F * d / 2, F * d * 2], steps: `${F}·${d}`, step: 5 }; } },
    { id: 'pot', tier: 2, name: 'Potência média', lhs: 'P', formula: 'τ/Δt', unit: 'W',
      make() { const t = R.pick([2, 4, 5, 10, 20]), P = R.pick([10, 20, 50, 100]), w = P * t; return { key: w + ':' + t, given: `τ = ${w} J, Δt = ${t} s`, ans: P, traps: [w * t, w + t, P * 2, t], steps: `${w}/${t}`, step: 5 }; } },
    { id: 'qmov', tier: 2, name: 'Quantidade de movimento', lhs: 'Q', formula: 'm·v', unit: 'kg·m/s',
      make() { const m = R.pick([2, 3, 4, 5, 10]), v = R.pick([2, 3, 4, 5, 10]); return { key: m + ':' + v, given: `m = ${m} kg, v = ${v} m/s`, ans: m * v, traps: [m * v * v / 2, m + v, m * v * 2, Math.abs(m - v)], steps: `${m}·${v}` }; } },
    { id: 'imp', tier: 2, name: 'Impulso', lhs: 'I', formula: 'F·Δt', unit: 'N·s',
      make() { const F = R.pick([5, 10, 20, 50]), t = R.pick([2, 3, 4, 5]); return { key: F + ':' + t, given: `F = ${F} N, Δt = ${t} s`, ans: F * t, traps: [F / t, F + t, F * t / 2, F], steps: `${F}·${t}`, step: 5 }; } },
    { id: 'hooke', tier: 2, name: 'Lei de Hooke', lhs: 'F_{el}', formula: 'k·x', unit: 'N',
      make() { const k = R.pick([20, 50, 100, 200]), x = R.pick([0.1, 0.2, 0.5, 1, 2]); return { key: k + ':' + x, given: `k = ${k} N/m, x = ${fmtNum(x)} m`, ans: k * x, traps: [k / x, k + x, k * x * x / 2, k * x * 2], steps: `${k}·${fmtNum(x)}`, step: 5 }; } },
    { id: 'ohm', tier: 3, name: '1ª lei de Ohm', lhs: 'U', formula: 'R·i', unit: 'V',
      make() { const Rr = R.pick([2, 5, 10, 20, 50]), i = R.pick([2, 3, 4, 5]); return { key: Rr + ':' + i, given: `R = ${Rr} Ω, i = ${i} A`, ans: Rr * i, traps: [Rr / i, Rr + i, Rr * i * 2, Rr], steps: `${Rr}·${i}`, step: 5 }; } },
    { id: 'pel', tier: 3, name: 'Potência elétrica', lhs: 'P', formula: 'U·i', unit: 'W',
      make() { const U = R.pick([12, 110, 220]), i = R.pick([1, 2, 3, 5, 10]); return { key: U + ':' + i, given: `U = ${U} V, i = ${i} A`, ans: U * i, traps: [U / i, U + i, U * i * 2, U], steps: `${U}·${i}`, step: 10 }; } },
    { id: 'onda', tier: 3, name: 'Velocidade de uma onda', lhs: 'v', formula: 'λ·f', unit: 'm/s',
      make() { const l = R.pick([2, 3, 4, 5, 10]), f = R.pick([2, 5, 10, 20, 50]); return { key: l + ':' + f, given: `λ = ${l} m, f = ${f} Hz`, ans: l * f, traps: [l / f, f / l, l + f, l * f * 2], steps: `${l}·${f}`, step: 5 }; } },
    { id: 'qsens', tier: 3, name: 'Calor sensível (água)', lhs: 'Q', formula: 'm·c·ΔT', unit: 'cal',
      make() { const m = R.pick([50, 100, 200, 500]), dT = R.pick([5, 10, 20, 30]); return { key: m + ':' + dT, given: `m = ${m} g, c = 1 cal/g°C, ΔT = ${dT} °C`, ans: m * dT, traps: [m + dT, m * dT / 2, m, m * dT * 2], steps: `${m}·1·${dT}`, step: 100 }; } },
    { id: 'periodo', tier: 3, name: 'Período', lhs: 'T', formula: '1/f', unit: 's',
      make() { const f = R.pick([2, 4, 5, 10, 20, 50]); return { key: String(f), given: `f = ${f} Hz`, ans: 1 / f, traps: [f, 2 / f, 1 / (2 * f), f / 2], steps: `1/${f}`, step: 0.05 }; } },
    { id: 'fcp', tier: 4, name: 'Força centrípeta', lhs: 'F_c', formula: 'm·v^2/R', unit: 'N',
      make() { const m = R.pick([1, 2, 4, 5]), v = R.pick([2, 4, 10]), Rr = R.pick([1, 2, 4]); const ans = m * v * v / Rr; return { key: m + ':' + v + ':' + Rr, given: `m = ${m} kg, v = ${v} m/s, R = ${Rr} m`, ans, traps: [m * v / Rr, m * v * v * Rr, m * v * v / 2, m * v * v], steps: `${m}·${v}^2/${Rr}`, step: 5 }; } },
    { id: 'phid', tier: 4, name: 'Pressão hidrostática', lhs: 'p', formula: 'ρ·g·h', unit: 'Pa',
      make() { const h = R.pick([1, 2, 3, 5, 10]); return { key: String(h), given: `ρ = 1000 kg/m^3, g = 10 m/s^2, h = ${h} m`, ans: 10000 * h, traps: [1000 * h, 100 * h, 10000 * h / 2, 10000 * h * 2], steps: `1000·10·${h}`, step: 10000 }; } },
    { id: 'epel', tier: 4, name: 'Energia potencial elástica', lhs: 'E_{el}', formula: 'k·x^2/2', unit: 'J',
      make() { const k = R.pick([100, 200, 400]), x = R.pick([0.5, 1, 2]); const ans = k * x * x / 2; return { key: k + ':' + x, given: `k = ${k} N/m, x = ${fmtNum(x)} m`, ans, traps: [k * x * x, k * x / 2, k * x, k * x * x / 4], steps: `${k}·${fmtNum(x)}^2/2`, step: ans >= 100 ? 50 : 5 }; } },
    { id: 'muv', tier: 4, name: 'Velocidade no MUV', lhs: 'v', formula: 'v_0 + a·t', unit: 'm/s',
      make() { const v0 = R.pick([0, 2, 5, 10]), a = R.pick([1, 2, 3, 5]), t = R.pick([2, 3, 4, 5, 10]); return { key: v0 + ':' + a + ':' + t, given: `v_0 = ${v0} m/s, a = ${a} m/s^2, t = ${t} s`, ans: v0 + a * t, traps: [v0 * a * t, v0 + a, a * t, v0 + a * t * t / 2], steps: `${v0} + ${a}·${t}`, step: 2 }; } },
  ];
  const PHYS_PLAN = [
    /* 1 */ [['eq', [1]], ['eq', [1]], ['unit', [1]]],
    /* 2 */ [['eq', [1]], ['unit', [1]], ['num', 1]],
    /* 3 */ [['eq', [2]], ['eq', [2]], ['num', 1], ['unit', [1, 2]]],
    /* 4 */ [['eq', [2]], ['num', 2], ['unit', [2]], ['eq', [1]]],
    /* 5 */ [['eq', [3]], ['eq', [3]], ['num', 2], ['unit', [2, 3]]],
    /* 6 */ [['eq', [3]], ['num', 3], ['unit', [3]], ['eq', [2]]],
    /* 7 */ [['eq', [4]], ['eq', [4]], ['num', 3], ['unit', [3, 4]]],
    /* 8 */ [['eq', [4]], ['num', 4], ['unit', [4]], ['eq', [3]]],
    /* 9+ */ [['eq', [4]], ['eq', [3, 4]], ['num', 4], ['unit', [1, 2, 3, 4]], ['eq', [1, 2]]],
  ];
  function physics(level, n) {
    const plan = PHYS_PLAN[Math.min(level, PHYS_PLAN.length) - 1];
    const src = level > 2 && R.chance(0.2) ? PHYS_PLAN[R.int(0, Math.min(level, PHYS_PLAN.length) - 2)] : plan;
    for (let t = 0; t < 6; t++) {
      const [kind, arg] = R.pick(src);
      const q = phys[kind](arg, n);
      if (q) return q;
    }
    return phys.eq([1, 2, 3, 4], n);
  }

  // ================= Biologia e Geografia (bancos genéricos) =================
  // item: { title, text, ans, traps: [3], why, tier: 1..4 } — o tier sobe a cada 2 níveis, com revisão dos anteriores
  function fromBank(name) {
    return (level, n) => {
      const bank = B()[name] || [];
      if (!bank.length) return null;
      const tier = Math.min(4, 1 + Math.floor((level - 1) / 2));
      const t = tier > 1 && R.chance(0.25) ? R.int(1, tier - 1) : tier;
      let pool = bank.filter((it) => it.tier === t);
      if (!pool.length) pool = bank;
      const it = R.pick(pool);
      const same = bank.filter((x) => x !== it && x.text === it.text).map((x) => x.ans);
      return { key: name + ':' + it.title + ':' + it.text, kind: name, title: it.title, text: it.text, ans: it.ans,
        wrong: fill(it.ans, it.traps, same, n - 1), why: it.why };
    };
  }

  // ================= Modos =================
  const MODES = {
    mat: {
      id: 'mat', name: 'Matemática', short: 'MAT', tag: 'CÁLCULO MENTAL', ranked: true, rich: false, maxPortals: 4,
      intro: 'Resolva a conta e atravesse o portal com a resposta certa. A cada acerto você corre mais rápido.',
      speed: { start: 16, step: 1.1, max: 46 },
      glyphs: ['π', 'Σ', '√', '∞', '÷', '×', '+', '=', '%', 'Δ', '∫', '7', '3', '9'],
      gen: mathQuestion,
      tips: [
        'Dica: na tabuada, confira o último algarismo. 7 × 8 termina em 6, então é 56.',
        'Dica: para somar 9, some 10 e tire 1.',
        'Dica: dividir é perguntar quantas vezes cabe. 42 ÷ 6? 6 × 7 = 42.',
        'Dica: número par vezes qualquer número dá sempre par.',
        'Dica: 25 - 8 é o mesmo que 25 - 10 + 2.',
        'Dica: na tabuada do 9, os algarismos do resultado somam 9.',
      ],
    },
    quim: {
      id: 'quim', name: 'Química', short: 'QUÍM', tag: 'ÁTOMOS E MOLÉCULAS', ranked: true, rich: true, maxPortals: 3,
      intro: 'Elementos, fórmulas, funções e massa molar. Começa nos símbolos e vai até as moléculas difíceis.',
      speed: { start: 12, step: 0.8, max: 32 },
      glyphs: ['H', 'O', 'C', 'Na', 'Cl', 'Fe', 'Au', 'H₂O', 'CO₂', 'mol', 'pH', 'Ca', 'K', 'N₂'],
      gen: chemistry,
      tips: [
        'Dica: vários símbolos vêm do latim. Sódio é Na (natrium), potássio é K (kalium).',
        'Dica: ouro é Au (aurum), prata é Ag (argentum) e chumbo é Pb (plumbum).',
        'Dica: o índice diz quantos átomos há. Em H₂O são 2 hidrogênios e 1 oxigênio.',
        'Dica: ozônio é O₃ e o oxigênio que respiramos é O₂.',
        'Dica: ácidos costumam começar com H: HCl, H₂SO₄, HNO₃.',
        'Dica: massa molar é a soma das massas dos átomos. H₂O: 2·1 + 16 = 18 g/mol.',
        'Dica: base tem OH no fim: NaOH, Ca(OH)₂. Óxido é só dois elementos, um deles o O.',
      ],
    },
    fis: {
      id: 'fis', name: 'Física', short: 'FÍS', tag: 'EQUAÇÕES DA FÍSICA', ranked: true, rich: true, maxPortals: 3,
      intro: 'Equações, unidades e contas com números redondos. As leis ficam mais difíceis a cada nível.',
      speed: { start: 11, step: 0.7, max: 28 },
      glyphs: ['F', 'v', 'a', 'Δ', 'λ', 'ω', 'g', 'Ω', 'J', 'W', 'N', 'θ', 'μ', 'E=mc²'],
      gen: physics,
      tips: [
        'Dica: energia cinética tem o v ao quadrado e dividido por 2: m·v²/2.',
        'Dica: confira as unidades. Força em N = kg·m/s², então F = m·a.',
        'Dica: v = λ·f. Onda com frequência maior tem comprimento menor na mesma velocidade.',
        'Dica: calor sensível muda a temperatura (m·c·ΔT); calor latente muda o estado (m·L).',
        'Dica: Coulomb e gravitação têm a mesma forma: produto das cargas (ou massas) sobre d².',
        'Dica: com g = 10 m/s², um corpo de 2 kg pesa 20 N.',
        'Dica: potência é energia por tempo: 600 J em 10 s são 60 W.',
      ],
    },
    bio: {
      id: 'bio', name: 'Biologia', short: 'BIO', tag: 'CÉLULAS, CORPO E VIDA', ranked: true, rich: true, maxPortals: 3,
      intro: 'Organelas, sistemas do corpo, ecologia e genética. Veja o assunto e atravesse o portal com a resposta certa.',
      speed: { start: 12, step: 0.8, max: 32 },
      glyphs: ['DNA', 'RNA', 'ATP', 'A', 'T', 'C', 'G', 'O₂', 'CO₂', '♀', '♂', 'Aa', 'Bb', 'pH'],
      gen: fromBank('bio'),
      tips: [
        'Dica: mitocôndria faz a respiração celular; cloroplasto faz a fotossíntese.',
        'Dica: no DNA, A pareia com T e C com G. No RNA, a timina vira uracila.',
        'Dica: produtores fazem o próprio alimento; consumidores comem outros seres.',
        'Dica: mitose faz 2 células iguais; meiose faz 4 com metade dos cromossomos.',
      ],
    },
    geo: {
      id: 'geo', name: 'Geografia', short: 'GEO', tag: 'BRASIL E MUNDO', ranked: true, rich: true, maxPortals: 3,
      intro: 'Capitais dos estados e dos países, regiões, biomas e rios. Veja o lugar e atravesse o portal certo.',
      speed: { start: 13, step: 0.9, max: 36 },
      glyphs: ['N', 'S', 'L', 'O', '°', '⌖', 'BR', 'RJ', 'SP', 'MG', 'BA', 'AM', 'RS', 'PE'],
      gen: fromBank('geo'),
      tips: [
        'Dica: Palmas é a capital do Tocantins, o estado mais novo do Brasil (1988).',
        'Dica: o Brasil tem 5 regiões: Norte, Nordeste, Centro-Oeste, Sudeste e Sul.',
        'Dica: Canberra, e não Sydney, é a capital da Austrália.',
        'Dica: a Amazônia é o maior bioma do Brasil; o Pampa fica no Rio Grande do Sul.',
      ],
    },
  };

  const RECENT = 12;
  // ctx: { rng, recent } — recent é mantido pelo jogo (zera a cada corrida)
  function make(modeId, level, n, ctx) {
    const m = MODES[modeId] || MODES.mat;
    const c = ctx || {};
    R.rng = c.rng || Math.random;
    const recent = c.recent || [];
    let q = null;
    for (let t = 0; t < 8; t++) {
      q = m.gen(level, n) || mathQuestion(level, n);
      if (!recent.includes(q.key)) break;
    }
    R.rng = Math.random;
    recent.push(q.key);
    if (recent.length > RECENT) recent.splice(0, recent.length - RECENT);
    // posição da resposta certa também é sorteada com o mesmo gerador (igual para todos na sala)
    return shuffled(q, c.rng || Math.random);
  }
  // embaralha as opções (a pergunta de treino volta com as mesmas opções, em outra ordem)
  function shuffled(q, r) {
    const rr = r || Math.random;
    const answers = [q.ans, ...q.wrong];
    for (let i = answers.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [answers[i], answers[j]] = [answers[j], answers[i]]; }
    return Object.assign({}, q, { answers, correct: answers.indexOf(q.ans) });
  }

  QC.Modes = {
    list: ['mat', 'quim', 'fis', 'bio', 'geo'],
    shuffled,
    get: (id) => MODES[id] || MODES.mat,
    all: MODES,
    make,
    rngFor,
    hash32,
    plain,
    parseFormula,
    molarMass,
  };
})();
