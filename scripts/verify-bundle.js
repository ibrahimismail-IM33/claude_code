#!/usr/bin/env node
/* Verify the built V2 bundle before it is served.
 *
 * WHERE THIS RUNS, AND WHY IT MATTERS
 *   Cloudflare Pages builds V2 straight from the `claude/epb-v2` branch, and a
 *   build command that exits non-zero FAILS the deployment — the previous
 *   version stays up. So this script is the only thing standing between a bad
 *   bundle and the staging URL. It is wired in as part of the Pages build
 *   command; see docs/STAGING.md.
 *
 * WHAT IT DOES NOT DO, SAID PLAINLY
 *   It does not run the test suites. With Git integration Cloudflare deploys on
 *   every push whether `tests.yml` is green or red — that trade was made
 *   deliberately for simplicity (docs/STAGING.md). This checks the ARTEFACT
 *   only: that what is about to be served is shaped the way it must be. A
 *   logic regression will reach staging; a bundle with a test harness or a CDN
 *   in it will not.
 *
 * Node only, no dependencies — it has to run in Cloudflare's build image.
 */
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const fail = [];
const ok = [];
const check = (cond, bad, good) => { if (cond) ok.push(good); else fail.push(bad); };

// --- the bundle exists at all ------------------------------------------------
check(fs.existsSync(path.join(DIST, 'index.html')),
  'dist/index.html is missing — the build produced no page',
  'index.html present');

const headersPath = path.join(DIST, '_headers');
check(fs.existsSync(headersPath),
  'dist/_headers is missing — v2/public/_headers did not get copied, so the CSP, '
  + 'the noindex and geolocation=(self) would ALL be absent',
  '_headers present');

// --- the headers say what they must -----------------------------------------
if (fs.existsSync(headersPath)) {
  const h = fs.readFileSync(headersPath, 'utf8');
  const csp = (h.split('\n').find((l) => l.trim().startsWith('Content-Security-Policy:')) || '');
  const scriptSrc = (/script-src([^;]*)/.exec(csp) || [])[1] || '';

  // V2 is a bundle, so it does not need the allowance V1 cannot avoid. This is
  // the security improvement the migration buys; losing it silently would undo
  // the point of self-hosting in the first place.
  check(!/unsafe-inline|unsafe-eval/.test(scriptSrc),
    'script-src is not \'self\' alone:' + scriptSrc,
    'script-src is \'self\' alone');

  /* noindex is now BRANCH-DEPENDENT, and wrong in either direction is a real
   * defect — which is why this is an invariant rather than a presence check.
   *
   *   not production → the line MUST be there. Staging holds real hydrant data
   *                    and real officer logins; indexing it is a support
   *                    incident waiting to happen.
   *   production     → the line MUST be gone. epilibomba.com is a public
   *                    service, and being absent from search results is a
   *                    defect, not a safeguard.
   *
   * scripts/finalize-headers.js decides; this refuses to ship the wrong answer.
   * They are deliberately separate: a script that both applies a rule and
   * confirms its own work cannot fail. */
  const PRODUCTION_BRANCH = process.env.EPB_PRODUCTION_BRANCH || 'main';
  const isProduction = process.env.CF_PAGES_BRANCH === PRODUCTION_BRANCH;
  const hasNoindex = /X-Robots-Tag:\s*noindex/.test(h);
  check(isProduction ? !hasNoindex : hasNoindex,
    isProduction
      ? 'this is the production branch but _headers still says noindex — '
        + 'epilibomba.com would be hidden from search results'
      : 'this is not the production branch (' + (process.env.CF_PAGES_BRANCH || 'local')
        + ') but _headers has no noindex — it holds real data and real logins',
    isProduction ? 'noindex absent (production)' : 'noindex present (non-production)');

  // Setting this back to geolocation=() silently disables "Guna Lokasi Saya"
  // with no error message at all.
  check(/Permissions-Policy:.*geolocation=\(self\)/.test(h),
    'geolocation=(self) is missing — "Guna Lokasi Saya" would silently stop working',
    'geolocation=(self) present');
}

// --- nothing that must never ship -------------------------------------------
// The harness mounts components with injected fixtures and has no auth in front
// of it. The suites build with V2_HARNESS=1, so a build run in the wrong order
// carries it.
check(!fs.existsSync(path.join(DIST, 'harness.html')),
  'the test harness (harness.html) is in the bundle',
  'no harness page');

const assetsDir = path.join(DIST, 'assets');
const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
check(!assets.some((f) => /^harness-/.test(f)),
  'a harness bundle is in dist/assets',
  'no harness bundle');

check(!fs.existsSync(path.join(DIST, 'sql')), 'sql/ is in the bundle', 'no sql/');
check(!fs.existsSync(path.join(DIST, 'tests')), 'tests/ is in the bundle', 'no tests/');

/* A third-party script would run with full access to the signed-in session and
 * to every record card. Self-hosting removed that path (CLAUDE.md §3); this is
 * what stops it coming back through a dependency. */
const CDN = /unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/;
const offenders = [];
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach((name) => {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) return walk(p);
    if (!/\.(js|css|html)$/.test(name)) return;
    if (CDN.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(DIST, p));
  });
})(DIST);
check(offenders.length === 0,
  'a CDN origin reappeared in the bundle: ' + offenders.join(', '),
  'no CDN origin');

/* The login gate's background, which is the first thing an officer sees.
 *
 * It lived only in the site repo until cutover, because publish-to-site.yml
 * copied it separately from anything Vite knew about. Now that Cloudflare
 * builds this repo directly, it has to come out of v2/public/ — and if it does
 * not, nothing complains: the #authGate rule declares a solid #0a0b0d too, so
 * a missing image degrades to a dark panel that looks entirely deliberate.
 *
 * The URL must also stay root-absolute. The stylesheet is emitted at
 * /assets/style-*.css and a relative url() resolves against the STYLESHEET, so
 * `url(login-bg.jpg)` asks for /assets/login-bg.jpg and 404s with the same
 * invisible result. */
[
  ['app-bg.png', 'the circuit-board background — the login gate and the whole app '
    + 'ground fall back to a flat dark panel'],
  ['logo-50.png', 'the 50th-anniversary watermark — it simply does not appear, and '
    + 'nothing anywhere reports it'],
].forEach(([f, what]) => {
  check(fs.existsSync(path.join(DIST, f)),
    f + ' is not in the bundle — ' + what,
    f + ' present');
});

/* A dependency's stylesheet can silently not ship, and nothing complains.
 *
 * V2 imported Leaflet's JS but never its CSS, so the panes and tiles had no
 * `position:absolute` and the map rendered as scattered tiles with black gaps
 * — from first paint, on staging, unfixable by panning. The build was green,
 * the bundle was well-formed, and every suite passed because they all stub
 * `window.L`. Only the browser knew.
 *
 * Each probe below is chosen to appear ONLY in the library's own file — none
 * is written in v2/src/styles — so it cannot be satisfied by our overrides.
 * `.marker-cluster` would be useless here: map.css styles it, so the check
 * would pass with the library's stylesheet entirely absent. One probe per
 * stylesheet, so losing any one of the three is caught. */
const cssFiles = assets.filter((f) => /\.css$/.test(f))
  .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'));
const allCss = cssFiles.join('\n');
[['.leaflet-pane', 'leaflet.css'],
  ['.leaflet-tile', 'leaflet.css'],
  ['.leaflet-cluster-anim', 'MarkerCluster.css'],
  ['.marker-cluster-small', 'MarkerCluster.Default.css']].forEach(([sel, src]) => {
  check(allCss.includes(sel),
    'the built CSS has no ' + sel + ' rule — ' + src + ' is not in the bundle, '
    + 'so the map renders as scattered tiles with gaps',
    sel + ' rules present');
});

['app-bg.png', 'logo-50.png'].forEach((f) => {
  check(!new RegExp('url\\(["\']?' + f.replace('.', '\\.')).test(allCss),
    'the ' + f + ' URL is relative — it resolves against /assets/style-*.css, so the '
    + 'browser requests /assets/' + f + ' and 404s. It must be "/' + f + '"',
    f + ' URL is root-absolute');
});

/* The smoke photo is gone (user's call, 2026-08-10). Asserted so a stale
 * reference cannot survive a merge: it would 404 invisibly, exactly like a
 * relative URL, because whatever declares it also declares a dark colour. */
/* Both files that were replaced. A missed rename is the same invisible 404 as a
 * relative URL: whatever declares the image declares a colour too, so the page
 * degrades to a plain panel that looks deliberate. app-bg went .jpg -> .png in
 * the same change, which is exactly the rename that gets half-done. */
['login-bg', 'app-bg\\.jpg'].forEach((gone) => {
  check(!new RegExp(gone).test(allCss),
    'the bundle still references ' + gone.replace('\\', '') + ', which was replaced — '
    + 'that URL 404s and the rule falls back to a plain panel, invisibly',
    'no stale ' + gone.replace('\\', '') + ' reference');
});

// --- report ------------------------------------------------------------------
ok.forEach((m) => console.log('  ok    ' + m));
if (fail.length) {
  console.error('\nBUNDLE REJECTED — the deployment will not go out:\n');
  fail.forEach((m) => console.error('  FAIL  ' + m));
  console.error('\nSee docs/STAGING.md.\n');
  process.exit(1);
}
console.log('\nBundle OK — ' + ok.length + ' checks passed.');
