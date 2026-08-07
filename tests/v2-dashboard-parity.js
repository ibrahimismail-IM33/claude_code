/* Phase 2 gate, part 2 — see docs/V2-ROADMAP.md.
 *
 * The dashboard's data layer, ported to v2/src/stores/dashboard-logic.js.
 *
 * The dashboard stores no numbers of its own: every figure is derived from the
 * same Pengujian rows the Kad Rekod writes (CLAUDE.md §2). That makes the
 * derivation the whole product — get it wrong and the app reports confident,
 * precise, incorrect figures about a statutory inspection programme, with
 * nothing on screen to suggest anything is amiss.
 *
 * Compared against V1's real source: the period arithmetic, the paged scan
 * (§4.1 — Supabase truncates at 1000 rows and reports no error), mergeIndex,
 * and the scope rule that a cleared pill means Semua and not Awam (§4.3).
 *
 * Run:  node tests/v2-dashboard-parity.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          got =' + JSON.stringify(got) + '\n          want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };

function balanced(from, open, close) {
  let depth = 0;
  for (let j = SRC.indexOf(open, from); j < SRC.length; j++) {
    if (SRC[j] === open) depth++;
    else if (SRC[j] === close) { depth--; if (depth === 0) return SRC.slice(from, j + 1); }
  }
  throw new Error('unbalanced from ' + from);
}
function extract(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('V1 no longer defines ' + name + ' — update this test deliberately');
  return balanced(start, '{', '}');
}

const v1 = new Function('hydrants', 'activeFilter', 'inspIndex', 'periodIx', `
  ${extract('halfOf')}
  ${extract('halfList')}
  ${extract('halfRange')}
  ${extract('halfLabel')}
  var PERIODS = halfList();
  ${extract('periodRange')}
  ${extract('pushRow')}
  ${extract('mergeIndex')}
  ${extract('rowsInPeriod')}
  ${extract('inspStatusOf')}
  ${extract('dashList')}
  ${extract('dashScopeLabel')}
  ${extract('dashData')}
  return { PERIODS: PERIODS, halfList: halfList, halfRange: halfRange, halfLabel: halfLabel,
           periodRange: periodRange, pushRow: pushRow, mergeIndex: mergeIndex,
           rowsInPeriod: rowsInPeriod, inspStatusOf: inspStatusOf,
           dashList: dashList, dashScopeLabel: dashScopeLabel, dashData: dashData };
`);

const SCAN_CONF = /var SCAN_PAGE=(\d+), SCAN_MAX=(\d+);/.exec(SRC);
if (!SCAN_CONF) throw new Error('V1 no longer declares SCAN_PAGE / SCAN_MAX');

const HYD = [];
for (let i = 1; i <= 40; i++) {
  HYD.push({ id: i, label: 'A' + String(i).padStart(2, '0'),
    status: (i === 26 || i >= 35) ? 'swasta' : 'kerajaan', location: 'Kunak' });
}

// A cross-section: signed in period, unsigned in period, out of period, none.
const IDX = {};
HYD.forEach((h, i) => {
  const mode = i % 4;
  if (mode === 0) return;                                              // no rows at all
  const y = new Date().getFullYear();
  const inPeriod = new Date().getMonth() < 6 ? y + '-03-15' : y + '-09-15';
  if (mode === 1) IDX[String(h.id)] = [{ d: inPeriod, s: true, p: 'AHMAD' }];
  if (mode === 2) IDX[String(h.id)] = [{ d: inPeriod, s: false, p: 'SITI' }];
  if (mode === 3) IDX[String(h.id)] = [{ d: (y - 3) + '-03-15', s: true, p: 'LAMA' }];
});

(async () => {
  const port = await import('../v2/src/stores/dashboard-logic.js');

  check('scan page size', port.SCAN_PAGE, +SCAN_CONF[1]);
  check('scan page cap', port.SCAN_MAX, +SCAN_CONF[2]);

  const v = v1(HYD, null, IDX, 0);
  check('the four rolling halves', port.halfList(), v.PERIODS);
  v.PERIODS.forEach((o, i) => {
    check('period ' + i + ' range', port.halfRange(o), v.halfRange(o));
    check('period ' + i + ' label', port.halfLabel(o), v.halfLabel(o));
  });

  // ---- scope, including the cleared state that used to report "Awam" ----
  [null, 'kerajaan', 'swasta'].forEach((filter) => {
    for (let pIx = 0; pIx < 4; pIx++) {
      const vv = v1(HYD, filter, IDX, pIx);
      const range = port.halfRange(port.halfList()[pIx]);
      check('scope ' + JSON.stringify(filter) + ' period ' + pIx + ' · dashData',
        port.dashData(HYD, filter, IDX, range), vv.dashData());
      check('scope ' + JSON.stringify(filter) + ' · label',
        port.dashScopeLabel(filter), vv.dashScopeLabel());
      check('scope ' + JSON.stringify(filter) + ' period ' + pIx + ' · figures reconcile to the total',
        port.dashData(HYD, filter, IDX, range).total,
        port.dashData(HYD, filter, IDX, range).ok
        + port.dashData(HYD, filter, IDX, range).wait
        + port.dashData(HYD, filter, IDX, range).none);
    }
  });

  // ---- mergeIndex ----
  const MERGES = {
    'cloud adds a hydrant the device has never opened': [{ 1: [{ d: '2026-03-01', s: false, p: 'A' }] }, { 2: [{ d: '2026-03-02', s: true, p: 'B' }] }],
    'same row on both sides, signed in the cloud': [{ 1: [{ d: '2026-03-01', s: false, p: 'A' }] }, { 1: [{ d: '2026-03-01', s: true, p: 'A' }] }],
    'same row, signed locally, unsigned in cloud': [{ 1: [{ d: '2026-03-01', s: true, p: 'A' }] }, { 1: [{ d: '2026-03-01', s: false, p: 'A' }] }],
    'same date, different penguji — two distinct rows': [{ 1: [{ d: '2026-03-01', s: false, p: 'A' }] }, { 1: [{ d: '2026-03-01', s: true, p: 'B' }] }],
    'empty local': [{}, { 1: [{ d: '2026-03-01', s: true, p: 'A' }] }],
    'empty cloud': [{ 1: [{ d: '2026-03-01', s: true, p: 'A' }] }, {}],
    'both empty': [{}, {}],
  };
  Object.entries(MERGES).forEach(([why, [a, b]]) => {
    const clone = (o) => JSON.parse(JSON.stringify(o));
    check('mergeIndex · ' + why, port.mergeIndex(clone(a), clone(b)), v.mergeIndex(clone(a), clone(b)));
  });

  // ---- the paged scan ----
  const makeRows = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ hydrant_id: (i % 40) + 1, signed: i % 3 === 0,
      data: { tarikh: '2026-03-' + String((i % 28) + 1).padStart(2, '0'), penguji: 'P' + (i % 5) } });
    return out;
  };
  for (const n of [0, 1, 999, 1000, 1001, 2400]) {
    const rows = makeRows(n);
    const ranges = [];
    const idx = await port.scanPages((from, to) => {
      ranges.push([from, to]);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    });
    const expectedPages = Math.max(1, Math.ceil(n / port.SCAN_PAGE) + (n % port.SCAN_PAGE === 0 && n > 0 ? 1 : 0));
    check(n + ' rows · every page requested', ranges.length, expectedPages);
    const counted = Object.values(idx).reduce((s, a) => s + a.length, 0);
    check(n + ' rows · every row indexed, none dropped or repeated', counted, n);
  }

  // A first-page failure gives up; a later failure keeps what arrived.
  let calls = 0;
  check('first page fails · null, so the local copy is used',
    await port.scanPages(() => { calls++; return Promise.resolve({ data: null, error: { message: 'x' } }); }), null);
  calls = 0;
  const partial = await port.scanPages((from, to) => {
    calls++;
    if (calls === 2) return Promise.resolve({ data: null, error: { message: 'x' } });
    return Promise.resolve({ data: makeRows(2400).slice(from, to + 1), error: null });
  });
  // Guard the shape before counting: a port that returns null here has thrown
  // away a thousand rows it already had, and the test must SAY that rather
  // than die on Object.values(null).
  check('second page fails · partial cloud data is kept, not discarded',
    partial === null ? 'null — everything read was discarded'
                     : Object.values(partial).reduce((s, a) => s + a.length, 0), 1000);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
