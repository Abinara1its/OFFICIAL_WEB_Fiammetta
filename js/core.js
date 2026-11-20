'use strict';
// The project page, part 1 of 4: texts, figures, sessions, driving and the loop. Everything on the
// stage is the robot's controller and MuJoCo compiled to WebAssembly (fia_sim.js), running in worker
// threads (sim.js); these scripts only carry commands in, draw what comes out, and keep score. Texts live in i18n/<lang>.json.

const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const store = { get(k, d) { try { const v = localStorage.getItem('fia.' + k); return v ? JSON.parse(v) : d } catch (e) { return d } }, set(k, v) { try { localStorage.setItem('fia.' + k, JSON.stringify(v)) } catch (e) { } } };
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const LOWMEM = IOS || (navigator.deviceMemory && navigator.deviceMemory <= 4) || Math.min(screen.width, screen.height) < 600;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ================= language ================= */
const LANGS = ['en', 'id'];
let lang = store.get('lang', (navigator.language || '').toLowerCase().startsWith('id') ? 'id' : 'en');
// {mb} in any text is the page's download, compressed, as web/sim/site.sh measured it, and {smb}
// what the stair mode's files add when they are first needed.
function t(k, v) {
  let s = I18N ? ((I18N[lang] && I18N[lang][k]) ?? (I18N.en && I18N.en[k]) ?? k) : k;
  const vars = { mb: SIZE ? fmt(SIZE.page / 1e6, 0) : '?', smb: SIZE && SIZE.stair ? fmt(SIZE.stair / 1e6, 0) : '?', ...v };
  return s.replace(/\{(\w+)\}/g, (m, n) => vars[n] !== undefined ? vars[n] : m);
}
// Numbers in the reader's convention: a decimal comma in Indonesian.
const fmt = (x, d) => { const s = (+x).toFixed(d); return lang === 'id' ? s.replace('.', ',') : s };
const keySw = c => c === 'dash' ? '<i class="key dash"></i>' : `<i class="key" style="background:var(${c})"></i>`;
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => { let v = null; const ks = el.dataset.i18nKeys; if (ks) { v = {}; ks.split(';').forEach(p => { const [n, c] = p.split(':'); v[n] = keySw(c) }) } el.innerHTML = t(el.dataset.i18n, v) });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => el.dataset.i18nAttr.split(';').forEach(p => { const [a, k] = p.split(':'); el.setAttribute(a, t(k)) }));
  document.querySelectorAll('[data-langcode]').forEach(e => e.textContent = lang.toUpperCase());
  document.documentElement.lang = lang;
}
function setLang(l) { lang = l; store.set('lang', l); applyI18n(); refreshTexts() }
document.querySelectorAll('[data-act="lang"]').forEach(b => b.onclick = () => setLang(LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]));
// Everything drawn from code rather than from the markup, redrawn after a change of language.
function refreshTexts() {
  drawFigs(); setShove(); showCmd(); setLock(cmd.lock); sceneLabel(); padText(); showModes();
  if (!$('toast').hidden && toastSpec) toast(...toastSpec);
  if (loaded) { lastStateKey = null; tallyKey = ''; if (mode === 'world') { renderQuest(); renderSheet(true) } if (mode === 'lab') renderLab() }
  [['pBrain', fillBrains], ['pJournal', fillJournal], ['pWorld', fillWorldPanel]].forEach(([p, f]) => { if (!$(p).hidden) f() });
  if (!$('pMap').hidden) { mapCache.world = null; mapDraw(true) }
  $('labMin').textContent = t($('lab').classList.contains('min') ? 'hud.show' : 'hud.hide');
}

/* ================= telemetry (fia_web.cpp) ================= */
const NT = 192;
const STATE_NAMES = ['STARTUP', 'ESTIMATOR_INIT', 'SIT', 'STAND_UP', 'STAND', 'LOCOMOTE', 'STOP', 'SIT_DOWN', 'PROTECT_A', 'PROTECT_B', 'GROUNDED', 'DEGRADED', 'EMERGENCY'];
const STATE_DOT = { 0: 'warn', 1: 'warn', 2: 'warn', 3: 'warn', 4: 'ok', 5: 'ok', 6: 'warn', 7: 'warn', 8: 'warn', 9: 'bad', 10: 'bad', 11: 'warn', 12: 'bad' };
const GUARDS = ['selftest_ok', 'estimator_ready', 'fault_hard', 'fault_soft', 'fault_clear', 'fault_worse', 'fault_sensor', 'fault_actuator', 'cmd_stand_up', 'cmd_locomote', 'cmd_stop', 'cmd_sit', 'cmd_reset', 'cmd_zero', 'stand_pose_ok', 'sit_pose_ok', 'settled', 'stage_a', 'stage_a_clear', 'stage_b', 'margin_lost', 'margin_ok_hold', 'link_late', 'link_dead', 'link_lost'];
const FAULT_LATCH = (1 << GUARDS.indexOf('fault_sensor')) | (1 << GUARDS.indexOf('fault_actuator'));
const yawOf = T => Math.atan2(2 * (T[15] * T[18] + T[16] * T[17]), 1 - 2 * (T[17] * T[17] + T[18] * T[18]));
// Rotation matrix rows of the trunk from its quaternion (w, x, y, z at 15..18).
function rotOf(T) { const w = T[15], x = T[16], y = T[17], z = T[18];
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]] }

/* ================= figures ================= */
const ARMS = [['model', '--s-rules'], ['shac', '--s-shac'], ['ppo_hybrid', '--s-ppo'], ['mpc', '--s-mpc'], ['e2e', '--s-e2e']];
const GROUND = ['all', 'flat', 'slope10', 'slope20', 'rough4', 'rough8', 'stairs5_up', 'stairs5_down', 'stairs10_up', 'stairs10_down'];
const METRIC = [['survival', true], ['lin_vel_rmse', false], ['yaw_rate_rmse', false]];
let gSel = 'all', mSel = 'survival';
function pills(el, list, get, set, label, after) { el.innerHTML = ''; list.forEach(k => { const b = document.createElement('button'); b.textContent = label(k); b.setAttribute('aria-pressed', k === get()); b.onclick = () => { set(k); el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); after() }; el.append(b) }) }
function drawDots() {
  if (!DATA) return;
  pills($('ground'), GROUND, () => gSel, k => gSel = k, k => t('ground.' + k), drawDots); pills($('metric'), METRIC.map(m => m[0]), () => mSel, k => mSel = k, k => t('metric.' + k), drawDots);
  const rows = DATA.arms[gSel][mSel], high = METRIC.find(m => m[0] === mSel)[1], svg = $('dots'); const L = 170, R = 505, top = 34, rh = 40;
  const vals = ARMS.filter(a => rows[a[0]]).map(a => rows[a[0]]); let lo, hi;
  if (high) { lo = Math.max(0, Math.floor((Math.min(...vals.map(v => v[1])) - .03) * 10) / 10); hi = 1 } else { lo = 0; hi = Math.max(...vals.map(v => v[2])) * 1.1 }
  const x = v => L + (v - lo) / (hi - lo) * (R - L); const H = top + vals.length * rh + 28; svg.setAttribute('viewBox', `0 0 520 ${H}`);
  let s = `<text x="${R}" y="14" text-anchor="end" font-size="12" fill="${css('--ink-2')}">${t(high ? 'fig.better' : 'fig.betterLow')}</text>`;
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; s += `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 10}" y2="${H - 22}" stroke="${css('--rule')}"/><text x="${x(v)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="${css('--ink-2')}">${high ? Math.round(v * 100) + '%' : fmt(v, 2)}</text>` }
  let i = 0; for (const a of ARMS) { const v = rows[a[0]]; if (!v) continue; const y = top + i * rh + 8, c = css(a[1]);
    s += `<text x="0" y="${y + 4}" font-size="13" fill="${css('--ink')}">${t('arm.' + a[0])}</text><line x1="${x(v[1])}" x2="${x(v[2])}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity=".45"/><circle cx="${x(v[0])}" cy="${y}" r="6" fill="${c}"/>`; i++ }
  svg.innerHTML = s;
  $('dotsCap').innerHTML = t('fig3.cap', { metric: t('metric.' + mSel), desc: t('metric.' + mSel + '.d'), ground: t('ground.' + gSel).toLowerCase() });
}
function drawEff(svg) { svg = svg || $('eff'); if (!svg) return; const d = [['SHAC', [.172, .172, .106], '--s-shac'], ['PPO', [.811, .811, .759], '--s-ppo']]; const L = 60, R = 505, x = v => L + v / .9 * (R - L); let s = '';
  for (let k = 0; k <= 4; k++) { const v = k * .2; s += `<line x1="${x(v)}" x2="${x(v)}" y1="6" y2="120" stroke="${css('--rule')}"/><text x="${x(v)}" y="138" font-size="11" text-anchor="middle" fill="${css('--ink-2')}">${k ? t('fig.million', { v: fmt(v, 1) }) : '0'}</text>` }
  d.forEach((r, i) => { r[1].forEach((v, j) => { s += `<rect x="${L}" y="${14 + i * 54 + j * 13}" width="${x(v) - L}" height="9" rx="2" fill="${css(r[2])}"/>` }); s += `<text x="0" y="${33 + i * 54}" font-size="13" fill="${css('--ink')}" font-weight="600">${r[0]}</text>` });
  svg.innerHTML = s }
// Self-consistency of the full simulator's force gradient, per terrain and seed.
function drawGrad(svg) { svg = svg || $('grad'); if (!svg || !DATA) return; const terr = ['flat', 'slope10', 'slope20', 'rough8', 'stairs10_up', 'stairs10_down'];
  const L = 120, R = 505, x = v => L + (v + 1) / 2 * (R - L); let s = '';
  for (const v of [-1, -.5, 0, .5, 1]) s += `<line x1="${x(v)}" x2="${x(v)}" y1="8" y2="174" stroke="${css('--rule')}"/><text x="${x(v)}" y="192" text-anchor="middle" font-size="11" fill="${css('--ink-2')}">${fmt(v, v % 1 ? 1 : 0)}</text>`;
  terr.forEach((k, i) => { const y = 20 + i * 27; s += `<text x="0" y="${y + 4}" font-size="12" fill="${css('--ink')}">${t('grad.' + k)}</text>`;
    DATA.grad.filter(g => g[1] === k && g[2] === 'forces').forEach(g => { s += `<circle cx="${x(g[3])}" cy="${y}" r="6" fill="${g[3] > .7 ? css('--s-shac') : css('--ink-2')}" opacity=".9"/>` }) });
  svg.innerHTML = s }
// What it took to obtain each force source: the MPC's tuning search against one training run.
function drawEffort() { const svg = $('effort'); if (!svg) return;
  const L = 200, R = 470; let s = '', y = 0;
  const panel = (title, max, ticks, rows) => { const x = v => L + v / max * (R - L);
    s += `<text x="0" y="${y + 14}" font-size="13" font-weight="700" fill="${css('--ink')}">${t(title)}</text>`; y += 24;
    const y0 = y; rows.forEach(([k, a, b, col, unit]) => { s += `<text x="0" y="${y + 13}" font-size="12.5" fill="${css('--ink')}">${t(k)}</text><rect x="${L}" y="${y + 2}" width="${Math.max(2, x(a) - L)}" height="14" rx="2" fill="${css(col)}"/>`;
      if (b > a) s += `<rect x="${x(a)}" y="${y + 2}" width="${x(b) - x(a)}" height="14" rx="2" fill="${css(col)}" opacity=".4"/>`;
      s += `<text x="${x(b) + 8}" y="${y + 13}" font-size="12" font-weight="600" fill="${css('--ink')}">${a === b ? fmt(a, a < 10 ? 1 : 0) : fmt(a, 2) + '–' + fmt(b, 2)} ${unit}</text>`; y += 26 });
    for (const v of ticks) s += `<line x1="${x(v)}" x2="${x(v)}" y1="${y0 - 2}" y2="${y}" stroke="${css('--rule')}"/><text x="${x(v)}" y="${y + 14}" text-anchor="middle" font-size="11" fill="${css('--ink-2')}">${fmt(v, 0)}</text>`;
    y += 34 };
  panel('fige.title.steps', 7, [0, 1, 2, 3, 4, 5, 6, 7], [['fige.mpc', 6.53, 6.53, '--s-mpc', 'M'], ['fige.shac', 4.096, 4.096, '--s-shac', 'M'], ['fige.mark', .106, .172, '--s-shac', 'M'], ['fige.ppo', 4.096, 4.096, '--s-ppo', 'M']]);
  panel('fige.title.gpu', 20, [0, 5, 10, 15, 20], [['fige.mpc', 19.2, 19.2, '--s-mpc', 'h'], ['fige.shac', 2316 / 3600, 2776 / 3600, '--s-shac', 'h'], ['fige.ppo', 1568 / 3600, 2457 / 3600, '--s-ppo', 'h']]);
  svg.setAttribute('viewBox', `0 0 560 ${y}`); svg.innerHTML = s }
const FSM = [['SIT', 10, 20], ['STAND_UP', 140, 20], ['STAND', 270, 20], ['LOCOMOTE', 400, 20], ['PROTECT', 270, 110], ['GROUNDED', 400, 110], ['EMERGENCY', 140, 110]];
const STATE_FSM = { 2: 'SIT', 3: 'STAND_UP', 4: 'STAND', 5: 'LOCOMOTE', 6: 'STAND', 7: 'SIT', 8: 'PROTECT', 9: 'PROTECT', 10: 'GROUNDED', 11: 'PROTECT', 12: 'EMERGENCY' };
function drawFsm(live, svg) { svg = svg || $('fsm'); if (!svg) return; const W = 110, H = 38; let s = `<defs><marker id="ar${svg.id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="${css('--ink-3')}"/></marker></defs>`;
  const f = k => FSM.find(n => n[0] === k); const mk = `marker-end="url(#ar${svg.id})"`; const h = (a, b) => { const A = f(a), B = f(b); s += `<path d="M${A[1] + W} ${A[2] + H / 2} L${B[1] - 3} ${B[2] + H / 2}" ${mk}/>` };
  h('SIT', 'STAND_UP'); h('STAND_UP', 'STAND'); h('STAND', 'LOCOMOTE');
  s += `<path d="M${f('LOCOMOTE')[1] + 30} ${20 + H} C ${f('LOCOMOTE')[1] + 30} 90, ${f('PROTECT')[1] + 70} 70, ${f('PROTECT')[1] + 70} ${110 - 3}" ${mk}/>`; h('PROTECT', 'GROUNDED');
  s += `<path d="M${f('PROTECT')[1]} ${110 + H / 2} L${f('EMERGENCY')[1] + W + 3} ${110 + H / 2}" ${mk}/>`;
  s += `<text x="10" y="186" font-size="11" fill="${css('--ink-2')}">${t('fsm.note')}</text>`;
  for (const n of FSM) s += `<g class="n ${n[0] === live ? 'live' : ''}"><rect x="${n[1]}" y="${n[2]}" width="${W}" height="${H}" rx="7"/><text x="${n[1] + W / 2}" y="${n[2] + 24}" text-anchor="middle">${t('fsm.' + n[0])}</text></g>`;
  svg.innerHTML = s }
let lastFsm = null;
function drawFigs() { drawDots(); drawEff(); drawGrad(); drawEffort(); drawFsm(lastFsm) }

/* ================= theme ================= */
const THEMES = ['auto', 'light', 'dark'];
function setTheme(th) { if (th === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = th; store.set('theme', th);
  document.querySelectorAll('[data-act="theme"]').forEach(b => b.title = t('ui.theme', { t: t('ui.theme.' + th) })) }
document.querySelectorAll('[data-act="theme"]').forEach(b => b.onclick = () => setTheme(THEMES[(THEMES.indexOf(store.get('theme', 'auto')) + 1) % 3]));
const retheme = () => setTimeout(() => { drawFigs(); themeStage(); if (mode === 'lab') renderLab() }, 60);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
$('copyBib').onclick = async () => { try { await navigator.clipboard.writeText($('bib').textContent); $('copyBib').textContent = t('cite.copied') } catch (e) { const r = document.createRange(); r.selectNodeContents($('bib')); getSelection().removeAllRanges(); getSelection().addRange(r); $('copyBib').textContent = t('cite.selected') } setTimeout(() => $('copyBib').textContent = t('cite.copy'), 2000) };

/* ================= the evaluation terrain (story and lab) ================= */
const tileOf = (x, y) => { const c = Math.floor((x + 32) / 16), r = Math.floor((y + 32) / 16); return c < 0 || c > 3 || r < 0 || r > 3 ? -1 : r * 4 + c };
const tileCenter = i => [-24 + 16 * (i % 4), -24 + 16 * Math.floor(i / 4)];
const SPOTS = [
  { k: 'flat', x: -14, y: -8 }, { k: 'ramp10', x: 3, y: -8, slope: true }, { k: 'ramp20', x: 3, y: 24, slope: true }, { k: 'blocks4', x: -30, y: -8 },
  { k: 'blocks8', x: -30, y: 24 }, { k: 'stairs5', x: 24, y: -24 }, { k: 'stairs10', x: 18, y: -8 }, { k: 'stairs10d', x: 24, y: -8 },
];
const BRAINS = {
  rules: { pol: '', col: '--s-rules' },
  shac: { pol: '/fia/policies/shac_hybrid_s0.ptk', col: '--s-shac' },
  ppo: { pol: '/fia/policies/ppo_hybrid_s0.ptk', col: '--s-ppo' },
  mpc: { pol: '', mpc: 1, col: '--s-mpc' },
};
const bn = k => t('brain.' + k);
const SCENES = {
  intro: { spot: 'flat', brains: ['shac'], v: .5, w: 0, lock: true },
  stand: { spot: 'flat', brains: ['shac'], v: 0, w: 0, posture: 1 },
  push: { spot: 'flat', brains: ['shac'], v: 0, w: 0, posture: 1, hint: 'hint.push' },
  'duel-rules': { spot: 'flat', brains: ['rules', 'shac'], v: .5, w: .8, lock: true },
  'duel-ppo': { spot: 'flat', brains: ['ppo', 'shac'], v: .5, w: .8, lock: true },
  stairs: { spot: 'stairs10', brains: ['shac'], v: .4, w: 0, lock: true },
  'duel-mpc': { spot: 'flat', brains: ['mpc', 'shac'], v: .5, w: .6, lock: true },
  safety: { spot: 'flat', brains: ['shac'], v: 0, w: 0, posture: 1, hint: 'hint.safety', hard: true },
};

/* ================= the tour of the worlds ================= */
// Each step names a tour place (world.tour) and, for a walk, the landmark to reach there.
const QUESTS = [
  { k: 'wake', at: 'base', done: st => st === 4 || st === 5, page: 'eyes' },
  { k: 'walk', at: 'base', goal: 'firstStep', page: 'estimate' },
  { k: 'shove', at: 'base', custom: 'shove', page: 'forces' },
  { k: 'slope', at: 'slope', goal: 'top', brain: 'rules', page: 'rules' },
  { k: 'train', at: 'base', goal: 'workshop', page: 'learning', unlock: ['shac', 'ppo'] },
  { k: 'steep', at: 'steep', goal: 'top', brain: 'shac', page: 'steep' },
  { k: 'stairs', at: 'stairs', goal: 'top', page: 'stairs' },
  { k: 'rival', at: 'court', goal: 'top', brain: 'mpc', page: 'planner', unlock: ['mpc'], unlockFirst: true },
  { k: 'guardian', at: 'guard', custom: 'fall', page: 'guardian' },
  { k: 'floor', at: null, custom: 'end', page: 'floor' },
];
let W = { q: store.get('q', 0), unlocked: store.get('unlocked', ['rules']), pages: store.get('pages', []), falls: store.get('falls', 0),
  params: Object.assign({}, window.FiaWorld ? FiaWorld.DEFAULTS : {}, store.get('wparams', {})),
  brain: 'rules', odo: 0, steps: 0, cost: {}, shoveAt: 0, world: null, found: new Map(), visited: new Set(), rival: null };
const saveW = () => { store.set('q', W.q); store.set('unlocked', W.unlocked); store.set('pages', W.pages); store.set('falls', W.falls); store.set('wparams', W.params) };

/* ================= runtime state ================= */
let G = null, St = null, loaded = false, robots = [], mode = 'story';
const cur = { scene: 'intro', spot: { ...SPOTS[0] }, brains: ['shac'], hard: false, relay: null, label: ['scene.intro'] };
const cmd = { v: 0, vy: 0, w: 0, gait: 1, posture: 2, lock: false }, ramp = { v: 0, vy: 0, w: 0 };
const VMAX = 1.0, VBACK = .4, VYMAX = .5, WMAX = 1.2;
function sceneLabel(key, vars) { if (key) cur.label = [key, vars]; $('cScene').textContent = t(cur.label[0], cur.label[1]) }

/* ================= loading ================= */
// The files of data/manifest.json the page starts with, or those of one group fetched later.
async function fetchData(onp, group) {
  const man = await (await fetch('data/manifest.json')).json(), list = man.files.filter(f => (f.group || null) === (group || null));
  const total = list.reduce((a, f) => a + f.parts.length, 0); let done = 0; const files = [];
  for (const f of list) { const bufs = [];
    for (const p of f.parts) { const r = await fetch('data/' + p); if (!r.ok) throw new Error('HTTP ' + r.status); bufs.push(new Uint8Array(await r.arrayBuffer())); onp(++done / total) }
    files.push({ path: f.path, data: await new Response(new Blob(bufs).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() }) }
  return files;
}
// One simulator thread per robot slot where the device can afford it, one for both otherwise: a
// second thread runs the robots in parallel but holds a second copy of the scene and its sessions
// (about 0.4 GB more).
const THREADS = LOWMEM || (navigator.hardwareConcurrency || 2) < 4 || (navigator.deviceMemory && navigator.deviceMemory < 8) ? 1 : 2;
let afterLoad = null;
async function wake() {
  if (loaded || $('wake').disabled) return; $('wake').disabled = true; $('prog').hidden = false; $('loadmsg').textContent = t('load.start');
  try {
    $('loadmsg').textContent = t('load.download');
    const files = await fetchData(p => $('progbar').style.width = Math.round(p * 100) + '%');
    $('loadmsg').textContent = t('load.assemble');
    await SIM.boot(files, THREADS); initGL(); loaded = true; $('poster').hidden = true; ['tl', 'tr', 'dock', 'strip'].forEach(i => $(i).hidden = false); applyMode();
    if (afterLoad) { const f = afterLoad; afterLoad = null; await f() } else setScene(cur.scene);
    requestAnimationFrame(frame);
  } catch (e) { $('loadmsg').textContent = t('load.fail', { e: e.message }); $('wake').disabled = false; console.error(e) }
}
$('wake').onclick = wake;
// Chapter buttons only set the stage; the page does not scroll.
document.querySelectorAll('[data-scene]').forEach(b => b.onclick = () => { cur.scene = b.dataset.scene; document.querySelectorAll('[data-scene]').forEach(x => x.classList.toggle('on', x === b));
  if (mode !== 'story') leave(true); if (!loaded) { wake(); return } setScene(cur.scene) });
document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const m = b.dataset.open; if (m === 'world') enterWorld(); else if (m === 'lab') enterLab(); else { $('c0').scrollIntoView({ behavior: 'smooth' }); if (!loaded) wake() } });

/* ================= modes ================= */
function applyMode() {
  const full = mode !== 'story', st = $('stage');
  st.classList.toggle('full', full); st.classList.toggle('labmode', mode === 'lab'); document.body.classList.toggle('full', full);
  document.querySelectorAll('[data-only]').forEach(el => el.classList.toggle('mode-off', !el.dataset.only.split(' ').includes(mode)));
  if (loaded) { $('quest').hidden = mode !== 'world'; $('sheet').hidden = mode !== 'world'; $('lab').hidden = mode !== 'lab' }
  if (G) setTimeout(viewOffset, 30);
}
function leave(quiet) {
  const was = mode; mode = 'story'; applyMode(); closePanels(); hideToast(); exitPlace(); clearMarks(); if (G) { wrShow(false); overlays.set({}) }
  cur.hard = false; labReset(); setGait(1); if (!quiet && was !== 'story') setScene('intro');
}
$('bExit').onclick = () => leave(false);

/* ================= sessions ================= */
// The page keeps each session's latest telemetry and poses; the simulator threads own the sessions.
// A session generation is the set of sessions started together; replies from an older one are dropped.
const SES = [], ZT = new Float64Array(NT), ZP = new Float64Array(64 * 12);
let simGen = 0;
const tel = id => SES[id] ? SES[id].T : ZT;
const poses = id => SES[id] ? SES[id].P : ZP;
function retire(slots) { simGen++; batch = null; for (const s of slots) SES[s] = null; SIM.free(slots) }
function freeAll() { retire([0, 1, 2]) }
// opts: latency (physics steps), friction (robot geoms; 0 keeps the model's), mass (kg added to the trunk).
// The session is ready once its thread has started it; until then it stands where it will be set down.
function initSession(slot, brain, x, y, slope, yaw, opts) { const B = BRAINS[brain], o = opts || {};
  const T = new Float64Array(NT); T[9] = x; T[10] = y; T[11] = solidAt(x, y) + .3; T[15] = Math.cos((yaw || 0) / 2); T[18] = Math.sin((yaw || 0) / 2);
  const r = { id: slot, brain, ready: false, T, P: new Float64Array(64 * 12), params: {}, done: null, se: 0, sw: 0, n: 0, us: 0, hist: [], gait: [], fellAt: 0, knee: [], grip: [], air: [0, 0, 0, 0], tr: [], steps: 0 };
  SES[slot] = r;
  SIM.init(slot, ['/fia/scene.mjb', B.pol, B.mpc || 0, x, y, o.latency ?? 2, o.friction || 0, o.mass || 0, 7 + slot, modes.slope ? 1 : 0, yaw || 0], cmd.gait, simGen).then(m => {
    if (SES[slot] !== r) return;
    if (m.rc !== 0) { r.done = 'refused'; robots = robots.filter(x => x !== r); if (G) buildRobots(); toast(t('toast.refused'), m.err); return }
    r.T = m.T; r.P = m.P; r.params = { ...m.params, ...r.params }; PCACHE = m.params; r.ready = true });
  if (modes.stair) SIM.modes(slot, true, modes.slope);  // the thread takes it after the start, in order
  return r }
SIM.onfatal = msg => toast(t('toast.simError'), msg);
let PCACHE = {};  // the controller's default parameters, as the latest session reported them
SIM.onparam(m => { const r = SES[m.id]; if (r && m.gen === simGen) r.params[m.pid] = m.v });
function setScene(name) { const S = SCENES[name]; cur.spot = { ...SPOTS.find(s => s.k === S.spot) }; cur.brains = S.brains.slice(); cur.hard = !!S.hard; spotModes(cur.spot);
  setCmd(S.v, 0, S.w, !!S.lock); setPosture(S.posture === undefined ? 2 : S.posture);
  sceneLabel('scene.' + name); showHint(S.hint); setShove(); start() }
function setShove() { $('bShove').textContent = t('hud.shove', { f: cur.hard ? 600 : 300 }); $('bShove').classList.toggle('hot', cur.hard) }
function showHint(k) { $('hint').textContent = k ? t(k) : ''; $('hint').hidden = !k }
// Starts the selected brains on the evaluation terrain (story and lab).
function start(opts) {
  if (!SIM.ready) return; hideToast(); closePanels(); exitPlace(); freeAll();
  SIM.use(0); useGround('story');
  robots = []; const s = cur.spot, n = cur.brains.length;
  cur.relay = (n === 2 && LOWMEM) ? { idx: 0, results: [] } : null;
  if (cur.relay) { const r = initSession(0, cur.brains[0], s.x, s.y, s.slope, s.yaw, opts); if (r) { r.slotLabel = 0; robots.push(r) } }
  else cur.brains.forEach((b, i) => { const r = initSession(i, b, s.x, s.y + (n === 2 ? (i === 0 ? -.9 : .9) : 0), s.slope, s.yaw, opts); if (r) { r.slotLabel = i; robots.push(r) } });
  ramp.v = ramp.vy = ramp.w = 0; if (robots.length) { buildStoryGround(s.x, s.y, true); buildRobots() } tallyKey = '';
  if (mode === 'lab') labApplyParams();
}
function nextRelay() { const rl = cur.relay; const prev = robots[0]; rl.results[rl.idx] = prev; rl.idx++;
  retire([0]); const s = cur.spot; const r = initSession(0, cur.brains[rl.idx], s.x, s.y, s.slope, s.yaw); if (!r) return; r.slotLabel = rl.idx; robots = [r]; ramp.v = ramp.vy = ramp.w = 0; buildRobots(); tallyKey = ''; if (mode === 'lab') labApplyParams() }

/* ================= toasts and panels ================= */
let toastSpec = null;
function toast(h, txt, btns) { toastSpec = [h, txt, btns]; $('toastH').textContent = h || ''; $('toastH').hidden = !h; $('toastText').textContent = txt || ''; const b = $('toastBtns'); b.innerHTML = '';
  (btns || [[t('toast.again'), () => { mode === 'world' ? respawn() : start() }, true]]).forEach(([l, f, hot]) => { const e = document.createElement('button'); e.className = 'sbtn' + (hot ? ' hot' : ''); e.textContent = l; e.onclick = () => { hideToast(); f() }; b.append(e) }); $('toast').hidden = false }
function hideToast() { $('toast').hidden = true; toastSpec = null }
const toastOpen = () => !$('toast').hidden;
const PANELS = [['pBrain', 'bBrain'], ['pMap', 'bMap'], ['pJournal', 'bJournal'], ['pWorld', 'bWorld']];
function closePanels() { PANELS.forEach(([p, b]) => { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false') }); mapLive = false; $('stage').classList.remove('panelopen'); if (G) viewOffset() }
function togglePanel(p, b, fill) { const o = $(p).hidden; closePanels(); if (o) { fill(); $(p).hidden = false; $(b).setAttribute('aria-expanded', 'true'); $('stage').classList.add('panelopen') } if (G) viewOffset() }
function reopen(p, b, fill) { fill(); $(p).hidden = false; $(b).setAttribute('aria-expanded', 'true'); $('stage').classList.add('panelopen') }
$('bBrain').onclick = () => togglePanel('pBrain', 'bBrain', fillBrains);
$('bMap').onclick = () => togglePanel('pMap', 'bMap', fillMap);
$('bJournal').onclick = () => togglePanel('pJournal', 'bJournal', fillJournal);
$('bWorld').onclick = () => togglePanel('pWorld', 'bWorld', fillWorldPanel);
document.querySelectorAll('[data-close]').forEach(b => b.onclick = closePanels);
function fillBrains() { const el = $('brains'); el.innerHTML = '';
  if (mode === 'world') {
    for (const k of Object.keys(BRAINS)) { const lock = !W.unlocked.includes(k); const b = document.createElement('button'); b.setAttribute('aria-pressed', k === W.brain); if (lock) b.setAttribute('aria-disabled', 'true');
      b.innerHTML = `<b>${lock ? t('panel.locked') : bn(k)}</b><span>${lock ? t(k === 'mpc' ? 'panel.lockedMpc' : 'panel.lockedLearn') : t('brain.' + k + '.d')}</span>`;
      b.onclick = () => { if (lock) return; W.brain = k; closePanels(); equip() }; el.append(b) }
    const h = document.createElement('div'); h.className = 'slot'; h.textContent = t('panel.second'); el.append(h);
    if (LOWMEM) { const s = document.createElement('span'); s.className = 'muted'; s.textContent = t('panel.lowmem'); el.append(s) }
    else { const none = document.createElement('button'); none.setAttribute('aria-pressed', !W.rival); none.innerHTML = `<b>${t('panel.none')}</b><span>${t('panel.noneD')}</span>`; none.onclick = () => { W.rival = null; closePanels(); equip() }; el.append(none);
      for (const k of Object.keys(BRAINS)) { if (!W.unlocked.includes(k)) continue; const b = document.createElement('button'); b.setAttribute('aria-pressed', W.rival === k); b.innerHTML = `<b>${bn(k)}</b><span>${t('panel.secondD')}</span>`; b.onclick = () => { W.rival = k; closePanels(); equip() }; el.append(b) } }
    return }
  const duel = cur.brains.length === 2;
  const head = document.createElement('div'); head.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;flex-wrap:wrap';
  head.innerHTML = `<span class="seg"><button aria-pressed="${!duel}">${t('panel.one')}</button><button aria-pressed="${duel}">${t('panel.two')}</button></span>`;
  const relabel = () => mode === 'lab' ? sceneLabel('lab.scene', { n: t('lab.' + LAB.k + '.n') }) : sceneLabel(cur.brains.length === 2 ? 'scene.compared' : 'scene.free');
  head.querySelectorAll('button')[0].onclick = () => { cur.brains = [cur.brains[cur.brains.length - 1]]; relabel(); start(); reopen('pBrain', 'bBrain', fillBrains) };
  head.querySelectorAll('button')[1].onclick = () => { if (!duel) cur.brains = [cur.brains[0] === 'rules' ? 'ppo' : 'rules', cur.brains[0] === 'rules' ? 'shac' : cur.brains[0]]; relabel(); start(); reopen('pBrain', 'bBrain', fillBrains) };
  el.append(head);
  if (duel && LOWMEM) { const s = document.createElement('span'); s.className = 'muted'; s.textContent = t('panel.relay'); el.append(s) }
  cur.brains.forEach((sel, slot) => { if (duel) { const s = document.createElement('div'); s.className = 'slot'; s.innerHTML = `<i class="dot" style="background:var(${slot ? '--s-shac' : '--s-ppo'})"></i>${t(slot ? 'panel.red' : 'panel.blue')}`; el.append(s) }
    for (const k of Object.keys(BRAINS)) { const b = document.createElement('button'); b.setAttribute('aria-pressed', k === sel); b.innerHTML = `<b>${bn(k)}</b><span>${t('brain.' + k + '.d')}</span>`;
      b.onclick = () => { cur.brains[slot] = k; relabel(); start(); reopen('pBrain', 'bBrain', fillBrains) }; el.append(b) } });
}

/* ================= driving ================= */
// The stick and the bar spring back to zero when released; Lock holds the command instead.
const inp = { joy: null, turn: null, keys: new Set(), shift: false, pad: null };
function setCmd(v, vy, w, lock) { cmd.v = v; cmd.vy = vy; cmd.w = w; if (lock !== undefined) setLock(lock); showCmd() }
function setLock(on) { cmd.lock = on; $('bLock').setAttribute('aria-pressed', on); $('bLock').textContent = t(on ? 'hud.locked' : 'hud.lock'); $('joy').classList.toggle('locked', on) }
function limits() { return cmd.gait === 2 ? { v: .3, back: .2, vy: .2 } : { v: VMAX, back: VBACK, vy: VYMAX } }
function resolveCmd() {
  const L = limits(); let v = null, vy = null, w = null;
  if (inp.joy) { v = inp.joy.v; vy = inp.joy.vy }
  if (inp.turn !== null) w = inp.turn;
  const keys = inp.keys;
  if (keys.size) {
    const slow = inp.shift ? .35 : 1;  // Shift slows
    const f = (keys.has('w') || keys.has('arrowup')) - (keys.has('s') || keys.has('arrowdown')), sd = keys.has('a') - keys.has('d'), tr = (keys.has('q') || keys.has('arrowleft')) - (keys.has('e') || keys.has('arrowright'));
    if (f) v = f > 0 ? L.v * slow : -L.back * slow; else if (v === null && (sd || tr)) v = cmd.lock ? null : 0;
    if (sd) vy = sd * L.vy * slow; else if (vy === null && (f || tr)) vy = cmd.lock ? null : 0;
    if (tr) w = tr * WMAX * (inp.shift ? .5 : .8);
  }
  if (inp.pad && inp.pad.active) { const p = inp.pad, s = p.slow ? .35 : 1; v = (p.ly < 0 ? -p.ly * L.v : -p.ly * L.back) * s; vy = -p.lx * L.vy * s; w = -p.rx * WMAX * s }
  const active = v !== null || vy !== null || w !== null;
  if (active && (v || vy || w) && cmd.posture !== 2 && !labBusy()) setPosture(2);
  if (cmd.lock && !active) return;
  if (!cmd.lock) { cmd.v = v || 0; cmd.vy = vy || 0; cmd.w = w || 0 }
  else { if (v !== null) cmd.v = v; if (vy !== null) cmd.vy = vy; if (w !== null) cmd.w = w }
  cmd.v = clamp(cmd.v, -L.back, L.v); cmd.vy = clamp(cmd.vy, -L.vy, L.vy);
}
function showCmd() {
  const j = $('joy'), rr = j.clientWidth / 2 - 20; const kx = -cmd.vy / VYMAX * rr, ky = -(cmd.v >= 0 ? cmd.v / VMAX : cmd.v / VBACK) * rr;
  $('knob').style.transform = `translate(${kx}px,${ky}px)`; const tb = $('turn'), tr = tb.clientWidth / 2 - 20; $('tknob').style.transform = `translateX(${-cmd.w / WMAX * tr}px)`;
  $('jV').textContent = t('hud.fwd', { v: fmt(cmd.v, 2) }); $('jS').textContent = t('hud.side', { v: fmt(-cmd.vy, 2) }); $('jW').textContent = t('hud.turn', { v: fmt(cmd.w, 2) });
  j.setAttribute('aria-valuetext', `${cmd.v.toFixed(2)}, ${cmd.vy.toFixed(2)} m/s`); tb.setAttribute('aria-valuetext', `${cmd.w.toFixed(2)} rad/s`) }
function dragPad(el, fn, end) { let id = null; el.addEventListener('pointerdown', e => { id = e.pointerId; el.setPointerCapture(id); el.classList.add('held'); fn(e) }); el.addEventListener('pointermove', e => { if (e.pointerId === id) fn(e) });
  const up = e => { if (e.pointerId !== id) return; id = null; el.classList.remove('held'); end() }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up) }
dragPad($('joy'), e => { const b = $('joy').getBoundingClientRect(), rr = b.width / 2 - 20; let dx = e.clientX - b.left - b.width / 2, dy = e.clientY - b.top - b.height / 2; const d = Math.hypot(dx, dy); if (d > rr) { dx *= rr / d; dy *= rr / d }
  const L = limits(); let vy = Math.round(-dx / rr * VYMAX * 20) / 20, fy = -dy / rr, v = Math.round((fy >= 0 ? fy * VMAX : fy * VBACK) * 20) / 20; if (Math.abs(vy) < .06) vy = 0; if (Math.abs(v) < .05) v = 0;
  inp.joy = { v: clamp(v, -L.back, L.v), vy: clamp(vy, -L.vy, L.vy) }; if (mode === 'story') showHint('') }, () => { inp.joy = null });
dragPad($('turn'), e => { const b = $('turn').getBoundingClientRect(), rr = b.width / 2 - 20; const dx = clamp(e.clientX - b.left - b.width / 2, -rr, rr); let w = Math.round(-dx / rr * WMAX * 20) / 20; if (Math.abs(w) < .1) w = 0; inp.turn = w }, () => { inp.turn = null });
$('bLock').onclick = () => setLock(!cmd.lock);
function setPosture(p) { cmd.posture = p; [['mSit', 0], ['mStop', 1], ['mWalk', 2]].forEach(([id, k]) => $(id).setAttribute('aria-pressed', k === p)) }
$('mWalk').onclick = () => setPosture(2); $('mStop').onclick = () => { setPosture(1); setCmd(0, 0, 0, false) }; $('mSit').onclick = () => { setPosture(0); setCmd(0, 0, 0, false) };
function setGait(g) { cmd.gait = g; $('gTrot').setAttribute('aria-pressed', g === 1); $('gCrawl').setAttribute('aria-pressed', g === 2); resolveCmd() }
$('gTrot').onclick = () => setGait(1); $('gCrawl').onclick = () => setGait(2);

/* ================= operator modes ================= */
// The stair and slope modes, chosen by the reader as the operator chooses them on the robot: the stair
// mode before a flight (taken once the robot stops walking, with its own policy and fall detector),
// the slope mode before inclines (at once). The stair mode's files are fetched when first chosen.
const modes = { stair: false, slope: false, files: null, loading: 0 };
function stairFiles() {
  if (!modes.files) modes.files = fetchData(p => { modes.loading = p; showModes() }, 'stair').then(files => { SIM.addFiles(files); return true })
    .catch(e => { modes.files = null; toast(t('toast.loadStair'), e.message); return false }).finally(() => { modes.loading = 0; showModes() });
  return modes.files }
async function setStair(on) {
  if (on && !(await stairFiles())) return;
  modes.stair = on; applyModes(); showModes();
  if (robots.some(r => r.T[1] === 5)) showHint(on ? 'hint.stairWait' : 'hint.stairOffWait') }
function setSlope(on) { modes.slope = on; applyModes(); showModes() }
function applyModes() { for (const r of robots) if (!r.done) SIM.modes(r.id, modes.stair, modes.slope) }
// A scene or a spot sets the slope mode as an operator would for its terrain; the stair mode is left off.
function spotModes(s) { modes.slope = !!s.slope; modes.stair = false; showModes() }
// The buttons show the reader's choice; a choice the controller has not yet taken is marked.
function showModes() { const T = robots[0] && robots[0].ready ? robots[0].T : null, bits = T ? T[191] : 0;
  const st = $('mStairs'), sl = $('mSlope');
  st.setAttribute('aria-pressed', modes.stair); sl.setAttribute('aria-pressed', modes.slope);
  st.textContent = modes.loading ? t('hud.loading', { p: Math.round(modes.loading * 100) }) : t('hud.stairs');
  const wait = !!T && modes.stair !== !!(bits & 1); st.classList.toggle('wait', wait); st.title = t(wait ? 'hud.stairsWait' : 'hud.stairsTitle') }
$('mStairs').onclick = () => setStair(!modes.stair); $('mSlope').onclick = () => setSlope(!modes.slope);
function shove(hard) { if (!loaded || !robots.length) return; const f = hard || cur.hard ? 600 : 300, s = Math.random() < .5 ? -1 : 1;
  for (const r of robots) { const T = tel(r.id); const yaw = yawOf(T); SIM.push(r.id, [-Math.sin(yaw) * f * s, Math.cos(yaw) * f * s, 0, .1]) }
  W.shoveAt = performance.now(); if (mode === 'story') showHint('') }
$('bShove').onclick = () => shove(false);
$('bReset').onclick = () => { if (G) G.panOff.set(0, 0, 0); mode === 'lab' ? labStart(true) : start() };
const KEYS_DRIVE = new Set(['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
function stageInView() { const r = $('stage').getBoundingClientRect(); return mode !== 'story' || (r.bottom > 0 && r.top < innerHeight) }
addEventListener('keydown', e => {
  if (!loaded || e.target.closest('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey || !stageInView()) return;
  const k = e.key.toLowerCase(); inp.shift = e.shiftKey;
  if (KEYS_DRIVE.has(k)) { inp.keys.add(k); e.preventDefault(); return }
  let hit = true;
  if (k === ' ') setCmd(0, 0, 0, false); else if (k === 'l') setLock(!cmd.lock);
  else if (k === '1') setPosture(2); else if (k === '2') $('mStop').click(); else if (k === '3') $('mSit').click();
  else if (k === 't') setGait(cmd.gait === 1 ? 2 : 1); else if (k === 'f') shove(e.shiftKey);
  else if (k === 'r') setStair(!modes.stair); else if (k === 'i') setSlope(!modes.slope);
  else if (k === 'p') $('bPlace').click(); else if (k === 'm') $('bMap').click(); else if (k === 'j' && mode === 'world') $('bJournal').click();
  else if (k === 'h' || k === '?') toggleHelp(); else if (k === 'escape') { if (!$('help').hidden) toggleHelp(false); else if (placing) exitPlace(); else closePanels() }
  else hit = false;
  if (hit) e.preventDefault() });
addEventListener('keyup', e => { inp.shift = e.shiftKey; inp.keys.delete(e.key.toLowerCase()) });
addEventListener('blur', () => { inp.keys.clear(); inp.joy = null; inp.turn = null });
function toggleHelp(on) { const h = $('help'); h.hidden = on === undefined ? !h.hidden : !on }
$('bHelp').onclick = () => toggleHelp(); document.querySelector('[data-close-help]').onclick = () => toggleHelp(false); $('help').onclick = e => { if (e.target === $('help')) toggleHelp(false) };
let padId = null;
function padText() { $('padState').textContent = padId ? t('help.pad', { id: padId }) : t('help.nopad') }
const padPrev = [];
function pollPad() { let pads = []; try { pads = navigator.getGamepads ? navigator.getGamepads() : [] } catch (e) { return } const p = pads && [...pads].find(x => x && x.connected);
  if (!p) { inp.pad = null; return }
  if (!padId) { padId = p.id.slice(0, 60); padText() }
  const dz = v => Math.abs(v) < .15 ? 0 : v; const lx = dz(p.axes[0] || 0), ly = dz(p.axes[1] || 0), rx = dz(p.axes[2] || 0);
  const btn = i => !!(p.buttons[i] && p.buttons[i].pressed), edge = i => { const b = btn(i), was = padPrev[i]; padPrev[i] = b; return b && !was };
  inp.pad = { active: !!(lx || ly || rx), lx, ly, rx, slow: !!(p.buttons[7] && p.buttons[7].value > .3) };
  if (edge(0)) shove(false); if (edge(1)) $('mStop').click(); if (edge(2)) $('mSit').click(); if (edge(3)) setPosture(2);
  if (edge(4)) setLock(!cmd.lock); if (edge(5)) setGait(cmd.gait === 1 ? 2 : 1); if (edge(8)) $('bMap').click(); if (edge(9)) toggleHelp();
  if (edge(12)) setStair(!modes.stair); if (edge(13)) setSlope(!modes.slope) }

/* ================= the loop ================= */
let lastT = performance.now(), rate = 1, uiT = 0;
function frame(now) {
  requestAnimationFrame(frame); pollPad(); resolveCmd(); labDrive();
  const ck = cmd.v + ',' + cmd.vy + ',' + cmd.w; if (ck !== frame.ck) { frame.ck = ck; showCmd() }
  const real = Math.max(1e-3, (now - lastT) / 1000), wall = Math.min(.25, real); lastT = now;
  // Time spent starting a session is not simulation time owed, nor time lost.
  if (running() && robots.every(r => r.done || r.ready)) { debt = Math.min(.25, debt + wall); issue(); rate = .92 * rate + .08 * (simAdv / real) } else debt = 0;
  simAdv = 0;
  if (mode === 'world' && St && robots.length) { const T = tel(robots[0].id), P = St.toWorld(T[9], T[10]); St.pump(LOWMEM ? 3 : 5, P[0], P[1]); wrUpdate(P[0], P[1], LOWMEM ? 4 : 6) }
  draw();
  if (now - uiT > 120) { uiT = now; uiTick() }
}
// Simulation runs in batches of control cycles covering the wall time since the last one, each
// split into chunks of at most ten cycles (20 ms) with the command ramped between them. Every
// thread runs the same chunks, and the page samples the telemetry after each chunk, as if it had
// stepped the robots itself. A batch is kept to about one frame of the slowest thread's work, and
// the next one starts as soon as it returns, so a slow controller runs as fast as it can while
// the page goes on drawing.
let batch = null, debt = 0, simAdv = 0, perCycle = .2, rampQ = { v: 0, vy: 0, w: 0 }, rampGen = -1;
const BUDGET = LOWMEM ? 12 : 16;  // ms of simulation per batch
const running = () => robots.some(r => !r.done) && !toastOpen() && !document.hidden && $('gen').hidden;
function issue() {
  if (batch || !running()) return; const live = robots.filter(r => !r.done); if (live.some(r => !r.ready)) return;
  const want = Math.min(Math.round(debt / .002), Math.max(5, Math.floor(BUDGET / perCycle))); if (want < 1) return;
  if (rampGen !== simGen) { rampQ = { ...ramp }; rampGen = simGen }
  const ch = []; let ran = 0;
  while (ran < want) { const k = Math.min(10, want - ran), dt = k * .002, q = rampQ;
    q.v += clamp(cmd.v - q.v, -.5 * dt, .5 * dt); q.vy += clamp(cmd.vy - q.vy, -.5 * dt, .5 * dt); q.w += clamp(cmd.w - q.w, -dt, dt);
    ch.push(k, q.v, q.vy, q.w, cmd.gait, cmd.posture); ran += k }
  debt -= ran * .002;
  const b = batch = { gen: simGen, mode, ch: Float64Array.from(ch), live, ran };
  const reset = live.filter(r => r.reset).map(r => r.id); live.forEach(r => r.reset = false);
  SIM.run(live.map(r => r.id), b.ch, reset).then(res => finish(b, res));
}
function finish(b, res) {
  if (batch !== b) return; batch = null; if (b.mode !== mode) return;  // issued before the page changed mode
  perCycle = .8 * perCycle + .2 * Math.max(.02, res.ms / b.ran);
  for (let c = 0; c < b.ch.length / 6; c++) { const k = b.ch[6 * c]; ramp.v = b.ch[6 * c + 1]; ramp.vy = b.ch[6 * c + 2]; ramp.w = b.ch[6 * c + 3];
    for (const r of b.live) if (!r.done) r.T = res.T[r.id][c];
    sampleAll(k * .002); simAdv += k * .002;
    if (b.gen !== simGen) return }  // the robots were replaced while sampling (the next relay leg)
  for (const r of b.live) { r.P = res.P[r.id]; if (res.fail[r.id] && !r.done) { r.done = 'error'; toast(t('toast.simError'), res.fail[r.id]) } }
  if (mode === 'world') follow();
  issue();
}
// The floating origin: keeps the robot near the heightfield's centre. The page shifts its copy of
// every session as the simulator shifts the sessions, so the drawing never mixes the two frames.
function follow() {
  const T = tel(robots[0].id), P = St.toWorld(T[9], T[10]); const sh = St.follow(P[0], P[1]); if (!sh) return;
  for (const r of SES) { if (!r) continue; r.T[9] -= sh[0]; r.T[10] -= sh[1]; r.T[96] -= sh[0]; r.T[97] -= sh[1];
    for (let g = 0; g < Math.min(64, G.gbody.length); g++) if (G.gbody[g] > 0) { r.P[12 * g] -= sh[0]; r.P[12 * g + 1] -= sh[1] } }
  SIM.terrain(view(), G.hfStory.nc, St.span, true); SIM.shift(sh);
  G.cam.position.x -= sh[0]; G.cam.position.y -= sh[1]; G.ctl.target.x -= sh[0]; G.ctl.target.y -= sh[1]; wrSync();
}
function sampleAll(dt) {
  for (const r of robots) { if (r.done) continue; const T = tel(r.id), tm = T[0], st = T[1], yaw = yawOf(T);
    const vf = T[6] * Math.cos(yaw) + T[7] * Math.sin(yaw), ve = T[3] * Math.cos(yaw) + T[4] * Math.sin(yaw);
    if (st === 5 && Math.abs(ramp.v - cmd.v) < 1e-3 && Math.abs(ramp.w - cmd.w) < 1e-3 && Math.abs(ramp.vy - cmd.vy) < 1e-3) { r.se += (vf - ramp.v) ** 2; r.sw += (T[14] - ramp.w) ** 2; r.n++ }
    r.us = r.us ? .95 * r.us + .05 * T[85] : T[85]; if (tm > 2) W.cost[r.brain] = r.us;
    r.hist.push([tm, ramp.v, vf, ve]); while (r.hist[0][0] < tm - 8) r.hist.shift();
    r.gait.push([tm, [25, 26, 27, 28].map(i => T[i]), [21, 22, 23, 24].map(i => T[i])]); while (r.gait[0][0] < tm - 3) r.gait.shift();
    const kn = [2, 5, 8, 11].reduce((a, j) => a + T[61 + j] ** 2, 0) / 4; r.knee.push([tm, kn]); while (r.knee[0][0] < tm - 10) r.knee.shift();
    // A step is a footfall after at least 60 ms in the air; footfalls within 50 ms count once.
    let stance = 0, cone = 0, td = 0;
    for (let l = 0; l < 4; l++) { const c = T[21 + l] > .5; if (c) { stance++; if (T[29 + l] > .5) cone++ } if (c && r.air[l] >= .06) td++; r.air[l] = c ? 0 : r.air[l] + dt }
    if (td && tm - (r.lastStepT || -1) > .05) { r.steps++; r.lastStepT = tm; if (st === 5) W.steps++ }
    r.grip.push([tm, stance ? cone / stance : 0]); while (r.grip[0][0] < tm - 3) r.grip.shift();
    if (st === 5) W.odo += Math.hypot(T[6], T[7]) * dt;
    if (mode === 'lab') { r.tr.push(Float32Array.from(T)); while (r.tr.length > 220) r.tr.shift(); labSample(r, T, dt) }
    if (mode === 'world' && r === robots[0]) worldSample(r, T);
    if (!(T[95] & FAULT_LATCH)) r.faultSeen = false;
    if ((st === 9 || st === 10 || st === 12) && !r.fellAt) r.fellAt = tm;
    if (r.fellAt && st === 5) r.fellAt = 0;
    if (r.fellAt && tm - r.fellAt > 2.5) r.done = st === 12 ? 'power' : 'fell';
    if (mode !== 'world') { const c = tileCenter(tileOf(cur.spot.x, cur.spot.y)); if (Math.abs(T[9] - c[0]) > 7.6 || Math.abs(T[10] - c[1]) > 7.6) r.done = 'edge' }
  }
  if (!robots.length || toastOpen()) return;
  if (cur.relay) { const r = robots[0]; if (!r.done && r.hist.length && r.hist[r.hist.length - 1][0] > 18 && cur.relay.idx === 0 && !labBusy()) r.done = 'turn';
    if (r.done && cur.relay.idx === 0) { nextRelay(); return } }
  // A sensor or drive fault the supervisor has latched keeps the robot sitting until the operator
  // clears it, as on the robot; offered once the reader asks it to stand or walk.
  const latched = robots.filter(r => !r.done && r.T[1] === 2 && (r.T[95] & FAULT_LATCH) && !r.faultSeen);
  if (latched.length && cmd.posture > 0) { latched.forEach(r => r.faultSeen = true);
    toast(t('toast.fault'), t('toast.faultT'), [[t('toast.clear'), () => latched.forEach(r => r.reset = true), true],
      [t('toast.again'), () => mode === 'world' ? rightHere() : mode === 'lab' ? labStart(true) : start()]]); return }
  if (robots[0].done || robots.every(r => r.done)) {
    const w = robots[0].done;
    if (mode === 'world') {
      if (w === 'fell' || w === 'power') { W.falls++; saveW(); const q = QUESTS[W.q]; if (q && q.custom === 'fall' && nearTour(q.at)) { completeQuest(); return }
        toast(t(w === 'fell' ? 'toast.down' : 'toast.power'), t(w === 'fell' ? 'toast.downT' : 'toast.powerT'), [[t('toast.rightHere'), () => rightHere(), true], [t('toast.carryBase', { place: siteName(W.world.tour.base) }), respawn]]) }
      return }
    const again = () => mode === 'lab' ? labStart(true) : start();
    if (robots.length === 1 && !cur.relay) toast('', t(w === 'fell' ? 'toast.fellStory' : w === 'power' ? 'toast.powerStory' : 'toast.edge'),
      w === 'fell' || w === 'power' ? [[t('toast.rightHere'), () => rightHere(), true], [t('toast.again'), again]] : [[t('toast.back'), () => rightHere(3), true], [t('toast.again'), again]]);
    else if (robots.every(r => r.done)) toast('', t('toast.both'));
  }
}
// Panels and numbers that need not change every frame.
let lastStateKey = null;
function uiTick() {
  if (!loaded) return; $('cRate').textContent = t('hud.rate', { p: Math.round(Math.min(rate, 1) * 100) });
  if (robots.length) { const T0 = tel(robots[robots.length - 1].id), st = T0[1]; if (st !== lastStateKey) { lastStateKey = st; $('cState').textContent = t('state.' + st); $('cDot').className = 'dot ' + (STATE_DOT[st] || 'warn') } }
  renderTally(); showModes(); if (mode === 'world') renderSheet(); if (mapLive && !$('pMap').hidden) mapDraw(false);
  if (mode === 'lab') labTick();
}
let tallyKey = '';
// In the stair mode a learned controller flies the stair policy; the model-based ones keep their forces.
const stairOn = r => !!(r && r.T && r.ready && (r.T[191] & 1));
function renderTally() { const el = $('tally'); const compare = cur.brains.length === 2 || robots.length === 2; el.hidden = !loaded || !robots.length || (mode === 'world' && !compare);
  el.style.cssText = mode === 'world' ? 'left:auto;right:max(12px,env(safe-area-inset-right,0px));top:58px;max-width:300px' : '';
  $('sheet').classList.toggle('mode-off', mode !== 'world' || compare);
  if (el.hidden) return;
  const rows = compare ? (cur.relay ? cur.brains.map((b, i) => i === robots[0].slotLabel ? robots[0] : cur.relay.results[i] || { brain: b, pending: true }) : robots.slice().sort((a, b) => a.slotLabel - b.slotLabel)) : robots;
  const key = rows.map(r => r && r.brain + (r.pending ? 'p' : '') + (stairOn(r) ? 's' : '')).join() + (cur.relay ? cur.relay.idx : '') + mode + lang;
  if (key !== tallyKey) { tallyKey = key; el.innerHTML = rows.map((r, i) => `<div class="trow"><i class="sw" style="background:var(${compare && i === 0 ? '--s-ppo' : '--s-shac'})"></i><div><div>${bn(r.brain)}${stairOn(r) ? `<span class="tag">${t(BRAINS[r.brain].pol ? 'mode.tagPolicy' : 'mode.tag')}</span>` : ''}</div><div class="vals" id="tv${i}">—</div></div></div>`).join('') }
  rows.forEach((r, i) => { const e = $('tv' + i); if (!e || !r) return; if (r.pending) { e.textContent = t('tally.next'); return }
    const sp = r.n > 50 ? fmt(Math.sqrt(r.se / r.n), 2) : '…', tw = r.n > 50 ? fmt(Math.sqrt(r.sw / r.n), 2) : '…';
    e.textContent = t('tally.scores', { v: sp, w: tw, ms: fmt(r.us / 1000, 2) }) + (r.done && r.done !== 'turn' ? ' · ' + t('done.' + r.done) : '') + (r.n <= 50 ? t('tally.wait') : '') }) }
function renderSheet(rebuild) { const r = robots[0]; if (!r || !W.world) return; const el = $('sheet');
  const kneeRms = r.knee.length ? Math.sqrt(r.knee.reduce((a, b) => a + b[1], 0) / r.knee.length) : 0; const grip = r.grip.length ? r.grip.reduce((a, b) => a + b[1], 0) / r.grip.length : 0;
  if (!el.dataset.built || rebuild) { el.innerHTML = `<div class="r"><div><b id="shB"></b><span id="shP" class="num"></span></div></div>
    <div class="r"><div><span>${t('sheet.knee')}</span><em id="shK"></em></div><div class="gauge" title="${t('sheet.kneeTitle')}"><i id="shKg"></i></div></div>
    <div class="r"><div><span>${t('sheet.grip')}</span><em id="shG"></em></div></div>
    <div class="r"><div><span>${t('sheet.walked')}</span><em id="shO"></em></div><div><span>${t('sheet.steps')}</span><em id="shS"></em></div><div><span>${t('sheet.falls')}</span><em id="shF"></em></div><div><span>${t('sheet.found')}</span><em id="shN"></em></div></div>`;
    if (!el.dataset.built) { el.onclick = () => el.classList.toggle('collapsed'); if (innerWidth <= 980) el.classList.add('collapsed') } el.dataset.built = 1 }
  const P = robotWorld(r); $('shB').textContent = bn(r.brain); $('shP').textContent = W.world.cellAt(Math.floor(P[0] / 24), Math.floor(P[1] / 24)).name;
  $('shK').textContent = fmt(kneeRms, 1) + ' N·m'; $('shKg').style.width = Math.min(100, kneeRms / 60 * 100) + '%'; $('shKg').style.background = kneeRms > 20 ? 'var(--warn)' : 'var(--ok)';
  $('shG').textContent = Math.round(grip * 100) + ' %'; $('shO').textContent = fmt(W.odo, 1) + ' m'; $('shS').textContent = W.steps; $('shF').textContent = W.falls; $('shN').textContent = W.found.size }
// The strip under the story stage: the gait and the speeds. With two robots, each one's true speed.
function drawStrip() { const c = $('strip'); if (c.hidden || mode !== 'story') return; const cw = Math.round(c.clientWidth * devicePixelRatio); if (!cw) return; if (c.width !== cw) { c.width = cw; c.height = Math.round(c.clientHeight * devicePixelRatio) }
  const g = c.getContext('2d'), w = c.width, h = c.height, dpr = devicePixelRatio; g.clearRect(0, 0, w, h);
  const two = robots.length === 2, r = robots[robots.length - 1]; if (!r || r.hist.length < 2 || r.gait.length < 2) return;
  g.fillStyle = css('--hud'); g.globalAlpha = .92; g.beginPath(); g.roundRect ? g.roundRect(0, 0, w, h, 8 * dpr) : g.rect(0, 0, w, h); g.fill(); g.globalAlpha = 1; g.strokeStyle = css('--rule-2'); g.lineWidth = dpr; g.stroke();
  const pad = 8 * dpr, gw = w * .4, t1 = r.gait[r.gait.length - 1][0], lh = (h - 2 * pad) / 4; g.font = `${9 * dpr}px DM Mono, monospace`;
  for (let k = 1; k < r.gait.length; k++) { const p = r.gait[k], q = r.gait[k - 1], xa = pad + 24 * dpr + (q[0] - (t1 - 3)) / 3 * (gw - 24 * dpr), xb = pad + 24 * dpr + (p[0] - (t1 - 3)) / 3 * (gw - 24 * dpr);
    for (let l = 0; l < 4; l++) { if (p[1][l]) { g.fillStyle = css('--rule-2'); g.fillRect(xa, pad + l * lh + 1, xb - xa + 1, lh - 2) } if (p[2][l]) { g.fillStyle = css('--ink'); g.fillRect(xa, pad + l * lh + lh / 2 - 1.5 * dpr, xb - xa + 1, 3 * dpr) } } }
  g.fillStyle = css('--ink-2'); ['FL', 'FR', 'RL', 'RR'].forEach((nm, l) => g.fillText(nm, pad, pad + l * lh + lh / 2 + 3 * dpr));
  const X0 = gw + pad * 3, Wd = w - X0 - pad, tt = r.hist[r.hist.length - 1][0], x = tm => X0 + (tm - (tt - 8)) / 8 * Wd, y = v => h - pad - (v + .5) / 1.7 * (h - 2 * pad - 10 * dpr);
  g.strokeStyle = css('--rule-2'); g.lineWidth = dpr; g.beginPath(); g.moveTo(X0, y(0)); g.lineTo(X0 + Wd, y(0)); g.stroke();
  const line = (hist, i, col, lw, da) => { g.strokeStyle = col; g.lineWidth = lw * dpr; g.setLineDash(da.map(d => d * dpr)); g.beginPath(); hist.forEach((p, k) => k ? g.lineTo(x(p[0]), y(p[i])) : g.moveTo(x(p[0]), y(p[i]))); g.stroke(); g.setLineDash([]) };
  line(robots[0].hist, 1, css('--ink-2'), 1, [4, 3]);
  if (two) robots.forEach(q => line(q.hist, 2, css(q.slotLabel === 0 ? '--s-ppo' : '--s-shac'), 2, []));
  else { line(r.hist, 2, css('--s-shac'), 2, []); line(r.hist, 3, css('--s-ppo'), 1.4, []) }
}
