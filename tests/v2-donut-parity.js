/* Phase 2 gate, part 1 — see docs/V2-ROADMAP.md.
 *
 * The 3D donut, ported to v2/src/lib/donut.js. CLAUDE.md §2 is explicit that
 * face visibility here is DERIVED and must not be guessed, because guessing
 * produces phantom faces at particular data splits — splits that only turn up
 * with real inspection data, on a phone, in the field.
 *
 * So this compares the WHOLE EMITTED SVG STRING, character for character,
 * against V1's real buildDonut, across the splits that have historically gone
 * wrong and a large sweep of arbitrary ones. Exact equality is deliberate: a
 * path differing by one control point is a rendering defect nobody notices
 * until it looks wrong, and "close enough" has no meaning for geometry.
 *
 * The animation frames are included (sweep from 0 to 1), because the entry
 * sweep is where the gap arithmetic and the label-opacity ramp actually bite.
 *
 * Run:  node tests/v2-donut-parity.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = got === want;
  if (!ok) {
    // Whole SVGs are unreadable in a diff; point at the first divergence.
    let i = 0; while (i < Math.min(got.length, want.length) && got[i] === want[i]) i++;
    console.log('  FAIL  ' + name + '\n          first difference at char ' + i
      + '\n          got : ...' + JSON.stringify(String(got).slice(Math.max(0, i - 40), i + 60))
      + '\n          want: ...' + JSON.stringify(String(want).slice(Math.max(0, i - 40), i + 60)));
    fail++;
  } else { pass++; }
};

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

const SEG_SRC = balanced(SRC.indexOf('var SEG=['), '[', ']').replace(/^var SEG=/, '');
const CONST_SRC = (/var DCX=[^;]+;/.exec(SRC) || [])[0];
if (!CONST_SRC) throw new Error('V1 no longer declares the donut constants');

const v1 = new Function(`
  var SEG=${SEG_SRC};
  ${CONST_SRC}
  ${extract('esc')}
  ${extract('dpt')}
  ${extract('dsamples')}
  ${extract('dpoly')}
  ${extract('dface')}
  ${extract('dwall')}
  ${extract('dcap')}
  ${extract('dband')}
  ${extract('dsin')}
  ${extract('dcos')}
  ${extract('gapFor')}
  ${extract('buildDonut')}
  return { buildDonut: buildDonut, SEG: SEG, DCX: DCX, DR: DR, DGAP: DGAP };
`)();

/* The splits that matter. Several of these are the shapes that broke something:
 * a category at ~1% is CLAUDE.md §4.4 (a fixed gap swallowed it whole), and
 * two labels on one side is §4.5 (the second fell outside the viewBox). */
const SPLITS = [
  ['a fresh register — nothing inspected', { total: 187, ok: 0, wait: 0, none: 187 }],
  ['everything inspected and signed', { total: 187, ok: 187, wait: 0, none: 0 }],
  ['an even three-way split', { total: 186, ok: 62, wait: 62, none: 62 }],
  ['the real Kunak shape', { total: 187, ok: 41, wait: 7, none: 139 }],
  ['a 1% slice — §4.4, a fixed gap used to swallow it', { total: 187, ok: 2, wait: 0, none: 185 }],
  ['two tiny slices at once', { total: 187, ok: 1, wait: 1, none: 185 }],
  ['a half-and-half split — caps land on the axis', { total: 100, ok: 50, wait: 0, none: 50 }],
  ['one pili only', { total: 1, ok: 1, wait: 0, none: 0 }],
  ['an empty register — total 0, the divide-by-zero guard', { total: 0, ok: 0, wait: 0, none: 0 }],
  ['quarter split — puts labels on both sides', { total: 200, ok: 50, wait: 50, none: 100 }],
  /* A TINY LAST category. These exist because a mutation to the inner-wall
   * visibility band (90..270 -> 90..269) passed every other case here.
   * The band only bites when a segment ends near 270 degrees, and the last
   * segment ends at 270 - gap/2 — so it takes a slice small enough that
   * gapFor() shrinks the gap below about 1 degree, i.e. a fraction under
   * roughly 1/63. The arbitrary sweep below uses total 20, where the smallest
   * possible slice is 5% and the gap never shrinks at all. Without these rows
   * the whole inner wall was effectively untested at its boundary. */
  ['a single un-inspected pili — last slice is 0.5%', { total: 187, ok: 186, wait: 0, none: 1 }],
  ['tiny last slice with both others present', { total: 187, ok: 100, wait: 86, none: 1 }],
  ['tiny last slice, larger register', { total: 1000, ok: 500, wait: 499, none: 1 }],
];

(async () => {
  const port = await import('../v2/src/lib/donut.js');

  check('the palette is unchanged', JSON.stringify(port.SEG), JSON.stringify(v1.SEG));
  check('the projection constants are unchanged',
    JSON.stringify([port.DCX, port.DR, port.DGAP]), JSON.stringify([v1.DCX, v1.DR, v1.DGAP]));

  SPLITS.forEach(([why, d]) => {
    check('finished chart · ' + why, port.buildDonut(d), v1.buildDonut(d));
    // The entry sweep: 0 -> 360 degrees. This is where the gap arithmetic and
    // the label opacity ramp actually do something.
    let agreed = 0;
    const frames = 25;
    for (let i = 0; i <= frames; i++) {
      const sweep = i / frames;
      if (port.buildDonut(d, sweep) === v1.buildDonut(d, sweep)) agreed++;
      else check('sweep frame ' + sweep.toFixed(2) + ' · ' + why, port.buildDonut(d, sweep), v1.buildDonut(d, sweep));
    }
    check('all ' + (frames + 1) + ' animation frames agree · ' + why, String(agreed), String(frames + 1));
  });

  // A broad sweep of arbitrary splits, to catch a boundary none of the named
  // cases happens to sit on.
  let arbitrary = 0, tried = 0;
  for (let ok = 0; ok <= 20; ok++) {
    for (let wait = 0; wait + ok <= 20; wait++) {
      const none = 20 - ok - wait;
      const d = { total: 20, ok, wait, none };
      tried++;
      if (port.buildDonut(d) === v1.buildDonut(d)) arbitrary++;
      else check('arbitrary split ok=' + ok + ' wait=' + wait + ' none=' + none, port.buildDonut(d), v1.buildDonut(d));
    }
  }
  check('all ' + tried + ' arbitrary splits agree', String(arbitrary), String(tried));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
