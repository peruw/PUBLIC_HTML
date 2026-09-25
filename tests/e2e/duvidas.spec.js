// Tira-dúvidas: lista (/professores/duvidas.html), nova pergunta, página da dúvida
// (/professores/duvida.html?q=<id>), últimas respostas no perfil e aba do painel.
// Supabase falso em http://supabase.test (REST, RPC, auth).
import { test, expect } from '@playwright/test';

const AUTH_KEY = 'sb-supabase-auth-token'; // 'sb-' + 'supabase' (1º rótulo do host) + '-auth-token'
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';
const TUTOR_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_TUTOR_ID = '44444444-4444-4444-8444-444444444444';
const XSS = '<img src=x onerror=window.__xss=1>';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': '*',
};

const SUBJECTS = [
  { id: 1, slug: 'matematica', name: 'Matemática', category: 'Exatas' },
  { id: 2, slug: 'fisica', name: 'Física', category: 'Exatas' },
  { id: 3, slug: 'quimica', name: 'Química', category: 'Exatas' },
  { id: 4, slug: 'biologia', name: 'Biologia', category: 'Ciências' },
  { id: 5, slug: 'portugues', name: 'Português', category: 'Linguagens' },
  { id: 6, slug: 'ingles', name: 'Inglês', category: 'Idiomas' },
];

const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

function authUser(id, email) {
  return {
    id, aud: 'authenticated', role: 'authenticated', email,
    email_confirmed_at: '2026-09-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {},
    created_at: '2026-09-01T00:00:00Z',
  };
}

const STUDENT = {
  user: authUser(STUDENT_ID, 'bia@exemplo.test'),
  profile: {
    id: STUDENT_ID, role: 'student', full_name: 'Beatriz Souza', avatar_path: null, is_admin: false, banned_at: null,
    terms_accepted_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    tutor_profiles: null,
  },
};

function tutorAccount(tutorExtra = {}) {
  return {
    user: authUser(TUTOR_ID, 'carlos@exemplo.test'),
    profile: {
      id: TUTOR_ID, role: 'tutor', full_name: 'Carlos Lima', avatar_path: null, is_admin: false, banned_at: null,
      terms_accepted_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
      tutor_profiles: {
        user_id: TUTOR_ID, slug: 'carlos-lima', headline: 'Professor de Física', bio: '', hourly_rate_cents: 9000,
        mode_online: true, mode_presencial: false, uf: null, city_ibge: null, city_name: null,
        published: true, suspended: false, plan: 'basico', plan_expires_at: null, rating_avg: 0, rating_count: 0,
        created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...tutorExtra,
      },
    },
  };
}

function question(extra = {}) {
  return {
    id: 42,
    title: `Como resolver x² - 5x + 6 = 0? ${XSS}`,
    body: `Já tentei fatorar.\nNão entendi o delta.\n${XSS}`,
    status: 'open',
    subject_id: 1,
    author_id: STUDENT_ID,
    answers_count: 2,
    created_at: ago(30),
    author_name: 'Beatriz S.',
    subjects: { id: 1, slug: 'matematica', name: 'Matemática' },
    ...extra,
  };
}

function answer(extra = {}) {
  return {
    id: 7,
    body: 'Calcule o delta: 25 - 24 = 1. Depois use Bhaskara: x = (5 ± 1) / 2, logo x = 3 ou x = 2.',
    status: 'published',
    tutor_id: OTHER_TUTOR_ID,
    created_at: ago(20),
    updated_at: ago(20),
    tutor_profiles: { slug: 'ana-silva', headline: 'Matemática para o ENEM', profiles: { full_name: 'Ana Silva', avatar_path: null } },
    ...extra,
  };
}

// Professor despublicado/suspenso: o RLS devolve o embed como null
const HIDDEN_TUTOR_ANSWER = answer({
  id: 8, tutor_id: '55555555-5555-4555-8555-555555555555', tutor_profiles: null,
  body: `Outra forma: some e multiplique as raízes. ${XSS}`, created_at: ago(10), updated_at: ago(10),
});

/** Resposta PostgREST: .single() pede objeto (Accept vnd.pgrst.object), o resto recebe array. */
function rowsFor(call, rows) {
  const accept = call.headers.accept || '';
  if (accept.includes('vnd.pgrst.object')) return rows[0] ?? null;
  return rows;
}

/**
 * Supabase falso. routes: [{ method?, path: RegExp, reply(call) -> { status?, body?, headers? } | undefined }]
 * (conferidas em ordem, antes das respostas padrão). account: { user, profile } para sessão logada.
 * Retorna a lista de chamadas feitas.
 */
async function mockSupabase(page, { routes = [], account = null } = {}) {
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
    const send = (status, payload, headers = {}) => route.fulfill({
      status, contentType: 'application/json', headers: { ...CORS, ...headers },
      body: payload === undefined ? '' : JSON.stringify(payload),
    });
    for (const r of routes) {
      if ((r.method && r.method !== call.method) || !r.path.test(url.pathname)) continue;
      const res = await r.reply(call);
      if (res) return send(res.status ?? 200, res.body, res.headers);
    }
    if (url.pathname === '/rest/v1/subjects') return send(200, SUBJECTS);
    if (url.pathname === '/rest/v1/profiles' && account) return send(200, rowsFor(call, [account.profile]));
    if (url.pathname === '/auth/v1/user') return account ? send(200, account.user) : send(401, { message: 'no session' });
    if (url.pathname.startsWith('/rest/v1/rpc/')) return send(200, null);
    if (url.pathname.startsWith('/rest/v1/')) return send(200, [], { 'content-range': '*/0' });
    return send(200, {});
  });
  return calls;
}

async function seedSession(page, account) {
  await page.addInitScript(([key, u]) => {
    localStorage.setItem(key, JSON.stringify({
      access_token: 'FAKE.JWT.TOKEN', refresh_token: 'fakerefresh', token_type: 'bearer',
      expires_in: 3600, expires_at: 4102444800, user: u,
    }));
  }, [AUTH_KEY, account.user]);
}

function trackErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

const rpcCalls = (calls) => calls.filter((c) => c.path === '/rest/v1/rpc/search_questions');

function listRows(total = 32) {
  return [
    { id: 101, title: `Como calcular o delta? ${XSS}`, subject_slug: 'matematica', subject_name: 'Matemática', answers_count: 3, created_at: ago(2), author_name: 'Maria S.', total },
    { id: 102, title: 'Qual a diferença entre seno e cosseno?', subject_slug: 'matematica', subject_name: 'Matemática', answers_count: 0, created_at: ago(50), author_name: 'João P.', total },
  ];
}

// ---------- Lista ----------

test.describe('lista de dúvidas', () => {
  test('filtros da URL vão para a RPC search_questions e aparecem na tela', async ({ page }) => {
    const errors = trackErrors(page);
    const calls = await mockSupabase(page, {
      routes: [{ path: /\/rpc\/search_questions$/, reply: () => ({ body: listRows(32) }) }],
    });
    await page.goto('/professores/duvidas.html?q=bhaskara&materia=matematica&pagina=2');

    const items = page.locator('#qaResultados .pf-qa-card');
    await expect(items).toHaveCount(2);
    expect(rpcCalls(calls)[0].body).toEqual({ q: 'bhaskara', p_materia: 'matematica', p_lim: 15, p_pagina: 1 });

    await expect(page.locator('#fQ')).toHaveValue('bhaskara');
    await expect(page.locator('#fMateria')).toHaveValue('matematica');
    await expect(page.locator('#perguntasTitulo')).toHaveText('Resultados em Matemática');
    await expect(page.locator('#qaCount')).toHaveText('32 perguntas · página 2 de 3');
    await expect(page).toHaveTitle('Dúvidas de Matemática — Professores | Quanta Aulas');
    await expect(page.locator('#qaMaterias a[data-materia="matematica"]')).toHaveAttribute('aria-current', 'true');

    // Card: título (texto puro), matéria, autor, contagem e link para a dúvida
    const first = items.nth(0);
    await expect(first.getByRole('link')).toHaveText(`Como calcular o delta? ${XSS}`);
    await expect(first.getByRole('link')).toHaveAttribute('href', '/professores/duvida.html?q=101');
    await expect(first).toContainText('Matemática');
    await expect(first).toContainText('por Maria S.');
    await expect(first).toContainText('3 respostas');
    await expect(first.locator('time')).toHaveText(/há 2 horas/);
    await expect(items.nth(1)).toContainText('Sem respostas');
    await expect(page.locator('main img[src="x"]')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('null');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();

    // Paginação: página atual marcada, links com a URL da página
    const pager = page.locator('#qaPaginacao');
    await expect(pager.locator('[aria-current="page"]')).toHaveText('2');
    await expect(pager.getByRole('link', { name: 'Próxima página' })).toHaveAttribute('href', '/professores/duvidas.html?q=bhaskara&materia=matematica&pagina=3');
    // Card "Quer aula particular?" leva para a busca da matéria
    await expect(page.locator('#qaBuscaLink')).toHaveAttribute('href', '/professores/?materia=matematica');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('matéria, chips, busca e paginação atualizam URL e RPC (com voltar do navegador)', async ({ page }) => {
    const calls = await mockSupabase(page, {
      routes: [{ path: /\/rpc\/search_questions$/, reply: () => ({ body: listRows(40) }) }],
    });
    await page.goto('/professores/duvidas.html');
    await expect(page.locator('#qaResultados .pf-qa-card')).toHaveCount(2);
    expect(rpcCalls(calls)[0].body).toEqual({ q: null, p_materia: null, p_lim: 15, p_pagina: 0 });
    await expect(page.locator('#perguntasTitulo')).toHaveText('Perguntas recentes');

    // Select de matéria (lista vem de subjects)
    await expect(page.locator('#fMateria option[value="fisica"]')).toHaveCount(1);
    await page.selectOption('#fMateria', 'fisica');
    await expect(page).toHaveURL(/\/professores\/duvidas\.html\?materia=fisica$/);
    await expect.poll(() => rpcCalls(calls).at(-1).body.p_materia).toBe('fisica');
    await expect(page.locator('#perguntasTitulo')).toHaveText('Dúvidas de Física');

    // Chip
    await page.locator('#qaMaterias').getByRole('link', { name: 'Química' }).click();
    await expect(page).toHaveURL(/materia=quimica/);
    await expect.poll(() => rpcCalls(calls).at(-1).body).toEqual({ q: null, p_materia: 'quimica', p_lim: 15, p_pagina: 0 });

    // Paginação
    await page.locator('#qaPaginacao').getByRole('link', { name: 'Próxima página' }).click();
    await expect(page).toHaveURL(/materia=quimica&pagina=2$/);
    await expect.poll(() => rpcCalls(calls).at(-1).body.p_pagina).toBe(1);
    await expect(page.locator('#perguntasTitulo')).toBeFocused();

    // Voltar do navegador restaura a página 1
    await page.goBack();
    await expect(page).toHaveURL(/materia=quimica$/);
    await expect.poll(() => rpcCalls(calls).at(-1).body.p_pagina).toBe(0);

    // Busca por texto volta para a página 1
    await page.fill('#fQ', '  equação   do 2º grau ');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(page).toHaveURL(/q=equa%C3%A7%C3%A3o\+do\+2%C2%BA\+grau&materia=quimica$/);
    await expect.poll(() => rpcCalls(calls).at(-1).body).toEqual({ q: 'equação do 2º grau', p_materia: 'quimica', p_lim: 15, p_pagina: 0 });

    // "Todas" limpa a matéria
    await page.locator('#qaMaterias').getByRole('link', { name: 'Todas' }).click();
    await expect(page).toHaveURL(/duvidas\.html\?q=equa/);
    await expect.poll(() => rpcCalls(calls).at(-1).body.p_materia).toBeNull();
  });

  test('lista vazia e erro da RPC têm estados claros', async ({ page }) => {
    let fail = false;
    await mockSupabase(page, {
      routes: [{
        path: /\/rpc\/search_questions$/,
        reply: () => (fail
          ? { status: 500, body: { code: 'XX000', message: 'boom' } }
          : { body: [] }),
      }],
    });
    await page.goto('/professores/duvidas.html?materia=biologia');
    await expect(page.locator('#qaCount')).toHaveText('Nenhuma pergunta encontrada.');
    await expect(page.locator('#qaResultados .pf-empty')).toContainText('Ainda não há perguntas de Biologia');
    await expect(page.locator('#qaResultados').getByRole('link', { name: 'Fazer uma pergunta' })).toBeVisible();

    fail = true;
    await page.selectOption('#fMateria', 'fisica');
    const alert = page.locator('#qaResultados [role="alert"]');
    await expect(alert).toContainText('Não foi possível carregar as perguntas.');
    fail = false;
    await alert.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.locator('#qaResultados .pf-empty')).toContainText('Ainda não há perguntas de Física');
  });
});

// ---------- Nova pergunta ----------

test.describe('fazer uma pergunta', () => {
  test('sem login: pede para entrar (voltando para o formulário) e não mostra o formulário', async ({ page }) => {
    const calls = await mockSupabase(page);
    await page.goto('/professores/duvidas.html');
    const btn = page.locator('#btnPerguntar');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    const sec = page.locator('#perguntar');
    await expect(sec).toBeVisible();
    await expect(sec.getByRole('link', { name: 'Entrar para perguntar' }))
      .toHaveAttribute('href', '/professores/entrar.html?next=%2Fprofessores%2Fduvidas.html%23perguntar');
    await expect(sec.getByRole('link', { name: 'Criar conta grátis' }))
      .toHaveAttribute('href', '/professores/entrar.html?modo=cadastro&next=%2Fprofessores%2Fduvidas.html%23perguntar');
    await expect(page.locator('#askTitulo')).toHaveCount(0);
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/rest/v1/questions')).toEqual([]);
  });

  test('logado: valida, envia só subject_id/title/body e abre a dúvida criada', async ({ page }) => {
    const errors = trackErrors(page);
    await seedSession(page, STUDENT);
    const calls = await mockSupabase(page, {
      account: STUDENT,
      routes: [
        { method: 'POST', path: /^\/rest\/v1\/questions$/, reply: (c) => ({ status: 201, body: rowsFor(c, [{ id: 77 }]) }) },
        {
          method: 'GET',
          path: /^\/rest\/v1\/questions$/,
          reply: (c) => (c.url.searchParams.get('id') === 'eq.77'
            ? { body: [question({ id: 77, title: 'Qual a fórmula da velocidade média?', body: '', subjects: { id: 2, slug: 'fisica', name: 'Física' }, answers_count: 0 })] }
            : undefined),
        },
      ],
    });
    // #perguntar abre o formulário direto (volta do login)
    await page.goto('/professores/duvidas.html?materia=fisica#perguntar');
    const form = page.locator('#askForm');
    await expect(form).toBeVisible();
    await expect(page.locator('#btnPerguntar')).toHaveAttribute('aria-expanded', 'true');
    // Filtro ativo sugere a matéria
    await expect(page.locator('#askMateria')).toHaveValue('2');

    // Validação no cliente: nada é enviado
    await page.selectOption('#askMateria', '');
    await page.fill('#askTitulo', 'Oi?');
    await expect(page.locator('#askTitulo-count')).toHaveText('3/160 · mínimo 10');
    await form.getByRole('button', { name: 'Publicar pergunta' }).click();
    await expect(page.locator('#askMateria-err')).toHaveText('Escolha a matéria.');
    await expect(page.locator('#askTitulo-err')).toHaveText('Escreva pelo menos 10 caracteres (faltam 7).');
    await expect(page.locator('#askMateria')).toBeFocused();
    expect(calls.filter((c) => c.method === 'POST' && !c.path.startsWith('/rest/v1/rpc/'))).toEqual([]);

    await page.selectOption('#askMateria', '2');
    await page.fill('#askTitulo', '  Qual a fórmula da velocidade média?  ');
    await page.fill('#askTexto', 'Tenho prova amanhã.\nObrigada!');
    await expect(page.locator('#askTitulo-err')).toHaveText('');
    await expect(page.locator('#askTexto-count')).toHaveText('29/5000');
    await form.getByRole('button', { name: 'Publicar pergunta' }).click();

    await page.waitForURL('**/professores/duvida.html?q=77');
    const post = calls.find((c) => c.method === 'POST' && c.path === '/rest/v1/questions');
    // Só colunas com grant de INSERT (author_id vem de auth.uid() no banco)
    expect(Object.keys(post.body).sort()).toEqual(['body', 'subject_id', 'title']);
    expect(post.body).toEqual({ subject_id: 2, title: 'Qual a fórmula da velocidade média?', body: 'Tenho prova amanhã.\nObrigada!' });
    expect(post.url.searchParams.get('select')).toBe('id');
    expect(post.headers.authorization).toBe('Bearer FAKE.JWT.TOKEN');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Qual a fórmula da velocidade média?');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('limite diário (rate limit do banco) vira mensagem amigável', async ({ page }) => {
    await seedSession(page, STUDENT);
    await mockSupabase(page, {
      account: STUDENT,
      routes: [{
        method: 'POST',
        path: /^\/rest\/v1\/questions$/,
        reply: () => ({ status: 400, body: { code: 'P0001', message: 'Limite atingido, tente mais tarde.', details: null, hint: null } }),
      }],
    });
    await page.goto('/professores/duvidas.html');
    await page.locator('#btnPerguntar').click();
    await page.selectOption('#askMateria', '1');
    await page.fill('#askTitulo', 'Como somar frações com denominadores diferentes?');
    await page.getByRole('button', { name: 'Publicar pergunta' }).click();
    await expect(page.locator('#askForm .pf-qa-status')).toHaveText('Você atingiu o limite de 5 perguntas por dia. Tente de novo amanhã.');
    await expect(page).toHaveURL(/duvidas\.html#perguntar$/);
    await expect(page.getByRole('button', { name: 'Publicar pergunta' })).toBeEnabled();
  });

  test('conta banida não vê o formulário', async ({ page }) => {
    const banned = { ...STUDENT, profile: { ...STUDENT.profile, banned_at: '2026-09-20T00:00:00Z' } };
    await seedSession(page, banned);
    await mockSupabase(page, { account: banned });
    await page.goto('/professores/duvidas.html#perguntar');
    await expect(page.locator('#perguntar')).toContainText('Sua conta está suspensa');
    await expect(page.locator('#askForm')).toHaveCount(0);
  });
});

// ---------- Página da dúvida ----------

function questionRoutes({ q = question(), answers = [answer(), HIDDEN_TUTOR_ANSWER] } = {}) {
  const state = { q, answers };
  const routes = [
    { method: 'GET', path: /^\/rest\/v1\/questions$/, reply: () => ({ body: state.q ? [state.q] : [] }) },
    { method: 'GET', path: /^\/rest\/v1\/answers$/, reply: () => ({ body: state.answers }) },
  ];
  return { state, routes };
}

test.describe('página da dúvida', () => {
  test('mostra pergunta e respostas como texto (sem XSS), com SEO e convites', async ({ page }) => {
    const errors = trackErrors(page);
    const { routes } = questionRoutes();
    const calls = await mockSupabase(page, { routes });
    await page.goto('/professores/duvida.html?q=42');

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveText(`Como resolver x² - 5x + 6 = 0? ${XSS}`);
    const body = page.locator('.pf-qa-q-body');
    await expect(body).toContainText(XSS);
    await expect(body).toHaveCSS('white-space', 'pre-line');
    await expect(page.locator('.pf-qa-question')).toContainText('Perguntada por Beatriz S.');
    await expect(page.locator('.pf-qa-question').getByRole('link', { name: 'Matemática' })).toHaveAttribute('href', '/professores/duvidas.html?materia=matematica');
    await expect(page.locator('main img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('main')).not.toContainText('null');
    await expect(page.locator('main')).not.toContainText('undefined');

    // Consultas: pergunta por id (com author_name e matéria) e respostas com o professor embutido
    const qReq = calls.find((c) => c.path === '/rest/v1/questions');
    expect(qReq.url.searchParams.get('id')).toBe('eq.42');
    expect(qReq.url.searchParams.get('select')).toContain('author_name');
    const aReq = calls.find((c) => c.path === '/rest/v1/answers');
    expect(aReq.url.searchParams.get('question_id')).toBe('eq.42');
    expect(aReq.url.searchParams.get('select')).toContain('tutor_profiles(slug,headline,profiles(full_name,avatar_path))');

    // Respostas
    await expect(page.locator('#respostasTitulo')).toHaveText('2 respostas');
    const answers = page.locator('.pf-qa-answer');
    await expect(answers).toHaveCount(2);
    await expect(answers.nth(0).getByRole('link', { name: 'Ana Silva' })).toHaveAttribute('href', '/professores/p/ana-silva');
    await expect(answers.nth(0)).toContainText('Matemática para o ENEM');
    await expect(answers.nth(0)).toHaveAttribute('id', 'resposta-7');
    // Professor oculto (embed null): nome genérico, sem link nem selo
    await expect(answers.nth(1).locator('.pf-qa-a-name')).toHaveText('Professor(a)');
    await expect(answers.nth(1).locator('.pf-badge')).toHaveCount(0);
    await expect(answers.nth(1).locator('a')).toHaveCount(0);
    await expect(answers.nth(1).locator('.pf-qa-a-body')).toContainText(XSS);
    // Denunciar: pergunta + 2 respostas (visitante)
    await expect(page.getByRole('button', { name: /Denunciar/ })).toHaveCount(3);

    // Visitante: sem formulário; convite para professor entrar e para aula particular
    await expect(page.locator('#respTexto')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Entrar para responder' }))
      .toHaveAttribute('href', '/professores/entrar.html?next=%2Fprofessores%2Fduvida.html%3Fq%3D42%23responder');
    const cta = page.locator('.pf-qa-cta');
    await expect(cta).toContainText('Quer aula particular?');
    await expect(cta.getByRole('link')).toHaveAttribute('href', '/professores/?materia=matematica');

    // SEO
    await expect(page).toHaveTitle(/^Como resolver x² - 5x \+ 6 = 0\? .* — Professores \| Quanta Aulas$/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://quantaaulas.com/professores/duvida.html?q=42');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Dúvida de Matemática: Como resolver/);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://quantaaulas.com/professores/duvida.html?q=42');
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    const ldText = await page.locator('#duvidaJsonLd').textContent();
    expect(ldText).not.toContain('<');
    const ld = JSON.parse(ldText);
    expect(ld).toMatchObject({
      '@type': 'QAPage',
      mainEntity: { '@type': 'Question', answerCount: 2, author: { name: 'Beatriz S.' } },
    });
    expect(ld.mainEntity.suggestedAnswer[0]).toMatchObject({ url: 'https://quantaaulas.com/professores/duvida.html?q=42#resposta-7', author: { name: 'Ana Silva' } });
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('professor vê o formulário, envia só question_id/body e depois edita a própria resposta', async ({ page }) => {
    const tutor = tutorAccount();
    await seedSession(page, tutor);
    const { state, routes } = questionRoutes({ answers: [answer()] });
    const mine = answer({
      id: 9, tutor_id: TUTOR_ID, body: 'Use a soma e o produto: as raízes somam 5 e multiplicam 6, então são 2 e 3.',
      created_at: ago(0), updated_at: ago(0),
      tutor_profiles: { slug: 'carlos-lima', headline: 'Professor de Física', profiles: { full_name: 'Carlos Lima', avatar_path: null } },
    });
    const calls = await mockSupabase(page, {
      account: tutor,
      routes: [
        {
          method: 'POST',
          path: /^\/rest\/v1\/answers$/,
          reply: (c) => {
            state.answers = [answer(), mine];
            return { status: 201, body: rowsFor(c, [{ id: 9 }]) };
          },
        },
        {
          method: 'PATCH',
          path: /^\/rest\/v1\/answers$/,
          reply: (c) => {
            state.answers = [answer(), { ...mine, body: c.body.body, updated_at: new Date().toISOString() }];
            return { body: [{ id: 9 }] };
          },
        },
        ...routes,
      ],
    });
    await page.goto('/professores/duvida.html?q=42');

    const form = page.locator('#responder');
    await expect(form.getByLabel('Sua resposta')).toBeVisible();
    await expect(page.locator('.pf-qa-question').getByRole('link', { name: 'Responder' })).toHaveAttribute('href', '#responder');
    // Professor não vê o convite de aula particular
    await expect(page.locator('.pf-qa-cta')).toHaveCount(0);

    // Curta demais: não envia
    await page.fill('#respTexto', 'São 2 e 3.');
    await expect(page.locator('#respTexto-count')).toHaveText('10/5000 · mínimo 20');
    await form.getByRole('button', { name: 'Publicar resposta' }).click();
    await expect(page.locator('#respTexto-err')).toHaveText('Escreva pelo menos 20 caracteres (faltam 10).');
    expect(calls.filter((c) => c.method === 'POST' && !c.path.startsWith('/rest/v1/rpc/'))).toEqual([]);

    await page.fill('#respTexto', `  ${mine.body}  `);
    await form.getByRole('button', { name: 'Publicar resposta' }).click();
    await expect(page.locator('#resposta-9')).toBeFocused();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/rest/v1/answers');
    expect(Object.keys(post.body).sort()).toEqual(['body', 'question_id']);
    expect(post.body).toEqual({ question_id: 42, body: mine.body });

    // Uma resposta por professor: o formulário vira aviso; a própria resposta tem Editar/Excluir
    await expect(page.locator('#respTexto')).toHaveCount(0);
    await expect(page.locator('#responder')).toContainText('Você já respondeu esta pergunta.');
    const own = page.locator('#resposta-9');
    await expect(own).toContainText('Sua resposta');
    await expect(own.getByRole('button', { name: /Denunciar/ })).toHaveCount(0);
    await expect(page.locator('.pf-qa-question').getByRole('link', { name: 'Responder' })).toHaveCount(0);

    await own.getByRole('button', { name: 'Editar' }).click();
    const edit = page.locator('#editResp9');
    await expect(edit).toBeFocused();
    await edit.fill('Soma 5 e produto 6: as raízes são 2 e 3. Confira substituindo na equação.');
    await own.getByRole('button', { name: 'Salvar resposta' }).click();
    await expect(page.locator('#resposta-9 .pf-qa-a-body')).toHaveText('Soma 5 e produto 6: as raízes são 2 e 3. Confira substituindo na equação.');
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/rest/v1/answers');
    expect(patch.body).toEqual({ body: 'Soma 5 e produto 6: as raízes são 2 e 3. Confira substituindo na equação.' });
    expect(patch.url.searchParams.get('id')).toBe('eq.9');
    await expect(page.locator('.pf-toast--ok').last()).toHaveText(/Resposta atualizada/);
  });

  test('resposta duplicada (23505) e limite diário mostram mensagens claras', async ({ page }) => {
    const tutor = tutorAccount();
    await seedSession(page, tutor);
    const { routes } = questionRoutes({ answers: [] });
    let code = 'P0001';
    const calls = await mockSupabase(page, {
      account: tutor,
      routes: [
        {
          method: 'POST',
          path: /^\/rest\/v1\/answers$/,
          reply: () => ({ status: code === '23505' ? 409 : 400, body: { code, message: code === 'P0001' ? 'Limite atingido, tente mais tarde.' : 'duplicate key value violates unique constraint', details: null, hint: null } }),
        },
        ...routes,
      ],
    });
    await page.goto('/professores/duvida.html?q=42');
    await expect(page.locator('.pf-qa-no-answers')).toContainText('Seja o primeiro professor a responder!');
    await page.fill('#respTexto', 'Resposta com mais de vinte caracteres.');
    await page.getByRole('button', { name: 'Publicar resposta' }).click();
    await expect(page.locator('#responder .pf-qa-status')).toHaveText('Você atingiu o limite de 30 respostas por dia. Obrigado pela dedicação! Tente de novo amanhã.');
    code = '23505';
    await page.getByRole('button', { name: 'Publicar resposta' }).click();
    // Duplicada: aviso (toast) e as respostas são recarregadas
    await expect(page.locator('.pf-toast--erro .pf-toast-msg').last()).toHaveText('Você já respondeu esta pergunta. Edite a sua resposta em vez de enviar outra.');
    await expect.poll(() => calls.filter((c) => c.method === 'GET' && c.path === '/rest/v1/answers').length).toBe(2);
  });

  test('aluno não vê o formulário de resposta; vê o convite para aula particular', async ({ page }) => {
    const other = { ...STUDENT, profile: { ...STUDENT.profile, id: '66666666-6666-4666-8666-666666666666' }, user: authUser('66666666-6666-4666-8666-666666666666', 'x@exemplo.test') };
    await seedSession(page, other);
    const { routes } = questionRoutes();
    await mockSupabase(page, { account: other, routes });
    await page.goto('/professores/duvida.html?q=42');
    await expect(page.locator('.pf-qa-answer')).toHaveCount(2);
    await expect(page.locator('#respTexto')).toHaveCount(0);
    await expect(page.locator('#responder')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Entrar para responder' })).toHaveCount(0);
    await expect(page.locator('.pf-qa-cta').getByRole('link', { name: 'Professores de Matemática' })).toHaveAttribute('href', '/professores/?materia=matematica');
    // Não é autor: sem Editar/Excluir, com Denunciar
    await expect(page.locator('.pf-qa-question').getByRole('button', { name: 'Editar' })).toHaveCount(0);
    await expect(page.locator('.pf-qa-question').getByRole('button', { name: /Denunciar/ })).toHaveCount(1);
  });

  test('professor suspenso não pode responder', async ({ page }) => {
    const tutor = tutorAccount({ suspended: true });
    await seedSession(page, tutor);
    const { routes } = questionRoutes();
    await mockSupabase(page, { account: tutor, routes });
    await page.goto('/professores/duvida.html?q=42');
    await expect(page.locator('#responder')).toContainText('Seu anúncio está suspenso');
    await expect(page.locator('#respTexto')).toHaveCount(0);
  });

  test('autor edita (só colunas permitidas) e exclui a própria pergunta', async ({ page }) => {
    await seedSession(page, STUDENT);
    const { state, routes } = questionRoutes();
    const calls = await mockSupabase(page, {
      account: STUDENT,
      routes: [
        {
          method: 'PATCH',
          path: /^\/rest\/v1\/questions$/,
          reply: (c) => {
            state.q = { ...state.q, ...c.body, subjects: SUBJECTS.find((s) => s.id === c.body.subject_id) };
            return { body: [{ id: 42 }] };
          },
        },
        { method: 'DELETE', path: /^\/rest\/v1\/questions$/, reply: () => ({ body: [{ id: 42 }] }) },
        ...routes,
      ],
    });
    await page.goto('/professores/duvida.html?q=42');
    const q = page.locator('.pf-qa-question');
    await expect(q.getByRole('button', { name: /Denunciar/ })).toHaveCount(0);
    // Autor (aluno) vê o convite para aula e nenhum formulário de resposta
    await expect(page.locator('#respTexto')).toHaveCount(0);

    await q.getByRole('button', { name: 'Editar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar pergunta' })).toBeFocused();
    await expect(page.locator('#editMateria')).toHaveValue('1');
    await page.selectOption('#editMateria', '2');
    await page.fill('#editTitulo', 'Como achar as raízes de x² - 5x + 6?');
    await page.fill('#editTexto', 'Atualizei: já entendi o delta.');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Como achar as raízes de x² - 5x + 6?');
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(Object.keys(patch.body).sort()).toEqual(['body', 'subject_id', 'title']);
    expect(patch.body).toEqual({ subject_id: 2, title: 'Como achar as raízes de x² - 5x + 6?', body: 'Atualizei: já entendi o delta.' });
    expect(patch.url.searchParams.get('id')).toBe('eq.42');
    expect(patch.url.searchParams.get('select')).toBe('id');
    await expect(page).toHaveTitle('Como achar as raízes de x² - 5x + 6? — Professores | Quanta Aulas');

    await page.locator('.pf-qa-question').getByRole('button', { name: 'Excluir' }).click();
    const dlg = page.getByRole('dialog', { name: 'Excluir pergunta?' });
    await expect(dlg).toContainText('as 2 respostas dela serão apagadas');
    await dlg.getByRole('button', { name: 'Excluir pergunta' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pergunta excluída');
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del.url.searchParams.get('id')).toBe('eq.42');
  });

  test('pergunta oculta: autor vê o aviso e não pode editar; edição que muda 0 linhas avisa', async ({ page }) => {
    await seedSession(page, STUDENT);
    const { routes } = questionRoutes({ q: question({ status: 'hidden' }), answers: [] });
    await mockSupabase(page, { account: STUDENT, routes });
    await page.goto('/professores/duvida.html?q=42');
    await expect(page.locator('.pf-qa-hidden-notice')).toContainText('ocultada pela moderação');
    await expect(page.locator('.pf-qa-question').getByRole('button', { name: 'Editar' })).toHaveCount(0);
    await expect(page.locator('.pf-qa-question').getByRole('button', { name: 'Excluir' })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });

  test('edição recusada pelo RLS (0 linhas) mostra erro em vez de sucesso', async ({ page }) => {
    await seedSession(page, STUDENT);
    const { routes } = questionRoutes({ answers: [] });
    await mockSupabase(page, {
      account: STUDENT,
      routes: [{ method: 'PATCH', path: /^\/rest\/v1\/questions$/, reply: () => ({ body: [] }) }, ...routes],
    });
    await page.goto('/professores/duvida.html?q=42');
    await page.locator('.pf-qa-question').getByRole('button', { name: 'Editar' }).click();
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.locator('#pergunta .pf-qa-status')).toContainText('não pode mais ser editada');
  });

  test('id inválido ou inexistente mostra "Pergunta não encontrada"', async ({ page }) => {
    const errors = trackErrors(page);
    const calls = await mockSupabase(page);
    await page.goto('/professores/duvida.html?q=abc');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pergunta não encontrada');
    expect(calls.filter((c) => c.path === '/rest/v1/questions')).toEqual([]);
    await page.goto('/professores/duvida.html?q=999');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pergunta não encontrada');
    await expect(page).toHaveTitle('Pergunta não encontrada — Professores | Quanta Aulas');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expect(page.getByRole('link', { name: 'Ver todas as dúvidas' })).toHaveAttribute('href', '/professores/duvidas.html');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('link direto para uma resposta (#resposta-<id>) foca a resposta', async ({ page }) => {
    const { routes } = questionRoutes();
    await mockSupabase(page, { routes });
    await page.goto('/professores/duvida.html?q=42#resposta-8');
    await expect(page.locator('#resposta-8')).toBeFocused();
  });
});

// ---------- Componentes ----------

const PROFILE_ROUTE = {
  path: /^\/rest\/v1\/tutor_profiles$/,
  reply: () => ({
    body: [{
      user_id: OTHER_TUTOR_ID, slug: 'ana-silva', headline: 'Matemática para o ENEM', bio: 'Bio', hourly_rate_cents: 8000,
      mode_online: true, mode_presencial: false, uf: null, city_name: null, published: true, suspended: false,
      plan: 'basico', plan_expires_at: null, rating_avg: 0, rating_count: 0, last_active_at: null, created_at: '2026-01-10T12:00:00Z',
      profiles: { full_name: 'Ana Silva', avatar_path: null },
      tutor_subjects: [{ levels: [], subjects: { id: 1, name: 'Matemática', slug: 'matematica' } }],
    }],
  }),
};

test('perfil: professor sem respostas não mostra a seção do tira-dúvidas', async ({ page }) => {
  const calls = await mockSupabase(page, { routes: [PROFILE_ROUTE] });
  await page.goto('/professores/p/ana-silva');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ana Silva');
  await expect.poll(() => calls.some((c) => c.path === '/rest/v1/answers')).toBe(true);
  await expect(page.locator('#respostas [data-mount="answers"]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#respostas')).toBeHidden();
});

test('perfil: últimas respostas do professor com link para a dúvida', async ({ page }) => {
  const calls = await mockSupabase(page, {
    routes: [
      PROFILE_ROUTE,
      {
        path: /^\/rest\/v1\/answers$/,
        reply: () => ({
          body: [
            { id: 7, body: `Calcule o delta primeiro. ${XSS}`, created_at: ago(5), question_id: 42, questions: { id: 42, title: `Como resolver ${XSS}?`, status: 'open', subjects: { name: 'Matemática' } } },
            { id: 3, body: 'Resposta a pergunta oculta', created_at: ago(9), question_id: 40, questions: null },
          ],
        }),
      },
    ],
  });
  await page.goto('/professores/p/ana-silva');
  const box = page.locator('.pf-ta');
  await expect(box.locator('.pf-ta-item')).toHaveCount(1);
  const link = box.locator('.pf-ta-q');
  await expect(link).toHaveText(`Como resolver ${XSS}?`);
  await expect(link).toHaveAttribute('href', '/professores/duvida.html?q=42#resposta-7');
  await expect(box).toContainText(`Calcule o delta primeiro. ${XSS}`);
  await expect(page.locator('main img[src="x"]')).toHaveCount(0);

  await expect(page.locator('#respostas')).toBeVisible();

  const req = calls.find((c) => c.path === '/rest/v1/answers');
  expect(req.url.searchParams.get('tutor_id')).toBe(`eq.${OTHER_TUTOR_ID}`);
  expect(req.url.searchParams.get('status')).toBe('eq.published');
  expect(req.url.searchParams.get('limit')).toBe('5');
  expect(req.url.searchParams.get('select')).toContain('questions!inner(');
});

test.describe('painel: aba Tira-dúvidas', () => {
  test('aluno vê as próprias perguntas e exclui uma', async ({ page }) => {
    await seedSession(page, STUDENT);
    let rows = [
      { id: 42, title: 'Como resolver x² - 5x + 6 = 0?', status: 'open', answers_count: 2, created_at: ago(30), subjects: { name: 'Matemática' } },
      { id: 43, title: 'Pergunta ocultada pela moderação', status: 'hidden', answers_count: 0, created_at: ago(60), subjects: null },
    ];
    const calls = await mockSupabase(page, {
      account: STUDENT,
      routes: [
        { method: 'GET', path: /^\/rest\/v1\/questions$/, reply: () => ({ body: rows }) },
        {
          method: 'DELETE',
          path: /^\/rest\/v1\/questions$/,
          reply: (c) => {
            rows = rows.filter((r) => `eq.${r.id}` !== c.url.searchParams.get('id'));
            return { body: [{ id: 42 }] };
          },
        },
      ],
    });
    await page.goto('/professores/painel.html#duvidas');
    const items = page.locator('.pf-pq-item');
    await expect(items).toHaveCount(2);
    const q = calls.find((c) => c.path === '/rest/v1/questions');
    expect(q.url.searchParams.get('author_id')).toBe(`eq.${STUDENT_ID}`);
    await expect(items.nth(0).getByRole('link')).toHaveAttribute('href', '/professores/duvida.html?q=42');
    await expect(items.nth(0)).toContainText('2 respostas');
    // Oculta: aviso e sem botão de excluir
    await expect(items.nth(1)).toContainText('Oculta pela moderação');
    await expect(items.nth(1).getByRole('button')).toHaveCount(0);
    await expect(page.locator('.pf-pq').getByRole('link', { name: 'Fazer uma pergunta' })).toHaveAttribute('href', '/professores/duvidas.html#perguntar');

    await items.nth(0).getByRole('button', { name: /Excluir/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Excluir pergunta' }).click();
    await expect(page.locator('.pf-pq-item')).toHaveCount(1);
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del.url.searchParams.get('id')).toBe('eq.42');
  });

  test('professor vê as próprias respostas (pergunta oculta = embed null) e o link para responder', async ({ page }) => {
    const tutor = tutorAccount();
    await seedSession(page, tutor);
    const calls = await mockSupabase(page, {
      account: tutor,
      routes: [
        {
          method: 'GET',
          path: /^\/rest\/v1\/answers$/,
          reply: () => ({
            body: [
              { id: 9, body: 'Use soma e produto.', status: 'published', created_at: ago(3), updated_at: ago(3), question_id: 42, questions: { id: 42, title: 'Como resolver x² - 5x + 6 = 0?', status: 'open' } },
              { id: 5, body: 'Resposta antiga.', status: 'published', created_at: ago(90), updated_at: ago(90), question_id: 40, questions: null },
            ],
          }),
        },
      ],
    });
    await page.goto('/professores/painel.html#duvidas');
    const items = page.locator('.pf-pq-item');
    await expect(items).toHaveCount(2);
    const a = calls.find((c) => c.path === '/rest/v1/answers');
    expect(a.url.searchParams.get('tutor_id')).toBe(`eq.${TUTOR_ID}`);
    await expect(items.nth(0).locator('.pf-pq-title')).toHaveAttribute('href', '/professores/duvida.html?q=42#resposta-9');
    await expect(items.nth(1)).toContainText('Pergunta indisponível');
    await expect(page.locator('.pf-pq').getByRole('link', { name: 'Responder dúvidas' })).toHaveAttribute('href', '/professores/duvidas.html');
  });
});

// ---------- Celular ----------

test.describe('celular (360px)', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  const wideElements = (page) => page.evaluate(() => [...document.querySelectorAll('header *, main *, footer *')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1;
    })
    .map((el) => `${el.tagName.toLowerCase()}.${el.className}`));

  test('lista e formulário sem rolagem horizontal', async ({ page }) => {
    await seedSession(page, STUDENT);
    await mockSupabase(page, {
      account: STUDENT,
      routes: [{ path: /\/rpc\/search_questions$/, reply: () => ({ body: listRows(40) }) }],
    });
    await page.goto('/professores/duvidas.html#perguntar');
    await expect(page.locator('#askForm')).toBeVisible();
    await expect(page.locator('#qaResultados .pf-qa-card')).toHaveCount(2);
    expect(await wideElements(page)).toEqual([]);
  });

  test('página da dúvida sem rolagem horizontal', async ({ page }) => {
    const tutor = tutorAccount();
    await seedSession(page, tutor);
    const long = 'Palavraenormesemespaçosparatestarquebradelinhaemtelaspequenas'.repeat(3);
    const { routes } = questionRoutes({ q: question({ title: `Título ${long}`, body: long }) });
    await mockSupabase(page, { account: tutor, routes });
    await page.goto('/professores/duvida.html?q=42');
    await expect(page.locator('#respTexto')).toBeVisible();
    expect(await wideElements(page)).toEqual([]);
  });
});
