// Corrida Quanta — modos de jogo: Matemática (contas geradas), Química e Física (bancos de perguntas).
// Texto "rico": _x ou _{xy} = índice (subscrito), ^x ou ^{xy} = expoente. Ex.: H_2O, C_6H_{12}O_6, v_0^2.
// Cada pergunta: { title (linha de cima, opcional), text (o que se pede), ans, wrong: [...] }.
(() => {
  'use strict';
  window.QC = window.QC || {};

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  };

  // ================= Química =================
  // [nome, símbolo, pegadinhas de símbolo]
  const ELEMENTS_EASY = [
    ['Hidrogênio', 'H', ['Hi', 'He', 'Hd']],
    ['Hélio', 'He', ['H', 'Hl', 'Hi']],
    ['Lítio', 'Li', ['L', 'Lt', 'Lo']],
    ['Berílio', 'Be', ['B', 'Br', 'Bl']],
    ['Boro', 'B', ['Bo', 'Br', 'Be']],
    ['Carbono', 'C', ['Ca', 'Cb', 'Co']],
    ['Nitrogênio', 'N', ['Ni', 'Na', 'Nt']],
    ['Oxigênio', 'O', ['Ox', 'Og', 'Os']],
    ['Flúor', 'F', ['Fl', 'Fe', 'Fr']],
    ['Neônio', 'Ne', ['N', 'Na', 'No']],
    ['Sódio', 'Na', ['So', 'S', 'Sd']],
    ['Magnésio', 'Mg', ['Ma', 'Mn', 'M']],
    ['Alumínio', 'Al', ['A', 'Am', 'Au']],
    ['Silício', 'Si', ['S', 'Sl', 'Sc']],
    ['Fósforo', 'P', ['F', 'Fo', 'Fs']],
    ['Enxofre', 'S', ['E', 'En', 'Ex']],
    ['Cloro', 'Cl', ['C', 'Co', 'Cr']],
    ['Argônio', 'Ar', ['Ag', 'A', 'Au']],
    ['Cálcio', 'Ca', ['C', 'Cl', 'Cc']],
    ['Ferro', 'Fe', ['F', 'Fr', 'Fo']],
    ['Zinco', 'Zn', ['Z', 'Zi', 'Zc']],
    ['Iodo', 'I', ['Io', 'Id', 'In']],
  ];
  const ELEMENTS_HARD = [
    ['Potássio', 'K', ['P', 'Po', 'Pt']],
    ['Cobre', 'Cu', ['Co', 'C', 'Cb']],
    ['Prata', 'Ag', ['Pr', 'Pt', 'Pa']],
    ['Ouro', 'Au', ['Ou', 'O', 'Ag']],
    ['Chumbo', 'Pb', ['Ch', 'Cb', 'Pl']],
    ['Mercúrio', 'Hg', ['Me', 'Mr', 'Mc']],
    ['Estanho', 'Sn', ['Es', 'E', 'St']],
    ['Manganês', 'Mn', ['Mg', 'Ma', 'M']],
    ['Níquel', 'Ni', ['N', 'Nq', 'Nk']],
    ['Cobalto', 'Co', ['Cb', 'C', 'Cu']],
    ['Cromo', 'Cr', ['Cm', 'C', 'Co']],
    ['Bromo', 'Br', ['B', 'Bm', 'Bo']],
    ['Bário', 'Ba', ['B', 'Br', 'Bi']],
    ['Urânio', 'U', ['Ur', 'Un', 'Uo']],
    ['Platina', 'Pt', ['Pl', 'P', 'Pa']],
    ['Tungstênio', 'W', ['T', 'Tu', 'Tg']],
    ['Antimônio', 'Sb', ['An', 'At', 'Am']],
    ['Titânio', 'Ti', ['T', 'Tt', 'Tn']],
  ];
  // [nome comum, fórmula, pegadinhas]
  const MOLECULES_EASY = [
    ['Água', 'H_2O', ['H_2O_2', 'HO_2', 'H_3O']],
    ['Gás carbônico', 'CO_2', ['CO', 'C_2O', 'CO_3']],
    ['Monóxido de carbono', 'CO', ['CO_2', 'C_2O', 'CO_3']],
    ['Gás oxigênio', 'O_2', ['O', 'O_3', 'H_2O']],
    ['Ozônio', 'O_3', ['O_2', 'O', 'O_4']],
    ['Gás hidrogênio', 'H_2', ['H', 'H_2O', 'He']],
    ['Gás nitrogênio', 'N_2', ['N', 'NH_3', 'N_2O']],
    ['Amônia', 'NH_3', ['NH_4', 'N_3H', 'NH_2']],
    ['Metano', 'CH_4', ['CH_3', 'C_4H', 'C_2H_6']],
    ['Cloreto de sódio (sal)', 'NaCl', ['NaCl_2', 'SoCl', 'KCl']],
    ['Água oxigenada', 'H_2O_2', ['H_2O', 'HO_2', 'H_2O_3']],
    ['Ácido clorídrico', 'HCl', ['HClO', 'H_2Cl', 'NaCl']],
    ['Hidróxido de sódio', 'NaOH', ['KOH', 'NaO', 'Na(OH)_2']],
  ];
  const MOLECULES_HARD = [
    ['Ácido sulfúrico', 'H_2SO_4', ['H_2SO_3', 'H_2S', 'HSO_4']],
    ['Ácido nítrico', 'HNO_3', ['HNO_2', 'H_2NO_3', 'NH_3']],
    ['Ácido fosfórico', 'H_3PO_4', ['H_3PO_3', 'H_2PO_4', 'HPO_3']],
    ['Ácido carbônico', 'H_2CO_3', ['H_2CO_2', 'HCO_3', 'CO_2']],
    ['Carbonato de cálcio', 'CaCO_3', ['CaCO_2', 'Ca_2CO_3', 'CaC_2']],
    ['Bicarbonato de sódio', 'NaHCO_3', ['Na_2CO_3', 'NaCO_3', 'NaHCO_2']],
    ['Hidróxido de cálcio', 'Ca(OH)_2', ['CaOH', 'CaO', 'Ca(OH)_3']],
    ['Óxido de cálcio (cal)', 'CaO', ['CaO_2', 'Ca_2O', 'CaCO_3']],
    ['Cloreto de cálcio', 'CaCl_2', ['CaCl', 'Ca_2Cl', 'CaCl_3']],
    ['Sulfato de cobre', 'CuSO_4', ['CuSO_3', 'Cu_2SO_4', 'CoSO_4']],
    ['Óxido de ferro III', 'Fe_2O_3', ['FeO', 'Fe_3O_4', 'Fe_3O_2']],
    ['Glicose', 'C_6H_{12}O_6', ['C_{12}H_{22}O_{11}', 'C_6H_6', 'C_2H_6O']],
    ['Sacarose', 'C_{12}H_{22}O_{11}', ['C_6H_{12}O_6', 'C_{12}H_{22}O_6', 'C_{11}H_{22}O_{12}']],
    ['Etanol', 'C_2H_6O', ['CH_4O', 'C_2H_4O_2', 'C_3H_8O']],
    ['Metanol', 'CH_4O', ['C_2H_6O', 'CH_2O', 'CH_4']],
    ['Ácido acético', 'C_2H_4O_2', ['C_2H_6O', 'CH_2O_2', 'C_2H_2O_4']],
    ['Propano', 'C_3H_8', ['C_3H_6', 'C_4H_{10}', 'C_2H_6']],
    ['Butano', 'C_4H_{10}', ['C_4H_8', 'C_3H_8', 'C_5H_{12}']],
  ];

  // completa as erradas com respostas de outras perguntas do mesmo banco
  function fill(ans, traps, pool, count) {
    const out = shuffle(traps.filter((t) => t !== ans)).slice(0, count);
    for (const extra of shuffle(pool.slice())) {
      if (out.length >= count) break;
      if (extra !== ans && !out.includes(extra)) out.push(extra);
    }
    return out;
  }

  function chemistry(level, n) {
    const count = n - 1;
    let kind;
    if (level <= 2) kind = 'elEasy';
    else if (level <= 4) kind = pick(['elHard', 'elHard', 'nameOf']);
    else if (level <= 6) kind = pick(['molEasy', 'molEasy', 'elHard', 'nameOf']);
    else kind = pick(['molHard', 'molHard', 'molEasy', 'molName']);
    if (kind === 'elEasy' || kind === 'elHard') {
      const bank = kind === 'elEasy' ? ELEMENTS_EASY : ELEMENTS_HARD;
      const [name, sym, traps] = pick(bank);
      return { title: name, text: 'Símbolo', ans: sym, wrong: fill(sym, traps, bank.map((e) => e[1]), count) };
    }
    if (kind === 'nameOf') {
      // símbolo -> nome (as pegadinhas são elementos de nome parecido ou de símbolo enganoso)
      const bank = ELEMENTS_EASY.concat(ELEMENTS_HARD);
      const [name, sym] = pick(bank);
      const similar = bank.filter((e) => e[0] !== name && (e[1][0] === sym[0] || e[0][0] === sym[0])).map((e) => e[0]);
      return { title: `Símbolo ${sym}`, text: 'Elemento', ans: name, wrong: fill(name, similar, bank.map((e) => e[0]), count) };
    }
    if (kind === 'molName') {
      // fórmula -> nome
      const bank = MOLECULES_EASY.concat(MOLECULES_HARD);
      const [name, formula, traps] = pick(bank);
      const similar = bank.filter((m) => traps.includes(m[1])).map((m) => m[0]);
      return { title: formula, text: 'Substância', ans: name, wrong: fill(name, similar, bank.map((m) => m[0]), count) };
    }
    const bank = kind === 'molEasy' ? MOLECULES_EASY : MOLECULES_HARD;
    const [name, formula, traps] = pick(bank);
    return { title: name, text: 'Fórmula', ans: formula, wrong: fill(formula, traps, bank.map((m) => m[1]), count) };
  }

  // ================= Física =================
  // [nome, grandeza (lado esquerdo), equação certa (lado direito), pegadinhas]
  const PHYS = [
    // níveis 1-2: cinemática e dinâmica básicas
    [
      ['Velocidade média', 'v_m', 'Δs/Δt', ['Δt/Δs', 'Δs·Δt', 'Δv/Δt']],
      ['Aceleração média', 'a_m', 'Δv/Δt', ['Δs/Δt', 'Δv·Δt', 'Δt/Δv']],
      ['2ª lei de Newton', 'F_R', 'm·a', ['m/a', 'm·v', 'a/m']],
      ['Peso', 'P', 'm·g', ['m/g', 'g/m', 'm·v']],
      ['Densidade', 'd', 'm/V', ['V/m', 'm·V', 'm·g']],
      ['Pressão', 'p', 'F/A', ['F·A', 'A/F', 'm/V']],
      ['Frequência', 'f', '1/T', ['T', '2·T', 'λ/v']],
    ],
    // níveis 3-4: energia, trabalho e momento
    [
      ['Energia cinética', 'E_c', 'm·v^2/2', ['m·v^2', 'm·v/2', 'm·g·h']],
      ['Energia potencial gravitacional', 'E_p', 'm·g·h', ['m·v^2/2', 'm·h', 'k·x^2/2']],
      ['Energia potencial elástica', 'E_{el}', 'k·x^2/2', ['k·x', 'k·x^2', 'm·g·h']],
      ['Trabalho de uma força', 'τ', 'F·d·cos θ', ['F/d', 'F·d·sen θ', 'm·g·h/2']],
      ['Potência média', 'P', 'τ/Δt', ['τ·Δt', 'Δt/τ', 'F·d']],
      ['Quantidade de movimento', 'Q', 'm·v', ['m·a', 'm·v^2/2', 'm/v']],
      ['Impulso', 'I', 'F·Δt', ['F/Δt', 'F·Δs', 'm·a']],
      ['Lei de Hooke', 'F_{el}', 'k·x', ['k·x^2/2', 'k/x', 'x/k']],
    ],
    // níveis 5-6: ondas, calor, eletricidade e fluidos
    [
      ['Equação fundamental da ondulatória', 'v', 'λ·f', ['λ/f', 'f/λ', 'λ·T']],
      ['1ª lei de Ohm', 'U', 'R·i', ['R/i', 'i/R', 'P·i']],
      ['Potência elétrica', 'P', 'U·i', ['U/i', 'R·i', 'U·R']],
      ['Calor sensível', 'Q', 'm·c·ΔT', ['m·L', 'm·ΔT', 'c·ΔT']],
      ['Calor latente', 'Q', 'm·L', ['m·c·ΔT', 'L/m', 'm·c']],
      ['Força centrípeta', 'F_c', 'm·v^2/R', ['m·v/R', 'm·v^2·R', 'm·v^2/2']],
      ['Empuxo', 'E', 'ρ·V·g', ['m·a', 'ρ·V', 'ρ·g/V']],
      ['Pressão hidrostática', 'p', 'ρ·g·h', ['ρ·V·g', 'm·g·h', 'ρ·h']],
      ['Período do pêndulo simples', 'T', '2π·√(L/g)', ['2π·√(g/L)', '2π·√(m/k)', '√(L/g)']],
    ],
    // nível 7+: leis e funções mais completas
    [
      ['Gravitação universal', 'F', 'G·M·m/d^2', ['G·M·m/d', 'G·M·m·d^2', 'k·Q·q/d^2']],
      ['Lei de Coulomb', 'F', 'k·Q·q/d^2', ['k·Q·q/d', 'G·M·m/d^2', 'k·Q·q·d']],
      ['Equação de Torricelli', 'v^2', 'v_0^2 + 2·a·Δs', ['v_0 + a·t', 'v_0^2 + a·Δs', 'v_0 + 2·a·Δs']],
      ['Velocidade no MUV', 'v', 'v_0 + a·t', ['v_0 + a·t^2/2', 'v_0·t + a', 's_0 + v·t']],
      ['Posição no MUV', 's', 's_0 + v_0·t + a·t^2/2', ['s_0 + v_0·t + a·t', 's_0 + v·t', 's_0 + a·t^2']],
      ['Equação de Clapeyron', 'p·V', 'n·R·T', ['n·R/T', 'R·T/n', 'n·T/R']],
      ['1ª lei da termodinâmica', 'ΔU', 'Q − τ', ['Q·τ', 'τ − Q', 'Q/τ']],
      ['Dilatação linear', 'ΔL', 'L_0·α·ΔT', ['L_0·α', 'α·ΔT/L_0', 'L_0/(α·ΔT)']],
      ['Lei de Snell', 'n_1·sen θ_1', 'n_2·sen θ_2', ['n_2·cos θ_2', 'n_2/sen θ_2', 'sen θ_2/n_2']],
      ['Energia do fóton', 'E', 'h·f', ['h/f', 'h·λ', 'm·c^2']],
      ['Energia de repouso', 'E', 'm·c^2', ['m·c', 'm·v^2/2', 'h·f']],
      ['Campo elétrico', 'E', 'F/q', ['F·q', 'q/F', 'k·q/d']],
      ['Rendimento', 'η', 'P_{útil}/P_{total}', ['P_{total}/P_{útil}', 'P_{útil}·P_{total}', 'P_{total} − P_{útil}']],
    ],
  ];

  function physics(level, n) {
    const tier = level <= 2 ? 0 : level <= 4 ? 1 : level <= 6 ? 2 : 3;
    // de vez em quando volta uma equação de um bloco anterior, para revisar
    const t = tier > 0 && Math.random() < 0.3 ? Math.floor(Math.random() * tier) : tier;
    const [name, lhs, rhs, traps] = pick(PHYS[t]);
    return { title: name, text: lhs, ans: rhs, wrong: fill(rhs, traps, PHYS[t].map((e) => e[2]), n - 1) };
  }

  const MODES = {
    mat: {
      id: 'mat', name: 'Matemática', tag: 'CÁLCULO MENTAL', ranked: true, rich: false,
      intro: 'Resolva a conta e atravesse o portal com a resposta certa. A cada acerto você corre mais rápido.',
      speed: { start: 16, step: 1.1, max: 46 },
    },
    quim: {
      id: 'quim', name: 'Química', tag: 'ÁTOMOS E MOLÉCULAS', ranked: false, rich: true,
      intro: 'Veja o elemento ou a substância e atravesse o portal com o símbolo ou a fórmula certa. Começa com átomos e depois vêm as moléculas.',
      speed: { start: 12, step: 0.8, max: 32 },
      make: chemistry,
      tips: [
        'Dica: vários símbolos vêm do latim. Sódio é Na (natrium), potássio é K (kalium).',
        'Dica: ouro é Au (aurum), prata é Ag (argentum) e chumbo é Pb (plumbum).',
        'Dica: o índice diz quantos átomos há. Em H₂O são 2 hidrogênios e 1 oxigênio.',
        'Dica: ozônio é O₃ e o oxigênio que respiramos é O₂.',
        'Dica: ácidos costumam começar com H: HCl, H₂SO₄, HNO₃.',
      ],
    },
    fis: {
      id: 'fis', name: 'Física', tag: 'EQUAÇÕES DA FÍSICA', ranked: false, rich: true,
      intro: 'Veja o nome da lei ou da grandeza e atravesse o portal com a equação certa. As equações ficam mais difíceis a cada nível.',
      speed: { start: 11, step: 0.7, max: 28 },
      make: physics,
      tips: [
        'Dica: energia cinética tem o v ao quadrado e dividido por 2: m·v²/2.',
        'Dica: confira as unidades. Força em N = kg·m/s², então F = m·a.',
        'Dica: v = λ·f. Onda com frequência maior tem comprimento menor na mesma velocidade.',
        'Dica: calor sensível muda a temperatura (m·c·ΔT); calor latente muda o estado (m·L).',
        'Dica: Coulomb e gravitação têm a mesma forma: produto das cargas (ou massas) sobre d².',
      ],
    },
  };

  QC.Modes = { list: ['mat', 'quim', 'fis'], get: (id) => MODES[id] || MODES.mat, all: MODES };
})();
