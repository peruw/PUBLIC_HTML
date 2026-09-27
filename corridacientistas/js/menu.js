// Telas de menu (DOM): inicial, escolha do cientista, como jogar, pausa e resultado.
import { CHARACTERS, CLASSES, ITEMS, RACE } from './config.js';
import { itemIconHTML } from './hud.js';
import { formatTime } from './race.js';
import { SCIENTIST_FACTS, pickFact, shuffledQuiz } from './facts.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['loading', 'title', 'select', 'howto', 'pause', 'results', 'error'];
// Bandeiras em SVG (emoji de bandeira vira letras no Windows).
const svgFlag = (body, vb = '0 0 30 20') => `<svg viewBox="${vb}" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`;
const hStripes = (...cs) => cs.map((c, i) => `<rect y="${(i * 20) / cs.length}" width="30" height="${20 / cs.length}" fill="${c}"/>`).join('');
const vStripes = (...cs) => cs.map((c, i) => `<rect x="${i * 10}" width="10" height="20" fill="${c}"/>`).join('');
const FLAGS = {
  Inglaterra: svgFlag(
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
  Itália: svgFlag(vStripes('#009246', '#fff', '#ce2b37')),
  Brasil: svgFlag(
    '<rect width="30" height="20" fill="#009c3b"/><path d="M15 2L27.5 10L15 18L2.5 10Z" fill="#ffdf00"/>' +
      '<circle cx="15" cy="10" r="4.6" fill="#002776"/><path d="M10.6 9.2Q15 7.6 19.5 10.8" stroke="#fff" stroke-width="1" fill="none"/>',
  ),
};
const STAT_LABELS = [['speed', 'Velocidade'], ['accel', 'Aceleração'], ['handling', 'Controle'], ['weight', 'Peso']];

const store = {
  get(k, def) {
    try {
      const v = localStorage.getItem('kartcientifico-' + k);
      return v === null ? def : JSON.parse(v);
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
    };
    if (this.opts.mode !== 'timetrial') this.opts.mode = 'race';
    if (!CHARACTERS.some((c) => c.id === this.opts.character)) this.opts.character = 'newton';
    if (!CLASSES[this.opts.cc] || (this.opts.cc === '150cc' && !is150Unlocked())) this.opts.cc = CLASSES[this.opts.cc] ? '100cc' : '50cc';
    if (!RACE.lapOptions.includes(this.opts.laps)) this.opts.laps = RACE.defaultLaps;

    // quem já jogava em 150cc (antes do cadeado) fica com ele liberado de vez
    if (store.get('cc', '') === '150cc') store.set('unlock150', true);
    this.tabNav = false; // foco veio do Tab (não do mouse/toque)
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
      case 'start':
        h.sfx('menuSelect');
        store.set('character', this.opts.character);
        store.set('cc', this.opts.cc);
        store.set('laps', this.opts.laps);
        store.set('mode', this.opts.mode);
        h.onStart({ ...this.opts });
        break;
      case 'daily':
        h.sfx('menuSelect');
        h.onDaily?.();
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

  show(name) {
    if (name !== this.current) this.prev = this.current;
    this.current = name;
    for (const s of SCREENS) $('screen-' + s)?.classList.toggle('hidden', s !== name);
    if (name === 'select') this.refreshSelect();
    if (name === 'title') this.refreshTitle();
    this.h.onScreen?.(name);
    // teclado: foco no botão principal da tela (pausa e resultado)
    if (name === 'results') requestAnimationFrame(() => $('screen-results')?.querySelector('.btn-primary')?.focus({ preventScroll: true }));
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
        <span>${c.short || c.name}</span>
      </button>`,
    ).join('');
    this.grid.addEventListener('click', (e) => {
      const card = e.target.closest('.char-card');
      if (!card) return;
      if (this.opts.character !== card.dataset.id) this.h.sfx('menuMove');
      this.opts.character = card.dataset.id;
      this.refreshSelect();
    });
    this.grid.addEventListener('dblclick', (e) => {
      if (e.target.closest('.char-card')) this.action('start');
    });
    // Tab num cartão já escolhe o cientista (a ficha acompanha o foco)
    this.grid.addEventListener('focusin', (e) => {
      const card = e.target.closest('.char-card');
      if (!card || !this.tabNav || card.dataset.id === this.opts.character) return;
      this.opts.character = card.dataset.id;
      this.h.sfx('menuMove');
      this.refreshSelect();
    });

    const cc = $('opt-cc');
    cc.innerHTML = Object.values(CLASSES)
      .map((c) => `<button data-cc="${c.id}">${c.label}<small>${c.hint}</small></button>`)
      .join('');
    cc.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
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
      if (!b) return;
      this.opts.laps = Number(b.dataset.laps);
      this.h.sfx('menuMove');
      this.refreshSelect();
    });

    const mode = $('opt-mode');
    if (mode) {
      mode.innerHTML = '<button data-mode="race">Corrida<small>8 karts</small></button><button data-mode="timetrial">Contra o relógio<small>com fantasma</small></button>';
      mode.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        this.opts.mode = b.dataset.mode;
        this.h.sfx('menuMove');
        this.refreshSelect();
      });
    }
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
    const c = CHARACTERS.find((x) => x.id === this.opts.character);
    for (const card of this.grid.children) card.classList.toggle('selected', card.dataset.id === c.id);
    for (const b of $('opt-cc').children) b.classList.toggle('on', b.dataset.cc === this.opts.cc);
    for (const b of $('opt-laps').children) b.classList.toggle('on', Number(b.dataset.laps) === this.opts.laps);
    for (const b of $('opt-mode')?.children || []) b.classList.toggle('on', b.dataset.mode === this.opts.mode);
    const unlocked = is150Unlocked();
    for (const b of $('opt-cc').children) {
      const locked = b.dataset.cc === '150cc' && !unlocked;
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
      card.querySelector('.medals').innerHTML = Object.keys(CLASSES).map((cc) => (m[cc] ? `<i title="${cc}">${MEDAL_ICON[m[cc]]}</i>` : '')).join('');
      got += Object.keys(m).length;
    }
    const total = CHARACTERS.length * Object.keys(CLASSES).length;
    const tro = $('select-trophies');
    if (tro) tro.textContent = got ? `🏆 ${got}/${total}` : '';
    // recorde da combinação escolhida
    const note = $('select-note');
    if (note && !note.classList.contains('warn')) {
      const rec = store.get('records', {})[`${this.opts.mode === 'timetrial' ? 'tt-' : ''}${this.opts.cc}-${this.opts.laps}`];
      const v = this.opts.laps === 1 ? '1 volta' : `${this.opts.laps} voltas`;
      note.textContent = rec ? `Seu recorde (${this.opts.cc}, ${v}): ${formatTime(rec.time)}` : this.opts.mode === 'timetrial' ? 'Sozinho na pista, só com foguetes. Bata o seu fantasma!' : '';
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
      const f = pickFact('sci:' + c.id, SCIENTIST_FACTS[c.id]);
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

  moveSelection(dx, dy) {
    const i = CHARACTERS.findIndex((x) => x.id === this.opts.character);
    const cols = 4;
    let n = i + dx + dy * cols;
    n = (n + CHARACTERS.length) % CHARACTERS.length;
    this.opts.character = CHARACTERS[n].id;
    this.h.sfx('menuMove');
    this.refreshSelect();
    // com foco de Tab num cartão, o foco acompanha a seleção
    if (this.tabNav && document.activeElement?.classList.contains('char-card')) {
      this.grid.querySelector(`[data-id="${this.opts.character}"]`)?.focus();
    }
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
      parts.push(d < 0 ? `⚔️ Você venceu o rival ${n} por ${Math.abs(d).toFixed(1).replace('.', ',')} s` : `⚔️ O rival ${n} chegou ${d.toFixed(1).replace('.', ',')} s na sua frente`);
    }
    if (info.medal) parts.push(`${MEDAL_ICON[info.medal.type]} Medalha de ${info.medal.type} com ${player.character.name} no ${info.cc}!`);
    if (info.unlocked150) parts.push('🔓 150cc liberado!');
    if (info.daily) parts.push(info.daily.done ? '⭐ Desafio do dia cumprido!' : `⭐ Desafio do dia: ${esc(info.daily.goal)}`);
    recEl.classList.toggle('hidden', !parts.length);
    recEl.innerHTML = parts.join(' · ');
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
    const what = r.mode === 'timetrial' ? `fiz ${formatTime(r.time)} no contra o relógio` : `cheguei em ${r.place}º lugar${r.estimated ? '' : ` em ${formatTime(r.time)}`}`;
    const text = `No Kart Científico, ${what} com ${r.character.name} (${r.cc}, ${v})! Você consegue?`;
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
      .map((e, i) => `<li class="${i === idx ? 'me' : ''}"><span>${i + 1}º</span><span>${i === idx && !e.name ? `<input id="rank-name" maxlength="14" placeholder="Seu nome" value="${esc(store.get('nick', ''))}" aria-label="Seu nome no ranking" /><button class="btn btn-small" id="rank-save">Salvar</button>` : esc(e.name || 'Jogador')}</span><span class="t">${formatTime(e.time)}</span></li>`)
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

  // ---------- teclado nos menus ----------
  onKey(e) {
    if (e.key === 'Tab') this.tabNav = true;
    if (e.repeat) return;
    const k = e.key;
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
      if (k === 'ArrowLeft' || k === 'a') this.moveSelection(-1, 0);
      else if (k === 'ArrowRight' || k === 'd') this.moveSelection(1, 0);
      else if (k === 'ArrowUp' || k === 'w') this.moveSelection(0, -1);
      else if (k === 'ArrowDown' || k === 's') this.moveSelection(0, 1);
      else if (k === 'Enter' || k === ' ') this.action('start');
      else if (k === 'Escape') this.action('back');
      else if (k === 'q' || k === 'Q') this.cycleOpt('cc', -1);
      else if (k === 'e' || k === 'E') this.cycleOpt('cc', 1);
      else if (k === 'z' || k === 'Z') this.cycleOpt('laps', -1);
      else if (k === 'x' || k === 'X') this.cycleOpt('laps', 1);
      else return;
      e.preventDefault();
    } else if (this.current === 'howto' && (k === 'Escape' || k === 'Enter')) {
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
    else if (this.current === 'results') this.action('restart');
  }
}
