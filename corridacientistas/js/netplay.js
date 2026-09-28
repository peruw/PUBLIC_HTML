// Corrida online ao vivo (sala por código): transporte trocável e sala de espera (NetRoom).
// Não há tabelas novas: tudo passa por um canal público "broadcast + presence" do Supabase
// Realtime (SupabaseTransport), 'kart-live:<CÓDIGO>'. Para testar sem internet, o
// LocalTransport usa o BroadcastChannel do navegador (várias abas da mesma origem), com a
// presença simulada por batimentos. Os dois têm a mesma interface:
//   on('msg', fn(msg))           mensagem de outro aparelho (nunca a própria)
//   on('presence', fn(Map))      quem está na sala agora: id -> meta (inclui você)
//   on('status', fn(s))          'connected' | 'error' | 'closed'
//   connect(meta) -> Promise<bool>, track(meta), send(msg), close(), members (Map)
// Este módulo não mexe no DOM nem no jogo (dá para testar no Node: dev/netplay.test.mjs).

export const NET_VERSION = 1; // aparelhos com versões diferentes não correm juntos
export const MAX_HUMANS = 8; // RACE.kartCount: as vagas que sobram viram IA
// sem I, L, O, 0 e 1: não se confundem ao copiar do quadro
export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TOPIC_PREFIX = 'kart-live:';
const EVENT = 'k'; // um só evento de broadcast; o tipo vai dentro da mensagem (ty)
const CODE_RE = new RegExp(`^[${CODE_CHARS}]{5}$`);

export function makeRoomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length) % CODE_CHARS.length];
  return s;
}

export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

export const isRoomCode = (s) => CODE_RE.test(s || '');

// Id deste aparelho NESTA página (duas abas = dois jogadores): não vai para o localStorage.
export function makePeerId() {
  let s = 'p';
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 10; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

// Nome visível para os outros: sem símbolos de HTML nem caracteres de controle, até 16 letras.
export function cleanName(s) {
  return String(s || '').replace(/[\u0000-\u001f<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

const isLocalHost = (h) => !h || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';

// Qual transporte usar: ?net=local força o local; no site (cliente do Supabase carregado),
// o Supabase; numa página local (testes, sem o /conta/ do site), o local. null = indisponível.
export function transportKind({ search = '', hasClient = false, hostname = '' } = {}) {
  let q = null;
  try {
    q = new URLSearchParams(search).get('net');
  } catch {
    /* sem parâmetros */
  }
  if (q === 'local') return 'local';
  if (hasClient) return 'supabase';
  if (isLocalHost(hostname)) return 'local';
  return null;
}

// ---------------------------------------------------------------------------
// Interpolação de um kart remoto: guarda os estados (carimbados com o relógio de quem mandou)
// e devolve a pose `delay` s atrás, no relógio de quem recebe. A diferença entre os relógios
// é a menor já vista (a entrega mais rápida) e sobe devagar se o outro aparelho atrasar.
// pose = { x, y, z, h (rumo), v (velocidade), st (esterço), g (no chão), s (posição na pista) }
// ---------------------------------------------------------------------------
const TWO_PI = Math.PI * 2;
function wrapAngle(a) {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}

export class Interp {
  constructor({ delay = 0.1, extrap = 0.25, max = 30 } = {}) {
    this.delay = delay;
    this.extrap = extrap;
    this.max = max;
    this.buf = [];
    this.off = null;
  }

  // t: relógio de quem mandou; now: relógio daqui. false = estado velho (fora de ordem).
  push(t, now, pose) {
    const d = now - t;
    if (this.off === null || d < this.off) this.off = d;
    else this.off += (d - this.off) * 0.02;
    const buf = this.buf;
    if (buf.length && t <= buf[buf.length - 1].t) return false;
    buf.push({ t, ...pose });
    if (buf.length > this.max) buf.shift();
    return true;
  }

  // Pose no instante now - diferença - delay (null se ainda não chegou nada).
  sample(now, out) {
    const buf = this.buf;
    if (!buf.length) return null;
    const last = buf[buf.length - 1];
    let rt = now - this.off - this.delay;
    // ficou muito para trás (aba escondida, rede travou): recomeça do estado mais novo
    if (rt > last.t + 0.5) {
      this.off = now - last.t;
      rt = last.t - this.delay;
    }
    let a = buf[0];
    let b = null;
    if (rt > a.t) {
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= rt) {
          a = buf[i];
          b = buf[i + 1] || null;
          break;
        }
      }
    }
    if (b) {
      const u = (rt - a.t) / Math.max(1e-4, b.t - a.t);
      out.x = a.x + (b.x - a.x) * u;
      out.y = a.y + (b.y - a.y) * u;
      out.z = a.z + (b.z - a.z) * u;
      out.h = wrapAngle(a.h + wrapAngle(b.h - a.h) * u);
      out.v = a.v + (b.v - a.v) * u;
      out.st = a.st + (b.st - a.st) * u;
      out.g = u < 0.5 ? a.g : b.g;
      out.s = u < 0.5 ? a.s : b.s;
    } else {
      // depois do último estado: segue em frente mais um pouco (rumo e velocidade)
      const dt = Math.max(0, Math.min(rt - a.t, this.extrap));
      out.x = a.x + Math.sin(a.h) * a.v * dt;
      out.y = a.y;
      out.z = a.z + Math.cos(a.h) * a.v * dt;
      out.h = a.h;
      out.v = a.v;
      out.st = a.st;
      out.g = a.g;
      out.s = a.s;
    }
    return out;
  }
}

class Emitter {
  constructor() {
    this._h = new Map();
  }

  on(ev, fn) {
    if (!this._h.has(ev)) this._h.set(ev, new Set());
    this._h.get(ev).add(fn);
    return () => this._h.get(ev)?.delete(fn);
  }

  _emit(ev, ...args) {
    const set = this._h.get(ev);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[net] erro no evento ${ev}`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Supabase Realtime (supabase-js v2): canal público com broadcast e presence.
// ---------------------------------------------------------------------------
export class SupabaseTransport extends Emitter {
  constructor(client, code, id, { timeout = 12000 } = {}) {
    super();
    this.client = client;
    this.topic = TOPIC_PREFIX + code;
    this.id = id;
    this.timeout = timeout;
    this.ch = null;
    this.meta = null;
    this.members = new Map();
    this.connected = false;
  }

  connect(meta) {
    this.meta = { ...meta };
    const ch = this.client.channel(this.topic, {
      config: { broadcast: { self: false }, presence: { key: this.id } },
    });
    this.ch = ch;
    ch.on('broadcast', { event: EVENT }, (e) => {
      const m = e && e.payload;
      if (m && typeof m === 'object') this._emit('msg', m);
    });
    // 'sync' traz o estado inteiro; 'join'/'leave' só avisam (a NetRoom compara as listas)
    ch.on('presence', { event: 'sync' }, () => this._sync());
    ch.on('presence', { event: 'join' }, () => {});
    ch.on('presence', { event: 'leave' }, () => {});
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), this.timeout);
      ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          this.connected = true;
          // (volta a marcar presença também depois de uma reconexão automática)
          try {
            await ch.track(this.meta);
          } catch {
            /* tenta de novo no próximo track */
          }
          this._emit('status', 'connected');
          finish(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this._emit('status', 'error');
          finish(false);
        } else if (status === 'CLOSED') {
          this.connected = false;
          this._emit('status', 'closed');
          finish(false);
        }
      });
    });
  }

  _sync() {
    const st = (this.ch && this.ch.presenceState()) || {};
    const map = new Map();
    for (const [key, list] of Object.entries(st)) {
      const m = Array.isArray(list) && list.length ? list[list.length - 1] : null;
      if (!m) continue;
      const { presence_ref: _ref, ...meta } = m;
      map.set(key, meta);
    }
    this.members = map;
    this._emit('presence', map);
  }

  track(meta) {
    this.meta = { ...meta };
    if (!this.ch || !this.connected) return Promise.resolve();
    return this.ch.track(this.meta).catch(() => {});
  }

  send(msg) {
    if (!this.ch || !this.connected) return;
    try {
      const p = this.ch.send({ type: 'broadcast', event: EVENT, payload: msg });
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* conexão caiu: o próximo estado vai de novo */
    }
  }

  close() {
    const ch = this.ch;
    this.ch = null;
    this.connected = false;
    this.members = new Map();
    if (!ch) return;
    try {
      const p = ch.untrack();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* ignora */
    }
    try {
      this.client.removeChannel(ch);
    } catch {
      /* ignora */
    }
  }
}

// ---------------------------------------------------------------------------
// Local (testes): BroadcastChannel entre abas da mesma origem, presença por batimentos.
// ---------------------------------------------------------------------------
export class LocalTransport extends Emitter {
  constructor(code, id, { beat = 1000, timeout = 8000, Channel = globalThis.BroadcastChannel } = {}) {
    super();
    this.topic = TOPIC_PREFIX + code;
    this.id = id;
    this.beat = beat;
    this.timeout = timeout;
    this.Channel = Channel;
    this.bc = null;
    this.meta = null;
    this.members = new Map();
    this.seen = new Map();
    this.connected = false;
    this._timers = [];
  }

  connect(meta) {
    if (!this.Channel) return Promise.resolve(false);
    this.meta = { ...meta };
    this.bc = new this.Channel(this.topic);
    this.bc.onmessage = (e) => this._raw(e.data);
    this.connected = true;
    this.members.set(this.id, this.meta);
    // "olá": quem já está na sala responde na hora (não espera o próximo batimento)
    this._post({ k: 'p', id: this.id, meta: this.meta, hello: true });
    this._timers.push(setInterval(() => this._post({ k: 'p', id: this.id, meta: this.meta }), this.beat));
    this._timers.push(setInterval(() => this._sweep(), this.timeout / 4));
    this._emit('status', 'connected');
    this._emit('presence', new Map(this.members));
    return Promise.resolve(true);
  }

  _post(d) {
    try {
      this.bc?.postMessage(d);
    } catch {
      /* canal fechado */
    }
  }

  _raw(d) {
    if (!d || typeof d !== 'object' || d.id === this.id) return;
    if (d.k === 'm') {
      if (d.m && typeof d.m === 'object') this._emit('msg', d.m);
      return;
    }
    if (d.k === 'p' && d.id && d.meta) {
      this.seen.set(d.id, Date.now());
      const old = this.members.get(d.id);
      this.members.set(d.id, d.meta);
      if (d.hello) this._post({ k: 'p', id: this.id, meta: this.meta });
      if (!old || JSON.stringify(old) !== JSON.stringify(d.meta)) this._emit('presence', new Map(this.members));
    } else if (d.k === 'bye' && d.id) {
      this.seen.delete(d.id);
      if (this.members.delete(d.id)) this._emit('presence', new Map(this.members));
    }
  }

  // quem parou de bater some (aba fechada sem 'bye', travada, sem rede)
  _sweep() {
    const now = Date.now();
    let changed = false;
    for (const [id, t] of this.seen) {
      if (now - t > this.timeout) {
        this.seen.delete(id);
        this.members.delete(id);
        changed = true;
      }
    }
    if (changed) this._emit('presence', new Map(this.members));
  }

  track(meta) {
    this.meta = { ...meta };
    if (!this.connected) return Promise.resolve();
    this.members.set(this.id, this.meta);
    this._post({ k: 'p', id: this.id, meta: this.meta });
    this._emit('presence', new Map(this.members));
    return Promise.resolve();
  }

  send(msg) {
    if (this.connected) this._post({ k: 'm', id: this.id, m: msg });
  }

  close() {
    if (!this.bc) return;
    this._post({ k: 'bye', id: this.id });
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
    try {
      this.bc.close();
    } catch {
      /* ignora */
    }
    this.bc = null;
    this.connected = false;
    this.members = new Map();
    this.seen.clear();
  }
}

// ---------------------------------------------------------------------------
// Sala: quem está (presence), quem é o anfitrião, escolhas e mensagens por tipo.
// ---------------------------------------------------------------------------
// meta de cada jogador: { id, name, character, joined, phase: 'lobby'|'race'|'results', v,
//   cc, laps (o anfitrião), creator (quem criou a sala) }.
// Anfitrião = quem criou a sala; se ele sair, quem entrou primeiro (joined; empate pelo id).
// (o relógio de cada aparelho decide só a sucessão: quem criou não depende dele)
// Eventos: 'members' (lista mudou), 'join'(m), 'leave'(id), 'status'(s), 'msg:<tipo>'(msg).
const byOrder = (a, b) => (b.creator ? 1 : 0) - (a.creator ? 1 : 0) || a.joined - b.joined || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class NetRoom extends Emitter {
  constructor(transport, { code, id, name, character, cc = '100cc', laps = 2, creator = false }) {
    super();
    this.t = transport;
    this.code = code;
    this.id = id;
    this.meta = { id, name: cleanName(name) || 'Jogador', character, joined: Date.now(), phase: 'lobby', v: NET_VERSION, cc, laps, creator: !!creator };
    this.members = [];
    this.connected = false;
    this.closed = false;
    this._settings = { cc, laps };
    this._offs = [
      transport.on('msg', (m) => this._onMsg(m)),
      transport.on('presence', (map) => this._onPresence(map)),
      transport.on('status', (s) => {
        this.connected = s === 'connected' ? true : s === 'closed' ? false : this.connected;
        this._emit('status', s);
      }),
    ];
  }

  async join() {
    const ok = await this.t.connect({ ...this.meta });
    this.connected = ok;
    return ok;
  }

  get host() {
    return this.members.find((m) => m.v === NET_VERSION) || this.members[0] || null;
  }

  get hostId() {
    return this.host ? this.host.id : this.id;
  }

  get isHost() {
    return this.hostId === this.id;
  }

  // motor e voltas: os do anfitrião (quem vira anfitrião continua com os últimos valores)
  get settings() {
    return this.isHost ? { cc: this.meta.cc, laps: this.meta.laps } : this._settings;
  }

  // posição na ordem de entrada (0 = anfitrião); acima de MAX_HUMANS a sala está cheia
  get order() {
    return this.members.findIndex((m) => m.id === this.id);
  }

  // Quem ficou com o cientista (em caso de repetição, vale quem entrou primeiro).
  ownerOf(charId) {
    return this.members.find((m) => m.character === charId && m.v === NET_VERSION) || null;
  }

  // Meu cientista foi pego por alguém que entrou antes: devolve um livre de `pool` (ou null).
  resolveCharacter(pool) {
    const own = this.ownerOf(this.meta.character);
    if (!own || own.id === this.id) return null;
    return pool.find((c) => !this.ownerOf(c)) || null;
  }

  update(patch) {
    Object.assign(this.meta, patch);
    if (patch.name !== undefined) this.meta.name = cleanName(patch.name) || 'Jogador';
    if (this.connected) this.t.track({ ...this.meta });
    // atualiza a lista local na hora (o eco da presença pode demorar)
    const map = new Map(this.t.members || []);
    map.set(this.id, { ...this.meta });
    this._onPresence(map);
  }

  send(ty, data = {}) {
    if (this.closed) return;
    this.t.send({ ...data, ty, fr: this.id });
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    for (const off of this._offs) off();
    this.t.close();
    this.connected = false;
  }

  _onMsg(m) {
    if (!m || typeof m.ty !== 'string' || !m.fr || m.fr === this.id) return;
    this._emit('msg:' + m.ty, m);
  }

  _onPresence(map) {
    if (this.closed) return;
    const list = [];
    for (const [id, meta] of map) {
      // o próprio jogador vale pelo que está aqui (o eco da presença pode vir atrasado)
      if (id === this.id || !meta || typeof meta !== 'object') continue;
      list.push({ ...meta, id, name: cleanName(meta.name) || 'Jogador', joined: Number(meta.joined) || 0 });
    }
    list.push({ ...this.meta });
    list.sort(byOrder);
    const before = new Set(this.members.map((m) => m.id));
    const now = new Set(list.map((m) => m.id));
    this.members = list;
    const h = this.host;
    if (h && h.id !== this.id && h.cc) this._settings = { cc: h.cc, laps: h.laps };
    // virei anfitrião (o anterior saiu): fico com o motor e as voltas que ele tinha escolhido
    // (e passo a valer como "criador": quem entrar depois não toma o lugar por relógio adiantado)
    const prevHost = this._lastHost;
    if (h) this._lastHost = h.id; // antes do track: o eco da presença pode chegar na mesma hora
    if (h && h.id === this.id && prevHost && prevHost !== this.id) {
      this.meta.cc = this._settings.cc;
      this.meta.laps = this._settings.laps;
      this.meta.creator = true;
      const me = list.find((m) => m.id === this.id);
      if (me) Object.assign(me, { cc: this.meta.cc, laps: this.meta.laps, creator: true });
      if (this.connected) this.t.track({ ...this.meta });
    }
    for (const m of list) if (!before.has(m.id) && m.id !== this.id) this._emit('join', m);
    for (const id of before) if (!now.has(id)) this._emit('leave', id);
    this._emit('members', list);
  }
}
