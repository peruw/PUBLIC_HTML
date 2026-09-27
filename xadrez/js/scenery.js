// Cenário realista, carregado depois que o jogo já abriu: céu fotográfico em 360° (HDRI do Poly Haven, CC0),
// chão com textura de grama e árvores procedurais do EZ-Tree (MIT). Cada etapa é independente:
// se uma falhar (rede, aparelho fraco), o cenário simples de board3d.js continua no lugar.
import * as THREE from './three.js';

const ASSET = (name) => new URL('../assets/' + name, import.meta.url).href;

// Espécies e tamanhos usados (presets do EZ-Tree) e altura final desejada em metros.
const SPECIES = [
  { preset: 'Oak Medium', height: 11 },
  { preset: 'Pine Medium', height: 14 },
  { preset: 'Aspen Medium', height: 12 },
  { preset: 'Ash Medium', height: 12 },
];

export async function upgradeScenery({ scene, renderer, board, quality, onChange }) {
  const sc = board.scenery;
  if (!sc) return;
  const done = [];
  try { await grassTexture(sc, renderer); done.push('grama'); onChange(); } catch (e) { console.warn('[cenário] grama', e); }
  try { await sky(scene, renderer, sc); done.push('céu'); onChange(); } catch (e) { console.warn('[cenário] céu', e); }
  try { await trees(scene, sc, quality); done.push('árvores'); onChange(); } catch (e) { console.warn('[cenário] árvores', e); }
  console.log('[cenário] realista:', done.join(', ') || 'nada (usando o simples)');
}

function loadTexture(url) {
  return new Promise((res, rej) => new THREE.TextureLoader().load(url, res, undefined, rej));
}

async function grassTexture(sc, renderer) {
  const tex = await loadTexture(ASSET('grass.jpg'));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(70, 70);
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const m = sc.grass.material;
  m.map = tex;
  m.color.set(0xc9d9b4);
  m.needsUpdate = true;
}

async function sky(scene, renderer, sc) {
  const { RGBELoader } = await import('./vendor/RGBELoader.js');
  const hdr = await new RGBELoader().loadAsync(ASSET('sky.hdr'));
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  pmrem.dispose();
  scene.background = hdr;
  scene.backgroundIntensity = 0.9;
  scene.environmentIntensity = 0.3;
  sc.sun.intensity *= 0.85;
  // névoa leve só para fundir o chão com o horizonte da foto
  scene.fog = new THREE.Fog(0xcdd6d4, 70, 260);
  for (const m of sc.mountains) m.visible = false;
  sc.hemi.intensity = 0.35;
}

async function trees(scene, sc, quality) {
  const { Tree } = await import('./vendor/ez-tree.js');
  // Um modelo de cada espécie; as demais árvores reaproveitam a mesma geometria (cópias leves).
  const models = [];
  for (let i = 0; i < SPECIES.length; i++) {
    const t = new Tree();
    t.loadPreset(SPECIES[i].preset);
    t.options.seed = 1000 + i * 77;
    t.generate();
    t.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(t);
    const h = Math.max(0.01, box.max.y - box.min.y);
    const meshes = [];
    t.traverse((o) => { if (o.isMesh) meshes.push(o); });
    models.push({ meshes, scale: SPECIES[i].height / h, baseY: -box.min.y });
    await new Promise((r) => setTimeout(r, 0)); // não travar a tela entre uma espécie e outra
  }

  const count = quality.realTrees ?? Math.round(quality.trees * 0.6);
  let seed = 4242;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const R = sc.treeRadius;
  const group = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const d = R + 9 + rnd() * 55;
    const md = models[i % models.length];
    const k = md.scale * (0.8 + rnd() * 0.45);
    const g = new THREE.Group();
    for (const m of md.meshes) {
      const c = new THREE.Mesh(m.geometry, m.material);
      c.position.copy(m.position); c.quaternion.copy(m.quaternion); c.scale.copy(m.scale);
      c.castShadow = false;
      c.receiveShadow = false;
      g.add(c);
    }
    g.scale.setScalar(k);
    g.position.set(Math.cos(a) * d, -0.3 + md.baseY * k, Math.sin(a) * d);
    g.rotation.y = rnd() * Math.PI * 2;
    g.traverse((o) => { o.raycast = () => {}; });
    group.add(g);
  }
  scene.add(group);
  sc.trunks.visible = false;
  sc.leaves.visible = false;
  sc.realTrees = group;
}
