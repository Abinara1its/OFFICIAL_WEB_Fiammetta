// Endless world generator for the project page.
//
// A world is a pure function of its seed and kind: the height of the ground at any point, its
// material, and the solid objects standing on it (trunks, machines, racks, debris). Nothing is
// stored. The page streams the part around the robot into the simulator's heightfield, so that
// what is drawn is what the feet meet: the drawn ground is the same `surface` function, and every
// solid is drawn from the same numbers that are written into the physics.
//
// Space is divided into 24 m cells. Each cell holds at most one site (a stair, a slope, a block
// field, a court...), well inside the cell, and a scatter of objects. The cell borders are kept
// clear as routes, so every cell can be reached. The cells around the origin hold the sites the
// tour needs; beyond them, sites are drawn from the seed.
(function (root) {
  'use strict';

  const S = 24;                       // m, cell size
  const DEFAULTS = { env: 'valley', seed: 7, relief: 1, rough: 1, clutter: 1, riser: 0.08, steep: 20 };
  // What the networks met in training: slopes up to 20 deg, blocks up to 8 cm, steps up to 10 cm.
  const TRAINED = { steep: 20, riser: 0.10, block: 0.08 };

  // Materials, shared with the renderer's palette.
  const MAT = { grass: 0, trail: 1, rock: 2, stone: 3, bark: 4, forest: 5, column: 6, concrete: 7, paint: 8,
    steel: 9, rack: 10, machine: 11, dust: 12, rubble: 13, slab: 14, rust: 15, wood: 16, tile: 17, canvas: 18, asphalt: 19 };
  const SOLID = new Set([MAT.bark, MAT.column, MAT.steel, MAT.rack, MAT.machine, MAT.rust, MAT.wood, MAT.canvas]);

  function hash(i, j, seed) { let h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(seed | 0, 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vnoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  }
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 | 0; s ^= s >>> 13; return ((s >>> 0) % 1e9) / 1e9; }; }
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const rectD = (u, v, a, b) => Math.hypot(Math.max(Math.abs(u) - a, 0), Math.max(Math.abs(v) - b, 0));

  // ---------------------------------------------------------------- the kinds of world
  // Each kind gives the ground between sites, the colours of its sky, and the names of its places.
  const ENVS = {
    valley: {
      name: 'Valley', blurb: 'Meadows, woods, scree and terraces with stone stairs.',
      base: 'Camp', baseName: 'The Camp',
      names: { slope: 'Meadow hill', stairs: 'Terrace stair', steep: 'Grass face', court: 'Stone court', guard: 'Ruin',
        blocks: 'Scree field', crater: 'Hollow', ramp: 'Long ramp', open: 'Meadow', base: 'The Camp' },
      random: [['stairs', 3], ['steep', 2], ['blocks', 3], ['slope', 2], ['ramp', 2], ['guard', 1], ['crater', 1], ['open', 3]],
    },
    factory: {
      name: 'Factory floor', blurb: 'Machine halls, cable bridges and steel stairs to mezzanines.',
      base: 'Control room', baseName: 'Control room',
      names: { slope: 'Loading ramp', stairs: 'Mezzanine stair', steep: 'Service ramp', court: 'Test bay', guard: 'Press shop',
        blocks: 'Cable bridges', crater: 'Pit', ramp: 'Loading ramp', open: 'Machine hall', base: 'Control room' },
      random: [['stairs', 3], ['steep', 1], ['blocks', 3], ['ramp', 2], ['open', 6]],
    },
    warehouse: {
      name: 'Warehouse', blurb: 'Rack aisles, dock ramps, speed bumps and mezzanine stairs.',
      base: 'Dispatch', baseName: 'Dispatch office',
      names: { slope: 'Dock ramp', stairs: 'Mezzanine stair', steep: 'Steep dock ramp', court: 'Staging area', guard: 'Cold store',
        blocks: 'Speed bumps', crater: 'Pit', ramp: 'Dock ramp', open: 'Rack aisles', base: 'Dispatch office' },
      random: [['stairs', 2], ['ramp', 2], ['blocks', 2], ['steep', 1], ['open', 8]],
    },
    rescue: {
      name: 'Disaster site', blurb: 'Collapsed slabs, rubble, broken stairs and craters, for search and rescue.',
      base: 'Command post', baseName: 'Command post',
      names: { slope: 'Fallen slab', stairs: 'Broken stair', steep: 'Collapsed slab', court: 'Cleared lot', guard: 'Triage area',
        blocks: 'Rubble field', crater: 'Crater', ramp: 'Debris ramp', open: 'Debris', base: 'Command post' },
      random: [['stairs', 2], ['steep', 3], ['blocks', 4], ['crater', 2], ['slope', 2], ['open', 3]],
    },
  };

  /**
   * Creates a world. opts: { dx: sample spacing of the simulator's heightfield (m),
   * zlo, zhi: the heightfield's height range (m) }.
   */
  function create(params, opts) {
    const p = Object.assign({}, DEFAULTS, params || {});
    const env = ENVS[p.env] || ENVS.valley;
    const seed = p.seed | 0, kind = p.env;
    const dx = opts.dx, zlo = opts.zlo + 0.02, zhi = opts.zhi - 0.02;
    const R0 = rng(1);

    // ---------------------------------------------------------- ground between the sites
    let MATOUT = 0;
    function base(x, y, db) {
      // db: distance to the nearest cell border, where the routes run.
      if (kind === 'valley') {
        const n = (vnoise(x / 19, y / 19, seed) - .5) * .9 + (vnoise(x / 6.5, y / 6.5, seed + 1) - .5) * .18;
        const fine = (vnoise(x / 1.8, y / 1.8, seed + 2) - .5) * .05;
        const trail = 1 - sstep(.9, 1.8, db + (vnoise(x / 3, y / 3, seed + 4) - .5) * 1.2);
        const fo = vnoise(x / 30, y / 30, seed + 5);
        MATOUT = trail > .5 ? MAT.trail : fo > .58 ? MAT.forest : MAT.grass;
        return p.relief * n + fine * (1 - trail * .8);
      }
      if (kind === 'rescue') {
        const n = (vnoise(x / 16, y / 16, seed) - .5) * .5 + (vnoise(x / 5, y / 5, seed + 1) - .5) * .1;
        const lane = 1 - sstep(1.2, 2.2, db);
        const grit = (vnoise(x * 1.6, y * 1.6, seed + 2) - .5) * .035 * (1 - lane * .7);
        MATOUT = lane > .5 ? MAT.asphalt : vnoise(x / 7, y / 7, seed + 3) > .55 ? MAT.rubble : MAT.dust;
        return p.relief * n + grit * p.rough;
      }
      // Factory and warehouse: a concrete floor, flat to a few millimetres, with painted walkways.
      const w = Math.abs(db - 1.6);
      MATOUT = w < .06 ? MAT.paint : db < 1.6 ? MAT.tile : MAT.concrete;
      return (vnoise(x / 4, y / 4, seed) - .5) * .006;
    }

    // ---------------------------------------------------------- sites
    function plateau(o) {
      // A raised platform with one approach (stairs, a face or a ramp) on its low side. Local
      // frame: v uphill along the approach, u across it.
      const c = Math.cos(o.phi), s = Math.sin(o.phi);
      let L, R = o.R, n = 0;
      if (o.kind === 'stairs') { n = Math.max(1, Math.round(R / o.riser)); R = n * o.riser; L = n * o.tread; }
      else L = R / Math.tan(o.angle * Math.PI / 180);
      const a = o.a, b = o.b, aw = o.aw, cw = .25;
      const Tx = o.cx + c * L / 2, Ty = o.cy + s * L / 2;
      const ext = { a: Math.max(a, aw), b: b + L / 2 };
      const flat0 = 1.0, flat1 = 3.0;
      const jag = o.jag || 0, risers = [];
      if (n) for (let k = 0; k < n; k++) risers.push(k === n - 1 ? R : Math.min(R, Math.max(0, (k + 1) * o.riser + (o.jitter ? (hash(k, 3, seed + o.id) - .5) * 2 * o.jitter : 0))));
      const site = {
        type: o.type, cx: o.cx, cy: o.cy, phi: o.phi, R, L, n, riser: o.riser, angle: o.angle, kind: o.kind,
        r: Math.hypot(ext.a, ext.b) + flat0 + flat1 + .5,
        lm: { foot: [Tx - c * (b + L + 2.2), Ty - s * (b + L + 2.2)], top: [Tx, Ty], centre: [o.cx, o.cy] }, yaw: o.phi,
        fn(x, y, h0) {
          const X = x - Tx, Y = y - Ty, u = -X * s + Y * c, v = X * c + Y * s;
          // Flatten the surroundings to the site's own level.
          const ue = u, ve = v + L / 2;
          const f = 1 - sstep(flat0, flat0 + flat1, rectD(ue, ve, ext.a, ext.b));
          let h = h0 * (1 - f) + this.bz * f;
          const fall = d => 1 - sstep(0, cw, d);
          const j = jag ? (vnoise(u * 2.2 + 9, v * 2.2, seed + o.id) - .5) * jag : 0;
          const dT = rectD(u, v, a + j, b + j);
          const top = R * fall(dT);
          const dd = Math.min(L, Math.max(0, v + b + L));
          let pr;
          if (n) { const k = Math.min(n - 1, Math.floor(dd / o.tread)); pr = risers[k]; } else pr = R * dd / L;
          const dA = rectD(u, v + b + L / 2, aw, L / 2);
          const app = pr * fall(dA);
          const val = Math.max(top, app);
          if (dT <= 0) MATOUT = o.matTop; else if (dA <= 0) MATOUT = o.matApp; else if (val > .02) MATOUT = o.matSide;
          return h + val;
        },
      };
      site.solids = [];
      if (o.rails) {
        // Railings: 6 cm by 1 m, along the top's open edges, leaving the approach free.
        const rail = (u0, v0, u1, v1) => {
          const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2, len = Math.hypot(u1 - u0, v1 - v0);
          const wx = Tx + c * mv - s * mu, wy = Ty + s * mv + c * mu;
          const rot = Math.atan2(s * (v1 - v0) + c * (u1 - u0), c * (v1 - v0) - s * (u1 - u0));
          site.solids.push({ k: 'box', x: wx, y: wy, hx: len / 2, hy: .03, rot, H: 1.0, onTop: R, mat: MAT.steel, look: 'rail' });
        };
        rail(-a + .05, -b + .05, -a + .05, b - .05); rail(a - .05, -b + .05, a - .05, b - .05); rail(-a + .05, b - .05, a - .05, b - .05);
        rail(-a + .05, -b + .05, -aw - .05, -b + .05); rail(aw + .05, -b + .05, a - .05, -b + .05);
      }
      return site;
    }
    function hill(o) {
      const sig2 = 2 * o.sig * o.sig;
      return { type: o.type, cx: o.cx, cy: o.cy, r: o.sig * 3.2, yaw: o.phi,
        lm: { foot: [o.cx - Math.cos(o.phi) * o.sig * 2.1, o.cy - Math.sin(o.phi) * o.sig * 2.1], top: [o.cx, o.cy], centre: [o.cx, o.cy] }, solids: [],
        fn(x, y, h0) { const d2 = (x - o.cx) ** 2 + (y - o.cy) ** 2; const e = Math.exp(-d2 / sig2); if (e > .55 && o.matTop !== undefined) MATOUT = o.matTop; return h0 + o.A * e; } };
    }
    function field(o) {
      // A rectangle of small terrain features: blocks, rubble, bumps or cable bridges.
      const c = Math.cos(o.phi), s = Math.sin(o.phi);
      return { type: o.type, cx: o.cx, cy: o.cy, r: Math.hypot(o.a, o.b) + 1.5, yaw: o.phi, H: o.H,
        lm: { foot: [o.cx - c * (o.b + 2), o.cy - s * (o.b + 2)], top: [o.cx + c * (o.b - 1), o.cy + s * (o.b - 1)], centre: [o.cx, o.cy] }, solids: [],
        fn(x, y, h0) {
          const X = x - o.cx, Y = y - o.cy, u = -X * s + Y * c, v = X * c + Y * s;
          const m = 1 - sstep(0, 1.0, rectD(u, v, o.a, o.b));
          if (m <= 0) return h0;
          let add = 0;
          if (o.kind === 'blocks') add = hash(Math.floor(u / o.bs), Math.floor(v / o.bs), seed + o.id) * o.H;
          else if (o.kind === 'rubble') add = (.65 * hash(Math.floor(u / o.bs), Math.floor(v / o.bs), seed + o.id) + .35 * hash(Math.floor(u / (o.bs * .5)) + 7, Math.floor(v / (o.bs * .5)), seed + o.id)) * o.H;
          else if (o.kind === 'bumps') { const per = 1.7, vm = ((v % per) + per) % per - per / 2, w = .32; add = Math.abs(vm) < w / 2 ? o.H * (1 - (2 * vm / w) ** 2) : 0; }
          else if (o.kind === 'grate') add = hash(Math.floor(u / 1.2), Math.floor(v / .9), seed + o.id) > .5 ? o.H : 0;
          if (m > .5) MATOUT = o.mat;
          return h0 + add * m;
        } };
    }
    function crater(o) {
      return { type: o.type, cx: o.cx, cy: o.cy, r: o.rad + 1, yaw: 0, lm: { foot: [o.cx - o.rad - 1.5, o.cy], top: [o.cx, o.cy], centre: [o.cx, o.cy] }, solids: [],
        fn(x, y, h0) { const d = Math.hypot(x - o.cx, y - o.cy); if (d > o.rad) return h0; const k = 1 - sstep(o.rad * .35, o.rad, d); if (k > .3) MATOUT = o.mat; return h0 - o.D * k; } };
    }
    function flatSite(o) {
      // A level area: a court, the base, the guardian's ground.
      const c = Math.cos(o.phi || 0), s = Math.sin(o.phi || 0);
      return { type: o.type, cx: o.cx, cy: o.cy, r: Math.hypot(o.a, o.b) + 4.5, yaw: o.phi || 0,
        lm: { foot: [o.cx - c * (o.a - 1.2), o.cy - s * (o.a - 1.2)], top: [o.cx + c * (o.a - 1.2), o.cy + s * (o.a - 1.2)], centre: [o.cx, o.cy] }, solids: [],
        fn(x, y, h0) {
          const X = x - o.cx, Y = y - o.cy, u = X * c + Y * s, v = -X * s + Y * c;
          const d = o.round ? Math.max(0, Math.hypot(u, v) - o.a) : rectD(u, v, o.a, o.b);
          const f = 1 - sstep(.5, 4, d);
          if (d <= 0 && o.mat !== undefined) MATOUT = o.mat;
          return h0 * (1 - f) + this.bz * f;
        } };
    }

    // ---------------------------------------------------------- what a site of each type is, per kind of world
    const ground = { valley: [MAT.stone, MAT.stone, MAT.rock], factory: [MAT.steel, MAT.steel, MAT.steel], warehouse: [MAT.concrete, MAT.steel, MAT.steel], rescue: [MAT.slab, MAT.slab, MAT.rubble] }[kind];
    // Treads by Blondel's rule, 2 risers + 1 tread = 0.63 m, as on the flights the controllers were
    // trained and evaluated on (10/43, 12/39, 15/33 cm).
    const blondel = r => Math.max(.26, .63 - 2 * r);
    function makeSite(type, cx, cy, phi, id, Rn) {
      const indoor = kind === 'factory' || kind === 'warehouse';
      if (type === 'stairs') return plateau({ type, cx, cy, phi, id, kind: 'stairs', R: indoor ? 1.0 : 0.8 + Rn() * .5, riser: p.riser, tread: blondel(p.riser), a: indoor ? 3.2 : 3, b: indoor ? 2.4 : 2.6, aw: indoor ? 1.0 : 1.4,
        matTop: indoor ? MAT.steel : kind === 'rescue' ? MAT.slab : MAT.grass, matApp: ground[0], matSide: ground[2], rails: indoor, jitter: kind === 'rescue' ? .02 : 0, jag: kind === 'rescue' ? .6 : 0 });
      if (type === 'steep') return plateau({ type, cx, cy, phi, id, kind: 'face', R: indoor ? 1.0 : 1.2, angle: p.steep, a: 3, b: 2.6, aw: indoor ? 1.3 : 3,
        matTop: indoor ? MAT.steel : kind === 'rescue' ? MAT.slab : MAT.grass, matApp: kind === 'valley' ? MAT.grass : ground[1], matSide: ground[2], rails: indoor, jag: kind === 'rescue' ? .7 : 0 });
      if (type === 'ramp') return plateau({ type, cx, cy, phi, id, kind: 'face', R: 1.0, angle: kind === 'warehouse' ? 8 : 10, a: 3, b: 2.4, aw: 1.6,
        matTop: indoor ? MAT.concrete : kind === 'rescue' ? MAT.slab : MAT.grass, matApp: indoor ? MAT.steel : kind === 'rescue' ? MAT.slab : MAT.trail, matSide: ground[2], rails: indoor, jag: kind === 'rescue' ? .5 : 0 });
      if (type === 'slope') {
        if (kind === 'valley') return hill({ type, cx, cy, phi, A: 0.9 * Math.max(.4, p.relief), sig: 4.4 });
        return plateau({ type, cx, cy, phi, id, kind: 'face', R: .9, angle: 10, a: 3, b: 2.4, aw: kind === 'rescue' ? 3 : 1.6, matTop: kind === 'rescue' ? MAT.slab : MAT.concrete, matApp: kind === 'rescue' ? MAT.slab : MAT.steel, matSide: ground[2], rails: kind !== 'rescue', jag: kind === 'rescue' ? .6 : 0 });
      }
      if (type === 'blocks') {
        if (kind === 'factory') return field({ type, cx, cy, phi, id, kind: Rn() < .5 ? 'bumps' : 'grate', H: Rn() < .5 ? .04 : .025, a: 5, b: 5, mat: MAT.steel });
        if (kind === 'warehouse') return field({ type, cx, cy, phi, id, kind: 'bumps', H: .05, a: 5, b: 5, mat: MAT.paint });
        if (kind === 'rescue') return field({ type, cx, cy, phi, id, kind: 'rubble', H: .08 * p.rough, bs: .32, a: 5, b: 5, mat: MAT.rubble });
        return field({ type, cx, cy, phi, id, kind: 'blocks', H: .06 * p.rough, bs: .30, a: 5, b: 5, mat: MAT.rock });
      }
      if (type === 'crater') return crater({ type, cx, cy, D: kind === 'rescue' ? .8 : .6, rad: 5.5, mat: kind === 'rescue' ? MAT.rubble : MAT.rock });
      if (type === 'court') return flatSite({ type, cx, cy, phi, a: 7.5, b: 4.5, mat: kind === 'valley' ? MAT.stone : kind === 'rescue' ? MAT.asphalt : MAT.paint });
      if (type === 'guard') {
        const g = flatSite({ type, cx, cy, a: 5, b: 5, round: true, mat: kind === 'valley' ? MAT.stone : kind === 'rescue' ? MAT.asphalt : MAT.tile });
        for (let i = 0; i < 9; i++) {
          const ang = i / 9 * Math.PI * 2 + .3, x = cx + 6.1 * Math.cos(ang), y = cy + 6.1 * Math.sin(ang);
          if (kind === 'valley') { if (i !== 2 && i !== 6) g.solids.push({ k: 'cyl', x, y, r: .28, H: .6 + Rn() * 1.1, mat: MAT.column, look: 'column', onTop: 0 }); }
          else if (kind === 'rescue') { if (i % 3 === 0) g.solids.push({ k: 'pyr', x, y, r: 1.0, rot: ang, H: 1.3, mat: MAT.canvas, look: 'tent', onTop: 0 }); }
          else if (i % 2 === 0) g.solids.push({ k: 'box', x, y, hx: .7, hy: .6, rot: ang, H: kind === 'factory' ? 1.8 : 1.2, mat: kind === 'factory' ? MAT.machine : MAT.wood, look: kind === 'factory' ? 'machine' : 'pallet', hue: Rn(), onTop: 0 });
        }
        return g;
      }
      if (type === 'base') return flatSite({ type, cx, cy, a: 8, b: 8, round: true, mat: kind === 'valley' ? undefined : kind === 'rescue' ? MAT.asphalt : MAT.tile });
      return null;
    }

    // The cells around the origin carry the tour; each faces the base cell.
    const STARTER = { '0,0': ['base', 0], '1,0': ['slope', 0], '0,1': ['stairs', Math.PI / 2], '-1,0': ['steep', Math.PI], '0,-1': ['court', 0], '1,1': ['guard', 0],
      '-1,-1': ['blocks', 0], '1,-1': ['blocks', 0], '-1,1': ['ramp', Math.PI / 2] };

    // ---------------------------------------------------------- cells
    const cells = new Map();
    function cellAt(ci, cj) {
      const key = ci * 100003 + cj;
      let C = cells.get(key);
      if (C) return C;
      if (cells.size > 4000) cells.clear();
      C = buildCell(ci, cj);
      cells.set(key, C);
      return C;
    }
    function buildCell(ci, cj) {
      const R = rng(Math.floor(hash(ci, cj, seed) * 4e9) + 1);
      const x0 = ci * S, y0 = cj * S, cx = x0 + S / 2, cy = y0 + S / 2;
      const st = STARTER[ci + ',' + cj];
      let type = null, phi = 0;
      if (st) { type = st[0]; phi = st[1]; }
      else {
        const list = ENVS[kind].random, tot = list.reduce((a, b) => a + b[1], 0);
        let t = R() * tot; for (const [k, w] of list) { if ((t -= w) <= 0) { type = k; break; } }
        phi = Math.floor(R() * 4) * Math.PI / 2;
        if (type === 'open') type = null;
      }
      const jit = st ? 0 : 1.5;
      const scx = cx + (R() - .5) * 2 * jit, scy = cy + (R() - .5) * 2 * jit;
      const site = type ? makeSite(type, scx, scy, phi, (ci * 31 + cj * 17) & 1023, R) : null;
      const C = { ci, cj, x0, y0, cx, cy, site, solids: [], mounds: [], decor: [], name: gridName(ci, cj) };
      if (site) {
        MATOUT = 0; site.bz = base(site.cx, site.cy, 99);
        site.name = ENVS[kind].names[type] || type; site.grid = C.name;
        for (const o of site.solids) o.z0 = o.onTop ? site.bz + o.onTop : undefined;
      }
      scatter(C, R, st);
      for (const o of solidsOf(C)) if (o.z0 === undefined) o.z0 = surfaceAt(o.x, o.y, C);
      for (const o of solidsOf(C)) o.top = Math.min(zhi, o.z0 + o.H);
      return C;
    }
    // A grid reference from the base cell, in cells east or west and north or south.
    function gridName(ci, cj) { return (ci < 0 ? 'W' + -ci : 'E' + ci) + ' ' + (cj < 0 ? 'S' + -cj : 'N' + cj); }
    // Free of the routes and of the site, with room around it.
    function freeAt(C, x, y, rad) {
      const bx = x - C.x0, by = y - C.y0;
      if (Math.min(bx, S - bx, by, S - by) < 2.2 + rad) return false;
      const s = C.site; if (s && Math.hypot(x - s.cx, y - s.cy) < s.r + rad + .3) return false;
      for (const o of C.solids) { const rr = o.k === 'cyl' || o.k === 'pyr' ? o.r : Math.hypot(o.hx, o.hy); if (Math.hypot(x - o.x, y - o.y) < rr + rad + 1.0) return false; }
      for (const m of C.mounds) if (Math.hypot(x - m.x, y - m.y) < m.r + rad + .8) return false;
      return true;
    }
    function scatter(C, R, starter) {
      const k = p.clutter, base0 = starter && starter[0] === 'base';
      const add = (o, tries) => { for (let t = 0; t < (tries || 12); t++) { const x = C.x0 + 2.5 + R() * (S - 5), y = C.y0 + 2.5 + R() * (S - 5); const rad = o.k === 'box' ? Math.hypot(o.hx, o.hy) : o.r; if (freeAt(C, x, y, rad)) { o.x = x; o.y = y; C.solids.push(o); return o; } } return null; };
      if (kind === 'valley') {
        const fo = vnoise(C.cx / 30, C.cy / 30, seed + 5);
        const nt = Math.round(k * (fo > .58 ? 26 : fo > .45 ? 8 : 2) * (base0 ? .2 : 1));
        for (let i = 0; i < nt; i++) { const r = .12 + R() * .08; const t = add({ k: 'cyl', r, H: 2.2 + R() * .8, mat: MAT.bark, look: 'tree', crown: .9 + R() * .7, hue: R() }); }
        const nb = Math.round(k * 4 * R());
        for (let i = 0; i < nb; i++) for (let t = 0; t < 10; t++) { const x = C.x0 + 3 + R() * (S - 6), y = C.y0 + 3 + R() * (S - 6), r = .45 + R() * .5; if (freeAt(C, x, y, r)) { C.mounds.push({ x, y, r, h: .15 + R() * .3, mat: MAT.rock }); break; } }
        if (base0) {
          // Tents at the camp: square pyramids, solid to the robot.
          [[-4.5, 3.2, .5], [-1.2, 5.2, -.3], [4.6, 4.2, .9]].forEach(([u, v, a]) => C.solids.push({ k: 'pyr', x: C.cx + u, y: C.cy + v, r: 1.0, rot: a, H: 1.3, mat: MAT.canvas, look: 'tent' }));
        }
      } else if (kind === 'factory') {
        // Hall columns at the corner of every cell, beside the walkways.
        C.solids.push({ k: 'box', x: C.x0 + 2.4, y: C.y0 + 2.4, hx: .2, hy: .2, rot: 0, H: 2.6, mat: MAT.steel, look: 'column' });
        const nm = Math.round(k * (C.site ? 2 : 6) * (base0 ? .3 : 1));
        for (let i = 0; i < nm; i++) { const w = 1.2 + R() * 1.8, d = .8 + R() * 1.2; add({ k: 'box', hx: w / 2, hy: d / 2, rot: R() < .5 ? 0 : Math.PI / 2, H: .9 + R() * 1.1, mat: MAT.machine, look: 'machine', hue: R() }); }
        if (!C.site && R() < .5) { const along = R() < .5; add({ k: 'box', hx: along ? 5 : .45, hy: along ? .45 : 5, rot: 0, H: .85, mat: MAT.machine, look: 'conveyor' }, 20); }
        if (base0) C.solids.push({ k: 'box', x: C.cx + 4.5, y: C.cy + 4.5, hx: 1.6, hy: 1.2, rot: 0, H: 2.4, mat: MAT.steel, look: 'booth' });
      } else if (kind === 'warehouse') {
        C.solids.push({ k: 'box', x: C.x0 + 2.4, y: C.y0 + 2.4, hx: .18, hy: .18, rot: 0, H: 2.6, mat: MAT.steel, look: 'column' });
        if (!C.site && !base0) {
          // Rack rows with 3.2 m aisles.
          const along = R() < .5, len = 13 + R() * 4, rows = 3;
          for (let i = 0; i < rows; i++) { const off = (i - (rows - 1) / 2) * 4.4; const o = { k: 'box', hx: along ? len / 2 : .55, hy: along ? .55 : len / 2, rot: 0, H: 2.4, mat: MAT.rack, look: 'rack', hue: R() };
            o.x = C.cx + (along ? 0 : off); o.y = C.cy + (along ? off : 0); C.solids.push(o); }
        }
        const np = Math.round(k * (C.site ? 2 : 3));
        for (let i = 0; i < np; i++) add({ k: 'box', hx: .6, hy: .4, rot: R() < .5 ? 0 : Math.PI / 2, H: .15 + Math.floor(R() * 3) * .5, mat: MAT.wood, look: 'pallet', hue: R() });
        if (base0) C.solids.push({ k: 'box', x: C.cx + 4.5, y: C.cy + 4.5, hx: 2, hy: 1.4, rot: 0, H: 2.5, mat: MAT.steel, look: 'booth' });
      } else {
        const nd = Math.round(k * (C.site ? 5 : 12) * (base0 ? .2 : 1));
        for (let i = 0; i < nd; i++) { const s = .25 + R() * .45; add({ k: 'box', hx: s, hy: s * (.5 + R() * .7), rot: R() * Math.PI, H: .2 + R() * .55, mat: MAT.rust, look: 'debris', hue: R() }); }
        const nw = Math.round(k * (C.site ? 1 : 3) * (base0 ? 0 : 1));
        for (let i = 0; i < nw; i++) add({ k: 'box', hx: 1 + R() * 1.5, hy: .13, rot: Math.floor(R() * 2) * Math.PI / 2 + (R() - .5) * .3, H: .8 + R() * 1.2, mat: MAT.rust, look: 'wall' });
        const nm = Math.round(k * 5 * R());
        for (let i = 0; i < nm; i++) for (let t = 0; t < 10; t++) { const x = C.x0 + 3 + R() * (S - 6), y = C.y0 + 3 + R() * (S - 6), r = .6 + R() * .9; if (freeAt(C, x, y, r)) { C.mounds.push({ x, y, r, h: .12 + R() * .2, mat: MAT.rubble }); break; } }
        if (base0) [[-4.5, 3.6, 0], [3.8, 4.4, .4]].forEach(([u, v, a]) => C.solids.push({ k: 'pyr', x: C.cx + u, y: C.cy + v, r: 1.1, rot: a, H: 1.4, mat: MAT.canvas, look: 'tent' }));
      }
    }

    // ---------------------------------------------------------- the height functions
    // The walkable ground, without solids: what the renderer draws and what stands on.
    function surfaceAt(x, y, Cgiven) {
      const ci = Math.floor(x / S), cj = Math.floor(y / S);
      const C = Cgiven && Cgiven.ci === ci && Cgiven.cj === cj ? Cgiven : cellAt(ci, cj);
      const bx = x - C.x0, by = y - C.y0;
      let h = base(x, y, Math.min(bx, S - bx, by, S - by));
      const s = C.site;
      if (s && s.bz !== undefined) { const ddx = x - s.cx, ddy = y - s.cy; if (ddx * ddx + ddy * ddy < s.r * s.r) h = s.fn(x, y, h); }
      for (let i = 0; i < C.mounds.length; i++) { const m = C.mounds[i]; const q2 = ((x - m.x) ** 2 + (y - m.y) ** 2) / (m.r * m.r); if (q2 < 1) { h += m.h * Math.sqrt(1 - q2) * (.85 + .15 * vnoise(x * 3, y * 3, seed + 5)); MATOUT = m.mat; } }
      return Math.min(zhi, Math.max(zlo, h));
    }
    // A solid's height at a point, or -Infinity outside it.
    function solidAt(o, x, y) {
      const X = x - o.x, Y = y - o.y;
      if (o.k === 'cyl') return X * X + Y * Y <= o.r * o.r ? o.top : -Infinity;
      const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0), u = X * c + Y * s, v = -X * s + Y * c;
      if (o.k === 'pyr') { const q = Math.max(Math.abs(u), Math.abs(v)) / o.r; return q < 1 ? o.z0 + (o.top - o.z0) * (1 - q) : -Infinity; }
      return Math.abs(u) <= o.hx && Math.abs(v) <= o.hy ? o.top : -Infinity;
    }
    // Everything the feet can meet, solids included.
    function heightAt(x, y) {
      const C = cellAt(Math.floor(x / S), Math.floor(y / S));
      let h = surfaceAt(x, y, C);
      for (const o of C.solids) h = Math.max(h, solidAt(o, x, y));
      for (const o of C.site ? C.site.solids : []) h = Math.max(h, solidAt(o, x, y));
      return h;
    }
    function matAt(x, y) { surfaceAt(x, y); return MATOUT; }

    // ---------------------------------------------------------- chunks for the simulator
    // A chunk is CH x CH samples of the global grid x = i dx, y = j dx. Generated in slices.
    const CH = opts.CH || 320;
    function* chunkJob(kx, ky) {
      const n = CH * CH, h = new Float32Array(n), mat = new Uint8Array(n);
      const gx0 = kx * CH, gy0 = ky * CH;
      for (let r = 0; r < CH; r++) {
        const y = (gy0 + r) * dx;
        let C = null, lastCi = 1e9;
        for (let c = 0; c < CH; c++) {
          const x = (gx0 + c) * dx, ci = Math.floor(x / S);
          if (ci !== lastCi) { C = cellAt(ci, Math.floor(y / S)); lastCi = ci; }
          h[r * CH + c] = surfaceAt(x, y, C); mat[r * CH + c] = MATOUT;
        }
        if ((r & 15) === 15) yield r / CH;
      }
      // Solids, from every cell that touches the chunk.
      const X0 = gx0 * dx, Y0 = gy0 * dx, X1 = (gx0 + CH - 1) * dx, Y1 = (gy0 + CH - 1) * dx;
      for (let ci = Math.floor(X0 / S); ci <= Math.floor(X1 / S); ci++) for (let cj = Math.floor(Y0 / S); cj <= Math.floor(Y1 / S); cj++) {
        const C = cellAt(ci, cj);
        for (const o of C.solids.concat(C.site ? C.site.solids : [])) {
          const rr = o.k === 'box' ? Math.hypot(o.hx, o.hy) : o.r * 1.42;
          const c0 = Math.max(0, Math.floor((o.x - rr) / dx) - gx0), c1 = Math.min(CH - 1, Math.ceil((o.x + rr) / dx) - gx0);
          const r0 = Math.max(0, Math.floor((o.y - rr) / dx) - gy0), r1 = Math.min(CH - 1, Math.ceil((o.y + rr) / dx) - gy0);
          for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const z = solidAt(o, (gx0 + c) * dx, (gy0 + r) * dx);
            if (z > h[r * CH + c]) { h[r * CH + c] = Math.min(zhi, z); mat[r * CH + c] = o.mat; }
          }
        }
      }
      return { h, mat, kx, ky };
    }
    function chunkSync(kx, ky) { const g = chunkJob(kx, ky); let r; do r = g.next(); while (!r.done); return r.value; }

    // ---------------------------------------------------------- for the renderer
    function cellsNear(x, y, rad) {
      const out = [];
      for (let ci = Math.floor((x - rad) / S); ci <= Math.floor((x + rad) / S); ci++)
        for (let cj = Math.floor((y - rad) / S); cj <= Math.floor((y + rad) / S); cj++) out.push(cellAt(ci, cj));
      return out;
    }
    function solidsOf(C) { return C.site ? C.solids.concat(C.site.solids) : C.solids; }

    const warnings = [];
    if (p.steep > TRAINED.steep) warnings.push(`Steep faces are ${p.steep}°; the networks were trained on slopes up to ${TRAINED.steep}°.`);
    if (p.riser > TRAINED.riser + 1e-9) warnings.push(`Stair steps are ${Math.round(p.riser * 100)} cm; the networks met steps up to ${TRAINED.riser * 100} cm.`);
    if ((kind === 'valley' ? .06 : kind === 'rescue' ? .08 : 0) * p.rough > TRAINED.block + 1e-9) warnings.push(`Block fields reach ${Math.round((kind === 'valley' ? 6 : 8) * p.rough)} cm; training blocks were at most ${TRAINED.block * 100} cm.`);

    // The tour's places, in world coordinates.
    const tour = {};
    const at = (ci, cj) => cellAt(ci, cj).site;
    tour.base = at(0, 0); tour.slope = at(1, 0); tour.stairs = at(0, 1); tour.steep = at(-1, 0); tour.court = at(0, -1); tour.guard = at(1, 1);
    const B = tour.base.lm.centre;
    tour.spawn = [B[0] - 3.5, B[1] - 3.0];
    tour.firstStep = [B[0] + 2.5, B[1] - 3.0];
    tour.workshop = [B[0] - 2.5, B[1] + 1.2];

    return { params: p, env, kind, seed, S, CH, dx, surfaceAt, heightAt, matAt, solidAt, cellAt, cellsNear, solidsOf, chunkJob, chunkSync, tour, warnings, SOLID, MAT,
      lastMat: () => MATOUT };
  }

  // ---------------------------------------------------------------- streaming into the heightfield
  // The simulator's heightfield is a fixed 8 x 8 chunk window. The 4 x 4 chunks around its centre
  // are kept filled with the world around the robot; the robot is kept in the central 2 x 2 by
  // moving the window a chunk at a time, together with the robot (a floating origin).
  function Streamer(world, hf, getView, opts) {
    const CH = world.CH, N = hf.nc / CH;
    if (hf.nc !== hf.nr || N !== 8) throw new Error('the scene heightfield must be 8 x 8 chunks');
    const dx = world.dx, cache = new Map(), jobs = new Map(), max = (opts && opts.cacheMax) || 64;
    const self = { kc: [0, 0], cache };
    const key = (a, b) => a + ',' + b;
    self.chunkSize = CH * dx;
    // world = sim + offset.
    self.offset = () => [(self.kc[0] - 4) * CH * dx - (hf.ox - hf.sx), (self.kc[1] - 4) * CH * dx - (hf.oy - hf.sy)];
    self.toSim = (X, Y) => { const o = self.offset(); return [X - o[0], Y - o[1]]; };
    self.toWorld = (x, y) => { const o = self.offset(); return [x + o[0], y + o[1]]; };
    self.chunkOf = (X, Y) => [Math.floor(X / self.chunkSize), Math.floor(Y / self.chunkSize)];
    self.active = kc => { const out = []; for (let j = -2; j <= 1; j++) for (let i = -2; i <= 1; i++) out.push([kc[0] + i, kc[1] + j]); return out; };
    self.ring = kc => { const out = []; for (let j = -3; j <= 2; j++) for (let i = -3; i <= 2; i++) out.push([kc[0] + i, kc[1] + j]); return out; };
    self.has = (a, b) => cache.has(key(a, b));
    self.add = v => put(v);
    function put(v) { cache.set(key(v.kx, v.ky), v); v.used = performance.now(); if (cache.size > max) { let old = null; for (const [k, c] of cache) if (!old || c.used < old[1].used) old = [k, c]; const keep = new Set(self.ring(self.kc).map(q => key(q[0], q[1]))); if (old && !keep.has(old[0])) cache.delete(old[0]); } }
    self.get = (a, b) => { let c = cache.get(key(a, b)); if (!c) { jobs.delete(key(a, b)); c = world.chunkSync(a, b); put(c); } c.used = performance.now(); return c; };
    // Background generation of the ring around the window, nearest to `X, Y` first.
    self.pump = (budgetMs, X, Y) => {
      const t0 = performance.now();
      const want = self.ring(self.kc).filter(q => !cache.has(key(q[0], q[1])));
      if (!want.length) return false;
      want.sort((a, b) => Math.hypot((a[0] + .5) * self.chunkSize - X, (a[1] + .5) * self.chunkSize - Y) - Math.hypot((b[0] + .5) * self.chunkSize - X, (b[1] + .5) * self.chunkSize - Y));
      while (performance.now() - t0 < budgetMs && want.length) {
        const q = want[0], k = key(q[0], q[1]);
        let g = jobs.get(k); if (!g) { g = world.chunkJob(q[0], q[1]); jobs.set(k, g); }
        const r = g.next();
        if (r.done) { jobs.delete(k); put(r.value); want.shift(); }
      }
      return true;
    };
    // Writes the active chunks into the heightfield buffer, in MuJoCo's normalised units.
    self.write = () => {
      const view = getView(), nc = hf.nc, k0x = self.kc[0] - 4, k0y = self.kc[1] - 4, oz = hf.oz, sz = hf.sz;
      for (const [a, b] of self.active(self.kc)) {
        const c = self.get(a, b), sx = (a - k0x) * CH, sy = (b - k0y) * CH;
        for (let r = 0; r < CH; r++) { const o = (sy + r) * nc + sx, src = r * CH; for (let q = 0; q < CH; q++) view[o + q] = (c.h[src + q] - oz) / sz; }
      }
    };
    // Centres the window on the chunk holding world point X, Y (a travel). Returns nothing.
    self.centre = (X, Y) => { self.kc = self.chunkOf(X, Y); self.write(); };
    // The samples write() covers, the same in rows and columns: [first, last).
    self.span = [2 * CH, 6 * CH];
    // Keeps the robot (world X, Y) inside the central 2 x 2 chunks. Returns the shift in metres
    // the simulator must apply to its bodies, or null.
    self.follow = (X, Y) => {
      const k = self.chunkOf(X, Y), n = self.kc.slice();
      for (let i = 0; i < 2; i++) { if (k[i] > n[i]) n[i] = k[i]; else if (k[i] < n[i] - 1) n[i] = k[i] + 1; }
      if (n[0] === self.kc[0] && n[1] === self.kc[1]) return null;
      const sh = [(n[0] - self.kc[0]) * self.chunkSize, (n[1] - self.kc[1]) * self.chunkSize];
      self.kc = n; self.write();
      return sh;
    };
    self.ready = () => self.active(self.kc).every(q => cache.has(key(q[0], q[1])));
    return self;
  }

  root.FiaWorld = { create, Streamer, DEFAULTS, TRAINED, ENVS, MAT, SOLID, vnoise, hash, S };
})(typeof globalThis !== 'undefined' ? globalThis : this);
