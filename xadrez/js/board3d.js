// Cena: praça de mármore, tabuleiro, peças Staunton procedurais, realces e cenário.
// Tudo procedural (sem arquivos). Casa = SQUARE m. a1 em x=-7, z=+7; brancas olham para -Z.
import * as THREE from './three.js';
import { SQUARE, BOARD_HALF, COLORS } from './config.js';
import { buildCharacter } from './chars/index.js';
import { setShadows, resetPose } from './rig.js';
import { typeOf, colorOf, PIECE_LETTERS } from './rules.js';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const LETTER_TYPE = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };

export function squareToWorld(sq, out) {
  const f = sq & 7, r = sq >> 3;
  out.set((f - 3.5) * SQUARE, 0, (3.5 - r) * SQUARE);
  return out;
}

export function buildBoard(scene, quality) {
  const board = {
    pieces: new Map(),   // sq -> Group
    pickSquares: null,
    quality,
    lastMove: null,
  };

  // ---------- Materiais ----------
  const matSquare = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.0 });
  const matFrame = new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: 0.6 });
  const matGrass = new THREE.MeshLambertMaterial({ color: COLORS.grass });
  const matWall = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.9 });

  // ---------- Luz e ambiente ----------
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.fog, 40, 160);
  const hemi = new THREE.HemisphereLight(0xdfeeff, 0x4a6a3a, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.7);
  sun.position.set(-18, 30, 14);
  sun.castShadow = !!quality.shadows;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    const c = sun.shadow.camera;
    c.left = -14; c.right = 14; c.top = 14; c.bottom = -14; c.near = 5; c.far = 80;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
  }
  scene.add(sun);
  board.sun = sun;

  // ---------- Grama ----------
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), matGrass);
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.3;
  grass.receiveShadow = true;
  scene.add(grass);

  // Praça de pedra em volta do tabuleiro
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(BOARD_HALF * 2 + 8, 0.3, BOARD_HALF * 2 + 8), matWall);
  plaza.position.y = -0.16;
  plaza.receiveShadow = true;
  scene.add(plaza);

  // ---------- Casas ----------
  const squareGeo = new THREE.BoxGeometry(SQUARE, 0.2, SQUARE);
  const squares = new THREE.InstancedMesh(squareGeo, matSquare, 64);
  squares.receiveShadow = true;
  squares.castShadow = false;
  for (let sq = 0; sq < 64; sq++) {
    squareToWorld(sq, _v);
    _m.makeTranslation(_v.x, -0.1, _v.z);
    squares.setMatrixAt(sq, _m);
    const light = (((sq & 7) + (sq >> 3)) & 1) === 1;
    squares.setColorAt(sq, _c.set(light ? COLORS.lightSquare : COLORS.darkSquare));
  }
  squares.instanceMatrix.needsUpdate = true;
  squares.instanceColor.needsUpdate = true;
  scene.add(squares);
  board.pickSquares = squares;

  // ---------- Moldura com coordenadas ----------
  const FW = 1.1;
  const frameGeoH = new THREE.BoxGeometry(BOARD_HALF * 2 + FW * 2, 0.24, FW);
  const frameGeoV = new THREE.BoxGeometry(FW, 0.24, BOARD_HALF * 2);
  const frames = [
    [0, BOARD_HALF + FW / 2, frameGeoH], [0, -BOARD_HALF - FW / 2, frameGeoH],
    [BOARD_HALF + FW / 2, 0, frameGeoV], [-BOARD_HALF - FW / 2, 0, frameGeoV],
  ];
  for (const [x, z, g] of frames) {
    const m = new THREE.Mesh(g, matFrame);
    m.position.set(x, -0.12, z);
    m.receiveShadow = true;
    scene.add(m);
  }
  const labels = addCoordinates(scene, FW);
  addBranding(scene, FW);
  board.setLabelSide = (side) => { for (const m of labels) m.rotation.y = side === 'b' ? Math.PI : 0; };

  // ---------- Realces ----------
  const hlGeo = new THREE.CircleGeometry(0.62, 28);
  hlGeo.rotateX(-Math.PI / 2);
  const matHl = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
  const highlights = new THREE.InstancedMesh(hlGeo, matHl, 64);
  highlights.renderOrder = 2;
  for (let sq = 0; sq < 64; sq++) {
    squareToWorld(sq, _v);
    _m.compose(_v.set(_v.x, 0.02, _v.z), _q.identity(), _s.set(0, 0, 0));
    highlights.setMatrixAt(sq, _m);
    highlights.setColorAt(sq, _c.set(0xffffff));
  }
  highlights.instanceMatrix.needsUpdate = true;
  highlights.instanceColor.needsUpdate = true;
  scene.add(highlights);
  // Anel para a peça selecionada / rei em xeque (quadrado fino)
  const ringGeo = new THREE.RingGeometry(0.85, 1.0, 4, 1);
  ringGeo.rotateX(-Math.PI / 2);
  ringGeo.rotateY(Math.PI / 4);
  const matRing = new THREE.MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.9, depthWrite: false });
  const rings = new THREE.InstancedMesh(ringGeo, matRing, 64);
  rings.renderOrder = 3;
  for (let sq = 0; sq < 64; sq++) {
    squareToWorld(sq, _v);
    _m.compose(_v.set(_v.x, 0.025, _v.z), _q.identity(), _s.set(0, 0, 0));
    rings.setMatrixAt(sq, _m);
    rings.setColorAt(sq, _c.set(0xffffff));
  }
  rings.instanceMatrix.needsUpdate = true;
  rings.instanceColor.needsUpdate = true;
  scene.add(rings);

  function setInstance(mesh, sq, scale, color) {
    squareToWorld(sq, _v);
    _m.compose(_v.set(_v.x, mesh === rings ? 0.025 : 0.02, _v.z), _q.identity(), _s.set(scale, 1, scale));
    mesh.setMatrixAt(sq, _m);
    if (color !== undefined) mesh.setColorAt(sq, _c.set(color));
  }

  board.highlight = function ({ selected = -1, targets = [], captures = [], lastMove = null, check = -1 } = {}) {
    for (let sq = 0; sq < 64; sq++) { setInstance(highlights, sq, 0); setInstance(rings, sq, 0); }
    if (lastMove) {
      setInstance(highlights, lastMove.from, 1.15, COLORS.lastMove);
      setInstance(highlights, lastMove.to, 1.15, COLORS.lastMove);
    }
    for (const sq of targets) setInstance(highlights, sq, 0.55, COLORS.target);
    for (const sq of captures) setInstance(rings, sq, 1.0, COLORS.capture);
    if (selected >= 0) setInstance(rings, selected, 1.0, COLORS.selected);
    if (check >= 0) setInstance(rings, check, 1.0, COLORS.check);
    highlights.instanceMatrix.needsUpdate = true;
    highlights.instanceColor.needsUpdate = true;
    rings.instanceMatrix.needsUpdate = true;
    rings.instanceColor.needsUpdate = true;
  };
  board.highlight();

  // ---------- Cenário: muretas e árvores ----------
  const wallGeo = new THREE.BoxGeometry(1, 0.9, 1);
  const wallCount = 4 * 22;
  const walls = new THREE.InstancedMesh(wallGeo, matWall, wallCount);
  let wi = 0;
  const R = BOARD_HALF + 7;
  for (let i = 0; i < 22; i++) {
    const t = -R + (i / 21) * 2 * R;
    if (Math.abs(t) < 3.2) { // vãos (entradas) no meio de cada lado
      for (let k = 0; k < 4; k++) { _m.compose(_v.set(0, -100, 0), _q.identity(), _s.set(1, 1, 1)); walls.setMatrixAt(wi++, _m); }
      continue;
    }
    const poses = [[t, -R], [t, R], [-R, t], [R, t]];
    for (const [x, z] of poses) {
      _m.compose(_v.set(x, 0.15, z), _q.identity(), _s.set(1.3, 1, 1.3));
      walls.setMatrixAt(wi++, _m);
    }
  }
  walls.instanceMatrix.needsUpdate = true;
  walls.castShadow = !!quality.shadows;
  walls.receiveShadow = true;
  scene.add(walls);

  const treeCount = quality.trees;
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 3, 7);
  const leavesGeo = new THREE.ConeGeometry(2.2, 5.5, 8);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: COLORS.trunk }), treeCount);
  const leaves = new THREE.InstancedMesh(leavesGeo, new THREE.MeshLambertMaterial({ color: COLORS.leaves }), treeCount);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < treeCount; i++) {
    const a = rnd() * Math.PI * 2;
    const d = R + 6 + rnd() * 50;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const sc = 0.8 + rnd() * 0.9;
    _m.compose(_v.set(x, 1.2 * sc - 0.3, z), _q.identity(), _s.set(sc, sc, sc));
    trunks.setMatrixAt(i, _m);
    _m.compose(_v.set(x, (3 + 2.4) * sc - 0.3, z), _q.identity(), _s.set(sc, sc, sc));
    leaves.setMatrixAt(i, _m);
    leaves.setColorAt(i, _c.set(rnd() > 0.5 ? COLORS.leaves : COLORS.leaves2));
  }
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  leaves.instanceColor.needsUpdate = true;
  scene.add(trunks, leaves);
  board.scenery = { grass, plaza, trunks, leaves, mountains: [], hemi, sun, treeRadius: R };

  // Montanhas ao longe (cones grandes, sem sombra)
  const mtGeo = new THREE.ConeGeometry(30, 22, 6);
  const mtMat = new THREE.MeshLambertMaterial({ color: 0x8fa3b8 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const m = new THREE.Mesh(mtGeo, mtMat);
    m.position.set(Math.cos(a) * 120, 8, Math.sin(a) * 120);
    m.scale.set(1 + (i % 3) * 0.4, 1 + (i % 2) * 0.5, 1);
    scene.add(m);
    board.scenery.mountains.push(m);
  }

  // ---------- Peças (personagens) ----------
  setShadows(!!quality.shadows);
  function createPiece(piece) {
    const letter = PIECE_LETTERS[typeOf(piece)];
    const color = colorOf(piece);
    const char = buildCharacter(letter, color);
    const group = char.group;
    group.traverse((o) => { if (o.isMesh) o.userData.pieceGroup = group; });
    // personagens são construídos olhando +Z; brancas olham -Z no mundo
    group.rotation.y = color === 'w' ? Math.PI : 0;
    group.userData = { isPiece: true, sq: -1, type: letter, color, piece, height: char.height, char };
    return group;
  }

  board.pieceAt = (sq) => board.pieces.get(sq) || null;

  board.setPosition = function (state) {
    for (const g of board.pieces.values()) scene.remove(g);
    board.pieces.clear();
    for (let sq = 0; sq < 64; sq++) {
      const p = state.board[sq];
      if (!p) continue;
      const g = createPiece(p);
      squareToWorld(sq, g.position);
      g.userData.sq = sq;
      board.pieces.set(sq, g);
      scene.add(g);
    }
  };

  board.placePiece = function (group, sq) {
    if (group.userData.sq >= 0 && board.pieces.get(group.userData.sq) === group) board.pieces.delete(group.userData.sq);
    group.userData.sq = sq;
    board.pieces.set(sq, group);
    squareToWorld(sq, group.position);
    group.rotation.set(0, group.userData.color === 'w' ? Math.PI : 0, 0);
    group.scale.set(1, 1, 1);
    if (group.userData.char) resetPose(group.userData.char);
  };

  board.removePiece = function (sq) {
    const g = board.pieces.get(sq);
    if (!g) return null;
    board.pieces.delete(sq);
    scene.remove(g);
    return g;
  };

  board.detach = function (sq) {
    const g = board.pieces.get(sq);
    if (g) board.pieces.delete(sq);
    return g || null;
  };

  board.promote = function (sq, letter, color) {
    board.removePiece(sq);
    const piece = (color === 'w' ? 1 : -1) * LETTER_TYPE[letter];
    const g = createPiece(piece);
    board.placePiece(g, sq);
    scene.add(g);
    return g;
  };

  // Aplica um lance diretamente (sem animação): usado depois das animações ou no undo
  board.applyMoveInstant = function (move) {
    const sign = move.piece > 0 ? 1 : -1;
    if (move.flags === 'e') board.removePiece(move.to - sign * 8);
    else if (move.captured) board.removePiece(move.to);
    const mover = board.detach(move.from);
    if (mover) board.placePiece(mover, move.to);
    if (move.flags === 'k') { const r = board.detach(move.to + 1); if (r) board.placePiece(r, move.to - 1); }
    if (move.flags === 'q') { const r = board.detach(move.to - 2); if (r) board.placePiece(r, move.to + 1); }
    if (move.promotion) board.promote(move.to, PIECE_LETTERS[move.promotion], colorOf(move.piece));
  };

  board.pickables = () => {
    const arr = [squares];
    for (const g of board.pieces.values()) arr.push(g);
    return arr;
  };

  board.update = function () { /* nada dinâmico por enquanto */ };

  return board;
}

function addCoordinates(scene, FW) {
  const mk = (text) => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#e8dcc4';
    ctx.font = 'bold 84px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const geo = new THREE.PlaneGeometry(0.8, 0.8);
  geo.rotateX(-Math.PI / 2);
  const labels = [];
  for (let i = 0; i < 8; i++) {
    const file = String.fromCharCode(97 + i);
    const rank = String(i + 1);
    const x = (i - 3.5) * SQUARE;
    const z = (3.5 - i) * SQUARE;
    const tf = mk(file), tr = mk(rank);
    const specs = [
      [x, BOARD_HALF + FW / 2, tf, 0], [x, -BOARD_HALF - FW / 2, tf, 0],
      [-BOARD_HALF - FW / 2, z, tr, 0], [BOARD_HALF + FW / 2, z, tr, 0],
    ];
    for (const [px, pz, tex, rot] of specs) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.position.set(px, 0.005, pz);
      m.rotation.y = rot;
      scene.add(m);
      labels.push(m);
    }
  }
  return labels;
}

// ---------- Marca Quanta: logo no centro, letreiro no piso e placas de estádio ----------
const LOGO_URL = new URL('../assets/logo-quanta.png', import.meta.url).href;
let _logoImg = null;
function withLogo(cb) {
  if (!_logoImg) {
    _logoImg = new Image();
    _logoImg.decoding = 'async';
    _logoImg.src = LOGO_URL;
  }
  if (_logoImg.complete && _logoImg.naturalWidth) cb(_logoImg);
  else _logoImg.addEventListener('load', () => cb(_logoImg), { once: true });
}

// Fonte da marca (a mesma do título). Os textos das placas são redesenhados quando ela termina de carregar,
// senão ficariam para sempre na fonte reserva do sistema.
const BRAND_FONT = "'Plus Jakarta Sans', Inter, system-ui, sans-serif";
function whenFontsReady(cb) {
  try {
    if (!document.fonts || !document.fonts.load) return;
    Promise.all([document.fonts.load(`800 92px ${BRAND_FONT}`), document.fonts.load(`700 64px ${BRAND_FONT}`)]).then(cb, () => {});
  } catch { /* sem API de fontes: fica a reserva */ }
}

function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function addBranding(scene, FW) {
  // 1) Logo grande, em marca d'água, sobre as quatro casas centrais.
  const lc = document.createElement('canvas');
  lc.width = lc.height = 512;
  const ltex = canvasTex(lc);
  const logoMat = new THREE.MeshBasicMaterial({
    map: ltex, transparent: true, opacity: 0.22, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const logoGeo = new THREE.PlaneGeometry(SQUARE * 2.3, SQUARE * 2.3);
  logoGeo.rotateX(-Math.PI / 2);
  const logo = new THREE.Mesh(logoGeo, logoMat);
  logo.position.y = 0.004;
  logo.renderOrder = 1;
  logo.raycast = () => {};
  scene.add(logo);
  withLogo((img) => {
    const ctx = lc.getContext('2d');
    const k = Math.min(512 / img.naturalWidth, 512 / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    ctx.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);
    ltex.needsUpdate = true;
  });

  // 2) Letreiro no piso de pedra, nos quatro lados, logo depois da moldura.
  const sc = document.createElement('canvas');
  sc.width = 2048; sc.height = 128;
  const sctx = sc.getContext('2d');
  const drawStrip = () => {
    sctx.fillStyle = '#' + new THREE.Color(COLORS.brand).getHexString();
    sctx.fillRect(0, 0, 2048, 128);
    sctx.fillStyle = COLORS.brandText;
    sctx.font = `700 64px ${BRAND_FONT}`;
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillText('QUANTA AULAS   \u2022   quantaaulas.com   \u2022   QUANTA AULAS', 1024, 68);
  };
  drawStrip();
  const stex = canvasTex(sc);
  whenFontsReady(() => { drawStrip(); stex.needsUpdate = true; });
  const stripLen = BOARD_HALF * 2 + FW * 2;
  const stripGeo = new THREE.PlaneGeometry(stripLen, stripLen / 16);
  stripGeo.rotateX(-Math.PI / 2);
  const stripMat = new THREE.MeshStandardMaterial({ map: stex, roughness: 0.8 });
  const d = BOARD_HALF + FW + 0.25 + stripLen / 32;
  for (const [x, z, ry] of [[0, d, 0], [0, -d, Math.PI], [d, 0, Math.PI / 2], [-d, 0, -Math.PI / 2]]) {
    const m = new THREE.Mesh(stripGeo, stripMat);
    m.position.set(x, 0.005, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    m.raycast = () => {};
    scene.add(m);
  }

  // 3) Placas de estádio nas laterais e nos fundos (fora do caminho das câmeras, que ficam em z = ±12).
  const pc = document.createElement('canvas');
  pc.width = 1024; pc.height = 256;
  const ptex = canvasTex(pc);
  const drawPanel = (img) => {
    const ctx = pc.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#1f5230'); g.addColorStop(1, '#0f2a18');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = COLORS.brandAccent; ctx.fillRect(0, 0, 1024, 10); ctx.fillRect(0, 246, 1024, 10);
    let x0 = 40;
    if (img) {
      const k = 200 / img.naturalHeight;
      ctx.drawImage(img, 40, 28, img.naturalWidth * k, 200);
      x0 = 60 + img.naturalWidth * k;
    }
    ctx.fillStyle = COLORS.brandText;
    ctx.textBaseline = 'middle';
    ctx.font = `800 92px ${BRAND_FONT}`;
    ctx.fillText('QUANTA AULAS', x0, 104);
    ctx.fillStyle = COLORS.brandAccent;
    ctx.font = `700 50px ${BRAND_FONT}`;
    ctx.fillText('quantaaulas.com', x0, 186);
    ptex.needsUpdate = true;
  };
  let logoImg = null;
  drawPanel(null);
  withLogo((img) => { logoImg = img; drawPanel(img); });
  whenFontsReady(() => drawPanel(logoImg));
  const PW = 6, PH = 1.5;
  const faceGeo = new THREE.PlaneGeometry(PW, PH);
  const backGeo = new THREE.BoxGeometry(PW + 0.12, PH + 0.12, 0.12);
  const faceMat = new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.5, emissive: 0xffffff, emissiveMap: ptex, emissiveIntensity: 0.35 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.7 });
  const R = BOARD_HALF + 7.5; // 15,5 m
  const spots = [];
  for (const z of [-7, 0, 7]) { spots.push([R, z, -Math.PI / 2]); spots.push([-R, z, Math.PI / 2]); }
  for (const x of [-7, 7]) { spots.push([x, R + 3, Math.PI]); spots.push([x, -R - 3, 0]); }
  for (const [x, z, ry] of spots) {
    const g = new THREE.Group();
    const back = new THREE.Mesh(backGeo, backMat);
    back.position.z = -0.07;
    back.castShadow = true;
    const face = new THREE.Mesh(faceGeo, faceMat);
    g.add(back, face);
    g.position.set(x, PH / 2 + 0.15, z);
    g.rotation.y = ry;
    g.traverse((o) => { o.raycast = () => {}; });
    scene.add(g);
  }
}
