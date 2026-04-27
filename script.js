/* ============================================
   Quanta Aulas — script.js (vanilla, sem React)
   ============================================ */

(function () {
  'use strict';

  // ---------- 1. Sistema bilíngue PT/EN ----------
  (function setupLang() {
    const html = document.documentElement;
    const langButtons = document.querySelectorAll('[data-set-lang]');
    const savedLang = localStorage.getItem('quanta_lang') || 'pt';

    function setLang(lang) {
      html.classList.remove('lang-pt', 'lang-en');
      html.classList.add('lang-' + lang);
      html.setAttribute('lang', lang === 'en' ? 'en' : 'pt-BR');

      langButtons.forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-set-lang') === lang);
      });

      localStorage.setItem('quanta_lang', lang);
    }

    langButtons.forEach((btn) => {
      btn.addEventListener('click', function () {
        setLang(this.getAttribute('data-set-lang'));
      });
    });

    setLang(savedLang);
  })();

  // ---------- 2. Menu mobile ----------
  (function setupMobileMenu() {
    const toggle = document.getElementById('menuToggle');
    const panel = document.getElementById('mobileMenu');
    if (!toggle || !panel) return;

    toggle.addEventListener('click', function () {
      const open = panel.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    panel.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', function () {
        panel.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  })();

  // ---------- 3. Nav com sombra ao rolar ----------
  (function setupNavScroll() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  })();

  // ---------- 4. FAQ accordion ----------
  (function setupFAQ() {
    const items = document.querySelectorAll('.faq-item');
    items.forEach((item) => {
      item.addEventListener('click', function () {
        const wasOpen = item.classList.contains('open');
        items.forEach((i) => i.classList.remove('open'));
        if (!wasOpen) item.classList.add('open');
      });
    });
    if (items[0]) items[0].classList.add('open');
  })();

  // ---------- 5. Método (passos clicáveis) ----------
  (function setupMethod() {
    const steps = document.querySelectorAll('.method-step');
    const visuals = document.querySelectorAll('.visual-stage');
    if (!steps.length || !visuals.length) return;

    function activate(idx) {
      steps.forEach((s, i) => s.classList.toggle('active', i === idx));
      visuals.forEach((v, i) => {
        v.style.display = i === idx ? 'flex' : 'none';
      });
    }

    steps.forEach((step, idx) => {
      step.addEventListener('click', () => activate(idx));
    });

    activate(0);
  })();

  // ---------- 6. Contador animado ----------
  (function setupCounters() {
    const counters = document.querySelectorAll('[data-counter]');
    if (!counters.length) return;

    const formatNum = (val, decimals) =>
      decimals > 0
        ? val.toFixed(decimals)
        : Math.round(val).toLocaleString('pt-BR');

    const startCount = (el) => {
      const to = parseFloat(el.getAttribute('data-counter'));
      const suffix = el.getAttribute('data-suffix') || '';
      const decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
      const duration = 1800;
      const start = performance.now();

      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = formatNum(to * eased, decimals) + suffix;
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && !e.target.dataset.counted) {
          e.target.dataset.counted = '1';
          startCount(e.target);
        }
      });
    }, { threshold: 0.4 });

    counters.forEach((c) => obs.observe(c));
  })();

  // ---------- 7. Scroll reveal ----------
  (function setupReveal() {
    const items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.15 });

    items.forEach((el) => obs.observe(el));
  })();

  // ---------- 8. Hover gradient nas matérias ----------
  (function setupSubjectHover() {
    const cards = document.querySelectorAll('.subject-card');
    cards.forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    });
  })();

})();
