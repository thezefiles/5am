// Arena Lund: an art déco arena on the south side of Lund, Skåne, with the town, the plain and the Öresund round it.
// Everything is procedural (Three.js r128, no image files); the rendering follows the same recipe throughout:
// instanced boxes with a facade shader, a painted terrain, a physical sky, exponential haze and a day–night cycle.
(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const QS = new URLSearchParams(location.search);
const ARENA_NAME = 'ARENA LUND';

// World frame: 1 unit = 1 metre. Origin = the arena's centre, south of Lund's old town (55.6980 N, 13.1960 E).
// +x = east, -z = north, +z = south, y = up; y = 0 is the arena's grounds, about 45 m above the sea.
// Everything is placed from latitude/longitude with x = (lon - 13.1960) * 62 650 and z = (55.6980 - lat) * 111 320.
const LAT0 = 55.6980, LON0 = 13.1960;
const LL = (lat, lon) => [(lon - LON0) * 62650, (LAT0 - lat) * 111320];
const SEA_Y = -45;

// ---------------------------------------------------------------- noise
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(16661020);
const R = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}
function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f + i * 17.3, z * f - i * 9.1); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- polylines
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  let t = ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - px, ez = az + dz * t - pz;
  return Math.sqrt(ex * ex + ez * ez);
}
function inPoly(x, z, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
function mkLine(pts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { pts, x0, x1, z0, z1 };
}
function smoothLine(pts, step) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const n = Math.max(2, Math.ceil(curve.getLength() / step));
  return curve.getSpacedPoints(n).map((v) => [v.x, v.z]);
}
// Uniform grid of segments for fast "how far to the nearest road / stream" queries.
class SegIndex {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(i, j) { return (i + 32768) * 65536 + (j + 32768); }
  add(pts, half, pad) {
    const c = this.cell;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], seg = [ax, az, bx, bz, half], r = half + pad;
      const i0 = Math.floor((Math.min(ax, bx) - r) / c), i1 = Math.floor((Math.max(ax, bx) + r) / c);
      const j0 = Math.floor((Math.min(az, bz) - r) / c), j1 = Math.floor((Math.max(az, bz) + r) / c);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const kk = this.key(i, j); let a = this.map.get(kk);
        if (!a) this.map.set(kk, a = []);
        a.push(seg);
      }
    }
  }
  segs(x, z) { return this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))); }
  clearance(x, z) {
    const a = this.segs(x, z);
    if (!a) return 1e9;
    let d = 1e9;
    for (const s of a) { const dd = segDist(x, z, s[0], s[1], s[2], s[3]) - s[4]; if (dd < d) d = dd; }
    return d;
  }
}
function sideDist(x, z, ln) {
  const p = ln.pts; let d = Infinity, s = 1;
  for (let i = 0; i < p.length - 1; i++) {
    const dd = segDist(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]);
    if (dd < d) { d = dd; s = Math.sign((p[i + 1][0] - p[i][0]) * (z - p[i][1]) - (p[i + 1][1] - p[i][1]) * (x - p[i][0])) || 1; }
  }
  return d * s;   // the shore runs north, so positive is inland (east)
}

// ---------------------------------------------------------------- geography
// The Öresund shore from Malmö's harbour north past Lomma and Bjärred towards Barsebäck; the sea lies west of it.
const COAST = mkLine(smoothLine([[-16000, 19000], [-14400, 11200], [-14150, 9500], [-11400, 6500], [-8300, 3300], [-8600, 700],
  [-10700, -1900], [-13600, -4300], [-16600, -6600], [-18800, -12000], [-21500, -22000]], 700));
// Across the strait, the low Danish shore.
const DK_X = -36500;
// The old town: the medieval core inside the line of the old walls, round the cathedral; a ring road follows the walls.
const C0 = [-170, -720], RING_R = 560;
const ringD = (x, z) => Math.hypot(x - C0[0], (z - C0[1]) / 0.92);
// Landmarks placed from their coordinates (rounded: this is a portrait of the town, not a survey).
const DOM = LL(55.7043, 13.1937);          // Lunds domkyrka
const UNIV = LL(55.7059, 13.1934);         // Universitetshuset
const KUNGSHUSET = LL(55.7051, 13.1958);
const AFB = LL(55.7066, 13.1962);          // AF-borgen
const STORTORGET = LL(55.7036, 13.1915);
const MARTENS = LL(55.7030, 13.1965);      // Mårtenstorget
const LUND_C = LL(55.7056, 13.1868);
const HOSPITAL = LL(55.7140, 13.1990);
const MAXIV = LL(55.7270, 13.2240);
const ESS = LL(55.7330, 13.2470);
const SHB = LL(55.7205, 13.1745);          // Sankt Hans backar
const TORSO = LL(55.6131, 12.9763);        // Turning Torso, in Malmö's western harbour
const MALMO = LL(55.6050, 13.0000);
// Romeleåsen: the long ridge rising south-east of the town, past Dalby.
const ROMELE = [LL(55.672, 13.330), LL(55.560, 13.520)];
// Höje å, the little river south of the town, running west to the sea at Lomma.
const HOJE = [[6600, 2300], [4400, 2050], [3383, 1892], [2000, 1760], [877, 1670], [-600, 1560], [-1629, 1558], [-2900, 1800],
  [-4135, 2004], [-5400, 2250], [-6641, 2449], [-7800, 2800], [-8500, 3150]];
const RIVERS = [{ name: 'Höje å', half: 5, pts: HOJE }];
// The river meanders through its meadows: the smoothed course, swung from side to side.
RIVERS.forEach((r) => {
  const base = smoothLine(r.pts, 20);
  r.line = base.map(([x, z], i) => {
    const a = base[Math.max(i - 1, 0)], b = base[Math.min(i + 1, base.length - 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, s = i * 20;
    const o = 34 * Math.sin(s / 190) + 16 * Math.sin(s / 67 + 1.3);
    return [x - (b[1] - a[1]) / l * o, z + (b[0] - a[0]) / l * o];
  });
});
const RIV_IDX = new SegIndex(150);
RIVERS.forEach((r) => RIV_IDX.add(r.line, r.half, 90));

const G = { sd: 0, riv: 1e4, rom: 0 };
function plainRaw(x, z) {
  // The Skåne plain: open, rolling a few metres, rising slowly to the east (the east of the town is 30 m above the west).
  let h = 4 * fbm(x / 2600 + 3.1, z / 2600 - 1.7, 3) + 1.4 * fbm(x / 650, z / 650, 2);
  h += 32 * smooth(-4500, 5500, x) - 16;
  const dr = segDist(x, z, ROMELE[0][0], ROMELE[0][1], ROMELE[1][0], ROMELE[1][1]);
  G.rom = Math.exp(-(dr / 2300) * (dr / 2300));
  h += 118 * G.rom * (0.8 + 0.4 * fbm(x / 3000 + 1.1, z / 3000, 2));
  // Sankt Hans backar: grassy hills heaped up over the old tip in the north-west of the town.
  const rh = Math.hypot(x - SHB[0], z - SHB[1]);
  h += 26 * Math.exp(-(rh / 190) * (rh / 190));
  return h;
}
const H_REF = plainRaw(0, 40);
function baseHeight(x, z) {
  const sd = sideDist(x, z, COAST);
  G.sd = sd;
  let h = plainRaw(x, z) - H_REF;
  // The plain falls away over its last few kilometres to the beaches; the sea floor shelves off.
  h = SEA_Y + (h - SEA_Y) * smooth(-300, 7200, sd) - 9 * smooth(0, -1800, sd);
  // The low Danish shore on the far side of the strait.
  const dk = smooth(DK_X + 1200, DK_X - 700, x + 1800 * vnoise(z / 7000, 4.2));
  if (dk > 0) h = h * (1 - dk) + (SEA_Y + 6 + 5 * fbm(x / 4000, z / 4000, 2)) * dk;
  // The arena's grounds are graded flat.
  const flat = 1 - smooth(300, 520, Math.hypot(x, z - 40));
  return h * (1 - flat);
}
function riverQuery(x, z) {
  const a = RIV_IDX.segs(x, z);
  let dist = 1e4, depth = 0;
  if (a) for (const s of a) {
    const d = segDist(x, z, s[0], s[1], s[2], s[3]);
    if (d - s[4] < dist) dist = d - s[4];
    // A small river between grassy banks.
    const dep = 2.2 * (1 - smooth(s[4] - 2, s[4] + 7, d));
    if (dep > depth) depth = dep;
  }
  G.riv = dist;
  return depth;
}
function landHeight(x, z) {
  const h = baseHeight(x, z);
  return h - riverQuery(x, z);
}
// Lund, and the towns and villages round it out to Malmö.
const TOWNS = [
  [250, -800, 3200, 2900],        // Lund
  [9650, 3670, 1150, 950],        // Dalby
  [9335, -2000, 1350, 1000],      // Södra Sandby
  [626, 6234, 1500, 1250],        // Staffanstorp
  [-3500, 3150, 750, 650],        // Hjärup
  [-6800, 5900, 1500, 1200],      // Åkarp and Arlöv
  [-12300, 11200, 5200, 4600],    // Malmö
  [-7400, 2900, 1300, 1150],      // Lomma
  [-10600, -2200, 1300, 1150],    // Bjärred
  [-5400, -10200, 1500, 1200],    // Kävlinge
  [700, -6600, 600, 500],         // Stångby
  [5600, 8000, 700, 600]          // Genarp road villages
];
function urbanAt(x, z) {
  let u = 0;
  for (const [cx, cz, rx, rz] of TOWNS) {
    const e = Math.hypot((x - cx) / rx, (z - cz) / rz);
    if (e > 1.3) continue;
    u = Math.max(u, 1 - smooth(0.78, 1.05, e + 0.16 * fbm(x / 900 + cx * 1e-3, z / 900, 2)));
  }
  return u;
}
function woodsAt(x, z) {
  // Beech woods on the ridge (Skrylle, Dalby Söderskog), and the odd woodlot out on the plain.
  plainRaw(x, z);
  const ridge = smooth(0.3, 0.65, G.rom) * smooth(-0.15, 0.2, fbm(x / 1700 + 7.7, z / 1700, 2));
  const lots = smooth(0.46, 0.56, fbm(x / 1100 + 5.1, z / 1100 - 2.3, 3)) * 0.95;
  return Math.max(ridge, lots);
}
// Parks: Stadsparken, the botanical garden, Lundagård, the northern cemetery, Sankt Hans backar, Sankt Lars park.
const octa = (cx, cz, r, n = 10) => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * Math.PI * 2) * r, cz + Math.sin(i / n * Math.PI * 2) * r * 0.85]);
const PARKS = [
  [[-650, -300], [-340, -290], [-310, 60], [-560, 120], [-680, -80]],
  [[410, -1100], [750, -1080], [750, -830], [410, -840]],
  [[-205, -852], [25, -852], [30, -745], [-95, -728], [-205, -737]],
  [[-1060, -2000], [-590, -1990], [-580, -1450], [-1060, -1460]],
  octa(SHB[0], SHB[1], 340),
  [[-1900, 450], [-1200, 420], [-1150, 900], [-1850, 950]]
];
function inAny(x, z, polys) { for (const p of polys) if (inPoly(x, z, p)) return true; return false; }
// Paved squares in the old town and by the station.
const SQUARES = [[...STORTORGET, 74, 56], [...MARTENS, 64, 50], [-470, -850, 56, 90]];

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance', preserveDrawingBuffer: QS.has('shot') });
renderer.setPixelRatio(QS.has('shot') ? 1 : Math.min(devicePixelRatio, MOBILE ? 1.5 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
$('stage').appendChild(renderer.domElement);
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

// Beer–Lambert haze (exponential, not squared): a clear Scanian autumn afternoon, Malmö softened 16 km off.
THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
  'fogDensity * fogDensity * fogDepth * fogDepth', 'fogDensity * fogDepth');

const scene = new THREE.Scene();
const FOG_DENSITY = 6.2e-5;
scene.fog = new THREE.FogExp2(0xb7c3cc, FOG_DENSITY);
const fogDisplay = new THREE.Color(0xb7c3cc);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 160000);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 20;
controls.maxDistance = 14000;
controls.maxPolarAngle = 88 * DEG;
controls.screenSpacePanning = false;

const lin = (h) => new THREE.Color(h).convertSRGBToLinear();

// The arena precinct hangs off this group (square to the compass, so it is only a parent).
const site = new THREE.Group();
scene.add(site);

// ---------------------------------------------------------------- sky + light
const sky = new THREE.Sky();
sky.scale.setScalar(100000);
sky.renderOrder = -1;
sky.frustumCulled = false;
scene.add(sky);
const skyU = sky.material.uniforms;
skyU.turbidity.value = 4.6;
skyU.rayleigh.value = 1.9;
skyU.mieCoefficient.value = 0.0065;
skyU.mieDirectionalG.value = 0.85;
const envScene = new THREE.Scene();
const sky2 = new THREE.Sky();
sky2.scale.setScalar(1000);
sky2.material.uniforms = skyU;
envScene.add(sky2);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
function updateEnv() {
  const rt = pmrem.fromScene(envScene, 0, 0.1, 5000);
  if (envRT) envRT.dispose();
  envRT = rt;
  scene.environment = rt.texture;
}

const sunDir = new THREE.Vector3(-1, 0.35, 0).normalize();
const SHADOW_C = new THREE.Vector3(-60, 0, -300);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(MOBILE ? 2048 : 4096, MOBILE ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -1250, right: 1250, top: 1250, bottom: -1250, near: 50, far: 9000 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.5;
sun.target.position.copy(SHADOW_C);
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xd6e0ec, 0x6a6650, 0.25);
scene.add(hemi);
const NIGHT = { value: 0 };

// ---------------------------------------------------------------- helpers
function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true, flipY = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.flipY = flipY;
  if (srgb) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = Math.min(8, MAX_ANISO);
  return t;
}
function speckle(g, w, h, n, colors, size = 2) {
  for (let i = 0; i < n; i++) { g.fillStyle = pick(colors); g.fillRect(rand() * w, rand() * h, size, size); }
}
function merge(geos, withUV = false) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; parts.forEach((g) => { n += g.attributes.position.count; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = withUV ? new Float32Array(n * 2) : null;
  let o = 0;
  parts.forEach((g) => {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (uv && g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
function composeInto(mesh, i, it) {
  _e.set(it.rx || 0, it.ry || 0, it.rz || 0); _q.setFromEuler(_e);
  _p.set(it.x, it.y, it.z); _s.set(it.sx, it.sy, it.sz);
  _m4.compose(_p, _q, _s); mesh.setMatrixAt(i, _m4);
}
function instanced(geo, mat, items, { cast = false, receive = false, parent = scene } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(items.length, 1));
  mesh.count = items.length;
  items.forEach((it, i) => { composeInto(mesh, i, it); if (it.c) mesh.setColorAt(i, it.c); });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = cast; mesh.receiveShadow = receive;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}
function std(color, opts = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color: lin(color), roughness: 0.85, metalness: 0 }, opts)); }
function rectGeo(x0, z0, x1, z1, y, uvFn) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  if (uvFn) {
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { const [u, v] = uvFn(p.getX(i), p.getZ(i)); uv.setXY(i, u, v); }
  }
  return g;
}
// Flat pieces sharing a material are merged into one draw call per material.
const BATCH = new Map();
function batchRect(key, x0, z0, x1, z1, y, uvFn) {
  if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
  if (!BATCH.has(key)) BATCH.set(key, []);
  BATCH.get(key).push(rectGeo(x0, z0, x1, z1, y, uvFn));
}
function flushBatches(mats, parent) {
  BATCH.forEach((geos, key) => {
    const m = new THREE.Mesh(merge(geos, true), mats[key]);
    m.receiveShadow = true;
    parent.add(m);
  });
  BATCH.clear();
}
const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
// A box standing on y = 0 whose UVs are in metres / (uS, vS), so a tiling texture keeps its scale on every face.
function boxGeoUV(w, h, d, uS, vS = uS) {
  const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const uv = g.attributes.uv;
  // Faces in order +x, -x, +y, -y, +z, -z; four vertices each.
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / uS, uv.getY(i) * dims[f][1] / vS); }
  return g;
}
const tick = () => new Promise((r) => setTimeout(r, 20));
const say = (t) => { $('loadMsg').textContent = t; };

// Tiny geometry builder: triangles with UVs, each face turned to face `dir`.
class GB {
  constructor() { this.p = []; this.u = []; }
  tri(a, b, c, ua, ub, uc, dir) {
    if (dir) {
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      if (nx * dir[0] + ny * dir[1] + nz * dir[2] < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; }
    }
    this.p.push(...a, ...b, ...c); this.u.push(...ua, ...ub, ...uc);
  }
  quad(a, b, c, d, ua, ub, uc, ud, dir) { this.tri(a, b, c, ua, ub, uc, dir); this.tri(a, c, d, ua, uc, ud, dir); }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.computeVertexNormals();
    return g;
  }
}
function polyArea(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function edgeNormal(a, b, sgn) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  return sgn > 0 ? [dz / l, -dx / l] : [-dz / l, dx / l];
}
function offsetPoly(poly, d) {
  const n = poly.length, sgn = Math.sign(polyArea(poly)), out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], c = poly[(i + 1) % n];
    const n1 = edgeNormal(a, b, sgn), n2 = edgeNormal(b, c, sgn);
    const k = d / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
    out.push([b[0] + (n1[0] + n2[0]) * k, b[1] + (n1[1] + n2[1]) * k]);
  }
  return out;
}
const perimeter = (poly) => poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0);
// Side walls between a footprint at yb and a (possibly offset) footprint at yt; yb / yt may be per-vertex arrays.
function loft(bot, top, yb, yt, { uScale = 1, vScale = 1, cap = false, closed = true, gb = new GB() } = {}) {
  const n = bot.length, m = closed ? n : n - 1, sgn = Math.sign(polyArea(bot)) || 1;
  const Y = (a, i) => (Array.isArray(a) ? a[i] : a);
  let along = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n, b0 = bot[i], b1 = bot[j], t0 = top[i], t1 = top[j];
    const len = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]), nn = edgeNormal(b0, b1, sgn);
    const u0 = along / uScale, u1 = (along + len) / uScale;
    const yb0 = Y(yb, i), yb1 = Y(yb, j), yt0 = Y(yt, i), yt1 = Y(yt, j);
    gb.quad([b0[0], yb0, b0[1]], [b1[0], yb1, b1[1]], [t1[0], yt1, t1[1]], [t0[0], yt0, t0[1]],
      [u0, 0], [u1, 0], [u1, (yt1 - yb1) / vScale], [u0, (yt0 - yb0) / vScale], [nn[0], 0, nn[1]]);
    along += len;
  }
  if (cap) {
    for (let i = 1; i < n - 1; i++) {
      gb.tri([top[0][0], Y(yt, 0), top[0][1]], [top[i][0], Y(yt, i), top[i][1]], [top[i + 1][0], Y(yt, i + 1), top[i + 1][1]],
        [top[0][0] / uScale, top[0][1] / uScale], [top[i][0] / uScale, top[i][1] / uScale], [top[i + 1][0] / uScale, top[i + 1][1] / uScale], [0, 1, 0]);
    }
  }
  return gb;
}
// A flat convex polygon at height y, facing up or down.
function capPoly(poly, y, up, gb = new GB(), uvS = 1) {
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    gb.tri([cx, y, cz], [p[0], y, p[1]], [q[0], y, q[1]], [cx / uvS, cz / uvS], [p[0] / uvS, p[1] / uvS], [q[0] / uvS, q[1] / uvS], [0, up ? 1 : -1, 0]);
  }
  return gb;
}
function addMesh(geo, mat, parent = site, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  parent.add(m);
  return m;
}
function mesh(geo, mat, x, y, z, parent = scene, cast = true) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m; }
function texRepeat(t, u, v) { const c = t.clone(); c.needsUpdate = true; c.repeat.set(u, v); return c; }
function beam(p, q, w, h, mat, parent = site) {
  const d = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]), len = d.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
  m.position.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
  m.castShadow = true; parent.add(m);
  return m;
}
function hipRoofRect(x0, z0, x1, z1, y, rise, ov, mat, parent = site) {
  x0 -= ov; z0 -= ov; x1 += ov; z1 += ov;
  const w = x1 - x0, d = z1 - z0, gb = new GB(), r = Math.min(w, d) / 2;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ex = w / 2 - r, ez = d / 2 - r, yt = y + rise;
  const a = [x0, y, z0], b = [x1, y, z0], c = [x1, y, z1], e = [x0, y, z1];
  const r0 = [cx - ex, yt, cz - ez], r1 = [cx + ex, yt, cz - ez], r2 = [cx + ex, yt, cz + ez], r3 = [cx - ex, yt, cz + ez];
  const uv = (p) => [p[0] / 2 + p[2] / 2, p[1] / 2];
  gb.quad(a, b, r1, r0, uv(a), uv(b), uv(r1), uv(r0), [0, 1, 0]);
  gb.quad(b, c, r2, r1, uv(b), uv(c), uv(r2), uv(r1), [0, 1, 0]);
  gb.quad(c, e, r3, r2, uv(c), uv(e), uv(r3), uv(r2), [0, 1, 0]);
  gb.quad(e, a, r0, r3, uv(e), uv(a), uv(r0), uv(r3), [0, 1, 0]);
  return addMesh(gb.geo(), mat, parent);
}
// Arc-length parametrised polyline of [x, y, z] points for everything that moves.
class Path {
  constructor(pts) {
    this.p = pts; this.s = [0];
    for (let i = 1; i < pts.length; i++) this.s.push(this.s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
    this.len = this.s[this.s.length - 1];
  }
  at(s, o) {
    const S = this.s;
    s = Math.min(Math.max(s, 0), this.len);
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid] <= s) lo = mid; else hi = mid; }
    const a = this.p[lo], b = this.p[hi], seg = S[hi] - S[lo] || 1, t = (s - S[lo]) / seg;
    o.x = a[0] + (b[0] - a[0]) * t; o.y = a[1] + (b[1] - a[1]) * t; o.z = a[2] + (b[2] - a[2]) * t;
    o.dx = (b[0] - a[0]) / seg; o.dz = (b[2] - a[2]) / seg;
    return o;
  }
}

// Procedural facades for instanced unit boxes: window grid in metres from the instance scale,
// glass that reflects the sky, a shopfront band at street level, lit rooms after dark.
function facadeMat(key, S) {
  S = Object.assign({ floor: 3.2, bay: [2.6, 3.4], ww: [0.4, 0.55], wh: [0.48, 0.6], base: 1.0, glass: '#2b3238',
    roof: '#6e6c68', rough: 0.88, metal: 0.02, shop: 0, lit: 0.5 }, S);
  const f = (v) => v.toFixed(3);
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: S.rough, metalness: S.metal });
  m.extensions = { derivatives: true };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = NIGHT;
    sh.uniforms.uGlass = { value: lin(S.glass) };
    sh.uniforms.uRoof = { value: lin(S.roof) };
    sh.vertexShader = 'varying vec4 vFac;\nvarying float vSeed;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 sc = vec3(1.0), tr = vec3(0.0);
        #ifdef USE_INSTANCING
          sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          tr = instanceMatrix[3].xyz;
        #endif
        vec3 lp = position * sc;
        vFac = vec4((abs(normal.x) > 0.5 ? lp.z : lp.x) + 0.5 * (sc.x + sc.z), lp.y, normal.y, sc.y);
        vSeed = fract(sin(dot(tr.xz + tr.y, vec2(12.9898, 78.233))) * 43758.5453);
      }`);
    sh.fragmentShader = 'varying vec4 vFac;\nvarying float vSeed;\nuniform float uNight;\nuniform vec3 uGlass;\nuniform vec3 uRoof;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fWin = 0.0, fLit = 0.0;
        if (abs(vFac.z) < 0.5) {
          float fl = ${f(S.floor)} * (0.95 + 0.1 * fract(vSeed * 7.13));
          float bw = mix(${f(S.bay[0])}, ${f(S.bay[1])}, fract(vSeed * 13.71));
          float ww = mix(${f(S.ww[0])}, ${f(S.ww[1])}, fract(vSeed * 3.31));
          float wh = mix(${f(S.wh[0])}, ${f(S.wh[1])}, fract(vSeed * 5.93));
          float y = vFac.y - ${f(S.base)};
          vec2 cell = vec2(vFac.x / bw, y / fl);
          vec2 g = fract(cell), id = floor(cell);
          float w = step(abs(g.x - 0.5), ww * 0.5) * step(abs(g.y - 0.5), wh * 0.5);
          vec2 fw = fwidth(cell);
          w = mix(w, ww * wh, smoothstep(0.3, 0.8, max(fw.x, fw.y)));
          w *= step(0.0, y) * step(y, vFac.w - ${f(S.base)} - 0.9);
          float shop = ${f(S.shop)} * step(0.6, vFac.y) * step(vFac.y, ${f(S.base)} - 0.7) * step(0.12, fract(vFac.x / 4.0)) * step(6.0, vFac.w) * step(0.5, fract(vSeed * 23.1));
          fWin = max(w, shop);
          float pane = fract(sin(dot(id + vSeed * 17.0, vec2(127.1, 311.7))) * 43758.5453);
          diffuseColor.rgb = mix(diffuseColor.rgb, uGlass * (0.7 + 0.6 * pane), fWin);
          fLit = step(1.0 - ${f(S.lit)}, pane) * w + shop * 0.85;
          diffuseColor.rgb *= 0.76 + 0.24 * smoothstep(0.0, 4.0, vFac.y);
        } else if (vFac.z > 0.5) {
          diffuseColor.rgb = uRoof * (0.8 + 0.4 * vSeed);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.1, fWin);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.6, fWin);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.74, 0.44) * fLit * uNight * 0.65;`);
  };
  m.customProgramCacheKey = () => 'facade-' + key;
  return m;
}

// ---------------------------------------------------------------- terrain
function axis(segs) {
  const a = [];
  for (const [from, to, step] of segs) for (let v = from; v < to - 1e-6; v += step) a.push(v);
  a.push(segs[segs.length - 1][1]);
  return a;
}
const PAL = {};
Object.entries({
  yard: '#66704f', grass: '#6c8a44', grass2: '#5d7a3b', lawn: '#5f8f3e', forest: '#4a5a2c', bank: '#7f8a5a', mud: '#4a4636',
  sand: '#d2c49c', sand2: '#bfb08a', seabed: '#3e4c48', paving: '#8a857a', paving2: '#6f6a60'
}).forEach(([k, v]) => { PAL[k] = lin(v); });
const TC1 = new THREE.Color();
// How strongly the painted town, the painted woods and the painted fields show at each vertex.
let URB = 0, FOR = 0, FARM = 0, PATCH = 0;
function colorAt(x, z, h, slope, sd, riv, c, sp = 15) {
  const f1 = Math.max(170, sp * 3), f2 = Math.max(37, sp * 2.2);
  const n1 = fbm(x / f1, z / f1, 3), n2 = vnoise(x / f2, z / f2);
  const r = Math.hypot(x, z);
  const u = urbanAt(x, z);
  // Between the near buildings: gardens, yards and verges.
  c.copy(PAL.yard).lerp(PAL.grass, 0.5 + 0.5 * n1).lerp(PAL.grass2, smooth(0.2, 0.9, n2) * 0.4);
  URB = u * (0.3 + 0.66 * smooth(1300, 3000, r));
  FOR = woodsAt(x, z) * (1 - u);
  FARM = (1 - u) * (1 - FOR);
  // Which way the fields run: the plain is a patchwork of estates laid out at different angles.
  PATCH = smooth(-0.04, 0.04, fbm(x / 4200 + 9.1, z / 4200 - 3.3, 2));
  // Inside the old walls: cobbled streets, paved yards, little green.
  const od = ringD(x, z);
  if (od < RING_R + 40) { const k = 1 - smooth(RING_R - 60, RING_R + 40, od); c.lerp(PAL.paving, 0.7 * k).lerp(PAL.paving2, 0.3 * k * smooth(-0.2, 0.6, n2)); URB *= 1 - 0.6 * k; }
  if (inAny(x, z, PARKS)) { c.copy(PAL.lawn).lerp(PAL.forest, 0.3 + 0.3 * n1); URB = 0; FARM = 0; FOR = r < 2400 ? 0.15 : 0.7; }
  // The beaches, and the sea floor under the water.
  if (sd < 320) {
    const b = 1 - smooth(60, 320, sd);
    c.lerp(PAL.sand, b).lerp(PAL.sand2, b * smooth(0, 1, n2) * 0.5);
    if (sd < 0) c.lerp(PAL.seabed, smooth(0, -400, sd));
    URB *= 1 - b; FOR *= 1 - b; FARM *= 1 - b;
  }
  if (riv < 14) {
    c.lerp(PAL.bank, 1 - smooth(3, 14, riv));
    if (riv < 1) c.lerp(PAL.mud, 1 - smooth(-4, 1, riv));
    URB *= smooth(5, 14, riv); FOR *= smooth(5, 14, riv); FARM *= smooth(5, 14, riv);
  }
  return c;
}
function buildTerrain() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const city = cityTexture(), forest = forestTexture(), farm = farmTexture();
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCity = { value: city };
    sh.uniforms.uForest = { value: forest };
    sh.uniforms.uFarm = { value: farm };
    sh.vertexShader = 'attribute float urb;\nattribute float forest;\nattribute float farm;\nattribute float fieldDir;\nvarying float vUrb;\nvarying float vFor;\nvarying float vFarm;\nvarying float vPatch;\nvarying vec2 vXZ;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvUrb = urb; vFor = forest; vFarm = farm; vPatch = fieldDir; vXZ = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = 'uniform sampler2D uCity;\nuniform sampler2D uForest;\nuniform sampler2D uFarm;\nvarying float vUrb;\nvarying float vFor;\nvarying float vFarm;\nvarying float vPatch;\nvarying vec2 vXZ;\n' + sh.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\nif (vUrb > 0.01) { vec3 ct = pow(texture2D(uCity, mat2(0.97, 0.24, -0.24, 0.97) * vXZ / 300.0).rgb, vec3(2.2)); diffuseColor.rgb = mix(diffuseColor.rgb, ct, vUrb); }' +
      '\nif (vFarm > 0.01) { float pm = smoothstep(0.35, 0.65, vPatch);' +
      ' vec3 fa = texture2D(uFarm, mat2(0.95, 0.31, -0.31, 0.95) * vXZ / 3600.0 + 0.37).rgb, fb = texture2D(uFarm, mat2(0.6, -0.8, 0.8, 0.6) * vXZ / 3300.0 + 0.71).rgb;' +
      ' vec3 ft = pow(mix(fa, fb, pm), vec3(2.2));' +
      ' float v = texture2D(uFarm, mat2(0.6, 0.8, -0.8, 0.6) * vXZ / 9100.0).r / 0.5;' +
      ' diffuseColor.rgb = mix(diffuseColor.rgb, ft * clamp(0.85 + 0.2 * v, 0.8, 1.2), vFarm); }' +
      '\nif (vFor > 0.01) { vec3 wt = pow(texture2D(uForest, vXZ / 700.0 + 0.21).rgb, vec3(2.2)); diffuseColor.rgb = mix(diffuseColor.rgb, wt, vFor); }');
  };
  mat.customProgramCacheKey = () => 'terrain-lund';
  // A fine patch over the arena and the town round it, and a coarser grid out to the horizon.
  const NEAR = 3600;
  terrainGrid(axis([[-NEAR, -2000, 20], [-2000, 1800, 10], [1800, NEAR, 20]]), axis([[-NEAR, -2600, 20], [-2600, 1900, 10], [1900, NEAR, 20]]), mat, null, true);
  const mid = [[-80000, -36000, 2000], [-36000, 36000, 150], [36000, 80000, 2000]];
  terrainGrid(axis(mid), axis(mid), mat, (x0, z0, x1, z1) => x0 >= -NEAR && x1 <= NEAR && z0 >= -NEAR && z1 <= NEAR, false);
}
function terrainGrid(XS, ZS, mat, skip, skirt) {
  const NX = XS.length, NZ = ZS.length, N = NX * NZ, UW = new Float32Array(N), FW = new Float32Array(N), AW = new Float32Array(N), PW = new Float32Array(N);
  const H = new Float32Array(N), META = new Float32Array(N * 2);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      H[k] = landHeight(XS[i], ZS[j]);
      META[k * 2] = G.sd; META[k * 2 + 1] = G.riv;
    }
  }
  const NRM = new Float32Array(N * 3), COL = new Float32Array(N * 3);
  for (let j = 0; j < NZ; j++) {
    const j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, NZ - 1);
    for (let i = 0; i < NX; i++) {
      const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, NX - 1), k = j * NX + i;
      const sx = XS[i1] - XS[i0], sz = ZS[j1] - ZS[j0];
      const dhdx = (H[j * NX + i1] - H[j * NX + i0]) / sx;
      const dhdz = (H[j1 * NX + i] - H[j0 * NX + i]) / sz;
      const l = Math.hypot(dhdx, 1, dhdz);
      NRM[k * 3] = -dhdx / l; NRM[k * 3 + 1] = 1 / l; NRM[k * 3 + 2] = -dhdz / l;
      colorAt(XS[i], ZS[j], H[k], Math.hypot(dhdx, dhdz), META[k * 2], META[k * 2 + 1], TC1, (sx + sz) / 4);
      COL[k * 3] = TC1.r; COL[k * 3 + 1] = TC1.g; COL[k * 3 + 2] = TC1.b; UW[k] = URB; FW[k] = FOR; AW[k] = FARM; PW[k] = PATCH;
    }
  }
  const T = 90;
  for (let tj = 0; tj < NZ - 1; tj += T) {
    for (let ti = 0; ti < NX - 1; ti += T) {
      const ie = Math.min(ti + T, NX - 1), je = Math.min(tj + T, NZ - 1);
      const w = ie - ti + 1, h = je - tj + 1;
      const quads = [];
      for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
        const gi = ti + i, gj = tj + j;
        if (skip && skip(XS[gi], ZS[gj], XS[gi + 1], ZS[gj + 1])) continue;
        quads.push(j * w + i);
      }
      if (!quads.length) continue;
      const pos = new Float32Array(w * h * 3), nor = new Float32Array(w * h * 3), col = new Float32Array(w * h * 3);
      const urb = new Float32Array(w * h), fo = new Float32Array(w * h), fa = new Float32Array(w * h), pa = new Float32Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = (tj + j) * NX + (ti + i), o = (j * w + i) * 3, q = j * w + i;
        urb[q] = UW[k]; fo[q] = FW[k]; fa[q] = AW[k]; pa[q] = PW[k];
        pos[o] = XS[ti + i]; pos[o + 1] = H[k]; pos[o + 2] = ZS[tj + j];
        nor[o] = NRM[k * 3]; nor[o + 1] = NRM[k * 3 + 1]; nor[o + 2] = NRM[k * 3 + 2];
        col[o] = COL[k * 3]; col[o + 1] = COL[k * 3 + 1]; col[o + 2] = COL[k * 3 + 2];
      }
      const idx = new Uint16Array(quads.length * 6);
      let q = 0;
      for (const a of quads) {
        const b = a + 1, c = a + w, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('urb', new THREE.BufferAttribute(urb, 1));
      g.setAttribute('forest', new THREE.BufferAttribute(fo, 1));
      g.setAttribute('farm', new THREE.BufferAttribute(fa, 1));
      g.setAttribute('fieldDir', new THREE.BufferAttribute(pa, 1));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      scene.add(m);
    }
  }
  if (skirt) {
    // A short curtain round the fine patch hides hairline cracks against the coarse grid.
    const pos = [], col = [], zero = [];
    const ring = [];
    for (let i = 0; i < NX; i++) ring.push(i);
    for (let j = 1; j < NZ; j++) ring.push(j * NX + NX - 1);
    for (let i = NX - 2; i >= 0; i--) ring.push((NZ - 1) * NX + i);
    for (let j = NZ - 2; j >= 0; j--) ring.push(j * NX);
    for (let r = 0; r < ring.length - 1; r++) {
      const a = ring[r], b = ring[r + 1];
      const ax = XS[a % NX], az = ZS[Math.floor(a / NX)], bx = XS[b % NX], bz = ZS[Math.floor(b / NX)];
      const P = [[ax, H[a], az], [bx, H[b], bz], [bx, H[b] - 4, bz], [ax, H[a], az], [bx, H[b] - 4, bz], [ax, H[a] - 4, az]];
      const C = [a, b, b, a, b, a];
      P.forEach((p, n) => { pos.push(...p); col.push(COL[C[n] * 3], COL[C[n] * 3 + 1], COL[C[n] * 3 + 2]); zero.push(0); });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    ['urb', 'forest', 'farm', 'fieldDir'].forEach((k) => g.setAttribute(k, new THREE.Float32BufferAttribute(zero, 1)));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat.clone());
    m.material.side = THREE.DoubleSide; m.material.onBeforeCompile = mat.onBeforeCompile; m.material.customProgramCacheKey = () => 'terrain-skirt';
    scene.add(m);
  }
}

// 700 m of beech wood in October from the air: round crowns turning gold and copper, dark spruce among them.
function forestTexture() {
  const r = mulberry32(1554);
  const t = canvasTex(1024, 1024, (g, w) => {
    g.fillStyle = '#4a5228'; g.fillRect(0, 0, w, w);
    const COLS = ['#4f6a2c', '#5e7430', '#7a7a2e', '#9a8430', '#b0862e', '#a0602a', '#8a4e24', '#3d5a2a', '#6c7a34', '#c49a3a'];
    for (let i = 0; i < 9000; i++) {
      const x = r() * w, y = r() * w, rr = 3 + r() * 7;
      g.fillStyle = 'rgba(12,16,8,0.35)'; g.beginPath(); g.arc(x + rr * 0.3, y + rr * 0.3, rr, 0, Math.PI * 2); g.fill();
      g.fillStyle = r() < 0.16 ? '#24381f' : COLS[Math.floor(r() * COLS.length)]; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
    }
  });
  t.encoding = THREE.LinearEncoding;
  t.anisotropy = Math.min(16, MAX_ANISO);
  return t;
}
// 300 m of Lund from the air: red tile, black glazed tile and grey roofs, green gardens and yards, street trees.
function cityTexture() {
  const r = mulberry32(4242), P = (a) => a[Math.floor(r() * a.length)];
  const t = canvasTex(1024, 1024, (g, w) => {
    const m = w / 300;
    g.fillStyle = '#6f7258'; g.fillRect(0, 0, w, w);
    for (let by = 0; by < 300; by += 100) for (let bx = 0; bx < 300; bx += 75) {
      g.fillStyle = P(['#5f7a3e', '#6a8443', '#56703a']); g.fillRect((bx + 4) * m, (by + 4) * m, 67 * m, 92 * m);
      for (let y = by + 6; y < by + 92; y += 15 + r() * 6) for (let x = bx + 5; x < bx + 68; x += 11 + r() * 5) {
        if (r() < 0.2) continue;
        g.fillStyle = P(['#8e3b2a', '#9c4630', '#7a3226', '#2c2c2e', '#38383a', '#55585a', '#a34d33', '#6e6c68', '#8a5040', '#c9c4b8']);
        g.fillRect(x * m, y * m, (8 + r() * 4) * m, (9 + r() * 3) * m);
        g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x * m, y * m, (8 + r() * 4) * m, 1.2 * m);
      }
    }
    g.fillStyle = '#5c5d5a';
    for (let y = 0; y < 300; y += 100) g.fillRect(0, (y - 2.5) * m, w, 5 * m);
    for (let x = 0; x < 300; x += 75) g.fillRect((x - 2.5) * m, 0, 5 * m, w);
    for (let i = 0; i < 380; i++) { const x = r() * w, y = r() * w, rr = (2.5 + r() * 4) * m; g.fillStyle = P(['#4a6a33', '#5a7a3a', '#8a8a34', '#a0782e', '#3f5e2e']); g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill(); }
  });
  t.encoding = THREE.LinearEncoding;
  t.anisotropy = Math.min(16, MAX_ANISO);
  return t;
}
// 2.6 km of the Skåne plain from the air in early October: big fields of stubble, fresh ploughland, winter wheat
// coming up green, sugar beet still in the ground; farm tracks, hedges and lines of trees, a farmstead here and there.
function farmTexture() {
  const r = mulberry32(5521);
  const t = canvasTex(1024, 1024, (g, w) => {
    const COLS = [['#c9b27a', 3], ['#bda66c', 3], ['#d4c08a', 2], ['#6e5a44', 2.5], ['#5c4a38', 2], ['#7d6750', 1.2], ['#73903f', 2], ['#82a04c', 1],
      ['#3f6a2c', 1.6], ['#8aa05a', 1], ['#a99a6a', 1]];
    const tot = COLS.reduce((a, c) => a + c[1], 0);
    const pc = () => { let x = r() * tot; for (const [c, k] of COLS) { x -= k; if (x <= 0) return c; } return COLS[0][0]; };
    g.fillStyle = '#7d7050'; g.fillRect(0, 0, w, w);
    const fields = [];
    const split = (x, y, ww, hh, depth) => {
      const big = Math.max(ww, hh);
      if (depth < 7 && (big > 190 || (big > 90 && r() < 0.5))) {
        const t2 = 0.3 + 0.4 * r();
        if (ww > hh) { split(x, y, ww * t2, hh, depth + 1); split(x + ww * t2, y, ww * (1 - t2), hh, depth + 1); }
        else { split(x, y, ww, hh * t2, depth + 1); split(x, y + hh * t2, ww, hh * (1 - t2), depth + 1); }
        return;
      }
      fields.push([x, y, ww, hh]);
    };
    split(0, 0, w, w, 0);
    fields.forEach(([x, y, ww, hh]) => {
      g.fillStyle = pc(); g.fillRect(x, y, ww, hh);
      // Drill rows along the field's length, and tramlines.
      g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 1;
      if (ww > hh) for (let yy = y + 2; yy < y + hh; yy += 3) { g.beginPath(); g.moveTo(x, yy); g.lineTo(x + ww, yy); g.stroke(); }
      else for (let xx = x + 2; xx < x + ww; xx += 3) { g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + hh); g.stroke(); }
      g.strokeStyle = 'rgba(255,250,220,0.10)'; g.lineWidth = 1.5;
      if (ww > hh) for (let yy = y + 9; yy < y + hh; yy += 22) { g.beginPath(); g.moveTo(x, yy); g.lineTo(x + ww, yy); g.stroke(); }
      else for (let xx = x + 9; xx < x + ww; xx += 22) { g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + hh); g.stroke(); }
      // Field margins: a grass strip, sometimes a hedge or a line of willows.
      g.strokeStyle = 'rgba(70,90,40,0.75)'; g.lineWidth = 1.6; g.strokeRect(x + 0.5, y + 0.5, ww - 1, hh - 1);
      if (r() < 0.3) {
        const side = Math.floor(r() * 4);
        for (let k = 0; k < 40; k++) {
          const tt = k / 40, px = side < 2 ? x + tt * ww : (side === 2 ? x : x + ww), py = side >= 2 ? y + tt * hh : (side === 0 ? y : y + hh);
          g.fillStyle = r() < 0.5 ? '#3f5a2a' : '#6a6a2e'; g.beginPath(); g.arc(px, py, 1.6 + r() * 1.6, 0, Math.PI * 2); g.fill();
        }
      }
      // A farmstead: four wings round a yard, white walls, dark roofs, a clump of trees.
      if (r() < 0.07 && ww > 40 && hh > 40) {
        const fx = x + 8 + r() * (ww - 26), fy = y + 8 + r() * (hh - 26);
        g.fillStyle = '#3c5a2a'; g.beginPath(); g.arc(fx + 14, fy + 3, 9, 0, Math.PI * 2); g.fill();
        g.fillStyle = r() < 0.5 ? '#3a3a3a' : '#8e3b2a';
        g.fillRect(fx, fy, 14, 3); g.fillRect(fx, fy + 11, 14, 3); g.fillRect(fx, fy, 3, 14); g.fillRect(fx + 11, fy, 3, 14);
      }
    });
    // Farm tracks.
    g.strokeStyle = 'rgba(205,190,150,0.8)'; g.lineWidth = 2;
    for (let i = 0; i < 6; i++) { const f = fields[Math.floor(r() * fields.length)]; g.beginPath(); g.moveTo(f[0], f[1] + f[3] / 2); g.lineTo(f[0] + f[2], f[1] + f[3] / 2); g.stroke(); }
  });
  t.encoding = THREE.LinearEncoding;
  t.anisotropy = Math.min(16, MAX_ANISO);
  return t;
}

// ---------------------------------------------------------------- water
function waterNormals(size = 256) {
  const r = mulberry32(7), waves = [];
  for (let i = 0; i < 30; i++) {
    const span = 2 + i * 0.9;
    const kx = Math.round((r() * 2 - 1) * span), ky = Math.round((r() * 2 - 1) * span);
    if (!kx && !ky) continue;
    waves.push([kx, ky, 1 / Math.pow(Math.hypot(kx, ky), 1.35), r() * Math.PI * 2]);
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let dx = 0, dy = 0;
    const u = x / size, v = y / size;
    for (const [kx, ky, a, p] of waves) { const c = Math.cos(2 * Math.PI * (kx * u + ky * v) + p) * a * 2 * Math.PI; dx += c * kx; dy += c * ky; }
    const nx = -dx * 0.018, ny = -dy * 0.018, l = Math.hypot(nx, ny, 1), o = (y * size + x) * 4;
    data[o] = (nx / l * 0.5 + 0.5) * 255; data[o + 1] = (ny / l * 0.5 + 0.5) * 255; data[o + 2] = (1 / l * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = Math.min(8, MAX_ANISO);
  t.needsUpdate = true;
  return t;
}
let WATER_N = [];
let waterMat;
function buildWater() {
  const base = waterNormals(256);
  const nm = (u, v) => { const t = base.clone(); t.needsUpdate = true; t.repeat.set(u, v); WATER_N.push(t); return t; };
  // The Öresund: one sheet of water at sea level west of the shore.
  const sea = std('#2b4552', { roughness: 0.1, metalness: 0, normalMap: nm(900, 1800), normalScale: new THREE.Vector2(0.35, 0.35) });
  const sp = new THREE.Mesh(new THREE.PlaneGeometry(76000, 160000).rotateX(-Math.PI / 2), sea);
  sp.position.set(-42000, SEA_Y, 0); sp.receiveShadow = true; scene.add(sp);
  // Höje å: carved into the fine patch near the town, lying on the ground beyond it.
  waterMat = std('#33433a', { roughness: 0.22, metalness: 0, normalMap: nm(1, 1), normalScale: new THREE.Vector2(0.2, 0.2) });
  RIVERS.forEach((rv) => {
    const pts = rv.line.map(([x, z]) => [x, baseHeight(x, z) + (Math.abs(x) < 3550 && Math.abs(z) < 3550 ? -1.25 : 0.25), z]);
    ribbon(pts, rv.half * 2 + 3, 0, waterMat, 30);
  });
  // Ponds in Stadsparken and the botanical garden.
  [[-505, -60, 46, 26, 0.3], [640, -900, 30, 18, -0.4]].forEach(([x, z, a, b, ry]) => {
    const p = mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), waterMat, x, baseHeight(x, z) + 0.12, z, scene, false);
    p.scale.set(a, 1, b); p.rotation.y = ry;
    occMark(x, z, a * 2 + 4, b * 2 + 4, ry);
  });
}

// ---------------------------------------------------------------- textures
let TEX = {};
const DECO = `'Limelight', 'Josefin Sans', Georgia, serif`;
const SANS = `'Josefin Sans', 'Arial Narrow', Arial, sans-serif`;
const WALL_H = 22.8;   // the drum's wall, from the plinth to the cornice
function goldGradient(g, y0, y1) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, '#fff0b8'); gr.addColorStop(0.45, '#e2b447'); gr.addColorStop(0.55, '#b8862a'); gr.addColorStop(1, '#f0c860');
  return gr;
}
function makeTextures() {
  TEX.asphalt = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4a4a49'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 5000, ['#403f3e', '#555452', '#5c5a57', '#626059'], 2);
  });
  // Street, 12 m: one lane each way, a dashed white centre line (Swedish markings are white), granite kerbs.
  TEX.road = canvasTex(192, 192, (g, w, h) => {
    const m = w / 12;
    g.fillStyle = '#4a4a49'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2600, ['#403f3e', '#555452', '#626059'], 2);
    g.fillStyle = '#a9a69e'; g.fillRect(0, 0, 0.25 * m, h); g.fillRect(w - 0.25 * m, 0, 0.25 * m, h);
    g.fillStyle = '#e9e8e2'; g.fillRect(6 * m - 1.5, 0, 3, h * 0.25);
  });
  // Avenue, 22 m: two lanes each way either side of a 7 m planted median.
  TEX.dual = canvasTex(352, 192, (g, w, h) => {
    const m = 16;
    g.fillStyle = '#4c4c4a'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 4500, ['#424240', '#575654', '#63625d'], 2);
    g.fillStyle = '#5f7a3c'; g.fillRect(7.5 * m, 0, 7 * m, h);
    g.fillStyle = '#bdbab2'; g.fillRect(7.3 * m, 0, 0.25 * m, h); g.fillRect(14.45 * m, 0, 0.25 * m, h);
    g.fillStyle = '#ecebe6';
    [3.9, 18.1].forEach((u) => { g.fillRect(u * m - 1, 0, 2, h * 0.25); g.fillRect(u * m - 1, h * 0.5, 2, h * 0.25); });
    g.fillRect(0.6 * m, 0, 2, h); g.fillRect(21.4 * m - 2, 0, 2, h);
  });
  // Motorway, 26 m: two lanes each way, hard shoulders, a steel barrier down the middle.
  TEX.mway = canvasTex(416, 256, (g, w, h) => {
    const m = 16;
    g.fillStyle = '#4b4b49'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 7000, ['#414140', '#565553', '#61605b', '#3c3c3b'], 2);
    g.fillStyle = '#5c6e3a'; g.fillRect(12 * m, 0, 2 * m, h);
    g.fillStyle = '#c9c6be'; g.fillRect(12.85 * m, 0, 0.3 * m, h);
    g.fillStyle = '#ecebe6';
    [2.9, 11.1, 14.9, 23.1].forEach((u) => g.fillRect(u * m - 1.5, 0, 3, h));
    [7.0, 19.0].forEach((u) => { g.fillRect(u * m - 1, 0, 2, h * 0.25); g.fillRect(u * m - 1, h * 0.5, 2, h * 0.25); });
  });
  // Pavement and cycle path along the roads: grey flags, then the red asphalt of the cycle lane.
  TEX.walk = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#a9a69f'; g.fillRect(0, 0, w / 2, h);
    speckle(g, w / 2, h, 700, ['#9e9b94', '#b3b0a8', '#98958e'], 1);
    g.fillStyle = 'rgba(60,60,55,0.35)'; for (let i = 0; i < 4; i++) g.fillRect(0, i * 32, w / 2, 1);
    g.fillStyle = '#8a5048'; g.fillRect(w / 2, 0, w / 2, h);
    speckle(g, w / 2, h, 700, ['#7e463f', '#965a50', '#84504a'], 1);
    for (let i = 0; i < 700; i++) { g.fillStyle = pick(['#7e463f', '#965a50']); g.fillRect(w / 2 + rand() * w / 2, rand() * h, 1, 1); }
    g.fillStyle = '#d8d6d0'; g.fillRect(w / 2, 0, 2, h);
  });
  // Parking module: two 2.5 m bays across, 5 m bay + 6 m aisle + 5 m bay along; 40 px/m.
  TEX.parking = canvasTex(200, 640, (g, w, h) => {
    g.fillStyle = '#4d4c4a'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 4500, ['#434240', '#575654', '#5f5d59'], 2);
    g.fillStyle = 'rgba(15,15,15,0.16)';
    [50, 150].forEach((x) => [100, 540].forEach((y) => { g.beginPath(); g.ellipse(x, y, 22, 36, 0, 0, Math.PI * 2); g.fill(); }));
    g.fillStyle = '#ecebe6';
    [0, 100].forEach((x) => { g.fillRect(x, 0, 4, 200); g.fillRect(x, 440, 4, 200); });
  }, { flipY: false });
  // The plaza: art déco terrazzo, 16 m to the tile: cream, with warm grey diamonds edged in black and brass, a black star at
  // each diamond's heart and small brass roundels where the tiles meet.
  TEX.terrazzo = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#ddd6c6'; g.fillRect(0, 0, w, h);
    const dia = (k) => { g.beginPath(); g.moveTo(w / 2, k); g.lineTo(w - k, h / 2); g.lineTo(w / 2, h - k); g.lineTo(k, h / 2); g.closePath(); };
    g.fillStyle = '#c4b9a4'; dia(10); g.fill();
    g.strokeStyle = '#2b2d2c'; g.lineWidth = 7; dia(10); g.stroke();
    g.strokeStyle = '#b48c3e'; g.lineWidth = 3; dia(26); g.stroke();
    g.fillStyle = '#2b2d2c'; g.beginPath();
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, r = k % 2 ? 14 : 34; g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.save(); g.beginPath(); g.rect(0, 0, w, h); g.clip();
    [[0, 0], [w, 0], [0, h], [w, h]].forEach(([cx, cy]) => {
      g.fillStyle = '#b48c3e'; g.beginPath(); g.arc(cx, cy, 30, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2b2d2c'; g.beginPath(); g.arc(cx, cy, 16, 0, Math.PI * 2); g.fill();
    });
    g.restore();
    g.strokeStyle = 'rgba(40,40,40,0.35)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
    for (let i = 0; i < 22000; i++) { g.fillStyle = pick(['rgba(0,0,0,0.08)', 'rgba(120,100,60,0.10)', 'rgba(255,255,255,0.16)', 'rgba(40,60,50,0.08)']); g.fillRect(rand() * w, rand() * h, 2, 2); }
  });
  // Cobbles for the old town's squares.
  TEX.cobble = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#7e7a72'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < w; x += 8) { g.fillStyle = pick(['#8c877e', '#99938a', '#6f6b64', '#a39c90', '#86817a']); g.fillRect(x + 1, y + 1, 6.5, 6.5); }
  });
  TEX.sidewalk = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#a9a69f'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1400, ['#9e9b94', '#b3b0a8', '#98958e'], 1);
    g.fillStyle = 'rgba(60,60,55,0.35)'; for (let i = 0; i < 4; i++) { g.fillRect(i * 32, 0, 1, h); g.fillRect(0, i * 32, w, 1); }
  });
  TEX.grass = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#57743a'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 9000, ['#4f6c34', '#61803f', '#4a6630', '#6a8444', '#76844a', '#5c6a3a'], 2);
  });
  TEX.trackbed = canvasTex(176, 96, (g, w, h) => {
    g.fillStyle = '#6f6860'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 5000, ['#625b53', '#7f776d', '#8a8276', '#5a544d'], 2);
    g.fillStyle = '#7d6a58';
    [5.5 - 2.3, 5.5 + 2.3].forEach((c) => { for (let y = 2; y < h; y += 9.6) g.fillRect((c - 1.3) * 16, y, 2.6 * 16, 4); });
  });
  // The tram runs on a green track: sedum between the rails.
  TEX.tramGreen = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#6a7d3a'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 4000, ['#7a8a3e', '#5e7034', '#8a7a3a', '#a06a3a'], 2);
  });
  // Glazing for the station, the greenhouses and the arena's lantern, and the light inside it after dark.
  TEX.glassGrid = canvasTex(512, 320, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#6a7a80'); gr.addColorStop(1, '#2f3a3f');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 20; i++) for (let j = 0; j < 4; j++) { g.fillStyle = `rgba(255,255,255,${0.02 + rand() * 0.07})`; g.fillRect(i * 25.6 + 2, j * 80 + 2, 21.6, 76); }
    g.fillStyle = '#2a2a28'; for (let x = 0; x < w; x += 25.6) g.fillRect(x, 0, 2.5, h); for (let y = 0; y < h; y += 80) g.fillRect(0, y, w, 3);
  });
  TEX.glassGridE = canvasTex(512, 320, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 20; i++) for (let j = 0; j < 4; j++) { g.fillStyle = `rgba(255,${200 + Math.floor(rand() * 40)},${140 + Math.floor(rand() * 50)},${0.4 + rand() * 0.5})`; g.fillRect(i * 25.6 + 3, j * 80 + 3, 20, 74); }
  });
  TEX.granite = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#121212'; g.fillRect(0, 0, w, h); speckle(g, w, h, 1500, ['#1e1e1e', '#2a2a2a', '#0a0a0a', '#3a3a3a'], 1); });
  // Romanesque sandstone, 8 m x 10 m to the tile: coursed blocks, a round-arched window, a band of little arches under the eaves.
  TEX.romanesque = canvasTex(256, 320, (g, w, h) => {
    const m = w / 8;
    g.fillStyle = '#b9ad96'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 0.45 * m) {
      const off = (y / (0.45 * m)) % 2 ? 0.6 * m : 0;
      for (let x = -off; x < w; x += 1.2 * m) { g.fillStyle = pick(['#b4a78f', '#c1b59d', '#ab9e86', '#bcb098', '#a89b84']); g.fillRect(x + 1, y + 1, 1.2 * m - 2, 0.45 * m - 2); }
    }
    g.fillStyle = '#2e2b26';
    const wx = w / 2, wy = h - 7 * m;
    g.fillRect(wx - 0.6 * m, wy, 1.2 * m, 2.6 * m); g.beginPath(); g.arc(wx, wy, 0.6 * m, Math.PI, 0); g.fill();
    g.strokeStyle = '#d0c4ab'; g.lineWidth = 3; g.beginPath(); g.arc(wx, wy, 0.85 * m, Math.PI, 0); g.stroke();
    g.strokeStyle = 'rgba(60,50,40,0.6)'; g.lineWidth = 2;
    for (let x = 0; x < w; x += 0.8 * m) { g.beginPath(); g.arc(x + 0.4 * m, 0.7 * m, 0.38 * m, Math.PI, 0); g.stroke(); }
    g.fillStyle = 'rgba(60,50,40,0.25)'; g.fillRect(0, 0.75 * m, w, 3);
  });
  TEX.brick = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8a4636'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 ? -8 : 0; x < w; x += 16) { g.fillStyle = pick(['#934a38', '#7e3c2e', '#a05540', '#86432f', '#9a4e3c']); g.fillRect(x + 1, y + 1, 14, 6); }
  });
  // ---- the arena's surfaces
  // One 6 m bay of the drum, plinth to cornice: ivory limestone in courses, a tall window with a stepped head and bronze
  // mullions, a black spandrel with a gold chevron below it, a gold chevron panel and three speed lines above.
  const X = (mm, w) => mm / 6 * w, Y = (mm, h) => (1 - mm / WALL_H) * h;
  const win = [[1.7, 4.3, 2.4, 17.0], [2.15, 3.85, 17.0, 17.7], [2.55, 3.45, 17.7, 18.3]];
  TEX.deco = canvasTex(256, 1024, (g, w, h) => {
    g.fillStyle = '#e6dcc6'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 6000, ['#ddd2ba', '#ede5d2', '#d8ccb2'], 2);
    g.fillStyle = 'rgba(90,70,40,0.10)'; for (let mm = 0; mm < WALL_H; mm += 0.75) g.fillRect(0, Y(mm, h), w, 1.5);
    // Shadowed reveal round the window, then the glass.
    win.forEach(([x0, x1, y0, y1]) => { g.fillStyle = '#4c4436'; g.fillRect(X(x0, w) - 5, Y(y1, h) - 5, X(x1 - x0, w) + 10, Y(y0, h) - Y(y1, h) + 10); });
    win.forEach(([x0, x1, y0, y1]) => {
      const gr = g.createLinearGradient(0, Y(y1, h), 0, Y(y0, h)); gr.addColorStop(0, '#41505a'); gr.addColorStop(1, '#262c30');
      g.fillStyle = gr; g.fillRect(X(x0, w), Y(y1, h), X(x1 - x0, w), Y(y0, h) - Y(y1, h));
    });
    g.fillStyle = '#6b5a36';
    [2.57, 3.43].forEach((mm) => g.fillRect(X(mm, w) - 2, Y(18.3, h), 4, Y(2.4, h) - Y(18.3, h)));
    for (let mm = 3.6; mm < 17; mm += 1.2) g.fillRect(X(1.7, w), Y(mm, h) - 1.5, X(2.6, w), 3);
    // Spandrel below the window.
    g.fillStyle = '#1d2723'; g.fillRect(X(1.5, w), Y(2.2, h), X(3.0, w), Y(0.9, h) - Y(2.2, h));
    g.strokeStyle = '#d0a446'; g.lineWidth = 4; g.beginPath();
    for (let k = 0; k <= 6; k++) g.lineTo(X(1.7 + k * 0.433, w), Y(k % 2 ? 1.95 : 1.15, h)); g.stroke();
    // Chevron panel over the window, and the three speed lines under the cornice.
    g.fillStyle = '#1d2723'; g.fillRect(X(0.9, w), Y(21.0, h), X(4.2, w), Y(18.9, h) - Y(21.0, h));
    g.fillStyle = goldGradient(g, Y(21.0, h), Y(18.9, h));
    for (let k = 0; k < 3; k++) {
      const cy = 20.6 - k * 0.55;
      g.beginPath(); g.moveTo(X(1.1, w), Y(cy - 0.35, h)); g.lineTo(X(3, w), Y(cy, h)); g.lineTo(X(4.9, w), Y(cy - 0.35, h));
      g.lineTo(X(4.9, w), Y(cy - 0.6, h)); g.lineTo(X(3, w), Y(cy - 0.25, h)); g.lineTo(X(1.1, w), Y(cy - 0.6, h)); g.closePath(); g.fill();
    }
    g.fillStyle = '#c9a04a'; [21.45, 21.85, 22.25].forEach((mm) => g.fillRect(0, Y(mm, h), w, 3));
    // A dark plinth course at the foot.
    g.fillStyle = '#2a2a28'; g.fillRect(0, Y(0.5, h), w, h - Y(0.5, h));
  });
  TEX.decoE = canvasTex(256, 1024, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let mm = 2.4; mm < 18.3; mm += 1.2) {
      const [x0, x1] = mm < 17 ? [1.7, 4.3] : mm < 17.7 ? [2.15, 3.85] : [2.55, 3.45];
      g.fillStyle = `rgba(255,${190 + Math.floor(rand() * 40)},${110 + Math.floor(rand() * 50)},${0.55 + rand() * 0.4})`;
      g.fillRect(X(x0, w) + 1, Y(Math.min(mm + 1.2, 18.3), h) + 2, X(x1 - x0, w) - 2, Y(mm, h) - Y(Math.min(mm + 1.2, 18.3), h) - 4);
    }
  });
  // The second tier: a deep green band with a lit slot window between gold zigzag columns, 4 m to the bay.
  TEX.frieze = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#1b2925'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e6dcc6'; g.fillRect(0, 0, w, 24); g.fillRect(0, h - 24, w, 24);
    g.fillStyle = '#c9a04a'; g.fillRect(0, 26, w, 5); g.fillRect(0, h - 31, w, 5);
    g.fillStyle = '#2a3236'; g.fillRect(w / 2 - 34, 70, 68, h - 140);
    g.fillStyle = '#3d4b52'; g.fillRect(w / 2 - 28, 76, 56, h - 152);
    g.strokeStyle = '#d4a848'; g.lineWidth = 5;
    [w * 0.14, w * 0.86].forEach((cx) => { g.beginPath(); for (let k = 0; k <= 12; k++) g.lineTo(cx + (k % 2 ? 16 : -16), 50 + k * (h - 100) / 12); g.stroke(); });
  });
  TEX.friezeE = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,214,150,0.9)'; g.fillRect(w / 2 - 28, 76, 56, h - 152);
    g.fillStyle = 'rgba(255,190,90,0.55)';
    [w * 0.14, w * 0.86].forEach((cx) => { g.strokeStyle = 'rgba(255,200,110,0.6)'; g.lineWidth = 4; g.beginPath(); for (let k = 0; k <= 12; k++) g.lineTo(cx + (k % 2 ? 16 : -16), 50 + k * (h - 100) / 12); g.stroke(); });
  });
  // Fluted ivory for the third tier and the entrance tower, 3 m to the tile.
  TEX.fluted = canvasTex(192, 192, (g, w, h) => {
    g.fillStyle = '#e8dfca'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1800, ['#ddd2ba', '#efe7d4', '#d8ccb2'], 2);
    for (let k = 0; k < 6; k++) {
      const x0 = k * w / 6, gr = g.createLinearGradient(x0, 0, x0 + w / 6, 0);
      gr.addColorStop(0, 'rgba(70,55,30,0.18)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.8, 'rgba(70,55,30,0.05)'); gr.addColorStop(1, 'rgba(70,55,30,0.2)');
      g.fillStyle = gr; g.fillRect(x0, 0, w / 6, h);
    }
    g.fillStyle = 'rgba(90,70,40,0.10)'; g.fillRect(0, h / 2, w, 1.5);
  });
  // Verdigris copper for the dome, one rib to the tile across.
  TEX.copper = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5f9c87'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 9000, ['#538d79', '#6aa893', '#79b39e', '#4a7f6d', '#86bca6'], 3);
    for (let i = 0; i < 70; i++) { g.fillStyle = 'rgba(40,70,60,0.12)'; g.fillRect(rand() * w, 0, 2 + rand() * 4, h); }
    g.fillStyle = 'rgba(30,60,50,0.18)'; for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 2);
    g.fillStyle = '#2f5a4c'; g.fillRect(0, 0, 10, h);
    g.fillStyle = '#9cc9b6'; g.fillRect(10, 0, 4, h);
  });
  // The sunburst over the doors: gold rays fanning out of a half-sun, on black.
  TEX.sunburst = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#141614'; g.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h - 6, R0 = 236;
    for (let k = 0; k < 19; k++) {
      const a0 = Math.PI + k / 19 * Math.PI, a1 = Math.PI + (k + 1) / 19 * Math.PI;
      g.fillStyle = k % 2 ? '#e0b44c' : '#9c7428'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R0, a0, a1); g.closePath(); g.fill();
    }
    g.strokeStyle = '#141614'; g.lineWidth = 5;
    [90, 150, 205].forEach((rr) => { g.beginPath(); g.arc(cx, cy, rr, Math.PI, 0); g.stroke(); });
    g.fillStyle = goldGradient(g, cy - 60, cy); g.beginPath(); g.arc(cx, cy, 56, Math.PI, 0); g.fill();
    g.strokeStyle = '#e8c068'; g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8);
  });
  TEX.sunburstE = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h - 6;
    for (let k = 0; k < 19; k += 2) { g.fillStyle = 'rgba(255,200,110,0.55)'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 236, Math.PI + k / 19 * Math.PI, Math.PI + (k + 1) / 19 * Math.PI); g.closePath(); g.fill(); }
    g.fillStyle = 'rgba(255,225,160,0.95)'; g.beginPath(); g.arc(cx, cy, 56, Math.PI, 0); g.fill();
  });
}
// The name across the entrance tower: gold letters on black, stepped deco rules either side.
function arenaSignTexture() {
  return canvasTex(2048, 186, (g, w, h) => {
    g.fillStyle = '#121513'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c99a3a'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    g.lineWidth = 2; g.strokeRect(22, 22, w - 44, h - 44);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 128;
    g.font = `400 ${size}px ${DECO}`;
    if ('letterSpacing' in g) g.letterSpacing = '30px';
    const max = w - 560, tw = g.measureText(ARENA_NAME).width;
    if (tw > max) { size = Math.floor(size * max / tw); g.font = `400 ${size}px ${DECO}`; }
    g.fillStyle = goldGradient(g, h / 2 - size / 2, h / 2 + size / 2);
    g.fillText(ARENA_NAME, w / 2 + 15, h / 2 + 8);
    g.fillStyle = '#d4a848';
    [-1, 1].forEach((sg) => { for (let k = 0; k < 3; k++) { const len = 170 - k * 46, y = h / 2 - 26 + k * 22, x = sg < 0 ? 60 : w - 60 - len; g.fillRect(x, y, len, 7); } });
  }, { repeat: [1, 1] });
}
// The clock on the tower: a cream face in a black ring, gold numerals and ticks.
function clockTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    const c = w / 2;
    g.fillStyle = '#141614'; g.beginPath(); g.arc(c, c, 254, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#efe6cf'; g.beginPath(); g.arc(c, c, 210, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#c99a3a'; g.lineWidth = 8; g.beginPath(); g.arc(c, c, 232, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 60; k++) {
      const a = k / 60 * Math.PI * 2, r0 = k % 5 ? 196 : 176;
      g.strokeStyle = k % 5 ? '#6b5a36' : '#b8862a'; g.lineWidth = k % 5 ? 3 : 9;
      g.beginPath(); g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0); g.lineTo(c + Math.sin(a) * 206, c - Math.cos(a) * 206); g.stroke();
    }
    g.fillStyle = goldGradient(g, 0, h); g.font = `400 76px ${DECO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('12', c, c - 238 + 4); g.fillText('6', c, c + 238 - 2); g.fillText('3', c + 238 - 4, c + 4); g.fillText('9', c - 238 + 4, c + 4);
    g.fillStyle = '#141614'; g.beginPath(); g.arc(c, c, 14, 0, Math.PI * 2); g.fill();
  }, { repeat: [1, 1] });
}
// The marquee on the canopy: bulbs round a dark board; what's on, in Swedish, cycling.
function marqueeSlides() {
  const slide = (text, sub) => canvasTex(2048, 128, (g, w, h) => {
    g.fillStyle = '#16120e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffe2a0';
    for (let x = 12; x < w; x += 24) { g.beginPath(); g.arc(x, 10, 5, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(x, h - 10, 5, 0, Math.PI * 2); g.fill(); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `400 70px ${DECO}`; if ('letterSpacing' in g) g.letterSpacing = '12px';
    g.fillStyle = '#fff4dc'; g.fillText(text, w / 2 - (sub ? 260 : 0), h / 2 + 4);
    if (sub) { g.fillStyle = '#e2b447'; g.fillText(sub, w / 2 + 560, h / 2 + 4); }
  }, { repeat: [1, 1] });
  return [slide('IKVÄLL · ISHOCKEY', '19:00'), slide(ARENA_NAME), slide('LÖRDAG · KONSERT', '20:00'), slide('PORTARNA ÖPPNAR', '18:00'), slide('VÄLKOMMEN')];
}
function swedenFlag() {
  return canvasTex(320, 200, (g, w, h) => {
    g.fillStyle = '#006aa7'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fecc02'; g.fillRect(w * 5 / 16, 0, w * 2 / 16, h); g.fillRect(0, h * 4 / 10, w, h * 2 / 10);
  }, { repeat: [1, 1] });
}
function skaneFlag() {
  return canvasTex(320, 200, (g, w, h) => {
    g.fillStyle = '#d21034'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fecc02'; g.fillRect(w * 5 / 16, 0, w * 2 / 16, h); g.fillRect(0, h * 4 / 10, w, h * 2 / 10);
  }, { repeat: [1, 1] });
}
function arenaFlag() {
  return canvasTex(360, 216, (g, w, h) => {
    g.fillStyle = '#1b2925'; g.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.62;
    for (let k = 0; k < 13; k++) { g.fillStyle = k % 2 ? '#e0b44c' : '#9c7428'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 70, Math.PI + k / 13 * Math.PI, Math.PI + (k + 1) / 13 * Math.PI); g.closePath(); g.fill(); }
    g.fillStyle = '#1b2925'; g.fillRect(0, cy, w, h - cy);
    g.fillStyle = goldGradient(g, cy + 10, cy + 60); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `400 40px ${DECO}`; if ('letterSpacing' in g) g.letterSpacing = '6px'; g.fillText(ARENA_NAME, cx + 3, cy + 38);
  }, { repeat: [1, 1] });
}

// ---------------------------------------------------------------- roads
function laterals(points) {
  return points.map((p, i) => {
    const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, points.length - 1)];
    let tx = b[0] - a[0], tz = b[2] - a[2]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    return [tz, -tx];
  });
}
function ribbon(points, width, y, mat, vScale, parent = scene) {
  const pos = [], uv = [], idx = [], lat = laterals(points);
  let d = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], [lx, lz] = lat[i];
    if (i > 0) d += Math.hypot(p[0] - points[i - 1][0], p[2] - points[i - 1][2]);
    pos.push(p[0] - lx * width / 2, p[1] + y, p[2] - lz * width / 2, p[0] + lx * width / 2, p[1] + y, p[2] + lz * width / 2);
    uv.push(0, d / vScale, 1, d / vScale);
  }
  for (let i = 0; i < points.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const OBST = new SegIndex(100);           // everything houses must keep clear of
const ROUTES = [];                         // traffic: { path, lanes, n, v }
const BIKE_PATHS = [];                     // cycle paths along the roads
function addRoute(pts, lanes, perKm, vmin, vmax, trucks = 0) {
  const path = new Path(pts);
  ROUTES.push({ path, lanes, n: Math.max(1, Math.round(path.len / 1000 * perKm)), vmin, vmax, trucks });
}
// Carriageways (for trees and lamp posts) and the town's side streets, laid out later.
const ROADWAY = new SegIndex(60), STREETS = new SegIndex(60);
const offsetPts = (pts, o, dy = 0) => { const lat = laterals(pts); return pts.map((p, i) => [p[0] + lat[i][0] * o, p[1] + dy, p[2] + lat[i][1] * o]); };
// Traffic keeps right: lane offsets are positive (right of the direction of travel).
const AVE = { lanes: [5.3, 8.9], perKm: 22, v: [7, 13], bus: 0.12 };
const CITY = { lanes: [3.0], perKm: 12, v: [6, 11], bus: 0.1 };
const MWAY = { lanes: [3.9, 7.6], perKm: 34, v: [20, 31], bus: 0.16 };
// The ring road along the line of the old walls (an ellipse, a little flattened north–south).
const RING = Array.from({ length: 73 }, (_, i) => { const a = i / 72 * Math.PI * 2; return [C0[0] + Math.cos(a) * RING_R, C0[1] + Math.sin(a) * RING_R * 0.92]; });
const ringAt = (deg) => [C0[0] + Math.cos(deg * DEG) * RING_R, C0[1] + Math.sin(deg * DEG) * RING_R * 0.92];
// [name, points, width, texture, pavement width, traffic]
const ROADS = [
  ['E22', [[200, 9000], [800, 4300], [1250, 1000], [1300, -600], [1250, -2000], [1300, -3800], [1450, -7000], [1700, -11000], [2100, -16000]], 26, 'mway', 0, MWAY],
  ['E6', [[-9150, 10900], [-7400, 7300], [-6000, 4300], [-4800, 2000], [-4400, -500], [-4300, -2500], [-4800, -6900], [-5600, -11000], [-6600, -16000]], 26, 'mway', 0, MWAY],
  ['the ring', RING, 22, 'dual', 4, AVE],
  // The arena's avenue, east–west along the south side of its grounds, out to the motorway.
  ['arena avenue', [[-2600, 430], [-1400, 330], [-600, 272], [0, 262], [700, 280], [1265, 500]], 20, 'road', 4, CITY],
  ['Trelleborgsvägen', [ringAt(95), [-275, -60], [-305, 100], [-320, 262], [-420, 1200], [-450, 3000], [-150, 5000], [300, 5600]], 20, 'dual', 4, AVE],
  ['east street', [ringAt(52), [330, -300], [300, -100], [295, 262], [320, 900]], 14, 'road', 3, CITY],
  ['Dalbyvägen', [ringAt(10), [900, -560], [1300, -450], [2500, -100], [4500, 600], [6500, 1700], [8400, 2900], [9650, 3670]], 20, 'dual', 4, AVE],
  ['Sölvegatan', [ringAt(-52), [600, -1450], [1260, -1900]], 20, 'dual', 4, AVE],
  ['Norra Ringen', [[-1900, -500], [-1650, -1500], [-1000, -2250], [0, -2550], [800, -2350], [1255, -2100]], 22, 'dual', 4, AVE],
  ['Kävlingevägen', [ringAt(-135), [-1200, -1450], [-1650, -1500], [-2600, -2100], [-4300, -2500]], 20, 'dual', 4, AVE],
  ['Fjelievägen', [ringAt(180), [-1300, -700], [-1900, -500], [-3000, -200], [-4420, -300]], 20, 'dual', 4, AVE],
  ['Malmövägen', [ringAt(135), [-900, -60], [-1350, 500], [-2300, 1700], [-3400, 3050], [-4800, 4000], [-6000, 4300]], 20, 'dual', 4, AVE],
  ['Getingevägen', [ringAt(-90), [-160, -1800], [-120, -2550], [100, -4000], [250, -5790], [600, -9000]], 16, 'road', 3, CITY],
  ['Brunnshög avenue', [[1255, -2100], [1900, -2500], [2600, -3000], [3300, -3500], [3800, -4300]], 20, 'dual', 4, AVE],
  // Country roads out to the villages.
  ['to Södra Sandby', [[1300, -600], [3000, -1100], [5500, -1700], [9335, -2000]], 12, 'road', 0, CITY],
  ['to Staffanstorp', [[1265, 500], [1000, 2500], [700, 4500], [626, 6234]], 12, 'road', 0, CITY],
  ['to Genarp', [[2500, -100], [3800, 3000], [5600, 8000], [7000, 14000]], 12, 'road', 0, CITY],
  ['to Lomma', [[-1350, 500], [-3000, 1000], [-5200, 2000], [-7400, 2900]], 12, 'road', 0, CITY],
  ['to Bjärred', [[-4400, -500], [-7000, -1200], [-10600, -2200]], 12, 'road', 0, CITY]
];
const LAMP_ROADS = [];
function buildRoads() {
  const M = {
    road: std('#ffffff', { map: TEX.road, roughness: 0.92 }), dual: std('#ffffff', { map: TEX.dual, roughness: 0.92 }), mway: std('#ffffff', { map: TEX.mway, roughness: 0.92 }),
    walk: std('#ffffff', { map: TEX.walk, roughness: 0.9 })
  };
  ROADS.forEach(([name, raw, w, tex, walk, traffic], i) => {
    const line = name === 'the ring' ? raw.slice() : smoothLine(raw, raw.length > 2 ? 20 : 30);
    // Carriageways sit above every pavement, each road at its own height, so crossings never flicker.
    const y = 0.16 + (i % 8) * 0.004;
    const pts = line.map(([x, z]) => [x, baseHeight(x, z) + y, z]);
    ribbon(pts, w, 0, M[tex], tex === 'mway' ? 16 : 12);
    if (walk) {
      [-1, 1].forEach((s) => ribbon(offsetPts(pts, s * (w / 2 + walk / 2), -0.05 - (i % 8) * 0.004), walk, 0, M.walk, 6));
      LAMP_ROADS.push({ pts, off: w / 2 + walk - 0.5 });
    } else if (tex === 'mway') LAMP_ROADS.push({ pts, off: 0, median: true });
    OBST.add(line, w / 2 + walk, 60);
    ROADWAY.add(line, w / 2, 20);
    const near = pts.filter(([x, , z]) => Math.hypot(x, z) < 6500);
    if (traffic && near.length > 3) addRoute(near, traffic.lanes.filter((l) => l < w / 2), MOBILE ? traffic.perKm * 0.6 : traffic.perKm, traffic.v[0], traffic.v[1], traffic.bus);
    if (walk) {
      const close = pts.filter(([x, , z]) => Math.hypot(x, z) < 3200);
      if (close.length > 3) [-1, 1].forEach((s) => BIKE_PATHS.push(new Path(offsetPts(close, s * (w / 2 + walk * 0.72), -0.02))));
    }
  });
}
// The main line from Malmö through Lund C and on north, and Lund's tram out to Brunnshög.
const RAIL_LINE = [[-12279, 9907], [-7894, 6790], [-3383, 3117], [-1316, 890], [-752, -222], [-576, -846], [-501, -1892], [-63, -4119], [250, -5789], [877, -9128], [1500, -14000]];
const TRAM_LINE = [[-530, -870], [-420, -930], [-330, -1150], [-250, -1400], [-60, -1640], [300, -1690], [700, -1650], [1100, -1760], [1500, -2020],
  [1950, -2480], [2350, -2960], [2750, -3440], [3150, -3800]];
const RAIL = {};
function buildRail() {
  const line = smoothLine(RAIL_LINE, 10);
  const cen = line.map(([x, z]) => [x, baseHeight(x, z) + 0.3, z]);
  const lat = laterals(cen);
  const off = (o, dy = 0) => cen.map((p, i) => [p[0] - lat[i][0] * o, p[1] + dy, p[2] - lat[i][1] * o]);
  // Northbound trains on the eastern track, southbound on the western one.
  RAIL.nb = off(-2.3, 0.2).reverse(); RAIL.sb = off(2.3, 0.2);
  ribbon(cen, 11, 0.12, std('#ffffff', { map: TEX.trackbed, roughness: 1 }), 6);
  const steel = std('#6a655f', { roughness: 0.35, metalness: 0.7 });
  [2.3 - 0.72, 2.3 + 0.72, -2.3 - 0.72, -2.3 + 0.72].forEach((o) => ribbon(off(o), 0.12, 0.3, steel, 10));
  // Overhead line masts.
  const masts = [], beams = [];
  for (let i = 0; i < cen.length - 1; i += 6) {
    const p = cen[i]; if (Math.hypot(p[0], p[2]) > 6000) continue;
    masts.push({ x: p[0] + lat[i][0] * 6, y: p[1], z: p[2] + lat[i][1] * 6, sx: 0.3, sy: 7.5, sz: 0.3 });
    beams.push({ x: p[0] + lat[i][0] * 0.0, y: p[1] + 7.2, z: p[2] + lat[i][1] * 0.0, sx: 13, sy: 0.25, sz: 0.25, ry: Math.atan2(-lat[i][1], lat[i][0]) });
  }
  const grey = std('#7d8286', { metalness: 0.6, roughness: 0.4 });
  instanced(unitBox, grey, masts);
  instanced(unitBox, grey, beams);
  OBST.add(line, 7, 60);
  ROADWAY.add(line, 5.5, 20);
  // Lund C: side platforms under long canopies, and the yellow-brick station house of 1856 on the town side.
  let best = 0, bd = 1e9;
  cen.forEach((p, i) => { const d = Math.hypot(p[0] - LUND_C[0], p[2] - LUND_C[1]); if (d < bd) { bd = d; best = i; } });
  const p = cen[best], q = cen[Math.min(best + 1, cen.length - 1)], ang = Math.atan2(-(q[2] - p[2]), q[0] - p[0]);
  const st = new THREE.Group(); st.position.set(p[0], p[1] - 0.3, p[2]); st.rotation.y = ang; scene.add(st);
  RAIL.station = [p[0], p[2]];
  const conc = std('#bdb8ae', { roughness: 0.85 }), canopy = std('#e8e6e0', { roughness: 0.5, metalness: 0.3 }), post = std('#3b3f42', { metalness: 0.5 });
  [-1, 1].forEach((sg) => {
    const e = new THREE.Mesh(unitBox, conc); e.scale.set(240, 1.1, 4.2); e.position.set(0, 0, sg * 6.0); e.receiveShadow = true; st.add(e);
    const c = new THREE.Mesh(unitBox, canopy); c.scale.set(200, 0.35, 5.2); c.position.set(0, 4.6, sg * 6.4); c.castShadow = true; st.add(c);
    for (let a = -95; a <= 95; a += 12) { const k = new THREE.Mesh(unitBox, post); k.scale.set(0.3, 4.6, 0.3); k.position.set(a, 0, sg * 6.6); st.add(k); }
  });
  // The station house: two storeys of pale yellow brick under a slate hip roof, on the town side of the tracks.
  const c = Math.cos(ang), s2 = Math.sin(ang), W2 = (a, b) => [p[0] + a * c + b * s2, p[2] - a * s2 + b * c];
  const [hx, hz] = W2(0, 19);
  B.civic.push({ x: hx, y: p[1] - 0.6, z: hz, sx: 70, sy: 10.3, sz: 13, ry: ang, c: lin('#d9c08a') });
  hipRoofRect(-35, 12.5, 35, 25.5, 10, 4.5, 0.6, std('#4a4f55', { roughness: 0.6 }), st);
  [[0, 0, 244, 20, ang], [0, 19, 74, 16, ang]].forEach(([a, b, w, d, ry]) => { const [x, z] = W2(a, b); occMark(x, z, w, d, ry); });
}
const TRAM = {};
function buildTram() {
  const line = smoothLine(TRAM_LINE, 8);
  const cen = line.map(([x, z]) => [x, baseHeight(x, z) + 0.22, z]);
  ribbon(cen, 7.4, 0, std('#ffffff', { map: TEX.tramGreen, roughness: 1 }), 6);
  const steel = std('#7a756f', { roughness: 0.35, metalness: 0.7 });
  [-2.1, -0.7, 0.7, 2.1].forEach((o) => ribbon(offsetPts(cen, o), 0.1, 0.06, steel, 10));
  const lat = laterals(cen), masts = [];
  for (let i = 0; i < cen.length; i += 5) masts.push({ x: cen[i][0], y: cen[i][1], z: cen[i][2], sx: 0.22, sy: 7, sz: 0.22 });
  instanced(unitBox, std('#4a4f52', { metalness: 0.6, roughness: 0.4 }), masts);
  TRAM.path = new Path(cen.map(([x, y, z], i) => [x + lat[i][0] * 1.4, y, z + lat[i][1] * 1.4]));
  TRAM.back = new Path(cen.map(([x, y, z], i) => [x - lat[i][0] * 1.4, y, z - lat[i][1] * 1.4]).reverse());
  OBST.add(line, 4.5, 60);
  ROADWAY.add(line, 3.7, 20);
}

// ---------------------------------------------------------------- the town: occupancy, footprints, roofs
// Occupancy on a 4 m grid, so landmarks and blocks never overlap.
const OCC = new Set(), OC = 4;
const okey = (i, j) => (i + 30000) * 60000 + (j + 30000);
const occAt = (x, z) => OCC.has(okey(Math.floor(x / OC), Math.floor(z / OC)));
function rectPts(cx, cz, w, d, ry, step, fn) {
  const c = Math.cos(ry), s = Math.sin(ry), nu = Math.max(1, Math.ceil(w / step)), nv = Math.max(1, Math.ceil(d / step));
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const a = -w / 2 + w * i / nu, b = -d / 2 + d * j / nv; fn(cx + a * c + b * s, cz - a * s + b * c); }
}
function occFree(cx, cz, w, d, ry) {
  let ok = true;
  rectPts(cx, cz, w, d, ry, 3, (x, z) => { if (ok && occAt(x, z)) ok = false; });
  return ok;
}
function occMark(cx, cz, w, d, ry) { rectPts(cx, cz, w, d, ry, 2, (x, z) => OCC.add(okey(Math.floor(x / OC), Math.floor(z / OC)))); }
// The arena's grounds: car park, cycle park, plaza, service yard.
const PRECINCT = [-250, -170, 250, 248];
const inPrecinct = (x, z, m = 0) => x > PRECINCT[0] - m && x < PRECINCT[2] + m && z > PRECINCT[1] - m && z < PRECINCT[3] + m;
// Does a whole footprint keep clear of every road and pavement, the town's streets, the river, the parks and the grounds?
function footOK(cx, cz, w, d, ry, margin = 0.5) {
  let ok = true;
  rectPts(cx, cz, w + 2 * margin, d + 2 * margin, ry, Math.max(2, Math.min(w, d) / 6), (x, z) => {
    if (!ok) return;
    if (OBST.clearance(x, z) < 0 || STREETS.clearance(x, z) < 0 || RIV_IDX.clearance(x, z) < 6 || inPrecinct(x, z)) ok = false;
  });
  return ok && !inAny(cx, cz, PARKS);
}
function clearSpot(x, z, w, d, ry = 0) {
  if (footOK(x, z, w, d, ry) && occFree(x, z, w, d, ry)) return [x, z];
  for (let r = 4; r <= 80; r += 4) for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (footOK(px, pz, w, d, ry) && occFree(px, pz, w, d, ry)) return [px, pz];
  }
  return null;
}
const SPOT = (x, z, w, d, ry = 0) => clearSpot(x, z, w, d, ry) || [x, z];
// The lowest ground under a footprint, so buildings on slopes never float.
function groundUnder(x, z, w, d, ry) { let m = Infinity; rectPts(x, z, w, d, ry, Math.max(w, d) / 2, (px, pz) => { m = Math.min(m, landHeight(px, pz)); }); return m; }
// Lund's colours: red and yellow brick, ochre and cream plaster, Falu red and white timber.
const OLD_COLS = ['#8f3f2c', '#9b4a33', '#7e3526', '#a65a3c', '#d6b77a', '#cfae6c', '#e8dcc0', '#f0e6cf', '#e6c98a', '#d9a96a', '#c9cfc8', '#efe9dd', '#b8604a', '#e2c27e', '#c78a5a'];
const BLOCK_COLS = ['#d8c49a', '#cdb184', '#e6d8b8', '#9a5a44', '#a86a50', '#e9e2d2', '#c9b8a0', '#d9a88a', '#bfc6c0', '#e0c890', '#8e4a38'];
const LAMELL_COLS = ['#d2b57c', '#c8a96e', '#d9c08c', '#9a5a44', '#a86a50', '#ddd6c6', '#c9c2b4', '#b39a74'];
const VILLA_COLS = ['#8a2f22', '#93372a', '#eeeae0', '#e8e3d6', '#e2c57a', '#d8c79a', '#c9cdc8', '#9a4a36', '#b8c2bc', '#f1ecdf', '#6f7a72'];
const MODERN_COLS = ['#ecebe6', '#d9d8d2', '#9a7a5a', '#8a6a4e', '#4a4d50', '#5d6164', '#b5603e', '#c9c4ba', '#e2dccf'];
const ROOF_COLS = { tile: ['#8e3b2a', '#9c4630', '#7a3226', '#a34d33', '#8a4434'], black: ['#2a2a2c', '#323234', '#3a3a3c'], grey: ['#55585a', '#4a4c4e', '#62605c'] };
const roofCol = (pTile = 0.55, pBlack = 0.3) => { const r = rand(); return lin(pick(r < pTile ? ROOF_COLS.tile : r < pTile + pBlack ? ROOF_COLS.black : ROOF_COLS.grey)); };
const B = { old: [], block: [], lamell: [], villa: [], modern: [], brick: [], civic: [], far: [], plain: [] };
const ROOF = [], GABLE_END = [];
// A pitched roof over a box: slopes in the roof's colour, gable ends in the wall's.
function addRoof(x, y, z, w, d, ry, rise, roofC, wallC, across = false) {
  const it = across ? { x, y, z, sx: d + 0.8, sy: rise, sz: w + 0.6, ry: ry + Math.PI / 2 } : { x, y, z, sx: w + 0.6, sy: rise, sz: d + 0.8, ry };
  ROOF.push(Object.assign({ c: roofC }, it));
  GABLE_END.push(Object.assign({}, it, { sx: it.sx - 0.6, sz: it.sz - 0.8, c: wallC }));
}
function gableGeos() {
  const slopes = [
    -0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, -0.5,   -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0,     -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0
  ];
  const ends = [0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, 0.5,     -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0];
  const mk = (v) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); return g; };
  return { slopes: mk(slopes), ends: mk(ends) };
}
const GABLE = gableGeos();
const treeItems = [], farTrees = [];
// Autumn in Skåne: limes and maples gone yellow, beeches copper, oaks still green, birches gold.
const LEAVES = ['#4d6a30', '#566f34', '#62783a', '#6f7a38', '#7e7a36', '#8f7c34', '#a07a34', '#9c6232', '#87502e', '#4a6230', '#b08e40', '#76803e', '#5a6a36'].map(lin);
function addTree(x, z, h, r, kind = 0, c) {
  if (ROADWAY.clearance(x, z) < 0.6 || STREETS.clearance(x, z) < 0.6 || RIV_IDX.clearance(x, z) < 3) return;
  treeItems.push({ x, y: landHeight(x, z), z, h, r, c: c || pick(LEAVES), kind });
}

// ---------------------------------------------------------------- landmarks: the cathedral, the university, the castle-like student union
function buildCathedral() {
  const [cx, cz] = DOM, y0 = groundUnder(cx, cz, 90, 34, 0) - 0.4;
  const g = new THREE.Group(); g.position.set(cx, y0, cz); g.rotation.y = 0.06; scene.add(g);
  const stone = std('#ffffff', { map: TEX.romanesque, roughness: 0.92 });
  const stoneP = std('#b6aa92', { roughness: 0.92 });
  const roofM = std('#4b5752', { roughness: 0.55, metalness: 0.3 });
  const box = (w, h, d, x, y, z) => { const k = new THREE.Mesh(boxGeoUV(w, h, d, 8, 10), stone); k.position.set(x, y, z); k.castShadow = k.receiveShadow = true; g.add(k); return k; };
  const gable = (len, rise, dep, x, y, z, ry = 0) => {
    [[GABLE.slopes, roofM], [GABLE.ends, stoneP]].forEach(([geo, m]) => { const k = new THREE.Mesh(geo, m); k.scale.set(len, rise, dep); k.position.set(x, y, z); k.rotation.y = ry; k.castShadow = k.receiveShadow = true; g.add(k); });
  };
  // West is -x: the twin towers with their pyramid spires, the west front between them, nave, aisles, transept, choir, apse.
  [-1, 1].forEach((sg) => {
    box(11, 43, 11, -36.5, 0, sg * 9.5);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(11 / Math.SQRT2 * 1.03, 13, 4, 1).translate(0, 6.5, 0), roofM);
    cap.rotation.y = Math.PI / 4; cap.position.set(-36.5, 43, sg * 9.5); cap.castShadow = true; g.add(cap);
    const cor = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.6, 11.6), stoneP); cor.position.set(-36.5, 42.8, sg * 9.5); g.add(cor);
  });
  box(8.2, 28, 8, -36.5, 0, 0);
  gable(8.2, 6, 8.4, -36.5, 28, 0, Math.PI / 2);
  box(53, 20, 12, -5.5, 0, 0); gable(54, 8.5, 13, -5.5, 20, 0);
  [-1, 1].forEach((sg) => { box(43, 11, 6, -10.5, 0, sg * 9); gable(43, 2.6, 6.8, -10.5, 11, sg * 9); });
  box(12, 20, 33, 18, 0, 0); gable(34, 8.5, 13, 18, 20, 0, Math.PI / 2);
  box(12, 20, 12, 30, 0, 0); gable(12, 8.5, 13, 30, 20, 0);
  const apse = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 19, 24, 1, false, 0, Math.PI).translate(0, 9.5, 0), stone); apse.position.set(36, 0, 0); apse.castShadow = apse.receiveShadow = true; g.add(apse);
  const ar = new THREE.Mesh(new THREE.ConeGeometry(6.5, 7, 24, 1, true, 0, Math.PI).translate(0, 3.5, 0), roofM); ar.position.set(36, 19, 0); ar.castShadow = true; g.add(ar);
  occMark(cx, cz, 96, 40, 0.06);
  // The cathedral close: lawns and big trees round it.
  for (let i = 0; i < 18; i++) { const a = rand() * Math.PI * 2, rr = R(28, 46); addTree(cx + Math.cos(a) * rr * 1.4, cz + Math.sin(a) * rr, R(14, 20), R(5, 7.5)); }
}
function buildCivic() {
  const civic = (x, z, w, d, h, ry, col, roof, rise = 4) => {
    const px = x, pz = z, y = groundUnder(px, pz, w, d, ry) - 0.3;
    B.civic.push({ x: px, y, z: pz, sx: w, sy: h, sz: d, ry, c: lin(col) });
    if (roof) addRoof(px, y + h, pz, w, d, ry, rise, lin(roof), lin(col));
    occMark(px, pz, w + 4, d + 4, ry);
    return [px, y, pz];
  };
  // Universitetshuset: white, three tall storeys, a low grey roof, facing south over Lundagård.
  civic(UNIV[0], UNIV[1], 68, 24, 19, 0, '#efe9dc', '#6b6f70', 3.2);
  // Kungshuset: Renaissance red brick with its octagonal stair tower and copper spire.
  {
    const [x, y, z] = civic(KUNGSHUSET[0], KUNGSHUSET[1], 34, 13, 14, 0.1, '#8f3f2c', '#2e2e30', 8);
    const brick = std('#ffffff', { map: TEX.brick, roughness: 0.9 });
    const t = mesh(new THREE.CylinderGeometry(3.4, 3.4, 30, 8).translate(0, 15, 0), brick, x + 4, y, z + 8);
    mesh(new THREE.ConeGeometry(3.8, 9, 8).translate(0, 4.5, 0), std('#5e8a74', { roughness: 0.6, metalness: 0.3 }), x + 4, y + 30, z + 8);
    t.castShadow = true;
  }
  // AF-borgen: the students' union, a red-brick castle with a crenellated tower.
  {
    const [x, y, z] = civic(AFB[0], AFB[1], 46, 28, 15, -0.05, '#8a3c2c', '#3a3a3c', 5);
    const brick = std('#ffffff', { map: TEX.brick, roughness: 0.9 });
    mesh(boxGeoUV(7, 27, 7, 4), brick, x - 18, y, z + 10);
    const cren = [];
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; cren.push({ x: x - 18 + Math.cos(a) * 3.2, y: y + 27, z: z + 10 + Math.sin(a) * 3.2, sx: 1.2, sy: 1.4, sz: 1.2, ry: -a }); }
    instanced(unitBox, brick, cren, { cast: true });
  }
  // Skånes universitetssjukhus: the 1960s ward block, thirteen storeys over the north of the town, and its lower wings.
  {
    const ry = 0.12, [x, z] = SPOT(HOSPITAL[0], HOSPITAL[1], 120, 22, ry), y = groundUnder(x, z, 120, 22, ry);
    B.lamell.push({ x, y, z, sx: 120, sy: 46, sz: 21, ry, c: lin('#d9d2c2') });
    occMark(x, z, 124, 26, ry);
    [[-30, 45, 70, 30, 14], [40, 50, 60, 34, 18], [10, -50, 90, 28, 12]].forEach(([a, b, w, d, h]) => {
      const c = Math.cos(ry), s = Math.sin(ry), px = x + a * c + b * s, pz = z - a * s + b * c, p = clearSpot(px, pz, w, d, ry);
      if (!p) return;
      B.modern.push({ x: p[0], y: groundUnder(p[0], p[1], w, d, ry), z: p[1], sx: w, sy: h, sz: d, ry, c: lin(pick(['#d9d2c2', '#c9c2b4', '#e2ddd2'])) }); occMark(p[0], p[1], w + 4, d + 4, ry);
    });
  }
  // The botanical garden's glasshouses.
  {
    const glass = std('#ffffff', { map: TEX.glassGrid, roughness: 0.15, metalness: 0.5, transparent: true, opacity: 0.85 });
    [[560, -980, 34, 14, 9], [600, -1010, 18, 12, 12]].forEach(([x, z, w, d, h]) => { const k = mesh(boxGeoUV(w, h, d, 6, 4), glass, x, baseHeight(x, z), z); k.rotation.y = 0.04; occMark(x, z, w + 4, d + 4, 0); });
  }
  // The old town's squares: cobbles, kept clear.
  const cob = std('#ffffff', { map: TEX.cobble, roughness: 0.95 });
  SQUARES.forEach(([x, z, w, d]) => {
    const y = baseHeight(x, z) + 0.11;
    const p = mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), cob, x, y, z, scene, false);
    const uv = p.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 8, uv.getY(i) * d / 8);
    occMark(x, z, w, d, 0);
  });
  // Lund's school of engineering: long red-brick blocks under flat roofs, by the motorway.
  for (let i = 0; i < 16; i++) {
    const x0 = R(620, 1120), z0 = R(-1420, -980), w = R(30, 70), d = R(14, 22), ry = 0.08, p = clearSpot(x0, z0, w + 8, d + 8, ry);
    if (!p) continue;
    B.brick.push({ x: p[0], y: groundUnder(p[0], p[1], w, d, ry) - 0.3, z: p[1], sx: w, sy: Math.round(R(3, 5)) * 3.6 + 1, sz: d, ry, c: lin(pick(['#8f4634', '#9a4e3a', '#844030'])) });
    occMark(p[0], p[1], w + 8, d + 8, ry);
  }
}
// Brunnshög: MAX IV's ring and the European Spallation Source's long linac, out beyond the motorway.
function buildScience() {
  const silver = std('#c9cdd0', { roughness: 0.4, metalness: 0.55 }), white = std('#e6e6e2', { roughness: 0.6 });
  {
    const [x, z] = MAXIV, y = baseHeight(x, z) - 0.3;
    const prof = [[78, 0], [78, 12], [80, 13.5], [92, 13.5], [94, 12], [94, 0]].map(([r, h]) => new THREE.Vector2(r, h));
    mesh(new THREE.LatheGeometry(prof, 96), silver, x, y, z);
    mesh(new THREE.CylinderGeometry(78.1, 78.1, 0.4, 64), std('#6b8a46', { roughness: 0.95 }), x, y + 0.2, z, scene, false);
    occMark(x, z, 200, 200, 0);
  }
  {
    const [x, z] = ESS, ry = 0.62, y = groundUnder(x, z, 520, 20, ry);
    const l = mesh(boxGeoUV(520, 9, 18, 6), white, x, y, z); l.rotation.y = ry;
    const c = Math.cos(ry), s = Math.sin(ry), tx = x + 290 * c, tz = z - 290 * s;
    const t = mesh(boxGeoUV(70, 30, 60, 6), std('#5d6c78', { roughness: 0.5, metalness: 0.4 }), tx, groundUnder(tx, tz, 70, 60, ry), tz); t.rotation.y = ry;
    occMark(x + 30 * c, z - 30 * s, 640, 80, ry);
  }
}
// Malmö on the horizon, 16 km to the south-west: the Turning Torso over the western harbour, and the town's taller blocks.
function buildMalmo() {
  const white = std('#eef0f0', { roughness: 0.35, metalness: 0.35 });
  {
    const [x, z] = TORSO, y = baseHeight(x, z), gb = new GB(), N = 60, H = 190;
    const foot = (k) => { const a0 = k / N * Math.PI / 2; return Array.from({ length: 6 }, (_, i) => { const a = a0 + i / 6 * Math.PI * 2, r = i === 0 ? 17 : 13; return [Math.cos(a) * r, Math.sin(a) * r]; }); };
    for (let k = 0; k < N; k++) loft(foot(k), foot(k + 1), k * H / N, (k + 1) * H / N, { gb, uScale: 4, vScale: 4 });
    capPoly(foot(N), H, true, gb);
    mesh(gb.geo(), white, x, y, z, scene, false);
    occMark(x, z, 40, 40, 0);
  }
  const towers = [];
  for (let i = 0; i < 46; i++) {
    const x = MALMO[0] + R(-2600, 2200), z = MALMO[1] + R(-1800, 2400);
    if (sideDist(x, z, COAST) < 150) continue;
    towers.push({ x, y: baseHeight(x, z) - 0.5, z, sx: R(20, 40), sy: R(24, 70), sz: R(18, 36), ry: R(-0.3, 0.3), c: lin(pick(['#d9d4c8', '#b9b2a6', '#c7cdd0', '#a8a39a', '#e6e2d8'])) });
  }
  B.far.push(...towers);
}
// Wind turbines out on the plain, in short lines, all turned into the south-westerly.
const TURB = { blades: null, list: [], yaw: -2.3 };
function buildTurbines() {
  const groups = [[-5200, 6800], [5200, 5200], [7600, -4800], [-2600, -6500], [3200, 11500], [-8000, -5200], [11800, 600], [-1500, 9800]];
  const towers = [], nacelles = [], hubs = [];
  groups.forEach(([gx, gz], gi) => {
    const n = 3 + (gi % 3), a = rand() * Math.PI;
    for (let k = 0; k < n; k++) {
      const x = gx + Math.cos(a) * (k - n / 2) * 380 + R(-40, 40), z = gz + Math.sin(a) * (k - n / 2) * 380 + R(-40, 40);
      if (urbanAt(x, z) > 0.05 || sideDist(x, z, COAST) < 600 || OBST.clearance(x, z) < 60) continue;
      const y = baseHeight(x, z), H = R(78, 96);
      towers.push({ x, y, z, sx: 1, sy: H, sz: 1 });
      const hx = x + Math.sin(TURB.yaw) * 3.2, hz = z + Math.cos(TURB.yaw) * 3.2;
      nacelles.push({ x, y: y + H - 1.4, z, sx: 1, sy: 1, sz: 1, ry: TURB.yaw });
      hubs.push({ x: hx, y: y + H + 0.6, z: hz, sx: 1, sy: 1, sz: 1, ry: TURB.yaw });
      TURB.list.push({ x: hx, y: y + H + 0.6, z: hz, ph: rand() * 6.28, w: R(1.1, 1.5) });
    }
  });
  const white = std('#f0f1ef', { roughness: 0.45 });
  instanced(new THREE.CylinderGeometry(1.3, 2.3, 1, 12).translate(0, 0.5, 0), white, towers, { cast: true });
  instanced(new THREE.BoxGeometry(3.4, 3.6, 10).translate(0, 1.8, -2.0), white, nacelles, { cast: true });
  instanced(new THREE.SphereGeometry(1.6, 12, 8).scale(1, 1, 1.5), white, hubs);
  // A blade: 46 m, broad near the root and tapering, in the rotor's plane.
  const bl = new THREE.BufferGeometry();
  bl.setAttribute('position', new THREE.Float32BufferAttribute([-1.2, 1, 0, 1.6, 1, 0, 0.25, 46, 0, -1.2, 1, 0, 0.25, 46, 0, -0.35, 46, 0], 3));
  bl.computeVertexNormals();
  TURB.blades = new THREE.InstancedMesh(bl, std('#f4f5f3', { roughness: 0.4, side: THREE.DoubleSide }), Math.max(1, TURB.list.length * 3));
  TURB.blades.frustumCulled = false; TURB.blades.castShadow = true; scene.add(TURB.blades);
  updateTurbines(0);
}
function updateTurbines(dt) {
  TURB.list.forEach((t, i) => {
    t.ph += t.w * dt;
    for (let k = 0; k < 3; k++) composeInto(TURB.blades, i * 3 + k, { x: t.x, y: t.y, z: t.z, sx: 1, sy: 1, sz: 1, ry: TURB.yaw, rz: t.ph + k * Math.PI * 2 / 3 });
  });
  TURB.blades.instanceMatrix.needsUpdate = true;
}
// Farmsteads on the plain: four long wings round a yard (the Scanian kringelbyggd gård), whitewashed or brick, with a clump of trees.
function buildFarms() {
  const walls = [], roofs = [], ends = [];
  for (let i = 0; i < 2600 && walls.length < 4 * 240; i++) {
    const a = rand() * Math.PI * 2, r = 2600 + Math.pow(rand(), 0.8) * 20000, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (urbanAt(x, z) > 0.02 || sideDist(x, z, COAST) < 300 || woodsAt(x, z) > 0.3 || OBST.clearance(x, z) < 30 || x < DK_X + 3000) continue;
    if (!occFree(x, z, 50, 50, 0)) continue;
    const ry = rand() * Math.PI, y = baseHeight(x, z) - 0.3, S = R(30, 40), d = R(7.5, 9), h = R(3.4, 4.2);
    const wc = lin(pick(['#efece4', '#e8e2d2', '#ece6d4', '#9a4a36', '#8a2f22', '#f2efe6'])), rc = lin(pick(['#3a3a3a', '#2e2e30', '#8a7a55', '#8e3b2a', '#8a7a55']));
    const c = Math.cos(ry), s = Math.sin(ry);
    [[0, -(S - d) / 2, S, 0], [0, (S - d) / 2, S, 0], [-(S - d) / 2, 0, S - 2 * d, Math.PI / 2], [(S - d) / 2, 0, S - 2 * d, Math.PI / 2]].forEach(([u, v, len, rr]) => {
      const px = x + u * c + v * s, pz = z - u * s + v * c;
      walls.push({ x: px, y, z: pz, sx: len, sy: h, sz: d, ry: ry + rr, c: wc });
      roofs.push({ x: px, y: y + h, z: pz, sx: len + 0.6, sy: d * 0.55, sz: d + 0.9, ry: ry + rr, c: rc });
      ends.push({ x: px, y: y + h, z: pz, sx: len, sy: d * 0.55, sz: d, ry: ry + rr, c: wc });
    });
    occMark(x, z, 50, 50, 0);
    for (let k = 0; k < 7; k++) { const ta = rand() * Math.PI * 2, tr = R(24, 40); farTrees.push({ x: x + Math.cos(ta) * tr, z: z + Math.sin(ta) * tr, h: R(10, 18), r: R(4, 7) }); }
  }
  instanced(unitBox, std('#ffffff', { roughness: 0.9 }), walls, { receive: true });
  instanced(GABLE.slopes, std('#ffffff', { roughness: 0.85 }), roofs);
  instanced(GABLE.ends, std('#ffffff', { roughness: 0.9 }), ends);
  // Avenues of trees along the country roads, as all over Skåne.
  ROADS.forEach(([name, raw, w, tex, walk]) => {
    if (tex === 'mway' || name === 'the ring') return;
    const line = smoothLine(raw, 14);
    line.forEach(([x, z], i) => {
      if (rand() < 0.25 || urbanAt(x, z) > 0.3 || Math.hypot(x, z) > 16000) return;
      const lat = laterals([[line[Math.max(i - 1, 0)][0], 0, line[Math.max(i - 1, 0)][1]], [line[Math.min(i + 1, line.length - 1)][0], 0, line[Math.min(i + 1, line.length - 1)][1]]])[0];
      [-1, 1].forEach((sg) => farTrees.push({ x: x + lat[0] * sg * (w / 2 + walk + 3), z: z + lat[1] * sg * (w / 2 + walk + 3), h: R(11, 16), r: R(3.5, 5) }));
    });
  });
}

// ---------------------------------------------------------------- the town: blocks of houses, perimeter blocks, slab blocks and villas
function districtAt(x, z) {
  if (ringD(x, z) < RING_R - 30) return 'old';
  if (x > 1330 && z < -1700) return 'modern';      // Brunnshög, beyond the motorway
  const d = ringD(x, z);
  if (d < 1450) return rand() < 0.7 ? 'block' : 'lamell';
  // Further out: areas of villas and areas of 1960s slab blocks (Norra Fäladen, Klostergården), as a slow noise field decides.
  const f = fbm(x / 1400 + 2.3, z / 1400 - 0.7, 2);
  return f > 0.06 ? 'lamell' : f > -0.12 ? 'radhus' : 'villa';
}
const CITY_STREETS = [];
const NEAR_CITY = 3400;
function cityRegion(pred, ry, { BU = 100, BV = 84, SW = 9, ox = 0, oz = 0, sr = 3600, span = 18500 } = {}) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const toW = (u, v) => [ox + u * c + v * s, oz - u * s + v * c];
  const streetOK = (x, z) => Math.hypot(x, z) < NEAR_CITY && pred(x, z) && RIV_IDX.clearance(x, z) > 8 && OBST.clearance(x, z) > 0 && !inAny(x, z, PARKS) &&
    !inPrecinct(x, z, 5) && !occAt(x, z) && urbanAt(x, z) > 0.5;
  // A street stays clear of anything already built, across its whole width.
  const street = (a0, b0, a1, b1) => {
    const len = Math.hypot(a1 - a0, b1 - b0), n = Math.ceil(len / 2), la = -(b1 - b0) / len * (SW / 2 + 1), lb = (a1 - a0) / len * (SW / 2 + 1);
    let run = null;
    const push = () => {
      const l = Math.hypot(run[2] - run[0], run[3] - run[1]);
      if (l < 24) return;
      const tu = (run[2] - run[0]) / l, tv = (run[3] - run[1]) / l, a = toW(run[0] + tu * 3, run[1] + tv * 3), b = toW(run[2] - tu * 3, run[3] - tv * 3);
      CITY_STREETS.push([...a, ...b, SW]); STREETS.add([a, b], SW / 2, 30);
    };
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n, b = b0 + (b1 - b0) * i / n, [x, z] = toW(a, b);
      const [x1, z1] = toW(a + la, b + lb), [x2, z2] = toW(a - la, b - lb);
      if (streetOK(x, z) && !occAt(x1, z1) && !occAt(x2, z2)) { if (!run) run = [a, b]; run[2] = a; run[3] = b; } else { if (run) push(); run = null; }
    }
    if (run) push();
  };
  // Streets only in the near town, where they are seen.
  for (let u = Math.floor(-sr / BU) * BU; u <= sr; u += BU) street(u, -sr, u, sr);
  for (let v = Math.floor(-sr / BV) * BV; v <= sr; v += BV) street(-sr, v, sr, v);
  for (let bu = Math.floor(-span / BU) * BU; bu < span; bu += BU) for (let bv = Math.floor(-span / BV) * BV; bv < span; bv += BV) {
    const [cx, cz] = toW(bu + BU / 2, bv + BV / 2), r = Math.hypot(cx, cz);
    const tier = r < NEAR_CITY ? 0 : r < 8000 ? 1 : 2;
    if (r > 18500 || tier === 2 && rand() < 0.3 || !pred(cx, cz) || urbanAt(cx, cz) < 0.5) continue;
    if (inAny(cx, cz, PARKS) || RIV_IDX.clearance(cx, cz) < 50 || inPrecinct(cx, cz, 10)) continue;
    if (sideDist(cx, cz, COAST) < 120) continue;
    const ua = bu + SW / 2 + 1, ub = bu + BU - SW / 2 - 1, va = bv + SW / 2 + 1, vb = bv + BV - SW / 2 - 1;
    const W = (u, v) => toW(u, v);
    const place = (list, x, z, w, d, h, hry, col, roof, row = false) => {
      // Terraced houses share party walls, so only the core of their footprint is tested against the 4 m occupancy grid.
      const ins = row ? 4.4 : 0;
      if (!footOK(x, z, w, d, hry, 0.3) || !occFree(x, z, Math.max(w - 2 * ins, 1), Math.max(d - 2 * ins, 1), hry)) return false;
      const y = groundUnder(x, z, w, d, hry) - 0.3;
      B[list].push({ x, y, z, sx: w, sy: h, sz: d, ry: hry, c: col });
      if (roof) addRoof(x, y + h, z, w, d, hry, roof.rise, roof.c, col, roof.across);
      occMark(x, z, w, d, hry);
      return true;
    };
    if (tier === 2) {
      // Far off (Malmö, Kävlinge): a block or two of flats, enough to read as town through the haze.
      for (let k = 0; k < 2; k++) {
        const w = R(16, 40), [x, z] = W(bu + R(22, BU - 22), bv + R(20, BV - 20)), d = R(12, 22);
        if (footOK(x, z, w, d, ry, 0.3)) B.far.push({ x, y: groundUnder(x, z, w, d, ry), z, sx: w, sy: R(7, 22), sz: d, ry, c: lin(pick(BLOCK_COLS)) });
      }
      continue;
    }
    if (tier === 1) {
      // The villages: houses under pitched roofs, a few small blocks of flats.
      for (let k = 0; k < 4; k++) {
        const w = R(10, 18), d = R(8, 12), [x, z] = W(bu + R(14, BU - 14), bv + R(12, BV - 12));
        const col = lin(pick(rand() < 0.6 ? VILLA_COLS : LAMELL_COLS));
        place('villa', x, z, w, d, R(3.5, 6.5), ry, col, { rise: d * 0.45, c: roofCol(0.5, 0.35) });
      }
      continue;
    }
    const D = districtAt(cx, cz);
    if (D === 'old') {
      // The old town: two- and three-storey houses shoulder to shoulder along the streets, steep tiled roofs, yards behind.
      for (let pu = ua; pu < ub - 5;) {
        const w = Math.min(R(7, 13), ub - pu);
        for (let row = 0; row < 2; row++) {
          const d = R(9, 13), pv = row ? vb - d / 2 - 0.4 : va + d / 2 + 0.4, [x, z] = W(pu + w / 2, pv);
          if (rand() < 0.05) continue;
          const fl = rand() < 0.5 ? 2 : rand() < 0.7 ? 3 : 1, col = lin(pick(OLD_COLS));
          place('old', x, z, w - 0.1, d, fl * 3.1 + 0.9, ry, col, { rise: d * R(0.42, 0.58), c: roofCol(0.55, 0.32) }, true);
        }
        pu += w;
      }
      if (rand() < 0.7) { const [tx, tz] = W(bu + BU / 2 + R(-8, 8), bv + BV / 2); if (!occAt(tx, tz)) addTree(tx, tz, R(9, 14), R(3.5, 5.5)); }
      continue;
    }
    if (D === 'block') {
      // Perimeter blocks of the decades round 1900 and the 1930s: four and five storeys along the street, courtyards behind.
      for (let pu = ua; pu < ub - 8;) {
        const w = Math.min(R(14, 26), ub - pu);
        for (let row = 0; row < 2; row++) {
          const d = R(11, 14), pv = row ? vb - d / 2 - 0.5 : va + d / 2 + 0.5, [x, z] = W(pu + w / 2, pv);
          if (rand() < 0.06) continue;
          const col = lin(pick(BLOCK_COLS)), h = Math.round(R(3, 5.4)) * 3.1 + 1.6;
          place('block', x, z, w - 0.1, d, h, ry, col, rand() < 0.6 ? { rise: d * 0.32, c: roofCol(0.45, 0.35) } : null, true);
        }
        pu += w;
      }
      for (let k = 0; k < 2; k++) { const [tx, tz] = W(bu + R(20, BU - 20), bv + BV / 2 + R(-6, 6)); if (!occAt(tx, tz)) addTree(tx, tz, R(10, 15), R(4, 6)); }
      continue;
    }
    if (D === 'lamell') {
      // Slab blocks in yellow brick on lawns: three or four storeys, now and then a tall one.
      [0.27, 0.73].forEach((t) => {
        if (rand() < 0.12) return;
        const L = Math.min(R(38, 70), ub - ua - 6), d = R(10.5, 12), [x, z] = W(bu + BU / 2 + R(-6, 6), bv + BV * t);
        const tall = rand() < 0.12, h = (tall ? Math.round(R(7, 9)) : Math.round(R(3, 4.4))) * 2.85 + 1.2, col = lin(pick(LAMELL_COLS));
        place('lamell', x, z, L, d, h, ry, col, !tall && rand() < 0.45 ? { rise: 2.4, c: roofCol(0.6, 0.3) } : null);
      });
      for (let k = 0; k < 4; k++) { const [tx, tz] = W(bu + R(8, BU - 8), bv + R(8, BV - 8)); if (!occAt(tx, tz)) addTree(tx, tz, R(9, 15), R(3.5, 6)); }
      continue;
    }
    if (D === 'modern') {
      // Brunnshög: new blocks of flats and labs, five to seven storeys, flat roofs, wood and brick and white render.
      for (let k = 0; k < 2; k++) {
        const w = R(30, 58), d = R(14, 18), [x, z] = W(bu + BU / 2, k ? vb - d / 2 - 2 : va + d / 2 + 2);
        const tall = rand() < 0.1, h = (tall ? Math.round(R(11, 15)) : Math.round(R(4, 7))) * 3.2 + 1.4;
        place('modern', x, z, w, d, h, ry, lin(pick(MODERN_COLS)), null);
      }
      for (let k = 0; k < 3; k++) { const [tx, tz] = W(bu + R(8, BU - 8), bv + BV / 2 + R(-8, 8)); if (!occAt(tx, tz)) addTree(tx, tz, R(6, 10), R(2.5, 4)); }
      continue;
    }
    if (D === 'radhus') {
      // Terraced houses, the Swedish radhus: long rows of two-storey homes with little gardens, three rows to a block.
      [0.2, 0.5, 0.8].forEach((t) => {
        if (rand() < 0.1) return;
        const d = R(8.5, 10), v = bv + BV * t, col = lin(pick(rand() < 0.5 ? LAMELL_COLS : VILLA_COLS)), roof = roofCol(0.5, 0.4), h = R(5.2, 6.2), rise = d * R(0.3, 0.42);
        for (let pu = ua + 3; pu < ub - 9; pu += 6.2) { const [x, z] = W(pu + 3.1, v); place('villa', x, z, 6.2, d, h, ry, col, { rise, c: roof }, true); }
      });
      for (let k = 0; k < 4; k++) { const [tx, tz] = W(bu + R(8, BU - 8), bv + R(8, BV - 8)); if (!occAt(tx, tz)) addTree(tx, tz, R(6, 11), R(2.5, 4.5)); }
      continue;
    }
    // Villas: one and a half or two storeys under steep roofs, in gardens with fruit trees and birches.
    for (let pu = ua; pu < ub - 8;) {
      const lot = Math.min(R(16, 24), ub - pu);
      for (let row = 0; row < 2; row++) {
        if (rand() < 0.1) continue;
        const across = rand() < 0.3, w = R(9, 13), d = R(8, 10.5), set = R(5, 10);
        const pv = row ? vb - d / 2 - set : va + d / 2 + set, [x, z] = W(pu + lot / 2 + R(-1.5, 1.5), pv);
        const col = lin(pick(VILLA_COLS));
        place('villa', x, z, Math.min(w, lot - 3), d, R(3.6, 5.8), ry, col, { rise: (across ? Math.min(w, lot - 3) : d) * R(0.42, 0.55), c: roofCol(0.45, 0.4), across });
        for (let k = 0; k < 2; k++) if (rand() < 0.75) { const [tx, tz] = W(pu + R(2, lot - 2), row ? vb - d - set - R(3, 10) : va + d + set + R(3, 10)); if (!occAt(tx, tz)) addTree(tx, tz, R(6, 13), R(2.5, 5)); }
      }
      pu += lot;
    }
  }
}
function buildCity() {
  const old = (x, z) => ringD(x, z) < RING_R - 18;
  cityRegion(old, 0.07, { BU: 58, BV: 46, SW: 7, ox: C0[0], oz: C0[1], sr: 700, span: 700 });
  const out = (x, z) => ringD(x, z) > RING_R + 18;
  cityRegion((x, z) => out(x, z) && z < -900, 0.2, {});
  cityRegion((x, z) => out(x, z) && z >= -900 && x < -400, -0.32, {});
  cityRegion((x, z) => out(x, z) && z >= -900 && x >= -400, 0.04, {});
  // Street mesh for the near town, and trees along it.
  const tri = [];
  CITY_STREETS.forEach(([x0, z0, x1, z1, w]) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / 20));
    const tx = (x1 - x0) / len, tz = (z1 - z0) / len, lx = tz * w / 2, lz = -tx * w / 2;
    for (let i = 0; i < n; i++) {
      const ax = x0 + (x1 - x0) * i / n, az = z0 + (z1 - z0) * i / n, bx = x0 + (x1 - x0) * (i + 1) / n, bz = z0 + (z1 - z0) * (i + 1) / n;
      const P = (x, z) => [x, baseHeight(x, z) + 0.1, z];
      const A1 = P(ax - lx, az - lz), A2 = P(ax + lx, az + lz), B1 = P(bx - lx, bz - lz), B2 = P(bx + lx, bz + lz);
      tri.push(...A1, ...A2, ...B1, ...A2, ...B2, ...B1);
      if (w > 8 && rand() < 0.4) { const sg = rand() < 0.5 ? -1 : 1, px = ax + lx * sg * 1.3, pz = az + lz * sg * 1.3; if (!occAt(px, pz)) addTree(px, pz, R(7, 11), R(2.8, 4.2)); }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  const sm = new THREE.Mesh(g, std('#5a5955', { roughness: 0.95 }));
  sm.receiveShadow = true; scene.add(sm);
}
function finishCity() {
  const S = {
    old: facadeMat('old', { floor: 3.1, bay: [2.6, 3.4], ww: [0.36, 0.46], wh: [0.5, 0.6], base: 0.7, shop: 0.7, glass: '#2b3036', roof: '#4a3a32', lit: 0.55 }),
    block: facadeMat('block', { floor: 3.1, bay: [2.6, 3.2], ww: [0.4, 0.52], wh: [0.5, 0.6], base: 1.6, shop: 0.5, glass: '#2b3238', roof: '#5a5654', lit: 0.5 }),
    lamell: facadeMat('lamell', { floor: 2.85, bay: [2.4, 3.2], ww: [0.5, 0.68], wh: [0.42, 0.52], base: 1.2, glass: '#2d3940', roof: '#6a6864', lit: 0.5 }),
    villa: facadeMat('villa', { floor: 2.8, bay: [3.0, 4.4], ww: [0.3, 0.45], wh: [0.42, 0.55], base: 0.6, glass: '#2e3338', roof: '#4a4a4a', rough: 0.9, lit: 0.55 }),
    modern: facadeMat('modern', { floor: 3.2, bay: [1.6, 2.4], ww: [0.62, 0.9], wh: [0.58, 0.76], base: 3.6, shop: 0.4, glass: '#33444f', roof: '#7a7a76', rough: 0.6, metal: 0.15, lit: 0.45 }),
    brick: facadeMat('brick', { floor: 3.6, bay: [2.0, 2.6], ww: [0.62, 0.74], wh: [0.42, 0.5], base: 1.0, glass: '#2b3238', roof: '#5c5a56', lit: 0.4 }),
    civic: facadeMat('civic', { floor: 5.4, bay: [3.2, 3.6], ww: [0.4, 0.44], wh: [0.56, 0.62], base: 1.4, glass: '#2b3036', roof: '#6b6f70', lit: 0.7 }),
    plain: facadeMat('plain', { floor: 30, bay: [8, 9], ww: [0, 0], wh: [0, 0], base: 0, glass: '#2d3236', roof: '#8e8c88', rough: 0.8, lit: 0 })
  };
  Object.keys(S).forEach((k) => instanced(unitBox, S[k], B[k], { cast: true, receive: true }));
  instanced(unitBox, facadeMat('far', { floor: 3.0, bay: [2.6, 3.6], ww: [0.45, 0.6], wh: [0.45, 0.55], base: 1, glass: '#2d3236', roof: '#6e6a66', rough: 0.85, lit: 0.5 }), B.far, { receive: true });
  instanced(GABLE.slopes, std('#ffffff', { roughness: 0.78 }), ROOF, { cast: true, receive: true });
  instanced(GABLE.ends, std('#ffffff', { roughness: 0.9 }), GABLE_END, { cast: true, receive: true });
}

// ---------------------------------------------------------------- Arena Lund
const signMats = [], glowMats = [];
let lightHeads, globes, marquee, clockHands, floods = [];
// Half length (east-west) and half depth of the drum; the plinth, the cornices of the three tiers, the dome's rise.
const A = 84, B_ = 64, PLINTH = 1.2, H1 = PLINTH + WALL_H, H2 = 31.5, H3 = 36.5, DOME_H = 11;
const ZF = B_ + 14;   // the front face of the entrance tower
// A rounded rectangle: the superellipse |x/a|^3 + |z/b|^3 = 1.
const superEll = (a, b, n = 96) => { const p = []; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); p.push([a * Math.sign(c) * Math.pow(Math.abs(c), 2 / 3), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / 3)]); } return p; };
const inArena = (x, z, m = 0) => Math.pow(Math.abs(x) / (A + m), 3) + Math.pow(Math.abs(z) / (B_ + m), 3) < 1;
const FOUNTAIN = [0, 156];
const PEOPLE_SPOTS = { doors: [], sources: [] };
// The car park west of the arena, in 16 m modules; the cycle park east of it.
const LOTS = [[-238, -128, -126, 116]];
const BIKE_LOT = [140, -20, 196, 48];
// Everything solid people must walk round.
const blockedAt = (x, z) => inArena(x, z, 3) || (Math.abs(x) < 26 && z > 40 && z < ZF + 1.5) || (Math.abs(x) > 78 && Math.abs(x) < 91.5 && Math.abs(z) < 15) ||
  Math.hypot(x - FOUNTAIN[0], z - FOUNTAIN[1]) < 15 || (Math.abs(Math.abs(x) - 31) < 3.5 && Math.abs(z - (ZF - 4)) < 3.5);
function buildArena() {
  const P0 = superEll(A, B_);
  const gold = std('#d9ad4a', { roughness: 0.28, metalness: 0.95 });
  const ivory = std('#e9e1cd', { roughness: 0.7 });
  const fluted = std('#ffffff', { map: TEX.fluted, roughness: 0.72 });
  const granite = std('#ffffff', { map: TEX.granite, roughness: 0.2, metalness: 0.2 });
  // Gold neon: the lines of the cornices and the tower's edges, lit after dark.
  const neon = std('#c99a3a', { emissive: lin('#ffc65a'), emissiveIntensity: 0.0, roughness: 0.35, metalness: 0.6 });
  glowMats.push([neon, 0.0, 3.2]);
  // A plinth of black granite, a step out from the walls.
  const PP = offsetPoly(P0, 2.2);
  addMesh(capPoly(PP, PLINTH, true, loft(PP, PP, 0, PLINTH, { uScale: 4, vScale: 4 }), 4).geo(), granite);
  // Tier one: the drum. Bays of 6 m, each a tall window between fluted piers that rise past the cornice.
  const nb = Math.round(perimeter(P0) / 6), bay = perimeter(P0) / nb;
  const wallM = std('#ffffff', { map: TEX.deco, emissive: 0xffffff, emissiveMap: TEX.decoE, emissiveIntensity: 0, roughness: 0.68 });
  glowMats.push([wallM, 0.0, 1.5]);
  addMesh(loft(P0, P0, PLINTH, H1, { uScale: bay, vScale: WALL_H }).geo(), wallM);
  const piers = [], steps = [], tips = [];
  let acc = 0;
  const sgn = Math.sign(polyArea(P0));
  for (let i = 0; i < P0.length; i++) {
    const a = P0[i], b = P0[(i + 1) % P0.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = edgeNormal(a, b, sgn);
    const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len, ry = Math.atan2(-tz, tx);
    for (let t = (bay - acc) % bay; t < len; t += bay) {
      const x = a[0] + tx * t + n[0] * 0.5, z = a[1] + tz * t + n[1] * 0.5;
      if ((Math.abs(x) < 34 && z > 0) || (Math.abs(z) < 14 && Math.abs(x) > 70)) continue;
      piers.push({ x, y: PLINTH, z, sx: 1.6, sy: H1 + 3.4 - PLINTH, sz: 1.4, ry });
      steps.push({ x: x + n[0] * -0.1, y: H1 + 3.4, z: z + n[1] * -0.1, sx: 1.0, sy: 1.5, sz: 0.9, ry });
      tips.push({ x: x + n[0] * -0.1, y: H1 + 4.9, z: z + n[1] * -0.1, sx: 0.42, sy: 1.1, sz: 0.42, ry });
    }
    acc = (acc + len) % bay;
  }
  instanced(boxGeoUV(1, 1, 1, 1, 4), fluted, piers, { cast: true, receive: true, parent: site });
  instanced(unitBox, ivory, steps, { cast: true, parent: site });
  instanced(unitBox, gold, tips, { cast: true, parent: site });
  // The cornice, a gold neon line under it, and the roof terrace.
  const cornice = (poly, y0, y1, out) => { const pc = offsetPoly(poly, out); addMesh(capPoly(pc, y1, true, loft(pc, pc, y0, y1, { uScale: 6, vScale: 1 }), 6).geo(), ivory); };
  const neonLine = (poly, y0, y1, out) => { const pn = offsetPoly(poly, out); addMesh(loft(pn, pn, y0, y1, { uScale: 6, vScale: 1 }).geo(), neon, site, false, false); };
  cornice(P0, H1 - 0.3, H1 + 0.9, 0.8); neonLine(P0, H1 - 0.85, H1 - 0.35, 0.3);
  // Tier two: set back 7 m, a deep green frieze of lit slots between gold zigzags.
  const P2 = offsetPoly(P0, -7), n2 = Math.round(perimeter(P2) / 4);
  const friezeM = std('#ffffff', { map: TEX.frieze, emissive: 0xffffff, emissiveMap: TEX.friezeE, emissiveIntensity: 0, roughness: 0.6, metalness: 0.15 });
  glowMats.push([friezeM, 0.0, 1.4]);
  addMesh(loft(P2, P2, H1 + 0.9, H2, { uScale: perimeter(P2) / n2, vScale: H2 - H1 - 0.9 }).geo(), friezeM);
  cornice(P2, H2 - 0.2, H2 + 0.6, 0.6); neonLine(P2, H2 - 0.7, H2 - 0.25, 0.25);
  // Tier three: set back again, fluted, a gold band at the top.
  const P3 = offsetPoly(P0, -13);
  addMesh(loft(P3, P3, H2 + 0.6, H3, { uScale: 3, vScale: 3 }).geo(), fluted);
  const PB = offsetPoly(P3, 0.5);
  addMesh(capPoly(PB, H3 + 0.7, true, loft(PB, PB, H3, H3 + 0.7, { uScale: 6, vScale: 1 }), 6).geo(), gold);
  // The dome: ribbed verdigris copper rising from the third tier to a glazed lantern.
  const PD = offsetPoly(P0, -13.4), K = 12, FT = 0.15, RIBS = 48, nD = PD.length, y0 = H3 + 0.7;
  const ring = (k) => { const f = 1 - k / K * (1 - FT); return { f, y: y0 + DOME_H * (1 - f * f) / (1 - FT * FT) }; };
  const dg = new GB();
  for (let k = 0; k < K; k++) {
    const r0 = ring(k), r1 = ring(k + 1);
    for (let i = 0; i < nD; i++) {
      const j = (i + 1) % nD, p = PD[i], q = PD[j];
      const a = [p[0] * r0.f, r0.y, p[1] * r0.f], b = [q[0] * r0.f, r0.y, q[1] * r0.f], c = [q[0] * r1.f, r1.y, q[1] * r1.f], d = [p[0] * r1.f, r1.y, p[1] * r1.f];
      const u0 = i / nD * RIBS, u1 = (i + 1) / nD * RIBS, mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2, ml = Math.hypot(mx, mz) || 1;
      dg.quad(a, b, c, d, [u0, k * 0.5], [u1, k * 0.5], [u1, (k + 1) * 0.5], [u0, (k + 1) * 0.5], [mx / ml, 0.6, mz / ml]);
    }
  }
  addMesh(dg.geo(), std('#ffffff', { map: TEX.copper, roughness: 0.55, metalness: 0.35 }));
  // The lantern: a ring of glass that glows at night under a gold cornice, a little copper cap, a gold spire.
  const top = ring(K), PLn = PD.map(([x, z]) => [x * FT, z * FT]);
  const lg = std('#ffffff', { map: TEX.glassGrid, emissive: 0xffffff, emissiveMap: TEX.glassGridE, emissiveIntensity: 0.05, roughness: 0.12, metalness: 0.5 });
  glowMats.push([lg, 0.05, 2.0]);
  addMesh(loft(PLn, PLn, top.y, top.y + 5, { uScale: 6, vScale: 5 }).geo(), lg);
  const PLc = offsetPoly(PLn, 0.5);
  addMesh(capPoly(PLc, top.y + 5.6, true, loft(PLc, PLc, top.y + 5, top.y + 5.6, { uScale: 6, vScale: 1 })).geo(), gold);
  const capG = new GB();
  for (let k = 0; k < 5; k++) {
    const f0 = 1 - k / 5, f1 = 1 - (k + 1) / 5, ya = top.y + 5.6 + 3 * (1 - f0 * f0), yb = top.y + 5.6 + 3 * (1 - f1 * f1);
    loft(PLc.map(([x, z]) => [x * f0, z * f0]), PLc.map(([x, z]) => [x * f1, z * f1]), ya, yb, { uScale: 3, vScale: 3, gb: capG });
  }
  addMesh(capG.geo(), std('#ffffff', { map: TEX.copper, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide }));
  mesh(new THREE.SphereGeometry(1.1, 16, 12), gold, 0, top.y + 9.4, 0, site);
  mesh(new THREE.ConeGeometry(0.45, 12, 12).translate(0, 6, 0), gold, 0, top.y + 10, 0, site);

  // ---- The entrance tower, facing south down the plaza: three stepped blocks, a fin and a spire.
  const blk = (w, h, d, x, y, z, m = fluted) => { const k = new THREE.Mesh(boxGeoUV(w, h, d, 3, 3), m); k.position.set(x, y, z); k.castShadow = k.receiveShadow = true; site.add(k); return k; };
  const band = (w, d, y, z, m = gold) => { const k = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), m); k.position.set(0, y, z); k.castShadow = true; site.add(k); };
  blk(48, 28 - PLINTH, 26, 0, PLINTH, ZF - 13);
  blk(32, 12, 20, 0, 28, ZF - 2 - 10);
  blk(20, 9, 13, 0, 40, ZF - 4 - 6.5);
  blk(3.4, 10, 6, 0, 49, ZF - 6 - 3);
  band(48.8, 26.8, 28.1, ZF - 13); band(32.8, 20.8, 40.1, ZF - 12); band(20.8, 13.8, 49.1, ZF - 10.5);
  mesh(new THREE.SphereGeometry(0.9, 16, 12), gold, 0, 59.6, ZF - 9, site);
  mesh(new THREE.ConeGeometry(0.4, 10, 12).translate(0, 5, 0), gold, 0, 60, ZF - 9, site);
  // Gold neon up the tower's corners and the fin.
  const nl = [];
  [[24.1, PLINTH, 27 - PLINTH, ZF + 0.1], [16.1, 28.7, 11.3, ZF - 1.9], [10.1, 40.7, 8.3, ZF - 3.9]].forEach(([x, y, h, z]) => [-1, 1].forEach((sg) => nl.push({ x: sg * x, y, z, sx: 0.35, sy: h, sz: 0.35 })));
  nl.push({ x: 0, y: 49.7, z: ZF - 5.9, sx: 0.35, sy: 9.3, sz: 0.35 });
  instanced(unitBox, neon, nl, { parent: site });
  // Gold fins on the middle block, either side of the clock; slot windows in the top block.
  const fins = [];
  [-13.5, -10.5, 10.5, 13.5].forEach((x) => fins.push({ x, y: 28.7, z: ZF - 1.6, sx: 0.5, sy: 11.3, sz: 0.9 }));
  [-7.5, -2.5, 2.5, 7.5].forEach((x) => fins.push({ x, y: 40.7, z: ZF - 3.6, sx: 0.4, sy: 8.3, sz: 0.8 }));
  instanced(unitBox, gold, fins, { cast: true, parent: site });
  const slotM = std('#2a3238', { emissive: lin('#ffcf8a'), emissiveIntensity: 0.0, roughness: 0.2, metalness: 0.4 });
  glowMats.push([slotM, 0.0, 1.8]);
  [-5, 0, 5].forEach((x) => { const s = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 7), slotM); s.position.set(x, 44.8, ZF - 3.95); site.add(s); });
  // The clock: the scene's own time, on the face of the middle block.
  const ct = clockTexture();
  const cm = std('#ffffff', { map: ct, emissive: 0xffffff, emissiveMap: ct, emissiveIntensity: 0.0, roughness: 0.4, metalness: 0.1 });
  signMats.push(cm);
  const face = new THREE.Mesh(new THREE.CircleGeometry(4.4, 48), cm); face.position.set(0, 34.2, ZF - 1.94); site.add(face);
  const handM = std('#141614', { roughness: 0.4, metalness: 0.5 });
  const hand = (len, w) => { const g = new THREE.Group(); const k = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.12).translate(0, len / 2 - 0.3, 0), handM); g.add(k); g.position.set(0, 34.2, ZF - 1.82); site.add(g); return g; };
  clockHands = { h: hand(2.4, 0.36), m: hand(3.5, 0.24) };
  // The portal: glass doors lit from inside, nested stepped frames, the sunburst over the canopy.
  const doors = std('#1f1d18', { emissive: lin('#ffd49a'), emissiveIntensity: 0.6, roughness: 0.3 });
  glowMats.push([doors, 0.45, 1.7]);
  const dm = new THREE.Mesh(new THREE.PlaneGeometry(20, 6.6), doors); dm.position.set(0, PLINTH + 3.3, ZF + 0.06); site.add(dm);
  for (let x = -9; x <= 9; x += 3) PEOPLE_SPOTS.doors.push([x, ZF + 2]);
  const black = std('#151716', { roughness: 0.35, metalness: 0.3 });
  [[22, 20.4, gold, 0.5], [24.4, 21.4, ivory, 0.32], [26.8, 22.4, black, 0.16]].forEach(([W, Ht, m, dz]) => {
    [-1, 1].forEach((sg) => { const j = new THREE.Mesh(unitBox, m); j.scale.set(1.0, Ht - PLINTH, 0.6); j.position.set(sg * W / 2, PLINTH, ZF + dz); j.castShadow = true; site.add(j); });
    const l = new THREE.Mesh(unitBox, m); l.scale.set(W + 1, 1.0, 0.6); l.position.set(0, Ht, ZF + dz); l.castShadow = true; site.add(l);
  });
  const sb = std('#ffffff', { map: TEX.sunburst, emissive: 0xffffff, emissiveMap: TEX.sunburstE, emissiveIntensity: 0, roughness: 0.3, metalness: 0.5 });
  glowMats.push([sb, 0.0, 1.2]);
  const sun1 = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), sb); sun1.position.set(0, 15.1, ZF + 0.05); site.add(sun1);
  // The name, across the tower above the portal.
  const tex = arenaSignTexture();
  const sm = std('#ffffff', { map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.05, roughness: 0.35, metalness: 0.3 });
  signMats.push(sm);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(44, 4), sm); sign.position.set(0, 25.75, ZF + 0.06); site.add(sign);
  // The canopy: a slab over the doors, its edges a marquee of bulbs and changing bills.
  const canopy = new THREE.Mesh(boxGeoUV(36, 2.4, 12, 3), ivory); canopy.position.set(0, 7.6, ZF + 6); canopy.castShadow = true; site.add(canopy);
  [7.5, 10.1].forEach((y) => { const t = new THREE.Mesh(new THREE.BoxGeometry(36.6, 0.28, 12.6), gold); t.position.set(0, y, ZF + 6); site.add(t); });
  const slides = marqueeSlides();
  const mqM = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: slides[0], emissiveIntensity: 0.9, roughness: 0.4 });
  marquee = { mat: mqM, slides, i: 0, t: 0 };
  const mq = new THREE.Mesh(new THREE.PlaneGeometry(36, 2.0), mqM); mq.position.set(0, 8.8, ZF + 12.04); site.add(mq);
  [-1, 1].forEach((sg) => { const s = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.0), mqM); s.position.set(sg * 18.04, 8.8, ZF + 6); s.rotation.y = sg * Math.PI / 2; site.add(s); });
  const dl = std('#ffffff', { emissive: lin('#ffe2b0'), emissiveIntensity: 0.2 });
  glowMats.push([dl, 0.2, 3]);
  const dls = []; for (let x = -15; x <= 15; x += 3) for (let z = ZF + 1.5; z <= ZF + 11; z += 3) dls.push({ x, y: 7.55, z, sx: 0.6, sy: 0.04, sz: 0.6 });
  instanced(unitBox, dl, dls, { parent: site });
  // Pylons either side of the tower: stepped shafts carrying great glass globes.
  const glob = std('#fff6e4', { emissive: lin('#ffe0a8'), emissiveIntensity: 0.15, roughness: 0.2 });
  glowMats.push([glob, 0.15, 3.0]);
  [-1, 1].forEach((sg) => {
    const x = sg * 31, z = ZF - 4;
    blk(4.4, 26, 4.4, x, PLINTH, z); blk(3.2, 3, 3.2, x, PLINTH + 26, z, ivory); blk(2.0, 2.2, 2.0, x, PLINTH + 29, z, gold);
    [8, 16, 24].forEach((y) => { const r = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.45, 4.8), gold); r.position.set(x, y, z); site.add(r); });
    mesh(new THREE.SphereGeometry(1.5, 24, 16), glob, x, PLINTH + 32.7, z, site, false);
  });
  // Side entrances east and west: small stepped porches with their own sunbursts.
  [-1, 1].forEach((sg) => {
    const x = sg * (A + 1.5);
    const k = blk(9, 18 - PLINTH, 24, x, PLINTH, 0); k.castShadow = true;
    const t = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.7, 24.6), gold); t.position.set(x, 18.1, 0); site.add(t);
    const d2 = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), doors); d2.position.set(x + sg * 4.56, PLINTH + 2.5, 0); d2.rotation.y = sg * Math.PI / 2; site.add(d2);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(13, 6.5), sb); s2.position.set(x + sg * 4.56, 10.6, 0); s2.rotation.y = sg * Math.PI / 2; site.add(s2);
    for (let z = -4; z <= 4; z += 4) PEOPLE_SPOTS.doors.push([sg * (A + 8), z]);
  });
  // Floodlights in the plaza, aimed up at the tower after dark.
  [-1, 1].forEach((sg) => {
    const f = new THREE.SpotLight(0xffe2b8, 0, 240, 0.3, 0.6, 1.2);
    f.position.set(sg * 42, 1.5, ZF + 80); f.target.position.set(0, 32, ZF - 4); site.add(f, f.target); floods.push(f);
  });
  // North: the service yard, the loading docks and tonight's tour trucks.
  const truck = std('#f1f1ee', { roughness: 0.5 });
  [[-34, '#1b2925'], [-12, '#7a2d8c'], [10, '#2a2a2c'], [32, '#b7372b']].forEach(([x, cab]) => {
    const t = new THREE.Mesh(unitBox, truck); t.scale.set(16, 4.1, 2.6); t.position.set(x, 0.1, -B_ - 30); t.castShadow = true; site.add(t);
    const c = new THREE.Mesh(unitBox, std(cab, { roughness: 0.4, metalness: 0.3 })); c.scale.set(3.2, 3.3, 2.5); c.position.set(x + 10.2, 0.1, -B_ - 30); c.castShadow = true; site.add(c);
  });
  const dock = blk(56, 7, 10, 0, 0, -B_ - 3, ivory); dock.castShadow = true;
}
// The fountain at the head of the plaza: a stepped granite basin, jets, a gilded armillary globe on an ivory column.
let jetMat;
function buildFountain() {
  const [fx, fz] = FOUNTAIN;
  const granite = std('#ffffff', { map: TEX.granite, roughness: 0.2, metalness: 0.2 });
  const ivory = std('#e9e1cd', { roughness: 0.7 }), gold = std('#d9ad4a', { roughness: 0.25, metalness: 1 });
  const g = new THREE.Group(); g.position.set(fx, 0.14, fz); site.add(g);
  const add = (geo, m, y, cast = true) => { const k = new THREE.Mesh(geo, m); k.position.y = y; k.castShadow = cast; k.receiveShadow = true; g.add(k); return k; };
  add(new THREE.CylinderGeometry(13, 13.4, 0.8, 64, 1, true).translate(0, 0.4, 0), granite, 0);
  add(new THREE.RingGeometry(12.2, 13.2, 64).rotateX(-Math.PI / 2), granite, 0.8);
  add(new THREE.CircleGeometry(12.3, 64).rotateX(-Math.PI / 2), waterMat, 0.6, false);
  add(new THREE.CylinderGeometry(4.6, 4.8, 0.6, 48).translate(0, 0.3, 0), granite, 0.5);
  add(new THREE.CylinderGeometry(3.2, 3.4, 1.4, 48).translate(0, 0.7, 0), ivory, 1.1);
  add(new THREE.CylinderGeometry(1.4, 2.0, 4.2, 32).translate(0, 2.1, 0), ivory, 2.5);
  add(new THREE.CylinderGeometry(1.8, 1.8, 0.4, 32).translate(0, 0.2, 0), gold, 6.7);
  add(new THREE.SphereGeometry(1.2, 24, 16), gold, 8.7);
  [[0, 0], [Math.PI / 2, 0], [Math.PI / 2, 0.5]].forEach(([rx, ry]) => { const t = add(new THREE.TorusGeometry(2.2, 0.08, 8, 48), gold, 8.7); t.rotation.set(rx, ry, 0.4); });
  add(new THREE.ConeGeometry(0.3, 2.5, 12).translate(0, 1.25, 0), gold, 10.8);
  // The jets: eight arcs of white water falling into the basin.
  jetMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, roughness: 0.1, emissive: lin('#cfe8ff'), emissiveIntensity: 0, depthWrite: false });
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2, pts = [];
    for (let t = 0; t <= 12; t++) { const s = t / 12, r = 4.7 + s * 5.5; pts.push(new THREE.Vector3(Math.cos(a) * r, 1.1 + 4.2 * s * (1 - s) * 2.2 - s * 0.6, Math.sin(a) * r)); }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.18, 6, false), jetMat); g.add(tube);
  }
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 5.5, 8, 1, true).translate(0, 2.75, 0), jetMat); c.position.y = 11.5; g.add(c);
  occMark(fx, fz, 30, 30, 0);
}
async function buildPrecinct() {
  // Grounds: lawn everywhere, then the car park, the cycle park, the plaza, the drop-off and the service yard.
  batchRect('lawn', PRECINCT[0], PRECINCT[1], PRECINCT[2], PRECINCT[3], 0.05, (x, z) => [x / 10, z / 10]);
  LOTS.forEach(([x0, z0, x1, z1]) => batchRect('lot', x0, z0, x1, z1, 0.09, (x, z) => [(x - x0) / 5, (z - z0) / 16]));
  const asph = (x0, z0, x1, z1) => batchRect('asph', x0, z0, x1, z1, 0.1, (x, z) => [x / 8, z / 8]);
  const terr = (x0, z0, x1, z1) => batchRect('terrazzo', x0, z0, x1, z1, 0.14, (x, z) => [x / 16, (z - 2) / 16]);
  const walk = (x0, z0, x1, z1) => batchRect('walk', x0, z0, x1, z1, 0.12, (x, z) => [x / 4, z / 4]);
  // Aisles round the car park, the drop-off lane in front, the yard behind.
  asph(-246, -138, -118, -128); asph(-246, 116, -118, 126); asph(-246, -138, -238, 126); asph(-126, -138, -118, 126);
  asph(-200, 228, 200, 240); asph(-110, -B_ - 48, 110, -B_ + 2);
  // The plaza: terrazzo from the doors to the drop-off, a promenade all round the drum.
  terr(-112, 66, 112, 228);
  walk(-112, -B_ - 4, -100, 66); walk(100, -B_ - 4, 112, 66);
  walk(BIKE_LOT[0], BIKE_LOT[1], BIKE_LOT[2], BIKE_LOT[3]);
  walk(-246, 140, -112, 152); walk(112, 140, 246, 152); walk(-246, 240, 246, 248);
  // Limes in double rows down both sides of the plaza, a ring of trees round the drum, a hedge of trees along the avenue.
  const lime = [lin('#8a8236'), lin('#9c8a3a'), lin('#a8883c'), lin('#7a7c3a'), lin('#6a7436')];
  for (let z = 92; z <= 220; z += 11) [-1, 1].forEach((sg) => { addTree(sg * 82, z, R(13, 15), R(4.2, 5), 0, pick(lime)); addTree(sg * 97, z + 5, R(13, 15), R(4.2, 5), 0, pick(lime)); });
  for (let i = 0; i < 44; i++) { const a = i / 44 * Math.PI * 2, x = Math.cos(a) * (A + 16), z = Math.sin(a) * (B_ + 16); if (z < 20 && z > -B_ - 8 && Math.abs(x) < 104 && !(Math.abs(z) < 18 && Math.abs(x) > 80)) addTree(x, z, R(10, 14), R(3.5, 5)); }
  for (let x = -240; x <= 240; x += 14) addTree(x, 244 + R(-1, 1), R(10, 14), R(4, 5.5));
  for (let z = -160; z <= 110; z += 15) { addTree(-112, z, R(9, 12), R(3.5, 5)); addTree(116, z, R(9, 12), R(3.5, 5)); }
  // Copses on the lawns east of the arena and round the cycle park.
  for (let i = 0; i < 70; i++) {
    const x = R(124, 244), z = R(-160, 230);
    if (x > BIKE_LOT[0] - 6 && x < BIKE_LOT[2] + 6 && z > BIKE_LOT[1] - 6 && z < BIKE_LOT[3] + 6) continue;
    if (z > 136 && z < 156) continue;
    addTree(x, z, R(10, 16), R(4, 6.5));
  }
  for (let i = 0; i < 18; i++) { const x = R(-244, -126), z = R(132, 236); if (z > 136 && z < 156) continue; addTree(x, z, R(10, 15), R(4, 6)); }

  buildArena();
  buildFountain();

  // Flags by the plaza: Sweden, Skåne, the arena.
  const poleMat = std('#d9dcdd', { metalness: 0.7, roughness: 0.3 });
  [[-60, swedenFlag()], [-52, skaneFlag()], [-44, arenaFlag()], [44, arenaFlag()], [52, skaneFlag()], [60, swedenFlag()]].forEach(([x, tex], i) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 14, 8).translate(0, 7, 0), poleMat); pole.position.set(x, 0.1, 214); pole.castShadow = true; site.add(pole);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.25, 10, 1), std('#ffffff', { map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
    const p = f.geometry.attributes.position;
    for (let k = 0; k < p.count; k++) p.setZ(k, Math.sin((p.getX(k) + 1.8) * 2.0 + i) * 0.2 * (p.getX(k) + 1.8) / 3.6);
    f.geometry.computeVertexNormals();
    f.position.set(x + 1.8, 12.7, 214); f.castShadow = true; site.add(f);
  });

  // Lamps: deco lanterns with glass globes down the plaza; masts in the car park.
  const poles = [], heads = [], gl = [];
  const lamp = (x, z, h, n = 2) => { poles.push({ x, y: 0, z, sx: 0.3, sy: h, sz: 0.3 }); for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; heads.push({ x: x + Math.cos(a) * 1.1, y: h - 0.3, z: z - Math.sin(a) * 1.1, sx: 1.8, sy: 0.3, sz: 0.7, ry: a }); } };
  const lantern = (x, z) => { poles.push({ x, y: 0.14, z, sx: 0.2, sy: 4.6, sz: 0.2 }); gl.push({ x, y: 5.0, z, sx: 1, sy: 1, sz: 1 }); };
  LOTS.forEach(([x0, z0, x1, z1]) => {
    for (let z = z0 + 16; z < z1 - 5; z += 32) for (let x = x0 + 18; x < x1 - 5; x += 40) lamp(x, z, 11);
    PEOPLE_SPOTS.sources.push([(x0 + x1) / 2, (z0 + z1) / 2, 1, x0, z0, x1, z1]);
  });
  for (let z = 96; z <= 224; z += 16) [-1, 1].forEach((sg) => { lantern(sg * 58, z); lantern(sg * 110, z + 8); });
  for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2, x = Math.cos(a) * (A + 8), z = Math.sin(a) * (B_ + 8); if (!(Math.abs(x) < 36 && z > 0) && !(Math.abs(z) < 16 && Math.abs(x) > 80)) lantern(x, z); }
  instanced(unitBox, std('#22262a', { metalness: 0.6, roughness: 0.4 }), poles, { parent: site });
  lightHeads = instanced(unitBox, std('#dddddd', { emissive: lin('#ffd9a0'), emissiveIntensity: 0 }), heads, { parent: site });
  globes = instanced(new THREE.SphereGeometry(0.45, 14, 10), std('#fff6e4', { emissive: lin('#ffe0a8'), emissiveIntensity: 0.1, roughness: 0.2 }), gl, { parent: site });
  // People come from the car park, the cycle park, the bus stops on the avenue and the town to the north.
  PEOPLE_SPOTS.sources.push([...BIKE_LOT.slice(0, 2).map((v, k) => v + (BIKE_LOT[k + 2] - v) / 2), 2.2, ...BIKE_LOT]);
  PEOPLE_SPOTS.sources.push([-150, 248, 1.4], [150, 248, 1.4], [-80, -160, 1.2], [80, -160, 1.2], [-240, 60, 0.6], [240, 150, 0.6]);
  // Green city buses and taxis at the drop-off.
  const vans = [];
  for (let x = -190; x < 190; x += 15) if (Math.abs(x) > 28 && rand() < 0.5) vans.push({ x, y: 0.1, z: 234, sx: 12, sy: 3.1, sz: 2.55, c: lin(pick(['#5c9a3a', '#5c9a3a', '#e8b11a', '#f2f2ef', '#2a2a2c'])) });
  instanced(unitBox, std('#ffffff', { roughness: 0.45, metalness: 0.3 }), vans, { cast: true, parent: site });
  instanced(unitBox, std('#1b2127', { roughness: 0.1, metalness: 0.6 }), vans.map((c) => ({ x: c.x, y: 1.8, z: c.z, sx: 11.6, sy: 1.0, sz: 2.6 })), { parent: site });
}
// Street lights on the main roads: placed once the town's streets exist, so none stands in a road.
function buildStreetLamps() {
  const poles = [], heads = [];
  LAMP_ROADS.forEach(({ pts, off, median }) => {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
      if (acc < (median ? 50 : 34)) continue;
      acc = 0;
      const lat = laterals([pts[i - 1], pts[i]])[0];
      if (median) {
        const x = pts[i][0], z = pts[i][2];
        if (Math.hypot(x, z) > 5000) continue;
        const y = pts[i][1] - 0.2, ry = Math.atan2(lat[1], -lat[0]);
        poles.push({ x, y, z, sx: 0.35, sy: 13, sz: 0.35 });
        [-1, 1].forEach((sg) => heads.push({ x: x + sg * 1.4 * Math.cos(ry), y: y + 12.7, z: z - sg * 1.4 * Math.sin(ry), sx: 2.2, sy: 0.3, sz: 0.8, ry }));
        continue;
      }
      for (const sg of [-1, 1]) {
        const x = pts[i][0] + lat[0] * off * sg, z = pts[i][2] + lat[1] * off * sg;
        if (Math.hypot(x, z) > 3400 || ROADWAY.clearance(x, z) < 0.4 || STREETS.clearance(x, z) < 0.4) continue;
        const y = pts[i][1] - 0.2, ry = Math.atan2(lat[1] * sg, -lat[0] * sg);
        poles.push({ x, y, z, sx: 0.25, sy: 9, sz: 0.25 });
        heads.push({ x: x + 1.1 * Math.cos(ry), y: y + 8.7, z: z - 1.1 * Math.sin(ry), sx: 1.8, sy: 0.3, sz: 0.7, ry });
      }
    }
  });
  instanced(unitBox, std('#3a4046', { metalness: 0.6, roughness: 0.4 }), poles);
  instanced(unitBox, lightHeads.material, heads);
}

// ---------------------------------------------------------------- camera
function resetView() {
  const c = (QS.get('cam') || '').split(',').map(Number);
  if (c.length === 6 && c.every(Number.isFinite)) { camera.position.set(c[0], c[1], c[2]); controls.target.set(c[3], c[4], c[5]); }
  else if (camera.aspect < 0.8) { camera.position.set(230, 120, 560); controls.target.set(-40, 30, -40); }
  else { camera.position.set(250, 78, 380); controls.target.set(-30, 28, -40); }
  controls.update();
}
function clampCamera() {
  const g = Math.max(landHeight(camera.position.x, camera.position.z), SEA_Y) + 1.6;
  if (camera.position.y < g) camera.position.y = g;
}

// ---------------------------------------------------------------- trees
function buildVegetation() {
  // The parks: Stadsparken's old trees, the botanical garden, Lundagård's elms and limes, the cemetery, Sankt Hans backar's copses.
  for (let i = 0; i < (MOBILE ? 4000 : 9000); i++) {
    const x = R(-3400, 3400), z = R(-3400, 3400), r = Math.hypot(x, z);
    if (r < 300 || !inAny(x, z, PARKS)) continue;
    if (occAt(x, z) || OBST.clearance(x, z) < 2) continue;
    if (Math.hypot(x - SHB[0], z - SHB[1]) < 300 && rand() < 0.75) continue;
    addTree(x, z, R(12, 22), R(4.5, 8), rand() < 0.12 ? 1 : 0);
  }
  // Willows and alders along Höje å.
  RIVERS[0].line.forEach(([x, z], i) => {
    if (Math.hypot(x, z) > 3500 || rand() < 0.35) return;
    [-1, 1].forEach((sg) => addTree(x + R(-4, 4), z + sg * R(10, 16), R(8, 13), R(3.5, 5.5), 0, lin(pick(['#7a8a3e', '#8a9a46', '#6d7d38', '#9a9440']))));
  });
  // Woodlots near the town, in 3D where they're close enough to read.
  for (let i = 0; i < (MOBILE ? 3000 : 7000); i++) {
    const x = R(-5200, 5200), z = R(-5200, 5200);
    if (Math.hypot(x, z) < 1500 || woodsAt(x, z) < 0.55 || urbanAt(x, z) > 0.3 || OBST.clearance(x, z) < 3 || occAt(x, z)) continue;
    farTrees.push({ x, z, h: R(14, 22), r: R(4.5, 7.5) });
  }
  // A last sweep: nothing in a carriageway or a street.
  for (let i = treeItems.length - 1; i >= 0; i--) { const t = treeItems[i]; if (ROADWAY.clearance(t.x, t.z) < 0.6 || STREETS.clearance(t.x, t.z) < 0.6) treeItems.splice(i, 1); }

  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1, 5, 1, true).translate(0, 0.5, 0);
  const hi = new THREE.IcosahedronGeometry(1, 1), lo = new THREE.IcosahedronGeometry(1, 0);
  // Smooth normals on the near crowns, so they read as foliage, not facets.
  { const p = hi.attributes.position, n = hi.attributes.normal, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); n.setXYZ(i, v.x, v.y, v.z); } }
  const cone = new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0);
  const T = { trunkN: [], trunkF: [], hi: [], lo: [], cone: [] };
  treeItems.forEach((t) => {
    const near = Math.hypot(t.x, t.z) < 2200;
    if (t.kind === 1) {
      // Spruce: a dark cone.
      T.cone.push({ x: t.x, y: t.y + t.h * 0.1, z: t.z, sx: t.r * 0.8, sy: t.h * 0.95, sz: t.r * 0.8, c: lin(pick(['#2a4226', '#30482a', '#26392a'])) });
      (near ? T.trunkN : T.trunkF).push({ x: t.x, y: t.y, z: t.z, sx: t.r * 0.6, sy: t.h * 0.2, sz: t.r * 0.6, c: lin('#4a3a2c') });
      return;
    }
    const wide = rand() < 0.35, ry = wide ? 0.3 : 0.42;
    (near ? T.trunkN : T.trunkF).push({ x: t.x, y: t.y, z: t.z, sx: t.r * 0.9, sy: t.h * 0.58, sz: t.r * 0.9, c: lin(rand() < 0.15 ? '#d8d4c8' : '#5a4a3a') });
    (near ? T.hi : T.lo).push({ x: t.x, y: t.y + t.h * (wide ? 0.7 : 0.62), z: t.z, sx: t.r * (wide ? 1.3 : 1), sy: t.h * ry, sz: t.r * (wide ? 1.25 : R(0.85, 1.1)), ry: rand() * 3, c: t.c });
  });
  farTrees.forEach((t) => {
    const y = baseHeight(t.x, t.z);
    if (rand() < 0.2) { T.cone.push({ x: t.x, y, z: t.z, sx: t.r * 0.7, sy: t.h, sz: t.r * 0.7, c: lin('#2c4428') }); return; }
    T.lo.push({ x: t.x, y: y + t.h * 0.6, z: t.z, sx: t.r, sy: t.h * 0.42, sz: t.r, ry: rand() * 3, c: pick(LEAVES) });
  });
  const bark = std('#ffffff', { roughness: 1 }), leaf = std('#ffffff', { roughness: 0.95 });
  instanced(trunkGeo, bark, T.trunkN, { cast: true });
  instanced(trunkGeo, bark, T.trunkF);
  instanced(hi, leaf, T.hi, { cast: true, receive: true });
  instanced(lo, std('#ffffff', { roughness: 0.95, flatShading: true }), T.lo, { receive: true });
  instanced(cone, std('#ffffff', { roughness: 0.95, flatShading: true }), T.cone, { cast: true, receive: true });
}

// ---------------------------------------------------------------- cars (parked and moving), vans and buses; bicycles
let CAR_GEOS;
const CAR_COLS = [['#f2f2ef', 22], ['#1c1f23', 22], ['#8a8e92', 20], ['#c3c6c9', 16], ['#9a1f1f', 6], ['#23427a', 7], ['#5b5f64', 4], ['#2f5a3a', 2], ['#7a6a4a', 1]];
const carColor = () => { let r = rand() * 100; for (const [c, w] of CAR_COLS) { r -= w; if (r <= 0) return lin(c); } return lin('#ffffff'); };
function carGeos() {
  const carBody = new THREE.BoxGeometry(4.5, 0.8, 1.84).translate(0, 0.62, 0);
  const carTop = merge([new THREE.BoxGeometry(2.6, 0.58, 1.64).translate(-0.3, 1.3, 0), new THREE.BoxGeometry(3.3, 0.4, 1.86).translate(0, 0.27, 0)]);
  const bodyMat = std('#ffffff', { roughness: 0.32, metalness: 0.5 }), glassMat = std('#1b2127', { roughness: 0.12, metalness: 0.6 });
  CAR_GEOS = { carBody, carTop, bodyMat, glassMat };
}
// A bicycle, 1.75 m long along x: two wheels, a diamond frame, saddle and handlebars.
function bikeGeos() {
  const wheel = (x) => new THREE.RingGeometry(0.29, 0.35, 16).translate(x, 0.35, 0);
  const wheels = merge([wheel(-0.54), wheel(0.54)]);
  const bar = (a, b, t = 0.045) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return new THREE.BoxGeometry(l, t, t).rotateZ(Math.atan2(dy, dx)).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0); };
  const frame = merge([bar([-0.12, 0.86], [0.42, 0.88]), bar([0.42, 0.86], [0.0, 0.36]), bar([-0.14, 0.95], [0.0, 0.36]), bar([0.0, 0.36], [-0.54, 0.35]),
    bar([-0.12, 0.88], [-0.54, 0.35]), bar([0.45, 0.98], [0.54, 0.35]), new THREE.BoxGeometry(0.06, 0.06, 0.56).translate(0.44, 1.02, 0), new THREE.BoxGeometry(0.26, 0.06, 0.12).translate(-0.16, 0.97, 0)]);
  return { wheels, frame };
}
const PARKED = [], BIKES_PARKED = [];
function buildParked() {
  const items = [];
  LOTS.forEach(([x0, z0, x1, z1]) => {
    for (let z = z0; z + 16 <= z1 + 0.01; z += 16) for (let x = x0; x + 2.5 <= x1; x += 2.5) {
      [[2.5, 1], [13.5, -1]].forEach(([oz, dir]) => { if (rand() < 0.78) items.push({ x: x + 1.25 + R(-0.1, 0.1), y: 0.09, z: z + oz + R(-0.2, 0.2), ry: dir * Math.PI / 2 + R(-0.03, 0.03) }); });
    }
  });
  PARKED.forEach((c) => items.push(c));
  items.forEach((c) => { c.sx = R(0.92, 1.06); c.sy = R(0.95, 1.15); c.sz = 1; c.c = carColor(); });
  instanced(CAR_GEOS.carBody, CAR_GEOS.bodyMat, items, { cast: true, parent: site });
  instanced(CAR_GEOS.carTop, CAR_GEOS.glassMat, items.map((c) => Object.assign({}, c, { c: undefined })), { cast: true, parent: site });
  // Lund is a town of bicycles: racks full of them at the arena and round the station.
  const racks = [];
  const rows = (x0, z0, x1, z1, fill, ry0 = 0) => {
    for (let z = z0 + 1.5; z < z1 - 1; z += 6.5) {
      racks.push({ x: (x0 + x1) / 2, y: baseHeight((x0 + x1) / 2, z) + 0.1, z, sx: x1 - x0, sy: 0.75, sz: 0.06 });
      for (let x = x0 + 0.4; x < x1 - 0.4; x += 0.62) [-1, 1].forEach((sg) => {
        if (rand() > fill) return;
        BIKES_PARKED.push({ x: x + R(-0.08, 0.08), y: baseHeight(x, z) + 0.12, z: z + sg * 0.95, sx: 1, sy: 1, sz: 1, ry: ry0 + Math.PI / 2 + (sg < 0 ? Math.PI : 0) + R(-0.12, 0.12), c: lin(pick(['#1c1f23', '#1c1f23', '#23427a', '#9a1f1f', '#e8e6e0', '#5b5f64', '#2f5a3a', '#c9b27a', '#7a2d8c'])) });
      });
    }
  };
  rows(BIKE_LOT[0] + 4, BIKE_LOT[1] + 4, BIKE_LOT[2] - 4, BIKE_LOT[3] - 4, MOBILE ? 0.4 : 0.6);
  rows(-500, -885, -444, -812, MOBILE ? 0.5 : 0.85);
  rows(-77, ZF + 24, -63, ZF + 48, 0.7); rows(63, ZF + 24, 77, ZF + 48, 0.7);
  instanced(unitBox, std('#7d8286', { metalness: 0.7, roughness: 0.35 }), racks, { receive: true });
  const BG = bikeGeos();
  instanced(BG.wheels, std('#16181a', { roughness: 0.6, side: THREE.DoubleSide }), BIKES_PARKED.map((b) => Object.assign({}, b, { c: undefined })));
  instanced(BG.frame, std('#ffffff', { roughness: 0.4, metalness: 0.5 }), BIKES_PARKED, { cast: true });
  occMark(-472, -848, 60, 76, 0);
}
let traffic = [], trafMeshes;
function buildTraffic() {
  ROUTES.forEach((r) => {
    for (let i = 0; i < r.n; i++) traffic.push({ r, u: rand() * r.path.len, dir: rand() < 0.5 ? 1 : -1, lane: pick(r.lanes), v: R(r.vmin, r.vmax), bus: rand() < r.trucks });
  });
  const cap = MOBILE ? 700 : 1500;
  while (traffic.length > cap) traffic.splice(Math.floor(rand() * traffic.length), 1);
  // Vans and lorries anywhere; buses keep to the outside lane.
  traffic.forEach((c) => { if (c.bus) { c.coach = rand() < 0.5; if (c.coach) c.lane = c.r.lanes[c.r.lanes.length - 1]; c.v = Math.min(c.v, 16); } });
  const cars = traffic.filter((c) => !c.bus), vans = traffic.filter((c) => c.bus && !c.coach), coaches = traffic.filter((c) => c.coach);
  const mk = (geo, mat, list, color) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(list.length, 1)); m.count = list.length;
    list.forEach((c, i) => { c.idx = i; if (color) m.setColorAt(i, color(c)); });
    m.frustumCulled = false; scene.add(m); return m;
  };
  const glass = std('#1b2127', { roughness: 0.1, metalness: 0.6 });
  trafMeshes = {
    cars, vans, coaches,
    body: mk(CAR_GEOS.carBody, CAR_GEOS.bodyMat, cars, () => carColor()),
    top: mk(CAR_GEOS.carTop, CAR_GEOS.glassMat, cars),
    van: mk(new THREE.BoxGeometry(5.3, 1.95, 1.9).translate(0, 1.25, 0), std('#f2f2ef', { roughness: 0.4, metalness: 0.3 }), vans),
    vanGlass: mk(new THREE.BoxGeometry(4.6, 0.6, 1.94).translate(-0.2, 1.75, 0), glass, vans),
    coach: mk(new THREE.BoxGeometry(12, 3.1, 2.55).translate(0, 1.85, 0), std('#ffffff', { roughness: 0.4, metalness: 0.3 }), coaches, () => lin(pick(['#5c9a3a', '#5c9a3a', '#e8b11a', '#e8b11a', '#f2f2ef']))),
    coachGlass: mk(new THREE.BoxGeometry(11.6, 1.1, 2.6).translate(0, 2.5, 0), glass, coaches)
  };
}
const _o = {};
function updateTraffic(dt) {
  const T = trafMeshes;
  const place = (c, meshes) => {
    const P = c.r.path;
    c.u += c.v * dt * c.dir;
    if (c.u > P.len) c.u -= P.len; if (c.u < 0) c.u += P.len;
    P.at(c.u, _o);
    const dx = _o.dx * c.dir, dz = _o.dz * c.dir;
    const it = { x: _o.x - dz * c.lane, y: _o.y + 0.02, z: _o.z + dx * c.lane, sx: 1, sy: 1, sz: 1, ry: Math.atan2(-dz, dx) };
    meshes.forEach((m) => composeInto(m, c.idx, it));
  };
  T.cars.forEach((c) => place(c, [T.body, T.top]));
  T.vans.forEach((c) => place(c, [T.van, T.vanGlass]));
  T.coaches.forEach((c) => place(c, [T.coach, T.coachGlass]));
  [T.body, T.top, T.van, T.vanGlass, T.coach, T.coachGlass].forEach((m) => { m.instanceMatrix.needsUpdate = true; });
}
// Cyclists: on the cycle paths along the roads, and up and down the town's streets.
const CYC = { list: [] };
function buildCyclists() {
  const paths = BIKE_PATHS.slice();
  CITY_STREETS.forEach(([x0, z0, x1, z1]) => {
    const m = Math.hypot((x0 + x1) / 2, (z0 + z1) / 2);
    if (m > 2400 || rand() < 0.55) return;
    const lx = -(z1 - z0), lz = x1 - x0, l = Math.hypot(lx, lz) || 1, o = 2.2;
    paths.push(new Path([[x0 + lx / l * o, baseHeight(x0, z0) + 0.12, z0 + lz / l * o], [x1 + lx / l * o, baseHeight(x1, z1) + 0.12, z1 + lz / l * o]]));
  });
  const n = MOBILE ? 220 : 520, total = paths.reduce((a, p) => a + p.len, 0);
  for (let i = 0; i < n; i++) {
    let r = rand() * total, P = paths[0];
    for (const p of paths) { r -= p.len; if (r <= 0) { P = p; break; } }
    CYC.list.push({ P, u: rand() * P.len, dir: rand() < 0.5 ? 1 : -1, v: R(3.8, 6.2), side: R(-0.5, 0.5) });
  }
  const BG = bikeGeos();
  const shirts = ['#1c1f23', '#2f3f5e', '#8a1f2a', '#c9b27a', '#e8e4dc', '#3a5a3a', '#e57200', '#5c6b78', '#7a2d8c', '#f2c230'].map(lin);
  const mk = (geo, mat, col) => { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); if (col) CYC.list.forEach((_, i) => m.setColorAt(i, col())); m.frustumCulled = false; m.castShadow = true; scene.add(m); return m; };
  CYC.meshes = [
    mk(BG.wheels, std('#16181a', { roughness: 0.6, side: THREE.DoubleSide })),
    mk(BG.frame, std('#ffffff', { roughness: 0.4, metalness: 0.5 }), () => lin(pick(['#1c1f23', '#23427a', '#9a1f1f', '#e8e6e0', '#5b5f64', '#2f5a3a']))),
    mk(new THREE.BoxGeometry(0.42, 0.62, 0.3).translate(0.02, 0.66, 0).rotateZ(-0.15), std('#2a2d31', { roughness: 0.9 })),
    mk(new THREE.CylinderGeometry(0.2, 0.16, 0.62, 7).rotateZ(-0.35).translate(0.02, 1.32, 0), std('#ffffff', { roughness: 0.9 }), () => pick(shirts)),
    mk(new THREE.SphereGeometry(0.12, 8, 6).translate(0.2, 1.78, 0), std('#ffffff', { roughness: 0.8 }), () => lin(pick(['#e0ac69', '#f1c27d', '#c68642', '#ffdbac', '#8d5524'])))
  ];
  updateCyclists(0);
}
function updateCyclists(dt) {
  CYC.list.forEach((c, i) => {
    c.u += c.v * dt * c.dir;
    if (c.u > c.P.len || c.u < 0) { c.dir = -c.dir; c.u = Math.min(Math.max(c.u, 0), c.P.len); }
    c.P.at(c.u, _o);
    const dx = _o.dx * c.dir, dz = _o.dz * c.dir;
    const it = { x: _o.x - dz * c.side, y: _o.y + 0.04, z: _o.z + dx * c.side, sx: 1, sy: 1, sz: 1, ry: Math.atan2(-dz, dx) };
    CYC.meshes.forEach((m) => composeInto(m, i, it));
  });
  CYC.meshes.forEach((m) => { m.instanceMatrix.needsUpdate = true; });
}

// ---------------------------------------------------------------- people heading in for tonight
const PEOPLE = { list: [] };
function buildPeople() {
  const legs = new THREE.BoxGeometry(0.34, 0.85, 0.22).translate(0, 0.425, 0);
  const torso = new THREE.CylinderGeometry(0.22, 0.18, 0.66, 7).translate(0, 1.17, 0);
  const head = new THREE.SphereGeometry(0.115, 6, 4).translate(0, 1.61, 0);
  // October coats: navy, black, camel, grey, and the odd bright jacket.
  const coats = ['#1c1f24', '#1c1f24', '#2f3f5e', '#3a4a6a', '#b8956a', '#c9b27a', '#6b6252', '#5c6b78', '#8a1f2a', '#2f5a3a', '#e8e4dc', '#e57200', '#7a2d8c', '#d9ad4a'].map(lin);
  const pants = ['#2f3f5e', '#1c1f24', '#6b6252', '#3a4a6a', '#b8ab90', '#2a2d31', '#4a4d52'].map(lin);
  const skins = ['#f1c27d', '#ffdbac', '#e0ac69', '#c68642', '#8d5524', '#f5d6b4', '#a9744a'].map(lin);
  const src = PEOPLE_SPOTS.sources.map((s) => ({ s, w: s.length > 3 ? (s[5] - s[3]) * (s[6] - s[4]) / 6000 : s[2] }));
  const total = src.reduce((a, b) => a + b.w, 0);
  const blocked = (x0, z0, x1, z1) => { for (let k = 1; k < 20; k++) { const x = x0 + (x1 - x0) * k / 20, z = z0 + (z1 - z0) * k / 20; if (blockedAt(x, z)) return true; } return false; };
  // A ring of waypoints round the arena, clear of the drum, the tower, the porches and the pylons.
  const RINGW = Array.from({ length: 24 }, (_, k) => { const a = k / 24 * Math.PI * 2; return [Math.cos(a) * (A + 20), Math.sin(a) * (B_ + 22)]; });
  const ringIdx = (x, z) => { let best = -1, bd = 1e9; RINGW.forEach(([rx, rz], k) => { const dd = Math.hypot(rx - x, rz - z); if (dd < bd && !blocked(x, z, rx, rz)) { bd = dd; best = k; } }); return best; };
  const spawn = (p) => {
    let r = rand() * total, s = src[0].s;
    for (const e of src) { r -= e.w; if (r <= 0) { s = e.s; break; } }
    if (s.length > 3) { p.x = R(s[3], s[5]); p.z = R(s[4], s[6]); } else { p.x = s[0] + R(-8, 8); p.z = s[1] + R(-6, 6); }
    const wp = [];
    let sx = p.x, sz = p.z;
    // Up the plaza: round the fountain, not through it.
    if (Math.abs(sx) < 40 && sz > FOUNTAIN[1] - 4) { sx = (sx < 0 ? -21 : 21) + R(-2, 2); sz = FOUNTAIN[1] + R(-3, 3); wp.push([sx, sz]); }
    const doors = PEOPLE_SPOTS.doors.slice().sort((a, b) => Math.hypot(a[0] - sx, a[1] - sz) - Math.hypot(b[0] - sx, b[1] - sz));
    const d = doors.find((dd) => !blocked(sx, sz, dd[0], dd[1])) || doors[0];
    // Otherwise walk round the arena on the ring, the short way.
    if (blocked(sx, sz, d[0], d[1])) {
      const i0 = ringIdx(sx, sz), i1 = ringIdx(d[0], d[1]), n = RINGW.length;
      if (i0 >= 0 && i1 >= 0) { const dir = (i1 - i0 + n) % n <= n / 2 ? 1 : -1; for (let k = i0; ; k = (k + dir + n) % n) { wp.push([RINGW[k][0] + R(-2, 2), RINGW[k][1] + R(-2, 2)]); if (k === i1) break; } }
    }
    wp.push([d[0] + R(-1.2, 1.2), d[1] + R(-0.5, 0.5)]);
    p.wp = wp;
  };
  const n = MOBILE ? 380 : 820;
  for (let i = 0; i < n; i++) {
    const p = { y: 0.14, v: R(1.1, 1.6), s: R(0.92, 1.08), ph: rand() * 6.28, walk: i < n * 0.84 };
    if (p.walk) { spawn(p); const d = p.wp[p.wp.length - 1], f = rand(); if (p.wp.length === 1) { p.x += (d[0] - p.x) * f * 0.8; p.z += (d[1] - p.z) * f * 0.8; } }
    else if (i < n * 0.94) {
      // Round the fountain, or under the marquee, in twos and threes.
      const a = rand() * Math.PI * 2, rr = R(15.5, 22);
      p.x = FOUNTAIN[0] + Math.sin(a) * rr; p.z = FOUNTAIN[1] + Math.cos(a) * rr; p.ry = Math.atan2(FOUNTAIN[0] - p.x, FOUNTAIN[1] - p.z) + R(-0.4, 0.4);
    } else { p.x = R(-17, 17); p.z = R(ZF + 2, ZF + 11); p.ry = rand() * 6.28; }
    PEOPLE.list.push(p);
  }
  PEOPLE.spawn = spawn;
  const mk = (geo, cols) => { const m = new THREE.InstancedMesh(geo, std('#ffffff', { roughness: 0.9 }), n); PEOPLE.list.forEach((_, i) => m.setColorAt(i, pick(cols))); m.frustumCulled = false; site.add(m); return m; };
  PEOPLE.meshes = [mk(legs, pants), mk(torso, coats), mk(head, skins)];
  updatePeople(0);
}
function updatePeople(dt) {
  PEOPLE.list.forEach((p, i) => {
    let bob = 0;
    if (p.walk) {
      const t = p.wp[0], dx = t[0] - p.x, dz = t[1] - p.z, d = Math.hypot(dx, dz);
      if (d < 0.6) { p.wp.shift(); if (!p.wp.length) PEOPLE.spawn(p); }
      else { p.x += dx / d * p.v * dt; p.z += dz / d * p.v * dt; p.ry = Math.atan2(dx, dz); }
      p.ph += dt * p.v * 5.5; bob = Math.abs(Math.sin(p.ph)) * 0.05;
    }
    const it = { x: p.x, y: p.y + bob, z: p.z, sx: p.s, sy: p.s, sz: p.s, ry: p.ry };
    PEOPLE.meshes.forEach((m) => composeInto(m, i, it));
  });
  PEOPLE.meshes.forEach((m) => { m.instanceMatrix.needsUpdate = true; });
}

// ---------------------------------------------------------------- trains through Lund C, and the tram
const TRAINS = [];
let trainMeshes;
const CAR_LEN = 20.5, CARS = 6;
function buildTrains() {
  const clip = (pts) => pts.filter(([x, , z]) => Math.hypot(x, z) < 5500);
  const paths = { nb: new Path(clip(RAIL.nb)), sb: new Path(clip(RAIL.sb)) };
  const stopAt = (P) => {
    const [sx, sz] = RAIL.station;
    let best = 0, bd = 1e9;
    for (let i = 0; i < P.p.length; i++) { const d = Math.hypot(P.p[i][0] - sx, P.p[i][2] - sz); if (d < bd) { bd = d; best = P.s[i]; } }
    return best;
  };
  const sbStop = stopAt(paths.sb), nbStop = stopAt(paths.nb);
  // A purple regional train and a grey Öresund train, one each way.
  TRAINS.push({ P: paths.sb, s: sbStop - 1400, v: 22, stop: sbStop + CARS * CAR_LEN / 2, served: false, dwell: 0, wait: 0, k: 0 });
  TRAINS.push({ P: paths.nb, s: nbStop + CARS * CAR_LEN / 2, v: 0, stop: nbStop + CARS * CAR_LEN / 2, served: true, dwell: 20, wait: 0, k: 1 });
  const n = 2 * CARS;
  const mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; m.castShadow = true; scene.add(m); return m; };
  trainMeshes = [
    mk(new THREE.BoxGeometry(20, 3.3, 2.95).translate(0, 2.55, 0), std('#ffffff', { roughness: 0.35, metalness: 0.4 })),
    mk(new THREE.BoxGeometry(18.6, 0.95, 3.0).translate(0, 2.95, 0), std('#1b2328', { roughness: 0.1, metalness: 0.7 })),
    mk(new THREE.BoxGeometry(19, 0.9, 2.6).translate(0, 0.55, 0), std('#2b2d30', { roughness: 0.8 })),
    mk(new THREE.BoxGeometry(19.6, 0.3, 2.6).translate(0, 4.35, 0), std('#9ea3a6', { roughness: 0.5, metalness: 0.5 }))
  ];
  const cols = [lin('#7a2d8c'), lin('#9aa1a6')];
  for (let i = 0; i < n; i++) trainMeshes[0].setColorAt(i, cols[Math.floor(i / CARS)]);
  updateTrains(0);
}
function updateTrains(dt) {
  TRAINS.forEach((tr, ti) => {
    if (tr.wait > 0) { tr.wait -= dt; tr.s = -5; }
    else {
      const toStop = tr.stop - tr.s;
      if (!tr.served && toStop > 0) {
        tr.v = Math.min(Math.sqrt(2 * 0.8 * toStop), tr.v + 0.9 * dt, 25);
        if (toStop < 0.4 || tr.v < 0.05) { tr.served = true; tr.dwell = 40; tr.v = 0; }
      } else if (tr.dwell > 0) { tr.dwell -= dt; tr.v = 0; }
      else tr.v = Math.min(28, tr.v + 0.8 * dt);
      tr.s += tr.v * dt;
      if (tr.s - CARS * CAR_LEN > tr.P.len) { tr.s = -5; tr.v = 22; tr.served = false; tr.wait = R(30, 90); }
    }
    for (let k = 0; k < CARS; k++) {
      const sc = tr.s - CAR_LEN / 2 - k * CAR_LEN, hidden = tr.wait > 0 || sc < 0 || sc > tr.P.len;
      tr.P.at(sc, _o);
      const it = { x: _o.x, y: _o.y + 0.15, z: _o.z, sx: hidden ? 0 : 1, sy: hidden ? 0 : 1, sz: hidden ? 0 : 1, ry: Math.atan2(-_o.dz, _o.dx) };
      trainMeshes.forEach((m) => composeInto(m, ti * CARS + k, it));
    }
  });
  trainMeshes.forEach((m) => { m.instanceMatrix.needsUpdate = true; });
}
// The tram: white with a purple band, two of them out and back between Lund C and the ESS, stopping on the way.
let tramMeshes;
const TRAMS = [];
function buildTrams() {
  const stops = (P) => { const s = []; for (let d = 0; d < P.len; d += 650) s.push(d); s.push(P.len - 20); return s; };
  TRAM.stops = new Map([[TRAM.path, stops(TRAM.path)], [TRAM.back, stops(TRAM.back)]]);
  TRAMS.push({ P: TRAM.path, s: 300, v: 0, dwell: 0, next: 1 });
  TRAMS.push({ P: TRAM.back, s: 1400, v: 0, dwell: 0, next: 3 });
  const n = TRAMS.length * 3;
  const mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; m.castShadow = true; scene.add(m); return m; };
  tramMeshes = [
    mk(new THREE.BoxGeometry(10.6, 2.9, 2.65).translate(0, 1.95, 0), std('#f2f2ef', { roughness: 0.35, metalness: 0.3 })),
    mk(new THREE.BoxGeometry(9.4, 1.2, 2.7).translate(0, 2.3, 0), std('#1b2328', { roughness: 0.1, metalness: 0.7 })),
    mk(new THREE.BoxGeometry(10.62, 0.35, 2.67).translate(0, 0.95, 0), std('#7a2d8c', { roughness: 0.5 })),
    mk(new THREE.BoxGeometry(3, 0.4, 1.2).translate(0, 3.6, 0), std('#3a3d40', { metalness: 0.5 }))
  ];
  updateTrams(0);
}
function updateTrams(dt) {
  TRAMS.forEach((t, ti) => {
    if (t.dwell > 0) { t.dwell -= dt; t.v = 0; }
    else {
      const stops = TRAM.stops.get(t.P), to = stops[t.next] - t.s;
      t.v = Math.min(Math.sqrt(2 * 0.9 * Math.max(to, 0)) + 0.3, t.v + 1.0 * dt, 14);
      t.s += t.v * dt;
      // At the end of the line, change tracks and head back.
      if (to < 0.5) { t.dwell = 18; t.next++; if (t.next >= stops.length) { t.P = t.P === TRAM.path ? TRAM.back : TRAM.path; t.next = 1; t.s = 30; t.dwell = 40; } }
    }
    for (let k = 0; k < 3; k++) {
      t.P.at(Math.max(t.s - 5.5 - k * 10.9, 0), _o);
      const it = { x: _o.x, y: _o.y + 0.1, z: _o.z, sx: 1, sy: 1, sz: 1, ry: Math.atan2(-_o.dz, _o.dx) };
      tramMeshes.forEach((m) => composeInto(m, ti * 3 + k, it));
    }
  });
  tramMeshes.forEach((m) => { m.instanceMatrix.needsUpdate = true; });
}

// ---------------------------------------------------------------- time of day
let HOURS = 16.8;
function solar(hours) {
  // Early October in Lund: declination -5 deg, solar noon about 12:56 (CEST, UTC+2).
  const lat = 55.70 * DEG, dec = -5.2 * DEG, H = (hours - 12.93) * 15 * DEG;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  const Az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
  return { el, bearing: Az + Math.PI };
}
const SUNCOL = [[40, '#fff4e2'], [20, '#ffe6c0'], [9, '#ffc88e'], [2, '#ff965a'], [-2, '#ff6a3c']].map(([e, c]) => [e, new THREE.Color(c)]);
const FOGCOL = [[40, '#b9c4cc'], [20, '#bdc6cc'], [9, '#cbc4b6'], [2, '#c49e84'], [-2, '#7f6f7c'], [-9, '#2e3344']].map(([e, c]) => [e, new THREE.Color(c)]);
function ramp(table, e, out) {
  if (e >= table[0][0]) return out.copy(table[0][1]);
  for (let i = 0; i < table.length - 1; i++) {
    const [e0, c0] = table[i], [e1, c1] = table[i + 1];
    if (e <= e0 && e >= e1) return out.copy(c0).lerp(c1, (e0 - e) / (e0 - e1));
  }
  return out.copy(table[table.length - 1][1]);
}
let envPending = false;
const sunCol = new THREE.Color();
function setTime(hours) {
  HOURS = hours;
  const { el, bearing } = solar(hours);
  const ce = Math.cos(el), sinEl = Math.sin(el), eDeg = el / DEG;
  sunDir.set(Math.sin(bearing) * ce, sinEl, -Math.cos(bearing) * ce).normalize();
  skyU.sunPosition.value.copy(sunDir);
  sun.position.copy(sunDir).multiplyScalar(3500).add(SHADOW_C); sun.target.position.copy(SHADOW_C);
  ramp(SUNCOL, eDeg, sunCol);
  sun.color.copy(sunCol).convertSRGBToLinear();
  sun.intensity = 2.6 * smooth(-0.035, 0.22, sinEl);
  hemi.intensity = 0.07 + 0.24 * smooth(-0.1, 0.3, sinEl);
  ramp(FOGCOL, eDeg, fogDisplay);
  scene.fog.color.copy(fogDisplay);
  renderer.toneMappingExposure = 0.5 + 0.3 * (1 - smooth(0.0, 0.4, sinEl));
  const night = 1 - smooth(-0.05, 0.14, sinEl);
  NIGHT.value = night;
  glowMats.forEach(([m, lo, hi]) => { m.emissiveIntensity = lo + (hi - lo) * night; });
  signMats.forEach((m) => { m.emissiveIntensity = 0.05 + 1.0 * night; });
  if (lightHeads) lightHeads.material.emissiveIntensity = 2.2 * night;
  if (globes) globes.material.emissiveIntensity = 0.1 + 2.6 * night;
  if (marquee) marquee.mat.emissiveIntensity = 0.9 + 0.6 * night;
  if (jetMat) jetMat.emissiveIntensity = 0.6 * night;
  floods.forEach((f) => { f.intensity = 3.2 * night; });
  if (clockHands) {
    const h = ((hours % 12) + 12) % 12, m = (hours * 60) % 60;
    clockHands.h.rotation.z = -h / 12 * Math.PI * 2; clockHands.m.rotation.z = -m / 60 * Math.PI * 2;
  }
  if (!envPending) { envPending = true; requestAnimationFrame(() => { envPending = false; updateEnv(); }); }
  renderer.shadowMap.needsUpdate = true;
}
const fmtTime = (h) => { const m = Math.round(h * 60) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

// ---------------------------------------------------------------- main
const clock = new THREE.Clock();
function stepWorld(dt) {
  WATER_N.forEach((t, i) => { t.offset.y -= dt * (i ? 0.02 : 0.004); t.offset.x += dt * (i ? 0 : 0.002); });
  updateTraffic(dt);
  updateCyclists(dt);
  updatePeople(dt);
  updateTrains(dt);
  updateTrams(dt);
  updateTurbines(dt);
  marquee.t += dt;
  if (marquee.t > 5) { marquee.t = 0; marquee.i = (marquee.i + 1) % marquee.slides.length; marquee.mat.emissiveMap = marquee.slides[marquee.i]; }
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!REDUCED) stepWorld(dt);
  controls.update();
  clampCamera();
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

async function init() {
  say('Laying out the Skåne plain'); await tick();
  makeTextures();
  buildTerrain();
  say('Filling the Öresund and Höje å'); await tick();
  buildWater();
  say('Laying the roads, the main line and the tram'); await tick();
  buildRoads();
  buildRail();
  buildTram();
  say('Raising the cathedral'); await tick();
  try { await Promise.race([Promise.all([document.fonts.load("400 60px 'Limelight'"), document.fonts.load("700 40px 'Josefin Sans'")]), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* fall back to Georgia */ }
  buildCathedral();
  buildCivic();
  buildScience();
  say('Building Arena Lund'); await tick();
  await buildPrecinct();
  say('Filling in the old town and the suburbs'); await tick();
  buildMalmo();
  buildCity();
  buildStreetLamps();
  finishCity();
  flushBatches({
    lawn: std('#ffffff', { map: TEX.grass, roughness: 0.97 }), lot: std('#ffffff', { map: TEX.parking, roughness: 0.93 }),
    asph: std('#ffffff', { map: TEX.asphalt, roughness: 0.93 }), terrazzo: std('#ffffff', { map: TEX.terrazzo, roughness: 0.55, metalness: 0.05 }), walk: std('#ffffff', { map: TEX.sidewalk, roughness: 0.9 })
  }, site);
  say('Farms, windmills and the autumn trees'); await tick();
  buildTurbines();
  buildFarms();
  carGeos();
  buildParked();
  buildVegetation();
  buildPeople();
  buildTraffic();
  buildCyclists();
  buildTrains();
  buildTrams();
  const t0 = parseFloat(QS.get('t'));
  const start = Number.isFinite(t0) ? Math.min(Math.max(t0, 0), 24) : 16.8;
  setTime(start);
  updateEnv();
  resetView();
  updateTraffic(0);
  renderer.shadowMap.needsUpdate = true;
  // The time-of-day control.
  const input = $('clock'), out = $('clockOut');
  input.value = start; out.textContent = fmtTime(start);
  input.addEventListener('input', () => { const h = parseFloat(input.value); out.textContent = fmtTime(h); setTime(h); });
  ['hud', 'hint', 'time'].forEach((id) => { $(id).hidden = false; });
  const loader = $('loader');
  if (QS.has('shot')) {
    // Test hook: render single frames on demand (software GL is too slow for the loop), stepping the animation by dt.
    loader.remove();
    window.__frame = (dt = 0, t) => { if (t !== undefined) setTime(t); updateEnv(); if (dt) { clock.getDelta(); stepWorld(dt); } controls.update(); clampCamera(); sky.position.copy(camera.position); renderer.render(scene, camera); };
    window.__cam = (c) => { camera.position.set(c[0], c[1], c[2]); controls.target.set(c[3], c[4], c[5]); controls.update(); };
    window.__frame(0);
    window.__info = () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, houses: Object.values(B).reduce((a, l) => a + l.length, 0), roofs: ROOF.length, trees: treeItems.length + farTrees.length });
    window.__ready = true;
    return;
  }
  frame();
  loader.style.opacity = '0';
  setTimeout(() => { loader.remove(); window.__ready = true; }, 750);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

init().catch((err) => { console.error(err); say('The 3D scene could not start: ' + err.message); });
})();
