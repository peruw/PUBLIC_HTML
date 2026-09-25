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
  get maxSpeed(); get invincible(); get stunned()
  item, itemCount, roulette       // controlados por items.js: roulette = { time, showing } | null
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
  constructor(kart, track, { skill })   // skill 0..1 (CLASSES[x].aiSkill)
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
export function createKartModel(characterId, { quality }) -> { group, update(dt, state) }
   // group: origem no contato com o chão, frente +Z, ~1,8 m de comprimento, ~1,3 m de largura,
   // topo da cabeça ~1,7 m. state = { speed, steer, drifting, driftDir, onGround, boosting, stunned, time }
   // update gira rodas, esterça as dianteiras, inclina o piloto, anima acessórios.
export function renderPortraits(renderer, size = 256) -> { [id]: dataURL }   // busto do cientista
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
  update(dt, world)       // motor do world.player (tom pela velocidade), chiado do drift
  sfx(name)
}
```
- Tudo é sintetizado com WebAudio. As músicas são chiptune **originais**.
- O módulo escuta os eventos do bus e toca os sons sozinho.

## Jogo e interface (integração)
`main.js` (loop, estados, renderer), `race.js` (contagem, voltas, posições, chegada, largada-foguete), `hud.js`, `menu.js`, `index.html`, `css/styles.css`.

## Eventos do bus
| Evento | Dados |
|---|---|
| `race:countdown` | `{ n }` (3, 2, 1) |
| `race:go` | `{}` |
| `race:lap` | `{ kart, lap }` |
| `race:finalLap` | `{ kart }` (só o jogador) |
| `race:finish` | `{ kart, place, time }` |
| `race:end` | `{ results }` |
| `kart:hop` | `{ kart }` |
| `kart:land` | `{ kart, airTime }` |
| `kart:driftStart` | `{ kart, dir }` |
| `kart:driftLevel` | `{ kart, level }` |
| `kart:driftEnd` | `{ kart, level }` |
| `kart:boost` | `{ kart, source, duration }`; source: `'drift'` `'pad'` `'item'` `'rocket'` `'trick'` |
| `kart:trick` | `{ kart }` |
| `kart:hit` | `{ kart, type, by }` |
| `kart:bump` | `{ a, b, strength }` |
| `kart:wall` | `{ kart, strength }` |
| `item:pickup` | `{ kart, pos }` (caixa quebrada) |
| `item:got` | `{ kart, item }` (fim da roleta) |
| `item:use` | `{ kart, item }` |
| `item:explode` | `{ pos, item }` |
| `item:lightning` | `{ by }` |
| `item:blackhole` | `{ target, pos }` |

## Depuração
Em `main.js`, `window.__game` expõe:
- `state`, `world`
- `autopilot(on)`
- `giveItem(id)`
- `skipToLastLap()`
- `finishRace()`
- `setQuality(q)`
