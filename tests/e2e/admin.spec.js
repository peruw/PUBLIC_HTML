// Moderação: botão "Denunciar" (components/report.js), página admin.html (fila de denúncias e
// admin_moderate) e aba "Conta" do painel (components/painel-conta.js: senha, exportar, excluir).
// Supabase falso em http://supabase.test (REST, RPC, auth, functions).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

const AUTH_KEY = 'sb-supabase-auth-token'; // 'sb-' + 'supabase' (1º rótulo do host) + '-auth-token'
const ADMIN_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const USER_ID = '11111111-2222-4333-8444-555555555555';
const TUTOR_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const SENDER_ID = '44444444-4444-4444-8444-444444444444';
const REPORTER_ID = '55555555-5555-4555-8555-555555555555';
const XSS = '<img src=x onerror=window.__xss=1>';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': '*',
};

const ago = (hours) => new Date(Date.now() - hours * 3600e3).toISOString();

function authUser(id, email) {
  return {
    id, aud: 'authenticated', role: 'authenticated', email,
    email_confirmed_at: '2026-09-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {},
    created_at: '2026-09-01T00:00:00Z',
  };
}

function profileRow(id, extra = {}) {
  return {
    id, role: 'student', full_name: 'Usuário Teste', avatar_path: null, is_admin: false, banned_at: null,
    terms_accepted_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    tutor_profiles: null, ...extra,
  };
}

// Sessão salva do supabase-js (usuário logado). Só na 1ª página da aba: depois de "Sair"
// a sessão não pode reaparecer na navegação seguinte.
async function seedSession(page, u) {
  await page.addInitScript(([key, user]) => {
    if (sessionStorage.getItem('pfSeeded')) return;
    sessionStorage.setItem('pfSeeded', '1');
    localStorage.setItem(key, JSON.stringify({
      access_token: 'FAKE.JWT.TOKEN', refresh_token: 'fakerefresh', token_type: 'bearer',
      expires_in: 3600, expires_at: 4102444800, user,
    }));
  }, [AUTH_KEY, u]);
}

/**
 * Supabase falso. routes: [{ method?, path: RegExp, reply(call) -> { status?, body?, headers? } | null }]
 * (conferidas em ordem, antes das respostas padrão). Retorna a lista de chamadas.
 */
async function mockSupabase(page, routes = [], { user = null } = {}) {
  const calls = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'supabase.test') {
      return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css', body: '' });
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    let body = null;
    const raw = req.postData();
    if (raw) {
      try { body = JSON.parse(raw); } catch { body = raw; }
    }
    const call = { method: req.method(), path: url.pathname, url, body, headers: req.headers() };
    calls.push(call);
    for (const r of routes) {
      if ((r.method && r.method !== call.method) || !r.path.test(url.pathname)) continue;
      const res = await r.reply(call);
      if (res) {
        return route.fulfill({
          status: res.status ?? 200,
          contentType: 'application/json',
          headers: { ...CORS, ...(res.headers || {}) },
          body: res.body === undefined ? '' : JSON.stringify(res.body),
        });
      }
    }
    const json = (b, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { ...CORS, ...headers }, body: JSON.stringify(b) });
    if (url.pathname.startsWith('/rest/v1/rpc/')) return json(null);
    if (url.pathname.startsWith('/rest/v1/')) return json([], 200, { 'content-range': '*/0' });
    if (url.pathname === '/auth/v1/user') return user ? json(user) : json({ message: 'no session' }, 401);
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS, body: '' });
    return json({});
  });
  return calls;
}

function trackErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

const rpcCalls = (calls, name) => calls.filter((c) => c.method === 'POST' && c.path === `/rest/v1/rpc/${name}`);

// ======================================================================
// Página de moderação (admin.html)
// ======================================================================

// PostgREST: "in.(a,b,\"c\")" -> ['a','b','c']
function parseIn(v) {
  if (!v || !v.startsWith('in.(')) return null;
  return v.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, ''));
}

// order=col.dir[.nullsfirst|.nullslast],...  (padrão do Postgres: nulls last no asc, first no desc)
function sortRows(rows, order) {
  if (!order) return rows;
  const keys = order.split(',').map((s) => {
    const [col, dir = 'asc', nulls] = s.split('.');
    return { col, desc: dir === 'desc', nullsFirst: nulls ? nulls === 'nullsfirst' : dir === 'desc' };
  });
  return rows.sort((a, b) => {
    for (const k of keys) {
      const x = a[k.col];
      const y = b[k.col];
      if (x === y || (x == null && y == null)) continue;
      if (x == null) return k.nullsFirst ? -1 : 1;
      if (y == null) return k.nullsFirst ? 1 : -1;
      const c = x < y ? -1 : 1;
      return k.desc ? -c : c;
    }
    return 0;
  });
}

function makeDb() {
  return {
    reports: [
      { id: 1, reporter_id: REPORTER_ID, target_type: 'review', target_id: '7', reason: 'ofensivo', details: `Comentário agressivo ${XSS}`, status: 'open', created_at: ago(50), resolved_at: null },
      { id: 2, reporter_id: REPORTER_ID, target_type: 'tutor', target_id: TUTOR_ID, reason: 'contato_externo', details: 'Pede pagamento por Pix fora do site.', status: 'open', created_at: ago(40), resolved_at: null },
      { id: 3, reporter_id: null, target_type: 'message', target_id: '55', reason: 'spam', details: '', status: 'open', created_at: ago(30), resolved_at: null },
      { id: 4, reporter_id: STUDENT_ID, target_type: 'question', target_id: '9', reason: 'falso', details: '', status: 'open', created_at: ago(20), resolved_at: null },
      { id: 6, reporter_id: SENDER_ID, target_type: 'review', target_id: '7', reason: 'spam', details: '', status: 'open', created_at: ago(10), resolved_at: null },
      { id: 8, reporter_id: REPORTER_ID, target_type: 'answer', target_id: '12', reason: 'outro', details: 'Resposta copiada de outro site', status: 'resolved', created_at: ago(90), resolved_at: ago(70) },
      { id: 10, reporter_id: STUDENT_ID, target_type: 'tutor', target_id: TUTOR_ID, reason: 'falso', details: '', status: 'dismissed', created_at: ago(100), resolved_at: ago(80) },
    ],
    tutor_profiles: [
      { user_id: TUTOR_ID, slug: 'paulo-pereira', headline: 'Aulas de violão para iniciantes', bio: `Toco há 20 anos. ${'Muito conteúdo. '.repeat(40)}FIM-DA-BIO`, published: true, suspended: false },
    ],
    reviews: [
      { id: 7, tutor_id: TUTOR_ID, student_id: STUDENT_ID, rating: 1, comment: `Professor horrível ${XSS}`, status: 'published', created_at: ago(60), tutor: { slug: 'paulo-pereira' } },
    ],
    questions: [
      { id: 9, title: 'Como resolver equações do 2º grau?', body: 'Não entendo a fórmula de Bhaskara.', status: 'hidden', author_id: STUDENT_ID, created_at: ago(70) },
    ],
    answers: [
      { id: 12, question_id: 9, tutor_id: TUTOR_ID, body: 'Use a fórmula de Bhaskara com calma.', status: 'published', created_at: ago(65), question: { id: 9, title: 'Como resolver equações do 2º grau?' } },
    ],
    messages: [
      { id: 55, conversation_id: '99999999-0000-4000-8000-000000000000', sender_id: SENDER_ID, body: `Me chama no WhatsApp ${XSS}`, created_at: ago(31) },
    ],
    profiles: [
      profileRow(ADMIN_ID, { full_name: 'Admin Quanta', is_admin: true }),
      profileRow(TUTOR_ID, { role: 'tutor', full_name: 'Paulo Pereira' }),
      profileRow(STUDENT_ID, { full_name: 'Bruno Costa' }),
      profileRow(SENDER_ID, { full_name: 'Carla Dias', banned_at: ago(5) }),
      profileRow(REPORTER_ID, { full_name: 'Rita Reis' }),
    ],
  };
}

function applyModerate(db, b) {
  const now = new Date().toISOString();
  if (b.p_action === 'hide' || b.p_action === 'restore') {
    const coll = { review: db.reviews, question: db.questions, answer: db.answers }[b.p_type];
    const row = coll.find((x) => String(x.id) === b.p_id);
    if (!row) return { status: 400, body: { code: 'P0001', message: 'Item não encontrado.' } };
    row.status = b.p_action === 'hide' ? 'hidden' : (b.p_type === 'question' ? 'open' : 'published');
  } else if (b.p_action === 'suspend' || b.p_action === 'unsuspend') {
    const row = db.tutor_profiles.find((x) => x.user_id === b.p_id);
    row.suspended = b.p_action === 'suspend';
  } else if (b.p_action === 'ban' || b.p_action === 'unban') {
    const row = db.profiles.find((x) => x.id === b.p_id);
    row.banned_at = b.p_action === 'ban' ? now : null;
  }
  if (b.p_report != null) {
    const rep = db.reports.find((x) => x.id === b.p_report);
    rep.status = b.p_action === 'dismiss' ? 'dismissed' : 'resolved';
    rep.resolved_at = now;
  }
  return { status: 204 };
}

/** Admin logado + banco em memória. Devolve { calls, db }. */
async function adminPage(page, { db = makeDb(), moderate } = {}) {
  const me = db.profiles.find((p) => p.id === ADMIN_ID);
  await seedSession(page, authUser(ADMIN_ID, 'admin@exemplo.test'));
  const TABLES = { tutor_profiles: 'user_id', reviews: 'id', questions: 'id', answers: 'id', messages: 'id', profiles: 'id' };
  const calls = await mockSupabase(page, [
    {
      path: /^\/rest\/v1\/reports$/,
      reply: ({ method, url }) => {
        if (method !== 'GET' && method !== 'HEAD') return null;
        const p = url.searchParams;
        let rows = db.reports.slice();
        for (const col of ['status', 'target_type']) {
          const v = p.get(col);
          if (v) rows = rows.filter((r) => `eq.${r[col]}` === v);
        }
        const ids = parseIn(p.get('target_id'));
        if (ids) rows = rows.filter((r) => ids.includes(r.target_id));
        const total = rows.length;
        if (method === 'HEAD') return { status: 200, headers: { 'content-range': `*/${total}` } };
        rows = sortRows(rows, p.get('order'));
        const off = Number(p.get('offset') || 0);
        const lim = p.get('limit') ? Number(p.get('limit')) : rows.length;
        const pageRows = rows.slice(off, off + lim);
        const range = pageRows.length ? `${off}-${off + pageRows.length - 1}/${total}` : `*/${total}`;
        return { body: pageRows, headers: { 'content-range': range } };
      },
    },
    {
      method: 'GET',
      path: /^\/rest\/v1\/(tutor_profiles|reviews|questions|answers|messages|profiles)$/,
      reply: ({ url }) => {
        const table = url.pathname.split('/').pop();
        const col = TABLES[table];
        const v = url.searchParams.get(col) || '';
        if (table === 'profiles' && v === `eq.${ADMIN_ID}`) return { body: [{ ...me, tutor_profiles: null }] };
        const ids = parseIn(v);
        if (!ids) return { body: [] };
        return { body: db[table].filter((x) => ids.includes(String(x[col]))) };
      },
    },
    {
      method: 'POST',
      path: /^\/rest\/v1\/rpc\/admin_moderate$/,
      reply: (c) => (moderate ? moderate(c, db) : null) || applyModerate(db, c.body),
    },
  ], { user: authUser(ADMIN_ID, 'admin@exemplo.test') });
  return { calls, db };
}

const card = (page, id) => page.locator(`article.pf-adm-card[data-report-id="${id}"]`);

test.describe('admin.html', () => {
  test('sem sessão vai para o login', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/professores/admin.html');
    await page.waitForURL('**/professores/entrar.html?next=%2Fprofessores%2Fadmin.html');
  });

  test('usuário que não é admin vai para o painel', async ({ page }) => {
    await seedSession(page, authUser(USER_ID, 'ana@exemplo.test'));
    const calls = await mockSupabase(page, [
      { method: 'GET', path: /^\/rest\/v1\/profiles$/, reply: () => ({ body: [profileRow(USER_ID, { full_name: 'Ana Silva' })] }) },
    ], { user: authUser(USER_ID, 'ana@exemplo.test') });
    await page.goto('/professores/admin.html');
    await page.waitForURL('**/professores/painel.html');
    // Nenhuma leitura de denúncias nem ação de admin
    expect(calls.some((c) => c.path === '/rest/v1/reports')).toBe(false);
    expect(rpcCalls(calls, 'admin_moderate')).toHaveLength(0);
  });

  test('fila: contagens, abertas primeiro, prévias por tipo e texto do usuário como texto', async ({ page }) => {
    const errors = trackErrors(page);
    const { calls } = await adminPage(page);
    await page.goto('/professores/admin.html');

    await expect(page.getByRole('heading', { level: 2, name: 'Denúncias abertas' })).toBeVisible();
    const cards = page.locator('article.pf-adm-card');
    await expect(cards).toHaveCount(5);
    // Fila: mais antigas primeiro
    await expect(cards.nth(0)).toHaveAttribute('data-report-id', '1');
    await expect(cards.nth(4)).toHaveAttribute('data-report-id', '6');
    await expect(page.locator('.pf-adm-live')).toHaveText('Mostrando 5 de 5 denúncias.');

    // Contagens por situação
    const chips = page.getByRole('group', { name: 'Situação' });
    await expect(chips.getByRole('button', { name: 'Abertas 5' })).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.getByRole('button', { name: 'Resolvidas 1' })).toHaveAttribute('aria-pressed', 'false');
    await expect(chips.getByRole('button', { name: 'Descartadas 1' })).toBeVisible();
    await expect(chips.getByRole('button', { name: 'Todas 7' })).toBeVisible();

    // Consulta da fila
    const list = calls.find((c) => c.method === 'GET' && c.path === '/rest/v1/reports' && c.url.searchParams.get('select')?.startsWith('id,reporter_id'));
    expect(list.url.searchParams.get('status')).toBe('eq.open');
    expect(list.url.searchParams.get('order')).toBe('created_at.asc,id.asc');
    expect(list.url.searchParams.get('limit')).toBe('20');

    // Avaliação: motivo, detalhes (XSS como texto), denunciante, prévia e irmã aberta
    const c1 = card(page, '1');
    await expect(c1.getByRole('heading', { level: 3 })).toHaveText('Avaliação · denúncia #1');
    await expect(c1).toContainText('Ofensivo, assédio ou discriminação');
    await expect(c1).toContainText(`Comentário agressivo ${XSS}`);
    await expect(c1).toContainText('Rita Reis');
    await expect(c1.locator('.pf-adm-target')).toContainText('Avaliação de Bruno Costa para Paulo Pereira');
    await expect(c1.locator('.pf-adm-target')).toContainText(`Professor horrível ${XSS}`);
    await expect(c1.getByRole('link', { name: /Ver perfil do professor/ })).toHaveAttribute('href', '/professores/p/paulo-pereira#avaliacoes');
    await expect(c1).toContainText('Há mais 1 denúncia aberta sobre este item.');
    await expect(c1.getByRole('button')).toHaveText(['Ocultar avaliação', 'Banir usuário', 'Descartar denúncia']);

    // Perfil de professor: bio longa com "Mostrar tudo"
    const c2 = card(page, '2');
    await expect(c2).toContainText('Divulga contato/pagamento fora da plataforma');
    await expect(c2.locator('.pf-adm-target')).toContainText('Anúncio de Paulo Pereira');
    await expect(c2.locator('.pf-adm-target')).toContainText('No ar');
    await expect(c2.getByRole('link', { name: /Ver perfil público/ })).toHaveAttribute('href', '/professores/p/paulo-pereira');
    await expect(c2).not.toContainText('FIM-DA-BIO');
    await c2.getByRole('button', { name: 'Mostrar tudo' }).click();
    await expect(c2).toContainText('FIM-DA-BIO');
    await expect(c2.getByRole('button', { name: 'Mostrar menos' })).toHaveAttribute('aria-expanded', 'true');
    await expect(c2.locator('.pf-adm-actions').getByRole('button')).toHaveText(['Suspender anúncio', 'Banir usuário', 'Descartar denúncia']);

    // Mensagem: denunciante com conta excluída, autor banido -> Desbanir
    const c3 = card(page, '3');
    await expect(c3).toContainText('Conta excluída');
    await expect(c3.locator('.pf-adm-target')).toContainText('Mensagem de Carla Dias');
    await expect(c3.locator('.pf-adm-target')).toContainText(`Me chama no WhatsApp ${XSS}`);
    await expect(c3.locator('.pf-adm-target')).toContainText('Autor banido');
    await expect(c3.getByRole('button')).toHaveText(['Desbanir usuário', 'Descartar denúncia']);

    // Pergunta já oculta -> Restaurar
    const c4 = card(page, '4');
    await expect(c4.locator('.pf-adm-target')).toContainText('Oculta');
    await expect(c4.getByRole('link', { name: /Abrir a pergunta/ })).toHaveAttribute('href', '/professores/duvida.html?q=9');
    await expect(c4.getByRole('button')).toHaveText(['Restaurar pergunta', 'Banir usuário', 'Descartar denúncia']);

    // Prévias buscadas em lote, uma consulta por tipo
    const q = (path) => calls.filter((c) => c.method === 'GET' && c.path === path);
    expect(q('/rest/v1/reviews')).toHaveLength(1);
    expect(q('/rest/v1/reviews')[0].url.searchParams.get('id')).toBe('in.(7)');
    expect(q('/rest/v1/tutor_profiles')[0].url.searchParams.get('user_id')).toBe(`in.(${TUTOR_ID})`);
    expect(q('/rest/v1/messages')[0].url.searchParams.get('id')).toBe('in.(55)');
    expect(q('/rest/v1/questions')[0].url.searchParams.get('id')).toBe('in.(9)');

    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('filtros: tipo e situação vão para a URL e para a consulta', async ({ page }) => {
    const { calls } = await adminPage(page);
    await page.goto('/professores/admin.html');
    await expect(page.locator('article.pf-adm-card')).toHaveCount(5);

    await page.getByLabel('Tipo').selectOption('review');
    await expect(page).toHaveURL(/\?tipo=review$/);
    await expect(page.locator('article.pf-adm-card')).toHaveCount(2);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Denúncias abertas · Avaliações');
    let last = calls.filter((c) => c.method === 'GET' && c.path === '/rest/v1/reports' && c.url.searchParams.get('select')?.startsWith('id,reporter_id')).pop();
    expect(last.url.searchParams.get('target_type')).toBe('eq.review');
    // Contagens acompanham o tipo
    await expect(page.getByRole('button', { name: 'Abertas 2' })).toBeVisible();

    await page.getByLabel('Tipo').selectOption('');
    await page.getByRole('group', { name: 'Situação' }).getByRole('button', { name: /^Todas/ }).click();
    await expect(page).toHaveURL(/\?status=all$/);
    const cards = page.locator('article.pf-adm-card');
    await expect(cards).toHaveCount(7);
    last = calls.filter((c) => c.method === 'GET' && c.path === '/rest/v1/reports' && c.url.searchParams.get('select')?.startsWith('id,reporter_id')).pop();
    expect(last.url.searchParams.get('status')).toBeNull();
    expect(last.url.searchParams.get('order')).toBe('resolved_at.desc.nullsfirst,created_at.asc,id.asc');
    // Abertas primeiro, depois as decididas
    await expect(cards.nth(0)).toHaveAttribute('data-report-id', '1');
    await expect(cards.nth(5)).toHaveAttribute('data-report-id', '8');
    await expect(cards.nth(6)).toHaveAttribute('data-report-id', '10');
    await expect(card(page, '8')).toContainText('Resolvida em');
    // Denúncia já decidida: sem "Descartar"
    await expect(card(page, '8').getByRole('button', { name: 'Descartar denúncia' })).toHaveCount(0);

    // Filtros vindos da URL
    await page.goto('/professores/admin.html?status=resolved&tipo=answer');
    await expect(page.getByRole('button', { name: /^Resolvidas/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Tipo')).toHaveValue('answer');
    await expect(page.locator('article.pf-adm-card')).toHaveCount(1);
    await expect(card(page, '8').locator('.pf-adm-target')).toContainText('Resposta de Paulo Pereira');
    await expect(card(page, '8').getByRole('link', { name: /Abrir a resposta/ })).toHaveAttribute('href', '/professores/duvida.html?q=9#resposta-12');
  });

  test('ações chamam admin_moderate com os argumentos certos (com confirmação)', async ({ page }) => {
    const { calls, db } = await adminPage(page);
    await page.goto('/professores/admin.html');
    await expect(page.locator('article.pf-adm-card')).toHaveCount(5);
    const dialog = page.getByRole('dialog');

    // Cancelar não chama nada
    await card(page, '2').getByRole('button', { name: 'Suspender anúncio' }).click();
    await expect(dialog).toContainText('Suspender o anúncio de Paulo Pereira?');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toHaveCount(0);
    expect(rpcCalls(calls, 'admin_moderate')).toHaveLength(0);

    // Ocultar avaliação resolve esta denúncia e (marcado) a outra aberta sobre o mesmo item
    await card(page, '1').getByRole('button', { name: 'Ocultar avaliação' }).click();
    await expect(dialog).toContainText('Ocultar esta avaliação?');
    const also = dialog.getByLabel('Resolver também a outra denúncia aberta sobre este item');
    await expect(also).toBeChecked();
    await dialog.getByRole('button', { name: 'Ocultar avaliação' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.pf-toast', { hasText: 'Conteúdo ocultado.' })).toBeVisible();
    expect(rpcCalls(calls, 'admin_moderate').map((c) => c.body)).toEqual([
      { p_type: 'review', p_id: '7', p_action: 'hide', p_report: 1 },
      { p_type: 'review', p_id: '7', p_action: 'hide', p_report: 6 },
    ]);
    // Fila recarregada: as duas saíram
    await expect(page.locator('article.pf-adm-card')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Abertas 3' })).toBeVisible();
    await expect(page.locator('.pf-adm-card').first()).toBeFocused();

    // Suspender anúncio (p_type tutor)
    await card(page, '2').getByRole('button', { name: 'Suspender anúncio' }).click();
    await dialog.getByRole('button', { name: 'Suspender anúncio' }).click();
    await expect(dialog).toHaveCount(0);
    expect(rpcCalls(calls, 'admin_moderate').pop().body).toEqual({ p_type: 'tutor', p_id: TUTOR_ID, p_action: 'suspend', p_report: 2 });
    expect(db.tutor_profiles[0].suspended).toBe(true);

    // Desbanir o autor da mensagem (p_type user + uuid); aviso de que suspensão é separada
    await card(page, '3').getByRole('button', { name: 'Desbanir usuário' }).click();
    await expect(dialog).toContainText('Um anúncio suspenso continua suspenso');
    await dialog.getByRole('button', { name: 'Desbanir usuário' }).click();
    await expect(dialog).toHaveCount(0);
    expect(rpcCalls(calls, 'admin_moderate').pop().body).toEqual({ p_type: 'user', p_id: SENDER_ID, p_action: 'unban', p_report: 3 });

    // Banir o autor da pergunta
    await card(page, '4').getByRole('button', { name: 'Banir usuário' }).click();
    await expect(dialog).toContainText('Banir Bruno Costa?');
    await dialog.getByRole('button', { name: 'Banir usuário' }).click();
    await expect(dialog).toHaveCount(0);
    expect(rpcCalls(calls, 'admin_moderate').pop().body).toEqual({ p_type: 'user', p_id: STUDENT_ID, p_action: 'ban', p_report: 4 });
    await expect(page.getByText('Nenhuma denúncia aberta. Tudo em dia!')).toBeVisible();

    // Em "Todas": reativar o anúncio de uma denúncia já resolvida não reabre/marca a denúncia (p_report null)
    await page.getByRole('button', { name: /^Todas/ }).click();
    await card(page, '2').getByRole('button', { name: 'Reativar anúncio' }).click();
    await dialog.getByRole('button', { name: 'Reativar anúncio' }).click();
    await expect(dialog).toHaveCount(0);
    expect(rpcCalls(calls, 'admin_moderate').pop().body).toEqual({ p_type: 'tutor', p_id: TUTOR_ID, p_action: 'unsuspend', p_report: null });
  });

  test('descartar: confirma e envia p_action dismiss; erro do banco aparece e o modal fica aberto', async ({ page }) => {
    let fail = true;
    const { calls } = await adminPage(page, {
      moderate: () => (fail ? { status: 400, body: { code: 'P0001', message: 'Denúncia não encontrada.', details: null, hint: null } } : null),
    });
    await page.goto('/professores/admin.html');
    const dialog = page.getByRole('dialog');

    await card(page, '1').getByRole('button', { name: 'Descartar denúncia' }).click();
    // Descartar não marca as irmãs por padrão
    await expect(dialog.getByLabel('Descartar também a outra denúncia aberta sobre este item')).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Descartar denúncia' }).click();
    await expect(dialog.locator('.pf-toast', { hasText: 'Denúncia não encontrada.' })).toBeVisible();
    await expect(dialog).toBeVisible();

    fail = false;
    await dialog.getByRole('button', { name: 'Descartar denúncia' }).click();
    await expect(dialog).toHaveCount(0);
    const bodies = rpcCalls(calls, 'admin_moderate').map((c) => c.body);
    expect(bodies).toEqual([
      { p_type: 'review', p_id: '7', p_action: 'dismiss', p_report: 1 },
      { p_type: 'review', p_id: '7', p_action: 'dismiss', p_report: 1 },
    ]);
    await expect(card(page, '1')).toHaveCount(0);
    await expect(card(page, '6')).toHaveCount(1);
  });

  test('paginação: carregar mais', async ({ page }) => {
    const db = makeDb();
    for (let i = 0; i < 20; i++) {
      db.reports.push({ id: 100 + i, reporter_id: REPORTER_ID, target_type: 'question', target_id: '9', reason: 'spam', details: '', status: 'open', created_at: ago(5 - i * 0.1), resolved_at: null });
    }
    await adminPage(page, { db });
    await page.goto('/professores/admin.html');
    const cards = page.locator('article.pf-adm-card');
    await expect(cards).toHaveCount(20);
    await expect(page.locator('.pf-adm-live')).toHaveText('Mostrando 20 de 25 denúncias.');
    await page.getByRole('button', { name: 'Carregar mais' }).click();
    await expect(cards).toHaveCount(25);
    await expect(cards.nth(20)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Carregar mais' })).toBeHidden();
  });

  test('erro ao carregar mostra aviso e tentar novamente', async ({ page }) => {
    let fail = true;
    const db = makeDb();
    await seedSession(page, authUser(ADMIN_ID, 'admin@exemplo.test'));
    await mockSupabase(page, [
      { method: 'GET', path: /^\/rest\/v1\/profiles$/, reply: ({ url }) => (url.searchParams.get('id') === `eq.${ADMIN_ID}` ? { body: [db.profiles[0]] } : { body: [] }) },
      { method: 'GET', path: /^\/rest\/v1\/reports$/, reply: () => (fail ? { status: 500, body: { message: 'boom' } } : { body: [], headers: { 'content-range': '*/0' } }) },
    ], { user: authUser(ADMIN_ID, 'admin@exemplo.test') });
    await page.goto('/professores/admin.html');
    const alert = page.locator('.pf-adm-results [role="alert"]');
    await expect(alert).toContainText('Não foi possível carregar as denúncias');
    fail = false;
    await alert.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByText('Nenhuma denúncia aberta. Tudo em dia!')).toBeVisible();
  });

  test.describe('celular (360px)', () => {
    test.use({ viewport: { width: 360, height: 740 } });

    test('sem rolagem horizontal', async ({ page }) => {
      await adminPage(page);
      await page.goto('/professores/admin.html');
      await expect(page.locator('article.pf-adm-card')).toHaveCount(5);
      const wide = await page.evaluate(() => [...document.querySelectorAll('main *')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`));
      expect(wide, wide.join('\n')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
  });
});

// ======================================================================
// Botão "Denunciar" (report.js) — no perfil público do professor
// ======================================================================

const PERFIL_TUTOR = {
  user_id: TUTOR_ID,
  slug: 'paulo-pereira',
  headline: 'Aulas de violão para iniciantes',
  bio: 'Toco há 20 anos.',
  hourly_rate_cents: 8000,
  mode_online: true,
  mode_presencial: false,
  uf: null,
  city_name: null,
  published: true,
  suspended: false,
  plan: 'basico',
  plan_expires_at: null,
  rating_avg: 0,
  rating_count: 0,
  last_active_at: null,
  created_at: '2026-01-10T12:00:00Z',
  profiles: { full_name: 'Paulo Pereira', avatar_path: null },
  tutor_subjects: [{ levels: [], subjects: { id: 33, name: 'Violão', slug: 'violao' } }],
};

async function perfilPage(page, { loggedIn = true, reports } = {}) {
  const user = authUser(USER_ID, 'ana@exemplo.test');
  if (loggedIn) await seedSession(page, user);
  return mockSupabase(page, [
    { method: 'GET', path: /^\/rest\/v1\/tutor_profiles$/, reply: ({ url }) => ({ body: url.searchParams.get('slug') === 'eq.paulo-pereira' ? [PERFIL_TUTOR] : [] }) },
    { method: 'GET', path: /^\/rest\/v1\/profiles$/, reply: ({ url }) => ({ body: url.searchParams.get('id') === `eq.${USER_ID}` ? [profileRow(USER_ID, { full_name: 'Ana Silva' })] : [] }) },
    { method: 'POST', path: /^\/rest\/v1\/reports$/, reply: (c) => (reports ? reports(c) : { status: 201 }) },
  ], { user: loggedIn ? user : null });
}

const reportBtn = (page) => page.locator('#contato').getByRole('button', { name: /Denunciar/ });

test.describe('botão Denunciar', () => {
  test('sem login leva para entrar com next', async ({ page }) => {
    const calls = await perfilPage(page, { loggedIn: false });
    await page.goto('/professores/p/paulo-pereira');
    await reportBtn(page).click();
    await page.waitForURL('**/professores/entrar.html?next=%2Fprofessores%2Fp%2Fpaulo-pereira');
    expect(calls.some((c) => c.path === '/rest/v1/reports')).toBe(false);
  });

  test('envia a denúncia sem select (return=minimal) e valida o formulário', async ({ page }) => {
    const errors = trackErrors(page);
    const calls = await perfilPage(page);
    await page.goto('/professores/p/paulo-pereira');
    const btn = reportBtn(page);
    await expect(btn).toHaveText('Denunciar este perfil');
    await expect(btn.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await btn.click();

    const dialog = page.getByRole('dialog', { name: 'Denunciar' });
    await expect(dialog).toContainText('Conte o que há de errado com este perfil.');
    const reason = dialog.getByLabel('Motivo');
    await expect(reason).toBeFocused();
    await expect(reason.locator('option')).toHaveText([
      'Selecione um motivo', 'Spam ou propaganda', 'Ofensivo, assédio ou discriminação', 'Informação ou perfil falso',
      'Divulga contato/pagamento fora da plataforma', 'Envolve menor de idade (risco ou uso sem responsável)', 'Outro motivo',
    ]);

    // Sem motivo
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
    await expect(dialog.getByText('Escolha um motivo.')).toBeVisible();
    await expect(reason).toHaveAttribute('aria-invalid', 'true');
    await expect(reason).toBeFocused();

    // "Outro" exige detalhes
    await reason.selectOption('outro');
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
    await expect(dialog.getByText('Descreva o motivo da denúncia.')).toBeVisible();
    await expect(dialog.getByLabel('Detalhes')).toBeFocused();
    expect(calls.filter((c) => c.path === '/rest/v1/reports')).toHaveLength(0);

    // Limite de 1000 caracteres + contador
    const details = dialog.getByLabel('Detalhes');
    await expect(details).toHaveAttribute('maxlength', '1000');
    await reason.selectOption('contato_externo');
    await details.fill(`  Pede Pix fora do portal ${XSS}  `);
    await expect(dialog.locator('.pf-counter')).toHaveText(`${`  Pede Pix fora do portal ${XSS}  `.length}/1000`);
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.pf-toast', { hasText: 'Denúncia enviada' })).toBeVisible();

    const posts = calls.filter((c) => c.method === 'POST' && c.path === '/rest/v1/reports');
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ target_type: 'tutor', target_id: TUTOR_ID, reason: 'contato_externo', details: `Pede Pix fora do portal ${XSS}` });
    // Sem .select(): nada de select= na URL nem return=representation
    expect(posts[0].url.search).not.toContain('select=');
    expect(posts[0].headers.prefer || '').not.toContain('return=representation');
    expect(posts[0].headers.authorization).toBe('Bearer FAKE.JWT.TOKEN');

    // Segunda vez: avisa sem abrir o modal
    await expect(btn).toHaveClass(/is-reported/);
    await btn.click();
    await expect(page.locator('.pf-toast', { hasText: 'Você já denunciou este conteúdo' })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/rest/v1/reports')).toHaveLength(1);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('duplicada (23505) mostra "Você já denunciou"', async ({ page }) => {
    await perfilPage(page, {
      reports: () => ({ status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "reports_reporter_id_target_type_target_id_key"', details: null, hint: null } }),
    });
    await page.goto('/professores/p/paulo-pereira');
    await reportBtn(page).click();
    const dialog = page.getByRole('dialog', { name: 'Denunciar' });
    await dialog.getByLabel('Motivo').selectOption('spam');
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.pf-toast', { hasText: 'Você já denunciou este conteúdo' })).toBeVisible();
  });

  test('erro do banco (limite) aparece no modal, que continua aberto', async ({ page }) => {
    await perfilPage(page, {
      reports: () => ({ status: 400, body: { code: 'P0001', message: 'Limite atingido, tente mais tarde', details: null, hint: null } }),
    });
    await page.goto('/professores/p/paulo-pereira');
    await reportBtn(page).click();
    const dialog = page.getByRole('dialog', { name: 'Denunciar' });
    await dialog.getByLabel('Motivo').selectOption('falso');
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
    await expect(dialog.locator('.pf-toast', { hasText: 'Limite atingido, tente mais tarde' })).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

// ======================================================================
// Aba "Conta" do painel (painel-conta.js)
// ======================================================================

const EXPORT = {
  exportado_em: '2026-09-25T12:00:00Z',
  conta: { id: USER_ID, email: 'ana@exemplo.test' },
  perfil: { id: USER_ID, full_name: 'Ana Silva', role: 'student' },
  conversas: [{ id: 'c1', mensagens: [{ id: 1, de_mim: true, texto: 'Olá, ção!' }] }],
  pagamentos: [],
};

async function contaPage(page, { deleteReply, updateReply } = {}) {
  const user = authUser(USER_ID, 'ana@exemplo.test');
  await seedSession(page, user);
  return mockSupabase(page, [
    { method: 'GET', path: /^\/rest\/v1\/profiles$/, reply: () => ({ body: [profileRow(USER_ID, { full_name: 'Ana Silva' })] }) },
    { method: 'POST', path: /^\/rest\/v1\/rpc\/export_my_data$/, reply: () => ({ body: EXPORT }) },
    { method: 'PUT', path: /^\/auth\/v1\/user$/, reply: (c) => (updateReply ? updateReply(c) : { body: user }) },
    { method: 'POST', path: /^\/functions\/v1\/delete-account$/, reply: (c) => (deleteReply ? deleteReply(c) : { body: { ok: true } }) },
  ], { user });
}

test.describe('painel: aba Conta', () => {
  test('mostra o e-mail e exporta os dados em meus-dados-quanta.json', async ({ page }) => {
    const errors = trackErrors(page);
    const calls = await contaPage(page);
    await page.goto('/professores/painel.html#conta');
    const panel = page.locator('#panel-conta');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { level: 2, name: 'Dados de acesso' })).toBeVisible();
    await expect(panel).toContainText('E-mail: ana@exemplo.test');
    await expect(panel.getByRole('link', { name: 'Política de Privacidade' })).toHaveAttribute('href', '/professores/privacidade.html#direitos');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      panel.getByRole('button', { name: 'Exportar meus dados' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('meus-dados-quanta.json');
    const text = readFileSync(await download.path(), 'utf8');
    expect(JSON.parse(text)).toEqual(EXPORT);
    await expect(panel.getByText('Pronto! O arquivo meus-dados-quanta.json foi baixado.')).toBeVisible();
    expect(rpcCalls(calls, 'export_my_data')).toHaveLength(1);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('exportar: erro vira mensagem', async ({ page }) => {
    await seedSession(page, authUser(USER_ID, 'ana@exemplo.test'));
    await mockSupabase(page, [
      { method: 'GET', path: /^\/rest\/v1\/profiles$/, reply: () => ({ body: [profileRow(USER_ID, { full_name: 'Ana Silva' })] }) },
      { method: 'POST', path: /^\/rest\/v1\/rpc\/export_my_data$/, reply: () => ({ status: 400, body: { code: 'P0001', message: 'Faça login para continuar.' } }) },
    ], { user: authUser(USER_ID, 'ana@exemplo.test') });
    await page.goto('/professores/painel.html#conta');
    const panel = page.locator('#panel-conta');
    await panel.getByRole('button', { name: 'Exportar meus dados' }).click();
    await expect(panel.locator('.pf-acct-msg.is-erro')).toHaveText('Faça login para continuar.');
  });

  test('alterar senha: valida e chama updateUser', async ({ page }) => {
    const calls = await contaPage(page);
    await page.goto('/professores/painel.html#conta');
    const panel = page.locator('#panel-conta');
    const pw1 = panel.getByLabel('Nova senha', { exact: true });
    const pw2 = panel.getByLabel('Repita a nova senha');
    await expect(pw1).toHaveAttribute('autocomplete', 'new-password');
    const save = panel.getByRole('button', { name: 'Salvar nova senha' });

    await pw1.fill('abc');
    await save.click();
    await expect(panel.getByText('A senha precisa ter pelo menos 8 caracteres.')).toBeVisible();
    await expect(pw1).toBeFocused();

    await pw1.fill('senhasegura');
    await save.click();
    await expect(panel.getByText('Use letras e números na senha.')).toBeVisible();

    await pw1.fill('segura123');
    await pw2.fill('segura124');
    await save.click();
    await expect(panel.getByText('As senhas não são iguais.')).toBeVisible();
    await expect(pw2).toBeFocused();
    expect(calls.filter((c) => c.path === '/auth/v1/user' && c.method === 'PUT')).toHaveLength(0);

    await panel.getByLabel('Mostrar senhas').check();
    await expect(pw1).toHaveAttribute('type', 'text');
    await pw2.fill('segura123');
    await save.click();
    await expect(panel.getByText('Senha alterada. Use a nova senha no próximo acesso.')).toBeVisible();
    const put = calls.filter((c) => c.path === '/auth/v1/user' && c.method === 'PUT');
    expect(put).toHaveLength(1);
    expect(put[0].body.password).toBe('segura123');
    await expect(pw1).toHaveValue('');
    await expect(pw1).toHaveAttribute('type', 'password');
  });

  test('alterar senha: erro do Supabase aparece', async ({ page }) => {
    await contaPage(page, {
      updateReply: () => ({ status: 422, headers: { 'x-supabase-api-version': '2024-01-01' }, body: { code: 'same_password', message: 'New password should be different from the old password.' } }),
    });
    await page.goto('/professores/painel.html#conta');
    const panel = page.locator('#panel-conta');
    await panel.getByLabel('Nova senha', { exact: true }).fill('segura123');
    await panel.getByLabel('Repita a nova senha').fill('segura123');
    await panel.getByRole('button', { name: 'Salvar nova senha' }).click();
    await expect(panel.locator('.pf-acct-msg.is-erro')).toHaveText('A nova senha deve ser diferente da atual.');
  });

  test('excluir conta: exige EXCLUIR, chama delete-account com o token, sai e volta ao início', async ({ page }) => {
    const calls = await contaPage(page);
    await page.goto('/professores/painel.html#conta');
    const panel = page.locator('#panel-conta');
    await panel.getByRole('button', { name: 'Excluir minha conta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Excluir conta' });
    const input = dialog.getByLabel('Para confirmar, digite EXCLUIR');
    await expect(input).toBeFocused();

    await input.fill('apagar');
    await dialog.getByRole('button', { name: 'Excluir conta definitivamente' }).click();
    await expect(dialog.getByText('Digite EXCLUIR para confirmar.')).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.path === '/functions/v1/delete-account')).toBe(false);

    await input.fill('EXCLUIR');
    await dialog.getByRole('button', { name: 'Excluir conta definitivamente' }).click();
    await page.waitForURL(/\/professores\/$/);
    const del = calls.filter((c) => c.method === 'POST' && c.path === '/functions/v1/delete-account');
    expect(del).toHaveLength(1);
    expect(del[0].headers.authorization).toBe('Bearer FAKE.JWT.TOKEN');
    expect(del[0].headers.apikey).toBe('test');
    expect(calls.some((c) => c.path === '/auth/v1/logout')).toBe(true);
    expect(await page.evaluate((k) => localStorage.getItem(k), AUTH_KEY)).toBeNull();
  });

  test('excluir conta: erro da função aparece e a sessão continua', async ({ page }) => {
    const calls = await contaPage(page, {
      deleteReply: () => ({ status: 500, body: { error: 'Não foi possível excluir a conta agora. Tente novamente ou fale com o suporte.' } }),
    });
    await page.goto('/professores/painel.html#conta');
    await page.locator('#panel-conta').getByRole('button', { name: 'Excluir minha conta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Excluir conta' });
    await dialog.getByLabel('Para confirmar, digite EXCLUIR').fill('EXCLUIR');
    await dialog.getByRole('button', { name: 'Excluir conta definitivamente' }).click();
    await expect(dialog.locator('.pf-acct-msg.is-erro')).toHaveText('Não foi possível excluir a conta agora. Tente novamente ou fale com o suporte.');
    await expect(dialog).toBeVisible();
    expect(calls.some((c) => c.path === '/auth/v1/logout')).toBe(false);
    expect(await page.evaluate((k) => localStorage.getItem(k), AUTH_KEY)).not.toBeNull();
    await expect(page).toHaveURL(/painel\.html/);
  });
});
