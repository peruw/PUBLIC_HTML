// Entrada: teclado, gamepad (mapeamento padrão) e toque (botões na tela).
// poll() junta tudo; useItem, pause, mute e confirm são pulsos de 1 leitura.
// holdItem = botão de item ainda apertado (items.js usa para segurar maçã/alfa atrás do kart);
// itemBack = no toque, dedo arrastado para baixo no ITEM (atirar para trás, como a tecla C).

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
// Dois jogadores no mesmo teclado: cada tecla é de um jogador ([jogador, ação]).
// J1 = WASD, Espaço (drift), E (item), Q (olhar para trás).
// J2 = setas, ponto ou barra (drift), Enter ou Shift direito (item), vírgula ou End (olhar para trás).
// Nada de Ctrl: com o Ctrl do J2 apertado, o W do J1 vira Ctrl+W e o navegador FECHA a aba
// (atalho reservado, a página não consegue impedir); o S viraria "Salvar página".
const KEYMAP_SPLIT = {
  KeyW: [0, 'up'], KeyS: [0, 'down'], KeyA: [0, 'left'], KeyD: [0, 'right'],
  Space: [0, 'drift'], KeyE: [0, 'item'], KeyQ: [0, 'look'],
  ArrowUp: [1, 'up'], ArrowDown: [1, 'down'], ArrowLeft: [1, 'left'], ArrowRight: [1, 'right'],
  // Slash = "/" no teclado americano; IntlRo = "/" do ABNT2 (ao lado do Shift direito)
  Period: [1, 'drift'], Slash: [1, 'drift'], IntlRo: [1, 'drift'], NumpadDecimal: [1, 'drift'],
  Enter: [1, 'item'], NumpadEnter: [1, 'item'], ShiftRight: [1, 'item'],
  Comma: [1, 'look'], End: [1, 'look'],
  Escape: [0, 'pause'], KeyP: [0, 'pause'],
  KeyM: [0, 'mute'],
};
// teclas que rolariam a página
const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
// no modo de 2 jogadores, também End (rola a página), Enter (clicaria num botão focado)
// e a barra (no Firefox abre a busca rápida, que rouba as teclas)
const PREVENT_SPLIT = new Set([...PREVENT, 'End', 'Enter', 'NumpadEnter', 'Slash', 'IntlRo']);
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
  letter-spacing:.5px;line-height:1;text-align:center;background:rgba(18,26,60,.45);
  border:3px solid rgba(255,255,255,.55);box-shadow:0 4px 14px rgba(0,0,0,.28),inset 0 0 0 2px rgba(255,255,255,.08);
  text-shadow:0 2px 3px rgba(0,0,0,.6);
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
.tc-item.tc-back::after{content:'▼';position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);
  font-size:14px;color:#ffe27a;text-shadow:0 1px 3px rgba(0,0,0,.8)}
.tc-cursor{position:absolute;left:0;top:0;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;
  background:rgba(255,255,255,.9);box-shadow:0 0 0 3px rgba(18,26,60,.4),0 0 10px rgba(255,255,255,.5);
  pointer-events:none;opacity:0;transition:opacity .12s ease}
.tc-cursor.tc-show{opacity:.9}
`;

// Área de toque = botão + margem generosa
const PAD = 14;
const STEER_DEAD = 8; // zona morta (px) no meio da direção de toque
const ITEM_DRAG = 22; // px arrastando para baixo no ITEM = atirar para trás

export class Input {
  constructor({ touchLayer = null, bus = null } = {}) {
    this.bus = bus;
    this.touchLayer = touchLayer;
    this.lastDevice = 'keyboard';
    this._autoAccelerate = false;
    this._touchWanted = false;
    this._countdown = false;
    this._inRace = false; // entre a contagem e a chegada do jogador (bus)

    this.state = {
      throttle: 0, brake: 0, steer: 0, drift: false, useItem: false, holdItem: false, itemBack: false, lookBack: false,
      pause: false, mute: false, confirm: false,
    };

    // teclado
    this._keys = { up: false, down: false, left: false, right: false, drift: false, look: false, item: false };
    this._steerOrder = 0; // -1/1: última direção apertada
    this._kbPulse = { item: false, pause: false, mute: false, confirm: false };
    this._downCodes = new Set();

    // dois jogadores no mesmo PC (tela dividida): J2 tem teclas e controle próprios
    this._split = false;
    this._keys2 = { up: false, down: false, left: false, right: false, drift: false, look: false, item: false };
    this._steerOrder2 = 0;
    this._kbPulse2 = { item: false };
    this._padPulse2 = { item: false };
    this.state2 = { throttle: 0, brake: 0, steer: 0, drift: false, useItem: false, holdItem: false, itemBack: false, lookBack: false };

    // gamepad
    this._padPrev = new Map(); // índice -> bitmask de botões
    this._padPulse = { item: false, pause: false, mute: false, confirm: false };

    // toque
    this._touch = { left: false, right: false, drift: false, item: false, brake: false, gas: false };
    this._touchPulse = { item: false };
    this._steerPointers = []; // [{ id, x }] (x = clientX atual do dedo)
    this._btnPointers = new Map(); // pointerId -> nome do botão
    this._itemPtr = null; // { id, y0, back }: dedo no ITEM (gesto de arrastar para baixo)
    this._safe = { left: 0, right: 0, bottom: 0 };
    this._steerMid = 0;
    this._steerFull = 60; // px do meio até o esterço cheio
    this._steerReach = 60; // px do meio até o centro de ◀/▶ (cursor)
    this._steerY = 0; // altura do centro de ◀/▶ (cursor)

    this._onKeyDown = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onBlur = () => this._releaseAll();
    this._onVis = () => {
      if (document.hidden) this._releaseAll();
    };
    this._onAnyPointer = (e) => {
      if (e.pointerType === 'touch') {
        this.lastDevice = 'touch';
        if (!this._touchEnabled) {
          // notebook/tablet híbrido: o 1º toque no meio da corrida já mostra os botões
          // (sem esperar pausar). Com um menu aberto (pausa), fica para quando ele fechar.
          if (this._inRace && !this._overlayOpen()) this._touchWanted = true;
          this.touchEnabled = true;
        }
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
      this._offs.push(bus.on('race:countdown', () => {
        this._countdown = true;
        this._inRace = true;
      }));
      this._offs.push(bus.on('race:go', () => {
        this._countdown = false;
        this._inRace = true;
      }));
      this._offs.push(bus.on('race:reset', () => {
        this._countdown = false;
        this._inRace = false;
      }));
      this._offs.push(bus.on('race:finish', (e) => {
        if (e?.kart?.isPlayer) this._inRace = false;
      }));
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

  // Dois jogadores (tela dividida): poll() devolve só o J1 e state2 recebe o J2.
  // Solta tudo ao trocar: uma tecla segurada não pode mudar de dono no meio.
  get split() {
    return this._split;
  }

  setSplit(on) {
    on = !!on;
    if (on === this._split) return;
    this._split = on;
    this._releaseAll();
    this._applyTouchVisibility(); // os botões de toque não valem na tela dividida
  }

  // Vibra o gamepad (se estiver em uso e tiver motor de vibração). ms = duração; strength 0..1.
  // player (0 ou 1): na tela dividida, vibra só o controle desse jogador.
  rumble(ms = 120, strength = 0.6, player = -1) {
    if (this.lastDevice !== 'gamepad' && !(this._split && player >= 0)) return;
    let pads = null;
    try {
      pads = navigator.getGamepads ? navigator.getGamepads() : null;
    } catch {
      pads = null;
    }
    if (!pads) return;
    const duration = clamp(ms || 0, 0, 5000);
    const s = clamp(strength ?? 0.6, 0, 1);
    if (duration <= 0 || s <= 0) return;
    let slot = 0; // ordem entre os controles conectados: 0 = J1, 1 = J2
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || !p.connected) continue;
      const mine = !this._split || player < 0 || Math.min(slot, 1) === player;
      slot++;
      if (!mine) continue;
      try {
        const va = p.vibrationActuator;
        if (va?.playEffect) {
          // motor forte = intensidade; o fraco dá o "zumbido" por cima
          va.playEffect('dual-rumble', { startDelay: 0, duration, strongMagnitude: s, weakMagnitude: Math.min(1, s * 0.6 + 0.15) })
            ?.catch?.(() => {});
        } else p.hapticActuators?.[0]?.pulse?.(s, duration);
      } catch {
        /* sem vibração: silencioso */
      }
    }
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
    const tSteer = this._touchSteer();

    if (this._split) return this._pollSplit(kSteer);

    let steer = kSteer;
    if (Math.abs(g.steer) > Math.abs(steer)) steer = g.steer;
    if (Math.abs(tSteer) > Math.abs(steer)) steer = tSteer;

    let brake = Math.max(k.down ? 1 : 0, g.brake, t.brake ? 1 : 0);
    let throttle = Math.max(k.up ? 1 : 0, g.throttle, t.gas ? 1 : 0);
    if (this._autoAccelerate) {
      const touchVisible = this._touchVisible();
      if (this._countdown) {
        // na contagem: segurar qualquer botão de toque (até o FREIO) acelera
        if (touchVisible && (t.drift || t.item || t.gas || t.brake || this._steerPointers.length)) throttle = 1;
      } else if (brake < 0.5) throttle = 1;
      if (brake >= 0.5 && !this._countdown) throttle = 0;
    }

    st.throttle = throttle;
    st.brake = brake;
    st.steer = clamp(steer, -1, 1);
    st.drift = k.drift || g.drift || t.drift;
    st.lookBack = k.look || g.look;
    st.useItem = this._kbPulse.item || this._padPulse.item || this._touchPulse.item;
    st.holdItem = k.item || g.item || t.item;
    st.itemBack = !!(this._itemPtr && this._itemPtr.back);
    st.pause = this._kbPulse.pause || this._padPulse.pause;
    st.mute = this._kbPulse.mute || this._padPulse.mute;
    st.confirm = this._kbPulse.confirm || this._padPulse.confirm;
    this._kbPulse.item = this._kbPulse.pause = this._kbPulse.mute = this._kbPulse.confirm = false;
    this._padPulse.item = this._padPulse.pause = this._padPulse.mute = this._padPulse.confirm = false;
    this._touchPulse.item = false;
    return st;
  }

  // Tela dividida: J1 = WASD + 1º controle; J2 = setas + 2º controle (sem toque).
  _pollSplit(kSteer) {
    const st = this.state;
    const s2 = this.state2;
    const k = this._keys;
    const k2 = this._keys2;
    const g = this._pad;
    const g2 = this._pad2;
    let steer = kSteer;
    if (Math.abs(g.steer) > Math.abs(steer)) steer = g.steer;
    st.throttle = Math.max(k.up ? 1 : 0, g.throttle);
    st.brake = Math.max(k.down ? 1 : 0, g.brake);
    st.steer = clamp(steer, -1, 1);
    st.drift = k.drift || g.drift;
    st.lookBack = k.look || g.look;
    st.useItem = this._kbPulse.item || this._padPulse.item;
    st.holdItem = k.item || g.item;
    st.itemBack = false;
    st.pause = this._kbPulse.pause || this._padPulse.pause;
    st.mute = this._kbPulse.mute || this._padPulse.mute;
    st.confirm = this._kbPulse.confirm || this._padPulse.confirm;

    let steer2 = 0;
    if (k2.left && k2.right) steer2 = this._steerOrder2;
    else if (k2.left) steer2 = -1;
    else if (k2.right) steer2 = 1;
    if (Math.abs(g2.steer) > Math.abs(steer2)) steer2 = g2.steer;
    s2.throttle = Math.max(k2.up ? 1 : 0, g2.throttle);
    s2.brake = Math.max(k2.down ? 1 : 0, g2.brake);
    s2.steer = clamp(steer2, -1, 1);
    s2.drift = k2.drift || g2.drift;
    s2.lookBack = k2.look || g2.look;
    s2.useItem = this._kbPulse2.item || this._padPulse2.item;
    s2.holdItem = k2.item || g2.item;
    s2.itemBack = false;

    this._kbPulse.item = this._kbPulse.pause = this._kbPulse.mute = this._kbPulse.confirm = false;
    this._padPulse.item = this._padPulse.pause = this._padPulse.mute = this._padPulse.confirm = false;
    this._kbPulse2.item = this._padPulse2.item = false;
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
    if (this._split) return this._keySplit(e, down);
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
      case 'item':
        // pulso no aperto + estado segurado (segurar maçã/alfa atrás do kart)
        this._keys.item = held;
        if (down) this._kbPulse.item = true;
        break;
      default:
        if (down) this._kbPulse[act] = true;
    }
  }

  _anyHeld(act) {
    for (const code of this._downCodes) if (KEYMAP[code] === act) return true;
    return false;
  }

  // Teclado dividido entre os dois jogadores (ver KEYMAP_SPLIT).
  _keySplit(e, down) {
    const m = KEYMAP_SPLIT[e.code];
    if (!m) return;
    if (isEditable(e.target)) return;
    // com a pausa aberta, Enter aciona o botão escolhido com Tab (só na corrida ele é bloqueado)
    const menuEnter = (e.code === 'Enter' || e.code === 'NumpadEnter') && this._overlayOpen();
    if (PREVENT_SPLIT.has(e.code) && !menuEnter) e.preventDefault();
    this.lastDevice = 'keyboard';
    if (down) {
      if (e.repeat || this._downCodes.has(e.code)) return;
      this._downCodes.add(e.code);
    } else {
      this._downCodes.delete(e.code);
    }
    const [who, act] = m;
    let held = down;
    if (!held) {
      for (const code of this._downCodes) {
        const o = KEYMAP_SPLIT[code];
        if (o && o[0] === who && o[1] === act) held = true;
      }
    }
    const keys = who ? this._keys2 : this._keys;
    switch (act) {
      case 'left':
      case 'right':
        keys[act] = held;
        if (down) this[who ? '_steerOrder2' : '_steerOrder'] = act === 'left' ? -1 : 1;
        break;
      case 'up':
      case 'down':
      case 'drift':
      case 'look':
        keys[act] = held;
        break;
      case 'item':
        keys.item = held;
        if (down) (who ? this._kbPulse2 : this._kbPulse).item = true;
        break;
      default:
        if (down) this._kbPulse[act] = true;
    }
  }

  _releaseAll() {
    this._downCodes.clear();
    for (const key in this._keys) this._keys[key] = false;
    for (const key in this._keys2) this._keys2[key] = false;
    for (const key in this._touch) this._touch[key] = false;
    this._steerPointers.length = 0;
    this._btnPointers.clear();
    this._itemPtr = null;
    this._refreshTouchClasses();
  }

  // ---------- gamepad ----------
  _pollGamepads() {
    const g1 = this._pad || (this._pad = { throttle: 0, brake: 0, steer: 0, drift: false, look: false, item: false });
    const g2 = this._pad2 || (this._pad2 = { throttle: 0, brake: 0, steer: 0, drift: false, look: false, item: false });
    for (const g of [g1, g2]) {
      g.throttle = 0;
      g.brake = 0;
      g.steer = 0;
      g.drift = false;
      g.look = false;
      g.item = false;
    }
    let slot = 0; // tela dividida: 1º controle conectado = J1, os demais = J2
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
      const two = this._split && slot > 0;
      slot++;
      const g = two ? g2 : g1;
      if (edge & 1) this._padPulse.confirm = true;
      if (edge & 2) (two ? this._padPulse2 : this._padPulse).item = true;
      if (edge & 4) this._padPulse.pause = true;
      if (edge & 8) this._padPulse.mute = true;
      if (Math.abs(ax) > Math.abs(g.steer)) g.steer = ax;
      g.throttle = Math.max(g.throttle, thr);
      g.brake = Math.max(g.brake, brk);
      g.drift = g.drift || drift;
      g.look = g.look || look;
      g.item = g.item || !!(mask & 2); // LB/Y segurado
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
    // cursor da direção analógica: mostra quanto o kart está virando
    this._cursor = document.createElement('div');
    this._cursor.className = 'tc-cursor';
    root.appendChild(this._cursor);

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
    // direção analógica: esterço cheio a 0,7 × a largura do botão, mas nunca depois de ~85% do
    // caminho até o centro de ◀/▶ (um toque no centro do botão continua valendo esterço cheio)
    this._steerReach = pos.right[0] + size.right / 2 - this._steerMid;
    this._steerFull = Math.max(STEER_DEAD + 10, Math.min(0.7 * size.left, this._steerReach * 0.85));
    this._steerY = H - pos.left[1] - size.left / 2;
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

  // Alguma tela do jogo (pausa, resultado...) cobre a corrida?
  _overlayOpen() {
    try {
      return !!document.querySelector('.screen:not(.hidden)');
    } catch {
      return false;
    }
  }

  _applyTouchVisibility() {
    if (!this._root) return;
    // tela dividida (só PC): o toque não dirige nenhum dos dois (_pollSplit o ignora), então um
    // toque num notebook com tela sensível não pode cobrir o HUD com botões que não funcionam
    const show = this._touchWanted && this._touchEnabled && !this._split;
    this._root.classList.toggle('tc-hidden', !show);
    if (show) {
      this._readSafeArea();
      this._layout();
    } else {
      this._steerPointers.length = 0;
      this._btnPointers.clear();
      this._itemPtr = null;
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
      this._steerPointers.push({ id: e.pointerId, x: e.clientX });
    } else {
      this._btnPointers.set(e.pointerId, name);
      if (name === 'item') {
        this._touchPulse.item = true;
        this._itemPtr = { id: e.pointerId, y0: e.clientY, back: false };
      }
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
    if (name === 'item') {
      // arrastar o dedo para baixo no ITEM = soltar para trás (com folga para não piscar)
      const ip = this._itemPtr;
      if (!ip || ip.id !== e.pointerId) return;
      const dy = e.clientY - ip.y0;
      const back = ip.back ? dy > ITEM_DRAG * 0.5 : dy > ITEM_DRAG;
      if (back !== ip.back) {
        ip.back = back;
        this._refreshTouchClasses();
      }
      return;
    }
    if (name !== 'steer') return;
    // direção analógica: acompanha o dedo (deslizar de ◀ para ▶ também troca a direção)
    for (const p of this._steerPointers) {
      if (p.id === e.pointerId && p.x !== e.clientX) {
        p.x = e.clientX;
        this._recomputeTouch();
      }
    }
  }

  _pUp(e) {
    const a = this._removeSteer(e.pointerId);
    const b = this._btnPointers.delete(e.pointerId);
    if (this._itemPtr && this._itemPtr.id === e.pointerId) this._itemPtr = null;
    if (a || b) this._recomputeTouch();
  }

  // Esterço do último dedo na zona de direção: -1..1, com zona morta no meio.
  _touchSteer() {
    const n = this._steerPointers.length;
    if (!n) return 0;
    const dx = this._steerPointers[n - 1].x - this._steerMid;
    const a = Math.abs(dx);
    if (a <= STEER_DEAD) return 0;
    return Math.sign(dx) * clamp((a - STEER_DEAD) / (this._steerFull - STEER_DEAD), 0, 1);
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
    const v = this._touchSteer();
    t.left = v < -0.1;
    t.right = v > 0.1;
    this._refreshTouchClasses();
    // cursor entre os botões: posição = esterço atual
    const cur = this._cursor;
    if (cur) {
      const on = this._steerPointers.length > 0;
      cur.classList.toggle('tc-show', on);
      if (on) cur.style.transform = `translate(${(this._steerMid + v * this._steerReach).toFixed(1)}px, ${this._steerY.toFixed(1)}px)`;
    }
  }

  _refreshTouchClasses() {
    if (!this._btn) return;
    for (const k of ['left', 'right', 'drift', 'item', 'brake', 'gas']) this._btn[k].classList.toggle('tc-on', !!this._touch[k]);
    this._btn.item.classList.toggle('tc-back', !!(this._itemPtr && this._itemPtr.back));
    if (this._cursor && !this._steerPointers.length) this._cursor.classList.remove('tc-show');
  }
}
