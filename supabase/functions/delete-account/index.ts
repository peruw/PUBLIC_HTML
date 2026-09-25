// Exclui a conta do usuário logado (LGPD).
// Apaga os arquivos em avatars/<uid>/ (com subpastas) e o usuário do Auth; o resto sai por ON DELETE CASCADE
// (payments ficam com user_id nulo para a contabilidade).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { removeFolder } from '../_shared/storage.ts';
import { adminClient, getCaller } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const reply = (status: number, body: unknown) => jsonResponse(req, status, body);
  if (req.method !== 'POST') return reply(405, { error: 'Método não permitido.' });

  try {
    const admin = adminClient();
    const user = await getCaller(req, admin);
    if (!user) return reply(401, { error: 'Faça login para continuar.' });

    // Avatares: remove tudo em avatars/<uid>/, inclusive subpastas (antes de apagar o usuário;
    // se falhar, a conta fica e o usuário pode tentar de novo)
    await removeFolder(admin.storage.from('avatars'), user.id);

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) throw delErr;

    return reply(200, { ok: true });
  } catch (err) {
    console.error('delete-account:', err);
    return reply(500, { error: 'Não foi possível excluir a conta agora. Tente novamente ou fale com o suporte.' });
  }
});
