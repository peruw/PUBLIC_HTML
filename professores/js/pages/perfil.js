/* ============================================
   Página: perfil
   // STUB do scaffold — implementação real: agente "busca-perfil".
   ============================================ */

import { initChrome, notConfiguredNotice, emptyState } from '../ui.js';
import { isConfigured } from '../config.js';

function main() {
  initChrome();
  const body = document.getElementById('pageBody');
  if (!isConfigured) {
    notConfiguredNotice(body);
    return;
  }
  body.replaceChildren(emptyState('Página em construção.', { label: 'Buscar professores', href: '/professores/' }));
}

main();
