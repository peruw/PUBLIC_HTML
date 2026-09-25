// Entrada: teclado, gamepad (mapeamento padrão) e toque (botões na tela).
// poll() junta tudo; useItem, pause, mute e confirm são pulsos de 1 leitura.

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'drift',
  KeyE: 'item', KeyX: 'item', ShiftLeft: 'item', ShiftRight: 'item',
  KeyC: 'look',
  Escape: 'pause', KeyP: 'pause',
  KeyM: 'mute',
  Enter: 'confirm', NumpadEnter: 'confirm',
};
// teclas que rolariam a página
const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
const DEADZONE = 0.2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const btnOn = (b, n) => !!(b[n] && b[n].pressed);
const btnVal = (b, n) => (b[n] ? (typeof b[n].value === 'number' && b[n].value > 0 ? b[n].value : b[n].pressed ? 1 : 0) : 0);

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

const STYLE_ID = 'tc-style';
const CSS = `
.tc-root{position:fixed;inset:0;z-index:25;pointer-events:none;user-select:none;-webkit-user-select:none;
  -webkit-touch-callout:none;touch-action:none;font-family:'Fredoka','Trebuchet MS',system-ui,sans-serif}
.tc-root.tc-hidden{display:none}
.tc-zone{position:absolute;pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent}
.tc-btn{position:absolute;display:grid;place-items:center;border-radius:50%;color:#fff;font-weight:700;
  letter-spacing:.5px;line-height:1;text-align:center;background:rgba(18,26,60,.38);
  border:3px solid rgba(255,255,255,.55);box-shadow:0 4px 14px rgba(0,0,0,.28),inset 0 0 0 2px rgba(255,255,255,.08);
  text-shadow:0 2px 3px rgba(0,0,0,.6);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);
  transition:transform .06s ease,background .1s ease,border-color .1s ease;pointer-events:none;box-sizing:border-box}
.tc-btn small{display:block;font-size:11px;text-transform:uppercase;font-weight:600;opacity:.85;margin-top:3px;letter-spacing:0}
.tc-btn.tc-on{transform:scale(.92);background:rgba(255,255,255,.38);border-color:#fff}
.tc-steer{width:clamp(78px,22vmin,94px);height:clamp(78px,22vmin,94px);font-size:clamp(34px,10vmin,44px);border-radius:26px}
.tc-drift{width:clamp(88px,25vmin,104px);height:clamp(88px,25vmin,104px);font-size:clamp(17px,5vmin,21px);
  border-color:rgba(255,190,90,.8);background:rgba(120,60,10,.34)}
.tc-drift.tc-on{background:rgba(255,160,40,.55);border-color:#ffd9a0}
.tc-item{width:clamp(66px,19vmin,78px);height:clamp(66px,19vmin,78px);font-size:clamp(15px,4.4vmin,18px);
  border-color:rgba(255,220,90,.85);background:rgba(110,90,10,.32)}
.tc-item.tc-on{background:rgba(255,210,63,.55)}
.tc-brake{width:clamp(56px,16vmin,66px);height:clamp(56px,16vmin,66px);font-size:clamp(12px,3.6vmin,14px);
  border-color:rgba(255,120,120,.8);background:rgba(110,20,20,.32)}
.tc-brake.tc-on{background:rgba(255,80,80,.55)}
.tc-gas{width:clamp(70px,20vmin,84px);height:clamp(70px,20vmin,84px);font-size:clamp(24px,7vmin,30px);
  border-color:rgba(120,255,160,.8);background:rgba(10,90,40,.32)}
.tc-gas.tc-on{background:rgba(90,230,130,.55)}
`;

// Área de toque = botão + margem generosa
const PAD = 14;

export class Input {
  constructor({ touchLayer = null, bus = null } = {}) {
    this.bus = bus;
    this.touchLayer = touchLayer;
    this.lastDevice = 'keyboard';
    this._autoAccelerate = false;
    this._touchWanted = false;
    this._countdown = false;

    this.state = { throttle: 0, brake: 0, steer: 0, drift: false, useItem: false, lookBack: false, pause: false, mute: false, confirm: false };

    // teclado
    this._keys = { up: false, down: false, left: false, right: false, drift: false, look: false };
    this._steerOrder = 0; // -1/1: última direção apertada
    this._kbPulse = { item: false, pause: false, mute: false, confirm: false };
    this._downCodes = new Set();

    // gamepad
    this._padPrev = new Map(); // índice -> bitmask de botões
    this._padPulse = { item: false, pause: false, mute: false, confirm: false };

    // toque
    this._touch = { left: false, right: false, drift: false, item: false, brake: false, gas: false };
    this._touchPulse = { item: false };
    this._steerPointers = []; // [{ id, side }]
    this._btnPointers = new Map(); // pointerId -> nome do botão
    this._safe = { left: 0, right: 0, bottom: 0 };
    this._steerMid = 0;

    this._onKeyDown = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onBlur = () => this._releaseAll();
    this._onVis = () => {
      if (document.hidden) this._releaseAll();
    };
    this._onAnyPointer = (e) => {
      if (e.pointerType === 'touch') {
        this.lastDevice = 'touch';
        if (!this._touchEnabled) this.touchEnabled = true;
      }
    };
    addEventListener('keydown', this._onKeyDown);
    addEventListener('keyup', this._onKeyUp);
    addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onVis);
    addEventListener('pointerdown', this._onAnyPointer, true);

    this._offs = [];
    if (bus?.on) {
      // durante a contagem a aceleração automática espera o jogador (largada-foguete)
      this._offs.push(bus.on('race:countdown', () => (this._countdown = true)));
      this._offs.push(bus.on('race:go', () => (this._countdown = false)));
    }

    let coarse = false;
    try {
      coarse = matchMedia('(pointer: coarse)').matches;
    } catch {
      coarse = false;
    }
    this._touchEnabled = coarse;
    this._autoAccelerate = coarse;
    this._buildTouch();
    this._applyTouchVisibility();
  }

  // ---------- API ----------
  get touchEnabled() {
    return this._touchEnabled;
  }

  set touchEnabled(v) {
    this._touchEnabled = !!v;
    this._applyTouchVisibility();
  }

  get autoAccelerate() {
    return this._autoAccelerate;
  }

  setAutoAccelerate(on) {
    this._autoAccelerate = !!on;
    if (this._gasBtn) this._gasBtn.style.display = this._autoAccelerate ? 'none' : '';
    this._layout();
  }

  showTouch(on) {
    this._touchWanted = !!on;
    this._applyTouchVisibility();
  }

  poll() {
    const st = this.state;
    const k = this._keys;
    const t = this._touch;
    this._pollGamepads();
    const g = this._pad;

    // direção: a última tecla apertada vence
    let kSteer = 0;
    if (k.left && k.right) kSteer = this._steerOrder;
    else if (k.left) kSteer = -1;
    else if (k.right) kSteer = 1;
    let tSteer = 0;
    if (this._steerPointers.length) tSteer = this._steerPointers[this._steerPointers.length - 1].side;

    let steer = kSteer;
    if (Math.abs(g.steer) > Math.abs(steer)) steer = g.steer;
    if (Math.abs(tSteer) > Math.abs(steer)) steer = tSteer;

    let brake = Math.max(k.down ? 1 : 0, g.brake, t.brake ? 1 : 0);
    let throttle = Math.max(k.up ? 1 : 0, g.throttle, t.gas ? 1 : 0);
    if (this._autoAccelerate) {
      const touchVisible = this._touchVisible();
      if (this._countdown) {
        // na contagem: segurar qualquer botão de toque acelera
        if (touchVisible && (t.drift || t.item || t.gas || this._steerPointers.length)) throttle = 1;
      } else if (brake < 0.5) throttle = 1;
      if (brake >= 0.5) throttle = 0;
    }

    st.throttle = throttle;
    st.brake = brake;
    st.steer = clamp(steer, -1, 1);
    st.drift = k.drift || g.drift || t.drift;
    st.lookBack = k.look || g.look;
    st.useItem = this._kbPulse.item || this._padPulse.item || this._touchPulse.item;
    st.pause = this._kbPulse.pause || this._padPulse.pause;
    st.mute = this._kbPulse.mute || this._padPulse.mute;
    st.confirm = this._kbPulse.confirm || this._padPulse.confirm;
    this._kbPulse.item = this._kbPulse.pause = this._kbPulse.mute = this._kbPulse.confirm = false;
    this._padPulse.item = this._padPulse.pause = this._padPulse.mute = this._padPulse.confirm = false;
    this._touchPulse.item = false;
    return st;
  }

  destroy() {
    removeEventListener('keydown', this._onKeyDown);
    removeEventListener('keyup', this._onKeyUp);
    removeEventListener('blur', this._onBlur);
    document.removeEventListener('visibilitychange', this._onVis);
    removeEventListener('pointerdown', this._onAnyPointer, true);
    for (const off of this._offs) off?.();
    this._root?.remove();
  }

  // ---------- teclado ----------
  _key(e, down) {
    const act = KEYMAP[e.code];
    if (!act) return;
    if (isEditable(e.target)) return;
    if (PREVENT.has(e.code)) e.preventDefault();
    this.lastDevice = 'keyboard';
    if (down) {
      if (e.repeat || this._downCodes.has(e.code)) return;
      this._downCodes.add(e.code);
    } else {
      this._downCodes.delete(e.code);
    }
    // mais de uma tecla pode mapear a mesma ação: só solta quando nenhuma está apertada
    const held = down || this._anyHeld(act);
    switch (act) {
      case 'left':
      case 'right':
        this._keys[act] = held;
        if (down) this._steerOrder = act === 'left' ? -1 : 1;
        break;
      case 'up':
      case 'down':
      case 'drift':
      case 'look':
        this._keys[act] = held;
        break;
      default:
        if (down) this._kbPulse[act] = true;
    }
  }

  _anyHeld(act) {
    for (const code of this._downCodes) if (KEYMAP[code] === act) return true;
    return false;
  }

  _releaseAll() {
    this._downCodes.clear();
    for (const key in this._keys) this._keys[key] = false;
    for (const key in this._touch) this._touch[key] = false;
    this._steerPointers.length = 0;
    this._btnPointers.clear();
    this._refreshTouchClasses();
  }

  // ---------- gamepad ----------
  _pollGamepads() {
    const g = this._pad || (this._pad = { throttle: 0, brake: 0, steer: 0, drift: false, look: false });
    g.throttle = 0;
    g.brake = 0;
    g.steer = 0;
    g.drift = false;
    g.look = false;
    let pads = null;
    try {
      pads = navigator.getGamepads ? navigator.getGamepads() : null;
    } catch {
      pads = null;
    }
    if (!pads) return;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || !p.connected) continue;
      const b = p.buttons;
      let ax = p.axes[0] || 0;
      ax = Math.abs(ax) < DEADZONE ? 0 : Math.sign(ax) * ((Math.abs(ax) - DEADZONE) / (1 - DEADZONE));
      if (btnOn(b, 14)) ax = -1;
      if (btnOn(b, 15)) ax = 1;
      const thr = Math.max(btnOn(b, 0) ? 1 : 0, btnVal(b, 7), btnOn(b, 12) ? 1 : 0);
      const brk = Math.max(btnOn(b, 1) ? 1 : 0, btnVal(b, 6), btnOn(b, 13) ? 1 : 0);
      const drift = btnOn(b, 5) || btnOn(b, 2);
      const look = btnOn(b, 11) || (p.axes[3] || 0) > 0.7;
      // bits de borda: 0 A (confirmar), 1 item (LB/Y), 2 Start, 3 Select
      const mask = (btnOn(b, 0) ? 1 : 0) | (btnOn(b, 4) || btnOn(b, 3) ? 2 : 0) | (btnOn(b, 9) ? 4 : 0) | (btnOn(b, 8) ? 8 : 0);
      const prev = this._padPrev.get(p.index) || 0;
      const edge = mask & ~prev;
      this._padPrev.set(p.index, mask);
      if (edge & 1) this._padPulse.confirm = true;
      if (edge & 2) this._padPulse.item = true;
      if (edge & 4) this._padPulse.pause = true;
      if (edge & 8) this._padPulse.mute = true;
      if (Math.abs(ax) > Math.abs(g.steer)) g.steer = ax;
      g.throttle = Math.max(g.throttle, thr);
      g.brake = Math.max(g.brake, brk);
      g.drift = g.drift || drift;
      g.look = g.look || look;
      if (mask || thr > 0.1 || brk > 0.1 || ax !== 0) this.lastDevice = 'gamepad';
    }
  }

  // ---------- toque ----------
  _buildTouch() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const root = document.createElement('div');
    root.className = 'tc-root tc-hidden';
    root.setAttribute('aria-hidden', 'true');
    (this.touchLayer || document.body).appendChild(root);
    this._root = root;

    const mk = (cls, html) => {
      const el = document.createElement('div');
      el.className = `tc-btn ${cls}`;
      el.innerHTML = html;
      root.appendChild(el);
      return el;
    };
    this._btn = {
      left: mk('tc-steer', '◀'),
      right: mk('tc-steer', '▶'),
      drift: mk('tc-drift', '<span>DRIFT<small>pular</small></span>'),
      item: mk('tc-item', 'ITEM'),
      brake: mk('tc-brake', 'FREIO'),
      gas: mk('tc-gas', '<span>▲<small>acelerar</small></span>'),
    };
    this._gasBtn = this._btn.gas;
    this._gasBtn.style.display = this._autoAccelerate ? 'none' : '';

    // zonas de toque (invisíveis, maiores que os botões)
    this._steerZone = this._zone('steer');
    this._zones = {
      drift: this._zone('drift'),
      item: this._zone('item'),
      brake: this._zone('brake'),
      gas: this._zone('gas'),
    };
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this._onResize = () => {
      if (!this._touchVisible()) return;
      this._readSafeArea();
      this._layout();
    };
    addEventListener('resize', this._onResize);
    addEventListener('orientationchange', this._onResize);
  }

  _zone(name) {
    const z = document.createElement('div');
    z.className = 'tc-zone';
    z.dataset.btn = name;
    this._root.appendChild(z);
    z.addEventListener('pointerdown', (e) => this._pDown(e, name, z));
    z.addEventListener('pointermove', (e) => this._pMove(e, name));
    z.addEventListener('pointerup', (e) => this._pUp(e));
    z.addEventListener('pointercancel', (e) => this._pUp(e));
    z.addEventListener('lostpointercapture', (e) => this._pUp(e));
    z.addEventListener('contextmenu', (e) => e.preventDefault());
    return z;
  }

  // Posiciona os botões (canto inferior esquerdo: direção; direito: ações).
  _layout() {
    if (!this._touchVisible()) return;
    const B = this._btn;
    const W = innerWidth;
    const H = innerHeight;
    const vmin = Math.min(W, H);
    const sz = (min, pct, max) => clamp((vmin * pct) / 100, min, max);
    const size = { left: sz(78, 22, 94), drift: sz(88, 25, 104), item: sz(66, 19, 78), brake: sz(56, 16, 66), gas: sz(70, 20, 84) };
    size.right = size.left;
    const sl = Math.max(16, this._safe.left + 10);
    const sr = Math.max(16, this._safe.right + 10);
    const sb = Math.max(18, this._safe.bottom + 10);
    const gap = Math.max(14, vmin * 0.035);
    // [x, distância da base]
    const pos = {};
    pos.left = [sl, sb + 4];
    pos.right = [sl + size.left + gap * 1.4, sb + 4];
    const dx = W - sr - size.drift;
    pos.drift = [dx, sb];
    pos.brake = [dx - size.brake - gap * 1.2, sb];
    if (this._autoAccelerate) {
      pos.item = [dx - size.item * 0.55, sb + size.drift + gap * 0.6];
      pos.gas = [W - sr - size.gas, sb + size.drift + gap * 0.7];
    } else {
      // com ACELERAR acima do DRIFT, o ITEM vai mais para a esquerda
      pos.gas = [W - sr - size.gas, sb + size.drift + gap * 0.7];
      pos.item = [dx - size.item - gap * 1.3, sb + size.drift * 0.75 + gap];
    }
    const rect = {};
    for (const k of ['left', 'right', 'drift', 'item', 'brake', 'gas']) {
      const s = size[k];
      const x = pos[k][0];
      const y = H - pos[k][1] - s;
      const el = B[k];
      el.style.width = `${s}px`;
      el.style.height = `${s}px`;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      rect[k] = { x: x - PAD, y: y - PAD, w: s + PAD * 2, h: s + PAD * 2 };
    }
    const setZone = (z, r) => {
      z.style.left = `${r.x}px`;
      z.style.top = `${r.y}px`;
      z.style.width = `${r.w}px`;
      z.style.height = `${r.h}px`;
    };
    // direção: uma zona só, dividida ao meio (permite deslizar de ◀ para ▶)
    const rl = rect.left;
    const rr = rect.right;
    setZone(this._steerZone, { x: Math.max(0, rl.x - 8), y: rl.y - 8, w: rr.x + rr.w - Math.max(0, rl.x - 8) + 8, h: H - (rl.y - 8) });
    this._steerMid = (pos.left[0] + size.left / 2 + pos.right[0] + size.right / 2) / 2;
    // DRIFT e FREIO vão até as bordas da tela
    const rd = rect.drift;
    setZone(this._zones.drift, { x: rd.x, y: rd.y, w: W - rd.x, h: H - rd.y });
    const rb = rect.brake;
    setZone(this._zones.brake, { x: rb.x, y: rb.y, w: rb.w, h: H - rb.y });
    setZone(this._zones.item, rect.item);
    setZone(this._zones.gas, rect.gas);
    this._zones.gas.style.display = this._autoAccelerate ? 'none' : '';
    // o DRIFT tem prioridade onde as zonas se sobrepõem
    this._zones.drift.style.zIndex = '3';
    this._zones.item.style.zIndex = '2';
  }

  _touchVisible() {
    return !!this._root && !this._root.classList.contains('tc-hidden');
  }

  _applyTouchVisibility() {
    if (!this._root) return;
    const show = this._touchWanted && this._touchEnabled;
    this._root.classList.toggle('tc-hidden', !show);
    if (show) {
      this._readSafeArea();
      this._layout();
    } else {
      this._steerPointers.length = 0;
      this._btnPointers.clear();
      for (const key in this._touch) this._touch[key] = false;
      this._refreshTouchClasses();
    }
  }

  // Lê env(safe-area-inset-*) em px com um elemento de medida (notch).
  _readSafeArea() {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    this._safe.left = parseFloat(cs.paddingLeft) || 0;
    this._safe.right = parseFloat(cs.paddingRight) || 0;
    this._safe.bottom = parseFloat(cs.paddingBottom) || 0;
    probe.remove();
  }

  _pDown(e, name, zone) {
    e.preventDefault();
    this.lastDevice = e.pointerType === 'touch' ? 'touch' : this.lastDevice;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      /* sem captura: segue sem */
    }
    if (name === 'steer') {
      this._removeSteer(e.pointerId);
      this._steerPointers.push({ id: e.pointerId, side: e.clientX < this._steerMid ? -1 : 1 });
    } else {
      this._btnPointers.set(e.pointerId, name);
      if (name === 'item') this._touchPulse.item = true;
      if (name === 'drift' || name === 'item') {
        try {
          navigator.vibrate?.(8);
        } catch {
          /* sem vibração */
        }
      }
    }
    this._recomputeTouch();
  }

  _pMove(e, name) {
    if (name !== 'steer') return;
    // deslizar o dedo de ◀ para ▶ troca a direção
    for (const p of this._steerPointers) {
      if (p.id === e.pointerId) {
        const side = e.clientX < this._steerMid ? -1 : 1;
        if (side !== p.side) {
          p.side = side;
          this._recomputeTouch();
        }
      }
    }
  }

  _pUp(e) {
    const a = this._removeSteer(e.pointerId);
    const b = this._btnPointers.delete(e.pointerId);
    if (a || b) this._recomputeTouch();
  }

  _removeSteer(id) {
    const i = this._steerPointers.findIndex((p) => p.id === id);
    if (i >= 0) {
      this._steerPointers.splice(i, 1);
      return true;
    }
    return false;
  }

  _recomputeTouch() {
    const t = this._touch;
    t.drift = t.item = t.brake = t.gas = false;
    for (const name of this._btnPointers.values()) t[name] = true;
    const last = this._steerPointers.length ? this._steerPointers[this._steerPointers.length - 1].side : 0;
    t.left = last < 0;
    t.right = last > 0;
    this._refreshTouchClasses();
  }

  _refreshTouchClasses() {
    if (!this._btn) return;
    for (const k of ['left', 'right', 'drift', 'item', 'brake', 'gas']) this._btn[k].classList.toggle('tc-on', !!this._touch[k]);
  }
}
