/* Phase 2 gate, part 5 — see docs/V2-ROADMAP.md.
 *
 * The Jadual's period filter and sort order, ported to
 * v2/src/stores/jadual-logic.js and compared against V1's real source.
 *
 * The order is a documented decision that has already been changed twice —
 * upcoming-first, then newest-entry-first, now latest Tarikh first — with two
 * tie-breaks under it. That is exactly the kind of rule a port gets 90% right:
 * the common case looks fine and a row sharing a date with another sits in the
 * wrong place, which nobody notices until an admin says the list "looks odd".
 *
 * `dmy` is included because it carries its own fixed bug: parsing the ISO
 * pieces directly rather than going through new Date(), which reads the string
 * as UTC midnight and renders it back in local time — silently shifting the
 * displayed date by a day.
 *
 * Run:  node tests/v2-jadual-parity.js
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

const PAGE_CONF = /var JADUAL_PAGE=(\d+),/.exec(SRC);
if (!PAGE_CONF) throw new Error('V1 no longer declares JADUAL_PAGE');

const makeV1 = new Function('JADUAL', 'periodRange', `
  ${extract('pad')}
  ${extract('jadualInPeriod')}
  ${extract('jadualSorted')}
  ${extract('dmy')}
  return { jadualInPeriod: jadualInPeriod, jadualSorted: jadualSorted, dmy: dmy };
`);

const R = (id, t, pas, l, c) => ({ id, t, pas, l, c });
const RANGE = ['2026-07-01', '2026-12-31'];

const CASES = {
  'plain dates — latest first': [
    R(1, '2026-08-01', 'A', 'Kunak', '2026-07-01T00:00:00Z'),
    R(2, '2026-09-15', 'B', 'Madai', '2026-07-02T00:00:00Z'),
    R(3, '2026-07-20', 'C', 'Pangi', '2026-07-03T00:00:00Z'),
  ],
  'same date — newest entry on top': [
    R(1, '2026-08-01', 'A', 'X', '2026-07-01T00:00:00Z'),
    R(2, '2026-08-01', 'B', 'Y', '2026-07-09T00:00:00Z'),
    R(3, '2026-08-01', 'C', 'Z', '2026-07-05T00:00:00Z'),
  ],
  'same date, no created stamp — falls back to id': [
    R(1, '2026-08-01', 'A', 'X', ''),
    R(12, '2026-08-01', 'B', 'Y', ''),
    R(3, '2026-08-01', 'C', 'Z', ''),
  ],
  'mixed local and cloud ids': [
    R('local-1754500000000', '2026-08-01', 'A', 'X', '2026-07-01T00:00:00Z'),
    R(7, '2026-08-01', 'B', 'Y', '2026-07-01T00:00:00Z'),
  ],
  'a mid-range date added late must slot in by date, not jump to the top': [
    R(1, '2026-12-01', 'A', 'X', '2026-07-01T00:00:00Z'),
    R(2, '2026-07-05', 'B', 'Y', '2026-07-02T00:00:00Z'),
    R(3, '2026-09-01', 'C', 'Z', '2026-12-30T23:59:00Z'),   // newest entry, middle date
  ],
  'rows outside the period are excluded': [
    R(1, '2026-06-30', 'A', 'X', '2026-07-01T00:00:00Z'),   // previous half
    R(2, '2027-01-01', 'B', 'Y', '2026-07-01T00:00:00Z'),   // next half
    R(3, '2026-07-01', 'C', 'Z', '2026-07-01T00:00:00Z'),   // first day, inside
    R(4, '2026-12-31', 'D', 'W', '2026-07-01T00:00:00Z'),   // last day, inside
  ],
  'missing and malformed dates': [
    R(1, '', 'A', 'X', '2026-07-01T00:00:00Z'),
    R(2, null, 'B', 'Y', '2026-07-01T00:00:00Z'),
    R(3, '2026-08-01', 'C', 'Z', '2026-07-01T00:00:00Z'),
  ],
  'empty': [],
};

(async () => {
  const port = await import('../v2/src/stores/jadual-logic.js');

  check('page size matches V1', port.JADUAL_PAGE, +PAGE_CONF[1]);

  Object.entries(CASES).forEach(([why, rows]) => {
    const v1 = makeV1(rows, () => RANGE);
    check('inPeriod · ' + why,
      port.inPeriod(rows, RANGE).map((r) => r.id),
      v1.jadualInPeriod().map((r) => r.id));
    check('sorted · ' + why,
      port.sorted(rows, RANGE).map((r) => r.id),
      v1.jadualSorted().map((r) => r.id));
  });

  // dmy — the timezone bug it exists to prevent
  const v1 = makeV1([], () => RANGE);
  ['2026-08-07', '2026-01-01', '2026-12-31', '', null, 'rubbish', '2026-08-07T10:00:00Z'].forEach((iso) => {
    check('dmy(' + JSON.stringify(iso) + ')', port.dmy(iso), v1.dmy(iso));
  });
  check('dmy does not shift the day (the UTC-midnight bug)', port.dmy('2026-08-07'), '07/08/2026');

  // Paging: bounded, but nothing is ever hidden.
  const many = [];
  for (let i = 1; i <= 250; i++) many.push(R(i, '2026-08-' + String((i % 28) + 1).padStart(2, '0'), 'P', 'L', '2026-07-01T00:00:00Z'));
  const all = port.sorted(many, RANGE);
  check('250 rows all survive the sort', all.length, 250);
  check('the first page shows 100', port.page(all, false).length, port.JADUAL_PAGE);
  check('"Lihat semua" shows every one', port.page(all, true).length, 250);
  check('the first page is the top of the sorted list, not an arbitrary slice',
    port.page(all, false).map((r) => r.id), all.slice(0, port.JADUAL_PAGE).map((r) => r.id));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
