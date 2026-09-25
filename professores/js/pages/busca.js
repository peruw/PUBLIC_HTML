/* ============================================
   Página: busca (professores/index.html)
   // STUB do scaffold — implementação real: agente "busca-perfil".
   ============================================ */

import { initChrome, notConfiguredNotice, emptyState, qsGet } from '../ui.js';
import { isConfigured } from '../config.js';
import { cityPicker } from '../municipios.js';

function main() {
  initChrome();
  const local = document.getElementById('fLocal');
  if (local) local.replaceChildren(cityPicker({ uf: qsGet('uf') || '', cityId: qsGet('cidade') }));

  const results = document.getElementById('resultados');
  if (!isConfigured) {
    notConfiguredNotice(results);
    return;
  }
  results.replaceChildren(emptyState('Busca em construção.'));
}

main();
