/* ============================================
   Componente: aba "Plano" do painel (dono: planos)
   STUB do scaffold — a implementação real substitui este arquivo.
   ============================================ */

import { emptyState } from '../ui.js';

/**
 * Plano atual (effective_plan), validade, histórico de pagamentos e link para /professores/planos.html.
 * @param {HTMLElement} container
 * @param {{ profile: object }} opts  profile = auth.getProfile() (profile.tutor tem plan/plan_expires_at)
 * @returns {void}
 */
export function mountPlanTab(container, { profile } = {}) {
  if (!container) return;
  container.replaceChildren(emptyState('Detalhes do plano em breve.',
    { label: 'Ver planos', href: '/professores/planos.html' }));
}
