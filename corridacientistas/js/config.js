// Configuração compartilhada: elenco, itens, classes de motor, qualidade gráfica.
// Os módulos só LEEM daqui. Ajustes finos de física ficam em kart.js.

export const GAME_TITLE = 'Corrida dos Cientistas';

// Atributos de 1 a 5. Peso alto empurra os outros nas batidas, mas acelera devagar.
// `colors.kart`/`colors.kartAccent` pintam o kart; `look` orienta o modelo em models.js.
export const CHARACTERS = [
  {
    id: 'newton',
    name: 'Newton',
    fullName: 'Isaac Newton',
    years: '1643–1727',
    country: 'Inglaterra',
    field: 'Física e Matemática',
    stats: { speed: 3, accel: 3, handling: 3, weight: 3 },
    colors: { kart: 0xd7263d, kartAccent: 0xffd166, ui: '#d7263d' },
    look: {
      skin: 0xf2c9a0, hair: 0xf1eee6, hairStyle: 'peruca longa branca cacheada até os ombros',
      outfit: 0x5b3a29, outfitAccent: 0xf5f0e1, extras: 'casaca marrom com gola de renda branca; maçã vermelha no painel do kart',
    },
    bio: 'Formulou as três leis do movimento e a lei da gravitação universal. Também criou o cálculo (junto com Leibniz) e mostrou que a luz branca é a mistura de todas as cores.',
    fact: 'Newton construiu o primeiro telescópio refletor que funcionava, em 1668.',
  },
  {
    id: 'curie',
    name: 'Marie Curie',
    fullName: 'Marie Skłodowska-Curie',
    years: '1867–1934',
    country: 'Polônia / França',
    field: 'Física e Química',
    stats: { speed: 2, accel: 5, handling: 4, weight: 1 },
    colors: { kart: 0x7ed957, kartAccent: 0x1b1b1b, ui: '#5cb83a' },
    look: {
      skin: 0xf3d2b8, hair: 0x5a3d2b, hairStyle: 'cabelo castanho preso em coque alto',
      outfit: 0x1c1c22, outfitAccent: 0xffffff, extras: 'vestido preto de gola alta; frasco com líquido verde brilhante (rádio) no kart',
    },
    bio: 'Descobriu os elementos polônio e rádio e criou o termo "radioatividade". Foi a primeira pessoa a ganhar dois Prêmios Nobel e é a única premiada em duas ciências diferentes: Física (1903) e Química (1911).',
    fact: 'Os cadernos de Marie Curie ainda são radioativos e ficam guardados em caixas forradas de chumbo.',
  },
  {
    id: 'mendeleev',
    name: 'Mendeleev',
    fullName: 'Dmitri Mendeleev',
    years: '1834–1907',
    country: 'Rússia',
    field: 'Química',
    stats: { speed: 5, accel: 1, handling: 2, weight: 5 },
    colors: { kart: 0x6a4c93, kartAccent: 0xf4f1de, ui: '#8a63c4' },
    look: {
      skin: 0xeec4a2, hair: 0xb8b2a6, hairStyle: 'cabelo grisalho longo e desgrenhado',
      beard: 'barba grisalha muito longa e volumosa até o peito',
      outfit: 0x2b2d42, outfitAccent: 0x8d99ae, extras: 'casaco escuro; kart decorado com quadradinhos coloridos da tabela periódica',
    },
    bio: 'Organizou a Tabela Periódica em 1869 e deixou espaços vazios para elementos ainda desconhecidos, prevendo suas propriedades. O gálio e o germânio foram descobertos depois, como ele previu.',
    fact: 'O elemento químico 101 se chama mendelévio em homenagem a ele.',
  },
  {
    id: 'einstein',
    name: 'Einstein',
    fullName: 'Albert Einstein',
    years: '1879–1955',
    country: 'Alemanha',
    field: 'Física',
    stats: { speed: 4, accel: 2, handling: 3, weight: 3 },
    colors: { kart: 0x1d7bd8, kartAccent: 0xffffff, ui: '#1d7bd8' },
    look: {
      skin: 0xf0c8a4, hair: 0xf4f4f4, hairStyle: 'cabelo branco arrepiado para todos os lados',
      mustache: 'bigode grisalho grosso',
      outfit: 0x8a8f99, outfitAccent: 0x3d3d3d, extras: 'suéter cinza; "E=mc²" pintado na lateral do kart',
    },
    bio: 'Criou as teorias da relatividade restrita e geral, que mudaram nossa ideia de espaço, tempo e gravidade. Ganhou o Nobel de Física de 1921 por explicar o efeito fotoelétrico.',
    fact: 'Em 1919, fotos de um eclipse feitas em Sobral, no Ceará, ajudaram a confirmar a relatividade geral.',
  },
  {
    id: 'galileu',
    name: 'Galileu',
    fullName: 'Galileu Galilei',
    years: '1564–1642',
    country: 'Itália',
    field: 'Física e Astronomia',
    stats: { speed: 3, accel: 4, handling: 3, weight: 2 },
    colors: { kart: 0xf4a261, kartAccent: 0x264653, ui: '#e8893c' },
    look: {
      skin: 0xe9b98f, hair: 0x9c7a5b, hairStyle: 'cabelo curto castanho-acinzentado',
      beard: 'barba pontuda castanho-acinzentada e bigode',
      hat: 'gorro preto baixo',
      outfit: 0x1f1f1f, outfitAccent: 0xf1ede4, extras: 'roupa preta com gola branca; luneta dourada presa no kart',
    },
    bio: 'Aperfeiçoou a luneta e descobriu as quatro maiores luas de Júpiter, as fases de Vênus e as manchas solares. É considerado um dos pais do método científico moderno.',
    fact: 'Galileu mostrou que, sem a resistência do ar, objetos pesados e leves caem juntos.',
  },
  {
    id: 'darwin',
    name: 'Darwin',
    fullName: 'Charles Darwin',
    years: '1809–1882',
    country: 'Inglaterra',
    field: 'Biologia',
    stats: { speed: 4, accel: 2, handling: 3, weight: 4 },
    colors: { kart: 0x3a7d44, kartAccent: 0xe9c46a, ui: '#3a9d4e' },
    look: {
      skin: 0xf0c6a0, hair: 0xefefef, hairStyle: 'calvo no topo, cabelo branco nas laterais',
      beard: 'barba branca enorme e cheia',
      outfit: 0x3b2f2f, outfitAccent: 0xd9cbb0, extras: 'casaco marrom-escuro; tentilhão (passarinho) empoleirado no kart',
    },
    bio: 'Propôs a teoria da evolução por seleção natural no livro "A Origem das Espécies" (1859), depois de quase 5 anos de viagem ao redor do mundo a bordo do navio HMS Beagle.',
    fact: 'O Beagle passou pelo Brasil: Darwin visitou Salvador e o Rio de Janeiro em 1832.',
  },
  {
    id: 'dumont',
    name: 'Santos Dumont',
    fullName: 'Alberto Santos Dumont',
    years: '1873–1932',
    country: 'Brasil',
    field: 'Aviação e Engenharia',
    stats: { speed: 3, accel: 4, handling: 5, weight: 1 },
    colors: { kart: 0xf1c40f, kartAccent: 0x009c3b, ui: '#e0b400' },
    look: {
      skin: 0xe8b98f, hair: 0x2b1d14, hairStyle: 'cabelo escuro repartido ao meio',
      mustache: 'bigode fino e escuro',
      hat: 'chapéu panamá claro com fita escura',
      outfit: 0x2e3a4f, outfitAccent: 0xffffff, extras: 'terno escuro de colarinho alto; asinhas de tecido e hélice do 14-bis no kart',
    },
    bio: 'Pioneiro da aviação. Em 1906, em Paris, voou com o 14-bis, que decolou por meios próprios diante do público. Também construiu dirigíveis e o pequeno avião Demoiselle.',
    fact: 'Santos Dumont ajudou a popularizar o relógio de pulso: o joalheiro Louis Cartier fez um para ele ver as horas enquanto pilotava.',
  },
  {
    id: 'oswaldo',
    name: 'Oswaldo Cruz',
    fullName: 'Oswaldo Gonçalves Cruz',
    years: '1872–1917',
    country: 'Brasil',
    field: 'Medicina e Saúde Pública',
    stats: { speed: 2, accel: 5, handling: 4, weight: 2 },
    colors: { kart: 0x17a2b8, kartAccent: 0xffffff, ui: '#17a2b8' },
    look: {
      skin: 0xe2b08a, hair: 0x1e1612, hairStyle: 'cabelo escuro curto penteado para trás',
      mustache: 'bigode escuro farto e curvado',
      glasses: 'óculos redondos pequenos',
      outfit: 0xf7f7f7, outfitAccent: 0x2d3142, extras: 'jaleco branco de médico; microscópio no kart',
    },
    bio: 'Médico sanitarista que combateu a febre amarela, a peste bubônica e a varíola no Rio de Janeiro. Dirigiu o instituto que hoje leva seu nome: a Fiocruz.',
    fact: 'Em 1904, a campanha de vacinação obrigatória contra a varíola, liderada por ele, gerou a Revolta da Vacina no Rio.',
  },
];

export const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

// Itens das caixas. `weights[p]` = peso no sorteio para quem está na posição p+1 (8 karts).
// Equivalência com o Mario Kart entre parênteses.
export const ITEMS = {
  foguete: {
    id: 'foguete', name: 'Foguete', icon: '🚀', color: 0xff7b29,
    effect: 'Turbo instantâneo.', // (cogumelo)
    fact: '3ª Lei de Newton: o foguete empurra os gases para trás, e os gases empurram o foguete para a frente. Ação e reação!',
    weights: [0, 20, 25, 25, 20, 15, 10, 5],
  },
  pilha3: {
    id: 'pilha3', name: 'Pilha de Volta ×3', icon: '🔋', color: 0x3ddc84, uses: 3,
    effect: 'Três turbos seguidos.', // (cogumelo triplo)
    fact: 'Em 1800, Alessandro Volta empilhou discos de zinco e cobre separados por pano molhado em água salgada e criou a primeira pilha elétrica.',
    weights: [0, 5, 10, 15, 20, 25, 25, 20],
  },
  maca: {
    id: 'maca', name: 'Maçã de Newton', icon: '🍎', color: 0xe63946,
    effect: 'Deixa uma maçã na pista. Quem passar por cima derrapa.', // (banana)
    fact: 'Newton contou que ver uma maçã cair o fez pensar: a mesma força que puxa a maçã mantém a Lua em órbita. É a gravitação universal!',
    weights: [45, 20, 10, 5, 0, 0, 0, 0],
  },
  alfa: {
    id: 'alfa', name: 'Partícula Alfa', icon: 'α', color: 0xffd23f,
    effect: 'Disparo em linha reta que ricocheteia nos muros.', // (casco verde)
    fact: 'Em 1909, a equipe de Rutherford disparou partículas alfa contra uma folha de ouro. Algumas ricochetearam: o átomo tem um núcleo pequeno e denso!',
    weights: [40, 25, 20, 15, 10, 5, 0, 0],
  },
  eletron: {
    id: 'eletron', name: 'Elétron Teleguiado', icon: 'e⁻', color: 0x4cc9f0,
    effect: 'Persegue o kart da frente.', // (casco vermelho)
    fact: 'Cargas opostas se atraem (Lei de Coulomb). O elétron, de carga negativa, é puxado por cargas positivas.',
    weights: [5, 20, 25, 25, 25, 20, 15, 10],
  },
  faraday: {
    id: 'faraday', name: 'Gaiola de Faraday', icon: '🛡️', color: 0xc0c7d1,
    effect: 'Invencível e mais rápido por alguns segundos.', // (estrela)
    fact: 'Numa casca de metal, a carga elétrica fica do lado de fora e protege quem está dentro. Por isso um carro fechado é um lugar seguro durante uma tempestade de raios.',
    weights: [0, 0, 0, 5, 10, 15, 25, 30],
  },
  tesla: {
    id: 'tesla', name: 'Bobina de Tesla', icon: '⚡', color: 0xb388ff,
    effect: 'Um raio atinge todos os adversários: eles encolhem e ficam lentos.', // (raio)
    fact: 'Nikola Tesla criou a bobina que gera faíscas de alta tensão. Um raio de verdade aquece o ar a cerca de 30.000 °C, cinco vezes a temperatura da superfície do Sol.',
    weights: [0, 0, 0, 0, 0, 5, 10, 15],
  },
  buraco: {
    id: 'buraco', name: 'Buraco Negro', icon: '🕳️', color: 0x7b2cbf,
    effect: 'Voa até o 1º colocado e o engole.', // (casco azul)
    fact: 'A gravidade de um buraco negro é tão forte que nem a luz escapa. Em 2019, foi divulgada a primeira imagem de um, na galáxia M87.',
    weights: [0, 0, 5, 5, 5, 5, 5, 5],
  },
};

export const ITEM_IDS = Object.keys(ITEMS);

// Classes de motor. speedMult multiplica a velocidade máxima; aiSkill vai de 0 a 1.
export const CLASSES = {
  '50cc': { id: '50cc', label: '50cc', hint: 'Tranquilo', speedMult: 0.8, aiSkill: 0.45 },
  '100cc': { id: '100cc', label: '100cc', hint: 'Normal', speedMult: 1.0, aiSkill: 0.72 },
  '150cc': { id: '150cc', label: '150cc', hint: 'Rápido', speedMult: 1.18, aiSkill: 0.95 },
};

export const RACE = {
  kartCount: 8,
  defaultLaps: 3,
  lapOptions: [1, 2, 3, 5],
  countdownStep: 1.0, // segundos entre 3, 2, 1, VAI!
  rouletteTime: 1.6,
  boxRespawn: 2.0,
};

// Presets de qualidade. main.js escolhe 'baixa' em celular e 'alta' no PC.
export const QUALITY = {
  alta: {
    id: 'alta',
    pixelRatio: 2,
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
