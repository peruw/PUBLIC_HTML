// Segurança do portal (regressões da revisão): páginas privadas depois de sair/trocar de conta
// em outra aba, anti-clickjacking (iframe de outro site) e cabeçalhos do .htaccess.
// Supabase falso em http://supabase.test.
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.E2E_PORT || 4173);

const AUTH_KEY = 'sb-supabase-auth-token'; // 'sb-' + 'supabase'(.test) + '-auth-token'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': '*',
};

const USERS = {
  'TOKEN.MARIA': { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'maria@exemplo.test', full_name: 'Maria Souza' },
  'TOKEN.JOAO': { id: 'bbbbbbbb-2222-4222-8222-222222222222', email: 'joao@exemplo.test', full_name: 'João Pereira' },
};

const authUser = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: { provider: 'email' }, user_metadata: {} });
const sessionFor = (token) => ({
  access_token: token, refresh_token: `${token}.refresh`, token_type: 'bearer',
  expires_in: 3600, expires_at: 4102444800, user: authUser(USERS[token]),
});

/** Supabase falso no contexto (vale para todas as abas). Perfil = dono do token do Authorization. */
async function mockSupabase(context) {
  const calls = [];
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'supabase.test') {
      return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css', body: '' });
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const token = (req.headers().authorization || '').replace(/^Bearer\s+/i, '');
    const u = USERS[token];
    calls.push(`${req.method()} ${url.pathname}`);
    const json = (body, status = 200, headers = {}) => route.fulfill({
      status, contentType: 'application/json', headers: { ...CORS, ...headers }, body: JSON.stringify(body),
    });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (url.pathname === '/auth/v1/user') return u ? json(authUser(u)) : json({ message: 'invalid JWT' }, 401);
    if (url.pathname === '/rest/v1/profiles') {
      return json(u ? [{
        id: u.id, role: 'student', full_name: u.full_name, avatar_path: null, is_admin: false, banned_at: null,
        terms_accepted_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', tutor_profiles: null,
      }] : []);
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) return json(url.pathname.endsWith('unread_count') ? 0 : null);
    if (url.pathname.startsWith('/rest/v1/')) return json([], 200, { 'content-range': '*/0' });
    return json({});
  });
  return calls;
}

// Sessão da Maria gravada UMA vez no contexto (não volta depois do "Sair")
async function seedOnce(context, token = 'TOKEN.MARIA') {
  await context.addInitScript(([key, session]) => {
    try {
      if (!localStorage.getItem('__seeded')) {
        localStorage.setItem('__seeded', '1');
        localStorage.setItem(key, JSON.stringify(session));
      }
    } catch { /* about:blank */ }
  }, [AUTH_KEY, sessionFor(token)]);
}

function trackErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

test.describe('páginas privadas e a sessão de outras abas', () => {
  test('"Sair" em outra aba: a página privada esconde os dados e vai para o login', async ({ context }) => {
    await mockSupabase(context);
    await seedOnce(context);
    const a = await context.newPage();
    const errors = trackErrors(a);
    await a.goto('/professores/painel.html#conta');
    await expect(a.locator('#authSlot .pf-nav-user-name')).toHaveText('Maria');
    await expect(a.locator('#pageBody')).toContainText('maria@exemplo.test');

    const b = await context.newPage();
    await b.goto('/professores/termos.html');
    await b.locator('#authSlot').getByRole('button', { name: 'Sair' }).click();
    // A aba que clicou "Sair" segue o próprio fluxo (vai para a busca, não para o login)
    await b.waitForURL((u) => u.pathname === '/professores/');

    // A outra aba não mantém o e-mail/abas da Maria na tela
    await a.waitForURL((u) => u.pathname === '/professores/entrar.html');
    expect(new URL(a.url()).searchParams.get('next')).toBe('/professores/painel.html#conta');
    await expect(a.getByRole('heading', { level: 1 })).toHaveText('Entrar');
    await expect(a.locator('body')).not.toContainText('maria@exemplo.test');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('outra conta entra em outra aba: a página privada recarrega com a conta nova', async ({ context }) => {
    await mockSupabase(context);
    await seedOnce(context);
    const a = await context.newPage();
    await a.goto('/professores/painel.html#conta');
    await expect(a.locator('#pageBody')).toContainText('maria@exemplo.test');

    // O que o supabase-js da outra aba faz num login: grava a sessão e avisa pelo BroadcastChannel
    const b = await context.newPage();
    await b.goto('/professores/termos.html');
    await b.evaluate(([key, session]) => {
      localStorage.setItem(key, JSON.stringify(session));
      const ch = new BroadcastChannel(key);
      ch.postMessage({ event: 'SIGNED_IN', session });
      ch.close();
    }, [AUTH_KEY, sessionFor('TOKEN.JOAO')]);

    await expect(a.locator('#authSlot .pf-nav-user-name')).toHaveText('João');
    await expect(a.locator('#pageBody')).toContainText('joao@exemplo.test');
    await expect(a.locator('body')).not.toContainText('maria@exemplo.test');
  });

  test('"Sair" na própria página privada vai para a busca (sem desvio para o login)', async ({ context }) => {
    await mockSupabase(context);
    await seedOnce(context);
    const page = await context.newPage();
    await page.goto('/professores/painel.html');
    await expect(page.locator('#authSlot .pf-nav-user-name')).toHaveText('Maria');
    await page.locator('#authSlot').getByRole('button', { name: 'Sair' }).click();
    await page.waitForURL((u) => u.pathname === '/professores/');
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).pathname).toBe('/professores/');
    await expect(page.locator('#authSlot').getByRole('link', { name: 'Entrar' })).toBeVisible();
  });
});

test.describe('anti-clickjacking', () => {
  // "Atacante" em http://127.0.0.1:<porta>: outra origem e outro site que localhost. O documento do topo
  // vem do servidor local de verdade (robots.txt); uma resposta falsa (route.fulfill) conta como rede
  // pública e o Private Network Access do Chrome barraria o iframe antes de carregar.
  test('dentro de iframe de outro site a página fica oculta', async ({ page, baseURL }) => {
    const evil = `http://127.0.0.1:${new URL(baseURL).port}/robots.txt`;
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
      if (url.hostname === 'supabase.test') {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{}' });
      }
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });
    await page.goto(evil);
    // Iframe invisível por cima de um "botão" do atacante (sandbox sem allow-top-navigation)
    await page.evaluate((src) => {
      const f = document.createElement('iframe');
      f.id = 'alvo';
      f.src = src;
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
      f.style.cssText = 'width:800px;height:600px;opacity:0.01';
      document.body.appendChild(f);
    }, `${baseURL}/professores/termos.html`);
    const frame = page.frameLocator('#alvo');
    await expect(frame.locator('h1')).toHaveCount(1); // a página carregou no iframe...
    const framed = page.frames().find((f) => f.url().includes('/professores/termos.html'));
    // ...mas o módulo do portal a esconde, e o topo continua sendo o "atacante"
    await expect.poll(() => framed.evaluate(() => getComputedStyle(document.documentElement).display)).toBe('none');
    expect(page.url()).toBe(evil);
  });

  test('fora de iframe a página aparece normalmente', async ({ page }) => {
    await page.route('http://supabase.test/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{}' }));
    await page.goto('/professores/termos.html');
    await expect(page.locator('h1').first()).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).display)).not.toBe('none');
  });

  test('.htaccess (copiado para o build) envia X-Frame-Options e CSP frame-ancestors', async () => {
    const files = [resolve(ROOT, '.htaccess'), resolve(ROOT, `.vite/e2e-dist-${PORT}/.htaccess`)].filter((f) => existsSync(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const conf = readFileSync(f, 'utf8');
      expect(conf, f).toMatch(/Header always set X-Frame-Options "SAMEORIGIN"/);
      expect(conf, f).toMatch(/Header always set Content-Security-Policy "frame-ancestors 'self'"/);
    }
  });
});
