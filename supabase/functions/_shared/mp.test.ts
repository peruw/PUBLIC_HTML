// Testes de _shared/mp.ts (Node 22: node --test "supabase/functions/_shared/*.test.ts")
// A assinatura esperada é calculada aqui com node:crypto (independente do crypto.subtle usado em mp.ts).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  PLAN_MONTHS,
  buildManifest,
  extractNotification,
  hmacSha256Hex,
  isDowngrade,
  isTransientDbError,
  isUuid,
  isValidMonths,
  isValidPlan,
  normalizeStatus,
  parseSignature,
  pickRaw,
  planRank,
  planTitle,
  timingSafeEqual,
  toCents,
  verifySignature,
} from './mp.ts';

const SECRET = 'segredo-de-teste-9f8e7d';
const TS = '1742505638683';
const REQ_ID = 'bb56a2f1-6aae-46ac-982e-9dcd3581d08e';
const PAY_ID = '1319855555';

function sign(secret: string, manifest: string): string {
  return createHmac('sha256', secret).update(manifest).digest('hex');
}

function sigHeader(ts: string, v1: string): string {
  return `ts=${ts},v1=${v1}`;
}

// Cabeçalho válido como o MP enviaria
function validHeader(dataId = PAY_ID, requestId = REQ_ID, ts = TS, secret = SECRET): string {
  return sigHeader(ts, sign(secret, `id:${dataId};request-id:${requestId};ts:${ts};`));
}

// Inverte um caractere hex (mantém formato válido)
function flipHex(hex: string, pos = hex.length - 1): string {
  const c = hex[pos] === 'a' ? 'b' : 'a';
  return hex.slice(0, pos) + c + hex.slice(pos + 1);
}

describe('buildManifest', () => {
  test('formato do MP: id;request-id;ts; com ponto e vírgula final', () => {
    assert.equal(buildManifest('123456', 'req-abc', '1704908010'), 'id:123456;request-id:req-abc;ts:1704908010;');
  });

  test('id alfanumérico vai em minúsculas', () => {
    assert.equal(buildManifest('ABC123def', 'r', '1'), 'id:abc123def;request-id:r;ts:1;');
  });

  test('id não alfanumérico é mantido como veio', () => {
    assert.equal(buildManifest('AB-12', 'r', '1'), 'id:AB-12;request-id:r;ts:1;');
  });

  test('aceita id e ts numéricos', () => {
    assert.equal(buildManifest(123, 'r', 1700000000), 'id:123;request-id:r;ts:1700000000;');
  });

  test('omite partes ausentes (regra do MP)', () => {
    assert.equal(buildManifest('1', null, '2'), 'id:1;ts:2;');
    assert.equal(buildManifest('1', '', '2'), 'id:1;ts:2;');
    assert.equal(buildManifest(undefined, 'r', '2'), 'request-id:r;ts:2;');
    assert.equal(buildManifest('', undefined, '2'), 'ts:2;');
    assert.equal(buildManifest(null, null, null), '');
  });
});

describe('parseSignature', () => {
  const V1 = sign(SECRET, 'qualquer');

  test('lê ts e v1', () => {
    assert.deepEqual(parseSignature(`ts=${TS},v1=${V1}`), { ts: TS, v1: V1 });
  });

  test('aceita espaços, ordem invertida e v1 maiúsculo', () => {
    assert.deepEqual(parseSignature(` v1 = ${V1.toUpperCase()} , ts = ${TS} `), { ts: TS, v1: V1 });
  });

  test('ignora chaves desconhecidas', () => {
    assert.deepEqual(parseSignature(`ts=${TS},v1=${V1},v2=xyz`), { ts: TS, v1: V1 });
  });

  test('recusa cabeçalho ausente ou vazio', () => {
    assert.equal(parseSignature(null), null);
    assert.equal(parseSignature(undefined), null);
    assert.equal(parseSignature(''), null);
    // deno-lint-ignore no-explicit-any
    assert.equal(parseSignature(123 as any), null);
  });

  test('recusa cabeçalho malformado', () => {
    assert.equal(parseSignature('lixo'), null);
    assert.equal(parseSignature(`ts=${TS}`), null, 'sem v1');
    assert.equal(parseSignature(`v1=${V1}`), null, 'sem ts');
    assert.equal(parseSignature(`ts=abc,v1=${V1}`), null, 'ts não numérico');
    assert.equal(parseSignature(`ts=,v1=${V1}`), null, 'ts vazio');
    assert.equal(parseSignature(`ts=${TS},v1=${V1.slice(1)}`), null, 'v1 curto');
    assert.equal(parseSignature(`ts=${TS},v1=${V1}00`), null, 'v1 longo');
    assert.equal(parseSignature(`ts=${TS},v1=${'z'.repeat(64)}`), null, 'v1 não hex');
    assert.equal(parseSignature(`ts=${TS};v1=${V1}`), null, 'separador errado');
    assert.equal(parseSignature(`=${TS},v1=${V1}`), null, 'chave vazia');
  });

  test('recusa chave duplicada', () => {
    assert.equal(parseSignature(`ts=${TS},ts=1,v1=${V1}`), null);
    assert.equal(parseSignature(`ts=${TS},v1=${V1},v1=${V1}`), null);
  });

  test('recusa cabeçalho gigante', () => {
    assert.equal(parseSignature(`ts=${TS},v1=${V1},x=${'a'.repeat(1000)}`), null);
  });
});

describe('hmacSha256Hex', () => {
  test('igual ao createHmac do Node', async () => {
    for (const [secret, msg] of [
      [SECRET, `id:${PAY_ID};request-id:${REQ_ID};ts:${TS};`],
      ['k', ''],
      ['chave com acentuação ç', 'mensagem com emoji 🎓 e ã'],
    ]) {
      assert.equal(await hmacSha256Hex(secret, msg), sign(secret, msg));
    }
  });
});

describe('timingSafeEqual', () => {
  test('compara conteúdo e tamanho', () => {
    assert.equal(timingSafeEqual('abc', 'abc'), true);
    assert.equal(timingSafeEqual('', ''), true);
    assert.equal(timingSafeEqual('abc', 'abd'), false);
    assert.equal(timingSafeEqual('abc', 'ab'), false);
    assert.equal(timingSafeEqual('ab', 'abc'), false);
    assert.equal(timingSafeEqual('abc', ''), false);
    // deno-lint-ignore no-explicit-any
    assert.equal(timingSafeEqual(null as any, 'abc'), false);
  });
});

describe('verifySignature', () => {
  const base = () => ({ secret: SECRET, xSignature: validHeader(), xRequestId: REQ_ID, dataId: PAY_ID });

  test('assinatura válida', async () => {
    assert.equal(await verifySignature(base()), true);
  });

  test('válida com id numérico e v1 em maiúsculas', async () => {
    const v1 = sign(SECRET, `id:${PAY_ID};request-id:${REQ_ID};ts:${TS};`).toUpperCase();
    assert.equal(await verifySignature({ ...base(), dataId: Number(PAY_ID), xSignature: sigHeader(TS, v1) }), true);
  });

  test('válida sem x-request-id (parte omitida do manifest)', async () => {
    const header = sigHeader(TS, sign(SECRET, `id:${PAY_ID};ts:${TS};`));
    assert.equal(await verifySignature({ ...base(), xSignature: header, xRequestId: null }), true);
  });

  test('id alfanumérico: assinatura sobre o id em minúsculas', async () => {
    const header = sigHeader(TS, sign(SECRET, `id:abc123;request-id:${REQ_ID};ts:${TS};`));
    assert.equal(await verifySignature({ ...base(), xSignature: header, dataId: 'ABC123' }), true);
  });

  test('recusa ts adulterado', async () => {
    const v1 = parseSignature(validHeader())!.v1;
    assert.equal(await verifySignature({ ...base(), xSignature: sigHeader(String(Number(TS) + 1), v1) }), false);
  });

  test('recusa v1 adulterado', async () => {
    const v1 = parseSignature(validHeader())!.v1;
    assert.equal(await verifySignature({ ...base(), xSignature: sigHeader(TS, flipHex(v1)) }), false);
    assert.equal(await verifySignature({ ...base(), xSignature: sigHeader(TS, flipHex(v1, 0)) }), false);
  });

  test('recusa id de pagamento trocado (assinatura de outro pagamento)', async () => {
    assert.equal(await verifySignature({ ...base(), dataId: '1319855556' }), false);
  });

  test('recusa x-request-id trocado ou ausente', async () => {
    assert.equal(await verifySignature({ ...base(), xRequestId: 'outro-request-id' }), false);
    assert.equal(await verifySignature({ ...base(), xRequestId: null }), false);
  });

  test('recusa segredo errado', async () => {
    assert.equal(await verifySignature({ ...base(), secret: 'outro-segredo' }), false);
    assert.equal(await verifySignature({ ...base(), xSignature: validHeader(PAY_ID, REQ_ID, TS, 'chute') }), false);
  });

  test('sem segredo configurado: sempre recusa (falha fechada)', async () => {
    // Até uma assinatura feita com chave vazia é recusada
    const emptyKeyHeader = validHeader(PAY_ID, REQ_ID, TS, '');
    assert.equal(await verifySignature({ ...base(), secret: '', xSignature: emptyKeyHeader }), false);
    assert.equal(await verifySignature({ ...base(), secret: undefined }), false);
    assert.equal(await verifySignature({ ...base(), secret: null }), false);
  });

  test('recusa cabeçalho ausente ou malformado', async () => {
    assert.equal(await verifySignature({ ...base(), xSignature: null }), false);
    assert.equal(await verifySignature({ ...base(), xSignature: '' }), false);
    assert.equal(await verifySignature({ ...base(), xSignature: 'ts=1' }), false);
    assert.equal(await verifySignature({ ...base(), xSignature: `v1=${parseSignature(validHeader())!.v1}` }), false);
    assert.equal(await verifySignature({ ...base(), xSignature: 'garbage,more garbage' }), false);
  });
});

describe('extractNotification', () => {
  const HOOK = 'https://x.supabase.co/functions/v1/mp-webhook';

  test('Webhooks: id da URL (data.id) e tipo', () => {
    const body = { action: 'payment.updated', api_version: 'v1', data: { id: '123' }, id: 999888, type: 'payment' };
    assert.deepEqual(extractNotification(`${HOOK}?source_news=webhooks&data.id=123&type=payment`, body),
      { format: 'webhook', type: 'payment', id: '123' });
  });

  test('Webhooks: aceita objeto URL', () => {
    assert.deepEqual(extractNotification(new URL(`${HOOK}?data.id=77&type=payment`), null),
      { format: 'webhook', type: 'payment', id: '77' });
  });

  test('Webhooks: só corpo (sem query)', () => {
    assert.deepEqual(extractNotification(HOOK, { type: 'payment', data: { id: '456' } }),
      { format: 'webhook', type: 'payment', id: '456' });
  });

  test('Webhooks: id numérico no corpo', () => {
    assert.equal(extractNotification(HOOK, { type: 'payment', data: { id: 456 } }).id, '456');
  });

  test('id da URL tem prioridade sobre o corpo', () => {
    assert.equal(extractNotification(`${HOOK}?data.id=111&type=payment`, { type: 'payment', data: { id: '222' } }).id, '111');
  });

  test('corpo.id (id da notificação) nunca é usado como id do pagamento', () => {
    assert.equal(extractNotification(HOOK, { type: 'payment', id: 999888, data: {} }).id, null);
  });

  test('tipo deduzido de action', () => {
    assert.deepEqual(extractNotification(HOOK, { action: 'payment.created', data: { id: '5' } }),
      { format: 'webhook', type: 'payment', id: '5' });
  });

  test('tipo normalizado para minúsculas', () => {
    assert.equal(extractNotification(`${HOOK}?data.id=5&type=PAYMENT`, null).type, 'payment');
  });

  test('IPN: ?topic=payment&id=', () => {
    assert.deepEqual(extractNotification(`${HOOK}?topic=payment&id=789`, null),
      { format: 'ipn', type: 'payment', id: '789' });
  });

  test('IPN: corpo com resource (id ou URL)', () => {
    assert.deepEqual(extractNotification(HOOK, { topic: 'payment', resource: '789' }),
      { format: 'ipn', type: 'payment', id: '789' });
    assert.deepEqual(
      extractNotification(HOOK, { topic: 'payment', resource: 'https://api.mercadolibre.com/collections/notifications/790' }),
      { format: 'ipn', type: 'payment', id: '790' },
    );
  });

  test('outros tópicos saem com o tipo (o webhook ignora)', () => {
    assert.equal(extractNotification(`${HOOK}?topic=merchant_order&id=1`, null).type, 'merchant_order');
    assert.equal(extractNotification(`${HOOK}?data.id=1&type=subscription_preapproval`, null).type, 'subscription_preapproval');
  });

  test('id inválido vira null (sem path injection na API do MP)', () => {
    for (const bad of ['../../users/me', '12a', '', ' ', '1/2', '-1', '1e5', '1'.repeat(21)]) {
      const u = new URL(HOOK);
      u.searchParams.set('data.id', bad);
      u.searchParams.set('type', 'payment');
      assert.equal(extractNotification(u, null).id, null, `data.id=${JSON.stringify(bad)}`);
    }
    assert.equal(extractNotification(HOOK, { type: 'payment', data: { id: -5 } }).id, null);
    assert.equal(extractNotification(HOOK, { type: 'payment', data: { id: 1.5 } }).id, null);
    assert.equal(extractNotification(HOOK, { type: 'payment', data: { id: { $gt: 0 } } }).id, null);
    assert.equal(extractNotification(`${HOOK}?topic=payment&id=abc`, null).id, null);
  });

  test('data.id inválido na URL não cai para o corpo', () => {
    assert.equal(extractNotification(`${HOOK}?data.id=abc&type=payment`, { data: { id: '5' } }).id, null);
  });

  test('entradas vazias ou estranhas', () => {
    const none = { format: null, type: null, id: null };
    assert.deepEqual(extractNotification(HOOK, null), none);
    assert.deepEqual(extractNotification(HOOK, 'texto'), none);
    assert.deepEqual(extractNotification(HOOK, [1, 2]), none);
    assert.deepEqual(extractNotification(HOOK, {}), none);
    assert.deepEqual(extractNotification('não é url', null), none);
  });
});

describe('planos', () => {
  test('PLAN_MONTHS', () => {
    assert.deepEqual(PLAN_MONTHS, [1, 3, 12]);
  });

  test('isValidPlan: só planos pagos', () => {
    assert.equal(isValidPlan('profissional'), true);
    assert.equal(isValidPlan('premium'), true);
    for (const bad of ['basico', 'Premium', 'premium ', '', null, undefined, 1, {}]) assert.equal(isValidPlan(bad), false);
  });

  test('isValidMonths', () => {
    for (const ok of [1, 3, 12, '1', '3', '12']) assert.equal(isValidMonths(ok), true, String(ok));
    for (const bad of [0, 2, 6, 24, -1, 1.5, '', ' ', 'abc', null, undefined, NaN, [3]]) {
      assert.equal(isValidMonths(bad), false, String(bad));
    }
  });

  test('planRank e isDowngrade', () => {
    assert.equal(planRank('basico'), 0);
    assert.equal(planRank('profissional'), 1);
    assert.equal(planRank('premium'), 2);
    assert.equal(planRank('desconhecido'), 0);
    assert.equal(planRank(null), 0);
    assert.equal(planRank('toString'), 0, 'não lê o protótipo');
    assert.equal(isDowngrade('premium', 'profissional'), true);
    assert.equal(isDowngrade('premium', 'premium'), false, 'renovar o mesmo plano pode');
    assert.equal(isDowngrade('profissional', 'premium'), false, 'subir de plano pode');
    assert.equal(isDowngrade('basico', 'profissional'), false);
  });

  test('planTitle', () => {
    assert.equal(planTitle('premium', 1), 'Quanta Aulas Professores — Plano Premium (1 mês)');
    assert.equal(planTitle('profissional', 12), 'Quanta Aulas Professores — Plano Profissional (12 meses)');
    assert.equal(planTitle('constructor', 3), 'Quanta Aulas Professores — Plano constructor (3 meses)');
  });
});

describe('pagamento', () => {
  test('normalizeStatus mapeia para os status de public.payments', () => {
    const cases: Record<string, string> = {
      approved: 'approved', pending: 'pending', authorized: 'pending', in_process: 'in_process',
      in_mediation: 'in_process', rejected: 'rejected', cancelled: 'cancelled', refunded: 'refunded',
      charged_back: 'charged_back', qualquer_coisa: 'pending',
    };
    for (const [mp, ours] of Object.entries(cases)) assert.equal(normalizeStatus(mp), ours, mp);
    assert.equal(normalizeStatus(undefined), 'pending');
  });

  test('toCents', () => {
    assert.equal(toCents(29.9), 2990);
    assert.equal(toCents(59.9), 5990);
    assert.equal(toCents(539.1), 53910);
    assert.equal(toCents('89.70'), 8970);
    assert.equal(toCents(0), 0);
    for (const bad of [-1, NaN, Infinity, 'abc', '', null, undefined, {}]) assert.equal(toCents(bad), null, String(bad));
  });

  test('toCents(c / 100) === c para todos os valores até R$ 2.000,00', () => {
    for (let c = 0; c <= 200000; c++) {
      if (toCents(c / 100) !== c) assert.fail(`falhou em ${c}`);
    }
  });

  test('isUuid', () => {
    assert.equal(isUuid('3f1c2a8e-9b7d-4c1e-8f2a-1b2c3d4e5f60'), true);
    assert.equal(isUuid('3F1C2A8E-9B7D-4C1E-8F2A-1B2C3D4E5F60'), true);
    for (const bad of ['', '123', 'plano-premium', '3f1c2a8e9b7d4c1e8f2a1b2c3d4e5f60', null, 42]) assert.equal(isUuid(bad), false);
  });

  test('pickRaw guarda só campos do pagamento (sem dados do pagador/cartão)', () => {
    const raw = pickRaw({
      id: 1, status: 'approved', transaction_amount: 29.9, currency_id: 'BRL', external_reference: 'x',
      payer: { email: 'a@b.com', identification: { number: '12345678900' } },
      card: { last_four_digits: '1234' }, additional_info: { ip_address: '1.2.3.4' },
    });
    assert.deepEqual(raw, { id: 1, status: 'approved', transaction_amount: 29.9, currency_id: 'BRL', external_reference: 'x' });
    assert.deepEqual(pickRaw(null), {});
  });

  test('isTransientDbError', () => {
    assert.equal(isTransientDbError(null), false);
    assert.equal(isTransientDbError(undefined), false);
    assert.equal(isTransientDbError({ code: 'P0001' }), false, 'regra de negócio');
    assert.equal(isTransientDbError({ code: '23505' }), false, 'unique');
    assert.equal(isTransientDbError({ code: '22P02' }), false, 'uuid inválido');
    assert.equal(isTransientDbError({ code: '40001' }), true, 'serialização');
    assert.equal(isTransientDbError({ code: '40P01' }), true, 'deadlock');
    assert.equal(isTransientDbError({ code: '08006' }), true, 'conexão');
    assert.equal(isTransientDbError({ code: '57014' }), true, 'timeout');
    assert.equal(isTransientDbError({ code: 'PGRST000' }), true, 'PostgREST sem banco');
    assert.equal(isTransientDbError({ code: 'PGRST202' }), true, 'função ainda não criada');
    assert.equal(isTransientDbError({}), true, 'erro de rede sem código');
  });
});
