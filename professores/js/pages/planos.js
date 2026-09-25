/* ============================================
   Página: Planos para professores (dono: planos)
   Cards da tabela `plans` + preços de rpc('plan_price') (fonte única; o Básico é grátis),
   seletor de período (1/3/12 meses, ?periodo=), plano em vigor do professor logado e checkout:
   Edge Function create-checkout -> { init_point } -> Mercado Pago.
   Plano inferior com um superior ativo fica bloqueado aqui e no servidor (409).
   ============================================ */

import '../../css/planos.css';
import { sb } from '../supabase.js';
import { isConfigured } from '../config.js';
import {
  initChrome, h, brl, errorMsg, emptyState, notConfiguredNotice, qsGet, qsSet, modal, planBadge,
} from '../ui.js';
import { getSession, getProfile, loginUrl } from '../auth.js';
import {
  PERIODS, PLANOS_URL, effectivePlan, planName, planRank, visibilityText, periodLabel, longDate, daysLeftText,
} from '../components/painel-plano.js';

const PAINEL = '/professores/painel.html';
const CADASTRO = `/professores/entrar.html?modo=cadastro&tipo=professor&next=${encodeURIComponent(PLANOS_URL)}`;
const TERMOS_PLANOS = '/professores/termos.html#planos';

const state = {
  plans: [], // linhas de `plans` ordenadas por rank_tier
  prices: {}, // { profissional: { 1: 2990, 3: 8073, 12: 26910 } } em centavos (null = indisponível)
  months: 1,
  viewer: { kind: 'anon' }, // anon | student | tutor
  body: null,
  grid: null,
  live: null,
  checkout: null, // modal aberto
  redirecting: false,
};

// ---------- Dados ----------

async function loadPlans() {
  const { data, error } = await sb
    .from('plans')
    .select('code,name,price_cents_month,max_subjects,rank_tier,features')
    .order('rank_tier', { ascending: true });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).filter((p) => p && typeof p.code === 'string');
}

// Preço de cada plano pago em cada período, sempre calculado no banco
async function loadPrices(plans) {
  const out = {};
  const jobs = [];
  for (const p of plans) {
    if (p.code === 'basico') continue;
    out[p.code] = {};
    for (const m of PERIODS) {
      jobs.push(Promise.resolve()
        .then(() => sb.rpc('plan_price', { p_plan: p.code, p_months: m }))
        .then(({ data, error }) => (!error && Number.isInteger(data) && data > 0 ? data : null))
        .catch(() => null)
        .then((cents) => { out[p.code][m] = cents; }));
    }
  }
  await Promise.all(jobs);
  return out;
}

async function loadViewer() {
  const session = await getSession();
  if (!session) return { kind: 'anon' };
  const profile = await getProfile();
  if (!profile) return { kind: 'anon' };
  const banned = Boolean(profile.banned_at);
  if (profile.role !== 'tutor' || !profile.tutor) return { kind: 'student', profile, banned };
  const tutor = profile.tutor;
  const current = effectivePlan(tutor);
  let blocked = null;
  if (banned) blocked = 'Sua conta está suspensa e não pode contratar planos.';
  else if (tutor.suspended) blocked = 'Seu anúncio está suspenso pela moderação. Não é possível contratar planos enquanto a suspensão durar.';
  return { kind: 'tutor', profile, tutor, current, expiresAt: current !== 'basico' ? tutor.plan_expires_at : null, blocked };
}

function priceOf(code, months) {
  const v = state.prices[code]?.[months];
  return Number.isInteger(v) ? v : null;
}

function paidPlans() {
  return state.plans.filter((p) => p.code !== 'basico');
}

// % de desconto do período (igual para todos os planos pagos): usa o 1º plano com os dois preços
function periodDiscount(months) {
  if (months === 1) return 0;
  for (const p of paidPlans()) {
    const one = priceOf(p.code, 1);
    const total = priceOf(p.code, months);
    if (one && total) return Math.max(0, Math.round((1 - total / (one * months)) * 100));
  }
  return 0;
}

// ---------- Topo: situação de quem está vendo ----------

function viewerBox() {
  const v = state.viewer;
  if (v.kind === 'anon') {
    return h('p', { class: 'pf-plans-login' },
      'Já é professor no Quanta Aulas? ', h('a', { href: loginUrl() }, 'Entre na sua conta'), ' para contratar ou renovar um plano.');
  }
  if (v.kind === 'student') {
    if (v.banned) {
      return h('div', { class: 'pf-notice pf-notice--erro', role: 'status' },
        h('p', {}, 'Sua conta está suspensa e não pode contratar planos.'));
    }
    return h('div', { class: 'pf-notice pf-plans-student', role: 'status' },
      h('h2', { class: 'pf-notice-title' }, 'Você está usando uma conta de aluno'),
      h('p', {}, 'Os planos são para professores. Crie seu anúncio de professor (é grátis) e depois escolha um plano para aparecer mais na busca.'),
      h('div', {}, h('a', { class: 'btn btn-primary btn-sm', href: PAINEL }, 'Crie seu anúncio de professor')));
  }

  const code = v.current;
  const t = v.tutor;
  let line;
  if (code !== 'basico') {
    line = h('p', {}, 'Válido até ', h('strong', {}, longDate(v.expiresAt)), ` (${daysLeftText(v.expiresAt)}).`);
  } else if (t.plan && t.plan !== 'basico' && t.plan_expires_at) {
    line = h('p', {}, `Seu plano ${planName(t.plan, state.plans)} venceu em ${longDate(t.plan_expires_at)}. Seu anúncio voltou ao Básico.`);
  } else {
    line = h('p', {}, 'Plano gratuito. Contrate um plano pago para aparecer mais na busca e anunciar mais matérias.');
  }
  return h('div', { class: 'pf-stack' },
    h('section', { class: ['pf-panel', 'pf-plans-me', code !== 'basico' ? 'is-paid' : null], 'aria-labelledby': 'pfPlansMeTitle' },
      h('div', { class: 'pf-plans-me-main' },
        h('p', { class: 'pf-plan-now-kicker' }, 'Seu plano atual'),
        h('h2', { class: 'pf-plans-me-name', id: 'pfPlansMeTitle' }, planName(code, state.plans), planBadge(code)),
        line),
      h('a', { class: 'btn btn-ghost btn-sm', href: `${PAINEL}#plano` }, 'Histórico de pagamentos')),
    v.blocked ? h('div', { class: 'pf-notice pf-notice--erro', role: 'status', id: 'pfPlansBlocked' }, h('p', {}, v.blocked)) : null);
}

// ---------- Seletor de período ----------

function periodPicker() {
  const opts = PERIODS.map((m) => {
    const id = `pfPeriodo${m}`;
    const off = periodDiscount(m);
    return h('label', { class: 'pf-period-opt', for: id },
      h('input', {
        type: 'radio', name: 'periodo', id, value: String(m), class: 'pf-period-input',
        checked: state.months === m, onChange: () => setMonths(m),
      }),
      h('span', { class: 'pf-period-text' }, periodLabel(m)),
      off > 0 ? h('span', { class: 'pf-period-off' }, `−${off}%`) : null);
  });
  return h('fieldset', { class: 'pf-fieldset pf-period' },
    h('legend', { class: 'pf-period-legend' }, 'Período de contratação'),
    h('div', { class: 'pf-period-opts' }, opts));
}

function setMonths(m) {
  if (!PERIODS.includes(m) || m === state.months) return;
  state.months = m;
  qsSet({ periodo: m === 1 ? null : m });
  renderCards();
  if (state.live) state.live.textContent = `Mostrando preços para ${periodLabel(m)}.`;
}

// ---------- Cards ----------

function priceBlock(plan) {
  if (plan.code === 'basico') {
    return h('div', { class: 'pf-plan-price' },
      h('p', { class: 'pf-plan-amount' }, h('span', { class: 'pf-plan-amount-num' }, 'Grátis')),
      h('p', { class: 'pf-plan-price-note' }, 'Para sempre, sem cartão.'));
  }
  const m = state.months;
  const total = priceOf(plan.code, m);
  if (total == null) {
    return h('div', { class: 'pf-plan-price' },
      h('p', { class: 'pf-plan-amount' }, h('span', { class: 'pf-plan-amount-num', 'aria-hidden': 'true' }, '—')),
      h('p', { class: 'pf-plan-price-note' }, 'Preço indisponível no momento.'));
  }
  const monthly = Math.round(total / m);
  const one = priceOf(plan.code, 1);
  const full = one ? one * m : 0;
  const save = m > 1 && full > total ? full - total : 0;
  return h('div', { class: 'pf-plan-price' },
    h('p', { class: 'pf-plan-amount' },
      h('span', { class: 'pf-plan-amount-num pf-plan-nowrap' }, brl(monthly)),
      h('span', { class: 'pf-plan-amount-unit' }, '/mês')),
    h('p', { class: 'pf-plan-price-note' },
      m === 1
        ? ['Pagamento único de ', h('span', { class: 'pf-plan-nowrap' }, brl(total)), ' por 1 mês.']
        : ['Total de ', h('span', { class: 'pf-plan-nowrap' }, brl(total)), ` por ${periodLabel(m)}.`]),
    save > 0
      ? h('p', { class: 'pf-plan-save' }, 'Economia de ', h('span', { class: 'pf-plan-nowrap' }, brl(save)), ` (${Math.round((save / full) * 100)}%)`)
      : null);
}

function ctaFor(plan) {
  const code = plan.code;
  const free = code === 'basico';
  const v = state.viewer;
  const btnClass = ['btn', 'btn-block', free ? 'btn-ghost' : 'btn-primary'];

  if (v.kind === 'anon') {
    return h('a', { class: btnClass, href: CADASTRO }, free ? 'Criar conta grátis' : 'Começar como professor');
  }
  if (v.kind === 'student') {
    if (v.banned) return null;
    return h('a', { class: btnClass, href: PAINEL }, 'Crie seu anúncio de professor');
  }

  // Professor
  if (free) {
    if (v.current === 'basico') return h('p', { class: 'pf-plan-here' }, 'Seu plano atual');
    return h('p', { class: 'pf-plan-why' },
      `Seu anúncio volta ao Básico automaticamente quando o plano ${planName(v.current, state.plans)} vencer.`);
  }

  const whyId = `pfPlanWhy-${code}`;
  const curName = planName(v.current, state.plans);
  let label;
  let why = null;
  let disabled = false;
  let kind = 'new';
  if (planRank(code, state.plans) < planRank(v.current, state.plans)) {
    label = `Contratar ${plan.name}`;
    disabled = true;
    why = `Você tem o plano ${curName} ativo até ${longDate(v.expiresAt)}. Planos inferiores só podem ser contratados depois do vencimento.`;
  } else if (code === v.current) {
    kind = 'renew';
    label = 'Renovar / estender';
    why = `Os meses novos são somados à validade atual (até ${longDate(v.expiresAt)}).`;
  } else if (v.current !== 'basico') {
    kind = 'upgrade';
    label = `Fazer upgrade para ${plan.name}`;
    why = `O ${plan.name} começa a valer na confirmação do pagamento; o tempo restante do ${curName} não é somado.`;
  } else {
    label = `Contratar ${plan.name}`;
  }
  if (v.blocked) {
    disabled = true;
    why = v.blocked;
  } else if (!disabled && priceOf(code, state.months) == null) {
    disabled = true;
    why = 'Preço indisponível no momento. Recarregue a página para tentar de novo.';
  }

  const btn = h('button', {
    type: 'button',
    class: ['btn', 'btn-block', disabled ? 'btn-ghost' : 'btn-primary'],
    disabled,
    'aria-describedby': why ? whyId : null,
    onClick: () => openCheckout(plan, kind),
  }, label);
  return [btn, why ? h('p', { class: 'pf-plan-why', id: whyId }, why) : null];
}

function planCard(plan) {
  const code = plan.code;
  const v = state.viewer;
  const isCurrent = v.kind === 'tutor' && v.current === code;
  const titleId = `pfPlanT-${code}`;
  const features = (Array.isArray(plan.features) ? plan.features : [])
    .filter((f) => typeof f === 'string' && f.trim());
  let tag = null;
  if (isCurrent) tag = h('span', { class: 'pf-badge pf-badge--ok' }, 'Seu plano');
  else if (code === 'premium') tag = h('span', { class: 'pf-plan-tag' }, 'Mais visibilidade');

  return h('article', {
    class: ['pf-plan-card', code === 'premium' ? 'is-featured' : null, isCurrent ? 'is-current' : null],
    'aria-labelledby': titleId,
    dataset: { plan: code },
  },
  h('div', { class: 'pf-plan-card-top' },
    h('h3', { class: 'pf-plan-name', id: titleId }, plan.name || planName(code)),
    tag),
  priceBlock(plan),
  features.length ? h('ul', { class: 'pf-plan-features' }, features.map((f) => h('li', {}, f))) : null,
  h('div', { class: 'pf-plan-cta' }, ctaFor(plan)));
}

function renderCards() {
  if (!state.grid) return;
  state.grid.replaceChildren(...state.plans.map(planCard));
}

// ---------- Comparação ----------

function yes() {
  return [h('span', { class: 'pf-compare-yes', 'aria-hidden': 'true' }, '✓'), h('span', { class: 'pf-sr-only' }, 'Sim')];
}

function compareSection() {
  const plans = state.plans;
  const v = state.viewer;
  const rows = [
    ['Preço (1 mês)', (p) => {
      if (p.code === 'basico') return 'Grátis';
      const one = priceOf(p.code, 1);
      return one != null ? h('span', { class: 'pf-plan-nowrap' }, `${brl(one)}/mês`) : 'Indisponível';
    }],
    ['Matérias no anúncio', (p) => `Até ${p.max_subjects}`],
    ['Visibilidade na busca', (p) => visibilityText(p.rank_tier)],
    ['Selo no anúncio', (p) => (p.code === 'premium' ? '★ Destaque' : p.code === 'profissional' ? 'Profissional' : 'Sem selo')],
    ['Perfil público e mensagens com alunos', yes],
    ['Responder no Tira-dúvidas', yes],
  ];
  return h('section', { class: 'pf-plans-compare', 'aria-labelledby': 'pfCompareTitle' },
    h('h2', { class: 'pf-section-title', id: 'pfCompareTitle' }, 'Compare os planos'),
    h('div', { class: 'pf-table-wrap pf-compare-wrap' },
      h('table', { class: 'pf-table pf-compare' },
        h('caption', { class: 'pf-sr-only' }, 'Comparação dos planos para professores'),
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, 'Recurso'),
          plans.map((p) => h('th', { scope: 'col', class: v.kind === 'tutor' && v.current === p.code ? 'is-current' : null }, p.name)))),
        h('tbody', {}, rows.map(([label, cell]) => h('tr', {},
          h('th', { scope: 'row' }, label),
          plans.map((p) => h('td', { 'data-label': p.name }, cell(p)))))))),
    h('p', { class: 'pf-hint pf-compare-foot' },
      'A posição na busca também depende da busca feita, da localização, das avaliações e de um rodízio diário. Planos não garantem alunos.'));
}

// ---------- Checkout ----------

function checkoutUrl(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// Erro da Edge Function -> { status, message } (a função responde { error } em PT)
async function functionError(error) {
  const res = error && error.context;
  let status = 0;
  let message = '';
  if (res && typeof res.status === 'number' && typeof res.json === 'function') {
    status = res.status;
    try {
      const body = await res.clone().json();
      if (body && typeof body.error === 'string') message = body.error.trim().slice(0, 300);
    } catch { /* corpo não é JSON */ }
  }
  if (!message) {
    if (status === 401) message = 'Sua sessão expirou. Entre novamente para continuar.';
    else if (status === 429) message = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
    else if (status) message = 'Não foi possível iniciar o pagamento. Tente novamente em instantes.';
    else message = errorMsg(res instanceof Error ? res : error); // rede
  }
  return { status, message };
}

async function startCheckout(code, months, { status, alert, button }) {
  if (state.redirecting) return false;
  alert.replaceChildren();
  status.textContent = 'Criando seu pagamento…';
  let res;
  try {
    res = await sb.functions.invoke('create-checkout', { body: { plan: code, months }, timeout: 30_000 });
  } catch (err) {
    res = { data: null, error: err };
  }
  const { data, error } = res || {};
  if (error) {
    status.textContent = '';
    const { status: http, message } = await functionError(error);
    alert.replaceChildren(h('p', {}, message),
      http === 401 ? h('p', {}, h('a', { href: loginUrl() }, 'Entrar novamente')) : null);
    return false;
  }
  const url = checkoutUrl(data && data.init_point);
  if (!url) {
    status.textContent = '';
    alert.replaceChildren(h('p', {}, 'Não foi possível abrir o pagamento. Tente novamente em instantes.'));
    return false;
  }
  state.redirecting = true;
  status.textContent = 'Abrindo o Mercado Pago…';
  button.textContent = 'Abrindo o Mercado Pago…';
  setTimeout(() => { button.disabled = true; }, 0); // o modal reabilita o botão ao fim do onClick
  location.href = url;
  return false; // modal fica aberto enquanto o navegador sai da página
}

function sumRow(label, value) {
  return h('div', { class: 'pf-plan-co-row' }, h('dt', {}, label), h('dd', {}, value));
}

function openCheckout(plan, kind) {
  if (state.redirecting) return;
  const v = state.viewer;
  const m = state.months;
  const total = priceOf(plan.code, m);
  if (total == null || v.kind !== 'tutor' || v.blocked) return;

  const notes = [];
  if (kind === 'renew') {
    notes.push(`Os ${periodLabel(m)} são somados à validade atual do seu plano (hoje até ${longDate(v.expiresAt)}).`);
  } else if (kind === 'upgrade') {
    notes.push(`O plano ${plan.name} começa a valer quando o pagamento for confirmado. O tempo restante do plano ${planName(v.current, state.plans)} (até ${longDate(v.expiresAt)}) não é somado.`);
  } else {
    notes.push('O plano começa a valer assim que o Mercado Pago confirmar o pagamento.');
  }
  const status = h('p', { class: 'pf-plan-co-status', role: 'status', 'aria-live': 'polite' });
  const alert = h('div', { class: 'pf-plan-co-alert', role: 'alert' });
  const content = h('div', { class: 'pf-plan-co' },
    h('dl', { class: 'pf-plan-co-sum' },
      sumRow('Plano', plan.name),
      sumRow('Período', periodLabel(m)),
      sumRow('Total', h('strong', { class: 'pf-plan-nowrap' }, brl(total))),
      m > 1 ? sumRow('Equivale a', h('span', { class: 'pf-plan-nowrap' }, `${brl(Math.round(total / m))}/mês`)) : null),
    notes.map((t) => h('p', { class: 'pf-plan-co-note' }, t)),
    h('p', { class: 'pf-hint' },
      'Você será levado ao Mercado Pago para pagar com Pix ou cartão. Pagamento único, sem renovação automática. Ao continuar, você concorda com os ',
      h('a', { href: TERMOS_PLANOS, target: '_blank', rel: 'noopener' }, 'Termos de Uso'),
      ' (você pode desistir em até 7 dias).'),
    status,
    alert);

  let title = `Contratar plano ${plan.name}`;
  if (kind === 'renew') title = `Renovar plano ${plan.name}`;
  if (kind === 'upgrade') title = `Upgrade para o plano ${plan.name}`;
  state.checkout = modal({
    title,
    content,
    onClose: () => { state.checkout = null; },
    actions: [
      { label: 'Cancelar' },
      { label: 'Ir para o pagamento', primary: true, onClick: ({ button }) => startCheckout(plan.code, m, { status, alert, button }) },
    ],
  });
}

// Voltou do Mercado Pago pelo botão "voltar" (página restaurada do bfcache): destrava
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  state.redirecting = false;
  if (state.checkout) state.checkout.close();
});

// ---------- Página ----------

function skeleton() {
  const card = () => h('div', { class: 'pf-plan-card pf-plan-skel' },
    h('span', { class: 'pf-skel pf-skel-line', style: { width: '45%' } }),
    h('span', { class: 'pf-skel pf-plan-skel-price' }),
    h('span', { class: 'pf-skel pf-skel-line', style: { width: '85%' } }),
    h('span', { class: 'pf-skel pf-skel-line', style: { width: '70%' } }),
    h('span', { class: 'pf-skel pf-plan-skel-btn' }));
  return [
    h('p', { class: 'pf-sr-only', role: 'status' }, 'Carregando planos…'),
    h('div', { class: 'pf-plans-grid', 'aria-hidden': 'true' }, card(), card(), card()),
  ];
}

function render() {
  const body = state.body;
  const missing = paidPlans().some((p) => PERIODS.some((m) => priceOf(p.code, m) == null));
  state.grid = h('div', { class: 'pf-plans-grid' });
  state.live = h('p', { class: 'pf-sr-only', 'aria-live': 'polite' });
  body.replaceChildren(
    viewerBox(),
    h('section', { class: 'pf-plans', 'aria-labelledby': 'pfPlansTitle' },
      h('div', { class: 'pf-plans-bar' },
        h('h2', { class: 'pf-section-title pf-plans-title', id: 'pfPlansTitle' }, 'Escolha seu plano'),
        periodPicker()),
      state.live,
      missing
        ? h('div', { class: 'pf-notice pf-notice--warn pf-plans-warn', role: 'status' },
          h('p', {}, 'Alguns preços não puderam ser carregados agora.'),
          h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => load() }, 'Tentar de novo')))
        : null,
      state.grid,
      h('p', { class: 'pf-hint pf-plans-foot' },
        'Valores em reais. Pagamento único pelo período escolhido, pelo Mercado Pago (Pix ou cartão). Sem renovação automática: ao fim do período, o anúncio volta ao Básico sem nenhuma cobrança.')),
    compareSection());
  renderCards();
}

async function load() {
  const body = state.body;
  body.setAttribute('aria-busy', 'true');
  body.replaceChildren(...skeleton());
  try {
    const [plans, viewer] = await Promise.all([loadPlans(), loadViewer()]);
    state.plans = plans;
    state.viewer = viewer;
    if (!plans.length) {
      body.replaceChildren(emptyState('Nenhum plano disponível no momento. Volte mais tarde.', { label: 'Buscar professores', href: '/professores/' }));
      return;
    }
    state.prices = await loadPrices(plans);
    render();
  } catch (err) {
    body.replaceChildren(h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' },
      h('h2', { class: 'pf-notice-title' }, 'Não foi possível carregar os planos'),
      h('p', {}, errorMsg(err)),
      h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => load() }, 'Tentar de novo'))));
  } finally {
    body.removeAttribute('aria-busy');
  }
}

function main() {
  initChrome();
  const body = document.getElementById('pageBody');
  if (!body) return;
  if (!isConfigured) {
    notConfiguredNotice(body);
    return;
  }
  const p = Number(qsGet('periodo'));
  state.months = PERIODS.includes(p) ? p : 1;
  state.body = body;
  load();
}

main();
