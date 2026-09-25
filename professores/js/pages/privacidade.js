/* ============================================
   Página: Política de privacidade (dono: contas)
   O texto é estático no HTML (funciona sem JS e é indexável); aqui só o chrome
   da página e o sumário recolhido em telas estreitas.
   ============================================ */

import '../../css/contas.css';
import { initChrome } from '../ui.js';

function main() {
  initChrome();
  const toc = document.querySelector('.pf-legal-toc details');
  if (toc && window.matchMedia('(max-width: 900px)').matches) toc.open = false;
}

main();
