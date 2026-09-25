/* ============================================
   Portal de professores — helpers de interface
   Regra de ouro: conteúdo de usuário só entra no DOM como TEXTO
   (h() usa text nodes; nunca innerHTML).
   ============================================ */

import { avatarPublicUrl } from './supabase.js';
import { renderAuthSlot } from './auth.js';

// ---------- Anti-clickjacking ----------
// O .htaccess envia X-Frame-Options/CSP frame-ancestors; isto cobre servidores sem mod_headers
// (e o preview do Vite). Dentro de um iframe de OUTRO site a página fica oculta: nenhum botão
// (Quero dar aulas, Remover foto, Banir…) pode ser clicado por baixo de uma camada invisível.
function framedByOtherSite() {
  try {
    if (window.top === window.self) return false;
    return window.top.location.origin !== location.origin; // outro site: lança SecurityError
  } catch {
    return true;
  }
}
if (typeof window !== 'undefined' && framedByOtherSite()) {
  document.documentElement.style.setProperty('display', 'none', 'important');
  try {
    window.top.location.replace(location.href);
  } catch {
    /* iframe com sandbox: a página continua oculta */
  }
}

// ---------- h(): criação segura de elementos ----------

// Atributos que recebem URL: bloqueia javascript:, vbscript: e data: (exceto imagem em src)
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster']);

function safeUrl(name, value) {
  const v = String(value).replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
  if (v.startsWith('javascript:') || v.startsWith('vbscript:')) return null;
  if (v.startsWith('data:') && !(name === 'src' && v.startsWith('data:image/'))) return null;
  return String(value);
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

// Atributos enumerados: false precisa virar "false" (omitir não é o mesmo que false)
const ENUM_BOOL_ATTRS = new Set(['spellcheck', 'draggable', 'contenteditable']);

/**
 * Cria um elemento de forma segura.
 * attrs: class (string ou array), dataset {}, style (string ou objeto), on<Evento> (função),
 *        aria-* (booleano vira "true"/"false": { 'aria-selected': ativo }),
 *        booleanos (true = atributo vazio; false/null = omitido), value/checked/selected (propriedade).
 * children: string/número (vira texto), Node, arrays, null/false ignorados.
 * Nunca usa innerHTML: strings sempre viram text nodes.
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  const props = []; // value/checked/... aplicados depois dos filhos (ex.: <select> precisa das <option>)
  for (const [key, val] of Object.entries(attrs || {})) {
    if (typeof val === 'boolean' && (/^aria-/i.test(key) || ENUM_BOOL_ATTRS.has(key.toLowerCase()))) {
      el.setAttribute(key, String(val));
      continue;
    }
    if (val == null || val === false) continue;
    if (key === 'class' || key === 'className') {
      el.className = Array.isArray(val) ? val.filter(Boolean).join(' ') : String(val);
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(val)) if (dv != null) el.dataset[dk] = String(dv);
    } else if (key === 'style' && typeof val === 'object') {
      Object.assign(el.style, val);
    } else if (key.slice(0, 2).toLowerCase() === 'on') {
      // Só aceita função; string em on* seria handler inline (XSS) e é ignorada
      if (typeof val === 'function') el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === 'innerHTML' || key === 'outerHTML' || key === 'srcdoc') {
      throw new Error(`h(): atributo proibido "${key}"`);
    } else if (key === 'value' || key === 'checked' || key === 'selected' || key === 'indeterminate') {
      props.push([key, val]);
    } else if (val === true) {
      el.setAttribute(key, '');
    } else if (URL_ATTRS.has(key.toLowerCase())) {
      const safe = safeUrl(key.toLowerCase(), val);
      if (safe != null) el.setAttribute(key, safe);
    } else {
      el.setAttribute(key, String(val));
    }
  }
  appendChildren(el, children);
  for (const [key, val] of props) el[key] = val;
  return el;
}

// ---------- Formatação (pt-BR) ----------

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos -> "R$ 80,00" (espaço comum; use a classe .pf-price para não quebrar). null -> "—". */
export function brl(cents) {
  if (cents == null || cents === '' || Number.isNaN(Number(cents))) return '—';
  return BRL.format(Number(cents) / 100).replace(/ /g, ' ');
}

/** ISO -> "25 de set. de 2026" (ou opções Intl próprias). Data inválida -> "". */
export function formatDate(iso, opts = { dateStyle: 'medium' }) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', opts).format(d);
}

const RTF = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const TIME_UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** ISO -> "há 5 minutos", "ontem", "agora". */
export function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = (t - Date.now()) / 1000; // negativo = passado
  if (Math.abs(diff) < 45) return 'agora';
  for (const [unit, secs] of TIME_UNITS) {
    if (Math.abs(diff) >= secs) return RTF.format(Math.round(diff / secs), unit);
  }
  return RTF.format(Math.round(diff / 60), 'minute');
}

const DEC1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Estrelas de avaliação. starsEl(4.5, { count: 12 }) -> ★★★★★ 4,5 (12)
 * aria-label "Nota 4,5 de 5" (+ ", 12 avaliações"). count === 0 -> "Sem avaliações".
 * @returns {HTMLElement}
 */
export function starsEl(rating, { count } = {}) {
  if (count === 0) return h('span', { class: 'pf-rating pf-rating--none' }, 'Sem avaliações');
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  const nota = DEC1.format(r);
  let label = `Nota ${nota} de 5`;
  if (count != null) label += `, ${count} ${count === 1 ? 'avaliação' : 'avaliações'}`;
  return h('span', { class: 'pf-rating', role: 'img', 'aria-label': label },
    h('span', { class: 'pf-stars', 'aria-hidden': 'true' }, '★★★★★',
      h('span', { class: 'pf-stars-fill', style: { width: `${(r / 5) * 100}%` } }, '★★★★★')),
    h('span', { class: 'pf-rating-num', 'aria-hidden': 'true' }, nota),
    count != null ? h('span', { class: 'pf-rating-count', 'aria-hidden': 'true' }, `(${count})`) : null);
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/**
 * Avatar: foto pública do storage (path "<uid>/arquivo.webp") ou iniciais.
 * @returns {HTMLElement}
 */
export function avatarEl(path, name = '', size = 48) {
  const dim = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` };
  const fallback = () => h('span', { class: 'pf-avatar pf-avatar--initials', role: 'img', 'aria-label': name || 'Usuário', style: dim }, initials(name));
  const url = avatarPublicUrl(path);
  if (!url) return fallback();
  const img = h('img', {
    class: 'pf-avatar', src: url, alt: name ? `Foto de ${name}` : 'Foto', width: size, height: size,
    loading: 'lazy', decoding: 'async', style: dim,
  });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

/** Selo do plano: premium -> "Destaque", profissional -> "Profissional", básico -> null. */
export function planBadge(plan) {
  if (plan === 'premium') return h('span', { class: 'pf-badge pf-badge--premium', title: 'Professor em destaque' }, '★ Destaque');
  if (plan === 'profissional') return h('span', { class: 'pf-badge pf-badge--pro' }, 'Profissional');
  return null;
}

// ---------- Toast ----------

// Com um modal aberto, o resto da página fica inerte e abaixo do fundo escuro:
// a região de avisos vai para DENTRO do <dialog> mais recente (camada superior).
function toastRegion() {
  const host = [...document.querySelectorAll('dialog.pf-modal[open]')].pop() || document.body;
  let region = host.querySelector(':scope > .pf-toasts');
  if (!region) {
    region = h('div', { class: 'pf-toasts', 'aria-live': 'polite', 'aria-atomic': 'false' });
    if (host === document.body) region.id = 'pfToasts';
    host.appendChild(region);
  }
  return region;
}

/** Aviso flutuante. type: 'info' | 'ok' | 'erro'. @returns {HTMLElement} */
export function toast(msg, type = 'info') {
  const kind = ['info', 'ok', 'erro'].includes(type) ? type : 'info';
  const region = toastRegion();
  let timer;
  const close = () => {
    clearTimeout(timer);
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), 200);
  };
  const item = h('div', { class: ['pf-toast', `pf-toast--${kind}`], role: kind === 'erro' ? 'alert' : 'status' },
    h('span', { class: 'pf-toast-msg' }, String(msg ?? '')),
    h('button', { type: 'button', class: 'pf-toast-close', 'aria-label': 'Fechar aviso', onClick: close }, '×'));
  region.appendChild(item);
  timer = setTimeout(close, kind === 'erro' ? 7000 : 4500);
  return item;
}

// ---------- Query string ----------

/** Valor de um parâmetro da URL atual (ou null). */
export function qsGet(name) {
  return new URLSearchParams(location.search).get(name);
}

/** Todos os parâmetros da URL atual como objeto. */
export function qsAll() {
  return Object.fromEntries(new URLSearchParams(location.search));
}

/**
 * Mescla parâmetros na URL atual sem recarregar. null/undefined/'' remove o parâmetro.
 * replace=true usa replaceState; false usa pushState (cria entrada no histórico).
 * @returns {string} a nova query string ("?a=1" ou "")
 */
export function qsSet(obj, { replace = true } = {}) {
  const params = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(obj || {})) {
    if (v == null || v === '') params.delete(k);
    else params.set(k, String(v));
  }
  const qs = params.toString() ? `?${params}` : '';
  const url = location.pathname + qs + location.hash;
  if (replace) history.replaceState(history.state, '', url);
  else history.pushState(null, '', url);
  return qs;
}

// ---------- Modal ----------

let modalSeq = 0;

/**
 * Modal acessível (<dialog>). Esc, botão × e clique fora fecham.
 * size: 'lg' para um modal mais largo.
 * actions: [{ label, primary, danger, onClick }] — onClick({ close, button, event }).
 *   Sem onClick: fecha. Com onClick: fecha ao terminar, exceto se retornar false.
 *   Se lançar erro: mostra toast com errorMsg() e mantém aberto.
 * @returns {{ close: () => void, el: HTMLDialogElement }}
 */
export function modal({ title = '', content = null, actions = [], onClose, size } = {}) {
  const id = `pfModal${++modalSeq}`;
  const opener = document.activeElement;
  let closed = false;

  const dlg = h('dialog', { class: ['pf-modal', size === 'lg' ? 'pf-modal--lg' : null], 'aria-labelledby': `${id}-t` });
  const close = () => {
    if (closed) return;
    closed = true;
    if (dlg.open && typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
    // Avisos ainda visíveis (ex.: "Enviado!" logo antes de fechar) continuam na página
    const left = dlg.querySelector(':scope > .pf-toasts');
    if (left && left.children.length) toastRegion().append(...left.children);
    dlg.remove();
    if (opener && typeof opener.focus === 'function') opener.focus();
    if (onClose) onClose();
  };

  const buttons = actions.map((a) => {
    const btn = h('button', {
      type: 'button',
      class: ['btn', 'btn-sm', a.primary ? 'btn-primary' : 'btn-ghost', a.danger ? 'btn-danger' : null],
    }, a.label);
    btn.addEventListener('click', async (event) => {
      if (!a.onClick) return close();
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      try {
        const res = await a.onClick({ close, button: btn, event });
        if (res !== false) close();
      } catch (err) {
        toast(errorMsg(err), 'erro');
      } finally {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
    });
    return btn;
  });

  dlg.append(h('div', { class: 'pf-modal-inner' },
    h('div', { class: 'pf-modal-head' },
      h('h2', { class: 'pf-modal-title', id: `${id}-t` }, title),
      h('button', { type: 'button', class: 'pf-modal-close', 'aria-label': 'Fechar', onClick: close }, '×')),
    h('div', { class: 'pf-modal-body' }, content),
    buttons.length ? h('div', { class: 'pf-modal-actions' }, buttons) : null));

  // Esc (cancel) e clique no fundo
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  // Fecha só se o clique COMEÇOU e TERMINOU fora da caixa: arrastar a seleção de um
  // campo e soltar no fundo gera "click" no <dialog> e não pode descartar o texto digitado
  const outside = (e) => {
    const r = dlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg && outside(e); });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg && downOnBackdrop && outside(e)) close();
    downOnBackdrop = false;
  });

  document.body.appendChild(dlg);
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  toastRegion(); // região aria-live vazia já dentro do modal (avisos seguintes são anunciados)

  // Foco no primeiro campo do conteúdo, se houver
  const first = dlg.querySelector('.pf-modal-body input, .pf-modal-body select, .pf-modal-body textarea');
  if (first) first.focus();

  return { close, el: dlg };
}

// ---------- Estados de tela ----------

/**
 * Estado vazio. action opcional: { label, href } | { label, onClick } | Node.
 * @returns {HTMLElement}
 */
export function emptyState(text, action) {
  let act = null;
  if (action instanceof Node) act = action;
  else if (action && action.href) act = h('a', { class: 'btn btn-ghost btn-sm', href: action.href }, action.label);
  else if (action && action.onClick) act = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: action.onClick }, action.label);
  return h('div', { class: 'pf-empty' }, h('p', { class: 'pf-empty-text' }, text), act);
}

/** n cards "fantasma" enquanto carrega. @returns {HTMLElement} */
export function skeletonCards(n = 3) {
  const cards = Array.from({ length: n }, () =>
    h('div', { class: 'pf-skeleton-card' },
      h('span', { class: 'pf-skel pf-skel-avatar' }),
      h('div', { class: 'pf-skel-lines' },
        h('span', { class: 'pf-skel pf-skel-line', style: { width: '45%' } }),
        h('span', { class: 'pf-skel pf-skel-line', style: { width: '80%' } }),
        h('span', { class: 'pf-skel pf-skel-line', style: { width: '60%' } }))));
  return h('div', { class: 'pf-skeletons', 'aria-hidden': 'true' }, cards);
}

// Mensagens do Supabase Auth -> PT (por código ou trecho da mensagem)
const AUTH_CODES = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_not_confirmed: 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).',
  user_already_exists: 'Este e-mail já está cadastrado.',
  email_exists: 'Este e-mail já está cadastrado.',
  weak_password: 'Senha fraca. Use pelo menos 8 caracteres, com letras e números.',
  same_password: 'A nova senha deve ser diferente da atual.',
  email_address_invalid: 'E-mail inválido.',
  validation_failed: 'Dados inválidos. Confira os campos.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde um pouco e tente de novo.',
  over_email_send_rate_limit: 'Muitos e-mails enviados. Aguarde alguns minutos e tente de novo.',
  otp_expired: 'O link expirou. Peça um novo.',
  session_not_found: 'Sua sessão expirou. Entre novamente.',
  refresh_token_not_found: 'Sua sessão expirou. Entre novamente.',
  user_banned: 'Esta conta está suspensa.',
  signup_disabled: 'Cadastros estão temporariamente desativados.',
};
const AUTH_MESSAGES = [
  [/invalid login credentials/i, AUTH_CODES.invalid_credentials],
  [/email not confirmed/i, AUTH_CODES.email_not_confirmed],
  [/already (been )?registered/i, AUTH_CODES.user_already_exists],
  [/password should be at least/i, 'A senha é curta demais.'],
  [/should be different from the old/i, AUTH_CODES.same_password],
  [/unable to validate email|invalid format/i, AUTH_CODES.email_address_invalid],
  [/rate limit|too many requests/i, AUTH_CODES.over_request_rate_limit],
  [/jwt expired|invalid jwt/i, AUTH_CODES.session_not_found],
];
// Erros do Postgres/PostgREST -> PT
const PG_CODES = {
  '23505': 'Isso já foi registrado.',
  '23503': 'Referência inválida (o item pode ter sido removido).',
  '23514': 'Dados inválidos. Confira os campos.',
  '23502': 'Preencha todos os campos obrigatórios.',
  '22001': 'Texto longo demais.',
  '22P02': 'Valor inválido.',
  '42501': 'Você não tem permissão para esta ação.',
  PGRST116: 'Não encontrado.',
  PGRST301: 'Sua sessão expirou. Entre novamente.',
  PGRST303: 'Sua sessão expirou. Entre novamente.',
};

/** Traduz erros do Supabase/PostgREST/rede para uma mensagem em PT para o usuário. */
export function errorMsg(err) {
  if (!err) return 'Erro inesperado.';
  if (typeof err === 'string') return err;
  const code = err.code != null ? String(err.code) : '';
  const msg = String(err.message || err.error_description || err.msg || '');
  // Mensagem de negócio do banco (raise exception ... errcode P0001) já vem em PT
  if (code === 'P0001' && msg) return msg;
  if (AUTH_CODES[code]) return AUTH_CODES[code];
  if (PG_CODES[code]) return PG_CODES[code];
  for (const [re, pt] of AUTH_MESSAGES) if (re.test(msg)) return pt;
  if (/row-level security|permission denied/i.test(msg)) return PG_CODES['42501'];
  if (err.status === 429) return AUTH_CODES.over_request_rate_limit;
  if (err.name === 'AbortError') return 'A requisição foi cancelada.';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.';
  }
  return 'Algo deu errado. Tente novamente.';
}

/** Aviso "Portal em configuração" (quando config.js ainda tem placeholders). */
export function notConfiguredNotice(container) {
  // Se o container era o que tinha o <h1> da página, o aviso passa a ser o título principal
  const keepsH1 = [...document.querySelectorAll('h1')].some((el) => !container || !container.contains(el));
  const box = h('div', { class: 'pf-notice pf-notice--warn', role: 'status' },
    h(keepsH1 ? 'h2' : 'h1', { class: 'pf-notice-title' }, 'Portal em configuração'),
    h('p', {}, 'O portal de professores está sendo configurado. Volte em breve!'),
    h('a', { class: 'btn btn-ghost btn-sm', href: '/' }, 'Ir para o Quanta Aulas'));
  if (container) container.replaceChildren(box);
  return box;
}

/** Níveis de ensino (bate com o check de tutor_subjects.levels). */
export const SUBJECT_LEVELS = [
  { id: 'infantil', label: 'Educação infantil' },
  { id: 'fundamental', label: 'Ensino fundamental' },
  { id: 'medio', label: 'Ensino médio' },
  { id: 'vestibular', label: 'Pré-vestibular / ENEM' },
  { id: 'superior', label: 'Ensino superior' },
  { id: 'concursos', label: 'Concursos' },
  { id: 'adulto', label: 'Adultos/Livre' },
];

/** debounce simples (para busca enquanto digita). */
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Chrome da página (substitui /script.js) ----------

let revealObs = null;

/**
 * Observa elementos .reveal dentro de root (e o próprio root, se for .reveal).
 * Depois do initChrome() é automático para conteúdo inserido via JS.
 */
export function observeReveal(root = document) {
  const items = [...root.querySelectorAll('.reveal:not(.in)')];
  if (root instanceof Element && root.matches('.reveal:not(.in)')) items.push(root);
  if (!items.length) return;
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  if (!revealObs) {
    revealObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          revealObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.15 });
  }
  items.forEach((el) => revealObs.observe(el));
}

function normPath(p) {
  return p.replace(/\/index\.html$/, '/').replace(/\/+$/, '/') || '/';
}

let chromeReady = false;

/**
 * Inicializa menu mobile, sombra do nav, .reveal, link ativo e o slot de login.
 * Chamar uma vez no início de cada página (idempotente).
 */
export function initChrome() {
  if (chromeReady) return;
  chromeReady = true;

  // Menu mobile
  const toggle = document.getElementById('menuToggle');
  const panel = document.getElementById('mobileMenu');
  if (toggle && panel) {
    const setOpen = (open) => {
      panel.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    };
    toggle.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
    // Delegação: links inseridos depois (authSlotMobile) também fecham o painel
    panel.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  // Sombra do nav ao rolar
  const nav = document.querySelector('.nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  observeReveal();
  // .reveal começa invisível: conteúdo renderizado depois (cards, listas) também precisa ser observado
  if ('MutationObserver' in window) {
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) if (n.nodeType === 1) observeReveal(n);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // Link ativo (perfil em /professores/p/<slug> não marca nada)
  const here = normPath(location.pathname);
  document.querySelectorAll('.nav-links a.nav-link, #mobileMenu a').forEach((a) => {
    const url = new URL(a.getAttribute('href'), location.origin);
    if (url.origin === location.origin && normPath(url.pathname) === here) {
      a.classList.add('active');
      a.setAttribute('aria-current', 'page');
    }
  });

  toastRegion();

  Promise.resolve()
    .then(() => renderAuthSlot())
    .catch(() => { /* slot de login é opcional; página segue funcionando */ });
}
