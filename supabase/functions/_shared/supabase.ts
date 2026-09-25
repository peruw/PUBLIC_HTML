// Clientes Supabase das Edge Functions (Deno).
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

// Cliente com a service_role (ignora RLS): usar só no servidor, com filtros explícitos por usuário
export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Usuário dono do token em "Authorization: Bearer <jwt>" (validado no Auth do Supabase).
// null se ausente, inválido, expirado ou anônimo. A anon/publishable key não é usuário => null.
export async function getCaller(req: Request, admin: SupabaseClient): Promise<User | null> {
  const m = (req.headers.get('Authorization') ?? '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const { data, error } = await admin.auth.getUser(m[1]);
  if (error || !data?.user || data.user.is_anonymous) return null;
  return data.user;
}
