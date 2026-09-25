/* ============================================
   Componente: aba "Avaliações" do painel (dono: avaliações)
   STUB do scaffold — a implementação real substitui este arquivo.
   ============================================ */

import { emptyState } from '../ui.js';

/**
 * Professor: avaliações recebidas. Aluno: avaliações feitas (editar/excluir).
 * @param {HTMLElement} container
 * @param {{ profile: object }} opts  profile = auth.getProfile()
 * @returns {void}
 */
export function mountReviewsTab(container, { profile } = {}) {
  if (!container) return;
  container.replaceChildren(emptyState('As avaliações estarão disponíveis em breve.'));
}
