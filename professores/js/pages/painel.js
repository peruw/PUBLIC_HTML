/* ============================================
   Página: Painel do usuário (dono: contas)
   Abas por hash (#anuncio, #materias, #foto, #avaliacoes, #duvidas, #plano, #conta | aluno: #perfil …).
   Professor: anúncio, matérias, foto + componentes (avaliações, tira-dúvidas, plano, conta).
   Aluno: perfil (nome + foto), dúvidas, avaliações, conta e "Quero dar aulas" (rpc become_tutor).
   Grava só colunas liberadas por grant (ver migração 001): tutor_profiles (slug, headline, bio,
   hourly_rate_cents, mode_online, mode_presencial, uf, city_ibge, city_name, published),
   profiles (full_name, avatar_path), tutor_subjects insert/update(levels)/delete.
   ============================================ */

import '../../css/contas.css';
import { sb } from '../supabase.js';
import { isConfigured, SITE_URL } from '../config.js';
import {
  initChrome, h, toast, errorMsg, notConfiguredNotice, avatarEl, planBadge, brl, emptyState,
  skeletonCards, modal, qsGet, qsSet, SUBJECT_LEVELS,
} from '../ui.js';
import { requireAuth, getSession, loginUrl, clearProfileCache, renderAuthSlot } from '../auth.js';
import { cityPicker } from '../municipios.js';
import { mountReviewsTab } from '../components/painel-avaliacoes.js';
import { mountQuestionsTab } from '../components/painel-duvidas.js';
import { mountPlanTab } from '../components/painel-plano.js';
import { mountAccountTab } from '../components/painel-conta.js';

const PAINEL = '/professores/painel.html';
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TUTOR_COLS = 'user_id,slug,headline,bio,hourly_rate_cents,mode_online,mode_presencial,uf,city_ibge,city_name,published,suspended,plan,plan_expires_at,rating_avg,rating_count';
const CATEGORY_ORDER = ['Exatas', 'Ciências', 'Humanas', 'Linguagens', 'Idiomas', 'Tecnologia', 'Música', 'Preparatórios', 'Reforço', 'Outros'];
const MAX_PHOTO_INPUT = 15 * 1024 * 1024; // arquivo original (antes de reduzir)
const MAX_PHOTO_UPLOAD = 2 * 1024 * 1024; // limite do bucket
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

const state = {
  profile: null, // auth.getProfile() (+ email, tutor)
  tutor: null, // == profile.tutor (mesmo objeto)
  subjectCount: null, // nº de matérias do professor (null = ainda não sabe)
  listeners: new Set(), // avisados quando perfil/anúncio/matérias mudam
  dirty: new Set(), // formulários com alterações não salvas
};

const notify = () => state.listeners.forEach((fn) => { try { fn(); } catch { /* ignora */ } });
const isTutor = () => state.profile?.role === 'tutor';
const isBanned = () => Boolean(state.profile?.banned_at);

// ---------- Utilidades ----------

/** Plano efetivo (plano pago vencido volta a ser o básico), igual a public.effective_plan. */
function effectivePlan(t) {
  if (!t || !t.plan || t.plan === 'basico' || !t.plan_expires_at) return 'basico';
  return new Date(t.plan_expires_at).getTime() > Date.now() ? t.plan : 'basico';
}

/** "80", "80,5", "1.200,00", "R$ 90" -> centavos; '' -> null; inválido -> NaN. */
function parseMoney(raw) {
  let s = String(raw ?? '').replace(/R\$|\s/gi, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

/** centavos -> "80,00" (para o campo). */
function moneyInput(cents) {
  if (cents == null) return '';
  return (Number(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

/** Texto -> slug válido (a-z, 0-9 e hífens). */
function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function errorBox(err, retry) {
  return h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' },
    h('h2', { class: 'pf-notice-title' }, 'Não foi possível carregar'),
    h('p', {}, errorMsg(err)),
    retry ? h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: retry }, 'Tentar novamente')) : null);
}

let fieldSeq = 0;

/**
 * Campo de formulário com rótulo, dica, contador e erro (aria-describedby).
 * kind: 'input' | 'textarea'. @returns {{ wrap, input, setError }}
 */
function field({ label, kind = 'input', type = 'text', value = '', maxlength, hint, required = false, counter = false, autocomplete, inputmode, rows, prefix, name }) {
  const id = `pfDash${++fieldSeq}`;
  const hintId = hint ? `${id}-hint` : null;
  const errId = `${id}-err`;
  const attrs = {
    id, name: name || id, maxlength, autocomplete, inputmode, rows,
    class: kind === 'textarea' ? 'pf-textarea' : 'pf-input',
    'aria-describedby': [hintId, errId].filter(Boolean).join(' '),
    'aria-invalid': false,
    value: value ?? '',
  };
  if (kind !== 'textarea') attrs.type = type;
  const input = h(kind, attrs);
  const count = counter && maxlength ? h('span', { class: 'pf-counter', 'aria-hidden': 'true' }) : null;
  const updateCount = () => { if (count) count.textContent = `${input.value.length}/${maxlength}`; };
  updateCount();
  const err = h('p', { class: 'pf-error', id: errId, hidden: true });
  const control = prefix ? h('div', { class: 'pf-money' }, h('span', { class: 'pf-money-prefix', 'aria-hidden': 'true' }, prefix), input) : input;
  const wrap = h('div', { class: 'pf-field' },
    h('div', { class: 'pf-field-head' },
      h('label', { class: 'pf-label', for: id }, label, required ? h('span', { class: 'pf-req', 'aria-hidden': 'true' }, ' *') : null),
      count),
    control,
    hint ? h('p', { class: 'pf-hint', id: hintId }, hint) : null,
    err);
  const setError = (msg) => {
    err.textContent = msg || '';
    err.hidden = !msg;
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    wrap.classList.toggle('is-invalid', Boolean(msg));
  };
  input.addEventListener('input', () => {
    updateCount();
    if (!err.hidden) setError('');
  });
  return { wrap, input, setError };
}

/** Foca um campo mostrando também o rótulo (o nav fixo cobriria o topo). */
function focusField(el) {
  if (!el) return;
  const box = el.closest('.pf-field, .pf-fieldset') || el;
  const r = box.getBoundingClientRect();
  if (r.top < 96 || r.bottom > window.innerHeight) box.scrollIntoView({ block: 'center' });
  el.focus({ preventScroll: true });
}

function checkbox(label, checked, attrs = {}) {
  const input = h('input', { type: 'checkbox', checked: Boolean(checked), ...attrs });
  return { input, label: h('label', { class: 'pf-check' }, input, h('span', {}, label)) };
}

function setBusy(btn, busy, busyLabel = 'Salvando…') {
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.textContent = busyLabel;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  } else {
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

function trackDirty(form, key) {
  form.addEventListener('input', () => state.dirty.add(key));
  form.addEventListener('change', () => state.dirty.add(key));
}

window.addEventListener('beforeunload', (e) => {
  if (state.dirty.size) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------- Dados compartilhados entre abas ----------

let subjectsPromise = null;
function loadSubjects() {
  if (!subjectsPromise) {
    subjectsPromise = sb.from('subjects').select('id,slug,name,category').order('name')
      .then(({ data, error }) => {
        if (error) throw error;
        return data || [];
      })
      .catch((err) => {
        subjectsPromise = null;
        throw err;
      });
  }
  return subjectsPromise;
}

let plansPromise = null;
function loadPlans() {
  if (!plansPromise) {
    plansPromise = sb.from('plans').select('code,name,max_subjects').order('price_cents_month')
      .then(({ data, error }) => {
        if (error) throw error;
        return data || [];
      })
      .catch((err) => {
        plansPromise = null;
        throw err;
      });
  }
  return plansPromise;
}

async function loadTutorSubjects() {
  const { data, error } = await sb.from('tutor_subjects').select('subject_id,levels').eq('tutor_id', state.profile.id);
  if (error) throw error;
  state.subjectCount = (data || []).length;
  notify();
  return data || [];
}

async function refreshProfileChrome() {
  clearProfileCache();
  try { await renderAuthSlot(); } catch { /* opcional */ }
}

// ---------- Cabeçalho do painel ----------

let headEl = null;

function renderHead() {
  if (!headEl) return;
  const p = state.profile;
  const t = state.tutor;
  const badges = [h('span', { class: 'pf-badge' }, isTutor() ? 'Professor' : 'Aluno')];
  if (isTutor() && t) {
    if (t.suspended) badges.push(h('span', { class: 'pf-badge pf-badge--warn' }, 'Anúncio suspenso'));
    else if (t.published) badges.push(h('span', { class: 'pf-badge pf-badge--ok' }, 'Anúncio publicado'));
    else badges.push(h('span', { class: 'pf-badge pf-badge--muted' }, 'Anúncio não publicado'));
    badges.push(planBadge(effectivePlan(t)));
  }
  if (p.is_admin) badges.push(h('span', { class: 'pf-badge' }, 'Admin'));
  if (isBanned()) badges.push(h('span', { class: 'pf-badge pf-badge--warn' }, 'Conta suspensa'));

  const actions = [];
  if (isTutor() && t && SLUG_RE.test(t.slug || '')) {
    actions.push(h('a', { class: 'btn btn-ghost btn-sm', href: `/professores/p/${encodeURIComponent(t.slug)}` },
      t.published ? 'Ver meu perfil público' : 'Pré-visualizar perfil'));
  }
  actions.push(h('a', { class: 'btn btn-ghost btn-sm', href: '/professores/mensagens.html' }, 'Mensagens'));
  if (p.is_admin) actions.push(h('a', { class: 'btn btn-ghost btn-sm', href: '/professores/admin.html' }, 'Moderação'));

  headEl.replaceChildren(
    h('div', { class: 'pf-dash-id' },
      avatarEl(p.avatar_path, p.full_name, 72),
      h('div', { class: 'pf-dash-idtext' },
        h('h2', { class: 'pf-dash-name' }, p.full_name || 'Sem nome'),
        h('div', { class: 'pf-dash-badges' }, badges),
        p.email ? h('p', { class: 'pf-dash-email pf-muted' }, p.email) : null)),
    h('div', { class: 'pf-dash-actions' }, actions));
}

function notices() {
  const out = [];
  if (isBanned()) {
    out.push(h('div', { class: 'pf-notice pf-notice--erro', role: 'status' },
      h('h2', { class: 'pf-notice-title' }, 'Sua conta está suspensa'),
      h('p', {}, 'Você não pode editar o perfil, publicar conteúdo nem enviar mensagens. Ainda é possível exportar seus dados ou excluir a conta na aba "Conta". Se acha que foi um engano, fale com a gente pelo e-mail informado nos Termos de Uso.')));
  }
  if (isTutor() && state.tutor?.suspended) {
    out.push(h('div', { class: 'pf-notice pf-notice--warn', role: 'status' },
      h('h2', { class: 'pf-notice-title' }, 'Anúncio suspenso pela moderação'),
      h('p', {}, 'Seu anúncio não aparece na busca enquanto estiver suspenso. Revise o conteúdo conforme os Termos de Uso e entre em contato para pedir a revisão.')));
  }
  return out;
}

// ---------- Aluno -> professor ----------

function onBecomeTutor() {
  modal({
    title: 'Criar meu anúncio de professor',
    content: h('div', { class: 'pf-stack' },
      h('p', {}, 'Vamos criar seu anúncio de professor (ainda não publicado). Depois é só preencher título, preço e matérias e publicar.'),
      h('p', { class: 'pf-muted' }, 'Ao continuar, você declara ter 18 anos ou mais e concorda com as regras para professores dos Termos de Uso. Suas mensagens e avaliações continuam na sua conta.')),
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Quero dar aulas',
        primary: true,
        onClick: async () => {
          const { error } = await sb.rpc('become_tutor');
          if (error) throw error;
          clearProfileCache();
          state.dirty.clear();
          history.replaceState(null, '', `${PAINEL}#anuncio`);
          location.reload();
          return false;
        },
      },
    ],
  });
}

// ---------- Aba: Meu anúncio ----------

function mountAnuncio(panel) {
  const p = state.profile;
  const t = state.tutor;
  if (!t) {
    panel.replaceChildren(emptyState('Seu anúncio de professor ainda não foi criado.', { label: 'Criar meu anúncio', onClick: onBecomeTutor }));
    return;
  }
  const locked = isBanned();

  const nameF = field({ label: 'Seu nome', value: p.full_name, maxlength: 80, required: true, autocomplete: 'name', hint: 'Aparece no anúncio, na busca e nas mensagens.' });
  const headF = field({ label: 'Título do anúncio', value: t.headline, maxlength: 120, counter: true, hint: 'Ex.: Professora de Matemática para ENEM e vestibulares.' });
  const bioF = field({
    label: 'Sobre você e suas aulas', kind: 'textarea', rows: 9, value: t.bio, maxlength: 4000, counter: true,
    hint: 'Formação, experiência, metodologia e para quem são suas aulas. Não coloque telefone, e-mail, redes sociais ou links: os alunos falam com você pelas mensagens do portal.',
  });
  const priceF = field({ label: 'Valor da hora-aula', value: moneyInput(t.hourly_rate_cents), prefix: 'R$', inputmode: 'decimal', autocomplete: 'off', hint: 'Valor de referência por hora, de R$ 0 a R$ 1.000. Você combina o valor final com o aluno.' });
  const pricePreview = h('p', { class: 'pf-hint' });
  priceF.wrap.append(pricePreview);
  const renderPrice = () => {
    const c = parseMoney(priceF.input.value);
    pricePreview.textContent = c == null || Number.isNaN(c) || c > 100000 ? '' : `No anúncio: ${brl(c)} por hora`;
  };
  renderPrice();
  priceF.input.addEventListener('input', renderPrice);

  const online = checkbox('Aulas online', t.mode_online);
  const presencial = checkbox('Aulas presenciais', t.mode_presencial);
  const modesErr = h('p', { class: 'pf-error', hidden: true, id: `pfDash${++fieldSeq}` });
  const modes = h('fieldset', { class: 'pf-fieldset', 'aria-describedby': modesErr.id },
    h('legend', { class: 'pf-label' }, 'Como você dá aulas'),
    h('div', { class: 'pf-checks-row' }, online.label, presencial.label),
    modesErr);

  let cityTouched = false;
  const picker = cityPicker({ uf: t.uf || '', cityId: t.city_ibge, anyLabel: false, onChange: () => { cityTouched = true; update(); } });
  const cityErr = h('p', { class: 'pf-error', hidden: true, id: `pfDash${++fieldSeq}` });
  const local = h('fieldset', { class: 'pf-fieldset', 'aria-describedby': cityErr.id },
    h('legend', { class: 'pf-label' }, 'Onde você atende'),
    h('p', { class: 'pf-hint', style: { marginBottom: '10px' } }, 'Obrigatório para aulas presenciais. Também ajuda alunos da sua cidade a encontrarem você.'),
    picker,
    cityErr);

  const slugF = field({ label: 'Endereço do seu perfil', value: t.slug, maxlength: 60, required: true, autocomplete: 'off', hint: 'Letras minúsculas, números e hífens (3 a 60 caracteres).' });
  slugF.input.setAttribute('spellcheck', 'false');
  slugF.input.setAttribute('autocapitalize', 'none');
  const slugPreview = h('p', { class: 'pf-slug-preview' });
  slugF.wrap.append(slugPreview);
  const renderSlugPreview = () => {
    slugPreview.replaceChildren(`${SITE_URL.replace(/^https?:\/\//, '')}/professores/p/`, h('b', {}, slugF.input.value.trim() || '…'));
  };
  renderSlugPreview();
  slugF.input.addEventListener('input', renderSlugPreview);
  slugF.input.addEventListener('blur', () => {
    const v = slugF.input.value;
    const s = slugify(v);
    if (s !== v) {
      slugF.input.value = s;
      renderSlugPreview();
    }
  });

  const pub = checkbox('Publicar meu anúncio', t.published);
  const pubHint = h('p', { class: 'pf-hint' });
  const pubBox = h('div', { class: 'pf-publish' }, pub.label, pubHint);

  const alert = h('div', { class: 'pf-form-alert', role: 'alert', 'aria-live': 'assertive' });
  const status = h('div', { class: 'pf-form-ok', role: 'status', 'aria-live': 'polite' });
  const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Salvar anúncio');
  const profileLink = h('a', { class: 'btn btn-ghost btn-sm' });

  const fields = h('fieldset', { class: 'pf-fieldset pf-form', disabled: locked },
    nameF.wrap, headF.wrap, bioF.wrap, priceF.wrap, modes, local, slugF.wrap, pubBox);
  const form = h('form', { class: 'pf-form', novalidate: true, 'aria-label': 'Meu anúncio' },
    fields, alert, status,
    h('div', { class: 'pf-save-bar' }, saveBtn, profileLink));
  if (locked) saveBtn.disabled = true;
  trackDirty(form, 'anuncio');

  // Checklist do que falta para publicar
  const summary = h('p', { class: 'pf-checklist-summary', 'aria-live': 'polite' });
  const reqList = h('ul', { class: 'pf-checklist' });
  const recList = h('ul', { class: 'pf-checklist' });
  const side = h('aside', { class: 'pf-anuncio-side', 'aria-label': 'O que falta para publicar' },
    h('div', { class: 'pf-panel pf-checklist-box' },
      h('h3', {}, 'Para publicar'),
      summary,
      reqList,
      h('div', { class: 'pf-checklist-sub' }, h('h4', {}, 'Recomendado'), recList)));

  function values() {
    const city = picker.getValue();
    const keepCity = !cityTouched; // cidades não carregaram / não mexeu: mantém o que está salvo
    return {
      full_name: nameF.input.value.replace(/\s+/g, ' ').trim(),
      headline: headF.input.value.trim(),
      bio: bioF.input.value.trim(),
      cents: parseMoney(priceF.input.value),
      mode_online: online.input.checked,
      mode_presencial: presencial.input.checked,
      uf: keepCity ? (t.uf || null) : city.uf,
      city_ibge: keepCity ? (t.city_ibge ?? null) : city.cityId,
      city_name: keepCity ? (t.city_name || null) : city.cityName,
      slug: slugF.input.value.trim(),
      published: pub.input.checked,
    };
  }

  function missing(v) {
    const out = [];
    if (!v.headline) out.push({ key: 'headline', text: 'Título do anúncio', focus: headF.input });
    if (v.cents == null || Number.isNaN(v.cents)) out.push({ key: 'price', text: 'Valor da hora-aula', focus: priceF.input });
    if (!v.mode_online && !v.mode_presencial) out.push({ key: 'modes', text: 'Aulas online e/ou presenciais', focus: online.input });
    if (v.mode_presencial && (!v.uf || !v.city_ibge)) out.push({ key: 'city', text: 'Estado e cidade (aulas presenciais)', focus: picker.querySelector('select') });
    if (state.subjectCount === 0) out.push({ key: 'subjects', text: 'Pelo menos 1 matéria', href: '#materias' });
    return out;
  }

  function item(ok, text, { focus, href } = {}) {
    let label = text;
    if (!ok && href) label = h('a', { href }, text);
    else if (!ok && focus) {
      label = h('a', { href: '#', onClick: (e) => { e.preventDefault(); focusField(focus); } }, text);
    }
    return h('li', { class: ok ? 'is-ok' : 'is-missing' },
      h('span', { class: 'pf-ck-icon', 'aria-hidden': 'true' }, ok ? '✓' : ''),
      h('span', {}, h('span', { class: 'pf-sr-only' }, ok ? 'Concluído: ' : 'Pendente: '), label));
  }

  function update() {
    const v = values();
    const miss = missing(v);
    const has = (k) => !miss.some((m) => m.key === k);
    const byKey = Object.fromEntries(miss.map((m) => [m.key, m]));
    const reqItems = [
      item(has('headline'), 'Título do anúncio', byKey.headline),
      item(has('price'), 'Valor da hora-aula', byKey.price),
      item(has('modes'), 'Aulas online e/ou presenciais', byKey.modes),
    ];
    if (v.mode_presencial) reqItems.push(item(has('city'), 'Estado e cidade (aulas presenciais)', byKey.city));
    reqItems.push(state.subjectCount == null
      ? h('li', {}, h('span', { class: 'pf-ck-icon', 'aria-hidden': 'true' }), h('span', {}, 'Pelo menos 1 matéria (verificando…)'))
      : item(has('subjects'), `Pelo menos 1 matéria${state.subjectCount ? ` (${state.subjectCount})` : ''}`, byKey.subjects));
    reqList.replaceChildren(...reqItems);
    recList.replaceChildren(
      item(Boolean(state.profile.avatar_path), 'Foto de perfil', { href: '#foto' }),
      item(v.bio.length >= 80, 'Apresentação com pelo menos 80 caracteres', { focus: bioF.input }));

    const ready = miss.length === 0;
    summary.classList.toggle('is-ready', ready);
    summary.textContent = ready ? 'Tudo pronto para publicar.' : `Falta${miss.length > 1 ? 'm' : ''} ${miss.length} ${miss.length > 1 ? 'itens' : 'item'} para publicar.`;

    pubBox.classList.toggle('is-on', pub.input.checked);
    if (t.suspended) pubHint.textContent = 'Seu anúncio está suspenso pela moderação e não aparece na busca.';
    else if (pub.input.checked) pubHint.textContent = t.published ? 'Seu anúncio está no ar e aparece na busca.' : 'Ao salvar, seu anúncio passa a aparecer na busca.';
    else pubHint.textContent = t.published ? 'Ao salvar, seu anúncio sai da busca (você pode publicar de novo quando quiser).' : 'Seu anúncio ainda não aparece na busca. Complete os itens ao lado e marque esta opção.';

    if (SLUG_RE.test(t.slug || '')) {
      profileLink.hidden = false;
      profileLink.href = `/professores/p/${encodeURIComponent(t.slug)}`;
      profileLink.textContent = t.published ? 'Ver meu perfil público' : 'Pré-visualizar perfil';
    } else profileLink.hidden = true;
  }

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  state.listeners.add(update);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (locked) return;
    alert.textContent = '';
    status.textContent = '';
    [nameF, headF, bioF, priceF, slugF].forEach((f) => f.setError(''));
    modesErr.hidden = true;
    cityErr.hidden = true;

    const v = values();
    let first = null;
    if (v.full_name.length < 2) { nameF.setError('Informe seu nome.'); first ||= nameF.input; }
    if (Number.isNaN(v.cents)) { priceF.setError('Valor inválido. Use só números, como 80 ou 80,50.'); first ||= priceF.input; }
    else if (v.cents != null && (v.cents < 0 || v.cents > 100000)) { priceF.setError('O valor deve ficar entre R$ 0 e R$ 1.000.'); first ||= priceF.input; }
    if (!SLUG_RE.test(v.slug) || v.slug.length < 3 || v.slug.length > 60) {
      slugF.setError('Use de 3 a 60 caracteres: letras minúsculas sem acento, números e hífens (ex.: ana-silva).');
      first ||= slugF.input;
    }
    if (first) {
      alert.textContent = 'Confira os campos destacados.';
      focusField(first);
      return;
    }
    if (v.published) {
      const miss = missing(v);
      if (miss.length) {
        alert.textContent = `Para publicar, complete: ${miss.map((m) => m.text.toLowerCase()).join('; ')}. Você pode salvar sem publicar desmarcando "Publicar meu anúncio".`;
        if (miss.some((m) => m.key === 'modes')) { modesErr.textContent = 'Escolha aulas online e/ou presenciais.'; modesErr.hidden = false; }
        if (miss.some((m) => m.key === 'city')) { cityErr.textContent = 'Escolha estado e cidade para aulas presenciais.'; cityErr.hidden = false; }
        focusField(miss[0].focus || pub.input);
        return;
      }
    }

    // Só colunas com grant de update (nunca plan, suspended, rating…)
    const payload = {
      slug: v.slug,
      headline: v.headline,
      bio: v.bio,
      hourly_rate_cents: v.cents,
      mode_online: v.mode_online,
      mode_presencial: v.mode_presencial,
      uf: v.uf || null,
      city_ibge: v.city_ibge ?? null,
      city_name: v.city_name || null,
      published: v.published,
    };

    setBusy(saveBtn, true);
    try {
      if (v.full_name !== p.full_name) {
        const { data, error } = await sb.from('profiles').update({ full_name: v.full_name }).eq('id', p.id).select('full_name').maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Não foi possível salvar seu nome.');
        p.full_name = data.full_name;
        renderHead();
        refreshProfileChrome();
      }
      const { data, error } = await sb.from('tutor_profiles').update(payload).eq('user_id', p.id).select(TUTOR_COLS).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Não foi possível salvar o anúncio. Recarregue a página e tente de novo.');
      const wasPublished = t.published;
      Object.assign(t, data);
      state.dirty.delete('anuncio');
      renderHead();
      notify();
      const msg = data.published && !wasPublished ? 'Anúncio publicado! Ele já aparece na busca.'
        : !data.published && wasPublished ? 'Anúncio salvo e retirado da busca.'
          : 'Anúncio salvo.';
      status.textContent = msg;
      toast(msg, 'ok');
    } catch (err) {
      const code = err?.code ? String(err.code) : '';
      const text = `${err?.message || ''} ${err?.details || ''}`;
      if (code === '23505' && /slug/i.test(text)) {
        slugF.setError('Este endereço já está em uso por outro professor. Escolha outro.');
        alert.textContent = 'Este endereço de perfil já está em uso. Escolha outro.';
        focusField(slugF.input);
      } else if (code === '23514' && /slug/i.test(text)) {
        slugF.setError('Endereço inválido: use letras minúsculas, números e hífens.');
        alert.textContent = 'Endereço de perfil inválido.';
        focusField(slugF.input);
      } else {
        // P0001 (validação do banco) chega em PT, ex.: "Adicione ao menos uma matéria antes de publicar."
        alert.textContent = errorMsg(err);
      }
      toast(alert.textContent, 'erro');
    } finally {
      setBusy(saveBtn, false);
      if (locked) saveBtn.disabled = true;
    }
  });

  panel.replaceChildren(
    h('div', { class: 'pf-tab-intro' },
      h('h2', {}, 'Meu anúncio'),
      h('p', {}, 'É o que os alunos veem na busca e no seu perfil. Capriche no título e na apresentação.')),
    h('div', { class: 'pf-anuncio' }, form, side));
  update();

  // Nº de matérias para o checklist
  if (state.subjectCount == null) loadTutorSubjects().catch(() => { /* checklist mostra "verificando" */ });
}

// ---------- Aba: Matérias ----------

function mountMaterias(panel) {
  const uid = state.profile.id;
  const locked = isBanned();
  panel.replaceChildren(
    h('div', { class: 'pf-tab-intro' },
      h('h2', {}, 'Matérias'),
      h('p', {}, 'Marque as matérias que você ensina e, se quiser, os níveis. Os alunos encontram você pela busca dessas matérias.')),
    h('div', { 'aria-busy': 'true' }, skeletonCards(2)));

  let subjects = [];
  let plans = [];
  let original = new Map(); // subject_id -> Set(levels)
  let selected = new Map();

  const load = async () => {
    try {
      const [subs, rows, pls] = await Promise.all([loadSubjects(), loadTutorSubjects(), loadPlans()]);
      subjects = subs;
      plans = pls;
      original = new Map(rows.map((r) => [Number(r.subject_id), new Set(r.levels || [])]));
      selected = new Map([...original].map(([k, v]) => [k, new Set(v)]));
      state.dirty.delete('materias');
      render();
    } catch (err) {
      panel.replaceChildren(errorBox(err, load));
    }
  };

  function maxSubjects() {
    const code = effectivePlan(state.tutor);
    return { plan: plans.find((x) => x.code === code) || { code, name: code === 'basico' ? 'Básico' : code, max_subjects: 3 }, code };
  }

  function render() {
    const { plan, code } = maxSubjects();
    const max = Number(plan.max_subjects) || 3;

    const count = h('p', { class: 'pf-subjects-count', 'aria-live': 'polite' });
    const limitMsg = h('p', { class: 'pf-hint', id: `pfDash${++fieldSeq}` });
    const alert = h('div', { class: 'pf-form-alert', role: 'alert', 'aria-live': 'assertive' });
    const saveBtn = h('button', { type: 'button', class: 'btn btn-primary btn-sm', disabled: true }, 'Salvar matérias');
    const bar = h('div', { class: 'pf-subjects-bar' }, h('div', {}, count, limitMsg), saveBtn);

    const filterF = field({ label: 'Filtrar matérias', type: 'search', autocomplete: 'off' });
    filterF.wrap.classList.add('pf-subjects-filter');

    // Agrupa por categoria na ordem definida
    const groups = new Map();
    for (const s of subjects) {
      if (!groups.has(s.category)) groups.set(s.category, []);
      groups.get(s.category).push(s);
    }
    const cats = [...groups.keys()].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return collator.compare(a, b);
    });

    const rows = []; // { s, el, input, levelsBox }
    const grid = h('div', { class: 'pf-subjects-grid' });
    const noMatch = h('p', { class: 'pf-muted pf-subjects-empty', hidden: true }, 'Nenhuma matéria encontrada com esse nome.');
    for (const cat of cats) {
      const list = groups.get(cat).sort((a, b) => collator.compare(a.name, b.name));
      const fs = h('fieldset', { class: 'pf-subj-cat' }, h('legend', {}, cat));
      for (const s of list) {
        const id = Number(s.id);
        const input = h('input', { type: 'checkbox', value: id, checked: selected.has(id), 'aria-describedby': limitMsg.id });
        const chips = SUBJECT_LEVELS.map((lv) => {
          const btn = h('button', { type: 'button', class: 'pf-chip pf-chip-sm', 'aria-pressed': Boolean(selected.get(id)?.has(lv.id)) }, lv.label);
          btn.addEventListener('click', () => {
            const set = selected.get(id);
            if (!set || locked) return;
            if (set.has(lv.id)) set.delete(lv.id); else set.add(lv.id);
            btn.setAttribute('aria-pressed', String(set.has(lv.id)));
            changed();
          });
          return btn;
        });
        const levelsBox = h('div', { class: 'pf-subj-levels', hidden: !selected.has(id) },
          h('span', { class: 'pf-label-sm', 'aria-hidden': 'true' }, 'Níveis (opcional)'),
          h('div', { class: 'pf-chips', role: 'group', 'aria-label': `Níveis de ${s.name} (opcional)` }, chips));
        const el = h('div', { class: ['pf-subj', selected.has(id) ? 'is-on' : null] },
          h('label', { class: 'pf-check' }, input, h('span', {}, s.name)),
          levelsBox);
        input.addEventListener('change', () => {
          if (input.checked) {
            if (selected.size >= max) {
              input.checked = false;
              toast(`Seu plano ${plan.name} permite até ${max} matérias.`, 'erro');
              return;
            }
            selected.set(id, new Set(original.get(id) || []));
          } else {
            selected.delete(id);
          }
          levelsBox.hidden = !input.checked;
          el.classList.toggle('is-on', input.checked);
          if (!input.checked) chips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
          else chips.forEach((c, i) => c.setAttribute('aria-pressed', String(selected.get(id).has(SUBJECT_LEVELS[i].id))));
          changed();
        });
        rows.push({ s, el, input, fs });
        fs.append(el);
      }
      grid.append(fs);
    }
    grid.append(noMatch);

    filterF.input.addEventListener('input', () => {
      const q = filterF.input.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      let any = false;
      const visibleCats = new Set();
      for (const r of rows) {
        const name = r.s.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const show = !q || name.includes(q);
        r.el.hidden = !show;
        if (show) { any = true; visibleCats.add(r.fs); }
      }
      rows.forEach((r) => { r.fs.hidden = !visibleCats.has(r.fs); });
      noMatch.hidden = any;
    });

    function isDirty() {
      if (selected.size !== original.size) return true;
      for (const [id, lv] of selected) {
        if (!original.has(id) || !sameSet(original.get(id), lv)) return true;
      }
      return false;
    }

    function changed() {
      const n = selected.size;
      const atLimit = n >= max;
      count.replaceChildren(`${n} de ${max} matérias`, h('small', {}, `Plano ${plan.name}`));
      limitMsg.replaceChildren();
      if (n > max) {
        limitMsg.append(`Você tem mais matérias do que o plano ${plan.name} permite (${max}). As atuais continuam no anúncio; para adicionar outras, remova algumas ou `,
          h('a', { href: '/professores/planos.html' }, 'troque de plano'), '.');
      } else if (atLimit) {
        limitMsg.append(`Você chegou ao limite do plano ${plan.name}. `,
          code === 'premium' ? null : h('a', { href: '/professores/planos.html' }, 'Veja os planos'),
          code === 'premium' ? 'Desmarque uma matéria para escolher outra.' : ' para adicionar mais matérias.');
      } else {
        limitMsg.textContent = `Você pode escolher mais ${max - n}.`;
      }
      for (const r of rows) r.input.disabled = locked || (!r.input.checked && atLimit);
      const dirty = isDirty();
      saveBtn.disabled = locked || !dirty;
      if (dirty) state.dirty.add('materias'); else state.dirty.delete('materias');
    }

    saveBtn.addEventListener('click', async () => {
      alert.textContent = '';
      setBusy(saveBtn, true);
      let saved = false;
      try {
        await saveDiff(max);
        saved = true;
      } catch (err) {
        alert.textContent = errorMsg(err);
        toast(alert.textContent, 'erro');
      }
      // Recarrega do banco (o estado real, mesmo depois de erro no meio)
      try {
        const rowsNow = await loadTutorSubjects();
        original = new Map(rowsNow.map((r) => [Number(r.subject_id), new Set(r.levels || [])]));
        if (saved) {
          selected = new Map([...original].map(([k, v]) => [k, new Set(v)]));
          state.dirty.delete('materias');
          toast('Matérias salvas.', 'ok');
          render();
          // O botão foi recriado (e está desabilitado): foco vai para o contador
          const c = panel.querySelector('.pf-subjects-count');
          if (c) { c.tabIndex = -1; c.focus(); }
          return;
        }
      } catch { /* mantém a tela como está */ }
      setBusy(saveBtn, false);
      changed();
    });

    async function saveDiff(maxN) {
      const del = [...original.keys()].filter((id) => !selected.has(id));
      const ins = [...selected.keys()].filter((id) => !original.has(id));
      const upd = [...selected.keys()].filter((id) => original.has(id) && !sameSet(original.get(id), selected.get(id)));
      let n = original.size;
      const published = Boolean(state.tutor?.published);
      // Intercala inclusões e remoções: respeita o limite do plano e nunca zera
      // as matérias de um anúncio publicado no meio do caminho
      while (ins.length || del.length) {
        const room = maxN - n;
        if (ins.length && room > 0) {
          const batch = ins.splice(0, room);
          // insert() puro (sem upsert com merge: só "levels" pode ser atualizado)
          const { error } = await sb.from('tutor_subjects').insert(batch.map((id) => ({ tutor_id: uid, subject_id: id, levels: [...selected.get(id)] })));
          if (error) throw error;
          n += batch.length;
          continue;
        }
        if (del.length) {
          let k = ins.length ? Math.max(1, n + ins.length - maxN) : del.length;
          if (ins.length && published) k = Math.min(k, n - 1);
          k = Math.max(1, Math.min(k, del.length));
          const batch = del.splice(0, k);
          const { error } = await sb.from('tutor_subjects').delete().eq('tutor_id', uid).in('subject_id', batch);
          if (error) throw error;
          n -= batch.length;
          continue;
        }
        throw new Error(`Seu plano permite até ${maxN} matérias.`);
      }
      for (const id of upd) {
        const { error } = await sb.from('tutor_subjects').update({ levels: [...selected.get(id)] }).eq('tutor_id', uid).eq('subject_id', id);
        if (error) throw error;
      }
    }

    panel.replaceChildren(
      h('div', { class: 'pf-tab-intro' },
        h('h2', {}, 'Matérias'),
        h('p', {}, 'Marque as matérias que você ensina e, se quiser, os níveis. Os alunos encontram você pela busca dessas matérias.')),
      bar, alert, filterF.wrap, grid);
    changed();
  }

  load();
}

// ---------- Foto ----------

/** Lê a imagem e recorta no centro em um quadrado de até `size` px. */
async function imageToCanvas(file, size = 512) {
  let src;
  let cleanup = () => {};
  try {
    src = await createImageBitmap(file);
    cleanup = () => src.close?.();
  } catch {
    // Fallback: <img> fora do DOM só para decodificar (não vai para a página)
    const url = URL.createObjectURL(file);
    cleanup = () => URL.revokeObjectURL(url);
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
  }
  try {
    const w = src.width || src.naturalWidth;
    const hgt = src.height || src.naturalHeight;
    if (!w || !hgt) throw new Error('decode');
    const side = Math.min(w, hgt);
    const out = Math.min(size, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, (w - side) / 2, (hgt - side) / 2, side, side, 0, 0, out, out);
    return canvas;
  } finally {
    cleanup();
  }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** WebP (ou JPEG, se o navegador não gerar WebP). */
async function encodeAvatar(canvas) {
  const webp = await canvasBlob(canvas, 'image/webp', 0.85);
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp' };
  const jpg = await canvasBlob(canvas, 'image/jpeg', 0.88);
  if (!jpg) throw new Error('encode');
  return { blob: jpg, ext: 'jpg' };
}

function storageErrorText(err) {
  const status = Number(err?.statusCode || err?.status || 0);
  const msg = String(err?.message || '');
  if (status === 413 || /too large|exceeded the maximum/i.test(msg)) return 'Imagem muito grande. Escolha uma foto menor.';
  if (/mime|type .* not supported|invalid_mime/i.test(msg)) return 'Formato não aceito. Use JPG, PNG ou WebP.';
  if (status === 403 || /row-level security|unauthorized/i.test(msg)) return 'Você não tem permissão para trocar a foto agora.';
  return errorMsg(err);
}

function photoSection() {
  const p = state.profile;
  const uid = p.id;
  const locked = isBanned();

  const frame = h('div', { class: 'pf-photo-frame' });
  const inputId = `pfDash${++fieldSeq}`;
  const hintId = `${inputId}-hint`;
  const input = h('input', { type: 'file', id: inputId, class: 'pf-file', accept: 'image/jpeg,image/png,image/webp', 'aria-describedby': hintId, disabled: locked });
  const status = h('p', { class: 'pf-hint', role: 'status', 'aria-live': 'polite' });
  const alert = h('div', { class: 'pf-form-alert', role: 'alert', 'aria-live': 'assertive' });
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary btn-sm', hidden: true }, 'Salvar foto');
  const cancelBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', hidden: true }, 'Cancelar');
  const removeBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-danger' }, 'Remover foto');

  let pending = null; // { canvas, blob, ext }

  const showCurrent = () => {
    frame.replaceChildren(avatarEl(state.profile.avatar_path, state.profile.full_name, 130));
    removeBtn.hidden = !state.profile.avatar_path || locked;
  };
  const reset = () => {
    pending = null;
    input.value = '';
    saveBtn.hidden = true;
    cancelBtn.hidden = true;
    showCurrent();
  };

  input.addEventListener('change', async () => {
    alert.textContent = '';
    status.textContent = '';
    const file = input.files && input.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      alert.textContent = 'Escolha um arquivo de imagem (JPG, PNG ou WebP).';
      input.value = '';
      return;
    }
    if (file.size > MAX_PHOTO_INPUT) {
      alert.textContent = 'Imagem muito grande (máximo 15 MB).';
      input.value = '';
      return;
    }
    status.textContent = 'Preparando a foto…';
    try {
      const canvas = await imageToCanvas(file, 512);
      const { blob, ext } = await encodeAvatar(canvas);
      if (blob.size > MAX_PHOTO_UPLOAD) throw Object.assign(new Error('big'), { statusCode: 413 });
      pending = { canvas, blob, ext };
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Prévia da nova foto');
      frame.replaceChildren(canvas);
      saveBtn.hidden = false;
      cancelBtn.hidden = false;
      status.textContent = 'Prévia pronta. Clique em "Salvar foto" para usar esta imagem.';
      saveBtn.focus();
    } catch (err) {
      status.textContent = '';
      alert.textContent = err?.statusCode === 413 ? storageErrorText(err) : 'Não foi possível ler esta imagem. Tente uma foto em JPG ou PNG.';
      reset();
    }
  });

  cancelBtn.addEventListener('click', () => {
    reset();
    status.textContent = 'Troca de foto cancelada.';
    input.focus();
  });

  saveBtn.addEventListener('click', async () => {
    if (!pending) return;
    alert.textContent = '';
    setBusy(saveBtn, true, 'Enviando…');
    cancelBtn.disabled = true;
    const path = `${uid}/avatar-${Date.now()}.${pending.ext}`;
    const old = state.profile.avatar_path;
    try {
      const { error: upErr } = await sb.storage.from('avatars').upload(path, pending.blob, {
        contentType: pending.blob.type, cacheControl: '31536000', upsert: false,
      });
      if (upErr) throw upErr;
      const { data, error } = await sb.from('profiles').update({ avatar_path: path }).eq('id', uid).select('avatar_path').maybeSingle();
      if (error || !data) {
        await sb.storage.from('avatars').remove([path]).catch(() => {});
        throw error || new Error('Não foi possível salvar a foto.');
      }
      state.profile.avatar_path = data.avatar_path;
      // Apaga a foto anterior (só da própria pasta)
      if (old && old !== path && old.startsWith(`${uid}/`)) {
        try { await sb.storage.from('avatars').remove([old]); } catch { /* arquivo órfão não quebra nada */ }
      }
      reset();
      renderHead();
      notify();
      refreshProfileChrome();
      status.textContent = 'Foto atualizada.';
      toast('Foto atualizada.', 'ok');
    } catch (err) {
      alert.textContent = storageErrorText(err);
      toast(alert.textContent, 'erro');
    } finally {
      setBusy(saveBtn, false);
      cancelBtn.disabled = false;
    }
  });

  removeBtn.addEventListener('click', () => {
    modal({
      title: 'Remover foto',
      content: h('p', {}, 'Sua foto será apagada e o perfil passará a mostrar suas iniciais.'),
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Remover foto',
          danger: true,
          onClick: async () => {
            const old = state.profile.avatar_path;
            const { data, error } = await sb.from('profiles').update({ avatar_path: null }).eq('id', uid).select('avatar_path').maybeSingle();
            if (error) throw error;
            if (!data) throw new Error('Não foi possível remover a foto.');
            state.profile.avatar_path = null;
            if (old && old.startsWith(`${uid}/`)) {
              try { await sb.storage.from('avatars').remove([old]); } catch { /* ignora */ }
            }
            reset();
            renderHead();
            notify();
            refreshProfileChrome();
            status.textContent = 'Foto removida.';
            toast('Foto removida.', 'ok');
          },
        },
      ],
    });
  });

  showCurrent();
  return h('div', { class: 'pf-photo' },
    frame,
    h('div', { class: 'pf-photo-controls' },
      h('label', { class: 'pf-label', for: inputId }, 'Escolher nova foto'),
      input,
      h('ul', { class: 'pf-photo-tips', id: hintId },
        h('li', {}, 'JPG, PNG ou WebP. A foto é recortada em quadrado e reduzida para 512 px.'),
        h('li', {}, 'Use uma foto sua, de rosto, bem iluminada. Fotos com logotipos, textos ou contatos podem ser removidas.')),
      alert, status,
      h('div', { class: 'pf-form-actions' }, saveBtn, cancelBtn, removeBtn)));
}

function mountFoto(panel) {
  panel.replaceChildren(
    h('div', { class: 'pf-tab-intro' },
      h('h2', {}, 'Foto de perfil'),
      h('p', {}, 'Anúncios com foto recebem mais contatos. Ela aparece na busca, no seu perfil e nas mensagens.')),
    h('div', { class: 'pf-panel' }, photoSection()));
}

// ---------- Aba do aluno: Meu perfil ----------

function mountPerfil(panel) {
  const p = state.profile;
  const locked = isBanned();
  const nameF = field({ label: 'Nome completo', value: p.full_name, maxlength: 80, required: true, autocomplete: 'name', hint: 'Para os outros usuários aparece abreviado (ex.: Maria S.) nas avaliações e no tira-dúvidas.' });
  const alert = h('div', { class: 'pf-form-alert', role: 'alert', 'aria-live': 'assertive' });
  const status = h('div', { class: 'pf-form-ok', role: 'status', 'aria-live': 'polite' });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-sm', disabled: locked }, 'Salvar nome');
  const form = h('form', { class: 'pf-form', novalidate: true, 'aria-label': 'Meu nome' },
    h('fieldset', { class: 'pf-fieldset pf-form', disabled: locked }, nameF.wrap), alert, status, h('div', {}, btn));
  trackDirty(form, 'perfil');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alert.textContent = '';
    status.textContent = '';
    nameF.setError('');
    const name = nameF.input.value.replace(/\s+/g, ' ').trim();
    if (name.length < 2) {
      nameF.setError('Informe seu nome completo.');
      focusField(nameF.input);
      return;
    }
    setBusy(btn, true);
    try {
      const { data, error } = await sb.from('profiles').update({ full_name: name }).eq('id', p.id).select('full_name').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Não foi possível salvar seu nome.');
      p.full_name = data.full_name;
      nameF.input.value = data.full_name;
      state.dirty.delete('perfil');
      renderHead();
      refreshProfileChrome();
      status.textContent = 'Nome salvo.';
      toast('Nome salvo.', 'ok');
    } catch (err) {
      alert.textContent = errorMsg(err);
    } finally {
      setBusy(btn, false);
      if (locked) btn.disabled = true;
    }
  });

  panel.replaceChildren(
    h('div', { class: 'pf-tab-intro' },
      h('h2', {}, 'Meu perfil'),
      h('p', {}, 'Seu nome e sua foto aparecem para os professores com quem você conversa.')),
    h('div', { class: 'pf-panel' },
      form,
      h('hr', { class: 'pf-divider' }),
      h('h3', { class: 'pf-label', style: { fontSize: '16px', marginBottom: '14px' } }, 'Foto'),
      photoSection()));
}

// ---------- Componentes de outras áreas ----------

function component(fn) {
  return (panel) => {
    Promise.resolve()
      .then(() => fn(panel, { profile: state.profile }))
      .catch((err) => panel.replaceChildren(errorBox(err)));
  };
}

// ---------- Abas (hash) ----------

function tabsFor() {
  if (isTutor()) {
    return {
      tabs: [
        { id: 'anuncio', label: 'Meu anúncio', mount: mountAnuncio },
        { id: 'materias', label: 'Matérias', mount: mountMaterias },
        { id: 'foto', label: 'Foto', mount: mountFoto },
        { id: 'avaliacoes', label: 'Avaliações', mount: component(mountReviewsTab) },
        { id: 'duvidas', label: 'Tira-dúvidas', mount: component(mountQuestionsTab) },
        { id: 'plano', label: 'Plano', mount: component(mountPlanTab) },
        { id: 'conta', label: 'Conta', mount: component(mountAccountTab) },
      ],
      alias: { perfil: 'anuncio' },
    };
  }
  return {
    tabs: [
      { id: 'perfil', label: 'Meu perfil', mount: mountPerfil },
      { id: 'duvidas', label: 'Minhas dúvidas', mount: component(mountQuestionsTab) },
      { id: 'avaliacoes', label: 'Avaliações', mount: component(mountReviewsTab) },
      { id: 'conta', label: 'Conta', mount: component(mountAccountTab) },
    ],
    alias: { anuncio: 'perfil', foto: 'perfil', materias: 'perfil' },
  };
}

function buildTabs() {
  const { tabs, alias } = tabsFor();
  const list = h('div', { class: 'pf-tabs pf-dash-tabs', role: 'tablist', 'aria-label': 'Seções do painel' });
  const panels = h('div', { class: 'pf-dash-panels' });
  for (const t of tabs) {
    t.btn = h('button', {
      type: 'button', role: 'tab', class: 'pf-tab', id: `tab-${t.id}`,
      'aria-controls': `panel-${t.id}`, 'aria-selected': false, tabindex: '-1',
    }, t.label);
    t.panel = h('section', { class: 'pf-tabpanel', role: 'tabpanel', id: `panel-${t.id}`, 'aria-labelledby': `tab-${t.id}`, tabindex: '0', hidden: true });
    t.btn.addEventListener('click', () => select(t.id, { updateHash: true }));
    list.append(t.btn);
    panels.append(t.panel);
  }

  const resolve = (hash) => {
    const id = String(hash || '').replace(/^#/, '');
    const real = alias[id] || id;
    return tabs.find((t) => t.id === real) || tabs[0];
  };

  function select(id, { updateHash = false, focus = false } = {}) {
    const target = resolve(id);
    for (const t of tabs) {
      const on = t === target;
      t.btn.setAttribute('aria-selected', String(on));
      t.btn.tabIndex = on ? 0 : -1;
      t.panel.hidden = !on;
    }
    if (!target.mounted) {
      target.mounted = true;
      try {
        target.mount(target.panel);
      } catch (err) {
        target.panel.replaceChildren(errorBox(err));
      }
    }
    if (updateHash && location.hash !== `#${target.id}`) {
      history.replaceState(history.state, '', `${location.pathname}${location.search}#${target.id}`);
    }
    if (focus) target.btn.focus();
  }

  // Setas / Home / End entre as abas (padrão WAI-ARIA, ativação automática)
  list.addEventListener('keydown', (e) => {
    const i = tabs.findIndex((t) => t.btn === document.activeElement);
    if (i === -1) return;
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabs.length - 1;
    if (j == null) return;
    e.preventDefault();
    select(tabs[j].id, { updateHash: true, focus: true });
  });

  window.addEventListener('hashchange', () => select(location.hash));
  select(location.hash);
  return h('div', { class: 'pf-dash-body' }, list, panels);
}

// ---------- Início ----------

function render(body) {
  headEl = h('section', { class: 'pf-panel pf-dash-head', 'aria-label': 'Sua conta' });
  const parts = [headEl];
  const ns = notices();
  parts.push(h('div', { class: 'pf-dash-notices' }, ns));
  if (!isTutor() && !isBanned()) {
    parts.push(h('section', { class: 'pf-dash-cta', 'aria-labelledby': 'pfCtaTitle' },
      h('div', {},
        h('h2', { class: 'pf-dash-cta-title', id: 'pfCtaTitle' }, 'Você também ensina?'),
        h('p', {}, 'Crie seu anúncio de professor grátis, apareça na busca e receba mensagens de alunos.')),
      h('button', { type: 'button', class: 'btn btn-primary', onClick: onBecomeTutor }, 'Quero dar aulas')));
  }
  if (isTutor() && !state.tutor) {
    parts.push(h('div', { class: 'pf-notice pf-notice--warn', role: 'status' },
      h('h2', { class: 'pf-notice-title' }, 'Anúncio não encontrado'),
      h('p', {}, 'Não encontramos seu anúncio de professor. Crie-o novamente para aparecer na busca.'),
      h('div', {}, h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: onBecomeTutor }, 'Criar meu anúncio'))));
  }
  parts.push(buildTabs());
  body.replaceChildren(...parts);
  renderHead();
  state.listeners.add(renderHead);
}

async function main() {
  initChrome();
  const body = document.getElementById('pageBody');
  if (!body) return;
  if (!isConfigured) {
    notConfiguredNotice(body);
    return;
  }

  // Sem sessão: vai para o login e volta para esta mesma aba depois
  const session = await getSession();
  if (!session) {
    location.replace(loginUrl(location.pathname + location.search + location.hash));
    return;
  }

  let profile;
  try {
    profile = await requireAuth();
  } catch (err) {
    body.replaceChildren(errorBox(err, () => location.reload()));
    return;
  }
  if (!profile) return;

  state.profile = profile;
  state.tutor = profile.tutor || null;
  if (state.tutor) state.profile.tutor = state.tutor;
  render(body);

  if (qsGet('bemvindo')) {
    qsSet({ bemvindo: null });
    toast('E-mail confirmado. Boas-vindas ao Quanta Aulas!', 'ok');
  }
}

main().catch((err) => {
  const body = document.getElementById('pageBody');
  if (body) body.replaceChildren(errorBox(err, () => location.reload()));
});
