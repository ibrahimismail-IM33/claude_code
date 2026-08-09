/* Phase 1 gate, part 4 — see docs/V2-ROADMAP.md.
 *
 * The Kad Rekod's shape and growth rules, ported to
 * v2/src/stores/records-logic.js. This is the highest-consequence port in the
 * migration: the Kad Rekod is a controlled record under MS ISO 9001:2015
 * procedure PS-8 (docs/KAD-REKOD.md), and its failures are invisible on screen
 * — they surface on paper, at the officer who files the card.
 *
 * Two different things are checked, and the first matters more than it looks:
 *
 *  1. The CONFIG. Column keys, column types and per-card capacities are lifted
 *     out of V1's real SECTIONS object and compared field by field. A port that
 *     mistypes one column key produces a card that looks right and silently
 *     drops that column's data on every save. A wrong perPage pushes a card
 *     onto a third sheet, which no screen test can see.
 *  2. The BEHAVIOUR. rowIsComplete, cardCount, padToCards, normalizeForm and
 *     formFingerprint run against V1's real source over generated forms,
 *     including the boundaries where a new card is created.
 *
 * Run:  node tests/v2-records-parity.js
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

const SECTIONS_SRC = balanced(SRC.indexOf('var SECTIONS = {'), '{', '}')
  .replace(/^var SECTIONS = /, '');
const SEC_ORDER_SRC = (/var SEC_ORDER=(\[[^\]]+\]);/.exec(SRC) || [])[1];
if (!SEC_ORDER_SRC) throw new Error('V1 no longer declares SEC_ORDER');

const v1 = new Function(`
  var SECTIONS = ${SECTIONS_SRC};
  var SEC_ORDER = ${SEC_ORDER_SRC};
  ${extract('emptyRow')}
  ${extract('rowHasData')}
  ${extract('cellFilled')}
  ${extract('rowIsComplete')}
  ${extract('blankForm')}
  ${extract('cardCount')}
  ${extract('padToCards')}
  ${extract('normalizeForm')}
  ${extract('latestPengujianDate')}
  ${extract('formFingerprint')}
  // V1 has no needsNewCard(); the rule lives inline at the top of
  // maybeAddPage, which then re-renders the DOM. Lifted verbatim so the port
  // is compared against V1's real condition rather than a paraphrase of it.
  function needsNewCard(f){
    return SEC_ORDER.some(function(s){
      var arr=f[s]||[]; return arr.length && rowIsComplete(s,arr[arr.length-1]);
    });
  }
  return { SECTIONS, SEC_ORDER, emptyRow, rowHasData, rowIsComplete, blankForm,
           cardCount, padToCards, normalizeForm, latestPengujianDate, formFingerprint,
           needsNewCard };
`)();

// Guard the transcription above: if maybeAddPage's condition is ever edited,
// this stops matching and the test says so instead of silently comparing the
// port against a stale copy.
const MAP_SRC = (SRC.slice(SRC.indexOf('function maybeAddPage(')).match(/var full=SEC_ORDER\.some\(function\(s\)\{[\s\S]*?\}\);/) || [])[0];
if (!MAP_SRC || !/arr\.length && rowIsComplete\(s,arr\[arr\.length-1\]\)/.test(MAP_SRC)) {
  throw new Error('maybeAddPage no longer uses the condition this test transcribes — update it deliberately');
}

const clone = (o) => JSON.parse(JSON.stringify(o));

(async () => {
  const port = await import('../v2/src/stores/records-logic.js');

  // ---------- 1. the config ----------
  check('section order', port.SEC_ORDER, v1.SEC_ORDER);
  v1.SEC_ORDER.forEach((s) => {
    check(s + ' · rows per card (docs/KAD-REKOD.md is binding)',
      port.SECTIONS[s] && port.SECTIONS[s].perPage, v1.SECTIONS[s].perPage);
    check(s + ' · column keys and types',
      port.SECTIONS[s] && port.SECTIONS[s].cols.map(c => [c.k, c.t]),
      v1.SECTIONS[s].cols.map(c => [c.k, c.t]));
  });
  check('a blank card is 11/11/15/10 rows',
    v1.SEC_ORDER.map(s => port.blankForm()[s].length),
    v1.SEC_ORDER.map(s => v1.blankForm()[s].length));

  // ---------- 2. row completeness, at the boundaries ----------
  /* Built from each section's OWN columns rather than hardcoded key names.
   * A first version used `tarikh`/`penguji` for every section, which meant
   * Kompaun — whose columns are t1..b1 and t2..b2 — was silently being tested
   * with empty rows, on the one section whose shape is unusual. */
  const rowsFor = (s) => {
    const cols = v1.SECTIONS[s].cols;
    const date = cols[0].k;
    const other = (cols.find((c, i) => i > 0 && c.t !== 'sign') || {}).k;
    const sign = (cols.find((c) => c.t === 'sign') || {}).k;
    const rows = {
      'empty row': {},
      'date only': { [date]: '2026-08-07' },
      'date + one other': { [date]: '2026-08-07', [other]: 'AHMAD' },
      'other field but no date': { [other]: 'AHMAD' },
      'whitespace only date': { [date]: '   ' },
      'date + whitespace field': { [date]: '2026-08-07', [other]: '   ' },
      'last column only': { [cols[cols.length - 1].k]: 'X' },
    };
    if (sign) rows['date + signature only'] = { [date]: '2026-08-07', [sign]: 'sig' };
    return rows;
  };
  v1.SEC_ORDER.forEach((s) => {
    Object.entries(rowsFor(s)).forEach(([why, row]) => {
      const full = Object.assign(v1.emptyRow(s), row);
      check(s + ' · rowIsComplete · ' + why, port.rowIsComplete(s, clone(full)), v1.rowIsComplete(s, clone(full)));
      check(s + ' · rowHasData · ' + why, port.rowHasData(s, clone(full)), v1.rowHasData(s, clone(full)));
    });
  });

  // ---------- 3. card growth ----------
  // Each section's capacity boundary, plus one past it, plus a mixed form.
  const FORMS = {};
  v1.SEC_ORDER.forEach((s) => {
    [v1.SECTIONS[s].perPage, v1.SECTIONS[s].perPage + 1, v1.SECTIONS[s].perPage * 3].forEach((n) => {
      const f = v1.blankForm();
      f[s] = [];
      for (let i = 0; i < n; i++) f[s].push(Object.assign(v1.emptyRow(s), { tarikh: '2026-08-0' + ((i % 9) + 1) }));
      FORMS[s + ' holding ' + n + ' rows'] = f;
    });
  });
  FORMS['a signed row survives normalisation'] = (() => {
    const f = v1.blankForm();
    f.pengujian[0] = Object.assign(v1.emptyRow('pengujian'),
      { tarikh: '2026-07-01', penguji: 'SITI', _signed: true, _sig: 'sig/1.png', _signedBy: 'siti@bomba.gov.my', _signedAt: '2026-07-01T00:00:00Z' });
    return f;
  })();
  FORMS['ragged input — missing sections and stray keys'] = { header: null, pengujian: [{ tarikh: '2026-01-01', bogus: 'x' }] };

  Object.entries(FORMS).forEach(([why, f]) => {
    check('cardCount · ' + why, port.cardCount(clone(f)), v1.cardCount(clone(f)));
    check('normalizeForm · ' + why, port.normalizeForm(clone(f)), v1.normalizeForm(clone(f)));
    check('formFingerprint · ' + why, port.formFingerprint(clone(f)), v1.formFingerprint(clone(f)));
    check('latestPengujianDate · ' + why, port.latestPengujianDate(clone(f)), v1.latestPengujianDate(clone(f)));
    check('needsNewCard · ' + why, port.needsNewCard(clone(f)), v1.needsNewCard(clone(f)));
  });

  /* The card-growth boundary, stated explicitly. A blank card must NOT grow;
   * filling its last row must. Each section is checked on its own because
   * whichever fills first wins. */
  v1.SEC_ORDER.forEach((s) => {
    const cols = v1.SECTIONS[s].cols;
    const other = (cols.find((c, i) => i > 0 && c.t !== 'sign') || {}).k;

    const blank = v1.blankForm();
    check(s + ' · a blank card does not grow', port.needsNewCard(clone(blank)), false);

    const halfTyped = v1.blankForm();
    halfTyped[s][v1.SECTIONS[s].perPage - 1][other] = 'SEPARUH';   // no date
    check(s + ' · a half-typed last row does not grow', port.needsNewCard(clone(halfTyped)), false);
    check(s + ' · ...and V1 agrees', port.needsNewCard(clone(halfTyped)), v1.needsNewCard(clone(halfTyped)));

    const done = v1.blankForm();
    const last = done[s][v1.SECTIONS[s].perPage - 1];
    last[cols[0].k] = '2026-08-07';
    last[other] = 'SIAP';
    check(s + ' · a complete last row grows the card', port.needsNewCard(clone(done)), true);
    check(s + ' · ...and V1 agrees', port.needsNewCard(clone(done)), v1.needsNewCard(clone(done)));
  });

  // The signature link is resolved per viewing and must never make the card
  // look changed — it is the reason the card stopped drawing twice on open.
  const withUrl = v1.blankForm();
  withUrl.pengujian[0]._sigUrl = 'https://example/signed-link';
  check('fingerprint ignores the short-lived signature link',
    port.formFingerprint(withUrl), port.formFingerprint(v1.blankForm()));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
