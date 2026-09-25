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

test.describe('celular (360px)', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  for (const path of ['/professores/', '/professores/entrar.html', '/professores/p/demo']) {
    test(`sem rolagem horizontal: ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      // styles.css tem body { overflow-x: hidden }, que esconde o problema: confere elemento a elemento
      const wide = await page.evaluate(() => [...document.querySelectorAll('header *, main *, footer *')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`));
      expect(wide, wide.join('\n')).toEqual([]);
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
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
