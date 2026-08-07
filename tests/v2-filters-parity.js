/* Phase 1 gate, part 2 — see docs/V2-ROADMAP.md.
 *
 * Scope, search and the zone panel, ported to v2/src/stores/filters-logic.js.
 * Same principle as v2-pending-parity.js: do not test the port against my
 * reading of V1, test it against V1.
 *
 * Here the functions are pure and self-contained, so instead of a browser this
 * lifts their REAL SOURCE TEXT out of index.html and runs it in a sandbox that
 * supplies the closure variables they expect. That is genuinely independent —
 * if someone edits V1's zoneSummary, this compares against the edited version,
 * not against a copy I transcribed.
 *
 * The registers below are generated to hit the cases that have actually caused
 * trouble or are one edit away from it: a zone with a hole in it, a label that
 * does not parse, a brand-new zone letter, and the AND-stacking of the three
 * filter axes.
 *
 * Run:  node tests/v2-filters-parity.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          got =' + JSON.stringify(got) + '\n          want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };

/* Pull one `function name(...){...}` out of the source by matching braces.
 * Deliberately strict: if V1 is refactored so a name no longer appears, or the
 * braces do not balance, this throws rather than silently comparing the port
 * against nothing. */
function extract(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('V1 no longer defines ' + name + ' — this test must be updated deliberately');
  let i = SRC.indexOf('{', start), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(start, j + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

const ZONE_RE_SRC = (/var ZONE_RE=([^;]+);/.exec(SRC) || [])[1];
if (!ZONE_RE_SRC) throw new Error('V1 no longer defines ZONE_RE');

/* V1's real code, given the closure variables it reads. */
const makeV1 = new Function('hydrants', 'activeFilter', 'inspFilter', 'zoneFilter', 'searchQuery', 'inspStatusOf', `
  var ZONE_RE=${ZONE_RE_SRC};
  ${extract('zoneOf')}
  ${extract('zoneLabel')}
  ${extract('zoneSummary')}
  ${extract('counts')}
  ${extract('searchMatches')}
  ${extract('visible')}
  return { zoneOf, zoneSummary, counts, searchMatches, visible };
`);

// Inspection status is period-dependent and lives with the records store; both
// sides get the same stand-in so the comparison is about the filter logic.
const inspStatusOf = (h) => h.__insp || 'belum';

const REGISTERS = {
  'the real shape — 187 pili across five zones': (() => {
    const out = [];
    const add = (z, n, status) => out.push({ id: out.length + 1, label: z + String(n).padStart(2, '0'), status, location: 'Kunak', __insp: n % 3 === 0 ? 'diperiksa' : 'belum' });
    for (let n = 1; n <= 114; n++) add('A', n, (n === 26 || (n >= 92 && n <= 107)) ? 'swasta' : 'kerajaan');
    for (let n = 1; n <= 27; n++) add('B', n, 'kerajaan');
    for (let n = 1; n <= 21; n++) add('C', n, 'kerajaan');
    for (let n = 1; n <= 13; n++) add('D', n, 'kerajaan');
    for (let n = 1; n <= 13; n++) add('E', n, 'kerajaan');
    return out;
  })(),
  'a hole in a range — gap must be flagged': [
    { id: 1, label: 'A01', status: 'kerajaan', location: 'x' },
    { id: 2, label: 'A02', status: 'kerajaan', location: 'x' },
    { id: 3, label: 'A09', status: 'kerajaan', location: 'x' },
  ],
  'labels that do not parse — counted, no row of their own': [
    { id: 1, label: 'A01', status: 'kerajaan', location: 'x' },
    { id: 2, label: 'PILI BARU', status: 'kerajaan', location: 'x' },
    { id: 3, label: '', status: 'swasta', location: 'x' },
    { id: 4, label: null, status: 'kerajaan', location: 'x' },
    { id: 5, label: 'AB12', status: 'kerajaan', location: 'x' },
  ],
  'a brand-new zone letter appears on its own': [
    { id: 1, label: 'A01', status: 'kerajaan', location: 'x' },
    { id: 2, label: 'Z01', status: 'swasta', location: 'Kilang' },
    { id: 3, label: 'z02', status: 'swasta', location: 'Kilang' },
  ],
  'empty register': [],
};

const SCOPES = [];
[null, 'kerajaan', 'swasta'].forEach((status) => {
  [null, 'diperiksa', 'belum'].forEach((insp) => {
    [null, 'A', 'B', 'Z'].forEach((zone) => {
      ['', 'kunak', 'A1', 'kilang'].forEach((query) => {
        SCOPES.push({ status, insp, zone, query });
      });
    });
  });
});

(async () => {
  const port = await import('../v2/src/stores/filters-logic.js');

  Object.entries(REGISTERS).forEach(([regName, hydrants]) => {
    // Zone panel and counts do not depend on the scope at all — that is the
    // point of the panel, so it is asserted separately and once.
    const v1 = makeV1(hydrants, null, null, null, '', inspStatusOf);
    check(regName + ' · zoneSummary', port.zoneSummary(hydrants), v1.zoneSummary());
    check(regName + ' · counts', port.counts(hydrants), v1.counts());

    let agreed = 0;
    SCOPES.forEach((s) => {
      const v = makeV1(hydrants, s.status, s.insp, s.zone, s.query, inspStatusOf);
      const want = v.visible().map((h) => h.id);
      const got = port.visible(hydrants, s, inspStatusOf).map((h) => h.id);
      if (JSON.stringify(got) === JSON.stringify(want)) agreed++;
      else check(regName + ' · visible ' + JSON.stringify(s), got, want);
    });
    check(regName + ' · visible() agrees on all ' + SCOPES.length + ' scope combinations', agreed, SCOPES.length);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
