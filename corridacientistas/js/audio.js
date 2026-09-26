// Áudio 100% sintetizado com WebAudio: motor, derrapagem, efeitos sonoros e músicas
// chiptune ORIGINAIS (sequenciador com agendamento antecipado).
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Notas e acordes
// ---------------------------------------------------------------------------
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteMidi(tok) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(tok);
  if (!m) return null;
  return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
// Acordes: C, Cm, C7, Cm7, Cmaj7, Csus4, Cdim
function chord(name) {
  const m = /^([A-G])([#b]?)(maj7|m7|m|7|sus4|dim)?$/.exec(name);
  if (!m) throw new Error(`acorde inválido: ${name}`);
  const pc = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const q = m[3] || '';
  const third = q === 'm' || q === 'm7' || q === 'dim' ? 3 : q === 'sus4' ? 5 : 4;
  const fifth = q === 'dim' ? 6 : 7;
  const sev = q === '7' || q === 'm7' ? 10 : q === 'maj7' ? 11 : 0;
  const root = 60 + pc; // oitava 4
  const tones = [root, root + third, root + fifth];
  if (sev) tones.push(root + sev);
  return {
    root, third: root + third, fifth: root + fifth, seventh: root + (sev || 12), tones,
    bass: 40 + ((pc - 4 + 12) % 12), // entre E2 e D#3
  };
}

// ---------------------------------------------------------------------------
// Músicas originais. Cada música tem seções; a seção define o arranjo
// (bateria, linha de baixo, arpejo, pad, prato na entrada) e traz seus compassos:
//   [acorde(s), melodia, contracanto (opcional), bateria (opcional, troca a da seção)]
// Melodia/contracanto: 16 passos (semicolcheias). Nota ("E5", "G#5") inicia,
// "~" antes da nota desliza da anterior, "-" sustenta, "." pausa.
// Baixo: R fundamental, O oitava, 5 quinta, 3 terça, 7 sétima,
// A aproximação cromática ao acorde do próximo compasso, "-" sustenta, "." pausa.
// ---------------------------------------------------------------------------
const REST = '. . . . . . . . . . . . . . . .';
const SONGS = {
  // Menu: alegre e saltitante, Dó maior, 116 bpm com swing
  menu: {
    bpm: 116, swing: 0.1, loopFrom: 0,
    vol: { lead: 0.15, counter: 0.075, arp: 0.16, pad: 0.015, bass: 0.1 },
    sections: [
      {
        drums: 'pop', bass: 'R-.5-.O.R-.5-.3.', arp: 'off', crash: true,
        bars: [
          ['C', 'E5 - G5 - C6 - - B5 - - G5 - E5 - - -'],
          ['Am', 'A5 - - - G5 - E5 - C5 - D5 - E5 - - -'],
          ['Dm7', 'F5 - A5 - C6 - - A5 - - F5 - D5 - E5 -'],
          ['G7', 'F5 - - - D5 - - - B4 - D5 - G5 - - -'],
          ['C', 'E5 - G5 - C6 - - B5 - - C6 - D6 - E6 -'],
          ['Am', 'C6 - - - A5 - - - E5 - - - D5 - E5 -'],
          ['F G', 'F5 - E5 - D5 - C5 - D5 - E5 - F5 - G5 -'],
          ['C', 'C6 - - - G5 - E5 - C5 - - - . . . .', null, 'popFill'],
        ],
      },
      {
        drums: 'pop2', bass: 'R-.5-.O.R-.5-.3A', arp: 'off', pad: true, crash: true,
        bars: [
          ['F', 'A5 - - - C6 - A5 - F5 - - - G5 - A5 -', 'C5 - - - - - - - A4 - - - - - - -'],
          ['G', 'B5 - - - D6 - B5 - G5 - - - - - . .', 'B4 - - - - - - - D5 - - - - - - -'],
          ['Em', 'G5 - - - B5 - G5 - E5 - - - F5 - G5 -', 'B4 - - - - - - - G4 - - - - - - -'],
          ['Am', 'A5 - - - C6 - - - E6 - - - D6 - C6 -', 'C5 - - - - - - - E5 - - - - - - -'],
          ['Dm7', 'D6 - C6 - A5 - F5 - A5 - - - C6 - D6 -', 'A4 - - - - - - - C5 - - - - - - -'],
          ['G7', 'B5 - - - G5 - - - D6 - - - F6 - E6 -', 'B4 - - - - - - - D5 - - - - - - -'],
          ['C Am', 'E6 - - - C6 - - - A5 - - - C6 - - -', 'G4 - - - - - - - A4 - - - - - - -'],
          ['Dm G7', 'D6 - - - A5 - - - B5 - C6 - D6 - - -', 'F5 - - - - - - - F5 - - - - - - -', 'popFill'],
        ],
      },
    ],
  },
  // Corrida: enérgica, Lá menor com refrão em Dó maior, 150 bpm.
  // Introdução → estrofe → pré-refrão → refrão → ponte; o laço volta para a estrofe.
  // Na volta final: mais rápida e três semitons acima (Dó menor).
  race: {
    bpm: 150, swing: 0, loopFrom: 4,
    vol: { lead: 0.16, counter: 0.08, arp: 0.17, pad: 0.016, bass: 0.105 },
    sections: [
      {
        drums: 'intro', bass: 'R.R.R.R.R.R.R.R.', arp: 'up16', pad: true,
        bars: [
          ['Am', REST],
          ['F', REST],
          ['C', REST, null, 'build'],
          ['G', '. . . . . . . . D5 - G5 - A5 - B5 -', null, 'roll'],
        ],
      },
      {
        drums: 'drive', bass: 'R.OR.OR.R.OR.O5.', arp: 'up16', crash: true,
        bars: [
          ['Am', 'A5 - - E5 - - A5 - C6 - - B5 - - A5 -'],
          ['F', 'F5 - - C5 - - F5 - A5 - - G5 - - F5 -'],
          ['C', 'E5 - - G5 - - C6 - E6 - - D6 - - C6 -'],
          ['G', 'D6 - - B5 - - G5 - D5 - - - . . G5 A5'],
          ['Am', 'C6 - B5 - A5 - E5 - A5 - B5 - C6 - D6 -'],
          ['F', 'E6 - - - D6 - C6 - D6 - - - C6 - A5 -'],
          ['G', 'B5 - - - G5 - - - D6 - - - B5 - G5 -'],
          ['E7', 'G#5 - - - B5 - - - E6 - - - ~D6 - B5 -', null, 'driveFill'],
        ],
      },
      {
        drums: 'pre', bass: 'R.R.R.R.R.R.R.RA', arp: 'updown', pad: true,
        bars: [
          ['Dm', 'D5 - F5 - A5 - D5 - F5 - A5 - D6 - A5 -'],
          ['Em', 'E5 - G5 - B5 - E5 - G5 - B5 - E6 - B5 -'],
          ['F', 'F5 - A5 - C6 - F5 - A5 - C6 - F6 - C6 -'],
          ['G', 'G5 - - - B5 - - - D6 - - - F6 - E6 D6', null, 'preRoll'],
        ],
      },
      {
        drums: 'chorus', bass: 'R.O.R.O.R.O.R.O.', arp: 'up16', pad: true, crash: true,
        bars: [
          ['C', 'E6 - - - - - D6 - C6 - - - G5 - - -', 'C5 - - - - - - - E5 - - - - - - -'],
          ['G', 'D6 - - - - - C6 - B5 - - - G5 - A5 B5', 'B4 - - - - - - - D5 - - - - - - -'],
          ['Am', 'C6 - - - - - B5 - A5 - - - E6 - - -', 'C5 - - - - - - - E5 - - - - - - -'],
          ['F', 'F6 - - - E6 - - - C6 - - - A5 - C6 -', 'A4 - - - - - - - C5 - - - - - - -'],
          ['C', 'E6 - - - - - D6 - C6 - - - G5 - - -', 'E5 - - - - - - - G5 - - - - - - -'],
          ['G', 'D6 - - - - - C6 - B5 - - - D6 - E6 -', 'D5 - - - - - - - B4 - - - - - - -'],
          ['F G', 'F6 - - - E6 - D6 - E6 - - - D6 - B5 -', 'A4 - - - - - - - B4 - - - - - - -'],
          ['C', 'C6 - - - - - - - - - - - . . . .', 'E5 - - - - - - - - - - - . . . .', 'chorusFill'],
        ],
      },
      {
        drums: 'half', bass: 'R-------5-----A-', arp: 'up16', pad: true,
        bars: [
          ['Am', 'A4 - - - C5 - - - E5 - - - A5 - - -'],
          ['F', 'A5 - - - G5 - - - F5 - - - C5 - - -'],
          ['Dm', 'D5 - - - F5 - - - A5 - - - D6 - - -'],
          ['E7', 'E6 - - - D6 - - - B5 - - - G#5 - - -', null, 'roll'],
        ],
      },
    ],
  },
  // Resultados: fanfarra de abertura e depois um laço calmo, 100 bpm
  results: {
    bpm: 100, swing: 0, loopFrom: 3,
    vol: { lead: 0.14, counter: 0.07, arp: 0.12, pad: 0.017, bass: 0.09 },
    sections: [
      {
        drums: 'fanfare', bass: 'R-------5-------', pad: true, crash: true,
        bars: [
          ['C', 'G4 . G4 . C5 - - - E5 . E5 . G5 - - -'],
          ['F G', 'A5 - - - C6 - - - B5 - - - D6 - - -'],
          ['C', 'C6 - - - - - - - - - - - . . . .', null, 'crash'],
        ],
      },
      {
        drums: 'soft', bass: 'R-------5-------', arp: 'arp8', pad: true,
        bars: [
          ['C', 'E5 - - - G5 - - - C6 - - - G5 - - -'],
          ['Am', 'A5 - - - - - G5 - E5 - - - - - - -'],
          ['F', 'F5 - - - A5 - - - C6 - - - A5 - G5 -'],
          ['G', 'G5 - - - - - - - D5 - - - - - - -'],
          ['C', 'E5 - - - G5 - - - C6 - - - E6 - - -', 'C5 - - - - - - - G4 - - - - - - -'],
          ['Em', 'D6 - - - B5 - - - G5 - - - B5 - - -', 'B4 - - - - - - - E5 - - - - - - -'],
          ['F G', 'A5 - - - C6 - - - B5 - - - D6 - - -', 'F5 - - - - - - - G5 - - - - - - -'],
          ['C', 'C6 - - - - - - - - - - - . . . .', 'E5 - - - - - - - - - - - . . . .'],
        ],
      },
    ],
  },
};

// Padrões de bateria (16 passos): k = bumbo, s = caixa, h = chimbal (x fechado, o aberto), t = tom
const DRUMS = {
  pop: { k: 'x.......x.......', s: '....x.......x...', h: '..x...x...x...x.' },
  pop2: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.o.' },
  popFill: { k: 'x.......x.......', s: '....x.......x.xx', h: '..x...x...x.....' },
  intro: { k: 'x...x...x...x...', h: '..x...x...x...x.' },
  build: { k: 'x...x...x...x...', s: '........x...x.x.', h: 'x.x.x.x.x.x.x.x.' },
  roll: { k: 'x...x...x...x...', s: 'x.x.x.x.xxxxxxxx' },
  drive: { k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.o.' },
  driveFill: { k: 'x.....x.x.......', s: '....x.......x.xx', h: 'x.x.x.x.x.x.....', t: '..........x.x...' },
  pre: { k: 'x...x...x...x...', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' },
  preRoll: { k: 'x...x...x...x...', s: 'x.x.x.x.x.x.xxxx' },
  chorus: { k: 'x...x...x...x...', s: '....x.......x...', h: '..o...o...o...o.' },
  chorusFill: { k: 'x...x...x...x...', s: '....x...x.......', h: '..o...o.........', t: '..........x.x.x.' },
  half: { k: 'x.........x.....', s: '........x.......', h: 'x.x.x.x.x.x.x.x.' },
  fanfare: { k: 'x.......x.......', s: 'x.x.....x.x.....' },
  crash: { k: 'x...............' },
  soft: { k: 'x.......x.......', h: '....x.......x...' },
};

function parseLine(toks, steps, where) {
  const out = new Array(steps).fill(null);
  for (let i = 0; i < steps; i++) {
    const tok = toks[i];
    if (tok === '-' || tok === '.') continue;
    const glide = tok[0] === '~';
    const m = noteMidi(glide ? tok.slice(1) : tok);
    if (m === null) throw new Error(`${where}: nota inválida "${tok}"`);
    let len = 1;
    while (i + len < steps && toks[i + len] === '-') len++;
    out[i] = { m, len, glide };
  }
  return out;
}

// Compila uma música em listas por passo
function compile(song) {
  const bars = [];
  for (const sec of song.sections) sec.bars.forEach((bar, j) => bars.push({ sec, bar, first: j === 0 }));
  const steps = bars.length * 16;
  const chords = new Array(steps), names = new Array(steps), arp = new Array(steps);
  const bass = new Array(steps).fill(null), pad = new Array(steps).fill(null), crash = new Array(steps).fill(false);
  const drums = new Array(bars.length);
  const leadT = [], ctrT = [];
  const cache = {};
  const ch = (n) => (cache[n] ||= chord(n));
  bars.forEach(({ sec, bar: [cs, mel, ctr, dr], first }, b) => {
    const nm = cs.split(' ');
    for (let i = 0; i < 16; i++) {
      const n = nm[Math.floor((i * nm.length) / 16)];
      chords[b * 16 + i] = ch(n);
      names[b * 16 + i] = n;
      arp[b * 16 + i] = sec.arp || null;
    }
    const t = mel.trim().split(/\s+/);
    const c = (ctr || REST).trim().split(/\s+/);
    if (t.length !== 16 || c.length !== 16) throw new Error(`compasso ${b + 1}: ${t.length}/${c.length} passos`);
    leadT.push(...t);
    ctrT.push(...c);
    drums[b] = DRUMS[dr || sec.drums];
    if (!drums[b]) throw new Error(`compasso ${b + 1}: bateria "${dr || sec.drums}"`);
    if (sec.crash && first) crash[b * 16] = true;
  });
  bars.forEach(({ sec }, b) => {
    const bp = sec.bass;
    if (!bp) return;
    if (bp.length !== 16) throw new Error(`baixo "${bp}" não tem 16 passos`);
    for (let i = 0; i < 16; i++) {
      const c = bp[i];
      if (c === '.' || c === '-') continue;
      let len = 1;
      while (i + len < 16 && bp[i + len] === '-') len++;
      const k = chords[b * 16 + i];
      const next = chords[((b + 1) * 16) % steps];
      const m = c === 'R' ? k.bass : c === 'O' ? k.bass + 12 : c === '5' ? k.bass + 7
        : c === '3' ? k.bass + (k.third - k.root) : c === '7' ? k.bass + (k.seventh - k.root)
        : c === 'A' ? next.bass - 1 : null;
      if (m === null) throw new Error(`baixo: símbolo "${c}"`);
      bass[b * 16 + i] = { m, len };
    }
  });
  // pad: reataca a cada compasso e a cada troca de acorde
  for (let i = 0; i < steps; ) {
    if (!bars[i >> 4].sec.pad) { i++; continue; }
    let j = i + 1;
    while (j < steps && j % 16 !== 0 && names[j] === names[i]) j++;
    pad[i] = { len: j - i };
    i = j;
  }
  return {
    bpm: song.bpm, swing: song.swing, loopFrom: song.loopFrom, vol: song.vol, steps,
    lead: parseLine(leadT, steps, 'melodia'), counter: parseLine(ctrT, steps, 'contracanto'),
    chords, arp, bass, pad, crash, drums,
  };
}
const COMPILED = {};
for (const k of Object.keys(SONGS)) COMPILED[k] = compile(SONGS[k]);

// Resposta de impulso sintética para o reverb (ruído escurecido com decaimento)
function makeImpulse(ctx, secs, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * secs);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += (Math.random() * 2 - 1 - lp) * 0.4;
      d[i] = lp * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

// Onda de pulso (ciclo de trabalho d) por série de Fourier
function pulseWave(ctx, d) {
  const n = 40;
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * d);
  return ctx.createPeriodicWave(re, im);
}

// Nome do item → efeito ao usar
const ITEM_SFX = { foguete: 'boost', pilha3: 'boost', faraday: 'boost', maca: 'drop', alfa: 'throw', eletron: 'throw', tesla: 'lightning', buraco: 'blackhole' };

export class AudioSystem {
  constructor({ bus } = {}) {
    this.bus = bus;
    this.ctx = null;
    this.muted = false;
    this.paused = false;
    this.musicName = null;
    this.finalLap = false;
    this.tempoMul = 1;
    this.volume = { master: 0.85, music: 0.5, sfx: 0.9 };
    this._world = null;
    this._lastUpdate = 0;
    this._last = Object.create(null);
    this._recent = [];
    this._seq = null;
    this._timer = null;
    this._rShow = undefined;
    this._rTick = 0;
    this._topRef = 20;
    this._vec = { x: 0, y: 0, z: 0 };
    if (bus) this._bind(bus);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) this.ctx.suspend().catch(() => {});
        else this.ctx.resume().catch(() => {});
      });
    }
  }

  // Cria/retoma o AudioContext (chamar no primeiro gesto do usuário; pode chamar várias vezes)
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this._build();
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      if (!this._primed) {
        // iOS: tocar um buffer mudo dentro do gesto libera o áudio
        const b = this.ctx.createBuffer(1, 1, 22050);
        const s = this.ctx.createBufferSource();
        s.buffer = b;
        s.connect(this.ctx.destination);
        s.start(0);
        this._primed = true;
      }
      if (this.musicName && !this._seq) this._startSong(this.musicName);
      if (!this._timer) this._timer = setInterval(() => this._tick(), 25);
      return true;
    } catch (e) {
      console.warn('[audio] indisponível', e);
      return false;
    }
  }

  setMuted(b) {
    this.muted = !!b;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume.master, this.ctx.currentTime, 0.03);
  }

  // Pausa (menu de pausa): silencia motor/derrapagem e congela a música
  pauseAll(b) {
    this.paused = !!b;
    if (!this.ctx) return;
    if (this.paused) this._silenceLoops(0.05);
    else if (this._seq) this._seq.next = this.ctx.currentTime + 0.06;
  }

  playMusic(name) {
    if (name && !COMPILED[name]) name = null;
    if (name === this.musicName && (this._seq || !this.ctx)) return;
    this.musicName = name;
    if (name !== 'race') { this.finalLap = false; this.tempoMul = 1; }
    if (!this.ctx) return;
    this._stopSong(0.25);
    if (name) this._startSong(name);
  }

  setFinalLap(b) {
    b = !!b;
    if (b === this.finalLap) return;
    this.finalLap = b;
    this.tempoMul = b ? 1.12 : 1;
    if (b && this.ctx) {
      this.sfx('finalLap');
      // a música para durante a vinheta e volta do começo, mais rápida e em Dó menor
      if (this._seq && this._seq.name === 'race') {
        this._applyFinal(this._seq);
        this._seq.hold = this.ctx.currentTime + 1.7;
        this._seq.step = 0;
        this._seq.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        this._seq.gain.gain.setTargetAtTime(1, this.ctx.currentTime + 1.65, 0.05);
      }
    } else if (!b && this._seq) {
      this._seq.tr = 0;
      this._setDelay(this._seq, 1);
    }
  }

  // ---------------------------------------------------------------------
  // Grafo de áudio
  // ---------------------------------------------------------------------
  _build() {
    const ctx = this.ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume.master;
    this.master.connect(this.comp).connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.volume.music;
    this.musicGain.connect(this.master);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.volume.sfx;
    this.sfxGain.connect(this.master);
    // ruído branco compartilhado (2 s)
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.pw25 = pulseWave(ctx, 0.25);
    this.pw12 = pulseWave(ctx, 0.125);
    // motor: serra + quadrada desafinadas → passa-baixa, com leve pulsação (cilindros)
    const e = (this.eng = {});
    e.out = ctx.createGain();
    e.out.gain.value = 0;
    e.filter = ctx.createBiquadFilter();
    e.filter.type = 'lowpass';
    e.filter.frequency.value = 500;
    e.filter.Q.value = 2.5;
    e.a = ctx.createOscillator();
    e.a.type = 'sawtooth';
    e.b = ctx.createOscillator();
    e.b.type = 'square';
    e.b.detune.value = 9;
    e.sub = ctx.createOscillator();
    e.sub.type = 'triangle';
    const ga = ctx.createGain(); ga.gain.value = 0.5;
    const gb = ctx.createGain(); gb.gain.value = 0.28;
    const gs = ctx.createGain(); gs.gain.value = 0.6;
    e.a.connect(ga).connect(e.filter);
    e.b.connect(gb).connect(e.filter);
    e.sub.connect(gs).connect(e.filter);
    e.am = ctx.createGain();
    e.am.gain.value = 1;
    e.filter.connect(e.am).connect(e.out).connect(this.sfxGain);
    e.lfo = ctx.createOscillator();
    e.lfo.type = 'sine';
    e.lfoDepth = ctx.createGain();
    e.lfoDepth.gain.value = 0.35;
    e.lfo.connect(e.lfoDepth).connect(e.am.gain);
    for (const o of [e.a, e.b, e.sub, e.lfo]) o.start();
    this._setEngine(55, 0);
    // derrapagem: ruído em passa-faixa + chiado tonal
    const dr = (this.drift = {});
    dr.src = this._noiseLoop();
    dr.bp = ctx.createBiquadFilter();
    dr.bp.type = 'bandpass';
    dr.bp.frequency.value = 1500;
    dr.bp.Q.value = 3;
    dr.out = ctx.createGain();
    dr.out.gain.value = 0;
    dr.src.connect(dr.bp).connect(dr.out).connect(this.sfxGain);
    dr.sq = ctx.createOscillator();
    dr.sq.type = 'triangle';
    dr.sq.frequency.value = 600;
    dr.vib = ctx.createOscillator();
    dr.vib.frequency.value = 11;
    dr.vibD = ctx.createGain();
    dr.vibD.gain.value = 18;
    dr.vib.connect(dr.vibD).connect(dr.sq.frequency);
    dr.sqOut = ctx.createGain();
    dr.sqOut.gain.value = 0;
    dr.sq.connect(dr.sqOut).connect(this.sfxGain);
    dr.sq.start();
    dr.vib.start();
    // acostamento: ronco grave pulsante
    const rb = (this.rumble = {});
    rb.src = this._noiseLoop();
    rb.lp = ctx.createBiquadFilter();
    rb.lp.type = 'lowpass';
    rb.lp.frequency.value = 220;
    rb.am = ctx.createGain();
    rb.am.gain.value = 0.6;
    rb.out = ctx.createGain();
    rb.out.gain.value = 0;
    rb.src.connect(rb.lp).connect(rb.am).connect(rb.out).connect(this.sfxGain);
    rb.lfo = ctx.createOscillator();
    rb.lfo.type = 'square';
    rb.lfo.frequency.value = 13;
    rb.lfoD = ctx.createGain();
    rb.lfoD.gain.value = 0.4;
    rb.lfo.connect(rb.lfoD).connect(rb.am.gain);
    rb.lfo.start();
  }

  _noiseLoop() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  _setEngine(f, cutoff, tc = 0.05) {
    const t = this.ctx.currentTime, e = this.eng;
    e.a.frequency.setTargetAtTime(f, t, tc);
    e.b.frequency.setTargetAtTime(f * 1.004, t, tc);
    e.sub.frequency.setTargetAtTime(f * 0.5, t, tc);
    e.lfo.frequency.setTargetAtTime(Math.max(8, f * 0.5), t, tc);
    if (cutoff) e.filter.frequency.setTargetAtTime(cutoff, t, 0.08);
  }

  _silenceLoops(tc = 0.08) {
    const t = this.ctx.currentTime;
    this.eng.out.gain.setTargetAtTime(0, t, tc);
    this.drift.out.gain.setTargetAtTime(0, t, tc);
    this.drift.sqOut.gain.setTargetAtTime(0, t, tc);
    this.rumble.out.gain.setTargetAtTime(0, t, tc);
    this._loopsOn = false;
  }

  // ---------------------------------------------------------------------
  // Atualização por quadro: motor do jogador, derrapagem, acostamento, roleta
  // ---------------------------------------------------------------------
  update(dt, world) {
    this._world = world;
    this._lastUpdate = performance.now();
    if (!this.ctx || this.ctx.state !== 'running') return;
    const p = world && world.player;
    if (!p || this.paused || world.phase === 'title') {
      if (this._loopsOn) this._silenceLoops();
      return;
    }
    this._loopsOn = true;
    const t = this.ctx.currentTime;
    const c = p.controls || {};
    const boosting = (p.boostTime || 0) > 0 || (p.starTime || 0) > 0;
    const ms = p.maxSpeed || 20;
    if (!boosting) this._topRef = Math.max(8, ms);
    let ratio = Math.min(1.35, Math.abs(p.speed || 0) / this._topRef);
    const thr = Math.max(0, Math.min(1, c.throttle || 0));
    // na contagem, acelerar faz o motor roncar parado
    if (p.frozen) ratio = thr > 0 ? 0.45 + 0.1 * Math.sin(t * 9) : 0;
    let f = 55 + 155 * Math.pow(Math.min(ratio, 1), 0.85) + (ratio > 1 ? (ratio - 1) * 120 : 0);
    if (boosting) f *= 1.12;
    if (p.onGround === false) f *= 1.06;
    const shrink = (p.shrinkTime || 0) > 0 ? 1.35 : 1;
    this._setEngine(f * shrink, 380 + 2300 * Math.min(1, ratio) + thr * 450 + (boosting ? 900 : 0));
    const vol = (0.05 + thr * 0.045 + Math.min(1, ratio) * 0.05) * ((p.spinTime || 0) > 0 || (p.tumbleTime || 0) > 0 ? 0.6 : 1);
    this.eng.out.gain.setTargetAtTime(vol, t, 0.06);
    // derrapagem
    const drifting = p.drifting && p.onGround !== false && Math.abs(p.speed || 0) > 4;
    const lvl = p.driftLevel || 0;
    this.drift.out.gain.setTargetAtTime(drifting ? 0.075 : 0, t, drifting ? 0.04 : 0.06);
    this.drift.bp.frequency.setTargetAtTime(1300 + lvl * 450, t, 0.1);
    this.drift.sqOut.gain.setTargetAtTime(drifting ? 0.018 + lvl * 0.004 : 0, t, 0.05);
    this.drift.sq.frequency.setTargetAtTime(520 + lvl * 170, t, 0.1);
    // acostamento
    const off = p.offroad && p.onGround !== false && Math.abs(p.speed || 0) > 3 && !boosting;
    this.rumble.out.gain.setTargetAtTime(off ? 0.16 * Math.min(1, Math.abs(p.speed) / 14) : 0, t, 0.08);
    // roleta de itens: tique quando o item mostrado muda (limite de ritmo)
    const r = p.roulette;
    const now = t;
    if (r) {
      if ((r.showing !== this._rShow && now - this._rTick > 0.055) || now - this._rTick > 0.13) {
        this._rShow = r.showing;
        this._rTick = now;
        this.sfx('roulette');
      }
    } else this._rShow = undefined;
  }

  // ---------------------------------------------------------------------
  // Sequenciador de música (setInterval de 25 ms + agenda 120 ms à frente)
  // Cada música tem sua própria mesa: canais com pan, eco, reverb e
  // "sidechain" (baixo, pad e arpejo abaixam a cada bumbo).
  // ---------------------------------------------------------------------
  _startSong(name) {
    const song = COMPILED[name];
    if (!song || !this.ctx) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(this.musicGain);
    const fx = { out: gain };
    fx.verb = ctx.createConvolver();
    this._ir ||= makeImpulse(ctx, 1.8, 3);
    fx.verb.buffer = this._ir;
    const vr = ctx.createGain();
    vr.gain.value = 0.8;
    fx.verb.connect(vr).connect(gain);
    fx.delay = ctx.createDelay(1.5);
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2600;
    fx.delay.connect(dl).connect(fb).connect(fx.delay);
    const dOut = this._pan(0.25);
    dl.connect(dOut.in);
    dOut.out.connect(gain);
    fx.duck = ctx.createGain();
    fx.duck.connect(gain);
    const chan = (pan, verb, delay, duck) => {
      const c = this._pan(pan);
      c.out.connect(duck ? fx.duck : gain);
      if (verb) { const g = ctx.createGain(); g.gain.value = verb; c.out.connect(g).connect(fx.verb); }
      if (delay) { const g = ctx.createGain(); g.gain.value = delay; c.out.connect(g).connect(fx.delay); }
      return c.in;
    };
    fx.lead = chan(0, 0.2, 0.2, false);
    fx.counter = chan(-0.35, 0.35, 0, false);
    fx.arp = chan(0.35, 0.15, 0.12, true);
    fx.pad = chan(0, 0.4, 0, true);
    fx.bass = chan(0, 0, 0, true);
    fx.drums = chan(0, 0.07, 0, false);
    fx.hats = chan(0.2, 0.04, 0, false);
    const s = { name, song, step: 0, next: ctx.currentTime + 0.08, gain, fx, hold: 0, tr: 0, last: 0 };
    this._seq = s;
    if (name === 'race' && this.finalLap) this._applyFinal(s);
    else this._setDelay(s, 1);
  }

  _pan(p) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    if (!p || !ctx.createStereoPanner) return { in: g, out: g };
    const sp = ctx.createStereoPanner();
    sp.pan.value = p;
    g.connect(sp);
    return { in: g, out: sp };
  }

  // eco de colcheia pontuada, acompanha o andamento
  _setDelay(s, mul) {
    s.fx.delay.delayTime.setTargetAtTime((3 * 60) / (s.song.bpm * mul) / 4, this.ctx.currentTime, 0.05);
  }

  _applyFinal(s) {
    s.tr = 3;
    this._setDelay(s, this.tempoMul);
  }

  _stopSong(fade = 0.2) {
    const s = this._seq;
    if (!s) return;
    this._seq = null;
    const t = this.ctx.currentTime;
    s.gain.gain.setTargetAtTime(0, t, fade / 3);
    setTimeout(() => s.gain.disconnect(), (fade + 2) * 1000);
  }

  _tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // sem update por um tempo (jogo pausado/fora da corrida): motor se cala
    if (this._loopsOn && performance.now() - this._lastUpdate > 200) this._silenceLoops(0.1);
    const s = this._seq;
    if (!s || this.paused) return;
    const now = ctx.currentTime;
    if (now < s.hold) { s.next = s.hold; return; }
    if (s.next < now - 0.25) s.next = now + 0.05; // ficou para trás (aba em segundo plano)
    const song = s.song;
    const mul = s.name === 'race' ? this.tempoMul : 1;
    const stepDur = 60 / (song.bpm * mul) / 4;
    while (s.next < now + 0.12) {
      const swing = song.swing && s.step % 2 === 1 ? stepDur * song.swing : 0;
      this._playStep(s, s.step, s.next + swing, stepDur);
      s.next += stepDur;
      s.step++;
      if (s.step >= song.steps) s.step = song.loopFrom * 16;
    }
  }

  _playStep(s, i, t, sd) {
    const song = s.song, fx = s.fx, tr = s.tr, v = song.vol;
    const inBar = i % 16, bar = i >> 4;
    const ch = song.chords[i];
    // melodia
    const n = song.lead[i];
    if (n) {
      this._lead(fx.lead, n.m + tr, t, n.len * sd * 0.92, v.lead, n.glide && s.last ? s.last + tr : 0);
      s.last = n.m;
    }
    // contracanto
    const c = song.counter[i];
    if (c) this._soft(fx.counter, c.m + tr, t, c.len * sd * 0.95, v.counter);
    // arpejo
    const mode = song.arp[i];
    if (mode === 'up16') {
      const tones = [ch.root, ch.third, ch.fifth, ch.root + 12];
      this._pluck(fx.arp, tones[inBar % 4] + 12 + tr, t, sd * 2.5, v.arp * (inBar % 4 === 0 ? 1 : 0.75));
    } else if (mode === 'updown') {
      const tones = [ch.root, ch.third, ch.fifth, ch.root + 12, ch.fifth, ch.third];
      this._pluck(fx.arp, tones[inBar % 6] + 12 + tr, t, sd * 2.5, v.arp * 0.85);
    } else if (mode === 'arp8') {
      if (inBar % 2 === 0) {
        const tones = [ch.root, ch.fifth, ch.third + 12, ch.fifth];
        this._pluck(fx.arp, tones[(inBar / 2) % 4] + tr, t, sd * 3, v.arp);
      }
    } else if (mode === 'off' && inBar % 4 === 2) {
      for (const m of [ch.third, ch.fifth, ch.root + 12]) this._pluck(fx.arp, m + tr, t, sd * 1.6, v.arp * 0.55);
    }
    // pad
    const p = song.pad[i];
    if (p) {
      const tones = ch.tones.map((m) => { while (m < 57) m += 12; while (m >= 69) m -= 12; return m + tr; });
      this._pad(fx.pad, tones, t, p.len * sd, v.pad);
    }
    // baixo
    const b = song.bass[i];
    if (b) this._bass(fx.bass, b.m + tr, t, b.len * sd * 0.9, v.bass);
    // bateria
    const dr = song.drums[bar];
    if (song.crash[i]) this._crash(t, fx.hats, 0.16);
    if (dr.k && dr.k[inBar] === 'x') {
      this._kick(t, fx.drums, 0.62);
      const d = fx.duck.gain;
      d.setValueAtTime(0.45, t);
      d.setTargetAtTime(1, t + 0.02, 0.08);
    }
    if (dr.s && dr.s[inBar] === 'x') this._snare(t, fx.drums, 0.3 * (dr.s === DRUMS.roll.s || dr.s === DRUMS.preRoll.s ? 0.55 + 0.45 * (inBar / 15) : 1));
    if (dr.h) {
      const hv = inBar % 4 === 0 ? 0.075 : inBar % 2 === 0 ? 0.06 : 0.04;
      if (dr.h[inBar] === 'x') this._hat(t, fx.hats, hv, 0.035);
      else if (dr.h[inBar] === 'o') this._hat(t, fx.hats, 0.065, 0.16);
    }
    if (dr.t && dr.t[inBar] === 'x') this._tom(t, fx.drums, 0.4, inBar >= 14 ? 120 : inBar >= 12 ? 160 : 210);
  }

  // Melodia: dois pulsos levemente desafinados, filtro que "abre" no ataque e vibrato atrasado
  _lead(out, m, t, dur, vol, from = 0) {
    const ctx = this.ctx, f = mtof(m);
    const o1 = ctx.createOscillator();
    o1.setPeriodicWave(this.pw25);
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.detune.value = 8;
    for (const o of [o1, o2]) {
      if (from) {
        o.frequency.setValueAtTime(mtof(from), t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      } else o.frequency.setValueAtTime(f, t);
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(6000, t);
    lp.frequency.setTargetAtTime(2600, t + 0.01, 0.09);
    const g2 = ctx.createGain();
    g2.gain.value = 0.45;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.setTargetAtTime(vol * 0.78, t + 0.02, 0.1);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.03);
    o1.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(g).connect(out);
    const end = t + dur + 0.25;
    if (dur > 0.28) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.6;
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.setValueAtTime(0, t + 0.12);
      lg.gain.linearRampToValueAtTime(18, t + Math.min(0.45, dur));
      lfo.connect(lg);
      lg.connect(o1.detune);
      lg.connect(o2.detune);
      lfo.start(t);
      lfo.stop(end);
    }
    o1.start(t); o2.start(t);
    o1.stop(end); o2.stop(end);
  }

  // Contracanto: triângulo + pulso fino, ataque suave
  _soft(out, m, t, dur, vol) {
    const ctx = this.ctx, f = mtof(m);
    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(f, t);
    const o2 = ctx.createOscillator();
    o2.setPeriodicWave(this.pw12);
    o2.frequency.setValueAtTime(f, t);
    o2.detune.value = -6;
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.04);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.06);
    o1.connect(g);
    o2.connect(g2).connect(g);
    g.connect(out);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + 0.4); o2.stop(t + dur + 0.4);
  }

  // Arpejo: pulso fino com decaimento rápido
  _pluck(out, m, t, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.setPeriodicWave(this.pw12);
    o.frequency.setValueAtTime(mtof(m), t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Pad: duas serras desafinadas por nota, filtradas, ataque lento
  _pad(out, tones, t, dur, vol) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.12);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.09);
    lp.connect(g).connect(out);
    const end = t + dur + 0.5;
    for (const m of tones) {
      for (const dt of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(mtof(m), t);
        o.detune.value = dt;
        o.connect(lp);
        o.start(t);
        o.stop(end);
      }
    }
  }

  // Baixo sintetizado: serra + triângulo com filtro de envelope ("pluck" grave)
  _bass(out, m, t, dur, vol) {
    const ctx = this.ctx, f = mtof(m);
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.setValueAtTime(f, t);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(f, t);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.setTargetAtTime(480, t + 0.005, 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.setTargetAtTime(vol * 0.8, t + 0.02, 0.1);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.02);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g).connect(out);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + 0.15); o2.stop(t + dur + 0.15);
  }

  _kick(t, out, v) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.28);
    this._noise(out, t, 0.012, v * 0.3, 'highpass', 3000, 3000, 0.7); // clique do ataque
  }

  _snare(t, out, v) {
    this._noise(out, t, 0.16, v, 'bandpass', 1900, 1400, 0.8);
    this._noise(out, t, 0.09, v * 0.45, 'highpass', 5500, 5500, 0.7);
    this._tone(out, 'triangle', 210, 150, t, 0.08, v * 0.75);
  }

  _hat(t, out, v, dur) {
    this._noise(out, t, dur, v, 'highpass', 8000, 8000, 0.7);
  }

  _crash(t, out, v) {
    this._noise(out, t, 1.5, v, 'highpass', 5200, 3400, 0.5);
  }

  _tom(t, out, v, f = 230) {
    this._tone(out, 'sine', f, f * 0.5, t, 0.18, v);
  }

  // ---------------------------------------------------------------------
  // Blocos de síntese para efeitos
  // ---------------------------------------------------------------------
  _tone(out, wave, f0, f1, t, dur, vol, attack = 0.004) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    if (typeof wave === 'string') o.type = wave;
    else o.setPeriodicWave(wave);
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  _noise(out, t, dur, vol, type = 'bandpass', f0 = 1000, f1 = f0, q = 1) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * Math.max(0, 1.9 - dur), dur + 0.05);
    return g;
  }

  _notes(out, wave, list, t0, vol) {
    // list: [[nota, início (s), duração (s)], ...]
    for (const [n, st, d] of list) {
      const m = typeof n === 'number' ? n : noteMidi(n);
      this._tone(out, wave, mtof(m), mtof(m), t0 + st, d, vol, 0.006);
    }
  }

  // ---------------------------------------------------------------------
  // Efeitos sonoros: sfx(nome, { vol, pan })
  // ---------------------------------------------------------------------
  sfx(name, opts = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const gen = SFX[name];
    if (!gen) return;
    const now = ctx.currentTime;
    const gap = GAPS[name] ?? 0.04;
    if (this._last[name] !== undefined && now - this._last[name] < gap) return;
    // limita a quantidade de efeitos simultâneos
    this._recent = this._recent.filter((x) => now - x < 0.25);
    if (this._recent.length > 10 && !PRIORITY[name]) return;
    this._recent.push(now);
    this._last[name] = now;
    const vol = Math.max(0, Math.min(1.5, opts.vol ?? 1));
    if (vol < 0.02) return;
    const out = ctx.createGain();
    out.gain.value = vol;
    let node = out;
    if (opts.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      out.connect(p);
      node = p;
    }
    node.connect(this.sfxGain);
    const dur = gen.call(this, out, now + 0.005) || 1;
    setTimeout(() => node.disconnect(), (dur + 0.5) * 1000);
  }

  // Volume/pan de um evento no mundo em relação ao jogador (ou à câmera)
  _spatial(pos, kart) {
    const w = this._world;
    if (!w) return { vol: 0.6, pan: 0 };
    if (w.phase === 'title') return { vol: 0, pan: 0 };
    if (kart && kart === w.player) return { vol: 1, pan: 0 };
    const src = pos || (kart && kart.position);
    const lis = (w.player && w.player.position) || (w.camera && w.camera.position);
    if (!src || !lis) return { vol: 0.5, pan: 0 };
    const dx = src.x - lis.x, dy = src.y - lis.y, dz = src.z - lis.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 90) return { vol: 0, pan: 0 };
    const vol = 1 / (1 + (d / 14) * (d / 14));
    let pan = 0;
    const cam = w.camera;
    if (cam && d > 0.5) {
      const e = cam.matrixWorld.elements; // coluna 0 = direita da câmera
      pan = Math.max(-0.8, Math.min(0.8, (dx * e[0] + dy * e[1] + dz * e[2]) / d));
    }
    return { vol, pan };
  }

  _at(name, pos, kart, base = 1) {
    const s = this._spatial(pos, kart);
    if (s.vol * base > 0.03) this.sfx(name, { vol: s.vol * base, pan: s.pan });
  }

  // ---------------------------------------------------------------------
  // Eventos do jogo → sons
  // ---------------------------------------------------------------------
  _bind(bus) {
    const isP = (k) => !!(k && (k.isPlayer || (this._world && k === this._world.player)));
    bus.on('race:countdown', () => this.sfx('countdown'));
    bus.on('race:go', () => this.sfx('go'));
    bus.on('race:lap', (d) => {
      if (!isP(d && d.kart)) return;
      const total = this._world && this._world.totalLaps;
      if (total && d.lap >= total) return; // a volta final tem vinheta própria
      this.sfx('lap');
    });
    bus.on('race:finalLap', (d) => {
      if (d && d.kart && !isP(d.kart)) return;
      this.setFinalLap(true);
    });
    bus.on('race:finish', (d) => {
      if (!isP(d && d.kart)) return;
      this._stopSong(0.4);
      this.musicName = null;
      this.sfx('finish');
    });
    bus.on('item:pickup', (d) => { if (isP(d && d.kart)) this.sfx('pickup'); });
    bus.on('item:got', (d) => { if (isP(d && d.kart)) this.sfx('itemGet'); });
    bus.on('item:use', (d) => {
      const name = ITEM_SFX[d && d.item];
      if (!name || name === 'lightning') return; // o raio toca em item:lightning
      if (name === 'boost' && isP(d.kart)) return; // kart:boost cuida do turbo do jogador
      this._at(name, null, d.kart, name === 'blackhole' ? 1 : 0.9);
    });
    bus.on('item:explode', (d) => this._at('explosion', d && d.pos, null, 1));
    bus.on('item:lightning', () => { if (this._world?.phase !== 'title') this.sfx('lightning'); });
    bus.on('item:blackhole', (d) => this._at('blackhole', d && d.pos, d && d.target, 1.2));
    bus.on('kart:hit', (d) => this._at('hit', null, d && d.kart, 1));
    bus.on('kart:boost', (d) => { if (isP(d && d.kart)) this.sfx('boost'); });
    bus.on('kart:bump', (d) => {
      if (!d || (!isP(d.a) && !isP(d.b))) return;
      this.sfx('bump', { vol: Math.max(0.35, Math.min(1, 0.35 + (d.strength || 0) * 0.08)) });
    });
    bus.on('kart:wall', (d) => {
      if (!isP(d && d.kart)) return;
      this.sfx('wall', { vol: Math.max(0.3, Math.min(1, 0.3 + (d.strength || 0) * 0.07)) });
    });
    bus.on('kart:trick', (d) => { if (isP(d && d.kart)) this.sfx('trick'); });
    bus.on('kart:driftLevel', (d) => { if (isP(d && d.kart) && d.level > 0) this.sfx('driftLevel', { vol: 0.6 + d.level * 0.1 }); });
    bus.on('kart:hop', (d) => { if (isP(d && d.kart)) this.sfx('hop', { vol: 0.5 }); });
    bus.on('kart:land', (d) => { if (isP(d && d.kart) && (d.airTime || 0) > 0.35) this.sfx('land', { vol: Math.min(1, 0.4 + d.airTime * 0.4) }); });
  }
}

// Intervalo mínimo entre repetições do mesmo efeito (s)
const GAPS = { boost: 0.15, lightning: 0.4, finish: 1, finalLap: 1, go: 0.5, countdown: 0.3, roulette: 0.045, blackhole: 0.3, lap: 0.5 };
const PRIORITY = { go: 1, countdown: 1, finish: 1, finalLap: 1, lap: 1, lightning: 1, itemGet: 1 };

// Geradores de efeitos: this = AudioSystem; recebem (saída, instante) e devolvem a duração
const SFX = {
  countdown(o, t) {
    this._tone(o, 'square', 523.25, 523.25, t, 0.25, 0.34);
    this._tone(o, 'triangle', 261.6, 261.6, t, 0.25, 0.4);
    return 0.3;
  },
  go(o, t) {
    this._tone(o, 'square', 1046.5, 1046.5, t, 0.65, 0.2);
    this._tone(o, this.pw25, 1318.5, 1318.5, t, 0.65, 0.1);
    this._tone(o, 'triangle', 523.25, 523.25, t, 0.65, 0.25);
    this._noise(o, t, 0.4, 0.12, 'highpass', 6000, 6000, 0.7);
    return 0.8;
  },
  pickup(o, t) {
    this._noise(o, t, 0.09, 0.3, 'highpass', 2500, 5000, 0.8);
    this._notes(o, 'triangle', [['C6', 0, 0.07], ['E6', 0.035, 0.07], ['G6', 0.07, 0.07], ['C7', 0.105, 0.12]], t, 0.22);
    return 0.3;
  },
  roulette(o, t) {
    this._tone(o, 'square', 1318.5, 1318.5, t, 0.03, 0.07);
    return 0.05;
  },
  itemGet(o, t) {
    this._notes(o, 'triangle', [['G6', 0, 0.16], ['C7', 0.08, 0.3]], t, 0.28);
    this._notes(o, this.pw25, [['E6', 0, 0.12], ['G6', 0.08, 0.25]], t, 0.07);
    this._tone(o, 'sine', 3136, 3136, t + 0.14, 0.2, 0.06);
    return 0.45;
  },
  boost(o, t) {
    this._noise(o, t, 0.5, 0.35, 'bandpass', 500, 3200, 1.2);
    this._tone(o, 'sawtooth', 170, 560, t, 0.4, 0.09);
    this._tone(o, 'square', 340, 1120, t, 0.3, 0.04);
    return 0.55;
  },
  hit(o, t) {
    this._tone(o, 'square', 720, 110, t, 0.5, 0.18);
    this._tone(o, 'square', 736, 104, t, 0.5, 0.1);
    this._noise(o, t, 0.18, 0.35, 'lowpass', 1600, 300, 0.8);
    return 0.55;
  },
  throw(o, t) {
    this._noise(o, t, 0.2, 0.25, 'bandpass', 700, 3800, 1.5);
    this._tone(o, 'triangle', 620, 1040, t, 0.12, 0.18);
    return 0.25;
  },
  drop(o, t) {
    this._tone(o, 'sine', 560, 140, t, 0.16, 0.4);
    this._noise(o, t, 0.05, 0.1, 'lowpass', 900, 900, 0.7);
    return 0.2;
  },
  explosion(o, t) {
    this._noise(o, t, 0.95, 0.65, 'lowpass', 3200, 140, 0.9);
    this._tone(o, 'sine', 95, 34, t, 0.6, 0.55);
    this._noise(o, t + 0.05, 0.5, 0.2, 'bandpass', 900, 300, 0.6);
    return 1.0;
  },
  lightning(o, t) {
    // estalos: ruído com ganho picotado
    const g = this._noise(o, t, 0.6, 0.5, 'highpass', 1800, 900, 0.7);
    for (let i = 0; i < 12; i++) {
      const tt = t + 0.02 + i * 0.045 + Math.random() * 0.02;
      g.gain.setValueAtTime(0.1 + Math.random() * 0.5, tt);
    }
    g.gain.setTargetAtTime(0.0001, t + 0.6, 0.05);
    this._tone(o, 'sawtooth', 1900, 60, t, 0.65, 0.14);
    this._tone(o, 'sine', 70, 30, t + 0.05, 0.7, 0.5);
    return 0.8;
  },
  blackhole(o, t) {
    const osc = this._tone(o, 'sine', 440, 42, t, 1.4, 0.35, 0.05);
    const ctx = this.ctx;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lg = ctx.createGain();
    lg.gain.value = 25;
    lfo.connect(lg).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + 1.45);
    this._noise(o, t, 1.4, 0.22, 'lowpass', 1400, 90, 1.5);
    this._tone(o, this.pw25, 220, 55, t, 1.2, 0.05);
    return 1.5;
  },
  lap(o, t) {
    this._notes(o, 'triangle', [['C6', 0, 0.12], ['E6', 0.09, 0.12], ['G6', 0.18, 0.28]], t, 0.28);
    this._notes(o, this.pw25, [['C5', 0, 0.1], ['E5', 0.09, 0.1], ['G5', 0.18, 0.25]], t, 0.06);
    return 0.5;
  },
  finalLap(o, t) {
    // vinheta original de volta final (Dó maior, sobe e termina em acorde)
    const q = 0.11;
    this._notes(o, 'square', [['G5', 0, q], ['C6', q, q], ['E6', 2 * q, q], ['G6', 3 * q, q * 2.5], ['E6', 5.5 * q, q], ['G6', 6.5 * q, q], ['C7', 7.5 * q, q * 5]], t, 0.13);
    this._notes(o, this.pw25, [['E5', 0, q], ['G5', q, q], ['C6', 2 * q, q], ['E6', 3 * q, q * 2.5], ['C6', 5.5 * q, q], ['E6', 6.5 * q, q], ['G6', 7.5 * q, q * 5]], t, 0.06);
    this._notes(o, 'triangle', [['C3', 0, 3 * q], ['G3', 3 * q, 2.5 * q], ['C3', 5.5 * q, 2 * q], ['C4', 7.5 * q, 5 * q]], t, 0.3);
    for (let i = 0; i < 6; i++) this._noise(o, t + i * q * 0.5, 0.08, 0.12, 'bandpass', 1900, 1900, 0.9);
    this._noise(o, t + 7.5 * q, 0.8, 0.12, 'highpass', 5000, 5000, 0.6);
    return 1.6;
  },
  finish(o, t) {
    const q = 0.1;
    this._notes(o, 'square', [['C5', 0, q], ['E5', q, q], ['G5', 2 * q, q], ['C6', 3 * q, 2 * q], ['A5', 5 * q, 2.5 * q], ['B5', 7.5 * q, 2.5 * q], ['C6', 10 * q, 9 * q]], t, 0.13);
    this._notes(o, this.pw25, [['G4', 3 * q, 2 * q], ['F5', 5 * q, 2.5 * q], ['G5', 7.5 * q, 2.5 * q], ['E5', 10 * q, 9 * q], ['G5', 10 * q, 9 * q]], t, 0.06);
    this._notes(o, 'triangle', [['C3', 0, 3 * q], ['C4', 3 * q, 2 * q], ['F3', 5 * q, 2.5 * q], ['G3', 7.5 * q, 2.5 * q], ['C3', 10 * q, 9 * q]], t, 0.3);
    this._noise(o, t + 10 * q, 1.4, 0.14, 'highpass', 4500, 4500, 0.5);
    this._kick(t + 10 * q, o, 0.5);
    return 2.2;
  },
  menuMove(o, t) {
    this._tone(o, 'triangle', 880, 880, t, 0.05, 0.18);
    return 0.08;
  },
  menuSelect(o, t) {
    this._notes(o, 'square', [['C6', 0, 0.06], ['G6', 0.06, 0.14]], t, 0.12);
    this._notes(o, 'triangle', [['C5', 0, 0.06], ['G5', 0.06, 0.14]], t, 0.2);
    return 0.25;
  },
  trick(o, t) {
    this._tone(o, 'triangle', 600, 1500, t, 0.16, 0.25);
    this._notes(o, 'square', [['E7', 0.12, 0.06], ['G7', 0.17, 0.1]], t, 0.05);
    return 0.3;
  },
  bump(o, t) {
    this._tone(o, 'sine', 170, 60, t, 0.13, 0.5);
    this._noise(o, t, 0.06, 0.2, 'lowpass', 500, 300, 0.7);
    return 0.16;
  },
  wall(o, t) {
    this._noise(o, t, 0.2, 0.45, 'bandpass', 380, 200, 1.2);
    this._tone(o, 'square', 130, 48, t, 0.16, 0.12);
    this._tone(o, 'sine', 90, 40, t, 0.18, 0.4);
    return 0.25;
  },
  driftLevel(o, t) {
    this._tone(o, 'triangle', 1200, 1600, t, 0.07, 0.12);
    return 0.1;
  },
  hop(o, t) {
    this._tone(o, 'triangle', 280, 560, t, 0.08, 0.12);
    return 0.1;
  },
  land(o, t) {
    this._tone(o, 'sine', 120, 55, t, 0.12, 0.35);
    this._noise(o, t, 0.08, 0.15, 'lowpass', 600, 300, 0.7);
    return 0.15;
  },
};
