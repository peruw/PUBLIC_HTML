// Corrida Quanta — progresso do jogador: XP acumulado, recordes e skins desbloqueadas.
// Salvo no navegador; com login, a conta única do site (/conta/) sincroniza esta chave.
(() => {
  'use strict';
  window.QC = window.QC || {};

  const KEY = 'quanta-corrida-profile';
  const LEGACY_BEST = 'quanta-corrida-best';

  function blank() {
    return { v: 1, xp: 0, bestScore: 0, maxLevel: 1, maxCombo: 0, maxSpeed: 1, totalHits: 0, runs: 0, skins: ['quanta'], skin: 'quanta', updatedAt: 0 };
  }

  function sanitize(p) {
    const b = blank();
    if (!p || typeof p !== 'object') return b;
    const num = (v, d) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : d);
    return {
      v: 1,
      xp: Math.floor(num(p.xp, 0)),
      bestScore: Math.floor(num(p.bestScore, 0)),
      maxLevel: Math.max(1, Math.floor(num(p.maxLevel, 1))),
      maxCombo: Math.floor(num(p.maxCombo, 0)),
      maxSpeed: Math.max(1, num(p.maxSpeed, 1)),
      totalHits: Math.floor(num(p.totalHits, 0)),
      runs: Math.floor(num(p.runs, 0)),
      skins: Array.isArray(p.skins) ? [...new Set(['quanta', ...p.skins.filter((s) => typeof s === 'string' && s.length < 25)])] : b.skins,
      skin: typeof p.skin === 'string' ? p.skin : 'quanta',
      updatedAt: num(p.updatedAt, 0),
    };
  }

  function load() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    p = sanitize(p);
    try { // recorde da versão anterior do jogo
      const old = JSON.parse(localStorage.getItem(LEGACY_BEST) || '0');
      if (typeof old === 'number' && old > p.bestScore) p.bestScore = old;
    } catch (e) {}
    return p;
  }

  const Progress = {
    data: load(),

    save() {
      this.data.updatedAt = Date.now();
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) {}
    },

    // valor atual do critério de desbloqueio (stats = progresso ou dados ao vivo da corrida)
    metric(type, stats) {
      const s = stats || this.data;
      switch (type) {
        case 'xp': return s.xp;
        case 'combo': return s.maxCombo;
        case 'level': return s.maxLevel;
        case 'best': return s.bestScore;
        case 'speed': return s.maxSpeed;
        case 'hits': return s.totalHits;
        default: return Infinity;
      }
    },

    isUnlocked(id) { return this.data.skins.includes(id); },

    // desbloqueia o que já foi alcançado; devolve ids novos
    checkUnlocks(live) {
      const list = (QC.Skins && QC.Skins.list) || [];
      const fresh = [];
      const stats = live ? {
        xp: this.data.xp + live.score,
        maxCombo: Math.max(this.data.maxCombo, live.maxCombo),
        maxLevel: Math.max(this.data.maxLevel, live.maxLevel),
        bestScore: Math.max(this.data.bestScore, live.score),
        maxSpeed: Math.max(this.data.maxSpeed, live.maxSpeed),
        totalHits: this.data.totalHits + live.hits,
      } : this.data;
      for (const sk of list) {
        if (this.data.skins.includes(sk.id)) continue;
        const u = sk.unlock || {};
        if (u.type === 'default' || this.metric(u.type, stats) >= u.value) {
          this.data.skins.push(sk.id);
          fresh.push(sk.id);
        }
      }
      return fresh;
    },

    // aplica uma corrida terminada
    applyRun(run) {
      const d = this.data;
      const prevBest = d.bestScore;
      d.xp += run.score;
      d.bestScore = Math.max(d.bestScore, run.score);
      d.maxLevel = Math.max(d.maxLevel, run.maxLevel);
      d.maxCombo = Math.max(d.maxCombo, run.maxCombo);
      d.maxSpeed = Math.max(d.maxSpeed, Math.round(run.maxSpeed * 100) / 100);
      d.totalHits += run.hits;
      d.runs += 1;
      const fresh = this.checkUnlocks();
      this.save();
      return { xpGained: run.score, newSkins: fresh, record: run.score > prevBest && run.score > 0 };
    },

    // próxima skin bloqueada mais perto de sair: { skin, current, target, pct }
    nextUnlock() {
      const list = (QC.Skins && QC.Skins.list) || [];
      let best = null;
      for (const sk of list) {
        if (this.isUnlocked(sk.id)) continue;
        const u = sk.unlock || {};
        const cur = this.metric(u.type);
        if (!isFinite(cur)) continue;
        const pct = Math.max(0, Math.min(1, cur / u.value));
        if (!best || pct > best.pct) best = { skin: sk, current: cur, target: u.value, pct };
      }
      return best;
    },

    select(id) {
      if (!this.isUnlocked(id)) return false;
      this.data.skin = id;
      this.save();
      return true;
    },
  };

  QC.Progress = Progress;
})();
