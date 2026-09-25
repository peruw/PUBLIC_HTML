// Corrida dos Cientistas: renderer, loop principal, estados do jogo e integração dos módulos.
import * as THREE from './three.js';
import { CHARACTERS, CLASSES, QUALITY, RACE, ITEM_IDS } from './config.js';
import { bus } from './events.js';
import { buildTrack } from './track.js';
import { buildEnvironment } from './environment.js';
import { Kart, updateKarts } from './kart.js';
import { AIDriver } from './ai.js';
import { Input } from './input.js';
import { ItemSystem } from './items.js';
import { Effects } from './effects.js';
import { createKartModel, renderPortraits } from './models.js';
import { CameraRig } from './camera.js';
import { AudioSystem } from './audio.js';
import { RaceManager } from './race.js';
import { Hud } from './hud.js';
import { Menu, store } from './menu.js';

const STEP = 1 / 60; // passo fixo da simulação
const PLAYER_SLOT = 5; // o jogador larga em 6º
const RESULTS_DELAY = 3.2; // s entre a chegada e a tela de resultado

// Só 'pointer: coarse' conta como celular/tablet (notebooks com tela de toque têm ontouchstart).
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('touch');
// Quem usar a tela de toque mesmo assim ganha o layout de toque.
addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') document.body.classList.add('touch');
}, true);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const game = {
  state: 'loading', // 'loading' | 'title' | 'select' | 'race' | 'results'
  paused: false,
  autopilot: false,
  opts: null,
};

async function init() {
  let audio = null;
  let input = null;
  const menu = new Menu({
    sfx: (n) => audio?.sfx(n),
    onStart: (opts) => startRace(opts),
    onResume: () => {
      setPaused(false);
      if (isTouch) goFullscreen(); // o clique é um gesto: volta à tela cheia
    },
    // 'Trocar cientista' no resultado: volta ao estado de título de verdade
    onPlay: () => { if (game.state !== 'title') enterTitle(); },
    onRestart: () => startRace(game.opts),
    onQuit: () => enterTitle(),
    onToggleSound: () => toggleSound(),
    onToggleQuality: () => toggleQuality(),
    onToggleAuto: () => {
      input.setAutoAccelerate(!input.autoAccelerate);
      store.set('auto', input.autoAccelerate);
      menu.setAutoLabel(input.autoAccelerate);
    },
  });
  menu.show('loading');
  menu.setLoading(0.1, 'Preparando o laboratório…');

  if (!webglAvailable()) {
    document.getElementById('error-text').textContent =
      'Seu navegador não suporta gráficos 3D (WebGL). Tente outro navegador, como Chrome ou Firefox.';
    menu.show('error');
    window.__gameReady = true;
    return;
  }

  // ---------- qualidade e renderer ----------
  const qualityId = store.get('quality', isTouch ? 'baixa' : 'alta');
  const quality = QUALITY[qualityId] || QUALITY.alta;
  menu.setQualityLabel(quality.id);

  const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, powerPreference: 'high-performance' });
  const maxPR = Math.min(devicePixelRatio || 1, quality.pixelRatio);
  let pixelRatio = maxPR;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('app').appendChild(renderer.domElement);
  let needsRender = true; // redesenha uma vez mesmo em pausa/menus
  // Perda do contexto WebGL: pausa em vez de correr às cegas.
  renderer.domElement.addEventListener('webglcontextlost', () => {
    if (game.state === 'race' && !game.paused) setPaused(true);
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => { needsRender = true; });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, quality.drawDistance + 400);

  await nextFrame();
  menu.setLoading(0.25, 'Asfaltando o Campus da Ciência…');
  await nextFrame();
  const track = buildTrack(scene, quality);

  menu.setLoading(0.5, 'Montando o observatório…');
  await nextFrame();
  const env = buildEnvironment(scene, track, quality, renderer);

  menu.setLoading(0.7, 'Chamando os cientistas…');
  await nextFrame();
  const effects = new Effects({ scene, bus, quality });
  const items = new ItemSystem({ scene, track, bus, effects, quality });
  const karts = CHARACTERS.map((character, index) => {
    const model = createKartModel(character.id, { quality });
    const kart = new Kart({ character, isPlayer: false, model, bus, index });
    scene.add(kart.object3d);
    return kart;
  });

  menu.setLoading(0.85, 'Tirando as fotos oficiais…');
  await nextFrame();
  try {
    menu.setPortraits(await Promise.resolve(renderPortraits(renderer, 256, { ss: quality.id === 'baixa' ? 1 : 2 })));
  } catch (err) {
    console.warn('retratos indisponíveis', err);
  }

  const rig = new CameraRig(camera);
  audio = new AudioSystem({ bus });
  input = new Input({ touchLayer: document.getElementById('touch-layer'), bus });
  // pointerdown: o toque com outro dedo segurando um botão não gera 'click'
  const pauseBtn = document.getElementById('hud-pause');
  pauseBtn.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') {
      e.preventDefault();
      setPaused(true);
    }
  });
  pauseBtn.addEventListener('click', () => setPaused(true));
  input.showTouch(false);
  input.setAutoAccelerate(store.get('auto', input.touchEnabled));
  menu.setAutoLabel(input.autoAccelerate);
  const race = new RaceManager({ bus });
  const hud = new Hud({ bus });

  audio.setMuted(store.get('muted', false));
  menu.setSoundLabel(audio.muted);

  const world = {
    scene, camera, renderer, track, karts, player: null, items, effects, bus,
    time: 0, phase: 'title', quality, cc: CLASSES['100cc'], totalLaps: RACE.defaultLaps,
  };
  let drivers = new Map(); // kart -> AIDriver
  let playerAI = null;
  let resultsTimer = -1;
  let pendingUse = false; // aperto de item guardado até o próximo passo (telas > 60 Hz)

  // Pré-compila os shaders para evitar travadas na primeira corrida.
  try {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } catch (err) {
    console.warn('pré-compilação falhou', err);
  }

  // ---------- estados ----------
  function setupGrid(order) {
    order.forEach((k, i) => k.placeAt(track.gridSlots[i]));
  }

  function enterTitle() {
    game.state = 'title';
    setPaused(false, true);
    world.player = null;
    hud.player = null; // sem toasts de itens do antigo jogador no demo
    introTimer = 0;
    pendingUse = false;
    bus.emit('race:reset');
    world.karts = karts;
    world.phase = 'title';
    world.cc = CLASSES['100cc'];
    for (const k of karts) {
      k.isPlayer = false;
      k.frozen = false;
    }
    const order = karts.slice().sort(() => Math.random() - 0.5);
    setupGrid(order);
    items.reset(karts);
    effects.reset();
    drivers = new Map(karts.map((k) => [k, new AIDriver(k, track, { skill: 0.55 + Math.random() * 0.4 })]));
    race.phase = 'idle';
    rig.setMode('flyover');
    rig.snap();
    hud.show(false);
    input.showTouch(false);
    menu.show('title');
    audio.playMusic('menu');
    audio.setFinalLap(false);
    resultsTimer = -1;
  }

  function startRace(opts) {
    game.opts = opts;
    game.state = 'race';
    setPaused(false, true);
    pendingUse = false;
    bus.emit('race:reset');
    const cc = CLASSES[opts.cc] || CLASSES['100cc'];
    world.cc = cc;
    world.totalLaps = opts.laps;
    const player = karts.find((k) => k.character.id === opts.character) || karts[0];
    const others = karts.filter((k) => k !== player).sort(() => Math.random() - 0.5);
    // karts[0] é o jogador; o grid tem o jogador em PLAYER_SLOT
    world.karts = [player, ...others];
    const grid = others.slice();
    grid.splice(PLAYER_SLOT, 0, player);
    setupGrid(grid);
    for (const k of karts) k.isPlayer = k === player;
    world.player = player;
    items.reset(karts);
    effects.reset();
    drivers = new Map(
      others.map((k, i) => [k, new AIDriver(k, track, {
        skill: THREE.MathUtils.clamp(cc.aiSkill + (Math.random() - 0.5) * 0.16, 0.2, 1),
        lane: i, // faixa sorteada a cada corrida (others já vem embaralhado)
      })]),
    );
    playerAI = new AIDriver(player, track, { skill: 0.9 });
    race.start(world.karts, { laps: opts.laps, player, track, cc });
    world.phase = 'countdown';
    hud.setRace({ player, karts: world.karts, totalLaps: opts.laps, track });
    hud.show(true);
    input.showTouch(input.touchEnabled);
    rig.follow(player);
    rig.setMode('orbit', { target: player, radius: 9, height: 3.5, speed: 0.6 });
    rig.snap();
    introTimer = 1.6;
    menu.hideAll();
    audio.playMusic('race');
    audio.setFinalLap(false);
    resultsTimer = -1;
    if (isTouch) goFullscreen();
  }
  let introTimer = 0;

  function showResults() {
    game.state = 'results';
    const results = race.buildResults();
    hud.show(false);
    input.showTouch(false);
    rig.setMode('orbit', { target: world.player, radius: 7, height: 2.6, speed: 0.35 });
    menu.showResults(results, world.player);
    audio.playMusic('results');
  }

  function setPaused(on, silent) {
    if (on && game.state !== 'race') return;
    game.paused = on;
    audio.pauseAll?.(on);
    needsRender = true;
    if (on) pendingUse = false;
    if (on) {
      input.showTouch(false);
      menu.show('pause');
    } else if (!silent) {
      menu.hideAll();
      if (game.state === 'race') input.showTouch(input.touchEnabled);
    }
  }

  function toggleSound() {
    audio.unlock();
    audio.setMuted(!audio.muted);
    store.set('muted', audio.muted);
    menu.setSoundLabel(audio.muted);
  }

  function toggleQuality() {
    const next = quality.id === 'alta' ? 'baixa' : 'alta';
    store.set('quality', next);
    menu.setQualityLabel(next + ' (recarregando…)');
    setTimeout(() => location.reload(), 250);
  }

  // Áudio só pode começar depois de um gesto do usuário. Tenta a cada gesto
  // até o contexto rodar (iOS só libera em touchend/click).
  const unlockEvents = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
  const unlock = () => {
    audio.unlock();
    if (game.state === 'title') audio.playMusic('menu');
    if (audio.ctx?.state === 'running') for (const ev of unlockEvents) removeEventListener(ev, unlock, true);
  };
  const armUnlock = () => {
    for (const ev of unlockEvents) addEventListener(ev, unlock, { capture: true, passive: true });
  };
  armUnlock();

  // Pausa automática ao trocar de aba.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'race' && !game.paused) setPaused(true);
    // iOS pode deixar o áudio 'interrupted': volta a tentar no próximo gesto
    if (!document.hidden && audio.ctx) setTimeout(() => { if (audio.ctx.state !== 'running') armUnlock(); }, 300);
  });

  // Saiu da tela cheia no celular (gesto de voltar): pausa.
  document.addEventListener('fullscreenchange', () => {
    if (isTouch && !document.fullscreenElement && game.state === 'race' && !game.paused) setPaused(true);
  });

  // ---------- redimensionamento e orientação ----------
  const rotateHint = document.getElementById('rotate-hint');
  function onResize() {
    renderer.setSize(innerWidth, innerHeight);
    needsRender = true; // setSize limpa o canvas
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    const portrait = isTouch && innerHeight > innerWidth && Math.min(screen.width, screen.height) < 600;
    rotateHint.classList.toggle('hidden', !portrait);
    if (portrait && game.state === 'race' && !game.paused) setPaused(true);
  }
  addEventListener('resize', onResize);
  onResize();

  // ---------- gamepad nos menus ----------
  // Lido em TODO quadro, para um A segurado (acelerar) não virar um novo "confirmar".
  let padConfirmPrev = false;
  function pollPadConfirm() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pressed = false;
    for (const p of pads) if (p && (p.buttons[0]?.pressed || p.buttons[9]?.pressed)) pressed = true;
    const edge = pressed && !padConfirmPrev;
    padConfirmPrev = pressed;
    return edge;
  }

  // Navegação: direcional/analógico escolhe o cientista, LB/RB trocam motor/voltas, B volta.
  const padPrev = { b: false, lb: false, rb: false };
  let padDir = null;
  let padRepeat = 0;
  function pollPadMenu(dt, act) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let dx = 0, dy = 0, b = false, lb = false, rb = false;
    for (const p of pads) {
      if (!p) continue;
      const bt = (i) => !!p.buttons[i]?.pressed;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (bt(14) || ax < -0.5) dx = -1;
      else if (bt(15) || ax > 0.5) dx = 1;
      if (bt(12) || ay < -0.5) dy = -1;
      else if (bt(13) || ay > 0.5) dy = 1;
      b = b || bt(1);
      lb = lb || bt(4);
      rb = rb || bt(5);
    }
    const edgeB = b && !padPrev.b, edgeLB = lb && !padPrev.lb, edgeRB = rb && !padPrev.rb;
    padPrev.b = b;
    padPrev.lb = lb;
    padPrev.rb = rb;
    // direção com repetição ao segurar
    const dir = dx || dy ? `${dx},${dy}` : null;
    let move = false;
    if (dir !== padDir) {
      padDir = dir;
      padRepeat = 0.35;
      move = !!dir;
    } else if (dir) {
      padRepeat -= dt;
      if (padRepeat <= 0) {
        padRepeat = 0.2;
        move = true;
      }
    }
    const cur = menu.current;
    if (!cur || !act) return;
    if (cur === 'select') {
      if (move) menu.moveSelection(dx, dy);
      if (edgeLB || edgeRB) {
        const o = menu.opts;
        if (edgeLB) {
          const ids = Object.keys(CLASSES);
          o.cc = ids[(ids.indexOf(o.cc) + 1) % ids.length];
        }
        if (edgeRB) {
          const L = RACE.lapOptions;
          o.laps = L[(L.indexOf(o.laps) + 1) % L.length];
        }
        audio.sfx('menuMove');
        menu.refreshSelect();
      }
    }
    if (edgeB) {
      if (cur === 'select' || cur === 'howto') menu.action('back');
      else if (cur === 'pause') menu.action('resume');
      else if (cur === 'results') menu.action('quit');
    }
  }

  // ---------- simulação ----------
  let ctrl = null;
  function simulate(h) {
    const player = world.player;
    world.time = race.time;
    if (player) {
      if (game.autopilot || player.finished) {
        playerAI.update(h, world);
        pendingUse = false;
      } else if (ctrl) {
        const c = player.controls;
        c.throttle = ctrl.throttle;
        c.brake = ctrl.brake;
        c.steer = ctrl.steer;
        c.drift = ctrl.drift;
        c.lookBack = ctrl.lookBack;
        if (pendingUse) {
          c.useItem = true;
          pendingUse = false;
        }
      }
    }
    for (const [k, ai] of drivers) ai.update(h, world);
    // Fora da corrida (demo do título, resultado) ninguém usa itens: sem flashes/trovões nos menus.
    if (game.state !== 'race') for (const k of world.karts) k.controls.useItem = false;
    updateKarts(world.karts, h, world);
    items.update(h, world);
    if (game.state === 'race' || game.state === 'results') {
      race.update(h, world);
      world.phase = race.phase === 'countdown' ? 'countdown' : race.phase === 'finished' ? 'finished' : 'racing';
    }
  }

  bus.on('race:finish', ({ kart }) => {
    if (kart === world.player) resultsTimer = RESULTS_DELAY;
  });

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let acc = 0;
  let slowTime = 0;
  let fastTime = 0;
  let checkTime = 0; // conferência depois de reduzir a resolução
  let dtBefore = 0;
  let prBefore = 0;
  let noLower = false; // limite de quadros (ex.: 30 Hz) ou CPU: reduzir não adianta
  let slowWarned = false;
  let dtAvg = 1 / 60;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    ctrl = input.poll();

    if (ctrl.mute) toggleSound();
    const pauseToggled = game.state === 'race' && ctrl.pause;
    if (pauseToggled) setPaused(!game.paused);
    const padConfirm = pollPadConfirm();
    const confirmed = !!menu.current && padConfirm && !pauseToggled;
    if (confirmed) menu.confirm();
    pollPadMenu(dt, !confirmed && !pauseToggled);
    if (ctrl.useItem && game.state === 'race' && !game.paused) pendingUse = true;

    if (!game.paused) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 5) {
        simulate(STEP);
        acc -= STEP;
        n++;
      }
      if (n === 5) acc = 0;
      effects.update(dt, world);

      if (introTimer > 0) {
        introTimer -= dt;
        if (introTimer <= 0 && game.state === 'race') rig.setMode('chase');
      }
      if (resultsTimer > 0) {
        resultsTimer -= dt;
        if (resultsTimer <= 0) showResults();
      }
    }

    rig.update(dt, world, { lookBack: !!(world.player && !game.autopilot && ctrl.lookBack && game.state === 'race') });
    env.update(dt, t, camera);
    track.update(dt, t);
    if (game.state === 'race') hud.update(game.paused ? 0 : dt, world, race);
    if (!game.paused) audio.update(dt, world);
    // Pausa e telas que cobrem o jogo: não redesenha a cena 3D (economiza bateria).
    const idle = game.paused || menu.current === 'select' || menu.current === 'howto';
    if (!idle || needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
    }

    // Resolução adaptativa: reduz se o aparelho não aguenta e volta a subir quando melhora.
    dtAvg += (dt - dtAvg) * 0.05;
    adaptResolution(dt);
  }

  const PR_MIN = 0.75;
  function setPR(r) {
    pixelRatio = r;
    renderer.setPixelRatio(r);
  }
  function adaptResolution(dt) {
    if (game.state !== 'race' || game.paused) {
      slowTime = fastTime = 0;
      return;
    }
    if (checkTime > 0) {
      // Reduziu e não melhorou pelo menos 8%: volta e para de reduzir.
      checkTime -= dt;
      if (checkTime <= 0 && dtAvg > dtBefore * 0.92) {
        setPR(prBefore);
        noLower = true;
      }
      return;
    }
    if (dtAvg > 1 / 28) {
      fastTime = 0;
      slowTime += dt;
      if (slowTime > 2.5) {
        slowTime = 0;
        if (!noLower && pixelRatio > PR_MIN) {
          dtBefore = dtAvg;
          prBefore = pixelRatio;
          setPR(Math.max(PR_MIN, pixelRatio - 0.15));
          checkTime = 3;
        } else if (quality.id === 'alta' && !slowWarned) {
          // Ainda lento em 'alta' (reduzir não resolve mais): a próxima visita já começa em 'baixa'.
          slowWarned = true;
          store.set('quality', 'baixa');
          hud.toast?.('Jogo lento? Da próxima vez o jogo abre em <b>Qualidade: baixa</b> (dá para trocar no menu inicial).', 6000);
        }
      }
    } else if (dtAvg < 1 / 50 && pixelRatio < maxPR) {
      slowTime = 0;
      fastTime += dt;
      if (fastTime > 5) {
        setPR(Math.min(maxPR, pixelRatio + 0.1));
        fastTime = 0;
      }
    } else slowTime = fastTime = 0;
  }
  renderer.setAnimationLoop(frame);

  // ---------- depuração / testes ----------
  window.__game = {
    game, world, race, rig, audio, items, input, menu,
    get state() { return game.state; },
    startRace: (o = {}) => startRace({ character: 'newton', cc: '100cc', laps: 3, ...o }),
    enterTitle,
    autopilot(on = true, skill) {
      game.autopilot = on;
      if (skill !== undefined && world.player) playerAI = new AIDriver(world.player, track, { skill });
      return on;
    },
    giveItem: (id) => world.player && items.giveItem(world.player, id),
    itemIds: ITEM_IDS,
    skipToLastLap() {
      const L = track.length;
      const add = (world.totalLaps - 1) * L;
      for (const k of world.karts) {
        k.progress += add;
        k.maxLap = Math.floor(k.progress / L) + 1;
      }
      if (world.player) bus.emit('race:finalLap', { kart: world.player });
    },
    finishRace() {
      if (world.player && !world.player.finished) race.finishKart(world.player);
    },
    // Avança a simulação rapidamente (testes automáticos).
    fastForward(seconds) {
      const steps = Math.round(seconds / STEP);
      for (let i = 0; i < steps; i++) {
        simulate(STEP);
        if (resultsTimer > 0) {
          resultsTimer -= STEP;
          if (resultsTimer <= 0) showResults();
        }
      }
    },
    setPixelRatio(r) {
      setPR(r);
    },
  };

  menu.setLoading(1, 'Pronto!');
  await nextFrame();
  enterTitle();
  window.__gameReady = true;
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function goFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
    .catch(() => {});
}

init().catch((err) => {
  console.error(err);
  window.__gameReady = true;
  document.getElementById('screen-loading')?.classList.add('hidden');
  document.getElementById('error-text').textContent = 'Algo deu errado ao iniciar o jogo. Recarregue a página.';
  document.getElementById('screen-error')?.classList.remove('hidden');
});
