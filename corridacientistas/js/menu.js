// Telas de menu (DOM): inicial, escolha do cientista, como jogar, pausa e resultado.
import { CHARACTERS, CLASSES, ITEMS, RACE } from './config.js';
import { itemIconHTML, PLAYER_COLORS } from './hud.js';
import { formatTime } from './race.js';
import { SCIENTIST_FACTS, pickFact, shuffledQuiz } from './facts.js';
import { Online, ERR_TEXT, boardOf, parseBoard, ROOM_NAME_RE, cleanRoomName, runErrText } from './online.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['loading', 'title', 'select', 'howto', 'online', 'turma', 'net', 'lobby', 'pause', 'results', 'error'];
// Bandeiras em SVG (emoji de bandeira vira letras no Windows).
const svgFlag = (body, vb = '0 0 30 20') => `<svg viewBox="${vb}" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`;
const hStripes = (...cs) => cs.map((c, i) => `<rect y="${(i * 20) / cs.length}" width="30" height="${20 / cs.length}" fill="${c}"/>`).join('');
const vStripes = (...cs) => cs.map((c, i) => `<rect x="${i * 10}" width="10" height="20" fill="${c}"/>`).join('');
const FLAGS = {
  // Newton nasceu no Reino da Inglaterra (cruz de São Jorge); Darwin e Rosalind Franklin, já no Reino Unido
  Inglaterra: svgFlag('<rect width="30" height="20" fill="#fff"/><rect x="12.5" width="5" height="20" fill="#ce1124"/><rect y="7.5" width="30" height="5" fill="#ce1124"/>'),
  'Reino Unido': svgFlag(
    '<rect width="60" height="30" fill="#012169"/><path d="M0 0L60 30M60 0L0 30" stroke="#fff" stroke-width="6"/>' +
      '<path d="M0 0L60 30M60 0L0 30" stroke="#c8102e" stroke-width="2"/><path d="M30 0V30M0 15H60" stroke="#fff" stroke-width="10"/>' +
      '<path d="M30 0V30M0 15H60" stroke="#c8102e" stroke-width="6"/>',
    '0 0 60 30',
  ),
  // metade Polônia (onde nasceu), metade França (onde viveu e pesquisou)
  'Polônia / França': svgFlag(
    '<rect width="15" height="10" fill="#fff"/><rect y="10" width="15" height="10" fill="#dc143c"/>' +
      '<rect x="15" width="5" height="20" fill="#0055a4"/><rect x="20" width="5" height="20" fill="#fff"/><rect x="25" width="5" height="20" fill="#ef4135"/>' +
      '<rect x="14.6" width="0.8" height="20" fill="rgba(0,0,0,0.35)"/>',
  ),
  Rússia: svgFlag(hStripes('#fff', '#0039a6', '#d52b1e')),
  Alemanha: svgFlag(hStripes('#000', '#dd0000', '#ffce00')),
  // metade Alemanha (onde nasceu), metade EUA (onde viveu desde 1933 e se naturalizou)
  'Alemanha / EUA': svgFlag(
    '<rect width="15" height="6.67" fill="#000"/><rect y="6.67" width="15" height="6.67" fill="#dd0000"/><rect y="13.33" width="15" height="6.67" fill="#ffce00"/>' +
      [0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="15" y="${(i * 20) / 7}" width="15" height="${20 / 7}" fill="${i % 2 ? '#fff' : '#b22234'}"/>`).join('') +
      '<rect x="15" width="7" height="11" fill="#3c3b6e"/><rect x="14.6" width="0.8" height="20" fill="rgba(0,0,0,0.35)"/>',
  ),
  Itália: svgFlag(vStripes('#009246', '#fff', '#ce2b37')),
  EUA: svgFlag(
    hStripes('#b22234', '#fff', '#b22234', '#fff', '#b22234', '#fff', '#b22234') + '<rect width="13" height="11" fill="#3c3b6e"/>',
  ),
  Brasil: svgFlag(
    '<rect width="30" height="20" fill="#009c3b"/><path d="M15 2L27.5 10L15 18L2.5 10Z" fill="#ffdf00"/>' +
      '<circle cx="15" cy="10" r="4.6" fill="#002776"/><path d="M10.6 9.2Q15 7.6 19.5 10.8" stroke="#fff" stroke-width="1" fill="none"/>',
  ),
};
// Rótulo do cartão: palavra longa ganha um hífen opcional no meio ("Mende-leev", "Oswal-do")
// em vez de ser cortada com "…" na tela estreita (só aparece se a palavra não couber)
const cardLabel = (t) => t.split(' ').map((w) => (w.length >= 9 ? w.slice(0, Math.ceil(w.length / 2)) + '&shy;' + w.slice(Math.ceil(w.length / 2)) : w)).join(' ');
// Linha de conquistas do resultado: cada item vira uma "pílula" (fica fácil achar "150cc liberado!")
const chipsHTML = (parts) => parts.map((t) => `<span class="res-chip">${t}</span>`).join('');
const STAT_LABELS = [['speed', 'Velocidade'], ['accel', 'Aceleração'], ['handling', 'Controle'], ['weight', 'Peso']];

const store = {
  get(k, def) {
    try {
      const v = localStorage.getItem('kartcientifico-' + k);
      if (v === null) return def;
      const r = JSON.parse(v);
      // dado de versão antiga ou editado à mão (null, texto no lugar de objeto...) volta ao padrão
      if (def !== null && def !== undefined) {
        if (r === null || typeof r !== typeof def) return def;
        if (typeof def === 'object' && Array.isArray(r) !== Array.isArray(def)) return def;
        if (typeof def === 'number' && !Number.isFinite(r)) return def;
      }
      return r;
    } catch {
      return def;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('kartcientifico-' + k, JSON.stringify(v));
    } catch {
      /* armazenamento indisponível */
    }
  },
};
export { store };

const MEDAL_RANK = { bronze: 1, prata: 2, ouro: 3 };
const MEDAL_ICON = { ouro: '🥇', prata: '🥈', bronze: '🥉' };
const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const GAME_URL = 'https://quantaaulas.com/kart-cientifico/';

// 150cc liberado depois de vencer uma corrida no 100cc (quem já jogava em 150cc continua com ele).
export function is150Unlocked() {
  return !!store.get('unlock150', false) || store.get('cc', '') === '150cc';
}

export class Menu {
  // handlers: { onStart(opts), onResume, onRestart, onQuit, onToggleSound, onToggleQuality, onToggleAuto, sfx(name) }
  constructor(handlers) {
    this.h = handlers;
    this.current = 'loading';
    this.prev = 'title';
    this.portraits = {};
    this.opts = {
      character: store.get('character', 'newton'),
      cc: store.get('cc', '50cc'), // primeira vez: classe mais tranquila
      laps: store.get('laps', RACE.defaultLaps),
      mode: store.get('mode', 'race'), // 'race' | 'timetrial'
      players: store.get('players', 1) === 2 ? 2 : 1, // 2 = tela dividida no mesmo PC
      character2: store.get('character2', 'curie'), // cientista do J2
    };
    if (this.opts.mode !== 'timetrial') this.opts.mode = 'race';
    if (!CHARACTERS.some((c) => c.id === this.opts.character)) this.opts.character = 'newton';
    if (!CHARACTERS.some((c) => c.id === this.opts.character2) || this.opts.character2 === this.opts.character) {
      this.opts.character2 = CHARACTERS.find((c) => c.id !== this.opts.character).id;
    }
    this.editing = 0; // dois jogadores: de quem é a ficha mostrada (0 = J1, 1 = J2)
    const okCC = Object.hasOwn(CLASSES, this.opts.cc);
    if (!okCC || (this.opts.cc === '150cc' && !is150Unlocked())) this.opts.cc = okCC ? '100cc' : '50cc';
    if (!RACE.lapOptions.includes(this.opts.laps)) this.opts.laps = RACE.defaultLaps;

    // quem já jogava em 150cc (antes do cadeado) fica com ele liberado de vez
    if (store.get('cc', '') === '150cc') store.set('unlock150', true);
    this.room = store.get('room', null); // sala de turma em que o aluno entrou
    this.tabNav = false; // foco veio do Tab (não do mouse/toque)
    // contadores de pedidos: resposta de um pedido antigo (ou de outra tela) é ignorada
    this._onSeq = this._turmaSeq = this._joinSeq = this._repSeq = 0;
    // online ligado depois de uma demora, ou conta trocada: redesenha a tela aberta
    Online.onChange(() => {
      if (this.current === 'online') this.refreshOnline();
      else if (this.current === 'turma') this.refreshTurma(false);
    });
    this.buildSelect();
    this.buildHowto();

    document.addEventListener('pointerdown', () => { this.tabNav = false; }, { capture: true, passive: true });
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.tagName === 'A') e.preventDefault(); // links com confirmação (voltar à página inicial)
      this.action(btn.dataset.action, btn);
    });
    document.addEventListener('keydown', (e) => this.onKey(e));
    // resultado recém-aberto: Enter/Espaço segurados (repetição automática) ou martelados logo
    // na chegada não acionam o botão focado ("Correr de novo"). No duelo o Enter é o item do J2,
    // e a corrida recomeçava sem ninguém ver o resultado
    window.addEventListener('keydown', (e) => {
      if (this.current !== 'results' || (e.key !== 'Enter' && e.key !== ' ')) return;
      if (e.target.closest?.('input:not([type=range]), textarea')) return;
      if (!e.repeat && !this._resultsFresh()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, { capture: true });
    // volumes de música e efeitos (tela inicial e pausa)
    document.addEventListener('input', (e) => {
      const r = e.target.closest?.('input[data-vol]');
      if (!r) return;
      const v = Number(r.value) / 100;
      for (const o of document.querySelectorAll(`input[data-vol="${r.dataset.vol}"]`)) if (o !== r) o.value = r.value;
      this.h.onVolume?.(r.dataset.vol, v);
    });
  }

  setVolumes(music, sfx) {
    for (const r of document.querySelectorAll('input[data-vol="music"]')) r.value = Math.round(music * 100);
    for (const r of document.querySelectorAll('input[data-vol="sfx"]')) r.value = Math.round(sfx * 100);
  }

  // Botão de duas etapas: o 1º toque troca o rótulo por 'label' e só o 2º (em 3 s) confirma.
  _confirm(btn, label) {
    if (!btn) return true;
    if (btn.dataset.armed === '1') {
      this._disarm(btn);
      return true;
    }
    btn.dataset.armed = '1';
    btn.dataset.label = btn.innerHTML;
    btn.innerHTML = label;
    btn.classList.add('armed');
    clearTimeout(btn._armT);
    btn._armT = setTimeout(() => this._disarm(btn), 3000);
    return false;
  }

  _disarm(btn) {
    if (btn.dataset.armed !== '1') return;
    clearTimeout(btn._armT);
    btn.dataset.armed = '';
    btn.innerHTML = btn.dataset.label;
    btn.classList.remove('armed');
  }

  action(a, btn = null) {
    const h = this.h;
    switch (a) {
      case 'play':
        h.sfx('menuSelect');
        h.onPlay?.();
        this.show('select');
        break;
      case 'howto':
        h.sfx('menuSelect');
        this.show('howto');
        break;
      case 'back':
        h.sfx('menuMove');
        this.show('title');
        break;
      case 'start': {
        h.sfx('menuSelect');
        store.set('character', this.opts.character);
        // numa sala, motor/voltas/modo são os da sala: não viram preferência do jogador
        // (e uma sala de 150cc não libera o 150cc de vez)
        if (!this.room) {
          store.set('cc', this.opts.cc);
          store.set('laps', this.opts.laps);
          store.set('mode', this.opts.mode);
        }
        const duo = this.duo();
        if (this.opts.players === 2 && duo) {
          store.set('players', 2);
          store.set('character2', this.opts.character2);
        } else if (this.duoAllowed()) store.set('players', 1);
        h.onStart({ ...this.opts, players: duo ? 2 : 1, room: this.room || null });
        break;
      }
      case 'daily':
        h.sfx('menuSelect');
        h.onDaily?.();
        break;
      case 'online':
        h.sfx('menuSelect');
        this.show('online');
        break;
      case 'turma':
        h.sfx('menuSelect');
        this.show('turma');
        break;
      // corrida online ao vivo (telas em netui.js)
      case 'net':
        h.sfx('menuSelect');
        h.onNet?.('open');
        break;
      case 'net-create':
      case 'net-join':
      case 'net-leave':
      case 'net-copy':
      case 'net-start':
        h.onNet?.(a, btn);
        break;
      case 'net-lobby':
        h.sfx('menuSelect');
        h.onNetLobby?.();
        break;
      case 'room-join':
        this.joinRoom();
        break;
      case 'room-leave':
        h.sfx('menuMove');
        this.setRoom(null);
        break;
      case 'room-create':
        this.createRoom();
        break;
      case 'room-report':
        this.showReport(btn?.dataset.code);
        break;
      case 'room-toggle':
        this.toggleRoom(btn?.dataset.code, btn?.dataset.open === '1', btn);
        break;
      case 'room-copy':
        this.copyReport(btn);
        break;
      case 'room-remove':
        this.removeFromRoom(btn);
        break;
      case 'online-retry':
        if (this.current === 'online') this.refreshOnline();
        else if (this.current === 'turma') this.refreshTurma(false);
        break;
      case 'nick-save':
        this.saveNick(btn);
        break;
      case 'share':
        this.share(btn);
        break;
      case 'quiz':
        this.startQuiz();
        break;
      case 'slow-yes':
        store.set('slowHint', false);
        h.onSetQuality?.('baixa');
        break;
      case 'slow-no':
        store.set('slowHint', false);
        $('slow-hint')?.classList.add('hidden');
        break;
      case 'resume':
        h.onResume();
        break;
      case 'restart':
        h.sfx('menuSelect');
        // na pausa, reiniciar também joga a corrida fora
        if (this.current === 'pause' && !this._confirm(btn, 'Reiniciar mesmo?')) break;
        h.onRestart();
        break;
      case 'quit':
        h.sfx('menuMove');
        // na pausa, sair joga a corrida fora: pede um segundo toque
        if (this.current === 'pause' && !this._confirm(btn, 'Sair mesmo?')) break;
        h.onQuit();
        break;
      case 'home':
        h.sfx('menuMove');
        if (this._confirm(btn, 'Sair do jogo?')) location.href = btn.getAttribute('href') || '/';
        break;
      case 'toggle-sound':
        h.onToggleSound();
        break;
      case 'toggle-quality':
        h.onToggleQuality();
        break;
      case 'toggle-auto':
        h.onToggleAuto();
        break;
    }
  }

  // a tela de resultado abriu há menos de 0,7 s
  _resultsFresh() {
    return this.current === 'results' && performance.now() - (this._resultsAt || 0) < 700;
  }

  show(name) {
    if (name === 'results' && this.current !== 'results') this._resultsAt = performance.now();
    if (name !== this.current) this.prev = this.current;
    this.current = name;
    for (const s of SCREENS) $('screen-' + s)?.classList.toggle('hidden', s !== name);
    if (name === 'select') this.refreshSelect();
    if (name === 'title') this.refreshTitle();
    if (name === 'online') this.refreshOnline();
    if (name === 'turma') this.refreshTurma();
    this.h.onScreen?.(name);
    // teclado: foco no botão principal da tela (pausa e resultado)
    // (o primeiro botão principal visível: na corrida online o "Correr de novo" dá lugar a "Voltar à sala")
    if (name === 'results') requestAnimationFrame(() => [...($('screen-results')?.querySelectorAll('.btn-primary') || [])].find((b) => b.offsetParent)?.focus({ preventScroll: true }));
    // ranking online e turma abertos pelo Tab: foco no Voltar, para seguir navegando pela tela
    // (sem Tab não: no celular o foco num campo abriria o teclado virtual)
    if ((name === 'online' || name === 'turma') && this.tabNav) {
      requestAnimationFrame(() => $('screen-' + name)?.querySelector('[data-action=back]')?.focus({ preventScroll: true }));
    }
  }

  // Tela inicial: acertos no quiz, desafio do dia e sugestão de qualidade.
  refreshTitle() {
    const q = store.get('quiz', { right: 0, total: 0 });
    const qs = $('title-quiz');
    if (qs) {
      qs.classList.toggle('hidden', !q.total);
      qs.textContent = `🧠 Quiz: ${q.right} de ${q.total} acertos`;
    }
    const d = this.h.dailyInfo?.();
    const db = $('btn-daily');
    if (db && d) {
      db.innerHTML = `⭐ Desafio do dia <small>${esc(d.label)}${d.done ? ' · ✅ feito' : ''}${d.streak > 1 ? ` · ${d.streak} dias seguidos` : ''}</small>`;
    }
    $('slow-hint')?.classList.toggle('hidden', !store.get('slowHint', false) || this.h.qualityId?.() === 'baixa');
  }

  hideAll() {
    this.current = null;
    this.h.onScreen?.(null);
    // tira o foco do botão clicado (senão Enter/Espaço o aciona de novo no meio da corrida)
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    for (const s of SCREENS) $('screen-' + s)?.classList.add('hidden');
  }

  setLoading(frac, text) {
    $('loading-fill').style.width = `${Math.round(frac * 100)}%`;
    if (text) $('loading-text').textContent = text;
  }

  setSoundLabel(muted) {
    const t = muted ? '🔇 Som: desligado' : '🔊 Som: ligado';
    $('btn-sound').textContent = t;
    $('btn-sound-2').textContent = t;
  }

  setQualityLabel(q) {
    $('btn-quality').textContent = `⚙️ Qualidade: ${q}`;
  }

  setAutoLabel(on) {
    $('btn-auto').textContent = `Aceleração automática: ${on ? 'ligada' : 'desligada'}`;
  }

  setPortraits(map) {
    this.portraits = map || {};
    for (const c of CHARACTERS) {
      const card = this.grid.querySelector(`[data-id="${c.id}"]`);
      const url = this.portraits[c.id];
      if (card && url) card.querySelector('.ph, img').outerHTML = `<img src="${url}" alt="${c.name}" draggable="false" />`;
    }
    this.refreshSelect();
  }

  // ---------- escolha do cientista ----------
  buildSelect() {
    this.grid = $('char-grid');
    this.grid.innerHTML = CHARACTERS.map(
      (c) => `<button class="char-card" data-id="${c.id}" style="--c:${c.colors.ui}" aria-label="${c.fullName}">
        <span class="flag">${FLAGS[c.country] || ''}</span>
        <span class="medals" aria-hidden="true"></span>
        <div class="ph" style="--c:${c.colors.ui}">${c.name[0]}</div>
        <span${(c.short || c.name).split(' ').some((w) => w.length > 8) ? ' class="long"' : ''}>${cardLabel(c.short || c.name)}</span>
      </button>`,
    ).join('');
    this.grid.addEventListener('click', (e) => {
      const card = e.target.closest('.char-card');
      if (!card) return;
      // dois jogadores: o clique vale para a aba aberta (Jogador 1 ou 2)
      this.choose(this.duo() ? this.editing : 0, card.dataset.id);
    });
    this.grid.addEventListener('dblclick', (e) => {
      if (e.target.closest('.char-card')) this.action('start');
    });
    // Tab num cartão já escolhe o cientista (a ficha acompanha o foco)
    this.grid.addEventListener('focusin', (e) => {
      const card = e.target.closest('.char-card');
      const who = this.duo() ? this.editing : 0;
      if (!card || !this.tabNav || card.dataset.id === this.pick(who)) return;
      this.choose(who, card.dataset.id);
    });

    // Jogadores: 1 ou 2 (tela dividida no mesmo PC)
    const pl = $('opt-players');
    if (pl) {
      pl.innerHTML = '<button data-players="1">1<small>sozinho</small></button><button data-players="2">2<small>tela dividida</small></button>';
      pl.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const n = Number(b.dataset.players);
        if (n === 2 && !this.duoAllowed()) {
          this.h.sfx('menuMove');
          this.flashHint(this.room ? 'Na sala de turma cada aluno corre sozinho.' : 'Dois jogadores só no modo Corrida.');
          return;
        }
        this.setPlayers(n);
      });
    }
    // abas "Jogador 1 / Jogador 2": de quem é a ficha (e para quem vale o clique nos cartões)
    const tabs = $('select-tabs');
    if (tabs) {
      tabs.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-tab]');
        if (!b) return;
        this.editing = Number(b.dataset.tab);
        this.h.sfx('menuMove');
        this.refreshSelect();
      });
    }

    const cc = $('opt-cc');
    cc.innerHTML = Object.values(CLASSES)
      .map((c) => `<button data-cc="${c.id}">${c.label}<small>${c.hint}</small></button>`)
      .join('');
    cc.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || this.room) return;
      if (b.dataset.cc === '150cc' && !is150Unlocked()) {
        this.h.sfx('menuMove');
        this.flashHint('Vença uma corrida no 100cc para liberar o 150cc.');
        return;
      }
      this.opts.cc = b.dataset.cc;
      this.h.sfx('menuMove');
      this.refreshSelect();
    });

    const laps = $('opt-laps');
    laps.innerHTML = RACE.lapOptions.map((n) => `<button data-laps="${n}">${n}<small></small></button>`).join('');
    laps.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || this.room) return;
      this.opts.laps = Number(b.dataset.laps);
      this.h.sfx('menuMove');
      this.refreshSelect();
    });

    const mode = $('opt-mode');
    if (mode) {
      mode.innerHTML = '<button data-mode="race">Corrida<small>8 karts</small></button><button data-mode="timetrial">Contra o relógio<small>com fantasma</small></button>';
      mode.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || this.room) return;
        this.opts.mode = b.dataset.mode;
        this.h.sfx('menuMove');
        this.refreshSelect();
      });
    }
  }

  setPlayers(n) {
    n = n === 2 ? 2 : 1;
    if (n === this.opts.players) return;
    this.opts.players = n;
    this.editing = 0;
    // (o J2 não começa com o cientista do J1: refreshSelect cuida disso)
    this.h.sfx('menuMove');
    this.refreshSelect();
  }

  // ---------- dois jogadores (mesmo PC) ----------
  // Só no PC (sem toque), no modo corrida e fora de sala de turma (lá cada aluno corre sozinho).
  duoAllowed() {
    return !document.body.classList.contains('touch') && this.opts.mode === 'race' && !this.room;
  }

  duo() {
    return this.opts.players === 2 && this.duoAllowed();
  }

  // id do cientista de um jogador (0 = J1, 1 = J2)
  pick(who) {
    return who ? this.opts.character2 : this.opts.character;
  }

  setPick(who, id) {
    if (who) this.opts.character2 = id;
    else this.opts.character = id;
  }

  // Escolhe o cientista para o jogador 'who'; recusa o que já é do outro.
  choose(who, id) {
    if (this.duo() && this.pick(1 - who) === id) {
      const c = CHARACTERS.find((x) => x.id === id);
      this.h.sfx('menuMove');
      this.flashHint(`${c ? c.name : 'Esse cientista'} já é do Jogador ${2 - who}. Escolha outro.`);
      return false;
    }
    if (this.pick(who) !== id) this.h.sfx('menuMove');
    this.setPick(who, id);
    this.editing = this.duo() ? who : 0;
    this.refreshSelect();
    return true;
  }

  flashHint(text) {
    const el = $('select-note');
    if (!el) return;
    el.textContent = text;
    el.classList.add('warn');
    clearTimeout(this._noteT);
    this._noteT = setTimeout(() => {
      el.classList.remove('warn');
      this.refreshSelect();
    }, 2500);
  }

  cycleOpt(kind, dir = 1) {
    if (this.room) return; // numa sala de turma, motor e voltas são os da sala
    if (kind === 'cc') {
      const ids = Object.keys(CLASSES).filter((id) => id !== '150cc' || is150Unlocked());
      this.opts.cc = ids[(ids.indexOf(this.opts.cc) + dir + ids.length) % ids.length];
    } else {
      const L = RACE.lapOptions;
      this.opts.laps = L[(L.indexOf(this.opts.laps) + dir + L.length) % L.length];
    }
    this.h.sfx('menuMove');
    this.refreshSelect();
  }

  refreshSelect() {
    // sala de turma: motor, voltas e modo são os da sala. Vale ANTES de desenhar os botões
    // (depois, a 1ª tela ao entrar na sala destacava o motor antigo, e não o da corrida)
    const board = this.room ? parseBoard(this.room.board) : null;
    if (board) Object.assign(this.opts, board);
    const duo = this.duo();
    if (!duo) this.editing = 0;
    // os dois não podem ter o mesmo cientista. Com 1 jogador, no contrarrelógio, na sala ou pelo
    // link do professor o J1 pode ter ficado com o do J2: ao valer o duelo de novo, o J2 troca
    // (antes as duas abas mostravam o mesmo e a corrida dava outro cientista ao J2 sem avisar)
    if (duo && this.opts.character2 === this.opts.character) {
      this.opts.character2 = CHARACTERS.find((x) => x.id !== this.opts.character).id;
    }
    const c = CHARACTERS.find((x) => x.id === this.pick(this.editing));
    for (const card of this.grid.children) {
      card.classList.toggle('selected', card.dataset.id === c.id);
      // dois jogadores: marcador colorido J1/J2 em cada cartão escolhido
      card.querySelector('.pick')?.remove();
      const who = !duo ? -1 : card.dataset.id === this.opts.character ? 0 : card.dataset.id === this.opts.character2 ? 1 : -1;
      card.classList.toggle('pick1', who === 0);
      card.classList.toggle('pick2', who === 1);
      if (who >= 0) card.insertAdjacentHTML('afterbegin', `<span class="pick p${who + 1}">J${who + 1}</span>`);
    }
    const pl = $('opt-players');
    if (pl) {
      for (const b of pl.children) b.classList.toggle('on', Number(b.dataset.players) === (duo ? 2 : 1));
      pl.classList.toggle('locked', !this.duoAllowed());
    }
    const tabs = $('select-tabs');
    if (tabs) {
      tabs.classList.toggle('hidden', !duo);
      if (duo) {
        const name = (id) => CHARACTERS.find((x) => x.id === id)?.name || '';
        tabs.innerHTML = [0, 1]
          .map((i) => `<button role="tab" data-tab="${i}" aria-selected="${i === this.editing}" class="${i === this.editing ? 'on' : ''}" style="--pc:${PLAYER_COLORS[i]}"><i></i>Jogador ${i + 1} <small>${esc(name(this.pick(i)))}</small> <kbd>${i ? '← ↑ → ↓' : 'W A S D'}</kbd></button>`)
          .join('');
      }
    }
    const st = $('select-title');
    if (st) st.textContent = duo ? 'Escolham seus cientistas' : 'Escolha seu cientista';
    for (const b of $('opt-cc').children) b.classList.toggle('on', b.dataset.cc === this.opts.cc);
    for (const b of $('opt-laps').children) b.classList.toggle('on', Number(b.dataset.laps) === this.opts.laps);
    for (const b of $('opt-mode')?.children || []) b.classList.toggle('on', b.dataset.mode === this.opts.mode);
    // sala de turma: mostra o aviso e trava motor/voltas/modo nos da sala
    // (o rodapé esconde as opções travadas: a faixa já diz quais são)
    $('screen-select')?.classList.toggle('in-room', !!this.room);
    const rb = $('room-banner');
    if (rb) {
      rb.classList.toggle('hidden', !this.room);
      if (this.room) {
        const b = parseBoard(this.room.board);
        const what = `${b.cc}, ${b.laps === 1 ? '1 volta' : b.laps + ' voltas'}${b.mode === 'timetrial' ? ', contra o relógio' : ''}`;
        // "como Ana": quem senta depois no mesmo computador percebe que está com o nome de outro
        const who = this.room.guestName ? ` · como <b>${esc(this.room.guestName)}</b>` : '';
        const plain = `Sala ${this.room.code} · ${this.room.name} · ${what}${this.room.guestName ? ' · como ' + this.room.guestName : ''}`;
        rb.innerHTML = `<span class="rb-text" title="${esc(plain)}">🏫 Sala <b>${esc(this.room.code)}</b> · ${esc(this.room.name)} · ${what}${who}</span><button class="btn btn-small" data-action="room-leave">Sair da sala</button>`;
      }
    }
    for (const g of ['opt-cc', 'opt-laps', 'opt-mode']) $(g)?.classList.toggle('room-locked', !!this.room);
    const unlocked = is150Unlocked();
    for (const b of $('opt-cc').children) {
      // numa sala de 150cc o motor vale mesmo sem estar liberado: sem cadeado no rótulo
      const locked = b.dataset.cc === '150cc' && !unlocked && !this.room;
      b.classList.toggle('locked', locked);
      b.querySelector('small').textContent = locked ? '🔒 vença no 100cc' : CLASSES[b.dataset.cc].hint;
    }
    // duração aproximada de cada opção de voltas
    const lapS = (RACE.lapSeconds || {})[this.opts.cc] || 70;
    for (const b of $('opt-laps').children) {
      const min = (Number(b.dataset.laps) * lapS) / 60;
      b.querySelector('small').textContent = `≈${min < 1.25 ? '1' : (Math.round(min * 2) / 2).toString().replace('.5', '½')} min`;
    }
    // medalhas nos cartões e total de troféus
    const medals = store.get('medals', {});
    let got = 0;
    for (const card of this.grid.children) {
      const m = medals[card.dataset.id] || {};
      const mine = Object.keys(CLASSES).filter((cc) => MEDAL_ICON[m[cc]]);
      card.querySelector('.medals').innerHTML = mine.map((cc) => `<i title="${cc}">${MEDAL_ICON[m[cc]]}</i>`).join('');
      got += mine.length;
    }
    const total = CHARACTERS.length * Object.keys(CLASSES).length;
    const tro = $('select-trophies');
    if (tro) tro.textContent = got ? `🏆 ${got}/${total}` : '';
    // recorde da combinação escolhida
    const note = $('select-note');
    if (note && !note.classList.contains('warn')) {
      const rec = store.get('records', {})[`${this.opts.mode === 'timetrial' ? 'tt-' : ''}${this.opts.cc}-${this.opts.laps}`];
      const v = this.opts.laps === 1 ? '1 volta' : `${this.opts.laps} voltas`;
      // em dupla os recordes não contam (o resultado diz o mesmo): não mostra o recorde pessoal
      note.textContent = duo ? 'Duelo: recordes, medalhas e rankings não contam.' : rec ? `Seu recorde (${this.opts.cc}, ${v}): ${formatTime(rec.time)}` : this.opts.mode === 'timetrial' ? 'Sozinho na pista, só com foguetes. Bata o seu fantasma!' : '';
    }

    this.h.onCharacter?.(c.id);
    const img = $('detail-portrait');
    img.style.setProperty('--c', c.colors.ui);
    if (this.portraits[c.id]) {
      img.src = this.portraits[c.id];
      img.style.visibility = 'visible';
    } else {
      img.removeAttribute('src');
      img.style.visibility = 'hidden';
    }
    $('detail-name').textContent = c.fullName;
    $('detail-meta').textContent = `${c.years} · ${c.country} · ${c.field}`;
    $('detail-bio').textContent = c.bio;
    // uma curiosidade diferente a cada vez que o cientista é escolhido
    if (this._factFor !== c.id) {
      this._factFor = c.id;
      const f = pickFact('ficha:' + c.id, (SCIENTIST_FACTS[c.id] || []).filter((x) => !x.inBio));
      const el = $('detail-fact');
      if (el) el.innerHTML = f ? `<b>Você sabia?</b> ${esc(f.text)}` : '';
    }
    $('detail-stats').innerHTML = STAT_LABELS.map(
      ([k, label]) =>
        `<div class="stat"><span>${label}</span><div class="stat-bar">${[1, 2, 3, 4, 5]
          .map((i) => `<i class="${i <= c.stats[k] ? 'on' : ''}"></i>`)
          .join('')}</div></div>`,
    ).join('');
  }

  // who: jogador que se move (dois jogadores: 0 = WASD/1º controle, 1 = setas/2º controle)
  moveSelection(dx, dy, who = 0) {
    const duo = this.duo();
    if (!duo) who = 0;
    const i = CHARACTERS.findIndex((x) => x.id === this.pick(who));
    // colunas reais da grade (4 ou 5 conforme a tela)
    const cols = getComputedStyle(this.grid).gridTemplateColumns.split(' ').length || 4;
    const N = CHARACTERS.length;
    let n = (i + dx + dy * cols + N * 4) % N;
    // o cientista do outro jogador é pulado (mesmo sentido)
    if (duo && CHARACTERS[n].id === this.pick(1 - who)) n = (n + dx + dy * cols + N * 4) % N;
    this.setPick(who, CHARACTERS[n].id);
    this.editing = who;
    this.h.sfx('menuMove');
    this.refreshSelect();
    // com foco de Tab num cartão, o foco acompanha a seleção
    if (this.tabNav && document.activeElement?.classList.contains('char-card')) {
      this.grid.querySelector(`[data-id="${this.pick(who)}"]`)?.focus();
    }
    // setas/controle: a grade rola até o cartão escolhido (3ª fileira fora da tela em telas baixas)
    this.grid.querySelector('.char-card.selected')?.scrollIntoView({ block: 'nearest' });
  }

  buildHowto() {
    $('howto-items').innerHTML = Object.values(ITEMS)
      .map(
        (it) => `<div class="item-row"><div class="item-ico">${itemIconHTML(it.id)}</div>
        <div><b>${it.name}</b><p>${it.effect}</p><p><i>${it.fact}</i></p></div></div>`,
      )
      .join('');
  }

  // ---------- resultado ----------
  // info: { rec, facts, mode, rival, medal, unlocked150, daily, ghost, rankKey }
  showResults(results, player, info = {}) {
    if (info.players?.length > 1) return this.showDuelResults(results, info);
    const me = results.find((r) => r.kart === player);
    const place = me ? me.place : 0;
    const tt = info.mode === 'timetrial';
    this.lastRun = { place, time: me?.time, character: player.character, cc: info.cc, laps: info.laps, mode: info.mode, estimated: me?.estimated };
    $('results-title').textContent = tt ? `Tempo: ${formatTime(me?.time)}` : place === 1 ? 'Você venceu! 🏆' : `Você chegou em ${place}º lugar`;
    const rec = info.rec;
    const recEl = $('results-record');
    const parts = [];
    if (rec) {
      const v = rec.laps === 1 ? '1 volta' : `${rec.laps} voltas`;
      if (rec.newTotal) parts.push(`🏁 Novo recorde no ${rec.cc} (${v}): <b>${formatTime(rec.time)}</b>`);
      else if (rec.prevTotal) parts.push(`Seu recorde no ${rec.cc} (${v}): ${formatTime(rec.prevTotal.time)}`);
      if (rec.bestLap > 0) {
        if (rec.newLap) parts.push(`⚡ Melhor volta nova: <b>${formatTime(rec.bestLap)}</b>`);
        else if (rec.prevLap) parts.push(`melhor volta ${formatTime(rec.bestLap)} (recorde ${formatTime(rec.prevLap.time)})`);
      }
    }
    if (info.ghost != null) {
      const g = Math.abs(info.ghost).toFixed(2).replace('.', ',');
      parts.push(info.ghost < 0 ? `👻 ${g} s mais rápido que o fantasma` : `👻 ${g} s atrás do fantasma`);
    }
    if (info.rival && !tt) {
      const d = info.rival.delta;
      const n = info.rival.name;
      // tempo estimado (alguém não cruzou a chegada): diferença aproximada, em segundos inteiros
      const ds = info.rival.estimated ? `cerca de ${Math.max(1, Math.round(Math.abs(d)))}` : Math.abs(d).toFixed(1).replace('.', ',');
      const o = info.rival.female ? 'a' : 'o';
      parts.push(d < 0 ? `⚔️ Você venceu ${o} rival ${n} por ${ds} s` : `⚔️ ${o.toUpperCase()} rival ${n} chegou ${ds} s na sua frente`);
    }
    if (info.medal) parts.push(`${MEDAL_ICON[info.medal.type]} Medalha de ${info.medal.type} com ${player.character.name} no ${info.cc}!`);
    if (info.unlocked150) parts.push('🔓 150cc liberado!');
    if (info.daily) parts.push(info.daily.done ? '⭐ Desafio do dia cumprido!' : `⭐ Desafio do dia: ${esc(info.daily.goal)}`);
    recEl.classList.toggle('hidden', !parts.length);
    recEl.innerHTML = chipsHTML(parts);
    recEl.classList.toggle('new', !!(rec && (rec.newTotal || rec.newLap)) || !!info.medal || !!info.unlocked150);

    const list = tt ? results.filter((r) => r.kart === player) : results;
    $('results-list').innerHTML = list
      .map((r) => {
        const c = r.kart.character;
        const face = this.portraits[c.id] ? `<img class="face" src="${this.portraits[c.id]}" alt="" style="--c:${c.colors.ui}">` : `<span class="dot" style="background:${c.colors.ui}"></span>`;
        return `<li class="${r.kart === player ? 'me' : ''}">
          <span class="p">${r.place}º</span>
          ${face}
          <span>${c.name}${r.kart === player ? ' (você)' : ''}</span>
          <span class="t">${r.estimated ? '~' : ''}${formatTime(r.time)}</span>
        </li>`;
      })
      .join('');

    // curiosidades: vencedor, o seu cientista e o que apareceu na corrida
    const winner = results[0].kart.character;
    const mine = player.character;
    const facts = [];
    const wf = pickFact('sci:' + winner.id, SCIENTIST_FACTS[winner.id]);
    if (wf && !tt) facts.push({ title: `${winner.name}, ${winner.gender === 'f' ? 'a vencedora' : 'o vencedor'}`, icon: '🏆', ...wf });
    if (mine.id !== winner.id || tt) {
      const mf = pickFact('sci:' + mine.id, SCIENTIST_FACTS[mine.id]);
      if (mf) facts.push({ title: mine.name, icon: '🧑‍🔬', ...mf });
    }
    for (const f of info.facts || []) facts.push(f);
    this.resultFacts = facts;
    $('results-fact').innerHTML =
      '<b class="fact-head">Você sabia?</b>' +
      facts.map((f) => `<p><span class="fi">${f.icon || '•'}</span> <b>${esc(f.title)}:</b> ${esc(f.text)}</p>`).join('');

    // quiz opcional (só se houver pergunta entre as curiosidades)
    const qz = $('results-quiz');
    this.quizPool = facts.filter((f) => f.quiz);
    qz.innerHTML = this.quizPool.length ? '<button class="btn btn-small" data-action="quiz">🧠 Responder 1 pergunta (opcional)</button>' : '';

    // ranking deste aparelho
    this.renderRanking(info.rankKey, info.rankIndex);
    this.show('results');
  }

  // Resultado de 2 jogadores: J1 e J2 destacados e quem venceu o duelo. Recordes, medalhas,
  // rankings e desafio do dia não contam (dois alunos no mesmo aparelho, sem conta de cada um).
  showDuelResults(results, info) {
    const ps = info.players;
    const rs = ps.map((k) => results.find((r) => r.kart === k));
    const wi = rs[0] && rs[1] ? (rs[1].place < rs[0].place ? 1 : 0) : 0;
    const w = ps[wi];
    const tagOf = (k) => ps.indexOf(k);
    const v = info.laps === 1 ? '1 volta' : `${info.laps} voltas`;
    this.lastRun = {
      duel: ps.map((k, i) => ({ name: k.character.name, place: rs[i]?.place })),
      cc: info.cc, laps: info.laps, mode: info.mode,
    };
    $('results-title').textContent = `${w.character.name} (J${wi + 1}) venceu o duelo!${rs[wi]?.place === 1 ? ' 🏆' : ''}`;
    const parts = ps.map((k, i) => `<b style="color:${PLAYER_COLORS[i]}">J${i + 1}</b> ${esc(k.character.name)}: ${rs[i]?.place || '?'}º`);
    if (rs[0] && rs[1]) {
      const d = Math.abs(rs[0].time - rs[1].time);
      const best = rs[wi];
      parts.push(`🏁 Melhor entre os dois: <b>${esc(w.character.name)} (J${wi + 1}) · ${best.estimated ? '~' : ''}${formatTime(best.time)}</b>, ${d.toFixed(2).replace('.', ',')} s na frente`);
    }
    parts.push(`<small>${info.cc}, ${v} · no modo 2 jogadores, recordes e rankings não contam</small>`);
    const recEl = $('results-record');
    recEl.classList.remove('hidden');
    recEl.classList.add('new');
    recEl.innerHTML = chipsHTML(parts);

    $('results-list').innerHTML = results
      .map((r) => {
        const c = r.kart.character;
        const t = tagOf(r.kart);
        const face = this.portraits[c.id] ? `<img class="face" src="${this.portraits[c.id]}" alt="" style="--c:${c.colors.ui}">` : `<span class="dot" style="background:${c.colors.ui}"></span>`;
        return `<li class="${t >= 0 ? `me p${t + 1}` : ''}">
          <span class="p">${r.place}º</span>
          ${face}
          <span>${c.name}${t >= 0 ? ` <b class="ptag p${t + 1}">(J${t + 1})</b>` : ''}</span>
          <span class="t">${r.estimated ? '~' : ''}${formatTime(r.time)}</span>
        </li>`;
      })
      .join('');

    // curiosidades: vencedor da corrida e os cientistas dos dois jogadores
    const winner = results[0].kart.character;
    const facts = [];
    const wf = pickFact('sci:' + winner.id, SCIENTIST_FACTS[winner.id]);
    if (wf) facts.push({ title: `${winner.name}, ${winner.gender === 'f' ? 'a vencedora' : 'o vencedor'}`, icon: '🏆', ...wf });
    ps.forEach((k, i) => {
      if (k.character.id === winner.id) return;
      const f = pickFact('sci:' + k.character.id, SCIENTIST_FACTS[k.character.id]);
      if (f) facts.push({ title: `${k.character.name} (J${i + 1})`, icon: '🧑‍🔬', ...f });
    });
    for (const f of info.facts || []) facts.push(f);
    this.resultFacts = facts;
    $('results-fact').innerHTML =
      '<b class="fact-head">Você sabia?</b>' +
      facts.map((f) => `<p><span class="fi">${f.icon || '•'}</span> <b>${esc(f.title)}:</b> ${esc(f.text)}</p>`).join('');
    const qz = $('results-quiz');
    this.quizPool = facts.filter((f) => f.quiz);
    qz.innerHTML = this.quizPool.length ? '<button class="btn btn-small" data-action="quiz">🧠 Responder 1 pergunta (opcional)</button>' : '';
    this.renderRanking(null, -1);
    this.show('results');
  }

  // Resultado da corrida online: todos, com o nome de cada jogador e o cientista. Enquanto
  // alguém ainda corre, o main.js chama renderNetList de novo (lista viva, prazo de 60 s).
  // Corridas online não contam para recordes, medalhas, rankings nem desafio do dia.
  showNetResults(results, player, info) {
    this.renderNetList(results, player, info);
    const me = results.find((r) => r.kart === player);
    // online: quantos amigos (os outros humanos; você não conta)
    const friends = results.filter((r) => r.human && r.kart !== player).length;
    this.lastRun = { place: me?.place, time: me?.time, character: player.character, cc: info.cc, laps: info.laps, mode: 'race', estimated: me?.estimated, online: Math.max(1, friends) };
    // curiosidades: vencedor (entre os que já chegaram) e o seu cientista
    const winner = results.find((r) => !r.running && !r.left)?.kart.character;
    const mine = player.character;
    const facts = [];
    if (winner) {
      const wf = pickFact('sci:' + winner.id, SCIENTIST_FACTS[winner.id]);
      if (wf) facts.push({ title: `${winner.name}, ${winner.gender === 'f' ? 'a vencedora' : 'o vencedor'}`, icon: '🏆', ...wf });
    }
    if (!winner || mine.id !== winner.id) {
      const mf = pickFact('sci:' + mine.id, SCIENTIST_FACTS[mine.id]);
      if (mf) facts.push({ title: mine.name, icon: '🧑‍🔬', ...mf });
    }
    for (const f of info.facts || []) facts.push(f);
    this.resultFacts = facts;
    $('results-fact').innerHTML =
      '<b class="fact-head">Você sabia?</b>' +
      facts.map((f) => `<p><span class="fi">${f.icon || '•'}</span> <b>${esc(f.title)}:</b> ${esc(f.text)}</p>`).join('');
    const qz = $('results-quiz');
    this.quizPool = facts.filter((f) => f.quiz);
    qz.innerHTML = this.quizPool.length ? '<button class="btn btn-small" data-action="quiz">🧠 Responder 1 pergunta (opcional)</button>' : '';
    this.renderRanking(null, -1);
    this.show('results');
  }

  renderNetList(results, player, info) {
    const me = results.find((r) => r.kart === player);
    const final = !!info.final;
    // o texto de "Compartilhar" usa a colocação de agora (a lista muda até fechar)
    if (me && this.lastRun?.online) Object.assign(this.lastRun, { place: me.place, time: me.time, estimated: me.estimated });
    const v = info.laps === 1 ? '1 volta' : `${info.laps} voltas`;
    let title = 'Resultado';
    if (me && !me.running && !me.left) {
      if (me.estimated) title = `Tempo esgotado · ${me.place}º lugar`;
      else title = me.place === 1 ? 'Você venceu! 🏆' : `Você chegou em ${me.place}º lugar`;
    }
    $('results-title').textContent = title;
    const waiting = results.filter((r) => r.human && r.running);
    const parts = [];
    if (!final && waiting.length) {
      // "Esperando Ana chegar" / "Esperando Ana, Bia e Caio chegarem"
      const list = waiting.map((r) => esc(r.name || r.kart.character.name));
      const names = list.length > 1 ? `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}` : list[0];
      parts.push(`⏳ Esperando ${names} ${list.length > 1 ? 'chegarem' : 'chegar'}${info.timeLeft != null ? ` · o resultado fecha em <b>${Math.ceil(info.timeLeft)} s</b>` : ''}`);
    } else if (final) parts.push('🏁 Resultado final');
    parts.push(`<small>🌐 Sala ${esc(info.room || '')} · ${esc(info.cc)}, ${v} · corridas online não contam para recordes e medalhas</small>`);
    const recEl = $('results-record');
    recEl.classList.remove('hidden');
    recEl.classList.toggle('new', final);
    recEl.innerHTML = chipsHTML(parts);
    // volta para a sala só com o resultado fechado: quem sai antes deixaria o kart (e, se for o
    // anfitrião, a IA) parado na pista de quem ainda corre
    const back = $('btn-net-lobby');
    if (back) {
      back.disabled = !final;
      back.innerHTML = final ? '🏁 Voltar à sala' : '⏳ Esperando todos';
    }
    $('results-list').innerHTML = results
      .map((r) => {
        const c = r.kart.character;
        const face = this.portraits[c.id] ? `<img class="face" src="${this.portraits[c.id]}" alt="" style="--c:${c.colors.ui}">` : `<span class="dot" style="background:${c.colors.ui}"></span>`;
        const name = r.human ? `${esc(r.name || 'Jogador')} <small class="sci">${esc(c.name)}</small>` : `${esc(c.name)} <small class="sci">IA</small>`;
        const t = r.left && !isFinite(r.time) ? (r.human ? 'abandonou' : 'desconectado') : r.running ? 'correndo…' : `${r.estimated ? '~' : ''}${formatTime(r.time)}${r.left ? ' <small>(saiu)</small>' : ''}`;
        return `<li class="${r.kart === player ? 'me' : ''}${r.left ? ' left' : ''}${r.human ? ' human' : ''}">
          <span class="p">${r.place ? r.place + 'º' : '–'}</span>
          ${face}
          <span>${name}${r.kart === player ? ' (você)' : ''}</span>
          <span class="t">${t}</span>
        </li>`;
      })
      .join('');
  }

  // ---------- quiz ----------
  startQuiz() {
    const pool = this.quizPool || [];
    if (!pool.length) return;
    const f = pool[Math.floor(Math.random() * pool.length)];
    const q = shuffledQuiz(f.quiz);
    const box = $('results-quiz');
    box.innerHTML = `<p class="quiz-q">${esc(q.q)}</p><div class="quiz-opts">${q.options
      .map((o, i) => `<button class="btn btn-small" data-i="${i}">${esc(o)}</button>`)
      .join('')}</div>`;
    box.querySelector('button')?.focus({ preventScroll: true });
    box.querySelector('.quiz-opts').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b || box.dataset.done === '1') return;
      box.dataset.done = '1';
      const ok = Number(b.dataset.i) === q.answer;
      const st = store.get('quiz', { right: 0, total: 0 });
      st.total++;
      if (ok) st.right++;
      store.set('quiz', st);
      this.h.sfx(ok ? 'menuSelect' : 'menuMove');
      for (const o of box.querySelectorAll('button[data-i]')) {
        o.disabled = true;
        if (Number(o.dataset.i) === q.answer) o.classList.add('right');
      }
      if (!ok) b.classList.add('wrong');
      box.insertAdjacentHTML('beforeend', `<p class="quiz-fb ${ok ? 'ok' : 'no'}">${ok ? '✅ Certo!' : '❌ Não foi dessa vez.'} ${esc(f.text)} <small>(acertos: ${st.right}/${st.total})</small></p>`);
    });
    box.dataset.done = '';
  }

  // ---------- compartilhar ----------
  async share(btn) {
    const r = this.lastRun;
    if (!r) return;
    const v = r.laps === 1 ? '1 volta' : `${r.laps} voltas`;
    const what = r.mode === 'timetrial' ? `fiz ${formatTime(r.time)} no modo contra o relógio` : `cheguei em ${r.place}º lugar${r.estimated ? '' : ` em ${formatTime(r.time)}`}`;
    const text = r.duel
      ? `No Kart Científico, corremos em dupla: ${r.duel[0].name} (J1) chegou em ${r.duel[0].place}º e ${r.duel[1].name} (J2) em ${r.duel[1].place}º (${r.cc}, ${v})! Topa o desafio?`
      : r.online
        ? `No Kart Científico online, cheguei em ${r.place}º lugar numa corrida com ${r.online === 1 ? '1 amigo' : `${r.online} amigos`}, com ${r.character.name} (${r.cc}, ${v})! Bora correr junto?`
        : `No Kart Científico, ${what} com ${r.character.name} (${r.cc}, ${v})! Você consegue?`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Kart Científico', text, url: GAME_URL });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${GAME_URL}`);
      if (btn) {
        const old = btn.innerHTML;
        btn.innerHTML = '✅ Copiado!';
        setTimeout(() => { btn.innerHTML = old; }, 1800);
      }
    } catch {
      /* compartilhamento cancelado ou bloqueado */
    }
  }

  // ---------- ranking local (top 5 deste aparelho) ----------
  renderRanking(key, idx) {
    const box = $('results-rank');
    if (!box) return;
    const list = (store.get('ranking', {})[key] || []).slice(0, 5);
    if (!key || !list.length) {
      box.innerHTML = '';
      return;
    }
    const rows = list
      .map((e, i) => `<li class="${i === idx ? 'me' : ''}"><span>${i + 1}º</span><span${i === idx && !e.name ? ' class="rank-edit"' : ''}>${i === idx && !e.name ? `<input id="rank-name" maxlength="14" placeholder="Seu nome" value="${esc(store.get('nick', '') || this.me?.nickname || '')}" aria-label="Seu nome no ranking" /><button class="btn btn-small" id="rank-save">Salvar</button>` : esc(e.name || 'Jogador')}</span><span class="t">${formatTime(e.time)}</span></li>`)
      .join('');
    box.innerHTML = `<details ${idx >= 0 ? 'open' : ''}><summary>🏆 Ranking deste aparelho</summary><ol class="rank-list">${rows}</ol></details>`;
    const save = $('rank-save');
    if (save) {
      const commit = () => {
        const name = ($('rank-name').value || '').trim().slice(0, 14) || 'Jogador';
        store.set('nick', name);
        const all = store.get('ranking', {});
        if (all[key] && all[key][idx]) all[key][idx].name = name;
        store.set('ranking', all);
        this.renderRanking(key, -1);
      };
      save.addEventListener('click', commit);
      $('rank-name').addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
      });
    }
  }

  // ---------- ranking online ----------
  // me: { nickname, suggest }, null (sem conta) ou undefined (não carregou)
  accountHTML(me) {
    const u = Online.user;
    if (!Online.available) return this.offlineHTML('O ranking online funciona no site quantaaulas.com. Aqui vale o ranking deste aparelho.');
    if (!u) return `<p>Entre com sua conta Google para aparecer no ranking.</p><a class="btn btn-primary btn-small" href="${Online.loginUrl}">Entrar com Google</a>`;
    if (me === undefined) return '<p class="muted">Não deu para carregar o seu apelido agora.</p><button class="btn btn-small" data-action="online-retry">Tentar de novo</button>';
    if (me && me.nickname) return `<p>Você aparece como <b>${esc(me.nickname)}</b>.</p>` + this.nickForm(me.nickname, 'Trocar apelido', 'nick');
    return '<p>Escolha um apelido para aparecer no ranking (os colegas veem esse nome, não o seu e&#8209;mail).</p>' + this.nickForm(me?.suggest || u.firstName || '', 'Salvar apelido', 'nick');
  }

  // Online indisponível: ainda carregando (rede lenta), sem conexão no site ou fora do site.
  offlineHTML(offSite) {
    if (Online.status === 'loading') return '<p class="muted">Conectando à sua conta… A internet está lenta: esta tela se atualiza sozinha.</p>';
    if (Online.onSite) return `<p class="muted">${ERR_TEXT.room_offline}</p><button class="btn btn-small" data-action="online-retry">Tentar de novo</button>`;
    return `<p class="muted">${offSite}</p>`;
  }

  // Formulário de apelido. idp: prefixo dos ids ('nick' na tela Ranking online, 'res-nick' no resultado);
  // saveNick procura o campo dentro do próprio formulário.
  nickForm(value, label, idp) {
    return `<div class="nick-form"><div class="turma-row"><input class="nick-input" id="${idp}-input" maxlength="16" value="${esc(value)}" aria-label="Apelido" enterkeyhint="done" /><button class="btn btn-small" data-action="nick-save">${label}</button></div><p class="turma-msg nick-msg" id="${idp}-msg" aria-live="polite"></p></div>`;
  }

  async saveNick(el) {
    const box = el?.closest('.nick-form');
    const inp = box?.querySelector('.nick-input');
    const btn = box?.querySelector('[data-action=nick-save]');
    const msg = box?.querySelector('.nick-msg');
    if (!inp || btn?.disabled) return;
    if (btn) btn.disabled = true; // clique duplo não manda duas vezes
    if (msg) msg.textContent = '';
    const r = await Online.setNickname(inp.value.trim());
    if (btn) btn.disabled = false;
    if (r?.ok) {
      this.me = { nickname: r.nickname };
      this.h.sfx('menuSelect');
      if (this.current === 'online' && box.closest('#screen-online')) this.refreshOnline();
      else if (this.current === 'results' && box.closest('#results-online')) this.nickSavedOnResult(r.nickname);
    } else if (msg?.isConnected) msg.textContent = ERR_TEXT[r?.error] || ERR_TEXT.offline;
  }

  // Apelido salvo no resultado: o tempo já enviado passa a aparecer no ranking; mostra a colocação.
  async nickSavedOnResult(nick) {
    const res = this._onlineRes;
    if (!res?.global?.ok) return;
    res.global.nick = nick;
    this.renderOnlineResult(res);
    if (!res.board) return;
    const [w, a] = await Promise.all([Online.leaderboard(res.board, 'week', 1), Online.leaderboard(res.board, 'all', 1)]);
    if (this._onlineRes !== res || this.current !== 'results') return;
    res.global.rank_week = w?.find((x) => x.is_me)?.rank;
    res.global.rank_all = a?.find((x) => x.is_me)?.rank;
    this.renderOnlineResult(res);
  }

  async refreshOnline() {
    const seq = ++this._onSeq;
    const stale = () => seq !== this._onSeq || this.current !== 'online';
    if (!this.onFilter) this.onFilter = { mode: this.opts.mode, cc: this.opts.cc, laps: this.opts.laps, period: 'week' };
    const f = this.onFilter;
    // seletores (liga os cliques só uma vez)
    const segs = { 'on-mode': 'mode', 'on-cc': 'cc', 'on-laps': 'laps', 'on-period': 'period' };
    for (const [id, key] of Object.entries(segs)) {
      const el = $(id);
      if (!el) continue;
      if (!el._wired) {
        el._wired = true;
        el.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          f[key] = key === 'laps' ? Number(b.dataset.v) : b.dataset.v;
          this.h.sfx('menuMove');
          this.refreshOnline();
        });
      }
      for (const b of el.children) {
        const on = String(f[key]) === b.dataset.v;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on)); // leitor de tela: qual filtro está ativo
      }
    }
    const list = $('online-list');
    list.innerHTML = '<li class="muted">Carregando…</li>';
    await Online.init();
    const me = Online.user ? await Online.getMe() : null;
    if (stale()) return;
    if (me !== undefined) this.me = me;
    // a conta só é redesenhada se mudou (trocar de filtro não apaga o apelido que está sendo digitado)
    const acc = $('online-account');
    const key = JSON.stringify([Online.status, Online.user?.id, me === undefined ? 'x' : me?.nickname, me?.suggest]);
    if (acc._key !== key || !acc.innerHTML) {
      acc._key = key;
      acc.innerHTML = this.accountHTML(me);
    }
    if (!Online.available) {
      list.innerHTML = '';
      return;
    }
    const rows = await Online.leaderboard(boardOf(f), f.period, 20);
    if (stale()) return;
    list.innerHTML = this.boardRows(rows, 'Ninguém correu nesta combinação ainda. Seja o primeiro!');
  }

  boardRows(rows, empty) {
    if (rows === null || rows === undefined) return `<li class="muted">${ERR_TEXT.offline}</li>`;
    if (!rows.length) return `<li class="muted">${empty}</li>`;
    return rows
      .map((r) => {
        const c = CHARACTERS.find((x) => x.id === (r.character || r.char_id));
        const face = c && this.portraits[c.id] ? `<img class="face" src="${this.portraits[c.id]}" alt="" style="--c:${c.colors.ui}">` : '<span class="face"></span>';
        return `<li class="${r.is_me ? 'me' : ''}"><span class="p">${r.rank}º</span>${face}<span class="n">${esc(r.nickname || r.name || '')}</span><span class="t">${formatTime((r.time_ms || 0) / 1000)}</span></li>`;
      })
      .join('');
  }

  // Resultado: envio já feito pelo main.js; aqui só mostra a colocação e o placar.
  renderOnlineResult(res) {
    this._onlineRes = res;
    const box = $('results-online');
    if (!box) return;
    if (!res) {
      box.innerHTML = '';
      return;
    }
    const parts = [];
    if (res.pending) parts.push('<p class="muted">🌐 Enviando para o ranking online…</p>');
    if (res.global) {
      const g = res.global;
      if (g.ok) {
        const rk = [];
        if (g.rank_week) rk.push(`${g.rank_week}º da semana`);
        if (g.rank_all) rk.push(`${g.rank_all}º no geral`);
        const as = g.nick ? ` como <b>${esc(g.nick)}</b>` : '';
        if (rk.length) parts.push(`<p>🌐 Ranking online${as}: <b>${rk.join(' · ')}</b></p>`);
        else if (g.nick) parts.push(`<p>🌐 Apelido salvo: <b>${esc(g.nick)}</b>. Seu tempo já aparece no ranking online.</p>`);
        else {
          // tempo gravado, mas sem apelido ele não aparece na lista
          parts.push('<p>🌐 Tempo salvo no ranking online. Escolha um apelido para ele aparecer na lista (os colegas veem o apelido, não o seu e&#8209;mail):</p>');
          parts.push(this.nickForm(this.me?.suggest || Online.user?.firstName || '', 'Salvar apelido', 'res-nick'));
        }
      } else parts.push(`<p class="muted">🌐 ${runErrText(g.error)}</p>`);
    } else if (res.loginHint && Online.available) {
      parts.push(`<p class="muted">🌐 Entre com sua conta para este tempo valer no ranking online. <a href="${Online.loginUrl}">Entrar com Google</a></p>`);
    }
    if (res.room) {
      const r = res.room;
      if (r.ok) parts.push(`<p>🏫 Sala ${esc(res.roomCode)}: <b>${r.rank}º de ${r.participants}</b> (seu melhor: ${formatTime(r.best / 1000)})</p>`);
      else {
        // sala fechada/apagada ou nome recusado: o aluno sai da sala (senão a escolha fica travada
        // no motor/voltas dela e toda corrida falha igual)
        if (['closed', 'not_found', 'invalid_name'].includes(r.error) && this.room?.code === res.roomCode) {
          this.setRoom(null);
          res.leftRoom = true;
        }
        const t = r.error === 'limit' ? ERR_TEXT.room_limit : r.error === 'no_run' ? ERR_TEXT.no_ticket_room : runErrText(r.error, 'Sem conexão com a sala agora: este tempo não foi enviado.');
        parts.push(`<p class="muted">🏫 ${t}${res.leftRoom ? ` Você saiu da sala ${esc(res.roomCode)}.` : ''}</p>`);
      }
      // o servidor já limita (os 8 primeiros e a linha do próprio aluno, se ele ficou de fora)
      if (res.roomBoard?.players) parts.push(`<ol class="online-list compact">${this.boardRows(res.roomBoard.players, '')}</ol>`);
    }
    box.innerHTML = parts.join('');
  }

  // ---------- turma ----------
  setRoom(room) {
    this.room = room;
    if (room) store.set('room', room);
    else {
      store.set('room', null);
      // ao sair da sala, volta às escolhas do próprio jogador
      const cc = store.get('cc', '50cc');
      this.opts.cc = Object.hasOwn(CLASSES, cc) && (cc !== '150cc' || is150Unlocked()) ? cc : '100cc';
      const laps = store.get('laps', RACE.defaultLaps);
      this.opts.laps = RACE.lapOptions.includes(laps) ? laps : RACE.defaultLaps;
      this.opts.mode = store.get('mode', 'race') === 'timetrial' ? 'timetrial' : 'race';
    }
    if (this.current === 'select') this.refreshSelect();
  }

  async joinRoom() {
    const code = ($('room-code').value || '').trim().toUpperCase();
    const name = cleanRoomName($('room-name').value);
    const msg = $('room-msg');
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      msg.textContent = 'O código tem 5 letras ou números.';
      return;
    }
    // o nome na sala é o digitado (com conta, o campo já vem com o apelido do ranking, mas o
    // professor precisa reconhecer o aluno no relatório)
    if (name.length < 2) {
      msg.textContent = 'Escreva seu nome para a turma ver no placar.';
      return;
    }
    // mesma regra do banco: um nome recusado lá só apareceria no fim da corrida
    if (!ROOM_NAME_RE.test(name)) {
      msg.textContent = ERR_TEXT.room_name;
      return;
    }
    // resposta de um pedido antigo, ou que chega depois de o jogador sair da tela, é ignorada
    const seq = ++this._joinSeq;
    const stale = () => seq !== this._joinSeq || this.current !== 'turma';
    msg.textContent = 'Procurando a sala…';
    await Online.init();
    if (stale()) return;
    if (!Online.available) {
      msg.textContent = Online.onSite || Online.status === 'loading' ? ERR_TEXT.room_offline : 'As salas funcionam no site quantaaulas.com, com internet.';
      return;
    }
    const r = await Online.roomGet(code, name);
    if (stale()) return;
    if (r === undefined) msg.textContent = ERR_TEXT.room_offline;
    else if (!r) msg.textContent = ERR_TEXT.not_found;
    else if (!r.open) msg.textContent = ERR_TEXT.closed;
    // nome recusado pela lista do banco: avisa já na entrada, e não no fim da corrida
    else if (r.name_ok === false) msg.textContent = ERR_TEXT.room_name_bad;
    else {
      store.set('room-name', name);
      store.set('room-code', r.code);
      this.setRoom({ code: r.code, name: r.name, board: r.board, guestName: name });
      this.h.sfx('menuSelect');
      this.show('select');
    }
  }

  // prefill: preenche os campos do aluno (só ao abrir a tela; não apaga o que está sendo digitado)
  async refreshTurma(prefill = true) {
    const seq = ++this._turmaSeq;
    const stale = () => seq !== this._turmaSeq || this.current !== 'turma';
    if (prefill) {
      const saved = store.get('room', null);
      if (saved && !this.room) this.room = saved;
      $('room-name').value = store.get('room-name', store.get('nick', ''));
      $('room-code').value = this.room ? this.room.code : store.get('room-code', '');
      $('room-msg').textContent = this.room ? `Você está na sala ${this.room.code} (${this.room.name}).` : '';
    }
    const create = $('turma-create');
    const list = $('turma-list');
    create.innerHTML = '<p class="muted">Carregando…</p>';
    list.innerHTML = '';
    const report = $('room-report');
    report.innerHTML = '';
    report.classList.add('hidden');
    await Online.init();
    if (stale()) return;
    if (!Online.available) {
      create.innerHTML = this.offlineHTML('As salas funcionam no site quantaaulas.com, com internet.');
      return;
    }
    // sala guardada: confere se ainda existe e está aberta (senão o aluno sai dela)
    if (this.room && prefill) {
      const code = this.room.code;
      Online.roomGet(code).then((r) => {
        if (r === undefined || (r && r.open) || this.room?.code !== code) return;
        this.setRoom(null);
        if (this.current === 'turma') $('room-msg').textContent = `Você saiu da sala ${code}: ${r ? 'ela foi fechada' : 'ela não existe mais'}.`;
      });
    }
    // com conta e apelido, o campo vem com o apelido do ranking (o aluno pode trocar pelo nome
    // dele: é o que o professor vê no relatório)
    const me = Online.user ? await Online.getMe() : null;
    if (stale()) return;
    if (me !== undefined) this.me = me;
    const nameIn = $('room-name');
    const nick = Online.user && this.me && this.me.nickname;
    nameIn.disabled = false;
    if (nick && !nameIn.value.trim()) nameIn.value = nick;
    if (!Online.user) {
      create.innerHTML = `<p>Para criar uma sala, entre com a sua conta.</p><a class="btn btn-small" href="${Online.loginUrl}">Entrar com Google</a>`;
      return;
    }
    const o = this.opts;
    create.innerHTML = `<p>A sala usa o motor, as voltas e o modo escolhidos agora: <b>${o.cc}, ${o.laps === 1 ? '1 volta' : o.laps + ' voltas'}${o.mode === 'timetrial' ? ', contra o relógio' : ''}</b> (troque na tela de escolha antes de criar).</p>
      <div class="turma-row"><input id="room-new-name" maxlength="40" placeholder="Nome da turma (ex.: 1º ano B)" aria-label="Nome da turma" enterkeyhint="go" /><button class="btn btn-primary btn-small" data-action="room-create">Criar sala</button></div><p class="turma-msg" id="room-new-msg" aria-live="polite"></p>`;
    const rooms = await Online.roomList();
    if (stale() || !rooms || !rooms.length) return;
    list.innerHTML = '<h3>Minhas salas</h3><ul class="room-list">' + rooms
      .map((r) => {
        const b = parseBoard(r.board) || {};
        return `<li><span class="room-info"><b class="code">${esc(r.code)}</b> ${esc(r.name)} <small>${b.cc || ''}, ${b.laps || '?'} v${b.mode === 'timetrial' ? ', relógio' : ''} · ${r.participants} aluno(s) · ${r.open ? 'aberta' : 'fechada'}</small></span>
          <span class="room-actions"><button class="btn btn-small" data-action="room-report" data-code="${esc(r.code)}">Resultados</button>
          <button class="btn btn-small" data-action="room-toggle" data-code="${esc(r.code)}" data-open="${r.open ? '0' : '1'}">${r.open ? 'Fechar' : 'Reabrir'}</button></span></li>`;
      })
      .join('') + '</ul>';
  }

  async createRoom() {
    const inp = $('room-new-name');
    const msg = $('room-new-msg');
    const btn = $('turma-create')?.querySelector('[data-action=room-create]');
    if (!inp || btn?.disabled) return;
    const name = cleanRoomName(inp.value);
    if (name.length < 2) {
      msg.textContent = 'Dê um nome de 2 a 40 letras para a turma.';
      return;
    }
    if (!ROOM_NAME_RE.test(name)) {
      msg.textContent = ERR_TEXT.room_name;
      return;
    }
    if (btn) btn.disabled = true; // clique duplo não cria duas salas
    const r = await Online.roomCreate(name, boardOf(this.opts));
    if (btn) btn.disabled = false;
    if (this.current !== 'turma') return;
    if (r?.ok) {
      this.h.sfx('menuSelect');
      await this.refreshTurma(false);
      const m = $('room-new-msg');
      if (m) m.innerHTML = `Sala criada! Passe o código <b class="code">${esc(r.code)}</b> para a turma.`;
    } else if (msg?.isConnected) {
      msg.textContent = r?.error === 'invalid' ? 'Esse nome não é aceito para a turma. Escolha outro.'
        : r?.error === 'limit' ? 'Você já tem 30 salas ativas (cada uma vale 30 dias). Espere uma vencer para criar outra.'
        : r?.error === 'offline' ? ERR_TEXT.room_offline : ERR_TEXT[r?.error] || ERR_TEXT.room_offline;
    }
  }

  async toggleRoom(code, open, btn) {
    if (!code || btn?.disabled) return;
    if (btn) btn.disabled = true;
    const r = await Online.roomOpen(code, open);
    if (this.current !== 'turma') return;
    const hadReport = this._report?.room?.code === code && !$('room-report')?.classList.contains('hidden');
    await this.refreshTurma(false);
    // fechar a sala no fim da aula não some com o relatório aberto (o professor ainda vai copiá-lo)
    if (hadReport && this.current === 'turma') this.showReport(code);
    // teclado: o foco volta ao botão da mesma sala (a lista foi redesenhada)
    if (this.tabNav) $('turma-list')?.querySelector(`[data-action=room-toggle][data-code="${code}"]`)?.focus({ preventScroll: true });
    const m = $('room-new-msg');
    if (!r?.ok && m) {
      m.textContent = r?.error === 'limit' ? 'Você já tem 30 salas ativas: espere uma vencer para reabrir esta.'
        : r?.error === 'not_found' ? ERR_TEXT.not_found : ERR_TEXT.room_offline;
    }
  }

  async showReport(code) {
    const box = $('room-report');
    if (!box || !code) return;
    const seq = ++this._repSeq;
    box.classList.remove('hidden');
    box.innerHTML = '<p class="muted">Carregando…</p>';
    const r = await Online.roomReport(code);
    // clique em 'Resultados' de outra sala antes da resposta: vale só o último
    if (seq !== this._repSeq || this.current !== 'turma') return;
    this._report = r?.ok ? r : null;
    if (!r?.ok) {
      box.innerHTML = `<p class="muted">${ERR_TEXT[r?.error] || ERR_TEXT.room_offline}</p>`;
      return;
    }
    // 'Remover' só com o banco atualizado (o relatório traz o id da corrida)
    const canRemove = (r.players || []).some((p) => p.id != null);
    const rows = (r.players || [])
      .map((p, i) => {
        const c = CHARACTERS.find((x) => x.id === p.character);
        const rm = canRemove ? `<td>${p.id != null ? `<button class="btn btn-small btn-quiet" data-action="room-remove" data-id="${esc(p.id)}" aria-label="Remover ${esc(p.name)} do placar">Remover</button>` : ''}</td>` : '';
        return `<tr><td>${i + 1}º</td><td>${esc(p.name)}${p.guest ? ' <small>(sem conta)</small>' : ''}</td><td>${formatTime(p.time_ms / 1000)}</td><td>${formatTime(p.best_lap_ms / 1000)}</td><td>${c ? esc(c.name) : ''}</td><td>${p.runs}</td>${rm}</tr>`;
      })
      .join('');
    box.innerHTML = `<div class="report-head"><h3>Sala ${esc(code)} · ${esc(r.room.name)}</h3>${rows ? '<button class="btn btn-small" data-action="room-copy">📋 Copiar para planilha</button>' : ''}</div><p class="turma-msg" id="report-msg" aria-live="polite"></p>` + (rows
      ? `<div class="report-scroll"><table class="report"><thead><tr><th></th><th>Aluno</th><th>Melhor tempo</th><th>Melhor volta</th><th>Cientista</th><th>Corridas</th>${canRemove ? '<th></th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="muted">Ninguém correu ainda.</p>');
    box.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  // Professor tira um aluno do placar da sala (nome indevido, tempo impossível): pede um segundo toque.
  async removeFromRoom(btn) {
    const code = this._report?.room?.code;
    if (!btn || !code || btn.disabled || !this._confirm(btn, 'Remover mesmo?')) return;
    btn.disabled = true;
    const r = await Online.roomRemove(code, Number(btn.dataset.id));
    if (this.current !== 'turma') return;
    if (r?.ok) {
      await this.showReport(code);
      const m = $('report-msg');
      if (m) m.textContent = 'Aluno removido do placar da sala.';
    } else {
      btn.disabled = false;
      const m = $('report-msg');
      if (m) m.textContent = r?.error === 'not_found' ? 'Esse aluno já não está no placar.' : ERR_TEXT.room_offline;
    }
  }

  // Relatório como tabela separada por tabulação: cola direto no Excel/Planilhas Google.
  async copyReport(btn) {
    const r = this._report;
    if (!r) return;
    // colunas em segundos com vírgula decimal: a planilha em português ordena e tira média direto
    const sec = (ms) => (ms / 1000).toFixed(2).replace('.', ',');
    const lines = [['Posição', 'Aluno', 'Sem conta', 'Melhor tempo', 'Melhor volta', 'Tempo (s)', 'Volta (s)', 'Cientista', 'Corridas'].join('\t')];
    (r.players || []).forEach((p, i) => {
      const c = CHARACTERS.find((x) => x.id === p.character);
      lines.push([i + 1, p.name, p.guest ? 'sim' : '', formatTime(p.time_ms / 1000), formatTime(p.best_lap_ms / 1000), sec(p.time_ms), sec(p.best_lap_ms), c ? c.name : '', p.runs].join('\t'));
    });
    const text = lines.join('\n');
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // sem permissão da área de transferência: seleciona um campo de texto e copia
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;left:0;top:0';
      document.body.append(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    if (btn) {
      const old = btn.textContent;
      btn.textContent = ok ? '✔ Copiado! Cole na planilha' : 'Não deu para copiar';
      setTimeout(() => { btn.textContent = old; }, 2500);
    }
  }

  // ---------- teclado nos menus ----------
  onKey(e) {
    if (e.key === 'Tab') this.tabNav = true;
    if (e.repeat) return;
    const k = e.key;
    // campo de texto: Enter envia o que o campo pede; Esc só tira o foco do campo (não troca de
    // tela nem apaga o que foi digitado); as outras teclas são do campo
    const inp = e.target.closest?.('input:not([type=range]), textarea');
    if (inp) {
      if (k === 'Escape') {
        e.preventDefault();
        inp.blur();
      } else if (k === 'Enter') {
        if (inp.id === 'room-code' || inp.id === 'room-name') this.joinRoom();
        else if (inp.id === 'room-new-name') this.createRoom();
        else if (inp.classList.contains('nick-input')) this.saveNick(inp);
        else return;
        e.preventDefault();
      }
      return;
    }
    // botão focado pelo Tab: Enter/Espaço acionam o próprio botão
    // (no cartão do cientista, Enter continua sendo "correr")
    const f = document.activeElement;
    if ((k === 'Enter' || k === ' ') && this.tabNav && f && f.matches('button, a[href]') && !f.classList.contains('char-card') && f.closest('#screen-' + this.current)) {
      if (k === ' ') {
        e.preventDefault(); // o input.js bloqueia o Espaço nativo: clica aqui
        f.click();
      }
      return;
    }
    if (this.current === 'title' && (k === 'Enter' || k === ' ')) {
      e.preventDefault();
      this.action('play');
    } else if (this.current === 'select') {
      // dois jogadores: WASD move o J1 e as setas movem o J2 (com 1 jogador, os dois movem o mesmo)
      const p2 = this.duo() && k.startsWith('Arrow') ? 1 : 0;
      // letras pela posição física da tecla (e.code), como na corrida: vale em AZERTY e em outros alfabetos
      const c = e.code;
      if (k === 'ArrowLeft' || c === 'KeyA') this.moveSelection(-1, 0, p2);
      else if (k === 'ArrowRight' || c === 'KeyD') this.moveSelection(1, 0, p2);
      else if (k === 'ArrowUp' || c === 'KeyW') this.moveSelection(0, -1, p2);
      else if (k === 'ArrowDown' || c === 'KeyS') this.moveSelection(0, 1, p2);
      else if (k === 'Enter' || k === ' ') this.action('start');
      else if (k === 'Escape') this.action('back');
      else if (c === 'KeyQ') this.cycleOpt('cc', -1);
      else if (c === 'KeyE') this.cycleOpt('cc', 1);
      else if (c === 'KeyZ') this.cycleOpt('laps', -1);
      else if (c === 'KeyX') this.cycleOpt('laps', 1);
      else return;
      e.preventDefault();
    } else if (this.current === 'howto' && (k === 'Escape' || k === 'Enter')) {
      this.action('back');
    } else if ((this.current === 'net' || this.current === 'online' || this.current === 'turma') && k === 'Escape') {
      this.action('back');
    } else if (this.current === 'results' && k === 'Enter' && !e.target.closest?.('input')) {
      this.action('restart');
    } else if (this.current === 'results' && k === 'Escape') {
      this.action('quit');
    } else if (this.current === 'pause' && k === 'Enter' && !this.tabNav) {
      this.action('resume');
    }
  }

  // Botão "confirmar" do controle (gamepad) nas telas.
  confirm() {
    if (this.current === 'title') this.action('play');
    else if (this.current === 'select') this.action('start');
    else if (this.current === 'howto') this.action('back');
    else if (this.current === 'pause') this.action('resume');
    else if (this.current === 'results' && !this._resultsFresh()) this.action('restart');
  }
}
