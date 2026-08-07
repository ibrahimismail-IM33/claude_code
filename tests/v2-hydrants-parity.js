/* Phase 1 gate, part 3 — see docs/V2-ROADMAP.md.
 *
 * Reading the register, ported to v2/src/stores/hydrants-logic.js. Same
 * principle as the other two parity suites: test the port against V1, not
 * against my reading of V1.
 *
 * V1's real cloudLoad is lifted out of index.html by source text and run in a
 * sandbox with the closure variables it expects. That gets three things at
 * once, all of them silent failures if a port gets them wrong:
 *
 *   - the page boundaries, which is CLAUDE.md §4.1 — PostgREST truncates at
 *     1000 rows and reports no error, so hydrants vanish off the map with
 *     nothing on screen to say so;
 *   - that a failed or empty read leaves the local copy ALONE (a partial read
 *     is worse than no read: it looks like hydrants were deleted);
 *   - that a QUIET pull sets noFitOnce and does not clear fittedKey, so a
 *     background refresh never re-fits the map away from what an officer is
 *     reading (§3).
 *
 * Run:  node tests/v2-hydrants-parity.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          got =' + JSON.stringify(got) + '\n          want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };

function extract(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('V1 no longer defines ' + name + ' — update this test deliberately');
  let depth = 0;
  for (let j = SRC.indexOf('{', start); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(start, j + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

const PAGE_CONF = /var LOAD_PAGE=(\d+), LOAD_MAX=(\d+);/.exec(SRC);
if (!PAGE_CONF) throw new Error('V1 no longer declares LOAD_PAGE / LOAD_MAX');
const V1_PAGE = +PAGE_CONF[1], V1_MAX = +PAGE_CONF[2];

/* A stand-in server that truncates the way PostgREST does. Records every range
 * asked for, so the page boundaries can be compared and not just the total. */
function makeServer(total, opts = {}) {
  const rows = [];
  for (let i = 1; i <= total; i++) {
    rows.push({ id: i, label: 'A' + i, lat: '4.68', lng: '118.24',
      status: i % 10 === 0 ? 'swasta' : 'kerajaan',
      location: i % 7 === 0 ? '' : 'Lokasi ' + i,
      last_inspected: i % 5 === 0 ? '2026-07-01' : null });
  }
  const ranges = [];
  return {
    ranges,
    fetch(from, to) {
      ranges.push([from, to]);
      if (opts.failAt !== undefined && ranges.length === opts.failAt) {
        return Promise.resolve({ data: null, error: { message: 'network' } });
      }
      // An unranged read truncates at 1000 and reports no error — reproduce it,
      // or the test cannot show the bug it guards.
      if (from === undefined) return Promise.resolve({ data: rows.slice(0, 1000), error: null });
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
}

// V1's real cloudLoad, given what it closes over.
const makeV1 = new Function('server', 'initial', 'LOAD_PAGE', 'LOAD_MAX', `
  var hydrants = initial;
  var noFitOnce = false, fittedKey = 'SET';
  function persist(){}
  function refresh(){}
  function reopenDetailIfOpen(){}
  var sb = { from: function(){ return { select: function(){ return {
    order: function(){ return { range: function(f,t){ return server.fetch(f,t); } }; } }; } }; } };
  ${extract('cloudLoad')}
  return {
    run: function(quiet){ cloudLoad(quiet); },
    get: function(){ return hydrants; },
    flags: function(){ return { noFitOnce: noFitOnce, fittedKey: fittedKey }; }
  };
`);

const settle = () => new Promise((r) => setTimeout(r, 30));

const SEED = [
  { id: 1, label: 'A01', lat: 4.68, lng: 118.24, status: 'kerajaan', location: 'Asal', lastInspected: '2026-01-01' },
  { id: 2, label: 'A02', lat: 4.68, lng: 118.24, status: 'kerajaan', location: 'Asal', lastInspected: '' },
];

const SIZES = [0, 1, 187, 999, 1000, 1001, 2400];

(async () => {
  const port = await import('../v2/src/stores/hydrants-logic.js');

  check('the port uses V1\'s page size', port.LOAD_PAGE, V1_PAGE);
  check('the port uses V1\'s page cap', port.LOAD_MAX, V1_MAX);

  for (const total of SIZES) {
    const label = total + ' hydrants on the server';

    // --- V1 ---
    const sv1 = makeServer(total);
    const v1 = makeV1(sv1, SEED.map((h) => Object.assign({}, h)), V1_PAGE, V1_MAX);
    v1.run(true);
    await settle();

    // --- the port ---
    const sp = makeServer(total);
    const paged = await port.pageAll(sp.fetch);
    // The rule is BOTH: the read has to have succeeded (pageAll !== null) and
    // to have returned something. Either one alone would overwrite the local
    // copy with nothing, which on screen looks exactly like a mass deletion.
    const got = (paged && port.shouldApply(paged.rows))
      ? port.mapRows(paged.rows, SEED)
      : SEED.map((h) => Object.assign({}, h));

    check(label + ' · same ranges requested', sp.ranges, sv1.ranges);
    check(label + ' · same register after the read', got, v1.get());
  }

  // --- a read that fails part-way through ---
  for (const [total, failAt, why] of [[1, 1, 'first page fails'], [2400, 2, 'second page fails']]) {
    const sv1 = makeServer(total, { failAt });
    const v1 = makeV1(sv1, SEED.map((h) => Object.assign({}, h)), V1_PAGE, V1_MAX);
    v1.run(true);
    await settle();

    const sp = makeServer(total, { failAt });
    const paged = await port.pageAll(sp.fetch);
    // The rule is BOTH: the read has to have succeeded (pageAll !== null) and
    // to have returned something. Either one alone would overwrite the local
    // copy with nothing, which on screen looks exactly like a mass deletion.
    const got = (paged && port.shouldApply(paged.rows))
      ? port.mapRows(paged.rows, SEED)
      : SEED.map((h) => Object.assign({}, h));

    check(why + ' · the port also gives up', paged, null);
    check(why + ' · local copy untouched, same as V1', got, v1.get());
  }

  // --- the map must not move on a background pull ---
  const quiet = makeV1(makeServer(187), SEED.slice(), V1_PAGE, V1_MAX);
  quiet.run(true); await settle();
  check('quiet pull arms noFitOnce and keeps the fit key', quiet.flags(), { noFitOnce: true, fittedKey: 'SET' });

  const loud = makeV1(makeServer(187), SEED.slice(), V1_PAGE, V1_MAX);
  loud.run(false); await settle();
  check('a foreground load clears the fit key instead', loud.flags(), { noFitOnce: false, fittedKey: '' });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
