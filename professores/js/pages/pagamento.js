/* ============================================
   Página: Status do pagamento (dono: planos)
   Volta do Mercado Pago (back_urls): ?external_reference=<payments.id>&payment_id=…&status=…&collection_status=…
   Os parâmetros do MP servem só de dica para a mensagem; quem manda é a linha de `payments`
   (RLS: só o dono lê), atualizada pelo webhook. Consulta a cada 3 s por até 60 s.
   O cliente nunca concede plano.
   ============================================ */

import '../../css/planos.css';
import { sb } from '../supabase.js';
import { isConfigured } from '../config.js';
import { initChrome, h, brl, errorMsg, notConfiguredNotice, qsGet } from '../ui.js';
import { requireAuth, getProfile } from '../auth.js';
import {
  PERIODS, PLANOS_URL, UUID_RE, planName, periodLabel, longDate, effectivePlan,
} from '../components/painel-plano.js';

const PAINEL_PLANO = '/professores/painel.html#plano';
const POLL_MS = 3000;
const MAX_WAIT_MS = 60_000;
// MP disse que não houve pagamento aprovado: espera pouco pelo webhook antes de mostrar
const QUICK_WAIT_MS = 9000;
const FINAL = new Set(['approved', 'rejected', 'cancelled', 'refunded', 'charged_back', 'amount_mismatch']);
const COLS = 'id,status,plan,months,amount_cents,applied_at,created_at';

const state = {
  ref: null,
  hint: null, // status informado pelo MP na URL (approved | pending | in_process | rejected | null | …)
  row: null,
  live: null,
  summary: null,
  gen: 0,
  timer: null,
  lastKey: '', // estado mostrado na região aria-live (só reanuncia quando muda)
  lastSumKey: '', // resumo + botões
};

// ---------- Dados ----------

// Linha do pagamento; null se não existe (ou é de outra conta: o RLS esconde). Lança em erro de rede/API.
async function fetchPayment() {
  const { data, error } = await sb.from('payments').select(COLS).eq('id', state.ref).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

function mpHint() {
  const raw = (qsGet('collection_status') || qsGet('status') || '').trim().toLowerCase();
  return /^[a-z_]{1,30}$/.test(raw) ? raw : null;
}

// ---------- Interface ----------

function retryUrl(row) {
  const m = Number(row?.months);
  return PERIODS.includes(m) && m !== 1 ? `${PLANOS_URL}?periodo=${m}` : PLANOS_URL;
}

function summaryEl(row) {
  const items = [];
  if (row) {
    items.push(['Plano', planName(row.plan)]);
    items.push(['Período', periodLabel(row.months)]);
    items.push(['Valor', h('span', { class: 'pf-plan-nowrap' }, brl(row.amount_cents))]);
  }
  items.push(['Código', h('code', { class: 'pf-pay-ref' }, state.ref)]);
  return h('dl', { class: 'pf-pay-sum' },
    items.map(([k, v]) => h('div', { class: 'pf-pay-sum-row' }, h('dt', {}, k), h('dd', {}, v))));
}

function btn(label, href, primary = false) {
  return h('a', { class: ['btn', 'btn-sm', primary ? 'btn-primary' : 'btn-ghost'], href }, label);
}

function actionBtn(label, onClick, primary = false) {
  return h('button', { type: 'button', class: ['btn', 'btn-sm', primary ? 'btn-primary' : 'btn-ghost'], onClick }, label);
}

/**
 * Mostra um estado. kind: checking | approved | superseded | pending | in_process | waiting_approval
 *   | abandoned | rejected | cancelled | refunded | mismatch | notfound | noref | error
 */
function show(kind, { row = state.row, err = null, expiresAt = null } = {}) {
  const key = `${kind}:${expiresAt ?? ''}:${kind === 'error' ? errorMsg(err) : ''}`;
  const sumKey = `${kind}:${row ? `${row.id}:${row.status}` : ''}`;
  const liveChanged = key !== state.lastKey;
  if (!liveChanged && sumKey === state.lastSumKey) return;
  state.lastKey = key;
  state.lastSumKey = sumKey;

  let tone = 'info';
  let icon = '…';
  let title = '';
  const text = [];
  const actions = [];
  const name = row ? planName(row.plan) : 'escolhido';

  switch (kind) {
    case 'checking':
      tone = 'wait';
      title = 'Confirmando seu pagamento…';
      if (state.hint === 'approved') text.push('O Mercado Pago aprovou o pagamento. Estamos ativando seu plano, o que costuma levar poucos segundos.');
      else if (state.hint === 'pending' || state.hint === 'in_process') text.push('Se você pagou com Pix, a confirmação chega em instantes depois do pagamento no app do banco.');
      else text.push('Estamos aguardando a confirmação do Mercado Pago. Isso costuma levar poucos segundos.');
      text.push(h('span', { class: 'pf-muted' }, 'Não feche esta página; ela se atualiza sozinha.'));
      break;
    case 'approved':
      tone = 'ok';
      icon = '✓';
      title = 'Pagamento aprovado!';
      text.push(expiresAt
        ? ['Seu plano ', h('strong', {}, name), ' está ativo até ', h('strong', {}, longDate(expiresAt)), '.']
        : ['Seu plano ', h('strong', {}, name), ' já está ativo.']);
      text.push('Os benefícios já valem para o seu anúncio. O comprovante do pagamento é enviado pelo Mercado Pago para o seu e-mail.');
      actions.push(btn('Ver meu plano no painel', PAINEL_PLANO, true), btn('Voltar aos planos', PLANOS_URL));
      break;
    case 'superseded':
      tone = 'warn';
      icon = '!';
      title = 'Pagamento aprovado, mas o plano não mudou';
      text.push('Quando este pagamento foi confirmado, você já tinha um plano superior ativo, então ele não foi aplicado ao seu anúncio.');
      text.push('Vamos analisar e devolver o valor pelo Mercado Pago. Se tiver dúvidas, fale com a gente informando o código abaixo.');
      actions.push(btn('Ver meu plano no painel', PAINEL_PLANO, true));
      break;
    case 'pending':
      tone = 'warn';
      icon = '⏱';
      title = 'Aguardando o pagamento';
      text.push('Se você gerou um Pix, pague pelo app do seu banco com o QR Code ou o código "copia e cola" mostrado pelo Mercado Pago.');
      text.push('Assim que o pagamento for confirmado, o plano é ativado automaticamente. Você pode fechar esta página e acompanhar pelo painel.');
      actions.push(actionBtn('Verificar novamente', () => startPolling(), true), btn('Ir para o painel', PAINEL_PLANO));
      break;
    case 'in_process':
      tone = 'warn';
      icon = '⏱';
      title = 'Pagamento em análise';
      text.push('O Mercado Pago está analisando seu pagamento. O plano é ativado automaticamente quando ele for aprovado; se for recusado, nada é cobrado.');
      actions.push(actionBtn('Verificar novamente', () => startPolling(), true), btn('Ir para o painel', PAINEL_PLANO));
      break;
    case 'waiting_approval':
      tone = 'warn';
      icon = '⏱';
      title = 'Pagamento recebido, ativando o plano';
      text.push('O Mercado Pago informou a aprovação, mas a confirmação ainda não chegou até nós. O plano é ativado automaticamente em alguns minutos.');
      actions.push(actionBtn('Verificar novamente', () => startPolling(), true), btn('Ir para o painel', PAINEL_PLANO));
      break;
    case 'abandoned':
      tone = 'muted';
      icon = '×';
      title = 'Pagamento não concluído';
      text.push('Não recebemos nenhum pagamento para este pedido. Se você desistiu ou fechou o Mercado Pago, nada foi cobrado.');
      actions.push(btn('Tentar novamente', retryUrl(row), true), actionBtn('Verificar novamente', () => startPolling()));
      break;
    case 'rejected':
      tone = 'erro';
      icon = '×';
      title = 'Pagamento recusado';
      text.push('O Mercado Pago não aprovou o pagamento e nada foi cobrado. Confira os dados do cartão, use outro cartão ou pague com Pix.');
      actions.push(btn('Tentar novamente', retryUrl(row), true), btn('Ir para o painel', PAINEL_PLANO));
      break;
    case 'cancelled':
      tone = 'muted';
      icon = '×';
      title = 'Pagamento cancelado';
      text.push('Este pagamento foi cancelado ou expirou e nada foi cobrado.');
      actions.push(btn('Tentar novamente', retryUrl(row), true), btn('Ir para o painel', PAINEL_PLANO));
      break;
    case 'refunded':
      tone = 'muted';
      icon = '↩';
      title = row?.status === 'charged_back' ? 'Pagamento contestado' : 'Pagamento estornado';
      text.push('O valor foi devolvido (ou contestado no cartão) e os benefícios deste período foram cancelados.');
      actions.push(btn('Ver meu plano no painel', PAINEL_PLANO, true), btn('Ver planos', PLANOS_URL));
      break;
    case 'mismatch':
      tone = 'warn';
      icon = '!';
      title = 'Pagamento em verificação';
      text.push('O valor recebido pelo Mercado Pago não confere com o do plano. Nossa equipe vai verificar e, se for o caso, devolver o valor.');
      actions.push(btn('Ir para o painel', PAINEL_PLANO, true));
      break;
    case 'notfound':
      tone = 'muted';
      icon = '?';
      title = 'Pagamento não encontrado';
      text.push('Não encontramos este pagamento na sua conta. Confira se você entrou com a mesma conta usada na compra.');
      actions.push(btn('Ver meus pagamentos', PAINEL_PLANO, true), btn('Ver planos', PLANOS_URL));
      break;
    case 'noref':
      tone = 'muted';
      icon = '?';
      title = 'Pagamento não encontrado';
      text.push('Este endereço não tem a referência do pagamento. Veja seus pagamentos no painel ou escolha um plano.');
      actions.push(btn('Ver meus pagamentos', PAINEL_PLANO, true), btn('Ver planos', PLANOS_URL));
      break;
    default: // error
      tone = 'erro';
      icon = '!';
      title = 'Não foi possível verificar o pagamento';
      text.push(errorMsg(err));
      text.push('Se você pagou, o plano será ativado mesmo assim quando o Mercado Pago confirmar.');
      actions.push(actionBtn('Tentar de novo', () => startPolling(), true), btn('Ir para o painel', PAINEL_PLANO));
  }

  if (liveChanged) {
    state.live.replaceChildren(h('div', { class: ['pf-pay-state', `is-${tone}`] },
      h('span', { class: 'pf-pay-icon', 'aria-hidden': 'true' }, tone === 'wait' ? h('span', { class: 'pf-pay-spinner' }) : icon),
      h('div', { class: 'pf-pay-main' },
        h('h2', { class: 'pf-pay-title' }, title),
        text.map((t) => h('p', {}, t)))));
  }

  state.summary.replaceChildren(kind === 'noref' ? '' : summaryEl(row), actions.length ? h('div', { class: 'pf-pay-actions' }, actions) : '');
}

// ---------- Resultado final ----------

async function finish(row) {
  switch (row.status) {
    case 'approved': {
      if (!row.applied_at) return show('superseded', { row });
      // Validade nova do plano (o perfil em cache é de antes do pagamento)
      let expiresAt = null;
      try {
        const profile = await getProfile({ force: true });
        const t = profile?.tutor;
        if (t && effectivePlan(t) === row.plan) expiresAt = t.plan_expires_at;
      } catch { /* mostra sem a data */ }
      return show('approved', { row, expiresAt });
    }
    case 'rejected': return show('rejected', { row });
    case 'cancelled': return show('cancelled', { row });
    case 'refunded':
    case 'charged_back': return show('refunded', { row });
    case 'amount_mismatch': return show('mismatch', { row });
    default: return show('error', { row });
  }
}

// Tempo esgotado sem estado final
function timeout(row) {
  if (row?.status === 'in_process') return show('in_process', { row });
  if (state.hint === 'rejected') return show('rejected', { row });
  if (state.hint === 'cancelled') return show('cancelled', { row });
  if (state.hint === 'null') return show('abandoned', { row });
  if (state.hint === 'approved') return show('waiting_approval', { row });
  return show('pending', { row });
}

function startPolling() {
  clearTimeout(state.timer);
  const gen = ++state.gen;
  const started = Date.now();
  const limit = ['rejected', 'cancelled', 'null'].includes(state.hint) ? QUICK_WAIT_MS : MAX_WAIT_MS;
  let lastErr = null;
  state.lastKey = '';
  state.lastSumKey = '';
  show('checking');

  const tick = async () => {
    if (gen !== state.gen) return;
    let row;
    try {
      row = await fetchPayment();
      lastErr = null;
    } catch (err) {
      row = undefined;
      lastErr = err;
    }
    if (gen !== state.gen) return;
    if (row === null) {
      show('notfound', { row: null });
      return;
    }
    if (row) {
      state.row = row;
      if (FINAL.has(row.status)) {
        await finish(row);
        return;
      }
    }
    if (Date.now() - started + POLL_MS > limit) {
      if (!state.row && lastErr) show('error', { err: lastErr });
      else timeout(state.row);
      return;
    }
    if (row) show('checking', { row });
    state.timer = setTimeout(tick, POLL_MS);
  };
  tick();
}

async function main() {
  initChrome();
  const body = document.getElementById('pageBody');
  if (!body) return;
  if (!isConfigured) {
    notConfiguredNotice(body);
    return;
  }

  let profile;
  try {
    profile = await requireAuth(); // sem sessão: vai ao login e volta com a mesma query
  } catch (err) {
    body.replaceChildren(h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' },
      h('p', {}, errorMsg(err)),
      h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => location.reload() }, 'Tentar de novo'))));
    return;
  }
  if (!profile) return;

  state.live = h('div', { class: 'pf-pay-live', 'aria-live': 'polite' });
  state.summary = h('div', { class: 'pf-pay-extra' });
  body.replaceChildren(h('section', { class: 'pf-panel pf-pay', 'aria-label': 'Status do pagamento' }, state.live, state.summary));

  const ref = (qsGet('external_reference') || '').trim().toLowerCase();
  state.hint = mpHint();
  if (!UUID_RE.test(ref)) {
    show('noref', { row: null });
    return;
  }
  state.ref = ref;
  startPolling();
}

main().catch((err) => {
  const body = document.getElementById('pageBody');
  if (body) body.replaceChildren(h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' }, h('p', {}, errorMsg(err))));
});
