// Pista de teste "difícil" para dev/driving.html: grampos, chicanes, curva longa,
// inclinação lateral e uma crista. Implementa a interface Track de ARCHITECTURE.md.
import * as THREE from '../js/three.js';

const UP = new THREE.Vector3(0, 1, 0);

// Pontos de controle [x, y, z] (sentido da corrida).
export const HARD_POINTS = [
  [0, 2, -160], [0, 2, -60], [0, 3, 30], [6, 6, 100], // reta longa, subida
  [30, 8, 140], [70, 6, 150], [96, 4, 128], [92, 3, 96], // curva à direita larga -> grampo
  [66, 3, 84], [52, 3, 60], [66, 3, 34], [96, 3, 26], // S
  [130, 4, 40], [160, 6, 70], [196, 8, 64], [214, 7, 30], // ondas
  [214, 5, -20], [196, 3, -70], [160, 2, -104], // curva longa
  [120, 2, -118], [100, 3, -146], [116, 4, -178], [150, 4, -190], // grampo
  [166, 3, -222], [130, 2, -250], [60, 2, -252], [16, 2, -234], [0, 2, -204], // retorno
];

export function buildTestTrack(scene, { points = HARD_POINTS, halfWidth = 8, wallDist = 13, color = 0x4d5560 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), true, 'centripetal');
  const N = 6000;
  const dense = curve.getSpacedPoints(N);
  dense.pop();
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + dense[i % N].distanceTo(dense[i - 1]));
  const length = cum[N];
  const count = Math.floor(length);
  const ds = length / count;
  const pts = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = k * ds;
    while (cum[j + 1] < target) j++;
    const f = (target - cum[j]) / (cum[j + 1] - cum[j]);
    pts.push(dense[j].clone().lerp(dense[(j + 1) % N], f));
  }
  const tangents = pts.map((p, i) => pts[(i + 1) % count].clone().sub(pts[(i - 1 + count) % count]).normalize());
  const rights = tangents.map((t) => new THREE.Vector3(-t.z, 0, t.x).normalize());
  const headings = tangents.map((t) => Math.atan2(t.x, t.z));
  const wrap = (s) => ((s % length) + length) % length;
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  // curvatura suavizada (para a inclinação e a linha de corrida)
  const curvRaw = headings.map((h, i) => -wrapA(headings[(i + 4) % count] - headings[(i - 4 + count) % count]) / (8 * ds));
  const curv = curvRaw.map((c, i) => {
    let a = 0;
    for (let k = -6; k <= 6; k++) a += curvRaw[(i + k + count) % count];
    return a / 13;
  });
  // inclinação lateral: pista inclina para dentro das curvas (lado de fora mais alto)
  const bank = curv.map((c) => THREE.MathUtils.clamp(-c * 3, -0.1, 0.1)); // dy/d(lateral)

  const _s = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: UP.clone(), halfWidth, wallDist };
  function sample(s) {
    s = wrap(s);
    const fi = s / ds;
    const i = Math.floor(fi) % count;
    const n = (i + 1) % count;
    const f = fi - Math.floor(fi);
    _s.pos.copy(pts[i]).lerp(pts[n], f);
    _s.tangent.copy(tangents[i]).lerp(tangents[n], f).normalize();
    _s.right.copy(rights[i]).lerp(rights[n], f).normalize();
    return _s;
  }
  const bankAt = (s) => {
    const fi = wrap(s) / ds;
    const i = Math.floor(fi) % count;
    return bank[i] + (bank[(i + 1) % count] - bank[i]) * (fi - Math.floor(fi));
  };

  const _d = new THREE.Vector3();
  const _p = { s: 0, lateral: 0, groundY: 0, normal: UP.clone(), halfWidth, wallDist, offroad: false };
  function project(pos, hintS) {
    let best = -1;
    let bestD = Infinity;
    const from = hintS === undefined ? 0 : Math.round(wrap(hintS) / ds) - 40;
    const to = hintS === undefined ? count - 1 : from + 80;
    for (let k = from; k <= to; k++) {
      const i = ((k % count) + count) % count;
      const dx = pos.x - pts[i].x;
      const dz = pos.z - pts[i].z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // projeta no segmento vizinho mais próximo (s contínuo)
    const nxt = (best + 1) % count;
    const prv = (best - 1 + count) % count;
    let a = best;
    let b = nxt;
    const ex = pts[nxt].x - pts[best].x;
    const ez = pts[nxt].z - pts[best].z;
    if ((pos.x - pts[best].x) * ex + (pos.z - pts[best].z) * ez < 0) {
      a = prv;
      b = best;
    }
    const sx = pts[b].x - pts[a].x;
    const sz = pts[b].z - pts[a].z;
    const t = THREE.MathUtils.clamp(((pos.x - pts[a].x) * sx + (pos.z - pts[a].z) * sz) / (sx * sx + sz * sz), 0, 1);
    const s = wrap((a + t) * ds);
    const smp = sample(s);
    _d.copy(pos).sub(smp.pos);
    const lateral = _d.x * smp.right.x + _d.z * smp.right.z;
    const bk = bankAt(s);
    _p.s = s;
    _p.lateral = lateral;
    _p.groundY = smp.pos.y + bk * THREE.MathUtils.clamp(lateral, -wallDist, wallDist);
    // normal = (−∇h, 1) normalizado; h = bk * lateral (+ rampa ao longo da pista)
    const along = smp.tangent.y / Math.max(0.2, Math.hypot(smp.tangent.x, smp.tangent.z));
    _p.normal.set(-bk * smp.right.x - along * smp.tangent.x, 1, -bk * smp.right.z - along * smp.tangent.z).normalize();
    _p.offroad = Math.abs(lateral) > halfWidth;
    return _p;
  }

  function curvature(s) {
    const fi = wrap(s) / ds;
    return curv[Math.floor(fi) % count];
  }
  const racingLine = (s) => THREE.MathUtils.clamp(curvature(s + 12) * 180, -(halfWidth - 2), halfWidth - 2);

  const gridSlots = [];
  for (let i = 0; i < 8; i++) {
    const s = wrap(-8 - i * 5);
    const smp = sample(s);
    const lat = i % 2 === 0 ? -3.2 : 3.2;
    const pos = smp.pos.clone().addScaledVector(smp.right, lat);
    pos.y += bankAt(s) * lat;
    gridSlots.push({ pos, heading: Math.atan2(smp.tangent.x, smp.tangent.z), s });
  }
  const itemBoxSlots = [];
  for (const s of [150, Math.round(length * 0.55)]) {
    for (let k = -2; k <= 2; k++) {
      const smp = sample(s);
      itemBoxSlots.push({ pos: smp.pos.clone().addScaledVector(smp.right, k * 3).add(new THREE.Vector3(0, 1.2, 0)), s });
    }
  }
  const boostPads = [{ s: 60, lateral: -3, length: 8, width: 4 }, { s: Math.round(length * 0.7), lateral: 2, length: 8, width: 4 }];
  const ramps = [{ s: Math.round(length * 0.9), lateral: 0, length: 6, width: halfWidth * 2, launch: 8 }];
  const minimapPoints = [];
  for (let i = 0; i < 256; i++) {
    const p = sample((i / 256) * length).pos;
    minimapPoints.push({ x: p.x, z: p.z });
  }

  if (scene) {
    const group = new THREE.Group();
    const ribbon = (inner, outer, col, dy) => {
      const pos = [];
      const idx = [];
      for (let i = 0; i <= count; i++) {
        const k = i % count;
        for (const l of [inner, outer]) {
          const p = pts[k].clone().addScaledVector(rights[k], l);
          pos.push(p.x, p.y + bank[k] * l + dy, p.z);
        }
        if (i < count) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide })));
    };
    ribbon(-halfWidth, halfWidth, color, 0);
    ribbon(-wallDist, -halfWidth, 0xc9b27a, -0.02);
    ribbon(halfWidth, wallDist, 0xc9b27a, -0.02);
    // muros baixos
    for (const side of [-1, 1]) {
      const pos = [];
      const idx = [];
      for (let i = 0; i <= count; i++) {
        const k = i % count;
        const p = pts[k].clone().addScaledVector(rights[k], side * wallDist);
        const y = p.y + bank[k] * side * wallDist;
        pos.push(p.x, y, p.z, p.x, y + 0.9, p.z);
        if (i < count) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: side > 0 ? 0xe63946 : 0xf1faee, side: THREE.DoubleSide })));
    }
    for (const pd of boostPads) {
      const smp = sample(pd.s);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pd.width, pd.length), new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
      m.position.copy(smp.pos).addScaledVector(smp.right, pd.lateral);
      m.position.y += bankAt(pd.s) * pd.lateral + 0.04;
      m.rotation.set(-Math.PI / 2, 0, Math.atan2(smp.tangent.x, smp.tangent.z));
      group.add(m);
    }
    for (const rp of ramps) {
      const smp = sample(rp.s);
      const m = new THREE.Mesh(new THREE.BoxGeometry(rp.width, 0.3, rp.length), new THREE.MeshLambertMaterial({ color: 0x3399ff }));
      m.position.copy(smp.pos).add(new THREE.Vector3(0, 0.15, 0));
      m.rotation.y = Math.atan2(smp.tangent.x, smp.tangent.z);
      group.add(m);
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshLambertMaterial({ color: 0x3f7f35 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    group.add(ground);
    scene.add(group);
  }

  return {
    name: 'Pista difícil (teste)', length, sample, project, curvature, racingLine,
    gridSlots, itemBoxSlots, boostPads, ramps, minimapPoints, update() {},
    _debug: { pts, curv, bank },
  };
}
