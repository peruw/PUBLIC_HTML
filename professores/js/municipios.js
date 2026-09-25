/* ============================================
   Portal de professores — estados e municípios (IBGE)
   Dados estáticos em /professores/data/municipios/<UF>.json
   (gerados por scripts/build-municipios.mjs)
   ============================================ */

import { h } from './ui.js';

/** As 27 UFs, em ordem alfabética do nome. */
export const UFS = [
  { sigla: 'AC', nome: 'Acre' },
  { sigla: 'AL', nome: 'Alagoas' },
  { sigla: 'AP', nome: 'Amapá' },
  { sigla: 'AM', nome: 'Amazonas' },
  { sigla: 'BA', nome: 'Bahia' },
  { sigla: 'CE', nome: 'Ceará' },
  { sigla: 'DF', nome: 'Distrito Federal' },
  { sigla: 'ES', nome: 'Espírito Santo' },
  { sigla: 'GO', nome: 'Goiás' },
  { sigla: 'MA', nome: 'Maranhão' },
  { sigla: 'MT', nome: 'Mato Grosso' },
  { sigla: 'MS', nome: 'Mato Grosso do Sul' },
  { sigla: 'MG', nome: 'Minas Gerais' },
  { sigla: 'PA', nome: 'Pará' },
  { sigla: 'PB', nome: 'Paraíba' },
  { sigla: 'PR', nome: 'Paraná' },
  { sigla: 'PE', nome: 'Pernambuco' },
  { sigla: 'PI', nome: 'Piauí' },
  { sigla: 'RJ', nome: 'Rio de Janeiro' },
  { sigla: 'RN', nome: 'Rio Grande do Norte' },
  { sigla: 'RS', nome: 'Rio Grande do Sul' },
  { sigla: 'RO', nome: 'Rondônia' },
  { sigla: 'RR', nome: 'Roraima' },
  { sigla: 'SC', nome: 'Santa Catarina' },
  { sigla: 'SP', nome: 'São Paulo' },
  { sigla: 'SE', nome: 'Sergipe' },
  { sigla: 'TO', nome: 'Tocantins' },
];

const UF_SET = new Set(UFS.map((u) => u.sigla));
const cache = new Map(); // UF -> Promise<[{id, nome}]>

/** true se `uf` é uma sigla válida (ex.: 'SC'). */
export function isUf(uf) {
  return UF_SET.has(String(uf || '').toUpperCase());
}

/**
 * Municípios de uma UF: [{ id: 4209102, nome: 'Joinville' }, ...] ordenados por nome.
 * Cache em memória; UF inválida -> [].
 */
export function loadCities(uf) {
  const sigla = String(uf || '').toUpperCase();
  if (!UF_SET.has(sigla)) return Promise.resolve([]);
  if (!cache.has(sigla)) {
    const p = fetch(`/professores/data/municipios/${sigla}.json`)
      .then((res) => {
        if (!res.ok) throw new Error('Não foi possível carregar as cidades.');
        return res.json();
      })
      .catch((err) => {
        cache.delete(sigla); // permite tentar de novo
        throw err;
      });
    cache.set(sigla, p);
  }
  return cache.get(sigla);
}

/** Nome do município pelo código IBGE (procura na UF informada). */
export async function cityName(uf, cityId) {
  const list = await loadCities(uf);
  const id = Number(cityId);
  return list.find((c) => c.id === id)?.nome ?? null;
}

let pickerSeq = 0;

/**
 * Seletor de UF + cidade.
 * opts: { uf, cityId, onChange({ uf, cityId, cityName }), names: { uf, city } (atributos name,
 *         padrão 'uf'/'cidade'), required, anyLabel: true (opções "Todos os estados"/"Todas as cidades") }
 * O elemento retornado tem:
 *   el.getValue() -> { uf, cityId, cityName }
 *   el.setValue({ uf, cityId }) -> Promise
 *   el.ready -> Promise resolvida quando as cidades iniciais carregaram
 * @returns {HTMLElement}
 */
export function cityPicker({ uf = '', cityId = null, onChange, names = {}, required = false, anyLabel = true } = {}) {
  const id = `pfCity${++pickerSeq}`;
  const ufPlaceholder = anyLabel ? 'Todos os estados' : 'Selecione o estado';
  const cityPlaceholder = anyLabel ? 'Todas as cidades' : 'Selecione a cidade';

  const ufSel = h('select', { id: `${id}-uf`, name: names.uf ?? 'uf', class: 'pf-select', required },
    h('option', { value: '' }, ufPlaceholder),
    UFS.map((u) => h('option', { value: u.sigla }, `${u.nome} (${u.sigla})`)));

  const citySel = h('select', { id: `${id}-city`, name: names.city ?? 'cidade', class: 'pf-select', required, disabled: true },
    h('option', { value: '' }, cityPlaceholder));

  const status = h('span', { class: 'pf-help', role: 'status', 'aria-live': 'polite' });

  const el = h('div', { class: 'pf-city-picker' },
    h('div', { class: 'pf-field' }, h('label', { class: 'pf-label', for: ufSel.id }, 'Estado'), ufSel),
    h('div', { class: 'pf-field' }, h('label', { class: 'pf-label', for: citySel.id }, 'Cidade'), citySel, status));

  const value = () => {
    const opt = citySel.selectedOptions[0];
    return {
      uf: ufSel.value || null,
      cityId: citySel.value ? Number(citySel.value) : null,
      cityName: citySel.value && opt ? opt.textContent : null,
    };
  };
  const emit = () => { if (onChange) onChange(value()); };

  let loadSeq = 0;
  async function fillCities(sigla, selectedId) {
    const seq = ++loadSeq;
    citySel.replaceChildren(h('option', { value: '' }, cityPlaceholder));
    citySel.disabled = true;
    status.textContent = '';
    if (!sigla) return;
    status.textContent = 'Carregando cidades…';
    try {
      const list = await loadCities(sigla);
      if (seq !== loadSeq) return; // UF mudou no meio do caminho
      citySel.append(...list.map((c) => h('option', { value: c.id }, c.nome)));
      citySel.disabled = false;
      if (selectedId != null) citySel.value = String(selectedId);
      status.textContent = '';
    } catch (err) {
      if (seq === loadSeq) status.textContent = err.message || 'Não foi possível carregar as cidades.';
    }
  }

  ufSel.addEventListener('change', async () => {
    await fillCities(ufSel.value, null);
    emit();
  });
  citySel.addEventListener('change', emit);

  el.getValue = value;
  el.setValue = async ({ uf: newUf = '', cityId: newCity = null } = {}) => {
    ufSel.value = isUf(newUf) ? String(newUf).toUpperCase() : '';
    await fillCities(ufSel.value, newCity);
  };
  el.ready = el.setValue({ uf, cityId });
  return el;
}
