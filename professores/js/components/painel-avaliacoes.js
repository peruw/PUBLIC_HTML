/* ============================================
   Componente: aba "Avaliações" do painel (dono: avaliações)
   Professor: avaliações recebidas (só leitura, com denunciar) + resumo;
              e, se tiver, as que ele mesmo escreveu para outros professores.
   Aluno: avaliações que escreveu (editar/excluir) com link para o perfil do professor.
   Oculta pela moderação ou conta suspensa: sem editar/excluir (o RLS não deixaria).
   Embed de tutor_profiles pode vir null (professor fora do ar) -> "Professor indisponível".
   ============================================ */

import '../../css/avaliacoes.css';
import { sb } from '../supabase.js';
import { loginUrl } from '../auth.js';
import { h, starsEl, avatarEl, toast, modal, errorMsg, emptyState, skeletonCards } from '../ui.js';
import {
  createReviewFeed, reviewForm, reviewTime, reviewsCountText, userError, firstRow, OWN_COLS,
} from './reviews.js';

const WRITTEN_PAGE = 20;
const WRITTEN_COLS = `${OWN_COLS},tutor:tutor_profiles(slug,profile:profiles!user_id(full_name,avatar_path))`;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

let seq = 0;
const nextId = (prefix) => `${prefix}${++seq}`;
const one = (v) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const NUM = new Intl.NumberFormat('pt-BR');

function validSlug(s) {
  const slug = String(s || '');
  return SLUG_RE.test(slug) && slug.length >= 3 && slug.length <= 60 ? slug : null;
}

function decorativeAvatar(path, name, size) {
  const el = avatarEl(path, name, size);
  el.setAttribute('aria-hidden', 'true');
  if (el.tagName === 'IMG') el.alt = '';
  return el;
}

function errorEl(err, retry) {
  return h('div', { class: 'pf-notice pf-notice--erro pf-rv-error', role: 'alert' },
    h('p', { class: 'pf-rv-error-title' }, 'Não foi possível carregar as avaliações.'),
    h('p', {}, errorMsg(err)),
    retry ? h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: retry }, 'Tentar de novo')) : null);
}

// ---------- Professor: recebidas ----------

function receivedSection(profile) {
  const tutor = profile.tutor || one(profile.tutor_profiles) || null;
  const titleId = nextId('pfRvRec');
  const feed = createReviewFeed({
    tutorId: profile.id,
    ratingAvg: tutor?.rating_avg,
    ratingCount: tutor?.rating_count,
    viewerId: profile.id,
    emptyText: 'Você ainda não recebeu avaliações. Seus alunos podem avaliar você depois que você responder às mensagens deles.',
  });
  const slug = tutor && tutor.published && !tutor.suspended ? validSlug(tutor.slug) : null;

  const section = h('section', { class: 'pf-rv-section', 'aria-labelledby': titleId },
    h('div', { class: 'pf-tab-intro pf-rv-intro' },
      h('h2', { id: titleId }, 'Avaliações recebidas'),
      h('p', {}, 'O que os alunos dizem sobre suas aulas. Avaliações não podem ser editadas por você; se alguma desrespeitar as regras, use “Denunciar”.')),
    h('div', { class: 'pf-panel pf-rv pf-rv-panel' },
      feed.summaryEl,
      feed.listEl,
      slug ? h('p', { class: 'pf-rv-public' },
        h('a', { href: `/professores/p/${encodeURIComponent(slug)}#avaliacoes` }, 'Ver as avaliações no meu perfil público')) : null));
  feed.reload();
  return section;
}

// ---------- Avaliações escritas (aluno; professor que avaliou outros) ----------

function writtenSection(profile, { optional = false } = {}) {
  const uid = profile.id;
  const banned = Boolean(profile.banned_at);
  const titleId = nextId('pfRvMine');
  const st = { rows: [], total: 0, token: 0 };

  const heading = h('h2', { id: titleId, tabindex: '-1' }, optional ? 'Avaliações que você escreveu' : 'Minhas avaliações');
  const list = h('ul', { class: 'pf-rv-list', 'aria-labelledby': titleId });
  const body = h('div', { class: 'pf-rv-body' });
  const status = h('p', { class: 'pf-rv-status', role: 'status' });
  const more = h('button', { type: 'button', class: 'btn btn-ghost btn-sm pf-rv-more', hidden: true }, 'Ver mais');

  const section = h('section', { class: 'pf-rv-section', 'aria-labelledby': titleId },
    h('div', { class: 'pf-tab-intro pf-rv-intro' },
      heading,
      h('p', {}, optional
        ? 'Avaliações que você deixou para outros professores.'
        : 'Avaliações que você deixou para professores. Você pode editar ou excluir quando quiser.')),
    banned ? h('div', { class: 'pf-notice pf-notice--warn pf-rv-banned', role: 'status' },
      h('p', {}, 'Sua conta está suspensa: não é possível editar ou excluir avaliações.')) : null,
    h('div', { class: 'pf-panel pf-rv-panel' }, h('div', { class: 'pf-rv-listbox' }, body, status, more)));
  // Professor sem avaliações escritas: a seção nem aparece
  if (optional) section.hidden = true;

  const query = (from) => sb.from('reviews')
    .select(WRITTEN_COLS, { count: 'exact' })
    .eq('student_id', uid)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + WRITTEN_PAGE - 1);

  const ctx = {
    uid,
    banned,
    onDeleted(r, li) {
      st.rows = st.rows.filter((x) => x !== r);
      st.total = Math.max(0, st.total - 1);
      li.remove();
      toast('Avaliação excluída.', 'ok');
      if (!st.rows.length) {
        if (st.total > 0) load();
        else renderEmpty();
      } else {
        updateMore();
      }
      heading.focus();
    },
  };

  function renderEmpty() {
    if (optional) {
      section.hidden = true;
      return;
    }
    body.replaceChildren(emptyState(
      'Você ainda não avaliou nenhum professor. Depois que um professor responder sua mensagem, você pode avaliá-lo na página do perfil dele.',
      { label: 'Buscar professores', href: '/professores/' }));
    more.hidden = true;
    status.textContent = '';
  }

  function updateMore() {
    more.hidden = !(st.rows.length < st.total);
    status.textContent = st.total > WRITTEN_PAGE
      ? `Mostrando ${NUM.format(st.rows.length)} de ${reviewsCountText(st.total)}.`
      : '';
  }

  async function load() {
    const token = ++st.token;
    if (!optional) body.replaceChildren(h('div', { role: 'status' }, h('span', { class: 'pf-sr-only' }, 'Carregando suas avaliações…'), skeletonCards(2)));
    more.hidden = true;
    status.textContent = '';
    try {
      const { data, error, count } = await query(0);
      if (token !== st.token) return;
      if (error) throw error;
      st.rows = Array.isArray(data) ? data : [];
      st.total = Math.max(Number.isFinite(count) ? count : st.rows.length, st.rows.length);
      if (!st.rows.length) {
        renderEmpty();
        return;
      }
      section.hidden = false;
      list.replaceChildren(...st.rows.map((r) => writtenItem(r, ctx)));
      body.replaceChildren(list);
      updateMore();
    } catch (err) {
      if (token !== st.token) return;
      section.hidden = false;
      body.replaceChildren(errorEl(err, () => { load(); }));
    }
  }

  more.addEventListener('click', async () => {
    const token = st.token;
    more.disabled = true;
    more.setAttribute('aria-busy', 'true');
    try {
      const { data, error, count } = await query(st.rows.length);
      if (token !== st.token) return;
      if (error) throw error;
      const seen = new Set(st.rows.map((r) => String(r.id)));
      const fresh = (Array.isArray(data) ? data : []).filter((r) => !seen.has(String(r.id)));
      if (Number.isFinite(count)) st.total = count;
      const start = st.rows.length;
      st.rows.push(...fresh);
      if (!fresh.length) st.total = st.rows.length;
      list.append(...fresh.map((r) => writtenItem(r, ctx)));
      updateMore();
      list.children[start]?.querySelector('.pf-rv-card')?.focus();
    } catch (err) {
      toast(errorMsg(err), 'erro');
    } finally {
      more.disabled = false;
      more.removeAttribute('aria-busy');
    }
  });

  load();
  return section;
}

/** Uma avaliação escrita pelo usuário, com editar (inline) e excluir. */
function writtenItem(r, ctx) {
  const tutor = one(r.tutor);
  const prof = one(tutor?.profile);
  const available = Boolean(tutor);
  const name = available ? (String(prof?.full_name || '').trim() || 'Professor') : 'Professor indisponível';
  const slug = available ? validSlug(tutor.slug) : null;
  const li = h('li', { class: 'pf-rv-item' });

  const focusCard = () => li.querySelector('.pf-rv-card')?.focus();

  function card() {
    const hidden = r.status !== 'published';
    const locked = hidden || ctx.banned;
    const comment = String(r.comment || '').trim();
    return h('article', { class: 'pf-rv-card', tabindex: '-1', 'aria-label': `Sua avaliação de ${name}` },
      h('div', { class: 'pf-rv-head' },
        decorativeAvatar(prof?.avatar_path ?? null, available ? name : '', 40),
        h('div', { class: 'pf-rv-who' },
          h('p', { class: 'pf-rv-name' },
            slug
              ? h('a', { class: 'pf-rv-name-text', href: `/professores/p/${encodeURIComponent(slug)}` }, name)
              : h('span', { class: ['pf-rv-name-text', available ? null : 'pf-muted'] }, name),
            hidden ? h('span', { class: 'pf-badge pf-badge--warn' }, 'Oculta pela moderação') : null),
          h('p', { class: 'pf-rv-meta' }, starsEl(r.rating), reviewTime(r)))),
      comment ? h('p', { class: 'pf-rv-text pf-pre' }, comment) : h('p', { class: 'pf-rv-text pf-muted' }, 'Sem comentário.'),
      hidden ? h('p', { class: 'pf-hint' }, 'Ocultada pela moderação: não aparece no perfil do professor e não pode ser editada nem excluída.') : null,
      !available ? h('p', { class: 'pf-hint' }, 'O perfil deste professor não está disponível no momento.') : null,
      locked ? null : h('div', { class: 'pf-rv-foot pf-rv-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `Editar avaliação de ${name}`, onClick: edit }, 'Editar'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-danger', 'aria-label': `Excluir avaliação de ${name}`, onClick: del }, 'Excluir')));
  }

  function render() {
    li.replaceChildren(card());
  }

  function edit() {
    const hid = nextId('pfRvEdit');
    const form = reviewForm({
      rating: r.rating,
      comment: r.comment,
      submitLabel: 'Salvar alterações',
      onCancel: () => {
        render();
        focusCard();
      },
      onSubmit: async ({ rating, comment }) => {
        const { data, error } = await sb.from('reviews')
          .update({ rating, comment })
          .eq('id', r.id)
          .eq('student_id', ctx.uid)
          .select(OWN_COLS);
        if (error) throw error;
        const row = firstRow(data);
        // RLS: oculta pela moderação ou conta suspensa -> 0 linhas, sem erro
        if (!row) throw userError('Não foi possível salvar: esta avaliação não pode mais ser alterada (pode ter sido ocultada pela moderação).');
        Object.assign(r, row);
        render();
        focusCard();
        toast('Avaliação atualizada.', 'ok');
      },
    });
    li.replaceChildren(h('section', { class: 'pf-rv-card pf-rv-editing', 'aria-labelledby': hid },
      h('h3', { class: 'pf-rv-box-title', id: hid }, `Editar avaliação de ${name}`),
      form));
    form.focusFirst();
  }

  function del() {
    let deleted = false;
    modal({
      title: 'Excluir avaliação?',
      content: h('p', {}, `Sua avaliação de ${name} será removida do perfil do professor. Esta ação não pode ser desfeita.`),
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Excluir avaliação',
          danger: true,
          onClick: async () => {
            const { data, error } = await sb.from('reviews')
              .delete()
              .eq('id', r.id)
              .eq('student_id', ctx.uid)
              .select('id');
            if (error) throw error;
            if (!firstRow(data)) throw userError('Não foi possível excluir: esta avaliação não pode mais ser alterada (pode ter sido ocultada pela moderação).');
            deleted = true;
          },
        },
      ],
      onClose: () => {
        if (deleted) ctx.onDeleted(r, li);
      },
    });
  }

  render();
  return li;
}

// ---------- Aba ----------

/**
 * Professor: avaliações recebidas. Aluno: avaliações feitas (editar/excluir).
 * @param {HTMLElement} container
 * @param {{ profile: object }} opts  profile = auth.getProfile()
 * @returns {void}
 */
export function mountReviewsTab(container, { profile } = {}) {
  if (!container) return;
  if (!profile || !profile.id) {
    container.replaceChildren(emptyState('Entre na sua conta para ver suas avaliações.', { label: 'Entrar', href: loginUrl() }));
    return;
  }
  const parts = [];
  if (profile.role === 'tutor') {
    parts.push(receivedSection(profile));
    parts.push(writtenSection(profile, { optional: true }));
  } else {
    parts.push(writtenSection(profile));
  }
  container.replaceChildren(h('div', { class: 'pf-rv-tab' }, parts));
}
