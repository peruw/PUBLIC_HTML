// Kart Científico: renderer, loop principal, estados do jogo e integração dos módulos.
import * as THREE from './three.js';
import { CHARACTERS, CLASSES, QUALITY, RACE, ITEM_IDS } from './config.js';
import { bus } from './events.js';
import { buildTrack } from './track.js';
import { buildEnvironment } from './environment.js';
import { buildAds } from './ads.js';
import { Kart, updateKarts } from './kart.js';
import { AIDriver } from './ai.js';
import { Input } from './input.js';
import { ItemSystem } from './items.js';
import { Effects } from './effects.js';
import { createKartModel, renderPortraits } from './models.js';
import { KartPreview } from './preview.js';
import { CameraRig } from './camera.js';
import { AudioSystem } from './audio.js';
import { RaceManager } from './race.js';
import { Hud } from './hud.js';
import { Menu, store, is150Unlocked } from './menu.js';
import { Online, boardOf } from './online.js';

const STEP = 1 / 60; // passo fixo da simulação
const PLAYER_SLOT = 5; // o jogador larga em 6º
const RESULTS_DELAY = 3.2; // s entre a chegada e a tela de resultado
// Escada de habilidade dos 7 adversários em torno de CLASSES[cc].aiSkill: sempre há um mais forte
// (o rival) para perseguir e um mais fraco para ultrapassar.
const AI_LADDER = [0.12, 0.06, 0.02, 0, -0.04, -0.08, -0.12];
const GHOST_DT = 0.1; // s entre as amostras do fantasma do contrarrelógio

// Desafio do dia: o mesmo para todo mundo (semente = data).
function dailyChallenge() {
  const d = new Date();
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let x = Number(key.replace(/-/g, '')) >>> 0;
  const rnd = () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ch = CHARACTERS[Math.floor(rnd() * CHARACTERS.length)];
  const ccs = ['50cc', '100cc', '150cc'];
  let cc = ccs[Math.floor(rnd() * ccs.length)];
  if (cc === '150cc' && !is150Unlocked()) cc = '100cc'; // o sorteio é igual para todos; só a classe cai
  const podium = rnd() < 0.5;
  return { key, character: ch.id, cc, laps: 2, maxPlace: podium ? 3 : 1, label: `${ch.name} · ${cc} · ${podium ? 'chegar no pódio' : 'vencer'}` };
}

// Só 'pointer: coarse' conta como celular/tablet (notebooks com tela de toque têm ontouchstart).
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('touch');
// Quem usar a tela de toque mesmo assim ganha o layout de toque.
addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') document.body.classList.add('touch');
}, true);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
// Embaralhamento justo (Fisher–Yates): sort(() => random - 0.5) é enviesado no V8.
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const game = {
  state: 'loading', // 'loading' | 'title' | 'select' | 'race' | 'results'
  paused: false,
  autopilot: false,
  opts: null,
};

async function init() {
  let audio = null;
  let input = null;
  let preview = null; // kart 3D girando na escolha do cientista
  const menu = new Menu({
    sfx: (n) => audio?.sfx(n),
    onStart: (opts) => startRace(opts),
    onResume: () => {
      setPaused(false);
      if (isTouch) goFullscreen(); // o clique é um gesto: volta à tela cheia
    },
    // 'Trocar cientista' no resultado: volta ao estado de título de verdade
    onPlay: () => { if (game.state !== 'title') enterTitle(); },
    // a sala vem do menu: se o aluno saiu dela (fechada, nome recusado), a nova corrida não vai para ela
    onRestart: () => startRace({ ...game.opts, room: game.opts?.room ? menu.room : null }),
    onQuit: () => enterTitle(),
    onToggleSound: () => toggleSound(),
    onCharacter: (id) => preview?.setCharacter(id),
    onScreen: (name) => preview?.setActive(name === 'select'),
    onToggleQuality: () => toggleQuality(),
    onToggleAuto: () => {
      input.setAutoAccelerate(!input.autoAccelerate);
      store.set('auto', input.autoAccelerate);
      menu.setAutoLabel(input.autoAccelerate);
    },
    onVolume: (kind, v) => {
      audio?.setVolume?.(kind, v);
      store.set('vol-' + kind, v);
    },
    onDaily: () => {
      const d = dailyChallenge();
      startRace({ character: d.character, cc: d.cc, laps: d.laps, mode: 'race', daily: d });
    },
    dailyInfo: () => {
      const d = dailyChallenge();
      const st = store.get('daily', {});
      const sk = store.get('dailyStreak', { last: '', n: 0 });
      const y = new Date(Date.now() - 864e5);
      const yKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
      const alive = sk.last === d.key || sk.last === yKey;
      return { label: d.label, done: !!st[d.key], streak: alive ? sk.n : 0 };
    },
    qualityId: () => qualityId,
    onSetQuality: (id) => {
      store.set('quality', id);
      setTimeout(() => location.reload(), 150);
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
  // Propagandas da Quanta Aulas ao longo da pista (placas, outdoors, dirigível)
  const ads = buildAds(scene, track, quality, env);

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
  preview = new KartPreview(document.getElementById('detail-kart'), { quality });
  document.getElementById('detail-visual').classList.toggle('has-3d', preview.ok);
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
  // ranking online (conta do site): carrega em segundo plano (mesmo passando dos 8 s de espera);
  // sem ela o jogo segue normal
  Online.init();
  let runTicket = null; // promessa do bilhete da corrida atual (kart_start_run)
  const hud = new Hud({ bus });

  audio.setMuted(store.get('muted', false));
  menu.setSoundLabel(audio.muted);
  const volMusic = store.get('vol-music', 1);
  const volSfx = store.get('vol-sfx', 1);
  audio.setVolume?.('music', volMusic);
  audio.setVolume?.('sfx', volSfx);
  menu.setVolumes(volMusic, volSfx);

  const world = {
    scene, camera, renderer, track, karts, player: null, items, effects, bus,
    time: 0, phase: 'title', quality, cc: CLASSES['100cc'], totalLaps: RACE.defaultLaps,
  };
  let drivers = new Map(); // kart -> AIDriver
  let playerAI = null;
  let resultsTimer = -1;
  let pendingUse = false; // aperto de item guardado até o próximo passo (telas > 60 Hz)
  let holdLatch = false; // item seguro mantido depois da pausa até um novo aperto

  // Pré-compila os shaders para evitar travadas na primeira corrida.
  try {
    // compileAsync só adianta com KHR_parallel_shader_compile (sem ela o three só avisa no console)
    if (renderer.compileAsync && renderer.extensions?.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, camera);
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
    // demo do título: 8 cientistas sorteados entre todos (a pista tem 8 posições de largada)
    const order = shuffle(karts.slice()).slice(0, RACE.kartCount);
    world.karts = order;
    world.phase = 'title';
    world.cc = CLASSES['100cc'];
    for (const k of karts) {
      k.isPlayer = false;
      k.frozen = false;
      k.object3d.visible = order.includes(k);
      k.model?.setHero?.(false);
    }
    setGhost(null);
    env.setMood?.(0);
    moodT = -1; // não deixa a hora dourada continuar animando no título
    items.setMode?.('race');
    world.rival = null;
    setupGrid(order);
    items.reset(order);
    effects.reset();
    drivers = new Map(order.map((k) => [k, new AIDriver(k, track, { skill: 0.55 + Math.random() * 0.4 })]));
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
    opts = { mode: 'race', ...opts };
    game.opts = opts;
    game.state = 'race';
    setPaused(false, true);
    pendingUse = false;
    bus.emit('race:reset');
    const tt = opts.mode === 'timetrial';
    const cc = CLASSES[opts.cc] || CLASSES['100cc'];
    world.cc = cc;
    world.totalLaps = opts.laps;
    world.mode = opts.mode;
    const player = karts.find((k) => k.character.id === opts.character) || karts[0];
    // contrarrelógio: sozinho na pista (os outros karts somem)
    // 7 adversários sorteados entre os demais cientistas; quem não corre fica fora de cena
    const others = tt ? [] : shuffle(karts.filter((k) => k !== player)).slice(0, RACE.kartCount - 1);
    for (const k of karts) {
      k.object3d.visible = k === player || others.includes(k);
      k.frozen = false;
    }
    // karts[0] é o jogador; o grid tem o jogador em PLAYER_SLOT
    world.karts = [player, ...others];
    const grid = others.slice();
    grid.splice(tt ? 0 : PLAYER_SLOT, 0, player);
    setupGrid(grid);
    for (const k of karts) {
      k.isPlayer = k === player;
      // o kart do jogador fica no nível de detalhe cheio mesmo na câmera da largada
      k.model?.setHero?.(k.isPlayer);
    }
    world.player = player;
    items.setMode?.(tt ? 'timetrial' : 'race');
    items.reset(world.karts);
    effects.reset();
    env.setMood?.(0);
    moodT = -1;
    drivers = new Map(
      others.map((k, i) => [k, new AIDriver(k, track, {
        skill: THREE.MathUtils.clamp(cc.aiSkill + AI_LADDER[i % AI_LADDER.length], 0.2, 1),
        lane: i, // faixa sorteada a cada corrida (others já vem embaralhado)
      })]),
    );
    // o rival é o adversário mais forte da escada
    world.rival = others[0] || null;
    playerAI = new AIDriver(player, track, { skill: 0.9 });
    race.start(world.karts, { laps: opts.laps, player, track, cc });
    world.phase = 'countdown';
    // dicas contextuais nas duas primeiras corridas
    const played = store.get('played', 0);
    store.set('played', played + 1);
    hud.setRace({ player, karts: world.karts, totalLaps: opts.laps, track, tutorial: played < 2, touch: input.touchEnabled });
    // fantasma do recorde (contrarrelógio)
    // bilhete do ranking online: o servidor marca a hora da largada
    runTicket = Online.user ? Online.startRun(boardOf(opts)) : null;
    ghostRec = tt ? [] : null;
    ghostSampleT = 0;
    setGhost(tt ? store.get(ghostKey(opts), null) : null);
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

  // Recordes por classe (tempo total por número de voltas e melhor volta), no localStorage.
  function saveRecords(results) {
    const p = world.player;
    const me = results.find((r) => r.kart === p);
    if (!me || !p.finished || me.estimated || !game.opts) return null;
    const { cc, laps } = game.opts;
    const rec = store.get('records', {});
    const pre = game.opts.mode === 'timetrial' ? 'tt-' : '';
    const keyT = `${pre}${cc}-${laps}`;
    const keyL = `${pre}lap-${cc}`;
    const bestLap = p.lapTimes && p.lapTimes.length ? Math.min(...p.lapTimes) : 0;
    const info = { cc, laps, time: me.time, bestLap, newTotal: false, newLap: false, prevTotal: rec[keyT] || null, prevLap: rec[keyL] || null };
    if (!rec[keyT] || me.time < rec[keyT].time) {
      info.newTotal = true;
      rec[keyT] = { time: me.time, character: p.character.id };
    }
    if (bestLap > 0 && (!rec[keyL] || bestLap < rec[keyL].time)) {
      info.newLap = true;
      rec[keyL] = { time: bestLap, character: p.character.id };
    }
    store.set('records', rec);
    return info;
  }

  function showResults() {
    game.state = 'results';
    const results = race.buildResults();
    const opts = game.opts;
    const tt = opts.mode === 'timetrial';
    const p = world.player;
    const me = results.find((r) => r.kart === p);
    hud.show(false);
    input.showTouch(false);
    const prevGhostTime = ghostPrevTime; // setGhost(null) zera o tempo do fantasma
    setGhost(null);
    const rec = saveRecords(results);
    const info = { rec, cc: opts.cc, laps: opts.laps, mode: opts.mode, facts: hud.raceFacts.slice() };
    const valid = me && p.finished && !me.estimated;
    if (valid && !tt) {
      info.medal = awardMedal(p.character.id, opts.cc, me.place);
      if (opts.cc === '100cc' && me.place === 1 && !is150Unlocked()) {
        store.set('unlock150', true);
        info.unlocked150 = true;
      }
    }
    // rival: diferença de tempo na chegada (estimada se ele não terminou)
    const rv = world.rival && results.find((r) => r.kart === world.rival);
    if (rv && me && !tt) info.rival = { name: rv.kart.character.name, delta: me.time - rv.time };
    // desafio do dia
    if (opts.daily) {
      const ok = valid && me.place <= opts.daily.maxPlace;
      info.daily = { done: ok, goal: opts.daily.label };
      if (ok) markDaily(opts.daily.key);
    }
    // fantasma
    if (tt && valid) {
      const prev = prevGhostTime;
      if (prev) info.ghost = me.time - prev;
      if (!prev || me.time < prev) saveGhost(me.time);
    }
    // ranking deste aparelho
    if (valid) Object.assign(info, addRanking(recordKey(opts), me.time, p.character.id));
    menu.showResults(results, p, info);
    menu.renderOnlineResult(null);
    if (valid) sendOnline(opts, me, p);
    audio.playMusic('results');
    if (tt) rig.setMode('orbit', { target: p, radius: 7, height: 2.6, speed: 0.35 });
    else podium(results);
  }

  // Os três primeiros lado a lado depois da linha de chegada, com câmera de pódio e confete.
  function podium(results) {
    const top = results.slice(0, 3).map((r) => r.kart);
    const base = track.sample(22);
    const heading = Math.atan2(base.tangent.x, base.tangent.z);
    const spots = [[0, 0], [-2.4, -0.9], [2.4, -1.4]]; // [lateral, recuo]
    for (const k of world.karts) k.frozen = true;
    top.forEach((k, i) => {
      const [lat, back] = spots[i];
      const pos = base.pos.clone().addScaledVector(base.right, lat).addScaledVector(base.tangent, back);
      k.placeAt({ pos, heading, s: 22 + back });
      k.object3d.visible = true;
      k.model?.setHero?.(true); // câmera a ~12 m: sem trocar para o modelo simplificado
    });
    // os demais saem de cena para não atravessarem o pódio
    for (const k of world.karts) if (!top.includes(k)) k.object3d.visible = false;
    const up = new THREE.Vector3(0, 1, 0);
    // tela larga: o painel ocupa a direita, então o pódio vai para a esquerda da imagem
    // (a direita da tela, olhando para trás na pista, é o lado -right da pista)
    const dist = 12;
    const aspect = innerWidth / innerHeight;
    const shift = !isTouch && aspect > 1.3 ? 0.6 * Math.tan((45 / 2) * (Math.PI / 180)) * aspect * dist : 0;
    const center = base.pos.clone().addScaledVector(base.right, -shift);
    const lookAt = center.clone().addScaledVector(up, 1.0);
    const position = center.clone().addScaledVector(base.tangent, dist).addScaledVector(up, 2.8);
    // uma chamada só: a câmera entra de longe e se aproxima (efeitos/câmera)
    rig.setMode('podium', { position, lookAt });
    if (effects.podiumConfetti) effects.podiumConfetti(base.pos, { duration: 6 });
    else effects.confetti?.(top[0]);
  }

  // Envia o tempo ao ranking online e à sala da turma (se houver) e mostra a colocação.
  async function sendOnline(opts, me, p) {
    const board = boardOf(opts);
    const room = opts.room && opts.room.board === board ? opts.room : null;
    const ticket = runTicket;
    runTicket = null;
    // conta conectada só depois da largada (ex.: internet lenta): sem bilhete, não vale para o ranking
    const noTicket = !ticket && !!Online.user;
    if (!ticket && !room) {
      if (noTicket) menu.renderOnlineResult({ board, global: { ok: false, error: 'no_ticket' } });
      else if (Online.available) menu.renderOnlineResult({ loginHint: true });
      return;
    }
    const run = {
      board,
      timeMs: me.time * 1000,
      bestLapMs: (p.lapTimes && p.lapTimes.length ? Math.min(...p.lapTimes) : me.time / opts.laps) * 1000,
      character: p.character.id,
      place: me.place,
    };
    menu.renderOnlineResult({ pending: true });
    const res = { board, roomCode: room?.code, loginHint: !Online.user };
    if (noTicket) res.global = { ok: false, error: 'no_ticket' };
    try {
      if (ticket) {
        const runId = await ticket;
        res.global = runId ? await Online.submitRun({ runId, ...run }) : { ok: false, error: 'offline' };
        if (res.global?.ok && !res.global.rank_all) menu.me = await Online.getMe();
      }
      if (room) {
        res.room = await Online.roomSubmit(room.code, run, room.guestName);
        if (res.room?.ok) res.roomBoard = await Online.roomBoard(room.code, 8, room.guestName);
      }
    } catch {
      /* sem conexão: o resultado local já foi salvo */
    }
    if (game.state === 'results') menu.renderOnlineResult(res);
  }

  // ---------- recordes, medalhas, ranking e desafio ----------
  function recordKey(o) {
    return `${o.mode === 'timetrial' ? 'tt-' : ''}${o.cc}-${o.laps}`;
  }

  function awardMedal(charId, cc, place) {
    const type = place === 1 ? 'ouro' : place === 2 ? 'prata' : place === 3 ? 'bronze' : null;
    if (!type) return null;
    const all = store.get('medals', {});
    const mine = all[charId] || (all[charId] = {});
    const rank = { bronze: 1, prata: 2, ouro: 3 };
    if (mine[cc] && rank[mine[cc]] >= rank[type]) return null;
    mine[cc] = type;
    store.set('medals', all);
    return { type };
  }

  function addRanking(key, time, character) {
    const all = store.get('ranking', {});
    const list = all[key] || [];
    const nick = store.get('nick', '');
    const entry = { name: nick, time, character };
    list.push(entry);
    list.sort((a, b) => a.time - b.time);
    all[key] = list.slice(0, 5);
    store.set('ranking', all);
    return { rankKey: key, rankIndex: all[key].indexOf(entry) };
  }

  function markDaily(key) {
    const st = store.get('daily', {});
    if (st[key]) return;
    st[key] = true;
    // mantém só os últimos 30 dias
    const keys = Object.keys(st).sort();
    while (keys.length > 30) delete st[keys.shift()];
    store.set('daily', st);
    const streak = store.get('dailyStreak', { last: '', n: 0 });
    const y = new Date(Date.now() - 864e5);
    const yKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    streak.n = streak.last === yKey ? streak.n + 1 : 1;
    streak.last = key;
    store.set('dailyStreak', streak);
  }

  // ---------- fantasma do contrarrelógio ----------
  let ghostRec = null; // amostras da corrida atual [x, y, z, heading, ...]
  let ghostSampleT = 0;
  let ghost = null; // { data, model, time }
  let ghostPrevTime = 0;
  const ghostKey = (o) => `ghost-${o.cc}-${o.laps}`;
  function setGhost(g) {
    if (ghost?.model) {
      scene.remove(ghost.model.group);
      ghost.model.dispose?.();
    }
    ghost = null;
    ghostPrevTime = g?.time || 0;
    if (!g || !g.frames?.length) return;
    const model = createKartModel(g.character, { quality });
    // materiais próprios e translúcidos (os do kart são compartilhados)
    model.group.traverse((o) => {
      if (!o.material) return;
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.38;
      o.material.depthWrite = false;
      o.castShadow = false;
    });
    model.group.visible = false;
    scene.add(model.group);
    ghost = { data: g.frames, model, time: g.time, laps: g.lapTimes || [] };
  }
  function saveGhost(time) {
    if (!ghostRec?.length) return;
    const p = world.player;
    store.set(ghostKey(game.opts), { time, character: p.character.id, lapTimes: p.lapTimes || [], frames: ghostRec });
  }
  // grava o jogador a 10 Hz (chamado pelo passo fixo da simulação)
  function recordGhost(h) {
    const p = world.player;
    if (!ghostRec || !p || race.phase !== 'racing' || p.finished) return;
    ghostSampleT -= h;
    if (ghostSampleT <= 0) {
      ghostSampleT += GHOST_DT;
      const r = (v) => Math.round(v * 100) / 100;
      ghostRec.push(r(p.position.x), r(p.position.y), r(p.position.z), r(p.heading));
    }
  }
  function updateGhost(dt) {
    const p = world.player;
    if (!p || game.opts?.mode !== 'timetrial') return;
    const t = race.time;
    // reproduz o recorde
    if (!ghost) return;
    const d = ghost.data;
    const n = d.length / 4;
    const f = t / GHOST_DT;
    const i = Math.floor(f);
    const show = race.phase !== 'countdown' && i < n - 1;
    ghost.model.group.visible = show;
    if (!show) return;
    const a = i * 4, b = a + 4, u = f - i;
    const g = ghost.model.group;
    g.position.set(d[a] + (d[b] - d[a]) * u, d[a + 1] + (d[b + 1] - d[a + 1]) * u, d[a + 2] + (d[b + 2] - d[a + 2]) * u);
    let dh = d[b + 3] - d[a + 3];
    if (dh > Math.PI) dh -= Math.PI * 2;
    else if (dh < -Math.PI) dh += Math.PI * 2;
    g.rotation.set(0, d[a + 3] + dh * u, 0);
    const spd = Math.hypot(d[b] - d[a], d[b + 2] - d[a + 2]) / GHOST_DT;
    ghost.model.update(dt, { speed: spd });
  }
  // diferença para o fantasma a cada volta
  bus.on('race:lap', ({ kart, lap }) => {
    if (kart !== world.player || game.opts?.mode !== 'timetrial' || !ghost?.laps?.length) return;
    const n = lap - 1;
    if (ghost.laps.length < n) return;
    const gT = ghost.laps.slice(0, n).reduce((a, b) => a + b, 0);
    const dT = race.time - gT;
    const txt = `${dT < 0 ? '−' : '+'}${Math.abs(dT).toFixed(2).replace('.', ',')} s`;
    const title = lap >= world.totalLaps ? 'ÚLTIMA VOLTA!' : `Volta ${lap}`;
    // depois do passo atual: o HUD escreve 'ÚLTIMA VOLTA!' no mesmo passo e sobrescreveria
    setTimeout(() => hud.center(`${title}<small class="${dT < 0 ? 'ahead' : 'behind'}">👻 ${txt}</small>`, 'msg pop', 1800), 0);
  });

  // ---------- rival e hora dourada ----------
  bus.on('race:go', () => {
    if (game.state === 'race' && world.rival) {
      hud.toast(`<div class="item-ico">⚔️</div><div><small>Seu rival</small><b>${world.rival.character.name}</b><p>O adversário mais rápido desta corrida.</p></div>`, 3200);
    }
  });
  let moodT = -1; // -1 = parado; 0..1 animando para a hora dourada
  bus.on('race:finalLap', ({ kart }) => {
    if (kart === world.player && game.state === 'race') moodT = 0;
  });

  function setPaused(on, silent) {
    if (on && game.state !== 'race') return;
    // voltando da pausa com um item seguro atrás do kart: ele continua seguro até um novo
    // aperto (a pausa solta todas as teclas, e isso dispararia o item sozinho)
    if (!on && game.paused) holdLatch = !!world.player?.itemHeld;
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
    if (audio.ctx && !audio.ctx._hooked) {
      audio.ctx._hooked = true;
      // iOS deixa o contexto 'interrupted' (ligação, Siri, alarme) com a página visível:
      // volta a escutar o próximo gesto para retomar o som.
      audio.ctx.onstatechange = () => { if (audio.ctx.state !== 'running') armUnlock(); };
    }
    if (audio.ctx?.state === 'running') for (const ev of unlockEvents) removeEventListener(ev, unlock, true);
  };
  const armUnlock = () => {
    for (const ev of unlockEvents) addEventListener(ev, unlock, { capture: true, passive: true });
  };
  armUnlock();

  // Pausa automática ao trocar de aba ou quando a janela perde o foco (outro app/janela por cima).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'race' && !game.paused) setPaused(true);
    // iOS pode deixar o áudio 'interrupted': volta a tentar no próximo gesto
    if (!document.hidden && audio.ctx) setTimeout(() => { if (audio.ctx.state !== 'running') armUnlock(); }, 300);
  });
  addEventListener('blur', () => {
    if (game.state === 'race' && !game.paused && race.phase === 'racing') setPaused(true);
  });

  // Saiu da tela cheia no celular (gesto de voltar): pausa.
  document.addEventListener('fullscreenchange', () => {
    if (isTouch && !document.fullscreenElement && game.state === 'race' && !game.paused) setPaused(true);
  });

  // ---------- redimensionamento e orientação ----------
  const rotateHint = document.getElementById('rotate-hint');
  let portraitNow = false;
  let rotateDismissed = false; // "Jogar assim mesmo" (iPhone com bloqueio de rotação)
  // O aviso de girar o celular só aparece durante a corrida: os menus funcionam em pé.
  function updateRotateHint() {
    const show = portraitNow && game.state === 'race' && !rotateDismissed;
    rotateHint.classList.toggle('hidden', !show);
    // corrida começou com o celular em pé: não deixa a contagem correr por trás do aviso
    // (no próximo tique: menu.hideAll ainda vai esconder as telas depois deste callback)
    if (show && !game.paused) setTimeout(() => { if (portraitNow && !rotateDismissed && !game.paused) setPaused(true); }, 0);
  }
  rotateHint.querySelector('[data-action="rotate-dismiss"]')?.addEventListener('click', () => {
    rotateDismissed = true;
    updateRotateHint();
  });
  function onResize() {
    renderer.setSize(innerWidth, innerHeight);
    needsRender = true; // setSize limpa o canvas
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    portraitNow = isTouch && innerHeight > innerWidth && Math.min(screen.width, screen.height) < 600;
    updateRotateHint();
    if (portraitNow && !rotateDismissed && game.state === 'race' && !game.paused) setPaused(true);
  }
  addEventListener('resize', onResize);
  onResize();
  const prevOnScreen = menu.h.onScreen;
  menu.h.onScreen = (name) => {
    prevOnScreen?.(name);
    updateRotateHint();
    // pausa: foco em "Continuar", para Enter/A não cair em "Sair"
    if (name === 'pause') document.querySelector('#screen-pause [data-action="resume"]')?.focus();
  };

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
      // mesmo caminho do teclado: respeita o cadeado do 150cc
      if (edgeLB) menu.cycleOpt('cc', 1);
      if (edgeRB) menu.cycleOpt('laps', 1);
    }
    if (edgeB) {
      if (cur === 'select' || cur === 'howto' || cur === 'online' || cur === 'turma') menu.action('back');
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
        player.controls.holdItem = player.controls.itemBack = false;
        playerAI.update(h, world);
        pendingUse = false;
      } else if (ctrl) {
        const c = player.controls;
        c.throttle = ctrl.throttle;
        c.brake = ctrl.brake;
        c.steer = ctrl.steer;
        c.drift = ctrl.drift;
        c.lookBack = ctrl.lookBack;
        // segurar o item atrás (escudo) e o gesto de tiro para trás no toque
        if (holdLatch && (ctrl.holdItem || ctrl.useItem || !player.itemHeld)) holdLatch = false;
        c.holdItem = !!ctrl.holdItem || holdLatch;
        c.itemBack = !!ctrl.itemBack;
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
      recordGhost(h);
      world.phase = race.phase === 'countdown' ? 'countdown' : race.phase === 'finished' ? 'finished' : 'racing';
    }
  }

  bus.on('race:finish', ({ kart }) => {
    if (kart === world.player) resultsTimer = RESULTS_DELAY;
  });

  // ---------- tremor de câmera e vibração nos impactos do jogador ----------
  const isP = (k) => k && k === world.player && game.state === 'race';
  const buzz = (ms) => { if (isTouch) navigator.vibrate?.(ms); };
  bus.on('kart:wall', ({ kart, strength }) => {
    if (!isP(kart)) return;
    rig.shake(0.06 + 0.16 * strength, 0.25);
    if (strength > 0.4) {
      buzz(25);
      input.rumble?.(90, 0.3 + 0.4 * strength);
    }
  });
  bus.on('kart:bump', ({ a, b, strength }) => {
    if (!isP(a) && !isP(b)) return;
    rig.shake(0.05 + 0.1 * strength, 0.2);
  });
  bus.on('kart:hit', ({ kart, type }) => {
    if (!isP(kart)) return;
    const big = type === 'tumble' || type === 'shock';
    rig.shake(big ? 0.4 : 0.25, big ? 0.6 : 0.4);
    buzz(big ? [70, 40, 70] : 60);
    input.rumble?.(big ? 300 : 180, big ? 0.9 : 0.6);
  });
  bus.on('kart:boost', ({ kart }) => {
    if (isP(kart)) input.rumble?.(120, 0.35);
  });
  bus.on('kart:land', ({ kart, airTime }) => {
    if (!isP(kart) || !(airTime > 0.3)) return;
    rig.shake(0.1, 0.2);
  });
  bus.on('item:explode', ({ pos }) => {
    const p = world.player;
    if (!p || game.state !== 'race' || !pos) return;
    const d = Math.hypot(pos.x - p.position.x, pos.z - p.position.z);
    if (d < 14) rig.shake(0.2 * (1 - d / 14) + 0.05, 0.3);
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
  let frameNo = 0;
  let noLowerT = 0; // noLower expira: a adaptação volta a tentar depois de um tempo
  let shadowsCut = false;
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
      if (game.state === 'race') updateGhost(dt);
      // hora dourada na última volta (~4 s de transição)
      if (moodT >= 0 && moodT < 1) {
        moodT = Math.min(1, moodT + dt / 4);
        env.setMood?.(moodT * moodT * (3 - 2 * moodT));
      }
    }

    rig.update(dt, world, { lookBack: !!(world.player && !game.autopilot && ctrl.lookBack && game.state === 'race') });
    env.update(dt, t, camera);
    ads.update(dt, t, camera);
    track.update(dt, t);
    if (game.state === 'race') hud.update(game.paused ? 0 : dt, world, race);
    if (!game.paused) audio.update(dt, world);
    // Pausa e telas que cobrem o jogo: não redesenha a cena 3D (economiza bateria).
    const idle = game.paused || menu.current === 'select' || menu.current === 'howto';
    // celular no título/resultado: 30 quadros por segundo bastam (menos bateria e calor)
    const halfRate = isTouch && (game.state === 'title' || game.state === 'results') && (++frameNo & 1);
    if ((!idle && !halfRate) || needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
    }

    // Resolução adaptativa: reduz se o aparelho não aguenta e volta a subir quando melhora.
    dtAvg += (dt - dtAvg) * 0.05;
    adaptResolution(dt);
  }

  const PR_MIN = quality.id === 'baixa' ? 0.6 : 0.75;
  function setPR(r) {
    pixelRatio = r;
    renderer.setPixelRatio(r);
  }
  function adaptResolution(dt) {
    if (game.state !== 'race' || game.paused) {
      slowTime = fastTime = 0;
      return;
    }
    if (noLower && (noLowerT -= dt) <= 0) noLower = false;
    if (checkTime > 0) {
      // Reduziu e não melhorou pelo menos 8%: volta e para de reduzir por 20 s.
      checkTime -= dt;
      if (checkTime <= 0 && dtAvg > dtBefore * 0.92) {
        setPR(prBefore);
        noLower = true;
        noLowerT = 20;
      }
      return;
    }
    // abaixo de ~45 quadros por segundo já trepida: reage antes de ficar injogável
    if (dtAvg > 1 / 45) {
      fastTime = 0;
      slowTime += dt;
      if (slowTime > 2.5) {
        slowTime = 0;
        if (!noLower && pixelRatio > PR_MIN) {
          dtBefore = dtAvg;
          prBefore = pixelRatio;
          setPR(Math.max(PR_MIN, pixelRatio - 0.15));
          checkTime = 3;
        } else if (renderer.shadowMap.enabled && !shadowsCut && dtAvg > 1 / 35) {
          // resolução no mínimo e ainda lento: desliga as sombras sem recarregar
          shadowsCut = true;
          renderer.shadowMap.enabled = false;
          scene.traverse((o) => {
            const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
            for (const m of ms) m.needsUpdate = true;
          });
        } else if (quality.id === 'alta' && !slowWarned && dtAvg > 1 / 32) {
          // Ainda lento em 'alta': sugere a qualidade baixa (sem trocar sozinho).
          slowWarned = true;
          store.set('slowHint', true);
          hud.toast?.('<div class="item-ico">🐢</div><div><b>Jogo lento?</b><p>No menu inicial dá para usar a qualidade baixa.</p></div>', 5000);
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
    hud,
    env,
    effects,
  };

  menu.setLoading(1, 'Pronto!');
  await nextFrame();
  enterTitle();
  // Link do professor: ?cientista=curie&motor=50cc&voltas=1&modo=contrarrelogio abre direto a escolha.
  try {
    const q = new URLSearchParams(location.search);
    const ch = q.get('cientista');
    const mo = q.get('motor');
    const vo = Number(q.get('voltas'));
    const md = q.get('modo');
    let any = false;
    if (ch && CHARACTERS.some((c) => c.id === ch)) { menu.opts.character = ch; any = true; }
    if (mo && CLASSES[mo]) { menu.opts.cc = mo === '150cc' && !is150Unlocked() ? '100cc' : mo; any = true; }
    if (RACE.lapOptions.includes(vo)) { menu.opts.laps = vo; any = true; }
    if (md) {
      const plain = md.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      menu.opts.mode = /relogio|timetrial/i.test(plain) ? 'timetrial' : 'race';
      any = true;
    }
    if (any) menu.show('select');
  } catch {
    /* parâmetros inválidos: segue no título */
  }
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
