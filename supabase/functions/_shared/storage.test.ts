// Testes de _shared/storage.ts (Node 22) com um bucket falso que imita o list() do Supabase Storage:
// filhos diretos do prefixo, pastas com id null, ordem por nome, paginação por limit/offset.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { LIST_PAGE, listFilesDeep, removeFolder, type StorageBucket } from './storage.ts';

const UID = '3f1c2a8e-9b7d-4c1e-8f2a-1b2c3d4e5f60';
const OTHER = '9a8b7c6d-1111-4222-8333-444455556666';

function fakeBucket(paths: string[], opts: { listError?: unknown; removeError?: unknown } = {}) {
  const files = new Set(paths);
  const listCalls: { path: string; offset: number }[] = [];
  const removeBatches: string[][] = [];
  const bucket: StorageBucket = {
    async list(path, { limit, offset }) {
      listCalls.push({ path, offset });
      if (opts.listError) return { data: null, error: opts.listError };
      const base = `${path}/`;
      const entries = new Map<string, { name: string; id: string | null }>();
      for (const f of files) {
        if (!f.startsWith(base)) continue;
        const rest = f.slice(base.length);
        const i = rest.indexOf('/');
        if (i === -1) entries.set(rest, { name: rest, id: `id:${f}` });
        else entries.set(rest.slice(0, i), { name: rest.slice(0, i), id: null });
      }
      const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
      return { data: sorted.slice(offset, offset + limit), error: null };
    },
    async remove(list) {
      removeBatches.push(list);
      if (opts.removeError) return { error: opts.removeError };
      for (const p of list) files.delete(p);
      return { error: null };
    },
  };
  return { bucket, files, listCalls, removeBatches };
}

describe('listFilesDeep', () => {
  test('pasta vazia', async () => {
    const { bucket } = fakeBucket([`${OTHER}/a.webp`]);
    assert.deepEqual(await listFilesDeep(bucket, UID), []);
  });

  test('inclui arquivos de subpastas (pastas vêm com id null)', async () => {
    const { bucket } = fakeBucket([
      `${UID}/avatar-1.webp`,
      `${UID}/x/y.webp`,
      `${UID}/x/z/w.png`,
      `${UID}/x/z/.emptyFolderPlaceholder`,
      `${OTHER}/avatar.webp`,
    ]);
    assert.deepEqual((await listFilesDeep(bucket, UID)).sort(), [
      `${UID}/avatar-1.webp`,
      `${UID}/x/y.webp`,
      `${UID}/x/z/.emptyFolderPlaceholder`,
      `${UID}/x/z/w.png`,
    ]);
  });

  test('pagina pastas com mais de uma página de entradas', async () => {
    const paths = Array.from({ length: LIST_PAGE * 2 + 7 }, (_, i) => `${UID}/f-${String(i).padStart(4, '0')}.webp`);
    const { bucket, listCalls } = fakeBucket(paths);
    assert.deepEqual((await listFilesDeep(bucket, UID)).sort(), paths);
    assert.deepEqual(listCalls.map((c) => c.offset), [0, LIST_PAGE, LIST_PAGE * 2]);
  });

  test('recusa raiz vazia ou com barra (nunca varre o bucket inteiro)', async () => {
    const { bucket, listCalls } = fakeBucket([`${UID}/a.webp`]);
    for (const bad of ['', '/', `${UID}/x`, '..', '.']) {
      await assert.rejects(listFilesDeep(bucket, bad), /pasta raiz inválida/, JSON.stringify(bad));
    }
    // deno-lint-ignore no-explicit-any
    await assert.rejects(listFilesDeep(bucket, undefined as any), /pasta raiz inválida/);
    assert.equal(listCalls.length, 0);
  });

  test('propaga erro do list', async () => {
    const err = new Error('storage fora do ar');
    const { bucket } = fakeBucket([`${UID}/a.webp`], { listError: err });
    await assert.rejects(listFilesDeep(bucket, UID), err);
  });

  test('teto de chamadas contra pastas gigantes/aninhadas demais', async () => {
    // cadeia de 600 subpastas: passa do teto de list() e falha em vez de apagar pela metade
    const deep = `${UID}/${Array.from({ length: 600 }, (_, i) => `d${i}`).join('/')}/a.webp`;
    const { bucket } = fakeBucket([deep]);
    await assert.rejects(listFilesDeep(bucket, UID), /arquivos demais/);
  });
});

// Regressão: o delete-account listava só o 1º nível e deixava públicos os arquivos de subpastas
describe('removeFolder', () => {
  test('apaga tudo sob <uid>/, inclusive subpastas, e nada de outros usuários', async () => {
    const { bucket, files } = fakeBucket([
      `${UID}/avatar-1.webp`,
      `${UID}/x/y.webp`,
      `${UID}/x/z/w.png`,
      `${OTHER}/avatar.webp`,
      `${OTHER}/x/y.webp`,
    ]);
    assert.equal(await removeFolder(bucket, UID), 3);
    assert.deepEqual([...files].sort(), [`${OTHER}/avatar.webp`, `${OTHER}/x/y.webp`]);
    assert.deepEqual(await listFilesDeep(bucket, UID), []);
  });

  test('remove em lotes de no máximo LIST_PAGE', async () => {
    const paths = [
      ...Array.from({ length: LIST_PAGE + 30 }, (_, i) => `${UID}/f-${i}.webp`),
      ...Array.from({ length: 80 }, (_, i) => `${UID}/sub/g-${i}.webp`),
    ];
    const { bucket, files, removeBatches } = fakeBucket(paths);
    assert.equal(await removeFolder(bucket, UID), paths.length);
    assert.equal(files.size, 0);
    assert.ok(removeBatches.every((b) => b.length > 0 && b.length <= LIST_PAGE));
    assert.equal(removeBatches.flat().length, paths.length);
  });

  test('sem arquivos: não chama remove', async () => {
    const { bucket, removeBatches } = fakeBucket([]);
    assert.equal(await removeFolder(bucket, UID), 0);
    assert.equal(removeBatches.length, 0);
  });

  test('propaga erro do remove (o usuário não é apagado com arquivos para trás)', async () => {
    const err = new Error('falha ao remover');
    const { bucket } = fakeBucket([`${UID}/a.webp`], { removeError: err });
    await assert.rejects(removeFolder(bucket, UID), err);
  });
});
