// World generator for the Proving Grounds.
//
// Writes a 64 m x 64 m landscape straight into the simulator's heightfield, so that everything
// drawn is also what the robot's feet meet: hills, a scree field, boulders, a ridge with a stone
// stair, a steep grass face and a long ramp, tree trunks and the columns of a ruin. It is built
// from the kinds of ground the policies were trained on (inclines, blocks, stairs), blended
// together, and reports where a setting leaves that range.
(function (root) {
  'use strict';

  const DEFAULTS = { seed: 7, hills: 1, rocks: 1, forest: 1, riser: 0.10, steep: 20 };
  // What the networks met in training: slopes up to 20 deg, blocks up to 8 cm, steps up to 10 cm.
  const TRAINED = { steep: 20, riser: 0.10, block: 0.08 };

  const BASE = -1.2;      // m, the lower level
  const RISE = 1.3;       // m, from the lower level to the plateau
  const TREAD = 0.30;     // m
  const ridgeY = x => 6 + 2.5 * Math.sin(0.12 * x);

  // Sections of the ridge, west to east.
  function section(x) {
    if (x < -12) return 'ramp';
    if (x < -6) return 'cliff';
    if (x < -2) return 'stairs';
    if (x < 8) return 'cliff';
    if (x < 20) return 'steep';
    return 'cliff';
  }

  function landmarks(p) {
    const yr = ridgeY;
    const run = Math.round(RISE / p.riser) * TREAD;
    return {
      camp: [-20, -12], workshopMark: [-17, -9],
      firstStep: [-15, -12],
      meadowFoot: [-2, -17], meadowTop: [8, -20],
      scree: [-8, -24],
      stairsFoot: [-4, yr(-4) - run / 2 - 2.2], stairsTop: [-4, yr(-4) + run / 2 + 1.2],
      steepFoot: [14, yr(14) - 6.5], steepTop: [14, yr(14) + 4.5],
      rampFoot: [-22, yr(-22) - 7], court: [-22, 15.5], courtGoal: [-16.5, 15.5],
      ruin: [18, 21],
    };
  }

  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 | 0; s ^= s >>> 13; return ((s >>> 0) % 1e9) / 1e9; }; }
  function hash(i, j, seed) { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vnoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  }
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }

  // Material codes for the renderer.
  const MAT = { grass: 0, trail: 1, rock: 2, stone: 3, bark: 4, forest: 5, column: 6 };

  /**
   * hf: { nr, nc, sx, sy, sz, oz, ox, oy } of the scene's heightfield.
   * out: Float32Array(nr * nc), filled with normalised heights.
   * Returns landmarks, trees, columns, a material map and a coarse ground for distant rendering.
   */
  async function generate(params, hf, out, onProgress) {
    const p = Object.assign({}, DEFAULTS, params || {});
    const L = landmarks(p);
    const R = rng(p.seed * 7919 + 13);
    const { nr, nc, sx, sy, sz, oz, ox, oy } = hf;
    const dx = 2 * sx / (nc - 1), dy = 2 * sy / (nr - 1);
    const steepW = RISE / Math.tan(p.steep * Math.PI / 180), rampW = RISE / Math.tan(10 * Math.PI / 180);
    const nSteps = Math.round(RISE / p.riser), run = nSteps * TREAD;

    // Trails between the landmarks, cleared and levelled.
    const yr = ridgeY;
    const trails = [
      [L.camp, [-12, -14], [-2, -17], L.meadowTop],
      [L.camp, [-21, -4], L.rampFoot, [-22, yr(-22) + 6], L.court],
      [L.camp, [-11, -6], L.stairsFoot],
      [L.stairsTop, [-2, 14], [6, 18], L.ruin],
      [L.meadowTop, [12, -12], L.steepFoot],
      [L.steepTop, [16, 15], L.ruin],
    ];
    const flats = [[L.camp, 4.8], [L.ruin, 6.2], [L.meadowFoot, 1.6], [L.steepFoot, 2.0], [L.stairsFoot, 1.6], [L.rampFoot, 1.8], [L.stairsTop, 1.4], [L.steepTop, 1.6]];
    const court = { x0: -26.5, x1: -15, y0: 11.5, y1: 19.5 };

    // Smooth fields on a 0.2 m grid: noise, hill, rim, masks.
    const gs = 0.2, gn = Math.round(64 / gs) + 1, G = (a) => new Float32Array(gn * gn);
    const smooth = G(), trailM = G(), flatM = G(), screeM = G(), forestM = G(), clearM = G();
    for (let j = 0; j < gn; j++) for (let i = 0; i < gn; i++) {
      const x = -32 + i * gs, y = -32 + j * gs, k = j * gn + i;
      let td = 1e9; for (const t of trails) for (let s = 0; s + 1 < t.length; s++) td = Math.min(td, segDist(x, y, t[s][0], t[s][1], t[s + 1][0], t[s + 1][1]));
      const trail = 1 - sstep(0.9, 1.6, td);
      let flat = 0; for (const [c, r] of flats) flat = Math.max(flat, 1 - sstep(r, r + 1.5, Math.hypot(x - c[0], y - c[1])));
      const inCourt = x > court.x0 && x < court.x1 && y > court.y0 && y < court.y1;
      const courtSoft = 1 - sstep(0, 1.5, Math.max(court.x0 - x, x - court.x1, court.y0 - y, y - court.y1, 0));
      flat = Math.max(flat, courtSoft);
      const d = y - yr(x);
      const band = 1 - sstep(4.5, 7, Math.abs(d));     // the ridge itself stays clean
      const rim = sstep(25.5, 31.5, Math.max(Math.abs(x), Math.abs(y)));
      const n = (vnoise(x / 14, y / 14, p.seed) - .5) * 2 * .32 + (vnoise(x / 5, y / 5, p.seed + 1) - .5) * 2 * .09 + (vnoise(x / 2, y / 2, p.seed + 2) - .5) * 2 * .025;
      const calm = Math.max(flat, band, trail * .7);
      const hill = 0.9 * Math.exp(-((x - L.meadowTop[0]) ** 2 + (y - L.meadowTop[1]) ** 2) / (2 * 4.5 * 4.5));
      smooth[k] = n * p.hills * (1 - calm) + hill * (1 - band) + rim * (2.0 + 0.5 * vnoise(x / 6, y / 6, p.seed + 3));
      trailM[k] = inCourt ? 0 : trail;
      flatM[k] = Math.max(flat, inCourt ? 1 : 0);
      const sc = 1 - sstep(4.5, 6.5, Math.hypot(x - L.scree[0], y - L.scree[1]));
      screeM[k] = sc * (1 - trail) * (1 - band);
      const fo = Math.max(1 - sstep(0, 3, Math.max(-10 - x, x - 12, 13 - y, y - 27, 0)) * 1, 1 - sstep(0, 3, Math.max(15 - x, x - 27, -28 - y, y + 14, 0)));
      forestM[k] = fo * (1 - band) * (1 - rim);
      clearM[k] = Math.max(trail, flat, band, rim, sc);
    }
    const sample = (F, x, y) => { const fx = (x + 32) / gs, fy = (y + 32) / gs; const i = Math.max(0, Math.min(gn - 2, Math.floor(fx))), j = Math.max(0, Math.min(gn - 2, Math.floor(fy))); const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j));
      const k = j * gn + i; return (F[k] * (1 - u) + F[k + 1] * u) * (1 - v) + (F[k + gn] * (1 - u) + F[k + gn + 1] * u) * v; };

    // The ridge profile: height above the lower level as a function of position.
    function ridge(x, y) {
      const d = y - yr(x), s = section(x);
      if (s === 'stairs') { const k = Math.min(nSteps, Math.max(0, Math.floor((d + run / 2) / TREAD) + 1)); return k * p.riser; }
      const w = s === 'ramp' ? rampW : s === 'steep' ? steepW : 0.35;
      return RISE * Math.min(1, Math.max(0, (d + w / 2) / w));
    }

    const mat = new Uint8Array(nr * nc);
    const rockH = 0.06 * p.rocks;
    const rows = 64;
    for (let r0 = 0; r0 < nr; r0 += rows) {
      for (let r = r0; r < Math.min(nr, r0 + rows); r++) {
        const y = oy - sy + r * dy;
        for (let c = 0; c < nc; c++) {
          const x = ox - sx + c * dx, k = r * nc + c;
          let h = BASE + ridge(x, y) + sample(smooth, x, y);
          const sm = sample(screeM, x, y);
          let m = MAT.grass;
          if (sm > 0.02) { const bi = Math.floor(x / TREAD), bj = Math.floor(y / TREAD); h += hash(bi, bj, p.seed + 9) * rockH * Math.min(1, sm * 1.4); if (sm > .35) m = MAT.rock; }
          const d = y - yr(x), sec = section(x);
          if (Math.abs(d) < (sec === 'stairs' ? run / 2 + .05 : sec === 'cliff' ? .6 : 99)) m = sec === 'stairs' ? MAT.stone : MAT.rock;
          if (sec === 'stairs' && Math.abs(d) < run / 2 + .05 && Math.abs(x + 4) > 1.85) m = MAT.rock;
          if (m === MAT.grass) {
            if (sample(flatM, x, y) > .6 && x > court.x0 && x < court.x1 && y > court.y0 && y < court.y1) m = MAT.stone;
            else if (Math.hypot(x - L.ruin[0], y - L.ruin[1]) < 5.4) m = MAT.stone;
            else if (sample(trailM, x, y) > .5) m = MAT.trail;
            else if (sample(forestM, x, y) > .5) m = MAT.forest;
          }
          out[k] = h; mat[k] = m;
        }
      }
      if (onProgress) { onProgress(0.75 * Math.min(1, (r0 + rows) / nr)); await new Promise(res => setTimeout(res, 0)); }
    }

    // A coarse copy of the ground before trunks and columns, for distant rendering.
    const cs = 16, cn = Math.floor((nc - 1) / cs) + 1;
    const coarse = { n: cn, step: cs * dx, h: new Float32Array(cn * cn), mat: new Uint8Array(cn * cn) };
    for (let j = 0; j < cn; j++) for (let i = 0; i < cn; i++) { const k = (j * cs) * nc + i * cs; coarse.h[j * cn + i] = out[k]; coarse.mat[j * cn + i] = mat[k]; }

    const idx = (x, y) => [Math.round((x - ox + sx) / dx), Math.round((y - oy + sy) / dy)];
    const at = (x, y) => { const [c, r] = idx(x, y); return out[Math.max(0, Math.min(nr - 1, r)) * nc + Math.max(0, Math.min(nc - 1, c))]; };
    const clearAt = (x, y, need) => sample(clearM, x, y) < need;

    // Boulders: rounded mounds the robot has to walk around.
    const boulders = [];
    const nb = Math.round(46 * p.rocks);
    for (let t = 0; t < nb * 8 && boulders.length < nb; t++) {
      const x = -26 + R() * 52, y = -26 + R() * 52;
      if (!clearAt(x, y, .05) || Math.abs(y - yr(x)) < 8) continue;
      const rad = .4 + R() * .55, hh = .18 + R() * .3;
      if (boulders.some(b => Math.hypot(b.x - x, b.y - y) < b.r + rad + .8)) continue;
      boulders.push({ x, y, r: rad, h: hh });
    }
    for (const b of boulders) {
      const [c0, r0] = idx(b.x - b.r, b.y - b.r), [c1, r1] = idx(b.x + b.r, b.y + b.r);
      for (let r = Math.max(0, r0); r <= Math.min(nr - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(nc - 1, c1); c++) {
        const x = ox - sx + c * dx, y = oy - sy + r * dy, q = Math.hypot((x - b.x) / b.r, (y - b.y) / b.r);
        if (q < 1) { const k = r * nc + c; out[k] += b.h * Math.sqrt(1 - q * q) * (0.85 + 0.15 * vnoise(x * 3, y * 3, p.seed + 5)); mat[k] = MAT.rock; }
      }
    }
    if (onProgress) onProgress(.82);

    // Tree trunks and ruin columns: tall cylinders, solid to the robot.
    const trees = [], columns = [];
    const nt = Math.round(130 * p.forest);
    for (let t = 0; t < nt * 10 && trees.length < nt; t++) {
      const x = -30 + R() * 60, y = -30 + R() * 60;
      const fm = sample(forestM, x, y);
      if (R() > fm * .95 + .015 || !clearAt(x, y, .04)) continue;
      if (trees.some(o => Math.hypot(o.x - x, o.y - y) < 1.6) || boulders.some(o => Math.hypot(o.x - x, o.y - y) < o.r + 1)) continue;
      trees.push({ x, y, r: .11 + R() * .08, h: 1.7 + R() * .7, crown: .9 + R() * .7, z: at(x, y) });
    }
    for (let i = 0; i < 9; i++) { if (i === 2 || i === 6) continue; const a = i / 9 * Math.PI * 2 + .3; columns.push({ x: L.ruin[0] + 4.6 * Math.cos(a), y: L.ruin[1] + 4.6 * Math.sin(a), r: .28, h: .6 + R() * 1.1, z: at(L.ruin[0], L.ruin[1]) }); }
    for (const o of trees.concat(columns)) {
      const [c0, r0] = idx(o.x - o.r, o.y - o.r), [c1, r1] = idx(o.x + o.r, o.y + o.r);
      for (let r = Math.max(0, r0); r <= Math.min(nr - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(nc - 1, c1); c++) {
        const x = ox - sx + c * dx, y = oy - sy + r * dy;
        if (Math.hypot(x - o.x, y - o.y) < o.r) { const k = r * nc + c; out[k] = Math.max(out[k], o.z + o.h); mat[k] = o.crown ? MAT.bark : MAT.column; }
      }
    }
    if (onProgress) onProgress(.9);

    // To MuJoCo's normalised heightfield units.
    let clipped = 0;
    for (let k = 0; k < out.length; k++) { let v = (out[k] - oz) / sz; if (v < 0) { v = 0; clipped++; } else if (v > 1) { v = 1; clipped++; } out[k] = v; }
    if (onProgress) onProgress(1);

    const warnings = [];
    if (p.steep > TRAINED.steep) warnings.push(`The steep face is ${p.steep}°; the networks were trained on slopes up to ${TRAINED.steep}°.`);
    if (p.riser > TRAINED.riser + 1e-9) warnings.push(`Stair steps are ${Math.round(p.riser * 100)} cm; the networks met steps up to ${TRAINED.riser * 100} cm.`);
    if (rockH > TRAINED.block + 1e-9) warnings.push(`Scree stones reach ${Math.round(rockH * 100)} cm; training blocks were at most ${TRAINED.block * 100} cm.`);
    return { params: p, landmarks: L, trees, columns, boulders, mat, coarse, clipped, warnings, ridgeY: yr, section, MAT };
  }

  root.FiaWorld = { generate, DEFAULTS, TRAINED, landmarks, MAT, vnoise, hash };
})(typeof globalThis !== 'undefined' ? globalThis : this);
