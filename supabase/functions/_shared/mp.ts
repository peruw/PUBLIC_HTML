// Utilitários do Mercado Pago compartilhados pelas Edge Functions.
// SEM imports de propósito: roda no Deno (Edge Functions) e no Node 22 (`node --test`),
// usando só APIs Web padrão (globalThis.crypto.subtle, TextEncoder, URL).

// ---------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------

// Períodos aceitos (meses). O preço vem SEMPRE do banco (rpc plan_price).
export const PLAN_MONTHS = [1, 3, 12];

// Planos pagos que podem ser comprados
export const PAID_PLANS = ['profissional', 'premium'];

// Ordem dos planos (igual a plans.rank_tier)
export const PLAN_RANK: Record<string, number> = { basico: 0, profissional: 1, premium: 2 };

const PLAN_NAMES: Record<string, string> = { basico: 'Básico', profissional: 'Profissional', premium: 'Premium' };

export function isValidPlan(plan: unknown): boolean {
  return typeof plan === 'string' && PAID_PLANS.includes(plan);
}

// Aceita 3 ou "3" (vem de JSON do cliente)
export function isValidMonths(months: unknown): boolean {
  const n = typeof months === 'string' && months.trim() !== '' ? Number(months) : months;
  return typeof n === 'number' && Number.isInteger(n) && PLAN_MONTHS.includes(n);
}

export function planRank(plan: unknown): number {
  return typeof plan === 'string' && plan in PLAN_RANK ? PLAN_RANK[plan] : 0;
}

// true se comprar `requested` seria rebaixar o plano ativo `current` (já efetivo, via effective_plan)
export function isDowngrade(current: unknown, requested: unknown): boolean {
  return planRank(current) > planRank(requested);
}

export function planName(plan: string): string {
  return PLAN_NAMES[plan] ?? plan;
}

// Título do item exibido no checkout do Mercado Pago
export function planTitle(plan: string, months: number): string {
  const periodo = months === 1 ? '1 mês' : `${months} meses`;
  return `Quanta Aulas Professores — Plano ${planName(plan)} (${periodo})`;
}

// ---------------------------------------------------------------------------
// Assinatura do webhook (cabeçalho x-signature: "ts=...,v1=...")
// Docs MP: manifest = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
// assinado com HMAC-SHA256 usando a "assinatura secreta" do painel.
// ---------------------------------------------------------------------------

// Lê "ts=1704908010,v1=<hex64>" (ordem e espaços livres). null se malformado.
export function parseSignature(header: string | null | undefined): { ts: string; v1: string } | null {
  if (typeof header !== 'string' || header.length === 0 || header.length > 512) return null;
  const found: Record<string, string> = {};
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (key !== 'ts' && key !== 'v1') continue;
    if (key in found) return null; // chave duplicada: recusa
    found[key] = value;
  }
  const { ts, v1 } = found;
  if (!ts || !/^\d{1,20}$/.test(ts)) return null;
  if (!v1 || !/^[0-9a-f]{64}$/i.test(v1)) return null;
  return { ts, v1: v1.toLowerCase() };
}

// Monta o manifest. Partes ausentes são omitidas (regra do MP); id alfanumérico vai em minúsculas.
export function buildManifest(
  dataId: string | number | null | undefined,
  requestId: string | null | undefined,
  ts: string | number | null | undefined,
): string {
  let m = '';
  if (dataId !== null && dataId !== undefined && String(dataId) !== '') {
    const id = String(dataId);
    m += `id:${/^[a-z0-9]+$/i.test(id) ? id.toLowerCase() : id};`;
  }
  if (requestId) m += `request-id:${requestId};`;
  if (ts !== null && ts !== undefined && String(ts) !== '') m += `ts:${ts};`;
  return m;
}

// HMAC-SHA256 em hex minúsculo
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Comparação em tempo constante (não para no primeiro caractere diferente)
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

// true só se o x-signature confere com o segredo. Sem segredo => sempre false (falha fechada).
export async function verifySignature(opts: {
  secret: string | null | undefined;
  xSignature: string | null | undefined;
  xRequestId: string | null | undefined;
  dataId: string | number | null | undefined;
}): Promise<boolean> {
  const { secret, xSignature, xRequestId, dataId } = opts;
  if (typeof secret !== 'string' || secret.length === 0) return false;
  const sig = parseSignature(xSignature);
  if (!sig) return false;
  const requestId = typeof xRequestId === 'string' ? xRequestId.trim() : '';
  const manifest = buildManifest(dataId, requestId, sig.ts);
  const expected = await hmacSha256Hex(secret, manifest);
  return timingSafeEqual(expected, sig.v1);
}

// ---------------------------------------------------------------------------
// Notificação recebida no webhook: tipo + id do pagamento
// ---------------------------------------------------------------------------

export type MpNotification = { type: string | null; id: string | null; format: 'webhook' | 'ipn' | null };

// Ids de pagamento do MP são numéricos; qualquer outra coisa é recusada (evita path injection na API)
function cleanId(v: unknown): string | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? String(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^\d{1,20}$/.test(s) ? s : null;
}

function cleanType(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return s === '' ? null : s;
}

function asObject(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// IPN: resource pode ser "123" ou ".../collections/notifications/123"
function resourceId(resource: unknown): string | null {
  if (typeof resource === 'number') return cleanId(resource);
  if (typeof resource !== 'string') return null;
  const m = resource.trim().match(/(?:^|\/)(\d{1,20})\/?$/);
  return m ? m[1] : null;
}

// Extrai { type, id } dos dois formatos do MP:
// - Webhooks: ?data.id=123&type=payment + corpo { type, action, data: { id } } (corpo.id é o id da NOTIFICAÇÃO, não do pagamento)
// - IPN:      ?topic=payment&id=123 (+ corpo { topic, resource })
// O id da URL tem prioridade (é o que entra na assinatura).
export function extractNotification(url: URL | string, body: unknown): MpNotification {
  let q: URLSearchParams;
  try {
    q = (typeof url === 'string' ? new URL(url) : url).searchParams;
  } catch {
    q = new URLSearchParams();
  }
  const b = asObject(body);
  const data = asObject(b.data);

  const action = typeof b.action === 'string' ? b.action.split('.')[0] : null;
  const hookType = cleanType(q.get('type')) ?? cleanType(b.type) ?? cleanType(action);
  if (hookType || q.has('data.id') || 'data' in b) {
    const rawId = q.has('data.id') ? q.get('data.id') : data.id;
    return { format: 'webhook', type: hookType, id: cleanId(rawId) };
  }

  const topic = cleanType(q.get('topic')) ?? cleanType(b.topic);
  if (topic) {
    const id = q.has('id') ? cleanId(q.get('id')) : resourceId(b.resource);
    return { format: 'ipn', type: topic, id };
  }

  return { format: null, type: null, id: null };
}

// ---------------------------------------------------------------------------
// Pagamento consultado na API do MP (GET /v1/payments/{id})
// ---------------------------------------------------------------------------

// Status do MP -> status aceitos em public.payments. Desconhecido vira 'pending' (nunca concede plano).
export function normalizeStatus(status: unknown): string {
  switch (status) {
    case 'approved': return 'approved';
    case 'rejected': return 'rejected';
    case 'cancelled': return 'cancelled';
    case 'refunded': return 'refunded';
    case 'charged_back': return 'charged_back';
    case 'in_process':
    case 'in_mediation': return 'in_process';
    default: return 'pending'; // pending, authorized, ...
  }
}

// Reais (29.9 ou "29.90") -> centavos inteiros. null se inválido/negativo.
export function toCents(amount: unknown): number | null {
  const n = typeof amount === 'string' && amount.trim() !== '' ? Number(amount) : amount;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function isUuid(v: unknown): boolean {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Guarda só o necessário do pagamento (LGPD: sem CPF, e-mail ou dados de cartão do pagador)
const RAW_FIELDS = [
  'id', 'status', 'status_detail', 'transaction_amount', 'transaction_amount_refunded', 'currency_id',
  'payment_method_id', 'payment_type_id', 'installments', 'external_reference', 'live_mode',
  'date_created', 'date_approved', 'date_last_updated',
];

export function pickRaw(payment: unknown): Record<string, unknown> {
  const p = asObject(payment);
  const out: Record<string, unknown> = {};
  for (const k of RAW_FIELDS) if (k in p) out[k] = p[k];
  return out;
}

// Erro do banco (supabase-js/PostgREST) que vale a pena o MP reenviar?
// Erros de regra (P0001), dados (22xxx) e constraints (23xxx) são permanentes; o resto (rede, conexão,
// deadlock, timeout, função ausente...) é transitório => 500 para o MP tentar de novo.
export function isTransientDbError(err: { code?: unknown } | null | undefined): boolean {
  if (!err) return false;
  const code = typeof err.code === 'string' ? err.code : '';
  if (code === 'P0001' || /^2[23]/.test(code)) return false;
  return true;
}
