/* ============================================
   Componente: aba "Conta" do painel (dono: moderação)
   E-mail da conta, alterar senha (sb.auth.updateUser), exportar dados
   (rpc export_my_data -> meus-dados-quanta.json) e excluir conta
   (digitar EXCLUIR -> POST fnUrl('delete-account') com Authorization Bearer -> sai -> início).
   ============================================ */

import '../../css/admin.css';
import { sb, fnUrl } from '../supabase.js';
import { SUPABASE_ANON_KEY } from '../config.js';
import { getUser, signOut, loginUrl } from '../auth.js';
import { h, modal, errorMsg, formatDate } from '../ui.js';

export const EXPORT_FILENAME = 'meus-dados-quanta.json';
const CONFIRM_WORD = 'EXCLUIR';
const PRIVACIDADE = '/professores/privacidade.html';
const HOME = '/professores/';

let seq = 0;
const uid = (name) => `pfAcct${name}${++seq}`;

/**
 * Alterar senha (sb.auth.updateUser), exportar dados (rpc export_my_data -> download JSON),
 * excluir conta (digitar EXCLUIR -> POST fnUrl('delete-account') com Authorization Bearer).
 * @param {HTMLElement} container
 * @param {{ profile: object }} opts  profile = auth.getProfile()
 * @returns {void}
 */
export function mountAccountTab(container, { profile } = {}) {
  if (!container) return;
  container.replaceChildren(h('div', { class: 'pf-acct' },
    accessSection(profile),
    passwordSection(),
    exportSection(),
    deleteSection(profile)));
}

function section(title, cls, ...children) {
  const id = uid('T');
  return h('section', { class: ['pf-panel', 'pf-acct-section', cls], 'aria-labelledby': id },
    h('h2', { class: 'pf-acct-title', id }, title),
    ...children);
}

// Mensagem de resultado (anunciada por leitores de tela)
function statusLine() {
  const el = h('p', { class: 'pf-acct-msg', role: 'status', 'aria-live': 'polite' });
  el.set = (text, kind = 'info') => {
    el.textContent = text || '';
    el.className = `pf-acct-msg is-${kind}`;
  };
  return el;
}

// ---------- Dados de acesso ----------

function accessSection(profile) {
  const email = h('strong', { class: 'pf-acct-email' }, profile?.email || 'carregando…');
  if (!profile?.email) {
    getUser()
      .then((u) => { email.textContent = u?.email || 'não disponível'; })
      .catch(() => { email.textContent = 'não disponível'; });
  }
  const since = formatDate(profile?.created_at, { day: 'numeric', month: 'long', year: 'numeric' });
  return section('Dados de acesso', 'pf-acct-access',
    h('p', { class: 'pf-acct-line' }, 'E-mail: ', email),
    since ? h('p', { class: 'pf-acct-line pf-muted' }, `Conta criada em ${since}.`) : null,
    h('p', { class: 'pf-hint' }, 'Você usa este e-mail para entrar e para receber os avisos de mensagens novas.'));
}

// ---------- Alterar senha ----------

function passwordField(label, autocomplete, hintText) {
  const id = uid('Pw');
  const hintId = hintText ? `${id}h` : null;
  const errId = `${id}e`;
  const input = h('input', {
    id, type: 'password', class: 'pf-input', autocomplete, required: true, minlength: 8, maxlength: 72,
    'aria-describedby': [hintId, errId].filter(Boolean).join(' '),
  });
  const err = h('p', { class: 'pf-error', id: errId, hidden: true });
  const wrap = h('div', { class: 'pf-field' },
    h('label', { class: 'pf-label', for: id }, label),
    input,
    hintText ? h('p', { class: 'pf-hint', id: hintId }, hintText) : null,
    err);
  const setError = (msg) => {
    err.textContent = msg || '';
    err.hidden = !msg;
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  input.addEventListener('input', () => setError(''));
  return { wrap, input, setError };
}

function passwordError(err) {
  const code = String(err?.code || '');
  if (code === 'reauthentication_needed' || code === 'reauth_nonce_missing' || /reauthenticat/i.test(err?.message || '')) {
    return 'Por segurança, saia e entre de novo antes de trocar a senha.';
  }
  if (code === 'weak_password') return 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números (evite senhas óbvias).';
  return errorMsg(err);
}

function passwordSection() {
  const pw1 = passwordField('Nova senha', 'new-password', 'Mínimo de 8 caracteres, com letras e números.');
  const pw2 = passwordField('Repita a nova senha', 'new-password');
  const showId = uid('Show');
  const show = h('input', { type: 'checkbox', id: showId });
  show.addEventListener('change', () => {
    const type = show.checked ? 'text' : 'password';
    pw1.input.type = type;
    pw2.input.type = type;
  });
  const status = statusLine();
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Salvar nova senha');

  const form = h('form', { class: 'pf-form pf-acct-form', novalidate: true, 'aria-label': 'Alterar senha' },
    pw1.wrap, pw2.wrap,
    h('label', { class: 'pf-check', for: showId }, show, 'Mostrar senhas'),
    h('div', { class: 'pf-form-actions' }, btn),
    status);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    const a = pw1.input.value;
    const b = pw2.input.value;
    let first = null;
    if (a.length < 8) { pw1.setError('A senha precisa ter pelo menos 8 caracteres.'); first = pw1.input; }
    else if (!/[A-Za-zÀ-ÿ]/.test(a) || !/\d/.test(a)) { pw1.setError('Use letras e números na senha.'); first = pw1.input; }
    if (!first && a !== b) { pw2.setError('As senhas não são iguais.'); first = pw2.input; }
    if (first) {
      status.set('');
      first.focus();
      return;
    }
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    status.set('Salvando…');
    try {
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) throw error;
      form.reset();
      pw1.input.type = 'password';
      pw2.input.type = 'password';
      status.set('Senha alterada. Use a nova senha no próximo acesso.', 'ok');
    } catch (err) {
      status.set(passwordError(err), 'erro');
      if (String(err?.code) === 'weak_password' || String(err?.code) === 'same_password') pw1.input.focus();
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  });

  return section('Alterar senha', 'pf-acct-password', form);
}

// ---------- Exportar dados (LGPD) ----------

/** Baixa `data` como arquivo JSON (UTF-8, indentado). */
export function downloadJson(data, filename = EXPORT_FILENAME) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function exportSection() {
  const status = statusLine();
  const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Exportar meus dados');
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    status.set('Preparando o arquivo…');
    try {
      const { data, error } = await sb.rpc('export_my_data');
      if (error) throw error;
      if (data == null) throw new Error('Nenhum dado retornado.');
      downloadJson(data, EXPORT_FILENAME);
      status.set(`Pronto! O arquivo ${EXPORT_FILENAME} foi baixado.`, 'ok');
    } catch (err) {
      status.set(errorMsg(err), 'erro');
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  });
  return section('Seus dados', 'pf-acct-export',
    h('p', {}, 'Baixe uma cópia dos seus dados: perfil, anúncio de professor, matérias, mensagens, avaliações, dúvidas, respostas, pagamentos e denúncias feitas por você, em formato JSON.'),
    h('div', { class: 'pf-form-actions' }, btn),
    status,
    h('p', { class: 'pf-hint' },
      'Saiba como tratamos seus dados e quais são os seus direitos (LGPD) na ',
      h('a', { href: `${PRIVACIDADE}#direitos` }, 'Política de Privacidade'),
      '.'));
}

// ---------- Excluir conta ----------

function activePaidPlan(profile) {
  const t = profile?.tutor || profile?.tutor_profiles;
  if (!t || !t.plan || t.plan === 'basico' || !t.plan_expires_at) return null;
  const exp = new Date(t.plan_expires_at);
  if (!(exp.getTime() > Date.now())) return null;
  return { plan: t.plan === 'premium' ? 'Premium' : 'Profissional', until: formatDate(t.plan_expires_at) };
}

function deleteSection(profile) {
  const paid = activePaidPlan(profile);
  const btn = h('button', { type: 'button', class: 'btn btn-danger btn-sm' }, 'Excluir minha conta');
  btn.addEventListener('click', () => openDeleteModal(profile));
  return section('Excluir conta', 'pf-acct-delete',
    h('p', {}, `Apaga sua conta de forma definitiva, com perfil, ${profile?.role === 'tutor' ? 'anúncio de professor, ' : ''}foto, conversas, avaliações, perguntas e respostas. Os registros de pagamento são mantidos sem vínculo com você, pelo prazo exigido por lei.`),
    paid ? h('p', { class: 'pf-acct-warn' }, `Seu plano ${paid.plan} (válido até ${paid.until}) deixa de valer.`) : null,
    h('p', { class: 'pf-muted' }, 'Esta ação não pode ser desfeita. Se quiser, exporte seus dados antes.'),
    h('div', { class: 'pf-form-actions' }, btn));
}

function openDeleteModal(profile) {
  const id = uid('Del');
  const errId = `${id}e`;
  const hintId = `${id}h`;
  const input = h('input', {
    id, type: 'text', class: 'pf-input', autocomplete: 'off', autocapitalize: 'characters', spellcheck: false,
    'aria-describedby': `${hintId} ${errId}`,
  });
  const err = h('p', { class: 'pf-error', id: errId, hidden: true });
  const status = statusLine();
  const setErr = (msg) => {
    err.textContent = msg || '';
    err.hidden = !msg;
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  input.addEventListener('input', () => setErr(''));
  const paid = activePaidPlan(profile);

  const content = h('div', { class: 'pf-form pf-acct-delete-form' },
    h('p', {}, 'Todos os seus dados serão apagados definitivamente e você sairá da conta. Esta ação não pode ser desfeita.'),
    paid ? h('p', { class: 'pf-acct-warn' }, `Seu plano ${paid.plan} (válido até ${paid.until}) deixa de valer.`) : null,
    h('div', { class: 'pf-field' },
      h('label', { class: 'pf-label', for: id }, `Para confirmar, digite ${CONFIRM_WORD}`),
      input,
      h('p', { class: 'pf-hint', id: hintId }, `Digite a palavra ${CONFIRM_WORD} no campo acima.`),
      err),
    status);

  let done = false;
  modal({
    title: 'Excluir conta',
    content,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Excluir conta definitivamente',
        danger: true,
        onClick: async () => {
          if (done) return false;
          if (input.value.trim().toUpperCase() !== CONFIRM_WORD) {
            setErr(`Digite ${CONFIRM_WORD} para confirmar.`);
            input.focus();
            return false;
          }
          status.set('Excluindo sua conta…');
          const { data } = await sb.auth.getSession();
          const session = data?.session;
          if (!session?.access_token) {
            location.href = loginUrl();
            return false;
          }
          let res;
          try {
            res = await fetch(fnUrl('delete-account'), {
              method: 'POST',
              headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY },
            });
          } catch {
            status.set('Sem conexão com o servidor. Verifique sua internet e tente de novo.', 'erro');
            return false;
          }
          if (!res.ok) {
            let msg = '';
            try {
              const body = await res.json();
              if (body && typeof body.error === 'string') msg = body.error;
            } catch { /* corpo não é JSON */ }
            if (!msg) {
              msg = res.status === 401
                ? 'Sua sessão expirou. Entre novamente e tente de novo.'
                : 'Não foi possível excluir a conta agora. Tente novamente.';
            }
            status.set(msg, 'erro');
            return false;
          }
          done = true;
          status.set('Conta excluída. Até logo!', 'ok');
          await signOut();
          location.href = HOME;
          return false; // a página está saindo; o modal fica até lá
        },
      },
    ],
  });
}
