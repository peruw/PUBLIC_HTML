/* ============================================
   Página: Dúvida — pergunta + respostas (dono: duvidas)
   /professores/duvida.html?q=<id>
   - Autor edita/exclui a própria pergunta (aberta, conta ativa).
   - Professor (conta ativa, anúncio não suspenso) responde uma vez e edita/exclui a própria resposta.
   - Aluno/visitante vê o convite "Quer aula particular?" para a busca da matéria.
   - Professor oculto/despublicado: embed tutor_profiles vem null -> "Professor(a)" sem link.
   ============================================ */

import '../../css/duvidas.css';
import { sb } from '../supabase.js';
import { isConfigured, SITE_URL } from '../config.js';
import {
  initChrome, h, avatarEl, formatDate, errorMsg, notConfiguredNotice, toast, modal, qsGet, skeletonCards, timeAgo,
} from '../ui.js';
import { getProfile, loginUrl } from '../auth.js';
import { reportButton } from '../components/report.js';
import {
  QA_LIMITS, qaId, questionUrl, excerpt, timeEl, qaErrorMsg, countedField,
} from '../components/tutor-answers.js';

const TITLE_SUFFIX = ' — Professores | Quanta Aulas';
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const Q_SELECT = 'id,title,body,status,subject_id,author_id,answers_count,created_at,author_name,subjects(id,slug,name)';
const A_SELECT = 'id,body,status,tutor_id,created_at,updated_at,tutor_profiles(slug,headline,profiles(full_name,avatar_path))';

const root = document.getElementById('pageBody');

// Estado da página
const ctx = {
  id: null,
  question: null,
  answers: [],
  answersError: null,
  profile: null,
};
const els = {}; // containers re-renderizáveis (respostas, formulário, lateral)

// ---------- Utilidades ----------

const one = (x) => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));
const numId = (id) => (Number.isSafeInteger(Number(id)) ? Number(id) : String(id));

function subjectOf(q) {
  const s = one(q && q.subjects);
  return s && s.slug && SLUG_RE.test(String(s.slug)) ? { slug: String(s.slug), name: String(s.name || s.slug) } : null;
}

function tutorOf(a) {
  const tp = one(a.tutor_profiles);
  if (!tp) return null;
  const pr = one(tp.profiles);
  const slug = SLUG_RE.test(String(tp.slug || '')) ? String(tp.slug) : '';
  return {
    name: String((pr && pr.full_name) || '').trim() || 'Professor(a)',
    avatar: pr ? pr.avatar_path : null,
    headline: tp.headline ? String(tp.headline) : '',
    href: slug ? `/professores/p/${encodeURIComponent(slug)}` : null,
  };
}

function viewerState() {
  const p = ctx.profile;
  const q = ctx.question;
  const isAuthor = Boolean(p && q && p.id === q.author_id);
  const banned = Boolean(p && p.banned_at);
  const tutor = p && p.role === 'tutor' ? one(p.tutor ?? p.tutor_profiles) : null;
  const isTutor = Boolean(tutor);
  const suspended = Boolean(tutor && tutor.suspended);
  const myAnswer = p ? ctx.answers.find((a) => a.tutor_id === p.id) || null : null;
  return {
    profile: p,
    isAuthor,
    banned,
    isTutor,
    tutor,
    suspended,
    myAnswer,
    canEditQuestion: isAuthor && q.status === 'open' && !banned,
    canAnswer: isTutor && !banned && !suspended && !isAuthor && !myAnswer && q.status === 'open',
  };
}

// Respostas visíveis: publicadas + a própria (mesmo oculta, com aviso)
function visibleAnswers() {
  const me = ctx.profile ? ctx.profile.id : null;
  return ctx.answers.filter((a) => a.status === 'published' || (me && a.tutor_id === me));
}

// ---------- SEO ----------

function setMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (content == null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function setJsonLd(data) {
  let el = document.getElementById('duvidaJsonLd');
  if (!data) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = 'duvidaJsonLd';
    document.head.appendChild(el);
  }
  // textContent + "<" escapado: nenhum texto de usuário fecha o <script>
  el.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
}

function updateHead() {
  const q = ctx.question;
  const url = `${SITE_URL}${questionUrl(q.id)}`;
  const subj = subjectOf(q);
  const title = excerpt(q.title, 90);
  document.title = title + TITLE_SUFFIX;
  const lead = subj ? `Dúvida de ${subj.name}: ` : 'Dúvida: ';
  const description = excerpt(lead + (q.body ? `${q.title} ${q.body}` : q.title), 160);
  setMeta('name', 'description', description);
  setMeta('property', 'og:title', excerpt(`${q.title} | Tira-dúvidas Quanta Aulas`, 90));
  setMeta('property', 'og:description', description);
  setMeta('property', 'og:url', url);
  setMeta('property', 'og:type', 'article');
  setLink('canonical', url);

  if (q.status !== 'open') {
    setMeta('name', 'robots', 'noindex');
    setJsonLd(null);
    return;
  }
  setMeta('name', 'robots', null);
  const published = ctx.answers.filter((a) => a.status === 'published');
  setJsonLd({
    '@context': 'https://schema.org',
    '@type': 'QAPage',
    mainEntity: {
      '@type': 'Question',
      name: String(q.title),
      text: String(q.body || q.title),
      answerCount: published.length,
      dateCreated: q.created_at,
      author: { '@type': 'Person', name: String(q.author_name || 'Aluno') },
      suggestedAnswer: published.map((a) => ({
        '@type': 'Answer',
        text: String(a.body),
        dateCreated: a.created_at,
        url: `${url}#resposta-${a.id}`,
        author: { '@type': 'Person', name: tutorOf(a)?.name || 'Professor(a)' },
      })),
    },
  });
}

// ---------- Dados ----------

async function fetchQuestion(id) {
  const { data, error } = await sb.from('questions').select(Q_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function fetchAnswers(id) {
  const { data, error } = await sb.from('answers').select(A_SELECT)
    .eq('question_id', id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).filter((a) => a && qaId(a.id));
}

async function reloadAnswers({ focusId } = {}) {
  try {
    ctx.answers = await fetchAnswers(ctx.id);
    ctx.answersError = null;
  } catch (err) {
    ctx.answersError = err;
  }
  renderDynamic();
  updateHead();
  if (focusId) document.getElementById(`resposta-${focusId}`)?.focus();
}

// ---------- Estados de tela ----------

function renderLoading() {
  root.setAttribute('aria-busy', 'true');
  root.replaceChildren(
    h('header', { class: 'pf-page-head' },
      h('div', { class: 'eyebrow' }, 'Tira-dúvidas'),
      h('h1', { class: 'pf-title' }, 'Dúvida')),
    h('p', { class: 'pf-sr-only', role: 'status' }, 'Carregando pergunta…'),
    skeletonCards(2));
}

function renderNotFound() {
  root.setAttribute('aria-busy', 'false');
  document.title = `Pergunta não encontrada${TITLE_SUFFIX}`;
  setMeta('name', 'robots', 'noindex');
  root.replaceChildren(h('div', { class: 'pf-qa-404' },
    h('div', { class: 'eyebrow' }, 'Tira-dúvidas'),
    h('h1', { class: 'pf-title' }, 'Pergunta não encontrada'),
    h('p', { class: 'lead' }, 'Esta pergunta não existe, foi removida ou o link está incompleto.'),
    h('div', { class: 'pf-form-actions' },
      h('a', { class: 'btn btn-primary', href: '/professores/duvidas.html' }, 'Ver todas as dúvidas'),
      h('a', { class: 'btn btn-ghost', href: '/professores/duvidas.html#perguntar' }, 'Fazer uma pergunta'))));
}

function renderError(err) {
  root.setAttribute('aria-busy', 'false');
  root.replaceChildren(
    h('header', { class: 'pf-page-head' },
      h('div', { class: 'eyebrow' }, 'Tira-dúvidas'),
      h('h1', { class: 'pf-title' }, 'Dúvida')),
    h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' },
      h('p', { class: 'pf-notice-title' }, 'Não foi possível carregar a pergunta.'),
      h('p', {}, errorMsg(err)),
      h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => load(ctx.id) }, 'Tentar de novo'))));
}

function renderDeleted() {
  document.title = `Pergunta excluída${TITLE_SUFFIX}`;
  setMeta('name', 'robots', 'noindex');
  setJsonLd(null);
  root.replaceChildren(h('div', { class: 'pf-qa-404' },
    h('div', { class: 'eyebrow' }, 'Tira-dúvidas'),
    h('h1', { class: 'pf-title', tabindex: '-1', id: 'qaExcluida' }, 'Pergunta excluída'),
    h('p', { class: 'lead', role: 'status' }, 'Sua pergunta e as respostas dela foram apagadas.'),
    h('div', { class: 'pf-form-actions' },
      h('a', { class: 'btn btn-primary', href: '/professores/duvidas.html#perguntar' }, 'Fazer outra pergunta'),
      h('a', { class: 'btn btn-ghost', href: '/professores/painel.html#duvidas' }, 'Minhas dúvidas'))));
  // depois que o modal de confirmação fechar
  setTimeout(() => document.getElementById('qaExcluida')?.focus(), 0);
}

// ---------- Pergunta ----------

function breadcrumb(q) {
  const subj = subjectOf(q);
  return h('nav', { class: 'pf-qa-crumbs', 'aria-label': 'Você está em' },
    h('ol', {},
      h('li', {}, h('a', { href: '/professores/duvidas.html' }, 'Tira-dúvidas')),
      subj ? h('li', {}, h('a', { href: `/professores/duvidas.html?materia=${encodeURIComponent(subj.slug)}` }, subj.name)) : null,
      h('li', { 'aria-current': 'page' }, 'Pergunta')));
}

function questionView(q, v) {
  const subj = subjectOf(q);
  const actions = [];
  if (v.canAnswer) {
    actions.push(h('a', { class: 'btn btn-primary btn-sm', href: '#responder' }, 'Responder'));
  }
  if (v.canEditQuestion) {
    actions.push(
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => editQuestion() }, 'Editar'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-danger', onClick: () => deleteQuestion() }, 'Excluir'));
  }
  if (!v.isAuthor && q.status === 'open') actions.push(reportButton({ type: 'question', id: String(q.id), label: 'Denunciar pergunta' }));

  return h('article', { class: 'pf-panel pf-qa-question', id: 'pergunta', 'aria-labelledby': 'qaTitulo' },
    h('div', { class: 'pf-qa-q-top' },
      subj ? h('a', { class: 'pf-chip pf-chip-sm', href: `/professores/duvidas.html?materia=${encodeURIComponent(subj.slug)}` }, subj.name) : null,
      q.status !== 'open' ? h('span', { class: 'pf-badge pf-badge--warn' }, 'Oculta pela moderação') : null),
    h('h1', { class: 'pf-title pf-qa-q-title', id: 'qaTitulo' }, String(q.title)),
    h('p', { class: 'pf-qa-q-meta' },
      h('span', {}, `Perguntada por ${q.author_name ? String(q.author_name) : 'Aluno'}`),
      h('span', { 'aria-hidden': 'true' }, ' · '),
      h('time', { datetime: String(q.created_at || ''), title: formatDate(q.created_at, { dateStyle: 'long', timeStyle: 'short' }) },
        formatDate(q.created_at, { dateStyle: 'long' })),
      q.created_at ? h('span', { class: 'pf-muted' }, ` (${timeAgo(q.created_at)})`) : null),
    q.body ? h('div', { class: 'pf-pre pf-qa-q-body' }, String(q.body)) : null,
    actions.length ? h('div', { class: 'pf-qa-actions' }, actions) : null);
}

async function editQuestion() {
  const q = ctx.question;
  const art = document.getElementById('pergunta');
  if (!art) return;
  const subjectSel = h('select', { id: 'editMateria', class: 'pf-select', required: true },
    h('option', { value: String(q.subject_id ?? '') }, subjectOf(q)?.name || 'Carregando matérias…'));
  const title = countedField({ id: 'editTitulo', label: 'Título', min: QA_LIMITS.titleMin, max: QA_LIMITS.titleMax, required: true, value: String(q.title || '') });
  const text = countedField({ id: 'editTexto', label: 'Detalhes', multiline: true, max: QA_LIMITS.questionBodyMax, rows: 8, value: String(q.body || '') });
  const status = h('p', { class: 'pf-qa-status', role: 'status', 'aria-live': 'polite' });
  const save = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Salvar');
  const form = h('form', { class: 'pf-panel pf-form pf-qa-form pf-qa-question', id: 'pergunta', novalidate: true, 'aria-labelledby': 'editPerguntaT' },
    h('h1', { class: 'pf-section-title', id: 'editPerguntaT', tabindex: '-1' }, 'Editar pergunta'),
    h('div', { class: 'pf-field' }, h('label', { class: 'pf-label', for: 'editMateria' }, 'Matéria'), subjectSel),
    title.field,
    text.field,
    h('div', { class: 'pf-form-actions' },
      save,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => { renderAll(); document.getElementById('qaTitulo')?.focus(); } }, 'Cancelar')),
    status);
  art.replaceWith(form);
  document.getElementById('editPerguntaT')?.focus();

  // Matérias (mantém a atual se a lista falhar)
  sb.from('subjects').select('id,name,category').order('category').order('name').then(({ data, error }) => {
    if (error || !Array.isArray(data) || !data.length) return;
    const groups = new Map();
    for (const s of data) {
      const cat = String(s.category || 'Outras');
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(s);
    }
    subjectSel.replaceChildren(
      ...(q.subject_id == null ? [h('option', { value: '' }, 'Escolha a matéria')] : []),
      ...[...groups].map(([cat, items]) => h('optgroup', { label: cat },
        items.map((s) => h('option', { value: String(s.id) }, String(s.name))))));
    subjectSel.value = String(q.subject_id ?? '');
  }, () => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (save.disabled) return;
    const okT = title.validate();
    const okB = text.validate();
    if (!okT || !okB) {
      (okT ? text.input : title.input).focus();
      return;
    }
    const sid = Number(subjectSel.value);
    save.disabled = true;
    status.textContent = 'Salvando…';
    try {
      // Só colunas com grant de UPDATE; .select() confirma que alguma linha mudou (RLS devolve 0 sem erro)
      const { data, error } = await sb.from('questions')
        .update({ subject_id: Number.isInteger(sid) && sid > 0 ? sid : null, title: title.value(), body: text.value() })
        .eq('id', ctx.id)
        .select('id');
      if (error) throw error;
      if (!Array.isArray(data) || !data.length) {
        throw Object.assign(new Error('0 linhas'), { friendly: 'Esta pergunta não pode mais ser editada (foi ocultada pela moderação ou sua conta está suspensa).' });
      }
      const fresh = await fetchQuestion(ctx.id);
      if (fresh) ctx.question = fresh;
      renderAll();
      toast('Pergunta atualizada.', 'ok');
      document.getElementById('qaTitulo')?.focus();
    } catch (err) {
      status.textContent = '';
      status.append(h('span', { class: 'pf-error' }, err.friendly || qaErrorMsg(err, 'pergunta')));
      save.disabled = false;
    }
  });
}

function deleteQuestion() {
  const n = ctx.answers.filter((a) => a.status === 'published').length;
  modal({
    title: 'Excluir pergunta?',
    content: h('p', {}, n > 0
      ? `A pergunta e ${n === 1 ? 'a resposta dela' : `as ${n} respostas dela`} serão apagadas. Isso não pode ser desfeito.`
      : 'A pergunta será apagada. Isso não pode ser desfeito.'),
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Excluir pergunta',
        danger: true,
        onClick: async () => {
          const { data, error } = await sb.from('questions').delete().eq('id', ctx.id).select('id');
          if (error) throw error;
          if (!Array.isArray(data) || !data.length) {
            toast('Esta pergunta não pode ser excluída (pode ter sido ocultada pela moderação).', 'erro');
            return false;
          }
          renderDeleted();
          return true;
        },
      },
    ],
  });
}

// ---------- Respostas ----------

function answerView(a, v) {
  const t = tutorOf(a);
  const mine = Boolean(v.profile && a.tutor_id === v.profile.id);
  const name = t ? t.name : 'Professor(a)';
  const edited = a.updated_at && a.created_at && (new Date(a.updated_at) - new Date(a.created_at)) > 60_000;
  const canEdit = mine && a.status === 'published' && !v.banned && !v.suspended;

  const actions = [];
  if (canEdit) {
    actions.push(
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => editAnswer(a) }, 'Editar'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-danger', onClick: () => deleteAnswer(a) }, 'Excluir'));
  }
  if (!mine && a.status === 'published') actions.push(reportButton({ type: 'answer', id: String(a.id), label: 'Denunciar resposta' }));

  const nameEl = t && t.href
    ? h('a', { class: 'pf-qa-a-name', href: t.href }, name)
    : h('span', { class: 'pf-qa-a-name' }, name);

  return h('article', {
    class: ['pf-qa-answer', mine ? 'is-mine' : null],
    id: `resposta-${a.id}`,
    tabindex: '-1',
    'aria-label': `Resposta de ${name}`,
  },
  h('header', { class: 'pf-qa-a-head' },
    avatarEl(t ? t.avatar : null, name, 44),
    h('div', { class: 'pf-qa-a-who' },
      h('p', { class: 'pf-qa-a-line' },
        nameEl,
        h('span', { class: 'pf-badge pf-badge--pro' }, 'Professor(a)'),
        mine ? h('span', { class: 'pf-badge pf-badge--ok' }, 'Sua resposta') : null,
        a.status !== 'published' ? h('span', { class: 'pf-badge pf-badge--warn' }, 'Oculta pela moderação') : null),
      t && t.headline ? h('p', { class: 'pf-qa-a-headline' }, t.headline) : null,
      h('p', { class: 'pf-qa-a-time' },
        timeEl(a.created_at, { prefix: 'Respondida ' }),
        edited ? h('span', {}, ` · editada ${timeAgo(a.updated_at)}`) : null))),
  h('div', { class: 'pf-pre pf-qa-a-body' }, String(a.body || '')),
  actions.length ? h('div', { class: 'pf-qa-actions' }, actions) : null);
}

function answersView(v) {
  const list = visibleAnswers();
  const published = list.filter((a) => a.status === 'published').length;
  const heading = published === 0 ? 'Respostas' : (published === 1 ? '1 resposta' : `${published} respostas`);
  const parts = [h('h2', { class: 'pf-section-title', id: 'respostasTitulo' }, heading)];

  if (ctx.answersError) {
    parts.push(h('div', { class: 'pf-qa-inline-error', role: 'alert' },
      h('p', {}, `Não foi possível carregar as respostas. ${errorMsg(ctx.answersError)}`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => reloadAnswers() }, 'Tentar de novo')));
  } else if (!list.length) {
    parts.push(h('div', { class: 'pf-qa-no-answers' },
      h('p', {}, v.canAnswer
        ? 'Ainda não há respostas. Seja o primeiro professor a responder!'
        : 'Ainda não há respostas. Assim que um professor responder, a resposta aparece aqui.')));
  } else {
    parts.push(h('ol', { class: 'pf-qa-answers', 'aria-labelledby': 'respostasTitulo' },
      list.map((a) => h('li', {}, answerView(a, v)))));
  }
  return parts;
}

function editAnswer(a) {
  const art = document.getElementById(`resposta-${a.id}`);
  const bodyEl = art && art.querySelector('.pf-qa-a-body');
  const actionsEl = art && art.querySelector('.pf-qa-actions');
  if (!art || !bodyEl) return;
  const field = countedField({
    id: `editResp${a.id}`, label: 'Editar resposta', multiline: true, rows: 8,
    min: QA_LIMITS.answerMin, max: QA_LIMITS.answerMax, required: true, value: String(a.body || ''),
  });
  const status = h('p', { class: 'pf-qa-status', role: 'status', 'aria-live': 'polite' });
  const save = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Salvar resposta');
  const form = h('form', { class: 'pf-form pf-qa-form pf-qa-a-edit', novalidate: true },
    field.field,
    h('div', { class: 'pf-form-actions' },
      save,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => { renderDynamic(); document.getElementById(`resposta-${a.id}`)?.focus(); } }, 'Cancelar')),
    status);
  bodyEl.replaceWith(form);
  actionsEl?.remove();
  field.input.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (save.disabled || !field.validate()) {
      field.input.focus();
      return;
    }
    save.disabled = true;
    status.textContent = 'Salvando…';
    try {
      const { data, error } = await sb.from('answers').update({ body: field.value() }).eq('id', numId(a.id)).select('id');
      if (error) throw error;
      if (!Array.isArray(data) || !data.length) {
        throw Object.assign(new Error('0 linhas'), { friendly: 'Esta resposta não pode mais ser editada (foi ocultada pela moderação ou sua conta/anúncio está suspenso).' });
      }
      toast('Resposta atualizada.', 'ok');
      await reloadAnswers({ focusId: a.id });
    } catch (err) {
      status.textContent = '';
      status.append(h('span', { class: 'pf-error' }, err.friendly || qaErrorMsg(err, 'resposta')));
      save.disabled = false;
    }
  });
}

function deleteAnswer(a) {
  modal({
    title: 'Excluir sua resposta?',
    content: h('p', {}, 'A resposta será apagada desta pergunta e do seu perfil. Isso não pode ser desfeito.'),
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Excluir resposta',
        danger: true,
        onClick: async () => {
          const { data, error } = await sb.from('answers').delete().eq('id', numId(a.id)).select('id');
          if (error) throw error;
          if (!Array.isArray(data) || !data.length) {
            toast('Esta resposta não pode ser excluída (pode ter sido ocultada pela moderação).', 'erro');
            return false;
          }
          toast('Resposta excluída.', 'ok');
          await reloadAnswers();
          // depois que o modal fechar (ele devolve o foco ao botão, que já saiu da página)
          setTimeout(() => {
            const t = document.getElementById('respostasTitulo');
            t?.setAttribute('tabindex', '-1');
            t?.focus();
          }, 0);
          return true;
        },
      },
    ],
  });
}

// ---------- Formulário de resposta ----------

function answerFormView(v) {
  const q = ctx.question;
  if (q.status !== 'open') return null;
  const here = `${location.pathname}${location.search}#responder`;

  if (!v.profile) {
    return h('div', { class: 'pf-panel pf-qa-answer-cta', id: 'responder' },
      h('h2', { class: 'pf-qa-side-title' }, 'É professor? Responda esta pergunta'),
      h('p', { class: 'pf-muted' }, 'Entre com sua conta de professor para responder. Suas respostas aparecem no seu perfil e ajudam novos alunos a encontrar você.'),
      h('div', { class: 'pf-form-actions' },
        h('a', { class: 'btn btn-ghost btn-sm', href: loginUrl(here) }, 'Entrar para responder'),
        h('a', { class: 'pf-link-btn', href: '/professores/entrar.html?modo=cadastro&tipo=professor' }, 'Criar anúncio de professor')));
  }
  if (!v.isTutor) return null; // aluno: vê o convite para aula particular na lateral
  if (v.banned) {
    return h('div', { class: 'pf-notice pf-notice--warn', id: 'responder', role: 'status' },
      h('p', {}, 'Sua conta está suspensa e não pode responder perguntas.'));
  }
  if (v.suspended) {
    return h('div', { class: 'pf-notice pf-notice--warn', id: 'responder', role: 'status' },
      h('p', {}, 'Seu anúncio está suspenso pela moderação. Enquanto isso, não é possível responder perguntas.'));
  }
  if (v.isAuthor) {
    return h('p', { class: 'pf-muted pf-qa-note', id: 'responder' }, 'Você fez esta pergunta. Aguarde as respostas de outros professores.');
  }
  if (v.myAnswer) {
    return h('p', { class: 'pf-muted pf-qa-note', id: 'responder' },
      'Você já respondeu esta pergunta. ',
      h('a', { href: `#resposta-${v.myAnswer.id}` }, 'Ver ou editar sua resposta'),
      '.');
  }

  const field = countedField({
    id: 'respTexto', label: 'Sua resposta', multiline: true, rows: 8,
    min: QA_LIMITS.answerMin, max: QA_LIMITS.answerMax, required: true,
    placeholder: 'Explique passo a passo, como faria numa aula.',
    hint: 'Não inclua telefone, e-mail ou links de contato: o aluno fala com você pelo seu perfil.',
  });
  const status = h('p', { class: 'pf-qa-status', role: 'status', 'aria-live': 'polite' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Publicar resposta');
  const unpublished = v.tutor && v.tutor.published === false;
  const form = h('form', { class: 'pf-panel pf-form pf-qa-form pf-qa-answer-form', id: 'responder', novalidate: true, 'aria-labelledby': 'responderTitulo' },
    h('h2', { class: 'pf-section-title', id: 'responderTitulo' }, 'Responder'),
    unpublished
      ? h('p', { class: 'pf-notice pf-notice--warn pf-qa-tip' },
        'Seu anúncio ainda não está publicado: a resposta aparece sem link para o seu perfil. ',
        h('a', { href: '/professores/painel.html#anuncio' }, 'Publicar meu anúncio'))
      : null,
    field.field,
    h('div', { class: 'pf-form-actions' }, submit),
    status);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    status.textContent = '';
    if (!field.validate()) {
      field.input.focus();
      return;
    }
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    status.textContent = 'Publicando…';
    try {
      // Só as colunas com grant de INSERT (tutor_id vem de auth.uid() no banco)
      const { data, error } = await sb.from('answers')
        .insert({ question_id: numId(ctx.id), body: field.value() })
        .select('id')
        .single();
      if (error) throw error;
      toast('Resposta publicada! Obrigado por ajudar.', 'ok');
      await reloadAnswers({ focusId: data && qaId(data.id) });
    } catch (err) {
      const msg = qaErrorMsg(err, 'resposta');
      status.textContent = '';
      status.append(h('span', { class: 'pf-error' }, msg));
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      if (err && String(err.code) === '23505') reloadAnswers();
    }
  });
  return form;
}

// ---------- Lateral ----------

function asideView(v) {
  const subj = subjectOf(ctx.question);
  const cards = [];
  if (!v.isTutor) {
    const href = subj ? `/professores/?materia=${encodeURIComponent(subj.slug)}` : '/professores/';
    cards.push(h('div', { class: 'pf-panel pf-qa-side-card pf-qa-cta' },
      h('h2', { class: 'pf-qa-side-title' }, 'Quer aula particular?'),
      h('p', { class: 'pf-muted' }, subj
        ? `Fale com um professor de ${subj.name} e tire todas as dúvidas numa aula, online ou perto de você.`
        : 'Fale com um professor e tire todas as dúvidas numa aula, online ou perto de você.'),
      h('a', { class: 'btn btn-primary btn-sm btn-block', href }, subj ? `Professores de ${subj.name}` : 'Fale com um professor')));
  } else if (subj) {
    cards.push(h('div', { class: 'pf-panel pf-qa-side-card' },
      h('h2', { class: 'pf-qa-side-title' }, 'Responda mais dúvidas'),
      h('p', { class: 'pf-muted' }, `Outras perguntas de ${subj.name} esperando um professor.`),
      h('a', { class: 'btn btn-ghost btn-sm btn-block', href: `/professores/duvidas.html?materia=${encodeURIComponent(subj.slug)}` }, `Dúvidas de ${subj.name}`)));
  }
  cards.push(h('div', { class: 'pf-panel pf-qa-side-card' },
    h('h2', { class: 'pf-qa-side-title' }, 'Tem outra dúvida?'),
    h('p', { class: 'pf-muted' }, 'Pergunte de graça. Professores respondem.'),
    h('a', { class: 'btn btn-ghost btn-sm btn-block', href: '/professores/duvidas.html#perguntar' }, 'Fazer uma pergunta')));
  return cards;
}

// ---------- Montagem ----------

function renderDynamic() {
  if (!els.answers) return;
  const v = viewerState();
  els.answers.replaceChildren(...answersView(v));
  const form = answerFormView(v);
  if (form) els.form.replaceChildren(form);
  else els.form.replaceChildren();
  els.aside.replaceChildren(...asideView(v));
  // Botão "Responder" do topo segue o estado (some depois de responder)
  const q = document.getElementById('pergunta');
  if (q && q.tagName === 'ARTICLE') q.replaceWith(questionView(ctx.question, v));
}

function renderAll() {
  const q = ctx.question;
  const v = viewerState();
  root.setAttribute('aria-busy', 'false');
  els.answers = h('section', { class: 'pf-qa-answers-sec', 'aria-labelledby': 'respostasTitulo' });
  els.form = h('div', { class: 'pf-qa-form-slot' });
  els.aside = h('aside', { class: 'pf-qa-aside', 'aria-label': 'Aulas e outras dúvidas' });
  root.replaceChildren(
    breadcrumb(q),
    q.status !== 'open'
      ? h('div', { class: 'pf-notice pf-notice--warn pf-qa-hidden-notice', role: 'status' },
        h('p', {}, 'Esta pergunta foi ocultada pela moderação e não aparece para outras pessoas.'))
      : null,
    h('div', { class: 'pf-qa-layout pf-qa-detail' },
      h('div', { class: 'pf-qa-col' }, questionView(q, v), els.answers, els.form),
      els.aside));
  renderDynamic();
  updateHead();
}

async function load(id) {
  ctx.id = id;
  renderLoading();
  try {
    const [question, answers, profile] = await Promise.all([
      fetchQuestion(id),
      fetchAnswers(id).then((list) => ({ list }), (err) => ({ err })),
      getProfile().catch(() => null),
    ]);
    if (!question) {
      renderNotFound();
      return;
    }
    ctx.question = question;
    ctx.answers = answers.list || [];
    ctx.answersError = answers.err || null;
    ctx.profile = profile;
    renderAll();
    // Link direto para uma resposta (#resposta-123) ou para o formulário (#responder)
    if (/^#(resposta-\d+|responder)$/.test(location.hash)) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) {
        target.scrollIntoView({ block: 'start' });
        if (target.tabIndex >= 0 || target.hasAttribute('tabindex')) target.focus({ preventScroll: true });
      }
    }
  } catch (err) {
    renderError(err);
  }
}

function main() {
  initChrome();
  if (!root) return;
  if (!isConfigured) {
    notConfiguredNotice(root);
    return;
  }
  const id = qaId(qsGet('q'));
  if (!id) {
    renderNotFound();
    return;
  }
  load(id);
}

main();
