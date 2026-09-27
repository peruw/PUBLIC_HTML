// Corrida Quanta — apelido, ranking por modo e salas de turma (Supabase do projeto fisora).
// O login é o único do site (/conta/): o jogo só lê essa sessão. Skins, XP e recordes
// ficam em localStorage ('quanta-corrida-profile') e a conta do site sincroniza sozinha.
// Tudo aqui é opcional: sem internet ou sem conta, o jogo segue no modo local.
// Salas: quem entra sem conta participa como convidado (nome + id gerado neste aparelho).
(() => {
  'use strict';
  window.QC = window.QC || {};

  const RETURN = '/corrida/';
  let sb = null;
  let user = null;
  const listeners = [];

  // sessão antiga do login próprio do jogo (antes da conta única)
  try {
    localStorage.removeItem('sb-rnbyvrzarzvkvixtxoli-auth-token');
    localStorage.removeItem('sb-rnbyvrzarzvkvixtxoli-auth-token-code-verifier');
  } catch (e) {}

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

  // o cliente é o mesmo da conta do site (/conta/client.mjs, a mesma instância que /conta/game.mjs usa)
  function siteClient(ms) {
    const load = import('/conta/client.mjs').then((m) => m.client || null);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), ms));
    return Promise.race([load, timeout]).catch(() => null);
  }

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

  // identidade de convidado nas salas (só neste aparelho)
  function guestId() {
    const K = 'quanta-corrida-guest';
    try {
      let id = localStorage.getItem(K);
      if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
        id = (crypto.randomUUID && crypto.randomUUID()) || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
        });
        localStorage.setItem(K, id);
      }
      return id;
    } catch (e) { return null; }
  }

  const Online = {
    get available() { return !!sb; },
    get user() { return user; },
    // login e "Minha conta" são a página de conta do site, que volta para o jogo
    accountUrl: '/conta/?return=' + encodeURIComponent(RETURN),
    guestId,

    async init() {
      if (sb) return true;
      const client = await siteClient(10000);
      if (!client) return false;
      try {
        const { data } = await client.auth.getSession();
        sb = client;
        user = toUser(data && data.session && data.session.user);
        client.auth.onAuthStateChange((_ev, session) => {
          const nu = toUser(session && session.user);
          const changed = (nu && nu.id) !== (user && user.id);
          user = nu;
          if (changed) emit();
        });
        return true;
      } catch (e) {
        sb = null;
        return false;
      }
    },

    onChange(cb) { listeners.push(cb); },

    // { nickname, best_score, ... } ou null se falhou
    async getMe() {
      const r = await rpc('corrida_get_me');
      return r.error ? null : r.data;
    },

    // { ok, nickname } ou { ok:false, error:'invalid'|'blocked'|'taken'|'too_fast'|... }
    async setNickname(nick) {
      const r = await rpc('corrida_set_nickname', { p_nickname: nick });
      return r.error ? { ok: false, error: 'offline' } : r.data;
    },

    // bilhete de uso único pedido no início de cada corrida (o servidor marca a hora)
    async startRun() {
      if (!user) return null;
      const r = await rpc('corrida_start_run');
      return r.error ? null : r.data;
    },

    // run: { runId, mode, score, hits, maxLevel, maxCombo, maxSpeed, durationMs, skin }
    async submitRun(run) {
      if (!run.runId) return { ok: false, error: 'no_run' };
      const r = await rpc('corrida_submit_run', {
        p_run_id: run.runId, p_mode: run.mode || 'mat', p_score: run.score, p_hits: run.hits, p_max_level: run.maxLevel, p_max_combo: run.maxCombo,
        p_max_speed: Math.round(run.maxSpeed * 100) / 100, p_duration_ms: Math.round(run.durationMs), p_skin: run.skin,
      });
      return r.error ? { ok: false, error: r.error } : r.data;
    },

    // [{ rank, nickname, score, skin, is_me }] do modo pedido
    async leaderboard(period, limit, mode) {
      const r = await rpc('corrida_leaderboard', { p_period: period === 'all' ? 'all' : 'week', p_limit: limit || 20, p_mode: mode || 'mat' });
      return r.error ? null : (r.data || []);
    },

    // ---------- salas de turma ----------
    // { ok, code, name, mode } ou { ok:false, error }
    async roomCreate(name, mode, exam) {
      const r = await rpc('corrida_room_create', { p_name: name, p_mode: mode, p_exam: exam || null });
      return r.error ? { ok: false, error: 'offline' } : r.data;
    },
    // { code, name, mode, seed, owner, participants, open } | null (não existe) | undefined (falhou)
    async roomGet(code) {
      const r = await rpc('corrida_room_get', { p_code: code });
      if (r.error) return undefined;
      return r.data || null;
    },
    // run como em submitRun + misses [{k,t,x,a}]; guestName só sem conta; student = { id, pin } quando a sala tem lista da turma
    async roomSubmit(code, run, misses, guestName, student) {
      const r = await rpc('corrida_room_submit', {
        p_code: code, p_name: guestName || '', p_guest_id: user ? null : guestId(),
        p_student_id: student ? student.id : null, p_pin: student ? student.pin : null,
        p_score: run.score, p_hits: run.hits, p_max_level: run.maxLevel, p_max_combo: run.maxCombo,
        p_max_speed: Math.round(run.maxSpeed * 100) / 100, p_duration_ms: Math.round(run.durationMs), p_skin: run.skin,
        p_misses: misses || [],
      }, 12000);
      return r.error ? { ok: false, error: r.error } : r.data;
    },
    // só quem criou a sala: { ok, room, players:[...], misses:[...] }
    async roomReport(code) {
      const r = await rpc('corrida_room_report', { p_code: code }, 12000);
      return r.error ? { ok: false, error: r.error } : r.data;
    },
    // salas de quem está logado
    async roomList() {
      const r = await rpc('corrida_room_list');
      return r.error ? null : (r.data || []);
    },
    // aluno da lista da turma: { ok, id, name } ou { ok:false, error:'wrong_pin'|'locked'|'not_found' }
    async roomCheckStudent(code, id, pin) {
      const r = await rpc('corrida_room_check_student', { p_code: code, p_student_id: id, p_pin: pin });
      return r.error ? { ok: false, error: 'offline' } : r.data;
    },
    // lista da turma (só quem criou a sala)
    async roster(code) {
      const r = await rpc('corrida_room_roster', { p_code: code });
      return r.error ? { ok: false, error: 'offline' } : r.data;
    },
    async rosterAdd(code, names) {
      const r = await rpc('corrida_room_roster_add', { p_code: code, p_names: names });
      return r.error ? { ok: false, error: 'offline' } : r.data;
    },
    async rosterRemove(code, id) {
      const r = await rpc('corrida_room_roster_remove', { p_code: code, p_student_id: id });
      return r.error ? { ok: false, error: 'offline' } : r.data;
    },
    async rosterReset(code, id) {
      const r = await rpc('corrida_room_roster_reset', { p_code: code, p_student_id: id });
      return r.error ? { ok: false, error: 'offline' } : r.data;
    },
    async roomOpen(code, open) {
      const r = await rpc('corrida_room_close', { p_code: code, p_open: !!open });
      return r.error ? { ok: false, error: r.error } : r.data;
    },
  };

  QC.Online = Online;
})();
