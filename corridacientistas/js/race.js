// Gerencia a corrida: contagem regressiva, largada-foguete, voltas, posições e chegada.
import { RACE } from './config.js';

const MAX_STEP = 30; // maior avanço de s aceito por quadro (m); evita saltos de projeção

export class RaceManager {
  constructor({ bus }) {
    this.bus = bus;
    this.phase = 'idle'; // 'countdown' | 'racing' | 'finished'
    this.karts = [];
    this.player = null;
    this.totalLaps = RACE.defaultLaps;
    this.countdown = 0;
    this.time = 0;
    this.finishOrder = [];
    this.results = null;
    this._lastCount = 0;
    this._throttleStart = -1;
  }

  // Prepara os karts (já posicionados no grid) e começa a contagem.
  start(karts, { laps, player, track, cc }) {
    this.karts = karts;
    this.player = player;
    this.track = track;
    this.cc = cc;
    this.totalLaps = laps;
    this.phase = 'countdown';
    this.countdown = 0;
    this.time = 0;
    this.finishOrder = [];
    this.results = null;
    this._lastCount = 0;
    this._throttleStart = -1;
    this._finalLapShown = false;
    const L = track.length;
    for (const k of karts) {
      k.frozen = true;
      k.finished = false;
      k.finishTime = 0;
      k.lap = 1;
      k.maxLap = 0;
      k.place = 1;
      k._prevS = k.s;
      // progresso contínuo em metros a partir da linha (negativo no grid)
      k.progress = k.s > L / 2 ? k.s - L : k.s;
      k.wrongWay = 0;
      // largada-foguete da IA: chance conforme a habilidade
      k._aiRocket = !k.isPlayer && Math.random() < 0.25 + cc.aiSkill * 0.5;
    }
    this.updatePlaces();
  }

  update(dt, world) {
    if (this.phase === 'countdown') this.updateCountdown(dt, world);
    else if (this.phase === 'racing' || this.phase === 'finished') this.time += dt;

    if (this.phase === 'racing' || this.phase === 'finished') {
      this.updateProgress(world);
      this.updatePlaces();
    }
  }

  updateCountdown(dt) {
    const step = RACE.countdownStep;
    this.countdown += dt;
    const n = 3 - Math.floor(this.countdown / step);
    if (n !== this._lastCount && n >= 1 && n <= 3) {
      this._lastCount = n;
      this.bus.emit('race:countdown', { n });
    }
    // Largada-foguete do jogador: acelerar logo depois do "2" (entre 1,0 e 2,6 passos).
    if (this.player) {
      const held = this.player.controls.throttle > 0.5;
      if (held && this._throttleStart < 0) this._throttleStart = this.countdown;
      if (!held) this._throttleStart = -1;
    }
    if (this.countdown >= step * 3) {
      this.phase = 'racing';
      this.time = 0;
      for (const k of this.karts) k.frozen = false;
      this.bus.emit('race:go', {});
      if (this.player && this._throttleStart >= step * 1.0 && this._throttleStart <= step * 2.6) {
        this.player.applyBoost(1.1, 1, 'rocket');
      }
      for (const k of this.karts) if (k._aiRocket) k.applyBoost(0.8 + Math.random() * 0.3, 1, 'rocket');
    }
  }

  updateProgress(world) {
    const L = this.track.length;
    for (const k of this.karts) {
      let d = k.s - k._prevS;
      if (d > L / 2) d -= L;
      else if (d < -L / 2) d += L;
      if (Math.abs(d) > MAX_STEP) d = 0;
      k._prevS = k.s;
      k.progress += d;

      // contramão: rumo oposto à pista por algum tempo
      const t = this.track.sample(k.s).tangent;
      const fx = Math.sin(k.heading);
      const fz = Math.cos(k.heading);
      const dot = fx * t.x + fz * t.z;
      k.wrongWay = dot < -0.3 && Math.abs(k.speed) > 3 ? k.wrongWay + 1 : 0;

      if (k.finished) continue;
      const lapNow = Math.floor(k.progress / L) + 1; // 0 no grid, 1 na primeira volta
      if (lapNow > k.maxLap) {
        k.maxLap = lapNow;
        if (lapNow > this.totalLaps) {
          this.finishKart(k);
          continue;
        }
        if (lapNow >= 2) {
          this.bus.emit('race:lap', { kart: k, lap: lapNow });
          if (k === this.player && lapNow === this.totalLaps && this.totalLaps > 1) {
            this.bus.emit('race:finalLap', { kart: k });
          }
        }
      }
      k.lap = Math.min(Math.max(1, lapNow), this.totalLaps);
    }
  }

  finishKart(k) {
    k.finished = true;
    k.finishTime = this.time;
    this.finishOrder.push(k);
    k.place = this.finishOrder.length;
    this.bus.emit('race:finish', { kart: k, place: k.place, time: k.finishTime });
    if (k === this.player) this.phase = 'finished';
  }

  updatePlaces() {
    const sorted = this.karts.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    sorted.forEach((k, i) => (k.place = i + 1));
    this.sorted = sorted;
  }

  // Lista final: quem não terminou recebe tempo estimado pela distância que falta.
  buildResults() {
    const L = this.track.length;
    const total = this.totalLaps * L;
    const list = this.sorted.map((k) => {
      let time = k.finishTime;
      let estimated = false;
      if (!k.finished) {
        const remaining = Math.max(0, total - k.progress);
        const avg = Math.max(8, k.progress / Math.max(1, this.time));
        time = this.time + remaining / avg;
        estimated = true;
      }
      return { kart: k, time, estimated };
    });
    list.sort((a, b) => a.time - b.time);
    // quem já terminou mantém a ordem de chegada
    const finished = list.filter((r) => r.kart.finished).sort((a, b) => a.kart.finishTime - b.kart.finishTime);
    const rest = list.filter((r) => !r.kart.finished);
    this.results = [...finished, ...rest].map((r, i) => ({ ...r, place: i + 1 }));
    return this.results;
  }
}

export function formatTime(t) {
  if (!isFinite(t)) return '--:--.--';
  // arredonda em centésimos antes de separar os minutos (evita '0:60.00')
  const cs = Math.round(t * 100);
  const m = Math.floor(cs / 6000);
  const s = (cs % 6000) / 100;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
