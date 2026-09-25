// Telas de menu (DOM): inicial, escolha do cientista, como jogar, pausa e resultado.
import { CHARACTERS, CLASSES, ITEMS, RACE } from './config.js';
import { itemIconHTML } from './hud.js';
import { formatTime } from './race.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['loading', 'title', 'select', 'howto', 'pause', 'results', 'error'];
const FLAGS = { Inglaterra: '🇬🇧', 'Polônia / França': '🇵🇱', Rússia: '🇷🇺', Alemanha: '🇩🇪', Itália: '🇮🇹', Brasil: '🇧🇷' };
const STAT_LABELS = [['speed', 'Velocidade'], ['accel', 'Aceleração'], ['handling', 'Controle'], ['weight', 'Peso']];

const store = {
  get(k, def) {
    try {
      const v = localStorage.getItem('corrida-' + k);
      return v === null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('corrida-' + k, JSON.stringify(v));
    } catch {
      /* armazenamento indisponível */
    }
  },
};
export { store };

export class Menu {
  // handlers: { onStart(opts), onResume, onRestart, onQuit, onToggleSound, onToggleQuality, onToggleAuto, sfx(name) }
  constructor(handlers) {
    this.h = handlers;
    this.current = 'loading';
    this.prev = 'title';
    this.portraits = {};
    this.opts = {
      character: store.get('character', 'newton'),
      cc: store.get('cc', '100cc'),
      laps: store.get('laps', RACE.defaultLaps),
    };
    if (!CHARACTERS.some((c) => c.id === this.opts.character)) this.opts.character = 'newton';
    if (!CLASSES[this.opts.cc]) this.opts.cc = '100cc';
    if (!RACE.lapOptions.includes(this.opts.laps)) this.opts.laps = RACE.defaultLaps;

    this.buildSelect();
    this.buildHowto();

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this.action(btn.dataset.action);
    });
    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  action(a) {
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
        h.onStart({ ...this.opts });
        break;
      case 'resume':
        h.onResume();
        break;
      case 'restart':
        h.sfx('menuSelect');
        h.onRestart();
        break;
      case 'quit':
        h.sfx('menuMove');
        h.onQuit();
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
  }

  hideAll() {
    this.current = null;
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
    $('btn-quality').textContent = `⚙️ Gráficos: ${q}`;
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
      (c) => `<button class="char-card" data-id="${c.id}" style="--c:${c.colors.ui}">
        <span class="flag">${FLAGS[c.country] || ''}</span>
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

    const cc = $('opt-cc');
    cc.innerHTML = Object.values(CLASSES)
      .map((c) => `<button data-cc="${c.id}">${c.label}<small>${c.hint}</small></button>`)
      .join('');
    cc.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.opts.cc = b.dataset.cc;
      this.h.sfx('menuMove');
      this.refreshSelect();
    });

    const laps = $('opt-laps');
    laps.innerHTML = RACE.lapOptions.map((n) => `<button data-laps="${n}">${n}</button>`).join('');
    laps.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.opts.laps = Number(b.dataset.laps);
      this.h.sfx('menuMove');
      this.refreshSelect();
    });
  }

  refreshSelect() {
    const c = CHARACTERS.find((x) => x.id === this.opts.character);
    for (const card of this.grid.children) card.classList.toggle('selected', card.dataset.id === c.id);
    for (const b of $('opt-cc').children) b.classList.toggle('on', b.dataset.cc === this.opts.cc);
    for (const b of $('opt-laps').children) b.classList.toggle('on', Number(b.dataset.laps) === this.opts.laps);

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
    $('detail-meta').textContent = `${c.years} · ${FLAGS[c.country] || ''} ${c.country} · ${c.field}`;
    $('detail-bio').textContent = c.bio;
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
  showResults(results, player) {
    const me = results.find((r) => r.kart === player);
    const place = me ? me.place : 0;
    $('results-title').textContent = place === 1 ? 'Você venceu! 🏆' : `Você chegou em ${place}º lugar`;
    $('results-list').innerHTML = results
      .map(
        (r) => `<li class="${r.kart === player ? 'me' : ''}">
          <span class="p">${r.place}º</span>
          <span class="dot" style="background:${r.kart.character.colors.ui}"></span>
          <span>${r.kart.character.name}${r.kart === player ? ' (você)' : ''}</span>
          <span class="t">${r.estimated ? '~' : ''}${formatTime(r.time)}</span>
        </li>`,
      )
      .join('');
    const winner = results[0].kart.character;
    const mine = player.character;
    let html = `<b>Você sabia? Sobre ${winner.name}, o vencedor:</b> ${winner.fact}`;
    if (mine.id !== winner.id) html += `<br><br><b>E sobre ${mine.name}:</b> ${mine.fact}`;
    $('results-fact').innerHTML = html;
    this.show('results');
  }

  // ---------- teclado nos menus ----------
  onKey(e) {
    if (e.repeat) return;
    const k = e.key;
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
      else return;
      e.preventDefault();
    } else if (this.current === 'howto' && (k === 'Escape' || k === 'Enter')) {
      this.action('back');
    } else if (this.current === 'results' && k === 'Enter') {
      this.action('restart');
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
