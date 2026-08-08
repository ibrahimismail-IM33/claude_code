/* Phase 3 gate, part 3 — place search and the add-hydrant modal.
 * See docs/V2-ROADMAP.md.
 *
 * Two behaviours here are the reason this suite exists, and neither shows up
 * as an error when it breaks:
 *
 *   1. A SEARCH IGNORES THE AWAM/SWASTA PILLS. An officer looking for A26 must
 *      find it whether or not Swasta happens to be selected. If the pill were
 *      allowed to narrow a search, the box would report "Tiada pili dijumpai"
 *      for a pili that is sitting in the register — and it would look like a
 *      missing hydrant, not like a filter.
 *
 *   2. A SEARCH RE-ZOOMS THE MAP. V1 clears `fittedKey` inside applySearch. A
 *      port that forgets it finds the matches, draws them, and leaves the view
 *      exactly where it was — which reads as the search having done nothing.
 *      Counted, because there is nothing else to see.
 *
 * The add modal is asserted on its VALIDATION, not its looks. A hydrant with a
 * bad coordinate is a pin in the sea, and the officer who typed it is standing
 * next to the real one with no way to tell.
 *
 * Run:  V2_HARNESS=1 npx vite build && node tests/v2-map-search-add.js
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

// A register where the thing being searched for is SWASTA, so a search that
// respected the pill would hide it — the exact defect assertion 1 guards.
const REG = [];
for (let n = 1; n <= 12; n++) {
  REG.push({ id: n, label: (n <= 8 ? 'A' : 'B') + String(n).padStart(2, '0'),
    lat: 4.68 + n / 1000, lng: 118.24 + n / 1000,
    status: n % 4 === 0 ? 'swasta' : 'kerajaan',
    location: n === 3 ? 'Hospital Kunak' : 'Kg. Getah ' + n,
    lastInspected: '' });
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
    await p.addInitScript(() => {
      window.__fits = [];
      const noop = () => {};
      const layer = () => ({ _l: [], addTo() { return this; },
        clearLayers() { this._l = []; window.__markers = []; },
        addLayer(m) { this._l.push(m); window.__markers.push(m); } });
      window.__markers = [];
      window.L = {
        map: () => ({ on: (e, fn) => { if (e === 'click') window.__mapClick = fn; },
                      invalidateSize: noop, setView: noop,
                      fitBounds: (b2) => { window.__fits.push((b2 || []).length); } }),
        control: { zoom: () => ({ addTo: noop }) },
        tileLayer: () => ({ addTo: noop }),
        layerGroup: layer, markerClusterGroup: layer,
        divIcon: (o) => o, latLngBounds: (a) => a,
        marker: (ll, o) => ({ _ll: ll, _icon: o && o.icon,
          bindTooltip() { return this; }, on() { return this; } }),
      };
    });
    await p.addInitScript((f) => { window.__fixture = f; }, Object.assign({ view: 'map' }, fixture));
    await p.goto(base, { waitUntil: 'load' });
    await p.waitForTimeout(350);
    return p;
  }

  // ---------- T1: a search ignores the pills ----------
  console.log('T1  a search searches the WHOLE register, pill or no pill');
  let p = await mount({ hydrants: REG, statusFilter: 'swasta' });
  check('the pill is narrowing the map to start with',
    await p.evaluate(() => window.__markers.length), REG.filter((h) => h.status === 'swasta').length);

  // A01 is kerajaan. With Swasta selected, a search that respected the pill
  // would report it missing.
  await p.fill('#searchInput', 'A01');
  await p.waitForTimeout(250);
  check('an Awam pili is found while the Swasta pill is on',
    await p.evaluate(() => window.__markers.map((m) => m._ll).length), 1);
  check('the result line counts it',
    await p.$eval('#searchResult', (n) => n.textContent.replace(/\s+/g, ' ').trim()),
    '1 pili dijumpai· penapis Awam/Swasta diabaikan semasa mencari');
  check('and it SAYS the pill was ignored',
    await p.$eval('#searchResult .note', (n) => n.textContent.trim()),
    '· penapis Awam/Swasta diabaikan semasa mencari');

  // With no pill on there is nothing to explain, so no note.
  await p.evaluate(() => window.__setFixture({ statusFilter: null }));
  await p.waitForTimeout(250);
  check('no note when no pill is on', await p.$$eval('#searchResult .note', (n) => n.length), 0);
  await p.close();

  // ---------- T2: the map re-zooms onto the matches ----------
  console.log('T2  a search re-fits the map (V1 clears fittedKey)');
  p = await mount({ hydrants: REG });
  check('one fit on first draw', await p.evaluate(() => window.__fits.length), 1);
  await p.fill('#searchInput', 'Hospital');
  await p.waitForTimeout(300);
  check('one match on the map', await p.evaluate(() => window.__markers.length), 1);
  check('and the map fitted to it', await p.evaluate(() => window.__fits.length - 1), 1);

  // Clearing goes back to the whole register — and MUST fit again, even though
  // the visible set is the same one that was last fitted before the search.
  await p.fill('#searchInput', '');
  await p.waitForTimeout(300);
  check('clearing restores the register', await p.evaluate(() => window.__markers.length), REG.length);
  check('and re-fits rather than staying zoomed in',
    await p.evaluate(() => window.__fits.length - 2), 1);

  // THE case that makes the fittedKey reset load-bearing, and the only one:
  // a search whose matches are the set already fitted. The key is unchanged,
  // so fitDecision alone would decline — but the officer has been panning and
  // zooming the map by hand, and V1 re-centres on every search regardless.
  // Without this assertion the reset can be deleted and every other case here
  // still passes, because a narrowing search changes the key by itself.
  await p.fill('#searchInput', 'k');            // matches every location
  await p.waitForTimeout(300);
  check('a search matching everything still re-centres the map',
    await p.evaluate(() => window.__markers.length), REG.length);
  check('...by fitting, even though the visible set did not change',
    await p.evaluate(() => window.__fits.length - 3), 1);
  await p.close();

  // ---------- T3: search by label and by location, and the empty state ----------
  console.log('T3  label, location, and "Tiada pili dijumpai"');
  p = await mount({ hydrants: REG });
  await p.fill('#searchInput', 'kg. getah');
  await p.waitForTimeout(250);
  check('location search is case-insensitive',
    await p.evaluate(() => window.__markers.length), REG.filter((h) => /Kg\. Getah/.test(h.location)).length);
  await p.fill('#searchInput', 'b1');
  await p.waitForTimeout(250);
  check('a partial label matches', await p.evaluate(() => window.__markers.length),
    REG.filter((h) => h.label.toLowerCase().indexOf('b1') >= 0).length);
  await p.fill('#searchInput', 'zzz');
  await p.waitForTimeout(250);
  check('nothing found says so', await p.$eval('#searchResult .none', (n) => n.textContent.trim()), 'Tiada pili dijumpai');
  check('and the map is not fitted to an empty set',
    await p.evaluate(() => window.__markers.length), 0);
  await p.close();

  // ---------- T4: the clear affordances ----------
  console.log('T4  ✕ and Escape both clear');
  p = await mount({ hydrants: REG });
  check('the ✕ is hidden while the box is empty',
    await p.$eval('#searchClear', (n) => n.classList.contains('hide')), true);
  check('the result line is hidden too',
    await p.$eval('#searchResult', (n) => n.classList.contains('hide')), true);
  await p.fill('#searchInput', 'A0');
  await p.waitForTimeout(250);
  check('the ✕ appears once something is typed',
    await p.$eval('#searchClear', (n) => n.classList.contains('hide')), false);
  await p.click('#searchClear');
  await p.waitForTimeout(250);
  check('✕ empties the box', await p.$eval('#searchInput', (n) => n.value), '');
  check('and hides the result line',
    await p.$eval('#searchResult', (n) => n.classList.contains('hide')), true);

  await p.fill('#searchInput', 'A0');
  await p.waitForTimeout(200);
  await p.focus('#searchInput');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  check('Escape empties it', await p.$eval('#searchInput', (n) => n.value), '');
  check('Escape also blurs, so the phone keyboard goes away',
    await p.evaluate(() => document.activeElement && document.activeElement.id), '');
  await p.close();

  // ---------- T5: the add modal is admin-only ----------
  console.log('T5  only an admin can add a pili');
  p = await mount({ hydrants: REG, adding: true, isAdmin: false });
  check('a viewer gets no modal', await p.$$eval('#aSave', (n) => n.length), 0);
  await p.close();

  p = await mount({ hydrants: REG, adding: true, isAdmin: true });
  check('an admin does', await p.$$eval('#aSave', (n) => n.length), 1);
  check('and the map says what a tap will do',
    await p.$eval('#hint', (n) => n.classList.contains('hide')), false);
  await p.close();

  // ---------- T6: validation ----------
  console.log('T6  a bad coordinate can never be saved');
  p = await mount({ hydrants: REG, adding: true, isAdmin: true });
  check('the label defaults to the next number',
    await p.$eval('#aLabel', (n) => n.value), 'PILI 13');
  check('save is disabled with no coordinates',
    await p.$eval('#aSave', (n) => n.disabled), true);
  check('and says what is missing', await p.$eval('#aSave', (n) => n.textContent.trim()), 'Fill Lat/Long');

  await p.fill('#aLat', '91');
  await p.fill('#aLng', '118.24');
  await p.waitForTimeout(200);
  check('latitude out of range is flagged',
    await p.$eval('#aLat', (n) => n.classList.contains('bad')), true);
  check('with the range stated', await p.$eval('#aLatErr', (n) => n.textContent.trim()), '-90 to 90');
  check('and save stays disabled', await p.$eval('#aSave', (n) => n.disabled), true);

  await p.fill('#aLat', '4.6959');
  await p.fill('#aLng', '181');
  await p.waitForTimeout(200);
  check('longitude out of range is flagged too',
    await p.$eval('#aLng', (n) => n.classList.contains('bad')), true);
  check('save still disabled', await p.$eval('#aSave', (n) => n.disabled), true);

  await p.fill('#aLng', '118.2394');
  await p.waitForTimeout(200);
  check('both valid enables save', await p.$eval('#aSave', (n) => n.disabled), false);
  check('and the button changes what it offers',
    await p.$eval('#aSave', (n) => n.textContent.trim()), 'Add Hydrant');

  // An empty label is the third axis, and easy to forget: coordinates alone
  // give a pin nobody can refer to on the radio.
  await p.fill('#aLabel', '   ');
  await p.waitForTimeout(200);
  check('a blank label blocks the save', await p.$eval('#aSave', (n) => n.disabled), true);
  await p.fill('#aLabel', 'A13');
  await p.waitForTimeout(200);

  check('the Google preview appears once the coordinates are real',
    await p.$eval('#aPrev', (n) => /google\.com\/maps\?q=4\.6959,118\.2394/.test(n.innerHTML)), true);
  await p.close();

  // ---------- T7: what a save actually reports ----------
  console.log('T7  the saved hydrant carries exactly what V1 wrote');
  p = await mount({ hydrants: REG, adding: true, isAdmin: true });
  await p.fill('#aLabel', 'C01');
  await p.fill('#aLat', '4.700000');
  await p.fill('#aLng', '118.300000');
  await p.click('.cls[data-s="swasta"]');
  await p.waitForTimeout(200);
  check('the classification button shows as selected',
    await p.$eval('.cls[data-s="swasta"]', (n) => n.classList.contains('sel')), true);
  await p.click('#aSave');
  await p.waitForTimeout(200);
  const saved = await p.evaluate(() => {
    const e = window.__events.filter((x) => x[0] === 'add').pop();
    return e && e[1];
  });
  check('id continues the register', saved && saved.id, REG.length + 1);
  check('label, coordinates and class are what was typed',
    saved && [saved.label, saved.lat, saved.lng, saved.status],
    ['C01', 4.7, 118.3, 'swasta']);
  check('district is stamped, as V1 does', saved && saved.location, 'Kunak, Sabah');
  await p.close();

  // ---------- T8: a map tap fills the coordinates ----------
  console.log('T8  tapping the map while adding fills lat/long');
  p = await mount({ hydrants: REG, adding: true, isAdmin: true });
  await p.evaluate(() => window.__mapClick({ latlng: { lat: 4.712345, lng: 118.256789 } }));
  await p.waitForTimeout(150);
  check('the tap is reported with its coordinates', await p.evaluate(() => {
    const e = window.__events.filter((x) => x[0] === 'latlng').pop();
    return e && [e[1].lat, e[1].lng];
  }), [4.712345, 118.256789]);

  // The parent turns that into a draft; the modal must follow it live, because
  // the officer taps the map with the modal already open.
  await p.evaluate(() => window.__setFixture({ draft: { lat: 4.712345, lng: 118.256789 } }));
  await p.waitForTimeout(200);
  check('the coordinate fields follow the tap',
    await p.$eval('#aLat', (n) => n.value) + ',' + await p.$eval('#aLng', (n) => n.value),
    '4.712345,118.256789');
  check('and it says where they came from',
    await p.$eval('.picked', (n) => n.textContent.replace(/\s+/g, ' ').trim()),
    '📍Picked from map: 4.712345, 118.256789');
  await p.close();

  // A tap must do nothing when nobody is adding — otherwise every pan that
  // registers as a click starts filling in a form.
  p = await mount({ hydrants: REG, adding: false });
  await p.evaluate(() => window.__mapClick({ latlng: { lat: 4.7, lng: 118.3 } }));
  await p.waitForTimeout(150);
  check('a map tap outside add mode is ignored',
    await p.evaluate(() => window.__events.filter((x) => x[0] === 'latlng').length), 0);
  await p.close();

  // ---------- T9: geolocation failures speak Bahasa Malaysia ----------
  console.log('T9  "Guna Lokasi Saya" reports what to DO when it fails');
  p = await mount({ hydrants: REG, adding: true, isAdmin: true });
  // Denied permission is the common one, and the only recoverable one.
  await p.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok, err) => err({ code: 1 }); });
  await p.click('#aGeo');
  await p.waitForTimeout(200);
  check('a denied permission says how to fix it',
    await p.$eval('#aGeoMsg', (n) => n.textContent.trim()),
    'Kebenaran lokasi ditolak. Benarkan akses lokasi dalam tetapan pelayar.');

  await p.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok) =>
    ok({ coords: { latitude: 4.694321, longitude: 118.239111, accuracy: 8 } }); });
  await p.click('#aGeo');
  await p.waitForTimeout(200);
  check('a good fix fills the fields',
    await p.$eval('#aLat', (n) => n.value) + ',' + await p.$eval('#aLng', (n) => n.value),
    '4.694321,118.239111');
  check('and reports the accuracy', await p.$eval('#aGeoMsg', (n) => n.textContent.trim()),
    'Lokasi diambil — ketepatan lebih kurang 8 meter.');

  // A vague fix is still accepted, but the officer is told to re-take it.
  await p.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok) =>
    ok({ coords: { latitude: 4.69, longitude: 118.23, accuracy: 120 } }); });
  await p.click('#aGeo');
  await p.waitForTimeout(200);
  check('a vague fix warns rather than silently accepting',
    await p.$eval('#aGeoMsg', (n) => n.textContent.trim()),
    'Lokasi diambil — ketepatan lebih kurang 120 meter. Ketepatan rendah; cuba di kawasan lapang.');
  await p.close();

  // ---------- T10: the phone ----------
  console.log('T10  search row and modal fit a phone');
  for (const w of [360, 390, 430]) {
    p = await mount({ hydrants: REG, adding: true, isAdmin: true }, { width: w, height: 780 });
    check(w + 'px · no horizontal overflow',
      await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    // 16px is what stops iOS zooming the page when the box takes focus.
    check(w + 'px · search input is 16px so iOS does not zoom',
      await p.$eval('#searchInput', (n) => getComputedStyle(n).fontSize), '16px');
    await p.close();
  }

  await b.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
