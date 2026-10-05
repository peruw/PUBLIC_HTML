import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRoomCode, normalizeCode } from '../js/net.js';

test('código de sala: 5 caracteres sem O/0/I/1', () => {
  for (let i = 0; i < 200; i++) assert.match(newRoomCode(), /^[A-HJ-NP-Z2-9]{5}$/);
});

test('normalizeCode limpa o que a pessoa digitou', () => {
  assert.equal(normalizeCode(' ab-c d7x '), 'ABCD7');
  assert.equal(normalizeCode(null), '');
  assert.equal(normalizeCode('abc'), 'ABC');
});
