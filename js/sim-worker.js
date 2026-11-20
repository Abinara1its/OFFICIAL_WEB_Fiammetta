'use strict';
// The simulator thread: one WebAssembly instance of MuJoCo and the onboard controller, hosting the
// robot sessions the page assigns to it. Messages are handled strictly in order, so a session is
// always initialised, tuned, pushed or shifted before the next batch of steps that follows the
// message. A worker started with build: true compiles the evaluation scene instead, returns it
// with the geometry the renderer needs, and is then discarded, so that the memory compilation
// takes is not kept for the rest of the visit.
importScripts('../fia_sim.js');

const NT = 192, NP = 64 * 12;
const INIT_T = ['string', 'string', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'];
// Every value the lab can read or tune through fia_param.
const PARAM_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 24, 25, 30, 31, 32];
let M = null, terrainN = 0, terrainPtr = 0;
const tel = () => new Float64Array(M.HEAPF64.buffer, M._fia_telemetry(), NT);
const pos = () => new Float64Array(M.HEAPF64.buffer, M._fia_poses(), NP);
const err = () => M.ccall('fia_error', 'string', [], []);

async function boot(m) {
  // The simulator's own messages (MuJoCo warnings among them) go to the page's console.
  const say = s => postMessage({ op: 'log', s: String(s) });
  M = await loadFia({ print: say, printErr: say, instantiateWasm: (imports, ok) => { WebAssembly.instantiate(m.module, imports).then(i => ok(i)); return {} } });
  for (const f of m.files) { M.FS.mkdirTree(f.path.slice(0, f.path.lastIndexOf('/'))); M.FS.writeFile(f.path, new Uint8Array(f.data)) }
  if (!m.build) { postMessage({ op: 'ready' }); return }
  buildScene();
  const mjb = M.FS.readFile('/fia/scene.mjb'), model = describe();
  postMessage({ op: 'built', mjb: mjb.buffer, model }, [mjb.buffer, model.hf.data.buffer, ...model.parts.flatMap(p => [p.vert.buffer, p.face.buffer])]);
}

// The scene, compiled from the robot's MJCF, the recipe and the elevations (web/sim/export_scene.py).
function buildScene() {
  const R = JSON.parse(new TextDecoder().decode(M.FS.readFile('/fia/scene_recipe.json')));
  const H = new Float32Array(M.FS.readFile('/fia/scene_hfield.f32').slice().buffer);
  const a = [...R.light.pos, ...R.light.dir, ...R.headlight.ambient, ...R.headlight.diffuse, ...R.headlight.specular,
    ...R.hfield.size, R.hfield.nrow, R.hfield.ncol, ...R.hfield.pos, R.boxes.length, ...R.boxes.flat(2), R.collision.length, ...R.collision.flat()];
  const ptr = M._malloc(a.length * 8); new Float64Array(M.HEAPF64.buffer, ptr, a.length).set(a);
  const tb = M._fia_terrain_buffer(H.length); new Float32Array(M.HEAPF32.buffer, tb, H.length).set(H);
  const rc = M.ccall('fia_build_scene', 'number', ['string', 'number', 'string'], ['/fia/fia2_mjx.xml', ptr, '/fia/scene.mjb']);
  M._free(ptr);
  if (rc) throw new Error('scene: ' + err());
}

// What the renderer draws: the robot's meshes, its collision primitives, the feet, the body of
// every geom, and the evaluation heightfield with its placement; and the controller's defaults.
function describe() {
  M._fia_select(0); M._fia_terrain_use(0); M.ccall('fia_init', 'number', INIT_T, ['/fia/scene.mjb', '', 0, -14, -8, 2, 0, 0, 1, 0, 0]);
  const n = M._fia_ngeom(), parts = [], coll = [], body = [];
  for (let g = 0; g < n; g++) { const ty = M._fia_geom_type(g); body.push(M._fia_geom_body(g));
    if (ty === 7) { const id = M._fia_geom_dataid(g), nv = M._fia_mesh_nvert(id), nf = M._fia_mesh_nface(id);
      parts.push({ g, vert: new Float32Array(M.HEAPF32.buffer, M._fia_mesh_vert(id), nv * 3).slice(), face: new Uint32Array(new Int32Array(M.HEAP32.buffer, M._fia_mesh_face(id), nf * 3)) }) }
    else if ((ty === 2 || ty === 3) && M._fia_geom_contype(g) && M._fia_geom_body(g) > 0) coll.push({ g, ty, size: new Float64Array(M.HEAPF64.buffer, M._fia_geom_size(g), 3).slice() }) }
  const feet = [0, 1, 2, 3].map(l => M._fia_foot_geom(l)), params = {}; for (const p of PARAM_IDS) params[p] = M._fia_param(p, 0, 0);
  M._fia_step(1, 0, 0, 0, 1, 1, 0);  // one step fills the pose buffer the heightfield's placement is read from
  const nr = M._fia_hfield_nrow(), nc = M._fia_hfield_ncol(), sz = new Float64Array(M.HEAPF64.buffer, M._fia_hfield_size(), 4).slice();
  let hg = 0; for (let g = 0; g < n; g++) if (M._fia_geom_type(g) === 1) { hg = g; break }
  const P = pos(), hf = { nr, nc, sz, ox: P[12 * hg], oy: P[12 * hg + 1], oz: P[12 * hg + 2], data: new Float32Array(M.HEAPF32.buffer, M._fia_hfield_data(), nr * nc).slice() };
  M._fia_free();
  return { parts, coll, feet, body, hf, params };
}

function init(m) {
  M._fia_select(m.id);
  const rc = M.ccall('fia_init', 'number', INIT_T, m.args);
  if (rc !== 0) { postMessage({ op: 'init', id: m.id, gen: m.gen, rc, err: err() }); return }
  M._fia_step(1, 0, 0, 0, m.gait, 1, 0);
  const params = {}; for (const p of PARAM_IDS) params[p] = M._fia_param(p, 0, 0);
  postMessage({ op: 'init', id: m.id, gen: m.gen, rc: 0, T: tel().slice(), P: pos().slice(), params });
}

// A batch: every chunk [cycles, vx, vy, yaw rate, gait, posture] for every session listed, chunk by
// chunk, returning the telemetry after each chunk and the poses after the last. The sessions in
// reset receive the operator's reset with the first chunk.
function run(m) {
  const ids = m.ids, nch = m.ch.length / 6, T = new Float64Array(nch * ids.length * NT), P = new Float64Array(ids.length * NP), fail = {};
  const t0 = performance.now();
  for (let c = 0; c < nch; c++) { const q = m.ch.subarray(6 * c, 6 * c + 6);
    ids.forEach((id, j) => { M._fia_select(id);
      if (!(id in fail) && M._fia_step(q[0], q[1], q[2], q[3], q[4], q[5], c === 0 && m.reset.includes(id) ? 1 : 0) < 0) fail[id] = err();
      T.set(tel(), (c * ids.length + j) * NT) }) }
  const ms = performance.now() - t0;
  ids.forEach((id, j) => { M._fia_select(id); P.set(pos(), j * NP) });
  postMessage({ op: 'run', bid: m.bid, T, P, fail, ms }, [T.buffer, P.buffer]);
}

// A square block of the world's elevations, samples span = [first, last) in rows and columns of an
// n x n heightfield.
function terrain(m) {
  if (terrainN !== m.n * m.n) { terrainPtr = M._fia_terrain_buffer(m.n * m.n); terrainN = m.n * m.n }
  const all = new Float32Array(M.HEAPF32.buffer, terrainPtr, terrainN), w = m.span[1] - m.span[0];
  for (let r = 0; r < w; r++) all.set(m.data.subarray(r * w, (r + 1) * w), (m.span[0] + r) * m.n + m.span[0]);
  if (m.commit) M._fia_terrain_commit();
}

function handle(m) {
  switch (m.op) {
    case 'boot': return boot(m);
    case 'init': return init(m);
    case 'free': for (const id of m.ids) { M._fia_select(id); M._fia_free() } return;
    case 'run': return run(m);
    case 'push': M._fia_select(m.id); M._fia_push(m.f[0], m.f[1], m.f[2], m.f[3]); return;
    case 'param': M._fia_select(m.id); M._fia_param(m.pid, m.v, 1); postMessage({ op: 'param', id: m.id, gen: m.gen, pid: m.pid, v: M._fia_param(m.pid, 0, 0) }); return;
    case 'use': M._fia_terrain_use(m.on ? 1 : 0); return;
    case 'terrain': return terrain(m);
    case 'shift': M._fia_shift(m.sh[0], m.sh[1]); return;
    case 'modes': M._fia_select(m.id); M._fia_modes(m.stair ? 1 : 0, m.slope ? 1 : 0); return;
    case 'files': for (const f of m.files) { M.FS.mkdirTree(f.path.slice(0, f.path.lastIndexOf('/'))); M.FS.writeFile(f.path, new Uint8Array(f.data)) } return;
  }
}
let queue = Promise.resolve();
onmessage = e => { queue = queue.then(() => handle(e.data)).catch(x => postMessage({ op: 'fatal', msg: String(x && x.message || x) })) };
