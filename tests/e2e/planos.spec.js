// Planos (/professores/planos.html), volta do Mercado Pago (/professores/pagamento.html) e aba "Plano" do painel.
// Supabase falso em http://supabase.test (REST, RPC, Auth e Edge Functions) e checkout do MP interceptado.
import { test, expect } from '@playwright/test';

const CORS = {
  'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
  'access-control-allow-methods': '*', 'access-control-expose-headers': '*',
};
const json = (body, status = 200, headers = {}) => ({
  status, contentType: 'application/json', headers: { ...CORS, ...headers }, body: JSON.stringify(body),
});

const AUTH_KEY = 'sb-supabase-auth-token'; // 'sb-' + 'supabase' (1º rótulo de supabase.test) + '-auth-token'
const ME = 'aaaaaaaa-3333-4333-8333-333333333333';
const PAY_ID = 'b0000000-0000-4000-8000-000000000001';
const MP_URL = 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123-abc';
const XSS = '<img src=x onerror=window.__xss=1>';

const PLANS = [
  { code: 'basico', name: 'Básico', price_cents_month: 0, max_subjects: 3, rank_tier: 0, features: ['Perfil público na busca', 'Até 3 matérias', 'Mensagens com alunos'] },
  { code: 'profissional', name: 'Profissional', price_cents_month: 2990, max_subjects: 10, rank_tier: 1, features: ['Até 10 matérias', 'Prioridade na busca', 'Selo Profissional'] },
  { code: 'premium', name: 'Premium', price_cents_month: 5990, max_subjects: 30, rank_tier: 2, features: ['Até 30 matérias', 'Selo Destaque', 'Topo da busca'] },
];
// Mesmo cálculo de plan_price (1x, 3x0,90, 12x0,75)
const PRICES = { profissional: { 1: 2990, 3: 8073, 12: 26910 }, premium: { 1: 5990, 3: 16173, 12: 53910 } };

const USER = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'maria@exemplo.test' };
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

function student() {
  return { id: ME, full_name: 'Maria Souza', role: 'student', is_admin: false, avatar_path: null, banned_at: null, tutor_profiles: null };
}

function tutor({ plan = 'basico', expires = null, suspended = false } = {}) {
  return {
    id: ME, full_name: 'Maria Souza', role: 'tutor', is_admin: false, avatar_path: null, banned_at: null,
    tutor_profiles: {
      user_id: ME, slug: 'maria-souza', headline: 'Matemática para o ENEM', bio: '', hourly_rate_cents: 8000,
      mode_online: true, mode_presencial: false, uf: null, city_ibge: null, city_name: null,
      published: true, suspended, plan, plan_expires_at: expires, rating_avg: 0, rating_count: 0,
    },
  };
}

function payment(over = {}) {
  return {
    id: PAY_ID, status: 'pending', plan: 'premium', months: 12, amount_cents: 53910,
    applied_at: null, created_at: new Date().toISOString(), ...over,
  };
}

async function seedSession(page) {
  await page.addInitScript(([key, u]) => {
    localStorage.setItem(key, JSON.stringify({
      access_token: 'FAKE.JWT.TOKEN', refresh_token: 'fakerefresh', token_type: 'bearer',
      expires_in: 3600, expires_at: 4102444800, user: u,
    }));
  }, [AUTH_KEY, USER]);
}

/**
 * Supabase falso. Retorna { reqs } com as chamadas feitas.
 * profile: linha de profiles (+ tutor_profiles) ou função (nº da chamada) -> linha; null = sem sessão.
 * payments: (nº da chamada, url) -> linhas de payments.
 * checkout: (body) -> resposta de create-checkout.
 */
async function mockSupabase(page, opts = {}) {
  const {
    profile = null,
    prices = PRICES,
    plans = PLANS,
    payments = () => [],
    checkout = () => json({ init_point: MP_URL, payment_id: PAY_ID }),
  } = opts;
  const reqs = { prices: [], checkout: [], payments: [], mp: [], profiles: 0 };

  if (profile) await seedSession(page);

  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname.endsWith('mercadopago.com.br')) {
      reqs.mp.push(url.href);
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Mercado Pago</title><h1>Checkout do Mercado Pago (teste)</h1>' });
    }
    if (url.hostname !== 'supabase.test') {
      return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css', body: '' });
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const p = url.pathname;

    if (p === '/auth/v1/user') return route.fulfill(profile ? json(USER) : json({ message: 'no session' }, 401));
    if (p === '/rest/v1/profiles') {
      reqs.profiles += 1;
      const row = typeof profile === 'function' ? profile(reqs.profiles) : profile;
      return route.fulfill(json(row ? [row] : []));
    }
    if (p === '/rest/v1/plans') return route.fulfill(json(plans));
    if (p === '/rest/v1/rpc/plan_price') {
      const body = JSON.parse(req.postData() || '{}');
      reqs.prices.push(body);
      const cents = prices?.[body.p_plan]?.[body.p_months];
      return route.fulfill(cents == null ? json({ code: 'P0001', message: 'Plano inválido.' }, 400) : json(cents));
    }
    if (p === '/rest/v1/rpc/unread_count') return route.fulfill(json(0));
    if (p === '/rest/v1/payments') {
      reqs.payments.push(url);
      let rows = await payments(reqs.payments.length, url);
      const id = url.searchParams.get('id');
      if (id) rows = rows.filter((r) => `eq.${r.id}` === id);
      return route.fulfill(json(rows));
    }
    if (p === '/functions/v1/create-checkout') {
      const body = JSON.parse(req.postData() || '{}');
      reqs.checkout.push({ body, headers: req.headers() });
      return route.fulfill(await checkout(body));
    }
    if (p.startsWith('/rest/v1/rpc/')) return route.fulfill(json(null));
    if (p.startsWith('/rest/v1/')) return route.fulfill(json([], 200, { 'content-range': '*/0' }));
    return route.fulfill(json({}));
  });
  return { reqs };
}

function trackErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

const card = (page, code) => page.locator(`article.pf-plan-card[data-plan="${code}"]`);

// ---------- planos.html ----------

test.describe('planos', () => {
  test('visitante: preços vêm de plan_price, período muda a URL e botões levam ao cadastro de professor', async ({ page }) => {
    const errors = trackErrors(page);
    // Preço de 12 meses propositalmente fora da fórmula: a página tem de mostrar o que a RPC devolve
    const prices = { profissional: { 1: 2990, 3: 8073, 12: 24000 }, premium: { 1: 5990, 3: 16173, 12: 53910 } };
    const { reqs } = await mockSupabase(page, { prices });
    await page.goto('/professores/planos.html');

    const pro = card(page, 'profissional');
    await expect(pro).toContainText('R$ 29,90');
    await expect(pro).toContainText('Pagamento único de R$ 29,90 por 1 mês.');
    await expect(card(page, 'basico')).toContainText('Grátis');
    await expect(card(page, 'premium')).toContainText('R$ 59,90');
    await expect(card(page, 'premium')).toContainText('Mais visibilidade');
    expect(reqs.prices).toHaveLength(6);
    expect(reqs.prices).toContainEqual({ p_plan: 'premium', p_months: 12 });
    expect(reqs.prices.some((b) => b.p_plan === 'basico')).toBe(false);

    // Desconto do período no seletor (calculado a partir dos preços da RPC)
    await expect(page.getByRole('radio', { name: /^3 meses/ })).toBeVisible();
    await expect(page.locator('label[for="pfPeriodo3"]')).toContainText('−10%');

    await page.getByRole('radio', { name: /^12 meses/ }).check();
    await expect(page).toHaveURL(/[?&]periodo=12\b/);
    await expect(pro).toContainText('R$ 20,00');
    await expect(pro).toContainText('Total de R$ 240,00 por 12 meses.');
    await expect(pro).toContainText('Economia de R$ 118,80 (33%)');
    await expect(card(page, 'premium')).toContainText('R$ 44,93');

    // Teclado: setas trocam o período (rádios nativos)
    await page.getByRole('radio', { name: /^12 meses/ }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('radio', { name: /^3 meses/ })).toBeChecked();
    await expect(page).toHaveURL(/[?&]periodo=3\b/);
    await expect(pro).toContainText('R$ 26,91');

    const cadastro = '/professores/entrar.html?modo=cadastro&tipo=professor&next=%2Fprofessores%2Fplanos.html';
    await expect(pro.getByRole('link', { name: 'Começar como professor' })).toHaveAttribute('href', cadastro);
    await expect(card(page, 'basico').getByRole('link', { name: 'Criar conta grátis' })).toHaveAttribute('href', cadastro);
    await expect(page.getByRole('link', { name: 'Entre na sua conta' })).toHaveAttribute('href', /^\/professores\/entrar\.html\?next=%2Fprofessores%2Fplanos\.html/);

    // Comparação e FAQ
    const table = page.getByRole('table', { name: 'Comparação dos planos para professores' });
    await expect(table).toContainText('Até 30');
    await expect(table).toContainText('Topo da busca');
    await expect(table).toContainText('★ Destaque');
    const faq = page.locator('details.pf-faq-item', { hasText: 'A renovação é automática?' });
    await faq.locator('summary').click();
    await expect(faq).toContainText('Não. Cada plano é pago uma única vez');
    await expect(page.locator('details.pf-faq-item', { hasText: '7 dias' })).toHaveCount(1);

    // ?periodo= na URL é respeitado ao abrir
    await page.goto('/professores/planos.html?periodo=12');
    await expect(page.getByRole('radio', { name: /^12 meses/ })).toBeChecked();
    await expect(card(page, 'profissional')).toContainText('R$ 20,00');

    expect(reqs.checkout).toHaveLength(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('aluno: botões levam ao painel para criar o anúncio de professor', async ({ page }) => {
    const { reqs } = await mockSupabase(page, { profile: student() });
    await page.goto('/professores/planos.html');
    await expect(page.getByText('Você está usando uma conta de aluno')).toBeVisible();
    const link = card(page, 'premium').getByRole('link', { name: 'Crie seu anúncio de professor' });
    await expect(link).toHaveAttribute('href', '/professores/painel.html');
    await expect(card(page, 'profissional').getByRole('link', { name: 'Crie seu anúncio de professor' })).toBeVisible();
    await expect(page.locator('.pf-plan-card button')).toHaveCount(0);
    expect(reqs.checkout).toHaveLength(0);
  });

  test('professor no Básico: comprar chama create-checkout com {plan, months} e vai para o Mercado Pago', async ({ page }) => {
    const errors = trackErrors(page);
    const { reqs } = await mockSupabase(page, { profile: tutor() });
    await page.goto('/professores/planos.html?periodo=12');

    const me = page.locator('.pf-plans-me');
    await expect(me).toContainText('Seu plano atual');
    await expect(me).toContainText('Básico');
    await expect(card(page, 'basico')).toContainText('Seu plano atual');
    await expect(card(page, 'basico')).toHaveClass(/is-current/);

    await card(page, 'premium').getByRole('button', { name: 'Contratar Premium' }).click();
    const dialog = page.getByRole('dialog', { name: 'Contratar plano Premium' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('12 meses');
    await expect(dialog).toContainText('R$ 539,10');
    await expect(dialog).toContainText('R$ 44,93/mês');
    await expect(dialog.getByRole('link', { name: 'Termos de Uso' })).toHaveAttribute('href', '/professores/termos.html#planos');

    await dialog.getByRole('button', { name: 'Ir para o pagamento' }).click();
    await page.waitForURL(MP_URL);
    await expect(page.getByRole('heading', { name: 'Checkout do Mercado Pago (teste)' })).toBeVisible();

    expect(reqs.checkout).toHaveLength(1);
    expect(reqs.checkout[0].body).toEqual({ plan: 'premium', months: 12 });
    expect(reqs.checkout[0].headers.authorization).toBe('Bearer FAKE.JWT.TOKEN');
    expect(reqs.mp).toEqual([MP_URL]);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('professor com Premium ativo: plano inferior desabilitado, mesmo plano = renovar', async ({ page }) => {
    const expires = '2027-03-10T15:00:00.000Z';
    const { reqs } = await mockSupabase(page, { profile: tutor({ plan: 'premium', expires }) });
    await page.goto('/professores/planos.html');

    const me = page.locator('.pf-plans-me');
    await expect(me).toContainText('Premium');
    await expect(me).toContainText('Válido até 10 de março de 2027');
    await expect(me.getByRole('link', { name: 'Histórico de pagamentos' })).toHaveAttribute('href', '/professores/painel.html#plano');

    const down = card(page, 'profissional').getByRole('button', { name: 'Contratar Profissional' });
    await expect(down).toBeDisabled();
    const why = card(page, 'profissional').locator('.pf-plan-why');
    await expect(why).toContainText('Você tem o plano Premium ativo até 10 de março de 2027');
    await expect(why).toContainText('Planos inferiores só podem ser contratados depois do vencimento');
    await expect(down).toHaveAttribute('aria-describedby', await why.getAttribute('id'));
    await expect(card(page, 'basico')).toContainText('volta ao Básico automaticamente');

    const prem = card(page, 'premium');
    await expect(prem).toHaveClass(/is-current/);
    await expect(prem.getByText('Seu plano', { exact: true })).toBeVisible();
    const renew = prem.getByRole('button', { name: 'Renovar / estender' });
    await expect(renew).toBeEnabled();
    await renew.click();
    const dialog = page.getByRole('dialog', { name: 'Renovar plano Premium' });
    await expect(dialog).toContainText('somados à validade atual');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toHaveCount(0);
    expect(reqs.checkout).toHaveLength(0);
  });

  test('professor Profissional: upgrade avisa que o tempo restante não é somado', async ({ page }) => {
    await mockSupabase(page, { profile: tutor({ plan: 'profissional', expires: daysFromNow(20) }) });
    await page.goto('/professores/planos.html');
    const btn = card(page, 'premium').getByRole('button', { name: 'Fazer upgrade para Premium' });
    await expect(btn).toBeEnabled();
    await expect(card(page, 'premium')).toContainText('o tempo restante do Profissional não é somado');
    await expect(card(page, 'profissional').getByRole('button', { name: 'Renovar / estender' })).toBeEnabled();
  });

  test('plano vencido conta como Básico', async ({ page }) => {
    await mockSupabase(page, { profile: tutor({ plan: 'premium', expires: daysFromNow(-3) }) });
    await page.goto('/professores/planos.html');
    const me = page.locator('.pf-plans-me');
    await expect(me).toContainText('Seu plano Premium venceu em');
    await expect(card(page, 'basico')).toHaveClass(/is-current/);
    await expect(card(page, 'profissional').getByRole('button', { name: 'Contratar Profissional' })).toBeEnabled();
  });

  test('erro do checkout aparece no modal como texto e permite tentar de novo', async ({ page }) => {
    let n = 0;
    const { reqs } = await mockSupabase(page, {
      profile: tutor(),
      checkout: () => {
        n += 1;
        if (n === 1) return json({ error: `Mercado Pago indisponível ${XSS}` }, 502);
        return json({ error: 'Faça login para continuar.' }, 401);
      },
    });
    await page.goto('/professores/planos.html');
    await card(page, 'profissional').getByRole('button', { name: 'Contratar Profissional' }).click();
    const dialog = page.getByRole('dialog', { name: 'Contratar plano Profissional' });
    const go = dialog.getByRole('button', { name: 'Ir para o pagamento' });
    await go.click();
    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText(`Mercado Pago indisponível ${XSS}`);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(dialog.locator('img')).toHaveCount(0);
    await expect(go).toBeEnabled();
    expect(reqs.checkout[0].body).toEqual({ plan: 'profissional', months: 1 });

    // 401: mostra link para entrar de novo
    await go.click();
    await expect(alert).toContainText('Faça login para continuar.');
    await expect(alert.getByRole('link', { name: 'Entrar novamente' })).toHaveAttribute('href', /^\/professores\/entrar\.html\?next=/);
    expect(page.url()).toContain('/professores/planos.html');
  });

  test('professor com anúncio suspenso não consegue comprar', async ({ page }) => {
    await mockSupabase(page, { profile: tutor({ suspended: true }) });
    await page.goto('/professores/planos.html');
    await expect(page.locator('#pfPlansBlocked')).toContainText('suspenso pela moderação');
    await expect(card(page, 'premium').getByRole('button', { name: 'Contratar Premium' })).toBeDisabled();
    await expect(card(page, 'profissional').getByRole('button', { name: 'Contratar Profissional' })).toBeDisabled();
  });

  test('preço indisponível desabilita a compra e oferece tentar de novo', async ({ page }) => {
    const prices = { profissional: { 1: 2990, 3: 8073, 12: 26910 }, premium: {} };
    await mockSupabase(page, { profile: tutor(), prices });
    await page.goto('/professores/planos.html');
    await expect(page.getByText('Alguns preços não puderam ser carregados agora.')).toBeVisible();
    await expect(card(page, 'premium')).toContainText('Preço indisponível no momento.');
    await expect(card(page, 'premium').getByRole('button', { name: 'Contratar Premium' })).toBeDisabled();
    await expect(card(page, 'profissional').getByRole('button', { name: 'Contratar Profissional' })).toBeEnabled();
  });
});

// ---------- pagamento.html ----------

test.describe('pagamento', () => {
  const back = (qs) => `/professores/pagamento.html?${qs}`;
  const mpBack = (status) => back(`collection_id=123&collection_status=${status}&payment_id=123&status=${status}&external_reference=${PAY_ID}&payment_type=credit_card&merchant_order_id=9&preference_id=123-abc&site_id=MLB&processing_mode=aggregator`);

  test('aprovado depois de consultar o pagamento algumas vezes', async ({ page }) => {
    const errors = trackErrors(page);
    const expires = '2027-09-25T12:00:00.000Z';
    let approved = false;
    const { reqs } = await mockSupabase(page, {
      profile: () => (approved ? tutor({ plan: 'premium', expires }) : tutor()),
      payments: (n) => {
        if (n < 3) return [payment()];
        approved = true;
        return [payment({ status: 'approved', applied_at: new Date().toISOString() })];
      },
    });
    await page.goto(mpBack('approved'));
    await expect(page.getByRole('heading', { name: 'Confirmando seu pagamento…' })).toBeVisible();
    await expect(page.locator('.pf-pay-sum')).toContainText('R$ 539,10');

    await expect(page.getByRole('heading', { name: 'Pagamento aprovado!' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.pf-pay-live')).toContainText('Seu plano Premium está ativo até 25 de setembro de 2027.');
    await expect(page.getByRole('link', { name: 'Ver meu plano no painel' })).toHaveAttribute('href', '/professores/painel.html#plano');

    expect(reqs.payments.length).toBe(3);
    const q = reqs.payments[0];
    expect(q.searchParams.get('id')).toBe(`eq.${PAY_ID}`);
    for (const col of ['status', 'plan', 'months', 'amount_cents']) expect(q.searchParams.get('select').split(',')).toContain(col);
    // parou de consultar depois do estado final
    await page.waitForTimeout(3500);
    expect(reqs.payments.length).toBe(3);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('recusado: oferece tentar de novo no mesmo período', async ({ page }) => {
    await mockSupabase(page, { profile: tutor(), payments: () => [payment({ status: 'rejected', plan: 'profissional', months: 3, amount_cents: 8073 })] });
    await page.goto(mpBack('rejected'));
    await expect(page.getByRole('heading', { name: 'Pagamento recusado' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tentar novamente' })).toHaveAttribute('href', '/professores/planos.html?periodo=3');
    await expect(page.locator('.pf-pay-sum')).toContainText('Profissional');
  });

  test('Pix pendente: depois de 60 s mostra "Aguardando o pagamento" e permite verificar de novo', async ({ page }) => {
    await page.clock.install();
    let n = 0;
    const { reqs } = await mockSupabase(page, { profile: tutor(), payments: () => { n += 1; return [payment()]; } });
    await page.goto(mpBack('pending'));
    await expect(page.getByRole('heading', { name: 'Confirmando seu pagamento…' })).toBeVisible();
    await expect(page.locator('.pf-pay-live')).toContainText('Se você pagou com Pix');
    await expect.poll(() => reqs.payments.length).toBeGreaterThanOrEqual(1);
    await page.clock.fastForward('01:05');
    await expect(page.getByRole('heading', { name: 'Aguardando o pagamento' })).toBeVisible();
    await expect(page.locator('.pf-pay-live')).toContainText('o plano é ativado automaticamente');
    const before = reqs.payments.length;
    await page.getByRole('button', { name: 'Verificar novamente' }).click();
    await expect.poll(() => reqs.payments.length).toBeGreaterThan(before);
    await expect(page.getByRole('heading', { name: 'Confirmando seu pagamento…' })).toBeVisible();
  });

  test('voltou sem pagar (collection_status=null): pagamento não concluído', async ({ page }) => {
    await mockSupabase(page, { profile: tutor(), payments: () => [payment()] });
    await page.goto(mpBack('null'));
    await expect(page.getByRole('heading', { name: 'Pagamento não concluído' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Tentar novamente' })).toHaveAttribute('href', '/professores/planos.html?periodo=12');
  });

  test('aprovado sem aplicar (havia plano superior): explica e não diz que o plano mudou', async ({ page }) => {
    await mockSupabase(page, { profile: tutor({ plan: 'premium', expires: daysFromNow(200) }), payments: () => [payment({ status: 'approved', plan: 'profissional', applied_at: null })] });
    await page.goto(back(`external_reference=${PAY_ID}`));
    await expect(page.getByRole('heading', { name: 'Pagamento aprovado, mas o plano não mudou' })).toBeVisible();
    await expect(page.locator('.pf-pay-live')).toContainText('devolver o valor');
    await expect(page.locator('.pf-pay-ref')).toHaveText(PAY_ID);
  });

  test('pagamento de outra conta ou inexistente: não encontrado', async ({ page }) => {
    await mockSupabase(page, { profile: tutor(), payments: () => [] });
    await page.goto(back(`external_reference=${PAY_ID}`));
    await expect(page.getByRole('heading', { name: 'Pagamento não encontrado' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver meus pagamentos' })).toHaveAttribute('href', '/professores/painel.html#plano');
  });

  test('referência inválida não consulta o banco', async ({ page }) => {
    const { reqs } = await mockSupabase(page, { profile: tutor() });
    await page.goto(back('external_reference=nao-e-uuid'));
    await expect(page.getByRole('heading', { name: 'Pagamento não encontrado' })).toBeVisible();
    expect(reqs.payments).toHaveLength(0);
  });

  test('sem sessão: vai para o login e volta com a mesma referência', async ({ page }) => {
    await mockSupabase(page, {});
    await page.goto(back(`external_reference=${PAY_ID}&status=approved`));
    await page.waitForURL(/\/professores\/entrar\.html\?next=/);
    const next = new URL(page.url()).searchParams.get('next');
    expect(next).toBe(`/professores/pagamento.html?external_reference=${PAY_ID}&status=approved`);
  });
});

// ---------- painel#plano ----------

test.describe('painel: aba Plano', () => {
  test('mostra plano atual, validade e histórico (só os próprios pagamentos)', async ({ page }) => {
    const errors = trackErrors(page);
    const expires = '2027-03-10T15:00:00.000Z';
    const rows = [
      payment({ id: 'b0000000-0000-4000-8000-000000000003', status: 'pending', created_at: new Date().toISOString() }),
      payment({ id: 'b0000000-0000-4000-8000-000000000002', status: 'approved', plan: 'profissional', months: 1, amount_cents: 2990, applied_at: null, created_at: '2026-09-01T12:00:00Z' }),
      payment({ id: PAY_ID, status: 'approved', applied_at: '2026-03-10T15:00:00Z', created_at: '2026-03-10T14:58:00Z' }),
      payment({ id: 'b0000000-0000-4000-8000-000000000004', status: 'rejected', months: 3, amount_cents: 16173, created_at: '2026-03-10T14:50:00Z' }),
    ];
    const { reqs } = await mockSupabase(page, { profile: tutor({ plan: 'premium', expires }), payments: () => rows });
    await page.goto('/professores/painel.html#plano');
    const panel = page.locator('#panel-plano');
    await expect(panel.getByRole('heading', { name: 'Meu plano' })).toBeVisible();
    await expect(panel.locator('.pf-plan-now')).toContainText('Premium');
    await expect(panel.locator('.pf-plan-now')).toContainText('Válido até 10 de março de 2027');
    await expect(panel.locator('.pf-plan-facts')).toContainText('até 30');
    await expect(panel.getByRole('link', { name: 'Renovar plano' })).toHaveAttribute('href', '/professores/planos.html');

    const table = panel.getByRole('table', { name: 'Histórico de pagamentos' });
    await expect(table.locator('tbody tr')).toHaveCount(4);
    await expect(table.locator('tbody tr').nth(0)).toContainText('Aguardando pagamento');
    await expect(table.locator('tbody tr').nth(0).getByRole('link', { name: 'Ver status' }))
      .toHaveAttribute('href', '/professores/pagamento.html?external_reference=b0000000-0000-4000-8000-000000000003');
    await expect(table.locator('tbody tr').nth(1)).toContainText('Aprovado, não aplicado');
    await expect(table.locator('tbody tr').nth(1)).toContainText('O valor será devolvido');
    await expect(table.locator('tbody tr').nth(2)).toContainText('Aprovado');
    await expect(table.locator('tbody tr').nth(2)).toContainText('R$ 539,10');
    await expect(table.locator('tbody tr').nth(3)).toContainText('Recusado');
    await expect(table.locator('tbody tr').nth(3)).toContainText('3 meses');

    const q = reqs.payments[0];
    expect(q.searchParams.get('user_id')).toBe(`eq.${ME}`);
    expect(q.searchParams.get('order')).toBe('created_at.desc');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('sem pagamentos: estado vazio com link para os planos', async ({ page }) => {
    await mockSupabase(page, { profile: tutor(), payments: () => [] });
    await page.goto('/professores/painel.html#plano');
    const panel = page.locator('#panel-plano');
    await expect(panel.locator('.pf-plan-now')).toContainText('Plano gratuito, sem validade.');
    await expect(panel.getByText('Você ainda não fez nenhum pagamento.')).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Conhecer os planos' })).toHaveAttribute('href', '/professores/planos.html');
  });
});

// ---------- Celular ----------

test.describe('celular (360px)', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  async function noOverflow(page) {
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

  test('planos sem rolagem horizontal', async ({ page }) => {
    await mockSupabase(page, { profile: tutor({ plan: 'premium', expires: '2027-03-10T15:00:00.000Z' }) });
    await page.goto('/professores/planos.html?periodo=12');
    await expect(card(page, 'premium')).toContainText('R$ 44,93');
    await page.locator('details.pf-faq-item').first().locator('summary').click();
    await noOverflow(page);
    await card(page, 'premium').getByRole('button', { name: 'Renovar / estender' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await noOverflow(page);
  });

  test('pagamento e aba Plano sem rolagem horizontal', async ({ page }) => {
    await mockSupabase(page, {
      profile: tutor({ plan: 'premium', expires: '2027-03-10T15:00:00.000Z' }),
      payments: () => [
        payment({ status: 'approved', applied_at: null }),
        payment({ id: 'b0000000-0000-4000-8000-000000000009', status: 'pending' }),
      ],
    });
    await page.goto(`/professores/pagamento.html?external_reference=${PAY_ID}`);
    await expect(page.getByRole('heading', { name: 'Pagamento aprovado, mas o plano não mudou' })).toBeVisible();
    await noOverflow(page);
    await page.goto('/professores/painel.html#plano');
    await expect(page.locator('#panel-plano tbody tr')).toHaveCount(2);
    await noOverflow(page);
  });
});
