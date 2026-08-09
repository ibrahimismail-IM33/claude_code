/* PARITY SURFACE — does V2 still contain everything V1 puts in front of an
 * officer?
 *
 * WHY THIS EXISTS
 *   V2 was handed over seven times and a person found a missing feature each
 *   time: the dashboard stub, the crash on tapping a pin, Leaflet's stylesheet,
 *   the sweep counter, Jadual Pemeriksaan, the Kad Rekod headings, the hydrant
 *   detail modal. Every fix was verified against ITSELF. The migration's thesis
 *   is "changes nothing an officer sees", so the check that was never run is
 *   the only one that mattered: does V2 do what V1 does?
 *
 *   Three of those were found in under a minute by two mechanical greps. This
 *   file is those two greps, run on every push.
 *
 * CHECK 1 — ORPHAN CLASSES
 *   Every class v2/src/styles/*.css defines must be emitted somewhere in
 *   v2/src. V2's CSS was copied from V1 WHOLESALE, so a class that is styled
 *   but never rendered means the styling arrived and the feature did not. That
 *   is exactly how `ftoast`, `m440` and `mob-reg-summary` surfaced.
 *
 * CHECK 2 — V1 ELEMENT IDs
 *   Every id in index.html must appear in V2 or carry a waiver. `dOpenForm` is
 *   what pointed at the missing detail modal.
 *
 * WHAT THIS DOES NOT DO — read this before trusting it
 *   It catches ABSENCE, not WRONGNESS. It would not have caught the sweep
 *   counter (a behaviour bug in code that was fully present), the missing
 *   Leaflet stylesheet (a dependency, not our CSS), or the missing `thead`
 *   (values inside an object, not a class or an id). It is one more net, not a
 *   guarantee, and it is cheap precisely because it is shallow.
 *
 * THE WAIVER FILE IS THE WEAK POINT. Every entry needs a reason, and adding one
 * carelessly switches this off silently. The count is printed on every run so
 * it is visible when it grows.
 *
 * Run:  node tests/v2-parity-surface.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WAIVERS = JSON.parse(fs.readFileSync(path.join(__dirname, 'parity-waivers.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '  → ' + detail));
  ok ? pass++ : fail++;
};

// ---- gather ----------------------------------------------------------------
function readAll(dir, test) {
  const out = [];
  (function walk(d) {
    fs.readdirSync(d).forEach((n) => {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) return walk(p);
      if (test.test(n)) out.push(fs.readFileSync(p, 'utf8'));
    });
  })(dir);
  return out;
}

const v1 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const v2css = readAll(path.join(ROOT, 'v2', 'src', 'styles'), /\.css$/).join('\n');

/* Read the BUILT BUNDLE, not the source tree.
 *
 * The first version of this file grepped v2/src, and a mutation proved that
 * useless: deleting `<HydrantDetail>` from App.vue's template left the guard
 * green, because HydrantDetail.vue still sat there on disk with `dOpenForm`
 * inside it. The check was proving that code EXISTS, which is not the question
 * — the question is whether it REACHES AN OFFICER. An unimported component is
 * tree-shaken out of the bundle, so reading dist/ answers it.
 *
 * Same lesson as CLAUDE.md §5: "a green suite says the parts work, never that
 * the whole exists" — the V2 bundle contained no app at all for three phases
 * while every component suite passed. Check the artefact. */
const DIST = path.join(ROOT, 'dist', 'assets');
if (!fs.existsSync(DIST)) {
  console.error('dist/assets is missing — run `npx vite build` first. This suite '
    + 'reads the BUILT bundle on purpose; see the note above.');
  process.exit(1);
}
const v2src = readAll(DIST, /\.js$/).join('\n');

// ---- check 1: every styled class is emitted somewhere -----------------------
console.log('T1  every class V2 styles is actually rendered by V2');
const styled = [...new Set((v2css.match(/\.[a-zA-Z][a-zA-Z0-9_-]{2,}/g) || [])
  .map((c) => c.slice(1)))];

/* Class names are often built by concatenation — `'k-' + status`, `'n-' + key`
 * — so the literal never appears. A prefix match keeps those from being false
 * alarms, at the cost of some looseness. Stated plainly rather than hidden:
 * this check is deliberately generous, because a noisy guard gets waived into
 * uselessness and a quiet one keeps working. */
function emitted(cls) {
  if (v2src.includes(cls)) return true;
  /* A concatenated name: the source holds the PREFIX then a quote then `+`.
   * The prefix is not necessarily at the start of the string —
   * `'labg k-' + m.s.key` is real code in lib/donut.js, and an earlier version
   * of this check only looked for `'k-' +`, so it reported k-ok/k-wait/k-none
   * as missing when they are emitted on every render. A guard that cries wolf
   * gets waived into uselessness, so this is deliberately permissive. */
  const dash = cls.lastIndexOf('-');
  if (dash <= 0) return false;
  const prefix = cls.slice(0, dash + 1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* The prefix, then a string terminator, then the concatenation. The bundle
   * uses BACKTICKS as well as quotes — Vue compiles templates into template
   * literals — so all three have to be accepted. Reading dist/ rather than the
   * source is what forced this. */
  return new RegExp(prefix + '["\'`$]').test(v2src);
}

const orphans = styled.filter((c) => !emitted(c) && !WAIVERS.classes[c]);
check('no class is styled but never rendered', orphans.length === 0,
  orphans.join(', ') + '  (add to parity-waivers.json WITH A REASON only if '
  + 'genuinely dead in V1 too, or emitted by a library)');

// ---- check 2: every V1 element id exists in V2 ------------------------------
console.log('T2  every element id V1 uses exists in V2');
const v1ids = [...new Set(
  (v1.match(/id="[a-zA-Z0-9_-]+"/g) || []).map((s) => s.slice(4, -1))
    .concat((v1.match(/getElementById\("[a-zA-Z0-9_-]+"\)/g) || []).map((s) => s.slice(16, -2))))];

/* A word-boundary match against the BUILT bundle. Not quote-delimited: Vue
 * compiles `id="tabMap"` into a template literal, so it lands as `id=tabMap\``
 * with no quotes at all — an earlier quote-based version reported all 84 ids
 * missing, which is the check being wrong rather than the app.
 *
 * Deliberately loose. This asks "does this identifier survive into what we
 * ship", and a false positive is far cheaper than the false negative it
 * replaces. */
function hasId(id) {
  if (new RegExp('\\b' + id + '\\b').test(v2src)) return true;
  // Dynamic ids: :id="'dn' + c.id" compiles to a concatenation.
  const m = id.match(/^([a-z]+)[A-Z0-9]/);
  return !!(m && new RegExp('\\b' + m[1] + '["\'`]?\\s*\\+').test(v2src));
}

const missing = v1ids.filter((i) => !hasId(i) && !WAIVERS.ids[i]);
check('no V1 id is missing from V2', missing.length === 0,
  missing.join(', ') + '  (each one is a feature V1 has and V2 may not)');

// ---- report -----------------------------------------------------------------
console.log('\n  classes styled: ' + styled.length
  + ' · V1 ids: ' + v1ids.length
  + ' · WAIVERS: ' + (Object.keys(WAIVERS.classes).length + Object.keys(WAIVERS.ids).length)
  + '  ← if this number keeps growing, the guard is being talked out of its job');
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
