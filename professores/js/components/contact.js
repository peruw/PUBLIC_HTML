/* ============================================
   Componente: botão "Enviar mensagem" no perfil (dono: mensagens)
   STUB do scaffold — a implementação real substitui este arquivo.
   ============================================ */

import { h } from '../ui.js';

/**
 * Monta o botão de contato com o professor.
 * Contrato: sem login -> entrar.html?next=<perfil>; se o usuário é o próprio professor não mostra;
 * modal com textarea (+ select opcional de matéria) ->
 * sb.rpc('start_conversation', { p_tutor, p_body, p_subject }) ->
 * location.href = '/professores/mensagens.html?c=' + id.
 * @param {HTMLElement} container
 * @param {{ tutorId: string, tutorName: string, subjects?: Array<{id:number,name:string}> }} opts
 * @returns {void}
 */
export function mountContactButton(container, { tutorId, tutorName, subjects = [] } = {}) {
  if (!container) return;
  container.replaceChildren(
    h('button', { type: 'button', class: 'btn btn-primary', disabled: true, dataset: { tutorId } },
      'Enviar mensagem (em breve)'));
}
