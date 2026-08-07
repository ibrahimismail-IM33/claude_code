/* Phase 0 stop-condition for the V2 migration — see docs/V2-ROADMAP.md.
 *
 * The single strongest security decision in CLAUDE.md §3 is that no third-party
 * script runs in this app: everything is self-hosted and script-src is 'self'.
 * A build step is the classic way that quietly ends — bundlers inject inline
 * bootstrap scripts, and template compilers need eval. If Vite cannot hold the
 * line, the framework choice is what changes, not the security property.
 *
 * So this test does not check the config, it checks the OUTPUT: it builds, then
 * serves dist/ under the real CSP from _headers with 'unsafe-inline' REMOVED
 * from script-src, and requires a working Vue + Pinia app with zero violations.
 *
 * V1 needs 'unsafe-inline' because all of its JavaScript is inline in
 * index.html. V2 does not, so the deployed policy can be tightened at cutover.
 * That is an improvement, not a regression — but only while this stays green.
 *
 * Run:  node tests/v2-csp.js
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '  got=' + JSON.stringify(got) + (ok ? '' : '  want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };

// The deployed CSP, read from _headers so the test cannot drift from what
// Cloudflare sends — then hardened by dropping 'unsafe-inline' from script-src
// ONLY. Every other directive is left exactly as deployed.
const DEPLOYED = (fs.readFileSync(path.join(ROOT, '_headers'), 'utf8')
  .split('\n').find(l => l.trim().startsWith('Content-Security-Policy:')) || '')
  .replace(/^\s*Content-Security-Policy:\s*/, '').trim();
const CSP = DEPLOYED.replace(/script-src 'self' 'unsafe-inline'/, "script-src 'self'");

const TYPES = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' };

(async () => {
  check('the deployed policy still carries the unsafe-inline V1 needs',
    /script-src 'self' 'unsafe-inline'/.test(DEPLOYED), true);
  check('the policy under test has dropped it',
    /script-src 'self';/.test(CSP), true);
  console.log('\nCSP under test:\n  ' + CSP + '\n');

  // V1 loads its libraries from vendor/, V2 will get them from npm. They must
  // be the SAME versions for the whole migration: if they drift, a V2 defect
  // could be the rewrite or could be a library bump, and no amount of reading
  // the diff separates those two. Pinned exactly (no ^) at both ends.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const vendorDoc = fs.readFileSync(path.join(ROOT, 'vendor', 'README.md'), 'utf8');
  [['leaflet', 'leaflet'],
   ['leaflet.markercluster', 'leaflet.markercluster'],
   ['@supabase/supabase-js', '@supabase/supabase-js']].forEach(([dep, name]) => {
    const want = (new RegExp('`' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`[^|]*\\|\\s*\\*\\*([\\d.]+)\\*\\*').exec(vendorDoc) || [])[1];
    check('npm ' + dep + ' matches the version vendored for V1', pkg.dependencies[dep], want);
  });

  execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'pipe' });

  // Static facts about the bundle. A browser would catch an inline script, but
  // these name the specific failure rather than reporting a generic violation.
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  check('no inline <script> body in the built page', /<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html), false);
  check('no external origin in the built page', /https?:\/\//.test(html.replace(/https?:\/\/www\.w3\.org/g, '')), false);
  const js = fs.readdirSync(path.join(DIST, 'assets')).filter(f => f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  check('no eval() in the bundle', /(^|[^.\w])eval\s*\(/.test(js), false);
  // Deliberately NOT /new Function/. Vue's runtime template compiler is the
  // realistic way this app would acquire an eval dependency, and after
  // minification it calls `Function(...)` with no `new` — the narrower pattern
  // passed happily on a bundle the browser then refused to run. Verified by
  // aliasing vue to the esm-bundler build and watching this go red.
  check('no dynamic Function construction in the bundle', /(^|[^.\w])Function\s*\(/.test(js), false);
  check('no CDN origin in the bundle', /unpkg\.com|cdn\.jsdelivr\.net/.test(js), false);

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(DIST, rel);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
                         'Content-Security-Policy': CSP });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';

  const b = await chromium.launch({ executablePath: CHROMIUM });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const cspBlocks = [], errs = [];
  p.on('console', m => { const t = m.text();
    if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(t)) cspBlocks.push(t); });
  p.on('pageerror', e => errs.push(e.message));

  await p.goto(base, { waitUntil: 'load' });
  await p.waitForTimeout(800);

  // Vue mounted at all. THIS is the authoritative check — the static assertions
  // above are a convenience that names the failure, and one of them has already
  // been caught passing on a bundle the browser refused to run. If the app does
  // not mount, report it and stop rather than throwing on a null element, or the
  // crash hides the finding.
  const mounted = await p.evaluate(() => !!document.querySelector('#cspProbe'));
  check('Vue mounted under the hardened policy', mounted, true);

  if (mounted) {
    check('the scoped stylesheet applied',
      await p.evaluate(() => getComputedStyle(document.querySelector('.count')).fontVariantNumeric), 'tabular-nums');

    // A Pinia store with a derived getter, driven through real DOM events. This
    // is the Phase 1 shape: filters stacking with AND in one getter (§3).
    check('store renders its initial derived count',
      await p.evaluate(() => document.querySelector('.count').textContent), '4/4');
    await p.click('#probeZone');
    check('reactivity survives — one filter applied',
      await p.evaluate(() => document.querySelector('.count').textContent), '3/4');
    await p.click('#probeSwasta');
    check('two filters stack with AND',
      await p.evaluate(() => document.querySelector('.count').textContent), '1/4');
  } else {
    console.log('  ----  app did not mount; skipping the behavioural checks');
    fail++;
  }

  check('nothing blocked by CSP', cspBlocks, []);
  check('no page errors', errs, []);

  await b.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
