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

  // Staging carries real hydrant data and real officer logins.
  check(/X-Robots-Tag:\s*noindex/.test(h),
    'staging is not marked noindex — it holds real data and real logins',
    'noindex present');

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

// --- report ------------------------------------------------------------------
ok.forEach((m) => console.log('  ok    ' + m));
if (fail.length) {
  console.error('\nBUNDLE REJECTED — the deployment will not go out:\n');
  fail.forEach((m) => console.error('  FAIL  ' + m));
  console.error('\nSee docs/STAGING.md.\n');
  process.exit(1);
}
console.log('\nBundle OK — ' + ok.length + ' checks passed.');
