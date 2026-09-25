/* ============================================
   Componente: aba "Conta" do painel (dono: moderação)
   STUB do scaffold — a implementação real substitui este arquivo.
   ============================================ */

import { emptyState } from '../ui.js';

/**
 * Alterar senha (sb.auth.updateUser), exportar dados (rpc export_my_data -> download JSON),
 * excluir conta (digitar EXCLUIR -> POST fnUrl('delete-account') com Authorization Bearer).
 * @param {HTMLElement} container
 * @param {{ profile: object }} opts  profile = auth.getProfile()
 * @returns {void}
 */
export function mountAccountTab(container, { profile } = {}) {
  if (!container) return;
  container.replaceChildren(emptyState('Configurações da conta em breve.'));
}
