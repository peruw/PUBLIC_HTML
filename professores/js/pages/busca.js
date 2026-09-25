/* ============================================
   Página: busca de professores — /professores/ (dono: busca-perfil)
   Filtros <-> URL (?q=&materia=&uf=&cidade=&modo=&min=&max=&ordem=&pagina=),
   preços em reais na URL e em centavos na RPC search_tutors.
   ============================================ */

import '../../css/busca.css';
import { sb } from '../supabase.js';
import { isConfigured } from '../config.js';
import {
  initChrome, h, brl, starsEl, avatarEl, planBadge, emptyState, skeletonCards, errorMsg, notConfiguredNotice,
} from '../ui.js';
import { cityPicker, isUf, UFS } from '../municipios.js';

const PER_PAGE = 12;
const MAX_CHIPS = 4;
const ORDENS = ['relevancia', 'preco_asc', 'preco_desc', 'avaliacao'];
const MODOS = ['online', 'presencial'];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TYPING_DELAY = 450;
const CADASTRO_URL = '/professores/entrar.html?modo=cadastro&tipo=professor';
const BASE_TITLE = document.title;
const NUM = new Intl.NumberFormat('pt-BR');

// ---------- Estado <-> URL ----------

/** "50", "49,90" -> 50 / 49.9 (reais, 0..1000). Inválido/vazio -> null. */
function parseReais(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(Math.min(n, 1000) * 100) / 100;
}

const toCents = (reais) => (reais == null ? null : Math.round(reais * 100));

function cleanQ(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Estado da busca a partir da URL atual (valores inválidos são descartados). */
function readState() {
  const p = new URLSearchParams(location.search);
  const uf = String(p.get('uf') || '').toUpperCase();
  const cidade = p.get('cidade') || '';
  const materia = String(p.get('materia') || '').toLowerCase();
  const pagina = parseInt(p.get('pagina') || '', 10);
  let min = parseReais(p.get('min') ?? p.get('preco_min'));
  let max = parseReais(p.get('max') ?? p.get('preco_max'));
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return {
    q: cleanQ(p.get('q')),
    materia: SLUG_RE.test(materia) && materia.length <= 60 ? materia : '',
    uf: isUf(uf) ? uf : '',
    cidade: isUf(uf) && /^\d{7}$/.test(cidade) ? Number(cidade) : null,
    modo: MODOS.includes(p.get('modo')) ? p.get('modo') : '',
    min,
    max,
    ordem: ORDENS.includes(p.get('ordem')) ? p.get('ordem') : 'relevancia',
    pagina: Number.isInteger(pagina) && pagina > 1 ? Math.min(pagina, 1000) : 1,
  };
}

/** URL (pathname + query) que representa o estado; mantém parâmetros alheios (utm etc.). */
function stateUrl(s) {
  const p = new URLSearchParams(location.search);
  const set = {
    q: s.q || null,
    materia: s.materia || null,
    uf: s.uf || null,
    cidade: s.cidade || null,
    modo: s.modo || null,
    min: s.min ?? null,
    max: s.max ?? null,
    ordem: s.ordem && s.ordem !== 'relevancia' ? s.ordem : null,
    pagina: s.pagina > 1 ? s.pagina : null,
    preco_min: null, // nomes do formulário sem JS: viram min/max
    preco_max: null,
  };
  for (const [k, v] of Object.entries(set)) {
    if (v == null || v === '') p.delete(k);
    else p.set(k, String(v));
  }
  const qs = p.toString();
  return location.pathname + (qs ? `?${qs}` : '') + location.hash;
}

// Digitação seguida no campo de texto vira UMA entrada no histórico (as seguintes substituem)
let lastHistoryKind = null;
let typingTimer = null;

function writeUrl(s, kind) {
  const url = stateUrl(s);
  const current = location.pathname + location.search + location.hash;
  if (url === current) return;
  if (kind === 'replace' || (kind === 'typing' && lastHistoryKind === 'typing')) {
    history.replaceState(history.state, '', url);
  } else {
    history.pushState(null, '', url);
  }
  lastHistoryKind = kind;
}

function rpcParams(s) {
  return {
    q: s.q || null,
    p_materia: s.materia || null,
    p_uf: s.uf || null,
    p_cidade: s.cidade || null,
    p_modo: s.modo || null,
    p_preco_min: toCents(s.min),
    p_preco_max: toCents(s.max),
    p_ordem: s.ordem || 'relevancia',
    p_lim: PER_PAGE,
    p_pagina: Math.max(0, (s.pagina || 1) - 1),
  };
}

const hasFilters = (s) => Boolean(s.q || s.materia || s.uf || s.cidade || s.modo || s.min != null || s.max != null);

// ---------- Elementos ----------

const $ = (id) => document.getElementById(id);
const els = {};
let state = readState();
let picker = null;
const subjectsBySlug = new Map(); // slug -> { id, slug, name, category }

// ---------- Textos derivados ----------

function subjectName(slug) {
  if (!slug) return '';
  if (subjectsBySlug.has(slug)) return subjectsBySlug.get(slug).name;
  const chip = document.querySelector(`#atalhosMaterias a[data-materia="${slug}"]`);
  if (chip) return chip.textContent.trim();
  return slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function placeText(s) {
  const loc = picker?.getValue?.();
  const ufNome = UFS.find((u) => u.sigla === s.uf)?.nome || s.uf;
  if (s.cidade && loc && loc.cityId === s.cidade && loc.cityName) return `${loc.cityName}/${s.uf}`;
  if (s.uf) return ufNome;
  return '';
}

function priceText(s) {
  const fmt = (v) => brl(toCents(v)).replace(/,00$/, '');
  if (s.min != null && s.max != null) return `${fmt(s.min)} a ${fmt(s.max)}`;
  if (s.min != null) return `A partir de ${fmt(s.min)}`;
  if (s.max != null) return `Até ${fmt(s.max)}`;
  return '';
}

function headingText(s) {
  let t = 'Professores';
  if (s.materia) t += ` de ${subjectName(s.materia)}`;
  if (s.modo === 'online') t += ' online';
  const place = s.modo === 'online' ? '' : placeText(s);
  if (place) t += ` em ${place}`;
  return t;
}

// ---------- Formulário ----------

function ensureMateriaOption(slug) {
  const sel = els.materia;
  if (!sel || !slug) return;
  if (![...sel.options].some((o) => o.value === slug)) {
    sel.append(h('option', { value: slug }, subjectName(slug)));
  }
}

function stateToForm(s, { withPicker = true } = {}) {
  if (els.q) els.q.value = s.q;
  if (els.modo) els.modo.value = s.modo;
  if (els.materia) {
    ensureMateriaOption(s.materia);
    els.materia.value = s.materia;
  }
  if (els.min) els.min.value = s.min ?? '';
  if (els.max) els.max.value = s.max ?? '';
  if (els.ordem) els.ordem.value = s.ordem;
  if (picker && withPicker) {
    const cur = picker.getValue();
    if (cur.uf !== (s.uf || null) || cur.cityId !== s.cidade) {
      picker.setValue({ uf: s.uf, cityId: s.cidade }).then(() => syncChrome(state));
    }
  }
}

/** Estado a partir dos campos (local vem do estado, atualizado pelo onChange do seletor de cidade). */
function formToState() {
  let min = parseReais(els.min?.value);
  let max = parseReais(els.max?.value);
  if (min != null && max != null && min > max) [min, max] = [max, min];
  const modo = els.modo?.value || '';
  const materia = els.materia?.value || '';
  const ordem = els.ordem?.value || 'relevancia';
  return {
    ...state,
    q: cleanQ(els.q?.value),
    modo: MODOS.includes(modo) ? modo : '',
    materia: SLUG_RE.test(materia) ? materia : '',
    min,
    max,
    ordem: ORDENS.includes(ordem) ? ordem : 'relevancia',
    pagina: 1,
  };
}

// ---------- Chrome derivado do estado (título, chips, filtros ativos) ----------

function syncChrome(s) {
  const heading = headingText(s);
  if (els.title) els.title.textContent = heading;
  document.title = heading === 'Professores' ? BASE_TITLE : `${heading} — Professores | Quanta Aulas`;

  document.querySelectorAll('#atalhosMaterias a[data-materia]').forEach((a) => {
    const on = a.dataset.materia === s.materia;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });

  renderActiveFilters(s);
}

function renderActiveFilters(s) {
  const box = els.active;
  if (!box) return;
  const items = [];
  const chip = (label, patch) => h('li', {},
    h('button', {
      type: 'button',
      class: 'pf-chip pf-chip-sm pf-filter-chip',
      'aria-label': `Remover filtro: ${label}`,
      onClick: () => update({ ...patch, pagina: 1 }, { focusResults: true }),
    }, h('span', {}, label), h('span', { class: 'pf-filter-x', 'aria-hidden': 'true' }, '×')));

  if (s.q) items.push(chip(`“${s.q}”`, { q: '' }));
  if (s.materia) items.push(chip(subjectName(s.materia), { materia: '' }));
  if (s.modo) items.push(chip(s.modo === 'online' ? 'Online' : 'Presencial', { modo: '' }));
  const place = placeText(s);
  if (place) items.push(chip(place, { uf: '', cidade: null }));
  const price = priceText(s);
  if (price) items.push(chip(price, { min: null, max: null }));

  if (!items.length) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.replaceChildren(
    h('span', { class: 'pf-active-label', id: 'filtrosAtivosLabel' }, 'Filtros:'),
    h('ul', { class: 'pf-chips pf-active-list', 'aria-labelledby': 'filtrosAtivosLabel' }, items),
    h('button', { type: 'button', class: 'pf-link-btn', onClick: () => clearFilters() }, 'Limpar filtros'));
}

// ---------- Aplicar mudanças ----------

let lastApply = { key: '', at: 0 };

/**
 * Aplica um novo estado: URL (push/replace), formulário, textos e busca.
 * opts.history: 'push' (padrão) | 'replace' | 'typing' | 'none'
 */
function apply(next, { history: kind = 'push', syncForm = true, focusResults = false, scroll = false } = {}) {
  // Enter num campo de preço dispara "change" e "submit" juntos: uma busca só
  const key = JSON.stringify(rpcParams(next));
  const now = Date.now();
  if (kind !== 'none' && key === lastApply.key && key === JSON.stringify(rpcParams(state)) && now - lastApply.at < 500) return;
  lastApply = { key, at: now };
  state = next;
  if (kind !== 'none') writeUrl(state, kind);
  if (syncForm) stateToForm(state);
  syncChrome(state);
  search(state);
  if (scroll) scrollToResults();
  if (focusResults) els.title?.focus({ preventScroll: true });
}

function update(patch, opts) {
  apply({ ...state, ...patch }, opts);
}

function clearFilters() {
  apply({ ...state, q: '', materia: '', uf: '', cidade: null, modo: '', min: null, max: null, pagina: 1 }, { focusResults: true });
}

function scrollToResults() {
  const sec = els.section;
  if (!sec) return;
  const top = sec.getBoundingClientRect().top;
  if (top < 0 || top > window.innerHeight * 0.6) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    sec.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
}

// ---------- Busca ----------

let searchSeq = 0;

async function search(s) {
  const seq = ++searchSeq;
  const results = els.results;
  results.setAttribute('aria-busy', 'true');
  results.replaceChildren(skeletonCards(3));
  els.count.textContent = 'Buscando professores…';
  els.pager.replaceChildren();
  try {
    const { data, error } = await sb.rpc('search_tutors', rpcParams(s));
    if (seq !== searchSeq) return;
    if (error) throw error;
    renderResults(Array.isArray(data) ? data : [], s);
  } catch (err) {
    if (seq !== searchSeq) return;
    renderError(err);
  } finally {
    if (seq === searchSeq) results.setAttribute('aria-busy', 'false');
  }
}

function renderResults(rows, s) {
  const total = rows.length ? Number(rows[0].total) || rows.length : 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  if (!rows.length) {
    els.count.textContent = 'Nenhum professor encontrado.';
    els.results.replaceChildren(renderEmpty(s));
    return;
  }

  const n = NUM.format(total);
  let count = total === 1 ? '1 professor encontrado' : `${n} professores encontrados`;
  if (pages > 1) count += ` · página ${NUM.format(s.pagina)} de ${NUM.format(pages)}`;
  els.count.textContent = count;

  els.results.replaceChildren(h('ul', { class: 'pf-tutor-list', 'aria-label': 'Resultados da busca' },
    rows.map((row) => h('li', {}, tutorCard(row)))));
  renderPager(s.pagina, pages);
}

function renderEmpty(s) {
  if (s.pagina > 1) {
    return emptyState('Não há resultados nesta página.', { label: 'Voltar para a primeira página', onClick: () => update({ pagina: 1 }, { focusResults: true }) });
  }
  if (!hasFilters(s)) {
    return emptyState('Ainda não há professores publicados por aqui. Dá aulas particulares? Seja o primeiro!',
      { label: 'Quero ser professor', href: CADASTRO_URL });
  }
  const actions = [
    h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: () => clearFilters() }, 'Limpar filtros'),
  ];
  if (s.modo !== 'online' && (s.uf || s.cidade || s.modo === 'presencial')) {
    actions.push(h('button', {
      type: 'button', class: 'btn btn-ghost btn-sm',
      onClick: () => update({ modo: 'online', uf: '', cidade: null, pagina: 1 }, { focusResults: true }),
    }, 'Ver aulas online'));
  }
  return emptyState(
    'Nenhum professor encontrado com esses filtros. Tente remover algum filtro, ampliar a faixa de preço ou buscar aulas online.',
    h('div', { class: 'pf-empty-actions' }, actions));
}

function renderError(err) {
  els.count.textContent = '';
  els.pager.replaceChildren();
  els.results.replaceChildren(h('div', { class: 'pf-notice pf-notice--erro pf-busca-error', role: 'alert' },
    h('p', { class: 'pf-notice-title' }, 'Não foi possível carregar os professores.'),
    h('p', {}, errorMsg(err)),
    h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => search(state) }, 'Tentar de novo'))));
}

// ---------- Card do professor ----------

function locationText(row) {
  const parts = [];
  if (row.mode_presencial) {
    const city = row.city_name ? String(row.city_name) : '';
    const uf = row.uf ? String(row.uf).trim() : '';
    const where = city && uf ? `${city}/${uf}` : (city || uf);
    parts.push(where ? `Presencial em ${where}` : 'Presencial');
  }
  if (row.mode_online) parts.push('Online');
  return parts;
}

const ICON_PIN = () => icon('M8 14s5-4.5 5-8.5A5 5 0 0 0 3 5.5C3 9.5 8 14 8 14Z M8 7.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z');
const ICON_SCREEN = () => icon('M2.5 3.5h11v7h-11z M6 13.5h4 M8 10.5v3');

function icon(d) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'pf-ico');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

function tutorCard(row) {
  const name = String(row.full_name || '').trim() || 'Professor';
  const slug = SLUG_RE.test(String(row.slug || '')) ? String(row.slug) : '';
  const premium = row.plan === 'premium';
  const subjects = Array.isArray(row.subjects) ? row.subjects.filter(Boolean) : [];
  const shown = subjects.slice(0, MAX_CHIPS);
  const extra = subjects.length - shown.length;
  const count = Number(row.rating_count) || 0;

  const href = slug ? `/professores/p/${encodeURIComponent(slug)}` : null;
  const nameEl = href ? h('a', { href, class: 'pf-tutor-link' }, name) : h('span', {}, name);

  const where = locationText(row);
  const meta = h('div', { class: 'pf-tutor-meta' },
    count > 0
      ? starsEl(Number(row.rating_avg) || 0, { count })
      : h('span', { class: 'pf-badge pf-badge--muted pf-new' }, 'Novo'),
    where.map((txt) => h('span', { class: 'pf-tutor-where' }, txt === 'Online' ? ICON_SCREEN() : ICON_PIN(), txt)));

  return h('article', { class: ['pf-tutor-card', premium ? 'is-premium' : null], dataset: { slug } },
    h('div', { class: 'pf-tutor-avatar' }, avatarEl(row.avatar_path, name, 84)),
    h('div', { class: 'pf-tutor-main' },
      h('h3', { class: 'pf-tutor-name' }, nameEl, planBadge(row.plan)),
      row.headline ? h('p', { class: 'pf-tutor-headline' }, String(row.headline)) : null,
      meta,
      shown.length
        ? h('ul', { class: 'pf-tutor-subjects', 'aria-label': 'Matérias' },
          shown.map((s) => h('li', { class: 'pf-chip pf-chip-sm' }, String(s))),
          extra > 0 ? h('li', { class: 'pf-chip pf-chip-sm pf-chip-more', title: subjects.slice(MAX_CHIPS).join(', ') },
            h('span', { 'aria-hidden': 'true' }, `+${extra}`),
            h('span', { class: 'pf-sr-only' }, `e mais ${extra} ${extra === 1 ? 'matéria' : 'matérias'}`)) : null)
        : null),
    h('div', { class: 'pf-tutor-side' },
      h('div', { class: 'pf-tutor-price' },
        row.hourly_rate_cents != null
          ? [brl(row.hourly_rate_cents), h('small', {}, '/hora')]
          : h('small', {}, 'Preço a combinar')),
      href ? h('span', { class: 'btn btn-ghost btn-sm pf-card-cta', 'aria-hidden': 'true' }, 'Ver perfil') : null));
}

// ---------- Paginação ----------

function pageList(cur, pages) {
  const set = new Set([1, pages, cur - 1, cur, cur + 1]);
  const list = [...set].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of list) {
    if (p - prev > 1) out.push(null); // reticências
    out.push(p);
    prev = p;
  }
  return out;
}

function pageLink(p, label, attrs = {}) {
  const href = stateUrl({ ...state, pagina: p });
  return h('a', {
    href,
    ...attrs,
    onClick: (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      update({ pagina: p }, { focusResults: true, scroll: true });
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
    ? pageLink(cur - 1, '‹ Anterior', { rel: 'prev', class: 'pf-page-prev', 'aria-label': 'Página anterior' })
    : h('span', { class: 'pf-page-prev pf-page-disabled', 'aria-disabled': 'true' }, '‹ Anterior'));
  for (const p of pageList(cur, pages)) {
    if (p == null) items.push(h('span', { class: 'pf-page-gap', 'aria-hidden': 'true' }, '…'));
    else if (p === cur) items.push(h('span', { class: 'pf-page-current', 'aria-current': 'page', 'aria-label': `Página ${p}, atual` }, String(p)));
    else items.push(pageLink(p, String(p), { 'aria-label': `Página ${p}` }));
  }
  items.push(cur < pages
    ? pageLink(cur + 1, 'Próxima ›', { rel: 'next', class: 'pf-page-next', 'aria-label': 'Próxima página' })
    : h('span', { class: 'pf-page-next pf-page-disabled', 'aria-disabled': 'true' }, 'Próxima ›'));
  els.pager.replaceChildren(...items);
}

// ---------- Matérias ----------

async function loadSubjects() {
  try {
    const { data, error } = await sb.from('subjects').select('id,slug,name,category').order('category').order('name');
    if (error) throw error;
    const list = Array.isArray(data) ? data : [];
    if (!list.length) return;
    subjectsBySlug.clear();
    for (const s of list) if (s && s.slug) subjectsBySlug.set(String(s.slug), s);

    const groups = new Map();
    for (const s of list) {
      const cat = String(s.category || 'Outras');
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(s);
    }
    const sel = els.materia;
    if (sel) {
      sel.replaceChildren(
        h('option', { value: '' }, 'Todas as matérias'),
        ...[...groups].map(([cat, items]) => h('optgroup', { label: cat },
          items.map((s) => h('option', { value: String(s.slug) }, String(s.name))))));
      ensureMateriaOption(state.materia);
      sel.value = state.materia;
    }
    // Atalhos: nome oficial e remove os que não existem no banco
    document.querySelectorAll('#atalhosMaterias a[data-materia]').forEach((a) => {
      const s = subjectsBySlug.get(a.dataset.materia);
      if (s) a.textContent = String(s.name);
      else a.remove();
    });
    syncChrome(state);
  } catch {
    /* sem a lista, o select fica só com "Todas as matérias" (a busca continua funcionando) */
  }
}

// ---------- Eventos ----------

function bindEvents() {
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(typingTimer);
    const fromHero = e.submitter ? els.form.contains(e.submitter) : true;
    apply(formToState(), { scroll: fromHero, syncForm: true });
  });

  els.q?.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      const q = cleanQ(els.q.value);
      if (q === state.q || q.length === 1) return;
      apply({ ...state, q, pagina: 1 }, { history: 'typing', syncForm: false });
    }, TYPING_DELAY);
  });

  for (const el of [els.modo, els.materia, els.ordem]) {
    el?.addEventListener('change', () => {
      clearTimeout(typingTimer);
      apply(formToState(), { syncForm: false });
    });
  }
  for (const el of [els.min, els.max]) {
    el?.addEventListener('change', () => {
      const next = formToState();
      if (next.min === state.min && next.max === state.max) return;
      apply(next, { syncForm: true });
    });
  }

  // Atalhos de matéria: filtram sem recarregar (Ctrl/Cmd+clique continua abrindo em nova aba)
  document.querySelectorAll('#atalhosMaterias a.pf-chip').forEach((a) => {
    const slug = new URL(a.href, location.origin).searchParams.get('materia') || '';
    if (!SLUG_RE.test(slug)) return;
    a.dataset.materia = slug;
    a.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      clearTimeout(typingTimer);
      // mantém o que foi digitado e ainda não buscado (debounce pendente)
      apply({ ...state, q: cleanQ(els.q?.value), materia: state.materia === slug ? '' : slug, pagina: 1 }, { scroll: true });
    });
  });

  // Voltar/avançar do navegador
  window.addEventListener('popstate', () => {
    clearTimeout(typingTimer);
    lastHistoryKind = null;
    apply(readState(), { history: 'none' });
  });
}

// ---------- Início ----------

function main() {
  initChrome();

  els.form = $('buscaForm');
  els.q = $('fQ');
  els.modo = $('fModo');
  els.materia = $('fMateria');
  els.min = $('fPrecoMin');
  els.max = $('fPrecoMax');
  els.ordem = $('fOrdem');
  els.local = $('fLocal');
  els.results = $('resultados');
  els.pager = $('paginacao');
  els.count = $('resultCount');
  els.title = $('resultadosTitulo');
  els.active = $('filtrosAtivos');
  els.section = $('resultadosSec');
  if (!els.form || !els.results || !els.pager || !els.count) return;

  if (els.local) {
    picker = cityPicker({
      uf: state.uf,
      cityId: state.cidade,
      onChange: ({ uf, cityId }) => {
        if ((uf || '') === state.uf && cityId === state.cidade) return;
        apply({ ...state, uf: uf || '', cidade: cityId, pagina: 1 }, { syncForm: false });
      },
    });
    els.local.replaceChildren(picker);
    picker.ready?.then(() => syncChrome(state)).catch(() => {});
  }

  stateToForm(state, { withPicker: false }); // o seletor já nasceu com UF/cidade da URL
  // Normaliza a URL (preco_min/preco_max do formulário sem JS, valores inválidos)
  writeUrl(state, 'replace');
  lastHistoryKind = null;
  syncChrome(state);

  if (!isConfigured) {
    notConfiguredNotice(els.results);
    return;
  }

  bindEvents();
  search(state);
  loadSubjects();
}

main();
