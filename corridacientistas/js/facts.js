// Curiosidades do jogo: itens, cientistas e setores da pista.
// short = frase curta (até ~12 palavras) para mostrar durante a corrida;
// text = texto completo, lido com calma na tela de resultado;
// quiz = pergunta opcional da tela de resultado (answer = índice da opção certa).

export const ITEM_FACTS = {
  foguete: [
    {
      short: 'Ação e reação: o foguete empurra os gases para trás.',
      text: '3ª Lei de Newton: o foguete empurra os gases para trás, e os gases empurram o foguete para a frente. Ação e reação!',
      quiz: { q: 'Que lei explica o empurrão de um foguete?', options: ['3ª Lei de Newton (ação e reação)', 'Lei de Ohm', 'Lei de Coulomb', '1ª Lei de Kepler'], answer: 0 },
    },
    {
      short: 'No vácuo o foguete funciona: ele empurra o próprio combustível.',
      text: 'No espaço não há ar para empurrar, e o foguete funciona mesmo assim: ele empurra para trás os gases do próprio combustível queimado.',
      quiz: { q: 'Por que um foguete funciona no vácuo do espaço?', options: ['Porque empurra os gases que ele mesmo expele', 'Porque o espaço tem um pouco de ar', 'Por causa da gravidade da Lua', 'Ele não funciona no vácuo'], answer: 0 },
    },
    {
      short: 'Marcos Pontes foi o primeiro astronauta brasileiro, em 2006.',
      text: 'Em 2006, o tenente-coronel Marcos Pontes foi à Estação Espacial Internacional e se tornou o primeiro astronauta brasileiro.',
      quiz: { q: 'Quem foi o primeiro astronauta brasileiro?', options: ['Marcos Pontes', 'Santos Dumont', 'César Lattes', 'Oswaldo Cruz'], answer: 0 },
    },
  ],
  pilha3: [
    {
      short: 'Volta criou a primeira pilha elétrica em 1800.',
      text: 'Em 1800, Alessandro Volta empilhou discos de zinco e cobre separados por pano molhado em água salgada e criou a primeira pilha elétrica.',
      quiz: { q: 'Em que ano Volta apresentou a primeira pilha elétrica?', options: ['1800', '1500', '1969', '1906'], answer: 0 },
    },
    {
      short: 'A unidade volt (V) homenageia Alessandro Volta.',
      text: 'A unidade de tensão elétrica, o volt (V), homenageia Alessandro Volta. Uma pilha comum de controle remoto tem 1,5 V.',
      quiz: { q: 'A unidade volt homenageia qual cientista?', options: ['Alessandro Volta', 'Nikola Tesla', 'Michael Faraday', 'André-Marie Ampère'], answer: 0 },
    },
    {
      short: 'Na pilha, energia química vira energia elétrica.',
      text: 'Dentro da pilha, uma reação química faz os elétrons saírem de um metal e irem para o outro pelo fio: é energia química virando energia elétrica.',
      quiz: { q: 'Numa pilha, qual transformação de energia acontece?', options: ['Química em elétrica', 'Elétrica em nuclear', 'Térmica em química', 'Luminosa em sonora'], answer: 0 },
    },
  ],
  maca: [
    {
      short: 'A força que derruba a maçã segura a Lua em órbita.',
      text: 'Newton contou que ver uma maçã cair o fez pensar: a mesma força que puxa a maçã mantém a Lua em órbita. É a gravitação universal!',
      quiz: { q: 'Segundo Newton, a força que faz a maçã cair também:', options: ['Mantém a Lua em órbita da Terra', 'Faz o ímã atrair o ferro', 'Produz os raios', 'Faz a luz se dividir no prisma'], answer: 0 },
    },
    {
      short: 'Perto da Terra, a queda ganha 9,8 m/s a cada segundo.',
      text: 'Perto da superfície da Terra, um objeto em queda livre ganha cerca de 9,8 m/s de velocidade a cada segundo, se o ar não atrapalhar. É a aceleração da gravidade.',
      quiz: { q: 'Qual é, aproximadamente, a aceleração da gravidade perto da superfície da Terra?', options: ['9,8 m/s²', '1 m/s²', '98 m/s²', '300.000 km/s'], answer: 0 },
    },
    {
      short: 'Na Lua, sua massa é a mesma, mas o peso cai para 1/6.',
      text: 'Peso é a força com que um planeta puxa a sua massa. Na Lua você teria a mesma massa, mas pesaria cerca de 1/6 do que pesa na Terra.',
      quiz: { q: 'Se você fosse à Lua, o seu peso seria:', options: ['Cerca de 1/6 do peso na Terra', 'Igual ao da Terra', 'O dobro do peso na Terra', 'Zero'], answer: 0 },
    },
  ],
  alfa: [
    {
      short: 'Rutherford usou partículas alfa para descobrir o núcleo do átomo.',
      text: 'Em 1909, a equipe de Rutherford disparou partículas alfa contra uma folha de ouro. Algumas ricochetearam: o átomo tem um núcleo pequeno e denso!',
      quiz: { q: 'O experimento da folha de ouro, de Rutherford, mostrou que o átomo tem:', options: ['Um núcleo pequeno e denso', 'Forma de pudim sem núcleo', 'Só elétrons', 'Tamanho de uma bola de gude'], answer: 0 },
    },
    {
      short: 'A partícula alfa é um núcleo de hélio: 2 prótons e 2 nêutrons.',
      text: 'A partícula alfa é formada por 2 prótons e 2 nêutrons, igual ao núcleo do átomo de hélio, o gás dos balões que flutuam.',
      quiz: { q: 'Uma partícula alfa é igual ao núcleo de qual elemento?', options: ['Hélio', 'Hidrogênio', 'Carbono', 'Urânio'], answer: 0 },
    },
    {
      short: 'Uma simples folha de papel barra a radiação alfa.',
      text: 'A radiação alfa é a menos penetrante: uma folha de papel ou a camada externa da pele já basta para barrá-la.',
      quiz: { q: 'O que basta para barrar a radiação alfa?', options: ['Uma folha de papel', 'Só uma parede de chumbo de 1 m', 'Nada consegue barrar', 'Um ímã forte'], answer: 0 },
    },
  ],
  eletron: [
    {
      short: 'Cargas opostas se atraem: é a Lei de Coulomb.',
      text: 'Cargas opostas se atraem (Lei de Coulomb). No jogo, o kart da frente faz o papel da carga positiva que puxa o elétron.',
      quiz: { q: 'Duas cargas elétricas de sinais opostos:', options: ['Se atraem', 'Se repelem', 'Não interagem', 'Viram nêutrons'], answer: 0 },
    },
    {
      short: 'J. J. Thomson descobriu o elétron em 1897.',
      text: 'O elétron foi descoberto em 1897 pelo físico inglês J. J. Thomson, estudando os raios dentro de tubos de vidro quase sem ar.',
      quiz: { q: 'Quem descobriu o elétron?', options: ['J. J. Thomson', 'Isaac Newton', 'Charles Darwin', 'Galileu Galilei'], answer: 0 },
    },
    {
      short: 'Corrente elétrica no fio é movimento de elétrons.',
      text: 'Quando você liga um aparelho na tomada, o que se move dentro dos fios de cobre são os elétrons: isso é a corrente elétrica.',
      quiz: { q: 'O que se movimenta num fio de cobre quando há corrente elétrica?', options: ['Elétrons', 'Prótons', 'Nêutrons', 'Átomos inteiros de cobre'], answer: 0 },
    },
  ],
  faraday: [
    {
      short: 'Numa casca de metal, o campo elétrico de fora não entra.',
      text: 'Numa carcaça de metal, as cargas se redistribuem na superfície e o campo elétrico externo não entra. Por isso um carro com carroceria metálica protege de raios.',
      quiz: { q: 'Por que um carro de carroceria metálica protege quem está dentro durante um raio?', options: ['A carga fica na superfície de metal e não entra', 'Os pneus de borracha isolam tudo', 'O vidro atrai o raio', 'O motor desvia a eletricidade'], answer: 0 },
    },
    {
      short: 'A porta do micro-ondas é uma gaiola de Faraday.',
      text: 'A grade metálica na porta do forno de micro-ondas funciona como uma gaiola de Faraday: segura as ondas lá dentro e deixa a luz passar para você ver a comida.',
      quiz: { q: 'Por que as micro-ondas não escapam pela porta do forno?', options: ['A grade metálica funciona como gaiola de Faraday', 'O vidro é muito grosso', 'A luz interna bloqueia as ondas', 'Elas escapam, mas são fracas'], answer: 0 },
    },
    {
      short: 'Faraday descobriu a indução: base dos geradores elétricos.',
      text: 'Em 1831, Michael Faraday descobriu a indução eletromagnética: um ímã em movimento gera corrente num fio. É o princípio dos geradores das usinas.',
      quiz: { q: 'A descoberta de Faraday, a indução eletromagnética, é usada em:', options: ['Geradores elétricos', 'Telescópios', 'Vacinas', 'Asas de avião'], answer: 0 },
    },
  ],
  tesla: [
    {
      short: 'Um raio aquece o ar a cerca de 30.000 °C.',
      text: 'Nikola Tesla criou a bobina que gera faíscas de alta tensão. Um raio de verdade aquece o ar a cerca de 30.000 °C, cinco vezes a temperatura da superfície do Sol.',
      quiz: { q: 'Um raio aquece o ar a cerca de:', options: ['30.000 °C', '100 °C', '1.000 °C', '1 milhão de °C'], answer: 0 },
    },
    {
      short: 'Tesla defendeu a corrente alternada, usada nas tomadas.',
      text: 'Tesla defendeu a corrente alternada (CA), que muda de sentido muitas vezes por segundo. É ela que chega às tomadas das casas até hoje.',
      quiz: { q: 'Que tipo de corrente chega às tomadas das casas?', options: ['Alternada', 'Contínua', 'Estática', 'Magnética'], answer: 0 },
    },
    {
      short: 'O Brasil está entre os países com mais raios do mundo.',
      text: 'O Brasil é um dos países com mais raios do mundo: dezenas de milhões por ano. Durante uma tempestade, o lugar mais seguro é dentro de casa ou de um carro fechado.',
      quiz: { q: 'Durante uma tempestade com raios, qual é o lugar mais seguro?', options: ['Dentro de casa ou de um carro fechado', 'Debaixo de uma árvore alta', 'No meio de um campo aberto', 'Dentro de uma piscina'], answer: 0 },
    },
  ],
  buraco: [
    {
      short: 'Nem a luz escapa da gravidade de um buraco negro.',
      text: 'A gravidade de um buraco negro é tão forte que nem a luz escapa. Em 2019, foi divulgada a primeira imagem de um, na galáxia M87.',
      quiz: { q: 'O que torna um buraco negro "negro"?', options: ['Nem a luz consegue escapar dele', 'Ele é feito de carvão', 'Ele fica longe de todas as estrelas', 'Ele absorve só a cor azul'], answer: 0 },
    },
    {
      short: 'No centro da Via Láctea há um buraco negro: Sagitário A*.',
      text: 'Em 2022 foi divulgada a imagem do buraco negro que fica no centro da nossa galáxia, a Via Láctea. Ele se chama Sagitário A*.',
      quiz: { q: 'Como se chama o buraco negro do centro da Via Láctea?', options: ['Sagitário A*', 'M87', 'Andrômeda', 'Alfa Centauri'], answer: 0 },
    },
    {
      short: 'Estrelas gigantes podem desabar e virar buracos negros.',
      text: 'Um buraco negro estelar se forma quando uma estrela muito maior que o Sol esgota o combustível e desaba sobre si mesma.',
      quiz: { q: 'Como se forma um buraco negro estelar?', options: ['Pelo colapso de uma estrela muito grande', 'Pela explosão de um planeta', 'Pelo choque de dois cometas', 'Pelo resfriamento do Sol'], answer: 0 },
    },
  ],
};

export const SCIENTIST_FACTS = {
  newton: [
    { text: 'Newton construiu o primeiro telescópio refletor que funcionava, em 1668.', quiz: { q: 'Que instrumento Newton construiu em 1668?', options: ['O primeiro telescópio refletor', 'O primeiro microscópio', 'A primeira pilha', 'O primeiro termômetro'], answer: 0 } },
    { text: 'Com um prisma, Newton mostrou que a luz branca é a mistura de todas as cores do arco-íris.', quiz: { q: 'O que Newton mostrou usando um prisma?', options: ['A luz branca é a mistura de todas as cores', 'A luz é feita de som', 'O vidro produz cores', 'A luz não se desvia'], answer: 0 } },
    { text: 'No livro "Principia", de 1687, Newton reuniu as três leis do movimento e a gravitação universal.' },
    { text: 'Newton nasceu em 1643 pelo calendário atual. Pelo calendário usado na Inglaterra da época, a data foi 25 de dezembro de 1642.' },
  ],
  curie: [
    { text: 'Os cadernos de Marie Curie ainda são radioativos e ficam guardados em caixas forradas de chumbo.', quiz: { q: 'Por que os cadernos de Marie Curie ficam em caixas de chumbo?', options: ['Ainda são radioativos', 'São muito antigos', 'Têm tinta tóxica', 'Para não pegarem luz'], answer: 0 } },
    { text: 'O elemento polônio recebeu esse nome em homenagem à Polônia, terra natal de Marie Curie.', quiz: { q: 'O nome do elemento polônio homenageia:', options: ['A Polônia, país de Marie Curie', 'O polo Norte', 'O pólen das flores', 'A cidade de Paris'], answer: 0 } },
    { text: 'Na 1ª Guerra Mundial, Marie Curie criou ambulâncias com aparelhos de raio X, apelidadas de "pequenas Curies".' },
    { text: 'Marie Curie foi a primeira pessoa a ganhar dois Prêmios Nobel, em Física (1903) e em Química (1911).' },
  ],
  mendeleev: [
    { text: 'O elemento químico 101 se chama mendelévio em homenagem a Mendeleev.' },
    { text: 'Mendeleev deixou espaços vazios na tabela e previu o gálio e o germânio antes de eles serem descobertos.', quiz: { q: 'O que Mendeleev fez de ousado na sua tabela periódica?', options: ['Deixou espaços para elementos ainda desconhecidos', 'Colocou os elementos em ordem alfabética', 'Inventou o elemento ouro', 'Usou só metais'], answer: 0 } },
    { text: 'Hoje a tabela periódica tem 118 elementos confirmados.', quiz: { q: 'Quantos elementos a tabela periódica tem hoje?', options: ['118', '63', '50', '1.000'], answer: 0 } },
    { text: 'Na tabela periódica, os elementos da mesma coluna (família) têm propriedades químicas parecidas.' },
  ],
  einstein: [
    { text: 'Em 1919, fotos de um eclipse feitas em Sobral, no Ceará, ajudaram a confirmar a relatividade geral.', quiz: { q: 'Em que cidade brasileira fotos de um eclipse ajudaram a confirmar a relatividade?', options: ['Sobral (CE)', 'Manaus (AM)', 'Curitiba (PR)', 'Salvador (BA)'], answer: 0 } },
    { text: 'A fórmula E = mc² mostra que massa e energia são equivalentes: um pouco de massa guarda muita energia.' },
    { text: 'O GPS do celular funciona porque os relógios dos satélites são corrigidos usando a relatividade de Einstein.', quiz: { q: 'Que tecnologia do dia a dia precisa da relatividade para funcionar direito?', options: ['GPS', 'Geladeira', 'Lâmpada', 'Bicicleta'], answer: 0 } },
    { text: 'Einstein ganhou o Nobel de 1921 pelo efeito fotoelétrico, e não pela relatividade.' },
  ],
  galileu: [
    { text: 'Galileu mostrou que, sem a resistência do ar, objetos pesados e leves caem juntos.', quiz: { q: 'Sem a resistência do ar, uma pena e um martelo soltos juntos:', options: ['Chegam ao chão juntos', 'O martelo chega muito antes', 'A pena chega antes', 'Nenhum dos dois cai'], answer: 0 } },
    { text: 'Em 1610, com a luneta, Galileu descobriu as quatro maiores luas de Júpiter, hoje chamadas de luas galileanas.', quiz: { q: 'O que Galileu descobriu com a luneta em 1610?', options: ['Quatro luas de Júpiter', 'Os anéis de Netuno', 'O planeta Plutão', 'Um buraco negro'], answer: 0 } },
    { text: 'Galileu observou as fases de Vênus, uma prova de que Vênus gira em torno do Sol.' },
    { text: 'Em 1633, Galileu foi julgado pela Inquisição por defender que a Terra gira em torno do Sol.' },
  ],
  darwin: [
    { text: 'O Beagle passou pelo Brasil: Darwin visitou Salvador e o Rio de Janeiro em 1832.' },
    { text: 'Nas Galápagos, Darwin viu tentilhões com bicos diferentes em cada ilha, adaptados ao alimento de cada lugar.', quiz: { q: 'O que Darwin notou nos tentilhões das ilhas Galápagos?', options: ['Bicos diferentes, adaptados ao alimento', 'Todos eram iguais', 'Não sabiam voar', 'Eram todos da mesma cor'], answer: 0 } },
    { text: 'Seleção natural: os indivíduos com características mais vantajosas para o ambiente deixam mais descendentes.', quiz: { q: 'Na seleção natural, quem tende a deixar mais descendentes?', options: ['Quem tem características vantajosas para o ambiente', 'Sempre o maior indivíduo', 'Quem nasceu primeiro', 'Todos deixam o mesmo número'], answer: 0 } },
    { text: 'A viagem do Beagle ao redor do mundo durou quase cinco anos, de 1831 a 1836.' },
  ],
  dumont: [
    { text: 'Santos Dumont ajudou a popularizar o relógio de pulso: o joalheiro Louis Cartier fez um para ele ver as horas enquanto pilotava.' },
    { text: 'Em 1906, em Paris, o 14-bis voou cerca de 60 m em outubro e 220 m em novembro, diante do público.', quiz: { q: 'Em que cidade o 14-bis voou diante do público em 1906?', options: ['Paris', 'Rio de Janeiro', 'Nova York', 'Londres'], answer: 0 } },
    { text: 'Santos Dumont deixou livres os desenhos do avião Demoiselle, para que qualquer pessoa pudesse construí-lo.' },
    { text: 'Santos Dumont nasceu em Palmira (MG), cidade que hoje se chama Santos Dumont.', quiz: { q: 'A cidade natal de Santos Dumont hoje tem o nome de:', options: ['Santos Dumont (MG)', 'Petrópolis (RJ)', 'Santos (SP)', 'Palmas (TO)'], answer: 0 } },
  ],
  oswaldo: [
    { text: 'Em 1904, a campanha de vacinação obrigatória contra a varíola, liderada por Oswaldo Cruz, gerou a Revolta da Vacina no Rio.', quiz: { q: 'A Revolta da Vacina, de 1904, aconteceu em qual cidade?', options: ['Rio de Janeiro', 'São Paulo', 'Recife', 'Belo Horizonte'], answer: 0 } },
    { text: 'Oswaldo Cruz combateu a febre amarela eliminando os criadouros do mosquito transmissor, o Aedes aegypti.', quiz: { q: 'Qual mosquito transmite a febre amarela nas cidades?', options: ['Aedes aegypti', 'Anopheles', 'Pernilongo comum', 'Mosca-doméstica'], answer: 0 } },
    { text: 'A Fiocruz nasceu em 1900 como Instituto Soroterápico Federal e hoje leva o nome de Oswaldo Cruz.' },
    { text: 'Uma vacina ensina o sistema imunológico a reconhecer o invasor antes que ele cause a doença.', quiz: { q: 'Como uma vacina protege o corpo?', options: ['Ensina o sistema imunológico a reconhecer o invasor', 'Mata todas as bactérias do corpo', 'Substitui o sangue', 'Funciona como um antibiótico'], answer: 0 } },
  ],
  samuel: [
    { text: 'Nas fotos do site, o Professor Samuel aparece com um cubo mágico: o quebra-cabeça tem mais de 43 quintilhões de combinações.', quiz: { q: 'Quantas combinações, aproximadamente, tem um cubo mágico 3×3?', options: ['Mais de 43 quintilhões', 'Cerca de 1 milhão', 'Exatamente 54', 'Cerca de 10 mil'], answer: 0 } },
    { text: 'O Professor Samuel fez o doutorado em Ciências (Física) no ITA, o Instituto Tecnológico de Aeronáutica, em São José dos Campos.', quiz: { q: 'Em que instituição o Professor Samuel fez o doutorado?', options: ['ITA', 'NASA', 'Fiocruz', 'CBPF'], answer: 0 } },
    { text: 'Além de dar aulas, o Professor Samuel pesquisa Astrofísica: fez pós-doutorado na Universidade do Minho, em Portugal, e na UDESC.' },
    { text: 'Astrofísica é a parte da Física que estuda estrelas, galáxias, buracos negros e o universo inteiro usando as mesmas leis da física da Terra.', quiz: { q: 'O que a Astrofísica estuda?', options: ['Estrelas, galáxias e o universo com as leis da física', 'Só os planetas do Sistema Solar', 'Apenas a previsão do tempo', 'Horóscopo'], answer: 0 } },
  ],
  lattes: [
    { text: 'A Plataforma Lattes, onde ficam os currículos dos pesquisadores brasileiros, tem esse nome em homenagem a César Lattes.', quiz: { q: 'A Plataforma Lattes, dos currículos de pesquisadores, homenageia:', options: ['César Lattes', 'Carlos Chagas', 'Santos Dumont', 'Oswaldo Cruz'], answer: 0 } },
    { text: 'Em 1947, Lattes ajudou a descobrir o méson pi (píon), uma partícula que ajuda a manter o núcleo do átomo unido.', quiz: { q: 'Que partícula César Lattes ajudou a descobrir em 1947?', options: ['O méson pi (píon)', 'O elétron', 'O fóton', 'O neutrino'], answer: 0 } },
    { text: 'Para registrar raios cósmicos, Lattes levou chapas fotográficas especiais ao monte Chacaltaya, na Bolívia, a mais de 5 mil metros de altitude.' },
    { text: 'César Lattes nasceu em Curitiba e foi um dos fundadores do Centro Brasileiro de Pesquisas Físicas (CBPF), no Rio de Janeiro, em 1949.' },
  ],
  franklin: [
    { text: 'A "Foto 51", feita pela equipe de Rosalind Franklin em 1952 com raios X, mostrou o padrão em forma de X que revelou a dupla hélice do DNA.', quiz: { q: 'Que técnica Rosalind Franklin usou para fotografar o DNA?', options: ['Difração de raios X', 'Microscópio comum', 'Ultrassom', 'Telescópio'], answer: 0 } },
    { text: 'Rosalind Franklin morreu em 1958, aos 37 anos. O Nobel de 1962 pela estrutura do DNA foi para Watson, Crick e Wilkins: o prêmio não é dado a quem já morreu.' },
    { text: 'Além do DNA, Rosalind Franklin estudou a estrutura de vírus, como o do mosaico do tabaco, e a do carvão.' },
    { text: 'O DNA guarda as instruções genéticas dos seres vivos em uma sequência de quatro bases: A, T, C e G.', quiz: { q: 'Quantos tipos de base formam o "alfabeto" do DNA?', options: ['Quatro (A, T, C e G)', 'Duas', 'Vinte e seis', 'Cem'], answer: 0 } },
  ],
  johnson: [
    { text: 'Antes do voo de John Glenn, em 1962, o astronauta pediu que Katherine Johnson conferisse à mão os números calculados pelo computador.', quiz: { q: 'O que o astronauta John Glenn pediu a Katherine Johnson antes do voo de 1962?', options: ['Que conferisse os cálculos do computador', 'Que pilotasse a nave', 'Que desenhasse o foguete', 'Que fosse junto no voo'], answer: 0 } },
    { text: 'Katherine Johnson ajudou a calcular trajetórias da missão Apollo 11, que levou pessoas à Lua em 1969.', quiz: { q: 'Em que ano a Apollo 11 levou pessoas à Lua?', options: ['1969', '1906', '1945', '2001'], answer: 0 } },
    { text: 'A história de Katherine Johnson e de outras matemáticas negras da NASA é contada no filme "Estrelas Além do Tempo" (2016).' },
    { text: 'Em 2015, Katherine Johnson recebeu a Medalha Presidencial da Liberdade, a maior honra civil dos Estados Unidos.' },
  ],
  enedina: [
    { text: 'Enedina Alves Marques se formou em Engenharia Civil em 1945, no Paraná: foi a primeira mulher negra engenheira do Brasil.', quiz: { q: 'Quem foi a primeira mulher negra engenheira do Brasil?', options: ['Enedina Alves Marques', 'Marie Curie', 'Katherine Johnson', 'Rosalind Franklin'], answer: 0 } },
    { text: 'Enedina trabalhou no projeto da Usina Hidrelétrica Capivari-Cachoeira, no Paraná, que transforma a energia da água em energia elétrica.', quiz: { q: 'Uma usina hidrelétrica transforma a energia de quê em energia elétrica?', options: ['Da água em movimento', 'Do vento', 'Do Sol', 'Do carvão'], answer: 0 } },
    { text: 'Para pagar os estudos, Enedina trabalhou como professora e como empregada doméstica enquanto cursava engenharia.' },
    { text: 'Enedina também foi a primeira mulher a se formar em engenharia no estado do Paraná.' },
  ],
};

// Setores da pista (nomes iguais aos de track.meta.zones).
export const ZONE_FACTS = {
  largada: {
    name: 'Largada',
    short: 'O 14-bis sobrevoa a largada: 220 m de voo em 1906.',
    text: 'O avião que sobrevoa a largada é o 14-bis, de Santos Dumont. Em 1906, em Paris, ele decolou por meios próprios diante do público.',
    quiz: { q: 'Quem criou o avião 14-bis?', options: ['Santos Dumont', 'Os irmãos Wright', 'Galileu', 'Nikola Tesla'], answer: 0 },
  },
  lab: {
    name: 'Laboratório',
    short: 'Torre de DNA: a molécula tem forma de dupla hélice.',
    text: 'A torre do Laboratório imita o DNA, que tem forma de dupla hélice. A estrutura foi descrita em 1953, com a ajuda das imagens de raio X de Rosalind Franklin.',
    quiz: { q: 'Qual é a forma da molécula de DNA?', options: ['Dupla hélice', 'Cubo', 'Anel simples', 'Pirâmide'], answer: 0 },
  },
  observatorio: {
    name: 'Observatório',
    short: 'Telescópios refletores usam espelhos para juntar a luz.',
    text: 'No Observatório, os grandes telescópios são refletores, como o que Newton inventou: usam espelhos curvos em vez de lentes para juntar a luz das estrelas.',
    quiz: { q: 'O que um telescópio refletor usa para juntar a luz?', options: ['Espelhos curvos', 'Ímãs', 'Lâmpadas', 'Água'], answer: 0 },
  },
  lagoa: {
    name: 'Lagoa de Galápagos',
    short: 'Galápagos: tartarugas e tentilhões diferentes em cada ilha.',
    text: 'Nas ilhas Galápagos, Darwin notou tartarugas e tentilhões diferentes em cada ilha. Essas diferenças foram pistas importantes para a teoria da evolução.',
    quiz: { q: 'As observações de Darwin nas Galápagos ajudaram a criar qual teoria?', options: ['Evolução por seleção natural', 'Gravitação universal', 'Relatividade', 'Tabela periódica'], answer: 0 },
  },
  tunel: {
    name: 'Túnel Espacial',
    short: 'Saturno é tão pouco denso que boiaria na água.',
    text: 'Saturno, o planeta dos anéis, tem densidade menor que a da água: numa banheira gigante, ele boiaria. Os anéis são feitos de pedaços de gelo e rocha.',
    quiz: { q: 'Do que são feitos os anéis de Saturno?', options: ['Pedaços de gelo e rocha', 'Gás hélio', 'Metal líquido', 'Luz'], answer: 0 },
  },
  tesla: {
    name: 'Reta de Tesla',
    short: 'Bobinas de Tesla geram centenas de milhares de volts.',
    text: 'As torres da Reta de Tesla são bobinas de Tesla: elas elevam a tensão elétrica a centenas de milhares de volts e soltam faíscas no ar.',
    quiz: { q: 'O que uma bobina de Tesla produz?', options: ['Tensões elétricas altíssimas e faíscas', 'Ímãs permanentes', 'Luz ultravioleta apenas', 'Som'], answer: 0 },
  },
  final: {
    name: 'Reta final',
    short: 'A luz do Sol leva cerca de 8 minutos para chegar aqui.',
    text: 'A luz do Sol que ilumina a pista viajou cerca de 150 milhões de quilômetros e levou por volta de 8 minutos para chegar à Terra.',
    quiz: { q: 'Quanto tempo a luz do Sol leva para chegar à Terra?', options: ['Cerca de 8 minutos', 'Cerca de 8 segundos', 'Cerca de 8 horas', 'Chega na hora'], answer: 0 },
  },
};

// Embaralha as opções do quiz mantendo a resposta certa.
export function shuffledQuiz(quiz) {
  const order = quiz.options.map((_, i) => i).sort(() => Math.random() - 0.5);
  return { q: quiz.q, options: order.map((i) => quiz.options[i]), answer: order.indexOf(quiz.answer) };
}

// Sorteia sem repetir dentro da sessão (uma fila por chave).
const decks = new Map();
export function pickFact(key, list) {
  if (!list || !list.length) return null;
  let d = decks.get(key);
  if (!d || !d.length) {
    d = list.map((_, i) => i).sort(() => Math.random() - 0.5);
    decks.set(key, d);
  }
  return list[d.pop()];
}
