// CORS das Edge Functions chamadas pelo site.
// Só as origens de ALLOWED_ORIGINS (CSV, ex.: "https://quantaaulas.com,http://localhost:5173")
// recebem Access-Control-Allow-Origin; as demais são bloqueadas pelo navegador.
// Sem imports: também roda no Node (testes).

// quantaaulas-com-359870.hostingersite.com: endereço em que a Hostinger publica o site do GitHub
const DEFAULT_ORIGINS = [
  'https://quantaaulas.com',
  'https://www.quantaaulas.com',
  'https://quantaaulas-com-359870.hostingersite.com',
];

// Deno.env em produção; process.env quando testado no Node
function env(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  if (g.Deno?.env?.get) return g.Deno.env.get(name) ?? undefined;
  return g.process?.env?.[name];
}

function normalizeOrigin(o: string): string {
  return o.trim().replace(/\/+$/, '').toLowerCase();
}

// Lista efetiva de origens permitidas (lida a cada chamada: barata e respeita mudança de secret)
export function allowedOrigins(): string[] {
  const list = (env('ALLOWED_ORIGINS') ?? '').split(',').map(normalizeOrigin).filter((o) => o !== '' && o !== '*');
  return list.length > 0 ? list : DEFAULT_ORIGINS;
}

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  return typeof origin === 'string' && origin !== '' && allowedOrigins().includes(normalizeOrigin(origin));
}

export function corsHeaders(origin: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin as string;
  return headers;
}

// Responde o preflight; retorna null se não for OPTIONS
export function handleOptions(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

// Resposta JSON já com os cabeçalhos CORS da origem do pedido
export function jsonResponse(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json; charset=utf-8' },
  });
}
