# Xadrez em Primeira Pessoa: arquitetura

Xadrez 3D em Three.js r170, sem etapa de build obrigatória: `index.html` carrega `js/main.js` como módulo ES.
Todo o visual é procedural (sem imagens, modelos ou sons). O tabuleiro é uma praça de mármore ao ar livre;
visto de cima parece um tabuleiro comum, e em primeira pessoa as peças são estátuas de ~2 m (casa = 2 m).

## Regras gerais
- Todo módulo importa o Three.js de `./three.js` (`import * as THREE from './three.js'`), nunca de outra URL.
- Unidades: metros, segundos e radianos. Y aponta para cima. `a1` fica em `x = -7, z = +7`; as brancas olham para −Z.
- Casas: índice `0..63`, `a1 = 0`, `h8 = 63` (`rank*8 + file`), o mesmo em `rules.js` e no 3D.
- `rules.js` e `ai.js` são JavaScript puro (sem Three.js, sem DOM): rodam em Node e em Workers.
- Não crie objetos por quadro (`new Vector3` em `update`). Reutilize vetores temporários.
- O tabuleiro parado não renderiza a 60 fps: `main.js` só desenha quando câmera, animação ou HUD mudam.
- Todo texto visível ao jogador é em português do Brasil.

## Módulos
- `config.js`: cores, perfis de torno das peças, alturas, tempos de câmera/animação, níveis (`DIFFICULTY`), candidatos de Stockfish.
- `rules.js`: `createGame`, `generateLegalMoves`, `makeMove`/`undoMove`, `inCheck`, `gameStatus`, `toFEN`/`fromFEN`, `toSAN` (chamar antes de `makeMove`), `moveToUCI`/`uciToMove`, `perft`.
- `ai.js`: `bestMove(state, { depth, randomness })` (alfa-beta + tabelas de posição) e `evaluate(state)`; `ai-worker.js` a roda num Worker.
- `engine.js`: classe `Engine`. Tenta os builds de Stockfish de `STOCKFISH_CANDIDATES` (Worker Blob que faz `importScripts` do CDN; o caminho do `.wasm` vai no hash da URL do worker) e cai na IA interna se nenhum responder `uciok`. Scores sempre na perspectiva das brancas. `bestMove(fen)` joga no nível escolhido; `analyze(fen, onUpdate)` usa força máxima e MultiPV 3.
- `board3d.js`: `buildBoard(scene, quality)` cria praça, casas (`InstancedMesh`), realces, moldura com coordenadas, cenário e peças (`Group` por peça, `userData = { isPiece, sq, type, color, height }`). `setPosition(state)`, `applyMoveInstant(move)`, `highlight({...})`, `pieceAt(sq)`, `eyeHeight(group)`, `pickables()`.
- `camera.js`: `CameraRig`: `flyToOverhead(side)`, `flyToPiece(group, eye)`, `followPiece`, `look(dyaw, dpitch)`, `shake`, `update(dt)`; tweens com easing cúbico e slerp.
- `input.js`: `pointerdown/up` com raycast (peça ou casa via `instanceId`), arrasto para olhar, Esc.
- `animations.js`: `Animator.playMove(move, { firstPerson })` (deslizar, salto do cavalo, roque, en passant, promoção, duelo de captura) e `kingFall`. Poeira em `Points`.
- `hud.js`, `menu.js`: DOM. `main.js`: estados `loading → menu → playing ↔ animating/thinking → gameover`.

## Fluxo de um lance
1. Toque numa peça própria: `selected`, `legal`, realces, câmera voa para os olhos da peça (`view = 'firstperson'`).
2. Toque numa casa legal: promoção pergunta a peça; `toSAN` + `makeMove` no estado; `Animator.playMove` anima; `board.applyMoveInstant` sincroniza.
3. Vs computador: `engine.bestMove` já começa durante a animação do humano. Nos turnos do humano `engine.analyze` alimenta avaliação, gráfico e melhores lances.

## Testes
- `npm run test:xadrez`: regras (perft, roque, en passant, promoção, mate, afogamento, repetição, SAN) e IA.
- O 3D e o Stockfish só rodam no navegador (o CDN precisa estar acessível). `window.__xadrez` expõe estado, `fen()` e `play('e2e4')` para depuração.
