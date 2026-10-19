// Configuração compartilhada: elenco, itens, classes de motor, qualidade gráfica.
// Os módulos só LEEM daqui. Ajustes finos de física ficam em kart.js.
// Textos visíveis (nomes, biografias, curiosidades, perguntas) ficam em js/lang/<idioma>.js;
// aqui `name` é só o nome em pt-BR para as páginas de teste (dev/).


// Atributos de 1 a 5. Peso alto empurra os outros nas batidas, mas acelera devagar.
// `colors.kart`/`colors.kartAccent` pintam o kart; `look` orienta o modelo em models.js.
export const CHARACTERS = [
  {
    id: 'newton',
    name: 'Newton',
    years: '1643–1727',
    flag: 'gb',
    stats: { speed: 3, accel: 3, handling: 3, weight: 3 },
    colors: { kart: 0xd7263d, kartAccent: 0xffd166, ui: '#d7263d' },
    look: {
      skin: 0xf2c9a0, hair: 0xf1eee6, hairStyle: 'peruca longa branca cacheada até os ombros',
      outfit: 0x5b3a29, outfitAccent: 0xf5f0e1, extras: 'casaca marrom com gola de renda branca; maçã vermelha no painel do kart',
    },
    quiz: { answer: 0 }, // índice da resposta certa (igual em todos os idiomas)
  },
  {
    id: 'curie',
    name: 'Marie Curie',
    gender: 'f', // resultados: 'a vencedora' / 'die Siegerin'
    years: '1867–1934',
    flag: 'pl-fr',
    stats: { speed: 2, accel: 5, handling: 4, weight: 1 },
    colors: { kart: 0x7ed957, kartAccent: 0x1b1b1b, ui: '#5cb83a' },
    look: {
      skin: 0xf3d2b8, hair: 0x5a3d2b, hairStyle: 'cabelo castanho preso em coque alto',
      outfit: 0x1c1c22, outfitAccent: 0xffffff, extras: 'vestido preto de gola alta; frasco com líquido verde brilhante (rádio) no kart',
    },
    quiz: { answer: 0 }, // índice da resposta certa (igual em todos os idiomas)
  },
  {
    id: 'mendeleev',
    name: 'Mendeleev',
    years: '1834–1907',
    flag: 'ru',
    stats: { speed: 5, accel: 1, handling: 2, weight: 5 },
    colors: { kart: 0x6a4c93, kartAccent: 0xf4f1de, ui: '#8a63c4' },
    look: {
      skin: 0xeec4a2, hair: 0xb8b2a6, hairStyle: 'cabelo grisalho longo e desgrenhado',
      beard: 'barba grisalha muito longa e volumosa até o peito',
      outfit: 0x2b2d42, outfitAccent: 0x8d99ae, extras: 'casaco escuro; kart decorado com quadradinhos coloridos da tabela periódica',
    },
    quiz: { answer: 0 }, // índice da resposta certa (igual em todos os idiomas)
  },
  {
    id: 'einstein',
    name: 'Einstein',
    years: '1879–1955',
    flag: 'de',
    stats: { speed: 4, accel: 2, handling: 3, weight: 3 },
    colors: { kart: 0x1d7bd8, kartAccent: 0xffffff, ui: '#1d7bd8' },
    look: {
      skin: 0xf0c8a4, hair: 0xf4f4f4, hairStyle: 'cabelo branco arrepiado para todos os lados',
      mustache: 'bigode grisalho grosso',
      outfit: 0x8a8f99, outfitAccent: 0x3d3d3d, extras: 'suéter cinza; "E=mc²" pintado na lateral do kart',
    },
    quiz: { answer: 0 }, // índice da resposta certa (igual em todos os idiomas)
  },
  {
    id: 'galileu',
    name: 'Galileu',
    years: '1564–1642',
    flag: 'it',
    stats: { speed: 3, accel: 4, handling: 3, weight: 2 },
    colors: { kart: 0xf4a261, kartAccent: 0x264653, ui: '#e8893c' },
    look: {
      skin: 0xe9b98f, hair: 0x9c7a5b, hairStyle: 'cabelo curto castanho-acinzentado',
      beard: 'barba pontuda castanho-acinzentada e bigode',
      hat: 'gorro preto baixo',
      outfit: 0x1f1f1f, outfitAccent: 0xf1ede4, extras: 'roupa preta com gola branca; luneta dourada presa no kart',
    },
    quiz: { answer: 0 }, // índice da resposta certa (igual em todos os idiomas)
  },
  {
    id: 'darwin',
    name: 'Darwin',
    years: '1809–1882',
    flag: 'gb',
    stats: { speed: 4, accel: 2, handling: 3, weight: 4 },
    colors: { kart: 0x3a7d44, kartAccent: 0xe9c46a, ui: '#3a9d4e' },
    look: {
      skin: 0xf0c6a0, hair: 0xefefef, hairStyle: 'calvo no topo, cabelo branco nas laterais',
      beard: 'barba branca enorme e cheia',
      outfit: 0x3b2f2f, outfitAccent: 0xd9cbb0, extras: 'casaco marrom-escuro; tentilhão (passarinho) empoleirado no kart',
    },
    quiz: { answer: 0 }, // índice da resposta certa (igual em todos os idiomas)
  },
  {
    id: 'dumont',
    name: 'Santos Dumont',
    years: '1873–1932',
    flag: 'br',
    stats: { speed: 3, accel: 4, handling: 5, weight: 1 },
    colors: { kart: 0xf1c40f, kartAccent: 0x009c3b, ui: '#e0b400' },
    look: {
      skin: 0xe8b98f, hair: 0x2b1d14, hairStyle: 'cabelo escuro repartido ao meio',
      mustache: 'bigode fino e escuro',
      hat: 'chapéu panamá claro com fita escura',
      outfit: 0x2e3a4f, outfitAccent: 0xffffff, extras: 'terno escuro de colarinho alto; asinhas de tecido e hélice do 14-bis no kart',
    },
    quiz: { answer: 0 }, // índice da resposta certa (igual em todos os idiomas)
  },
  {
    id: 'oswaldo',
    name: 'Oswaldo Cruz',
    years: '1872–1917',
    flag: 'br',
    stats: { speed: 2, accel: 5, handling: 4, weight: 2 },
    colors: { kart: 0x17a2b8, kartAccent: 0xffffff, ui: '#17a2b8' },
    look: {
      skin: 0xe2b08a, hair: 0x1e1612, hairStyle: 'cabelo escuro curto penteado para trás',
      mustache: 'bigode escuro farto e curvado',
      glasses: 'óculos redondos pequenos',
      outfit: 0xf7f7f7, outfitAccent: 0x2d3142, extras: 'jaleco branco de médico; microscópio no kart',
    },
    quiz: { answer: 0 }, // índice da resposta certa (igual em todos os idiomas)
  },
];

export const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

// Itens das caixas. `weights[p]` = peso no sorteio para quem está na posição p+1 (8 karts).
// Equivalência com o Mario Kart entre parênteses.
export const ITEMS = {
  foguete: {
    id: 'foguete', icon: '🚀', color: 0xff7b29,
    // (cogumelo)
    weights: [0, 20, 25, 25, 20, 15, 10, 5],
  },
  pilha3: {
    id: 'pilha3', icon: '🔋', color: 0x3ddc84, uses: 3,
    // (cogumelo triplo)
    weights: [0, 5, 10, 15, 20, 25, 25, 20],
    quiz: { answer: 0 },
  },
  maca: {
    id: 'maca', icon: '🍎', color: 0xe63946,
    // (banana)
    weights: [45, 20, 10, 5, 0, 0, 0, 0],
  },
  alfa: {
    id: 'alfa', icon: 'α', color: 0xffd23f,
    // (casco verde)
    weights: [40, 25, 20, 15, 10, 5, 0, 0],
    quiz: { answer: 0 },
  },
  eletron: {
    id: 'eletron', icon: 'e⁻', color: 0x4cc9f0,
    // (casco vermelho)
    weights: [5, 20, 25, 25, 25, 20, 15, 10],
    quiz: { answer: 0 },
  },
  faraday: {
    id: 'faraday', icon: '🛡️', color: 0xc0c7d1,
    // (estrela)
    weights: [0, 0, 0, 5, 10, 15, 25, 30],
    quiz: { answer: 0 },
  },
  tesla: {
    id: 'tesla', icon: '⚡', color: 0xb388ff,
    // (raio)
    weights: [0, 0, 0, 0, 0, 2, 5, 8], // só um por vez e 30 s de intervalo (items.js)
    quiz: { answer: 0 },
  },
  buraco: {
    id: 'buraco', icon: '🕳️', color: 0x7b2cbf,
    // (casco azul)
    weights: [0, 0, 2, 3, 3, 4, 4, 4], // só um por vez e 25 s de intervalo (items.js)
    quiz: { answer: 0 },
  },
};

export const ITEM_IDS = Object.keys(ITEMS);

// Classes de motor. speedMult multiplica a velocidade máxima; aiSkill vai de 0 a 1.
// aiSpeed multiplica o ritmo da IA; aiCatchUp = quanto a IA de trás acelera para alcançar o jogador.
// aiSlowDown = quanto a IA da frente alivia quando o jogador fica para trás: começa a aiSlowFrom metros
// e chega ao máximo aiSlowRange metros depois.
// (50cc é para quem está aprendendo: quem erra bastante ainda consegue brigar pelo pódio.)
export const CLASSES = {
  '50cc': { id: '50cc', label: '50cc', speedMult: 0.8, aiSkill: 0.35, aiSpeed: 0.92, aiCatchUp: 0.04, aiSlowDown: 0.16, aiSlowFrom: 8, aiSlowRange: 90 },
  '100cc': { id: '100cc', label: '100cc', speedMult: 1.0, aiSkill: 0.65, aiSpeed: 0.97, aiCatchUp: 0.07, aiSlowDown: 0.1, aiSlowFrom: 15, aiSlowRange: 120 },
  '150cc': { id: '150cc', label: '150cc', speedMult: 1.18, aiSkill: 0.92, aiSpeed: 0.99, aiCatchUp: 0.10, aiSlowDown: 0.07, aiSlowFrom: 25, aiSlowRange: 150 },
};

export const RACE = {
  kartCount: 8,
  defaultLaps: 2,
  lapOptions: [1, 2, 3, 5],
  countdownStep: 1.0, // segundos entre 3, 2, 1, VAI!
  rouletteTime: 1.6,
  boxRespawn: 2.0,
};

// Presets de qualidade. main.js escolhe 'baixa' em celular e 'alta' no PC.
export const QUALITY = {
  alta: {
    id: 'alta',
    pixelRatio: 1.5, // com MSAA, 2x custa quase o dobro sem ganho visível
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    scenery: 1.0, // densidade de cenário (0..1)
    particles: 1.0, // multiplicador de partículas
    drawDistance: 700,
  },
  baixa: {
    id: 'baixa',
    pixelRatio: 1,
    antialias: false,
    shadows: false,
    shadowMapSize: 512,
    scenery: 0.45,
    particles: 0.4,
    drawDistance: 420,
  },
};

// Converte atributo 1..5 em fator de -1 a +1 (3 = 0).
export const statFactor = (v) => (v - 3) / 2;
