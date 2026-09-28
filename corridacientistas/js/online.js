// Kart Científico online: ranking (geral e da semana) e salas de turma.
// Usa a conta única do site (/conta/, login Google) e o Supabase "fisora", pelas funções kart_*
// (supabase-fisora/migrations/20260927200000_kart_cientifico.sql). Tudo é opcional: sem internet,
// fora do site (ex.: testes locais) ou sem conta, o jogo segue só com o ranking deste aparelho.

const RETURN = '/kart-cientifico/';
const GUEST_KEY = 'kartcientifico-guest';

let sb = null;
let user = null;
let initP = null;
const listeners = new Set();

function toUser(u) {
  if (!u) return null;
  const m = u.user_metadata || {};
  return {
    id: u.id,
    name: m.full_name || m.name || '',
    firstName: String(m.given_name || m.full_name || m.name || '').split(' ')[0],
    anonymous: !!u.is_anonymous,
  };
}

// Chamada RPC com tempo-limite: devolve { data } ou { error }.
async function rpc(fn, args, ms = 8000) {
  if (!sb) return { error: 'offline' };
  try {
    const call = sb.rpc(fn, args || {});
    const timeout = new Promise((r) => setTimeout(() => r({ error: { message: 'timeout' } }), ms));
    const res = await Promise.race([call, timeout]);
    if (res.error) return { error: res.error.message || 'error' };
    return { data: res.data };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

// Identidade de convidado nas salas de turma (só neste aparelho).
function guestId() {
  try {
    let id = localStorage.getItem(GUEST_KEY);
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
      id = crypto.randomUUID ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 3) | 8).toString(16);
        });
      localStorage.setItem(GUEST_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

// Placar: <modo>-<classe>-<voltas>, ex.: race-100cc-2 ou tt-150cc-3.
export const boardOf = (o) => `${o.mode === 'timetrial' ? 'tt' : 'race'}-${o.cc}-${o.laps}`;
export function parseBoard(b) {
  const m = /^(race|tt)-(50|100|150)cc-(1|2|3|5)$/.exec(b || '');
  return m ? { mode: m[1] === 'tt' ? 'timetrial' : 'race', cc: `${m[2]}cc`, laps: Number(m[3]) } : null;
}

export const Online = {
  get available() { return !!sb; },
  // cliente do Supabase (a corrida ao vivo usa os canais Realtime dele: netplay.js)
  get client() { return sb; },
  get user() { return user && !user.anonymous ? user : null; },
  loginUrl: '/conta/?return=' + encodeURIComponent(RETURN),
  guestId,

  // Carrega o cliente da conta do site (o mesmo de /conta/). Resolve true/false; pode chamar várias vezes.
  init() {
    if (initP) return initP;
    initP = (async () => {
      try {
        // caminho montado em tempo de execução: o empacotador não tenta resolver o módulo do site
        const url = ['', 'conta', 'client.mjs'].join('/');
        const load = import(/* @vite-ignore */ url).then((m) => m.client || null);
        const client = await Promise.race([load, new Promise((r) => setTimeout(() => r(null), 8000))]);
        if (!client) return false;
        const { data } = await client.auth.getSession();
        sb = client;
        user = toUser(data && data.session && data.session.user);
        client.auth.onAuthStateChange((_ev, session) => {
          const nu = toUser(session && session.user);
          const changed = (nu && nu.id) !== (user && user.id);
          user = nu;
          if (changed) for (const cb of listeners) try { cb(Online.user); } catch { /* ignora */ }
        });
        return true;
      } catch {
        sb = null;
        return false;
      }
    })();
    return initP;
  },

  onChange(cb) { listeners.add(cb); },

  // { nickname, suggest } ou null
  async getMe() {
    if (!Online.user) return null;
    const r = await rpc('kart_get_me');
    return r.error ? null : r.data;
  },

  // { ok, nickname } ou { ok:false, error:'invalid'|'blocked'|'taken'|'too_fast'|'offline' }
  async setNickname(nick) {
    const r = await rpc('kart_set_nickname', { p_nickname: nick });
    return r.error ? { ok: false, error: 'offline' } : r.data;
  },

  // Bilhete de uso único pedido na largada (o servidor marca a hora). null sem conta.
  async startRun(board) {
    if (!Online.user) return null;
    const r = await rpc('kart_start_run', { p_board: board });
    return r.error ? null : r.data;
  },

  // run: { runId, board, timeMs, bestLapMs, character, place } → { ok, best, week_best, rank_all, rank_week } | { ok:false, error }
  async submitRun(run) {
    if (!run.runId) return { ok: false, error: 'no_run' };
    const r = await rpc('kart_submit_run', {
      p_run_id: run.runId, p_board: run.board, p_time_ms: Math.round(run.timeMs), p_best_lap_ms: Math.round(run.bestLapMs),
      p_character: run.character, p_place: run.place,
    });
    return r.error ? { ok: false, error: r.error } : r.data;
  },

  // [{ rank, nickname, time_ms, best_lap_ms, char_id, is_me }] ou null
  async leaderboard(board, period = 'week', limit = 10) {
    const r = await rpc('kart_leaderboard', { p_board: board, p_period: period === 'all' ? 'all' : 'week', p_limit: limit });
    return r.error ? null : r.data || [];
  },

  // ---------- salas de turma ----------
  async roomCreate(name, board) {
    const r = await rpc('kart_room_create', { p_name: name, p_board: board });
    return r.error ? { ok: false, error: 'offline' } : r.data;
  },
  // { code, name, board, owner, participants, open } | null (não existe) | undefined (falhou)
  async roomGet(code) {
    const r = await rpc('kart_room_get', { p_code: code });
    if (r.error) return undefined;
    return r.data || null;
  },
  async roomSubmit(code, run, guestName) {
    const r = await rpc('kart_room_submit', {
      p_code: code, p_name: guestName || '', p_guest_id: Online.user ? null : guestId(),
      p_time_ms: Math.round(run.timeMs), p_best_lap_ms: Math.round(run.bestLapMs), p_character: run.character, p_place: run.place,
    }, 12000);
    return r.error ? { ok: false, error: r.error } : r.data;
  },
  // { code, name, board, open, players:[{rank,name,time_ms,best_lap_ms,character,is_me}] } | null
  async roomBoard(code, limit = 30) {
    const r = await rpc('kart_room_board', { p_code: code, p_guest_id: Online.user ? null : guestId(), p_limit: limit });
    return r.error ? undefined : r.data || null;
  },
  async roomReport(code) {
    const r = await rpc('kart_room_report', { p_code: code }, 12000);
    return r.error ? { ok: false, error: r.error } : r.data;
  },
  async roomList() {
    const r = await rpc('kart_room_list');
    return r.error ? null : r.data || [];
  },
  async roomOpen(code, open) {
    const r = await rpc('kart_room_close', { p_code: code, p_open: !!open });
    return r.error ? { ok: false, error: r.error } : r.data;
  },
};

export const ERR_TEXT = {
  invalid: 'Apelido inválido: use de 3 a 16 letras, números ou espaço.',
  blocked: 'Esse apelido não é permitido. Escolha outro.',
  taken: 'Esse apelido já está em uso.',
  too_fast: 'Espere alguns segundos e tente de novo.',
  offline: 'Sem conexão com o ranking agora.',
  anonymous: 'Entre com sua conta para isso.',
  not_found: 'Sala não encontrada. Confira o código.',
  closed: 'Essa sala está fechada.',
  limit: 'Limite de corridas atingido por hoje.',
  invalid_name: 'Nome inválido para a sala.',
  no_run: 'Esta corrida não valeu para o ranking.',
};
