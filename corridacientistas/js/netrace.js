// Corrida online ao vivo: sincroniza os karts entre os aparelhos durante a corrida.
// - Cada aparelho simula só o PRÓPRIO kart (o anfitrião também simula a IA) e manda o estado
//   ~15 vezes por segundo ('st'). Os karts dos outros são "remotos": sem física aqui, seguem a
//   rede com ~100 ms de atraso, interpolados (kart.netPose). Posições (1º, 2º...) saem do
//   progresso de todos (race.updatePlaces).
// - Itens: quem usa simula. Acerto em kart remoto vira 'hit' e só o dono do kart aplica.
//   Bobina de Tesla: 'tesla' e cada aparelho dá o choque nos próprios karts. Maçã: 'hazard'
//   cria a mesma maçã em todos e quem bate avisa 'hazard-gone'. Foguete, pilha, alfa, elétron e
//   buraco negro: os outros desenham uma cópia só visual ('use').
// - Chegada: 'fin' (o estado também leva o tempo de chegada, caso a mensagem se perca). O
//   resultado fecha quando todos os humanos chegaram ou 60 s depois do primeiro (quem falta
//   recebe tempo estimado, calculado no próprio aparelho e avisado com 'fin' est).
// - Saída: quem sai da sala vira "abandonou" (o kart some); se quem começou a corrida sair,
//   a IA dele sai junto e a corrida continua para os demais.
import { Vector3 } from './three.js';
import { Interp } from './netplay.js';

const DELAY = 0.1; // s de atraso da interpolação (dá tempo de o próximo estado chegar)
const EXTRAP = 0.25; // s máximos andando "no escuro" quando o estado atrasa
export const WAIT_OTHERS = 60; // s depois da chegada do 1º humano
const FIN_GRACE = 4; // s a mais esperando as estimativas dos outros aparelhos
const LEAVE_GRACE = 2.5; // s antes de dar alguém como desconectado (reconexão rápida)

// Estados por segundo de cada aparelho: menos com a sala cheia (o Realtime conta cada entrega).
export const sendRate = (humans) => (humans <= 3 ? 15 : humans <= 5 ? 12 : 10);

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const GHOST_ITEMS = new Set(['foguete', 'pilha3', 'alfa', 'eletron', 'buraco']);
const POSE = { x: 0, y: 0, z: 0, h: 0, v: 0, st: 0, g: true, s: 0 };

export class NetRace {
  // msg: mensagem 'start' do anfitrião; byId: id -> Kart (humanos e IA desta corrida).
  constructor({ room, msg, byId, world, race, items, bus, track }) {
    this.room = room;
    this.id = room.id;
    this.raceId = msg.race;
    this.hostId = msg.host; // quem começou a corrida (dono da IA)
    this.isHost = msg.host === room.id;
    this.world = world;
    this.race = race;
    this.items = items;
    this.bus = bus;
    this.track = track;
    this.byId = byId;
    this.idOf = new Map();
    for (const [id, k] of byId) this.idOf.set(k, id);
    this.me = byId.get(this.id);
    this.humans = Object.keys(msg.humans).map((id) => byId.get(id)).filter(Boolean);
    this.remote = new Map(); // id -> { kart, interp } (karts de outros aparelhos)
    this.owned = [];
    for (const [id, k] of byId) {
      const mine = id === this.id || (this.isHost && id.startsWith('ia:'));
      k.remote = !mine;
      k.netId = id;
      k.netName = msg.humans[id] ? msg.humans[id].name : null;
      k.netHit = mine ? null : (type, by, item) => this._sendHit(k, type, by, item);
      k.itemHeld = null;
      if (mine) this.owned.push(k);
      else this.remote.set(id, { kart: k, interp: new Interp({ delay: DELAY, extrap: EXTRAP }) });
    }
    this.clock = 0; // s de simulação desde a largada (carimbo dos estados)
    this.sendT = 0;
    this.rate = sendRate(this.humans.length);
    this.left = []; // quem saiu: { id, kart, name, human, finished, time }
    this.leaving = new Map(); // id -> clock limite (saída ainda em carência)
    this.firstFin = -1;
    this.est = new Map(); // kart -> tempo estimado (não chegou no prazo)
    this.final = null; // resultado final
    this.appleN = 0;
    this.onFinal = null; // (resultado) => void
    this.onLeft = null; // (kart) => void (aviso "Fulano saiu")
    this.onTimeUp = null; // () => void (o prazo acabou para o jogador deste aparelho)
    this.stats = { sent: 0, recv: 0, hitsSent: 0, hitsApplied: 0, teslaSent: 0, teslaApplied: 0, applesSent: 0, applesRecv: 0, applesGone: 0, uses: 0, ghosts: 0 };
    world.humans = this.humans.slice();
    items.net = this;
    const r = room;
    this._offs = [
      r.on('msg:st', (m) => this._onState(m)),
      r.on('msg:hit', (m) => this._onHit(m)),
      r.on('msg:tesla', (m) => this._onTesla(m)),
      r.on('msg:use', (m) => this._onUse(m)),
      r.on('msg:hazard', (m) => this._onHazard(m)),
      r.on('msg:hazard-gone', (m) => this._onHazardGone(m)),
      r.on('msg:fin', (m) => this._onFin(m)),
      r.on('leave', (id) => this._onLeave(id)),
      r.on('join', (m) => this.leaving.delete(m.id)),
      bus.on('race:finish', (e) => this._onFinish(e)),
    ];
    // quem já tinha saído da sala antes da largada (a mensagem 'start' e a saída se cruzaram)
    const present = new Set(room.members.map((m) => m.id));
    for (const k of this.humans) if (k !== this.me && !present.has(this.idOf.get(k))) this.leaving.set(this.idOf.get(k), LEAVE_GRACE * 2);
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs = [];
    for (const k of this.byId.values()) {
      k.remote = false;
      k.netId = null;
      k.netName = null;
      k.netHit = null;
      k.itemHeld = null;
    }
    if (this.items.net === this) this.items.net = null;
    this.world.humans = null;
  }

  _send(ty, data) {
    this.room.send(ty, { ...data, r: this.raceId });
  }

  // ---------- simulação (chamada pelo passo fixo do main.js) ----------
  // Antes da física: karts remotos vão para a pose interpolada.
  preStep(h) {
    this.clock += h;
    if (this.final) return;
    for (const e of this.remote.values()) {
      if (e.interp.sample(this.clock, POSE)) e.kart.netPose(POSE, h, this.track);
    }
    for (const [id, until] of this.leaving) {
      if (this.clock >= until) {
        this.leaving.delete(id);
        this._drop(id);
      }
    }
  }

  // Tempo real que a simulação não conseguiu acompanhar (aparelho lento, aba escondida).
  lag(sec) {
    if (sec > 0 && !this.final) this.clock += Math.min(sec, 120);
  }

  // Depois da física: manda o estado dos karts deste aparelho e confere o fim da corrida.
  postStep(h) {
    if (this.final) return;
    this.sendT -= h;
    if (this.sendT <= 0) {
      this.sendT = Math.max(0, this.sendT + 1 / this.rate);
      this._sendState();
    }
    this._checkEnd();
  }

  // ---------- estado ('st') ----------
  _snap(k) {
    const s = {
      i: this.idOf.get(k), x: r2(k.position.x), y: r2(k.position.y), z: r2(k.position.z), h: r3(k.heading),
      v: r2(k.speed), st: r2(k.steer), s: r2(k.s), p: r2(k.progress), l: k.lap,
    };
    if (!k.onGround) s.ag = 1; // no ar
    if (k.drifting) {
      s.dr = 1;
      s.dd = k.driftDir;
      s.dl = k.driftLevel;
    }
    if (k.boostTime > 0) s.bo = r2(k.boostTime);
    if (k.starTime > 0) s.sa = r2(k.starTime);
    if (k.shrinkTime > 0) s.sk = r2(k.shrinkTime);
    if (k.spinTime > 0) {
      s.sp = r2(k.spinTime);
      s.ht = k.hitType;
    }
    if (k.tumbleTime > 0) s.tb = r2(k.tumbleTime);
    if (k.recovering) s.hc = r2(k._hitCd);
    if (k.item) {
      s.it = k.item;
      s.ic = k.itemCount;
    }
    if (k.roulette) s.ro = 1;
    if (k.itemHeld) {
      s.hd = k.itemHeld.item;
      if (k.itemHeld.back) s.hb = 1;
    }
    if (k.finished) s.ft = r3(k.finishTime);
    return s;
  }

  _sendState() {
    const ks = [];
    for (const k of this.owned) if (this.world.karts.includes(k)) ks.push(this._snap(k));
    if (!ks.length) return;
    this._send('st', { t: r3(this.clock), k: ks });
    this.stats.sent++;
  }

  _onState(m) {
    if (m.r !== this.raceId || this.final || !Array.isArray(m.k)) return;
    this.stats.recv++;
    this.leaving.delete(m.fr); // mandou estado: está vivo
    // tinha caído (rede piscou, aba travou) e voltou a mandar estado: volta para a corrida
    if (this.left.some((l) => l.id === m.fr)) this._undrop(m.fr);
    const t = Number(m.t) || 0;
    for (const s of m.k) {
      const e = this.remote.get(s && s.i);
      if (!e) continue;
      // só o dono manda o estado de um kart (a IA é de quem começou a corrida)
      if (String(s.i).startsWith('ia:') ? m.fr !== this.hostId : m.fr !== s.i) continue;
      const k = e.kart;
      const pose = { x: +s.x, y: +s.y, z: +s.z, h: +s.h, v: +s.v || 0, st: +s.st || 0, g: !s.ag, s: +s.s || 0 };
      if (![pose.x, pose.y, pose.z, pose.h].every(Number.isFinite)) continue;
      if (!e.interp.push(t, this.clock, pose)) continue; // fora de ordem
      k.netState(s);
      k.roulette = s.ro ? k.roulette || { time: 1, showing: null, result: null, remote: true } : null;
      if (s.hd) {
        if (!k.itemHeld || k.itemHeld.item !== s.hd) k.itemHeld = { item: s.hd, t: 0, back: !!s.hb, pos: k.itemHeld?.pos || new Vector3().copy(k.position) };
        else k.itemHeld.back = !!s.hb;
      } else k.itemHeld = null;
      k.progress = +s.p || 0;
      k.distance = k.progress; // (a IA mede a distância para o elástico por aqui)
      k.lap = Math.max(1, Math.min(this.world.totalLaps || 1, s.l | 0));
      if (typeof s.ft === 'number' && !k.finished) this.race.finishRemote(k, s.ft);
    }
  }

  // ---------- batidas ----------
  // Algo deste aparelho acertou um kart remoto: o dono aplica. Aqui só a animação e o aviso.
  _sendHit(k, type, by, item) {
    if (this.final || !this.world.karts.includes(k)) return false;
    this._send('hit', { target: this.idOf.get(k), type, item: item || null, by: (by && this.idOf.get(by)) || null });
    this.stats.hitsSent++;
    if (type !== 'shield') {
      k.netStun(type);
      this.bus.emit('kart:hit', { kart: k, type, by, item: item ?? null });
    }
    return true;
  }

  _onHit(m) {
    if (m.r !== this.raceId || this.final) return;
    const k = this.byId.get(m.target);
    if (!k || !this.world.karts.includes(k)) return;
    const by = (m.by && this.byId.get(m.by)) || null;
    if (k.remote) {
      // não é meu: some a cópia do projétil que acertou (só visual)
      if (by && (m.item === 'alfa' || m.item === 'eletron')) this._killGhost(by, m.item, k);
      return;
    }
    if (m.type === 'shield') {
      this.items.breakHeldNet(k);
      return;
    }
    if (!['spin', 'tumble', 'shock'].includes(m.type)) return;
    if (k.hit(m.type, by, m.item || null)) this.stats.hitsApplied++;
  }

  _killGhost(by, type, target) {
    let best = null;
    let bd = 14 * 14;
    for (const p of this.items.projs) {
      if (!p.active || !p.ghost || p.owner !== by || p.type !== type) continue;
      const d = p.pos.distanceToSquared(target.position);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return;
    best.active = false;
    this.bus.emit('item:explode', { pos: best.pos, item: type });
  }

  // ---------- itens (ganchos do items.js) ----------
  onUse(k, id, info) {
    if (this.final) return;
    const by = this.idOf.get(k);
    if (!by) return;
    this.stats.uses++;
    if (id === 'tesla') {
      this._send('tesla', { by });
      this.stats.teslaSent++;
      return;
    }
    // maçã vai por 'hazard'; a gaiola de Faraday aparece pelo estado
    if (!GHOST_ITEMS.has(id)) return;
    const d = { by, item: id };
    if (id === 'alfa') {
      d.back = !!info.back;
      if (info.from) d.from = [r2(info.from.x), r2(info.from.y), r2(info.from.z)];
    } else if (id === 'eletron' || id === 'buraco') {
      const tg = info.obj && info.obj.target;
      if (!tg || !this.idOf.has(tg)) return;
      d.target = this.idOf.get(tg);
      if (id === 'eletron') d.back = info.obj.sdir === -1;
    }
    this._send('use', d);
  }

  _onUse(m) {
    if (m.r !== this.raceId || this.final) return;
    const k = this.byId.get(m.by);
    if (!k || !k.remote || !this.world.karts.includes(k)) return;
    const tg = m.target ? this.byId.get(m.target) : null;
    if (m.target && (!tg || !this.world.karts.includes(tg))) return;
    this.items.ghostUse(k, m.item, m, tg);
    this.stats.ghosts++;
  }

  _onTesla(m) {
    if (m.r !== this.raceId || this.final) return;
    const k = this.byId.get(m.by);
    if (!k || !k.remote) return;
    this.items.teslaFrom(k);
    this.stats.teslaApplied++;
  }

  onApple(a) {
    const by = this.idOf.get(a.owner);
    if (!by || this.final) return;
    a.nid = `${this.id}:${++this.appleN}`;
    this._send('hazard', {
      id: a.nid, by, from: [r2(a.from.x), r2(a.from.y), r2(a.from.z)], to: [r2(a.to.x), r2(a.to.y), r2(a.to.z)],
      g: r2(a.ground), s: r2(a.s), lat: r2(a.hazard.lateral || 0),
    });
    this.stats.applesSent++;
  }

  onAppleGone(a) {
    if (!a.nid || this.final) return;
    this._send('hazard-gone', { id: a.nid });
    this.stats.applesGone++;
  }

  _onHazard(m) {
    if (m.r !== this.raceId || this.final || !Array.isArray(m.from) || !Array.isArray(m.to)) return;
    const k = this.byId.get(m.by);
    if (!k) return;
    this.items.spawnApple(k, m);
    this.stats.applesRecv++;
  }

  _onHazardGone(m) {
    if (m.r !== this.raceId || this.final) return;
    this.items.removeApple(m.id);
  }

  // ---------- chegada e resultado ----------
  _onFinish({ kart, time }) {
    if (!this.byId.has(this.idOf.get(kart))) return;
    if (this.humans.includes(kart) && this.firstFin < 0) this.firstFin = this.clock;
    if (!kart.remote && !this.final) this._send('fin', { id: this.idOf.get(kart), time: r3(time) });
  }

  _onFin(m) {
    if (m.r !== this.raceId) return;
    const k = this.byId.get(m.id);
    if (!k || !k.remote || typeof m.time !== 'number') return;
    if (m.est) {
      this.est.set(k, m.time);
      // estimativa da IA vinda do anfitrião depois de fechar: refaz a lista com ela (todos
      // os aparelhos mostram os mesmos tempos)
      if (this.final && m.fr === this.hostId && !this.humans.includes(k)) {
        this.final = null;
        this._finalize();
      }
    } else if (!this.final) this.race.finishRemote(k, m.time);
  }

  _estimate(k) {
    const L = this.track.length;
    const total = (this.world.totalLaps || 1) * L;
    const t = this.race.time;
    const remaining = Math.max(0, total - k.progress);
    const avg = Math.max(8, k.progress / Math.max(1, t));
    return t + remaining / avg;
  }

  // Segundos que faltam para fechar o resultado (60 s depois do 1º humano), ou null.
  get timeLeft() {
    if (this.firstFin < 0 || this.final) return null;
    return Math.max(0, WAIT_OTHERS - (this.clock - this.firstFin));
  }

  _checkEnd() {
    const active = this.humans.filter((k) => this.world.karts.includes(k));
    const pending = active.filter((k) => !k.finished && !this.est.has(k));
    if (active.length && !pending.length) {
      this._finalize();
      return;
    }
    if (this.firstFin < 0) return;
    const t = this.clock - this.firstFin;
    if (t < WAIT_OTHERS) return;
    // prazo acabou: quem ainda corre neste aparelho recebe o tempo estimado e avisa os outros
    for (const k of this.owned) {
      if (!this.humans.includes(k) || k.finished || this.est.has(k)) continue;
      const time = this._estimate(k);
      this.est.set(k, time);
      this._send('fin', { id: this.idOf.get(k), time: r3(time), est: 1 });
      if (k === this.me) this.onTimeUp?.();
    }
    if (t >= WAIT_OTHERS + FIN_GRACE) this._finalize();
  }

  // Lista para a tela de resultado. final = false: parcial (quem ainda corre fica "correndo").
  results(final = !!this.final) {
    if (final && this.final) return this.final;
    const rows = [];
    for (const k of this.race.karts) {
      const human = this.humans.includes(k);
      let time = k.finishTime;
      let estimated = false;
      let running = false;
      if (!k.finished) {
        // parcial: quem ainda corre (humano ou IA) aparece "correndo…" pela posição na pista
        if (this.est.has(k)) {
          time = this.est.get(k);
          estimated = true;
        } else if (final) {
          time = this._estimate(k);
          estimated = true;
        } else running = true;
      }
      rows.push({ kart: k, id: this.idOf.get(k), name: k.netName, human, time, estimated, running, left: false });
    }
    for (const l of this.left) {
      if (l.finished) rows.push({ kart: l.kart, id: l.id, name: l.name, human: l.human, time: l.time, estimated: false, running: false, left: true });
    }
    // quem chegou de verdade vem antes de quem só tem tempo estimado; quem corre, pelo progresso
    const fin = rows.filter((r) => !r.estimated && !r.running).sort((a, b) => a.time - b.time);
    const est = rows.filter((r) => r.estimated).sort((a, b) => a.time - b.time);
    const run = rows.filter((r) => r.running).sort((a, b) => b.kart.progress - a.kart.progress);
    const out = [...fin, ...est, ...run].map((r, i) => ({ ...r, place: i + 1 }));
    for (const l of this.left) {
      if (!l.finished) out.push({ kart: l.kart, id: l.id, name: l.name, human: l.human, time: Infinity, estimated: false, running: false, left: true, place: null });
    }
    return out;
  }

  _finalize() {
    if (this.final) return;
    // anfitrião: a IA que não chegou recebe o tempo estimado aqui e os outros usam o mesmo
    if (this.isHost) {
      for (const k of this.owned) {
        if (this.humans.includes(k) || k.finished || this.est.has(k) || !this.world.karts.includes(k)) continue;
        const time = this._estimate(k);
        this.est.set(k, time);
        this._send('fin', { id: this.idOf.get(k), time: r3(time), est: 1 });
      }
    }
    this.final = this.results(true);
    this.onFinal?.(this.final);
  }

  // ---------- saídas ----------
  _onLeave(id) {
    if (id === this.id || this.final) return;
    const k = this.byId.get(id);
    if (!k && id !== this.hostId) return;
    if (!this.leaving.has(id)) this.leaving.set(id, this.clock + LEAVE_GRACE);
  }

  _drop(id) {
    const ids = [id];
    // quem começou a corrida saiu: a IA dele para (e sai junto)
    if (id === this.hostId && !this.isHost) for (const x of this.byId.keys()) if (x.startsWith('ia:')) ids.push(x);
    for (const x of ids) {
      const k = this.byId.get(x);
      if (!k || !k.remote) continue;
      const i = this.world.karts.indexOf(k);
      if (i < 0) continue;
      this.world.karts.splice(i, 1); // (race.karts é o mesmo vetor)
      k.object3d.visible = false;
      k.itemHeld = null;
      this.items.forgetKart(k);
      this.remote.delete(x);
      const human = this.humans.includes(k);
      this.left.push({ id: x, kart: k, name: k.netName, human, finished: k.finished, time: k.finishTime });
      this.world.humans = this.humans.filter((o) => this.world.karts.includes(o));
      if (human) this.onLeft?.(k);
    }
  }

  _undrop(id) {
    const ids = [id];
    if (id === this.hostId && !this.isHost) for (const x of this.byId.keys()) if (x.startsWith('ia:')) ids.push(x);
    for (const x of ids) {
      const i = this.left.findIndex((l) => l.id === x);
      if (i < 0) continue;
      const k = this.left[i].kart;
      this.left.splice(i, 1);
      if (!this.world.karts.includes(k)) this.world.karts.push(k);
      k.object3d.visible = true;
      this.remote.set(x, { kart: k, interp: new Interp({ delay: DELAY, extrap: EXTRAP }) });
    }
    this.world.humans = this.humans.filter((o) => this.world.karts.includes(o));
  }

  // Resumo para testes e depuração.
  info() {
    return {
      clock: r2(this.clock), host: this.hostId, me: this.id, rate: this.rate, final: !!this.final, timeLeft: this.timeLeft,
      karts: this.race.karts.map((k) => ({
        id: this.idOf.get(k), name: k.netName, ch: k.character.id, remote: k.remote, place: k.place, progress: r2(k.progress),
        lap: k.lap, finished: k.finished, time: k.finished ? r3(k.finishTime) : null, stunned: k.stunned, x: r2(k.position.x), z: r2(k.position.z),
      })),
      left: this.left.map((l) => l.id),
      stats: { ...this.stats },
    };
  }
}
