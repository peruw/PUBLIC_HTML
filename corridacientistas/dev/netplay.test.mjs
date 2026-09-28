// Testes de unidade da corrida online (transportes e sala), sem navegador e sem rede.
// Rodar: node --test corridacientistas/dev/netplay.test.mjs
// O mock abaixo imita a API do supabase-js v2 que o SupabaseTransport usa:
// client.channel(topic, { config }), ch.on('broadcast'|'presence', { event }, cb),
// ch.subscribe(cb(status)), ch.track(meta), ch.untrack(), ch.send({ type, event, payload }),
// ch.presenceState() -> { key: [{ ...meta, presence_ref }] }, client.removeChannel(ch).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SupabaseTransport, LocalTransport, NetRoom, Interp, makeRoomCode, isRoomCode, normalizeCode,
  transportKind, cleanName, CODE_CHARS, NET_VERSION,
} from '../js/netplay.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ---------- mock do Realtime ----------
function mockServer() {
  const topics = new Map(); // topic -> { chans: Set, state: Map(key -> meta) }
  let ref = 0;
  const topicOf = (t) => {
    if (!topics.has(t)) topics.set(t, { chans: new Set(), state: new Map() });
    return topics.get(t);
  };
  function notify(tp, kind, key, meta) {
    for (const ch of tp.chans) {
      if (!ch.joined) continue;
      for (const b of ch.binds) {
        if (b.type !== 'presence') continue;
        if (b.event === kind) b.cb(kind === 'sync' ? undefined : { key, [kind === 'join' ? 'newPresences' : 'leftPresences']: [meta] });
      }
    }
  }
  class Channel {
    constructor(topic, opts) {
      this.topic = topic;
      this.opts = opts;
      this.binds = [];
      this.joined = false;
      this.key = opts?.config?.presence?.key;
      this.tp = topicOf(topic);
    }
    on(type, filter, cb) {
      this.binds.push({ type, event: filter.event, cb });
      return this;
    }
    subscribe(cb) {
      this.tp.chans.add(this);
      setTimeout(() => {
        this.joined = true;
        cb('SUBSCRIBED');
        // presence_state inicial para quem entrou
        for (const b of this.binds) if (b.type === 'presence' && b.event === 'sync') b.cb();
      }, 1);
      return this;
    }
    async track(meta) {
      const had = this.tp.state.has(this.key);
      this.tp.state.set(this.key, { ...meta, presence_ref: 'r' + ++ref });
      if (!had) notify(this.tp, 'join', this.key, meta);
      notify(this.tp, 'sync');
      return 'ok';
    }
    async untrack() {
      const m = this.tp.state.get(this.key);
      if (!this.tp.state.delete(this.key)) return 'ok';
      notify(this.tp, 'leave', this.key, m);
      notify(this.tp, 'sync');
      return 'ok';
    }
    presenceState() {
      const out = {};
      for (const [k, m] of this.tp.state) out[k] = [m];
      return out;
    }
    async send({ type, event, payload }) {
      server.sent.push({ topic: this.topic, type, event, payload });
      const self = this.opts?.config?.broadcast?.self;
      for (const ch of this.tp.chans) {
        if (!ch.joined || (ch === this && !self)) continue;
        for (const b of ch.binds) if (b.type === 'broadcast' && b.event === event) b.cb({ type, event, payload });
      }
      return 'ok';
    }
  }
  const server = {
    sent: [],
    removed: [],
    client() {
      return {
        channel: (topic, opts) => new Channel(topic, opts),
        removeChannel(ch) {
          server.removed.push(ch.topic);
          ch.tp.chans.delete(ch);
          ch.joined = false;
          if (ch.tp.state.has(ch.key)) ch.untrack();
          return Promise.resolve('ok');
        },
      };
    },
    topics,
  };
  return server;
}

// ---------- utilitários ----------
test('código da sala: 5 letras sem ambíguas', () => {
  for (let i = 0; i < 200; i++) {
    const c = makeRoomCode();
    assert.equal(c.length, 5);
    assert.ok(isRoomCode(c), c);
    for (const ch of c) assert.ok(CODE_CHARS.includes(ch));
  }
  for (const bad of ['ABCD', 'ABCDEF', 'ABCI1', 'OOOOO', 'abcde', '']) assert.equal(isRoomCode(bad), false, bad);
  assert.equal(normalizeCode(' ab-cd e '), 'ABCDE');
  assert.equal(isRoomCode(normalizeCode('xk7m9')), true);
});

test('nome limpo e escolha do transporte', () => {
  assert.equal(cleanName('  <b>Ana</b>   Clara  '), 'bAna/b Clara');
  assert.equal(cleanName('x'.repeat(40)).length, 16);
  assert.equal(transportKind({ search: '?net=local', hasClient: true, hostname: 'quantaaulas.com' }), 'local');
  assert.equal(transportKind({ search: '', hasClient: true, hostname: 'quantaaulas.com' }), 'supabase');
  assert.equal(transportKind({ search: '', hasClient: false, hostname: '127.0.0.1' }), 'local');
  assert.equal(transportKind({ search: '', hasClient: false, hostname: 'quantaaulas.com' }), null);
});

// ---------- SupabaseTransport com o mock ----------
test('SupabaseTransport: canal, presença e broadcast sem eco', async () => {
  const srv = mockServer();
  const a = new SupabaseTransport(srv.client(), 'ABCDE', 'pa');
  const b = new SupabaseTransport(srv.client(), 'ABCDE', 'pb');
  const gotA = [];
  const gotB = [];
  a.on('msg', (m) => gotA.push(m));
  b.on('msg', (m) => gotB.push(m));
  assert.equal(await a.connect({ id: 'pa', name: 'Ana' }), true);
  assert.equal(a.ch.topic, 'kart-live:ABCDE');
  assert.deepEqual(a.ch.opts.config, { broadcast: { self: false }, presence: { key: 'pa' } });
  assert.equal(await b.connect({ id: 'pb', name: 'Beto' }), true);
  await tick(5);
  assert.deepEqual([...a.members.keys()].sort(), ['pa', 'pb']);
  assert.equal(a.members.get('pb').name, 'Beto');
  assert.equal(a.members.get('pb').presence_ref, undefined, 'presence_ref não vaza para a meta');
  a.send({ ty: 'oi', fr: 'pa' });
  await tick(1);
  assert.deepEqual(gotB, [{ ty: 'oi', fr: 'pa' }]);
  assert.deepEqual(gotA, [], 'self: false = sem eco');
  assert.equal(srv.sent[0].event, 'k');
  // meta nova (ex.: trocou de cientista) chega aos outros
  await b.track({ id: 'pb', name: 'Beto', character: 'curie' });
  await tick(1);
  assert.equal(a.members.get('pb').character, 'curie');
  // sair: canal removido, o outro vê a saída
  b.close();
  await tick(1);
  assert.deepEqual(srv.removed, ['kart-live:ABCDE']);
  assert.deepEqual([...a.members.keys()], ['pa']);
  a.close();
});

test('SupabaseTransport: erro do canal resolve false', async () => {
  const client = {
    channel: () => ({
      on() { return this; },
      subscribe(cb) { setTimeout(() => cb('CHANNEL_ERROR'), 1); return this; },
      presenceState: () => ({}),
    }),
    removeChannel() {},
  };
  const t = new SupabaseTransport(client, 'ZZZZZ', 'px');
  const st = [];
  t.on('status', (s) => st.push(s));
  assert.equal(await t.connect({ id: 'px' }), false);
  assert.deepEqual(st, ['error']);
});

// ---------- NetRoom (sobre o mock do Supabase) ----------
test('NetRoom: anfitrião, conflito de cientista e troca de anfitrião', async () => {
  const srv = mockServer();
  const mk = (id, name, character, extra = {}) => new NetRoom(new SupabaseTransport(srv.client(), 'QWERT', id), { code: 'QWERT', id, name, character, ...extra });
  const A = mk('pa', 'Ana', 'newton', { cc: '150cc', laps: 3, creator: true });
  await A.join();
  await tick(3);
  const B = mk('pb', 'Beto', 'newton');
  const joins = [];
  A.on('join', (m) => joins.push(m.id));
  await B.join();
  await tick(5);
  assert.equal(A.members.length, 2);
  assert.equal(A.hostId, 'pa');
  assert.equal(B.hostId, 'pa');
  assert.ok(A.isHost && !B.isHost);
  assert.deepEqual(joins, ['pb']);
  // motor e voltas do anfitrião valem para todos
  assert.deepEqual(B.settings, { cc: '150cc', laps: 3 });
  // Beto entrou depois: o Newton é da Ana; Beto recebe o primeiro livre
  assert.equal(A.resolveCharacter(['newton', 'curie']), null);
  assert.equal(B.resolveCharacter(['newton', 'curie', 'einstein']), 'curie');
  B.update({ character: 'curie' });
  await tick(2);
  assert.equal(A.members.find((m) => m.id === 'pb').character, 'curie');
  // mensagens chegam por tipo e com o remetente
  const got = [];
  B.on('msg:start', (m) => got.push(m));
  A.send('start', { grid: ['pa', 'pb'] });
  await tick(1);
  assert.equal(got.length, 1);
  assert.equal(got[0].fr, 'pa');
  assert.deepEqual(got[0].grid, ['pa', 'pb']);
  // anfitrião sai: Beto assume, com os mesmos motor e voltas
  const left = [];
  B.on('leave', (id) => left.push(id));
  A.leave();
  await tick(3);
  assert.deepEqual(left, ['pa']);
  assert.ok(B.isHost);
  assert.deepEqual(B.settings, { cc: '150cc', laps: 3 });
  assert.equal(B.meta.v, NET_VERSION);
  B.leave();
});

test('NetRoom: quem criou é o anfitrião, mesmo com o relógio de outro atrasado', async () => {
  const srv = mockServer();
  const mk = (id, name, extra = {}) => new NetRoom(new SupabaseTransport(srv.client(), 'ASDFG', id), { code: 'ASDFG', id, name, character: id, ...extra });
  const A = mk('pz', 'Zé', { creator: true });
  await A.join();
  await tick(3);
  const B = mk('pa', 'Ana');
  B.meta.joined = A.meta.joined - 60000; // relógio do aparelho da Ana 1 min atrasado
  await B.join();
  const C = mk('pc', 'Caio');
  await C.join();
  await tick(5);
  assert.equal(B.hostId, 'pz');
  assert.equal(A.hostId, 'pz');
  assert.deepEqual(C.members.map((m) => m.id), ['pz', 'pa', 'pc']);
  // o criador sai: assume o próximo da fila e ele passa a valer como criador
  A.leave();
  await tick(3);
  assert.equal(B.hostId, 'pa');
  assert.equal(C.hostId, 'pa');
  assert.equal(B.meta.creator, true);
  // quem entra agora (mesmo com relógio mais atrasado ainda) não toma o lugar
  const D = mk('pd', 'Dani');
  D.meta.joined = B.meta.joined - 99999;
  await D.join();
  await tick(3);
  assert.equal(D.hostId, 'pa');
  for (const r of [B, C, D]) r.leave();
});

// ---------- LocalTransport (BroadcastChannel do Node) ----------
test('LocalTransport: presença por batimentos, mensagens e saída', async () => {
  const opts = { beat: 40, timeout: 200 };
  const a = new LocalTransport('LOCAL', 'la', opts);
  const b = new LocalTransport('LOCAL', 'lb', opts);
  const got = [];
  b.on('msg', (m) => got.push(m));
  await a.connect({ id: 'la', name: 'A' });
  await b.connect({ id: 'lb', name: 'B' });
  await tick(30);
  assert.deepEqual([...a.members.keys()].sort(), ['la', 'lb']);
  a.send({ ty: 'st', fr: 'la', x: 1 });
  await tick(20);
  assert.deepEqual(got, [{ ty: 'st', fr: 'la', x: 1 }]);
  // 'bye' tira na hora
  b.close();
  await tick(20);
  assert.deepEqual([...a.members.keys()], ['la']);
  // aba que some sem 'bye' sai pelo tempo sem batimento
  const c = new LocalTransport('LOCAL', 'lc', opts);
  await c.connect({ id: 'lc' });
  await tick(30);
  assert.ok(a.members.has('lc'));
  for (const t of c._timers) clearInterval(t);
  c._timers = [];
  c.bc.close();
  await tick(350);
  assert.ok(!a.members.has('lc'));
  a.close();
});

// ---------- interpolação dos karts remotos ----------
// Kart dando voltas num círculo (r = 60 m, 25 m/s); quem manda: 15 estados/s carimbados com o
// próprio relógio; rede com atraso de 40 a 160 ms e 5% de perda; quem recebe desenha a 60 qps
// com o relógio 3,2 s adiantado. A pose desenhada deve seguir a trajetória de verdade ~100 ms
// atrás, sem saltos nem ré.
test('Interp: kart remoto suave com atraso variável e perda de pacotes', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const R = 60;
  const V = 25;
  const at = (t) => {
    const a = (V / R) * t;
    return { x: R * Math.sin(a), y: 0, z: R * Math.cos(a), h: a + Math.PI / 2, v: V, st: 0.3, g: true, s: V * t };
  };
  const ip = new Interp({ delay: 0.1 });
  const inbox = [];
  const OFFSET = 3.2;
  for (let t = 0; t <= 20; t += 1 / 15) {
    if (rnd() < 0.05) continue; // perdido
    inbox.push({ t, arrive: t + OFFSET + 0.04 + rnd() * 0.12, pose: at(t) });
  }
  inbox.sort((a, b) => a.arrive - b.arrive); // atraso variável: pode chegar fora de ordem
  const out = {};
  let prev = null;
  let errs = [];
  let jumps = 0;
  let backwards = 0;
  let k = 0;
  for (let now = OFFSET; now <= OFFSET + 20; now += 1 / 60) {
    while (k < inbox.length && inbox[k].arrive <= now) {
      ip.push(inbox[k].t, inbox[k].arrive, inbox[k].pose);
      k++;
    }
    if (!ip.sample(now, out)) continue;
    const truth = at(now - OFFSET - 0.14); // ~ atraso mínimo (40 ms) + 100 ms
    if (now > OFFSET + 1) errs.push(Math.hypot(out.x - truth.x, out.z - truth.z));
    if (prev) {
      const d = Math.hypot(out.x - prev.x, out.z - prev.z);
      if (d > (V / 60) * 2.5) jumps++;
      // anda para a frente: o deslocamento aponta para onde o kart está virado
      const fx = Math.sin(out.h);
      const fz = Math.cos(out.h);
      if ((out.x - prev.x) * fx + (out.z - prev.z) * fz < -0.01) backwards++;
    }
    prev = { ...out };
  }
  errs.sort((a, b) => a - b);
  const p95 = errs[Math.floor(errs.length * 0.95)];
  assert.ok(p95 < 1.5, `erro p95 ${p95.toFixed(2)} m`);
  assert.equal(backwards, 0, 'nunca anda de ré');
  assert.ok(jumps <= 3, `saltos: ${jumps}`);
  // atraso adotado ~ o menor atraso da rede (relógios diferentes não importam)
  assert.ok(Math.abs(ip.off - (OFFSET + 0.04)) < 0.02, `diferença de relógio ${ip.off}`);
});

test('Interp: rumo cruza ±180° pelo lado curto e estado velho é ignorado', () => {
  const ip = new Interp({ delay: 0 });
  const base = { x: 0, y: 0, z: 0, v: 0, st: 0, g: true, s: 0 };
  ip.push(0, 0, { ...base, h: Math.PI - 0.1 });
  ip.push(1, 1, { ...base, h: -Math.PI + 0.1 });
  assert.equal(ip.push(0.5, 1, { ...base, h: 0 }), false);
  const out = {};
  ip.sample(0.5, out);
  assert.ok(Math.abs(Math.abs(out.h) - Math.PI) < 0.02, `rumo ${out.h}`); // (e não passa por 0)
  // travou 3 s sem estado: recomeça do último (não fica "no passado" para sempre)
  ip.sample(10, out);
  assert.ok(ip.off > 5);
});
