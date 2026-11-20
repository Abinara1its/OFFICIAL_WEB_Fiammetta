'use strict';
// The project page's simulator threads. The page itself only renders and runs the interface; the
// robots are simulated in workers (sim-worker.js), one robot slot per worker where the device has
// the cores and memory for it, so that two controllers compared side by side run in parallel and a
// slow one does not hold up the drawing. All workers receive the same commands for the same
// simulated instants, in batches of control cycles, so the comparison is unchanged by the split.
const SIM = (() => {
  let pool = [], model = null, ready = false, bid = 0;
  const inits = new Map(), batches = new Map(), params = [];
  const slotWorker = slot => pool[slot % pool.length];

  function listen(w) {
    w.onmessage = e => { const m = e.data;
      if (m.op === 'init') { const k = m.id + ':' + m.gen, f = inits.get(k); if (f) { inits.delete(k); f(m) } }
      else if (m.op === 'run') { const b = batches.get(m.bid); if (b) b.take(w, m) }
      else if (m.op === 'param') params.forEach(f => f(m));
      else if (m.op === 'log') console.log(m.s);
      else if (m.op === 'fatal') { console.error('simulator:', m.msg); if (SIM.onfatal) SIM.onfatal(m.msg) } };
    w.onerror = e => { console.error('simulator:', e.message); if (SIM.onfatal) SIM.onfatal(e.message) };
  }
  const once = (w, op) => new Promise((ok, no) => { const prev = w.onmessage;
    w.onmessage = e => { if (e.data.op === op) { w.onmessage = prev; ok(e.data) } else if (e.data.op === 'fatal') no(new Error(e.data.msg)); else if (e.data.op === 'log') console.log(e.data.s); else prev && prev(e) } });

  // files: [{path, data: ArrayBuffer}] as listed in data/manifest.json.
  async function boot(files, threads) {
    const wasm = await fetch('fia_sim.wasm'); if (!wasm.ok) throw new Error('fia_sim.wasm: HTTP ' + wasm.status);
    const module = await (WebAssembly.compileStreaming ? WebAssembly.compileStreaming(wasm).catch(() => fetch('fia_sim.wasm').then(r => r.arrayBuffer()).then(b => WebAssembly.compile(b))) : wasm.arrayBuffer().then(b => WebAssembly.compile(b)));
    // A worker that compiles the scene and is discarded with the memory compilation took.
    const builder = new Worker('js/sim-worker.js'); const built = once(builder, 'built');
    builder.postMessage({ op: 'boot', module, files, build: true });
    const b = await built; builder.terminate(); model = b.model;
    const keep = files.filter(f => !/scene_(recipe|hfield)/.test(f.path)), mjb = new Uint8Array(b.mjb);
    pool = Array.from({ length: threads }, () => new Worker('js/sim-worker.js'));
    const copies = pool.map((w, i) => i ? mjb.slice().buffer : null); copies[0] = mjb.buffer;
    await Promise.all(pool.map((w, i) => { const r = once(w, 'ready'), data = copies[i];
      w.postMessage({ op: 'boot', module, files: [...keep, { path: '/fia/scene.mjb', data }] }, [data]); return r }));
    pool.forEach(listen); ready = true;
    return model;
  }

  function init(slot, args, gait, gen) {
    return new Promise(ok => { inits.set(slot + ':' + gen, ok); slotWorker(slot).postMessage({ op: 'init', id: slot, args, gait, gen }) }) }
  function free(slots) { const by = new Map(); for (const s of slots) { const w = slotWorker(s); by.set(w, (by.get(w) || []).concat(s)) }
    by.forEach((ids, w) => w.postMessage({ op: 'free', ids })) }
  // One batch for the sessions in slots; resolves with each slot's telemetry after every chunk,
  // its poses after the last, any failure, and the longest time a worker took. The slots in reset
  // receive the operator's reset with the first chunk.
  function run(slots, ch, reset) {
    return new Promise(ok => { const id = ++bid, by = new Map();
      for (const s of slots) { const w = slotWorker(s); by.set(w, (by.get(w) || []).concat(s)) }
      const out = { T: {}, P: {}, fail: {}, ms: 0 }; let left = by.size; const nch = ch.length / 6;
      batches.set(id, { take(w, m) { const ids = by.get(w);
        ids.forEach((s, j) => { out.T[s] = []; for (let c = 0; c < nch; c++) out.T[s].push(m.T.subarray((c * ids.length + j) * 192, (c * ids.length + j + 1) * 192));
          out.P[s] = m.P.subarray(j * 768, (j + 1) * 768); if (s in m.fail) out.fail[s] = m.fail[s] });
        out.ms = Math.max(out.ms, m.ms); if (--left === 0) { batches.delete(id); ok(out) } } });
      by.forEach((ids, w) => w.postMessage({ op: 'run', bid: id, ids, ch, reset: (reset || []).filter(s => ids.includes(s)) })) }) }
  const push = (slot, f) => slotWorker(slot).postMessage({ op: 'push', id: slot, f });
  const param = (slot, pid, v, gen) => slotWorker(slot).postMessage({ op: 'param', id: slot, pid, v, gen });
  const use = on => pool.forEach(w => w.postMessage({ op: 'use', on }));
  // Every worker keeps the world's elevations, for the sessions it has and those it may start. Only
  // the square block of samples span = [first, last) is sent; the rest of the heightfield is unused.
  function terrain(data, n, span, commit) {
    const w0 = span[1] - span[0], block = new Float32Array(w0 * w0);
    for (let r = 0; r < w0; r++) { const o = (span[0] + r) * n + span[0]; block.set(data.subarray(o, o + w0), r * w0) }
    pool.forEach((w, i) => { const d = i === pool.length - 1 ? block : block.slice(); w.postMessage({ op: 'terrain', data: d, n, span, commit }, [d.buffer]) }) }
  const shift = sh => pool.forEach(w => w.postMessage({ op: 'shift', sh }));
  // The operator's modes for one session; files fetched later (the stair mode's), for every thread.
  const modes = (slot, stair, slope) => slotWorker(slot).postMessage({ op: 'modes', id: slot, stair, slope });
  const addFiles = files => pool.forEach(w => w.postMessage({ op: 'files', files }));

  return { boot, init, free, run, push, param, use, terrain, shift, modes, addFiles, onparam: f => params.push(f), onfatal: null,
    get ready() { return ready }, get model() { return model }, get threads() { return pool.length } };
})();
