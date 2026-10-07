// Telas DOM: carregando, título, configuração, como jogar, pausa/menu, fim de jogo, confirmação, promoção.
import { DIFFICULTY, STORE_PREFIX } from './config.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(STORE_PREFIX + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(STORE_PREFIX + k, JSON.stringify(v)); } catch (_) { /* ignora */ } },
};

export class Menu {
  constructor({ onStart, onResume, onRestart, onQuit, onResign, onOnlineCreate, onOnlineJoin, onOnlineCancel }) {
    this.screens = {};
    this.current = null;        // tela visível (ou null)
    this._confirmDone = null;
    for (const el of document.querySelectorAll('.screen')) this.screens[el.dataset.screen] = el;
    this.opts = {
      mode: store.get('mode', 'cpu'),
      level: store.get('level', 2),
      color: store.get('color', 'w'),
      rotate: store.get('rotate', true),
      style: store.get('style', 'classic'),
      onlineColor: store.get('onlineColor', 'w'),
    };
    this.onStart = onStart;
    addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const back = { setup: 'btn-setup-back', howto: 'btn-howto-back', online: 'btn-online-back', pause: 'btn-pause-resume', confirm: 'btn-confirm-no' }[this.current];
      if (back) $(back).click();
    });

    $('btn-play-cpu').addEventListener('click', () => { this.opts.mode = 'cpu'; this.show('setup'); this._syncSetup(); });
    $('btn-play-2p').addEventListener('click', () => { this.opts.mode = '2p'; this.show('setup'); this._syncSetup(); });
    $('btn-howto').addEventListener('click', () => this.show('howto'));
    // ---- online ----
    $('btn-play-online').addEventListener('click', () => { this.resetOnline(); this.show('online'); });
    for (const b of document.querySelectorAll('.chip[data-ocolor]')) {
      b.addEventListener('click', () => { this.opts.onlineColor = b.dataset.ocolor; store.set('onlineColor', b.dataset.ocolor); this._syncOnline(); });
    }
    $('btn-online-create').addEventListener('click', () => { this._busy(true); onOnlineCreate(this.opts.onlineColor); });
    const codeIn = $('online-code-input');
    codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
    const join = () => {
      const code = codeIn.value.trim();
      if (code.length !== 5) { this.setOnlineStatus('O código tem 5 letras/números.', true); return; }
      this._busy(true); onOnlineJoin(code);
    };
    $('btn-online-join').addEventListener('click', join);
    codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('btn-online-copy').addEventListener('click', async () => {
      const url = location.origin + location.pathname + '?sala=' + this.onlineCode;
      const text = `Bora jogar xadrez? Entre em ${url} ou use o código ${this.onlineCode}.`;
      try { await navigator.clipboard.writeText(text); this.setOnlineStatus('Convite copiado! Mande para o seu amigo.'); }
      catch { this.setOnlineStatus('Mande este código para o seu amigo: ' + this.onlineCode); }
    });
    $('btn-online-back').addEventListener('click', () => { onOnlineCancel(); this.show('title'); });
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
    $('btn-pause-resign').addEventListener('click', () => onResign());
    $('btn-over-again').addEventListener('click', () => { this.hide(); onRestart(); });
    $('btn-over-view').addEventListener('click', () => this.hide());
    $('btn-over-menu').addEventListener('click', () => { this.show('title'); onQuit(); });
    $('btn-confirm-yes').addEventListener('click', () => this._confirmDone && this._confirmDone(true));
    $('btn-confirm-no').addEventListener('click', () => this._confirmDone && this._confirmDone(false));
  }

  _syncOnline() {
    for (const b of document.querySelectorAll('.chip[data-ocolor]')) b.classList.toggle('active', b.dataset.ocolor === this.opts.onlineColor);
    this._pressed();
  }
  _busy(v) { $('btn-online-create').disabled = v; $('btn-online-join').disabled = v; }
  resetOnline(code = '') {
    $('online-choose').classList.remove('hidden');
    $('online-wait').classList.add('hidden');
    $('online-code-input').value = code;
    this.setOnlineStatus('');
    this._busy(false);
    this._syncOnline();
  }
  showOnlineCode(code) {
    this.onlineCode = code;
    $('online-code').textContent = code;
    $('online-choose').classList.add('hidden');
    $('online-wait').classList.remove('hidden');
    this.setOnlineStatus('Esperando o seu amigo entrar…');
  }
  setOnlineStatus(text, error = false) {
    const el = $('online-status');
    el.textContent = text || '';
    el.classList.toggle('error', !!error);
    if (error) this._busy(false);
  }

  _syncSetup() {
    $('setup-title').textContent = this.opts.mode === 'cpu' ? 'Contra o computador' : 'Dois jogadores';
    $('setup-cpu-only').classList.toggle('hidden', this.opts.mode !== 'cpu');
    $('setup-2p-only').classList.toggle('hidden', this.opts.mode !== '2p');
    for (const b of document.querySelectorAll('#setup-levels .chip')) b.classList.toggle('active', +b.dataset.level === this.opts.level);
    for (const b of document.querySelectorAll('.chip[data-color]')) b.classList.toggle('active', b.dataset.color === this.opts.color);
    for (const b of document.querySelectorAll('.chip[data-style]')) b.classList.toggle('active', b.dataset.style === this.opts.style);
    $('setup-rotate').checked = !!this.opts.rotate;
    this._pressed();
  }
  _pressed() {
    for (const b of document.querySelectorAll('.chip')) b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false');
  }

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
    $('screens').classList.remove('hidden');
    this.current = name;
    const first = this.screens[name] && this.screens[name].querySelector('.btn.primary:not(:disabled), .btn:not(:disabled)');
    if (first && name !== 'loading') first.focus({ preventScroll: true });
  }
  hide() {
    for (const el of Object.values(this.screens)) el.classList.add('hidden');
    $('screens').classList.add('hidden');
    this.current = null;
  }

  setLoading(text) { $('loading-text').textContent = text; }

  showGameOver({ title, detail }) {
    $('over-title').textContent = title;
    $('over-detail').textContent = detail;
    this.show('gameover');
  }

  // Pergunta sim/não numa tela própria; ao responder, volta para a tela que estava aberta (ou para o jogo).
  confirm({ title, text = '', yes = 'Sim', no = 'Cancelar' }) {
    if (this._confirmDone) this._confirmDone(false);
    const prev = this.current;
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('btn-confirm-yes').textContent = yes;
    $('btn-confirm-no').textContent = no;
    this.show('confirm');
    return new Promise((resolve) => {
      this._confirmDone = (v) => {
        this._confirmDone = null;
        if (this.current === 'confirm') { if (prev && prev !== 'confirm') this.show(prev); else this.hide(); }
        resolve(v);
      };
    });
  }
  closeConfirm() { if (this._confirmDone) this._confirmDone(false); }

  // Popup de promoção: resolve com 'q' | 'r' | 'b' | 'n', ou null se cancelar (botão, Esc ou toque fora).
  askPromotion(color) {
    return new Promise((resolve) => {
      const el = $('promo');
      el.classList.remove('hidden');
      el.dataset.color = color;
      const finish = (v) => {
        el.removeEventListener('click', onClick);
        removeEventListener('keydown', onKey);
        el.classList.add('hidden');
        resolve(v);
      };
      const onClick = (e) => {
        const t = e.target.closest('[data-piece]');
        if (t) finish(t.dataset.piece);
        else if (e.target === el || e.target.closest('[data-cancel]')) finish(null);
      };
      const onKey = (e) => { if (e.key === 'Escape') finish(null); };
      el.addEventListener('click', onClick);
      addEventListener('keydown', onKey);
    });
  }
}
