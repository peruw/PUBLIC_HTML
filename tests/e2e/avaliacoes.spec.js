// Avaliações: seção do perfil público (/professores/p/<slug>) e aba "Avaliações" do painel.
// Supabase falso em http://supabase.test (REST, RPC, auth).
import { test, expect } from '@playwright/test';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': '*',
};
const AUTH_KEY = 'sb-supabase-auth-token'; // 'sb-' + 'supabase' (1º rótulo de supabase.test) + '-auth-token'
const TUTOR_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const PAGE_SIZE = 10;

const ago = (hours) => new Date(Date.now() - hours * 3600e3).toISOString();

function makeTutor(extra = {}) {
  return {
    user_id: TUTOR_ID, slug: 'ana-silva', headline: 'Professora de Matemática', bio: 'Bio',
    hourly_rate_cents: 8000, mode_online: true, mode_presencial: false, uf: null, city_name: null,
    published: true, suspended: false, plan: 'basico', plan_expires_at: null,
    rating_avg: 4, rating_count: 3, last_active_at: ago(2), created_at: '2026-01-10T12:00:00Z',
    profiles: { full_name: 'Ana Silva', avatar_path: null },
    tutor_subjects: [{ levels: ['medio'], subjects: { id: 1, name: 'Matemática', slug: 'matematica' } }],
    ...extra,
  };
}

function review(id, rating, extra = {}) {
  const created = extra.created_at || ago(id * 24);
  return {
    id, tutor_id: TUTOR_ID, student_id: OTHER_ID, rating, comment: `Comentário ${id}`, status: 'published',
    created_at: created, updated_at: created, reviewer_name: `Aluno ${id}.`, ...extra,
  };
}

const user = (id, email = 'aluno@exemplo.test') => ({
  id, aud: 'authenticated', role: 'authenticated', email,
  email_confirmed_at: '2026-09-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {},
  created_at: '2026-09-01T00:00:00Z',
});

function profileRow(id, { role = 'student', tutor = null, ...extra } = {}) {
  return {
    id, role, full_name: role === 'tutor' ? 'Ana Silva' : 'Bruno Costa', avatar_path: null, is_admin: false, banned_at: null,
    terms_accepted_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    tutor_profiles: tutor, ...extra,
  };
}

async function seedSession(page, u) {
  await page.addInitScript(([key, usr]) => {
    localStorage.setItem(key, JSON.stringify({
      access_token: 'FAKE.JWT.TOKEN', refresh_token: 'fakerefresh', token_type: 'bearer',
      expires_in: 3600, expires_at: 4102444800, user: usr,
    }));
  }, [AUTH_KEY, u]);
}

const rangeHeader = (off, n, total) => ({ 'content-range': n ? `${off}-${off + n - 1}/${total}` : `*/${total}` });

/**
 * Supabase falso com estado de avaliações.
 * st: { tutor, published[], own, written[], canReview, profile, user,
 *       onPost(call), onPatch(call), onDelete(call), failList }
 */
async function mockSupabase(page, st = {}) {
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
    const call = { method: req.method(), path: url.pathname, url, params: url.searchParams, body, headers: req.headers() };
    calls.push(call);
    const reply = (b, status = 200, headers = {}) => route.fulfill({
      status, contentType: 'application/json', headers: { ...CORS, ...headers }, body: JSON.stringify(b),
    });
    const p = url.searchParams;

    if (url.pathname === '/auth/v1/user') return st.user ? reply(st.user) : reply({ message: 'no session' }, 401);
    if (url.pathname === '/rest/v1/tutor_profiles') {
      const tutor = st.tutor === undefined ? makeTutor() : st.tutor;
      return reply(tutor && p.get('slug') === `eq.${tutor.slug}` ? [tutor] : []);
    }
    if (url.pathname === '/rest/v1/profiles') return reply(st.profile ? [st.profile] : []);
    if (url.pathname === '/rest/v1/rpc/can_review') return reply(Boolean(st.canReview));
    if (url.pathname === '/rest/v1/rpc/unread_count') return reply(0);

    if (url.pathname === '/rest/v1/reviews') {
      if (call.method === 'POST') return st.onPost ? reply(...st.onPost(call)) : reply({ message: 'x' }, 500);
      if (call.method === 'PATCH') return st.onPatch ? reply(...st.onPatch(call)) : reply([]);
      if (call.method === 'DELETE') return st.onDelete ? reply(...st.onDelete(call)) : reply([]);
      const off = Number(p.get('offset') || 0);
      const lim = Number(p.get('limit') || 1000);
      if (p.get('student_id') && p.get('tutor_id')) {
        return reply(st.own && p.get('student_id') === `eq.${st.own.student_id}` ? [st.own] : []);
      }
      if (p.get('student_id')) {
        const all = st.written || [];
        const rows = all.slice(off, off + lim);
        return reply(rows, 200, rangeHeader(off, rows.length, all.length));
      }
      if (st.failList && st.failList()) return reply({ code: 'XX000', message: 'boom' }, 500);
      const all = (st.published || []).filter((r) => p.get('tutor_id') === `eq.${r.tutor_id}`);
      if (p.get('select') === 'rating') return reply(all.slice(0, lim).map((r) => ({ rating: r.rating })));
      const rows = all.slice(off, off + lim);
      return reply(rows, 200, rangeHeader(off, rows.length, all.length));
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) return reply(null);
    if (url.pathname.startsWith('/rest/v1/')) return reply([], 200, { 'content-range': '*/0' });
    return reply({});
  });
  return calls;
}

const reviewCalls = (calls, method = 'GET') => calls.filter((c) => c.path === '/rest/v1/reviews' && c.method === method);
const listCalls = (calls) => reviewCalls(calls).filter((c) => (c.params.get('select') || '').includes('reviewer_name'));

function trackErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

// ---------------------------------------------------------------------------
// Perfil público
// ---------------------------------------------------------------------------

test.describe('perfil: seção de avaliações', () => {
  test('visitante vê resumo, distribuição e lista; comentários só como texto; "Entre para avaliar"', async ({ page }) => {
    const errors = trackErrors(page);
    const published = [
      review(3, 5, { comment: 'Ótima professora!\nRecomendo muito.', reviewer_name: 'Bruno C.', created_at: ago(48), updated_at: ago(2) }),
      review(2, 4, { comment: '<img src=x onerror=window.__xss=1>', reviewer_name: 'Carla <b>D.</b>' }),
      review(1, 3, { comment: '', reviewer_name: 'Davi E.' }),
    ];
    const calls = await mockSupabase(page, { published });
    await page.goto('/professores/p/ana-silva');

    const sec = page.locator('#avaliacoes');
    await expect(sec.getByRole('heading', { level: 2, name: 'Avaliações' })).toBeVisible();
    const items = sec.locator('.pf-rv-list > li');
    await expect(items).toHaveCount(3);

    // Resumo
    await expect(sec.locator('.pf-rv-avg')).toHaveText('4,0');
    await expect(sec.locator('.pf-rv-summary').getByRole('img', { name: 'Nota 4,0 de 5, 3 avaliações' })).toBeVisible();
    await expect(sec.locator('.pf-rv-total')).toHaveText('3 avaliações');
    const dist = sec.getByRole('list', { name: 'Distribuição das notas' });
    await expect(dist.locator('li')).toHaveCount(5);
    await expect(dist.locator('li').nth(0)).toContainText('5 estrelas: 1 avaliação (33%)');
    await expect(dist.locator('li').nth(3)).toContainText('2 estrelas: 0 avaliações (0%)');

    // Lista: nome abreviado, nota, data, comentário em pre-line
    await expect(items.nth(0)).toContainText('Bruno C.');
    await expect(items.nth(0).getByRole('img', { name: 'Nota 5,0 de 5' })).toBeVisible();
    await expect(items.nth(0).locator('time')).toHaveText('anteontem');
    await expect(items.nth(0)).toContainText('editada');
    const text0 = items.nth(0).locator('.pf-rv-text');
    await expect(text0).toHaveText('Ótima professora!\nRecomendo muito.');
    await expect(text0).toHaveCSS('white-space', 'pre-line');

    // XSS: HTML do comentário e do nome vira texto
    await expect(items.nth(1).locator('.pf-rv-text')).toHaveText('<img src=x onerror=window.__xss=1>');
    await expect(items.nth(1)).toContainText('Carla <b>D.</b>');
    await expect(sec.locator('img[src="x"], b')).toHaveCount(0);
    // Sem comentário: nenhum parágrafo vazio
    await expect(items.nth(2).locator('.pf-rv-text')).toHaveCount(0);

    // Denunciar em cada avaliação
    await expect(sec.locator('.pf-rv-list .pf-rv-foot')).toHaveCount(3);
    await expect(items.nth(0).locator('.pf-rv-foot')).toContainText('Denunciar');

    // Visitante: link para entrar voltando para #avaliacoes
    const entrar = sec.getByRole('link', { name: 'Entre para avaliar' });
    await expect(entrar).toHaveAttribute('href', `/professores/entrar.html?next=${encodeURIComponent('/professores/p/ana-silva#avaliacoes')}`);
    await expect(sec.getByRole('button', { name: 'Ver mais avaliações' })).toBeHidden();

    // Consulta: publicadas do professor, mais recentes primeiro, 10 por página
    const list = listCalls(calls);
    expect(list).toHaveLength(1);
    const q = list[0].params;
    expect(q.get('tutor_id')).toBe(`eq.${TUTOR_ID}`);
    expect(q.get('status')).toBe('eq.published');
    expect(q.get('order')).toMatch(/^created_at\.desc/);
    expect(q.get('offset')).toBe('0');
    expect(q.get('limit')).toBe(String(PAGE_SIZE));
    for (const col of ['id', 'rating', 'comment', 'created_at', 'reviewer_name', 'student_id']) {
      expect(q.get('select').split(',')).toContain(col);
    }
    // Poucas avaliações: distribuição sai da própria página; visitante não chama can_review
    expect(reviewCalls(calls).filter((c) => c.params.get('select') === 'rating')).toHaveLength(0);
    expect(calls.some((c) => c.path === '/rest/v1/rpc/can_review')).toBe(false);

    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('paginação: 10 por vez com "Ver mais"; distribuição busca só as notas', async ({ page }) => {
    const published = Array.from({ length: 23 }, (_, i) => review(23 - i, (i % 5) + 1));
    const avg = published.reduce((s, r) => s + r.rating, 0) / published.length;
    const calls = await mockSupabase(page, { published, tutor: makeTutor({ rating_avg: Number(avg.toFixed(2)), rating_count: 23 }) });
    await page.goto('/professores/p/ana-silva');

    const sec = page.locator('#avaliacoes');
    const items = sec.locator('.pf-rv-list > li');
    await expect(items).toHaveCount(10);
    await expect(sec.locator('.pf-rv-status')).toHaveText('Mostrando 10 de 23 avaliações.');
    await expect(sec.locator('.pf-rv-total')).toHaveText('23 avaliações');
    await expect(sec.getByRole('list', { name: 'Distribuição das notas' }).locator('li').nth(0))
      .toContainText('5 estrelas: 4 avaliações (17%)');
    expect(reviewCalls(calls).filter((c) => c.params.get('select') === 'rating')).toHaveLength(1);

    const more = sec.getByRole('button', { name: 'Ver mais avaliações' });
    await more.click();
    await expect(items).toHaveCount(20);
    await expect(sec.locator('.pf-rv-status')).toHaveText('Mostrando 20 de 23 avaliações.');
    expect(listCalls(calls).at(-1).params.get('offset')).toBe('10');
    // foco vai para a 1ª avaliação nova
    await expect(items.nth(10).locator('.pf-rv-card')).toBeFocused();

    await more.click();
    await expect(items).toHaveCount(23);
    await expect(more).toBeHidden();
    await expect(sec.locator('.pf-rv-status')).toHaveText('Mostrando 23 de 23 avaliações.');
    await expect(items.nth(22)).toContainText('Aluno 1.');
  });

  test('aluno que pode avaliar: estrelas pelo teclado, validação e publicação', async ({ page }) => {
    const errors = trackErrors(page);
    const u = user(STUDENT_ID);
    await seedSession(page, u);
    const st = {
      user: u,
      profile: profileRow(STUDENT_ID),
      canReview: true,
      published: [review(1, 3)],
      onPost: (call) => {
        const row = {
          id: 99, tutor_id: call.body.tutor_id, student_id: STUDENT_ID, rating: call.body.rating, comment: call.body.comment,
          status: 'published', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        st.own = row;
        st.published = [{ ...row, reviewer_name: 'Bruno C.' }, ...st.published];
        return [[row], 201];
      },
    };
    const calls = await mockSupabase(page, st);
    await page.goto('/professores/p/ana-silva');

    const sec = page.locator('#avaliacoes');
    const box = sec.locator('.pf-rv-formbox');
    await expect(box.getByRole('heading', { name: 'Avalie este professor' })).toBeVisible();
    const canCall = calls.find((c) => c.path === '/rest/v1/rpc/can_review');
    expect(canCall.body).toEqual({ p_tutor: TUTOR_ID });

    // Sem nota: erro e foco na 1ª estrela
    await box.getByRole('button', { name: 'Publicar avaliação' }).click();
    await expect(box.getByRole('alert')).toHaveText('Escolha uma nota de 1 a 5 estrelas.');
    const r1 = box.getByRole('radio', { name: '1 estrela: Ruim' });
    await expect(r1).toBeFocused();
    expect(reviewCalls(calls, 'POST')).toHaveLength(0);

    // Setas escolhem a nota (grupo de rádios nativo)
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(box.getByRole('radio', { name: '4 estrelas: Muito bom' })).toBeChecked();
    await expect(box.locator('.pf-rv-picked')).toHaveText('Muito bom');
    await expect(box.locator('.pf-rv-star-opt.is-on')).toHaveCount(4);
    await expect(box.locator('.pf-rv-form-error')).toHaveText(''); // erro some ao escolher

    const comment = box.getByLabel('Comentário (opcional)');
    await expect(comment).toHaveAttribute('maxlength', '2000');
    await comment.fill('  Aulas excelentes,\nmuito didática.  ');
    await expect(box.locator('.pf-counter')).toHaveText('37/2000');
    await box.getByRole('button', { name: 'Publicar avaliação' }).click();

    // Insert só com as colunas liberadas (tutor_id, rating, comment)
    await expect.poll(() => reviewCalls(calls, 'POST').length).toBe(1);
    const post = reviewCalls(calls, 'POST')[0];
    expect(post.body).toEqual({ tutor_id: TUTOR_ID, rating: 4, comment: 'Aulas excelentes,\nmuito didática.' });
    expect(post.params.get('select')).toContain('status');

    const own = sec.locator('.pf-rv-own');
    await expect(own.getByRole('heading', { name: 'Sua avaliação' })).toBeFocused();
    await expect(own.getByRole('img', { name: 'Nota 4,0 de 5' })).toBeVisible();
    await expect(own.getByRole('button', { name: 'Editar avaliação' })).toBeVisible();
    await expect(own.getByRole('button', { name: 'Excluir' })).toBeVisible();
    await expect(page.locator('.pf-toast').filter({ hasText: 'Obrigado! Sua avaliação foi publicada.' })).toBeVisible();

    // Lista recarregada, com a própria marcada e sem "Denunciar" nela
    const items = sec.locator('.pf-rv-list > li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Você');
    await expect(items.nth(0).locator('.pf-rv-foot')).toHaveCount(0);
    await expect(sec.locator('.pf-rv-total')).toHaveText('2 avaliações');
    await expect(sec.locator('.pf-rv-avg')).toHaveText('3,5');
    expect(errors).toEqual([]);
  });

  test('aluno sem resposta do professor vê o aviso; insert negado pelo RLS mostra mensagem', async ({ page }) => {
    const u = user(STUDENT_ID);
    await seedSession(page, u);
    const st = { user: u, profile: profileRow(STUDENT_ID), canReview: false, published: [] };
    await mockSupabase(page, st);
    await page.goto('/professores/p/ana-silva');
    const sec = page.locator('#avaliacoes');
    await expect(sec.locator('.pf-rv-hint')).toHaveText('Você poderá avaliar depois que o professor responder sua mensagem.');
    await expect(sec.locator('form')).toHaveCount(0);
    await expect(sec.locator('.pf-rv-empty')).toHaveText('Este professor ainda não recebeu avaliações.');
    await expect(sec.locator('.pf-rv-summary')).toHaveCount(0);
  });

  test('insert recusado (RLS) mostra a explicação no formulário', async ({ page }) => {
    const u = user(STUDENT_ID);
    await seedSession(page, u);
    const st = {
      user: u, profile: profileRow(STUDENT_ID), canReview: true, published: [],
      onPost: () => [{ code: '42501', message: 'new row violates row-level security policy for table "reviews"' }, 403],
    };
    await mockSupabase(page, st);
    await page.goto('/professores/p/ana-silva');
    const box = page.locator('#avaliacoes .pf-rv-formbox');
    await box.getByRole('radio', { name: '5 estrelas: Excelente' }).check();
    await box.getByRole('button', { name: 'Publicar avaliação' }).click();
    await expect(box.getByRole('alert')).toHaveText('Você só pode avaliar depois que o professor responder sua mensagem.');
    await expect(box.getByRole('button', { name: 'Publicar avaliação' })).toBeEnabled();
  });

  test('o próprio professor não vê formulário nem chama can_review', async ({ page }) => {
    const u = user(TUTOR_ID, 'ana@exemplo.test');
    await seedSession(page, u);
    const calls = await mockSupabase(page, {
      user: u, profile: profileRow(TUTOR_ID, { role: 'tutor', tutor: makeTutor() }), canReview: true, published: [review(1, 4)],
    });
    await page.goto('/professores/p/ana-silva');
    const sec = page.locator('#avaliacoes');
    await expect(sec.locator('.pf-rv-list > li')).toHaveCount(1);
    await expect(sec.locator('.pf-rv-user')).toBeEmpty();
    await expect(sec.getByText('Entre para avaliar')).toHaveCount(0);
    expect(calls.some((c) => c.path === '/rest/v1/rpc/can_review')).toBe(false);
  });

  test('editar e excluir a própria avaliação', async ({ page }) => {
    const u = user(STUDENT_ID);
    await seedSession(page, u);
    const mine = review(7, 5, { student_id: STUDENT_ID, comment: 'Muito boa!', reviewer_name: 'Bruno C.' });
    const st = {
      user: u,
      profile: profileRow(STUDENT_ID),
      canReview: true,
      own: { ...mine },
      published: [mine, review(1, 3)],
      onPatch: (call) => {
        const row = { ...st.own, ...call.body, updated_at: new Date().toISOString() };
        st.own = row;
        st.published = st.published.map((r) => (r.id === row.id ? { ...r, ...call.body } : r));
        return [[row]];
      },
      onDelete: () => {
        const id = st.own.id;
        st.own = null;
        st.published = st.published.filter((r) => r.id !== id);
        return [[{ id }]];
      },
    };
    const calls = await mockSupabase(page, st);
    await page.goto('/professores/p/ana-silva');

    const sec = page.locator('#avaliacoes');
    const own = sec.locator('.pf-rv-own');
    await expect(own).toContainText('Muito boa!');
    await expect(own.getByRole('img', { name: 'Nota 5,0 de 5' })).toBeVisible();
    // Já avaliou: não precisa perguntar can_review
    expect(calls.some((c) => c.path === '/rest/v1/rpc/can_review')).toBe(false);

    // Editar: formulário preenchido, foco na nota escolhida
    await own.getByRole('button', { name: 'Editar avaliação' }).click();
    const box = sec.locator('.pf-rv-formbox');
    await expect(box.getByRole('heading', { name: 'Editar sua avaliação' })).toBeVisible();
    const r5 = box.getByRole('radio', { name: '5 estrelas: Excelente' });
    await expect(r5).toBeChecked();
    await expect(r5).toBeFocused();
    await expect(box.getByLabel('Comentário (opcional)')).toHaveValue('Muito boa!');

    // Cancelar volta ao cartão
    await box.getByRole('button', { name: 'Cancelar' }).click();
    await expect(own.getByRole('heading', { name: 'Sua avaliação' })).toBeFocused();

    await own.getByRole('button', { name: 'Editar avaliação' }).click();
    await page.keyboard.press('ArrowLeft');
    await expect(box.getByRole('radio', { name: '4 estrelas: Muito bom' })).toBeChecked();
    await box.getByLabel('Comentário (opcional)').fill('Muito boa, mas às vezes atrasa.');
    await box.getByRole('button', { name: 'Salvar alterações' }).click();

    await expect(own).toContainText('Muito boa, mas às vezes atrasa.');
    const patch = reviewCalls(calls, 'PATCH')[0];
    expect(patch.body).toEqual({ rating: 4, comment: 'Muito boa, mas às vezes atrasa.' });
    expect(patch.params.get('id')).toBe('eq.7');
    expect(patch.params.get('student_id')).toBe(`eq.${STUDENT_ID}`);
    await expect(page.locator('.pf-toast').filter({ hasText: 'Avaliação atualizada.' })).toBeVisible();
    await expect(sec.locator('.pf-rv-list > li').nth(0)).toContainText('Muito boa, mas às vezes atrasa.');

    // Excluir com confirmação
    await own.getByRole('button', { name: 'Excluir' }).click();
    const dlg = page.getByRole('dialog', { name: 'Excluir sua avaliação?' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Excluir avaliação' }).click();
    await expect(dlg).toHaveCount(0);
    const del = reviewCalls(calls, 'DELETE')[0];
    expect(del.params.get('id')).toBe('eq.7');
    expect(del.params.get('student_id')).toBe(`eq.${STUDENT_ID}`);
    await expect(page.locator('.pf-toast').filter({ hasText: 'Avaliação excluída.' })).toBeVisible();
    // Pode avaliar de novo; lista sem a antiga
    await expect(sec.locator('.pf-rv-formbox').getByRole('heading', { name: 'Avalie este professor' })).toBeVisible();
    await expect(sec.locator('.pf-rv-list > li')).toHaveCount(1);
  });

  test('update sem linhas (oculta no meio do caminho) mostra erro e não finge que salvou', async ({ page }) => {
    const u = user(STUDENT_ID);
    await seedSession(page, u);
    const mine = review(7, 5, { student_id: STUDENT_ID, comment: 'Muito boa!' });
    await mockSupabase(page, {
      user: u, profile: profileRow(STUDENT_ID), canReview: true, own: mine, published: [mine],
      onPatch: () => [[]],
    });
    await page.goto('/professores/p/ana-silva');
    const sec = page.locator('#avaliacoes');
    await sec.getByRole('button', { name: 'Editar avaliação' }).click();
    const box = sec.locator('.pf-rv-formbox');
    await box.getByRole('radio', { name: '2 estrelas: Regular' }).check();
    await box.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(box.getByRole('alert')).toContainText('não pode mais ser alterada');
    await expect(box).toBeVisible();
  });

  test('avaliação oculta pela moderação fica travada (sem editar/excluir)', async ({ page }) => {
    const u = user(STUDENT_ID);
    await seedSession(page, u);
    await mockSupabase(page, {
      user: u, profile: profileRow(STUDENT_ID), canReview: true,
      own: review(7, 1, { student_id: STUDENT_ID, status: 'hidden', comment: 'Texto ofensivo' }),
      published: [],
    });
    await page.goto('/professores/p/ana-silva');
    const own = page.locator('#avaliacoes .pf-rv-own');
    await expect(own.getByText('Oculta pela moderação')).toBeVisible();
    await expect(own).toContainText('não pode ser editada nem excluída');
    await expect(own.getByRole('button')).toHaveCount(0);
  });

  test('conta suspensa não vê formulário', async ({ page }) => {
    const u = user(STUDENT_ID);
    await seedSession(page, u);
    await mockSupabase(page, {
      user: u, profile: profileRow(STUDENT_ID, { banned_at: '2026-09-01T00:00:00Z' }), canReview: true, published: [],
    });
    await page.goto('/professores/p/ana-silva');
    const sec = page.locator('#avaliacoes');
    await expect(sec.locator('.pf-rv-hint')).toContainText('Sua conta está suspensa');
    await expect(sec.locator('form')).toHaveCount(0);
  });

  test('erro ao carregar a lista mostra aviso e "Tentar de novo"', async ({ page }) => {
    let fail = true;
    await mockSupabase(page, { published: [review(1, 4)], failList: () => fail });
    await page.goto('/professores/p/ana-silva');
    const sec = page.locator('#avaliacoes');
    const alert = sec.getByRole('alert').filter({ hasText: 'Não foi possível carregar as avaliações.' });
    await expect(alert).toBeVisible();
    fail = false;
    await alert.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(sec.locator('.pf-rv-list > li')).toHaveCount(1);
  });

  test.describe('celular (360px)', () => {
    test.use({ viewport: { width: 360, height: 740 } });

    test('resumo, formulário e lista cabem na tela', async ({ page }) => {
      const u = user(STUDENT_ID);
      await seedSession(page, u);
      const published = Array.from({ length: 12 }, (_, i) => review(12 - i, (i % 5) + 1, {
        reviewer_name: 'Maximiliano Albuquerque-Figueiredo S.',
        comment: `${'Comentário longo '.repeat(8)}${'x'.repeat(200)}`,
      }));
      await mockSupabase(page, {
        user: u, profile: profileRow(STUDENT_ID), canReview: true, published,
        tutor: makeTutor({ rating_count: 12, rating_avg: 3 }),
      });
      await page.goto('/professores/p/ana-silva');
      const sec = page.locator('#avaliacoes');
      await expect(sec.locator('.pf-rv-list > li')).toHaveCount(10);
      await expect(sec.locator('.pf-rv-formbox')).toBeVisible();
      await expect(sec.getByRole('list', { name: 'Distribuição das notas' })).toBeVisible();

      const wide = await page.evaluate(() => [...document.querySelectorAll('#avaliacoes *')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`));
      expect(wide, wide.join('\n')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

      // Estrelas do formulário com alvo de toque confortável
      const star = await sec.locator('.pf-rv-star-opt').first().boundingBox();
      expect(star.width).toBeGreaterThanOrEqual(40);
      expect(star.height).toBeGreaterThanOrEqual(40);
    });
  });
});

// ---------------------------------------------------------------------------
// Painel: aba Avaliações
// ---------------------------------------------------------------------------

test.describe('painel: aba Avaliações', () => {
  test('aluno: lista das avaliações feitas, com link, editar e excluir', async ({ page }) => {
    const errors = trackErrors(page);
    const u = user(STUDENT_ID);
    await seedSession(page, u);
    const written = [
      review(10, 5, {
        student_id: STUDENT_ID, comment: 'Excelente!\nRecomendo.', reviewer_name: undefined,
        tutor: { slug: 'ana-silva', profile: { full_name: 'Ana Silva', avatar_path: null } },
      }),
      review(9, 2, {
        student_id: STUDENT_ID, status: 'hidden', comment: 'Oculta',
        tutor: { slug: 'bruno-lima', profile: { full_name: 'Bruno Lima', avatar_path: null } },
      }),
      review(8, 4, { student_id: STUDENT_ID, comment: '<script>window.__xss=1</script>', tutor: null }),
    ];
    const st = {
      user: u,
      profile: profileRow(STUDENT_ID),
      written,
      onPatch: (call) => {
        const id = Number(call.params.get('id').slice(3));
        const r = st.written.find((x) => x.id === id);
        Object.assign(r, call.body, { updated_at: new Date().toISOString() });
        const { tutor, ...row } = r;
        return [[row]];
      },
      onDelete: (call) => {
        const id = Number(call.params.get('id').slice(3));
        st.written = st.written.filter((x) => x.id !== id);
        return [[{ id }]];
      },
    };
    const calls = await mockSupabase(page, st);
    await page.goto('/professores/painel.html#avaliacoes');

    const panel = page.locator('#panel-avaliacoes');
    await expect(panel.getByRole('heading', { name: 'Minhas avaliações' })).toBeVisible();
    const items = panel.locator('.pf-rv-list > li');
    await expect(items).toHaveCount(3);

    const q = reviewCalls(calls).find((c) => c.params.get('student_id'));
    expect(q.params.get('student_id')).toBe(`eq.${STUDENT_ID}`);
    expect(q.params.get('select')).toContain('tutor:tutor_profiles(slug,profile:profiles!user_id(full_name,avatar_path))');
    expect(q.params.get('order')).toMatch(/^created_at\.desc/);

    // Publicada: link para o perfil + editar/excluir
    await expect(items.nth(0).getByRole('link', { name: 'Ana Silva' })).toHaveAttribute('href', '/professores/p/ana-silva');
    await expect(items.nth(0).locator('.pf-rv-text')).toHaveText('Excelente!\nRecomendo.');
    await expect(items.nth(0).getByRole('button', { name: 'Editar avaliação de Ana Silva' })).toBeVisible();
    await expect(items.nth(0).getByRole('button', { name: 'Excluir avaliação de Ana Silva' })).toBeVisible();
    // Oculta: selo, sem botões
    await expect(items.nth(1).getByText('Oculta pela moderação')).toBeVisible();
    await expect(items.nth(1).getByRole('button')).toHaveCount(0);
    // Professor fora do ar (embed null): sem link, ainda pode excluir
    await expect(items.nth(2)).toContainText('Professor indisponível');
    await expect(items.nth(2).getByRole('link')).toHaveCount(0);
    await expect(items.nth(2).locator('.pf-rv-text')).toHaveText('<script>window.__xss=1</script>');

    // Editar inline
    await items.nth(0).getByRole('button', { name: 'Editar avaliação de Ana Silva' }).click();
    const form = items.nth(0).locator('form');
    await expect(items.nth(0).getByRole('heading', { name: 'Editar avaliação de Ana Silva' })).toBeVisible();
    await expect(form.getByRole('radio', { name: '5 estrelas: Excelente' })).toBeFocused();
    await form.getByRole('radio', { name: '3 estrelas: Bom' }).check();
    await form.getByLabel('Comentário (opcional)').fill('Boa.');
    await form.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(items.nth(0).locator('.pf-rv-text')).toHaveText('Boa.');
    await expect(items.nth(0).getByRole('img', { name: 'Nota 3,0 de 5' })).toBeVisible();
    await expect(items.nth(0).getByRole('link', { name: 'Ana Silva' })).toBeVisible(); // embed mantido
    const patch = reviewCalls(calls, 'PATCH')[0];
    expect(patch.body).toEqual({ rating: 3, comment: 'Boa.' });
    expect(patch.params.get('id')).toBe('eq.10');

    // Excluir
    await items.nth(2).getByRole('button', { name: 'Excluir avaliação de Professor indisponível' }).click();
    const dlg = page.getByRole('dialog', { name: 'Excluir avaliação?' });
    await dlg.getByRole('button', { name: 'Excluir avaliação' }).click();
    await expect(items).toHaveCount(2);
    expect(reviewCalls(calls, 'DELETE')[0].params.get('id')).toBe('eq.8');
    await expect(panel.getByRole('heading', { name: 'Minhas avaliações' })).toBeFocused();

    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('aluno sem avaliações vê estado vazio com "Buscar professores"', async ({ page }) => {
    const u = user(STUDENT_ID);
    await seedSession(page, u);
    await mockSupabase(page, { user: u, profile: profileRow(STUDENT_ID), written: [] });
    await page.goto('/professores/painel.html#avaliacoes');
    const panel = page.locator('#panel-avaliacoes');
    await expect(panel).toContainText('Você ainda não avaliou nenhum professor.');
    await expect(panel.getByRole('link', { name: 'Buscar professores' })).toHaveAttribute('href', '/professores/');
  });

  test('aluno com conta suspensa não edita nem exclui', async ({ page }) => {
    const u = user(STUDENT_ID);
    await seedSession(page, u);
    await mockSupabase(page, {
      user: u,
      profile: profileRow(STUDENT_ID, { banned_at: '2026-09-01T00:00:00Z' }),
      written: [review(10, 5, { student_id: STUDENT_ID, tutor: { slug: 'ana-silva', profile: { full_name: 'Ana Silva' } } })],
    });
    await page.goto('/professores/painel.html#avaliacoes');
    const panel = page.locator('#panel-avaliacoes');
    await expect(panel.locator('.pf-rv-list > li')).toHaveCount(1);
    await expect(panel.locator('.pf-rv-banned')).toContainText('Sua conta está suspensa');
    await expect(panel.locator('.pf-rv-list').getByRole('button')).toHaveCount(0);
  });

  test('professor: avaliações recebidas (só leitura, com denunciar) e resumo', async ({ page }) => {
    const u = user(TUTOR_ID, 'ana@exemplo.test');
    await seedSession(page, u);
    const tutorRow = {
      user_id: TUTOR_ID, slug: 'ana-silva', headline: 'Professora', bio: '', hourly_rate_cents: 8000,
      mode_online: true, mode_presencial: false, uf: null, city_ibge: null, city_name: null,
      published: true, suspended: false, plan: 'basico', plan_expires_at: null, rating_avg: 4.5, rating_count: 2,
      last_active_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    };
    const calls = await mockSupabase(page, {
      user: u,
      profile: profileRow(TUTOR_ID, { role: 'tutor', tutor: tutorRow }),
      published: [review(2, 5, { reviewer_name: 'Bruno C.' }), review(1, 4, { reviewer_name: 'Carla D.' })],
      written: [],
    });
    await page.goto('/professores/painel.html#avaliacoes');

    const panel = page.locator('#panel-avaliacoes');
    await expect(panel.getByRole('heading', { name: 'Avaliações recebidas' })).toBeVisible();
    const items = panel.locator('.pf-rv-list > li');
    await expect(items).toHaveCount(2);
    await expect(panel.locator('.pf-rv-avg')).toHaveText('4,5');
    await expect(panel.locator('.pf-rv-total')).toHaveText('2 avaliações');
    await expect(items.nth(0)).toContainText('Bruno C.');
    await expect(items.nth(0).locator('.pf-rv-foot')).toContainText('Denunciar');
    await expect(panel.getByRole('button', { name: /Editar|Excluir/ })).toHaveCount(0);
    await expect(panel.getByRole('link', { name: 'Ver as avaliações no meu perfil público' }))
      .toHaveAttribute('href', '/professores/p/ana-silva#avaliacoes');

    // Recebidas: do próprio professor, publicadas
    const q = listCalls(calls)[0];
    expect(q.params.get('tutor_id')).toBe(`eq.${TUTOR_ID}`);
    expect(q.params.get('status')).toBe('eq.published');
    // Não escreveu nenhuma: seção "que você escreveu" não aparece
    await expect.poll(() => reviewCalls(calls).filter((c) => c.params.get('student_id')).length).toBe(1);
    await expect(panel.getByRole('heading', { name: 'Avaliações que você escreveu' })).toBeHidden();
  });

  test('professor que avaliou outro professor vê também as que escreveu', async ({ page }) => {
    const u = user(TUTOR_ID, 'ana@exemplo.test');
    await seedSession(page, u);
    await mockSupabase(page, {
      user: u,
      profile: profileRow(TUTOR_ID, { role: 'tutor', tutor: { user_id: TUTOR_ID, slug: 'ana-silva', published: false, suspended: false, rating_avg: 0, rating_count: 0 } }),
      published: [],
      written: [review(5, 4, { student_id: TUTOR_ID, tutor_id: OTHER_ID, tutor: { slug: 'carlos-souza', profile: { full_name: 'Carlos Souza' } } })],
    });
    await page.goto('/professores/painel.html#avaliacoes');
    const panel = page.locator('#panel-avaliacoes');
    await expect(panel.locator('.pf-rv-empty')).toContainText('Você ainda não recebeu avaliações.');
    // Anúncio não publicado: sem link para o perfil público
    await expect(panel.getByRole('link', { name: 'Ver as avaliações no meu perfil público' })).toHaveCount(0);
    await expect(panel.getByRole('heading', { name: 'Avaliações que você escreveu' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Carlos Souza' })).toHaveAttribute('href', '/professores/p/carlos-souza');
  });
});
