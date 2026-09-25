/* ============================================
   Página: perfil público do professor (dono: busca-perfil)
   URL: /professores/p/<slug> (rewrite para perfil.html) ou /professores/perfil.html?u=<slug>
   Conteúdo do professor entra SÓ como texto (h()/textContent).
   ============================================ */

import '../../css/perfil.css';
import { sb, avatarPublicUrl } from '../supabase.js';
import { isConfigured, SITE_URL } from '../config.js';
import {
  initChrome, h, brl, starsEl, avatarEl, planBadge, errorMsg, notConfiguredNotice, formatDate, timeAgo, SUBJECT_LEVELS,
} from '../ui.js';
import { getUser } from '../auth.js';
import { mountContactButton } from '../components/contact.js';
import { mountReviews } from '../components/reviews.js';
import { mountTutorAnswers } from '../components/tutor-answers.js';
import { reportButton } from '../components/report.js';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PRETTY_RE = /^\/professores\/p\/([a-z0-9-]+)\/?$/;
const TITLE_SUFFIX = ' — Professores | Quanta Aulas';
const DEFAULT_IMAGE = `${SITE_URL}/assets/preview.jpg`;
const LEVEL_LABEL = new Map(SUBJECT_LEVELS.map((l) => [l.id, l.label]));

// tutor_profiles -> profiles pela FK user_id (hint explícito evita ambiguidade de embed)
const SELECT = [
  'user_id', 'slug', 'headline', 'bio', 'hourly_rate_cents', 'mode_online', 'mode_presencial', 'uf', 'city_name',
  'published', 'suspended', 'plan', 'plan_expires_at', 'rating_avg', 'rating_count', 'last_active_at', 'created_at',
  'profiles!user_id(full_name,avatar_path)',
  'tutor_subjects(levels,subjects(id,name,slug))',
].join(',');

const $ = (id) => document.getElementById(id);
let root = null;
let ctaBar = null;
let ratingBadge = null; // nota/“Novo no portal”/“Sem avaliações ainda” no cabeçalho
let tutorSince = null; // created_at do anúncio (decide entre “Novo no portal” e “Sem avaliações ainda”)
const NEW_DAYS = 30;

// ---------- Slug ----------

/** Slug da URL (/professores/p/<slug> ou ?u=<slug>); inválido -> null. */
function getSlug() {
  const m = location.pathname.match(PRETTY_RE);
  const raw = m ? m[1] : (new URLSearchParams(location.search).get('u') || '');
  const slug = String(raw).trim().toLowerCase();
  return SLUG_RE.test(slug) && slug.length >= 3 && slug.length <= 60 ? slug : null;
}

// ---------- Dados ----------

const one = (v) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function effectivePlan(plan, expires) {
  if (!plan || plan === 'basico' || !expires) return 'basico';
  const t = new Date(expires).getTime();
  return Number.isFinite(t) && t > Date.now() ? plan : 'basico';
}

function normalize(row) {
  const prof = one(row.profiles);
  const subjects = (Array.isArray(row.tutor_subjects) ? row.tutor_subjects : [])
    .map((ts) => {
      const s = one(ts?.subjects);
      if (!s || s.id == null || !s.name) return null;
      const levels = (Array.isArray(ts.levels) ? ts.levels : []).filter((l) => LEVEL_LABEL.has(l));
      return { id: Number(s.id), name: String(s.name), slug: String(s.slug || ''), levels };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const count = Number(row.rating_count) || 0;
  return {
    userId: String(row.user_id),
    slug: String(row.slug),
    name: String(prof?.full_name || '').trim() || 'Professor',
    avatarPath: prof?.avatar_path ?? null,
    headline: String(row.headline || '').trim(),
    bio: String(row.bio || '').trim(),
    price: row.hourly_rate_cents == null ? null : Number(row.hourly_rate_cents),
    online: Boolean(row.mode_online),
    presencial: Boolean(row.mode_presencial),
    uf: row.uf ? String(row.uf).trim() : '',
    city: row.city_name ? String(row.city_name).trim() : '',
    published: row.published !== false,
    suspended: row.suspended === true,
    plan: effectivePlan(row.plan, row.plan_expires_at),
    ratingAvg: Number(row.rating_avg) || 0,
    ratingCount: count,
    lastActive: row.last_active_at || null,
    createdAt: row.created_at || null,
    subjects,
  };
}

// ---------- Textos ----------

function listPt(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

function subjectsText(t, max = 3) {
  const names = t.subjects.map((s) => s.name);
  if (names.length <= max) return listPt(names);
  return `${names.slice(0, max).join(', ')} e outras`;
}

function placeText(t) {
  if (t.city && t.uf) return `${t.city}/${t.uf}`;
  return t.city || t.uf || '';
}

function modesText(t) {
  const parts = [];
  if (t.online) parts.push('online');
  if (t.presencial) parts.push(placeText(t) ? `presencial em ${placeText(t)}` : 'presencial');
  return listPt(parts);
}

function clip(text, max) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function profileUrl(slug) {
  return `${SITE_URL}/professores/p/${encodeURIComponent(slug)}`;
}

// ---------- <head>: título, meta, canonical, JSON-LD ----------

function setMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function setJsonLd(data) {
  let el = document.getElementById('perfilJsonLd');
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = 'perfilJsonLd';
    document.head.appendChild(el);
  }
  // textContent + "<" escapado: nenhum texto do professor fecha o <script>
  el.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
}

function updateHead(t) {
  const url = profileUrl(t.slug);
  const subj = subjectsText(t, 2);
  const title = subj ? `${t.name} — Aulas de ${subj}` : t.name;
  document.title = title + TITLE_SUFFIX;

  const bits = [];
  if (t.headline) bits.push(t.headline.replace(/[.!?…]+$/, ''));
  const aulas = [subjectsText(t, 4) ? `Aulas de ${subjectsText(t, 4)}` : 'Aulas particulares', modesText(t)].filter(Boolean).join(' ');
  bits.push(aulas);
  if (t.price != null) bits.push(`${brl(t.price)}/hora`);
  const description = clip(`${bits.join('. ')}.`, 160);

  setMeta('name', 'description', description);
  setMeta('property', 'og:title', clip(`${title} | Quanta Aulas`, 90));
  setMeta('property', 'og:description', description);
  setMeta('property', 'og:url', url);
  setMeta('property', 'og:type', 'profile');
  setMeta('property', 'og:image', avatarPublicUrl(t.avatarPath) || DEFAULT_IMAGE);
  setLink('canonical', url);
  if (!t.published || t.suspended) setMeta('name', 'robots', 'noindex');

  const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: t.name,
    url,
    jobTitle: 'Professor particular',
  };
  if (t.headline) person.description = t.headline;
  const img = avatarPublicUrl(t.avatarPath);
  if (img) person.image = img;
  if (t.subjects.length) person.knowsAbout = t.subjects.map((s) => s.name);
  if (t.presencial && (t.city || t.uf)) {
    person.address = { '@type': 'PostalAddress', addressCountry: 'BR' };
    if (t.city) person.address.addressLocality = t.city;
    if (t.uf) person.address.addressRegion = t.uf;
  }
  const offer = {
    '@type': 'Offer',
    url,
    itemOffered: {
      '@type': 'Service',
      serviceType: 'Aulas particulares',
      name: subjectsText(t, 4) ? `Aulas particulares de ${subjectsText(t, 4)}` : 'Aulas particulares',
    },
  };
  if (t.price != null) {
    const price = (t.price / 100).toFixed(2);
    offer.price = price;
    offer.priceCurrency = 'BRL';
    offer.priceSpecification = {
      '@type': 'UnitPriceSpecification', price, priceCurrency: 'BRL', unitCode: 'HUR', unitText: 'hora',
    };
  }
  person.makesOffer = offer;
  if (t.ratingCount > 0) {
    person.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(t.ratingAvg.toFixed(2)),
      reviewCount: t.ratingCount,
      bestRating: 5,
      worstRating: 1,
    };
  }
  setJsonLd(person);
}

// ---------- Ícones ----------

function icon(d) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'pf-ico');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}
const ICONS = {
  pin: 'M8 14s5-4.5 5-8.5A5 5 0 0 0 3 5.5C3 9.5 8 14 8 14Z M8 7.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z',
  screen: 'M2.5 3.5h11v7h-11z M6 13.5h4 M8 10.5v3',
  clock: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Z M8 4.8V8l2.2 1.4',
  cal: 'M3 4h10v9.5H3z M3 7h10 M5.5 2.5v3 M10.5 2.5v3',
  check: 'M3.5 8.5 6.5 11.5 12.5 4.5',
  shield: 'M8 14s5-2 5-6.5V3.8L8 2 3 3.8v3.7C3 12 8 14 8 14Z',
};

// ---------- Renderização ----------

function fact(iconName, ...children) {
  return h('li', {}, icon(ICONS[iconName]), ...children);
}

// "Novo" só nos primeiros 30 dias; depois, sem avaliações não é "novo"
// (o cabeçalho também diz "No portal desde ...").
function isNewListing() {
  const t = tutorSince ? new Date(tutorSince).getTime() : NaN;
  return Number.isFinite(t) && Date.now() - t < NEW_DAYS * 864e5;
}

function ratingEl(avg, count) {
  if (count > 0) return h('a', { href: '#avaliacoes', class: 'pf-profile-rating' }, starsEl(avg, { count }));
  return h('span', { class: 'pf-badge pf-badge--muted' }, isNewListing() ? 'Novo no portal' : 'Sem avaliações ainda');
}

/** Nota do cabeçalho depois que o visitante publica/edita/exclui a própria avaliação. */
function updateRating({ avg, count } = {}) {
  if (!ratingBadge || !ratingBadge.isConnected) return;
  const next = ratingEl(Number(avg) || 0, Math.max(0, Number(count) || 0));
  ratingBadge.replaceWith(next);
  ratingBadge = next;
}

function renderHead(t) {
  const facts = [];
  if (t.presencial) facts.push(fact('pin', placeText(t) ? `Presencial em ${placeText(t)}` : 'Aulas presenciais'));
  if (t.online) facts.push(fact('screen', 'Aulas online'));
  if (t.createdAt) {
    const since = formatDate(t.createdAt, { month: 'short', year: 'numeric' });
    if (since) facts.push(fact('cal', `No portal desde ${since}`));
  }
  if (t.lastActive) {
    const ago = timeAgo(t.lastActive);
    if (ago) facts.push(fact('clock', `Ativo ${ago}`));
  }

  tutorSince = t.createdAt;
  ratingBadge = ratingEl(t.ratingAvg, t.ratingCount);
  const rating = ratingBadge;

  return h('header', { class: ['pf-profile-head', t.plan === 'premium' ? 'is-premium' : null] },
    h('div', { class: 'pf-profile-avatar' }, avatarEl(t.avatarPath, t.name, 128)),
    h('div', { class: 'pf-profile-id' },
      h('div', { class: 'pf-profile-tags' }, planBadge(t.plan), rating),
      h('h1', { class: 'pf-profile-name' }, t.name),
      t.headline ? h('p', { class: 'pf-profile-headline' }, t.headline) : null,
      facts.length ? h('ul', { class: 'pf-profile-facts' }, facts) : null));
}

function renderBreadcrumb(t) {
  const first = t.subjects[0];
  return h('nav', { class: 'pf-breadcrumb', 'aria-label': 'Você está em' },
    h('ol', {},
      h('li', {}, h('a', { href: '/professores/' }, 'Professores')),
      first && SLUG_RE.test(first.slug)
        ? h('li', {}, h('a', { href: `/professores/?materia=${encodeURIComponent(first.slug)}` }, first.name))
        : null,
      h('li', {}, h('span', { 'aria-current': 'page' }, t.name))));
}

function section(id, title, ...children) {
  const hid = `${id}Titulo`;
  return h('section', { class: 'pf-panel pf-profile-section', id, 'aria-labelledby': hid },
    h('h2', { class: 'pf-section-title', id: hid }, title),
    ...children);
}

function renderAbout(t) {
  return section('sobre', 'Sobre',
    t.bio
      ? h('p', { class: 'pf-bio pf-pre' }, t.bio)
      : h('p', { class: 'pf-muted' }, 'O professor ainda não escreveu uma apresentação. Envie uma mensagem para saber mais.'));
}

function renderSubjects(t) {
  if (!t.subjects.length) {
    return section('materias', 'Matérias e níveis', h('p', { class: 'pf-muted' }, 'Nenhuma matéria informada.'));
  }
  return section('materias', 'Matérias e níveis',
    h('ul', { class: 'pf-subject-list' },
      t.subjects.map((s) => h('li', { class: 'pf-subject-item' },
        SLUG_RE.test(s.slug)
          ? h('a', { class: 'pf-subject-name', href: `/professores/?materia=${encodeURIComponent(s.slug)}`, title: `Outros professores de ${s.name}` }, s.name)
          : h('span', { class: 'pf-subject-name' }, s.name),
        s.levels.length
          ? h('ul', { class: 'pf-levels', 'aria-label': `Níveis de ${s.name}` },
            s.levels.map((l) => h('li', { class: 'pf-chip pf-chip-sm' }, LEVEL_LABEL.get(l))))
          : h('span', { class: 'pf-muted pf-levels-none' }, 'Todos os níveis (a combinar)')))));
}

function priceEl(t, cls) {
  return h('div', { class: cls },
    t.price != null ? [h('span', { class: 'pf-price' }, brl(t.price)), h('small', {}, '/hora')] : h('span', { class: 'pf-price-none' }, 'Preço a combinar'));
}

function renderSide(t, { isOwner, hidden }) {
  const checks = [];
  if (t.online) checks.push(h('li', {}, icon(ICONS.check), 'Aulas online'));
  if (t.presencial) checks.push(h('li', {}, icon(ICONS.check), placeText(t) ? `Presencial em ${placeText(t)}` : 'Aulas presenciais'));
  checks.push(h('li', {}, icon(ICONS.check), 'Primeiro contato pelo portal, sem custo'));

  const foot = isOwner
    ? h('a', { class: 'pf-link-btn', href: '/professores/painel.html' }, 'Editar meu perfil')
    : reportSafe(t);

  return h('aside', { class: 'pf-profile-side', 'aria-label': 'Contato e preço' },
    h('div', { class: 'pf-panel pf-cta-card', id: 'contato' },
      priceEl(t, 'pf-cta-price'),
      h('p', { class: 'pf-cta-note' }, 'Valor por hora-aula informado pelo professor. Combine detalhes pela mensagem.'),
      hidden ? null : h('div', { class: 'pf-cta-action', id: 'perfilContato', dataset: { mount: 'contact' } }),
      h('ul', { class: 'pf-cta-list' }, checks),
      foot ? h('div', { class: 'pf-cta-foot' }, foot) : null),
    h('div', { class: 'pf-panel pf-safety' },
      h('p', { class: 'pf-safety-title' }, icon(ICONS.shield), 'Dica de segurança'),
      h('p', {}, 'Converse pelo portal e só combine pagamentos quando tiver certeza. Nunca envie senhas ou códigos de verificação.')));
}

function reportSafe(t) {
  try {
    return reportButton({ type: 'tutor', id: t.userId, label: 'Denunciar este perfil' });
  } catch {
    return null;
  }
}

function renderNotice(t, isOwner) {
  if (t.published && !t.suspended) return null;
  let title;
  let text;
  if (t.suspended) {
    title = 'Anúncio suspenso';
    text = isOwner
      ? 'Seu anúncio foi suspenso pela moderação e não aparece para os alunos. Fale com o suporte se achar que é um engano.'
      : 'Este anúncio está suspenso pela moderação e não aparece para os alunos.';
  } else {
    title = 'Anúncio não publicado';
    text = isOwner
      ? 'Só você está vendo esta página. Complete seu perfil e publique o anúncio no painel para aparecer na busca.'
      : 'Este anúncio não está publicado e não aparece para os alunos.';
  }
  return h('div', { class: 'pf-notice pf-notice--warn pf-profile-notice', role: 'status' },
    h('p', { class: 'pf-notice-title' }, title),
    h('p', {}, text),
    isOwner ? h('div', {}, h('a', { class: 'btn btn-ghost btn-sm', href: '/professores/painel.html' }, 'Ir para o painel')) : null);
}

/** Monta um componente sem deixar um erro dele derrubar a página. */
function safeMount(container, fn) {
  if (!container) return;
  const fail = () => {
    container.replaceChildren(h('p', { class: 'pf-muted' }, 'Não foi possível carregar esta seção agora.'));
  };
  try {
    const res = fn();
    if (res && typeof res.then === 'function') res.then(null, fail);
  } catch {
    fail();
  }
}

function renderCtaBar(t) {
  ctaBar?.remove();
  const action = h('div', { class: 'pf-cta-bar-action', dataset: { mount: 'contact-bar' } });
  ctaBar = h('div', { class: 'pf-cta-bar', id: 'perfilCtaBar', role: 'region', 'aria-label': 'Contato rápido' },
    h('div', { class: 'pf-cta-bar-info' },
      h('span', { class: 'pf-cta-bar-name' }, t.name),
      priceEl(t, 'pf-cta-bar-price')),
    action);
  // Fora do <main> (que é um contexto de empilhamento): fica acima do rodapé
  document.body.appendChild(ctaBar);
  document.body.classList.add('pf-has-cta-bar');
  return action;
}

function watchCtaCard(card) {
  if (!ctaBar) return;
  if (!card || !('IntersectionObserver' in window)) {
    ctaBar.classList.add('is-visible');
    return;
  }
  // Barra aparece quando o card de contato sai da tela
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) ctaBar.classList.toggle('is-visible', !e.isIntersecting);
  }, { threshold: 0 });
  io.observe(card);
}

function renderProfile(t, viewer) {
  const isOwner = Boolean(viewer && viewer.id === t.userId);
  const hidden = !t.published || t.suspended;

  updateHead(t);

  const reviewsBox = h('div', { class: 'pf-mount', dataset: { mount: 'reviews' } });
  const answersBox = h('div', { class: 'pf-mount', dataset: { mount: 'answers' } });

  const layout = h('div', { class: 'pf-profile' },
    renderHead(t),
    renderSide(t, { isOwner, hidden }),
    h('div', { class: 'pf-profile-body' },
      renderAbout(t),
      renderSubjects(t),
      h('section', { class: 'pf-panel pf-profile-section', id: 'avaliacoes', 'aria-label': 'Avaliações' }, reviewsBox),
      section('respostas', 'Respostas no tira-dúvidas', answersBox)));

  root.replaceChildren(...[renderBreadcrumb(t), renderNotice(t, isOwner), layout].filter(Boolean));

  const contactOpts = {
    tutorId: t.userId,
    tutorName: t.name,
    subjects: t.subjects.map((s) => ({ id: s.id, name: s.name })),
  };
  safeMount($('perfilContato'), () => mountContactButton($('perfilContato'), contactOpts));
  safeMount(reviewsBox, () => mountReviews(reviewsBox, {
    tutorId: t.userId, ratingAvg: t.ratingAvg, ratingCount: t.ratingCount, onChange: updateRating,
  }));
  safeMount(answersBox, () => mountTutorAnswers(answersBox, { tutorId: t.userId }));

  // Barra fixa de contato no celular (não para o próprio professor nem anúncio fora do ar)
  if (!isOwner && !hidden) {
    const barAction = renderCtaBar(t);
    safeMount(barAction, () => mountContactButton(barAction, contactOpts));
    watchCtaCard(document.getElementById('contato'));
  }

  // Link direto para #avaliacoes etc.: rola depois que o conteúdo existe
  if (location.hash && /^#[a-z]+$/.test(location.hash)) {
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }
}

function renderNotFound() {
  document.title = `Professor não encontrado${TITLE_SUFFIX}`;
  setMeta('name', 'robots', 'noindex');
  root.replaceChildren(h('div', { class: 'pf-profile-404' },
    h('div', { class: 'eyebrow' }, 'Perfil não encontrado'),
    h('h1', { class: 'pf-title' }, 'Professor não encontrado'),
    h('p', { class: 'lead' }, 'Este perfil não existe, foi removido ou não está publicado no momento.'),
    h('div', { class: 'pf-form-actions' },
      h('a', { class: 'btn btn-primary', href: '/professores/' }, 'Buscar professores'),
      h('a', { class: 'btn btn-ghost', href: '/professores/duvidas.html' }, 'Ir para o tira-dúvidas'))));
}

function renderLoading() {
  root.replaceChildren(
    h('header', { class: 'pf-page-head' },
      h('div', { class: 'eyebrow' }, 'Professor particular'),
      h('h1', { class: 'pf-title' }, 'Perfil do professor')),
    h('div', { class: 'pf-profile-loading', role: 'status' },
      h('span', { class: 'pf-sr-only' }, 'Carregando perfil…'),
      h('div', { class: 'pf-profile-skel', 'aria-hidden': 'true' },
        h('span', { class: 'pf-skel pf-profile-skel-avatar' }),
        h('div', { class: 'pf-skel-lines' },
          h('span', { class: 'pf-skel pf-skel-line', style: { width: '55%', height: '22px' } }),
          h('span', { class: 'pf-skel pf-skel-line', style: { width: '85%' } })))));
}

function renderError(err, slug) {
  root.replaceChildren(
    h('header', { class: 'pf-page-head' },
      h('div', { class: 'eyebrow' }, 'Professor particular'),
      h('h1', { class: 'pf-title' }, 'Perfil do professor')),
    h('div', { class: 'pf-notice pf-notice--erro', role: 'alert' },
      h('p', { class: 'pf-notice-title' }, 'Não foi possível carregar este perfil.'),
      h('p', {}, errorMsg(err)),
      h('div', {}, h('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        onClick: () => {
          renderLoading();
          load(slug);
        },
      }, 'Tentar de novo'))));
}

async function load(slug) {
  try {
    const { data, error } = await sb.from('tutor_profiles').select(SELECT).eq('slug', slug).maybeSingle();
    if (error) throw error;
    if (!data) {
      renderNotFound();
      return;
    }
    let viewer = null;
    try {
      viewer = await getUser();
    } catch {
      viewer = null;
    }
    renderProfile(normalize(data), viewer);
  } catch (err) {
    renderError(err, slug);
  }
}

function main() {
  initChrome();
  root = $('perfilRoot');
  if (!root) return;
  if (!isConfigured) {
    notConfiguredNotice($('pageBody') || root);
    return;
  }
  const slug = getSlug();
  if (!slug) {
    renderNotFound();
    return;
  }
  load(slug);
}

main();
