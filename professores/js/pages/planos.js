/* ============================================
   Página: Planos para professores (dono: planos)
   STUB do scaffold — a implementação real substitui este arquivo.
   ============================================ */

import { initChrome, emptyState, notConfiguredNotice } from '../ui.js';
import { isConfigured } from '../config.js';

function main() {
  initChrome();
  const body = document.getElementById('pageBody');
  if (!body) return;
  if (!isConfigured) {
    notConfiguredNotice(body);
    return;
  }
  body.replaceChildren(emptyState('Esta página está em construção.', { label: 'Buscar professores', href: '/professores/' }));
}

main();
