'use strict';
// The project page, part 3 of 4: the endless worlds, the tour, the map and the journal.

// The world's elevations under the heightfield, written by the streamer and sent to the simulator threads.
let terrainHost = null;
const view = () => terrainHost;
const envName = k => t('env.' + k + '.name');
const siteName = s => s ? t('site.' + W.world.kind + '.' + s.type) : '';
async function makeWorld(params) {
  $('gen').hidden = false; $('genT').textContent = t('gen.building'); $('genmsg').textContent = t('gen.msg', { env: envName(params.env), seed: params.seed }); $('genbar').style.width = '0%'; await new Promise(r => setTimeout(r, 30));
  const h = G.hfStory; if (!terrainHost) terrainHost = new Float32Array(h.nr * h.nc);
  W.world = FiaWorld.create(params, { dx: 2 * h.sz[0] / (h.nc - 1), zlo: h.oz, zhi: h.oz + h.sz[2] });
  St = FiaWorld.Streamer(W.world, { nr: h.nr, nc: h.nc, sx: h.sz[0], sy: h.sz[1], sz: h.sz[2], oz: h.oz, ox: h.ox, oy: h.oy }, view, { cacheMax: LOWMEM ? 40 : 72 });
  W.found = new Map(); W.visited = new Set(); mapCache.world = null; wrReset(); themeWorld();
  const p = W.world.params, warn = [];
  if (p.steep > FiaWorld.TRAINED.steep) warn.push(t('world.w.genSteep', { v: p.steep }));
  if (p.riser > FiaWorld.TRAINED.riser + 1e-9) warn.push(t(p.riser > .125 ? 'world.w.genRiserHigh' : 'world.w.genRiser', { v: Math.round(p.riser * 100) }));
  if (W.world.warnings.length && !warn.length) warn.push(t('world.w.genRough', { v: Math.round((W.world.kind === 'valley' ? 6 : 8) * p.rough) }));
  if (warn.length) setTimeout(() => banner(t('banner.range'), warn[0]), 400);
}
// Fills the heightfield around world point X, Y, generating what is missing with a progress bar.
async function fillAround(X, Y, label) {
  const need = St.active(St.chunkOf(X, Y)).filter(q => !St.has(q[0], q[1]));
  if (need.length > 2) { $('gen').hidden = false; $('genT').textContent = label; }
  let i = 0;
  for (const q of need) { const g = W.world.chunkJob(q[0], q[1]); let r; do { r = g.next() } while (!r.done); St.add(r.value); i++; $('genbar').style.width = Math.round(i / need.length * 100) + '%'; if (need.length > 2) await new Promise(res => setTimeout(res, 0)) }
  St.centre(X, Y); SIM.use(1); SIM.terrain(view(), G.hfStory.nc, St.span, true); wrSync(); $('gen').hidden = true;
}
async function enterWorld() {
  mode = 'world'; applyMode(); closePanels(); hideToast(); showHint(''); exitPlace(); overlays.set({}); labReset(); setGait(1);
  if (!loaded) { afterLoad = () => worldStart(); wake(); return }
  await worldStart();
}
async function worldStart() {
  applyMode();
  if (!W.world) await makeWorld(W.params);
  W.brain = W.unlocked.includes(W.brain) ? W.brain : 'rules'; setPosture(2); setLock(false);
  modes.slope = true; showModes();  // the worlds are hilly: the slope mode starts on, and the reader may leave it
  await carry(W.world.tour.spawn, 0, true); renderQuest();
}
const tourPlace = k => W.world.tour[k];
function robotWorld(r) { const T = tel((r || robots[0]).id); return St.toWorld(T[9], T[10]) }
function nearTour(k) { if (!k || !robots.length) return false; const s = tourPlace(k); const P = robotWorld(); return Math.hypot(P[0] - s.cx, P[1] - s.cy) < s.r + 2 }
// Carries the robot (and its rival) to world point P, facing yaw, and starts the controller there.
async function carry(P, yaw, quiet) {
  closePanels(); hideToast(); exitPlace(); useGround('world');
  await fillAround(P[0], P[1], t('gen.carrying'));
  freeAll(); SIM.use(1);
  const sp = findSpot(...St.toSim(P[0], P[1]), 9) || St.toSim(P[0], P[1]);
  robots = []; cur.brains = [W.brain]; cur.relay = null;
  const r = initSession(0, W.brain, sp[0], sp[1], 1, yaw); if (!r) return; r.slotLabel = 1; robots.push(r);
  if (W.rival && !LOWMEM) { const ox = -Math.sin(yaw) * 1.7, oy = Math.cos(yaw) * 1.7; const s2 = findSpot(sp[0] + ox, sp[1] + oy) || [sp[0] + ox, sp[1] + oy]; const r2 = initSession(1, W.rival, s2[0], s2[1], 1, yaw); if (r2) { r2.slotLabel = 0; robots.push(r2); cur.brains = [W.rival, W.brain] } }
  cur.hard = !!(QUESTS[W.q] && QUESTS[W.q].custom === 'fall'); setShove(); setCmd(0, 0, 0, false); ramp.v = ramp.vy = ramp.w = 0;
  wrUpdate(P[0], P[1], 1e9); buildRobots(); buildMarks(); tallyKey = '';
  if (!quiet) banner(t('banner.setDown'), placeName(P));
}
function respawn() { carry(W.world.tour.spawn, 0) }
function equip() { const P = robotWorld(), T = tel(robots[0].id); carry(P, yawOf(T), true).then(() => banner(t('banner.equipped'), bn(W.brain) + (W.rival ? t('toast.and') + bn(W.rival) : ''))) }
function placeName(P) { const C = W.world.cellAt(Math.floor(P[0] / W.world.S), Math.floor(P[1] / W.world.S)); return (C.site ? siteName(C.site) + ' · ' : '') + C.name }
let bannerTimer = 0;
function banner(k, tx) { $('bannerK').textContent = k; $('bannerT').textContent = tx; $('banner').hidden = false; $('banner').style.opacity = 1; clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { $('banner').style.opacity = 0; setTimeout(() => $('banner').hidden = true, 500) }, 2800) }
function questGoal(q) { if (!q || !q.goal) return null; const T = W.world.tour; if (q.goal === 'firstStep' || q.goal === 'workshop') return T[q.goal]; return T[q.at].lm[q.goal] }
function tourNames() { const T = W.world.tour, n = k => siteName(T[k]); return { base: n('base'), slope: n('slope'), steep: n('steep'), stairs: n('stairs'), court: n('court'), guard: n('guard') } }
// A step of the tour that is about a controller makes it available as soon as the step begins.
function unlockCurrent() { const q = QUESTS[W.q]; if (q && q.unlockFirst) for (const u of q.unlock || []) if (!W.unlocked.includes(u)) { W.unlocked.push(u); saveW() } }
function renderQuest() { if (mode !== 'world' || !W.world) return; unlockCurrent(); const q = QUESTS[W.q]; const el = $('quest'); const min = el.classList.contains('min');
  const head = (k, tt) => `<div class="qh"><span class="qk">${k}</span><button id="qMin" aria-label="${t(min ? 'q.showAria' : 'q.hideAria')}" aria-expanded="${!min}">${t(min ? 'q.show' : 'q.hide')}</button></div><b>${tt}</b>`;
  if (!q) { el.innerHTML = head(t('q.doneK'), t('q.doneT')) + `<span class="qd">${t('q.doneD')}</span><span class="qp">${t('q.found', { n: W.found.size })}</span>`; bindQMin(); return }
  const away = q.at && !nearTour(q.at); const need = q.brain && W.brain !== q.brain && W.unlocked.includes(q.brain); const place = q.at ? tourPlace(q.at) : null;
  el.innerHTML = head(t('q.k', { n: W.q + 1, m: QUESTS.length }), t('q.' + q.k + '.t')) + `<span class="qd">${t('q.' + q.k + '.d', tourNames())}</span>` +
    (away ? `<button class="sbtn hot" id="qGo">${t('q.carry', { place: siteName(place) })}</button>` : '') +
    (!away && need ? `<button class="sbtn hot" id="qEq">${t('q.equip', { b: bn(q.brain) })}</button>` : '') + `<span class="qp" id="qProg"></span>`;
  const go = $('qGo'); if (go) go.onclick = () => carry(place.lm.foot || [place.cx, place.cy], place.yaw || 0);
  const eq = $('qEq'); if (eq) eq.onclick = () => { W.brain = q.brain; equip(); renderQuest() };
  bindQMin() }
function bindQMin() { const b = $('qMin'); if (b) b.onclick = e => { e.stopPropagation(); $('quest').classList.toggle('min'); store.set('qmin', $('quest').classList.contains('min')); renderQuest() } }
function completeQuest() { const q = QUESTS[W.q]; if (!q) return;
  if (!W.pages.includes(q.page)) W.pages.push(q.page); (q.unlock || []).forEach(u => { if (!W.unlocked.includes(u)) W.unlocked.push(u) });
  W.q = Math.min(QUESTS.length, W.q + 1); unlockCurrent(); saveW();
  const nq = QUESTS[W.q]; const unl = (q.unlock || []).filter(() => !q.unlockFirst).concat(nq && nq.unlockFirst ? nq.unlock : []).map(bn);
  toast(t('toast.questDone', { t: t('q.' + q.k + '.t') }), t('toast.newPage', { p: t('page.' + q.page + '.t') }) + (unl.length ? t('toast.unlocked', { list: unl.join(t('toast.and')) }) : ''), [[t('toast.read'), () => { reopen('pJournal', 'bJournal', fillJournal) }, true], [t('toast.continue'), () => { }]]);
  buildMarks(); renderQuest(); cur.hard = !!(QUESTS[W.q] && QUESTS[W.q].custom === 'fall'); setShove() }
function worldSample(r, T) {
  const P = St.toWorld(T[9], T[10]); const key = Math.floor(P[0] / 4) + ',' + Math.floor(P[1] / 4);
  if (!W.visited.has(key)) { for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) W.visited.add((Math.floor(P[0] / 4) + a) + ',' + (Math.floor(P[1] / 4) + b)) }
  const C = W.world.cellAt(Math.floor(P[0] / W.world.S), Math.floor(P[1] / W.world.S));
  if (C.site && !W.found.has(C.name) && Math.hypot(P[0] - C.site.cx, P[1] - C.site.cy) < C.site.r * .7) { W.found.set(C.name, C.site); banner(t('banner.found'), siteName(C.site) + ' · ' + C.name) }
  const q = QUESTS[W.q], near = !!(q && q.at && nearTour(q.at)); if (near !== W.wasNear) { W.wasNear = near; renderQuest() }
  checkQuest(r, T, P);
}
function checkQuest(r, T, P) { const q = QUESTS[W.q]; if (!q || toastOpen()) return; const st = T[1]; const prog = $('qProg');
  if (q.brain && r.brain !== q.brain) { if (prog) prog.textContent = t('q.equipFirst', { b: bn(q.brain) }); return }
  if (q.at && !nearTour(q.at)) { if (prog) { const s = tourPlace(q.at); prog.textContent = t('q.dist', { d: Math.round(Math.hypot(P[0] - s.cx, P[1] - s.cy)), place: siteName(s) }) } return }
  if (q.done) { if (q.done(st)) completeQuest(); return }
  if (q.goal) { const g = questGoal(q); const d = Math.hypot(P[0] - g[0], P[1] - g[1]); if (prog) prog.textContent = t('q.ring', { d: fmt(d, 1) }); if (d < 1.4 && (st === 4 || st === 5)) completeQuest(); return }
  if (q.custom === 'shove') { const since = (performance.now() - W.shoveAt) / 1000;
    if (W.shoveAt && since < 6) { if (st >= 8) { if (prog) prog.textContent = t('q.wentDown'); W.shoveAt = 0 } else if (since > 3) { W.shoveAt = 0; completeQuest() } else if (prog) prog.textContent = t('q.holding', { s: fmt(since, 1) }) }
    else if (prog) prog.textContent = t('q.wait'); return }
  if (q.custom === 'fall') { cur.hard = true; setShove(); if (st === 9 || st === 10) { if (!r.guardianSeen) { r.guardianSeen = performance.now(); if (prog) prog.textContent = t('q.caught') } else if (performance.now() - r.guardianSeen > 2500) completeQuest() } return }
  if (q.custom === 'end') { if (W.pages.length >= QUESTS.length - 1 && !$('pJournal').hidden) completeQuest(); else if (prog) prog.textContent = t('q.openJournal'); return }
}
function clearMarks() { if (!G) return; (G.marks || []).forEach(m => { (m.parent || G.scene).remove(m.obj); m.label && m.label.remove() }); G.marks = [] }
// Rings for the tour places and the current goal, in world coordinates.
function buildMarks() { if (!G || mode !== 'world' || !W.world) return; clearMarks(); const q = QUESTS[W.q]; const T = W.world.tour;
  const add = (x, y, name, goal) => { const z = W.world.surfaceAt(x, y); const grp = new THREE.Group(); const col = new THREE.Color(goal ? css('--red') : '#f4f4f4');
    const ring = new THREE.Mesh(new THREE.TorusGeometry(goal ? 1.1 : .35, .035, 8, 64), new THREE.MeshBasicMaterial({ color: col })); ring.position.set(x, y, z + .03); grp.add(ring);
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, goal ? 3 : 1.8, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .75 })); pil.rotation.x = Math.PI / 2; pil.position.set(x, y, z + (goal ? 1.5 : .9)); grp.add(pil);
    WR.root.add(grp); const label = document.createElement('div'); label.className = 'label3d beacon' + (goal ? ' goal' : ''); label.textContent = name; $('labels').append(label); G.marks.push({ obj: grp, parent: WR.root, label, w: [x, y, z + (goal ? 3.1 : 1.9)] }) };
  for (const k of ['base', 'slope', 'stairs', 'steep', 'court', 'guard']) { const s = T[k]; const f = s.lm.foot, a = (s.yaw || 0) + Math.PI / 2; if (k === 'base') add(s.cx + 1.2, s.cy - 6.5, siteName(s), false); else add(f[0] + 2.4 * Math.cos(a), f[1] + 2.4 * Math.sin(a), siteName(s), false) }
  const g = questGoal(q); if (g) add(g[0], g[1], t('q.' + q.k + '.t'), true) }

/* ================= the map ================= */
let mapLive = false;
const mapCache = {};
function fillMap() { mapLive = true; mapDraw(true) }
function mapDraw(full) {
  const c = $('map'), g = c.getContext('2d');
  if (mode === 'world' && W.world) return mapWorld(c, g, full);
  $('mapTitle').textContent = t('panel.map');
  if (!mapCache.story) mapCache.story = renderStoryMap(); g.putImageData(mapCache.story, 0, 0);
  const toPx = (x, y) => [(x + 32) / 64 * 320, (32 - y) / 64 * 320];
  SPOTS.forEach(s => { const [px, py] = toPx(s.x, s.y); const here = s.k === cur.spot.k; g.beginPath(); g.arc(px, py, here ? 7 : 5, 0, 7); g.fillStyle = here ? css('--red') : '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#111'; g.stroke() });
  robots.forEach(r => { const T = tel(r.id); drawArrow(g, ...toPx(T[9], T[10]), yawOf(T), r.slotLabel === 0 && robots.length > 1 ? css('--s-ppo') : css('--red')) });
  if (!full) return;
  const list = $('mapList'); list.innerHTML = '';
  const pick = s => { cur.spot = { ...s }; spotModes(s); sceneLabel('spot.' + s.k); if (mode === 'lab') labStart(true, true); else start() };
  SPOTS.forEach(s => { const b = document.createElement('button'); b.setAttribute('aria-pressed', s.k === cur.spot.k); b.innerHTML = `<b>${t('spot.' + s.k)}</b>`; b.onclick = () => pick(s); list.append(b) });
  c.onclick = e => { const r = c.getBoundingClientRect(); const mx = (e.clientX - r.left) / r.width * 320, my = (e.clientY - r.top) / r.height * 320; let best = null, bd = 1e9;
    SPOTS.forEach(s => { const [px, py] = toPx(s.x, s.y); const d = (px - mx) ** 2 + (py - my) ** 2; if (d < bd) { bd = d; best = s } }); if (best && bd < 1600) pick(best) };
}
function drawArrow(g, px, py, yw, col) { g.save(); g.translate(px, py); g.rotate(-yw); g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, 5); g.lineTo(-5, -5); g.closePath(); g.fillStyle = col; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.4; g.stroke(); g.restore() }
function renderStoryMap() {
  const h = G.hfStory, nr = h.nr, nc = h.nc, d = h.data; const img = new ImageData(320, 320), st = nc / 320, at = (r, c) => d[clamp(r, 0, nr - 1) * nc + clamp(c, 0, nc - 1)];
  for (let py = 0; py < 320; py++)for (let px = 0; px < 320; px++) { const r = Math.floor((319 - py) * st), c = Math.floor(px * st), hv = at(r, c);
    const sh = clamp(.75 + (at(r, c - 4) - at(r, c + 4)) * 25 + (at(r + 4, c) - at(r - 4, c)) * 25, 0, 1.25); const i = 4 * (py * 320 + px);
    const v = Math.min(255, 110 + 120 * Math.min(1, sh * .8 + (hv - .5) * .4)); img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v * .98; img.data[i + 3] = 255 }
  return img }
// The world map: about 120 m around the robot, redrawn when the robot moves far, with the robots live.
function mapWorld(c, g, full) {
  const w = W.world, P = robotWorld(), span = LOWMEM ? 96 : 120, res = span / 320;
  let mc = mapCache.world;
  if (!mc || Math.hypot(P[0] - mc.cx, P[1] - mc.cy) > span * .22) {
    const cx = Math.round(P[0] / 8) * 8, cy = Math.round(P[1] / 8) * 8; const img = new ImageData(320, 320);
    const hs = new Float32Array(321 * 321); for (let j = 0; j <= 320; j++) for (let i = 0; i <= 320; i++) hs[j * 321 + i] = w.surfaceAt(cx - span / 2 + i * res, cy + span / 2 - j * res);
    for (let j = 0; j < 320; j++) for (let i = 0; i < 320; i++) { const x = cx - span / 2 + i * res, y = cy + span / 2 - j * res; const m = w.matAt(x, y); const base = MATCOL[m] || MATCOL[0];
      const sh = clamp(.82 + (hs[j * 321 + i + 1] - hs[j * 321 + i]) * -6 + (hs[(j + 1) * 321 + i] - hs[j * 321 + i]) * 6, .45, 1.25); const k = 4 * (j * 320 + i);
      img.data[k] = Math.min(255, base[0] * 255 * sh); img.data[k + 1] = Math.min(255, base[1] * 255 * sh); img.data[k + 2] = Math.min(255, base[2] * 255 * sh); img.data[k + 3] = 255 }
    const cv = document.createElement('canvas'); cv.width = cv.height = 320; const cg = cv.getContext('2d'); cg.putImageData(img, 0, 0);
    cg.fillStyle = 'rgba(30,30,30,.85)';
    for (const C of w.cellsNear(cx, cy, span * .75)) for (const o of w.solidsOf(C)) { const px = (o.x - cx + span / 2) / res, py = (cy + span / 2 - o.y) / res; if (px < -20 || py < -20 || px > 340 || py > 340) continue;
      cg.save(); cg.translate(px, py); cg.rotate(-(o.rot || 0)); if (o.k === 'box') cg.fillRect(-o.hx / res, -o.hy / res, 2 * o.hx / res, 2 * o.hy / res); else { cg.beginPath(); cg.arc(0, 0, Math.max(1, o.r / res), 0, 7); cg.fill() } cg.restore() }
    mc = mapCache.world = { cx, cy, cv };
  }
  const toPx = (x, y) => [(x - mc.cx + span / 2) / res, (mc.cy + span / 2 - y) / res];
  g.drawImage(mc.cv, 0, 0);
  // Ground never walked stays in shadow.
  g.fillStyle = 'rgba(14,14,14,.5)'; const tile = 4 / res;
  for (let gx = Math.floor((mc.cx - span / 2) / 4); gx <= Math.floor((mc.cx + span / 2) / 4); gx++) for (let gy = Math.floor((mc.cy - span / 2) / 4); gy <= Math.floor((mc.cy + span / 2) / 4); gy++) {
    if (W.visited.has(gx + ',' + gy)) continue; const [px, py] = toPx(gx * 4, gy * 4 + 4); g.fillRect(px, py, tile + .5, tile + .5) }
  $('mapTitle').textContent = `${envName(w.kind)} · ${placeName(P)}`;
  const q = QUESTS[W.q]; const goal = questGoal(q), qsite = q && q.at ? tourPlace(q.at) : null;
  const sites = []; for (const k of ['base', 'slope', 'stairs', 'steep', 'court', 'guard']) sites.push(w.tour[k]); for (const s of W.found.values()) if (!sites.includes(s)) sites.push(s);
  sites.forEach(s => { const [px, py] = toPx(s.cx, s.cy); if (px < -8 || py < -8 || px > 328 || py > 328) return;
    g.beginPath(); g.rect(px - 5, py - 5, 10, 10); g.fillStyle = s === qsite ? css('--red') : W.found.has(s.grid) ? '#fff' : '#bdbdbd'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#111'; g.stroke() });
  if (goal) { const [px, py] = toPx(goal[0], goal[1]); g.beginPath(); g.arc(px, py, 7, 0, 7); g.lineWidth = 2.5; g.strokeStyle = css('--red'); g.stroke() }
  robots.forEach(r => { const T = tel(r.id), Q = St.toWorld(T[9], T[10]); drawArrow(g, ...toPx(Q[0], Q[1]), yawOf(T), r === robots[0] ? css('--red') : css('--s-ppo')) });
  g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(8, 300, 60, 12); g.fillStyle = '#111'; g.fillRect(12, 305, 20 / res, 3); g.font = '10px DM Mono, monospace'; g.fillText('20 m', 14 + 20 / res, 310);
  if (!full) return;
  const list = $('mapList'); list.innerHTML = '';
  const h = document.createElement('span'); h.className = 'muted'; h.textContent = t('map.found', { n: W.found.size }); list.append(h);
  sites.slice(0, 24).forEach(s => { const b = document.createElement('button'); const d = Math.round(Math.hypot(s.cx - P[0], s.cy - P[1])); b.setAttribute('aria-pressed', s === qsite);
    b.innerHTML = `<b>${siteName(s)}${s === qsite ? t('map.tour') : ''}</b><span>${s.grid} · ${d} m</span>`; b.onclick = () => carry(s.lm.foot || [s.cx, s.cy], s.yaw || 0); list.append(b) });
  c.onclick = e => { const r = c.getBoundingClientRect(); const mx = (e.clientX - r.left) / r.width * 320, my = (e.clientY - r.top) / r.height * 320; let best = null, bd = 1e9;
    sites.forEach(s => { const [px, py] = toPx(s.cx, s.cy); const d = (px - mx) ** 2 + (py - my) ** 2; if (d < bd) { bd = d; best = s } }); if (best && bd < 900) carry(best.lm.foot || [best.cx, best.cy], best.yaw || 0) };
}

/* ================= journal and the world panel ================= */
function fillJournal() { const el = $('journal'); const order = QUESTS.map(q => q.page);
  el.innerHTML = `<span class="muted">${t('journal.count', { n: W.pages.length, m: order.length })}</span>` + order.map(k => { const got = W.pages.includes(k);
    return `<article><b>${got ? t('page.' + k + '.t') : t('journal.unwritten')}</b><p${got ? '' : ' class="locked"'}>${got ? t('page.' + k + '.p', { cost: costText() }) : t('journal.locked')}</p></article>` }).join('') }
function costText() { const c = W.cost; const f = k => c[k] ? fmt(c[k] / 1000, 2) + ' ms' : t('cost.none'); return t('cost.text', { a: f('shac'), b: f('mpc') }) }
const WP = [['wRelief', 'relief', v => fmt(+v, 1) + '×'], ['wRough', 'rough', v => fmt(+v, 1) + '×'], ['wClutter', 'clutter', v => fmt(+v, 1) + '×'], ['wRiser', 'riser', v => Math.round(v * 100) + ' cm'], ['wSteep', 'steep', v => v + '°']];
let envSel = null;
function fillWorldPanel() { envSel = envSel || W.params.env; const E = $('envs'); E.innerHTML = '';
  for (const k of Object.keys(FiaWorld.ENVS)) { const b = document.createElement('button'); b.setAttribute('aria-pressed', k === envSel); b.innerHTML = `<b>${envName(k)}</b><span>${t('env.' + k + '.blurb')}</span>`; b.onclick = () => { envSel = k; E.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)) }; E.append(b) }
  if (!$('wSeed').value) $('wSeed').value = W.params.seed;
  for (const [id, k, f] of WP) { if ($(id).dataset.set !== '1') { $(id).value = W.params[k]; $(id).dataset.set = '1' } $('o' + id.slice(1)).textContent = f($(id).value); $(id).oninput = () => { $('o' + id.slice(1)).textContent = f($(id).value); worldWarn() } } worldWarn() }
function readWorldPanel() { const p = { env: envSel || 'valley', seed: Math.max(1, Math.round(+$('wSeed').value || 1)) }; for (const [id, k] of WP) p[k] = +$(id).value; return p }
function worldWarn() { const p = readWorldPanel(), T = FiaWorld.TRAINED, w = []; if (p.steep > T.steep) w.push(t('world.w.steep', { v: p.steep })); if (p.riser > T.riser + 1e-9) w.push(t(p.riser > .125 ? 'world.w.riserHigh' : 'world.w.riser', { v: Math.round(p.riser * 100) })); if (.06 * p.rough > T.block + 1e-9) w.push(t('world.w.rough'));
  if (p.riser > .085 && p.riser <= T.riser + 1e-9) w.push(t('world.w.stub'));
  $('wWarn').textContent = w.join(' '); $('wWarn').hidden = !w.length }
$('wDice').onclick = () => { $('wSeed').value = 1 + Math.floor(Math.random() * 99999) };
$('wReset').onclick = () => { const d = FiaWorld.DEFAULTS; $('wSeed').value = d.seed; for (const [id, k] of WP) $(id).value = d[k]; fillWorldPanel() };
$('wGo').onclick = async () => { W.params = readWorldPanel(); saveW(); closePanels(); await makeWorld(W.params); await carry(W.world.tour.spawn, 0); renderQuest() };
