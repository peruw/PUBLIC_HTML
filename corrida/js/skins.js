// Corrida Quanta — skins do corredor (cosméticos desbloqueáveis).
// QC.Skins.build(T, id) monta o boneco voxel com as MESMAS proporções do corredor original:
// quadris em (±0.22, 1.02), ombros em (±0.58, 1.92), tronco 0.9 x 1.0 x 0.52 em y=1.5 e cabeça em y=2.36.
// O jogo anima pernas/braços/corpo; update() mexe só nos acessórios (capas, faixas, chamas...).
(() => {
  'use strict';
  window.QC = window.QC || {};

  const LIST = [
    { id: 'quanta', name: 'Quanta', desc: 'O uniforme clássico: boné virado e o alvo da Quanta nas costas.', rarity: 'comum', color: '#1fd685',
      unlock: { type: 'default', value: 0, label: 'Inicial' } },
    { id: 'noturno', name: 'Noturno', desc: 'Moletom preto com faixas neon e capuz. Brilha no escuro.', rarity: 'comum', color: '#7dffc0',
      unlock: { type: 'xp', value: 300, label: 'Acumule 300 pontos' } },
    { id: 'ninja', name: 'Ninja', desc: 'Silencioso e veloz, com a faixa vermelha ao vento.', rarity: 'rara', color: '#ff3b4e',
      unlock: { type: 'combo', value: 8, label: 'Acerte 8 seguidas' } },
    { id: 'robo', name: 'Robô Q-8', desc: 'Calcula mais rápido que a própria sombra. Bip bop.', rarity: 'rara', color: '#46e8ff',
      unlock: { type: 'xp', value: 1500, label: 'Acumule 1.500 pontos' } },
    { id: 'astronauta', name: 'Astronauta', desc: 'Traje espacial completo, com capacete de visor dourado.', rarity: 'rara', color: '#ff8a2a',
      unlock: { type: 'level', value: 4, label: 'Chegue ao nível 4' } },
    { id: 'unicornio', name: 'Unicórnio', desc: 'Crina de arco-íris e chifre de ouro. Pura magia.', rarity: 'épica', color: '#ff9ad5',
      unlock: { type: 'level', value: 6, label: 'Chegue ao nível 6' } },
    { id: 'dourado', name: 'Dourado', desc: 'Ouro maciço da cabeça aos pés. Brilha a cada passo.', rarity: 'épica', color: '#ffd23f',
      unlock: { type: 'best', value: 500, label: 'Faça 500 pontos numa corrida' } },
    { id: 'lava', name: 'Lava', desc: 'Rocha vulcânica rachada e cabelo de fogo.', rarity: 'épica', color: '#ff6a1a',
      unlock: { type: 'speed', value: 2, label: 'Alcance velocidade x2.0' } },
    { id: 'professor', name: 'Dr. Quanta', desc: 'Jaleco, óculos e gravata-borboleta. Homenagem ao professor.', rarity: 'lendária', color: '#eafff3',
      unlock: { type: 'xp', value: 5000, label: 'Acumule 5.000 pontos' } },
    { id: 'arcoiris', name: 'Arco-íris', desc: 'Capa de arco-íris que tremula e cintila com a velocidade.', rarity: 'lendária', color: '#b58cff',
      unlock: { type: 'xp', value: 10000, label: 'Acumule 10.000 pontos' } },
  ];
  const RARITY_COLORS = { comum: '#9fc2b0', rara: '#46b8ff', 'épica': '#c77dff', 'lendária': '#ffd23f' };
  const DEFAULT = 'quanta';
  const byId = (id) => LIST.find((s) => s.id === id) || LIST[0];

  const SKIN = 0xf2c29b;
  const RAINBOW = ['#ff4f6a', '#ff9f3a', '#ffe14a', '#4fe08a', '#4fb4ff', '#a27bff'];
  const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);
  const hx = (n) => '#' + n.toString(16).padStart(6, '0');
  const P = (g, c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w || 1, h || 1); };
  // desenha um bitmap em texto: cada caractere é uma cor da paleta ('.' = nada)
  function bmp(g, x0, y0, lines, pal) {
    lines.forEach((ln, y) => {
      for (let x = 0; x < ln.length; x++) if (pal[ln[x]]) P(g, pal[ln[x]], x0 + x, y0 + y);
    });
  }
  // alvo da Quanta (mesma geometria do targetTex do jogo), n = diâmetro em pixels
  function target(g, x0, y0, n, fill, ring, outer) {
    const s = n / 16, c = (n - 1) / 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - c, y - c) / s;
      if (d > 7.6) continue;
      const isRing = d < 1.8 || (d > 3.2 && d < 4.8);
      P(g, d > 6.2 ? outer : isRing ? ring : fill, x0 + x, y0 + y);
    }
  }

  // ================= Kit: caches e limpeza de uma skin montada =================
  function kit(T) {
    const geos = new Map(), mats = new Map(), own = [], texs = [];
    const k = {
      T,
      geo(w, h, d) {
        const key = w + '|' + h + '|' + d;
        let g = geos.get(key);
        if (!g) { g = new T.BoxGeometry(w, h, d); geos.set(key, g); }
        return g;
      },
      lam(color, emissive) {
        const key = 'l' + color + '|' + (emissive || 0);
        let m = mats.get(key);
        if (!m) { m = new T.MeshLambertMaterial({ color, emissive: emissive || 0 }); mats.set(key, m); }
        return m;
      },
      glow(color) {
        const key = 'g' + color;
        let m = mats.get(key);
        if (!m) { m = new T.MeshBasicMaterial({ color }); mats.set(key, m); }
        return m;
      },
      own(o) { own.push(o); return o; },
      tex(w, h, draw) {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
        draw(g, w, h);
        const t = new T.CanvasTexture(c);
        t.magFilter = T.NearestFilter; t.minFilter = T.NearestFilter; t.generateMipmaps = false;
        texs.push(t);
        return t;
      },
      // material Lambert pintado; com glow=true, o que draw(g, true) pinta também brilha (emissiveMap)
      painted(w, h, draw, glow, extra) {
        const o = Object.assign({ map: k.tex(w, h, (g) => draw(g, false)) }, extra);
        if (glow) {
          o.emissive = 0xffffff;
          o.emissiveMap = k.tex(w, h, (g) => { P(g, '#000', 0, 0, w, h); draw(g, true); });
        }
        return k.own(new T.MeshLambertMaterial(o));
      },
      box(w, h, d, mat, x, y, z, parent) {
        const m = new T.Mesh(k.geo(w, h, d), mat);
        m.position.set(x, y, z); parent.add(m);
        return m;
      },
      pivot(x, y, z, parent) {
        const p = new T.Group(); p.position.set(x, y, z); parent.add(p);
        return p;
      },
      dispose() {
        geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose());
        own.forEach((o) => o.dispose()); texs.forEach((t) => t.dispose());
        geos.clear(); mats.clear(); own.length = 0; texs.length = 0;
      },
    };
    return k;
  }

  // ================= Esqueleto (idêntico ao corredor do jogo) =================
  function rig(T) {
    const group = new T.Group();
    const body = new T.Group(); body.position.y = 0.12; group.add(body);
    const legs = [], arms = [];
    for (const s of [-1, 1]) {
      const hip = new T.Group(); hip.position.set(s * 0.22, 1.02, 0); body.add(hip); legs.push(hip);
      const sh = new T.Group(); sh.position.set(s * 0.58, 1.92, 0); body.add(sh); arms.push(sh);
    }
    const head = new T.Group(); head.position.set(0, 2.36, 0); body.add(head);
    return { group, body, legs, arms, head };
  }
  // faces do BoxGeometry: +x, -x, +y, -y, +z (costas, o que a câmera vê), -z (frente)
  const F = (m, back, front, top) => [m, m, top || m, m, back || m, front || m];

  function stdLegs(k, r, m, extra) {
    r.legs.forEach((hip, i) => {
      k.box(0.34, 0.62, 0.36, m.shorts, 0, -0.3, 0, hip);
      k.box(0.3, 0.36, 0.32, m.shin, 0, -0.78, 0, hip);
      k.box(0.38, 0.2, 0.52, m.shoe, 0, -1.0, -0.06, hip);
      k.box(0.4, 0.06, 0.54, m.sole, 0, -1.1, -0.06, hip);
      if (extra) extra(hip, i ? 1 : -1, i);
    });
  }
  // com m.hand: manga comprida (antebraço + mão); sem: antebraço inteiro
  function stdArms(k, r, m, extra) {
    r.arms.forEach((sh, i) => {
      k.box(0.28, 0.42, 0.3, m.sleeve, 0, -0.18, 0, sh);
      if (m.hand) {
        k.box(0.25, 0.26, 0.27, m.fore, 0, -0.51, 0, sh);
        k.box(0.2, 0.14, 0.22, m.hand, 0, -0.71, 0, sh);
      } else k.box(0.24, 0.4, 0.26, m.fore, 0, -0.58, 0, sh);
      if (extra) extra(sh, i ? 1 : -1, i);
    });
  }
  const torso = (k, r, mats) => k.box(0.9, 1.0, 0.52, mats, 0, 1.5, 0, r.body);
  const skull = (k, r, mats) => k.box(0.66, 0.62, 0.62, mats, 0, 0, 0, r.head);
  // rosto 8x8 na face da frente da cabeça
  const face = (k, bg, lines, pal, glow) => k.painted(8, 8, (g, em) => {
    if (!em) P(g, bg, 0, 0, 8, 8);
    bmp(g, 0, 0, lines, em ? pal.glow || {} : pal);
  }, glow);
  const FACE = ['hhhhhhhh', 'hhh.hhhh', 'h......h', '..e..e..', '..e..e..', '.c....c.', '...mm...', '........'];

  // brilhos (estrelinhas aditivas) que surgem em pontos do corpo
  function sparkles(k, r, n, color, spots) {
    const T = k.T;
    const map = k.tex(7, 7, (g) => {
      bmp(g, 0, 0, ['...a...', '...b...', '..bcb..', 'abcccba', '..bcb..', '...b...', '...a...'],
        { a: 'rgba(255,255,255,0.35)', b: 'rgba(255,255,255,0.8)', c: '#ffffff' });
    });
    const mat = k.own(new T.SpriteMaterial({ map, color, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    const list = [];
    for (let i = 0; i < n; i++) {
      const s = new T.Sprite(mat); s.visible = false; r.body.add(s);
      list.push({ s, life: -i * 0.33, max: 0.5 });
    }
    return (dt) => {
      for (const p of list) {
        p.life -= dt;
        if (p.life <= 0) {
          if (p.life > -0.25) { p.s.visible = false; continue; } // pausa entre brilhos
          const a = spots[Math.floor(Math.random() * spots.length)];
          p.s.position.set(a[0] + (Math.random() - 0.5) * a[3], a[1] + (Math.random() - 0.5) * a[4], a[2]);
          p.max = p.life = 0.35 + Math.random() * 0.3;
          p.s.visible = true;
        }
        const f = Math.sin((1 - p.life / p.max) * Math.PI);
        p.s.scale.set(0.5 * f + 0.05, 0.5 * f + 0.05, 1);
      }
    };
  }

  // ================= Skins =================
  const BUILD = {};

  // Quanta: o visual original do jogo (também serve de molde para o Dourado)
  function classic(k, r, M) {
    stdLegs(k, r, { shorts: M.shorts, shin: M.skin, shoe: M.shoe, sole: M.sole });
    stdArms(k, r, { sleeve: M.shirt, fore: M.skin });
    torso(k, r, F(M.shirt, M.back, M.front));
    skull(k, r, F(M.skin, null, M.face));
    k.box(0.7, 0.36, 0.66, M.hair, 0, 0.12, 0.04, r.head);        // cabelo (nuca)
    k.box(0.72, 0.2, 0.7, M.cap, 0, 0.34, 0, r.head);             // boné
    k.box(0.46, 0.08, 0.34, M.cap, 0, 0.26, 0.48, r.head);        // aba virada para trás
    k.box(0.16, 0.16, 0.06, M.btn, 0, 0.3, 0.36, r.head);         // botão do boné
  }
  const MINI_TARGET = ['.www.', 'w...w', 'w.w.w', 'w...w', '.www.'];

  BUILD.quanta = (k, r) => {
    classic(k, r, {
      shirt: k.lam(0x1fd685), shorts: k.lam(0x0b5a38), skin: k.lam(SKIN), shoe: k.lam(0xeafff3), sole: k.lam(0x1fd685),
      hair: k.lam(0x2a1a10), cap: k.lam(0x0f7a4c), btn: k.lam(0xeafff3),
      back: k.painted(16, 16, (g) => { P(g, '#1fd685', 0, 0, 16, 16); target(g, 0, 0, 16, '#1fd685', '#ffffff', '#ffffff'); }),
      front: k.painted(16, 16, (g) => { P(g, '#1fd685', 0, 0, 16, 16); bmp(g, 9, 3, MINI_TARGET, { w: '#ffffff' }); }),
      face: face(k, hx(SKIN), FACE, { h: '#2a1a10', e: '#1a1410', m: '#a8584a', c: '#f0a58a' }),
    });
  };

  BUILD.dourado = (k, r) => {
    const E = 0x2e1c00; // brilho próprio: o ouro não fica apagado na sombra
    classic(k, r, {
      shirt: k.lam(0xffc933, E), shorts: k.lam(0xc98a12, E), skin: k.lam(0xf0b52a, E), shoe: k.lam(0xffe27a, E),
      sole: k.lam(0xa86c0c, E), hair: k.lam(0xb07510, E), cap: k.lam(0xe0a01c, E), btn: k.lam(0xfff3b0, E),
      back: k.painted(16, 16, (g) => {
        P(g, '#ffc933', 0, 0, 16, 16);
        target(g, 0, 0, 16, '#e8a620', '#fff3b0', '#fff3b0');
        P(g, '#ffffff', 4, 3); P(g, '#ffffff', 3, 4);
      }, false, { emissive: E }),
      front: k.painted(16, 16, (g) => {
        P(g, '#ffc933', 0, 0, 16, 16); bmp(g, 9, 3, MINI_TARGET, { w: '#fff3b0' });
      }, false, { emissive: E }),
      face: k.painted(8, 8, (g) => {
        P(g, '#f0b52a', 0, 0, 8, 8);
        bmp(g, 0, 0, FACE, { h: '#b07510', e: '#6a4006', m: '#a8700c', c: '#ffd86a' });
      }, false, { emissive: E }),
    });
    // pontos (x, y, z, largura, altura) no espaço do corpo: costas, ombros, boné
    return sparkles(k, r, 3, 0xfff6c8, [
      [0, 1.5, 0.3, 0.8, 0.9], [0, 2.8, 0.2, 0.6, 0.1], [-0.58, 2.0, 0.1, 0.2, 0.1], [0.58, 2.0, 0.1, 0.2, 0.1], [0, 2.6, 0.62, 0.4, 0.1],
    ]);
  };

  BUILD.noturno = (k, r) => {
    const cloth = k.lam(0x1d2328), clothD = k.lam(0x15191d), neon = k.glow(0x7dffc0), neonG = k.glow(0x1fd685);
    const NH = '#7dffc0', NG = '#1fd685';
    stdLegs(k, r, { shorts: cloth, shin: clothD, shoe: neonG, sole: k.lam(0x0b0f0d) }, (hip, s) => {
      k.box(0.03, 0.9, 0.08, neon, s * 0.17, -0.47, 0.08, hip);   // listra lateral
      k.box(0.32, 0.06, 0.34, neon, 0, -0.9, 0, hip);             // punho da calça
      k.box(0.3, 0.05, 0.1, k.glow(0xeafff3), 0, -0.9, -0.3, hip); // cadarço claro
    });
    stdArms(k, r, { sleeve: cloth, fore: cloth, hand: k.lam(SKIN) }, (sh, s) => {
      k.box(0.27, 0.05, 0.29, neon, 0, -0.63, 0, sh);
      k.box(0.03, 0.44, 0.08, neonG, s * 0.145, -0.2, 0.06, sh);
    });
    const back = k.painted(16, 16, (g, em) => {
      if (!em) { P(g, '#1d2328', 0, 0, 16, 16); P(g, '#15191d', 0, 13, 16, 3); }
      // lua crescente neon e estrelas
      bmp(g, 4, 2, ['..aaa...', '.aa.....', 'aa......', 'aa......', 'aa......', 'aa......', '.aa.....', '..aaa...'], { a: NH });
      bmp(g, 9, 3, ['b..', '...', '..b'], { b: NG });
      P(g, NH, 10, 7); P(g, NG, 12, 9);
      P(g, NG, 0, 13, 16, 1);
    }, true);
    const front = k.painted(16, 16, (g, em) => {
      if (!em) { P(g, '#1d2328', 0, 0, 16, 16); P(g, '#15191d', 3, 9, 10, 4); P(g, '#15191d', 0, 13, 16, 3); }
      P(g, NG, 3, 9, 10, 1); P(g, NG, 0, 13, 16, 1);
    }, true);
    torso(k, r, F(cloth, back, front));
    k.box(0.04, 0.34, 0.04, neon, -0.12, 1.8, -0.28, r.body);   // cordões do capuz
    k.box(0.04, 0.3, 0.04, neon, 0.12, 1.82, -0.28, r.body);
    k.box(0.92, 0.06, 0.54, neonG, 0, 1.04, 0, r.body);        // barra que brilha
    // cabeça na sombra do capuz, só os olhos acesos
    skull(k, r, F(k.lam(0x0d1411)));
    const eyes = k.glow(0x7dffc0);
    k.box(0.12, 0.07, 0.02, eyes, -0.13, 0.0, -0.315, r.head);
    k.box(0.12, 0.07, 0.02, eyes, 0.13, 0.0, -0.315, r.head);
    // capuz: topo, laterais e costas (aberto na frente)
    k.box(0.82, 0.12, 0.76, cloth, 0, 0.37, 0.03, r.head);
    k.box(0.08, 0.66, 0.76, cloth, -0.37, 0.02, 0.03, r.head);
    k.box(0.08, 0.66, 0.76, cloth, 0.37, 0.02, 0.03, r.head);
    k.box(0.66, 0.62, 0.1, cloth, 0, 0.02, 0.36, r.head);
    k.box(0.3, 0.14, 0.16, cloth, 0, 0.36, 0.38, r.head);      // bico do capuz
    k.box(0.82, 0.05, 0.05, neon, 0, 0.33, -0.34, r.head);     // borda neon da abertura
    k.box(0.05, 0.62, 0.05, neon, -0.36, 0.02, -0.34, r.head);
    k.box(0.05, 0.62, 0.05, neon, 0.36, 0.02, -0.34, r.head);
    k.box(0.05, 0.05, 0.6, neonG, 0, 0.435, 0.02, r.head);      // costura neon
    k.box(0.05, 0.5, 0.05, neonG, 0, 0.08, 0.415, r.head);
    // neon pulsando de leve
    const c0 = new k.T.Color(0x7dffc0), c1 = new k.T.Color(0x3fe8a0);
    return (dt, t) => { neon.color.copy(c0).lerp(c1, 0.5 + 0.5 * Math.sin(t * 4)); };
  };

  BUILD.ninja = (k, r) => {
    const gi = k.lam(0x23253a), giL = k.lam(0x30334f), red = k.lam(0xe0283a), redD = k.lam(0xa3141f);
    const wrap = k.painted(4, 8, (g) => { P(g, '#30334f', 0, 0, 4, 8); for (let y = 0; y < 8; y += 2) P(g, '#23253a', 0, y, 4, 1); });
    stdLegs(k, r, { shorts: gi, shin: wrap, shoe: k.lam(0x17182a), sole: k.lam(0x3a3d58) });
    stdArms(k, r, { sleeve: gi, fore: wrap });
    const back = k.painted(16, 16, (g) => {
      P(g, '#23253a', 0, 0, 16, 16);
      // emblema (mon) vermelho discreto
      bmp(g, 5, 4, ['..rr..', '.r..r.', 'r.rr.r', 'r.rr.r', '.r..r.', '..rr..'], { r: '#c01f30' });
    });
    const front = k.painted(16, 16, (g) => {
      P(g, '#23253a', 0, 0, 16, 16);
      for (let i = 0; i < 9; i++) { P(g, '#3a3d5c', 3 + i, i); P(g, '#3a3d5c', 12 - Math.min(i, 4), i); }
    });
    torso(k, r, F(gi, back, front));
    k.box(0.94, 0.14, 0.56, red, 0, 1.1, 0, r.body);                 // faixa (obi)
    k.box(0.18, 0.16, 0.08, redD, 0.2, 1.1, 0.3, r.body);           // nó
    k.box(0.08, 0.26, 0.04, red, 0.16, 0.94, 0.32, r.body);
    k.box(0.08, 0.2, 0.04, red, 0.26, 0.97, 0.32, r.body);
    // katana nas costas, cabo por cima do ombro direito
    const sword = k.pivot(0.02, 1.5, 0.33, r.body); sword.rotation.z = -0.72;
    k.box(0.12, 1.2, 0.1, k.lam(0x1a0c10), 0, 0, 0, sword);
    k.box(0.13, 0.08, 0.11, redD, 0, -0.35, 0, sword);
    k.box(0.24, 0.05, 0.16, k.lam(0xd8b24a), 0, 0.62, 0, sword);
    k.box(0.1, 0.36, 0.1, k.painted(2, 6, (g) => { P(g, '#e0283a', 0, 0, 2, 6); P(g, '#23253a', 0, 1); P(g, '#23253a', 1, 3); P(g, '#23253a', 0, 5); }), 0, 0.83, 0, sword);
    // cabeça coberta, só a fenda dos olhos
    const mask = face(k, '#23253a', ['........', '........', '........', '.ssssss.', '.sesses.', '........', '........', '........'],
      { s: hx(SKIN), e: '#141414' });
    skull(k, r, F(gi, null, mask));
    k.box(0.7, 0.13, 0.66, red, 0, 0.17, 0, r.head);                  // faixa da cabeça
    k.box(0.24, 0.1, 0.03, k.lam(0xb8c0c8), 0, 0.17, -0.34, r.head);  // plaquinha de metal
    k.box(0.18, 0.18, 0.1, redD, 0, 0.17, 0.36, r.head);             // nó
    // as duas pontas da faixa, em 2 segmentos cada, tremulando atrás
    const tails = [];
    for (const s of [-1, 1]) {
      const a = k.pivot(s * 0.05, 0.17, 0.4, r.head); a.rotation.y = s * 0.28;
      k.box(0.12, 0.05, 0.36, red, 0, 0, 0.18, a);
      const b = k.pivot(0, 0, 0.36, a);
      k.box(0.1, 0.05, 0.3, red, 0, 0, 0.15, b);
      tails.push({ a, b, ph: s > 0 ? 0 : 1.7, s });
    }
    return (dt, t, sf) => {
      const f = 10 + sf * 10, amp = 0.22 + sf * 0.12, droop = 0.55 - sf * 0.4;
      for (const p of tails) {
        p.a.rotation.x = droop + Math.sin(t * f + p.ph) * amp;
        p.b.rotation.x = Math.sin(t * f + p.ph - 1.3) * amp * 1.5;
        p.b.rotation.y = p.s * 0.12 * Math.sin(t * f * 0.5 + p.ph);
      }
    };
  };

  BUILD.robo = (k, r) => {
    const T = k.T;
    const plate = (base, edge, dot) => k.painted(8, 8, (g) => {
      P(g, base, 0, 0, 8, 8); P(g, edge, 0, 0, 8, 1); P(g, edge, 0, 7, 8, 1); P(g, edge, 0, 0, 1, 8); P(g, edge, 7, 0, 1, 8);
      P(g, dot, 1, 1); P(g, dot, 6, 1); P(g, dot, 1, 6); P(g, dot, 6, 6);
    });
    const metal = plate('#9aa4ae', '#7a8490', '#d6dde4'), dark = k.lam(0x4b5461), joint = k.lam(0x2c323a);
    const light = k.lam(0xd0d7de), cyan = k.glow(0x46e8ff);
    r.legs.forEach((hip) => {
      k.box(0.34, 0.5, 0.36, metal, 0, -0.24, 0, hip);
      k.box(0.24, 0.12, 0.26, joint, 0, -0.55, 0, hip);
      k.box(0.3, 0.36, 0.32, metal, 0, -0.78, 0, hip);
      k.box(0.4, 0.22, 0.54, dark, 0, -0.99, -0.06, hip);
      k.box(0.42, 0.05, 0.56, joint, 0, -1.1, -0.06, hip);
      k.box(0.2, 0.06, 0.02, cyan, 0, -0.98, -0.34, hip);            // luz no bico do pé
    });
    r.arms.forEach((sh, i) => {
      const s = i ? 1 : -1;
      k.box(0.36, 0.18, 0.38, dark, 0, 0.02, 0, sh);                // ombreira
      k.box(0.06, 0.1, 0.1, light, s * 0.2, 0.02, 0, sh);            // parafuso
      k.box(0.28, 0.3, 0.3, metal, 0, -0.2, 0, sh);
      k.box(0.2, 0.08, 0.22, joint, 0, -0.39, 0, sh);
      k.box(0.24, 0.26, 0.26, metal, 0, -0.55, 0, sh);
      k.box(0.22, 0.12, 0.24, dark, 0, -0.73, 0, sh);                // garra
    });
    const back = k.painted(16, 16, (g, em) => {
      if (!em) {
        P(g, '#9aa4ae', 0, 0, 16, 16); P(g, '#6d7784', 1, 1, 14, 14); P(g, '#aab4be', 2, 2, 12, 12);
        for (let y = 3; y < 8; y += 2) P(g, '#3a414b', 4, y, 8, 1);     // grades de ventilação
        bmp(g, 1, 1, ['d............d'], { d: '#e6ecf1' });
        bmp(g, 1, 14, ['d............d'], { d: '#e6ecf1' });
        P(g, '#3a414b', 5, 9, 6, 4);
      }
      P(g, '#46e8ff', 6, 10, 4, 2); P(g, '#c8fbff', 7, 10, 2, 1);  // núcleo de energia
      P(g, '#3dff8a', 12, 12); P(g, '#ff3b4e', 3, 12);
    }, true);
    const Q8 = ['qqq.....888', 'q.q.....8.8', 'q.q.---.888', 'qq......8.8', '.qq.....888'];
    const front = k.painted(16, 16, (g, em) => {
      if (!em) { P(g, '#9aa4ae', 0, 0, 16, 16); P(g, '#6d7784', 1, 1, 14, 14); P(g, '#aab4be', 2, 2, 12, 12); P(g, '#3a414b', 2, 9, 12, 6); }
      bmp(g, 3, 3, Q8, { q: '#2c323a', 8: '#2c323a', '-': '#2c323a' });
      P(g, '#46e8ff', 3, 11, 2, 2); P(g, '#ffd23f', 7, 11, 2, 2); P(g, '#ff3b4e', 11, 11, 2, 2);
    }, true);
    torso(k, r, F(metal, back, front, light));
    k.box(0.5, 0.1, 0.4, joint, 0, 2.03, 0, r.body);                // pescoço
    // cabeça quadrada com visor e antena
    const headBack = k.painted(8, 8, (g) => {
      P(g, '#9aa4ae', 0, 0, 8, 8); P(g, '#7a8490', 0, 0, 8, 1); P(g, '#7a8490', 0, 7, 8, 1);
      for (let y = 2; y < 6; y += 2) P(g, '#3a414b', 2, y, 4, 1);
    });
    const headFront = k.painted(8, 8, (g) => {
      P(g, '#9aa4ae', 0, 0, 8, 8); P(g, '#7a8490', 0, 0, 8, 1);
      P(g, '#1a1f26', 1, 2, 6, 3);                                 // fundo do visor
      for (let x = 2; x < 6; x++) P(g, '#3a414b', x, 6);          // grade da boca
      P(g, '#7a8490', 1, 6); P(g, '#7a8490', 6, 6);
    });
    skull(k, r, F(metal, headBack, headFront, light));
    k.box(0.56, 0.16, 0.02, k.glow(0x0e5a66), 0, 0.04, -0.315, r.head);  // visor
    const scan = k.box(0.14, 0.12, 0.02, cyan, 0, 0.04, -0.328, r.head); // olho que varre
    for (const s of [-1, 1]) {
      k.box(0.08, 0.22, 0.22, joint, s * 0.36, 0.0, 0, r.head);
      k.box(0.05, 0.1, 0.1, light, s * 0.42, 0.0, 0, r.head);
    }
    k.box(0.05, 0.32, 0.05, joint, 0.16, 0.46, 0.08, r.head);            // antena
    const tipMat = k.own(new T.MeshBasicMaterial({ color: 0xff3b4e }));
    k.box(0.13, 0.13, 0.13, tipMat, 0.16, 0.66, 0.08, r.head);
    const haloMap = k.tex(5, 5, (g) => bmp(g, 0, 0, ['.aba.', 'abcba', 'bcccb', 'abcba', '.aba.'],
      { a: 'rgba(255,255,255,0.15)', b: 'rgba(255,255,255,0.5)', c: '#ffffff' }));
    const halo = new T.Sprite(k.own(new T.SpriteMaterial({ map: haloMap, color: 0xff3b4e, transparent: true, depthWrite: false, blending: T.AdditiveBlending })));
    halo.scale.set(0.45, 0.45, 1); halo.position.set(0.16, 0.66, 0.08); r.head.add(halo);
    return (dt, t) => {
      const on = (t % 0.9) < 0.3;
      tipMat.color.setHex(on ? 0xff3b4e : 0x5a1822);
      halo.visible = on;
      scan.position.x = Math.round(Math.sin(t * 3.2) * 3) * 0.066; // passo de "pixel"
    };
  };

  BUILD.astronauta = (k, r) => {
    const T = k.T;
    const suit = k.lam(0xeef2f5), shade = k.lam(0xc7cfd8), orange = k.lam(0xff7a1a), gray = k.lam(0x8a94a1), dark = k.lam(0x3a4250);
    r.legs.forEach((hip) => {
      k.box(0.34, 0.62, 0.36, suit, 0, -0.3, 0, hip);
      k.box(0.36, 0.07, 0.38, orange, 0, -0.5, 0, hip);             // faixa do joelho
      k.box(0.3, 0.3, 0.32, suit, 0, -0.74, 0, hip);
      k.box(0.42, 0.26, 0.56, shade, 0, -0.97, -0.05, hip);          // bota
      k.box(0.44, 0.05, 0.58, dark, 0, -1.1, -0.05, hip);
      k.box(0.43, 0.05, 0.57, orange, 0, -0.86, -0.05, hip);
    });
    stdArms(k, r, { sleeve: suit, fore: suit, hand: gray }, (sh) => {
      k.box(0.3, 0.07, 0.32, orange, 0, -0.12, 0, sh);
      k.box(0.26, 0.05, 0.28, gray, 0, -0.63, 0, sh);
    });
    const front = k.painted(16, 16, (g, em) => {
      if (!em) {
        P(g, '#eef2f5', 0, 0, 16, 16); P(g, '#c7cfd8', 0, 12, 16, 1); P(g, '#ff7a1a', 0, 13, 16, 1);
        P(g, '#3a4250', 4, 3, 8, 6); P(g, '#8a94a1', 4, 3, 8, 1);
      }
      P(g, '#ff3b4e', 5, 5); P(g, '#3dff8a', 7, 5); P(g, '#46b8ff', 9, 5); P(g, '#ffd23f', 5, 7, 6, 1);
    }, true);
    torso(k, r, F(suit, null, front));
    // mochila de suporte de vida (o que a câmera mais vê)
    const pack = k.painted(16, 16, (g, em) => {
      if (!em) {
        P(g, '#c3ccd6', 0, 0, 16, 16); P(g, '#8a94a1', 0, 0, 16, 1); P(g, '#8a94a1', 0, 15, 16, 1); P(g, '#8a94a1', 0, 0, 1, 16); P(g, '#8a94a1', 15, 0, 1, 16);
        for (let y = 2; y < 6; y += 2) P(g, '#6d7784', 3, y, 10, 1);
        P(g, '#ff7a1a', 1, 8, 14, 2);
        P(g, '#3a4250', 5, 11, 6, 3);
      }
      P(g, '#46e8ff', 6, 12, 4, 1);
    }, true);
    const packS = k.lam(0xa9b3bf);
    k.box(0.76, 0.8, 0.3, F(packS, pack, packS, shade), 0, 1.5, 0.4, r.body);
    for (const s of [-1, 1]) k.box(0.2, 0.12, 0.2, gray, s * 0.22, 1.96, 0.4, r.body);
    const ledA = k.own(new T.MeshBasicMaterial({ color: 0x3dff8a }));
    k.box(0.08, 0.08, 0.04, ledA, 0.28, 1.8, 0.56, r.body);
    k.box(0.08, 0.08, 0.04, k.glow(0xff3b4e), -0.28, 1.8, 0.56, r.body);
    // capacete grande com visor dourado
    const helmBack = k.painted(8, 8, (g) => {
      P(g, '#eef2f5', 0, 0, 8, 8); P(g, '#c7cfd8', 0, 0, 1, 8); P(g, '#c7cfd8', 7, 0, 1, 8); P(g, '#c7cfd8', 0, 7, 8, 1);
      P(g, '#ff7a1a', 1, 5, 6, 1); P(g, '#ffffff', 2, 1, 2, 1);
    });
    k.box(0.86, 0.76, 0.82, F(suit, helmBack, suit), 0, 0.06, 0.02, r.head);
    k.box(0.7, 0.08, 0.68, suit, 0, 0.47, 0.02, r.head);               // topo arredondado
    const visor = k.painted(8, 6, (g) => {
      P(g, '#ffc23a', 0, 0, 8, 6); P(g, '#e09a18', 0, 4, 8, 2); P(g, '#b0700c', 0, 5, 8, 1);
      P(g, '#fff4c0', 1, 1, 2, 1); P(g, '#fff4c0', 1, 2); P(g, '#ffe28a', 5, 1);
    }, false, { emissive: 0x4a3000 });
    k.box(0.68, 0.46, 0.04, F(k.lam(0x9a6a10), null, visor), 0, 0.04, -0.4, r.head);
    k.box(0.72, 0.08, 0.72, gray, 0, -0.36, 0.0, r.head);             // anel do pescoço
    for (const s of [-1, 1]) {
      k.box(0.08, 0.12, 0.16, gray, s * 0.46, 0.2, -0.12, r.head);    // lanterninhas
      k.box(0.06, 0.08, 0.02, k.glow(0xfff4c0), s * 0.46, 0.2, -0.21, r.head);
    }
    return (dt, t) => { ledA.color.setHex((t % 1.2) < 0.6 ? 0x3dff8a : 0x0e4a26); };
  };

  BUILD.unicornio = (k, r) => {
    const white = k.lam(0xfbf7ff), pink = k.lam(0xffb3da), lilac = k.lam(0xc2a6ff), gold = k.lam(0xffd23f, 0x3a2600), goldL = k.lam(0xfff0a0, 0x3a2600);
    stdLegs(k, r, { shorts: pink, shin: white, shoe: lilac, sole: gold });
    stdArms(k, r, { sleeve: white, fore: white, hand: lilac }, (sh) => k.box(0.26, 0.05, 0.28, pink, 0, -0.62, 0, sh));
    const back = k.painted(16, 16, (g) => {
      P(g, '#fbf7ff', 0, 0, 16, 16);
      bmp(g, 4, 5, ['.pp..pp.', 'pppppppp', 'pppppppp', '.pppppp.', '..pppp..', '...pp...'], { p: '#ff9ad0' });
      bmp(g, 5, 6, ['w'], { w: '#ffffff' });
      P(g, '#c2a6ff', 1, 2); P(g, '#9ff0d0', 13, 3); P(g, '#ffe28a', 2, 12); P(g, '#c2a6ff', 13, 12);
    });
    const front = k.painted(16, 16, (g) => {
      P(g, '#fbf7ff', 0, 0, 16, 16);
      RAINBOW.forEach((c, i) => P(g, c, 4 + i, 4 + (i % 2), 1, 3));
    });
    torso(k, r, F(white, back, front));
    const faceM = face(k, '#fbf7ff', ['........', '........', '.l....l.', '..ee.ee.', '..ee.ee.', '.c....c.', '...mm...', '........'],
      { l: '#3a2a4a', e: '#3a2a4a', c: '#ffb3da', m: '#ff7ab8' });
    skull(k, r, F(white, null, faceM));
    // orelhas
    for (const s of [-1, 1]) {
      k.box(0.14, 0.2, 0.1, white, s * 0.23, 0.4, 0.02, r.head);
      k.box(0.07, 0.12, 0.02, pink, s * 0.23, 0.39, -0.035, r.head);
    }
    // chifre dourado em degraus
    k.box(0.16, 0.14, 0.16, gold, 0, 0.38, -0.2, r.head);
    k.box(0.12, 0.14, 0.12, goldL, 0, 0.5, -0.24, r.head);
    k.box(0.08, 0.12, 0.08, gold, 0, 0.62, -0.28, r.head);
    k.box(0.04, 0.08, 0.04, goldL, 0, 0.71, -0.31, r.head);
    // crina de arco-íris: do alto da cabeça descendo pela nuca
    const MANE = [[0.36, -0.06, 0.22, 0.12, 0.2], [0.38, 0.14, 0.26, 0.14, 0.2], [0.3, 0.33, 0.28, 0.16, 0.14],
      [0.1, 0.38, 0.28, 0.22, 0.14], [-0.13, 0.38, 0.28, 0.22, 0.14], [-0.35, 0.34, 0.26, 0.2, 0.14]];
    const mane = MANE.map((m, i) => {
      const p = k.pivot(0, m[0], m[1], r.head);
      k.box(m[2], m[3], m[4], k.lam(parseInt(RAINBOW[i].slice(1), 16), 0x201020), 0, 0, 0, p);
      return p;
    });
    // rabinho
    const tail = [];
    let par = r.body, z0 = 0.3, y0 = 1.1;
    ['#ff7ab8', '#a27bff', '#4fb4ff'].forEach((c, i) => {
      const p = k.pivot(0, y0, z0, par);
      k.box(0.2 - i * 0.03, 0.22 - i * 0.03, 0.26, k.lam(parseInt(c.slice(1), 16)), 0, 0, 0.13, p);
      tail.push(p); par = p; z0 = 0.26; y0 = 0;
    });
    return (dt, t, sf) => {
      const f = 9 + sf * 8;
      for (let i = 0; i < mane.length; i++) mane[i].position.x = Math.round(Math.sin(t * f - i * 0.9) * 1.5) * 0.025;
      const lift = 0.45 - sf * 0.3;
      for (let i = 0; i < tail.length; i++) {
        tail[i].rotation.x = (i ? 0.25 : lift) + Math.sin(t * f - i) * 0.15;
        tail[i].rotation.y = Math.sin(t * f * 0.6 - i * 0.8) * 0.3;
      }
    };
  };

  BUILD.lava = (k, r) => {
    const T = k.T;
    // rachaduras: lista de pixels gerada uma vez e usada no mapa e no emissiveMap
    const crackPts = (w, h, n) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        let x = Math.floor(Math.random() * w), y = Math.floor(Math.random() * h), dx = Math.random() < 0.5 ? 1 : -1;
        const len = 3 + Math.floor(Math.random() * Math.max(w, h) * 0.6);
        for (let j = 0; j < len && x >= 0 && x < w && y < h; j++) {
          pts.push(x, y, j % 4 === 1 ? 1 : 0);
          if (Math.random() < 0.55) x += dx; else y += 1;
          if (Math.random() < 0.2) dx = -dx;
        }
      }
      return pts;
    };
    const rock = (w, h, n, extra) => {
      const pts = crackPts(w, h, n);
      return k.painted(w, h, (g, em) => {
        if (!em) {
          P(g, '#2b2426', 0, 0, w, h);
          for (let i = 0; i < w * h / 5; i++) P(g, Math.random() < 0.5 ? '#3a3033' : '#1c1718', Math.floor(Math.random() * w), Math.floor(Math.random() * h));
        }
        for (let i = 0; i < pts.length; i += 3) P(g, pts[i + 2] ? '#ffd23f' : '#ff6a1a', pts[i], pts[i + 1]);
        if (extra) extra(g, em);
      }, true);
    };
    const limb = rock(8, 8, 2), body16 = rock(16, 16, 5), headM = rock(8, 8, 1);
    const faceM = rock(8, 8, 0, (g, em) => {
      bmp(g, 0, 0, ['........', '........', '.yy..yy.', '.oy..yo.', '........', '..o..o..', '...oo...', '........'], { y: '#ffe14a', o: '#ff6a1a' });
    });
    const glowMats = [limb, body16, headM, faceM];
    const dark = k.lam(0x1f1a1b), lavaSole = k.glow(0xff6a1a);
    stdLegs(k, r, { shorts: limb, shin: limb, shoe: dark, sole: lavaSole });
    stdArms(k, r, { sleeve: limb, fore: limb });
    torso(k, r, F(body16, body16, body16, limb));
    skull(k, r, F(headM, headM, faceM, headM));
    // cabelo de fogo: colunas que tremulam, inclinadas pelo vento
    const red = k.glow(0xff4a1a), orange = k.glow(0xff9a1a), yellow = k.glow(0xffe14a);
    const COLS = [[-0.22, -0.2, 0.22], [0, -0.22, 0.3], [0.22, -0.2, 0.22], [-0.24, 0.02, 0.34], [0, 0, 0.5], [0.24, 0.02, 0.34],
      [-0.2, 0.22, 0.26], [0, 0.24, 0.4], [0.2, 0.22, 0.26]];
    const flames = COLS.map((c, i) => {
      const p = k.pivot(c[0], 0.3, c[1], r.head);
      const a = k.box(0.22, 1, 0.22, i % 2 ? red : orange, 0, 0.5, 0, p);
      a.scale.y = c[2]; a.position.y = c[2] / 2;
      const b = k.box(0.12, 1, 0.12, yellow, 0, 0, 0, p);
      b.scale.y = c[2] * 0.5; b.position.y = c[2] + c[2] * 0.25;
      return { p, ph: Math.random() * 6, sp: 11 + Math.random() * 8 };
    });
    // brasas subindo
    const embers = [];
    for (let i = 0; i < 4; i++) {
      const m = k.box(0.08, 0.08, 0.08, i % 2 ? yellow : orange, 0, 0, 0, r.head);
      m.visible = false;
      embers.push({ m, life: -i * 0.2, max: 1 });
    }
    return (dt, t, sf) => {
      const e = 0.8 + 0.15 * Math.sin(t * 5.3) + 0.08 * Math.sin(t * 17.7);
      for (const m of glowMats) m.emissiveIntensity = e;
      const lean = -(0.2 + sf * 0.5);
      for (const f of flames) {
        f.p.scale.y = 0.7 + 0.35 * Math.abs(Math.sin(t * f.sp + f.ph)) + 0.1 * Math.sin(t * 29 + f.ph);
        f.p.rotation.x = lean + Math.sin(t * 7 + f.ph) * 0.08;
      }
      for (const b of embers) {
        b.life -= dt;
        if (b.life <= 0) {
          if (b.life > -0.15) { b.m.visible = false; continue; }
          b.m.position.set((Math.random() - 0.5) * 0.5, 0.55 + Math.random() * 0.2, (Math.random() - 0.5) * 0.4);
          b.max = b.life = 0.5 + Math.random() * 0.4;
          b.m.visible = true;
        }
        b.m.position.y += dt * 1.4;
        b.m.position.z += dt * (1 + sf * 3);
        const s = b.life / b.max;
        b.m.scale.set(s, s, s);
      }
    };
  };

  BUILD.professor = (k, r) => {
    const coat = k.lam(0xf2f6f4), coatS = k.lam(0xd6ddda), pants = k.lam(0x384050), skin = k.lam(SKIN), hair = k.lam(0x241810);
    stdLegs(k, r, { shorts: pants, shin: pants, shoe: k.lam(0x4a2c1a), sole: k.lam(0x17110d) }, (hip) => {
      k.box(0.38, 0.46, 0.05, coat, 0, -0.2, -0.2, hip);            // aba da frente do jaleco (acompanha a perna)
    });
    stdArms(k, r, { sleeve: coat, fore: coat, hand: skin }, (sh) => k.box(0.26, 0.04, 0.28, coatS, 0, -0.62, 0, sh));
    const back = k.painted(16, 16, (g) => {
      P(g, '#f2f6f4', 0, 0, 16, 16);
      target(g, 3, 1, 10, '#1fd685', '#ffffff', '#0f7a4c');
      P(g, '#c9d2ce', 0, 12, 16, 2); P(g, '#8a948f', 3, 12); P(g, '#8a948f', 12, 12);  // meia-cinta com botões
      P(g, '#c9d2ce', 7, 14, 2, 2);                                                    // começo da fenda
    });
    const front = k.painted(16, 16, (g) => {
      P(g, '#f2f6f4', 0, 0, 16, 16);
      P(g, '#cfe6ff', 6, 0, 4, 16);                                // camisa azul
      for (let i = 0; i < 5; i++) { P(g, '#c9d2ce', 5 - Math.floor(i / 2), i); P(g, '#c9d2ce', 10 + Math.floor(i / 2), i); } // lapelas
      P(g, '#c9d2ce', 5, 5, 1, 11); P(g, '#c9d2ce', 10, 5, 1, 11);
      P(g, '#c9d2ce', 11, 7, 3, 3); P(g, '#1fd685', 12, 6, 1, 2); P(g, '#3a6ad8', 13, 6);  // bolso com canetas
      P(g, '#8a948f', 4, 8); P(g, '#8a948f', 4, 12);
    });
    torso(k, r, F(coat, back, front));
    k.box(0.56, 0.12, 0.14, coat, 0, 2.02, 0.2, r.body);             // gola
    const bow = k.lam(0x1fd685);
    k.box(0.08, 0.09, 0.06, k.lam(0x0f7a4c), 0, 1.93, -0.29, r.body); // gravata-borboleta
    k.box(0.12, 0.14, 0.05, bow, -0.09, 1.93, -0.285, r.body);
    k.box(0.12, 0.14, 0.05, bow, 0.09, 1.93, -0.285, r.body);
    // abas de trás do jaleco (tremulam)
    const tails = [-1, 1].map((s) => {
      const p = k.pivot(s * 0.225, 1.04, 0.24, r.body);
      k.box(0.44, 0.58, 0.05, coat, 0, -0.29, 0, p);
      return p;
    });
    // cabeça: cabelo penteado, óculos
    const faceM = face(k, hx(SKIN), ['hhhhhhhh', 'hhhhh...', 'h......h', '.bb..bb.', '..e..e..', '........', '..mmmm..', '........'],
      { h: '#241810', b: '#241810', e: '#1a1410', m: '#a8584a' });
    skull(k, r, F(skin, null, faceM));
    k.box(0.7, 0.4, 0.66, hair, 0, 0.12, 0.04, r.head);
    const top = k.painted(8, 8, (g) => { P(g, '#241810', 0, 0, 8, 8); P(g, '#3a281c', 2, 0, 1, 8); P(g, '#3a281c', 5, 1, 1, 5); });
    k.box(0.72, 0.1, 0.7, F(hair, hair, hair, top), 0, 0.33, 0.01, r.head);
    k.box(0.4, 0.1, 0.12, hair, 0.12, 0.3, -0.31, r.head);            // topete para o lado
    const frame = k.lam(0x15181b), lens = k.glow(0xcfefff);
    for (const s of [-1, 1]) {
      k.box(0.24, 0.17, 0.03, frame, s * 0.15, 0.03, -0.325, r.head);
      k.box(0.16, 0.09, 0.02, lens, s * 0.15, 0.03, -0.345, r.head);
      k.box(0.03, 0.04, 0.58, frame, s * 0.345, 0.05, -0.04, r.head); // hastes
    }
    k.box(0.08, 0.03, 0.03, frame, 0, 0.06, -0.33, r.head);
    return (dt, t, sf) => {
      const f = 9 + sf * 9, base = -(0.35 + sf * 0.4);
      for (let i = 0; i < 2; i++) {
        let a = base - (0.08 + sf * 0.1) * (1 + Math.sin(t * f + i * 2.1));
        const leg = r.legs[i].rotation.x - 0.08;                    // não atravessar a perna que vai para trás
        if (leg < a) a = leg;
        tails[i].rotation.x = a;
      }
    };
  };

  BUILD.arcoiris = (k, r) => {
    const T = k.T;
    const stripes = (w, h) => k.painted(w, h, (g) => {
      for (let y = 0; y < h; y++) P(g, RAINBOW[Math.floor(y * RAINBOW.length / h)], 0, y, w, 1);
    });
    const shirt = stripes(8, 12), sleeve = stripes(4, 6), skin = k.lam(SKIN);
    stdLegs(k, r, { shorts: k.lam(0x2a2350), shin: skin, shoe: k.lam(0xffffff), sole: k.lam(0xff5ab4) });
    stdArms(k, r, { sleeve, fore: skin });
    torso(k, r, F(shirt, shirt, shirt, k.lam(0xff4f6a)));
    const faceM = face(k, hx(SKIN), FACE, { h: '#3a2414', e: '#1a1410', m: '#a8584a', c: '#f0a58a' });
    skull(k, r, F(skin, null, faceM));
    k.box(0.7, 0.36, 0.66, k.lam(0x3a2414), 0, 0.14, 0.04, r.head);
    for (let i = 0; i < 3; i++) k.box(0.18, 0.14, 0.22, k.lam(0x3a2414), -0.2 + i * 0.2, 0.36, -0.12 + i * 0.12, r.head);
    const band = k.painted(12, 2, (g) => { P(g, '#ffffff', 0, 0, 12, 2); RAINBOW.forEach((c, i) => P(g, c, i * 2, 1, 2, 1)); });
    k.box(0.74, 0.12, 0.72, band, 0, 0.2, 0.04, r.head);                 // faixa na testa
    // capa de arco-íris em 3 segmentos encadeados; listras correm e cintilam
    const capeTex = k.tex(12, 1, (g) => RAINBOW.forEach((c, i) => P(g, c, i * 2, 0, 2, 1)));
    capeTex.wrapS = T.RepeatWrapping;
    const hemTex = k.tex(12, 8, (g) => {
      for (let y = 0; y < 8; y++) RAINBOW.forEach((c, i) => P(g, c, i * 2, y, 2, 1));
      for (let x = 0; x < 12; x++) { const d = (x % 4 < 2 ? x % 4 : 3 - x % 4) + 1; g.clearRect(x, 8 - d * 2 + 1, 1, d * 2); }
    });
    hemTex.wrapS = T.RepeatWrapping;
    const segs = [];
    let par = r.body, y = 2.0, z = 0.3;
    for (let i = 0; i < 3; i++) {
      const mat = k.own(new T.MeshBasicMaterial({ map: i < 2 ? capeTex : hemTex, alphaTest: i < 2 ? 0 : 0.5, side: T.DoubleSide }));
      const p = k.pivot(0, y, z, par);
      const h = i < 2 ? 0.38 : 0.42;
      k.box(0.98, h, 0.04, mat, 0, -h / 2, 0, p);
      segs.push({ p, mat });
      par = p; y = -h; z = 0;
    }
    const gold = k.lam(0xffd23f, 0x3a2600);
    for (const s of [-1, 1]) k.box(0.14, 0.12, 0.14, gold, s * 0.36, 2.0, 0.26, r.body);   // presilhas
    return (dt, t, sf) => {
      const f = 8 + sf * 10, base = 0.16 + sf * 0.4;
      for (let i = 0; i < 3; i++) {
        segs[i].p.rotation.x = -(i ? 0.1 + sf * 0.08 : base) - Math.sin(t * f - i * 1.1) * (0.08 + sf * 0.07);
        const b = 0.82 + 0.18 * Math.sin(t * 6 - i * 1.4);
        segs[i].mat.color.setRGB(b, b, b);
      }
      capeTex.offset.x = hemTex.offset.x = Math.floor(t * (3 + sf * 6)) / 12;  // desliza de pixel em pixel
    };
  };

  // ================= API =================
  function build(T, id) {
    const def = byId(id);
    const k = kit(T);
    const r = rig(T);
    const anim = BUILD[def.id](k, r) || null;
    return {
      id: def.id,
      group: r.group, body: r.body, legs: r.legs, arms: r.arms, head: r.head,
      update(dt, t, speedFactor) { if (anim) anim(Math.min(dt || 0, 0.1), t || 0, clamp01(speedFactor || 0)); },
      dispose() {
        if (r.group.parent) r.group.parent.remove(r.group);
        k.dispose();
      },
    };
  }

  QC.Skins = {
    list: LIST,
    DEFAULT,
    RARITY_COLORS,
    get: byId,
    build,
  };
})();
