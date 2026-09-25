// Mensagens internas (/professores/mensagens.html) e botão de contato do perfil.
// Supabase falso em http://supabase.test: REST/RPC num "banco" em memória + Realtime (WebSocket) simulado.
import { test, expect } from '@playwright/test';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const json = (body, status = 200, headers = {}) => ({
  status, contentType: 'application/json', headers: { ...CORS, ...headers }, body: body === undefined ? '' : JSON.stringify(body),
});

const AUTH_KEY = 'sb-supabase-auth-token'; // 'sb-' + 'supabase' (1º rótulo do host) + '-auth-token'
const ME = 'aaaaaaaa-1111-4111-8111-111111111111';
const TUTOR_ID = '11111111-1111-4111-8111-111111111111';
const TUTOR2_ID = '22222222-2222-4222-8222-222222222222';
const CONV1 = 'c0000000-0000-4000-8000-000000000001';
const CONV2 = 'c0000000-0000-4000-8000-000000000002';
const NEW_CONV = 'c0000000-0000-4000-8000-0000000000ff';
const XSS = '<img src=x onerror=window.__xss=1>';

// "Hoje" e "ontem" no fuso do navegador dos testes (America/Sao_Paulo, sem horário de verão)
function spDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const noon = new Date(`${parts}T12:00:00-03:00`);
  return new Date(noon.getTime() + offsetDays * 86_400_000);
}
const YESTERDAY = spDate(-1).toISOString();
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

function msg(id, conv, sender, body, created_at) {
  return { id, conversation_id: conv, sender_id: sender, body, created_at };
}

function defaultConvs() {
  return [
    {
      id: CONV1, other_id: TUTOR_ID, other_name: 'Ana Silva', other_avatar: null, other_slug: 'ana-silva', i_am: 'student',
      last_message_at: minutesAgo(3), last_body: 'Posso sim! Que tal terça às 19h?', unread: true,
    },
    {
      id: CONV2, other_id: TUTOR2_ID, other_name: XSS, other_avatar: null, other_slug: 'bruno-costa', i_am: 'student',
      last_message_at: YESTERDAY, last_body: `Obrigado! ${XSS}`, unread: false,
    },
  ];
}

function defaultMessages() {
  return [
    msg(1, CONV1, ME, 'Olá, Ana! Preciso de aulas de matemática para o ENEM.', YESTERDAY),
    msg(2, CONV1, TUTOR_ID, `Oi! Claro.\nQual o seu nível hoje? ${XSS}`, new Date(new Date(YESTERDAY).getTime() + 3600e3).toISOString()),
    msg(3, CONV1, TUTOR_ID, 'Posso sim! Que tal terça às 19h?', minutesAgo(3)),
    msg(10, CONV2, TUTOR2_ID, `Obrigado! ${XSS}`, YESTERDAY),
  ];
}

const MSG_COLUMNS = [
  { name: 'id', type: 'int8' }, { name: 'conversation_id', type: 'uuid' }, { name: 'sender_id', type: 'uuid' },
  { name: 'body', type: 'text' }, { name: 'created_at', type: 'timestamptz' },
];

/**
 * Supabase falso. Retorna { reqs, db, rt }.
 * - db.messages: "tabela" em memória (GET filtra por conversation_id/id/order/limit; POST insere)
 * - rt.push(record): envia um INSERT pelo canal Realtime da conversa
 * realtime: 'ok' (canal SUBSCRIBED) | 'silent' (nunca responde o join -> polling)
 */
async function mockSupabase(page, opts = {}) {
  const {
    user = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'maria@exemplo.test' },
    profile = { id: ME, full_name: 'Maria Souza', role: 'student', is_admin: false, avatar_path: null, banned_at: null, tutor_profiles: null },
    convs = defaultConvs(),
    messages = defaultMessages(),
    realtime = 'ok',
    onInsert = null, // (body) => resposta de route.fulfill (erro)
    onStart = null, // (body) => resposta de start_conversation
    tutor = null, // linha de tutor_profiles (perfil)
    existingConv = null,
  } = opts;
  const db = { messages: messages.map((m) => ({ ...m })), nextId: 100 };
  const reqs = { messagesGet: [], inserts: [], rpc: [], all: [] };

  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'supabase.test') {
      return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css', body: '' });
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    reqs.all.push(`${req.method()} ${url.pathname}${url.search}`);
    const p = url.pathname;

    if (p === '/auth/v1/user') return route.fulfill(user ? json(user) : json({ message: 'no session' }, 401));
    if (p === '/rest/v1/profiles') return route.fulfill(json(profile ? [profile] : []));

    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.slice('/rest/v1/rpc/'.length);
      const body = req.postData() ? JSON.parse(req.postData()) : {};
      reqs.rpc.push({ fn, body });
      if (fn === 'list_conversations') return route.fulfill(json(convs));
      if (fn === 'unread_count') return route.fulfill(json(convs.filter((c) => c.unread).length));
      if (fn === 'mark_read') return route.fulfill({ status: 204, headers: CORS, body: '' });
      if (fn === 'start_conversation') return route.fulfill(onStart ? await onStart(body) : json(NEW_CONV));
      return route.fulfill(json(null));
    }

    if (p === '/rest/v1/messages' && req.method() === 'GET') {
      reqs.messagesGet.push(url);
      const conv = (url.searchParams.get('conversation_id') || '').replace(/^eq\./, '');
      let rows = db.messages.filter((m) => m.conversation_id === conv);
      for (const f of url.searchParams.getAll('id')) {
        const [op, v] = f.split('.');
        if (op === 'lt') rows = rows.filter((m) => m.id < Number(v));
        if (op === 'gt') rows = rows.filter((m) => m.id > Number(v));
      }
      rows.sort((a, b) => a.id - b.id);
      if (url.searchParams.get('order') === 'id.desc') rows.reverse();
      const limit = Number(url.searchParams.get('limit') || 1000);
      return route.fulfill(json(rows.slice(0, limit)));
    }
    if (p === '/rest/v1/messages' && req.method() === 'POST') {
      const body = JSON.parse(req.postData());
      reqs.inserts.push({ body, url, headers: req.headers() });
      if (onInsert) {
        const res = await onInsert(body);
        if (res) return route.fulfill(res);
      }
      const row = msg(db.nextId++, body.conversation_id, ME, body.body, new Date().toISOString());
      db.messages.push(row);
      const wantsObject = (req.headers().accept || '').includes('vnd.pgrst.object');
      return route.fulfill(json(wantsObject ? row : [row], 201));
    }
    if (p === '/rest/v1/tutor_profiles') {
      const slug = url.searchParams.get('slug');
      return route.fulfill(json(tutor && slug === `eq.${tutor.slug}` ? [tutor] : []));
    }
    if (p === '/rest/v1/conversations') return route.fulfill(json(existingConv ? [{ id: existingConv }] : []));
    if (p.startsWith('/rest/v1/')) return route.fulfill(json([], 200, { 'content-range': '*/0' }));
    return route.fulfill(json({}));
  });

  // Realtime (protocolo Phoenix, vsn 2.0.0: [join_ref, ref, topic, event, payload])
  const rt = { joins: [], sockets: [], push: null };
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    rt.sockets.push(ws);
    const topics = new Map(); // topic -> ids dos bindings
    ws.onMessage((raw) => {
      let parsed;
      try { parsed = JSON.parse(String(raw)); } catch { return; }
      const [joinRef, ref, topic, event, payload] = Array.isArray(parsed)
        ? parsed : [parsed.join_ref, parsed.ref, parsed.topic, parsed.event, parsed.payload];
      const reply = (response = {}) => ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]));
      if (event === 'heartbeat') return reply();
      if (event === 'phx_leave') {
        topics.delete(topic);
        return reply();
      }
      if (event === 'phx_join') {
        const changes = payload?.config?.postgres_changes || [];
        rt.joins.push({ topic, changes, access_token: payload?.access_token });
        if (realtime !== 'ok') return undefined;
        const withIds = changes.map((c, i) => ({ ...c, id: 5000 + i }));
        topics.set(topic, { joinRef, ids: withIds.map((c) => c.id) });
        return reply({ postgres_changes: withIds });
      }
      return undefined;
    });
    rt.push = (record) => {
      for (const [topic, { ids }] of topics) {
        ws.send(JSON.stringify([null, null, topic, 'postgres_changes', {
          ids,
          data: { type: 'INSERT', schema: 'public', table: 'messages', commit_timestamp: record.created_at, columns: MSG_COLUMNS, record, errors: null },
        }]));
      }
    };
  });
  return { reqs, db, rt };
}

async function seedSession(page, user = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'maria@exemplo.test' }) {
  await page.addInitScript(([key, u]) => {
    localStorage.setItem(key, JSON.stringify({
      access_token: 'FAKE.JWT.TOKEN', refresh_token: 'fakerefresh', token_type: 'bearer',
      expires_in: 3600, expires_at: 4102444800, user: u,
    }));
  }, [AUTH_KEY, user]);
}

function trackErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

const thread = (page) => page.locator('.pf-thread');
const bubbles = (page) => page.locator('#bubbles');

// ---------------------------------------------------------------------------

test('sem login: redireciona para entrar.html com next (inclui ?c=)', async ({ page }) => {
  await mockSupabase(page, { user: null });
  await page.goto(`/professores/mensagens.html?c=${CONV1}`);
  await page.waitForURL(/\/professores\/entrar\.html/);
  expect(new URL(page.url()).searchParams.get('next')).toBe(`/professores/mensagens.html?c=${CONV1}`);
});

test('lista as conversas (nome, prévia, horário, não lida) sem executar HTML', async ({ page }) => {
  const errors = trackErrors(page);
  await seedSession(page);
  const { reqs } = await mockSupabase(page);
  await page.goto('/professores/mensagens.html');

  const items = page.locator('#convList a.pf-conv-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Ana Silva');
  await expect(items.nth(0)).toContainText('Posso sim! Que tal terça às 19h?');
  await expect(items.nth(0)).toHaveClass(/is-unread/);
  await expect(items.nth(0).locator('.pf-conv-dot')).toContainText('Não lida');
  await expect(items.nth(0)).toHaveAttribute('href', `/professores/mensagens.html?c=${CONV1}`);
  await expect(items.nth(0).locator('time')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(items.nth(1)).toContainText('Ontem');
  await expect(items.nth(1)).not.toHaveClass(/is-unread/);
  // Nome e prévia com HTML aparecem como texto
  await expect(items.nth(1).locator('.pf-conv-name')).toHaveText(XSS);
  await expect(items.nth(1).locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  // Contador de não lidas na lista + aviso de segurança + painel vazio no desktop
  await expect(page.locator('.pf-conv-pane-head .pf-count')).toHaveText('1');
  await expect(page.locator('.pf-msg-safety')).toContainText('nunca pague fora');
  await expect(page.locator('.pf-msg-safety')).toContainText('não compartilhe dados sensíveis');
  await expect(thread(page)).toContainText('Selecione uma conversa');
  expect(reqs.rpc.some((r) => r.fn === 'list_conversations')).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('sem conversas: estado vazio com link para a busca', async ({ page }) => {
  await seedSession(page);
  await mockSupabase(page, { convs: [] });
  await page.goto('/professores/mensagens.html');
  const empty = page.locator('.pf-conv-pane .pf-empty');
  await expect(empty).toContainText('Você ainda não tem conversas');
  await expect(empty.getByRole('link', { name: 'Buscar professores' })).toHaveAttribute('href', '/professores/');
});

test('erro ao listar: mensagem e "Tentar de novo"', async ({ page }) => {
  await seedSession(page);
  let fail = true;
  await mockSupabase(page);
  await page.route('http://supabase.test/rest/v1/rpc/list_conversations', (route) => route.fulfill(fail
    ? json({ code: 'XX000', message: 'boom' }, 500)
    : json(defaultConvs())));
  await page.goto('/professores/mensagens.html');
  const alert = page.locator('.pf-conv-error');
  await expect(alert).toContainText('Não foi possível carregar suas conversas.');
  fail = false;
  await alert.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(page.locator('#convList a.pf-conv-item')).toHaveCount(2);
});

test('?c= abre a conversa: mensagens, separadores de dia, cabeçalho, denúncia e mark_read', async ({ page }) => {
  const errors = trackErrors(page);
  await seedSession(page);
  const { reqs, rt } = await mockSupabase(page);
  await page.goto(`/professores/mensagens.html?c=${CONV1}`);

  const box = bubbles(page);
  await expect(box.locator('.pf-msg')).toHaveCount(3);
  await expect(box.locator('.pf-msg--me')).toHaveCount(1);
  await expect(box.locator('.pf-msg--them')).toHaveCount(2);
  await expect(box.locator('.pf-msg--me')).toContainText('Olá, Ana!');
  // quebra de linha preservada e HTML como texto
  const second = box.locator('.pf-msg[data-id="2"] .pf-msg-body');
  await expect(second).toHaveText(`Oi! Claro.\nQual o seu nível hoje? ${XSS}`);
  await expect(box.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  // separadores de dia e início da conversa
  await expect(box.locator('.pf-day-sep')).toHaveText(['Ontem', 'Hoje']);
  await expect(box.locator('.pf-thread-start')).toHaveText('Início da conversa');
  await expect(box.locator('.pf-bubble-time time').first()).toHaveText(/^\d{2}:\d{2}$/);
  // Denunciar só nas mensagens recebidas
  await expect(box.locator('.pf-msg--them').getByRole('button', { name: 'Denunciar' })).toHaveCount(2);
  await expect(box.locator('.pf-msg--me').getByRole('button', { name: 'Denunciar' })).toHaveCount(0);

  // Cabeçalho: nome com link para o perfil do professor
  await expect(page.locator('#threadTitle')).toHaveText('Ana Silva');
  await expect(page.locator('#threadTitle a')).toHaveAttribute('href', '/professores/p/ana-silva');
  await expect(page.locator('.pf-conv-item[aria-current="true"]')).toContainText('Ana Silva');

  // Consulta: últimas 50 por id desc, só da conversa
  const q = reqs.messagesGet[0].searchParams;
  expect(q.get('conversation_id')).toBe(`eq.${CONV1}`);
  expect(q.get('order')).toBe('id.desc');
  expect(q.get('limit')).toBe('50');

  // Marcada como lida
  await expect.poll(() => reqs.rpc.filter((r) => r.fn === 'mark_read').map((r) => r.body)).toContainEqual({ p_conv: CONV1 });
  await expect(page.locator('#convList a.pf-conv-item').first()).not.toHaveClass(/is-unread/);

  // Canal Realtime com filtro da conversa
  await expect.poll(() => rt.joins.length).toBeGreaterThan(0);
  expect(rt.joins[0].changes).toEqual([{ event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${CONV1}` }]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('conversa com aluno: sem link de perfil e nome do aluno abreviado', async ({ page }) => {
  await seedSession(page);
  // Mesmo que o banco devolva o nome completo, o professor vê "Pedro S." (cadastro e privacidade prometem isso)
  const convs = [{
    id: CONV1, other_id: ME, other_name: 'Pedro Aluno  Souza', other_avatar: null, other_slug: null, i_am: 'tutor',
    last_message_at: minutesAgo(3), last_body: 'Oi', unread: false,
  }];
  await mockSupabase(page, { convs, profile: { id: TUTOR_ID, full_name: 'Ana Silva', role: 'tutor', is_admin: false, avatar_path: null, banned_at: null, tutor_profiles: null } });
  await page.goto(`/professores/mensagens.html?c=${CONV1}`);
  await expect(page.locator('#threadTitle')).toHaveText('Pedro S.');
  await expect(page.locator('#convList .pf-conv-name')).toHaveText('Pedro S.');
  await expect(page.locator('#bubbles')).toHaveAttribute('aria-label', 'Mensagens com Pedro S.');
  await expect(page.locator('main')).not.toContainText('Souza');
  await expect(page.locator('#threadTitle a')).toHaveCount(0);
  await expect(page.locator('.pf-thread-sub')).toHaveText('Aluno');
});

test('?c= desconhecida mostra "Conversa não encontrada"', async ({ page }) => {
  await seedSession(page);
  await mockSupabase(page);
  await page.goto('/professores/mensagens.html?c=c0000000-0000-4000-8000-00000000dead');
  await expect(thread(page)).toContainText('Conversa não encontrada');
});

test('enviar: Enter envia só {conversation_id, body}; Shift+Enter quebra linha; sem duplicar', async ({ page }) => {
  const errors = trackErrors(page);
  await seedSession(page);
  const { reqs, rt, db } = await mockSupabase(page);
  await page.goto(`/professores/mensagens.html?c=${CONV1}`);
  await expect(bubbles(page).locator('.pf-msg')).toHaveCount(3);
  await expect.poll(() => rt.joins.length).toBeGreaterThan(0);

  const input = page.getByLabel('Mensagem para Ana Silva');
  await input.click();
  await input.pressSequentially('Linha 1');
  await input.press('Shift+Enter');
  await input.pressSequentially('Linha 2');
  await expect(input).toHaveValue('Linha 1\nLinha 2');
  expect(reqs.inserts).toHaveLength(0);

  await input.press('Enter');
  await expect.poll(() => reqs.inserts.length).toBe(1);
  expect(reqs.inserts[0].body).toEqual({ conversation_id: CONV1, body: 'Linha 1\nLinha 2' });
  expect(Object.keys(reqs.inserts[0].body).sort()).toEqual(['body', 'conversation_id']);
  await expect(input).toHaveValue('');

  const mine = bubbles(page).locator('.pf-msg--me');
  await expect(mine).toHaveCount(2);
  await expect(mine.last()).toHaveAttribute('data-id', '100');
  await expect(mine.last().locator('.pf-msg-body')).toHaveText('Linha 1\nLinha 2');
  await expect(mine.last()).not.toHaveClass(/is-pending/);

  // O mesmo registro chegando pelo Realtime não duplica
  rt.push(db.messages.find((m) => m.id === 100));
  await page.waitForTimeout(300);
  await expect(mine).toHaveCount(2);
  // Prévia da lista atualizada
  await expect(page.locator('#convList a.pf-conv-item').first().locator('.pf-conv-last')).toHaveText('Linha 1 Linha 2');

  // Botão "Enviar" também funciona; vazio não envia
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.locator('.pf-composer-status')).toHaveText('Escreva uma mensagem antes de enviar.');
  expect(reqs.inserts).toHaveLength(1);
  await input.fill('Combinado!');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(mine).toHaveCount(3);
  expect(reqs.inserts[1].body).toEqual({ conversation_id: CONV1, body: 'Combinado!' });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Realtime: mensagem recebida aparece, marca como lida e não duplica', async ({ page }) => {
  await seedSession(page);
  const { reqs, rt } = await mockSupabase(page);
  await page.goto(`/professores/mensagens.html?c=${CONV1}`);
  await expect(bubbles(page).locator('.pf-msg')).toHaveCount(3);
  await expect.poll(() => rt.joins.length).toBeGreaterThan(0);
  // espera o canal ficar pronto (catch-up após SUBSCRIBED)
  await expect.poll(() => reqs.messagesGet.some((u) => u.searchParams.get('id') === 'gt.3')).toBe(true);
  const markBefore = reqs.rpc.filter((r) => r.fn === 'mark_read').length;

  const incoming = msg(4, CONV1, TUTOR_ID, 'Mensagem nova em tempo real', new Date().toISOString());
  rt.push(incoming);
  await expect(bubbles(page).locator('.pf-msg[data-id="4"]')).toContainText('Mensagem nova em tempo real');
  await expect(bubbles(page).locator('.pf-msg[data-id="4"]')).toHaveClass(/pf-msg--them/);
  rt.push(incoming);
  await page.waitForTimeout(300);
  await expect(bubbles(page).locator('.pf-msg[data-id="4"]')).toHaveCount(1);
  await expect.poll(() => reqs.rpc.filter((r) => r.fn === 'mark_read').length).toBeGreaterThan(markBefore);
  // Anúncio para leitores de tela
  await expect(page.locator('.pf-sr-only[aria-live="polite"]').last()).toContainText('Nova mensagem de Ana Silva');
});

test('sem Realtime: após 5 s busca novas mensagens a cada 10 s (id > último)', async ({ page }) => {
  await page.clock.install();
  await seedSession(page);
  const { reqs, db } = await mockSupabase(page, { realtime: 'silent' });
  await page.goto(`/professores/mensagens.html?c=${CONV1}`);
  await expect(bubbles(page).locator('.pf-msg')).toHaveCount(3);

  db.messages.push(msg(7, CONV1, TUTOR_ID, 'Chegou pelo polling', new Date().toISOString()));
  await page.clock.fastForward(5_500);
  await page.clock.fastForward(10_500);
  await expect(bubbles(page).locator('.pf-msg[data-id="7"]')).toContainText('Chegou pelo polling');
  const poll = reqs.messagesGet.find((u) => u.searchParams.get('id') === 'gt.3');
  expect(poll.searchParams.get('conversation_id')).toBe(`eq.${CONV1}`);
  expect(poll.searchParams.get('order')).toBe('id.asc');
});

test('"Carregar anteriores" busca a página anterior (id < mais antigo) e mantém a ordem', async ({ page }) => {
  await seedSession(page);
  const many = Array.from({ length: 60 }, (_, i) => msg(i + 1, CONV1, i % 2 ? ME : TUTOR_ID, `Mensagem ${i + 1}`, minutesAgo(120 - i)));
  const { reqs } = await mockSupabase(page, { messages: many });
  await page.goto(`/professores/mensagens.html?c=${CONV1}`);
  const box = bubbles(page);
  await expect(box.locator('.pf-msg')).toHaveCount(50);
  await expect(box.locator('.pf-msg').first()).toHaveAttribute('data-id', '11');

  await box.getByRole('button', { name: 'Carregar anteriores' }).click();
  await expect(box.locator('.pf-msg')).toHaveCount(60);
  await expect(box.locator('.pf-msg').first()).toHaveAttribute('data-id', '1');
  await expect(box.locator('.pf-msg').last()).toHaveAttribute('data-id', '60');
  await expect(box.getByRole('button', { name: 'Carregar anteriores' })).toHaveCount(0);
  await expect(box.locator('.pf-thread-start')).toBeVisible();
  const older = reqs.messagesGet.find((u) => u.searchParams.get('id') === 'lt.11');
  expect(older.searchParams.get('order')).toBe('id.desc');
});

test('erro no envio: remove a bolha, devolve o texto e mostra o motivo', async ({ page }) => {
  await seedSession(page);
  await mockSupabase(page, {
    onInsert: () => json({ code: 'P0001', message: 'Limite atingido, tente mais tarde', details: null, hint: null }, 400),
  });
  await page.goto(`/professores/mensagens.html?c=${CONV1}`);
  await expect(bubbles(page).locator('.pf-msg')).toHaveCount(3);
  const input = page.getByLabel('Mensagem para Ana Silva');
  await input.fill('Oi de novo');
  await input.press('Enter');
  await expect(page.locator('.pf-composer-status')).toHaveText('Não enviada: Limite atingido, tente mais tarde');
  await expect(page.getByRole('alert').filter({ hasText: 'Não enviada' })).toBeVisible();
  await expect(input).toHaveValue('Oi de novo');
  await expect(bubbles(page).locator('.pf-msg')).toHaveCount(3);
});

test('trocar de conversa pela lista atualiza a URL e troca o canal', async ({ page }) => {
  await seedSession(page);
  const { rt } = await mockSupabase(page);
  await page.goto(`/professores/mensagens.html?c=${CONV1}`);
  await expect(bubbles(page).locator('.pf-msg')).toHaveCount(3);
  await page.locator('#convList a.pf-conv-item').nth(1).click();
  await expect(page).toHaveURL(new RegExp(`\\?c=${CONV2}$`));
  await expect(bubbles(page).locator('.pf-msg')).toHaveCount(1);
  await expect(page.locator('#threadTitle')).toHaveText(XSS);
  await expect(page.locator('#threadTitle')).toBeFocused();
  await expect.poll(() => rt.joins.map((j) => j.changes[0]?.filter)).toContain(`conversation_id=eq.${CONV2}`);
  // Voltar do navegador reabre a anterior, com um canal novo (e o tempo real segue funcionando)
  await page.goBack();
  await expect(page.locator('#threadTitle')).toHaveText('Ana Silva');
  await expect(bubbles(page).locator('.pf-msg')).toHaveCount(3);
  await expect.poll(() => rt.joins.filter((j) => j.changes[0]?.filter === `conversation_id=eq.${CONV1}`).length).toBe(2);
  const topics = rt.joins.map((j) => j.topic);
  expect(new Set(topics).size).toBe(topics.length);
  await page.waitForTimeout(200);
  rt.push(msg(5, CONV1, TUTOR_ID, 'De volta em tempo real', new Date().toISOString()));
  await expect(bubbles(page).locator('.pf-msg[data-id="5"]')).toContainText('De volta em tempo real');
});

test('conta suspensa: envio desativado', async ({ page }) => {
  await seedSession(page);
  await mockSupabase(page, { profile: { id: ME, full_name: 'Maria Souza', role: 'student', is_admin: false, avatar_path: null, banned_at: '2026-09-01T00:00:00Z', tutor_profiles: null } });
  await page.goto(`/professores/mensagens.html?c=${CONV1}`);
  await expect(page.getByLabel('Mensagem para Ana Silva')).toBeDisabled();
  await expect(page.locator('.pf-composer-hint')).toContainText('Sua conta está suspensa');
});

test.describe('celular (360px)', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: false });

  async function noOverflow(page) {
    const wide = await page.evaluate(() => [...document.querySelectorAll('main *')]
      .filter((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1;
      })
      .map((n) => `${n.tagName.toLowerCase()}.${n.className}`));
    expect(wide, wide.join('\n')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }

  test('um painel por vez com botão de voltar', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page);
    await page.goto('/professores/mensagens.html');
    const list = page.locator('#convList');
    await expect(list.locator('a.pf-conv-item')).toHaveCount(2);
    await expect(thread(page)).toBeHidden();
    await noOverflow(page);

    await list.locator('a.pf-conv-item').first().click();
    await expect(page).toHaveURL(new RegExp(`\\?c=${CONV1}$`));
    await expect(bubbles(page).locator('.pf-msg')).toHaveCount(3);
    await expect(list).toBeHidden();
    const back = page.getByRole('button', { name: 'Voltar para a lista de conversas' });
    await expect(back).toBeVisible();
    await expect(page.getByLabel('Mensagem para Ana Silva')).toBeVisible();
    await noOverflow(page);

    await back.click();
    await expect(list).toBeVisible();
    await expect(thread(page)).toBeHidden();
    await expect(page).toHaveURL(/mensagens\.html$/);
    await expect(list.locator('a.pf-conv-item').first()).toBeFocused();
  });

  test('entrando direto com ?c=, voltar mostra a lista', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page);
    await page.goto(`/professores/mensagens.html?c=${CONV1}`);
    await expect(bubbles(page).locator('.pf-msg')).toHaveCount(3);
    await expect(page.locator('#convList')).toBeHidden();
    await page.getByRole('button', { name: 'Voltar para a lista de conversas' }).click();
    await expect(page.locator('#convList')).toBeVisible();
    await expect(page).toHaveURL(/mensagens\.html$/);
  });
});

// ---------- Botão de contato (components/contact.js, montado pelo perfil) ----------

function makeTutor(extra = {}) {
  return {
    user_id: TUTOR_ID,
    slug: 'ana-silva',
    headline: 'Professora de Matemática e Física para o ENEM',
    bio: 'Aulas com muitos exercícios.',
    hourly_rate_cents: 8000,
    mode_online: true,
    mode_presencial: false,
    uf: 'SP',
    city_name: 'São Paulo',
    published: true,
    suspended: false,
    plan: 'basico',
    plan_expires_at: null,
    rating_avg: 0,
    rating_count: 0,
    last_active_at: null,
    created_at: '2026-01-10T12:00:00Z',
    profiles: { full_name: 'Ana Silva', avatar_path: null },
    tutor_subjects: [
      { levels: ['medio'], subjects: { id: 2, name: 'Matemática', slug: 'matematica' } },
      { levels: [], subjects: { id: 1, name: 'Física', slug: 'fisica' } },
    ],
    ...extra,
  };
}

test.describe('botão "Enviar mensagem" no perfil', () => {
  const contact = (page) => page.locator('#perfilContato');

  test('sem login: leva para entrar.html e volta com #mensagem', async ({ page }) => {
    await mockSupabase(page, { user: null, tutor: makeTutor() });
    await page.goto('/professores/p/ana-silva');
    await expect(contact(page)).toContainText('Resposta pelo site; seu contato não é exposto');
    await contact(page).getByRole('button', { name: 'Enviar mensagem' }).click();
    await page.waitForURL(/\/professores\/entrar\.html/);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/professores/p/ana-silva#mensagem');
  });

  test('logado: modal valida, chama start_conversation e abre a conversa', async ({ page }) => {
    await seedSession(page);
    const { reqs } = await mockSupabase(page, { tutor: makeTutor() });
    await page.goto('/professores/p/ana-silva');
    await contact(page).getByRole('button', { name: 'Enviar mensagem' }).click();

    const dlg = page.locator('dialog.pf-modal[open]');
    await expect(dlg.getByRole('heading', { name: 'Mensagem para Ana Silva' })).toBeVisible();
    const text = dlg.getByLabel('Sua mensagem');
    await expect(text).toBeFocused();
    await expect(dlg.getByLabel('Matéria (opcional)').locator('option')).toHaveText(['Não sei / várias', 'Física', 'Matemática']);
    await expect(dlg).toContainText('Resposta pelo site; seu contato não é exposto.');

    // curta demais
    await text.fill('Oi');
    await expect(dlg.locator('.pf-counter')).toHaveText('2/4000');
    await dlg.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(dlg.getByRole('alert')).toContainText('pelo menos 10 caracteres');
    expect(reqs.rpc.filter((r) => r.fn === 'start_conversation')).toHaveLength(0);

    await text.fill('  Olá! Preciso de aulas de matemática para o ENEM.  ');
    await dlg.getByLabel('Matéria (opcional)').selectOption({ label: 'Matemática' });
    await dlg.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.waitForURL(`**/professores/mensagens.html?c=${NEW_CONV}`);
    const call = reqs.rpc.find((r) => r.fn === 'start_conversation');
    expect(call.body).toEqual({ p_tutor: TUTOR_ID, p_body: 'Olá! Preciso de aulas de matemática para o ENEM.', p_subject: 2 });
  });

  test('erro do banco (limite diário) aparece no modal e mantém o texto', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, {
      tutor: makeTutor(),
      onStart: () => json({ code: 'P0001', message: 'Você atingiu o limite de 10 novos contatos por dia. Tente amanhã.', details: null, hint: null }, 400),
    });
    await page.goto('/professores/p/ana-silva');
    await contact(page).getByRole('button', { name: 'Enviar mensagem' }).click();
    const dlg = page.locator('dialog.pf-modal[open]');
    await dlg.getByLabel('Sua mensagem').fill('Olá! Gostaria de marcar uma aula experimental.');
    await dlg.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(dlg.getByRole('alert').filter({ hasText: 'limite de 10 novos contatos' })).toBeVisible();
    await expect(dlg.getByLabel('Sua mensagem')).toHaveValue('Olá! Gostaria de marcar uma aula experimental.');
    await expect(page).toHaveURL(/\/professores\/p\/ana-silva$/);
    // p_subject nulo quando não escolhe matéria
    await dlg.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('dialog.pf-modal')).toHaveCount(0);
    // rascunho volta ao reabrir
    await contact(page).getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(page.locator('dialog.pf-modal[open]').getByLabel('Sua mensagem')).toHaveValue('Olá! Gostaria de marcar uma aula experimental.');
  });

  test('p_subject é null sem matéria escolhida', async ({ page }) => {
    await seedSession(page);
    const { reqs } = await mockSupabase(page, { tutor: makeTutor() });
    await page.goto('/professores/p/ana-silva');
    await contact(page).getByRole('button', { name: 'Enviar mensagem' }).click();
    const dlg = page.locator('dialog.pf-modal[open]');
    await dlg.getByLabel('Sua mensagem').fill('Olá! Você dá aula aos sábados?');
    await dlg.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.waitForURL(`**/professores/mensagens.html?c=${NEW_CONV}`);
    expect(reqs.rpc.find((r) => r.fn === 'start_conversation').body).toEqual({ p_tutor: TUTOR_ID, p_body: 'Olá! Você dá aula aos sábados?', p_subject: null });
  });

  test('volta do login com #mensagem: abre o modal uma vez e limpa o hash', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, { tutor: makeTutor() });
    await page.goto('/professores/p/ana-silva#mensagem');
    await expect(page.locator('dialog.pf-modal[open]')).toHaveCount(1);
    await expect(page).toHaveURL(/\/professores\/p\/ana-silva$/);
  });

  test('conversa existente ganha atalho "Abrir conversa"', async ({ page }) => {
    await seedSession(page);
    await mockSupabase(page, { tutor: makeTutor(), existingConv: CONV1 });
    await page.goto('/professores/p/ana-silva');
    await expect(contact(page).getByRole('link', { name: 'Abrir conversa' })).toHaveAttribute('href', `/professores/mensagens.html?c=${CONV1}`);
  });

  test('o próprio professor não vê o botão', async ({ page }) => {
    const user = { id: TUTOR_ID, aud: 'authenticated', role: 'authenticated', email: 'ana@exemplo.test' };
    await seedSession(page, user);
    await mockSupabase(page, {
      user,
      tutor: makeTutor(),
      profile: { id: TUTOR_ID, full_name: 'Ana Silva', role: 'tutor', is_admin: false, avatar_path: null, banned_at: null, tutor_profiles: null },
    });
    await page.goto('/professores/p/ana-silva');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ana Silva');
    await expect(contact(page)).toBeEmpty();
    await expect(page.getByRole('button', { name: 'Enviar mensagem' })).toHaveCount(0);
  });
});
