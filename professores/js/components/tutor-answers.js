/* ============================================
   Componente: respostas do professor no tira-dúvidas (dono: dúvidas)
   STUB do scaffold — a implementação real substitui este arquivo.
   ============================================ */

import { h } from '../ui.js';

/**
 * Últimas respostas publicadas pelo professor, com link para cada dúvida
 * (/professores/duvida.html?id=<question_id>).
 * @param {HTMLElement} container
 * @param {{ tutorId: string }} opts
 * @returns {void}
 */
export function mountTutorAnswers(container, { tutorId } = {}) {
  if (!container) return;
  container.replaceChildren(
    h('div', { class: 'pf-tutor-answers', dataset: { tutorId } },
      h('p', { class: 'pf-muted' }, 'Respostas no tira-dúvidas em breve.')));
}
