/* ============================================
   Portal de professores — sessão, perfil e slot de login do nav
   ============================================ */

import { sb } from './supabase.js';
import { isConfigured } from './config.js';
import { h, avatarEl } from './ui.js';

const ENTRAR = '/professores/entrar.html';
const PAINEL = '/professores/painel.html';

// Cache em memória do perfil do usuário logado
let profileCache = null; // { uid, data }
let profileInflight = null; // { uid, promise }

/** Sessão atual do Supabase (ou null). Não faz requisição se não houver sessão salva. */
export async function getSession() {
  if (!isConfigured) return null;
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) return null;
    return data.session ?? null;
  } catch {
    return null;
  }
}

/** Usuário da sessão atual (ou null). A autorização real é feita pelo RLS no banco. */
export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

async function fetchProfile(user) {
  // tutor_profiles.user_id é PK e FK -> profiles: embed 1:1 (objeto ou null)
  const { data, error } = await sb
    .from('profiles')
    .select('*, tutor_profiles(*)')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const raw = data.tutor_profiles;
  const tutorRow = Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);
  return {
    ...data,
    email: user.email ?? null,
    tutor_profiles: tutorRow,
    tutor: data.role === 'tutor' ? tutorRow : null,
  };
}

/**
 * Perfil do usuário logado: linha de `profiles` (select '*, tutor_profiles(*)') + `email`
 * + `tutor` (linha de tutor_profiles se role = 'tutor', senão null).
 * Cache em memória; { force: true } recarrega.
 * @returns {Promise<object|null>} null se não houver sessão
 */
export async function getProfile({ force = false } = {}) {
  const user = await getUser();
  if (!user) {
    profileCache = null;
    return null;
  }
  if (!force && profileCache && profileCache.uid === user.id) return profileCache.data;
  if (!force && profileInflight && profileInflight.uid === user.id) return profileInflight.promise;

  const promise = fetchProfile(user)
    .then((data) => {
      profileCache = { uid: user.id, data };
      return data;
    })
    .finally(() => {
      if (profileInflight && profileInflight.promise === promise) profileInflight = null;
    });
  profileInflight = { uid: user.id, promise };
  return promise;
}

/** Limpa o cache do perfil (ex.: depois de salvar alterações). */
export function clearProfileCache() {
  profileCache = null;
  profileInflight = null;
}

// Mantém a aba/âncora (#plano, #avaliacoes) para voltar ao mesmo lugar depois do login.
// Só âncoras simples: hash com "=" (tokens, error_code) nunca vai para o next.
const PLAIN_HASH_RE = /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function currentPathForNext() {
  const hash = PLAIN_HASH_RE.test(location.hash) ? location.hash : '';
  return location.pathname + location.search + hash;
}

/** URL da página de login voltando para `next` depois. */
export function loginUrl(next = currentPathForNext()) {
  return `${ENTRAR}?next=${encodeURIComponent(next)}`;
}

// Promessa que nunca resolve: a página "para" enquanto o navegador redireciona
const halt = () => new Promise(() => {});

// ---------- Página privada: saiu ou trocou de conta (nesta ou em outra aba) ----------

let signingOut = false; // "Sair"/excluir conta desta aba: quem chamou já navega
let privateWatch = false;

/**
 * Depois do requireAuth: se a sessão acabar (Sair em outra aba, refresh token revogado)
 * vai para o login; se outra conta entrar (outra aba), recarrega. Assim os dados privados
 * do usuário anterior (mensagens, e-mail, pagamentos) não ficam na tela.
 * O supabase-js repassa SIGNED_IN/SIGNED_OUT entre abas por BroadcastChannel.
 */
function watchPrivatePage(uid) {
  if (privateWatch || !isConfigured) return;
  privateWatch = true;
  sb.auth.onAuthStateChange((event, session) => {
    if (signingOut) return;
    const other = session?.user?.id;
    if (event === 'SIGNED_OUT') {
      hidePrivateContent();
      setTimeout(() => location.replace(loginUrl()), 0);
    } else if (other && other !== uid) {
      hidePrivateContent();
      setTimeout(() => location.reload(), 0);
    }
  });
}

// Esconde o conteúdo já na hora (o redirecionamento pode demorar num aparelho lento)
function hidePrivateContent() {
  const main = document.querySelector('main');
  if (main) main.hidden = true;
  document.querySelectorAll('dialog[open]').forEach((d) => { try { d.close(); } catch { /* ignora */ } });
}

/**
 * Exige login. Sem sessão -> entrar.html?next=<página atual>.
 * role: 'student' | 'tutor' | 'admin' (admin checa profiles.is_admin); se não bater -> painel.
 * @returns {Promise<object|null>} o perfil (null se o portal não estiver configurado)
 */
export async function requireAuth({ role } = {}) {
  if (!isConfigured) return null;
  const session = await getSession();
  if (!session) {
    location.replace(loginUrl());
    return halt();
  }
  const profile = await getProfile();
  if (!profile) {
    // Sessão sem perfil (conta removida?): sai e volta ao login
    await signOut();
    location.replace(loginUrl());
    return halt();
  }
  const ok = !role || (role === 'admin' ? profile.is_admin === true : profile.role === role);
  if (!ok) {
    if (location.pathname !== PAINEL) location.replace(PAINEL);
    return halt();
  }
  watchPrivatePage(session.user?.id ?? profile.id);
  return profile;
}

// ---------- Slot de login no nav ----------

let unreadTimer = null;
let authListener = null;

function stopUnreadPolling() {
  if (unreadTimer) clearInterval(unreadTimer);
  unreadTimer = null;
  setUnreadBadges(0);
}

function setUnreadBadges(n) {
  document.querySelectorAll('[data-unread-badge]').forEach((b) => {
    b.textContent = n > 99 ? '99+' : String(n);
    b.hidden = !(n > 0);
  });
  document.querySelectorAll('[data-unread-link]').forEach((a) => {
    a.setAttribute('aria-label', n > 0 ? `Mensagens (${n} não lidas)` : 'Mensagens');
  });
  // Ponto no botão do menu mobile
  const toggle = document.getElementById('menuToggle');
  if (toggle) {
    if (n > 0) toggle.dataset.unread = '1';
    else delete toggle.dataset.unread;
  }
}

/** Atualiza o badge de mensagens não lidas (erros são ignorados). */
export async function refreshUnread() {
  try {
    const { data, error } = await sb.rpc('unread_count');
    if (!error) setUnreadBadges(Number(data) || 0);
  } catch {
    /* ignora: badge é só um extra */
  }
}

function startUnreadPolling() {
  stopUnreadPolling();
  refreshUnread();
  unreadTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshUnread();
  }, 60_000);
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'Minha conta';
}

function loggedOutItems(mobile) {
  const onEntrar = location.pathname === ENTRAR;
  const entrarHref = onEntrar ? ENTRAR : loginUrl();
  const cadastroHref = `${ENTRAR}?modo=cadastro&tipo=professor`;
  if (mobile) {
    return [
      h('a', { href: entrarHref }, 'Entrar'),
      h('a', { href: cadastroHref, class: 'mobile-cta' }, 'Sou professor'),
    ];
  }
  return [
    h('a', { href: entrarHref, class: 'nav-link' }, 'Entrar'),
    h('a', { href: cadastroHref, class: 'btn btn-primary pf-nav-cta' }, 'Sou professor'),
  ];
}

function loggedInItems(profile, mobile) {
  const name = profile?.full_name || '';
  const badge = () => h('span', { class: 'pf-count', 'data-unread-badge': '', hidden: true, 'aria-hidden': 'true' }, '0');
  const onSair = async () => {
    await signOut();
    location.href = '/professores/';
  };
  if (mobile) {
    return [
      h('a', { href: '/professores/mensagens.html', 'data-unread-link': '' }, 'Mensagens ', badge()),
      h('a', { href: PAINEL }, 'Meu painel'),
      h('button', { type: 'button', class: 'pf-mobile-btn', onClick: onSair }, 'Sair'),
    ];
  }
  return [
    h('a', { href: '/professores/mensagens.html', class: 'nav-link pf-nav-msg', 'data-unread-link': '' }, 'Mensagens', badge()),
    h('a', { href: PAINEL, class: 'nav-link pf-nav-user', 'aria-label': name ? `Meu painel (${name})` : 'Meu painel' },
      avatarEl(profile?.avatar_path, name, 26),
      h('span', { class: 'pf-nav-user-name' }, firstName(name))),
    h('button', { type: 'button', class: 'nav-link pf-nav-sair', onClick: onSair }, 'Sair'),
  ];
}

/**
 * Preenche #authSlot (nav) e #authSlotMobile (menu mobile).
 * Sem sessão: "Entrar" + "Sou professor". Com sessão: Mensagens (badge), Painel, Sair.
 */
export async function renderAuthSlot() {
  const slot = document.getElementById('authSlot');
  const slotMobile = document.getElementById('authSlotMobile');
  if (!slot && !slotMobile) return;

  const session = await getSession();
  if (!session) {
    stopUnreadPolling();
    slot?.replaceChildren(...loggedOutItems(false));
    slotMobile?.replaceChildren(...loggedOutItems(true));
  } else {
    let profile = null;
    try {
      profile = await getProfile();
    } catch {
      /* sem perfil: mostra o slot sem nome */
    }
    slot?.replaceChildren(...loggedInItems(profile, false));
    slotMobile?.replaceChildren(...loggedInItems(profile, true));
    startUnreadPolling();
  }

  // Login/logout em outra aba ou nesta página -> redesenha
  if (isConfigured && !authListener) {
    const { data } = sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        if (event === 'SIGNED_OUT') clearProfileCache();
        setTimeout(() => { renderAuthSlot().catch(() => {}); }, 0);
      }
    });
    authListener = data?.subscription ?? true;
  }
}

/** Sai da conta (erros ignorados) e limpa caches. */
export async function signOut() {
  signingOut = true; // esta aba navega sozinha depois (não redirecionar para o login)
  stopUnreadPolling();
  clearProfileCache();
  try {
    await sb.auth.signOut();
  } catch {
    /* sessão local é removida mesmo se a rede falhar */
  }
}
