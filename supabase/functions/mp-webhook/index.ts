// Webhook do Mercado Pago (verify_jwt = false: quem chama é o MP).
// Nunca confia no corpo: exige x-signature válida, consulta o pagamento na API do MP
// e aplica via public.apply_payment com a service_role (idempotente no banco).
// Respostas: 200 = processado/ignorado (MP não reenvia); 401 = assinatura; 500 = falha transitória (MP reenvia).
import { adminClient } from '../_shared/supabase.ts';
import {
  extractNotification,
  isStaleReversal,
  isTransientDbError,
  isUuid,
  normalizeStatus,
  pickRaw,
  REVERSAL_STATUSES,
  toCents,
  verifySignature,
} from '../_shared/mp.ts';

const MP_API = 'https://api.mercadopago.com';
const MAX_BODY = 64 * 1024;
// Resultados de apply_payment que pedem ação manual (estorno, suporte)
const NEEDS_ATTENTION = ['superseded', 'amount_mismatch', 'conflict', 'no_tutor', 'not_found'];

function text(status: number, msg: string): Response {
  return new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text(405, 'method not allowed');

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return text(413, 'payload too large');
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = null; // IPN pode vir sem JSON; o id também vem na URL
      }
    }

    // Tipo e id (URL ?data.id= / ?topic=payment&id= ou corpo)
    const note = extractNotification(new URL(req.url), body);
    if (note.type !== 'payment') return text(200, 'ignored');
    if (!note.id) return text(400, 'invalid id');

    // Assinatura: sem segredo configurado, recusa tudo
    const secret = Deno.env.get('MP_WEBHOOK_SECRET');
    if (!secret) {
      console.error('mp-webhook: MP_WEBHOOK_SECRET não configurado; notificação recusada');
      return text(401, 'unauthorized');
    }
    const valid = await verifySignature({
      secret,
      xSignature: req.headers.get('x-signature'),
      xRequestId: req.headers.get('x-request-id'),
      dataId: note.id,
    });
    if (!valid) {
      console.warn(`mp-webhook: assinatura inválida (id ${note.id})`);
      return text(401, 'invalid signature');
    }

    const token = Deno.env.get('MP_ACCESS_TOKEN');
    if (!token) {
      console.error('mp-webhook: MP_ACCESS_TOKEN não configurado');
      return text(500, 'not configured');
    }

    // Fonte da verdade: o pagamento na API do MP (só enxerga pagamentos da nossa conta)
    let res: Response;
    try {
      res = await fetch(`${MP_API}/v1/payments/${note.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      console.error('mp-webhook: falha ao consultar o MP', err);
      return text(500, 'retry');
    }
    if (res.status === 404 || res.status === 400) return text(200, 'payment not found');
    if (!res.ok) {
      console.error('mp-webhook: MP respondeu', res.status);
      return text(500, 'retry');
    }
    const payment = await res.json().catch(() => null);
    if (!payment || String(payment.id) !== note.id) {
      console.error('mp-webhook: resposta inesperada do MP para', note.id);
      return text(500, 'retry');
    }

    // Só pagamentos criados pelo create-checkout (external_reference = payments.id), em reais
    const ref = payment.external_reference;
    if (!isUuid(ref)) {
      console.warn(`mp-webhook: pagamento ${note.id} sem external_reference nosso`);
      return text(200, 'ignored');
    }
    if (payment.currency_id !== 'BRL') {
      console.warn(`mp-webhook: pagamento ${note.id} em moeda ${payment.currency_id}; ignorado`);
      return text(200, 'ignored currency');
    }
    const cents = toCents(payment.transaction_amount);
    if (cents === null) {
      console.warn(`mp-webhook: pagamento ${note.id} com valor inválido`);
      return text(200, 'ignored amount');
    }

    const admin = adminClient();
    const mpId = String(payment.id);
    const status = normalizeStatus(payment.status);

    // Estorno/cancelamento de OUTRA tentativa da mesma preferência (Pix abandonado, duplicado)
    // não pode desfazer o plano que o pagamento aprovado concedeu
    if (REVERSAL_STATUSES.includes(status)) {
      const { data: row, error: rowErr } = await admin
        .from('payments').select('status, mp_payment_id').eq('id', ref).maybeSingle();
      if (rowErr) {
        console.error('mp-webhook: falha ao ler payments', rowErr.code, rowErr.message);
        return isTransientDbError(rowErr) ? text(500, 'retry') : text(200, 'not applied');
      }
      if (isStaleReversal(row, mpId, status)) {
        console.warn(`mp-webhook: ${status} do pagamento ${mpId} ignorado; ${ref} foi quitado pelo pagamento ${row?.mp_payment_id}`);
        return text(200, 'other attempt');
      }
    }

    // apply_payment confere o valor, trava as linhas e é idempotente
    const { data, error } = await admin.rpc('apply_payment', {
      p_id: ref,
      p_mp_payment_id: mpId,
      p_status: status,
      p_amount_cents: cents,
      p_raw: pickRaw(payment),
    });
    if (error) {
      console.error('mp-webhook: apply_payment falhou', error.code, error.message);
      return isTransientDbError(error) ? text(500, 'retry') : text(200, 'not applied');
    }
    const result = String(data ?? 'ok');
    const line = `mp-webhook: pagamento ${mpId} (${ref}) status=${payment.status} -> ${result}`;
    // superseded = plano inferior pago com um superior em vigor: não aplicado, estornar manualmente
    if (NEEDS_ATTENTION.includes(result)) console.warn(`${line} (verificar/estornar manualmente)`);
    else console.log(line);
    return text(200, result);
  } catch (err) {
    console.error('mp-webhook:', err);
    return text(500, 'retry');
  }
});
