// Sons procedurais (WebAudio, sem arquivos): passo, golpe, xeque e fim de jogo. O contexto só nasce no primeiro
// toque do jogador (política de autoplay) e o mudo fica em localStorage.
const KEY = 'xadrez_mute';
let ctx = null, muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch { /* sem armazenamento */ }

function ac() {
  if (muted) return null;
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { ctx = new C(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, dur, { type = 'sine', vol = 0.2, at = 0, slide = 0 } = {}) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.25, at = 0, freq = 1200 } = {}) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + at, n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource(); s.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
  const g = a.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(a.destination); s.start(t);
}

export const sound = {
  get muted() { return muted; },
  setMuted(v) { muted = !!v; try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ok */ } if (!v) ac(); },
  unlock() { ac(); },
  move() { tone(180, 0.09, { type: 'triangle', vol: 0.25, slide: -80 }); noise(0.05, { vol: 0.12, freq: 600 }); },
  capture() { noise(0.18, { vol: 0.4, freq: 2200 }); tone(120, 0.22, { type: 'square', vol: 0.18, slide: -70 }); tone(70, 0.3, { type: 'sine', vol: 0.3, at: 0.04 }); },
  check() { tone(660, 0.12, { type: 'triangle', vol: 0.2 }); tone(880, 0.18, { type: 'triangle', vol: 0.2, at: 0.12 }); },
  end(win = true) { const n = win ? [523, 659, 784, 1047] : [392, 330, 262, 196]; n.forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.2, at: i * 0.14 })); },
};
