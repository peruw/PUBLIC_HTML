// Tabuleiro pequeno 2D (canvas) visto de cima: mostra a posição com símbolos normais de xadrez,
// realces (seleção, destinos, capturas, último lance, xeque) e recebe toques para escolher peça e destino.
import { typeOf, colorOf } from './rules.js';

const GLYPH = { w: { 1: '♙', 2: '♘', 3: '♗', 4: '♖', 5: '♕', 6: '♔' },
  b: { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛', 6: '♚' } };
const TEXT = '︎'; // apresentação de texto (evita emoji)
const C = {
  light: '#a9d18e', dark: '#2f6b3a', selected: 'rgba(255, 213, 74, 0.75)', target: 'rgba(100, 200, 255, 0.95)',
  capture: 'rgba(255, 107, 90, 0.95)', last: 'rgba(255, 241, 176, 0.6)', check: 'rgba(255, 59, 59, 0.7)',
  white: '#f7f2e8', whiteEdge: '#2a2624', black: '#1e1a18', blackEdge: '#d9d0c0', coord: 'rgba(255,255,255,0.7)',
};

export class MiniBoard {
  constructor(canvas, onTap) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTap = onTap;
    this.side = 'w';          // lado de baixo
    this.board = null;        // Int8Array(64)
    this.hl = { selected: -1, targets: [], captures: [], lastMove: null, check: -1 };
    this.enabled = true;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || !this.board) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const fx = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
      const fy = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
      if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return;
      const file = this.side === 'w' ? fx : 7 - fx;
      const rank = this.side === 'w' ? 7 - fy : fy;
      this.onTap(rank * 8 + file);
    });
  }

  set({ board, hl, side }) {
    if (board) this.board = board;
    if (hl) this.hl = hl;
    if (side) this.side = side;
    this.draw();
  }

  _xy(sq) {
    const file = sq & 7, rank = sq >> 3;
    const fx = this.side === 'w' ? file : 7 - file;
    const fy = this.side === 'w' ? 7 - rank : rank;
    return [fx, fy];
  }

  draw() {
    const c = this.c, ctx = this.ctx;
    const rect = c.getBoundingClientRect();
    if (rect.width === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(rect.width * dpr);
    if (c.width !== W || c.height !== W) { c.width = W; c.height = W; }
    const s = W / 8;
    ctx.clearRect(0, 0, W, W);
    // casas
    for (let fy = 0; fy < 8; fy++) {
      for (let fx = 0; fx < 8; fx++) {
        ctx.fillStyle = ((fx + fy) & 1) ? C.dark : C.light;
        ctx.fillRect(fx * s, fy * s, s, s);
      }
    }
    const hl = this.hl;
    const fill = (sq, color) => { const [fx, fy] = this._xy(sq); ctx.fillStyle = color; ctx.fillRect(fx * s, fy * s, s, s); };
    if (hl.lastMove) { fill(hl.lastMove.from, C.last); fill(hl.lastMove.to, C.last); }
    if (hl.check >= 0) fill(hl.check, C.check);
    if (hl.selected >= 0) fill(hl.selected, C.selected);
    // peças
    if (this.board) {
      ctx.font = `${Math.round(s * 0.82)}px "Segoe UI Symbol", "DejaVu Sans", "Noto Sans Symbols 2", "Apple Symbols", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (let sq = 0; sq < 64; sq++) {
        const p = this.board[sq];
        if (!p) continue;
        const [fx, fy] = this._xy(sq);
        const col = colorOf(p);
        const g = GLYPH[col][typeOf(p)] + TEXT;
        const x = (fx + 0.5) * s, y = (fy + 0.56) * s;
        ctx.lineWidth = Math.max(1, s * 0.06);
        ctx.strokeStyle = col === 'w' ? C.whiteEdge : C.blackEdge;
        ctx.strokeText(g, x, y);
        ctx.fillStyle = col === 'w' ? C.white : C.black;
        ctx.fillText(g, x, y);
      }
    }
    // destinos e capturas
    for (const sq of hl.targets || []) {
      const [fx, fy] = this._xy(sq);
      ctx.fillStyle = C.target;
      ctx.beginPath(); ctx.arc((fx + 0.5) * s, (fy + 0.5) * s, s * 0.16, 0, Math.PI * 2); ctx.fill();
    }
    for (const sq of hl.captures || []) {
      const [fx, fy] = this._xy(sq);
      ctx.strokeStyle = C.capture;
      ctx.lineWidth = Math.max(2, s * 0.09);
      ctx.beginPath(); ctx.arc((fx + 0.5) * s, (fy + 0.5) * s, s * 0.4, 0, Math.PI * 2); ctx.stroke();
    }
    // coordenadas
    ctx.fillStyle = C.coord;
    ctx.font = `${Math.round(s * 0.22)}px system-ui, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (let i = 0; i < 8; i++) {
      const file = this.side === 'w' ? i : 7 - i;
      const rank = this.side === 'w' ? 7 - i : i;
      ctx.fillText(String.fromCharCode(97 + file), i * s + s * 0.06, W - s * 0.3);
      ctx.fillText(String(rank + 1), s * 0.06, i * s + s * 0.05);
    }
  }
}
