// Contas: entrar/cadastro/recuperar senha, painel (professor e aluno) e páginas legais.
// Supabase falso em http://supabase.test (REST, RPC, auth, storage).
import { test, expect } from '@playwright/test';

const AUTH_KEY = 'sb-supabase-auth-token'; // 'sb-' + 'supabase'(.test) + '-auth-token'
const UID = '11111111-2222-4333-8444-555555555555';
const EMAIL = 'ana@exemplo.test';
// PNG 4x2 (retangular: testa o recorte quadrado)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGOQv9YKRwzIHACWegvRTuCdRQAAAABJRU5ErkJggg==', 'base64');

// Colunas de tutor_profiles com grant de UPDATE para authenticated (migração 001)
const TUTOR_UPDATE_COLS = ['slug', 'headline', 'bio', 'hourly_rate_cents', 'mode_online', 'mode_presencial', 'uf', 'city_ibge', 'city_name', 'published'];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': '*',
  // Como o GoTrue real: com este cabeçalho o auth-js expõe error.code (ex.: over_email_send_rate_limit)
  'x-supabase-api-version': '2024-01-01',
};

const user = (extra = {}) => ({
  id: UID, aud: 'authenticated', role: 'authenticated', email: EMAIL,
  email_confirmed_at: '2026-09-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {},
  created_at: '2026-09-01T00:00:00Z', ...extra,
});

function tutorRow(extra = {}) {
  return {
    user_id: UID, slug: 'ana-silva', headline: '', bio: '', hourly_rate_cents: null,
    mode_online: true, mode_presencial: false, uf: null, city_ibge: null, city_name: null,
    published: false, suspended: false, plan: 'basico', plan_expires_at: null, rating_avg: 0, rating_count: 0,
    search_tsv: "'ana':1", last_active_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    ...extra,
  };
}

function profileRow({ role = 'tutor', tutor = {}, ...extra } = {}) {
  return {
    id: UID, role, full_name: 'Ana Silva', avatar_path: null, is_admin: false, banned_at: null,
    terms_accepted_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    tutor_profiles: role === 'tutor' ? tutorRow(tutor) : null,
    ...extra,
  };
}

const SUBJECTS = [
  { id: 1, slug: 'matematica', name: 'Matemática', category: 'Exatas' },
  { id: 2, slug: 'fisica', name: 'Física', category: 'Exatas' },
  { id: 3, slug: 'quimica', name: 'Química', category: 'Exatas' },
  { id: 4, slug: 'biologia', name: 'Biologia', category: 'Ciências' },
  { id: 5, slug: 'ingles', name: 'Inglês', category: 'Idiomas' },
];
const PLANS = [
  { code: 'basico', name: 'Básico', max_subjects: 3 },
  { code: 'profissional', name: 'Profissional', max_subjects: 10 },
  { code: 'premium', name: 'Premium', max_subjects: 30 },
];

/**
 * Supabase falso. routes: [{ method?, path: RegExp, reply(call) -> { status?, body?, headers? } }]
 * (conferidas em ordem, antes das respostas padrão). Retorna a lista de chamadas feitas.
 */
async function mockSupabase(page, routes = []) {
  const calls = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'supabase.test') {
      // Google Fonts etc.: vazio, sem rede
      return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css', body: '' });
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    let body = null;
    const raw = req.postDataBuffer();
    if (raw) {
      const text = raw.toString('utf8');
      try { body = JSON.parse(text); } catch { body = text; }
    }
    const call = { method: req.method(), path: url.pathname, url, body, headers: req.headers(), raw };
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
    if (url.pathname === '/auth/v1/user') return json(user());
    return json({});
  });
  return calls;
}

// Sessão salva do supabase-js (usuário logado)
async function seedSession(page) {
  await page.addInitScript(([key, u]) => {
    localStorage.setItem(key, JSON.stringify({
      access_token: 'FAKE.JWT.TOKEN', refresh_token: 'fakerefresh', token_type: 'bearer',
      expires_in: 3600, expires_at: 4102444800, user: u,
    }));
  }, [AUTH_KEY, user()]);
}

function trackErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

/** Mocks de um professor logado. Devolve { calls, state } (state.profile é mutável). */
async function tutorPainel(page, { profile = profileRow(), tutorSubjects = [{ subject_id: 1, levels: ['medio'] }], extra = [] } = {}) {
  const st = { profile, tutorSubjects };
  await seedSession(page);
  const calls = await mockSupabase(page, [
    ...extra,
    { method: 'GET', path: /^\/rest\/v1\/profiles$/, reply: () => ({ body: [st.profile] }) },
    { method: 'GET', path: /^\/rest\/v1\/tutor_subjects$/, reply: () => ({ body: st.tutorSubjects }) },
    { method: 'GET', path: /^\/rest\/v1\/subjects$/, reply: () => ({ body: SUBJECTS }) },
    { method: 'GET', path: /^\/rest\/v1\/plans$/, reply: () => ({ body: PLANS }) },
    {
      method: 'PATCH', path: /^\/rest\/v1\/tutor_profiles$/,
      reply: (c) => ({ body: [{ ...st.profile.tutor_profiles, ...c.body }] }),
    },
    {
      method: 'PATCH', path: /^\/rest\/v1\/profiles$/,
      reply: (c) => {
        Object.assign(st.profile, c.body);
        return { body: [{ ...c.body }] };
      },
    },
  ]);
  return { calls, st };
}

// ======================================================================
// Entrar / cadastro
// ======================================================================

test.describe('entrar: cadastro', () => {
  test('valida os campos e não chama o signup com formulário incompleto', async ({ page }) => {
    const calls = await mockSupabase(page);
    await page.goto('/professores/entrar.html?modo=cadastro');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Criar conta');

    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByText('Informe seu nome completo.')).toBeVisible();
    await expect(page.getByText('Informe um e-mail válido.')).toBeVisible();
    await expect(page.getByText('A senha precisa ter pelo menos 8 caracteres.')).toBeVisible();
    await expect(page.getByText('é preciso aceitar os Termos de Uso')).toBeVisible();
    await expect(page.getByLabel('Nome completo')).toBeFocused();
    await expect(page.getByLabel('Nome completo')).toHaveAttribute('aria-invalid', 'true');

    await page.getByLabel('Nome completo').fill('Ana Silva');
    await page.getByLabel('E-mail').fill('ana@exemplo');
    await page.getByLabel('Senha', { exact: true }).fill('abcdefgh');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByText('Informe um e-mail válido.')).toBeVisible();
    await expect(page.getByText('Use letras e números na senha.')).toBeVisible();

    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByLabel('Senha', { exact: true }).fill('segredo123');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    // Termos ainda não aceitos
    await expect(page.getByText('é preciso aceitar os Termos de Uso')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Li e aceito os Termos de Uso/ })).toBeFocused();

    expect(calls.filter((c) => c.path === '/auth/v1/signup')).toHaveLength(0);
  });

  test('envia papel, nome e aceite no metadata e mostra "confirme seu e-mail"', async ({ page }) => {
    const errors = trackErrors(page);
    const calls = await mockSupabase(page, [
      {
        method: 'POST', path: /^\/auth\/v1\/signup$/,
        reply: (c) => ({ body: user({ email: c.body.email, email_confirmed_at: null, user_metadata: c.body.data, identities: [{ id: UID }] }) }),
      },
    ]);
    await page.goto('/professores/entrar.html?modo=cadastro&tipo=professor');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Criar conta de professor');
    await expect(page.getByRole('radio', { name: /Dar aulas/ })).toBeChecked();

    await page.getByLabel('Nome completo').fill('  Ana   Silva ');
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByLabel('Senha', { exact: true }).fill('segredo123');
    // Mostrar/ocultar senha
    await page.getByRole('button', { name: 'Mostrar senha' }).click();
    await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('checkbox', { name: /Li e aceito os Termos de Uso e a Política de Privacidade e declaro ter 18 anos ou mais, ou estar cadastrando com autorização do meu responsável legal/ }).check();
    await page.getByRole('button', { name: 'Criar conta' }).click();

    await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible();
    await expect(page.getByText(EMAIL)).toBeVisible();

    const signup = calls.find((c) => c.path === '/auth/v1/signup');
    expect(signup.body.email).toBe(EMAIL);
    expect(signup.body.password).toBe('segredo123');
    expect(signup.body.data).toEqual({ full_name: 'Ana Silva', role: 'tutor', accepted_terms: 'true' });
    // PKCE: desafio enviado; link de confirmação volta para entrar.html e segue para o painel
    expect(signup.body.code_challenge).toBeTruthy();
    const redirect = new URL(signup.url.searchParams.get('redirect_to'));
    expect(redirect.origin).toBe(new URL(page.url()).origin);
    expect(redirect.pathname).toBe('/professores/entrar.html');
    expect(redirect.searchParams.get('confirmado')).toBe('1');
    expect(redirect.searchParams.get('next')).toBe('/professores/painel.html?bemvindo=1');

    // Reenviar e-mail
    await page.getByRole('button', { name: 'Reenviar e-mail' }).click();
    await expect(page.getByText('E-mail reenviado.')).toBeVisible();
    const resend = calls.find((c) => c.path === '/auth/v1/resend');
    expect(resend.body).toMatchObject({ email: EMAIL, type: 'signup' });
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('aluno por padrão; trocar para professor muda o metadata', async ({ page }) => {
    const calls = await mockSupabase(page, [
      { method: 'POST', path: /^\/auth\/v1\/signup$/, reply: () => ({ body: user({ email_confirmed_at: null }) }) },
    ]);
    await page.goto('/professores/entrar.html?modo=cadastro');
    await expect(page.getByRole('radio', { name: /Aprender/ })).toBeChecked();
    await page.getByLabel('Nome completo').fill('Bruno Costa');
    await page.getByLabel('E-mail').fill('bruno@exemplo.test');
    await page.getByLabel('Senha', { exact: true }).fill('outrasenha9');
    await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible();
    expect(calls.find((c) => c.path === '/auth/v1/signup').body.data.role).toBe('student');
  });

  // Funil "Enviar mensagem" sem conta: o link de confirmação (e o reenvio) voltam para o professor
  test('cadastro vindo de "Enviar mensagem": link de confirmação leva o next do professor', async ({ page }) => {
    const errors = trackErrors(page);
    const calls = await mockSupabase(page, [
      { method: 'POST', path: /^\/auth\/v1\/signup$/, reply: () => ({ body: user({ email_confirmed_at: null }) }) },
    ]);
    const next = '/professores/p/bruno-costa#mensagem';
    await page.goto(`/professores/entrar.html?next=${encodeURIComponent(next)}`);
    // "Criar conta" mantém o next
    await page.getByRole('link', { name: 'Criar conta' }).first().click();
    await page.waitForURL(/modo=cadastro/);
    expect(new URL(page.url()).searchParams.get('next')).toBe(next);

    await page.getByLabel('Nome completo').fill('Maria Souza');
    await page.getByLabel('E-mail').fill('maria@exemplo.test');
    await page.getByLabel('Senha', { exact: true }).fill('segredo123');
    await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible();

    const redirect = new URL(calls.find((c) => c.path === '/auth/v1/signup').url.searchParams.get('redirect_to'));
    expect(redirect.pathname).toBe('/professores/entrar.html');
    expect(redirect.searchParams.get('confirmado')).toBe('1');
    expect(redirect.searchParams.get('next')).toBe(next);
    // O próprio redirect_to não tem fragmento (o # do next vai codificado)
    expect(redirect.hash).toBe('');

    await page.getByRole('button', { name: 'Reenviar e-mail' }).click();
    await expect.poll(() => calls.filter((c) => c.path === '/auth/v1/resend').length).toBe(1);
    const resend = calls.find((c) => c.path === '/auth/v1/resend');
    expect(new URL(resend.url.searchParams.get('redirect_to')).searchParams.get('next')).toBe(next);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('cadastro com next inseguro: link de confirmação volta para o painel', async ({ page }) => {
    const calls = await mockSupabase(page, [
      { method: 'POST', path: /^\/auth\/v1\/signup$/, reply: () => ({ body: user({ email_confirmed_at: null }) }) },
    ]);
    await page.goto(`/professores/entrar.html?modo=cadastro&next=${encodeURIComponent('//evil.com/professores/')}`);
    await page.getByLabel('Nome completo').fill('Maria Souza');
    await page.getByLabel('E-mail').fill('maria@exemplo.test');
    await page.getByLabel('Senha', { exact: true }).fill('segredo123');
    await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible();
    const redirect = new URL(calls.find((c) => c.path === '/auth/v1/signup').url.searchParams.get('redirect_to'));
    expect(redirect.searchParams.get('next')).toBe('/professores/painel.html?bemvindo=1');
  });

  test('confirmação desligada (signup já devolve sessão): vai direto para o next', async ({ page }) => {
    await mockSupabase(page, [
      {
        method: 'POST', path: /^\/auth\/v1\/signup$/,
        reply: () => ({
          body: {
            access_token: 'FAKE.JWT.TOKEN', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
            refresh_token: 'fakerefresh', user: user(),
          },
        }),
      },
      { method: 'GET', path: /^\/rest\/v1\/profiles$/, reply: () => ({ body: [profileRow({ role: 'student' })] }) },
    ]);
    await page.goto(`/professores/entrar.html?modo=cadastro&next=${encodeURIComponent('/professores/duvidas.html#perguntar')}`);
    await page.getByLabel('Nome completo').fill('Maria Souza');
    await page.getByLabel('E-mail').fill('maria@exemplo.test');
    await page.getByLabel('Senha', { exact: true }).fill('segredo123');
    await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await page.waitForURL('**/professores/duvidas.html#perguntar');
  });

  test('erros do Auth aparecem em português (senha fraca, limite de envio)', async ({ page }) => {
    let n = 0;
    await mockSupabase(page, [
      {
        method: 'POST', path: /^\/auth\/v1\/signup$/,
        reply: () => (++n === 1
          ? { status: 422, body: { code: 'weak_password', message: 'Password is known to be weak and easy to guess', weak_password: { reasons: ['pwned'] } } }
          : { status: 429, body: { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } }),
      },
    ]);
    await page.goto('/professores/entrar.html?modo=cadastro');
    await page.getByLabel('Nome completo').fill('Ana Silva');
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByLabel('Senha', { exact: true }).fill('senha1234');
    await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Senha fraca' })).toBeVisible();
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Muitos e-mails enviados' })).toBeVisible();
  });
});

test.describe('entrar: login e redirecionamento', () => {
  async function login(page, next) {
    const calls = await mockSupabase(page, [
      {
        method: 'POST', path: /^\/auth\/v1\/token$/,
        reply: () => ({
          body: {
            access_token: 'FAKE.JWT.TOKEN', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
            refresh_token: 'fakerefresh', user: user(),
          },
        }),
      },
      { method: 'GET', path: /^\/rest\/v1\/profiles$/, reply: () => ({ body: [profileRow({ role: 'student' })] }) },
    ]);
    const qs = next == null ? '' : `?next=${encodeURIComponent(next)}`;
    await page.goto(`/professores/entrar.html${qs}`);
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByLabel('Senha', { exact: true }).fill('segredo123');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    return calls;
  }

  test('volta para o next seguro (/professores/…) com query e hash', async ({ page }) => {
    const calls = await login(page, '/professores/duvidas.html?materia=matematica#topo');
    await page.waitForURL('**/professores/duvidas.html?materia=matematica#topo');
    const token = calls.find((c) => c.path === '/auth/v1/token');
    expect(token.url.searchParams.get('grant_type')).toBe('password');
    expect(token.body).toMatchObject({ email: EMAIL, password: 'segredo123' });
  });

  for (const evil of ['//evil.com', 'https://evil.com', '//evil.com/professores/', '/\\evil.com', 'javascript:alert(1)', '/professores/../../evil', '/outra/pagina']) {
    test(`next inseguro vai para o painel: ${evil}`, async ({ page }) => {
      await login(page, evil);
      await page.waitForURL((u) => u.pathname === '/professores/painel.html');
      expect(new URL(page.url()).host).toMatch(/^localhost:/);
    });
  }

  test('sem next vai para o painel', async ({ page }) => {
    await login(page, null);
    await page.waitForURL((u) => u.pathname === '/professores/painel.html');
  });

  test('credenciais inválidas e e-mail não confirmado', async ({ page }) => {
    let n = 0;
    const calls = await mockSupabase(page, [
      {
        method: 'POST', path: /^\/auth\/v1\/token$/,
        reply: () => (++n === 1
          ? { status: 400, body: { code: 'invalid_credentials', message: 'Invalid login credentials' } }
          : { status: 400, body: { code: 'email_not_confirmed', message: 'Email not confirmed' } }),
      },
    ]);
    await page.goto('/professores/entrar.html');
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByLabel('Senha', { exact: true }).fill('errada123');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos' })).toBeVisible();
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'ainda não confirmou seu e-mail' })).toBeVisible();
    await page.getByRole('button', { name: 'Reenviar e-mail de confirmação' }).click();
    await expect(page.getByText('E-mail reenviado.')).toBeVisible();
    expect(calls.some((c) => c.path === '/auth/v1/resend')).toBe(true);
    await expect(page).toHaveURL(/entrar\.html$/);
  });

  test('já logado: entrar redireciona para o next', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, [
      { method: 'GET', path: /^\/rest\/v1\/profiles$/, reply: () => ({ body: [profileRow({ role: 'student' })] }) },
    ]);
    await page.goto('/professores/entrar.html?next=%2Fprofessores%2Fplanos.html');
    await page.waitForURL((u) => u.pathname === '/professores/planos.html');
  });
});

test.describe('entrar: recuperar senha', () => {
  test('esqueci: envia link para ?modo=nova-senha e não revela se o e-mail existe', async ({ page }) => {
    const calls = await mockSupabase(page);
    await page.goto('/professores/entrar.html?modo=esqueci');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recuperar senha');
    await page.getByLabel('E-mail da conta').fill(EMAIL);
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByRole('heading', { name: 'Verifique seu e-mail' })).toBeVisible();
    const rec = calls.find((c) => c.path === '/auth/v1/recover');
    expect(rec.body.email).toBe(EMAIL);
    const redirect = new URL(rec.url.searchParams.get('redirect_to'));
    expect(redirect.pathname).toBe('/professores/entrar.html');
    expect(redirect.searchParams.get('modo')).toBe('nova-senha');
  });

  test('nova senha com sessão de recuperação: updateUser({ password })', async ({ page }) => {
    await seedSession(page);
    const calls = await mockSupabase(page, [
      { method: 'PUT', path: /^\/auth\/v1\/user$/, reply: () => ({ body: user() }) },
    ]);
    await page.goto('/professores/entrar.html?modo=nova-senha');
    await page.getByLabel('Nova senha', { exact: true }).fill('novasenha1');
    await page.getByLabel('Repita a nova senha', { exact: true }).fill('diferente1');
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();
    await expect(page.getByText('As senhas não conferem.')).toBeVisible();
    await page.getByLabel('Repita a nova senha', { exact: true }).fill('novasenha1');
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();
    await expect(page.getByRole('heading', { name: 'Senha alterada!' })).toBeVisible();
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/auth/v1/user');
    expect(put.body).toMatchObject({ password: 'novasenha1' });
  });

  test('nova senha sem sessão (link expirado / outro navegador) pede novo link', async ({ page }) => {
    const errors = trackErrors(page);
    await mockSupabase(page);
    await page.goto('/professores/entrar.html?modo=nova-senha&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid');
    await expect(page.getByRole('heading', { name: 'Link inválido ou expirado' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'expirou' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pedir um novo link' })).toHaveAttribute('href', '/professores/entrar.html?modo=esqueci');
    // Parâmetros de erro saem do endereço
    await expect(page).toHaveURL(/entrar\.html\?modo=nova-senha$/);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('link de confirmação aberto em outro navegador: e-mail confirmado, pede login', async ({ page }) => {
    const calls = await mockSupabase(page);
    await page.goto('/professores/entrar.html?modo=entrar&confirmado=1&next=%2Fprofessores%2Fpainel.html%3Fbemvindo%3D1&code=abc123');
    await expect(page.getByRole('status').filter({ hasText: 'E-mail confirmado!' })).toBeVisible();
    await expect(page).not.toHaveURL(/code=/);
    // Sem code_verifier neste navegador: nada de troca de código
    expect(calls.some((c) => c.path === '/auth/v1/token')).toBe(false);
  });
});

// ======================================================================
// Painel
// ======================================================================

test.describe('painel', () => {
  test('sem sessão redireciona para entrar com next', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/professores/painel.html');
    await page.waitForURL(/\/professores\/entrar\.html\?next=%2Fprofessores%2Fpainel\.html$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Entrar');
  });

  test('sem sessão preserva a aba no next', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/professores/painel.html#plano');
    await page.waitForURL(/entrar\.html\?next=%2Fprofessores%2Fpainel\.html%23plano$/);
  });

  test('sem sessão: hash com token (#access_token=...) nunca vai para o next', async ({ page }) => {
    const reqs = [];
    page.on('request', (r) => reqs.push(r.url()));
    await mockSupabase(page);
    await page.goto('/professores/painel.html#access_token=SEGREDO.JWT&refresh_token=segredorefresh&type=invite');
    await page.waitForURL((u) => u.pathname === '/professores/entrar.html');
    expect(new URL(page.url()).searchParams.get('next')).toBe('/professores/painel.html');
    expect(page.url()).not.toContain('SEGREDO');
    expect(reqs.filter((u) => u.includes('SEGREDO') || u.includes('segredorefresh'))).toEqual([]);
  });

  test('professor: abas, checklist e salvar anúncio só com colunas liberadas', async ({ page }) => {
    const errors = trackErrors(page);
    const { calls } = await tutorPainel(page);
    await page.goto('/professores/painel.html');

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveText(['Meu anúncio', 'Matérias', 'Foto', 'Avaliações', 'Tira-dúvidas', 'Plano', 'Conta']);
    await expect(page.getByRole('tab', { name: 'Meu anúncio' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.pf-dash-name')).toHaveText('Ana Silva');
    await expect(page.getByRole('link', { name: 'Pré-visualizar perfil' }).first()).toHaveAttribute('href', '/professores/p/ana-silva');

    // Checklist: título e preço faltando; matéria ok (1)
    const checklist = page.getByRole('complementary', { name: 'O que falta para publicar' });
    await expect(checklist).toContainText('Faltam 2 itens para publicar.');
    await expect(checklist).toContainText('Pelo menos 1 matéria (1)');

    await page.getByLabel('Título do anúncio').fill('Professora de Matemática para ENEM');
    await page.getByLabel('Sobre você e suas aulas').fill('Sou formada em Matemática e dou aulas há 10 anos.');
    await page.getByLabel('Valor da hora-aula').fill('80,50');
    await expect(page.getByText('No anúncio: R$ 80,50 por hora')).toBeVisible();
    await page.getByLabel('Aulas presenciais').check();
    await expect(checklist).toContainText('Falta 1 item para publicar.');
    await page.getByLabel('Estado').selectOption('SC');
    await page.getByLabel('Cidade').selectOption({ label: 'Joinville' });
    await expect(checklist).toContainText('Tudo pronto para publicar.');
    await page.getByLabel('Endereço do seu perfil').fill('Ana Silva Matemática');
    await page.getByLabel('Endereço do seu perfil').blur();
    await expect(page.getByLabel('Endereço do seu perfil')).toHaveValue('ana-silva-matematica');
    await page.getByLabel('Publicar meu anúncio').check();
    await page.getByRole('button', { name: 'Salvar anúncio' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Anúncio publicado!' }).first()).toBeVisible();
    const patches = calls.filter((c) => c.method === 'PATCH' && c.path === '/rest/v1/tutor_profiles');
    expect(patches).toHaveLength(1);
    const { body, url } = patches[0];
    expect(Object.keys(body).sort()).toEqual([...TUTOR_UPDATE_COLS].sort());
    expect(body).toEqual({
      slug: 'ana-silva-matematica',
      headline: 'Professora de Matemática para ENEM',
      bio: 'Sou formada em Matemática e dou aulas há 10 anos.',
      hourly_rate_cents: 8050,
      mode_online: true,
      mode_presencial: true,
      uf: 'SC',
      city_ibge: 4209102,
      city_name: 'Joinville',
      published: true,
    });
    expect(url.searchParams.get('user_id')).toBe(`eq.${UID}`);
    // Nome não mudou: nada de PATCH em profiles
    expect(calls.some((c) => c.method === 'PATCH' && c.path === '/rest/v1/profiles')).toBe(false);
    await expect(page.locator('.pf-dash-badges')).toContainText('Anúncio publicado');
    await expect(page.getByRole('link', { name: 'Ver meu perfil público' }).first()).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('professor: erro P0001 do banco aparece claro; slug duplicado marca o campo', async ({ page }) => {
    let n = 0;
    const { calls } = await tutorPainel(page, {
      profile: profileRow({ tutor: { headline: 'Aulas de Física', hourly_rate_cents: 9000, published: true } }),
      extra: [{
        method: 'PATCH', path: /^\/rest\/v1\/tutor_profiles$/,
        reply: () => (++n === 1
          ? { status: 400, body: { code: 'P0001', message: 'Adicione ao menos uma matéria (ou despublique o anúncio).', details: null, hint: null } }
          : { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "tutor_profiles_slug_key"', details: 'Key (slug)=(ana-silva) already exists.', hint: null } }),
      }],
    });
    await page.goto('/professores/painel.html#anuncio');
    await expect(page.getByLabel('Título do anúncio')).toHaveValue('Aulas de Física');
    await expect(page.getByLabel('Valor da hora-aula')).toHaveValue('90,00');
    await page.getByRole('button', { name: 'Salvar anúncio' }).click();
    await expect(page.locator('.pf-anuncio [role=alert]')).toHaveText('Adicione ao menos uma matéria (ou despublique o anúncio).');
    await page.getByRole('button', { name: 'Salvar anúncio' }).click();
    await expect(page.getByText('Este endereço já está em uso por outro professor. Escolha outro.')).toBeVisible();
    await expect(page.getByLabel('Endereço do seu perfil')).toBeFocused();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
  });

  test('professor: publicar com itens faltando mostra o que falta sem chamar o banco', async ({ page }) => {
    const { calls } = await tutorPainel(page, { tutorSubjects: [] });
    await page.goto('/professores/painel.html');
    await expect(page.getByRole('complementary', { name: 'O que falta para publicar' })).toContainText('Pelo menos 1 matéria');
    await page.getByLabel('Publicar meu anúncio').check();
    await page.getByRole('button', { name: 'Salvar anúncio' }).click();
    await expect(page.locator('.pf-anuncio [role=alert]')).toContainText('Para publicar, complete: título do anúncio; valor da hora-aula; pelo menos 1 matéria');
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    // Salvar como rascunho funciona
    await page.getByLabel('Publicar meu anúncio').uncheck();
    await page.getByLabel('Título do anúncio').fill('Aulas de Química');
    await page.getByRole('button', { name: 'Salvar anúncio' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Anúncio salvo.' }).first()).toBeVisible();
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/rest/v1/tutor_profiles');
    expect(patch.body.published).toBe(false);
    expect(patch.body.hourly_rate_cents).toBeNull();
  });

  test('professor: abas por hash e teclado', async ({ page }) => {
    await tutorPainel(page);
    await page.goto('/professores/painel.html#plano');
    await expect(page.getByRole('tab', { name: 'Plano' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-plano')).toBeVisible();
    await expect(page.locator('#panel-anuncio')).toBeHidden();
    await page.getByRole('tab', { name: 'Plano' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Conta' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Conta' })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/#conta$/);
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Meu anúncio' })).toHaveAttribute('aria-selected', 'true');
    // Link interno do checklist (#materias) troca de aba
    await page.evaluate(() => { location.hash = '#materias'; });
    await expect(page.getByRole('tab', { name: 'Matérias' })).toHaveAttribute('aria-selected', 'true');
  });

  test('professor: matérias respeitam o limite do plano e usam insert/delete/update(levels)', async ({ page }) => {
    const { calls, st } = await tutorPainel(page, {
      tutorSubjects: [{ subject_id: 1, levels: ['medio'] }, { subject_id: 2, levels: [] }],
    });
    await page.goto('/professores/painel.html#materias');
    await expect(page.getByText('2 de 3 matérias')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Matemática' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Química' }).check();
    await expect(page.getByText('3 de 3 matérias')).toBeVisible();
    await expect(page.getByText('Você chegou ao limite do plano Básico.')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Biologia' })).toBeDisabled();
    // Níveis
    await page.getByRole('group', { name: 'Níveis de Matemática (opcional)' }).getByRole('button', { name: 'Ensino superior' }).click();
    await expect(page.getByRole('group', { name: 'Níveis de Matemática (opcional)' }).getByRole('button', { name: 'Ensino médio' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('checkbox', { name: 'Física' }).uncheck();
    await expect(page.getByRole('checkbox', { name: 'Biologia' })).toBeEnabled();

    st.tutorSubjects = [{ subject_id: 1, levels: ['medio', 'superior'] }, { subject_id: 3, levels: [] }];
    await page.getByRole('button', { name: 'Salvar matérias' }).click();
    await expect(page.getByText('Matérias salvas.')).toBeVisible();

    const ins = calls.find((c) => c.method === 'POST' && c.path === '/rest/v1/tutor_subjects');
    expect(ins.body).toEqual([{ tutor_id: UID, subject_id: 3, levels: [] }]);
    expect(ins.headers.prefer || '').not.toContain('merge-duplicates');
    const del = calls.find((c) => c.method === 'DELETE' && c.path === '/rest/v1/tutor_subjects');
    expect(del.url.searchParams.get('tutor_id')).toBe(`eq.${UID}`);
    expect(del.url.searchParams.get('subject_id')).toBe('in.(2)');
    const upd = calls.find((c) => c.method === 'PATCH' && c.path === '/rest/v1/tutor_subjects');
    expect(Object.keys(upd.body)).toEqual(['levels']);
    expect(upd.body.levels.sort()).toEqual(['medio', 'superior']);
    expect(upd.url.searchParams.get('subject_id')).toBe('eq.1');
    await expect(page.getByText('2 de 3 matérias')).toBeVisible();
  });

  test('professor: foto é reduzida, enviada para avatars/<uid>/avatar-<ts>.webp e a antiga é apagada', async ({ page }) => {
    const oldPath = `${UID}/avatar-1000.webp`;
    const { calls } = await tutorPainel(page, {
      profile: profileRow({ avatar_path: oldPath }),
      extra: [
        { method: 'GET', path: /^\/storage\/v1\/object\/public\/avatars\//, reply: () => ({ status: 404, body: {} }) },
        { method: 'POST', path: /^\/storage\/v1\/object\/avatars\//, reply: (c) => ({ body: { Key: c.path.replace('/storage/v1/object/', ''), Id: 'x' } }) },
        { method: 'DELETE', path: /^\/storage\/v1\/object\/avatars$/, reply: () => ({ body: [] }) },
      ],
    });
    await page.goto('/professores/painel.html#foto');
    await page.getByLabel('Escolher nova foto').setInputFiles({ name: 'eu.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('img', { name: 'Prévia da nova foto' })).toBeVisible();
    const size = await page.locator('.pf-photo-frame canvas').evaluate((c) => [c.width, c.height]);
    expect(size).toEqual([2, 2]); // recorte quadrado (4x2 -> 2x2), sem ampliar
    await page.getByRole('button', { name: 'Salvar foto' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Foto atualizada.' }).first()).toBeVisible();

    const up = calls.find((c) => c.method === 'POST' && c.path.startsWith('/storage/v1/object/avatars/'));
    const path = decodeURIComponent(up.path.replace('/storage/v1/object/avatars/', ''));
    expect(path).toMatch(new RegExp(`^${UID}/avatar-\\d+\\.webp$`));
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/rest/v1/profiles');
    expect(patch.body).toEqual({ avatar_path: path });
    const del = calls.find((c) => c.method === 'DELETE' && c.path === '/storage/v1/object/avatars');
    expect(del.body).toEqual({ prefixes: [oldPath] });
  });

  test('aluno: abas próprias e "Quero dar aulas" chama become_tutor', async ({ page }) => {
    await seedSession(page);
    let role = 'student';
    const calls = await mockSupabase(page, [
      { method: 'GET', path: /^\/rest\/v1\/profiles$/, reply: () => ({ body: [profileRow({ role })] }) },
      {
        method: 'POST', path: /^\/rest\/v1\/rpc\/become_tutor$/,
        reply: () => { role = 'tutor'; return { body: 'ana-silva' }; },
      },
      { method: 'PATCH', path: /^\/rest\/v1\/profiles$/, reply: (c) => ({ body: [{ ...c.body }] }) },
    ]);
    await page.goto('/professores/painel.html');
    await expect(page.getByRole('tab')).toHaveText(['Meu perfil', 'Minhas dúvidas', 'Avaliações', 'Conta']);

    // Nome
    await page.getByLabel('Nome completo').fill('Ana Maria Silva');
    await page.getByRole('button', { name: 'Salvar nome' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Nome salvo.' }).first()).toBeVisible();
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/rest/v1/profiles');
    expect(patch.body).toEqual({ full_name: 'Ana Maria Silva' });

    await page.getByRole('button', { name: 'Quero dar aulas' }).click();
    const dlg = page.getByRole('dialog', { name: 'Criar meu anúncio de professor' });
    await dlg.getByRole('button', { name: 'Quero dar aulas' }).click();
    await page.waitForURL(/painel\.html#anuncio$/);
    await expect(page.getByRole('tab', { name: 'Meu anúncio' })).toHaveAttribute('aria-selected', 'true');
    expect(calls.filter((c) => c.path === '/rest/v1/rpc/become_tutor')).toHaveLength(1);
  });

  test('conta suspensa: aviso e formulário travado', async ({ page }) => {
    await tutorPainel(page, { profile: profileRow({ banned_at: '2026-09-20T00:00:00Z' }) });
    await page.goto('/professores/painel.html');
    await expect(page.getByRole('heading', { name: 'Sua conta está suspensa' })).toBeVisible();
    await expect(page.getByLabel('Título do anúncio')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Salvar anúncio' })).toBeDisabled();
  });
});

// ======================================================================
// Páginas legais e celular
// ======================================================================

test.describe('termos e privacidade', () => {
  for (const [path, must] of [
    ['/professores/privacidade.html', ['Lei 13.709/2018', 'art. 33', 'Mercado Pago', '6 (seis) meses', '5 (cinco) anos', 'art. 18', 'art. 14', 'Samuel Isidoro dos Santos Júnior', '080.930.309-48', 'aulas@isidoropreparatorio.com.br', 'Joinville/SC']],
    ['/professores/termos.html', ['não intermediamos o pagamento das aulas', 'art. 49', '7 (sete) dias', 'não garantem número de alunos', 'contatos externos', 'foro', 'Samuel Isidoro dos Santos Júnior', '080.930.309-48', 'aulas@isidoropreparatorio.com.br', 'Joinville/SC']],
  ]) {
    test(`conteúdo completo: ${path}`, async ({ page }) => {
      const errors = trackErrors(page);
      await mockSupabase(page);
      await page.goto(path);
      const text = await page.locator('main').innerText();
      for (const s of must) expect(text).toContain(s);
      // Nenhum marcador [ ... ] pendente
      await expect(page.locator('mark.pf-placeholder')).toHaveCount(0);
      // Minuta só como comentário HTML (não aparece na tela)
      expect(await page.content()).toContain('MINUTA');
      await expect(page.getByText('MINUTA', { exact: false })).toHaveCount(0);
      // Âncoras do sumário existem
      const hrefs = await page.locator('.pf-legal-toc a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      for (const href of hrefs) await expect(page.locator(href)).toHaveCount(1);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});

test.describe('celular (360px)', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  async function noOverflow(page) {
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const wide = await page.evaluate(() => [...document.querySelectorAll('header *, main *, footer *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`));
    expect(wide, wide.join('\n')).toEqual([]);
  }

  for (const path of ['/professores/entrar.html?modo=cadastro&tipo=professor', '/professores/entrar.html?modo=esqueci', '/professores/termos.html', '/professores/privacidade.html']) {
    test(`sem rolagem horizontal: ${path}`, async ({ page }) => {
      await mockSupabase(page);
      await page.goto(path);
      await noOverflow(page);
    });
  }

  for (const hash of ['#anuncio', '#materias', '#foto']) {
    test(`painel do professor sem rolagem horizontal: ${hash}`, async ({ page }) => {
      await tutorPainel(page);
      await page.goto(`/professores/painel.html${hash}`);
      await expect(page.getByRole('tab').first()).toBeVisible();
      await noOverflow(page);
    });
  }
});
