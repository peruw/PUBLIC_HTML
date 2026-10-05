// Telas da corrida online: "Jogar online" (nome, criar sala ou entrar com código) e a sala de
// espera (quem está, cientista de cada um, motor e voltas do anfitrião, botão Começar).
// A sala em si (presença, anfitrião, mensagens) é a NetRoom de netplay.js; a corrida é o
// netrace.js, iniciado pelo main.js quando chega a mensagem 'start'.
import { CHARACTERS, CLASSES, RACE } from './config.js';
import {
  NetRoom, SupabaseTransport, LocalTransport, NET_VERSION, MAX_HUMANS, makeRoomCode, makePeerId,
  normalizeCode, isRoomCode, cleanName, transportKind,
} from './netplay.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const charOf = (id) => CHARACTERS.find((c) => c.id === id) || null;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class NetUI {
  // h: { menu, store, online, sfx(name), onStart(msg), aiPool() -> ids com modelo 3D, aiLadder,
  //      onGesture() (toque do jogador: o main.js pede a tela cheia no celular) }
  constructor(h) {
    this.h = h;
    this.menu = h.menu;
    this.store = h.store;
    this.room = null;
    this.kind = null; // 'supabase' | 'local' | null
    this.phase = 'lobby';
    this.seenRaces = new Set();
    this.id = makePeerId();
    this.buildLobbyOptions();
    const code = $('net-code');
    code?.addEventListener('input', () => {
      const v = normalizeCode(code.value);
      if (v !== code.value) code.value = v;
    });
    // Enter no campo entra na sala (Esc continua voltando para a tela inicial)
    const enter = (fn) => (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      fn();
    };
    code?.addEventListener('keydown', enter(() => this.join()));
    $('net-name')?.addEventListener('keydown', enter(() => (isRoomCode(normalizeCode(code?.value)) ? this.join() : null)));
    $('lobby-chars')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-char]');
      if (b) this.pick(b.dataset.char);
    });
    // fechar a aba: sai da sala na hora (os outros não esperam o tempo de presença)
    addEventListener('pagehide', () => this.room?.leave());
  }

  // ---------- ações (menu.js repassa data-action="net*") ----------
  action(a, btn) {
    switch (a) {
      case 'open':
        this.open();
        break;
      case 'net-create':
        this.create();
        break;
      case 'net-join':
        this.join();
        break;
      case 'net-leave':
        this.h.sfx('menuMove');
        this.leave();
        this.menu.show('net');
        this.refreshEntry();
        break;
      case 'net-copy':
        this.copyLink(btn);
        break;
      case 'net-start':
        this.startRace();
        break;
      default:
        break;
    }
  }

  // Tela "Jogar online" (code: vindo de ?sala=CÓDIGO).
  open(code = '') {
    this.menu.show('net');
    if (code) $('net-code').value = normalizeCode(code);
    this.refreshEntry();
    if (code) requestAnimationFrame(() => ($('net-name').value ? $('net-join-btn') : $('net-name'))?.focus({ preventScroll: true }));
  }

  async refreshEntry() {
    const nameEl = $('net-name');
    if (nameEl && !nameEl.value) nameEl.value = this.store.get('net-name', this.store.get('nick', ''));
    const acc = $('net-account');
    const Online = this.h.online;
    this.setMsg('net-msg', '');
    await Online.init();
    this.kind = transportKind({ search: location.search, hasClient: !!Online.client, hostname: location.hostname });
    for (const b of document.querySelectorAll('#screen-net [data-action="net-create"], #screen-net [data-action="net-join"]')) b.disabled = !this.kind;
    if (!this.kind) {
      if (acc) acc.innerHTML = '<p>O jogo online funciona no site <b>quantaaulas.com</b>, com internet.</p>';
      return;
    }
    if (!acc) return;
    if (this.kind === 'local') {
      acc.innerHTML = '<p class="muted">Modo de teste local: as salas valem entre abas deste navegador.</p>';
      return;
    }
    if (Online.user) {
      const me = await Online.getMe();
      const nick = me?.nickname || Online.user.firstName || '';
      if (nameEl && nick && !this.store.get('net-name', '')) nameEl.value = nick;
      acc.innerHTML = `<p class="muted">Conectado como <b>${esc(nick || Online.user.name || 'você')}</b>.</p>`;
    } else if (Online.available) {
      acc.innerHTML = `<p class="muted">Não precisa de conta para jogar com os amigos. <a href="${Online.loginUrl}">Entrar com Google</a> (opcional) usa o seu apelido do ranking.</p>`;
    } else acc.innerHTML = '';
  }

  setMsg(id, text, cls = '') {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'turma-msg' + (cls ? ' ' + cls : '');
  }

  readName() {
    const name = cleanName($('net-name')?.value);
    if (name.length < 2) {
      this.setMsg('net-msg', 'Escreva seu nome (pelo menos 2 letras) para os amigos saberem quem é quem.');
      $('net-name')?.focus();
      return null;
    }
    this.store.set('net-name', name);
    return name;
  }

  create() {
    const name = this.readName();
    if (!name) return;
    this.h.sfx('menuSelect');
    this.h.onGesture?.(); // (celular: tela cheia precisa de um toque; a largada vem pela rede)
    return this.enter(makeRoomCode(), name, true);
  }

  join() {
    const code = normalizeCode($('net-code')?.value);
    if (!isRoomCode(code)) {
      this.setMsg('net-msg', 'O código tem 5 letras ou números (sem I, L, O, 0 e 1).');
      $('net-code')?.focus();
      return;
    }
    const name = this.readName();
    if (!name) return;
    this.h.sfx('menuSelect');
    this.h.onGesture?.();
    return this.enter(code, name, false);
  }

  async enter(code, name, creator) {
    this.leave();
    this.setMsg('net-msg', 'Conectando…');
    await this.h.online.init();
    const Online = this.h.online;
    this.kind = transportKind({ search: location.search, hasClient: !!Online.client, hostname: location.hostname });
    if (!this.kind) {
      this.setMsg('net-msg', 'O jogo online funciona no site quantaaulas.com, com internet.');
      return false;
    }
    const t = this.kind === 'supabase' ? new SupabaseTransport(Online.client, code, this.id) : new LocalTransport(code, this.id);
    const s = this.menu.opts;
    const pool = CHARACTERS.map((c) => c.id);
    const want = this.store.get('net-character', s.character);
    const room = new NetRoom(t, {
      code, id: this.id, name, character: pool.includes(want) ? want : 'newton', creator,
      cc: CLASSES[s.cc] ? s.cc : '100cc', laps: RACE.lapOptions.includes(s.laps) ? s.laps : RACE.defaultLaps,
    });
    this.room = room;
    this.creator = creator;
    this.phase = 'lobby';
    room.on('members', () => this.onMembers());
    room.on('join', (m) => this.note(`${m.name} entrou na sala.`));
    room.on('leave', (id) => this.onLeave(id));
    room.on('status', (st) => {
      if (st === 'error') this.note('Conexão instável… tentando de novo.', 'warn');
    });
    room.on('msg:start', (m) => this.onStart(m));
    const ok = await room.join();
    if (this.room !== room) return false; // saiu enquanto conectava
    if (!ok) {
      this.leave();
      this.setMsg('net-msg', 'Não foi possível conectar à sala. Verifique a internet e tente de novo.');
      return false;
    }
    this.setMsg('net-msg', '');
    this.menu.show('lobby');
    this.renderLobby();
    // entrou com código e ninguém apareceu: provavelmente código errado (ou os amigos ainda vão entrar)
    if (!creator) {
      setTimeout(() => {
        if (this.room === room && room.members.length < 2) this.note('Ninguém nesta sala ainda. Confira o código ou espere os amigos entrarem.', 'warn');
      }, 2500);
    }
    return true;
  }

  leave() {
    if (!this.room) return;
    this.room.leave();
    this.room = null;
  }

  setPhase(phase) {
    this.phase = phase;
    if (this.room && this.room.meta.phase !== phase) this.room.update({ phase });
    if (phase === 'lobby' && this.room) this.renderLobby();
  }

  note(text, cls = '') {
    this.setMsg('lobby-msg', text, cls);
    clearTimeout(this._noteT);
    this._noteT = setTimeout(() => this.setMsg('lobby-msg', ''), 5000);
  }

  onLeave(id) {
    if (this.menu.current !== 'lobby') return;
    this.note('Um jogador saiu da sala.');
  }

  onMembers() {
    const room = this.room;
    if (!room) return;
    // sala cheia: quem entrou depois do 8º volta para a entrada. Só vale para quem acabou de
    // chegar e está na sala de espera: um aparelho com o relógio atrasado entraria "antes" na
    // fila e tiraria da sala alguém que já estava lá (até no meio de uma corrida)
    if (room.order >= MAX_HUMANS && this.phase === 'lobby' && Date.now() - room.meta.joined < 15000) {
      this.leave();
      this.menu.show('net');
      this.setMsg('net-msg', `Sala cheia (${MAX_HUMANS} jogadores).`);
      return;
    }
    // cientista repetido: fica com quem entrou primeiro; eu pego um livre
    const pool = [...this.h.aiPool(), ...CHARACTERS.map((c) => c.id)];
    const free = room.resolveCharacter(pool);
    if (free) {
      const taken = room.ownerOf(room.meta.character);
      this.note(`${taken?.name || 'Outro jogador'} já estava com ${charOf(room.meta.character)?.name}; você ficou com ${charOf(free)?.name}.`);
      room.update({ character: free });
      this.store.set('net-character', free);
      return;
    }
    if (this.menu.current === 'lobby') this.renderLobby();
  }

  pick(id) {
    const room = this.room;
    if (!room || !charOf(id) || this.phase !== 'lobby') return;
    const own = room.ownerOf(id);
    if (own && own.id !== room.id) {
      this.h.sfx('menuMove');
      this.note(`${charOf(id).name} já é de ${own.name}. Escolha outro.`, 'warn');
      return;
    }
    if (room.meta.character === id) return;
    this.h.sfx('menuMove');
    room.update({ character: id });
    this.store.set('net-character', id);
    this.renderLobby();
  }

  // ---------- sala de espera ----------
  buildLobbyOptions() {
    const cc = $('lobby-cc');
    if (cc) {
      cc.innerHTML = Object.values(CLASSES).map((c) => `<button data-cc="${c.id}">${c.label}<small>${c.hint}</small></button>`).join('');
      cc.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) this.setOpt({ cc: b.dataset.cc });
      });
    }
    const laps = $('lobby-laps');
    if (laps) {
      laps.innerHTML = RACE.lapOptions.map((n) => `<button data-laps="${n}">${n}<small>${n === 1 ? 'volta' : 'voltas'}</small></button>`).join('');
      laps.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) this.setOpt({ laps: Number(b.dataset.laps) });
      });
    }
  }

  // motor e voltas: só o anfitrião escolhe (sem o cadeado do 150cc: é a turma que decide)
  setOpt(patch) {
    const room = this.room;
    if (!room) return;
    if (!room.isHost) {
      this.h.sfx('menuMove');
      this.note('Quem escolhe o motor e as voltas é o anfitrião (👑).', 'warn');
      return;
    }
    if (patch.cc && !CLASSES[patch.cc]) return;
    if (patch.laps && !RACE.lapOptions.includes(patch.laps)) return;
    this.h.sfx('menuMove');
    room.update(patch);
    this.renderLobby();
  }

  face(id, cls = 'face') {
    const c = charOf(id);
    const url = c && this.menu.portraits?.[c.id];
    return url ? `<img class="${cls}" src="${url}" alt="" style="--c:${c.colors.ui}">` : `<span class="${cls} ph" style="--c:${c?.colors.ui || '#555'}">${esc(c?.name?.[0] || '?')}</span>`;
  }

  renderLobby() {
    const room = this.room;
    if (!room) return;
    const code = room.code;
    $('lobby-code').textContent = code;
    $('lobby-code-big').textContent = code;
    const host = room.host;
    const members = room.members;
    const ready = members.filter((m) => m.phase === 'lobby' && m.v === NET_VERSION);
    // jogadores
    const rows = members.map((m) => {
      const c = charOf(m.character);
      const tags = [];
      if (host && m.id === host.id) tags.push('<b class="lb-host" title="Anfitrião">👑 anfitrião</b>');
      if (m.v !== NET_VERSION) tags.push('<i class="lb-state warn">versão diferente: recarregue a página</i>');
      else if (m.phase === 'race') tags.push('<i class="lb-state">🏁 correndo</i>');
      else if (m.phase === 'results') tags.push('<i class="lb-state">no resultado</i>');
      return `<li class="${m.id === room.id ? 'me' : ''}">${this.face(m.character)}<span class="n">${esc(m.name)}${m.id === room.id ? ' <small>(você)</small>' : ''}<small class="c">${esc(c?.name || '')}</small></span><span class="tg">${tags.join(' ')}</span></li>`;
    });
    const slots = RACE.kartCount - Math.min(RACE.kartCount, members.length);
    if (slots > 0) rows.push(`<li class="slot"><span class="face ph">🤖</span><span class="n">${slots === 1 ? '1 vaga' : `${slots} vagas`} <small class="c">cientistas da IA</small></span><span></span></li>`);
    $('lobby-players').innerHTML = rows.join('');
    $('lobby-count').textContent = `${members.length}/${MAX_HUMANS}`;
    // cientistas
    const mine = room.meta.character;
    $('lobby-chars').innerHTML = CHARACTERS.map((c) => {
      const own = room.ownerOf(c.id);
      const other = own && own.id !== room.id;
      return `<button class="lb-char${c.id === mine ? ' selected' : ''}${other ? ' taken' : ''}" data-char="${c.id}" style="--c:${c.colors.ui}" aria-label="${esc(c.fullName)}${other ? `, escolhido por ${esc(own.name)}` : ''}">${this.face(c.id, 'lb-face')}<span>${esc(c.short || c.name)}</span>${other ? `<em>${esc(own.name)}</em>` : ''}</button>`;
    }).join('');
    // motor e voltas
    const st = room.settings;
    const isHost = room.isHost;
    for (const b of $('lobby-cc').children) b.classList.toggle('on', b.dataset.cc === st.cc);
    for (const b of $('lobby-laps').children) b.classList.toggle('on', Number(b.dataset.laps) === st.laps);
    for (const g of ['lobby-cc', 'lobby-laps']) $(g).classList.toggle('room-locked', !isHost);
    const start = $('lobby-start');
    start.classList.toggle('hidden', !isHost);
    start.disabled = ready.length < 2 || this.phase !== 'lobby';
    const racing = host && host.id !== room.id && host.phase === 'race';
    let note = '';
    if (isHost) {
      if (ready.length >= 2) note = `${ready.length} jogadores prontos. As vagas que sobram ficam com a IA.`;
      else if (members.length >= 2) note = 'Esperando os outros voltarem do resultado para a sala…';
      else note = 'Passe o código para os amigos. Precisa de pelo menos 2 jogadores.';
    }
    else if (racing) note = 'Corrida em andamento. Você entra na próxima!';
    else note = `Esperando ${host ? esc(host.name) : 'o anfitrião'} começar…`;
    $('lobby-note').innerHTML = note;
  }

  // ---------- largada ----------
  // Anfitrião: monta a corrida (quem corre, cientistas sem repetir, IA nas vagas, grid) e avisa.
  startRace() {
    const room = this.room;
    if (!room || !room.isHost || this.phase !== 'lobby') return;
    const ready = room.members.filter((m) => m.phase === 'lobby' && m.v === NET_VERSION).slice(0, MAX_HUMANS);
    if (ready.length < 2) {
      this.h.sfx('menuMove');
      this.note('Precisa de pelo menos 2 jogadores na sala.', 'warn');
      return;
    }
    this.h.sfx('menuSelect');
    const pool = this.h.aiPool();
    const all = [...pool, ...CHARACTERS.map((c) => c.id).filter((id) => !pool.includes(id))];
    const taken = new Set();
    const humans = {};
    for (const m of ready) {
      let c = m.character;
      if (!charOf(c) || taken.has(c)) c = all.find((x) => !taken.has(x));
      taken.add(c);
      humans[m.id] = { name: m.name, character: c };
    }
    const st = room.settings;
    const cc = CLASSES[st.cc] || CLASSES['100cc'];
    const ladder = this.h.aiLadder || [0];
    // IA (só cientistas com modelo 3D): a escada vai do mais forte ao mais fraco. Quem escolheu
    // um cientista ainda sem modelo usa o kart reserva (Curie ou Newton, main.js): a IA evita
    // esse visual para não haver dois karts iguais
    const look = new Set(taken);
    for (const c of taken) if (!pool.includes(c)) look.add(charOf(c)?.gender === 'f' ? 'curie' : 'newton');
    let free = pool.filter((c) => !look.has(c));
    if (free.length < RACE.kartCount - ready.length) free = pool.filter((c) => !taken.has(c));
    const aiChars = shuffle(free).slice(0, RACE.kartCount - ready.length);
    const ia = aiChars.map((c, i) => ({ id: 'ia:' + i, character: c, skill: Math.round(clamp(cc.aiSkill + ladder[i % ladder.length], 0.2, 1) * 1000) / 1000, lane: i }));
    // largada: metade da IA (a mais forte) na frente, humanos sorteados no meio, o resto atrás
    const front = Math.ceil(ia.length / 2);
    const grid = [...ia.slice(0, front).map((a) => a.id), ...shuffle(ready.map((m) => m.id)), ...ia.slice(front).map((a) => a.id)];
    const msg = {
      race: `${room.id}-${Date.now().toString(36)}`, host: room.id, seed: (Math.random() * 2 ** 31) | 0,
      cc: cc.id, laps: st.laps, grid, humans, ia, t0: Date.now(),
    };
    room.send('start', msg);
    // mensagens se perdem de vez em quando: repete a largada (quem já recebeu ignora)
    // (late: s desde a largada original, para quem só recebe a repetição largar no mesmo instante)
    for (const ms of [400, 1200]) setTimeout(() => { if (this.room === room && this.phase === 'race') room.send('start', { ...msg, late: ms / 1000 }); }, ms);
    this.seenRaces.add(msg.race);
    this.h.onStart(msg);
  }

  onStart(m) {
    const room = this.room;
    if (!room || !m || typeof m.race !== 'string' || this.seenRaces.has(m.race)) return;
    // só vale a largada de quem é o anfitrião agora
    if (m.fr !== m.host || m.fr !== room.hostId) return;
    if (!Array.isArray(m.grid) || !m.humans || typeof m.humans !== 'object') return;
    this.seenRaces.add(m.race);
    if (this.phase !== 'lobby' || !m.humans[room.id]) return; // (no resultado: fica para a próxima)
    this.h.onStart(m);
  }

  async copyLink(btn) {
    const room = this.room;
    if (!room) return;
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('sala', room.code);
    if (this.kind === 'local') url.searchParams.set('net', 'local');
    const text = url.toString();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // sem permissão da área de transferência: seleciona num campo temporário
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {
        ok = false;
      }
    }
    this.h.sfx(ok ? 'menuSelect' : 'menuMove');
    if (btn) {
      clearTimeout(btn._t);
      btn.dataset.label = btn.dataset.label || btn.innerHTML;
      btn.innerHTML = ok ? '✅ Link copiado!' : '⚠️ Copie o código';
      btn._t = setTimeout(() => { btn.innerHTML = btn.dataset.label; }, 1800);
    }
    if (!ok) this.note(`Link da sala: ${text}`);
  }
}
