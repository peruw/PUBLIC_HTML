/* ============================================
   Componente: aba "Plano" do painel (dono: planos)
   Plano em vigor (vencido = Básico), validade, histórico de pagamentos (só os próprios: RLS
   payments_select_own) e link para /professores/planos.html.
   Também exporta os helpers de plano usados por planos.js e pagamento.js.
   ============================================ */

import '../../css/planos.css';
import { sb } from '../supabase.js';
import { h, brl, formatDate, errorMsg, emptyState, planBadge } from '../ui.js';

export const PLANOS_URL = '/professores/planos.html';
export const PAGAMENTO_URL = '/professores/pagamento.html';

/** Períodos aceitos (meses), iguais aos de plan_price e create-checkout. */
export const PERIODS = [1, 3, 12];

const PLAN_NAMES = { basico: 'Básico', profissional: 'Profissional', premium: 'Premium' };
const PLAN_RANK = { basico: 0, profissional: 1, premium: 2 };
const VISIBILITY = ['Padrão', 'Acima do Básico', 'Topo da busca'];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nome do plano ("premium" -> "Premium"); usa a linha de `plans` se vier. */
export function planName(code, plans) {
  const row = Array.isArray(plans) ? plans.find((p) => p.code === code) : null;
  if (row && row.name) return String(row.name);
  return PLAN_NAMES[code] || String(code || '');
}

/** Ordem do plano (plans.rank_tier; sem a tabela, a ordem fixa básico < profissional < premium). */
export function planRank(code, plans) {
  const row = Array.isArray(plans) ? plans.find((p) => p.code === code) : null;
  if (row && Number.isFinite(Number(row.rank_tier))) return Number(row.rank_tier);
  return PLAN_RANK[code] ?? 0;
}

/** Texto da visibilidade na busca conforme o rank do plano. */
export function visibilityText(rank) {
  return VISIBILITY[Math.max(0, Math.min(VISIBILITY.length - 1, Number(rank) || 0))];
}

/** Plano em vigor (igual a public.effective_plan): pago e com validade futura, senão 'basico'. */
export function effectivePlan(tutor) {
  if (!tutor || !tutor.plan || tutor.plan === 'basico' || !tutor.plan_expires_at) return 'basico';
  const t = new Date(tutor.plan_expires_at).getTime();
  return Number.isFinite(t) && t > Date.now() ? tutor.plan : 'basico';
}

/** "1 mês" | "3 meses" | "12 meses" */
export function periodLabel(months) {
  const n = Number(months);
  return n === 1 ? '1 mês' : `${n} meses`;
}

/** Dias inteiros até a data (arredonda para cima; passado -> 0). */
export function daysLeft(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - Date.now()) / 86_400_000));
}

/** "faltam 12 dias" | "falta 1 dia" | "vence hoje" */
export function daysLeftText(iso) {
  const d = daysLeft(iso);
  if (d <= 0) return 'vence hoje';
  return d === 1 ? 'falta 1 dia' : `faltam ${d} dias`;
}

/** Data longa: "25 de setembro de 2027". */
export function longDate(iso) {
  return formatDate(iso, { day: 'numeric', month: 'long', year: 'numeric' });
}

const STALE_PENDING_MS = 24 * 3600 * 1000;

/**
 * Situação de um pagamento para exibir: { label, tone: 'ok'|'warn'|'muted'|'erro', note? }.
 * Aprovado sem applied_at = o plano não foi aplicado (ex.: já havia um plano superior ativo).
 */
export function paymentStatusInfo(row) {
  const status = row?.status;
  switch (status) {
    case 'approved':
      if (row.applied_at) return { label: 'Aprovado', tone: 'ok' };
      return {
        label: 'Aprovado, não aplicado',
        tone: 'warn',
        note: 'O plano não foi alterado (já havia um plano superior ativo). O valor será devolvido.',
      };
    case 'pending': {
      const age = Date.now() - new Date(row.created_at).getTime();
      if (Number.isFinite(age) && age > STALE_PENDING_MS) return { label: 'Não concluído', tone: 'muted' };
      return { label: 'Aguardando pagamento', tone: 'warn' };
    }
    case 'in_process': return { label: 'Em análise', tone: 'warn' };
    case 'rejected': return { label: 'Recusado', tone: 'erro' };
    case 'cancelled': return { label: 'Cancelado', tone: 'muted' };
    case 'refunded': return { label: 'Estornado', tone: 'muted' };
    case 'charged_back': return { label: 'Contestado', tone: 'muted' };
    case 'amount_mismatch': return { label: 'Em verificação', tone: 'warn', note: 'Valor recebido diferente do esperado; vamos verificar.' };
    default: return { label: String(status || '—'), tone: 'muted' };
  }
}

/** Selo de situação do pagamento. */
export function paymentStatusBadge(row) {
  const info = paymentStatusInfo(row);
  const cls = { ok: 'pf-badge--ok', warn: 'pf-badge--warn', erro: 'pf-pay-badge--erro', muted: 'pf-badge--muted' }[info.tone];
  return h('span', { class: ['pf-badge', cls], title: info.note || null }, info.label);
}

/** Link para a página de status de um pagamento (id validado como UUID). */
export function paymentStatusUrl(id) {
  return UUID_RE.test(String(id || '')) ? `${PAGAMENTO_URL}?external_reference=${encodeURIComponent(id)}` : null;
}

// ---------- Aba do painel ----------

let seq = 0;

function currentPlanPanel(profile, plans) {
  const tutor = profile.tutor || null;
  const code = effectivePlan(tutor);
  const name = planName(code, plans);
  const row = Array.isArray(plans) ? plans.find((p) => p.code === code) : null;
  const titleId = `pfPlanNow${++seq}`;
  const lines = [];

  if (code !== 'basico') {
    const days = daysLeft(tutor.plan_expires_at);
    lines.push(h('p', { class: 'pf-plan-now-exp' },
      'Válido até ', h('strong', {}, longDate(tutor.plan_expires_at)), ` (${daysLeftText(tutor.plan_expires_at)}).`));
    if (days <= 7) {
      lines.push(h('p', { class: 'pf-plan-now-warn' },
        `Seu plano vence em breve. Renove para continuar com os benefícios do ${name}; os meses novos são somados à validade atual.`));
    }
  } else if (tutor && tutor.plan && tutor.plan !== 'basico' && tutor.plan_expires_at) {
    lines.push(h('p', { class: 'pf-plan-now-exp' },
      `Seu plano ${planName(tutor.plan, plans)} venceu em ${longDate(tutor.plan_expires_at)}. Seu anúncio voltou ao Básico.`));
  } else {
    lines.push(h('p', { class: 'pf-plan-now-exp' }, 'Plano gratuito, sem validade.'));
  }

  const facts = [];
  if (row) {
    facts.push(h('li', {}, h('span', { class: 'pf-plan-fact-k' }, 'Matérias no anúncio'), h('span', { class: 'pf-plan-fact-v' }, `até ${row.max_subjects}`)));
    facts.push(h('li', {}, h('span', { class: 'pf-plan-fact-k' }, 'Visibilidade na busca'), h('span', { class: 'pf-plan-fact-v' }, visibilityText(row.rank_tier))));
  }
  facts.push(h('li', {}, h('span', { class: 'pf-plan-fact-k' }, 'Selo no anúncio'),
    h('span', { class: 'pf-plan-fact-v' }, code === 'premium' ? 'Destaque' : code === 'profissional' ? 'Profissional' : 'Nenhum')));

  const cta = code === 'premium'
    ? h('a', { class: 'btn btn-primary btn-sm', href: PLANOS_URL }, 'Renovar plano')
    : code === 'profissional'
      ? h('a', { class: 'btn btn-primary btn-sm', href: PLANOS_URL }, 'Renovar ou fazer upgrade')
      : h('a', { class: 'btn btn-primary btn-sm', href: PLANOS_URL }, 'Ver planos pagos');

  return h('section', { class: ['pf-panel', 'pf-plan-now', code !== 'basico' ? 'is-paid' : null], 'aria-labelledby': titleId },
    h('div', { class: 'pf-plan-now-main' },
      h('p', { class: 'pf-plan-now-kicker' }, 'Plano atual'),
      h('h3', { class: 'pf-plan-now-name', id: titleId }, name, planBadge(code)),
      lines),
    h('ul', { class: 'pf-plan-facts' }, facts),
    h('div', { class: 'pf-plan-now-actions' }, cta,
      h('p', { class: 'pf-hint' }, 'Pagamento único por Pix ou cartão, sem renovação automática.')));
}

function historyTable(rows, plans) {
  const head = ['Data', 'Plano', 'Período', 'Valor', 'Situação'];
  return h('div', { class: 'pf-table-wrap pf-pay-table-wrap' },
    h('table', { class: 'pf-table pf-pay-table' },
      h('caption', { class: 'pf-sr-only' }, 'Histórico de pagamentos'),
      h('thead', {}, h('tr', {}, head.map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, rows.map((r) => {
        const info = paymentStatusInfo(r);
        const link = (r.status === 'pending' || r.status === 'in_process') && info.tone !== 'muted' ? paymentStatusUrl(r.id) : null;
        return h('tr', {},
          h('td', { 'data-label': 'Data' }, formatDate(r.created_at) || '—'),
          h('td', { 'data-label': 'Plano' }, planName(r.plan, plans)),
          h('td', { 'data-label': 'Período' }, periodLabel(r.months)),
          h('td', { 'data-label': 'Valor', class: 'pf-plan-nowrap' }, brl(r.amount_cents)),
          h('td', { 'data-label': 'Situação' },
            h('span', { class: 'pf-pay-status' },
              paymentStatusBadge(r),
              link ? h('a', { class: 'pf-pay-link', href: link }, 'Ver status') : null),
            info.note ? h('span', { class: 'pf-pay-note' }, info.note) : null));
      }))));
}

async function loadHistory(box, profile, plans) {
  box.setAttribute('aria-busy', 'true');
  box.replaceChildren(h('p', { class: 'pf-loading' }, 'Carregando pagamentos…'));
  try {
    const { data, error } = await sb
      .from('payments')
      .select('id,plan,months,amount_cents,status,applied_at,created_at')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
      box.replaceChildren(emptyState('Você ainda não fez nenhum pagamento.', { label: 'Conhecer os planos', href: PLANOS_URL }));
    } else {
      box.replaceChildren(historyTable(rows, plans),
        h('p', { class: 'pf-hint pf-pay-foot' },
          'Pagamentos aprovados ativam o plano automaticamente. Arrependeu-se? Você pode desistir em até 7 dias após a confirmação (veja os ',
          h('a', { href: '/professores/termos.html#planos' }, 'Termos de Uso'), ').'));
    }
  } catch (err) {
    box.replaceChildren(h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' },
      h('p', {}, 'Não foi possível carregar seus pagamentos. ', errorMsg(err)),
      h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => loadHistory(box, profile, plans) }, 'Tentar de novo'))));
  } finally {
    box.removeAttribute('aria-busy');
  }
}

async function loadPlans() {
  try {
    const { data, error } = await sb.from('plans').select('code,name,max_subjects,rank_tier').order('rank_tier');
    if (error) return null;
    return Array.isArray(data) ? data : null;
  } catch {
    return null; // sem a tabela, usa nomes/ordem fixos
  }
}

/**
 * Plano atual (effective_plan), validade, histórico de pagamentos e link para /professores/planos.html.
 * @param {HTMLElement} container
 * @param {{ profile: object }} opts  profile = auth.getProfile() (profile.tutor tem plan/plan_expires_at)
 * @returns {Promise<void>}
 */
export async function mountPlanTab(container, { profile } = {}) {
  if (!container) return;
  const intro = h('div', { class: 'pf-tab-intro' },
    h('h2', {}, 'Meu plano'),
    h('p', {}, 'Seu plano atual, a validade e o histórico de pagamentos.'));

  if (!profile) {
    container.replaceChildren(intro, emptyState('Entre na sua conta para ver seu plano.', { label: 'Entrar', href: '/professores/entrar.html' }));
    return;
  }
  if (profile.role !== 'tutor') {
    container.replaceChildren(intro, emptyState('Os planos são para professores. Crie seu anúncio de professor (grátis) para escolher um plano.',
      { label: 'Ver planos', href: PLANOS_URL }));
    return;
  }
  if (!profile.tutor) {
    container.replaceChildren(intro, emptyState('Não encontramos seu anúncio de professor. Crie-o de novo pelo aviso no topo do painel para escolher um plano.'));
    return;
  }

  container.replaceChildren(intro, h('p', { class: 'pf-loading', role: 'status' }, 'Carregando seu plano…'));
  const plans = await loadPlans();

  const histTitle = `pfPayHist${++seq}`;
  const history = h('div', { class: 'pf-pay-history-body', 'aria-live': 'polite' });
  container.replaceChildren(
    intro,
    h('div', { class: 'pf-plan-tab' },
      currentPlanPanel(profile, plans),
      h('section', { class: 'pf-pay-history', 'aria-labelledby': histTitle },
        h('h3', { class: 'pf-pay-history-title', id: histTitle }, 'Histórico de pagamentos'),
        history)));
  await loadHistory(history, profile, plans);
}
