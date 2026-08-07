/* Phase 1 gate for the V2 migration — see docs/V2-ROADMAP.md.
 *
 * The offline queue is the most dangerous code in this app. Three defects have
 * lived in it (§4.10, §4.13, §4.14) and each destroyed, or nearly destroyed,
 * real inspection data typed by an officer in the field. Porting it to Pinia by
 * reading it carefully and writing it out again is exactly how a fourth one
 * gets introduced — the logic is a five-way decision over "what did the cloud
 * hold when I went offline", and a single inverted branch loses a record with
 * no error anywhere.
 *
 * So this does not test the port against my reading of V1. It runs BOTH:
 *
 *   - the real V1 flushPending, in a real browser, from the real index.html,
 *     triggered the way a reconnect actually triggers it (an 'online' event)
 *   - the ported planFlush() from v2/src/stores/pending.js, in node
 *
 * over the same exhaustive set of inputs, and requires the decisions to be
 * identical: the same rows pushed, the same rows deleted, the same rows left
 * parked. If V1 and V2 ever disagree about one combination, that combination
 * names itself here instead of being found by an officer.
 *
 * Every case runs in ONE page load, each on its own hydrant id, because
 * flushAllPending() walks every parked card on reconnect.
 *
 * Run:  node tests/v2-pending-parity.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP  = fs.mkdtempSync(path.join(os.tmpdir(), 'epb-parity-'));
const APP  = path.join(TMP, 'app.html');
fs.writeFileSync(APP, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('function isAdmin(){ return IS_ADMIN === true; }', 'function isAdmin(){ return true; }'));
const URL = 'file://' + APP;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          got =' + JSON.stringify(got) + '\n          want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };

const TYPED  = { penguji: 'DATA LAPANGAN' };   // what the officer typed offline
const BASE   = { penguji: 'ASAL' };            // what the cloud held when they opened it
const MOVED  = { penguji: 'DIUBAH DI PEJABAT' }; // what the office changed it to since

/* The full cross-product of the things flushPending actually branches on.
 * Named so a failure reads as a sentence rather than an index. */
const CASES = [];
[false, true].forEach((removed) => {
  ['absent', 'unchanged', 'changed', 'signed'].forEach((cloudState) => {
    ['unseen', 'never-existed', 'matches-cloud', 'differs'].forEach((baseKind) => {
      CASES.push({ removed, cloudState, baseKind,
        name: (removed ? 'removal' : 'edit') + ' · cloud ' + cloudState + ' · base ' + baseKind });
    });
  });
});

// Build the parked row and the cloud row for a case.
function inputsFor(c, id) {
  const cloudData = c.cloudState === 'changed' ? MOVED : BASE;
  const cloud = c.cloudState === 'absent' ? null
    : { hydrant_id: id, section: 'pengujian', row_index: 0, data: cloudData, signed: c.cloudState === 'signed' };

  let base;
  if (c.baseKind === 'unseen') base = undefined;
  else if (c.baseKind === 'never-existed') base = null;
  else if (c.baseKind === 'matches-cloud') base = cloudData;
  else base = { penguji: 'SESUATU YANG LAIN' };

  const row = { section: 'pengujian', row_index: 0 };
  if (c.removed) row.removed = true; else row.data = TYPED;
  // `base: undefined` must survive as ABSENT, not as an explicit null —
  // JSON.stringify drops undefined properties, which is exactly the behaviour
  // localStorage gives V1, so the two stay equivalent.
  if (base !== undefined) row.base = base;

  return { cloud, parked: { t: '2026-08-07T00:00:00.000Z', rows: [row] } };
}

(async () => {
  // The port itself, imported as ESM from the V2 source. Deliberately the same
  // file the app will use — a copy transcribed into the test would prove only
  // that the copy matches V1.
  const { planFlush, settle } = await import('../v2/src/stores/pending-logic.js');

  const cases = CASES.map((c, i) => {
    const id = i + 1;
    return Object.assign({ id }, c, inputsFor(c, id));
  });

  const b = await chromium.launch({ executablePath: CHROMIUM });

  /* The matrix is run twice.
   *
   * `ok`   the writes land. Exercises settle(plan, true, true).
   * `fail` the upsert AND the delete come back with an error. This is the path
   *        §4.14 is about: a flush that fails must change NOTHING, or the
   *        typing is left in the form cache no longer flagged as unsent and the
   *        cloud overwrites it on the next open — §4.10 all over again, on a
   *        flaky connection rather than a clean outage. Without this half the
   *        suite would pass on a port that threw failed work away. */
  for (const mode of ['ok', 'fail']) {
  const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
  p.on('pageerror', e => { console.log('  PAGEERROR', e.message); fail++; });

  await p.addInitScript(() => {
    const noop = () => {};
    const layer = () => ({ addTo() { return this; }, clearLayers() {}, addLayer() {} });
    window.L = { map: () => ({ on: noop, invalidateSize: noop, fitBounds: noop, setView: noop }),
      control: { zoom: () => ({ addTo: noop }) }, tileLayer: () => ({ addTo: noop }),
      layerGroup: layer, markerClusterGroup: layer, divIcon: o => o, latLngBounds: a => a,
      marker: () => ({ bindTooltip() { return this; }, on() { return this; } }) };
  });

  await p.addInitScript((seed) => {
    window.__hyd = seed.hyd;
    window.__recs = seed.recs;
    window.__upserts = [];
    window.__deletes = [];

    // A stub that HONOURS .eq() filters. The existing suites can ignore
    // hydrant_id because they use one hydrant; this test puts every case on its
    // own id in one page load, so a select that returned every row would let a
    // case pass on another case's data.
    const filtered = (rows, f) => rows.filter(r => Object.keys(f).every(k => r[k] === f[k]));
    const q = (t) => {
      const f = {};
      const r = Promise.resolve().then(() => ({
        data: t === 'hydrants' ? window.__hyd.slice()
            : t === 'hydrant_records' ? JSON.parse(JSON.stringify(filtered(window.__recs, f)))
            : [],
        error: null }));
      r.eq = (k, v) => { f[k] = v; return r; };
      ['gte','lte','order','range','limit'].forEach(m => { r[m] = () => r; });
      return r;
    };
    const delQ = (t) => {
      const f = {};
      const r = Promise.resolve().then(() => {
        if (t === 'hydrant_records' && window.__deleteFail) return { error: { message: 'network' } };
        if (t === 'hydrant_records') {
          window.__deletes.push({ hydrant_id: f.hydrant_id, section: f.section, row_index: f.row_index });
          const i = window.__recs.findIndex(x => x.hydrant_id === f.hydrant_id && x.section === f.section && x.row_index === f.row_index);
          if (i >= 0) window.__recs.splice(i, 1);
        }
        return { error: null };
      });
      r.eq = (k, v) => { f[k] = v; return r; };
      return r;
    };

    window.supabase = { createClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }),
              getSession: () => Promise.resolve({ data: { session: null } }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      storage: { from: () => ({ upload: () => Promise.resolve({ error: null }),
                                getPublicUrl: () => ({ data: { publicUrl: '' } }),
                                createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) },
      from: (t) => ({
        select: () => q(t),
        upsert: (rows) => {
          if (t === 'hydrant_records' && window.__upsertFail) return Promise.resolve({ error: { message: 'network' } });
          if (t === 'hydrant_records') [].concat(rows).forEach(r => {
            window.__upserts.push(r);
            const i = window.__recs.findIndex(x => x.hydrant_id === r.hydrant_id && x.section === r.section && x.row_index === r.row_index);
            if (i >= 0) window.__recs[i] = Object.assign({}, window.__recs[i], r);
            else window.__recs.push(Object.assign({ signed: false }, r));
          });
          return Promise.resolve({ error: null });
        },
        insert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        delete: () => delQ(t) }) }) };
  }, {
    hyd: cases.map(c => ({ id: c.id, label: 'A' + String(c.id).padStart(2, '0'),
      lat: 4.6853, lng: 118.2457, status: 'kerajaan', location: 'Kunak', last_inspected: null })),
    recs: cases.filter(c => c.cloud).map(c => c.cloud),
  });

  // Park the queues before the app boots, exactly as a reconnect would find them.
  await p.addInitScript((parked) => {
    parked.forEach(([id, p2]) => { try { localStorage.setItem('bbpkunak_pending_' + id, JSON.stringify(p2)); } catch (e) {} });
  }, cases.map(c => [c.id, c.parked]));

  await p.addInitScript((m) => { window.__upsertFail = window.__deleteFail = (m === 'fail'); }, mode);

  await p.goto(URL);
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.getElementById('authGate').classList.add('hide'));

  // This is how a returning signal actually reaches the queue in V1.
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForTimeout(2500);

  const v1 = await p.evaluate((ids) => ({
    upserts: window.__upserts,
    deletes: window.__deletes,
    left: ids.map(id => { const r = localStorage.getItem('bbpkunak_pending_' + id);
                          return [id, r ? JSON.parse(r).rows : []]; }),
  }), cases.map(c => c.id));

  const leftById = Object.fromEntries(v1.left);

  let agreed = 0;
  cases.forEach((c) => {
    const cloudMap = {};
    if (c.cloud) cloudMap[c.cloud.section + '|' + c.cloud.row_index] = { data: c.cloud.data, signed: !!c.cloud.signed };
    const plan = planFlush(c.parked.rows, cloudMap);

    const v1Pushed  = v1.upserts.filter(r => r.hydrant_id === c.id)
                        .map(r => ({ section: r.section, row_index: r.row_index }));
    const v1Deleted = v1.deletes.filter(r => r.hydrant_id === c.id)
                        .map(r => ({ section: r.section, row_index: r.row_index }));
    const v1Left    = (leftById[c.id] || []).map(r => ({ section: r.section, row_index: r.row_index, removed: !!r.removed }));

    const key = (r) => ({ section: r.section, row_index: r.row_index });
    const ok = mode === 'ok';
    const want = {
      // When the write fails nothing reaches the server at all, so the observed
      // upserts/deletes are empty regardless of what the plan chose.
      pushed:  ok ? plan.push.map(key) : [],
      deleted: ok ? plan.drop.map(key) : [],
      left:    settle(plan, ok, ok).map(r => ({ section: r.section, row_index: r.row_index, removed: !!r.removed })),
    };
    const got = { pushed: v1Pushed, deleted: v1Deleted, left: v1Left };

    const same = JSON.stringify(got) === JSON.stringify(want);
    if (same) agreed++;
    check('[' + mode + '] V1 and the port agree — ' + c.name, got, want);
  });

  console.log('\n[' + mode + '] ' + agreed + '/' + cases.length + ' input combinations agreed\n');
  await p.close();
  }

  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
