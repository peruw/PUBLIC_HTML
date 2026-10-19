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
    bio: 'Formulou as três leis do movimento e a lei da gravitação universal. Também desenvolveu o cálculo (na mesma época que Leibniz, mas de forma independente) e mostrou que a luz branca é a mistura de todas as cores.',
    // curiosidades (a 1ª é a mais conhecida); o jogo alterna entre elas
    facts: [
      'Newton construiu o primeiro telescópio refletor que funcionava, em 1668.',
      'Com prismas de vidro, Newton mostrou que a luz branca se separa nas cores do arco-íris.',
      'Em 1687, Newton publicou o livro “Principia”, com as três leis do movimento e a gravitação universal.',
    ],
    quiz: {
      q: 'Pela 3ª Lei de Newton (ação e reação), o foguete empurra os gases para trás. E os gases…',
      options: ['empurram o foguete para a frente', 'puxam o foguete para trás', 'não fazem força nenhuma'],
      answer: 0,
      explain: 'Toda ação tem uma reação de mesma força e sentido oposto. É assim que os foguetes sobem!',
    },
  },
  {
    id: 'curie',
    name: 'Marie Curie',
    gender: 'f', // texto dos resultados: 'a vencedora'
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
    bio: 'Descobriu, com o marido Pierre Curie, os elementos polônio e rádio, e criou o termo “radioatividade”. Foi a primeira pessoa a ganhar dois Prêmios Nobel e é a única premiada em duas ciências diferentes: Física (1903) e Química (1911).',
    facts: [
      'Os cadernos de Marie Curie ainda são radioativos e ficam guardados em caixas forradas de chumbo.',
      'Marie Curie deu ao elemento polônio esse nome em homenagem à Polônia, o país onde nasceu.',
      'Na Primeira Guerra Mundial, ela levou aparelhos de raios X em carros até perto das batalhas para ajudar a tratar soldados feridos.',
    ],
    quiz: {
      q: 'Que elemento químico Marie Curie batizou em homenagem ao seu país natal?',
      options: ['Polônio', 'Urânio', 'Hélio'],
      answer: 0,
      explain: 'Marie Curie nasceu em Varsóvia, na Polônia, e chamou de polônio o primeiro elemento que descobriu com Pierre Curie.',
    },
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
    facts: [
      'O elemento químico 101 se chama mendelévio em homenagem a ele.',
      'A tabela de Mendeleev tinha 63 elementos, os conhecidos em 1869. A Tabela Periódica de hoje tem 118.',
      'Mendeleev ordenou os elementos pela massa atômica. Hoje a ordem é pelo número atômico: a quantidade de prótons no núcleo.',
    ],
    quiz: {
      q: 'Por que Mendeleev deixou espaços vazios na sua Tabela Periódica?',
      options: ['Para elementos que ainda não tinham sido descobertos', 'Porque faltou tinta para escrever', 'Para separar os metais dos gases'],
      answer: 0,
      explain: 'Ele previu como seriam esses elementos. O gálio e o germânio foram descobertos depois, como ele tinha previsto.',
    },
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
    facts: [
      'Em 1919, fotos de um eclipse feitas em Sobral, no Ceará, ajudaram a confirmar a relatividade geral.',
      'A fórmula E = mc² mostra que massa e energia são equivalentes: um pouquinho de massa guarda uma quantidade enorme de energia.',
      'Os satélites de GPS precisam de correções da relatividade de Einstein. Sem elas, a localização do celular erraria cada vez mais.',
    ],
    quiz: {
      q: 'Em 1919, fotos de um eclipse ajudaram a confirmar a relatividade de Einstein. Onde elas foram feitas?',
      options: ['Em Sobral, no Ceará', 'Em Manaus, no Amazonas', 'Em Curitiba, no Paraná'],
      answer: 0,
      explain: 'As fotos mostraram que a luz das estrelas se curva perto do Sol, como a relatividade geral previa.',
    },
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
    bio: 'Aperfeiçoou a luneta e descobriu as quatro maiores luas de Júpiter. Também observou as fases de Vênus e estudou as manchas solares. É considerado um dos pais do método científico moderno.',
    facts: [
      'Galileu mostrou que, sem a resistência do ar, objetos pesados e leves caem juntos.',
      'As quatro luas de Júpiter que Galileu descobriu (Io, Europa, Ganimedes e Calisto) são chamadas de luas galileanas.',
      'Galileu defendeu a ideia de Copérnico de que a Terra gira em volta do Sol e, por isso, foi julgado pela Inquisição em 1633.',
    ],
    quiz: {
      q: 'O que Galileu descobriu ao apontar sua luneta para Júpiter?',
      options: ['Quatro luas girando em volta dele', 'Que Júpiter é feito de gelo', 'Que Júpiter não tem gravidade'],
      answer: 0,
      explain: 'Io, Europa, Ganimedes e Calisto, as luas galileanas. Foi a prova de que nem tudo gira em volta da Terra.',
    },
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
    bio: 'Propôs a teoria da evolução por seleção natural no livro “A Origem das Espécies” (1859), depois de quase cinco anos de viagem ao redor do mundo a bordo do navio HMS Beagle.',
    facts: [
      'O Beagle passou pelo Brasil: Darwin visitou Salvador e o Rio de Janeiro em 1832.',
      'Nas Ilhas Galápagos, Darwin viu tentilhões com bicos de formatos diferentes, cada um adaptado a um tipo de alimento.',
      'A viagem do Beagle durou quase cinco anos, de 1831 a 1836.',
    ],
    quiz: {
      q: 'Qual é a ideia mais famosa de Charles Darwin?',
      options: ['A evolução por seleção natural', 'A teoria da relatividade', 'A lei da gravitação universal'],
      answer: 0,
      explain: 'Darwin explicou a evolução por seleção natural no livro “A Origem das Espécies”, de 1859.',
    },
  },
  {
    id: 'dumont',
    name: 'Santos Dumont',
    short: 'S. Dumont',
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
    facts: [
      'Santos Dumont ajudou a popularizar o relógio de pulso: o joalheiro Louis Cartier fez um para ele ver as horas enquanto pilotava.',
      'Em 23 de outubro de 1906, o 14-bis voou cerca de 60 metros no Campo de Bagatelle, em Paris.',
      'Santos Dumont não patenteou o avião Demoiselle: deixou os desenhos livres para quem quisesse construir um.',
    ],
    quiz: {
      q: 'Qual era o nome do avião de Santos Dumont que voou em Paris em 1906?',
      options: ['14-bis', 'Concorde', 'Zepelim'],
      answer: 0,
      explain: 'O 14-bis decolou por meios próprios diante do público, em Paris, em 1906.',
    },
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
    facts: [
      'Em 1904, a campanha de vacinação obrigatória contra a varíola, liderada por ele, gerou a Revolta da Vacina no Rio.',
      'Para combater a febre amarela, as equipes de Oswaldo Cruz eliminavam os criadouros do mosquito Aedes aegypti, o mesmo que transmite a dengue.',
      'Oswaldo Cruz estudou no Instituto Pasteur, em Paris, antes de voltar ao Brasil para cuidar da saúde pública.',
    ],
    quiz: {
      q: 'Qual mosquito transmite a febre amarela nas cidades (e também a dengue)?',
      options: ['Aedes aegypti', 'Mosca doméstica', 'Abelha-europeia'],
      answer: 0,
      explain: 'Acabar com a água parada, onde o mosquito põe ovos, ainda é a melhor forma de combater a dengue.',
    },
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
    effect: 'Três turbos: aperte o botão de item uma vez para cada pilha.', // (cogumelo triplo)
    fact: 'Em 1800, Alessandro Volta empilhou discos de zinco e cobre separados por pano molhado em água salgada e criou a primeira pilha elétrica.',
    weights: [0, 5, 10, 15, 20, 25, 25, 20],
    quiz: { q: 'Quem criou a primeira pilha elétrica, em 1800?', options: ['Alessandro Volta', 'Thomas Edison', 'Isaac Newton'], answer: 0 },
  },
  maca: {
    id: 'maca', name: 'Maçã de Newton', icon: '🍎', color: 0xe63946,
    effect: 'Deixa uma maçã na pista. Quem passar por cima derrapa.', // (banana)
    fact: 'Newton contou que ver uma maçã cair o fez pensar: a mesma força que puxa a maçã mantém a Lua em órbita. É a gravitação universal!',
    weights: [45, 20, 10, 5, 0, 0, 0, 0],
  },
  alfa: {
    id: 'alfa', name: 'Partícula Alfa', icon: 'α', color: 0xffd23f,
    effect: 'Disparo em linha reta que ricocheteia nos muros. No computador, segure C para atirar para trás.', // (casco verde)
    fact: 'Em 1909, a equipe de Rutherford disparou partículas alfa contra uma folha de ouro. Algumas ricochetearam: o átomo tem um núcleo pequeno e denso!',
    weights: [40, 25, 20, 15, 10, 5, 0, 0],
    quiz: { q: 'Algumas partículas alfa ricochetearam na folha de ouro de Rutherford. O que isso mostrou?', options: ['O átomo tem um núcleo pequeno e denso', 'O ouro é um ímã', 'O átomo é uma bolinha maciça por inteiro'], answer: 0 },
  },
  eletron: {
    id: 'eletron', name: 'Elétron Teleguiado', icon: 'e⁻', color: 0x4cc9f0,
    effect: 'Persegue o kart da frente.', // (casco vermelho)
    fact: 'Cargas opostas se atraem (Lei de Coulomb). O elétron, de carga negativa, é puxado por cargas positivas.',
    weights: [5, 20, 25, 25, 25, 20, 15, 10],
    quiz: { q: 'Qual é a carga elétrica do elétron?', options: ['Negativa', 'Positiva', 'Neutra (sem carga)'], answer: 0 },
  },
  faraday: {
    id: 'faraday', name: 'Gaiola de Faraday', icon: '🛡️', color: 0xc0c7d1,
    effect: 'Por 7 segundos: invencível e mais rápido. Quem você encostar capota!', // (estrela)
    fact: 'Numa casca de metal, a carga elétrica fica do lado de fora e protege quem está dentro. Por isso um carro fechado é um lugar seguro durante uma tempestade de raios.',
    weights: [0, 0, 0, 5, 10, 15, 25, 30],
    quiz: { q: 'Por que um carro fechado é um bom abrigo numa tempestade de raios?', options: ['A carga elétrica passa pela lataria de metal, por fora', 'Os pneus de borracha bloqueiam o raio', 'O vidro afasta os raios'], answer: 0 },
  },
  tesla: {
    id: 'tesla', name: 'Bobina de Tesla', icon: '⚡', color: 0xb388ff,
    effect: 'Um raio atinge todos os adversários: eles rodopiam, encolhem e ficam lentos. Quem está na Gaiola de Faraday fica protegido!', // (raio)
    fact: 'Nikola Tesla criou a bobina que gera faíscas de alta tensão. Um raio de verdade aquece o ar a cerca de 30.000 °C, cinco vezes a temperatura da superfície do Sol.',
    weights: [0, 0, 0, 0, 0, 2, 5, 8], // só um por vez e 30 s de intervalo (items.js)
    quiz: { q: 'Um raio aquece o ar a cerca de quantos graus?', options: ['30.000 °C', '300 °C', '3.000.000 °C'], answer: 0 },
  },
  buraco: {
    id: 'buraco', name: 'Buraco Negro', icon: '🕳️', color: 0x7b2cbf,
    effect: 'Voa até o 1º colocado e o derruba, junto com quem estiver perto dele.', // (casco azul)
    fact: 'A gravidade de um buraco negro é tão forte que nem a luz escapa. Em 2019, foi divulgada a primeira imagem de um, na galáxia M87.',
    weights: [0, 0, 2, 3, 3, 4, 4, 4], // só um por vez e 25 s de intervalo (items.js)
    quiz: { q: 'Por que um buraco negro é “negro”?', options: ['Nem a luz consegue escapar da gravidade dele', 'Ele é coberto de carvão', 'Ele só existe à noite'], answer: 0 },
  },
};

export const ITEM_IDS = Object.keys(ITEMS);

// Classes de motor. speedMult multiplica a velocidade máxima; aiSkill vai de 0 a 1.
// aiSpeed multiplica o ritmo da IA; aiCatchUp = quanto a IA de trás acelera para alcançar o jogador.
export const CLASSES = {
  '50cc': { id: '50cc', label: '50cc', hint: 'Tranquilo', speedMult: 0.8, aiSkill: 0.35, aiSpeed: 0.95, aiCatchUp: 0.05 },
  '100cc': { id: '100cc', label: '100cc', hint: 'Normal', speedMult: 1.0, aiSkill: 0.65, aiSpeed: 0.98, aiCatchUp: 0.08 },
  '150cc': { id: '150cc', label: '150cc', hint: 'Rápido', speedMult: 1.18, aiSkill: 0.92, aiSpeed: 0.99, aiCatchUp: 0.10 },
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
