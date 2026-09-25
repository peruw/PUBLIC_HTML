/* ============================================
   Componente: avaliações no perfil do professor (dono: avaliações)
   STUB do scaffold — a implementação real substitui este arquivo.
   ============================================ */

import { h, starsEl } from '../ui.js';

/**
 * Seção de avaliações do perfil.
 * Contrato: resumo (média/contagem); lista paginada de
 * reviews?tutor_id=eq.&status=eq.published&select=id,rating,comment,created_at,reviewer_name,student_id
 * &order=created_at.desc; formulário se sb.rpc('can_review', { p_tutor }) = true (edita a própria se existir);
 * botão denunciar (reportButton) em cada avaliação. Comentários só via textContent.
 * @param {HTMLElement} container
 * @param {{ tutorId: string, ratingAvg?: number, ratingCount?: number }} opts
 * @returns {void}
 */
export function mountReviews(container, { tutorId, ratingAvg = 0, ratingCount = 0 } = {}) {
  if (!container) return;
  container.replaceChildren(
    h('div', { class: 'pf-stack', dataset: { tutorId } },
      h('h2', { class: 'pf-section-title' }, 'Avaliações'),
      starsEl(ratingAvg, { count: ratingCount }),
      h('p', { class: 'pf-muted' }, 'As avaliações detalhadas estarão disponíveis em breve.')));
}
