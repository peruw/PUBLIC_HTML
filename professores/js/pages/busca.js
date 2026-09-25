/* ============================================
   Página: busca de professores — /professores/ (dono: busca-perfil)
   STUB do scaffold — a implementação real substitui este arquivo.
   ============================================ */

import { initChrome, emptyState, notConfiguredNotice, qsGet } from '../ui.js';
import { isConfigured } from '../config.js';
import { cityPicker } from '../municipios.js';

function main() {
  initChrome();

  // Preenche o formulário com a URL (?q=&modo=&uf=&cidade=...)
  const form = document.getElementById('buscaForm');
  if (form) {
    for (const name of ['q', 'modo', 'ordem', 'preco_min', 'preco_max']) {
      const v = qsGet(name);
      const field = document.querySelector(`[name="${name}"]`);
      if (v != null && field) field.value = v;
    }
  }

  const local = document.getElementById('fLocal');
  if (local) {
    local.replaceChildren(cityPicker({ uf: qsGet('uf') || '', cityId: qsGet('cidade') }));
  }

  const results = document.getElementById('resultados');
  if (!results) return;
  if (!isConfigured) {
    notConfiguredNotice(results);
    return;
  }
  results.replaceChildren(emptyState('A busca de professores estará disponível em breve.'));
}

main();
