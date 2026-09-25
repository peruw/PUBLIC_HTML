/* ============================================
   Componente: respostas do professor no tira-dúvidas (dono: dúvidas)
   Montado no perfil público (perfil.js). Também exporta helpers
   usados pelas páginas duvidas/duvida e pela aba do painel.
   ============================================ */

import '../../css/duvidas.css';
import { sb } from '../supabase.js';
import { h, timeAgo, formatDate, errorMsg } from '../ui.js';

// ---------- Helpers compartilhados do tira-dúvidas ----------

/** Limites (batem com os checks da migração 005). */
export const QA_LIMITS = {
  titleMin: 10,
  titleMax: 160,
  questionBodyMax: 5000,
  answerMin: 20,
  answerMax: 5000,
};

const ID_RE = /^[1-9]\d{0,17}$/;

/** id de pergunta/resposta válido (bigint positivo) ou null. */
export function qaId(v) {
  const s = String(v ?? '').trim();
  return ID_RE.test(s) ? s : null;
}

/** URL da página de uma dúvida (opcionalmente rolando até uma resposta). */
export function questionUrl(id, answerId) {
  const q = qaId(id);
  if (!q) return '/professores/duvidas.html';
  const a = qaId(answerId);
  return `/professores/duvida.html?q=${q}${a ? `#resposta-${a}` : ''}`;
}

/** Tamanho em caracteres como o Postgres conta (code points). */
export function charLen(s) {
  return [...String(s ?? '')].length;
}

/** Trecho de texto em uma linha (para listas e meta description). */
export function excerpt(text, max = 160) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  const chars = [...s];
  if (chars.length <= max) return s;
  return `${chars.slice(0, max - 1).join('').replace(/[\s.,;:!?-]+$/, '')}…`;
}

/** "1 resposta" / "3 respostas" / "Sem respostas". */
export function answersLabel(n) {
  const c = Number(n) || 0;
  if (c === 0) return 'Sem respostas';
  return c === 1 ? '1 resposta' : `${c} respostas`;
}

/** Elemento <time> com data relativa e data completa no title. */
export function timeEl(iso, { prefix = '' } = {}) {
  if (!iso) return null;
  return h('time', { datetime: String(iso), title: formatDate(iso, { dateStyle: 'long', timeStyle: 'short' }) },
    `${prefix}${timeAgo(iso)}`);
}

/**
 * Erros do tira-dúvidas em PT (limite diário, resposta duplicada, conta sem permissão).
 * kind: 'pergunta' | 'resposta'
 */
export function qaErrorMsg(err, kind = 'pergunta') {
  const code = err && err.code != null ? String(err.code) : '';
  const msg = String((err && err.message) || '');
  if (code === 'P0001' && /limite atingido/i.test(msg)) {
    return kind === 'resposta'
      ? 'Você atingiu o limite de 30 respostas por dia. Obrigado pela dedicação! Tente de novo amanhã.'
      : 'Você atingiu o limite de 5 perguntas por dia. Tente de novo amanhã.';
  }
  if (code === '23505' && kind === 'resposta') return 'Você já respondeu esta pergunta. Edite a sua resposta em vez de enviar outra.';
  if (code === '23514') {
    return kind === 'resposta'
      ? `A resposta precisa ter entre ${QA_LIMITS.answerMin} e ${QA_LIMITS.answerMax} caracteres.`
      : `Confira os campos: o título precisa ter entre ${QA_LIMITS.titleMin} e ${QA_LIMITS.titleMax} caracteres.`;
  }
  if (code === '23503') {
    return kind === 'resposta'
      ? 'Esta pergunta não está mais disponível.'
      : 'Matéria inválida. Escolha outra matéria.';
  }
  if (code === '42501' || /row-level security/i.test(msg)) {
    return kind === 'resposta'
      ? 'Não foi possível publicar: só professores com conta ativa podem responder perguntas abertas.'
      : 'Sua conta não pode publicar no momento.';
  }
  return errorMsg(err);
}

let fieldSeq = 0;

/**
 * Campo de texto com contador de caracteres e validação (título, corpo, resposta).
 * @returns {{ field: HTMLElement, input: HTMLInputElement|HTMLTextAreaElement,
 *   value: () => string, validate: () => boolean, setError: (msg: string) => void }}
 */
export function countedField({
  id = `qaField${++fieldSeq}`, label, multiline = false, min = 0, max, value = '',
  required = false, hint = '', placeholder = '', rows = 6, name,
}) {
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, countId, errId].filter(Boolean).join(' ');
  const attrs = {
    id, name: name || id, class: multiline ? 'pf-textarea' : 'pf-input', maxlength: max,
    placeholder: placeholder || null, required, 'aria-describedby': describedBy, value,
  };
  const input = multiline ? h('textarea', { ...attrs, rows }) : h('input', { ...attrs, type: 'text', autocomplete: 'off' });
  const counter = h('span', { class: 'pf-counter', id: countId });
  const err = h('p', { class: 'pf-error pf-qa-err', id: errId, role: 'alert' });
  const field = h('div', { class: 'pf-field' },
    h('label', { class: 'pf-label', for: id }, label, required ? h('span', { class: 'pf-req', 'aria-hidden': 'true' }, ' *') : null),
    input,
    h('div', { class: 'pf-qa-field-foot' },
      hint ? h('p', { class: 'pf-hint', id: hintId }, hint) : h('span'),
      counter),
    err);

  const trimmed = () => input.value.trim();
  const setError = (msg) => {
    err.textContent = msg || '';
    field.classList.toggle('is-invalid', Boolean(msg));
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  const update = () => {
    const n = charLen(trimmed());
    let txt = `${n}/${max}`;
    if (min && n < min) txt += ` · mínimo ${min}`;
    counter.textContent = txt;
    counter.classList.toggle('is-short', Boolean(min) && n > 0 && n < min);
    if (field.classList.contains('is-invalid') && (!min || n >= min) && n <= max) setError('');
  };
  input.addEventListener('input', update);
  update();

  const validate = () => {
    const n = charLen(trimmed());
    if (required && n === 0) setError('Preencha este campo.');
    else if (min && n < min) setError(`Escreva pelo menos ${min} caracteres (faltam ${min - n}).`);
    else if (max && n > max) setError(`Use no máximo ${max} caracteres.`);
    else {
      setError('');
      return true;
    }
    return false;
  };

  return { field, input, value: trimmed, validate, setError };
}

// ---------- Componente do perfil ----------

const SHOWN = 5;

function answerItem(row) {
  const q = row.questions;
  return h('li', { class: 'pf-ta-item' },
    h('a', { class: 'pf-ta-q', href: questionUrl(q.id, row.id) }, String(q.title || 'Pergunta')),
    row.body ? h('p', { class: 'pf-ta-excerpt' }, excerpt(row.body, 180)) : null,
    h('p', { class: 'pf-ta-meta' },
      q.subjects && q.subjects.name ? h('span', { class: 'pf-chip pf-chip-sm' }, String(q.subjects.name)) : null,
      timeEl(row.created_at, { prefix: 'Respondida ' })));
}

/**
 * Últimas respostas publicadas pelo professor, com link para cada dúvida
 * (/professores/duvida.html?q=<question_id>#resposta-<id>).
 * Nunca rejeita: erros viram mensagem com "Tentar de novo".
 * @param {HTMLElement} container
 * @param {{ tutorId: string }} opts
 * @returns {Promise<void>}
 */
export async function mountTutorAnswers(container, { tutorId } = {}) {
  if (!container) return;
  const box = h('div', { class: 'pf-ta', 'aria-busy': 'true' },
    h('p', { class: 'pf-loading', role: 'status' }, 'Carregando respostas…'));
  container.replaceChildren(box);
  if (!tutorId) {
    box.replaceChildren(h('p', { class: 'pf-muted' }, 'Nenhuma resposta no tira-dúvidas ainda.'));
    box.setAttribute('aria-busy', 'false');
    return;
  }

  try {
    // !inner: resposta a pergunta oculta (embed null pelo RLS) não entra na lista
    const { data, error } = await sb.from('answers')
      .select('id,body,created_at,question_id,questions!inner(id,title,status,subjects(name))')
      .eq('tutor_id', tutorId)
      .eq('status', 'published')
      .eq('questions.status', 'open')
      .order('created_at', { ascending: false })
      .limit(SHOWN);
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []).filter((r) => r && r.questions && qaId(r.questions.id));
    if (!rows.length) {
      box.replaceChildren(
        h('p', { class: 'pf-muted' }, 'Este professor ainda não respondeu perguntas no tira-dúvidas.'),
        h('a', { class: 'pf-ta-more', href: '/professores/duvidas.html' }, 'Conhecer o tira-dúvidas'));
      return;
    }
    box.replaceChildren(
      h('ul', { class: 'pf-ta-list', 'aria-label': 'Últimas respostas' }, rows.map(answerItem)),
      h('a', { class: 'pf-ta-more', href: '/professores/duvidas.html' }, 'Ver mais dúvidas no tira-dúvidas'));
  } catch (err) {
    box.replaceChildren(h('div', { class: 'pf-qa-inline-error', role: 'alert' },
      h('p', {}, `Não foi possível carregar as respostas. ${errorMsg(err)}`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => mountTutorAnswers(container, { tutorId }) }, 'Tentar de novo')));
  } finally {
    box.setAttribute('aria-busy', 'false');
  }
}
