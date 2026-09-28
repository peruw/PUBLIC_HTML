# Corrida dos Cientistas: arquitetura

Kart 3D em Three.js r170, sem etapa de build obrigatória: `index.html` carrega `js/main.js` como módulo ES.
Todo o visual e o áudio são procedurais: não há arquivos de imagem, modelo ou som.

## Regras gerais
- Todo módulo importa o Three.js de `./three.js` (`import * as THREE from './three.js'`), nunca de outra URL.
- Unidades: metros, segundos e radianos. O eixo Y aponta para cima.
- **Rumo (heading):** ângulo em torno de Y. O vetor de frente é `(sin h, 0, cos h)`, então `heading = atan2(dir.x, dir.z)`. Nos modelos, a frente fica em **+Z local**.
- Direita de quem dirige = `(-frente.z, 0, frente.x)`. **Virar à direita DIMINUI o heading.** `object3d.rotation.y = heading`.
- **Direção da corrida:** `s` crescente ao longo da linha central da pista. A linha de chegada fica em `s = 0`.
- Eventos passam pelo `bus` de `js/events.js`. `js/config.js` é somente leitura para os módulos.
- **Desempenho:**
  - A qualidade `baixa` (celular) precisa rodar a 60 fps num celular médio. Use `InstancedMesh` e geometrias mescladas para elementos repetidos, materiais `MeshLambertMaterial`/`MeshStandardMaterial` simples e poucas luzes (1 hemisférica + 1 direcional).
  - Luzes pontuais: no máximo 2 e só na qualidade `alta`.
  - O brilho é feito com sprites aditivos e materiais emissivos. Não há pós-processamento.
- Não crie objetos por quadro (`new Vector3` dentro de `update`). Reutilize vetores temporários.
- Todo texto visível ao jogador é em português do Brasil.

## Objeto `world` (passado para os `update`)
```js
world = {
  scene, camera, renderer,
  track,            // Track
  karts,            // Kart[]; na corrida, karts[0] é o jogador
  player,           // Kart | null (null na demo da tela inicial)
  items,            // ItemSystem
  effects,          // Effects
  bus,
  time,             // s desde a largada (0 durante a contagem)
  phase,            // 'title' | 'countdown' | 'racing' | 'finished'
  quality,          // preset de QUALITY
  cc,               // entrada de CLASSES
  totalLaps,
}
```

## Pista: `js/track.js` (mundo)
```js
export function buildTrack(scene, quality) -> track
track.name                        // 'Campus da Ciência'
track.length                      // comprimento da linha central (m)
track.sample(s) -> { pos, tangent, right, up, halfWidth, wallDist }
   // pos: ponto da linha central NA SUPERFÍCIE; tangent: unitário, para a frente;
   // right: unitário horizontal, à direita de quem corre; s é tomado módulo length.
   // Pode devolver objetos reutilizados: copie se for guardar.
track.project(pos, hintS) -> { s, lateral, groundY, normal, halfWidth, wallDist, offroad }
   // lateral: distância com sinal ao longo de `right` (positivo = direita).
   // offroad = |lateral| > halfWidth.
   // groundY: altura do chão sob pos. Os muros ficam em |lateral| = wallDist.
   // hintS: último s conhecido do objeto. Busca local (±40 m) garante continuidade e
   // resolve trechos que se cruzam (ponte). Sem hintS, faz busca global.
track.curvature(s) -> number      // curvatura com sinal (1/m); positivo = curva para a direita (= -dHeading/ds)
track.racingLine(s) -> lateral    // deslocamento lateral sugerido para a IA
track.gridSlots  -> [{ pos, heading, s }] × 8   // [0] = pole position, atrás da linha (s < 0 ≡ length - x)
track.itemBoxSlots -> [{ pos, s }] × ~30        // centro da caixa, ~1.2 m acima da pista
track.boostPads  -> [{ s, lateral, length, width }]   // pista desenha; kart.js detecta
track.ramps      -> [{ s, lateral, length, width, launch }] // launch = velocidade vertical (m/s)
track.minimapPoints -> [{ x, z }]  // ~256 pontos da linha central
track.update(dt, t)
```
- A pista é um **corredor**: pista (asfalto) até `halfWidth` e acostamento (grama/areia, mais lento) até `wallDist`, com muro/barreira ali.
- Nada físico fica dentro do corredor, e nada fica fora dele: os karts nunca saem.
- O chão é plano na seção transversal, podendo ter uma leve inclinação lateral.

## Ambiente: `js/environment.js` (mundo)
```js
export function buildEnvironment(scene, track, quality, renderer) -> { update(dt, t, camera), sun }
```
- Cuida do céu, da neblina, das luzes (a sombra direcional só existe com `quality.shadows`), do terreno em volta e do cenário temático.
- Nenhum objeto sólido invade o corredor. Elementos acima da pista (arcos, faixas, túnel) ficam com vão livre de pelo menos 6 m.

## Kart: `js/kart.js` (direção)
```js
export class Kart {
  constructor({ character, isPlayer, model, bus, index })
  object3d        // THREE.Group raiz (posição + rumo); main.js adiciona à cena
  visual          // Group filho (inclinação/giro/escala); contém model.group
  character, isPlayer, index
  position (Vector3, contato com o chão), heading, speed (m/s, com sinal), velocity (Vector3), vy
  s, lateral, onGround, offroad, airTime
  controls = { throttle, brake, steer, drift, useItem, lookBack }
     // throttle/brake 0..1; steer -1..1 (positivo = direita); drift = segurado;
     // useItem = pulso de 1 quadro (quem escreve: input/IA; quem consome e zera: items.js)
  drifting, driftDir (-1|0|1), driftLevel (0..3), boostTime, starTime, shrinkTime, spinTime, tumbleTime
  frozen          // true durante a contagem (não se move)
  speedFactor     // multiplicador extra de velocidade (IA usa para rubber-band), padrão 1
  get maxSpeed(); get invincible(); get stunned(); get recovering()   // recovering: atordoado + 1 s de proteção (hit() recusa)
  item, itemCount, roulette       // controlados por items.js: roulette = { time, showing, result } | null
  lap, progress, place, finished, finishTime   // controlados por race.js
  placeAt(slot)                   // reposiciona no grid, zera estados
  update(dt, world)
  applyBoost(duration, strength = 1, source = 'item')
  hit(type, byKart)               // 'spin' | 'tumble' | 'shock'; ignorado se invincible
  shrink(duration)
}
export function updateKarts(karts, dt, world)   // update de cada um + colisões kart×kart por peso
```
- **Direção arcade:** acelerar, frear e ré. Pulo com o botão de drift. Segurar drift numa curva ao pousar inicia o drift.
- **Mini-turbo:** faíscas azul → laranja → roxa (`driftLevel` 1 → 3). Soltar dá o turbo.
- **Rampas:** pular nelas faz uma manobra. Apertar drift no ar dá turbo ao pousar.
- **Aceleradores:** turbo. **Acostamento:** lento, exceto com turbo ou estrela.
- **Muros:** empurram para dentro e cortam a velocidade. Com Gaiola de Faraday (`starTime > 0`), o kart é invencível e mais rápido, e bater em alguém faz o outro capotar (`hit('tumble')`).

## IA: `js/ai.js` (direção)
```js
export class AIDriver {
  constructor(kart, track, { skill, lane })   // skill 0..1 (CLASSES[x].aiSkill); lane = faixa preferida (índice sorteado por corrida)
  update(dt, world)                     // escreve kart.controls (inclusive useItem)
}
```
Segue `racingLine`, faz drift nas curvas, desvia de itens no chão e usa itens com tática (maçã quando há alguém atrás, elétron quando há alguém à frente). Faz rubber-band leve via `kart.speedFactor`.

## Entrada: `js/input.js` (direção)
```js
export class Input {
  constructor({ touchLayer, bus })       // touchLayer: <div id="touch-layer">
  poll() -> { throttle, brake, steer, drift, useItem, lookBack, pause, mute, confirm }
     // useItem, pause, mute, confirm = pulsos (true só no quadro em que foram apertados)
  touchEnabled                          // auto: (pointer: coarse)
  autoAccelerate                        // padrão true no toque
  showTouch(bool)                       // mostra os controles de toque (só durante a corrida)
  setAutoAccelerate(bool)
}
```
- **Teclado:** W/↑ acelera, S/↓ freia/ré, A/D ou ←/→ vira, Espaço = drift/pulo, E/X/Shift = item, C = olhar para trás, Esc/P = pausa, M = mudo, Enter = confirmar.
- **Gamepad:** A/RT acelera, B/LT freia, analógico esquerdo vira, RB/X = drift, LB/Y = item, Start = pausa.
- **Toque:** o próprio `input.js` cria o DOM e o CSS (injetado) dos botões dentro de `touchLayer`.
  - Esquerda: ◀ ▶ grandes.
  - Direita: DRIFT (grande), ITEM e FREIO.
  - Multitoque com pointer events, com áreas generosas e respeitando as `safe-area`.

## Itens: `js/items.js` (itens)
```js
export class ItemSystem {
  constructor({ scene, track, bus, effects, quality })
  reset(karts)            // limpa projéteis/armadilhas, restaura caixas, zera item dos karts
  update(dt, world)       // caixas, roleta, uso (kart.controls.useItem), projéteis, armadilhas
  giveItem(kart, itemId)  // teste/depuração
  rollItem(kart)          // inicia a roleta (sorteio pelos pesos da posição kart.place)
  hazards                 // somente leitura: [{ position: Vector3, s, radius, type }] itens perigosos no chão/voando (IA desvia)
}
```
- **Caixa:** cubo translúcido arco-íris com um átomo girando dentro. Some ao ser pega e volta após `RACE.boxRespawn`. Só dá item se o kart estiver sem item e sem roleta.
- **Foguete:** `applyBoost`.
- **Pilha ×3:** `itemCount = 3`; cada uso gasta 1.
- **Maçã:** fica na pista, atrás do kart.
- **Alfa:** reta, ricocheteia nos muros (reflete a lateral), dura ~8 s.
- **Elétron:** segue a pista até o kart à frente e então persegue.
- **Faraday:** `starTime = 7`.
- **Tesla:** `shrink` + `hit('shock')` em todos os outros, com flash de tela.
- **Buraco Negro:** voa pela pista até o 1º colocado, cresce e engole (`hit('tumble')`) quem estiver no raio.
- Escudos não existem: `invincible` (Faraday) ignora tudo.

## Efeitos: `js/effects.js` (itens)
```js
export class Effects {
  constructor({ scene, bus, quality })
  update(dt, world)              // efeitos contínuos pelo estado dos karts + avanço de partículas
  burst(type, pos, opts)         // 'explosion' | 'sparks' | 'confetti' | 'smoke' | 'electric' | 'pickup' | 'dust'
  flash(color, duration)         // flash de tela (overlay DOM #flash)
  reset()
}
```
- **Contínuos:** faíscas de drift na cor do nível, chamas de turbo, poeira no acostamento, a gaiola de Faraday envolvendo o kart, estrelinhas girando sobre quem está atordoado e rastro de velocidade.
- Tudo usa um pool fixo de partículas (Points ou InstancedMesh). A quantidade escala com `quality.particles`.

## Modelos: `js/models.js` (arte)
```js
export function createKartModel(characterId, { quality }) -> { group, update(dt, state), stats, anchors, dispose }
   // group contém um THREE.LOD: modelo detalhado perto, malha simplificada além de ~25 m
   // group: origem no contato com o chão, frente +Z, ~1,8 m de comprimento, ~1,3 m de largura,
   // topo da cabeça ~1,7 m. state = { speed, steer, drifting, driftDir, onGround, boosting, stunned, time }
   // update gira rodas, esterça as dianteiras, inclina o piloto, anima acessórios.
export function renderPortraits(renderer, size = 256, { ss = 2 } = {}) -> { [id]: dataURL }   // busto do cientista; ss = supersampling
```
Cada cientista precisa ser reconhecível pela silhueta (ver `look` em `config.js`), em estilo low-poly, colorido e caricato.

## Câmera: `js/camera.js` (arte)
```js
export class CameraRig {
  constructor(camera)
  follow(kart)
  setMode(mode, opts)     // 'chase' | 'orbit' (volta ao redor do alvo) | 'podium' | 'flyover' (demo)
  update(dt, world, { lookBack })
  shake(intensity, duration)
  snap()                  // sem suavização no próximo quadro
}
```
**Modo chase:**
- Atrás e acima do kart, suavizado.
- Abre o FOV com a velocidade e o turbo.
- Olha para trás com `lookBack`.
- Não atravessa o chão.

## Áudio: `js/audio.js` (arte)
```js
export class AudioSystem {
  constructor({ bus })
  unlock()                // chamar no 1º gesto do usuário
  muted; setMuted(bool)
  playMusic(name)         // 'menu' | 'race' | 'results' | null
  setFinalLap(bool)       // música acelera
  update(dt, world)       // motor do world.player (timbre por cientista e classe), drift, torcida, rival próximo
  sfx(name)               // inclui 'warn', 'placeUp', 'placeDown', 'wrongWay', 'cheer', 'whoosh'
  setVolume(kind, v)      // kind 'music' | 'sfx', v de 0 a 1 (rampa suave)
  getVolume(kind)
  duck(depth, hold)       // abaixa a música por um instante
}
```
- Tudo é sintetizado com WebAudio. As músicas são chiptune **originais**.
- O módulo escuta os eventos do bus e toca os sons sozinho.

## Novidades de setembro/2026 (resumo das APIs)
- Pista: `track.overpass` (trechos de cima/baixo do viaduto do 8), `track.minimapPoints[i].{s, over, under}`, `track.itemBoxRows` (fileiras de caixas), `track.setViewHint(...)` (chamado pelo ambiente).
- Ambiente: `buildEnvironment(...)` devolve também `setMood(t)` (0 = meio-dia, 1 = hora dourada), `mood`, `hemi`, `groundAt(x, z)`.
- Kart: `hit(type, by, item)`; `offroadLevel` (0 asfalto, 1 zebra, 2 grama); `driftFrozen`; `itemHeld` (item seguro atrás como escudo). Acostamento em duas faixas; drift que começa no ápice do pulo; manobra também em cristas (turbo só com mais de 0,3 s no ar).
- IA: `CLASSES[cc].aiLeadBrake`, `aiMistakes` (erros visíveis; 0 no 150cc), `aiAggression` (uso de Buraco/Tesla); o elástico some nos últimos ~300 m.
- Itens: `items.setMode('race'|'timetrial')`; caixa não é consumida por quem já tem item; Buraco Negro troca de alvo se o 1º chegar e não fere o dono; item sem alvo não é gasto; `ITEMS[id].hold` e `weights50cc`.
- Entrada: `input.poll()` devolve também `holdItem` e `itemBack`; `input.rumble(ms, força)`; direção analógica no toque.
- Modelos: proporções do kart pelos atributos; LOD barato (baixa: 8/14 m); `model.setHero(on)`.
- Câmera/efeitos: `rig.setMode('podium', { position, lookAt })` (chamar uma vez), `rig.kick` (soco do turbo), `effects.speedFeel` (0..1, vinheta), `effects.podiumConfetti(centro, { duration })`.

## Jogo e interface (integração)
`main.js` (loop, estados, renderer), `race.js` (contagem, voltas, posições, chegada, largada-foguete), `hud.js`, `menu.js`, `facts.js`, `index.html`, `css/styles.css`.
- `facts.js`: curiosidades de itens (`ITEM_FACTS`), cientistas (`SCIENTIST_FACTS`) e setores da pista (`ZONE_FACTS`), cada uma com `short` (corrida), `text` (resultado) e `quiz` opcional.
- Modos (`game.opts.mode`): `'race'` e `'timetrial'` (sozinho, só foguetes, fantasma do recorde salvo em `localStorage`).
- `localStorage` (prefixo `kartcientifico-`): `records`, `ranking`, `medals`, `unlock150`, `quiz`, `daily`, `dailyStreak`, `played`, `nick`, `vol-music`, `vol-sfx`, `ghost-<cc>-<voltas>`, `slowHint`, `net-name` e `net-character` (corrida online), além das preferências antigas.
- Parâmetros de URL para o professor: `?cientista=curie&motor=50cc&voltas=1&modo=contrarrelogio` abre direto a escolha. `?sala=CÓDIGO` abre a entrada da corrida online com o código preenchido.

## Dois jogadores no mesmo PC (tela dividida)
- Escolha: `menu.opts.players` (1 | 2) e `menu.opts.character2`; `menu.duo()` diz se vale (só PC, modo corrida, fora de sala de turma; o desafio do dia corre sempre sozinho). Abas "Jogador 1 / Jogador 2", marcadores J1/J2 nos cartões; WASD move o J1 e as setas o J2; `moveSelection(dx, dy, who)`.
- `world.players` = humanos (`[J1]` ou `[J1, J2]`, com `isPlayer = true`); `world.player` continua sendo o J1. `world.split` = tela dividida ativa; `world.camera2` = câmera do J2.
- `main.js`: um renderer, duas metades com `setViewport`/`setScissor`, dois `CameraRig` (`rig`, `rig2`, `rig.fovScale` abre o FOV na metade estreita). Antes da 2ª metade chama `env.update(dt, t, camera2, true)` (só a parte da câmera: céu, sombra, túnel; o `dt` suaviza a penumbra do túnel de cada câmera). 6 IA com `AI_LADDER_2P`; J1 e J2 largam lado a lado. Sem rival, recordes, medalhas, ranking, desafio nem online.
- `race.start(karts, { players })`: largada-foguete, `race:finalLap` e `race:place` para cada humano; a fase vira `'finished'` quando todos os humanos cruzam a chegada.
- `Input.setSplit(on)`: `poll()` devolve só o J1 (WASD, Espaço, E, Q, 1º controle) e `input.state2` recebe o J2 (setas, ponto ou barra, Enter/Shift direito, vírgula/End, 2º controle). Esc/P e Start de qualquer um pausam. `rumble(ms, força, jogador)`. Nenhuma tecla de jogo usa Ctrl: com o Ctrl de um apertado, o W do outro vira Ctrl+W e o navegador fecha a aba.
- `Hud({ bus, index })`: um por jogador. O `index 0` usa o painel `.hud-panel[data-p="1"]` do `index.html` e cuida do minimapa (setas dos dois, com a cor de cada jogador) e das curiosidades (uma por vez, no centro de cima, com etiqueta J1/J2); o `index 1` clona o painel sem ids. `setRace({ ..., split, players })`. Com 1 jogador tudo fica como antes (`#hud` sem a classe `split`).
- IA: elástico e item guardado em relação ao humano mais próximo (`humanRef`). Itens: as caixas não são escondidas pela câmera do J1 na tela dividida. Áudio: motor do J1 à esquerda e do J2 (`eng2`) à direita.
- `PLAYER_COLORS` (hud.js) e `--p1`/`--p2` (CSS): azul (J1) e rosa (J2).
- Um cientista sem modelo 3D em `models.js` usa um kart reserva (`kartModel` em main.js) e fica fora da IA e da demo.

## Corrida online ao vivo (sala por código)
Amigos correm juntos, cada um no seu aparelho (PC ou celular). Não há tabelas novas: tudo passa por um canal público do Supabase Realtime (broadcast + presence), `kart-live:<CÓDIGO>`.
- **`js/netplay.js`** (sem DOM, testável no Node): `SupabaseTransport` (usa `Online.client`: `client.channel(topic, { config: { broadcast: { self: false }, presence: { key: id } } })`, `on('broadcast', { event: 'k' })`, `on('presence', { event: 'sync' })`, `subscribe`, `track`, `send`, `removeChannel`) e `LocalTransport` (BroadcastChannel entre abas da mesma origem, presença simulada por batimentos de 1 s, sai quem fica 8 s sem bater ou manda `bye`). A mesma interface: `connect(meta)`, `track(meta)`, `send(msg)`, `close()`, eventos `msg`, `presence` (Map id → meta) e `status`. `transportKind()`: `?net=local` força o local; com o cliente do site, Supabase; página local (127.0.0.1) sem o `/conta/`, local.
  - `NetRoom`: quem está (ordenado: quem criou a sala, depois por entrada), `host`/`isHost`, `settings` (motor e voltas do anfitrião; quem herda o posto fica com eles e passa a valer como "criador"), `ownerOf`/`resolveCharacter` (cientista repetido fica com quem entrou antes), `update(meta)`, `send(tipo, dados)`, eventos `members`, `join`, `leave`, `msg:<tipo>`.
  - `Interp`: interpolação de um kart remoto (~100 ms atrás, extrapola até 0,25 s, diferença de relógio = a menor já vista). `makeRoomCode()` (5 letras de `ABCDEFGHJKMNPQRSTUVWXYZ23456789`), `cleanName()`.
  - Testes: `node --test corridacientistas/dev/netplay.test.mjs` (mock da API do supabase-js v2, LocalTransport no Node, interpolação com atraso variável e perda de pacotes).
- **`js/netui.js`**: telas `net` (nome, Criar sala / Entrar com código, login opcional) e `lobby` (código grande, copiar link `?sala=CÓDIGO`, jogadores com 👑, cientista sem repetir, motor/voltas só do anfitrião e sem o cadeado do 150cc, Começar com 2+ jogadores, até 8). Meta de presença: `{ id, name, character, joined, phase: 'lobby'|'race'|'results', v, cc, laps, creator }`. Quem está no resultado fica fora da próxima largada.
- **Largada**: o anfitrião manda `start { race, host, seed, cc, laps, grid: [ids], humans: { id: { name, character } }, ia: [{ id: 'ia:N', character, skill, lane }], t0 }` (repete aos 0,4 e 1,2 s; quem já recebeu ignora). Cada aparelho monta a mesma corrida em `main.startNetRace(msg)` e começa a contagem ao receber. A IA (vagas até 8, só cientistas com modelo 3D) roda **só no anfitrião**.
- **`js/netrace.js` (`NetRace`)**, chamada no passo fixo: `preStep` (karts remotos na pose interpolada, `kart.netPose`) e `postStep` (manda o estado, confere o fim). `lag(s)` soma ao relógio da rede o tempo que um aparelho lento não simulou.
  - Kart remoto: `kart.remote = true` (sem física: `updateKarts` e `race.updateProgress` pulam; nas colisões é obstáculo sólido leve: só o kart local reage, com a parte dele de uma batida normal), `kart.netId`, `kart.netName`, `kart.netHit`. `hit()` num kart remoto vira mensagem; `shrink()` e `applyBoost()` não fazem nada nele.
  - Estado `st` a 15 Hz (12 com 4–5 humanos, 10 com 6–8): `{ t, k: [{ i: id, x, y, z, h: rumo, v: velocidade, st: esterço, s, p: progresso, l: volta, ag: no ar, dr/dd/dl: drift, bo: turbo, sa: gaiola, sk: encolhido, sp/ht/tb: giro/tipo/capotagem, hc: proteção, it/ic: item, ro: roleta, hd/hb: item seguro, ft: tempo de chegada }] }` (o anfitrião manda o dele e o da IA na mesma mensagem). Posições (1º, 2º…) pelo progresso de todos.
  - Itens: quem usa simula. Acerto em kart remoto → `hit { target, type, item, by }` e só o dono aplica (`type: 'shield'` quebra o item seguro atrás). Bobina de Tesla → `tesla { by }`: cada aparelho dá o choque nos próprios karts (o anfitrião na IA), respeitando a Gaiola de Faraday. Maçã → `hazard { id, by, from, to, g, s, lat }` cria a mesma maçã em todos; quem bate (decidido no aparelho do dono do kart) manda `hazard-gone { id }`. Foguete, pilha, alfa, elétron e buraco negro → `use { by, item, back, from, target }`: os outros desenham uma cópia **só visual** (`ghost`: não acerta nada; some quando chega o `hit` de quem atirou).
  - **Fica só no aparelho de quem usou/viu**: a maré do buraco negro (perda de velocidade perto da explosão) e as caixas de item (cada aparelho tem as suas; um kart remoto quebra a caixa aqui, mas quem sorteia é o dono). Batidas entre karts: cada aparelho resolve a parte do próprio kart.
  - Chegada: `fin { id, time }` (o estado também leva `ft`). O resultado fecha quando todos os humanos chegaram ou 60 s depois do primeiro (`WAIT_OTHERS`): quem falta recebe tempo estimado no próprio aparelho e manda `fin { est: 1 }`; o anfitrião manda a estimativa da IA e todos adotam. Tela: lista viva (`menu.showNetResults`/`renderNetList`: nome + cientista, "correndo…", prazo), depois o pódio. Botões "Voltar à sala" e "Sair da sala" (`.net-only`/`.net-hide` com `body.net`).
  - Saída: `leave` da presença + 2,5 s de carência → o kart some e vira "abandonou" (quem já tinha chegado mantém o tempo); se quem começou a corrida sair, a IA dele sai junto ("desconectado") e a corrida segue. Quem volta a mandar estado (a rede piscou) volta para a corrida. Na sala, o próximo da fila vira anfitrião.
  - Pausa online: o jogo não para (`game.netMenu`: menu por cima e o kart tira o pé); sem pausa automática ao perder o foco.
  - Não contam para recordes, medalhas, ranking, desafio do dia nem fantasma. HUD: nomes dos outros sobre os karts (`hud.setTags`) e bolinha maior no minimapa; "Você acertou Fulano".
- Depuração: `__game.net` → `create(nome)`, `join(código, nome)`, `pick(id)`, `setOpts({ cc, laps })`, `start()`, `lobby()`, `quit()`, `room`, `race` (resumo com `stats`), `results()`, `fireAt(id, 'eletron')`. Teste com várias abas: `index.html?net=local`.
- Supabase: o canal é público (sem RLS de Realtime); o projeto precisa permitir canais públicos. O plano do projeto limita mensagens por segundo; com a sala cheia (8 humanos a 10 Hz) são ~80 envios/s, cada um entregue a 7. Se o painel do Supabase mostrar limite, reduza `sendRate` em `netrace.js`.

## Eventos do bus
| Evento | Dados |
|---|---|
| `race:countdown` | `{ n }` (3, 2, 1) |
| `race:go` | `{}` |
| `race:reset` | `{}` (volta ao menu ou nova corrida: apaga as luzes de largada) |
| `race:lap` | `{ kart, lap, lapTime }` |
| `race:place` | `{ kart, from, to }` (só o jogador, durante a corrida) |
| `race:rocketEarly` | `{ kart }` (acelerou cedo demais na contagem) |
| `race:finalLap` | `{ kart }` (só o jogador) |
| `race:finish` | `{ kart, place, time }` (online: também para karts remotos, via `race.finishRemote`) |
| `race:end` | `{ results }` |
| `kart:hop` | `{ kart }` |
| `kart:land` | `{ kart, airTime }` |
| `kart:driftStart` | `{ kart, dir }` |
| `kart:driftLevel` | `{ kart, level }` |
| `kart:driftEnd` | `{ kart, level }` |
| `kart:boost` | `{ kart, source, duration }`; source: `'drift'` `'pad'` `'item'` `'rocket'` `'trick'` |
| `kart:trick` | `{ kart }` |
| `kart:hit` | `{ kart, type, by, item }` (item: id do item que acertou) |
| `kart:bump` | `{ a, b, strength }` |
| `kart:wall` | `{ kart, strength }` |
| `item:pickup` | `{ kart, pos }` (caixa quebrada) |
| `item:got` | `{ kart, item }` (fim da roleta) |
| `item:use` | `{ kart, item }` |
| `item:explode` | `{ pos, item }` |
| `item:lightning` | `{ by }` |
| `item:blackhole` | `{ target, pos }` |
| `item:incoming` | `{ kart, item, dist }` (elétron/buraco negro indo na direção do jogador) |

## Depuração
Em `main.js`, `window.__game` expõe:
- `state`, `world`
- `autopilot(on)`
- `giveItem(id)`
- `skipToLastLap()`
- `finishRace()`
- `fastForward(segundos)` (simula sem renderizar)
- `hud`, `env`, `effects`, `items`, `race`, `audio`
- Dois jogadores: `startRace({ players: 2, character, character2 })`, `autopilot2(on)`, `giveItem(id, jogador)`, `finishRace(jogador)`, `players`, `rig2`, `camera2`, `hud2`
