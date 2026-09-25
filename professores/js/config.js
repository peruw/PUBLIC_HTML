/* ============================================
   Portal de professores — configuração pública
   URL e chave publishable do Supabase são PÚBLICAS por design
   (a segurança vem do RLS no banco).
   Override no build: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
   (os testes e2e apontam para http://supabase.test).
   ============================================ */

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://cmwfclgizvjtwpfyaucp.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_y1F_d851xXNUmR7zexNwrQ_2bZVkbYM';
export const SITE_URL = 'https://quantaaulas.com';

// false se faltar URL/chave ou se ainda houver placeholder
export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY) && !SUPABASE_URL.includes('SEU-PROJETO');
