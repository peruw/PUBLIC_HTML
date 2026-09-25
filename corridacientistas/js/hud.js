// HUD da corrida (DOM): item, posição, volta, tempo, minimapa, mensagens e curiosidades.
import { ITEMS } from './config.js';
import { formatTime } from './race.js';

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
    };
    this.ctx = this.el.map.getContext('2d');
    this.seenFacts = new Set();
    this.centerTimer = 0;
    this.centerSticky = false;
    this.last = {};
    this.active = false;
    this.player = null;
    this.toastList = []; // toasts ativos com tempo de vida (em ms de jogo)

    bus.on('race:countdown', ({ n }) => this.center(String(n), 'pop', RACE_COUNT_MS));
    bus.on('race:go', () => this.center('VAI!', 'pop', 900));
    bus.on('race:finalLap', () => this.center('ÚLTIMA VOLTA!', 'msg pop', 1800));
    bus.on('race:lap', ({ kart, lap }) => {
      if (kart === this.player && lap < this.totalLaps) this.center(`Volta ${lap}`, 'msg pop', 1300);
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

  setRace({ player, karts, totalLaps, track }) {
    this.player = player;
    this.karts = karts;
    this.totalLaps = totalLaps;
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
    if (this.player) drawDot(this.player, 7, 3);
  }

  update(dt, world, race) {
    if (!this.active || !this.player) return;
    const p = this.player;

    // item / roleta
    const showing = p.roulette ? p.roulette.showing : p.item;
    const key = `${showing}|${p.itemCount}|${!!p.roulette}`;
    if (key !== this.last.item) {
      this.last.item = key;
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
    const t = p.finished ? p.finishTime : race.time;
    this.el.time.textContent = formatTime(t);

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

    this.drawMinimap();
  }

  center(text, cls = 'pop', ms = 1000, sticky = false) {
    const el = this.el.center;
    el.className = cls;
    el.innerHTML = `<span>${text}</span>`;
    this.centerTimer = ms;
    this.centerSticky = sticky;
  }

  // Curiosidade do item: texto completo na primeira vez, curto nas outras.
  toastItem(id) {
    const it = ITEMS[id];
    if (!it) return;
    const first = !this.seenFacts.has(id);
    this.seenFacts.add(id);
    const body = first ? `<small>Você sabia?</small><b>${it.name}</b><p>${it.fact}</p>` : `<b>${it.name}</b><p>${it.effect}</p>`;
    this.toast(`<div class="item-ico">${itemIconHTML(id)}</div><div>${body}</div>`, first ? 7000 : 2200);
  }

  toast(html, ms) {
    const box = this.el.toasts;
    // tela baixa (celular deitado): um toast por vez para não cobrir a pista
    const max = innerHeight < 520 ? 1 : 2;
    while (box.children.length >= max) box.firstChild.remove();
    const div = document.createElement('div');
    div.className = 'toast';
    div.innerHTML = html;
    box.appendChild(div);
    this.toastList.push({ div, t: ms, out: false });
  }
}

const RACE_COUNT_MS = 950;
