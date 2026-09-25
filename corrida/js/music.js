/* Corrida Quanta: trilha sonora sintetizada (Web Audio puro, sem arquivos).
   Uma música por fase; o andamento acompanha a velocidade do corredor.

   const music = QC.Music.create(actx);   // master -> compressor -> actx.destination
   music.play(i)          troca na próxima barra (virada + crossfade); mesmo índice = nada muda
   music.setSpeed(m)      1.0 .. 2.9 -> andamento = bpm * (1 + (m - 1) * 0.35), suave, passo a passo
   music.setIntensity(x)  0..1: chimbal dobrado, contracanto, palmas/chocalho e melodia oitavada
   music.setMuted(b) / pause() / resume() / stop() / stinger('levelup'|'unlock'|'gameover'|'record')
   music.current          índice tocando (-1 parado) */
(() => {
  'use strict';
  const QC = window.QC = window.QC || {};

  const LOOKAHEAD = 0.12; // quanto à frente agendamos (s)
  const TICK_MS = 25;
  const MAX_LAG = 0.25;   // atraso maior que isso (aba em segundo plano): pula em vez de despejar notas
  const VOLUME = 0.35;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const warn = (msg) => { if (window.console) console.warn('[QC.Music] ' + msg); };
  function rng(seed) { // mulberry32: ruído determinístico (renderização offline repetível)
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ================= Músicas =================
  // Notação (uma letra por semicolcheia, 16 por compasso):
  //   melodia: c..b = oitava 4, C..B = oitava 5, '#' sustenido, '>' '<' mudam de oitava, '.' pausa, '-' sustenta
  //   baixo:   R raiz, O oitava, 5 quinta, 3 terça, 7 sétima, v quinta abaixo
  //   arpejo/contracanto: 0-9 = índice nas notas do acorde (subindo)
  //   pad: x = toca o acorde
  //   bateria: X forte, x normal, + fantasma, o/O chimbal aberto, 1-3 tons
  // `lv` equilibra a mistura (multiplica o volume de cada grupo de instrumentos).
  // Cada seção tem 4 compassos: ch = 4 acordes ('F,G' divide o compasso), dr = bateria de cada compasso,
  // x = prato na entrada, base = herda de outra seção. `form` define a ordem (>= 16 compassos antes de repetir).
  const DEFS = [
    { // 0 ─ chiptune alegre em Dó maior
      id: 'cidade', name: 'Cidade Quanta', bpm: 128,
      lv: { lead: 0.9, bass: 0.3, drums: 0.56, pad: 1.9, cnt: 1, arp: 3.2 },
      ins: {
        lead: { w: 'pulse', duty: 0.25, a: 0.004, d: 0.2, s: 0.55, r: 0.06, cut: 4200, g: 0.12, vib: 10 },
        bass: { w: 'triangle', a: 0.002, d: 0.08, s: 0.9, r: 0.03, g: 0.34, lo: 48 },
        pad: { w: 'pulse', duty: 0.5, a: 0.002, d: 0.07, s: 0, r: 0.03, cut: 2600, g: 0.03, lo: 60 },
        arp: { w: 'pulse', duty: 0.125, a: 0.002, d: 0.09, s: 0, r: 0.03, cut: 3200, g: 0.05, lo: 72 },
        cnt: { w: 'triangle', a: 0.004, d: 0.3, s: 0.25, r: 0.1, g: 0.08, lo: 67 },
      },
      kit: { k: { f0: 190, f1: 52, dec: 0.2, g: 0.55, w: 'triangle' }, s: { hp: 1800, g: 0.22, body: 0 }, h: { hp: 8500, g: 0.07 } },
      drums: {
        a: { k: 'X.......X.x.....', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.' },
        b: { k: 'X.......X.x...x.', s: '....X.......X.+.', h: 'x.x.x.x.x.x.x.o.' },
        d: { k: 'X...X...X...X...', s: '....X.......X...', h: '..o...o...o...o.' },
        c: { k: 'X.........X.....', s: '............x...', h: '..x...x...x...x.' },
        f: { k: 'X.....X.X.......', s: '....X...x.xxXXXX', h: 'x.x.x.x.........' },
      },
      def: { bass: 'R.O.R.O.R.O.5.O.', pad: '..x...x...x...x.', cnt: '4.......3...2...' },
      parts: {
        A: { ch: 'C G Am F', dr: 'aaab', x: 1, lead: [
          'E.G.E..D..C.D---',
          'D.b.g..a..b.D---',
          'C.E.C..b..a.b---',
          'a.C.F..E..D.C---'] },
        A2: { base: 'A', ch: 'C G Am G', dr: 'aaaf', x: 0, lead: [
          'E.G.E..D..C.D---',
          'D.E.D..b..g.a---',
          'C.E.A..G..E.C---',
          'b.D.G..F..E.D---'] },
        B: { ch: 'F G Em Am', dr: 'dddf', x: 1, bass: 'R..R..O.R..R..5.', arp: '0.1.2.3.4.3.2.1.', lead: [
          'C-C-C---D-C-a---',
          'D-D-D---E-D-b---',
          'E-E-E---G-E-b---',
          'C---b---a-------'] },
        C: { ch: 'Am F Dm G', dr: 'cccf', bass: 'R.......R...5...', arp: '0123012301230123', lead: [
          '................',
          '................',
          'A---G---F---E---',
          'D---E---F---G---'] },
      },
      form: ['A', 'A2', 'B', 'C'],
    },
    { // 1 ─ synthwave em Lá menor, baixo em semicolcheias
      id: 'neon', name: 'Pôr do Sol Neon', bpm: 112,
      lv: { lead: 0.92, bass: 0.63, drums: 0.41, pad: 1.15, cnt: 0.86, arp: 1.4 },
      ins: {
        lead: { w: 'sawtooth', det: 7, a: 0.012, d: 0.3, s: 0.7, r: 0.18, cut: 2300, q: 2, fe: 1.2, fd: 0.25, g: 0.085, vib: 14 },
        bass: { w: 'sawtooth', a: 0.003, d: 0.12, s: 0.35, r: 0.04, cut: 600, q: 5, fe: 3, fd: 0.08, g: 0.2, lo: 36 },
        pad: { w: 'sawtooth', det: 12, a: 0.015, d: 0.25, s: 0.6, r: 0.07, cut: 1500, g: 0.022, lo: 57 },
        arp: { w: 'square', a: 0.003, d: 0.12, s: 0, r: 0.05, cut: 2400, fe: 1, fd: 0.1, g: 0.045, lo: 69 },
        cnt: { w: 'triangle', a: 0.01, d: 0.4, s: 0.3, r: 0.2, g: 0.07, lo: 67 },
      },
      mix: { snare: { rev: 0.4 }, lead: { dly: 0.3, rev: 0.3 } },
      kit: { k: { f0: 140, f1: 46, dec: 0.32, g: 0.62 }, s: { hp: 1200, dec: 0.2, g: 0.28, body: 180 }, h: { g: 0.06 } },
      drums: {
        a: { k: 'X.......X.......', s: '....X.......X...', h: '..x...x...x...x.' },
        b: { k: 'X.......X.x.....', s: '....X.......X...', h: '..x...x...x.x.x.' },
        c: { k: 'X...............', s: '........X.......', h: '..x...x...x...x.' },
        f: { k: 'X.......X.......', s: '....X...X.X.XXXX', h: '..x...x.........' },
      },
      def: { bass: 'RRORRRORRRORRROR', pad: 'x--.x--.x--.x--.', cnt: '3-------2-------' },
      parts: {
        A: { ch: 'Am F C G', dr: 'aaab', x: 1, lead: [
          'A---G---E-----C-',
          'D-----C-a-------',
          'G---E---C-----D-',
          'E-------D---b---'] },
        A2: { base: 'A', dr: 'aaaf', x: 0, lead: [
          'A---G---E-----C-',
          'D-----C-a-----C-',
          'G---E---G---A---',
          'B-------------..'] },
        B: { ch: 'F G Am Am', dr: 'bbbf', x: 1, arp: '0.2.1.3.2.4.3.5.', lead: [
          'a.a.a.g-a-C-a---',
          'b.b.b.a-b-D-b---',
          'C.C.C.b-C-E-C---',
          'E---D---C---b---'] },
        C: { ch: 'Dm Em F G', dr: 'cccf', pad: 'x---------------', arp: '0123012301230123', bass: 'R.......R.......', lead: [
          'F-----E-D-------',
          'E-----D-b-------',
          'C-----a-C-------',
          'D-------b-------'] },
      },
      form: ['A', 'A2', 'B', 'C'],
    },
    { // 2 ─ sonhadora, arpejos que fluem
      id: 'oceano', name: 'Oceano Digital', bpm: 120,
      lv: { lead: 0.46, bass: 0.39, drums: 0.51, pad: 0.74, cnt: 1, arp: 0.9 },
      ins: {
        lead: { w: 'triangle', a: 0.03, d: 0.4, s: 0.7, r: 0.3, cut: 3000, g: 0.15, vib: 16, vibRate: 4.5 },
        bass: { w: 'sawtooth', a: 0.01, d: 0.3, s: 0.7, r: 0.15, cut: 380, q: 1, g: 0.26, lo: 36 },
        pad: { w: 'sawtooth', det: 10, a: 0.35, d: 0.5, s: 0.8, r: 0.6, cut: 900, g: 0.022, lo: 55 },
        arp: { w: 'triangle', a: 0.003, d: 0.28, s: 0.05, r: 0.2, g: 0.075, lo: 60 },
        cnt: { w: 'sine', fm: 2, idx: 1.5, fmd: 0.2, a: 0.005, d: 0.5, s: 0, r: 0.3, g: 0.07, lo: 72 },
      },
      mix: { arp: { dly: 0.4, rev: 0.35 }, pad: { rev: 0.5 }, lead: { dly: 0.25, rev: 0.4 }, snare: { rev: 0.35 } },
      kit: { k: { f0: 110, f1: 45, dec: 0.3, g: 0.45 }, s: { hp: 2500, dec: 0.1, g: 0.1, body: 0 }, c: { g: 0.14 }, h: { g: 0.045, hp: 9000 } },
      drums: {
        a: { k: 'X.....x...X.....', c: '....X.......X...', h: '..x...x...x...x.' },
        b: { k: 'X.....x...X...x.', c: '....X.......X...', h: '..x.x.x...x.x.x.' },
        c: { k: 'X...............', h: '..+...+...+...+.' },
        f: { k: 'X.....x...X.....', c: '....X.......X...', s: '..........+.x.X.', h: '..x...x.........' },
      },
      def: { bass: 'R-----R-R---5---', pad: 'x---------------', arp: '0123454321012345', cnt: '4-------5-------' },
      parts: {
        A: { ch: 'Cmaj7 Am7 Fmaj7 G', dr: 'aaab', x: 1, lead: [
          'G-------E---D---',
          'C-----------b-a-',
          'a-------E-------',
          'D-----------....'] },
        A2: { base: 'A', dr: 'aaaf', x: 0, lead: [
          'G-------E---D---',
          'C-----------D-E-',
          'F-------A-------',
          'G-----------....'] },
        B: { ch: 'Fmaj7 G Em7 Am7', dr: 'bbbf', x: 1, lead: [
          'A---G---E---C---',
          'D-----E-D-----b-',
          'E---D---b---g---',
          'a---------------'] },
        C: { ch: 'Dm7 Em7 Fmaj7 G', dr: 'cccf', lead: [
          'A---------------',
          'G---------------',
          'E---------------',
          'D-------b-------'] },
      },
      form: ['A', 'A2', 'B', 'C'],
    },
    { // 3 ─ tensa, Lá menor harmônico, baixo galopando
      id: 'meteoros', name: 'Chuva de Meteoros', bpm: 136,
      lv: { lead: 1.17, bass: 0.64, drums: 0.36, pad: 1.04, cnt: 0.86, arp: 3 },
      ins: {
        lead: { w: 'sawtooth', det: 5, a: 0.006, d: 0.15, s: 0.6, r: 0.08, cut: 2100, q: 3, fe: 1, fd: 0.12, g: 0.08, vib: 8 },
        bass: { w: 'square', a: 0.002, d: 0.09, s: 0.3, r: 0.03, cut: 800, q: 4, fe: 2, fd: 0.06, g: 0.15, lo: 36 },
        pad: { w: 'sawtooth', det: 14, a: 0.2, d: 0.4, s: 0.7, r: 0.3, cut: 1100, g: 0.02, lo: 57 },
        arp: { w: 'pulse', duty: 0.25, a: 0.002, d: 0.07, s: 0, r: 0.03, cut: 3500, g: 0.04, lo: 69 },
        cnt: { w: 'triangle', a: 0.005, d: 0.2, s: 0.3, r: 0.1, g: 0.07, lo: 72 },
      },
      kit: { k: { f0: 160, f1: 48, dec: 0.22, g: 0.6 }, s: { hp: 1500, dec: 0.13, g: 0.26, body: 200 }, h: { g: 0.06, hp: 8000 } },
      drums: {
        a: { k: 'X...X...X...X...', s: '....X.......X...', h: 'x.x+x.x+x.x+x.x+' },
        b: { k: 'X...X...X...X.X.', s: '....X.......X..+', h: 'x+x+x+x+x+x+x+x+' },
        c: { k: 'X.......X.......', s: '....X.......X...', h: '..x...x...x...x.' },
        f: { k: 'X...X...X.......', s: '....X...........', t: '........1.1.2.3.', h: 'x.x.x.x.........' },
      },
      def: { bass: 'R.ROR.ROR.ROR.RO', pad: 'x---------------', cnt: '4---3---4---5---' },
      parts: {
        A: { ch: 'Am Am F E', dr: 'aaab', x: 1, lead: [
          'E.E.E.F.E---C---',
          'E.E.E.F.E---A---',
          'F.F.F.G.F---C---',
          'E---D---b---g#---'] },
        A2: { base: 'A', dr: 'aaaf', x: 0, lead: [
          'A.A.A.G.A---E---',
          'A.A.A.G.A---E-C-',
          'F.F.F.G.A-G-F-A-',
          'B---G#---E---D---'] },
        B: { ch: 'Dm Am E Am', dr: 'bbbf', x: 1, bass: 'R.RRR.RRR.RRR.RR', arp: '0.1.2.1.3.1.2.1.', lead: [
          'D-.D.F.A-.F.D.F.',
          'E-.C.E.A-.E.C.E.',
          'D-.b.D.G#-.D.b.D.',
          'C---b---a-------'] },
        C: { ch: 'F G Am E', dr: 'cccf', arp: '0123012301230123', lead: [
          'A-------G-------',
          'b-------D-------',
          'C-------E-------',
          'E-------------..'] },
      },
      form: ['A', 'A2', 'B', 'C'],
    },
    { // 4 ─ pesada: baixo grave com drive, bumbo que soca
      id: 'vulcao', name: 'Vulcão', bpm: 140,
      lv: { lead: 0.76, bass: 0.23, drums: 0.21, pad: 1.06, cnt: 1.28, arp: 3 },
      ins: {
        lead: { w: 'square', harm: -12, a: 0.005, d: 0.2, s: 0.6, r: 0.08, cut: 1900, q: 2, fe: 0.8, fd: 0.15, g: 0.075, vib: 8 },
        bass: { w: 'sawtooth', det: 8, a: 0.002, d: 0.12, s: 0.5, r: 0.04, cut: 520, q: 3, fe: 2.2, fd: 0.07, g: 0.2, lo: 33 },
        pad: { w: 'sawtooth', det: 10, a: 0.1, d: 0.4, s: 0.7, r: 0.2, cut: 800, g: 0.02, lo: 52 },
        arp: { w: 'square', a: 0.002, d: 0.08, s: 0, r: 0.03, cut: 2000, g: 0.04, lo: 64 },
        cnt: { w: 'sawtooth', a: 0.01, d: 0.3, s: 0.4, r: 0.15, cut: 1600, g: 0.05, lo: 64 },
      },
      mix: { bass: { drive: 2.5, post: 1800 } },
      kit: { k: { f0: 175, f1: 42, sw: 0.07, dec: 0.36, g: 0.75, click: 0.25 }, s: { hp: 1000, dec: 0.18, g: 0.3, body: 170, bg: 0.25 }, h: { g: 0.06, hp: 7000 } },
      drums: {
        a: { k: 'X...X...X...X.X.', s: '....X.......X...', h: '..x...x...x...x.' },
        b: { k: 'X.X.X...X.X.X...', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.' },
        c: { k: 'X.......X.X.....', s: '........X.......', h: 'x...x...x...x...' },
        f: { k: 'X...X...X.......', s: '....X.......XXXX', t: '........1.2.....', h: 'x.x.x.x.........' },
      },
      def: { bass: 'R.RR.RR.R.RR.O5.', pad: 'x---------------', cnt: '0-------1-------' },
      parts: {
        A: { ch: 'Am Am F G', dr: 'aaab', x: 1, lead: [
          'a.a.g.a.C.a.g.e.',
          'a.a.g.a.D.C.a.g.',
          'a.a.g.a.C.a.F-E-',
          'D---b---g---D---'] },
        A2: { base: 'A', dr: 'aaaf', x: 0, lead: [
          'a.a.g.a.C.a.g.e.',
          'a.a.g.a.D.C.a.g.',
          'a.a.g.a.C.a.F-E-',
          'G---F---E---D---'] },
        B: { ch: 'Am G F E', dr: 'bbbf', x: 1, arp: '0.1.2.1.0.1.2.1.', lead: [
          'E-------C---E---',
          'D-------b---D---',
          'C-------a---C---',
          'b-------g#---b---'] },
        C: { ch: 'F G Am Am', dr: 'cccf', bass: 'R-------R---O---', lead: [
          '................',
          '................',
          'E---D---C---b---',
          'a-------E-------'] },
      },
      form: ['A', 'A2', 'B', 'C'],
    },
    { // 5 ─ saltitante e brincalhona, com swing
      id: 'doces', name: 'Terra dos Doces', bpm: 132, swing: 0.14,
      lv: { lead: 0.94, bass: 0.62, drums: 0.75, pad: 1.8, cnt: 0.86, arp: 0.85 },
      ins: {
        lead: { w: 'square', a: 0.003, d: 0.1, s: 0.25, r: 0.04, cut: 3200, g: 0.11 },
        bass: { w: 'triangle', a: 0.002, d: 0.12, s: 0.4, r: 0.04, g: 0.34, lo: 43 },
        pad: { w: 'square', a: 0.002, d: 0.05, s: 0, r: 0.03, cut: 2200, g: 0.03, lo: 60 },
        arp: { w: 'sine', fm: 3.5, idx: 2.5, fmd: 0.08, a: 0.002, d: 0.3, s: 0, r: 0.2, g: 0.08, lo: 72 },
        cnt: { w: 'sine', fm: 3.5, idx: 1.5, fmd: 0.06, a: 0.002, d: 0.35, s: 0, r: 0.2, g: 0.07, lo: 79 },
      },
      kit: { k: { f0: 200, f1: 60, dec: 0.15, g: 0.5, w: 'triangle' }, s: { hp: 3000, dec: 0.06, g: 0.16, body: 330, bg: 0.1 }, c: { g: 0.16 }, h: { g: 0.06, hp: 9000, dec: 0.025 } },
      drums: {
        a: { k: 'X.......X.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        b: { k: 'X.......X...x...', c: '....X.......X...', h: 'x.x.x.x.x.x.x.x.' },
        c: { k: 'X.......X.......', h: '..x...x...x...x.' },
        f: { k: 'X.......X.......', s: '....x...x.x.XXXX', h: 'x.x.x.x.........' },
      },
      def: { bass: 'R...5...R...5...', pad: '..x...x...x...x.', cnt: '2...4...3...5...' },
      parts: {
        A: { ch: 'C Am Dm G', dr: 'aaab', x: 1, lead: [
          'E.G.E.C.D.E.C...',
          'C.E.C.a.b.C.a...',
          'D.F.D.a.b.C.D.E.',
          'F.E.D.C.b-..g...'] },
        A2: { base: 'A', dr: 'aaaf', x: 0, lead: [
          'E.G.E.C.D.E.C...',
          'C.E.C.a.b.C.a...',
          'D.F.A.F.E.D.C.b.',
          'b.D.G.F.E.C.D---'] },
        B: { ch: 'F G C Am', dr: 'bbbf', x: 1, arp: '0...2...4...2...', lead: [
          'F.a.C.a.F.a.C.F.',
          'G.b.D.b.G.b.D.G.',
          'E.g.C.g.E.g.C.E.',
          'E.D.C.b.a---....'] },
        C: { ch: 'Dm7 G7 Cmaj7 Am7', dr: 'cccf', arp: '0.2.4.2.3.2.4.2.', lead: [
          'F...E...D.......',
          'F...D...b.......',
          'E...D...C.......',
          'C.b.a.g.a---....'] },
      },
      form: ['A', 'A2', 'B', 'C'],
    },
    { // 6 ─ sinos (FM) e ar, Fá lídio
      id: 'aurora', name: 'Aurora Polar', bpm: 118,
      lv: { lead: 0.58, bass: 0.27, drums: 0.56, pad: 0.54, cnt: 1.25, arp: 1.15 },
      ins: {
        lead: { w: 'sine', fm: 3.5, idx: 2.2, fmd: 0.12, a: 0.003, d: 0.9, s: 0, r: 0.5, cut: 5000, g: 0.16, oct: 1 },
        bass: { w: 'triangle', a: 0.01, d: 0.3, s: 0.8, r: 0.2, g: 0.3, lo: 36 },
        pad: { w: 'triangle', det: 9, a: 0.4, d: 0.5, s: 0.85, r: 0.8, cut: 2200, g: 0.035, lo: 57 },
        arp: { w: 'triangle', a: 0.003, d: 0.2, s: 0, r: 0.15, g: 0.06, lo: 69 },
        cnt: { w: 'sine', fm: 2, idx: 1, fmd: 0.3, a: 0.01, d: 0.6, s: 0.1, r: 0.4, g: 0.06, lo: 76 },
      },
      mix: { lead: { dly: 0.32, rev: 0.45 }, pad: { rev: 0.6 }, arp: { dly: 0.3, rev: 0.4 }, snare: { rev: 0.45 } },
      kit: { k: { f0: 120, f1: 45, dec: 0.3, g: 0.45 }, c: { g: 0.13, f: 1500 }, h: { g: 0.04, hp: 9500 } },
      drums: {
        a: { k: 'X.......X.......', c: '....X.......X...', h: '..+...+...+...+.' },
        b: { k: 'X.......X.x.....', c: '....X.......X...', h: '..x...x...x.+.x.' },
        c: { k: 'X...............', h: '..+...+...+...+.' },
        f: { k: 'X.......X.......', c: '....X.......X.X.', t: '..........1.2.3.', h: '..x...x.........' },
      },
      def: { bass: 'R-------5-------', pad: 'x---------------', arp: '0.1.2.3.2.1.2.3.', cnt: '5---------------' },
      parts: {
        A: { ch: 'Fmaj7 Cmaj7 G Am7', dr: 'aaab', x: 1, lead: [
          'c---e---a-------',
          'g---e---b-------',
          'd---g---b-------',
          'a-------g---e---'] },
        A2: { base: 'A', dr: 'aaaf', x: 0, lead: [
          'c---e---a-------',
          'g---e---d---c---',
          'd---g---b---C---',
          'C-------b---a---'] },
        B: { ch: 'Dm7 Em7 Fmaj7 G', dr: 'bbbf', x: 1, lead: [
          'f.a.C-..a.f.d...',
          'g.b.D-..b.g.e...',
          'a.C.E-..C.a.f...',
          'g-----b-D-------'] },
        C: { ch: 'Am7 G Fmaj7 Fmaj7', dr: 'cccf', arp: '0123432101234321', lead: [
          'e-------........',
          'd-------........',
          'c-------<b-------',
          'a--------------->'] },
      },
      form: ['A', 'A2', 'B', 'C'],
    },
    { // 7 ─ espacial: arpejos rápidos, solo desafinado
      id: 'galaxia', name: 'Galáxia', bpm: 144,
      lv: { lead: 1.1, bass: 0.6, drums: 0.34, pad: 0.86, cnt: 1, arp: 2.3 },
      ins: {
        lead: { w: 'sawtooth', det: 16, a: 0.02, d: 0.3, s: 0.7, r: 0.25, cut: 2600, q: 1.5, g: 0.075, vib: 18, vibRate: 5 },
        bass: { w: 'square', a: 0.002, d: 0.1, s: 0.4, r: 0.04, cut: 700, fe: 2, fd: 0.07, q: 3, g: 0.17, lo: 36 },
        pad: { w: 'sawtooth', det: 18, a: 0.5, d: 0.6, s: 0.8, r: 1, cut: 1300, g: 0.02, lo: 57 },
        arp: { w: 'sawtooth', a: 0.002, d: 0.1, s: 0, r: 0.05, cut: 1800, fe: 2.5, fd: 0.07, q: 4, g: 0.05, lo: 69 },
        cnt: { w: 'sine', fm: 3, idx: 1.5, fmd: 0.1, a: 0.003, d: 0.4, s: 0, r: 0.2, g: 0.06, lo: 79 },
      },
      mix: { arp: { dly: 0.35, pan: -0.35 }, lead: { dly: 0.3, rev: 0.35 }, pad: { rev: 0.5 } },
      kit: { k: { f0: 150, f1: 46, dec: 0.26, g: 0.6 }, c: { g: 0.18 }, h: { g: 0.06, hp: 8500 } },
      drums: {
        a: { k: 'X...X...X...X...', c: '....X.......X...', h: '..o...o...o...o.' },
        b: { k: 'X...X...X...X...', c: '....X.......X...', h: 'x.o.x.o.x.o.x.o.' },
        c: { h: '..x...x...x...x.' },
        f: { k: 'X...X...X...X...', c: '....X.......X...', s: '........x.x.XXXX', h: '..o...o.........' },
      },
      def: { bass: 'R.O.R.O.R.O.R.O.', pad: 'x---------------', arp: '0123012301230123', cnt: '..4...3...4...5.' },
      parts: {
        A: { ch: 'Am7 Fmaj7 C G', dr: 'aaab', x: 1, lead: [
          'E-------G---A---',
          'A-------G---E---',
          'G-------E---C---',
          'D-------------..'] },
        A2: { base: 'A', dr: 'aaaf', x: 0, lead: [
          'E-------G---A---',
          'A------->C<-------',
          'B-------G-------',
          'A---G---D-------'] },
        B: { ch: 'Dm7 Em7 Fmaj7 G', dr: 'bbbf', x: 1, arp: '0213243502132435', lead: [
          'D.F.A.>C<.A.F.D.F.',
          'E.G.B.>D<.B.G.E.G.',
          'F.A.>C.E.C<.A.F.A.',
          'G-------B-------'] },
        C: { ch: 'Am7 Am7 Fmaj7 G', dr: 'cccf', bass: 'R---------------', lead: [
          '................',
          '................',
          'E---------------',
          'D-------G-------'] },
      },
      form: ['A', 'A2', 'B', 'C'],
    },
  ];

  // vinhetas curtas: [nota midi, início (s), duração (s), timbre]
  const STINGS = {
    levelup: [[72, 0, 0.08, 'chip'], [76, 0.07, 0.08, 'chip'], [79, 0.14, 0.08, 'chip'], [84, 0.21, 0.35, 'chip'], [88, 0.21, 0.45, 'bell'], [91, 0.28, 0.45, 'bell']],
    unlock: [[79, 0, 0.1, 'bell'], [84, 0.06, 0.1, 'bell'], [88, 0.12, 0.1, 'bell'], [91, 0.18, 0.45, 'bell'], [96, 0.24, 0.5, 'bell'], [72, 0.18, 0.5, 'soft'], [76, 0.18, 0.5, 'soft']],
    gameover: [[67, 0, 0.15, 'chip'], [64, 0.17, 0.15, 'chip'], [60, 0.34, 0.15, 'chip'], [57, 0.51, 0.6, 'chip'], [45, 0.51, 0.7, 'soft'], [52, 0.51, 0.7, 'soft']],
    record: [[72, 0, 0.07, 'chip'], [72, 0.1, 0.07, 'chip'], [72, 0.2, 0.07, 'chip'], [79, 0.3, 0.28, 'chip'], [76, 0.6, 0.08, 'chip'], [79, 0.7, 0.08, 'chip'], [84, 0.8, 0.4, 'chip'], [72, 0.8, 0.4, 'soft'], [76, 0.8, 0.4, 'soft'], [88, 0.8, 0.4, 'bell']],
  };
  const SI = {
    chip: { w: 'pulse', duty: 0.25, a: 0.003, d: 0.1, s: 0.7, r: 0.07, cut: 5000, g: 0.11 },
    bell: { w: 'sine', fm: 3.5, idx: 1.8, fmd: 0.1, a: 0.002, d: 0.5, s: 0, r: 0.2, g: 0.09 },
    soft: { w: 'triangle', a: 0.005, d: 0.2, s: 0.7, r: 0.15, g: 0.14 },
  };

  // canais da mistura: ganho, pan, envio para eco (dly) e reverberação (rev)
  const MIX = {
    lead: { pan: 0, dly: 0.18, rev: 0.15 },
    bass: {},
    pad: { rev: 0.3 },
    arp: { pan: -0.3, dly: 0.25, rev: 0.15 },
    cnt: { pan: 0.35, dly: 0.2, rev: 0.3 },
    kick: {},
    snare: { pan: 0.05, rev: 0.12 },
    hat: { pan: 0.25 },
    perc: { pan: -0.25, rev: 0.1 },
    fx: { rev: 0.4 },
  };
  const GROUP = { kick: 'drums', snare: 'drums', hat: 'drums', perc: 'drums', fx: 'drums' };
  const KIT = {
    k: { f0: 150, f1: 48, sw: 0.09, dec: 0.28, g: 0.6, click: 0.12, w: 'sine' },
    s: { hp: 1400, dec: 0.14, g: 0.26, body: 190, bg: 0.18 },
    c: { f: 1300, dec: 0.12, g: 0.2 },
    h: { hp: 7500, dec: 0.035, odec: 0.2, g: 0.08 },
    t: { f: [220, 165, 120], dec: 0.22, g: 0.3 },
    x: { hp: 5000, dec: 1.3, g: 0.06 },
  };

  // ================= Preparação (texto -> eventos) =================
  const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const QUAL = {
    '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
    sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 4, 7, 14],
  };
  function parseChord(sym, where) {
    const m = /^([A-G])(#|b)?(.*)$/.exec(sym);
    const iv = m && QUAL[m[3]];
    if (!iv) { warn(`acorde inválido "${sym}" em ${where}`); return { root: 0, iv: QUAL[''], v: {} }; }
    return { root: (PC[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? 11 : 0)) % 12, iv, v: {} };
  }
  // melodia -> [{ n, len }] por semicolcheia
  function parseLine(src, shift, where) {
    const out = []; let oct = 0;
    for (const c of src) {
      if (c === '>') oct += 12;
      else if (c === '<') oct -= 12;
      else if (c === '#') { if (typeof out[out.length - 1] === 'number') out[out.length - 1]++; }
      else if (c === '.' || c === '-') out.push(c);
      else if (PC[c.toLowerCase()] !== undefined) out.push(60 + PC[c.toLowerCase()] + (c < 'a' ? 12 : 0) + oct + shift);
      else if (c !== ' ' && c !== '|') warn(`caractere "${c}" em ${where}`);
    }
    if (out.length !== 64) warn(`${where}: melodia com ${out.length} passos (esperado 64)`);
    return holds(out, (v) => typeof v === 'number', (v, len) => ({ n: v, len }));
  }
  // padrão de caracteres (baixo, pad, arpejo) -> [{ c, len }]
  function parsePat(src, where) {
    if (!src) return [];
    const a = src.replace(/[\s|]/g, '').split('');
    if (a.length !== 16 && a.length !== 64) warn(`${where}: padrão com ${a.length} passos`);
    return holds(a, (c) => c !== '.' && c !== '-', (c, len) => ({ c, len }));
  }
  function holds(arr, isNote, make) {
    return arr.map((v, i) => {
      if (!isNote(v)) return null;
      let len = 1;
      while (arr[i + len] === '-') len++;
      return make(v, len);
    });
  }
  const VEL = { X: 1, x: 0.7, '+': 0.4, o: 0.7, O: 1 };
  function parseDrums(bar, where) {
    const lane = (s, map) => {
      const a = new Array(16).fill(0);
      if (!s) return a;
      if (s.length !== 16) warn(`${where}: bateria com ${s.length} passos`);
      for (let i = 0; i < 16; i++) a[i] = map(s[i] || '.');
      return a;
    };
    const vel = (c) => VEL[c] || 0;
    return {
      k: lane(bar.k, vel), s: lane(bar.s, vel), c: lane(bar.c, vel), t: lane(bar.t, (c) => +c || 0),
      h: lane(bar.h, (c) => (VEL[c] ? { v: VEL[c], open: c === 'o' || c === 'O' } : 0)),
    };
  }
  function prep(D) {
    if (D._p) return D._p;
    const cache = {};
    const lead = D.ins.lead;
    const section = (name) => {
      if (cache[name]) return cache[name];
      const raw = D.parts[name];
      const src = Object.assign({}, D.def, raw.base ? D.parts[raw.base] : null, raw);
      const where = `${D.id}/${name}`;
      const ch = src.ch.trim().split(/\s+/).map((tok) => {
        const h = tok.split(',').map((s) => parseChord(s, where));
        return [h[0], h[1] || h[0]]; // 'F,G' = meio compasso cada
      });
      if (ch.length !== 4) warn(`${where}: ${ch.length} acordes (esperado 4)`);
      const dr = src.dr || 'aaaa';
      for (const k of dr) if (!D.drums[k]) warn(`${where}: bateria "${k}" não existe`);
      if (Array.isArray(src.lead)) src.lead.forEach((b, i) => { if (b.replace(/[<>#\s|]/g, '').length !== 16) warn(`${where}: compasso ${i + 1} da melodia não tem 16 passos`); });
      return (cache[name] = {
        ch, dr, x: !!src.x,
        lead: src.lead ? parseLine([].concat(src.lead).join(''), (lead.oct || 0) * 12, where) : [],
        bass: parsePat(src.bass, where + ' baixo'), pad: parsePat(src.pad, where + ' pad'),
        arp: parsePat(src.arp, where + ' arpejo'), cnt: parsePat(src.cnt, where + ' contracanto'),
      });
    };
    const seq = D.form.map(section);
    const drums = {};
    for (const k in D.drums) drums[k] = parseDrums(D.drums[k], `${D.id}/bateria ${k}`);
    if (!drums.f) drums.f = drums.a;
    const kit = {};
    for (const k in KIT) kit[k] = Object.assign({}, KIT[k], D.kit && D.kit[k]);
    return (D._p = { id: D.id, bpm: D.bpm, swing: D.swing || 0, ins: D.ins, mix: D.mix || {}, lv: D.lv || {}, kit, drums, seq, len: seq.length * 64 });
  }

  // notas do acorde fechadas na janela [lo, lo+12), para condução de vozes suave
  function voicing(c, lo) {
    if (c.v[lo]) return c.v[lo];
    const ns = c.iv.map((v) => lo + (((c.root + v - lo) % 12) + 12) % 12);
    return (c.v[lo] = [...new Set(ns)].sort((a, b) => a - b));
  }
  function ladder(c, lo, k) {
    const v = voicing(c, lo);
    return v[k % v.length] + 12 * Math.floor(k / v.length);
  }
  function bassNote(c, sym, lo) {
    const r = lo + (((c.root - lo) % 12) + 12) % 12;
    switch (sym) {
      case 'O': return r + 12;
      case '5': return r + 7;
      case '3': return r + c.iv[1];
      case '7': return r + (c.iv[3] || 10);
      case 'v': return r - 5;
      default: return r;
    }
  }

  // ================= Motor de áudio (um por AudioContext) =================
  function Engine(ctx, out, vol, solo) {
    this.ctx = ctx;
    this.rnd = rng(0x51A7E);
    this.solo = solo || null;
    this.count = 0; this.hits = 0;
    this.waves = {}; this.curves = {};
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master = ctx.createGain(); this.master.gain.value = vol;
    this.master.connect(comp); comp.connect(out);
    this.music = ctx.createGain(); this.music.connect(this.master); // pausa / parada
    this.duck = ctx.createGain(); this.duck.connect(this.music);    // abaixa sob as vinhetas
    this.sting = ctx.createGain(); this.sting.connect(this.master);
    // eco com realimentação filtrada
    this.dIn = ctx.createGain();
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = this.dTime = 0.35;
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2400;
    const dOut = ctx.createGain(); dOut.gain.value = 0.5;
    this.dIn.connect(this.delay); this.delay.connect(dlp); dlp.connect(fb); fb.connect(this.delay);
    dlp.connect(dOut); dOut.connect(this.duck);
    // reverberação com resposta ao impulso gerada
    this.rIn = ctx.createGain();
    const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, 1.7, this.rnd);
    const rOut = ctx.createGain(); rOut.gain.value = 0.5;
    this.rIn.connect(conv); conv.connect(rOut); rOut.connect(this.duck);
    // ruído branco compartilhado pela percussão
    const sr = ctx.sampleRate, nb = ctx.createBuffer(1, Math.floor(sr * 2), sr), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = this.rnd() * 2 - 1;
    this.nbuf = nb;
  }
  Engine.prototype.pulse = function (duty) {
    const key = 'p' + duty;
    if (this.waves[key]) return this.waves[key];
    const n = 64, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return (this.waves[key] = this.ctx.createPeriodicWave(re, im));
  };
  Engine.prototype.curve = function (k) {
    if (this.curves[k]) return this.curves[k];
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = Math.tanh(k * (i / (n - 1) * 2 - 1)) / Math.tanh(k);
    return (this.curves[k] = c);
  };
  Engine.prototype.noise = function (t, len) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.nbuf;
    const room = this.nbuf.duration - len - 0.01;
    s.start(t, room > 0 ? this.rnd() * room : 0, Math.min(len, this.nbuf.duration - 0.01));
    return s;
  };
  function impulse(ctx, secs, rnd) {
    const sr = ctx.sampleRate, n = Math.floor(sr * secs), b = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        lp += (rnd() * 2 - 1 - lp) * 0.45; // escurece a cauda
        d[i] = lp * Math.pow(1 - i / n, 2.6);
      }
    }
    return b;
  }
  // ao terminar, solta os nós para o coletor de lixo (no render offline o grafo inteiro é descartado)
  const done = (E, src, nodes) => { if (!E.offline) src.onended = () => { for (const n of nodes) n.disconnect(); }; };
  function ramp(param, v, t, tc) { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, tc); }

  // ================= Instrumentos =================
  function voice(E, out, t, midi, dur, p, vel) {
    const ctx = E.ctx, f = mtof(midi);
    const a = p.a || 0.003, r = p.r || 0.05, s = p.s || 0;
    const nOsc = (p.det ? 2 : 1) + (p.harm ? 1 : 0);
    const peak = (p.g || 0.1) * vel / Math.sqrt(nOsc);
    const end = t + Math.max(dur, a + 0.005), stop = end + r + 0.03;
    const g = ctx.createGain(), gg = g.gain;
    gg.value = 0;
    gg.setValueAtTime(0, t);
    gg.linearRampToValueAtTime(peak, t + a);
    if (s < 1) gg.setTargetAtTime(peak * s, t + a, (p.d || 0.1) / 3);
    gg.setTargetAtTime(0, end, r / 5);
    const nodes = [g], srcs = [];
    let dest = g;
    if (p.cut) {
      const fl = ctx.createBiquadFilter(), c = Math.min(p.cut, 16000);
      fl.type = 'lowpass'; fl.Q.value = p.q || 0.7;
      if (p.fe) {
        fl.frequency.setValueAtTime(Math.min(c * (1 + p.fe), 16000), t);
        fl.frequency.setTargetAtTime(c, t, (p.fd || 0.1) / 3);
      } else fl.frequency.value = c;
      fl.connect(g); dest = fl; nodes.push(fl);
    }
    const osc = (freq, det) => {
      const o = ctx.createOscillator();
      if (p.w === 'pulse') o.setPeriodicWave(E.pulse(p.duty || 0.5)); else o.type = p.w || 'square';
      o.frequency.value = freq;
      if (det) o.detune.value = det;
      o.connect(dest); srcs.push(o);
      return o;
    };
    const carriers = p.det ? [osc(f, -p.det), osc(f, p.det)] : [osc(f, 0)];
    if (p.harm) carriers.push(osc(f * Math.pow(2, p.harm / 12), 0));
    if (p.fm) { // sino / piano elétrico: modulação de frequência que se apaga rápido
      const m = ctx.createOscillator(), mg = ctx.createGain();
      m.frequency.value = f * p.fm;
      mg.gain.setValueAtTime(f * (p.idx || 1), t);
      mg.gain.setTargetAtTime(0, t, (p.fmd || 0.1) / 3);
      m.connect(mg); carriers.forEach((o) => mg.connect(o.frequency));
      srcs.push(m); nodes.push(mg);
    }
    if (p.vib && dur > 0.12) { // vibrato que entra depois do ataque
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = p.vibRate || 5.5;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(p.vib, t + Math.min(dur, 0.3));
      l.connect(lg); carriers.forEach((o) => lg.connect(o.detune));
      srcs.push(l); nodes.push(lg);
    }
    for (const o of srcs) { o.start(t); o.stop(stop); }
    g.connect(out);
    done(E, srcs[0], srcs.concat(nodes));
    E.count++;
  }
  // oscilador com queda de altura (bumbo, tons, corpo da caixa)
  function drop(E, out, t, type, f0, f1, sw, peak, dec) {
    const ctx = E.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + sw);
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.01, dec / 4);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dec + 0.06);
    done(E, o, [o, g]);
    E.count++;
  }
  // rajada de ruído filtrado (chimbal, caixa, clique, prato)
  function burst(E, out, t, type, freq, q, peak, dec) {
    const ctx = E.ctx, len = dec * 1.6 + 0.01, s = E.noise(t, len);
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(peak, t);
    g.gain.setTargetAtTime(0, t + 0.001, dec / 4);
    s.connect(f); f.connect(g); g.connect(out);
    done(E, s, [s, f, g]);
    E.count++;
  }
  const kick = (E, out, t, v, k) => {
    drop(E, out, t, k.w, k.f0, k.f1, k.sw, k.g * v, k.dec);
    if (k.click) burst(E, out, t, 'highpass', 3000, 0.7, k.click * v, 0.008);
  };
  const snare = (E, out, t, v, s) => {
    burst(E, out, t, 'highpass', s.hp, 0.7, s.g * v, s.dec);
    if (s.body) drop(E, out, t, 'triangle', s.body, s.body * 0.78, 0.05, s.bg * v, 0.08);
  };
  const hat = (E, out, t, v, open, h) => burst(E, out, t, 'highpass', h.hp, 0.7, h.g * v, open ? h.odec : h.dec);
  const tom = (E, out, t, i, tk) => { const f = tk.f[i - 1] || tk.f[0]; drop(E, out, t, 'sine', f, f * 0.62, tk.dec, tk.g, tk.dec); };
  const shaker = (E, out, t, v) => burst(E, out, t, 'bandpass', 7500, 1.5, 0.05 * v, 0.035);
  const crash = (E, out, t, v, x) => burst(E, out, t, 'highpass', x.hp, 0.5, x.g * v, x.dec);
  function clap(E, out, t, v, c) {
    const ctx = E.ctx, s = E.noise(t, 0.3), f = ctx.createBiquadFilter(), g = ctx.createGain(), gg = g.gain, pk = c.g * v;
    f.type = 'bandpass'; f.frequency.value = c.f; f.Q.value = 0.9;
    for (let k = 0; k < 3; k++) { // três palmas quase juntas
      gg.setValueAtTime(pk, t + k * 0.011);
      gg.setTargetAtTime(pk * 0.05, t + k * 0.011 + 0.001, 0.003);
    }
    gg.setValueAtTime(pk, t + 0.033);
    gg.setTargetAtTime(0, t + 0.034, c.dec / 4);
    s.connect(f); f.connect(g); g.connect(out);
    done(E, s, [s, f, g]);
    E.count++;
  }
  // ruído que sobe até a troca de música
  function riser(E, out, t, len) {
    const ctx = E.ctx, s = E.noise(t, len + 0.05), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + len);
    g.gain.linearRampToValueAtTime(0, t + len + 0.04);
    s.connect(f); f.connect(g); g.connect(out);
    done(E, s, [s, f, g]);
    E.count++;
  }

  // ================= Barramento de uma música =================
  // Cada trecho tocado tem seu barramento; trocar/pausar = desvanecer e descartar o antigo.
  function Bus(P, t) {
    const E = P.E, ctx = E.ctx;
    this.P = P; this.E = E; this.mix = P.song.mix; this.lv = P.song.lv; this.chs = {}; this.nodes = [];
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(1, t + 0.03);
    this.out.connect(E.duck);
    this.dly = ctx.createGain(); this.dly.connect(E.dIn);
    this.rev = ctx.createGain(); this.rev.connect(E.rIn);
  }
  Bus.prototype.ch = function (name) {
    let c = this.chs[name];
    if (c) return c;
    const E = this.E, ctx = E.ctx, m = Object.assign({}, MIX[name], this.mix[name]);
    const add = (n) => { this.nodes.push(n); return n; };
    const lv = this.lv[GROUP[name] || name];
    const level = (m.g == null ? 1 : m.g) * (lv == null ? 1 : lv) * (E.solo && E.solo.indexOf(name) < 0 ? 0 : 1);
    c = add(ctx.createGain());
    c.gain.value = m.drive ? 1 : level;
    let tail = c;
    if (m.drive) { // distorção suave (baixo do vulcão); o nível entra depois dela
      const ws = add(ctx.createWaveShaper()), lp = add(ctx.createBiquadFilter()), post = add(ctx.createGain());
      ws.curve = E.curve(m.drive); ws.oversample = '2x';
      lp.type = 'lowpass'; lp.frequency.value = m.post || 3000;
      post.gain.value = level;
      tail.connect(ws); ws.connect(lp); lp.connect(post); tail = post;
    }
    if (m.pan && ctx.createStereoPanner) {
      const p = add(ctx.createStereoPanner());
      p.pan.value = m.pan; tail.connect(p); tail = p;
    }
    tail.connect(this.out);
    if (m.dly) { const s = add(ctx.createGain()); s.gain.value = m.dly; tail.connect(s); s.connect(this.dly); }
    if (m.rev) { const s = add(ctx.createGain()); s.gain.value = m.rev; tail.connect(s); s.connect(this.rev); }
    return (this.chs[name] = c);
  };
  Bus.prototype.retire = function (t, dur) {
    for (const n of [this.out, this.dly, this.rev]) ramp(n.gain, 0, t, dur / 4);
    if (!this.P.offline) setTimeout(() => this.kill(), Math.max(0, t - this.P.clock() + dur + 0.5) * 1000);
  };
  Bus.prototype.kill = function () {
    for (const n of this.nodes.concat([this.out, this.dly, this.rev])) n.disconnect();
    this.nodes = []; this.chs = {};
  };

  // ================= Tocador =================
  function Player(ctx, opts) {
    this.ctx = ctx;
    this.clock = opts.clock || (() => ctx.currentTime);
    this.offline = !!opts.offline;
    this.vol = opts.volume == null ? VOLUME : opts.volume;
    this.E = new Engine(ctx, opts.out || ctx.destination, this.vol, opts.solo);
    this.E.offline = this.offline;
    this.idx = -1; this.song = null; this.pending = -1; this.bus = null;
    this.pos = 0; this.next = 0; this.fCur = 1; this.fTarget = 1; this.intensity = 0;
    this.muted = false; this.mutedAt = 0; this.paused = false; this.rose = false; this.timer = null;
  }
  const PP = Player.prototype;
  PP.play = function (i) {
    const N = DEFS.length;
    i = ((Math.floor(Number(i)) || 0) % N + N) % N;
    if (this.song) {
      if (i === this.idx) this.pending = -1; // já está tocando: nada muda (cancela troca pendente)
      else if (i !== this.pending) { this.pending = i; this.rose = false; } // troca na próxima barra
      return;
    }
    const now = this.clock();
    this.idx = i; this.song = prep(DEFS[i]); this.pending = -1;
    this.pos = 0; this.paused = false; this.fCur = this.fTarget;
    this.next = now + 0.05;
    this.bus = new Bus(this, this.next);
    ramp(this.E.music.gain, 1, now, 0.01);
    if (!this.offline && !this.timer) this.timer = setInterval(() => this.safeTick(), TICK_MS);
  };
  PP.setSpeed = function (mult) {
    const m = clamp(Number(mult) || 1, 0.5, 3.5);
    this.fTarget = 1 + (m - 1) * 0.35;
    if (!this.song) this.fCur = this.fTarget;
  };
  PP.setIntensity = function (x) { this.intensity = clamp(Number(x) || 0, 0, 1); };
  PP.setMuted = function (b) {
    b = !!b;
    if (b === this.muted) return;
    const now = this.clock();
    this.muted = b; this.mutedAt = now;
    ramp(this.E.master.gain, b ? 0 : this.vol, now, 0.025);
  };
  PP.pause = function () {
    if (!this.song || this.paused) return;
    const now = this.clock();
    this.paused = true;
    if (this.bus) { this.bus.retire(now, 0.06); this.bus = null; }
    ramp(this.E.music.gain, 0, now, 0.02);
  };
  PP.resume = function () {
    if (!this.paused) return;
    this.paused = false;
    if (!this.song) return;
    const now = this.clock();
    this.next = now + 0.05;
    this.bus = new Bus(this, this.next);
    ramp(this.E.music.gain, 1, now, 0.01);
  };
  PP.stop = function () {
    const now = this.clock();
    if (this.bus) { this.bus.retire(now, 0.3); this.bus = null; }
    if (this.song) ramp(this.E.music.gain, 0, now, 0.1);
    this.song = null; this.idx = -1; this.pending = -1; this.paused = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  };
  PP.stinger = function (kind) {
    const seq = STINGS[kind];
    if (!seq) return;
    const E = this.E, now = this.clock(), t0 = now + 0.02;
    let end = 0;
    for (const [n, at, dur, ins] of seq) {
      voice(E, E.sting, t0 + at, n, dur, SI[ins], 1);
      end = Math.max(end, at + dur);
    }
    const d = E.duck.gain; // a música abaixa enquanto a vinheta toca
    d.cancelScheduledValues(now);
    d.setTargetAtTime(0.45, now, 0.02);
    d.setTargetAtTime(1, t0 + end, 0.2);
  };
  PP.safeTick = function () {
    try { this.tick(this.clock()); } catch (e) {
      clearInterval(this.timer); this.timer = null;
      if (window.console) console.error('[QC.Music]', e);
    }
  };
  PP.tick = function (now) {
    if (!this.song || this.paused) return;
    if (this.next < now - MAX_LAG) { // ficou para trás: avança em silêncio até alcançar o relógio
      let guard = 5000;
      while (this.next < now && guard--) this.advance(this.next, true);
      if (this.next < now) this.next = now;
    }
    while (this.next < now + LOOKAHEAD) this.advance(this.next, false);
  };
  PP.advance = function (t, silent) {
    if (this.pending >= 0 && this.pos % 16 === 0) this.swap(t);
    this.fCur += (this.fTarget - this.fCur) * 0.18; // andamento desliza até o alvo, passo a passo
    const sd = 15 / (this.song.bpm * this.fCur);    // duração da semicolcheia
    if (!silent && this.bus && !(this.muted && t > this.mutedAt + 0.25)) {
      const c0 = this.E.count;
      this.render(t, sd);
      if (this.E.count > c0) this.E.hits++; // passos que soaram (estatística de teste)
    }
    this.pos++;
    this.next = t + sd;
  };
  PP.swap = function (t) {
    if (this.bus) this.bus.retire(t, 0.25);
    this.idx = this.pending; this.pending = -1; this.rose = false;
    this.song = prep(DEFS[this.idx]); this.pos = 0;
    this.bus = new Bus(this, t);
    this.crashAt = t;
  };
  PP.render = function (t, sd) {
    const S = this.song, E = this.E, B = this.bus, I = S.ins;
    const p = this.pos % S.len, sec = S.seq[(p / 64) | 0], i = p % 64, st = p % 16, bar = i >> 4;
    const tt = t + (S.swing ? (st % 4 === 2 ? 2 : st % 2) * S.swing * sd : 0);
    const ch = sec.ch[bar][st < 8 ? 0 : 1];
    const x = this.intensity;
    const la = clamp((x - 0.1) / 0.25, 0, 1);  // chimbal dobrado
    const lb = clamp((x - 0.35) / 0.25, 0, 1); // contracanto
    const lc = clamp((x - 0.65) / 0.25, 0, 1); // palmas, chocalho e melodia oitavada
    if (st === 0) {
      const dt = Math.min(1.2, sd * 3); // eco em colcheia pontuada, acompanha o andamento
      if (Math.abs(dt - E.dTime) > 0.002) { E.delay.delayTime.setTargetAtTime(dt, t, 0.1); E.dTime = dt; }
      if ((i === 0 && sec.x) || this.crashAt === t) crash(E, B.ch('fx'), t, 0.8, S.kit.x);
    }
    // bateria (na troca de música, a virada toma o resto do compasso)
    const fill = this.pending >= 0;
    const dp = fill ? S.drums.f : S.drums[sec.dr[bar]] || S.drums.a, kit = S.kit;
    let v;
    if ((v = dp.k[st])) kick(E, B.ch('kick'), tt, v, kit.k);
    if ((v = dp.s[st])) snare(E, B.ch('snare'), tt, v, kit.s);
    if ((v = dp.c[st])) clap(E, B.ch('snare'), tt, v, kit.c);
    if ((v = dp.t[st])) tom(E, B.ch('snare'), tt, v, kit.t);
    const h = dp.h[st];
    if (h) hat(E, B.ch('hat'), tt, h.v, h.open, kit.h);
    else if (la && st % 2) hat(E, B.ch('hat'), tt, 0.35 * la, false, kit.h);
    if (lc) {
      if ((st === 4 || st === 12) && !dp.c[st]) clap(E, B.ch('perc'), tt, 0.5 * lc, kit.c);
      if (st % 4 === 2) shaker(E, B.ch('perc'), tt, lc);
    }
    if (fill && !this.rose && st >= 8) { this.rose = true; riser(E, B.ch('fx'), tt, (16 - st) * sd); }
    // harmonia e melodia
    let e;
    if ((e = sec.bass[i % sec.bass.length])) voice(E, B.ch('bass'), tt, bassNote(ch, e.c, I.bass.lo), e.len * sd * 0.9, I.bass, 1);
    if ((e = sec.pad[i % sec.pad.length])) {
      for (const n of voicing(ch, I.pad.lo)) voice(E, B.ch('pad'), tt, n, e.len * sd * 0.95, I.pad, e.c === 'X' ? 1 : 0.85);
    }
    if ((e = sec.arp[i % sec.arp.length])) voice(E, B.ch('arp'), tt, ladder(ch, I.arp.lo, +e.c), e.len * sd * 0.9, I.arp, 1);
    if (lb && (e = sec.cnt[i % sec.cnt.length])) voice(E, B.ch('cnt'), tt, ladder(ch, I.cnt.lo, +e.c), e.len * sd * 0.9, I.cnt, lb);
    if ((e = sec.lead[i])) {
      voice(E, B.ch('lead'), tt, e.n, e.len * sd * 0.94, I.lead, 1);
      if (lc) voice(E, B.ch('cnt'), tt, e.n + 12 <= 88 ? e.n + 12 : e.n, e.len * sd * 0.9, I.cnt, 0.4 * lc);
    }
  };

  // ================= API =================
  const STUB = { play() {}, setSpeed() {}, setIntensity() {}, setMuted() {}, pause() {}, resume() {}, stop() {}, stinger() {}, current: -1 };
  function create(actx, opts) {
    if (!actx) return STUB;
    const p = new Player(actx, opts || {});
    return {
      play: (i) => p.play(i),
      setSpeed: (m) => p.setSpeed(m),
      setIntensity: (x) => p.setIntensity(x),
      setMuted: (b) => p.setMuted(b),
      pause: () => p.pause(),
      resume: () => p.resume(),
      stop: () => p.stop(),
      stinger: (k) => p.stinger(k),
      get current() { return p.idx; },
      _p: p,
    };
  }

  // Teste: agenda a música de forma determinística num OfflineAudioContext.
  // opts: { intensity, sampleRate, volume, bar (compasso inicial), solo: ['lead', ...], script: [[t, 'metodo', ...args]] }
  function renderOffline(index, seconds, speedMult, opts) {
    opts = opts || {};
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const sr = opts.sampleRate || 44100;
    const ctx = new OAC(2, Math.ceil(sr * seconds), sr);
    let now = 0;
    const p = new Player(ctx, { clock: () => now, offline: true, volume: opts.volume, solo: opts.solo });
    p.setSpeed(speedMult == null ? 1 : speedMult);
    p.setIntensity(opts.intensity || 0);
    p.play(index);
    if (opts.bar) p.pos = opts.bar * 16;
    const script = (opts.script || []).slice().sort((a, b) => a[0] - b[0]);
    let k = 0;
    for (now = 0; now < seconds; now += TICK_MS / 1000) {
      while (k < script.length && script[k][0] <= now) { const [, m, ...args] = script[k++]; p[m](...args); }
      p.tick(now);
    }
    QC.Music._lastStats = { notes: p.E.count, onsetSteps: p.E.hits, steps: p.pos, current: p.idx };
    return new Promise((resolve, reject) => {
      ctx.oncomplete = (ev) => resolve(ev.renderedBuffer);
      const r = ctx.startRendering();
      if (r && r.then) r.then(resolve, reject);
    });
  }

  QC.Music = {
    SONGS: DEFS.map((d) => ({ id: d.id, name: d.name, bpm: d.bpm })),
    create,
    _renderOffline: renderOffline,
  };
})();
