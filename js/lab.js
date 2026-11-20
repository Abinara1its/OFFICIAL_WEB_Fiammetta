'use strict';
// The project page, part 4 of 4: the lab. Each topic is a live experiment on the robot's own
// controller: parameters are changed through the stack's configuration path (fia_param), tests are
// run on the simulator, and what is drawn is what the controller and the simulator report.

const LAB = { k: store.get('labk', 'cp'), trial: null, stopRows: [], pushRows: [], joint: 2, params: {}, defaults: {}, drill: null, drillRows: [], episode: null, epBrain: 'shac', how: 'stop',
  gt: { th: [-1.2, -1.0], N: 16, sig: .3, cliff: true, seed: 1 } };
const JN = ['FL hip', 'FL thigh', 'FL knee', 'FR hip', 'FR thigh', 'FR knee', 'RL hip', 'RL thigh', 'RL knee', 'RR hip', 'RR thigh', 'RR knee'];
const LEGS = ['FL', 'FR', 'RL', 'RR'];
const MASS = 26.4;
const key = (c, k, dash) => `<span>${keySw(dash ? 'dash' : c)}${t(k)}</span>`;
const kv = (pairs) => pairs.map(([a, b]) => `<span class="kv"><span>${a}</span><em>${b}</em></span>`).join('');
const kvT = (k, vals) => kv(t(k).split('|').map((a, i) => [a, vals[i]]));

/* ---- tunable parameters: id in fia_param, label, range, log scale, decimals, unit ---- */
const P = {
  mpc: [[0, 'N', 5, 40, 1, 0, 0], [1, 'Δt', .01, .05, .005, 0, 3, ' s'], [2, 'q<sub>θ</sub>', .05, 10, 0, 1, 2], [3, 'q<sub>p</sub>', .05, 10, 0, 1, 2], [4, 'q<sub>ω</sub>', .05, 10, 0, 1, 2], [5, 'q<sub>v</sub>', .05, 10, 0, 1, 2], [6, 'r<sub>f</sub>', 1e-6, 1e-3, 0, 1, 6]],
  wbic: [[10, 'K<sub>p,R</sub>', 0, 400, 5, 0, 0], [11, 'K<sub>d,R</sub>', 0, 40, .5, 0, 1], [12, 'K<sub>p,x</sub>', 0, 400, 5, 0, 0], [13, 'K<sub>d,x</sub>', 0, 40, .5, 0, 1], [14, 'K<sub>p,sw</sub>', 0, 1000, 10, 0, 0], [16, 'μ', .15, 1, .05, 0, 2], [17, 'Q<sub>f</sub>', 1, 1000, 0, 1, 0]],
  bal: [[20, 'K<sub>p,z</sub>', 0, 1000, 10, 0, 0], [21, 'K<sub>p,xy</sub>', 0, 300, 5, 0, 0], [22, 'K<sub>v</sub>', 0, 100, 1, 0, 0], [23, 'K<sub>R</sub>', 0, 500, 5, 0, 0], [24, 'K<sub>ω</sub>', 0, 60, 1, 0, 0], [25, 'μ', .15, 1, .05, 0, 2]],
  gait: [[31, 'T', .25, .6, .01, 0, 2, ' s'], [32, 'β', .4, .8, .01, 0, 2], [30, 'h<sub>sw</sub>', .05, .2, .01, 0, 2, ' m']],
};
const MPC_PRESETS = { before: { 0: 15, 1: .02, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1e-4 }, tuned: { 0: 20, 1: .025, 2: .8179, 3: .4393, 4: .2536, 5: 2.686, 6: 1.2688e-5 } };
function readParam(id) { const r = robots[0]; return r && r.ready ? r.params[id] : PCACHE[id] ?? NaN }
function labApplyParams() { for (const r of robots) for (const [id, v] of Object.entries(LAB.params)) { r.params[id] = v; SIM.param(r.id, +id, v, simGen) } }
function paramUI(el, list, presets) {
  const toS = (p, v) => p[5] ? Math.round(Math.log(v / p[2]) / Math.log(p[3] / p[2]) * 1000) : v, fromS = (p, s) => p[5] ? p[2] * Math.pow(p[3] / p[2], s / 1000) : +s;
  const show = (p, v) => (p[5] && v < .01 ? v.toExponential(1) : fmt(v, p[6])) + (p[7] || '');
  el.innerHTML = `<span class="slot">${t('lab.tune.k')}</span>` + list.map(p => `<div class="prow"><label for="pp${p[0]}">${p[1]}</label><input id="pp${p[0]}" type="range" min="${p[5] ? 0 : p[2]}" max="${p[5] ? 1000 : p[3]}" step="${p[5] ? 1 : p[4]}"><output id="po${p[0]}"></output></div>`).join('') +
    `<div class="acts"><span class="muted" style="font-size:.74rem">${t('lab.tune.preset')}</span>${(presets || []).map(([k]) => `<button class="sbtn" data-pre="${k}">${t(k)}</button>`).join('')}<button class="sbtn" data-pre="defaults">${t('lab.tune.reset')}</button></div>`;
  const sync = () => list.forEach(p => { const v = LAB.params[p[0]] ?? LAB.defaults[p[0]] ?? readParam(p[0]); $('pp' + p[0]).value = toS(p, v); $('po' + p[0]).textContent = show(p, v) });
  list.forEach(p => { if (LAB.defaults[p[0]] === undefined) LAB.defaults[p[0]] = readParam(p[0]);
    $('pp' + p[0]).oninput = e => { const v = fromS(p, e.target.value); LAB.params[p[0]] = p[6] === 0 ? Math.round(v) : v; $('po' + p[0]).textContent = show(p, LAB.params[p[0]]); labApplyParams() } });
  el.querySelectorAll('[data-pre]').forEach(b => b.onclick = () => { const k = b.dataset.pre;
    const vals = k === 'defaults' ? Object.fromEntries(list.map(p => [p[0], LAB.defaults[p[0]]])) : (presets.find(x => x[0] === k) || [])[1];
    for (const [id, v] of Object.entries(vals)) LAB.params[id] = v; labApplyParams(); sync() });
  sync();
}
// What differs from the defaults, for a row of the drill table.
function paramSummary() { const all = Object.values(P).flat(); const ch = Object.entries(LAB.params).filter(([id, v]) => Math.abs(v - (LAB.defaults[id] ?? v)) > 1e-12);
  return ch.length ? ch.map(([id, v]) => { const p = all.find(q => q[0] === +id); return `${p[1]} ${p[5] && v < .01 ? v.toExponential(1) : fmt(v, p[6])}` }).join(', ') : t('lab.drill.default') }

/* ---- the tuning drill: the same 12 s of commands from the same start ---- */
const DRILL = [[3, .6, 0, 0], [3, .6, 0, .8], [3, 0, .3, 0], [3, -.3, 0, 0]];
function drillUI(el) { el.innerHTML = `<span class="slot">${t('lab.drill.k')}</span><p class="src">${t('lab.drill.p')}</p><div class="acts"><button class="sbtn hot" id="drillGo">${t('lab.drill.run')}</button><span class="muted" id="drillMsg" style="font-size:.74rem"></span></div>
  <table id="drillT"><thead><tr>${t('lab.drill.cols')}</tr></thead><tbody></tbody></table>`; $('drillGo').onclick = labDrill; drillRows() }
function drillRows() { const b = document.querySelector('#drillT tbody'); if (!b) return; const rows = LAB.drillRows.filter(r => r.k === LAB.k);
  b.innerHTML = rows.map(r => `<tr><td style="font-family:var(--sans)">${r.label}</td><td>${bn(r.brain)}</td><td>${r.fell ? t('lab.drill.fell') : fmt(r.vel, 3)}</td><td>${r.fell ? '' : fmt(r.yaw, 3)}</td><td>${fmt(r.us / 1000, 2)} ms</td></tr>`).join('') || `<tr><td colspan="5" class="muted">${t('lab.drill.none')}</td></tr>` }
function labDrill() { if (!robots.length) return; LAB.drill = { phase: 'wait', label: paramSummary(), acc: {} }; labStart(true, true); setPosture(2); setCmd(0, 0, 0, true) }
// Called every frame before the step: the drill's and the tests' command schedules.
function labDrive() { const d = LAB.drill; if (!d || d.phase !== 'run' || !robots.length) return; const tm = tel(robots[0].id)[0] - d.t0;
  if (tm > 12) { for (const r of robots) { const a = d.acc[r.id]; if (!a) continue; LAB.drillRows.unshift({ k: LAB.k, label: d.label, brain: r.brain, vel: Math.sqrt(a.se / Math.max(1, a.n)), yaw: Math.sqrt(a.sw / Math.max(1, a.n)), us: a.us / Math.max(1, a.n), fell: a.fell }) }
    LAB.drillRows = LAB.drillRows.slice(0, 16); LAB.drill = null; setCmd(0, 0, 0, false); drillRows(); return }
  let acc = 0; for (const s of DRILL) { acc += s[0]; if (tm < acc) { if (d.step !== s) { d.step = s; setCmd(s[1], s[2], s[3], true) } break } } }

/* ---- stop and push tests, one record per robot ---- */
function labTrial(v) { if (!robots.length) return; const T = tel(robots[0].id); if (T[1] !== 4 && T[1] !== 5) { banner(t('banner.notYet'), t('banner.waitStand')); return }
  setPosture(2); setCmd(v, 0, 0, true); LAB.trial = { kind: 'stop', phase: 'run', v, how: LAB.how, t0: T[0], per: {}, msg: t('lab.cp.walking', { v: fmt(v, 1) }) } }
function labPush(f) { if (!robots.length) return; const T = tel(robots[0].id); if (T[1] !== 4) { banner(t('banner.notYet'), t('banner.letStand')); return } setPosture(1); setCmd(0, 0, 0, false);
  for (const r of robots) { const Tr = tel(r.id), yaw = yawOf(Tr); SIM.push(r.id, [-Math.sin(yaw) * f, Math.cos(yaw) * f, 0, .1]) }
  LAB.trial = { kind: 'push', f, t0: T[0], per: {}, msg: t('lab.cp.pushed', { f }) } }
function trialSample(r, T) { const L = LAB.trial, tm = T[0], st = T[1], first = r === robots[0]; const p = L.per[r.id] || (L.per[r.id] = { brain: r.brain, s0: r.steps, stepped: false, least: 1 });
  if (L.kind === 'stop') {
    if (first && L.phase === 'run' && tm - L.t0 > 3) { L.phase = 'stop'; L.ts = tm; if (L.how === 'stop') setPosture(1); setCmd(0, 0, 0, false); L.msg = t('lab.cp.stopping') }
    if (L.phase !== 'stop') return;
    if (!p.p0) { p.p0 = [T[9], T[10]]; p.s0 = r.steps }
    if (!p.rest && Math.hypot(T[99], T[100]) < .05 && tm - L.ts > .2) { p.rest = tm; p.restD = Math.hypot(T[9] - p.p0[0], T[10] - p.p0[1]); p.restSteps = r.steps - p.s0 }
    if (st === 4 && !p.stand) p.stand = tm; if (st >= 8) p.fell = true;
    p.done = p.fell || (L.how === 'stop' ? p.stand && p.rest : p.rest && tm - p.rest > .5) || tm - L.ts > 6;
  } else {
    if (st === 5) p.stepped = true; const rb = G.robots.find(x => x.id === r.id); if (rb && rb.last && rb.last.hull.length >= 2) p.least = Math.min(p.least, rb.last.margin);
    if (st >= 9) p.fell = true;
    p.done = p.fell || (tm - L.t0 > .6 && st === 4 && (!p.stepped || tm - L.t0 > 1)) || tm - L.t0 > 5; p.steps = r.steps - p.s0; p.end = st;
  }
  if (robots.every(q => L.per[q.id] && L.per[q.id].done)) {
    for (const q of robots) { const x = L.per[q.id];
      if (L.kind === 'stop') LAB.stopRows.unshift([x.brain, L.v, L.how, x.rest ? x.restSteps : '—', x.rest ? x.restD : null, x.stand ? x.stand - L.ts : null, x.fell]);
      else LAB.pushRows.unshift([x.brain, L.f, x.stepped, x.steps, x.least, x.fell ? 'fell' : x.end === 4 ? 'standing' : 'state.' + x.end]) }
    LAB.stopRows = LAB.stopRows.slice(0, 10); LAB.pushRows = LAB.pushRows.slice(0, 10); if (L.kind === 'stop' && L.how === 'zero') setPosture(2); LAB.trial = null; trialRows() } }
function trialRows() { const b = document.querySelector('#labT tbody'); if (b) b.innerHTML = LAB.stopRows.map(r => `<tr><td>${bn(r[0])}</td><td>${fmt(r[1], 1)} m/s</td><td>${t(r[2] === 'stop' ? 'lab.cp.stopW' : 'lab.cp.zeroW')}</td><td>${r[3]}</td><td>${r[4] === null ? '—' : fmt(r[4], 2) + ' m'}</td><td>${r[6] ? t('lab.cp.fell') : r[5] === null ? '—' : fmt(r[5], 2) + ' s'}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">${t('lab.cp.none')}</td></tr>`;
  const p = document.querySelector('#labPT tbody'); if (p) p.innerHTML = LAB.pushRows.map(r => `<tr><td>${bn(r[0])}</td><td>${r[1]} N</td><td>${t(r[2] ? 'lab.cp.yes' : 'lab.cp.no')}</td><td>${r[3]}</td><td>${Math.round(r[4] * 100)} cm</td><td>${r[5] === 'fell' ? t('lab.cp.fell') : r[5] === 'standing' ? t('lab.cp.standing') : t(r[5]).toLowerCase()}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">${t('lab.cp.none')}</td></tr>` }

/* ---- the single-rigid-body check ---- */
function srbSample(r, T, dt) { const yaw = yawOf(T), c = Math.cos(yaw), s = Math.sin(yaw);
  let fx = 0, fy = 0, fz = 0; for (let l = 0; l < 4; l++) if (T[21 + l] > .5) { fx += T[49 + 3 * l]; fy += T[50 + 3 * l]; fz += T[51 + 3 * l] }
  const v = [T[99], T[100], T[101]];
  if (r.srbPrev && dt > 0) { const pf = r.srbPrev.f; const pred = [pf[0] / MASS, pf[1] / MASS, pf[2] / MASS - 9.81]; const meas = [(v[0] - r.srbPrev.v[0]) / dt, (v[1] - r.srbPrev.v[1]) / dt, (v[2] - r.srbPrev.v[2]) / dt];
    const sm = r.srbSm || (r.srbSm = [0, 0]); sm[0] = .7 * sm[0] + .3 * meas[2]; sm[1] = .7 * sm[1] + .3 * (meas[0] * c + meas[1] * s);
    (r.srb || (r.srb = [])).push([T[0], pred[2], sm[0], pred[0] * c + pred[1] * s, sm[1]]); while (r.srb[0][0] < T[0] - 4) r.srb.shift() }
  r.srbPrev = { f: [fx, fy, fz], v } }

/* ---- a training episode, drawn as the training draws them ---- */
const R_TERMS = [['lin', 1.5], ['yaw', .75], ['ori', 3], ['h', 10], ['vz', .5], ['rp', .15], ['f', .5], ['tau', .05], ['alive', .25]];
function labEpisode() { const u = (a, b) => a + Math.random() * (b - a); const crawl = Math.random() < .5, k = crawl ? .5 : 1;
  const e = { vx: u(-.5, 1) * k, vy: u(-.3, .3) * k, w: u(-1, 1) * k, gait: crawl ? 2 : 1, mu: u(.4, 1), m: u(-1, 3), lat: Math.floor(Math.random() * 5), brain: LAB.epBrain, phase: 'wait', ret: 0, terms: {}, end: null };
  LAB.episode = e; cur.brains = [e.brain]; setGait(e.gait); setPosture(2); setCmd(0, 0, 0, true); start({ latency: e.lat, friction: e.mu, mass: e.m }); renderLab() }
function episodeSample(r, T, dt) { const e = LAB.episode; if (!e || e.end || r !== robots[0]) return; const tm = T[0], st = T[1];
  if (e.phase === 'wait') { if ((st === 4 || st === 5) && tm > 3) { e.phase = 'run'; e.t0 = tm; setCmd(e.vx, e.vy, e.w, true) } return }
  const R = rotOf(T), yaw = yawOf(T), c = Math.cos(yaw), s = Math.sin(yaw), vx = T[6] * c + T[7] * s, vy = -T[6] * s + T[7] * c;
  let ftrack = 0; for (let l = 0; l < 4; l++) if (T[21 + l] > .5) for (let k = 0; k < 3; k++) ftrack += (T[37 + 3 * l + k] - T[49 + 3 * l + k]) ** 2;
  let tau = 0; for (let j = 0; j < 12; j++) tau += (T[61 + j] / 60) ** 2;
  const raw = { lin: Math.exp(-((ramp.v - vx) ** 2 + (ramp.vy - vy) ** 2) / .0625), yaw: Math.exp(-((ramp.w - T[14]) ** 2) / .0625), ori: -(R[2][0] ** 2 + R[2][1] ** 2), h: -((T[93] - .37) ** 2), vz: -(T[8] ** 2), rp: -(T[12] ** 2 + T[13] ** 2), f: -ftrack / (MASS * 9.81) ** 2, tau: -tau, alive: 1 };
  const steps = dt / .02; for (const [k, wgt] of R_TERMS) { const val = wgt * raw[k]; e.terms[k] = val; e.ret += val * steps }
  const tilt = Math.acos(clamp(R[2][2], -1, 1));
  if (T[93] < .18) e.end = 'h'; else if (tilt > 1) e.end = 'a'; else if (tm - e.t0 >= 10) e.end = 't';
  e.time = tm - e.t0; if (e.end) setCmd(0, 0, 0, false) }

/* ---- the gradient toy ---- */
function gtR(th, cliff) { return -((th[0] - .8) ** 2 + .6 * (th[1] - .6) ** 2) - (cliff && th[0] + th[1] > 1.1 ? 1.2 : 0) }
function gtRand(seed) { let s = seed >>> 0 || 1; return () => { s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 | 0; s ^= s >>> 13; return ((s >>> 0) % 1e9) / 1e9 } }
function gtDraw() { const c = $('gtC'); if (!c) return; const g = LAB.gt, dpr = devicePixelRatio, Wd = c.clientWidth * dpr, Ht = c.clientHeight * dpr; if (c.width !== Wd) { c.width = Wd; c.height = Ht }
  const x = c.getContext('2d'), toPx = th => [(th[0] + 2) / 4 * Wd, (2 - th[1]) / 4 * Ht], fromPx = (px, py) => [px / Wd * 4 - 2, 2 - py / Ht * 4];
  const key = Wd + ',' + g.cliff + ',' + lang + document.documentElement.dataset.theme; if (g.imgKey !== key) { const img = x.createImageData(Wd, Ht), a = css('--s-ppo'), ink = [0, 0, 0];
    for (let j = 0; j < Ht; j += 2) for (let i = 0; i < Wd; i += 2) { const v = gtR(fromPx(i, j), g.cliff), q = clamp((v + 4) / 4, 0, 1), band = (Math.floor(v * 4) & 1) ? .9 : 1; const r = 255 - 120 * q * band, gg = 255 - 70 * q * band, b = 255 - 20 * q * band;
      for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) { const k = 4 * ((j + dj) * Wd + i + di); img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255 } }
    g.img = img; g.imgKey = key } x.putImageData(g.img, 0, 0);
  if (g.cliff) { x.strokeStyle = '#111'; x.setLineDash([4 * dpr, 4 * dpr]); x.lineWidth = 1.5 * dpr; x.beginPath(); const a = toPx([-.9, 2]), b = toPx([2, -.9]); x.moveTo(...a); x.lineTo(...b); x.stroke(); x.setLineDash([]) }
  const p = toPx(g.th), sc = Wd / 4 * .35;
  const arrow = (v, col, lw) => { x.strokeStyle = col; x.lineWidth = lw * dpr; x.beginPath(); x.moveTo(...p); x.lineTo(p[0] + v[0] * sc, p[1] - v[1] * sc); x.stroke() };
  // Zeroth-order estimates, each from N perturbed evaluations.
  const rnd = gtRand(g.seed), R0 = gtR(g.th, g.cliff), est = [];
  for (let e = 0; e < 12; e++) { const s = [0, 0]; for (let n = 0; n < g.N; n++) { const u1 = Math.max(1e-9, rnd()), u2 = rnd(), z1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(6.283 * u2), z2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(6.283 * u2);
    const d = gtR([g.th[0] + g.sig * z1, g.th[1] + g.sig * z2], g.cliff) - R0; s[0] += d * z1; s[1] += d * z2 } est.push([s[0] / (g.N * g.sig), s[1] / (g.N * g.sig)]) }
  est.forEach(v => arrow(v, 'rgba(90,90,90,.75)', 1.2));
  // What the zeroth-order estimates converge to: the gradient of R smoothed by the same noise,
  // from a large antithetic sample.
  const tz = [0, 0], M2 = 3000; for (let n = 0; n < M2; n++) { const u1 = Math.max(1e-9, rnd()), u2 = rnd(), z1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(6.283 * u2), z2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(6.283 * u2);
    const d = (gtR([g.th[0] + g.sig * z1, g.th[1] + g.sig * z2], g.cliff) - gtR([g.th[0] - g.sig * z1, g.th[1] - g.sig * z2], g.cliff)) / 2; tz[0] += d * z1 / (M2 * g.sig); tz[1] += d * z2 / (M2 * g.sig) }
  x.setLineDash([5 * dpr, 4 * dpr]); arrow(tz, '#111', 2.4); x.setLineDash([]);
  const tg = [-2 * (g.th[0] - .8), -1.2 * (g.th[1] - .6)]; arrow(tg, css('--red'), 3);
  x.fillStyle = '#111'; x.beginPath(); x.arc(...p, 5 * dpr, 0, 7); x.fill();
  const cosv = (a, b) => (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b) || 1);
  const mean = est.reduce((a, v) => [a[0] + v[0] / 12, a[1] + v[1] / 12], [0, 0]);
  const ang = est.map(v => Math.atan2(v[1], v[0])), ma = Math.atan2(tz[1], tz[0]), spread = Math.sqrt(ang.reduce((a, q) => a + Math.atan2(Math.sin(q - ma), Math.cos(q - ma)) ** 2, 0) / 12) * 57.3;
  $('gtKv').innerHTML = kvT('lab.grad.kv', [fmt(cosv(mean, tz), 2), fmt(spread, 0) + '°', fmt(cosv(tg, tz), 2), g.N + 1]) }

/* ---- the topics ---- */
const LAB_MODULES = [
  { k: 'model', brains: ['shac'], overlays: { coll: true },
    html: () => `<h3>${t('lab.model.h')}</h3><p>${t('lab.model.p1')}</p><p>${t('lab.model.p2')}</p><div class="grid2" id="labQ"></div><p class="src">${t('lab.model.src')}</p>`,
    tick(T) { $('labQ').innerHTML = kv(JN.map((n, j) => [n, fmt(T[108 + j] * 57.2958, 1) + '°'])) } },
  { k: 'act', brains: ['shac'],
    html: () => `<h3>${t('lab.act.h')}</h3><p>${t('lab.act.p1')}</p><div class="eq">τ = K<sub>p</sub>(q* − q) + K<sub>d</sub>(q̇* − q̇) + τ<sub>ff</sub></div><p>${t('lab.act.p2')}</p>
      <div class="pills" id="labJ"></div><canvas class="scope" id="scope"></canvas><div class="legend">${key('--ink', 'lab.legend.measured')}${key('--red', 'lab.legend.ff')}${key('', 'lab.legend.pd', true)}</div><div class="grid2" id="labA"></div>`,
    mount() { const el = $('labJ'); JN.forEach((n, j) => { const b = document.createElement('button'); b.textContent = n; b.setAttribute('aria-pressed', j === LAB.joint); b.onclick = () => { LAB.joint = j; el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)) }; el.append(b) }) },
    tick(T, r) { const j = LAB.joint; scope($('scope'), [[r.tr, s => s[61 + j], css('--ink'), 2], [r.tr, s => s[73 + j], css('--red'), 1.6], [r.tr, s => s[61 + j] - s[73 + j], css('--ink-2'), 1.2, [4, 3]]], { unit: 'N·m', lim: [-60, 60], marks: [20, -20] });
      $('labA').innerHTML = kv([['K<sub>p</sub>', fmt(T[144 + j], 0) + ' N·m/rad'], ['K<sub>d</sub>', fmt(T[156 + j], 1) + ' N·m·s/rad'], ['q', fmt(T[108 + j] * 57.3, 1) + '°'], ['q*', fmt(T[132 + j] * 57.3, 1) + '°'], ['τ', fmt(T[61 + j], 1) + ' N·m'], ['τ<sub>ff</sub>', fmt(T[73 + j], 1) + ' N·m']]) } },
  { k: 'est', brains: ['shac'],
    html: () => `<h3>${t('lab.est.h')}</h3><p>${t('lab.est.p1')}</p><canvas class="scope" id="scope"></canvas>
      <div class="legend">${key('--s-shac', 'lab.legend.true')}${key('--s-ppo', 'lab.legend.est')}${key('', 'lab.legend.cmd', true)}${robots.length > 1 ? key('--s-mpc', 'lab.legend.other') : ''}</div><div class="grid2" id="labE"></div><p class="src">${t('lab.est.src')}</p>`,
    tick(T, r) { const fwd = (s, a) => { const y = Math.atan2(2 * (s[15] * s[18] + s[16] * s[17]), 1 - 2 * (s[17] * s[17] + s[18] * s[18])); return s[a] * Math.cos(y) + s[a + 1] * Math.sin(y) };
      const ser = [[r.tr, s => fwd(s, 6), css('--s-shac'), 2], [r.tr, s => fwd(s, 3), css('--s-ppo'), 1.6], [r.tr, () => cmd.v, css('--ink-2'), 1, [4, 3]]];
      if (robots[1]) ser.push([robots[1].tr, s => fwd(s, 6), css('--s-mpc'), 1.6], [robots[1].tr, s => fwd(s, 3), css('--s-mpc'), 1, [2, 2]]);
      scope($('scope'), ser, { unit: 'm/s', lim: [-.5, 1.2] });
      if (!r.est0) r.est0 = [T[188] - T[9], T[189] - T[10]]; const dr = Math.hypot(T[188] - T[9] - r.est0[0], T[189] - T[10] - r.est0[1]);
      $('labE').innerHTML = kv([0, 1, 2, 3].map(l => [t('lab.est.contact', { l: LEGS[l] }), Math.round(T[184 + l] * 100) + ' %' + (T[25 + l] > .5 ? t('lab.est.due') : '')]).concat([[t('lab.est.drift'), fmt(dr * 100, 0) + ' cm'], [t('lab.est.walked'), fmt(W.odo, 1) + ' m']])) } },
  { k: 'cp', brains: ['shac'], overlays: { cp: true },
    html: () => `<h3>${t('lab.cp.h')}</h3><p>${t('lab.cp.p1')}</p><div class="eq">ξ = c + ċ/ω₀,  ω₀ = √(g/h)</div><p>${t('lab.cp.p2')}</p>
      <div class="legend">${key('--ok', 'lab.legend.inside')}${key('--red', 'lab.legend.outside')}${key('--ink', 'lab.legend.poly')}</div><div class="grid2" id="labC"></div>
      <span class="slot">${t('lab.cp.stop')}</span>
      <div class="acts"><span class="seg" id="labHow"><button data-how="stop">${t('lab.cp.how.stop')}</button><button data-how="zero">${t('lab.cp.how.zero')}</button></span></div>
      <div class="acts" id="labV"></div>
      <table id="labT"><thead><tr>${t('lab.cp.stopCols')}</tr></thead><tbody></tbody></table>
      <span class="slot">${t('lab.cp.push')}</span><div class="acts" id="labP"></div>
      <table id="labPT"><thead><tr>${t('lab.cp.pushCols')}</tr></thead><tbody></tbody></table>
      <div id="labG"></div><p class="src">${t('lab.cp.src')}</p>`,
    mount() { const H = $('labHow'); const mark = () => H.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.how === LAB.how)); H.querySelectorAll('button').forEach(b => b.onclick = () => { LAB.how = b.dataset.how; mark() }); mark();
      [.4, .6, .8, 1.0].forEach(v => { const b = document.createElement('button'); b.className = 'sbtn'; b.textContent = t('lab.cp.walkStop', { v: fmt(v, 1) }); b.onclick = () => labTrial(v); $('labV').append(b) });
      [150, 300, 450].forEach(f => { const b = document.createElement('button'); b.className = 'sbtn'; b.textContent = t('lab.cp.pushBtn', { f }); b.onclick = () => labPush(f); $('labP').append(b) });
      paramUI($('labG'), P.gait); $('labG').querySelector('.slot').textContent = t('lab.cp.gait'); trialRows() },
    tick(T) { const k = overlays.last; $('labC').innerHTML = kvT('lab.cp.kv', [k ? fmt(k.margin * 100, 1) + ' cm' : '—', fmt(T[102] * 100, 1) + ' cm', fmt(T[103] * 100, 1) + ' cm', fmt(T[104], 2) + ' m/s', T[106].toFixed(0), t(T[105] > .5 ? 'lab.cp.yes' : 'lab.cp.no')]) + (LAB.trial ? kv([[t('lab.cp.test'), LAB.trial.msg || '']]) : '') } },
  { k: 'bal', brains: ['rules'], fixed: true, overlays: { cones: true },
    html: () => `<h3>${t('lab.bal.h')}</h3><p>${t('lab.bal.p1')}</p><div class="eq">F = m[K<sub>v</sub>(v<sub>des</sub> − v) + K<sub>p</sub>(p<sub>des</sub> − p) − g]<br>T = I<sub>w</sub>[K<sub>R</sub> e<sub>R</sub> + K<sub>ω</sub>(ω<sub>des</sub> − ω)]</div>
      <div class="eq">min Σ ‖f<sub>i</sub>‖²/w<sub>i</sub>  s.t.  Σ f<sub>i</sub> = F,  Σ (p<sub>i</sub> − c) × f<sub>i</sub> = T</div><p>${t('lab.bal.p2')}</p><div id="labPar"></div><div id="labDr"></div>`,
    mount() { paramUI($('labPar'), P.bal); drillUI($('labDr')) } },
  { k: 'wbic', brains: ['shac'], overlays: { cones: true },
    html: () => `<h3>${t('lab.wbic.h')}</h3><p>${t('lab.wbic.p1')}</p><ol style="margin:0;padding-left:1.2em"><li>${t('lab.wbic.l1')}</li><li>${t('lab.wbic.l2')}</li><li>${t('lab.wbic.l3')}</li><li>${t('lab.wbic.l4')}</li></ol>
      <div class="eq">τ = S<sub>j</sub>(M q̈ + h − J<sub>c</sub><sup>T</sup> f)</div><p>${t('lab.wbic.p2')}</p>
      <div id="labPar"></div><div class="legend">${key('--ink', 'lab.legend.req')}${key('--red', 'lab.legend.proj')}</div><div id="labW"></div><div id="labDr"></div><p class="src">${t('lab.wbic.src')}</p>`,
    mount() { paramUI($('labPar'), P.wbic); drillUI($('labDr')) },
    tick(T) { const fn = (b, l) => Math.hypot(T[b + 3 * l], T[b + 3 * l + 1], T[b + 3 * l + 2]); const R = rotOf(T);
      $('labW').innerHTML = `<table><thead><tr>${t('lab.wbic.cols')}</tr></thead><tbody>${[0, 1, 2, 3].map(l => `<tr><td>${LEGS[l]}</td><td>${T[21 + l] > .5 ? fmt(fn(37, l), 0) + ' N' : t('lab.wbic.swing')}</td><td>${T[21 + l] > .5 ? fmt(fn(49, l), 0) + ' N' : ''}</td><td>${T[29 + l] > .5 ? t('lab.wbic.yes') : ''}</td><td>${Math.round(T[168 + l] * 100)} %</td></tr>`).join('')}</tbody></table>
        <div class="grid2" style="margin-top:8px">${kvT('lab.wbic.kv', [fmt(Math.atan2(R[2][1], R[2][2]) * 57.3, 1) + '°, ' + fmt(-Math.asin(clamp(R[2][0], -1, 1)) * 57.3, 1) + '°', fmt(T[93], 3) + ' m', fmt(Math.hypot(T[179], T[180], T[181]), 1) + ' rad/s²', fmt(Math.hypot(T[176], T[177], T[178]), 2) + ' m/s²'])}</div>` } },
  { k: 'mpc', brains: ['mpc'], fixed: true,
    html: () => `<h3>${t('lab.mpc.h')}</h3><p>${t('lab.mpc.p1')}</p><div class="eq">min Σ<sub>k</sub> ‖x<sub>k</sub> − x<sub>k</sub><sup>ref</sup>‖²<sub>Q</sub> + r<sub>f</sub>‖u<sub>k</sub>‖²  s.t.  x<sub>k+1</sub> = A x<sub>k</sub> + B<sub>k</sub> u<sub>k</sub>,  u<sub>k</sub> ∈ cones</div><p>${t('lab.mpc.p2')}</p>
      <div id="labPar"></div><div class="grid2" id="labM"></div><div id="labDr"></div>`,
    mount() { paramUI($('labPar'), P.mpc, [['lab.mpc.before', MPC_PRESETS.before], ['lab.mpc.tuned', MPC_PRESETS.tuned]]); drillUI($('labDr')) },
    tick(T, r) { const us = r.tr.slice(-120).map(s => s[85]); const mean = us.reduce((a, b) => a + b, 0) / Math.max(1, us.length), peak = Math.max(0, ...us);
      $('labM').innerHTML = kv([[t('lab.kv.cycle'), fmt(mean / 1000, 2) + ' ms'], [t('lab.kv.peak'), fmt(peak / 1000, 2) + ' ms'], [t('lab.kv.budget'), us.length ? Math.round(us.filter(v => v > 2000).length / us.length * 100) + ' %' : '—']]) } },
  { k: 'pol', brains: ['shac'],
    html: () => `<h3>${t('lab.pol.h')}</h3><p>${t('lab.pol.p1')}</p><div class="eq">f<sub>n</sub> = m g s<sub>i</sub>(1 + a<sub>n</sub>)<br>f<sub>t</sub> = f<sub>n</sub>(r<sub>v</sub> + μ̂ a<sub>t</sub>)</div>
      <div class="arch"><span>140</span><i>→</i><span>256</span><i>→</i><span>256</span><i>→</i><span>128</span><i>→</i><span class="out">12</span><i>ELU, 50 Hz</i></div>
      <table><thead><tr><th>${t('lab.pol.in')}</th><th></th></tr></thead><tbody>${[[3, 'lab.pol.g1'], [90, 'lab.pol.g2'], [19, 'lab.pol.g3'], [8, 'lab.pol.g4'], [12, 'lab.pol.g5'], [12, 'lab.pol.g6']].map(([n, k]) => `<tr><td style="font-family:var(--sans)">${t(k)}</td><td>${n}</td></tr>`).join('')}</tbody></table>
      <p>${t('lab.pol.p2')}</p><span class="slot">${t('lab.pol.out')}</span><div id="labPo"></div>`,
    tick(T) { $('labPo').innerHTML = `<table><thead><tr>${t('lab.pol.cols')}</tr></thead><tbody>${[0, 1, 2, 3].map(l => `<tr><td>${LEGS[l]}</td><td>${T[21 + l] > .5 ? fmt(T[39 + 3 * l], 0) + ' N' : '—'}</td><td>${T[21 + l] > .5 ? fmt(Math.hypot(T[37 + 3 * l], T[38 + 3 * l]), 0) + ' N' : ''}</td></tr>`).join('')}</tbody></table>` } },
  { k: 'srb', brains: ['shac'],
    html: () => `<h3>${t('lab.srb.h')}</h3><p>${t('lab.srb.p1')}</p><div class="eq">m v̇ = Σ f<sub>i</sub> + m g<br>d(Iω)/dt = Σ (p<sub>i</sub> − c) × f<sub>i</sub></div><div class="eq">x̂ = sg(x<sub>sim</sub>) + α (x<sub>srb</sub> − sg(x<sub>srb</sub>))</div><p>${t('lab.srb.p2')}</p>
      <canvas class="scope" id="scope"></canvas><canvas class="scope" id="scope2"></canvas><div class="legend">${key('--red', 'lab.legend.pred')}${key('--ink', 'lab.legend.meas')}</div><div class="grid2" id="labS"></div>`,
    tick(T, r) { const d = r.srb || []; scope($('scope'), [[d, s => s[1], css('--red'), 1.6], [d, s => s[2], css('--ink'), 1.6]], { unit: 'm/s² ↑', lim: [-8, 8] }); scope($('scope2'), [[d, s => s[3], css('--red'), 1.6], [d, s => s[4], css('--ink'), 1.6]], { unit: 'm/s² →', lim: [-6, 6] });
      const rms = i => Math.sqrt(d.reduce((a, s) => a + (s[i] - s[i + 1]) ** 2, 0) / Math.max(1, d.length)); $('labS').innerHTML = kvT('lab.srb.kv', [fmt(rms(1), 2) + ' m/s²', fmt(rms(3), 2) + ' m/s²']) } },
  { k: 'grad', brains: ['shac'],
    html: () => `<h3>${t('lab.grad.h')}</h3><p>${t('lab.grad.p1')}</p><div class="eq">ĝ<sub>0</sub> = 1/(Nσ) Σ<sub>i</sub> [R(θ + σε<sub>i</sub>) − R(θ)] ε<sub>i</sub>      ĝ<sub>1</sub> = ∇R̃(θ)</div>
      <canvas id="gtC" style="width:100%;aspect-ratio:1;border:1px solid var(--rule);border-radius:8px;touch-action:none;cursor:grab"></canvas><div class="legend">${key('--red', 'lab.grad.leg.fo')}${key('', 'lab.grad.leg.target', true)}<span><i class="key" style="background:#777"></i>${t('lab.grad.leg.zo')}</span></div><p class="src">${t('lab.grad.drag')}</p>
      <div class="prow"><label>${t('lab.grad.n.l')}</label><input id="gtN" type="range" min="0" max="8" step="1"><output id="gtNo"></output></div>
      <div class="prow"><label>${t('lab.grad.s.l')}</label><input id="gtS" type="range" min=".05" max=".8" step=".05"><output id="gtSo"></output></div>
      <div class="acts"><button class="sbtn" id="gtCl" aria-pressed="${LAB.gt.cliff}">${t('lab.grad.cliff')}</button><button class="sbtn" id="gtRe">${t('lab.grad.resample')}</button></div><div class="grid2" id="gtKv"></div>`,
    mount() { const g = LAB.gt; $('gtN').value = Math.round(Math.log2(g.N)); $('gtS').value = g.sig; const out = () => { $('gtNo').textContent = g.N; $('gtSo').textContent = fmt(g.sig, 2); gtDraw() };
      $('gtN').oninput = e => { g.N = 2 ** +e.target.value; out() }; $('gtS').oninput = e => { g.sig = +e.target.value; out() };
      $('gtCl').onclick = () => { g.cliff = !g.cliff; $('gtCl').setAttribute('aria-pressed', g.cliff); gtDraw() }; $('gtRe').onclick = () => { g.seed++; gtDraw() };
      const c = $('gtC'); let drag = false; const mv = e => { const r = c.getBoundingClientRect(); g.th = [clamp((e.clientX - r.left) / r.width * 4 - 2, -1.9, 1.9), clamp(2 - (e.clientY - r.top) / r.height * 4, -1.9, 1.9)]; gtDraw() };
      c.addEventListener('pointerdown', e => { drag = true; c.setPointerCapture(e.pointerId); mv(e) }); c.addEventListener('pointermove', e => { if (drag) mv(e) }); c.addEventListener('pointerup', () => drag = false); requestAnimationFrame(out) } },
  { k: 'train', brains: ['shac'],
    html: () => { const e = LAB.episode; return `<h3>${t('lab.train.h')}</h3><table><thead><tr>${t('lab.train.cols')}</tr></thead><tbody>${t('lab.train.rows').split('\n').map(r => '<tr>' + r.split('|').map((c, i) => `<td style="text-align:left;font-family:${i ? 'var(--mono)' : 'var(--sans)'}">${c}</td>`).join('') + '</tr>').join('')}</tbody></table>
      <p>${t('lab.train.p1')}</p><div class="acts"><span class="seg" id="epB">${['shac', 'ppo', 'rules'].map(b => `<button data-b="${b}" aria-pressed="${LAB.epBrain === b}">${bn(b)}</button>`).join('')}</span><button class="sbtn hot" id="epGo">${t('lab.train.draw')}</button></div>
      <p class="src" id="epD">${e ? t('lab.train.ep', { vx: fmt(e.vx, 2), vy: fmt(e.vy, 2), w: fmt(e.w, 2), gait: t(e.gait === 2 ? 'hud.crawl' : 'hud.trot'), mu: fmt(e.mu, 2), m: (e.m >= 0 ? '+' : '') + fmt(e.m, 1), lat: e.lat * 2 }) : ''}</p>
      <div class="grid2" id="epK"></div><table id="epT"><thead><tr>${t('lab.train.cols2')}</tr></thead><tbody></tbody></table><p class="src">${t('lab.train.src')}</p>` },
    mount() { $('epB').querySelectorAll('button').forEach(b => b.onclick = () => { LAB.epBrain = b.dataset.b; $('epB').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)) }); $('epGo').onclick = labEpisode },
    tick() { const e = LAB.episode; if (!e) return; $('epK').innerHTML = kv([[t('lab.train.time'), fmt(e.time || 0, 1) + ' s'], [t('lab.train.ret'), fmt(e.ret, 1)]].concat(e.end ? [[bn(e.brain), t('lab.train.end.' + e.end)]] : []));
      document.querySelector('#epT tbody').innerHTML = R_TERMS.map(([k, w]) => `<tr><td style="text-align:left;font-family:var(--sans)">${t('lab.train.r.' + k)}</td><td>${fmt(w, 2)}</td><td>${e.terms[k] === undefined ? '—' : fmt(e.terms[k], 3)}</td></tr>`).join('') } },
  { k: 'sup', brains: ['shac'],
    html: () => `<h3>${t('lab.sup.h')}</h3><p>${t('lab.sup.p1')}</p><svg class="fsm" id="labFsm" viewBox="0 0 520 200" role="img"></svg><div class="lights" id="labL"></div>
      <div class="acts"><button class="sbtn" id="labS1">${t('hud.shove', { f: 300 })}</button><button class="sbtn hot" id="labS2">${t('hud.shove', { f: 600 })}</button></div><p class="src">${t('lab.sup.src')}</p>`,
    mount() { drawFsm(lastFsm, $('labFsm')); $('labS1').onclick = () => shove(false); $('labS2').onclick = () => shove(true) },
    tick(T) { const g = T[95]; $('labL').innerHTML = GUARDS.map((n, i) => { const on = Math.floor(g / 2 ** i) % 2 === 1; const red = /fault|stage|lost|dead|late|margin_lost/.test(n); return `<span class="${on ? 'on' + (red ? ' red' : '') : ''}">${n}</span>` }).join('') } },
  // The operator's modes (schemas/config.yaml groups stair and slope; values from the robot profile).
  { k: 'modes', brains: ['shac'],
    html: () => `<h3>${t('lab.modes.h')}</h3><p>${t('lab.modes.p1')}</p>
      <table><thead><tr>${t('lab.modes.cols')}</tr></thead><tbody>${[['lab.modes.r1', '0,12 m', '0,23 m'], ['lab.modes.r2', 'lab.modes.level', 'lab.modes.pitched'], ['lab.modes.r3', '—', '0,15 m'], ['lab.modes.r4', '—', '+0,08 m'],
        ['lab.modes.r5', '0,10 rad', '0,25 rad'], ['lab.modes.r6', 'lab.modes.handset', 'lab.modes.learned'], ['lab.modes.r7', 'lab.modes.own', 'lab.modes.stairPol']]
        .map(([k, a, b]) => `<tr><td style="font-family:var(--sans)">${t(k)}</td><td>${a.startsWith('lab.') ? t(a) : fmtN(a)}</td><td>${b.startsWith('lab.') ? t(b) : fmtN(b)}</td></tr>`).join('')}</tbody></table>
      <p>${t('lab.modes.p2')}</p><p>${t('lab.modes.p3')}</p>
      <div class="acts"><span class="seg" id="labMd"><button data-m="stair">${t('hud.stairs')}</button><button data-m="slope">${t('hud.slope')}</button></span></div>
      <div class="grid2" id="labMo"></div>
      <span class="slot">${t('lab.modes.go')}</span><div class="acts" id="labGo"></div>
      <span class="slot">${t('lab.modes.eval')}</span>
      <table><thead><tr>${t('lab.modes.evalCols')}</tr></thead><tbody>${[['10', '0,86–0,94', '—'], ['12', '0,17–0,34', '0,94–0,95'], ['15', '0,00–0,02', '0,53–0,69'], ['18', '—', '0,02–0,08']]
        .map(([h, a, b]) => `<tr><td>${h} cm</td><td>${fmtN(a)}</td><td>${fmtN(b)}</td></tr>`).join('')}</tbody></table><p class="src">${t('lab.modes.src')}</p>`,
    mount() { $('labMd').querySelectorAll('button').forEach(b => b.onclick = () => b.dataset.m === 'stair' ? setStair(!modes.stair) : setSlope(!modes.slope));
      [['stairs10', 'lab.modes.up'], ['stairs10d', 'lab.modes.down'], ['ramp20', 'lab.modes.ramp'], ['flat', 'lab.modes.flat']].forEach(([k, n]) => { const b = document.createElement('button'); b.className = 'sbtn'; b.textContent = t(n);
        b.onclick = () => { const st = modes.stair; cur.spot = { ...SPOTS.find(s => s.k === k) }; spotModes(cur.spot); modes.stair = st; labStart(true, true) }; $('labGo').append(b) }) },
    tick(T) { const bits = T[191], stair = !!(bits & 1), slope = !!(bits & 2);
      $('labMd').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === 'stair' ? modes.stair : modes.slope));
      $('labMo').innerHTML = kv([[t('hud.stairs'), t(stair ? 'lab.modes.inForce' : modes.stair ? 'lab.modes.waiting' : 'lab.modes.off')], [t('hud.slope'), t(slope ? 'lab.modes.inForce' : 'lab.modes.off')],
        [t('lab.modes.r5'), fmt(stair ? .25 : .10, 2) + ' rad'], [t('lab.modes.deficit'), (slope ? 35 : 15) + ' N·m'], [t('lab.modes.r1'), fmt(stair ? .23 : .12, 2) + ' m']]) } },
];
// A decimal comma in the reader's language for the fixed figures above, written with commas.
const fmtN = s => lang === 'id' ? s : s.replace(/(\d),(\d)/g, '$1.$2');
function scope(c, series, o) { if (!c) return; const dpr = devicePixelRatio, w = c.clientWidth * dpr, h = c.clientHeight * dpr; if (!w) return; if (c.width !== w) { c.width = w; c.height = h } const g = c.getContext('2d'); g.clearRect(0, 0, w, h);
  const all = series.flatMap(s => s[0]); if (all.length < 2) return; const t1 = Math.max(...series.map(s => s[0].length ? s[0][s[0].length - 1][0] : 0)), t0 = t1 - 4, pad = 6 * dpr, lo = o.lim[0], hi = o.lim[1];
  const X = tm => pad + (tm - t0) / 4 * (w - 2 * pad), Y = v => h - pad - (clamp(v, lo, hi) - lo) / (hi - lo) * (h - 2 * pad);
  g.strokeStyle = css('--rule'); g.lineWidth = dpr; g.beginPath(); g.moveTo(pad, Y(0)); g.lineTo(w - pad, Y(0)); g.stroke();
  (o.marks || []).forEach(m => { g.setLineDash([2 * dpr, 3 * dpr]); g.beginPath(); g.moveTo(pad, Y(m)); g.lineTo(w - pad, Y(m)); g.stroke(); g.setLineDash([]) });
  for (const [tr, f, col, lw, da] of series) { g.strokeStyle = col; g.lineWidth = lw * dpr; g.setLineDash((da || []).map(d => d * dpr)); g.beginPath(); let first = true; for (const s of tr) { if (s[0] < t0) continue; const xx = X(s[0]), yy = Y(f(s)); if (first) { g.moveTo(xx, yy); first = false } else g.lineTo(xx, yy) } g.stroke() } g.setLineDash([]);
  g.fillStyle = css('--ink-2'); g.font = `${9 * dpr}px DM Mono, monospace`; g.fillText(`${fmt(hi, 0)} ${o.unit}`, pad, pad + 8 * dpr); g.fillText(fmt(lo, 0), pad, h - pad - 2 * dpr); g.fillText('4 s', w - pad - 18 * dpr, pad + 8 * dpr) }

/* ---- entering, switching and running the lab ---- */
function labMod() { return LAB_MODULES.find(m => m.k === LAB.k) || LAB_MODULES[3] }
function labReset() { LAB.trial = null; LAB.drill = null; LAB.episode = null }
const labBusy = () => !!(LAB.trial || LAB.drill || (LAB.episode && !LAB.episode.end));
function enterLab(k) {
  mode = 'lab'; applyMode(); closePanels(); hideToast(); exitPlace(); if (k) LAB.k = k;
  if (!loaded) { afterLoad = () => labStart(true); wake(); return }
  labStart(true);
}
// Starts the topic's controller; keeps a second robot the reader chose unless the topic needs its own.
function labStart(restart, keepSpot) {
  const m = labMod(); if (!keepSpot) { cur.spot = { ...SPOTS[0] }; spotModes(cur.spot) } if (!LAB.drill) LAB.trial = null;
  const brains = LAB.duel || (m.fixed || cur.brains.length !== 2 || mode !== 'lab' ? m.brains : cur.brains); LAB.duel = null;
  if (restart || cur.brains.join() !== brains.join() || mode !== 'lab' || !robots.length) { cur.brains = brains.slice(); cur.hard = false; setShove(); setGait(1); if (!LAB.drill) { setPosture(2); setCmd(0, 0, 0, false) } start() }
  sceneLabel('lab.scene', { n: t('lab.' + m.k + '.n') }); overlays.set(m.overlays || {}); renderLab();
}
function renderLab() { const nav = $('labNav'); const m = labMod();
  nav.innerHTML = ''; LAB_MODULES.forEach(x => { const b = document.createElement('button'); b.textContent = t('lab.' + x.k + '.n'); b.setAttribute('aria-pressed', x.k === m.k);
    b.onclick = () => { if (x.k === LAB.k) return; const reset = Object.keys(LAB.params).length > 0; LAB.params = {}; LAB.k = x.k; store.set('labk', x.k); labReset(); labStart(reset) }; nav.append(b) });
  $('labBody').innerHTML = m.html(); if (m.mount) m.mount() }
$('labMin').onclick = () => { const l = $('lab'); l.classList.toggle('min'); const min = l.classList.contains('min'); $('stage').classList.toggle('labmin', min); $('labMin').textContent = t(min ? 'hud.show' : 'hud.hide'); $('labMin').setAttribute('aria-expanded', !min); setTimeout(viewOffset, 30) };
function labTick() { const m = labMod(); if (!robots.length || !m.tick) return; const r = robots[0]; m.tick(tel(r.id), r);
  const d = LAB.drill, dm = $('drillMsg'); if (dm) dm.textContent = d ? (d.phase === 'wait' ? t('lab.drill.waiting') : t('lab.drill.running', { s: fmt(Math.max(0, tel(r.id)[0] - d.t0), 1) })) : '' }
function labSample(r, T, dt) {
  const d = LAB.drill;
  if (d) { if (d.phase === 'wait' && r === robots[0] && (T[1] === 4 || T[1] === 5) && T[0] > 3) { d.phase = 'run'; d.t0 = T[0]; d.step = null }
    if (d.phase === 'run') { const a = d.acc[r.id] || (d.acc[r.id] = { se: 0, sw: 0, n: 0, us: 0, fell: false }); const yaw = yawOf(T), c = Math.cos(yaw), s = Math.sin(yaw);
      a.se += (T[6] * c + T[7] * s - ramp.v) ** 2 + (-T[6] * s + T[7] * c - ramp.vy) ** 2; a.sw += (T[14] - ramp.w) ** 2; a.us += T[85]; a.n++; if (T[1] >= 8) a.fell = true } }
  if (LAB.trial) trialSample(r, T);
  if (LAB.k === 'srb') srbSample(r, T, dt);
  if (LAB.episode) episodeSample(r, T, dt);
}

/* ================= start-up ================= */
function boot() {
  applyI18n(); setTheme(store.get('theme', 'auto')); drawFigs(); setShove(); setLock(false); showCmd(); padText(); sceneLabel(); showModes();
  if (store.get('qmin', false)) $('quest').classList.add('min');
}
boot();
