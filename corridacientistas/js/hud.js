// HUD da corrida (DOM): item, posição, volta, tempo, minimapa, mensagens e curiosidades.
import { ITEMS } from './config.js';
import { formatTime } from './race.js';
import { ITEM_FACTS, ZONE_FACTS, pickFact } from './facts.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// Ícone de item: emoji ou texto estilizado (α, e⁻).
export function itemIconHTML(id) {
  const it = ITEMS[id];
  if (!it) return '';
  const isText = /^[\w\sα-ωΑ-Ω⁻⁺]+$/u.test(it.icon);
  return isText
    ? `<span class="txt" style="--glow:${hex(it.color)}">${it.icon}</span>`
    : it.icon;
}

export class Hud {
  constructor({ bus }) {
    this.bus = bus;
    this.root = $('hud');
    this.el = {
      slot: this.root.querySelector('.hud-item-slot'),
      icon: $('hud-item-icon'),
      count: $('hud-item-count'),
      name: $('hud-item-name'),
      posBox: this.root.querySelector('.hud-pos'),
      pos: $('hud-pos-num'),
      total: this.root.querySelector('.hud-pos-total'),
      lap: $('hud-lap'),
      time: $('hud-time'),
      center: $('hud-center'),
      toasts: $('hud-toasts'),
      map: $('hud-minimap'),
      warn: $('hud-warn'),
      drift: $('hud-drift'),
      vignette: $('hud-vignette'),
    };
    this.warnItem = null; // item que está vindo na direção do jogador
    this.warnBeep = 0;
    this.ctx = this.el.map.getContext('2d');
    this.seenFacts = new Set();
    this.centerTimer = 0;
    this.centerSticky = false;
    this.last = {};
    this.active = false;
    this.player = null;
    this.toastList = []; // toasts ativos com tempo de vida (em ms de jogo)
    this.raceFacts = []; // curiosidades mostradas nesta corrida (vão para a tela de resultado)
    this.tips = null; // dicas da primeira corrida (Set com as já mostradas) ou null
    this.driftTip = 0; // ms restantes da dica/indicador de drift
    this._frame = 0;

    // No "2" acende o sinal da largada-foguete: é a hora de acelerar.
    bus.on('race:countdown', ({ n }) => {
      // nas primeiras corridas o "2" também diz qual tecla segurar
      const how = this.tips ? (this.isTouch ? 'segure DRIFT agora!' : 'segure W ou ↑ agora!') : 'acelere agora!';
      this.center(n === 2 ? `2<small>${how}</small>` : String(n), n === 2 ? 'pop go' : 'pop', RACE_COUNT_MS);
    });
    bus.on('race:go', () => this.center('VAI!', 'pop', 900));
    bus.on('race:rocketEarly', ({ kart }) => {
      if (kart === this.player) setTimeout(() => this.center('Cedo demais! Acelere no 2', 'msg pop', 1500), 950);
    });
    bus.on('race:finalLap', () => this.center('ÚLTIMA VOLTA!', 'msg pop', 1800));
    bus.on('race:lap', ({ kart, lap, lapTime }) => {
      if (kart !== this.player || lap >= this.totalLaps) return;
      const t = lapTime > 0 ? `<small>${formatTime(lapTime)}</small>` : '';
      this.center(`Volta ${lap}${t}`, 'msg pop', 1500);
    });
    bus.on('race:finish', ({ kart, place }) => {
      if (kart === this.player) this.center(place === 1 ? 'VITÓRIA! 🏆' : 'CHEGADA!', 'msg pop', 3500);
    });
    bus.on('item:got', ({ kart, item }) => {
      // só com o HUD visível e antes da chegada (senão a curiosidade se perde escondida)
      if (kart === this.player && this.active && !kart.finished) this.toastItem(item);
    });
    bus.on('kart:boost', ({ kart, source }) => {
      if (kart !== this.player) return;
      if (source === 'rocket') this.center('Largada-foguete!', 'msg pop', 1200);
    });
    bus.on('kart:trick', ({ kart }) => {
      if (kart === this.player) this.center('Manobra!', 'msg pop', 800);
    });
    bus.on('kart:hit', (e) => this.onHit(e));
    // nível do mini-turbo: 3 pontos que acendem azul, laranja e roxo
    bus.on('kart:driftStart', ({ kart }) => {
      if (kart === this.player) this.setDriftDots(0);
    });
    bus.on('kart:driftLevel', ({ kart, level }) => {
      if (kart !== this.player) return;
      this.setDriftDots(level);
      if (level >= 1) this.tip('release', this.isTouch ? 'Solte o DRIFT para o turbo!' : 'Solte o ESPAÇO para o turbo!');
    });
    bus.on('kart:driftEnd', ({ kart }) => {
      if (kart === this.player) this.setDriftDots(-1);
    });
  }

  // ---------- quem acertou quem ----------
  onHit({ kart, by, item }) {
    const p = this.player;
    if (!p || !this.active || !item || !ITEMS[item]) return;
    const it = ITEMS[item];
    const ico = itemIconHTML(item);
    if (kart === p) {
      const who = by && by !== p ? ` <span class="who">de ${by.character.name}</span>` : by === p ? ' <span class="who">(foi você mesmo!)</span>' : '';
      this.toast(`<div class="item-ico">${ico}</div><div><b>${it.name}${who}</b></div>`, 1900, 'hit');
      // quem lidera quase nunca pega Tesla/Buraco: aprende sobre o item ao ser atingido
      this.noteItemFact(item);
    } else if (by === p && !kart.finished) {
      const now = performance.now();
      if (item === 'tesla') {
        if (now - (this._teslaToast || 0) < 1500) return;
        this._teslaToast = now;
        this.toast(`<div class="item-ico">${ico}</div><div><b>Raio em todos os adversários!</b></div>`, 1600, 'good');
      } else {
        this.toast(`<div class="item-ico">${ico}</div><div><b>Você acertou ${kart.character.name}!</b></div>`, 1600, 'good');
      }
    }
  }

  // Registra (uma vez por corrida) uma curiosidade do item para a tela de resultado.
  noteItemFact(id) {
    if (this.raceFacts.some((f) => f.kind === 'item' && f.id === id)) return null;
    const fact = pickFact('item:' + id, ITEM_FACTS[id]);
    if (!fact) return null;
    this.raceFacts.push({ kind: 'item', id, title: ITEMS[id].name, icon: itemIconHTML(id), ...fact });
    return fact;
  }

  setDriftDots(level) {
    const el = this.el.drift;
    if (!el) return;
    if (level < 0) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    this.driftTip = 0;
    el.className = 'dots';
    el.innerHTML = [1, 2, 3].map((i) => `<i class="${i <= level ? 'on l' + i : ''}"></i>`).join('');
  }

  // Dica da primeira corrida (cada uma aparece uma vez).
  tip(key, text, ms = 3000) {
    if (!this.tips || this.tips.has(key) || !this.active) return;
    this.tips.add(key);
    const el = this.el.drift;
    if (!el || (el.className === 'dots' && key !== 'release')) return;
    el.className = 'tip';
    el.textContent = text;
    this.driftTip = ms;
  }

  show(on) {
    this.active = on;
    this.root.classList.toggle('hidden', !on);
    if (!on) {
      this.toastList = [];
      this.el.toasts.innerHTML = '';
      this.el.center.textContent = '';
    }
  }

  setRace({ player, karts, totalLaps, track, tutorial = false, touch = false }) {
    this.player = player;
    this.karts = karts;
    this.totalLaps = totalLaps;
    this.raceFacts = [];
    this.seenFacts = new Set(); // a cada corrida o fato do item volta a aparecer
    this.zonesSeen = new Set(['largada']);
    this.zonePending = null;
    this.isTouch = touch;
    this.tips = tutorial ? new Set() : null;
    this.driftTip = 0;
    this.setDriftDots(-1);
    if (this.el.vignette) this.el.vignette.style.opacity = 0;
    this.el.total.textContent = `/${karts.length}`;
    this.last = {};
    this.el.center.textContent = '';
    this.toastList = [];
    this.el.toasts.innerHTML = '';
    if (track !== this.track) this.prepareMinimap(track);
  }

  // Desenha a pista do minimapa uma vez num canvas separado.
  prepareMinimap(track) {
    this.track = track;
    const pts = track.minimapPoints;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const W = this.el.map.width;
    const pad = 14;
    const scale = (W - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (W - (maxX - minX) * scale) / 2;
    const oz = (W - (maxZ - minZ) * scale) / 2;
    // vista de cima: +X para a direita, +Z para baixo
    this.mapXY = (x, z) => [ox + (x - minX) * scale, oz + (z - minZ) * scale];

    const bg = document.createElement('canvas');
    bg.width = bg.height = W;
    const c = bg.getContext('2d');
    c.lineJoin = c.lineCap = 'round';
    const path = () => {
      c.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = this.mapXY(p.x, p.z);
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      });
      c.closePath();
    };
    path();
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 13;
    c.stroke();
    path();
    c.strokeStyle = '#ffffff';
    c.lineWidth = 9;
    c.stroke();
    path();
    c.strokeStyle = '#5b6b8c';
    c.lineWidth = 5;
    c.stroke();
    // viaduto do "8": o trecho de cima é redesenhado por último, com contorno, para ler como ponte
    if (pts.some((p) => p.over)) {
      const seg = (w, col) => {
        c.beginPath();
        let open = false;
        for (const p of pts) {
          if (!p.over) { open = false; continue; }
          const [x, y] = this.mapXY(p.x, p.z);
          if (!open) c.moveTo(x, y);
          else c.lineTo(x, y);
          open = true;
        }
        c.strokeStyle = col;
        c.lineWidth = w;
        c.stroke();
      };
      c.lineCap = 'butt';
      seg(15, 'rgba(0,0,0,0.6)');
      seg(9, '#ffffff');
      seg(5, '#8fa3cc');
      c.lineCap = 'round';
    }
    // setinhas do sentido da corrida
    if (track.sample && track.length) {
      c.fillStyle = '#ffffff';
      for (let i = 1; i < 6; i++) {
        const smp = track.sample((i / 6) * track.length);
        const [x, y] = this.mapXY(smp.pos.x, smp.pos.z);
        const ang = Math.atan2(smp.tangent.z, smp.tangent.x);
        c.save();
        c.translate(x, y);
        c.rotate(ang);
        c.beginPath();
        c.moveTo(4, 0);
        c.lineTo(-3, -3);
        c.lineTo(-3, 3);
        c.closePath();
        c.fillStyle = '#1a2233';
        c.fill();
        c.restore();
      }
    }
    // fileiras de caixas de item
    const rows = track.itemBoxRows || (track.itemBoxSlots || []).map((b) => ({ x: b.pos.x, z: b.pos.z }));
    for (const b of rows) {
      const [x, y] = this.mapXY(b.x, b.z);
      c.fillStyle = '#1a2233';
      c.fillRect(x - 3, y - 3, 6, 6);
      c.fillStyle = '#ffd23f';
      c.fillRect(x - 2, y - 2, 4, 4);
    }
    // linha de chegada
    const [sx, sy] = this.mapXY(pts[0].x, pts[0].z);
    c.fillStyle = '#ffd23f';
    c.fillRect(sx - 4, sy - 4, 8, 8);
    this.mapBg = bg;
  }

  drawMinimap() {
    const c = this.ctx;
    const W = this.el.map.width;
    c.clearRect(0, 0, W, W);
    c.drawImage(this.mapBg, 0, 0);
    const drawDot = (k, r, ring) => {
      const [x, y] = this.mapXY(k.position.x, k.position.z);
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fillStyle = k.character.colors.ui;
      c.fill();
      c.lineWidth = ring;
      c.strokeStyle = '#fff';
      c.stroke();
    };
    for (const k of this.karts) if (k !== this.player) drawDot(k, 4.5, 1.5);
    const p = this.player;
    if (p) {
      // jogador: seta apontando para onde o kart vai
      const [x, y] = this.mapXY(p.position.x, p.position.z);
      c.save();
      c.translate(x, y);
      c.rotate(Math.atan2(Math.cos(p.heading), Math.sin(p.heading)));
      c.beginPath();
      c.moveTo(9, 0);
      c.lineTo(-6, -6.5);
      c.lineTo(-3, 0);
      c.lineTo(-6, 6.5);
      c.closePath();
      c.fillStyle = p.character.colors.ui;
      c.fill();
      c.lineWidth = 2.5;
      c.strokeStyle = '#fff';
      c.stroke();
      c.restore();
    }
  }

  update(dt, world, race) {
    if (!this.active || !this.player) return;
    const p = this.player;

    this.updateWarn(dt, world);

    // item / roleta
    const showing = p.roulette ? p.roulette.showing : p.item || p.itemHeld?.item;
    const held = p.itemHeld ? (p.itemHeld.back ? 'back' : 'held') : '';
    const key = `${showing}|${p.itemCount}|${!!p.roulette}|${held}`;
    if (key !== this.last.item) {
      this.last.item = key;
      // item seguro atrás do kart (escudo); ▼ = vai ser atirado para trás
      this.el.slot.classList.toggle('held', !!held);
      this.el.slot.classList.toggle('back', held === 'back');
      this.el.icon.innerHTML = showing ? itemIconHTML(showing) : '';
      this.el.slot.classList.toggle('rolling', !!p.roulette);
      // itens de vários usos (Pilha ×3): contador 3/2/1 e nome sem o "×3"
      const multi = !!p.item && (ITEMS[p.item].uses || 1) > 1;
      const showCount = !p.roulette && multi;
      this.el.count.classList.toggle('hidden', !showCount);
      this.el.count.textContent = p.itemCount;
      const name = p.item ? ITEMS[p.item].name : '';
      this.el.name.textContent = !p.roulette && p.item ? (multi ? name.replace(/\s*×\d+$/, '') : name) : '';
    }

    if (p.place !== this.last.place) {
      this.last.place = p.place;
      this.el.pos.textContent = p.place;
      this.el.posBox.className = `hud-pos ${p.place <= 3 ? 'p' + p.place : 'px'}`;
    }
    const lapTxt = `${Math.min(p.lap, this.totalLaps)}/${this.totalLaps}`;
    if (lapTxt !== this.last.lap) {
      this.last.lap = lapTxt;
      this.el.lap.textContent = lapTxt;
    }
    // tempo e minimapa a ~30 Hz: menos trabalho de layout/canvas por quadro
    const half = (this._frame++ & 1) === 0;
    if (half) {
      const t = p.finished ? p.finishTime : race.time;
      const tt = formatTime(t);
      if (tt !== this.last.time) {
        this.last.time = tt;
        this.el.time.textContent = tt;
      }
    }

    // vinheta de velocidade (mais forte perto da velocidade máxima e no turbo)
    if (this.el.vignette) {
      const top = p.maxSpeed || 1;
      const feel = p.boostTime > 0 ? 1 : Math.min(1, Math.max(0, (Math.abs(p.speed) / top - 0.82) / 0.18));
      this._feel = (this._feel || 0) + (feel - (this._feel || 0)) * Math.min(1, dt * 4);
      const op = (this._feel * 0.8).toFixed(2);
      if (op !== this.last.vig) {
        this.last.vig = op;
        this.el.vignette.style.opacity = op;
      }
    }

    if (race.phase === 'racing' && !p.finished) {
      this.updateZones(world, p);
      this.updateTips(world, p);
    }
    if (this.driftTip > 0) {
      this.driftTip -= dt * 1000;
      if (this.driftTip <= 0 && this.el.drift.className === 'tip') this.setDriftDots(-1);
    }

    // contramão
    const wrong = p.wrongWay > 45 && race.phase === 'racing';
    if (wrong && !this.centerSticky) {
      this.center('CONTRAMÃO! ↩', 'msg', 0, true);
    } else if (!wrong && this.centerSticky) {
      this.centerSticky = false;
      this.el.center.textContent = '';
    }

    // toasts contam o tempo do jogo (dt = 0 na pausa)
    if (this.toastList.length) {
      for (const e of this.toastList) {
        if ((e.t -= dt * 1000) <= 0 && !e.out) {
          e.out = true;
          e.div.classList.add('out');
          setTimeout(() => e.div.remove(), 450);
        }
      }
      this.toastList = this.toastList.filter((e) => !e.out && e.div.isConnected);
    }

    if (this.centerTimer > 0) {
      this.centerTimer -= dt * 1000;
      if (this.centerTimer <= 0 && !this.centerSticky) this.el.center.textContent = '';
    }
    // mensagem grande no centro: as curiosidades recuam para não brigar com ela
    const busy = !!this.el.center.textContent;
    if (busy !== this.last.busy) {
      this.last.busy = busy;
      this.el.toasts.classList.toggle('dim', busy);
    }

    if (half) this.drawMinimap();
  }

  // Curiosidade do setor da pista, na primeira passagem de cada corrida (só na 1ª volta).
  updateZones(world, p) {
    const meta = world.track?.meta;
    if (!meta?.zoneOf || p.lap > 1) return;
    const z = meta.zoneOf(p.s);
    if (!this.zonesSeen.has(z) && ZONE_FACTS[z]) {
      this.zonesSeen.add(z);
      this.zonePending = z;
    }
    // espera a tela ficar livre (sem outra curiosidade nem mensagem central)
    const z2 = this.zonePending;
    if (z2 && !this.el.toasts.children.length && this.centerTimer <= 0) {
      this.zonePending = null;
      const f = ZONE_FACTS[z2];
      this.raceFacts.push({ kind: 'zone', id: z2, title: f.name, icon: '📍', text: f.text, quiz: f.quiz });
      this.toast(`<div class="item-ico">📍</div><div><small>${f.name}</small><p>${f.short}</p></div>`, 4000);
    }
  }

  // Dicas contextuais das primeiras corridas.
  updateTips(world, p) {
    if (!this.tips) return;
    const tr = world.track;
    if (!this.tips.has('drift') && tr?.curvature && !p.drifting && Math.abs(p.speed) > 12) {
      let k = 0;
      for (let d = 10; d <= 40; d += 10) k = Math.max(k, Math.abs(tr.curvature(p.s + d)));
      if (k > 1 / 45) this.tip('drift', this.isTouch ? 'Curva! Segure DRIFT e vire' : 'Curva! Segure ESPAÇO e vire (drift)');
    }
  }

  // Aviso de elétron teleguiado ou buraco negro vindo na direção do jogador.
  updateWarn(dt, world) {
    const p = this.player;
    const items = world.items;
    let item = null;
    let dist = Infinity;
    if (items && !p.finished) {
      for (const pr of items.projs || []) {
        if (!pr.active || pr.type !== 'eletron' || pr.target !== p) continue;
        const d = pr.pos.distanceTo(p.position);
        if (d < dist) { dist = d; item = 'eletron'; }
      }
      for (const h of items.holes || []) {
        if (!h.active || h.target !== p || h.phase === 'boom') continue;
        const d = h.pos.distanceTo(p.position);
        if (d < dist) { dist = d; item = 'buraco'; }
      }
    }
    const el = this.el.warn;
    if (!el) return;
    if (item !== this.warnItem) {
      this.warnItem = item;
      el.classList.toggle('hidden', !item);
      if (item) {
        el.innerHTML = `<span class="ico">${itemIconHTML(item)}</span><span class="txt">${item === 'buraco' ? 'Buraco negro vindo!' : 'Elétron vindo!'}</span>`;
        this.warnBeep = 0;
      }
    }
    if (!item) return;
    const near = dist < 30;
    el.classList.toggle('near', near);
    this.warnBeep -= dt;
    if (this.warnBeep <= 0) {
      this.warnBeep = near ? 0.5 : 1.1;
      this.bus.emit('item:incoming', { kart: p, item, dist });
    }
  }

  center(text, cls = 'pop', ms = 1000, sticky = false) {
    const el = this.el.center;
    el.className = cls;
    el.innerHTML = `<span>${text}</span>`;
    this.centerTimer = ms;
    this.centerSticky = sticky;
  }

  // Curiosidade do item: frase curta na primeira vez da corrida (o texto completo vai para
  // a tela de resultado); nas outras vezes, só o que o item faz.
  toastItem(id) {
    const it = ITEMS[id];
    if (!it) return;
    const first = !this.seenFacts.has(id);
    this.seenFacts.add(id);
    const fact = first ? this.noteItemFact(id) : null;
    const body = fact ? `<small>Você sabia?</small><b>${it.name}</b><p>${fact.short}</p>` : `<b>${it.name}</b><p>${it.effect}</p>`;
    this.toast(`<div class="item-ico">${itemIconHTML(id)}</div><div>${body}</div>`, fact ? 4500 : 2000);
    if (this.tips) this.tip('item', this.isTouch ? 'Toque em ITEM para usar' : 'Aperte E para usar o item', 2600);
  }

  // Um aviso por vez, na coluna da direita. Tocar/clicar fecha.
  toast(html, ms, cls = '') {
    const box = this.el.toasts;
    while (box.children.length) box.firstChild.remove();
    this.toastList = [];
    const div = document.createElement('div');
    div.className = 'toast' + (cls ? ' ' + cls : '');
    // conteúdo sem ícone (ex.: avisos do sistema) ganha um ícone padrão para caber no grid
    div.innerHTML = /class="item-ico"/.test(html) ? html : `<div class="item-ico">ℹ️</div><div>${html}</div>`;
    const entry = { div, t: ms, out: false };
    div.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      entry.t = 0;
    });
    box.appendChild(div);
    this.toastList.push(entry);
  }
}

const RACE_COUNT_MS = 950;
