// Testes de _shared/cors.ts (Node 22). No Node o cors.ts lê process.env.
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigins, corsHeaders, handleOptions, isAllowedOrigin, jsonResponse } from './cors.ts';

const SAVED = process.env.ALLOWED_ORIGINS;
afterEach(() => {
  if (SAVED === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = SAVED;
});

describe('allowedOrigins', () => {
  test('sem env: domínio de produção', () => {
    delete process.env.ALLOWED_ORIGINS;
    assert.deepEqual(allowedOrigins(), ['https://quantaaulas.com', 'https://www.quantaaulas.com']);
  });

  test('CSV com espaços, barra final e maiúsculas', () => {
    process.env.ALLOWED_ORIGINS = ' https://QuantaAulas.com/ , http://localhost:5173,, ';
    assert.deepEqual(allowedOrigins(), ['https://quantaaulas.com', 'http://localhost:5173']);
  });

  test('curinga "*" é ignorado', () => {
    process.env.ALLOWED_ORIGINS = '*';
    assert.deepEqual(allowedOrigins(), ['https://quantaaulas.com', 'https://www.quantaaulas.com']);
    process.env.ALLOWED_ORIGINS = '*,http://localhost:5173';
    assert.deepEqual(allowedOrigins(), ['http://localhost:5173']);
    assert.equal(isAllowedOrigin('https://evil.example'), false);
  });
});

describe('corsHeaders', () => {
  test('origem permitida recebe Allow-Origin exato', () => {
    process.env.ALLOWED_ORIGINS = 'https://quantaaulas.com,http://localhost:5173';
    const h = corsHeaders('http://localhost:5173');
    assert.equal(h['Access-Control-Allow-Origin'], 'http://localhost:5173');
    assert.equal(h['Access-Control-Allow-Methods'], 'POST, OPTIONS');
    assert.equal(h['Access-Control-Allow-Headers'], 'authorization, x-client-info, apikey, content-type');
    assert.equal(h.Vary, 'Origin');
  });

  test('origem fora da lista, parecida ou ausente não recebe Allow-Origin', () => {
    process.env.ALLOWED_ORIGINS = 'https://quantaaulas.com';
    for (const o of ['https://evil.example', 'https://quantaaulas.com.evil.example', 'http://quantaaulas.com', 'null', '', null, undefined]) {
      assert.equal(corsHeaders(o)['Access-Control-Allow-Origin'], undefined, String(o));
    }
  });
});

describe('handleOptions / jsonResponse', () => {
  test('preflight OPTIONS => 204 com CORS; outros métodos => null', () => {
    process.env.ALLOWED_ORIGINS = 'https://quantaaulas.com';
    const pre = handleOptions(new Request('https://f.example/x', { method: 'OPTIONS', headers: { Origin: 'https://quantaaulas.com' } }));
    assert.ok(pre);
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://quantaaulas.com');
    assert.equal(handleOptions(new Request('https://f.example/x', { method: 'POST' })), null);
  });

  test('jsonResponse com status, JSON e CORS', async () => {
    process.env.ALLOWED_ORIGINS = 'https://quantaaulas.com';
    const req = new Request('https://f.example/x', { method: 'POST', headers: { Origin: 'https://quantaaulas.com' } });
    const res = jsonResponse(req, 400, { error: 'Plano inválido.' });
    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://quantaaulas.com');
    assert.deepEqual(await res.json(), { error: 'Plano inválido.' });
  });
});
