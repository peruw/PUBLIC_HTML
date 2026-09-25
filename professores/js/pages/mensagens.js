/* ============================================
   Página: Mensagens (dono: mensagens)
   Lista de conversas (rpc list_conversations) + conversa aberta (?c=<id>).
   Tempo real: postgres_changes em messages (filtro da conversa); se o canal não
   ficar SUBSCRIBED em 5 s (ou cair), busca novas mensagens a cada 10 s.
   Conteúdo de usuário só entra como texto (h()).
   ============================================ */

import '../../css/mensagens.css';
import { sb } from '../supabase.js';
import { isConfigured } from '../config.js';
import { requireAuth, refreshUnread } from '../auth.js';
import { h, initChrome, avatarEl, toast, errorMsg, emptyState, notConfiguredNotice, qsGet, qsSet } from '../ui.js';
import { reportButton } from '../components/report.js';

const PAGE_SIZE = 50;
const NEWER_LIMIT = 200;
const MAX_LEN = 4000;
const SUB_TIMEOUT_MS = 5_000;
const POLL_MS = 10_000;
const LIST_REFRESH_MS = 60_000;
const MSG_COLS = 'id,conversation_id,sender_id,body,created_at';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MOBILE_MQ = '(max-width: 760px)';

// ---------- Estado ----------
const S = {
  profile: null,
  uid: null,
  convs: [], // linhas de list_conversations
  listState: 'loading', // loading | ok | error
  listError: null,
  cur: null, // conversa aberta (ver openConversation)
  pushedNav: 0, // entradas de histórico criadas por esta página (voltar no celular)
  listTimer: null,
};

const el = {}; // referências fixas do layout
let pendingSeq = 0;
let channelSeq = 0; // tópico único por abertura: channel() reaproveitaria um canal ainda saindo

// ---------- Datas ----------
const fmtTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtFull = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
const fmtDayYear = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtDay = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtWeekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
const fmtShort = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

function toDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function daysAgo(d) {
  return Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
}
function dayKey(iso) {
  const d = toDate(iso);
  return d ? String(startOfDay(d)) : '';
}
function dayLabel(iso) {
  const d = toDate(iso);
  if (!d) return '';
  const n = daysAgo(d);
  if (n === 0) return 'Hoje';
  if (n === 1) return 'Ontem';
  const s = d.getFullYear() === new Date().getFullYear() ? fmtDay.format(d) : fmtDayYear.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function listTime(iso) {
  const d = toDate(iso);
  if (!d) return '';
  const n = daysAgo(d);
  if (n <= 0) return fmtTime.format(d);
  if (n === 1) return 'Ontem';
  if (n < 7) return fmtWeekday.format(d).replace('.', '');
  return fmtShort.format(d);
}
function timeEl(iso, text, cls) {
  const d = toDate(iso);
  return h('time', { class: cls, datetime: d ? d.toISOString() : null, title: d ? fmtFull.format(d) : null }, text);
}

// ---------- Utilidades ----------
function isMobile() {
  return typeof matchMedia === 'function' && matchMedia(MOBILE_MQ).matches;
}
function coarsePointer() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}
function otherName(row) {
  return String(row?.other_name || '').trim() || 'Usuário';
}
function otherIsTutor(row) {
  return row?.i_am === 'student';
}
function profileHref(row) {
  if (!otherIsTutor(row)) return null;
  const slug = typeof row.other_slug === 'string' ? row.other_slug : '';
  return SLUG_RE.test(slug) ? `/professores/p/${slug}` : null;
}
function convHref(id) {
  return `/professores/mensagens.html?c=${encodeURIComponent(id)}`;
}
function normMsg(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = Number(raw.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    conversation_id: String(raw.conversation_id ?? ''),
    sender_id: String(raw.sender_id ?? ''),
    body: String(raw.body ?? ''),
    created_at: raw.created_at || new Date().toISOString(),
  };
}
function announce(text) {
  if (!el.live) return;
  el.live.textContent = '';
  // novo nó de texto = novo anúncio (mesmo texto repetido também é lido)
  setTimeout(() => { el.live.textContent = text; }, 30);
}
function icon(d, cls = 'pf-msg-ico') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
  return svg;
}
const ICON_SHIELD = 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3zM12 8v4M12 16h.01';
const ICON_BACK = 'M15 18l-6-6 6-6';
const ICON_SEND = 'M4 12l16-8-6 16-2.5-6.5L4 12z';
const ICON_DOWN = 'M6 9l6 6 6-6';

// ---------- Dados ----------
async function fetchList() {
  const { data, error } = await sb.rpc('list_conversations');
  if (error) throw error;
  return (Array.isArray(data) ? data : []).filter((r) => r && UUID_RE.test(String(r.id)));
}
function msgQuery(convId) {
  return sb.from('messages').select(MSG_COLS).eq('conversation_id', convId);
}
async function fetchLatest(convId) {
  const { data, error } = await msgQuery(convId).order('id', { ascending: false }).limit(PAGE_SIZE);
  if (error) throw error;
  return (data || []).map(normMsg).filter(Boolean).reverse();
}
async function fetchOlder(convId, beforeId) {
  const { data, error } = await msgQuery(convId).lt('id', beforeId).order('id', { ascending: false }).limit(PAGE_SIZE);
  if (error) throw error;
  return (data || []).map(normMsg).filter(Boolean).reverse();
}
async function fetchNewer(convId, afterId) {
  const { data, error } = await msgQuery(convId).gt('id', afterId).order('id', { ascending: true }).limit(NEWER_LIMIT);
  if (error) throw error;
  return (data || []).map(normMsg).filter(Boolean);
}

// ---------- Layout ----------
function buildLayout(body) {
  el.safety = h('div', { class: 'pf-notice pf-msg-safety', role: 'note', 'aria-label': 'Aviso de segurança' },
    icon(ICON_SHIELD, 'pf-msg-safety-ico'),
    h('p', {},
      h('strong', {}, 'Para sua segurança: '),
      'nunca pague fora do combinado nem adiante valores para quem você ainda não conhece, e não compartilhe dados sensíveis ',
      '(senhas, códigos de verificação, dados de cartão ou documentos) pelas mensagens. Viu algo suspeito? Use “Denunciar”.'));

  el.listCount = h('span', { class: 'pf-count', hidden: true, 'aria-hidden': 'true' }, '0');
  el.list = h('ul', { class: 'pf-conv-list', id: 'convList', 'aria-labelledby': 'convListTitle' });
  el.listStatus = h('div', { class: 'pf-conv-status', 'aria-live': 'polite' });
  el.pane = h('nav', { class: 'pf-conv-pane', 'aria-labelledby': 'convListTitle' },
    h('div', { class: 'pf-conv-pane-head' },
      h('h2', { class: 'pf-conv-pane-title', id: 'convListTitle' }, 'Conversas'),
      el.listCount),
    el.listStatus,
    el.list);

  el.thread = h('section', { class: 'pf-thread', 'aria-label': 'Conversa' });
  el.chat = h('div', { class: 'pf-chat', id: 'chat' }, el.pane, el.thread);
  el.live = h('div', { class: 'pf-sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });

  body.replaceChildren(el.safety, el.chat, el.live);

  // Lista: abre a conversa sem recarregar (Ctrl/⌘/botão do meio continuam abrindo em nova aba)
  el.list.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-conv]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    selectConversation(a.dataset.conv, { focus: true });
  });
}

// ---------- Lista de conversas ----------
function renderList() {
  const focusedId = document.activeElement?.closest?.('#convList a[data-conv]')?.dataset.conv || null;
  const unreadTotal = S.convs.filter((r) => r.unread).length;
  el.listCount.textContent = String(unreadTotal);
  el.listCount.hidden = unreadTotal === 0;
  el.list.setAttribute('aria-busy', String(S.listState === 'loading'));

  if (S.listState === 'loading' && !S.convs.length) {
    el.listStatus.replaceChildren(h('span', { class: 'pf-sr-only' }, 'Carregando conversas…'));
    el.list.replaceChildren(...Array.from({ length: 4 }, () => h('li', { class: 'pf-conv-skel', 'aria-hidden': 'true' },
      h('span', { class: 'pf-skel pf-skel-avatar' }),
      h('span', { class: 'pf-skel-lines' },
        h('span', { class: 'pf-skel pf-skel-line', style: { width: '55%' } }),
        h('span', { class: 'pf-skel pf-skel-line', style: { width: '85%' } })))));
    return;
  }
  if (S.listState === 'error' && !S.convs.length) {
    el.listStatus.replaceChildren(h('div', { class: 'pf-conv-error', role: 'alert' },
      h('p', {}, 'Não foi possível carregar suas conversas.'),
      h('p', { class: 'pf-muted' }, errorMsg(S.listError)),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => loadList({ initial: true }) }, 'Tentar de novo')));
    el.list.replaceChildren();
    return;
  }
  if (!S.convs.length) {
    const tutor = S.profile?.role === 'tutor';
    el.listStatus.replaceChildren(emptyState(
      tutor
        ? 'Você ainda não tem conversas. Quando um aluno enviar uma mensagem, ela aparece aqui.'
        : 'Você ainda não tem conversas. Encontre um professor e clique em “Enviar mensagem”.',
      tutor ? { label: 'Completar meu perfil', href: '/professores/painel.html' } : { label: 'Buscar professores', href: '/professores/' }));
    el.list.replaceChildren();
    return;
  }

  el.listStatus.replaceChildren();
  el.list.replaceChildren(...S.convs.map(convItem));
  if (focusedId) el.list.querySelector(`a[data-conv="${CSS.escape(focusedId)}"]`)?.focus();
}

function convItem(row) {
  const active = S.cur?.id === row.id;
  const name = otherName(row);
  const preview = String(row.last_body || '').replace(/\s+/g, ' ').trim();
  return h('li', {},
    h('a', {
      href: convHref(row.id),
      class: ['pf-conv-item', active && 'is-active', row.unread && 'is-unread'],
      'aria-current': active ? 'true' : null,
      dataset: { conv: row.id },
    },
      avatarEl(row.other_avatar, name, 44),
      h('span', { class: 'pf-conv-text' },
        h('span', { class: 'pf-conv-name' }, name),
        h('span', { class: 'pf-conv-role' }, otherIsTutor(row) ? 'Professor' : 'Aluno'),
        h('span', { class: 'pf-conv-last' }, preview || 'Sem mensagens')),
      h('span', { class: 'pf-conv-side' },
        timeEl(row.last_message_at, listTime(row.last_message_at), 'pf-conv-time'),
        row.unread ? h('span', { class: 'pf-conv-dot' }, h('span', { class: 'pf-sr-only' }, 'Não lida')) : null)));
}

async function loadList({ initial = false } = {}) {
  if (initial) {
    S.listState = 'loading';
    renderList();
  }
  try {
    const rows = await fetchList();
    S.convs = rows;
    S.listState = 'ok';
    S.listError = null;
  } catch (err) {
    S.listError = err;
    // atualização em segundo plano com falha: mantém a lista que já está na tela
    if (!initial && S.convs.length) return false;
    S.listState = 'error';
  }
  // Mantém a conversa aberta em dia com a lista
  const cur = S.cur;
  if (cur) {
    const row = S.convs.find((r) => r.id === cur.id);
    if (row) {
      cur.row = row;
      const lastLocal = cur.msgs.length ? cur.msgs[cur.msgs.length - 1].created_at : null;
      if (cur.loaded && row.last_message_at && (!lastLocal || new Date(row.last_message_at) > new Date(lastLocal))) catchUp(cur);
      if (row.unread && cur.loaded && document.visibilityState === 'visible') scheduleMarkRead(cur, 0);
    }
  }
  renderList();
  return S.listState === 'ok';
}

function touchListRow(convId, msg, { read = false, unread = false } = {}) {
  const i = S.convs.findIndex((r) => r.id === convId);
  if (i < 0) return;
  const row = S.convs[i];
  if (msg) {
    row.last_body = msg.body.slice(0, 120);
    if (!row.last_message_at || new Date(msg.created_at) >= new Date(row.last_message_at)) row.last_message_at = msg.created_at;
  }
  if (read) row.unread = false;
  else if (unread) row.unread = true;
  S.convs.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
  renderList();
}

// ---------- Conversa ----------
function newConvState(id, row) {
  return {
    id,
    row,
    msgs: [], // ordenadas por id
    byId: new Map(),
    els: new Map(), // id -> elemento da mensagem
    pending: [], // envios otimistas { key, body, el, id, created_at }
    hasMore: false,
    loaded: false,
    loadingOlder: false,
    closed: false,
    channel: null,
    rtStatus: 'idle',
    subTimer: null,
    pollTimer: null,
    catching: false,
    catchAgain: false,
    markTimer: null,
    unseen: false,
    ui: {},
  };
}

function cleanupConversation(cur) {
  if (!cur || cur.closed) return;
  cur.closed = true;
  clearTimeout(cur.subTimer);
  clearTimeout(cur.markTimer);
  clearInterval(cur.pollTimer);
  cur.pollTimer = null;
  if (cur.channel) {
    const ch = cur.channel;
    cur.channel = null;
    try {
      Promise.resolve(sb.removeChannel(ch)).catch(() => {});
    } catch {
      /* canal já fechado */
    }
  }
}

function selectConversation(id, { focus = false, push = true } = {}) {
  if (!UUID_RE.test(String(id))) return;
  if (S.cur && S.cur.id === id && !S.cur.closed) {
    showThreadPane(focus);
    return;
  }
  if (push && qsGet('c') !== id) {
    qsSet({ c: id }, { replace: false });
    S.pushedNav += 1;
  }
  openConversation(id, { focus });
}

function showThreadPane(focus) {
  el.chat.classList.add('is-thread-open');
  if (isMobile()) el.chat.scrollIntoView({ block: 'start' });
  if (focus) S.cur?.ui.title?.focus({ preventScroll: true });
}

function closeThread({ restoreFocus = true } = {}) {
  const prev = S.cur;
  cleanupConversation(prev);
  S.cur = null;
  el.chat.classList.remove('is-thread-open');
  renderThreadPlaceholder();
  renderList();
  if (restoreFocus && prev) el.list.querySelector(`a[data-conv="${CSS.escape(prev.id)}"]`)?.focus();
}

function renderThreadPlaceholder() {
  el.thread.replaceChildren(h('div', { class: 'pf-thread-empty' },
    h('p', { class: 'pf-thread-empty-title' }, 'Selecione uma conversa'),
    h('p', { class: 'pf-muted' }, 'Escolha uma conversa na lista para ler e responder as mensagens.')));
}

function renderThreadLoading() {
  el.thread.replaceChildren(h('div', { class: 'pf-thread-empty' },
    h('p', { class: 'pf-thread-loading', role: 'status' }, 'Carregando conversa…')));
}

function renderThreadNotFound() {
  el.chat.classList.add('is-thread-open');
  const title = h('h2', { class: 'pf-thread-empty-title', tabindex: '-1' }, 'Conversa não encontrada');
  el.thread.replaceChildren(
    h('div', { class: 'pf-thread-head' }, backButton()),
    h('div', { class: 'pf-thread-empty', role: 'alert' },
      title,
      h('p', { class: 'pf-muted' }, 'Ela pode ter sido removida, ou você não participa dela.'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => goBackToList() }, 'Ver minhas conversas')));
}

function backButton() {
  return h('button', { type: 'button', class: 'pf-thread-back', 'aria-label': 'Voltar para a lista de conversas', onClick: () => goBackToList() },
    icon(ICON_BACK), h('span', { 'aria-hidden': 'true' }, 'Conversas'));
}

function goBackToList() {
  if (S.pushedNav > 0) {
    history.back(); // popstate fecha a conversa
    return;
  }
  qsSet({ c: null }, { replace: true });
  closeThread();
}

async function openConversation(id, { focus = false } = {}) {
  cleanupConversation(S.cur);
  const row = S.convs.find((r) => r.id === id);
  if (!row) {
    S.cur = null;
    renderList();
    renderThreadNotFound();
    if (focus) el.thread.querySelector('h2')?.focus();
    return;
  }
  const cur = newConvState(id, row);
  S.cur = cur;
  renderThread(cur);
  renderList();
  showThreadPane(focus);
  subscribe(cur);
  await loadInitial(cur);
}

async function loadInitial(cur) {
  const ui = cur.ui;
  ui.bubbles.setAttribute('aria-busy', 'true');
  ui.bubbles.replaceChildren(h('p', { class: 'pf-thread-loading', role: 'status' }, 'Carregando mensagens…'));
  try {
    const msgs = await fetchLatest(cur.id);
    if (cur.closed) return;
    cur.hasMore = msgs.length === PAGE_SIZE;
    addMsgs(cur, msgs);
    cur.loaded = true;
    ui.bubbles.removeAttribute('aria-busy');
    renderBubbles(cur);
    scrollToBottom(cur);
    // mensagens que chegaram entre a consulta e o canal ficar pronto
    if (cur.rtStatus === 'SUBSCRIBED' || cur.pollTimer) catchUp(cur);
    markRead(cur);
  } catch (err) {
    if (cur.closed) return;
    ui.bubbles.removeAttribute('aria-busy');
    ui.bubbles.replaceChildren(h('div', { class: 'pf-thread-error', role: 'alert' },
      h('p', {}, 'Não foi possível carregar as mensagens.'),
      h('p', { class: 'pf-muted' }, errorMsg(err)),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => loadInitial(cur) }, 'Tentar de novo')));
  }
}

function renderThread(cur) {
  const row = cur.row;
  const name = otherName(row);
  const href = profileHref(row);
  const ui = cur.ui;

  ui.title = h('h2', { class: 'pf-thread-title', id: 'threadTitle', tabindex: '-1' },
    href ? h('a', { href, class: 'pf-thread-link' }, name) : name);
  const sub = otherIsTutor(row)
    ? h('p', { class: 'pf-thread-sub' }, 'Professor', href ? [' · ', h('a', { href, class: 'pf-thread-sublink' }, 'Ver perfil')] : null)
    : h('p', { class: 'pf-thread-sub' }, 'Aluno');

  const head = h('header', { class: 'pf-thread-head' },
    backButton(),
    href ? h('a', { href, class: 'pf-thread-avatar', tabindex: '-1', 'aria-hidden': 'true' }, avatarEl(row.other_avatar, name, 40))
      : h('span', { class: 'pf-thread-avatar' }, avatarEl(row.other_avatar, name, 40)),
    h('div', { class: 'pf-thread-who' }, ui.title, sub));

  ui.bubbles = h('div', {
    class: 'pf-bubbles',
    id: 'bubbles',
    tabindex: '0',
    role: 'log',
    'aria-live': 'off', // anúncios vão pela região própria (sem reler o histórico)
    'aria-label': `Mensagens com ${name}`,
  });
  ui.bubbles.addEventListener('scroll', () => onBubblesScroll(cur), { passive: true });

  ui.newPill = h('button', { type: 'button', class: 'pf-new-pill', hidden: true, onClick: () => scrollToBottom(cur, true) },
    'Novas mensagens', icon(ICON_DOWN));

  ui.input = h('textarea', {
    id: 'msgInput',
    class: 'pf-textarea pf-composer-input',
    rows: 1,
    maxlength: MAX_LEN,
    placeholder: typeof matchMedia === 'function' && matchMedia('(max-width: 420px)').matches ? 'Mensagem…' : 'Escreva uma mensagem…',
    'aria-describedby': 'composerHint',
    autocomplete: 'off',
  });
  ui.sendBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-sm pf-composer-send', 'aria-label': 'Enviar mensagem' },
    icon(ICON_SEND), h('span', {}, 'Enviar'));
  ui.counter = h('span', { class: 'pf-counter pf-composer-counter', hidden: true }, '');
  ui.status = h('p', { class: 'pf-composer-status', role: 'status', 'aria-live': 'polite' });
  ui.hint = h('p', { class: 'pf-composer-hint', id: 'composerHint' },
    coarsePointer() ? 'Toque em Enviar para mandar a mensagem.' : 'Enter envia · Shift+Enter quebra a linha');

  const banned = Boolean(S.profile?.banned_at);
  ui.form = h('form', { class: 'pf-composer', 'aria-label': 'Responder', novalidate: true },
    h('label', { class: 'pf-sr-only', for: 'msgInput' }, `Mensagem para ${name}`),
    ui.input,
    ui.sendBtn);
  if (banned) {
    ui.input.disabled = true;
    ui.sendBtn.disabled = true;
    ui.hint.textContent = 'Sua conta está suspensa: não é possível enviar mensagens.';
  }

  ui.input.addEventListener('input', () => {
    autosize(ui.input);
    const n = ui.input.value.length;
    ui.counter.hidden = n < MAX_LEN - 500;
    ui.counter.textContent = `${n}/${MAX_LEN}`;
    if (ui.status.classList.contains('is-error') && ui.input.value.trim()) setStatus(cur, '');
  });
  ui.input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    if (e.shiftKey || e.altKey) return; // quebra de linha
    if (coarsePointer() && !(e.ctrlKey || e.metaKey)) return; // teclado virtual: Enter quebra linha
    e.preventDefault();
    ui.form.requestSubmit();
  });
  ui.form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage(cur);
  });

  el.thread.replaceChildren(
    head,
    h('div', { class: 'pf-bubbles-wrap' }, ui.bubbles, ui.newPill),
    ui.form,
    h('div', { class: 'pf-composer-foot' }, ui.hint, ui.counter, ui.status));
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight + 2, 160)}px`;
}

function setStatus(cur, text, isError = false) {
  const s = cur.ui.status;
  s.textContent = text;
  s.classList.toggle('is-error', Boolean(isError && text));
  if (isError) s.setAttribute('role', 'alert');
  else s.setAttribute('role', 'status');
}

// ---------- Mensagens (render) ----------
function addMsgs(cur, list) {
  const fresh = [];
  for (const m of list) {
    if (!m || m.conversation_id !== cur.id || cur.byId.has(m.id)) continue;
    cur.byId.set(m.id, m);
    fresh.push(m);
  }
  if (fresh.length) {
    cur.msgs.push(...fresh);
    cur.msgs.sort((a, b) => a.id - b.id);
  }
  return fresh;
}

function bubbleFor(cur, m) {
  let node = cur.els.get(m.id);
  if (node) return node;
  node = msgEl(cur, m, { mine: m.sender_id === S.uid });
  cur.els.set(m.id, node);
  return node;
}

function msgEl(cur, m, { mine, pending = false }) {
  const who = mine ? 'Você' : otherName(cur.row);
  const time = h('span', { class: 'pf-bubble-time' },
    pending ? h('span', { class: 'pf-msg-sending' }, 'Enviando…') : timeEl(m.created_at, fmtTimeSafe(m.created_at)));
  // Denunciar fica na linha do horário (sem ocupar espaço extra entre as bolhas)
  const report = !mine && !pending ? h('span', { class: 'pf-msg-actions' }, safeReport(m.id)) : null;
  const bubble = h('div', { class: ['pf-bubble', mine ? 'pf-bubble--me' : 'pf-bubble--them'] },
    h('span', { class: 'pf-sr-only' }, `${who}: `),
    h('span', { class: 'pf-msg-body' }, m.body),
    h('span', { class: 'pf-bubble-meta' }, time, report));
  return h('div', {
    class: ['pf-msg', mine ? 'pf-msg--me' : 'pf-msg--them', pending && 'is-pending'],
    dataset: m.id != null ? { id: String(m.id) } : null,
  }, bubble);
}

function fmtTimeSafe(iso) {
  const d = toDate(iso);
  return d ? fmtTime.format(d) : '';
}

function safeReport(id) {
  try {
    return reportButton({ type: 'message', id: String(id), label: 'Denunciar' });
  } catch {
    return null;
  }
}

function renderBubbles(cur) {
  const box = cur.ui.bubbles;
  if (!box) return;
  const active = document.activeElement;
  const kids = [];
  if (cur.hasMore) {
    cur.ui.olderBtn = cur.ui.olderBtn || h('button', { type: 'button', class: 'pf-older-btn btn btn-ghost btn-sm', onClick: () => loadOlder(cur) }, 'Carregar anteriores');
    cur.ui.olderBtn.disabled = cur.loadingOlder;
    cur.ui.olderBtn.textContent = cur.loadingOlder ? 'Carregando…' : 'Carregar anteriores';
    kids.push(h('div', { class: 'pf-older' }, cur.ui.olderBtn));
  } else if (cur.msgs.length) {
    kids.push(h('p', { class: 'pf-thread-start' }, 'Início da conversa'));
  }
  let lastDay = '';
  for (const m of cur.msgs) {
    const k = dayKey(m.created_at);
    if (k && k !== lastDay) {
      kids.push(h('div', { class: 'pf-day-sep' }, h('span', {}, dayLabel(m.created_at))));
      lastDay = k;
    }
    kids.push(bubbleFor(cur, m));
  }
  for (const p of cur.pending) kids.push(p.el);
  if (!cur.msgs.length && !cur.pending.length) {
    kids.push(h('p', { class: 'pf-thread-none' }, 'Nenhuma mensagem ainda. Escreva a primeira!'));
  }
  box.replaceChildren(...kids);
  if (active && active !== document.activeElement && box.contains(active)) active.focus({ preventScroll: true });
}

function distanceFromBottom(box) {
  return box.scrollHeight - box.scrollTop - box.clientHeight;
}

function scrollToBottom(cur, smooth = false) {
  const box = cur.ui.bubbles;
  if (!box) return;
  box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  cur.ui.newPill.hidden = true;
}

function onBubblesScroll(cur) {
  const box = cur.ui.bubbles;
  if (distanceFromBottom(box) < 40) cur.ui.newPill.hidden = true;
  if (box.scrollTop < 60 && cur.hasMore && !cur.loadingOlder && cur.loaded) loadOlder(cur);
}

async function loadOlder(cur) {
  if (cur.loadingOlder || !cur.hasMore || !cur.msgs.length) return;
  cur.loadingOlder = true;
  renderBubbles(cur);
  const box = cur.ui.bubbles;
  try {
    const older = await fetchOlder(cur.id, cur.msgs[0].id);
    if (cur.closed) return;
    const prevHeight = box.scrollHeight;
    const prevTop = box.scrollTop;
    cur.hasMore = older.length === PAGE_SIZE;
    const added = addMsgs(cur, older);
    cur.loadingOlder = false;
    const hadFocus = document.activeElement === cur.ui.olderBtn;
    renderBubbles(cur);
    box.scrollTop = prevTop + (box.scrollHeight - prevHeight);
    if (hadFocus) {
      // o botão pode ter sumido (início da conversa): foco vai para a lista de mensagens
      (cur.hasMore ? cur.ui.olderBtn : box).focus({ preventScroll: true });
    }
    announce(added.length
      ? `${added.length} ${added.length === 1 ? 'mensagem anterior carregada' : 'mensagens anteriores carregadas'}.`
      : 'Não há mensagens anteriores.');
  } catch (err) {
    if (cur.closed) return;
    cur.loadingOlder = false;
    renderBubbles(cur);
    toast(errorMsg(err), 'erro');
  }
}

// Novas mensagens (tempo real, polling ou resposta do envio)
function receive(cur, rows) {
  if (cur.closed) return;
  const list = rows.map(normMsg).filter(Boolean);
  const fresh = [];
  for (const m of list) {
    if (m.conversation_id !== cur.id || cur.byId.has(m.id)) continue;
    // Minha mensagem que chegou pelo canal antes da resposta do POST: adota a bolha otimista
    if (m.sender_id === S.uid) {
      const p = cur.pending.find((x) => x.id == null && x.body === m.body);
      if (p) adoptPending(cur, p, m);
    }
    fresh.push(m);
  }
  if (!fresh.length) return;
  const box = cur.ui.bubbles;
  const wasNear = box ? distanceFromBottom(box) < 120 : true;
  addMsgs(cur, fresh);
  if (!cur.loaded) return; // a carga inicial desenha tudo
  renderBubbles(cur);

  const incoming = fresh.filter((m) => m.sender_id !== S.uid);
  const mineNew = fresh.length > incoming.length;
  if (wasNear || mineNew) scrollToBottom(cur);
  else if (incoming.length) cur.ui.newPill.hidden = false;

  const last = fresh[fresh.length - 1];
  const visible = document.visibilityState === 'visible';
  touchListRow(cur.id, last, { read: visible || !incoming.length, unread: !visible && incoming.length > 0 });
  if (incoming.length) {
    const lastIn = incoming[incoming.length - 1];
    announce(`Nova mensagem de ${otherName(cur.row)}: ${lastIn.body.slice(0, 160)}`);
    if (visible) scheduleMarkRead(cur);
    else cur.unseen = true;
  }
}

function adoptPending(cur, p, m) {
  p.id = m.id;
  const node = msgEl(cur, m, { mine: true });
  p.el.replaceWith(node);
  cur.els.set(m.id, node);
  cur.pending = cur.pending.filter((x) => x !== p);
}

// ---------- Envio ----------
async function sendMessage(cur) {
  const ui = cur.ui;
  if (S.profile?.banned_at) return;
  const body = ui.input.value.trim();
  if (!body) {
    setStatus(cur, 'Escreva uma mensagem antes de enviar.', true);
    ui.input.focus();
    return;
  }
  if (body.length > MAX_LEN) {
    setStatus(cur, `A mensagem pode ter até ${MAX_LEN} caracteres.`, true);
    return;
  }
  setStatus(cur, '');
  const p = { key: ++pendingSeq, body, id: null, el: null };
  p.el = msgEl(cur, { id: null, body, created_at: new Date().toISOString() }, { mine: true, pending: true });
  cur.pending.push(p);
  ui.input.value = '';
  autosize(ui.input);
  ui.counter.hidden = true;
  renderBubbles(cur);
  scrollToBottom(cur);

  try {
    const { data, error } = await sb.from('messages')
      .insert({ conversation_id: cur.id, body })
      .select(MSG_COLS)
      .single();
    if (error) throw error;
    const m = normMsg(data);
    if (cur.closed) return;
    if (!m) {
      // gravou, mas sem retorno legível: busca pelo canal/polling
      cur.pending = cur.pending.filter((x) => x !== p);
      p.el.remove();
      catchUp(cur);
      return;
    }
    if (cur.pending.includes(p)) {
      if (cur.byId.has(m.id)) {
        // já chegou (outro caminho) com outro texto: remove a bolha otimista
        cur.pending = cur.pending.filter((x) => x !== p);
        p.el.remove();
      } else {
        adoptPending(cur, p, m);
      }
    }
    if (!cur.byId.has(m.id)) addMsgs(cur, [m]);
    renderBubbles(cur);
    scrollToBottom(cur);
    touchListRow(cur.id, m, { read: true });
    announce('Mensagem enviada.');
  } catch (err) {
    if (cur.closed) {
      toast(`Sua mensagem não foi enviada: ${errorMsg(err)}`, 'erro');
      return;
    }
    cur.pending = cur.pending.filter((x) => x !== p);
    p.el.remove();
    renderBubbles(cur);
    // devolve o texto para tentar de novo (sem apagar o que já foi digitado depois)
    if (!ui.input.value.trim()) {
      ui.input.value = body;
      autosize(ui.input);
    }
    setStatus(cur, `Não enviada: ${errorMsg(err)}`, true);
    ui.input.focus();
  }
}

// ---------- Tempo real / polling ----------
function subscribe(cur) {
  let ch;
  try {
    ch = sb.channel(`mensagens:${cur.id}:${++channelSeq}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${cur.id}` },
        (payload) => {
          if (cur.closed || !payload?.new) return;
          receive(cur, [payload.new]);
        })
      .subscribe((status) => {
        if (cur.closed) return;
        cur.rtStatus = status;
        if (status === 'SUBSCRIBED') {
          clearTimeout(cur.subTimer);
          stopPolling(cur);
          catchUp(cur); // cobre o intervalo até o canal ficar pronto (ou reconectar)
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          startPolling(cur);
        }
      });
  } catch {
    startPolling(cur);
    return;
  }
  cur.channel = ch;
  cur.subTimer = setTimeout(() => {
    if (!cur.closed && cur.rtStatus !== 'SUBSCRIBED') startPolling(cur);
  }, SUB_TIMEOUT_MS);
}

function startPolling(cur) {
  if (cur.closed || cur.pollTimer) return;
  cur.pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') catchUp(cur);
  }, POLL_MS);
}

function stopPolling(cur) {
  clearInterval(cur.pollTimer);
  cur.pollTimer = null;
}

async function catchUp(cur) {
  if (cur.closed || !cur.loaded) return;
  if (cur.catching) {
    cur.catchAgain = true;
    return;
  }
  cur.catching = true;
  try {
    const lastId = cur.msgs.length ? cur.msgs[cur.msgs.length - 1].id : 0;
    const rows = await fetchNewer(cur.id, lastId);
    if (!cur.closed && rows.length) receive(cur, rows);
  } catch {
    /* silencioso: tenta de novo no próximo ciclo */
  } finally {
    cur.catching = false;
    if (cur.catchAgain && !cur.closed) {
      cur.catchAgain = false;
      catchUp(cur);
    }
  }
}

// ---------- Lidas ----------
function scheduleMarkRead(cur, delay = 600) {
  clearTimeout(cur.markTimer);
  cur.markTimer = setTimeout(() => markRead(cur), delay);
}

async function markRead(cur) {
  if (cur.closed) return;
  cur.unseen = false;
  try {
    const { error } = await sb.rpc('mark_read', { p_conv: cur.id });
    if (error) return;
    if (!cur.closed) touchListRow(cur.id, null, { read: true });
    refreshUnread();
  } catch {
    /* badge é só um extra */
  }
}

// ---------- Eventos da página ----------
function onVisible() {
  if (document.visibilityState !== 'visible') return;
  const cur = S.cur;
  if (cur && !cur.closed && cur.loaded) {
    catchUp(cur);
    const row = S.convs.find((r) => r.id === cur.id);
    if (cur.unseen || row?.unread) scheduleMarkRead(cur, 0);
  }
  loadList();
}

function onPopState() {
  const c = qsGet('c');
  if (S.pushedNav > 0) S.pushedNav -= 1;
  if (c && UUID_RE.test(c)) {
    if (!S.cur || S.cur.id !== c) openConversation(c, { focus: true });
    else showThreadPane(false);
  } else if (S.cur || el.chat.classList.contains('is-thread-open')) {
    closeThread();
  }
}

function onPageHide() {
  cleanupConversation(S.cur);
  clearInterval(S.listTimer);
}

async function main() {
  initChrome();
  const body = document.getElementById('pageBody');
  if (!body) return;
  if (!isConfigured) {
    notConfiguredNotice(body);
    return;
  }

  let profile;
  try {
    profile = await requireAuth();
  } catch (err) {
    body.replaceChildren(h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' },
      h('p', {}, `Não foi possível abrir suas mensagens. ${errorMsg(err)}`),
      h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => location.reload() }, 'Tentar de novo'))));
    return;
  }
  if (!profile) return;
  S.profile = profile;
  S.uid = profile.id;

  buildLayout(body);
  renderThreadPlaceholder();

  const wanted = qsGet('c');
  const validWanted = wanted && UUID_RE.test(wanted) ? wanted : null;
  if (wanted && !validWanted) qsSet({ c: null });
  if (validWanted) {
    el.chat.classList.add('is-thread-open');
    renderThreadLoading();
  }

  const ok = await loadList({ initial: true });
  if (validWanted) {
    if (ok || S.convs.length) openConversation(validWanted);
    else {
      // lista falhou: mostra o erro na lista (celular: volta para ela)
      el.chat.classList.remove('is-thread-open');
      renderThreadPlaceholder();
    }
  }

  window.addEventListener('popstate', onPopState);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pagehide', onPageHide);
  S.listTimer = setInterval(() => {
    if (document.visibilityState === 'visible') loadList();
  }, LIST_REFRESH_MS);
}

main();
