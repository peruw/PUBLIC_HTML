/* ============================================
   Página: Entrar / criar conta / recuperar senha / nova senha (dono: contas)
   Modos: ?modo=entrar | cadastro | esqueci | nova-senha   Tipo: ?tipo=professor | aluno
   Volta para ?next= depois do login (só caminhos /professores/ deste site).

   Fluxo PKCE (supabase.js): os links de e-mail voltam como ?code=..., que o supabase-js
   troca por sessão sozinho ao iniciar — e só no MESMO navegador que pediu o link.
   Esta página nunca lê #access_token / type=recovery do endereço (só ?error_code para avisos).
   ============================================ */

import '../../css/contas.css';
import { sb } from '../supabase.js';
import { isConfigured, SITE_URL } from '../config.js';
import { initChrome, h, toast, errorMsg, qsGet, notConfiguredNotice } from '../ui.js';
import { getSession } from '../auth.js';

const ENTRAR = '/professores/entrar.html';
const PAINEL = '/professores/painel.html';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_COOLDOWN = 60; // segundos

const MODES = ['entrar', 'cadastro', 'esqueci', 'nova-senha'];

const params = new URLSearchParams(location.search);
const mode = MODES.includes(params.get('modo')) ? params.get('modo') : 'entrar';
const tipo = params.get('tipo') === 'professor' ? 'tutor' : 'student';

// ---------- Redirecionamento seguro ----------

/**
 * Destino depois do login: só caminhos deste site dentro de /professores/
 * (rejeita //evil.com, https://evil.com, /\evil.com, javascript:, ../ e a própria entrar.html).
 */
function safeNext(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/professores/')) return PAINEL;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return PAINEL;
  try {
    const url = new URL(raw, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith('/professores/')) return PAINEL;
    if (url.pathname === ENTRAR) return PAINEL;
    return url.pathname + url.search + url.hash;
  } catch {
    return PAINEL;
  }
}

const nextPath = safeNext(params.get('next'));

// Base dos links de e-mail: o endereço oficial do site (dev/testes em localhost usam a origem local).
// O Supabase só aceita redirect para o host do Site URL ou para URLs da lista de Redirect URLs.
function siteBase() {
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? location.origin : SITE_URL;
}

/**
 * Destino depois do cadastro: o ?next= válido (ex.: /professores/p/<slug>#mensagem de quem
 * clicou "Enviar mensagem" sem conta), senão `fallback`. Sem isso o novo aluno perde o professor.
 */
function signupNext(fallback) {
  const raw = params.get('next');
  return raw && safeNext(raw) === raw ? raw : fallback;
}

function confirmRedirect() {
  const next = signupNext(`${PAINEL}?bemvindo=1`);
  return `${siteBase()}${ENTRAR}?modo=entrar&confirmado=1&next=${encodeURIComponent(next)}`;
}

function recoveryRedirect() {
  return `${siteBase()}${ENTRAR}?modo=nova-senha`;
}

/** Link para outro modo mantendo tipo e next. */
function modeHref(m, extra = {}) {
  const p = new URLSearchParams();
  if (m !== 'entrar') p.set('modo', m);
  if (tipo === 'tutor') p.set('tipo', 'professor');
  const rawNext = params.get('next');
  if (rawNext && safeNext(rawNext) === rawNext) p.set('next', rawNext);
  for (const [k, v] of Object.entries(extra)) if (v != null) p.set(k, v);
  const qs = p.toString();
  return qs ? `${ENTRAR}?${qs}` : ENTRAR;
}

// ---------- Erros vindos do link de e-mail (?error_code=... ou #error_code=...) ----------

function linkError() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const code = params.get('error_code') || hash.get('error_code');
  const err = params.get('error') || hash.get('error');
  if (!code && !err) return null;
  if (code === 'otp_expired') return 'Este link expirou ou já foi usado. Peça um novo abaixo.';
  if (code === 'flow_state_expired' || code === 'flow_state_not_found') {
    return 'Este link não é mais válido. Peça um novo e abra-o neste mesmo navegador.';
  }
  return 'Não foi possível validar o link do e-mail. Peça um novo.';
}

// Tira do endereço os parâmetros de uso único (code, erros), mantendo modo/tipo/next
function cleanUrl() {
  const p = new URLSearchParams(location.search);
  ['code', 'sb_flow_id', 'error', 'error_code', 'error_description', 'confirmado'].forEach((k) => p.delete(k));
  const qs = p.toString();
  history.replaceState(history.state, '', location.pathname + (qs ? `?${qs}` : ''));
}

// ---------- Helpers de formulário ----------

let fieldSeq = 0;

/**
 * Campo com rótulo, dica e mensagem de erro ligados por aria-describedby.
 * @returns {{ wrap: HTMLElement, input: HTMLInputElement, setError: (msg?: string) => void }}
 */
// (todos os campos destas telas são obrigatórios: sem asterisco, com "required")
function field({ label, type = 'text', name, autocomplete, hint, maxlength, inputmode, value, required = true, password = false }) {
  const id = `pfIn${++fieldSeq}`;
  const hintId = hint ? `${id}-hint` : null;
  const errId = `${id}-err`;
  const input = h('input', {
    id, name, type, autocomplete, maxlength, inputmode, required,
    class: 'pf-input',
    'aria-describedby': [hintId, errId].filter(Boolean).join(' '),
    'aria-invalid': false,
    value: value ?? '',
  });
  const err = h('p', { class: 'pf-error', id: errId, hidden: true });
  let control = input;
  if (password) {
    const btn = h('button', { type: 'button', class: 'pf-pass-toggle', 'aria-controls': id, 'aria-pressed': false }, 'Mostrar');
    btn.setAttribute('aria-label', 'Mostrar senha');
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Ocultar' : 'Mostrar';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
    });
    control = h('div', { class: 'pf-pass' }, input, btn);
  }
  const wrap = h('div', { class: 'pf-field' },
    h('label', { class: 'pf-label', for: id }, label),
    control,
    hint ? h('p', { class: 'pf-hint', id: hintId }, hint) : null,
    err);
  const setError = (msg) => {
    err.textContent = msg || '';
    err.hidden = !msg;
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    wrap.classList.toggle('is-invalid', Boolean(msg));
  };
  input.addEventListener('input', () => { if (!err.hidden) setError(''); });
  return { wrap, input, setError };
}

/** Foca um campo mostrando também o rótulo (o nav fixo cobriria o topo). */
function focusField(el) {
  if (!el) return;
  const box = el.closest('.pf-field, .pf-fieldset') || el;
  const r = box.getBoundingClientRect();
  if (r.top < 96 || r.bottom > window.innerHeight) box.scrollIntoView({ block: 'center' });
  el.focus({ preventScroll: true });
}

function submitButton(label) {
  return h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, label);
}

function setBusy(btn, busy, busyLabel) {
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.textContent = busyLabel;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  } else {
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

/** Região de erro do formulário (anunciada na hora). */
function alertBox() {
  return h('div', { class: 'pf-form-alert', role: 'alert', 'aria-live': 'assertive' });
}

/** Região de aviso positivo (anunciada com calma). */
function okBox(text = '') {
  return h('div', { class: 'pf-form-ok', role: 'status', 'aria-live': 'polite' }, text);
}

function authErrorText(err) {
  const code = err?.code || '';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(err?.message || '')) {
    return 'E-mail ou senha incorretos. Confira os dados ou recupere sua senha.';
  }
  if (code === 'weak_password') {
    return 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números (evite senhas óbvias).';
  }
  if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(err?.message || '')) {
    return 'Muitos e-mails enviados em pouco tempo. Aguarde alguns minutos e tente de novo.';
  }
  if (code === 'over_request_rate_limit' || err?.status === 429) {
    return 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.';
  }
  return errorMsg(err);
}

function isNotConfirmed(err) {
  return err?.code === 'email_not_confirmed' || /email not confirmed/i.test(err?.message || '');
}

/** Botão "Reenviar e-mail" com espera entre envios. */
function resendButton(email, { label = 'Reenviar e-mail de confirmação', ghost = true } = {}) {
  const btn = h('button', { type: 'button', class: ['btn', 'btn-sm', ghost ? 'btn-ghost' : 'btn-primary'] }, label);
  const status = h('p', { class: 'pf-hint', role: 'status', 'aria-live': 'polite' });
  let timer = null;
  const cooldown = (secs) => {
    btn.disabled = true;
    let left = secs;
    btn.textContent = `Reenviar em ${left} s`;
    clearInterval(timer);
    timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = label;
      } else {
        btn.textContent = `Reenviar em ${left} s`;
      }
    }, 1000);
  };
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = 'Enviando…';
    try {
      const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: confirmRedirect() } });
      if (error) throw error;
      status.textContent = 'E-mail reenviado. Confira também a caixa de spam.';
      cooldown(RESEND_COOLDOWN);
    } catch (err) {
      status.textContent = authErrorText(err);
      btn.disabled = false;
    }
  });
  return h('div', { class: 'pf-stack', style: { gap: '8px' } }, btn, status);
}

// ---------- Cabeçalho da página ----------

const HEADS = {
  entrar: ['Entrar', 'Acesse sua conta de aluno ou professor.'],
  cadastro: tipo === 'tutor'
    ? ['Criar conta de professor', 'Crie seu anúncio grátis e seja encontrado por alunos de todo o Brasil.']
    : ['Criar conta', 'É grátis: converse com professores, avalie aulas e tire dúvidas.'],
  esqueci: ['Recuperar senha', 'Enviaremos um link para você criar uma nova senha.'],
  'nova-senha': ['Nova senha', 'Escolha uma nova senha para sua conta.'],
};

function setHead() {
  const [title, lead] = HEADS[mode];
  const h1 = document.querySelector('.pf-page-head .pf-title');
  const p = document.querySelector('.pf-page-head .lead');
  if (h1) h1.textContent = title;
  if (p) p.textContent = lead;
  document.title = `${title} — Professores | Quanta Aulas`;
}

function modeSwitch() {
  const link = (m, label) => h('a', { href: modeHref(m), 'aria-current': mode === m ? 'page' : null }, label);
  return h('nav', { class: 'pf-auth-switch', 'aria-label': 'Entrar ou criar conta' },
    link('entrar', 'Entrar'), link('cadastro', 'Criar conta'));
}

function aside(role = tipo) {
  if (role === 'tutor') {
    return h('aside', { class: 'pf-auth-aside', 'aria-label': 'Vantagens para professores' },
      h('div', { class: 'eyebrow' }, 'Para professores'),
      h('h2', {}, 'Divulgue suas aulas para quem está procurando'),
      h('ul', { class: 'pf-benefits' },
        h('li', {}, h('span', {}, h('strong', {}, 'Anúncio grátis'), ' com foto, apresentação, preço e matérias.')),
        h('li', {}, h('span', {}, h('strong', {}, 'Alunos falam direto com você'), ' pelas mensagens do portal, sem intermediários.')),
        h('li', {}, h('span', {}, h('strong', {}, 'Você combina tudo:'), ' valor, horários e forma de pagamento das aulas.')),
        h('li', {}, h('span', {}, h('strong', {}, 'Mostre o que sabe'), ' respondendo dúvidas no tira-dúvidas.'))));
  }
  return h('aside', { class: 'pf-auth-aside', 'aria-label': 'Vantagens para alunos' },
    h('div', { class: 'eyebrow' }, 'Para alunos'),
    h('h2', {}, 'Encontre o professor certo para você'),
    h('ul', { class: 'pf-benefits' },
      h('li', {}, h('span', {}, h('strong', {}, 'Busque por matéria e cidade'), ' ou encontre aulas online.')),
      h('li', {}, h('span', {}, h('strong', {}, 'Converse antes de contratar'), ' e combine tudo direto com o professor.')),
      h('li', {}, h('span', {}, h('strong', {}, 'Avaliações de alunos reais'), ' para escolher com segurança.')),
      h('li', {}, h('span', {}, h('strong', {}, 'Tira-dúvidas grátis'), ' respondido por professores.'))));
}

// ---------- Modo: entrar ----------

function renderLogin(card, notice) {
  const email = field({ label: 'E-mail', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email' });
  const pass = field({ label: 'Senha', type: 'password', name: 'password', autocomplete: 'current-password', password: true });
  const alert = alertBox();
  const extra = h('div');
  const btn = submitButton('Entrar');

  const form = h('form', { class: 'pf-form', novalidate: true, 'aria-label': 'Entrar' },
    email.wrap, pass.wrap, alert, extra, btn,
    h('div', { class: 'pf-auth-links' },
      h('a', { href: modeHref('esqueci') }, 'Esqueci minha senha'),
      h('a', { href: modeHref('cadastro') }, 'Criar conta grátis')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alert.textContent = '';
    extra.replaceChildren();
    email.setError('');
    pass.setError('');
    const em = email.input.value.trim();
    const pw = pass.input.value;
    let first = null;
    if (!EMAIL_RE.test(em)) { email.setError('Informe um e-mail válido.'); first ||= email.input; }
    if (!pw) { pass.setError('Informe sua senha.'); first ||= pass.input; }
    if (first) { focusField(first); return; }

    setBusy(btn, true, 'Entrando…');
    try {
      const { error } = await sb.auth.signInWithPassword({ email: em, password: pw });
      if (error) throw error;
      btn.textContent = 'Redirecionando…';
      location.replace(nextPath);
    } catch (err) {
      setBusy(btn, false);
      if (isNotConfirmed(err)) {
        alert.textContent = 'Você ainda não confirmou seu e-mail. Abra o link que enviamos (veja também o spam).';
        extra.replaceChildren(resendButton(em));
      } else {
        alert.textContent = authErrorText(err);
      }
      pass.input.select();
      pass.input.focus();
    }
  });

  card.append(modeSwitch(), notice, form);
}

// ---------- Modo: cadastro ----------

function renderSignup(card, notice) {
  const name = field({ label: 'Nome completo', name: 'name', autocomplete: 'name', maxlength: 80, hint: 'Nome e sobrenome. Aparece para os outros usuários de forma abreviada (ex.: Maria S.) — no anúncio de professor, completo.' });
  const email = field({ label: 'E-mail', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email' });
  const pass = field({ label: 'Senha', type: 'password', name: 'new-password', autocomplete: 'new-password', password: true, hint: 'Mínimo de 8 caracteres, com letras e números.' });

  const roleName = 'pfRole';
  const roleOpt = (value, title, desc) => h('label', { class: 'pf-role-option' },
    h('input', { type: 'radio', name: roleName, value, checked: tipo === value }),
    h('span', { class: 'pf-role-title' }, title),
    h('span', { class: 'pf-role-desc' }, desc));
  const roles = h('fieldset', { class: 'pf-fieldset' },
    h('legend', { class: 'pf-label' }, 'Você quer…'),
    h('div', { class: 'pf-role-options' },
      roleOpt('student', 'Aprender', 'Sou aluno ou responsável'),
      roleOpt('tutor', 'Dar aulas', 'Sou professor(a)')));

  const termsId = `pfIn${++fieldSeq}`;
  const termsErrId = `${termsId}-err`;
  const terms = h('input', { type: 'checkbox', id: termsId, name: 'terms', required: true, 'aria-describedby': termsErrId, 'aria-invalid': false });
  const termsErr = h('p', { class: 'pf-error', id: termsErrId, hidden: true });
  const termsLabel = h('label', { class: 'pf-check pf-terms-check', for: termsId },
    terms,
    h('span', {},
      'Li e aceito os ',
      h('a', { href: '/professores/termos.html', target: '_blank', rel: 'noopener' }, 'Termos de Uso'),
      ' e a ',
      h('a', { href: '/professores/privacidade.html', target: '_blank', rel: 'noopener' }, 'Política de Privacidade'),
      ' e declaro ter 18 anos ou mais, ou estar cadastrando com autorização do meu responsável legal'));
  const setTermsError = (msg) => {
    termsErr.textContent = msg || '';
    termsErr.hidden = !msg;
    terms.setAttribute('aria-invalid', msg ? 'true' : 'false');
    termsLabel.classList.toggle('is-invalid', Boolean(msg));
  };
  terms.addEventListener('change', () => { if (terms.checked) setTermsError(''); });

  // Trocar aluno/professor atualiza o título e a coluna de vantagens
  roles.addEventListener('change', () => {
    const role = form.querySelector(`input[name="${roleName}"]:checked`)?.value === 'tutor' ? 'tutor' : 'student';
    const h1 = document.querySelector('.pf-page-head .pf-title');
    if (h1) h1.textContent = role === 'tutor' ? 'Criar conta de professor' : 'Criar conta';
    const old = document.querySelector('.pf-auth-aside');
    if (old) old.replaceWith(aside(role));
  });

  const alert = alertBox();
  const btn = submitButton('Criar conta');
  const form = h('form', { class: 'pf-form', novalidate: true, 'aria-label': 'Criar conta' },
    roles, name.wrap, email.wrap, pass.wrap,
    h('div', { class: 'pf-field' }, termsLabel, termsErr),
    alert, btn,
    h('div', { class: 'pf-auth-links' },
      h('p', {}, 'Já tem conta? ', h('a', { href: modeHref('entrar') }, 'Entrar'))));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alert.textContent = '';
    [name, email, pass].forEach((f) => f.setError(''));
    setTermsError('');

    const fullName = name.input.value.replace(/\s+/g, ' ').trim();
    const em = email.input.value.trim();
    const pw = pass.input.value;
    const role = form.querySelector(`input[name="${roleName}"]:checked`)?.value === 'tutor' ? 'tutor' : 'student';

    let first = null;
    if (fullName.length < 2) { name.setError('Informe seu nome completo.'); first ||= name.input; }
    else if (fullName.length > 80) { name.setError('Use no máximo 80 caracteres.'); first ||= name.input; }
    if (!EMAIL_RE.test(em)) { email.setError('Informe um e-mail válido.'); first ||= email.input; }
    if (pw.length < 8) { pass.setError('A senha precisa ter pelo menos 8 caracteres.'); first ||= pass.input; }
    else if (!/[A-Za-zÀ-ÿ]/.test(pw) || !/\d/.test(pw)) { pass.setError('Use letras e números na senha.'); first ||= pass.input; }
    if (!terms.checked) { setTermsError('Para criar a conta, é preciso aceitar os Termos de Uso e a Política de Privacidade.'); first ||= terms; }
    if (first) { focusField(first); return; }

    setBusy(btn, true, 'Criando conta…');
    try {
      const { data, error } = await sb.auth.signUp({
        email: em,
        password: pw,
        options: {
          emailRedirectTo: confirmRedirect(),
          data: { full_name: fullName, role, accepted_terms: 'true' },
        },
      });
      if (error) throw error;
      if (data?.session) {
        // Confirmação de e-mail desligada no projeto: já entra
        location.replace(signupNext(`${PAINEL}${role === 'tutor' ? '#anuncio' : ''}`));
        return;
      }
      renderCheckEmail(card, em);
    } catch (err) {
      setBusy(btn, false);
      alert.textContent = authErrorText(err);
      if (err?.code === 'weak_password') focusField(pass.input);
    }
  });

  card.append(modeSwitch(), notice, form);
}

function renderCheckEmail(card, email) {
  const heading = h('h2', { class: 'pf-auth-heading', tabindex: '-1' }, 'Confirme seu e-mail');
  const done = h('div', { class: 'pf-auth-done' },
    h('span', { class: 'pf-auth-done-icon', 'aria-hidden': 'true' }, '✉'),
    heading,
    h('p', { role: 'status' }, 'Enviamos um link de confirmação para ', h('strong', {}, email), '. Abra o link para ativar sua conta.'),
    h('ul', {},
      h('li', {}, 'Abra o link neste mesmo navegador e aparelho.'),
      h('li', {}, 'Não chegou em alguns minutos? Veja as pastas de spam e promoções.'),
      h('li', {}, 'Se você já tinha conta com este e-mail, basta entrar ou recuperar a senha.')),
    resendButton(email, { label: 'Reenviar e-mail' }),
    h('div', { class: 'pf-auth-links' },
      h('a', { href: modeHref('entrar') }, 'Voltar para entrar'),
      h('a', { href: modeHref('esqueci') }, 'Esqueci minha senha')));
  card.replaceChildren(done);
  heading.focus();
}

// ---------- Modo: esqueci a senha ----------

function renderForgot(card, notice) {
  const email = field({ label: 'E-mail da conta', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email' });
  const alert = alertBox();
  const btn = submitButton('Enviar link');
  const form = h('form', { class: 'pf-form', novalidate: true, 'aria-label': 'Recuperar senha' },
    h('p', { class: 'pf-auth-sub' }, 'Informe o e-mail da sua conta. Se ele estiver cadastrado, você receberá um link para criar uma nova senha.'),
    email.wrap, alert, btn,
    h('div', { class: 'pf-auth-links' }, h('a', { href: modeHref('entrar') }, 'Voltar para entrar')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alert.textContent = '';
    email.setError('');
    const em = email.input.value.trim();
    if (!EMAIL_RE.test(em)) {
      email.setError('Informe um e-mail válido.');
      focusField(email.input);
      return;
    }
    setBusy(btn, true, 'Enviando…');
    try {
      const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: recoveryRedirect() });
      if (error) throw error;
      const heading = h('h2', { class: 'pf-auth-heading', tabindex: '-1' }, 'Verifique seu e-mail');
      card.replaceChildren(h('div', { class: 'pf-auth-done' },
        h('span', { class: 'pf-auth-done-icon', 'aria-hidden': 'true' }, '✉'),
        heading,
        h('p', { role: 'status' }, 'Se existir uma conta para ', h('strong', {}, em), ', enviamos um link para criar uma nova senha.'),
        h('ul', {},
          h('li', {}, 'O link vale por pouco tempo e só pode ser usado uma vez.'),
          h('li', {}, 'Abra-o neste mesmo navegador e aparelho.'),
          h('li', {}, 'Não chegou? Veja as pastas de spam e promoções.')),
        h('div', { class: 'pf-auth-links' }, h('a', { href: modeHref('entrar') }, 'Voltar para entrar'))));
      heading.focus();
    } catch (err) {
      setBusy(btn, false);
      alert.textContent = authErrorText(err);
    }
  });

  card.append(notice, form);
}

// ---------- Modo: nova senha (link de recuperação) ----------

function renderNewPassword(card, notice, session) {
  if (!session) {
    card.append(
      notice,
      h('div', { class: 'pf-notice pf-notice--warn', role: 'status' },
        h('h2', { class: 'pf-notice-title' }, 'Link inválido ou expirado'),
        h('p', {}, 'Para criar uma nova senha, abra o link mais recente que enviamos por e-mail, neste mesmo navegador. Os links valem por pouco tempo e funcionam uma única vez.')),
      h('a', { class: 'btn btn-primary btn-block', href: modeHref('esqueci') }, 'Pedir um novo link'),
      h('div', { class: 'pf-auth-links' }, h('a', { href: modeHref('entrar') }, 'Voltar para entrar')));
    return;
  }

  const pass = field({ label: 'Nova senha', type: 'password', name: 'new-password', autocomplete: 'new-password', password: true, hint: 'Mínimo de 8 caracteres, com letras e números.' });
  const pass2 = field({ label: 'Repita a nova senha', type: 'password', name: 'confirm-password', autocomplete: 'new-password', password: true });
  const alert = alertBox();
  const btn = submitButton('Salvar nova senha');
  const who = session.user?.email ? h('p', { class: 'pf-auth-sub' }, 'Conta: ', h('strong', {}, session.user.email)) : null;
  const form = h('form', { class: 'pf-form', novalidate: true, 'aria-label': 'Criar nova senha' }, who, pass.wrap, pass2.wrap, alert, btn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alert.textContent = '';
    pass.setError('');
    pass2.setError('');
    const pw = pass.input.value;
    let first = null;
    if (pw.length < 8) { pass.setError('A senha precisa ter pelo menos 8 caracteres.'); first ||= pass.input; }
    else if (!/[A-Za-zÀ-ÿ]/.test(pw) || !/\d/.test(pw)) { pass.setError('Use letras e números na senha.'); first ||= pass.input; }
    if (pass2.input.value !== pw) { pass2.setError('As senhas não conferem.'); first ||= pass2.input; }
    if (first) { focusField(first); return; }

    setBusy(btn, true, 'Salvando…');
    try {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;
      const heading = h('h2', { class: 'pf-auth-heading', tabindex: '-1' }, 'Senha alterada!');
      card.replaceChildren(h('div', { class: 'pf-auth-done' },
        h('span', { class: 'pf-auth-done-icon', 'aria-hidden': 'true' }, '✓'),
        heading,
        h('p', { role: 'status' }, 'Sua nova senha já está valendo. Use-a nos próximos acessos.'),
        h('a', { class: 'btn btn-primary btn-block', href: PAINEL }, 'Ir para o meu painel')));
      heading.focus();
      toast('Senha alterada com sucesso.', 'ok');
    } catch (err) {
      setBusy(btn, false);
      alert.textContent = authErrorText(err);
    }
  });

  card.append(notice, form);
}

// ---------- Início ----------

async function main() {
  initChrome();
  setHead();
  const body = document.getElementById('pageBody');
  if (!body) return;
  if (!isConfigured) {
    notConfiguredNotice(body);
    return;
  }

  // getSession() espera o supabase-js terminar de iniciar (inclui a troca do ?code= do link)
  const hadCode = params.has('code');
  const linkErr = linkError();
  const session = await getSession();

  if (session && (mode === 'entrar' || mode === 'cadastro')) {
    location.replace(nextPath);
    return;
  }

  // Aviso do topo do cartão (link de e-mail com erro ou já confirmado)
  const notice = okBox();
  if (linkErr) {
    notice.className = 'pf-form-alert';
    notice.setAttribute('role', 'alert');
    notice.textContent = linkErr;
  } else if (params.get('confirmado') === '1' && hadCode) {
    notice.textContent = 'E-mail confirmado! Agora entre com seu e-mail e senha.';
  }
  if (hadCode || linkErr || params.has('confirmado')) cleanUrl();

  const card = h('div', { class: 'pf-panel pf-auth-card' });
  body.replaceChildren(h('div', { class: 'pf-auth' }, card, aside()));

  if (mode === 'cadastro') renderSignup(card, notice);
  else if (mode === 'esqueci') renderForgot(card, notice);
  else if (mode === 'nova-senha') {
    renderNewPassword(card, notice, session);
    if (!session) {
      // Caso o evento chegue depois (troca do código ainda em andamento)
      const { data } = sb.auth.onAuthStateChange((event, s) => {
        if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && s) {
          data?.subscription?.unsubscribe();
          card.replaceChildren();
          renderNewPassword(card, okBox(), s);
        }
      });
    }
  } else renderLogin(card, notice);

  // Foco no primeiro campo (sem roubar foco de leitores de tela em avisos)
  if (!linkErr) card.querySelector('input:not([type=radio]):not([type=checkbox])')?.focus({ preventScroll: true });
}

main().catch((err) => {
  const body = document.getElementById('pageBody');
  if (body) {
    body.replaceChildren(h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' },
      h('h2', { class: 'pf-notice-title' }, 'Não foi possível carregar'),
      h('p', {}, errorMsg(err)),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => location.reload() }, 'Tentar novamente')));
  }
});
