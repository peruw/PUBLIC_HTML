/* ============================================
   Página: Tira-dúvidas — lista, busca e nova pergunta (dono: duvidas)
   Filtros <-> URL (?q=&materia=&pagina=), RPC search_questions.
   Nova pergunta: só logado; insert (subject_id, title, body) -> duvida.html?q=<id>.
   ============================================ */

import '../../css/duvidas.css';
import { sb } from '../supabase.js';
import { isConfigured } from '../config.js';
import { initChrome, h, emptyState, skeletonCards, errorMsg, notConfiguredNotice, toast } from '../ui.js';
import { getProfile, loginUrl } from '../auth.js';
import {
  QA_LIMITS, qaId, questionUrl, answersLabel, timeEl, qaErrorMsg, countedField,
} from '../components/tutor-answers.js';

const PER_PAGE = 15;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BASE_TITLE = document.title;
const ASK_HASH = '#perguntar';
const NUM = new Intl.NumberFormat('pt-BR');

const $ = (id) => document.getElementById(id);
const els = {};
const subjectsBySlug = new Map(); // slug -> { id, slug, name, category }
let subjectsList = [];
let subjectsPromise = null;

// ---------- Estado <-> URL ----------

function cleanQ(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function readState() {
  const p = new URLSearchParams(location.search);
  const materia = String(p.get('materia') || '').toLowerCase();
  const pagina = parseInt(p.get('pagina') || '', 10);
  return {
    q: cleanQ(p.get('q')),
    materia: SLUG_RE.test(materia) && materia.length <= 60 ? materia : '',
    pagina: Number.isInteger(pagina) && pagina > 1 ? Math.min(pagina, 1000) : 1,
  };
}

function stateUrl(s, hash = location.hash) {
  const p = new URLSearchParams(location.search);
  const set = { q: s.q || null, materia: s.materia || null, pagina: s.pagina > 1 ? s.pagina : null };
  for (const [k, v] of Object.entries(set)) {
    if (v == null || v === '') p.delete(k);
    else p.set(k, String(v));
  }
  const qs = p.toString();
  return location.pathname + (qs ? `?${qs}` : '') + (hash || '');
}

function writeUrl(s, kind = 'push') {
  // o hash (#perguntar) não é estado da lista: sai ao filtrar
  const url = stateUrl(s, kind === 'replace' ? location.hash : '');
  if (url === location.pathname + location.search + location.hash) return;
  if (kind === 'replace') history.replaceState(history.state, '', url);
  else history.pushState(null, '', url);
}

let state = readState();

// ---------- Textos ----------

function subjectName(slug) {
  if (!slug) return '';
  if (subjectsBySlug.has(slug)) return String(subjectsBySlug.get(slug).name);
  const chip = document.querySelector(`#qaMaterias a[data-materia="${slug}"]`);
  if (chip) return chip.textContent.trim();
  return slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function headingText(s) {
  if (s.q && s.materia) return `Resultados em ${subjectName(s.materia)}`;
  if (s.q) return 'Resultados da busca';
  if (s.materia) return `Dúvidas de ${subjectName(s.materia)}`;
  return 'Perguntas recentes';
}

function syncChrome(s) {
  const heading = headingText(s);
  els.title.textContent = heading;
  document.title = s.materia ? `Dúvidas de ${subjectName(s.materia)} — Professores | Quanta Aulas` : BASE_TITLE;

  if (els.q && document.activeElement !== els.q) els.q.value = s.q;
  if (els.materia) {
    ensureMateriaOption(s.materia);
    els.materia.value = s.materia;
  }
  document.querySelectorAll('#qaMaterias a[data-materia]').forEach((a) => {
    const on = a.dataset.materia === s.materia;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
  // Card "Quer aula particular?" leva para a busca da mesma matéria
  const busca = $('qaBuscaLink');
  if (busca) {
    busca.href = s.materia ? `/professores/?materia=${encodeURIComponent(s.materia)}` : '/professores/';
    busca.textContent = s.materia ? `Professores de ${subjectName(s.materia)}` : 'Buscar professores';
  }
}

function ensureMateriaOption(slug) {
  const sel = els.materia;
  if (!sel || !slug) return;
  if (![...sel.options].some((o) => o.value === slug)) sel.append(h('option', { value: slug }, subjectName(slug)));
}

// ---------- Busca ----------

let searchSeq = 0;

function apply(next, { history: kind = 'push', focus = false } = {}) {
  state = next;
  if (kind !== 'none') writeUrl(state, kind);
  syncChrome(state);
  search(state);
  if (focus) {
    els.title.focus({ preventScroll: true });
    const top = els.section.getBoundingClientRect().top;
    if (top < 0) els.section.scrollIntoView({ block: 'start' });
  }
}

async function search(s) {
  const seq = ++searchSeq;
  els.results.setAttribute('aria-busy', 'true');
  els.results.replaceChildren(skeletonCards(3));
  els.count.textContent = 'Buscando perguntas…';
  els.pager.replaceChildren();
  try {
    const { data, error } = await sb.rpc('search_questions', {
      q: s.q || null,
      p_materia: s.materia || null,
      p_lim: PER_PAGE,
      p_pagina: Math.max(0, s.pagina - 1),
    });
    if (seq !== searchSeq) return;
    if (error) throw error;
    renderResults(Array.isArray(data) ? data : [], s);
  } catch (err) {
    if (seq !== searchSeq) return;
    els.count.textContent = '';
    els.results.replaceChildren(h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' },
      h('p', { class: 'pf-notice-title' }, 'Não foi possível carregar as perguntas.'),
      h('p', {}, errorMsg(err)),
      h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => search(state) }, 'Tentar de novo'))));
  } finally {
    if (seq === searchSeq) els.results.setAttribute('aria-busy', 'false');
  }
}

function renderResults(rows, s) {
  const list = rows.filter((r) => r && qaId(r.id));
  const total = list.length ? Number(list[0].total) || list.length : 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  if (!list.length) {
    els.count.textContent = 'Nenhuma pergunta encontrada.';
    els.results.replaceChildren(renderEmpty(s));
    return;
  }
  let count = total === 1 ? '1 pergunta' : `${NUM.format(total)} perguntas`;
  if (pages > 1) count += ` · página ${NUM.format(s.pagina)} de ${NUM.format(pages)}`;
  els.count.textContent = count;
  els.results.replaceChildren(h('ul', { class: 'pf-qa-list', 'aria-label': 'Perguntas' }, list.map((r) => h('li', {}, questionCard(r)))));
  renderPager(s.pagina, pages);
}

function questionCard(r) {
  const n = Number(r.answers_count) || 0;
  const subject = r.subject_name ? String(r.subject_name) : '';
  return h('article', { class: ['pf-qa-card', n > 0 ? 'has-answers' : null] },
    h('div', { class: 'pf-qa-card-count', 'aria-hidden': 'true' },
      h('strong', {}, String(n)),
      h('span', {}, n === 1 ? 'resposta' : 'respostas')),
    h('div', { class: 'pf-qa-card-main' },
      h('h3', { class: 'pf-qa-card-title' }, h('a', { href: questionUrl(r.id) }, String(r.title || 'Pergunta'))),
      h('p', { class: 'pf-qa-card-meta' },
        subject ? h('span', { class: 'pf-chip pf-chip-sm' }, subject) : null,
        h('span', {}, `por ${r.author_name ? String(r.author_name) : 'Aluno'}`),
        timeEl(r.created_at),
        h('span', { class: ['pf-qa-card-answers', n > 0 ? 'is-answered' : null] }, answersLabel(n)))));
}

function renderEmpty(s) {
  if (s.pagina > 1) {
    return emptyState('Não há perguntas nesta página.', { label: 'Voltar para a primeira página', onClick: () => apply({ ...state, pagina: 1 }, { focus: true }) });
  }
  const ask = h('a', { class: 'btn btn-primary btn-sm', href: ASK_HASH, onClick: (e) => { e.preventDefault(); openAsk(); } }, 'Fazer uma pergunta');
  if (s.q || s.materia) {
    return emptyState(
      s.q ? 'Nenhuma pergunta encontrada. Tente outras palavras ou faça você mesmo a pergunta: professores respondem de graça.'
        : `Ainda não há perguntas de ${subjectName(s.materia)}. Seja o primeiro a perguntar!`,
      h('div', { class: 'pf-qa-empty-actions' },
        ask,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => apply({ q: '', materia: '', pagina: 1 }, { focus: true }) }, 'Ver todas as perguntas')));
  }
  return emptyState('Ainda não há perguntas. Faça a primeira: professores respondem de graça!', ask);
}

// ---------- Paginação ----------

function pageList(cur, pages) {
  const set = new Set([1, pages, cur - 1, cur, cur + 1]);
  const list = [...set].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of list) {
    if (p - prev > 1) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}

function pageLink(p, label, attrs = {}) {
  return h('a', {
    href: stateUrl({ ...state, pagina: p }, ''),
    ...attrs,
    onClick: (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      apply({ ...state, pagina: p }, { focus: true });
    },
  }, label);
}

function renderPager(cur, pages) {
  if (pages <= 1) {
    els.pager.replaceChildren();
    return;
  }
  const items = [];
  items.push(cur > 1
    ? pageLink(cur - 1, '‹ Anterior', { rel: 'prev', 'aria-label': 'Página anterior' })
    : h('span', { class: 'pf-qa-page-off', 'aria-disabled': 'true' }, '‹ Anterior'));
  for (const p of pageList(cur, pages)) {
    if (p == null) items.push(h('span', { class: 'pf-qa-page-gap', 'aria-hidden': 'true' }, '…'));
    else if (p === cur) items.push(h('span', { class: 'pf-qa-page-cur', 'aria-current': 'page', 'aria-label': `Página ${p}, atual` }, String(p)));
    else items.push(pageLink(p, String(p), { 'aria-label': `Página ${p}` }));
  }
  items.push(cur < pages
    ? pageLink(cur + 1, 'Próxima ›', { rel: 'next', 'aria-label': 'Próxima página' })
    : h('span', { class: 'pf-qa-page-off', 'aria-disabled': 'true' }, 'Próxima ›'));
  els.pager.replaceChildren(...items);
}

// ---------- Matérias ----------

function loadSubjects() {
  if (!subjectsPromise) {
    subjectsPromise = (async () => {
      const { data, error } = await sb.from('subjects').select('id,slug,name,category').order('category').order('name');
      if (error) throw error;
      subjectsList = (Array.isArray(data) ? data : []).filter((s) => s && s.slug && s.id != null);
      subjectsBySlug.clear();
      for (const s of subjectsList) subjectsBySlug.set(String(s.slug), s);
      return subjectsList;
    })();
    subjectsPromise.catch(() => { subjectsPromise = null; }); // deixa tentar de novo
  }
  return subjectsPromise;
}

function groupedOptions(list, valueKey) {
  const groups = new Map();
  for (const s of list) {
    const cat = String(s.category || 'Outras');
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(s);
  }
  return [...groups].map(([cat, items]) => h('optgroup', { label: cat },
    items.map((s) => h('option', { value: String(s[valueKey]) }, String(s.name)))));
}

async function fillFilterSubjects() {
  try {
    const list = await loadSubjects();
    if (!list.length) return;
    els.materia.replaceChildren(h('option', { value: '' }, 'Todas as matérias'), ...groupedOptions(list, 'slug'));
    // Chips: nome oficial; some o que não existe no banco
    document.querySelectorAll('#qaMaterias a[data-materia]').forEach((a) => {
      if (!a.dataset.materia) return;
      const s = subjectsBySlug.get(a.dataset.materia);
      if (s) a.textContent = String(s.name);
      else a.remove();
    });
    syncChrome(state);
  } catch {
    /* sem a lista: o select fica só com "Todas as matérias" e a busca segue */
  }
}

// ---------- Nova pergunta ----------

let askMounted = false;

function openAsk({ focus = true } = {}) {
  const sec = els.askSec;
  sec.hidden = false;
  els.askBtn?.setAttribute('aria-expanded', 'true');
  if (location.hash !== ASK_HASH) history.replaceState(history.state, '', location.pathname + location.search + ASK_HASH);
  if (!askMounted) {
    askMounted = true;
    mountAsk().catch((err) => {
      askMounted = false;
      els.askBody.replaceChildren(h('p', { class: 'pf-error', role: 'alert' }, errorMsg(err)));
    });
  }
  if (focus) {
    sec.scrollIntoView({ block: 'start' });
    $('perguntarTitulo')?.focus({ preventScroll: true });
  }
}

function closeAsk() {
  els.askSec.hidden = true;
  els.askBtn?.setAttribute('aria-expanded', 'false');
  if (location.hash === ASK_HASH) history.replaceState(history.state, '', location.pathname + location.search);
  els.askBtn?.focus();
}

async function mountAsk() {
  const body = els.askBody;
  body.replaceChildren(h('p', { class: 'pf-loading', role: 'status' }, 'Carregando…'));
  let profile = null;
  try {
    profile = await getProfile();
  } catch {
    profile = null;
  }
  const next = `${location.pathname}${location.search}${ASK_HASH}`;
  if (!profile) {
    body.replaceChildren(h('div', { class: 'pf-qa-login' },
      h('p', {}, 'Para perguntar, entre na sua conta. É grátis e leva menos de um minuto.'),
      h('div', { class: 'pf-form-actions' },
        h('a', { class: 'btn btn-primary btn-sm', href: loginUrl(next) }, 'Entrar para perguntar'),
        h('a', { class: 'btn btn-ghost btn-sm', href: `/professores/entrar.html?modo=cadastro&next=${encodeURIComponent(next)}` }, 'Criar conta grátis'))));
    return;
  }
  if (profile.banned_at) {
    body.replaceChildren(h('div', { class: 'pf-notice pf-notice--warn', role: 'status' },
      h('p', {}, 'Sua conta está suspensa e não pode publicar perguntas.')));
    return;
  }
  body.replaceChildren(askForm());
  fillAskSubjects();
}

let askEls = null;

function askForm() {
  const subjectSel = h('select', { id: 'askMateria', name: 'materia', class: 'pf-select', required: true, 'aria-describedby': 'askMateria-err' },
    h('option', { value: '' }, 'Carregando matérias…'));
  const subjectErr = h('p', { class: 'pf-error pf-qa-err', id: 'askMateria-err', role: 'alert' });
  const title = countedField({
    id: 'askTitulo', label: 'Título da pergunta', min: QA_LIMITS.titleMin, max: QA_LIMITS.titleMax, required: true,
    placeholder: 'Ex.: Como resolver uma equação do 2º grau com delta negativo?',
    hint: 'Resuma a dúvida em uma frase.',
  });
  const text = countedField({
    id: 'askTexto', label: 'Detalhes (opcional)', multiline: true, max: QA_LIMITS.questionBodyMax, rows: 7,
    placeholder: 'Escreva o enunciado, o que você já tentou e onde travou.',
    hint: 'Não coloque telefone, e-mail ou dados pessoais. Seu nome aparece abreviado (ex.: Maria S.).',
  });
  const status = h('p', { class: 'pf-qa-status', role: 'status', 'aria-live': 'polite' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Publicar pergunta');
  const cancel = h('button', { type: 'button', class: 'btn btn-ghost', onClick: closeAsk }, 'Cancelar');
  const form = h('form', { class: 'pf-form pf-qa-form', id: 'askForm', novalidate: true, 'aria-labelledby': 'perguntarTitulo' },
    h('div', { class: 'pf-field' },
      h('label', { class: 'pf-label', for: 'askMateria' }, 'Matéria', h('span', { class: 'pf-req', 'aria-hidden': 'true' }, ' *')),
      subjectSel,
      subjectErr),
    title.field,
    text.field,
    h('div', { class: 'pf-form-actions' }, submit, cancel),
    status);

  askEls = { form, subjectSel, subjectErr, title, text, status, submit };
  subjectSel.addEventListener('change', () => setSubjectError(''));
  form.addEventListener('submit', onAskSubmit);
  return form;
}

function setSubjectError(msg) {
  askEls.subjectErr.textContent = msg || '';
  if (msg) askEls.subjectSel.setAttribute('aria-invalid', 'true');
  else askEls.subjectSel.removeAttribute('aria-invalid');
}

async function fillAskSubjects() {
  const sel = askEls.subjectSel;
  try {
    const list = await loadSubjects();
    sel.replaceChildren(h('option', { value: '' }, 'Escolha a matéria'), ...groupedOptions(list, 'id'));
    // Filtro de matéria ativo já sugere a matéria da pergunta
    const cur = subjectsBySlug.get(state.materia);
    if (cur) sel.value = String(cur.id);
  } catch (err) {
    sel.replaceChildren(h('option', { value: '' }, 'Não foi possível carregar as matérias'));
    setSubjectError(`${errorMsg(err)} Recarregue a página para tentar de novo.`);
  }
}

async function onAskSubmit(e) {
  e.preventDefault();
  const { subjectSel, title, text, status, submit } = askEls;
  if (submit.disabled) return;
  status.textContent = '';
  const subjectId = Number(subjectSel.value);
  const okSubject = Number.isInteger(subjectId) && subjectId > 0;
  setSubjectError(okSubject ? '' : 'Escolha a matéria.');
  const okTitle = title.validate();
  const okText = text.validate();
  if (!okSubject || !okTitle || !okText) {
    const first = !okSubject ? subjectSel : !okTitle ? title.input : text.input;
    first.focus();
    return;
  }

  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  status.textContent = 'Publicando…';
  try {
    // Só as colunas com grant de INSERT (author_id vem de auth.uid() no banco)
    const { data, error } = await sb.from('questions')
      .insert({ subject_id: subjectId, title: title.value(), body: text.value() })
      .select('id')
      .single();
    if (error) throw error;
    const id = qaId(data && data.id);
    status.textContent = 'Pergunta publicada! Abrindo…';
    location.href = id ? questionUrl(id) : '/professores/duvidas.html';
  } catch (err) {
    const msg = qaErrorMsg(err, 'pergunta');
    status.textContent = '';
    status.append(h('span', { class: 'pf-error' }, msg));
    toast(msg, 'erro');
    submit.disabled = false;
    submit.removeAttribute('aria-busy');
  }
}

// ---------- Card "Você é professor?" ----------

async function syncTutorCard() {
  let profile = null;
  try {
    profile = await getProfile();
  } catch {
    return;
  }
  const link = $('qaTutorLink');
  const card = $('qaTutorCard');
  if (!link || !card || !profile) return;
  if (profile.role === 'tutor') {
    card.querySelector('.pf-qa-side-title').textContent = 'Responda e seja encontrado';
    card.querySelector('p').textContent = 'Abra uma pergunta e deixe a sua resposta. Ela aparece no seu perfil público.';
    link.textContent = 'Minhas respostas';
    link.href = '/professores/painel.html#duvidas';
  } else {
    link.textContent = 'Quero dar aulas';
    link.href = '/professores/painel.html';
  }
}

// ---------- Eventos ----------

function bindEvents() {
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    apply({ q: cleanQ(els.q.value), materia: SLUG_RE.test(els.materia.value) ? els.materia.value : '', pagina: 1 }, { focus: true });
  });
  els.materia.addEventListener('change', () => {
    apply({ ...state, q: cleanQ(els.q.value), materia: SLUG_RE.test(els.materia.value) ? els.materia.value : '', pagina: 1 });
  });
  document.querySelectorAll('#qaMaterias a[data-materia]').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      const slug = a.dataset.materia || '';
      apply({ ...state, materia: slug, pagina: 1 });
    });
  });
  els.askBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    if (els.askSec.hidden) openAsk();
    else closeAsk();
  });
  window.addEventListener('popstate', () => {
    apply(readState(), { history: 'none' });
  });
  window.addEventListener('hashchange', () => {
    if (location.hash === ASK_HASH && els.askSec.hidden) openAsk();
  });
}

// ---------- Início ----------

function main() {
  initChrome();
  els.form = $('qaBusca');
  els.q = $('fQ');
  els.materia = $('fMateria');
  els.results = $('qaResultados');
  els.pager = $('qaPaginacao');
  els.count = $('qaCount');
  els.title = $('perguntasTitulo');
  els.section = $('perguntas');
  els.askSec = $('perguntar');
  els.askBody = $('askBody');
  els.askBtn = $('btnPerguntar');
  if (!els.form || !els.results || !els.pager || !els.count || !els.title || !els.askSec) return;

  syncChrome(state);
  writeUrl(state, 'replace'); // normaliza valores inválidos da URL

  if (!isConfigured) {
    notConfiguredNotice(els.results);
    if (els.askBtn) els.askBtn.hidden = true;
    return;
  }

  bindEvents();
  search(state);
  fillFilterSubjects();
  syncTutorCard();
  if (location.hash === ASK_HASH) openAsk();
}

main();
