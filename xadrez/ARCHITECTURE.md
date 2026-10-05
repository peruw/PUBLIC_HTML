# Xadrez em Primeira Pessoa: arquitetura

Xadrez 3D em Three.js r170, sem etapa de build obrigatória: `index.html` carrega `js/main.js` como módulo ES.
Todo o visual é procedural (sem imagens, modelos ou sons). O tabuleiro é uma praça de mármore ao ar livre
(casa = 2 m) e as peças são PERSONAGENS de batalha articulados (soldado, guardião, cavaleiro montado, clérigo,
rainha e rei). Um lance é o personagem andando até a casa; uma captura é uma luta: o atacante se aproxima,
golpeia e a vítima cai. Em primeira pessoa a câmera fica nos olhos do personagem; na vista de cima a captura
ganha um plano cinematográfico lateral.

## Regras gerais
- Todo módulo importa o Three.js de `./three.js` (`import * as THREE from './three.js'`), nunca de outra URL.
- Unidades: metros, segundos e radianos. Y aponta para cima. `a1` fica em `x = -7, z = +7`; as brancas olham para −Z.
- Casas: índice `0..63`, `a1 = 0`, `h8 = 63` (`rank*8 + file`), o mesmo em `rules.js` e no 3D.
- `rules.js` e `ai.js` são JavaScript puro (sem Three.js, sem DOM): rodam em Node e em Workers.
- Não crie objetos por quadro (`new Vector3` em `update`). Reutilize vetores temporários.
- O tabuleiro parado não renderiza a 60 fps: `main.js` só desenha quando câmera, animação ou HUD mudam.
- Todo texto visível ao jogador é em português do Brasil.

## Módulos
- `config.js`: cores, tempos de câmera/animação, níveis (`DIFFICULTY`), candidatos de Stockfish.
- `rules.js`: `createGame`, `generateLegalMoves`, `makeMove`/`undoMove`, `inCheck`, `gameStatus`, `toFEN`/`fromFEN`, `toSAN` (chamar antes de `makeMove`), `moveToUCI`/`uciToMove`, `perft`.
- `ai.js`: `bestMove(state, { depth, randomness })` (alfa-beta + tabelas de posição) e `evaluate(state)`; `ai-worker.js` a roda num Worker.
- `engine.js`: classe `Engine`. Tenta os builds de Stockfish de `STOCKFISH_CANDIDATES` (Worker Blob que faz `importScripts` do CDN; o caminho do `.wasm` vai no hash da URL do worker) e cai na IA interna se nenhum responder `uciok`. Scores sempre na perspectiva das brancas. `bestMove(fen)` joga no nível escolhido; `analyze(fen, onUpdate)` usa força máxima e MultiPV 3. Uma busca por vez (`_enqueue`): antes de começar outra, manda `stop` e espera o `bestmove` da anterior, senão esse `bestmove` atrasado seria lido como resposta da busca nova. Pedidos que ficaram velhos (`reqId`) nem chegam ao motor. `whenReady`: a abertura não espera o motor; `bestMove`/`analyze` esperam por ele.
- `rig.js`: contrato dos personagens. `humanoid()` (esqueleto com joints nomeados: hips, torso, neck, head, hat, shoulder/elbow/hand L/R, hip/knee L/R, weapon, shield), `horse()` (montaria com mountBody/mountNeck/mountHead/mountLegs/mountTail), `materials(color)` (paleta ARMY.w/ARMY.b), primitivas `G.*` com cache, `mesh()`, `joint()`, `attachWeapon()`, `attachShield()`, `snapshotRest()`/`resetPose()`. Personagens são construídos olhando +Z com os pés na origem; membros pendem em -Y; arma ao longo de +Y no joint `weapon`. `char.getEye(out)` dá a posição dos olhos; `char.setHeadVisible(false)` esconde a cabeça em 1ª pessoa.
- `chars/*.js`: um construtor por peça (`buildPawn`, `buildRook`, `buildKnight`, `buildBishop`, `buildQueen`, `buildKing`); `chars/index.js` expõe `buildCharacter(letter, color)`. Geometrias e materiais extras são criados uma vez por módulo e compartilhados pelas duas cores.
- `battle.js`: animações sobre os joints: `createWalk` (andar/galope), `createIdle`, `createAttack(attacker, victim, { onHit })` por `weaponKind` (spear, sword, hammer, staff, lance), `createHit`, `createDeath`, `createVictory`. Cada Anim tem `update(dt) -> done`.
- `board3d.js`: `buildBoard(scene, quality)` cria praça, casas (`InstancedMesh`), realces, moldura com coordenadas, cenário e peças (`char.group` por peça, `userData = { isPiece, sq, type, color, height, char }`; brancas com `rotation.y = π`). `setPosition(state)`, `applyMoveInstant(move)`, `highlight({...})`, `pieceAt(sq)`, `pickables()`, `setLabelSide(side)`.
- `camera.js`: `CameraRig`: `flyToOverhead(side)`, `flyToPiece(char)` (voa para os olhos e passa a seguir o personagem), `followChar(char)`, `cinematic(a, b)` (plano lateral da luta), `look(dyaw, dpitch)`, `shake`, `update(dt)`; tweens com easing cúbico e slerp. `setPerson('first'|'third')`: segue o personagem pelos olhos ou por cima do ombro (3ª pessoa, suavizada; o arrasto orbita). Em 3ª pessoa `main.js` esconde as peças entre a câmera e o personagem; botão "👁" e tecla V alternam, preferência em `localStorage` (`xadrez_person`).
- `input.js`: `pointerdown/up` com raycast (peça ou casa via `instanceId`), arrasto para olhar, Esc. Em 1ª pessoa ignora as malhas do próprio personagem (`getIgnored`).
- `animations.js`: `Animator.playMove(move, { firstPerson })`: andar até a casa (cavalo pula), roque com a torre em paralelo, en passant, promoção; captura = aproximação até o alcance da arma, a vítima se vira, golpe (`combat`), poeira e tremor no impacto, queda, gesto de vitória, remoção da vítima e passo até a casa final. `kingFall` no mate. Poeira em `Points`.
- `hud.js`, `menu.js`: DOM. `menu.confirm({title, text, yes, no})` pergunta sim/não e volta à tela anterior; `askPromotion` resolve `null` se cancelar. `main.js`: estados `loading → menu → playing ↔ animating/thinking → gameover`.
- Corridas: `G.gen` muda a cada partida nova, desfazer, desistência e saída para o menu; todo fluxo assíncrono (animação, voo da câmera, resposta do motor, timer da tela final) guarda a geração e para se ela mudou. `animator.clear()` resolve as promessas pendentes.

## Fluxo de um lance
1. Toque numa peça própria: `selected`, `legal`, realces, câmera voa para os olhos da peça (`view = 'firstperson'`).
2. Toque numa casa legal: promoção pergunta a peça; `toSAN` + `makeMove` no estado; `Animator.playMove` anima; `board.applyMoveInstant` sincroniza.
3. Vs computador: `engine.bestMove` já começa durante a animação do humano. Nos turnos do humano `engine.analyze` alimenta avaliação, gráfico e melhores lances.

## Testes
- `npm run test:xadrez`: regras (perft, roque, en passant, promoção, mate, afogamento, repetição, SAN) e IA.
- O 3D e o Stockfish só rodam no navegador (o CDN precisa estar acessível). `window.__xadrez` expõe estado, `fen()` e `play('e2e4')` para depuração.
- `dev/chars.html?type=p&color=both&view=three` visualiza os personagens; `anim=attack&victim=p&t=0.8` e `view=fp` testam as animações de batalha (`stub=1` usa as cópias de `dev/stubchars/`).

## Partida online (`js/net.js`)
Sala por código de 5 caracteres (ver também o protocolo no topo de `net.js`). Transporte: canal em tempo real do Supabase do site (`broadcast` + `presence`, sem banco de dados; cliente de `/conta/client.mjs` ou, fora do site, `@supabase/supabase-js` do CDN com a chave pública). `?net=local` troca por `BroadcastChannel` (testes e duas abas). O anfitrião escolhe a cor; cada lance leva o número da meia-jogada e é reenviado até o `ack`; lacunas pedem `sync?` e a lista completa de lances. Convite: `?sala=CODIGO` (lido e tirado da URL). Sem motor de análise no modo online (avaliação escondida).
- Id fixo por aba (`sessionStorage`), então recarregar a página mantém o mesmo jogador; a sessão (`xadrez-online`: código, papel, cor, lances, rodada) também fica no `sessionStorage` e o boot volta para a sala.
- Sala com dono: o anfitrião fixa o id do primeiro convidado; outro só assume se o anterior não estiver presente, senão recebe `full`.
- Rodada `r` em lances/estado: revanche (`rematch?` → `rematch-ok`/`rematch-no`, o anfitrião executa) abre rodada nova com cores trocadas; o `start` é reenviado até o `started`.
- Desistência: `resign` reenviado até `resign-ok`.
