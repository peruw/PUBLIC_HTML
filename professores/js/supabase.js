/* ============================================
   Portal de professores — cliente Supabase único
   ============================================ */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// flowType 'pkce': links de e-mail (confirmação, recuperar senha) voltam como ?code=...,
// que só é trocado por sessão com o code_verifier salvo NESTE navegador.
// O fluxo 'implicit' (padrão) aceitaria #access_token=... de qualquer link e logaria
// o visitante na conta de outra pessoa (login CSRF).
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// URL de uma Edge Function (ex.: fnUrl('create-checkout'))
export function fnUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

// "<uuid>/<arquivo>": só a pasta do dono e um nome simples (sem "..", barras extras ou ponto inicial)
const AVATAR_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/i;

// URL pública de um arquivo do bucket "avatars" (path = "<uid>/avatar-123.webp").
// avatar_path vem do usuário: caminho fora do formato -> null (avatar vira iniciais),
// para a URL nunca sair do bucket.
export function avatarPublicUrl(path) {
  if (!path || !AVATAR_PATH_RE.test(String(path))) return null;
  const safe = String(path).split('/').map(encodeURIComponent).join('/');
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${safe}`;
}
