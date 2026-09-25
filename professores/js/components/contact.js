/* ============================================
   Componente: botão "Enviar mensagem" no perfil (dono: mensagens)
   Sem login -> entrar.html?next=<perfil>#mensagem (volta e abre o formulário).
   Com login -> modal com a mensagem (10–4000 caracteres) e matéria opcional ->
   rpc start_conversation -> /professores/mensagens.html?c=<id>.
   O próprio professor não vê o botão (container fica vazio).
   ============================================ */

import '../../css/mensagens.css';
import { sb } from '../supabase.js';
import { isConfigured } from '../config.js';
import { getUser, loginUrl } from '../auth.js';
import { h, modal, toast, errorMsg } from '../ui.js';

const MIN_LEN = 10;
const MAX_LEN = 4000;
const AUTO_OPEN_HASH = '#mensagem';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rascunho por professor: fechar o modal sem querer não perde o texto
const drafts = new Map();
// Conversa já existente com o professor (uma consulta por professor, mesmo com 2 botões na página)
const existingConv = new Map();
let autoOpenDone = false;
let seq = 0;

const HINT = 'Resposta pelo site; seu contato não é exposto.';

function chatUrl(id) {
  return `/professores/mensagens.html?c=${encodeURIComponent(id)}`;
}

function lockIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'pf-contact-ico');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z');
  svg.appendChild(path);
  return svg;
}

function findExisting(tutorId, uid) {
  const key = `${uid}:${tutorId}`;
  if (!existingConv.has(key)) {
    const p = sb.from('conversations')
      .select('id')
      .eq('student_id', uid)
      .eq('tutor_id', tutorId)
      .maybeSingle()
      .then(({ data, error }) => (!error && data && UUID_RE.test(String(data.id)) ? String(data.id) : null))
      .catch(() => null);
    existingConv.set(key, p);
  }
  return existingConv.get(key);
}

/** Modal de nova mensagem. */
function openComposer({ tutorId, tutorName, subjects }) {
  const n = ++seq;
  const ids = { text: `pfContactText${n}`, subj: `pfContactSubj${n}`, count: `pfContactCount${n}`, help: `pfContactHelp${n}`, err: `pfContactErr${n}` };
  const name = tutorName || 'o professor';
  const validSubjects = (Array.isArray(subjects) ? subjects : [])
    .filter((s) => s && Number.isInteger(Number(s.id)) && s.name)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));

  const textarea = h('textarea', {
    id: ids.text,
    class: 'pf-textarea pf-contact-text',
    rows: 6,
    maxlength: MAX_LEN,
    required: true,
    placeholder: 'Ex.: Olá! Preciso de aulas de matemática para o ENEM, 2 vezes por semana, à noite. Você tem horários?',
    'aria-describedby': `${ids.help} ${ids.count}`,
    value: drafts.get(tutorId) || '',
  });
  const counter = h('span', { class: 'pf-counter', id: ids.count }, '');
  const errorBox = h('p', { class: 'pf-error', id: ids.err, role: 'alert' });
  const updateCounter = () => {
    counter.textContent = `${textarea.value.length}/${MAX_LEN}`;
  };
  updateCounter();
  textarea.addEventListener('input', () => {
    drafts.set(tutorId, textarea.value);
    updateCounter();
    if (errorBox.textContent && textarea.value.trim().length >= MIN_LEN) {
      errorBox.textContent = '';
      textarea.removeAttribute('aria-invalid');
    }
  });

  let select = null;
  if (validSubjects.length) {
    select = h('select', { id: ids.subj, class: 'pf-select' },
      h('option', { value: '' }, 'Não sei / várias'),
      validSubjects.map((s) => h('option', { value: String(s.id) }, String(s.name))));
  }

  const content = h('div', { class: 'pf-contact-form' },
    h('p', { class: 'pf-contact-intro' },
      'Conte o que você precisa: matéria, nível, objetivo e os dias e horários em que pode ter aula.'),
    h('div', { class: 'pf-field' },
      h('label', { class: 'pf-label', for: ids.text }, 'Sua mensagem ', h('span', { class: 'pf-req', 'aria-hidden': 'true' }, '*')),
      textarea,
      h('div', { class: 'pf-contact-meta' },
        h('span', { class: 'pf-hint', id: ids.help }, `Mínimo de ${MIN_LEN} caracteres.`),
        counter)),
    select ? h('div', { class: 'pf-field' },
      h('label', { class: 'pf-label', for: ids.subj }, 'Matéria (opcional)'),
      select) : null,
    errorBox,
    h('p', { class: 'pf-contact-hint pf-contact-hint--modal' }, lockIcon(),
      h('span', {}, `${HINT} Nunca compartilhe senhas ou códigos de verificação.`)));

  let done = false;
  const m = modal({
    title: `Mensagem para ${name}`,
    content,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Enviar',
        primary: true,
        onClick: async ({ button }) => {
          if (done) return false;
          const body = textarea.value.trim();
          errorBox.textContent = '';
          if (body.length < MIN_LEN) {
            errorBox.textContent = `Escreva pelo menos ${MIN_LEN} caracteres para o professor entender o que você precisa.`;
            textarea.setAttribute('aria-invalid', 'true');
            textarea.focus();
            return false;
          }
          if (body.length > MAX_LEN) {
            errorBox.textContent = `A mensagem pode ter até ${MAX_LEN} caracteres.`;
            textarea.setAttribute('aria-invalid', 'true');
            textarea.focus();
            return false;
          }
          textarea.removeAttribute('aria-invalid');
          const subj = select && select.value ? Number(select.value) : null;
          button.textContent = 'Enviando…';
          try {
            const { data, error } = await sb.rpc('start_conversation', {
              p_tutor: tutorId,
              p_body: body,
              p_subject: Number.isInteger(subj) ? subj : null,
            });
            if (error) throw error;
            const id = String(data ?? '');
            if (!UUID_RE.test(id)) throw new Error('resposta inválida');
            done = true;
            drafts.delete(tutorId);
            textarea.disabled = true;
            if (select) select.disabled = true;
            toast('Mensagem enviada! Abrindo a conversa…', 'ok');
            location.href = chatUrl(id);
            return false; // fica aberto até a próxima página carregar
          } catch (err) {
            if (err && err.status === 401) {
              errorBox.textContent = 'Sua sessão expirou. Entre novamente para enviar.';
            } else {
              errorBox.textContent = errorMsg(err);
            }
            return false;
          } finally {
            if (!done) button.textContent = 'Enviar';
          }
        },
      },
    ],
  });
  // O foco vai para a mensagem (e não para a matéria opcional)
  textarea.focus();
  const len = textarea.value.length;
  try { textarea.setSelectionRange(len, len); } catch { /* ok */ }
  return m;
}

/**
 * Monta o botão de contato com o professor.
 * Contrato: sem login -> entrar.html?next=<perfil>; se o usuário é o próprio professor não mostra;
 * modal com textarea (+ select opcional de matéria) ->
 * sb.rpc('start_conversation', { p_tutor, p_body, p_subject }) ->
 * location.href = '/professores/mensagens.html?c=' + id.
 * @param {HTMLElement} container
 * @param {{ tutorId: string, tutorName: string, subjects?: Array<{id:number,name:string}> }} opts
 * @returns {void}
 */
export function mountContactButton(container, { tutorId, tutorName, subjects = [] } = {}) {
  if (!container) return;
  if (!tutorId || !UUID_RE.test(String(tutorId))) {
    container.replaceChildren();
    return;
  }
  const opts = { tutorId: String(tutorId), tutorName: tutorName || '', subjects };

  const onClick = async () => {
    if (!isConfigured) {
      toast('O portal ainda está em configuração.', 'info');
      return;
    }
    btn.disabled = true;
    try {
      const user = await getUser();
      if (!user) {
        location.href = loginUrl(location.pathname + location.search + AUTO_OPEN_HASH);
        return;
      }
      if (user.id === opts.tutorId) {
        toast('Este é o seu perfil.', 'info');
        return;
      }
      openComposer(opts);
    } finally {
      btn.disabled = false;
    }
  };

  const btn = h('button', { type: 'button', class: 'btn btn-primary pf-contact-btn', onClick }, 'Enviar mensagem');
  const existingSlot = h('p', { class: 'pf-contact-existing', hidden: true });
  const hint = h('p', { class: 'pf-contact-hint' }, lockIcon(), h('span', {}, HINT));
  const wrap = h('div', { class: 'pf-contact' }, btn, hint, existingSlot);
  container.replaceChildren(wrap);

  if (!isConfigured) return;

  // Depois do login: o próprio professor não vê o botão; conversa existente ganha atalho
  getUser().then(async (user) => {
    if (!user || !wrap.isConnected) return;
    if (user.id === opts.tutorId) {
      container.replaceChildren();
      return;
    }
    // Voltou do login com #mensagem: abre o formulário uma vez
    if (location.hash === AUTO_OPEN_HASH && !autoOpenDone) {
      autoOpenDone = true;
      history.replaceState(history.state, '', location.pathname + location.search);
      openComposer(opts);
    }
    const convId = await findExisting(opts.tutorId, user.id);
    if (convId && wrap.isConnected) {
      existingSlot.replaceChildren(
        'Você já conversa com este professor. ',
        h('a', { href: chatUrl(convId) }, 'Abrir conversa'));
      existingSlot.hidden = false;
    }
  }).catch(() => { /* botão continua funcionando */ });
}
