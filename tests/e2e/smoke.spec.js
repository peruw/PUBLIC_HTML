// Smoke do portal /professores/: todas as páginas carregam sem erro de console,
// têm <h1>, nav/rodapé inseridos pelo plugin de partials, e o site antigo aponta para o portal.
import { test, expect } from '@playwright/test';
import { readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Todas as páginas de professores/*.html (novas páginas entram sozinhas no smoke)
const PAGES = readdirSync(resolve(ROOT, 'professores'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => (f === 'index.html' ? '/professores/' : `/professores/${f}`));
PAGES.push('/professores/p/demo');

// Supabase falso: tudo responde vazio (sem sessão, listas vazias)
function supabaseMock(request) {
  const url = new URL(request.url());
  const json = (body, status = 200, headers = {}) => ({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', ...headers },
    body: JSON.stringify(body),
  });
  if (request.method() === 'OPTIONS') {
    return { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } };
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) return json(null);
  if (url.pathname.startsWith('/rest/v1/')) return json([], 200, { 'content-range': '*/0' });
  if (url.pathname.startsWith('/auth/v1/')) return json({});
  return json({});
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const req = route.request();
    const { hostname, pathname } = new URL(req.url());
    if (hostname === 'localhost' || hostname === '127.0.0.1') return route.continue();
    if (hostname === 'supabase.test') return route.fulfill(supabaseMock(req));
    // Externos (Google Fonts etc.): resposta vazia, sem depender da rede
    const contentType = pathname.endsWith('.js') ? 'text/javascript' : 'text/css';
    return route.fulfill({ status: 200, contentType, body: '' });
  });
});

// Coleta erros de console e exceções não tratadas
function trackErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

test('home e agenda têm link para /professores/', async ({ page }) => {
  for (const path of ['/', '/agenda.html']) {
    await page.goto(path);
    await expect(page.locator('.nav-links a[href="/professores/"]')).toHaveCount(1);
    await expect(page.locator('#mobileMenu a[href="/professores/"]')).toHaveCount(1);
  }
  await page.goto('/');
  await expect(page.locator('footer a[href="/professores/"]')).toHaveCount(1);
  await expect(page.locator('footer a[href="/professores/entrar.html?modo=cadastro&tipo=professor"]')).toHaveCount(1);
});

for (const path of PAGES) {
  test(`carrega sem erros: ${path}`, async ({ page }) => {
    const errors = trackErrors(page);
    const res = await page.goto(path);
    expect(res.status()).toBe(200);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1').first()).toBeVisible();
    // Partials inseridos no build
    await expect(page.locator('header.nav #authSlot')).toHaveCount(1);
    await expect(page.locator('footer.pf-footer')).toHaveCount(1);
    expect(await page.content()).not.toContain('@include');
    await expect(page).toHaveTitle(/Professores \| Quanta Aulas/);

    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('URL amigável /professores/p/<slug> serve perfil.html (com e sem query)', async ({ request }) => {
  for (const path of ['/professores/p/ana-silva', '/professores/p/ana-silva/', '/professores/p/ana-silva?x=1']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(await res.text(), path).toContain('data-page="perfil"');
  }
});

test('slot de login sem sessão mostra Entrar e Sou professor', async ({ page }) => {
  await page.goto('/professores/');
  const slot = page.locator('#authSlot');
  await expect(slot.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/professores/entrar.html?next=%2Fprofessores%2F');
  await expect(slot.getByRole('link', { name: 'Sou professor' })).toHaveAttribute('href', '/professores/entrar.html?modo=cadastro&tipo=professor');
  // Link ativo no nav
  await expect(page.locator('.nav-links a.nav-link[href="/professores/"]')).toHaveAttribute('aria-current', 'page');
});

test('municípios: JSON estático e seletor de cidade', async ({ page, request }) => {
  const res = await request.get('/professores/data/municipios/SC.json');
  expect(res.ok()).toBeTruthy();
  const sc = await res.json();
  expect(sc).toContainEqual({ id: 4209102, nome: 'Joinville' });

  await page.goto('/professores/');
  const uf = page.getByLabel('Estado');
  const city = page.getByLabel('Cidade');
  await expect(city).toBeDisabled();
  await uf.selectOption('SC');
  await expect(city).toBeEnabled();
  await city.selectOption({ label: 'Joinville' });
  await expect(city).toHaveValue('4209102');

  // Pré-seleção vinda da URL
  await page.goto('/professores/?uf=SP&cidade=3550308');
  await expect(page.getByLabel('Cidade')).toHaveValue('3550308');
});

// Sem rolagem horizontal. styles.css tem body { overflow-x: hidden }, que esconde o problema:
// além do scrollWidth, confere elemento a elemento (inclui barras fixas e modais abertos).
async function expectNoOverflow(page, label = '') {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
  const wide = await page.evaluate(() => [...document.querySelectorAll('header *, main *, footer *, body > .pf-cta-bar *, dialog[open] *')]
    .filter((el) => {
      if (el.closest('.pf-sr-only')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1;
    })
    .map((el) => `${el.tagName.toLowerCase()}.${el.className}`));
  expect(wide, `${label}\n${wide.join('\n')}`).toEqual([]);
}

// Painel do menu mobile aberto: começa logo abaixo do nav, vai até o fim da tela, tem fundo opaco
// e a caixa contém todos os itens (ou rola por dentro).
async function expectMenuCoversItems(page) {
  const m = await page.locator('#mobileMenu').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const bg = getComputedStyle(el).backgroundColor;
    const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(bg);
    const items = [...el.querySelectorAll('a, button')].map((i) => i.getBoundingClientRect());
    return {
      top: r.top, bottom: r.bottom, height: r.height, client: el.clientHeight, scroll: el.scrollHeight,
      alpha: alpha ? Number(alpha[1]) : 1,
      firstItemTop: items.length ? items[0].top : 0,
      overflowY: getComputedStyle(el).overflowY,
      vh: window.innerHeight,
    };
  });
  expect(m.top).toBeGreaterThanOrEqual(70);
  expect(m.top).toBeLessThanOrEqual(74);
  expect(Math.abs(m.bottom - m.vh)).toBeLessThanOrEqual(1);
  expect(m.alpha).toBe(1);
  expect(m.firstItemTop).toBeGreaterThanOrEqual(m.top);
  // Cabe inteiro ou rola dentro do próprio painel
  if (m.scroll > m.client + 1) expect(m.overflowY).toBe('auto');
  else expect(m.height).toBeGreaterThanOrEqual(m.scroll);
}

test.describe('celular (360px)', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  // Todas as páginas, sem sessão (as privadas terminam no entrar.html)
  for (const path of PAGES) {
    test(`sem rolagem horizontal: ${path}`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoOverflow(page, path);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  test('menu mobile abre e tem os links do portal', async ({ page }) => {
    await page.goto('/professores/');
    const toggle = page.locator('#menuToggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator('#mobileMenu');
    await expect(panel.getByRole('link', { name: 'Buscar professores' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Entrar' })).toBeVisible();
    await expectMenuCoversItems(page);
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  // O backdrop-filter do .nav fazia do nav o bloco de contenção do painel fixo:
  // o painel tinha ~64px de altura e os links ficavam sem fundo por cima da página.
  test('menu mobile cobre todos os itens com fundo opaco (logado, página rolada)', async ({ page }) => {
    await seedTutorAdmin(page);
    await page.goto('/professores/painel.html');
    await expect(page.locator('#authSlotMobile').getByRole('button', { name: 'Sair', includeHidden: true })).toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.locator('#menuToggle').click();
    await expect(page.locator('#mobileMenu').getByRole('link', { name: 'Meu painel' })).toBeVisible();
    await expectMenuCoversItems(page);
    // O último item ("Voltar ao Quanta Aulas") recebe o toque (não o conteúdo da página por baixo)
    const last = page.locator('#mobileMenu > a').last();
    await last.scrollIntoViewIfNeeded();
    const hit = await last.evaluate((a) => {
      const r = a.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el === a || a.contains(el);
    });
    expect(hit).toBe(true);
  });
});

// ---------- Segurança: sessão e avatar (build de produção) ----------

// Chave do localStorage do supabase-js para http://supabase.test
const AUTH_KEY = 'sb-supabase-auth-token';
const VICTIM_ID = '0a1b2c3d-1111-4222-8333-444455556666';
const ATTACKER_HASH = '#access_token=ATTACKER.JWT.TOKEN&refresh_token=attackerrefresh'
  + '&expires_in=3600&expires_at=4102444800&token_type=bearer&type=magiclink';
// PNG 1x1 transparente (avatar falso)
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

// Sessão salva de uma "vítima" já logada + perfil com o avatar_path informado
async function seedVictim(page, avatarPath = null) {
  await page.addInitScript(([key, id]) => {
    localStorage.setItem(key, JSON.stringify({
      access_token: 'VICTIM.JWT.TOKEN', refresh_token: 'victimrefresh', token_type: 'bearer',
      expires_in: 3600, expires_at: 4102444800,
      user: { id, aud: 'authenticated', role: 'authenticated', email: 'vitima@exemplo.test' },
    }));
  }, [AUTH_KEY, VICTIM_ID]);
  await page.route('http://supabase.test/rest/v1/profiles*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify([{ id: VICTIM_ID, full_name: 'Vitória Teste', role: 'student', is_admin: false, avatar_path: avatarPath, tutor_profiles: null }]),
  }));
}

// /auth/v1/user responderia com a conta do atacante (como o Supabase real faria com tokens válidos dele)
async function mockAttackerUser(page) {
  const calls = [];
  await page.route('http://supabase.test/auth/v1/user', (route) => {
    calls.push(route.request().headers().authorization || '');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ id: '99999999-9999-4999-8999-999999999999', aud: 'authenticated', role: 'authenticated', email: 'atacante@evil.test' }),
    });
  });
  return calls;
}

function storedEmail(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw)?.user?.email ?? null) : null;
  }, AUTH_KEY);
}

test('segurança: #access_token de um link não cria sessão (fluxo PKCE, sem login CSRF)', async ({ page }) => {
  const errors = trackErrors(page);
  const calls = await mockAttackerUser(page);
  await page.goto(`/professores/termos.html${ATTACKER_HASH}`);
  await page.waitForLoadState('networkidle');
  expect(await storedEmail(page)).toBeNull();
  expect(calls).toEqual([]);
  await expect(page.locator('#authSlot').getByRole('link', { name: 'Entrar' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('segurança: #access_token de um link não troca a sessão de quem já está logado', async ({ page }) => {
  await seedVictim(page);
  const calls = await mockAttackerUser(page);
  await page.goto(`/professores/termos.html${ATTACKER_HASH}`);
  await page.waitForLoadState('networkidle');
  expect(await storedEmail(page)).toBe('vitima@exemplo.test');
  expect(calls.some((a) => a.includes('ATTACKER'))).toBe(false);
  await expect(page.locator('#authSlot .pf-nav-user-name')).toHaveText('Vitória');
});

test('segurança: avatar_path com ".." não gera requisição fora do bucket avatars', async ({ page }) => {
  const storageReqs = [];
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.hostname === 'supabase.test' && !u.pathname.startsWith('/rest/') && !u.pathname.startsWith('/auth/')) storageReqs.push(u.pathname);
  });
  await seedVictim(page, `${VICTIM_ID}/../../../../auth/v1/settings`);
  await page.goto('/professores/termos.html');
  await page.waitForLoadState('networkidle');
  const slot = page.locator('#authSlot .pf-nav-user');
  await expect(slot).toBeVisible();
  await expect(slot.locator('img')).toHaveCount(0);
  await expect(slot.locator('.pf-avatar--initials')).toHaveText('VT');
  expect(storageReqs).toEqual([]);
});

test('avatar_path válido vira <img> do bucket avatars', async ({ page }) => {
  const path = `${VICTIM_ID}/avatar-1727000000000.webp`;
  await page.route('http://supabase.test/storage/v1/object/public/avatars/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }));
  await seedVictim(page, path);
  await page.goto('/professores/termos.html');
  await expect(page.locator('#authSlot .pf-nav-user img')).toHaveAttribute('src', `http://supabase.test/storage/v1/object/public/avatars/${path}`);
});

test.describe('card de professor em 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('preço máximo + "Enviar mensagem" quebram linha sem estourar', async ({ page }) => {
    await page.goto('/professores/termos.html');
    const res = await page.evaluate(() => {
      const el = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text) e.textContent = text;
        return e;
      };
      const card = el('article', 'pf-tutor-card');
      const side = el('div', 'pf-tutor-side');
      const price = el('div', 'pf-tutor-price', 'R$ 1.000,00');
      price.append(el('small', '', '/hora'));
      side.append(price, el('a', 'btn btn-primary btn-sm', 'Enviar mensagem'));
      const main = el('div', 'pf-tutor-main');
      main.append(el('h3', 'pf-tutor-name', 'Ana Silva'));
      card.append(el('div', 'pf-tutor-avatar', 'AS'), main, side);
      document.querySelector('main').prepend(card);
      return { btnRight: side.querySelector('.btn').getBoundingClientRect().right, scroll: document.documentElement.scrollWidth };
    });
    expect(res.btnRight).toBeLessThanOrEqual(360);
    expect(res.scroll).toBeLessThanOrEqual(360);
  });
});

// ---------- next do login: âncora simples sim, hash com dados não ----------

test('login pelo nav volta para a mesma âncora; hash com "=" nunca vai para o next', async ({ page }) => {
  await page.goto('/professores/planos.html#faq');
  await expect(page.locator('#authSlot').getByRole('link', { name: 'Entrar' }))
    .toHaveAttribute('href', '/professores/entrar.html?next=%2Fprofessores%2Fplanos.html%23faq');
  await page.goto(`/professores/termos.html${ATTACKER_HASH}`);
  await expect(page.locator('#authSlot').getByRole('link', { name: 'Entrar' }))
    .toHaveAttribute('href', '/professores/entrar.html?next=%2Fprofessores%2Ftermos.html');
});

// ---------- Logado (professor + admin): páginas privadas sem erro e sem rolagem em 360px ----------

const ME_TUTOR = {
  user_id: VICTIM_ID, slug: 'vitoria-teste', headline: 'Matemática para o ENEM', bio: 'Bio', hourly_rate_cents: 8000,
  mode_online: true, mode_presencial: true, uf: 'SP', city_ibge: 3550308, city_name: 'São Paulo',
  published: true, suspended: false, plan: 'premium', plan_expires_at: '2099-01-01T00:00:00Z', rating_avg: 0, rating_count: 0,
  last_active_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
};

async function seedTutorAdmin(page) {
  await seedVictim(page);
  await page.route('http://supabase.test/rest/v1/profiles*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify([{
      id: VICTIM_ID, full_name: 'Vitória Teste', role: 'tutor', is_admin: true, avatar_path: null, banned_at: null,
      created_at: '2026-09-01T00:00:00Z', tutor_profiles: ME_TUTOR,
    }]),
  }));
  await page.route('http://supabase.test/auth/v1/user', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ id: VICTIM_ID, aud: 'authenticated', role: 'authenticated', email: 'vitima@exemplo.test' }),
  }));
}

const PRIVATE_PAGES = [
  '/professores/painel.html',
  '/professores/mensagens.html',
  '/professores/admin.html',
  '/professores/pagamento.html?external_reference=b0000000-0000-4000-8000-000000000001',
  '/professores/planos.html',
  '/professores/duvidas.html#perguntar',
  '/professores/p/vitoria-teste',
];

for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['360px', { width: 360, height: 740 }]]) {
  test.describe(`logado (${label})`, () => {
    test.use({ viewport });

    for (const path of PRIVATE_PAGES) {
      test(`sem erros: ${path}`, async ({ page }) => {
        const errors = trackErrors(page);
        await seedTutorAdmin(page);
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        // Continua na página pedida (não foi mandado para o login)
        expect(new URL(page.url()).pathname).not.toBe('/professores/entrar.html');
        await expect(page.locator('h1').first()).toBeVisible();
        await expect(page.locator('#authSlot .pf-nav-user-name')).toHaveCount(1);
        if (viewport.width === 360) await expectNoOverflow(page, path);
        expect(errors, errors.join('\n')).toEqual([]);
      });
    }

    test('painel: todas as abas do professor', async ({ page }) => {
      const errors = trackErrors(page);
      await seedTutorAdmin(page);
      await page.goto('/professores/painel.html');
      const tabs = page.getByRole('tab');
      await expect(tabs).toHaveCount(7);
      for (let i = 0; i < 7; i += 1) {
        const tab = tabs.nth(i);
        await tab.click();
        const panel = page.locator(`#${await tab.getAttribute('aria-controls')}`);
        await expect(panel).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expect(panel.locator('.pf-notice--erro')).toHaveCount(0);
        if (viewport.width === 360) await expectNoOverflow(page, await tab.textContent());
      }
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}

// ---------- Supabase fora do ar: nenhuma página quebra (sem exceção não tratada) ----------

test.describe('Supabase fora do ar (500 em tudo)', () => {
  for (const loggedIn of [false, true]) {
    for (const path of PAGES) {
      test(`${loggedIn ? 'logado' : 'visitante'}: ${path}`, async ({ page }) => {
        const errors = trackErrors(page);
        if (loggedIn) await seedVictim(page);
        await page.route('http://supabase.test/**', (route) => {
          if (route.request().method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
          }
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({ message: 'boom', code: 'XX000' }),
          });
        });
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('h1').first()).toBeVisible();
        // O navegador registra os 500 ("Failed to load resource"); o resto seria bug da página
        const real = errors.filter((e) => !/Failed to load resource/.test(e));
        expect(real, real.join('\n')).toEqual([]);
      });
    }
  }
});

// ---------- Portal sem configuração (isConfigured = false): aviso em vez de quebrar ----------

test.describe('portal em configuração (servidor de dev com URL placeholder)', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  let server;
  let base;

  test.beforeAll(async () => {
    const saved = { url: process.env.VITE_SUPABASE_URL, key: process.env.VITE_SUPABASE_ANON_KEY };
    process.env.VITE_SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
    process.env.VITE_SUPABASE_ANON_KEY = 'SUA-CHAVE';
    try {
      const { createServer } = await import('vite');
      server = await createServer({
        configFile: resolve(ROOT, 'vite.config.js'),
        root: ROOT,
        cacheDir: resolve(ROOT, `.vite/e2e-dev-cache-nc-${process.env.E2E_PORT || 4173}`),
        logLevel: 'error',
        server: { port: 0, strictPort: false, hmr: false },
      });
      await server.listen();
    } finally {
      // O env só é lido na criação do servidor; restaura para os outros blocos deste worker
      if (saved.url === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = saved.url;
      if (saved.key === undefined) delete process.env.VITE_SUPABASE_ANON_KEY; else process.env.VITE_SUPABASE_ANON_KEY = saved.key;
    }
    base = `http://localhost:${server.httpServer.address().port}`;
  });

  test.afterAll(async () => {
    await server?.close();
  });

  const STATIC_PAGES = ['/professores/privacidade.html', '/professores/termos.html'];

  for (const path of PAGES) {
    test(`sem Supabase: ${path}`, async ({ page }) => {
      const errors = trackErrors(page);
      const supaReqs = [];
      page.on('request', (req) => {
        const host = new URL(req.url()).hostname;
        if (host.endsWith('supabase.co') || host === 'supabase.test') supaReqs.push(req.url());
      });
      await page.goto(`${base}${path}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('h1').first()).toBeVisible();
      if (!STATIC_PAGES.includes(path)) await expect(page.getByText('Portal em configuração')).toBeVisible();
      // Slot de login mostra os links de visitante
      await expect(page.locator('#authSlot').getByRole('link', { name: 'Entrar' })).toBeVisible();
      expect(supaReqs, supaReqs.join('\n')).toEqual([]);
      const real = errors.filter((e) => !/\[vite\]/.test(e));
      expect(real, real.join('\n')).toEqual([]);
    });
  }
});

// ---------- ui.js no servidor de dev (módulos importáveis direto) ----------

test.describe('ui.js (servidor de dev do Vite)', () => {
  test.describe.configure({ mode: 'serial' });
  let server;
  let base;

  test.beforeAll(async () => {
    process.env.VITE_SUPABASE_URL = 'http://supabase.test';
    process.env.VITE_SUPABASE_ANON_KEY = 'test';
    const { createServer } = await import('vite');
    server = await createServer({
      configFile: resolve(ROOT, 'vite.config.js'),
      root: ROOT,
      // cache separado por suíte (várias suítes podem rodar em paralelo)
      cacheDir: resolve(ROOT, `.vite/e2e-dev-cache-${process.env.E2E_PORT || 4173}`),
      logLevel: 'error',
      server: { port: 0, strictPort: false, hmr: false },
    });
    await server.listen();
    base = `http://localhost:${server.httpServer.address().port}`;
  });

  test.afterAll(async () => {
    await server?.close();
  });

  async function openUi(page, viewport = { width: 390, height: 800 }) {
    await page.setViewportSize(viewport);
    await page.goto(`${base}/professores/termos.html`);
    await page.waitForFunction(() => document.getElementById('pfToasts'));
  }

  test('h(): aria-* booleano vira "true"/"false"', async ({ page }) => {
    await openUi(page);
    const html = await page.evaluate(async () => {
      const { h } = await import('/professores/js/ui.js');
      return [
        h('button', { role: 'tab', 'aria-selected': true }).outerHTML,
        h('button', { 'aria-pressed': false, 'aria-expanded': false, hidden: true, disabled: false }).outerHTML,
        h('div', { spellcheck: false }).outerHTML,
      ];
    });
    expect(html).toEqual([
      '<button role="tab" aria-selected="true"></button>',
      '<button aria-pressed="false" aria-expanded="false" hidden=""></button>',
      '<div spellcheck="false"></div>',
    ]);
  });

  test('avatarPublicUrl(): só "<uuid>/<arquivo>" dentro do bucket', async ({ page }) => {
    await openUi(page);
    const urls = await page.evaluate(async (id) => {
      const { avatarPublicUrl } = await import('/professores/js/supabase.js');
      return [
        `${id}/avatar-1.webp`, `${id}/../../../../auth/v1/settings`, `${id}/..`, `${id}/.`,
        `${id}/a/b.webp`, 'uid/avatar.webp', `/${id}/a.webp`, '', null,
      ].map((p) => avatarPublicUrl(p));
    }, VICTIM_ID);
    expect(urls).toEqual([`http://supabase.test/storage/v1/object/public/avatars/${VICTIM_ID}/avatar-1.webp`, null, null, null, null, null, null, null, null]);
  });

  test('toast de erro com modal aberto fica visível, clicável e é anunciado', async ({ page }) => {
    await openUi(page);
    await page.evaluate(async () => {
      const { modal, h } = await import('/professores/js/ui.js');
      modal({
        title: 'Denunciar',
        content: h('input', { 'aria-label': 'Detalhes' }),
        actions: [{ label: 'Enviar', primary: true, onClick: () => { throw { code: 'P0001', message: 'Limite atingido, tente mais tarde' }; } }],
      });
    });
    await page.getByRole('button', { name: 'Enviar' }).click();
    const t = page.locator('dialog.pf-modal .pf-toast', { hasText: 'Limite atingido' });
    await expect(t).toBeVisible();
    const top = await t.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + 12, r.top + r.height / 2));
    });
    expect(top).toBe(true);
    await expect(page.getByRole('alert')).toContainText('Limite atingido');
    await t.getByRole('button', { name: 'Fechar aviso' }).click();
    await expect(t).toHaveCount(0);
  });

  test('toast mostrado antes de fechar o modal continua na página', async ({ page }) => {
    await openUi(page);
    await page.evaluate(async () => {
      const { modal, toast } = await import('/professores/js/ui.js');
      modal({ title: 'Teste', actions: [{ label: 'OK', onClick: () => { toast('Denúncia enviada', 'ok'); } }] });
    });
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('dialog.pf-modal')).toHaveCount(0);
    await expect(page.locator('#pfToasts .pf-toast', { hasText: 'Denúncia enviada' })).toBeVisible();
  });

  test('modal: arrastar seleção até o fundo não fecha; clique no fundo fecha', async ({ page }) => {
    await openUi(page, { width: 1280, height: 800 });
    await page.evaluate(async () => {
      const { modal, h } = await import('/professores/js/ui.js');
      modal({
        title: 'Avaliar',
        content: [h('label', { for: 'mTxt' }, 'Comentário'), h('input', { id: 'mTxt' })],
        actions: [{ label: 'Salvar', onClick: () => false }],
      });
    });
    await page.fill('#mTxt', 'texto importante');
    for (const sel of ['#mTxt', 'label[for="mTxt"]']) {
      const box = await page.locator(sel).boundingBox();
      await page.mouse.move(box.x + 4, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x - 300, box.y + box.height / 2, { steps: 4 });
      await page.mouse.up();
      await expect(page.locator('dialog.pf-modal[open]')).toHaveCount(1);
    }
    await expect(page.locator('#mTxt')).toHaveValue('texto importante');
    await page.mouse.click(20, 20);
    await expect(page.locator('dialog.pf-modal')).toHaveCount(0);
  });

  test('.reveal inserido depois do initChrome aparece', async ({ page }) => {
    await openUi(page);
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'reveal';
      el.id = 'tardio';
      el.textContent = 'conteúdo tardio';
      document.querySelector('main').prepend(el);
    });
    await expect(page.locator('#tardio')).toHaveClass(/\bin\b/);
  });
});
