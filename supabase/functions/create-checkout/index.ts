// Cria o checkout (Mercado Pago Checkout Pro) de um plano para o professor logado.
// Corpo: { plan: 'profissional' | 'premium', months: 1 | 3 | 12 }. Resposta: { init_point, payment_id }.
// O valor NUNCA vem do cliente: sai de public.plan_price. O plano só é concedido pelo mp-webhook.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { adminClient, getCaller } from '../_shared/supabase.ts';
import { isDowngrade, isValidMonths, isValidPlan, planName, planTitle } from '../_shared/mp.ts';

const MP_API = 'https://api.mercadopago.com';
const MAX_CHECKOUTS_PER_HOUR = 10;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const reply = (status: number, body: unknown) => jsonResponse(req, status, body);
  if (req.method !== 'POST') return reply(405, { error: 'Método não permitido.' });

  const mpToken = Deno.env.get('MP_ACCESS_TOKEN');
  if (!mpToken) return reply(503, { error: 'Pagamentos ainda não configurados. Tente mais tarde.' });

  try {
    const admin = adminClient();
    const user = await getCaller(req, admin);
    if (!user) return reply(401, { error: 'Faça login para continuar.' });

    // Corpo: só plano e período (qualquer "amount" enviado é ignorado)
    let body: Record<string, unknown> | null = null;
    try {
      body = await req.json();
    } catch {
      return reply(400, { error: 'Pedido inválido.' });
    }
    const plan = body?.plan;
    if (!isValidPlan(plan) || !isValidMonths(body?.months)) {
      return reply(400, { error: 'Plano ou período inválido.' });
    }
    const planCode = plan as string;
    const months = Number(body?.months);

    // Conta ativa + perfil de professor
    const { data: prof, error: profErr } = await admin
      .from('profiles').select('banned_at').eq('id', user.id).maybeSingle();
    if (profErr) throw profErr;
    if (!prof || prof.banned_at) return reply(403, { error: 'Sua conta não pode contratar planos.' });

    const { data: tutor, error: tutorErr } = await admin
      .from('tutor_profiles').select('user_id, plan, plan_expires_at, suspended').eq('user_id', user.id).maybeSingle();
    if (tutorErr) throw tutorErr;
    if (!tutor) return reply(403, { error: 'Somente professores podem contratar planos.' });
    if (tutor.suspended) return reply(403, { error: 'Seu perfil está suspenso. Fale com o suporte.' });

    // Plano em vigor (vencido = básico): não deixa comprar plano inferior enquanto o superior vale
    const { data: current, error: effErr } = await admin
      .rpc('effective_plan', { p_plan: tutor.plan, p_exp: tutor.plan_expires_at });
    if (effErr) throw effErr;
    if (isDowngrade(current, planCode)) {
      const ate = tutor.plan_expires_at
        ? ` até ${new Date(tutor.plan_expires_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
        : '';
      return reply(409, {
        error: `Você já tem o plano ${planName(String(current))} ativo${ate}. Não é possível contratar um plano inferior antes do vencimento.`,
      });
    }

    // Freio contra abuso (cada tentativa cria um registro em payments)
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await admin
      .from('payments').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since);
    if (countErr) throw countErr;
    if ((count ?? 0) >= MAX_CHECKOUTS_PER_HOUR) {
      return reply(429, { error: 'Muitas tentativas de pagamento. Aguarde alguns minutos e tente de novo.' });
    }

    // Preço oficial (centavos) calculado no banco
    const { data: amount, error: priceErr } = await admin
      .rpc('plan_price', { p_plan: planCode, p_months: months });
    if (priceErr) throw priceErr;
    if (!Number.isInteger(amount) || amount <= 0) throw new Error(`plan_price inválido: ${amount}`);

    // Registro pendente; o id vira external_reference no MP
    const { data: pay, error: insErr } = await admin
      .from('payments')
      .insert({ user_id: user.id, plan: planCode, months, amount_cents: amount, status: 'pending' })
      .select('id')
      .single();
    if (insErr) throw insErr;

    const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
    const siteUrl = (Deno.env.get('SITE_URL') ?? 'https://quantaaulas.com').replace(/\/+$/, '');
    const backUrl = `${siteUrl}/professores/pagamento.html`;
    const preference: Record<string, unknown> = {
      items: [{
        id: `${planCode}-${months}m`,
        title: planTitle(planCode, months),
        quantity: 1,
        unit_price: amount / 100,
        currency_id: 'BRL',
      }],
      external_reference: pay.id,
      // source_news=webhooks: só notificações no formato Webhooks (assinadas com x-signature), sem IPN
      notification_url: `${supabaseUrl}/functions/v1/mp-webhook?source_news=webhooks`,
      back_urls: { success: backUrl, pending: backUrl, failure: backUrl },
      auto_return: 'approved',
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }] }, // sem boleto: Pix e cartão
      statement_descriptor: 'QUANTAAULAS',
    };
    if (user.email) preference.payer = { email: user.email };

    let pref: Record<string, unknown> | null = null;
    try {
      const res = await fetch(`${MP_API}/checkout/preferences`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mpToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': pay.id,
        },
        body: JSON.stringify(preference),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.id && data?.init_point) pref = data;
      else console.error('create-checkout: MP recusou a preferência', res.status, JSON.stringify(data)?.slice(0, 500));
    } catch (err) {
      console.error('create-checkout: falha ao chamar o MP', err);
    }

    if (!pref) {
      // Sem link de pagamento: o registro não será usado
      await admin.from('payments').update({ status: 'cancelled' }).eq('id', pay.id).eq('status', 'pending');
      return reply(502, { error: 'Não foi possível iniciar o pagamento. Tente novamente em instantes.' });
    }

    const { error: updErr } = await admin.from('payments').update({ mp_preference_id: String(pref.id) }).eq('id', pay.id);
    if (updErr) console.error('create-checkout: não salvou mp_preference_id', updErr.message); // não bloqueia

    const sandbox = Deno.env.get('MP_SANDBOX') === 'true';
    const initPoint = sandbox ? (pref.sandbox_init_point ?? pref.init_point) : pref.init_point;
    return reply(200, { init_point: initPoint, payment_id: pay.id });
  } catch (err) {
    console.error('create-checkout:', err);
    return reply(500, { error: 'Erro interno. Tente novamente.' });
  }
});
