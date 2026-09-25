/* ============================================
   Componente: avaliações no perfil do professor (dono: avaliações)
   Resumo (média, total, distribuição das notas), lista paginada (10 por vez,
   "Ver mais") e a área do visitante:
     sem login -> "Entre para avaliar";
     com login -> sua avaliação (editar/excluir) ou formulário (se can_review)
                  ou aviso "Você poderá avaliar depois que o professor responder".
   Regras do banco (migração 004): insert só de (tutor_id, rating, comment), com
   can_review + conta ativa; update (rating, comment) e delete só da própria
   avaliação PUBLICADA (oculta pela moderação fica travada; banido não edita).
   Comentários entram só como texto (h()/textContent + white-space: pre-line).
   ============================================ */

import '../../css/avaliacoes.css';
import { sb } from '../supabase.js';
import { isConfigured } from '../config.js';
import { getUser, getProfile, loginUrl } from '../auth.js';
import { h, starsEl, avatarEl, timeAgo, formatDate, toast, modal, errorMsg, skeletonCards } from '../ui.js';
import { reportButton } from './report.js';

export const PAGE_SIZE = 10;
export const MAX_COMMENT = 2000;
// Até este total a distribuição das notas é calculada no cliente (só a coluna rating)
const DIST_MAX = 1000;
export const RATING_LABELS = ['', 'Ruim', 'Regular', 'Bom', 'Muito bom', 'Excelente'];

const LIST_COLS = 'id,rating,comment,created_at,updated_at,reviewer_name,student_id';
export const OWN_COLS = 'id,tutor_id,rating,comment,status,created_at,updated_at';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NUM = new Intl.NumberFormat('pt-BR');
const DEC1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

let seq = 0;
const nextId = (prefix) => `${prefix}${++seq}`;

// ---------- Helpers ----------

/** "1 avaliação" / "12 avaliações". */
export function reviewsCountText(n) {
  const c = Math.max(0, Number(n) || 0);
  return `${NUM.format(c)} ${c === 1 ? 'avaliação' : 'avaliações'}`;
}

/** Erro com mensagem própria em PT (errorMsg() mostra mensagens P0001 como estão). */
export function userError(msg) {
  return Object.assign(new Error(msg), { code: 'P0001' });
}

/** Primeira linha de um retorno do PostgREST (array ou objeto). */
export function firstRow(data) {
  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
}

function clampRating(v) {
  const n = Math.round(Number(v));
  return n >= 1 && n <= 5 ? n : 0;
}

function wasEdited(r) {
  const c = Date.parse(r?.created_at);
  const u = Date.parse(r?.updated_at);
  return Number.isFinite(c) && Number.isFinite(u) && u - c > 60_000;
}

/** "há 2 dias" (data completa no title) + " · editada" se mudou depois de publicada. */
export function reviewTime(r) {
  const iso = r?.created_at;
  const ago = timeAgo(iso);
  if (!ago) return null;
  return h('span', { class: 'pf-rv-time' },
    h('time', { datetime: iso, title: formatDate(iso, { dateStyle: 'long' }) }, ago),
    wasEdited(r) ? h('span', { class: 'pf-rv-edited', title: `Editada em ${formatDate(r.updated_at, { dateStyle: 'long' })}` }, ' · editada') : null);
}

function decorativeAvatar(path, name, size) {
  const el = avatarEl(path, name, size);
  el.setAttribute('aria-hidden', 'true');
  if (el.tagName === 'IMG') el.alt = '';
  return el;
}

function reportSafe(id, who) {
  try {
    const el = reportButton({ type: 'review', id: String(id) });
    // Vários "Denunciar" na página: o nome acessível diz de qual avaliação (começa pelo texto visível)
    if (el instanceof HTMLButtonElement && who) el.setAttribute('aria-label', `Denunciar avaliação de ${who}`);
    return el;
  } catch {
    return null;
  }
}

function computeDist(ratings) {
  const counts = [0, 0, 0, 0, 0, 0];
  let sum = 0;
  let total = 0;
  for (const v of ratings) {
    const n = clampRating(v);
    if (!n) continue;
    counts[n] += 1;
    sum += n;
    total += 1;
  }
  return { counts, sum, total };
}

// ---------- Blocos visuais ----------

/**
 * Resumo: média grande, estrelas, total e (se houver) barras por nota.
 * count 0 -> null (a lista mostra o estado vazio).
 * @returns {HTMLElement|null}
 */
export function summaryEl({ avg = 0, count = 0, dist = null } = {}) {
  const c = Math.max(0, Number(count) || 0);
  if (!c) return null;
  const a = Math.max(0, Math.min(5, Number(avg) || 0));
  const score = h('div', { class: 'pf-rv-score' },
    h('span', { class: 'pf-rv-avg', 'aria-hidden': 'true' }, DEC1.format(a)),
    starsEl(a, { count: c }),
    h('span', { class: 'pf-rv-total', 'aria-hidden': 'true' }, reviewsCountText(c)));

  let bars = null;
  if (dist && dist.total > 0) {
    bars = h('ul', { class: 'pf-rv-dist', 'aria-label': 'Distribuição das notas' },
      [5, 4, 3, 2, 1].map((n) => {
        const k = dist.counts[n] || 0;
        const pct = Math.round((k / dist.total) * 100);
        return h('li', {},
          h('span', { class: 'pf-sr-only' }, `${n} ${n === 1 ? 'estrela' : 'estrelas'}: ${reviewsCountText(k)} (${pct}%)`),
          h('span', { class: 'pf-rv-dist-label', 'aria-hidden': 'true' }, `${n} ★`),
          h('span', { class: 'pf-rv-bar', 'aria-hidden': 'true' },
            h('span', { class: 'pf-rv-bar-fill', style: { width: `${pct}%` } })),
          h('span', { class: 'pf-rv-dist-n', 'aria-hidden': 'true' }, NUM.format(k)));
      }));
  }
  return h('div', { class: ['pf-rv-summary', bars ? null : 'is-compact'] }, score, bars);
}

/**
 * Uma avaliação da lista pública (nome abreviado, nota, data, comentário, denunciar).
 * @returns {HTMLLIElement}
 */
export function reviewItem(r, { viewerId = null, report = true } = {}) {
  const name = String(r?.reviewer_name || '').trim() || 'Aluno';
  const own = Boolean(viewerId && r?.student_id && r.student_id === viewerId);
  const comment = String(r?.comment || '').trim();
  const foot = report && !own ? reportSafe(r.id, name) : null;
  return h('li', { class: 'pf-rv-item' },
    h('article', { class: ['pf-rv-card', own ? 'is-own' : null], 'aria-label': `Avaliação de ${name}`, tabindex: '-1' },
      h('div', { class: 'pf-rv-head' },
        decorativeAvatar(null, name, 40),
        h('div', { class: 'pf-rv-who' },
          h('p', { class: 'pf-rv-name' },
            h('span', { class: 'pf-rv-name-text' }, name),
            own ? h('span', { class: 'pf-badge pf-badge--ok' }, 'Você') : null),
          h('p', { class: 'pf-rv-meta' }, starsEl(r?.rating), reviewTime(r)))),
      comment ? h('p', { class: 'pf-rv-text pf-pre' }, comment) : null,
      foot ? h('div', { class: 'pf-rv-foot' }, foot) : null));
}

function loadingEl(text = 'Carregando avaliações…') {
  return h('div', { class: 'pf-rv-loading', role: 'status' },
    h('span', { class: 'pf-sr-only' }, text),
    skeletonCards(2));
}

function errorEl(err, retry, title = 'Não foi possível carregar as avaliações.') {
  return h('div', { class: 'pf-notice pf-notice--erro pf-rv-error', role: 'alert' },
    h('p', { class: 'pf-rv-error-title' }, title),
    h('p', {}, errorMsg(err)),
    retry ? h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: retry }, 'Tentar de novo')) : null);
}

// ---------- Formulário (nota + comentário) ----------

/**
 * Formulário de avaliação: estrelas (grupo de rádios nativo: Tab entra, setas escolhem)
 * + comentário opcional (até 2000). onSubmit({ rating, comment }) pode lançar erro,
 * que aparece no próprio formulário (role=alert).
 * @returns {HTMLFormElement}
 */
export function reviewForm({ rating = 0, comment = '', submitLabel = 'Publicar avaliação', onSubmit, onCancel } = {}) {
  const id = nextId('pfRv');
  let current = clampRating(rating);
  let busy = false;

  const errBox = h('p', { class: 'pf-error pf-rv-form-error', id: `${id}-err`, role: 'alert' });
  const picked = h('span', { class: 'pf-rv-picked', 'aria-hidden': 'true' });

  const opts = [1, 2, 3, 4, 5].map((n) => {
    const input = h('input', { type: 'radio', name: `${id}-nota`, value: String(n), checked: n === current });
    const label = h('label', { class: 'pf-rv-star-opt', title: RATING_LABELS[n] },
      input,
      h('span', { class: 'pf-rv-star', 'aria-hidden': 'true' }, '★'),
      h('span', { class: 'pf-sr-only' }, `${n} ${n === 1 ? 'estrela' : 'estrelas'}: ${RATING_LABELS[n]}`));
    return { n, input, label };
  });

  const paint = (upTo) => {
    for (const o of opts) o.label.classList.toggle('is-on', o.n <= upTo);
    picked.textContent = upTo ? RATING_LABELS[upTo] : 'Escolha de 1 a 5 estrelas';
    picked.classList.toggle('is-placeholder', !upTo);
  };
  const clearErr = () => {
    errBox.textContent = '';
  };

  for (const o of opts) {
    o.input.addEventListener('change', () => {
      if (!o.input.checked) return;
      current = o.n;
      paint(current);
      clearErr();
    });
    // Prévia ao passar o mouse (não muda a escolha)
    o.label.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') paint(o.n);
    });
  }
  const stars = h('div', { class: 'pf-rv-stars', onPointerleave: () => paint(current) }, opts.map((o) => o.label));
  paint(current);

  const fieldset = h('fieldset', { class: 'pf-fieldset pf-rv-picker', 'aria-describedby': `${id}-err` },
    h('legend', { class: 'pf-label' }, 'Sua nota ', h('span', { class: 'pf-req', 'aria-hidden': 'true' }, '*')),
    h('div', { class: 'pf-rv-picker-row' }, stars, picked));

  const textarea = h('textarea', {
    id: `${id}-c`,
    class: 'pf-textarea pf-rv-comment',
    rows: 5,
    maxlength: MAX_COMMENT,
    placeholder: 'Ex.: Explica com calma, traz muitos exercícios e é pontual. Minhas notas melhoraram!',
    'aria-describedby': `${id}-h ${id}-n`,
    value: String(comment || ''),
  });
  const counter = h('span', { class: 'pf-counter', id: `${id}-n` });
  const updCounter = () => {
    counter.textContent = `${textarea.value.length}/${MAX_COMMENT}`;
  };
  updCounter();
  textarea.addEventListener('input', () => {
    updCounter();
    clearErr();
  });

  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, submitLabel);
  const form = h('form', { class: 'pf-form pf-rv-form', novalidate: true },
    fieldset,
    h('div', { class: 'pf-field' },
      h('label', { class: 'pf-label', for: `${id}-c` }, 'Comentário (opcional)'),
      textarea,
      h('div', { class: 'pf-rv-form-meta' },
        h('span', { class: 'pf-hint', id: `${id}-h` }, 'Fale das aulas. Não inclua telefone, e-mail ou outros dados pessoais.'),
        counter)),
    errBox,
    h('div', { class: 'pf-form-actions' },
      submit,
      onCancel ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: onCancel }, 'Cancelar') : null));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!current) {
      errBox.textContent = 'Escolha uma nota de 1 a 5 estrelas.';
      opts[0].input.focus();
      return;
    }
    const text = textarea.value.trim();
    if (text.length > MAX_COMMENT) {
      errBox.textContent = `O comentário pode ter no máximo ${NUM.format(MAX_COMMENT)} caracteres.`;
      textarea.focus();
      return;
    }
    busy = true;
    clearErr();
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    try {
      await onSubmit?.({ rating: current, comment: text });
    } catch (err) {
      errBox.textContent = errorMsg(err);
    } finally {
      busy = false;
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  });

  /** Foca a nota escolhida (ou a primeira estrela). */
  form.focusFirst = () => {
    const o = opts.find((x) => x.n === current) || opts[0];
    o.input.focus();
  };
  return form;
}

// ---------- Resumo + lista (reutilizado no painel do professor) ----------

/**
 * Resumo e lista paginada das avaliações publicadas de um professor.
 * @param {{ tutorId: string, ratingAvg?: number, ratingCount?: number, viewerId?: string|null,
 *   report?: boolean, emptyText?: string }} opts
 * @returns {{ summaryEl: HTMLElement, listEl: HTMLElement, reload: () => Promise<void>,
 *   setViewer: (id: string|null) => void }}
 */
export function createReviewFeed({
  tutorId, ratingAvg = 0, ratingCount = 0, viewerId = null, report = true,
  emptyText = 'Este professor ainda não recebeu avaliações.',
} = {}) {
  const st = {
    rows: [], total: 0, avg: Number(ratingAvg) || 0, count: Math.max(0, Number(ratingCount) || 0),
    dist: null, token: 0, viewerId, loaded: false,
  };

  const summaryBox = h('div', { class: 'pf-rv-summary-box' });
  const list = h('ul', { class: 'pf-rv-list', 'aria-label': 'Avaliações dos alunos' });
  const body = h('div', { class: 'pf-rv-body' });
  const status = h('p', { class: 'pf-rv-status', role: 'status' });
  const more = h('button', { type: 'button', class: 'btn btn-ghost btn-sm pf-rv-more', hidden: true }, 'Ver mais avaliações');
  const listBox = h('div', { class: 'pf-rv-listbox' }, body, status, more);

  const validTutor = UUID_RE.test(String(tutorId || ''));

  const pageQuery = (from) => sb.from('reviews')
    .select(LIST_COLS, { count: 'exact' })
    .eq('tutor_id', tutorId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const ratingsQuery = () => sb.from('reviews')
    .select('rating')
    .eq('tutor_id', tutorId)
    .eq('status', 'published')
    .limit(DIST_MAX);

  function renderSummary() {
    const el = summaryEl({ avg: st.avg, count: st.count, dist: st.dist });
    summaryBox.replaceChildren(...(el ? [el] : []));
  }

  function updateMore() {
    more.hidden = !(st.rows.length < st.total);
    status.textContent = st.total > PAGE_SIZE
      ? `Mostrando ${NUM.format(st.rows.length)} de ${reviewsCountText(st.total)}.`
      : '';
  }

  function renderList() {
    if (!st.rows.length) {
      body.replaceChildren(h('p', { class: 'pf-rv-empty' }, emptyText));
      more.hidden = true;
      status.textContent = '';
      return;
    }
    list.replaceChildren(...st.rows.map((r) => reviewItem(r, { viewerId: st.viewerId, report })));
    body.replaceChildren(list);
    updateMore();
  }

  async function reload() {
    const token = ++st.token;
    renderSummary();
    if (!validTutor || !isConfigured) {
      st.rows = [];
      st.total = 0;
      renderList();
      return;
    }
    body.replaceChildren(loadingEl());
    listBox.setAttribute('aria-busy', 'true');
    more.hidden = true;
    status.textContent = '';
    try {
      // Distribuição: com poucas avaliações a 1ª página já traz todas; senão busca só as notas
      const wantDist = st.count > PAGE_SIZE && st.count <= DIST_MAX;
      const [page, prefetched] = await Promise.all([pageQuery(0), wantDist ? ratingsQuery() : null]);
      if (token !== st.token) return;
      if (page.error) throw page.error;
      const rows = Array.isArray(page.data) ? page.data : [];
      let total = Number.isFinite(page.count) ? page.count : null;
      if (total == null) total = rows.length < PAGE_SIZE ? rows.length : Math.max(st.count, rows.length);
      total = Math.max(total, rows.length);

      let ratings = null;
      if (total <= rows.length) {
        ratings = rows.map((r) => r.rating);
      } else if (total <= DIST_MAX) {
        const res = prefetched || await ratingsQuery();
        if (token !== st.token) return;
        if (res && !res.error && Array.isArray(res.data) && res.data.length) ratings = res.data.map((r) => r.rating);
      }

      st.rows = rows;
      st.total = total;
      st.count = total;
      st.dist = ratings ? computeDist(ratings) : null;
      if (st.dist && st.dist.total) st.avg = st.dist.sum / st.dist.total;
      if (!total) st.avg = 0;
      st.loaded = true;
      renderSummary();
      renderList();
    } catch (err) {
      if (token !== st.token) return;
      body.replaceChildren(errorEl(err, () => { reload(); }));
    } finally {
      if (token === st.token) listBox.removeAttribute('aria-busy');
    }
  }

  more.addEventListener('click', async () => {
    const token = st.token;
    more.disabled = true;
    more.setAttribute('aria-busy', 'true');
    more.textContent = 'Carregando…';
    try {
      const { data, error, count } = await pageQuery(st.rows.length);
      if (token !== st.token) return;
      if (error) throw error;
      const seen = new Set(st.rows.map((r) => String(r.id)));
      const fresh = (Array.isArray(data) ? data : []).filter((r) => !seen.has(String(r.id)));
      if (Number.isFinite(count)) st.total = count;
      const start = st.rows.length;
      st.rows.push(...fresh);
      if (!fresh.length) st.total = st.rows.length; // nada novo: fim da lista
      list.append(...fresh.map((r) => reviewItem(r, { viewerId: st.viewerId, report })));
      updateMore();
      // Teclado: foco vai para a primeira avaliação nova (o botão pode sumir)
      list.children[start]?.querySelector('.pf-rv-card')?.focus();
    } catch (err) {
      toast(errorMsg(err), 'erro');
    } finally {
      more.disabled = false;
      more.removeAttribute('aria-busy');
      more.textContent = 'Ver mais avaliações';
    }
  });

  renderSummary();

  return {
    summaryEl: summaryBox,
    listEl: listBox,
    reload,
    setViewer(id) {
      st.viewerId = id || null;
      if (st.loaded) renderList();
    },
  };
}

// ---------- Componente do perfil ----------

/**
 * Seção de avaliações do perfil público.
 * Resumo; lista paginada de reviews?tutor_id=eq.&status=eq.published&order=created_at.desc
 * (id,rating,comment,created_at,reviewer_name,student_id); formulário se
 * sb.rpc('can_review', { p_tutor }) = true (ou a própria avaliação para editar/excluir);
 * botão denunciar em cada avaliação de outra pessoa.
 * @param {HTMLElement} container
 * @param {{ tutorId: string, ratingAvg?: number, ratingCount?: number }} opts
 * @returns {void}
 */
export function mountReviews(container, { tutorId, ratingAvg = 0, ratingCount = 0 } = {}) {
  if (!container) return;
  const titleId = nextId('pfRvTitle');
  const feed = createReviewFeed({ tutorId, ratingAvg, ratingCount });
  const userBox = h('div', { class: 'pf-rv-user' });
  const title = h('h2', { class: 'pf-section-title pf-rv-title', id: titleId, tabindex: '-1' }, 'Avaliações');
  container.replaceChildren(h('div', { class: 'pf-rv', dataset: { tutorId: tutorId || '' } },
    title, feed.summaryEl, userBox, feed.listEl));

  const viewer = { user: null, banned: false, own: null };
  let userToken = 0;
  const canQuery = isConfigured && UUID_RE.test(String(tutorId || ''));

  const hintEl = (text, extra = null) => h('div', { class: 'pf-rv-box pf-rv-hint' },
    h('p', {}, text), extra);

  function loggedOutEl() {
    const next = `${location.pathname}${location.search}#avaliacoes`;
    return h('div', { class: 'pf-rv-box pf-rv-hint' },
      h('p', {}, 'Já teve aula com este professor? Conte como foi.'),
      h('a', { class: 'btn btn-ghost btn-sm', href: loginUrl(next) }, 'Entre para avaliar'));
  }

  const focusIn = (sel) => userBox.querySelector(sel)?.focus();

  function ownCard() {
    const own = viewer.own;
    const hidden = own.status !== 'published';
    const locked = hidden || viewer.banned;
    const hid = nextId('pfRvOwn');
    const comment = String(own.comment || '').trim();
    let note = null;
    if (hidden) note = 'Esta avaliação foi ocultada pela moderação e não aparece no perfil. Ela não pode ser editada nem excluída.';
    else if (viewer.banned) note = 'Sua conta está suspensa: não é possível editar ou excluir esta avaliação.';
    return h('section', { class: 'pf-rv-box pf-rv-own', 'aria-labelledby': hid },
      h('div', { class: 'pf-rv-own-head' },
        h('h3', { class: 'pf-rv-box-title', id: hid, tabindex: '-1' }, 'Sua avaliação'),
        hidden ? h('span', { class: 'pf-badge pf-badge--warn' }, 'Oculta pela moderação') : null),
      h('p', { class: 'pf-rv-meta' }, starsEl(own.rating), reviewTime(own)),
      comment ? h('p', { class: 'pf-rv-text pf-pre' }, comment) : h('p', { class: 'pf-rv-text pf-muted' }, 'Sem comentário.'),
      note ? h('p', { class: 'pf-hint' }, note) : null,
      locked ? null : h('div', { class: 'pf-form-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => renderForm({ edit: true }) }, 'Editar avaliação'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-danger', onClick: confirmDelete }, 'Excluir')));
  }

  function renderOwn({ focus = false } = {}) {
    userBox.replaceChildren(ownCard());
    if (focus) focusIn('.pf-rv-box-title');
  }

  function renderForm({ edit = false } = {}) {
    const own = viewer.own;
    const hid = nextId('pfRvForm');
    const form = reviewForm({
      rating: edit ? own.rating : 0,
      comment: edit ? own.comment : '',
      submitLabel: edit ? 'Salvar alterações' : 'Publicar avaliação',
      onCancel: edit ? () => renderOwn({ focus: true }) : null,
      onSubmit: edit ? saveEdit : create,
    });
    userBox.replaceChildren(h('section', { class: 'pf-rv-box pf-rv-formbox', 'aria-labelledby': hid },
      h('h3', { class: 'pf-rv-box-title', id: hid, tabindex: '-1' }, edit ? 'Editar sua avaliação' : 'Avalie este professor'),
      edit ? null : h('p', { class: 'pf-rv-box-text' }, 'Sua avaliação ajuda outros alunos a escolher. Ela aparece com seu primeiro nome e a inicial do sobrenome.'),
      form));
    if (edit) form.focusFirst();
  }

  async function create({ rating, comment }) {
    const { data, error } = await sb.from('reviews')
      .insert({ tutor_id: tutorId, rating, comment })
      .select(OWN_COLS);
    if (error) {
      if (error.code === '23505') {
        toast('Você já avaliou este professor.', 'info');
        await refreshUserBox({ focus: true });
        return;
      }
      if (error.code === '42501') throw userError('Você só pode avaliar depois que o professor responder sua mensagem.');
      throw error;
    }
    viewer.own = firstRow(data);
    if (viewer.own) renderOwn({ focus: true });
    else await refreshUserBox({ focus: true });
    toast('Obrigado! Sua avaliação foi publicada.', 'ok');
    feed.reload();
  }

  async function saveEdit({ rating, comment }) {
    const { data, error } = await sb.from('reviews')
      .update({ rating, comment })
      .eq('id', viewer.own.id)
      .eq('student_id', viewer.user.id)
      .select(OWN_COLS);
    if (error) throw error;
    const row = firstRow(data);
    // RLS: oculta pela moderação ou conta suspensa -> 0 linhas, sem erro
    if (!row) throw userError('Não foi possível salvar: esta avaliação não pode mais ser alterada (pode ter sido ocultada pela moderação).');
    viewer.own = row;
    renderOwn({ focus: true });
    toast('Avaliação atualizada.', 'ok');
    feed.reload();
  }

  function confirmDelete() {
    const own = viewer.own;
    let deleted = false;
    modal({
      title: 'Excluir sua avaliação?',
      content: h('p', {}, 'Sua nota e seu comentário serão removidos do perfil do professor. Esta ação não pode ser desfeita.'),
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Excluir avaliação',
          danger: true,
          onClick: async () => {
            const { data, error } = await sb.from('reviews')
              .delete()
              .eq('id', own.id)
              .eq('student_id', viewer.user.id)
              .select('id');
            if (error) throw error;
            if (!firstRow(data)) throw userError('Não foi possível excluir: esta avaliação não pode mais ser alterada (pode ter sido ocultada pela moderação).');
            deleted = true;
          },
        },
      ],
      onClose: () => {
        if (!deleted) return;
        viewer.own = null;
        toast('Avaliação excluída.', 'ok');
        feed.reload();
        title.focus();
        refreshUserBox();
      },
    });
  }

  async function refreshUserBox({ focus = false } = {}) {
    const token = ++userToken;
    const user = viewer.user;
    if (!canQuery) {
      userBox.replaceChildren();
      return;
    }
    if (!user) {
      userBox.replaceChildren(loggedOutEl());
      return;
    }
    if (user.id === tutorId) {
      // O próprio professor não se avalia
      userBox.replaceChildren();
      return;
    }
    userBox.replaceChildren(h('p', { class: 'pf-loading pf-rv-checking', role: 'status' }, 'Verificando se você pode avaliar…'));
    try {
      const [profile, ownRes] = await Promise.all([
        getProfile().catch(() => null),
        sb.from('reviews').select(OWN_COLS).eq('tutor_id', tutorId).eq('student_id', user.id).maybeSingle(),
      ]);
      if (token !== userToken) return;
      if (ownRes.error) throw ownRes.error;
      viewer.banned = Boolean(profile?.banned_at);
      viewer.own = ownRes.data || null;
      if (viewer.own) {
        renderOwn({ focus });
        return;
      }
      if (viewer.banned) {
        userBox.replaceChildren(hintEl('Sua conta está suspensa, por isso não é possível avaliar professores.'));
        return;
      }
      const { data: can, error } = await sb.rpc('can_review', { p_tutor: tutorId });
      if (token !== userToken) return;
      if (error) throw error;
      if (can === true) {
        renderForm();
        if (focus) focusIn('.pf-rv-box-title');
      } else {
        userBox.replaceChildren(hintEl('Você poderá avaliar depois que o professor responder sua mensagem.'));
      }
    } catch (err) {
      if (token !== userToken) return;
      userBox.replaceChildren(h('div', { class: 'pf-rv-box pf-rv-hint', role: 'alert' },
        h('p', {}, `Não foi possível verificar se você pode avaliar. ${errorMsg(err)}`),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => refreshUserBox({ focus: true }) }, 'Tentar de novo')));
    }
  }

  (async () => {
    let user = null;
    if (canQuery) {
      try {
        user = await getUser();
      } catch {
        user = null;
      }
    }
    viewer.user = user;
    feed.setViewer(user?.id || null);
    await Promise.all([feed.reload(), refreshUserBox()]);
  })().catch(() => { /* erros já são mostrados em cada bloco */ });
}
