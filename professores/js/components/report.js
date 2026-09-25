/* ============================================
   Componente: botão "Denunciar" (dono: moderação)
   STUB do scaffold — a implementação real substitui este arquivo.
   ============================================ */

import { h, toast } from '../ui.js';

/**
 * Botão que abre um modal de denúncia.
 * Contrato: exige login (sem sessão -> entrar.html?next=); modal com motivo
 * ('spam','ofensivo','falso','contato_externo','menor_de_idade','outro') + detalhes (≤1000);
 * insere em `reports` (target_type, target_id, reason, details);
 * erro 23505 (duplicado) -> "Você já denunciou".
 * @param {{ type: 'tutor'|'review'|'question'|'answer'|'message', id: string|number, label?: string }} opts
 * @returns {HTMLElement}
 */
export function reportButton({ type, id, label = 'Denunciar' } = {}) {
  return h('button', {
    type: 'button',
    class: 'pf-link-btn pf-report-btn',
    dataset: { reportType: type, reportId: id },
    onClick: () => toast('Denúncias estarão disponíveis em breve.'),
  }, label);
}
