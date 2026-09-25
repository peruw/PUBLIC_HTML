// Limpeza de pastas do Storage (usada pelo delete-account).
// SEM imports: recebe o bucket do supabase-js (admin.storage.from(...)) e roda também no Node (testes).

// O mínimo do bucket do supabase-js que usamos (um bucket falso serve nos testes)
export type StorageBucket = {
  list(
    path: string,
    options: { limit: number; offset: number },
  ): Promise<{ data: { name: string; id: string | null }[] | null; error: unknown }>;
  remove(paths: string[]): Promise<{ error: unknown }>;
};

export const LIST_PAGE = 100;
const MAX_LIST_CALLS = 500; // teto de segurança: até ~50 mil entradas

// Todos os arquivos sob `root/`, INCLUINDO subpastas: a policy do bucket só confere a 1ª pasta
// (<uid>/...), então o usuário pode ter subido "<uid>/x/y.webp" direto pela API.
// No list() do Storage uma pasta vem como entrada com id null.
export async function listFilesDeep(bucket: StorageBucket, root: string): Promise<string[]> {
  if (typeof root !== 'string' || root === '' || root.includes('/') || root === '.' || root === '..') {
    throw new Error('pasta raiz inválida'); // nunca varre o bucket inteiro
  }
  const files: string[] = [];
  const stack = [root];
  let calls = 0;
  while (stack.length > 0) {
    const prefix = stack.pop() as string;
    // Lista a pasta inteira antes de apagar (apagar durante a paginação pularia arquivos)
    for (let offset = 0; ; offset += LIST_PAGE) {
      if (++calls > MAX_LIST_CALLS) throw new Error(`arquivos demais em ${root}/`);
      const { data, error } = await bucket.list(prefix, { limit: LIST_PAGE, offset });
      if (error) throw error;
      const entries = data ?? [];
      for (const e of entries) {
        if (!e?.name || e.name === '.' || e.name === '..') continue;
        const path = `${prefix}/${e.name}`;
        if (e.id === null) stack.push(path); // subpasta
        else files.push(path);
      }
      if (entries.length < LIST_PAGE) break;
    }
  }
  return files;
}

// Apaga tudo sob `root/` (em lotes). Retorna quantos arquivos foram removidos.
export async function removeFolder(bucket: StorageBucket, root: string): Promise<number> {
  const files = await listFilesDeep(bucket, root);
  for (let i = 0; i < files.length; i += LIST_PAGE) {
    const { error } = await bucket.remove(files.slice(i, i + LIST_PAGE));
    if (error) throw error;
  }
  return files.length;
}
