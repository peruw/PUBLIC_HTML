/* ============================================
   Componente: aba "Tira-dúvidas" do painel (dono: dúvidas)
   STUB do scaffold — a implementação real substitui este arquivo.
   ============================================ */

import { emptyState } from '../ui.js';

/**
 * Aluno: minhas perguntas. Professor: minhas respostas.
 * @param {HTMLElement} container
 * @param {{ profile: object }} opts  profile = auth.getProfile()
 * @returns {void}
 */
export function mountQuestionsTab(container, { profile } = {}) {
  if (!container) return;
  container.replaceChildren(emptyState('Suas perguntas e respostas aparecerão aqui em breve.',
    { label: 'Ir para o tira-dúvidas', href: '/professores/duvidas.html' }));
}
