// Kart: física arcade (aceleração, curvas, drift com mini-turbo, pulos, rampas,
// muros e colisões entre karts) e animação do corpo (inclinação, giro, escala).
// Todos os ajustes finos ficam no objeto TUNING abaixo.
import * as THREE from './three.js';
import { statFactor } from './config.js';

// ---------- Ajustes ----------
export const TUNING = {
  // velocidade (m/s) em 100cc com atributo 3; ±por ponto de atributo
  topSpeed: 24,
  topSpeedPerStat: 0.08, // velocidade 5 × 1 = só 1,3%: o atributo não decide a corrida sozinho
  // aceleração: a = accel0 * (1 - (v/vmax)²) + accelFloor → ~3 s até a máxima (atributo 3)
  accel0: 16.5,
  accelPerFactor: 0.45, // ±45% com atributo 5/1
  weightAccelPenalty: 0.04, // peso alto acelera um pouco mais devagar (0,07 tornava o peso só desvantagem)
  accelFloor: 0.7,
  accelFloorPerFactor: 0.95, // perto da máxima, aceleração 5 recupera o embalo bem mais rápido (0,04–1,37 m/s²)
  recoverPerFactor: 0.15, // aceleração 5/1: rodada e capotagem ~15% mais curtas/longas
  brakeDecel: 34,
  coastDecel: 4.5,
  reverseAccel: 11,
  reverseMax: 6,
  reverseDelay: 0.12, // s parado segurando freio antes de dar ré
  // curvas
  // 1,35 rad/s: as curvas fechadas (raio ~21 m) pedem drift, linha ou tirar o pé no 150cc
  maxYaw: 1.35, // rad/s com esterço total (handling 3)
  maxYawPerFactor: 0.2,
  turnFullSpeed: 5.5, // abaixo disso a curva é proporcional à velocidade
  pivotSpeed: 3.5, // giro mínimo (como se andasse a 3,5 m/s) ao acelerar parado
  // perda de giro em alta: 0 até 20 m/s, 20% a 32 m/s (no 150cc o grampo pede drift, linha ou tirar o pé)
  turnHighSpeedLoss: 0.2,
  turnLossFrom: 20,
  turnLossRange: 12,
  yawResponse: 15, // 1/s: rapidez com que a guinada alcança o alvo
  steerRate: 8, // 1/s: suavização do esterço digital
  airSteer: 0.45,
  hopSteer: 0.8, // no pulo do drift (botão segurado) dá para apontar a curva no ar
  grip: 9, // 1/s: amortecimento do deslize lateral
  driftGrip: 4,
  driftSlip: 1.6, // m/s de deslize para fora durante o drift
  gravity: 28,
  crestGap: 0.04, // m que o chão precisa cair num passo para o kart decolar
  hopVy: 3.2, // ~0,23 s no ar: o drift entra rápido
  // drift
  driftMinSpeed: 9,
  driftSteerMin: 0.3,
  driftArmTime: 0.22, // tolerância para escolher a direção logo após pousar
  // giro no drift = base + mod * (esterço para dentro); para dentro chega a 1,4× o giro normal,
  // então driftar é o jeito mais fechado de fazer curva
  driftYawBase: 0.8,
  driftYawMod: 0.6,
  driftYawPerHandling: 0.12,
  driftSpeedMult: 0.985,
  driftSpeedPerHandling: 0.005, // controle 5 perde só 1% no drift; controle 1, 2%
  driftVisualYaw: 0.47, // ~27° de guinada visual para dentro da curva
  driftCharge: [0.8, 1.7, 2.7], // carga para azul, laranja, roxo
  driftChargeIn: 1.3,
  driftChargeNeutral: 1.0,
  driftChargeOut: 0.6,
  driftBoost: [0, 0.7, 1.2, 1.8],
  boostPerHandling: 0.08, // controle: +8% de turbo do drift e da manobra por ponto acima de 3
  // turbo
  boostMult: 0.35,
  boostAccel: 40,
  boostKick: 3,
  overspeedDecel: 9,
  // fora do asfalto, em duas faixas: a zebra (edgeBand m além da meia-largura) só freia um pouco;
  // o resto do acostamento (grama/areia) freia de verdade
  edgeBand: 1.5,
  edgeMult: 0.85,
  edgeDecel: 12,
  offroadMult: 0.6,
  offroadDecel: 30,
  offroadWeight: 0.06, // peso 5/1: perde 6% a mais/menos na grama (e metade disso na zebra)
  starMult: 1.15,
  shrinkMult: 0.75,
  shrinkScale: 0.55,
  padBoost: 1.2,
  padCooldown: 1.0,
  rampCooldown: 1.2,
  trickBoost: 0.9,
  trickWindow: 0.6,
  trickBuffer: 0.15, // apertar drift um pouco antes da rampa também vale
  trickAnim: 0.5,
  trickMinAir: 0.3, // manobra só dá turbo se o kart ficou pelo menos isso no ar
  crestTrickVy: 3, // crista/lombada: decolando com vy acima disso também vale manobra
  // batidas
  spinTime: 1.0,
  shockTime: 0.8,
  tumbleTime: 1.6,
  tumbleVy: 8.5,
  tumbleFlip: 0.55, // s da cambalhota (menor que o tempo no ar)
  hitGrace: 1.0, // s de proteção depois que o kart se recupera de uma batida
  // colisões
  kartRadius: 1.1, // raio do círculo kart×kart (×escala)
  massPerFactor: 0.35, // peso 5 empurra 35% mais que o 3
  wallRadius: 0.85,
  wallBounce: 0.3,
  wallScrub: 0.5, // perda de velocidade × seno do ângulo de impacto
  wallWeight: 0.25, // peso 5/1: raspa 25% menos/mais no muro
  wallGrazeSin: 0.35, // raspão (ângulo baixo, ~20°) ...
  wallGrazeKeep: 0.65, // ... nunca tira mais que 35% da velocidade
  wallDeflect: 0.55, // quanto o rumo se alinha ao muro num raspão
  bumpRestitution: 0.5,
  bumpMinSep: 2.6, // m/s mínimos de separação numa batida
  maxSubstep: 1 / 60,
  // suspensão visual
  suspK: 190,
  suspC: 13,
};

const TWO_PI = Math.PI * 2;
const PIVOT = 0.55; // altura do pivô do corpo (giros e capotagens)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function wrapAngle(a) {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}
function wrapSigned(d, L) {
  d %= L;
  if (d > L / 2) d -= L;
  else if (d < -L / 2) d += L;
  return d;
}

export class Kart {
  constructor({ character, isPlayer = false, model = null, bus = null, index = 0 } = {}) {
    this.character = character;
    this.isPlayer = isPlayer;
    this.index = index;
    this.bus = bus;
    this.model = model;

    // hierarquia: raiz (posição + rumo) → visual (inclinação do chão, escala) → corpo (giros) → modelo
    this.object3d = new THREE.Group();
    this.object3d.name = `kart-${character?.id ?? index}`;
    this.visual = new THREE.Group();
    this.body = new THREE.Group();
    this.body.rotation.order = 'YXZ';
    this.body.position.y = PIVOT;
    this._pivotFix = new THREE.Group();
    this._pivotFix.position.y = -PIVOT;
    this.object3d.add(this.visual);
    this.visual.add(this.body);
    this.body.add(this._pivotFix);
    if (model?.group) this._pivotFix.add(model.group);

    // estado físico
    this.position = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.velocity = new THREE.Vector3();
    this.vy = 0;
    this.slip = 0; // velocidade lateral (m/s, + = direita)
    this.yawVel = 0; // rad/s, + = virando à direita
    this.steer = 0; // esterço suavizado
    this.s = 0;
    this.lateral = 0;
    this.distance = 0; // avanço contínuo em s desde a linha (negativo no grid)
    this.onGround = true;
    this.offroad = false;
    this.offroadLevel = 0; // 0 = asfalto, 1 = zebra (borda), 2 = acostamento (grama/areia)
    this.airTime = 0;
    this.groundY = 0;
    this.normal = new THREE.Vector3(0, 1, 0);
    this.halfWidth = 9;
    this.wallDist = 15;

    this.controls = { throttle: 0, brake: 0, steer: 0, drift: false, useItem: false, lookBack: false };
    this.drifting = false;
    this.driftDir = 0;
    this.driftLevel = 0;
    this.driftCharge = 0;
    this.driftFrozen = false; // drift na grama: a carga do mini-turbo fica parada
    this.boostTime = 0;
    this.boostSource = null;
    this.starTime = 0;
    this.shrinkTime = 0;
    this.spinTime = 0;
    this.tumbleTime = 0;
    this.hitType = null;
    this.trickWindow = 0;
    this.frozen = false;
    this.speedFactor = 1;

    // corrida online (netrace.js): kart de outro aparelho (ou da IA do anfitrião) não roda
    // física aqui; a pose vem da rede (netPose). Batida nele vira mensagem para o dono (netHit).
    this.remote = false;
    this.netId = null; // id na corrida online (id do jogador ou 'ia:N')
    this.netName = null; // nome do jogador humano (online)
    this.netHit = null; // (type, by, item) => bool, só em karts remotos

    // controlados por items.js e race.js
    this.item = null;
    this.itemCount = 0;
    this.roulette = null;
    this.lap = 1;
    this.progress = 0;
    this.place = index + 1;
    this.finished = false;
    this.finishTime = 0;

    // atributos
    const st = character?.stats || { speed: 3, accel: 3, handling: 3, weight: 3 };
    const T = TUNING;
    this._topBase = T.topSpeed + T.topSpeedPerStat * (st.speed - 3);
    this._accelFloor = T.accelFloor * (1 + T.accelFloorPerFactor * statFactor(st.accel));
    this._accel = T.accel0 * (1 + T.accelPerFactor * statFactor(st.accel)) * (1 - T.weightAccelPenalty * statFactor(st.weight));
    this._maxYaw = T.maxYaw * (1 + T.maxYawPerFactor * statFactor(st.handling));
    this.driftYawFactor = 1 + T.driftYawPerHandling * statFactor(st.handling);
    this._handF = statFactor(st.handling); // controle: menos perda no acostamento e drift carrega mais rápido
    const wF = statFactor(st.weight);
    this.mass = 1 + T.massPerFactor * wF;
    // aceleração: se recupera mais rápido de rodadas e capotagens
    this._recover = 1 - T.recoverPerFactor * statFactor(st.accel);
    // controle: turbo do drift e da manobra mais longo (+8% por ponto)
    this._boostMul = 1 + T.boostPerHandling * (st.handling - 3);
    // peso: perde menos no muro, mas afunda mais na grama/areia
    this._wallScrub = T.wallScrub * (1 - T.wallWeight * wF);
    this._offMult = T.offroadMult + 0.1 * this._handF - T.offroadWeight * wF;
    this._edgeMult = T.edgeMult + 0.04 * this._handF - 0.5 * T.offroadWeight * wF;

    this._ccMult = 1;
    this._boostStrength = 1;
    this._mstate = { speed: 0, steer: 0, drifting: false, driftDir: 0, driftLevel: 0, onGround: true, boosting: false, stunned: false, time: 0, rev: 0 };
    this._track = null;
    this._distInit = false;
    this._padCd = null;
    this._rampCd = null;
    this._resetInternals();
  }

  _resetInternals() {
    this._prevDrift = !!this.controls.drift;
    this._pressAgo = 99;
    this._driftArm = 0;
    this._hopping = false;
    this._airKind = null;
    this._trickPending = false;
    this._trickT = -1;
    this._trickType = 0;
    this._trickDir = 1;
    this._revT = 0;
    this._hitCd = 0;
    this._wallCd = 0;
    this._bumpCd = 0;
    this._stunSpeed = 0;
    this._spinTotal = 1;
    this._spinTurns = 2;
    this._spinDir = 1;
    this._tumbleTotal = 1;
    this._flat = 0;
    this._prevGy = this.position ? this.position.y : 0;
    this._rx = 1;
    this._rz = 0;
    this._tx = 0;
    this._ty = 0;
    this._tz = 1;
    // visual
    this._time = 0;
    this._scale = 1;
    this._suspY = 0;
    this._suspVel = 0;
    this._visYaw = 0;
    this._visRoll = 0;
    this._visPitch = 0;
    this._lastSpeed = 0;
    this._rev = 0;
    if (this._padCd) this._padCd.fill(0);
    if (this._rampCd) this._rampCd.fill(0);
  }

  // ---------- Contrato ----------
  get maxSpeed() {
    const T = TUNING;
    let v = this._topBase * this._ccMult * this.speedFactor;
    if (this.starTime > 0) v *= T.starMult;
    if (this.shrinkTime > 0) v *= T.shrinkMult;
    if (this.boostTime > 0) v *= 1 + T.boostMult * this._boostStrength;
    else if (this.offroad && this.starTime <= 0) v *= this.offroadLevel >= 2 ? this._offMult : this._edgeMult;
    if (this.drifting) v *= T.driftSpeedMult + T.driftSpeedPerHandling * this._handF;
    return v;
  }

  // Velocidade máxima normal (sem turbo nem acostamento), útil para câmera/HUD.
  get baseMaxSpeed() {
    return this._topBase * this._ccMult * this.speedFactor;
  }

  get invincible() {
    return this.starTime > 0;
  }

  // proteção logo após uma batida (projéteis e maçãs passam direto)
  get recovering() {
    return this._hitCd > 0;
  }

  get stunned() {
    return this.spinTime > 0 || this.tumbleTime > 0;
  }

  // Giro máximo (rad/s) com esterço total a uma dada velocidade (usado pela IA).
  turnRate(v) {
    const T = TUNING;
    const a = Math.abs(v);
    const low = Math.min(1, a / T.turnFullSpeed);
    const high = 1 - T.turnHighSpeedLoss * clamp((a - T.turnLossFrom) / T.turnLossRange, 0, 1);
    return this._maxYaw * low * high;
  }

  placeAt(slot) {
    this.position.copy(slot.pos);
    this.heading = slot.heading;
    const L = this._track?.length;
    this.s = L ? ((slot.s % L) + L) % L : slot.s;
    this.distance = L ? wrapSigned(this.s, L) : 0;
    this._distInit = !!L;
    this.lateral = 0;
    this.speed = 0;
    this.slip = 0;
    this.vy = 0;
    this.yawVel = 0;
    this.steer = 0;
    this.velocity.set(0, 0, 0);
    this.onGround = true;
    this.offroad = false;
    this.offroadLevel = 0;
    this.airTime = 0;
    this.groundY = slot.pos.y;
    this.drifting = false;
    this.driftDir = 0;
    this.driftLevel = 0;
    this.driftCharge = 0;
    this.driftFrozen = false;
    this.boostTime = 0;
    this.boostSource = null;
    this.starTime = 0;
    this.shrinkTime = 0;
    this.spinTime = 0;
    this.tumbleTime = 0;
    this.hitType = null;
    this.trickWindow = 0;
    this.speedFactor = 1;
    const c = this.controls;
    c.throttle = 0;
    c.brake = 0;
    c.steer = 0;
    c.useItem = false;
    this._resetInternals();
    if (this._track) {
      const p = this._track.project(this.position, this.s);
      this.s = p.s;
      this.lateral = p.lateral;
      this.groundY = p.groundY;
      this.position.y = p.groundY;
    }
    this._prevGy = this.position.y;
    this.object3d.position.copy(this.position);
    this.object3d.rotation.y = this.heading;
    this.visual.rotation.set(0, 0, 0);
    this.visual.scale.setScalar(1);
    this._pivotFix.scale.setScalar(1);
    this.body.rotation.set(0, 0, 0);
    this.body.position.y = PIVOT;
    this.body.visible = true;
  }

  update(dt, world) {
    const n = clamp(Math.ceil(dt / TUNING.maxSubstep - 1e-6), 1, 6);
    const h = dt / n;
    for (let i = 0; i < n; i++) this._physics(h, world);
    this._updateVisual(dt, world);
  }

  applyBoost(duration, strength = 1, source = 'item') {
    // kart remoto: o turbo é do dono (chega pela rede)
    if (this.stunned || this.remote) return false;
    this._boostStrength = this.boostTime > 0 ? Math.max(this._boostStrength, strength) : strength;
    this.boostTime = Math.max(this.boostTime, duration);
    this.boostSource = source;
    if (!this.frozen && this.speed >= 0) {
      const max = this.maxSpeed;
      if (this.speed < max) this.speed = Math.min(max, this.speed + TUNING.boostKick);
    }
    this.bus?.emit('kart:boost', { kart: this, source, duration });
    return true;
  }

  // item: id do item que causou a batida ('maca', 'alfa', 'eletron', 'buraco', 'tesla', 'faraday')
  // ou null (o HUD usa para mostrar quem acertou quem).
  hit(type = 'spin', by = null, item = null) {
    // corrida online: só o dono aplica a batida no próprio kart; aqui ela vira mensagem
    if (this.remote) return this.netHit ? !!this.netHit(type, by, item) : false;
    if (this.invincible || this._hitCd > 0 || this.frozen) return false;
    const T = TUNING;
    if (this.drifting) this._endDrift(false);
    this._driftArm = 0;
    this._hopping = false;
    this._trickPending = false;
    this.trickWindow = 0;
    this.boostTime = 0;
    this.hitType = type;
    // atributo aceleração encurta (ou alonga) o tempo atordoado
    const stun = (type === 'tumble' ? T.tumbleTime : type === 'shock' ? T.shockTime : T.spinTime) * this._recover;
    // só pode apanhar de novo depois de se recuperar + um tempinho de proteção
    this._hitCd = stun + T.hitGrace;
    const sp = Math.max(0, this.speed);
    this._spinDir = Math.random() < 0.5 ? -1 : 1;
    if (type === 'tumble') {
      this.spinTime = 0;
      this.tumbleTime = this._tumbleTotal = stun;
      this.vy = Math.max(this.vy, T.tumbleVy);
      if (this.onGround) this.airTime = 0;
      this.onGround = false;
      this._airKind = 'tumble';
      this._stunSpeed = sp * 0.2;
    } else if (type === 'shock') {
      this.tumbleTime = 0;
      this.spinTime = this._spinTotal = stun;
      this._spinTurns = 1;
      this._stunSpeed = sp * 0.4;
    } else {
      this.tumbleTime = 0;
      this.spinTime = this._spinTotal = stun;
      this._spinTurns = 2;
      this._stunSpeed = sp * 0.25;
    }
    this._suspVel -= 0.8;
    this.bus?.emit('kart:hit', { kart: this, type, by, item: item ?? null });
    return true;
  }

  shrink(duration) {
    // remoto: a Bobina de Tesla chega ao dono por mensagem própria ('tesla')
    if (this.invincible || this.remote) return false;
    this.shrinkTime = Math.max(this.shrinkTime, duration);
    return true;
  }

  // ---------- Corrida online: kart remoto (sem física aqui) ----------
  // Pose interpolada pela rede (netrace.js): posição, rumo e velocidade (rodas e efeitos).
  // A projeção na pista dá s/lateral (IA e itens miram por eles) e a inclinação do chão.
  netPose(p, dt, track) {
    const T = TUNING;
    this._track = track;
    const oldH = this.heading;
    // salto grande (estado atrasado, aba escondida): a projeção parte do s que veio da rede
    const jump = Math.abs(p.x - this.position.x) + Math.abs(p.z - this.position.z) > 20;
    if (jump && typeof p.s === 'number') this.s = p.s;
    this.position.set(p.x, p.y, p.z);
    this.heading = p.h;
    this.speed = p.v;
    this.steer = p.st || 0;
    this.slip = 0;
    // guinada pela variação do rumo (inclinação do corpo nas curvas)
    if (dt > 0) this.yawVel = damp(this.yawVel, clamp(-wrapAngle(p.h - oldH) / dt, -4, 4), 10, dt);
    const sh = Math.sin(p.h);
    const ch = Math.cos(p.h);
    this.velocity.set(sh * p.v, 0, ch * p.v);
    const pr = track.project(this.position, this.s);
    this.s = pr.s;
    this.lateral = pr.lateral;
    this.groundY = pr.groundY;
    if (pr.normal) this.normal.copy(pr.normal);
    if (pr.halfWidth) this.halfWidth = pr.halfWidth;
    if (pr.wallDist) this.wallDist = pr.wallDist;
    this.onGround = p.g !== false;
    // no chão: a altura vem da pista daqui (a interpolação entre dois estados cortaria lombadas)
    if (this.onGround) this.position.y = pr.groundY;
    this.offroad = !!pr.offroad && this.onGround;
    this.offroadLevel = !this.offroad ? 0 : Math.abs(this.lateral) - this.halfWidth <= T.edgeBand ? 1 : 2;
    const smp = track.sample(this.s);
    this._rx = smp.right.x;
    this._rz = smp.right.z;
    this._tx = smp.tangent.x;
    this._ty = smp.tangent.y;
    this._tz = smp.tangent.z;
    this._prevGy = this.groundY;
    // temporizadores correm aqui entre um estado e outro da rede
    this.boostTime = Math.max(0, this.boostTime - dt);
    this.starTime = Math.max(0, this.starTime - dt);
    this.shrinkTime = Math.max(0, this.shrinkTime - dt);
    this.spinTime = Math.max(0, this.spinTime - dt);
    this.tumbleTime = Math.max(0, this.tumbleTime - dt);
    this._hitCd -= dt;
  }

  // Estado mais recente de um kart remoto (valores que não se interpolam).
  netState(s) {
    const was = this.drifting;
    this.drifting = !!s.dr;
    this.driftDir = this.drifting ? s.dd || 0 : 0;
    this.driftLevel = this.drifting ? s.dl || 0 : 0;
    if (was !== this.drifting) this.driftCharge = 0;
    this.boostTime = s.bo || 0;
    this.boostSource = s.bo ? this.boostSource || 'item' : null;
    this.starTime = s.sa || 0;
    this.shrinkTime = s.sk || 0;
    this._hitCd = Math.max(this._hitCd, s.hc || 0);
    // giro/capotagem: a animação começa quando o dono avisa e continua aqui
    if (s.tb > 0) this.netStun('tumble', s.tb);
    else if (s.sp > 0) this.netStun(s.ht === 'shock' ? 'shock' : 'spin', s.sp);
    this.item = s.it || null;
    this.itemCount = s.ic || 0;
  }

  // Animação de batida num kart remoto (prevista por quem acertou, ou vinda do estado do dono).
  netStun(type, t = 0) {
    const T = TUNING;
    if (type === 'tumble') {
      if (this.tumbleTime > 0) return;
      this.spinTime = 0;
      this.tumbleTime = this._tumbleTotal = t || T.tumbleTime;
    } else {
      if (this.spinTime > 0 || this.tumbleTime > 0) return;
      this.spinTime = this._spinTotal = t || (type === 'shock' ? T.shockTime : T.spinTime);
      this._spinTurns = type === 'shock' ? 1 : 2;
    }
    this._spinDir = Math.random() < 0.5 ? -1 : 1;
    this.hitType = type;
    this._hitCd = Math.max(this._hitCd, (t || T.spinTime) + T.hitGrace);
    this._suspVel -= 0.8;
  }

  // ---------- Física (um subpasso) ----------
  _physics(dt, world) {
    const T = TUNING;
    const track = world.track;
    if (this._track !== track) {
      this._track = track;
      this._padCd = null;
      this._rampCd = null;
    }
    this._ccMult = world.cc?.speedMult ?? 1;
    const c = this.controls;

    // temporizadores
    if (!this.frozen) this.boostTime = Math.max(0, this.boostTime - dt);
    this.starTime = Math.max(0, this.starTime - dt);
    if (this.starTime > 0) this.shrinkTime = 0;
    this.shrinkTime = Math.max(0, this.shrinkTime - dt);
    this.spinTime = Math.max(0, this.spinTime - dt);
    this.tumbleTime = Math.max(0, this.tumbleTime - dt);
    this._hitCd -= dt;
    this._wallCd -= dt;
    this._bumpCd -= dt;
    this._driftArm -= dt;
    this._pressAgo += dt;
    if (this.trickWindow > 0) this.trickWindow = Math.max(0, this.trickWindow - dt);

    const stunned = this.stunned;
    const driftBtn = !!c.drift;
    const pressed = driftBtn && !this._prevDrift;
    this._prevDrift = driftBtn;
    if (pressed) this._pressAgo = 0;
    if (!driftBtn) this._driftArm = 0;

    // esterço suavizado (teclado vira de forma progressiva)
    const steerIn = stunned || this.frozen ? 0 : clamp(+c.steer || 0, -1, 1);
    const flip = steerIn * this.steer < 0 ? 1.8 : 1;
    const ds = T.steerRate * flip * dt;
    this.steer += clamp(steerIn - this.steer, -ds, ds);

    if (this.frozen) {
      // parado na largada, mas o motor ronca
      this.speed = 0;
      this.slip = 0;
      this.yawVel = 0;
      this.velocity.set(0, 0, 0);
      this._rev = damp(this._rev, clamp(+c.throttle || 0, 0, 1), 6, dt);
      return;
    }
    this._rev = damp(this._rev, 0, 3, dt);

    // pulo / manobra
    if (pressed && !stunned) {
      if (this.onGround) {
        this.vy = Math.max(0, this.vy) + T.hopVy;
        this.onGround = false;
        this.airTime = 0;
        this._airKind = 'hop';
        this._hopping = true;
        this._suspVel += 1.2;
        this.bus?.emit('kart:hop', { kart: this });
      } else if (this.trickWindow > 0 && !this._trickPending) {
        this._doTrick();
      }
    }

    // ---------- velocidade longitudinal ----------
    const max = this.maxSpeed;
    const thr = stunned ? 0 : clamp(+c.throttle || 0, 0, 1);
    const brk = stunned ? 0 : clamp(+c.brake || 0, 0, 1);
    let v = this.speed;
    if (stunned) {
      v = damp(v, this._stunSpeed, 6, dt);
    } else if (this.onGround) {
      if (brk > 0.05 && brk >= thr) {
        if (v > 0.3) {
          v = Math.max(0, v - T.brakeDecel * brk * dt);
          this._revT = 0;
        } else {
          this._revT += dt;
          if (this._revT > T.reverseDelay) v = Math.max(-T.reverseMax, v - T.reverseAccel * brk * dt);
          else v = damp(v, 0, 10, dt);
        }
      } else if (thr > 0.05) {
        this._revT = 0;
        if (v < 0) v = Math.min(0.5, v + T.brakeDecel * thr * dt);
        else if (v < max) {
          const r = v / max;
          let a = this._accel * (1 - r * r) + this._accelFloor;
          if (this.boostTime > 0) a = Math.max(a, T.boostAccel);
          v = Math.min(max, v + a * thr * dt);
        }
      } else {
        this._revT = 0;
        const d = (T.coastDecel + Math.abs(v) * 0.06) * dt;
        v = Math.abs(v) <= d ? 0 : v - Math.sign(v) * d;
        // turbo empurra mesmo sem acelerar
        if (this.boostTime > 0 && v >= 0 && v < max) v = Math.min(max, v + T.boostAccel * 0.6 * dt);
      }
      if (v > max) {
        const dec = !this.offroad ? T.overspeedDecel : this.offroadLevel >= 2 ? T.offroadDecel : T.edgeDecel;
        v = Math.max(max, v - dec * dt);
      }
    } else if (this.boostTime > 0 && v >= 0 && v < max) {
      v = Math.min(max, v + T.boostAccel * dt);
    }
    this.speed = v;

    // ---------- guinada ----------
    const va = Math.abs(v);
    let yawT = 0;
    if (!stunned) {
      if (this.drifting) {
        const into = this.steer * this.driftDir;
        yawT = this.driftDir * this.turnRate(va) * this.driftYawFactor * (T.driftYawBase + T.driftYawMod * into);
      } else {
        // quase parado (ex.: de frente para o muro) ainda gira com acelerador/freio
        let vt = va;
        let sign = v < 0 ? -1 : 1;
        if (this.onGround && va < T.pivotSpeed) {
          const push = Math.max(thr, brk);
          if (push > 0.05) {
            vt = Math.max(va, push * T.pivotSpeed);
            if (va < 0.5) sign = brk > thr ? -1 : 1;
          }
        }
        yawT = this.steer * this.turnRate(vt) * sign;
      }
      // no pulo do drift (botão segurado) o kart já aponta para a curva antes de pousar
      if (!this.onGround) yawT *= this.drifting ? 0.85 : this._hopping && driftBtn ? T.hopSteer : T.airSteer;
    }
    this.yawVel = damp(this.yawVel, yawT, T.yawResponse, dt);
    this.heading = wrapAngle(this.heading - this.yawVel * dt);

    // deslize lateral (drift escorrega para fora)
    const slipT = this.drifting ? -this.driftDir * T.driftSlip * Math.min(1, va / 15) : 0;
    const grip = this.drifting ? T.driftGrip : this.onGround ? T.grip : T.grip * 0.3;
    this.slip = damp(this.slip, slipT, grip, dt);

    // ---------- integra no plano ----------
    let sh = Math.sin(this.heading);
    let ch = Math.cos(this.heading);
    this.position.x += (sh * v - ch * this.slip) * dt;
    this.position.z += (ch * v + sh * this.slip) * dt;

    // ---------- projeção na pista ----------
    const L = track.length;
    const oldS = this.s;
    if (!this._distInit) {
      this.distance = wrapSigned(oldS, L);
      this._distInit = true;
    }
    const p = track.project(this.position, this.s);
    this.s = p.s;
    this.lateral = p.lateral;
    const gy = p.groundY;
    this.groundY = gy;
    if (p.normal) this.normal.copy(p.normal);
    if (p.halfWidth) this.halfWidth = p.halfWidth;
    if (p.wallDist) this.wallDist = p.wallDist;
    const dS = wrapSigned(this.s - oldS, L);
    if (Math.abs(dS) < 30) this.distance += dS; // ignora saltos de projeção
    const smp = track.sample(this.s);
    this._rx = smp.right.x;
    this._rz = smp.right.z;
    this._tx = smp.tangent.x;
    this._ty = smp.tangent.y;
    this._tz = smp.tangent.z;

    // muros
    const limit = Math.max(0.5, this.wallDist - T.wallRadius * this._scale);
    if (Math.abs(this.lateral) > limit) this._hitWall(limit);

    // ---------- vertical ----------
    const gvy = clamp((gy - this._prevGy) / dt, -15, 15); // velocidade vertical do chão sob o kart
    this._prevGy = gy;
    if (this.onGround) {
      const ballistic = this.position.y + this.vy * dt - 0.5 * T.gravity * dt * dt;
      if (va > 10 && gy < ballistic - T.crestGap) {
        // crista: o chão some sob o kart mais rápido do que a gravidade o puxa
        this.onGround = false;
        this.vy -= T.gravity * dt;
        this.position.y = ballistic;
        this.airTime = 0;
        this._airKind = 'crest';
        this._hopping = false;
        // lombada forte (decolando para cima) também vale manobra, como na rampa
        if (this.vy > T.crestTrickVy && !stunned) this.trickWindow = T.trickWindow;
      } else {
        this.vy = gvy;
        this.position.y = gy;
      }
    } else {
      this.vy -= T.gravity * dt;
      this.position.y += this.vy * dt;
      this.airTime += dt;
      if (this.position.y <= gy) {
        this.position.y = gy;
        this._land(gvy);
      }
    }
    this.offroad = !!p.offroad && this.onGround;
    // faixa da zebra (edgeBand m além do asfalto) freia pouco; além dela, grama/areia
    this.offroadLevel = !this.offroad ? 0 : Math.abs(this.lateral) - this.halfWidth <= T.edgeBand ? 1 : 2;

    // ---------- aceleradores e rampas ----------
    const nearGround = this.onGround || this.position.y - gy < 0.8;
    const pads = track.boostPads;
    if (pads && pads.length) {
      if (!this._padCd || this._padCd.length !== pads.length) this._padCd = new Float32Array(pads.length);
      for (let i = 0; i < pads.length; i++) {
        if (this._padCd[i] > 0) {
          this._padCd[i] -= dt;
          continue;
        }
        if (!nearGround || stunned) continue;
        const pd = pads[i];
        if (Math.abs(wrapSigned(this.s - pd.s, L)) > pd.length * 0.5 + 0.6) continue;
        if (Math.abs(this.lateral - (pd.lateral || 0)) > pd.width * 0.5 + 0.5) continue;
        this._padCd[i] = T.padCooldown;
        this.applyBoost(T.padBoost, 1, 'pad');
      }
    }
    const ramps = track.ramps;
    if (ramps && ramps.length) {
      if (!this._rampCd || this._rampCd.length !== ramps.length) this._rampCd = new Float32Array(ramps.length);
      for (let i = 0; i < ramps.length; i++) {
        if (this._rampCd[i] > 0) {
          this._rampCd[i] -= dt;
          continue;
        }
        const rp = ramps[i];
        if (!nearGround || this.speed < 4 || this.vy >= rp.launch) continue;
        // dispara na borda final da rampa (o kart sobe a cunha e decola na ponta)
        const dsr = wrapSigned(this.s - rp.s, L);
        if (dsr < rp.length * 0.5 - 2 || dsr > rp.length * 0.5 + 1) continue;
        if (Math.abs(this.lateral - (rp.lateral || 0)) > rp.width * 0.5 + 0.5) continue;
        this._rampCd[i] = T.rampCooldown;
        this._launch(rp.launch);
      }
    }

    // ---------- drift ----------
    this.driftFrozen = false;
    if (this.drifting) {
      if (!driftBtn) this._endDrift(true);
      else if (stunned || this.speed < T.driftMinSpeed * 0.7) this._endDrift(false);
      else if (this.onGround) {
        // na grama/areia o drift continua, mas a carga do mini-turbo fica parada (a zebra não atrapalha)
        this.driftFrozen = this.offroadLevel >= 2 && this.boostTime <= 0 && this.starTime <= 0;
        if (!this.driftFrozen) {
          const into = clamp(this.steer * this.driftDir, -1, 1);
          const rate = into >= 0
            ? T.driftChargeNeutral + (T.driftChargeIn - T.driftChargeNeutral) * into
            : T.driftChargeNeutral + (T.driftChargeOut - T.driftChargeNeutral) * -into;
          this.driftCharge += rate * dt * (1 + 0.15 * this._handF);
          const th = T.driftCharge;
          const lvl = this.driftCharge >= th[2] ? 3 : this.driftCharge >= th[1] ? 2 : this.driftCharge >= th[0] ? 1 : 0;
          if (lvl > this.driftLevel) {
            this.driftLevel = lvl;
            this.bus?.emit('kart:driftLevel', { kart: this, level: lvl });
          }
        }
      }
    } else if (driftBtn && !stunned && this.speed > T.driftMinSpeed && Math.abs(+c.steer || 0) > T.driftSteerMin) {
      const dir = c.steer > 0 ? 1 : -1;
      if (this._driftArm > 0 && this.onGround) this._startDrift(dir);
      // ápice do pulo com esterço: o drift já começa no ar (entrada mais direta)
      else if (this._hopping && !this.onGround && this.vy <= 0) this._startDrift(dir);
    }

    // vetor velocidade no mundo
    sh = Math.sin(this.heading);
    ch = Math.cos(this.heading);
    this.velocity.set(sh * this.speed - ch * this.slip, this.vy, ch * this.speed + sh * this.slip);
  }

  _hitWall(limit) {
    const T = TUNING;
    const side = this.lateral > 0 ? 1 : -1;
    const push = Math.abs(this.lateral) - limit;
    const nx = this._rx * side; // normal para fora
    const nz = this._rz * side;
    this.position.x -= nx * push;
    this.position.z -= nz * push;
    this.lateral = side * limit;
    const sh = Math.sin(this.heading);
    const ch = Math.cos(this.heading);
    let vx = sh * this.speed - ch * this.slip;
    let vz = ch * this.speed + sh * this.slip;
    const vn = vx * nx + vz * nz;
    if (vn <= 0) return;
    const vmag = Math.hypot(vx, vz);
    const sinA = clamp(vn / Math.max(vmag, 0.01), 0, 1);
    const speed0 = this.speed;
    // o kart já perdeu velocidade no acostamento: o muro raspa menos (e o peso ajuda)
    const keep = clamp(1 - this._wallScrub * sinA, 0.05, 1) * 0.997;
    const tx = (vx - nx * vn) * keep;
    const tz = (vz - nz * vn) * keep;
    vx = tx - nx * vn * T.wallBounce;
    vz = tz - nz * vn * T.wallBounce;
    // raspão: o rumo se alinha ao muro (batida de frente só quica para trás)
    if (this.speed > 0 && sinA < 0.8 && tx * tx + tz * tz > 0.25) {
      const dh = wrapAngle(Math.atan2(tx, tz) - this.heading);
      if (Math.abs(dh) < Math.PI / 2) this.heading = wrapAngle(this.heading + dh * T.wallDeflect);
    }
    this.yawVel *= 0.5;
    this._setVelXZ(vx, vz);
    // raspão de ângulo baixo nunca tira mais que 35% (batida de frente continua forte)
    if (sinA < T.wallGrazeSin && speed0 > 0 && this.speed < speed0 * T.wallGrazeKeep) {
      this.speed = speed0 * T.wallGrazeKeep;
      const sh2 = Math.sin(this.heading);
      const ch2 = Math.cos(this.heading);
      this.velocity.x = sh2 * this.speed - ch2 * this.slip;
      this.velocity.z = ch2 * this.speed + sh2 * this.slip;
    }
    if (vn > 1.5 && this._wallCd <= 0) {
      this._wallCd = 0.35;
      this._jolt(-nx, -nz, Math.min(0.2, vn * 0.015));
      this.bus?.emit('kart:wall', { kart: this, strength: clamp(vn / 16, 0.1, 1) });
    }
  }

  // Define a velocidade horizontal no mundo, decompondo em frente/lado.
  _setVelXZ(vx, vz) {
    const sh = Math.sin(this.heading);
    const ch = Math.cos(this.heading);
    this.speed = vx * sh + vz * ch;
    this.slip = -vx * ch + vz * sh;
    this.velocity.x = vx;
    this.velocity.z = vz;
  }

  // Solavanco visual: inclina o corpo para o lado oposto ao impacto (dx, dz = direção do golpe).
  _jolt(dx, dz, amount) {
    const side = dx * -Math.cos(this.heading) + dz * Math.sin(this.heading); // + = empurrado para a direita
    // a carroceria "fica para trás": empurrado para a direita, inclina para a esquerda
    this._visRoll = clamp(this._visRoll - side * amount, -0.35, 0.35);
    this._suspVel -= amount * 2;
  }

  // Empurrão (colisão kart×kart) sem atravessar o muro.
  _nudge(dx, dz) {
    this.position.x += dx;
    this.position.z += dz;
    this.lateral += dx * this._rx + dz * this._rz;
    const limit = Math.max(0.5, this.wallDist - TUNING.wallRadius * this._scale);
    const over = Math.abs(this.lateral) - limit;
    if (over > 0) {
      const side = this.lateral > 0 ? 1 : -1;
      this.position.x -= this._rx * side * over;
      this.position.z -= this._rz * side * over;
      this.lateral = side * limit;
    }
  }

  _launch(vy) {
    this.vy = Math.max(this.vy, vy);
    if (this.onGround) this.airTime = 0;
    this.onGround = false;
    this._airKind = 'ramp';
    this._hopping = false;
    this.trickWindow = TUNING.trickWindow;
    this._suspVel -= 0.6;
    if (this._pressAgo < TUNING.trickBuffer && !this.stunned) this._doTrick();
  }

  _doTrick() {
    this._trickPending = true;
    this.trickWindow = 0;
    this._trickT = 0;
    this._trickType = (Math.random() * 3) | 0;
    this._trickDir = Math.random() < 0.5 ? -1 : 1;
    this.bus?.emit('kart:trick', { kart: this });
  }

  _land(gvy = 0) {
    const impact = gvy - this.vy; // velocidade de impacto relativa ao chão
    this.vy = gvy;
    this.onGround = true;
    const air = this.airTime;
    this.airTime = 0;
    const kind = this._airKind;
    this._airKind = null;
    this.trickWindow = 0;
    this._suspVel -= clamp(impact, 0, 14) * 0.09;
    if (air > 0.12 || (kind && kind !== 'crest')) this.bus?.emit('kart:land', { kart: this, airTime: air });
    if (this._trickPending) {
      this._trickPending = false;
      // pulinho curto não vale turbo (evita manobra "de graça" em qualquer lombadinha)
      if (!this.stunned && air > TUNING.trickMinAir) this.applyBoost(TUNING.trickBoost * this._boostMul, 1, 'trick');
    }
    this._hopping = false;
    // segurando drift ao pousar numa curva: começa o drift
    if (!this.stunned && this.controls.drift && !this.drifting) {
      const st = +this.controls.steer || 0;
      if (Math.abs(st) > TUNING.driftSteerMin && this.speed > TUNING.driftMinSpeed) this._startDrift(st > 0 ? 1 : -1);
      else this._driftArm = TUNING.driftArmTime;
    }
  }

  _startDrift(dir) {
    this.drifting = true;
    this.driftDir = dir;
    this.driftLevel = 0;
    this.driftCharge = 0;
    this._driftArm = 0;
    this.bus?.emit('kart:driftStart', { kart: this, dir });
  }

  _endDrift(release) {
    const lvl = this.driftLevel;
    this.drifting = false;
    this.driftDir = 0;
    this.driftLevel = 0;
    this.driftCharge = 0;
    this.driftFrozen = false;
    this.bus?.emit('kart:driftEnd', { kart: this, level: release ? lvl : 0, cancelled: !release });
    if (release && lvl > 0) this.applyBoost(TUNING.driftBoost[lvl] * this._boostMul, 1, 'drift');
  }

  // ---------- Visual (uma vez por quadro) ----------
  _updateVisual(dt, world) {
    const T = TUNING;
    this._time += dt;
    const o = this.object3d;
    o.position.copy(this.position);
    o.rotation.y = this.heading;
    const speedAbs = Math.abs(this.speed);

    // escala: encolhido e amassado
    this._scale = damp(this._scale, this.shrinkTime > 0 ? T.shrinkScale : 1, 7, dt);
    this._flat = Math.max(0, this._flat - dt);

    // suspensão (mola amortecida)
    let force = -T.suspK * this._suspY - T.suspC * this._suspVel;
    if (this.offroad && speedAbs > 3) {
      const k = Math.min(1, speedAbs / 14);
      force += (Math.sin(this._time * 41 + this.index) + Math.sin(this._time * 27.3)) * 9 * k;
    }
    this._suspVel += force * dt;
    this._suspY = clamp(this._suspY + this._suspVel * dt, -0.3, 0.3);
    const sq = clamp(-this._suspY * 2.2, -0.22, 0.38); // > 0 = comprimido
    let sx = 1 + sq * 0.45;
    let sy = 1 - sq;
    if (this._flat > 0) {
      const f = Math.min(1, this._flat / 0.25);
      sy *= 1 - 0.65 * f;
      sx *= 1 + 0.3 * f;
    }
    // visual: escala uniforme (encolhido); o achatamento fica no grupo do modelo, a partir do chão
    this.visual.scale.setScalar(this._scale);
    this._pivotFix.scale.set(sx, sy, sx);
    // pisca durante a proteção depois de uma batida
    this.body.visible = !(this._hitCd > 0 && !this.stunned) || Math.sin(this._time * 40) > -0.3;

    // inclinação do chão (rampa ao longo da pista + inclinação lateral)
    let pitchT = 0;
    let rollT = 0;
    if (this.onGround) {
      const th = Math.atan2(this._tx, this._tz);
      const dh = wrapAngle(this.heading - th);
      const slopeT = this._ty / Math.max(0.2, Math.hypot(this._tx, this._tz));
      const n = this.normal;
      const slopeR = n.y > 0.2 ? -(n.x * this._rx + n.z * this._rz) / n.y : 0;
      const cd = Math.cos(dh);
      const sd = Math.sin(dh);
      pitchT = -Math.atan(cd * slopeT - sd * slopeR);
      rollT = -Math.atan(sd * slopeT + cd * slopeR);
    } else {
      pitchT = clamp(-this.vy * 0.025, -0.3, 0.3);
    }
    const tiltRate = this.onGround ? 14 : 5;
    this.visual.rotation.x = damp(this.visual.rotation.x, pitchT, tiltRate, dt);
    this.visual.rotation.z = damp(this.visual.rotation.z, rollT, tiltRate, dt);

    // corpo: guinada do drift, rolagem para fora da curva, arfagem na aceleração
    const into = this.drifting ? clamp(this.steer * this.driftDir, -1, 1) : 0;
    const yawT = this.drifting
      ? -this.driftDir * (T.driftVisualYaw + 0.12 * into)
      : -this.steer * 0.07 * Math.min(1, speedAbs / 10) * (this.speed < 0 ? -1 : 1);
    this._visYaw = damp(this._visYaw, yawT, this.drifting ? 9 : 11, dt);

    let rollB = clamp(-this.yawVel * this.speed * 0.0022, -0.12, 0.12);
    if (this.drifting) rollB -= this.driftDir * 0.07;
    if (this.offroad && speedAbs > 3) rollB += Math.sin(this._time * 31 + this.index * 1.7) * 0.03 * Math.min(1, speedAbs / 12);
    if (this.frozen && this._rev > 0.05) rollB += Math.sin(this._time * 70) * 0.015 * this._rev;
    this._visRoll = damp(this._visRoll, rollB, 10, dt);

    const acc = dt > 0 ? (this.speed - this._lastSpeed) / dt : 0;
    this._lastSpeed = this.speed;
    let pitchB = this.onGround ? clamp(-acc * 0.006, -0.07, 0.09) : 0;
    if (this.frozen) pitchB -= 0.05 * this._rev;
    this._visPitch = damp(this._visPitch, pitchB, 8, dt);

    // giro (maçã/choque) e capotagem
    let spinA = 0;
    if (this.spinTime > 0) {
      const p = 1 - this.spinTime / this._spinTotal;
      spinA = this._spinDir * this._spinTurns * TWO_PI * easeOut(p);
    }
    let flipA = 0;
    let lift = 0;
    if (this.tumbleTime > 0) {
      // capota no ar (termina antes de pousar) e depois fica tonto, balançando
      const el = this._tumbleTotal - this.tumbleTime;
      const p = clamp(el / T.tumbleFlip, 0, 1);
      flipA = -TWO_PI * easeInOut(p);
      spinA += this._spinDir * 0.6 * Math.sin(Math.PI * p);
      lift = 0.3 * Math.sin(Math.PI * p);
      if (p >= 1) {
        const w = this.tumbleTime / this._tumbleTotal;
        flipA += Math.sin(el * 16) * 0.1 * w;
        spinA += Math.sin(el * 9) * 0.25 * w;
      }
    }

    // manobra na rampa
    let tRoll = 0;
    let tYaw = 0;
    let tPitch = 0;
    if (this._trickT >= 0) {
      this._trickT += dt;
      const p = clamp(this._trickT / T.trickAnim, 0, 1);
      const e = easeInOut(p);
      if (this._trickType === 0) tRoll = this._trickDir * TWO_PI * e;
      else if (this._trickType === 1) tYaw = this._trickDir * TWO_PI * e;
      else {
        tPitch = -0.55 * Math.sin(Math.PI * p);
        tRoll = this._trickDir * 0.45 * Math.sin(TWO_PI * p);
      }
      if (p >= 1) this._trickT = -1;
    }

    const b = this.body;
    b.rotation.set(this._visPitch + flipA + tPitch, this._visYaw + spinA + tYaw, this._visRoll + tRoll);
    b.position.y = PIVOT + lift + Math.max(0, this._suspY) * 0.3;

    // animação do modelo
    if (this.model?.update) {
      const st = this._mstate;
      st.speed = this.speed;
      st.steer = this.steer;
      st.drifting = this.drifting;
      st.driftDir = this.driftDir;
      st.driftLevel = this.driftLevel;
      st.onGround = this.onGround;
      st.boosting = this.boostTime > 0;
      st.stunned = this.stunned;
      st.time = this._time;
      st.rev = this._rev;
      this.model.update(dt, st);
    }
  }
}

// ---------- Colisões kart×kart ----------
function collideKarts(karts) {
  const T = TUNING;
  const n = karts.length;
  for (let i = 0; i < n; i++) {
    const a = karts[i];
    for (let j = i + 1; j < n; j++) {
      const b = karts[j];
      if (a.frozen && b.frozen) continue;
      // corrida online: dois karts remotos se resolvem nos aparelhos dos donos
      const aR = a.remote;
      const bR = b.remote;
      if (aR && bR) continue;
      const dy = a.position.y - b.position.y;
      if (dy > 1.5 || dy < -1.5) continue;
      let dx = b.position.x - a.position.x;
      let dz = b.position.z - a.position.z;
      const r = T.kartRadius * (a._scale + b._scale);
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-4) {
        // sobrepostos: separa pela direita de a
        dx = -Math.cos(a.heading);
        dz = Math.sin(a.heading);
        d = 1;
      }
      const nx = dx / d;
      const nz = dz / d;
      const overlap = r - Math.min(d, r);

      // estrela capota; kart normal amassa o encolhido
      // (um kart remoto nunca apanha aqui: o aparelho do dono vê a mesma batida e resolve)
      const aStar = a.starTime > 0;
      const bStar = b.starTime > 0;
      if (aStar && !bStar) { if (!bR) b.hit('tumble', a, 'faraday'); }
      else if (bStar && !aStar) { if (!aR) a.hit('tumble', b, 'faraday'); }
      else if (!aStar && !bStar) {
        const aSmall = a.shrinkTime > 0;
        const bSmall = b.shrinkTime > 0;
        if (!aSmall && bSmall && !a.stunned && !bR) {
          if (b.hit('spin', a, 'tesla')) b._flat = 0.8; // encolhido pela Bobina de Tesla
        } else if (aSmall && !bSmall && !b.stunned && !aR) {
          if (a.hit('spin', b, 'tesla')) a._flat = 0.8;
        }
      }

      const ma = a.mass * (aStar ? 6 : 1) * (a.shrinkTime > 0 ? 0.5 : 1);
      const mb = b.mass * (bStar ? 6 : 1) * (b.shrinkTime > 0 ? 0.5 : 1);
      const ia = a.frozen ? 0 : 1 / ma;
      const ib = b.frozen ? 0 : 1 / mb;
      const isum = ia + ib;
      if (isum <= 0) continue;
      // kart remoto = obstáculo sólido leve: só o kart local reage, com a parte dele de uma
      // batida normal (o remoto faz a parte dele no próprio aparelho)
      const ua = aR ? 0 : ia;
      const ub = bR ? 0 : ib;

      // separa as posições pelo inverso do peso
      if (ua > 0) a._nudge(-nx * overlap * (ia / isum), -nz * overlap * (ia / isum));
      if (ub > 0) b._nudge(nx * overlap * (ib / isum), nz * overlap * (ib / isum));

      // troca de velocidade na direção da batida
      const sa = Math.sin(a.heading);
      const ca = Math.cos(a.heading);
      const sb = Math.sin(b.heading);
      const cb = Math.cos(b.heading);
      let avx = sa * a.speed - ca * a.slip;
      let avz = ca * a.speed + sa * a.slip;
      let bvx = sb * b.speed - cb * b.slip;
      let bvz = cb * b.speed + sb * b.slip;
      const rel = (bvx - avx) * nx + (bvz - avz) * nz; // < 0 = aproximando
      const want = Math.max(-rel * T.bumpRestitution, T.bumpMinSep);
      if (rel >= want) continue;
      const jimp = (want - rel) / isum;
      avx -= nx * jimp * ia;
      avz -= nz * jimp * ia;
      bvx += nx * jimp * ib;
      bvz += nz * jimp * ib;
      if (ua > 0) a._setVelXZ(avx, avz);
      if (ub > 0) b._setVelXZ(bvx, bvz);
      const kick = clamp(-rel * 0.025, 0, 0.18);
      a._jolt(-nx, -nz, kick * (ia / isum) * 2);
      b._jolt(nx, nz, kick * (ib / isum) * 2);
      if (-rel > 1 && a._bumpCd <= 0 && b._bumpCd <= 0) {
        a._bumpCd = 0.3;
        b._bumpCd = 0.3;
        (a.bus || b.bus)?.emit('kart:bump', { a, b, strength: clamp(-rel / 10, 0.15, 1) });
      }
    }
  }
}

export function updateKarts(karts, dt, world) {
  if (!karts || !karts.length || dt <= 0) return;
  const n = clamp(Math.ceil(dt / TUNING.maxSubstep - 1e-6), 1, 6);
  const h = dt / n;
  for (let s = 0; s < n; s++) {
    // kart remoto (corrida online): sem física aqui, a pose vem da rede (netPose)
    for (let i = 0; i < karts.length; i++) if (!karts[i].remote) karts[i]._physics(h, world);
    collideKarts(karts);
  }
  for (let i = 0; i < karts.length; i++) karts[i]._updateVisual(dt, world);
}
