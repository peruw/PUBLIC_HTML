// Estilos de personagem ("skins"): 'classic' (bonecos procedurais de chars/*) ou 'toon'
// (KayKit Adventurers, CC0, com animações prontas). O estilo toon devolve o mesmo contrato de
// Character (group, height, getEye, setHeadVisible, weaponKind...) e é animado por AnimationMixer;
// battle.js delega para as funções toon* abaixo quando char.toon é verdadeiro.
import * as THREE from './three.js';

const URL_OF = (name) => new URL('../assets/toon/' + name + '.glb', import.meta.url).href;

// Peça -> modelo, altura (m), golpe, arma (alcance em animations.js) e momento do impacto (fração do golpe)
const DEF = {
  p: { model: 'rogue_hooded', h: 1.6, attack: '1H_Melee_Attack_Stab', weapon: 'sword', hitAt: 0.42 },
  r: { model: 'barbarian', h: 1.9, attack: '2H_Melee_Attack_Chop', weapon: 'hammer', hitAt: 0.45 },
  n: { model: 'knight', h: 1.85, attack: '1H_Melee_Attack_Slice_Diagonal', weapon: 'sword', hitAt: 0.42, hide: ['2H_Sword'] },
  b: { model: 'mage', h: 1.8, attack: 'Spellcast_Shoot', weapon: 'staff', hitAt: 0.5 },
  q: { model: 'rogue', h: 1.85, attack: 'Dualwield_Melee_Attack_Slice', weapon: 'sword', hitAt: 0.42 },
  k: { model: 'knight', h: 2.1, attack: '2H_Melee_Attack_Slice', weapon: 'sword', hitAt: 0.45, hide: ['1H_Sword', 'Round_Shield'], crown: true },
};
// Cores dos exércitos: multiplicam a textura do modelo
const TINT = { w: 0xffffff, b: 0x7a3434 };
const HEAD_RE = /head|helmet|hat|hood/i;

let style = 'classic';
let loaded = null;          // Promise dos modelos toon
const models = {};          // nome -> { scene, height }
let clips = [];             // animações (vêm do arquivo do cavaleiro; todos usam o mesmo esqueleto)
const tinted = new Map();   // material original + cor -> material tingido
let SkeletonUtils = null;

export function getStyle() { return style; }

// Troca o estilo. 'toon' carrega os modelos na primeira vez; se falhar, fica no clássico e devolve false.
export async function setStyle(next) {
  if (next !== 'toon') { style = 'classic'; return true; }
  try {
    await loadToon();
    style = 'toon';
    return true;
  } catch (e) {
    console.warn('[skins] estilo desenho indisponível:', e);
    loaded = null;
    style = 'classic';
    return false;
  }
}

function loadToon() {
  if (loaded) return loaded;
  loaded = (async () => {
    const [{ GLTFLoader }, SU] = await Promise.all([import('./vendor/GLTFLoader.js'), import('./vendor/SkeletonUtils.js')]);
    SkeletonUtils = SU;
    const loader = new GLTFLoader();
    const names = [...new Set(Object.values(DEF).map((d) => d.model))];
    await Promise.all(names.map(async (n) => {
      const gl = await loader.loadAsync(URL_OF(n));
      gl.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gl.scene);
      models[n] = { scene: gl.scene, height: Math.max(0.01, box.max.y - box.min.y), minY: box.min.y };
      if (gl.animations.length) clips = gl.animations;
    }));
    if (!clips.length) throw new Error('modelos sem animações');
  })();
  return loaded;
}

function tintedMaterial(mat, color) {
  const key = mat.uuid + color;
  let m = tinted.get(key);
  if (!m) {
    m = mat.clone();
    m.color = new THREE.Color(TINT[color]);
    if ('roughness' in m) m.roughness = Math.max(m.roughness ?? 0.8, 0.7);
    tinted.set(key, m);
  }
  return m;
}

let crownGeo = null, crownMat = null;
function makeCrown(size) {
  if (!crownGeo) {
    crownGeo = new THREE.CylinderGeometry(1, 0.92, 0.55, 10, 1, true);
    crownMat = new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });
  }
  const c = new THREE.Mesh(crownGeo, crownMat);
  c.scale.setScalar(size);
  c.castShadow = true;
  return c;
}

// Constrói um personagem toon (os modelos já precisam estar carregados: setStyle('toon')).
export function buildToon(letter, color) {
  const d = DEF[letter];
  const src = models[d.model];
  const root = SkeletonUtils.clone(src.scene);
  const k = d.h / src.height;
  root.scale.setScalar(k);
  root.position.y = -src.minY * k;
  const group = new THREE.Group();
  group.add(root);

  const headMeshes = [];
  root.traverse((o) => {
    if (d.hide && d.hide.includes(o.name)) o.visible = false;
    if (o.isMesh) {
      o.material = tintedMaterial(o.material, color);
      o.castShadow = true;
      o.receiveShadow = false;
      o.frustumCulled = false; // malha com esqueleto: a caixa de recorte não acompanha a animação
      if (HEAD_RE.test(o.name)) headMeshes.push(o);
    }
  });
  const headBone = root.getObjectByName('head');
  if (d.crown && headBone) {
    const crown = makeCrown(src.height * 0.085);
    crown.position.set(0, src.height * 0.26, 0);
    headBone.add(crown);
    headMeshes.push(crown);
  }

  const mixer = new THREE.AnimationMixer(root);
  const char = {
    toon: true, group, root, mixer, def: d, type: letter, color,
    height: d.h, eyeHeight: d.h * 0.86, weaponKind: d.weapon, mounted: false,
    joints: {}, rest: [], headMeshes, current: null,
    getEye(out) {
      if (headBone) {
        headBone.getWorldPosition(out);
        out.y += d.h * 0.1;
        const ry = group.rotation.y;
        out.x += Math.sin(ry) * 0.22; out.z += Math.cos(ry) * 0.22;
      } else {
        group.localToWorld(out.set(0, d.h * 0.86, 0.2));
      }
      return out;
    },
    setHeadVisible(v) { for (const m of headMeshes) m.visible = v; },
  };
  toonPlay(char, 'Idle', { fade: 0 });
  mixer.update((group.id % 13) * 0.17); // exército não respira em uníssono
  return char;
}

// ---------------------------------------------------------------------------------------------
// Animações por clipes (mesmo protocolo de battle.js: update(dt) -> terminou?)
// ---------------------------------------------------------------------------------------------
function clip(name) { return THREE.AnimationClip.findByName(clips, name); }

export function toonPlay(char, name, { loop = true, fade = 0.2, timeScale = 1, clamp = false } = {}) {
  const c = clip(name);
  if (!c) return null;
  const a = char.mixer.clipAction(c);
  a.enabled = true;
  a.setEffectiveTimeScale(timeScale);
  a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  a.clampWhenFinished = clamp || !loop;
  if (char.current === a && loop) return a;
  a.reset();
  a.setEffectiveWeight(1);
  if (char.current && char.current !== a && fade > 0) a.crossFadeFrom(char.current, fade, false);
  else if (char.current && char.current !== a) char.current.stop();
  a.play();
  char.current = a;
  return a;
}

export function toonReset(char) {
  char.mixer.stopAllAction();
  char.current = null;
  toonPlay(char, 'Idle', { fade: 0 });
  char.mixer.update(0);
}

export function toonIdle(char) {
  return {
    update(dt) {
      if (!char.current || char.current.getClip().name !== 'Idle') {
        if (!char.dead) toonPlay(char, 'Idle', { fade: 0.25 });
      }
      char.mixer.update(dt);
    },
  };
}

export function toonWalk(char) {
  let started = false;
  return {
    update(dt, speed = 1) {
      if (!started) { started = true; toonPlay(char, 'Walking_A', { fade: 0.15, timeScale: 1.25 * speed }); }
      char.mixer.update(dt);
    },
    stop() { toonPlay(char, 'Idle', { fade: 0.2 }); },
  };
}

function once(char, name, { hitAt = -1, onHit, fade = 0.12, timeScale = 1, end = 'Idle', maxDur = Infinity } = {}) {
  const c = clip(name);
  const dur = c ? Math.min(maxDur, c.duration / timeScale) : 0.4;
  let t = 0, started = false, hit = false;
  return {
    duration: dur,
    update(dt) {
      if (!started) { started = true; if (c) toonPlay(char, name, { loop: false, fade, timeScale }); }
      t += dt;
      char.mixer.update(dt);
      if (!hit && hitAt >= 0 && t >= dur * hitAt) { hit = true; if (onHit) onHit(); }
      if (t >= dur) {
        if (!hit && hitAt >= 0) { hit = true; if (onHit) onHit(); }
        if (end) toonPlay(char, end, { fade: 0.25 });
        return true;
      }
      return false;
    },
  };
}

export function toonAttack(attacker, victim, opts = {}) {
  return once(attacker, attacker.def.attack, { hitAt: attacker.def.hitAt, onHit: opts.onHit, timeScale: 1.1 });
}
export function toonHit(victim) { return once(victim, 'Hit_A', { timeScale: 1.2 }); }
export function toonDeath(victim) {
  victim.dead = true;
  return once(victim, 'Death_A', { end: null, fade: 0.08 });
}
export function toonVictory(char) { return once(char, 'Cheer', { maxDur: 1.5, fade: 0.2 }); }
