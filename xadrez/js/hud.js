// HUD: turno, avaliação, gráfico de vantagem, melhores lances, histórico, dicas e botões.
import { MATE_CP } from './engine.js';
import { MiniBoard } from './miniboard.js';
import { sound } from './sound.js';
import { typeOf } from './rules.js';

const GLYPH = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛' };
const VALUE = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9 };

const $ = (id) => document.getElementById(id);
const CLAMP = 10; // peões

export class Hud {
  constructor({ onUndo, onRestart, onToggleView, onMenu, onFlip, onMiniTap, onTogglePerson }) {
    this.root = $('hud');
    this.turn = $('hud-turn');
    this.evalNum = $('hud-eval-num');
    this.evalBarFill = $('hud-eval-fill');
    this.canvas = $('hud-graph');
    this.ctx = this.canvas.getContext('2d');
    this.lines = $('hud-lines');
    this.history = $('hud-history');
    this.hint = $('hud-hint');
    this.status = $('hud-engine');
    this.viewBtn = $('btn-view');
    this.mini = new MiniBoard($('hud-mini'), onMiniTap);
    this.evals = []; // por ply (0 = posição inicial)
    this.evals[0] = 0;
    $('btn-undo').addEventListener('click', onUndo);
    $('btn-restart').addEventListener('click', onRestart);
    $('btn-view').addEventListener('click', onToggleView);
    $('btn-menu').addEventListener('click', onMenu);
    $('btn-flip').addEventListener('click', onFlip);
    this.personBtn = $('btn-person');
    this.personBtn.addEventListener('click', onTogglePerson);
    $('btn-panel').addEventListener('click', () => {
      this.root.classList.toggle('panel-open');
      this.drawGraph();
    });
    this.captured = $('hud-captured');
    this.soundBtn = $('btn-sound');
    const syncSound = () => { this.soundBtn.textContent = sound.muted ? '🔇' : '🔊'; this.soundBtn.setAttribute('aria-pressed', String(!sound.muted)); };
    this.soundBtn.addEventListener('click', () => { sound.setMuted(!sound.muted); syncSound(); });
    syncSound();
    this.setEval({ cp: 0, mateIn: null });
  }

  // Peças capturadas por cada lado (ordenadas por valor) e a vantagem de material de quem está na frente.
  setCaptured(history) {
    const got = { w: [], b: [] };   // got.w = peças pretas que as brancas capturaram
    let diff = 0;
    for (const h of history) {
      const cap = h.move.captured;
      if (!cap) continue;
      const t = typeOf(cap), by = cap < 0 ? 'w' : 'b';
      got[by].push(t); diff += (by === 'w' ? 1 : -1) * VALUE[t];
    }
    const line = (side) => {
      const s = got[side].sort((a, b) => VALUE[b] - VALUE[a]).map((t) => GLYPH[t]).join('');
      const lead = side === 'w' ? diff : -diff;
      return s ? `${side === 'w' ? '○' : '●'} ${s}${lead > 0 ? `<b>+${lead}</b>` : ''}` : '';
    };
    this.captured.innerHTML = [line('w'), line('b')].filter(Boolean).join('<br>');
  }

  show(v) { this.root.classList.toggle('hidden', !v); this.root.setAttribute('aria-hidden', v ? 'false' : 'true'); if (v) { this.drawGraph(); this.mini.draw(); } }

  // you: cor do jogador neste aparelho (contra o computador e online), para mostrar "(você)"
  setTurn(color, check, you = null) {
    const who = (color === 'w' ? 'Brancas' : 'Pretas') + (you === color ? ' (você)' : '');
    this.turn.textContent = who + (check ? ' — xeque!' : '');
    this.turn.classList.toggle('black', color === 'b');
    this.turn.classList.toggle('check', !!check);
  }

  setEval({ cp, mateIn }) {
    let text;
    if (mateIn != null && mateIn !== 0) text = (mateIn > 0 ? '+M' : '−M') + Math.abs(mateIn);
    else if (cp != null && Math.abs(cp) >= MATE_CP - 200) text = cp > 0 ? '+M' : '−M';
    else if (cp == null) text = '…';
    else text = (cp >= 0 ? '+' : '−') + (Math.abs(cp) / 100).toFixed(1);
    this.evalNum.textContent = text;
    const v = cp == null ? 0 : Math.max(-CLAMP, Math.min(CLAMP, cp / 100));
    this.evalBarFill.style.height = (50 + (v / CLAMP) * 50) + '%';
  }

  pushEval(ply, cp) {
    this.evals[ply] = cp == null ? (this.evals[ply - 1] ?? 0) : cp;
    this.evals.length = ply + 1;
    this.drawGraph();
  }
  truncateEval(ply) {
    this.evals.length = Math.max(1, ply + 1);
    this.drawGraph();
  }
  resetEval() { this.evals = [0]; this.drawGraph(); }

  drawGraph() {
    const c = this.canvas, ctx = this.ctx;
    const rect = c.getBoundingClientRect();
    if (rect.width === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(rect.width * dpr) || c.height !== Math.round(rect.height * dpr)) {
      c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr);
    }
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, W, H);
    const n = Math.max(2, this.evals.length);
    const x = (i) => (i / Math.max(1, n - 1)) * W;
    const y = (cp) => {
      const v = Math.max(-CLAMP, Math.min(CLAMP, cp / 100));
      const s = Math.sign(v) * Math.sqrt(Math.abs(v) / CLAMP); // escala raiz: destaca pequenas vantagens
      return H / 2 - s * (H / 2 - 4);
    };
    // área brancas (acima) e pretas (abaixo)
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    for (let i = 0; i < this.evals.length; i++) ctx.lineTo(x(i), y(this.evals[i]));
    ctx.lineTo(x(this.evals.length - 1), H / 2);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(240,235,220,0.9)');
    grad.addColorStop(0.5, 'rgba(240,235,220,0.9)');
    grad.addColorStop(0.5, 'rgba(40,36,34,0.95)');
    grad.addColorStop(1, 'rgba(40,36,34,0.95)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.strokeStyle = '#64c8ff';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    for (let i = 0; i < this.evals.length; i++) { const px = x(i), py = y(this.evals[i]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.stroke();
  }

  setLines(lines) {
    this.lines.innerHTML = '';
    if (!lines || !lines.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'sem análise';
      this.lines.appendChild(li);
      return;
    }
    lines.forEach((l, i) => {
      const li = document.createElement('li');
      const s = document.createElement('span');
      s.className = 'san';
      s.textContent = `${i + 1}. ${l.san || l.uci}`;
      const v = document.createElement('span');
      v.className = 'score';
      v.textContent = l.mateIn != null ? (l.mateIn > 0 ? '+M' : '−M') + Math.abs(l.mateIn) : ((l.scoreCp >= 0 ? '+' : '−') + (Math.abs(l.scoreCp) / 100).toFixed(2));
      li.append(s, v);
      this.lines.appendChild(li);
    });
  }

  setHistory(sans) {
    this.history.innerHTML = '';
    for (let i = 0; i < sans.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'mv';
      const n = document.createElement('span'); n.className = 'num'; n.textContent = (i / 2 + 1) + '.';
      const w = document.createElement('span'); w.textContent = sans[i];
      const b = document.createElement('span'); b.textContent = sans[i + 1] || '';
      row.append(n, w, b);
      this.history.appendChild(row);
    }
    this.history.scrollTop = this.history.scrollHeight;
  }

  setEngineStatus(text, state) {
    this.status.textContent = text;
    this.status.dataset.state = state || '';
  }

  showHint(text) { this.hint.textContent = text || ''; }

  // mode: 'roam' | 'firstperson' | 'overhead'. O botão mostra a vista alternativa.
  setView(mode) {
    this.viewBtn.innerHTML = mode === 'overhead'
      ? '🏇 <span class="lbl-long">Campo de batalha</span><span class="lbl-short">Campo</span>'
      : '⤴ <span class="lbl-long">Vista de cima</span><span class="lbl-short">Cima</span>';
    this.root.dataset.view = mode;
  }

  // Mostra a opção alternativa: em 1ª pessoa o botão oferece a 3ª, e vice-versa.
  setPerson(person) {
    const n = person === 'third' ? '1ª' : '3ª';
    this.personBtn.innerHTML = `👁 ${n}<span class="lbl-long"> pessoa</span>`;
  }

  setUndoEnabled(v) { $('btn-undo').disabled = !v; }

  // Partida online não tem motor: esconde avaliação, gráfico e melhores lances (ficaria parado em +0.0).
  setAnalysisVisible(v) { this.root.classList.toggle('no-analysis', !v); if (v) this.drawGraph(); }
}
