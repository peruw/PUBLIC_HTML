/* ============================================
   Componente: botão "Denunciar" (dono: moderação)
   Modal com motivo + detalhes -> insert em `reports`.
   - SEM .select() depois do insert: quem denuncia não tem SELECT em reports (só admin lê);
     return=minimal evita o 42501 de RLS na leitura de volta.
   - Duplicado (unique reporter/tipo/alvo, 23505) -> "Você já denunciou este conteúdo".
   - Sem login -> entrar.html?next=<página atual>.
   ============================================ */

import '../../css/admin.css';
import { sb } from '../supabase.js';
import { getSession, loginUrl } from '../auth.js';
import { h, toast, modal, errorMsg } from '../ui.js';

/** Motivos (batem com o check de reports.reason). */
export const REPORT_REASONS = [
  { id: 'spam', label: 'Spam ou propaganda' },
  { id: 'ofensivo', label: 'Ofensivo, assédio ou discriminação' },
  { id: 'falso', label: 'Informação ou perfil falso' },
  { id: 'contato_externo', label: 'Divulga contato/pagamento fora da plataforma' },
  { id: 'menor_de_idade', label: 'Envolve menor de idade (risco ou uso sem responsável)' },
  { id: 'outro', label: 'Outro motivo' },
];

/** Rótulo de um motivo ('spam' -> 'Spam ou propaganda'). */
export function reasonLabel(id) {
  return REPORT_REASONS.find((r) => r.id === id)?.label || String(id || '');
}

// Tipos aceitos (check de reports.target_type) e como falar deles no modal
const WHAT = {
  tutor: 'este perfil',
  review: 'esta avaliação',
  question: 'esta pergunta',
  answer: 'esta resposta',
  message: 'esta mensagem',
};

export const REPORT_DETAILS_MAX = 1000;
const ALREADY = 'Você já denunciou este conteúdo. Nossa equipe vai analisar.';

// Denúncias feitas nesta página (evita abrir o modal de novo só para dar 23505)
const reported = new Set();
let seq = 0;

const SVG_NS = 'http://www.w3.org/2000/svg';

function flagIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', width: '14', height: '14', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false', class: 'pf-report-icon',
  })) svg.setAttribute(k, v);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M5 21V4m0 1h11.5l-2.25 4 2.25 4H5');
  svg.appendChild(path);
  return svg;
}

/**
 * Botão discreto (ícone de bandeira) que abre o modal de denúncia.
 * Contrato: exige login; modal com motivo + detalhes (≤1000); insere em `reports`
 * (target_type, target_id, reason, details); 23505 -> "Você já denunciou".
 * @param {{ type: 'tutor'|'review'|'question'|'answer'|'message', id: string|number, label?: string }} opts
 * @returns {HTMLButtonElement}
 */
export function reportButton({ type, id, label = 'Denunciar' } = {}) {
  const targetId = id == null ? '' : String(id);
  const valid = Object.prototype.hasOwnProperty.call(WHAT, type) && targetId.length >= 1 && targetId.length <= 64;
  const key = `${type}:${targetId}`;
  const btn = h('button', {
    type: 'button',
    class: ['pf-report-btn', reported.has(key) ? 'is-reported' : null],
    dataset: { reportType: type, reportId: targetId },
  }, flagIcon(), h('span', { class: 'pf-report-label' }, label));

  btn.addEventListener('click', async () => {
    if (!valid) {
      toast('Não foi possível denunciar este item.', 'erro');
      return;
    }
    if (reported.has(key)) {
      toast(ALREADY, 'info');
      return;
    }
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    let session = null;
    try {
      session = await getSession();
    } finally {
      btn.removeAttribute('aria-busy');
    }
    if (!session) {
      location.href = loginUrl();
      return;
    }
    openReportModal({ type, id: targetId, key, btn });
  });
  return btn;
}

function markReported(key) {
  reported.add(key);
  document.querySelectorAll('.pf-report-btn').forEach((b) => {
    if (`${b.dataset.reportType}:${b.dataset.reportId}` === key) b.classList.add('is-reported');
  });
}

function openReportModal({ type, id, key }) {
  const n = ++seq;
  const ids = { reason: `pfRep${n}r`, reasonErr: `pfRep${n}re`, details: `pfRep${n}d`, hint: `pfRep${n}h`, count: `pfRep${n}c`, detailsErr: `pfRep${n}de` };

  const reason = h('select', { id: ids.reason, class: 'pf-select', required: true, 'aria-describedby': ids.reasonErr },
    h('option', { value: '' }, 'Selecione um motivo'),
    REPORT_REASONS.map((r) => h('option', { value: r.id }, r.label)));
  const reasonErr = h('p', { class: 'pf-error', id: ids.reasonErr, hidden: true });

  const counter = h('span', { class: 'pf-counter', id: ids.count, 'aria-hidden': 'true' }, `0/${REPORT_DETAILS_MAX}`);
  const details = h('textarea', {
    id: ids.details, class: 'pf-textarea', rows: 4, maxlength: REPORT_DETAILS_MAX,
    'aria-describedby': `${ids.hint} ${ids.detailsErr}`,
    placeholder: 'Ex.: o que aconteceu, onde aparece o problema…',
  });
  const hint = h('p', { class: 'pf-hint', id: ids.hint }, `Opcional (obrigatório em "Outro motivo"). Até ${REPORT_DETAILS_MAX} caracteres.`);
  const detailsErr = h('p', { class: 'pf-error', id: ids.detailsErr, hidden: true });
  details.addEventListener('input', () => {
    counter.textContent = `${details.value.length}/${REPORT_DETAILS_MAX}`;
    setErr(details, detailsErr, '');
  });
  reason.addEventListener('change', () => setErr(reason, reasonErr, ''));

  const content = h('div', { class: 'pf-form pf-report-form' },
    h('p', { class: 'pf-report-intro' },
      `Conte o que há de errado com ${WHAT[type]}. A equipe do Quanta Aulas analisa cada denúncia, e a pessoa denunciada não fica sabendo quem denunciou.`),
    h('div', { class: 'pf-field' },
      h('label', { class: 'pf-label', for: ids.reason }, 'Motivo ', h('span', { class: 'pf-req', 'aria-hidden': 'true' }, '*')),
      reason, reasonErr),
    h('div', { class: 'pf-field' },
      h('label', { class: 'pf-label', for: ids.details }, 'Detalhes'),
      details,
      h('div', { class: 'pf-report-meta' }, hint, counter),
      detailsErr),
    h('p', { class: 'pf-hint' }, 'Em caso de risco imediato a alguém, procure as autoridades (190 ou Disque 100).'));

  modal({
    title: 'Denunciar',
    content,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Enviar denúncia',
        primary: true,
        onClick: async () => {
          const r = reason.value;
          const d = details.value.trim();
          let bad = null;
          if (!REPORT_REASONS.some((x) => x.id === r)) {
            setErr(reason, reasonErr, 'Escolha um motivo.');
            bad = bad || reason;
          }
          if (r === 'outro' && !d) {
            setErr(details, detailsErr, 'Descreva o motivo da denúncia.');
            bad = bad || details;
          } else if (d.length > REPORT_DETAILS_MAX) {
            setErr(details, detailsErr, `Use no máximo ${REPORT_DETAILS_MAX} caracteres.`);
            bad = bad || details;
          }
          if (bad) {
            bad.focus();
            return false;
          }
          // Sem .select(): o denunciante não pode ler reports (return=minimal)
          const { error } = await sb.from('reports').insert({ target_type: type, target_id: id, reason: r, details: d });
          if (error) {
            if (String(error.code) === '23505') {
              markReported(key);
              toast(ALREADY, 'info');
              return true;
            }
            toast(errorMsg(error), 'erro');
            return false;
          }
          markReported(key);
          toast('Denúncia enviada. Obrigado por ajudar a manter o portal seguro!', 'ok');
          return true;
        },
      },
    ],
  });
}

function setErr(input, box, msg) {
  box.textContent = msg;
  box.hidden = !msg;
  if (msg) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}
