// Exclui a conta do usuário logado (LGPD).
// Apaga os arquivos em avatars/<uid>/ e o usuário do Auth; o resto sai por ON DELETE CASCADE
// (payments ficam com user_id nulo para a contabilidade).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { adminClient, getCaller } from '../_shared/supabase.ts';

const PAGE = 100;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const reply = (status: number, body: unknown) => jsonResponse(req, status, body);
  if (req.method !== 'POST') return reply(405, { error: 'Método não permitido.' });

  try {
    const admin = adminClient();
    const user = await getCaller(req, admin);
    if (!user) return reply(401, { error: 'Faça login para continuar.' });

    // Avatares: lista e remove em lotes (limite de voltas por segurança)
    const bucket = admin.storage.from('avatars');
    for (let i = 0; i < 50; i++) {
      const { data: files, error } = await bucket.list(user.id, { limit: PAGE });
      if (error) throw error;
      if (!files || files.length === 0) break;
      const { error: rmErr } = await bucket.remove(files.map((f) => `${user.id}/${f.name}`));
      if (rmErr) throw rmErr;
      if (files.length < PAGE) break;
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) throw delErr;

    return reply(200, { ok: true });
  } catch (err) {
    console.error('delete-account:', err);
    return reply(500, { error: 'Não foi possível excluir a conta agora. Tente novamente ou fale com o suporte.' });
  }
});
