// Kart Científico online: ranking (geral e da semana) e salas de turma.
// Usa a conta única do site (/conta/, login Google) e o Supabase "fisora", pelas funções kart_*
// (supabase-fisora/migrations/20260927200000_kart_cientifico.sql). Tudo é opcional: sem internet,
// fora do site (ex.: testes locais) ou sem conta, o jogo segue só com o ranking deste aparelho.

const RETURN = '/kart-cientifico/';
const GUEST_KEY = 'kartcientifico-guest'; // antigo: um id de convidado por aparelho
const GUESTS_KEY = 'kartcientifico-guests'; // um id de convidado por nome neste aparelho
const INIT_MS = 8000; // quanto quem chama init() espera (o carregamento continua depois disso)

let sb = null;
let user = null;
let loadP = null; // carregamento do cliente da conta em andamento (null: não começou ou falhou)
const listeners = new Set();
const notify = () => { for (const cb of listeners) try { cb(Online.user); } catch { /* ignora */ } };

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

const UUID_RE = /^[0-9a-f-]{36}$/;
const newId = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  }));

// Identidade de convidado nas salas de turma: uma por NOME neste aparelho
// (no laboratório, vários alunos revezam o mesmo computador na mesma sala).
function guestId(name) {
  try {
    const key = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const map = JSON.parse(localStorage.getItem(GUESTS_KEY) || '{}') || {};
    let id = map[key];
    if (!id || !UUID_RE.test(id)) {
      // o primeiro nome herda o id antigo do aparelho (as corridas já enviadas continuam dele)
      const old = localStorage.getItem(GUEST_KEY);
      id = !Object.keys(map).length && old && UUID_RE.test(old) ? old : newId();
      map[key] = id;
      localStorage.setItem(GUESTS_KEY, JSON.stringify(map));
    }
    return id;
  } catch {
    return null;
  }
}

// Nome aceito nas salas (mesma regra de corrida_room_clean_name no banco, sem a lista de bloqueio).
export const ROOM_NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9_ .!?ºª-]+$/;
export const cleanRoomName = (t) => String(t || '').replace(/\s+/g, ' ').trim();

// Placar: <modo>-<classe>-<voltas>, ex.: race-100cc-2 ou tt-150cc-3.
export const boardOf = (o) => `${o.mode === 'timetrial' ? 'tt' : 'race'}-${o.cc}-${o.laps}`;
export function parseBoard(b) {
  const m = /^(race|tt)-(50|100|150)cc-(1|2|3|5)$/.exec(b || '');
  return m ? { mode: m[1] === 'tt' ? 'timetrial' : 'race', cc: `${m[2]}cc`, laps: Number(m[3]) } : null;
}

export const Online = {
  get available() { return !!sb; },
  // 'ok' | 'loading' (ainda carregando, rede ou aparelho lento) | 'off' (falhou ou fora do site)
  get status() { return sb ? 'ok' : loadP ? 'loading' : 'off'; },
  // no site o online deveria funcionar; fora dele (testes locais, cópias) é normal não ter
  onSite: /(^|\.)quantaaulas\.com$/i.test(location.hostname),
  get user() { return user && !user.anonymous ? user : null; },
  loginUrl: '/conta/?return=' + encodeURIComponent(RETURN),
  guestId,

  // Carrega o cliente da conta do site (o mesmo de /conta/). Resolve true/false; pode chamar várias vezes.
  // O carregamento segue em segundo plano: o limite de 8 s vale só para quem espera, e um
  // sucesso tardio liga o online (avisa quem chamou onChange). Se falhar, a próxima chamada tenta de novo.
  init() {
    if (sb) return Promise.resolve(true);
    if (!loadP) {
      loadP = (async () => {
        // caminho montado em tempo de execução: o empacotador não tenta resolver o módulo do site
        const url = ['', 'conta', 'client.mjs'].join('/');
        const m = await import(/* @vite-ignore */ url);
        const client = m && m.client;
        if (!client) throw new Error('sem cliente');
        // a sessão pode demorar (renovação do token pela rede): conta dentro do mesmo limite
        const { data } = await client.auth.getSession();
        user = toUser(data && data.session && data.session.user);
        sb = client;
        client.auth.onAuthStateChange((_ev, session) => {
          const nu = toUser(session && session.user);
          const changed = (nu && nu.id) !== (user && user.id);
          user = nu;
          if (changed) notify();
        });
        notify();
        return true;
      })().catch(() => {
        sb = null;
        loadP = null;
        return false;
      });
    }
    return Promise.race([loadP, new Promise((r) => setTimeout(() => r(false), INIT_MS))]);
  },

  // cb(user): conta trocada ou online ligado depois de uma demora
  onChange(cb) { listeners.add(cb); },

  // { nickname, suggest }, null (sem conta) ou undefined (falhou)
  async getMe() {
    if (!Online.user) return null;
    const r = await rpc('kart_get_me');
    return r.error ? undefined : r.data;
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
      p_code: code, p_name: guestName || '', p_guest_id: Online.user ? null : guestId(guestName),
      p_time_ms: Math.round(run.timeMs), p_best_lap_ms: Math.round(run.bestLapMs), p_character: run.character, p_place: run.place,
    }, 12000);
    return r.error ? { ok: false, error: r.error } : r.data;
  },
  // { code, name, board, open, players:[{rank,name,time_ms,best_lap_ms,character,is_me}] } | null
  async roomBoard(code, limit = 30, guestName = '') {
    const r = await rpc('kart_room_board', { p_code: code, p_guest_id: Online.user ? null : guestId(guestName), p_limit: limit });
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
    return r.error ? { ok: false, error: 'offline' } : r.data;
  },
  // Professor tira um aluno do placar da sala (todas as corridas dele). runId: 'id' do relatório.
  async roomRemove(code, runId) {
    const r = await rpc('kart_room_remove', { p_code: code, p_run_id: runId });
    return r.error ? { ok: false, error: 'offline' } : r.data;
  },
};

export const ERR_TEXT = {
  invalid: 'Apelido inválido: use de 3 a 16 letras, números ou espaço.',
  blocked: 'Esse apelido não é permitido. Escolha outro.',
  taken: 'Esse apelido já está em uso.',
  too_fast: 'Espere alguns segundos e tente de novo.',
  offline: 'Sem conexão com o ranking agora.',
  room_offline: 'Sem conexão agora. Tente de novo.',
  anonymous: 'Entre com sua conta para isso.',
  not_found: 'Sala não encontrada. Confira o código.',
  closed: 'Essa sala está fechada.',
  limit: 'Limite de corridas atingido por hoje.',
  room_limit: 'Esta sala atingiu o limite de corridas.',
  room_busy: 'Muita gente entrando na sala agora. Tente de novo em alguns minutos.',
  invalid_name: 'Esse nome não é aceito na sala. Volte em Turma e entre com outro nome.',
  room_name: 'Use só letras, números, espaço e . ! ? º ª - (sem vírgula, barra ou parênteses).',
  no_run: 'Esta corrida não valeu para o ranking.',
  run_invalid: 'Este tempo não foi aceito pelo ranking.',
  no_ticket: 'Sua conta ainda não estava conectada na largada: esta corrida não valeu para o ranking online.',
};

// Texto de erro de um envio de corrida ('invalid' ali é o tempo, não o apelido).
export const runErrText = (e, fallback = ERR_TEXT.offline) => (e === 'invalid' ? ERR_TEXT.run_invalid : ERR_TEXT[e] || fallback);
