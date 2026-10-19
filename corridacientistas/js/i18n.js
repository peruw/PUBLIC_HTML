// Idiomas do jogo: escolha, dicionários e formatação.
// Cada idioma é um módulo em js/lang/<id>.js, carregado só quando é usado.
// t('chave.sub', { n: 2 }) devolve o texto com {n} trocado; plural() e ord() seguem as regras do idioma.

export const LANGS = [
  { id: 'pt-BR', name: 'Português (Brasil)' },
  { id: 'pt-PT', name: 'Português (Portugal)' },
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' },
  { id: 'zh-CN', name: '中文' },
  { id: 'ja', name: '日本語' },
  { id: 'de', name: 'Deutsch' },
];
const IDS = LANGS.map((l) => l.id);
const STORE_KEY = 'corrida-lang';

// Fontes CJK do sistema (Windows, Mac, Linux/Android). As da página ficam no CSS (html:lang(...));
// estas são para o texto desenhado em canvas (placas 3D).
const CJK_SC = "'Noto Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', 'Source Han Sans SC', 'WenQuanYi Zen Hei'";
const CJK_JP = "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Noto Sans CJK JP', 'Yu Gothic', 'Meiryo', 'Source Han Sans JP'";
const CANVAS_FONTS = {
  'zh-CN': `"Trebuchet MS", "Segoe UI", ${CJK_SC}, ${CJK_JP}, "DejaVu Sans", Arial, sans-serif`,
  ja: `"Trebuchet MS", "Segoe UI", ${CJK_JP}, ${CJK_SC}, "DejaVu Sans", Arial, sans-serif`,
};
const CANVAS_FONT = '"Trebuchet MS", "Segoe UI", "DejaVu Sans", Arial, sans-serif';

// pt-PT → pt-PT; pt/pt-BR → pt-BR; zh* → zh-CN; demais pelo prefixo; senão inglês.
export function detectLang(list) {
  const langs = list || (typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []);
  for (const raw of langs) {
    const l = String(raw || '').toLowerCase();
    if (!l) continue;
    if (l === 'pt-pt' || l.startsWith('pt-pt-')) return 'pt-PT';
    if (l.startsWith('pt')) return 'pt-BR';
    if (l.startsWith('zh')) return 'zh-CN';
    for (const p of ['en', 'es', 'ja', 'de']) if (l === p || l.startsWith(p + '-')) return p;
  }
  return 'en';
}

function storedLang() {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return v && IDS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function saveLang(id) {
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* armazenamento indisponível */
  }
}

const cache = {};
async function loadDict(id) {
  if (!cache[id]) cache[id] = (await import(`./lang/${id}.js`)).default;
  return cache[id];
}

let lang = 'pt-BR';
let dict = {};
const listeners = new Set();
const warned = new Set();

export const getLang = () => lang;
export const getDict = () => dict;

// Escolhe o idioma: o salvo pelo jogador ou o do navegador.
export async function initI18n(forced) {
  const id = IDS.includes(forced) ? forced : storedLang() || detectLang();
  await setLang(id, { save: false });
  return lang;
}

export async function setLang(id, { save = true } = {}) {
  if (!IDS.includes(id)) id = 'en';
  dict = await loadDict(id);
  lang = id;
  if (save) saveLang(id);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.lang = id;
    root.classList.toggle('cjk', id === 'zh-CN' || id === 'ja');
  }
  for (const fn of listeners) fn(lang);
  return lang;
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function lookup(key) {
  let v = dict;
  for (const part of key.split('.')) {
    if (v == null) break;
    v = v[part];
  }
  if (v == null && !warned.has(lang + key)) {
    warned.add(lang + key);
    console.warn(`[i18n] falta "${key}" em ${lang}`);
  }
  return v;
}

const fill = (s, p) => (p ? String(s).replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? p[k] : m)) : String(s));

// Texto traduzido. Valores que são objetos de plural usam params.n.
export function t(key, params) {
  const v = lookup(key);
  if (v == null) return key;
  if (typeof v === 'function') return v(params || {});
  if (typeof v === 'object' && !Array.isArray(v) && params && typeof params.n === 'number') return plural(key, params.n, params);
  return fill(v, params);
}

// Valor bruto (listas, objetos de cientistas e itens).
export const tv = (key) => lookup(key);

// Plural: { one: '...', other: '...' } (categorias do Intl.PluralRules).
export function plural(key, n, params = {}) {
  const v = lookup(key);
  if (v == null) return key;
  const cat = new Intl.PluralRules(lang).select(n);
  return fill(v[cat] ?? v.other, { ...params, n: fmtNum(n) });
}

// Ordinal: 1º / 1st / 1.º / 1. / 第1名 / 1位 (chave "ord" do dicionário).
export function ord(n) {
  const v = dict.ord || { other: '{n}' };
  const cat = new Intl.PluralRules(lang, { type: 'ordinal' }).select(n);
  return fill(v[cat] ?? v.other, { n });
}

// Sufixo do número grande de posição no HUD (º, st/nd/rd/th, ., 名, 位).
export function ordSuffix(n) {
  const v = dict.ordSuffix || { other: '' };
  const cat = new Intl.PluralRules(lang, { type: 'ordinal' }).select(n);
  return v[cat] ?? v.other;
}

// Número no formato do idioma (separador decimal e de milhar).
export function fmtNum(n, opts) {
  try {
    return new Intl.NumberFormat(lang, opts).format(n);
  } catch {
    return String(n);
  }
}

export const canvasFont = () => CANVAS_FONTS[lang] || CANVAS_FONT;

// Textos de cientistas e itens no idioma atual.
export const charText = (id) => dict.chars?.[id] || {};
export const itemText = (id) => dict.items?.[id] || {};

// Preenche o HTML estático: data-i18n (texto), data-i18n-html, data-i18n-aria, data-i18n-title.
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', t(el.dataset.i18nTitle));
  if (root === document) {
    document.title = t('meta.title');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  }
}
