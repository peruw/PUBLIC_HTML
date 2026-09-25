// Perfil público do professor (/professores/p/<slug>): dados mockados, XSS, 404, SEO e componentes.
import { test, expect } from '@playwright/test';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const json = (body, status = 200, headers = {}) => ({
  status, contentType: 'application/json', headers: { ...CORS, ...headers }, body: JSON.stringify(body),
});

const TUTOR_ID = '11111111-1111-4111-8111-111111111111';
const AUTH_KEY = 'sb-supabase-auth-token'; // 'sb-' + 'supabase' (1º rótulo do host) + '-auth-token'
const XSS_BIO = 'Olá! Sou professora há 10 anos.\nAulas com muitos exercícios.\n<img src=x onerror=window.__xss=1>';

function makeTutor(extra = {}) {
  return {
    user_id: TUTOR_ID,
    slug: 'ana-silva',
    headline: 'Professora de Matemática e Física para o ENEM',
    bio: XSS_BIO,
    hourly_rate_cents: 8000,
    mode_online: true,
    mode_presencial: true,
    uf: 'SP',
    city_name: 'São Paulo',
    published: true,
    suspended: false,
    plan: 'premium',
    plan_expires_at: '2099-01-01T00:00:00Z',
    rating_avg: 4.5,
    rating_count: 2,
    last_active_at: new Date(Date.now() - 2 * 3600e3).toISOString(),
    created_at: '2026-01-10T12:00:00Z',
    profiles: { full_name: 'Ana Silva', avatar_path: null },
    tutor_subjects: [
      { levels: ['medio', 'vestibular'], subjects: { id: 2, name: 'Matemática', slug: 'matematica' } },
      { levels: [], subjects: { id: 1, name: 'Física', slug: 'fisica' } },
    ],
    ...extra,
  };
}

/** Supabase falso: tutor_profiles?slug=eq.<slug> devolve o tutor (ou o que `profile` responder). */
async function mockSupabase(page, { tutor = makeTutor(), profile, user = null } = {}) {
  const reqs = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'supabase.test') {
      return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css', body: '' });
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname === '/rest/v1/tutor_profiles') {
      reqs.push(url);
      if (profile) return route.fulfill(await profile(url));
      const slug = url.searchParams.get('slug');
      return route.fulfill(json(tutor && slug === `eq.${tutor.slug}` ? [tutor] : []));
    }
    if (url.pathname === '/auth/v1/user') return route.fulfill(user ? json(user) : json({ message: 'no session' }, 401));
    if (url.pathname.startsWith('/rest/v1/rpc/')) return route.fulfill(json(null));
    if (url.pathname.startsWith('/rest/v1/')) return route.fulfill(json([], 200, { 'content-range': '*/0' }));
    return route.fulfill(json({}));
  });
  return reqs;
}

async function seedSession(page, user) {
  await page.addInitScript(([key, u]) => {
    localStorage.setItem(key, JSON.stringify({
      access_token: 'FAKE.JWT.TOKEN', refresh_token: 'fakerefresh', token_type: 'bearer',
      expires_in: 3600, expires_at: 4102444800, user: u,
    }));
  }, [AUTH_KEY, user]);
}

test('mostra o perfil em /professores/p/ana-silva', async ({ page }) => {
  const reqs = await mockSupabase(page);
  await page.goto('/professores/p/ana-silva');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ana Silva');
  const head = page.locator('.pf-profile-head');
  await expect(head).toHaveClass(/is-premium/);
  await expect(head).toContainText('Destaque');
  await expect(head).toContainText('Professora de Matemática e Física para o ENEM');
  await expect(head).toContainText('Presencial em São Paulo/SP');
  await expect(head).toContainText('Aulas online');
  await expect(head.getByRole('img', { name: 'Nota 4,5 de 5, 2 avaliações' })).toBeVisible();
  await expect(page.locator('#contato')).toContainText('R$ 80,00');

  // Matérias e níveis (ordem alfabética, rótulos de SUBJECT_LEVELS)
  const items = page.locator('#materias .pf-subject-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Física');
  await expect(items.nth(0)).toContainText('Todos os níveis');
  await expect(items.nth(1)).toContainText('Matemática');
  await expect(items.nth(1).locator('.pf-levels li')).toHaveText(['Ensino médio', 'Pré-vestibular / ENEM']);
  await expect(items.nth(1).getByRole('link', { name: 'Matemática' })).toHaveAttribute('href', '/professores/?materia=matematica');

  // Consulta: por slug, com profiles e tutor_subjects embutidos
  expect(reqs).toHaveLength(1);
  expect(reqs[0].searchParams.get('slug')).toBe('eq.ana-silva');
  const select = reqs[0].searchParams.get('select');
  expect(select).toContain('profiles');
  expect(select).toContain('full_name,avatar_path');
  expect(select).toContain('tutor_subjects(levels,subjects(id,name,slug))');

  // SEO
  await expect(page).toHaveTitle('Ana Silva — Aulas de Física e Matemática — Professores | Quanta Aulas');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://quantaaulas.com/professores/p/ana-silva');
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://quantaaulas.com/professores/p/ana-silva');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Ana Silva/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Aulas de Física e Matemática online e presencial em São Paulo\/SP/);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /R\$ 80,00\/hora/);
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

  const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  expect(ld).toMatchObject({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Ana Silva',
    url: 'https://quantaaulas.com/professores/p/ana-silva',
    knowsAbout: ['Física', 'Matemática'],
    address: { addressLocality: 'São Paulo', addressRegion: 'SP', addressCountry: 'BR' },
    makesOffer: { '@type': 'Offer', price: '80.00', priceCurrency: 'BRL' },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 2, bestRating: 5 },
  });
});

test('bio com HTML é mostrada como texto (sem XSS), inclusive no JSON-LD', async ({ page }) => {
  const evil = '</script><script>window.__xss2=1</script>';
  await mockSupabase(page, { tutor: makeTutor({ headline: `Aulas ${evil}`, profiles: { full_name: 'Ana <i>Silva</i>', avatar_path: null } }) });
  await page.goto('/professores/p/ana-silva');

  const bio = page.locator('#sobre .pf-bio');
  await expect(bio).toContainText('<img src=x onerror=window.__xss=1>');
  await expect(bio.locator('img')).toHaveCount(0);
  await expect(page.locator('main img[src="x"]')).toHaveCount(0);
  // quebras de linha preservadas com CSS (pre-line), não com <br>
  await expect(bio).toHaveCSS('white-space', 'pre-line');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ana <i>Silva</i>');

  const raw = await page.locator('#perfilJsonLd').evaluate((el) => el.textContent);
  expect(raw).not.toContain('</script');
  expect(JSON.parse(raw).description).toBe(`Aulas ${evil}`);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => [window.__xss, window.__xss2])).toEqual([undefined, undefined]);
});

test('slug desconhecido mostra "Professor não encontrado" (noindex)', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/professores/p/nao-existe');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Professor não encontrado');
  await expect(page.getByRole('link', { name: 'Buscar professores' }).last()).toHaveAttribute('href', '/professores/');
  await expect(page).toHaveTitle('Professor não encontrado — Professores | Quanta Aulas');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.locator('#perfilCtaBar')).toHaveCount(0);
});

test('?u= inválido nem consulta o banco; ?u= válido funciona em perfil.html', async ({ page }) => {
  const reqs = await mockSupabase(page);
  await page.goto('/professores/perfil.html?u=..%2F..%2Fadmin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Professor não encontrado');
  expect(reqs).toHaveLength(0);

  await page.goto('/professores/perfil.html?u=ana-silva');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ana Silva');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://quantaaulas.com/professores/p/ana-silva');
});

test('pontos de montagem dos componentes existem', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/professores/p/ana-silva');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ana Silva');

  await expect(page.locator('#contato #perfilContato[data-mount="contact"]')).toHaveCount(1);
  await expect(page.locator('#avaliacoes [data-mount="reviews"]')).toHaveCount(1);
  await expect(page.locator('#respostas [data-mount="answers"]')).toHaveCount(1);
  await expect(page.locator('#perfilCtaBar [data-mount="contact-bar"]')).toHaveCount(1);
  // Componentes renderizaram algo (não travaram a página); respostas pode ficar vazio (seção some)
  await expect(page.locator('#perfilContato')).not.toBeEmpty();
  await expect(page.locator('#avaliacoes [data-mount="reviews"]')).not.toBeEmpty();
  // Denunciar perfil
  await expect(page.locator('#contato .pf-cta-foot button, #contato .pf-cta-foot a').first()).toContainText(/Denunciar/);
  await expect(page.getByRole('heading', { name: 'Sobre' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Matérias e níveis' })).toBeVisible();
});

test('erro ao carregar mostra aviso e "Tentar de novo"', async ({ page }) => {
  let fail = true;
  await mockSupabase(page, {
    profile: () => (fail ? json({ code: 'XX000', message: 'boom' }, 500) : json([makeTutor()])),
  });
  await page.goto('/professores/p/ana-silva');
  const alert = page.getByRole('alert').filter({ hasText: 'Não foi possível carregar este perfil.' });
  await expect(alert).toBeVisible();
  fail = false;
  await alert.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ana Silva');
});

test('professor sem avaliações, sem preço e só online', async ({ page }) => {
  await mockSupabase(page, {
    tutor: makeTutor({
      rating_avg: 0, rating_count: 0, hourly_rate_cents: null, mode_presencial: false, uf: null, city_name: null,
      plan: 'premium', plan_expires_at: '2020-01-01T00:00:00Z', bio: '', tutor_subjects: [],
    }),
  });
  await page.goto('/professores/p/ana-silva');
  const head = page.locator('.pf-profile-head');
  await expect(head).toContainText('Novo no portal');
  await expect(head).not.toContainText('Destaque'); // plano vencido = básico
  await expect(head).not.toContainText('Presencial');
  await expect(page.locator('#contato')).toContainText('Preço a combinar');
  await expect(page.locator('#sobre')).toContainText('ainda não escreveu');
  await expect(page.locator('#materias')).toContainText('Nenhuma matéria informada');
  const ld = JSON.parse(await page.locator('#perfilJsonLd').textContent());
  expect(ld.aggregateRating).toBeUndefined();
  expect(ld.address).toBeUndefined();
  expect(ld.makesOffer.price).toBeUndefined();
});

test('dono vê aviso de anúncio não publicado (e sem barra de contato)', async ({ page }) => {
  const user = { id: TUTOR_ID, aud: 'authenticated', role: 'authenticated', email: 'ana@exemplo.test' };
  await seedSession(page, user);
  await mockSupabase(page, { tutor: makeTutor({ published: false }), user });
  await page.goto('/professores/p/ana-silva');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ana Silva');
  const notice = page.locator('.pf-profile-notice');
  await expect(notice).toContainText('Anúncio não publicado');
  await expect(notice.getByRole('link', { name: 'Ir para o painel' })).toHaveAttribute('href', '/professores/painel.html');
  await expect(page.locator('#contato').getByRole('link', { name: 'Editar meu perfil' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.locator('#perfilCtaBar')).toHaveCount(0);
});

test.describe('celular (360px)', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('barra fixa de contato aparece ao rolar; sem rolagem horizontal', async ({ page }) => {
    await mockSupabase(page, {
      tutor: makeTutor({
        profiles: { full_name: 'Maria Aparecida dos Santos Albuquerque Figueiredo', avatar_path: null },
        hourly_rate_cents: 100000,
        bio: `${'Texto longo sem espaços '.repeat(3)}${'x'.repeat(300)}`,
      }),
    });
    await page.goto('/professores/p/ana-silva');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Maria Aparecida');

    const bar = page.locator('#perfilCtaBar');
    await expect(bar).toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(bar).toHaveClass(/is-visible/);
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('R$ 1.000,00');
    // encostada no rodapé da tela (depois da transição de entrada)
    await expect.poll(async () => {
      const box = await bar.boundingBox();
      return Math.round(box.y + box.height);
    }).toBe(740);

    // preço não fica coberto pelo botão
    const price = await bar.locator('.pf-cta-bar-price').boundingBox();
    const action = await bar.locator('.pf-cta-bar-action').boundingBox();
    expect(price.x + price.width).toBeLessThanOrEqual(action.x + 1);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#contato').scrollIntoViewIfNeeded();
    await expect(bar).not.toHaveClass(/is-visible/);

    const wide = await page.evaluate(() => [...document.querySelectorAll('main *, #perfilCtaBar *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`));
    expect(wide, wide.join('\n')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});
