// Corrida Quanta — conta, progresso na nuvem e ranking (Supabase do projeto fisora, login Google).
// Tudo aqui é opcional: sem internet ou sem a biblioteca, o jogo segue no modo local.
(() => {
  'use strict';
  window.QC = window.QC || {};

  const CONFIG = {
    url: 'https://rnbyvrzarzvkvixtxoli.supabase.co',
    key: 'sb_publishable_KSX31Bo5Gn8CQUL6KTWNBg_2ncUCCxy',
  };

  let sb = null;
  let user = null;
  const listeners = [];

  function toUser(u) {
    if (!u) return null;
    const m = u.user_metadata || {};
    return {
      id: u.id,
      email: u.email || '',
      name: m.full_name || m.name || '',
      firstName: String(m.given_name || m.full_name || m.name || '').split(' ')[0],
      avatar: m.avatar_url || m.picture || '',
    };
  }
  function emit() { listeners.forEach((cb) => { try { cb(user); } catch (e) {} }); }

  // Chamada RPC com tempo-limite; devolve { data } ou { error }
  async function rpc(fn, args, ms) {
    if (!sb) return { error: 'offline' };
    try {
      const call = sb.rpc(fn, args || {});
      const timeout = new Promise((r) => setTimeout(() => r({ error: { message: 'timeout' } }), ms || 8000));
      const res = await Promise.race([call, timeout]);
      if (res.error) return { error: res.error.message || 'error' };
      return { data: res.data };
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  }

  const Online = {
    get available() { return !!sb; },
    get user() { return user; },

    async init() {
      if (sb) return true;
      if (!window.supabase || !window.supabase.createClient) return false;
      try {
        sb = window.supabase.createClient(CONFIG.url, CONFIG.key, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
        });
        const { data } = await sb.auth.getSession();
        user = toUser(data && data.session && data.session.user);
        sb.auth.onAuthStateChange((_ev, session) => {
          const nu = toUser(session && session.user);
          const changed = (nu && nu.id) !== (user && user.id);
          user = nu;
          if (changed) emit();
        });
        // limpa ?code=... da barra de endereço depois do retorno do Google
        if (/[?&](code|error)=/.test(location.search)) {
          history.replaceState(null, '', location.pathname + location.hash);
        }
        return true;
      } catch (e) {
        sb = null;
        return false;
      }
    },

    onChange(cb) { listeners.push(cb); },

    async signIn() {
      if (!sb) return { error: 'offline' };
      const redirectTo = location.origin + location.pathname;
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      return error ? { error: error.message } : { ok: true };
    },

    async signOut() {
      if (!sb) return;
      try { await sb.auth.signOut(); } catch (e) {}
      user = null;
      emit();
    },

    // { nickname, progress, revision, best_score }
    async getMe() {
      const r = await rpc('corrida_get_me');
      return r.error ? null : r.data;
    },

    // { ok, nickname } ou { ok:false, error:'invalid'|'blocked'|'taken'|... }
    async setNickname(nick) {
      const r = await rpc('corrida_set_nickname', { p_nickname: nick });
      return r.error ? { ok: false, error: 'offline' } : r.data;
    },

    // { ok, revision } ou { ok:false, conflict:true, revision }
    async saveProgress(progress, revision) {
      const r = await rpc('corrida_save_progress', { p_progress: progress, p_expected_revision: revision });
      return r.error ? { ok: false, error: r.error } : r.data;
    },

    // bilhete de uso único pedido no início de cada corrida (o servidor marca a hora)
    async startRun() {
      if (!user) return null;
      const r = await rpc('corrida_start_run');
      return r.error ? null : r.data;
    },

    // run: { runId, score, hits, maxLevel, maxCombo, maxSpeed, durationMs, skin }
    async submitRun(run) {
      if (!run.runId) return { ok: false, error: 'no_run' };
      const r = await rpc('corrida_submit_run', {
        p_run_id: run.runId, p_score: run.score, p_hits: run.hits, p_max_level: run.maxLevel, p_max_combo: run.maxCombo,
        p_max_speed: Math.round(run.maxSpeed * 100) / 100, p_duration_ms: Math.round(run.durationMs), p_skin: run.skin,
      });
      return r.error ? { ok: false, error: r.error } : r.data;
    },

    // [{ rank, nickname, score, skin, is_me }]
    async leaderboard(period, limit) {
      const r = await rpc('corrida_leaderboard', { p_period: period === 'all' ? 'all' : 'week', p_limit: limit || 20 });
      return r.error ? null : (r.data || []);
    },
  };

  QC.Online = Online;
})();
