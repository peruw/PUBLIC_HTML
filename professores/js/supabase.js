/* ============================================
   Portal de professores — cliente Supabase único
   ============================================ */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// URL de uma Edge Function (ex.: fnUrl('create-checkout'))
export function fnUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

// URL pública de um arquivo do bucket "avatars" (path = "<uid>/avatar-123.webp")
export function avatarPublicUrl(path) {
  if (!path) return null;
  const safe = String(path).split('/').map(encodeURIComponent).join('/');
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${safe}`;
}
