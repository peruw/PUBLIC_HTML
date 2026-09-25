/* ============================================
   Página: Moderação (dono: moderação) — só admin (profiles.is_admin)
   Fila de denúncias (abertas primeiro; filtro por situação e tipo), prévia do item
   denunciado e ações via rpc('admin_moderate', { p_type, p_id, p_action, p_report }):
   ocultar/restaurar (review|question|answer), suspender/reativar anúncio (tutor),
   banir/desbanir (p_type 'user' + uuid) e descartar a denúncia.
   Desbanir NÃO reativa um anúncio suspenso (são ações separadas).
   ============================================ */

import '../../css/admin.css';
import { sb } from '../supabase.js';
import { isConfigured } from '../config.js';
import { requireAuth } from '../auth.js';
import {
  initChrome, h, formatDate, timeAgo, errorMsg, toast, modal, qsGet, qsSet,
  emptyState, skeletonCards, notConfiguredNotice, avatarEl, starsEl,
} from '../ui.js';
import { reasonLabel } from '../components/report.js';

const PAGE_SIZE = 20;

const STATUSES = [
  { id: 'open', label: 'Abertas', title: 'Denúncias abertas' },
  { id: 'resolved', label: 'Resolvidas', title: 'Denúncias resolvidas' },
  { id: 'dismissed', label: 'Descartadas', title: 'Denúncias descartadas' },
  { id: 'all', label: 'Todas', title: 'Todas as denúncias' },
];
const TYPES = [
  { id: 'tutor', label: 'Perfis de professor', one: 'Perfil de professor', what: 'este anúncio' },
  { id: 'review', label: 'Avaliações', one: 'Avaliação', what: 'esta avaliação' },
  { id: 'question', label: 'Perguntas', one: 'Pergunta', what: 'esta pergunta' },
  { id: 'answer', label: 'Respostas', one: 'Resposta', what: 'esta resposta' },
  { id: 'message', label: 'Mensagens', one: 'Mensagem', what: 'esta mensagem' },
];
const STATUS_BADGE = {
  open: ['Aberta', 'pf-badge--warn'],
  resolved: ['Resolvida', 'pf-badge--ok'],
  dismissed: ['Descartada', 'pf-badge--muted'],
};
const HIDEABLE = new Set(['review', 'question', 'answer']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUM_RE = /^[0-9]{1,18}$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EXCERPT = 400;

// Colunas buscadas para a prévia de cada tipo (o admin lê tudo pelo RLS; mensagens só as denunciadas)
const TARGET_QUERY = {
  tutor: ['tutor_profiles', 'user_id', 'user_id,slug,headline,bio,published,suspended'],
  review: ['reviews', 'id', 'id,tutor_id,student_id,rating,comment,status,created_at,tutor:tutor_profiles!tutor_id(slug)'],
  question: ['questions', 'id', 'id,title,body,status,author_id,created_at'],
  answer: ['answers', 'id', 'id,question_id,tutor_id,body,status,created_at,question:questions(id,title)'],
  message: ['messages', 'id', 'id,conversation_id,sender_id,body,created_at'],
};

const state = {
  me: null,
  status: 'open',
  type: '',
  rows: [],
  total: 0,
  counts: {},
  cache: newCache(),
  seq: 0,
  countSeq: 0,
};
const ui = {};

// Dados de apoio de uma carga da lista (trocados a cada recarga: o estado do item muda depois de cada ação)
function newCache() {
  return {
    profiles: new Map(), // uuid -> linha de profiles
    targets: new Map(), // 'tipo:id' -> { row } | { missing: true } | { error }
    siblings: new Map(), // 'tipo:id' -> ids das denúncias ABERTAS sobre o item
  };
}

const typeInfo = (id) => TYPES.find((t) => t.id === id) || { id, label: id, one: id, what: 'este item' };
const normId = (type, id) => (type === 'tutor' ? String(id).toLowerCase() : String(id));
const tkey = (type, id) => `${type}:${normId(type, id)}`;
const validTargetId = (type, id) => (type === 'tutor' ? UUID_RE.test(String(id)) : NUM_RE.test(String(id)));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- Dados ----------

function reportsQuery(from, to) {
  let q = sb.from('reports')
    .select('id,reporter_id,target_type,target_id,reason,details,status,created_at,resolved_at', { count: 'exact' });
  if (state.status !== 'all') q = q.eq('status', state.status);
  if (state.type) q = q.eq('target_type', state.type);
  if (state.status === 'open') {
    // Fila: as mais antigas primeiro
    q = q.order('created_at', { ascending: true }).order('id', { ascending: true });
  } else if (state.status === 'all') {
    // Abertas (resolved_at nulo) primeiro, depois as decididas mais recentes
    q = q.order('resolved_at', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
  } else {
    q = q.order('resolved_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false });
  }
  return q.range(from, to);
}

async function fetchReports(from, to) {
  const { data, error, count } = await reportsQuery(from, to);
  if (error) throw error;
  return { rows: data || [], total: count ?? (data || []).length };
}

function authorOf(type, row) {
  if (!row) return null;
  switch (type) {
    case 'tutor': return row.user_id;
    case 'review': return row.student_id;
    case 'question': return row.author_id;
    case 'answer': return row.tutor_id;
    case 'message': return row.sender_id;
    default: return null;
  }
}

/** Busca (em lote, por tipo) os itens denunciados, as outras denúncias abertas e os perfis envolvidos. */
async function hydrate(rows, cache) {
  const need = {};
  for (const r of rows) {
    const k = tkey(r.target_type, r.target_id);
    if (cache.targets.has(k)) continue;
    if (!TARGET_QUERY[r.target_type] || !validTargetId(r.target_type, r.target_id)) {
      cache.targets.set(k, { missing: true });
      continue;
    }
    if (!need[r.target_type]) need[r.target_type] = new Set();
    need[r.target_type].add(normId(r.target_type, r.target_id));
  }

  const targetJobs = Object.entries(need).map(async ([type, set]) => {
    const ids = [...set];
    const [table, col, cols] = TARGET_QUERY[type];
    try {
      const { data, error } = await sb.from(table).select(cols).in(col, ids);
      if (error) throw error;
      const byId = new Map((data || []).map((x) => [normId(type, x[col]), x]));
      for (const id of ids) cache.targets.set(`${type}:${id}`, byId.has(id) ? { row: byId.get(id) } : { missing: true });
    } catch (error) {
      for (const id of ids) cache.targets.set(`${type}:${id}`, { error });
    }
  });

  // Outras denúncias abertas sobre os mesmos itens (para resolver todas de uma vez)
  const openIds = [...new Set(rows
    .filter((r) => r.status === 'open' && validTargetId(r.target_type, r.target_id))
    .map((r) => String(r.target_id)))];
  const siblingJob = (async () => {
    if (!openIds.length) return;
    try {
      const { data, error } = await sb.from('reports').select('id,target_type,target_id')
        .eq('status', 'open').in('target_id', openIds);
      if (error) return;
      const groups = new Map();
      for (const s of data || []) {
        const k = tkey(s.target_type, s.target_id);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(s.id);
      }
      for (const r of rows) {
        const k = tkey(r.target_type, r.target_id);
        if (r.status === 'open') cache.siblings.set(k, groups.get(k) || []);
      }
    } catch { /* opcional */ }
  })();

  await Promise.all([...targetJobs, siblingJob]);

  const uids = new Set();
  for (const r of rows) {
    if (r.reporter_id) uids.add(r.reporter_id);
    const row = cache.targets.get(tkey(r.target_type, r.target_id))?.row;
    const a = authorOf(r.target_type, row);
    if (a) uids.add(a);
    if (r.target_type === 'review' && row?.tutor_id) uids.add(row.tutor_id);
  }
  const missing = [...uids].filter((id) => UUID_RE.test(id) && !cache.profiles.has(id));
  if (missing.length) {
    try {
      const { data, error } = await sb.from('profiles')
        .select('id,full_name,avatar_path,role,is_admin,banned_at').in('id', missing);
      if (!error) for (const p of data || []) cache.profiles.set(p.id, p);
    } catch { /* nomes ficam como "Usuário" */ }
  }
}

async function loadCounts() {
  const my = ++state.countSeq;
  const results = await Promise.all(['open', 'resolved', 'dismissed'].map(async (s) => {
    try {
      let q = sb.from('reports').select('id', { count: 'exact', head: true }).eq('status', s);
      if (state.type) q = q.eq('target_type', state.type);
      const { count, error } = await q;
      return error ? null : count;
    } catch {
      return null;
    }
  }));
  if (my !== state.countSeq) return;
  const [open, resolved, dismissed] = results;
  state.counts = {
    open, resolved, dismissed,
    all: results.every((n) => Number.isFinite(n)) ? open + resolved + dismissed : null,
  };
  renderCounts();
}

// ---------- Carregamento ----------

async function load({ keep = false, focusIndex = null } = {}) {
  const my = ++state.seq;
  const want = keep ? Math.max(PAGE_SIZE, state.rows.length) : PAGE_SIZE;
  const cache = newCache();
  if (!keep || !state.rows.length) {
    ui.list.replaceChildren(skeletonCards(3));
    ui.more.hidden = true;
  }
  ui.list.setAttribute('aria-busy', 'true');
  ui.live.textContent = 'Carregando denúncias…';
  loadCounts();
  try {
    const { rows, total } = await fetchReports(0, want - 1);
    await hydrate(rows, cache);
    if (my !== state.seq) return;
    state.cache = cache;
    state.rows = rows;
    state.total = total;
    renderList();
    if (focusIndex != null) focusCard(focusIndex);
  } catch (err) {
    if (my !== state.seq) return;
    state.rows = [];
    state.total = 0;
    renderError(err);
  } finally {
    if (my === state.seq) ui.list.removeAttribute('aria-busy');
  }
}

async function loadMore() {
  const my = state.seq;
  const from = state.rows.length;
  ui.moreBtn.disabled = true;
  ui.moreBtn.setAttribute('aria-busy', 'true');
  ui.live.textContent = 'Carregando mais denúncias…';
  try {
    const { rows, total } = await fetchReports(from, from + PAGE_SIZE - 1);
    await hydrate(rows, state.cache);
    if (my !== state.seq) return;
    const known = new Set(state.rows.map((r) => r.id));
    state.rows = state.rows.concat(rows.filter((r) => !known.has(r.id)));
    state.total = total;
    renderList();
    focusCard(from);
  } catch (err) {
    if (my !== state.seq) return;
    ui.live.textContent = '';
    toast(errorMsg(err), 'erro');
  } finally {
    ui.moreBtn.disabled = false;
    ui.moreBtn.removeAttribute('aria-busy');
  }
}

function focusCard(index) {
  const cards = ui.list.querySelectorAll('.pf-adm-card');
  if (!cards.length) {
    ui.title.focus();
    return;
  }
  cards[Math.min(index, cards.length - 1)].focus();
}

// ---------- Ações ----------

const ACTIONS = {
  hide: {
    label: (t) => `Ocultar ${typeInfo(t).one.toLowerCase()}`,
    danger: true,
    confirm: (c) => `Ocultar ${c.what}? Ela deixa de aparecer para o público e o autor não pode mais editar nem excluir. Dá para restaurar depois.`,
    done: 'Conteúdo ocultado.',
  },
  restore: {
    label: (t) => `Restaurar ${typeInfo(t).one.toLowerCase()}`,
    confirm: (c) => `Restaurar ${c.what}? Ela volta a aparecer para o público.`,
    done: 'Conteúdo restaurado.',
  },
  suspend: {
    label: () => 'Suspender anúncio',
    danger: true,
    confirm: (c) => `Suspender o anúncio de ${c.name}? O perfil sai da busca e deixa de receber contatos novos. A conta continua ativa. Dá para reativar depois.`,
    done: 'Anúncio suspenso.',
  },
  unsuspend: {
    label: () => 'Reativar anúncio',
    confirm: (c) => `Reativar o anúncio de ${c.name}? Ele volta à busca se estiver publicado e a conta não estiver banida.`,
    done: 'Anúncio reativado.',
  },
  ban: {
    label: () => 'Banir usuário',
    danger: true,
    confirm: (c) => `Banir ${c.name}? A pessoa não poderá mais enviar mensagens, publicar, avaliar, denunciar nem editar o perfil, e o anúncio de professor (se houver) sai do ar. Dá para desbanir depois.`,
    done: 'Usuário banido.',
  },
  unban: {
    label: () => 'Desbanir usuário',
    confirm: (c) => `Desbanir ${c.name}? A conta volta a funcionar. Um anúncio suspenso continua suspenso: reative-o à parte, se for o caso.`,
    done: 'Usuário desbanido.',
  },
  dismiss: {
    label: () => 'Descartar denúncia',
    confirm: () => 'Descartar esta denúncia? Ela sai da fila sem nenhuma ação sobre o conteúdo.',
    done: 'Denúncia descartada.',
  },
};

function actionsFor(r, row, authorId, author) {
  const list = [];
  const type = r.target_type;
  if (row) {
    if (type === 'tutor') {
      list.push({ action: row.suspended ? 'unsuspend' : 'suspend', p_type: 'tutor', p_id: String(row.user_id) });
    }
    if (HIDEABLE.has(type)) {
      list.push({ action: row.status === 'hidden' ? 'restore' : 'hide', p_type: type, p_id: String(row.id) });
    }
    // Não oferece banir a si mesmo (o admin perderia o acesso)
    if (authorId && author && authorId !== state.me?.id) {
      list.push({ action: author.banned_at ? 'unban' : 'ban', p_type: 'user', p_id: String(authorId) });
    }
  }
  if (r.status === 'open') list.push({ action: 'dismiss', p_type: type, p_id: String(r.target_id) });
  return list;
}

async function moderate(args) {
  const { error } = await sb.rpc('admin_moderate', args);
  if (error) throw error;
}

function confirmAction(r, act, ctx, index) {
  const def = ACTIONS[act.action];
  const others = r.status === 'open'
    ? (state.cache.siblings.get(tkey(r.target_type, r.target_id)) || []).filter((id) => id !== r.id)
    : [];
  let alsoOthers = null;
  if (others.length) {
    const id = `admAll${r.id}`;
    alsoOthers = h('input', { type: 'checkbox', id, checked: act.action !== 'dismiss' });
  }
  const content = h('div', { class: 'pf-adm-confirm' },
    h('p', {}, def.confirm(ctx)),
    r.status === 'open'
      ? h('p', { class: 'pf-hint' }, act.action === 'dismiss' ? `A denúncia #${r.id} será marcada como descartada.` : `A denúncia #${r.id} será marcada como resolvida.`)
      : null,
    alsoOthers
      ? h('label', { class: 'pf-check', for: alsoOthers.id }, alsoOthers,
        `${act.action === 'dismiss' ? 'Descartar' : 'Resolver'} também ${others.length === 1
          ? 'a outra denúncia aberta'
          : `as outras ${others.length} denúncias abertas`} sobre este item`)
      : null);

  modal({
    title: def.label(r.target_type),
    content,
    actions: [
      { label: 'Cancelar' },
      {
        label: def.label(r.target_type),
        primary: !def.danger,
        danger: !!def.danger,
        onClick: async () => {
          const base = { p_type: act.p_type, p_id: act.p_id, p_action: act.action };
          await moderate({ ...base, p_report: r.status === 'open' ? r.id : null });
          let failed = 0;
          if (alsoOthers?.checked) {
            for (const id of others) {
              try {
                await moderate({ ...base, p_report: id });
              } catch {
                failed += 1;
              }
            }
          }
          toast(def.done, 'ok');
          if (failed) toast(`${plural(failed, 'denúncia relacionada não foi atualizada', 'denúncias relacionadas não foram atualizadas')}. Tente de novo.`, 'erro');
          setTimeout(() => load({ keep: true, focusIndex: index }), 0);
          return true;
        },
      },
    ],
  });
}

// ---------- Renderização ----------

function badge(text, kind) {
  return h('span', { class: ['pf-badge', kind ? `pf-badge--${kind}` : null] }, text);
}

function nameOf(uid, fallback = 'Usuário') {
  if (!uid) return fallback;
  const p = state.cache.profiles.get(uid);
  return (p?.full_name || '').trim() || fallback;
}

function excerpt(text, cls = 'pf-adm-text') {
  const full = String(text ?? '');
  if (!full.trim()) return h('p', { class: [cls, 'pf-muted'] }, '(sem texto)');
  if (full.length <= EXCERPT) return h('p', { class: [cls, 'pf-pre'] }, full);
  const short = `${full.slice(0, EXCERPT).trimEnd()}…`;
  const p = h('p', { class: [cls, 'pf-pre'] }, short);
  const btn = h('button', { type: 'button', class: 'pf-link-btn', 'aria-expanded': false }, 'Mostrar tudo');
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    p.textContent = open ? full : short;
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Mostrar menos' : 'Mostrar tudo';
  });
  return h('div', {}, p, btn);
}

function decorativeAvatar(path, name) {
  const el = avatarEl(path, name, 32);
  el.setAttribute('aria-hidden', 'true');
  if (el.tagName === 'IMG') el.alt = '';
  return el;
}

function openLink(href, text) {
  return h('a', { class: 'pf-adm-link', href, target: '_blank', rel: 'noopener' },
    text, h('span', { class: 'pf-sr-only' }, ' (abre em nova aba)'));
}

function profileUrl(slug, hash = '') {
  return slug && SLUG_RE.test(slug) ? `/professores/p/${encodeURIComponent(slug)}${hash}` : null;
}

function questionUrl(qid, aid) {
  if (!NUM_RE.test(String(qid))) return null;
  return `/professores/duvida.html?q=${qid}${aid && NUM_RE.test(String(aid)) ? `#resposta-${aid}` : ''}`;
}

function targetPreview(r, t, authorId, author) {
  if (t.error) {
    return h('div', { class: 'pf-adm-target is-missing' },
      h('p', {}, 'Não foi possível carregar o item denunciado: ', errorMsg(t.error)));
  }
  const row = t.row;
  if (!row) {
    return h('div', { class: 'pf-adm-target is-missing' },
      h('p', {}, 'Item não encontrado. Pode ter sido excluído pelo autor.'));
  }
  const name = nameOf(authorId);
  const badges = [];
  if (author?.banned_at) badges.push(badge('Autor banido', 'warn'));
  let title;
  const body = [];
  let link = null;

  switch (r.target_type) {
    case 'tutor':
      title = `Anúncio de ${name}`;
      if (row.suspended) badges.unshift(badge('Suspenso', 'warn'));
      else if (!row.published) badges.unshift(badge('Não publicado', 'muted'));
      else badges.unshift(badge('No ar', 'ok'));
      if (row.headline) body.push(h('p', { class: 'pf-adm-strong' }, row.headline));
      body.push(excerpt(row.bio));
      if (profileUrl(row.slug)) link = openLink(profileUrl(row.slug), 'Ver perfil público');
      break;
    case 'review': {
      title = `Avaliação de ${name} para ${nameOf(row.tutor_id, 'professor')}`;
      if (row.status === 'hidden') badges.unshift(badge('Oculta', 'warn'));
      body.push(starsEl(row.rating));
      body.push(excerpt(row.comment));
      const url = profileUrl(row.tutor?.slug, '#avaliacoes');
      if (url) link = openLink(url, 'Ver perfil do professor');
      break;
    }
    case 'question':
      title = `Pergunta de ${name}`;
      if (row.status === 'hidden') badges.unshift(badge('Oculta', 'warn'));
      body.push(h('p', { class: 'pf-adm-strong' }, row.title || ''));
      body.push(excerpt(row.body));
      if (questionUrl(row.id)) link = openLink(questionUrl(row.id), 'Abrir a pergunta');
      break;
    case 'answer':
      title = `Resposta de ${name}`;
      if (row.status === 'hidden') badges.unshift(badge('Oculta', 'warn'));
      if (row.question?.title) body.push(h('p', { class: 'pf-adm-sub' }, 'Na pergunta: ', h('span', { class: 'pf-adm-strong' }, row.question.title)));
      body.push(excerpt(row.body));
      if (questionUrl(row.question_id, row.id)) link = openLink(questionUrl(row.question_id, row.id), 'Abrir a resposta');
      break;
    case 'message':
      title = `Mensagem de ${name}`;
      body.push(excerpt(row.body));
      if (row.created_at) body.push(h('p', { class: 'pf-adm-sub' }, `Enviada em ${formatDate(row.created_at, { dateStyle: 'medium', timeStyle: 'short' })}`));
      break;
    default:
      title = 'Item';
  }

  return h('div', { class: 'pf-adm-target' },
    h('div', { class: 'pf-adm-target-head' },
      decorativeAvatar(author?.avatar_path, name),
      h('p', { class: 'pf-adm-target-title' }, title),
      badges.length ? h('span', { class: 'pf-adm-badges' }, badges) : null),
    body,
    link);
}

function reportCard(r, index) {
  const k = tkey(r.target_type, r.target_id);
  const t = state.cache.targets.get(k) || { missing: true };
  const row = t.row || null;
  const authorId = authorOf(r.target_type, row);
  const author = authorId ? state.cache.profiles.get(authorId) : null;
  const titleId = `admRep${r.id}`;
  const [stLabel, stClass] = STATUS_BADGE[r.status] || [r.status, 'pf-badge--muted'];
  const info = typeInfo(r.target_type);
  const others = r.status === 'open' ? (state.cache.siblings.get(k) || []).filter((id) => id !== r.id) : [];
  const reporter = r.reporter_id ? nameOf(r.reporter_id) : 'Conta excluída';
  const when = formatDate(r.created_at, { dateStyle: 'medium', timeStyle: 'short' });

  const ctx = {
    what: info.what,
    name: authorId ? nameOf(authorId, 'este usuário') : 'este usuário',
  };
  const acts = actionsFor(r, row, authorId, author);
  const actionBar = acts.length
    ? h('div', { class: 'pf-adm-actions' }, acts.map((a) => {
      const def = ACTIONS[a.action];
      return h('button', {
        type: 'button',
        class: ['btn', 'btn-sm', def.danger ? 'btn-danger' : 'btn-ghost'],
        dataset: { action: a.action },
        onClick: () => confirmAction(r, a, ctx, index),
      }, def.label(r.target_type));
    }))
    : h('p', { class: 'pf-adm-noact pf-muted' }, 'Nenhuma ação disponível.');

  return h('li', { class: 'pf-adm-item' },
    h('article', { class: ['pf-adm-card', `is-${r.status}`], 'aria-labelledby': titleId, tabindex: '-1', dataset: { reportId: r.id } },
      h('header', { class: 'pf-adm-card-head' },
        h('h3', { class: 'pf-adm-card-title', id: titleId }, `${info.one} · denúncia #${r.id}`),
        h('span', { class: 'pf-adm-badges' },
          h('span', { class: ['pf-badge', stClass] }, stLabel),
          r.created_at ? h('time', { class: 'pf-adm-time', datetime: r.created_at, title: when }, timeAgo(r.created_at)) : null)),
      h('dl', { class: 'pf-adm-meta' },
        h('div', {}, h('dt', {}, 'Motivo'), h('dd', {}, reasonLabel(r.reason))),
        r.details ? h('div', {}, h('dt', {}, 'Detalhes'), h('dd', { class: 'pf-pre' }, r.details)) : null,
        h('div', {}, h('dt', {}, 'Denunciado por'), h('dd', {}, reporter, when ? ` · ${when}` : '')),
        r.resolved_at
          ? h('div', {}, h('dt', {}, r.status === 'dismissed' ? 'Descartada em' : 'Resolvida em'),
            h('dd', {}, formatDate(r.resolved_at, { dateStyle: 'medium', timeStyle: 'short' })))
          : null),
      targetPreview(r, t, authorId, author),
      others.length
        ? h('p', { class: 'pf-adm-others' }, `Há mais ${plural(others.length, 'denúncia aberta', 'denúncias abertas')} sobre este item.`)
        : null,
      actionBar));
}

function listTitle() {
  const st = STATUSES.find((s) => s.id === state.status) || STATUSES[0];
  const tp = state.type ? ` · ${typeInfo(state.type).label}` : '';
  return `${st.title}${tp}`;
}

function renderList() {
  ui.title.textContent = listTitle();
  if (!state.rows.length) {
    ui.list.replaceChildren(emptyState(
      state.status === 'open' && !state.type
        ? 'Nenhuma denúncia aberta. Tudo em dia!'
        : 'Nenhuma denúncia encontrada com estes filtros.',
      state.status !== 'all' || state.type ? { label: 'Ver todas as denúncias', onClick: () => setFilters({ status: 'all', type: '' }) } : undefined));
    ui.more.hidden = true;
    ui.live.textContent = 'Nenhuma denúncia encontrada.';
    return;
  }
  ui.list.replaceChildren(h('ol', { class: 'pf-adm-list' }, state.rows.map((r, i) => reportCard(r, i))));
  const hasMore = state.rows.length < state.total;
  ui.more.hidden = !hasMore;
  ui.live.textContent = `Mostrando ${state.rows.length} de ${plural(state.total, 'denúncia', 'denúncias')}.`;
}

function renderError(err) {
  ui.title.textContent = listTitle();
  ui.more.hidden = true;
  ui.live.textContent = '';
  ui.list.replaceChildren(h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' },
    h('h3', { class: 'pf-notice-title' }, 'Não foi possível carregar as denúncias'),
    h('p', {}, errorMsg(err)),
    h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => load() }, 'Tentar novamente'))));
}

function renderCounts() {
  for (const s of STATUSES) {
    const num = ui.chips[s.id]?.querySelector('.pf-adm-num');
    if (!num) continue;
    const n = state.counts[s.id];
    num.textContent = Number.isFinite(n) ? String(n) : '';
    num.hidden = !Number.isFinite(n);
  }
}

function syncFilterUi() {
  for (const s of STATUSES) ui.chips[s.id].setAttribute('aria-pressed', String(s.id === state.status));
  ui.type.value = state.type;
}

function setFilters({ status = state.status, type = state.type } = {}) {
  state.status = STATUSES.some((s) => s.id === status) ? status : 'open';
  state.type = TYPES.some((t) => t.id === type) ? type : '';
  qsSet({ status: state.status === 'open' ? null : state.status, tipo: state.type || null });
  syncFilterUi();
  state.rows = [];
  load();
}

function renderShell(body) {
  ui.chips = {};
  const chips = STATUSES.map((s) => {
    const chip = h('button', { type: 'button', class: 'pf-chip pf-adm-chip', 'aria-pressed': s.id === state.status },
      s.label, ' ', h('span', { class: 'pf-adm-num', hidden: true }));
    chip.addEventListener('click', () => {
      if (state.status !== s.id) setFilters({ status: s.id });
    });
    ui.chips[s.id] = chip;
    return chip;
  });

  ui.type = h('select', { id: 'admTipo', class: 'pf-select' },
    h('option', { value: '' }, 'Todos os tipos'),
    TYPES.map((t) => h('option', { value: t.id }, t.label)));
  ui.type.value = state.type;
  ui.type.addEventListener('change', () => setFilters({ type: ui.type.value }));

  const refresh = h('button', { type: 'button', class: 'btn btn-ghost btn-sm pf-adm-refresh' }, 'Atualizar');
  refresh.addEventListener('click', () => load({ keep: true }));

  ui.title = h('h2', { class: 'pf-section-title pf-adm-list-title', id: 'admListTitle', tabindex: '-1' }, listTitle());
  ui.live = h('p', { class: 'pf-adm-live', role: 'status', 'aria-live': 'polite' });
  ui.list = h('div', { class: 'pf-adm-results', 'aria-labelledby': 'admListTitle' });
  ui.moreBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Carregar mais');
  ui.moreBtn.addEventListener('click', loadMore);
  ui.more = h('div', { class: 'pf-adm-more', hidden: true }, ui.moreBtn);

  body.replaceChildren(
    h('p', { class: 'lead pf-adm-lead' },
      'Analise o item denunciado e decida: ocultar, suspender, banir ou descartar. Toda ação marca a denúncia como resolvida.'),
    h('section', { class: 'pf-adm-toolbar', 'aria-label': 'Filtros das denúncias' },
      h('div', { class: 'pf-adm-chips', role: 'group', 'aria-label': 'Situação' }, chips),
      h('div', { class: 'pf-adm-toolbar-end' },
        h('div', { class: 'pf-field pf-field-inline pf-adm-type' },
          h('label', { class: 'pf-label-sm', for: 'admTipo' }, 'Tipo'),
          ui.type),
        refresh)),
    h('section', { class: 'pf-adm-queue', 'aria-labelledby': 'admListTitle' },
      h('div', { class: 'pf-adm-queue-head' }, ui.title, ui.live),
      ui.list,
      ui.more));
}

// ---------- Início ----------

async function main() {
  initChrome();
  const body = document.getElementById('pageBody');
  if (!body) return;
  if (!isConfigured) {
    notConfiguredNotice(body);
    return;
  }
  let me;
  try {
    me = await requireAuth({ role: 'admin' });
  } catch (err) {
    body.replaceChildren(h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' },
      h('h2', { class: 'pf-notice-title' }, 'Não foi possível carregar'),
      h('p', {}, errorMsg(err)),
      h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => location.reload() }, 'Tentar novamente'))));
    return;
  }
  if (!me) return;
  state.me = me;

  const st = qsGet('status');
  const tp = qsGet('tipo');
  state.status = STATUSES.some((s) => s.id === st) ? st : 'open';
  state.type = TYPES.some((t) => t.id === tp) ? tp : '';

  renderShell(body);
  syncFilterUi();
  load();
}

main().catch((err) => {
  const body = document.getElementById('pageBody');
  if (body) body.replaceChildren(h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' }, h('p', {}, errorMsg(err))));
});
