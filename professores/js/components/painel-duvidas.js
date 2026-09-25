/* ============================================
   Componente: aba "Tira-dúvidas" do painel (dono: dúvidas)
   Aluno: minhas perguntas (respostas, excluir).
   Professor: minhas respostas (+ minhas perguntas, se tiver) e link para responder.
   Oculto pela moderação / conta banida: sem botões de editar/excluir
   (o RLS recusaria sem erro, mudando 0 linhas).
   ============================================ */

import '../../css/duvidas.css';
import { sb } from '../supabase.js';
import { h, emptyState, errorMsg, toast, modal, formatDate } from '../ui.js';
import { qaId, questionUrl, excerpt, answersLabel, timeEl } from './tutor-answers.js';

const LIMIT = 100;

const one = (x) => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));
const numId = (id) => (Number.isSafeInteger(Number(id)) ? Number(id) : String(id));

async function fetchMyQuestions(uid) {
  const { data, error } = await sb.from('questions')
    .select('id,title,status,answers_count,created_at,subjects(name)')
    .eq('author_id', uid)
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  return (Array.isArray(data) ? data : []).filter((r) => r && qaId(r.id));
}

async function fetchMyAnswers(uid) {
  // Pergunta oculta pela moderação: o embed "questions" volta null (RLS)
  const { data, error } = await sb.from('answers')
    .select('id,body,status,created_at,updated_at,question_id,questions(id,title,status)')
    .eq('tutor_id', uid)
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  return (Array.isArray(data) ? data : []).filter((r) => r && qaId(r.id));
}

function hiddenBadge() {
  return h('span', { class: 'pf-badge pf-badge--warn' }, 'Oculta pela moderação');
}

// ---------- Aluno: minhas perguntas ----------

function questionItem(row, { banned, onDeleted }) {
  const n = Number(row.answers_count) || 0;
  const hidden = row.status !== 'open';
  const subject = one(row.subjects);
  const canDelete = !hidden && !banned;

  const del = canDelete
    ? h('button', {
      type: 'button',
      class: 'btn btn-ghost btn-sm btn-danger',
      'aria-label': `Excluir a pergunta: ${String(row.title || '')}`,
      onClick: () => confirmDelete(row, onDeleted),
    }, 'Excluir')
    : null;

  return h('li', { class: 'pf-pq-item' },
    h('div', { class: 'pf-pq-main' },
      h('a', { class: 'pf-pq-title', href: questionUrl(row.id) }, String(row.title || 'Pergunta')),
      h('p', { class: 'pf-pq-meta' },
        subject && subject.name ? h('span', { class: 'pf-chip pf-chip-sm' }, String(subject.name)) : null,
        timeEl(row.created_at, { prefix: 'Perguntada ' }),
        h('span', { class: ['pf-qa-card-answers', n > 0 ? 'is-answered' : null] }, answersLabel(n)),
        hidden ? hiddenBadge() : null)),
    del ? h('div', { class: 'pf-pq-actions' }, del) : null);
}

function confirmDelete(row, onDeleted) {
  const n = Number(row.answers_count) || 0;
  modal({
    title: 'Excluir pergunta?',
    content: h('div', { class: 'pf-stack' },
      h('p', { class: 'pf-pq-quote' }, String(row.title || '')),
      h('p', {}, n > 0
        ? `A pergunta e ${n === 1 ? 'a resposta dela' : `as ${n} respostas dela`} serão apagadas. Isso não pode ser desfeito.`
        : 'A pergunta será apagada. Isso não pode ser desfeito.')),
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Excluir pergunta',
        danger: true,
        onClick: async () => {
          const { data, error } = await sb.from('questions').delete().eq('id', numId(row.id)).select('id');
          if (error) throw error;
          if (!Array.isArray(data) || !data.length) {
            toast('Esta pergunta não pode ser excluída (pode ter sido ocultada pela moderação).', 'erro');
            return false;
          }
          toast('Pergunta excluída.', 'ok');
          setTimeout(onDeleted, 0); // depois que o modal fechar
          return true;
        },
      },
    ],
  });
}

function questionsSection(rows, { banned, title, reload, showEmpty = true }) {
  const head = h('div', { class: 'pf-pq-head' },
    h('h2', { class: 'pf-section-title', tabindex: '-1' }, title),
    banned ? null : h('a', { class: 'btn btn-primary btn-sm', href: '/professores/duvidas.html#perguntar' }, 'Fazer uma pergunta'));
  if (!rows.length) {
    if (!showEmpty) return null;
    return h('section', { class: 'pf-pq-sec' }, head,
      emptyState('Você ainda não fez perguntas. Pergunte sobre qualquer matéria: professores respondem de graça.',
        { label: 'Ir para o tira-dúvidas', href: '/professores/duvidas.html' }));
  }
  const answered = rows.filter((r) => (Number(r.answers_count) || 0) > 0).length;
  return h('section', { class: 'pf-pq-sec' }, head,
    h('p', { class: 'pf-muted pf-pq-summary' },
      `${rows.length === 1 ? '1 pergunta' : `${rows.length} perguntas`} · ${answered === 1 ? '1 respondida' : `${answered} respondidas`}`),
    h('ul', { class: 'pf-pq-list', 'aria-label': title }, rows.map((r) => questionItem(r, { banned, onDeleted: reload }))));
}

// ---------- Professor: minhas respostas ----------

function answerItem(row) {
  const q = one(row.questions);
  const hidden = row.status !== 'published';
  const qHidden = !q || q.status !== 'open';
  const edited = row.updated_at && row.created_at && (new Date(row.updated_at) - new Date(row.created_at)) > 60_000;
  const title = q && q.title
    ? h('a', { class: 'pf-pq-title', href: questionUrl(q.id || row.question_id, row.id) }, String(q.title))
    : h('span', { class: 'pf-pq-title pf-muted' }, 'Pergunta indisponível (removida ou ocultada pela moderação)');

  return h('li', { class: 'pf-pq-item' },
    h('div', { class: 'pf-pq-main' },
      title,
      row.body ? h('p', { class: 'pf-pq-excerpt' }, excerpt(row.body, 200)) : null,
      h('p', { class: 'pf-pq-meta' },
        timeEl(row.created_at, { prefix: 'Respondida ' }),
        edited ? h('span', { title: formatDate(row.updated_at, { dateStyle: 'long', timeStyle: 'short' }) }, 'editada') : null,
        hidden ? hiddenBadge() : null,
        !hidden && qHidden && q ? h('span', { class: 'pf-badge pf-badge--muted' }, 'Pergunta oculta') : null)),
    q && q.title && !hidden && !qHidden
      ? h('div', { class: 'pf-pq-actions' },
        h('a', { class: 'btn btn-ghost btn-sm', href: questionUrl(q.id || row.question_id, row.id), 'aria-label': `Ver ou editar a resposta: ${String(q.title)}` }, 'Ver / editar'))
      : null);
}

function answersSection(rows, { tutor }) {
  const unpublished = tutor && tutor.published === false;
  const head = h('div', { class: 'pf-pq-head' },
    h('h2', { class: 'pf-section-title', tabindex: '-1' }, 'Minhas respostas'),
    h('a', { class: 'btn btn-primary btn-sm', href: '/professores/duvidas.html' }, 'Responder dúvidas'));
  const tip = h('p', { class: 'pf-muted pf-pq-summary' }, unpublished
    ? 'Suas respostas aparecem no seu perfil público quando o anúncio estiver publicado.'
    : 'Suas últimas respostas aparecem no seu perfil público e ajudam alunos a conhecer seu jeito de explicar.');
  if (!rows.length) {
    return h('section', { class: 'pf-pq-sec' }, head, tip,
      emptyState('Você ainda não respondeu nenhuma pergunta. Responder é grátis e mostra seu trabalho para novos alunos.',
        { label: 'Ver perguntas', href: '/professores/duvidas.html' }));
  }
  return h('section', { class: 'pf-pq-sec' }, head,
    h('p', { class: 'pf-muted pf-pq-summary' }, rows.length === 1 ? '1 resposta' : `${rows.length} respostas`),
    tip,
    h('ul', { class: 'pf-pq-list', 'aria-label': 'Minhas respostas' }, rows.map(answerItem)));
}

// ---------- Montagem ----------

/**
 * Aluno: minhas perguntas. Professor: minhas respostas (+ perguntas, se houver).
 * Nunca rejeita: erros viram mensagem com "Tentar de novo".
 * @param {HTMLElement} container
 * @param {{ profile: object }} opts  profile = auth.getProfile()
 * @returns {Promise<void>}
 */
export async function mountQuestionsTab(container, { profile } = {}) {
  if (!container) return;
  if (!profile || !profile.id) {
    container.replaceChildren(emptyState('Entre na sua conta para ver suas perguntas e respostas.',
      { label: 'Ir para o tira-dúvidas', href: '/professores/duvidas.html' }));
    return;
  }
  const box = h('div', { class: 'pf-pq', 'aria-busy': 'true' },
    h('p', { class: 'pf-loading', role: 'status' }, 'Carregando…'));
  container.replaceChildren(box);

  const isTutor = profile.role === 'tutor';
  const banned = Boolean(profile.banned_at);
  const tutor = isTutor ? one(profile.tutor ?? profile.tutor_profiles) : null;
  // Recarrega a lista e devolve o foco ao título da seção (o item excluído saiu da página)
  const reload = () => mountQuestionsTab(container, { profile })
    .then(() => container.querySelector('.pf-pq-sec:last-child .pf-section-title')?.focus());

  try {
    const [questions, answers] = await Promise.all([
      fetchMyQuestions(profile.id),
      isTutor ? fetchMyAnswers(profile.id) : Promise.resolve([]),
    ]);
    const parts = [];
    if (banned) {
      parts.push(h('div', { class: 'pf-notice pf-notice--warn', role: 'status' },
        h('p', {}, 'Sua conta está suspensa: não é possível publicar, editar ou excluir perguntas e respostas.')));
    }
    if (isTutor) {
      parts.push(answersSection(answers, { tutor }));
      const qs = questionsSection(questions, { banned, title: 'Minhas perguntas', reload, showEmpty: false });
      if (qs) parts.push(qs);
    } else {
      parts.push(questionsSection(questions, { banned, title: 'Minhas perguntas', reload }));
    }
    box.replaceChildren(...parts);
  } catch (err) {
    box.replaceChildren(h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' },
      h('p', { class: 'pf-notice-title' }, 'Não foi possível carregar o tira-dúvidas.'),
      h('p', {}, errorMsg(err)),
      h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: reload }, 'Tentar de novo'))));
  } finally {
    box.setAttribute('aria-busy', 'false');
  }
}
