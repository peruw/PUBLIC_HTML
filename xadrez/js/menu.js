// Telas DOM: carregando, título, configuração, como jogar, pausa/menu, fim de jogo, promoção.
import { DIFFICULTY, STORE_PREFIX } from './config.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(STORE_PREFIX + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(STORE_PREFIX + k, JSON.stringify(v)); } catch (_) { /* ignora */ } },
};

export class Menu {
  constructor({ onStart, onResume, onRestart, onQuit }) {
    this.screens = {};
    for (const el of document.querySelectorAll('.screen')) this.screens[el.dataset.screen] = el;
    this.opts = {
      mode: store.get('mode', 'cpu'),
      level: store.get('level', 2),
      color: store.get('color', 'w'),
      rotate: store.get('rotate', true),
      style: store.get('style', 'classic'),
    };
    this.onStart = onStart;

    $('btn-play-cpu').addEventListener('click', () => { this.opts.mode = 'cpu'; this.show('setup'); this._syncSetup(); });
    $('btn-play-2p').addEventListener('click', () => { this.opts.mode = '2p'; this.show('setup'); this._syncSetup(); });
    $('btn-howto').addEventListener('click', () => this.show('howto'));
    $('btn-howto-back').addEventListener('click', () => this.show('title'));
    $('btn-setup-back').addEventListener('click', () => this.show('title'));
    $('btn-setup-start').addEventListener('click', () => {
      store.set('mode', this.opts.mode); store.set('level', this.opts.level); store.set('color', this.opts.color); store.set('rotate', this.opts.rotate); store.set('style', this.opts.style);
      this.hide();
      onStart({ ...this.opts });
    });
    const levels = $('setup-levels');
    for (const d of DIFFICULTY) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = `${d.level} · ${d.name}`;
      b.dataset.level = d.level;
      b.addEventListener('click', () => { this.opts.level = d.level; this._syncSetup(); });
      levels.appendChild(b);
    }
    for (const b of document.querySelectorAll('.chip[data-color]')) {
      b.addEventListener('click', () => { this.opts.color = b.dataset.color; this._syncSetup(); });
    }
    for (const b of document.querySelectorAll('.chip[data-style]')) {
      b.addEventListener('click', () => { this.opts.style = b.dataset.style; this._syncSetup(); });
    }
    $('setup-rotate').addEventListener('change', (e) => { this.opts.rotate = e.target.checked; });

    $('btn-pause-resume').addEventListener('click', () => { this.hide(); onResume(); });
    $('btn-pause-restart').addEventListener('click', () => { this.hide(); onRestart(); });
    $('btn-pause-quit').addEventListener('click', () => { this.show('title'); onQuit(); });
    $('btn-over-again').addEventListener('click', () => { this.hide(); onRestart(); });
    $('btn-over-menu').addEventListener('click', () => { this.show('title'); onQuit(); });
  }

  _syncSetup() {
    $('setup-title').textContent = this.opts.mode === 'cpu' ? 'Contra o computador' : 'Dois jogadores';
    $('setup-cpu-only').classList.toggle('hidden', this.opts.mode !== 'cpu');
    $('setup-2p-only').classList.toggle('hidden', this.opts.mode !== '2p');
    for (const b of document.querySelectorAll('#setup-levels .chip')) b.classList.toggle('active', +b.dataset.level === this.opts.level);
    for (const b of document.querySelectorAll('.chip[data-color]')) b.classList.toggle('active', b.dataset.color === this.opts.color);
    for (const b of document.querySelectorAll('.chip[data-style]')) b.classList.toggle('active', b.dataset.style === this.opts.style);
    $('setup-rotate').checked = !!this.opts.rotate;
  }

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
    $('screens').classList.remove('hidden');
  }
  hide() {
    for (const el of Object.values(this.screens)) el.classList.add('hidden');
    $('screens').classList.add('hidden');
  }

  setLoading(text) { $('loading-text').textContent = text; }

  showGameOver({ title, detail }) {
    $('over-title').textContent = title;
    $('over-detail').textContent = detail;
    this.show('gameover');
  }

  // Popup de promoção: resolve com 'q' | 'r' | 'b' | 'n'
  askPromotion(color) {
    return new Promise((resolve) => {
      const el = $('promo');
      el.classList.remove('hidden');
      el.dataset.color = color;
      const done = (e) => {
        const t = e.target.closest('[data-piece]');
        if (!t) return;
        el.removeEventListener('click', done);
        el.classList.add('hidden');
        resolve(t.dataset.piece);
      };
      el.addEventListener('click', done);
    });
  }
}
