// (esboço temporário)
import * as THREE from './three.js';
export function buildAds(scene, track, quality, env) {
  const group = new THREE.Group();
  group.name = 'anuncios';
  scene.add(group);
  return { group, update() {}, dispose() { scene.remove(group); }, debug: { solids: [], feet: [], canvases: {} } };
}
