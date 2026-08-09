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

/* Both real policies, read from the files Cloudflare actually reads, so this
 * test cannot drift from what is served:
 *
 *   ROOT /_headers          — V1, what officers get today. Needs
 *                             'unsafe-inline' because the whole app is an
 *                             inline <script>.
 *   v2/public/_headers      — the V2 bundle's own, copied into dist/ by Vite.
 *                             Drops 'unsafe-inline'.
 *
 * The V2 policy is used VERBATIM below — not synthesised here. An earlier
 * version of this file built the hardened policy itself by string-replacing
 * V1's, which proved that a policy nobody ships would work. */
const readCsp = (f) => (fs.readFileSync(f, 'utf8')
  .split('\n').find(l => l.trim().startsWith('Content-Security-Policy:')) || '')
  .replace(/^\s*Content-Security-Policy:\s*/, '').trim();

const DEPLOYED = readCsp(path.join(ROOT, '_headers'));
const CSP = readCsp(path.join(ROOT, 'v2', 'public', '_headers'));

const TYPES = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' };

(async () => {
  check('V1\'s live policy still carries the unsafe-inline it needs',
    /script-src 'self' 'unsafe-inline'/.test(DEPLOYED), true);
  check('the V2 policy that will actually ship has dropped it',
    /script-src 'self';/.test(CSP), true);
  // Everything except script-src must match V1 exactly. A staging policy that
  // quietly widened img-src or connect-src would make this suite's green
  // meaningless at cutover.
  check('and differs from V1 in script-src ALONE',
    CSP.split(';').map(d => d.trim()).filter(d => !d.startsWith('script-src')),
    DEPLOYED.split(';').map(d => d.trim()).filter(d => !d.startsWith('script-src')));
  // Staging must never be indexed: it holds real hydrant data and real logins.
  check('staging is marked noindex',
    /X-Robots-Tag:\s*noindex/.test(fs.readFileSync(path.join(ROOT, 'v2', 'public', '_headers'), 'utf8')), true);
  // The geolocation grant is what makes "Guna Lokasi Saya" work at all.
  check('geolocation=(self) is carried over, or Tambah Pili loses its GPS button',
    /Permissions-Policy:.*geolocation=\(self\)/.test(fs.readFileSync(path.join(ROOT, 'v2', 'public', '_headers'), 'utf8')), true);
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
  // The component harness (v2/harness.html) mounts components with injected
  // fixtures and is built only under V2_HARNESS=1. publish-to-site.yml copies
  // dist/ wholesale, so if it ever leaks into a plain build it lands on a live
  // government site. This build was run WITHOUT that flag.
  check('the test harness is not in a production build',
    fs.existsSync(path.join(DIST, 'harness.html')), false);
  check('no harness bundle either',
    fs.readdirSync(path.join(DIST, 'assets')).some((f) => /^harness-/.test(f)), false);

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
  /* This used to assert on a #cspProbe component — a stand-in that existed
   * because no app had been assembled yet. It is now the REAL app, which is
   * what this suite always meant to prove: the thing officers would load boots
   * under the hardened policy. The probe could have passed forever while the
   * production bundle contained no application at all, and for three phases it
   * did exactly that. */
  const mounted = await p.evaluate(() => !!document.querySelector('.app'));
  check('the real app mounted under the hardened policy', mounted, true);

  if (mounted) {
    // The gate is what an unauthenticated visitor must get, and it must be the
    // TOP layer: z-index 100000, above modals (9999) and the form (12000). A
    // gate something can paint over is not a gate (§4.8).
    check('the login gate is up for an unauthenticated visitor',
      await p.evaluate(() => !!document.querySelector('#authGate')), true);
    check('and it sits above every other layer',
      await p.evaluate(() => getComputedStyle(document.querySelector('#authGate')).zIndex), '100000');
    check('the sign-in control is present and enabled',
      await p.evaluate(() => { const b2 = document.querySelector('#authBtn'); return b2 && !b2.disabled; }), true);

    // The global stylesheet reached the app — a bundle that runs but arrives
    // unstyled looks like a broken deploy and is easy to miss in a headless run.
    check('the global stylesheet applied',
      await p.evaluate(() => getComputedStyle(document.querySelector('header')).zIndex), '1000');

    // Reactivity, driven through a real DOM event under the real policy: no
    // inline handler, no eval, and the framework still responds.
    check('reactivity survives the policy',
      await p.evaluate(async () => {
        const i = document.querySelector('#authEmail');
        i.value = 'a@b.c';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        document.querySelector('#authBtn').click();
        await new Promise((r) => setTimeout(r, 120));
        const e = document.querySelector('#authErr');
        return !!e && !e.classList.contains('hide');
      }), true);
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
