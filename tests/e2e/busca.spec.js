// Busca de professores (/professores/): RPC search_tutors mockada, filtros <-> URL, paginação e estados.
import { test, expect } from '@playwright/test';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const json = (body, status = 200, headers = {}) => ({
  status, contentType: 'application/json', headers: { ...CORS, ...headers }, body: JSON.stringify(body),
});

const SUBJECTS = [
  { id: 1, slug: 'fisica', name: 'Física', category: 'Exatas' },
  { id: 2, slug: 'matematica', name: 'Matemática', category: 'Exatas' },
  { id: 3, slug: 'ingles', name: 'Inglês', category: 'Idiomas' },
  { id: 4, slug: 'violao', name: 'Violão', category: 'Música' },
  { id: 5, slug: 'xadrez', name: 'Xadrez', category: 'Outros' },
];

function tutor(i, extra = {}) {
  return {
    user_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    slug: `prof-${i}`,
    full_name: `Professor ${i}`,
    avatar_path: null,
    headline: `Aulas particulares ${i}`,
    hourly_rate_cents: 5000 + i * 100,
    uf: null,
    city_name: null,
    mode_online: true,
    mode_presencial: false,
    rating_avg: 0,
    rating_count: 0,
    plan: 'basico',
    subjects: ['Matemática'],
    total: 3,
    ...extra,
  };
}

const TUTORS = [
  tutor(1, {
    slug: 'ana-silva', full_name: 'Ana Silva', headline: 'Matemática e Física para o ENEM', hourly_rate_cents: 8000,
    uf: 'SP', city_name: 'São Paulo', mode_presencial: true, rating_avg: 4.8, rating_count: 12, plan: 'premium',
    subjects: ['Cálculo', 'ENEM', 'Física', 'Geometria', 'Matemática', 'Química'],
  }),
  tutor(2, { slug: 'bruno-costa', full_name: 'Bruno Costa', headline: 'Inglês para conversação', plan: 'profissional', rating_avg: 4.33, rating_count: 3, subjects: ['Inglês'] }),
  tutor(3, { slug: 'carla-souza', full_name: 'Carla <b>Souza</b>', headline: '<img src=x onerror=window.__xss=1>', hourly_rate_cents: null, subjects: [] }),
];

/**
 * Supabase falso. search(body) devolve as linhas (array) ou { status, body } para erro.
 * Retorna a lista de corpos enviados à RPC search_tutors.
 */
async function mockSupabase(page, { search = () => TUTORS, subjects = SUBJECTS } = {}) {
  const calls = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'supabase.test') {
      return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css', body: '' });
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname === '/rest/v1/rpc/search_tutors') {
      const body = req.postDataJSON();
      calls.push(body);
      const res = await search(body);
      if (Array.isArray(res) || res == null) return route.fulfill(json(res));
      return route.fulfill(json(res.body ?? {}, res.status ?? 500));
    }
    if (url.pathname === '/rest/v1/subjects') return route.fulfill(json(subjects));
    if (url.pathname.startsWith('/rest/v1/rpc/')) return route.fulfill(json(null));
    if (url.pathname.startsWith('/rest/v1/')) return route.fulfill(json([], 200, { 'content-range': '*/0' }));
    return route.fulfill(json({}));
  });
  return calls;
}

const cards = (page) => page.locator('#resultados .pf-tutor-card');
const lastCall = (calls) => calls[calls.length - 1];

test('lista 3 professores; premium primeiro com selo "Destaque"', async ({ page }) => {
  const calls = await mockSupabase(page);
  await page.goto('/professores/');

  await expect(cards(page)).toHaveCount(3);
  await expect(page.locator('#resultCount')).toHaveText('3 professores encontrados');

  const first = cards(page).first();
  await expect(first).toHaveClass(/is-premium/);
  await expect(first).toContainText('Destaque');
  await expect(first.getByRole('link', { name: 'Ana Silva' })).toHaveAttribute('href', '/professores/p/ana-silva');
  await expect(first).toContainText('R$ 80,00');
  await expect(first).toContainText('/hora');
  await expect(first).toContainText('Presencial em São Paulo/SP');
  await expect(first).toContainText('Online');
  await expect(first.getByRole('img', { name: /Nota 4,8 de 5, 12 avaliações/ })).toBeVisible();
  // Máx. 4 matérias + "+N"
  const chips = first.locator('.pf-tutor-subjects > li');
  await expect(chips).toHaveCount(5);
  await expect(chips.last()).toContainText('+2');

  const second = cards(page).nth(1);
  await expect(second).not.toHaveClass(/is-premium/);
  await expect(second).not.toContainText('Destaque');
  await expect(second).toContainText('Profissional');

  // Sem avaliações -> "Novo"; sem preço -> "a combinar"; HTML do usuário vira texto
  const third = cards(page).nth(2);
  await expect(third).toContainText('Novo');
  await expect(third).toContainText('Preço a combinar');
  await expect(third.getByRole('link')).toHaveText('Carla <b>Souza</b>');
  await expect(third).toContainText('<img src=x onerror=window.__xss=1>');
  await expect(third.locator('b, img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  // Parâmetros da RPC (sem filtros)
  expect(lastCall(calls)).toEqual({
    q: null, p_materia: null, p_uf: null, p_cidade: null, p_modo: null,
    p_preco_min: null, p_preco_max: null, p_ordem: 'relevancia', p_lim: 12, p_pagina: 0,
  });

  // Card inteiro leva ao perfil
  await first.click(); // o link do nome cobre o card (::after)
  await page.waitForURL('**/professores/p/ana-silva');
});

test('matérias carregadas no select; mudar matéria atualiza URL e p_materia', async ({ page }) => {
  const calls = await mockSupabase(page);
  await page.goto('/professores/');
  await expect(cards(page)).toHaveCount(3);

  const sel = page.locator('#fMateria');
  await expect(sel.locator('optgroup[label="Exatas"] option')).toHaveCount(2);
  await sel.selectOption('matematica');

  await expect(page).toHaveURL(/[?&]materia=matematica(&|$)/);
  await expect.poll(() => lastCall(calls)?.p_materia).toBe('matematica');
  expect(lastCall(calls).p_pagina).toBe(0);
  await expect(page.locator('#resultadosTitulo')).toHaveText('Professores de Matemática');
  await expect(page).toHaveTitle('Professores de Matemática — Professores | Quanta Aulas');
  await expect(page.locator('#atalhosMaterias a[data-materia="matematica"]')).toHaveClass(/is-active/);

  // Chip de filtro ativo remove a matéria
  await page.getByRole('button', { name: 'Remover filtro: Matemática' }).click();
  await expect(page).not.toHaveURL(/materia=/);
  await expect.poll(() => lastCall(calls)?.p_materia).toBeNull();
  await expect(sel).toHaveValue('');

  // Voltar do navegador restaura o filtro (popstate)
  await page.goBack();
  await expect(page).toHaveURL(/materia=matematica/);
  await expect(sel).toHaveValue('matematica');
  await expect.poll(() => lastCall(calls)?.p_materia).toBe('matematica');
});

test('atalhos de matéria filtram sem recarregar a página', async ({ page }) => {
  const calls = await mockSupabase(page);
  await page.goto('/professores/');
  await expect(cards(page)).toHaveCount(3);
  await page.evaluate(() => { window.__semReload = true; });

  const chip = page.locator('#atalhosMaterias a[data-materia="violao"]');
  await chip.click();
  await expect(page).toHaveURL(/materia=violao/);
  await expect(chip).toHaveClass(/is-active/);
  await expect.poll(() => lastCall(calls)?.p_materia).toBe('violao');
  expect(await page.evaluate(() => window.__semReload)).toBe(true);
  // Atalho sem matéria no banco some
  await expect(page.locator('#atalhosMaterias a[data-materia="redacao"]')).toHaveCount(0);

  await chip.click(); // clicar de novo desmarca
  await expect(page).not.toHaveURL(/materia=/);
  await expect(chip).not.toHaveClass(/is-active/);
});

test('URL preenche o formulário e vira parâmetros da RPC (preço em centavos)', async ({ page }) => {
  const calls = await mockSupabase(page);
  await page.goto('/professores/?q=viol%C3%A3o&modo=online&min=50&max=120&ordem=preco_asc&uf=SP&cidade=3550308&pagina=1');
  await expect(cards(page)).toHaveCount(3);

  expect(lastCall(calls)).toEqual({
    q: 'violão', p_materia: null, p_uf: 'SP', p_cidade: 3550308, p_modo: 'online',
    p_preco_min: 5000, p_preco_max: 12000, p_ordem: 'preco_asc', p_lim: 12, p_pagina: 0,
  });
  await expect(page.locator('#fQ')).toHaveValue('violão');
  await expect(page.locator('#fModo')).toHaveValue('online');
  await expect(page.locator('#fPrecoMin')).toHaveValue('50');
  await expect(page.locator('#fPrecoMax')).toHaveValue('120');
  await expect(page.locator('#fOrdem')).toHaveValue('preco_asc');
  await expect(page.getByLabel('Cidade')).toHaveValue('3550308');
  await expect(page.locator('#filtrosAtivos')).toContainText('R$ 50 a R$ 120');

  // Mudar ordenação e cidade
  await page.locator('#fOrdem').selectOption('avaliacao');
  await expect.poll(() => lastCall(calls)?.p_ordem).toBe('avaliacao');
  await expect(page).toHaveURL(/ordem=avaliacao/);
  await page.getByLabel('Estado').selectOption('SC');
  await expect.poll(() => lastCall(calls)?.p_uf).toBe('SC');
  expect(lastCall(calls).p_cidade).toBeNull();
  await expect(page).toHaveURL(/uf=SC/);
  await expect(page).not.toHaveURL(/cidade=/);
});

test('nomes do formulário sem JS (preco_min) viram min na URL', async ({ page }) => {
  const calls = await mockSupabase(page);
  await page.goto('/professores/?preco_min=30&preco_max=&materia=matematica');
  await expect(cards(page)).toHaveCount(3);
  expect(lastCall(calls).p_preco_min).toBe(3000);
  expect(lastCall(calls).p_preco_max).toBeNull();
  await expect(page).toHaveURL(/\?(.*&)?min=30/);
  await expect(page).not.toHaveURL(/preco_min/);
  // Matéria da URL fica selecionada depois que a lista chega
  await expect(page.locator('#fMateria')).toHaveValue('matematica');
});

test('Enter no preço: uma busca só, com o valor em centavos', async ({ page }) => {
  const calls = await mockSupabase(page);
  await page.goto('/professores/');
  await expect(cards(page)).toHaveCount(3);
  await page.locator('#fPrecoMax').fill('75.5'); // fora do step=5: não pode travar o envio
  await page.locator('#fPrecoMax').press('Enter');
  await expect.poll(() => lastCall(calls)?.p_preco_max).toBe(7550);
  await page.waitForTimeout(700);
  expect(calls.filter((c) => c.p_preco_max === 7550)).toHaveLength(1);
  await expect(page).toHaveURL(/max=75\.5/);
  await expect(page.locator('#filtrosAtivos')).toContainText('Até R$ 75,50');
});

test('texto digitado busca com atraso (debounce) e Enter busca na hora', async ({ page }) => {
  const calls = await mockSupabase(page);
  await page.goto('/professores/');
  await expect(cards(page)).toHaveCount(3);
  const before = calls.length;

  await page.locator('#fQ').pressSequentially('física', { delay: 30 });
  await expect.poll(() => lastCall(calls)?.q).toBe('física');
  // Uma busca só para a digitação inteira
  expect(calls.length - before).toBe(1);
  await expect(page).toHaveURL(/q=f%C3%ADsica/);

  await page.locator('#fQ').fill('inglês');
  await page.locator('#fQ').press('Enter');
  await expect.poll(() => lastCall(calls)?.q).toBe('inglês');
  await expect(page).toHaveURL(/q=ingl%C3%AAs/);
});

test('paginação: página 2 -> p_pagina 1; voltar -> página 1', async ({ page }) => {
  const calls = await mockSupabase(page, {
    search: (body) => Array.from({ length: 12 }, (_, i) => tutor(body.p_pagina * 12 + i + 1, { total: 30 })),
  });
  await page.goto('/professores/');
  await expect(cards(page)).toHaveCount(12);
  await expect(page.locator('#resultCount')).toHaveText('30 professores encontrados · página 1 de 3');

  const pager = page.locator('#paginacao');
  await expect(pager.locator('[aria-current="page"]')).toHaveText('1');
  await pager.getByRole('link', { name: 'Página 2' }).click();

  await expect(page).toHaveURL(/pagina=2/);
  await expect.poll(() => lastCall(calls)?.p_pagina).toBe(1);
  await expect(page.locator('#resultCount')).toContainText('página 2 de 3');
  await expect(pager.locator('[aria-current="page"]')).toHaveText('2');
  await expect(cards(page).first()).toContainText('Professor 13');
  await expect(page.locator('#resultadosTitulo')).toBeFocused();

  await pager.getByRole('link', { name: 'Próxima página' }).click();
  await expect.poll(() => lastCall(calls)?.p_pagina).toBe(2);
  await expect(pager.locator('.pf-page-next')).toHaveAttribute('aria-disabled', 'true');

  await page.goBack();
  await page.goBack();
  await expect(page).not.toHaveURL(/pagina=/);
  await expect.poll(() => lastCall(calls)?.p_pagina).toBe(0);
  await expect(pager.locator('[aria-current="page"]')).toHaveText('1');

  // Mudar filtro volta para a página 1
  await pager.getByRole('link', { name: 'Página 3' }).click();
  await expect.poll(() => lastCall(calls)?.p_pagina).toBe(2);
  await page.locator('#fModo').selectOption('online');
  await expect.poll(() => lastCall(calls)?.p_modo).toBe('online');
  expect(lastCall(calls).p_pagina).toBe(0);
  await expect(page).not.toHaveURL(/pagina=/);
});

test('estado vazio sugere limpar filtros', async ({ page }) => {
  const calls = await mockSupabase(page, { search: (body) => (body.p_materia ? [] : TUTORS) });
  await page.goto('/professores/?materia=xadrez&modo=presencial&uf=SC');
  await expect(page.locator('.pf-empty')).toContainText('Nenhum professor encontrado com esses filtros');
  await expect(page.locator('#resultCount')).toHaveText('Nenhum professor encontrado.');
  await expect(page.getByRole('button', { name: 'Ver aulas online' })).toBeVisible();

  await page.getByRole('button', { name: 'Limpar filtros' }).first().click();
  await expect(cards(page)).toHaveCount(3);
  await expect(page).not.toHaveURL(/materia=|modo=|uf=/);
  expect(lastCall(calls).p_materia).toBeNull();
  expect(lastCall(calls).p_modo).toBeNull();
  expect(lastCall(calls).p_uf).toBeNull();
});

test('sem professores e sem filtros: convite para cadastro', async ({ page }) => {
  await mockSupabase(page, { search: () => [] });
  await page.goto('/professores/');
  await expect(page.locator('.pf-empty')).toContainText('Ainda não há professores publicados');
  await expect(page.locator('.pf-empty a')).toHaveAttribute('href', '/professores/entrar.html?modo=cadastro&tipo=professor');
});

test('erro na RPC mostra aviso e permite tentar de novo', async ({ page }) => {
  let fail = true;
  await mockSupabase(page, { search: () => (fail ? { status: 500, body: { code: 'XX000', message: 'boom' } } : TUTORS) });
  await page.goto('/professores/');
  const alert = page.locator('#resultados [role="alert"]');
  await expect(alert).toContainText('Não foi possível carregar os professores.');
  await expect(alert).not.toContainText('boom');
  fail = false;
  await alert.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(cards(page)).toHaveCount(3);
});

test('carregando: esqueleto e aria-busy enquanto a RPC não responde', async ({ page }) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  await mockSupabase(page, { search: async () => { await gate; return TUTORS; } });
  await page.goto('/professores/');
  await expect(page.locator('#resultados .pf-skeletons')).toBeVisible();
  await expect(page.locator('#resultados')).toHaveAttribute('aria-busy', 'true');
  release();
  await expect(cards(page)).toHaveCount(3);
  await expect(page.locator('#resultados')).toHaveAttribute('aria-busy', 'false');
});

test.describe('celular (360px)', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('cards e paginação sem rolagem horizontal', async ({ page }) => {
    await mockSupabase(page, {
      search: () => [
        ...TUTORS.map((t) => ({ ...t, total: 60 })),
        tutor(9, { full_name: 'Maria Aparecida dos Santos Albuquerque Figueiredo', hourly_rate_cents: 100000, plan: 'premium', total: 60,
          subjects: ['Português para Estrangeiros', 'Matemática Financeira', 'Concursos Públicos', 'Álgebra Linear', 'OAB'] }),
      ],
    });
    await page.goto('/professores/?pagina=3');
    await expect(cards(page)).toHaveCount(4);
    await expect(page.locator('#paginacao a, #paginacao span').first()).toBeVisible();
    const wide = await page.evaluate(() => [...document.querySelectorAll('main *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`));
    expect(wide, wide.join('\n')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});
