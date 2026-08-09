/* Phase 3 gate — see docs/V2-ROADMAP.md.
 *
 * The map layer, ported to v2/src/stores/map-logic.js and compared against V1's
 * real source. Same method as every other parity suite: test the port against
 * V1, not against my reading of V1.
 *
 * The fit rule is the reason this suite exists. "A background pull must never
 * re-fit the map" (CLAUDE.md §3) is a rule about something NOT happening, and
 * the failure is not an error — the map simply jumps away from whatever an
 * officer was reading, mid-read, on a phone. V1 expresses it inline in
 * renderMarkers with a one-shot `noFitOnce` flag, so the transcription is
 * guarded: if that code is edited, this throws rather than silently comparing
 * the port against a stale copy.
 *
 * Run:  node tests/v2-map-parity.js
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

const STATUS_SRC = balanced(SRC.indexOf('var STATUS = {'), '{', '}').replace(/^var STATUS = /, '');
const ORDER_SRC = (/var ORDER = (\[[^\]]+\]);/.exec(SRC) || [])[1];
if (!ORDER_SRC) throw new Error('V1 no longer declares ORDER');

/* V1's real makeIcon returns an L.divIcon, so L is stubbed to hand back the
 * options object — that is how the HTML and the icon geometry are compared
 * without a map. */
const v1 = new Function(`
  var STATUS = ${STATUS_SRC};
  var ORDER = ${ORDER_SRC};
  var L = { divIcon: function(o){ return o; } };
  var PENDING = {};
  function hasPending(id){ return !!PENDING[id]; }
  ${extract('pad')}
  ${extract('esc')}
  ${extract('fmtBadge')}
  ${extract('makeIcon')}
  ${extract('tip')}
  return { STATUS: STATUS, ORDER: ORDER, fmtBadge: fmtBadge, makeIcon: makeIcon,
           tip: function(h, pending){ PENDING = {}; if (pending) PENDING[h.id] = 1; return tip(h); } };
`)();

/* The fit rule, lifted from renderMarkers. V1 has no function for it, so this
 * transcribes the three lines and then asserts they still look like this. */
const FIT_SRC = (SRC.slice(SRC.indexOf('function renderMarkers(')).match(
  /var key=vis\.map[\s\S]*?maxZoom:18\}\); \}/) || [])[0];
if (!FIT_SRC
    || !/if\(noFitOnce\)\{ noFitOnce=false; fittedKey=key; return; \}/.test(FIT_SRC)
    || !/if\(key!==fittedKey && vis\.length\)\{ fittedKey=key;/.test(FIT_SRC)) {
  throw new Error('renderMarkers no longer uses the fit rule this test transcribes — update it deliberately');
}
function v1Fit(vis, fittedKey, noFitOnce) {
  let fit = false;
  const key = vis.map(h => h.id).sort((a, b) => a - b).join(',');
  if (noFitOnce) { noFitOnce = false; fittedKey = key; }
  else if (key !== fittedKey && vis.length) { fittedKey = key; fit = true; }
  return { fit, fittedKey, noFitOnce };
}

const H = (id, status, last) => ({ id, label: 'A' + String(id).padStart(2, '0'),
  lat: 4.68, lng: 118.24, status, location: 'Kunak', lastInspected: last || '' });

(async () => {
  const port = await import('../v2/src/stores/map-logic.js');

  check('the palette is unchanged', port.STATUS, v1.STATUS);
  check('the pill order is unchanged', port.ORDER, v1.ORDER);

  // ---- date badge ----
  ['2026-08-07', '2026-01-01', '', null, 'rubbish', '2026-12-31T10:00:00Z'].forEach((d) => {
    check('fmtBadge(' + JSON.stringify(d) + ')', port.fmtBadge(d), v1.fmtBadge(d));
  });

  // ---- marker html and icon geometry ----
  ['kerajaan', 'swasta'].forEach((s) => {
    [null, '2026-08-07'].forEach((last) => {
      [false, true].forEach((pend) => {
        const want = v1.makeIcon(s, last, pend);
        const why = s + (last ? ' + date' : '') + (pend ? ' + unsent' : '');
        check('marker html · ' + why, port.markerHtml(s, last, pend), want.html);
        check('icon geometry · ' + why, {
          className: port.ICON_OPTS.className, iconSize: port.ICON_OPTS.iconSize,
          iconAnchor: port.ICON_OPTS.iconAnchor, popupAnchor: port.ICON_OPTS.popupAnchor,
        }, { className: want.className, iconSize: want.iconSize, iconAnchor: want.iconAnchor, popupAnchor: want.popupAnchor });
      });
    });
  });

  // ---- tooltip ----
  [[H(1, 'kerajaan', '2026-08-07'), false], [H(2, 'swasta', ''), false],
   [H(3, 'kerajaan', '2026-08-07'), true]].forEach(([h, pend]) => {
    check('tooltip · ' + h.status + (pend ? ' + unsent' : ''), port.tipHtml(h, pend), v1.tip(h, pend));
  });

  /* ---- the fit rule ----
   * Named because a failure here is a map jumping under an officer's thumb,
   * which no error message will ever report. */
  const A = [H(1, 'kerajaan'), H(2, 'kerajaan'), H(3, 'swasta')];
  const B = A.concat([H(4, 'kerajaan')]);           // someone else added a pili
  const KA = port.keyOf(A), KB = port.keyOf(B);

  const CASES = [
    ['first render fits',                        A, '',  false],
    ['same set again does not re-fit',           A, KA,  false],
    ['a changed set fits',                       B, KA,  false],
    ['BACKGROUND pull must NOT fit (§3)',        B, KA,  true],
    ['noFitOnce is consumed, not sticky',        B, KB,  false],
    ['empty result never fits',                 [], KA,  false],
    ['empty result on a background pull',       [], KA,  true],
    ['reordered ids are the same set',  A.slice().reverse(), KA, false],
    ['a filter down to one still fits',   [A[0]], KA,  false],
  ];
  CASES.forEach(([why, vis, fitted, once]) => {
    check('fit · ' + why, port.fitDecision(vis, fitted, once), v1Fit(vis, fitted, once));
  });

  // The rule stated directly, so it reads as a requirement and not only as a
  // comparison against V1 — if V1 ever regressed, parity alone would agree.
  check('a background pull never fits, whatever changed',
    port.fitDecision(B, KA, true).fit, false);
  check('...and it still records the key, so the next real change fits',
    port.fitDecision(B, KA, true).fittedKey, KB);
  check('...and the flag does not persist',
    port.fitDecision(B, KA, true).noFitOnce, false);
  check('an ordinary change does fit', port.fitDecision(B, KA, false).fit, true);
  check('nothing visible never fits', port.fitDecision([], '', false).fit, false);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
