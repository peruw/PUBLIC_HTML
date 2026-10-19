// Telas de menu (DOM): inicial, escolha do cientista, como jogar, pausa e resultado.
// Todo texto vem de i18n.js; relocalize() redesenha as telas quando o idioma muda.
import { CHARACTERS, CLASSES, ITEMS, RACE } from './config.js';
import { itemIconHTML } from './hud.js';
import { formatTime } from './race.js';
import { MEDALS, quizText } from './progress.js';
import { t, tv, ord, charText, itemText, applyStatic, LANGS, getLang } from './i18n.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['loading', 'title', 'select', 'howto', 'pause', 'results', 'error'];
// Bandeiras em SVG (emoji de bandeira vira letras no Windows).
const svgFlag = (body, vb = '0 0 30 20') => `<svg viewBox="${vb}" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`;
const hStripes = (...cs) => cs.map((c, i) => `<rect y="${(i * 20) / cs.length}" width="30" height="${20 / cs.length}" fill="${c}"/>`).join('');
const vStripes = (...cs) => cs.map((c, i) => `<rect x="${i * 10}" width="10" height="20" fill="${c}"/>`).join('');
const FLAGS = {
  gb: svgFlag(
    '<rect width="60" height="30" fill="#012169"/><path d="M0 0L60 30M60 0L0 30" stroke="#fff" stroke-width="6"/>' +
      '<path d="M0 0L60 30M60 0L0 30" stroke="#c8102e" stroke-width="2"/><path d="M30 0V30M0 15H60" stroke="#fff" stroke-width="10"/>' +
      '<path d="M30 0V30M0 15H60" stroke="#c8102e" stroke-width="6"/>',
    '0 0 60 30',
  ),
  'pl-fr': svgFlag(hStripes('#fff', '#dc143c')),
  ru: svgFlag(hStripes('#fff', '#0039a6', '#d52b1e')),
  de: svgFlag(hStripes('#000', '#dd0000', '#ffce00')),
  it: svgFlag(vStripes('#009246', '#fff', '#ce2b37')),
  br: svgFlag(
    '<rect width="30" height="20" fill="#009c3b"/><path d="M15 2L27.5 10L15 18L2.5 10Z" fill="#ffdf00"/>' +
      '<circle cx="15" cy="10" r="4.6" fill="#002776"/><path d="M10.6 9.2Q15 7.6 19.5 10.8" stroke="#fff" stroke-width="1" fill="none"/>',
  ),
};
const STAT_KEYS = ['speed', 'accel', 'handling', 'weight'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cname = (c) => charText(c.id).name || c.name;

const store = {
  get(k, def) {
    try {
      const v = localStorage.getItem('corrida-' + k);
      return v === null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('corrida-' + k, JSON.stringify(v));
    } catch {
      /* armazenamento indisponível */
    }
  },
};
export { store };

export class Menu {
  // handlers: { onStart(opts), onResume, onRestart, onQuit, onToggleSound, onToggleQuality, onToggleAuto, onLang(id), sfx(name) }
  // progress: Progress (recordes, troféus e perguntas)
  constructor(handlers, progress = null) {
    this.h = handlers;
    this.progress = progress;
    this.current = 'loading';
    this.prev = 'title';
    this.portraits = {};
    this.labels = { muted: false, quality: null, qualityNote: false, assist: true, auto: false };
    this.loadingKey = 'loading.prep';
    this.loadingFact = null;
    this.res = null; // última tela de resultado (para redesenhar ao trocar o idioma)
    this.opts = {
      character: store.get('character', 'newton'),
      cc: store.get('cc', '50cc'), // primeira vez: classe mais tranquila
      laps: store.get('laps', RACE.defaultLaps),
      assist: store.get('assist', true), // ajuda na direção
    };
    if (!CHARACTERS.some((c) => c.id === this.opts.character)) this.opts.character = 'newton';
    if (!CLASSES[this.opts.cc]) this.opts.cc = '100cc';
    if (!RACE.lapOptions.includes(this.opts.laps)) this.opts.laps = RACE.defaultLaps;

    this.tabNav = false; // foco veio do Tab (não do mouse/toque)
    this.initSelectEvents();
    this.initLangSelects();
    this.relocalize();

    document.addEventListener('pointerdown', () => { this.tabNav = false; }, { capture: true, passive: true });
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      // a pausa abre no pointerdown do botão de pausa; o clique que sobra desse toque cairia no
      // botão que apareceu embaixo do dedo (em tela baixa, o "Continuar"): ignora cliques logo depois
      if (this.current === 'pause' && performance.now() - this.shownAt < 350) return;
      this.action(btn.dataset.action);
    });
    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  // Redesenha todos os textos no idioma atual.
  relocalize() {
    applyStatic(document);
    // título com palavra comprida (ex.: "Wissenschaftler") usa letra um pouco menor
    const main = document.querySelector('.logo .h1-main');
    main?.parentElement.classList.toggle('long', [...(main.textContent || '')].length > 11);
    for (const sel of this.langSelects) sel.value = getLang();
    this.buildSelect();
    this.buildHowto();
    this.refreshSelect();
    this.refreshTitle();
    this.setLoading(null, this.loadingKey);
    if (this.loadingFact) this.setLoadingFact(this.loadingFact.c, this.loadingFact.idx);
    this.setSoundLabel(this.labels.muted);
    if (this.labels.quality) this.setQualityLabel(this.labels.quality, this.labels.qualityNote);
    this.setAssistLabel(this.labels.assist);
    this.setAutoLabel(this.labels.auto);
    if (this.res) this.renderResults();
  }

  // Seletor de idioma (menu inicial e pausa), com os nomes de cada idioma na própria língua.
  initLangSelects() {
    this.langSelects = ['lang-select', 'lang-select-2'].map($).filter(Boolean);
    for (const sel of this.langSelects) {
      sel.innerHTML = LANGS.map((l) => `<option value="${l.id}" lang="${l.id}">${l.name}</option>`).join('');
      sel.value = getLang();
      sel.addEventListener('change', () => {
        this.h.sfx('menuMove');
        this.h.onLang?.(sel.value);
      });
      // as setas mudam o idioma, não a escolha do cientista
      sel.addEventListener('keydown', (e) => e.stopPropagation());
    }
  }

  action(a) {
    const h = this.h;
    switch (a) {
      case 'play':
        h.sfx('menuSelect');
        h.onPlay?.();
        this.show('select');
        break;
      case 'howto':
        h.sfx('menuSelect');
        this.show('howto');
        break;
      case 'back':
        h.sfx('menuMove');
        this.show('title');
        break;
      case 'start':
        h.sfx('menuSelect');
        store.set('character', this.opts.character);
        store.set('cc', this.opts.cc);
        store.set('laps', this.opts.laps);
        store.set('assist', this.opts.assist);
        h.onStart({ ...this.opts });
        break;
      case 'resume':
        h.onResume();
        break;
      case 'restart':
        h.sfx('menuSelect');
        h.onRestart();
        break;
      case 'quit':
        h.sfx('menuMove');
        h.onQuit();
        break;
      case 'toggle-sound':
        h.onToggleSound();
        break;
      case 'toggle-quality':
        h.onToggleQuality();
        break;
      case 'toggle-auto':
        h.onToggleAuto();
        break;
      case 'toggle-assist':
        this.opts.assist = !this.opts.assist;
        store.set('assist', this.opts.assist);
        this.setAssistLabel(this.opts.assist);
        h.onToggleAssist?.(this.opts.assist);
        break;
    }
  }

  show(name) {
    if (name !== this.current) {
      this.prev = this.current;
      this.shownAt = performance.now();
    }
    this.current = name;
    if (name !== 'results') this.res = null;
    for (const s of SCREENS) $('screen-' + s)?.classList.toggle('hidden', s !== name);
    if (name === 'select') this.refreshSelect();
    if (name === 'title') this.refreshTitle();
  }

  // Linha de progresso da tela inicial (troféus e perguntas).
  refreshTitle() {
    const el = $('title-progress');
    if (!el || !this.progress) return;
    const m = this.progress.medalCount();
    const q = this.progress.quizScore();
    el.innerHTML = this.progress.races ? t('title.progress', { m: m.n, mt: m.total, q: q.right, qt: q.total }) : '';
  }

  // Curiosidade na tela de carregamento.
  setLoadingFact(c, idx) {
    this.loadingFact = { c, idx };
    const el = $('loading-fact');
    const text = (charText(c.id).facts || [])[idx] || '';
    if (el) el.innerHTML = `<b>${t('common.didYouKnow')}</b> ${text}`;
  }

  hideAll() {
    this.current = null;
    this.res = null;
    // tira o foco do botão clicado (senão Enter/Espaço o aciona de novo no meio da corrida)
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    for (const s of SCREENS) $('screen-' + s)?.classList.add('hidden');
  }

  // key: chave de texto (loading.*)
  setLoading(frac, key) {
    if (frac != null) $('loading-fill').style.width = `${Math.round(frac * 100)}%`;
    if (key) {
      this.loadingKey = key;
      $('loading-text').textContent = t(key);
    }
  }

  setSoundLabel(muted) {
    this.labels.muted = muted;
    const s = t(muted ? 'title.soundOff' : 'title.sound');
    $('btn-sound').textContent = s;
    $('btn-sound-2').textContent = s;
  }

  // q: 'alta' | 'baixa'; reloading: mostra "(recarregando…)"
  setQualityLabel(q, reloading = false) {
    this.labels.quality = q;
    this.labels.qualityNote = reloading;
    const name = t(q === 'baixa' ? 'title.qualityBaixa' : 'title.qualityAlta');
    $('btn-quality').textContent = t('title.quality', { q: reloading ? t('title.reloading', { q: name }) : name });
  }

  setAssistLabel(on) {
    this.labels.assist = on;
    $('btn-assist').textContent = t('pause.assist', { s: t(on ? 'common.onF' : 'common.offF') });
  }

  setAutoLabel(on) {
    this.labels.auto = on;
    $('btn-auto').textContent = t('pause.auto', { s: t(on ? 'common.onF' : 'common.offF') });
  }

  setPortraits(map) {
    this.portraits = map || {};
    this.applyPortraits();
    this.refreshSelect();
  }

  applyPortraits() {
    for (const c of CHARACTERS) {
      const card = this.grid.querySelector(`[data-id="${c.id}"]`);
      const url = this.portraits[c.id];
      if (card && url) card.querySelector('.ph, img').outerHTML = `<img src="${url}" alt="${esc(cname(c))}" draggable="false" />`;
    }
  }

  // ---------- escolha do cientista ----------
  initSelectEvents() {
    this.grid = $('char-grid');
    this.grid.addEventListener('click', (e) => {
      const card = e.target.closest('.char-card');
      if (!card) return;
      if (this.opts.character !== card.dataset.id) this.h.sfx('menuMove');
      this.opts.character = card.dataset.id;
      this.refreshSelect();
    });
    this.grid.addEventListener('dblclick', (e) => {
      if (e.target.closest('.char-card')) this.action('start');
    });
    // Tab num cartão já escolhe o cientista (a ficha acompanha o foco)
    this.grid.addEventListener('focusin', (e) => {
      const card = e.target.closest('.char-card');
      if (!card || !this.tabNav || card.dataset.id === this.opts.character) return;
      this.opts.character = card.dataset.id;
      this.h.sfx('menuMove');
      this.refreshSelect();
    });
    $('opt-cc').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.opts.cc = b.dataset.cc;
      this.h.sfx('menuMove');
      this.refreshSelect();
    });
    $('opt-assist').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.opts.assist = b.dataset.assist === '1';
      this.h.sfx('menuMove');
      this.refreshSelect();
    });
    const laps = $('opt-laps');
    laps.innerHTML = RACE.lapOptions.map((n) => `<button data-laps="${n}">${n}</button>`).join('');
    laps.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.opts.laps = Number(b.dataset.laps);
      this.h.sfx('menuMove');
      this.refreshSelect();
    });
  }

  buildSelect() {
    const focused = document.activeElement?.closest?.('.char-card')?.dataset.id;
    this.grid.innerHTML = CHARACTERS.map((c) => {
      const tx = charText(c.id);
      const name = tx.name || c.name;
      const card = tx.short || name;
      // palavra única comprida (Mendelejew, Mendeléiev) não tem onde quebrar: letra menor
      const long = !/\s/.test(card) && [...card].length >= 10;
      return `<button class="char-card" data-id="${c.id}" style="--c:${c.colors.ui}">
        <span class="flag">${FLAGS[c.flag] || ''}</span>
        <div class="ph" style="--c:${c.colors.ui}">${esc([...name][0])}</div>
        <span${long ? ' class="nm-long"' : ''}>${esc(card)}</span>
        <i class="medal" aria-hidden="true"></i>
      </button>`;
    }).join('');
    this.applyPortraits();
    if (focused) this.grid.querySelector(`[data-id="${focused}"]`)?.focus();
    $('opt-cc').innerHTML = Object.values(CLASSES)
      .map((c) => `<button data-cc="${c.id}">${c.label}<small>${t('classes.' + c.id)}</small></button>`)
      .join('');
  }

  refreshSelect() {
    const c = CHARACTERS.find((x) => x.id === this.opts.character);
    const tx = charText(c.id);
    for (const card of this.grid.children) {
      card.classList.toggle('selected', card.dataset.id === c.id);
      // troféu na classe escolhida
      const best = this.progress?.bestPlace(card.dataset.id, this.opts.cc);
      const medal = card.querySelector('.medal');
      if (medal) medal.textContent = best && best <= 3 ? MEDALS[best] : '';
    }
    for (const b of $('opt-cc').children) b.classList.toggle('on', b.dataset.cc === this.opts.cc);
    for (const b of $('opt-laps').children) b.classList.toggle('on', Number(b.dataset.laps) === this.opts.laps);
    for (const b of $('opt-assist').children) b.classList.toggle('on', (b.dataset.assist === '1') === !!this.opts.assist);

    const img = $('detail-portrait');
    img.style.setProperty('--c', c.colors.ui);
    img.alt = tx.name || c.name;
    if (this.portraits[c.id]) {
      img.src = this.portraits[c.id];
      img.style.visibility = 'visible';
    } else {
      img.removeAttribute('src');
      img.style.visibility = 'hidden';
    }
    $('detail-name').textContent = tx.fullName || c.name;
    $('detail-meta').textContent = `${c.years} · ${t('countries.' + c.flag)} · ${tx.field || ''}`;
    $('detail-bio').textContent = tx.bio || '';
    const rec = $('detail-record');
    if (rec && this.progress) {
      const medals = Object.keys(CLASSES)
        .map((cc) => {
          const b = this.progress.bestPlace(c.id, cc);
          return `<span class="${cc === this.opts.cc ? 'cur' : ''}">${cc} ${b && b <= 3 ? MEDALS[b] : b ? ord(b) : '–'}</span>`;
        })
        .join('');
      const r = this.progress.record(this.opts.cc, this.opts.laps);
      const rt = r ? t('select.record', { cc: this.opts.cc, laps: t('select.lapsN', { n: this.opts.laps }), time: formatTime(r.time) }) : '';
      rec.innerHTML = `<span class="medals" title="${esc(t('select.medalsTitle', { name: tx.name || c.name }))}">${medals}</span>${rt ? `<span class="rec">${rt}</span>` : ''}`;
    }
    $('detail-stats').innerHTML = STAT_KEYS.map(
      (k) =>
        `<div class="stat"><span>${t('select.stats.' + k)}</span><div class="stat-bar">${[1, 2, 3, 4, 5]
          .map((i) => `<i class="${i <= c.stats[k] ? 'on' : ''}"></i>`)
          .join('')}</div></div>`,
    ).join('');
  }

  moveSelection(dx, dy) {
    const i = CHARACTERS.findIndex((x) => x.id === this.opts.character);
    const cols = 4;
    let n = i + dx + dy * cols;
    n = (n + CHARACTERS.length) % CHARACTERS.length;
    this.opts.character = CHARACTERS[n].id;
    this.h.sfx('menuMove');
    this.refreshSelect();
    // com foco de Tab num cartão, o foco acompanha a seleção
    if (this.tabNav && document.activeElement?.classList.contains('char-card')) {
      this.grid.querySelector(`[data-id="${this.opts.character}"]`)?.focus();
    }
  }

  buildHowto() {
    const list = (key) => (tv(key) || []).map((li) => `<li>${li}</li>`).join('');
    $('howto-pc').innerHTML = list('howto.pcList');
    $('howto-phone').innerHTML = list('howto.phoneList');
    $('howto-tips').innerHTML = list('howto.tipsList');
    $('howto-items').innerHTML = Object.values(ITEMS)
      .map((it) => {
        const tx = itemText(it.id);
        return `<div class="item-row"><div class="item-ico">${itemIconHTML(it.id)}</div>
        <div><b>${tx.name}</b><p>${tx.effect}</p><p><i>${tx.fact}</i></p></div></div>`;
      })
      .join('');
  }

  // ---------- resultado ----------
  // summary: resumo do Progress.finishRace (tempo, melhor volta, recordes, troféu e estatísticas)
  showResults(results, player, summary = null) {
    const mine = player.character;
    const winner = results[0].kart.character;
    // pergunta primeiro: a curiosidade mostrada ao lado não pode entregar a resposta
    const quiz = this.progress ? { ...this.progress.pickQuiz(mine.id), answered: false, chosen: -1 } : null;
    const avoid = quiz ? quizText(quiz.id, quiz.order).words : [];
    // curiosidade do cientista escolhido (alterna a cada corrida) e do vencedor
    const fact = (c) => (this.progress ? this.progress.nextFact(c.id, avoid) : 0);
    const facts = { mine: fact(mine), winner: winner.id !== mine.id ? fact(winner) : null };
    this.show('results');
    this.res = { results, player, summary, quiz, facts };
    this.renderResults();
  }

  renderResults() {
    const { results, player, summary, quiz, facts } = this.res;
    const me = results.find((r) => r.kart === player);
    const place = me ? me.place : 0;
    const mine = player.character;
    $('results-title').textContent =
      place === 1 ? t('results.win') : place <= 3 ? t('results.podium', { place: ord(place), medal: MEDALS[place] }) : t('results.place', { place: ord(place) });
    $('results-list').innerHTML = results
      .map(
        (r) => `<li class="${r.kart === player ? 'me' : ''}">
          <span class="p">${ord(r.place)}</span>
          <span class="dot" style="background:${r.kart.character.colors.ui}"></span>
          <span>${esc(r.kart === player ? t('results.you', { name: cname(r.kart.character) }) : cname(r.kart.character))}</span>
          <span class="t">${r.estimated ? '~' : ''}${formatTime(r.time)}</span>
        </li>`,
      )
      .join('');

    // conquistas desta corrida
    const sub = [];
    if (summary) {
      if (summary.newRecord) sub.push(`<span class="badge gold">${t('results.newRecord', { time: formatTime(summary.time) })}</span>`);
      else if (summary.firstRecord) sub.push(`<span class="badge">${t('results.firstRecord', { time: formatTime(summary.time) })}</span>`);
      if (summary.newMedal) sub.push(`<span class="badge gold">${t('results.medal' + summary.newMedal, { name: cname(mine), cc: summary.cc })}</span>`);
      if (summary.newBestLap) sub.push(`<span class="badge">${t('results.bestLapBadge', { cc: summary.cc })}</span>`);
      if (!sub.length && place > 3) sub.push(`<span class="tip">${this._tip(summary)}</span>`);
    }
    $('results-sub').innerHTML = sub.join('');

    // estatísticas
    const st = summary?.stats;
    $('results-stats').innerHTML = summary
      ? [
          ['⏱️', 'bestLap', summary.bestLap ? formatTime(summary.bestLap) : '–'],
          ['🔥', 'drift', st.driftBoosts],
          ['🧪', 'items', st.items],
          ['💫', 'hits', st.hits],
        ]
          .map(([i, k, v]) => {
            const l = t('results.stats.' + k);
            return `<div class="chip" title="${esc(l)}"><span aria-hidden="true">${i}</span><b>${v}</b><small>${l}</small></div>`;
          })
          .join('')
      : '';

    this.renderQuiz(quiz);
    const winner = results[0].kart.character;
    const factText = (c, i) => (charText(c.id).facts || [])[i] || '';
    let html = t('results.factMine', { name: cname(mine), fact: factText(mine, facts.mine) });
    if (facts.winner != null) {
      html += '<br>' + t(winner.gender === 'f' ? 'results.factWinnerF' : 'results.factWinnerM', { name: cname(winner), fact: factText(winner, facts.winner) });
    }
    $('results-fact').innerHTML = html;
  }

  // Dica para quem ficou fora do pódio, conforme o que aconteceu na corrida.
  _tip(s) {
    const st = s.stats || {};
    if (st.driftBoosts === 0) return t('results.tips.drift');
    if (!st.rocket) return t('results.tips.rocket');
    if (st.items === 0) return t('results.tips.items');
    if (st.hits >= 3) return t('results.tips.hits');
    if (s.cc !== '50cc') return t('results.tips.easy');
    return t('results.tips.line');
  }

  // Pergunta-relâmpago sobre o cientista escolhido (ou outra ainda não acertada).
  renderQuiz(quiz) {
    const box = $('results-quiz');
    if (!box) return;
    box.classList.remove('right', 'wrong');
    if (!quiz) {
      box.innerHTML = '';
      return;
    }
    const q = quizText(quiz.id, quiz.order);
    box.innerHTML = `<b class="quiz-title">${t('quiz.title')}</b>
      <p class="quiz-q">${q.q}</p>
      <div class="quiz-opts">${q.options
        .map((o, i) => `<button class="btn btn-small quiz-opt" data-quiz="${i}"><kbd class="desktop-only">${i + 1}</kbd> ${o}</button>`)
        .join('')}</div>
      <p class="quiz-fb" aria-live="polite"></p>`;
    box.querySelectorAll('.quiz-opt').forEach((b) => b.addEventListener('click', () => this.answerQuiz(Number(b.dataset.quiz))));
    if (quiz.answered) this.markQuiz(quiz, q);
  }

  answerQuiz(i) {
    const quiz = this.res?.quiz;
    if (!quiz || quiz.answered || i < 0 || i > 2) return;
    quiz.answered = true;
    quiz.chosen = i;
    const q = quizText(quiz.id, quiz.order);
    const ok = i === q.correct;
    this.progress.answerQuiz(quiz.id, ok);
    this.h.sfx(ok ? 'quizRight' : 'quizWrong');
    this.markQuiz(quiz, q);
  }

  markQuiz(quiz, q) {
    const ok = quiz.chosen === q.correct;
    const box = $('results-quiz');
    box.classList.toggle('right', ok);
    box.classList.toggle('wrong', !ok);
    box.querySelectorAll('.quiz-opt').forEach((b, j) => {
      b.disabled = true;
      b.classList.toggle('correct', j === q.correct);
      b.classList.toggle('chosen', j === quiz.chosen);
    });
    const sc = this.progress.quizScore();
    box.querySelector('.quiz-fb').innerHTML = `${ok ? t('quiz.right') : t('quiz.wrong', { a: q.options[q.correct] })} ${q.explain || ''}
      <small>${t('quiz.score', { r: sc.right, t: sc.total })}</small>`;
  }

  // ---------- teclado nos menus ----------
  onKey(e) {
    if (e.key === 'Tab') this.tabNav = true;
    if (e.repeat) return;
    const k = e.key;
    // botão focado pelo Tab: Enter/Espaço acionam o próprio botão
    // (no cartão do cientista, Enter continua sendo "correr")
    const f = document.activeElement;
    if (f && f.tagName === 'SELECT') return;
    if ((k === 'Enter' || k === ' ') && this.tabNav && f && f.matches('button, a[href]') && !f.classList.contains('char-card') && f.closest('#screen-' + this.current)) {
      if (k === ' ') {
        e.preventDefault(); // o input.js bloqueia o Espaço nativo: clica aqui
        f.click();
      }
      return;
    }
    if (this.current === 'title' && (k === 'Enter' || k === ' ')) {
      e.preventDefault();
      this.action('play');
    } else if (this.current === 'select') {
      if (k === 'ArrowLeft' || k === 'a') this.moveSelection(-1, 0);
      else if (k === 'ArrowRight' || k === 'd') this.moveSelection(1, 0);
      else if (k === 'ArrowUp' || k === 'w') this.moveSelection(0, -1);
      else if (k === 'ArrowDown' || k === 's') this.moveSelection(0, 1);
      else if (k === 'Enter' || k === ' ') this.action('start');
      else if (k === 'Escape') this.action('back');
      else return;
      e.preventDefault();
    } else if (this.current === 'howto' && (k === 'Escape' || k === 'Enter')) {
      this.action('back');
    } else if (this.current === 'results' && k === 'Enter') {
      this.action('restart');
    } else if (this.current === 'results' && (k === '1' || k === '2' || k === '3')) {
      this.answerQuiz(Number(k) - 1);
    } else if ((this.current === 'results' || this.current === 'pause') && (k === 'r' || k === 'R')) {
      this.action('restart');
    }
  }

  // Botão "confirmar" do controle (gamepad) nas telas.
  confirm() {
    if (this.current === 'title') this.action('play');
    else if (this.current === 'select') this.action('start');
    else if (this.current === 'howto') this.action('back');
    else if (this.current === 'pause') this.action('resume');
    else if (this.current === 'results') this.action('restart');
  }
}
