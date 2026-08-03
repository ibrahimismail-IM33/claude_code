/* Guards the P1 supply-chain fix (2026-08-03).
 *
 * The libraries are served from vendor/ on this site, and _headers keeps
 * script-src 'self'. Two things can silently undo that: someone re-adds a
 * CDN tag, or the tightened CSP quietly blocks something the app needs.
 * This test serves the real files with the real CSP from _headers and
 * checks both.
 *
 * Run:  node tests/csp-and-vendor.js
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '  got=' + JSON.stringify(got) + (ok ? '' : '  want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };

// the CSP Cloudflare will actually send, read from _headers so the test
// cannot drift away from what is deployed
const CSP = (fs.readFileSync(path.join(ROOT, '_headers'), 'utf8')
  .split('\n').find(l => l.trim().startsWith('Content-Security-Policy:')) || '')
  .replace(/^\s*Content-Security-Policy:\s*/, '').trim();

const TYPES = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png' };

(async () => {
  console.log('CSP under test:\n  ' + CSP + '\n');
  check('CSP has script-src \'self\' with no CDN', /script-src 'self' 'unsafe-inline';/.test(CSP), true);
  check('no unpkg in CSP',    CSP.indexOf('unpkg') >= 0, false);
  check('no jsdelivr in CSP', CSP.indexOf('jsdelivr') >= 0, false);

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('<style>'));
  check('no CDN script/link tags in <head>', /(unpkg\.com|cdn\.jsdelivr\.net)/.test(head), false);
  ['leaflet.js','leaflet.css','leaflet.markercluster.js','MarkerCluster.css','MarkerCluster.Default.css','supabase.js','images/marker-icon.png']
    .forEach(f => check('vendor/' + f + ' present', fs.existsSync(path.join(ROOT, 'vendor', f)), true));

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
                         'Content-Security-Policy': CSP });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';

  const b = await chromium.launch({ executablePath: CHROMIUM });
  const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
  const cspBlocks = [], errs = [];
  p.on('console', m => { const t = m.text();
    if (/Content Security Policy|Refused to (load|execute|connect)/i.test(t)) cspBlocks.push(t); });
  p.on('pageerror', e => errs.push(e.message));

  await p.goto(base, { waitUntil: 'load' });
  await p.waitForTimeout(2500);

  check('Leaflet loaded from vendor',        await p.evaluate(() => typeof window.L), 'object');
  check('markercluster plugin loaded',       await p.evaluate(() => typeof window.L.markerClusterGroup), 'function');
  check('Supabase client library loaded',    await p.evaluate(() => typeof window.supabase && typeof window.supabase.createClient), 'function');
  check('map container built by Leaflet',    await p.evaluate(() => !!document.querySelector('.leaflet-container')), true);
  check('zoom control rendered',             await p.evaluate(() => !!document.querySelector('.leaflet-control-zoom')), true);
  check('pins on the map',                   await p.evaluate(() => document.querySelectorAll('.leaflet-marker-icon').length > 0), true);
  check('vendor scripts came from this site', await p.evaluate(() =>
      performance.getEntriesByType('resource').filter(r => /leaflet|markercluster|supabase/.test(r.name))
        .every(r => r.name.indexOf(location.origin) === 0)), true);
  check('no CDN request attempted',          await p.evaluate(() =>
      performance.getEntriesByType('resource').some(r => /unpkg\.com|cdn\.jsdelivr\.net/.test(r.name))), false);

  // Google Fonts and OSM tiles are expected to fail with no network; a CSP
  // block is a different thing and must not happen.
  check('nothing blocked by CSP', cspBlocks, []);
  check('no page errors', errs, []);

  await b.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
