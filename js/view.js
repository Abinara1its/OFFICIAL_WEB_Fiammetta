'use strict';
// The project page, part 2 of 4: the 3D view. Robots, the evaluation terrain, the streamed worlds,
// the overlays, the camera, and the operator who picks the robot up and sets it down.

const MATCOL = [[.42, .53, .29], [.60, .52, .39], [.52, .51, .48], [.66, .64, .59], [.33, .25, .18], [.31, .41, .23], [.70, .67, .61], [.66, .66, .64], [.86, .69, .12], [.47, .50, .53],
  [.30, .38, .52], [.36, .45, .50], [.62, .57, .50], [.52, .48, .44], [.63, .62, .60], [.48, .30, .20], [.62, .47, .31], [.58, .59, .60], [.86, .45, .17], [.33, .33, .34]];
const metal = () => new THREE.MeshStandardMaterial({ color: 0xb9bec3, metalness: .85, roughness: .32, envMapIntensity: 1 });
function initGL() {
  const canvas = $('gl'); const R = new THREE.WebGLRenderer({ canvas, antialias: !LOWMEM, alpha: true }); R.setPixelRatio(Math.min(devicePixelRatio, LOWMEM ? 1.5 : 2));
  const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(42, 1, .05, 500); cam.up.set(0, 0, 1);
  // Orbit, zoom and pan; the view follows the robot with whatever offset the operator panned to.
  const ctl = new THREE.OrbitControls(cam, canvas); ctl.enableDamping = true; ctl.maxPolarAngle = 1.48; ctl.minDistance = .8; ctl.maxDistance = 18; ctl.enablePan = true; ctl.screenSpacePanning = false;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x5d6266, .65); scene.add(hemi); const sun = new THREE.DirectionalLight(0xffffff, .95); sun.position.set(-3, -5, 9); scene.add(sun); scene.add(sun.target);
  if (!LOWMEM) { R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap; sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = sc.bottom = -7; sc.right = sc.top = 7; sc.near = 1; sc.far = 40; sun.shadow.bias = -.0005 }
  const env = document.createElement('canvas'); env.width = 256; env.height = 128; const eg = env.getContext('2d'); const gr = eg.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(.45, '#c9ced2'); gr.addColorStop(.55, '#7d8488'); gr.addColorStop(1, '#3b4044'); eg.fillStyle = gr; eg.fillRect(0, 0, 256, 128);
  eg.fillStyle = 'rgba(255,255,255,.9)'; eg.fillRect(40, 18, 60, 14); eg.fillRect(160, 22, 50, 10);
  const et = new THREE.CanvasTexture(env); et.mapping = THREE.EquirectangularReflectionMapping; const pm = new THREE.PMREMGenerator(R); scene.environment = pm.fromEquirectangular(et).texture;
  const sky = document.createElement('canvas'); sky.width = 4; sky.height = 256; const skyTex = new THREE.CanvasTexture(sky);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(220, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })); dome.rotation.x = Math.PI / 2; dome.visible = false; scene.add(dome);
  G = { R, scene, cam, ctl, sun, hemi, dome, sky, skyTex, holePatch: holeNone(), holeMid: holeNone(), story: null, coarse: null, patch: null, parts: null, robots: [], marks: [], ray: new THREE.Raycaster(), drag: null, win: null, panOff: new THREE.Vector3(), panning: false, avg: new THREE.Vector3() };
  ctl.addEventListener('start', () => G.panning = true); ctl.addEventListener('end', () => G.panning = false);
  const resize = () => { const r = canvas.getBoundingClientRect(); if (!r.width) return; R.setSize(r.width, r.height, false); cam.aspect = r.width / r.height; viewOffset(); showCmd() };
  new ResizeObserver(resize).observe($('stage')); resize();
  const ndc = e => { const r = canvas.getBoundingClientRect(); return new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1) };
  // Picking goes through the camera's view offset, so it uses the camera's own projection.
  canvas.addEventListener('pointerdown', e => { if (placing) { placeDown(e, ndc(e)); e.stopImmediatePropagation(); return } }, true);
  canvas.addEventListener('pointermove', e => { if (placing && placing.down) placeMove(ndc(e)) });
  canvas.addEventListener('pointerdown', e => { if (e.isPrimary === false || placing || e.button === 2) return; G.ray.setFromCamera(ndc(e), cam);
    for (const rb of G.robots) { if (G.ray.intersectObjects(rb.group.children, false).length) { const T = tel(rb.id);
      G.drag = { rb, z: T[11], end: null, pid: e.pointerId }; ctl.enabled = false; if (mode === 'story') showHint(''); e.stopImmediatePropagation(); return } } }, true);
  canvas.addEventListener('pointermove', e => { if (!G.drag || e.pointerId !== G.drag.pid) return; G.ray.setFromCamera(ndc(e), cam); const p = new THREE.Vector3(); if (G.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -G.drag.z), p)) G.drag.end = p });
  const release = () => { if (placing && placing.down) { placeUp(); return } if (!G || !G.drag) return; const d = G.drag; G.drag = null; ctl.enabled = true; G.shove.visible = false; if (!d.end) return;
    const T = tel(d.rb.id), v = d.end.clone().sub(new THREE.Vector3(T[9], T[10], T[11])); v.z = 0; const f = Math.min(700, v.length() * 600); if (f < 40) return; v.normalize().multiplyScalar(f);
    SIM.push(d.rb.id, [v.x, v.y, 0, .1]); W.shoveAt = performance.now() };
  addEventListener('pointerup', release); addEventListener('pointercancel', release);
  G.shove = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x111111, .12, .08); G.shove.visible = false; scene.add(G.shove);
  buildParts(); wrInit(); useGround('story', true); themeStage();
}
// Panels that cover part of the stage move the image's centre into the part that stays visible.
function viewOffset() { if (!G) return; const st = $('stage').getBoundingClientRect(), W0 = st.width, H0 = st.height; if (!W0) return;
  let dx = 0, dy = 0; const lab = $('lab');
  if (mode === 'lab' && !lab.hidden) { const r = lab.getBoundingClientRect(); if (r.width < W0 * .8) dx = r.width / 2; else dy = r.height / 2 }
  const open = PANELS.map(p => $(p[0])).find(p => !p.hidden);
  if (open) { const r = open.getBoundingClientRect(); if (r.width < W0 * .7) dx -= r.width / 2; else if (!dy) dy = Math.min(r.height, H0 * .55) / 2 }
  if (dx || dy) G.cam.setViewOffset(W0, H0, -dx, dy, W0, H0); else G.cam.clearViewOffset(); G.cam.updateProjectionMatrix() }
function themeStage() { if (!G) return; G.shove.setColor(new THREE.Color(css('--ink'))); overlays.recolor(); if (groundMode !== 'world') { G.scene.fog = new THREE.Fog(new THREE.Color(css('--stage-2')), 14, 46); G.win = null; G.winBig = null; if (robots.length) { const T = tel(robots[0].id); buildStoryGround(T[9], T[10], true) } buildCoarse() } }
let groundMode = null;
function useGround(m, force) { if (!G || (!force && m === groundMode)) return; groundMode = m; G.win = null; const world = m === 'world';
  [G.story, G.coarse, G.patch].forEach(o => o && (o.visible = !world)); wrShow(world); G.dome.visible = world;
  if (world) themeWorld(); else { G.scene.fog = new THREE.Fog(new THREE.Color(css('--stage-2')), 14, 46); G.hemi.color.set(0xffffff); G.hemi.groundColor.set(0x5d6266); G.hemi.intensity = .65; G.sun.color.set(0xffffff); G.sun.intensity = .95; buildCoarse() } }
// Sky, fog and light for each kind of world.
function themeWorld() { if (!G || !W.world) return; const k = W.world.kind;
  const T = { valley: { sky: ['#5d8fc2', '#a9c6dc', '#dfe6e0', '#9fae8f'], fog: 0xd5dfdf, near: 26, far: 110, hemi: [0xd8e8f4, 0x56603f, .7], sun: [0xfff0d8, 1.05] },
    factory: { sky: ['#4b4a48', '#6f6c68', '#8b8781', '#5c5a57'], fog: 0x8b8781, near: 18, far: 80, hemi: [0xf1e7d6, 0x4a4a48, .85], sun: [0xfff4e2, .8] },
    warehouse: { sky: ['#5f6a72', '#8b979f', '#aab3b8', '#7d868c'], fog: 0xa4adb2, near: 18, far: 85, hemi: [0xe6eef4, 0x50565a, .85], sun: [0xf4f8ff, .8] },
    rescue: { sky: ['#8f8577', '#b5a690', '#cdbda4', '#8d8170'], fog: 0xbfae94, near: 14, far: 70, hemi: [0xf0e2cc, 0x5a4e40, .75], sun: [0xffe2bd, 1.0] } }[k];
  const sg = G.sky.getContext('2d'), gr = sg.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, T.sky[0]); gr.addColorStop(.45, T.sky[1]); gr.addColorStop(.52, T.sky[2]); gr.addColorStop(1, T.sky[3]); sg.fillStyle = gr; sg.fillRect(0, 0, 4, 256); G.skyTex.needsUpdate = true;
  G.scene.fog = new THREE.Fog(T.fog, T.near, T.far); G.hemi.color.set(T.hemi[0]); G.hemi.groundColor.set(T.hemi[1]); G.hemi.intensity = T.hemi[2]; G.sun.color.set(T.sun[0]); G.sun.intensity = T.sun[1] }
function buildParts() {
  // The robot's geometry and the evaluation heightfield, as the simulator compiled them (sim-worker.js).
  const md = SIM.model;
  G.parts = md.parts.map(p => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p.vert, 3)); geo.setIndex(new THREE.BufferAttribute(p.face, 1)); geo.computeVertexNormals(); return { g: p.g, geo } });
  G.coll = md.coll; G.feet = md.feet; G.gbody = md.body; G.hfStory = md.hf; PCACHE = { ...md.params };
}
// Ground height under a simulator point: the evaluation scene, or the world's walkable surface.
function groundAt(x, y) { if (groundMode === 'world' && St) { const P = St.toWorld(x, y); return W.world.surfaceAt(P[0], P[1]) }
  const h = G.hfStory; const fc = (x - h.ox + h.sz[0]) / (2 * h.sz[0]) * (h.nc - 1), fr = (y - h.oy + h.sz[1]) / (2 * h.sz[1]) * (h.nr - 1);
  const c = clamp(Math.floor(fc), 0, h.nc - 2), r = clamp(Math.floor(fr), 0, h.nr - 2), u = fc - c, v = fr - r, d = h.data, k = r * h.nc + c;
  return h.oz + ((d[k] * (1 - u) + d[k + 1] * u) * (1 - v) + (d[k + h.nc] * (1 - u) + d[k + h.nc + 1] * u) * v) * h.sz[2] }
// Everything the feet can meet, for choosing where to set the robot down.
function solidAt(x, y) { if (groundMode === 'world' && St) { const P = St.toWorld(x, y); return W.world.heightAt(P[0], P[1]) } return groundAt(x, y) }

/* ---- ground meshes ---- */
// A grid over samples, split into triangles along the same diagonal as MuJoCo's heightfield prisms.
function gridMesh(cols, rows, fill, opts) {
  const n = cols * rows, pos = new Float32Array(n * 3), col = new Float32Array(n * 3); fill(pos, col);
  const idx = new Uint32Array((rows - 1) * (cols - 1) * 6); let k = 0; for (let i = 0; i < rows - 1; i++)for (let j = 0; j < cols - 1; j++) { const a = i * cols + j; idx.set([a, a + 1, a + cols, a + 1, a + cols + 1, a + cols], k); k += 6 }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
  if (opts && opts.grid) {
    // Normals from the height grid itself, so that the skirts below the edges do not shade them.
    const { nc, nr, h, off } = opts.grid, nor = new Float32Array(cols * rows * 3), z = (i, j) => pos[3 * ((clamp(i, 0, nr - 1) + off) * cols + clamp(j, 0, nc - 1) + off) + 2];
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const ii = i - off, jj = j - off; const gx = (z(ii, jj + 1) - z(ii, jj - 1)) / (2 * h), gy = (z(ii + 1, jj) - z(ii - 1, jj)) / (2 * h), L = Math.hypot(gx, gy, 1); nor.set([-gx / L, -gy / L, 1 / L], 3 * (i * cols + j)) }
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  } else geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, groundMat((opts && opts.mat) || 'plain')); mesh.receiveShadow = !(opts && opts.noShadow); return mesh }
// Ground materials are shared and never disposed: a material whose shader no other material uses
// would be recompiled on every rebuild of the ground near the robot, which stalls the page.
const GMAT = {};
function groundMat(kind) {
  if (GMAT[kind]) return GMAT[kind];
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: .12 });
  if (kind === 'storyMid' || kind === 'chunk') { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 2 }
  const hole = { storyMid: G.holePatch, storyCoarse: G.holeMid, chunk: WR.hole }[kind]; if (hole) addHole(m, hole);
  return GMAT[kind] = m }
// A coarser mesh must not show through a finer one drawn over it (at a stair edge its triangles cut
// above the true surface), so it discards its fragments inside the finer mesh's rectangle.
function addHole(mat, hole) {
  mat.onBeforeCompile = sh => { sh.uniforms.uHole = hole;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vHoleP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHoleP = (modelMatrix * vec4(transformed, 1.0)).xy;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vHoleP;\nuniform vec4 uHole;').replace('void main() {', 'void main() {\nif (vHoleP.x > uHole.x && vHoleP.x < uHole.z && vHoleP.y > uHole.y && vHoleP.y < uHole.w) discard;') };
  mat.customProgramCacheKey = () => 'hole' }
function holeNone() { return { value: new THREE.Vector4(1e9, 1e9, -1e9, -1e9) } }
const setHole = (h, r, inset) => h.value.set(r[0] + inset, r[1] + inset, r[2] - inset, r[3] - inset);
function storyMesh(cx, cy, half, stride, coarse, kind) {
  const h = G.hfStory, dx = 2 * h.sz[0] / (h.nc - 1), dy = 2 * h.sz[1] / (h.nr - 1);
  const c0 = Math.max(0, Math.round((cx - half - h.ox + h.sz[0]) / dx)), c1 = Math.min(h.nc - 1, Math.round((cx + half - h.ox + h.sz[0]) / dx)), r0 = Math.max(0, Math.round((cy - half - h.oy + h.sz[1]) / dy)), r1 = Math.min(h.nr - 1, Math.round((cy + half - h.oy + h.sz[1]) / dy));
  const cols = Math.floor((c1 - c0) / stride) + 1, rows = Math.floor((r1 - r0) / stride) + 1;
  const dark = css('--bg').toLowerCase() === '#0e0e0e'; const A = new THREE.Color(dark ? 0x3a3a3a : 0xb4b4b0), B = new THREE.Color(dark ? 0x323232 : 0xa6a6a2);
  const mesh = gridMesh(cols + 2, rows + 2, (pos, col) => { let k = 0; for (let i = -1; i <= rows; i++) { const ii = clamp(i, 0, rows - 1), r = r0 + ii * stride; for (let j = -1; j <= cols; j++) { const jj = clamp(j, 0, cols - 1), c = c0 + jj * stride, x = h.ox - h.sz[0] + c * dx, y = h.oy - h.sz[1] + r * dy;
    const z = h.oz + h.data[r * h.nc + c] * h.sz[2]; const q = coarse ? A : (((Math.floor(x) + Math.floor(y)) & 1) ? A : B); col.set([q.r, q.g, q.b], 3 * k); pos.set([x, y, z - (coarse ? .04 : 0) - (i !== ii || j !== jj ? .3 : 0)], 3 * k); k++ } } },
    { mat: kind || 'plain', noShadow: coarse, grid: { nc: cols, nr: rows, h: stride * dx, off: 1 } });
  mesh.userData.rect = [h.ox - h.sz[0] + c0 * dx, h.oy - h.sz[1] + r0 * dy, h.ox - h.sz[0] + (c0 + (cols - 1) * stride) * dx, h.oy - h.sz[1] + (r0 + (rows - 1) * stride) * dy]; return mesh }
function buildCoarse() { if (!G || !G.hfStory) return; if (G.coarse) { G.scene.remove(G.coarse); G.coarse.geometry.dispose() } G.coarse = storyMesh(0, 0, 32, LOWMEM ? 24 : 12, true, 'storyCoarse'); G.coarse.visible = groundMode !== 'world'; G.scene.add(G.coarse) }
function buildStoryGround(x, y, force) {
  if (!force && G.win && Math.hypot(x - G.win[0], y - G.win[1]) < 1.2) return;
  const fullRebuild = force || !G.winBig || Math.hypot(x - G.winBig[0], y - G.winBig[1]) > 4.5;
  if (fullRebuild) { if (G.story) { G.scene.remove(G.story); G.story.geometry.dispose() } G.story = storyMesh(x, y, LOWMEM ? 8 : 11, 2, false, 'storyMid'); G.scene.add(G.story); G.winBig = [x, y]; setHole(G.holeMid, G.story.userData.rect, .06) }
  if (G.patch) { G.scene.remove(G.patch); G.patch.geometry.dispose() } G.patch = storyMesh(x, y, LOWMEM ? 2.4 : 3.2, 1, false); G.scene.add(G.patch); G.win = [x, y]; setHole(G.holePatch, G.patch.userData.rect, .03) }

/* ---- the world renderer: chunk meshes at two levels of detail, solids as instances ---- */
const WR = { root: null, hole: holeNone(), chunks: new Map(), patch: null, patchAt: null, decorAt: null, pools: null };
function wrInit() {
  WR.root = new THREE.Group(); WR.root.visible = false; G.scene.add(WR.root);
  const mk = (geo, cap, flat) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .85, metalness: .05, envMapIntensity: .25, flatShading: !!flat }), cap); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); m.castShadow = !LOWMEM; m.receiveShadow = !LOWMEM; m.count = 0; m.frustumCulled = false; WR.root.add(m); return m };
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 14); cyl.rotateX(Math.PI / 2);
  const pyr = new THREE.ConeGeometry(Math.SQRT2, 1, 4); pyr.rotateX(Math.PI / 2); pyr.rotateZ(Math.PI / 4);
  WR.pools = { box: mk(new THREE.BoxGeometry(1, 1, 1), LOWMEM ? 4000 : 9000), cyl: mk(cyl, 2500), ico: mk(new THREE.IcosahedronGeometry(1, 1), 4000, true), pyr: mk(pyr, 80, true) };
}
function wrShow(on) { if (WR.root) WR.root.visible = on }
function wrSync() { if (St && WR.root) { const o = St.offset(); WR.root.position.set(-o[0], -o[1], 0); wrHole() } }
function wrReset() { for (const c of WR.chunks.values()) { WR.root.remove(c.mesh); c.mesh.geometry.dispose() } WR.chunks.clear(); if (WR.patch) { WR.root.remove(WR.patch); WR.patch.geometry.dispose(); WR.patch = null } WR.patchAt = null; WR.decorAt = null; for (const p of Object.values(WR.pools)) p.count = 0 }
function colourOf(m, x, y, out, o) { const b = MATCOL[m] || MATCOL[0]; const nz = .88 + .16 * FiaWorld.vnoise(x * .45, y * .45, 3) + .05 * FiaWorld.vnoise(x * 2.2, y * 2.2, 4) + .012 * FiaWorld.hash(Math.floor(x * 10), Math.floor(y * 10), 5); out[o] = b[0] * nz; out[o + 1] = b[1] * nz; out[o + 2] = b[2] * nz }
// One chunk at sample stride `stride`, with a skirt that hides the seams between levels of detail.
function chunkMesh(kx, ky, stride) {
  const w = W.world, CH = w.CH, dx = w.dx, n = CH / stride + 1, cols = n + 2, X0 = kx * CH * dx, Y0 = ky * CH * dx;
  const mesh = gridMesh(cols, cols, (pos, col) => { let k = 0; for (let i = -1; i <= n; i++) { const ii = clamp(i, 0, n - 1); for (let j = -1; j <= n; j++) { const jj = clamp(j, 0, n - 1);
    const x = (kx * CH + jj * stride) * dx, y = (ky * CH + ii * stride) * dx; const z = w.surfaceAt(x, y); colourOf(w.lastMat(), x, y, col, 3 * k);
    pos[3 * k] = x - X0; pos[3 * k + 1] = y - Y0; pos[3 * k + 2] = z - ((i !== ii || j !== jj) ? .5 : 0); k++ } } }, { mat: 'chunk', noShadow: stride > 4, grid: { nc: n, nr: n, h: stride * dx, off: 1 } });
  mesh.position.set(X0, Y0, 0); return mesh }
// The ground right under the robot at full resolution: the very samples the contacts use.
function patchMesh(X, Y, half) {
  const w = W.world, dx = w.dx, i0 = Math.round((X - half) / dx), j0 = Math.round((Y - half) / dx), n = Math.round(2 * half / dx) + 1, X0 = i0 * dx, Y0 = j0 * dx;
  const mesh = gridMesh(n + 2, n + 2, (pos, col) => { let k = 0; for (let i = -1; i <= n; i++) { const ii = clamp(i, 0, n - 1); for (let j = -1; j <= n; j++) { const jj = clamp(j, 0, n - 1), x = (i0 + jj) * dx, y = (j0 + ii) * dx; const z = w.surfaceAt(x, y); colourOf(w.lastMat(), x, y, col, 3 * k); pos[3 * k] = x - X0; pos[3 * k + 1] = y - Y0; pos[3 * k + 2] = z - (i !== ii || j !== jj ? .3 : 0); k++ } } }, { grid: { nc: n, nr: n, h: dx, off: 1 } });
  mesh.position.set(X0, Y0, 0); mesh.userData.rect = [X0, Y0, X0 + (n - 1) * dx, Y0 + (n - 1) * dx]; return mesh }
function wrHole() { if (!WR.patch || !St) return; const r = WR.patch.userData.rect, o = St.offset(); setHole(WR.hole, [r[0] - o[0], r[1] - o[1], r[2] - o[0], r[3] - o[1]], .03) }
function wrUpdate(X, Y, budget) {
  if (!W.world || !WR.root) return; const t0 = performance.now(); const cs = St.chunkSize, kx = Math.floor(X / cs), ky = Math.floor(Y / cs), R = LOWMEM ? 4 : 6;
  const NEAR = LOWMEM ? 4 : 2, FAR = LOWMEM ? 32 : 16;
  for (const [k, c] of WR.chunks) if (Math.max(Math.abs(c.kx - kx), Math.abs(c.ky - ky)) > R + 1) { WR.root.remove(c.mesh); c.mesh.geometry.dispose(); WR.chunks.delete(k) }
  const todo = [];
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { const d = Math.max(Math.abs(i), Math.abs(j)), lod = d <= 1 ? 0 : 1, key = (kx + i) + ',' + (ky + j), c = WR.chunks.get(key); if (!c || c.lod !== lod) todo.push([d, kx + i, ky + j, lod, key]) }
  todo.sort((a, b) => a[0] - b[0]);
  // Within the frame budget; past it, only ground that has no mesh at all is built now.
  for (const [d, a, b, lod, key] of todo) { if (performance.now() - t0 > budget && (d > 1 || WR.chunks.has(key))) continue; const old = WR.chunks.get(key); const mesh = chunkMesh(a, b, lod ? FAR : NEAR); WR.root.add(mesh); if (old) { WR.root.remove(old.mesh); old.mesh.geometry.dispose() } WR.chunks.set(key, { kx: a, ky: b, lod, mesh }) }
  if (!WR.patchAt || Math.hypot(X - WR.patchAt[0], Y - WR.patchAt[1]) > 1.2) { if (WR.patch) { WR.root.remove(WR.patch); WR.patch.geometry.dispose() } WR.patch = patchMesh(X, Y, LOWMEM ? 2.4 : 3.2); WR.root.add(WR.patch); WR.patchAt = [X, Y]; wrHole() }
  const dk = Math.floor(X / 8) + ',' + Math.floor(Y / 8); if (WR.decorAt !== dk) { WR.decorAt = dk; fillDecor(X, Y) }
}
// Every solid is drawn with the size and height that were written into the physics.
function fillDecor(X, Y) {
  const w = W.world, P = WR.pools, dummy = new THREE.Object3D(), col = new THREE.Color(); const cnt = { box: 0, cyl: 0, ico: 0, pyr: 0 };
  const put = (pool, x, y, z0, z1, sx, sy, rot, c) => { const p = P[pool]; if (cnt[pool] >= p.instanceMatrix.count) return; dummy.position.set(x, y, (z0 + z1) / 2); dummy.rotation.set(0, 0, rot || 0); dummy.scale.set(sx, sy, Math.max(.001, z1 - z0)); dummy.updateMatrix(); p.setMatrixAt(cnt[pool], dummy.matrix); p.setColorAt(cnt[pool], col.set(c)); cnt[pool]++ };
  const local = (o, u, v) => [o.x + u * Math.cos(o.rot || 0) - v * Math.sin(o.rot || 0), o.y + u * Math.sin(o.rot || 0) + v * Math.cos(o.rot || 0)];
  const hueCol = (h, list) => list[Math.floor(h * list.length) % list.length];
  for (const C of w.cellsNear(X, Y, LOWMEM ? 30 : 46)) for (const o of w.solidsOf(C)) {
    const z0 = o.z0, top = o.top, low = z0 - .3;
    switch (o.look) {
      case 'tree': put('cyl', o.x, o.y, low, z0 + o.H, o.r, o.r, 0, 0x5a4330); for (let s = 0; s < 2; s++) { const rr = o.crown * (s ? .7 : 1); const c = new THREE.Color(0x3f5f2a).lerp(new THREE.Color(0x66843a), (o.hue + s * .37) % 1); dummy.position.set(o.x + (s ? .25 : 0), o.y + (s ? -.2 : 0), z0 + o.H + rr * (s ? 1.1 : .5)); dummy.rotation.set(o.x, o.y, 0); dummy.scale.set(rr, rr, rr * 1.15); dummy.updateMatrix(); if (cnt.ico < P.ico.instanceMatrix.count) { P.ico.setMatrixAt(cnt.ico, dummy.matrix); P.ico.setColorAt(cnt.ico, c); cnt.ico++ } } break;
      case 'column': if (o.k === 'cyl') put('cyl', o.x, o.y, low, top, o.r, o.r, 0, 0xb4ab98); else put('box', o.x, o.y, low, top, 2 * o.hx, 2 * o.hy, o.rot, 0x56606a); break;
      case 'machine': { put('box', o.x, o.y, low, top, 2 * o.hx, 2 * o.hy, o.rot, hueCol(o.hue, [0x4f6b5e, 0x5a6f86, 0x8a8f94, 0x6d5f4b])); const [px, py] = local(o, o.hx * .45, 0); put('box', px, py, top, top + .22, o.hx * .7, o.hy * 1.2, o.rot, 0x2b2f33); put('box', o.x, o.y, top - .06, top + .005, 2 * o.hx + .01, 2 * o.hy + .01, o.rot, 0xd6a017); break }
      case 'conveyor': put('box', o.x, o.y, low, top - .05, 2 * o.hx, 2 * o.hy, o.rot, 0x5b6168); put('box', o.x, o.y, top - .05, top, 2 * o.hx, 2 * o.hy - .08, o.rot, 0x1f2224); break;
      case 'booth': put('box', o.x, o.y, low, top, 2 * o.hx, 2 * o.hy, o.rot, 0xd4d6d8); put('box', o.x, o.y, z0 + 1.1, z0 + 1.8, 2 * o.hx + .02, 2 * o.hy + .02, o.rot, 0x31495e); break;
      case 'rack': { const long = o.hx > o.hy, Lh = long ? o.hx : o.hy, Dh = long ? o.hy : o.hx, bays = Math.max(1, Math.round(2 * Lh / 2.7)), bw = 2 * Lh / bays, ang = long ? 0 : Math.PI / 2;
        const at = (u, v) => [o.x + (long ? u : -v), o.y + (long ? v : u)];
        for (let b = 0; b <= bays; b++) { const [x, y] = at(-Lh + b * bw, 0); put('box', x, y, low, top, .08, 2 * Dh, ang, 0x2f5fa0) }
        for (const lv of [0, .8, 1.6]) { const [x, y] = at(0, 0); put('box', x, y, z0 + lv + .04, z0 + lv + .1, 2 * Lh, 2 * Dh, ang, 0xe07a1f);
          for (let b = 0; b < bays; b++) { const [cx, cy] = at(-Lh + (b + .5) * bw, 0); put('box', cx, cy, z0 + lv + .1, z0 + lv + .1 + .62, bw - .14, 2 * Dh - .02, ang, hueCol((o.hue + b * .31 + lv) % 1, [0xb08a5c, 0x9c774b, 0xc49d6a, 0x3f6fa0, 0x8a8a84])) } } break }
      case 'pallet': put('box', o.x, o.y, low, z0 + .15, 2 * o.hx, 2 * o.hy, o.rot, 0x9a7449); if (top > z0 + .2) put('box', o.x, o.y, z0 + .15, top, 2 * o.hx - .04, 2 * o.hy - .04, o.rot, hueCol(o.hue, [0xb48c5e, 0xa47f52, 0xcfc8b8])); break;
      case 'debris': put('box', o.x, o.y, low, top, 2 * o.hx, 2 * o.hy, o.rot, hueCol(o.hue, [0x8c8984, 0x77736c, 0x9b968d, 0x7a4a32])); break;
      case 'wall': put('box', o.x, o.y, low, top, 2 * o.hx, 2 * o.hy, o.rot, 0xa29d94); break;
      case 'rail': put('box', o.x, o.y, z0, top, 2 * o.hx, 2 * o.hy, o.rot, 0xe0b11c); break;
      case 'tent': put('pyr', o.x, o.y, z0, top, o.r, o.r, o.rot, w.kind === 'rescue' ? 0xd6602a : 0xc8643a); break;
      default: if (o.k === 'cyl') put('cyl', o.x, o.y, low, top, o.r, o.r, 0, 0x888888); else if (o.k === 'box') put('box', o.x, o.y, low, top, 2 * o.hx, 2 * o.hy, o.rot, 0x888888);
    } }
  for (const [k, p] of Object.entries(P)) { p.count = cnt[k]; p.instanceMatrix.needsUpdate = true; if (p.instanceColor) p.instanceColor.needsUpdate = true }
}

/* ---- robots ---- */
function buildRobots() {
  for (const rb of G.robots) { G.scene.remove(rb.group); rb.arrows.forEach(a => G.scene.remove(a)); rb.cmdArrows.forEach(a => G.scene.remove(a)); rb.label && rb.label.remove(); rb.ring && G.scene.remove(rb.ring); overlays.drop(rb) }
  G.robots = []; const compare = robots.length === 2 || cur.brains.length === 2; const mat = metal(); $('bPlace').hidden = compare;
  robots.forEach(r => { const tintVar = compare ? (r.slotLabel === 0 ? '--s-ppo' : '--s-shac') : null;
    const group = new THREE.Group(); for (const p of G.parts) { const m = new THREE.Mesh(p.geo, mat); m.matrixAutoUpdate = false; m.castShadow = true; m.userData.g = p.g; group.add(m) } G.scene.add(group);
    const arrows = [0, 1, 2, 3].map(() => { const a = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), .3, 0xe30613, .06, .035); G.scene.add(a); return a });
    const cmdArrows = [0, 1, 2, 3].map(() => { const a = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), .3, 0x111111, .05, .03); a.visible = false; G.scene.add(a); return a });
    let label = null, ring = null; if (compare) { label = document.createElement('div'); label.className = 'label3d'; label.style.background = `var(${tintVar})`; label.textContent = bn(r.brain); $('labels').append(label);
      ring = new THREE.Mesh(new THREE.RingGeometry(.42, .5, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(css(tintVar)), transparent: true, opacity: .85 })); G.scene.add(ring) }
    const rb = { id: r.id, group, arrows, cmdArrows, label, ring, tintVar }; overlays.make(rb); G.robots.push(rb) });
  overlays.set(overlays.on); overlays.recolor();
  if (!robots.length) return;
  const T = tel(robots[0].id), yw = yawOf(T); const side = compare && !cur.relay && mode !== 'world' ? .9 : 0, far = (compare ? 1.45 : 1) * (G.cam.aspect < .8 ? 1.5 : 1); G.panOff.set(0, 0, 0); G.ctl.target.set(T[9], T[10] + side, T[11]);
  const bx = Math.cos(yw) * -2.6 - Math.sin(yw) * -1.6, by = Math.sin(yw) * -2.6 + Math.cos(yw) * -1.6; G.cam.position.set(T[9] + bx * far, T[10] + side + by * far, T[11] + 1.3 * far);
  G.standPose = null;
}

/* ---- overlays, one set per robot: capture point and support polygon, friction cones, collision geometry ---- */
const overlays = {
  on: {}, last: null,
  make(rb) { const o = rb.ov = {}; const grp = o.cp = new THREE.Group(); G.scene.add(grp); grp.renderOrder = 5; grp.visible = false;
    o.poly = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: .16, depthWrite: false, side: THREE.DoubleSide })); grp.add(o.poly);
    o.polyLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x111111 })); grp.add(o.polyLine);
    o.cpDot = new THREE.Mesh(new THREE.CircleGeometry(.035, 24), new THREE.MeshBasicMaterial({ color: 0xe30613, depthTest: false })); grp.add(o.cpDot);
    o.comDot = new THREE.Mesh(new THREE.RingGeometry(.025, .04, 24), new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false })); grp.add(o.comDot);
    o.cpLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xe30613, depthTest: false })); grp.add(o.cpLine);
    o.cones = [0, 1, 2, 3].map(() => { const g = new THREE.ConeGeometry(.6 * .22, .22, 24, 1, true); g.translate(0, -.11, 0); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xe30613, transparent: true, opacity: .14, side: THREE.DoubleSide, depthWrite: false })); m.visible = false; G.scene.add(m); return m });
    o.coll = [] },
  drop(rb) { const o = rb.ov; if (!o) return; G.scene.remove(o.cp); o.cones.forEach(c => G.scene.remove(c)); o.coll.forEach(m => G.scene.remove(m)) },
  set(on) { this.on = on || {}; if (!G) return; for (const rb of G.robots) { const o = rb.ov; o.cp.visible = !!this.on.cp; o.cones.forEach(c => c.visible = false); rb.cmdArrows.forEach(a => a.visible = false); this.buildColl(rb);
    rb.group.children.forEach(m => { m.material.transparent = !!this.on.coll; m.material.opacity = this.on.coll ? .35 : 1 }) } },
  buildColl(rb) { const o = rb.ov; o.coll.forEach(m => G.scene.remove(m)); o.coll = []; if (!this.on.coll || !G.coll) return; const mat = new THREE.MeshBasicMaterial({ color: 0xe30613, wireframe: true, transparent: true, opacity: .7 });
    for (const c of G.coll) { const r = c.size[0], geo = c.ty === 2 ? new THREE.SphereGeometry(r, 12, 8) : new THREE.CylinderGeometry(r, r, 2 * c.size[1], 10, 1, true);
      const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; m.userData.c = c; G.scene.add(m); o.coll.push(m) } },
  // Single robot: ink; two robots: each in its own colour.
  recolor() { if (!G) return; const ink = new THREE.Color(css('--ink')); for (const rb of G.robots) { const c = new THREE.Color(css(rb.tintVar || '--ink')), o = rb.ov; if (!o) continue;
    o.poly.material.color.copy(c); o.polyLine.material.color.copy(c); o.comDot.material.color.copy(c); rb.cmdArrows.forEach(a => a.setColor(ink)); if (rb.ring) rb.ring.material.color.set(css(rb.tintVar)) } },
  // Capture point of the whole-body centre of mass, from the simulator's truth.
  capture(T, P) { const c = [T[96], T[97], T[98]], v = [T[99], T[100]], gz = groundAt(c[0], c[1]), h = Math.max(.12, c[2] - gz), w0 = Math.sqrt(9.81 / h);
    const xi = [c[0] + v[0] / w0, c[1] + v[1] / w0]; const feet = []; for (let l = 0; l < 4; l++) if (T[21 + l] > .5) { const g = G.feet[l]; feet.push([P[12 * g], P[12 * g + 1], P[12 * g + 2]]) }
    const hull = convexHull(feet.map(f => [f[0], f[1]])); const m = hull.length >= 3 ? polyMargin(hull, xi) : hull.length === 2 ? -segDist(xi, hull[0], hull[1]) : -1;
    return { c, xi, gz, h, w0, hull, feet, margin: m } },
  update(rb, T, P) { const o = rb.ov;
    if (this.on.cp) { const k = this.capture(T, P); const z = (k.feet.length ? k.feet.reduce((a, f) => a + f[2], 0) / k.feet.length - .015 : k.gz) + .004;
      if (k.hull.length >= 3) { const v = []; for (let i = 1; i + 1 < k.hull.length; i++) v.push(k.hull[0][0], k.hull[0][1], z, k.hull[i][0], k.hull[i][1], z, k.hull[i + 1][0], k.hull[i + 1][1], z); o.poly.geometry.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); o.poly.visible = true } else o.poly.visible = false;
      o.polyLine.geometry.setFromPoints(k.hull.map(p => new THREE.Vector3(p[0], p[1], z))); o.polyLine.visible = k.hull.length >= 2;
      o.cpDot.position.set(k.xi[0], k.xi[1], z + .002); o.comDot.position.set(k.c[0], k.c[1], z + .002); o.cpLine.geometry.setFromPoints([new THREE.Vector3(k.c[0], k.c[1], z + .002), new THREE.Vector3(k.xi[0], k.xi[1], z + .002)]);
      o.cpDot.material.color.set(k.margin >= 0 ? 0x1f7a45 : 0xe30613); rb.last = k; if (rb === G.robots[0]) this.last = k }
    if (this.on.cones) { const n = new THREE.Vector3(-T[88], -T[89], 1).normalize();
      for (let l = 0; l < 4; l++) { const c = o.cones[l], g = G.feet[l]; c.visible = T[21 + l] > .5; if (!c.visible) continue; c.position.set(P[12 * g], P[12 * g + 1], P[12 * g + 2] - .02); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); c.material.opacity = T[29 + l] > .5 ? .32 : .14 } }
    if (this.on.coll) for (const m of o.coll) { const c = m.userData.c, q = 12 * c.g; m.matrix.set(P[q + 3], P[q + 4], P[q + 5], P[q], P[q + 6], P[q + 7], P[q + 8], P[q + 1], P[q + 9], P[q + 10], P[q + 11], P[q + 2], 0, 0, 0, 1);
      if (c.ty === 3) m.matrix.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)) }
  } };
function convexHull(pts) { if (pts.length < 3) return pts.slice(); const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) } for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) } up.pop(); lo.pop(); return lo.concat(up) }
function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1]; const s = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1); return Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dy) }
// Signed distance from p to the boundary of a counter-clockwise convex polygon: positive inside.
function polyMargin(h, p) { let inside = true, d = 1e9; for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); if (cr < 0) inside = false; d = Math.min(d, segDist(p, a, b)) } return inside ? d : -d }

const m4 = new THREE.Matrix4(), tmp = new THREE.Vector3();
function placeLabel(el, p) { tmp.copy(p).project(G.cam); const r = $('gl').getBoundingClientRect(); el.style.left = ((tmp.x + 1) / 2 * r.width) + 'px'; el.style.top = ((1 - tmp.y) / 2 * r.height) + 'px'; el.hidden = tmp.z > 1 || Math.abs(tmp.x) > 1.1 || Math.abs(tmp.y) > 1.1 }
function draw() {
  if (!G || !robots.length || !G.robots.length) return; let cx = 0, cy = 0, cz = 0;
  G.robots.forEach(rb => { const P = poses(rb.id), T = tel(rb.id), r = SES[rb.id], on = !!(r && r.ready);
    // A robot appears once its simulator thread has started it.
    if (rb.shown !== on) { rb.shown = on; rb.group.visible = on; if (rb.ring) rb.ring.visible = on; if (rb.label) rb.label.style.visibility = on ? '' : 'hidden'; rb.ov.cp.visible = on && !!overlays.on.cp;
      if (!on) { rb.arrows.forEach(a => a.visible = false); rb.cmdArrows.forEach(a => a.visible = false) } }
    if (!on) { rb.ov.cp.visible = false; cx += T[9]; cy += T[10]; cz += T[11]; rb.at = null; return }
    for (const m of rb.group.children) { const o = 12 * m.userData.g; m4.set(P[o + 3], P[o + 4], P[o + 5], P[o], P[o + 6], P[o + 7], P[o + 8], P[o + 1], P[o + 9], P[o + 10], P[o + 11], P[o + 2], 0, 0, 0, 1); m.matrix.copy(m4) }
    G.feet.forEach((g, l) => { const a = rb.arrows[l]; tmp.set(T[49 + 3 * l], T[50 + 3 * l], T[51 + 3 * l]); const n = tmp.length(); a.visible = n > 8 && T[21 + l] > .5; if (a.visible) {
      a.position.set(P[12 * g], P[12 * g + 1], P[12 * g + 2] - .02); a.setDirection(tmp.normalize()); a.setLength(Math.min(.6, n / 450), .05, .03); a.setColor(T[29 + l] > .5 ? 0xd89a2a : 0xe30613) }
      const b = rb.cmdArrows[l]; if (overlays.on.cones) { tmp.set(T[37 + 3 * l], T[38 + 3 * l], T[39 + 3 * l]); const m = tmp.length(); b.visible = m > 8 && T[21 + l] > .5; if (b.visible) { b.position.set(P[12 * g] + .03, P[12 * g + 1], P[12 * g + 2] - .02); b.setDirection(tmp.normalize()); b.setLength(Math.min(.6, m / 450), .05, .03) } } });
    overlays.update(rb, T, P);
    cx += T[9]; cy += T[10]; cz += T[11];
    if (rb.ring) rb.ring.position.set(T[9], T[10], groundAt(T[9], T[10]) + .015);
    rb.at = new THREE.Vector3(T[9], T[10], T[11] + .45) });
  const n = G.robots.length; G.avg.set(cx / n, cy / n, cz / n);
  tmp.copy(G.avg).add(G.panOff).sub(G.ctl.target).multiplyScalar(.07); G.ctl.target.add(tmp); G.cam.position.add(tmp);
  G.sun.position.set(cx / n - 3, cy / n - 5, cz / n + 9); G.sun.target.position.set(cx / n, cy / n, cz / n); G.dome.position.set(cx / n, cy / n, 0);
  if (groundMode !== 'world') buildStoryGround(cx / n, cy / n, false);
  if (G.drag && G.drag.end) { const T = tel(G.drag.rb.id), o = new THREE.Vector3(T[9], T[10], T[11]), v = G.drag.end.clone().sub(o); v.z = 0; const L = v.length();
    if (L > .05) { G.shove.position.copy(o); G.shove.setDirection(v.normalize()); G.shove.setLength(Math.min(1.2, L), .12, .08); G.shove.visible = true } }
  captureStandPose(); if (placing) drawGhost();
  G.ctl.update(); if (G.panning) G.panOff.copy(G.ctl.target).sub(G.avg); G.R.render(G.scene, G.cam);
  for (const rb of G.robots) if (rb.label && rb.at) placeLabel(rb.label, rb.at);
  if (mode === 'world' && St) { const o = St.offset(); for (const m of G.marks) placeLabel(m.label, tmp.clone().set(m.w[0] - o[0], m.w[1] - o[1], m.w[2])) }
  const T0 = tel(robots[0].id), f = STATE_FSM[T0[1]] || null; if (f !== lastFsm) { lastFsm = f; drawFsm(f); const lf = $('labFsm'); if (lf) drawFsm(f, lf) }
  if (mode === 'story') drawStrip();
}

/* ================= the operator ================= */
// Lifting the robot, carrying it and setting it down, as a person at the robot would. The controller is
// restarted where it is set down, as it is after the robot has been handled: it sits, finds its
// bearings and stands up again, so the estimator never sees the robot jump.
let placing = null;
const trunkMatrix = T => new THREE.Matrix4().compose(new THREE.Vector3(T[9], T[10], T[11]), new THREE.Quaternion(T[16], T[17], T[18], T[15]), new THREE.Vector3(1, 1, 1));
function captureStandPose() { if (G.standPose || !robots.length || !G.robots.length) return; const T = tel(robots[0].id); if (T[1] !== 4 && !(T[1] === 5 && T[0] > 4)) return;
  const inv = trunkMatrix(T).invert(); G.standPose = { rel: G.robots[0].group.children.map(m => inv.clone().multiply(m.matrix)), height: T[11] - groundAt(T[9], T[10]) } }
// How uneven the ground is under the robot's footprint; a spot on top of a solid object counts as unusable.
function groundSpan(x, y) { let lo = 1e9, hi = -1e9; for (let a = 0; a < 12; a++) { for (const r of [0, .15, .3, .5]) { const px = x + r * Math.cos(a * .5236), py = y + r * Math.sin(a * .5236), z = solidAt(px, py); if (groundMode === 'world' && z - groundAt(px, py) > .03) return 9; lo = Math.min(lo, z); hi = Math.max(hi, z) } } return hi - lo }
function inBounds(x, y) { if (groundMode === 'world') return Math.abs(x) < 14 && Math.abs(y) < 14; const c = tileCenter(tileOf(cur.spot.x, cur.spot.y)); return Math.abs(x - c[0]) < 7 && Math.abs(y - c[1]) < 7 }
// The nearest spot within reach that is level enough for the robot to sit and stand on.
function findSpot(x, y, reach) { for (let r = 0; r <= (reach || 2.4); r += .2) for (let a = 0; a < (r ? Math.ceil(r * 12) : 1); a++) { const px = x + r * Math.cos(a / (r * 12 || 1) * 6.283), py = y + r * Math.sin(a / (r * 12 || 1) * 6.283);
  if (inBounds(px, py) && groundSpan(px, py) < .12) return [px, py] } return null }
function enterPlace() { if (!loaded || !robots.length || robots.length > 1) return; hideToast(); closePanels(); const T = tel(robots[0].id);
  placing = { x: T[9], y: T[10], yaw: yawOf(T), down: false }; G.ctl.enabled = false; $('stage').classList.add('placing'); $('placebar').hidden = false; $('bPlace').setAttribute('aria-pressed', 'true');
  if (!G.ghost) { const mat = new THREE.MeshBasicMaterial({ color: 0xe30613, transparent: true, opacity: .35, depthWrite: false }); G.ghost = new THREE.Group(); for (const p of G.parts) { const m = new THREE.Mesh(p.geo, mat); m.matrixAutoUpdate = false; G.ghost.add(m) } G.scene.add(G.ghost) }
  G.ghost.visible = true }
function exitPlace() { placing = null; if (G) { G.ctl.enabled = true; if (G.ghost) G.ghost.visible = false } $('stage').classList.remove('placing'); $('placebar').hidden = true; $('bPlace').setAttribute('aria-pressed', 'false') }
function groundHit(v) { G.ray.setFromCamera(v, G.cam); const objs = groundMode === 'world' ? [WR.patch].concat([...WR.chunks.values()].filter(c => c.lod === 0).map(c => c.mesh)) : [G.patch, G.story, G.coarse]; const hits = G.ray.intersectObjects(objs.filter(Boolean), false); return hits[0] ? hits[0].point : null }
function placeDown(e, v) { const p = groundHit(v); if (!p) return; placing.x = p.x; placing.y = p.y; placing.down = true; placing.pid = e.pointerId }
function placeMove(v) { const p = groundHit(v); if (!p) return; const dx = p.x - placing.x, dy = p.y - placing.y; if (Math.hypot(dx, dy) > .25) placing.yaw = Math.atan2(dy, dx) }
function placeUp() { const p = placing; p.down = false; setDown(p.x, p.y, p.yaw) }
function drawGhost() { if (!G.ghost) return; const p = placing; let sp = G.standPose;
  if (!sp && robots.length && G.robots.length) { const T = tel(robots[0].id), inv = trunkMatrix(T).invert(); sp = { rel: G.robots[0].group.children.map(m => inv.clone().multiply(m.matrix)), height: Math.max(.3, T[11] - groundAt(T[9], T[10])) } } const h = sp ? sp.height : .36; const ok = inBounds(p.x, p.y) && groundSpan(p.x, p.y) < .12;
  G.ghost.children[0].material.color.set(ok ? 0xe30613 : 0x9a9a9a);
  const base = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, groundAt(p.x, p.y) + h), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.yaw), new THREE.Vector3(1, 1, 1));
  G.ghost.children.forEach((m, i) => { if (sp) m.matrix.copy(base).multiply(sp.rel[i]); else m.matrix.copy(base) }) }
function setDown(x, y, yaw) { const spot = findSpot(x, y);
  if (!spot) { exitPlace(); toast(t('toast.rough'), t('toast.roughT'), [[t('toast.pickAgain'), enterPlace, true], [t('toast.leave'), () => { }]]); return }
  exitPlace(); if (mode === 'world') { carry(St.toWorld(spot[0], spot[1]), yaw, true).then(() => banner(t('banner.setDown'), t('banner.restart'))); return }
  const brain = robots[0] ? robots[0].brain : cur.brains[0]; freeAll(); SIM.use(0);
  const r = initSession(0, brain, spot[0], spot[1], !!cur.spot.slope, yaw); if (!r) return; r.slotLabel = 0; robots = [r]; cur.brains = [brain]; cur.relay = null;
  setCmd(0, 0, 0, false); ramp.v = ramp.vy = ramp.w = 0; setPosture(2); buildStoryGround(spot[0], spot[1], true); buildRobots(); tallyKey = ''; if (mode === 'lab') labApplyParams();
  showHint('hint.setDown'); setTimeout(() => showHint(''), 2500) }
function rightHere(back) { const T = tel(robots[0].id); let x = T[9], y = T[10]; const yaw = yawOf(T);
  if (back && mode !== 'world') { const c = tileCenter(tileOf(cur.spot.x, cur.spot.y)); const d = Math.hypot(c[0] - x, c[1] - y) || 1; x += (c[0] - x) / d * back; y += (c[1] - y) / d * back; setDown(x, y, Math.atan2(c[1] - y, c[0] - x)); return }
  setDown(x, y, yaw) }
$('bPlace').onclick = () => { placing ? exitPlace() : enterPlace() };
$('pCancel').onclick = exitPlace;
$('pHere').onclick = () => { const T = tel(robots[0].id); exitPlace(); setDown(T[9], T[10], yawOf(T)) };
