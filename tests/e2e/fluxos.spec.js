// Fluxos ponta a ponta do portal /professores/ com um Supabase falso "com memória":
// o banco em memória (e a sessão) sobrevivem às navegações, então cada teste atravessa
// várias páginas como um usuário de verdade:
//   busca -> perfil -> "Enviar mensagem" -> login -> formulário -> conversa
//   perfil -> avaliação (can_review) · painel (professor e aluno, todas as abas)
//   painel -> planos -> Mercado Pago -> pagamento -> painel · denúncia -> admin suspende
import { test, expect } from '@playwright/test';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': '*',
  'x-supabase-api-version': '2024-01-01',
};

const AUTH_KEY = 'sb-supabase-auth-token'; // 'sb-' + 'supabase' (1º rótulo de supabase.test) + '-auth-token'
const PASSWORD = 'segredo123';
const STUDENT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const TUTOR_ID = '11111111-1111-4111-8111-111111111111';
const TUTOR2_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const ADMIN_ID = 'adadadad-0000-4000-8000-000000000001';
const NEW_CONV = 'c0000000-0000-4000-8000-0000000000ff';
const PAY_ID = 'b0000000-0000-4000-8000-000000000001';
const MP_URL = 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=fluxo-123';
const XSS = '<img src=x onerror=window.__xss=1>';
const DAY = 86_400_000;
const at = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

const SUBJECTS = [
  { id: 1, slug: 'fisica', name: 'Física', category: 'Exatas' },
  { id: 2, slug: 'matematica', name: 'Matemática', category: 'Exatas' },
  { id: 3, slug: 'ingles', name: 'Inglês', category: 'Idiomas' },
];
const PLANS = [
  { code: 'basico', name: 'Básico', price_cents_month: 0, max_subjects: 3, rank_tier: 0, features: ['Perfil público na busca', 'Até 3 matérias'] },
  { code: 'profissional', name: 'Profissional', price_cents_month: 2990, max_subjects: 10, rank_tier: 1, features: ['Até 10 matérias', 'Prioridade na busca'] },
  { code: 'premium', name: 'Premium', price_cents_month: 5990, max_subjects: 30, rank_tier: 2, features: ['Até 30 matérias', 'Selo Destaque', 'Topo da busca'] },
];
// Mesmo cálculo de plan_price (1x, 3x0,90, 12x0,75)
const PRICES = { profissional: { 1: 2990, 3: 8073, 12: 26910 }, premium: { 1: 5990, 3: 16173, 12: 53910 } };

// ---------- "Banco" em memória ----------

function profileRow(id, full_name, role = 'student', extra = {}) {
  return {
    id, role, full_name, avatar_path: null, is_admin: false, banned_at: null,
    terms_accepted_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    ...extra,
  };
}

function tutorRow(user_id, extra = {}) {
  return {
    user_id, slug: '', headline: '', bio: '', hourly_rate_cents: null, mode_online: true, mode_presencial: false,
    uf: null, city_ibge: null, city_name: null, published: true, suspended: false, plan: 'basico', plan_expires_at: null,
    rating_avg: 0, rating_count: 0, last_active_at: at(-2 * 3600e3), created_at: '2026-01-10T12:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    ...extra,
  };
}

function makeDb() {
  return {
    users: [
      { id: STUDENT_ID, email: 'maria@exemplo.test' },
      { id: TUTOR_ID, email: 'ana@exemplo.test' },
      { id: TUTOR2_ID, email: 'bruno@exemplo.test' },
      { id: ADMIN_ID, email: 'admin@exemplo.test' },
    ],
    profiles: [
      profileRow(STUDENT_ID, 'Maria Souza'),
      profileRow(TUTOR_ID, 'Ana Silva', 'tutor'),
      profileRow(TUTOR2_ID, 'Bruno Costa', 'tutor'),
      profileRow(OTHER_ID, 'Carla Dias'),
      profileRow(ADMIN_ID, 'Admin Quanta', 'student', { is_admin: true }),
    ],
    tutor_profiles: [
      tutorRow(TUTOR_ID, {
        slug: 'ana-silva', headline: 'Matemática e Física para o ENEM', bio: `Aulas com muitos exercícios.\n${XSS}`,
        hourly_rate_cents: 8000, mode_presencial: true, uf: 'SP', city_ibge: 3550308, city_name: 'São Paulo',
        plan: 'premium', plan_expires_at: at(60 * DAY), rating_avg: 4, rating_count: 1,
      }),
      tutorRow(TUTOR2_ID, { slug: 'bruno-costa', headline: 'Inglês para conversação', hourly_rate_cents: 6000 }),
    ],
    tutor_subjects: [
      { tutor_id: TUTOR_ID, subject_id: 2, levels: ['medio', 'vestibular'] },
      { tutor_id: TUTOR_ID, subject_id: 1, levels: [] },
      { tutor_id: TUTOR2_ID, subject_id: 3, levels: ['adulto'] },
    ],
    reviews: [
      { id: 1, tutor_id: TUTOR_ID, student_id: OTHER_ID, rating: 4, comment: 'Muito paciente.', status: 'published', created_at: at(-3 * DAY), updated_at: at(-3 * DAY) },
    ],
    conversations: [],
    messages: [],
    reports: [],
    payments: [],
    questions: [],
    answers: [],
    canReview: new Set(), // professores que o aluno logado pode avaliar
    unread: 0,
    tokens: new Map(), // access_token -> uid
    seq: { token: 0, message: 100, review: 100, report: 1 },
  };
}

const shortName = (name) => {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return 'Usuário';
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0];
};

function recomputeRating(db, tutorId) {
  const pub = db.reviews.filter((r) => r.tutor_id === tutorId && r.status === 'published');
  const t = db.tutor_profiles.find((x) => x.user_id === tutorId);
  if (!t) return;
  t.rating_count = pub.length;
  t.rating_avg = pub.length ? Math.round((pub.reduce((s, r) => s + r.rating, 0) / pub.length) * 100) / 100 : 0;
}

// Linha como o PostgREST devolveria com os embeds usados pelas páginas
function view(db, table, row) {
  const prof = (id) => db.profiles.find((p) => p.id === id);
  const tutor = (id) => db.tutor_profiles.find((t) => t.user_id === id);
  switch (table) {
    case 'profiles': {
      const t = tutor(row.id);
      return { ...row, tutor_profiles: t ? { ...t } : null };
    }
    case 'tutor_profiles': {
      const p = prof(row.user_id);
      return {
        ...row,
        profiles: p ? { full_name: p.full_name, avatar_path: p.avatar_path } : null,
        tutor_subjects: db.tutor_subjects.filter((s) => s.tutor_id === row.user_id)
          .map((s) => ({ levels: s.levels, subjects: SUBJECTS.find((x) => x.id === s.subject_id) || null })),
      };
    }
    case 'reviews': {
      const t = tutor(row.tutor_id);
      const tp = prof(row.tutor_id);
      return {
        ...row,
        reviewer_name: shortName(prof(row.student_id)?.full_name),
        tutor: t ? { slug: t.slug, profile: tp ? { full_name: tp.full_name, avatar_path: tp.avatar_path } : null } : null,
      };
    }
    case 'questions':
      return { ...row, subjects: SUBJECTS.find((s) => s.id === row.subject_id) || null };
    case 'answers': {
      const q = db.questions.find((x) => x.id === row.question_id);
      return { ...row, questions: q ? { id: q.id, title: q.title, status: q.status } : null };
    }
    default:
      return { ...row };
  }
}

// RLS mínimo que muda o que os fluxos veem
function visible(db, table, row, me) {
  const admin = db.profiles.find((p) => p.id === me)?.is_admin === true;
  if (table === 'tutor_profiles') return admin || row.user_id === me || (row.published && !row.suspended);
  if (table === 'payments') return row.user_id === me;
  if (table === 'reports') return admin;
  if (table === 'conversations') return me && (row.student_id === me || row.tutor_id === me);
  if (table === 'reviews') return admin || row.status === 'published' || row.student_id === me;
  return true;
}

// ---------- Filtros no formato do PostgREST ----------

const SKIP_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);

function parseIn(raw) {
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '');
  return inner.split(',').map((v) => v.replace(/^"|"$/g, ''));
}

function compare(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (a !== null && a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function matches(row, col, expr) {
  let e = expr;
  let not = false;
  if (e.startsWith('not.')) { not = true; e = e.slice(4); }
  const dot = e.indexOf('.');
  const op = e.slice(0, dot);
  const raw = e.slice(dot + 1);
  const v = row[col];
  let ok = true;
  if (op === 'eq') ok = String(v) === raw;
  else if (op === 'neq') ok = String(v) !== raw;
  else if (op === 'gt') ok = v != null && compare(v, raw) > 0;
  else if (op === 'gte') ok = v != null && compare(v, raw) >= 0;
  else if (op === 'lt') ok = v != null && compare(v, raw) < 0;
  else if (op === 'lte') ok = v != null && compare(v, raw) <= 0;
  else if (op === 'in') ok = parseIn(raw).includes(String(v));
  else if (op === 'is') ok = raw === 'null' ? v == null : String(v) === raw;
  return not ? !ok : ok;
}

function filterRows(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (SKIP_PARAMS.has(k) || k.includes('.')) continue;
    out = out.filter((r) => matches(r, k, v));
  }
  return out;
}

function orderRows(rows, order) {
  if (!order) return rows;
  const keys = order.split(',').map((part) => {
    const [col, ...mods] = part.split('.');
    return { col, desc: mods.includes('desc'), nullsFirst: mods.includes('nullsfirst') };
  });
  return rows.slice().sort((a, b) => {
    for (const k of keys) {
      const x = a[k.col];
      const y = b[k.col];
      if (x == null && y == null) continue;
      if (x == null) return k.nullsFirst ? -1 : 1;
      if (y == null) return k.nullsFirst ? 1 : -1;
      const c = compare(x, y);
      if (c) return k.desc ? -c : c;
    }
    return 0;
  });
}

// ---------- Supabase falso ----------

/**
 * Instala o Supabase falso na página (REST, RPC, Auth, Functions, Realtime) e o checkout do MP.
 * Retorna { calls } com todas as requisições feitas ao supabase.test.
 */
async function fakeSupabase(page, db) {
  const calls = [];
  const ok = (body, status = 200, headers = {}) => ({
    status, contentType: 'application/json', headers: { ...CORS, ...headers }, body: body === undefined ? '' : JSON.stringify(body),
  });
  const pgError = (status, code, message) => ok({ code, message, details: null, hint: null }, status);

  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname.endsWith('mercadopago.com.br')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Mercado Pago</title><h1>Checkout do Mercado Pago (teste)</h1>' });
    }
    if (url.hostname !== 'supabase.test') {
      // Google Fonts etc.: vazio, sem rede
      return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css', body: '' });
    }
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

    const headers = req.headers();
    const token = (headers.authorization || '').replace(/^Bearer\s+/i, '');
    const me = db.tokens.get(token) || null;
    let body = null;
    const raw = req.postData();
    if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
    const p = url.pathname;
    calls.push({ method, path: p, url, body, headers, me });

    // ---- Auth ----
    if (p === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type');
      let uid = null;
      if (grant === 'password') {
        const u = db.users.find((x) => x.email === body?.email);
        if (!u || body?.password !== PASSWORD) {
          return route.fulfill(ok({ code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400));
        }
        uid = u.id;
      } else {
        uid = db.tokens.get(body?.refresh_token) || null;
        if (!uid) return route.fulfill(ok({ error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, 400));
      }
      const access = `FAKE.JWT.${++db.seq.token}`;
      db.tokens.set(access, uid);
      const user = db.users.find((x) => x.id === uid);
      return route.fulfill(ok({
        access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: access,
        user: { id: uid, aud: 'authenticated', role: 'authenticated', email: user.email, app_metadata: { provider: 'email' }, user_metadata: {} },
      }));
    }
    if (p === '/auth/v1/user') {
      if (!me) return route.fulfill(ok({ code: 'no_session', msg: 'no session' }, 401));
      const u = db.users.find((x) => x.id === me);
      return route.fulfill(ok({ id: me, aud: 'authenticated', role: 'authenticated', email: u.email, created_at: '2026-09-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {} }));
    }
    if (p === '/auth/v1/logout') {
      db.tokens.delete(token);
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }
    if (p.startsWith('/auth/v1/')) return route.fulfill(ok({}));

    // ---- Edge Functions ----
    if (p === '/functions/v1/create-checkout') {
      if (!me) return route.fulfill(ok({ error: 'Entre na sua conta para continuar.' }, 401));
      const amount = PRICES[body?.plan]?.[Number(body?.months)];
      if (!amount) return route.fulfill(ok({ error: 'Plano inválido.' }, 400));
      db.payments.push({
        id: PAY_ID, user_id: me, plan: body.plan, months: Number(body.months), amount_cents: amount,
        status: 'pending', applied_at: null, created_at: at(),
      });
      return route.fulfill(ok({ init_point: MP_URL, payment_id: PAY_ID }));
    }
    if (p.startsWith('/functions/v1/')) return route.fulfill(ok({ ok: true }));

    // ---- RPC ----
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.slice('/rest/v1/rpc/'.length);
      const b = body || {};
      switch (fn) {
        case 'search_tutors': {
          let rows = db.tutor_profiles.filter((t) => t.published && !t.suspended);
          if (b.p_materia) {
            const s = SUBJECTS.find((x) => x.slug === b.p_materia);
            rows = rows.filter((t) => s && db.tutor_subjects.some((ts) => ts.tutor_id === t.user_id && ts.subject_id === s.id));
          }
          const rank = { premium: 2, profissional: 1, basico: 0 };
          rows = rows.slice().sort((x, y) => rank[y.plan] - rank[x.plan]);
          return route.fulfill(ok(rows.map((t) => {
            const pr = db.profiles.find((x) => x.id === t.user_id);
            return {
              user_id: t.user_id, slug: t.slug, full_name: pr.full_name, avatar_path: pr.avatar_path, headline: t.headline,
              hourly_rate_cents: t.hourly_rate_cents, uf: t.uf, city_name: t.city_name, mode_online: t.mode_online,
              mode_presencial: t.mode_presencial, rating_avg: t.rating_avg, rating_count: t.rating_count, plan: t.plan,
              subjects: db.tutor_subjects.filter((ts) => ts.tutor_id === t.user_id).map((ts) => SUBJECTS.find((x) => x.id === ts.subject_id).name).sort(),
              total: rows.length,
            };
          })));
        }
        case 'unread_count': return route.fulfill(ok(me ? db.unread : 0));
        case 'mark_read': return route.fulfill({ status: 204, headers: CORS, body: '' });
        case 'can_review': return route.fulfill(ok(Boolean(me) && db.canReview.has(b.p_tutor)));
        case 'plan_price': {
          const cents = PRICES[b.p_plan]?.[b.p_months];
          return route.fulfill(cents == null ? pgError(400, 'P0001', 'Plano inválido.') : ok(cents));
        }
        case 'start_conversation': {
          if (!me) return route.fulfill(pgError(401, 'PGRST301', 'JWT expired'));
          let conv = db.conversations.find((c) => c.student_id === me && c.tutor_id === b.p_tutor);
          if (!conv) {
            conv = { id: NEW_CONV, student_id: me, tutor_id: b.p_tutor, subject_id: b.p_subject, created_at: at(), last_message_at: at() };
            db.conversations.push(conv);
          }
          db.messages.push({ id: ++db.seq.message, conversation_id: conv.id, sender_id: me, body: b.p_body, created_at: at() });
          conv.last_message_at = at();
          return route.fulfill(ok(conv.id));
        }
        case 'list_conversations': {
          const rows = db.conversations.filter((c) => c.student_id === me || c.tutor_id === me).map((c) => {
            const iAmStudent = c.student_id === me;
            const other = db.profiles.find((x) => x.id === (iAmStudent ? c.tutor_id : c.student_id));
            const last = db.messages.filter((m) => m.conversation_id === c.id).pop();
            return {
              // Como list_conversations (migração de privacidade): o professor vê o aluno abreviado
              id: c.id, other_id: other.id, other_name: iAmStudent ? other.full_name : shortName(other.full_name), other_avatar: other.avatar_path,
              other_slug: iAmStudent ? db.tutor_profiles.find((t) => t.user_id === other.id)?.slug ?? null : null,
              i_am: iAmStudent ? 'student' : 'tutor', last_message_at: c.last_message_at,
              last_body: last ? last.body.slice(0, 120) : '', unread: false,
            };
          });
          return route.fulfill(ok(rows));
        }
        case 'admin_moderate': {
          const admin = db.profiles.find((x) => x.id === me)?.is_admin;
          if (!admin) return route.fulfill(pgError(400, 'P0001', 'Apenas administradores.'));
          if (b.p_action === 'suspend' || b.p_action === 'unsuspend') {
            const t = db.tutor_profiles.find((x) => x.user_id === b.p_id);
            t.suspended = b.p_action === 'suspend';
          }
          if (b.p_report != null) {
            const r = db.reports.find((x) => x.id === b.p_report);
            r.status = b.p_action === 'dismiss' ? 'dismissed' : 'resolved';
            r.resolved_at = at();
          }
          return route.fulfill({ status: 204, headers: CORS, body: '' });
        }
        case 'export_my_data': return route.fulfill(ok({ profile: db.profiles.find((x) => x.id === me) || null }));
        default: return route.fulfill(ok(null));
      }
    }

    // ---- REST (tabelas) ----
    if (p.startsWith('/rest/v1/')) {
      const table = p.slice('/rest/v1/'.length);
      const wantsObject = (headers.accept || '').includes('vnd.pgrst.object');
      const prefer = headers.prefer || '';
      const wantsRows = prefer.includes('return=representation');
      const stored = table === 'subjects' ? SUBJECTS : table === 'plans' ? PLANS : db[table];
      if (!Array.isArray(stored)) return route.fulfill(ok([], 200, { 'content-range': '*/0' }));
      const reply = (rows, status = 200) => {
        if (wantsObject) {
          if (rows.length !== 1) return route.fulfill(pgError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned'));
          return route.fulfill(ok(rows[0], status));
        }
        return route.fulfill(ok(rows, status));
      };

      if (method === 'GET' || method === 'HEAD') {
        let rows = stored.filter((r) => visible(db, table, r, me)).map((r) => view(db, table, r));
        rows = orderRows(filterRows(rows, url.searchParams), url.searchParams.get('order'));
        const total = rows.length;
        const off = Number(url.searchParams.get('offset') || 0);
        const lim = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : rows.length;
        const pageRows = rows.slice(off, off + lim);
        const range = pageRows.length ? `${off}-${off + pageRows.length - 1}/${total}` : `*/${total}`;
        if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...CORS, 'content-range': range }, body: '' });
        if (wantsObject) return reply(pageRows);
        return route.fulfill(ok(pageRows, 200, { 'content-range': range }));
      }

      if (method === 'POST') {
        const list = Array.isArray(body) ? body : [body];
        const created = list.map((b) => {
          let row = { ...b };
          if (table === 'messages') {
            row = { id: ++db.seq.message, sender_id: me, created_at: at(), ...b };
            const conv = db.conversations.find((c) => c.id === b.conversation_id);
            if (conv) conv.last_message_at = row.created_at;
          } else if (table === 'reviews') {
            row = { id: ++db.seq.review, student_id: me, status: 'published', created_at: at(), updated_at: at(), comment: '', ...b };
          } else if (table === 'reports') {
            row = { id: db.seq.report++, reporter_id: me, status: 'open', created_at: at(), resolved_at: null, details: '', ...b };
          }
          stored.push(row);
          if (table === 'reviews') recomputeRating(db, row.tutor_id);
          return view(db, table, row);
        });
        return wantsRows ? reply(created, 201) : route.fulfill({ status: 201, headers: CORS, body: '' });
      }

      if (method === 'PATCH' || method === 'DELETE') {
        const hits = filterRows(stored.filter((r) => visible(db, table, r, me)), url.searchParams);
        for (const r of hits) {
          if (method === 'PATCH') Object.assign(r, body);
          else stored.splice(stored.indexOf(r), 1);
        }
        if (table === 'reviews') hits.forEach((r) => recomputeRating(db, r.tutor_id));
        return wantsRows ? reply(hits.map((r) => view(db, table, r))) : route.fulfill({ status: 204, headers: CORS, body: '' });
      }
    }
    return route.fulfill(ok({}));
  });

  // Realtime (protocolo Phoenix): aceita os canais e responde heartbeats
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      const [joinRef, ref, topic, event, payload] = Array.isArray(msg)
        ? msg : [msg.join_ref, msg.ref, msg.topic, msg.event, msg.payload];
      const reply = (response = {}) => ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]));
      if (event === 'heartbeat' || event === 'phx_leave' || event === 'access_token') reply();
      else if (event === 'phx_join') {
        const changes = (payload?.config?.postgres_changes || []).map((c, i) => ({ ...c, id: 7000 + i }));
        reply({ postgres_changes: changes });
      }
    });
  });

  return { calls };
}

/** Sessão salva do supabase-js (só na 1ª página da aba: depois de "Sair" não reaparece). */
async function seedLogin(page, db, uid) {
  const access = `FAKE.JWT.seed-${uid}`;
  db.tokens.set(access, uid);
  const email = db.users.find((u) => u.id === uid).email;
  await page.addInitScript(([key, token, user]) => {
    if (sessionStorage.getItem('pfSeeded')) return;
    sessionStorage.setItem('pfSeeded', '1');
    localStorage.setItem(key, JSON.stringify({
      access_token: token, refresh_token: token, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user,
    }));
  }, [AUTH_KEY, access, { id: uid, aud: 'authenticated', role: 'authenticated', email }]);
}

async function login(page, email) {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

function trackErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

const rpcCalls = (calls, fn) => calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`);

// ---------------------------------------------------------------------------

test('busca → perfil → "Enviar mensagem" sem login → entrar → formulário reabre → conversa criada', async ({ page }) => {
  const errors = trackErrors(page);
  const db = makeDb();
  const { calls } = await fakeSupabase(page, db);

  // Busca: premium primeiro; filtro por matéria vai para a RPC
  await page.goto('/professores/');
  const cards = page.locator('#resultados .pf-tutor-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Destaque');
  await page.getByLabel('Matéria', { exact: true }).selectOption('matematica');
  await expect(page).toHaveURL(/[?&]materia=matematica/);
  await expect(cards).toHaveCount(1);
  expect(rpcCalls(calls, 'search_tutors').pop().body.p_materia).toBe('matematica');

  // Perfil pela URL amigável, com todos os componentes montados
  await cards.first().getByRole('link', { name: 'Ana Silva' }).click();
  await page.waitForURL('**/professores/p/ana-silva');
  await expect(page.getByRole('heading', { level: 1, name: 'Ana Silva' })).toBeVisible();
  await expect(page.locator('.pf-bio')).toContainText(XSS);
  await expect(page.locator('#avaliacoes').getByRole('heading', { name: 'Avaliações' })).toBeVisible();
  await expect(page.locator('#avaliacoes')).toContainText('Muito paciente.');
  await expect(page.locator('#contato').getByRole('button', { name: /Denunciar este perfil/ })).toBeVisible();
  // Sem respostas no tira-dúvidas: a seção some
  await expect(page.locator('#respostas')).toBeHidden();

  // Sem login: vai para o entrar e volta ao perfil com #mensagem
  await page.locator('#perfilContato').getByRole('button', { name: 'Enviar mensagem' }).click();
  await page.waitForURL(/\/professores\/entrar\.html/);
  expect(new URL(page.url()).searchParams.get('next')).toBe('/professores/p/ana-silva#mensagem');
  await login(page, 'maria@exemplo.test');

  // De volta ao perfil: o formulário abre sozinho e o #mensagem sai da URL
  const dlg = page.getByRole('dialog', { name: 'Mensagem para Ana Silva' });
  await expect(dlg).toBeVisible();
  await expect(page).toHaveURL(/\/professores\/p\/ana-silva$/);
  await expect(page.locator('#authSlot .pf-nav-user-name')).toHaveText('Maria');
  await dlg.getByLabel('Sua mensagem').fill('Olá, Ana! Preciso de aulas de matemática para o ENEM.');
  await dlg.getByLabel('Matéria (opcional)').selectOption({ label: 'Matemática' });
  await dlg.getByRole('button', { name: 'Enviar', exact: true }).click();

  // Conversa aberta em mensagens.html
  await page.waitForURL(`**/professores/mensagens.html?c=${NEW_CONV}`);
  expect(rpcCalls(calls, 'start_conversation').map((c) => c.body)).toEqual([
    { p_tutor: TUTOR_ID, p_body: 'Olá, Ana! Preciso de aulas de matemática para o ENEM.', p_subject: 2 },
  ]);
  await expect(page.locator('#bubbles .pf-msg--me')).toHaveCount(1);
  await expect(page.locator('#bubbles')).toContainText('Preciso de aulas de matemática para o ENEM.');
  await expect(page.locator('.pf-thread')).toContainText('Ana Silva');
  await expect.poll(() => rpcCalls(calls, 'mark_read').length).toBeGreaterThan(0);
  expect(rpcCalls(calls, 'mark_read')[0].body).toEqual({ p_conv: NEW_CONV });

  // Resposta pelo compositor: só (conversation_id, body)
  const composer = page.locator('#msgInput');
  await composer.fill('Pode ser terça às 19h?');
  await composer.press('Enter');
  await expect(page.locator('#bubbles .pf-msg--me')).toHaveCount(2);
  const insert = calls.find((c) => c.method === 'POST' && c.path === '/rest/v1/messages');
  expect(insert.body).toEqual({ conversation_id: NEW_CONV, body: 'Pode ser terça às 19h?' });
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('nav logada: badge de não lidas e link do painel em todas as páginas públicas', async ({ page }) => {
  const errors = trackErrors(page);
  const db = makeDb();
  db.unread = 3;
  await seedLogin(page, db, STUDENT_ID);
  await fakeSupabase(page, db);
  for (const path of ['/professores/', '/professores/p/ana-silva', '/professores/duvidas.html', '/professores/planos.html']) {
    await page.goto(path);
    const msg = page.locator('#authSlot a[data-unread-link]');
    await expect(msg).toHaveAttribute('aria-label', 'Mensagens (3 não lidas)');
    await expect(msg.locator('[data-unread-badge]')).toHaveText('3');
    await expect(page.locator('#authSlot .pf-nav-user')).toHaveAttribute('href', '/professores/painel.html');
  }
  // Sair limpa a sessão e volta à busca
  await page.locator('#authSlot').getByRole('button', { name: 'Sair' }).click();
  await page.waitForURL('**/professores/');
  await expect(page.locator('#authSlot').getByRole('link', { name: 'Entrar' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('perfil: aluno com resposta do professor avalia (can_review) e a nota do cabeçalho atualiza', async ({ page }) => {
  const errors = trackErrors(page);
  const db = makeDb();
  db.canReview.add(TUTOR_ID);
  await seedLogin(page, db, STUDENT_ID);
  const { calls } = await fakeSupabase(page, db);

  await page.goto('/professores/p/ana-silva');
  const head = page.locator('.pf-profile-head');
  await expect(head.getByRole('img', { name: 'Nota 4,0 de 5, 1 avaliação' })).toBeVisible();

  const sec = page.locator('#avaliacoes');
  const box = sec.locator('.pf-rv-formbox');
  await expect(box.getByRole('heading', { name: 'Avalie este professor' })).toBeVisible();
  expect(rpcCalls(calls, 'can_review')[0].body).toEqual({ p_tutor: TUTOR_ID });

  await box.getByRole('radio', { name: '5 estrelas: Excelente' }).check();
  await box.getByLabel('Comentário (opcional)').fill(`Explica muito bem. ${XSS}`);
  await box.getByRole('button', { name: 'Publicar avaliação' }).click();

  const own = sec.locator('.pf-rv-own');
  await expect(own.getByRole('heading', { name: 'Sua avaliação' })).toBeVisible();
  const post = calls.find((c) => c.method === 'POST' && c.path === '/rest/v1/reviews');
  expect(post.body).toEqual({ tutor_id: TUTOR_ID, rating: 5, comment: `Explica muito bem. ${XSS}` });
  expect(post.url.searchParams.get('select')).toBeTruthy();

  // Lista e cabeçalho refletem a nova avaliação (4 + 5 = média 4,5 com 2 avaliações)
  await expect(sec.locator('.pf-rv-list')).toContainText(`Explica muito bem. ${XSS}`);
  await expect(head.getByRole('img', { name: 'Nota 4,5 de 5, 2 avaliações' })).toBeVisible();
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('perfil: sem resposta do professor (can_review false) não há formulário', async ({ page }) => {
  const db = makeDb();
  await seedLogin(page, db, STUDENT_ID);
  const { calls } = await fakeSupabase(page, db);
  await page.goto('/professores/p/ana-silva');
  const sec = page.locator('#avaliacoes');
  await expect(sec).toContainText('Você poderá avaliar depois que o professor responder sua mensagem.');
  await expect(sec.getByRole('button', { name: 'Publicar avaliação' })).toHaveCount(0);
  expect(calls.some((c) => c.method === 'POST' && c.path === '/rest/v1/reviews')).toBe(false);
});

test('painel do professor: todas as abas montam sem erro (hash e teclado)', async ({ page }) => {
  const errors = trackErrors(page);
  const db = makeDb();
  db.answers.push({ id: 5, question_id: 9, tutor_id: TUTOR_ID, body: 'Use a fórmula de Bhaskara com calma.', status: 'published', created_at: at(-DAY), updated_at: at(-DAY) });
  db.questions.push({ id: 9, author_id: OTHER_ID, subject_id: 2, title: 'Como resolver equação do 2º grau?', body: '', status: 'open', answers_count: 1, created_at: at(-2 * DAY) });
  await seedLogin(page, db, TUTOR_ID);
  const { calls } = await fakeSupabase(page, db);

  await page.goto('/professores/painel.html');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(['Meu anúncio', 'Matérias', 'Foto', 'Avaliações', 'Tira-dúvidas', 'Plano', 'Conta']);
  const expected = {
    anuncio: 'Meu anúncio',
    materias: 'Matemática',
    foto: 'Foto de perfil',
    avaliacoes: 'Avaliações recebidas',
    duvidas: 'Como resolver equação do 2º grau?',
    plano: 'Premium',
    conta: 'ana@exemplo.test',
  };
  for (const [id, text] of Object.entries(expected)) {
    await page.locator(`#tab-${id}`).click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    const panel = page.locator(`#panel-${id}`);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(text);
    await expect(panel.locator('.pf-notice--erro')).toHaveCount(0);
  }
  // Setas do teclado entre as abas
  await page.locator('#tab-conta').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#tab-anuncio')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-anuncio')).toBeVisible();

  // Avaliação recebida aparece só para leitura, com denúncia
  await page.locator('#tab-avaliacoes').click();
  await expect(page.locator('#panel-avaliacoes')).toContainText('Muito paciente.');
  await expect(page.locator('#panel-avaliacoes').getByRole('button', { name: /Denunciar/ })).toBeVisible();
  // Histórico de pagamentos consultado só com o próprio user_id
  const pay = calls.find((c) => c.path === '/rest/v1/payments');
  expect(pay.url.searchParams.get('user_id')).toBe(`eq.${TUTOR_ID}`);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('painel do aluno: abas próprias com as perguntas e avaliações dele', async ({ page }) => {
  const errors = trackErrors(page);
  const db = makeDb();
  db.reviews.push({ id: 2, tutor_id: TUTOR2_ID, student_id: STUDENT_ID, rating: 5, comment: 'Ótimo professor de inglês.', status: 'published', created_at: at(-DAY), updated_at: at(-DAY) });
  db.questions.push({ id: 7, author_id: STUDENT_ID, subject_id: 2, title: 'O que é uma função afim?', body: '', status: 'open', answers_count: 0, created_at: at(-DAY) });
  await seedLogin(page, db, STUDENT_ID);
  await fakeSupabase(page, db);

  await page.goto('/professores/painel.html#avaliacoes');
  await expect(page.getByRole('tab')).toHaveText(['Meu perfil', 'Minhas dúvidas', 'Avaliações', 'Conta']);
  await expect(page.locator('#tab-avaliacoes')).toHaveAttribute('aria-selected', 'true');
  const rv = page.locator('#panel-avaliacoes');
  await expect(rv).toContainText('Ótimo professor de inglês.');
  await expect(rv.getByRole('link', { name: /Bruno Costa/ }).first()).toHaveAttribute('href', '/professores/p/bruno-costa');

  const expected = { perfil: 'Meu perfil', duvidas: 'O que é uma função afim?', conta: 'maria@exemplo.test' };
  for (const [id, text] of Object.entries(expected)) {
    await page.locator(`#tab-${id}`).click();
    const panel = page.locator(`#panel-${id}`);
    await expect(panel).toContainText(text);
    await expect(panel.locator('.pf-notice--erro')).toHaveCount(0);
  }
  // Abas de professor (#plano) caem na primeira aba do aluno
  await page.goto('/professores/painel.html#plano');
  await expect(page.locator('#tab-perfil')).toHaveAttribute('aria-selected', 'true');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('planos: painel → planos → Mercado Pago → pagamento aprovado → aba Plano', async ({ page }) => {
  const errors = trackErrors(page);
  const db = makeDb();
  // Bruno está no Básico
  await seedLogin(page, db, TUTOR2_ID);
  const { calls } = await fakeSupabase(page, db);

  await page.goto('/professores/painel.html#plano');
  const tab = page.locator('#panel-plano');
  await expect(tab).toContainText('Básico');
  await expect(tab).toContainText('Você ainda não fez nenhum pagamento.');
  await tab.getByRole('link', { name: 'Ver planos pagos' }).click();

  await page.waitForURL('**/professores/planos.html');
  await page.getByRole('radio', { name: /3 meses/ }).check();
  await expect(page).toHaveURL(/periodo=3/);
  const premium = page.locator('.pf-plan-card', { hasText: 'Premium' }).first();
  await premium.getByRole('button', { name: 'Contratar Premium' }).click();
  const dialog = page.getByRole('dialog', { name: 'Contratar plano Premium' });
  await expect(dialog).toContainText('R$ 161,73');
  await dialog.getByRole('button', { name: 'Ir para o pagamento' }).click();
  await page.waitForURL(MP_URL);
  const checkout = calls.find((c) => c.path === '/functions/v1/create-checkout');
  expect(checkout.body).toEqual({ plan: 'premium', months: 3 });
  expect(checkout.me).toBe(TUTOR2_ID);

  // Webhook do MP aprova e aplica o plano (o cliente nunca concede plano)
  const pay = db.payments.find((x) => x.id === PAY_ID);
  const expires = at(90 * DAY);
  Object.assign(pay, { status: 'approved', applied_at: at() });
  Object.assign(db.tutor_profiles.find((t) => t.user_id === TUTOR2_ID), { plan: 'premium', plan_expires_at: expires });

  // Volta do Mercado Pago
  await page.goto(`/professores/pagamento.html?collection_status=approved&status=approved&external_reference=${PAY_ID}&payment_id=123456789`);
  await expect(page.getByRole('heading', { name: 'Pagamento aprovado!' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Premium');
  await page.getByRole('link', { name: 'Ver meu plano no painel' }).click();
  await page.waitForURL('**/professores/painel.html#plano');
  await expect(page.locator('#panel-plano .pf-plan-now')).toContainText('Premium');
  await expect(page.locator('#panel-plano .pf-pay-table')).toContainText('3 meses');
  await expect(page.locator('#panel-plano .pf-pay-table')).toContainText('R$ 161,73');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('denúncia: visitante entra, denuncia o perfil e o admin suspende o anúncio', async ({ page }) => {
  const errors = trackErrors(page);
  const db = makeDb();
  const { calls } = await fakeSupabase(page, db);

  // Visitante: denunciar exige login e volta ao mesmo perfil
  await page.goto('/professores/p/bruno-costa');
  await page.locator('#contato').getByRole('button', { name: /Denunciar este perfil/ }).click();
  await page.waitForURL('**/professores/entrar.html?next=%2Fprofessores%2Fp%2Fbruno-costa');
  await login(page, 'maria@exemplo.test');
  await page.waitForURL('**/professores/p/bruno-costa');

  await page.locator('#contato').getByRole('button', { name: /Denunciar este perfil/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Denunciar' });
  await dialog.getByLabel('Motivo').selectOption('contato_externo');
  await dialog.getByLabel('Detalhes').fill('Pede pagamento por Pix fora do portal.');
  await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
  await expect(page.locator('.pf-toast', { hasText: 'Denúncia enviada' })).toBeVisible();
  const post = calls.find((c) => c.method === 'POST' && c.path === '/rest/v1/reports');
  expect(post.body).toEqual({ target_type: 'tutor', target_id: TUTOR2_ID, reason: 'contato_externo', details: 'Pede pagamento por Pix fora do portal.' });
  expect(post.url.search).not.toContain('select=');
  expect(db.reports).toHaveLength(1);

  // Sai e entra como admin
  await page.locator('#authSlot').getByRole('button', { name: 'Sair' }).click();
  await page.waitForURL('**/professores/');
  await page.goto('/professores/admin.html');
  await page.waitForURL(/\/professores\/entrar\.html\?next=%2Fprofessores%2Fadmin\.html/);
  await login(page, 'admin@exemplo.test');
  await page.waitForURL('**/professores/admin.html');

  const card = page.locator(`article.pf-adm-card[data-report-id="${db.reports[0].id}"]`);
  await expect(card).toContainText('Divulga contato/pagamento fora da plataforma');
  await expect(card).toContainText('Pede pagamento por Pix fora do portal.');
  await expect(card).toContainText('Maria Souza');
  await card.getByRole('button', { name: 'Suspender anúncio' }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Suspender anúncio' }).click();
  await expect.poll(() => rpcCalls(calls, 'admin_moderate').length).toBe(1);
  expect(rpcCalls(calls, 'admin_moderate')[0].body).toEqual({ p_type: 'tutor', p_id: TUTOR2_ID, p_action: 'suspend', p_report: db.reports[0].id });
  expect(db.reports[0].status).toBe('resolved');

  // Anúncio suspenso some da busca pública
  await page.locator('#authSlot').getByRole('button', { name: 'Sair' }).click();
  await page.waitForURL('**/professores/');
  await expect(page.locator('#resultados .pf-tutor-card')).toHaveCount(1);
  await expect(page.locator('#resultados')).not.toContainText('Bruno Costa');
  await page.goto('/professores/p/bruno-costa');
  await expect(page.getByRole('heading', { level: 1, name: 'Professor não encontrado' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
