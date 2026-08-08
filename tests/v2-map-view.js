/* Phase 3 gate, part 2 — see docs/V2-ROADMAP.md.
 *
 * The V2 map components mounted for real in Chromium, against a stub Leaflet
 * that RECORDS what the app asked it to do. v2-map-parity.js proves the fit
 * decision in isolation; this proves the component actually obeys it.
 *
 * The headline assertion is a negative one:
 *
 *     fitBounds is called 0 times during a background pull.
 *
 * That is the §3 rule, and its failure produces no error — the map simply jumps
 * away from whatever an officer is reading, mid-read, on a phone. Counting the
 * calls is the only way to see it.
 *
 * Run:  V2_HARNESS=1 npx vite build && node tests/v2-map-view.js
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '  got=' + JSON.stringify(got) + (ok ? '' : '  want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };

const REG = [];
for (let n = 1; n <= 12; n++) {
  REG.push({ id: n, label: (n <= 8 ? 'A' : 'B') + String(n).padStart(2, '0'),
    lat: 4.68 + n / 1000, lng: 118.24 + n / 1000,
    status: n % 4 === 0 ? 'swasta' : 'kerajaan',
    location: n === 3 ? 'Hospital Kunak' : 'Kg. Getah ' + n,
    lastInspected: n % 3 === 0 ? '2026-07-01' : '' });
}

(async () => {
  execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, V2_HARNESS: '1' } });

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'harness.html';
    const file = path.join(DIST, rel);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/harness.html';

  const b = await chromium.launch({ executablePath: CHROMIUM });

  async function mount(fixture, viewport) {
    const p = await b.newPage({ viewport: viewport || { width: 1280, height: 900 } });
    p.on('pageerror', (e) => { console.log('  PAGEERROR', e.message); fail++; });
    // A Leaflet stub that COUNTS. The real library is exercised by
    // csp-and-vendor.js; what matters here is what the app asks it to do.
    await p.addInitScript(() => {
      window.__fits = [];
      const noop = () => {};
      const layer = () => ({ _l: [], addTo() { return this; },
        clearLayers() { this._l = []; window.__markers = []; },
        addLayer(m) { this._l.push(m); window.__markers.push(m); } });
      window.__markers = [];
      window.L = {
        map: () => ({ on: noop, invalidateSize: noop, setView: noop,
                      fitBounds: (b2, o) => { window.__fits.push({ n: (b2 || []).length, o }); } }),
        control: { zoom: () => ({ addTo: noop }) },
        tileLayer: () => ({ addTo: noop }),
        layerGroup: layer, markerClusterGroup: layer,
        divIcon: (o) => o, latLngBounds: (a) => a,
        marker: (ll, o) => { const m = { _ll: ll, _icon: o && o.icon,
          bindTooltip(t) { m._tip = t; return m; }, on(e, fn) { if (e === 'click') m._click = fn; return m; } }; return m; },
      };
      window.__clickMarker = (i) => window.__markers[i]._click();
    });
    await p.addInitScript((f) => { window.__fixture = f; }, Object.assign({ view: 'map' }, fixture));
    await p.goto(base, { waitUntil: 'load' });
    await p.waitForTimeout(350);
    return p;
  }

  // ---------- T1: the map draws what the filters allow ----------
  console.log('T1  markers follow the filters, stacking with AND');
  let p = await mount({ hydrants: REG });
  check('every hydrant is on the map', await p.evaluate(() => window.__markers.length), REG.length);
  check('the map fitted once on first render', await p.evaluate(() => window.__fits.length), 1);

  await p.evaluate(() => window.__setFixture({ statusFilter: 'swasta' }));
  await p.waitForTimeout(250);
  check('Awam/Swasta narrows the markers',
    await p.evaluate(() => window.__markers.length), REG.filter((h) => h.status === 'swasta').length);

  await p.evaluate(() => window.__setFixture({ zoneFilter: 'A' }));
  await p.waitForTimeout(250);
  check('zone stacks with the pill (AND, not OR)',
    await p.evaluate(() => window.__markers.length),
    REG.filter((h) => h.status === 'swasta' && h.label[0] === 'A').length);
  await p.close();

  // ---------- T2: THE fit rule ----------
  console.log('T2  a background pull must never move the map (§3)');
  p = await mount({ hydrants: REG });
  const before = await p.evaluate(() => window.__fits.length);
  check('one fit after the first draw', before, 1);

  // A background pull arrives carrying a hydrant someone else added. The set
  // changes — which is exactly when a naive implementation re-fits.
  await p.evaluate(() => window.__setFixture({
    noFitOnce: true,
    hydrants: window.__fixture.hydrants.concat([{ id: 99, label: 'C01', lat: 4.7, lng: 118.3,
      status: 'kerajaan', location: 'Baru', lastInspected: '' }]),
  }));
  await p.waitForTimeout(300);
  check('the new hydrant IS drawn', await p.evaluate(() => window.__markers.length), REG.length + 1);
  check('fitBounds called 0 times during the background pull',
    await p.evaluate(() => window.__fits.length - 1), 0);

  // ...and the flag is consumed, so the NEXT genuine change still fits.
  await p.evaluate(() => window.__setFixture({ noFitOnce: false, statusFilter: 'swasta' }));
  await p.waitForTimeout(300);
  check('a real change after it still fits',
    await p.evaluate(() => window.__fits.length - 1), 1);
  await p.close();

  // ---------- T3: markers carry what the officer needs ----------
  console.log('T3  pins carry the date badge and the unsent mark');
  p = await mount({ hydrants: REG, pending: [2] });
  check('the date badge is on pins that have one', await p.evaluate(() =>
    window.__markers.filter((m) => /hydrant-date-badge/.test(m._icon.html)).length),
    REG.filter((h) => h.lastInspected).length);
  check('exactly one pin carries the unsent "!"', await p.evaluate(() =>
    window.__markers.filter((m) => /hydrant-pending/.test(m._icon.html)).length), 1);
  check('the tooltip says so too', await p.evaluate(() =>
    window.__markers.filter((m) => /Belum dihantar ke pelayan/.test(m._tip)).length), 1);
  check('tapping a pin reports the hydrant', await p.evaluate(() => {
    window.__clickMarker(0); const e = window.__events[window.__events.length - 1];
    return [e[0], e[1].label];
  }), ['pick', 'A01']);
  await p.close();

  // ---------- T4: registry and pills ----------
  console.log('T4  the registry counts the view, the bars count the register');
  p = await mount({ hydrants: REG });
  const awam = REG.filter((h) => h.status === 'kerajaan').length;
  const swasta = REG.length - awam;
  check('registry shows the visible count', await p.$eval('#regNum', (n) => n.textContent), String(REG.length).padStart(2, '0'));
  check('scope reads ALL when nothing is filtered', await p.$eval('#regScope', (n) => n.textContent), 'ALL');
  check('pill counts are of the WHOLE register',
    await p.$$eval('#pills .pcount', (n) => n.map((x) => x.textContent)),
    [String(awam).padStart(2, '0'), String(swasta).padStart(2, '0')]);

  await p.evaluate(() => window.__setFixture({ statusFilter: 'swasta' }));
  await p.waitForTimeout(250);
  check('scope reads FILTERED once a pill is on', await p.$eval('#regScope', (n) => n.textContent), 'FILTERED');
  check('registry count follows the filter', await p.$eval('#regNum', (n) => n.textContent), String(swasta).padStart(2, '0'));
  check('but the pill counts do NOT move',
    await p.$$eval('#pills .pcount', (n) => n.map((x) => x.textContent)),
    [String(awam).padStart(2, '0'), String(swasta).padStart(2, '0')]);
  await p.close();

  // ---------- T5: the banner ----------
  console.log('T5  the banner states every filter, and clears all of them');
  p = await mount({ hydrants: REG });
  check('hidden when nothing is filtered',
    await p.$eval('#banner', (n) => n.classList.contains('hide')), true);

  await p.evaluate(() => window.__setFixture({ statusFilter: 'swasta', zoneFilter: 'A' }));
  await p.waitForTimeout(250);
  // Read .bt, not the whole banner — the banner also carries the ✕ affordance.
  check('it names both axes', await p.$eval('#banner .bt', (n) => n.textContent.replace(/\s+/g, ' ').trim()),
    'Menunjukkan Swasta · Zon A sahaja');
  check('and offers a way out', await p.$eval('#banner .bx', (n) => n.textContent), '✕');
  // V1 sets the accent from status/insp only — a zone never changes it.
  check('a zone does not change the accent colour', await p.$eval('#banner', (n) =>
    /250, 204, 21|#facc15/.test(n.style.boxShadow) ? 'swasta-yellow' : n.style.boxShadow), 'swasta-yellow');

  await p.click('#banner');
  await p.waitForTimeout(250);
  check('tapping it clears every axis, not just one',
    await p.$eval('#banner', (n) => n.classList.contains('hide')), true);
  check('and the map goes back to the whole register',
    await p.evaluate(() => window.__markers.length), REG.length);
  await p.close();

  // ---------- T6: the phone ----------
  console.log('T6  no sideways scroll on a phone');
  for (const w of [360, 390, 430]) {
    p = await mount({ hydrants: REG }, { width: w, height: 780 });
    check(w + 'px · no horizontal overflow',
      await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await p.close();
  }

  await b.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
